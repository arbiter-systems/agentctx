import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(directory, "..");
const sourceRoot = path.resolve(extensionRoot, "../../src");
const generatedRoot = path.join(extensionRoot, "src/generated");

await rm(generatedRoot, { force: true, recursive: true });
await mkdir(generatedRoot, { recursive: true });
for (const file of ["promptReviewCore.ts", "tokenEstimate.ts"]) {
  await cp(path.join(sourceRoot, file), path.join(generatedRoot, file));
}
