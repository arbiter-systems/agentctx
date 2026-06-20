import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "package");
const output = path.join(outputDirectory, "instructov-vscode.vsix");
await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const result = await new Promise((resolve, reject) => {
  const child = spawn(executable, ["--yes", "@vscode/vsce", "package", "--no-dependencies", "--out", output], {
    cwd: root,
    stdio: "inherit",
  });
  child.on("error", reject);
  child.on("exit", (code) => resolve(code));
});
if (result !== 0) throw new Error(`VSIX packaging failed with exit code ${result}.`);
await access(output);
console.log(`Created ${output}`);
