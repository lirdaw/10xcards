import { afterAll, describe, expect, it } from "vitest";
import { generateCandidates, resolveModel } from "@/lib/openrouter";
import type { Language } from "@/lib/generation-limits";
import { REFERENCE_TEXTS, type ReferenceLanguageCode } from "./fixtures/reference-texts";
import { judgeCard, resolveJudgeModel } from "./lib/judge";
import {
  CASE_MIN_CARDS,
  SUMMARY_HEADER,
  evaluateRun,
  summaryRows,
  type CardVerdict,
  type CaseResult,
} from "./lib/scoring";

// The 10-case language matrix (test-plan §3 Phase 5, Risk #7): every case calls the
// PRODUCTION generateCandidates() against the real provider, then grades each returned
// card with the LLM judge (different model family, temperature 0). Cases run
// sequentially — one file, default Vitest ordering — to avoid parallel-hammering the
// provider and to keep the verdict table readable.
//
// Red comes ONLY from (plan "Phase 3 / The matrix"):
//   - a per-case floor (< CASE_MIN_CARDS cards returned),
//   - per-case language fidelity < 100% (wrong language is a binary, serious failure),
//   - run-level usability < USABILITY_THRESHOLD or skip-rate >= SKIP_RATE_CEILING
//     (asserted in afterAll via evaluateRun, so the decision lives in scoring.ts),
//   - an infrastructure throw (generator or judge).
// Count compliance is PRINTED, never asserted — the first measurement cannot be a
// blindly-tuned gate. The summary table prints in afterAll BEFORE the run-level
// assertion (report-then-assert: the table is the diagnostic, it must appear on red).

const REQUESTED_COUNT = 5;

// Per-call cap on the generator fetch (the lib seam production drives at 40 s). Kept
// below the 120 s testTimeout so a stalled socket fails as a labelled generator error,
// not as the runner's generic "Test timed out" with no seam attribution.
const GENERATOR_TIMEOUT_MS = 60_000;

/** App-selector name per reference-text code — the judge is told the language in the
 *  same wording the production prompt uses (Polish exonyms, see openrouter.ts). */
const SELECTOR_NAME: Record<ReferenceLanguageCode, Exclude<Language, "auto">> = {
  pl: "polski",
  en: "angielski",
  es: "hiszpański",
  de: "niemiecki",
  fr: "francuski",
};

interface MatrixCase {
  name: string;
  sourceText: string;
  /** The `language` param sent to generateCandidates (whitelist value). */
  language: Language;
  /** The language every returned card must be in (stated to the judge). */
  expectedLanguage: Exclude<Language, "auto">;
}

// Cases 1–5: the `auto` prompt path ("SAME language as the source text") over each
// language's own reference text.
const AUTO_CASES: MatrixCase[] = (Object.keys(REFERENCE_TEXTS) as ReferenceLanguageCode[]).map((code) => ({
  name: `auto/${code}`,
  sourceText: REFERENCE_TEXTS[code].text,
  language: "auto",
  expectedLanguage: SELECTOR_NAME[code],
}));

// Cases 6–10: the forced prompt path (Polish exonym inside an English sentence) over the
// ONE fixed PL source text. Case 6 (`forced/polski` on the PL source) is the identity
// POSITIVE CONTROL: a judge or prompt that fails everything would fail it too, which is
// what separates "generation is broken" from "the eval refuses everything" (the §6.6
// positive-control discipline applied to this layer).
const FORCED_LANGUAGES: Exclude<Language, "auto">[] = ["polski", "angielski", "hiszpański", "niemiecki", "francuski"];
const FORCED_CASES: MatrixCase[] = FORCED_LANGUAGES.map((lang) => ({
  name: `forced/${lang}`,
  sourceText: REFERENCE_TEXTS.pl.text,
  language: lang,
  expectedLanguage: lang,
}));

const MATRIX: MatrixCase[] = [...AUTO_CASES, ...FORCED_CASES];

// Shared accumulators: every case pushes its CaseResult BEFORE asserting, so the afterAll
// table includes ASSERTION-red cases too (report-then-assert). A case that THROWS before
// its push (generator or judge infrastructure) cannot appear here — the afterAll prints a
// MISSING line for it instead, so a short table never reads as a complete run. Card texts
// + verdicts go to a separate log printed in afterAll — Vitest 4 swallows console output
// of PASSING tests, and the spot-check/calibration record needs the raw pairs from green
// cases too.
const results: CaseResult[] = [];
const cardLog: string[] = [];

describe("generation quality matrix (real provider + LLM judge)", () => {
  for (const matrixCase of MATRIX) {
    it(`${matrixCase.name}: cards come back in ${matrixCase.expectedLanguage} and are usable`, async () => {
      const generated = await generateCandidates({
        sourceText: matrixCase.sourceText,
        language: matrixCase.language,
        count: REQUESTED_COUNT,
        signal: AbortSignal.timeout(GENERATOR_TIMEOUT_MS),
      });

      // Judge sequentially, one card per call — the verdict order mirrors the card order.
      // Each card + verdict is logged verbatim: the spot-check of judge verdicts against a
      // human read (and the calibration record in verification.md) needs the raw pairs,
      // not just the aggregate table.
      const verdicts: CardVerdict[] = [];
      for (const card of generated.cards) {
        const verdict = await judgeCard({
          front: card.front,
          back: card.back,
          sourceExcerpt: matrixCase.sourceText,
          expectedLanguage: matrixCase.expectedLanguage,
        });
        verdicts.push(verdict);
        cardLog.push(
          `[${matrixCase.name}] front: ${card.front}\n  back: ${card.back}\n  verdict: ` +
            `language_ok=${verdict.language_ok} (${verdict.detected_language}), usable=${verdict.usable} — ${verdict.reason}`,
        );
      }

      // Record first, assert second — a red case must still appear in the summary table.
      results.push({
        name: matrixCase.name,
        expectedLanguage: matrixCase.expectedLanguage,
        requestedCount: REQUESTED_COUNT,
        returnedCount: generated.cards.length,
        generatedCount: generated.generatedCount,
        verdicts,
      });

      // Floor: the generator must produce SOMETHING to judge.
      expect(
        generated.cards.length,
        `[${matrixCase.name}] floor: fewer than ${CASE_MIN_CARDS} card(s) returned`,
      ).toBeGreaterThanOrEqual(CASE_MIN_CARDS);

      // Hard per-case gate: 100% language fidelity — one wrong-language card fails the case.
      const wrongLanguage = verdicts.filter((v) => !v.language_ok);
      expect(wrongLanguage, `[${matrixCase.name}] cards not in ${matrixCase.expectedLanguage}`).toEqual([]);
    });
  }

  // Run-level verdict: print the summary table FIRST (it is the diagnostic and must show
  // on failure too), then assert the run-level thresholds through evaluateRun so the
  // red/green decision stays in scoring.ts. Per-case failures (floors, language) already
  // failed their own it(); re-asserting them here would double-report, so only the
  // `run:`-prefixed failures gate this hook.
  afterAll(() => {
    for (const line of cardLog) console.log(line);
    console.log(`\ngenerator: ${resolveModel()} | judge: ${resolveJudgeModel()}`);
    console.log(SUMMARY_HEADER);
    for (const row of summaryRows(results)) console.log(row);

    // A case that threw before its results.push has no row — mark the hole, so a 9-row
    // table cannot be read as a complete 10-case run (its it() is red with the throw,
    // but the table is the diagnostic and must not under-report silently).
    const reported = new Set(results.map((r) => r.name));
    for (const missing of MATRIX.filter((c) => !reported.has(c.name))) {
      console.log(`${missing.name} — MISSING (threw before judging completed; see its test failure)`);
    }

    const verdict = evaluateRun(results);
    if (verdict.failures.length > 0) {
      console.log(`\nfailures:\n- ${verdict.failures.join("\n- ")}`);
    }

    const runLevelFailures = verdict.failures.filter((f) => f.startsWith("run:"));
    expect(runLevelFailures, "run-level thresholds (usability / skip-rate)").toEqual([]);
  });
});
