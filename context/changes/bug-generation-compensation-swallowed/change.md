---
change_id: bug-generation-compensation-swallowed
title: Swallowed compensation error leaves a lying succeeded session and a dead retry
status: planned
created: 2026-08-12
updated: 2026-08-13
archived_at: null
---

## Notes

Failed compensation after a failed insertCandidates is swallowed in src/pages/api/generate.ts (~l.396): failGenerationSession (src/lib/generations.ts:119-124) returns { error } discarded as best-effort, so on a double failure the generation_session stays status="succeeded" with saved_count>0 and a stored idempotency_key despite 0 cards in the database. Secondary effect: "Ponow" -> findSucceededSessionByIdempotencyKey finds the succeeded session -> replaySession -> 0 cards -> data:null -> a permanent 500 for that key forever, so the audit row lies and FR-018 (retry) is inverted. Scope: the compensation error path in generate.ts plus failGenerationSession's contract. Acceptance: a failed compensation must never leave a succeeded/saved_count>0 session with 0 saved cards; a retry of that key must not end in a permanent 500. Origin: "swallowed errors" audit 2026-08-11, hit #1. (source: C10X-48)

## Decisions (planning, 2026-08-13)

Recorded here rather than only in `plan.md` because the first one changes which ticket owns a
line of shipped code, and this repo has twice recorded the confusion a fix landing under a
foreign key produces (C10X-37/C10X-40).

- **D-01 — `generate.ts:400` ships under C10X-48, not C10X-49.** The swallowed `deleteDeck` in
  the `cardsError` branch is taken here as a **precondition of this ticket's own fix**: the
  replay lookup sits at `:178-188`, above deck resolution at `:246`, so a self-healed retry on
  the `newDeckName` path falls through into `deckNameExists` and hits a permanent `409` if the
  first attempt's orphan deck survived. The failures are correlated (research §2), so both
  swallows usually happen together. The twin at `:387` is a different branch with its own test
  tree and stays with **C10X-49**.
- **D-02 — Fix families (a) + (c); no migration.** Research §7's family (b) is rejected here: it
  trades this failure mode for a new one (cards landed, status flip failed → the retry writes
  duplicates) and does not touch the §6 dead-end reachable with no failed write at all.
- **D-03 — A retired session loses its `idempotency_key` as well as its `succeeded` status**, in
  one UPDATE. This forces the decision impl-review F3 deferred on 2026-07-25. Consequence for
  the partial index: see `plan.md` § Migration Notes — the predicate must **not** be removed.
- **D-04 — No fabricating transport seam and no DDL/DCL inside the suite.** Test-plan §6.9
  confines module doubles to one file and `tests/setup/retry-transport.ts` fabricates nothing by
  written decision. The suite proves the **consequence** half; **reachability** is proved once by
  a recorded manual breakage run, and the docs say the suite does not guard it.
- **D-05 — No backfill of already-poisoned cloud rows.** They are inert until someone replays
  that key, and the self-heal retires them then. A cleanup UPDATE would by construction also
  strip the key from §6 rows — sessions that never failed and whose cards the user deleted
  deliberately — and the two are byte-identical from the row.
