import { describe, expect, it } from "vitest";

import { filterToInstructionSources } from "../src/gitChanged.js";
import type { InstructionSource } from "../src/discovery.js";

describe("filterToInstructionSources", () => {
  it("retains a deleted conventional source for baseline diff analysis", () => {
    const sources: InstructionSource[] = [
      { path: "AGENTS.md", kind: "agents", scopePath: "." },
    ];

    expect(filterToInstructionSources(["deleted/SKILL.md"], sources)).toEqual([
      "deleted/SKILL.md",
    ]);
    expect(sources).toContainEqual({
      path: "deleted/SKILL.md",
      kind: "skill",
      scopePath: "deleted",
    });
  });

  it("does not infer arbitrary deleted files as instruction sources", () => {
    const sources: InstructionSource[] = [];

    expect(filterToInstructionSources(["notes.txt"], sources)).toEqual([]);
    expect(sources).toEqual([]);
  });
});
