# AI-Native Generation Quality Eval (Risk #7, test-plan §3 Phase 5) — Implementation Plan

## Overview

Build the project's first LLM-as-judge eval: a separate, locally-triggered run path (outside
`npm test`, outside CI) that calls the production `generateCandidates()` with a real
`OPENROUTER_API_KEY`, grades every returned card with a judge from a **different model
family**, and reports the first-ever measurements of two dormant metrics — real-model count
compliance and skip-rate. The eval proves (or refutes) that generated cards come back in the
source-text language and are usable study material, across **all six** shipped language
selector values — closing Risk #7 as far as a proxy can, while stating plainly that the judge
does not measure the 75% acceptance rate (only real users produce that).

The slice also closes one adjacent deterministic gap named by C10X-28's hand-off: the
success-path audit columns of `generation_session` have never been asserted anywhere — a
cheap mock-mode test in the ordinary suite fixes that.

## Current State Analysis

Grounded in `context/changes/ai-candidate-generation-test-3/research.md` (read fully; key
claims re-verified against the files):

- **The mock clamp is airtight and must stay byte-identical.** `tests/setup/preflight.ts:110-118`
  fails the whole `npm test` run when `OPENROUTER_API_KEY` is set, with no env opt-out
  (lessons.md: "Preflight musi domknąć KAŻDY nielokalny szew"). The eval must be a **new run
  path**, not a relaxation.
- **`globalSetup` binds per-config** (`vitest.config.ts:31`) and
  `include: ["tests/**/*.test.ts"]` (`vitest.config.ts:26`) replaces the default glob — so a
  second config with its own include (`evals/**/*.eval.ts`) is invisible to `npm test`
  **structurally**, by collection, with zero edits to the existing config or preflight.
- **Only a `getViteConfig()`-based config resolves `@/lib/openrouter` and `astro:env/server`**
  (`vitest.config.ts:1-20` — the Cloudflare-plugin strip is part of the wrapper). A
  `scripts/`-resident judge would have to rebuild the request and silently drift from the
  production prompt (AGENTS.md forbids `scripts/`↔`src/` imports) — rejected.
- **`astro:env` secrets are transform-time inlined literals under Vitest** — the key must be
  in the environment when the config loads; it cannot be injected from inside a test.
  Shell-env invocation is the one supported form: it feeds both seams (the generator's
  `astro:env` and the judge's `process.env`), while a key in `.env` reaches only the first —
  and left there it loudly fails the next ordinary `npm test` by design.
- **Two materially different prompt paths** (`src/lib/openrouter.ts:98-111`): `auto` → "SAME
  language as the source text"; forced → a **Polish exonym inside an English sentence**
  (`Write the flashcards in this language: hiszpański.`). Whitelist:
  `["auto", "polski", "angielski", "hiszpański", "niemiecki", "francuski"]`
  (`src/lib/generation-limits.ts:43`). Neither path has ever been tested against a real model.
- **Non-determinism is built in** (`temperature: 0.4`, `openrouter.ts:177`) — the test-plan's
  anti-pattern row (no snapshotting) is confirmed live; every oracle must be rubric/property
  based with aggregate thresholds.
- **No calibration corpus exists**: prod holds ~38 flashcard rows, local DB reset to empty
  2026-07-28, all local candidates are mock strings. The reference set must be authored.
- **Mock mode returns fixed Polish strings** (`openrouter.ts:114-119`) — an eval accidentally
  running mock would pass PL fidelity **vacuously**. The eval's own preflight must therefore
  be the *inverse* of the main one: fail when the key is ABSENT.
- **Success-path audit columns** (`source_text`, `model`, `language`, `request_payload`,
  `response_payload` on `generation_session`, written at `src/pages/api/generate.ts:286-299`)
  are asserted nowhere — only the two failure branches are
  (`context/archive/2026-07-26-ai-candidate-generation-test-2/verification.md:661`).

## Desired End State

- `npx vitest run -c vitest.eval.config.ts` (with `OPENROUTER_API_KEY` in the shell env) runs
  a 10-case language matrix against the real provider through the production code path,
  prints a per-case verdict table (language fidelity, usability, count compliance, skip-rate)
  and exits non-zero when a threshold or floor is breached.
- `npm test` collects **zero** eval files, stays green, and `git diff` on `vitest.config.ts`
  and `tests/setup/preflight.ts` is empty.
- The ordinary suite gains: unit tests for the eval's pure scoring functions, and one
  mock-mode test asserting the success-path audit columns.
- test-plan §3 Phase 5 reads `complete` (dated), §6.6 carries the Phase 5 entry with its
  boundary list, §5's LLM-as-judge gate row reflects the **local-only, human-triggered**
  reality, and the roadmap carries an `H-06` row before this change is ever archived.
- The first real calibration run is recorded in the change's `verification.md` with observed
  verdicts, cost and wall-clock.

### Key Discoveries:

- Exclusion by collection beats exclusion by guard: `include` replacement keeps eval files
  out of `npm test` with zero preflight logic (`vitest.config.ts:26`).
- The judge module lives outside `src/`, so it may read `process.env` and use `console.*`
  freely (`tests/lib/no-logging.test.ts` scans `src/` only; `astro:env` is an `src/` rule).
- `tests/lib/schema-drift.test.ts` → `scripts/schema-drift.ts` is the sanctioned precedent
  for a `tests/lib/` unit test importing a non-`src/` module relatively (test-plan §6.1).
- The generator reaches the key via `astro:env` inlining and the judge via `process.env` —
  both read the same shell environment in the same invocation, so one export feeds both.

## What We're NOT Doing

- **No GitHub workflow and no repo secret** — decided in planning (user choice: local-only).
  The `workflow_dispatch` leg (schema-diff.yml idiom, per-step secrets, capped OpenRouter
  key) is **deferred to a follow-up ticket**, named in doc-sync. Nothing in this slice
  touches `.github/`.
- **No measurement of the 75% acceptance rate.** The judge is a proxy for quality; the
  product metric belongs to real users. Stated in the plan, restated in §6.6.
- **No changes to the generation path itself** — no prompt tuning, no model swap, no 1-shot
  corrective re-call (S-04 plan-review F5 lever). The eval produces the first skip-rate
  number that lever's trigger condition has been waiting for; acting on it is future work.
- **No endpoint-level eval case** — the eval stays lib-level (no DB, no local stack, no
  account fixtures). Persistence is covered deterministically in the ordinary suite.
- **No weakening of the main preflight or the mock clamp** — both stay byte-identical.
- **No judge-model benchmark artifact** — the judge model is pinned as a revisable constant;
  a recorded comparison (srs-library-choice style) is explicitly skipped as overkill at
  cents-per-run stakes.
- **No `schedule:`, no notification channel** — same rule as the DDL diff (§5): an alarm
  nobody hears is not coverage.
- **No repeat-sampling for statistical power** — one run per case; a red is re-run once by
  hand before being believed (recorded as the calibration rule).

## Implementation Approach

Two-piece idiom the repo already owns, with the runner swapped to a second Vitest config
because the judge must import production `src/` code: `vitest.eval.config.ts` (duplicated
`getViteConfig()` wrapper, own include glob, own inverse preflight) collects
`evals/**/*.eval.ts`; support code lives under `evals/` (fixtures, judge client, pure
scoring); the pure scoring functions get ordinary deterministic unit tests in `tests/lib/`
(schema-drift precedent). The eval's red comes from judge-verdict thresholds plus two
catastrophic floors; count compliance and skip-rate are **reported, not gated** (first
measurement cannot be a blindly-tuned gate — but floors keep the eval falsifiable).

Matrix (10 cases, count=5 cards each):

| # | Path | Source language | `language` param | Expected card language |
|---|------|-----------------|------------------|------------------------|
| 1–5 | `auto` | PL, EN, ES, DE, FR | `auto` | = source language |
| 6–10 | forced | PL (one fixed text) | `polski`, `angielski`, `hiszpański`, `niemiecki`, `francuski` | = forced language |

Case 6 (`polski` on the PL source) is the identity **positive control**: a judge or prompt
that fails everything would fail it too, which is what separates "generation is broken" from
"the eval refuses everything" (the §6.6 positive-control discipline, applied to a new layer).

Thresholds (calibrated by the first recorded run, adjustable in Phase 3 with the change
documented): **language fidelity 100% per case** (hard — wrong language is a binary, serious
failure; the NFR names it first-class), **usability ≥80% aggregate across all judged cards
of the run** (tolerates temperature-0.4 noise on single cards). Floors: ≥1 card returned per
case; aggregate skip-rate <50%.

Judge: pinned `google/gemini-2.5-flash` (different family from the generator's
`openai/gpt-4o-mini` — avoids self-grading bias), `temperature: 0`, structured JSON verdict
per card, overridable via `EVAL_JUDGE_MODEL` env for experiments.

## Critical Implementation Details

- **The eval preflight is the INVERSE of the main one, and it is load-bearing.** With the key
  absent, `generateCandidates()` silently returns fixed Polish mock strings — a PL fidelity
  case passes vacuously and an ES case fails confusingly. The eval's `globalSetup` must
  `fail()` when the key is unset on EITHER seam: `OPENROUTER_API_KEY` imported from
  `astro:env/server` (the exact inlined value `generateCandidates()` sees — same-seam
  discipline, viable in a globalSetup as `tests/setup/preflight.ts` proves) AND
  `process.env.OPENROUTER_API_KEY` (the judge client's seam). The failure message prints the
  exact shell-env invocation shape, which satisfies both seams at once. Symmetrically,
  `npm test` red-on-key-set is the existing designed behavior — do not touch it.
- **The key must be in the environment at config load time** (`astro:env` transform-time
  inlining). Shell-env invocation only; the plan's documented commands are
  `OPENROUTER_API_KEY=… npx vitest run -c vitest.eval.config.ts` (bash) and
  `$env:OPENROUTER_API_KEY="…"; npx vitest run -c vitest.eval.config.ts` (PowerShell). A key
  in `.env` is NOT a supported alternative: it reaches only the generator's seam
  (`astro:env`), never the judge's (`process.env`), so the preflight rejects it — and it
  additionally makes the next ordinary `npm test` fail loudly (by design, not a bug). The
  config header comment says so.
- **Duplicate the config wrapper, do not refactor the main config.** ~15 lines of
  `withoutCloudflarePlugins` duplication with cross-referencing comments in both files is
  the deliberate trade: zero edits to the file that 207 green tests depend on. If the two
  ever drift, the eval config breaks loudly (alias/`astro:env` resolution fails), not
  silently.
- **One eval file, sequential cases.** Ten cases in a single `*.eval.ts` file run
  sequentially by default — deliberate, to avoid parallel-hammering the provider and to keep
  the verdict table readable. `testTimeout` 120 s per case (real LLM latency; no
  `SERVER_TIMEOUT_MS` constraint at lib level).
- **The judge client must not import `astro:env`** — it lives in `evals/lib/`, reads
  `process.env` directly, and calls OpenRouter over plain `fetch` (same URL constant imported
  from `@/lib/openrouter` so the two cannot drift). Structured outputs
  (`response_format: json_schema`) is the request shape; if `gemini-2.5-flash` via OpenRouter
  rejects it at the first live call, fall back to prompt-enforced JSON plus tolerant parsing
  — decide at implementation against the observed response, record which shape shipped.
- **Judge grades one card per call** (~50 calls/run) with the expected language stated in the
  judge prompt. Verdict schema: `{ language_ok: boolean, detected_language: string,
  usable: boolean, reason: string }`. The usability rubric (in the judge prompt): front is a
  clear question/prompt, back actually answers it, the pair is self-contained and grounded in
  the source text, no truncation artifacts.
- **Lint must cover `evals/`** — `npm run lint` is type-checked; if the ESLint/tsconfig
  project scope does not already include the new directory, extend it rather than exempting
  the files. `console.*` in `evals/` is legal (the no-logging guard scans `src/` only), and
  `no-console` is `warn`, which exits 0.

## Phase 1: Eval harness

### Overview

Stand up the run path: a second Vitest config that resolves production code, refuses to run
without a key, and is provably invisible to `npm test`.

### Changes Required:

#### 1. Eval Vitest config

**File**: `vitest.eval.config.ts` (new, repo root)

**Intent**: A `getViteConfig()`-based config (duplicated Cloudflare-strip wrapper,
cross-referenced comments both ways with `vitest.config.ts`) that collects only
`evals/**/*.eval.ts`, runs `evals/setup/eval-preflight.ts` as its sole `globalSetup`, and
sets `testTimeout`/`hookTimeout` to 120 s. Header comment documents the two invocation
shapes (bash + PowerShell) and why shell-env is the one supported form (a `.env` key feeds
only the `astro:env` seam, not the judge's `process.env`, and the preflight rejects it).

**Contract**: `include: ["evals/**/*.eval.ts"]`; no reference to `tests/setup/*`;
`environment: "node"`.

#### 2. Inverse preflight

**File**: `evals/setup/eval-preflight.ts` (new)

**Intent**: Fail the whole eval run, before any test, when the key is unset on either seam:
`OPENROUTER_API_KEY` imported from `astro:env/server` (the exact inlined value
`generateCandidates()` will see — same seam as the code under test; a globalSetup under a
`getViteConfig()` config is Vite-transformed, as `tests/setup/preflight.ts` proves daily)
AND `process.env.OPENROUTER_API_KEY` (the judge client's seam). The error message names the
vacuous-pass mechanism (mock mode returns fixed Polish strings) and the exact shell-env
invocation command, which satisfies both seams at once. Mirrors the `fail()` style of
`tests/setup/preflight.ts` without importing that file (it asserts Supabase seams the eval
does not touch).

**Contract**: default-exported async function; imports `OPENROUTER_API_KEY` from
`astro:env/server` AND reads `process.env.OPENROUTER_API_KEY`; throws when either is
missing; no network calls.

#### 3. Smoke eval case

**File**: `evals/generation-quality.eval.ts` (new, minimal in this phase)

**Intent**: One temporary smoke `it()` proving the wiring end-to-end cheaply:
`isOpenRouterConfigured()` (imported via `@/lib/openrouter`) returns `true` under this
config — which proves alias resolution, `astro:env` inlining and the preflight ordering in
one assertion, without a paid call. Replaced by the real matrix in Phase 3.

**Contract**: imports `@/lib/openrouter`; no fetch in this phase.

#### 4. npm script + lint scope

**File**: `package.json`; `eslint.config.js` / `tsconfig.json` only if needed

**Intent**: Add `"eval": "vitest run -c vitest.eval.config.ts"` so the invocation is
discoverable (`npm run eval` still requires the shell-env key — the preflight says so).
Verify `npm run lint` covers `evals/` and the new config; extend scope if it does not.

**Contract**: script name `eval`; no change to the `test` script.

### Success Criteria:

#### Automated Verification:

- `npm test` green with the eval files present and the key UNSET — suite count unchanged
  (207/207), zero eval files collected
- `npx vitest run -c vitest.eval.config.ts` with the key unset fails on the eval preflight
  with the documented message (red, before any test)
- Same command with a real key in the shell env: smoke case green
- `git diff` empty for `vitest.config.ts` and `tests/setup/preflight.ts`
- `npm run lint` exit 0; `npm run build` exit 0

#### Manual Verification:

- Read the eval-config header: both invocation shapes present and correct on this machine
  (PowerShell shape actually tried once)

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 2: Reference set, judge client, pure scoring

### Overview

Author the fixed reference set (5 languages), build the judge client and the pure
scoring/threshold functions, and cover the pure parts deterministically in the ordinary
suite.

### Changes Required:

#### 1. Reference texts

**File**: `evals/fixtures/reference-texts.ts` (new)

**Intent**: Five authored source texts (PL, EN, ES, DE, FR), each ~600–1000 characters,
factual, unambiguously in its language, and rich enough to yield 5 reasonable Q/A cards
(e.g. a short encyclopedic passage per language on distinct topics — distinct topics so a
cross-language contamination in a verdict is attributable). Exported as a typed record
keyed by language code, with the PL text doubling as the fixed source for the forced-path
cases.

**Contract**: `{ code: "pl" | "en" | "es" | "de" | "fr", text: string, topic: string }[]`
(exact shape implementer's choice); content stable — editing a text after calibration
invalidates recorded runs, say so in the header.

#### 2. Judge client

**File**: `evals/lib/judge.ts` (new)

**Intent**: One function grading one card: takes `{ front, back, sourceExcerpt,
expectedLanguage }`, calls OpenRouter with the pinned judge model
(`google/gemini-2.5-flash`, `temperature: 0`, `EVAL_JUDGE_MODEL` env override), returns the
parsed verdict. Reads `process.env.OPENROUTER_API_KEY`; imports `OPENROUTER_URL` from
`@/lib/openrouter` so the endpoint cannot drift. On a 429/5xx or transport error, retries
ONCE with a short backoff (a transient blip mid-run would otherwise abort after the 10 paid
generation calls); then, and immediately on any other HTTP/parse error, fails loudly
(throw) — an unreachable judge must never read as a verdict, and a retry is not a
substituted verdict.

**Contract**: `judgeCard(input): Promise<CardVerdict>` where
`CardVerdict = { language_ok: boolean, detected_language: string, usable: boolean, reason: string }`.
Structured-outputs request shape first; documented fallback to prompt-enforced JSON if the
provider rejects it (decided at first live call, recorded in verification.md).

#### 3. Pure scoring module

**File**: `evals/lib/scoring.ts` (new)

**Intent**: All decidable logic, no I/O: per-case metrics from a `GenerateResult`
(`countCompliance = cards.length / requested`, `skipRate = (generatedCount − cards.length) /
max(generatedCount, 1)`), verdict aggregation (per-case language pass = every card
`language_ok`; run-level usability rate), floor checks (≥1 card per case; aggregate
skip-rate <0.5) and the threshold evaluation returning a structured
`{ pass, failures: string[] }` plus the printable summary table rows.

**Contract**: pure functions over plain data; no `fetch`, no env reads — this is what makes
them unit-testable in the ordinary suite.

#### 4. Unit tests for scoring

**File**: `tests/lib/eval-scoring.test.ts` (new)

**Intent**: Deterministic tests of `evals/lib/scoring.ts` via relative import (the
`schema-drift.test.ts` precedent, §6.1's mirroring-rule clarification): threshold boundaries
(exactly 80% usability passes; one wrong-language card fails its case; empty card list trips
the floor; skip-rate 50% boundary), plus a positive control (an all-good run evaluates to
`pass: true` — without it every failure assertion is satisfied by a scorer that rejects
everything, the §6.6 discipline).

**Contract**: collected by `npm test` (ordinary include glob); no network, no DB beyond
what preflight requires anyway.

### Success Criteria:

#### Automated Verification:

- `npm test` green: new scoring unit tests pass alongside the existing suite
- `npm run lint` exit 0; `npm run build` exit 0

#### Manual Verification:

- Read the five reference texts once: each is unambiguously in its language and can honestly
  yield 5 Q/A cards (bad fixture = unattributable red later)
- Read the judge prompt: rubric matches the plan's usability definition; expected language is
  stated explicitly

**Implementation Note**: Pause for manual confirmation before Phase 3 — the fixture and
rubric review is what makes the calibration run interpretable.

---

## Phase 3: Matrix + first real run + calibration

### Overview

Replace the smoke case with the full matrix, wire floors/thresholds/reporting, run the eval
for real, and calibrate.

### Changes Required:

#### 1. The matrix

**File**: `evals/generation-quality.eval.ts` (rewrite)

**Intent**: Ten sequential cases per the matrix table (5× `auto` over each language's text,
5× forced over the fixed PL text), each: `generateCandidates({ sourceText, language,
count: 5 })` → floor check → `judgeCard` per returned card → per-case assertions (language
100%; floors) — plus one run-level `afterAll` aggregation asserting usability ≥80% and
aggregate skip-rate <50%, and printing the summary table (per case: expected vs detected
language, usable count, count compliance, skip-rate; judge model and generator model in the
header). Case 6 (`polski`×PL) commented as the positive control.

**Contract**: red comes only from: a floor, per-case language <100%, run usability <80%, or
an infrastructure throw. Count compliance is printed, never asserted. The summary must print
on failure too (report-then-assert ordering — the table is the diagnostic).

#### 2. First recorded run (no repo file — evidence goes to the change folder)

**File**: `context/changes/ai-candidate-generation-test-3/verification.md` (started here)

**Intent**: Run the eval with a real key; record verbatim: the summary table, wall-clock,
approximate cost, every judge verdict that was borderline, and the calibration decision
(thresholds kept / adjusted, with reasons). If a threshold changes, change it in
`scoring.ts` and re-run — the recorded pair (before/after) is the calibration evidence. Also
record which judge request shape shipped (structured outputs vs fallback). The calibration
rule to write down: a red case is re-run once by hand before being believed; two reds =
real.

**Contract**: verification.md carries at least one full green run (or an honestly-red run
with the finding it exposed — a real quality failure discovered here is a success of the
eval, not a blocker of the phase; record it and raise it as its own follow-up).

### Success Criteria:

#### Automated Verification:

- `npm run eval` (key in shell env) completes all 10 cases and exits with the verdict's code
- `npm test` still green and still collects zero eval files
- `npm run lint` exit 0

#### Manual Verification:

- Judge verdicts spot-checked by hand on at least one case per prompt path (do the `usable`
  / `language_ok` calls match a human read of those cards?) — recorded in verification.md
- Deliberate-breakage check, judge leg: point one case's `expectedLanguage` at the wrong
  language and confirm exactly that case goes red on the fidelity assertion (proves the
  judge observes the expectation, not an incidental pass); revert, confirm green
- Deliberate-breakage check, floor leg: temporarily set the skip-rate floor to an impossible
  bound and confirm the run-level assertion is what fires; revert

**Implementation Note**: Pause for manual confirmation — the calibration read-through is the
heart of the slice.

---

## Phase 4: Success-path audit columns (mock)

### Overview

Close the C10X-28-named gap in the ordinary suite: a successful generation writes the five
audit columns, asserted for the first time (both failure branches already are).

### Changes Required:

#### 1. Audit-columns success case

**File**: `tests/generation/generate.test.ts` (one new `it()`)

**Intent**: One mock-mode POST to `/api/generate` (existing §6.5 pattern: real endpoint,
real cookie, file-level namespace marker in `sourceText`), then read the session row back
with the owner's client and assert: `status = 'succeeded'`, `source_text` equals the
submitted text, `model` ends with `" (mock)"`, `language` equals the submitted value,
`request_payload` serialises to something containing the mock marker and the submitted
language, `response_payload` contains the generated card fronts, and
`generated_count = saved_count = count`. Serialized-column containment assertions, not JSON
paths — the C10X-28 precedent (pin presence, not shape).

**Contract**: goes in the existing resource file per §6.2 (no new file); scoped by the
file's namespace marker via `.like()` (never a long-body `.eq()` — the 414 trap).

### Success Criteria:

#### Automated Verification:

- `npm test` green with the new case; suite count grows accordingly
- `npm run lint` exit 0

#### Manual Verification:

- None — fully deterministic.

---

## Phase 5: Doc-sync

### Overview

Make the coverage claim, state its boundary, and leave no orphaned bookkeeping — the
discipline every prior phase followed.

### Changes Required:

#### 1. test-plan.md

**File**: `context/foundation/test-plan.md`

**Intent**: (a) §3 Phase 5 row → `complete`, dated, change folder linked. (b) New §6.6 entry
"Phase 5 (`ai-candidate-generation-test-3`, C10X-31, date)": claims table (what each matrix
case/floor/threshold proves), the deliberate-breakage results from Phase 3, and the
does-NOT-prove list — judge ≠ 75% acceptance metric; workflow leg deferred (named follow-up);
one run per case, no statistical power; judge verdicts are themselves an LLM's opinion,
calibrated once by hand; `npm test` never touches the real provider (unchanged). (c) §5
LLM-as-judge gate row rewritten from "CI, nightly or on generation-path changes" to
**local-only, human-triggered, no schedule** — mirroring the DDL-diff row's wording (the
current wording would be false the day this ships). (d) §4 AI-native row: judge model,
invocation, new `checked:` date. (e) §8 Freshness Ledger entry with the suite count and the
calibration-run date. (f) A §6.x cookbook subsection is NOT added unless the implementer
finds a trap worth it — the eval is not part of `npm test` and §6's contract is "how to add
tests to the suite"; the §6.6 entry carries the knowledge instead.

**Contract**: §2 Risk #7 row gains the **Covered** marker with the same
boundary-in-the-same-breath style as Risks #4–#6.

#### 2. Roadmap row

**File**: `context/foundation/roadmap.md`

**Intent**: Add an `H-06` row for this work (test-plan Phase 5 maps onto no slice) —
**before** archiving, per the H-04 precedent research names. Outcome only; the Status→done
flip belongs to `/10x-archive` (lessons.md rule).

**Contract**: row exists on `main` before `/10x-archive` runs for this change.

#### 3. Deferred-workflow note

**File**: within the two files above (no new file)

**Intent**: The deferred `workflow_dispatch` leg is named in the §6.6 does-NOT-prove list
and in the roadmap row's Outcome as an explicit follow-up (to be ticketed via
`/jira-backlog-sync`; include the OpenRouter capped-key mitigation — separate key with a low
credit limit — so the security reasoning from planning is not lost).

**Contract**: a reader of either doc can tell the eval runs only when a human runs it, and
why that was chosen.

### Success Criteria:

#### Automated Verification:

- `npm test` green (docs only — run as the no-regression control)
- `npm run lint` exit 0

#### Manual Verification:

- §2 row, §3 row, §5 row, §6.6 entry and §8 entry read consistently (the §2-vs-§6.6
  two-places rule from C10X-29: coverage claim vs mechanism, written to agree)

---

## Testing Strategy

### Unit Tests:

- `tests/lib/eval-scoring.test.ts` — threshold boundaries (80% usability edge, one-bad-card
  language fail, empty-list floor, 50% skip-rate edge) + all-good positive control.
- The judge client is deliberately NOT unit-tested — it is I/O against a live credential,
  the same reasoning that leaves `scripts/check-schema-drift.ts` untested (§6.6 C10X-29).

### Integration Tests:

- `tests/generation/generate.test.ts` — the success-path audit-columns case (mock,
  deterministic).

### Eval (new layer, not part of `npm test`):

- 10-case matrix, thresholds and floors per Phase 3; two deliberate-breakage checks with
  reverts; first run recorded as calibration evidence.

### Manual Testing Steps:

1. Phase 1: run both invocation shapes; confirm the no-key red and the with-key green.
2. Phase 2: read the five reference texts and the judge rubric.
3. Phase 3: spot-check judge verdicts against a human read; execute both breakage checks.

## Performance Considerations

One full eval run ≈ 10 generation calls (gpt-4o-mini, ~1–2k tokens each) + ~50 judge calls
(gemini-2.5-flash, small) — cost in cents, wall-clock roughly 1–3 minutes sequential.
Bounded by review effort, not money (research Q3). No impact on `npm test` wall-clock.

## Migration Notes

No migrations, no schema changes, no `src/` changes. Rollback = delete the new files; the
ordinary suite's two new tests are additive.

## References

- Research: `context/changes/ai-candidate-generation-test-3/research.md`
- Config to mirror: `vitest.config.ts:13-41`; clamp to leave untouched:
  `tests/setup/preflight.ts:110-118`
- Prompt under test: `src/lib/openrouter.ts:98-111`; whitelist:
  `src/lib/generation-limits.ts:43`
- Precedents: `tests/lib/schema-drift.test.ts` (unit-testing a non-`src/` module);
  `.github/workflows/schema-diff.yml` (the deferred workflow leg's template);
  `context/archive/2026-07-26-ai-candidate-generation-test-2/verification.md:653-661`
  (the hand-off naming this slice's two gaps)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do
> not rename step titles. See `references/progress-format.md`.

### Phase 1: Eval harness

#### Automated

- [ ] 1.1 `npm test` green with eval files present, key unset, suite count unchanged, zero eval files collected
- [ ] 1.2 Eval run with key unset fails on eval preflight with the documented message
- [ ] 1.3 Eval run with real key: smoke case green
- [ ] 1.4 `git diff` empty for `vitest.config.ts` and `tests/setup/preflight.ts`
- [ ] 1.5 `npm run lint` exit 0; `npm run build` exit 0

#### Manual

- [ ] 1.6 Both invocation shapes verified from the config header (PowerShell shape tried)

### Phase 2: Reference set, judge client, pure scoring

#### Automated

- [ ] 2.1 `npm test` green incl. new scoring unit tests
- [ ] 2.2 `npm run lint` exit 0; `npm run build` exit 0

#### Manual

- [ ] 2.3 Five reference texts reviewed (language-unambiguous, card-worthy)
- [ ] 2.4 Judge rubric reviewed against the plan's usability definition

### Phase 3: Matrix + first real run + calibration

#### Automated

- [ ] 3.1 `npm run eval` completes all 10 cases and exits with the verdict's code
- [ ] 3.2 `npm test` still green, still collects zero eval files
- [ ] 3.3 `npm run lint` exit 0

#### Manual

- [ ] 3.4 Judge verdicts spot-checked (≥1 case per prompt path), recorded in verification.md
- [ ] 3.5 Breakage check: wrong `expectedLanguage` → exactly that case red; reverted
- [ ] 3.6 Breakage check: impossible skip-rate floor → run-level assertion fires; reverted
- [ ] 3.7 First run recorded in verification.md (table, cost, wall-clock, calibration decision, judge request shape)

### Phase 4: Success-path audit columns (mock)

#### Automated

- [ ] 4.1 `npm test` green with the new audit-columns case
- [ ] 4.2 `npm run lint` exit 0

### Phase 5: Doc-sync

#### Automated

- [ ] 5.1 `npm test` green (no-regression control)
- [ ] 5.2 `npm run lint` exit 0

#### Manual

- [ ] 5.3 §2/§3/§5/§6.6/§8 read consistently; roadmap H-06 row present before archive
