import { Command } from "commander";

import { PRIMARY_COMMAND_NAME } from "./formatting.js";
import {
  formatReviewText,
  isReviewProfile,
  REVIEW_PROFILES,
  reviewPrompt,
  type PromptReviewReport,
  type ReviewFinding,
  type ReviewFindingCode,
  type ReviewProfile,
  type ReviewPromptOptions,
  type ReviewSeverity,
} from "./promptReviewCore.js";

export {
  formatReviewText,
  REVIEW_PROFILES,
  reviewPrompt,
  type PromptReviewReport,
  type ReviewFinding,
  type ReviewFindingCode,
  type ReviewProfile,
  type ReviewPromptOptions,
  type ReviewSeverity,
};

type ReviewCommandOptions = {
  stdin?: boolean;
  json?: boolean;
  profile?: string;
};

async function readPromptFromStdin(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

function writeReviewInputError(message: string): void {
  process.exitCode = 2;
  console.error(message);
}

export function addReviewCommand(program: Command): void {
  program
    .command("review")
    .description("Review prompt text from stdin using deterministic checks.")
    .argument("[prompt...]", "Prompt text is not accepted as a positional argument")
    .option("--stdin", "Read prompt text from stdin")
    .option("--json", "Output JSON")
    .option("--profile <profile>", "Review profile: coding-task, code-review, planning, or general", "general")
    .action(async (promptArguments: string[], options: ReviewCommandOptions) => {
      if (promptArguments.length > 0 || options.stdin !== true) {
        writeReviewInputError("Prompt text must be supplied through stdin. Use: instv review --stdin");
        return;
      }
      const profile = options.profile ?? "general";
      if (!isReviewProfile(profile)) {
        writeReviewInputError(`Invalid review profile: ${profile}. Choose one of: ${REVIEW_PROFILES.join(", ")}.`);
        return;
      }
      const report = reviewPrompt(await readPromptFromStdin(), { profile });
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      for (const line of formatReviewText(report, PRIMARY_COMMAND_NAME)) console.log(line);
    });
}
