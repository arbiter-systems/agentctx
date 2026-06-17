import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildContextBudgetReport,
  formatBudgetText,
} from "../src/budget.js";
import { buildDoctorReport, createProgram, formatDoctorText } from "../src/cli.js";
import type { Finding } from "../src/findings.js";

function finding(
  code: Finding["code"],
  estimatedAvoidableTokens: number | undefined,
  sourcePath: string,
): Finding {
  return {
    code,
    severity: "medium",
    message: `${code} message`,
    sourcePath,
    ...(estimatedAvoidableTokens === undefined
      ? {}
      : { estimatedAvoidableTokens }),
  };
}

async function withInstructionFixture<T>(
  run: (fixtureRoot: string) => Promise<T>,
): Promise<T> {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "agentctx-budget-"));
  try {
    await writeFile(
      path.join(fixtureRoot, "AGENTS.md"),
      [
        "# Agent",
        "",
        ...Array.from(
          { length: 120 },
          () => "Repeat focused guidance to create approximate token budget pressure.",
        ),
        "",
      ].join("\n"),
    );
    await mkdir(path.join(fixtureRoot, "skills", "review"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "skills", "review", "SKILL.md"),
      [
        "---",
        "name: review",
        "summary: Review pull requests.",
        "tasks: [review]",
        "triggers: [review PR]",
        "---",
        "# Review",
        "Use compact review guidance.",
        "",
      ].join("\n"),
    );
    return await run(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("buildContextBudgetReport", () => {
  it("reports over-budget status", () => {
    expect(buildContextBudgetReport({
      tokens: 100,
      estimatedTokens: 140,
    })).toMatchObject({
      tokens: 100,
      estimatedTokens: 140,
      deltaTokens: 40,
      status: "over",
      approximate: true,
    });
  });

  it("reports under-budget status", () => {
    expect(buildContextBudgetReport({
      tokens: 150,
      estimatedTokens: 100,
    })).toMatchObject({
      deltaTokens: -50,
      status: "under",
    });
  });

  it("reports exact-budget status", () => {
    expect(buildContextBudgetReport({
      tokens: 100,
      estimatedTokens: 100,
    })).toMatchObject({
      deltaTokens: 0,
      status: "exact",
    });
  });

  it("sorts top savings by estimated avoidable tokens", () => {
    const report = buildContextBudgetReport({
      tokens: 100,
      estimatedTokens: 200,
      findings: [
        finding("duplicate-guidance", 20, "AGENTS.md"),
        finding("oversized-source", 80, "CLAUDE.md"),
        finding("duplicate-command", 40, "GEMINI.md"),
      ],
    });

    expect(report.topSavings.map((saving) => saving.estimatedAvoidableTokens))
      .toEqual([80, 40, 20]);
  });

  it("returns empty top savings when findings have no avoidable token estimates", () => {
    const report = buildContextBudgetReport({
      tokens: 100,
      estimatedTokens: 200,
      findings: [finding("risky-validation-command", undefined, "AGENTS.md")],
    });

    expect(report.topSavings).toEqual([]);
  });

  it("formats approximate compact budget text without model-specific tokenizer claims", () => {
    const text = formatBudgetText(buildContextBudgetReport({
      tokens: 100,
      estimatedTokens: 140,
      findings: [finding("duplicate-guidance", 20, "AGENTS.md")],
    })).join("\n");

    expect(text).toContain("Estimated instruction context: ~140 tokens");
    expect(text).toContain("Budget: ~100 tokens");
    expect(text).toContain("Over budget by: ~40 tokens");
    expect(text).not.toMatch(/OpenAI|Anthropic|Gemini|exact token/i);
  });
});

describe("doctor budget CLI", () => {
  it("includes approximate budget section in text output", async () => {
    await withInstructionFixture(async (fixtureRoot) => {
      const report = await buildDoctorReport(fixtureRoot, { budgetTokens: 400 });
      const output = formatDoctorText(report).join("\n");

      expect(output).toContain("Context budget");
      expect(output).toContain("Estimated instruction context: ~");
      expect(output).toContain("Budget: ~400 tokens");
      expect(output).toMatch(/(Over|Under) budget by: ~/);
    });
  });

  it("includes required budget fields in JSON output", async () => {
    await withInstructionFixture(async (fixtureRoot) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.spyOn(process, "cwd").mockReturnValue(fixtureRoot);

      await createProgram().parseAsync([
        "node",
        "agentctx",
        "doctor",
        "--budget",
        "400",
        "--json",
      ]);

      const parsed = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(parsed.budget).toMatchObject({
        tokens: 400,
        estimatedTokens: expect.any(Number),
        deltaTokens: expect.any(Number),
        topSavings: expect.any(Array),
        approximate: true,
      });
    });
  });

  it("does not include budget field or text without budget option", async () => {
    await withInstructionFixture(async (fixtureRoot) => {
      const report = await buildDoctorReport(fixtureRoot);
      const output = formatDoctorText(report).join("\n");

      expect(report.budget).toBeUndefined();
      expect(output).not.toContain("Context budget");
    });
  });

  it("sets exit code 2 for invalid budget values", async () => {
    await withInstructionFixture(async (fixtureRoot) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(process, "cwd").mockReturnValue(fixtureRoot);

      await createProgram().parseAsync([
        "node",
        "agentctx",
        "doctor",
        "--budget",
        "0",
      ]);

      expect(process.exitCode).toBe(2);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("positive integer"));
    });
  });
});

describe("brief budget CLI", () => {
  it("includes task-specific budget pressure when brief budget is supplied", async () => {
    await withInstructionFixture(async (fixtureRoot) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.spyOn(process, "cwd").mockReturnValue(fixtureRoot);

      await createProgram().parseAsync([
        "node",
        "agentctx",
        "brief",
        "review PR 31",
        "--budget",
        "50",
      ]);

      const output = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain("Context budget");
      expect(output).toContain("Estimated instruction context: ~");
      expect(output).toContain("Budget: ~50 tokens");
    });
  });

  it("includes budget structure in brief JSON", async () => {
    await withInstructionFixture(async (fixtureRoot) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.spyOn(process, "cwd").mockReturnValue(fixtureRoot);

      await createProgram().parseAsync([
        "node",
        "agentctx",
        "brief",
        "review PR 31",
        "--budget",
        "50",
        "--json",
      ]);

      const parsed = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(parsed.budget).toMatchObject({
        tokens: 50,
        estimatedTokens: expect.any(Number),
        deltaTokens: expect.any(Number),
        topSavings: expect.any(Array),
        approximate: true,
      });
    });
  });
});
