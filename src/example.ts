import { Command } from "commander";

export const EXAMPLE_TEXT = [
  "instv examples",
  "",
  "Inspect instruction files:",
  "  instv doctor",
  "  instv doctor --details",
  "  instv doctor --budget 4000",
  "  instv doctor --diff dev",
  "",
  "Find relevant skills for a task:",
  "  instv suggest \"review PR 72 for correctness and test gaps\"",
  "  instv suggest --json \"audit issue 62\"",
  "",
  "Build a compact AI task briefing:",
  "  instv brief \"implement issue 74\"",
  "  instv brief --budget 1200 \"review PR 72 for security and test gaps\"",
  "  instv brief --json \"audit issue 62\"",
  "",
  "`instructov` remains available as a compatibility command.",
] as const;

export function addExampleCommand(program: Command): void {
  program
    .command("example")
    .description("Show copy/paste examples for each command.")
    .action(() => {
      console.log(EXAMPLE_TEXT.join("\n"));
    });
}
