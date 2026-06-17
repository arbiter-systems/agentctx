import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { toPosixPath } from "./gitChanged.js";

const execFileAsync = promisify(execFile);

export class GitDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitDiffError";
  }
}

export type GitDiffComparison = {
  comparedRef: string;
  baselineRef: string;
  changedFiles: string[];
};

function errorText(err: unknown): string {
  const maybeExecError = err as { stderr?: unknown; message?: unknown };
  if (typeof maybeExecError.stderr === "string" && maybeExecError.stderr.trim()) {
    return maybeExecError.stderr.trim();
  }
  if (typeof maybeExecError.message === "string" && maybeExecError.message.trim()) {
    return maybeExecError.message.trim();
  }
  return String(err);
}

async function gitOutput(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

function parseDiffRef(ref: string): { comparedRef: string; baseRef: string; diffRef: string; tripleDot: boolean } {
  const trimmed = ref.trim();
  if (trimmed.length === 0) {
    throw new GitDiffError("--diff requires a non-empty git ref.");
  }

  if (!trimmed.includes("...")) {
    return { comparedRef: trimmed, baseRef: trimmed, diffRef: trimmed, tripleDot: false };
  }

  const parts = trimmed.split("...");
  const baseRef = parts[0];
  const headRef = parts[1];
  if (
    parts.length !== 2 ||
    baseRef === undefined ||
    headRef === undefined ||
    baseRef.length === 0 ||
    headRef.length === 0
  ) {
    throw new GitDiffError(`Unsupported diff ref "${ref}". Use <ref> or <ref>...HEAD.`);
  }
  if (headRef !== "HEAD") {
    throw new GitDiffError(`Unsupported diff ref "${ref}". Only <ref>...HEAD is supported.`);
  }

  return { comparedRef: trimmed, baseRef, diffRef: trimmed, tripleDot: true };
}

function lines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(toPosixPath)
    .sort((left, right) => left.localeCompare(right, "en"));
}

export async function getInstructionDiffComparison(
  cwd: string,
  ref: string,
): Promise<GitDiffComparison> {
  const parsed = parseDiffRef(ref);

  try {
    const baselineRef = parsed.tripleDot
      ? (await gitOutput(["merge-base", parsed.baseRef, "HEAD"], cwd)).trim()
      : parsed.baseRef;
    const changedFiles = lines(await gitOutput([
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      parsed.diffRef,
    ], cwd));

    return {
      comparedRef: parsed.comparedRef,
      baselineRef,
      changedFiles,
    };
  } catch (err) {
    throw new GitDiffError(
      `Unable to compare instruction impact against "${ref}": ${errorText(err)}`,
    );
  }
}

export async function readGitFile(
  cwd: string,
  ref: string,
  filePath: string,
): Promise<string | undefined> {
  try {
    return await gitOutput(["show", `${ref}:${toPosixPath(filePath)}`], cwd);
  } catch {
    return undefined;
  }
}
