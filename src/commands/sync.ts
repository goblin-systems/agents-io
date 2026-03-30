import { inspectPlatformInstall } from "../core/install-health.js";
import {
  fetchLockEntryAgent,
  getAdapter,
} from "../core/lock-entry.js";
import { getAgentRegistryStatus, inspectLockFile } from "../core/registry.js";
import type { InstalledAgent, Platform } from "../types.js";
import { log } from "../utils/logger.js";
import { findProjectRoot } from "../utils/paths.js";

function isPlatform(value: string): value is Platform {
  return getAdapter(value) !== undefined;
}

function getUnsupportedPlatforms(entry: InstalledAgent): string[] {
  return entry.platforms.filter((platform) => !isPlatform(platform));
}

export async function syncCommand(): Promise<void> {
  try {
    const projectRoot = findProjectRoot();
    const inspection = await inspectLockFile(false, projectRoot);
    const entries = Object.entries(inspection.lockFile.agents).sort(([left], [right]) =>
      left.localeCompare(right)
    );

    log.sync("Syncing project agents from lock file");
    log.detail(`lock file: ${inspection.path}`);

    if (!inspection.exists) {
      log.spacer();
      log.error(`Project lock file not found at ${inspection.path}`);
      process.exit(1);
    }

    if (!inspection.readable) {
      log.spacer();
      log.error(`Project lock file could not be read: ${inspection.error ?? "unknown error"}`);
      process.exit(1);
    }

    if (entries.length === 0) {
      log.spacer();
      log.success("Project lock file is readable and empty");
      log.detail("0 tracked agent(s) to sync");
      return;
    }

    let repairedPlatforms = 0;
    let alignedPlatforms = 0;
    let issueCount = 0;

    for (const [name, entry] of entries) {
      if (name !== entries[0]?.[0]) {
        log.spacer();
      }

      if (entry.platforms.length === 0) {
        log.warn(`${name} has no recorded project platforms; skipping`);
        issueCount++;
        continue;
      }

      if (getAgentRegistryStatus(entry) === "mixed") {
        log.warn(`${name} has mixed registry hashes in the project lock file; skipping`);
        issueCount++;
        continue;
      }

      const unsupportedPlatforms = getUnsupportedPlatforms(entry);
      for (const platform of unsupportedPlatforms) {
        log.warn(`${name} records unsupported platform '${platform}'; skipping that platform`);
        issueCount++;
      }

      const supportedPlatforms = entry.platforms.filter(isPlatform);
      if (supportedPlatforms.length === 0) {
        continue;
      }

      try {
        const fetched = await fetchLockEntryAgent(entry, "sync");

        if (fetched.hash !== entry.hash) {
          log.warn(
            `${name} could not be resolved to locked content (expected ${entry.hash}, fetched ${fetched.hash}); leaving existing installs unchanged`,
          );
          issueCount++;
          continue;
        }

        for (const platform of supportedPlatforms) {
          const issues = await inspectPlatformInstall(name, entry, platform, projectRoot, false);
          if (issues.length === 0) {
            alignedPlatforms++;
            log.detail(`${name} [${platform}] already aligned with the project lock file`);
            continue;
          }

          const adapter = getAdapter(platform);
          if (!adapter) {
            log.warn(`${name} could not load the ${platform} adapter; skipping`);
            issueCount++;
            continue;
          }

          log.sync(`Repairing ${name} for ${platform}`);
          log.detail(issues[0]?.message ?? "tracked install needs repair");

          try {
            await adapter.install({
              agent: fetched.agent,
              projectDir: projectRoot,
              global: false,
            });
            repairedPlatforms++;
            log.success(`${name} [${platform}] synced from project lock file`);
          } catch (error) {
            log.error(
              `Failed to sync ${name} for ${platform}: ${error instanceof Error ? error.message : String(error)}`,
            );
            issueCount++;
          }
        }
      } catch (error) {
        log.error(
          `Failed to resolve ${name} from the project lock file: ${error instanceof Error ? error.message : String(error)}`,
        );
        issueCount++;
      }
    }

    log.spacer();
    if (issueCount > 0) {
      log.error(`Sync completed with ${issueCount} issue(s)`);
      log.detail(`${repairedPlatforms} platform install(s) repaired, ${alignedPlatforms} already aligned`);
      process.exit(1);
    }

    log.success("Sync complete");
    log.detail(`${repairedPlatforms} platform install(s) repaired, ${alignedPlatforms} already aligned`);
  } catch (error) {
    log.error(
      error instanceof Error ? error.message : `Failed to sync project agents: ${String(error)}`,
    );
    process.exit(1);
  }
}
