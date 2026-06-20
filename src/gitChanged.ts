import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  discoveryOptionsForSources,
  instructionSourceForPath,
  type DiscoveryOptions,
  type InstructionSource,
} from "./discovery.js";

const execFileAsync = promisify(execFile);

export function toPosixPath(value: string): string {
  return value.split("\\").join("/");
}

async function gitLines(args: string[], cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(toPosixPath);
}

function isUnbornHeadError(err: unknown): boolean {
  const stderr = typeof (err as { stderr?: unknown })?.stderr === "string"
    ? (err as { stderr: string }).stderr
    : "";
  return /unknown revision|ambiguous argument|bad revision/i.test(stderr);
}

export async function getChangedFiles(cwd: string): Promise<string[]> {
  const results = new Set<string>();
  let headAvailable = true;

  try {
    for (const filePath of await gitLines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"], cwd)) {
      results.add(filePath);
    }
  } catch (err) {
    if (!isUnbornHeadError(err)) throw err;
    headAvailable = false;
  }

  if (!headAvailable) {
    for (const filePath of await gitLines(["ls-files", "--others", "--modified", "--exclude-standard"], cwd)) {
      results.add(filePath);
    }
    return [...results].sort((left, right) => left.localeCompare(right, "en"));
  }

  try {
    for (const filePath of await gitLines(["diff", "--name-only", "--diff-filter=ACMR", "--cached"], cwd)) {
      results.add(filePath);
    }
  } catch {
    // non-fatal when HEAD is available
  }

  return [...results].sort((left, right) => left.localeCompare(right, "en"));
}

export function filterToInstructionSources(
  changedFiles: string[],
  sources: InstructionSource[],
  opts: DiscoveryOptions = {},
): string[] {
  const changedPaths = changedFiles.map(toPosixPath);
  const knownPaths = new Set(sources.map((source) => toPosixPath(source.path)));
  const options = opts.include === undefined && opts.exclude === undefined
    ? discoveryOptionsForSources(sources)
    : opts;

  for (const filePath of changedPaths) {
    if (knownPaths.has(filePath)) continue;
    const source = instructionSourceForPath(filePath, options);
    if (source === undefined) continue;
    sources.push(source);
    knownPaths.add(filePath);
  }

  const changedSet = new Set(changedPaths);
  return [...knownPaths]
    .filter((filePath) => changedSet.has(filePath))
    .sort((left, right) => left.localeCompare(right, "en"));
}
