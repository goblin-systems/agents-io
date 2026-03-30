import { convertGitHubAgent, type ConvertibleGitHubAgent } from "./convert-github-agent.js";
import { discoverAgents } from "./discover.js";
import { fetchAgent, LocalAgentNotFoundError } from "./fetch.js";
import { RepositoryAgentNotFoundError } from "./repositories.js";
import type { DiscoveredAgent, GitHubRef } from "../types.js";

type DiscoverableRootMissError =
  | LocalAgentNotFoundError
  | RepositoryAgentNotFoundError;

export type ResolvedAgentSource =
  | {
    kind: "root";
    result: Awaited<ReturnType<typeof fetchAgent>>;
  }
  | {
    kind: "discovered";
    agents: DiscoveredAgent[];
    rootError: DiscoverableRootMissError;
  }
  | {
    kind: "convertible-root";
    conversion: ConvertibleGitHubAgent;
    rootError: RepositoryAgentNotFoundError;
  };

function isDiscoverableRootMiss(error: unknown): error is DiscoverableRootMissError {
  return (
    error instanceof LocalAgentNotFoundError ||
    error instanceof RepositoryAgentNotFoundError
  );
}

export async function resolveAgentSource(
  source: string,
  githubRef?: Omit<GitHubRef, "resolvedCommit">,
): Promise<ResolvedAgentSource> {
  try {
    const result = await fetchAgent(source, { githubRef });
    return {
      kind: "root",
      result,
    };
  } catch (error) {
    if (!isDiscoverableRootMiss(error)) {
      throw error;
    }

    const discovered = await discoverAgents(source, githubRef);

    if (discovered.length === 0) {
      if (error instanceof RepositoryAgentNotFoundError) {
        const conversion = await convertGitHubAgent(source, { githubRef });

        if (conversion) {
          return {
            kind: "convertible-root",
            conversion,
            rootError: error,
          };
        }
      }

      throw error;
    }

    return {
      kind: "discovered",
      agents: discovered,
      rootError: error,
    };
  }
}
