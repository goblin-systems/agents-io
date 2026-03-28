import { readFile, writeFile, unlink, access } from "fs/promises";
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

function startTag(name: string): string {
  return `<!-- agnts:${name}:start -->`;
}

function endTag(name: string): string {
  return `<!-- agnts:${name}:end -->`;
}

/** Title-case a string (first letter of every word upper-cased). */
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build the delimited markdown section for an agent. */
function buildSection(
  name: string,
  description: string,
  body: string,
): string {
  const lines: string[] = [
    startTag(name),
    `## ${titleCase(name)}`,
    "",
    description,
    "",
    body.trimEnd(),
    endTag(name),
  ];

  return lines.join("\n");
}

/** Remove a named agent section from the file content, including trailing blank lines. */
function removeSection(content: string, name: string): string {
  const start = startTag(name);
  const end = endTag(name);

  const startIdx = content.indexOf(start);
  if (startIdx === -1) return content;

  const endIdx = content.indexOf(end, startIdx);
  if (endIdx === -1) return content;

  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + end.length);

  // Strip leading newlines from `after` to avoid stacking blank lines
  const trimmedAfter = after.replace(/^\n+/, "");

  return (before + trimmedAfter).trimEnd();
}

/** Resolve target directory based on scope. */
function resolveTargetDir(projectDir: string, global: boolean): string {
  return global ? join(homedir(), ".codex") : projectDir;
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

async function detect(projectDir: string): Promise<boolean> {
  const [hasAgentsMd, hasCodexDir, hasGlobalCodex] = await Promise.all([
    exists(join(projectDir, "AGENTS.md")),
    exists(join(projectDir, ".codex")),
    exists(join(homedir(), ".codex")),
  ]);

  return hasAgentsMd || hasCodexDir || hasGlobalCodex;
}

async function install(ctx: AdapterContext): Promise<void> {
  const { agent, projectDir, global: isGlobal } = ctx;
  const { frontmatter, body } = agent;
  const name = frontmatter.name;

  const targetDir = resolveTargetDir(projectDir, isGlobal);
  const agentsMdPath = join(targetDir, "AGENTS.md");

  // Read existing content
  let content = "";
  try {
    content = await readFile(agentsMdPath, "utf-8");
  } catch {
    // File doesn't exist yet — start fresh
  }

  // If a section for this agent already exists, remove it first
  if (content.includes(startTag(name))) {
    content = removeSection(content, name);
  }

  // Build new section
  const section = buildSection(name, frontmatter.description, body);

  // Append — separate from existing content with a blank line
  const trimmed = content.trimEnd();
  const result = trimmed.length > 0 ? `${trimmed}\n\n${section}\n` : `${section}\n`;

  await writeFile(agentsMdPath, result, "utf-8");
}

async function uninstall(
  name: string,
  projectDir: string,
  isGlobal: boolean,
): Promise<void> {
  const targetDir = resolveTargetDir(projectDir, isGlobal);
  const agentsMdPath = join(targetDir, "AGENTS.md");

  if (!(await exists(agentsMdPath))) return;

  const content = await readFile(agentsMdPath, "utf-8");
  const updated = removeSection(content, name);

  // If file is now empty or whitespace-only, delete it
  if (updated.trim().length === 0) {
    await unlink(agentsMdPath);
  } else {
    await writeFile(agentsMdPath, updated.trimEnd() + "\n", "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const codexAdapter: Adapter = { name: "codex", detect, install, uninstall };
export default codexAdapter;
