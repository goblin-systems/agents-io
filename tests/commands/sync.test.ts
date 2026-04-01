import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import claudeCodeAdapter from "../../src/adapters/claude-code.js";
import opencodeAdapter from "../../src/adapters/opencode.js";
import { fetchAgent } from "../../src/core/fetch.js";
import { hashContent, writeLockFile } from "../../src/core/registry.js";
import { syncCommand } from "../../src/commands/sync.js";
import {
  buildAgentContent,
  captureConsoleMessage,
  cleanTempDir,
  commitAll,
  createCachedGitHubRepository,
  makeTempDir,
  runGit,
} from "../helpers.js";

let tempDir = "";
const originalCwd = process.cwd();
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalExit = process.exit;
const originalConfigDir = process.env.AGENTS_IO_CONFIG_DIR;
const loggedMessages: string[] = [];
const errorMessages: string[] = [];

beforeEach(() => {
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
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalExit;
  process.env.AGENTS_IO_CONFIG_DIR = originalConfigDir;

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

async function writeProjectMarker(projectDir: string): Promise<void> {
  await writeFile(join(projectDir, "package.json"), '{"name":"test-project"}\n', "utf-8");
}

describe("sync command", () => {
  test("installs tracked project agents from the lock file on a fresh clone", async () => {
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
        description: "Sync test agent",
        body: "\n# Test Agent\n\nInstalled from sync.\n",
      }),
      "utf-8",
    );

    const result = await fetchAgent(sourceDir);
    const hash = hashContent(result.agent.raw);

    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            source: sourceDir,
            sourceType: "local",
            sourceUrl: sourceDir,
            agentPath: "",
            installedAt: "2026-03-29T00:00:00.000Z",
            platforms: ["opencode", "claude-code"],
            hash,
            platformHashes: {
              opencode: hash,
              "claude-code": hash,
            },
          },
        },
      },
      false,
      projectDir,
    );

    const lockBefore = await readFile(join(projectDir, "agents-io-lock.json"), "utf-8");

    process.chdir(projectDir);
    await syncCommand();

    expect(await readFile(join(projectDir, "agents", "test-agent.md"), "utf-8")).toContain(
      "Sync test agent",
    );
    expect(
      await readFile(join(projectDir, ".claude", "agents", "test-agent.md"), "utf-8"),
    ).toContain("Sync test agent");
    expect(await readFile(join(projectDir, "agents-io-lock.json"), "utf-8")).toBe(lockBefore);
    expect(loggedMessages.some((message) => message.includes("Sync complete"))).toBe(true);
    expect(
      loggedMessages.some((message) => message.includes("2 platform install(s) repaired, 0 already aligned")),
    ).toBe(true);
  });

  test("leaves already aligned project installs unchanged", async () => {
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
        description: "Aligned agent",
        body: "\n# Test Agent\n\nAlready aligned.\n",
      }),
      "utf-8",
    );

    const result = await fetchAgent(sourceDir);
    const hash = hashContent(result.agent.raw);

    await opencodeAdapter.install({ agent: result.agent, projectDir, global: false });
    await mkdir(join(projectDir, ".claude"), { recursive: true });
    await writeFile(
      join(projectDir, ".claude", "settings.json"),
      JSON.stringify({ agents: { "test-agent": {} } }, null, 2) + "\n",
      "utf-8",
    );
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
            installedAt: "2026-03-29T00:00:00.000Z",
            platforms: ["opencode", "claude-code"],
            hash,
            platformHashes: {
              opencode: hash,
              "claude-code": hash,
            },
          },
        },
      },
      false,
      projectDir,
    );

    const opencodePath = join(projectDir, "agents", "test-agent.md");
    const claudePath = join(projectDir, ".claude", "agents", "test-agent.md");
    const lockPath = join(projectDir, "agents-io-lock.json");
    const opencodeBefore = await readFile(opencodePath, "utf-8");
    const claudeBefore = await readFile(claudePath, "utf-8");
    const lockBefore = await readFile(lockPath, "utf-8");

    process.chdir(projectDir);
    await syncCommand();

    const opencodeAfter = await readFile(opencodePath, "utf-8");
    const claudeAfter = await readFile(claudePath, "utf-8");

    expect(opencodeAfter).toBe(opencodeBefore);
    expect(claudeAfter).toBe(claudeBefore);
    expect(await readFile(lockPath, "utf-8")).toBe(lockBefore);
    expect(
      loggedMessages.some((message) => message.includes("already aligned with the project lock file")),
    ).toBe(true);
    expect(
      loggedMessages.some((message) => message.includes("0 platform install(s) repaired, 2 already aligned")),
    ).toBe(true);
  });

  test("reports unsupported or unresolvable lock entries and continues syncing safe entries", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const goodSourceDir = join(tempDir, "good-source");
    const driftedSourceDir = join(tempDir, "drifted-source");
    const unsupportedSourceDir = join(tempDir, "unsupported-source");

    await mkdir(projectDir, { recursive: true });
    await mkdir(goodSourceDir, { recursive: true });
    await mkdir(driftedSourceDir, { recursive: true });
    await mkdir(unsupportedSourceDir, { recursive: true });
    await writeProjectMarker(projectDir);

    await writeFile(
      join(goodSourceDir, "agent.md"),
      buildAgentContent({ name: "good-agent", description: "Good agent" }),
      "utf-8",
    );
    await writeFile(
      join(driftedSourceDir, "agent.md"),
      buildAgentContent({ name: "drifted-agent", description: "Original drifted agent" }),
      "utf-8",
    );
    await writeFile(
      join(unsupportedSourceDir, "agent.md"),
      buildAgentContent({ name: "unsupported-agent", description: "Unsupported agent" }),
      "utf-8",
    );

    const goodHash = hashContent(await readFile(join(goodSourceDir, "agent.md"), "utf-8"));
    const driftedHash = hashContent(await readFile(join(driftedSourceDir, "agent.md"), "utf-8"));
    const unsupportedHash = hashContent(await readFile(join(unsupportedSourceDir, "agent.md"), "utf-8"));

    await writeFile(
      join(driftedSourceDir, "agent.md"),
      buildAgentContent({ name: "drifted-agent", description: "Updated drifted agent" }),
      "utf-8",
    );

    await writeFile(
      join(projectDir, "agents-io-lock.json"),
      JSON.stringify(
        {
          version: 1,
          agents: {
            "good-agent": {
              source: goodSourceDir,
              sourceType: "local",
              sourceUrl: goodSourceDir,
              agentPath: "",
              installedAt: "2026-03-29T00:00:00.000Z",
              platforms: ["opencode"],
              hash: goodHash,
              platformHashes: { opencode: goodHash },
            },
            "drifted-agent": {
              source: driftedSourceDir,
              sourceType: "local",
              sourceUrl: driftedSourceDir,
              agentPath: "",
              installedAt: "2026-03-29T00:00:00.000Z",
              platforms: ["opencode"],
              hash: driftedHash,
              platformHashes: { opencode: driftedHash },
            },
            "unsupported-agent": {
              source: unsupportedSourceDir,
              sourceType: "local",
              sourceUrl: unsupportedSourceDir,
              agentPath: "",
              installedAt: "2026-03-29T00:00:00.000Z",
              platforms: ["made-up"],
              hash: unsupportedHash,
              platformHashes: { "made-up": unsupportedHash },
            },
          },
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    stubProcessExit();
    process.chdir(projectDir);

    await expect(syncCommand()).rejects.toThrow("EXIT:1");

    expect(await readFile(join(projectDir, "agents", "good-agent.md"), "utf-8")).toContain(
      "Good agent",
    );
    await expect(readFile(join(projectDir, "agents", "drifted-agent.md"), "utf-8")).rejects.toThrow();
    expect(
      loggedMessages.some((message) => message.includes("unsupported-agent records unsupported platform 'made-up'")),
    ).toBe(true);
    expect(
      loggedMessages.some((message) => message.includes("drifted-agent could not be resolved to locked content")),
    ).toBe(true);
    expect(errorMessages.some((message) => message.includes("Sync completed with 2 issue(s)"))).toBe(true);
    expect(
      loggedMessages.some((message) => message.includes("1 platform install(s) repaired, 0 already aligned")),
    ).toBe(true);
  });

  test("sync resolves enterprise lock entries from stored repository metadata", async () => {
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
          description: "Enterprise sync agent v1",
          body: "\n# Test Agent\n\nEnterprise sync body v1.\n",
        }),
      },
    });

    const result = await fetchAgent("goblin-systems/agents-io-team", {
      host: "github.mycompany.com",
    });
    const hash = hashContent(result.agent.raw);

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
            installedAt: "2026-03-29T00:00:00.000Z",
            platforms: ["opencode"],
            hash,
            platformHashes: { opencode: hash },
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
        description: "Enterprise sync agent v2",
        body: "\n# Test Agent\n\nEnterprise sync body v2.\n",
      }),
      "utf-8",
    );
    await commitAll(repository.workingRepoDir, "Update enterprise sync agent");
    const updatedCommit = await runGit(["rev-parse", "HEAD"], repository.workingRepoDir);
    await runGit(["push", "origin", "main"], repository.workingRepoDir);

    const updatedResult = await fetchAgent("goblin-systems/agents-io-team", {
      host: "github.mycompany.com",
    });
    const updatedHash = hashContent(updatedResult.agent.raw);

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
            installedAt: "2026-03-29T00:00:00.000Z",
            platforms: ["opencode"],
            hash: updatedHash,
            platformHashes: { opencode: updatedHash },
            githubRef: {
              type: "commit",
              value: updatedCommit,
              resolvedCommit: updatedCommit,
            },
          },
        },
      },
      false,
      projectDir,
    );

    process.chdir(projectDir);
    await syncCommand();

    expect(await readFile(join(projectDir, "agents", "test-agent.md"), "utf-8")).toContain(
      "Enterprise sync agent v2",
    );
    expect(loggedMessages.some((message) => message.includes("Sync complete"))).toBe(true);
  });

  test("reapplies a persisted mode override during sync repairs", async () => {
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
        description: "Sync mode agent",
        mode: "subagent",
        body: "\n# Test Agent\n\nInstalled from sync.\n",
      }),
      "utf-8",
    );

    const result = await fetchAgent(sourceDir);
    const hash = hashContent(result.agent.raw);

    await writeLockFile(
      {
        version: 1,
        agents: {
          "test-agent": {
            source: sourceDir,
            sourceType: "local",
            sourceUrl: sourceDir,
            agentPath: "",
            installedAt: "2026-03-29T00:00:00.000Z",
            platforms: ["opencode"],
            hash,
            platformHashes: { opencode: hash },
            modeOverride: "primary",
          },
        },
      },
      false,
      projectDir,
    );

    process.chdir(projectDir);
    await syncCommand();

    const installedFile = await readFile(join(projectDir, "agents", "test-agent.md"), "utf-8");
    const opencodeConfig = JSON.parse(await readFile(join(projectDir, "opencode.json"), "utf-8")) as {
      agent?: Record<string, { mode?: string }>;
    };

    expect(installedFile).toContain("mode: primary");
    expect(opencodeConfig.agent?.["test-agent"]?.mode).toBe("primary");
  });
});
