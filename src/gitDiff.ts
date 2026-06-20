import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parseInstructovConfigText } from "./config.js";
import { isDiscoveredInstructionPath, type DiscoveryOptions } from "./discovery.js";

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
  // Plain file paths reported by `git diff` (rename-aware: a move appears under
  // its new path only).
  changedFiles: string[];
  // Instruction-source paths whose discovery membership changed across config
  // history (e.g. a removed include pattern or a deleted instructov.yml), which
  // a plain file diff cannot express on its own.
  changedInstructionSources: string[];
};

type ParsedDiffRef = {
  comparedRef: string;
  baseRef: string;
  diffRef: string;
  tripleDot: boolean;
};

function toPosixPath(value: string): string {
  return value.split("\\").join("/");
}

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

function isSafeRevision(value: string): boolean {
  return value.length > 0 &&
    !value.startsWith("-") &&
    !/[\u0000-\u001f\u007f\s]/.test(value);
}

function assertSafeRevision(value: string, original: string): void {
  if (!isSafeRevision(value)) {
    throw new GitDiffError(
      `Unsupported diff ref "${original}". Use a non-option git ref without whitespace or control characters.`,
    );
  }
}

export function parseDiffRef(ref: string): ParsedDiffRef {
  const trimmed = ref.trim();
  if (trimmed.length === 0) {
    throw new GitDiffError("--diff requires a non-empty git ref.");
  }
  if (trimmed !== ref || /[\u0000-\u001f\u007f]/.test(ref)) {
    throw new GitDiffError(
      `Unsupported diff ref "${ref}". Use a non-option git ref without whitespace or control characters.`,
    );
  }

  if (!trimmed.includes("...")) {
    assertSafeRevision(trimmed, ref);
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
  assertSafeRevision(baseRef, ref);

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

async function readBaselineDiscovery(cwd: string, baselineRef: string): Promise<DiscoveryOptions> {
  const text = await readGitFile(cwd, baselineRef, "instructov.yml");
  const config = text === undefined
    ? parseInstructovConfigText("version: v0alpha1\n")
    : parseInstructovConfigText(text);
  return config.discovery;
}

// Instruction sources whose membership changed because of a *configuration*
// change across history, holding each side's own file tree constant. Pure file
// add/delete/rename are intentionally excluded here: they are already reported
// by `git diff`, and excluding them keeps renames counted once under their new
// path. A source is membership-changed when the same path qualifies under one
// side's discovery config but not the other's.
async function membershipChangedSources(
  cwd: string,
  baselineRef: string,
  currentDiscovery: DiscoveryOptions,
  currentSourcePaths: readonly string[],
): Promise<string[]> {
  const baselineDiscovery = await readBaselineDiscovery(cwd, baselineRef);
  const baselineFiles = await listGitFiles(cwd, baselineRef);

  const removedByConfig = baselineFiles
    .map(toPosixPath)
    .filter((filePath) => isDiscoveredInstructionPath(filePath, baselineDiscovery))
    .filter((filePath) => !isDiscoveredInstructionPath(filePath, currentDiscovery));

  const addedByConfig = currentSourcePaths
    .map(toPosixPath)
    .filter((filePath) => !isDiscoveredInstructionPath(filePath, baselineDiscovery));

  return [...new Set([...removedByConfig, ...addedByConfig])]
    .sort((left, right) => left.localeCompare(right, "en"));
}

export async function getInstructionDiffComparison(
  cwd: string,
  ref: string,
  currentDiscovery: DiscoveryOptions,
  currentSourcePaths: readonly string[],
): Promise<GitDiffComparison> {
  const parsed = parseDiffRef(ref);

  try {
    const baselineRef = parsed.tripleDot
      ? (await gitOutput(["merge-base", parsed.baseRef, "HEAD"], cwd)).trim()
      : parsed.baseRef;
    const changedFiles = await gitOutput(
      ["diff", "--name-only", "--diff-filter=ACMRD", parsed.diffRef],
      cwd,
    );
    const changedInstructionSources = await membershipChangedSources(
      cwd,
      baselineRef,
      currentDiscovery,
      currentSourcePaths,
    );

    return {
      comparedRef: parsed.comparedRef,
      baselineRef,
      changedFiles: lines(changedFiles),
      changedInstructionSources,
    };
  } catch (err) {
    throw new GitDiffError(
      `Unable to compare instruction impact against "${ref}": ${errorText(err)}`,
    );
  }
}

export async function listGitFiles(cwd: string, ref: string): Promise<string[]> {
  try {
    return lines(await gitOutput(["ls-tree", "-r", "--name-only", ref], cwd));
  } catch (err) {
    throw new GitDiffError(
      `Unable to list files at "${ref}": ${errorText(err)}`,
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
