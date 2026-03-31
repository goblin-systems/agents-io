import { describe, test, expect, afterEach } from "bun:test";
import { writeFile, mkdir, stat } from "fs/promises";
import { join } from "path";
import { discoverAgents } from "../../src/core/discover.js";
import {
  buildAgentContent,
  makeTempDir,
  cleanTempDir,
  createCachedGitHubRepository,
} from "../helpers.js";

let tempDir: string;
const originalConfigDir = process.env.AGENTS_IO_CONFIG_DIR;

afterEach(async () => {
  process.env.AGENTS_IO_CONFIG_DIR = originalConfigDir;

  if (tempDir) {
    await cleanTempDir(tempDir);
  }
});

describe("discoverAgents (local)", () => {
  test("discovers agents in subdirectories", async () => {
    tempDir = await makeTempDir();

    // Create two agent subdirs
    await mkdir(join(tempDir, "alpha"));
    await writeFile(
      join(tempDir, "alpha", "agent.md"),
      buildAgentContent({ name: "alpha-agent", description: "Alpha agent" }),
    );

    await mkdir(join(tempDir, "beta"));
    await writeFile(
      join(tempDir, "beta", "agent.md"),
      buildAgentContent({ name: "beta-agent", description: "Beta agent" }),
    );

    const agents = await discoverAgents(tempDir);

    expect(agents).toHaveLength(2);

    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(["alpha-agent", "beta-agent"]);

    const alpha = agents.find((a) => a.name === "alpha-agent")!;
    expect(alpha.path).toBe("alpha");
    expect(alpha.description).toBe("Alpha agent");

    const beta = agents.find((a) => a.name === "beta-agent")!;
    expect(beta.path).toBe("beta");
    expect(beta.description).toBe("Beta agent");
  });

  test("discovers agents in agents/ folder", async () => {
    tempDir = await makeTempDir();

    await mkdir(join(tempDir, "agents", "foo"), { recursive: true });
    await writeFile(
      join(tempDir, "agents", "foo", "agent.md"),
      buildAgentContent({ name: "foo-agent", description: "Foo agent" }),
    );

    await mkdir(join(tempDir, "agents", "bar"), { recursive: true });
    await writeFile(
      join(tempDir, "agents", "bar", "agent.md"),
      buildAgentContent({ name: "bar-agent", description: "Bar agent" }),
    );

    const agents = await discoverAgents(tempDir);

    expect(agents).toHaveLength(2);

    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(["bar-agent", "foo-agent"]);

    const foo = agents.find((a) => a.name === "foo-agent")!;
    expect(foo.path).toBe("agents/foo");

    const bar = agents.find((a) => a.name === "bar-agent")!;
    expect(bar.path).toBe("agents/bar");
  });

  test("discovers agents in both subdirs and agents/ folder", async () => {
    tempDir = await makeTempDir();

    // Top-level subdir
    await mkdir(join(tempDir, "top-agent"));
    await writeFile(
      join(tempDir, "top-agent", "agent.md"),
      buildAgentContent({ name: "top-agent", description: "Top level agent" }),
    );

    // agents/ subdir
    await mkdir(join(tempDir, "agents", "nested"), { recursive: true });
    await writeFile(
      join(tempDir, "agents", "nested", "agent.md"),
      buildAgentContent({ name: "nested-agent", description: "Nested agent" }),
    );

    const agents = await discoverAgents(tempDir);

    expect(agents).toHaveLength(2);

    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(["nested-agent", "top-agent"]);

    expect(agents.find((a) => a.name === "top-agent")!.path).toBe("top-agent");
    expect(agents.find((a) => a.name === "nested-agent")!.path).toBe("agents/nested");
  });

  test("skips hidden directories", async () => {
    tempDir = await makeTempDir();

    await mkdir(join(tempDir, ".hidden"));
    await writeFile(
      join(tempDir, ".hidden", "agent.md"),
      buildAgentContent({ name: "hidden-agent", description: "Hidden" }),
    );

    const agents = await discoverAgents(tempDir);
    expect(agents).toHaveLength(0);
  });

  test("skips directories without agent.md", async () => {
    tempDir = await makeTempDir();

    await mkdir(join(tempDir, "no-agent"));
    await writeFile(join(tempDir, "no-agent", "README.md"), "# Hello");

    await mkdir(join(tempDir, "also-nothing"));

    const agents = await discoverAgents(tempDir);
    expect(agents).toHaveLength(0);
  });

  test("skips files with invalid frontmatter", async () => {
    tempDir = await makeTempDir();

    // Missing name
    await mkdir(join(tempDir, "missing-name"));
    await writeFile(
      join(tempDir, "missing-name", "agent.md"),
      "---\ndescription: No name here\n---\n\n# Body\n",
    );

    // Missing description
    await mkdir(join(tempDir, "missing-desc"));
    await writeFile(
      join(tempDir, "missing-desc", "agent.md"),
      "---\nname: missing-desc\n---\n\n# Body\n",
    );

    // No frontmatter at all
    await mkdir(join(tempDir, "no-frontmatter"));
    await writeFile(
      join(tempDir, "no-frontmatter", "agent.md"),
      "# Just a markdown file\n",
    );

    const agents = await discoverAgents(tempDir);
    expect(agents).toHaveLength(0);
  });

  test("returns empty array for empty directory", async () => {
    tempDir = await makeTempDir();

    const agents = await discoverAgents(tempDir);
    expect(agents).toEqual([]);
  });

  test("returns empty for directory with only root agent.md", async () => {
    tempDir = await makeTempDir();

    // Root has agent.md but no subdirs with agents
    await writeFile(
      join(tempDir, "agent.md"),
      buildAgentContent({ name: "root-agent", description: "Root agent" }),
    );

    const agents = await discoverAgents(tempDir);
    expect(agents).toEqual([]);
  });
});

describe("discoverAgents (edge cases)", () => {
  test("returns empty array for a non-existent local path without throwing", async () => {
    const agents = await discoverAgents("/this/path/does/not/exist/at/all");
    expect(agents).toEqual([]);
  });

  test("returns empty array when local path points to a file, not a directory", async () => {
    tempDir = await makeTempDir();

    await writeFile(join(tempDir, "notes.txt"), "just a text file", "utf-8");

    const agents = await discoverAgents(join(tempDir, "notes.txt"));
    expect(agents).toEqual([]);
  });

  test("returns empty array for GitHub source that fails SOURCE_RE guard (double slash) and makes no network requests", async () => {
    // "not//valid" contains a double slash — split("/")[0] would be "not" and
    // SOURCE_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/ rejects the full string,
    // so discoverGitHub returns early before any fetch is made.
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      throw new Error("network should not be used");
    }) as typeof fetch;

    try {
      const agents = await discoverAgents("not//valid");
      expect(agents).toEqual([]);
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns empty array for plain string with no slash (SOURCE_RE guard) and makes no network requests", async () => {
    // "nodash" has no `/`, no `.`, no `\`, no `:` — not local, goes to discoverGitHub.
    // SOURCE_RE requires the pattern owner/repo, so it fails and returns [] without network.
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      throw new Error("network should not be used");
    }) as typeof fetch;

    try {
      const agents = await discoverAgents("nodash");
      expect(agents).toEqual([]);
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("discovers agents from a cached GitHub repository", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    const repository = await createCachedGitHubRepository({
      rootDir: tempDir,
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      owner: "goblin-systems",
      repo: "agents-io-team",
      files: {
        "agents/reviewer/agent.md": buildAgentContent({
          name: "reviewer-agent",
          description: "Code review helper",
        }),
        "agents/releaser/agent.md": buildAgentContent({
          name: "releaser-agent",
          description: "Release helper",
        }),
      },
    });

    expect(repository.cacheDir.endsWith(".git")).toBe(false);
    expect((await stat(join(repository.cacheDir, ".git"))).isDirectory()).toBe(true);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network should not be used for cached GitHub discovery");
    }) as typeof fetch;

    try {
      const agents = await discoverAgents("git@github.com:goblin-systems/agents-io-team.git");

      expect(agents.map((agent) => agent.name).sort()).toEqual([
        "releaser-agent",
        "reviewer-agent",
      ]);
      expect(agents.find((agent) => agent.name === "reviewer-agent")?.path).toBe(
        "agents/reviewer",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("discovers agents from a cached GitHub Enterprise repository via --host shorthand resolution", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    await createCachedGitHubRepository({
      rootDir: tempDir,
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      host: "github.mycompany.com",
      owner: "goblin-systems",
      repo: "agents-io-team",
      files: {
        "agents/reviewer/agent.md": buildAgentContent({
          name: "reviewer-agent",
          description: "Enterprise code review helper",
        }),
      },
    });

    const agents = await discoverAgents(
      "goblin-systems/agents-io-team",
      undefined,
      "github.mycompany.com",
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]?.name).toBe("reviewer-agent");
    expect(agents[0]?.path).toBe("agents/reviewer");
  });
});
