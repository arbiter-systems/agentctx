# Instructov VS Code extension

This isolated local extension exposes **Instructov: Open Prompt Review**. It reviews only text explicitly pasted into its panel using the shared deterministic prompt-review core.

## Architecture

The extension is self-contained but does not duplicate logic. The deterministic
review core lives once in the repository `src/promptReviewCore.ts` and is
imported here by relative path. The build bundles the extension entry and that
core into a single `dist/extension.cjs` with [esbuild](https://esbuild.github.io/);
`vscode` is the only runtime external and is provided by the extension host. The
packaged VSIX therefore contains the review core without depending on a globally
installed `instv` executable, the root build, or any copy step.

This extension has its own toolchain (`typescript`, `@types/vscode`, `esbuild`,
`tsx`, `@vscode/vsce`) and is installed and validated independently of the root
package.

## Development

From this directory:

```bash
npm ci
npm run typecheck   # tsc --noEmit type gate (covers src and tests)
npm test            # node --test against the TypeScript source via tsx
npm run build       # esbuild bundle -> dist/extension.cjs
npm run package     # @vscode/vsce -> package/instructov-vscode.vsix
```

Launch this folder in VS Code and use **Run Extension**. In the Extension Development Host, run **Instructov: Open Prompt Review**, paste a multiline prompt, choose a profile, select **Review Prompt**, then select **Clear**.

The panel has no network path, telemetry, prompt persistence, webview state restoration, clipboard access, or AI-provider integration.
