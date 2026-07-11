<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Manual Flashcard CRUD (S-02)

- **Plan**: context/changes/manual-card-crud/plan.md
- **Mode**: Deep
- **Date**: 2026-07-09
- **Verdict**: REVISE → SOUND (all findings fixed in plan)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

6/6 paths ✓ (index.astro, decks.ts, init migration, CreateDeckModal, ui/ [textarea missing, card present], database.types.ts), 4/4 symbols ✓ (getDeckByPublicId selects public_id+name only, flashcard.Insert requires state_id, Modal uses native `<dialog>.showModal()` for focus-trap+Esc, deck delete uses `/delete` subpath), brief↔plan ✓. No Astro routing conflict — new `cards/*` endpoints mirror the working deck `[publicId].ts` + `[publicId]/delete.ts` pattern. `## Progress` ↔ Phase mechanical contract clean (1.1–1.6, 2.1–2.7, 3.1–3.9).

## Findings

### F1 — deckIdByPublicId conflates query error with "not found"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 (helper) + Phase 2 (loader, create endpoint)
- **Detail**: The new `deckIdByPublicId` resolver returns `id` or `null`. The plan treated `null` unconditionally as 404 in both the loader and the create endpoint. A `null` from Supabase can come from RLS/no-row OR a transient DB error (`{ data: null, error }`); without branching on `error`, a DB failure masquerades as a 404 — exactly the pattern warned against in `context/foundation/lessons.md:68-73`.
- **Fix**: `deckIdByPublicId` returns the raw `{ data, error }` like the other helpers; both callers branch — `error` → distinct error state / redirect with message, only `data == null && !error` → 404.
  - Strength: Closes the error-vs-empty lesson on the write path and in the loader; consistent with how the plan already treats `listFlashcards`.
  - Tradeoff: A few extra lines in the helper and two callers.
  - Confidence: HIGH — same rule the project already adopted as a lesson.
  - Blind spot: None significant — both loader and endpoint covered.
- **Decision**: FIXED (Fix in plan) — helper contract §3, loader §1, create endpoint §5.

### F2 — Loader double-queries deck by the same public_id

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 — deck detail loader
- **Detail**: `getDeckByPublicId` returns `public_id, name` (src/lib/decks.ts:15), but `listFlashcards(supabase, deckId)` needs the internal `bigint id` — so the loader would call `deckIdByPublicId` too: two selects on `deck` by the same public_id per deck-detail load.
- **Fix**: Extend `getDeckByPublicId` to also `select("id, …")` (kept in frontmatter, NOT passed to island props); loader reuses that id. `deckIdByPublicId` stays only for the create endpoint.
- **Decision**: FIXED (Fix in plan) — added Phase 1 §5 + loader §1 contract.

### F3 — Deck publicId in card edit/delete endpoints is decorative

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — edit + delete endpoints
- **Detail**: `updateFlashcard`/`deleteFlashcard` keyed off `cardPublicId` only; the deck `publicId` in the path didn't scope the mutation. RLS keeps cross-account safe, but success redirects to `/decks/${publicId}` from the URL, so a hand-crafted mismatched-but-owned deck path redirects to a page not listing the card.
- **Fix**: Helpers take `deckId` and scope by `.eq("deck_id", deckId)`; endpoints resolve `deckIdByPublicId` and pass it → mismatched deck path resolves to a clean 404 instead of mutating a card in a different deck.
- **Decision**: FIXED (Fix in plan) — helper contract §3, edit endpoint, delete endpoint.
