import * as vscode from "vscode";

import { PromptReviewPanel } from "./promptReviewPanel.js";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("instructov.openPromptReview", () => PromptReviewPanel.open()),
  );
}

export function deactivate(): void {
  PromptReviewPanel.current?.controller.dispose();
}
