---
change_id: manual-card-crud
title: Manual flashcard CRUD within a deck
status: implementing
created: 2026-07-09
updated: 2026-07-11
archived_at: null
---

## Notes

Manual flashcard CRUD within a deck: user manually creates a flashcard (front/back) marked as manually authored (FR-007), browses the list of cards in a deck (FR-008), edits an existing card (FR-009), and permanently deletes any card — delete is distinct from reject (FR-010); every card belongs to its deck and to the owner account only, no cross-account visibility. Prerequisite S-01 (deck-workspace) is done. PRD refs US-03, FR-007..FR-010. (source: C10X-5)

## Deferred ideas (→ Jira Pomysły)

Considered for S-02 during planning, deliberately cut to keep the slice focused. File each as a separate future task under the Jira "Pomysły" category:

- **Bulk delete + select-mode** — a multi-select flow to tick several cards and permanently delete them in one action, distinct from single-card delete.
- **Card sorting control** — a client-side sort in the deck content toolbar (newest / oldest / alphabetical × ascending/descending); S-02 ships the default `created_at desc` order only.
- **Keyboard arrow navigation between cards** — move focus/selection across the card grid with the arrow keys (roving tabindex), so the list is fully keyboard-drivable beyond the per-card Tab reach that S-02 already ships. Surfaced during the S-02 a11y close-out.
- **Selection-driven toolbar actions** — replace the per-card Edytuj/Usuń controls with a selection model: a card is selected (click, or focus + Enter) and shows a highlighted border; Edytuj/Usuń then live in the content toolbar next to „Dodaj fiszkę" and act on the selection. Single-select first; later multi-select where Edytuj disables (only Usuń stays active) — this is the natural home for the already-deferred bulk delete + select-mode. Surfaced during S-02 UX review.
- **Full-height scrollbar (shell restructure)** — the scrollbar should run the entire right-pane height (top edge to bottom edge), with everything (top user bar, footer, content) sitting to its LEFT. Today only `<main>` scrolls (it sits between the fixed top `AuthenticatedLayout` header and the fixed footer), so the scrollbar spans just that middle band. To fix: make the whole right column (`AuthenticatedLayout`'s `flex-col` wrapper) the scroll container; the top user bar (email/„Wyloguj") and the footer become `position: sticky` (top-0 / bottom-0) glass bars WITH an opaque/`backdrop-blur` backing so scrolling cards don't bleed through their translucent `bg-white/5`, plus cosmic occlusion caps for their `mt-4`/`mb-4`/`mr-4` margin gaps (mirror the deck-header `::before` cap already in `decks/[publicId]/index.astro`). Knock-on work: the deck page's sticky „nazwa talii" header (`top-0`) and „Fiszki" toolbar (`top-16`) currently assume they're at the very top of the scroll area; once the shell header is sticky inside the same scroll container they must offset by the shell-header height (e.g. `top-[H]` / `top-[H+64]`), so the shell header needs a fixed, known height. Bottom fade (`AuthenticatedLayout`'s scrollbar-safe gradient) and the toolbar top fade get re-anchored to the new sticky positions. Affects every authenticated screen. Deferred from S-02 (no time now) — extract as its own change/ticket with a dedicated plan. Surfaced during S-02 UX review.
