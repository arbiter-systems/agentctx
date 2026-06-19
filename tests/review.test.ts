import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addReviewCommand,
  formatReviewText,
  reviewPrompt,
} from "../src/review.js";

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("reviewPrompt", () => {
  it("reports an empty prompt without writing anything", () => {
    const report = reviewPrompt("   \n\t", { profile: "coding-task" });

    expect(report).toMatchObject({
      command: "review",
      status: "ok",
      profile: "coding-task",
      estimatedTokens: 2,
      findings: [{ code: "empty-prompt", severity: "high" }],
    });
  });

  it("reports missing objective and validation for a structured coding task", () => {
    const report = reviewPrompt("Repository guidance only.", {
      profile: "coding-task",
    });

    expect(report.findings.map((finding) => finding.code)).toEqual([
      "missing-objective",
      "missing-validation",
    ]);
    expect(report.findings.every((finding) => finding.lineStart === 1)).toBe(true);
  });

  it("does not require validation for planning or general prompts", () => {
    expect(reviewPrompt("Plan the release sequence.", { profile: "planning" }).findings)
      .not.toContainEqual(expect.objectContaining({ code: "missing-validation" }));
    expect(reviewPrompt("A general question.", { profile: "general" }).findings)
      .not.toContainEqual(expect.objectContaining({ code: "missing-validation" }));
  });

  it("reports duplicated constraints on the later line", () => {
    const report = reviewPrompt([
      "Implement the review command.",
      "Do not use network calls.",
      "Do not use network calls.",
      "Run targeted tests.",
    ].join("\n"), { profile: "coding-task" });

    expect(report.findings).toContainEqual(expect.objectContaining({
      code: "duplicate-constraint",
      severity: "low",
      lineStart: 3,
    }));
  });

  it("reports destructive commands with their source line", () => {
    const report = reviewPrompt("Implement cleanup.\nrm -rf ./dist\nRun tests.");

    expect(report.findings).toContainEqual(expect.objectContaining({
      code: "destructive-command",
      severity: "high",
      lineStart: 2,
    }));
  });

  it("redacts likely secret values from findings and formatted output", () => {
    const secret = "ghp_123456789012345678901234567890123456";
    const report = reviewPrompt(`Use token=${secret} for local testing.`);
    const output = formatReviewText(report).join("\n");

    expect(report.findings).toContainEqual(expect.objectContaining({
      code: "likely-secret",
      lineStart: 1,
    }));
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(output).not.toContain(secret);
  });

  it("does not flag documented secret placeholders", () => {
    const report = reviewPrompt("Set API_KEY=<your-api-key> before running the command.");

    expect(report.findings).not.toContainEqual(expect.objectContaining({
      code: "likely-secret",
    }));
  });

  it("formats findings in severity groups with approximate token size", () => {
    const report = reviewPrompt("\n", { profile: "general" });

    expect(formatReviewText(report)).toEqual([
      "instv review",
      "Profile: general",
      "Estimated prompt size: ~1 tokens.",
      "",
      "Must address:",
      "- Prompt is empty.",
      "  Verdict: Provide the task or question to review.",
    ]);
  });
});

describe("review command", () => {
  it("documents stdin, json, and profile options", () => {
    const program = new Command();
    addReviewCommand(program);

    const command = program.commands.find((candidate) => candidate.name() === "review");
    expect(command?.helpInformation()).toContain("--stdin");
    expect(command?.helpInformation()).toContain("--json");
    expect(command?.helpInformation()).toContain("--profile <profile>");
  });

  it("rejects missing stdin with clear guidance", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const program = new Command();
    addReviewCommand(program);

    await program.parseAsync(["node", "instv", "review"]);

    expect(error).toHaveBeenCalledWith(
      "Prompt text must be supplied through stdin. Use: instv review --stdin",
    );
    expect(process.exitCode).toBe(2);
  });
});
