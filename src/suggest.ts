import type { SkillMetadata, SkillPenalty } from "./skillMetadata.js";

// ---------------------------------------------------------------------------
// Task classification
// ---------------------------------------------------------------------------

export type TaskCategory =
  | "audit"
  | "review"
  | "implement"
  | "docs"
  | "debug"
  | "planning";

const CATEGORY_KEYWORDS: Record<TaskCategory, string[]> = {
  audit: [
    "audit",
    "verify",
    "merged",
    "inspect",
    "check implementation",
    "verify merged",
    "issue",
  ],
  review: [
    "review",
    "code review",
    "pr",
    "pull request",
    "diff",
    "critique",
  ],
  implement: [
    "implement",
    "build",
    "add",
    "fix",
    "create",
    "change",
  ],
  docs: [
    "docs",
    "readme",
    "documentation",
    "write",
    "update guide",
  ],
  debug: [
    "debug",
    "error",
    "failing",
    "broken",
    "stack trace",
    "troubleshoot",
  ],
  planning: [
    "plan",
    "roadmap",
    "strategy",
    "sequence",
    "design",
    "architecture",
  ],
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

  const scored: CategoryScore[] = (
    Object.entries(CATEGORY_KEYWORDS) as [TaskCategory, string[]][]
  ).map(([category, keywords]) => {
    const matchedKeywords = keywords.filter((kw) => lower.includes(kw));
    return { category, score: matchedKeywords.length, matchedKeywords };
  });

  scored.sort((a, b) => b.score - a.score);

  const primary = scored[0]?.category ?? "implement";

  return { input, primaryCategory: primary, categories: scored };
}

// ---------------------------------------------------------------------------
// Candidate building
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

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

function scoreCategoryMatch(
  tasks: string[],
  category: TaskCategory,
): { matched: boolean; reason: string } {
  const kws = CATEGORY_KEYWORDS[category];
  const matched =
    tasks.some((t) => kws.some((kw) => t.toLowerCase().includes(kw))) ||
    tasks.some((t) => t.toLowerCase().includes(category));
  return {
    matched,
    reason: `task matches category "${category}"`,
  };
}

function scoreTriggerMatch(
  triggers: string[],
  lower: string,
): { matched: boolean; reason: string } {
  const hits = triggers.filter((tr) => lower.includes(tr.toLowerCase()));
  return {
    matched: hits.length > 0,
    reason: `trigger match: ${hits.join(", ")}`,
  };
}

function scoreTaskMatch(
  tasks: string[],
  lower: string,
): { matched: boolean; reason: string } {
  const hits = tasks.filter((t) => lower.includes(t.toLowerCase()));
  return {
    matched: hits.length > 0,
    reason: `task keyword match: ${hits.join(", ")}`,
  };
}

function scorePathMatch(
  paths: string[],
  lower: string,
): { matched: boolean } {
  if (paths.length === 0) return { matched: false };
  const matched = paths.some((p) =>
    lower.includes(p.replaceAll("**", "").replaceAll("*", "").toLowerCase()),
  );
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

  const pathResult = scorePathMatch(candidate.pathApplicability, lower);
  if (pathResult.matched) {
    score += WEIGHT_PATH_MATCH;
    reasons.push("path applicability match");
  }

  if (lower.includes(candidate.name.toLowerCase())) {
    score += WEIGHT_AGENT_MATCH;
    reasons.push(`agent name match: "${candidate.name}"`);
  }

  // Token bonus only as tie-breaker; don't make irrelevant candidates relevant.
  if (score > 0) {
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

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

const PROMPT_TEMPLATES: Record<TaskCategory, string> = {
  audit: [
    "Audit: {task}",
    "Route: audit | Skills: {skills}",
    "Verify implementation against issue requirements.",
    "Check: correctness, completeness, spec adherence.",
  ].join("\n"),
  review: [
    "Review: {task}",
    "Route: review | Skills: {skills}",
    "Review the PR/diff for defects.",
    "Focus: correctness, security, style, edge cases.",
  ].join("\n"),
  implement: [
    "Implement: {task}",
    "Route: implement | Skills: {skills}",
    "Build the feature following existing patterns.",
    "Ensure: tests pass, code style matches, no regressions.",
  ].join("\n"),
  docs: [
    "Docs update: {task}",
    "Route: docs | Skills: {skills}",
    "Update or create documentation.",
    "Ensure: accuracy, clarity, completeness.",
  ].join("\n"),
  debug: [
    "Debug: {task}",
    "Route: debug | Skills: {skills}",
    "Investigate the failure systematically.",
    "Analyze: logs, stack traces, recent changes.",
  ].join("\n"),
  planning: [
    "Plan: {task}",
    "Route: planning | Skills: {skills}",
    "Design the implementation approach.",
    "Consider: scope, dependencies, risks, sequencing.",
  ].join("\n"),
};

export function buildPrompt(
  input: string,
  category: TaskCategory,
  selected: ScoredSuggestCandidate[],
): string {
  const skillNames = selected.map((c) => c.name).join(", ") || "none";
  return PROMPT_TEMPLATES[category]
    .split("{task}").join(input)
    .split("{skills}").join(skillNames);
}

function computeAvoidedContext(
  selected: ScoredSuggestCandidate[],
  excluded: ScoredSuggestCandidate[],
): EstimatedAvoidedContext {
  const selectedTokens = selected.reduce((sum, c) => sum + c.estimatedTokens, 0);
  const excludedTokens = excluded.reduce((sum, c) => sum + c.estimatedTokens, 0);
  return { selectedTokens, excludedTokens, estimatedAvoidedTokens: excludedTokens };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

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

export function selectCandidates(
  candidates: SuggestCandidate[],
  classified: ClassifiedTask,
): SuggestResult {
  const scored = candidates
    .map((c) => scoreCandidate(c, classified))
    .sort((a, b) => b.score - a.score);

  const relevant: ScoredSuggestCandidate[] = [];
  const irrelevant: ScoredSuggestCandidate[] = [];
  for (const c of scored) {
    (c.score > 0 ? relevant : irrelevant).push(c);
  }

  const selected = relevant.slice(0, TOP_N).map((c) => ({ ...c, selected: true }));
  const excluded = [
    ...relevant.slice(TOP_N).map((c) => ({ ...c, selected: false })),
    ...irrelevant,
  ];

  const route = classified.primaryCategory;
  const prompt = buildPrompt(classified.input, classified.primaryCategory, selected);
  const estimatedAvoidedContext = computeAvoidedContext(selected, excluded);

  return { input: classified.input, classification: classified, selected, excluded, route, prompt, estimatedAvoidedContext };
}

// ---------------------------------------------------------------------------
// Text formatting
// ---------------------------------------------------------------------------

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

function formatExcluded(excluded: ScoredSuggestCandidate[]): string[] {
  if (excluded.length === 0) return [];

  const count = excluded.length;
  const label = count === 1 ? "candidate" : "candidates";
  const lines: string[] = [`Excluded: ${count} ${label}`];

  for (const c of excluded.slice(0, 3)) {
    const note = c.exclusions.length > 0 ? ` — ${c.exclusions[0]}` : "";
    lines.push(`  ${c.name} [score: ${c.score}]${note}`);
  }
  if (count > 3) lines.push(`  ... ${count - 3} more`);

  return lines;
}

export function formatSuggestText(result: SuggestResult): string[] {
  const { estimatedAvoidedContext: ctx } = result;
  return [
    `agentctx suggest "${result.input}"`,
    `Task category: ${result.classification.primaryCategory}`,
    "",
    ...formatSelected(result.selected),
    ...formatExcluded(result.excluded),
    "",
    "Suggested prompt:",
    ...result.prompt.split("\n").map((l) => `  ${l}`),
    "",
    `Estimated avoided context: ~${ctx.excludedTokens} tokens excluded (~${ctx.selectedTokens} selected)`,
  ];
}
