import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { buildDoctorReport } from "../src/cli.js";

const execFileAsync = promisify(nodeExecFile);

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function commit(cwd: string, message: string): Promise<void> {
  await git(["add", "-A"], cwd);
  await git(["commit", "-m", message], cwd);
}

async function withRepository(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(path.join(tmpdir(), "instructov-diff-config-"));
  try {
    await git(["init"], cwd);
    await git(["config", "user.email", "test@instructov.test"], cwd);
    await git(["config", "user.name", "Instructov Test"], cwd);
    await run(cwd);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
}

const customConfig = [
  "version: v0alpha1",
  "discovery:",
  "  include:",
  "    - \"guidance/*.md\"",
  "",
].join("\n");

const defaultConfig = "version: v0alpha1\n";

async function writeCustomSource(cwd: string, name: string): Promise<void> {
  await mkdir(path.join(cwd, "guidance"), { recursive: true });
  await writeFile(path.join(cwd, "guidance", name), "# Guidance\n\n" + "Keep this instruction. ".repeat(160));
}

describe("doctor --diff configuration history", () => {
  it("includes a configured source deleted with its include pattern", async () => {
    await withRepository(async (cwd) => {
      await writeFile(path.join(cwd, "instructov.yml"), customConfig);
      await writeCustomSource(cwd, "deleted.md");
      await commit(cwd, "baseline");

      await rm(path.join(cwd, "guidance", "deleted.md"));
      await writeFile(path.join(cwd, "instructov.yml"), defaultConfig);
      await commit(cwd, "remove custom source");

      const report = await buildDoctorReport(cwd, { diffRef: "HEAD~1" });

      expect(report.diff?.changedInstructionFiles).toContain("guidance/deleted.md");
      expect(report.diff?.baselineEstimatedTokens).toBeGreaterThan(0);
      expect(report.diff?.tokenDelta).toBeLessThan(0);
    });
  });

  it("includes a retained source when its configured include pattern is removed", async () => {
    await withRepository(async (cwd) => {
      await writeFile(path.join(cwd, "instructov.yml"), customConfig);
      await writeCustomSource(cwd, "retained.md");
      await commit(cwd, "baseline");

      await writeFile(path.join(cwd, "instructov.yml"), defaultConfig);
      await commit(cwd, "remove include");

      const report = await buildDoctorReport(cwd, { diffRef: "HEAD~1" });

      expect(report.diff?.changedInstructionFiles).toContain("guidance/retained.md");
      expect(report.diff?.baselineEstimatedTokens).toBeGreaterThan(
        report.diff?.currentEstimatedTokens ?? 0,
      );
      expect(report.diff?.tokenDelta).toBeLessThan(0);
    });
  });

  it("includes baseline-only sources when instructov.yml is deleted", async () => {
    await withRepository(async (cwd) => {
      await writeFile(path.join(cwd, "instructov.yml"), customConfig);
      await writeCustomSource(cwd, "legacy.md");
      await commit(cwd, "baseline");

      await rm(path.join(cwd, "guidance", "legacy.md"));
      await rm(path.join(cwd, "instructov.yml"));
      await commit(cwd, "remove config and source");

      const report = await buildDoctorReport(cwd, { diffRef: "HEAD~1" });

      expect(report.diff?.changedInstructionFiles).toContain("guidance/legacy.md");
      expect(report.diff?.baselineEstimatedTokens).toBeGreaterThan(0);
      expect(report.diff?.currentEstimatedTokens).toBe(0);
      expect(report.diff?.tokenDelta).toBeLessThan(0);
    });
  });
});
