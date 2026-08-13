---
change_id: bug-generation-compensation-swallowed
title: Swallowed compensation error leaves a lying succeeded session and a dead retry
status: implementing
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

  > **Corrected 2026-08-13 by plan-review F1 — the decision stands, its justification did not.**
  > Hardening `:400` gives **detection**, not deletion: the orphan deck survives a failed undo
  > however loudly it is reported, so on its own this buys a permanent `409` in place of a
  > permanent 500. Nor can the heal delete the orphan — `generation_session` carries no deck FK
  > and the deck is read back through cards that do not exist, so it is unreachable from the
  > poisoned session by construction. What restores the retry is **D-06**; `:400`'s hardening is
  > what makes the state visible when it happens, which is a smaller claim than this bullet made.

- **D-06 — On the healed path only, an owned EMPTY deck of the requested name is ADOPTED rather
  than refused** (added 2026-08-13 by plan-review F1). Gated on the heal, never on emptiness
  alone: an empty deck the user created by hand is not an orphan, and
  `tests/generation/generate.test.ts:805` pins exactly that case — a deck made through
  `/api/decks`, never generated into — while `:441` pins the populated twin. Both are
  deliberately key-**less**, so the heal-gate is what keeps them green; gating on emptiness turns
  `:805` red.

- **D-07 — The heal clears ONLY the `idempotency_key`; retirement stays the compensation's job**
  (added 2026-08-13 by plan-review F2). The heal cannot tell a poisoned row from one the user
  emptied by deleting its cards — research §6 measures the two as byte-identical — and in the
  second case `saved_count` is **truthful**. Reusing the retirement there would overwrite a true
  audit row with a false failure: this ticket's own defect class, one path over.

- **D-08 — `retriable` is read with ABSENT meaning retriable** (added 2026-08-13 by plan-review
  F3). Measured: 2 of 20 `return json(...)` sites carry the flag, so a strict read would remove
  "Ponów" from every transient 500 — including `:402` when the compensation succeeded, where the
  retry works today. The endpoint instead marks the genuinely non-retriable returns
  `retriable: false`, so a forgotten flag keeps the affordance rather than silently removing it.
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

  > **Wording corrected 2026-08-13 (Phase 5) — the decision stands.** "The self-heal **retires**
  > them then" is what D-07 forbids: the heal clears the `idempotency_key` and touches nothing
  > else, precisely because this bullet's own second sentence says the two row shapes cannot be
  > told apart. Read it as "the self-heal disarms them then". The decision — no backfill — is
  > unaffected, and its reasoning is if anything stronger under D-07.

## Implementation notes (2026-08-13, Phase 5)

- **D-09 — doc-sync went beyond the three `test-plan.md` edits the plan enumerated, and the
  extras are named rather than counted.** Phase 5 §4 enumerated §6.5's `saved_count` bullet (a
  live declaration — edited in place), §6.6's impl-review-F3 paragraph (a dated snapshot —
  **dated correction**, conclusion kept: do not drop the index predicate) and §6.6's Phase-2
  entry (a new dated note). Three further **live** surfaces would otherwise have been left
  asserting something false about today, so each was edited too:
  - `test-plan.md`'s **header block** and its **§8 Freshness Ledger** — the file's two live
    declarations of what was last proven and when. Leaving `Last updated: 2026-08-09` in the
    document that polices exactly this class was not an option.
  - `roadmap.md` gained row **H-16**, at `Status: in progress`, created during implementation
    rather than backfilled. Without it `/10x-archive` has nothing to close and the change
    vanishes from the roadmap — a mechanism this project has recorded **four** times (H-04,
    H-07, H-08, H-13) and pre-empted once (H-15). `/10x-archive` owns the flip to `done`.

  The applied migration `20260725133600`'s header carries the same now-stale key claim and is
  **deliberately NOT edited**, per the plan: amending a pushed migration is a drift class the
  C10X-29 gate is blind to by construction. The correction lives in `src/lib/generations.ts`
  and in `generate.ts`'s `idempotency_key: null` comment, both of which point at it.

- **Two of the plan's breakage predictions did not survive contact, and both are recorded as
  observed rather than rounded** (`verification.md` §2) — the discipline this repo applies to
  C10X-29's `missingLocal` neuter and C10X-30's case 8:
  - Removing the confirmation between the key-clearing update and the fall-through goes **0 of
    26 red**. The confirmation guards a state a healthy stack never produces, so the neuter as
    worded is observationally a no-op; a **fifth** run was added, pairing it with a clear that
    does not clear, and that one reproduces research §7's `23505` loop with the collision's own
    response body captured as evidence.
  - Neutering `idempotency_key: null` alone was predicted to redden the cleared-key assertion
    while leaving the generation assertion green. **Both go red**, and the reason is a real
    boundary worth carrying: the confirmation asserts a row was **matched**, never that the key
    is **gone**. It protects against a clear that matched nothing (the RLS case `.select()`
    exists for); it cannot protect against a clear that matched the right row and wrote the
    wrong column.

- **Evidence pointer**: `context/changes/bug-generation-compensation-swallowed/verification.md`
  (after archiving: `context/archive/<date>-bug-generation-compensation-swallowed/verification.md`)
  — five breakage runs with their observed failure strings and denominators, the DCL reachability
  run with its three independent restore oracles, and the boundary that run does **not** cross.
