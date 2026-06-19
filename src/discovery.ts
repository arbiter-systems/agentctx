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

// **/dir/** matches root-level dir in fast-glob (** matches zero segments)
const ignoredDirectories = ignoredDirectoryNames.map((d) => `**/${d}/**`);

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function scopePathFor(filePath: string): string {
  if (filePath === ".github/copilot-instructions.md") return ".";
  const directory = path.dirname(filePath);
  return directory === "." ? "." : toPosixPath(directory);
}

function kindForPath(filePath: string): InstructionSourceKind {
  if (filePath === ".github/copilot-instructions.md") return "copilot";
  if (filePath === "instructov.yml") return "config";
  if (filePath.endsWith("/SKILL.md") || filePath === "SKILL.md") return "skill";
  if (path.posix.basename(filePath) === "AGENTS.md") return "agents";
  if (path.posix.basename(filePath) === "CLAUDE.md") return "claude";
  if (path.posix.basename(filePath) === "GEMINI.md") return "gemini";
  return "agents";
}

function isWithinRoot(root: string, candidate: string): boolean {
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
  files = safeFiles
    .filter((entry) => entry.safe)
    .map((entry) => toPosixPath(entry.file))
    .sort((a, b) => a.localeCompare(b, "en"));

  return files.map((file) => ({
    path: file,
    kind: kindForPath(file),
    scopePath: scopePathFor(file),
  }));
}
