# Epic 001: `list --verbose`

Status: Active. Active epics live in `backlog/`. Move completed epics to `backlog/done/`.

## Problem and outcome

`agents-io list` shows installed agents, but it does not help users inspect lock file location or understand per-agent state without opening files manually.

Outcome: add `--verbose` to `list` so users can inspect project and global installs without changing default output.

## Target user or stakeholder

- CLI users managing local and global agent installs
- Maintainers troubleshooting registry state

## Recommended scope or priority

Priority: small, high-confidence usability improvement.

In scope:

- Add `agents-io list --verbose`
- Show the resolved lock file path for each displayed scope
- Show one status label for each listed agent
- Keep default `list` output unchanged

Out of scope:

- New commands such as `status` or `inspect`
- Network fetches during `list`
- Broader CLI output redesign

## Requirements and acceptance criteria

### Requirements

1. `--verbose` extends the existing `list` command.
2. Verbose output includes project and global lock file paths for the scopes shown.
3. Every listed agent has exactly one status label in verbose mode.
4. Status is derived from lock file data only for MVP.
5. If a shown scope has no agents, verbose mode still shows the resolved lock file path and scope state.

### Acceptance criteria

- `agents-io list` keeps today's concise behavior.
- `agents-io list --verbose` shows project and global sections with lock file locations.
- Verbose output shows a status for every listed agent.
- Status labels follow one documented rule set tied to current lock file data.
- Docs for `list` are updated as part of implementation.

## Risks, dependencies, and open questions

Dependencies:

- Confirm the MVP status vocabulary
- Confirm whether missing lock files should be shown explicitly

Risks:

- Ambiguous status wording could lead to inconsistent implementation
- Extra detail could make output noisy if formatting is not deliberate

Open questions:

- Use `mixed` or `out-of-sync` for partial platform alignment?
- Should a missing lock file path be shown with a `missing` scope state?

## MVP recommendation and suggested next steps

Recommended MVP: keep `list --verbose` inspection-only and no-network, using existing lock file metadata.

## Recommended next steps

- Finalize the status labels and examples before implementation starts
- Keep source freshness checks out of this epic and consider them separately under `update`
