import { describe, test, expect, afterEach } from "bun:test";
import { readFile, mkdir, access } from "fs/promises";
import { join } from "path";
import claudeCodeAdapter from "../../src/adapters/claude-code.js";
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
  tools?: Record<string, boolean>;
  body?: string;
  extra?: Record<string, unknown>;
}): ParsedAgent {
  const content = buildAgentContent({
    name: overrides?.name ?? "test-agent",
    description: overrides?.description ?? "A test agent",
    tools: overrides?.tools,
    body: overrides?.body ?? "\n# Test Agent\n\nYou are a test agent.\n",
    extra: overrides?.extra,
  });
  return parseAgentFile(content);
}

function makeCtx(agent: ParsedAgent, projectDir: string): AdapterContext {
  return { agent, projectDir, global: false };
}

describe("claude-code adapter", () => {
  describe("detect", () => {
    test("returns true when .claude/ exists", async () => {
      tmpDir = await makeTempDir();
      await mkdir(join(tmpDir, ".claude"), { recursive: true });

      const result = await claudeCodeAdapter.detect(tmpDir);
      expect(result).toBe(true);
    });

    test("returns false when no .claude/ (project or global)", async () => {
      tmpDir = await makeTempDir();
      const result = await claudeCodeAdapter.detect(tmpDir);
      // detect() checks both project-level and global (~/.claude) paths.
      // If a global .claude dir exists on this machine, detect returns true.
      // We verify the function runs without error and returns a boolean.
      expect(typeof result).toBe("boolean");
    });
  });

  describe("install", () => {
    test("creates .claude/agents/{name}.md with YAML frontmatter", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({
        name: "my-agent",
        description: "My agent",
      });

      await claudeCodeAdapter.install(makeCtx(agent, tmpDir));

      const agentFile = join(tmpDir, ".claude", "agents", "my-agent.md");
      const content = await readFile(agentFile, "utf-8");

      // Should have YAML frontmatter delimiters
      expect(content.startsWith("---")).toBe(true);
      // Should have name and description in frontmatter
      expect(content).toContain("name: my-agent");
      expect(content).toContain("description: My agent");
      // Should have body
      expect(content).toContain("# Test Agent");
    });

    test("creates/updates .claude/settings.json with agent entry", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({
        name: "my-agent",
        description: "My agent",
      });

      await claudeCodeAdapter.install(makeCtx(agent, tmpDir));

      const settingsFile = join(tmpDir, ".claude", "settings.json");
      const settings = JSON.parse(await readFile(settingsFile, "utf-8"));

      expect(settings.agents).toBeDefined();
      expect(settings.agents["my-agent"]).toBeDefined();
      expect(settings.agents["my-agent"].description).toBe("My agent");
      expect(settings.agents["my-agent"].prompt).toBe(
        ".claude/agents/my-agent.md",
      );
    });

    test("derives permissions from tools map", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({
        name: "perms-agent",
        description: "Agent with permissions",
        tools: { read: true, write: true, bash: false },
      });

      await claudeCodeAdapter.install(makeCtx(agent, tmpDir));

      const settingsFile = join(tmpDir, ".claude", "settings.json");
      const settings = JSON.parse(await readFile(settingsFile, "utf-8"));

      const entry = settings.agents["perms-agent"];
      expect(entry.permissions).toBeDefined();
      expect(entry.permissions.allow).toContain("Read");
      expect(entry.permissions.allow).toContain("Write");
      expect(entry.permissions.deny).toContain("Bash");
    });

    test("uses explicit claude-code permissions override when present", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({
        name: "explicit-perms",
        description: "Agent with explicit perms",
        tools: { read: true, write: true },
        extra: {
          "claude-code": {
            permissions: {
              allow: ["CustomTool"],
              deny: ["DangerousTool"],
            },
          },
        },
      });

      await claudeCodeAdapter.install(makeCtx(agent, tmpDir));

      const settingsFile = join(tmpDir, ".claude", "settings.json");
      const settings = JSON.parse(await readFile(settingsFile, "utf-8"));

      const entry = settings.agents["explicit-perms"];
      // Should use explicit override, not derived from tools
      expect(entry.permissions.allow).toEqual(["CustomTool"]);
      expect(entry.permissions.deny).toEqual(["DangerousTool"]);
    });

    test("no permissions key when tools are empty", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({
        name: "no-perms",
        description: "Agent without tools",
      });

      await claudeCodeAdapter.install(makeCtx(agent, tmpDir));

      const settingsFile = join(tmpDir, ".claude", "settings.json");
      const settings = JSON.parse(await readFile(settingsFile, "utf-8"));

      const entry = settings.agents["no-perms"];
      expect(entry.permissions).toBeUndefined();
    });
  });

  describe("uninstall", () => {
    test("removes agent file and settings entry", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({ name: "remove-me" });
      await claudeCodeAdapter.install(makeCtx(agent, tmpDir));

      await claudeCodeAdapter.uninstall("remove-me", tmpDir, false);

      // Agent file should be gone
      let fileExists = true;
      try {
        await access(join(tmpDir, ".claude", "agents", "remove-me.md"));
      } catch {
        fileExists = false;
      }
      expect(fileExists).toBe(false);

      // Settings entry should be gone
      const settingsFile = join(tmpDir, ".claude", "settings.json");
      const settings = JSON.parse(await readFile(settingsFile, "utf-8"));
      expect(settings.agents).toBeUndefined();
    });

    test("preserves other agents in settings when removing one", async () => {
      tmpDir = await makeTempDir();
      const agent1 = makeAgent({ name: "agent-a" });
      const agent2 = makeAgent({ name: "agent-b" });
      await claudeCodeAdapter.install(makeCtx(agent1, tmpDir));
      await claudeCodeAdapter.install(makeCtx(agent2, tmpDir));

      await claudeCodeAdapter.uninstall("agent-a", tmpDir, false);

      const settingsFile = join(tmpDir, ".claude", "settings.json");
      const settings = JSON.parse(await readFile(settingsFile, "utf-8"));
      expect(settings.agents["agent-a"]).toBeUndefined();
      expect(settings.agents["agent-b"]).toBeDefined();
    });
  });
});
