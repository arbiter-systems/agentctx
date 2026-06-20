import {
  reviewPrompt,
  type PromptReviewReport,
  type ReviewProfile,
} from "./generated/promptReviewCore.js";

export function reviewPromptLocally(text: string, profile: ReviewProfile): PromptReviewReport {
  return reviewPrompt(text, { profile });
}
