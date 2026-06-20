import type { PromptReviewReport, ReviewProfile } from "../../../src/promptReviewCore.js";
import { reviewPromptLocally } from "./reviewAdapter.js";

export class PromptReviewController {
  #prompt: string | undefined;
  #report: PromptReviewReport | undefined;

  review(prompt: string, profile: ReviewProfile): PromptReviewReport {
    this.#prompt = prompt;
    this.#report = reviewPromptLocally(prompt, profile);
    return this.#report;
  }

  clear(): void {
    this.#prompt = undefined;
    this.#report = undefined;
  }

  dispose(): void {
    this.clear();
  }

  hasRetainedContent(): boolean {
    return this.#prompt !== undefined || this.#report !== undefined;
  }
}
