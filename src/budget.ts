import type { Finding } from "./findings.js";

export type BudgetSavingsOpportunity = {
  code: Finding["code"];
  sourcePath: string;
  estimatedAvoidableTokens: number;
  lineStart?: number;
  lineEnd?: number;
  message: string;
};

export type ContextBudgetReport = {
  tokens: number;
  estimatedTokens: number;
  deltaTokens: number;
  status: "under" | "over" | "exact";
  topSavings: BudgetSavingsOpportunity[];
  approximate: true;
};

function statusFor(deltaTokens: number): ContextBudgetReport["status"] {
  if (deltaTokens > 0) return "over";
  if (deltaTokens < 0) return "under";
  return "exact";
}

function opportunityFor(finding: Finding): BudgetSavingsOpportunity | null {
  if (finding.estimatedAvoidableTokens === undefined) return null;

  const opportunity: BudgetSavingsOpportunity = {
    code: finding.code,
    sourcePath: finding.sourcePath,
    estimatedAvoidableTokens: finding.estimatedAvoidableTokens,
    message: finding.message,
  };
  if (finding.lineStart !== undefined) opportunity.lineStart = finding.lineStart;
  if (finding.lineEnd !== undefined) opportunity.lineEnd = finding.lineEnd;
  return opportunity;
}

function isBudgetSavingsOpportunity(
  opportunity: BudgetSavingsOpportunity | null,
): opportunity is BudgetSavingsOpportunity {
  return opportunity !== null;
}

function insertTopSavings(
  topSavings: BudgetSavingsOpportunity[],
  opportunity: BudgetSavingsOpportunity,
  limit: number,
): BudgetSavingsOpportunity[] {
  const next = [...topSavings, opportunity];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const current = next[index]!;
    const previous = next[index - 1]!;
    if (
      current.estimatedAvoidableTokens <= previous.estimatedAvoidableTokens
    ) {
      break;
    }
    next[index - 1] = current;
    next[index] = previous;
  }

  return next.length > limit ? next.slice(0, limit) : next;
}

function topSavingsFromFindings(
  findings: Finding[],
  limit: number,
): BudgetSavingsOpportunity[] {
  if (limit <= 0) return [];

  return findings
    .map(opportunityFor)
    .filter(isBudgetSavingsOpportunity)
    .reduce<BudgetSavingsOpportunity[]>(
      (topSavings, opportunity) =>
        insertTopSavings(topSavings, opportunity, limit),
      [],
    );
}

export function buildContextBudgetReport(input: {
  tokens: number;
  estimatedTokens: number;
  findings?: Finding[];
  savingsLimit?: number;
}): ContextBudgetReport {
  const deltaTokens = input.estimatedTokens - input.tokens;
  const topSavings = topSavingsFromFindings(
    input.findings ?? [],
    input.savingsLimit ?? 5,
  );

  return {
    tokens: input.tokens,
    estimatedTokens: input.estimatedTokens,
    deltaTokens,
    status: statusFor(deltaTokens),
    topSavings,
    approximate: true,
  };
}

export function formatBudgetText(report: ContextBudgetReport): string[] {
  const lines = [
    "Context budget",
    "",
    `Estimated instruction context: ~${report.estimatedTokens} tokens`,
    `Budget: ~${report.tokens} tokens`,
    ...formatBudgetStatus(report),
  ];

  if (report.topSavings.length === 0) return lines;

  return [
    ...lines,
    "",
    "Top savings:",
    ...report.topSavings.map((saving, index) => {
      const location = saving.lineStart === undefined
        ? saving.sourcePath
        : `${saving.sourcePath}:${saving.lineStart}`;
      return `${index + 1}. ${saving.code} in ${location}: ~${saving.estimatedAvoidableTokens} tokens`;
    }),
  ];
}

function formatBudgetStatus(report: ContextBudgetReport): string[] {
  if (report.status === "exact") return ["At budget."];

  const amount = Math.abs(report.deltaTokens);
  return [
    report.status === "over"
      ? `Over budget by: ~${amount} tokens`
      : `Under budget by: ~${amount} tokens`,
  ];
}
