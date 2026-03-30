import { cancel, isCancel, multiselect, select } from "@clack/prompts";
import {
  areAllInstalledPlatformsCurrent,
  fetchLockEntryAgent,
  getAdapter,
  getStoredPlatformHashes,
} from "../core/lock-entry.js";
import { readLockFile, writeLockFile } from "../core/registry.js";
import { log } from "../utils/logger.js";
import { findProjectRoot } from "../utils/paths.js";
import type { GitHubRef, InstalledAgent, ParsedAgent, Platform } from "../types.js";

interface ComparedAgent {
  agent: ParsedAgent;
  newHash: string;
  targetPlatforms: Platform[];
  alreadyCurrent: boolean;
  githubRef?: GitHubRef;
}

async function compareInstalledAgent(
  entry: InstalledAgent,
  requestedPlatform?: Platform,
): Promise<ComparedAgent> {
  const result = await fetchLockEntryAgent(entry, "update");
  const newHash = result.hash;
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
    githubRef: result.githubRef,
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
          log.detail(`No agents installed for ${requestedPlatform} in ${scopeLabel} scope.`);
          return;
        }

        if (Object.keys(allAgents).length === 0) {
          log.detail(`No agents installed in ${scopeLabel} scope.`);
          return;
        }

        log.detail("No agents selected.");
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

    log.progress(checkOnly ? "Checking agents" : "Updating agents");
    log.detail(`scope: ${isGlobal ? "global" : "project"}`);
    if (requestedPlatform) {
      log.detail(`platform: ${requestedPlatform}`);
    }
    log.detail(agentsToUpdate.map(([agentName]) => agentName).join(", "));
    log.spacer();

    for (const [agentName, entry] of agentsToUpdate) {
      if (agentName !== agentsToUpdate[0]?.[0]) {
        log.spacer();
      }

      if (requestedPlatform && !entry.platforms.includes(requestedPlatform)) {
        const platformMessage = `${agentName} is not installed for ${requestedPlatform}`;

        if (checkOnly) {
          log.warn(`${platformMessage}; could not be checked`);
          couldNotCheckCount++;
        } else {
          log.warn(`${platformMessage}, skipping`);
        }

        continue;
      }

      try {
        const comparison = await compareInstalledAgent(entry, requestedPlatform);

        if (comparison.alreadyCurrent) {
          log.detail(
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

        log.sync(`Applying update for ${agentName}`);
        log.detail(comparison.targetPlatforms.join(", "));

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
          githubRef: comparison.githubRef ?? entry.githubRef,
        };

        log.success(`${agentName} updated`);
        updatedCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (checkOnly) {
          log.error(`${agentName} could not be checked: ${message}`);
          couldNotCheckCount++;
          continue;
        }

        log.error(`Failed to update ${agentName}: ${message}`);
      }
    }

    if (checkOnly) {
      log.spacer();
      log.success("Check complete");
      log.detail(
        `Checked ${agentsToUpdate.length} agent(s): ${upToDateCount} up to date, ${updateAvailableCount} update available, ${couldNotCheckCount} could not be checked`,
      );
      return;
    }

    // Write updated lock file once
    await writeLockFile(lockFile, isGlobal, projectRoot);

    log.spacer();
    log.success("Update complete");
    log.detail(`${updatedCount} agent(s) updated, ${upToDateCount} already up to date`);
  } catch (err) {
    log.error(
      err instanceof Error
        ? err.message
        : `Failed to update agents: ${String(err)}`,
    );
    process.exit(1);
  }
}
