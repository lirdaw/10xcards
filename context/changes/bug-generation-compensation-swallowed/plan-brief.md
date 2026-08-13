# Swallowed compensation error — Plan Brief

> Full plan: `context/changes/bug-generation-compensation-swallowed/plan.md`
> Research: `context/changes/bug-generation-compensation-swallowed/research.md`

## What & Why

`/api/generate` compensates a failed card insert by flipping its already-written
`generation_session` row to `failed` — and throws that write's result away. When the
compensation itself fails, the row survives as `succeeded`, `saved_count > 0`, keyed, with zero
cards behind it: the audit lies, and every "Ponów" on that key replays into a permanent 500.

That is not a corner case. Research §2 shows the realistically reachable causes of the card-insert
failure are dominated by transport and auth failures — and those are precisely the causes under
which the compensating UPDATE, issued ~1 ms later on the same connection and the same token, also
fails. **On the most likely road to this branch, the compensation is expected to fail too.**

## Starting Point

`generate.ts:392-403` holds the two swallowed `await`s this ticket owns — the compensation and the
deck undo beside it. It is **not** the only pair in the file: research §1 enumerates five swallow
sites, and the other three (`:277`, `:314`, `:387`) belong to C10X-49 and C10X-50 and are out of
scope here. And checking the result would not be enough:
`failGenerationSession` issues no `.select()`, so a zero-row UPDATE — which is what RLS produces
when the row vanished or `auth.uid()` is unreadable — resolves `{ data: null, error: null }`. The
matching precedent already exists two files away, in `deleteDeck`.

The replay path compounds it: `generationResultByGenerationId` correctly separates "the query
failed" from "this session is empty", and `replaySession` collapses both into one 500 at
`generate.ts:121`.

## Desired End State

A failed card insert can no longer leave a replayable session — the compensation retires the row
(status flipped **and** key nulled) and reports whether it landed. When it provably did not, the
endpoint says so in its own copy and marks the failure retriable, because the next attempt now
genuinely heals it: a key resolving to a succeeded-but-empty session has its **key cleared** —
and only the key, since the heal cannot tell a poisoned row from one the user emptied — the update
is confirmed to have matched, and the request falls through to an ordinary generation. One click.
If the update does not match a row, the request refuses **before** paying for an LLM call. And on
the `newDeckName` path the fall-through adopts the orphan deck the failed attempt left, so the
heal does not trade a permanent 500 for a permanent 409.

## Key Decisions Made

| Decision                     | Choice                                                                     | Why (1 sentence)                                                                                                                             | Source              |
| ---------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Fix family                   | (a) harden + (c) self-heal; **no** migration                               | Closes both claims without a schema change, and is the only family that also fixes the §6 dead-end reachable with no failed write at all     | Plan                |
| Retired row's key            | Compensation: null the key **and** flip the status, in one UPDATE          | The row leaves the partial index for two independent reasons — the independence impl-review F3 deferred in July                              | Plan                |
| What the HEAL may touch      | The key **only** — never `status`, `saved_count` or `error_message`        | The heal cannot tell a poisoned row from one the user emptied, and in the second case `saved_count` is true — retiring it would destroy that | Plan-review F2      |
| newDeckName after a heal     | Adopt an owned EMPTY deck of that name, gated on the healed path           | Hardening `:400` only DETECTS the failed undo; without adoption the heal trades a permanent 500 for a permanent 409                          | Plan-review F1      |
| Compensation provably failed | Own Polish copy + `retriable: true`                                        | The state stops being unnameable, and "spróbuj ponownie" becomes true instead of guaranteed false                                            | Plan                |
| C10X-49 twin                 | Only `generate.ts:400`, for VISIBILITY of the failed undo                  | It does not delete the orphan deck; `:387` stays with C10X-49                                                                                | Plan + F1           |
| Self-heal mechanics          | Clear the key → **confirm a row matched** → fall through                   | The confirmation is what disarms research §7's `23505` loop, and bounds the failure at zero paid LLM calls                                   | Research §7 + Plan  |
| `retriable` flag             | The island reads it, with **absent treated as retriable**                  | Only 2 of 20 returns carry the flag today, so a strict read would remove "Ponów" from every transient 500 — including this ticket's own      | Plan-review F3      |
| Reachability proof           | Zero-row arm tested cross-account; endpoint reachability by one manual run | The zero-row arm needs no seam at all under RLS, so only the endpoint's ability to produce the row rests on a manual, unguarded run          | Research §8 + F5    |
| Existing poisoned cloud rows | Nothing — the replay heals them lazily                                     | A cleanup UPDATE would, by construction, also strip keys from §6 rows, which are byte-identical and never failed                             | Plan                |
| `lessons.md`                 | New rule, in this ticket                                                   | The class has no rule; the nearest one covers reads only, and "best-effort" spread by adjacency because it was a comment, not a decision     | Research OQ6 + Plan |

## Scope

**In scope**

- `failGenerationSession` → `retireGenerationSession`, a checked, key-retiring write
- A second, narrower write for the heal: `clearSessionIdempotencyKey`, which touches the key alone
- A pure replay classifier splitting query-failure from empty-session
- The `cardsError` branch checks both of its writes, including the `deleteDeck` at `:400`
- Self-healing replay at `:186`; clear-and-refuse at the `23505` branch `:377`
- Deck adoption on the healed `newDeckName` path, gated on the heal and never on emptiness alone
- The island derives `canRetry` from the response (absent = retriable) and the endpoint marks the
  genuinely non-retriable returns; plus the narrow "banner gone, Ponów stays" fix
- Integration tests for the consequence half and the zero-row arm, unit tests for the classifier,
  five recorded breakage runs
- `lessons.md` rule + doc-sync

**Out of scope**

- Any migration, any third `status` value, any change to the write ordering (research §7 family b)
- Any backfill of already-poisoned cloud rows
- Telling a poisoned row apart from a user-emptied one (byte-identical; needs a new column)
- `generate.ts:387` (C10X-49) and `:277` / `:314` (C10X-50)
- `review.astro`'s misattribution of the missing cards to generation loss

## Architecture / Approach

Three layers, in dependency order. The **decision** leaves the handler as a pure function over
`(queryError, result)` — the `readJsonResponse` / `rateOutcome` shape test-plan §7 records as how
this project makes handler-bound decisions testable. The **writes** become real: `.select()` is
what makes a zero-row UPDATE visible, and there are two of them because the two callers know
different things — the compensation retires a row it knows failed, the heal only disarms one it
cannot judge. The **I/O ordering** stays in the endpoint, where the one safety property lives —
clear the key, confirm, only then generate.

The two `replaySession` call sites are deliberately asymmetric: `:186` runs before the LLM call and
can fall through; `:377` runs after a paid generation, so it clears the poisoned winner's key and
refuses, letting the user's next click generate cleanly.

## Phases at a Glance

| Phase                             | What it delivers                                                                      | Key risk                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1. Classifier + lib contract      | Pure replay decision; two checked writes — retire (compensation) and clear-key (heal) | The old symbol sits at eight sites; six are renames and two are corrections that must not be confused |
| 2. Compensation stops swallowing  | Both writes in the `cardsError` branch checked; distinct retriable copy               | No test can observe this branch, so it is carried by reading until Phase 5's manual run               |
| 3. Self-healing replay + adoption | Poisoned key heals in one click; the healed `newDeckName` path adopts its orphan deck | Getting clear/confirm/fall-through out of order reproduces the `23505` loop after a paid call         |
| 4. Island reads `retriable`       | "Ponów" survives every retriable failure and disappears from the rest                 | No layer in this project reaches an island — evidence is a manual browser matrix                      |
| 5. Proof + docs                   | Integration tests, five breakage runs, `lessons.md`, doc-sync                         | Endpoint-level reachability is proved once by hand and is **not** guarded regressively                |

**Prerequisites:** local Supabase stack up (`npm run db:start`), `OPENROUTER_API_KEY` unset (mock
generation), a browser for Phase 4's matrix, and psql access to the local stack for Phase 5's DCL run.

**Estimated effort:** ~2–3 sessions across 5 phases; phases 1–3 are the bulk, 4 is small but
manual-heavy, 5 is evidence work.

## Open Risks & Assumptions

- **The `23505` loop is derived, not executed.** Research §7 reasons it from the index predicate
  and the code. Phase 5's first breakage run is where it gets confirmed — and if it does not
  reproduce, the confirmation step is still correct but its stated justification needs rewording.
- **Assumption: retrying the compensation in a _later_ request has a materially better chance than
  retrying it 1 ms later in the same one.** The correlated-failure argument (§2) is about
  simultaneity; the self-heal depends on those causes being transient. If a cause is permanent (a
  revoked grant), the heal refuses cleanly instead of looping — which is the designed behaviour,
  not a hole.
- **Endpoint-level reachability carries no regression guard.** A future edit could re-swallow the
  compensation and the suite would stay green. The write's zero-row arm _is_ guarded (Phase 5 §1);
  the endpoint's ability to produce the poisoned row is not. Named in the plan and in the doc-sync
  rather than papered over.
- **Phase 4 touches a layer nothing tests.** Every claim there rests on a manual matrix.
- Whether any poisoned rows exist in the cloud today is **unknown and deliberately unmeasured**.
- **"Ponów" now costs money on the healed path.** Bounded to once per key by the key-clearing step,
  and free locally under mock generation — but it is a real change from a free 500.

## Success Criteria (Summary)

- A "Ponów" whose key points at a session with no cards generates cards instead of failing forever —
  including on the `newDeckName` path, where it no longer 409s on its own orphan deck.
- A failed card insert never leaves behind a session that claims it saved cards it did not save —
  and the fix never rewrites a session that was telling the truth.
- When the rollback provably fails, the user is told so — and told to retry only because retrying
  now actually works.
