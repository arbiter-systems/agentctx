import type { AnalyzedInstructionSource } from "./analysis.js";
import type { Finding, FindingCode, FindingSeverity } from "./findings.js";
import type { InstructionSection } from "./parser.js";

export const MIN_TOTAL_SOURCES = 2;
export const MIN_TOTAL_ESTIMATED_TOKENS = 300;

const MIN_TOTAL_TEXT_LENGTH = MIN_TOTAL_ESTIMATED_TOKENS * 4;
const MIN_SKILL_TEXT_LENGTH = 80;

type MissingGuidanceCode = Extract<
  FindingCode,
  | "missing-branch-guidance"
  | "missing-pr-guidance"
  | "missing-validation-guidance"
  | "missing-destructive-command-guidance"
  | "missing-skill-purpose"
  | "missing-skill-trigger"
>;

type MissingGuidanceRule = {
  code: MissingGuidanceCode;
  severity: FindingSeverity;
  message: string;
  hint: string;
  isPresent: (text: string) => boolean;
};

const globalMissingGuidanceRules: MissingGuidanceRule[] = [
  {
    code: "missing-branch-guidance",
    severity: "medium",
    message: "Instruction sources do not define branch creation guidance.",
    hint: "Add explicit branch guidance such as the base branch or branch naming expectation.",
    isPresent: (text) =>
      /\bbranch\s+(?:from|off)\b/i.test(text) ||
      /\bbase branch\b/i.test(text) ||
      /\bcreate branch\b/i.test(text) ||
      /\bbranch name\b/i.test(text),
  },
  {
    code: "missing-pr-guidance",
    severity: "medium",
    message: "Instruction sources do not define pull request target guidance.",
    hint: "Add explicit PR target guidance so publication targets are unambiguous.",
    isPresent: (text) =>
      /\bpr target\b/i.test(text) ||
      /\bpull request to\b/i.test(text) ||
      /\bopen pr to\b/i.test(text) ||
      /\btarget branch\b/i.test(text) ||
      /\b(?:pr|pull request)\b.{0,48}\bbase branch\b/i.test(text) ||
      /\bbase branch\b.{0,48}\b(?:pr|pull request)\b/i.test(text),
  },
  {
    code: "missing-validation-guidance",
    severity: "medium",
    message: "Instruction sources do not define bounded validation guidance.",
    hint: "Add bounded validation guidance such as scoped tests or when to ask before full validation.",
    isPresent: (text) =>
      /\bbounded validation\b/i.test(text) ||
      /\bchanged-file validation\b/i.test(text) ||
      /\bscoped tests\b/i.test(text) ||
      /(?:^|\s)--no-restore(?:\s|$)/i.test(text) ||
      /\b(?:ask|prompt) before full validation\b/i.test(text) ||
      /\bdo not run full validation\b/i.test(text),
  },
  {
    code: "missing-destructive-command-guidance",
    severity: "low",
    message: "Instruction sources do not define destructive command safety guidance.",
    hint: "Add guidance to ask or confirm before destructive commands or irreversible edits.",
    isPresent: (text) =>
      /\bask before destructive\b/i.test(text) ||
      /\bconfirm before\b/i.test(text) ||
      /\bprompt before\b/i.test(text) ||
      /\bdo not delete\b/i.test(text) ||
      /\bdo not overwrite\b/i.test(text) ||
      /\bdo not force push\b/i.test(text) ||
      /\bavoid destructive\b/i.test(text) ||
      /\bdestructive command\b/i.test(text),
  },
];

const skillMissingGuidanceRules: MissingGuidanceRule[] = [
  {
    code: "missing-skill-purpose",
    severity: "low",
    message: "Skill file does not describe its purpose.",
    hint: "Add a short purpose, goal, summary, or description for this skill.",
    isPresent: (text) =>
      /\bpurpose\b/i.test(text) ||
      /\bgoal\b/i.test(text) ||
      /\bsummary:/i.test(text) ||
      /\bdescription:/i.test(text) ||
      /\buse this skill\b/i.test(text) ||
      /\bwhat this skill does\b/i.test(text),
  },
  {
    code: "missing-skill-trigger",
    severity: "low",
    message: "Skill file does not describe when it should be used.",
    hint: "Add trigger guidance such as when to use, use when, tasks, or applies to.",
    isPresent: (text) =>
      /\btrigger\b/i.test(text) ||
      /\btriggers:/i.test(text) ||
      /\btasks:/i.test(text) ||
      /\bwhen to use\b/i.test(text) ||
      /\buse when\b/i.test(text) ||
      /\bapplies to\b/i.test(text),
  },
];

function sourceTexts(sections: InstructionSection[]): Map<string, string> {
  const bySource = new Map<string, string[]>();
  for (const section of sections) {
    const values = bySource.get(section.sourcePath) ?? [];
    values.push(section.text);
    bySource.set(section.sourcePath, values);
  }

  return new Map(
    [...bySource].map(([sourcePath, values]) => [sourcePath, values.join("\n")]),
  );
}

function shouldCheckGlobalGuidance(
  sources: AnalyzedInstructionSource[],
  textBySource: ReadonlyMap<string, string>,
): boolean {
  if (sources.length < MIN_TOTAL_SOURCES) return false;

  const totalTokens = sources.reduce(
    (total, source) => total + source.estimatedTokens,
    0,
  );
  if (totalTokens >= MIN_TOTAL_ESTIMATED_TOKENS) return true;
  // If token estimation produced any result (even a small one), trust it and skip
  // the text-length fallback. The fallback only applies when all sources failed to
  // read (estimatedTokens === 0 for every source).
  if (totalTokens > 0) return false;

  const totalTextLength = [...textBySource.values()].reduce(
    (total, text) => total + text.length,
    0,
  );
  return totalTextLength >= MIN_TOTAL_TEXT_LENGTH;
}

function globalText(textBySource: ReadonlyMap<string, string>): string {
  return [...textBySource.values()].join("\n");
}

function missingFinding(
  rule: MissingGuidanceRule,
  sourcePath: string,
): Finding {
  return {
    code: rule.code,
    severity: rule.severity,
    message: rule.message,
    sourcePath,
    hint: rule.hint,
  };
}

export function detectMissingGuidance(input: {
  sources: AnalyzedInstructionSource[];
  sections: InstructionSection[];
}): Finding[] {
  const textBySource = sourceTexts(input.sections);
  const findings: Finding[] = [];

  if (shouldCheckGlobalGuidance(input.sources, textBySource)) {
    const text = globalText(textBySource);
    for (const rule of globalMissingGuidanceRules) {
      if (!rule.isPresent(text)) {
        findings.push(missingFinding(rule, "."));
      }
    }
  }

  for (const source of input.sources) {
    if (source.kind !== "skill") continue;

    const text = textBySource.get(source.path) ?? "";
    if (text.trim().length < MIN_SKILL_TEXT_LENGTH) continue;

    for (const rule of skillMissingGuidanceRules) {
      if (!rule.isPresent(text)) {
        findings.push(missingFinding(rule, source.path));
      }
    }
  }

  return findings;
}
