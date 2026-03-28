import matter from "gray-matter";
import { readFile } from "fs/promises";
import type { ParsedAgent, AgentFrontmatter } from "../types.js";

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Parse an agent.md string into a ParsedAgent. */
export function parseAgentFile(content: string): ParsedAgent {
  const { data, content: body } = matter(content);
  const fm = data as Record<string, unknown>;

  // Validate name
  if (!fm.name || typeof fm.name !== "string") {
    throw new Error("Agent frontmatter is missing required field: name");
  }
  if (!KEBAB_CASE_RE.test(fm.name)) {
    throw new Error(
      `Invalid agent name "${fm.name}". Must be kebab-case (lowercase letters, numbers, and hyphens).`,
    );
  }

  // Validate description
  if (!fm.description || typeof fm.description !== "string") {
    throw new Error(
      "Agent frontmatter is missing required field: description",
    );
  }

  // Validate mode
  if (fm.mode !== undefined) {
    if (fm.mode !== "primary" && fm.mode !== "subagent") {
      throw new Error(
        `Invalid agent mode "${fm.mode}". Must be "primary" or "subagent".`,
      );
    }
  }

  // Validate tools
  if (fm.tools !== undefined) {
    if (typeof fm.tools !== "object" || fm.tools === null || Array.isArray(fm.tools)) {
      throw new Error("Agent tools must be a mapping of tool names to booleans.");
    }
    for (const [key, value] of Object.entries(fm.tools as Record<string, unknown>)) {
      if (typeof value !== "boolean") {
        throw new Error(
          `Invalid value for tool "${key}". Expected boolean, got ${typeof value}.`,
        );
      }
    }
  }

  // Validate body
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    throw new Error("Agent file has no body content. A system prompt is required.");
  }

  return {
    frontmatter: data as AgentFrontmatter,
    body: trimmedBody,
    raw: content,
  };
}

/** Read an agent.md file from disk and parse it. */
export async function parseAgentFromPath(filePath: string): Promise<ParsedAgent> {
  const content = await readFile(filePath, "utf-8");
  return parseAgentFile(content);
}
