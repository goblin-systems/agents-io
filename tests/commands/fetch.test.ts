import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access, mkdir, readdir, writeFile } from "fs/promises";
import { join } from "path";
import { fetchCommand } from "../../src/commands/fetch.js";
import {
  captureConsoleMessage,
  cleanTempDir,
  createCachedGitHubRepository,
  makeTempDir,
  runGit,
} from "../helpers.js";

let tempDir = "";
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalExit = process.exit;
const originalConfigDir = process.env.AGENTS_IO_CONFIG_DIR;
const loggedMessages: string[] = [];
const errorMessages: string[] = [];

beforeEach(() => {
  loggedMessages.length = 0;
  errorMessages.length = 0;

  console.log = (...args: unknown[]) => {
    loggedMessages.push(captureConsoleMessage(args));
  };

  console.error = (...args: unknown[]) => {
    errorMessages.push(captureConsoleMessage(args));
  };
});

afterEach(async () => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalExit;
  process.env.AGENTS_IO_CONFIG_DIR = originalConfigDir;

  if (tempDir) {
    await cleanTempDir(tempDir);
    tempDir = "";
  }
});

function stubProcessExit(): void {
  process.exit = ((code?: number) => {
    throw new Error(`EXIT:${code ?? 0}`);
  }) as typeof process.exit;
}

describe("fetch command", () => {
  test("checks local sources as a no-op without installing or printing payloads", async () => {
    tempDir = await makeTempDir();
    const sourceDir = join(tempDir, "single-agent");

    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "agent.md"), "# not used by fetch\n", "utf-8");

    await fetchCommand(sourceDir);

    expect(loggedMessages.some((message) => message.includes("Checking local source"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Local source is ready"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes(`path: ${sourceDir}`))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Nothing was cloned for local sources."))).toBe(true);
    expect(errorMessages).toEqual([]);
    expect(await readdir(sourceDir)).toEqual(["agent.md"]);
  });

  test("reports local path hints without trying to clone", async () => {
    tempDir = await makeTempDir();
    const sourceRoot = join(tempDir, "agents-root");

    await mkdir(join(sourceRoot, "agents", "nested-agent"), { recursive: true });

    await fetchCommand(sourceRoot, { path: "agents/nested-agent" });

    expect(loggedMessages.some((message) => message.includes("path hint: agents/nested-agent"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes(`resolved local target: ${join(sourceRoot, "agents", "nested-agent")}`))).toBe(true);
    expect(errorMessages).toEqual([]);
  });

  test("fails non-zero when a local source does not exist", async () => {
    tempDir = await makeTempDir();
    stubProcessExit();

    await expect(fetchCommand(join(tempDir, "missing-agent"))).rejects.toThrow("EXIT:1");

    expect(loggedMessages).toEqual([]);
    expect(errorMessages.some((message) => message.includes("Fetch failed: local source does not exist"))).toBe(true);
    expect(errorMessages.some((message) => message.includes("Check the local path"))).toBe(true);
  });

  test("clones and reports the shared github repository cache without requiring agent.md", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    const repository = await createCachedGitHubRepository({
      rootDir: join(tempDir, "repo-root"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      owner: "Sergej-Popov",
      repo: "agents-io-team",
      files: {
        "README.md": "# repository without agent payload\n",
      },
      skipCacheSeed: true,
    });

    await fetchCommand("Sergej-Popov/agents-io-team");

    expect(loggedMessages.some((message) => message.includes("Fetching repository Sergej-Popov/agents-io-team"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Cloned repository cache for Sergej-Popov/agents-io-team"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes(`cache path: ${repository.expectedCacheDir}`))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("resolved source: https://github.com/Sergej-Popov/agents-io-team"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("ref: default branch"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("resolved commit:"))).toBe(true);
    expect(errorMessages).toEqual([]);
    await expect(access(join(repository.expectedCacheDir, ".git"))).resolves.toBeNull();
    await expect(access(join(tempDir, "agents-io-lock.json"))).rejects.toBeDefined();
  });

  test("refreshes an existing cached github repository and reports pinned refs", async () => {
    tempDir = await makeTempDir();
    process.env.AGENTS_IO_CONFIG_DIR = join(tempDir, "config");

    const repository = await createCachedGitHubRepository({
      rootDir: join(tempDir, "repo-root"),
      configDir: process.env.AGENTS_IO_CONFIG_DIR,
      host: "github.mycompany.com",
      owner: "Sergej-Popov",
      repo: "agents-io-team",
      files: {
        "README.md": "# initial\n",
      },
    });

    await runGit(["checkout", "-b", "release"], repository.workingRepoDir);
    await writeFile(join(repository.workingRepoDir, "README.md"), "# release\n", "utf-8");
    await runGit(["add", "."], repository.workingRepoDir);
    await runGit(["commit", "-m", "Add release branch"], repository.workingRepoDir);
    const releaseCommit = await runGit(["rev-parse", "HEAD"], repository.workingRepoDir);
    await runGit(["push", "-u", "origin", "release"], repository.workingRepoDir);

    await fetchCommand("Sergej-Popov/agents-io-team", {
      host: "github.mycompany.com",
      branch: "release",
    });

    expect(loggedMessages.some((message) => message.includes("Refreshed repository cache for Sergej-Popov/agents-io-team"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("ref: branch: release"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes(`resolved commit: ${releaseCommit}`))).toBe(true);
    expect(errorMessages).toEqual([]);

    const headCommit = await runGit(["rev-parse", "HEAD"], repository.cacheDir);
    expect(headCommit).toBe(releaseCommit);
  });

  test("fails non-zero for invalid repository sources with actionable guidance", async () => {
    stubProcessExit();

    await expect(fetchCommand("not-a-valid-source")).rejects.toThrow("EXIT:1");

    expect(errorMessages.some((message) => message.includes("Invalid GitHub source format"))).toBe(true);
    expect(errorMessages.some((message) => message.includes("Use owner/repo"))).toBe(true);
  });
});
