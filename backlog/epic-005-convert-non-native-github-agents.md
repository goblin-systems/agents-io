# Epic 005: Optional conversion for non-native GitHub agents

Status: Active. Active epics live in `backlog/`. Move completed epics to `backlog/done/`.

## Problem and outcome

Users may find agent-like repositories on GitHub that were not authored for `agents-io` and do not include a compatible `agent.md` file. Today, these sources are likely to fail the normal add flow even when the repo contains enough agent content to be worth trying.

Outcome: when discovery finds a source that appears to contain an agent but is not `agents-io` compatible, the CLI can offer an explicit, optional conversion attempt instead of failing immediately.

## Target user or stakeholder

- Users exploring agents from GitHub outside the `agents-io` ecosystem
- Maintainers who want a pragmatic way to trial community agents with lower setup effort

## Recommended scope or priority

Priority: medium. It expands useful discovery without changing the core mission of installing compatible agents.

In scope:

- Detect likely agent-like GitHub sources that are not directly compatible with the current `agent.md` contract
- Present an explicit prompt asking whether the user wants to try conversion
- Warn the user that conversion may fail, may be incomplete, and may behave unexpectedly after install
- Define the minimum conversion output needed to produce a candidate `agents-io` agent definition for install review
- Keep the flow limited to user-invoked add and discovery paths where prompting already fits

Out of scope:

- Silent auto-conversion without user confirmation
- Broad support for arbitrary repository formats with no agent-like signal
- Perfect semantic translation of every third-party agent format
- Changes to the canonical `agents-io` agent format

## Requirements and acceptance criteria

### Requirements

1. If discovery identifies a GitHub source that appears agent-like but is not `agents-io` compatible, the CLI offers a conversion prompt instead of silently converting.
2. The prompt clearly warns that the conversion is best-effort, may fail, and the installed result may not work as expected.
3. If the user declines, the CLI exits that conversion path cleanly without writing converted agent files.
4. If the user accepts, the CLI attempts conversion only for the selected source and continues with the normal install flow only if a valid candidate agent definition is produced.
5. If conversion cannot produce a valid candidate, the CLI reports that clearly and does not install a partial or ambiguous result.
6. The MVP stays focused on GitHub discovery and does not broaden into a general import framework for unrelated content types.

### Acceptance criteria

- When `add` encounters a GitHub source that looks like an agent but lacks a compatible `agent.md`, the CLI can ask whether to try converting it.
- The prompt includes explicit warning language that conversion may fail or behave unexpectedly.
- No conversion is attempted unless the user explicitly confirms.
- If conversion succeeds, the resulting install path still applies normal `agents-io` validation before any write occurs.
- If conversion fails or validation fails, the CLI reports the failure and does not install the converted source.

## Risks, dependencies, and open questions

Dependencies:

- Agreement on what repository signals are strong enough to classify a source as agent-like for MVP
- Agreement on the minimum metadata required to build a valid candidate `agents-io` agent

Risks:

- Weak detection rules could prompt users too often and reduce trust in discovery results
- Overpromising conversion quality could create support burden when community agents behave differently after install
- Format diversity across third-party agents could push the scope beyond a realistic CLI feature

Open questions:

- Which non-native formats or file conventions should MVP recognize first?
- Should converted agents be labeled in output or lock metadata so users know the source was adapted?
- Should the warning text differ for interactive single-agent add versus broader discovery flows?

## MVP recommendation and suggested next steps

Recommended MVP: support a narrow best-effort conversion path for clearly agent-like GitHub sources, gated behind a confirmation prompt with strong warning language and normal post-conversion validation.

## Recommended next steps

- Define the MVP detection heuristics and explicitly reject weak matches
- Draft the exact warning and confirmation copy before implementation so the risk is unmistakable
- Decide whether converted installs need a lightweight label for future support and troubleshooting
