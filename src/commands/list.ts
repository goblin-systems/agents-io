import chalk from "chalk";
import { listAgents } from "../core/registry.js";
import { log } from "../utils/logger.js";
import { findProjectRoot } from "../utils/paths.js";

export async function listCommand(): Promise<void> {
  try {
    const projectRoot = findProjectRoot();

    const projectAgents = await listAgents(false, projectRoot);
    const globalAgents = await listAgents(true);

    const projectEntries = Object.entries(projectAgents);
    const globalEntries = Object.entries(globalAgents);

    if (projectEntries.length === 0 && globalEntries.length === 0) {
      log.info("No agents installed");
      return;
    }

    if (projectEntries.length > 0) {
      log.info("Project agents:");
      for (const [name, agent] of projectEntries) {
        const tools = chalk.dim(`(${agent.installedFor.join(", ")})`);
        log.dim(`  ${chalk.bold(name)} — ${agent.source} ${tools}`);
      }
    }

    if (globalEntries.length > 0) {
      log.info("Global agents:");
      for (const [name, agent] of globalEntries) {
        const tools = chalk.dim(`(${agent.installedFor.join(", ")})`);
        log.dim(`  ${chalk.bold(name)} — ${agent.source} ${tools}`);
      }
    }
  } catch (err) {
    log.error(
      err instanceof Error ? err.message : `Failed to list agents: ${String(err)}`,
    );
    process.exit(1);
  }
}
