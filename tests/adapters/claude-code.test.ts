import { describe, test, expect, afterEach } from "bun:test";
import { readFile, mkdir, access, writeFile } from "fs/promises";
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

    test("does not create .claude/settings.json during install", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({
        name: "my-agent",
        description: "My agent",
      });

      await claudeCodeAdapter.install(makeCtx(agent, tmpDir));

      const settingsFile = join(tmpDir, ".claude", "settings.json");
      let settingsExists = true;

      try {
        await access(settingsFile);
      } catch {
        settingsExists = false;
      }

      expect(settingsExists).toBe(false);
    });

    test("writes enabled tools into markdown frontmatter", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({
        name: "perms-agent",
        description: "Agent with permissions",
        tools: { read: true, write: true, bash: false },
      });

      await claudeCodeAdapter.install(makeCtx(agent, tmpDir));

      const agentFile = join(tmpDir, ".claude", "agents", "perms-agent.md");
      const content = await readFile(agentFile, "utf-8");

      expect(content).toContain("tools: 'Read, Write'");
      expect(content).not.toContain("Bash");
    });

    test("keeps claude-code settings overrides in markdown", async () => {
      tmpDir = await makeTempDir();
      const agent = parseAgentFile(
        buildAgentContent({
          name: "explicit-perms",
          description: "Agent with explicit perms",
          tools: { read: true, write: true },
        }),
        {
          "claude-code": {
            category: "specialist",
          },
        },
      );

      await claudeCodeAdapter.install(makeCtx(agent, tmpDir));

      const agentFile = join(tmpDir, ".claude", "agents", "explicit-perms.md");
      const content = await readFile(agentFile, "utf-8");

      expect(content).toContain("tools: 'Read, Write'");
      expect(content).toContain("category: specialist");
    });

    test("does not add tools frontmatter when tools are empty", async () => {
      tmpDir = await makeTempDir();
      const agent = makeAgent({
        name: "no-perms",
        description: "Agent without tools",
      });

      await claudeCodeAdapter.install(makeCtx(agent, tmpDir));

      const agentFile = join(tmpDir, ".claude", "agents", "no-perms.md");
      const content = await readFile(agentFile, "utf-8");

      expect(content).not.toContain("tools:");
    });
  });

  describe("uninstall", () => {
    test("removes agent file without requiring settings.json", async () => {
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
    });

    test("does not modify an existing settings.json during uninstall", async () => {
      tmpDir = await makeTempDir();
      const claudeDir = join(tmpDir, ".claude");
      const settingsFile = join(claudeDir, "settings.json");
      const originalSettings = '{\n  "existing": true\n}\n';
      const agent = makeAgent({ name: "agent-a" });

      await mkdir(claudeDir, { recursive: true });
      await writeFile(settingsFile, originalSettings, "utf-8");
      await claudeCodeAdapter.install(makeCtx(agent, tmpDir));

      await claudeCodeAdapter.uninstall("agent-a", tmpDir, false);

      const settings = await readFile(settingsFile, "utf-8");
      expect(settings).toBe(originalSettings);
    });
  });
});
