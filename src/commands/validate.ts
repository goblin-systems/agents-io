import { fetchAgent, LocalAgentNotFoundError } from "../core/fetch.js";
import {
  InvalidRepositorySourceError,
  RepositoryAgentNotFoundError,
} from "../core/repositories.js";
import { log } from "../utils/logger.js";

export interface ValidateOptions {
  path?: string;
}

function formatValidationError(error: unknown): string {
  if (error instanceof LocalAgentNotFoundError) {
    return `Validation failed: no agent.md found at ${error.agentFilePath}. Check the local path or pass --path <path> to point at the folder containing agent.md.`;
  }

  if (error instanceof RepositoryAgentNotFoundError) {
    return `Validation failed: no agent.md found in ${error.repository} at ${error.agentPath}. Check the repository path or pass --path <path> to point at the folder containing agent.md.`;
  }

  if (error instanceof InvalidRepositorySourceError) {
    return `${error.message}. Use owner/repo, a supported GitHub URL, or a local filesystem path.`;
  }

  if (error instanceof Error) {
    return `Validation failed: ${error.message}`;
  }

  return `Validation failed: ${String(error)}`;
}

export async function validateCommand(
  source: string,
  options: ValidateOptions = {},
): Promise<void> {
  try {
    log.info(`Validating agent from ${source}...`);

    const result = await fetchAgent(source, { path: options.path });
    const name = result.agent.frontmatter.name;

    log.success(`Agent '${name}' is valid`);
    log.dim(`  resolved source: ${result.resolvedSource}`);

    if (options.path) {
      log.dim(`  agent path: ${options.path}`);
    }
  } catch (error) {
    log.error(formatValidationError(error));
    process.exit(1);
  }
}
