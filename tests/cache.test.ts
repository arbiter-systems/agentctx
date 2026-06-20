import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CACHE_VERSION, loadCache, saveCache, type CacheEntry } from "../src/cache.js";

const entry: CacheEntry = {
  path: "AGENTS.md",
  mtimeMs: 1,
  size: 2,
  version: CACHE_VERSION,
  bytes: 2,
  estimatedTokens: 1,
};

describe("cache", () => {
  it("replaces the cache through a completed JSON file without leaving a temp file", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "instructov-cache-"));
    try {
      await saveCache(cwd, new Map([[entry.path, entry]]));

      const raw = await readFile(path.join(cwd, ".instructov", "cache.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({ entries: { "AGENTS.md": entry } });
      expect(await readdir(path.join(cwd, ".instructov"))).toEqual(["cache.json"]);
      await expect(loadCache(cwd)).resolves.toEqual(new Map([[entry.path, entry]]));
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });
});
