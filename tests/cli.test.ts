import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDoctorReport, createProgram, formatDoctorText } from "../src/cli.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildDoctorReport", () => {
  it("returns the current placeholder report", () => {
    expect(buildDoctorReport()).toEqual({
      command: "doctor",
      status: "ok",
      message: "Not implemented yet"
    });
  });
});

describe("formatDoctorText", () => {
  it("renders the text output lines", () => {
    expect(formatDoctorText(buildDoctorReport())).toEqual([
      "agentctx doctor",
      "Not implemented yet"
    ]);
  });
});

describe("doctor command", () => {
  it("prints JSON when requested", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await createProgram().parseAsync(["node", "agentctx", "doctor", "--json"]);

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toBe(
      JSON.stringify(buildDoctorReport(), null, 2)
    );
  });
});
