import type { Command } from "commander";

export function formatExampleText(): string[] {
  return [
    "Instructov command examples:",
    "",
    "Inspect instruction files:",
    "  instv doctor",
    "  instv doctor --json",
    "  instv doctor --diff dev",
    "",
    "Suggest relevant skills for a task:",
    "  instv suggest \"review PR 31\"",
    "",
    "Build a compact task briefing:",
    "  instv brief \"review PR 31 for security and test gaps\"",
  ];
}

export function addExampleCommand(program: Command): void {
  program
    .command("example")
    .description("Print copy/paste examples for the available commands.")
    .action(() => {
      for (const line of formatExampleText()) {
        console.log(line);
      }
    });
}
