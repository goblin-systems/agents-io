# AGENTS.md — agents-io

## Project overview

`agents-io` is a CLI tool that installs AI coding agents from GitHub repositories into local tool configurations. It fetches an `agent.md` file from a GitHub repo or local filesystem path, parses its YAML frontmatter + markdown body, and writes the appropriate files for each supported tool (OpenCode, Claude Code, Codex, Kiro).

- **Runtime:** Bun + TypeScript (strict), ESM modules
- **Build:** `bun build` produces a single-file Node-compatible bundle at `dist/index.js`
- **Production dependencies (4 only):** commander, chalk, gray-matter, @clack/prompts

## Development commands

```bash
bun run typecheck        # Type-check with tsc --noEmit (run this before committing)
bun run build            # Bundle to dist/index.js
bun run dev              # Run src/index.ts directly via Bun
```

Test commands during development:

```bash
bun run src/index.ts add owner/repo       # Test the add command
bun run src/index.ts list                 # Test the list command
bun run src/index.ts remove agent-name    # Test the remove command
bun run src/index.ts init test-agent      # Test the init scaffold
bun run src/index.ts update                   # Test the update command
bun run src/index.ts add ./path/to/agent      # Test local path install
```

Always run `bun run typecheck` and `bun test` after making changes.

## Directory structure

```
backlog/
  epic-*.md            Active backlog items
  done/                Completed epics moved here
src/
  index.ts              CLI entry point — commander program for add, fetch, validate, doctor, sync, list, remove, init, update, and search
  types.ts              Shared TypeScript interfaces (Adapter, ParsedAgent, LockFile, etc.)
  commands/
    add.ts              `agents-io add <source>` — fetch + install + register in lock file
    fetch.ts            `agents-io fetch <source>` — clone or refresh a source repository cache without installing
    validate.ts         `agents-io validate <source>` — validate fetch + parse rules without installing
    list.ts             `agents-io list` — display installed agents (project + global)
    remove.ts           `agents-io remove <name>` — uninstall from adapters + deregister
    init.ts             `agents-io init [name]` — scaffold a new agent template directory
    update.ts           `agents-io update [name]` — re-fetch, compare hash, re-install if changed
  core/
    parse.ts            gray-matter frontmatter parser with validation (name, description, mode, tools)
    fetch.ts            Fetches agent.md from GitHub or local paths (tries main then master for GitHub)
    registry.ts         Reads/writes agents-io-lock.json (SHA-256 hashing, CRUD operations)
  adapters/
    opencode.ts         Writes agents/{name}.md + updates opencode.json
    claude-code.ts      Writes .claude/agents/{name}.md + updates settings.json
    codex.ts            Appends delimited sections to AGENTS.md using HTML comment tags
    kiro.ts             Writes .kiro/agents/{name}.json
  utils/
    logger.ts           chalk-based structured logger with info, success, warn, error, dim methods
    paths.ts            Platform config path resolution + findProjectRoot (walks up looking for markers)
```

## Backlog process

- The backlog lives in `backlog/`.
- Track active work as `epic-*.md` files only; do not use `issue-*.md` files.
- Move completed epics to `backlog/done/` instead of deleting them.
- When backlog work is completed, update the backlog in the same work session: move finished epics to `backlog/done/` and keep active backlog items current.

## Architecture

### Layered design

```
Commands (add, list, remove, init)
    ↓ orchestrate
Core (parse, fetch, registry)    ← no adapter dependencies
    ↓ used by
Adapters (opencode, claude-code, codex, kiro)    ← independent, self-contained
```

- **Core modules** have zero adapter dependencies. They handle parsing, fetching, and lock file management.
- **Adapters** are independent and self-contained. Each implements the `Adapter` interface from `src/types.ts`.
- **Commands** orchestrate core modules and adapters together.
- **OpenCode is the canonical format.** Other adapters convert FROM the OpenCode/generic frontmatter representation.

### The Adapter interface

Every adapter must implement this interface (defined in `src/types.ts`):

```typescript
interface Adapter {
  name: Platform;                                                      // "opencode" | "claude-code" | "codex" | "kiro"
  detect(projectDir: string): Promise<boolean>;                        // Check if this tool is present
  install(ctx: AdapterContext): Promise<void>;                         // Write agent files for this tool
  uninstall(name: string, projectDir: string, global: boolean): Promise<void>;  // Remove agent files
}
```

Adapters are collected into arrays in `src/commands/add.ts` and `src/commands/remove.ts`. When adding a new adapter, create the file in `src/adapters/` and add it to both arrays.

### Fetch layer

The `fetchAgent()` function in `src/core/fetch.ts` returns a `FetchResult` wrapping the `ParsedAgent` with `sourceType` ("github" | "local") and `resolvedSource`. Local paths are auto-detected (starts with `.`, `/`, contains `\`, or Windows drive letter). GitHub sources try `main` then `master` branches.

### Interactive prompts

The `add` command uses `@clack/prompts` for interactive scope and tool selection. Prompts are skipped when CLI flags are provided (`--global`, `--platform`), keeping the CLI CI-friendly. Import `select`, `multiselect`, `isCancel`, and `cancel` from `@clack/prompts`. Always handle `isCancel` and exit with `process.exit(0)` (cancellation is not an error).

### Agent format

Agents are defined as markdown files with YAML frontmatter:

```yaml
---
name: my-agent          # Required, kebab-case (validated by regex: /^[a-z0-9]+(-[a-z0-9]+)*$/)
description: "..."      # Required, string
mode: subagent          # Optional: "primary" | "subagent"
tools:                  # Optional: Record<string, boolean>
  read: true
  write: true
  bash: false
claude-code:            # Optional: tool-specific overrides
  permissions:
    allow: [...]
    deny: [...]
kiro:                   # Optional: tool-specific overrides
  model: "..."
  tools: [...]
---

Markdown body (the system prompt). Required — cannot be empty.
```

### Lock file

`agents-io-lock.json` tracks installed agents. Located at the project root (local) or `~/.config/agents-io/` (global). Managed by `src/core/registry.ts`. Contains SHA-256 content hashes (first 12 hex chars) for change detection. Lock file entries use `platforms` (array of `Platform` values) and `platformHashes` (per-platform content hashes). Entries written with old keys (`installedFor`, `toolHashes`) are migrated transparently on read.

## Coding standards

### TypeScript

- **Strict mode**, no `any` types.
- **ESM only**, no CommonJS. All imports use `.js` extensions (TypeScript ESM convention):
  ```typescript
  import { parseAgentFile } from "./parse.js";       // correct
  import { parseAgentFile } from "./parse";           // wrong
  import { parseAgentFile } from "./parse.ts";        // wrong
  ```
- Use `type` imports for type-only imports:
  ```typescript
  import type { Adapter, ParsedAgent } from "../types.js";
  ```

### File I/O

- Use `fs/promises` for all async file operations (`readFile`, `writeFile`, `mkdir`, `unlink`, `access`, `readdir`, `rmdir`).
- The only sync filesystem call allowed is `existsSync` in `src/utils/paths.ts` (for project root detection).
- All adapters must handle missing files/directories gracefully — never throw for "not found". Use try/catch or existence checks.

### JSON files

- Pretty-print with 2-space indent: `JSON.stringify(data, null, 2)`
- Always add a trailing newline: `JSON.stringify(data, null, 2) + "\n"`

### CLI output

- Use the project logger (`src/utils/logger.ts`) for all CLI output. Never use `console.log` or `console.error` directly.
  ```typescript
  import { log } from "../utils/logger.js";
  log.info("Fetching agent...");
  log.success("Installed successfully");
  log.warn("No adapter found");
  log.error("Failed to parse agent");
  log.dim("  helper text");
  ```

### Error handling

- Commands wrap their bodies in try/catch, call `log.error()`, then `process.exit(1)`.
- Core modules and adapters throw errors — commands catch them.

### Naming

- Agent names are kebab-case, validated by `/^[a-z0-9]+(-[a-z0-9]+)*$/`.
- File names follow the same pattern as the module they contain (kebab-case for adapters: `claude-code.ts`, `opencode.ts`).

## How to add a new tool adapter

1. Create `src/adapters/{tool-name}.ts`.
2. Implement the `Adapter` interface: `detect`, `install`, `uninstall`.
3. Export the adapter as the default export.
4. Import and add it to the `adapters` array in both `src/commands/add.ts` and `src/commands/remove.ts`.
5. Add the platform name to the `Platform` union type in `src/types.ts`.
6. If the tool has specific frontmatter overrides, add the shape to `AgentFrontmatter` in `src/types.ts`.
7. Add path resolution for the tool in `src/utils/paths.ts` (`getProjectDir` and `getGlobalDir`).

## Testing

The test suite uses `bun:test`. Run tests with:

```bash
bun test
```

Tests live in `tests/` mirroring the `src/` structure:

- `tests/helpers.ts` — shared test utilities (`buildAgentContent`, `makeTempDir`, `cleanTempDir`)
- `tests/core/parse.test.ts` — frontmatter parsing and validation
- `tests/core/registry.test.ts` — lock file CRUD operations
- `tests/adapters/opencode.test.ts` — OpenCode adapter install/uninstall
- `tests/adapters/claude-code.test.ts` — Claude Code adapter install/uninstall
- `tests/adapters/codex.test.ts` — Codex adapter section management
- `tests/adapters/kiro.test.ts` — Kiro adapter install/uninstall

All adapter and registry tests use real temp directories (no mocking). Tests clean up after themselves.

When adding new functionality, add corresponding tests. Priority areas for new tests:
- Integration tests for the `init` command (scaffold output verification)
- Integration tests for the `update` command
- Fetch layer tests (local path resolution — network tests should be skipped)

## Do NOT

- **Add dependencies** without strong justification — this is a lightweight CLI with only 3 production deps.
- **Add prompts outside of commands** — interactive prompts belong in command files only, using `@clack/prompts`.
- **Use `console.log` directly** — use the logger from `src/utils/logger.js`.
- **Use sync file I/O** — except `existsSync` in `paths.ts`.
- **Break the Adapter interface contract** — all adapters must conform to the same interface.
- **Import adapters from core modules** — the dependency direction is commands → core + adapters, never core → adapters.
- **Omit `.js` extensions** on relative imports.
