import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addExampleCommand, EXAMPLE_TEXT } from "../src/example.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("example command", () => {
  it("prints deterministic instv examples for doctor, suggest, and brief", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const program = new Command();
    addExampleCommand(program);

    await program.parseAsync(["node", "instv", "example"]);

    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(EXAMPLE_TEXT.join("\n"));
  });
});
