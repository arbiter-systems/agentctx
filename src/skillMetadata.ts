import path from "node:path";
import type { AnalyzedInstructionSource } from "./analysis.js";
import type { Finding, FindingCode } from "./findings.js";
import { estimateTokens } from "./tokenEstimate.js";

export type SkillPenalty = {
  code: FindingCode;
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

// Must start at line 1 (^ anchors to start of string with default flags).
// Only inline bracket arrays ([a, b, c]) are supported; YAML block sequences
// (- item per line) are not parsed and will be silently ignored.
const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const ATX_HEADING_RE = /^#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m;
const ATX_HEADING_LEVEL_RE = /^(#{1,6})[ \t]+/;
const PATH_SECTION_HEADING_RE =
  /^#{1,6}[ \t]+(?:paths?|applies?\s+to|scope)[ \t]*$/im;
const TRIGGER_SECTION_HEADING_RE =
  /^#{1,6}[ \t]+(?:when\s+to\s+use|triggers?|use\s+when|invoke\s+when)[ \t]*$/im;

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
  // Root-level SKILL.md has no meaningful parent directory name
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

// Extract text lines from a section whose heading matches headingRE.
// Stops at the next heading at the same or shallower depth so that
// sub-headings inside the section are included rather than terminating it.
function extractSectionText(text: string, headingRE: RegExp): string | null {
  const lines = text.split(/\r?\n/);
  const sectionLines: string[] = [];
  let inSection = false;
  let sectionDepth = 0;

  for (const line of lines) {
    const levelMatch = ATX_HEADING_LEVEL_RE.exec(line);
    if (levelMatch) {
      const level = (levelMatch[1] ?? "").length;
      if (!inSection) {
        if (headingRE.test(line)) {
          inSection = true;
          sectionDepth = level;
        }
      } else if (level <= sectionDepth) {
        break;
      } else {
        sectionLines.push(line);
      }
    } else if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.length > 0 ? sectionLines.join("\n") : null;
}

function inferTriggers(bodyText: string): string[] {
  // Prefer keywords from a dedicated trigger/when-to-use section so that
  // triggers and tasks can differ when the skill has explicit trigger guidance.
  const sectionText = extractSectionText(bodyText, TRIGGER_SECTION_HEADING_RE);
  return inferKeywords(sectionText ?? bodyText);
}

function buildPenalties(findings: Finding[], sourcePath: string): SkillPenalty[] {
  return findings
    .filter((f) => f.sourcePath === sourcePath)
    .map((f) => {
      const penalty: SkillPenalty = { code: f.code, severity: f.severity };
      if (f.estimatedAvoidableTokens !== undefined) {
        penalty.estimatedAvoidableTokens = f.estimatedAvoidableTokens;
      }
      return penalty;
    });
}

function inferPathApplicability(bodyText: string): string[] {
  if (!PATH_SECTION_HEADING_RE.test(bodyText)) return [];

  const lines = bodyText.split(/\r?\n/);
  const paths: string[] = [];
  let inSection = false;
  let sectionDepth = 0;

  for (const line of lines) {
    const levelMatch = ATX_HEADING_LEVEL_RE.exec(line);
    if (levelMatch) {
      const level = (levelMatch[1] ?? "").length;
      if (!inSection) {
        if (/^#{1,6}[ \t]+(?:paths?|applies?\s+to|scope)[ \t]*$/i.test(line)) {
          inSection = true;
          sectionDepth = level;
        }
      } else if (level <= sectionDepth) {
        break;
      }
      // Sub-headings inside the section do not terminate bullet collection
    } else if (inSection) {
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

  const name = fm?.name ?? inferName(source.path);

  let summary: string | undefined;
  if (fm?.summary) {
    summary = fm.summary;
  } else {
    summary = inferSummary(body);
  }

  const tasks = fm?.tasks ?? inferKeywords(body);
  const triggers = fm?.triggers ?? inferTriggers(body);
  const pathApplicability = fm?.paths ?? inferPathApplicability(body);

  const estimatedTokensValue =
    source.estimatedTokens > 0 ? source.estimatedTokens : estimateTokens(text);

  const penalties = buildPenalties(findings, source.path);

  // "frontmatter" = block present and name came from it (primary identity field).
  // "mixed"       = block present but name was inferred from directory.
  // "inferred"    = no frontmatter block at all.
  let metadataSource: "frontmatter" | "inferred" | "mixed";
  if (!fm) {
    metadataSource = "inferred";
  } else if (fm.name) {
    metadataSource = "frontmatter";
  } else {
    metadataSource = "mixed";
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
    .filter((s) => s.kind === "skill")
    .flatMap((source) => {
      const text = sourceContents.get(source.path);
      if (text === undefined) return [];
      return [extractSkillMetadata(source, text, findings)];
    });
}
