# Epic 009: Platform-aware validation

Status: Active. Active epics live in `backlog/`. Move completed epics to `backlog/done/`.

## Problem and outcome

Generic validation confirms that an agent matches the shared `agents-io` contract, but it does not tell users whether a specific target platform can consume the agent cleanly. Users can still pass validation and then discover platform-specific issues later in install flows.

Outcome: extend validation so users can check compatibility for the platforms they plan to install to.

## Target user or stakeholder

- Agent authors who want confidence that an agent works across target tools
- Users validating an agent before installing to a specific platform

## Recommended scope or priority

Priority: medium-high, after Epic 002. It builds on the core validate workflow and prevents avoidable install surprises.

In scope:

- Extend validation to report platform-specific compatibility for selected platforms
- Reuse platform rules already implied by adapter behavior where possible
- Surface clear warnings or failures when platform-specific fields or settings are unsupported
- Keep the base generic validation behavior intact

Out of scope:

- Full install simulation for every adapter
- Auto-rewriting agent files to satisfy platform requirements
- Broad linting of optional style or authoring conventions

## Requirements and acceptance criteria

### Requirements

1. Platform-aware validation builds on the existing generic validation rules rather than replacing them.
2. Users can validate compatibility for one or more explicit target platforms.
3. Validation output distinguishes generic contract validity from platform-specific compatibility results.
4. Platform-specific failures identify the relevant platform and the rule that failed.
5. The feature remains read-only and does not write adapter files or lock files.

### Acceptance criteria

- A valid generic agent can still fail platform-aware validation for a selected platform with a clear reason.
- A user can validate an agent against a specific supported platform before installing it there.
- Validation output makes it clear whether the issue is generic or platform-specific.
- Platform-aware validation rules align with actual install behavior closely enough that users are not surprised by later adapter failures.
- Docs explain when generic validation is sufficient versus when platform-aware validation should be used.

## Risks, dependencies, and open questions

Dependencies:

- Epic 002: `validate` command
- Agreement on which adapter rules are stable enough to expose as user-facing validation rules

Risks:

- If validation rules drift from adapter behavior, users will lose trust in the command
- Too much platform detail could make the command noisy for common cases
- Adapter-specific edge cases could grow scope quickly if MVP is not constrained

Open questions:

- Should MVP require explicit platform selection, or show platform results for all supported platforms by default?
- Which platform-specific conditions should be hard failures versus warnings?
- Should `add` surface the same platform-aware messages automatically when a target platform is selected?

## MVP recommendation and suggested next steps

Recommended MVP: keep generic validation as the baseline, then add explicit platform-targeted checks that report only the compatibility issues most likely to block or mislead installs.

## Recommended next steps

- Define the first set of platform-specific rules the team is willing to keep in sync with adapters
- Decide whether platform-aware validation is opt-in only for the first release
- Align error wording between `validate` and `add` so compatibility feedback feels consistent
