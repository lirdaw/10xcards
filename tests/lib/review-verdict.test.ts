import { describe, expect, it } from "vitest";
// `@/*` maps to `src/*` only, and the subject here is CI tooling under `scripts/` — the
// scripts/schema-drift.ts precedent (test-plan §6.1): its deterministic unit test still sits
// in tests/lib/ beside the suite's other pure-function files, imported relatively.
import { SCORE_MAX, SCORE_MIN, SCORE_THRESHOLD, decideVerdict, parseReview } from "../../scripts/review-verdict.ts";
import type { Criterion } from "../../scripts/review-verdict.ts";

// The gate's entire decision. Its cost of being wrong is asymmetric in BOTH directions: a
// false `pass` is a review that praises a change carrying the exact defect class this agent
// exists for (five `…-swallowed` folders in context/archive/ from one week), while a false
// `fail` teaches the team to ignore the label, and a label everyone ignores is worse than no
// label at all.
//
// What is NOT covered here, and cannot be: the agent call itself (network + a paid
// credential) and the workflow's label/comment side effects (GitHub). Those are carried by
// the recorded pair of runs in this change's verification.md — deliberately a PAIR differing
// in exactly one thing, never a single green run.

/**
 * Fixtures are OWNED by this file and built fresh per case — never shared, never mutated in
 * place. `vitest.config.ts` pins `sequence: { shuffle: true }`, so a case leaning on a
 * sibling's object would surface as a flake rather than as the defect it is (lessons.md,
 * "A positive control must OWN the fixture it mutates").
 *
 * The shape mirrors `agents/review/criteria.json` — two conditional criteria among plain ones
 * — but not its content: the real list's own contract is asserted in review-criteria.test.ts,
 * and pinning it here as well would make an ordinary criteria edit red in two places for one
 * reason.
 */
const CRITERIA: readonly Criterion[] = [
  { key: "alpha", noteKey: "alphaNote", label: "Alfa", conditional: false },
  { key: "beta", noteKey: "betaNote", label: "Beta", conditional: false },
  { key: "gamma", noteKey: "gammaNote", label: "Gamma", conditional: true },
];

/** A clean result every case starts from and edits into the case it needs. */
function cleanReview(): Record<string, unknown> {
  return {
    alpha: 8,
    alphaNote: "Sprawdzone w src/pages/api/decks.ts — obie gałęzie błędu rozgałęziają się na `data`.",
    beta: 7,
    betaNote: "Importy przez @/*, klasy scalane przez cn().",
    gamma: 9,
    gammaNote: "Wynik `update` odczytany przez `.select().maybeSingle()`.",
    verdict: "pass",
    summary: "Zmiana wygląda dobrze.",
  };
}

function verdictOf(review: Record<string, unknown>, threshold = SCORE_THRESHOLD): "pass" | "fail" {
  return decideVerdict({ review, criteria: CRITERIA, threshold }).verdict;
}

describe("decideVerdict", () => {
  // THE POSITIVE CONTROL, and it is load-bearing rather than decorative: without it every
  // assertion below is satisfied by an implementation that returns `fail` unconditionally —
  // which would be a gate that never goes green, i.e. the same unfalsifiable class from the
  // other side.
  it("returns pass when the agent passed and every score clears the threshold", () => {
    const decision = decideVerdict({ review: cleanReview(), criteria: CRITERIA, threshold: SCORE_THRESHOLD });

    expect(decision.verdict).toBe("pass");
    expect(decision.failing).toEqual([]);
    expect(decision.skipped).toEqual([]);
  });

  // The boundary from both sides in one case, because "below the threshold" and "at the
  // threshold" is exactly the pair an off-by-one gets wrong.
  it("treats a score equal to the threshold as passing and one below it as failing", () => {
    const atThreshold = cleanReview();
    atThreshold.alpha = SCORE_THRESHOLD;
    expect(verdictOf(atThreshold)).toBe("pass");

    const belowThreshold = cleanReview();
    belowThreshold.alpha = SCORE_THRESHOLD - 1;
    expect(verdictOf(belowThreshold)).toBe("fail");
  });

  it("names the failing criterion with its score and note, so the comment can lead with it", () => {
    const review = cleanReview();
    review.beta = 2;
    review.betaNote = "Sekret w treści odpowiedzi — src/pages/api/generate.ts.";

    const decision = decideVerdict({ review, criteria: CRITERIA, threshold: SCORE_THRESHOLD });

    expect(decision.failing).toEqual([
      { key: "beta", label: "Beta", score: 2, note: "Sekret w treści odpowiedzi — src/pages/api/generate.ts." },
    ]);
  });

  // `null` is "does not apply": it must not be able to push the verdict in EITHER direction.
  // Reading it as 0 would fail every documentation-only change; reading it as 10 would let a
  // change that touched no write path outscore one that touched it and handled it properly.
  it("excludes a null score from the aggregation and reports it as skipped", () => {
    const review = cleanReview();
    review.gamma = null;
    review.gammaNote = "Diff nie dotyka żadnej ścieżki zapisu.";

    const decision = decideVerdict({ review, criteria: CRITERIA, threshold: SCORE_THRESHOLD });

    expect(decision.verdict).toBe("pass");
    expect(decision.failing).toEqual([]);
    expect(decision.skipped).toEqual([
      { key: "gamma", label: "Gamma", note: "Diff nie dotyka żadnej ścieżki zapisu." },
    ]);
  });

  // The two sources of `fail` are an ALTERNATIVE, and these two cases are what pins that: a
  // conjunction would go green on both.
  it("fails on the agent's own verdict even when every score clears the threshold", () => {
    const review = cleanReview();
    review.verdict = "fail";
    review.summary = "Nie umiem tego wcisnąć w żadne kryterium, ale ta zmiana jest ryzykowna.";

    const decision = decideVerdict({ review, criteria: CRITERIA, threshold: SCORE_THRESHOLD });

    expect(decision.verdict).toBe("fail");
    // Nothing to list — the comment has to survive a `fail` with an empty failing list.
    expect(decision.failing).toEqual([]);
  });

  it("fails on a single low score even when the agent summarised the change as passing", () => {
    const review = cleanReview();
    review.alpha = 1;

    expect(review.verdict).toBe("pass");
    expect(verdictOf(review)).toBe("fail");
  });

  // The threshold is a parameter rather than a constant read inside the function, and this is
  // the assertion that proves it steers instead of decorating.
  it("moves the verdict when the threshold moves, on an unchanged result", () => {
    const review = cleanReview();
    review.alpha = 7;

    expect(verdictOf(review, 5)).toBe("pass");
    expect(verdictOf(review, 8)).toBe("fail");
  });

  it("keeps SCORE_THRESHOLD as the shipped sensitivity", () => {
    expect(SCORE_THRESHOLD).toBe(5);
  });
});

describe("parseReview", () => {
  // A missing criterion must be a REFUSAL, never a silent skip: read as "does not apply" it
  // would make "the agent forgot to score this" byte-identical to "this genuinely has no
  // bearing here" — and the second is a legitimate answer the comment renders as such.
  it("throws when the result is missing a criterion the list names", () => {
    const review = cleanReview();
    delete review.beta;

    expect(() => parseReview(review, CRITERIA)).toThrow(/beta/);
    expect(() => decideVerdict({ review, criteria: CRITERIA, threshold: SCORE_THRESHOLD })).toThrow(/beta/);
  });

  it("throws when a criterion carries no rationale", () => {
    const review = cleanReview();
    delete review.gammaNote;

    expect(() => parseReview(review, CRITERIA)).toThrow(/gammaNote/);
  });

  // `null` on a criterion the schema declares as a plain number is a broken contract, not a
  // judgement — and swallowing it here would re-open the very hole the case above closes.
  it("throws on null in a criterion that is not conditional", () => {
    const review = cleanReview();
    review.alpha = null;

    expect(() => parseReview(review, CRITERIA)).toThrow(/alpha/);
  });

  it("throws on a score that is not a number", () => {
    const review = cleanReview();
    review.beta = "8";

    expect(() => parseReview(review, CRITERIA)).toThrow(/beta/);
  });

  it("throws when the result carries no pass/fail verdict of its own", () => {
    const review = cleanReview();
    review.verdict = "maybe";

    expect(() => parseReview(review, CRITERIA)).toThrow(/werdykt/);
  });

  it("throws on a result that is not a JSON object at all", () => {
    expect(() => parseReview("{}", CRITERIA)).toThrow();
    expect(() => parseReview(null, CRITERIA)).toThrow();
    expect(() => parseReview([cleanReview()], CRITERIA)).toThrow();
  });

  it("returns the rows in criteria order, which is the order the comment table renders", () => {
    const rows = parseReview(cleanReview(), CRITERIA).scores;

    expect(rows.map((row) => row.key)).toEqual(["alpha", "beta", "gamma"]);
  });
});

// The scale is the one contract `review-schema.ts` CANNOT enforce: structured output rejects
// `minimum`/`maximum` on an integer type, so the field description is the only thing steering
// the model, and a description is guidance rather than a gate. These cases are what turns it
// back into a gate — the same argument that already refuses `null` on a non-conditional
// criterion, applied to the other way a score can be outside the contract.
describe("score range", () => {
  it("accepts both ends of the declared scale", () => {
    const low = cleanReview();
    low.alpha = SCORE_MIN;
    const high = cleanReview();
    high.alpha = SCORE_MAX;

    // A positive control for this block: without it, an implementation that threw on every
    // score would pass every rejection case below.
    expect(() => decideVerdict({ review: low, criteria: CRITERIA, threshold: 5 })).not.toThrow();
    expect(() => decideVerdict({ review: high, criteria: CRITERIA, threshold: 5 })).not.toThrow();
  });

  it.each([
    ["above the scale", 42],
    ["below the scale", -3],
    ["zero, which is not on a 1-10 scale", 0],
  ])("throws on a score %s", (_label, score) => {
    const review = cleanReview();
    review.alpha = score;

    // Named in the message, because a bare "invalid score" would send the reader looking at the
    // verdict rule rather than at the agent's output.
    expect(() => decideVerdict({ review, criteria: CRITERIA, threshold: 5 })).toThrow(/skala to 1-10/);
  });

  it("still allows null on a conditional criterion — the range check must not swallow that path", () => {
    const review = cleanReview();
    review.gamma = null;

    const decision = decideVerdict({ review, criteria: CRITERIA, threshold: 5 });

    expect(decision.skipped.map((row) => row.key)).toContain("gamma");
  });
});
