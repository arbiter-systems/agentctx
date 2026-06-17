import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { discoverInstructionSources } from "../src/discovery.js";

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/discovery",
);

describe("discoverInstructionSources", () => {
  it("detects root-level instruction files", async () => {
    await expect(
      discoverInstructionSources(path.join(fixturesRoot, "root")),
    ).resolves.toEqual([
      { path: "AGENTS.md", kind: "agents", scopePath: "." },
      { path: "CLAUDE.md", kind: "claude", scopePath: "." },
      { path: "GEMINI.md", kind: "gemini", scopePath: "." },
    ]);
  });

  it("detects GitHub Copilot instructions", async () => {
    await expect(
      discoverInstructionSources(path.join(fixturesRoot, "copilot")),
    ).resolves.toEqual([
      { path: ".github/copilot-instructions.md", kind: "copilot", scopePath: "." },
    ]);
  });

  it("detects nested SKILL.md files with directory scope", async () => {
    await expect(
      discoverInstructionSources(path.join(fixturesRoot, "skills")),
    ).resolves.toEqual([
      { path: "tools/review/SKILL.md", kind: "skill", scopePath: "tools/review" },
    ]);
  });

  it("excludes ignored directories when discovering SKILL.md files", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "agentctx-discovery-"));
    const excludedDirectories = [
      ".git",
      "node_modules",
      "dist",
      "build",
      "coverage",
      "vendor",
      ".venv",
      "bin",
      "obj",
    ];

    try {
      await mkdir(path.join(fixture, "allowed"), { recursive: true });
      await writeFile(path.join(fixture, "allowed", "SKILL.md"), "# Allowed Skill\n");

      for (const directory of excludedDirectories) {
        const nestedDirectory = path.join(fixture, "nested", directory);
        await mkdir(nestedDirectory, { recursive: true });
        await writeFile(
          path.join(nestedDirectory, "SKILL.md"),
          `# Ignored ${directory} Skill\n`,
        );
      }

      await expect(discoverInstructionSources(fixture)).resolves.toEqual([
        { path: "allowed/SKILL.md", kind: "skill", scopePath: "allowed" },
      ]);
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });

  it("keeps the committed excluded-directory fixture scoped to allowed sources", async () => {
    await expect(
      discoverInstructionSources(path.join(fixturesRoot, "excluded")),
    ).resolves.toEqual([
      { path: "allowed/SKILL.md", kind: "skill", scopePath: "allowed" },
    ]);
  });

  it("respects configured include and exclude patterns", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "agentctx-discovery-config-"));

    try {
      await mkdir(path.join(fixture, "included"), { recursive: true });
      await mkdir(path.join(fixture, "ignored"), { recursive: true });
      await writeFile(path.join(fixture, "AGENTS.md"), "# Root\n");
      await writeFile(path.join(fixture, "included", "SKILL.md"), "# Included\n");
      await writeFile(path.join(fixture, "ignored", "SKILL.md"), "# Ignored\n");

      await expect(
        discoverInstructionSources(fixture, {
          include: ["**/SKILL.md"],
          exclude: ["ignored/**"],
        }),
      ).resolves.toEqual([
        { path: "included/SKILL.md", kind: "skill", scopePath: "included" },
      ]);
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });
});
