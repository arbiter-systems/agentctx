import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildDoctorReport, formatDoctorText } from "../src/cli.js";
import {
  detectMissingGuidance,
  MIN_TOTAL_ESTIMATED_TOKENS,
  MIN_TOTAL_SOURCES,
} from "../src/missingGuidance.js";

const fixturesRoot = path.resolve("fixtures/findings/missing-guidance");
const largeNeutralGuidance = Array.from(
  { length: 30 },
  (_, index) =>
    `Operational note ${index}: keep repository instructions clear, stable, and easy to scan during routine agent work.`,
).join("\n");
const completeRootGuidance = [
  "# Workflow",
  "",
  "Always branch from dev.",
  "Open PR to dev.",
  "Use bounded validation with scoped tests.",
  "Ask before destructive commands.",
  "",
].join("\n");

function missingFindingsFor(report: Awaited<ReturnType<typeof buildDoctorReport>>) {
  return report.findings.filter((finding) => finding.code.startsWith("missing-"));
}

async function missingCodes(fixture: string): Promise<Set<string>> {
  return withPreparedGuidanceFixture(fixture, async (fixtureRoot) => {
    const report = await buildDoctorReport(fixtureRoot);
    return new Set(missingFindingsFor(report).map((finding) => finding.code));
  });
}

async function withPreparedGuidanceFixture<T>(
  fixture: string,
  run: (fixtureRoot: string) => Promise<T>,
): Promise<T> {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "instructov-missing-guidance-"));

  try {
    await cp(path.join(fixturesRoot, fixture), fixtureRoot, { recursive: true });
    if (fixture !== "tiny") {
      await writeFile(path.join(fixtureRoot, "GEMINI.md"), largeNeutralGuidance);
    }
    return await run(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

async function withSkillFixture<T>(
  skillText: string,
  run: (fixtureRoot: string) => Promise<T>,
): Promise<T> {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "instructov-missing-skill-"));

  try {
    await mkdir(path.join(fixtureRoot, "skills", "review"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "AGENTS.md"), completeRootGuidance);
    await writeFile(
      path.join(fixtureRoot, "skills", "review", "SKILL.md"),
      skillText,
    );

    return await run(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

describe("missing guidance findings", () => {
  it("exports conservative internal noise thresholds", () => {
    expect(MIN_TOTAL_SOURCES).toBe(2);
    expect(MIN_TOTAL_ESTIMATED_TOKENS).toBe(300);
  });

  it("does not warn for a tiny repo with one small instruction file", async () => {
    const codes = await missingCodes("tiny");

    expect(codes).toEqual(new Set());
  });

  it("detects missing branch guidance", async () => {
    const codes = await missingCodes("missing-branch");

    expect(codes.has("missing-branch-guidance")).toBe(true);
    expect(codes.has("missing-pr-guidance")).toBe(false);
    expect(codes.has("missing-validation-guidance")).toBe(false);
    expect(codes.has("missing-destructive-command-guidance")).toBe(false);
  });

  it("detects missing PR target guidance", async () => {
    const codes = await missingCodes("missing-pr");

    expect(codes.has("missing-pr-guidance")).toBe(true);
    expect(codes.has("missing-branch-guidance")).toBe(false);
    expect(codes.has("missing-validation-guidance")).toBe(false);
    expect(codes.has("missing-destructive-command-guidance")).toBe(false);
  });

  it("detects missing bounded validation guidance without counting risky validation language", async () => {
    const codes = await missingCodes("missing-validation");

    expect(codes.has("missing-validation-guidance")).toBe(true);
    expect(codes.has("missing-branch-guidance")).toBe(false);
    expect(codes.has("missing-pr-guidance")).toBe(false);
    expect(codes.has("missing-destructive-command-guidance")).toBe(false);
  });

  it("detects missing destructive command safety guidance", async () => {
    const codes = await missingCodes("missing-destructive");

    expect(codes.has("missing-destructive-command-guidance")).toBe(true);
    expect(codes.has("missing-branch-guidance")).toBe(false);
    expect(codes.has("missing-pr-guidance")).toBe(false);
    expect(codes.has("missing-validation-guidance")).toBe(false);
  });

  it("does not emit global missing guidance when all core guidance is present", async () => {
    const codes = await missingCodes("complete");

    expect(codes).toEqual(new Set());
  });

  it("detects SKILL.md missing purpose", async () => {
    await withSkillFixture(
      [
        "# Review Helper",
        "",
        "When to use: review pull request feedback and identify required changes.",
        "Tasks: inspect comments, summarize decisions, and prepare edits.",
        "",
      ].join("\n"),
      async (fixtureRoot) => {
        const report = await buildDoctorReport(fixtureRoot);
        const skillFinding = report.findings.find(
          (finding) => finding.code === "missing-skill-purpose",
        );

        expect(skillFinding).toMatchObject({
          severity: "low",
          sourcePath: "skills/review/SKILL.md",
          hint: expect.any(String),
        });
        expect(report.findings.some((finding) => finding.code === "missing-skill-trigger")).toBe(false);
      },
    );
  });

  it("detects SKILL.md missing trigger guidance", async () => {
    await withSkillFixture(
      [
        "# Review Helper",
        "",
        "Description: Helps review pull request feedback and identify required changes.",
        "Summary: Reviews comments and prepares scoped edits.",
        "",
      ].join("\n"),
      async (fixtureRoot) => {
        const report = await buildDoctorReport(fixtureRoot);
        const skillFinding = report.findings.find(
          (finding) => finding.code === "missing-skill-trigger",
        );

        expect(skillFinding).toMatchObject({
          severity: "low",
          sourcePath: "skills/review/SKILL.md",
          hint: expect.any(String),
        });
        expect(report.findings.some((finding) => finding.code === "missing-skill-purpose")).toBe(false);
      },
    );
  });

  it("does not emit skill missing findings when purpose and trigger are present", async () => {
    await withSkillFixture(
      [
        "# Review Helper",
        "",
        "Description: Helps review pull request feedback and identify required changes.",
        "When to use: use when a pull request has actionable review comments.",
        "",
      ].join("\n"),
      async (fixtureRoot) => {
        const report = await buildDoctorReport(fixtureRoot);
        const codes = new Set(missingFindingsFor(report).map((finding) => finding.code));

        expect(codes.has("missing-skill-purpose")).toBe(false);
        expect(codes.has("missing-skill-trigger")).toBe(false);
      },
    );
  });

  it("skips the global guidance check when a mix of read failures and small sources keeps total tokens low", () => {
    const findings = detectMissingGuidance({
      sources: [
        { path: "AGENTS.md", kind: "agents", scopePath: ".", bytes: 0, estimatedTokens: 0 },
        { path: "CLAUDE.md", kind: "claude", scopePath: ".", bytes: 200, estimatedTokens: 50 },
      ],
      sections: [
        {
          sourcePath: "CLAUDE.md",
          heading: "(root)",
          text: "This guidance has no branch, PR, validation, or destructive command language.",
          normalizedText: "this guidance has no branch pr validation or destructive command language",
          lineStart: 1,
          lineEnd: 1,
          estimatedTokens: 50,
        },
      ],
    });

    expect(findings.filter((finding) => finding.code.startsWith("missing-"))).toEqual([]);
  });

  it("shows missing guidance under warnings in compact human output", async () => {
    await withPreparedGuidanceFixture("missing-branch", async (fixtureRoot) => {
      const report = await buildDoctorReport(fixtureRoot);
      const outputLines = formatDoctorText(report);
      const output = outputLines.join("\n");

      expect(output).toContain("Warnings:");
      expect(output).toContain("missing-branch-guidance .");
      expect(output).not.toContain("PR target is dev.");
      expect(outputLines.length).toBeLessThanOrEqual(30);
    });
  });
});
