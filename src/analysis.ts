import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { InstructionSource } from "./discovery.js";
import { sumTokens } from "./formatting.js";
import { estimateTokens } from "./tokenEstimate.js";
import { loadCache, saveCache, CACHE_VERSION, type CacheEntry } from "./cache.js";

export type AnalyzedInstructionSource = InstructionSource & {
  bytes: number;
  estimatedTokens: number;
};

export type DoctorSummary = {
  sourceCount: number;
  bytes: number;
  estimatedTokens: number;
};

export function summarize(sources: AnalyzedInstructionSource[]): DoctorSummary {
  return {
    sourceCount: sources.length,
    bytes: sources.reduce((s, src) => s + src.bytes, 0),
    estimatedTokens: sumTokens(sources),
  };
}

type AnalysisResult = {
  analyzed: AnalyzedInstructionSource;
  entry: CacheEntry | null;
};

async function analyzeOne(
  source: InstructionSource,
  absolutePath: string,
  cache: Map<string, CacheEntry>,
  contentByPath: ReadonlyMap<string, string>,
): Promise<AnalysisResult> {
  const fallback: AnalysisResult = {
    analyzed: { ...source, bytes: 0, estimatedTokens: 0 },
    entry: null,
  };

  let fileStat: { mtimeMs: number; size: number };
  try {
    const s = await stat(absolutePath);
    fileStat = { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return fallback;
  }

  const cached = cache.get(source.path);
  if (
    cached?.version === CACHE_VERSION &&
    cached.mtimeMs === fileStat.mtimeMs &&
    cached.size === fileStat.size
  ) {
    return { analyzed: { ...source, bytes: cached.bytes, estimatedTokens: cached.estimatedTokens }, entry: null };
  }

  let content = contentByPath.get(source.path);
  try {
    content ??= await readFile(absolutePath, "utf8");
  } catch {
    return fallback;
  }

  const bytes = fileStat.size;
  const tokens = estimateTokens(content);
  const entry: CacheEntry = {
    path: source.path,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    version: CACHE_VERSION,
    bytes,
    estimatedTokens: tokens,
  };
  return { analyzed: { ...source, bytes, estimatedTokens: tokens }, entry };
}

export async function analyzeInstructionSources(
  sources: InstructionSource[],
  cwd = process.cwd(),
  contentByPath: ReadonlyMap<string, string> = new Map(),
): Promise<AnalyzedInstructionSource[]> {
  const cache = await loadCache(cwd);

  const settled = await Promise.all(
    sources.map((source) =>
      analyzeOne(source, path.join(cwd, source.path), cache, contentByPath),
    ),
  );

  const currentPaths = new Set(sources.map((source) => source.path));
  const updated = new Map(
    [...cache].filter(([cachedPath]) => currentPaths.has(cachedPath)),
  );
  for (const { entry } of settled) {
    if (entry) updated.set(entry.path, entry);
  }
  await saveCache(cwd, updated);

  return settled.map(({ analyzed }) => analyzed);
}
