import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import claudeCodeAdapter from "../../src/adapters/claude-code.js";
import opencodeAdapter from "../../src/adapters/opencode.js";
import { updateCommand } from "../../src/commands/update.js";
import { fetchAgent } from "../../src/core/fetch.js";
import { hashContent, readLockFile, writeLockFile } from "../../src/core/registry.js";
import type { Platform } from "../../src/types.js";
import { buildAgentContent, cleanTempDir, makeTempDir } from "../helpers.js";

let tempDir = "";
const originalCwd = process.cwd();

afterEach(async () => {
  process.chdir(originalCwd);

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

describe("update command", () => {
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
});
