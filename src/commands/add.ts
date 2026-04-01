import { select, multiselect, isCancel, cancel } from "@clack/prompts";
import { convertGitHubAgent, type ConvertibleGitHubAgent } from "../core/convert-github-agent.js";
import {
  applyAgentModeOverride,
  getEffectiveAgentMode,
  validateAgentMode,
} from "../core/agent-mode.js";
import { fetchAgent } from "../core/fetch.js";
import { getRequestedGitHubRef } from "../core/github-ref.js";
import { getPlatformCompatibilityIssues } from "../core/platform-compatibility.js";
import { hashContent, addAgent } from "../core/registry.js";
import { resolveAgentSource } from "../core/resolve-agent-source.js";
import { RepositoryAgentNotFoundError } from "../core/repositories.js";
import { log } from "../utils/logger.js";
import { findProjectRoot } from "../utils/paths.js";
import opencodeAdapter from "../adapters/opencode.js";
import claudeCodeAdapter from "../adapters/claude-code.js";
import codexAdapter from "../adapters/codex.js";
import kiroAdapter from "../adapters/kiro.js";
import type { Adapter, AgentMode, GitHubRef, ParsedAgent, Platform } from "../types.js";

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

const adapters: Adapter[] = [opencodeAdapter, claudeCodeAdapter, codexAdapter, kiroAdapter];

function getAdapter(name: Platform): Adapter | undefined {
  return adapters.find((a) => a.name === name);
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
  sourceUrl?: string,
  githubRef?: GitHubRef,
  modeOverride?: AgentMode,
): Promise<void> {
  const platformNames: Platform[] = [];

  log.detail(`mode: ${getEffectiveAgentMode(agent, modeOverride)}`);

  for (const adapter of targets) {
    log.detail(`${agent.frontmatter.name} -> ${adapter.name}`);
    await adapter.install({
      agent,
      projectDir: projectRoot,
      global: isGlobal,
    });
    platformNames.push(adapter.name);
  }

  await addAgent(
    agent.frontmatter.name,
    {
      source: resolvedSource,
      sourceType,
      sourceUrl: sourceType === "github" ? (sourceUrl ?? `https://github.com/${resolvedSource}`) : resolvedSource,
      repositoryUrl,
      host: sourceType === "github" ? new URL(sourceUrl ?? `https://github.com/${resolvedSource}`).host : undefined,
      githubRef,
      agentPath,
      installedAt: new Date().toISOString(),
      platforms: platformNames,
      hash: hashContent(agent.raw),
        platformHashes: Object.fromEntries(
          platformNames.map((platform) => [platform, hashContent(agent.raw)]),
        ) as Partial<Record<Platform, string>>,
        modeOverride,
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
  modeOverride?: AgentMode,
): void {
  log.install(`Previewing ${agent.frontmatter.name}`);
  log.detail(`resolved source: ${resolvedSource}`);
  log.detail(`scope: ${isGlobal ? "global" : "project"}`);
  log.detail(`platforms: ${targets.map((target) => target.name).join(", ")}`);
  log.detail(`mode: ${getEffectiveAgentMode(agent, modeOverride)}`);

  if (agentPath) {
    log.detail(`agent path: ${agentPath}`);
  }
}

interface PreparedInstall {
  result: Awaited<ReturnType<typeof fetchAgent>>;
  agentPath: string;
}

function reportCompatibilityIssues(agent: ParsedAgent, targets: Adapter[]): void {
  const issues = getPlatformCompatibilityIssues(
    agent,
    targets.map((target) => target.name),
  );

  if (issues.length === 0) {
    return;
  }

  const warnings = issues.filter((issue) => issue.severity === "warning");
  const errors = issues.filter((issue) => issue.severity === "error");

  if (warnings.length > 0) {
    log.warn(`Compatibility warnings for ${agent.frontmatter.name}`);
    for (const warning of warnings) {
      log.detail(`[${warning.platform}] ${warning.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Compatibility check failed for ${agent.frontmatter.name}: ${errors
        .map((error) => `[${error.platform}] ${error.message}`)
        .join(" ")}`,
    );
  }
}

async function prepareSelectedAgents(
  source: string,
  selectedPaths: string[],
  githubRef: Omit<GitHubRef, "resolvedCommit"> | undefined,
  targets: Adapter[],
  modeOverride: AgentMode | undefined,
  host?: string,
): Promise<PreparedInstall[]> {
  const preparedAgents: PreparedInstall[] = [];

  for (const agentPath of selectedPaths) {
    log.fetch(`Fetching agent from ${source}`);
    log.detail(`agent path: ${agentPath}`);
    const result = await fetchAgent(source, { path: agentPath, githubRef, host });
    reportCompatibilityIssues(applyAgentModeOverride(result.agent, modeOverride), targets);
    preparedAgents.push({ result, agentPath });
  }

  return preparedAgents;
}

async function promptGitHubConversion(
  source: string,
  conversion: ConvertibleGitHubAgent,
): Promise<boolean> {
  const decision = await select({
    message: `No compatible agent.md was found in ${source}. Found ${conversion.sourcePath} instead. Try a best-effort conversion? This may fail, be incomplete, or behave unexpectedly after install.`,
    options: [
      { value: "convert", label: "Try conversion" },
      { value: "skip", label: "Do not convert", hint: "safe default" },
    ],
    initialValue: "skip",
  });

  if (isCancel(decision)) {
    cancel("Installation cancelled.");
    process.exit(0);
  }

  return decision === "convert";
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export interface AddOptions {
  platform?: string;
  global?: boolean;
  dryRun?: boolean;
  mode?: string;
  path?: string;
  branch?: string;
  tag?: string;
  commit?: string;
  host?: string;
}

function resolveStoredGitHubRef(
  requestedGitHubRef: Omit<GitHubRef, "resolvedCommit"> | undefined,
  resolvedCommit: string | undefined,
): GitHubRef | undefined {
  if (!requestedGitHubRef || !resolvedCommit) {
    return undefined;
  }

  return {
    ...requestedGitHubRef,
    resolvedCommit,
  };
}

export async function addCommand(
  source: string,
  options: AddOptions,
): Promise<void> {
  try {
    const modeOverride = validateAgentMode(options.mode);
    const githubRef = getRequestedGitHubRef(options);

    // 1. If --path is specified, use direct fetch (no discovery)
    if (options.path) {
      await addSingleAgent(source, options);
      return;
    }

    // 2. Try to fetch a single agent at root
    log.fetch(`Fetching agent from ${source}`);
    const resolvedSource = await resolveAgentSource(source, githubRef, options.host);

    // 3. If root fetch succeeded, install normally
    if (resolvedSource.kind === "root") {
      await addSingleAgent(source, options, resolvedSource.result);
      return;
    }

    if (resolvedSource.kind === "convertible-root") {
      const shouldConvert = await promptGitHubConversion(source, resolvedSource.conversion);

      if (!shouldConvert) {
        log.detail("Conversion skipped.");
        return;
      }

      await addSingleAgent(source, options, resolvedSource.conversion.result, resolvedSource.conversion);
      return;
    }

    // 4. Root fetch missed — use discovered subdirectory agents
    log.detail("No root agent.md found. Searching for agents in subdirectories...");
    const discovered = resolvedSource.agents;

    // 5. Multiselect prompt
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
      log.detail("No agents selected.");
      return;
    }

    // 6. Scope and platform selection (once for all agents)
    const projectRoot = findProjectRoot();
    const isGlobal = await promptScope(options, projectRoot);
    const targets = await promptTargets(options, projectRoot);
    const selectedAgents = discovered
      .filter((agent) => selectedPaths.includes(agent.path))
      .map((agent) => agent.name);

    log.spacer();
    log.sync(options.dryRun ? "Previewing selected agents" : "Preparing selected agents");
    log.detail(source);
    log.detail(selectedAgents.join(", "));
    log.spacer();

    if (options.dryRun) {
      log.install("Preparing dry run");
      log.detail("No changes will be written.");
      log.spacer();
    } else {
      log.install("Installing agents");
      log.detail(selectedAgents.join(", "));
      log.spacer();
    }

    const preparedAgents = await prepareSelectedAgents(
      source,
      selectedPaths,
      githubRef,
      targets,
      modeOverride,
      options.host,
    );

    // 7. Install each selected agent
    for (const [index, preparedAgent] of preparedAgents.entries()) {
      if (index > 0) {
        log.spacer();
      }

      const { result, agentPath } = preparedAgent;
      const effectiveAgent = applyAgentModeOverride(result.agent, modeOverride);

      if (options.dryRun) {
        previewAgentInstall(
          effectiveAgent,
          targets,
          isGlobal,
          result.resolvedSource,
          agentPath,
          modeOverride,
        );
        continue;
      }

      await installAgent(
        effectiveAgent,
        targets,
        projectRoot,
        isGlobal,
        result.resolvedSource,
        result.sourceType,
        agentPath,
        result.repositoryUrl,
        result.sourceUrl,
        resolveStoredGitHubRef(githubRef, result.resolvedCommit),
        modeOverride,
      );
    }

    if (options.dryRun) {
      log.spacer();
      log.success(`Dry run complete for ${selectedPaths.length} agent(s)`);
      log.detail(`Platforms: ${targets.map((target) => target.name).join(", ")}`);
      return;
    }

    log.spacer();
    log.success("Installation complete");
    log.detail(`For ${targets.map((target) => target.name).join(", ")}`);
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
  conversion?: ConvertibleGitHubAgent,
): Promise<void> {
  const requestedGitHubRef = getRequestedGitHubRef(options);
  const modeOverride = validateAgentMode(options.mode);
  const fetched = prefetched
    ? { result: prefetched, conversion }
    : await (async () => {
      log.fetch(`Fetching agent from ${source}`);

      try {
        return {
          result: await fetchAgent(source, {
            path: options.path,
            githubRef: requestedGitHubRef,
            host: options.host,
          }),
          conversion: undefined,
        };
      } catch (error) {
        if (!(error instanceof RepositoryAgentNotFoundError)) {
          throw error;
        }

        const candidate = await convertGitHubAgent(source, {
          path: options.path,
          githubRef: requestedGitHubRef,
          host: options.host,
        });

        if (!candidate) {
          throw error;
        }

        const shouldConvert = await promptGitHubConversion(source, candidate);

        if (!shouldConvert) {
          log.detail("Conversion skipped.");
          return null;
        }

        return {
          result: candidate.result,
          conversion: candidate,
        };
      }
    })();

  if (!fetched) {
    return;
  }

  const { result, conversion: activeConversion } = fetched;

  const agent = applyAgentModeOverride(result.agent, modeOverride);
  const { sourceType, resolvedSource } = result;
  const { name, description } = agent.frontmatter;

  log.sync("Preparing agent");
  log.detail(source);
  log.detail(`${name} - ${description}`);
  log.detail(`mode: ${getEffectiveAgentMode(result.agent, modeOverride)}`);
  if (activeConversion) {
    log.detail(`converted from: ${activeConversion.sourcePath}`);
  }
  if (options.path) {
    log.detail(`agent path: ${options.path}`);
  }
  log.spacer();

  const projectRoot = findProjectRoot();
  const isGlobal = await promptScope(options, projectRoot);
  const targets = await promptTargets(options, projectRoot);
  reportCompatibilityIssues(agent, targets);

  if (options.dryRun) {
    log.install("Preparing dry run");
    log.detail("No changes will be written.");
    log.spacer();
    previewAgentInstall(agent, targets, isGlobal, resolvedSource, options.path ?? "", modeOverride);
    log.spacer();
    log.success(`Dry run complete for ${name}`);
    log.detail(`Platforms: ${targets.map((target) => target.name).join(", ")}`);
    return;
  }

  log.install("Installing agent");
  log.detail(name);
  log.spacer();

  await installAgent(
    agent,
    targets,
    projectRoot,
    isGlobal,
    resolvedSource,
    sourceType,
    options.path ?? "",
    result.repositoryUrl,
    result.sourceUrl,
    resolveStoredGitHubRef(requestedGitHubRef, result.resolvedCommit),
    modeOverride,
  );

  log.spacer();
  log.success("Installation complete");
  log.detail(`For ${targets.map((target) => target.name).join(", ")}`);
}
