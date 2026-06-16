import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { InstructionSource } from "./discovery.js";

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

export async function getChangedFiles(cwd: string): Promise<string[]> {
  const results = new Set<string>();
  let headAvailable = true;

  try {
    for (const p of await gitLines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"], cwd)) {
      results.add(p);
    }
  } catch {
    headAvailable = false;
  }

  if (!headAvailable) {
    // HEAD unavailable (initial commit) — fall back to ls-files
    for (const p of await gitLines(["ls-files", "--others", "--modified", "--exclude-standard"], cwd)) {
      results.add(p);
    }
    return [...results].sort();
  }

  try {
    for (const p of await gitLines(["diff", "--name-only", "--diff-filter=ACMR", "--cached"], cwd)) {
      results.add(p);
    }
  } catch {
    // non-fatal when HEAD is available
  }

  return [...results].sort();
}

export function filterToInstructionSources(
  changedFiles: string[],
  sources: InstructionSource[],
): string[] {
  const changedSet = new Set(changedFiles.map(toPosixPath));
  return sources
    .map((s) => toPosixPath(s.path))
    .filter((p) => changedSet.has(p));
}
