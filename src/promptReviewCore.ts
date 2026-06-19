import { estimateTokens } from "./tokenEstimate.js";

export const REVIEW_PROFILES = ["coding-task", "code-review", "planning", "general"] as const;
export type ReviewProfile = typeof REVIEW_PROFILES[number];
export type ReviewSeverity = "high" | "medium" | "low";
export type ReviewFindingCode = "empty-prompt" | "missing-objective" | "missing-validation" | "duplicate-constraint" | "destructive-command" | "likely-secret";

export type ReviewFinding = {
  code: ReviewFindingCode;
  severity: ReviewSeverity;
  message: string;
  lineStart?: number;
  lineEnd?: number;
  verdict?: string;
};

export type PromptReviewReport = {
  command: "review";
  status: "ok";
  profile: ReviewProfile;
  estimatedTokens: number;
  findings: ReviewFinding[];
};

export type ReviewPromptOptions = { profile?: ReviewProfile };

const structuredProfiles = new Set<ReviewProfile>(["coding-task", "code-review", "planning"]);
const objectivePatterns: Record<ReviewProfile, RegExp> = {
  "coding-task": /\b(add|build|change|create|document|fix|implement|improve|migrate|refactor|remove|test|update)\b/i,
  "code-review": /\b(audit|assess|check|inspect|review|verify)\b/i,
  planning: /\b(analy[sz]e|design|evaluate|plan|propose|recommend|roadmap|sequence)\b/i,
  general: /\S/,
};
const validationPattern = /\b(acceptance criteria|assert|build|check|confirm|coverage|lint|test|typecheck|validate|verification|verify)\b/i;
const constraintLeadPattern = /^(do not|don't|must not|must|never|no |avoid|keep|only |always |require )/i;
const destructivePatterns = [/\brm\s+-[^\n]*r[^\n]*f\b/i, /\bgit\s+reset\s+--hard\b/i, /\bgit\s+clean\s+-[^\n]*f/i, /\bgit\s+push\s+--force(?:-with-lease)?\b/i, /\bterraform\s+destroy\b/i, /\bkubectl\s+delete\b/i, /\b(drop\s+(database|schema|table)|truncate\s+table)\b/i, /\bdelete\s+from\s+[^\n;]+(?:;|$)/i];
const secretPatterns = [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{16,}\b/, /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i, /\bgithub_pat_[A-Za-z0-9_]{20,}\b/i, /\bAKIA[0-9A-Z]{16}\b/, /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|token)\s*[:=]\s*[^\s"']{8,}/i];

export function isReviewProfile(value: string): value is ReviewProfile {
  return REVIEW_PROFILES.includes(value as ReviewProfile);
}

function lineFinding(code: ReviewFindingCode, severity: ReviewSeverity, message: string, line: number, verdict?: string): ReviewFinding {
  return { code, severity, message, lineStart: line, ...(verdict === undefined ? {} : { verdict }) };
}

function isLikelyPlaceholder(line: string): boolean {
  return /(?:<[^>]+>|\byour[-_ ]?(?:key|token|secret|password)\b|example[-_ ]?(?:key|token|secret|password))/i.test(line);
}

export function reviewPrompt(text: string, options: ReviewPromptOptions = {}): PromptReviewReport {
  const profile = options.profile ?? "general";
  const lines = text.split(/\r?\n/);
  const findings: ReviewFinding[] = [];
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstIndex === -1) {
    findings.push({ code: "empty-prompt", severity: "high", message: "Prompt is empty.", verdict: "Provide the task or question to review." });
    return { command: "review", status: "ok", profile, estimatedTokens: estimateTokens(text), findings };
  }
  const firstLine = firstIndex + 1;
  if (structuredProfiles.has(profile) && !lines.some((line) => objectivePatterns[profile].test(line))) {
    findings.push(lineFinding("missing-objective", "medium", "No explicit objective was detected for the selected review profile.", firstLine, "State the intended outcome with a concrete action."));
  }
  if ((profile === "coding-task" || profile === "code-review") && !lines.some((line) => validationPattern.test(line))) {
    findings.push(lineFinding("missing-validation", "medium", "No validation or acceptance criteria were detected.", firstLine, "Add the tests, checks, or acceptance criteria that define done."));
  }
  const seenConstraints = new Map<string, number>();
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.length < 12 || !constraintLeadPattern.test(trimmed)) return;
    const normalized = trimmed.toLowerCase().replace(/\b(please|the|a|an)\b/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (normalized.length < 10) return;
    const previous = seenConstraints.get(normalized);
    if (previous !== undefined) findings.push(lineFinding("duplicate-constraint", "low", `Constraint duplicates line ${previous}.`, index + 1, "Keep one authoritative version of the constraint."));
    else seenConstraints.set(normalized, index + 1);
  });
  lines.forEach((line, index) => {
    if (destructivePatterns.some((pattern) => pattern.test(line))) findings.push(lineFinding("destructive-command", "high", "Potentially destructive command detected.", index + 1, "Require explicit confirmation and a bounded target before running it."));
    if (!isLikelyPlaceholder(line) && secretPatterns.some((pattern) => pattern.test(line))) findings.push(lineFinding("likely-secret", "high", "Likely credential or secret detected; the value is not displayed.", index + 1, "Remove the value and supply credentials through an approved secret mechanism."));
  });
  return { command: "review", status: "ok", profile, estimatedTokens: estimateTokens(text), findings };
}

export function formatReviewText(report: PromptReviewReport, commandName = "instv"): string[] {
  const lines = [`${commandName} review`, `Profile: ${report.profile}`, `Estimated prompt size: ~${report.estimatedTokens} tokens.`];
  for (const [severity, heading] of [["high", "Must address"], ["medium", "Consider"], ["low", "Info"]] as const) {
    const grouped = report.findings.filter((finding) => finding.severity === severity);
    if (grouped.length === 0) continue;
    lines.push("", `${heading}:`);
    for (const finding of grouped) {
      lines.push(`- ${finding.message}${finding.lineStart === undefined ? "" : ` (line ${finding.lineStart})`}`);
      if (finding.verdict !== undefined) lines.push(`  Verdict: ${finding.verdict}`);
    }
  }
  if (report.findings.length === 0) lines.push("", "No high-confidence findings.");
  return lines;
}
