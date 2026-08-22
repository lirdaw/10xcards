import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The contract of `agents/review/criteria.json` — the generated DATA file `scripts/` reads to
// render the PR comment. Read off disk rather than imported, and that is the whole point:
// `agents/**` sits outside this project's tsconfig, ESLint and vitest deliberately (commit
// e1ed7e5), and importing the agent's module here would erase that boundary for the sake of a
// test. What crosses is JSON.
//
// What this file defends is the pair, not the file: the list exists ONCE, in
// `agents/review/review-schema.ts`, and this JSON is generated from it
// (`npm --prefix agents/review run criteria`, gate `git diff --exit-code` in the composite
// action). This test is the second half — it pins what the CONSUMER depends on: nine entries,
// in a known order, with exactly two conditional ones.

const CRITERIA_PATH = new URL("../../agents/review/criteria.json", import.meta.url);

/**
 * The nine criteria in the order the requirements number them. Written out here rather than
 * derived from the file, because a test that derives its expectation from its subject asserts
 * nothing — it would stay green through a criterion being dropped, renamed or reordered.
 */
const EXPECTED_KEYS = [
  "implementationCorrectness",
  "idiomaticity",
  "complexity",
  "testRiskCoverage",
  "documentationRationale",
  "securitySafety",
  "swallowedError",
  "gateIntegrity",
  "scopeDiscipline",
];

/** The two criteria that may answer `null` ("does not apply") — criteria 7 and 8. */
const EXPECTED_CONDITIONAL = ["swallowedError", "gateIntegrity"];

interface CriterionEntry {
  key: string;
  noteKey: string;
  label: string;
  conditional: boolean;
}

const criteria = JSON.parse(readFileSync(CRITERIA_PATH, "utf8")) as CriterionEntry[];

describe("criteria.json", () => {
  it("carries exactly the nine criteria, in the order the requirements number them", () => {
    expect(criteria.map((criterion) => criterion.key)).toEqual(EXPECTED_KEYS);
  });

  // Order is not cosmetic: it is the order the comment table renders, and the reader maps a
  // row back to a numbered criterion in the requirements by position.
  it("marks exactly two criteria as conditional, and they are 7 and 8", () => {
    const conditional = criteria.filter((criterion) => criterion.conditional).map((criterion) => criterion.key);

    expect(conditional).toEqual(EXPECTED_CONDITIONAL);
  });

  it("gives every criterion a rationale field and a non-empty Polish label", () => {
    for (const criterion of criteria) {
      expect(criterion.noteKey).toBe(`${criterion.key}Note`);
      expect(criterion.label.trim().length).toBeGreaterThan(0);
    }
  });

  // The `describe` texts are instructions for the model, not data for the renderer. Letting
  // them into this file would make it a second copy of the prompt — and put it one edit away
  // from being tuned on the consumer's side, where nothing feeds it back to the agent.
  it("carries no prompt text — only what the comment renderer needs", () => {
    for (const criterion of criteria) {
      expect(Object.keys(criterion).sort()).toEqual(["conditional", "key", "label", "noteKey"]);
    }
  });
});
