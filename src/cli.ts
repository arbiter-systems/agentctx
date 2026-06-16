#!/usr/bin/env node
import { Command } from "commander";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { discoverInstructionSources } from "./discovery.js";
import { analyzeInstructionSources, summarize, type AnalyzedInstructionSource, type DoctorSummary } from "./analysis.js";
import { parseSections, extractCommands, type InstructionSection, type CommandRecord } from "./parser.js";

export type DoctorDetails = {
  sections: InstructionSection[];
  commands: CommandRecord[];
};

export type DoctorReport = {
  command: "doctor";
  status: "ok";
  summary: DoctorSummary & { sectionCount?: number; commandCount?: number };
  sources: AnalyzedInstructionSource[];
  details?: DoctorDetails;
};

export async function buildDoctorReport(
  cwd = process.cwd(),
  opts: { details?: boolean } = {},
): Promise<DoctorReport> {
  const sources = await discoverInstructionSources(cwd);
  const analyzed = await analyzeInstructionSources(sources, cwd);
  const baseSummary = summarize(analyzed);

  if (!opts.details) {
    return { command: "doctor", status: "ok", summary: baseSummary, sources: analyzed };
  }

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

  return {
    command: "doctor",
    status: "ok",
    summary: {
      ...baseSummary,
      sectionCount: allSections.length,
      commandCount: allCommands.length,
    },
    sources: analyzed,
    details: { sections: allSections, commands: allCommands },
  };
}

export function formatDoctorText(report: DoctorReport): string[] {
  const { summary } = report;
  const lines = [
    "agentctx doctor",
    `Discovered ${summary.sourceCount} instruction source${summary.sourceCount === 1 ? "" : "s"}.`,
    `Estimated instruction surface: ~${summary.estimatedTokens} tokens.`,
  ];

  if (summary.sectionCount !== undefined && summary.commandCount !== undefined) {
    lines.push(
      `Parsed ${summary.sectionCount} section${summary.sectionCount === 1 ? "" : "s"}, ${summary.commandCount} command${summary.commandCount === 1 ? "" : "s"}.`,
    );
  }

  for (const source of report.sources) {
    lines.push(`- ${source.path} [${source.kind}] scope: ${source.scopePath} ~${source.estimatedTokens} tokens`);
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
