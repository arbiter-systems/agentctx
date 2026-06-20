import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

function isValidCacheEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.path === "string" &&
    typeof entry.mtimeMs === "number" &&
    Number.isFinite(entry.mtimeMs) &&
    typeof entry.size === "number" &&
    Number.isFinite(entry.size) &&
    typeof entry.version === "string" &&
    typeof entry.bytes === "number" &&
    Number.isFinite(entry.bytes) &&
    typeof entry.estimatedTokens === "number" &&
    Number.isFinite(entry.estimatedTokens)
  );
}

export async function loadCache(cwd: string): Promise<Map<string, CacheEntry>> {
  try {
    const raw = await readFile(path.join(cwd, CACHE_FILE), "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (!parsed || typeof parsed !== "object" || !parsed.entries || typeof parsed.entries !== "object") {
      return new Map();
    }

    const entries = new Map<string, CacheEntry>();
    for (const [cachedPath, entry] of Object.entries(parsed.entries)) {
      if (isValidCacheEntry(entry)) entries.set(cachedPath, entry);
    }
    return entries;
  } catch {
    return new Map();
  }
}

export async function saveCache(
  cwd: string,
  entries: Map<string, CacheEntry>,
): Promise<void> {
  const cacheDirectory = path.join(cwd, CACHE_DIR);
  const cachePath = path.join(cwd, CACHE_FILE);
  const temporaryPath = path.join(
    cacheDirectory,
    `cache.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    await mkdir(cacheDirectory, { recursive: true });
    const data: CacheFile = { entries: Object.fromEntries(entries) };
    await writeFile(temporaryPath, JSON.stringify(data, null, 2), "utf8");
    await rename(temporaryPath, cachePath);
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    // non-fatal: cache write failures do not affect doctor output
  }
}
