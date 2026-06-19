import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("package metadata", () => {
  it("routes both CLI aliases through the instv display entrypoint", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(Object.keys(packageJson.bin ?? {})).toEqual(["instv", "instructov"]);
    expect(packageJson.bin?.instv).toBe("./dist/instv.js");
    expect(packageJson.bin?.instructov).toBe("./dist/instv.js");
    expect(packageJson.scripts?.dev).toBe("tsx src/instv.ts");
  });
});
