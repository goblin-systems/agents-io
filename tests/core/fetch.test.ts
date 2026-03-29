import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { fetchAgent, isLocalPath } from "../../src/core/fetch.js";
import { normalizeGitHubSource } from "../../src/core/repositories.js";
import {
  buildAgentContent,
  cleanTempDir,
  createCachedGitHubRepository,
  makeTempDir,
} from "../helpers.js";

let tempDir = "";
const originalConfigDir = process.env.AGENTS_IO_CONFIG_DIR;

afterEach(async () => {
  process.env.AGENTS_IO_CONFIG_DIR = originalConfigDir;

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

  test("normalizes supported GitHub source formats", () => {
    const expected = {
      owner: "goblin-systems",
      repo: "agents-io-team",
      canonical: "goblin-systems/agents-io-team",
      httpsUrl: "https://github.com/goblin-systems/agents-io-team.git",
      cloneUrl: "https://github.com/goblin-systems/agents-io-team.git",
    };

    expect(normalizeGitHubSource("goblin-systems/agents-io-team")).toEqual(expected);
    expect(
      normalizeGitHubSource("https://github.com/goblin-systems/agents-io-team.git"),
    ).toEqual(expected);
    expect(
      normalizeGitHubSource("git@github.com:goblin-systems/agents-io-team.git"),
    ).toEqual({
      ...expected,
      cloneUrl: "git@github.com:goblin-systems/agents-io-team.git",
    });
    expect(
      normalizeGitHubSource("ssh://git@github.com/goblin-systems/agents-io-team.git"),
    ).toEqual({
      ...expected,
      cloneUrl: "ssh://git@github.com/goblin-systems/agents-io-team.git",
    });
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
        /invalid github source format/i,
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

  test("loads GitHub sources from the local clone cache", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    const repository = await createCachedGitHubRepository({
      rootDir: tempDir,
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      owner: "goblin-systems",
      repo: "agents-io-team",
      files: {
        "agent.md": buildAgentContent({
          name: "team-agent",
          description: "Repository-backed agent",
        }),
        "agent.json": JSON.stringify({ model: "claude-sonnet-4" }, null, 2) + "\n",
        "agents/reviewer/agent.md": buildAgentContent({
          name: "reviewer-agent",
          description: "Nested repository agent",
        }),
      },
    });

    expect(repository.cacheDir.endsWith(".git")).toBe(false);
    expect((await stat(join(repository.cacheDir, ".git"))).isDirectory()).toBe(true);
    expect(await readFile(join(repository.cacheDir, "agent.md"), "utf-8")).toContain(
      "Repository-backed agent",
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network should not be used for cached GitHub fetches");
    }) as typeof fetch;

    try {
      for (const source of [
        "goblin-systems/agents-io-team",
        "https://github.com/goblin-systems/agents-io-team.git",
        "git@github.com:goblin-systems/agents-io-team.git",
        "ssh://git@github.com/goblin-systems/agents-io-team.git",
      ]) {
        const result = await fetchAgent(source);
        expect(result.sourceType).toBe("github");
        expect(result.resolvedSource).toBe("goblin-systems/agents-io-team");
        expect(result.agent.frontmatter.name).toBe("team-agent");
        expect(result.agent.settings.model).toBe("claude-sonnet-4");
      }

      const nestedResult = await fetchAgent("goblin-systems/agents-io-team", {
        path: "agents/reviewer",
      });
      expect(nestedResult.agent.frontmatter.name).toBe("reviewer-agent");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
