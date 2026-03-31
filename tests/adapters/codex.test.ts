import { describe, test, expect, afterEach } from "bun:test";
import { readFile, access, readdir } from "fs/promises";
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("codex adapter", () => {
  describe("install", () => {
    test("creates agents directory and .toml file with correct content", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({
        name: "my-agent",
        description: "My agent",
      });

      await codexAdapter.install(makeCtx(agent, tmpDir));

      const tomlPath = join(tmpDir, ".codex", "agents", "my-agent.toml");
      const content = await readFile(tomlPath, "utf-8");

      expect(content).toContain('name = "my-agent"');
      expect(content).toContain('description = "My agent"');
      expect(content).toContain('developer_instructions = """');
      expect(content).toContain("# Test Agent");
      expect(content).toContain("You are a test agent.");
      expect(content).toContain('"""');
    });

    test("replaces existing .toml file for same agent name", async () => {
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

      const tomlPath = join(tmpDir, ".codex", "agents", "my-agent.toml");
      const content = await readFile(tomlPath, "utf-8");

      expect(content).toContain('description = "Version 2"');
      expect(content).toContain("Updated body.");
      expect(content).not.toContain("Version 1");
      expect(content).not.toContain("Original body.");
    });

    test("handles multiple agents as separate .toml files", async () => {
      tmpDir = await makeTempDir();

      const agentA = makeAgent({ name: "agent-a", description: "Agent A" });
      const agentB = makeAgent({ name: "agent-b", description: "Agent B" });

      await codexAdapter.install(makeCtx(agentA, tmpDir));
      await codexAdapter.install(makeCtx(agentB, tmpDir));

      const agentsDir = join(tmpDir, ".codex", "agents");
      const entries = await readdir(agentsDir);
      expect(entries).toContain("agent-a.toml");
      expect(entries).toContain("agent-b.toml");

      const contentA = await readFile(join(agentsDir, "agent-a.toml"), "utf-8");
      const contentB = await readFile(join(agentsDir, "agent-b.toml"), "utf-8");
      expect(contentA).toContain('name = "agent-a"');
      expect(contentB).toContain('name = "agent-b"');
    });

    test("verify TOML content structure", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({
        name: "structured-agent",
        description: "Structured description",
        body: "\n# Heading\n\nParagraph content.\n",
      });

      await codexAdapter.install(makeCtx(agent, tmpDir));

      const tomlPath = join(tmpDir, ".codex", "agents", "structured-agent.toml");
      const content = await readFile(tomlPath, "utf-8");

      // Verify structure: three top-level key = value pairs
      const lines = content.split("\n");
      expect(lines[0]).toBe('name = "structured-agent"');
      expect(lines[1]).toBe('description = "Structured description"');
      expect(lines[2]).toBe('developer_instructions = """');
      // Body content follows
      expect(content).toContain("# Heading");
      expect(content).toContain("Paragraph content.");
      // Ends with closing triple-quotes
      expect(content).toMatch(/"""\n$/);
    });
  });

  describe("uninstall", () => {
    test("removes the .toml file", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({ name: "remove-me" });
      await codexAdapter.install(makeCtx(agent, tmpDir));

      await codexAdapter.uninstall("remove-me", tmpDir, false);

      const tomlPath = join(tmpDir, ".codex", "agents", "remove-me.toml");
      expect(await fileExists(tomlPath)).toBe(false);
    });

    test("removes agents directory if empty after removal", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({ name: "only-agent" });
      await codexAdapter.install(makeCtx(agent, tmpDir));

      await codexAdapter.uninstall("only-agent", tmpDir, false);

      const agentsDir = join(tmpDir, ".codex", "agents");
      expect(await fileExists(agentsDir)).toBe(false);
    });

    test("does not remove agents directory if other agents remain", async () => {
      tmpDir = await makeTempDir();
      const agentA = makeAgent({ name: "agent-a" });
      const agentB = makeAgent({ name: "agent-b" });
      await codexAdapter.install(makeCtx(agentA, tmpDir));
      await codexAdapter.install(makeCtx(agentB, tmpDir));

      await codexAdapter.uninstall("agent-a", tmpDir, false);

      const agentsDir = join(tmpDir, ".codex", "agents");
      const entries = await readdir(agentsDir);
      expect(entries).toContain("agent-b.toml");
      expect(entries).not.toContain("agent-a.toml");
    });

    test("is a no-op when .toml file doesn't exist", async () => {
      tmpDir = await makeTempDir();
      // Should not throw
      await codexAdapter.uninstall("nonexistent", tmpDir, false);
    });
  });
});
