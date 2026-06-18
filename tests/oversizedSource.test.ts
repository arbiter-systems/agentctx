import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  analyzeInstructionSources,
  MAX_INSTRUCTION_SOURCE_BYTES,
} from "../src/analysis.js";
import { buildDoctorReport } from "../src/cli.js";
import type { InstructionSource } from "../src/discovery.js";

const tempDirs: string[] = [];

async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "instructov-oversized-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("oversized instruction sources", () => {
  it("analyzes normal sources unchanged", async () => {
    const dir = await makeTempRepo();
    await writeFile(join(dir, "AGENTS.md"), "# Agent\n\nUse focused validation.\n");

    const source: InstructionSource = {
      path: "AGENTS.md",
      kind: "agents",
      scopePath: ".",
    };

    const [analyzed] = await analyzeInstructionSources([source], dir);

    expect(analyzed).toMatchObject({
      path: "AGENTS.md",
      bytes: 33,
      estimatedTokens: 9,
    });
  });

  it("uses a deterministic size-based estimate for oversized sources", async () => {
    const dir = await makeTempRepo();
    const content = "A".repeat(MAX_INSTRUCTION_SOURCE_BYTES + 1);
    await writeFile(join(dir, "AGENTS.md"), content);

    const source: InstructionSource = {
      path: "AGENTS.md",
      kind: "agents",
      scopePath: ".",
    };

    const [analyzed] = await analyzeInstructionSources([source], dir);

    expect(analyzed).toMatchObject({
      path: "AGENTS.md",
      bytes: MAX_INSTRUCTION_SOURCE_BYTES + 1,
      estimatedTokens: Math.ceil((MAX_INSTRUCTION_SOURCE_BYTES + 1) / 4),
    });
  });

  it("ignores stale cache entries for oversized sources", async () => {
    const dir = await makeTempRepo();
    const filePath = join(dir, "AGENTS.md");
    await writeFile(filePath, "A".repeat(MAX_INSTRUCTION_SOURCE_BYTES + 1));
    const fileStat = await stat(filePath);

    await mkdir(join(dir, ".instructov"));
    await writeFile(
      join(dir, ".instructov", "cache.json"),
      JSON.stringify({
        entries: {
          "AGENTS.md": {
            path: "AGENTS.md",
            mtimeMs: fileStat.mtimeMs,
            size: fileStat.size,
            version: "0.1.0",
            bytes: fileStat.size,
            estimatedTokens: 1,
          },
        },
      }),
    );

    const source: InstructionSource = {
      path: "AGENTS.md",
      kind: "agents",
      scopePath: ".",
    };

    const [analyzed] = await analyzeInstructionSources([source], dir);

    expect(analyzed).toMatchObject({
      path: "AGENTS.md",
      bytes: MAX_INSTRUCTION_SOURCE_BYTES + 1,
      estimatedTokens: Math.ceil((MAX_INSTRUCTION_SOURCE_BYTES + 1) / 4),
    });
  });

  it("reports oversized source findings in doctor output", async () => {
    const dir = await makeTempRepo();
    await writeFile(join(dir, "AGENTS.md"), "A".repeat(MAX_INSTRUCTION_SOURCE_BYTES + 1));

    const report = await buildDoctorReport(dir);

    expect(report.summary.sourceCount).toBe(1);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: "high-token-waste-source",
        sourcePath: "AGENTS.md",
      }),
    );
  });

  it("keeps verdict output compatible for oversized sources", async () => {
    const dir = await makeTempRepo();
    await writeFile(join(dir, "AGENTS.md"), "A".repeat(MAX_INSTRUCTION_SOURCE_BYTES + 1));

    const report = await buildDoctorReport(dir, { verdict: true });

    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: "high-token-waste-source",
        verdict: "Reduce or scope this file before adding more guidance.",
      }),
    );
  });
});
