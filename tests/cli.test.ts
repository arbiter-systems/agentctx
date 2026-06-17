import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
      sources: expect.any(Array),
      findings: expect.any(Array)
    });
  });
});

describe("formatDoctorText", () => {
  it("renders the text output lines", () => {
    expect(formatDoctorText({
      command: "doctor",
      status: "ok",
      summary: {
        sourceCount: 1,
        bytes: 168,
        estimatedTokens: 42,
        findingCount: 0,
        estimatedAvoidableTokens: 0
      },
      sources: [
        {
          path: "AGENTS.md",
          kind: "agents",
          scopePath: ".",
          bytes: 168,
          estimatedTokens: 42,
        }
      ],
      findings: [],
      skillMetadata: []
    })).toEqual([
      "agentctx doctor",
      "Discovered 1 instruction source.",
      "Estimated instruction surface: ~42 tokens.",
      "Detected 0 findings.",
      "Estimated avoidable waste: ~0 tokens.",
      "- AGENTS.md [agents] scope: . ~42 tokens"
    ]);
  });
});

describe("formatDoctorText — skill metadata count", () => {
  const baseReport = {
    command: "doctor" as const,
    status: "ok" as const,
    summary: {
      sourceCount: 0,
      bytes: 0,
      estimatedTokens: 0,
      findingCount: 0,
      estimatedAvoidableTokens: 0,
    },
    sources: [],
    findings: [],
  };

  it("omits the count line when there are no skill metadata records", () => {
    const lines = formatDoctorText({ ...baseReport, skillMetadata: [] });
    expect(lines.some((l) => l.includes("skill metadata"))).toBe(false);
  });

  it("renders singular form for one skill metadata record", () => {
    const lines = formatDoctorText({
      ...baseReport,
      skillMetadata: [
        {
          sourcePath: "skills/foo/SKILL.md",
          name: "foo",
          tasks: [],
          triggers: [],
          pathApplicability: [],
          estimatedTokens: 10,
          penalties: [],
          metadataSource: "inferred",
        },
      ],
    });
    expect(lines).toContain("Extracted 1 skill metadata record.");
  });

  it("renders plural form for multiple skill metadata records", () => {
    const record = {
      sourcePath: "skills/foo/SKILL.md",
      name: "foo",
      tasks: [],
      triggers: [],
      pathApplicability: [],
      estimatedTokens: 10,
      penalties: [],
      metadataSource: "inferred" as const,
    };
    const lines = formatDoctorText({
      ...baseReport,
      skillMetadata: [record, { ...record, sourcePath: "skills/bar/SKILL.md", name: "bar" }],
    });
    expect(lines).toContain("Extracted 2 skill metadata records.");
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
      summary: {
        sourceCount: expect.any(Number),
        bytes: expect.any(Number),
        estimatedTokens: expect.any(Number),
        findingCount: expect.any(Number),
        estimatedAvoidableTokens: expect.any(Number)
      },
      sources: expect.any(Array),
      findings: expect.any(Array)
    });
  });

  it("sets exit code 2 for invalid config", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentctx-cli-config-"));
    const savedExitCode = process.exitCode;
    process.exitCode = 0;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "cwd").mockReturnValue(cwd);

    try {
      await writeFile(path.join(cwd, "agentctx.yml"), "version: invalid\n");
      await createProgram().parseAsync(["node", "agentctx", "doctor"]);

      expect(process.exitCode).toBe(2);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("agentctx.yml"));
    } finally {
      process.exitCode = savedExitCode;
      await rm(cwd, { force: true, recursive: true });
    }
  });
});
