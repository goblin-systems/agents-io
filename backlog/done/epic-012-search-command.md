# Epic 012: Search command — discover agents via GitHub topic

Status: Done. Implemented and moved to `backlog/done/` in the same work session.

## Problem and outcome

Users must already know an agent's `owner/repo` to install it. There is no discovery mechanism inside `agents-io`. Agent authors have no way to signal that their repo is compatible. This limits adoption on both the supply and demand side.

Outcome: add an `agents-io search <query>` command that finds agents-io-compatible GitHub repos using the `agents-io` GitHub topic convention, with a clear warning that results are unvetted community contributions.

## Discovery mechanism

Repos opt in by adding the GitHub topic `agents-io` to their repository. The CLI searches via `GET /search/repositories?q=topic:agents-io+{query}&sort=stars`. This is a voluntary, human-applied signal using GitHub's existing infrastructure — no registry, no server.

## Requirements and acceptance criteria

### Core module (`src/core/search.ts`)

- New `searchAgents(query)` function that calls the GitHub Repository Search API.
- Searches repos with the `agents-io` topic, combined with the user's query terms.
- Supports `GITHUB_TOKEN` env var for authenticated requests (higher rate limits). Works without it (unauthenticated, 10 req/min).
- Returns structured results: owner/repo, description, stars, updated date, URL.
- Handles rate limiting gracefully — detect 403/rate-limit responses and show a helpful message.
- Handles network errors gracefully.

### Command (`src/commands/search.ts`)

- `agents-io search <query>` — required positional argument.
- Displays a **warning** before results: agents found via search are community-contributed, unvetted, and users should review the source material before installing.
- Displays results using the project logger (not console.log).
- Shows for each result: `owner/repo`, description, star count, last updated.
- If no results found, display a helpful message.
- Wraps in try/catch, uses `log.error()` + `process.exit(1)` on failure.

### CLI registration (`src/index.ts`)

- Register the `search` command with commander.
- Lazy-import the command handler (consistent with other commands).

### Tests

- Unit tests for the core search module with mocked fetch responses.
- Test: successful search with results.
- Test: empty results.
- Test: rate limit error handling.
- Test: network error handling.
- Test: GITHUB_TOKEN is used when present.

### Non-goals

- No interactive "select and install" flow from search results (future enhancement).
- No `--verify` flag to validate results have a real `agent.md` (future enhancement).
- No pagination (first page of results is sufficient for V1).
- No caching of search results.
