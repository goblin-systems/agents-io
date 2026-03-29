# Epic 002: `validate` command

Status: Active. Active epics live in `backlog/`. Move completed epics to `backlog/done/`.

## Problem and outcome

Users can install agents, but there is no focused command to validate an agent definition before sharing it or installing it across tools.

Outcome: add a `validate` command that checks agent file structure and reports whether an agent is valid for `agents-io` consumption.

## Target user or stakeholder

- Agent authors creating or editing `agent.md`
- Maintainers reviewing agent repositories or local agent folders

## Recommended scope or priority

Priority: high. It reduces authoring friction and prevents invalid installs earlier.

In scope:

- Add `agents-io validate <source>` for local paths and GitHub-style sources
- Reuse existing parsing and fetch rules where possible
- Return clear pass/fail output with actionable validation errors

Out of scope:

- Auto-fixing invalid agent files
- Deep adapter-specific install simulation
- Linting markdown style beyond required agent schema

## Requirements and acceptance criteria

### Requirements

1. The command validates the same frontmatter and body rules used by install flows.
2. The command accepts the same source patterns already supported by fetch logic.
3. Validation errors identify the failing rule clearly enough for an author to correct the file.
4. Successful validation confirms the resolved source and agent name.
5. The command is read-only and does not write adapter files or lock files.

### Acceptance criteria

- A valid agent source returns a success result without installing anything.
- An invalid agent source returns a failure result with actionable error text.
- Validation behavior is consistent with what `add` would accept or reject.
- Docs mention when to use `validate` versus `add`.

## Risks, dependencies, and open questions

Dependencies:

- Alignment on CLI output format for success and failure cases

Risks:

- If validation rules drift from `add`, users will lose trust in the command

Open questions:

- Should `validate` support multi-agent discovery sources now, or only single-agent targets for MVP?
- Should the command exit non-zero on the first error only, or summarize all detectable errors?

## MVP recommendation and suggested next steps

Recommended MVP: validate one resolved agent target at a time, using existing parser and fetch behavior, with read-only success and error output.

## Recommended next steps

- Confirm the desired UX for multi-agent repositories before implementation
- Decide whether the MVP error format should optimize for humans only or future CI usage too
