import { parseAgentFile } from "./parse.js";
import {
  findConvertibleRepositoryAgent,
  normalizeGitHubSource,
} from "./repositories.js";
import type { GitHubRef } from "../types.js";
import type { FetchResult } from "./fetch.js";

export interface ConvertibleGitHubAgent {
  sourceFile: "AGENTS.md" | "CLAUDE.md";
  sourcePath: string;
  result: FetchResult;
}

function toKebabCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function getAgentNameSeed(source: string, agentPath?: string): string {
  if (!agentPath) {
    return source.split("/").at(-1) ?? source;
  }

  return agentPath.split("/").filter(Boolean).at(-1) ?? source;
}

function buildConvertedAgentContent(name: string, description: string, body: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
}

export async function convertGitHubAgent(
  source: string,
  options?: {
    path?: string;
    githubRef?: Omit<GitHubRef, "resolvedCommit">;
    host?: string;
  },
): Promise<ConvertibleGitHubAgent | null> {
  const normalizedSource = normalizeGitHubSource(source, { host: options?.host });

  if (!normalizedSource) {
    return null;
  }

  const candidate = await findConvertibleRepositoryAgent(
    normalizedSource,
    options?.path,
    options?.githubRef,
  );

  if (!candidate) {
    return null;
  }

  const name = toKebabCase(getAgentNameSeed(normalizedSource.canonical, options?.path));

  if (!name) {
    throw new Error(`Could not derive a valid agent name from ${normalizedSource.canonical}`);
  }

  const locationLabel = options?.path
    ? `${normalizedSource.canonical}/${options.path}`
    : normalizedSource.canonical;
  const description = `Best-effort conversion from ${candidate.sourceFile} in ${locationLabel}`;
  const raw = buildConvertedAgentContent(name, description, candidate.content);

  return {
    sourceFile: candidate.sourceFile,
    sourcePath: candidate.sourcePath,
    result: {
      agent: parseAgentFile(raw),
      sourceType: "github",
      resolvedSource: normalizedSource.canonical,
      sourceUrl: normalizedSource.sourceUrl,
      repositoryUrl: normalizedSource.cloneUrl,
      resolvedCommit: candidate.resolvedCommit,
    },
  };
}
