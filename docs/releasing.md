# Releasing Instructov

Instructov uses a lightweight manual release process while the CLI stabilizes.

## Versioning

Instructov is pre-1.0.

- Patch versions are for bug fixes, documentation corrections, and small internal maintenance that does not change CLI behavior.
- Minor versions are for new commands, new flags, new output fields, changed CLI behavior, new detection rules, or config changes.
- Major versions are reserved for post-1.0 breaking changes.

## Changelog rules

Update `CHANGELOG.md` for user-facing changes, including:

- New commands, flags, output fields, config keys, or detection rules.
- Changed CLI behavior, defaults, examples, or public documentation.
- Fixes users would notice when running the CLI.
- Security or privacy-relevant changes.

A changelog update is not required for purely internal refactors, tests-only changes, CI-only maintenance, or typo fixes that do not affect users. In those cases, mark the pull request checklist item as not user-facing.

## Pull request checklist

Every pull request should mark one of these states:

- `CHANGELOG.md` updated.
- Not user-facing / changelog not needed.

## Release checklist

1. Confirm the `dev` branch is green.
2. Review merged changes since the last release.
3. Move relevant `[Unreleased]` entries in `CHANGELOG.md` into a new version section with the release date.
4. Update `package.json` and `package-lock.json` versions when cutting a package release.
5. Open a release pull request from a branch based on `dev` targeting `dev`.
6. Merge the release pull request after validation passes.
7. Promote `dev` to `main` using the repo's normal protected-branch workflow.
8. Create a git tag for the release after the release commit lands on the appropriate release branch.

## GitHub release notes

GitHub release notes should be copied from the matching `CHANGELOG.md` version section and edited for readability. Do not rely only on commit messages for release notes.

## Automation policy

Do not add release automation until publishing becomes frequent enough to justify it. Prefer manual changelog discipline over semantic-release, Changesets, or npm publishing automation for now.
