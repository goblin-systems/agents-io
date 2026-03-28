# AGENTS.md — agnts

## Project overview

`agnts` is a CLI tool that installs AI coding agents from GitHub repositories into local tool configurations. It fetches an `agent.md` file from a repo, parses its YAML frontmatter + markdown body, and writes the appropriate files for each supported tool (OpenCode, Claude Code, Codex, Kiro).

- **Runtime:** Bun + TypeScript (strict), ESM modules
- **Build:** `bun build` produces a single-file Node-compatible bundle at `dist/index.js`
- **Production dependencies (3 only):** commander, chalk, gray-matter

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
```

Always run `bun run typecheck` after making changes. There is no test suite yet.

## Directory structure

```
src/
  index.ts              CLI entry point — commander program with 4 commands
  types.ts              Shared TypeScript interfaces (Adapter, ParsedAgent, LockFile, etc.)
  commands/
    add.ts              `agnts add <source>` — fetch + install + register in lock file
    list.ts             `agnts list` — display installed agents (project + global)
    remove.ts           `agnts remove <name>` — uninstall from adapters + deregister
    init.ts             `agnts init [name]` — scaffold a new agent template directory
  core/
    parse.ts            gray-matter frontmatter parser with validation (name, description, mode, tools)
    fetch.ts            Downloads agent.md from GitHub raw URLs (tries main then master branch)
    registry.ts         Reads/writes agnts-lock.json (SHA-256 hashing, CRUD operations)
  adapters/
    opencode.ts         Writes agents/{name}.md + updates opencode.json
    claude-code.ts      Writes .claude/agents/{name}.md + updates settings.json
    codex.ts            Appends delimited sections to AGENTS.md using HTML comment tags
    kiro.ts             Writes .kiro/agents/{name}.json
  utils/
    logger.ts           chalk-based structured logger with info, success, warn, error, dim methods
    paths.ts            Tool config path resolution + findProjectRoot (walks up looking for markers)
```

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
  name: ToolTarget;                                                    // "opencode" | "claude-code" | "codex" | "kiro"
  detect(projectDir: string): Promise<boolean>;                        // Check if this tool is present
  install(ctx: AdapterContext): Promise<void>;                         // Write agent files for this tool
  uninstall(name: string, projectDir: string, global: boolean): Promise<void>;  // Remove agent files
}
```

Adapters are collected into arrays in `src/commands/add.ts` and `src/commands/remove.ts`. When adding a new adapter, create the file in `src/adapters/` and add it to both arrays.

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

`agnts-lock.json` tracks installed agents. Located at the project root (local) or `~/.config/agnts/` (global). Managed by `src/core/registry.ts`. Contains SHA-256 content hashes (first 12 hex chars) for change detection.

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
5. Add the tool name to the `ToolTarget` union type in `src/types.ts`.
6. If the tool has specific frontmatter overrides, add the shape to `AgentFrontmatter` in `src/types.ts`.
7. Add path resolution for the tool in `src/utils/paths.ts` (`getProjectDir` and `getGlobalDir`).

## Testing guidance

No test framework is configured yet. When adding tests:

- Use `bun:test` (built into Bun).
- Unit test priorities:
  1. `src/core/parse.ts` — frontmatter validation (valid/invalid names, missing fields, mode values, tools shape).
  2. Adapter `install` / `uninstall` — verify correct files are written/removed.
  3. `src/core/registry.ts` — CRUD operations on the lock file.
- Integration test: `init` command creates correct directory structure and file contents.

## Do NOT

- **Add dependencies** without strong justification — this is a lightweight CLI with only 3 production deps.
- **Add interactive prompts** — the CLI is non-interactive by design.
- **Use `console.log` directly** — use the logger from `src/utils/logger.js`.
- **Use sync file I/O** — except `existsSync` in `paths.ts`.
- **Break the Adapter interface contract** — all adapters must conform to the same interface.
- **Import adapters from core modules** — the dependency direction is commands → core + adapters, never core → adapters.
- **Omit `.js` extensions** on relative imports.
