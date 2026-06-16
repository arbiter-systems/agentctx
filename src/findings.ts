import type { AnalyzedInstructionSource } from "./analysis.js";
import type { CommandRecord, InstructionSection } from "./parser.js";
import { estimateTokens } from "./tokenEstimate.js";

export type FindingSeverity = "low" | "medium" | "high";

export type FindingCode =
  | "duplicate-guidance"
  | "duplicate-command"
  | "duplicate-heading"
  | "oversized-source"
  | "oversized-section"
  | "high-token-waste-source";

export type Finding = {
  code: FindingCode;
  severity: FindingSeverity;
  message: string;
  sourcePath: string;
  lineStart?: number;
  lineEnd?: number;
  relatedSources?: Array<{
    sourcePath: string;
    lineStart?: number;
    lineEnd?: number;
  }>;
  estimatedAvoidableTokens?: number;
  hint?: string;
};

const MIN_GUIDANCE_LINE_LENGTH = 20;
const SOURCE_WARNING_TOKENS = 1200;
const SOURCE_HIGH_TOKENS = 2000;
const HIGH_TOKEN_WASTE_SOURCE_TOKENS = 3000;
const SECTION_WARNING_TOKENS = 500;

type LocatedValue = {
  normalized: string;
  sourcePath: string;
  lineStart?: number;
  lineEnd?: number;
  estimatedTokens: number;
};

function relatedSource(value: LocatedValue): {
  sourcePath: string;
  lineStart?: number;
  lineEnd?: number;
} {
  const source: {
    sourcePath: string;
    lineStart?: number;
    lineEnd?: number;
  } = {
    sourcePath: value.sourcePath,
  };
  if (value.lineStart !== undefined) source.lineStart = value.lineStart;
  if (value.lineEnd !== undefined) source.lineEnd = value.lineEnd;
  return source;
}

function withLocation<T extends Finding | LocatedValue>(
  value: T,
  lineStart: number | undefined,
  lineEnd: number | undefined,
): T {
  if (lineStart !== undefined) value.lineStart = lineStart;
  if (lineEnd !== undefined) value.lineEnd = lineEnd;
  return value;
}

function normalizeGuidanceLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (/^#{1,6}\s/.test(trimmed)) return null;
  if (/^`{3,}/.test(trimmed)) return null;

  const withoutMarkdown = trimmed
    .replace(/^[*-+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/[*_`[\]()>#|~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (withoutMarkdown.length < MIN_GUIDANCE_LINE_LENGTH) return null;
  if (!/[a-z0-9]/.test(withoutMarkdown)) return null;

  return withoutMarkdown;
}

function guidanceLinesFromSection(section: InstructionSection): LocatedValue[] {
  const values: LocatedValue[] = [];
  const lines = section.text.split("\n");
  let inFence = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const normalized = normalizeGuidanceLine(line);
    if (!normalized) continue;

    values.push({
      normalized,
      sourcePath: section.sourcePath,
      lineStart: section.lineStart + index,
      lineEnd: section.lineStart + index,
      estimatedTokens: estimateTokens(normalized),
    });
  }

  return values;
}

function normalizeCommand(commandText: string): string {
  return commandText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeHeading(heading: string): string | null {
  if (heading === "(root)") return null;
  const normalized = heading.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized || null;
}

function duplicateFindings(
  values: LocatedValue[],
  code: Extract<FindingCode, "duplicate-guidance" | "duplicate-command" | "duplicate-heading">,
  severity: FindingSeverity,
  message: string,
  hint: string,
): Finding[] {
  const byValue = new Map<string, LocatedValue[]>();
  for (const value of values) {
    const group = byValue.get(value.normalized) ?? [];
    group.push(value);
    byValue.set(value.normalized, group);
  }

  const findings: Finding[] = [];
  for (const group of byValue.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    if (!first) continue;

    for (const duplicate of group.slice(1)) {
      findings.push(
        withLocation(
          {
            code,
            severity,
            message,
            sourcePath: duplicate.sourcePath,
            relatedSources: [relatedSource(first)],
            estimatedAvoidableTokens: duplicate.estimatedTokens,
            hint,
          },
          duplicate.lineStart,
          duplicate.lineEnd,
        ),
      );
    }
  }

  return findings;
}

function sourceSizeFindings(sources: AnalyzedInstructionSource[]): Finding[] {
  const findings: Finding[] = [];

  for (const source of sources) {
    if (source.estimatedTokens >= SOURCE_WARNING_TOKENS) {
      findings.push({
        code: "oversized-source",
        severity: source.estimatedTokens >= SOURCE_HIGH_TOKENS ? "high" : "medium",
        message: "Instruction source is larger than the recommended size.",
        sourcePath: source.path,
        estimatedAvoidableTokens: source.estimatedTokens - SOURCE_WARNING_TOKENS,
        hint: "Split broad guidance into smaller scoped instruction files.",
      });
    }

    if (source.estimatedTokens >= HIGH_TOKEN_WASTE_SOURCE_TOKENS) {
      findings.push({
        code: "high-token-waste-source",
        severity: "high",
        message: "Instruction source has high estimated token waste.",
        sourcePath: source.path,
        estimatedAvoidableTokens:
          source.estimatedTokens - HIGH_TOKEN_WASTE_SOURCE_TOKENS,
        hint: "Prioritize reducing or scoping this file before adding more guidance.",
      });
    }
  }

  return findings;
}

function sectionSizeFindings(sections: InstructionSection[]): Finding[] {
  return sections
    .filter((section) => section.estimatedTokens >= SECTION_WARNING_TOKENS)
    .map((section) => ({
      code: "oversized-section" as const,
      severity: "medium" as const,
      message: "Instruction section is larger than the recommended size.",
      sourcePath: section.sourcePath,
      lineStart: section.lineStart,
      lineEnd: section.lineEnd,
      estimatedAvoidableTokens: section.estimatedTokens - SECTION_WARNING_TOKENS,
      hint: "Split this section into narrower task-specific guidance.",
    }));
}

export function detectFindings(input: {
  sources: AnalyzedInstructionSource[];
  sections: InstructionSection[];
  commands: CommandRecord[];
}): Finding[] {
  const guidanceValues = input.sections.flatMap(guidanceLinesFromSection);
  const commandValues = input.commands
    .map((command) => {
      const normalized = normalizeCommand(command.commandText);
      return {
        normalized,
        sourcePath: command.sourcePath,
        lineStart: command.lineStart,
        lineEnd: command.lineEnd,
        estimatedTokens: estimateTokens(normalized),
      };
    })
    .filter((command) => command.normalized.length > 0);
  const headingValues: LocatedValue[] = [];
  for (const section of input.sections) {
    const normalized = normalizeHeading(section.heading);
    if (!normalized) continue;
    headingValues.push({
      normalized,
      sourcePath: section.sourcePath,
      lineStart: section.lineStart,
      lineEnd: section.lineStart,
      estimatedTokens: estimateTokens(normalized),
    });
  }

  return [
    ...duplicateFindings(
      guidanceValues,
      "duplicate-guidance",
      "medium",
      "Guidance line repeats elsewhere.",
      "Keep the guidance in one scoped location and remove repeated copies.",
    ),
    ...duplicateFindings(
      commandValues,
      "duplicate-command",
      "medium",
      "Command block repeats elsewhere.",
      "Keep repeated command guidance in one place.",
    ),
    ...duplicateFindings(
      headingValues,
      "duplicate-heading",
      "low",
      "Heading repeats elsewhere.",
      "Rename repeated headings or merge overlapping sections.",
    ),
    ...sourceSizeFindings(input.sources),
    ...sectionSizeFindings(input.sections),
  ];
}

export function summarizeAvoidableTokens(findings: Finding[]): number {
  return findings.reduce(
    (total, finding) => total + (finding.estimatedAvoidableTokens ?? 0),
    0,
  );
}
