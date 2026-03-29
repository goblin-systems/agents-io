# Epic 006: `remove --dry-run`

Status: Active. Active epics live in `backlog/`. Move completed epics to `backlog/done/`.

## Problem and outcome

`remove` changes adapter files and lock entries immediately. Users cannot easily preview which scope, platforms, or registry entries would be affected before a destructive action.

Outcome: add `--dry-run` to `remove` so users can inspect the removal plan without changing files.

## Target user or stakeholder

- Users removing agents from unfamiliar projects or shared environments
- Maintainers checking scope and platform impact before cleanup

## Recommended scope or priority

Priority: medium. It improves confidence for a destructive command with a narrow, well-bounded MVP.

In scope:

- Add `agents-io remove <name> --dry-run`
- Show the resolved scope and platform targets that would be removed
- Show whether the lock entry would be updated or deleted for each affected scope
- Support the current local, global, and `--all` remove paths

Out of scope:

- File-by-file diff previews
- Interactive confirmation after dry run
- Auto-fix or repair behavior if the install is already inconsistent

## Requirements and acceptance criteria

### Requirements

1. Dry run follows the same scope resolution and platform selection rules as a real remove.
2. Dry run never deletes adapter files, config entries, or lock file data.
3. Output clearly states that no changes were made.
4. Preview output identifies the affected scope, target platforms, and whether the registry entry would be updated or removed.
5. If the real remove flow would stop on ambiguity or invalid input, dry run stops with the same error.

### Acceptance criteria

- `agents-io remove <name> --dry-run` produces a preview without changing the workspace.
- `agents-io remove <name> --local --dry-run`, `--global --dry-run`, and `--all --dry-run` reflect the same targets a real remove would use.
- Platform-specific dry runs show whether only one platform would be removed or the full agent entry would be deleted in that scope.
- Failure cases match real remove behavior except for the lack of writes.

## Risks, dependencies, and open questions

Dependencies:

- Alignment on the minimum preview fields needed to make removal intent obvious

Risks:

- A preview that does not match real remove behavior will reduce trust in the safeguard
- Multi-scope output could become noisy if the plan is not summarized clearly

Open questions:

- Should dry run support the no-name interactive multi-select flow in the first release, or only named removes?
- Should preview output explicitly show when the command would stop because the agent exists in both local and global scope?

## MVP recommendation and suggested next steps

Recommended MVP: support named remove flows first, reuse current scope and platform logic, and show a concise removal summary with no writes.

## Recommended next steps

- Define the exact preview wording for partial-platform removal versus full entry deletion
- Decide whether the first release should include interactive no-name remove flows or defer them
