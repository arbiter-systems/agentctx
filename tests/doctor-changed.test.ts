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

async function makeTempRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "instructov-dc-"));
  await git(["init"], dir);
  await git(["config", "user.email", "test@instructov.test"], dir);
  await git(["config", "user.name", "Test"], dir);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function makeTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "instructov-noGit-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function initialCommit(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    const parent = dirname(full);
    if (parent !== dir) await mkdir(parent, { recursive: true });
    await writeFile(full, content);
  }
  await git(["add", "--all"], dir);
  await git(["commit", "-m", "initial"], dir);
}

describe("doctor --changed: git detection", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeTempRepo());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  it("includes a changed AGENTS.md and analyzes it", async () => {
    await initialCommit(dir, { "AGENTS.md": "# Agent\n\nInitial guidance.\n" });
    await writeFile(join(dir, "AGENTS.md"), "# Agent\n\nUpdated guidance.\n");

    const report = await buildDoctorReport(dir, { changed: true });

    expect(report.changed?.enabled).toBe(true);
    expect(report.changed?.changedInstructionFiles).toContain("AGENTS.md");
    expect(report.sources.some((s) => s.path === "AGENTS.md")).toBe(true);
  });

  it("returns no changed instruction sources when only a non-instruction file changed", async () => {
    await initialCommit(dir, {
      "AGENTS.md": "# Agent\n\nGuidance.\n",
      "README.md": "# Project\n",
    });
    await writeFile(join(dir, "README.md"), "# Project — updated\n");

    const report = await buildDoctorReport(dir, { changed: true });

    expect(report.changed?.changedInstructionFiles).toHaveLength(0);
    expect(report.sources).toHaveLength(0);
    expect(report.findings).toHaveLength(0);
  });

  it("does not analyze unchanged instruction files in changed mode", async () => {
    await initialCommit(dir, {
      "AGENTS.md": "# Agent\n\nInitial.\n",
      "CLAUDE.md": "# Claude\n\nInitial.\n",
    });
    await writeFile(join(dir, "AGENTS.md"), "# Agent\n\nModified.\n");

    const report = await buildDoctorReport(dir, { changed: true });

    expect(report.changed?.changedInstructionFiles).toContain("AGENTS.md");
    expect(report.changed?.changedInstructionFiles).not.toContain("CLAUDE.md");
    expect(report.sources.some((s) => s.path === "CLAUDE.md")).toBe(false);
  });

  it("includes changedFiles and changedInstructionFiles in JSON output", async () => {
    await initialCommit(dir, {
      "AGENTS.md": "# Agent\n\nGuidance.\n",
      "src/index.ts": "export const x = 1;\n",
    });
    await writeFile(join(dir, "AGENTS.md"), "# Agent\n\nModified.\n");
    await writeFile(join(dir, "src/index.ts"), "export const x = 2;\n");

    const report = await buildDoctorReport(dir, { changed: true });

    expect(report.changed).toBeDefined();
    expect(report.changed?.changedFiles).toContain("AGENTS.md");
    expect(report.changed?.changedFiles).toContain("src/index.ts");
    expect(report.changed?.changedInstructionFiles).toContain("AGENTS.md");
    expect(report.changed?.changedInstructionFiles).not.toContain("src/index.ts");
    expect(Array.isArray(report.findings)).toBe(true);
  });
});

describe("doctor --changed: text output", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeTempRepo());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  it("shows --changed header when changed mode is active", async () => {
    await initialCommit(dir, { "AGENTS.md": "# Agent\n\nGuidance.\n" });
    await writeFile(join(dir, "AGENTS.md"), "# Agent\n\nModified.\n");

    const report = await buildDoctorReport(dir, { changed: true });
    const lines = formatDoctorText(report);

    expect(lines[0]).toBe("instv doctor --changed");
  });

  it("prints no changed instruction sources when nothing relevant changed", async () => {
    await initialCommit(dir, { "README.md": "# Project\n" });
    await writeFile(join(dir, "README.md"), "# Project — updated\n");

    const report = await buildDoctorReport(dir, { changed: true });
    const lines = formatDoctorText(report);

    expect(lines).toContain("No changed instruction sources found.");
    expect(lines[0]).toBe("instv doctor --changed");
  });
});

describe("doctor --changed: exit codes", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let savedExitCode: typeof process.exitCode;

  beforeEach(async () => {
    ({ dir, cleanup } = await makeTempRepo());
    savedExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;
    await cleanup();
  });

  it("sets exit code 1 when a high-severity finding is present", async () => {
    // "full repo" triggers a high-severity risky-validation-command finding
    await initialCommit(dir, { "AGENTS.md": "# Instructions\n\nRun full repo tests.\n" });
    await writeFile(join(dir, "AGENTS.md"), "# Instructions\n\nAlways run full repo tests.\n");

    vi.spyOn(process, "cwd").mockReturnValue(dir);
    await createProgram().parseAsync(["node", "instructov", "doctor", "--changed"]);

    expect(process.exitCode).toBe(1);
  });

  it("does not fail for findings outside configured fail_on", async () => {
    await initialCommit(dir, {
      "AGENTS.md": [
        "# Instructions",
        "",
        "```bash",
        "dotnet format",
        "```",
        "",
      ].join("\n"),
    });

    vi.spyOn(process, "cwd").mockReturnValue(dir);
    await createProgram().parseAsync(["node", "instructov", "doctor"]);

    expect(process.exitCode).toBe(0);
  });

  it("uses configured fail_on to fail doctor", async () => {
    await initialCommit(dir, {
      "instructov.yml": [
        "version: v0alpha1",
        "doctor:",
        "  fail_on:",
        "    - full-repo-format-command",
        "",
      ].join("\n"),
      "AGENTS.md": [
        "# Instructions",
        "",
        "```bash",
        "dotnet format",
        "```",
        "",
      ].join("\n"),
    });

    vi.spyOn(process, "cwd").mockReturnValue(dir);
    await createProgram().parseAsync(["node", "instructov", "doctor"]);

    expect(process.exitCode).toBe(1);
  });

  it("leaves exit code 0 when no changed instruction sources are found", async () => {
    await initialCommit(dir, { "README.md": "# Project\n" });
    await writeFile(join(dir, "README.md"), "# Project — updated\n");

    vi.spyOn(process, "cwd").mockReturnValue(dir);
    await createProgram().parseAsync(["node", "instructov", "doctor", "--changed"]);

    expect(process.exitCode).toBe(0);
  });

  it("sets exit code 2 on git error (not a git repository)", async () => {
    const { dir: nonGitDir, cleanup: cleanupNonGit } = await makeTempDir();
    try {
      await writeFile(join(nonGitDir, "AGENTS.md"), "# Agent\n\nGuidance.\n");
      vi.spyOn(process, "cwd").mockReturnValue(nonGitDir);
      await createProgram().parseAsync(["node", "instructov", "doctor", "--changed"]);
      expect(process.exitCode).toBe(2);
    } finally {
      await cleanupNonGit();
    }
  });
});

describe("formatDoctorText: changed mode off (regression)", () => {
  it("uses instv doctor header when changed is not set", () => {
    const report = {
      command: "doctor" as const,
      status: "ok" as const,
      summary: {
        sourceCount: 0,
        bytes: 0,
        estimatedTokens: 0,
        findingCount: 0,
        estimatedAvoidableTokens: 0,
      },
      sources: [],
      findings: [],
      skillMetadata: [],
    };
    const lines = formatDoctorText(report);
    expect(lines[0]).toBe("instv doctor");
  });
});
