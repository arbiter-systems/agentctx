import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { AnalyzedInstructionSource } from "./analysis.js";
import type { instructovConfig } from "./config.js";
import { loadinstructovConfig } from "./config.js";
import { discoverInstructionSources } from "./discovery.js";
import { detectFindings } from "./findings.js";
import { pluralize, previewItems, sumTokens } from "./formatting.js";
import { extractCommands, parseSections, type CommandRecord, type InstructionSection } from "./parser.js";
import type { SkillMetadata, SkillPenalty } from "./skillMetadata.js";
import { extractAllSkillMetadata } from "./skillMetadata.js";
import { estimateTokens } from "./tokenEstimate.js";

export type TaskCategory = "audit" | "review" | "implement" | "docs" | "debug" | "planning";

const CATEGORY_KEYWORDS: Record<TaskCategory, string[]> = {
  audit: ["audit", "verify", "merged", "inspect", "check implementation", "verify merged", "issue"],
  review: ["review", "code review", "pr", "pull request", "diff", "critique"],
  implement: ["implement", "build", "add", "fix", "create", "change"],
  docs: ["docs", "readme", "documentation", "write", "update guide"],
  debug: ["debug", "error", "failing", "broken", "stack trace", "troubleshoot"],
  planning: ["plan", "roadmap", "strategy", "sequence", "design", "architecture"],
};

type CategoryScore = {
  category: TaskCategory;
  score: number;
  matchedKeywords: string[];
};

export type ClassifiedTask = {
  input: string;
  primaryCategory: TaskCategory;
  categories: CategoryScore[];
};

export function classifyTask(input: string): ClassifiedTask {
  const lower = input.toLowerCase();
  const scored = (Object.entries(CATEGORY_KEYWORDS) as [TaskCategory, string[]][]).map(
    ([category, keywords]) => {
      const matchedKeywords = keywords.filter((kw) => lower.includes(kw));
      return { category, score: matchedKeywords.length, matchedKeywords };
    },
  );

  scored.sort((a, b) => b.score - a.score);
  return { input, primaryCategory: scored[0]?.category ?? "implement", categories: scored };
}

export type SuggestCandidate = {
  sourcePath: string;
  name: string;
  summary?: string;
  tasks: string[];
  triggers: string[];
  pathApplicability: string[];
  estimatedTokens: number;
  penalties: Array<{ code: string; severity: "low" | "medium" | "high" }>;
};

export function buildCandidates(skillMetadata: SkillMetadata[]): SuggestCandidate[] {
  return skillMetadata.map((meta) => {
    const candidate: SuggestCandidate = {
      sourcePath: meta.sourcePath,
      name: meta.name,
      tasks: meta.tasks,
      triggers: meta.triggers,
      pathApplicability: meta.pathApplicability,
      estimatedTokens: meta.estimatedTokens,
      penalties: meta.penalties.map((p: SkillPenalty) => ({
        code: p.code,
        severity: p.severity,
      })),
    };
    if (meta.summary !== undefined) candidate.summary = meta.summary;
    return candidate;
  });
}

const WEIGHT_CATEGORY_MATCH = 40;
const WEIGHT_TRIGGER_MATCH = 30;
const WEIGHT_TASK_MATCH = 25;
const WEIGHT_PATH_MATCH = 10;
const WEIGHT_AGENT_MATCH = 10;
const PENALTY_LOW = -5;
const PENALTY_MEDIUM = -15;
const PENALTY_HIGH = -30;
const LOW_TOKEN_BONUS_MAX = 10;
const LOW_TOKEN_THRESHOLD = 300;

export type SuggestOptions = {
  maxPromptTokens?: number;
  maxSelectedSkills?: number;
  preferLowTokenSkills?: boolean;
  defaultBranch?: string;
  includeFullSkillText?: false;
};

export type ScoredSuggestCandidate = SuggestCandidate & {
  score: number;
  selected: boolean;
  reasons: string[];
  exclusions: string[];
};

function tokenBonus(tokens: number): number {
  if (tokens <= 0 || tokens >= LOW_TOKEN_THRESHOLD) return 0;
  return Math.round(LOW_TOKEN_BONUS_MAX * (1 - tokens / LOW_TOKEN_THRESHOLD));
}

function severityPoints(severity: "low" | "medium" | "high"): number {
  if (severity === "high") return PENALTY_HIGH;
  if (severity === "medium") return PENALTY_MEDIUM;
  return PENALTY_LOW;
}

function scoreCategoryMatch(tasks: string[], category: TaskCategory): { matched: boolean; reason: string } {
  const kws = CATEGORY_KEYWORDS[category];
  const matched =
    tasks.some((t) => kws.some((kw) => t.toLowerCase().includes(kw))) ||
    tasks.some((t) => t.toLowerCase().includes(category));
  return { matched, reason: `task matches category "${category}"` };
}

function scoreTriggerMatch(triggers: string[], lower: string): { matched: boolean; reason: string } {
  const hits = triggers.filter((tr) => lower.includes(tr.toLowerCase()));
  return { matched: hits.length > 0, reason: `trigger match: ${hits.join(", ")}` };
}

function scoreTaskMatch(tasks: string[], lower: string): { matched: boolean; reason: string } {
  const hits = tasks.filter((t) => lower.includes(t.toLowerCase()));
  return { matched: hits.length > 0, reason: `task keyword match: ${hits.join(", ")}` };
}

function scorePathMatch(paths: string[], lower: string): { matched: boolean } {
  if (paths.length === 0) return { matched: false };
  const matched = paths.some((p) => lower.includes(p.replaceAll("**", "").replaceAll("*", "").toLowerCase()));
  return { matched };
}

function applyPenalties(
  penalties: Array<{ code: string; severity: "low" | "medium" | "high" }>,
): { delta: number; exclusions: string[] } {
  let delta = 0;
  const exclusions: string[] = [];
  for (const p of penalties) {
    const pts = severityPoints(p.severity);
    delta += pts;
    exclusions.push(`penalty ${p.code} (${p.severity}): ${pts}`);
  }
  return { delta, exclusions };
}

export function scoreCandidate(
  candidate: SuggestCandidate,
  classified: ClassifiedTask,
  opts: { preferLowTokenSkills?: boolean } = {},
): ScoredSuggestCandidate {
  const lower = classified.input.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  const categoryResult = scoreCategoryMatch(candidate.tasks, classified.primaryCategory);
  if (categoryResult.matched) {
    score += WEIGHT_CATEGORY_MATCH;
    reasons.push(categoryResult.reason);
  }

  const triggerResult = scoreTriggerMatch(candidate.triggers, lower);
  if (triggerResult.matched) {
    score += WEIGHT_TRIGGER_MATCH;
    reasons.push(triggerResult.reason);
  }

  const taskResult = scoreTaskMatch(candidate.tasks, lower);
  if (taskResult.matched) {
    score += WEIGHT_TASK_MATCH;
    reasons.push(taskResult.reason);
  }

  if (scorePathMatch(candidate.pathApplicability, lower).matched) {
    score += WEIGHT_PATH_MATCH;
    reasons.push("path applicability match");
  }

  if (lower.includes(candidate.name.toLowerCase())) {
    score += WEIGHT_AGENT_MATCH;
    reasons.push(`agent name match: "${candidate.name}"`);
  }

  if (score > 0 && opts.preferLowTokenSkills !== false) {
    const bonus = tokenBonus(candidate.estimatedTokens);
    if (bonus > 0) {
      score += bonus;
      reasons.push(`low-token bonus (+${bonus})`);
    }
  }

  const { delta, exclusions } = applyPenalties(candidate.penalties);
  score += delta;

  return { ...candidate, score, selected: false, reasons, exclusions };
}

const PROMPT_TEMPLATES: Record<TaskCategory, string> = {
  audit: ["Audit: {task}", "Route: audit | Skills: {skills}", "Verify implementation against issue requirements.", "Check: correctness, completeness, spec adherence."].join("\n"),
  review: ["Review: {task}", "Route: review | Skills: {skills}", "Review the PR/diff for defects.", "Focus: correctness, security, style, edge cases."].join("\n"),
  implement: ["Implement: {task}", "Route: implement | Skills: {skills}", "Build the feature following existing patterns.", "Ensure: tests pass, code style matches, no regressions."].join("\n"),
  docs: ["Docs update: {task}", "Route: docs | Skills: {skills}", "Update or create documentation.", "Ensure: accuracy, clarity, completeness."].join("\n"),
  debug: ["Debug: {task}", "Route: debug | Skills: {skills}", "Investigate the failure systematically.", "Analyze: logs, stack traces, recent changes."].join("\n"),
  planning: ["Plan: {task}", "Route: planning | Skills: {skills}", "Design the implementation approach.", "Consider: scope, dependencies, risks, sequencing."].join("\n"),
};

export function buildPrompt(
  input: string,
  category: TaskCategory,
  selected: ScoredSuggestCandidate[],
  opts: { defaultBranch?: string; maxPromptTokens?: number } = {},
): string {
  const skillNames = selected.map((c) => c.name).join(", ") || "none";
  const branchLine = opts.defaultBranch ? `\nDefault branch: ${opts.defaultBranch}` : "";
  const prompt = PROMPT_TEMPLATES[category]
    .split("{task}").join(input)
    .split("{skills}").join(skillNames) + branchLine;
  return trimPromptToBudget(prompt, opts.maxPromptTokens);
}

function trimPromptToBudget(prompt: string, maxPromptTokens: number | undefined): string {
  if (maxPromptTokens === undefined || estimateTokens(prompt) <= maxPromptTokens) return prompt;

  const lines = prompt.split("\n");
  while (lines.length > 1 && estimateTokens(lines.join("\n")) > maxPromptTokens) {
    lines.splice(Math.max(1, lines.length - 2), 1);
  }

  let compact = lines.join("\n");
  if (estimateTokens(compact) <= maxPromptTokens) return compact;

  const marker = `[Prompt truncated to ${maxPromptTokens} tokens]`;
  if (estimateTokens(marker) >= maxPromptTokens) return trimTextToTokenBudget(compact, maxPromptTokens);

  compact = trimTextToTokenBudget(compact, maxPromptTokens - estimateTokens(marker));
  let withMarker = `${compact}\n${marker}`.trim();
  while (estimateTokens(withMarker) > maxPromptTokens && compact.length > 0) {
    compact = compact.slice(0, -1).trimEnd();
    withMarker = `${compact}\n${marker}`.trim();
  }

  return estimateTokens(withMarker) <= maxPromptTokens
    ? withMarker
    : trimTextToTokenBudget(marker, maxPromptTokens);
}

function trimTextToTokenBudget(text: string, maxTokens: number): string {
  let trimmed = text.slice(0, Math.max(0, maxTokens * 4)).trimEnd();
  while (estimateTokens(trimmed) > maxTokens && trimmed.length > 0) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return trimmed;
}

function computeAvoidedContext(
  selected: ScoredSuggestCandidate[],
  excluded: ScoredSuggestCandidate[],
): EstimatedAvoidedContext {
  const selectedTokens = sumTokens(selected);
  const excludedTokens = sumTokens(excluded);
  return { selectedTokens, excludedTokens, estimatedAvoidedTokens: excludedTokens };
}

const TOP_N = 3;

export type EstimatedAvoidedContext = {
  selectedTokens: number;
  excludedTokens: number;
  estimatedAvoidedTokens: number;
};

export type SuggestResult = {
  input: string;
  classification: ClassifiedTask;
  selected: ScoredSuggestCandidate[];
  excluded: ScoredSuggestCandidate[];
  route: string;
  prompt: string;
  estimatedAvoidedContext: EstimatedAvoidedContext;
};

async function readSourceContents(
  cwd: string,
  sources: Array<{ path: string }>,
): Promise<Map<string, string>> {
  return new Map(
    (
      await Promise.all(
        sources.map(async (source) => {
          try {
            return [source.path, await readFile(path.join(cwd, source.path), "utf8")] as const;
          } catch {
            return null;
          }
        }),
      )
    ).filter((entry): entry is readonly [string, string] => entry !== null),
  );
}

async function analyzeSourcesInMemory(
  cwd: string,
  sources: Awaited<ReturnType<typeof discoverInstructionSources>>,
  sourceContents: ReadonlyMap<string, string>,
): Promise<AnalyzedInstructionSource[]> {
  return Promise.all(
    sources.map(async (source) => {
      const text = sourceContents.get(source.path);
      if (text === undefined) return { ...source, bytes: 0, estimatedTokens: 0 };

      let bytes: number;
      try {
        bytes = (await stat(path.join(cwd, source.path))).size;
      } catch {
        bytes = Buffer.byteLength(text);
      }

      return { ...source, bytes, estimatedTokens: estimateTokens(text) };
    }),
  );
}

function parseInstructionContext(
  analyzed: AnalyzedInstructionSource[],
  sourceContents: ReadonlyMap<string, string>,
): { sections: InstructionSection[]; commands: CommandRecord[] } {
  const sections: InstructionSection[] = [];
  const commands: CommandRecord[] = [];

  for (const source of analyzed) {
    const text = sourceContents.get(source.path);
    if (text === undefined) continue;

    const sourceSections = parseSections(source.path, text);
    sections.push(...sourceSections);
    commands.push(...extractCommands(source.path, text, sourceSections));
  }

  return { sections, commands };
}

export async function buildSuggestResultForTask(
  cwd: string,
  task: string,
  config?: instructovConfig,
): Promise<SuggestResult> {
  const resolvedConfig = config ?? await loadinstructovConfig(cwd);
  const sources = await discoverInstructionSources(cwd, resolvedConfig.discovery);
  const sourceContents = await readSourceContents(cwd, sources);
  const analyzed = await analyzeSourcesInMemory(cwd, sources, sourceContents);
  const parsed = parseInstructionContext(analyzed, sourceContents);
  const findings = detectFindings({
    sources: analyzed,
    sections: parsed.sections,
    commands: parsed.commands,
  }, {
    tokenThresholds: resolvedConfig.doctor.token_thresholds,
  });
  const skillMetadata = extractAllSkillMetadata(analyzed, sourceContents, findings);
  const candidates = buildCandidates(skillMetadata);
  const classified = classifyTask(task);

  return selectCandidates(candidates, classified, {
    defaultBranch: resolvedConfig.suggest.default_branch,
    maxPromptTokens: resolvedConfig.suggest.max_prompt_tokens,
    maxSelectedSkills: resolvedConfig.suggest.max_selected_skills,
    preferLowTokenSkills: resolvedConfig.suggest.prefer_low_token_skills,
    includeFullSkillText: resolvedConfig.suggest.include_full_skill_text,
  });
}

export function selectCandidates(
  candidates: SuggestCandidate[],
  classified: ClassifiedTask,
  opts: SuggestOptions = {},
): SuggestResult {
  const maxSelectedSkills = opts.maxSelectedSkills ?? TOP_N;
  const scoreOptions: { preferLowTokenSkills?: boolean } = {};
  if (opts.preferLowTokenSkills !== undefined) scoreOptions.preferLowTokenSkills = opts.preferLowTokenSkills;

  const scored = candidates
    .map((c) => scoreCandidate(c, classified, scoreOptions))
    .sort((a, b) => b.score - a.score);

  const relevant: ScoredSuggestCandidate[] = [];
  const irrelevant: ScoredSuggestCandidate[] = [];
  for (const c of scored) (c.score > 0 ? relevant : irrelevant).push(c);

  const selected = relevant.slice(0, maxSelectedSkills).map((c) => ({ ...c, selected: true }));
  const excluded = [
    ...relevant.slice(maxSelectedSkills).map((c) => ({ ...c, selected: false })),
    ...irrelevant,
  ];

  const route = classified.primaryCategory;
  const promptOptions: { defaultBranch?: string; maxPromptTokens?: number } = {};
  if (opts.defaultBranch !== undefined) promptOptions.defaultBranch = opts.defaultBranch;
  if (opts.maxPromptTokens !== undefined) promptOptions.maxPromptTokens = opts.maxPromptTokens;
  const prompt = buildPrompt(classified.input, classified.primaryCategory, selected, promptOptions);
  const estimatedAvoidedContext = computeAvoidedContext(selected, excluded);

  return {
    input: classified.input,
    classification: classified,
    selected,
    excluded,
    route,
    prompt,
    estimatedAvoidedContext,
  };
}

function formatSelected(selected: ScoredSuggestCandidate[]): string[] {
  if (selected.length === 0) return ["No relevant skill candidates found."];

  const lines: string[] = [`Selected (${selected.length}):`];
  for (const c of selected) {
    lines.push(`  ${c.name} [score: ${c.score}] ~${c.estimatedTokens} tokens`);
    if (c.summary) lines.push(`    ${c.summary}`);
    if (c.reasons.length > 0) lines.push(`    reasons: ${c.reasons.join("; ")}`);
  }
  return lines;
}

function formatExcluded(excluded: ScoredSuggestCandidate[], limit = 3): string[] {
  if (excluded.length === 0) return [];

  const count = excluded.length;
  const lines: string[] = [`Excluded: ${count} ${pluralize(count, "candidate")}`];
  const { visible, omittedCount } = previewItems(excluded, limit);

  for (const c of visible) {
    const note = c.exclusions.length > 0 ? ` — ${c.exclusions[0]}` : "";
    lines.push(`  ${c.name} [score: ${c.score}]${note}`);
  }
  if (omittedCount > 0) lines.push(`  ... ${omittedCount} more`);

  return lines;
}

export function formatSuggestText(
  result: SuggestResult,
  opts: { excludedLimit?: number } = {},
): string[] {
  const { estimatedAvoidedContext: ctx } = result;
  return [
    `instructov suggest "${result.input}"`,
    `Task category: ${result.classification.primaryCategory}`,
    "",
    ...formatSelected(result.selected),
    ...formatExcluded(result.excluded, opts.excludedLimit),
    "",
    "Suggested prompt:",
    ...result.prompt.split("\n").map((l) => `  ${l}`),
    "",
    `Estimated avoided context: ~${ctx.excludedTokens} tokens excluded (~${ctx.selectedTokens} selected)`,
  ];
}
