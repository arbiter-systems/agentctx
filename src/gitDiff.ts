import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { loadinstructovConfig, parseInstructovConfigText } from "./config.js";
import {
  discoverInstructionSources,
  instructionSourceForPath,
  type InstructionSource,
} from "./discovery.js";

const execFileAsync = promisify(execFile);
const syntheticSourcePrefix = "__instructov_diff_source__:";

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

function sourcePaths(sources: InstructionSource[]): Set<string> {
  return new Set(sources.map((source) => toPosixPath(source.path)));
}

function encodeSyntheticInstructionSource(source: InstructionSource): string {
  return `${syntheticSourcePrefix}${JSON.stringify(source)}`;
}

export function decodeSyntheticInstructionSource(value: string): InstructionSource | undefined {
  if (!value.startsWith(syntheticSourcePrefix)) return undefined;

  try {
    const parsed: unknown = JSON.parse(value.slice(syntheticSourcePrefix.length));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { path?: unknown }).path !== "string" ||
      typeof (parsed as { kind?: unknown }).kind !== "string" ||
      typeof (parsed as { scopePath?: unknown }).scopePath !== "string"
    ) {
      return undefined;
    }
    return parsed as InstructionSource;
  } catch {
    return undefined;
  }
}

async function baselineConfig(cwd: string, baselineRef: string) {
  const text = await readGitFile(cwd, baselineRef, "instructov.yml");
  return text === undefined
    ? parseInstructovConfigText("version: v0alpha1\n")
    : parseInstructovConfigText(text);
}

async function baselineSources(cwd: string, baselineRef: string): Promise<InstructionSource[]> {
  const config = await baselineConfig(cwd, baselineRef);
  const files = await listGitFiles(cwd, baselineRef);
  return files.flatMap((filePath) => {
    const source = instructionSourceForPath(filePath, config.discovery);
    return source === undefined ? [] : [source];
  });
}

async function sourceMembershipChanges(
  cwd: string,
  baselineRef: string,
): Promise<string[]> {
  const [currentConfig, baseline] = await Promise.all([
    loadinstructovConfig(cwd),
    baselineSources(cwd, baselineRef),
  ]);
  const current = await discoverInstructionSources(cwd, currentConfig.discovery);
  const currentPaths = sourcePaths(current);
  const baselinePaths = sourcePaths(baseline);
  const changes: string[] = [];

  for (const source of [...baseline, ...current]) {
    const sourcePath = toPosixPath(source.path);
    if (currentPaths.has(sourcePath) === baselinePaths.has(sourcePath)) continue;
    changes.push(encodeSyntheticInstructionSource(source));
  }

  return [...new Set(changes)].sort((left, right) => left.localeCompare(right, "en"));
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
    const changedFiles = await gitOutput(
      ["diff", "--name-only", "--diff-filter=ACMRD", parsed.diffRef],
      cwd,
    );
    const membershipChanges = await sourceMembershipChanges(cwd, baselineRef);

    return {
      comparedRef: parsed.comparedRef,
      baselineRef,
      changedFiles: [...new Set([...lines(changedFiles), ...membershipChanges])]
        .sort((left, right) => left.localeCompare(right, "en")),
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
