# Instructov VS Code extension

This isolated local extension exposes **Instructov: Open Prompt Review**. It reviews only text explicitly pasted into its panel using the shared deterministic prompt-review core.

## Development

From this directory:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run package
```

Launch this folder in VS Code and use **Run Extension**. In the Extension Development Host, run **Instructov: Open Prompt Review**, paste a multiline prompt, choose a profile, select **Review Prompt**, then select **Clear**.

The panel has no network path, telemetry, prompt persistence, webview state restoration, clipboard access, or AI-provider integration.
