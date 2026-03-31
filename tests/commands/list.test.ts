import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { listCommand } from "../../src/commands/list.js";
import { writeLockFile } from "../../src/core/registry.js";
import type { InstalledAgent, LockFile } from "../../src/types.js";
import { captureConsoleMessage, cleanTempDir, makeTempDir } from "../helpers.js";

let tempDir = "";
const originalCwd = process.cwd();
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalConfigDir = process.env.AGENTS_IO_CONFIG_DIR;
const originalConsoleLog = console.log;
const loggedMessages: string[] = [];

afterEach(async () => {
  process.chdir(originalCwd);
  console.log = originalConsoleLog;
  loggedMessages.length = 0;

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

function captureLogs(): void {
  console.log = (...args: unknown[]) => {
    loggedMessages.push(captureConsoleMessage(args));
  };
}

function buildEntry(overrides: Partial<InstalledAgent> = {}): InstalledAgent {
  return {
    source: overrides.source ?? "owner/repo",
    sourceType: overrides.sourceType ?? "github",
    sourceUrl: overrides.sourceUrl ?? "https://github.com/owner/repo",
    agentPath: overrides.agentPath ?? "",
    installedAt: overrides.installedAt ?? "2026-03-29T00:00:00.000Z",
    platforms: overrides.platforms ?? ["opencode"],
    hash: overrides.hash ?? "abc123def456",
    platformHashes: overrides.platformHashes,
    repositoryUrl: overrides.repositoryUrl,
    host: overrides.host,
    githubRef: overrides.githubRef,
  };
}

async function setupProject(): Promise<{ projectDir: string; globalConfigDir: string }> {
  tempDir = await makeTempDir();

  const homeDir = join(tempDir, "home");
  const globalConfigDir = join(tempDir, "config");
  const projectDir = join(tempDir, "project");

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.AGENTS_IO_CONFIG_DIR = globalConfigDir;

  await mkdir(homeDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "package.json"), '{"name":"test-project"}\n', "utf-8");
  process.chdir(projectDir);

  captureLogs();

  return { projectDir, globalConfigDir };
}

describe("list command", () => {
  test("keeps default output concise", async () => {
    const { projectDir } = await setupProject();

    const lockFile: LockFile = {
      version: 1,
      agents: {
        reviewer: buildEntry(),
      },
    };

    await writeLockFile(lockFile, false, projectDir);

    await listCommand();

    expect(loggedMessages.some((message) => message.includes("▨  Project agents"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("lock file:"))).toBe(false);
    expect(loggedMessages.some((message) => message.includes("[synced]"))).toBe(false);
  });

  test("shows lock paths, scope state, and status labels in verbose mode", async () => {
    const { projectDir, globalConfigDir } = await setupProject();

    await writeLockFile(
      {
        version: 1,
        agents: {
          synced: buildEntry({
            platforms: ["opencode", "claude-code"],
            platformHashes: {
              opencode: "abc123def456",
              "claude-code": "abc123def456",
            },
          }),
          mixed: buildEntry({
            source: projectDir,
            sourceType: "local",
            sourceUrl: projectDir,
            hash: "abc123def456",
            platforms: ["opencode", "claude-code"],
            platformHashes: {
              opencode: "abc123def456",
              "claude-code": "zzz999yyy888",
            },
          }),
        },
      },
      false,
      projectDir,
    );

    await listCommand({ verbose: true });

    expect(loggedMessages.some((message) => message.includes("▨  Project agents"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("▨  Global agents"))).toBe(true);
    expect(
      loggedMessages.some((message) =>
        message.includes(`lock file: ${join(projectDir, "agents-io-lock.json")}`),
      ),
    ).toBe(true);
    expect(
      loggedMessages.some((message) =>
        message.includes(`lock file: ${join(globalConfigDir, "agents-io-lock.json")}`),
      ),
    ).toBe(true);
    expect(loggedMessages.some((message) => message.includes("state: present"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("state: missing"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("[synced]"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("[mixed]"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("no agents installed"))).toBe(true);
    expect(loggedMessages).toContain("|");
  });

  test("shows pinned and unpinned GitHub state in list output", async () => {
    const { projectDir } = await setupProject();

    await writeLockFile(
      {
        version: 1,
        agents: {
          pinned: buildEntry({
            githubRef: {
              type: "branch",
              value: "release",
              resolvedCommit: "abcdef1234567890",
            },
          }),
          unpinned: buildEntry({
            source: "owner/other-repo",
            sourceUrl: "https://github.com/owner/other-repo",
          }),
        },
      },
      false,
      projectDir,
    );

    await listCommand();

    expect(loggedMessages.some((message) => message.includes("branch:release @ abcdef1"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("github, unpinned"))).toBe(true);
  });

  test("shows enterprise GitHub sources using canonical owner/repo labels", async () => {
    const { projectDir } = await setupProject();

    await writeLockFile(
      {
        version: 1,
        agents: {
          enterprise: buildEntry({
            source: "owner/enterprise-repo",
            sourceUrl: "https://github.mycompany.com/owner/enterprise-repo",
            repositoryUrl: "https://github.mycompany.com/owner/enterprise-repo.git",
            host: "github.mycompany.com",
          }),
        },
      },
      false,
      projectDir,
    );

    await listCommand();

    expect(loggedMessages.some((message) => message.includes("enterprise - owner/enterprise-repo (github, unpinned)"))).toBe(true);
  });
});
