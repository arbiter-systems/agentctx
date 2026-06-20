import * as vscode from "vscode";

import { registerPromptReviewCommand } from "./commandRegistration.js";
import { PromptReviewPanel } from "./promptReviewPanel.js";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerPromptReviewCommand(vscode.commands, () => PromptReviewPanel.open()),
  );
}

export function deactivate(): void {
  PromptReviewPanel.current?.controller.dispose();
}
