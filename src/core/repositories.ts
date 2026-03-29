import { execFile } from "child_process";
import { mkdir, readFile, readdir, rm, stat } from "fs/promises";
import { promisify } from "util";
import { dirname, join, posix } from "path";
import matter from "gray-matter";
import { getRepositoryCacheDir } from "../utils/paths.js";
import type { AgentSettings, DiscoveredAgent } from "../types.js";

const execFileAsync = promisify(execFile);
const SHORTHAND_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const SSH_RE = /^git@github\.com:([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/;
const SSH_URL_RE = /^ssh:\/\/git@github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?\/?$/;

export interface NormalizedGitHubRepositorySource {
  owner: string;
  repo: string;
  canonical: string;
  httpsUrl: string;
  cloneUrl: string;
}

export class InvalidRepositorySourceError extends Error {
  constructor(source: string) {
    super(
      "Invalid GitHub source format. Expected owner/repo, https://github.com/owner/repo(.git), git@github.com:owner/repo.git, or ssh://git@github.com/owner/repo.git",
    );
    this.name = "InvalidRepositorySourceError";
    this.source = source;
  }

  source: string;
}

export class RepositoryAgentNotFoundError extends Error {
  constructor(repository: string, agentPath: string) {
    super(`Agent file not found in ${repository} at ${agentPath}`);
    this.name = "RepositoryAgentNotFoundError";
    this.repository = repository;
    this.agentPath = agentPath;
  }

  repository: string;
  agentPath: string;
}

async function runGit(
  args: string[],
  cwd?: string,
  trim = true,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
      encoding: "utf-8",
    });
    return trim ? stdout.trim() : stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git command failed (${args.join(" ")}): ${message}`);
  }
}

function buildCachePath(source: NormalizedGitHubRepositorySource): string {
  return join(getRepositoryCacheDir(), source.owner, source.repo);
}

function sanitizeRepositoryPath(agentPath?: string): string {
  if (!agentPath) {
    return "agent.md";
  }

  const trimmedPath = agentPath.replace(/^\/+|\/+$/g, "");
  return posix.join(trimmedPath, "agent.md");
}

function agentJsonPath(agentMarkdownPath: string): string {
  return agentMarkdownPath.replace(/agent\.md$/, "agent.json");
}

function tryParseSettings(content: string): AgentSettings {
  try {
    return JSON.parse(content) as AgentSettings;
  } catch {
    return {};
  }
}

function parseAgentMetadata(content: string): { name: string; description: string } | null {
  try {
    const { data } = matter(content);
    const frontmatter = data as Record<string, unknown>;

    if (
      typeof frontmatter.name === "string" &&
      frontmatter.name &&
      typeof frontmatter.description === "string" &&
      frontmatter.description
    ) {
      return {
        name: frontmatter.name,
        description: frontmatter.description,
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function cloneRepository(
  source: NormalizedGitHubRepositorySource,
  cachePath: string,
): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true });
  await runGit(["clone", source.cloneUrl, cachePath]);
}

async function refreshRepository(cachePath: string): Promise<void> {
  await runGit(["rev-parse", "--is-inside-work-tree"], cachePath);
  await runGit(["fetch", "--prune", "origin"], cachePath);

  const defaultBranch = await resolveRepositoryRef(cachePath);
  await runGit(["checkout", "--detach", `origin/${defaultBranch}`], cachePath);
}

async function resolveRepositoryRef(cachePath: string): Promise<string> {
  try {
    const originHead = await runGit(
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      cachePath,
    );

    if (originHead.startsWith("origin/")) {
      return originHead.slice("origin/".length);
    }
  } catch {
    // Fall through to common default branch names.
  }

  for (const candidate of ["main", "master"]) {
    try {
      await runGit(["rev-parse", "--verify", `refs/remotes/origin/${candidate}`], cachePath);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Repository cache at ${cachePath} has no readable default branch`);
}

async function readCachedFile(cachePath: string, filePath: string): Promise<string | null> {
  try {
    const info = await stat(join(cachePath, filePath));
    if (!info.isFile()) {
      return null;
    }

    return await readFile(join(cachePath, filePath), "utf-8");
  } catch {
    return null;
  }
}

async function listDirectory(cachePath: string, directoryPath?: string): Promise<string[]> {
  try {
    const targetPath = directoryPath ? join(cachePath, directoryPath) : cachePath;
    const entries = await readdir(targetPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function normalizeGitHubSource(
  source: string,
): NormalizedGitHubRepositorySource | null {
  const trimmedSource = source.trim();

  if (SHORTHAND_RE.test(trimmedSource)) {
    const [owner, repo] = trimmedSource.split("/");
    return {
      owner,
      repo,
      canonical: `${owner}/${repo}`,
      httpsUrl: `https://github.com/${owner}/${repo}.git`,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
    };
  }

  const sshMatch = trimmedSource.match(SSH_RE);
  if (sshMatch) {
    const [, owner, repo] = sshMatch;
    return {
      owner,
      repo,
      canonical: `${owner}/${repo}`,
      httpsUrl: `https://github.com/${owner}/${repo}.git`,
      cloneUrl: `git@github.com:${owner}/${repo}.git`,
    };
  }

  const sshUrlMatch = trimmedSource.match(SSH_URL_RE);
  if (sshUrlMatch) {
    const [, owner, repo] = sshUrlMatch;
    return {
      owner,
      repo,
      canonical: `${owner}/${repo}`,
      httpsUrl: `https://github.com/${owner}/${repo}.git`,
      cloneUrl: `ssh://git@github.com/${owner}/${repo}.git`,
    };
  }

  try {
    const url = new URL(trimmedSource);
    if (url.protocol !== "https:" || url.hostname !== "github.com") {
      return null;
    }

    const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (segments.length !== 2) {
      return null;
    }

    const [owner, rawRepo] = segments;
    const repo = rawRepo.replace(/\.git$/, "");

    if (!owner || !repo) {
      return null;
    }

    return {
      owner,
      repo,
      canonical: `${owner}/${repo}`,
      httpsUrl: `https://github.com/${owner}/${repo}.git`,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
    };
  } catch {
    return null;
  }
}

export async function ensureRepositoryCache(
  source: NormalizedGitHubRepositorySource,
): Promise<string> {
  const cachePath = buildCachePath(source);

  try {
    await refreshRepository(cachePath);
  } catch {
    await rm(cachePath, { recursive: true, force: true });
    await cloneRepository(source, cachePath);
  }

  return cachePath;
}

export async function fetchRepositoryAgent(
  source: NormalizedGitHubRepositorySource,
  agentPath?: string,
): Promise<{ content: string; settings: AgentSettings }> {
  const cachePath = await ensureRepositoryCache(source);
  const markdownPath = sanitizeRepositoryPath(agentPath);
  const content = await readCachedFile(cachePath, markdownPath);

  if (!content) {
    throw new RepositoryAgentNotFoundError(source.canonical, markdownPath);
  }

  const jsonContent = await readCachedFile(cachePath, agentJsonPath(markdownPath));

  return {
    content,
    settings: jsonContent ? tryParseSettings(jsonContent) : {},
  };
}

export async function discoverRepositoryAgents(
  source: NormalizedGitHubRepositorySource,
): Promise<DiscoveredAgent[]> {
  const cachePath = await ensureRepositoryCache(source);
  const discovered: DiscoveredAgent[] = [];

  for (const entry of await listDirectory(cachePath)) {
    if (entry.startsWith(".") || entry === "agents") {
      continue;
    }

    const content = await readCachedFile(cachePath, posix.join(entry, "agent.md"));
    if (!content) {
      continue;
    }

    const parsed = parseAgentMetadata(content);
    if (parsed) {
      discovered.push({ ...parsed, path: entry });
    }
  }

  for (const entry of await listDirectory(cachePath, "agents")) {
    if (entry.startsWith(".")) {
      continue;
    }

    const content = await readCachedFile(cachePath, posix.join("agents", entry, "agent.md"));
    if (!content) {
      continue;
    }

    const parsed = parseAgentMetadata(content);
    if (parsed) {
      discovered.push({ ...parsed, path: `agents/${entry}` });
    }
  }

  return discovered;
}
