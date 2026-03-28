import { describe, test, expect, afterEach } from "bun:test";
import { readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import codexAdapter from "../../src/adapters/codex.js";
import type { AdapterContext, ParsedAgent } from "../../src/types.js";
import { makeTempDir, cleanTempDir, buildAgentContent } from "../helpers.js";
import { parseAgentFile } from "../../src/core/parse.js";

let tmpDir: string;

afterEach(async () => {
  if (tmpDir) {
    await cleanTempDir(tmpDir);
  }
});

function makeAgent(overrides?: {
  name?: string;
  description?: string;
  body?: string;
}): ParsedAgent {
  const content = buildAgentContent({
    name: overrides?.name ?? "test-agent",
    description: overrides?.description ?? "A test agent",
    body: overrides?.body ?? "\n# Test Agent\n\nYou are a test agent.\n",
  });
  return parseAgentFile(content);
}

function makeCtx(agent: ParsedAgent, projectDir: string): AdapterContext {
  return { agent, projectDir, global: false };
}

describe("codex adapter", () => {
  describe("install", () => {
    test("creates AGENTS.md with delimited section", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({
        name: "my-agent",
        description: "My agent",
      });

      await codexAdapter.install(makeCtx(agent, tmpDir));

      const content = await readFile(join(tmpDir, "AGENTS.md"), "utf-8");
      expect(content).toContain("<!-- agnts:my-agent:start -->");
      expect(content).toContain("<!-- agnts:my-agent:end -->");
      expect(content).toContain("## My-Agent");
      expect(content).toContain("My agent");
      expect(content).toContain("# Test Agent");
    });

    test("appends to existing AGENTS.md", async () => {
      tmpDir = await makeTempDir();
      // Pre-populate AGENTS.md with some existing content
      await writeFile(
        join(tmpDir, "AGENTS.md"),
        "# Existing Content\n\nSome instructions.\n",
        "utf-8",
      );

      const agent = makeAgent({ name: "new-agent" });
      await codexAdapter.install(makeCtx(agent, tmpDir));

      const content = await readFile(join(tmpDir, "AGENTS.md"), "utf-8");
      // Preserves existing content
      expect(content).toContain("# Existing Content");
      expect(content).toContain("Some instructions.");
      // Has new agent section
      expect(content).toContain("<!-- agnts:new-agent:start -->");
    });

    test("replaces existing section for same agent name", async () => {
      tmpDir = await makeTempDir();
      const agent1 = makeAgent({
        name: "my-agent",
        description: "Version 1",
        body: "\nOriginal body.\n",
      });

      await codexAdapter.install(makeCtx(agent1, tmpDir));

      const agent2 = makeAgent({
        name: "my-agent",
        description: "Version 2",
        body: "\nUpdated body.\n",
      });

      await codexAdapter.install(makeCtx(agent2, tmpDir));

      const content = await readFile(join(tmpDir, "AGENTS.md"), "utf-8");
      // Should have updated content
      expect(content).toContain("Version 2");
      expect(content).toContain("Updated body.");
      // Should NOT have old content
      expect(content).not.toContain("Version 1");
      expect(content).not.toContain("Original body.");
      // Should only have one start/end pair
      const starts = content.match(/<!-- agnts:my-agent:start -->/g);
      expect(starts).toHaveLength(1);
    });
  });

  describe("uninstall", () => {
    test("removes section from AGENTS.md", async () => {
      tmpDir = await makeTempDir();
      // Install two agents
      const agent1 = makeAgent({ name: "agent-a" });
      const agent2 = makeAgent({ name: "agent-b" });
      await codexAdapter.install(makeCtx(agent1, tmpDir));
      await codexAdapter.install(makeCtx(agent2, tmpDir));

      // Remove one
      await codexAdapter.uninstall("agent-a", tmpDir, false);

      const content = await readFile(join(tmpDir, "AGENTS.md"), "utf-8");
      expect(content).not.toContain("<!-- agnts:agent-a:start -->");
      expect(content).toContain("<!-- agnts:agent-b:start -->");
    });

    test("deletes AGENTS.md if empty after removal", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({ name: "only-agent" });
      await codexAdapter.install(makeCtx(agent, tmpDir));

      await codexAdapter.uninstall("only-agent", tmpDir, false);

      let fileExists = true;
      try {
        await access(join(tmpDir, "AGENTS.md"));
      } catch {
        fileExists = false;
      }
      expect(fileExists).toBe(false);
    });

    test("is a no-op when AGENTS.md doesn't exist", async () => {
      tmpDir = await makeTempDir();
      // Should not throw
      await codexAdapter.uninstall("nonexistent", tmpDir, false);
    });
  });
});
