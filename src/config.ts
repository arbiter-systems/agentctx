import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { VALID_FINDING_CODES } from "./findings.js";

const CONFIG_FILE_NAME = "agentctx.yml";

const positiveInteger = z.number().int().positive();

const tokenThresholdsSchema = z.object({
  source_warning: positiveInteger.optional(),
  source_high: positiveInteger.optional(),
  section_warning: positiveInteger.optional(),
}).strict();

const discoverySchema = z.object({
  include: z.array(z.string().min(1)).optional(),
  exclude: z.array(z.string().min(1)).optional(),
}).strict();

const doctorSchema = z.object({
  token_thresholds: tokenThresholdsSchema.optional(),
  fail_on: z.array(z.enum(VALID_FINDING_CODES)).optional(),
}).strict();

const suggestSchema = z.object({
  default_branch: z.string().min(1).optional(),
  max_prompt_tokens: positiveInteger.optional(),
  max_selected_skills: positiveInteger.optional(),
  prefer_low_token_skills: z.boolean().optional(),
  include_full_skill_text: z.boolean().optional(),
}).strict();

const displayLimitsSchema = z.object({
  findings: positiveInteger.optional(),
  selected_guidance: positiveInteger.optional(),
  excluded_guidance: positiveInteger.optional(),
  suggest_excluded: positiveInteger.optional(),
}).strict();

const configSchema = z.object({
  version: z.literal("v0alpha1"),
  discovery: discoverySchema.optional(),
  doctor: doctorSchema.optional(),
  suggest: suggestSchema.optional(),
  display_limits: displayLimitsSchema.optional(),
}).strict();

export type AgentctxConfig = {
  version: "v0alpha1";
  discovery: {
    include: string[];
    exclude: string[];
  };
  doctor: {
    token_thresholds: {
      source_warning: number;
      source_high: number;
      section_warning: number;
    };
    fail_on: Array<(typeof VALID_FINDING_CODES)[number]>;
  };
  suggest: {
    default_branch: string;
    max_prompt_tokens: number;
    max_selected_skills: number;
    prefer_low_token_skills: boolean;
    include_full_skill_text: false;
  };
  display_limits: {
    findings: number;
    selected_guidance: number;
    excluded_guidance: number;
    suggest_excluded: number;
  };
};

type PartialConfig = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const DEFAULT_AGENTCTX_CONFIG: AgentctxConfig = {
  version: "v0alpha1",
  discovery: {
    include: [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      ".github/copilot-instructions.md",
      "**/SKILL.md",
    ],
    exclude: [
      "node_modules/**",
      "vendor/**",
      "dist/**",
      "build/**",
    ],
  },
  doctor: {
    token_thresholds: {
      source_warning: 1200,
      source_high: 2000,
      section_warning: 500,
    },
    fail_on: [
      "conflicting-branch-target",
      "risky-validation-command",
    ],
  },
  suggest: {
    default_branch: "dev",
    max_prompt_tokens: 350,
    max_selected_skills: 3,
    prefer_low_token_skills: true,
    include_full_skill_text: false,
  },
  display_limits: {
    findings: 10,
    selected_guidance: 3,
    excluded_guidance: 3,
    suggest_excluded: 3,
  },
};

type ParsedLine = {
  indent: number;
  content: string;
  lineNumber: number;
};

type ParseContext = {
  lines: ParsedLine[];
  index: number;
};

function cloneDefaultConfig(): AgentctxConfig {
  return {
    version: DEFAULT_AGENTCTX_CONFIG.version,
    discovery: {
      include: [...DEFAULT_AGENTCTX_CONFIG.discovery.include],
      exclude: [...DEFAULT_AGENTCTX_CONFIG.discovery.exclude],
    },
    doctor: {
      token_thresholds: { ...DEFAULT_AGENTCTX_CONFIG.doctor.token_thresholds },
      fail_on: [...DEFAULT_AGENTCTX_CONFIG.doctor.fail_on],
    },
    suggest: { ...DEFAULT_AGENTCTX_CONFIG.suggest },
    display_limits: { ...DEFAULT_AGENTCTX_CONFIG.display_limits },
  };
}

function stripComment(line: string): string {
  let quote: "'" | "\"" | null = null;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if ((char === "'" || char === "\"") && quote === null) {
      quote = char;
    } else if (char === quote) {
      quote = null;
    } else if (char === "#" && quote === null) {
      return line.slice(0, index);
    }
  }
  return line;
}

function prepareLines(text: string): ParsedLine[] {
  const rawLines = text.replaceAll("\r\n", "\n").split("\n");
  return rawLines.flatMap((rawLine, index) => {
    if (rawLine.includes("\t")) {
      throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: tabs are not supported at line ${index + 1}.`);
    }

    const withoutComments = stripComment(rawLine);
    if (withoutComments.trim() === "") return [];

    const indent = new RegExp(/^ */).exec(withoutComments)?.[0].length ?? 0;
    if (indent % 2 !== 0) {
      throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: indentation must use two spaces at line ${index + 1}.`);
    }

    return [{ indent, content: withoutComments.trimEnd().trimStart(), lineNumber: index + 1 }];
  });
}

function parseScalar(value: string, lineNumber: number): string | number | boolean {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "" || /[[\]{}&,*!|>]/.test(trimmed)) {
    throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: unsupported scalar at line ${lineNumber}.`);
  }
  return trimmed;
}

function parseList(context: ParseContext, indent: number): unknown[] {
  const values: unknown[] = [];
  while (context.index < context.lines.length) {
    const line = context.lines[context.index];
    if (!line || line.indent < indent) break;
    if (line.indent !== indent || !line.content.startsWith("- ")) break;

    const value = line.content.slice(2).trim();
    if (value === "") {
      throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: nested list items are not supported at line ${line.lineNumber}.`);
    }
    values.push(parseScalar(value, line.lineNumber));
    context.index += 1;
  }
  return values;
}

function parseMap(context: ParseContext, indent: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  while (context.index < context.lines.length) {
    const line = context.lines[context.index];
    if (!line || line.indent < indent) break;
    if (line.indent !== indent) {
      throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: unexpected indentation at line ${line.lineNumber}.`);
    }
    if (line.content.startsWith("- ")) break;

    const separator = line.content.indexOf(":");
    if (separator <= 0) {
      throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: expected key/value pair at line ${line.lineNumber}.`);
    }

    const key = line.content.slice(0, separator).trim();
    const value = line.content.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: unsupported key "${key}" at line ${line.lineNumber}.`);
    }

    context.index += 1;
    if (value !== "") {
      result[key] = parseScalar(value, line.lineNumber);
      continue;
    }

    const next = context.lines[context.index];
    if (!next || next.indent <= indent) {
      result[key] = {};
    } else if (next.content.startsWith("- ")) {
      result[key] = parseList(context, next.indent);
    } else {
      result[key] = parseMap(context, next.indent);
    }
  }
  return result;
}

function parseConfigYaml(text: string): unknown {
  const lines = prepareLines(text);
  if (lines.length === 0) return {};
  const context: ParseContext = { lines, index: 0 };
  const parsed = parseMap(context, 0);
  if (context.index !== lines.length) {
    const line = lines[context.index];
    throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: unsupported syntax at line ${line?.lineNumber ?? context.index + 1}.`);
  }
  return parsed;
}

function formatZodIssue(issue: z.core.$ZodIssue): string {
  const pathLabel = issue.path.length === 0 ? "config" : issue.path.join(".");
  return `${pathLabel}: ${issue.message}`;
}

function validateConfig(parsed: unknown): PartialConfig {
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const message = result.error.issues.map(formatZodIssue).join("; ");
    throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: ${message}`);
  }

  if (result.data.suggest?.include_full_skill_text === true) {
    throw new ConfigError(
      `Invalid ${CONFIG_FILE_NAME}: suggest.include_full_skill_text true is not supported in this release.`,
    );
  }

  const thresholds = result.data.doctor?.token_thresholds;
  if (
    thresholds?.source_warning !== undefined &&
    thresholds.source_high !== undefined &&
    thresholds.source_warning > thresholds.source_high
  ) {
    throw new ConfigError(
      `Invalid ${CONFIG_FILE_NAME}: doctor.token_thresholds.source_warning must be less than or equal to source_high.`,
    );
  }

  return result.data;
}

type AssignRule<
  TSource extends object,
  TTarget extends object,
  TKey extends keyof TSource & keyof TTarget,
> = readonly [
  TKey,
  ((value: NonNullable<TSource[TKey]>) => TTarget[TKey])?,
];

function assignDefined<
  TSource extends object,
  TTarget extends object,
  TKey extends keyof TSource & keyof TTarget,
>(
  source: TSource | undefined,
  target: TTarget,
  rules: readonly AssignRule<TSource, TTarget, TKey>[],
): void {
  if (source === undefined) return;

  for (const [key, map] of rules) {
    const value = source[key];
    if (value === undefined) continue;
    target[key] = map
      ? map(value as NonNullable<TSource[TKey]>)
      : (value as unknown as TTarget[TKey]);
  }
}

function mergeConfig(partial: PartialConfig): AgentctxConfig {
  const merged = cloneDefaultConfig();

  assignDefined(partial.discovery, merged.discovery, [
    ["include", (value) => [...value]],
    ["exclude", (value) => [...value]],
  ]);

  if (partial.doctor?.token_thresholds !== undefined) {
    assignDefined(partial.doctor.token_thresholds, merged.doctor.token_thresholds, [
      ["source_warning"],
      ["source_high"],
      ["section_warning"],
    ]);
  }
  if (partial.doctor?.fail_on !== undefined) {
    merged.doctor.fail_on = [...partial.doctor.fail_on];
  }
  if (partial.suggest !== undefined) {
    assignDefined(partial.suggest, merged.suggest, [
      ["default_branch"],
      ["max_prompt_tokens"],
      ["max_selected_skills"],
      ["prefer_low_token_skills"],
    ]);
    merged.suggest.include_full_skill_text = false;
  }
  assignDefined(partial.display_limits, merged.display_limits, [
    ["findings"],
    ["selected_guidance"],
    ["excluded_guidance"],
    ["suggest_excluded"],
  ]);

  return merged;
}

export async function loadAgentctxConfig(cwd: string): Promise<AgentctxConfig> {
  let text: string;
  try {
    text = await readFile(path.join(cwd, CONFIG_FILE_NAME), "utf8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return cloneDefaultConfig();
    throw err;
  }

  return mergeConfig(validateConfig(parseConfigYaml(text)));
}
