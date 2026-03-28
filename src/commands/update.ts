import { fetchAgent } from "../core/fetch.js";
import { hashContent, readLockFile, writeLockFile } from "../core/registry.js";
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

function getStoredPlatformHashes(
  entry: InstalledAgent,
): Partial<Record<Platform, string>> {
  const hashes: Partial<Record<Platform, string>> = { ...(entry.platformHashes ?? {}) };

  for (const platform of entry.platforms) {
    hashes[platform] ??= entry.hash;
  }

  return hashes;
}

function areAllInstalledPlatformsCurrent(
  platforms: Platform[],
  platformHashes: Partial<Record<Platform, string>>,
  hash: string,
): boolean {
  return platforms.every((platform) => platformHashes[platform] === hash);
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export interface UpdateOptions {
  platform?: string;
  global?: boolean;
}

export async function updateCommand(
  name?: string,
  options?: UpdateOptions,
): Promise<void> {
  try {
    const projectRoot = findProjectRoot();
    const isGlobal = options?.global ?? false;
    const requestedPlatform = options?.platform as Platform | undefined;

    if (requestedPlatform && !getAdapter(requestedPlatform)) {
      log.error(`Unknown platform: ${options?.platform}`);
      process.exit(1);
    }

    // Read lock file (project scope, then global)
    const lockFile = await readLockFile(isGlobal, projectRoot);
    const allAgents = lockFile.agents;

    if (Object.keys(allAgents).length === 0) {
      log.info("No agents installed");
      return;
    }

    // Determine which agents to update
    let agentsToUpdate: [string, InstalledAgent][];

    if (name) {
      const entry = allAgents[name];
      if (!entry) {
        log.error(`Agent '${name}' is not installed`);
        process.exit(1);
      }
      agentsToUpdate = [[name, entry]];
    } else {
      agentsToUpdate = Object.entries(allAgents);
    }

    let updatedCount = 0;
    let upToDateCount = 0;

    for (const [agentName, entry] of agentsToUpdate) {
      try {
        // Re-fetch from source based on sourceType
        const fetchSource =
          entry.sourceType === "local" ? entry.sourceUrl : entry.source;

        const fetchOptions = entry.agentPath ? { path: entry.agentPath } : undefined;
        const result = await fetchAgent(fetchSource, fetchOptions);

        const newHash = hashContent(result.agent.raw);

        const storedPlatformHashes = getStoredPlatformHashes(entry);
        const targetPlatforms = requestedPlatform ? [requestedPlatform] : entry.platforms;

        if (requestedPlatform && !entry.platforms.includes(requestedPlatform)) {
          log.warn(`  ${agentName} is not installed for ${requestedPlatform}, skipping`);
          continue;
        }

        const alreadyCurrent = requestedPlatform
          ? storedPlatformHashes[requestedPlatform] === newHash
          : areAllInstalledPlatformsCurrent(entry.platforms, storedPlatformHashes, newHash);

        if (alreadyCurrent) {
          log.dim(`  ${agentName} is up to date`);
          upToDateCount++;
          continue;
        }

        for (const platform of targetPlatforms) {
          const adapter = getAdapter(platform);
          if (!adapter) {
            log.warn(`No adapter found for ${platform}, skipping`);
            continue;
          }

          await adapter.install({
            agent: result.agent,
            projectDir: projectRoot,
            global: isGlobal,
          });
        }

        // Update lock file entry
        const nextPlatformHashes = getStoredPlatformHashes(entry);
        for (const platform of targetPlatforms) {
          nextPlatformHashes[platform] = newHash;
        }

        lockFile.agents[agentName] = {
          ...entry,
          hash: areAllInstalledPlatformsCurrent(entry.platforms, nextPlatformHashes, newHash)
            ? newHash
            : entry.hash,
          installedAt: new Date().toISOString(),
          platforms: entry.platforms,
          platformHashes: nextPlatformHashes,
        };

        log.success(`  ${agentName} updated`);
        updatedCount++;
      } catch (err) {
        log.error(
          `  Failed to update ${agentName}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Write updated lock file once
    await writeLockFile(lockFile, isGlobal, projectRoot);

    log.info(
      `${updatedCount} agent(s) updated, ${upToDateCount} already up to date`,
    );
  } catch (err) {
    log.error(
      err instanceof Error
        ? err.message
        : `Failed to update agents: ${String(err)}`,
    );
    process.exit(1);
  }
}
