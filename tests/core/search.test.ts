import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { searchAgents, GitHubSearchError } from "../../src/core/search.js";
import type { SearchResult } from "../../src/core/search.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(headers),
  });
}

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;

function stubFetch(response: Response): void {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    fetchCalls.push({ url: String(input), init });
    return response;
  }) as typeof fetch;
}

function stubFetchError(error: Error): void {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    fetchCalls.push({ url: String(input), init });
    throw error;
  }) as typeof fetch;
}

function makeItem(overrides?: {
  full_name?: string;
  description?: string | null;
  stargazers_count?: number;
  updated_at?: string;
  html_url?: string;
}) {
  return {
    full_name: overrides?.full_name ?? "owner/repo",
    description:
      overrides !== undefined && "description" in overrides
        ? overrides.description
        : "A cool agent",
    stargazers_count: overrides?.stargazers_count ?? 42,
    updated_at: overrides?.updated_at ?? "2025-06-01T12:00:00Z",
    html_url: overrides?.html_url ?? "https://github.com/owner/repo",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("searchAgents", () => {
  beforeEach(() => {
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GITHUB_TOKEN;
  });

  test("returns mapped results for a successful search response", async () => {
    const items = [
      makeItem({
        full_name: "alice/agent-one",
        description: "First agent",
        stargazers_count: 100,
        updated_at: "2025-07-01T00:00:00Z",
        html_url: "https://github.com/alice/agent-one",
      }),
      makeItem({
        full_name: "bob/agent-two",
        description: "Second agent",
        stargazers_count: 50,
        updated_at: "2025-06-15T00:00:00Z",
        html_url: "https://github.com/bob/agent-two",
      }),
    ];

    stubFetch(
      mockResponse(200, { total_count: 2, incomplete_results: false, items }),
    );

    const results = await searchAgents("test");

    expect(results).toHaveLength(2);

    expect(results[0]).toEqual<SearchResult>({
      repo: "alice/agent-one",
      description: "First agent",
      stars: 100,
      updatedAt: "2025-07-01T00:00:00Z",
      url: "https://github.com/alice/agent-one",
    });

    expect(results[1]).toEqual<SearchResult>({
      repo: "bob/agent-two",
      description: "Second agent",
      stars: 50,
      updatedAt: "2025-06-15T00:00:00Z",
      url: "https://github.com/bob/agent-two",
    });
  });

  test("returns empty array when no results found", async () => {
    stubFetch(
      mockResponse(200, { total_count: 0, incomplete_results: false, items: [] }),
    );

    const results = await searchAgents("nonexistent");

    expect(results).toEqual([]);
  });

  test("maps null description to empty string", async () => {
    const items = [makeItem({ description: null })];

    stubFetch(
      mockResponse(200, { total_count: 1, incomplete_results: false, items }),
    );

    const results = await searchAgents("nullable");

    expect(results).toHaveLength(1);
    expect(results[0].description).toBe("");
  });

  test("throws GitHubSearchError on rate limit (403 with x-ratelimit-remaining: 0)", async () => {
    const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;

    stubFetch(
      mockResponse(403, {}, {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(resetTimestamp),
      }),
    );

    try {
      await searchAgents("rate-limited");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubSearchError);
      const ghError = error as GitHubSearchError;
      expect(ghError.statusCode).toBe(403);
      expect(ghError.message).toContain("rate limit");
      expect(ghError.message).toContain("GITHUB_TOKEN");
    }
  });

  test("throws GitHubSearchError on generic 403", async () => {
    stubFetch(mockResponse(403, {}));

    try {
      await searchAgents("forbidden");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubSearchError);
      const ghError = error as GitHubSearchError;
      expect(ghError.statusCode).toBe(403);
      expect(ghError.message).toContain("forbidden");
    }
  });

  test("throws GitHubSearchError on 422", async () => {
    stubFetch(mockResponse(422, {}));

    try {
      await searchAgents("bad query!@#");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubSearchError);
      const ghError = error as GitHubSearchError;
      expect(ghError.statusCode).toBe(422);
      expect(ghError.message).toContain("rejected");
      expect(ghError.message).toContain("simplifying");
    }
  });

  test("throws GitHubSearchError on other non-OK status", async () => {
    stubFetch(mockResponse(500, {}));

    try {
      await searchAgents("server-error");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubSearchError);
      const ghError = error as GitHubSearchError;
      expect(ghError.statusCode).toBe(500);
      expect(ghError.message).toContain("500");
    }
  });

  test("throws on network error", async () => {
    stubFetchError(new Error("getaddrinfo ENOTFOUND api.github.com"));

    try {
      await searchAgents("offline");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(GitHubSearchError);
      expect((error as Error).message).toContain("Network error");
      expect((error as Error).message).toContain("ENOTFOUND");
    }
  });

  test("includes Authorization header when GITHUB_TOKEN is set", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123456";

    stubFetch(
      mockResponse(200, { total_count: 0, incomplete_results: false, items: [] }),
    );

    await searchAgents("auth-test");

    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0].init?.headers as Record<string, string> | undefined;
    expect(headers).toBeDefined();
    expect(headers!.Authorization).toBe("Bearer ghp_test123456");
  });

  test("does not include Authorization header when GITHUB_TOKEN is unset", async () => {
    delete process.env.GITHUB_TOKEN;

    stubFetch(
      mockResponse(200, { total_count: 0, incomplete_results: false, items: [] }),
    );

    await searchAgents("no-auth-test");

    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0].init?.headers as Record<string, string> | undefined;
    expect(headers).toBeDefined();
    expect(headers!.Authorization).toBeUndefined();
  });

  test("searches all agents-io repos when no query is provided", async () => {
    const items = [
      makeItem({
        full_name: "alice/cool-agent",
        description: "An agent for everyone",
        stargazers_count: 77,
        updated_at: "2025-08-01T00:00:00Z",
        html_url: "https://github.com/alice/cool-agent",
      }),
    ];

    stubFetch(
      mockResponse(200, { total_count: 1, incomplete_results: false, items }),
    );

    const results = await searchAgents();

    expect(fetchCalls).toHaveLength(1);
    const url = fetchCalls[0].url;
    expect(url).toContain("topic%3Aagents-io");
    expect(url).not.toContain("topic%3Aagents-io+");

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual<SearchResult>({
      repo: "alice/cool-agent",
      description: "An agent for everyone",
      stars: 77,
      updatedAt: "2025-08-01T00:00:00Z",
      url: "https://github.com/alice/cool-agent",
    });
  });
});
