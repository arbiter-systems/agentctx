#!/usr/bin/env node
import { Command } from "commander";
import { pathToFileURL } from "node:url";

export type DoctorReport = {
  command: "doctor";
  status: "ok";
  message: string;
};

export function buildDoctorReport(): DoctorReport {
  return {
    command: "doctor",
    status: "ok",
    message: "Not implemented yet"
  };
}

export function formatDoctorText(report: DoctorReport): string[] {
  return ["agentctx doctor", report.message];
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
    .action((options: { json?: boolean }) => {
      const report = buildDoctorReport();
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
