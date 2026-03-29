import { mkdir, readFile, writeFile, unlink, access } from "fs/promises";
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

/** Map the generic `tools` record to Claude Code permission lists. */
function derivePermissions(
  tools: Record<string, boolean>,
): { allow: string[]; deny: string[] } {
  const allow: string[] = [];
  const deny: string[] = [];

  for (const [tool, enabled] of Object.entries(tools)) {
    const mapped = capFirst(tool);
    if (enabled) {
      allow.push(mapped);
    } else {
      deny.push(mapped);
    }
  }

  return { allow, deny };
}

/** Resolve the `.claude` directory for the given scope. */
function resolveClaudeDir(projectDir: string, global: boolean): string {
  return global ? getGlobalDir("claude-code") : join(projectDir, ".claude");
}

/** Safely read & parse a JSON file, returning a fallback on any error. */
async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

interface AgentEntry {
  description: string;
  prompt: string;
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

interface ClaudeSettings {
  agents?: Record<string, AgentEntry>;
  [key: string]: unknown;
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
  const settingsFile = join(claudeDir, "settings.json");

  // 1. Ensure agents directory exists
  await mkdir(agentsDir, { recursive: true });

  // 2. Write the agent markdown with native YAML frontmatter
  const content = formatAgentMarkdown(agent);
  await writeFile(agentFile, content, "utf-8");

  // 3. Build the settings entry (permissions only)
  const relativePath = `.claude/agents/${name}.md`;

  const entry: AgentEntry = {
    description: agent.frontmatter.description,
    prompt: relativePath,
  };

  // Resolve permissions: explicit claude-code override takes priority
  const explicit = agent.frontmatter["claude-code"]?.permissions;

  if (explicit) {
    entry.permissions = {};
    if (explicit.allow?.length) entry.permissions.allow = explicit.allow;
    if (explicit.deny?.length) entry.permissions.deny = explicit.deny;
  } else if (agent.frontmatter.tools && Object.keys(agent.frontmatter.tools).length > 0) {
    const derived = derivePermissions(agent.frontmatter.tools);
    entry.permissions = {};
    if (derived.allow.length) entry.permissions.allow = derived.allow;
    if (derived.deny.length) entry.permissions.deny = derived.deny;
  }

  // Clean up empty permissions object
  if (entry.permissions && !entry.permissions.allow && !entry.permissions.deny) {
    delete entry.permissions;
  }

  // 4. Merge into settings.json
  const settings = await readJson<ClaudeSettings>(settingsFile, {});
  settings.agents = settings.agents ?? {};
  settings.agents[name] = entry;

  await writeFile(settingsFile, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

async function uninstall(
  name: string,
  projectDir: string,
  isGlobal: boolean,
): Promise<void> {
  const claudeDir = resolveClaudeDir(projectDir, isGlobal);
  const agentFile = join(claudeDir, "agents", `${name}.md`);
  const settingsFile = join(claudeDir, "settings.json");

  // 1. Remove the agent markdown file
  if (await exists(agentFile)) {
    await unlink(agentFile);
  }

  // 2. Remove the agent entry from settings.json
  if (await exists(settingsFile)) {
    const settings = await readJson<ClaudeSettings>(settingsFile, {});

    if (settings.agents?.[name]) {
      delete settings.agents[name];

      // Clean up empty agents object
      if (Object.keys(settings.agents).length === 0) {
        delete settings.agents;
      }

      await writeFile(settingsFile, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    }
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
