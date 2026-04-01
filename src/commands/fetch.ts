import { access } from "fs/promises";
import { join, resolve } from "path";
import { getRequestedGitHubRef, formatGitHubRef } from "../core/github-ref.js";
import { isLocalPath, LocalAgentNotFoundError } from "../core/fetch.js";
import {
  ensureRepositoryCache,
  InvalidRepositorySourceError,
  normalizeGitHubSource,
} from "../core/repositories.js";
import { log } from "../utils/logger.js";

export interface FetchCommandOptions {
  path?: string;
  host?: string;
  branch?: string;
  tag?: string;
  commit?: string;
}

function formatFetchError(error: unknown): string {
  if (error instanceof LocalAgentNotFoundError) {
    return `Fetch failed: local source does not exist at ${error.agentFilePath}. Check the local path or pass --path <path> to point at the folder containing agent.md.`;
  }

  if (error instanceof InvalidRepositorySourceError) {
    return `${error.message}. Use owner/repo, a supported GitHub or GitHub Enterprise URL, or a local filesystem path.`;
  }

  if (error instanceof Error) {
    return `Fetch failed: ${error.message}`;
  }

  return `Fetch failed: ${String(error)}`;
}

async function ensureLocalSourceExists(source: string, pathHint?: string): Promise<{
  sourcePath: string;
  targetPath?: string;
}> {
  const absolutePath = resolve(source);

  try {
    await access(absolutePath);
  } catch {
    throw new LocalAgentNotFoundError(absolutePath);
  }

  if (!pathHint) {
    return { sourcePath: absolutePath };
  }

  const targetPath = join(absolutePath, pathHint);

  try {
    await access(targetPath);
    return {
      sourcePath: absolutePath,
      targetPath,
    };
  } catch {
    throw new LocalAgentNotFoundError(targetPath);
  }
}

export async function fetchCommand(
  source: string,
  options: FetchCommandOptions = {},
): Promise<void> {
  try {
    const githubRef = getRequestedGitHubRef(options);

    if (isLocalPath(source)) {
      const localSource = await ensureLocalSourceExists(source, options.path);

      log.fetch(`Checking local source ${source}`);
      log.spacer();
      log.success("Local source is ready");
      log.detail(`path: ${localSource.sourcePath}`);

      if (localSource.targetPath) {
        log.detail(`path hint: ${options.path}`);
        log.detail(`resolved local target: ${localSource.targetPath}`);
      }

      log.detail("Nothing was cloned for local sources.");
      return;
    }

    const normalizedSource = normalizeGitHubSource(source, { host: options.host });

    if (!normalizedSource) {
      throw new InvalidRepositorySourceError(source);
    }

    log.fetch(`Fetching repository ${normalizedSource.canonical}`);
    const result = await ensureRepositoryCache(normalizedSource, githubRef);

    log.spacer();
    log.success(
      `${result.action === "cloned" ? "Cloned" : "Refreshed"} repository cache for ${normalizedSource.canonical}`,
    );
    log.detail(`cache path: ${result.cachePath}`);
    log.detail(`resolved source: ${normalizedSource.sourceUrl}`);

    if (options.path) {
      log.detail(`path flag ignored for repository fetch: ${options.path}`);
    }

    const formattedRef = formatGitHubRef(githubRef);
    if (formattedRef) {
      log.detail(`ref: ${formattedRef}`);
    } else {
      log.detail("ref: default branch");
    }

    log.detail(`resolved commit: ${result.resolvedCommit}`);
  } catch (error) {
    log.error(formatFetchError(error));
    process.exit(1);
  }
}
