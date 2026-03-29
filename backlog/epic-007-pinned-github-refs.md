# Epic 007: Pinned GitHub refs for install and update

Status: Active. Active epics live in `backlog/`. Move completed epics to `backlog/done/`.

## Problem and outcome

GitHub installs currently follow the repository state that fetch resolves at install or update time. Users cannot intentionally stay on a tag, branch, or commit, and teams cannot reliably reproduce the same installed agent version over time.

Outcome: let users install from a specific GitHub ref and ensure later updates respect that pin.

## Target user or stakeholder

- Teams that want reproducible agent installs across machines
- Users who want to stay on a known-good agent version instead of tracking the latest default branch

## Recommended scope or priority

Priority: high. Reproducibility is core to a lock-file-backed install workflow and improves trust in update behavior.

In scope:

- Provide an explicit way to install a GitHub agent from a tag, branch, or commit
- Persist the chosen ref in lock file metadata for GitHub installs
- Make `update` use the stored pinned ref instead of drifting to the repository default branch
- Keep unpinned installs working as they do today

Out of scope:

- Pinning local filesystem sources
- Resolving semantic version ranges
- Automatic migration of every existing lock entry to a pinned ref

## Requirements and acceptance criteria

### Requirements

1. Users can explicitly choose a GitHub ref when installing an agent from GitHub.
2. The chosen ref is stored so later updates can fetch against the same ref.
3. If an install is pinned, `update` checks and updates only within that pinned ref target.
4. If an install is not pinned, current update behavior remains unchanged for MVP.
5. CLI output makes it clear when an installed agent is pinned versus unpinned.

### Acceptance criteria

- A GitHub agent can be installed from a specific tag, branch, or commit.
- The lock file records enough metadata for a later `update` to respect that pin.
- Running `update` on a pinned install does not silently switch back to the repo default branch.
- Existing unpinned GitHub installs continue to work without requiring immediate migration.
- Docs explain the difference between pinned and unpinned update behavior.

## Risks, dependencies, and open questions

Dependencies:

- Agreement on the user-facing pin syntax or flag
- Agreement on the minimum lock-file metadata needed to preserve the pin

Risks:

- Ambiguous ref handling could make install behavior hard to predict
- If lock metadata is incomplete, users may think installs are reproducible when they are not
- Supporting both pinned and unpinned paths adds state complexity to update logic

Open questions:

- Should MVP support both branch and immutable commit pins equally, or treat commit pins as the recommended path?
- Should existing unpinned installs be labelable in `list` output so users can see reproducibility risk?
- Should switching a pinned install to a new ref happen through `update`, `add`, or a later dedicated workflow?

## MVP recommendation and suggested next steps

Recommended MVP: support explicit GitHub ref pinning for new installs, store that ref in the lock file, and make `update` honor it without changing behavior for unpinned installs.

## Recommended next steps

- Decide the user-facing pin input format before implementation starts
- Define the lock-file schema addition and the expected output wording for pinned installs
- Document whether teams should prefer tag pins or commit pins for shared project installs
