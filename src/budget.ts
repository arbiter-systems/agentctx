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

  return {
    code: finding.code,
    sourcePath: finding.sourcePath,
    estimatedAvoidableTokens: finding.estimatedAvoidableTokens,
    message: finding.message,
    ...(finding.lineStart !== undefined ? { lineStart: finding.lineStart } : {}),
    ...(finding.lineEnd !== undefined ? { lineEnd: finding.lineEnd } : {}),
  };
}

function isBudgetSavingsOpportunity(
  opportunity: BudgetSavingsOpportunity | null,
): opportunity is BudgetSavingsOpportunity {
  return opportunity !== null;
}

function topSavingsFromFindings(
  findings: Finding[],
  limit: number,
): BudgetSavingsOpportunity[] {
  if (limit <= 0) return [];

  return findings
    .map(opportunityFor)
    .filter(isBudgetSavingsOpportunity)
    .sort((a, b) => b.estimatedAvoidableTokens - a.estimatedAvoidableTokens)
    .slice(0, limit);
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
