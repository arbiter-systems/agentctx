#!/usr/bin/env node
import { Command } from "commander";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { discoverInstructionSources, type InstructionSource } from "./discovery.js";
import {
  analyzeInstructionSources,
  analyzeInstructionSourcesInMemory,
  summarize,
  type AnalyzedInstructionSource,
  type DoctorSummary,
} from "./analysis.js";
import { parseSections, extractCommands, type InstructionSection, type CommandRecord } from "./parser.js";
import {
  detectFindings,
  summarizeAvoidableTokens,
  type Finding,
  type FindingCode,
  type FindingSeverity,
} from "./findings.js";
import { extractAllSkillMetadata, type SkillMetadata } from "./skillMetadata.js";
import { getChangedFiles, filterToInstructionSources, toPosixPath } from "./gitChanged.js";
import { getInstructionDiffComparison, readGitFile } from "./gitDiff.js";
import { optionalBlock, pluralize, previewItems } from "./formatting.js";
import {
  buildContextBudgetReport,
  formatBudgetText,
  type ContextBudgetReport,
} from "./budget.js";
import {
  buildSuggestResultForTask,
  formatSuggestText,
} from "./suggest.js";
import { buildBriefResult, formatBriefText } from "./brief.js";
import {
  ConfigError,
  loadAgentctxConfig,
  type AgentctxConfig,
} from "./config.js";
export type { SuggestResult } from "./suggest.js";

export type DoctorDetails = {
  sections: InstructionSection[];
  commands: CommandRecord[];
};

export type FindingCounts = Record<FindingSeverity, Partial<Record<FindingCode, number>>>;

export type DoctorDiffReport = {
  enabled: true;
  comparedRef: string;
  changedFiles: string[];
  changedInstructionFiles: string[];
  tokenDelta: number;
  currentEstimatedTokens: number;
  baselineEstimatedTokens: number;
  newFindings: Finding[];
  resolvedFindings: Finding[];
  newFindingCounts: FindingCounts;
  resolvedFindingCounts: FindingCounts;
};

export type DoctorReport = {
  command: "doctor";
  status: "ok";
  summary: DoctorSummary & {
    sectionCount?: number;
    commandCount?: number;
    findingCount: number;
    estimatedAvoidableTokens: number;
  };
  sources: AnalyzedInstructionSource[];
  findings: Finding[];
  skillMetadata: SkillMetadata[];
  details?: DoctorDetails;
  budget?: ContextBudgetReport;
  diff?: DoctorDiffReport;
  changed?: {
    enabled: boolean;
    changedFiles: string[];
    changedInstructionFiles: string[];
  };
};

type DoctorSnapshot = {
  summary: DoctorSummary & {
    sectionCount?: number;
    commandCount?: number;
    findingCount: number;
    estimatedAvoidableTokens: number;
  };
  sources: AnalyzedInstructionSource[];
  findings: Finding[];
  skillMetadata: SkillMetadata[];
  details?: DoctorDetails;
  sourceContents: ReadonlyMap<string, string>;
};

async function readSourceContents(
  cwd: string,
  sources: Array<{ path: string }>,
): Promise<Map<string, string>> {
  return new Map(
    (
      await Promise.all(
        sources.map(async (source) => {
          try {
            return [
              source.path,
              await readFile(path.join(cwd, source.path), "utf8"),
            ] as const;
          } catch {
            return null;
          }
        }),
      )
    ).filter((entry): entry is readonly [string, string] => entry !== null),
  );
}

function buildSnapshotFromAnalysis(
  analyzed: AnalyzedInstructionSource[],
  sourceContents: ReadonlyMap<string, string>,
  config: AgentctxConfig,
  opts: { details?: boolean } = {},
): DoctorSnapshot {
  const baseSummary = summarize(analyzed);
  const parsedSections: InstructionSection[] = [];
  const parsedCommands: CommandRecord[] = [];

  for (const source of analyzed) {
    const text = sourceContents.get(source.path);
    if (text === undefined) continue;

    const sections = parseSections(source.path, text);
    const commands = extractCommands(source.path, text, sections);
    parsedSections.push(...sections);
    parsedCommands.push(...commands);
  }

  const findings = detectFindings({
    sources: analyzed,
    sections: parsedSections,
    commands: parsedCommands,
  }, {
    tokenThresholds: config.doctor.token_thresholds,
  });
  const summary: DoctorReport["summary"] = {
    ...baseSummary,
    findingCount: findings.length,
    estimatedAvoidableTokens: summarizeAvoidableTokens(findings),
  };

  if (opts.details) {
    summary.sectionCount = parsedSections.length;
    summary.commandCount = parsedCommands.length;
  }

  const snapshot: DoctorSnapshot = {
    summary,
    sources: analyzed,
    findings,
    skillMetadata: extractAllSkillMetadata(analyzed, new Map(sourceContents), findings),
    sourceContents,
  };

  if (opts.details) {
    snapshot.details = { sections: parsedSections, commands: parsedCommands };
  }

  return snapshot;
}

async function buildCurrentDoctorSnapshot(
  cwd: string,
  sources: InstructionSource[],
  config: AgentctxConfig,
  opts: { details?: boolean } = {},
): Promise<DoctorSnapshot> {
  const sourceContents = await readSourceContents(cwd, sources);
  const analyzed = await analyzeInstructionSources(sources, cwd, sourceContents);
  return buildSnapshotFromAnalysis(analyzed, sourceContents, config, opts);
}

function emptySnapshot(): DoctorSnapshot {
  return {
    summary: {
      sourceCount: 0,
      bytes: 0,
      estimatedTokens: 0,
      findingCount: 0,
      estimatedAvoidableTokens: 0,
    },
    sources: [],
    findings: [],
    skillMetadata: [],
    sourceContents: new Map(),
  };
}

async function buildBaselineDoctorSnapshot(
  cwd: string,
  sources: InstructionSource[],
  baselineRef: string,
  config: AgentctxConfig,
): Promise<DoctorSnapshot> {
  const entries = await Promise.all(
    sources.map(async (source) => {
      const content = await readGitFile(cwd, baselineRef, source.path);
      return content === undefined ? null : [source.path, content] as const;
    }),
  );
  const sourceContents = new Map(
    entries.filter((entry): entry is readonly [string, string] => entry !== null),
  );
  const baselineSources = sources.filter((source) => sourceContents.has(source.path));
  const analyzed = analyzeInstructionSourcesInMemory(baselineSources, sourceContents);
  return buildSnapshotFromAnalysis(analyzed, sourceContents, config);
}

function findingIdentity(finding: Finding): string {
  return JSON.stringify({
    code: finding.code,
    severity: finding.severity,
    sourcePath: finding.sourcePath,
    message: finding.message,
    relatedSources: [...(finding.relatedSources ?? [])].sort((left, right) =>
      `${left.sourcePath}:${left.lineStart ?? ""}:${left.lineEnd ?? ""}`.localeCompare(
        `${right.sourcePath}:${right.lineStart ?? ""}:${right.lineEnd ?? ""}`,
        "en",
      ),
    ),
  });
}

function diffFindings(
  current: Finding[],
  baseline: Finding[],
): { newFindings: Finding[]; resolvedFindings: Finding[] } {
  const baselineCounts = new Map<string, number>();
  const currentCounts = new Map<string, number>();

  for (const finding of baseline) {
    const identity = findingIdentity(finding);
    baselineCounts.set(identity, (baselineCounts.get(identity) ?? 0) + 1);
  }

  for (const finding of current) {
    const identity = findingIdentity(finding);
    currentCounts.set(identity, (currentCounts.get(identity) ?? 0) + 1);
  }

  const newFindings: Finding[] = [];
  for (const finding of current) {
    const identity = findingIdentity(finding);
    const count = baselineCounts.get(identity) ?? 0;
    if (count > 0) {
      baselineCounts.set(identity, count - 1);
    } else {
      newFindings.push(finding);
    }
  }

  const resolvedFindings: Finding[] = [];
  for (const finding of baseline) {
    const identity = findingIdentity(finding);
    const count = currentCounts.get(identity) ?? 0;
    if (count > 0) {
      currentCounts.set(identity, count - 1);
    } else {
      resolvedFindings.push(finding);
    }
  }

  return { newFindings, resolvedFindings };
}

function emptyFindingCounts(): FindingCounts {
  return { high: {}, medium: {}, low: {} };
}

function countFindings(findings: Finding[]): FindingCounts {
  const counts = emptyFindingCounts();
  for (const finding of findings) {
    const severityCounts = counts[finding.severity];
    severityCounts[finding.code] = (severityCounts[finding.code] ?? 0) + 1;
  }
  return counts;
}

async function buildDoctorDiffReport(
  cwd: string,
  comparedRef: string,
  sources: InstructionSource[],
  currentSnapshot: DoctorSnapshot,
  config: AgentctxConfig,
): Promise<DoctorDiffReport> {
  const comparison = await getInstructionDiffComparison(cwd, comparedRef);
  const changedInstructionFiles = filterToInstructionSources(
    comparison.changedFiles,
    sources,
  );
  const changedSet = new Set(changedInstructionFiles);
  const diffSources = sources.filter((source) => changedSet.has(toPosixPath(source.path)));
  const isEmpty = diffSources.length === 0;
  const currentDiffSnapshot = isEmpty
    ? emptySnapshot()
    : buildSnapshotFromAnalysis(
        currentSnapshot.sources.filter((source) => changedSet.has(toPosixPath(source.path))),
        currentSnapshot.sourceContents,
        config,
      );
  const baselineSnapshot = isEmpty
    ? emptySnapshot()
    : await buildBaselineDoctorSnapshot(cwd, diffSources, comparison.baselineRef, config);
  const { newFindings, resolvedFindings } = diffFindings(
    currentDiffSnapshot.findings,
    baselineSnapshot.findings,
  );

  return {
    enabled: true,
    comparedRef: comparison.comparedRef,
    changedFiles: comparison.changedFiles,
    changedInstructionFiles,
    tokenDelta:
      currentDiffSnapshot.summary.estimatedTokens -
      baselineSnapshot.summary.estimatedTokens,
    currentEstimatedTokens: currentDiffSnapshot.summary.estimatedTokens,
    baselineEstimatedTokens: baselineSnapshot.summary.estimatedTokens,
    newFindings,
    resolvedFindings,
    newFindingCounts: countFindings(newFindings),
    resolvedFindingCounts: countFindings(resolvedFindings),
  };
}

export async function buildDoctorReport(
  cwd = process.cwd(),
  opts: {
    details?: boolean;
    changed?: boolean;
    diffRef?: string;
    config?: AgentctxConfig;
    budgetTokens?: number;
  } = {},
): Promise<DoctorReport> {
  const config = opts.config ?? await loadAgentctxConfig(cwd);
  if (opts.changed && opts.diffRef !== undefined) {
    throw new ConfigError("--changed cannot be used with --diff.");
  }

  const allSources = await discoverInstructionSources(cwd, config.discovery);

  let changedMeta: DoctorReport["changed"] | undefined;
  let sources = allSources;

  if (opts.changed) {
    const changedFiles = await getChangedFiles(cwd);
    const changedInstructionFiles = filterToInstructionSources(changedFiles, allSources);
    changedMeta = { enabled: true, changedFiles, changedInstructionFiles };

    if (changedInstructionFiles.length === 0) {
      const emptyReport: DoctorReport = {
        command: "doctor",
        status: "ok",
        summary: {
          sourceCount: 0,
          bytes: 0,
          estimatedTokens: 0,
          findingCount: 0,
          estimatedAvoidableTokens: 0,
        },
        sources: [],
        findings: [],
        skillMetadata: [],
        changed: changedMeta,
      };
      if (opts.budgetTokens !== undefined) {
        emptyReport.budget = buildContextBudgetReport({
          tokens: opts.budgetTokens,
          estimatedTokens: 0,
          savingsLimit: config.display_limits.findings,
        });
      }
      return emptyReport;
    }

    const changedSet = new Set(changedInstructionFiles);
    sources = allSources.filter((s) => changedSet.has(toPosixPath(s.path)));
  }

  const snapshot = await buildCurrentDoctorSnapshot(
    cwd,
    sources,
    config,
    opts.details === undefined ? {} : { details: opts.details },
  );
  const diff = opts.diffRef === undefined
    ? undefined
    : await buildDoctorDiffReport(cwd, opts.diffRef, allSources, snapshot, config);

  const report: DoctorReport = {
    command: "doctor",
    status: "ok",
    summary: snapshot.summary,
    sources: snapshot.sources,
    findings: snapshot.findings,
    skillMetadata: snapshot.skillMetadata,
  };

  if (snapshot.details !== undefined) {
    report.details = snapshot.details;
  }

  if (opts.budgetTokens !== undefined) {
    report.budget = buildContextBudgetReport({
      tokens: opts.budgetTokens,
      estimatedTokens: snapshot.summary.estimatedTokens,
      findings: snapshot.findings,
      savingsLimit: config.display_limits.findings,
    });
  }

  if (diff !== undefined) {
    report.diff = diff;
  }

  if (changedMeta !== undefined) {
    report.changed = changedMeta;
  }

  return report;
}

function shouldFailDoctor(
  findings: Finding[],
  failOn: readonly Finding["code"][],
): boolean {
  const failCodes = new Set(failOn);
  return findings.some((finding) => failCodes.has(finding.code));
}

function formatConfigError(err: unknown): string {
  if (err instanceof ConfigError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function parsePositiveIntegerOption(value: unknown, optionName: string): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new ConfigError(`${optionName} must be a positive integer.`);
  }
  return Number(value);
}

export function formatDoctorText(
  report: DoctorReport,
  opts: { findingsLimit?: number } = {},
): string[] {
  if (report.diff?.enabled) return formatDoctorDiffText(report.diff);

  const { summary, changed } = report;
  const isChanged = changed?.enabled === true;

  const lines: string[] = [isChanged ? "agentctx doctor --changed" : "agentctx doctor"];

  if (isChanged && changed) {
    lines.push(
      `Changed files: ${changed.changedFiles.length}, instruction sources changed: ${changed.changedInstructionFiles.length}.`,
    );
    if (changed.changedInstructionFiles.length === 0) {
      lines.push("No changed instruction sources found.");
      return lines;
    }
  }

  lines.push(
    `Discovered ${summary.sourceCount} ${pluralize(summary.sourceCount, "instruction source")}.`,
    `Estimated instruction surface: ~${summary.estimatedTokens} tokens.`,
    `Detected ${summary.findingCount} ${pluralize(summary.findingCount, "finding")}.`,
    `Estimated avoidable waste: ~${summary.estimatedAvoidableTokens} tokens.`,
    ...formatParsedCounts(summary),
    ...formatSkillMetadataCount(report.skillMetadata),
    ...formatSources(report.sources),
    ...formatFindings(report.findings, opts.findingsLimit),
    ...optionalBlock(report.budget, formatBudgetText),
  );

  return lines;
}

function formatSignedTokenDelta(tokenDelta: number): string {
  const sign = tokenDelta >= 0 ? "+" : "-";
  return `${sign}${Math.abs(tokenDelta).toLocaleString("en-US")}`;
}

function hasInstructionImpact(diff: DoctorDiffReport): boolean {
  return diff.changedInstructionFiles.length > 0 ||
    diff.tokenDelta !== 0 ||
    diff.newFindings.length > 0 ||
    diff.resolvedFindings.length > 0;
}

function formatDoctorDiffText(diff: DoctorDiffReport): string[] {
  const lines = [
    "Instruction Impact Analysis",
    "",
    `Compared against: ${diff.comparedRef}`,
    `Instruction token delta: ${formatSignedTokenDelta(diff.tokenDelta)} estimated tokens`,
    `Changed instruction sources: ${diff.changedInstructionFiles.length}`,
  ];

  if (!hasInstructionImpact(diff)) {
    return [...lines, "No changes detected."];
  }

  return [
    ...lines,
    "",
    ...formatDiffFindingSection("New findings:", diff.newFindings),
    "",
    ...formatDiffFindingSection("Resolved findings:", diff.resolvedFindings),
  ];
}

function formatDiffFindingSection(label: string, findings: Finding[]): string[] {
  if (findings.length === 0) return [label, "None."];
  return [label, ...formatFindingsBySeverity(findings)];
}

function formatSkillMetadataCount(skillMetadata: SkillMetadata[]): string[] {
  if (skillMetadata.length === 0) return [];
  return [
    `Extracted ${skillMetadata.length} ${pluralize(skillMetadata.length, "skill metadata record")}.`,
  ];
}

function formatParsedCounts(summary: DoctorReport["summary"]): string[] {
  if (summary.sectionCount !== undefined && summary.commandCount !== undefined) {
    return [
      `Parsed ${summary.sectionCount} ${pluralize(summary.sectionCount, "section")}, ${summary.commandCount} ${pluralize(summary.commandCount, "command")}.`,
    ];
  }

  return [];
}

function formatSources(sources: AnalyzedInstructionSource[]): string[] {
  return sources.map(
    (source) =>
      `- ${source.path} [${source.kind}] scope: ${source.scopePath} ~${source.estimatedTokens} tokens`,
  );
}

function formatFindings(findings: Finding[], limit = 10): string[] {
  const severityRank = { high: 0, medium: 1, low: 2 };
  const { visible: displayedFindings, omittedCount } = previewItems(
    [...findings].sort((left, right) => severityRank[left.severity] - severityRank[right.severity]),
    limit,
  );

  if (displayedFindings.length === 0) return [];

  return [
    "Findings:",
    ...formatFindingsBySeverity(displayedFindings),
    ...formatOmittedFindingCount(omittedCount),
  ];
}

function formatFindingsBySeverity(findings: Finding[]): string[] {
  const lines: string[] = [];
  const hasMissingGuidance = findings.some((finding) =>
    finding.code.startsWith("missing-"),
  );
  let warningsLabelAdded = false;

  for (const severity of ["high", "medium", "low"] as const) {
    const matching = findings.filter((finding) => finding.severity === severity);
    if (matching.length === 0) continue;

    if (severity !== "high" && hasMissingGuidance && !warningsLabelAdded) {
      lines.push("Warnings:");
      warningsLabelAdded = true;
    }

    lines.push(
      `${severity}:`,
      ...matching.map((finding) => {
        const location = finding.lineStart === undefined
          ? finding.sourcePath
          : `${finding.sourcePath}:${finding.lineStart}`;
        return `- ${finding.code} ${location} - ${finding.message}`;
      }),
    );
  }

  return lines;
}

function formatOmittedFindingCount(omittedCount: number): string[] {
  if (omittedCount <= 0) return [];

  return [`... ${omittedCount} more ${pluralize(omittedCount, "finding")} omitted.`];
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("agentctx")
    .description("Audit and streamline AI instruction files for coding agents.")
    .version("0.1.0");

  program
    .command("doctor")
    .description("Inspect instruction files and report waste, conflicts, and risks.")
    .option("--json", "Output JSON")
    .option("--details", "Include parsed sections and commands in output")
    .option("--changed", "Analyze only instruction sources changed in the working tree")
    .option("--diff <ref>", "Compare instruction impact against a git ref")
    .option("--budget <tokens>", "Approximate context budget in tokens")
    .action(async (options: {
      json?: boolean;
      details?: boolean;
      changed?: boolean;
      diff?: string;
      budget?: string;
    }) => {
      try {
        const config = await loadAgentctxConfig(process.cwd());
        const budgetTokens = options.budget === undefined
          ? undefined
          : parsePositiveIntegerOption(options.budget, "--budget");
        const report = await buildDoctorReport(process.cwd(), {
          details: options.details === true,
          changed: options.changed === true,
          ...(options.diff === undefined ? {} : { diffRef: options.diff }),
          config,
          ...(budgetTokens === undefined ? {} : { budgetTokens }),
        });

        if (shouldFailDoctor(report.findings, config.doctor.fail_on)) {
          process.exitCode = 1;
        }

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        for (const line of formatDoctorText(report, {
          findingsLimit: config.display_limits.findings,
        })) {
          console.log(line);
        }
      } catch (err) {
        process.exitCode = 2;
        console.error(formatConfigError(err));
      }
    });

  program
    .command("suggest")
    .description("Suggest relevant skill candidates for a task.")
    .argument("<task>", "Task description to classify and match")
    .option("--json", "Output JSON")
    .action(async (task: string, options: { json?: boolean }) => {
      try {
        const cwd = process.cwd();
        const config = await loadAgentctxConfig(cwd);
        const result = await buildSuggestResultForTask(cwd, task, config);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        for (const line of formatSuggestText(result, {
          excludedLimit: config.display_limits.suggest_excluded,
        })) {
          console.log(line);
        }
      } catch (err) {
        process.exitCode = 2;
        console.error(formatConfigError(err));
      }
    });

  program
    .command("brief")
    .description("Build a compact task briefing for a coding agent.")
    .argument("<task>", "Task description to brief")
    .option("--json", "Output JSON")
    .option("--budget <tokens>", "Approximate task context budget in tokens")
    .action(async (task: string, options: { json?: boolean; budget?: string }) => {
      try {
        const cwd = process.cwd();
        const config = await loadAgentctxConfig(cwd);
        const budgetTokens = options.budget === undefined
          ? undefined
          : parsePositiveIntegerOption(options.budget, "--budget");
        const suggestResult = await buildSuggestResultForTask(cwd, task, config);
        const budget = budgetTokens === undefined
          ? undefined
          : buildContextBudgetReport({
              tokens: budgetTokens,
              estimatedTokens:
                suggestResult.estimatedAvoidedContext.selectedTokens +
                suggestResult.estimatedAvoidedContext.excludedTokens,
              savingsLimit: config.display_limits.suggest_excluded,
            });
        const result = buildBriefResult(
          suggestResult,
          budget === undefined ? {} : { budget },
        );

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        for (const line of formatBriefText(result, {
          selectedLimit: config.display_limits.selected_guidance,
          excludedLimit: config.display_limits.excluded_guidance,
        })) {
          console.log(line);
        }
      } catch (err) {
        process.exitCode = 2;
        console.error(formatConfigError(err));
      }
    });

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

const entrypoint = process.argv[1];
if (entrypoint) {
  try {
    const isSelf =
      realpathSync(entrypoint) === realpathSync(fileURLToPath(import.meta.url));
    if (isSelf) await runCli();
  } catch {
    // entrypoint path doesn't exist — not running as CLI
  }
}
