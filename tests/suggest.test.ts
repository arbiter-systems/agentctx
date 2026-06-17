import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCandidates,
  buildPrompt,
  classifyTask,
  formatSuggestText,
  scoreCandidate,
  selectCandidates,
  type ScoredSuggestCandidate,
  type SuggestCandidate,
  type SuggestResult,
} from "../src/suggest.js";
import { createProgram } from "../src/cli.js";
import { estimateTokens } from "../src/tokenEstimate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  overrides: Partial<SuggestCandidate> & { name: string },
): SuggestCandidate {
  return {
    sourcePath: `skills/${overrides.name}/SKILL.md`,
    tasks: [],
    triggers: [],
    pathApplicability: [],
    estimatedTokens: 200,
    penalties: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyTask
// ---------------------------------------------------------------------------

describe("classifyTask — primary category", () => {
  it("classifies audit phrases", () => {
    expect(classifyTask("audit issue 330 against dev").primaryCategory).toBe("audit");
  });

  it("classifies review phrases", () => {
    expect(classifyTask("review PR 21").primaryCategory).toBe("review");
  });

  it("classifies implement phrases", () => {
    expect(classifyTask("implement the new suggest command").primaryCategory).toBe("implement");
  });

  it("classifies docs phrases", () => {
    expect(classifyTask("write documentation for the API").primaryCategory).toBe("docs");
  });

  it("classifies debug phrases", () => {
    expect(classifyTask("debug the failing test").primaryCategory).toBe("debug");
  });

  it("classifies planning phrases", () => {
    expect(classifyTask("plan the roadmap for Q3").primaryCategory).toBe("planning");
  });

  it("includes all categories in output", () => {
    const result = classifyTask("audit something");
    expect(result.categories).toHaveLength(6);
  });

  it("carries input through", () => {
    const input = "audit issue 12";
    expect(classifyTask(input).input).toBe(input);
  });

  it("lists matched keywords for the winning category", () => {
    const result = classifyTask("audit issue 330");
    const auditEntry = result.categories.find((c) => c.category === "audit");
    expect(auditEntry?.matchedKeywords.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildCandidates
// ---------------------------------------------------------------------------

describe("buildCandidates", () => {
  it("maps SkillMetadata to SuggestCandidate", () => {
    const meta = {
      sourcePath: "skills/foo/SKILL.md",
      name: "foo",
      summary: "Foo skill",
      tasks: ["audit"],
      triggers: ["audit issue"],
      pathApplicability: ["src/**"],
      estimatedTokens: 100,
      penalties: [],
      metadataSource: "frontmatter" as const,
    };
    const [candidate] = buildCandidates([meta]);
    expect(candidate).toMatchObject({
      sourcePath: "skills/foo/SKILL.md",
      name: "foo",
      summary: "Foo skill",
      tasks: ["audit"],
      triggers: ["audit issue"],
      pathApplicability: ["src/**"],
      estimatedTokens: 100,
      penalties: [],
    });
  });

  it("omits summary key when metadata has no summary", () => {
    const meta = {
      sourcePath: "skills/bar/SKILL.md",
      name: "bar",
      tasks: [],
      triggers: [],
      pathApplicability: [],
      estimatedTokens: 50,
      penalties: [],
      metadataSource: "inferred" as const,
    };
    const [candidate] = buildCandidates([meta]);
    expect("summary" in candidate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scoreCandidate
// ---------------------------------------------------------------------------

describe("scoreCandidate — category match", () => {
  it("awards category score when task matches primary category", () => {
    const candidate = makeCandidate({ name: "repo-audit", tasks: ["audit", "issue-review"] });
    const classified = classifyTask("audit issue 330");
    const scored = scoreCandidate(candidate, classified);
    expect(scored.score).toBeGreaterThanOrEqual(40);
    expect(scored.reasons.some((r) => r.includes("category"))).toBe(true);
  });

  it("awards no category score when tasks are unrelated", () => {
    const candidate = makeCandidate({ name: "deploy", tasks: ["deploy", "release"] });
    const classified = classifyTask("audit issue 330");
    const scored = scoreCandidate(candidate, classified);
    expect(scored.reasons.some((r) => r.includes("category"))).toBe(false);
  });
});

describe("scoreCandidate — trigger match", () => {
  it("awards trigger score when trigger phrase appears in input", () => {
    const candidate = makeCandidate({
      name: "repo-audit",
      tasks: [],
      triggers: ["audit issue", "verify merged"],
    });
    const classified = classifyTask("audit issue 330 against dev");
    const scored = scoreCandidate(candidate, classified);
    expect(scored.score).toBeGreaterThanOrEqual(30);
    expect(scored.reasons.some((r) => r.includes("trigger match"))).toBe(true);
  });

  it("does not award trigger score when trigger not in input", () => {
    const candidate = makeCandidate({
      name: "foo",
      triggers: ["deploy production"],
    });
    const classified = classifyTask("audit issue 330");
    const scored = scoreCandidate(candidate, classified);
    expect(scored.reasons.some((r) => r.includes("trigger match"))).toBe(false);
  });
});

describe("scoreCandidate — task keyword match", () => {
  it("awards task keyword score when task appears in input", () => {
    const candidate = makeCandidate({ name: "foo", tasks: ["audit"] });
    const classified = classifyTask("audit issue 330");
    const scored = scoreCandidate(candidate, classified);
    expect(scored.reasons.some((r) => r.includes("task keyword"))).toBe(true);
  });
});

describe("scoreCandidate — penalty deduction", () => {
  it("deducts points for high severity penalty", () => {
    const base = makeCandidate({ name: "big-skill", tasks: ["audit"] });
    const penalized = makeCandidate({
      name: "big-skill",
      tasks: ["audit"],
      penalties: [{ code: "oversized-source", severity: "high" }],
    });
    const classified = classifyTask("audit issue 330");
    const baseScore = scoreCandidate(base, classified).score;
    const penalizedScore = scoreCandidate(penalized, classified).score;
    expect(penalizedScore).toBeLessThan(baseScore);
    expect(penalizedScore).toBeLessThanOrEqual(baseScore - 30);
  });

  it("records exclusion reason for each penalty", () => {
    const candidate = makeCandidate({
      name: "foo",
      tasks: ["audit"],
      penalties: [{ code: "oversized-source", severity: "medium" }],
    });
    const classified = classifyTask("audit issue 330");
    const scored = scoreCandidate(candidate, classified);
    expect(scored.exclusions.some((e) => e.includes("oversized-source"))).toBe(true);
  });
});

describe("scoreCandidate — low-token bonus", () => {
  it("awards low-token bonus for small skills", () => {
    const small = makeCandidate({ name: "tiny", tasks: ["audit"], estimatedTokens: 50 });
    const large = makeCandidate({ name: "big", tasks: ["audit"], estimatedTokens: 2000 });
    const classified = classifyTask("audit issue 330");
    const smallScore = scoreCandidate(small, classified).score;
    const largeScore = scoreCandidate(large, classified).score;
    expect(smallScore).toBeGreaterThan(largeScore);
  });

  it("low-token relevant skill beats broad oversized skill when relevance is similar", () => {
    const relevant = makeCandidate({
      name: "audit-slim",
      tasks: ["audit"],
      triggers: [],
      estimatedTokens: 80,
      penalties: [],
    });
    const oversized = makeCandidate({
      name: "audit-broad",
      tasks: ["audit"],
      triggers: [],
      estimatedTokens: 2500,
      penalties: [{ code: "oversized-source", severity: "medium" }],
    });
    const classified = classifyTask("audit issue 330");
    const slimScore = scoreCandidate(relevant, classified).score;
    const broadScore = scoreCandidate(oversized, classified).score;
    expect(slimScore).toBeGreaterThan(broadScore);
  });
});

// ---------------------------------------------------------------------------
// selectCandidates
// ---------------------------------------------------------------------------

describe("selectCandidates", () => {
  it("selects top 3 relevant candidates", () => {
    const candidates = [
      makeCandidate({ name: "a", tasks: ["audit"], triggers: ["audit issue"] }),
      makeCandidate({ name: "b", tasks: ["audit"] }),
      makeCandidate({ name: "c", tasks: ["audit"] }),
      makeCandidate({ name: "d", tasks: ["audit"] }),
    ];
    const classified = classifyTask("audit issue 330");
    const result = selectCandidates(candidates, classified);
    expect(result.selected).toHaveLength(3);
  });

  it("honors configured max selected skills", () => {
    const candidates = [
      makeCandidate({ name: "a", tasks: ["audit"] }),
      makeCandidate({ name: "b", tasks: ["audit"] }),
      makeCandidate({ name: "c", tasks: ["audit"] }),
    ];
    const classified = classifyTask("audit issue 330");
    const result = selectCandidates(candidates, classified, {
      maxSelectedSkills: 2,
    });
    expect(result.selected).toHaveLength(2);
    expect(result.excluded.some((candidate) => candidate.name === "c")).toBe(true);
  });

  it("honors configured max prompt tokens", () => {
    const classified = classifyTask(
      "audit issue 330 with a deliberately verbose task description that should be compacted when the prompt budget is small",
    );
    const result = selectCandidates([], classified, {
      maxPromptTokens: 20,
      defaultBranch: "dev",
    });

    expect(estimateTokens(result.prompt)).toBeLessThanOrEqual(20);
    expect(result.prompt).toContain("20 tokens");
  });

  it("can disable low-token scoring bonus", () => {
    const small = makeCandidate({ name: "tiny", tasks: ["audit"], estimatedTokens: 50 });
    const large = makeCandidate({ name: "large", tasks: ["audit"], estimatedTokens: 2000 });
    const classified = classifyTask("audit issue 330");

    expect(scoreCandidate(small, classified, { preferLowTokenSkills: false }).score).toBe(
      scoreCandidate(large, classified, { preferLowTokenSkills: false }).score,
    );
  });

  it("excludes candidates with zero score", () => {
    const candidates = [
      makeCandidate({ name: "relevant", tasks: ["audit"] }),
      makeCandidate({ name: "irrelevant", tasks: ["deploy", "release"] }),
    ];
    const classified = classifyTask("audit issue 330");
    const result = selectCandidates(candidates, classified);
    expect(result.selected.every((c) => c.score > 0)).toBe(true);
    expect(result.excluded.some((c) => c.name === "irrelevant")).toBe(true);
  });

  it("marks selected candidates as selected=true", () => {
    const candidates = [makeCandidate({ name: "a", tasks: ["audit"] })];
    const result = selectCandidates(candidates, classifyTask("audit issue 330"));
    expect(result.selected[0]?.selected).toBe(true);
  });

  it("marks excluded candidates as selected=false", () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      makeCandidate({ name: `skill-${i}`, tasks: ["audit"] }),
    );
    const result = selectCandidates(candidates, classifyTask("audit issue 330"));
    expect(result.excluded.every((c) => c.selected === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatSuggestText
// ---------------------------------------------------------------------------

describe("formatSuggestText", () => {
  const classified = classifyTask("audit issue 330");

  function makeResult(overrides: Partial<SuggestResult> = {}): SuggestResult {
    const selected = overrides.selected ?? [];
    return {
      input: "audit issue 330",
      classification: classified,
      selected,
      excluded: [],
      route: "audit",
      prompt: buildPrompt("audit issue 330", "audit", selected),
      estimatedAvoidedContext: { selectedTokens: 0, excludedTokens: 0, estimatedAvoidedTokens: 0 },
      ...overrides,
    };
  }

  it("is compact — no full skill body", () => {
    const selected: ScoredSuggestCandidate[] = [
      {
        ...makeCandidate({ name: "repo-audit", tasks: ["audit"] }),
        score: 65,
        selected: true,
        reasons: ["task matches category \"audit\""],
        exclusions: [],
      },
    ];
    const lines = formatSuggestText(makeResult({ selected }));
    expect(lines.join("\n").length).toBeLessThan(500);
  });

  it("includes primary category", () => {
    const lines = formatSuggestText(makeResult());
    expect(lines.some((l) => l.includes("audit"))).toBe(true);
  });

  it("shows no-candidates message when selected is empty", () => {
    const lines = formatSuggestText(makeResult());
    expect(lines.some((l) => l.includes("No relevant"))).toBe(true);
  });

  it("shows selected candidate name and score", () => {
    const selected: ScoredSuggestCandidate[] = [
      {
        ...makeCandidate({ name: "repo-audit", tasks: ["audit"] }),
        score: 65,
        selected: true,
        reasons: ["task matches category \"audit\""],
        exclusions: [],
      },
    ];
    const lines = formatSuggestText(makeResult({ selected }));
    expect(lines.some((l) => l.includes("repo-audit"))).toBe(true);
    expect(lines.some((l) => l.includes("65"))).toBe(true);
  });

  it("shows excluded count", () => {
    const excluded: ScoredSuggestCandidate[] = [
      {
        ...makeCandidate({ name: "unrelated", tasks: [] }),
        score: 0,
        selected: false,
        reasons: [],
        exclusions: [],
      },
    ];
    const lines = formatSuggestText(makeResult({ excluded }));
    expect(lines.some((l) => l.includes("Excluded"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CLI integration — suggest command
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe("suggest command — text output", () => {
  it("prints compact text output", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createProgram().parseAsync(["node", "agentctx", "suggest", "audit issue 330 against dev"]);
    expect(log).toHaveBeenCalled();
    const output = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("audit");
    expect(output).toContain("Task category:");
  });
});

describe("suggest command — JSON output", () => {
  it("outputs valid JSON with classification and scoring fields", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createProgram().parseAsync(["node", "agentctx", "suggest", "review PR 21", "--json"]);
    expect(log).toHaveBeenCalledOnce();
    const parsed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(parsed).toMatchObject({
      input: "review PR 21",
      classification: {
        primaryCategory: expect.any(String),
        categories: expect.any(Array),
      },
      selected: expect.any(Array),
      excluded: expect.any(Array),
    });
  });

  it("JSON selected candidates include score and reasons", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createProgram().parseAsync(["node", "agentctx", "suggest", "audit issue 330", "--json"]);
    const parsed = JSON.parse(String(log.mock.calls[0]?.[0]));
    for (const c of parsed.selected as unknown[]) {
      expect(c).toMatchObject({
        name: expect.any(String),
        score: expect.any(Number),
        reasons: expect.any(Array),
        estimatedTokens: expect.any(Number),
        penalties: expect.any(Array),
      });
    }
  });

  it("JSON output includes prompt, route, and estimatedAvoidedContext", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createProgram().parseAsync(["node", "agentctx", "suggest", "review PR 344 for security issues", "--json"]);
    const parsed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(parsed).toMatchObject({
      prompt: expect.any(String),
      route: expect.any(String),
      estimatedAvoidedContext: {
        selectedTokens: expect.any(Number),
        excludedTokens: expect.any(Number),
        estimatedAvoidedTokens: expect.any(Number),
      },
    });
  });

  it("JSON review prompt is compact and does not include full skill body", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createProgram().parseAsync(["node", "agentctx", "suggest", "review PR 344 for security issues", "--json"]);
    const parsed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(typeof parsed.prompt).toBe("string");
    expect(parsed.prompt.length).toBeLessThan(1400);
    expect(parsed.route).toBe("review");
  });

  it("JSON audit prompt targets correct route", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createProgram().parseAsync(["node", "agentctx", "suggest", "audit issue 330 against dev", "--json"]);
    const parsed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(parsed.route).toBe("audit");
    expect(parsed.prompt).toContain("audit issue 330 against dev");
  });
});

// ---------------------------------------------------------------------------
// Prompt templates — all six categories
// ---------------------------------------------------------------------------

describe("prompt templates — all six categories covered", () => {
  const tasksByCat: Record<string, string> = {
    audit: "audit issue 330 against dev",
    review: "review PR 344 for security issues",
    implement: "implement the new suggest command",
    docs: "write documentation for the API",
    debug: "debug the failing test",
    planning: "plan the roadmap for Q3",
  };

  for (const [category, task] of Object.entries(tasksByCat)) {
    it(`${category} category produces a non-empty prompt`, () => {
      const classified = classifyTask(task);
      const result = selectCandidates([], classified);
      expect(result.route).toBe(category);
      expect(result.prompt.length).toBeGreaterThan(0);
      expect(result.prompt).toContain(task);
    });
  }
});

// ---------------------------------------------------------------------------
// formatSuggestText — new fields
// ---------------------------------------------------------------------------

describe("formatSuggestText — estimated avoided context", () => {
  it("includes estimated avoided context line", () => {
    const classified = classifyTask("audit issue 330");
    const result = selectCandidates([], classified);
    const lines = formatSuggestText(result);
    expect(lines.some((l) => l.includes("Estimated avoided context"))).toBe(true);
  });

  it("avoided context sums excluded tokens", () => {
    const candidates = [
      makeCandidate({ name: "a", tasks: ["audit"], estimatedTokens: 100 }),
      makeCandidate({ name: "b", tasks: ["audit"], estimatedTokens: 200 }),
      makeCandidate({ name: "c", tasks: ["audit"], estimatedTokens: 150 }),
      makeCandidate({ name: "d", tasks: ["audit"], estimatedTokens: 300 }),
    ];
    const classified = classifyTask("audit issue 330");
    const result = selectCandidates(candidates, classified);
    expect(result.estimatedAvoidedContext.estimatedAvoidedTokens).toBe(
      result.estimatedAvoidedContext.excludedTokens,
    );
    const excludedSum = result.excluded.reduce((s, c) => s + c.estimatedTokens, 0);
    expect(result.estimatedAvoidedContext.excludedTokens).toBe(excludedSum);
  });
});

describe("formatSuggestText — suggested prompt", () => {
  it("includes suggested prompt section", () => {
    const classified = classifyTask("audit issue 330");
    const result = selectCandidates([], classified);
    const lines = formatSuggestText(result);
    expect(lines.some((l) => l.includes("Suggested prompt"))).toBe(true);
  });

  it("text output does not include full skill body (compact check)", () => {
    const candidates = [
      makeCandidate({ name: "repo-audit", tasks: ["audit"], estimatedTokens: 100 }),
    ];
    const classified = classifyTask("audit issue 330");
    const result = selectCandidates(candidates, classified);
    const output = formatSuggestText(result).join("\n");
    expect(output.length).toBeLessThan(700);
  });
});
