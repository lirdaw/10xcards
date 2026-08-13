---
date: 2026-08-12T23:07:33+02:00
researcher: lirdaw
git_commit: efc6aebe622877866b3e1ede0f98243ab1d0832f
branch: main
repository: lirdaw/10xcards
topic: "Swallowed compensation error leaves a lying succeeded session and a dead retry (C10X-48)"
tags: [research, codebase, generate-endpoint, idempotency, compensation, error-handling, FR-018]
status: complete
last_updated: 2026-08-12
last_updated_by: lirdaw
---

# Research: Swallowed compensation error in `/api/generate` (C10X-48)

**Date**: 2026-08-12T23:07:33+02:00
**Researcher**: lirdaw
**Git Commit**: `efc6aeb`
**Branch**: `main`
**Repository**: lirdaw/10xcards

## Research Question

`src/pages/api/generate.ts:396` awaits `failGenerationSession(...)` and discards its
`{ error }`. On a double failure (card insert fails, compensation also fails) the
`generation_session` row stays `status='succeeded'` with `saved_count > 0` and its
`idempotency_key` intact while zero cards exist — so the audit row lies, and a retry with
that key replays into a permanent 500, inverting FR-018.

Scope agreed with the user before research: the compensation error path **plus** its two
swallowed twins in the same handler (`deleteDeck`), and a fix space covering all three
families — (a) handling the compensation error, (b) changing the write **ordering** so
compensation is unnecessary, (c) making the **replay** self-healing.

## Summary

**The bug reproduces exactly as `change.md` states, and research sharpened it in five ways
that change how it should be judged and fixed.**

1. **It is not a rare corner.** The realistically reachable causes of `cardsError` are
   dominated by transport/auth failures (Kong keep-alive `502`, expired token, PostgREST
   down) — and those are precisely the causes under which the compensating UPDATE, issued
   ~1 ms later on the same client, same token, same proxy, **also fails**. The _independent_
   causes (content CHECK, FK violations) are engineered close to unreachable. So on the most
   likely road to `cardsError`, the compensation is **expected** to fail too.

2. **Checking `error` is necessary but not sufficient.** `failGenerationSession` issues no
   `.select()`, so a PostgREST UPDATE matching **zero rows** resolves
   `{ data: null, error: null }`. Under RLS a vanished row or a null `auth.uid()` produces
   exactly that. A fix that only adds `if (error)` still cannot tell a landed compensation
   from a no-op.

3. **The user really does loop, and the escape is one click.** The "Ponów" gate ignores the
   `retriable` flag entirely — `retriable` is emitted by the endpoint at
   `generate.ts:302,329` and **read nowhere in `src/`**. `canRetry` is set `true` before the
   fetch is even issued (`GeneratorForm.tsx:160`), so a plain 500 shows "Ponów", and
   "Ponów" replays the same key verbatim → the same 500, forever. A fresh **"Generuj"**
   mints a new key (`GeneratorForm.tsx:147`) and escapes — _unless_ the twin swallowed
   `deleteDeck` left an orphan deck, in which case the fresh submit hits a permanent `409`
   on the name. The two swallowed sites compose into a genuinely stuck state.

4. **The naive self-healing replay is a trap.** If `replaySession` on zero cards simply fell
   through to a normal generation, the new session insert would carry the same key with
   `status='succeeded'` → collide with the still-`succeeded` lying row on
   `generation_session_idempotency_key_uidx` → `23505` → the handler at `generate.ts:374-379`
   looks the key up again → finds the same lying row → `replaySession` → the same 500. Net
   result: **a paid LLM call, then the identical error.** Self-healing only works if the
   poisoned row is cleared first (or the retry's session is written key-less).

5. **The replay dead-end is reachable with no failed write at all.** A user who deletes all
   of a generation's cards — or deletes the deck (`flashcard.deck_id … on delete cascade`,
   while `generation_session` has **no deck FK**) — leaves a byte-identical row shape. The
   replay half of this bug is therefore a live defect on its own, and it is **testable today
   with zero fault injection**.

**Prior art**: the primary effect was written down once, on 2026-07-18, as an aside in a
research doc — "_If that compensating UPDATE itself fails, an over-reporting `succeeded`
session persists_" — and never became a finding, a risk row, or a ticket. The impl-review
that introduced the compensation (F2) never considered it failing; the impl-review that
copied the pattern (F4) accepted "_can itself fail_" as a Tradeoff bullet and never returned
to it. `replaySession` appears **nowhere** in `context/` — the replay-with-no-cards path has
never been analysed by anything.

## Detailed Findings

### 1. The defect site, and the four other swallowed results beside it

Five `await`s in `src/pages/api/generate.ts` discard their result entirely. Every other
`await` in the file branches on `error` first — which is what makes these five stand out
rather than read as house style.

| Site              | Call                                                          | Ticket                    | Consequence of silent failure                    |
| ----------------- | ------------------------------------------------------------- | ------------------------- | ------------------------------------------------ |
| `generate.ts:396` | `failGenerationSession(...)`                                  | **C10X-48** (this change) | Lying `succeeded` row + permanent replay 500     |
| `generate.ts:387` | `deleteDeck(...)` after session insert failed                 | C10X-49                   | Empty orphan deck → permanent `409` on that name |
| `generate.ts:400` | `deleteDeck(...)` after card insert failed                    | C10X-49                   | Same, and it composes with C10X-48 (see §4)      |
| `generate.ts:277` | `createGenerationSession(... status:"failed")` transport path | C10X-50                   | Audit row for a failed LLM call silently lost    |
| `generate.ts:314` | `createGenerationSession(... status:"failed")` 0-saved path   | C10X-50                   | Same, plus the 422/502 discriminator pair        |

`failGenerationSession` (`src/lib/generations.ts:119-124`) has **exactly one caller** —
`generate.ts:396` — and no caller checks its error. It is a plain (non-`async`) function
returning the `PostgrestFilterBuilder`, matching the module contract at `generations.ts:5-8`
("_Returns the raw `{ data, error }` like the other helpers_"). Changing its signature
touches one call site only.

An **adjacent** swallow that is in none of the five audit tickets sits inside the very block
being fixed: `generate.ts:374-379` folds the 23505-replay lookup's own `error` into the
generic 500 (it is used only to _skip_ the replay).

### 2. Why the double failure is common, not exotic — the correlated/independent split

Every way `insertCandidates` (one atomic multi-row INSERT, `generations.ts:140-156`) can
fail, classified by whether the follow-up UPDATE on a _different table_ would also fail:

**Independent (compensation would succeed):**

- `flashcard_front_check` / `flashcard_back_check` (`20260728104500_flashcard_content_bounds.sql:41-51`) — **provably unreachable**: that migration's own comment proves `char_length() ≤ JS .length` always (code points vs UTF-16 units), so the CHECK is strictly _looser_ than Zod's `.max()` in `openrouter.ts:32-35`, which already drops over-length cards individually.
- `flashcard_deck_id_fkey` (deck deleted concurrently), `state_id`/`source_id` FKs (dictionaries write-proofed by two enforcers), NOT NULLs (all six fields supplied literally), `public_id` collision.

**Correlated (compensation fails too):**

- Transport: Kong keep-alive `502`, connection reset, PostgREST/Postgres down, statement timeout, pool exhaustion.
- Auth: access token expired at PostgREST — realistic, because up to `SERVER_TIMEOUT_MS` **40 s** of LLM wall-clock elapses _before_ either write (`generate.ts:67`).
- Grant revoked from `authenticated` — a broad revoke hits both tables.

**Pathological hybrid:** `flashcard_generation_id_fkey` — the session row itself vanished
(e.g. `auth.users` cascade). Both operations depend on that row, and the UPDATE then matches
**zero rows with `error: null`**, so even a corrected error check reports success.

The independent causes are engineered close to unreachable; the correlated ones are the live
ones. **The bug's premise is the common case on this branch, not the corner case.**

### 3. The zero-row blind spot — why `if (error)` is not the whole fix

```ts
// src/lib/generations.ts:119-124
export function failGenerationSession(supabase: Client, id: number, message: string) {
  return supabase
    .from("generation_session")
    .update({ status: "failed", saved_count: 0, error_message: message })
    .eq("id", id);
}
```

No `.select()` → under the default `Prefer: return=minimal` a success returns
`{ data: null, error: null, count: null }`. So `data` cannot distinguish a real update from
a 0-row no-op, and PostgREST returns **no error** for the 0-row case. Silent-no-op routes:
the row deleted between INSERT and UPDATE; `auth.uid()` unreadable in that request context;
the update policy dropped or narrowed.

Precedent for the fix shape is two files away: `deleteDeck` (`src/lib/decks.ts:40-42`) adds
`.select("public_id").maybeSingle()` with a comment stating exactly this reason — "_under RLS
a foreign deck's delete is silently a no-op, not an error, so without this the caller cannot
distinguish it from success_". `failGenerationSession` never got the same treatment.

Nothing on the row can reject the compensating write: `'failed'` is admissible under the
`status` CHECK, `saved_count = 0` fits `smallint`, `error_message` is unconstrained `text`,
and **there are zero triggers on `generation_session`** (the only three triggers in the whole
migration set are the `updated_at` ones on `deck` / `flashcard` / `flashcard_schedule`).

### 4. What the user experiences, and how the twins compose

Measured in `src/components/generate/GeneratorForm.tsx` (which, note, does **not** use
`src/lib/http.ts` — `readJsonResponse` has exactly two call sites, both in `StudySession.tsx`):

- **Key lifecycle**: minted once per submit inside `validate()` (`:147`), stored in
  `lastPayload` (`:159`). `handleRetry` re-sends that object verbatim (`:206-208`);
  `handleSubmit` re-runs `validate()` and mints a **new** key.
- **The "Ponów" gate is `status === "error" && canRetry`** (`:336`). `canRetry` is set `true`
  at `:160`, _before the fetch_, and set `false` at exactly one place — the client-side
  validation branch (`:198`). **It never reads the response body**, so `retriable` (declared
  at `:89`, emitted at `generate.ts:302,329`) is dead weight: grep over `src/` finds no
  reader. A plain 500 therefore shows "Ponów".
- **The user-visible tell**: the copy _changes_ on the first Ponów — "Nie udało się zapisać
  wygenerowanych fiszek" → "Nie udało się odtworzyć wyników generacji" — while the button
  keeps rendering.
- **Escape**: one click on "Generuj" (new key, bypasses the replay lookup entirely). Source
  text is retained; the submit button is enabled.

**Where the twins compose into a stuck state.** On the `newDeckName` path the `cardsError`
branch also runs `deleteDeck` (`:400`), swallowed. If that fails, the empty orphan deck
survives, and the fresh-submit escape hits `deckNameExists` → `409 DECK_NAME_TAKEN_MESSAGE`
(`:249-255`) until the user changes the name. So C10X-48 kills the _keyed_ retry and C10X-49
kills the _fresh_ one. On the existing-deck path there is no such blocker.

A separate artifact of the gate, worth noting because it is a second small defect: typing in
the textarea clears `error` but not `status` (`:222`, `:285`, `:304`), so the banner
disappears while "Ponów" stays on screen — clicking it then re-sends the _old_ payload and
silently discards what the user just typed.

### 5. Blast radius of the lying row — four readers

| Reader                                 | Site                                           | Effect                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findSucceededSessionByIdempotencyKey` | `generations.ts:50-57`                         | **The trap door** — the only `status='succeeded'` filter in `src/`. Matches the lying row and hands it to `replaySession`.                                                                                                                                                                                                                                     |
| `replaySession`                        | `generate.ts:116-134`                          | Never reaches its counts; dies at `:121-123`.                                                                                                                                                                                                                                                                                                                  |
| Review screen loader                   | `decks/[publicId]/review.astro:60,104,190-201` | **Does not project or check `status` at all.** Renders a lying session as ordinary: "Zaakceptowano 0 z 0", plus — because `session.generated_count > metric.total` — the sub-line _"Model zwrócił N kart; w talii jest 0 — różnica pochodzi z generacji, nie z przeglądu"_, i.e. the UI actively **misattributes a failed write to Zod-side generation loss**. |
| `generationStateCounts`                | `generations.ts:102-113`                       | Reads `flashcard.state_id`, not the counters (deliberately) → silent `{0,0,0}` with `error: null`, so the guard at `review.astro:107` passes.                                                                                                                                                                                                                  |

Nothing in `src/` displays `generation_session.status`, and nothing ever deletes a session
(the RLS delete policy at `20260712162349:73-74` has no caller).

### 6. The replay dead-end exists without any failed write

Three paths reach `succeeded` + `saved_count > 0` + key + zero cards:

1. **User deletes the generation's cards** (`cards/[cardPublicId]/delete.ts:44` → hard DELETE). Nothing touches the session; there is no upward cascade. `generations.ts:75-76` explicitly anticipates this ("all deleted since").
2. **User deletes the deck** — `flashcard.deck_id … on delete cascade` (`init_core_schema.sql:60`) removes every card, while `generation_session` has **no deck FK** at all (`20260712162349:21-36`), so the session survives untouched.
3. The endpoint's own deck undo (`generate.ts:387,400`) uses the same `deleteDeck`, hence the same cascade — which is why matrix row F1 loses the cards _and_ keeps the session.

Practical reachability of paths 1–2 is bounded by where the key lives (React state in one
un-reloaded `GeneratorForm`), so it needs a stale tab. The distinguishing fact stands: in
paths 1–2 the user caused the emptiness and `saved_count` is truthful about what once
landed; in the C10X-48 state nothing ever landed and the row asserts otherwise.

**Consequence for scoping**: the _lying audit row_ is unique to the swallowed compensation;
the _replay dead-end_ is not. They are two claims that can be fixed — and tested —
separately.

### 7. Fix space (all three families the user asked for)

**(a) Handle the compensation error.** Smallest diff, one call site. Two constraints from
§3: it needs `.select(...)` to see the 0-row case, and — because the causes are correlated
(§2) — an immediate in-request retry on the same dead connection is unlikely to help. Design
question it forces: _what does the handler do when compensation provably failed?_ Options
include nulling the `idempotency_key` instead of (or besides) flipping status — which
**removes the row from the partial index** just as effectively, and which
`impl-review F3:169-171` already considered and explicitly deferred ("_not recommended
without deciding whether the audit row should keep the key_"). That deferred decision is now
forced.

**(b) Change the write ordering.** Two shapes:

- _Third status value_ — **needs a migration**: `status text not null check (status in ('succeeded','failed'))` (`20260712162349:31`) admits nothing else; `'pending'` raises `23514`. Precedent for the drop+add pattern exists at `20260728104500:41-51`. Note `src/db/database.types.ts:233,250,259` types `status` as bare `string`, so a third state compiles cleanly and fails only at runtime. Under this shape the session is written non-replayable, cards are inserted, then a flip to `succeeded` — a failed flip leaves a _safe_ row and compensation disappears.
- _Genuine atomicity_ — a data-modifying CTE or a `plpgsql SECURITY INVOKER` RPC writing session + cards in one transaction. Precedent exists in this repo (`study_due_cards`, `search_flashcards_in_deck`, `candidate_counts_by_deck` are all invoker-side functions). This eliminates the compensating UPDATE entirely rather than hardening it. Cost: the endpoint's whole write path moves into SQL.

The FK `flashcard.generation_id → generation_session.id` is what forces session-before-cards
(impl-review F2 called the ordering un-invertible for exactly this reason) — but that
argument constrains the _order_, not the _status the session is born with_, and not
atomicity. **A DB-level invariant is not an option**: CHECK cannot subquery, and the
invariant is deliberately false in normal operation (`generations.ts:95-101` — `saved_count`
is not a live-row counter; the review screen deletes cards without touching it).

**(c) Self-healing replay.** The conflation is real and is this project's own recurring
lesson violated at the one site nobody checked: `generations.ts:73` returns
`{data:null, error}` for a **query failure** and `:79-80` returns `{data:null, error:null}`
for **zero cards** — two different facts collapsed into one `data === null`, which
`generate.ts:121-123` maps to a single 500. Splitting them is right on the merits.

**But the naive version makes things worse** (derived from the index predicate plus the
code; worth confirming by execution before relying on it): falling through to a normal
generation re-inserts a session with the same key and `status='succeeded'` → `23505` on
`generation_session_idempotency_key_uidx` → the `:374-379` handler looks the key up → finds
the same lying row → `replaySession` → the same 500, now after a **paid** LLM call. A
self-healing replay must first clear the poisoned row (checked), or write the retry's
session key-less.

These three families are not exclusive; (b) or (c) each subsume part of (a).

### 8. Test reachability — the decomposition that unblocks it

**Existing coverage is zero, three times over and independently recorded.** No test
references any of the four strings identifying these branches; `failGenerationSession` has
no caller in `tests/`; the archived mutation register lists the whole function as **5
NoCov** (`2026-07-18-mutation-generate-risk2/mutation-register.md:50`) — and both files are
in Stryker's permanent `mutate` list, so that gap is measured, not assumed.

**The bug decomposes into two claims with very different costs:**

- **Consequence — testable _today_, no fault injection.** Seed the lying row directly with an RLS-scoped insert (exact precedent: `generate.test.ts:352-363` already seeds a _failed_ keyed row by hand), then one ordinary `POST /api/generate` with that key → `generate.ts:178-188` → match → `replaySession` → zero rows → **500**, deterministically.
- **Reachability (that the endpoint can _produce_ the row)** — needs both failures. No committed-test route exists without either DDL/DCL against the shared local stack (blast radius: shuffle is on and files run in parallel) or a **new** transport seam that _fabricates_ a response. That is not a granted precedent: `tests/setup/retry-transport.ts` fabricates nothing and says so, and §6.9 confines module doubles to one file. **It needs a written decision, not an imitation.**

Oracle constraints that would bite (all from test-plan's own recorded traps): use a
status-**agnostic**, marker-scoped session read (`succeededSessions` filters
`status='succeeded'` and is blind to the correct-behaviour case); key the zero-cards half on
`generation_id`, never on the deck and never on `front` (`countFlashcards`/`listFlashcards`
filter `state_id = STATE_ACCEPTED` and read 0 whatever happens; `mockCards` repeats fronts,
so `front` is not an identity); never `.single()`/`.maybeSingle()` as a count. And the
response can **never** be the oracle for the compensation half — because `:396` discards the
result, a landed and a failed compensation produce a byte-identical HTTP response.

**Pure-function seam**: the replay decision is genuinely extractable —
`(sessionCounters, cards | null, queryError)` → `{kind:"replay"|"unreplayable"|"queryFailed"}`,
in the `readJsonResponse` / `rateOutcome` mould. The compensation decision is **not** yet
extractable: today there is only one code path, and the likely fix is I/O rather than a
decision, so a pure function could decide _what to attempt_ and never that it landed.

## Code References

- `src/pages/api/generate.ts:392-403` — the defect: `cardsError` branch, swallowed compensation, swallowed deck undo
- `src/pages/api/generate.ts:116-134` — `replaySession`, and the 500 at `:121-123`
- `src/pages/api/generate.ts:178-188` — the keyed replay lookup that matches the lying row
- `src/pages/api/generate.ts:368-390` — the `23505` → replay branch that a naive self-heal would loop through
- `src/pages/api/generate.ts:277,314,387,400` — the four swallowed twins (C10X-49, C10X-50)
- `src/lib/generations.ts:119-124` — `failGenerationSession`: no `.select()`, one caller, error discarded
- `src/lib/generations.ts:67-89` — `generationResultByGenerationId`: error-vs-empty conflated at `:73` and `:79-80`
- `src/lib/generations.ts:95-101` — why `saved_count` is not a live counter (plan-review F6)
- `src/lib/decks.ts:37-42` — `deleteDeck`'s `.select().maybeSingle()` and the comment stating the 0-row rule
- `src/components/generate/GeneratorForm.tsx:147,158-163,196-208,336-347` — key minting, `canRetry`, the retry gate
- `src/pages/decks/[publicId]/review.astro:60,104,190-201` — the screen that misattributes the lost write to generation
- `supabase/migrations/20260712162349_generation_session.sql:21-36,58-74` — table, `status` CHECK, RLS policies
- `supabase/migrations/20260725133600_generation_idempotency_key.sql:27-49` — the partial index and its `impl-review F3` header
- `supabase/migrations/20260728104500_flashcard_content_bounds.sql:26-51` — the CHECK, and the proof it is looser than Zod
- `tests/generation/generate.test.ts:336-387` — the seeded-`failed`-keyed-row precedent a test would copy

## Architecture Insights

- **"Best-effort" entered this codebase as a code comment, never as a decision.** The
  impl-review that created the compensation (F2) does not contain the phrase and never
  raises the failure mode; the impl-review that copied the pattern (F4) justified it by
  _symmetry_ with F2 and accepted "can itself fail" as an unfollowed Tradeoff bullet. Two
  compensations, one unexamined default, propagated by adjacency.
- **The endpoint preaches error-vs-empty in five comments and violates it once.**
  `generate.ts:180`, `:206-209`, `:234-236`, `generations.ts:29-31` and `flashcards.ts:86-88`
  all cite the `lessons.md` rule; `generationResultByGenerationId` collapses the two facts at
  the single site whose caller then maps both to a permanent 500.
- **The partial index's `status='succeeded'` predicate is the load-bearing safety property,
  and this bug is its inverse.** The predicate exists so a _compensated_ row can never be
  replayed (`migration:27-36`, impl-review F3). Swallowing the compensation means the row is
  never compensated — so the predicate's protection is bypassed not by removing it, but by
  never satisfying its precondition.
- **A swallowed result is invisible at every layer this project has.** No `console.*` is
  permitted in `src/` (`tests/lib/no-logging.test.ts`), so Sentry's
  `captureConsoleIntegration` catches none of it — stated in four places from the
  `sentry-monitoring` slice — the response body is identical either way, and no test reaches
  the branch. The only witness is the row.
- **`retriable` is a contract with no consumer.** The endpoint distinguishes retriable
  (502/422) from non-retriable (500) failures; the island shows "Ponów" for all of them.
  Either the flag should be read or it should be removed — carrying it unread is how a
  future reader concludes the distinction is enforced.

## Historical Context (from prior changes)

- `context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:50-65` — **F2**,
  which created `failGenerationSession`. Rated "quick decision; fix is obvious and narrowly
  scoped"; the compensation's own failure is never mentioned.
- `context/archive/2026-07-25-candidate-review/reviews/impl-review.md:177-220` — **F4**, the
  `deleteDeck` undo. Line 198 is **the only place in the entire `context/` tree** that says a
  best-effort compensation can itself fail, and it says it as an accepted tradeoff. `:216-218`
  records "_Not covered by a test, deliberately … the suite has no seam for one_".
- `context/archive/2026-07-25-candidate-review/reviews/impl-review.md:132-175` — **F3**, which
  established that a compensated row keeps its key, and at `:169-171` considered nulling the
  key inside `failGenerationSession`, deferring it pending a decision on whether the audit row
  should keep the key. **That deferral is now forced.**
- `context/archive/2026-07-25-candidate-review/reviews/plan-review.md:42-69` — **plan-review
  F1**, the original "retry dead forever" analysis. It is about a _different_ 500 (collision on
  the session insert), not `replaySession`'s.
- `context/archive/2026-07-18-ai-candidate-generation-test/research.md:92-103` — **the only
  prior statement of this bug's primary effect**: "_If that compensating UPDATE itself fails,
  an over-reporting `succeeded` session persists._" Written as characterisation, never
  escalated. It stops one step short of the poisoned replay.
- `context/archive/2026-07-18-mutation-generate-risk2/mutation-register.md:29-34,49-50` — the
  whole of `failGenerationSession` recorded as **5 NoCov**, with the reason: reaching it needs
  an HTTP-seam stub or injected DB failure, "_which this change deliberately does not
  introduce_".
- `context/archive/2026-08-02-typecheck-gate/plan.md:809` — C10X-43 measured
  `generationResultByGenerationId` returning `{data:null, error:null}` for an empty session and
  recorded that **the empty branch has no test coverage**. It asked what the _type_ was, never
  what the caller does with it.
- `context/archive/2026-08-11-sentry-monitoring/research.md:55-64,231-248` — the swallowed-error
  audit has **no repo artifact**; it lives in `context/foundation/jira-map.md:155-159` and in
  Jira. C10X-48 is hit #1 and the audit's **only High priority**; `jira-map.md:189-191` already
  links **C10X-48 ↔ C10X-26** ("_bug psuje ścieżkę replay po idempotency-key, którą C10X-26
  testuje_").
- `context/foundation/lessons.md` — grep finds **no** lesson about swallowing a write result or
  about best-effort compensation. The nearest is the SSR error-vs-empty rule (`:68-73`), which
  covers reads only.

## Related Research

- `context/archive/2026-07-18-ai-candidate-generation-test/research.md` — write-order table and the partial-write enumeration
- `context/archive/2026-07-26-ai-candidate-generation-test-2/research.md:220-235,543-546` — every rejection branch mapped to its write state, plus two _other_ unaudited compensation-ordering gaps of the same class
- `context/archive/2026-08-11-sentry-monitoring/research.md:226-269` — why the monitoring layer cannot see this class, and a list of adjacent swallow sites outside the audit

## Open Questions

1. **Which fix family, and does this ticket own more than one?** (a) is the smallest diff but
   leaves the replay dead-end reachable by ordinary card deletion (§6); (c) fixes that but is
   worse than useless without clearing the poisoned row first (§7); (b) removes the failure
   mode instead of handling it, at the cost of a migration or a move into SQL.
2. **Should a compensated/poisoned audit row keep its `idempotency_key`?** Deferred by
   impl-review F3 in July, unavoidable now — nulling the key is an alternative to flipping the
   status and would make the two idempotency guards genuinely independent, as they were once
   wrongly documented to be.
3. **Is the C10X-49 twin in scope here?** Research covered it per the agreed breadth, and §4
   shows the two defects _compose_ into a state neither produces alone — but they are separate
   tickets and the boundary is a scoping decision, not a research finding.
4. **Is a fabricating transport seam granted for the test harness?** Proving _reachability_
   needs one; §6.9's precedent explicitly does not cover it. If the answer is no, the change
   can still prove the _consequence_ half plus a pure-function replay decision, and must say so
   rather than let a green suite imply more.
5. **Unverified empirically**: (i) the `23505` loop a naive self-heal would produce — derived
   from the index predicate and the code, not executed; (ii) whether a NUL or lone surrogate in
   a card can make `insertCandidates` genuinely fail through the real endpoint (the only
   identified content route to failure #1, since the CHECK is provably looser than Zod).
6. **Does this warrant a `lessons.md` entry?** The class — a compensating write whose own
   result is discarded, invisible at every layer, propagated by symmetry across two sites and
   five tickets — has no rule, and the existing error-vs-empty lesson covers reads only.
