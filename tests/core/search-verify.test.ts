import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { verifySearchResults } from "../../src/core/search.js";
import {
  cleanTempDir,
  createCachedGitHubRepository,
  makeTempDir,
} from "../helpers.js";

let tempDir = "";
const originalConfigDir = process.env.AGENTS_IO_CONFIG_DIR;

afterEach(async () => {
  if (originalConfigDir === undefined) {
    delete process.env.AGENTS_IO_CONFIG_DIR;
  } else {
    process.env.AGENTS_IO_CONFIG_DIR = originalConfigDir;
  }

  if (tempDir) {
    await cleanTempDir(tempDir);
    tempDir = "";
  }
});

describe("verifySearchResults", () => {
  test("classifies root, discovered, convertible, and non-installable repositories", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    await createCachedGitHubRepository({
      rootDir: join(tempDir, "root-repo"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      owner: "alice",
      repo: "root-agent",
      files: {
        "agent.md": [
          "---",
          "name: root-agent",
          'description: "Root agent"',
          "---",
          "",
          "# Root Agent",
          "",
          "Installable from root.",
          "",
        ].join("\n"),
      },
    });

    await createCachedGitHubRepository({
      rootDir: join(tempDir, "discovered-repo"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      owner: "bob",
      repo: "team-agents",
      files: {
        "alpha/agent.md": [
          "---",
          "name: alpha-agent",
          'description: "Alpha agent"',
          "---",
          "",
          "# Alpha Agent",
          "",
          "Alpha body.",
          "",
        ].join("\n"),
        "agents/beta/agent.md": [
          "---",
          "name: beta-agent",
          'description: "Beta agent"',
          "---",
          "",
          "# Beta Agent",
          "",
          "Beta body.",
          "",
        ].join("\n"),
      },
    });

    await createCachedGitHubRepository({
      rootDir: join(tempDir, "convertible-repo"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      owner: "carol",
      repo: "convertible-agent",
      files: {
        "AGENTS.md": "# Convertible Agent\n\nYou can try converting this.\n",
      },
    });

    await createCachedGitHubRepository({
      rootDir: join(tempDir, "invalid-repo"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      owner: "dave",
      repo: "not-installable",
      files: {
        "README.md": "# Not installable\n",
      },
    });

    const verified = await verifySearchResults([
      {
        repo: "alice/root-agent",
        description: "",
        stars: 10,
        updatedAt: "2026-01-01T00:00:00Z",
        url: "https://github.com/alice/root-agent",
      },
      {
        repo: "bob/team-agents",
        description: "",
        stars: 8,
        updatedAt: "2026-01-02T00:00:00Z",
        url: "https://github.com/bob/team-agents",
      },
      {
        repo: "carol/convertible-agent",
        description: "",
        stars: 5,
        updatedAt: "2026-01-03T00:00:00Z",
        url: "https://github.com/carol/convertible-agent",
      },
      {
        repo: "dave/not-installable",
        description: "",
        stars: 1,
        updatedAt: "2026-01-04T00:00:00Z",
        url: "https://github.com/dave/not-installable",
      },
    ]);

    expect(verified).toHaveLength(4);
    expect(verified[0]?.verification).toEqual({
      kind: "root",
      installable: true,
      summary: "installable at repo root",
    });
    expect(verified[1]?.verification.kind).toBe("discovered");
    expect(verified[1]?.verification.installable).toBe(true);
    expect(verified[1]?.verification.summary).toBe("installable via discovery (2 agents)");
    expect(verified[1]?.verification.agentPaths).toEqual(["alpha", "agents/beta"]);
    expect(verified[2]?.verification).toEqual({
      kind: "convertible-root",
      installable: false,
      summary: "best-effort convertible from AGENTS.md",
    });
    expect(verified[3]?.verification).toEqual({
      kind: "unverified",
      installable: false,
      summary: "not installable by current agents-io source rules",
    });
  }, 15000);

  test("marks invalid verification inputs as unverified", async () => {
    const verified = await verifySearchResults([
      {
        repo: "not-a-valid-source",
        description: "",
        stars: 0,
        updatedAt: "2026-01-05T00:00:00Z",
        url: "https://github.com/not-a-valid-source",
      },
    ]);

    expect(verified[0]?.verification.kind).toBe("unverified");
    expect(verified[0]?.verification.installable).toBe(false);
    expect(verified[0]?.verification.summary).toContain("Invalid GitHub source format");
  });
});
