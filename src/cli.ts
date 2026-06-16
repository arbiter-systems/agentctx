#!/usr/bin/env node
import { Command } from "commander";
import { pathToFileURL } from "node:url";

import {
  discoverInstructionSources,
  type InstructionSource,
} from "./discovery.js";

export type DoctorReport = {
  command: "doctor";
  status: "ok";
  sources: InstructionSource[];
};

export async function buildDoctorReport(cwd = process.cwd()): Promise<DoctorReport> {
  const sources = await discoverInstructionSources(cwd);
  return { command: "doctor", status: "ok", sources };
}

export function formatDoctorText(report: DoctorReport): string[] {
  const count = report.sources.length;
  const lines = [
    "agentctx doctor",
    `Discovered ${count} instruction source${count === 1 ? "" : "s"}.`,
  ];

  for (const source of report.sources) {
    lines.push(`- ${source.path} [${source.kind}] scope: ${source.scopePath}`);
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
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await runCli();
}
