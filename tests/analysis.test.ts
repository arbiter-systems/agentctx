import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeInstructionSources } from "../src/analysis.js";
import { CACHE_VERSION, loadCache } from "../src/cache.js";

describe("analyzeInstructionSources", () => {
  it("evicts cache entries for sources that are no longer discovered", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "instructov-cache-"));

    try {
      await mkdir(path.join(cwd, ".instructov"), { recursive: true });
      await writeFile(path.join(cwd, "AGENTS.md"), "Use focused guidance.\n");
      await writeFile(
        path.join(cwd, ".instructov", "cache.json"),
        JSON.stringify(
          {
            entries: {
              "AGENTS.md": {
                path: "AGENTS.md",
                mtimeMs: 0,
                size: 0,
                version: CACHE_VERSION,
                bytes: 0,
                estimatedTokens: 0,
              },
              "deleted/SKILL.md": {
                path: "deleted/SKILL.md",
                mtimeMs: 0,
                size: 0,
                version: CACHE_VERSION,
                bytes: 10,
                estimatedTokens: 10,
              },
            },
          },
          null,
          2,
        ),
      );

      await analyzeInstructionSources(
        [{ path: "AGENTS.md", kind: "agents", scopePath: "." }],
        cwd,
      );

      const cache = await loadCache(cwd);
      expect(cache.has("AGENTS.md")).toBe(true);
      expect(cache.has("deleted/SKILL.md")).toBe(false);
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });
});
