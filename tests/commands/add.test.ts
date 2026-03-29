import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { readLockFile } from "../../src/core/registry.js";
import {
  cleanTempDir,
  makeTempDir,
  buildAgentContent,
  createCachedGitHubRepository,
} from "../helpers.js";

const CANCEL_SIGNAL = Symbol("cancel");

let selectResponses: unknown[] = [];
let multiselectResponses: unknown[] = [];
let selectCalls: Array<Record<string, unknown>> = [];
let multiselectCalls: Array<Record<string, unknown>> = [];
let cancelMessages: string[] = [];

mock.module("@clack/prompts", () => ({
  select: async (options: Record<string, unknown>) => {
    selectCalls.push(options);
    return selectResponses.shift() ?? "local";
  },
  multiselect: async (options: Record<string, unknown>) => {
    multiselectCalls.push(options);
    return multiselectResponses.shift() ?? [];
  },
  isCancel: (value: unknown) => value === CANCEL_SIGNAL,
  cancel: (message: string) => {
    cancelMessages.push(message);
  },
}));

const { addCommand } = await import("../../src/commands/add.js");

let tempDir = "";
const originalCwd = process.cwd();
const originalConfigDir = process.env.AGENTS_IO_CONFIG_DIR;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const loggedMessages: string[] = [];
const errorMessages: string[] = [];

beforeEach(() => {
  selectResponses = [];
  multiselectResponses = [];
  selectCalls = [];
  multiselectCalls = [];
  cancelMessages = [];
  loggedMessages.length = 0;
  errorMessages.length = 0;
  console.log = (...args: unknown[]) => {
    loggedMessages.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errorMessages.push(args.map(String).join(" "));
  };
});

afterEach(async () => {
  process.chdir(originalCwd);
  process.env.AGENTS_IO_CONFIG_DIR = originalConfigDir;
  console.log = originalConsoleLog;
  console.error = originalConsoleError;

  if (tempDir) {
    await cleanTempDir(tempDir);
    tempDir = "";
  }
});

async function setupProject(projectDir: string): Promise<void> {
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "package.json"), '{"name":"test-project"}\n', "utf-8");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("add command (local sources)", () => {
  test("installs from a direct local path without network access", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "local-agent");

    await setupProject(projectDir);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({ name: "local-agent", description: "Direct local agent" }),
      "utf-8",
    );

    process.chdir(projectDir);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network should not be used for local add installs");
    }) as typeof fetch;

    try {
      await addCommand(sourceDir, { platform: "opencode", global: false });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const installedFile = await readFile(join(projectDir, "agents", "local-agent.md"), "utf-8");
    const lockFile = await readLockFile(false, projectDir);
    const entry = lockFile.agents["local-agent"];

    expect(installedFile).toContain("name: local-agent");
    expect(installedFile).toContain("Direct local agent");
    expect(entry.source).toBe(resolve(sourceDir));
    expect(entry.sourceType).toBe("local");
    expect(entry.sourceUrl).toBe(resolve(sourceDir));
    expect(entry.agentPath).toBe("");
    expect(entry.platforms).toEqual(["opencode"]);
    expect(entry.platformHashes).toEqual({ opencode: entry.hash });
    expect(loggedMessages).toContain("[>] Installing for opencode...");
    expect(loggedMessages).toContain("[#] Installed for opencode");
    expect(loggedMessages).not.toContainEqual(expect.stringContaining("ℹ □ Installing for opencode..."));
    expect(loggedMessages).not.toContainEqual(expect.stringContaining("✔ ■ Installed for opencode"));
  });

  test("runs a direct local dry run without network access or writes", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "local-agent");

    await setupProject(projectDir);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({ name: "local-agent", description: "Direct local agent" }),
      "utf-8",
    );

    selectResponses = ["local"];
    multiselectResponses = [["opencode", "claude-code"]];

    process.chdir(projectDir);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network should not be used for local add dry runs");
    }) as typeof fetch;

    try {
      await addCommand(sourceDir, { dryRun: true });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(selectCalls).toHaveLength(1);
    expect(multiselectCalls).toHaveLength(1);
    expect(selectCalls[0]?.message).toBe("Where should this agent be installed?");
    expect(multiselectCalls[0]?.message).toBe("Which platforms should this agent be installed for?");
    expect(loggedMessages.some((message) => message.includes("Dry run preview - no changes were made."))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("[>] Would install local-agent"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes(`resolved source: ${resolve(sourceDir)}`))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("scope: project"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("platforms: opencode, claude-code"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Dry run complete for local-agent"))).toBe(true);
    expect(await pathExists(join(projectDir, "agents"))).toBe(false);
    expect(await pathExists(join(projectDir, "agents-io-lock.json"))).toBe(false);
  });

  test("installs from a local root using --path without network access", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceRoot = join(tempDir, "agents-root");

    await setupProject(projectDir);
    await mkdir(join(sourceRoot, "agents", "nested-reviewer"), { recursive: true });
    await writeFile(
      join(sourceRoot, "agents", "nested-reviewer", "agent.md"),
      buildAgentContent({ name: "nested-reviewer", description: "Nested local agent" }),
      "utf-8",
    );

    process.chdir(projectDir);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network should not be used for local add installs");
    }) as typeof fetch;

    try {
      await addCommand(sourceRoot, {
        platform: "opencode",
        global: false,
        path: "agents/nested-reviewer",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const installedFile = await readFile(join(projectDir, "agents", "nested-reviewer.md"), "utf-8");
    const lockFile = await readLockFile(false, projectDir);
    const entry = lockFile.agents["nested-reviewer"];

    expect(installedFile).toContain("name: nested-reviewer");
    expect(installedFile).toContain("Nested local agent");
    expect(entry.source).toBe(resolve(sourceRoot));
    expect(entry.sourceType).toBe("local");
    expect(entry.sourceUrl).toBe(resolve(sourceRoot));
    expect(entry.agentPath).toBe("agents/nested-reviewer");
    expect(entry.platforms).toEqual(["opencode"]);
    expect(entry.platformHashes).toEqual({ opencode: entry.hash });
  });

  test("runs a discovery dry run for multiple local agents without writes", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceRoot = join(tempDir, "agents-root");

    await setupProject(projectDir);
    await mkdir(join(sourceRoot, "alpha"), { recursive: true });
    await mkdir(join(sourceRoot, "agents", "beta"), { recursive: true });
    await writeFile(
      join(sourceRoot, "alpha", "agent.md"),
      buildAgentContent({ name: "alpha-agent", description: "Alpha local agent" }),
      "utf-8",
    );
    await writeFile(
      join(sourceRoot, "agents", "beta", "agent.md"),
      buildAgentContent({ name: "beta-agent", description: "Beta local agent" }),
      "utf-8",
    );

    multiselectResponses = [["alpha", "agents/beta"], ["opencode", "kiro"]];
    selectResponses = ["global"];

    process.chdir(projectDir);
    await addCommand(sourceRoot, { dryRun: true });

    expect(multiselectCalls).toHaveLength(2);
    expect(selectCalls).toHaveLength(1);
    expect(multiselectCalls[0]?.message).toBe("Found 2 agents. Select which to install:");
    expect(selectCalls[0]?.message).toBe("Where should this agent be installed?");
    expect(multiselectCalls[1]?.message).toBe("Which platforms should this agent be installed for?");
    expect(loggedMessages.some((message) => message.includes("Dry run preview - no changes were made."))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("[>] Would install alpha-agent"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("[>] Would install beta-agent"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes(`resolved source: ${resolve(sourceRoot)}`))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("scope: global"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("platforms: opencode, kiro"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("agent path: alpha"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("agent path: agents/beta"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Dry run complete for 2 agent(s)"))).toBe(true);
    expect(await pathExists(join(projectDir, "agents"))).toBe(false);
    expect(await pathExists(join(projectDir, ".kiro"))).toBe(false);
    expect(await pathExists(join(projectDir, "agents-io-lock.json"))).toBe(false);
  });

  test("installs from cached GitHub SSH sources", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    const projectDir = join(tempDir, "project");
    await setupProject(projectDir);

    const repository = await createCachedGitHubRepository({
      rootDir: join(tempDir, "repo-root"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      owner: "goblin-systems",
      repo: "agents-io-team",
      files: {
        "agent.md": buildAgentContent({
          name: "team-agent",
          description: "Team agent from cached repository",
        }),
      },
    });

    expect(repository.cacheDir.endsWith(".git")).toBe(false);
    expect((await stat(join(repository.cacheDir, ".git"))).isDirectory()).toBe(true);

    process.chdir(projectDir);

    await addCommand("git@github.com:goblin-systems/agents-io-team.git", {
      platform: "opencode",
      global: false,
    });

    const installedFile = await readFile(join(projectDir, "agents", "team-agent.md"), "utf-8");
    const lockFile = await readLockFile(false, projectDir);
    const entry = lockFile.agents["team-agent"];

    expect(installedFile).toContain("Team agent from cached repository");
    expect(entry.source).toBe("goblin-systems/agents-io-team");
    expect(entry.sourceType).toBe("github");
    expect(entry.sourceUrl).toBe("https://github.com/goblin-systems/agents-io-team");
    expect(entry.repositoryUrl).toBe("git@github.com:goblin-systems/agents-io-team.git");
  });
});
