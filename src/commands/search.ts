import { searchAgents, GitHubSearchError } from "../core/search.js";
import { log } from "../utils/logger.js";

export async function searchCommand(query?: string): Promise<void> {
  try {
    log.fetch(
      query
        ? `Searching for agents matching '${query}'`
        : "Searching for agents...",
    );

    const results = await searchAgents(query);

    if (results.length === 0) {
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
    log.spacer();
    log.section("Search results");
    log.spacer();

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      log.detail(`${result.repo} ★ ${result.stars}`);
      log.detail(`  ${result.description}`);
      log.detail(`  ${result.url}`);

      if (i < results.length - 1) {
        log.spacer();
      }
    }

    log.spacer();
    log.success(`Found ${results.length} agent(s)`);
    log.detail("Install with: agents-io add <owner/repo>");
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
