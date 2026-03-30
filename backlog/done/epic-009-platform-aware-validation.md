# Epic 009: Adapter-backed compatibility checks in install flows

Status: Done. Completed epics live in `backlog/done/`.

## Problem and outcome

Generic validation confirms that an agent matches the shared `agents-io` contract, but it does not tell users whether an explicitly selected install target is likely to fail during adapter conversion or install. As Epic 010 and Epic 005 expand install and conversion paths, the highest-value gap is lightweight compatibility feedback inside those flows rather than a broad standalone validation surface.

Outcome: surface adapter-backed compatibility checks during `add` and conversion when the user has selected one or more target platforms.

## Target user or stakeholder

- Users installing an agent to specific platforms through `add`
- Users attempting best-effort conversion of non-native GitHub agents before install

## Recommended scope or priority

Priority: medium, after Epic 010 and Epic 005. It is a small follow-on that makes install and conversion flows safer without committing the team to a full standalone validate expansion.

In scope:

- Run compatibility checks only when `add` or conversion already knows the explicit target platform set
- Reuse adapter-backed rules already implied by install or conversion behavior where possible
- Surface clear warnings or failures before writing files when a selected platform is incompatible
- Keep generic validation as the baseline gate before compatibility messaging

Out of scope:

- A standalone `validate` experience for all platforms
- Full install simulation for every adapter
- Auto-rewriting agent files to satisfy platform requirements
- Broad linting of optional style or authoring conventions

## Requirements and acceptance criteria

### Requirements

1. Compatibility checks build on the existing generic validation rules rather than replacing them.
2. The checks run only when install or conversion already has one or more explicit target platforms.
3. Compatibility output distinguishes generic contract failures from platform-specific compatibility results.
4. Platform-specific failures identify the relevant platform and the adapter-backed rule that failed.
5. If a selected platform is incompatible, the flow stops before writing adapter files or lock entries for that platform.

### Acceptance criteria

- A valid generic agent can still be blocked in `add` or conversion for a selected platform with a clear compatibility reason.
- When a user selects specific platforms, the CLI reports compatibility issues before writing converted or installed artifacts.
- Output makes it clear whether the issue is generic or specific to a selected platform.
- Compatibility rules align with actual adapter behavior closely enough that later install failures are reduced.
- Docs explain that MVP compatibility checks are part of install and conversion flows, not a separate broad validation feature.

## Risks, dependencies, and open questions

Dependencies:

- Epic 010: `sync` command from committed lock file
- Epic 005: optional conversion for non-native GitHub agents
- Agreement on which adapter rules are stable enough to expose as user-facing compatibility checks

Risks:

- If compatibility rules drift from adapter behavior, users will lose trust in install feedback
- Trying to cover every platform edge case could turn this back into a broad validation initiative
- Conversion-specific exceptions could create inconsistent messaging if `add` and conversion are not aligned

Open questions:

- Which adapter conditions should be hard failures versus warnings in MVP?
- If multiple platforms are selected, should one incompatible target block the whole action or only that target?
- Should converted agents carry any lightweight marker when compatibility warnings were surfaced but the install still proceeds?

## MVP recommendation and suggested next steps

Recommended MVP: keep generic validation as the baseline, then add a narrow compatibility layer inside `add` and conversion that reports only the adapter-backed issues most likely to block or mislead selected platform installs.

## Recommended next steps

- Define the first adapter-backed compatibility checks that materially change install or conversion outcomes
- Decide how multi-platform selection behaves when only one target is incompatible
- Align error wording across `add`, conversion, and any future validation surface so the same rule reads the same way
