import path from "node:path";
import type { AnalyzedInstructionSource } from "./analysis.js";
import type { Finding } from "./findings.js";
import { estimateTokens } from "./tokenEstimate.js";

export type SkillPenalty = {
  code: string;
  severity: "low" | "medium" | "high";
  estimatedAvoidableTokens?: number;
};

export type SkillMetadata = {
  sourcePath: string;
  name: string;
  summary?: string;
  tasks: string[];
  triggers: string[];
  pathApplicability: string[];
  estimatedTokens: number;
  penalties: SkillPenalty[];
  metadataSource: "frontmatter" | "inferred" | "mixed";
};

type ParsedFrontmatter = {
  name?: string;
  summary?: string;
  tasks?: string[];
  triggers?: string[];
  paths?: string[];
};

// Must start at line 1 (^ anchors to start of string with default flags)
const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const ATX_HEADING_RE = /^#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m;
const PATH_SECTION_HEADING_RE =
  /^#{1,6}[ \t]+(?:paths?|applies?\s+to|scope)[ \t]*$/im;

const TASK_KEYWORDS = [
  "audit",
  "review",
  "implementation",
  "planning",
  "docs",
  "debug",
  "validation",
  "security",
  "issue",
  "pull request",
];

function parseFrontmatter(text: string): ParsedFrontmatter | null {
  const match = FRONTMATTER_BLOCK_RE.exec(text);
  if (!match) return null;

  const block = match[1] ?? "";
  const result: ParsedFrontmatter = {};

  for (const line of block.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    if (!key || !rawValue) continue;

    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const items = rawValue
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);

      if (key === "tasks") result.tasks = items;
      else if (key === "triggers") result.triggers = items;
      else if (key === "paths") result.paths = items;
    } else {
      const value = rawValue.replace(/^["']|["']$/g, "");
      if (key === "name") result.name = value;
      else if (key === "summary") result.summary = value;
    }
  }

  return result;
}

function stripFrontmatter(text: string): string {
  const match = FRONTMATTER_BLOCK_RE.exec(text);
  return match ? text.slice(match[0].length) : text;
}

function inferName(sourcePath: string): string {
  const dir = path.dirname(sourcePath);
  const dirName = path.basename(dir);
  return dirName === "." ? "unknown" : dirName;
}

function inferSummary(bodyText: string): string | undefined {
  const headingMatch = ATX_HEADING_RE.exec(bodyText);
  if (headingMatch?.[1]) return headingMatch[1].trim();

  for (const line of bodyText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) return trimmed;
  }

  return undefined;
}

function inferKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return TASK_KEYWORDS.filter((kw) => lower.includes(kw));
}

function inferPathApplicability(text: string): string[] {
  if (!PATH_SECTION_HEADING_RE.test(text)) return [];

  const lines = text.split(/\r?\n/);
  const paths: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (/^#{1,6}[ \t]+(?:paths?|applies?\s+to|scope)[ \t]*$/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (/^#{1,6}/.test(line)) break;
      const bullet = /^[ \t]*[-*+][ \t]+(.+)$/.exec(line);
      if (bullet?.[1]) paths.push(bullet[1].trim());
    }
  }

  return paths;
}

export function extractSkillMetadata(
  source: AnalyzedInstructionSource,
  text: string,
  findings: Finding[] = [],
): SkillMetadata {
  const fm = parseFrontmatter(text);
  const body = stripFrontmatter(text);
  let usedInference = false;

  let name: string;
  if (fm?.name) {
    name = fm.name;
  } else {
    name = inferName(source.path);
    usedInference = true;
  }

  let summary: string | undefined;
  if (fm?.summary) {
    summary = fm.summary;
  } else {
    summary = inferSummary(body);
    if (summary !== undefined) usedInference = true;
  }

  let tasks: string[];
  if (fm?.tasks) {
    tasks = fm.tasks;
  } else {
    tasks = inferKeywords(text);
    if (tasks.length > 0) usedInference = true;
  }

  let triggers: string[];
  if (fm?.triggers) {
    triggers = fm.triggers;
  } else {
    triggers = inferKeywords(text);
    if (triggers.length > 0) usedInference = true;
  }

  let pathApplicability: string[];
  if (fm?.paths) {
    pathApplicability = fm.paths;
  } else {
    pathApplicability = inferPathApplicability(text);
    if (pathApplicability.length > 0) usedInference = true;
  }

  const estimatedTokensValue =
    source.estimatedTokens > 0
      ? source.estimatedTokens
      : estimateTokens(text);

  const penalties: SkillPenalty[] = findings
    .filter((f) => f.sourcePath === source.path)
    .map((f) => {
      const penalty: SkillPenalty = { code: f.code, severity: f.severity };
      if (f.estimatedAvoidableTokens !== undefined) {
        penalty.estimatedAvoidableTokens = f.estimatedAvoidableTokens;
      }
      return penalty;
    });

  let metadataSource: "frontmatter" | "inferred" | "mixed";
  if (!fm) {
    metadataSource = "inferred";
  } else if (usedInference) {
    metadataSource = "mixed";
  } else {
    metadataSource = "frontmatter";
  }

  const metadata: SkillMetadata = {
    sourcePath: source.path,
    name,
    tasks,
    triggers,
    pathApplicability,
    estimatedTokens: estimatedTokensValue,
    penalties,
    metadataSource,
  };

  if (summary !== undefined) metadata.summary = summary;

  return metadata;
}

export function extractAllSkillMetadata(
  sources: AnalyzedInstructionSource[],
  sourceContents: Map<string, string>,
  findings: Finding[] = [],
): SkillMetadata[] {
  return sources
    .filter((s) => s.kind === "skill" && s.path.endsWith("SKILL.md"))
    .flatMap((source) => {
      const text = sourceContents.get(source.path);
      if (text === undefined) return [];
      return [extractSkillMetadata(source, text, findings)];
    });
}
