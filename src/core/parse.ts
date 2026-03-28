import matter from "gray-matter";
import { readFile } from "fs/promises";
import type { ParsedAgent, AgentFrontmatter, AgentSettings } from "../types.js";

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const NAMED_COLORS = new Set([
  "primary",
  "secondary",
  "accent",
  "success",
  "warning",
  "error",
  "info",
]);

/** Parse an agent.md string into a ParsedAgent. */
export function parseAgentFile(content: string, settings?: AgentSettings): ParsedAgent {
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

  // Validate color (from frontmatter)
  if (fm.color !== undefined) {
    if (typeof fm.color !== "string") {
      throw new Error("Agent color must be a string.");
    }
    if (!HEX_COLOR_RE.test(fm.color) && !NAMED_COLORS.has(fm.color)) {
      throw new Error(
        `Invalid agent color "${fm.color}". Must be a hex color (#RGB or #RRGGBB) or one of: ${[...NAMED_COLORS].join(", ")}.`,
      );
    }
  }

  // Validate model (from frontmatter)
  if (fm.model !== undefined) {
    if (typeof fm.model !== "string" || fm.model.trim() === "") {
      throw new Error("Agent model must be a non-empty string.");
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
    settings: settings ?? {},
    body: trimmedBody,
    raw: content,
  };
}

/** Read an agent.md file from disk and parse it. */
export async function parseAgentFromPath(filePath: string, settings?: AgentSettings): Promise<ParsedAgent> {
  const content = await readFile(filePath, "utf-8");
  return parseAgentFile(content, settings);
}
