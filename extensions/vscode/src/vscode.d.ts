declare module "vscode" {
  export type Disposable = { dispose(): void };
  export type ExtensionContext = { subscriptions: Disposable[] };
  export enum ViewColumn { One = 1 }
  export type Webview = { html: string; postMessage(message: unknown): PromiseLike<boolean>; onDidReceiveMessage(listener: (message: unknown) => void): Disposable };
  export type WebviewPanel = { webview: Webview; reveal(column?: ViewColumn): void; onDidDispose(listener: () => void): Disposable };
  export const commands: { registerCommand(command: string, callback: () => void): Disposable };
  export const window: { createWebviewPanel(viewType: string, title: string, column: ViewColumn, options: { enableScripts: boolean; retainContextWhenHidden: boolean }): WebviewPanel };
}
