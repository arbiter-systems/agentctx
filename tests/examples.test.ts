import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addExampleCommand, formatExampleText } from "../src/examples.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatExampleText", () => {
  it("returns deterministic copy/paste examples for each primary command", () => {
    expect(formatExampleText()).toEqual([
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
    ]);
  });
});

describe("example command", () => {
  it("registers example and prints the formatted examples", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const program = new Command();
    addExampleCommand(program);

    await program.parseAsync(["node", "instv", "example"]);

    expect(program.commands.map((command) => command.name())).toContain("example");
    expect(log.mock.calls.map(([line]) => line)).toEqual(formatExampleText());
  });
});
