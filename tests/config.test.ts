import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ConfigError,
  DEFAULT_AGENTCTX_CONFIG,
  loadAgentctxConfig,
} from "../src/config.js";

async function withConfigFixture<T>(
  configText: string | null,
  run: (fixtureRoot: string) => Promise<T>,
): Promise<T> {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "agentctx-config-"));
  try {
    if (configText !== null) {
      await writeFile(path.join(fixtureRoot, "agentctx.yml"), configText);
    }
    return await run(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

describe("loadAgentctxConfig", () => {
  it("returns defaults when config is missing", async () => {
    await withConfigFixture(null, async (fixtureRoot) => {
      await expect(loadAgentctxConfig(fixtureRoot)).resolves.toEqual(
        DEFAULT_AGENTCTX_CONFIG,
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
        const config = await loadAgentctxConfig(fixtureRoot);
        expect(config.doctor.token_thresholds).toEqual({
          ...DEFAULT_AGENTCTX_CONFIG.doctor.token_thresholds,
          source_warning: 100,
        });
        expect(config.suggest.max_selected_skills).toBe(2);
        expect(config.suggest.max_prompt_tokens).toBe(
          DEFAULT_AGENTCTX_CONFIG.suggest.max_prompt_tokens,
        );
        expect(config.display_limits).toEqual({
          ...DEFAULT_AGENTCTX_CONFIG.display_limits,
          excluded_guidance: 2,
        });
      },
    );
  });

  it("rejects invalid version", async () => {
    await withConfigFixture("version: v1\n", async (fixtureRoot) => {
      await expect(loadAgentctxConfig(fixtureRoot)).rejects.toThrow(ConfigError);
      await expect(loadAgentctxConfig(fixtureRoot)).rejects.toThrow("version");
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
        await expect(loadAgentctxConfig(fixtureRoot)).rejects.toThrow(
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
        await expect(loadAgentctxConfig(fixtureRoot)).rejects.toThrow("fail_on");
      },
    );
  });

  it("defaults include_full_skill_text to false", async () => {
    await withConfigFixture("version: v0alpha1\n", async (fixtureRoot) => {
      const config = await loadAgentctxConfig(fixtureRoot);
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
        await expect(loadAgentctxConfig(fixtureRoot)).rejects.toThrow(
          "include_full_skill_text",
        );
      },
    );
  });
});
