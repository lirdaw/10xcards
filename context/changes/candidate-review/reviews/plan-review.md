<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-05 candidate-review

- **Plan**: `context/changes/candidate-review/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-25
- **Verdict**: REVISE → SOUND after fixes (all 10 findings applied to the plan)
- **Findings**: 3 critical, 4 warnings, 3 observations

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | FAIL | PASS |
| Lean Execution | WARNING | PASS |
| Architectural Fitness | FAIL | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

17/17 plan paths ✓ (`docs/reference/contract-surfaces.md` absent → surface check skipped),
8/8 symbols ✓, brief↔plan ✓, Progress↔Phase ✓ (6 phases, 39 steps, titles + indices conform
to `progress-format.md`). Codebase verification done directly, not delegated.

## What held up under verification

- Astro route precedence for `cards/batch.ts` — static beats dynamic; the `UUID_RE` guard in
  `[cardPublicId].ts` is a genuine second net. The sibling `cards/[cardPublicId]/` directory
  (`delete.ts`) does not collide.
- RLS needs no change: `flashcard_update` / `flashcard_delete` gate on the deck-ownership
  EXISTS-join and reference no columns (`init_core_schema.sql:132-142`).
- Bulk delete would be FK-safe — `flashcard_schedule.flashcard_id` is `on delete cascade`
  (`20260724195248_srs_study_schedule.sql:36`).
- `PROTECTED_ROUTES` prefix-matching already covers `/decks/*/review` and
  `/api/decks/*/cards/batch` — Phase 2 #3's "verify, don't assume" is correct.
- The orphaned-schedule-row decision matches `study.ts`'s own comment and S-03's accepted-only
  write gate — no cleanup needed, as stated.

## Findings

### F1 — Phase 6's partial unique index breaks the FR-018 retry it exists to protect

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 6 — changes #1 and #3
- **Detail**: The index covers every row, but the dedup lookup matches only a *succeeded*
  session, and `/api/generate` writes a session on both failure paths
  (`generate.ts:135-147`, `:160-172`). If those carry the key, "Ponów" — which replays the
  payload verbatim (`GeneratorForm.tsx:106,175-177`) — collides on its session insert and
  answers `500` (`:210-212`), killing retry permanently after any failure. Second unhandled
  path: in the real race window request 2 finds nothing, pays for a second LLM call, then dies
  on 23505 while request 1's cards landed.
- **Fix A ⭐ Recommended**: key written only on the `succeeded` insert; 23505 on that insert
  mapped to the replay path
  - Strength: failure-path retry behaves exactly as today; the race degrades to a correct 200.
  - Tradeoff: two decisions to state explicitly, plus one more test.
  - Confidence: HIGH — both failure inserts and the retry path read in source.
  - Blind spot: the duplicate LLM call in the race window still costs money.
- **Fix B**: drop the index; dedup by the pre-LLM select only
  - Strength: no new failure mode; smallest diff.
  - Tradeoff: best-effort only, so "covered" would overstate Risk #2.
  - Confidence: MEDIUM.
  - Blind spot: whether the test-plan's 2→1 inversion is then honest.
- **Decision**: FIXED via Fix A — Phase 6 #1 now pins the key to the `succeeded` insert (with
  the reason, so the null does not read as an oversight), #3 adds 23505 → replay plus how a
  replay reconstructs `deckPublicId` (the session has no `deck_id`), #4 adds the
  retry-after-failure case, and criterion 6.8 covers it.

### F2 — `FlashcardView.source` has no source on the search branch, and no gate catches it

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 change #3 + Phase 4 change #5
- **Detail**: `decks/[publicId]/index.astro:52-65` maps the list branch and the search branch
  through ONE `.map()`; the RPC's projection is a fixed five columns with no `source_id`
  (`20260712162359_deck_keyword_search.sql:46-61`). Nothing catches the resulting `undefined`:
  `npm run lint` is plain ESLint (a missing property is a `tsc` error, not a rule violation),
  `astro build` does not type-check, and no script or CI step runs `astro check`
  (`package.json:5-17`, `.github/workflows/ci.yml:20-25`).
- **Fix A ⭐ Recommended**: add `source_id` to the RPC projection in the Phase 1 migration
  - Strength: parity at the data source, same principle the plan already applied to the state
    filter; no future caller inherits the gap.
  - Tradeoff: a return-type change → `drop function` + `create function` (Postgres refuses it
    on replace), and the drop loses the ACL, so re-granting becomes mandatory.
  - Confidence: HIGH — projection and loader both read directly.
  - Blind spot: `database.types.ts` must be regenerated (see F7).
- **Fix B**: make `source` optional, badge only when present
  - Strength: no migration change.
  - Tradeoff: searched cards silently lose the badge — the inconsistency S-02 rejected.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A, reconciled with F8 — the RPC gains `source_id` (drop+create,
  grants re-applied) so C10X-16 does not inherit the trap, while `FlashcardView.source/state`
  are **optional** and filled only by the review loader, since F8 moved the deck-view badge to
  C10X-16 and this slice has no deck-side consumer. Verified by a data-layer assertion in
  Phase 5, not by a UI check.

### F3 — The rejected view has no durable entry point, so "reject is recoverable" isn't

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Desired End State ↔ Phase 4 changes #2 and #4
- **Detail**: Both routes into `/decks/<id>/review` — the generator's success link and the
  deck-list chip ("Decks with zero show nothing") — disappear once no candidates are pending,
  which is exactly the state a freshly rejected card creates. The per-card `Odrzuć`'s whole
  justification is recoverability; its only pointer was a post-action message the plan then
  destroys with a reload.
- **Fix A ⭐ Recommended**: permanent link from the deck view to its review screen, independent
  of the candidate count
  - Strength: one link serves both roles the route now plays, and it sits where the rejection
    happened.
  - Tradeoff: one more element in a toolbar whose layout Phase 4 is already negotiating.
  - Confidence: HIGH — the reachability graph is fully enumerated in the plan.
  - Blind spot: copy must not read as a counter, or it looks broken at zero.
- **Fix B**: deck-list chip counts `generated + rejected`
  - Strength: no new surface.
  - Tradeoff: conflates pending work with archive, and the deck view still has no link.
  - Confidence: MEDIUM.
  - Blind spot: interaction with the "N do przeglądu" copy.
- **Decision**: FIXED via Fix A — Phase 4 #2 is now a dedicated change (permanent link, placed
  as a sibling of `DeckContentToolbar`, copy that reads as review + archive), with manual step
  4.11 and manual-testing step 6 sequenced so the link is exercised at zero pending.

### F4 — Every accept/reject stamps the card as "Edytowano"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 change #1 (consequence lands in Phase 4)
- **Detail**: `flashcard_set_updated_at` is unqualified `before update ... for each row`
  moddatetime (`init_core_schema.sql:79-81`), so a `state_id`-only update bumps `updated_at`;
  `FlashcardView.edited` is `updated_at !== created_at`
  (`decks/[publicId]/index.astro:64`), rendered as "Edytowano: <date>"
  (`FlashcardItem.tsx:197`). This slice writes the project's first UPDATE that is not a content
  edit.
- **Fix**: narrow the trigger to `before update of front, back` in a Phase 1 migration; assert
  an accepted candidate shows "Edytowano: —"
  - Strength: matches what the column means; `updateFlashcard` sets only front/back, so nothing
    existing changes.
  - Tradeoff: touches a trigger from the init migration.
  - Confidence: HIGH — trigger, mapper and renderer all read in source.
  - Blind spot: a future writer touching content plus other columns still fires it — intended.
- **Decision**: FIXED — new Phase 1 change #7 with its own migration, criterion 1.9, manual
  step 4.12, an integration assertion in Phase 5 #2, and a third deliberate-breakage variant
  (restore the unqualified trigger, confirm exactly that assertion goes red).

### F5 — The deck-list counter contradicts itself and re-introduces a ruled-out N+1

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 change #2 ↔ Phase 4 change #4
- **Detail**: Phase 1 adds a per-deck `countCandidates(deckId)` while Phase 4 describes
  application-code grouping. `study/index.astro:14-15` already settled this for the identical
  due-count chip, with a comment reading "never a per-deck query (that would be an N+1 growing
  with the deck list)".
- **Fix**: replace with one RLS-scoped grouped query mirroring `listDueCounts`' shape.
- **Decision**: FIXED — Phase 1 #2 now specifies `countCandidatesByDeck(supabase)` (one query,
  grouped by deck `public_id`) and states explicitly why the per-deck variant is rejected;
  Phase 4 #3 calls it.

### F6 — The acceptance metric's denominator disagrees with its own numerator

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 change #4 ↔ Phase 3 change #4
- **Detail**: The grouped counts sum to the session's surviving rows, but `n` was specified as
  `generated_count` — which counts what the model returned before Zod dropped some
  (`generate.ts:153-155`), so `k z n` carries an unreachable ceiling. research.md §8 defines the
  metric as a plain aggregate over `flashcard`.
- **Fix**: `n = accepted + rejected + pending`; show any skipped count separately.
- **Decision**: FIXED — both changes now state the same denominator and record why neither
  stored counter works (`saved_count` zeroed by compensation, `generated_count` over-counts).

### F7 — `npx astro sync` is not what regenerates `database.types.ts`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 + Phase 6 — Automated Verification
- **Detail**: Supabase types come from `npm run db:types` (`package.json:17`); `astro sync` only
  writes `.astro/`. Both migrations change the surface the typed client sees — a new column, and
  under F2's fix a changed RPC return type.
- **Fix**: add `npm run db:types` as its own criterion in Phases 1 and 6.
- **Decision**: FIXED — criteria 1.7 and 6.2 (rewritten), plus a note in Migration Notes.

### F8 — Phase 4 is C10X-16's scope, is the largest phase, and the end state lands without it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Lean Execution
- **Location**: Phase 4 (and Phase 3 change #1, which it justifies)
- **Detail**: Remove Phase 4 and US-01 / FR-005 / FR-006 still land. What it added — deck-view
  selection, bulk delete, source badge — is C10X-16's parked UI half plus a new destructive
  capability on three components the slice did not create, and it was the sole justification for
  pre-building `useSelection`/`SelectionToolbar` as shared primitives.
- **Fix A ⭐ Recommended**: shrink Phase 4 to per-card `Odrzuć` + the permanent review link;
  move selection, bulk delete and the badge to C10X-16
  - Strength: removes the destructive multi-row path and one touched neighbour; the abstraction
    is promoted when a real second consumer arrives.
  - Tradeoff: reverses a recorded planning decision; the batch `delete` action loses its caller.
  - Confidence: MEDIUM — the end state clearly survives; pre-building is a judgement call.
  - Blind spot: if C10X-16 ships next, doing it once here would have been cheaper.
- **Fix B**: keep Phase 4 as planned
  - Strength: pre-settled decision; two consumers validate the abstraction.
  - Tradeoff: the densest risk in the plan sits in its largest phase.
  - Confidence: HIGH — it works; the cost is scope.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — Phase 4 rewritten to three narrow changes; Phase 3 #1's
  selection is review-local (`src/components/review/`, bare checkbox, no vendored
  `ui/checkbox.tsx`); the batch `delete` action and `deleteFlashcards` deferred with their UI;
  Phase 5's isolation and batch cases narrowed to `setState`; scope, brief and Progress updated.

### F9 — `DeckContentToolbar.tsx` may not need touching at all

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 4 change #3
- **Detail**: `FlashcardWorkspace.tsx:100-108` already renders the toolbar inside the sticky
  container, so anything below the search/add row can be its sibling.
- **Fix**: render in the workspace's sticky block; edit the toolbar only if the bar must live
  inside it.
- **Decision**: FIXED — folded into the reshaped Phase 4 #2, which states the sibling placement
  and that `DeckContentToolbar` stays untouched; the file is off the phase's change list.

### F10 — The deck-list loader drops its query error, and Phase 4 adds a second query to it

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 change #4
- **Detail**: `decks/index.astro:8` ignores `error` — the lessons.md "SSR error-vs-empty" case
  that `generate.astro:12` and `study/index.astro:14-17` both handle.
- **Fix**: branch on both errors; on a count failure render decks without chips.
- **Decision**: FIXED — spelled out in Phase 4 #3's contract, including the distinct behaviour
  for each of the two failures.

## Triage summary

- **Fixed**: F1 (Fix A), F2 (Fix A, reconciled with F8), F3 (Fix A), F4, F5, F6, F7,
  F8 (Fix A), F9, F10 — 10 of 10.
- **Skipped / Accepted / Dismissed**: none.
- **Verdict after fixes**: SOUND.

## Net effect on the plan

| Phase | Change |
|-------|--------|
| 1 | +`countCandidatesByDeck` (one query, not N+1) · optional badge fields · denominator rule · RPC drop+create with `source_id` and re-granted ACL · **new** `updated_at` trigger migration · +3 criteria (1.7–1.9) |
| 2 | batch endpoint carries `setState` only |
| 3 | selection is review-local (`src/components/review/`, bare checkbox) · metric denominator |
| 4 | rewritten: per-card reject, permanent review link, counter with error branching; `DeckContentToolbar` untouched |
| 5 | `setState`-only isolation case · `source_id` + `updated_at` assertions · third deliberate-breakage variant |
| 6 | key only on `succeeded` · 23505 → replay · replay reconstructs deck from the cards · retry-after-failure test (6.8) · `db:types` |

Deferred to **C10X-16** as one coherent unit: deck-view selection, bulk delete, source badge,
the batch `delete` action, `deleteFlashcards`, and the promotion of `useSelection` /
`CandidateSelectionBar` to shared primitives.
