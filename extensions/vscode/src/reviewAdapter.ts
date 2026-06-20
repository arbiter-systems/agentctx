import {
  reviewPrompt,
  type PromptReviewReport,
  type ReviewProfile,
} from "../../../src/promptReviewCore.js";

export function reviewPromptLocally(text: string, profile: ReviewProfile): PromptReviewReport {
  return reviewPrompt(text, { profile });
}
