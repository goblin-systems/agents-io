import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import claudeCodeAdapter from "../../src/adapters/claude-code.js";
import opencodeAdapter from "../../src/adapters/opencode.js";
import { removeCommand } from "../../src/commands/remove.js";
import { getAgent, writeLockFile } from "../../src/core/registry.js";
import { parseAgentFile } from "../../src/core/parse.js";
import { buildAgentContent, cleanTempDir, makeTempDir } from "../helpers.js";

let tempDir = "";
let homeDir = "";
const originalCwd = process.cwd();
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

afterEach(async () => {
  process.chdir(originalCwd);

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

async function setupProject(): Promise<{ projectDir: string; agent: ReturnType<typeof parseAgentFile> }> {
  tempDir = await makeTempDir();
  homeDir = join(tempDir, "home");
  const projectDir = join(tempDir, "project");

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  await mkdir(projectDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await writeFile(join(projectDir, "package.json"), '{"name":"test-project"}\n', "utf-8");
  process.chdir(projectDir);

  const agent = parseAgentFile(
    buildAgentContent({ name: "test-agent", description: "Test agent" }),
  );

  return { projectDir, agent };
}

describe("remove command", () => {
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
      await readFile(join(homeDir, ".config", "agents-io", "agents-io-lock.json"), "utf-8"),
    ) as { agents: Record<string, unknown> };
    expect(lockFile.agents["test-agent"]).toBeUndefined();
  });

  test("requires an explicit scope when the agent exists in both places", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await opencodeAdapter.install({ agent, projectDir, global: true });

    const entry = {
      source: projectDir,
      sourceType: "local" as const,
      sourceUrl: projectDir,
      agentPath: "",
      installedAt: "2026-03-28T00:00:00.000Z",
      platforms: ["opencode"] as const,
      hash: "abc123def456",
      platformHashes: { opencode: "abc123def456" },
    };

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

    const localEntry = {
      source: projectDir,
      sourceType: "local" as const,
      sourceUrl: projectDir,
      agentPath: "",
      installedAt: "2026-03-28T00:00:00.000Z",
      platforms: ["opencode"] as const,
      hash: "abc123def456",
      platformHashes: { opencode: "abc123def456" },
    };

    const globalEntry = {
      ...localEntry,
      source: homeDir,
      sourceUrl: homeDir,
    };

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

    const localEntry = {
      source: projectDir,
      sourceType: "local" as const,
      sourceUrl: projectDir,
      agentPath: "",
      installedAt: "2026-03-28T00:00:00.000Z",
      platforms: ["opencode"] as const,
      hash: "abc123def456",
      platformHashes: { opencode: "abc123def456" },
    };

    const globalEntry = {
      ...localEntry,
      source: homeDir,
      sourceUrl: homeDir,
    };

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

    const localEntry = {
      source: projectDir,
      sourceType: "local" as const,
      sourceUrl: projectDir,
      agentPath: "",
      installedAt: "2026-03-28T00:00:00.000Z",
      platforms: ["opencode"] as const,
      hash: "abc123def456",
      platformHashes: { opencode: "abc123def456" },
    };

    const globalEntry = {
      ...localEntry,
      source: homeDir,
      sourceUrl: homeDir,
    };

    await writeLockFile({ version: 1, agents: { "test-agent": localEntry } }, false, projectDir);
    await writeLockFile({ version: 1, agents: { "test-agent": globalEntry } }, true, projectDir);

    await removeCommand("test-agent", { all: true });

    expect(await pathExists(join(projectDir, "agents", "test-agent.md"))).toBe(false);
    expect(await pathExists(join(homeDir, ".config", "opencode", "agents", "test-agent.md"))).toBe(false);
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

    const localEntry = {
      source: projectDir,
      sourceType: "local" as const,
      sourceUrl: projectDir,
      agentPath: "",
      installedAt: "2026-03-28T00:00:00.000Z",
      platforms: ["opencode", "claude-code"] as const,
      hash: "abc123def456",
      platformHashes: { opencode: "abc123def456", "claude-code": "abc123def456" },
    };

    const globalEntry = {
      ...localEntry,
      source: homeDir,
      sourceUrl: homeDir,
    };

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

  test("still requires an explicit scope when removing one platform from both-scoped installs", async () => {
    const { projectDir, agent } = await setupProject();

    await opencodeAdapter.install({ agent, projectDir, global: false });
    await opencodeAdapter.install({ agent, projectDir, global: true });

    const entry = {
      source: projectDir,
      sourceType: "local" as const,
      sourceUrl: projectDir,
      agentPath: "",
      installedAt: "2026-03-28T00:00:00.000Z",
      platforms: ["opencode"] as const,
      hash: "abc123def456",
      platformHashes: { opencode: "abc123def456" },
    };

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
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("installed in both project and global scope");
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
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Use only one of --local, --global, or --all");
  });
});
