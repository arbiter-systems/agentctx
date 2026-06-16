import { estimateTokens } from "./tokenEstimate.js";

export type InstructionSection = {
  sourcePath: string;
  heading: string;
  text: string;
  normalizedText: string;
  estimatedTokens: number;
  lineStart: number;
  lineEnd: number;
};

export type CommandRecord = {
  sourcePath: string;
  commandText: string;
  lineStart: number;
  lineEnd: number;
  sectionHeading: string | undefined;
  kind: "fenced" | "inline";
};

const ATX_HEADING_RE = /^#{1,6} /;

const INLINE_PREFIXES = [
  "npm",
  "pnpm",
  "yarn",
  "npx",
  "node",
  "dotnet",
  "git",
  "pytest",
  "python",
  "tsx",
  "tsc",
  "vitest",
];

const INLINE_COMMAND_RE = new RegExp(
  `\`((?:${INLINE_PREFIXES.join("|")})\\s[^\`]+)\``,
  "g",
);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/^[ \t]*\d+\.[ \t]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSections(
  sourcePath: string,
  text: string,
): InstructionSection[] {
  if (!text.trim()) return [];

  const lines = text.split("\n");
  const totalLines = lines.length;
  const sections: InstructionSection[] = [];

  let currentHeading = "(root)";
  let currentStart = 1;
  let currentBuffer: string[] = [];

  const flush = (endLine: number): void => {
    const sectionText = currentBuffer.join("\n");
    if (!sectionText.trim()) return;
    sections.push({
      sourcePath,
      heading: currentHeading,
      text: sectionText,
      normalizedText: normalizeText(sectionText),
      estimatedTokens: estimateTokens(sectionText),
      lineStart: currentStart,
      lineEnd: endLine,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNum = i + 1;

    if (ATX_HEADING_RE.test(line)) {
      flush(lineNum - 1);
      currentHeading = line.replace(/^#{1,6} /, "").trim();
      currentStart = lineNum;
      currentBuffer = [line];
    } else {
      currentBuffer.push(line);
    }
  }

  flush(totalLines);

  return sections;
}

export function extractCommands(
  sourcePath: string,
  text: string,
  sections: InstructionSection[],
): CommandRecord[] {
  const commands: CommandRecord[] = [];
  const lines = text.split("\n");

  const sectionHeadingForLine = (lineNum: number): string | undefined => {
    for (const section of sections) {
      if (lineNum >= section.lineStart && lineNum <= section.lineEnd) {
        return section.heading === "(root)" ? undefined : section.heading;
      }
    }
    return undefined;
  };

  let inFence = false;
  let fenceStart = 0;
  let fenceBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNum = i + 1;

    if (!inFence && line.trimStart().startsWith("```")) {
      inFence = true;
      fenceStart = lineNum;
      fenceBuffer = [];
    } else if (inFence && line.trimStart().startsWith("```")) {
      inFence = false;
      const commandText = fenceBuffer.join("\n");
      if (commandText.trim()) {
        commands.push({
          sourcePath,
          commandText,
          lineStart: fenceStart,
          lineEnd: lineNum,
          sectionHeading: sectionHeadingForLine(fenceStart),
          kind: "fenced",
        });
      }
      fenceBuffer = [];
    } else if (inFence) {
      fenceBuffer.push(line);
    } else {
      INLINE_COMMAND_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = INLINE_COMMAND_RE.exec(line)) !== null) {
        commands.push({
          sourcePath,
          commandText: match[1] ?? "",
          lineStart: lineNum,
          lineEnd: lineNum,
          sectionHeading: sectionHeadingForLine(lineNum),
          kind: "inline",
        });
      }
    }
  }

  return commands;
}
