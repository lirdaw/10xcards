---
change_id: bug-generation-deck-undo-swallowed
title: Check the deleteDeck undo after a failed generation-session insert
status: implementing
created: 2026-08-13
updated: 2026-08-13
archived_at: null
---

## Notes

Fix the last swallowed deleteDeck undo in src/pages/api/generate.ts — the branch after a FAILED generation_session insert (~:596-598, currently `if (createdDeckPublicId) { await deleteDeck(...) }`) discards the result including RETURNING, so a failed rollback leaves an empty orphan deck and the next "Ponów" with the same newDeckName dies on deckNameExists with a permanent, misleading 409 "Nazwa talii jest już zajęta" — a retriable error turned permanent. Scope is THIS ONE SITE only: the sibling undo on the failed-card-insert path was already fixed by C10X-48 (checks data+error into `deckUndone`, answers a distinct retriable 500), and the comment at :588-595 names C10X-49 as owner of the remaining one — so the ticket's "obu gałęziach" wording is stale. Acceptance: a failed rollback must not turn a retriable error into a permanent 409, and the cleanup failure must be signalled rather than silent. Follow C10X-48's shape — check `data` not just `error` (a zero-row DELETE under RLS resolves {data:null,error:null}), the response is the only witness (nothing in src/ logs, test-plan §7), keep `retriable: true`. The two remaining swallowed awaits in the file (failure-path createGenerationSession inserts) belong to C10X-50 and are out of scope. (source: C10X-49)
