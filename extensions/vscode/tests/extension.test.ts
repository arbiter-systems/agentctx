import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN_PROMPT_REVIEW_COMMAND,
  registerPromptReviewCommand,
} from "../src/commandRegistration.js";
import { PromptReviewController } from "../src/promptReviewController.js";
import { reviewPromptLocally } from "../src/reviewAdapter.js";

test("registers the Prompt Review command", () => {
  let command: string | undefined;
  let callback: (() => void) | undefined;
  const disposable = { dispose() {} };
  let opened = false;
  const open = () => { opened = true; };
  registerPromptReviewCommand(
    {
      registerCommand(name, handler) {
        command = name;
        callback = handler;
        return disposable;
      },
    },
    open,
  );
  assert.equal(command, OPEN_PROMPT_REVIEW_COMMAND);
  callback?.();
  assert.equal(opened, true);
});

test("uses the shared review adapter and clears transient content", () => {
  const report = reviewPromptLocally("Repository guidance only.", "coding-task");
  assert.deepEqual(report.findings.map((finding) => finding.code), ["missing-objective", "missing-validation"]);
  const controller = new PromptReviewController();
  controller.review("Build the extension and test it.", "coding-task");
  assert.equal(controller.hasRetainedContent(), true);
  controller.clear();
  assert.equal(controller.hasRetainedContent(), false);
  controller.review("Build the extension and test it.", "coding-task");
  controller.dispose();
  assert.equal(controller.hasRetainedContent(), false);
});
