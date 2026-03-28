import { resolve, join, dirname } from "path";
import { readFile, stat } from "fs/promises";
import { parseAgentFile, parseAgentFromPath } from "./parse.js";
import type { ParsedAgent, AgentSettings } from "../types.js";

export interface FetchOptions {
  /** Subfolder within the repo (or local path) that contains agent.md. */
  path?: string;
}

export interface FetchResult {
  agent: ParsedAgent;
  sourceType: "github" | "local";
  /** "owner/repo" for github, absolute path for local. */
  resolvedSource: string;
}

const SOURCE_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const BRANCHES = ["main", "master"] as const;

function buildRawUrl(owner: string, repo: string, branch: string, filePath: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

/**
 * Detect whether a source string refers to a local filesystem path.
 * Local if it starts with `.`, `/`, or contains `\` or `:` (Windows drive letter).
 */
export function isLocalPath(source: string): boolean {
  return (
    source.startsWith(".") ||
    source.startsWith("/") ||
    source.includes("\\") ||
    /^[a-zA-Z]:/.test(source)
  );
}

/** Try to read and parse an agent.json file. Returns empty settings on failure. */
async function readLocalSettings(jsonPath: string): Promise<AgentSettings> {
  try {
    const content = await readFile(jsonPath, "utf-8");
    return JSON.parse(content) as AgentSettings;
  } catch {
    return {};
  }
}

/** Resolve a local agent.md path and parse it. */
async function fetchLocalAgent(
  source: string,
  options?: FetchOptions,
): Promise<FetchResult> {
  const absoluteBase = resolve(source);

  let agentFilePath: string;

  if (options?.path) {
    // --path subfolder provided: look inside that subfolder
    agentFilePath = join(absoluteBase, options.path.replace(/\/+$/, ""), "agent.md");
  } else if (source.endsWith(".md")) {
    // Source is a direct .md file reference
    agentFilePath = absoluteBase;
  } else {
    // Source is a directory — look for agent.md inside it
    agentFilePath = join(absoluteBase, "agent.md");
  }

  // Verify the file exists
  try {
    const info = await stat(agentFilePath);
    if (!info.isFile()) {
      throw new Error(`Path is not a file: ${agentFilePath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Agent file not found at ${agentFilePath}`);
    }
    throw err;
  }

  // Try to load agent.json from the same directory
  const agentJsonPath = join(dirname(agentFilePath), "agent.json");
  const settings = await readLocalSettings(agentJsonPath);

  const agent = await parseAgentFromPath(agentFilePath, settings);

  return {
    agent,
    sourceType: "local",
    resolvedSource: absoluteBase,
  };
}

/** Fetch an agent.md from a GitHub repository and parse it. */
async function fetchGitHubAgent(
  source: string,
  options?: FetchOptions,
): Promise<FetchResult> {
  if (!SOURCE_RE.test(source)) {
    throw new Error("Invalid source format. Expected: owner/repo");
  }

  const [owner, repo] = source.split("/");
  const filePath = options?.path
    ? `${options.path.replace(/\/+$/, "")}/agent.md`
    : "agent.md";

  // Derive the agent.json path from the agent.md path
  const jsonPath = filePath.replace(/agent\.md$/, "agent.json");

  let lastError: Error | undefined;

  for (const branch of BRANCHES) {
    const url = buildRawUrl(owner, repo, branch, filePath);

    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      lastError = new Error(
        `Failed to fetch agent: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (response.ok) {
      const content = await response.text();

      // Try to fetch agent.json from the same path
      let settings: AgentSettings = {};
      try {
        const jsonUrl = buildRawUrl(owner, repo, branch, jsonPath);
        const jsonResponse = await fetch(jsonUrl);
        if (jsonResponse.ok) {
          settings = (await jsonResponse.json()) as AgentSettings;
        }
      } catch {
        // agent.json not found or invalid — use empty settings
      }

      return {
        agent: parseAgentFile(content, settings),
        sourceType: "github",
        resolvedSource: source,
      };
    }

    if (response.status === 404) {
      lastError = new Error(
        `Agent not found at ${url}. Check the repository and path.`,
      );
      continue;
    }

    // Other HTTP errors
    lastError = new Error(
      `Failed to fetch agent: HTTP ${response.status} ${response.statusText}`,
    );
  }

  throw lastError!;
}

/**
 * Fetch an agent from a GitHub repository or a local filesystem path and parse it.
 *
 * Local paths are detected when the source starts with `.`, `/`,
 * or contains `\` or `:` (Windows drive letter).
 * Everything else is treated as `owner/repo` GitHub source.
 */
export async function fetchAgent(
  source: string,
  options?: FetchOptions,
): Promise<FetchResult> {
  if (isLocalPath(source)) {
    return fetchLocalAgent(source, options);
  }
  return fetchGitHubAgent(source, options);
}
