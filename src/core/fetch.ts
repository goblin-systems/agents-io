import { resolve, join, dirname } from "path";
import { readFile, stat } from "fs/promises";
import { parseAgentFile, parseAgentFromPath } from "./parse.js";
import type { ParsedAgent, AgentSettings, GitHubRef } from "../types.js";
import {
  fetchRepositoryAgent,
  InvalidRepositorySourceError,
  normalizeGitHubSource,
} from "./repositories.js";

export interface FetchOptions {
  /** Subfolder within the repo (or local path) that contains agent.md. */
  path?: string;
  /** Optional pinned GitHub ref. Ignored for local sources. */
  githubRef?: Omit<GitHubRef, "resolvedCommit">;
}

export interface FetchResult {
  agent: ParsedAgent;
  sourceType: "github" | "local";
  /** "owner/repo" for github, absolute path for local. */
  resolvedSource: string;
  repositoryUrl?: string;
  resolvedCommit?: string;
}

export class LocalAgentNotFoundError extends Error {
  constructor(agentFilePath: string) {
    super(`Agent file not found at ${agentFilePath}`);
    this.name = "LocalAgentNotFoundError";
    this.agentFilePath = agentFilePath;
  }

  agentFilePath: string;
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
      throw new LocalAgentNotFoundError(agentFilePath);
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
  const normalizedSource = normalizeGitHubSource(source);

  if (!normalizedSource) {
    throw new InvalidRepositorySourceError(source);
  }

  const repositoryResult = await fetchRepositoryAgent(
    normalizedSource,
    options?.path,
    options?.githubRef,
  );

  return {
    agent: parseAgentFile(repositoryResult.content, repositoryResult.settings as AgentSettings),
    sourceType: "github",
    resolvedSource: normalizedSource.canonical,
    repositoryUrl: normalizedSource.cloneUrl,
    resolvedCommit: repositoryResult.resolvedCommit,
  };
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
