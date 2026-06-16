import type { AnalyzedInstructionSource } from "./analysis.js";
import { detectMissingGuidance } from "./missingGuidance.js";
import type { CommandRecord, InstructionSection } from "./parser.js";
import { estimateTokens } from "./tokenEstimate.js";

export type FindingSeverity = "low" | "medium" | "high";

export type FindingCode =
  | "duplicate-guidance"
  | "duplicate-command"
  | "duplicate-heading"
  | "oversized-source"
  | "oversized-section"
  | "high-token-waste-source"
  | "risky-validation-command"
  | "unbounded-command"
  | "restore-heavy-command"
  | "full-repo-format-command"
  | "conflicting-branch-target"
  | "conflicting-pr-target"
  | "conflicting-validation-guidance"
  | "conflicting-format-guidance"
  | "conflicting-delegation-guidance"
  | "conflicting-destructive-action-guidance"
  | "missing-branch-guidance"
  | "missing-pr-guidance"
  | "missing-validation-guidance"
  | "missing-destructive-command-guidance"
  | "missing-skill-purpose"
  | "missing-skill-trigger";

export type ConflictSignal = {
  kind:
    | "branch-target"
    | "pr-target"
    | "validation-scope"
    | "format-scope"
    | "delegation-mode"
    | "destructive-change-mode";
  value: string;
  sourcePath: string;
  lineStart: number;
  lineEnd: number;
  matchedText: string;
};

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
  matchedText?: string;
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

function withFindingLocation(
  value: Omit<Finding, "lineStart" | "lineEnd">,
  lineStart: number | undefined,
  lineEnd: number | undefined,
): Finding {
  return {
    ...value,
    ...(lineStart === undefined ? {} : { lineStart }),
    ...(lineEnd === undefined ? {} : { lineEnd }),
  };
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

function guidanceLinesFromSection(
  section: InstructionSection,
  fencedCommands: CommandRecord[],
): LocatedValue[] {
  const values: LocatedValue[] = [];
  const lines = section.text.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const lineNumber = section.lineStart + index;
    if (
      fencedCommands.some(
        (command) =>
          command.sourcePath === section.sourcePath &&
          lineNumber >= command.lineStart &&
          lineNumber <= command.lineEnd,
      )
    ) {
      continue;
    }

    const normalized = normalizeGuidanceLine(line);
    if (!normalized) continue;

    values.push({
      normalized,
      sourcePath: section.sourcePath,
      lineStart: lineNumber,
      lineEnd: lineNumber,
      estimatedTokens: estimateTokens(normalized),
    });
  }

  return values;
}

function normalizeCommand(commandText: string): string {
  return commandText
    .replaceAll('\r\n', "\n")
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
        withFindingLocation(
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
    } else if (source.estimatedTokens >= SOURCE_WARNING_TOKENS) {
      findings.push({
        code: "oversized-source",
        severity: source.estimatedTokens >= SOURCE_HIGH_TOKENS ? "high" : "medium",
        message: "Instruction source is larger than the recommended size.",
        sourcePath: source.path,
        estimatedAvoidableTokens: source.estimatedTokens - SOURCE_WARNING_TOKENS,
        hint: "Split broad guidance into smaller scoped instruction files.",
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

type RiskyLanguagePattern = {
  pattern: RegExp;
  severity: FindingSeverity;
  message: string;
  hint: string;
};

const riskyLanguagePatterns: RiskyLanguagePattern[] = [
  {
    pattern: /\brun\s+all\s+tests\b/i,
    severity: "medium",
    message: "Validation guidance asks for all tests.",
    hint: "Prefer a focused, bounded validation command for the changed area.",
  },
  {
    pattern: /\brun\s+the\s+full\s+test\s+suite\b/i,
    severity: "medium",
    message: "Validation guidance asks for the full test suite.",
    hint: "Name the smallest relevant test target or ask before broad validation.",
  },
  {
    pattern: /\bfull\s+validation\b/i,
    severity: "medium",
    message: "Validation guidance asks for full validation.",
    hint: "Replace broad validation language with bounded checks.",
  },
  {
    pattern: /\bclean\s+validation\b/i,
    severity: "high",
    message: "Validation guidance asks for clean validation.",
    hint: "Avoid clean validation unless it is explicitly requested.",
  },
  {
    pattern: /\brun\s+all\s+checks\b/i,
    severity: "low",
    message: "Validation guidance asks for all checks.",
    hint: "Prefer naming focused checks for the touched surface.",
  },
  {
    pattern: /\bentire\s+repo\b/i,
    severity: "high",
    message: "Validation guidance targets the entire repo.",
    hint: "Scope validation to changed files, packages, or projects.",
  },
  {
    pattern: /\brecursive\b/i,
    severity: "high",
    message: "Validation guidance asks for recursive work.",
    hint: "Use explicit bounded paths instead of recursive validation.",
  },
  {
    pattern: /\bfull\s+repo\b/i,
    severity: "high",
    message: "Validation guidance targets the full repo.",
    hint: "Scope validation to changed files, packages, or projects.",
  },
];

const negationPatterns = [
  /\bdo\s+not\b/i,
  /\bdon't\b/i,
  /\bavoid\b/i,
  /\bnever\b/i,
  /\bunless\s+explicitly\s+requested\b/i,
  /\bask\s+before\b/i,
];

function isNegatedNear(text: string, matchStart: number, matchEnd: number): boolean {
  const before = text.slice(Math.max(0, matchStart - 80), matchStart);
  const after = text.slice(matchEnd, Math.min(text.length, matchEnd + 80));
  return negationPatterns.some((pattern) => pattern.test(before) || pattern.test(after));
}

function riskyValidationLanguageFindings(
  sections: InstructionSection[],
  fencedCommands: CommandRecord[],
): Finding[] {
  const findings: Finding[] = [];

  for (const section of sections) {
    const lines = section.text.split("\n");

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? "";
      const lineNumber = section.lineStart + index;
      if (
        fencedCommands.some(
          (command) =>
            command.sourcePath === section.sourcePath &&
            lineNumber >= command.lineStart &&
            lineNumber <= command.lineEnd,
        )
      ) {
        continue;
      }

      for (const riskyPattern of riskyLanguagePatterns) {
        const match = riskyPattern.pattern.exec(line);
        if (!match?.[0]) continue;
        if (isNegatedNear(line, match.index, match.index + match[0].length)) continue;

        findings.push({
          code: "risky-validation-command",
          severity: riskyPattern.severity,
          message: riskyPattern.message,
          sourcePath: section.sourcePath,
          lineStart: lineNumber,
          lineEnd: lineNumber,
          matchedText: match[0],
          hint: riskyPattern.hint,
        });
      }
    }
  }

  return findings;
}

function normalizeCommandLine(commandText: string): string {
  return commandText
    .trim()
    .replace(/^\s*(?:[$>]\s*)+/, "")
    .replace(/^[*-+]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isScopedPackageTest(command: string, packageManager: "npm" | "pnpm" | "yarn"): boolean {
  if (packageManager === "npm") return /^npm\s+test\s+--\s+\S+/i.test(command);
  if (packageManager === "pnpm") return /^pnpm\s+test\s+--filter\s+\S+/i.test(command);
  return /^yarn\s+test\s+\S+/i.test(command);
}

function riskyCommandFindingFor(command: string): Omit<Finding, "sourcePath" | "lineStart" | "lineEnd"> | null {
  if (/^dotnet\s+format\b/i.test(command) && !/\s--include(?:=|\s+\S+)/i.test(command)) {
    return {
      code: "full-repo-format-command",
      severity: "high",
      message: "Command runs broad dotnet format.",
      matchedText: command,
      hint: "Use dotnet format with --include for the changed file or path.",
    };
  }

  if (/^dotnet\s+test\b/i.test(command) && !/(?:^|\s)--no-restore(?:\s|$)/i.test(command)) {
    return {
      code: "restore-heavy-command",
      severity: "medium",
      message: "Command runs dotnet test without --no-restore.",
      matchedText: command,
      hint: "Add --no-restore after restoring explicitly or use a narrower test target.",
    };
  }

  for (const packageManager of ["npm", "pnpm", "yarn"] as const) {
    const exactTest = new RegExp(String.raw`^${packageManager}\s+test\s*$`, "i");
    if (exactTest.test(command) && !isScopedPackageTest(command, packageManager)) {
      return {
        code: "unbounded-command",
        severity: "medium",
        message: `Command runs plain ${packageManager} test.`,
        matchedText: command,
        hint: "Use a scoped test path, filter, or package-specific validation command.",
      };
    }
  }

  if (/^dotnet\s+restore\b/i.test(command)) {
    return {
      code: "restore-heavy-command",
      severity: "medium",
      message: "Command runs dotnet restore.",
      matchedText: command,
      hint: "Avoid restore-heavy commands unless the user explicitly requests dependency work.",
    };
  }

  for (const packageManager of ["npm", "pnpm", "yarn"] as const) {
    if (new RegExp(String.raw`^${packageManager}\s+install\b`, "i").test(command)) {
      return {
        code: "restore-heavy-command",
        severity: "medium",
        message: `Command runs ${packageManager} install.`,
        matchedText: command,
        hint: "Avoid install commands unless the user explicitly requests dependency work.",
      };
    }
  }

  return null;
}

function sectionLineText(
  sections: InstructionSection[],
  sourcePath: string,
  lineNumber: number,
): string | null {
  const section = sections.find(
    (candidate) =>
      candidate.sourcePath === sourcePath &&
      lineNumber >= candidate.lineStart &&
      lineNumber <= candidate.lineEnd,
  );
  if (!section) return null;

  return section.text.split("\n")[lineNumber - section.lineStart] ?? null;
}

function hasNegatedCommandContext(
  command: string,
  context: string | null,
): boolean {
  if (!context) return false;

  const commandIndex = context.toLowerCase().indexOf(command.toLowerCase());
  if (commandIndex === -1) return isNegatedNear(context, 0, context.length);

  return isNegatedNear(context, commandIndex, commandIndex + command.length);
}

function riskyCommandFindings(
  commands: CommandRecord[],
  sections: InstructionSection[],
): Finding[] {
  const findings: Finding[] = [];

  for (const commandRecord of commands) {
    const lines = commandRecord.commandText.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const command = normalizeCommandLine(lines[index] ?? "");
      if (!command) continue;

      const finding = riskyCommandFindingFor(command);
      if (!finding) continue;

      const lineNumber =
        commandRecord.kind === "fenced"
          ? commandRecord.lineStart + index + 1
          : commandRecord.lineStart;
      const context = sectionLineText(sections, commandRecord.sourcePath, lineNumber);
      if (hasNegatedCommandContext(command, context)) continue;

      findings.push({
        ...finding,
        sourcePath: commandRecord.sourcePath,
        lineStart: lineNumber,
        lineEnd: lineNumber,
      });
    }
  }

  return findings;
}

type SignalRule = {
  kind: ConflictSignal["kind"];
  value: string;
  pattern: RegExp;
};

const conflictLanguageRules: SignalRule[] = [
  {
    kind: "branch-target",
    value: "dev",
    pattern: /\bbranch(?:es|ing)?\s+(?:from|off|against)\s+`?dev`?\b/i,
  },
  {
    kind: "branch-target",
    value: "main",
    pattern: /\bbranch(?:es|ing)?\s+(?:from|off|against)\s+`?main`?\b/i,
  },
  {
    kind: "pr-target",
    value: "dev",
    pattern: /\b(?:pr|pull request)s?\s+(?:to|target|against|into)\s+`?dev`?\b/i,
  },
  {
    kind: "pr-target",
    value: "main",
    pattern: /\b(?:pr|pull request)s?\s+(?:to|target|against|into)\s+`?main`?\b/i,
  },
  {
    kind: "validation-scope",
    value: "full",
    pattern: /\brun\s+(?:all\s+tests|the\s+full\s+test\s+suite|all\s+checks)\b/i,
  },
  {
    kind: "validation-scope",
    value: "full",
    pattern: /\bfull\s+validation\b/i,
  },
  {
    kind: "validation-scope",
    value: "bounded",
    pattern: /\b(?:focused|bounded|scoped)\s+(?:tests|validation|checks)\b/i,
  },
  {
    kind: "validation-scope",
    value: "bounded",
    pattern: /\b(?:tests|validation|checks)\b.{0,48}\bchanged files only\b/i,
  },
  {
    kind: "format-scope",
    value: "full",
    pattern:
      /\b(?:full\s+repo\s+format|full\s+format|format\s+(?:the\s+)?(?:entire|whole)\s+repo)\b/i,
  },
  {
    kind: "format-scope",
    value: "bounded",
    pattern: /\bformat\b.{0,48}\bchanged files only\b/i,
  },
  {
    kind: "delegation-mode",
    value: "delegate",
    pattern: /\b(?:use|spawn)\s+subagents\b/i,
  },
  {
    kind: "delegation-mode",
    value: "delegate",
    pattern: /\bdelegate\s+to\s+subagents\b/i,
  },
  {
    kind: "delegation-mode",
    value: "main-session-only",
    pattern:
      /\b(?:main session only|do not use subagents|don't use subagents|no subagents|without subagents)\b/i,
  },
  {
    kind: "destructive-change-mode",
    value: "auto-fix",
    pattern: /\b(?:auto-?fix|fix all issues automatically|apply fixes without asking)\b/i,
  },
  {
    kind: "destructive-change-mode",
    value: "ask-before-change",
    pattern: /\bask before (?:destructive )?(?:changes|actions|edits|changing)\b/i,
  },
  {
    kind: "destructive-change-mode",
    value: "ask-before-change",
    pattern: /\bdo not (?:modify|delete|change) without asking\b/i,
  },
];

function commandConflictSignalFor(command: string): Pick<ConflictSignal, "kind" | "value" | "matchedText"> | null {
  if (/^dotnet\s+format\b/i.test(command)) {
    return {
      kind: "format-scope",
      value: /\s--include(?:=|\s+\S+)/i.test(command) ? "bounded" : "full",
      matchedText: command,
    };
  }

  if (/^dotnet\s+test\b/i.test(command)) {
    const hasProjectPath = /^dotnet\s+test\s+\S+/i.test(command) &&
      !/^dotnet\s+test\s+--/i.test(command);
    return {
      kind: "validation-scope",
      value: hasProjectPath ? "bounded" : "full",
      matchedText: command,
    };
  }

  if (/^(?:npm|pnpm|yarn)\s+test(?:\s|$)/i.test(command)) {
    return {
      kind: "validation-scope",
      value: /^npm\s+test\s+--\s+\S+/i.test(command) ||
        /^pnpm\s+test\s+--filter\s+\S+/i.test(command) ||
        /^yarn\s+test\s+\S+/i.test(command)
        ? "bounded"
        : "full",
      matchedText: command,
    };
  }

  return null;
}

function conflictSignalsFromSection(
  section: InstructionSection,
  fencedCommands: CommandRecord[],
): ConflictSignal[] {
  const signals: ConflictSignal[] = [];
  const lines = section.text.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const lineNumber = section.lineStart + index;
    if (
      fencedCommands.some(
        (command) =>
          command.sourcePath === section.sourcePath &&
          lineNumber >= command.lineStart &&
          lineNumber <= command.lineEnd,
      )
    ) {
      continue;
    }

    for (const rule of conflictLanguageRules) {
      const match = rule.pattern.exec(line);
      if (!match?.[0]) continue;
      signals.push({
        kind: rule.kind,
        value: rule.value,
        sourcePath: section.sourcePath,
        lineStart: lineNumber,
        lineEnd: lineNumber,
        matchedText: match[0],
      });
    }
  }

  return signals;
}

function conflictSignalsFromCommand(commandRecord: CommandRecord): ConflictSignal[] {
  const signals: ConflictSignal[] = [];
  const lines = commandRecord.commandText.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const command = normalizeCommandLine(lines[index] ?? "");
    if (!command) continue;

    const commandSignal = commandConflictSignalFor(command);
    if (!commandSignal) continue;

    const lineNumber =
      commandRecord.kind === "fenced"
        ? commandRecord.lineStart + index + 1
        : commandRecord.lineStart;
    signals.push({
      ...commandSignal,
      sourcePath: commandRecord.sourcePath,
      lineStart: lineNumber,
      lineEnd: lineNumber,
    });
  }

  return signals;
}

export function extractConflictSignals(input: {
  sections: InstructionSection[];
  commands: CommandRecord[];
}): ConflictSignal[] {
  const fencedCommands = input.commands.filter((command) => command.kind === "fenced");

  return [
    ...input.sections.flatMap((section) => conflictSignalsFromSection(section, fencedCommands)),
    ...input.commands.flatMap(conflictSignalsFromCommand),
  ];
}

type ConflictRule = {
  kind: ConflictSignal["kind"];
  values: readonly [string, string];
  code: Extract<
    FindingCode,
    | "conflicting-branch-target"
    | "conflicting-pr-target"
    | "conflicting-validation-guidance"
    | "conflicting-format-guidance"
    | "conflicting-delegation-guidance"
    | "conflicting-destructive-action-guidance"
  >;
  severity: FindingSeverity;
  message: string;
  hint: string;
};

const conflictRules: ConflictRule[] = [
  {
    kind: "branch-target",
    values: ["dev", "main"],
    code: "conflicting-branch-target",
    severity: "medium",
    message: "Instruction files contain conflicting branch target guidance.",
    hint: "Keep one explicit branch target for this repository.",
  },
  {
    kind: "pr-target",
    values: ["dev", "main"],
    code: "conflicting-pr-target",
    severity: "medium",
    message: "Instruction files contain conflicting pull request target guidance.",
    hint: "Keep one explicit PR target branch for this repository.",
  },
  {
    kind: "validation-scope",
    values: ["full", "bounded"],
    code: "conflicting-validation-guidance",
    severity: "medium",
    message: "Instruction files mix full and bounded validation guidance.",
    hint: "Choose one validation scope and make exceptions explicit.",
  },
  {
    kind: "format-scope",
    values: ["full", "bounded"],
    code: "conflicting-format-guidance",
    severity: "medium",
    message: "Instruction files mix full-repo and changed-file formatting guidance.",
    hint: "Prefer one formatting scope and keep command examples aligned.",
  },
  {
    kind: "delegation-mode",
    values: ["delegate", "main-session-only"],
    code: "conflicting-delegation-guidance",
    severity: "medium",
    message: "Instruction files conflict on whether to delegate work to subagents.",
    hint: "Keep delegation guidance in one explicit mode.",
  },
  {
    kind: "destructive-change-mode",
    values: ["auto-fix", "ask-before-change"],
    code: "conflicting-destructive-action-guidance",
    severity: "high",
    message: "Instruction files conflict on destructive or automatic change guidance.",
    hint: "Require explicit approval before destructive or automatic changes.",
  },
];

function firstSignal(
  signals: ConflictSignal[],
  kind: ConflictSignal["kind"],
  value: string,
): ConflictSignal | undefined {
  return signals.find((signal) => signal.kind === kind && signal.value === value);
}

function conflictFindings(signals: ConflictSignal[]): Finding[] {
  const findings: Finding[] = [];

  for (const rule of conflictRules) {
    const first = firstSignal(signals, rule.kind, rule.values[0]);
    const second = firstSignal(signals, rule.kind, rule.values[1]);
    // Intra-file conflicts (same sourcePath) are not reported; they are visible
    // to the author in a single file and would produce noisy duplicate findings.
    if (!first || !second || first.sourcePath === second.sourcePath) continue;

    findings.push({
      code: rule.code,
      severity: rule.severity,
      message: rule.message,
      sourcePath: first.sourcePath,
      lineStart: first.lineStart,
      lineEnd: first.lineEnd,
      matchedText: first.matchedText,
      relatedSources: [
        {
          sourcePath: second.sourcePath,
          lineStart: second.lineStart,
          lineEnd: second.lineEnd,
        },
      ],
      hint: rule.hint,
    });
  }

  return findings;
}

export function detectFindings(input: {
  sources: AnalyzedInstructionSource[];
  sections: InstructionSection[];
  commands: CommandRecord[];
}): Finding[] {
  const fencedCommands = input.commands.filter((command) => command.kind === "fenced");
  const signals = extractConflictSignals({
    sections: input.sections,
    commands: input.commands,
  });
  const guidanceValues = input.sections.flatMap((section) =>
    guidanceLinesFromSection(section, fencedCommands),
  );
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
    ...conflictFindings(signals),
    ...riskyValidationLanguageFindings(input.sections, fencedCommands),
    ...riskyCommandFindings(input.commands, input.sections),
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
    ...detectMissingGuidance({
      sources: input.sources,
      sections: input.sections,
    }),
  ];
}

export function summarizeAvoidableTokens(findings: Finding[]): number {
  return findings.reduce(
    (total, finding) => total + (finding.estimatedAvoidableTokens ?? 0),
    0,
  );
}
