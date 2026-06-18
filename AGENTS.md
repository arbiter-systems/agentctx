# AGENTS.md

## Repository role

Instructov is a deterministic CLI for discovering, auditing, and streamlining AI coding-agent instruction files. Keep behavior local, reproducible, and safe for public open-source use.

## Source of truth

- Branch from `dev`.
- Open pull requests into `dev`.
- Use `main` only for release/default-branch synchronization when explicitly requested.
- Branch names must include the issue number and a short issue-title slug.
- Development pull request bodies should use `Refs #<issue-number>`.

## Boundaries

- Do not add network calls, model calls, telemetry, or background services unless the issue explicitly requires it.
- Do not add autofix behavior, broad file rewriting, or destructive repository changes unless explicitly scoped.
- Keep `doctor`, `suggest`, and `brief` deterministic.
- Do not include private Arbiter Systems planning, customer, funding, or strategy details in this public repository.

## Cache and generated artifacts

- Treat `.instructov/` as local runtime cache.
- Treat `.agentctx/` as a legacy local cache path.
- Never commit cache artifacts, generated logs, or local settings.
- Cache writes must remain non-fatal and must not modify instruction source files.

## Validation

Run focused validation for changed areas:

- `npm run typecheck`
- targeted `vitest` tests when applicable
- `npm test` when behavior changes touch shared paths
- `npm run build`

For CLI behavior changes, include at least one focused CLI smoke check using `npm run dev -- <command>` or the package bin after build.

## Documentation and changelog

- Update `README.md` when commands, flags, output, or workflow examples change.
- Update `CHANGELOG.md` for user-facing CLI, docs, packaging, or release-process changes.
- Keep examples aligned with the current `dev` implementation.

## Issue audit

Before suggesting or implementing an issue:

- Verify the issue is still open.
- Check whether it is already implemented or merged on `dev`.
- Report stale issues instead of duplicating work.
