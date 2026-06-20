# CLI examples

Run the built-in examples command to print a short copy/paste reference:

```bash
instv example
```

The scenarios below show how to use the completed Phase 2 workflow in a local repository. All commands are local and deterministic: they do not call a network service or LLM, rewrite files, or claim model-exact token counts.

## 1. Small repository: establish a baseline

Start with `doctor` to see which instruction files are loaded and whether there is obvious instruction debt.

```bash
instv doctor
```

For a small repository, a clean report is useful confirmation that the agent-facing guidance is limited and internally consistent. Use `--details` only when you need the parsed sections and commands behind a finding:

```bash
instv doctor --details
```

## 2. Bloated instruction repository: prioritize context reduction

When a repository has many overlapping instruction files, compare the approximate instruction surface with the context budget you want to reserve for a task:

```bash
instv doctor --budget 4000
```

Review the reported duplicate, oversized, or high-token findings first. The estimates are directional context-pressure indicators, not exact model tokenizer counts.

## 3. Multi-skill repository: load guidance for one task

Use `suggest` to inspect deterministic routing before giving a task to a coding agent:

```bash
instv suggest "review PR 72 for correctness and test gaps"
```

Then use `brief` to build a compact task loadout. It includes selected guidance, excluded guidance with reasons, a suggested task prompt, and approximate avoided context without loading every skill file in full:

```bash
instv brief "review PR 72 for correctness and test gaps"
```

For automation or editor integrations, use JSON output:

```bash
instv brief --json "review PR 72 for correctness and test gaps"
```

## 4. Before merging an instruction change: inspect impact

Use `doctor --diff` to compare current instruction guidance with a local base ref before merging:

```bash
instv doctor --diff dev
```

The report shows changed instruction sources, approximate token delta, and new or resolved findings. Use it with the normal review workflow rather than as a replacement for code review:

```bash
instv doctor --diff dev
instv brief "review the instruction changes for correctness and test gaps"
```

## 5. Make findings actionable without changing files

Use `--verdict` when reviewing findings that need a short deterministic next step:

```bash
instv doctor --verdict
```

Verdicts are advisory and no-write. Apply any documentation or instruction changes manually, then rerun `doctor` or `doctor --diff dev` to review the result.
