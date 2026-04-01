import type { GitHubRef } from "../types.js";

export interface GitHubRefOptions {
  branch?: string;
  tag?: string;
  commit?: string;
}

export function getRequestedGitHubRef(
  options: GitHubRefOptions,
): Omit<GitHubRef, "resolvedCommit"> | undefined {
  const refs = [
    options.branch ? { type: "branch" as const, value: options.branch } : undefined,
    options.tag ? { type: "tag" as const, value: options.tag } : undefined,
    options.commit ? { type: "commit" as const, value: options.commit } : undefined,
  ].filter((value): value is { type: "branch" | "tag" | "commit"; value: string } => {
    return value !== undefined;
  });

  if (refs.length > 1) {
    throw new Error("Use exactly one of --branch, --tag, or --commit");
  }

  return refs[0];
}

export function formatGitHubRef(githubRef?: Omit<GitHubRef, "resolvedCommit">): string | null {
  if (!githubRef) {
    return null;
  }

  return `${githubRef.type}: ${githubRef.value}`;
}
