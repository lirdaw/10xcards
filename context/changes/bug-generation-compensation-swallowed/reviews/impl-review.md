<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Swallowed compensation error — C10X-48

- **Plan**: `context/changes/bug-generation-compensation-swallowed/plan.md`
- **Scope**: Phases 1–5 of 5 (full plan review)
- **Date**: 2026-08-13
- **Verdict**: NEEDS ATTENTION → **all six findings triaged; five fixed, one fixed structurally and awaiting a browser re-run (F3)**
- **Findings**: 0 critical, 3 warnings, 3 observations

## Gates re-run independently

| Gate                                                 | Result                                                                  | Matches `verification.md`?              |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------- |
| `npm run typecheck`                                  | `Result (151 files): 0 errors, 0 warnings`, exit 0                      | yes                                     |
| `npm test`                                           | **434 passed / 434, 36 files**, fresh seed `1786612331121`              | yes                                     |
| `npx vitest run tests/lib/generation-replay.test.ts` | 5 passed                                                                | yes                                     |
| `npx vitest run tests/generation/generate.test.ts`   | 26 passed                                                               | yes                                     |
| `npm run lint`                                       | exit 0, 3 warnings — all pre-existing `no-console` in `evals/`          | yes                                     |
| `npm run build`                                      | exit 0 (standing `@astrojs/sitemap` warning)                            | yes                                     |
| `git status --porcelain -uall`                       | clean                                                                   | yes                                     |
| Criterion 1.5 grep                                   | no import, no call of `failGenerationSession` (4 hits, all dated prose) | yes                                     |
| `md5sum src/pages/api/generate.ts`                   | `0f69047609b94085b434f51302fa2c57`                                      | identical to the recorded pristine hash |

Hard rules re-checked: no deep relative imports, no `import.meta.env` / `process.env`, no `console.*` anywhere in `src/`. Every `error` string on the new returns is a module-local Polish literal — no exception message, no Zod issue, no source text.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

**Plan Adherence is a genuine PASS, established three ways.** Every numbered contract across all five phases verifies as MATCH — the pure three-arm classifier with error-before-absence, both checked writes with their `.select("id").maybeSingle()` tails, all eight rename/correction sites handled as the plan's table assigns them, the replay split whose 200 body is byte-identical to `main`, the clear→confirm→fall-through ordering, heal-gated adoption with `createdDeckPublicId` correctly withheld, the `23505` heal-then-refuse asymmetry, and the fail-safe `retriable` read. All eight plan-review findings (F1–F8) are implemented as decided. The `await` census confirms criterion 2.5 exactly: only `:409`, `:458` (C10X-50) and `:578` (C10X-49) discard a result.

## Findings

### F1 — The emptiness half of the adoption gate is unfalsifiable

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/pages/api/generate.ts:377-379`; missing sibling at `tests/generation/generate.test.ts:1157`
- **Detail**: Phase 3 §3's contract has two boundaries and only one is tested. `verification.md`'s Run 4 breaks the **heal** gate (`existing && !healedKey`) and records the split correctly — 1 of 26 red, its twin green. Nothing breaks the **emptiness** gate. Verified by running it rather than reasoning about it: neutering `if (count !== 0)` to `if (false)` leaves **0 of 26 red** in `generate.test.ts` and **0 of 434 red** across the whole suite. Restored, `md5sum` back to `0f69047609b94085b434f51302fa2c57`, `git status` clean.

  The surviving mutant is user-visible: a healed retry would generate a fresh candidate set into a deck that already holds the user's cards — silently mixing two sessions' candidates, which is exactly what `countFlashcardsInAnyState`'s own header (`src/lib/flashcards.ts:200-206`) says the second helper exists to prevent. The plan's own Phase 5 §1 lists "The adoption gate" as a case to pin; it pins the gate's healed-path half only.

- **Fix**: Add a fifth case beside the existing adoption test — seed a poisoned session for key K (`seedSucceededSession`), create a deck of that name through `createDeck`, insert one card into it as the owner, then POST with K + that `newDeckName`. Assert `409`, that `cardsOf(deck)` is still 1, and that `allSessions(...)` gained no succeeded row. Note the key **is** already cleared by the time the 409 returns (`:259` runs first), so assert `idempotency_key === null` on the seeded row rather than unchanged.
- **Decision**: **FIXED** — `tests/generation/generate.test.ts`, case `"refuses to adopt a deck that HOLDS cards, even on the healed path"`. Suite **434 → 435**, files unchanged at 36.

  **The seeded card is `generated`, not `accepted`, and that is a deliberate strengthening over the fix as written.** An `accepted` card leaves BOTH `countFlashcards` and `countFlashcardsInAnyState` answering 1, so the case would pass over the wrong helper. A `generated` card reads 0 through `countFlashcards` — the exact trap `countFlashcardsInAnyState`'s header was written for — so the case now pins the helper choice as well as the guard.

  Proved falsifiable in **both** directions, each restored and `src/pages/api/generate.ts` verified back to `0f69047609b94085b434f51302fa2c57`:

  | Neuter                                          | Observed                                                     |
  | ----------------------------------------------- | ------------------------------------------------------------ |
  | `if (count !== 0)` → `if (false)`               | **1 of 27 red**, the new case only, `expected 200 to be 409` |
  | `countFlashcardsInAnyState` → `countFlashcards` | **1 of 27 red**, the new case only, `expected 200 to be 409` |

  The 26 green beside each red are the evidence: they attribute the failure to the adoption gate rather than to the harness. Gates after the fix: `npm test` **435 passed / 435, 36 files**; `npm run typecheck` `Result (151 files): 0 errors`; `npm run lint` exit 0 with the same 3 pre-existing `evals/` warnings.

  Two drafting errors were caught before the case landed, and both would have made it silently wrong: `expectErrorBody`'s second parameter is a list of **forbidden** strings, so passing the expected message would have asserted its absence; and the first draft's deck name `Zajęta talia ${suffix}` collides with the ordinary-409 control above it, where `deck_user_name_unique` would have failed the setup rather than the case.

### F2 — The heal is single-use, so a transient failure after it strands `newDeckName` on a permanent 409

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality (reliability)
- **Location**: `src/pages/api/generate.ts:231`, `:259-266`, `:349-351`
- **Detail**: `healedKey` is a request-local `let`, and the key is cleared **before** the LLM call. Any failure between the heal and success forfeits the heal permanently, while the orphan deck survives — and the next retry then meets `existing && !healedKey`.

  Trace, every step on a path the code already handles:
  1. Poisoned state: session S keyed + `succeeded` + 0 cards, orphan deck "X" (the state `verification.md`'s reachability run reproduces — `deckUndone === false` at `:611-613` leaves the deck).
  2. Retry with key K: heals S (K cleared), adopts "X", then `generateCandidates` 502s → `:446` returns `502 retriable: true`. This is the transient class FR-018 is written for.
  3. Retry again with K: the lookup matches nothing (S is now unkeyed) → `healedKey` false → `:349-351` returns **`409 DECK_NAME_TAKEN_MESSAGE, retriable: false`**, so Phase 4's gate hides "Ponów".

  This is the outcome the comment at `:337-339` says the adoption rule exists to prevent ("trading a permanent 500 for a permanent 409 and fixing nothing"). Two things bound it honestly: it is **not a regression** — on `main` that user was on a permanent 500 either way — and it is user-recoverable, because deck "X" is a real owned deck visible in the dropdown, so the user can select it as an existing deck or rename. The failure surface after the heal is nonetheless wide: the language 400, both adoption 500s, the LLM 502/422, the deck-create 409/500, the session-insert 500 and the card-insert 500.

- **Fix A ⭐ Recommended (CHOSEN)**: Record the residual rather than re-architect. Add it to `change.md` as a decision and to `verification.md` §4 "What is NOT proved here", and scope the comment at `:337-339` so it claims the first retry rather than the class.
  - Strength: Matches what this repo does with every other measured boundary (D-04's reachability limit, `verification.md`'s Run 3 note that the confirmation proves _matched_, never _gone_). Zero risk to a change whose gates are all green, and the residual is strictly better than the pre-change state.
  - Tradeoff: The dead end stays reachable in a narrow window; a support report would have to be re-derived from the code unless someone reads the note.
  - Confidence: HIGH — the trace is confirmed by two independent readings and by the code paths above; the recovery route is confirmed (the deck is owned and listed).
  - Blind spot: Nobody has measured how often a 502 follows a heal in production; locally generation is mock, so the window is untestable here.
- **Fix B**: Defer the clear-and-confirm to immediately before `createGenerationSession` at `:512`, gating adoption on a `pendingHealSessionId` instead of `healedKey`.
  - Strength: The heal survives a transient failure — a pre-insert failure leaves the key intact so the next retry heals and adopts again. The `23505` loop stays impossible, because the clear still precedes the keyed insert.
  - Tradeoff: A failed clear is then discovered **after** a paid generation rather than before, which inverts the cost bound Critical Implementation Details makes the safety property of this change. Touches the phase all five breakage runs were measured against, so they would need re-running.
  - Confidence: MEDIUM — the ordering is sound on paper, but it moves the exact invariant the plan calls "the whole safety property".
  - Blind spot: Whether any path between `:512` and the adoption block can now observe a stale `healedKey`-derived deck decision has not been traced.
- **Decision**: **FIXED via Fix A** — the residual is recorded in three places rather than designed away, each chosen so a reader meets it where it bites. `src/pages/api/generate.ts`'s adoption block gains a comment-only paragraph ("WHAT THIS BUYS IS THE HEALED ATTEMPT, NOT THE CLASS") naming the forfeit, the wide post-heal failure surface, the recovery route, and the Fix-B trade with the reason it was declined. `change.md` gains **D-10**. `verification.md` § "What is NOT proved here" gains the full three-step trace with both honest bounds — not a regression, and recoverable — plus the declined alternative.

  Fix B was declined on the ground stated in its own tradeoff line: it moves the discovery of a failed clear to **after** a paid generation, inverting the cost bound `plan.md` calls "the whole safety property", and it would invalidate all five recorded breakage runs. **The `src/` diff for this whole review is comments only — proved, not asserted: `git diff -- src/` is 19 insertions / 0 deletions and every added line matches `^\+\s*//`.**

### F3 — Phase 4's seven manual criteria are checked with no recorded evidence

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `plan.md` Progress 4.5–4.11; `verification.md:213-215`
- **Detail**: Criteria 4.5–4.11 are the browser matrix for the `retriable` read and the stale-gate fix — the island half, which no layer in this project can reach. All seven are `- [x] … — dd7439f`. `verification.md` §4 points at "the browser matrix **recorded against Phase 4's Progress rows**", but those rows carry only a checkbox and a sha; commit `dd7439f` has a one-line message and no body. So the pointer is circular and the observations exist nowhere on disk.

  This is below the house standard set one change over: `context/archive/2026-07-31-deck-form-hardening/verification.md:21` carries an explicit "Manual, driven in a real browser against `npm run dev` (localhost:4321)" section with per-row observations. It is also the pointer-rot class `test-plan.md` §8 keeps recording in other documents. I am not claiming the checks were not performed — only that nothing on disk evidences them.

- **Fix**: Add a "Manual browser matrix (Phase 4)" section to `verification.md` with one row per criterion 4.5–4.11 and what was actually observed, then repoint §4's sentence at it.
- **Decision**: **FIXED — structure landed AND the matrix was run, 2026-08-13.** `verification.md` gains **§3b**, and it is filled rather than left open: **7 of 7 green**, driven in Chromium against `npm run dev` as the dedicated local account, with each row's oracle the pair `(banner text, is "Ponów" present)` read from the live DOM plus the audit row in psql wherever the branch writes one. §4's circular sentence is repointed at it.

  Three rows could not exist in mock mode and were provoked, each restored and verified: **4.6** by `revoke insert on public.flashcard` (grant restored, checked by the same three oracles §3 uses — `information_schema`, raw `pg_class.relacl` against untouched siblings, `has_table_privilege`); **4.5** by a bogus `OPENROUTER_API_KEY` in `.env` (`err=OpenRouter HTTP 401` and a `model` without the `(mock)` suffix prove a real call; `.env` restored to `md5 d56648ca7e65776ccf80bdd31f4dbc32`, and the developer's real key was never involved — it lives in the shell as `OPENROUTER_EVAL_KEY`); **4.9** by stopping the dev server, so the transport failure is genuine rather than stubbed.

  **4.6 is the row that justified the whole exercise.** Its 500 carries no `retriable` field at all, so a strict read of the flag would have removed "Ponów" from the exact failure this ticket exists for. Observed PRESENT — plan-review F3's concern confirmed empirically, and D-08 confirmed as the right call. Two branches are recorded as NOT driven: 4.5's 422 half (needs the seam D-04 withholds) and the fourth 409 at `:368` (needs a raced delete).

### F4 — Phase 3 added public surface that no plan contract and no change document names

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/lib/flashcards.ts:196-207`; `src/pages/api/generate.ts:357`, `:368`, `:375`
- **Detail**: Two benign additions, both correct, neither recorded. (a) `countFlashcardsInAnyState` is a **new exported helper** in a file the plan's "Changes Required" never lists; grep confirms it is named in no change document and not in `test-plan.md`. It is well justified at the site — a second function rather than a parameter, because `countFlashcards` filters `state_id = STATE_ACCEPTED` and a deck of un-reviewed candidates would read 0 through it, the §6.10 trap this repo already records. (b) The adoption path added three returns, including a **fourth 409** at `:368` (deck vanished between the two reads) which is the only 409 in the handler left unflagged. That omission is a written decision at `:362-367` and is sound — but Phase 4 §2's enumeration of "the 409s" now under-counts by one, so a future reader auditing the `retriable` census against the plan finds a discrepancy the plan cannot explain.
- **Fix**: One line each in `change.md`'s implementation notes — the new exported helper and why it is a second function, and the fourth 409 with a pointer to the decision at `:362-367`.
- **Decision**: **FIXED** — `change.md` gains **D-11**, naming both: `countFlashcardsInAnyState` as a new exported helper (a second function rather than a parameter, because `countFlashcards` filters `STATE_ACCEPTED` and a deck of un-reviewed candidates reads 0 through it — the §6.10 trap), and the fourth 409 as the one unflagged return, correcting Phase 4 §2's enumeration.

### F5 — The two C10X-50 exceptions carry no ticket annotation at their own sites

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/generate.ts:409`, `:458`
- **Detail**: The two failure-path `createGenerationSession` awaits are deliberately unchecked, but C10X-50 is named once, remotely, at `:576` — inside a comment about a different branch, ~120 and ~170 lines away. `:421-444` is a long comment at the first site that discusses `idempotency_key: null` and the index predicate without ever saying the await's result is dropped on purpose. The `deleteDeck` exception at `:569-576` is annotated correctly and is the model. This matters more than usual here, because this change's own `lessons.md` entry makes "a discarded compensating write" a named defect class — an unannotated bare `await` now reads as an instance of the rule the same commit wrote.
- **Fix**: One line at each site: `// Result deliberately unchecked — this exception is owned by C10X-50.`
- **Decision**: **FIXED** — both `createGenerationSession` sites now carry the annotation at their own site, each naming C10X-50 and stating why it is annotated there rather than only at the deck undo: an unannotated bare `await` on a write now reads as an instance of the rule this same change wrote into `lessons.md`.

### F6 — Two of the four new cases count cards deck-scoped without the `generation_id` assertion the plan requires

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `tests/generation/generate.test.ts:1101`, `:1190`
- **Detail**: Phase 5 §1's oracle constraints say "count cards by `generation_id`, never by deck and never by `front`". Only the poisoned case does: `:1053` asserts `new Set(cards.map(c => c.generation_id)).size === 1`. The user-emptied case and the adoption case assert `toHaveLength(COUNT)` on a deck-scoped read with no `generation_id` assertion beside it. The substance of the trap is avoided — `cardsOf` is a raw state-agnostic query, not `countFlashcards`/`listFlashcards`, and every deck involved is created inside its own case — so these oracles are sound rather than false. It is the letter of the stated constraint that is unmet, and closing it costs one line each and additionally proves the cards came from the _new_ session.
- **Fix**: Add `expect(new Set(cards.map((card) => card.generation_id)).size).toBe(1);` to both cases, reusing the shape at `:1053`.
- **Decision**: **FIXED** — added to both. On the user-emptied case it is more than letter-compliance and the comment says so: a length alone would also be satisfied by the ORIGINAL cards having survived the delete, so the single session id is what proves these are the healed run's cards.

## What was checked and found correct

Recorded so a later reader does not re-derive it:

- **The 23505 loop is genuinely bounded.** `:259-266` returns before `healedKey = true`; `clearSessionIdempotencyKey` carries `.select("id").maybeSingle()`, so a zero-row update resolves `{data: null, error: null}` and `!cleared` is a real arm. `generateCandidates` is unreachable on an unconfirmed clear.
- **An adopted deck is never deleted.** `createdDeckPublicId` is never assigned in the adoption block, and `:486` gates `createDeck` on `deckId === null`, so it cannot be assigned later either.
- **Adoption cannot cross accounts or fire without a heal.** `deckNameExists`, `deckIdByPublicId` and `countFlashcardsInAnyState` all run on the RLS-scoped client with no `user_id` predicate — RLS is the lock, per this project's documented pattern — and the `!healedKey` refusal is placed _first_, so the adoption block is unreachable without a heal.
- **The count oracle is state-agnostic**, and `count !== 0` correctly refuses on a `null` count too.
- **`canRetry` has no stale-flag path**: every one of the three `setStatus("error")` sites at `:194`, `:205`, `:217` is immediately preceded by a `setCanRetry`.
- **Test discipline is exemplary.** All five new case markers use `mark()`; every session read is `.like(scope(...))` on a short prefix, so there is no 414 risk; `allSessions` is status-agnostic; `sessionById`'s `.maybeSingle()` is a primary-key read and says why that is not the duplicate-detector trap; `seedSucceededSession` uses a case-scoped count of one against the C10X-39 replayed-POST trap; the new `describe` has no `beforeAll`, so every case owns the fixture it mutates and shuffle is safe; the cross-account case carries the owner's own call as a load-bearing positive control.
- **Doc-sync landed beyond the three edits the plan enumerated** — `test-plan.md`'s header block and §8, plus `roadmap.md`'s H-16 row, all recorded as D-09 in `change.md`. The applied migration's stale header is correctly left unedited.
