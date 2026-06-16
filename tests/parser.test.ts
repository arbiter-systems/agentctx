import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi, afterEach } from "vitest";

import { parseSections, extractCommands, normalizeText } from "../src/parser.js";
import { buildDoctorReport, createProgram } from "../src/cli.js";

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/parser",
);

async function fixture(name: string): Promise<string> {
  return readFile(path.join(fixturesRoot, name), "utf8");
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── parseSections ───────────────────────────────────────────────────────────

describe("parseSections", () => {
  it("splits on ATX headings and preserves 1-based line ranges", async () => {
    const text = await fixture("headings.md");
    const sections = parseSections("headings.md", text);

    expect(sections).toHaveLength(3);

    expect(sections[0]).toMatchObject({
      sourcePath: "headings.md",
      heading: "Installation",
      lineStart: 1,
      lineEnd: 7,
    });
    expect(sections[1]).toMatchObject({
      heading: "Usage",
      lineStart: 8,
      lineEnd: 11,
    });
    expect(sections[2]).toMatchObject({
      heading: "Advanced",
      lineStart: 12,
    });
  });

  it("strips optional ATX closing hash sequences from heading names", () => {
    const sections = parseSections("closing-hashes.md", "## My Section ##\nRun `npm test`.\n");

    expect(sections[0]?.heading).toBe("My Section");
  });

  it("produces a single (root) section for files without headings", async () => {
    const text = await fixture("no-headings.md");
    const sections = parseSections("no-headings.md", text);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      sourcePath: "no-headings.md",
      heading: "(root)",
      lineStart: 1,
    });
    expect(sections[0]?.text).toContain("no headings");
  });

  it("returns empty array for an empty file", async () => {
    const text = await fixture("empty.md");
    expect(parseSections("empty.md", text)).toEqual([]);
  });

  it("returns empty array for whitespace-only text", () => {
    expect(parseSections("ws.md", "   \n\n  \n")).toEqual([]);
  });

  it("populates normalizedText, estimatedTokens on each section", async () => {
    const text = await fixture("no-headings.md");
    const [section] = parseSections("no-headings.md", text);

    expect(section?.normalizedText).toBe(section?.text.toLowerCase().replace(/\s+/g, " ").trim());
    expect(section?.estimatedTokens).toBeGreaterThan(0);
  });
});

// ─── extractCommands ─────────────────────────────────────────────────────────

describe("extractCommands", () => {
  it("extracts fenced code blocks with correct line ranges", async () => {
    const text = await fixture("fenced-commands.md");
    const sections = parseSections("fenced-commands.md", text);
    const commands = extractCommands("fenced-commands.md", text, sections);

    const fenced = commands.filter((c) => c.kind === "fenced");
    expect(fenced.length).toBeGreaterThanOrEqual(2);

    const first = fenced[0];
    expect(first).toMatchObject({
      sourcePath: "fenced-commands.md",
      kind: "fenced",
      commandText: "npm install\npnpm run build",
    });
  });

  it("ignores empty fenced blocks", async () => {
    const text = await fixture("fenced-commands.md");
    const sections = parseSections("fenced-commands.md", text);
    const commands = extractCommands("fenced-commands.md", text, sections);

    const fenced = commands.filter((c) => c.kind === "fenced");
    // Only non-empty fenced blocks should be emitted
    for (const cmd of fenced) {
      expect(cmd.commandText.trim()).not.toBe("");
    }
  });

  it("associates fenced commands with the containing section heading", async () => {
    const text = await fixture("fenced-commands.md");
    const sections = parseSections("fenced-commands.md", text);
    const commands = extractCommands("fenced-commands.md", text, sections);

    const fenced = commands.filter((c) => c.kind === "fenced");
    expect(fenced[0]?.sectionHeading).toBe("Setup");
    expect(fenced[1]?.sectionHeading).toBe("Run");
  });

  it("extracts inline commands for known prefixes", async () => {
    const text = await fixture("inline-commands.md");
    const sections = parseSections("inline-commands.md", text);
    const commands = extractCommands("inline-commands.md", text, sections);

    const inline = commands.filter((c) => c.kind === "inline");
    expect(inline.length).toBeGreaterThanOrEqual(3);

    const texts = inline.map((c) => c.commandText);
    expect(texts).toContain("npm install");
    expect(texts).toContain('git commit -m "message"');
    expect(texts).toContain("npm start");
  });

  it("associates inline commands with the containing section heading", async () => {
    const text = await fixture("inline-commands.md");
    const sections = parseSections("inline-commands.md", text);
    const commands = extractCommands("inline-commands.md", text, sections);

    for (const cmd of commands.filter((c) => c.kind === "inline")) {
      expect(cmd.sectionHeading).toBe("Commands");
    }
  });

  it("sectionHeading is undefined for commands in the root section", () => {
    const text = "Run `npm install` to set up.\n";
    const sections = parseSections("test.md", text);
    const commands = extractCommands("test.md", text, sections);

    expect(commands[0]?.sectionHeading).toBeUndefined();
  });

  it("does not extract inline commands from inside fenced blocks", async () => {
    const fencedWithInlinePrefix = "# X\n\n```\nnpm install\n```\n";
    const sections = parseSections("x.md", fencedWithInlinePrefix);
    const commands = extractCommands("x.md", fencedWithInlinePrefix, sections);

    // The "npm install" inside a fence should not produce an inline command
    expect(commands.filter((c) => c.kind === "inline")).toHaveLength(0);
    expect(commands.filter((c) => c.kind === "fenced")).toHaveLength(1);
  });

  it("does not close a fence on a longer backtick line with an info string", () => {
    const text = [
      "# Fences",
      "```",
      "npm install",
      "````bash",
      "npm test",
      "```",
      "",
    ].join("\n");
    const sections = parseSections("nested-fence-doc.md", text);
    const commands = extractCommands("nested-fence-doc.md", text, sections);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      kind: "fenced",
      commandText: "npm install\n````bash\nnpm test",
      lineStart: 2,
      lineEnd: 6,
    });
  });

  it("emits a fenced command when the file ends before the closing fence", () => {
    const text = "# Broken\n\n```\nnpm run build\n";
    const sections = parseSections("unclosed.md", text);
    const commands = extractCommands("unclosed.md", text, sections);

    expect(commands).toEqual([
      {
        sourcePath: "unclosed.md",
        commandText: "npm run build\n",
        lineStart: 3,
        lineEnd: 5,
        sectionHeading: "Broken",
        kind: "fenced",
      },
    ]);
  });

  it("returns empty array for empty file", () => {
    const sections = parseSections("empty.md", "");
    const commands = extractCommands("empty.md", "", sections);
    expect(commands).toEqual([]);
  });
});

// ─── normalizeText ────────────────────────────────────────────────────────────

describe("normalizeText", () => {
  it("lowercases text", () => {
    expect(normalizeText("Hello World")).toBe("hello world");
  });

  it("collapses whitespace", () => {
    expect(normalizeText("foo   bar\nbaz")).toBe("foo bar baz");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  it("removes unordered list markers", () => {
    expect(normalizeText("- item one\n* item two\n+ item three")).toBe(
      "item one item two item three",
    );
  });

  it("removes ordered list markers", () => {
    expect(normalizeText("1. first\n2. second")).toBe("first second");
  });
});

// ─── CLI --details integration ────────────────────────────────────────────────

describe("buildDoctorReport with details", () => {
  it("includes sections and commands in details when details=true", async () => {
    const report = await buildDoctorReport(process.cwd(), { details: true });

    expect(report.details).toBeDefined();
    expect(Array.isArray(report.details?.sections)).toBe(true);
    expect(Array.isArray(report.details?.commands)).toBe(true);
    expect(report.summary.sectionCount).toBeGreaterThanOrEqual(0);
    expect(report.summary.commandCount).toBeGreaterThanOrEqual(0);
  });

  it("does not include details when details is not requested", async () => {
    const report = await buildDoctorReport(process.cwd());

    expect(report.details).toBeUndefined();
    expect(report.summary.sectionCount).toBeUndefined();
    expect(report.summary.commandCount).toBeUndefined();
  });
});

describe("doctor --json --details command", () => {
  it("includes details in JSON output when --details is passed", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await createProgram().parseAsync([
      "node",
      "agentctx",
      "doctor",
      "--json",
      "--details",
    ]);

    expect(log).toHaveBeenCalledOnce();
    const output = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(output.details).toBeDefined();
    expect(Array.isArray(output.details.sections)).toBe(true);
    expect(Array.isArray(output.details.commands)).toBe(true);
    expect(output.summary.sectionCount).toBeGreaterThanOrEqual(0);
    expect(output.summary.commandCount).toBeGreaterThanOrEqual(0);
  });

  it("omits details from JSON output without --details", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await createProgram().parseAsync(["node", "agentctx", "doctor", "--json"]);

    expect(log).toHaveBeenCalledOnce();
    const output = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(output.details).toBeUndefined();
  });
});
