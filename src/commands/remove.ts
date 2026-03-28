import { addAgent, getAgent, removeAgent } from "../core/registry.js";
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
}

interface ScopeTarget {
  entry: InstalledAgent;
  global: boolean;
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
): Promise<void> {
  log.info(`Removing '${name}' from ${isGlobal ? "global" : "project"} scope...`);

  for (const platform of targetPlatforms) {
    const adapter = getAdapter(platform);
    if (!adapter) {
      log.warn(`No adapter found for ${platform}, skipping`);
      continue;
    }

    try {
      await adapter.uninstall(name, projectRoot, isGlobal);
      log.success(`Removed from ${platform} (${isGlobal ? "global" : "project"})`);
    } catch (err) {
      log.warn(
        `Failed to remove from ${platform}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const nextEntry = normalizeEntryAfterPlatformRemoval(entry, targetPlatforms);

  if (!nextEntry) {
    await removeAgent(name, isGlobal, projectRoot);
    log.success(`Agent '${name}' removed from ${isGlobal ? "global" : "project"} scope`);
    return;
  }

  await addAgent(name, nextEntry, isGlobal, projectRoot);
  log.success(
    `Removed ${targetPlatforms.join(", ")} from ${name} (${isGlobal ? "global" : "project"})`,
  );
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function removeCommand(
  name: string,
  options: RemoveOptions = {},
): Promise<void> {
  try {
    const projectRoot = findProjectRoot();
    const requestedPlatform = options.platform as Platform | undefined;

    const selectedModes = [options.local, options.global, options.all].filter(Boolean).length;
    if (selectedModes > 1) {
      log.error("Use only one of --local, --global, or --all");
      process.exit(1);
    }

    if (requestedPlatform && !getAdapter(requestedPlatform)) {
      log.error(`Unknown platform: ${options.platform}`);
      process.exit(1);
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

    for (const target of removeTargets) {
      await removeFromScope(
        name,
        projectRoot,
        target.global,
        target.entry,
        requestedPlatform ? [requestedPlatform] : target.entry.platforms,
      );
    }
  } catch (err) {
    log.error(
      err instanceof Error ? err.message : `Failed to remove agent: ${String(err)}`,
    );
    process.exit(1);
  }
}
