import {
  searchAgents,
  verifySearchResults,
  GitHubSearchError,
  type VerifiedSearchResult,
} from "../core/search.js";
import { log } from "../utils/logger.js";

export interface SearchOptions {
  verify?: boolean;
}

function getVerificationLabel(result: VerifiedSearchResult): string {
  switch (result.verification.kind) {
    case "root":
    case "discovered":
      return "installable";
    case "convertible-root":
      return "convertible";
    default:
      return "not installable";
  }
}

export async function searchCommand(
  query?: string,
  options: SearchOptions = {},
): Promise<void> {
  try {
    log.fetch(
      query
        ? `Searching for agents matching '${query}'`
        : "Searching for agents...",
    );

    const results = await searchAgents(query);
    const verifiedResults = options.verify
      ? await verifySearchResults(results)
      : results;

    if (verifiedResults.length === 0) {
      log.info(
        query
          ? `No agents found for '${query}'`
          : "No agents found",
      );
      return;
    }

    log.spacer();
    log.warn("Agents found via search are community-contributed and unvetted.");
    log.detail("Always review the source repository before installing.");
    if (options.verify) {
      log.detail("Verification reuses the same source-resolution rules as install and validate.");
    }
    log.spacer();
    log.section("Search results");
    log.spacer();

    if (options.verify) {
      for (let i = 0; i < verifiedResults.length; i++) {
        const result = verifiedResults[i] as VerifiedSearchResult;
        log.detail(`${result.repo} ★ ${result.stars}`);
        log.detail(`  ${result.description}`);
        log.detail(`  ${result.url}`);
        log.detail(
          `  verify: ${getVerificationLabel(result)} - ${result.verification.summary}`,
        );

        if (result.verification.agentPaths && result.verification.agentPaths.length > 0) {
          log.detail(`  agent paths: ${result.verification.agentPaths.join(", ")}`);
        }

        if (i < verifiedResults.length - 1) {
          log.spacer();
        }
      }
    } else {
      for (let i = 0; i < verifiedResults.length; i++) {
        const result = verifiedResults[i];
        log.detail(`${result.repo} ★ ${result.stars}`);
        log.detail(`  ${result.description}`);
        log.detail(`  ${result.url}`);

        if (i < verifiedResults.length - 1) {
          log.spacer();
        }
      }
    }

    log.spacer();
    if (options.verify) {
      const verifiedSearchResults = verifiedResults as VerifiedSearchResult[];
      const installableCount = verifiedSearchResults.filter((result) => result.verification.installable).length;
      const convertibleCount = verifiedSearchResults.filter((result) => result.verification.kind === "convertible-root").length;
      log.success(
        `Found ${verifiedResults.length} agent(s); ${installableCount} installable without conversion${convertibleCount > 0 ? `, ${convertibleCount} best-effort convertible` : ""}`,
      );
      log.detail("Install root results with: agents-io add <owner/repo>");
      log.detail("Install discovered results with: agents-io add <owner/repo> --path <agent-path>");
    } else {
      log.success(`Found ${verifiedResults.length} agent(s)`);
      log.detail("Install with: agents-io add <owner/repo>");
    }
  } catch (error) {
    if (error instanceof GitHubSearchError) {
      log.error(error.message);
    } else {
      log.error(
        error instanceof Error
          ? error.message
          : `Search failed: ${String(error)}`,
      );
    }
    process.exit(1);
  }
}
