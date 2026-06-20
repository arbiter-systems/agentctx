import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { discoverInstructionSources, type InstructionSource } from "../src/discovery.js";
import { filterToInstructionSources, getChangedFiles } from "../src/gitChanged.js";

const execFileAsync = promisify(nodeExecFile);

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

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

  it("retains a deleted nested conventional source admitted by configured discovery", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "instructov-git-changed-"));
    try {
      await mkdir(path.join(cwd, "active"), { recursive: true });
      await writeFile(path.join(cwd, "active", "AGENTS.md"), "# Active\n");
      const sources = await discoverInstructionSources(cwd, {
        include: ["**/AGENTS.md"],
      });

      expect(filterToInstructionSources(["removed/AGENTS.md"], sources)).toEqual([
        "removed/AGENTS.md",
      ]);
      expect(sources).toContainEqual({
        path: "removed/AGENTS.md",
        kind: "agents",
        scopePath: "removed",
      });
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it("retains a deleted explicitly configured source", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "instructov-git-changed-"));
    try {
      await mkdir(path.join(cwd, "guidance"), { recursive: true });
      await writeFile(path.join(cwd, "guidance", "current.md"), "# Current\n");
      const sources = await discoverInstructionSources(cwd, {
        include: ["guidance/*.md"],
      });

      expect(filterToInstructionSources(["guidance/deleted.md"], sources)).toEqual([
        "guidance/deleted.md",
      ]);
      expect(sources).toContainEqual({
        path: "guidance/deleted.md",
        kind: "agents",
        scopePath: "guidance",
      });
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it("does not infer arbitrary deleted files as instruction sources", () => {
    const sources: InstructionSource[] = [];

    expect(filterToInstructionSources(["notes.txt"], sources)).toEqual([]);
    expect(sources).toEqual([]);
  });
});

describe("getChangedFiles", () => {
  it("falls back to ls-files when HEAD has no commits yet (unborn branch)", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "instructov-unborn-"));
    try {
      await git(["init"], cwd);
      await git(["config", "user.email", "test@instructov.test"], cwd);
      await git(["config", "user.name", "Test"], cwd);
      await writeFile(path.join(cwd, "AGENTS.md"), "# Agent\n");

      const changed = await getChangedFiles(cwd);

      expect(changed).toContain("AGENTS.md");
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it("propagates an unexpected git failure instead of silently returning an empty list", async () => {
    const notARepo = await mkdtemp(path.join(tmpdir(), "instructov-norepo-"));
    try {
      await expect(getChangedFiles(notARepo)).rejects.toThrow();
    } finally {
      await rm(notARepo, { force: true, recursive: true });
    }
  });
});
