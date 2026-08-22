import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// `@/*` maps to `src/*` only, and the subject here is CI tooling under `scripts/` — see
// test-plan.md §6.1 on why its test still sits in tests/lib/ beside the suite's other
// pure-function files rather than in a tests/scripts/ folder holding one file.
import {
  PROMPT_SOURCES,
  RECORD_PATH,
  REFRESH_COMMAND,
  extractSection,
  hashSection,
  hashSections,
  remedyFor,
} from "../../scripts/prompt-sources.ts";
import type { PromptSourceRecord } from "../../scripts/prompt-sources.ts";

// The ratchet on `agents/review/prompt.ts` — the review agent's distilled copy of rules that
// live in `AGENTS.md` and `test-plan.md` §2. Nothing else links the copy to its sources, so
// without this file the agent goes on reviewing against a rule the repo has already changed,
// and the only symptom is scores that look plausible and are not.
//
// Two halves, and the second is the one that makes the first mean anything:
//
//   1. the recorded digests still match the live sections;
//   2. the extractor those digests come from actually reacts to the CONTENT of a section.
//
// Half 2 is not ceremony. An extractor that returned `""`, or that cut at the wrong boundary,
// would produce digests that are perfectly stable and describe nothing — the gate would be
// green forever, which is the exact class of unfalsifiable check criterion 8 of this very
// review exists to catch. It runs against a fixture this file OWNS and mutates in-place
// (lessons.md, "A positive control must OWN the fixture it mutates"); `vitest.config.ts:50`
// pins `sequence: { shuffle: true }`, so any dependence on a neighbour would surface as a
// flake rather than as a wrong answer.

const record = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as PromptSourceRecord[];

/**
 * A miniature document owned by this file, with the shapes the real sources have: a section
 * with a deeper sub-section under it, and a sibling section after it.
 */
const FIXTURE = [
  "# Fixture Document",
  "",
  "Preamble that belongs to no section.",
  "",
  "## Hard Rules",
  "",
  "- the first rule",
  "- the second rule",
  "",
  "### Exceptions",
  "",
  "- the one documented exception",
  "",
  "## Conventions",
  "",
  "- a convention that lives in a different section",
  "",
].join("\n");

describe("prompt-sources record", () => {
  it("covers exactly the sources the distillate was cut from, in order", () => {
    // Both directions: a source added to `PROMPT_SOURCES` without regenerating leaves the
    // record short, and a hand-edited record leaves it describing something nobody hashes.
    expect(record.map(({ path, heading }) => ({ path, heading }))).toEqual(
      PROMPT_SOURCES.map(({ path, heading }) => ({ path, heading })),
    );
  });

  // One case per source rather than one deep-equal over the array, so a red names the file
  // and section to go read instead of printing three hex strings and leaving the reader to
  // diff them.
  for (const [index, source] of PROMPT_SOURCES.entries()) {
    it(`still matches ${source.path} §${source.heading}`, () => {
      const live = hashSections([source])[0];
      const recorded = record[index];

      expect(live?.sha256, remedyFor(source)).toBe(recorded?.sha256);
    });
  }

  it("names the refresh command in every remedy, so the red is actionable", () => {
    for (const source of PROMPT_SOURCES) {
      const remedy = remedyFor(source);

      expect(remedy).toContain(source.path);
      expect(remedy).toContain(source.heading);
      expect(remedy).toContain("agents/review/prompt.ts");
      expect(remedy).toContain(REFRESH_COMMAND);
    }
  });
});

describe("extractSection", () => {
  // THE positive control. Without it every assertion above would stay green against an
  // extractor that returned a constant.
  it("gives a different digest when a line INSIDE the section changes", () => {
    const before = hashSection(extractSection(FIXTURE, "## Hard Rules"));
    const mutated = FIXTURE.replace("- the second rule", "- the second rule, amended");

    expect(mutated).not.toBe(FIXTURE);
    expect(hashSection(extractSection(mutated, "## Hard Rules"))).not.toBe(before);
  });

  // The other half of that control, and the reason this gate hashes sections rather than
  // files: an edit outside the section must NOT red it. `test-plan.md` is ~6.7k lines, and a
  // gate that goes red on a typo anywhere in it is one everybody regenerates without reading.
  it("gives the same digest when a line OUTSIDE the section changes", () => {
    const before = hashSection(extractSection(FIXTURE, "## Hard Rules"));
    const mutated = FIXTURE.replace("- a convention that lives", "- a convention that no longer lives");

    expect(mutated).not.toBe(FIXTURE);
    expect(hashSection(extractSection(mutated, "## Hard Rules"))).toBe(before);
  });

  it("keeps the heading line, so renaming a section reds the gate", () => {
    const section = extractSection(FIXTURE, "## Hard Rules");

    expect(section.split("\n")[0]).toBe("## Hard Rules");
  });

  it("owns its sub-sections and stops at the next sibling heading", () => {
    const section = extractSection(FIXTURE, "## Hard Rules");

    // `### Risk Response Guidance` is inside `## 2. Risk Map` in the real source, and it
    // carries the "What would prove protection" column the distillate's RISK_MAP block speaks
    // for — dropping it would leave the gate blind to the half that matters most.
    expect(section).toContain("### Exceptions");
    expect(section).toContain("- the one documented exception");
    expect(section).not.toContain("## Conventions");
    expect(section).not.toContain("Preamble");
  });

  it("does not let a comment inside a fenced block end the section early", () => {
    const fenced = [
      "## Hard Rules",
      "",
      "```sh",
      "# this is a shell comment, not a heading",
      "```",
      "",
      "- the rule",
    ].join("\n");

    // A section truncated at the fence would still hash to something perfectly stable, so the
    // gate would go on being green while it had quietly stopped watching the tail.
    expect(extractSection(fenced, "## Hard Rules")).toContain("- the rule");
  });

  // A miss must throw, never return `""`: an empty section has a stable digest, so the record
  // would freeze agreement with nothing at all and never mention it again.
  it("refuses a heading that is not there", () => {
    expect(() => extractSection(FIXTURE, "## Missing Section")).toThrow(/nie występuje/);
  });

  it("refuses a heading that appears more than once", () => {
    expect(() => extractSection(`${FIXTURE}\n## Hard Rules\n\n- a second one\n`, "## Hard Rules")).toThrow(/2 razy/);
  });

  it("refuses a heading string that is not a Markdown heading", () => {
    expect(() => extractSection(FIXTURE, "Hard Rules")).toThrow(/nie jest nagłówkiem/);
  });
});
