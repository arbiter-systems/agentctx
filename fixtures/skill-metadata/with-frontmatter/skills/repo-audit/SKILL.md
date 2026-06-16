---
name: repo-audit
description: "Audit issue state against dev and produce an implementation plan."
tasks: [audit, issue-review, implementation-planning]
triggers: [audit issue, verify merged, review dev]
summary: "Audit issue state against dev and produce an implementation plan."
paths: [src/**, tests/**]
---

# Repo Audit Skill

Use this skill to audit issue state against the dev branch and produce an implementation plan.

## When to use

Invoke this skill when asked to audit, verify, or review issues against the current dev branch.

## Steps

1. Check open issues
2. Compare against merged PRs
3. Produce an implementation plan
