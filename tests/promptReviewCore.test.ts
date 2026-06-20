import { describe, expect, it } from "vitest";

import { formatReviewText, reviewPrompt } from "../src/promptReviewCore.js";

describe("prompt review core", () => {
  it("preserves deterministic review behavior outside the CLI adapter", () => {
    const report = reviewPrompt("Repository guidance only.", { profile: "coding-task" });

    expect(report.findings.map((finding) => finding.code)).toEqual([
      "missing-objective",
      "missing-validation",
    ]);
    expect(formatReviewText(report)).toContain("Consider:");
  });
});
