---
change_id: bug-generation-deck-undo-swallowed
title: Check the deleteDeck undo after a failed generation-session insert
status: impl_reviewed
created: 2026-08-13
updated: 2026-08-13
archived_at: null
---

## Decisions

- **D-01 — Detection, not deletion.** The change reads the undo's result and reports the failure;
  it does **not** remove the orphan deck a failed undo leaves behind. This is the correction to
  C10X-48's own D-01 internalised: _hardening gives detection, not deletion_. A plan promising the
  orphan goes away would have been overclaiming, and Phase 3's manual run deliberately leaves its
  two orphan decks in the local dev DB as the artifact of record.
- **D-02 — A distinct message naming the leftover deck, not a reused one.** The failed-undo arm
  replaces `sessionFailure` wholesale with an inline literal that says the session could not be
  saved, that an empty deck of that name **may** have been left behind, and names both ways out
  (reload and pick it from the list, or change the name). Two alternatives were rejected: reusing
  the ordinary `sessionFailure` (the user's real pain is the NEXT click, and a message about the
  session alone says nothing about the deck about to block them), and adding the string to
  `REDIRECT_MESSAGES` (that set's members are values the deck pages render out of a URL, and its
  size is pinned at `tests/lib/redirect-errors.test.ts:92-95` — share a constant, never the
  membership). The hedge (`mogła` / `jeśli tak`) is load-bearing rather than soft: one literal
  covers **two** arms that contradict each other in the database, and on the zero-row arm the deck
  is already gone. Tightening it means splitting the arms, which means splitting `retriable` too.
  `newDeckName` is deliberately **not** interpolated — the user still has it in the form field.
- **D-03 — Explicit `retriable: false`, against the naive reading of C10X-48's D-08.** Not this
  handler's first `false` on a 500 — the plan said it was, and the Phase-1 manual read caught it:
  the unconfigured-Supabase refusal at `generate.ts:186` already carries one and the convention
  docblock names it. What is new is the KIND of 500: that one refuses before any work, this one
  has paid for a generation and written nothing, so the flag is argued rather than inherited.
  D-08 forbids a FORGOTTEN flag silently disarming an
  affordance; it does not argue for `true` where `false` is the measured truth. "Ponów" replays
  `lastPayload` VERBATIM (`GeneratorForm.tsx:224`), and on the arm that actually fires the orphan
  deck now exists — so the replay finds no keyed session, leaves `healedKey` false, meets the
  orphan at `deckNameExists` and returns `409 retriable: false` deterministically, every time.
  Offering the button would reproduce this ticket's own defect one click later. Consequence
  accepted and written down: with no button the copy is the user's **only** route out, so a future
  edit that shortens the copy must move the flag back in the same commit. Residual: one flag covers
  both failing arms, so on the near-unreachable zero-row arm a verbatim repeat WOULD have worked
  and `false` costs that user a click.
- **D-04 — The `:566` early return is fixed as a COMMENT, not as code.** The block's comment
  claimed it is "built up rather than returned early, so the deck undo below still runs on every
  one of these paths" — accurate for the three `sessionFailure` assignments and **false** for
  `replaySession`'s `return outcome.response`, which bypasses the undo. The combination is
  ~unreachable, and on the 200-replay arm the deck being deleted is the deck the response is
  handing back, so the code is left alone and the sentence gains the qualification. Found by this
  change's research; recorded in no prior document.
- **D-05 — The evidence is split and nothing bridges it.** The **suite** owns `deleteDeck`'s
  zero-row-vs-landed contract; **one recorded manual DCL run** owns the endpoint's use of it. The
  endpoint branch is unreachable from the suite as an identity, not an inconvenience:
  `findSucceededSessionByIdempotencyKey`'s filter set is the same set as the partial index
  predicate, so no seeded row can collide on the INSERT while escaping the lookup before it. No
  test in this project can join the two halves, and the plan says so rather than implying otherwise.
- **D-06 — The test's home is `tests/isolation/decks.test.ts`, not `generate.test.ts`.** §6.2's
  one-file-per-resource rule: the claim is about a deck helper, the A/B fixtures and `clientFor`
  are already imported there, and it sits directly beside the endpoint-level twin at `:86-100` that
  it complements. Amended during Phase 2: the positive control is its **own** `it()` rather than
  extra lines inside the denial, because Vitest aborts a case at its first failed `expect` — a
  control sharing the denial's `it()` never runs under the neuter it exists to be attributed
  against, and would have been green by silence (measured: `2 failed | 4 passed (6)`).
- **D-07 — No new `lessons.md` entry.** `lessons.md:243-248` already states this rule and names
  this exact site ("`deleteDeck` po nieudanym wstawieniu sesji"). Adding a second entry for a rule
  that already anticipated the defect would dilute the register rather than extend it.
- **D-08 — The roadmap row (H-17) was opened in Phase 1, not at doc-sync.** Without a row
  `/10x-archive` has nothing to close and the change disappears from the roadmap — a mechanism this
  project has hit four times (H-04, H-07, H-08, H-13) and pre-empted twice (H-15, H-16). Opening it
  in the FIRST phase means abandoning the change halfway cannot make it vanish either. `Status`
  stays `in progress`: `/10x-archive` owns the flip to `done`, not this plan.

## Notes

Fix the last swallowed deleteDeck undo in src/pages/api/generate.ts — the branch after a FAILED generation_session insert (~:596-598, currently `if (createdDeckPublicId) { await deleteDeck(...) }`) discards the result including RETURNING, so a failed rollback leaves an empty orphan deck and the next "Ponów" with the same newDeckName dies on deckNameExists with a permanent, misleading 409 "Nazwa talii jest już zajęta" — a retriable error turned permanent. Scope is THIS ONE SITE only: the sibling undo on the failed-card-insert path was already fixed by C10X-48 (checks data+error into `deckUndone`, answers a distinct retriable 500), and the comment at :588-595 names C10X-49 as owner of the remaining one — so the ticket's "obu gałęziach" wording is stale. Acceptance: a failed rollback must not turn a retriable error into a permanent 409, and the cleanup failure must be signalled rather than silent. Follow C10X-48's shape — check `data` not just `error` (a zero-row DELETE under RLS resolves {data:null,error:null}), the response is the only witness (nothing in src/ logs, test-plan §7), keep `retriable: true`. The two remaining swallowed awaits in the file (failure-path createGenerationSession inserts) belong to C10X-50 and are out of scope. (source: C10X-49)
