// All decidable eval logic, no I/O: pure functions over plain data — no fetch, no env
// reads, no imports from src/. That purity is what lets tests/lib/eval-scoring.test.ts
// cover every threshold boundary deterministically inside the ordinary `npm test` suite
// (the scripts/schema-drift.ts precedent, test-plan §6.1), while the eval run itself
// stays outside it.
//
// Threshold semantics (plan "Implementation Approach", calibrated by the first recorded
// run in the change's verification.md — adjust only with the change documented there):
// - Language fidelity: 100% per case, hard. Wrong language is a binary, serious failure
//   (the NFR names it first-class), so a single bad card fails its whole case.
// - Usability: >= 80% AGGREGATE across all judged cards of the run — tolerates
//   temperature-0.4 noise on single cards without letting a bad run through.
// - Floors (catastrophic, what keeps the eval falsifiable while count compliance and
//   skip-rate remain reported-not-gated): >= 1 card returned per case; aggregate
//   skip-rate strictly below 50%.

/** One judge verdict for one generated card (produced by evals/lib/judge.ts). */
export interface CardVerdict {
  language_ok: boolean;
  detected_language: string;
  usable: boolean;
  reason: string;
}

/** One matrix case's raw outcome: generation numbers plus the per-card verdicts. */
export interface CaseResult {
  /** Stable case label, e.g. "auto/pl" or "forced/hiszpański". */
  name: string;
  /** The language the cards were expected in (as stated to the judge). */
  expectedLanguage: string;
  /** Cards asked of the generator (`count`). */
  requestedCount: number;
  /** Cards that survived the generator's own Zod validation (`cards.length`). */
  returnedCount: number;
  /** Cards the model returned before validation (`generatedCount`). */
  generatedCount: number;
  /** One verdict per RETURNED card, in order. */
  verdicts: CardVerdict[];
}

export interface RunVerdict {
  pass: boolean;
  failures: string[];
}

export const USABILITY_THRESHOLD = 0.8;
/** Aggregate skip-rate must stay strictly BELOW this (a floor, not a tuned gate). */
export const SKIP_RATE_CEILING = 0.5;
export const CASE_MIN_CARDS = 1;

/** Reported, never asserted (first measurement cannot be a blindly-tuned gate). */
export function countCompliance(c: CaseResult): number {
  return c.returnedCount / Math.max(c.requestedCount, 1);
}

/** Share of model-returned cards the generator's validation dropped, for one case. */
export function skipRate(c: CaseResult): number {
  return (c.generatedCount - c.returnedCount) / Math.max(c.generatedCount, 1);
}

/** Hard per-case gate: every judged card in the expected language. */
export function caseLanguagePass(c: CaseResult): boolean {
  return c.verdicts.every((v) => v.language_ok);
}

/** Usable cards over all judged cards of the run. 0 when nothing was judged. */
export function runUsabilityRate(cases: CaseResult[]): number {
  const verdicts = cases.flatMap((c) => c.verdicts);
  if (verdicts.length === 0) return 0;
  return verdicts.filter((v) => v.usable).length / verdicts.length;
}

/** Run-level skip-rate over summed counts — NOT an average of per-case rates. */
export function aggregateSkipRate(cases: CaseResult[]): number {
  const generated = cases.reduce((sum, c) => sum + c.generatedCount, 0);
  const returned = cases.reduce((sum, c) => sum + c.returnedCount, 0);
  return (generated - returned) / Math.max(generated, 1);
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

// Failure messages carry the raw fraction plus one decimal, because Math.round alone can
// print a self-contradictory red — e.g. 39/49 usable (79.59%) rounds to "usability 80%
// below the 80% threshold". The fraction is the authoritative value; the rounded pct()
// stays for the thresholds themselves, which are exact constants.
function fractionPct(numerator: number, denominator: number, rate: number): string {
  return `${numerator}/${denominator} = ${(rate * 100).toFixed(1)}%`;
}

/**
 * The whole red/green decision of an eval run. Red comes ONLY from: a per-case floor
 * (< CASE_MIN_CARDS returned), per-case language < 100%, run usability below
 * USABILITY_THRESHOLD, or aggregate skip-rate at/above SKIP_RATE_CEILING.
 */
export function evaluateRun(cases: CaseResult[]): RunVerdict {
  const failures: string[] = [];

  for (const c of cases) {
    if (c.returnedCount < CASE_MIN_CARDS) {
      failures.push(`[${c.name}] floor: ${c.returnedCount} cards returned (need >= ${CASE_MIN_CARDS})`);
    }
    if (!caseLanguagePass(c)) {
      const bad = c.verdicts.filter((v) => !v.language_ok);
      const detected = [...new Set(bad.map((v) => v.detected_language))].join(", ");
      failures.push(
        `[${c.name}] language: ${bad.length}/${c.verdicts.length} cards not in ${c.expectedLanguage} (detected: ${detected})`,
      );
    }
  }

  const usability = runUsabilityRate(cases);
  if (usability < USABILITY_THRESHOLD) {
    const verdicts = cases.flatMap((c) => c.verdicts);
    const usable = verdicts.filter((v) => v.usable).length;
    failures.push(
      `run: usability ${fractionPct(usable, verdicts.length, usability)} below the ${pct(USABILITY_THRESHOLD)} threshold`,
    );
  }

  const skips = aggregateSkipRate(cases);
  if (skips >= SKIP_RATE_CEILING) {
    const generated = cases.reduce((sum, c) => sum + c.generatedCount, 0);
    const returned = cases.reduce((sum, c) => sum + c.returnedCount, 0);
    failures.push(
      `run: aggregate skip-rate ${fractionPct(generated - returned, generated, skips)} at/above the ${pct(SKIP_RATE_CEILING)} floor`,
    );
  }

  return { pass: failures.length === 0, failures };
}

/** Column header matching summaryRows — print once above them. */
export const SUMMARY_HEADER = "case                | lang     | usable | count | skip";

/**
 * One printable row per case: language verdict, usable count, count compliance
 * (returned/requested — reported, never asserted) and per-case skip-rate.
 */
export function summaryRows(cases: CaseResult[]): string[] {
  return cases.map((c) => {
    const judged = c.verdicts.length;
    const langOk = c.verdicts.filter((v) => v.language_ok).length;
    const usable = c.verdicts.filter((v) => v.usable).length;
    const lang = caseLanguagePass(c) ? `OK ${langOk}/${judged}` : `FAIL ${langOk}/${judged}`;
    return (
      `${c.name.padEnd(19)} | ${lang.padEnd(8)} | ${`${usable}/${judged}`.padEnd(6)} | ` +
      `${`${c.returnedCount}/${c.requestedCount}`.padEnd(5)} | ${pct(skipRate(c))}`
    );
  });
}
