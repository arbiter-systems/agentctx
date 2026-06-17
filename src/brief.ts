import type {
  EstimatedAvoidedContext,
  ScoredSuggestCandidate,
  SuggestResult,
} from "./suggest.js";
import { previewItems } from "./formatting.js";

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

  const { visible, omittedCount } = previewItems(guidance, limit);
  const lines = visible.map(
    (item) => `- ${item.path} - ${item.reason}`,
  );
  return omittedCount > 0
    ? [...lines, `... ${omittedCount} more omitted.`]
    : lines;
}

export function formatBriefText(
  result: BriefResult,
  opts: { selectedLimit?: number; excludedLimit?: number } = {},
): string[] {
  const selectedLimit = opts.selectedLimit ?? 3;
  const excludedLimit = opts.excludedLimit ?? 3;

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
