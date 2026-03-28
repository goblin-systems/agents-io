import { mkdir, readFile, writeFile, unlink, readdir, rmdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import matter from "gray-matter";
import type { Adapter, AdapterContext, AgentFrontmatter } from "../types.js";

const OPENCODE_CONFIG = "opencode.json";
const AGENTS_DIR = "agents";

function globalConfigDir(): string {
  return join(homedir(), ".config", "opencode");
}

function configDir(projectDir: string, global: boolean): string {
  return global ? globalConfigDir() : projectDir;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeJsonFile(
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function buildFrontmatter(
  fm: AgentFrontmatter,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    name: fm.name,
    description: fm.description,
  };
  if (fm.mode) {
    data.mode = fm.mode;
  }
  if (fm.tools && Object.keys(fm.tools).length > 0) {
    data.tools = fm.tools;
  }
  return data;
}

async function detect(projectDir: string): Promise<boolean> {
  const projectConfig = join(projectDir, OPENCODE_CONFIG);
  const globalConfig = join(globalConfigDir(), OPENCODE_CONFIG);
  return (await fileExists(projectConfig)) || (await fileExists(globalConfig));
}

async function install(ctx: AdapterContext): Promise<void> {
  const { agent, projectDir, global } = ctx;
  const name = agent.frontmatter.name;
  const dir = configDir(projectDir, global);
  const agentsDir = join(dir, AGENTS_DIR);
  const agentFile = join(agentsDir, `${name}.md`);
  const configFile = join(dir, OPENCODE_CONFIG);

  // Ensure agents directory exists
  await mkdir(agentsDir, { recursive: true });

  // Build the agent markdown file with frontmatter
  const frontmatterData = buildFrontmatter(agent.frontmatter);
  const markdown = matter.stringify(agent.body, frontmatterData);
  await writeFile(agentFile, markdown, "utf-8");

  // Update opencode.json — preserve existing config, only touch "agent" key
  const config = await readJsonFile(configFile);
  const agentRegistry =
    (config.agent as Record<string, unknown> | undefined) ?? {};
  agentRegistry[name] = {};
  config.agent = agentRegistry;
  await writeJsonFile(configFile, config);
}

async function uninstall(
  name: string,
  projectDir: string,
  global: boolean,
): Promise<void> {
  const dir = configDir(projectDir, global);
  const agentsDir = join(dir, AGENTS_DIR);
  const agentFile = join(agentsDir, `${name}.md`);
  const configFile = join(dir, OPENCODE_CONFIG);

  // Remove the agent markdown file
  try {
    await unlink(agentFile);
  } catch {
    // File may not exist — that's fine
  }

  // Remove agent entry from opencode.json
  try {
    const config = await readJsonFile(configFile);
    const agentRegistry = config.agent as
      | Record<string, unknown>
      | undefined;
    if (agentRegistry) {
      delete agentRegistry[name];
      config.agent = agentRegistry;
      await writeJsonFile(configFile, config);
    }
  } catch {
    // Config may not exist — nothing to clean up
  }

  // Remove agents directory if empty
  try {
    const entries = await readdir(agentsDir);
    if (entries.length === 0) {
      await rmdir(agentsDir);
    }
  } catch {
    // Directory may not exist — that's fine
  }
}

const opencodeAdapter: Adapter = { name: "opencode", detect, install, uninstall };
export default opencodeAdapter;
