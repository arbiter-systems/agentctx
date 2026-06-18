import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("package metadata", () => {
  it("exposes instv as the primary CLI alias while preserving instructov", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      bin?: Record<string, string>;
    };

    expect(Object.keys(packageJson.bin ?? {})).toEqual(["instv", "instructov"]);
    expect(packageJson.bin?.instv).toBe("./dist/cli.js");
    expect(packageJson.bin?.instructov).toBe("./dist/cli.js");
  });
});
