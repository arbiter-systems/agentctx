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
  details?: DoctorDetails;
};

export async function buildDoctorReport(
  cwd = process.cwd(),
  opts: { details?: boolean } = {},
): Promise<DoctorReport> {
  const sources = await discoverInstructionSources(cwd);
  const analyzed = await analyzeInstructionSources(sources, cwd);
  const baseSummary = summarize(analyzed);

  const allSections: InstructionSection[] = [];
  const allCommands: CommandRecord[] = [];

  for (const source of analyzed) {
    let text: string;
    try {
      text = await readFile(path.join(cwd, source.path), "utf8");
    } catch {
      continue;
    }
    const sections = parseSections(source.path, text);
    const commands = extractCommands(source.path, text, sections);
    allSections.push(...sections);
    allCommands.push(...commands);
  }

  const findings = detectFindings({
    sources: analyzed,
    sections: allSections,
    commands: allCommands,
  });
  const summary = {
    ...baseSummary,
    findingCount: findings.length,
    estimatedAvoidableTokens: summarizeAvoidableTokens(findings),
    ...(opts.details
      ? {
          sectionCount: allSections.length,
          commandCount: allCommands.length,
        }
      : {}),
  };

  return {
    command: "doctor",
    status: "ok",
    summary,
    sources: analyzed,
    findings,
    ...(opts.details
      ? { details: { sections: allSections, commands: allCommands } }
      : {}),
  };
}

export function formatDoctorText(report: DoctorReport): string[] {
  const { summary } = report;
  const lines = [
    "agentctx doctor",
    `Discovered ${summary.sourceCount} instruction source${summary.sourceCount === 1 ? "" : "s"}.`,
    `Estimated instruction surface: ~${summary.estimatedTokens} tokens.`,
    `Detected ${summary.findingCount} finding${summary.findingCount === 1 ? "" : "s"}.`,
    `Estimated avoidable waste: ~${summary.estimatedAvoidableTokens} tokens.`,
  ];

  if (summary.sectionCount !== undefined && summary.commandCount !== undefined) {
    lines.push(
      `Parsed ${summary.sectionCount} section${summary.sectionCount === 1 ? "" : "s"}, ${summary.commandCount} command${summary.commandCount === 1 ? "" : "s"}.`,
    );
  }

  for (const source of report.sources) {
    lines.push(`- ${source.path} [${source.kind}] scope: ${source.scopePath} ~${source.estimatedTokens} tokens`);
  }

  const severityRank = { high: 0, medium: 1, low: 2 };
  const displayedFindings = [...report.findings]
    .sort((left, right) => severityRank[left.severity] - severityRank[right.severity])
    .slice(0, 10);
  if (displayedFindings.length > 0) {
    lines.push("Findings:");
    for (const severity of ["high", "medium", "low"] as const) {
      const matching = displayedFindings.filter((finding) => finding.severity === severity);
      if (matching.length === 0) continue;
      lines.push(`${severity}:`);
      for (const finding of matching) {
        const location = finding.lineStart === undefined
          ? finding.sourcePath
          : `${finding.sourcePath}:${finding.lineStart}`;
        lines.push(`- ${finding.code} ${location} - ${finding.message}`);
      }
    }
    if (report.findings.length > displayedFindings.length) {
      lines.push(`... ${report.findings.length - displayedFindings.length} more finding${report.findings.length - displayedFindings.length === 1 ? "" : "s"} omitted.`);
    }
  }

  return lines;
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
    .action(async (options: { json?: boolean; details?: boolean }) => {
      const report = await buildDoctorReport(process.cwd(), { details: options.details === true });
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      for (const line of formatDoctorText(report)) {
        console.log(line);
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
