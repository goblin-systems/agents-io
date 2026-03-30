import { mkdir, readFile, writeFile, unlink, readdir, rmdir, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { deriveKiroTools } from "../core/platform-compatibility.js";
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

  // Resolve tools and kiro-specific overrides (frontmatter first, then settings)
  const kiroFmOverride = frontmatter.kiro;
  const kiroSettingsOverride = agent.settings?.kiro as Record<string, unknown> | undefined;

  if (kiroFmOverride) {
    if (kiroFmOverride.model) data.model = kiroFmOverride.model;
    if (kiroFmOverride.tools) data.tools = kiroFmOverride.tools;
    if (kiroFmOverride.allowedTools) data.allowedTools = kiroFmOverride.allowedTools;
    if (kiroFmOverride.hooks) data.hooks = kiroFmOverride.hooks;
  }

  // Settings overrides take precedence over frontmatter overrides
  if (kiroSettingsOverride) {
    if (kiroSettingsOverride.model) data.model = kiroSettingsOverride.model as string;
    if (kiroSettingsOverride.tools) data.tools = kiroSettingsOverride.tools as string[];
    if (kiroSettingsOverride.allowedTools) data.allowedTools = kiroSettingsOverride.allowedTools as string[];
    if (kiroSettingsOverride.hooks) data.hooks = kiroSettingsOverride.hooks as Record<string, unknown>;
  }

  // Model from top-level settings as fallback (if not set by kiro-specific overrides)
  if (!data.model && agent.settings?.model) {
    data.model = agent.settings.model;
  }

  // If no explicit kiro tools override, derive from generic tools map
  if (!data.tools) {
    const derivedTools = frontmatter.tools && Object.keys(frontmatter.tools).length > 0
      ? deriveKiroTools(frontmatter.tools)
      : [];

    data.tools = derivedTools.length > 0 ? derivedTools : ["read", "write", "shell"];
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
