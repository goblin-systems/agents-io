import { cancel, isCancel, multiselect, select } from "@clack/prompts";
import { fetchAgent } from "../core/fetch.js";
import { hashContent, readLockFile, writeLockFile } from "../core/registry.js";
import { log } from "../utils/logger.js";
import { findProjectRoot } from "../utils/paths.js";
import opencodeAdapter from "../adapters/opencode.js";
import claudeCodeAdapter from "../adapters/claude-code.js";
import codexAdapter from "../adapters/codex.js";
import kiroAdapter from "../adapters/kiro.js";
import type { Adapter, InstalledAgent, ParsedAgent, Platform } from "../types.js";

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

interface ComparedAgent {
  agent: ParsedAgent;
  newHash: string;
  targetPlatforms: Platform[];
  alreadyCurrent: boolean;
}

function getFetchSource(entry: InstalledAgent): string {
  return entry.sourceType === "local"
    ? entry.sourceUrl
    : (entry.repositoryUrl ?? entry.source);
}

async function compareInstalledAgent(
  entry: InstalledAgent,
  requestedPlatform?: Platform,
): Promise<ComparedAgent> {
  const fetchSource = getFetchSource(entry);
  const fetchOptions = entry.agentPath ? { path: entry.agentPath } : undefined;
  const result = await fetchAgent(fetchSource, fetchOptions);
  const newHash = hashContent(result.agent.raw);
  const storedPlatformHashes = getStoredPlatformHashes(entry);
  const targetPlatforms = requestedPlatform ? [requestedPlatform] : entry.platforms;
  const alreadyCurrent = requestedPlatform
    ? storedPlatformHashes[requestedPlatform] === newHash
    : areAllInstalledPlatformsCurrent(entry.platforms, storedPlatformHashes, newHash);

  return {
    agent: result.agent,
    newHash,
    targetPlatforms,
    alreadyCurrent,
  };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export interface UpdateOptions {
  local?: boolean;
  platform?: string;
  global?: boolean;
  check?: boolean;
}

async function promptScope(options: UpdateOptions): Promise<boolean> {
  if (options.global) {
    return true;
  }

  if (options.local) {
    return false;
  }

  const scope = await select({
    message: "Where should agents be updated?",
    options: [
      { value: "local" as const, label: "Project (local)", hint: "recommended" },
      { value: "global" as const, label: "Global (user-level)" },
    ],
    initialValue: "local" as const,
  });

  if (isCancel(scope)) {
    cancel("Update cancelled.");
    process.exit(0);
  }

  return scope === "global";
}

async function promptAgentsToUpdate(
  agents: Record<string, InstalledAgent>,
  action: "update" | "check",
  requestedPlatform?: Platform,
): Promise<string[]> {
  const selectableAgents = Object.entries(agents)
    .filter(([, entry]) => !requestedPlatform || entry.platforms.includes(requestedPlatform))
    .sort(([left], [right]) => left.localeCompare(right));

  if (selectableAgents.length === 0) {
    return [];
  }

  const selected = await multiselect({
    message: action === "check"
      ? "Which agents should be checked?"
      : "Which agents should be updated?",
    options: selectableAgents.map(([name, entry]) => ({
      value: name,
      label: name,
      hint: requestedPlatform
        ? `installed for ${requestedPlatform}`
        : entry.platforms.join(", "),
    })),
    initialValues: selectableAgents.map(([name]) => name),
    required: false,
  });

  if (isCancel(selected)) {
    cancel("Update cancelled.");
    process.exit(0);
  }

  return selected as string[];
}

export async function updateCommand(
  name?: string,
  options?: UpdateOptions,
): Promise<void> {
  try {
    const projectRoot = findProjectRoot();
    const selectedModes = [options?.local, options?.global].filter(Boolean).length;
    if (selectedModes > 1) {
      log.error("Use only one of --local or --global");
      process.exit(1);
    }

    const requestedPlatform = options?.platform as Platform | undefined;
    const checkOnly = options?.check ?? false;

    if (requestedPlatform && !getAdapter(requestedPlatform)) {
      log.error(`Unknown platform: ${options?.platform}`);
      process.exit(1);
    }

    const isGlobal = name
      ? options?.global ?? false
      : await promptScope(options ?? {});

    const lockFile = await readLockFile(isGlobal, projectRoot);
    const allAgents = lockFile.agents;

    let agentsToUpdate: [string, InstalledAgent][];

    if (name) {
      const entry = allAgents[name];
      if (!entry) {
        log.error(`Agent '${name}' is not installed`);
        process.exit(1);
      }
      agentsToUpdate = [[name, entry]];
    } else {
      const selectedNames = await promptAgentsToUpdate(
        allAgents,
        checkOnly ? "check" : "update",
        requestedPlatform,
      );

      if (selectedNames.length === 0) {
        const scopeLabel = isGlobal ? "global" : "project";
        if (requestedPlatform) {
          log.info(`No agents installed for ${requestedPlatform} in ${scopeLabel} scope.`);
          return;
        }

        if (Object.keys(allAgents).length === 0) {
          log.info(`No agents installed in ${scopeLabel} scope.`);
          return;
        }

        log.info("No agents selected.");
        return;
      }

      agentsToUpdate = selectedNames
        .map((selectedName) => {
          const entry = allAgents[selectedName];
          return entry ? [selectedName, entry] as [string, InstalledAgent] : undefined;
        })
        .filter((value): value is [string, InstalledAgent] => value !== undefined);
    }

    let updatedCount = 0;
    let upToDateCount = 0;
    let updateAvailableCount = 0;
    let couldNotCheckCount = 0;

    for (const [agentName, entry] of agentsToUpdate) {
      if (requestedPlatform && !entry.platforms.includes(requestedPlatform)) {
        const platformMessage = `${agentName} is not installed for ${requestedPlatform}`;

        if (checkOnly) {
          log.warn(`${platformMessage}; could not be checked`);
          couldNotCheckCount++;
        } else {
          log.warn(`  ${platformMessage}, skipping`);
        }

        continue;
      }

      try {
        const comparison = await compareInstalledAgent(entry, requestedPlatform);

        if (comparison.alreadyCurrent) {
          log.info(
            checkOnly
              ? `${agentName} is up to date`
              : `No update available for '${agentName}'.`,
          );
          upToDateCount++;
          continue;
        }

        if (checkOnly) {
          log.warn(`${agentName} has an update available`);
          updateAvailableCount++;
          continue;
        }

        for (const platform of comparison.targetPlatforms) {
          const adapter = getAdapter(platform);
          if (!adapter) {
            log.warn(`No adapter found for ${platform}, skipping`);
            continue;
          }

          await adapter.install({
            agent: comparison.agent,
            projectDir: projectRoot,
            global: isGlobal,
          });
        }

        // Update lock file entry
        const nextPlatformHashes = getStoredPlatformHashes(entry);
        for (const platform of comparison.targetPlatforms) {
          nextPlatformHashes[platform] = comparison.newHash;
        }

        lockFile.agents[agentName] = {
          ...entry,
          hash: areAllInstalledPlatformsCurrent(entry.platforms, nextPlatformHashes, comparison.newHash)
            ? comparison.newHash
            : entry.hash,
          installedAt: new Date().toISOString(),
          platforms: entry.platforms,
          platformHashes: nextPlatformHashes,
        };

        log.success(`  ${agentName} updated`);
        updatedCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (checkOnly) {
          log.error(`${agentName} could not be checked: ${message}`);
          couldNotCheckCount++;
          continue;
        }

        log.error(`  Failed to update ${agentName}: ${message}`);
      }
    }

    if (checkOnly) {
      log.info(
        `Checked ${agentsToUpdate.length} agent(s): ${upToDateCount} up to date, ${updateAvailableCount} update available, ${couldNotCheckCount} could not be checked`,
      );
      return;
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
