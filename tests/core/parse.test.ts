import { describe, test, expect } from "bun:test";
import { parseAgentFile } from "../../src/core/parse.js";
import { buildAgentContent } from "../helpers.js";

describe("parseAgentFile", () => {
  test("parses valid agent with all fields", () => {
    const content = buildAgentContent({
      name: "my-agent",
      description: "A useful agent",
      mode: "primary",
      tools: { read: true, write: false, bash: true },
      body: "\n# My Agent\n\nDo things.\n",
    });

    const result = parseAgentFile(content);

    expect(result.frontmatter.name).toBe("my-agent");
    expect(result.frontmatter.description).toBe("A useful agent");
    expect(result.frontmatter.mode).toBe("primary");
    expect(result.frontmatter.tools).toEqual({
      read: true,
      write: false,
      bash: true,
    });
    expect(result.body).toBe("# My Agent\n\nDo things.");
  });

  test("parses valid agent with minimal fields (name + description + body)", () => {
    const content = buildAgentContent({
      name: "simple-agent",
      description: "A simple agent",
      body: "\nHello world.\n",
    });

    const result = parseAgentFile(content);

    expect(result.frontmatter.name).toBe("simple-agent");
    expect(result.frontmatter.description).toBe("A simple agent");
    expect(result.frontmatter.mode).toBeUndefined();
    expect(result.frontmatter.tools).toBeUndefined();
    expect(result.body).toBe("Hello world.");
  });

  test("throws when name is missing", () => {
    const content = buildAgentContent({
      name: undefined,
      description: "No name agent",
    });
    // buildAgentContent sets name to "test-agent" by default, so we need raw content
    const raw = content.replace(/^name:.*$/m, "");

    expect(() => parseAgentFile(raw)).toThrow("missing required field: name");
  });

  test("throws for invalid name — uppercase", () => {
    const content = buildAgentContent({ name: "UPPER" });
    expect(() => parseAgentFile(content)).toThrow("Must be kebab-case");
  });

  test("throws for invalid name — spaces", () => {
    const content = buildAgentContent({ name: "with spaces" });
    expect(() => parseAgentFile(content)).toThrow("Must be kebab-case");
  });

  test("throws for invalid name — 'My Agent'", () => {
    const content = buildAgentContent({ name: "My Agent" });
    expect(() => parseAgentFile(content)).toThrow("Must be kebab-case");
  });

  test("throws when description is missing", () => {
    // Manually build content without description
    const content = [
      "---",
      "name: valid-name",
      "---",
      "",
      "# Body content",
    ].join("\n");

    expect(() => parseAgentFile(content)).toThrow(
      "missing required field: description",
    );
  });

  test("throws for invalid mode", () => {
    const content = buildAgentContent({ mode: "invalid" });
    expect(() => parseAgentFile(content)).toThrow('Invalid agent mode');
  });

  test("throws for invalid tools (not boolean values)", () => {
    const content = [
      "---",
      "name: valid-name",
      'description: "A valid agent"',
      "tools:",
      '  read: "yes"',
      "---",
      "",
      "# Body",
    ].join("\n");

    expect(() => parseAgentFile(content)).toThrow("Expected boolean");
  });

  test("throws for empty body", () => {
    const content = [
      "---",
      "name: valid-name",
      "description: An agent",
      "---",
      "",
    ].join("\n");

    expect(() => parseAgentFile(content)).toThrow(
      "Agent file has no body content",
    );
  });

  test("preserves raw content", () => {
    const content = buildAgentContent({
      name: "raw-test",
      description: "Testing raw",
      body: "\n# Raw\n\nPreserved.\n",
    });

    const result = parseAgentFile(content);
    expect(result.raw).toBe(content);
  });

  test("handles claude-code override block without error", () => {
    const content = buildAgentContent({
      name: "claude-override",
      description: "With claude-code overrides",
      extra: {
        "claude-code": {
          permissions: {
            allow: ["Read", "Write"],
            deny: ["Bash"],
          },
        },
      },
    });

    const result = parseAgentFile(content);
    expect(result.frontmatter["claude-code"]).toEqual({
      permissions: {
        allow: ["Read", "Write"],
        deny: ["Bash"],
      },
    });
  });

  test("handles kiro override block without error", () => {
    const content = buildAgentContent({
      name: "kiro-override",
      description: "With kiro overrides",
      extra: {
        kiro: {
          model: "claude-sonnet",
          tools: ["read", "write"],
        },
      },
    });

    const result = parseAgentFile(content);
    expect(result.frontmatter.kiro).toEqual({
      model: "claude-sonnet",
      tools: ["read", "write"],
    });
  });

  test("accepts valid kebab-case names with numbers", () => {
    const content = buildAgentContent({ name: "agent-v2" });
    const result = parseAgentFile(content);
    expect(result.frontmatter.name).toBe("agent-v2");
  });

  test("accepts single-word lowercase name", () => {
    const content = buildAgentContent({ name: "agent" });
    const result = parseAgentFile(content);
    expect(result.frontmatter.name).toBe("agent");
  });
});
