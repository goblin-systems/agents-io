# Epic 003: `add --dry-run`

Status: Active. Active epics live in `backlog/`. Move completed epics to `backlog/done/`.

## Problem and outcome

`add` writes files and updates the lock file immediately, which makes it harder for users to preview scope, target platforms, and resolved source details before installing.

Outcome: add a `--dry-run` option to `add` so users can preview what would be installed without changing files.

## Target user or stakeholder

- Users installing unfamiliar agents
- Maintainers testing local or GitHub agent sources

## Recommended scope or priority

Priority: medium-high. It improves confidence before a write operation.

In scope:

- Add `agents-io add <source> --dry-run`
- Show resolved source, selected scope, selected platforms, and target agent name
- Support the current single-agent and discovered multi-agent flows
- Skip adapter writes and lock file updates entirely

Out of scope:

- Partial simulation of adapter file diffs
- Interactive confirmation after preview
- Changes to install defaults outside dry-run mode

## Requirements and acceptance criteria

### Requirements

1. Dry run follows the same fetch, discovery, and validation path as a real add.
2. Dry run never writes adapter files, config files, or lock files.
3. Output clearly states that no changes were made.
4. Preview output includes the agent name, resolved source, intended scope, and target platforms.
5. If the source is invalid, dry run fails with the same validation error a real add would surface.

### Acceptance criteria

- `agents-io add <source> --dry-run` produces a preview without changing the workspace.
- Dry run works with local paths and GitHub sources supported by current fetch logic.
- Dry run reflects the same platform and scope choices that a real add would use.
- Failure cases match real add behavior except for the lack of writes.

## Risks, dependencies, and open questions

Dependencies:

- Alignment on whether dry run should still prompt for scope and platform when flags are omitted

Risks:

- A preview that diverges from real install behavior will be misleading
- Multi-agent discovery previews could become noisy if not summarized well

Open questions:

- Should dry run support fully non-interactive defaults, or reuse current prompts?
- For multi-agent sources, should preview show all selected agents in one summary block?

## MVP recommendation and suggested next steps

Recommended MVP: keep current prompting behavior, then show a concise preview summary and exit without writes.

## Recommended next steps

- Confirm whether dry run should be optimized for CI usage in the first release
- Define the minimum preview fields so implementation stays concise
