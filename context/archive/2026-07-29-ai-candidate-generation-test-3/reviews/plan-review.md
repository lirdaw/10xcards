<!-- PLAN-REVIEW-REPORT -->
# Plan Review: AI-Native Generation Quality Eval (Risk #7, test-plan §3 Phase 5)

- **Plan**: `context/changes/ai-candidate-generation-test-3/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-29
- **Verdict**: REVISE (both fixes are cheap — SOUND once applied)
- **Post-triage verdict**: SOUND — all three findings fixed in the plan (2026-07-29)
- **Findings**: 1 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL (one mechanical finding) |

## Grounding

8/8 paths ✓, 10/10 symbols ✓ — verified directly against the files: `vitest.config.ts:26`
(`include` replacement) and `:31` (`globalSetup` binds per-config); `tests/setup/preflight.ts:110-118`
(`assertMockGeneration`, no env opt-out); `src/lib/openrouter.ts:98-111` (two prompt paths),
`:114-119` (`mockCards` fixed Polish strings), `:177` (`temperature: 0.4`), exported
`OPENROUTER_URL` and `isOpenRouterConfigured`; `src/lib/generation-limits.ts:43` (6-value
`LANGUAGES` whitelist); `src/pages/api/generate.ts:286-299` (success-path audit-column write);
`tests/lib/schema-drift.test.ts:5` (relative-import precedent); `eslint.config.js` (`eslint .`
with `projectService`) + `tsconfig.json` `include: ["**/*"]` → `evals/` covered automatically;
`package.json` `test: "vitest run"`; roadmap H-01..H-05 taken, H-06 free, H-04 precedent
confirmed. Brief↔plan consistent. `docs/reference/contract-surfaces.md` absent → check skipped.
Blast radius minimal: all-new files plus a `package.json` script and doc edits.

## Findings

### F1 — `## Progress` phase headings do not match the body phase headings (4 of 5)

- **Severity**: ❌ CRITICAL (mechanical contract, progress-format.md)
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: `## Progress` vs `## Phase 1–4` headers
- **Detail**: progress-format.md requires `### Phase N: <name>` in Progress to match the
  `## Phase N: <name>` headers in the body. Four of five are abbreviated:
  Phase 1 "Eval harness — second config, inverse preflight, collection proof" → "Eval harness";
  Phase 2 "…pure scoring + its unit tests" → "…pure scoring";
  Phase 3 "The 10-case matrix + first real run + calibration" → "Matrix + first real run + calibration";
  Phase 4 "Success-path audit columns — deterministic mock test" → "Success-path audit columns (mock)".
  The Success-Criteria↔Progress item mapping (1.1–5.3) is complete and correct (extra 3.7 is legal).
- **Fix**: Align the names 1:1 — cheapest is to shorten the body phase headers to the Progress
  versions (or vice versa).
- **Decision**: FIXED — body phase headers 1–4 shortened to match Progress verbatim.

### F2 — The eval preflight reads a different seam than the code under test

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots (internal contradiction in the plan)
- **Location**: Phase 1 #2 (inverse preflight) vs Critical Implementation Details ("A key in
  `.env` also works")
- **Detail**: The eval preflight is specified to read `process.env.OPENROUTER_API_KEY`, while
  `generateCandidates()` sees the `astro:env`-inlined value captured at config-load time —
  which includes `.env` via loadEnv (proof: the main preflight imports from `astro:env/server`
  and demonstrably catches a key left in `.env`). Vite/loadEnv does not write `.env` values
  into `process.env`, so a key present only in `.env` → the eval preflight refuses ("key
  unset") even though the generator would run live — directly contradicting the plan's
  "A key in `.env` also works but is discouraged". The dangerous direction (preflight passes
  while the generator is mock) cannot occur — shell env reaches both seams — so this is a
  false refusal plus a false doc sentence, not a vacuous pass. The plan's stated reason for
  avoiding the `astro:env` import does not hold: globalSetup files ARE Vite-transformed under
  a `getViteConfig()` config — `tests/setup/preflight.ts` does exactly this today.
- **Fix A ⭐ Recommended**: The eval preflight imports `OPENROUTER_API_KEY` from
  `astro:env/server`, exactly like the main preflight.
  - Strength: The check observes exactly the value `generateCandidates()` will see — seam
    divergence impossible by construction; the ".env also works" sentence becomes true.
    Working precedent in-repo.
  - Tradeoff: The preflight depends on config resolution — a broken eval config surfaces as a
    resolution error instead of the friendly message.
  - Confidence: HIGH — the mechanism is proven by the main preflight.
  - Blind spot: None significant.
- **Fix B**: Keep the `process.env` read; delete/invert the ".env also works" sentence and
  document shell-env as the ONLY supported path.
  - Strength: Preflight stays dependency-free; zero resolution risk.
  - Tradeoff: The seam divergence remains — a future `.env`-key user hits a confusing false
    refusal; the protection is documentation-only.
  - Confidence: MED — correct but more fragile.
  - Blind spot: Whether some Astro version mutates `process.env` after loadEnv — unverified
    either way.
- **Decision**: FIXED via Fix A, extended during triage: the preflight asserts BOTH seams —
  `OPENROUTER_API_KEY` imported from `astro:env/server` (generator) AND
  `process.env.OPENROUTER_API_KEY` (judge client) — because a `.env`-only key would feed the
  generator but leave the judge without credentials mid-run. The ".env also works" sentence
  was inverted accordingly (`.env` is now documented as rejected by the preflight), in
  Critical Implementation Details, Current State Analysis, Phase 1 #1 (config header) and
  Phase 1 #2 (intent + contract).

### F3 — One transient judge error kills the whole run after the paid generation calls

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 #2 (judge client: "Fails loudly (throw)")
- **Detail**: ~50 sequential judge calls per run — a single 429/5xx mid-run aborts after the
  10 paid generation calls already went out. The "a red is re-run once by hand" rule covers
  it and the cost is cents, so acceptable; one bounded retry with backoff on 429/5xx in
  `judge.ts` would be cheap and does not weaken "an unreachable judge must never read as a
  verdict" (a retry is not a substituted verdict).
- **Fix**: Add one bounded 429/5xx retry to the `judge.ts` contract in Phase 2 — or
  consciously accept (the manual re-run rule already covers it).
- **Decision**: FIXED — Phase 2 #2 intent now specifies one bounded retry with short backoff
  on 429/5xx/transport errors, then throw; other HTTP/parse errors throw immediately.
