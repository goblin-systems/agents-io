import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { readLockFile } from "../../src/core/registry.js";
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
const originalExit = process.exit;
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
    loggedMessages.push(captureConsoleMessage(args));
  };
  console.error = (...args: unknown[]) => {
    errorMessages.push(captureConsoleMessage(args));
  };
  process.exit = ((code?: number) => {
    throw new Error(`EXIT:${code ?? 0}`);
  }) as typeof process.exit;
});

afterEach(async () => {
  process.chdir(originalCwd);
  process.env.AGENTS_IO_CONFIG_DIR = originalConfigDir;
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalExit;

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
    expect(loggedMessages).toContain("⫸  Installing agent");
    expect(loggedMessages).toContain("| local-agent -> opencode");
    expect(loggedMessages).toContain("✓  Installation complete");
    expect(loggedMessages[loggedMessages.indexOf("✓  Installation complete") - 1]).toBe("|");
    expect(loggedMessages).not.toContainEqual(expect.stringContaining("[>]"));
    expect(loggedMessages).not.toContainEqual(expect.stringContaining("[#]"));
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
    expect(loggedMessages.some((message) => message.includes("Preparing dry run"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Previewing local-agent"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes(`resolved source: ${resolve(sourceDir)}`))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("scope: project"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("platforms: opencode, claude-code"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("mode: subagent"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Dry run complete for local-agent"))).toBe(true);
    expect(await pathExists(join(projectDir, "agents"))).toBe(false);
    expect(await pathExists(join(projectDir, "agents-io-lock.json"))).toBe(false);
  });

  test("persists a mode override and applies it during install output", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "local-agent");

    await setupProject(projectDir);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "local-agent",
        description: "Direct local agent",
      }),
      "utf-8",
    );

    process.chdir(projectDir);

    await addCommand(sourceDir, { platform: "opencode", global: false, mode: "primary" });

    const installedFile = await readFile(join(projectDir, "agents", "local-agent.md"), "utf-8");
    const opencodeConfig = JSON.parse(await readFile(join(projectDir, "opencode.json"), "utf-8")) as {
      agent?: Record<string, { mode?: string }>;
    };
    const lockFile = await readLockFile(false, projectDir);
    const entry = lockFile.agents["local-agent"];

    expect(installedFile).toContain("mode: primary");
    expect(opencodeConfig.agent?.["local-agent"]?.mode).toBe("primary");
    expect(entry.modeOverride).toBe("primary");
    expect(loggedMessages).toContain("| mode: primary");
  });

  test("uses mode override in dry-run output and compatibility warnings", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "mode-warning-agent");

    await setupProject(projectDir);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "mode-warning-agent",
        description: "Mode warning agent",
      }),
      "utf-8",
    );

    process.chdir(projectDir);
    await addCommand(sourceDir, {
      platform: "codex",
      global: false,
      dryRun: true,
      mode: "primary",
    });

    expect(loggedMessages).toContain("!  Compatibility warnings for mode-warning-agent");
    expect(loggedMessages.some((message) => message.includes("[codex]") && message.includes("`mode: primary`"))).toBe(true);
    expect(loggedMessages).toContain("| mode: primary");
  });

  test("rejects invalid mode overrides", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "invalid-mode-agent");

    await setupProject(projectDir);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "invalid-mode-agent",
        description: "Invalid mode agent",
      }),
      "utf-8",
    );

    process.chdir(projectDir);

    await expect(
      addCommand(sourceDir, { platform: "opencode", global: false, mode: "leader" }),
    ).rejects.toThrow("EXIT:1");

    expect(errorMessages.some((message) => message.includes("Invalid mode 'leader'. Expected one of: primary, subagent"))).toBe(true);
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
    expect(loggedMessages.some((message) => message.includes("⇄  Previewing selected agents"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Preparing dry run"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Previewing alpha-agent"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Previewing beta-agent"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes(`resolved source: ${resolve(sourceRoot)}`))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("scope: global"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("platforms: opencode, kiro"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("agent path: alpha"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("agent path: agents/beta"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Dry run complete for 2 agent(s)"))).toBe(true);
    expect(loggedMessages[loggedMessages.indexOf("⇄  Previewing selected agents") - 1]).toBe("|");
    const fetchIndexes = loggedMessages.reduce<number[]>((indexes, message, index) => {
      if (message === `⇅  Fetching agent from ${sourceRoot}`) {
        indexes.push(index);
      }
      return indexes;
    }, []);
    expect(fetchIndexes).toHaveLength(3);
    expect(loggedMessages[loggedMessages.indexOf("✓  Dry run complete for 2 agent(s)") - 1]).toBe("|");
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
      owner: "Sergej-Popov",
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

    await addCommand("git@github.com:Sergej-Popov/agents-io-team.git", {
      platform: "opencode",
      global: false,
    });

    const installedFile = await readFile(join(projectDir, "agents", "team-agent.md"), "utf-8");
    const lockFile = await readLockFile(false, projectDir);
    const entry = lockFile.agents["team-agent"];

    expect(installedFile).toContain("Team agent from cached repository");
    expect(entry.source).toBe("Sergej-Popov/agents-io-team");
    expect(entry.sourceType).toBe("github");
    expect(entry.sourceUrl).toBe("https://github.com/Sergej-Popov/agents-io-team");
    expect(entry.repositoryUrl).toBe("git@github.com:Sergej-Popov/agents-io-team.git");
    expect(entry.host).toBe("github.com");
  });

  test("installs from GitHub Enterprise shorthand sources using --host", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    const projectDir = join(tempDir, "project");
    await setupProject(projectDir);

    await createCachedGitHubRepository({
      rootDir: join(tempDir, "repo-root"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      host: "github.mycompany.com",
      owner: "Sergej-Popov",
      repo: "agents-io-team",
      files: {
        "agent.md": buildAgentContent({
          name: "team-agent",
          description: "Enterprise team agent from cached repository",
        }),
      },
    });

    process.chdir(projectDir);

    await addCommand("Sergej-Popov/agents-io-team", {
      platform: "opencode",
      global: false,
      host: "github.mycompany.com",
    });

    const installedFile = await readFile(join(projectDir, "agents", "team-agent.md"), "utf-8");
    const lockFile = await readLockFile(false, projectDir);
    const entry = lockFile.agents["team-agent"];

    expect(installedFile).toContain("Enterprise team agent from cached repository");
    expect(entry.source).toBe("Sergej-Popov/agents-io-team");
    expect(entry.sourceType).toBe("github");
    expect(entry.sourceUrl).toBe("https://github.mycompany.com/Sergej-Popov/agents-io-team");
    expect(entry.repositoryUrl).toBe("https://github.mycompany.com/Sergej-Popov/agents-io-team.git");
    expect(entry.host).toBe("github.mycompany.com");
  });

  test("persists pinned GitHub branch metadata in the lock file", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    const projectDir = join(tempDir, "project");
    await setupProject(projectDir);

    const repository = await createCachedGitHubRepository({
      rootDir: join(tempDir, "repo-root"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      owner: "Sergej-Popov",
      repo: "agents-io-team",
      files: {
        "agent.md": buildAgentContent({
          name: "team-agent",
          description: "Main branch agent",
        }),
      },
    });

    await runGit(["checkout", "-b", "release"], repository.workingRepoDir);
    await writeFile(
      join(repository.workingRepoDir, "agent.md"),
      buildAgentContent({
        name: "team-agent",
        description: "Release branch agent",
      }),
      "utf-8",
    );
    await commitAll(repository.workingRepoDir, "Release branch agent");
    const releaseCommit = await runGit(["rev-parse", "HEAD"], repository.workingRepoDir);
    await runGit(["push", "-u", "origin", "release"], repository.workingRepoDir);

    process.chdir(projectDir);
    await addCommand("Sergej-Popov/agents-io-team", {
      platform: "opencode",
      global: false,
      branch: "release",
    });

    const installedFile = await readFile(join(projectDir, "agents", "team-agent.md"), "utf-8");
    const lockFile = await readLockFile(false, projectDir);
    const entry = lockFile.agents["team-agent"];

    expect(installedFile).toContain("Release branch agent");
    expect(entry.githubRef).toEqual({
      type: "branch",
      value: "release",
      resolvedCommit: releaseCommit,
    });
  });

  test("rejects mutually exclusive GitHub ref flags", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    await setupProject(projectDir);

    const cliPath = join(originalCwd, "src", "index.ts");
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "run",
        cliPath,
        "add",
        "Sergej-Popov/agents-io-team",
        "--branch",
        "release",
        "--tag",
        "v1.0.0",
        "--platform",
        "opencode",
        "--global",
      ],
      cwd: projectDir,
      env: process.env,
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Use exactly one of --branch, --tag, or --commit");
  });

  test("prompts before best-effort converting a non-native GitHub agent and installs after confirmation", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    const projectDir = join(tempDir, "project");
    await setupProject(projectDir);

    await createCachedGitHubRepository({
      rootDir: join(tempDir, "repo-root"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      owner: "Sergej-Popov",
      repo: "support-bot",
      files: {
        "AGENTS.md": "# Support Bot\n\nYou help triage incoming issues.\n",
      },
    });

    selectResponses = ["convert"];
    process.chdir(projectDir);

    await addCommand("Sergej-Popov/support-bot", {
      platform: "opencode",
      global: false,
    });

    const installedFile = await readFile(join(projectDir, "agents", "support-bot.md"), "utf-8");
    const lockFile = await readLockFile(false, projectDir);
    const entry = lockFile.agents["support-bot"];

    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0]?.message).toEqual(expect.stringContaining("best-effort conversion"));
    expect(selectCalls[0]?.message).toEqual(expect.stringContaining("may fail"));
    expect(installedFile).toContain("name: support-bot");
    expect(installedFile).toContain("Best-effort conversion from AGENTS.md");
    expect(installedFile).toContain("You help triage incoming issues.");
    expect(entry.source).toBe("Sergej-Popov/support-bot");
    expect(entry.sourceType).toBe("github");
    expect(entry.agentPath).toBe("");
    expect(loggedMessages).toContain("| converted from: AGENTS.md");
  });

  test("blocks Kiro installs when enabled generic tools cannot be mapped", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "kiro-hard-fail");

    await setupProject(projectDir);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "kiro-hard-fail",
        description: "Kiro hard fail agent",
        extra: {
          tools: {
            fetch: true,
            web: true,
          },
        },
      }),
      "utf-8",
    );

    process.chdir(projectDir);

    await expect(addCommand(sourceDir, { platform: "kiro", global: false })).rejects.toThrow("EXIT:1");

    expect(errorMessages.some((message) => message.includes("Compatibility check failed for kiro-hard-fail."))).toBe(true);
    expect(errorMessages.some((message) => message.includes("The selected platform set is atomic, so nothing was installed."))).toBe(true);
    expect(errorMessages.some((message) => message.includes("Incompatible selected platforms: [kiro]"))).toBe(true);
    expect(await pathExists(join(projectDir, ".kiro"))).toBe(false);
    expect(await pathExists(join(projectDir, "agents-io-lock.json"))).toBe(false);
  });

  test("fails atomically for mixed selected platforms and reports compatible platforms not installed", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "mixed-platform-agent");

    await setupProject(projectDir);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "mixed-platform-agent",
        description: "Mixed platform compatibility agent",
        extra: {
          tools: {
            fetch: true,
          },
        },
      }),
      "utf-8",
    );

    selectResponses = ["local"];
    multiselectResponses = [["opencode", "kiro"]];
    process.chdir(projectDir);

    await expect(addCommand(sourceDir, { dryRun: true })).rejects.toThrow("EXIT:1");

    expect(errorMessages.some((message) => message.includes("Compatibility check failed for mixed-platform-agent."))).toBe(true);
    expect(errorMessages.some((message) => message.includes("The selected platform set is atomic, so nothing was installed."))).toBe(true);
    expect(errorMessages.some((message) => message.includes("Incompatible selected platforms: [kiro]"))).toBe(true);
    expect(errorMessages.some((message) => message.includes("Compatible selected platforms not installed: opencode."))).toBe(true);
    expect(await pathExists(join(projectDir, "agents"))).toBe(false);
    expect(await pathExists(join(projectDir, ".kiro"))).toBe(false);
    expect(await pathExists(join(projectDir, "agents-io-lock.json"))).toBe(false);
  });

  test("warns when Codex drops metadata during install", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "codex-warning");

    await setupProject(projectDir);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "codex-warning",
        description: "Codex warning agent",
        mode: "primary",
        tools: { read: true },
        extra: {
          color: "#112233",
          kiro: { tools: ["read"] },
        },
      }),
      "utf-8",
    );
    await writeFile(
      join(sourceDir, "agent.json"),
      JSON.stringify({ temperature: 0.4 }, null, 2) + "\n",
      "utf-8",
    );

    process.chdir(projectDir);
    await addCommand(sourceDir, { platform: "codex", global: false });

    expect(loggedMessages).toContain("!  Compatibility warnings for codex-warning");
    expect(loggedMessages.some((message) => message.includes("[codex]") && message.includes("mode"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("[codex]") && message.includes("agent.json:temperature"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("[codex]") && message.includes("`mode: primary`"))).toBe(true);
    expect(await pathExists(join(projectDir, ".codex", "agents", "codex-warning.toml"))).toBe(true);
    expect(await pathExists(join(projectDir, "agents-io-lock.json"))).toBe(true);
  });

  test("warns when Kiro drops some unmapped generic tools", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "kiro-warning");

    await setupProject(projectDir);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({
        name: "kiro-warning",
        description: "Kiro warning agent",
        extra: {
          tools: {
            read: true,
            fetch: true,
          },
        },
      }),
      "utf-8",
    );

    process.chdir(projectDir);
    await addCommand(sourceDir, { platform: "kiro", global: false });

    expect(loggedMessages).toContain("!  Compatibility warnings for kiro-warning");
    expect(loggedMessages.some((message) => message.includes("[kiro]") && message.includes("generic tools fetch do not map"))).toBe(true);
    expect(await pathExists(join(projectDir, ".kiro", "agents", "kiro-warning.json"))).toBe(true);
  });

  test("stops multi-agent installs before writes when one selected agent is incompatible", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceRoot = join(tempDir, "agents-root");

    await setupProject(projectDir);
    await mkdir(join(sourceRoot, "safe"), { recursive: true });
    await mkdir(join(sourceRoot, "blocked"), { recursive: true });
    await writeFile(
      join(sourceRoot, "safe", "agent.md"),
      buildAgentContent({
        name: "safe-agent",
        description: "Safe agent",
        extra: {
          tools: {
            read: true,
          },
        },
      }),
      "utf-8",
    );
    await writeFile(
      join(sourceRoot, "blocked", "agent.md"),
      buildAgentContent({
        name: "blocked-agent",
        description: "Blocked agent",
        extra: {
          tools: {
            fetch: true,
          },
        },
      }),
      "utf-8",
    );

    multiselectResponses = [["safe", "blocked"]];
    process.chdir(projectDir);

    await expect(addCommand(sourceRoot, { platform: "kiro", global: false })).rejects.toThrow("EXIT:1");

    expect(errorMessages.some((message) => message.includes("Compatibility check failed for blocked-agent."))).toBe(true);
    expect(errorMessages.some((message) => message.includes("The selected platform set is atomic, so nothing was installed."))).toBe(true);
    expect(await pathExists(join(projectDir, ".kiro", "agents", "safe-agent.json"))).toBe(false);
    expect(await pathExists(join(projectDir, ".kiro", "agents", "blocked-agent.json"))).toBe(false);
    expect(await pathExists(join(projectDir, "agents-io-lock.json"))).toBe(false);
  });

  test("skips non-native GitHub conversion when the user declines", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    const projectDir = join(tempDir, "project");
    await setupProject(projectDir);

    await createCachedGitHubRepository({
      rootDir: join(tempDir, "repo-root"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      owner: "Sergej-Popov",
      repo: "support-bot",
      files: {
        "AGENTS.md": "# Support Bot\n\nYou help triage incoming issues.\n",
      },
    });

    selectResponses = ["skip"];
    process.chdir(projectDir);

    await addCommand("Sergej-Popov/support-bot", {
      platform: "opencode",
      global: false,
    });

    expect(selectCalls).toHaveLength(1);
    expect(loggedMessages).toContain("| Conversion skipped.");
    expect(await pathExists(join(projectDir, "agents"))).toBe(false);
    expect(await pathExists(join(projectDir, "agents-io-lock.json"))).toBe(false);
  });
});
