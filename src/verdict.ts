import type { Finding, FindingCode } from "./findings.js";

export type FindingWithVerdict = Finding & {
  verdict?: string;
};

const VERDICTS: Partial<Record<FindingCode, string>> = {
  "duplicate-guidance": "Keep the rule in one authoritative source and remove the duplicate.",
  "duplicate-command": "Keep repeated command guidance in one place.",
  "duplicate-heading": "Rename repeated headings or merge overlapping sections.",
  "oversized-source": "Split broad guidance into smaller scoped instruction files.",
  "oversized-section": "Break this section into narrower task-specific guidance.",
  "high-token-waste-source": "Reduce or scope this file before adding more guidance.",
  "risky-validation-command": "Use targeted validation unless full validation is explicitly requested.",
  "unbounded-command": "Use a scoped test path, filter, or package-specific validation command.",
  "restore-heavy-command": "Avoid dependency restore commands unless dependency work is requested.",
  "full-repo-format-command": "Format only changed files or paths unless full formatting is requested.",
  "conflicting-branch-target": "Choose one branch target as the source of truth.",
  "conflicting-pr-target": "Choose one PR target branch as the source of truth.",
  "conflicting-validation-guidance": "Choose one validation scope and make exceptions explicit.",
  "conflicting-format-guidance": "Choose one formatting scope and align command examples.",
  "conflicting-delegation-guidance": "Keep delegation guidance in one explicit mode.",
  "conflicting-destructive-action-guidance": "Require explicit approval before destructive or automatic changes.",
  "missing-branch-guidance": "Add a short rule that names the default branch and branch naming expectation.",
  "missing-pr-guidance": "Add a short rule for PR target, title, body, and review expectations.",
  "missing-validation-guidance": "Add a short rule for bounded validation and when to ask before full validation.",
  "missing-destructive-command-guidance": "Add a short rule to confirm before destructive commands or irreversible edits.",
  "missing-skill-purpose": "Add a short purpose or summary for this skill.",
  "missing-skill-trigger": "Add trigger guidance that says when to use this skill.",
};

export function verdictForFinding(finding: Finding): string | undefined {
  return VERDICTS[finding.code];
}

export function withVerdicts(findings: Finding[]): Finding[] {
  return findings.map((finding) => {
    const verdict = verdictForFinding(finding);
    return verdict === undefined ? finding : { ...finding, verdict };
  });
}

export function findingVerdict(finding: Finding): string | undefined {
  return (finding as FindingWithVerdict).verdict;
}
