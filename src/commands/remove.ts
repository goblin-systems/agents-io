import { cancel, isCancel, multiselect, select } from "@clack/prompts";
import { addAgent, getAgent, listAgents, removeAgent } from "../core/registry.js";
import { log } from "../utils/logger.js";
import { findProjectRoot } from "../utils/paths.js";
import opencodeAdapter from "../adapters/opencode.js";
import claudeCodeAdapter from "../adapters/claude-code.js";
import codexAdapter from "../adapters/codex.js";
import kiroAdapter from "../adapters/kiro.js";
import type { Adapter, InstalledAgent, Platform } from "../types.js";

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

const adapters: Adapter[] = [opencodeAdapter, claudeCodeAdapter, codexAdapter, kiroAdapter];

function getAdapter(name: Platform): Adapter | undefined {
  return adapters.find((a) => a.name === name);
}

interface RemoveOptions {
  local?: boolean;
  global?: boolean;
  all?: boolean;
  platform?: string;
  dryRun?: boolean;
}

interface ScopeTarget {
  entry: InstalledAgent;
  global: boolean;
}

async function promptScope(options: RemoveOptions): Promise<boolean> {
  if (options.global) {
    return true;
  }

  if (options.local) {
    return false;
  }

  const scope = await select({
    message: "Where should agents be removed from?",
    options: [
      { value: "local" as const, label: "Project (local)", hint: "recommended" },
      { value: "global" as const, label: "Global (user-level)" },
    ],
    initialValue: "local" as const,
  });

  if (isCancel(scope)) {
    cancel("Removal cancelled.");
    process.exit(0);
  }

  return scope === "global";
}

async function promptAgentsToRemove(
  agents: Record<string, InstalledAgent>,
  requestedPlatform?: Platform,
): Promise<string[]> {
  const selectableAgents = Object.entries(agents)
    .filter(([, entry]) => !requestedPlatform || entry.platforms.includes(requestedPlatform))
    .sort(([left], [right]) => left.localeCompare(right));

  if (selectableAgents.length === 0) {
    return [];
  }

  const selected = await multiselect({
    message: "Which agents should be removed?",
    options: selectableAgents.map(([name, entry]) => ({
      value: name,
      label: name,
      hint: requestedPlatform
        ? `installed for ${requestedPlatform}`
        : entry.platforms.join(", "),
    })),
    initialValues: [] as string[],
    required: false,
  });

  if (isCancel(selected)) {
    cancel("Removal cancelled.");
    process.exit(0);
  }

  return selected as string[];
}

function getStoredPlatformHashes(
  entry: InstalledAgent,
): Partial<Record<Platform, string>> {
  const hashes: Partial<Record<Platform, string>> = { ...(entry.platformHashes ?? {}) };

  for (const platform of entry.platforms) {
    hashes[platform] ??= entry.hash;
  }

  return hashes;
}

function normalizeEntryAfterPlatformRemoval(
  entry: InstalledAgent,
  removedPlatforms: Platform[],
): InstalledAgent | undefined {
  const removedSet = new Set(removedPlatforms);
  const platforms = entry.platforms.filter((platform) => !removedSet.has(platform));

  if (platforms.length === 0) {
    return undefined;
  }

  const platformHashes = getStoredPlatformHashes(entry);
  for (const platform of removedPlatforms) {
    delete platformHashes[platform];
  }

  const remainingHashes = platforms.map((platform) => platformHashes[platform] ?? entry.hash);
  const hash = remainingHashes.every((value) => value === remainingHashes[0])
    ? remainingHashes[0]
    : entry.hash;

  return {
    ...entry,
    platforms,
    hash,
    platformHashes,
  };
}

async function removeFromScope(
  name: string,
  projectRoot: string,
  isGlobal: boolean,
  entry: InstalledAgent,
  targetPlatforms: Platform[],
  dryRun: boolean,
): Promise<void> {
  const nextEntry = normalizeEntryAfterPlatformRemoval(entry, targetPlatforms);
  const scopeLabel = isGlobal ? "global" : "project";

  if (dryRun) {
    log.remove(`Previewing removal for ${name}`);
    log.detail(`scope: ${scopeLabel}`);
    log.detail(`target platforms: ${targetPlatforms.join(", ")}`);
    log.detail(
      `registry action: ${nextEntry ? `update entry (remaining platforms: ${nextEntry.platforms.join(", ")})` : "remove entry"}`,
    );
    return;
  }

  log.remove(`Removing ${name}`);
  log.detail(`scope: ${isGlobal ? "global" : "project"}`);

  for (const platform of targetPlatforms) {
    const adapter = getAdapter(platform);
    if (!adapter) {
      log.warn(`No adapter found for ${platform}, skipping`);
      continue;
    }

    try {
      await adapter.uninstall(name, projectRoot, isGlobal);
      log.detail(`removed from ${platform}`);
    } catch (err) {
      log.warn(
        `Failed to remove from ${platform}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!nextEntry) {
    await removeAgent(name, isGlobal, projectRoot);
    log.spacer();
    log.success(`Removal complete for ${name}`);
    log.detail(`Scope: ${isGlobal ? "global" : "project"}`);
    return;
  }

  await addAgent(name, nextEntry, isGlobal, projectRoot);
  log.spacer();
  log.success(`Removal complete for ${name}`);
  log.detail(`Remaining platforms: ${nextEntry.platforms.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function removeCommand(
  name: string | undefined,
  options: RemoveOptions = {},
): Promise<void> {
  try {
    const projectRoot = findProjectRoot();
    const requestedPlatform = options.platform as Platform | undefined;
    const dryRun = options.dryRun ?? false;

    const selectedModes = [options.local, options.global, options.all].filter(Boolean).length;
    if (selectedModes > 1) {
      log.error("Use only one of --local, --global, or --all");
      process.exit(1);
    }

    if (requestedPlatform && !getAdapter(requestedPlatform)) {
      log.error(`Unknown platform: ${options.platform}`);
      process.exit(1);
    }

    if (!name) {
      if (options.all) {
        log.error("--all requires an agent name");
        process.exit(1);
      }

      const isGlobal = await promptScope(options);
      const installedAgents = await listAgents(isGlobal, projectRoot);
      const selectedNames = await promptAgentsToRemove(installedAgents, requestedPlatform);

      if (selectedNames.length === 0) {
        const scopeLabel = isGlobal ? "global" : "project";
        if (Object.keys(installedAgents).length === 0) {
          log.detail(`No agents installed in ${scopeLabel} scope.`);
          return;
        }

        if (requestedPlatform) {
          log.detail(`No agents installed for ${requestedPlatform} in ${scopeLabel} scope.`);
          return;
        }

        log.detail("No agents selected.");
        return;
      }

      if (dryRun) {
        log.remove("Preparing dry run");
        log.detail("No changes will be written.");
        log.spacer();
      }

      for (const selectedName of selectedNames) {
        const entry = installedAgents[selectedName];
        if (!entry) {
          continue;
        }

        if (selectedName !== selectedNames[0]) {
          log.spacer();
        }

        await removeFromScope(
          selectedName,
          projectRoot,
          isGlobal,
          entry,
          requestedPlatform ? [requestedPlatform] : entry.platforms,
          dryRun,
        );
      }

      if (dryRun) {
        log.spacer();
        log.success(`Dry run complete for ${selectedNames.length} agent(s)`);
      }

      return;
     }

    // Look up agent in project scope first, then global
    const projectAgent = await getAgent(name, false, projectRoot);
    const globalAgent = await getAgent(name, true);

    if (!projectAgent && !globalAgent) {
      log.error(`Agent '${name}' is not installed`);
      process.exit(1);
    }

    const hasRequestedPlatform = (entry: InstalledAgent | undefined): entry is InstalledAgent => {
      return Boolean(entry && (!requestedPlatform || entry.platforms.includes(requestedPlatform)));
    };

    const removeTargets: ScopeTarget[] = [];

    if (options.local) {
      if (!projectAgent) {
        log.error(`Agent '${name}' is not installed in project scope`);
        process.exit(1);
      }
      if (requestedPlatform && !projectAgent.platforms.includes(requestedPlatform)) {
        log.error(`Agent '${name}' is not installed for ${requestedPlatform} in project scope`);
        process.exit(1);
      }
      removeTargets.push({ entry: projectAgent, global: false });
    } else if (options.global) {
      if (!globalAgent) {
        log.error(`Agent '${name}' is not installed in global scope`);
        process.exit(1);
      }
      if (requestedPlatform && !globalAgent.platforms.includes(requestedPlatform)) {
        log.error(`Agent '${name}' is not installed for ${requestedPlatform} in global scope`);
        process.exit(1);
      }
      removeTargets.push({ entry: globalAgent, global: true });
    } else if (options.all) {
      if (hasRequestedPlatform(projectAgent)) {
        removeTargets.push({ entry: projectAgent, global: false });
      }
      if (hasRequestedPlatform(globalAgent)) {
        removeTargets.push({ entry: globalAgent, global: true });
      }

      if (removeTargets.length === 0) {
        log.error(`Agent '${name}' is not installed${requestedPlatform ? ` for ${requestedPlatform}` : ""}`);
        process.exit(1);
      }
    } else {
      if (projectAgent && globalAgent) {
        log.error(
          `Agent '${name}' is installed in both project and global scope. Use --local, --global, or --all.`,
        );
        process.exit(1);
      }

      const scopeTarget = projectAgent
        ? { entry: projectAgent, global: false }
        : { entry: globalAgent!, global: true };

      if (requestedPlatform && !scopeTarget.entry.platforms.includes(requestedPlatform)) {
        log.error(
          `Agent '${name}' is not installed for ${requestedPlatform} in ${scopeTarget.global ? "global" : "project"} scope`,
        );
        process.exit(1);
      }

      removeTargets.push(scopeTarget);
    }

    if (dryRun) {
      log.remove("Preparing dry run");
      log.detail("No changes will be written.");
      log.spacer();
    }

    for (const target of removeTargets) {
      if (target !== removeTargets[0]) {
        log.spacer();
      }

      await removeFromScope(
        name,
        projectRoot,
        target.global,
        target.entry,
        requestedPlatform ? [requestedPlatform] : target.entry.platforms,
        dryRun,
      );
    }

    if (dryRun) {
      log.spacer();
      log.success(`Dry run complete for ${name}`);
    }
  } catch (err) {
    log.error(
      err instanceof Error ? err.message : `Failed to remove agent: ${String(err)}`,
    );
    process.exit(1);
  }
}
