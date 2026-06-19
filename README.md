# Instructov

Instructov audits and streamlines AI coding-agent instructions before they enter the prompt.

It discovers repo guidance such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, and `**/SKILL.md`, then helps developers find bloated, duplicated, stale, risky, or conflicting guidance without making network calls, LLM calls, or automatic rewrites.

## Core workflow

Use `doctor` to inspect instruction debt:

```bash
instv doctor
```

Use `suggest` to inspect deterministic routing for a task:

```bash
instv suggest "review PR 31"
```

Use `brief` to produce a compact task prompt/loadout without dumping every instruction file into context:

```bash
instv brief "review PR 31 for security and test gaps"
```

See [workflow examples](docs/examples.md) for small-repo, bloated-guidance, multi-skill, and pre-merge instruction-impact scenarios.

## Prompt review

Review prompt text locally before sending it to a coding agent. Supply prompt content through stdin rather than a positional shell argument:

```bash
printf '%s' 'Implement issue 80. Add tests and run typecheck.' | instv review --stdin --profile coding-task
```

Use `--json` for integrations. Available profiles are `coding-task`, `code-review`, `planning`, and `general`.

Prompt review is deterministic and advisory. It reports high-confidence checks for empty prompts, missing objective or validation guidance where the selected profile requires them, duplicate constraints, potentially destructive commands, and likely secrets. Secret values are not included in findings. Prompt-size estimates are approximate.

## Context budget and branch impact

Show approximate instruction-context pressure:

```bash
instv doctor --budget 4000
```

Compare instruction impact before merging:

```bash
instv doctor --diff dev
```

## Command aliases

`instv` is the primary short CLI command. `instructov` remains available as a compatibility alias.

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

The repo was previously named `agentctx`. New docs and examples should use `Instructov` and `instv`.

Legacy `.agentctx/` cache paths are ignored. Legacy `agentctx.yml` is not loaded; rename it to `instructov.yml` to use the current configuration format.

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
