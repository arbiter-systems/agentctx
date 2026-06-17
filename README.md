# Instructov

Instructov audits and streamlines AI coding-agent instructions before they enter the prompt.

It discovers repo guidance such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, and `**/SKILL.md`, then helps developers find bloated, duplicated, stale, risky, or conflicting guidance without making network calls, LLM calls, or automatic rewrites.

## Core workflow

Use `doctor` to inspect instruction debt:

```bash
instructov doctor
```

Use `suggest` to inspect deterministic routing for a task:

```bash
instructov suggest "review PR 31"
```

Use `brief` to produce a compact task prompt/loadout without dumping every instruction file into context:

```bash
instructov brief "review PR 31 for security and test gaps"
```

## Context budget and branch impact

Show approximate instruction-context pressure:

```bash
instructov doctor --budget 4000
```

Compare instruction impact before merging:

```bash
instructov doctor --diff dev
```

## Configuration

Repos can add an optional `instructov.yml`:

```yaml
version: v0alpha1

discovery:
  include:
    - AGENTS.md
    - CLAUDE.md
    - GEMINI.md
    - .github/copilot-instructions.md
    - "**/SKILL.md"
  exclude:
    - node_modules/**
    - vendor/**
    - dist/**
    - build/**

doctor:
  token_thresholds:
    source_warning: 1200
    source_high: 2000
    section_warning: 500
  fail_on:
    - conflicting-branch-target
    - risky-validation-command

suggest:
  default_branch: dev
  max_prompt_tokens: 350
  max_selected_skills: 3
  prefer_low_token_skills: true
  include_full_skill_text: false

display_limits:
  findings: 10
  selected_guidance: 3
  excluded_guidance: 3
  suggest_excluded: 3
```

## Legacy migration

The repo was previously named `agentctx`. New docs and examples should use `Instructov` and `instructov`.

Implementation may keep compatibility for legacy `agentctx.yml` and `.agentctx/` paths while new projects move to `instructov.yml` and `.instructov/`.

## Constraints

- Local only.
- Deterministic.
- No network calls.
- No LLM calls.
- No automatic file rewrites.
- Token estimates are approximate and should not be presented as model-exact counts.

## Planned

- Inventory instruction files.
- Estimate instruction context cost.
- Detect duplicate guidance.
- Detect risky validation commands.
- Suggest compact task prompts.
- Generate task-specific briefings.
- Report context budget pressure.
- Compare instruction impact across refs.
