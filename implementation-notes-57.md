# Issue 57 implementation notes

Temporary implementation note for `perf(doctor): add oversized instruction source guard`.

Current branch work:

- Adds `MAX_INSTRUCTION_SOURCE_BYTES` in `src/analysis.ts`.
- Adds a deterministic size-based estimate for oversized sources in the analysis/cache path.
- Adds focused oversized-source tests.

Remaining before merge:

- Update `src/cli.ts` `readSourceContents` so oversized files are skipped before full content reads.
- Remove this temporary note before opening/merging the PR.
