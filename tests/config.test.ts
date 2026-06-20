import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ConfigError,
  DEFAULT_instructov_CONFIG,
  loadinstructovConfig,
} from "../src/config.js";

async function withConfigFixture<T>(
  configText: string | null,
  run: (fixtureRoot: string) => Promise<T>,
): Promise<T> {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "instructov-config-"));
  try {
    if (configText !== null) {
      await writeFile(path.join(fixtureRoot, "instructov.yml"), configText);
    }
    return await run(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

describe("loadinstructovConfig", () => {
  it("returns defaults when config is missing", async () => {
    await withConfigFixture(null, async (fixtureRoot) => {
      await expect(loadinstructovConfig(fixtureRoot)).resolves.toEqual(
        DEFAULT_instructov_CONFIG,
      );
    });
  });

  it("parses valid config and deep-merges with defaults", async () => {
    await withConfigFixture(
      [
        "version: v0alpha1",
        "doctor:",
        "  token_thresholds:",
        "    source_warning: 100",
        "suggest:",
        "  max_selected_skills: 2",
        "display_limits:",
        "  excluded_guidance: 2",
        "",
      ].join("\n"),
      async (fixtureRoot) => {
        const config = await loadinstructovConfig(fixtureRoot);
        expect(config.doctor.token_thresholds).toEqual({
          ...DEFAULT_instructov_CONFIG.doctor.token_thresholds,
          source_warning: 100,
        });
        expect(config.suggest.max_selected_skills).toBe(2);
        expect(config.suggest.max_prompt_tokens).toBe(
          DEFAULT_instructov_CONFIG.suggest.max_prompt_tokens,
        );
        expect(config.display_limits).toEqual({
          ...DEFAULT_instructov_CONFIG.display_limits,
          excluded_guidance: 2,
        });
      },
    );
  });

  it("rejects invalid version", async () => {
    await withConfigFixture("version: v1\n", async (fixtureRoot) => {
      await expect(loadinstructovConfig(fixtureRoot)).rejects.toThrow(ConfigError);
      await expect(loadinstructovConfig(fixtureRoot)).rejects.toThrow("version");
    });
  });

  it("rejects invalid threshold", async () => {
    await withConfigFixture(
      [
        "version: v0alpha1",
        "doctor:",
        "  token_thresholds:",
        "    source_warning: 0",
        "",
      ].join("\n"),
      async (fixtureRoot) => {
        await expect(loadinstructovConfig(fixtureRoot)).rejects.toThrow(
          "source_warning",
        );
      },
    );
  });

  it("rejects unknown fail_on finding code", async () => {
    await withConfigFixture(
      [
        "version: v0alpha1",
        "doctor:",
        "  fail_on:",
        "    - not-a-finding",
        "",
      ].join("\n"),
      async (fixtureRoot) => {
        await expect(loadinstructovConfig(fixtureRoot)).rejects.toThrow("fail_on");
      },
    );
  });

  it("defaults include_full_skill_text to false", async () => {
    await withConfigFixture("version: v0alpha1\n", async (fixtureRoot) => {
      const config = await loadinstructovConfig(fixtureRoot);
      expect(config.suggest.include_full_skill_text).toBe(false);
    });
  });

  it("rejects include_full_skill_text true", async () => {
    await withConfigFixture(
      [
        "version: v0alpha1",
        "suggest:",
        "  include_full_skill_text: true",
        "",
      ].join("\n"),
      async (fixtureRoot) => {
        await expect(loadinstructovConfig(fixtureRoot)).rejects.toThrow(
          "include_full_skill_text",
        );
      },
    );
  });

  it("rejects integers that exceed the safe integer range", async () => {
    await withConfigFixture(
      [
        "version: v0alpha1",
        "doctor:",
        "  token_thresholds:",
        "    source_warning: 99999999999999999999",
        "",
      ].join("\n"),
      async (fixtureRoot) => {
        await expect(loadinstructovConfig(fixtureRoot)).rejects.toThrow(ConfigError);
        await expect(loadinstructovConfig(fixtureRoot)).rejects.toThrow("out of range");
      },
    );
  });

  it("rejects tabs in instructov.yml", async () => {
    await withConfigFixture("version: v0alpha1\n\tdoctor:\n", async (fixtureRoot) => {
      await expect(loadinstructovConfig(fixtureRoot)).rejects.toThrow("tabs are not supported");
    });
  });

  it("rejects odd indentation in instructov.yml", async () => {
    await withConfigFixture(
      ["version: v0alpha1", "doctor:", "   fail_on:", "    - conflicting-branch-target", ""].join(
        "\n",
      ),
      async (fixtureRoot) => {
        await expect(loadinstructovConfig(fixtureRoot)).rejects.toThrow(
          "indentation must use two spaces",
        );
      },
    );
  });

  it("treats a leading-zero numeric-looking value as a string rather than silently reinterpreting it", async () => {
    await withConfigFixture(
      [
        "version: v0alpha1",
        "suggest:",
        "  default_branch: 0123",
        "",
      ].join("\n"),
      async (fixtureRoot) => {
        const config = await loadinstructovConfig(fixtureRoot);
        expect(config.suggest.default_branch).toBe("0123");
      },
    );
  });
});
