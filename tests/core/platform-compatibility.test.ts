import { describe, expect, test } from "bun:test";
import { parseAgentFile } from "../../src/core/parse.js";
import {
  deriveKiroTools,
  getPlatformCompatibilityIssues,
} from "../../src/core/platform-compatibility.js";
import { buildAgentContent } from "../helpers.js";

describe("platform compatibility", () => {
  test("derives Kiro tools from supported generic tools only", () => {
    expect(
      deriveKiroTools({
        read: true,
        glob: true,
        grep: true,
        write: true,
        edit: true,
        bash: true,
        fetch: true,
      }),
    ).toEqual(["read", "write", "shell"]);
  });

  test("errors when Kiro cannot map any enabled generic tools", () => {
    const agent = parseAgentFile(
      buildAgentContent({
        extra: {
          tools: {
            fetch: true,
            web: true,
          },
        },
      }),
    );

    expect(getPlatformCompatibilityIssues(agent, ["kiro"])).toEqual([
      expect.objectContaining({
        platform: "kiro",
        severity: "error",
      }),
    ]);
  });

  test("warns when some generic tools do not map to Kiro", () => {
    const agent = parseAgentFile(
      buildAgentContent({
        extra: {
          tools: {
            read: true,
            fetch: true,
          },
        },
      }),
    );

    expect(getPlatformCompatibilityIssues(agent, ["kiro"])).toEqual([
      expect.objectContaining({
        platform: "kiro",
        severity: "warning",
      }),
    ]);
  });

  test("warns when Codex drops metadata and agent settings", () => {
    const agent = parseAgentFile(
      buildAgentContent({
        mode: "primary",
        tools: { read: true },
        extra: {
          color: "#112233",
          model: "gpt-5",
          kiro: { tools: ["read"] },
        },
      }),
      {
        temperature: 0.3,
        model: "o3",
      },
    );

    const messages = getPlatformCompatibilityIssues(agent, ["codex"]).map((issue) => issue.message);

    expect(messages.some((message) => message.includes("mode") && message.includes("dropped fields"))).toBe(true);
    expect(messages.some((message) => message.includes("agent.json:temperature"))).toBe(true);
  });

  test("warns when non-OpenCode platforms drop primary mode distinction", () => {
    const agent = parseAgentFile(buildAgentContent({ mode: "primary" }));

    expect(getPlatformCompatibilityIssues(agent, ["opencode", "claude-code", "kiro"])).toEqual([
      expect.objectContaining({
        platform: "claude-code",
        severity: "warning",
      }),
      expect.objectContaining({
        platform: "kiro",
        severity: "warning",
      }),
    ]);
  });
});
