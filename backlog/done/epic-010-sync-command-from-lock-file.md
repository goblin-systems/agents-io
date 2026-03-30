# Epic 010: `sync` command from committed lock file

Status: Done. Completed epics live in `backlog/done/`.

## Problem and outcome

The project lock file is positioned as the shared record of installed agents, but there is no command that uses it to bring a contributor's local project install into line. New teammates still need to add agents manually even when the repo already commits `agents-io-lock.json`.

Outcome: add a `sync` command that installs or reconciles project-scoped agents from the committed lock file.

## Target user or stakeholder

- Teams onboarding contributors into a repository that already uses `agents-io`
- Maintainers who want one command to align project installs with committed lock state

## Recommended scope or priority

Priority: medium-high. It makes the committed lock file operational for teams, but the MVP should stay narrow and predictable.

In scope:

- Add `agents-io sync` for project scope
- Read the project `agents-io-lock.json` and reconcile tracked agents for the recorded platforms
- Install missing project-scoped agents and repair tracked project installs that are out of date with lock metadata
- Report unsupported or unresolvable lock entries clearly

Out of scope:

- Global install sync
- Automatic removal of extra local installs that are not in the lock file
- Broad workspace bootstrap beyond agent installation

## Requirements and acceptance criteria

### Requirements

1. The command reads the project lock file and uses it as the source of truth for the MVP sync flow.
2. Sync operates on project scope only in the first release.
3. The command can install missing tracked agents for the platforms recorded in the lock file.
4. If a tracked entry cannot be resolved or synced, the command reports that clearly and continues when safe.
5. Sync does not remove untracked extra installs in MVP.

### Acceptance criteria

- `agents-io sync` can install project-scoped agents listed in the committed lock file on a fresh clone.
- If a tracked agent is already aligned with lock metadata, sync leaves it unchanged.
- If a tracked agent cannot be fetched or resolved, the command reports the failure without pretending the workspace is fully synced.
- The command does not touch global installs in MVP.
- Docs explain what `sync` guarantees and what it intentionally does not do in the first release.

## Risks, dependencies, and open questions

Dependencies:

- Agreement that the current lock file contains enough source metadata to drive sync, or a decision to extend it
- Likely sequencing benefit from Epic 007 if the team wants reproducible pinned GitHub sync behavior

Risks:

- Without pinned refs, sync may recreate a newer upstream state than the original teammate installed
- Local-path lock entries may not be portable across machines
- Users may expect `sync` to prune extra installs unless the command scope is stated clearly

Open questions:

- Should MVP skip non-portable local sources, warn on them, or fail the sync?
- Should sync support a named-agent mode in the first release, or only full project reconciliation?
- Should a later `sync --prune` be considered separately rather than folded into MVP?

## MVP recommendation and suggested next steps

Recommended MVP: ship project-only sync that installs or repairs tracked agents from the committed lock file, skips destructive pruning, and reports unsupported entries clearly.

## Recommended next steps

- Confirm whether lock-file schema changes are needed before implementation
- Decide how local-path entries should be handled in team workflows
- Sequence this epic after or alongside pinned GitHub refs if reproducible sync is a product requirement
