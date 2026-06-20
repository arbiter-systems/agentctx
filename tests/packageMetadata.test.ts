import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("package metadata", () => {
  it("routes the instv CLI alias through the instv display entrypoint", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(Object.keys(packageJson.bin ?? {})).toEqual(["instv"]);
    expect(packageJson.bin?.instv).toBe("./dist/instv.js");
    expect(packageJson.scripts?.dev).toBe("tsx src/instv.ts");
  });
});
