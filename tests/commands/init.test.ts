import { afterEach, describe, expect, test } from "bun:test";
import { access, readFile } from "fs/promises";
import { join } from "path";
import { initCommand } from "../../src/commands/init.js";
import { cleanTempDir, makeTempDir } from "../helpers.js";

let tempDir = "";
const originalCwd = process.cwd();

afterEach(async () => {
  process.chdir(originalCwd);

  if (tempDir) {
    await cleanTempDir(tempDir);
    tempDir = "";
  }
});

describe("init command", () => {
  test("creates the scaffolded agent files", async () => {
    tempDir = await makeTempDir();
    process.chdir(tempDir);

    await initCommand("review-agent");

    const agentMd = await readFile(join(tempDir, "review-agent", "agent.md"), "utf-8");
    const readme = await readFile(join(tempDir, "review-agent", "README.md"), "utf-8");

    expect(agentMd).toContain("name: review-agent");
    expect(agentMd).toContain("description: 'TODO: Describe what this agent does'");
    expect(agentMd).not.toContain("mode:");
    expect(readme).toContain("npx agnts add yourname/review-agent");
    expect(readme).toContain("Optional: add `agent.json` later");
    await expect(access(join(tempDir, "review-agent", "agent.json"))).rejects.toBeDefined();
  });
});
