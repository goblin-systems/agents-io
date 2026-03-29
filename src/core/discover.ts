import { resolve, join } from "path";
import { readdir, readFile, stat } from "fs/promises";
import matter from "gray-matter";
import { isLocalPath } from "./fetch.js";
import type { DiscoveredAgent } from "../types.js";
import { discoverRepositoryAgents, normalizeGitHubSource } from "./repositories.js";

// ---------------------------------------------------------------------------
// Local discovery
// ---------------------------------------------------------------------------

async function tryParseAgent(
  filePath: string,
): Promise<{ name: string; description: string } | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const { data } = matter(content);
    const fm = data as Record<string, unknown>;

    if (
      typeof fm.name === "string" &&
      fm.name &&
      typeof fm.description === "string" &&
      fm.description
    ) {
      return { name: fm.name, description: fm.description };
    }
    return null;
  } catch {
    return null;
  }
}

async function discoverLocal(source: string): Promise<DiscoveredAgent[]> {
  const basePath = resolve(source);
  const agents: DiscoveredAgent[] = [];

  let entries: string[];
  try {
    entries = await readdir(basePath);
  } catch {
    return agents;
  }

  // Check immediate subdirectories for agent.md
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;

    const entryPath = join(basePath, entry);
    try {
      const info = await stat(entryPath);
      if (!info.isDirectory()) continue;
    } catch {
      continue;
    }

    // Skip the "agents" directory here — handle it separately below
    if (entry === "agents") continue;

    const agentFile = join(entryPath, "agent.md");
    const parsed = await tryParseAgent(agentFile);
    if (parsed) {
      agents.push({
        name: parsed.name,
        description: parsed.description,
        path: entry,
      });
    }
  }

  // Check agents/ subdirectory (2 levels deep)
  const agentsDir = join(basePath, "agents");
  try {
    const info = await stat(agentsDir);
    if (info.isDirectory()) {
      const subEntries = await readdir(agentsDir);
      for (const sub of subEntries) {
        if (sub.startsWith(".")) continue;

        const subPath = join(agentsDir, sub);
        try {
          const subInfo = await stat(subPath);
          if (!subInfo.isDirectory()) continue;
        } catch {
          continue;
        }

        const agentFile = join(subPath, "agent.md");
        const parsed = await tryParseAgent(agentFile);
        if (parsed) {
          agents.push({
            name: parsed.name,
            description: parsed.description,
            path: `agents/${sub}`,
          });
        }
      }
    }
  } catch {
    // agents/ directory doesn't exist — that's fine
  }

  return agents;
}

async function discoverGitHub(source: string): Promise<DiscoveredAgent[]> {
  const normalizedSource = normalizeGitHubSource(source);

  if (!normalizedSource) {
    return [];
  }

  return discoverRepositoryAgents(normalizedSource);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function discoverAgents(source: string): Promise<DiscoveredAgent[]> {
  if (isLocalPath(source)) {
    return discoverLocal(source);
  }
  return discoverGitHub(source);
}
