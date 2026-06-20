import * as vscode from "vscode";

import { REVIEW_PROFILES, type ReviewProfile } from "./generated/promptReviewCore.js";
import { PromptReviewController } from "./promptReviewController.js";

export class PromptReviewPanel {
  static current: PromptReviewPanel | undefined;
  readonly controller = new PromptReviewController();
  readonly panel: vscode.WebviewPanel;

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    panel.webview.html = renderHtml();
    panel.onDidDispose(() => {
      this.controller.dispose();
      PromptReviewPanel.current = undefined;
    });
    panel.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message));
  }

  static open(): void {
    if (PromptReviewPanel.current !== undefined) {
      PromptReviewPanel.current.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "instructov.promptReview",
      "Instructov: Prompt Review",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: false },
    );
    PromptReviewPanel.current = new PromptReviewPanel(panel);
  }

  private handleMessage(message: unknown): void {
    if (typeof message !== "object" || message === null) return;
    const payload = message as { type?: unknown; prompt?: unknown; profile?: unknown };
    if (payload.type === "clear") {
      this.controller.clear();
      void this.panel.webview.postMessage({ type: "cleared" });
      return;
    }
    if (payload.type !== "review" || typeof payload.prompt !== "string" || typeof payload.profile !== "string") return;
    if (!REVIEW_PROFILES.includes(payload.profile as ReviewProfile)) return;
    const report = this.controller.review(payload.prompt, payload.profile as ReviewProfile);
    void this.panel.webview.postMessage({ type: "report", report });
  }
}

function renderHtml(): string {
  const nonce = Math.random().toString(36).slice(2);
  const profileOptions = REVIEW_PROFILES.map((profile) => `<option value="${profile}">${profile}</option>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);padding:16px}textarea,select{width:100%;box-sizing:border-box;margin:8px 0}textarea{min-height:180px}button{margin-right:8px}pre{white-space:pre-wrap}</style></head><body><h1>Prompt Review</h1><label>Profile<select id="profile">${profileOptions}</select></label><label>Prompt<textarea id="prompt" spellcheck="false"></textarea></label><button id="review">Review Prompt</button><button id="clear">Clear</button><pre id="result" aria-live="polite"></pre><script nonce="${nonce}">const vscode=acquireVsCodeApi();const prompt=document.getElementById('prompt');const profile=document.getElementById('profile');const result=document.getElementById('result');document.getElementById('review').addEventListener('click',()=>vscode.postMessage({type:'review',prompt:prompt.value,profile:profile.value}));document.getElementById('clear').addEventListener('click',()=>vscode.postMessage({type:'clear'}));window.addEventListener('message',event=>{const m=event.data;if(m.type==='cleared'){prompt.value='';result.textContent='';}if(m.type==='report'){const r=m.report;result.textContent='Estimated prompt size: ~'+r.estimatedTokens+' tokens.\n\n'+(r.findings.length?r.findings.map(f=>'['+f.severity+'] '+f.message+(f.lineStart?' (line '+f.lineStart+')':'')+(f.verdict?'\n  '+f.verdict:'')).join('\n'):'No high-confidence findings.');}});</script></body></html>`;
}
