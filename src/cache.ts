import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const CACHE_VERSION = "0.1.0";

const CACHE_DIR = ".instructov";
const CACHE_FILE = ".instructov/cache.json";

export type CacheEntry = {
  path: string;
  mtimeMs: number;
  size: number;
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
