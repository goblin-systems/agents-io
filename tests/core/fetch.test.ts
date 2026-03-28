import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { fetchAgent, isLocalPath } from "../../src/core/fetch.js";
import { buildAgentContent, cleanTempDir, makeTempDir } from "../helpers.js";

let tempDir = "";

afterEach(async () => {
  if (tempDir) {
    await cleanTempDir(tempDir);
    tempDir = "";
  }
});

describe("fetchAgent (local)", () => {
  test("detects local path formats", () => {
    expect(isLocalPath("./agents/reviewer")).toBe(true);
    expect(isLocalPath("/agents/reviewer")).toBe(true);
    expect(isLocalPath("C:\\agents\\reviewer")).toBe(true);
    expect(isLocalPath("owner/repo")).toBe(false);
  });

  test("loads a local agent directory without network access", async () => {
    tempDir = await makeTempDir();

    await writeFile(
      join(tempDir, "agent.md"),
      buildAgentContent({ name: "local-agent", description: "Local agent" }),
      "utf-8",
    );

    await writeFile(
      join(tempDir, "agent.json"),
      JSON.stringify({ color: "#112233", model: "claude-sonnet-4" }, null, 2) + "\n",
      "utf-8",
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network should not be used for local fetches");
    }) as typeof fetch;

    try {
      const result = await fetchAgent(tempDir);

      expect(result.sourceType).toBe("local");
      expect(result.resolvedSource).toBe(tempDir);
      expect(result.agent.frontmatter.name).toBe("local-agent");
      expect(result.agent.settings.color).toBe("#112233");
      expect(result.agent.settings.model).toBe("claude-sonnet-4");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loads a local agent from a nested path", async () => {
    tempDir = await makeTempDir();

    await mkdir(join(tempDir, "agents", "reviewer"), { recursive: true });
    await writeFile(
      join(tempDir, "agents", "reviewer", "agent.md"),
      buildAgentContent({ name: "nested-agent", description: "Nested agent" }),
      "utf-8",
    );

    const result = await fetchAgent(tempDir, { path: "agents/reviewer" });

    expect(result.sourceType).toBe("local");
    expect(result.agent.frontmatter.name).toBe("nested-agent");
    expect(result.resolvedSource).toBe(tempDir);
  });

  test("throws when agent.md does not exist at local path (ENOENT)", async () => {
    tempDir = await makeTempDir();
    // tempDir exists but contains no agent.md

    await expect(fetchAgent(tempDir)).rejects.toThrow(/agent file not found/i);
  });

  test("throws for invalid source format and makes no network requests", async () => {
    // "not-a-valid-source" has no `.`, no `/` owner/repo, no `\`, no `:` — not local,
    // not a valid owner/repo pattern, so fetchGitHubAgent should reject immediately.
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      throw new Error("network should not be used");
    }) as typeof fetch;

    try {
      await expect(fetchAgent("not-a-valid-source")).rejects.toThrow(
        /invalid source format/i,
      );
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loads a local agent from a direct .md file reference", async () => {
    tempDir = await makeTempDir();

    await writeFile(
      join(tempDir, "agent.md"),
      buildAgentContent({ name: "direct-md-agent", description: "Direct md agent" }),
      "utf-8",
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network should not be used for local fetches");
    }) as typeof fetch;

    try {
      const result = await fetchAgent(join(tempDir, "agent.md"));

      expect(result.sourceType).toBe("local");
      expect(result.agent.frontmatter.name).toBe("direct-md-agent");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("handles malformed agent.json gracefully and returns empty settings", async () => {
    tempDir = await makeTempDir();

    await writeFile(
      join(tempDir, "agent.md"),
      buildAgentContent({ name: "settings-agent", description: "Settings agent" }),
      "utf-8",
    );

    // Write syntactically invalid JSON — parse failure must be silently swallowed
    await writeFile(join(tempDir, "agent.json"), "not valid json {{{", "utf-8");

    const result = await fetchAgent(tempDir);

    expect(result.agent.frontmatter.name).toBe("settings-agent");
    expect(result.agent.settings).toEqual({});
  });
});
