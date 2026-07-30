<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Order-Independent Test Suite + `sequence.shuffle`

- **Plan**: context/changes/flashcards-test-order/plan.md
- **Mode**: Deep
- **Date**: 2026-07-29
- **Verdict**: REVISE → SOUND after triage (all 3 findings fixed in plan.md, 2026-07-29)
- **Findings**: 1 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

8/8 paths ✓. All cited line anchors verified against HEAD `ea77584`: `A_FRONT` at flashcards.test.ts:25/:145/:160/:194, mutator :204-212, precondition :278, transition control :310-315; candidates.test.ts audit seed :649-665, read :697, rewrite :741-745; study.test.ts canary :871-879. Both Vitest configs confirmed to carry no `sequence` key. Helpers the fixes need exist (`createDeck`, `createCard` (writes accepted), `loadSession`, `seedGenerationSession` — the last already used inside `it()`s at :482/:570, so reusable). No account-wide `generation_session` count exists in candidates.test.ts that a second seeded session could break. brief↔plan ✓.

## Findings

### F1 — Fix #1's owned card, placed in the SHARED deck, re-breaks the denials on their `toHaveLength(1)` assertions

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1, Change #1 (pairs #1–#3), Contract
- **Detail**: The contract says "Inside the `it()`, create a fresh card in A's deck … edit *that* card" and promises "all three denial assertions stay byte-identical". But each of the three denial cases asserts `expect(cards).toHaveLength(1)` on the shared deck BEFORE the `cards[0].front === A_FRONT` line the plan names (flashcards.test.ts:144, :159, :193). A second card created in the shared `aDeckId` (manual create writes `accepted`, so `listFlashcards` returns it) fails the length assertion in every permutation where the control precedes a denial — the exact class this change exists to remove, reintroduced by its own fix. The F1 precedent the plan cites already encodes the answer: the "Control deck" comment at generate.test.ts:371-374 says verbatim "Its own deck, deliberately: … generating into the shared one would make that assertion depend on the order vitest happens to run these it() blocks in." Compounding trap: the brief primes the implementer to read a fresh red as "a 7th, unlisted pair (that's signal, not failure)", so a red caused by this fix would likely be misread as a new discovery.
- **Fix**: Reword Contract #1: the positive control creates its own card in its OWN deck (full "Control deck" F1 form), and name the reason — the three denials assert `toHaveLength(1)` on the shared deck at :144/:159/:193, so any card added there is itself an order dependence.
- **Decision**: FIXED (fix applied to plan.md Contract #1)

### F2 — Contract #2 (pair #4) uses the same ambiguous "in A's deck" wording — safe today, but only by accident

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, Change #2 (pair #4), Contract
- **Detail**: "Create an own accepted card in A's deck" — verified: describe 2 carries NO length assertion on A's batch deck (the only count is `cardsOf(b, bDeckId)).toHaveLength(0)` at :304, and both denials read the shared card keyed by `public_id` via `rowOf`), so a card added to the shared batch deck breaks nothing today. But the safety is a property of what describe 2 happens not to assert, not of the fix. Same wording as F1, opposite outcome.
- **Fix**: Either specify an own deck here too (uniform rule), or keep the shared deck and say in the contract WHY it is safe (no deck-level count on A's side), so a future case added to that describe doesn't silently invalidate it.
- **Decision**: FIXED (uniform own-deck rule applied to plan.md Contract #2, with the "why" recorded)

### F3 — Policy for a red FRESH run lives only in the brief

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, Success Criteria ("Ten fresh unpinned runs")
- **Detail**: plan-brief.md states the policy — a fresh seed surfacing an unlisted order dependence is "a finding to fix in-change, not a blocker" — but plan.md's criterion reads only "×10 → all 220/220". An implementer working from the plan (the normative document) hits a red fresh run with no stated procedure, in a change whose whole point is that fresh seeds CAN surface new pairs (that is why #2 and #6 are called latent).
- **Fix**: Copy the one-sentence policy into Phase 2 (fix in-change with the F1 pattern, record the seed in verification.md, re-run the matrix).
- **Decision**: FIXED (policy added to the Phase 2 "Ten fresh unpinned runs" criterion in plan.md)
