import { getAgent, removeAgent } from "../core/registry.js";
import { log } from "../utils/logger.js";
import { findProjectRoot } from "../utils/paths.js";
import opencodeAdapter from "../adapters/opencode.js";
import claudeCodeAdapter from "../adapters/claude-code.js";
import codexAdapter from "../adapters/codex.js";
import kiroAdapter from "../adapters/kiro.js";
import type { Adapter, ToolTarget } from "../types.js";

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

const adapters: Adapter[] = [opencodeAdapter, claudeCodeAdapter, codexAdapter, kiroAdapter];

function getAdapter(name: ToolTarget): Adapter | undefined {
  return adapters.find((a) => a.name === name);
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function removeCommand(name: string): Promise<void> {
  try {
    const projectRoot = findProjectRoot();

    // Look up agent in project scope first, then global
    const projectAgent = await getAgent(name, false, projectRoot);
    const globalAgent = await getAgent(name, true);

    const isGlobal = !projectAgent && !!globalAgent;
    const agent = projectAgent ?? globalAgent;

    if (!agent) {
      log.error(`Agent '${name}' is not installed`);
      process.exit(1);
    }

    // Uninstall from each tool adapter
    for (const tool of agent.installedFor) {
      const adapter = getAdapter(tool);
      if (!adapter) {
        log.warn(`No adapter found for ${tool}, skipping`);
        continue;
      }

      try {
        await adapter.uninstall(name, projectRoot, isGlobal);
        log.success(`Removed from ${tool}`);
      } catch (err) {
        log.warn(
          `Failed to remove from ${tool}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Remove from lock file
    await removeAgent(name, isGlobal, projectRoot);

    log.success(`Agent '${name}' removed`);
  } catch (err) {
    log.error(
      err instanceof Error ? err.message : `Failed to remove agent: ${String(err)}`,
    );
    process.exit(1);
  }
}
