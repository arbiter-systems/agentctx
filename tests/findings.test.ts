import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildDoctorReport, formatDoctorText } from "../src/cli.js";
import { extractConflictSignals } from "../src/findings.js";
import { extractCommands, parseSections } from "../src/parser.js";

const fixturesRoot = path.resolve("fixtures/findings");
const duplicatedGuidance =
  "Always run npm test before pushing changes to shared branches.";
const duplicateCommand =
  "Run the deterministic validation command from inside this fenced block only.\nnpm test";
const oversizedSentence =
  "This oversized skill guidance sentence is intentionally verbose so the deterministic token estimator crosses the default threshold for source and section findings.";

async function withFindingsFixture<T>(
  run: (fixtureRoot: string) => Promise<T>,
): Promise<T> {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "agentctx-findings-"));

  try {
    await mkdir(path.join(fixtureRoot, "skills", "large"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "AGENTS.md"),
      [
        "# Validation",
        duplicatedGuidance,
        "```bash",
        duplicateCommand,
        "```",
        "## Repeated Heading",
        "Keep local guidance focused.",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "CLAUDE.md"),
      [
        "# Validation",
        duplicatedGuidance,
        "```bash",
        duplicateCommand,
        "```",
        "## Repeated Heading",
        "Keep assistant guidance focused.",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "GEMINI.md"),
      [
        "# Medium Oversized Source",
        ...Array.from({ length: 40 }, () => oversizedSentence),
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "skills", "large", "SKILL.md"),
      [
        "# Oversized Skill",
        ...Array.from({ length: 110 }, () => oversizedSentence),
        "",
      ].join("\n"),
    );

    return await run(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

describe("doctor findings", () => {
  it("detects duplicate guidance, commands, headings, and oversized guidance", async () => {
    await withFindingsFixture(async (fixtureRoot) => {
      const report = await buildDoctorReport(fixtureRoot);
      const codes = new Set(report.findings.map((finding) => finding.code));

      expect(codes.has("duplicate-guidance")).toBe(true);
      expect(codes.has("duplicate-command")).toBe(true);
      expect(codes.has("duplicate-heading")).toBe(true);
      expect(codes.has("oversized-source")).toBe(true);
      expect(codes.has("oversized-section")).toBe(true);
      expect(codes.has("high-token-waste-source")).toBe(true);
    });
  });

  it("adds estimated avoidable tokens to the summary", async () => {
    await withFindingsFixture(async (fixtureRoot) => {
      const report = await buildDoctorReport(fixtureRoot);
      const findingTotal = report.findings.reduce(
        (total, finding) => total + (finding.estimatedAvoidableTokens ?? 0),
        0,
      );

      expect(report.summary.estimatedAvoidableTokens).toBe(findingTotal);
      expect(report.summary.estimatedAvoidableTokens).toBeGreaterThan(0);
      expect(report.summary.findingCount).toBe(report.findings.length);
    });
  });

  it("keeps default human output compact and omits duplicated body text", async () => {
    await withFindingsFixture(async (fixtureRoot) => {
      const report = await buildDoctorReport(fixtureRoot);
      const output = formatDoctorText(report).join("\n");

      expect(output).toContain("Detected ");
      expect(output).toContain("Estimated avoidable waste:");
      expect(output).not.toContain(duplicatedGuidance);
      expect(output).not.toContain(oversizedSentence);
      expect(output.split("\n").length).toBeLessThanOrEqual(30);
    });
  });

  it("does not treat fenced command text as duplicate guidance", async () => {
    await withFindingsFixture(async (fixtureRoot) => {
      const report = await buildDoctorReport(fixtureRoot);
      const duplicateGuidanceFindings = report.findings.filter(
        (finding) => finding.code === "duplicate-guidance",
      );

      expect(
        duplicateGuidanceFindings.some((finding) =>
          finding.sourcePath === "CLAUDE.md" && finding.lineStart === 4,
        ),
      ).toBe(false);
    });
  });

  it("does not double-emit oversized-source for high-token-waste sources", async () => {
    await withFindingsFixture(async (fixtureRoot) => {
      const report = await buildDoctorReport(fixtureRoot);
      const largeSkillFindings = report.findings.filter(
        (finding) => finding.sourcePath === "skills/large/SKILL.md",
      );

      expect(
        largeSkillFindings.some((finding) => finding.code === "high-token-waste-source"),
      ).toBe(true);
      expect(
        largeSkillFindings.some((finding) => finding.code === "oversized-source"),
      ).toBe(false);
    });
  });

  it("includes complete finding records in JSON output", async () => {
    await withFindingsFixture(async (fixtureRoot) => {
      const output = structuredClone(
        await buildDoctorReport(fixtureRoot),
      );
      expect(output.findings.length).toBeGreaterThan(0);
      expect(output.findings[0]).toMatchObject({
        code: expect.any(String),
        severity: expect.any(String),
        message: expect.any(String),
        sourcePath: expect.any(String),
      });
      expect(output.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "duplicate-command",
            relatedSources: expect.any(Array),
            estimatedAvoidableTokens: expect.any(Number),
          }),
        ]),
      );
    });
  });

  it("detects risky validation language and unbounded commands", async () => {
    const report = await buildDoctorReport(path.join(fixturesRoot, "risky-validation"));
    const findAt = (code: string, lineStart: number) =>
      report.findings.find((f) => f.code === code && f.lineStart === lineStart);

    expect(findAt("risky-validation-command", 3)).toMatchObject({
      code: "risky-validation-command",
      severity: "high",
      sourcePath: "AGENTS.md",
      matchedText: "clean validation",
      hint: expect.any(String),
    });
    expect(findAt("risky-validation-command", 4)).toMatchObject({
      code: "risky-validation-command",
      severity: "high",
    });
    expect(findAt("risky-validation-command", 5)).toMatchObject({
      severity: "low",
      matchedText: "Run all checks",
    });
    expect(findAt("full-repo-format-command", 6)).toMatchObject({
      code: "full-repo-format-command",
      severity: "high",
      message: expect.any(String),
    });
    expect(findAt("restore-heavy-command", 8)).toMatchObject({
      code: "restore-heavy-command",
      severity: "medium",
      matchedText: "dotnet test",
    });
    expect(findAt("unbounded-command", 10)).toMatchObject({
      code: "unbounded-command",
      severity: "medium",
      matchedText: "npm test",
    });
    expect(findAt("unbounded-command", 12)).toMatchObject({
      code: "unbounded-command",
      severity: "medium",
      matchedText: "pnpm test",
    });
    expect(findAt("unbounded-command", 14)).toMatchObject({
      code: "unbounded-command",
      severity: "medium",
      matchedText: "yarn test",
    });
    expect(findAt("restore-heavy-command", 16)).toMatchObject({
      code: "restore-heavy-command",
      severity: "medium",
      matchedText: "dotnet restore",
    });
    expect(findAt("restore-heavy-command", 17)).toMatchObject({
      code: "restore-heavy-command",
      severity: "medium",
      matchedText: "npm install",
    });
    expect(findAt("restore-heavy-command", 18)).toMatchObject({
      code: "restore-heavy-command",
      severity: "medium",
      matchedText: "pnpm install",
    });
    expect(findAt("restore-heavy-command", 19)).toMatchObject({
      code: "restore-heavy-command",
      severity: "medium",
      matchedText: "yarn install",
    });
  });

  it("does not flag bounded commands or negated risky guidance", async () => {
    const report = await buildDoctorReport(path.join(fixturesRoot, "risky-validation"));
    const matchedTexts = new Set(
      report.findings.map((finding) => finding.matchedText),
    );

    expect(matchedTexts.has("dotnet format --include path/to/file.cs")).toBe(false);
    expect(matchedTexts.has("dotnet test --no-restore")).toBe(false);
    expect(matchedTexts.has("npm test -- path/to/test")).toBe(false);
    expect(matchedTexts.has("pnpm test --filter package-name")).toBe(false);
    expect(matchedTexts.has("yarn test path/to/test")).toBe(false);
    expect(matchedTexts.has("full validation")).toBe(false);
    expect(matchedTexts.has("run all tests")).toBe(false);
    expect(
      report.findings.some(
        (finding) => finding.code === "unbounded-command" && finding.lineStart === 21,
      ),
    ).toBe(false);
    expect(matchedTexts.has("recursive")).toBe(false);
  });

  it("prioritizes high-risk validation findings in compact human output", async () => {
    const report = await buildDoctorReport(path.join(fixturesRoot, "risky-validation"));
    const outputLines = formatDoctorText(report);
    const output = outputLines.join("\n");
    const highIndex = outputLines.indexOf("high:");
    const mediumIndex = outputLines.indexOf("medium:");

    expect(highIndex).toBeGreaterThanOrEqual(0);
    expect(mediumIndex).toBeGreaterThan(highIndex);
    expect(output).toContain("full-repo-format-command AGENTS.md:6");
    expect(output).not.toContain("Run clean validation before handoff.");
    expect(outputLines.length).toBeLessThanOrEqual(30);
  });

  it("extracts explicit conflict signals from instruction lines and commands", () => {
    const text = [
      "# Workflow",
      "",
      "Always branch from dev.",
      "Run `dotnet format --include src/findings.ts`.",
      "Use main session only for this repository.",
      "",
    ].join("\n");
    const sections = parseSections("AGENTS.md", text);
    const commands = extractCommands("AGENTS.md", text, sections);
    const signals = extractConflictSignals({ sections, commands });

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "branch-target",
          value: "dev",
          sourcePath: "AGENTS.md",
          lineStart: 3,
          lineEnd: 3,
          matchedText: "branch from dev",
        }),
        expect.objectContaining({
          kind: "format-scope",
          value: "bounded",
          lineStart: 4,
          matchedText: "dotnet format --include src/findings.ts",
        }),
        expect.objectContaining({
          kind: "delegation-mode",
          value: "main-session-only",
          lineStart: 5,
          matchedText: "main session only",
        }),
      ]),
    );
  });

  it("detects narrow explicit core instruction conflicts", async () => {
    const report = await buildDoctorReport(path.join(fixturesRoot, "conflicts"));
    const findConflict = (code: string) =>
      report.findings.find((finding) => finding.code === code);

    expect(findConflict("conflicting-branch-target")).toMatchObject({
      severity: "medium",
      sourcePath: "AGENTS.md",
      lineStart: 3,
      matchedText: "branch from dev",
      relatedSources: [
        {
          sourcePath: "CLAUDE.md",
          lineStart: 3,
          lineEnd: 3,
        },
      ],
      hint: expect.any(String),
    });
    expect(findConflict("conflicting-pr-target")).toMatchObject({
      severity: "medium",
      sourcePath: "AGENTS.md",
      lineStart: 4,
      relatedSources: [expect.objectContaining({ sourcePath: "CLAUDE.md", lineStart: 4 })],
    });
    expect(findConflict("conflicting-validation-guidance")).toMatchObject({
      severity: "medium",
      sourcePath: "AGENTS.md",
      lineStart: 5,
      relatedSources: [expect.objectContaining({ sourcePath: "CLAUDE.md", lineStart: 5 })],
    });
    expect(findConflict("conflicting-format-guidance")).toMatchObject({
      severity: "medium",
      sourcePath: "AGENTS.md",
      lineStart: 6,
      relatedSources: [expect.objectContaining({ sourcePath: "CLAUDE.md", lineStart: 6 })],
    });
    expect(findConflict("conflicting-delegation-guidance")).toMatchObject({
      severity: "medium",
      sourcePath: "AGENTS.md",
      lineStart: 7,
      relatedSources: [expect.objectContaining({ sourcePath: "CLAUDE.md", lineStart: 7 })],
    });
    expect(findConflict("conflicting-destructive-action-guidance")).toMatchObject({
      severity: "high",
      sourcePath: "AGENTS.md",
      lineStart: 8,
      relatedSources: [expect.objectContaining({ sourcePath: "CLAUDE.md", lineStart: 8 })],
    });
  });

  it("does not emit conflicts unless opposing explicit signals are present", async () => {
    const report = await buildDoctorReport(path.join(fixturesRoot, "no-conflicts"));
    const conflictFindings = report.findings.filter((finding) =>
      finding.code.startsWith("conflicting-"),
    );

    expect(conflictFindings).toEqual([]);
  });

  it("keeps human conflict output compact and omits full instruction bodies", async () => {
    const report = await buildDoctorReport(path.join(fixturesRoot, "conflicts"));
    const output = formatDoctorText(report).join("\n");

    expect(output).toContain("conflicting-destructive-action-guidance AGENTS.md:8");
    expect(output).toContain("conflicting-branch-target AGENTS.md:3");
    expect(output).not.toContain("Always branch from dev.");
    expect(output).not.toContain("Always branch from main.");
    expect(output.split("\n").length).toBeLessThanOrEqual(30);
  });
});
