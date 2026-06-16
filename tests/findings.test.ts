import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildDoctorReport, formatDoctorText } from "../src/cli.js";

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
    const findingsByCode = new Map(
      report.findings.map((finding) => [
        `${finding.code}:${finding.matchedText ?? ""}`,
        finding,
      ]),
    );

    expect(findingsByCode.get("risky-validation-command:clean validation")).toMatchObject({
      code: "risky-validation-command",
      severity: "high",
      sourcePath: "AGENTS.md",
      lineStart: 3,
      matchedText: "clean validation",
      hint: expect.any(String),
    });
    expect(findingsByCode.get("risky-validation-command:entire repo")).toMatchObject({
      code: "risky-validation-command",
      severity: "high",
      lineStart: 4,
    });
    expect(
      report.findings.find(
        (finding) =>
          finding.code === "risky-validation-command" &&
          finding.matchedText === "Run all checks",
      ),
    ).toMatchObject({
      severity: "low",
      lineStart: 5,
    });
    expect(findingsByCode.get("full-repo-format-command:dotnet format")).toMatchObject({
      code: "full-repo-format-command",
      severity: "high",
      lineStart: 6,
      message: expect.any(String),
    });
    expect(findingsByCode.get("unbounded-command:dotnet test")).toMatchObject({
      code: "unbounded-command",
      severity: "medium",
      lineStart: 8,
    });
    expect(findingsByCode.get("unbounded-command:npm test")).toMatchObject({
      code: "unbounded-command",
      severity: "medium",
      lineStart: 10,
    });
    expect(findingsByCode.get("unbounded-command:pnpm test")).toMatchObject({
      code: "unbounded-command",
      severity: "medium",
      lineStart: 12,
    });
    expect(findingsByCode.get("unbounded-command:yarn test")).toMatchObject({
      code: "unbounded-command",
      severity: "medium",
      lineStart: 14,
    });
    expect(findingsByCode.get("restore-heavy-command:dotnet restore")).toMatchObject({
      code: "restore-heavy-command",
      severity: "medium",
      lineStart: 16,
    });
    expect(findingsByCode.get("restore-heavy-command:npm install")).toMatchObject({
      code: "restore-heavy-command",
      severity: "medium",
      lineStart: 17,
    });
    expect(findingsByCode.get("restore-heavy-command:pnpm install")).toMatchObject({
      code: "restore-heavy-command",
      severity: "medium",
      lineStart: 18,
    });
    expect(findingsByCode.get("restore-heavy-command:yarn install")).toMatchObject({
      code: "restore-heavy-command",
      severity: "medium",
      lineStart: 19,
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
});
