import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = ".agentctx";
const CACHE_FILE = ".agentctx/cache.json";

export type CacheEntry = {
  path: string;
  mtimeMs: number;
  size: number;
  hash: string;
  version: string;
  bytes: number;
  estimatedTokens: number;
};

type CacheFile = {
  entries: Record<string, CacheEntry>;
};

export async function loadCache(cwd: string): Promise<Map<string, CacheEntry>> {
  try {
    const raw = await readFile(path.join(cwd, CACHE_FILE), "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (!parsed || typeof parsed !== "object" || !parsed.entries) return new Map();
    return new Map(Object.entries(parsed.entries));
  } catch {
    return new Map();
  }
}

export async function saveCache(
  cwd: string,
  entries: Map<string, CacheEntry>,
): Promise<void> {
  try {
    await mkdir(path.join(cwd, CACHE_DIR), { recursive: true });
    const data: CacheFile = { entries: Object.fromEntries(entries) };
    await writeFile(path.join(cwd, CACHE_FILE), JSON.stringify(data, null, 2), "utf8");
  } catch {
    // non-fatal: cache write failures do not affect doctor output
  }
}
