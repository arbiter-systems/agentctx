import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildSuggestResultForTask } from "../src/suggest.js";

const tempDirs: string[] = [];

async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "instructov-suggest-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("suggest parsed finding penalties", () => {
  it("includes command-derived findings as skill penalties", async () => {
    const dir = await makeTempRepo();
    const skillDir = join(dir, "skills", "repo-audit");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: repo-audit",
        "summary: Audit repository issues.",
        "tasks: [audit]",
        "triggers: [audit issue]",
        "---",
        "# Repo audit",
        "Use this skill to audit repository issues.",
        "",
        "## Validation",
        "Run this broad command:",
        "",
        "```bash",
        "npm test",
        "```",
        "",
      ].join("\n"),
    );

    const result = await buildSuggestResultForTask(dir, "audit issue 62");
    const candidate = [...result.selected, ...result.excluded].find(
      (item) => item.sourcePath === "skills/repo-audit/SKILL.md",
    );

    expect(candidate?.penalties).toContainEqual(
      expect.objectContaining({ code: "unbounded-command", severity: "medium" }),
    );
  });
});
