import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "package");
const output = path.join(outputDirectory, "instructov-vscode.vsix");
await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

// Use the locally installed vsce binary so packaging is deterministic and does
// not depend on a network fetch. The build is bundled, so dependencies are
// excluded from the VSIX.
const binary = process.platform === "win32" ? "vsce.cmd" : "vsce";
const executable = path.join(root, "node_modules", ".bin", binary);
const result = await new Promise((resolve, reject) => {
  const child = spawn(executable, ["package", "--no-dependencies", "--out", output], {
    cwd: root,
    stdio: "inherit",
  });
  child.on("error", reject);
  child.on("exit", (code) => resolve(code));
});
if (result !== 0) throw new Error(`VSIX packaging failed with exit code ${result}.`);
await access(output);
console.log(`Created ${output}`);
