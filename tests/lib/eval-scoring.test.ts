import { describe, expect, it } from "vitest";
// The subject is the eval's pure scoring module under evals/, not src/ — the
// scripts/schema-drift.ts precedent (test-plan §6.1): its deterministic unit test still
// sits in tests/lib/ beside the suite's other pure-function files, imported relatively.
// Only the PURE half of the eval is covered here; the judge client is deliberately
// untested (I/O against a live credential — the same reasoning that leaves
// scripts/check-schema-drift.ts untested), and the eval run itself never enters `npm test`.
import {
  aggregateSkipRate,
  caseLanguagePass,
  countCompliance,
  evaluateRun,
  runUsabilityRate,
  skipRate,
  summaryRows,
  type CardVerdict,
  type CaseResult,
} from "../../evals/lib/scoring";

function verdict(overrides: Partial<CardVerdict> = {}): CardVerdict {
  return { language_ok: true, detected_language: "Polish", usable: true, reason: "ok", ...overrides };
}

/** A clean 5-card case: everything requested came back, every verdict good. */
function goodCase(name: string, verdicts: CardVerdict[] = Array.from({ length: 5 }, () => verdict())): CaseResult {
  return {
    name,
    expectedLanguage: "polski",
    requestedCount: 5,
    returnedCount: verdicts.length,
    generatedCount: verdicts.length,
    verdicts,
  };
}

describe("evaluateRun", () => {
  // THE POSITIVE CONTROL, load-bearing rather than decorative (the §6.6 discipline):
  // without it, every failure assertion below is satisfied by a scorer that rejects
  // everything — and this run's red would then be unattributable.
  it("passes an all-good run with no failures", () => {
    expect(evaluateRun([goodCase("auto/pl"), goodCase("forced/polski")])).toEqual({
      pass: true,
      failures: [],
    });
  });

  // The threshold is >= 0.8, so exactly 80% must PASS — asserting the boundary pins the
  // comparison operator, which a "well below / well above" pair would leave unobserved.
  it("passes at exactly 80% aggregate usability", () => {
    const cases = [
      goodCase("auto/pl"),
      goodCase("auto/en", [verdict(), verdict(), verdict(), verdict({ usable: false }), verdict({ usable: false })]),
    ];
    expect(runUsabilityRate(cases)).toBe(0.8);
    expect(evaluateRun(cases)).toEqual({ pass: true, failures: [] });
  });

  it("fails below 80% aggregate usability, naming the run-level threshold", () => {
    const cases = [
      goodCase("auto/pl"),
      goodCase("auto/en", [
        verdict(),
        verdict(),
        verdict({ usable: false }),
        verdict({ usable: false }),
        verdict({ usable: false }),
      ]),
    ];
    const result = evaluateRun(cases);
    expect(result.pass).toBe(false);
    expect(result.failures).toEqual(["run: usability 70% below the 80% threshold"]);
  });

  // Language is a HARD per-case gate: one bad card fails its whole case, and only that
  // case — the sibling stays out of the failure list, which is what makes a red
  // attributable to one matrix cell.
  it("fails a case on a single wrong-language card, and only that case", () => {
    const cases = [
      goodCase("auto/pl"),
      goodCase("forced/hiszpański", [
        verdict({ detected_language: "Spanish" }),
        verdict({ detected_language: "Spanish" }),
        verdict({ detected_language: "Spanish" }),
        verdict({ detected_language: "Spanish" }),
        verdict({ language_ok: false, detected_language: "Polish" }),
      ]),
    ];
    const result = evaluateRun(cases);
    expect(result.pass).toBe(false);
    expect(result.failures).toEqual(["[forced/hiszpański] language: 1/5 cards not in polski (detected: Polish)"]);
  });

  // An empty card list is the per-case floor — and with zero judged cards the usability
  // rate collapses too, so both failures fire. Asserting the full list pins that the
  // floor is its own entry, not a side effect of the usability line.
  it("trips the per-case floor on an empty card list", () => {
    const empty: CaseResult = {
      name: "auto/de",
      expectedLanguage: "niemiecki",
      requestedCount: 5,
      returnedCount: 0,
      generatedCount: 0,
      verdicts: [],
    };
    const result = evaluateRun([empty]);
    expect(result.pass).toBe(false);
    expect(result.failures).toContain("[auto/de] floor: 0 cards returned (need >= 1)");
  });

  // The skip-rate bound is strict (< 0.5): exactly 50% FAILS. Same boundary-pinning
  // rationale as the usability edge, opposite inclusivity.
  it("fails at exactly 50% aggregate skip-rate and passes just below it", () => {
    const atBoundary: CaseResult = {
      ...goodCase("auto/fr"),
      generatedCount: 10, // 5 returned of 10 generated = 0.5 skip-rate
    };
    expect(aggregateSkipRate([atBoundary])).toBe(0.5);
    const red = evaluateRun([atBoundary]);
    expect(red.pass).toBe(false);
    expect(red.failures).toEqual(["run: aggregate skip-rate 50% at/above the 50% floor"]);

    const below: CaseResult = { ...goodCase("auto/fr"), generatedCount: 9 };
    expect(evaluateRun([below])).toEqual({ pass: true, failures: [] });
  });
});

describe("per-case metrics", () => {
  it("computes count compliance as returned over requested", () => {
    expect(countCompliance({ ...goodCase("auto/pl"), returnedCount: 4 })).toBe(0.8);
    expect(countCompliance({ ...goodCase("auto/pl"), requestedCount: 0 })).toBe(5);
  });

  it("computes skip-rate as the validation-dropped share, safe on zero generated", () => {
    expect(skipRate({ ...goodCase("auto/pl"), generatedCount: 8, returnedCount: 6 })).toBe(0.25);
    expect(skipRate({ ...goodCase("auto/pl"), generatedCount: 0, returnedCount: 0 })).toBe(0);
  });

  it("aggregates skip-rate over summed counts, not an average of per-case rates", () => {
    // Per-case rates 0.5 and 0.0 would average 0.25; the summed pool is 5 dropped of 15.
    const heavy: CaseResult = { ...goodCase("auto/pl"), generatedCount: 10 };
    const clean = goodCase("auto/en");
    expect(aggregateSkipRate([heavy, clean])).toBe(5 / 15);
  });

  it("judges language per case over its own verdicts only", () => {
    expect(caseLanguagePass(goodCase("auto/pl"))).toBe(true);
    expect(caseLanguagePass(goodCase("auto/pl", [verdict(), verdict({ language_ok: false })]))).toBe(false);
  });

  it("reports usability 0 when nothing was judged", () => {
    expect(runUsabilityRate([])).toBe(0);
  });
});

describe("summaryRows", () => {
  it("prints one row per case carrying its name", () => {
    const rows = summaryRows([goodCase("auto/pl"), goodCase("forced/francuski")]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("auto/pl");
    expect(rows[1]).toContain("forced/francuski");
  });
});
