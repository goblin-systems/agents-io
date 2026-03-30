# agents-io

Install AI coding agents from GitHub — or your local filesystem — into your project. One command, any tool.

```bash
npx agents-io@latest add owner/repo
```

agents-io fetches an agent definition from a GitHub repo and installs it in the correct format for whichever AI coding tools you use — OpenCode, Claude Code, Codex, or Kiro.

## Install

```bash
# No install needed — run the latest published CLI directly:
npx agents-io@latest add owner/repo

# Or install globally:
npm i -g agents-io
```

Use `npx agents-io@latest ...` when you want `npx` to fetch and run the latest published `agents-io` version instead of a cached or previously resolved CLI version.

## Automation

- GitHub Actions CI runs on pushes to `master` and pull requests targeting `master`, and executes `bun run typecheck`, `bun test`, and `bun run build`.
- GitHub Actions Release is a manual workflow with `major`, `minor`, or `patch` bump inputs. It creates the next tag, rebuilds from that tag, publishes `agents-io` to npm with provenance, and creates a GitHub release.
- Before running the release workflow, configure npm publishing for this repository in npm. Provenance publishing is intended to work with GitHub Actions trusted publishing.

## Quick start

```bash
# Install an agent from GitHub
npx agents-io@latest add acme/code-reviewer

# Install for a specific platform only
npx agents-io@latest add acme/code-reviewer --platform claude-code

# Install globally (user-level, not project-level)
npx agents-io@latest add acme/code-reviewer --global

# List installed agents
npx agents-io list

# Inspect lock files and registry status
npx agents-io list --verbose

# Validate an agent without installing it
npx agents-io validate owner/repo

# Diagnose the current install state
npx agents-io doctor
npx agents-io doctor --global

# Sync project installs from the committed lock file
npx agents-io sync

# Remove an agent
npx agents-io remove code-reviewer

# Scaffold a new agent
npx agents-io init my-agent

# Install from a local path
npx agents-io add ./my-agents/code-reviewer

# Preview an install without writing files
npx agents-io add acme/code-reviewer --dry-run

# Update all installed agents
npx agents-io update

# Update a specific agent
npx agents-io update code-reviewer
```

## Commands

### `add <source>`

Fetches `agent.md` from a GitHub repo or local directory and installs it for your detected tools.

When run without `--platform` or `--global` flags, agents-io prompts you to choose the install scope and target platforms interactively. Pass flags to skip prompts (useful for CI).

```bash
npx agents-io add owner/repo
npx agents-io add owner/repo --platform opencode
npx agents-io add owner/repo --platform claude-code
npx agents-io add owner/repo --global
npx agents-io add owner/repo --dry-run
npx agents-io add owner/repo --path agents/reviewer
npx agents-io add owner/repo --branch release
npx agents-io add owner/repo --tag v1.2.0
npx agents-io add owner/repo --commit 0123abcd
npx agents-io add ./path/to/agent
npx agents-io add /absolute/path/to/agent
npx agents-io add C:\Users\you\agents\reviewer
```

| Flag | Description |
|------|-------------|
| `--platform <platform>` | Target a specific platform: `opencode`, `claude-code`, `codex`, or `kiro` |
| `--global` | Install to the tool's global config directory instead of the project |
| `--dry-run` | Preview the add plan without writing adapter files, config files, or lock files |
| `--path <path>` | Subfolder within the repo that contains `agent.md` |
| `--branch <name>` | Pin a GitHub install to a branch and store the resolved commit in the lock file |
| `--tag <name>` | Pin a GitHub install to a tag and store the resolved commit in the lock file |
| `--commit <sha>` | Pin a GitHub install to an exact commit |

Flags skip the corresponding prompts. Without flags, agents-io asks interactively:

1. **Scope** — Project (local) or Global (user-level). Default: local.
2. **Platforms** — Which platforms to install for. Default: OpenCode only. Detected platforms are marked.

When `--platform` is omitted, agents-io auto-detects which tools you use by checking for their config files (`opencode.json`, `.claude/`, `.codex/`, `.kiro/`). If none are found, it defaults to OpenCode.

GitHub refs are optional. If you omit them, agents-io tracks the repository's default branch and `update` follows that branch over time. If you pass exactly one of `--branch`, `--tag`, or `--commit`, agents-io records that pin in `agents-io-lock.json` and future `update` runs stay on that ref instead of drifting back to the default branch.

`add --dry-run` follows the same fetch, discovery, prompt, and validation flow as a real install, but it stops before any files are written. The preview reports the resolved source, chosen scope, and target platforms so you can verify the plan first.

For GitHub sources only, if the repo looks strongly agent-like but does not ship a compatible `agent.md`, `add` can offer an explicit best-effort conversion from a known non-native file such as `AGENTS.md` or `CLAUDE.md`. The CLI never converts silently: it prompts first, warns that conversion may fail or behave unexpectedly, and continues only if the generated candidate passes normal validation.

When `add` already knows the exact target platforms, it also runs lightweight compatibility checks before writing anything. In the current MVP this means:

- Kiro blocks installs that would otherwise widen permissions because none of the enabled generic tools map cleanly and no explicit `kiro.tools` override is present
- Kiro warns when some enabled generic tools are ignored during mapping
- Codex warns when frontmatter or `agent.json` settings will be dropped during conversion into `AGENTS.md`
- non-OpenCode targets warn when `mode: primary` cannot be preserved

### `list`

Lists all installed agents, both project-level and global.

```bash
npx agents-io list
npx agents-io list --verbose
```

Use `--verbose` when you want to inspect the lock file state without opening `agents-io-lock.json` manually. Both default and verbose list output show whether a GitHub agent is pinned or unpinned. Verbose output also adds:

- the resolved lock file path for project and global scope
- the scope state (`present` or `missing`)
- one lock-file-only status per agent

Current verbose status labels are:

- `synced` - every installed platform points at the same stored hash and matches the entry hash
- `mixed` - installed platform hashes do not fully agree with each other or with the entry hash

Verbose mode still shows each scope and lock file path even when that scope has no agents.

| Flag | Description |
|------|-------------|
| `--verbose` | Show lock file paths, scope state, and per-agent registry status |

### `validate <source>`

Validates an agent source using the same fetch and parse rules as `add`, but does not install anything or write a lock file.

Use `validate` when you want to check that an agent can be consumed by `agents-io` before sharing or installing it. Use `add` when you want install-time platform compatibility warnings or failures for explicitly selected targets.

```bash
npx agents-io validate owner/repo
npx agents-io validate owner/repo --path agents/reviewer
npx agents-io validate ./path/to/agent
npx agents-io validate C:\Users\you\agents\reviewer
```

| Flag | Description |
|------|-------------|
| `--path <path>` | Subfolder within the repo or local source that contains `agent.md` |

### `doctor`

Checks recorded install health for one scope without writing any files or fetching anything from the network. By default it checks the project scope. Pass `--global` to inspect the global scope instead.

```bash
npx agents-io doctor
npx agents-io doctor --global
```

`doctor` reads the selected scope's lock file and verifies that each recorded platform install still has the expected local artifacts and config entries.

Current checks focus on install health only:

- lock file present, readable, and parseable
- per-agent registry hash status (`synced` vs `mixed`)
- per-platform artifact/config presence for the recorded install

When issues are found, `doctor` reports the affected agent, scope, and platform with a suggested next action such as reinstalling with `update` or removing a stale lock entry.

| Flag | Description |
|------|-------------|
| `--global` | Check the global install scope instead of the project scope |

### `sync`

Reads the committed project `agents-io-lock.json` and installs or repairs the tracked project-scoped agents for their recorded platforms.

```bash
npx agents-io sync
```

`sync` is intentionally narrow in the first release:

- it uses the project lock file as the source of truth
- it only touches project-scoped installs
- it installs missing tracked agents and repairs tracked installs that are missing local artifacts or registry entries
- it does not prune extra local installs that are not in the lock file
- it does not rewrite the project lock file while syncing

If a tracked entry cannot be resolved back to the locked content, or if the lock entry records an unsupported platform, `sync` reports that clearly, continues with other safe work, and exits non-zero so CI or onboarding scripts do not treat the project as fully aligned.

### `remove <name>`

Removes an installed agent by name.

```bash
npx agents-io remove code-reviewer
npx agents-io remove code-reviewer --platform claude-code
npx agents-io remove code-reviewer --local
npx agents-io remove code-reviewer --global
npx agents-io remove code-reviewer --all
npx agents-io remove code-reviewer --all --platform opencode
npx agents-io remove code-reviewer --dry-run
```

| Flag | Description |
|------|-------------|
| `--platform <platform>` | Remove only the selected platform install: `opencode`, `claude-code`, `codex`, or `kiro` |
| `--local` | Remove only the project-scoped install |
| `--global` | Remove only the global-scoped install |
| `--all` | Remove both project and global installs |
| `--dry-run` | Preview the removal plan without deleting adapter files, config entries, or lock-file data |

Default behavior is scope-aware and safe:

- If the agent exists only in the project lock file, agents-io removes the project install.
- If the agent exists only in the global lock file, agents-io removes the global install.
- If the agent exists in both scopes, agents-io stops and tells you to choose `--local`, `--global`, or `--all`.

When `--platform <platform>` is set, agents-io removes only that adapter's files. If other platforms still reference the same agent in that scope, the lock entry stays and `platforms` is updated. If that was the last installed platform in the scope, the lock entry is removed.

CLI output always states which scope is being removed.

`remove --dry-run` follows the same scope resolution, ambiguity checks, prompts, and platform filtering as a real removal, but it stops before any writes. The preview reports the affected scope, target platforms, and whether the lock entry would be updated or removed.

### `init [name]`

Scaffolds a new agent template.

```bash
npx agents-io init my-agent
```

Creates `my-agent/agent.md` and `my-agent/README.md`. `agent.md` is the required contract. Add an optional `agent.json` only if you need extra settings like color, model, or tool-specific overrides. Edit the files, push to GitHub, and anyone can install it:

```bash
npx agents-io add yourname/my-agent
```

### `update [name]`

Re-fetches installed agents from their original source and reinstalls if the content has changed. Without a name, updates all installed agents. Use `--check` to inspect update status without writing adapter files or lock files.

```bash
npx agents-io update
npx agents-io update --check
npx agents-io update code-reviewer
npx agents-io update code-reviewer --check
npx agents-io update --global
npx agents-io update code-reviewer --platform opencode
```

| Flag | Description |
|------|-------------|
| `--check` | Report whether each checked agent is up to date, has an update available, or could not be checked |
| `--platform <platform>` | Only update for a specific platform |
| `--global` | Update global agents instead of project agents |

agents-io tracks content hashes in the lock file. If the hash matches, the agent is skipped. If it differs, the agent is re-installed.

For GitHub installs, `update` uses the stored source plus any recorded pin metadata. Unpinned installs follow the latest default-branch state. Pinned branch and tag installs re-resolve that ref on each update and refresh the stored `resolvedCommit`. Pinned commit installs stay fixed to that commit until you reinstall with a different ref.

When you run `update --platform <platform>`, agents-io updates only that adapter's files but keeps the full `installedFor` metadata intact.

`update --check` uses the same comparison logic as a real update, but it stays inspection-only.

## Which command to use

- Use `validate` to check whether a source agent definition can be fetched and parsed before installation.
- Use `doctor` to diagnose local install health for one scope after installation.
- Use `sync` to recreate the project-scoped installs recorded in a committed `agents-io-lock.json` without changing that lock file.
- Use `list --verbose` to inspect lock file paths and stored registry hash state for both scopes.
- Use `update --check` to compare installed agents with their original source and see whether newer content is available.

In short: `validate` checks source inputs, `doctor` checks local install state, `sync` recreates project installs from the lock file, `list --verbose` shows recorded metadata, and `update --check` checks source freshness.

## How it works

1. You run `npx agents-io add owner/repo`
2. agents-io fetches `agent.md` from the repo (via `raw.githubusercontent.com`) or reads it from a local path
3. It detects which AI coding tools are present in your project
4. It converts the agent definition into each tool's native format and writes the files
5. It tracks the installation in `agents-io-lock.json`

### Local sources

When the source starts with `.`, `/`, contains `\`, or matches a Windows drive letter (e.g. `C:`), agents-io treats it as a local filesystem path instead of a GitHub repo. The local file is read directly — no network requests are made.

## Agent format

Agents are defined by a required `agent.md` file — markdown with YAML frontmatter. This is OpenCode's native format and serves as the canonical representation.

```yaml
---
name: code-reviewer
description: "Reviews code for bugs, logic errors, and security issues"
mode: subagent
tools:
  read: true
  glob: true
  grep: true
  bash: false
  write: false
  edit: false
---

# Code Reviewer

You are an expert code reviewer. Analyze the provided code for:
- Logic errors and bugs
- Security vulnerabilities
- Performance issues
...
```

### Optional `agent.json`

If you need install-time settings that do not belong in the shared prompt contract, add an `agent.json` file next to `agent.md`. agents-io reads it when fetching from GitHub or a local path.

```json
{
  "color": "#0f766e",
  "model": "claude-sonnet-4",
  "opencode": {
    "temperature": 0.2
  },
  "kiro": {
    "tools": ["read", "shell"]
  }
}
```

### Required fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Kebab-case identifier (e.g. `code-reviewer`) |
| `description` | string | One-line summary of what the agent does |

### Optional fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `"primary"` \| `"subagent"` | `"subagent"` | Whether this agent runs as the main agent or a delegated subagent |
| `tools` | `Record<string, boolean>` | — | Which tools the agent is allowed to use |

### Tool-specific overrides

You can include per-tool configuration blocks in the frontmatter to control behavior that doesn't map cleanly across tools:

```yaml
---
name: code-reviewer
description: "Reviews code for bugs and security issues"
tools:
  read: true
  grep: true
  write: false

claude-code:
  permissions:
    allow: ["Read", "Glob", "Grep"]
    deny: ["Write", "Edit"]

kiro:
  model: "claude-sonnet-4"
  tools: ["read", "shell"]
---
```

## Where agents get installed

Each tool has its own format and file structure. agents-io handles the conversion automatically.

| Tool | Writes to | Registers in |
|------|-----------|--------------|
| OpenCode | `agents/{name}.md` (markdown with frontmatter) | `opencode.json` |
| Claude Code | `.claude/agents/{name}.md` (plain markdown, no frontmatter) | `.claude/settings.json` |
| Codex | `AGENTS.md` (appends a delimited section) | — |
| Kiro | `.kiro/agents/{name}.json` | — |

## Project vs global install

By default, agents install into your project directory. The project root is found by walking up from the current directory looking for `.git`, `package.json`, or `opencode.json`.

With `--global`, agents install into each tool's global config directory:

| Tool | Global directory |
|------|-----------------|
| OpenCode | `~/.config/opencode` |
| Claude Code | `~/.claude` |
| Codex | `~/.codex` |
| Kiro | `~/.kiro` |

## Creating your own agent

```bash
npx agents-io init my-agent
```

This gives you a ready-to-publish template. The workflow:

1. `npx agents-io init my-agent` — scaffold the files
2. Edit `my-agent/agent.md` — write your agent's instructions and configure its frontmatter
3. Push to GitHub
4. Share: `npx agents-io add yourname/my-agent`

The only file that matters is `agent.md` at the repo root (or in a subfolder, installable via `--path`).

## Lock file

agents-io tracks installations in `agents-io-lock.json` at the project root. This file records which agents are installed, their source repos, and which tools they were installed for. Commit it to version control so your team stays in sync.

## License

MIT
