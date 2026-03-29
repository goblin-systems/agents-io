import { select, multiselect, isCancel, cancel } from "@clack/prompts";
import { fetchAgent, LocalAgentNotFoundError } from "../core/fetch.js";
import { discoverAgents } from "../core/discover.js";
import { RepositoryAgentNotFoundError } from "../core/repositories.js";
import { hashContent, addAgent } from "../core/registry.js";
import { log } from "../utils/logger.js";
import { findProjectRoot } from "../utils/paths.js";
import opencodeAdapter from "../adapters/opencode.js";
import claudeCodeAdapter from "../adapters/claude-code.js";
import codexAdapter from "../adapters/codex.js";
import kiroAdapter from "../adapters/kiro.js";
import type { Adapter, ParsedAgent, Platform } from "../types.js";

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

const adapters: Adapter[] = [opencodeAdapter, claudeCodeAdapter, codexAdapter, kiroAdapter];

function getAdapter(name: Platform): Adapter | undefined {
  return adapters.find((a) => a.name === name);
}

function isDiscoverableRootMiss(error: unknown): boolean {
  return (
    error instanceof LocalAgentNotFoundError ||
    error instanceof RepositoryAgentNotFoundError
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function promptScope(options: AddOptions, projectRoot: string): Promise<boolean> {
  if (options.global !== undefined) {
    return options.global;
  }

  const scope = await select({
    message: "Where should this agent be installed?",
    options: [
      { value: "local" as const, label: "Project (local)", hint: "recommended" },
      { value: "global" as const, label: "Global (user-level)" },
    ],
    initialValue: "local" as const,
  });

  if (isCancel(scope)) {
    cancel("Installation cancelled.");
    process.exit(0);
  }

  return scope === "global";
}

async function promptTargets(options: AddOptions, projectRoot: string): Promise<Adapter[]> {
  if (options.platform) {
    const adapter = getAdapter(options.platform as Platform);
    if (!adapter) {
      log.error(`Unknown platform: ${options.platform}`);
      process.exit(1);
    }
    return [adapter];
  }

  const detectedPlatforms: Platform[] = [];
  for (const adapter of adapters) {
    if (await adapter.detect(projectRoot)) {
      detectedPlatforms.push(adapter.name);
    }
  }

  const selected = await multiselect({
    message: "Which platforms should this agent be installed for?",
    options: [
      { value: "opencode" as const, label: "OpenCode", hint: detectedPlatforms.includes("opencode") ? "detected" : undefined },
      { value: "claude-code" as const, label: "Claude Code", hint: detectedPlatforms.includes("claude-code") ? "detected" : undefined },
      { value: "codex" as const, label: "Codex", hint: detectedPlatforms.includes("codex") ? "detected" : undefined },
      { value: "kiro" as const, label: "Kiro", hint: detectedPlatforms.includes("kiro") ? "detected" : undefined },
    ],
    initialValues: ["opencode"],
    required: true,
  });

  if (isCancel(selected)) {
    cancel("Installation cancelled.");
    process.exit(0);
  }

  return (selected as Platform[]).map((p) => {
    const adapter = getAdapter(p);
    if (!adapter) {
      log.error(`Unknown platform: ${p}`);
      process.exit(1);
    }
    return adapter;
  });
}

async function installAgent(
  agent: ParsedAgent,
  targets: Adapter[],
  projectRoot: string,
  isGlobal: boolean,
  resolvedSource: string,
  sourceType: "github" | "local",
  agentPath: string,
  repositoryUrl?: string,
): Promise<void> {
  const platformNames: Platform[] = [];

  for (const adapter of targets) {
    log.installProgress(`Installing ${agent.frontmatter.name} for ${adapter.name}...`);
    await adapter.install({
      agent,
      projectDir: projectRoot,
      global: isGlobal,
    });
    platformNames.push(adapter.name);
    log.installSuccess(`Installed ${agent.frontmatter.name} for ${adapter.name}`);
  }

  await addAgent(
    agent.frontmatter.name,
    {
      source: resolvedSource,
      sourceType,
      sourceUrl:
        sourceType === "github"
          ? `https://github.com/${resolvedSource}`
          : resolvedSource,
      repositoryUrl,
      agentPath,
      installedAt: new Date().toISOString(),
      platforms: platformNames,
      hash: hashContent(agent.raw),
      platformHashes: Object.fromEntries(
        platformNames.map((platform) => [platform, hashContent(agent.raw)]),
      ) as Partial<Record<Platform, string>>,
    },
    isGlobal,
    projectRoot,
  );
}

function previewAgentInstall(
  agent: ParsedAgent,
  targets: Adapter[],
  isGlobal: boolean,
  resolvedSource: string,
  agentPath: string,
): void {
  log.installProgress(`Would install ${agent.frontmatter.name}`);
  log.dim(`  resolved source: ${resolvedSource}`);
  log.dim(`  scope: ${isGlobal ? "global" : "project"}`);
  log.dim(`  platforms: ${targets.map((target) => target.name).join(", ")}`);

  if (agentPath) {
    log.dim(`  agent path: ${agentPath}`);
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export interface AddOptions {
  platform?: string;
  global?: boolean;
  dryRun?: boolean;
  path?: string;
}

export async function addCommand(
  source: string,
  options: AddOptions,
): Promise<void> {
  try {
    // 1. If --path is specified, use direct fetch (no discovery)
    if (options.path) {
      await addSingleAgent(source, options);
      return;
    }

    // 2. Try to fetch a single agent at root
    let rootResult: Awaited<ReturnType<typeof fetchAgent>> | undefined;
    let rootError: Error | undefined;

    try {
      log.info(`Fetching agent from ${source}...`);
      rootResult = await fetchAgent(source);
    } catch (err) {
      rootError = err instanceof Error ? err : new Error(String(err));
    }

    // 3. If root fetch succeeded, install normally
    if (rootResult) {
      await addSingleAgent(source, options, rootResult);
      return;
    }

    // 4. Root fetch failed — check if it's a "not found" error
    if (!rootError || !isDiscoverableRootMiss(rootError)) {
      throw rootError!;
    }

    // 5. Attempt discovery
    log.info("No root agent.md found. Searching for agents in subdirectories...");
    const discovered = await discoverAgents(source);

    if (discovered.length === 0) {
      throw rootError;
    }

    // 6. Multiselect prompt
    const selected = await multiselect({
      message: `Found ${discovered.length} agents. Select which to install:`,
      options: discovered.map((a) => ({
        value: a.path,
        label: a.name,
        hint: a.description.length > 60
          ? a.description.slice(0, 57) + "..."
          : a.description,
      })),
      initialValues: [] as string[],
      required: false,
    });

    if (isCancel(selected)) {
      cancel("Installation cancelled.");
      process.exit(0);
    }

    const selectedPaths = selected as string[];

    if (selectedPaths.length === 0) {
      log.info("No agents selected.");
      return;
    }

    // 7. Scope and platform selection (once for all agents)
    const projectRoot = findProjectRoot();
    const isGlobal = await promptScope(options, projectRoot);
    const targets = await promptTargets(options, projectRoot);

    if (options.dryRun) {
      log.info("Dry run preview - no changes were made.");
    }

    // 8. Fetch and install each selected agent
    for (const agentPath of selectedPaths) {
      log.info(`Fetching agent from ${source} (path: ${agentPath})...`);
      const result = await fetchAgent(source, { path: agentPath });

      if (options.dryRun) {
        previewAgentInstall(
          result.agent,
          targets,
          isGlobal,
          result.resolvedSource,
          agentPath,
        );
        continue;
      }

      await installAgent(
        result.agent,
        targets,
        projectRoot,
        isGlobal,
        result.resolvedSource,
        result.sourceType,
        agentPath,
        result.repositoryUrl,
      );
    }

    if (options.dryRun) {
      log.success(`Dry run complete for ${selectedPaths.length} agent(s)`);
      return;
    }

    log.success(`Installed ${selectedPaths.length} agent(s) successfully`);
  } catch (err) {
    log.error(
      err instanceof Error ? err.message : `Failed to add agent: ${String(err)}`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Single-agent install (original flow)
// ---------------------------------------------------------------------------

async function addSingleAgent(
  source: string,
  options: AddOptions,
  prefetched?: Awaited<ReturnType<typeof fetchAgent>>,
): Promise<void> {
  const result = prefetched ?? await (async () => {
    log.info(`Fetching agent from ${source}...`);
    return fetchAgent(source, { path: options.path });
  })();

  const { agent, sourceType, resolvedSource } = result;
  const { name, description } = agent.frontmatter;

  log.info(`Found agent: ${name} — ${description}`);

  const projectRoot = findProjectRoot();
  const isGlobal = await promptScope(options, projectRoot);
  const targets = await promptTargets(options, projectRoot);

  if (options.dryRun) {
    log.info("Dry run preview - no changes were made.");
    previewAgentInstall(agent, targets, isGlobal, resolvedSource, options.path ?? "");
    log.success(`Dry run complete for ${name}`);
    return;
  }

  const platformNames: Platform[] = [];

  for (const adapter of targets) {
    log.installProgress(`Installing for ${adapter.name}...`);
    await adapter.install({
      agent,
      projectDir: projectRoot,
      global: isGlobal,
    });
    platformNames.push(adapter.name);
    log.installSuccess(`Installed for ${adapter.name}`);
  }

  await addAgent(
    name,
    {
      source: resolvedSource,
      sourceType,
      sourceUrl:
        sourceType === "github"
          ? `https://github.com/${resolvedSource}`
          : resolvedSource,
      repositoryUrl: result.repositoryUrl,
      agentPath: options.path ?? "",
      installedAt: new Date().toISOString(),
      platforms: platformNames,
      hash: hashContent(agent.raw),
      platformHashes: Object.fromEntries(
        platformNames.map((platform) => [platform, hashContent(agent.raw)]),
      ) as Partial<Record<Platform, string>>,
    },
    isGlobal,
    projectRoot,
  );

  log.success(`Agent ${name} installed successfully`);
}
