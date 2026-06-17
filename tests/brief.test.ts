import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildBriefResult,
  formatBriefText,
  type BriefGuidance,
  type BriefResult,
} from "../src/brief.js";
import { createProgram } from "../src/cli.js";
import { buildSuggestResultForTask, selectCandidates } from "../src/suggest.js";

async function withBriefFixture<T>(run: (fixtureRoot: string) => Promise<T>): Promise<T> {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "agentctx-brief-"));

  try {
    await mkdir(path.join(fixtureRoot, "skills", "security-review"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "skills", "repo-audit"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "skills", "docs"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "skills", "debug"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "skills", "security-review", "SKILL.md"),
      [
        "---",
        "name: security-review",
        "summary: Review code changes for security defects.",
        "tasks: [review]",
        "triggers: [review PR, security]",
        "---",
        "# Security Review",
        "FULL SKILL BODY SECRET: inspect authentication and authorization details.",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "skills", "repo-audit", "SKILL.md"),
      [
        "---",
        "name: repo-audit",
        "summary: Audit implementation against issue requirements.",
        "tasks: [audit, implement, planning]",
        "triggers: [audit issue, implement, plan]",
        "---",
        "# Repo Audit",
        "Audit issue state against dev.",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "skills", "docs", "SKILL.md"),
      [
        "---",
        "name: docs",
        "summary: Update documentation.",
        "tasks: [docs]",
        "triggers: [docs, documentation]",
        "---",
        "# Docs",
        "Keep documentation accurate.",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "skills", "debug", "SKILL.md"),
      [
        "---",
        "name: debug",
        "summary: Investigate failures.",
        "tasks: [debug]",
        "triggers: [debug, failing]",
        "---",
        "# Debug",
        "Investigate failures systematically.",
        "",
      ].join("\n"),
    );

    return await run(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

function guidance(index: number): BriefGuidance {
  return {
    path: `skills/${index}/SKILL.md`,
    name: `skill-${index}`,
    reason: `reason ${index}`,
    estimatedTokens: 100,
    reasons: [`reason ${index}`],
    exclusions: [],
  };
}

describe("brief command", () => {
  it("emits a compact task briefing", async () => {
    await withBriefFixture(async (fixtureRoot) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.spyOn(process, "cwd").mockReturnValue(fixtureRoot);

      await createProgram().parseAsync([
        "node",
        "agentctx",
        "brief",
        "review PR 31 for security",
      ]);

      const output = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain("Task briefing");
      expect(output).toContain("Selected guidance:");
      expect(output).toContain("Excluded guidance:");
      expect(output).toContain("Suggested prompt:");
      expect(output).toContain("Estimated avoided context:");
      expect(output).toContain("skills/security-review/SKILL.md");
      expect(output).not.toContain("FULL SKILL BODY SECRET");
      expect(output.length).toBeLessThan(1000);
    });
  });

  it("outputs JSON with briefing fields and reasons", async () => {
    await withBriefFixture(async (fixtureRoot) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.spyOn(process, "cwd").mockReturnValue(fixtureRoot);

      await createProgram().parseAsync([
        "node",
        "agentctx",
        "brief",
        "review PR 31 for security",
        "--json",
      ]);

      const parsed = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(parsed).toMatchObject({
        command: "brief",
        task: "review PR 31 for security",
        selectedGuidance: expect.any(Array),
        excludedGuidance: expect.any(Array),
        prompt: expect.any(String),
        route: "review",
        estimatedAvoidedContext: {
          selectedTokens: expect.any(Number),
          excludedTokens: expect.any(Number),
          estimatedAvoidedTokens: expect.any(Number),
        },
      });
      expect(parsed.selectedGuidance[0]).toMatchObject({
        path: expect.any(String),
        name: expect.any(String),
        reason: expect.any(String),
        estimatedTokens: expect.any(Number),
        reasons: expect.any(Array),
        exclusions: expect.any(Array),
      });
      expect(JSON.stringify(parsed)).not.toContain("FULL SKILL BODY SECRET");
    });
  });

  it("supports all task category routes", async () => {
    await withBriefFixture(async (fixtureRoot) => {
      const tasksByRoute = {
        review: "review PR 31 for security",
        audit: "audit issue 36 against dev",
        implement: "implement compact task briefing",
        docs: "write documentation for the brief command",
        debug: "debug the failing test",
        planning: "plan the implementation sequence",
      };

      for (const [route, task] of Object.entries(tasksByRoute)) {
        const result = buildBriefResult(await buildSuggestResultForTask(fixtureRoot, task));
        expect(result.route).toBe(route);
        expect(result.prompt).toContain(task);
      }
    });
  });

  it("does not create a cache file while building brief input", async () => {
    await withBriefFixture(async (fixtureRoot) => {
      await buildSuggestResultForTask(fixtureRoot, "review PR 31 for security");

      await expect(
        readFile(path.join(fixtureRoot, ".agentctx", "cache.json"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
});

describe("brief formatting", () => {
  it("includes selected, excluded, prompt, and avoided-context sections", () => {
    const result: BriefResult = {
      command: "brief",
      task: "review PR 31",
      selectedGuidance: [guidance(1)],
      excludedGuidance: [guidance(2)],
      prompt: "Review: review PR 31",
      route: "review",
      estimatedAvoidedContext: {
        selectedTokens: 100,
        excludedTokens: 200,
        estimatedAvoidedTokens: 200,
      },
    };

    const output = formatBriefText(result, {
      selectedLimit: 2,
      excludedLimit: 2,
    }).join("\n");

    expect(output).toContain("Selected guidance:");
    expect(output).toContain("Excluded guidance:");
    expect(output).toContain("Suggested prompt:");
    expect(output).toContain("Estimated avoided context: ~200 tokens");
  });

  it("caps selected and excluded guidance in human output", () => {
    const result: BriefResult = {
      command: "brief",
      task: "review PR 31",
      selectedGuidance: [guidance(1), guidance(2)],
      excludedGuidance: [guidance(3), guidance(4), guidance(5), guidance(6)],
      prompt: "Review: review PR 31",
      route: "review",
      estimatedAvoidedContext: {
        selectedTokens: 200,
        excludedTokens: 400,
        estimatedAvoidedTokens: 400,
      },
    };

    const output = formatBriefText(result, {
      selectedLimit: 2,
      excludedLimit: 2,
    }).join("\n");

    expect(output).toContain("skills/3/SKILL.md");
    expect(output).toContain("skills/4/SKILL.md");
    expect(output).not.toContain("skills/5/SKILL.md");
    expect(output).toContain("... 2 more omitted.");
  });

  it("uses suggest scoring output instead of duplicating routing logic", () => {
    const suggestResult = selectCandidates(
      [
        {
          sourcePath: "skills/security/SKILL.md",
          name: "security",
          tasks: ["review"],
          triggers: ["security"],
          pathApplicability: [],
          estimatedTokens: 100,
          penalties: [],
        },
      ],
      {
        input: "review PR 31 for security",
        primaryCategory: "review",
        categories: [],
      },
    );

    const result = buildBriefResult(suggestResult);

    expect(result.route).toBe(suggestResult.route);
    expect(result.prompt).toBe(suggestResult.prompt);
    expect(result.estimatedAvoidedContext).toBe(suggestResult.estimatedAvoidedContext);
    expect(result.selectedGuidance[0]?.reasons).toEqual(
      suggestResult.selected[0]?.reasons,
    );
  });
});
