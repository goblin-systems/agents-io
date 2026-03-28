import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { addCommand } from "../../src/commands/add.js";
import { readLockFile } from "../../src/core/registry.js";
import { cleanTempDir, makeTempDir, buildAgentContent } from "../helpers.js";

let tempDir = "";
const originalCwd = process.cwd();

afterEach(async () => {
  process.chdir(originalCwd);

  if (tempDir) {
    await cleanTempDir(tempDir);
    tempDir = "";
  }
});

async function setupProject(projectDir: string): Promise<void> {
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "package.json"), '{"name":"test-project"}\n', "utf-8");
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
});
