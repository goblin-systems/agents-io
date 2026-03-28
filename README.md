# agnts

Install AI coding agents from GitHub into your project. One command, any tool.

```bash
npx agnts add owner/repo
```

agnts fetches an agent definition from a GitHub repo and installs it in the correct format for whichever AI coding tools you use — OpenCode, Claude Code, Codex, or Kiro.

## Install

```bash
# No install needed — run directly:
npx agnts add owner/repo

# Or install globally:
npm i -g agnts
```

## Quick start

```bash
# Install an agent from GitHub
npx agnts add acme/code-reviewer

# Install for a specific tool only
npx agnts add acme/code-reviewer --tool claude-code

# Install globally (user-level, not project-level)
npx agnts add acme/code-reviewer --global

# List installed agents
npx agnts list

# Remove an agent
npx agnts remove code-reviewer

# Scaffold a new agent
npx agnts init my-agent
```

## Commands

### `add <source>`

Fetches `agent.md` from a GitHub repo and installs it for your detected tools.

```bash
npx agnts add owner/repo
npx agnts add owner/repo --tool opencode
npx agnts add owner/repo --tool claude-code
npx agnts add owner/repo --global
npx agnts add owner/repo --path agents/reviewer
```

| Flag | Description |
|------|-------------|
| `--tool <tool>` | Target a specific tool: `opencode`, `claude-code`, `codex`, or `kiro` |
| `--global` | Install to the tool's global config directory instead of the project |
| `--path <path>` | Subfolder within the repo that contains `agent.md` |

When `--tool` is omitted, agnts auto-detects which tools you use by checking for their config files (`opencode.json`, `.claude/`, `.codex/`, `.kiro/`). If none are found, it defaults to OpenCode.

### `list`

Lists all installed agents, both project-level and global.

```bash
npx agnts list
```

### `remove <name>`

Removes an installed agent by name.

```bash
npx agnts remove code-reviewer
```

### `init [name]`

Scaffolds a new agent template.

```bash
npx agnts init my-agent
```

Creates `my-agent/agent.md` and `my-agent/README.md`. Edit the files, push to GitHub, and anyone can install it:

```bash
npx agnts add yourname/my-agent
```

## How it works

1. You run `npx agnts add owner/repo`
2. agnts fetches `agent.md` from the repo via `raw.githubusercontent.com`
3. It detects which AI coding tools are present in your project
4. It converts the agent definition into each tool's native format and writes the files
5. It tracks the installation in `agnts-lock.json`

## Agent format

Agents are defined in a single `agent.md` file — markdown with YAML frontmatter. This is OpenCode's native format and serves as the canonical representation.

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

Each tool has its own format and file structure. agnts handles the conversion automatically.

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
npx agnts init my-agent
```

This gives you a ready-to-publish template. The workflow:

1. `npx agnts init my-agent` — scaffold the files
2. Edit `my-agent/agent.md` — write your agent's instructions and configure its frontmatter
3. Push to GitHub
4. Share: `npx agnts add yourname/my-agent`

The only file that matters is `agent.md` at the repo root (or in a subfolder, installable via `--path`).

## Lock file

agnts tracks installations in `agnts-lock.json` at the project root. This file records which agents are installed, their source repos, and which tools they were installed for. Commit it to version control so your team stays in sync.

## License

MIT
