import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN_PROMPT_REVIEW_COMMAND,
  registerPromptReviewCommand,
} from "../dist/commandRegistration.js";

test("registers the Prompt Review command", () => {
  let command;
  let callback;
  const disposable = { dispose() {} };
  registerPromptReviewCommand({ registerCommand(name, handler) { command = name; callback = handler; return disposable; } }, () => { callback.called = true; });
  assert.equal(command, OPEN_PROMPT_REVIEW_COMMAND);
  callback();
  assert.equal(callback.called, true);
});
