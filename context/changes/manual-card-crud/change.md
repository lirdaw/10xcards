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
