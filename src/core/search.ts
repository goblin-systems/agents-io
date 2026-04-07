import { resolveAgentSource } from "./resolve-agent-source.js";
import {
  InvalidRepositorySourceError,
  RepositoryAgentNotFoundError,
} from "./repositories.js";

export interface SearchResult {
  /** "owner/repo" */
  repo: string;
  /** Repository description (empty string if none) */
  description: string;
  /** Star count */
  stars: number;
  /** Last updated ISO timestamp */
  updatedAt: string;
  /** GitHub HTML URL */
  url: string;
}

export type SearchVerificationKind =
  | "root"
  | "discovered"
  | "convertible-root"
  | "unverified";

export interface SearchVerification {
  kind: SearchVerificationKind;
  installable: boolean;
  summary: string;
  agentPaths?: string[];
}

export interface VerifiedSearchResult extends SearchResult {
  verification: SearchVerification;
}

interface GitHubSearchResponseItem {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  updated_at: string;
  html_url: string;
}

interface GitHubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubSearchResponseItem[];
}

export class GitHubSearchError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "GitHubSearchError";
  }
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "agents-io-cli",
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function buildSearchUrl(query?: string): string {
  const q = query
    ? `topic:agents-io ${query}`
    : "topic:agents-io";
  const encodedQuery = encodeURIComponent(q);
  return `https://api.github.com/search/repositories?q=${encodedQuery}&sort=stars&per_page=25`;
}

function mapItem(item: GitHubSearchResponseItem): SearchResult {
  return {
    repo: item.full_name,
    description: item.description ?? "",
    stars: item.stargazers_count,
    updatedAt: item.updated_at,
    url: item.html_url,
  };
}

function formatInstallableSummary(
  resolvedSource: Awaited<ReturnType<typeof resolveAgentSource>>,
): SearchVerification {
  if (resolvedSource.kind === "root") {
    return {
      kind: "root",
      installable: true,
      summary: "installable at repo root",
    };
  }

  if (resolvedSource.kind === "discovered") {
    return {
      kind: "discovered",
      installable: true,
      summary: `installable via discovery (${resolvedSource.agents.length} agent${resolvedSource.agents.length === 1 ? "" : "s"})`,
      agentPaths: resolvedSource.agents.map((agent) => agent.path),
    };
  }

  return {
    kind: "convertible-root",
    installable: false,
    summary: `best-effort convertible from ${resolvedSource.conversion.sourcePath}`,
  };
}

function formatUnverifiedSummary(error: unknown): SearchVerification {
  if (error instanceof RepositoryAgentNotFoundError) {
    return {
      kind: "unverified",
      installable: false,
      summary: "not installable by current agents-io source rules",
    };
  }

  if (error instanceof InvalidRepositorySourceError) {
    return {
      kind: "unverified",
      installable: false,
      summary: error.message,
    };
  }

  return {
    kind: "unverified",
    installable: false,
    summary:
      error instanceof Error
        ? `verification failed: ${error.message}`
        : `verification failed: ${String(error)}`,
  };
}

/**
 * Search for agents-io-compatible repositories on GitHub.
 *
 * Searches the GitHub Repository Search API for repositories tagged with
 * the `agents-io` topic that match the given query.
 *
 * Returns an empty array when no results are found.
 * Throws GitHubSearchError for API-level failures (rate limits, validation errors).
 */
export async function searchAgents(query?: string): Promise<SearchResult[]> {
  const url = buildSearchUrl(query);
  const headers = buildHeaders();

  let response: Response;

  try {
    response = await fetch(url, { headers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    throw new Error(`Network error while searching GitHub: ${message}`);
  }

  if (response.status === 403) {
    const resetHeader = response.headers.get("x-ratelimit-remaining");
    if (resetHeader === "0") {
      const resetAt = response.headers.get("x-ratelimit-reset");
      const resetTime = resetAt
        ? new Date(Number(resetAt) * 1000).toLocaleTimeString()
        : "unknown";
      throw new GitHubSearchError(
        `GitHub API rate limit exceeded. Resets at ${resetTime}. Set GITHUB_TOKEN to increase your limit.`,
        403,
      );
    }

    throw new GitHubSearchError(
      "GitHub API request forbidden (403). Set GITHUB_TOKEN if you haven't already.",
      403,
    );
  }

  if (response.status === 422) {
    throw new GitHubSearchError(
      "GitHub rejected the search query (422). Try simplifying your search terms.",
      422,
    );
  }

  if (!response.ok) {
    throw new GitHubSearchError(
      `GitHub API returned ${response.status}: ${response.statusText}`,
      response.status,
    );
  }

  const data = (await response.json()) as GitHubSearchResponse;

  return data.items.map(mapItem);
}

export async function verifySearchResults(
  results: SearchResult[],
): Promise<VerifiedSearchResult[]> {
  const verifiedResults: VerifiedSearchResult[] = [];

  for (const result of results) {
    try {
      const resolvedSource = await resolveAgentSource(result.repo);
      verifiedResults.push({
        ...result,
        verification: formatInstallableSummary(resolvedSource),
      });
    } catch (error) {
      verifiedResults.push({
        ...result,
        verification: formatUnverifiedSummary(error),
      });
    }
  }

  return verifiedResults;
}
