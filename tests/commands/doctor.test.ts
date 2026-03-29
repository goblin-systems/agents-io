import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, unlink, writeFile } from "fs/promises";
import { join } from "path";
import claudeCodeAdapter from "../../src/adapters/claude-code.js";
import opencodeAdapter from "../../src/adapters/opencode.js";
import { hashContent, writeLockFile } from "../../src/core/registry.js";
import { parseAgentFile } from "../../src/core/parse.js";
import type { InstalledAgent, Platform } from "../../src/types.js";
import { buildAgentContent, cleanTempDir, makeTempDir } from "../helpers.js";

let tempDir = "";
let homeDir = "";
let configDir = "";
const originalCwd = process.cwd();
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalConfigDir = process.env.AGENTS_IO_CONFIG_DIR;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalExit = process.exit;
const loggedMessages: string[] = [];
const errorMessages: string[] = [];

const { doctorCommand } = await import("../../src/commands/doctor.js");

beforeEach(() => {
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
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalExit;

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

function stubProcessExit(): void {
  process.exit = ((code?: number) => {
    throw new Error(`EXIT:${code ?? 0}`);
  }) as typeof process.exit;
}

async function setupProject(): Promise<{ projectDir: string; agent: ReturnType<typeof parseAgentFile> }> {
  tempDir = await makeTempDir();
  homeDir = join(tempDir, "home");
  configDir = join(tempDir, "config");
  const projectDir = join(tempDir, "project");

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.AGENTS_IO_CONFIG_DIR = configDir;

  await mkdir(homeDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "package.json"), '{"name":"test-project"}\n', "utf-8");
  process.chdir(projectDir);

  return {
    projectDir,
    agent: parseAgentFile(buildAgentContent({ name: "test-agent", description: "Test agent" })),
  };
}

function buildEntry(
  source: string,
  platforms: Platform[] = ["opencode"],
  overrides: Partial<InstalledAgent> = {},
): InstalledAgent {
  const raw = buildAgentContent({ name: "test-agent", description: "Test agent" });
  const hash = hashContent(raw);

  return {
    source,
    sourceType: "local",
    sourceUrl: source,
    agentPath: "",
    installedAt: "2026-03-29T00:00:00.000Z",
    platforms,
    hash,
    platformHashes: Object.fromEntries(platforms.map((platform) => [platform, hash])) as Partial<
      Record<Platform, string>
    >,
    ...overrides,
  };
}

describe("doctor command", () => {
  test("reports a healthy project install", async () => {
    const { projectDir, agent } = await setupProject();

    await mkdir(join(projectDir, ".claude"), { recursive: true });
    await writeFile(join(projectDir, ".claude", "settings.json"), "{}\n", "utf-8");
    await opencodeAdapter.install({ agent, projectDir, global: false });
    await claudeCodeAdapter.install({ agent, projectDir, global: false });

    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": buildEntry(projectDir, ["opencode", "claude-code"]),
        },
      },
      false,
      projectDir,
    );

    await doctorCommand();

    expect(loggedMessages.some((message) => message.includes("Checking project install health..."))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Healthy project scope"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("checked 1 agent(s) across 2 platform install(s)"))).toBe(true);
    expect(errorMessages).toHaveLength(0);
  });

  test("treats a missing project lock file as a healthy empty scope", async () => {
    await setupProject();

    await doctorCommand();

    expect(loggedMessages.some((message) => message.includes("No agents installed in project scope"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("status: healthy (lock file missing, scope is empty)"))).toBe(true);
    expect(errorMessages).toHaveLength(0);
  });

  test("reports mixed registry status as an issue", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": buildEntry(projectDir, ["opencode"], {
            hash: "abc123def456",
            platformHashes: { opencode: "zzz999yyy888" },
          }),
        },
      },
      false,
      projectDir,
    );

    stubProcessExit();

    await expect(doctorCommand()).rejects.toThrow("EXIT:1");

    expect(errorMessages.some((message) => message.includes("Found 1 issue(s) in project scope"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("mixed registry hashes"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("agents-io list --verbose"))).toBe(true);
  });

  test("reports missing adapter artifacts and config for representative platforms", async () => {
    const { projectDir, agent } = await setupProject();

    await mkdir(join(projectDir, ".claude"), { recursive: true });
    await writeFile(join(projectDir, ".claude", "settings.json"), "{}\n", "utf-8");
    await opencodeAdapter.install({ agent, projectDir, global: false });
    await claudeCodeAdapter.install({ agent, projectDir, global: false });

    await unlink(join(projectDir, "agents", "test-agent.md"));
    await rm(join(projectDir, ".claude", "settings.json"));

    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": buildEntry(projectDir, ["opencode", "claude-code"]),
        },
      },
      false,
      projectDir,
    );

    stubProcessExit();

    await expect(doctorCommand()).rejects.toThrow("EXIT:1");

    expect(errorMessages.some((message) => message.includes("Found 2 issue(s) in project scope"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("[project/opencode] is missing"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("[project/claude-code] is missing"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("agents-io update test-agent --platform opencode"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("agents-io update test-agent --platform claude-code"))).toBe(true);
  });

  test("checks global scope explicitly", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: true });
    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": buildEntry(homeDir, ["opencode"]),
        },
      },
      true,
      projectDir,
    );

    await doctorCommand({ global: true });

    expect(loggedMessages.some((message) => message.includes("Checking global install health..."))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Healthy global scope"))).toBe(true);
  });

  test("reports unreadable lock files clearly", async () => {
    const { projectDir } = await setupProject();

    await writeFile(join(projectDir, "agents-io-lock.json"), "{not-json\n", "utf-8");
    stubProcessExit();

    await expect(doctorCommand()).rejects.toThrow("EXIT:1");

    expect(errorMessages.some((message) => message.includes("lock file could not be read"))).toBe(true);
  });
});
