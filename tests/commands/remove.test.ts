import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { access, mkdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import claudeCodeAdapter from "../../src/adapters/claude-code.js";
import opencodeAdapter from "../../src/adapters/opencode.js";
import { getAgent, writeLockFile } from "../../src/core/registry.js";
import { parseAgentFile } from "../../src/core/parse.js";
import { buildAgentContent, cleanTempDir, makeTempDir } from "../helpers.js";

const CANCEL_SIGNAL = Symbol("cancel");

let selectResponse: unknown = "local";
let multiselectResponse: unknown = [];
let selectCalls: Array<Record<string, unknown>> = [];
let multiselectCalls: Array<Record<string, unknown>> = [];
let cancelMessages: string[] = [];

mock.module("@clack/prompts", () => ({
  select: async (options: Record<string, unknown>) => {
    selectCalls.push(options);
    return selectResponse;
  },
  multiselect: async (options: Record<string, unknown>) => {
    multiselectCalls.push(options);
    return multiselectResponse;
  },
  isCancel: (value: unknown) => value === CANCEL_SIGNAL,
  cancel: (message: string) => {
    cancelMessages.push(message);
  },
}));

const { removeCommand } = await import("../../src/commands/remove.js");

let tempDir = "";
let homeDir = "";
let configDir = "";
const originalCwd = process.cwd();
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalConfigDir = process.env.AGENTS_IO_CONFIG_DIR;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const loggedMessages: string[] = [];

beforeEach(() => {
  selectResponse = "local";
  multiselectResponse = [];
  selectCalls = [];
  multiselectCalls = [];
  cancelMessages = [];
  loggedMessages.length = 0;
  console.log = (...args: unknown[]) => {
    loggedMessages.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    loggedMessages.push(args.map(String).join(" "));
  };
});

afterEach(async () => {
  process.chdir(originalCwd);
  console.log = originalConsoleLog;
  console.error = originalConsoleError;

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  if (originalUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = originalUserProfile;
  }

  if (originalConfigDir === undefined) {
    delete process.env.AGENTS_IO_CONFIG_DIR;
  } else {
    process.env.AGENTS_IO_CONFIG_DIR = originalConfigDir;
  }

  if (tempDir) {
    await cleanTempDir(tempDir);
    tempDir = "";
  }
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return undefined;
  }
}

async function setupProject(): Promise<{ projectDir: string; agent: ReturnType<typeof parseAgentFile> }> {
  tempDir = await makeTempDir();
  homeDir = join(tempDir, "home");
  configDir = join(tempDir, "config");
  const projectDir = join(tempDir, "project");

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.AGENTS_IO_CONFIG_DIR = configDir;

  await mkdir(projectDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await writeFile(join(projectDir, "package.json"), '{"name":"test-project"}\n', "utf-8");
  process.chdir(projectDir);

  const agent = parseAgentFile(
    buildAgentContent({ name: "test-agent", description: "Test agent" }),
  );

  return { projectDir, agent };
}

function buildEntry(source: string, platforms: ("opencode" | "claude-code")[] = ["opencode"]) {
  return {
    source,
    sourceType: "local" as const,
    sourceUrl: source,
    agentPath: "",
    installedAt: "2026-03-28T00:00:00.000Z",
    platforms,
    hash: "abc123def456",
    platformHashes: Object.fromEntries(
      platforms.map((platform) => [platform, "abc123def456"]),
    ) as Record<(typeof platforms)[number], string>,
  };
}

describe("remove command", () => {
  test("prompts for scope and removes selected project agents when no name is provided", async () => {
    const { projectDir, agent } = await setupProject();
    const otherAgent = parseAgentFile(
      buildAgentContent({ name: "other-agent", description: "Other agent" }),
    );

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await opencodeAdapter.install({ agent: otherAgent, projectDir, global: false });

    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": buildEntry(projectDir),
          "other-agent": buildEntry(projectDir),
        },
      },
      false,
      projectDir,
    );

    selectResponse = "local";
    multiselectResponse = ["test-agent", "other-agent"];

    await removeCommand(undefined);

    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0]?.message).toBe("Where should agents be removed from?");
    expect(multiselectCalls).toHaveLength(1);
    expect(multiselectCalls[0]?.message).toBe("Which agents should be removed?");
    expect(multiselectCalls[0]?.options).toEqual([
      { value: "other-agent", label: "other-agent", hint: "opencode" },
      { value: "test-agent", label: "test-agent", hint: "opencode" },
    ]);
    expect(await pathExists(join(projectDir, "agents", "test-agent.md"))).toBe(false);
    expect(await pathExists(join(projectDir, "agents", "other-agent.md"))).toBe(false);
    expect(await getAgent("test-agent", false, projectDir)).toBeUndefined();
    expect(await getAgent("other-agent", false, projectDir)).toBeUndefined();
  });

  test("supports interactive global removal without prompting for scope when --global is set", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: true });
    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": buildEntry(homeDir),
        },
      },
      true,
      projectDir,
    );

    multiselectResponse = ["test-agent"];

    await removeCommand(undefined, { global: true });

    expect(selectCalls).toHaveLength(0);
    expect(multiselectCalls).toHaveLength(1);
    expect(await pathExists(join(homeDir, ".config", "opencode", "agents", "test-agent.md"))).toBe(false);
    expect(await getAgent("test-agent", true, projectDir)).toBeUndefined();
  });

  test("removes the only project-scoped install by default", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            source: projectDir,
            sourceType: "local",
            sourceUrl: projectDir,
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode"],
            hash: "abc123def456",
            platformHashes: { opencode: "abc123def456" },
          },
        },
      },
      false,
      projectDir,
    );

    await removeCommand("test-agent");

    expect(await pathExists(join(projectDir, "agents", "test-agent.md"))).toBe(false);
    const lockFile = JSON.parse(await readFile(join(projectDir, "agents-io-lock.json"), "utf-8")) as {
      agents: Record<string, unknown>;
    };
    expect(lockFile.agents["test-agent"]).toBeUndefined();
  });

  test("removes the only global-scoped install by default", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: true });
    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            source: homeDir,
            sourceType: "local",
            sourceUrl: homeDir,
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode"],
            hash: "abc123def456",
            platformHashes: { opencode: "abc123def456" },
          },
        },
      },
      true,
      projectDir,
    );

    await removeCommand("test-agent");

    expect(await pathExists(join(homeDir, ".config", "opencode", "agents", "test-agent.md"))).toBe(false);
    const lockFile = JSON.parse(
      await readFile(join(configDir, "agents-io-lock.json"), "utf-8"),
    ) as { agents: Record<string, unknown> };
    expect(lockFile.agents["test-agent"]).toBeUndefined();
  });

  test("requires an explicit scope when the agent exists in both places", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await opencodeAdapter.install({ agent, projectDir, global: true });

    const entry = buildEntry(projectDir);

    await writeLockFile({ version: 1, agents: { "test-agent": entry } }, false, projectDir);
    await writeLockFile({ version: 1, agents: { "test-agent": entry } }, true, projectDir);

    const cliPath = join(originalCwd, "src", "index.ts");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", cliPath, "remove", "test-agent"],
      cwd: projectDir,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        AGENTS_IO_CONFIG_DIR: configDir,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("installed in both project and global scope");
    expect(await pathExists(join(projectDir, "agents", "test-agent.md"))).toBe(true);
    expect(await pathExists(join(homeDir, ".config", "opencode", "agents", "test-agent.md"))).toBe(true);
  });

  test("supports explicit --local removal when both scopes exist", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await opencodeAdapter.install({ agent, projectDir, global: true });

    const localEntry = buildEntry(projectDir);
    const globalEntry = buildEntry(homeDir);

    await writeLockFile({ version: 1, agents: { "test-agent": localEntry } }, false, projectDir);
    await writeLockFile({ version: 1, agents: { "test-agent": globalEntry } }, true, projectDir);

    await removeCommand("test-agent", { local: true });

    expect(await pathExists(join(projectDir, "agents", "test-agent.md"))).toBe(false);
    expect(await pathExists(join(homeDir, ".config", "opencode", "agents", "test-agent.md"))).toBe(true);
  });

  test("supports explicit --global removal when both scopes exist", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await opencodeAdapter.install({ agent, projectDir, global: true });

    const localEntry = buildEntry(projectDir);
    const globalEntry = buildEntry(homeDir);

    await writeLockFile({ version: 1, agents: { "test-agent": localEntry } }, false, projectDir);
    await writeLockFile({ version: 1, agents: { "test-agent": globalEntry } }, true, projectDir);

    await removeCommand("test-agent", { global: true });

    expect(await pathExists(join(projectDir, "agents", "test-agent.md"))).toBe(true);
    expect(await pathExists(join(homeDir, ".config", "opencode", "agents", "test-agent.md"))).toBe(false);
  });

  test("supports explicit --all removal when both scopes exist", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await opencodeAdapter.install({ agent, projectDir, global: true });

    const localEntry = buildEntry(projectDir);
    const globalEntry = buildEntry(homeDir);

    await writeLockFile({ version: 1, agents: { "test-agent": localEntry } }, false, projectDir);
    await writeLockFile({ version: 1, agents: { "test-agent": globalEntry } }, true, projectDir);

    await removeCommand("test-agent", { all: true });

    expect(await pathExists(join(projectDir, "agents", "test-agent.md"))).toBe(false);
    expect(await pathExists(join(homeDir, ".config", "opencode", "agents", "test-agent.md"))).toBe(false);
  });

  test("previews a named removal without deleting files or updating the lock entry", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await mkdir(join(projectDir, ".claude"), { recursive: true });
    await writeFile(join(projectDir, ".claude", "settings.json"), "{}\n", "utf-8");
    await claudeCodeAdapter.install({ agent, projectDir, global: false });

    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            source: projectDir,
            sourceType: "local",
            sourceUrl: projectDir,
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode", "claude-code"],
            hash: "oldhash000001",
            platformHashes: {
              opencode: "oldhash000001",
              "claude-code": "newhash000002",
            },
          },
        },
      },
      false,
      projectDir,
    );

    const lockPath = join(projectDir, "agents-io-lock.json");
    const opencodePath = join(projectDir, "agents", "test-agent.md");
    const claudePath = join(projectDir, ".claude", "agents", "test-agent.md");
    const lockBefore = await readFile(lockPath, "utf-8");
    const opencodeBefore = await readFile(opencodePath, "utf-8");
    const claudeBefore = await readFile(claudePath, "utf-8");
    const lockStatBefore = await stat(lockPath);
    const opencodeStatBefore = await stat(opencodePath);
    const claudeStatBefore = await stat(claudePath);

    await removeCommand("test-agent", { dryRun: true, platform: "opencode" });

    const lockAfter = await readFile(lockPath, "utf-8");
    const opencodeAfter = await readFile(opencodePath, "utf-8");
    const claudeAfter = await readFile(claudePath, "utf-8");
    const lockStatAfter = await stat(lockPath);
    const opencodeStatAfter = await stat(opencodePath);
    const claudeStatAfter = await stat(claudePath);

    expect(loggedMessages.some((message) => message.includes("Dry run preview - no changes were made."))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Would remove 'test-agent' from project scope"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("scope: project"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("target platforms: opencode"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("registry action: update entry (remaining platforms: claude-code)"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Dry run complete for test-agent"))).toBe(true);
    expect(lockAfter).toBe(lockBefore);
    expect(opencodeAfter).toBe(opencodeBefore);
    expect(claudeAfter).toBe(claudeBefore);
    expect(lockStatAfter.mtimeMs).toBe(lockStatBefore.mtimeMs);
    expect(opencodeStatAfter.mtimeMs).toBe(opencodeStatBefore.mtimeMs);
    expect(claudeStatAfter.mtimeMs).toBe(claudeStatBefore.mtimeMs);
  });

  test("previews interactive removals without changing files or lock data", async () => {
    const { projectDir, agent } = await setupProject();
    const otherAgent = parseAgentFile(
      buildAgentContent({ name: "other-agent", description: "Other agent" }),
    );

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await opencodeAdapter.install({ agent: otherAgent, projectDir, global: false });

    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": buildEntry(projectDir),
          "other-agent": buildEntry(projectDir),
        },
      },
      false,
      projectDir,
    );

    const lockPath = join(projectDir, "agents-io-lock.json");
    const testAgentPath = join(projectDir, "agents", "test-agent.md");
    const otherAgentPath = join(projectDir, "agents", "other-agent.md");
    const lockBefore = await readFile(lockPath, "utf-8");
    const testBefore = await readFile(testAgentPath, "utf-8");
    const otherBefore = await readFile(otherAgentPath, "utf-8");
    const lockStatBefore = await stat(lockPath);
    const testStatBefore = await stat(testAgentPath);
    const otherStatBefore = await stat(otherAgentPath);

    selectResponse = "local";
    multiselectResponse = ["test-agent", "other-agent"];

    await removeCommand(undefined, { dryRun: true });

    const lockAfter = await readFile(lockPath, "utf-8");
    const testAfter = await readFile(testAgentPath, "utf-8");
    const otherAfter = await readFile(otherAgentPath, "utf-8");
    const lockStatAfter = await stat(lockPath);
    const testStatAfter = await stat(testAgentPath);
    const otherStatAfter = await stat(otherAgentPath);

    expect(selectCalls).toHaveLength(1);
    expect(multiselectCalls).toHaveLength(1);
    expect(loggedMessages.some((message) => message.includes("Dry run preview - no changes were made."))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Would remove 'test-agent' from project scope"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Would remove 'other-agent' from project scope"))).toBe(true);
    expect(loggedMessages.filter((message) => message.includes("registry action: remove entry"))).toHaveLength(2);
    expect(loggedMessages.some((message) => message.includes("Dry run complete for 2 agent(s)"))).toBe(true);
    expect(lockAfter).toBe(lockBefore);
    expect(testAfter).toBe(testBefore);
    expect(otherAfter).toBe(otherBefore);
    expect(lockStatAfter.mtimeMs).toBe(lockStatBefore.mtimeMs);
    expect(testStatAfter.mtimeMs).toBe(testStatBefore.mtimeMs);
    expect(otherStatAfter.mtimeMs).toBe(otherStatBefore.mtimeMs);
  });

  test("removes only the requested platform and preserves the lock entry", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await mkdir(join(projectDir, ".claude"), { recursive: true });
    await writeFile(join(projectDir, ".claude", "settings.json"), "{}\n", "utf-8");
    await claudeCodeAdapter.install({ agent, projectDir, global: false });

    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            source: projectDir,
            sourceType: "local",
            sourceUrl: projectDir,
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode", "claude-code"],
            hash: "oldhash000001",
            platformHashes: {
              opencode: "oldhash000001",
              "claude-code": "newhash000002",
            },
          },
        },
      },
      false,
      projectDir,
    );

    await removeCommand("test-agent", { platform: "opencode" });

    expect(await pathExists(join(projectDir, "agents", "test-agent.md"))).toBe(false);
    expect(await pathExists(join(projectDir, ".claude", "agents", "test-agent.md"))).toBe(true);

    const entry = await getAgent("test-agent", false, projectDir);
    expect(entry?.platforms).toEqual(["claude-code"]);
    expect(entry?.platformHashes).toEqual({ "claude-code": "newhash000002" });
    expect(entry?.hash).toBe("newhash000002");
  });

  test("removes the whole entry when a targeted platform is the last install", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            source: projectDir,
            sourceType: "local",
            sourceUrl: projectDir,
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode"],
            hash: "abc123def456",
            platformHashes: { opencode: "abc123def456" },
          },
        },
      },
      false,
      projectDir,
    );

    await removeCommand("test-agent", { platform: "opencode" });

    expect(await pathExists(join(projectDir, "agents", "test-agent.md"))).toBe(false);
    expect(await getAgent("test-agent", false, projectDir)).toBeUndefined();
  });

  test("supports --all with --platform across both scopes", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await opencodeAdapter.install({ agent, projectDir, global: true });

    await mkdir(join(projectDir, ".claude"), { recursive: true });
    await writeFile(join(projectDir, ".claude", "settings.json"), "{}\n", "utf-8");
    const globalClaudeDir = join(homeDir, ".claude");
    await mkdir(globalClaudeDir, { recursive: true });
    await writeFile(join(globalClaudeDir, "settings.json"), "{}\n", "utf-8");

    await claudeCodeAdapter.install({ agent, projectDir, global: false });
    await claudeCodeAdapter.install({ agent, projectDir, global: true });

    const localEntry = buildEntry(projectDir, ["opencode", "claude-code"]);
    const globalEntry = buildEntry(homeDir, ["opencode", "claude-code"]);

    await writeLockFile({ version: 1, agents: { "test-agent": localEntry } }, false, projectDir);
    await writeLockFile({ version: 1, agents: { "test-agent": globalEntry } }, true, projectDir);

    await removeCommand("test-agent", { all: true, platform: "opencode" });

    expect(await pathExists(join(projectDir, "agents", "test-agent.md"))).toBe(false);
    expect(await pathExists(join(homeDir, ".config", "opencode", "agents", "test-agent.md"))).toBe(false);
    expect(await pathExists(join(projectDir, ".claude", "agents", "test-agent.md"))).toBe(true);
    expect(await pathExists(join(homeDir, ".claude", "agents", "test-agent.md"))).toBe(true);

    const remainingLocal = await getAgent("test-agent", false, projectDir);
    const remainingGlobal = await getAgent("test-agent", true, projectDir);
    expect(remainingLocal?.platforms).toEqual(["claude-code"]);
    expect(remainingGlobal?.platforms).toEqual(["claude-code"]);
  });

  test("previews --all removals across both scopes without mutating either scope", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await opencodeAdapter.install({ agent, projectDir, global: true });

    const localEntry = buildEntry(projectDir);
    const globalEntry = buildEntry(homeDir);

    await writeLockFile({ version: 1, agents: { "test-agent": localEntry } }, false, projectDir);
    await writeLockFile({ version: 1, agents: { "test-agent": globalEntry } }, true, projectDir);

    const localLockPath = join(projectDir, "agents-io-lock.json");
    const globalLockPath = join(configDir, "agents-io-lock.json");
    const localAgentPath = join(projectDir, "agents", "test-agent.md");
    const globalAgentPath = join(homeDir, ".config", "opencode", "agents", "test-agent.md");
    const localLockBefore = await readFile(localLockPath, "utf-8");
    const globalLockBefore = await readFile(globalLockPath, "utf-8");
    const localAgentBefore = await readFile(localAgentPath, "utf-8");
    const globalAgentBefore = await readFile(globalAgentPath, "utf-8");

    await removeCommand("test-agent", { all: true, dryRun: true });

    expect(loggedMessages.some((message) => message.includes("Would remove 'test-agent' from project scope"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Would remove 'test-agent' from global scope"))).toBe(true);
    expect(loggedMessages.filter((message) => message.includes("registry action: remove entry"))).toHaveLength(2);
    expect(await readFile(localLockPath, "utf-8")).toBe(localLockBefore);
    expect(await readFile(globalLockPath, "utf-8")).toBe(globalLockBefore);
    expect(await readFile(localAgentPath, "utf-8")).toBe(localAgentBefore);
    expect(await readFile(globalAgentPath, "utf-8")).toBe(globalAgentBefore);
  });

  test("still requires an explicit scope when removing one platform from both-scoped installs", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await opencodeAdapter.install({ agent, projectDir, global: true });

    const entry = buildEntry(projectDir);

    await writeLockFile({ version: 1, agents: { "test-agent": entry } }, false, projectDir);
    await writeLockFile({ version: 1, agents: { "test-agent": entry } }, true, projectDir);

    const cliPath = join(originalCwd, "src", "index.ts");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", cliPath, "remove", "test-agent", "--platform", "opencode"],
      cwd: projectDir,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        AGENTS_IO_CONFIG_DIR: configDir,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("installed in both project and global scope");
  });

  test("keeps dry-run ambiguity behavior aligned with real remove", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await opencodeAdapter.install({ agent, projectDir, global: true });

    const entry = buildEntry(projectDir);

    await writeLockFile({ version: 1, agents: { "test-agent": entry } }, false, projectDir);
    await writeLockFile({ version: 1, agents: { "test-agent": entry } }, true, projectDir);

    const localPath = join(projectDir, "agents", "test-agent.md");
    const globalPath = join(homeDir, ".config", "opencode", "agents", "test-agent.md");
    const localBefore = await readIfExists(localPath);
    const globalBefore = await readIfExists(globalPath);

    const cliPath = join(originalCwd, "src", "index.ts");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", cliPath, "remove", "test-agent", "--dry-run"],
      cwd: projectDir,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        AGENTS_IO_CONFIG_DIR: configDir,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("installed in both project and global scope");
    expect(await readIfExists(localPath)).toBe(localBefore);
    expect(await readIfExists(globalPath)).toBe(globalBefore);
  });

  test("rejects mutually exclusive scope flags", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            source: projectDir,
            sourceType: "local",
            sourceUrl: projectDir,
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode"],
            hash: "abc123def456",
            platformHashes: { opencode: "abc123def456" },
          },
        },
      },
      false,
      projectDir,
    );

    const cliPath = join(originalCwd, "src", "index.ts");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", cliPath, "remove", "test-agent", "--local", "--global"],
      cwd: projectDir,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        AGENTS_IO_CONFIG_DIR: configDir,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Use only one of --local, --global, or --all");
  });
});
