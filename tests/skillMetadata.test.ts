import { describe, expect, it } from "vitest";

import {
  extractSkillMetadata,
  extractAllSkillMetadata,
  type SkillMetadata,
} from "../src/skillMetadata.js";
import type { AnalyzedInstructionSource } from "../src/analysis.js";
import type { Finding } from "../src/findings.js";

function makeSource(
  sourcePath: string,
  estimatedTokens = 0,
): AnalyzedInstructionSource {
  return {
    path: sourcePath,
    kind: "skill",
    scopePath: sourcePath.replace(/\/SKILL\.md$/, ""),
    bytes: 0,
    estimatedTokens,
  };
}

const WITH_FRONTMATTER_TEXT = `---
name: repo-audit
tasks: [audit, issue-review, implementation-planning]
triggers: [audit issue, verify merged, review dev]
summary: "Audit issue state against dev and produce an implementation plan."
paths: [src/**, tests/**]
---

# Repo Audit Skill

Use this skill to audit issue state.

## When to use

Invoke when asked to audit issues.
`;

const NO_FRONTMATTER_WITH_HEADING_TEXT = `# Code Review

Use this skill to perform a code review on a pull request.

## When to use

Invoke when asked to review or audit a pull request.
`;

const NO_FRONTMATTER_NO_HEADING_TEXT = `Use this skill to debug issues. Review validation and security concerns.
`;

describe("extractSkillMetadata — with frontmatter", () => {
  it("extracts name from frontmatter", () => {
    const source = makeSource("skills/repo-audit/SKILL.md");
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT);
    expect(meta.name).toBe("repo-audit");
  });

  it("extracts summary from frontmatter", () => {
    const source = makeSource("skills/repo-audit/SKILL.md");
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT);
    expect(meta.summary).toBe(
      "Audit issue state against dev and produce an implementation plan.",
    );
  });

  it("extracts tasks array from frontmatter", () => {
    const source = makeSource("skills/repo-audit/SKILL.md");
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT);
    expect(meta.tasks).toEqual([
      "audit",
      "issue-review",
      "implementation-planning",
    ]);
  });

  it("extracts triggers array from frontmatter", () => {
    const source = makeSource("skills/repo-audit/SKILL.md");
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT);
    expect(meta.triggers).toEqual([
      "audit issue",
      "verify merged",
      "review dev",
    ]);
  });

  it("extracts pathApplicability from frontmatter paths field", () => {
    const source = makeSource("skills/repo-audit/SKILL.md");
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT);
    expect(meta.pathApplicability).toEqual(["src/**", "tests/**"]);
  });

  it("sets metadataSource to frontmatter when all fields present", () => {
    const source = makeSource("skills/repo-audit/SKILL.md");
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT);
    expect(meta.metadataSource).toBe("frontmatter");
  });

  it("frontmatter wins over inferred name from directory", () => {
    const source = makeSource("skills/some-other-dir/SKILL.md");
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT);
    expect(meta.name).toBe("repo-audit");
  });

  it("frontmatter summary wins over inferred heading", () => {
    const source = makeSource("skills/repo-audit/SKILL.md");
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT);
    expect(meta.summary).not.toBe("Repo Audit Skill");
    expect(meta.summary).toBe(
      "Audit issue state against dev and produce an implementation plan.",
    );
  });
});

describe("extractSkillMetadata — without frontmatter", () => {
  it("infers name from parent directory", () => {
    const source = makeSource("skills/code-review/SKILL.md");
    const meta = extractSkillMetadata(source, NO_FRONTMATTER_WITH_HEADING_TEXT);
    expect(meta.name).toBe("code-review");
  });

  it("infers summary from first heading", () => {
    const source = makeSource("skills/code-review/SKILL.md");
    const meta = extractSkillMetadata(source, NO_FRONTMATTER_WITH_HEADING_TEXT);
    expect(meta.summary).toBe("Code Review");
  });

  it("infers summary from first paragraph when no heading exists", () => {
    const source = makeSource("skills/debugger/SKILL.md");
    const meta = extractSkillMetadata(source, NO_FRONTMATTER_NO_HEADING_TEXT);
    expect(meta.summary).toBe(
      "Use this skill to debug issues. Review validation and security concerns.",
    );
  });

  it("infers tasks from keywords in text", () => {
    const source = makeSource("skills/code-review/SKILL.md");
    const meta = extractSkillMetadata(source, NO_FRONTMATTER_WITH_HEADING_TEXT);
    expect(meta.tasks).toContain("review");
    expect(meta.tasks).toContain("audit");
  });

  it("infers triggers from keywords in text", () => {
    const source = makeSource("skills/code-review/SKILL.md");
    const meta = extractSkillMetadata(source, NO_FRONTMATTER_WITH_HEADING_TEXT);
    expect(meta.triggers).toContain("review");
  });

  it("sets metadataSource to inferred when no frontmatter present", () => {
    const source = makeSource("skills/code-review/SKILL.md");
    const meta = extractSkillMetadata(source, NO_FRONTMATTER_WITH_HEADING_TEXT);
    expect(meta.metadataSource).toBe("inferred");
  });

  it("infers pathApplicability from scope/applies-to heading bullet lists", () => {
    const text = `# My Skill

## Scope

- src/**
- tests/**
`;
    const source = makeSource("skills/my-skill/SKILL.md");
    const meta = extractSkillMetadata(source, text);
    expect(meta.pathApplicability).toEqual(["src/**", "tests/**"]);
  });

  it("returns empty pathApplicability when no path section exists", () => {
    const source = makeSource("skills/code-review/SKILL.md");
    const meta = extractSkillMetadata(source, NO_FRONTMATTER_WITH_HEADING_TEXT);
    expect(meta.pathApplicability).toEqual([]);
  });
});

describe("extractSkillMetadata — mixed metadataSource", () => {
  it("sets metadataSource to mixed when frontmatter has name but tasks are inferred", () => {
    const text = `---
name: my-skill
---

# My Skill

Use this skill for auditing and review.
`;
    const source = makeSource("skills/my-skill/SKILL.md");
    const meta = extractSkillMetadata(source, text);
    expect(meta.name).toBe("my-skill");
    expect(meta.metadataSource).toBe("mixed");
  });
});

describe("extractSkillMetadata — estimatedTokens", () => {
  it("uses source estimatedTokens when non-zero", () => {
    const source = makeSource("skills/repo-audit/SKILL.md", 99);
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT);
    expect(meta.estimatedTokens).toBe(99);
  });

  it("falls back to text-based estimation when source has zero tokens", () => {
    const source = makeSource("skills/repo-audit/SKILL.md", 0);
    const text = "hello world";
    const meta = extractSkillMetadata(source, text);
    expect(meta.estimatedTokens).toBe(Math.ceil(text.length / 4));
  });
});

describe("extractSkillMetadata — penalties", () => {
  it("attaches penalties from findings matching the sourcePath", () => {
    const source = makeSource("skills/repo-audit/SKILL.md");
    const findings: Finding[] = [
      {
        code: "oversized-source",
        severity: "high",
        message: "Source exceeds token limit.",
        sourcePath: "skills/repo-audit/SKILL.md",
        estimatedAvoidableTokens: 400,
      },
      {
        code: "missing-skill-purpose",
        severity: "low",
        message: "Skill file does not describe its purpose.",
        sourcePath: "skills/repo-audit/SKILL.md",
      },
    ];
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT, findings);
    expect(meta.penalties).toHaveLength(2);
    expect(meta.penalties[0]).toEqual({
      code: "oversized-source",
      severity: "high",
      estimatedAvoidableTokens: 400,
    });
    expect(meta.penalties[1]).toEqual({
      code: "missing-skill-purpose",
      severity: "low",
    });
  });

  it("does not attach penalties from findings for a different sourcePath", () => {
    const source = makeSource("skills/repo-audit/SKILL.md");
    const findings: Finding[] = [
      {
        code: "oversized-source",
        severity: "high",
        message: "Source exceeds token limit.",
        sourcePath: "skills/other/SKILL.md",
        estimatedAvoidableTokens: 200,
      },
    ];
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT, findings);
    expect(meta.penalties).toEqual([]);
  });

  it("returns empty penalties when no findings provided", () => {
    const source = makeSource("skills/repo-audit/SKILL.md");
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT);
    expect(meta.penalties).toEqual([]);
  });
});

describe("extractSkillMetadata — JSON shape", () => {
  it("does not include full skill body text in metadata", () => {
    const source = makeSource("skills/repo-audit/SKILL.md");
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT);
    const json = JSON.stringify(meta);
    expect(json).not.toContain("Use this skill to audit issue state.");
    expect(json).not.toContain("Invoke when asked to audit issues.");
  });

  it("includes expected top-level fields only", () => {
    const source = makeSource("skills/repo-audit/SKILL.md");
    const meta = extractSkillMetadata(source, WITH_FRONTMATTER_TEXT);
    const keys = Object.keys(meta).sort();
    expect(keys).toEqual(
      [
        "sourcePath",
        "name",
        "summary",
        "tasks",
        "triggers",
        "pathApplicability",
        "estimatedTokens",
        "penalties",
        "metadataSource",
      ].sort(),
    );
  });
});

describe("extractAllSkillMetadata", () => {
  it("ignores non-SKILL.md sources", () => {
    const sources: AnalyzedInstructionSource[] = [
      { path: "AGENTS.md", kind: "agents", scopePath: ".", bytes: 0, estimatedTokens: 0 },
      { path: "CLAUDE.md", kind: "claude", scopePath: ".", bytes: 0, estimatedTokens: 0 },
      { path: "skills/review/SKILL.md", kind: "skill", scopePath: "skills/review", bytes: 0, estimatedTokens: 0 },
    ];
    const contents = new Map([
      ["AGENTS.md", "# Agents\nDo stuff."],
      ["CLAUDE.md", "# Claude\nDo stuff."],
      ["skills/review/SKILL.md", NO_FRONTMATTER_WITH_HEADING_TEXT],
    ]);
    const results = extractAllSkillMetadata(sources, contents);
    expect(results).toHaveLength(1);
    expect(results[0]?.sourcePath).toBe("skills/review/SKILL.md");
  });

  it("ignores skill sources whose content is not available", () => {
    const sources: AnalyzedInstructionSource[] = [
      { path: "skills/missing/SKILL.md", kind: "skill", scopePath: "skills/missing", bytes: 0, estimatedTokens: 0 },
    ];
    const contents = new Map<string, string>();
    const results = extractAllSkillMetadata(sources, contents);
    expect(results).toHaveLength(0);
  });

  it("extracts metadata for each skill source", () => {
    const sources: AnalyzedInstructionSource[] = [
      { path: "skills/alpha/SKILL.md", kind: "skill", scopePath: "skills/alpha", bytes: 0, estimatedTokens: 0 },
      { path: "skills/beta/SKILL.md", kind: "skill", scopePath: "skills/beta", bytes: 0, estimatedTokens: 0 },
    ];
    const contents = new Map([
      ["skills/alpha/SKILL.md", WITH_FRONTMATTER_TEXT],
      ["skills/beta/SKILL.md", NO_FRONTMATTER_WITH_HEADING_TEXT],
    ]);
    const results = extractAllSkillMetadata(sources, contents);
    expect(results).toHaveLength(2);
    expect(results.map((m) => m.sourcePath)).toEqual([
      "skills/alpha/SKILL.md",
      "skills/beta/SKILL.md",
    ]);
  });
});
