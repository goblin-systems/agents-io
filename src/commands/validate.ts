import { fetchAgent, LocalAgentNotFoundError } from "../core/fetch.js";
import { resolveAgentSource } from "../core/resolve-agent-source.js";
import {
  InvalidRepositorySourceError,
  RepositoryAgentNotFoundError,
} from "../core/repositories.js";
import { log } from "../utils/logger.js";

export interface ValidateOptions {
  path?: string;
  host?: string;
}

function formatValidationError(error: unknown): string {
  if (error instanceof LocalAgentNotFoundError) {
    return `Validation failed: no agent.md found at ${error.agentFilePath}. Check the local path or pass --path <path> to point at the folder containing agent.md.`;
  }

  if (error instanceof RepositoryAgentNotFoundError) {
    return `Validation failed: no agent.md found in ${error.repository} at ${error.agentPath}. Check the repository path or pass --path <path> to point at the folder containing agent.md.`;
  }

  if (error instanceof InvalidRepositorySourceError) {
    return `${error.message}. Use owner/repo, a supported GitHub or GitHub Enterprise URL, or a local filesystem path.`;
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
    log.inspect(`Validating agent from ${source}`);

    if (options.path) {
      const result = await fetchAgent(source, { path: options.path, host: options.host });
      const name = result.agent.frontmatter.name;

      log.spacer();
      log.success(`Agent '${name}' is valid`);
      log.detail(`resolved source: ${result.resolvedSource}`);
      log.detail(`agent path: ${options.path}`);
      return;
    }

    const resolvedSource = await resolveAgentSource(source, undefined, options.host);

    if (resolvedSource.kind === "root") {
      const name = resolvedSource.result.agent.frontmatter.name;

      log.spacer();
      log.success(`Agent '${name}' is valid`);
      log.detail(`resolved source: ${resolvedSource.result.resolvedSource}`);
      return;
    }

    if (resolvedSource.kind === "convertible-root") {
      throw resolvedSource.rootError;
    }

    log.detail("No root agent.md found. Searching for agents in subdirectories...");
    log.spacer();

    for (const discoveredAgent of resolvedSource.agents) {
      const result = await fetchAgent(source, { path: discoveredAgent.path, host: options.host });
      log.success(`Agent '${result.agent.frontmatter.name}' is valid`);
      log.detail(`resolved source: ${result.resolvedSource}`);
      log.detail(`agent path: ${discoveredAgent.path}`);
      log.spacer();
    }

    log.success(`Validated ${resolvedSource.agents.length} agent(s)`);
  } catch (error) {
    log.error(formatValidationError(error));
    process.exit(1);
  }
}
