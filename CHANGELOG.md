# Changelog

All notable changes to Instructov are documented here.

This project uses a simple Keep-a-Changelog-style format. Instructov is pre-1.0, so minor versions may include CLI behavior changes while the interface stabilizes.

## [Unreleased]

### Added

- Added a local VS Code Prompt Review extension with paste, profile, review, and clear workflow.
- Added practical Phase 2 workflow examples for baseline inspection, budget review, multi-skill task briefing, local diff comparison, and no-write verdicts.
- Added deterministic `instv review --stdin` prompt review with human and JSON output.
- Added profile-aware prompt checks for coding tasks, code review, planning, and general prompts.
- Added local high-confidence checks for empty prompts, missing structured objective or validation guidance, duplicate constraints, destructive commands, and likely secrets without displaying matched secret values.
- Added this changelog to track user-facing CLI, documentation, and release changes.
- Added release documentation for pre-1.0 versioning and release steps.
- Added a pull request checklist item for changelog updates.
- Added `instv` as the primary short CLI command.
- Added repo-local `AGENTS.md` guidance for branch, PR, validation, cache, and safety expectations.
- Added repository configuration files to default instruction-source discovery.

### Removed

- Removed the legacy `instructov` command alias. Use `instv`.
- Removed legacy `agentctx` migration guidance and ignored-cache support.

### Fixed

- Hardened local Git diff revision input and confined instruction discovery to the repository root.
- Updated help and human CLI output to use `instv` as the primary identity.
- Fixed `suggest` skill penalties so parsed section and command findings are included.
- Fixed `doctor --diff` to include deleted conventional instruction sources in baseline comparison.
- Made `.instructov` cache replacement atomic while retaining non-fatal cache failures.

## [0.1.0] - 2026-06-17

### Added

- Added the initial `instructov` CLI package and compiled `dist/cli.js` package entrypoint.
- Added the `doctor` command with text and JSON output.
- Added instruction source discovery for `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, repo config, and nested `SKILL.md` files.
- Added token estimation and an internal non-fatal analysis cache.
- Added Markdown section parsing and command extraction for instruction files.
- Added deterministic findings for duplicate guidance, duplicate commands, repeated headings, oversized sources, oversized sections, and high-token-waste sources.
- Added risky validation guidance detection.
- Added core instruction conflict detection for branch targets, PR targets, validation scope, formatting scope, delegation mode, and destructive-change mode.
- Added missing core guidance checks for branch, PR target, bounded validation, destructive-command safety, and skill metadata gaps.
- Added `SKILL.md` metadata extraction for low-token routing.
- Added the `suggest` command with deterministic task classification, relevance-per-token scoring, compact prompt suggestions, route metadata, and estimated avoided context.
- Added repo-local `instructov.yml` configuration support for discovery, doctor thresholds, fail-on behavior, suggest behavior, and display limits.
- Added the `brief` command for compact task-specific briefing output.
-Added context budget reporting for `doctor` and `brief`.
- Added `doctor --changed` for changed-instruction-source analysis and CI-oriented exit behavior.
- Added `doctor --diff <ref>` for comparing instruction impact against another git ref.
- Added GitHub Actions CI validation for typecheck, tests, and build.

### Changed

- Renamed the project, package, command, config, cache, docs, tests, and fixtures from `agentctx` to Instructov / `instructov`.
- Updated README positioning, examples, constraints, workflow documentation, and legacy migration notes for the Instructov naming.
- Updated local development scripts to use `tsx` for the CLI runner.

### Fixed

- Fixed linked package binary execution so local linked CLI installs can run correctly.
- Fixed the dev CLI runner module-resolution path by replacing direct Node TypeScript execution with `tsx`.
- Hardened discovery and cache behavior around missing, inaccessible, and removed instruction files.
