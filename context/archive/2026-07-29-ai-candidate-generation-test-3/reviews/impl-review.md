<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI-Native Generation Quality Eval (Risk #7, test-plan §3 Phase 5)

- **Plan**: context/changes/ai-candidate-generation-test-3/plan.md
- **Scope**: Full plan (Phases 1–5 of 5, all complete)
- **Date**: 2026-07-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence summary

- **Plan drift**: 12/13 planned items MATCH; drift is documented where it exists. The two
  judge-client deviations (truncated-verdict class retried twice with 3 s/10 s backoff;
  `reasoning: { enabled: false }` + `max_tokens: 1000`) are recorded in verification.md
  WITH the measurements that forced them. The sync-not-async preflight carries its lint
  rationale in-file. One letter-of-the-plan omission is F4 below. No scope creep beyond
  documented in-scope extras (`cardLog`, `topic` field, 7 extra scoring unit cases,
  `mark`/`scope` extraction), no missing items, no `src/` changes (git-verified).
- **Success criteria re-run at review time**: `npm test` **220/220, 18 files**, zero eval
  files collected; `npm run lint` exit 0 (5 `no-console` warnings in `evals/`, legal by
  design); `npm run build` exit 0; `git diff main...HEAD` empty for `vitest.config.ts`
  and `tests/setup/preflight.ts`; worktree clean. The eval run itself (criterion 3.1) was
  not re-executed (paid key, human-triggered by design) — accepted on the recorded
  evidence in verification.md (exit 1, table, cost, both breakage checks with observed
  failure strings and verified reverts).
- **Security**: the key travels only in the `Authorization` header (judge request body
  never references it); no code path logs, persists, or embeds it; preflight prints
  invocation shapes with a placeholder only; retried requests reuse the same string body.
- **Correctness**: scoring math division-guarded and fail-closed (`runUsabilityRate([])`
  → 0 → red); boundary semantics (≥ 0.8 passes at exactly 80%; ≥ 0.5 skip-rate fails at
  exactly 50%) pinned by the unit tests including operator direction; matrix
  `expectedLanguage` wiring verified on both prompt paths and breakage-checked; the
  `"run:"` prefix coupling between the eval's afterAll and scoring.ts is load-bearing but
  safe — the unit tests assert the exact strings, so a rename goes red in `npm test`.

## Findings

### F1 — No per-request timeout on the eval's two fetch seams

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability / diagnosability)
- **Location**: evals/generation-quality.eval.ts:86-90; evals/lib/judge.ts:107
- **Detail**: `generateCandidates` accepts an optional `AbortSignal` (production passes
  one at `SERVER_TIMEOUT_MS` 40 s) but the eval calls it without one, and the judge fetch
  carries no signal at all. A stalled socket is bounded only by the 120 s `testTimeout`,
  so it eats the whole case budget and reports as a generic "Test timed out" instead of
  the labelled generator/judge failure the error contract is otherwise careful about.
- **Fix**: Pass `signal: AbortSignal.timeout(...)` to `generateCandidates` (the seam
  already exists) and add one to the judge fetch inside `postWithOneRetry`.
- **Decision**: FIXED — `GENERATOR_TIMEOUT_MS = 60_000` on the eval's call (below the
  120 s testTimeout, comment says why), `JUDGE_TIMEOUT_MS = 30_000` fresh per attempt in
  `postWithOneRetry` (a timeout abort lands in the transport catch → transient retry).

### F2 — `Math.round` can print a self-contradictory threshold failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (correctness of the diagnostic)
- **Location**: evals/lib/scoring.ts:80-82, :107
- **Detail**: `pct` rounds, so a run at e.g. 39/49 usable (79.59%) fails correctly but
  prints `run: usability 80% below the 80% threshold`. Reachable in practice: any case
  returning 4 cards makes the judged denominator 49. The comparison uses the raw number
  and is correct; only the message misleads — and this eval's contract is "run it, read
  the table", so the message is the product.
- **Fix**: Include the raw fraction in the failure string (e.g. `39/49 = 79.6%`) or floor
  instead of rounding in `pct` for failure messages.
- **Decision**: FIXED — `fractionPct()` added; both run-level failure strings now read
  `<num>/<den> = <one-decimal>%` (thresholds keep the exact-constant `pct()`); the two
  exact-string unit assertions updated in `tests/lib/eval-scoring.test.ts`.

### F3 — Infrastructure throw omits the case from the summary table

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (completeness of the diagnostic)
- **Location**: evals/generation-quality.eval.ts:86-119 (comment at :76-79)
- **Detail**: `results.push` (:112) runs after `generateCandidates()` (:86) and the
  `judgeCard` loop (:98). If either throws (a sanctioned red path), the `it()` dies
  before the push, so the afterAll table shows 9 rows for a 10-case run with nothing
  marking the hole. No false green is possible — the thrown `it()` is red and Vitest
  names it — but the comment at :76-79 claims "the afterAll table includes red cases
  too", which is true only for assertion-reds, not throw-reds. Same class as the
  test-plan's "no silent caps" rule.
- **Fix**: In afterAll, log a `MISSING (threw): <name>` line for any matrix case absent
  from `results` (compare against `MATRIX`); narrow the :76-79 comment.
- **Decision**: FIXED — afterAll now prints
  `<name> — MISSING (threw before judging completed; see its test failure)` for every
  matrix case absent from `results`; the accumulator comment narrowed to
  "ASSERTION-red cases" with the throw path named.

### F4 — Config cross-reference is one-way; plan said both ways

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: vitest.config.ts (grep "eval": zero hits); vitest.eval.config.ts:26-34
- **Detail**: The plan asked for "cross-referencing comments in both files"; only the
  eval config points at `vitest.config.ts`. The omission is consistent with the stronger
  contract that won — this change's own claim that `vitest.config.ts` stays
  byte-identical (criterion 1.4, §6.6 entry) — but the decision to drop the
  back-reference is recorded nowhere. Cost is navigational: a future editor of
  `vitest.config.ts` won't learn from that file that a twin wrapper exists and must be
  mirrored; the protection is behavioural only (the eval config breaks loudly on drift).
- **Fix**: One line in verification.md recording the choice now; the back-reference
  comment itself can ride along with the next legitimate edit to `vitest.config.ts`
  (adding it today would contradict the recorded byte-identical claim).
- **Decision**: FIXED — decision paragraph added to verification.md (one-way reference
  deliberate, back-reference deferred to the next legitimate `vitest.config.ts` edit).

### F5 — Judge HTTP error message embeds up to 300 chars of upstream response body

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (hygiene, not a leak)
- **Location**: evals/lib/judge.ts (non-2xx throw path)
- **Detail**: On a non-2xx judge response the thrown error includes a slice of the
  upstream body. OpenRouter error bodies can echo request metadata but never the key, and
  the eval is local-only with output read by the human who ran it — acceptable today.
  Worth remembering when the deferred `workflow_dispatch` leg lands: in CI that message
  reaches a world-readable log (the concern C10X-29's F3 fixed for the DDL diff body).
- **Fix**: No change now; when the CI leg is built, route the excerpt to an artifact, not
  the log (the schema-diff.yml precedent).
- **Decision**: FIXED — behaviour unchanged (correct locally); a warning comment now sits
  on the non-2xx throw site naming the CI-leg constraint (artifact, not job log), so the
  builder of the deferred workflow_dispatch leg meets it in the code they will touch.

## Triage outcome (2026-07-29)

All five findings FIXED in triage: F1 (per-request timeouts on both fetch seams), F2
(fraction-carrying failure messages + updated exact-string unit assertions), F3 (MISSING
line in afterAll + narrowed accumulator comment), F4 (one-way-reference decision recorded
in verification.md), F5 (warning comment on the non-2xx throw site; behaviour unchanged).
Post-fix verification: `npm test` 220/220 (one transient red of the known flake class from
verification.md appeared once and passed on immediate re-run; no changed file involved —
eval files are not collected and `eval-scoring.test.ts` was green in every run);
`npx vitest run tests/lib/eval-scoring.test.ts` 12/12; `npm run lint` exit 0 (6
`no-console` warnings in `evals/`, +1 from the new MISSING line, legal by design).

## Notes for the record

- Transitive `astro:env` edge: `judge.ts` imports `OPENROUTER_URL` from
  `@/lib/openrouter`, which pulls `astro:env/server` into its module graph. The judge
  reads only `process.env`; the import exists to prevent URL drift and means judge.ts can
  only execute under a Vite/astro-transform config — currently guaranteed. Do not write
  "the preflight is the only astro:env consumer under evals/" anywhere; it would be false.
- `countCompliance` with `requestedCount: 0` returns a nonsense value (guard prevents
  NaN only); pinned by a unit test, unreachable in the matrix, metric reported-never-gated.
- The judge rubric states the expected language as the Polish exonym — the same
  construction that breaks the generator's forced path. Deliberate (same wording as
  production) and evidence-mitigated: calibration runs show the judge detecting de/fr
  failures correctly, and the breakage check flipped a case on this very field. If the
  generator prompt is later fixed to English/native names, revisit the judge wording too.
