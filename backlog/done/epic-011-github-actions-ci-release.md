# Epic 011: GitHub Actions CI and release workflows

Status: Done. Implemented and moved to `backlog/done/` in the same work session.

## Problem and outcome

The repository has no GitHub Actions automation for validating changes or cutting npm releases, so maintainers must run release steps manually and there is no shared CI gate on `master`.

Outcome: add a GitHub Actions CI workflow for push and pull request validation, plus a manual release workflow that versions, tags, builds, publishes, and creates a GitHub release for `agents-io`.

## Requirements and acceptance criteria

- CI runs on push and pull request for `master`.
- CI installs dependencies with Bun, then runs typecheck, tests, and build.
- Release is manually triggered with `major`, `minor`, or `patch`.
- Release derives the next semver from the latest tag or `package.json`, pushes the tag, rebuilds from the tag, publishes with provenance, and creates a GitHub release.
- Minimal maintainer docs explain the workflows and npm publishing prerequisite.
