import claudeCodeAdapter from "../adapters/claude-code.js";
import codexAdapter from "../adapters/codex.js";
import kiroAdapter from "../adapters/kiro.js";
import opencodeAdapter from "../adapters/opencode.js";
import { applyAgentModeOverride, getStoredModeOverride } from "./agent-mode.js";
import { fetchAgent } from "./fetch.js";
import { hashContent } from "./registry.js";
import type { Adapter, GitHubRef, InstalledAgent, Platform } from "../types.js";

const adapters: Adapter[] = [opencodeAdapter, claudeCodeAdapter, codexAdapter, kiroAdapter];

export type LockEntryFetchMode = "sync" | "update";

export function getAdapter(name: string): Adapter | undefined {
  return adapters.find((adapter) => adapter.name === name);
}

export function getStoredPlatformHashes(
  entry: InstalledAgent,
): Partial<Record<Platform, string>> {
  const hashes: Partial<Record<Platform, string>> = { ...(entry.platformHashes ?? {}) };

  for (const platform of entry.platforms) {
    hashes[platform] ??= entry.hash;
  }

  return hashes;
}

export function areAllInstalledPlatformsCurrent(
  platforms: Platform[],
  platformHashes: Partial<Record<Platform, string>>,
  hash: string,
): boolean {
  return platforms.every((platform) => platformHashes[platform] === hash);
}

export function getFetchSource(entry: InstalledAgent): string {
  return entry.sourceType === "local"
    ? entry.sourceUrl
    : (entry.repositoryUrl ?? entry.sourceUrl ?? entry.source);
}

function getFetchRef(entry: InstalledAgent, mode: LockEntryFetchMode): Omit<GitHubRef, "resolvedCommit"> | undefined {
  if (!entry.githubRef) {
    return undefined;
  }

  if (mode === "sync" && entry.githubRef.resolvedCommit) {
    return {
      type: "commit",
      value: entry.githubRef.resolvedCommit,
    };
  }

  return {
    type: entry.githubRef.type,
    value: entry.githubRef.value,
  };
}

export async function fetchLockEntryAgent(entry: InstalledAgent, mode: LockEntryFetchMode): Promise<{
  agent: Awaited<ReturnType<typeof fetchAgent>>["agent"];
  hash: string;
  githubRef?: GitHubRef;
}> {
  const result = await fetchAgent(getFetchSource(entry), {
    path: entry.agentPath || undefined,
    githubRef: getFetchRef(entry, mode),
  });

  return {
    agent: applyAgentModeOverride(result.agent, getStoredModeOverride(entry)),
    hash: hashContent(result.agent.raw),
    githubRef:
      entry.githubRef && result.resolvedCommit
        ? {
            type: entry.githubRef.type,
            value: entry.githubRef.value,
            resolvedCommit: result.resolvedCommit,
          }
        : undefined,
  };
}
