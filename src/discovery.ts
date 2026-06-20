import { realpath } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

export type InstructionSourceKind =
  | "agents"
  | "claude"
  | "gemini"
  | "copilot"
  | "skill"
  | "config";

export type InstructionSource = {
  path: string;
  kind: InstructionSourceKind;
  scopePath: string;
};

export type DiscoveryOptions = {
  include?: string[];
  exclude?: string[];
};

const defaultInclude = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".github/copilot-instructions.md",
  "instructov.yml",
  "**/SKILL.md",
];

const ignoredDirectoryNames = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
  ".venv",
  "bin",
  "obj",
];

const ignoredDirectories = ignoredDirectoryNames.map((directory) => `**/${directory}/**`);

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function scopePathFor(filePath: string): string {
  if (filePath === ".github/copilot-instructions.md" || filePath === "instructov.yml") return ".";
  const directory = path.posix.dirname(filePath);
  return directory === "." ? "." : directory;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      const slash = pattern[index + 2] === "/";
      expression += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
      continue;
    }
    if (char === "*") {
      expression += "[^/]*";
      continue;
    }
    if (char === "?") {
      expression += "[^/]";
      continue;
    }
    expression += escapeRegex(char);
  }
  return new RegExp(`${expression}$`);
}

function matchesPattern(filePath: string, pattern: string): boolean {
  return globToRegex(pattern).test(filePath);
}

function matchesInclude(filePath: string, patterns: string[]): boolean {
  let included = false;
  for (const rawPattern of patterns) {
    const excluded = rawPattern.startsWith("!");
    const pattern = excluded ? rawPattern.slice(1) : rawPattern;
    if (pattern.length === 0 || !matchesPattern(filePath, pattern)) continue;
    included = !excluded;
  }
  return included;
}

export function isDiscoveredInstructionPath(
  filePath: string,
  opts: DiscoveryOptions = {},
): boolean {
  const normalizedPath = toPosixPath(filePath);
  const include = opts.include ?? defaultInclude;
  const exclude = [...ignoredDirectories, ...(opts.exclude ?? [])];
  return matchesInclude(normalizedPath, include) && !exclude.some((pattern) => matchesPattern(normalizedPath, pattern));
}

export function kindForInstructionPath(filePath: string): InstructionSourceKind | undefined {
  if (filePath === ".github/copilot-instructions.md") return "copilot";
  if (filePath === "instructov.yml") return "config";
  if (filePath.endsWith("/SKILL.md") || filePath === "SKILL.md") return "skill";
  const basename = path.posix.basename(filePath);
  if (basename === "AGENTS.md") return "agents";
  if (basename === "CLAUDE.md") return "claude";
  if (basename === "GEMINI.md") return "gemini";
  return undefined;
}

export function instructionSourceForPath(
  filePath: string,
  opts: DiscoveryOptions = {},
): InstructionSource | undefined {
  const normalizedPath = toPosixPath(filePath);
  if (!isDiscoveredInstructionPath(normalizedPath, opts)) return undefined;
  return {
    path: normalizedPath,
    kind: kindForInstructionPath(normalizedPath) ?? "agents",
    scopePath: scopePathFor(normalizedPath),
  };
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function isSafeSource(root: string, sourcePath: string): Promise<boolean> {
  try {
    return isWithinRoot(root, await realpath(path.join(root, sourcePath)));
  } catch {
    return false;
  }
}

export async function discoverInstructionSources(
  cwd = process.cwd(),
  opts: DiscoveryOptions = {},
): Promise<InstructionSource[]> {
  let root: string;
  try {
    root = await realpath(cwd);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new Error(`cwd does not exist or is not a directory: ${cwd}`);
    }
    throw err;
  }

  const include = opts.include ?? defaultInclude;
  const exclude = [...ignoredDirectories, ...(opts.exclude ?? [])];
  let files: string[];
  try {
    files = await fg(include, {
      cwd: root,
      onlyFiles: true,
      dot: true,
      followSymbolicLinks: false,
      ignore: exclude,
      unique: true,
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new Error(`cwd does not exist or is not a directory: ${cwd}`);
    }
    throw err;
  }

  const safeFiles = await Promise.all(
    files.map(async (file) => ({ file, safe: await isSafeSource(root, file) })),
  );
  return safeFiles
    .filter((entry) => entry.safe)
    .map((entry) => toPosixPath(entry.file))
    .sort((left, right) => left.localeCompare(right, "en"))
    .flatMap((file) => {
      const source = instructionSourceForPath(file, opts);
      return source === undefined ? [] : [source];
    });
}
