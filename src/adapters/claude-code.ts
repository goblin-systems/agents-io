import { mkdir, writeFile, unlink, access } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import type { Adapter, AdapterContext, ParsedAgent } from "../types.js";
import { getGlobalDir } from "../utils/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check whether a path exists on disk. */
async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Capitalise only the first letter of a string. */
function capFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Resolve the `.claude` directory for the given scope. */
function resolveClaudeDir(projectDir: string, global: boolean): string {
  return global ? getGlobalDir("claude-code") : join(projectDir, ".claude");
}

/** Format the markdown file content for a Claude Code agent with native frontmatter. */
function formatAgentMarkdown(
  agent: ParsedAgent,
): string {
  const fm = agent.frontmatter;
  const settings = agent.settings;

  // Build Claude Code native frontmatter
  const data: Record<string, unknown> = {
    name: fm.name,
    description: fm.description,
  };

  // Map tools to Claude Code format (comma-separated string of capitalized tool names)
  if (fm.tools && Object.keys(fm.tools).length > 0) {
    const allowed = Object.entries(fm.tools)
      .filter(([, v]) => v)
      .map(([k]) => capFirst(k));
    if (allowed.length > 0) {
      data.tools = allowed.join(", ");
    }
  }

  // Add model if available
  const ccOverrides = settings?.["claude-code"] as Record<string, unknown> | undefined;
  const model = ccOverrides?.model ?? settings?.model ?? fm.model;
  if (model) data.model = model;

  // Merge claude-code specific overrides from settings (except model, already handled)
  if (ccOverrides) {
    for (const [key, value] of Object.entries(ccOverrides)) {
      if (key !== "model" && key !== "permissions") {
        data[key] = value;
      }
    }
  }

  // Write as markdown with frontmatter using gray-matter
  const markdown = matter.stringify("\n" + agent.body + "\n", data);
  return markdown;
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

async function detect(projectDir: string): Promise<boolean> {
  const projectClaudeDir = join(projectDir, ".claude");
  const globalClaudeDir = getGlobalDir("claude-code");

  const [projectExists, globalExists] = await Promise.all([
    exists(projectClaudeDir),
    exists(globalClaudeDir),
  ]);

  return projectExists || globalExists;
}

async function install(ctx: AdapterContext): Promise<void> {
  const { agent, projectDir, global: isGlobal } = ctx;
  const name = agent.frontmatter.name;

  const claudeDir = resolveClaudeDir(projectDir, isGlobal);
  const agentsDir = join(claudeDir, "agents");
  const agentFile = join(agentsDir, `${name}.md`);

  await mkdir(agentsDir, { recursive: true });

  const content = formatAgentMarkdown(agent);
  await writeFile(agentFile, content, "utf-8");
}

async function uninstall(
  name: string,
  projectDir: string,
  isGlobal: boolean,
): Promise<void> {
  const claudeDir = resolveClaudeDir(projectDir, isGlobal);
  const agentFile = join(claudeDir, "agents", `${name}.md`);

  if (await exists(agentFile)) {
    await unlink(agentFile);
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const claudeCodeAdapter: Adapter = {
  name: "claude-code",
  detect,
  install,
  uninstall,
};

export default claudeCodeAdapter;
