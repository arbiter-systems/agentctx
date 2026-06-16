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

const ATX_HEADING_RE = /^#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/;
const FENCE_OPEN_RE = /^( {0,3})(`{3,})(.*)$/;

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

function parseAtxHeading(line: string): string | null {
  const match = ATX_HEADING_RE.exec(line);
  return match?.[1]?.trim() ?? null;
}

function parseOpeningFence(line: string): { marker: string; length: number } | null {
  const match = FENCE_OPEN_RE.exec(line);
  const marker = match?.[2];
  if (!marker) return null;

  return {
    marker: marker[0] as string,
    length: marker.length,
  };
}

function isClosingFence(line: string, fence: { marker: string; length: number }): boolean {
  let index = 0;
  while (line[index] === " " && index < 4) index++;
  if (index > 3) return false;

  let markerCount = 0;
  while (line[index + markerCount] === fence.marker) markerCount++;
  if (markerCount < fence.length) return false;

  return line.slice(index + markerCount).trim() === "";
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
    const line = (lines[i] ?? "").replace(/\r$/, "");
    const lineNum = i + 1;

    const heading = parseAtxHeading(line);
    if (heading) {
      flush(lineNum - 1);
      currentHeading = heading;
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
  let fence: { marker: string; length: number } | null = null;
  let fenceStart = 0;
  let fenceBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").replace(/\r$/, "");
    const lineNum = i + 1;

    const openingFence = parseOpeningFence(line);

    if (!inFence && openingFence) {
      inFence = true;
      fence = openingFence;
      fenceStart = lineNum;
      fenceBuffer = [];
    } else if (inFence && fence && isClosingFence(line, fence)) {
      inFence = false;
      fence = null;
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

  if (inFence) {
    const commandText = fenceBuffer.join("\n");
    if (commandText.trim()) {
      commands.push({
        sourcePath,
        commandText,
        lineStart: fenceStart,
        lineEnd: lines.length,
        sectionHeading: sectionHeadingForLine(fenceStart),
        kind: "fenced",
      });
    }
  }

  return commands;
}
