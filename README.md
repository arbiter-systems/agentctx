# instructov

instructov discovers and audits AI instruction files like AGENTS.md, CLAUDE.md, Copilot instructions, and SKILL.md to reduce token waste and conflicting guidance.

## MVP
- `agentctx doctor`
- `agentctx doctor --diff <ref>`

Compare instruction impact before merging:

```bash
agentctx doctor --diff dev
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

## Planned
- inventory instruction files
- estimate token cost
- detect duplicate guidance
- detect risky validation commands
- suggest compact task prompts
