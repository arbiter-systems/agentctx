import { access } from "node:fs/promises";
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

const knownSources = [
  { path: "AGENTS.md", kind: "agents" },
  { path: "CLAUDE.md", kind: "claude" },
  { path: "GEMINI.md", kind: "gemini" },
  { path: "agentctx.yml", kind: "config" },
  { path: ".github/copilot-instructions.md", kind: "copilot" },
] as const;

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function scopePathFor(filePath: string): string {
  const directory = path.dirname(filePath);
  return directory === "." ? "." : toPosixPath(directory);
}

export async function discoverInstructionSources(
  cwd = process.cwd(),
): Promise<InstructionSource[]> {
  const rootResults = await Promise.all(
    knownSources.map(async (source) => {
      const absolutePath = path.join(cwd, source.path);
      return (await fileExists(absolutePath))
        ? { path: source.path, kind: source.kind, scopePath: "." }
        : null;
    }),
  );

  const sources: InstructionSource[] = [];
  for (const source of rootResults) {
    if (source) sources.push(source);
  }

  let skillFiles: string[];
  try {
    skillFiles = await fg("**/SKILL.md", {
      cwd,
      onlyFiles: true,
      dot: true,
      ignore: ignoredDirectories,
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new Error(`cwd does not exist or is not a directory: ${cwd}`);
    }
    throw err;
  }

  skillFiles.sort((a, b) => a.localeCompare(b, "en"));

  for (const skillFile of skillFiles) {
    const normalizedPath = toPosixPath(skillFile);
    sources.push({
      path: normalizedPath,
      kind: "skill",
      scopePath: scopePathFor(normalizedPath),
    });
  }

  return sources;
}
