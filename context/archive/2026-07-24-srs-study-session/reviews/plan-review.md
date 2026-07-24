<!-- PLAN-REVIEW-REPORT -->
# Plan Review: SRS Study Session (S-03)

- **Plan**: `context/changes/srs-study-session/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-24
- **Verdict**: SOUND (after triage; original REVISE)
- **Findings**: 0 critical, 3 warnings, 3 observations — all triaged and fixed

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING → resolved |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → resolved |
| Plan Completeness | WARNING → resolved |

## Grounding

16/16 paths ✓, 5/5 symbols ✓ (STATE_ACCEPTED=2, PROTECTED_ROUTES, mockCards/OPENROUTER
fallback, Sidebar "Nauka" disabled, ts-fsrs absent as claimed), brief↔plan ✓. RPC and
append-only-table precedents verified in the migration history.

## Findings

### F1 — Due-count function underspecified in P1, hard-required in P4 (and N+1)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness / Blind Spots
- **Location**: Phase 1 (Contract) ↔ Phase 4 #1 ↔ Performance Considerations
- **Detail**: Phase 1 defined `study_due_cards` firmly but left the deck-picker badge source as "a sibling count-only path (or a second function `study_due_count`)" — an unresolved either/or absent from Phase 1 Progress — while Phase 4 firmly called "study_due_count per deck". That per-deck call is an N+1 across decks, contradicting Performance Considerations' "No N+1" claim.
- **Fix A ⭐ Recommended**: One batched all-decks count query in Phase 1 — `study_due_counts()` returns `(deck_public_id, due_count)` via LEFT JOIN + GROUP BY, security invoker, RLS-scoped; Phase 4 loader calls it once.
  - Strength: Kills both the underspecification and the N+1; keeps "No N+1" true; mirrors the `search_flashcards_in_deck` RPC shape.
  - Tradeoff: Slightly more SQL than a scalar per-deck function.
  - Confidence: HIGH.
  - Blind spot: GROUP BY over the LEFT JOIN must coalesce missing rows as due-now.
- **Fix B**: Keep per-deck `study_due_count`, but pin its definition + a Progress line in Phase 1, and soften the "No N+1" claim.
- **Decision**: FIXED via Fix A — `study_due_counts()` defined in Phase 1 contract; Phase 4 loader calls it once; Performance section restated.

### F2 — review_log ships substrate for explicitly out-of-scope features

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Critical Impl Details (review_log) ↔ "What We're NOT Doing"
- **Detail**: "What We're NOT Doing" lists no rollback/reschedule/forget, yet the plan shipped a second table (review_log) with its own two-hop RLS policy and grants, justified as "the substrate those features need". The end state (session runs, schedule persists, Risk #3 passes) is reachable without it — "survives restart" is proven by re-reading the schedule row, which needs no log.
- **Fix A ⭐ Recommended**: Keep review_log but re-justify honestly as durability/audit evidence.
  - Strength: SRS review history is impossible to reconstruct later; legitimate value on the north-star slice.
  - Tradeoff: One extra RLS policy to get right.
  - Confidence: MED.
- **Fix B**: Defer review_log to the first feature that consumes it; prove restart via the schedule-row re-read; drop the "review_log append" test assertion.
  - Strength: Leaner slice; one fewer RLS surface.
  - Tradeoff: No review history for reviews done before it lands.
  - Confidence: HIGH.
- **Decision**: FIXED via Fix B — review_log removed from DDL, rateCard, Risk #3 test, Success Criteria, Progress, References, and brief; moved to "What We're NOT Doing" as deferred.

### F3 — Rating write is non-idempotent; a double-submit corrupts the schedule

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 rateCard ↔ Phase 3 endpoint ↔ Phase 4 island
- **Detail**: rateCard ran next() → update schedule → insert log with no guard against a repeated submit. Two ratings on the same card apply two FSRS transitions — exactly the schedule corruption Risk #3 exists to prevent. lessons.md ("Klient↔serwer timeouty + Ponów wymagają idempotencji zapisu") flags this class; the plan did neither idempotency nor a recorded tradeoff, and the island never stated buttons disable while `pending`.
- **Fix A**: Client-side guard only + explicit recorded tradeoff (island disables buttons in `pending`; document non-idempotent rating).
- **Fix B ⭐ (chosen)**: Server-side compare-and-set on `reps` — conditional `update ... where reps = expectedReps`; a stale version → benign idempotent 200 (`alreadyApplied`), never a second transition.
  - Strength: Robust against retries and races at the write, independent of any client guard.
  - Tradeoff: Adds an optimistic-lock version to the card view + endpoint payload.
  - Confidence: MED.
- **Decision**: FIXED via Fix B — CAS on `reps` threaded through Critical Details → rateCard (P2, `expectedReps` param) → endpoint Zod + benign 200 (P3) → island sends version and disables buttons in pending (P4) → new "idempotent re-rate" assertion (P5).

### F4 — Mapping must coalesce ALL null schedule columns, not just `due`

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 RPC (LEFT JOIN) ↔ Phase 2 scheduleRowToCard
- **Detail**: `study_due_cards` LEFT-JOINs the schedule and coalesces only `s.due`; a never-seeded accepted card returns NULL stability/difficulty/srs_state/reps/lapses, but `repeat(card, now)` needs a valid Card, and ensureSchedule runs after the RPC. Phase 2's mapping mentioned only due/last_review.
- **Fix**: State that scheduleRowToCard coalesces every missing FSRS column to its New-card literal.
- **Decision**: FIXED — Phase 2 mapping contract now coalesces each NULL FSRS column to the New literal.

### F5 — Endpoint's "return next card if not prefetched" branch is dead

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 3 endpoint contract
- **Detail**: Phase 4 #2 has the loader pass the whole batch to the island, so the "client didn't prefetch → return next card" branch is never exercised — speculative generality.
- **Fix**: Drop the branch — rate returns `{ ok, progress }`; the island owns batch advancement.
- **Decision**: FIXED — resolved as a side effect of the F3 rewrite of the rate action; endpoint returns only `{ ok, progress }`.

### F6 — Phase 3 Success Criteria (3 automated) vs Progress (2 items)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 Success Criteria ↔ Progress §Phase 3
- **Detail**: Body listed lint, build, and "astro sync before lint" (3 bullets); Progress collapsed to 3.1 (sync+lint) and 3.2 (build). Not a parse failure, but the lists didn't line up 1:1.
- **Fix**: Merge the body's two bullets to match Progress.
- **Decision**: FIXED — Phase 3 Success Criteria body merged astro-sync + lint into one bullet, matching Progress 3.1/3.2.

## Triage Summary

- **Fixed**: F1 (Fix A), F2 (Fix B), F3 (Fix B), F4, F5, F6 — all 6
- **Skipped / Accepted / Dismissed**: none
- **Verdict after fixes**: REVISE → SOUND
- Fixes applied to `plan.md`; `plan-brief.md` synced; `research.md` intentionally untouched (point-in-time record). `change.md` status → `plan_reviewed`.
