# AGENTS.md

## Repository role

Instructov is a local, deterministic CLI for auditing and streamlining AI coding-agent instruction files before they enter prompt context.

## Source of truth

- Branch from `dev` unless `dev` is unavailable.
- Open pull requests against `dev` unless `dev` is unavailable.
- Branch names should include the issue number and a short issue-title slug, for example `docs-56-add-repo-local-agents-guidance`.
- Use `Refs #<issue-number>` in PR bodies for `dev` pull requests. Do not use auto-closing keywords unless the PR targets the default release branch and should close the issue on merge.

## Safety constraints

- Keep the CLI local and deterministic.
- Do not add network calls.
- Do not add LLM calls.
- Do not add automatic rewrites, autofix behavior, or file writes unless the linked issue explicitly scopes them.
- Do not move private company strategy, security records, incidents, or planning details into this public repository.

## Cache and generated artifacts

- `.instructov/` is local runtime cache state and must not be committed.
- `.agentctx/` is legacy local cache state and must not be committed.
- Cache failures should stay non-fatal unless an issue explicitly changes that behavior.

## Validation

Prefer the smallest useful validation for the change:

- `npm run typecheck` for TypeScript/API shape changes.
- Targeted `vitest` tests for focused behavior changes.
- `npm test` when shared behavior may be affected.
- `npm run build` when package output or CLI entrypoints may be affected.

Document validation performed in the PR body. For docs-only changes, manual review is acceptable when clearly noted.

## Documentation and changelog

- Update `CHANGELOG.md` for user-facing CLI behavior, command, flag, config, output, detection, safety, or documentation changes.
- Mark changelog as not needed for tests-only, internal refactors, or CI-only maintenance that users will not notice.
- Keep public documentation concise, supportable, and free of private operational details.
