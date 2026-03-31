import { mkdir, writeFile, unlink, readdir, rmdir, access } from "fs/promises";
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

/** Resolve the `.codex` directory for the given scope. */
function resolveCodexDir(projectDir: string, global: boolean): string {
  return global ? join(homedir(), ".codex") : join(projectDir, ".codex");
}

// ---------------------------------------------------------------------------
// TOML generation
// ---------------------------------------------------------------------------

/** Escape a single-line TOML string value (for name, description). */
function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Escape content for a TOML multi-line basic string (triple-quoted).
 * The only sequence that needs escaping inside `"""..."""` is a literal
 * run of three or more consecutive double-quotes — we break it up by
 * inserting a backslash-escaped quote.
 */
function escapeTomlMultiline(value: string): string {
  // Replace every occurrence of """ with ""\", which TOML interprets as
  // two literal quotes followed by an escaped quote.
  return value.replace(/"""/g, '""\\\"');
}

/** Build the TOML content for an agent file. */
function buildToml(name: string, description: string, body: string): string {
  const lines: string[] = [
    `name = "${escapeTomlString(name)}"`,
    `description = "${escapeTomlString(description)}"`,
    `developer_instructions = """`,
    `${escapeTomlMultiline(body.trimEnd())}`,
    `"""`,
    "", // trailing newline
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

async function detect(projectDir: string): Promise<boolean> {
  const [hasProjectCodex, hasGlobalCodex] = await Promise.all([
    exists(join(projectDir, ".codex")),
    exists(join(homedir(), ".codex")),
  ]);

  return hasProjectCodex || hasGlobalCodex;
}

async function install(ctx: AdapterContext): Promise<void> {
  const { agent, projectDir, global: isGlobal } = ctx;
  const { frontmatter, body } = agent;
  const name = frontmatter.name;

  const codexDir = resolveCodexDir(projectDir, isGlobal);
  const agentsDir = join(codexDir, "agents");
  const agentFile = join(agentsDir, `${name}.toml`);

  // Ensure agents directory exists
  await mkdir(agentsDir, { recursive: true });

  // Build and write the TOML file
  const toml = buildToml(name, frontmatter.description, body);
  await writeFile(agentFile, toml, "utf-8");
}

async function uninstall(
  name: string,
  projectDir: string,
  isGlobal: boolean,
): Promise<void> {
  const codexDir = resolveCodexDir(projectDir, isGlobal);
  const agentsDir = join(codexDir, "agents");
  const agentFile = join(agentsDir, `${name}.toml`);

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

const codexAdapter: Adapter = { name: "codex", detect, install, uninstall };
export default codexAdapter;
