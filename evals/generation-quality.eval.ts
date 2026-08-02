import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateCandidates, resolveModel } from "@/lib/openrouter";
import { PROMPT_LANGUAGE_NAMES } from "./fixtures/language-names";
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

// The 11-case language matrix (test-plan §3 Phase 5, Risk #7): every case calls the
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

interface MatrixCase {
  name: string;
  sourceText: string;
  /**
   * The `targetLanguage` param sent to generateCandidates — the MODEL-facing name, already
   * resolved, or `null` for "same language as the source text". Production resolves it from
   * the `language` table (src/pages/api/generate.ts); the eval cannot read a database by
   * design, so it resolves the same five strings from the shared fixture instead. That
   * fixture is the pin between the two halves — see tests/fixtures/language-names.ts.
   */
  targetLanguage: string | null;
  /**
   * The language every returned card must be in, stated to the judge as an ENGLISH name —
   * the same wording `detected_language` comes back in (evals/lib/judge.ts). It used to be
   * the app-selector exonym, which made the judge's two language fields inconsistent and
   * tied the expectation to a wire value that has since become a two-letter code.
   */
  expectedLanguage: string;
}

/**
 * The model-facing name for a code, or a loud throw.
 *
 * `PROMPT_LANGUAGE_NAMES` is keyed by `string` on purpose (see the fixture's header: the
 * languages the app SHIPS and the languages the eval has a reference text for are different
 * sets that happen to coincide at five). This project extends `astro/tsconfigs/strict`, which
 * does NOT enable `noUncheckedIndexedAccess`, so a miss types as `string` and IS `undefined` —
 * and `undefined` is not `null`, so `systemPrompt` would take the FORCED branch and instruct
 * the model `Write the flashcards in this language: undefined.` while the judge was told to
 * expect `undefined`. Silent nonsense inside the acceptance instrument for Risk #7.
 *
 * The reachable path is authoring a sixth reference text without a fixture entry: `AUTO_CASES`
 * maps over `Object.keys(REFERENCE_TEXTS)`, so that alone is enough. This mirrors the guard the
 * DB half already has (`tests/db/languages.test.ts`: `expect(PROMPT_LANGUAGE_NAMES[row.code]).toBeDefined()`)
 * — the two sides pin the same fixture, so both must fail loudly on a hole in it.
 */
function promptName(code: string): string {
  const name = PROMPT_LANGUAGE_NAMES[code];
  if (!name) {
    throw new Error(
      `No model-facing name for "${code}" in tests/fixtures/language-names.ts. ` +
        `Add one there (it is the pin between this eval and the language table's prompt_name).`,
    );
  }
  return name;
}

// Cases 1–5: the `auto` prompt path ("SAME language as the source text", no name
// interpolated at all) over each language's own reference text.
const AUTO_CASES: MatrixCase[] = (Object.keys(REFERENCE_TEXTS) as ReferenceLanguageCode[]).map((code) => ({
  name: `auto/${code}`,
  sourceText: REFERENCE_TEXTS[code].text,
  targetLanguage: null,
  expectedLanguage: promptName(code),
}));

// Cases 6–10: the forced prompt path over the ONE fixed PL source text. Case 6
// (`forced/pl` on the PL source) is the identity POSITIVE CONTROL: a judge or prompt that
// fails everything would fail it too, which is what separates "generation is broken" from
// "the eval refuses everything" (the §6.6 positive-control discipline applied to this
// layer). Case names key on the CODE now (`forced/de`, not `forced/niemiecki`) — the
// old→new mapping is recorded in the change's verification.md so the C10X-31 baseline
// stays readable against this table.
const FORCED_CODES: ReferenceLanguageCode[] = ["pl", "en", "es", "de", "fr"];
const FORCED_CASES: MatrixCase[] = FORCED_CODES.map((code) => ({
  name: `forced/${code}`,
  sourceText: REFERENCE_TEXTS.pl.text,
  targetLanguage: promptName(code),
  expectedLanguage: promptName(code),
}));

// Case 11: the confound-breaker. Every forced case above runs on the PL source text, so a
// green run there is compatible with "the model defaults to the source language and the
// target happened to agree" for `forced/pl`, and says nothing about a target that is
// neither the source language nor Polish. French forced over the ENGLISH reference text
// has no such overlap: PL is absent from the request entirely, so a card in French can
// only have come from the interpolated name.
const CROSS_SOURCE_CASE: MatrixCase = {
  name: "forced/fr-on-en",
  sourceText: REFERENCE_TEXTS.en.text,
  targetLanguage: promptName("fr"),
  expectedLanguage: promptName("fr"),
};

const MATRIX: MatrixCase[] = [...AUTO_CASES, ...FORCED_CASES, CROSS_SOURCE_CASE];

// Shared accumulators: every case pushes its CaseResult BEFORE asserting, so the afterAll
// table includes ASSERTION-red cases too (report-then-assert). A case that THROWS before
// its push (generator or judge infrastructure) cannot appear here — the afterAll prints a
// MISSING line for it instead, so a short table never reads as a complete run. Card texts
// + verdicts go to a separate log emitted in afterAll, because the spot-check /
// calibration record needs the raw pairs from GREEN cases too, not just the aggregate.
//
// This block used to add "Vitest 4 swallows console output of PASSING tests". That is
// FALSE as a statement about Vitest, and it was corrected by measurement (C10X-42, on this
// repo's Vitest 4.1.10): the swallowing is a property of the `agent` REPORTER, which
// Vitest auto-selects only when `std-env` sees CLAUDECODE / CLAUDE_CODE in the environment
// — it is MinimalReporter constructed with `silent: "passed-only"`. Under the `default`
// reporter, which is what a GitHub runner gets, every line here PRINTS on a green run as
// well. Consequence for CI, and the reason the report files below exist: a job log would
// otherwise carry ~165 lines of card text on every dispatch, so
// .github/workflows/eval.yml echoes only eval-summary.log into the log and ships the full
// record as an artifact. Corollary: `--disable-console-intercept` is an agent-terminal
// remedy (C10X-41 used it locally) and must NOT be copied into the workflow reflexively.
const results: CaseResult[] = [];
const cardLog: string[] = [];

// Report sinks (C10X-42). Written on EVERY run, local and CI alike — one code path, so
// nothing here is a CI-only branch that stays untested until the first dispatch. The `.log`
// extension is load-bearing rather than incidental: `.gitignore:20` already covers `*.log`,
// so a run inside a working tree leaves no untracked straggler. Both land in the process
// cwd, which is the repo root under `npm run eval` and under the workflow alike.
const REPORT_FULL = "eval-report.log";
const REPORT_SUMMARY = "eval-summary.log";

/**
 * Write both report files, reporting a failure instead of throwing.
 *
 * Called from inside afterAll, i.e. BEFORE the run-level assertion that closes the hook. A
 * throw here would abort the hook and turn a real generation defect into a write error —
 * the diagnostic replacing the verdict it exists to explain. So the write is best-effort:
 * the assertion below must be reached in every case where it would have been reached
 * before these files existed.
 */
function writeReports(cardLines: string[], summaryLines: string[]): void {
  try {
    writeFileSync(join(process.cwd(), REPORT_FULL), `${[...cardLines, ...summaryLines].join("\n")}\n`, "utf8");
    writeFileSync(join(process.cwd(), REPORT_SUMMARY), `${summaryLines.join("\n")}\n`, "utf8");
  } catch (err) {
    console.error(`Could not write the eval report files: ${err instanceof Error ? err.message : String(err)}`);
  }
}

describe("generation quality matrix (real provider + LLM judge)", () => {
  for (const matrixCase of MATRIX) {
    it(`${matrixCase.name}: cards come back in ${matrixCase.expectedLanguage} and are usable`, async () => {
      const generated = await generateCandidates({
        sourceText: matrixCase.sourceText,
        targetLanguage: matrixCase.targetLanguage,
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
    // Compose the summary section first, print second, write third — the printed order is
    // identical to what this hook emitted before the report files existed (card log, then
    // generator/judge line, header, rows, MISSING lines, failures block). Composing rather
    // than printing inline is what lets the SAME lines reach two sinks: the workflow echoes
    // eval-summary.log into the public job log while the full record goes to the artifact,
    // so the YAML never has to grep a table header owned by scoring.ts.
    const summary: string[] = [
      `\ngenerator: ${resolveModel()} | judge: ${resolveJudgeModel()}`,
      SUMMARY_HEADER,
      ...summaryRows(results),
    ];

    // A case that threw before its results.push has no row — mark the hole, so a 10-row
    // table cannot be read as a complete 11-case run (its it() is red with the throw,
    // but the table is the diagnostic and must not under-report silently).
    const reported = new Set(results.map((r) => r.name));
    for (const missing of MATRIX.filter((c) => !reported.has(c.name))) {
      summary.push(`${missing.name} — MISSING (threw before judging completed; see its test failure)`);
    }

    // evaluateRun runs before the printing, not after it, so the `failures:` block is part
    // of the composed summary section and therefore reaches eval-summary.log too. The
    // ordering that matters is unchanged: every line is emitted before the assertion.
    const verdict = evaluateRun(results);
    if (verdict.failures.length > 0) {
      summary.push(`\nfailures:\n- ${verdict.failures.join("\n- ")}`);
    }

    for (const line of cardLog) console.log(line);
    for (const line of summary) console.log(line);

    writeReports(cardLog, summary);

    const runLevelFailures = verdict.failures.filter((f) => f.startsWith("run:"));
    expect(runLevelFailures, "run-level thresholds (usability / skip-rate)").toEqual([]);
  });
});
