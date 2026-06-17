import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildDoctorReport, createProgram, formatDoctorText } from "../src/cli.js";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function makeTempRepo(branch = "dev"): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "instructov-dd-"));
  await git(["init"], dir);
  await git(["config", "user.email", "test@instructov.test"], dir);
  await git(["config", "user.name", "Test"], dir);
  await git(["branch", "-M", branch], dir);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function writeRepoFile(dir: string, name: string, content: string): Promise<void> {
  const full = join(dir, name);
  const parent = dirname(full);
  if (parent !== dir) await mkdir(parent, { recursive: true });
  await writeFile(full, content);
}

async function commitAll(dir: string, message: string): Promise<void> {
  await git(["add", "--all"], dir);
  await git(["commit", "-m", message], dir);
}

async function initialCommit(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await writeRepoFile(dir, name, content);
  }
  await commitAll(dir, "initial");
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("doctor --diff", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeTempRepo());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("reports token delta for added instruction text", async () => {
    await initialCommit(dir, { "AGENTS.md": "# Agent\n\nInitial guidance.\n" });
    await writeRepoFile(
      dir,
      "AGENTS.md",
      [
        "# Agent",
        "",
        "Initial guidance.",
        "Add focused review guidance for pull requests and changed files.",
        "",
      ].join("\n"),
    );

    const report = await buildDoctorReport(dir, { diffRef: "dev" });

    expect(report.diff?.enabled).toBe(true);
    expect(report.diff?.comparedRef).toBe("dev");
    expect(report.diff?.changedInstructionFiles).toEqual(["AGENTS.md"]);
    expect(report.diff?.tokenDelta).toBeGreaterThan(0);
  });

  it("outputs JSON diff metadata", async () => {
    await initialCommit(dir, { "AGENTS.md": "# Agent\n\nInitial guidance.\n" });
    await writeRepoFile(dir, "AGENTS.md", "# Agent\n\nRun full repo tests.\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    await createProgram().parseAsync([
      "node",
      "instructov",
      "doctor",
      "--diff",
      "dev",
      "--json",
    ]);

    const parsed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(parsed.diff).toMatchObject({
      enabled: true,
      comparedRef: "dev",
      changedFiles: ["AGENTS.md"],
      changedInstructionFiles: ["AGENTS.md"],
      tokenDelta: expect.any(Number),
      currentEstimatedTokens: expect.any(Number),
      baselineEstimatedTokens: expect.any(Number),
      newFindings: expect.any(Array),
      resolvedFindings: expect.any(Array),
      newFindingCounts: expect.any(Object),
      resolvedFindingCounts: expect.any(Object),
    });
  });

  it("reports new findings", async () => {
    await initialCommit(dir, { "AGENTS.md": "# Agent\n\nRun changed-file tests.\n" });
    await writeRepoFile(dir, "AGENTS.md", "# Agent\n\nRun full repo tests.\n");

    const report = await buildDoctorReport(dir, { diffRef: "dev" });

    expect(report.diff?.newFindings.some((finding) =>
      finding.code === "risky-validation-command" &&
      finding.sourcePath === "AGENTS.md",
    )).toBe(true);
    expect(report.diff?.newFindingCounts.high["risky-validation-command"]).toBe(1);
  });

  it("reports resolved findings", async () => {
    await initialCommit(dir, { "AGENTS.md": "# Agent\n\nRun full repo tests.\n" });
    await writeRepoFile(dir, "AGENTS.md", "# Agent\n\nRun changed-file tests.\n");

    const report = await buildDoctorReport(dir, { diffRef: "dev" });

    expect(report.diff?.resolvedFindings.some((finding) =>
      finding.code === "risky-validation-command" &&
      finding.sourcePath === "AGENTS.md",
    )).toBe(true);
    expect(report.diff?.resolvedFindingCounts.high["risky-validation-command"]).toBe(1);
  });

  it("reports no impact when there are no instruction changes", async () => {
    await initialCommit(dir, { "AGENTS.md": "# Agent\n\nInitial guidance.\n" });

    const report = await buildDoctorReport(dir, { diffRef: "dev" });
    const lines = formatDoctorText(report);

    expect(report.diff?.tokenDelta).toBe(0);
    expect(report.diff?.changedInstructionFiles).toEqual([]);
    expect(lines[0]).toBe("Instruction Impact Analysis");
    expect(lines).toContain("Instruction token delta: +0 estimated tokens");
    expect(lines).toContain("No changes detected.");
  });

  it("does not count non-instruction changes as instruction sources", async () => {
    await initialCommit(dir, {
      "AGENTS.md": "# Agent\n\nInitial guidance.\n",
      "README.md": "# Project\n",
    });
    await writeRepoFile(dir, "README.md", "# Project\n\nUpdated.\n");

    const report = await buildDoctorReport(dir, { diffRef: "dev" });

    expect(report.diff?.changedFiles).toEqual(["README.md"]);
    expect(report.diff?.changedInstructionFiles).toEqual([]);
    expect(report.diff?.tokenDelta).toBe(0);
  });

  it("sets exit code 2 for invalid refs", async () => {
    await initialCommit(dir, { "AGENTS.md": "# Agent\n\nInitial guidance.\n" });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    await createProgram().parseAsync([
      "node",
      "instructov",
      "doctor",
      "--diff",
      "missing-ref",
    ]);

    expect(process.exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Unable to compare instruction impact"),
    );
  });

  it("supports main...HEAD", async () => {
    await cleanup();
    ({ dir, cleanup } = await makeTempRepo("main"));
    await initialCommit(dir, { "AGENTS.md": "# Agent\n\nInitial guidance.\n" });
    await git(["switch", "-c", "feature"], dir);
    await writeRepoFile(dir, "AGENTS.md", "# Agent\n\nRun full repo tests.\n");
    await commitAll(dir, "change instructions");

    const report = await buildDoctorReport(dir, { diffRef: "main...HEAD" });

    expect(report.diff?.comparedRef).toBe("main...HEAD");
    expect(report.diff?.changedInstructionFiles).toEqual(["AGENTS.md"]);
    expect(report.diff?.tokenDelta).not.toBe(0);
  });

  it("rejects --changed with --diff", async () => {
    await initialCommit(dir, { "AGENTS.md": "# Agent\n\nInitial guidance.\n" });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    await createProgram().parseAsync([
      "node",
      "instructov",
      "doctor",
      "--changed",
      "--diff",
      "dev",
    ]);

    expect(process.exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("--changed cannot be used with --diff"),
    );
  });
});
