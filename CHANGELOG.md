# Changelog

All notable changes to Instructov are documented here.

This project uses a simple Keep-a-Changelog-style format. Instructov is pre-1.0, so minor versions may include CLI behavior changes while the interface stabilizes.

## [Unreleased]

### Added

- Added practical Phase 2 workflow examples for baseline inspection, budget review, multi-skill task briefing, local diff comparison, and no-write verdicts.
- Added deterministic `instv review --stdin` prompt review with human and JSON output.
- Added profile-aware prompt checks for coding tasks, code review, planning, and general prompts.
- Added local high-confidence checks for empty prompts, missing structured objective or validation guidance, duplicate constraints, destructive commands, and likely secrets without displaying matched secret values.
- Added this changelog to track user-facing CLI, documentation, and release changes.
- Added release documentation for pre-1.0 versioning and release steps.
- Added a pull request checklist item for changelog updates.
- Added `instv` as the primary short CLI command while keeping `instructov` as a compatibility alias.
- Added repo-local `AGENTS.md` guidance for branch, PR, validation, cache, and safety expectations.

### Fixed

- Hardened local Git diff revision input and confined instruction discovery to the repository root.
- Updated help and human CLI output to use `instv` as the primary identity while retaining `instructov` compatibility.
- Clarified that legacy `agentctx.yml` is not loaded and must be renamed to `instructov.yml`.
- Removed tracked legacy cache artifacts and ignored local cache directories.
- Fixed `suggest` skill penalties so parsed section and command findings are included.

## [0.1.0] - 2026-06-17

### Added
