import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { InstructionSource } from "./discovery.js";
import { estimateTokens } from "./tokenEstimate.js";
import { loadCache, saveCache, type CacheEntry } from "./cache.js";

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
    estimatedTokens: sources.reduce((s, src) => s + src.estimatedTokens, 0),
  };
}

export async function analyzeInstructionSources(
  sources: InstructionSource[],
  cwd = process.cwd(),
): Promise<AnalyzedInstructionSource[]> {
  const cache = await loadCache(cwd);
  const updated = new Map(cache);
  const results: AnalyzedInstructionSource[] = [];

  for (const source of sources) {
    const absolutePath = path.join(cwd, source.path);

    let fileStat: { mtimeMs: number; size: number };
    try {
      const s = await stat(absolutePath);
      fileStat = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      results.push({ ...source, bytes: 0, estimatedTokens: 0 });
      continue;
    }

    const cached = cache.get(source.path);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      results.push({ ...source, bytes: cached.bytes, estimatedTokens: cached.estimatedTokens });
      continue;
    }

    let content: string;
    try {
      content = await readFile(absolutePath, "utf8");
    } catch {
      results.push({ ...source, bytes: 0, estimatedTokens: 0 });
      continue;
    }

    const bytes = Buffer.byteLength(content, "utf8");
    const tokens = estimateTokens(content);
    const hash = createHash("sha256").update(content).digest("hex");

    const entry: CacheEntry = {
      path: source.path,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      hash,
      version: "0.1.0",
      bytes,
      estimatedTokens: tokens,
    };
    updated.set(source.path, entry);
    results.push({ ...source, bytes, estimatedTokens: tokens });
  }

  await saveCache(cwd, updated);
  return results;
}
