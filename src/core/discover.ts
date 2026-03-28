import { resolve, join } from "path";
import { readdir, readFile, stat } from "fs/promises";
import matter from "gray-matter";
import { isLocalPath } from "./fetch.js";
import type { DiscoveredAgent } from "../types.js";

// GitHub constants
const SOURCE_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const BRANCHES = ["main", "master"] as const;

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

// ---------------------------------------------------------------------------
// GitHub discovery
// ---------------------------------------------------------------------------

interface GitHubContentEntry {
  name: string;
  type: string;
  path: string;
}

async function fetchGitHubJson(url: string): Promise<GitHubContentEntry[] | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as GitHubContentEntry[];
  } catch {
    return null;
  }
}

async function fetchRawContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function discoverGitHub(source: string): Promise<DiscoveredAgent[]> {
  if (!SOURCE_RE.test(source)) {
    return [];
  }

  const [owner, repo] = source.split("/");
  const agents: DiscoveredAgent[] = [];

  for (const branch of BRANCHES) {
    const rootUrl = `https://api.github.com/repos/${owner}/${repo}/contents/?ref=${branch}`;
    const rootEntries = await fetchGitHubJson(rootUrl);
    if (!rootEntries) continue;

    // Collect candidate paths from immediate subdirectories
    const candidates: { candidatePath: string; dirName: string }[] = [];

    let hasAgentsDir = false;

    for (const entry of rootEntries) {
      if (entry.type !== "dir") continue;
      if (entry.name.startsWith(".")) continue;

      if (entry.name === "agents") {
        hasAgentsDir = true;
        continue;
      }

      candidates.push({
        candidatePath: `${entry.name}/agent.md`,
        dirName: entry.name,
      });
    }

    // Check agents/ subdirectory
    if (hasAgentsDir) {
      const agentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/agents?ref=${branch}`;
      const agentsEntries = await fetchGitHubJson(agentsUrl);
      if (agentsEntries) {
        for (const entry of agentsEntries) {
          if (entry.type !== "dir") continue;
          if (entry.name.startsWith(".")) continue;

          candidates.push({
            candidatePath: `agents/${entry.name}/agent.md`,
            dirName: `agents/${entry.name}`,
          });
        }
      }
    }

    // Fetch and parse each candidate
    for (const { candidatePath, dirName } of candidates) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${candidatePath}`;
      const content = await fetchRawContent(rawUrl);
      if (!content) continue;

      try {
        const { data } = matter(content);
        const fm = data as Record<string, unknown>;

        if (
          typeof fm.name === "string" &&
          fm.name &&
          typeof fm.description === "string" &&
          fm.description
        ) {
          agents.push({
            name: fm.name,
            description: fm.description,
            path: dirName,
          });
        }
      } catch {
        // Can't parse — skip
      }
    }

    // If we got results from this branch, return them (don't try the next branch)
    return agents;
  }

  return agents;
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
