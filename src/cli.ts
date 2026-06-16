#!/usr/bin/env node
import { Command } from "commander";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { discoverInstructionSources } from "./discovery.js";
import { analyzeInstructionSources, summarize, type AnalyzedInstructionSource, type DoctorSummary } from "./analysis.js";

export type DoctorReport = {
  command: "doctor";
  status: "ok";
  summary: DoctorSummary;
  sources: AnalyzedInstructionSource[];
};

export async function buildDoctorReport(cwd = process.cwd()): Promise<DoctorReport> {
  const sources = await discoverInstructionSources(cwd);
  const analyzed = await analyzeInstructionSources(sources, cwd);
  return { command: "doctor", status: "ok", summary: summarize(analyzed), sources: analyzed };
}

export function formatDoctorText(report: DoctorReport): string[] {
  const { summary } = report;
  const lines = [
    "agentctx doctor",
    `Discovered ${summary.sourceCount} instruction source${summary.sourceCount === 1 ? "" : "s"}.`,
    `Estimated instruction surface: ~${summary.estimatedTokens} tokens.`,
  ];

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
    .action(async (options: { json?: boolean }) => {
      const report = await buildDoctorReport();
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
