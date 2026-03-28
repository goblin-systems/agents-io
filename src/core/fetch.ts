import { parseAgentFile } from "./parse.js";
import type { ParsedAgent } from "../types.js";

export interface FetchOptions {
  /** Subfolder within the repo that contains agent.md. */
  path?: string;
}

const SOURCE_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const BRANCHES = ["main", "master"] as const;

function buildRawUrl(owner: string, repo: string, branch: string, filePath: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

/** Fetch an agent.md from a GitHub repository and parse it. */
export async function fetchAgent(
  source: string,
  options?: FetchOptions,
): Promise<ParsedAgent> {
  if (!SOURCE_RE.test(source)) {
    throw new Error("Invalid source format. Expected: owner/repo");
  }

  const [owner, repo] = source.split("/");
  const filePath = options?.path
    ? `${options.path.replace(/\/+$/, "")}/agent.md`
    : "agent.md";

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
      return parseAgentFile(content);
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
