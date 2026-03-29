# Epic 008: `doctor` command for install health

Status: Active. Active epics live in `backlog/`. Move completed epics to `backlog/done/`.

## Problem and outcome

Users can install, remove, and update agents, but there is no focused command to diagnose whether lock file state and platform installs still agree after manual edits, partial failures, or environment changes.

Outcome: add a read-only `doctor` command that checks installation health and reports actionable issues.

## Target user or stakeholder

- Users troubleshooting broken or inconsistent agent installs
- Maintainers supporting workspace setup across multiple tools

## Recommended scope or priority

Priority: medium. It improves supportability and trust, but it is less foundational than install, validate, or update behavior.

In scope:

- Add `agents-io doctor`
- Check project install health by default and support global scope explicitly
- Validate that lock file data can be read and that each recorded platform install can be checked
- Report a clear healthy versus issue-found result with actionable messages

Out of scope:

- Auto-fixing broken installs
- Network fetches against remote sources
- Deep semantic validation of agent content beyond installed state checks

## Requirements and acceptance criteria

### Requirements

1. The command is read-only and does not modify adapter files or lock files.
2. The command checks the current lock file and installed platform state for the selected scope.
3. Reported issues clearly identify the affected agent, scope, and platform where applicable.
4. The command distinguishes healthy installs from warning or error states.
5. The MVP stays focused on installation health, not source freshness or remote update availability.

### Acceptance criteria

- `agents-io doctor` reports project install health without making changes.
- A user can run the command against global scope explicitly.
- If the lock file is missing, unreadable, or inconsistent with installed platform state, the command reports that clearly.
- If no issues are found, the command reports a healthy result for the checked scope.
- Docs explain when to use `doctor` versus `validate`, `list --verbose`, or `update --check`.

## Risks, dependencies, and open questions

Dependencies:

- Agreement on the minimum health checks that provide value without becoming an auto-fix system
- Agreement on result labels and exit-code expectations

Risks:

- If checks are too shallow, the command will not help users diagnose real problems
- If checks are too broad, the feature could expand into a maintenance framework instead of a CLI diagnostic
- Overlapping too much with `validate` or `list --verbose` could blur product boundaries

Open questions:

- Should `doctor` exit non-zero when issues are found, or reserve non-zero for command failure only?
- Which install mismatches are must-detect for MVP versus later enhancements?
- Should the first release report only project scope by default, with global as an explicit flag?

## MVP recommendation and suggested next steps

Recommended MVP: ship a read-only diagnostic focused on lock-file readability, scope state, and platform install consistency, with no repair actions.

## Recommended next steps

- Finalize the MVP issue categories and example output before implementation
- Decide the exit-code policy so the command can be used consistently by humans and scripts
- Keep remote fetch and self-healing behavior out of the first release
