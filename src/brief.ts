import type {
  EstimatedAvoidedContext,
  ScoredSuggestCandidate,
  SuggestResult,
} from "./suggest.js";

export type BriefGuidance = {
  path: string;
  name: string;
  reason: string;
  estimatedTokens: number;
  reasons: string[];
  exclusions: string[];
};

export type BriefResult = {
  command: "brief";
  task: string;
  selectedGuidance: BriefGuidance[];
  excludedGuidance: BriefGuidance[];
  prompt: string;
  route: string;
  estimatedAvoidedContext: EstimatedAvoidedContext;
};

function compactReason(candidate: ScoredSuggestCandidate): string {
  return candidate.reasons[0] ??
    candidate.exclusions[0] ??
    "not selected for this task";
}

function toBriefGuidance(candidate: ScoredSuggestCandidate): BriefGuidance {
  return {
    path: candidate.sourcePath,
    name: candidate.name,
    reason: compactReason(candidate),
    estimatedTokens: candidate.estimatedTokens,
    reasons: candidate.reasons,
    exclusions: candidate.exclusions,
  };
}

export function buildBriefResult(suggestResult: SuggestResult): BriefResult {
  return {
    command: "brief",
    task: suggestResult.input,
    selectedGuidance: suggestResult.selected.map(toBriefGuidance),
    excludedGuidance: suggestResult.excluded.map(toBriefGuidance),
    prompt: suggestResult.prompt,
    route: suggestResult.route,
    estimatedAvoidedContext: suggestResult.estimatedAvoidedContext,
  };
}

function formatGuidance(
  guidance: BriefGuidance[],
  emptyMessage: string,
  limit: number,
): string[] {
  if (guidance.length === 0) return [emptyMessage];

  const visible = guidance.slice(0, limit).map(
    (item) => `- ${item.path} - ${item.reason}`,
  );
  const omitted = guidance.length - visible.length;
  return omitted > 0
    ? [...visible, `... ${omitted} more omitted.`]
    : visible;
}

export function formatBriefText(result: BriefResult): string[] {
  const selectedLimit = Math.max(1, result.selectedGuidance.length);
  const excludedLimit = Math.max(1, Math.min(3, selectedLimit));

  return [
    "Task briefing",
    "",
    "Selected guidance:",
    ...formatGuidance(
      result.selectedGuidance,
      "- No matching guidance selected.",
      selectedLimit,
    ),
    "",
    "Excluded guidance:",
    ...formatGuidance(
      result.excludedGuidance,
      "- No guidance excluded.",
      excludedLimit,
    ),
    "",
    "Suggested prompt:",
    ...result.prompt.split("\n"),
    "",
    `Estimated avoided context: ~${result.estimatedAvoidedContext.estimatedAvoidedTokens} tokens`,
  ];
}
