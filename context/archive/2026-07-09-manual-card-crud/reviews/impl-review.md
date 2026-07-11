<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Manual Flashcard CRUD (S-02)

- **Plan**: context/changes/manual-card-crud/plan.md
- **Scope**: All phases (1–3 of 3, all complete)
- **Date**: 2026-07-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Deck-fetch loader ignores query `error` (error-vs-empty)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/decks/[publicId]/index.astro:18
- **Detail**: `const { data: deck } = ... await getDeckByPublicId(...)` destructures only `data`, dropping `error`. A transient DB error on the deck fetch → `deck == null` → rendered as a hard 404 "Nie znaleziono talii" — exactly the confusion the SSR error-vs-empty lesson (lessons.md:68-73) warns against. The card fetch 12 lines below (`:30-32`) does it correctly (`listError → cardsError → distinct error state`), and all three new endpoints branch on `error` too — the deck fetch is the lone inconsistency. The line is pre-existing (introduced in C10X-3), but this change actively touched the file and applied branch-on-error to the cards while leaving the deck fetch alone.
- **Fix A ⭐ Recommended**: Destructure `error: deckError` and render a distinct error state (mirroring `cardsError`) instead of falling into the 404 branch.
  - Strength: Closes a documented-lesson violation in the exact file the slice already edits; the `cardsError` pattern to copy sits in the same frontmatter.
  - Tradeoff: Needs a third render branch (error) alongside the existing deck/404 branches — a bit more than a one-liner.
  - Confidence: HIGH — the sibling `cardsError` implementation is the template.
  - Blind spot: None significant.
- **Fix B**: File as a separate follow-up (it is pre-existing, not introduced here) and keep this slice's diff scoped.
  - Strength: Keeps the reviewed change minimal; the bug is not a regression from S-02.
  - Tradeoff: Leaves a known lesson-violation live in a file the team just touched; easy to forget.
  - Confidence: MEDIUM — depends on the follow-up actually being filed.
  - Blind spot: No 404-page UX exists yet, so the wrong-branch render is a bare 404 either way.
- **Decision**: FIXED via Fix A — destructured `deckError`, added a distinct 500 error state ("Coś poszło nie tak podczas ładowania talii") alongside the 404 branch; lint + build pass.

### F2 — Unplanned app-shell UX (Sidebar collapse, footer mock, restyle)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/Sidebar.astro (+149), src/layouts/AuthenticatedLayout.astro, src/components/ui/button.tsx, src/components/auth/SubmitButton.tsx, src/components/decks/CreateDeckModal.tsx, src/styles/global.css
- **Detail**: The p3 commit ("polish card and shell UX") ships changes beyond "manual card CRUD": a collapsible icon-rail Sidebar with `localStorage` persistence + inline script (the widest stretch), a full-height shell restructure with a footer carrying mock roadmap links (Pomoc/Prywatność/Kontakt as non-navigable `<span>`s — incidentally advances FR-013's admin/roadmap mock), destructive/purple button restyles, and cosmetic `global.css` utilities. None touch data or security surface; the commit message discloses them. `ui/Modal.tsx` is a genuine bugfix (mousedown guard so a drag starting inside the new Textareas and released on the backdrop no longer closes the modal) directly motivated by this slice — that one is legitimately in-scope. The rest is undisclosed-in-plan scope.
- **Fix**: Add a one-line addendum to plan.md's "What We're NOT Doing" / an "Also changed" note recording the shell-UX polish, so a future review reads the plan as ground truth. (The full-height-scrollbar restructure is already deferred in change.md; the shipped Sidebar collapse is not recorded anywhere.)
- **Decision**: FIXED — added an "Also changed (addendum)" section to plan.md recording the Modal bugfix, Sidebar collapse, shell/footer mock, restyle, and global.css polish.

### F3 — Character counter counts untrimmed value; validation trims

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/flashcards/CreateFlashcardModal.tsx:23-30, src/components/flashcards/FlashcardItem.tsx:37-44
- **Detail**: `CharCount` uses raw `value.length` while `handleSubmit` validates `front.trim()`. With 200 chars of content plus trailing spaces, the counter turns red (>200) yet submit succeeds (trim ≤ 200) and the server saves correctly. Purely a cosmetic signal mismatch — no correctness or security impact.
- **Fix**: Count `value.trim().length` in `CharCount` (or trim on blur) so the counter and the accepted length agree.
- **Decision**: FIXED — `CharCount` now counts `value.trim().length` in both CreateFlashcardModal.tsx and FlashcardItem.tsx.

### F4 — Additive drift: `saved` param + `updated_at`/timestamp surfacing

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/decks/[publicId]/cards/[cardPublicId].ts (edit-success redirect), src/lib/flashcards.ts:16-37,62
- **Detail**: Edit-success redirects to `/decks/${publicId}?saved=${cardPublicId}` (plan said plain `/decks/${publicId}`) to drive a one-shot settle animation; `listFlashcards` also selects `updated_at` and adds `FlashcardView`/`formatCardDate`/`edited` to surface an "Utworzono/Edytowano" timestamp. Both are additive and benign; the Edytowano surfacing was explicitly anticipated by a project memory note. The `saved` param is stripped on mount alongside `open/edit/error`.
- **Fix**: None required — note the additive extension in the plan if keeping it as an addendum for F2.
- **Decision**: SKIPPED (accepted) — additive and benign; the Edytowano surfacing was anticipated by a project memory note.

### F5 — Length validation runs before deck existence is resolved

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/decks/[publicId]/cards/index.ts:34-51
- **Detail**: The create endpoint validates front/back lengths before resolving `deckId`. For a valid-UUID-but-nonexistent deck, a bad `front` redirects to `/decks/{publicId}?...&open=create-card`, where the loader renders the 404 branch (deck null) rather than the modal-with-error. Edge case only; no security risk (RLS + deck scoping still hold), and a nonexistent deck has no legitimate create flow anyway.
- **Fix**: Optionally resolve the deck before length validation so the 404 wins deterministically over a validation redirect. Low priority.
- **Decision**: FIXED — moved deck resolution ahead of length validation in cards/index.ts; applied the same reorder to cards/[cardPublicId].ts for consistency.
