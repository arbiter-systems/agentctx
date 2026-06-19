import { describe, expect, it } from "vitest";

import { GitDiffError, parseDiffRef } from "../src/gitDiff.js";

describe("parseDiffRef", () => {
  it("accepts a simple git ref", () => {
    expect(parseDiffRef("dev")).toEqual({
      comparedRef: "dev",
      baseRef: "dev",
      diffRef: "dev",
      tripleDot: false,
    });
  });

  it("accepts a supported merge-base comparison", () => {
    expect(parseDiffRef("origin/dev...HEAD")).toEqual({
      comparedRef: "origin/dev...HEAD",
      baseRef: "origin/dev",
      diffRef: "origin/dev...HEAD",
      tripleDot: true,
    });
  });

  it.each([
    "",
    " dev",
    "dev ",
    "--output=/tmp/should-not-exist",
    "-c",
    "dev\n--output=/tmp/should-not-exist",
    "dev\u0000",
    "dev...main",
    "dev...HEAD...extra",
    "...HEAD",
  ])("rejects unsupported or unsafe refs: %j", (ref) => {
    expect(() => parseDiffRef(ref)).toThrow(GitDiffError);
  });
});
