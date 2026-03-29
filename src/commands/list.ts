import {
  getAgentRegistryStatus,
  listAgents,
  readLockFileDetails,
} from "../core/registry.js";
import type { InstalledAgent } from "../types.js";
import { log } from "../utils/logger.js";
import { findProjectRoot } from "../utils/paths.js";

export interface ListOptions {
  verbose?: boolean;
}

function formatSourceLabel(agent: InstalledAgent): string {
  return agent.sourceType === "local"
    ? `${agent.sourceUrl} (local)`
    : agent.source;
}

function logAgentLine(name: string, agent: InstalledAgent, verbose: boolean): void {
  const platforms = `(${agent.platforms.join(", ")})`;
  const sourceLabel = formatSourceLabel(agent);

  if (!verbose) {
    log.dim(`  ${name} — ${sourceLabel} ${platforms}`);
    return;
  }

  const status = `[${getAgentRegistryStatus(agent)}]`;
  log.dim(`  ${name} ${status} — ${sourceLabel} ${platforms}`);
}

async function logScope(scopeLabel: string, global: boolean, projectRoot: string): Promise<number> {
  const details = await readLockFileDetails(global, projectRoot);
  const entries = Object.entries(details.lockFile.agents);

  log.info(`${scopeLabel}:`);
  log.dim(`  state: ${details.exists ? "present" : "missing"}`);
  log.dim(`  lock file: ${details.path}`);

  if (entries.length === 0) {
    log.dim("  no agents installed");
    return 0;
  }

  for (const [name, agent] of entries) {
    logAgentLine(name, agent, true);
  }

  return entries.length;
}

export async function listCommand(options: ListOptions = {}): Promise<void> {
  try {
    const projectRoot = findProjectRoot();

    const projectAgents = await listAgents(false, projectRoot);
    const globalAgents = await listAgents(true);

    const projectEntries = Object.entries(projectAgents);
    const globalEntries = Object.entries(globalAgents);

    if (projectEntries.length === 0 && globalEntries.length === 0) {
      if (options.verbose) {
        await logScope("Project agents", false, projectRoot);
        await logScope("Global agents", true, projectRoot);
        return;
      }

      log.info("No agents installed");
      return;
    }

    if (options.verbose) {
      await logScope("Project agents", false, projectRoot);
      await logScope("Global agents", true, projectRoot);
      return;
    }

    if (projectEntries.length > 0) {
      log.info("Project agents:");
      for (const [name, agent] of projectEntries) {
        logAgentLine(name, agent, false);
      }
    }

    if (globalEntries.length > 0) {
      log.info("Global agents:");
      for (const [name, agent] of globalEntries) {
        logAgentLine(name, agent, false);
      }
    }
  } catch (err) {
    log.error(
      err instanceof Error ? err.message : `Failed to list agents: ${String(err)}`,
    );
    process.exit(1);
  }
}
