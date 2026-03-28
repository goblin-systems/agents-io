import { fetchAgent } from "../core/fetch.js";
import { hashContent, addAgent } from "../core/registry.js";
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

export interface AddOptions {
  tool?: string;
  global?: boolean;
  path?: string;
}

export async function addCommand(
  source: string,
  options: AddOptions,
): Promise<void> {
  try {
    // 1. Fetch agent
    log.info(`Fetching agent from ${source}...`);
    const agent = await fetchAgent(source, { path: options.path });
    const { name, description } = agent.frontmatter;

    log.info(`Found agent: ${name} — ${description}`);

    // 2. Determine project root
    const projectRoot = findProjectRoot();
    const isGlobal = options.global ?? false;

    // 3. Determine target adapters
    let targets: Adapter[];

    if (options.tool) {
      const adapter = getAdapter(options.tool as ToolTarget);
      if (!adapter) {
        log.error(`Unknown tool: ${options.tool}`);
        process.exit(1);
      }
      targets = [adapter];
    } else {
      // Auto-detect which tools are present
      const detected: Adapter[] = [];
      for (const adapter of adapters) {
        if (await adapter.detect(projectRoot)) {
          detected.push(adapter);
        }
      }
      // Default to opencode if nothing detected
      targets = detected.length > 0 ? detected : [opencodeAdapter];
    }

    // 4. Install for each target
    const targetNames: ToolTarget[] = [];

    for (const adapter of targets) {
      log.info(`Installing for ${adapter.name}...`);
      await adapter.install({
        agent,
        projectDir: projectRoot,
        global: isGlobal,
      });
      targetNames.push(adapter.name);
      log.success(`Installed for ${adapter.name}`);
    }

    // 5. Register in lock file
    await addAgent(
      name,
      {
        source,
        sourceUrl: `https://github.com/${source}`,
        agentPath: options.path ?? "",
        installedAt: new Date().toISOString(),
        installedFor: targetNames,
        hash: hashContent(agent.raw),
      },
      isGlobal,
      projectRoot,
    );

    log.success(`Agent ${name} installed successfully`);
  } catch (err) {
    log.error(
      err instanceof Error ? err.message : `Failed to add agent: ${String(err)}`,
    );
    process.exit(1);
  }
}
