import { mkdir, readFile, writeFile, unlink, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { Adapter, AdapterContext } from "../types.js";

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

/** Title-case a string (first letter of every word upper-cased). */
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
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
  return global ? join(homedir(), ".claude") : join(projectDir, ".claude");
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

/** Format the markdown file content for a Claude Code agent. */
function formatAgentMarkdown(
  name: string,
  description: string,
  body: string,
): string {
  const lines: string[] = [
    `# ${titleCase(name)}`,
    "",
    description,
    "",
    "---",
    "",
    body,
  ];

  return lines.join("\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

async function detect(projectDir: string): Promise<boolean> {
  const projectClaudeDir = join(projectDir, ".claude");
  const globalClaudeDir = join(homedir(), ".claude");

  const [projectExists, globalExists] = await Promise.all([
    exists(projectClaudeDir),
    exists(globalClaudeDir),
  ]);

  return projectExists || globalExists;
}

async function install(ctx: AdapterContext): Promise<void> {
  const { agent, projectDir, global: isGlobal } = ctx;
  const { frontmatter, body } = agent;
  const name = frontmatter.name;

  const claudeDir = resolveClaudeDir(projectDir, isGlobal);
  const agentsDir = join(claudeDir, "agents");
  const agentFile = join(agentsDir, `${name}.md`);
  const settingsFile = join(claudeDir, "settings.json");

  // 1. Ensure agents directory exists
  await mkdir(agentsDir, { recursive: true });

  // 2. Write the agent markdown (no YAML frontmatter)
  const content = formatAgentMarkdown(name, frontmatter.description, body);
  await writeFile(agentFile, content, "utf-8");

  // 3. Build the settings entry
  const relativePath = `.claude/agents/${name}.md`;

  const entry: AgentEntry = {
    description: frontmatter.description,
    prompt: relativePath,
  };

  // Resolve permissions: explicit claude-code override takes priority
  const explicit = frontmatter["claude-code"]?.permissions;

  if (explicit) {
    entry.permissions = {};
    if (explicit.allow?.length) entry.permissions.allow = explicit.allow;
    if (explicit.deny?.length) entry.permissions.deny = explicit.deny;
  } else if (frontmatter.tools && Object.keys(frontmatter.tools).length > 0) {
    const derived = derivePermissions(frontmatter.tools);
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
