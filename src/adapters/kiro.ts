import { mkdir, readFile, writeFile, unlink, readdir, rmdir, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { Adapter, AdapterContext } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the `.kiro` directory for the given scope. */
function resolveKiroDir(projectDir: string, global: boolean): string {
  return global ? join(homedir(), ".kiro") : join(projectDir, ".kiro");
}

/** Map the generic OpenCode `tools` record to Kiro tool names. */
function deriveTools(tools: Record<string, boolean>): string[] {
  const result = new Set<string>();

  for (const [tool, enabled] of Object.entries(tools)) {
    if (!enabled) continue;

    switch (tool) {
      case "read":
      case "glob":
      case "grep":
        result.add("read");
        break;
      case "write":
      case "edit":
        result.add("write");
        break;
      case "bash":
        result.add("shell");
        break;
    }
  }

  return result.size > 0 ? [...result] : ["read", "write", "shell"];
}

// ---------------------------------------------------------------------------
// Agent JSON shape
// ---------------------------------------------------------------------------

interface KiroAgentJson {
  name: string;
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
  allowedTools?: string[];
  hooks?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

async function detect(projectDir: string): Promise<boolean> {
  const [hasProjectKiro, hasGlobalKiro] = await Promise.all([
    exists(join(projectDir, ".kiro")),
    exists(join(homedir(), ".kiro")),
  ]);

  return hasProjectKiro || hasGlobalKiro;
}

async function install(ctx: AdapterContext): Promise<void> {
  const { agent, projectDir, global: isGlobal } = ctx;
  const { frontmatter, body } = agent;
  const name = frontmatter.name;

  const kiroDir = resolveKiroDir(projectDir, isGlobal);
  const agentsDir = join(kiroDir, "agents");
  const agentFile = join(agentsDir, `${name}.json`);

  // Ensure agents directory exists
  await mkdir(agentsDir, { recursive: true });

  // Build the agent JSON
  const data: KiroAgentJson = {
    name,
    description: frontmatter.description,
    prompt: body,
  };

  // Resolve tools and kiro-specific overrides
  const kiroOverride = frontmatter.kiro;

  if (kiroOverride) {
    if (kiroOverride.model) data.model = kiroOverride.model;
    if (kiroOverride.tools) data.tools = kiroOverride.tools;
    if (kiroOverride.allowedTools) data.allowedTools = kiroOverride.allowedTools;
    if (kiroOverride.hooks) data.hooks = kiroOverride.hooks;
  }

  // If no explicit kiro tools override, derive from generic tools map
  if (!data.tools) {
    data.tools =
      frontmatter.tools && Object.keys(frontmatter.tools).length > 0
        ? deriveTools(frontmatter.tools)
        : ["read", "write", "shell"];
  }

  await writeFile(agentFile, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

async function uninstall(
  name: string,
  projectDir: string,
  isGlobal: boolean,
): Promise<void> {
  const kiroDir = resolveKiroDir(projectDir, isGlobal);
  const agentsDir = join(kiroDir, "agents");
  const agentFile = join(agentsDir, `${name}.json`);

  // Remove the agent file
  if (await exists(agentFile)) {
    await unlink(agentFile);
  }

  // Clean up empty agents directory
  try {
    const entries = await readdir(agentsDir);
    if (entries.length === 0) {
      await rmdir(agentsDir);
    }
  } catch {
    // Directory may not exist — that's fine
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const kiroAdapter: Adapter = { name: "kiro", detect, install, uninstall };
export default kiroAdapter;
