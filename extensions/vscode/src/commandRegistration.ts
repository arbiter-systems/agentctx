export const OPEN_PROMPT_REVIEW_COMMAND = "instructov.openPromptReview";

export type CommandRegistrar = {
  registerCommand(command: string, callback: () => void): { dispose(): void };
};

export function registerPromptReviewCommand(
  commands: CommandRegistrar,
  openPanel: () => void,
): { dispose(): void } {
  return commands.registerCommand(OPEN_PROMPT_REVIEW_COMMAND, openPanel);
}
