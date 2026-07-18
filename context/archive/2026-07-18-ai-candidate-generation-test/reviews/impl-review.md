<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Characterization test — retry after generation timeout duplicates candidates

- **Plan**: `context/changes/ai-candidate-generation-test/plan.md`
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-07-18
- **Verdict**: NEEDS ATTENTION
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

## Success criteria — verified this review

| Check | Result |
|---|---|
| `npx astro sync` produces no diff | PASS — clean tree after run |
| `npm run lint` | PASS — no errors |
| `npm test` | PASS — 5 files, 18 tests; all 3 generation cases present and green |
| `npm test` twice in a row, no DB reset | PASS — green both runs |
| No production code committed | PASS — `git diff 49f1f65^..HEAD -- src/` is empty |

## Findings

### F1 — Test 1's card assertions are order-dependent on Test 2 sharing the deck

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/generation/generate.test.ts:121-123 (vs :130-135)
- **Detail**: `cardsOf(deckPublicId)` counts *every* card in the deck. Test 1 asserts
  `new Set(generation_id).size === 2` and `cards).toHaveLength(2 * COUNT)`. Test 2
  ("positive control") generates a third batch into the **same** `deckPublicId`
  (shared via `beforeAll` at :100-104), adding `COUNT` more cards under a third
  `generation_id`. Test 1 passes only because vitest runs `it()` blocks in declaration
  order. Under `sequence.shuffle`, a `.only` on test 2, or any future reordering, Test 1
  sees 9 cards and a set size of 3, and fails for a reason unrelated to the bug it
  characterizes. This directly contradicts the file's own header claim (:36-38) that
  counts are scoped by source_text *and* by this run's own deck — the deck is not
  exclusive to Test 1. Cross-run and cross-file pollution are genuinely handled
  (`provisionAccounts` mints a per-run account, `suffix` uniquifies every text and deck
  name); this is the only history dependence found.
- **Fix**: Give the positive control its own deck — `createDeck(\`Control deck ${suffix}\`)`
  in Test 2 — so Test 1's deck holds only its own two generations.
  - Strength: Restores the double-scoping the header already promises; one added line,
    no change to any assertion or oracle.
  - Tradeoff: One extra deck row per run. Negligible.
  - Confidence: HIGH — verified `deckPublicId` is shared via `beforeAll` and reused at :131.
  - Blind spot: None significant.
- **Decision**: FIXED — the positive control now creates its own `Control deck ${suffix}`.
  Verified: `npx vitest run --sequence.shuffle tests/generation/generate.test.ts` is green
  on three consecutive runs, and the full suite is green in declaration order.

### F2 — Preflight does not guard OPENROUTER_API_KEY; a set key makes `npm test` bill real LLM calls

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/setup/preflight.ts:107-115 (assumption stated at tests/generation/generate.test.ts:23-32)
- **Detail**: The suite's determinism rests entirely on mock mode, and the test header
  states it as fact ("OPENROUTER_API_KEY is unset locally and in CI"). Nothing enforces
  it. `preflight.ts` hard-asserts the anon key and pins Supabase to `127.0.0.1`/`localhost`
  with a deliberate no-opt-out policy, but says nothing about `OPENROUTER_API_KEY` — and
  `.env.example:12-16` actively documents setting it. A developer who sets that key to
  verify generation, then runs `npm test`, gets 4 real billed calls to `openrouter.ai`
  carrying the test source text (the one non-local backend the suite can still reach),
  plus assertions that become model-dependent (`toHaveLength(2 * COUNT)` only holds for
  `mockCards(count)`) and a timeout inversion (`SERVER_TIMEOUT_MS` 40 s > `testTimeout`
  30 s). This is the same class as the accepted lessons.md rule "Test preflight must
  assert the target host is local — anon ≠ local": a preflight that fails open on the
  developer's own machine.
- **Fix**: In `preflight.ts`, alongside `assertLocal`, `fail()` when `OPENROUTER_API_KEY`
  is set, with the same no-env-opt-out reasoning. CI is unaffected — `ci.yml` never sets it.
  - Strength: Closes the last non-local seam the suite can reach and makes the test
    header's stated precondition enforced rather than asserted in prose.
  - Tradeoff: A developer who legitimately wants a live-generation run must edit code —
    which is the same deliberate friction the existing local-host rule already chose.
  - Confidence: HIGH — grepped `preflight.ts`; no OPENROUTER reference exists.
  - Blind spot: Whether anyone's local workflow currently keeps the key set and relies on
    `npm test` still running.
- **Decision**: FIXED + ACCEPTED-AS-RULE: "Preflight musi domknąć KAŻDY nielokalny szew,
  nie tylko bazę" (lessons.md). `assertMockGeneration()` added to `tests/setup/preflight.ts`
  and wired into `preflight()` after `assertLocal`. Verified by deliberate breakage:
  `OPENROUTER_API_KEY=… npx vitest run` aborts the whole run on preflight with the new
  message; unset, the suite is 18/18 green. `npm run lint` clean.

### F3 — `Content-Type: application/json` is applied to any non-FormData body

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/fixtures/endpoint.ts:65-67
- **Detail**: No regression today — all existing callers pass `FormData` or no body, and
  the `body !== undefined` guard keeps bodyless calls header-free. The residual hazard is
  `URLSearchParams`, the natural reach for a form-POST test without multipart: `Request`
  would derive `application/x-www-form-urlencoded`, the fixture overwrites it with
  `application/json`, and the endpoint's `request.formData()` throws — surfacing as a
  baffling 400/500 rather than a wiring error.
- **Fix**: Narrow the condition to `typeof body === "string"` — identical behavior today,
  matching the doc comment's actual contract, no silent mislabeling later.
- **Decision**: FIXED — condition narrowed to `typeof body === "string"`; the `body` doc
  comment now says "pass anything else and it is not" rather than naming only FormData.
  Suite 18/18 green, lint clean.

### F4 — plan.md's stated rationale for double-scoping is wrong and was silently corrected in the shipped code

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/ai-candidate-generation-test/plan.md:78-80, :116-118
- **Detail**: The plan's Key Discoveries justified double scoping with "accounts are shared
  across the run and the suite deliberately does not `db:reset`". That rationale is
  factually wrong: `provisionAccounts` mints a fresh `runId` per run
  (`tests/fixtures/accounts.ts:71-74`), so cross-run pollution was never the threat.
  Commit 7925640 rewrote the test header and §6.5 to say the real threat is *within* a run
  (the three `it()`s share account A) — the correct diagnosis. Behavior is unchanged and
  still double-scoped. This is an improvement, not drift, but the plan text now contradicts
  the shipped code and §6.5, and a future reader trusting the plan would carry the wrong
  model of `accounts.ts`.
- **Fix**: Add a one-line correction note to plan.md:78-80 pointing at §6.5's within-a-run
  reasoning, so the plan does not outlive its own error.
- **Decision**: FIXED — dated correction notes added at both plan.md sites (Key Discoveries
  and Critical Implementation Details), each stating that the conclusion stands and only the
  rationale changed, and pointing at test-plan.md §6.5. The second note also records the F1
  consequence (the positive control needs its own deck).

### F5 — AGENTS.md still claims no test suite exists

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: AGENTS.md (Commits section, last line)
- **Detail**: AGENTS.md reads "No test suite is configured yet — add one before relying on
  `npm test`." That became false in Phase 1 of the rollout (`verification-harness`) and is
  now doubly false: `npm test` runs 18 tests across 5 files and is a CI gate. AGENTS.md is
  precisely the file a freshly-cleared agent reads to decide whether to run tests — the
  accepted lessons.md rule "Put commit conventions in AGENTS.md, not context memory" rests
  on that file being accurate. Predates this change; surfaced by it.
- **Fix**: Replace the sentence with the real command and the local-stack precondition
  (`npm test`, requires `npm run db:start`), pointing at `context/foundation/test-plan.md` §6.
- **Decision**: FIXED — stale sentence removed from the Commits section; `npm test` added to
  `## Commands` with the `db:start` precondition, both preflight aborts (non-local
  `SUPABASE_URL`, set `OPENROUTER_API_KEY`), and an `@context/foundation/test-plan.md` §6
  pointer for how to add a test.

### F6 — Same order-dependence class already live in flashcards.test.ts (out of scope)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/isolation/flashcards.test.ts:193
- **Detail**: Surfaced while verifying the F1 fix. `npx vitest run --sequence.shuffle` fails
  on `refuses B's own deck paired with A's card id`: it asserts `cards[0].front` is `A_FRONT`,
  but the later `still lets A edit A's own card` case mutates that same card to
  `A's edited front …`. In declaration order the mutation happens after, so the suite is
  green; shuffled, it fails. Identical class to F1, but the file belongs to Phase 1
  (`verification-harness`, already archived) — outside this change's scope, so it is
  recorded rather than fixed here.
- **Fix**: Give the edit case its own card (or assert against the card it actually owns), then
  consider enabling `sequence.shuffle` in `vitest.config.ts` so this class fails loudly
  instead of waiting for a reorder.
  - Strength: Makes the isolation suite's own guarantees order-independent — the suite whose
    entire purpose is to be trustworthy about denial.
  - Tradeoff: Touches an archived phase's test file; needs its own change folder to stay
    within the rollout's bookkeeping.
  - Confidence: HIGH — reproduced directly; failure output captured during this review.
  - Blind spot: Whether other suites hide the same class behind declaration order — only the
    shuffled run's single failure was investigated.
- **Decision**: DEFERRED — out of scope for this change; carry into §3 Phase 2's remaining
  work or open its own change.

## Notes

- `change.md` terminal status reads `implemented` where plan §Phase 3 item 4 said
  `complete`. `implemented` is the value the orchestrator's vocabulary actually uses
  (`{implementing, implemented}`), so the code is right and the plan text was wrong. Not
  raised as a finding.
- Phase 2's manual verification (the inverted deliberate-breakage check) is documented with
  a concrete observed result in test-plan.md §6.5:316-324 — "2 expected, 1 received", not a
  500 and not a timeout, with the revert confirmed and the production edit never committed.
  That is real evidence, not a rubber stamp.
