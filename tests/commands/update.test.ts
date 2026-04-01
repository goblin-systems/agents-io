import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import claudeCodeAdapter from "../../src/adapters/claude-code.js";
import opencodeAdapter from "../../src/adapters/opencode.js";
import { fetchAgent } from "../../src/core/fetch.js";
import { hashContent, readLockFile, writeLockFile } from "../../src/core/registry.js";
import type { Platform } from "../../src/types.js";
import {
  buildAgentContent,
  captureConsoleMessage,
  cleanTempDir,
  commitAll,
  createCachedGitHubRepository,
  makeTempDir,
  runGit,
} from "../helpers.js";

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

const { updateCommand } = await import("../../src/commands/update.js");

let tempDir = "";
const originalCwd = process.cwd();
const originalConfigDir = process.env.AGENTS_IO_CONFIG_DIR;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const loggedMessages: string[] = [];
const errorMessages: string[] = [];

beforeEach(() => {
  selectResponse = "local";
  multiselectResponse = [];
  selectCalls = [];
  multiselectCalls = [];
  cancelMessages = [];
  loggedMessages.length = 0;
  errorMessages.length = 0;
  console.log = (...args: unknown[]) => {
    loggedMessages.push(captureConsoleMessage(args));
  };
  console.error = (...args: unknown[]) => {
    errorMessages.push(captureConsoleMessage(args));
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

async function writeProjectMarker(projectDir: string): Promise<void> {
  await writeFile(join(projectDir, "package.json"), '{"name":"test-project"}\n', "utf-8");
}

async function seedInstalledAgent(
  projectDir: string,
  sourceDir: string,
  platforms: Platform[],
): Promise<string> {
  const result = await fetchAgent(sourceDir);
  const initialHash = hashContent(result.agent.raw);

  for (const platform of platforms) {
    const adapter = platform === "opencode" ? opencodeAdapter : claudeCodeAdapter;
    await adapter.install({ agent: result.agent, projectDir, global: false });
  }

  await writeLockFile(
    {
      version: 1,
      agents: {
        "test-agent": {
          source: sourceDir,
          sourceType: "local",
          sourceUrl: sourceDir,
          agentPath: "",
          installedAt: "2026-03-28T00:00:00.000Z",
          platforms,
          hash: initialHash,
          platformHashes: Object.fromEntries(platforms.map((platform) => [platform, initialHash])),
        },
      },
    },
    false,
    projectDir,
  );

  return initialHash;
}

function buildEntry(source: string, platforms: Platform[] = ["opencode"]): {
  source: string;
  sourceType: "local";
  sourceUrl: string;
  host?: string;
  agentPath: string;
  installedAt: string;
  platforms: Platform[];
  hash: string;
  platformHashes: Partial<Record<Platform, string>>;
} {
  return {
    source,
    sourceType: "local",
    sourceUrl: source,
    agentPath: "",
    installedAt: "2026-03-28T00:00:00.000Z",
    platforms,
    hash: "abc123def456",
    platformHashes: Object.fromEntries(
      platforms.map((platform) => [platform, "abc123def456"]),
    ) as Partial<Record<Platform, string>>,
  };
}

describe("update command", () => {
  test("prompts for scope and updates selected global agents when no name is provided", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "agent-source");

    await mkdir(projectDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await writeProjectMarker(projectDir);

    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Updated description",
        body: "\n# Test Agent\n\nUpdated body.\n",
      }),
      "utf-8",
    );

    const result = await fetchAgent(sourceDir);
    await opencodeAdapter.install({ agent: result.agent, projectDir, global: true });
    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            ...buildEntry(sourceDir),
            hash: "oldhash000001",
            platformHashes: { opencode: "oldhash000001" },
          },
        },
      },
      true,
      projectDir,
    );

    selectResponse = "global";
    multiselectResponse = ["test-agent"];

    process.chdir(projectDir);
    await updateCommand(undefined);

    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0]?.message).toBe("Where should agents be updated?");
    expect(multiselectCalls).toHaveLength(1);
    expect(multiselectCalls[0]?.message).toBe("Which agents should be updated?");
    expect(multiselectCalls[0]?.options).toEqual([
      { value: "test-agent", label: "test-agent", hint: "opencode" },
    ]);

    const lockFile = await readLockFile(true, projectDir);
    expect(lockFile.agents["test-agent"]?.hash).toBe(hashContent(result.agent.raw));
  });

  test("uses explicit scope without prompting and reports platform-aware empty states", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "agent-source");

    await mkdir(projectDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await writeProjectMarker(projectDir);

    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({ name: "test-agent", description: "Test agent" }),
      "utf-8",
    );

    const result = await fetchAgent(sourceDir);
    await claudeCodeAdapter.install({ agent: result.agent, projectDir, global: false });
    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": buildEntry(sourceDir, ["claude-code"]),
        },
      },
      false,
      projectDir,
    );

    process.chdir(projectDir);
    await updateCommand(undefined, { local: true, platform: "opencode" });

    expect(selectCalls).toHaveLength(0);
    expect(multiselectCalls).toHaveLength(0);
    expect(loggedMessages.some((message) => message.includes("No agents installed in project scope."))).toBe(false);
    expect(loggedMessages.some((message) => message.includes("| No agents installed for opencode in project scope."))).toBe(true);
  });

  test("prints an explicit message when a selected agent has no update available", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "agent-source");

    await mkdir(projectDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await writeProjectMarker(projectDir);

    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Current description",
        body: "\n# Test Agent\n\nCurrent body.\n",
      }),
      "utf-8",
    );

    const currentHash = await seedInstalledAgent(projectDir, sourceDir, ["opencode"]);

    selectResponse = "local";
    multiselectResponse = ["test-agent"];

    process.chdir(projectDir);
    await updateCommand(undefined);

    expect(loggedMessages.some((message) => message.includes("No update available for 'test-agent'."))).toBe(true);

    const lockFile = await readLockFile(false, projectDir);
    expect(lockFile.agents["test-agent"]?.hash).toBe(currentHash);
  });

  test("preserves platforms metadata on targeted updates", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "agent-source");

    await mkdir(projectDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await writeProjectMarker(projectDir);

    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Initial description",
        body: "\n# Test Agent\n\nInitial body.\n",
      }),
      "utf-8",
    );

    const initialHash = await seedInstalledAgent(projectDir, sourceDir, ["opencode", "claude-code"]);

    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Updated description",
        body: "\n# Test Agent\n\nUpdated body.\n",
      }),
      "utf-8",
    );

    process.chdir(projectDir);
    await updateCommand("test-agent", { platform: "opencode" });

    const lockFile = await readLockFile(false, projectDir);
    const entry = lockFile.agents["test-agent"];
    const updatedHash = hashContent(await readFile(join(sourceDir, "agent.md"), "utf-8"));
    const opencodeFile = await readFile(join(projectDir, "agents", "test-agent.md"), "utf-8");
    const claudeFile = await readFile(join(projectDir, ".claude", "agents", "test-agent.md"), "utf-8");

    expect(entry.platforms).toEqual(["opencode", "claude-code"]);
    expect(entry.hash).toBe(initialHash);
    expect(entry.platformHashes).toEqual({
      opencode: updatedHash,
      "claude-code": initialHash,
    });
    expect(opencodeFile).toContain("Updated description");
    expect(opencodeFile).toContain("Updated body.");
    expect(claudeFile).toContain("Initial description");
    expect(claudeFile).toContain("Initial body.");
  });

  test("checks one named agent without writing adapter files or the lock file", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "agent-source");

    await mkdir(projectDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await writeProjectMarker(projectDir);

    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Initial description",
        body: "\n# Test Agent\n\nInitial body.\n",
      }),
      "utf-8",
    );

    await seedInstalledAgent(projectDir, sourceDir, ["opencode"]);

    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Updated description",
        body: "\n# Test Agent\n\nUpdated body.\n",
      }),
      "utf-8",
    );

    const lockPath = join(projectDir, "agents-io-lock.json");
    const installedPath = join(projectDir, "agents", "test-agent.md");
    const lockBefore = await readFile(lockPath, "utf-8");
    const installedBefore = await readFile(installedPath, "utf-8");
    const lockStatBefore = await stat(lockPath);
    const installedStatBefore = await stat(installedPath);

    process.chdir(projectDir);
    await updateCommand("test-agent", { check: true });

    const lockAfter = await readFile(lockPath, "utf-8");
    const installedAfter = await readFile(installedPath, "utf-8");
    const lockStatAfter = await stat(lockPath);
    const installedStatAfter = await stat(installedPath);

    expect(selectCalls).toHaveLength(0);
    expect(multiselectCalls).toHaveLength(0);
    expect(loggedMessages.some((message) => message.includes("test-agent has an update available"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("✓  Check complete"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Checked 1 agent(s): 0 up to date, 1 update available, 0 could not be checked"))).toBe(true);
    expect(loggedMessages.filter((message) => message === "|").length).toBe(2);
    expect(lockAfter).toBe(lockBefore);
    expect(installedAfter).toBe(installedBefore);
    expect(lockStatAfter.mtimeMs).toBe(lockStatBefore.mtimeMs);
    expect(installedStatAfter.mtimeMs).toBe(installedStatBefore.mtimeMs);
  });

  test("checks multiple agents and continues after fetch failures", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const currentSourceDir = join(tempDir, "current-agent-source");
    const outdatedSourceDir = join(tempDir, "outdated-agent-source");
    const missingSourceDir = join(tempDir, "missing-agent-source");

    await mkdir(projectDir, { recursive: true });
    await mkdir(currentSourceDir, { recursive: true });
    await mkdir(outdatedSourceDir, { recursive: true });
    await writeProjectMarker(projectDir);

    await writeFile(
      join(currentSourceDir, "agent.md"),
      buildAgentContent({
        name: "current-agent",
        description: "Current agent",
        body: "\n# Current Agent\n\nCurrent body.\n",
      }),
      "utf-8",
    );

    await writeFile(
      join(outdatedSourceDir, "agent.md"),
      buildAgentContent({
        name: "outdated-agent",
        description: "Old description",
        body: "\n# Outdated Agent\n\nOld body.\n",
      }),
      "utf-8",
    );

    const currentResult = await fetchAgent(currentSourceDir);
    const outdatedInitialResult = await fetchAgent(outdatedSourceDir);

    await opencodeAdapter.install({ agent: currentResult.agent, projectDir, global: false });
    await opencodeAdapter.install({ agent: outdatedInitialResult.agent, projectDir, global: false });

    const currentHash = hashContent(currentResult.agent.raw);
    const outdatedInitialHash = hashContent(outdatedInitialResult.agent.raw);

    await writeFile(
      join(outdatedSourceDir, "agent.md"),
      buildAgentContent({
        name: "outdated-agent",
        description: "New description",
        body: "\n# Outdated Agent\n\nNew body.\n",
      }),
      "utf-8",
    );

    await writeLockFile(
      {
        version: 1,
        agents: {
          "current-agent": {
            source: currentSourceDir,
            sourceType: "local",
            sourceUrl: currentSourceDir,
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode"],
            hash: currentHash,
            platformHashes: { opencode: currentHash },
          },
          "outdated-agent": {
            source: outdatedSourceDir,
            sourceType: "local",
            sourceUrl: outdatedSourceDir,
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode"],
            hash: outdatedInitialHash,
            platformHashes: { opencode: outdatedInitialHash },
          },
          "missing-agent": {
            source: missingSourceDir,
            sourceType: "local",
            sourceUrl: missingSourceDir,
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode"],
            hash: "missinghash01",
            platformHashes: { opencode: "missinghash01" },
          },
        },
      },
      false,
      projectDir,
    );

    selectResponse = "local";
    multiselectResponse = ["current-agent", "outdated-agent", "missing-agent"];

    process.chdir(projectDir);
    await updateCommand(undefined, { check: true });

    expect(multiselectCalls).toHaveLength(1);
    expect(multiselectCalls[0]?.message).toBe("Which agents should be checked?");
    expect(loggedMessages.some((message) => message.includes("current-agent is up to date"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("outdated-agent has an update available"))).toBe(true);
    expect(errorMessages.some((message) => message.includes("missing-agent could not be checked:"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("✓  Check complete"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Checked 3 agent(s): 1 up to date, 1 update available, 1 could not be checked"))).toBe(true);
    expect(loggedMessages.filter((message) => message === "|").length).toBe(4);
  });

  test("supports targeted updates from legacy lock entries without platformHashes", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "agent-source");

    await mkdir(projectDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await writeProjectMarker(projectDir);

    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Initial description",
        body: "\n# Test Agent\n\nInitial body.\n",
      }),
      "utf-8",
    );

    const initialHash = hashContent(await readFile(join(sourceDir, "agent.md"), "utf-8"));
    const result = await fetchAgent(sourceDir);
    await opencodeAdapter.install({ agent: result.agent, projectDir, global: false });
    await claudeCodeAdapter.install({ agent: result.agent, projectDir, global: false });

    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            source: sourceDir,
            sourceType: "local",
            sourceUrl: sourceDir,
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode", "claude-code"],
            hash: initialHash,
          },
        },
      },
      false,
      projectDir,
    );

    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Legacy updated description",
        body: "\n# Test Agent\n\nLegacy updated body.\n",
      }),
      "utf-8",
    );

    process.chdir(projectDir);
    await updateCommand("test-agent", { platform: "opencode" });

    const lockFile = await readLockFile(false, projectDir);
    const entry = lockFile.agents["test-agent"];
    const updatedHash = hashContent(await readFile(join(sourceDir, "agent.md"), "utf-8"));

    expect(entry.platforms).toEqual(["opencode", "claude-code"]);
    expect(entry.hash).toBe(initialHash);
    expect(entry.platformHashes).toEqual({
      opencode: updatedHash,
      "claude-code": initialHash,
    });
  });

  test("honors stored pinned GitHub branch refs during update", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    const projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });
    await writeProjectMarker(projectDir);

    const repository = await createCachedGitHubRepository({
      rootDir: join(tempDir, "repo-root"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      owner: "goblin-systems",
      repo: "agents-io-team",
      files: {
        "agent.md": buildAgentContent({
          name: "test-agent",
          description: "Main branch agent",
          body: "\n# Test Agent\n\nMain branch body.\n",
        }),
      },
    });

    await runGit(["checkout", "-b", "release"], repository.workingRepoDir);
    await writeFile(
      join(repository.workingRepoDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Release branch v1",
        body: "\n# Test Agent\n\nRelease branch body v1.\n",
      }),
      "utf-8",
    );
    await commitAll(repository.workingRepoDir, "Release branch v1");
    const releaseCommitV1 = await runGit(["rev-parse", "HEAD"], repository.workingRepoDir);
    await runGit(["push", "-u", "origin", "release"], repository.workingRepoDir);

    await runGit(["checkout", "main"], repository.workingRepoDir);

    const initialResult = await fetchAgent("goblin-systems/agents-io-team", {
      githubRef: { type: "branch", value: "release" },
    });
    await opencodeAdapter.install({
      agent: initialResult.agent,
      projectDir,
      global: false,
    });

    const initialHash = hashContent(initialResult.agent.raw);
    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            source: "goblin-systems/agents-io-team",
            sourceType: "github",
            sourceUrl: "https://github.com/goblin-systems/agents-io-team",
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode"],
            hash: initialHash,
            platformHashes: { opencode: initialHash },
            githubRef: {
              type: "branch",
              value: "release",
              resolvedCommit: releaseCommitV1,
            },
          },
        },
      },
      false,
      projectDir,
    );

    await writeFile(
      join(repository.workingRepoDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Main branch drift",
        body: "\n# Test Agent\n\nMain branch drift body.\n",
      }),
      "utf-8",
    );
    await commitAll(repository.workingRepoDir, "Main branch drift");
    await runGit(["push", "origin", "main"], repository.workingRepoDir);

    await runGit(["checkout", "release"], repository.workingRepoDir);
    await writeFile(
      join(repository.workingRepoDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Release branch v2",
        body: "\n# Test Agent\n\nRelease branch body v2.\n",
      }),
      "utf-8",
    );
    await commitAll(repository.workingRepoDir, "Release branch v2");
    const releaseCommitV2 = await runGit(["rev-parse", "HEAD"], repository.workingRepoDir);
    await runGit(["push", "origin", "release"], repository.workingRepoDir);

    process.chdir(projectDir);
    await updateCommand("test-agent");

    const lockFile = await readLockFile(false, projectDir);
    const entry = lockFile.agents["test-agent"];
    const installedFile = await readFile(join(projectDir, "agents", "test-agent.md"), "utf-8");

    expect(installedFile).toContain("Release branch v2");
    expect(installedFile).toContain("Release branch body v2.");
    expect(installedFile).not.toContain("Main branch drift");
    expect(entry.githubRef).toEqual({
      type: "branch",
      value: "release",
      resolvedCommit: releaseCommitV2,
    });
    expect(entry.platformHashes).toEqual({ opencode: entry.hash });
  });

  test("reapplies a persisted mode override during update", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "agent-source");

    await mkdir(projectDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await writeProjectMarker(projectDir);

    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Initial description",
        mode: "subagent",
        body: "\n# Test Agent\n\nInitial body.\n",
      }),
      "utf-8",
    );

    const initialResult = await fetchAgent(sourceDir);
    await opencodeAdapter.install({ agent: initialResult.agent, projectDir, global: false });

    const initialHash = hashContent(initialResult.agent.raw);
    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            source: sourceDir,
            sourceType: "local",
            sourceUrl: sourceDir,
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode"],
            hash: initialHash,
            platformHashes: { opencode: initialHash },
            modeOverride: "primary",
          },
        },
      },
      false,
      projectDir,
    );

    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Updated description",
        mode: "subagent",
        body: "\n# Test Agent\n\nUpdated body.\n",
      }),
      "utf-8",
    );

    process.chdir(projectDir);
    await updateCommand("test-agent");

    const installedFile = await readFile(join(projectDir, "agents", "test-agent.md"), "utf-8");
    const opencodeConfig = JSON.parse(await readFile(join(projectDir, "opencode.json"), "utf-8")) as {
      agent?: Record<string, { mode?: string }>;
    };
    const lockFile = await readLockFile(false, projectDir);

    expect(installedFile).toContain("mode: primary");
    expect(installedFile).toContain("Updated description");
    expect(opencodeConfig.agent?.["test-agent"]?.mode).toBe("primary");
    expect(lockFile.agents["test-agent"]?.modeOverride).toBe("primary");
  });

  test("refreshes cached GitHub repositories during update", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    const projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });
    await writeProjectMarker(projectDir);

    const repository = await createCachedGitHubRepository({
      rootDir: join(tempDir, "repo-root"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      owner: "goblin-systems",
      repo: "agents-io-team",
      files: {
        "agent.md": buildAgentContent({
          name: "test-agent",
          description: "Initial repository description",
          body: "\n# Test Agent\n\nInitial repository body.\n",
        }),
      },
    });

    expect(repository.cacheDir.endsWith(".git")).toBe(false);
    expect((await stat(join(repository.cacheDir, ".git"))).isDirectory()).toBe(true);
    expect(await readFile(join(repository.cacheDir, "agent.md"), "utf-8")).toContain(
      "Initial repository description",
    );

    const initialResult = await fetchAgent("goblin-systems/agents-io-team");
    await opencodeAdapter.install({
      agent: initialResult.agent,
      projectDir,
      global: false,
    });

    const initialHash = hashContent(initialResult.agent.raw);
    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            source: "goblin-systems/agents-io-team",
            sourceType: "github",
            sourceUrl: "https://github.com/goblin-systems/agents-io-team",
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode"],
            hash: initialHash,
            platformHashes: { opencode: initialHash },
          },
        },
      },
      false,
      projectDir,
    );

    await writeFile(
      join(repository.workingRepoDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Updated repository description",
        body: "\n# Test Agent\n\nUpdated repository body.\n",
      }),
      "utf-8",
    );
    await commitAll(repository.workingRepoDir, "Update agent");
    await runGit(["push", "origin", "main"], repository.workingRepoDir);

    process.chdir(projectDir);
    await updateCommand("test-agent");

    const lockFile = await readLockFile(false, projectDir);
    const entry = lockFile.agents["test-agent"];
    const installedFile = await readFile(join(projectDir, "agents", "test-agent.md"), "utf-8");
    const refreshedCacheFile = await readFile(join(repository.cacheDir, "agent.md"), "utf-8");

    expect(entry.hash).toBe(hashContent(refreshedCacheFile));
    expect(entry.platformHashes).toEqual({ opencode: entry.hash });
    expect(installedFile).toContain("Updated repository description");
    expect(installedFile).toContain("Updated repository body.");
    expect(refreshedCacheFile).toContain("Updated repository description");
  });

  test("uses stored enterprise repository metadata during update", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    const projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });
    await writeProjectMarker(projectDir);

    const repository = await createCachedGitHubRepository({
      rootDir: join(tempDir, "repo-root"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      host: "github.mycompany.com",
      owner: "goblin-systems",
      repo: "agents-io-team",
      files: {
        "agent.md": buildAgentContent({
          name: "test-agent",
          description: "Initial enterprise description",
          body: "\n# Test Agent\n\nInitial enterprise body.\n",
        }),
      },
    });

    const initialResult = await fetchAgent("goblin-systems/agents-io-team", {
      host: "github.mycompany.com",
    });
    await opencodeAdapter.install({
      agent: initialResult.agent,
      projectDir,
      global: false,
    });

    const initialHash = hashContent(initialResult.agent.raw);
    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            source: "goblin-systems/agents-io-team",
            sourceType: "github",
            sourceUrl: "https://github.mycompany.com/goblin-systems/agents-io-team",
            repositoryUrl: "https://github.mycompany.com/goblin-systems/agents-io-team.git",
            host: "github.mycompany.com",
            agentPath: "",
            installedAt: "2026-03-28T00:00:00.000Z",
            platforms: ["opencode"],
            hash: initialHash,
            platformHashes: { opencode: initialHash },
          },
        },
      },
      false,
      projectDir,
    );

    await writeFile(
      join(repository.workingRepoDir, "agent.md"),
      buildAgentContent({
        name: "test-agent",
        description: "Updated enterprise description",
        body: "\n# Test Agent\n\nUpdated enterprise body.\n",
      }),
      "utf-8",
    );
    await commitAll(repository.workingRepoDir, "Update enterprise agent");
    await runGit(["push", "origin", "main"], repository.workingRepoDir);

    process.chdir(projectDir);
    await updateCommand("test-agent");

    const lockFile = await readLockFile(false, projectDir);
    const entry = lockFile.agents["test-agent"];
    const installedFile = await readFile(join(projectDir, "agents", "test-agent.md"), "utf-8");

    expect(entry.sourceUrl).toBe("https://github.mycompany.com/goblin-systems/agents-io-team");
    expect(entry.repositoryUrl).toBe("https://github.mycompany.com/goblin-systems/agents-io-team.git");
    expect(entry.host).toBe("github.mycompany.com");
    expect(installedFile).toContain("Updated enterprise description");
    expect(installedFile).toContain("Updated enterprise body.");
  });

  test("rejects mutually exclusive scope flags", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "agent-source");

    await mkdir(projectDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await writeProjectMarker(projectDir);

    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({ name: "test-agent", description: "Test agent" }),
      "utf-8",
    );

    await seedInstalledAgent(projectDir, sourceDir, ["opencode"]);

    const cliPath = join(originalCwd, "src", "index.ts");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", cliPath, "update", "test-agent", "--local", "--global"],
      cwd: projectDir,
      env: process.env,
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Use only one of --local or --global");
  });
});
