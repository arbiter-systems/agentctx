#!/usr/bin/env node
import { Command } from "commander";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { discoverInstructionSources } from "./discovery.js";
import { analyzeInstructionSources, summarize, type AnalyzedInstructionSource, type DoctorSummary } from "./analysis.js";
import { parseSections, extractCommands, type InstructionSection, type CommandRecord } from "./parser.js";
import { detectFindings, summarizeAvoidableTokens, type Finding } from "./findings.js";
import { extractAllSkillMetadata, type SkillMetadata } from "./skillMetadata.js";
import { getChangedFiles, filterToInstructionSources, toPosixPath } from "./gitChanged.js";
import {
  buildCandidates,
  classifyTask,
  formatSuggestText,
  selectCandidates,
} from "./suggest.js";
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
  changed?: {
    enabled: boolean;
    changedFiles: string[];
    changedInstructionFiles: string[];
  };
};

export async function buildDoctorReport(
  cwd = process.cwd(),
  opts: { details?: boolean; changed?: boolean; config?: AgentctxConfig } = {},
): Promise<DoctorReport> {
  const config = opts.config ?? await loadAgentctxConfig(cwd);
  const allSources = await discoverInstructionSources(cwd, config.discovery);

  let changedMeta: DoctorReport["changed"] | undefined;
  let sources = allSources;

  if (opts.changed) {
    const changedFiles = await getChangedFiles(cwd);
    const changedInstructionFiles = filterToInstructionSources(changedFiles, allSources);
    changedMeta = { enabled: true, changedFiles, changedInstructionFiles };

    if (changedInstructionFiles.length === 0) {
      return {
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
    }

    const changedSet = new Set(changedInstructionFiles);
    sources = allSources.filter((s) => changedSet.has(toPosixPath(s.path)));
  }

  const sourceContents = new Map(
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
  const analyzed = await analyzeInstructionSources(sources, cwd, sourceContents);
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
  const summary = {
    ...baseSummary,
    findingCount: findings.length,
    estimatedAvoidableTokens: summarizeAvoidableTokens(findings),
    ...(opts.details
      ? {
          sectionCount: parsedSections.length,
          commandCount: parsedCommands.length,
        }
      : {}),
  };

  return {
    command: "doctor",
    status: "ok",
    summary,
    sources: analyzed,
    findings,
    skillMetadata: extractAllSkillMetadata(analyzed, sourceContents, findings),
    ...(opts.details
      ? { details: { sections: parsedSections, commands: parsedCommands } }
      : {}),
    ...(changedMeta === undefined ? {} : { changed: changedMeta }),
  };
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
  return String(err);
}

export function formatDoctorText(report: DoctorReport): string[] {
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
    `Discovered ${summary.sourceCount} instruction source${summary.sourceCount === 1 ? "" : "s"}.`,
    `Estimated instruction surface: ~${summary.estimatedTokens} tokens.`,
    `Detected ${summary.findingCount} finding${summary.findingCount === 1 ? "" : "s"}.`,
    `Estimated avoidable waste: ~${summary.estimatedAvoidableTokens} tokens.`,
    ...formatParsedCounts(summary),
    ...formatSkillMetadataCount(report.skillMetadata),
    ...formatSources(report.sources),
    ...formatFindings(report.findings),
  );

  return lines;
}

function formatSkillMetadataCount(skillMetadata: SkillMetadata[]): string[] {
  if (skillMetadata.length === 0) return [];
  return [
    `Extracted ${skillMetadata.length} skill metadata record${skillMetadata.length === 1 ? "" : "s"}.`,
  ];
}

function formatParsedCounts(summary: DoctorReport["summary"]): string[] {
  if (summary.sectionCount !== undefined && summary.commandCount !== undefined) {
    return [
      `Parsed ${summary.sectionCount} section${summary.sectionCount === 1 ? "" : "s"}, ${summary.commandCount} command${summary.commandCount === 1 ? "" : "s"}.`,
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

function formatFindings(findings: Finding[]): string[] {
  const severityRank = { high: 0, medium: 1, low: 2 };
  const displayedFindings = [...findings]
    .sort((left, right) => severityRank[left.severity] - severityRank[right.severity])
    .slice(0, 10);

  if (displayedFindings.length === 0) return [];

  return [
    "Findings:",
    ...formatFindingsBySeverity(displayedFindings),
    ...formatOmittedFindingCount(findings.length, displayedFindings.length),
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

function formatOmittedFindingCount(total: number, displayed: number): string[] {
  const omitted = total - displayed;
  if (omitted <= 0) return [];

  return [`... ${omitted} more finding${omitted === 1 ? "" : "s"} omitted.`];
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
    .action(async (options: { json?: boolean; details?: boolean; changed?: boolean }) => {
      try {
        const config = await loadAgentctxConfig(process.cwd());
        const report = await buildDoctorReport(process.cwd(), {
          details: options.details === true,
          changed: options.changed === true,
          config,
        });

        if (shouldFailDoctor(report.findings, config.doctor.fail_on)) {
          process.exitCode = 1;
        }

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        for (const line of formatDoctorText(report)) {
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
        const sources = await discoverInstructionSources(cwd, config.discovery);
        const sourceContents = new Map(
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
        const analyzed = await analyzeInstructionSources(sources, cwd, sourceContents);
        const findings = detectFindings({
          sources: analyzed,
          sections: [],
          commands: [],
        }, {
          tokenThresholds: config.doctor.token_thresholds,
        });
        const skillMetadata = extractAllSkillMetadata(analyzed, sourceContents, findings);
        const candidates = buildCandidates(skillMetadata);
        const classified = classifyTask(task);
        const result = selectCandidates(candidates, classified, {
          defaultBranch: config.suggest.default_branch,
          maxPromptTokens: config.suggest.max_prompt_tokens,
          maxSelectedSkills: config.suggest.max_selected_skills,
          preferLowTokenSkills: config.suggest.prefer_low_token_skills,
          includeFullSkillText: config.suggest.include_full_skill_text,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        for (const line of formatSuggestText(result)) {
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
