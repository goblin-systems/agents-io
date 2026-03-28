import { describe, test, expect, afterEach } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";
import {
  hashContent,
  getLockFilePath,
  readLockFile,
  writeLockFile,
  addAgent,
  removeAgent,
  getAgent,
  listAgents,
} from "../../src/core/registry.js";
import type { InstalledAgent, LockFile } from "../../src/types.js";
import { makeTempDir, cleanTempDir } from "../helpers.js";

let tmpDir: string;

afterEach(async () => {
  if (tmpDir) {
    await cleanTempDir(tmpDir);
  }
});

function makeEntry(overrides?: Partial<InstalledAgent>): InstalledAgent {
  return {
    source: overrides?.source ?? "owner/repo",
    sourceType: overrides?.sourceType ?? "github",
    sourceUrl: overrides?.sourceUrl ?? "https://github.com/owner/repo",
    agentPath: overrides?.agentPath ?? "agents/test-agent.md",
    installedAt: overrides?.installedAt ?? new Date().toISOString(),
    platforms: overrides?.platforms ?? ["opencode"],
    hash: overrides?.hash ?? "abc123def456",
  };
}

describe("hashContent", () => {
  test("returns consistent 12-char hex string", () => {
    const hash = hashContent("hello world");
    expect(hash).toHaveLength(12);
    expect(hash).toMatch(/^[a-f0-9]{12}$/);

    // Same input → same output
    expect(hashContent("hello world")).toBe(hash);
  });

  test("returns different hashes for different content", () => {
    const a = hashContent("content A");
    const b = hashContent("content B");
    expect(a).not.toBe(b);
  });
});

describe("getLockFilePath", () => {
  test("returns project-level path when not global", () => {
    const path = getLockFilePath(false, "/my/project");
    expect(path).toBe(join("/my/project", "agnts-lock.json"));
  });
});

describe("readLockFile", () => {
  test("returns empty lock file when file doesn't exist", async () => {
    tmpDir = await makeTempDir();
    const lockFile = await readLockFile(false, tmpDir);
    expect(lockFile).toEqual({ version: 1, agents: {} });
  });
});

describe("writeLockFile", () => {
  test("creates file with correct JSON format (pretty-printed, trailing newline)", async () => {
    tmpDir = await makeTempDir();
    const lockFile: LockFile = { version: 1, agents: {} };

    await writeLockFile(lockFile, false, tmpDir);

    const filePath = join(tmpDir, "agnts-lock.json");
    const content = await readFile(filePath, "utf-8");

    // Pretty-printed
    expect(content).toContain("{\n");
    // Trailing newline
    expect(content.endsWith("\n")).toBe(true);
    // Parseable
    const parsed = JSON.parse(content);
    expect(parsed).toEqual(lockFile);
  });
});

describe("addAgent", () => {
  test("adds entry and persists", async () => {
    tmpDir = await makeTempDir();
    const entry = makeEntry();

    await addAgent("test-agent", entry, false, tmpDir);

    const result = await getAgent("test-agent", false, tmpDir);
    expect(result).toEqual(entry);
  });

  test("updates existing entry", async () => {
    tmpDir = await makeTempDir();
    const entry1 = makeEntry({ hash: "aaaaaaaaaaaa" });
    const entry2 = makeEntry({ hash: "bbbbbbbbbbbb" });

    await addAgent("test-agent", entry1, false, tmpDir);
    await addAgent("test-agent", entry2, false, tmpDir);

    const result = await getAgent("test-agent", false, tmpDir);
    expect(result?.hash).toBe("bbbbbbbbbbbb");
  });
});

describe("removeAgent", () => {
  test("removes entry", async () => {
    tmpDir = await makeTempDir();
    const entry = makeEntry();

    await addAgent("test-agent", entry, false, tmpDir);
    await removeAgent("test-agent", false, tmpDir);

    const result = await getAgent("test-agent", false, tmpDir);
    expect(result).toBeUndefined();
  });

  test("is no-op for non-existent agent", async () => {
    tmpDir = await makeTempDir();
    // Should not throw
    await removeAgent("nonexistent", false, tmpDir);

    const agents = await listAgents(false, tmpDir);
    expect(agents).toEqual({});
  });
});

describe("getAgent", () => {
  test("returns entry when it exists", async () => {
    tmpDir = await makeTempDir();
    const entry = makeEntry();
    await addAgent("my-agent", entry, false, tmpDir);

    const result = await getAgent("my-agent", false, tmpDir);
    expect(result).toEqual(entry);
  });

  test("returns undefined for non-existent agent", async () => {
    tmpDir = await makeTempDir();
    const result = await getAgent("nonexistent", false, tmpDir);
    expect(result).toBeUndefined();
  });
});

describe("listAgents", () => {
  test("returns all agents", async () => {
    tmpDir = await makeTempDir();
    const entry1 = makeEntry({ hash: "111111111111" });
    const entry2 = makeEntry({ hash: "222222222222" });

    await addAgent("agent-a", entry1, false, tmpDir);
    await addAgent("agent-b", entry2, false, tmpDir);

    const agents = await listAgents(false, tmpDir);
    expect(Object.keys(agents)).toHaveLength(2);
    expect(agents["agent-a"]).toEqual(entry1);
    expect(agents["agent-b"]).toEqual(entry2);
  });

  test("returns empty object when no agents", async () => {
    tmpDir = await makeTempDir();
    const agents = await listAgents(false, tmpDir);
    expect(agents).toEqual({});
  });
});
