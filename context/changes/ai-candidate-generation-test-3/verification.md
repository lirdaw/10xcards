# Verification — ai-candidate-generation-test-3 (C10X-31)

> Started by Phase 3 (plan "First recorded run"). Every claim below is from runs executed
> on 2026-07-29 against the files as committed on this branch. The OpenRouter key used was
> a throwaway with a 1-hour validity, passed ONLY via the shell environment — it appears in
> no file, no fixture, and is masked in every excerpt here.

## Phase 3 — first real run + calibration (2026-07-29)

### Judge request shape (plan asked this to be decided at the first live call)

**Structured outputs shipped.** `google/gemini-2.5-flash` via OpenRouter accepts
`response_format: { type: "json_schema", strict: true }` — the documented fallback
(prompt-enforced JSON + tolerant parsing) was never needed. Verified by ~45 probe calls
and ~300 judge calls across the calibration day; every well-formed response matched the
verdict schema on the first parse.

### Two judge-client adaptations, both measured before being written

1. **Reasoning disabled** (`reasoning: { enabled: false }`, judge request). gemini-2.5-flash
   is a reasoning model and its thinking tokens draw from the same `max_tokens` budget as
   the visible content. Measured: with default (dynamic) thinking, verdicts came back
   truncated mid-key (`"usable`) on several calls of one run while an earlier identical run
   was clean; raising `max_tokens` 500 → 4000 did **not** help (the model just thinks more).
   With reasoning disabled a 15-call probe loop on the real full-length Polish prompt was
   15/15 clean, `reasoning_tokens: 0`.
2. **A truncated verdict body is a TRANSIENT class, not a contract mismatch.** ~10% of
   judge calls in some runs returned HTTP 200 with `finish_reason: "error"` (native
   `null`) and content cut mid-string at a varying point — while a probe repeating one
   identical prompt was 30/30 clean (provider-side caching masks it). The blips arrive in
   bursts: a single 3 s retry was observed to fail twice in a row (run C, 2 cases lost).
   The plan's failure contract ("any other parse error throws immediately") was widened by
   this measurement: `TruncatedVerdictError` gets two retries with growing backoff
   (3 s, 10 s), then the loud throw stands. Without this the eval could **never** complete:
   at ~10%/call and ~50 calls, P(clean run) ≈ 0.5%.

### The recorded run (via `npm run eval`, key in shell env)

- Wall-clock: **158 s** (other full runs that day: 117–312 s, the spread is provider
  latency + retry backoffs). Exit code: **1** — the verdict's code; the run is honestly
  red with a real finding (below), which the plan explicitly treats as a success of the
  eval, not a blocker of the phase.
- Approximate cost: ~**$0.012 per full run** (10 × gpt-4o-mini generations ≈ $0.004 +
  50 × gemini-2.5-flash judge calls at a measured $0.00016 each ≈ $0.008). The whole
  calibration day — six full runs plus probes — stayed under ~$0.10.

```
generator: openai/gpt-4o-mini | judge: google/gemini-2.5-flash
case                | lang     | usable | count | skip
auto/pl             | OK 5/5   | 5/5    | 5/5   | 0%
auto/en             | OK 5/5   | 5/5    | 5/5   | 0%
auto/es             | OK 5/5   | 5/5    | 5/5   | 0%
auto/de             | OK 5/5   | 5/5    | 5/5   | 0%
auto/fr             | OK 5/5   | 5/5    | 5/5   | 0%
forced/polski       | OK 5/5   | 5/5    | 5/5   | 0%
forced/angielski    | OK 5/5   | 4/5    | 5/5   | 0%
forced/hiszpański   | FAIL 4/5 | 4/5    | 5/5   | 0%
forced/niemiecki    | FAIL 0/5 | 5/5    | 5/5   | 0%
forced/francuski    | FAIL 0/5 | 5/5    | 5/5   | 0%

failures:
- [forced/hiszpański] language: 1/5 cards not in hiszpański (detected: Polish)
- [forced/niemiecki] language: 5/5 cards not in niemiecki (detected: Polish)
- [forced/francuski] language: 5/5 cards not in francuski (detected: Polish)
```

First-ever measurements of the two dormant metrics: **count compliance 50/50 (100%)**,
**skip-rate 0%** across every case of every run that day — the generator's Zod layer
dropped nothing.

### THE FINDING — the forced-language prompt path partially fails (real, reproduced)

**`auto` is flawless; forcing a language via the Polish exonym works only for some
languages.** Across four complete matrix runs the pattern was identical:

| Case | Result across runs |
| --- | --- |
| all five `auto` cases | 25/25 cards in the source language, every run |
| `forced/polski` (positive control), `forced/angielski` | green every run |
| `forced/niemiecki`, `forced/francuski` | **0/5 — every card in Polish, every run** |
| `forced/hiszpański` | intermittent: 4/5 in four runs (one mixed card), 5/5 once |

Mechanism, visible in the cards themselves: the production system prompt says
`Write the flashcards in this language: niemiecki.` — a Polish exonym inside an English
sentence (`src/lib/openrouter.ts:98-111`). With a Polish source text, gpt-4o-mini reads
"niemiecki"/"francuski" as just more Polish context and answers in Polish; "angielski"
and (usually) "hiszpański" survive. The eval measured exactly the seam the plan said had
never been tested against a real model. **Fixing the prompt is out of this slice's scope
by plan ("No changes to the generation path itself"); raise as its own follow-up ticket**
(candidate fix: state the target language in English or natively — `German`, `Deutsch` —
which is a one-line prompt change plus a re-run of this eval as the acceptance check).

Calibration rule, as planned: **a red case is re-run once by hand before being believed;
two reds = real.** Applied: de/fr were red in four out of four complete runs.

### Judge spot-checks (≥1 case per prompt path, per plan)

Verdicts were read against the actual cards; the judge is grading correctly on both paths:

- **auto path (`auto/es`)** — cards are genuine Spanish and grounded, e.g.
  front `¿Qué significa el nombre 'Alhambra'?` / back `El nombre 'Alhambra' proviene del
  árabe y significa 'la roja'…` → `language_ok=true (Spanish), usable=true`. Correct.
- **forced path (`forced/niemiecki`)** — cards are plainly Polish, e.g. front
  `Kiedy urodził się Mikołaj Kopernik?` → `language_ok=false (Polish)`. Correct.
- **forced path, the mixed card (`forced/hiszpański`)** — front in Spanish, back in Polish
  (`¿Cuándo nació Mikołaj Kopernik y dónde?` / `Mikołaj Kopernik urodził się w 1473
  roku…`) → `language_ok=false, usable=false`. Correct — and this is the card class behind
  every intermittent ES red.
- **usability rubric bites for real**: `forced/angielski` had one `usable=false` — the card
  answered with the Latin title `De revolutionibus orbium coelestium`, which is **not in
  the source text**; the judge flagged the grounding violation. A human read agrees.

### Deliberate-breakage checks (both run, both reverted, reverts verified)

| Leg | Temporary edit | Observed result |
| --- | --- | --- |
| Judge observes the expectation (3.5) | `auto/en`'s `expectedLanguage` → `niemiecki` (eval file only) | **exactly that case went additionally red** on the fidelity assertion: `[auto/en] language: 5/5 cards not in niemiecki (detected: English)`; every other case identical to baseline (3 real reds stayed red, 6 greens stayed green) |
| Run-level floor fires (3.6) | `SKIP_RATE_CEILING` → `0` in `scoring.ts` (an impossible bound: 0% >= 0%) | the `afterAll` run-level assertion is what failed: `run-level thresholds (usability / skip-rate): expected [ …"run: aggregate skip-rate 0% at/above the 0% floor" ] to deeply equal []` |

Reverts: `git diff evals/lib/scoring.ts` against HEAD — **0 lines**; a tree-wide grep for
the `BREAKAGE` markers — 0 hits; `npm test` after the reverts — **219/219** (the scoring
unit tests re-prove the restored threshold semantics deterministically); `npm run lint`
exit 0.

### Calibration decision

**All thresholds kept unchanged**: language 100% per case (hard), usability ≥ 80%
aggregate, floors ≥ 1 card per case and skip-rate < 50%. Reasons: the reds are a real
generation defect, not threshold noise — loosening the language gate would define the
defect away; observed usability ran 96–100% per run, comfortably above 80% (the gate
tolerates single-card noise as designed); observed skip-rate was 0% throughout, so the
floors never came near firing and stay as catastrophic backstops only.

### Suite state after Phase 3

`npm test`: **219/219, 18 files** — zero eval files collected (the count is unchanged by
this phase; +12 over the 207 recorded at C10X-30 came from Phase 2's
`tests/lib/eval-scoring.test.ts`). `npm run lint` exit 0 (the only warnings are
`no-console` in `evals/`, which is legal there by design). `git diff` empty for
`vitest.config.ts` and `tests/setup/preflight.ts`.

One transient observation recorded for honesty: during Phase 3 two ordinary-suite flakes
appeared once in back-to-back full runs (`generate.test.ts` failed-key case answering the
generic deck-create error; `flashcards.test.ts` cross-deck pairing answering 302), both
passed in isolation and in the immediate full-suite re-run, and neither touches any file
this change adds. Not chased further here; noted in case a pattern emerges.
