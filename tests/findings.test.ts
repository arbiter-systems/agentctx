import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildDoctorReport, formatDoctorText } from "../src/cli.js";

const duplicatedGuidance =
  "Always run npm test before pushing changes to shared branches.";
const duplicateCommand = "npm run build\nnpm test";
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

  it("includes complete finding records in JSON output", async () => {
    await withFindingsFixture(async (fixtureRoot) => {
      const output = JSON.parse(
        JSON.stringify(await buildDoctorReport(fixtureRoot)),
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
});
