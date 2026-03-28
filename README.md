# agents-io

Install AI coding agents from GitHub — or your local filesystem — into your project. One command, any tool.

```bash
npx agents-io add owner/repo
```

agents-io fetches an agent definition from a GitHub repo and installs it in the correct format for whichever AI coding tools you use — OpenCode, Claude Code, Codex, or Kiro.

## Install

```bash
# No install needed — run directly:
npx agents-io add owner/repo

# Or install globally:
npm i -g agents-io
```

## Quick start

```bash
# Install an agent from GitHub
npx agents-io add acme/code-reviewer

# Install for a specific platform only
npx agents-io add acme/code-reviewer --platform claude-code

# Install globally (user-level, not project-level)
npx agents-io add acme/code-reviewer --global

# List installed agents
npx agents-io list

# Remove an agent
npx agents-io remove code-reviewer

# Scaffold a new agent
npx agents-io init my-agent

# Install from a local path
npx agents-io add ./my-agents/code-reviewer

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
npx agents-io add owner/repo --path agents/reviewer
npx agents-io add ./path/to/agent
npx agents-io add /absolute/path/to/agent
npx agents-io add C:\Users\you\agents\reviewer
```

| Flag | Description |
|------|-------------|
| `--platform <platform>` | Target a specific platform: `opencode`, `claude-code`, `codex`, or `kiro` |
| `--global` | Install to the tool's global config directory instead of the project |
| `--path <path>` | Subfolder within the repo that contains `agent.md` |

Flags skip the corresponding prompts. Without flags, agents-io asks interactively:

1. **Scope** — Project (local) or Global (user-level). Default: local.
2. **Platforms** — Which platforms to install for. Default: OpenCode only. Detected platforms are marked.

When `--platform` is omitted, agents-io auto-detects which tools you use by checking for their config files (`opencode.json`, `.claude/`, `.codex/`, `.kiro/`). If none are found, it defaults to OpenCode.

### `list`

Lists all installed agents, both project-level and global.

```bash
npx agents-io list
```

### `remove <name>`

Removes an installed agent by name.

```bash
npx agents-io remove code-reviewer
npx agents-io remove code-reviewer --platform claude-code
npx agents-io remove code-reviewer --local
npx agents-io remove code-reviewer --global
npx agents-io remove code-reviewer --all
npx agents-io remove code-reviewer --all --platform opencode
```

| Flag | Description |
|------|-------------|
| `--platform <platform>` | Remove only the selected platform install: `opencode`, `claude-code`, `codex`, or `kiro` |
| `--local` | Remove only the project-scoped install |
| `--global` | Remove only the global-scoped install |
| `--all` | Remove both project and global installs |

Default behavior is scope-aware and safe:

- If the agent exists only in the project lock file, agents-io removes the project install.
- If the agent exists only in the global lock file, agents-io removes the global install.
- If the agent exists in both scopes, agents-io stops and tells you to choose `--local`, `--global`, or `--all`.

When `--platform <platform>` is set, agents-io removes only that adapter's files. If other platforms still reference the same agent in that scope, the lock entry stays and `installedFor` is updated. If that was the last installed platform in the scope, the lock entry is removed.

CLI output always states which scope is being removed.

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

Re-fetches installed agents from their original source and reinstalls if the content has changed. Without a name, updates all installed agents.

```bash
npx agents-io update
npx agents-io update code-reviewer
npx agents-io update --global
npx agents-io update code-reviewer --platform opencode
```

| Flag | Description |
|------|-------------|
| `--platform <platform>` | Only update for a specific platform |
| `--global` | Update global agents instead of project agents |

agents-io tracks content hashes in the lock file. If the hash matches, the agent is skipped. If it differs, the agent is re-installed.

When you run `update --platform <platform>`, agents-io updates only that adapter's files but keeps the full `installedFor` metadata intact.

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
