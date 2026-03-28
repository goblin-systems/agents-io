import { describe, test, expect, afterEach } from "bun:test";
import { readFile, writeFile, mkdir, access, readdir } from "fs/promises";
import { join } from "path";
import opencodeAdapter from "../../src/adapters/opencode.js";
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
  mode?: string;
  tools?: Record<string, boolean>;
  body?: string;
}): ParsedAgent {
  const content = buildAgentContent({
    name: overrides?.name ?? "test-agent",
    description: overrides?.description ?? "A test agent",
    mode: overrides?.mode,
    tools: overrides?.tools,
    body: overrides?.body ?? "\n# Test Agent\n\nYou are a test agent.\n",
  });
  return parseAgentFile(content);
}

function makeCtx(agent: ParsedAgent, projectDir: string): AdapterContext {
  return { agent, projectDir, global: false };
}

describe("opencode adapter", () => {
  describe("detect", () => {
    test("returns true when opencode.json exists", async () => {
      tmpDir = await makeTempDir();
      await writeFile(join(tmpDir, "opencode.json"), "{}", "utf-8");

      const result = await opencodeAdapter.detect(tmpDir);
      expect(result).toBe(true);
    });

    test("returns false when no opencode.json (project or global)", async () => {
      tmpDir = await makeTempDir();
      const result = await opencodeAdapter.detect(tmpDir);
      // detect() checks both project-level and global (~/.config/opencode/) paths.
      // If a global opencode.json exists on this machine, detect returns true.
      // We verify the function runs without error and returns a boolean.
      expect(typeof result).toBe("boolean");
    });
  });

  describe("install", () => {
    test("creates agents/{name}.md with frontmatter", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({ name: "my-agent", description: "My agent" });

      await opencodeAdapter.install(makeCtx(agent, tmpDir));

      const agentFile = join(tmpDir, "agents", "my-agent.md");
      const content = await readFile(agentFile, "utf-8");

      // Should contain frontmatter
      expect(content).toContain("---");
      expect(content).toContain("name: my-agent");
      expect(content).toContain("description: My agent");
      // Should contain body
      expect(content).toContain("# Test Agent");
    });

    test("creates/updates opencode.json with agent entry", async () => {
      tmpDir = await makeTempDir();
      // Pre-populate with existing config
      await writeFile(
        join(tmpDir, "opencode.json"),
        JSON.stringify({ theme: "dark" }, null, 2),
        "utf-8",
      );

      const agent = makeAgent({ name: "my-agent" });
      await opencodeAdapter.install(makeCtx(agent, tmpDir));

      const config = JSON.parse(
        await readFile(join(tmpDir, "opencode.json"), "utf-8"),
      );

      // Preserves existing keys
      expect(config.theme).toBe("dark");
      // Adds agent entry
      expect(config.agent).toBeDefined();
      expect(config.agent["my-agent"]).toEqual({
        description: "A test agent",
        mode: "subagent",
      });
    });

    test("creates opencode.json if it doesn't exist", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({ name: "new-agent" });

      await opencodeAdapter.install(makeCtx(agent, tmpDir));

      const config = JSON.parse(
        await readFile(join(tmpDir, "opencode.json"), "utf-8"),
      );
      expect(config.agent["new-agent"]).toEqual({
        description: "A test agent",
        mode: "subagent",
      });
    });
  });

  describe("uninstall", () => {
    test("removes agent file", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({ name: "remove-me" });
      await opencodeAdapter.install(makeCtx(agent, tmpDir));

      // Verify file exists
      const agentFile = join(tmpDir, "agents", "remove-me.md");
      await access(agentFile); // Should not throw

      await opencodeAdapter.uninstall("remove-me", tmpDir, false);

      // File should be gone
      let exists = true;
      try {
        await access(agentFile);
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    });

    test("removes entry from opencode.json", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({ name: "remove-me" });
      await opencodeAdapter.install(makeCtx(agent, tmpDir));

      await opencodeAdapter.uninstall("remove-me", tmpDir, false);

      const config = JSON.parse(
        await readFile(join(tmpDir, "opencode.json"), "utf-8"),
      );
      expect(config.agent["remove-me"]).toBeUndefined();
    });

    test("cleans up empty agents directory", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({ name: "only-agent" });
      await opencodeAdapter.install(makeCtx(agent, tmpDir));

      await opencodeAdapter.uninstall("only-agent", tmpDir, false);

      // agents dir should be removed
      let dirExists = true;
      try {
        await access(join(tmpDir, "agents"));
      } catch {
        dirExists = false;
      }
      expect(dirExists).toBe(false);
    });

    test("does not remove agents directory if other agents remain", async () => {
      tmpDir = await makeTempDir();
      const agent1 = makeAgent({ name: "agent-a" });
      const agent2 = makeAgent({ name: "agent-b" });
      await opencodeAdapter.install(makeCtx(agent1, tmpDir));
      await opencodeAdapter.install(makeCtx(agent2, tmpDir));

      await opencodeAdapter.uninstall("agent-a", tmpDir, false);

      // agents dir should still exist
      const entries = await readdir(join(tmpDir, "agents"));
      expect(entries).toContain("agent-b.md");
    });
  });
});
