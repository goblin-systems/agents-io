# Epic 004: `update --check`

Status: Active. Active epics live in `backlog/`. Move completed epics to `backlog/done/`.

## Problem and outcome

`update` currently combines checking and writing. Users cannot easily see whether updates are available without running the full update flow.

Outcome: add `update --check` so users can inspect which installed agents are current or outdated before making changes.

## Target user or stakeholder

- Users managing multiple installed agents
- Maintainers auditing local or global installs before updating

## Recommended scope or priority

Priority: medium-high. It complements the existing update workflow and improves confidence.

In scope:

- Add `agents-io update --check`
- Support checking one named agent or all installed agents
- Reuse current source-fetch comparison logic where possible
- Report per-agent result without reinstalling anything

Out of scope:

- Auto-update after check
- Background polling or scheduled checks
- New persistent status metadata beyond what update already uses

## Requirements and acceptance criteria

### Requirements

1. `--check` uses the same comparison basis as `update` to determine whether an agent is current.
2. Check mode never writes adapter files or lock files.
3. Output identifies whether each checked agent is up to date, has an update available, or could not be checked.
4. The option works with current scope and platform filters where they apply.
5. The command remains explicit that check mode is inspection-only.

### Acceptance criteria

- `agents-io update --check` reports status without modifying installed agents.
- `agents-io update <name> --check` checks only the named installed agent.
- If a source cannot be fetched, the command reports that clearly and continues when safe.
- Results align with what a subsequent real `update` would do.

## Risks, dependencies, and open questions

Dependencies:

- Alignment on result labels for current, update available, and failed check states

Risks:

- If check logic differs from update logic, results will be misleading
- Network-backed checks may be slower than users expect for a read-only command

Open questions:

- Should `--check` produce a different exit code when updates are available?
- Should platform filtering report per-platform state or only agent-level state for MVP?

## MVP recommendation and suggested next steps

Recommended MVP: reuse current fetch-and-compare behavior, but stop before any reinstall or lock file write.

## Recommended next steps

- Decide the CLI wording and exit-code behavior before implementation
- Keep per-platform detail out of MVP unless it is required for correctness
