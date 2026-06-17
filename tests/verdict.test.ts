import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDoctorReport, createProgram, formatDoctorText } from "../src/cli.js";
import type { Finding } from "../src/findings.js";
import { verdictForFinding, withVerdicts } from "../src/verdict.js";

async function makeTempRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "instructov-verdict-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function writeRepoFile(dir: string, name: string, content: string): Promise<void> {
  await writeFile(join(dir, name), content);
}

function finding(code: Finding["code"]): Finding {
  return {
    code,
    severity: "medium",
    message: `${code} message`,
    sourcePath: "AGENTS.md",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("doctor --verdict", () => {
  it.each([
    ["duplicate-guidance"],
    ["duplicate-command"],
    ["oversized-source"],
    ["oversized-section"],
    ["risky-validation-command"],
    ["conflicting-branch-target"],
    ["missing-branch-guidance"],
    ["missing-pr-guidance"],
    ["missing-validation-guidance"],
  ] satisfies Array<[Finding["code"]]>)('returns a short verdict for %s', (code) => {
    const verdict = verdictForFinding(finding(code));

    expect(verdict).toBeTypeOf("string");
    expect(verdict).not.toContain("\n");
  });

  it("keeps unsupported findings without a verdict", () => {
    expect(verdictForFinding(finding("missing-skill-trigger"))).toBe(
      "Add trigger guidance that says when to use this skill.",
    );
  });

  it("adds verdicts without mutating original findings", () => {
    const original = finding("risky-validation-command");

    const [withVerdict] = withVerdicts([original]);

    expect(withVerdict).toMatchObject({
      code: "risky-validation-command",
      verdict: "Use targeted validation unless full validation is explicitly requested.",
    });
    expect("verdict" in original).toBe(false);
  });

  it("does not show verdict lines by default", async () => {
    const { dir, cleanup } = await makeTempRepo();
    try {
      await writeRepoFile(dir, "AGENTS.md", "# Agent\n\nRun all tests before every PR.\n");

      const report = await buildDoctorReport(dir);
      const lines = formatDoctorText(report);

      expect(lines.some((line) => line.includes("Verdict:"))).toBe(false);
      expect(report.findings.some((finding) => "verdict" in finding)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("shows verdict lines when requested", async () => {
    const { dir, cleanup } = await makeTempRepo();
    try {
      await writeRepoFile(dir, "AGENTS.md", "# Agent\n\nRun all tests before every PR.\n");

      const report = await buildDoctorReport(dir, { verdict: true });
      const lines = formatDoctorText(report);

      expect(lines).toContain(
        "  Verdict: Use targeted validation unless full validation is explicitly requested.",
      );
    } finally {
      await cleanup();
    }
  });

  it("includes verdicts in JSON output when requested", async () => {
    const { dir, cleanup } = await makeTempRepo();
    try {
      await writeRepoFile(dir, "AGENTS.md", "# Agent\n\nRun all tests before every PR.\n");
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.spyOn(process, "cwd").mockReturnValue(dir);

      await createProgram().parseAsync([
        "node",
        "instructov",
        "doctor",
        "--verdict",
        "--json",
      ]);

      const parsed = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(parsed.findings).toContainEqual(
        expect.objectContaining({
          code: "risky-validation-command",
          verdict: "Use targeted validation unless full validation is explicitly requested.",
        }),
      );
    } finally {
      await cleanup();
    }
  });

  it("does not modify instruction files", async () => {
    const { dir, cleanup } = await makeTempRepo();
    try {
      const content = "# Agent\n\nRun all tests before every PR.\n";
      await writeRepoFile(dir, "AGENTS.md", content);
      const before = await readFile(join(dir, "AGENTS.md"), "utf8");

      await buildDoctorReport(dir, { verdict: true });

      const after = await readFile(join(dir, "AGENTS.md"), "utf8");
      expect(after).toBe(before);
    } finally {
      await cleanup();
    }
  });
});
