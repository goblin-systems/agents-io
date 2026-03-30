import {
  getAgentRegistryStatus,
  inspectLockFile,
} from "../core/registry.js";
import { inspectPlatformInstall } from "../core/install-health.js";
import { log } from "../utils/logger.js";
import { findProjectRoot } from "../utils/paths.js";

export interface DoctorOptions {
  global?: boolean;
}

interface DoctorIssue {
  message: string;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  try {
    const projectRoot = findProjectRoot();
    const isGlobal = options.global ?? false;
    const scopeLabel = isGlobal ? "global" : "project";
    const inspection = await inspectLockFile(isGlobal, projectRoot);
    const issues: DoctorIssue[] = [];
    const entries = Object.entries(inspection.lockFile.agents).sort(([left], [right]) =>
      left.localeCompare(right)
    );

    log.inspect(`Checking ${scopeLabel} install health`);
    log.detail(`lock file: ${inspection.path}`);

    if (!inspection.exists) {
      log.spacer();
      log.success(`No agents installed in ${scopeLabel} scope`);
      log.detail("status: healthy (lock file missing, scope is empty)");
      return;
    }

    if (!inspection.readable) {
      log.spacer();
      log.error(
        `Found 1 issue in ${scopeLabel} scope: lock file could not be read: ${inspection.error ?? "unknown error"}`,
      );
      process.exit(1);
    }

    if (entries.length === 0) {
      log.spacer();
      log.success(`No agents installed in ${scopeLabel} scope`);
      log.detail("status: healthy (lock file is readable and empty)");
      return;
    }

    let checkedPlatforms = 0;

    for (const [name, entry] of entries) {
      if (entry.platforms.length === 0) {
        issues.push({
          message: `${name} [${scopeLabel}] has no recorded platforms in ${inspection.path}. Remove the stale lock entry or reinstall the agent.`,
        });
        continue;
      }

      if (getAgentRegistryStatus(entry) === "mixed") {
        issues.push({
          message: `${name} [${scopeLabel}] has mixed registry hashes in ${inspection.path}. Use \`agents-io list --verbose\` to inspect the stored hashes, then reinstall the affected platform with \`agents-io update ${name}${isGlobal ? " --global" : ""}\` if needed.`,
        });
      }

      for (const platform of entry.platforms) {
        checkedPlatforms++;
        const platformIssues = await inspectPlatformInstall(name, entry, platform, projectRoot, isGlobal);
        issues.push(...platformIssues);
      }
    }

    if (issues.length === 0) {
      log.spacer();
      log.success(`Healthy ${scopeLabel} scope`);
      log.detail(`checked ${entries.length} agent(s) across ${checkedPlatforms} platform install(s)`);
      return;
    }

    log.spacer();
    log.error(`Found ${issues.length} issue(s) in ${scopeLabel} scope`);
    for (const issue of issues) {
      log.warn(issue.message);
    }
    process.exit(1);
  } catch (error) {
    log.error(
      error instanceof Error ? error.message : `Failed to run doctor: ${String(error)}`,
    );
    process.exit(1);
  }
}
