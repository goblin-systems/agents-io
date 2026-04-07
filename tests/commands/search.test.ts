import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { searchCommand } from "../../src/commands/search.js";
import {
  captureConsoleMessage,
  cleanTempDir,
  createCachedGitHubRepository,
  makeTempDir,
} from "../helpers.js";

function mockResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: "OK",
    headers: new Headers(),
  });
}

let tempDir = "";
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalExit = process.exit;
const originalConfigDir = process.env.AGENTS_IO_CONFIG_DIR;
const loggedMessages: string[] = [];
const errorMessages: string[] = [];

beforeEach(() => {
  fetchCalls = [];
  loggedMessages.length = 0;
  errorMessages.length = 0;

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    fetchCalls.push({ url: String(input), init });

    return mockResponse({
      total_count: 4,
      incomplete_results: false,
      items: [
        {
          full_name: "alice/root-agent",
          description: "Root agent",
          stargazers_count: 10,
          updated_at: "2026-01-01T00:00:00Z",
          html_url: "https://github.com/alice/root-agent",
        },
        {
          full_name: "bob/team-agents",
          description: "Nested agents",
          stargazers_count: 8,
          updated_at: "2026-01-02T00:00:00Z",
          html_url: "https://github.com/bob/team-agents",
        },
        {
          full_name: "carol/convertible-agent",
          description: "Convertible topic repo",
          stargazers_count: 5,
          updated_at: "2026-01-03T00:00:00Z",
          html_url: "https://github.com/carol/convertible-agent",
        },
        {
          full_name: "dave/not-installable",
          description: "Topic only",
          stargazers_count: 2,
          updated_at: "2026-01-04T00:00:00Z",
          html_url: "https://github.com/dave/not-installable",
        },
      ],
    });
  }) as typeof fetch;

  console.log = (...args: unknown[]) => {
    loggedMessages.push(captureConsoleMessage(args));
  };

  console.error = (...args: unknown[]) => {
    errorMessages.push(captureConsoleMessage(args));
  };

  process.exit = ((code?: number) => {
    throw new Error(`EXIT:${code ?? 0}`);
  }) as typeof process.exit;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalExit;
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

describe("search command", () => {
  test("shows plain GitHub topic results without verification details", async () => {
    await searchCommand("agent");

    expect(fetchCalls).toHaveLength(1);
    expect(loggedMessages.some((message) => message.includes("alice/root-agent ★ 10"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("verify:"))).toBe(false);
    expect(loggedMessages).toContain("✓  Found 4 agent(s)");
    expect(loggedMessages).toContain("| Install with: agents-io add <owner/repo>");
    expect(errorMessages).toEqual([]);
  });

  test("shows installability details when --verify is enabled", async () => {
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

    await searchCommand("agent", { verify: true });

    expect(fetchCalls).toHaveLength(1);
    expect(
      loggedMessages.some((message) =>
        message.includes("Verification reuses the same source-resolution rules as install and validate."),
      ),
    ).toBe(true);
    expect(
      loggedMessages.some((message) =>
        message.includes("verify: installable - installable at repo root"),
      ),
    ).toBe(true);
    expect(
      loggedMessages.some((message) =>
        message.includes("verify: installable - installable via discovery (2 agents)"),
      ),
    ).toBe(true);
    expect(
      loggedMessages.some((message) =>
        message.includes("verify: convertible - best-effort convertible from AGENTS.md"),
      ),
    ).toBe(true);
    expect(loggedMessages.some((message) => message.includes("agent paths: alpha, agents/beta"))).toBe(true);
    expect(
      loggedMessages.some((message) =>
        message.includes("verify: not installable - not installable by current agents-io source rules"),
      ),
    ).toBe(true);
    expect(loggedMessages).toContain(
      "✓  Found 4 agent(s); 2 installable without conversion, 1 best-effort convertible",
    );
    expect(loggedMessages).toContain("| Install root results with: agents-io add <owner/repo>");
    expect(loggedMessages).toContain(
      "| Install discovered results with: agents-io add <owner/repo> --path <agent-path>",
    );
    expect(errorMessages).toEqual([]);
  }, 15000);
});
