import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "package");
await rm(output, { force: true, recursive: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, "dist"), path.join(output, "dist"), { recursive: true });
await cp(path.join(root, "package.json"), path.join(output, "package.json"));
await cp(path.join(root, "README.md"), path.join(output, "README.md"));
await writeFile(path.join(output, "PACKAGE.md"), "This staged artifact contains the compiled extension and the generated shared prompt-review core.\n");
