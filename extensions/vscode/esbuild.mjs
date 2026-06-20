import path from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const root = path.dirname(fileURLToPath(import.meta.url));

// Bundle the extension entry together with the shared prompt-review core that is
// imported by relative path from the repository `src/`. esbuild inlines the core
// into a single self-contained CommonJS module. `vscode` is provided by the
// extension host at runtime and must stay external.
await esbuild.build({
  entryPoints: [path.join(root, "src/extension.ts")],
  outfile: path.join(root, "dist/extension.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: false,
  minify: false,
  logLevel: "info",
});
