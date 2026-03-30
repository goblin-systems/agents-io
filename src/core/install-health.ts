import { access, readFile } from "fs/promises";
import { join } from "path";
import type { InstalledAgent, Platform } from "../types.js";
import { getGlobalDir, getProjectDir } from "../utils/paths.js";

export interface InstallIssue {
  message: string;
}

interface JsonReadResult {
  exists: boolean;
  value?: Record<string, unknown>;
  error?: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonObject(path: string): Promise<JsonReadResult> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        exists: true,
        error: "expected a JSON object",
      };
    }

    return {
      exists: true,
      value: parsed as Record<string, unknown>,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { exists: false };
    }

    return {
      exists: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getScopeDir(projectRoot: string, global: boolean, platform: Platform): string {
  return global ? getGlobalDir(platform) : getProjectDir(platform, projectRoot);
}

function startTag(name: string): string {
  return `<!-- agnts:${name}:start -->`;
}

function endTag(name: string): string {
  return `<!-- agnts:${name}:end -->`;
}

function getOpencodeRegistry(config: Record<string, unknown>): Record<string, unknown> | undefined {
  const registry = config.agent;
  return registry && typeof registry === "object" && !Array.isArray(registry)
    ? registry as Record<string, unknown>
    : undefined;
}

function getClaudeRegistry(config: Record<string, unknown>): Record<string, unknown> | undefined {
  const agents = config.agents;
  return agents && typeof agents === "object" && !Array.isArray(agents)
    ? agents as Record<string, unknown>
    : undefined;
}

export async function inspectPlatformInstall(
  name: string,
  entry: InstalledAgent,
  platform: Platform,
  projectRoot: string,
  global: boolean,
): Promise<InstallIssue[]> {
  const issues: InstallIssue[] = [];
  const scopeLabel = global ? "global" : "project";
  const targetDir = getScopeDir(projectRoot, global, platform);

  if (platform === "opencode") {
    const agentPath = join(targetDir, "agents", `${name}.md`);
    const configPath = join(targetDir, "opencode.json");
    const config = await readJsonObject(configPath);

    if (!(await pathExists(agentPath))) {
      issues.push({
        message: `${name} [${scopeLabel}/${platform}] is missing ${agentPath}. Reinstall with \`agents-io update ${name}${global ? " --global" : ""}${entry.platforms.length > 1 ? " --platform opencode" : ""}\` or remove the stale lock entry.`,
      });
    }

    if (!config.exists) {
      issues.push({
        message: `${name} [${scopeLabel}/${platform}] is missing ${configPath}. Reinstall with \`agents-io update ${name}${global ? " --global" : ""}${entry.platforms.length > 1 ? " --platform opencode" : ""}\` to restore the OpenCode registry.`,
      });
      return issues;
    }

    if (config.error) {
      issues.push({
        message: `${name} [${scopeLabel}/${platform}] could not read ${configPath}: ${config.error}. Fix the JSON or reinstall the agent.`,
      });
      return issues;
    }

    if (!getOpencodeRegistry(config.value ?? {})?.[name]) {
      issues.push({
        message: `${name} [${scopeLabel}/${platform}] is not registered in ${configPath}. Reinstall with \`agents-io update ${name}${global ? " --global" : ""}${entry.platforms.length > 1 ? " --platform opencode" : ""}\` to restore the registry entry.`,
      });
    }

    return issues;
  }

  if (platform === "claude-code") {
    const agentPath = join(targetDir, "agents", `${name}.md`);
    const settingsPath = join(targetDir, "settings.json");
    const settings = await readJsonObject(settingsPath);

    if (!(await pathExists(agentPath))) {
      issues.push({
        message: `${name} [${scopeLabel}/${platform}] is missing ${agentPath}. Reinstall with \`agents-io update ${name}${global ? " --global" : ""}${entry.platforms.length > 1 ? " --platform claude-code" : ""}\` or remove the stale lock entry.`,
      });
    }

    if (!settings.exists) {
      issues.push({
        message: `${name} [${scopeLabel}/${platform}] is missing ${settingsPath}. Reinstall with \`agents-io update ${name}${global ? " --global" : ""}${entry.platforms.length > 1 ? " --platform claude-code" : ""}\` to restore Claude Code settings.`,
      });
      return issues;
    }

    if (settings.error) {
      issues.push({
        message: `${name} [${scopeLabel}/${platform}] could not read ${settingsPath}: ${settings.error}. Fix the JSON or reinstall the agent.`,
      });
      return issues;
    }

    if (!getClaudeRegistry(settings.value ?? {})?.[name]) {
      issues.push({
        message: `${name} [${scopeLabel}/${platform}] is not registered in ${settingsPath}. Reinstall with \`agents-io update ${name}${global ? " --global" : ""}${entry.platforms.length > 1 ? " --platform claude-code" : ""}\` to restore the settings entry.`,
      });
    }

    return issues;
  }

  if (platform === "codex") {
    const agentsPath = join(targetDir, "AGENTS.md");

    try {
      const content = await readFile(agentsPath, "utf-8");
      if (!content.includes(startTag(name)) || !content.includes(endTag(name))) {
        issues.push({
          message: `${name} [${scopeLabel}/${platform}] is missing its managed section in ${agentsPath}. Reinstall with \`agents-io update ${name}${global ? " --global" : ""}${entry.platforms.length > 1 ? " --platform codex" : ""}\` to restore it.`,
        });
      }
    } catch (error) {
      issues.push({
        message: `${name} [${scopeLabel}/${platform}] could not read ${agentsPath}: ${error instanceof Error ? error.message : String(error)}. Reinstall the agent or restore the file.`,
      });
    }

    return issues;
  }

  const agentPath = join(targetDir, "agents", `${name}.json`);
  const agentJson = await readJsonObject(agentPath);

  if (!agentJson.exists) {
    issues.push({
      message: `${name} [${scopeLabel}/${platform}] is missing ${agentPath}. Reinstall with \`agents-io update ${name}${global ? " --global" : ""}${entry.platforms.length > 1 ? " --platform kiro" : ""}\` or remove the stale lock entry.`,
    });
    return issues;
  }

  if (agentJson.error) {
    issues.push({
      message: `${name} [${scopeLabel}/${platform}] could not read ${agentPath}: ${agentJson.error}. Fix the JSON or reinstall the agent.`,
    });
  }

  return issues;
}
