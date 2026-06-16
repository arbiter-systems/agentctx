import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDoctorReport, createProgram, formatDoctorText } from "../src/cli.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildDoctorReport", () => {
  it("returns the discovered source report", async () => {
    await expect(buildDoctorReport()).resolves.toMatchObject({
      command: "doctor",
      status: "ok",
      summary: expect.any(Object),
      sources: expect.any(Array)
    });
  });
});

describe("formatDoctorText", () => {
  it("renders the text output lines", () => {
    expect(formatDoctorText({
      command: "doctor",
      status: "ok",
      summary: { sourceCount: 1, bytes: 168, estimatedTokens: 42 },
      sources: [
        {
          path: "AGENTS.md",
          kind: "agents",
          scopePath: ".",
          bytes: 168,
          estimatedTokens: 42,
        }
      ]
    })).toEqual([
      "agentctx doctor",
      "Discovered 1 instruction source.",
      "Estimated instruction surface: ~42 tokens.",
      "- AGENTS.md [agents] scope: . ~42 tokens"
    ]);
  });
});

describe("doctor command", () => {
  it("prints JSON when requested", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await createProgram().parseAsync(["node", "agentctx", "doctor", "--json"]);

    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      command: "doctor",
      status: "ok",
      summary: { sourceCount: expect.any(Number), bytes: expect.any(Number), estimatedTokens: expect.any(Number) },
      sources: expect.any(Array)
    });
  });
});
