# Verification — local-stack-transport-flake (C10X-39)

> Evidence for Phases 1–2 is carried by their Progress SHAs (`0823bb8`, `b6ce30c`) and by the
> criteria they were checked against in `plan.md`. This file starts at Phase 3, which is the
> first phase whose deliverable IS a measurement rather than code.

## Phase 3 — Census: enumerate the silent write seams by experiment

Ran 2026-08-01. Local stack up, Kong at `upstream_keepalive_pool_size = 0` (confirmed before
the census with `MSYS_NO_PATHCONV=1 docker exec supabase_kong_10x-astro-starter cat
/usr/local/kong/.kong_env`), `OPENROUTER_API_KEY` unset.

### 3.0 Baseline

| | |
| --- | --- |
| Suite | **332 passed / 332, 29 files**, seed `1785591127371` |
| Census window opens | `2026-08-01 13:32:52.687633+00` (`select now()` on the local DB) |
| Pristine `retry-transport.ts` | md5 `57ee187e9448ea376961ee243320c822` |

The 332/29 figure is the **Phase 3 baseline** Phase 4's criterion 4.1 compares against. It is
up from the 314/28 in `test-plan.md` §8 because Phase 1 added `tests/lib/kong-keepalive.test.ts`.

### 3.1 The neuter, and the one decision it turns on

A temporary edit to `tests/setup/retry-transport.ts` (never committed) that, for a **local
replayable request whose method is not `GET`**, issues the request a second time
unconditionally — bypassing `isKongKeepAliveDrop` entirely — and **returns the FIRST response,
discarding the replay's**. Method inspection existed only in the neuter; the shipped predicate
stayed body-based. It also appended one line per replay to a log outside the repo, which is
what makes §3.3 evidence rather than inference.

Returning the first response is what makes the census reach anything at all, and the run
confirms the plan's reasoning (F2) by measurement rather than argument: **64 of 64 replayed
`POST /rest/v1/deck` requests answered `409`**. Had the second response been returned, every
`createDeck` helper would have thrown `Setup failed: deck "…" was never written` in `beforeAll`
and the 30-odd `seedCard` / `createNonAcceptedCard` sites behind those decks would never have
executed — the census would have reported a *shorter* silent list than the reading it replaces.

### 3.2 The census run — full red set, verbatim

Seed `1785591177580`. **Test Files 6 failed | 23 passed (29) · Tests 26 failed | 302 passed |
4 skipped (332)**, plus **1 failed suite** (a `beforeAll`), i.e. 27 error blocks.

```
FAIL  tests/validation/cards.test.ts > POST /api/decks/[publicId]/cards/[cardPublicId] enforces the same rules on edit   [failed SUITE]
FAIL  tests/generation/generate.test.ts > … > writes ONE generation session for two identical requests carrying the same key
FAIL  tests/generation/generate.test.ts > … > still writes two sessions when no key is sent at all
FAIL  tests/generation/generate.test.ts > … > still generates when the only prior session for that key is `failed`
FAIL  tests/generation/generate.test.ts > … > replays a keyed session even when its language has since been deactivated
FAIL  tests/generation/generate.test.ts > … > gives a different source text its own session (positive control)
FAIL  tests/generation/generate.test.ts > … > 409s the second newDeckName request without a session — and that is not dedup
FAIL  tests/generation/generate.test.ts > … > accepts a sourceText at exactly the limit and stores it whole (boundary control)
FAIL  tests/generation/generate.test.ts > … > records the five audit columns and the counters on a succeeded session
FAIL  tests/validation/cards.test.ts > … > accepts content at exactly the limits and stores it whole
FAIL  tests/validation/cards.test.ts > … > measures a front after trimming, so trailing whitespace over the limit is accepted
FAIL  tests/isolation/flashcards.test.ts > … > refuses B's card creation in A's deck and adds nothing to A's deck
FAIL  tests/isolation/flashcards.test.ts > … > refuses B's edit of A's card and leaves A's card unchanged
FAIL  tests/isolation/flashcards.test.ts > … > refuses B's own deck paired with A's card id, and does not move the card
FAIL  tests/isolation/flashcards.test.ts > … > still lets A edit A's own card
FAIL  tests/generation/failure-path.test.ts > … > 502s an upstream HTTP failure: the row keeps the source text, the body leaks nothing
FAIL  tests/generation/failure-path.test.ts > … > 502s a transport failure: `error_message` records the upstream string, the body does not
FAIL  tests/generation/failure-path.test.ts > … > 422s a model answer whose cards all fail validation, and still leaks nothing
FAIL  tests/generation/failure-path.test.ts > … > sends the key in the header, keeps it out of the request body and out of the row
FAIL  tests/review/candidates.test.ts > … > returns one state's cards with their provenance columns, narrowed to a generation on request
FAIL  tests/review/candidates.test.ts > … > counts pending candidates per deck, in one query, and never across accounts
FAIL  tests/review/candidates.test.ts > … > resolves a session by public_id and groups its cards by state, ignoring the stored counters
FAIL  tests/review/candidates.test.ts > … > matches only the accepted card and carries its source_id
FAIL  tests/study/study.test.ts > … > counts only accepted cards, per deck
FAIL  tests/study/study.test.ts > … > stops counting a card once its schedule is rated into the future
FAIL  tests/study/study.test.ts > … > never exposes another account's deck
FAIL  tests/study/study.test.ts > … > caps the batch at the deck's cap and composes it deterministically
```

Per file: `failure-path` 4/4 red, `cards` 2 red + 1 red suite + 4 skipped of 13, `flashcards`
4/9, `generate` 8/22, `candidates` 4/22, `study` 4/22. **Twenty-three of the twenty-nine files
did not notice a thing.**

### 3.3 What was actually replayed (the "did the duplicate happen" control)

316 non-`GET` replays. Without this table a green case is equally consistent with "the replay
never happened", which is the whole reason §2 of the plan calls the duplicate scan load-bearing.

| Replayed request | n | first → replay | Reading |
| --- | --- | --- | --- |
| `POST /rest/v1/flashcard` | 81 | 201 → 201 | duplicate LANDED |
| `POST /rest/v1/deck` | 64 | 201 → **409** | refused by `deck_user_name_unique` |
| `PATCH /rest/v1/flashcard` | 26 | 200 → 200 | UPDATE — no row created |
| `PATCH /rest/v1/flashcard_schedule` | 21 | 200 → 200 | UPDATE — no row created |
| `POST /rest/v1/generation_session` | 18 | 201 → 201 | duplicate LANDED |
| `POST /rest/v1/flashcard_schedule` | 18 | 201 → 201 | upsert — see §3.5 row 2 |
| `POST /rest/v1/generation_session` | 5 | 201 → **409** | refused by `generation_session_idempotency_key_uidx` |
| `POST /rest/v1/rpc/*`, `HEAD`, `PATCH … 400`, `POST /rest/v1/language … 403`, `DELETE` | 83 | unchanged | reads, refusals, deletes |

### 3.4 The duplicate scan

Scoped to the census window. `flashcard` grouped by `(deck_id, front)`, `generation_session` by
`(source_text, status)`, both `having count(*) > 1`. Full output in the run log; the shape:

- **89 duplicated `flashcard` groups** across six deck families — `msaevvsd` (`cards.test.ts`),
  `msaevvtt` (`generate.test.ts`), `msaevvwo` (`isolation/flashcards.test.ts`), `msaevvyb`
  (`study.test.ts`), `msaevvz8` (`candidates.test.ts`). Every group is `n = 2` except the two
  keyless-generation decks, which are `n = 4` (two generations × the replay).
- **18 duplicated `generation_session` groups**, including `msaevvwe`
  (`failure-path.test.ts`), which writes no flashcards at all.
- **0 duplicated `deck` groups** and **0 duplicated `flashcard_schedule` groups** — both by
  construction, see §3.5.

### 3.5 The measured seam census

Attribution is per **seam**, not per case colour: a case can be red on one seam's duplicate
while a second seam's duplicate sits inside it unobserved. `generate.test.ts`'s failed-key case
is exactly that, and it is why this table reads its failure strings rather than its results.

| # | Seam | Table | Duplicate landed? | Seen by an assertion? | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | `createDeck` via `POST /api/decks` (9 files) | `deck` | **No** — 64/64 replays `409` | n/a | **LOUD by constraint** (`deck_user_name_unique`) |
| 2 | `ensureSchedule` (`src/lib/study.ts:181`) | `flashcard_schedule` | **No** — `upsert(onConflict: "flashcard_id", ignoreDuplicates: true)` against `UNIQUE (flashcard_id)`; 0 dup groups all-time | n/a | **SAFE by construction** — the write is idempotent |
| 3 | `/api/generate` keyed `succeeded` session | `generation_session` | **No** — 5 replays `409` | n/a | **LOUD by index** (`… WHERE idempotency_key IS NOT NULL AND status = 'succeeded'`) |
| 4 | `/api/generate` keyless / failure-path session | `generation_session` | Yes | Yes — `succeededSessions(…).toHaveLength()`; `sessionFor` (`failure-path.test.ts:168`) `expect(data).toHaveLength(1)` | **LOUD** |
| 5 | `/api/generate` card insert (`insertCandidates`) | `flashcard` | Yes (`Przykładowe pytanie N`, n = 2 and n = 4) | Yes — `cardsOf(deck).toHaveLength(COUNT)` | **LOUD** |
| 6 | `createCard` (`cards.test.ts:149`) | `flashcard` | Yes | Yes — but only *incidentally*: `findCardByFront`'s `.maybeSingle()` answers `PGRST116 … Results contain 2 rows` | **LOUD** |
| 7 | `createCard` (`isolation/flashcards.test.ts:75`) | `flashcard` | Yes (3 groups) | Yes — all three owning cases red | **LOUD** |
| 8 | **`createNonAcceptedCard`** (`study.test.ts:136`) | `flashcard` | Yes (`Gate generated`, `Gate rejected`, `Gate rate front`) | **No** — owning cases green | **SILENT** |
| 9 | **`seedCard`** (`candidates.test.ts:89`) | `flashcard` | Yes | **No** at `Batch cap` / `Batch already` / `Batch guard` / `Transition` ×2 (green while duplicated); yes at `By-state` / `Chip` / `Metric` / `Search` | **SILENT, non-uniformly** |
| 10 | **seeded `failed` session** (`generate.test.ts:352`) | `generation_session` | Yes (n = 2, one key) | **No** — the case IS red, on `expect(await cardsOf(ownDeck)).toHaveLength(COUNT)` at `:377` (seam 5). Its own oracle, `succeededSessions`, filters `status = 'succeeded'` and structurally cannot see this row | **SILENT** |
| 11 | **`insertDirect` / the `inRange` control** (`cards.test.ts:421`) | `flashcard` | Yes (`db-ok-…`, n = 2) | **No** — "rejects an over-limit front and an over-limit back with 23514" stayed green | **SILENT** |
| 12 | **`seedGenerationSession`** (`candidates.test.ts:128`) | `generation_session` | Yes (`Audit control source`, `Audit private source`, …) | **No** — the C10X-28 audit-column cases green while duplicated | **SILENT** |
| 13 | **`createCard`** (`study.test.ts:91`) | `flashcard` | Yes (Canary, Chain, Oracle, Grade 1–4, Lapse, Rated, Restart, Retry, Re-entry, Ordering ×2, Gate flip, Study ×2 — all `state_id = 2`) | **No** — owning cases green | **SILENT** |
| 14 | `insertDirect` (`validation/decks.test.ts:437`) | `deck` | **No** — same constraint as seam 1 | n/a | **LOUD by constraint** |

### 3.6 Against research's four — two additions, no subtractions

Research (`change.md`, 2026-08-01) named four silent seams. **All four are confirmed by
measurement** (rows 8, 9, 10, 11). Two more are added:

- **`seedGenerationSession`** (row 12) — named in advance by plan-review F8, which put it in
  research's `.single()`-false-oracle trap list and in *neither* its silent nor its loud list.
  The census **confirms** it rather than discovering it, which is the outcome F8 asked for.
- **`createCard` in `study.test.ts`** (row 13) — a genuine addition, on no prior list. Its
  oracle is `listFlashcards(…).find(card => card.front === front)`; a `find` returns the first
  match and cannot count, so the helper is blind by construction in all three files that carry
  it. That it reads as loud in the other two is an accident of what those files re-read
  afterwards (`.maybeSingle()` on `front` in `cards.test.ts`), not a property of the helper.

**No subtractions**: nothing research called silent turned out to be already loud.

Two classifications nobody had, both worth carrying because they are the reason the list is
not longer: `ensureSchedule` writes through an **upsert on a unique key**, so its replay is a
no-op rather than a silent duplicate (row 2); and a keyed `succeeded` generation session is
already refused by the **partial unique index** C10X-27/S-05 added for idempotency, which is a
second constraint quietly doing this job (row 3).

### 3.7 Revert and cleanup

| Check | Result |
| --- | --- |
| `git checkout -- tests/setup/retry-transport.ts` | md5 `57ee187e9448ea376961ee243320c822` — identical to the pristine copy |
| `git diff -- tests/` | empty |
| `npm test` after the revert | **332 passed / 332, 29 files**, seed `1785591447748` |
| Cleanup | 126 decks (`ON DELETE CASCADE` → their flashcards and schedules) and 64 generation sessions deleted, scoped to the census window. Residual in-window: **0 flashcards, 0 duplicate groups on either table** |

The cleanup window covers the post-revert run as well as the census run, so Phase 4 starts
from a database carrying none of this phase's rows.

### 3.8 Manual verification (criteria 3.5 and 3.6)

**3.5 — the silent-seam list against research's four.** Attribution was *checked*, not inferred:
every green duplicated group was traced to the helper that wrote it and to the `it()` that owns
it, by line number, and cross-referenced against the red set in §3.2.

| Duplicated group (green) | Written by | Owning `it()` | In the red set? |
| --- | --- | --- | --- |
| `Gate generated`, `Gate rejected` | `createNonAcceptedCard` (`study.test.ts:565-566`) | `:562` "never returns a generated or rejected card from a session build" | no |
| `Gate rate front` | `createNonAcceptedCard` (`:585`) | `:583` "writes no schedule when a non-accepted card is rated" | no |
| `Rate front`, `Foreign front`, `Oracle front`, `Restart front`, `Chain front`, `Retry front`, `Easy/Hard front`, `Gate flip front`, `Re-entry front`, `Grade 1–4 front`, `Lapse front`, `Canary front` | `createCard` (`study.test.ts:91`, 13 call sites) | `:251`, `:271`, `:379`, `:418`, `:447`, `:501`, `:532`, `:597`, `:740`, `:788`, `:820`, `:876` | **none of the twelve** |
| `Illegal target`, `Mixed already`, `Batch already`, `Batch guard candidate`, `Batch cap candidate` | `seedCard` (`candidates.test.ts:89`) | `:218`, `:239`, `:257`, `:281`, `:335` | none |
| `Audit private source`, `Audit control source` | `seedGenerationSession` (`candidates.test.ts:128`) | `:682`, `:703`, `:726`, `:740` | none |
| `db-ok-…` front/back | `insertDirect` / `inRange` (`cards.test.ts:421`) | "rejects an over-limit front and an over-limit back with 23514" | no |
| `[msaevvtt:failed-key]` `failed` session | direct insert (`generate.test.ts:352`) | `:336` — **is** red, but on `expect(await cardsOf(ownDeck)).toHaveLength(COUNT)` at `:377`, a different seam | red on another seam |

Verdict: **four confirmed, two added, none subtracted.** The additions are named rather than
folded into a count — `seedGenerationSession` (confirmed as plan-review F8 asked, not
discovered) and `createCard` in `study.test.ts` (a genuine addition, on no prior list). The
last row is the reason this table exists: read by case colour, `generate.test.ts:352` would
have been filed as loud.

**3.6 — cleanup.** In-window residue: **0 decks, 0 flashcards, 0 sessions, 0 duplicate groups**
on either table; **0 orphaned `flashcard_schedule` rows**, so the `ON DELETE CASCADE` did its
job. The stack is unchanged by any of this: Kong `Up (healthy)`,
`upstream_keepalive_pool_size = 0`, `npx supabase status` reports the stack running.

One residual delta is explained rather than waved past. The **global** duplicate counts moved
326 → 332 groups (`flashcard`) and 106 → 108 (`generation_session`) across this phase, even
though the census window is empty. The six extra groups all carry suffix `msaeut1x` and
`created_at 13:32:09`, i.e. **before** the window opened at `13:32:52` — they belong to the
*baseline* run, and they are `No key deck` and `Different keys deck`, the two `generate.test.ts`
cases that POST twice into one deck with no key / two different keys while `mockCards` returns
identical fronts. So every ordinary suite run adds exactly 6 + 2 legitimate duplicate groups,
which is the plan's Key Discovery ("a `unique (deck_id, front)` index on `flashcard` is
impossible") observed from the other side. Nothing the census wrote survives.

## Phase 4 — Make every silent seam loud, and prove each one red

Ran 2026-08-01, immediately after Phase 3 and against the same stack (Kong
`upstream_keepalive_pool_size = 0`, `OPENROUTER_API_KEY` unset). Driven test-first
(`/10x-tdd`): for each seam the duplicate was made to happen **before** the assertion existed,
so every oracle was proven falsifiable at the moment it was written rather than afterwards.

### 4.0 Baseline

| | |
| --- | --- |
| Suite | **332 passed / 332, 29 files**, seed `1785592120563` — identical to the Phase 3 baseline |
| Pristine `study.test.ts` | md5 `b77217c2f87d467794524b5abe747a3d` |
| Pristine `candidates.test.ts` | md5 `269a8e8a7631afe165076f83422f43c8` |
| Pristine `generate.test.ts` | md5 `d2cd79a7c28a7c6694b15b2713371e90` |
| Pristine `cards.test.ts` | md5 `0db574d9580cee1f1ed3745d1a8136d7` |
| Pristine `retry-transport.ts` | md5 `57ee187e9448ea376961ee243320c822` — unchanged since Phase 3 |

### 4.1 The six oracles

One per seam the Phase 3 census **measured** as silent — six, not research's four. No new
`it()`, no schema change, no product rule, so the suite count does not move; an unchanged
number here is correct rather than suspicious.

| # | Seam | File | Oracle | Scope |
| --- | --- | --- | --- | --- |
| 8 | `createNonAcceptedCard` | `study.test.ts` | `countCardsWithFront(...) === 1` | `(deck_id, front)` |
| 13 | `createCard` | `study.test.ts` | same helper | `(deck_id, front)` |
| 9 | `seedCard` | `candidates.test.ts` | `countCardsWithFront(...) === 1` | `(deck_id, front)` |
| 12 | `seedGenerationSession` | `candidates.test.ts` | inline `count: "exact"` === 1 | `(user_id, source_text, status)` |
| 10 | seeded `failed` session | `generate.test.ts` | `allSessions(...)` filtered to `failed`, length 1 | file marker + `status` |
| 11 | `insertDirect` / `inRange` | `cards.test.ts` | `countCards(deckId) === 1` | `deck_id` |

Two helpers were reused rather than multiplied, as the plan directs: `allSessions` in
`generate.test.ts` (status-agnostic, already scoped by the same marker) and `countCards` in
`cards.test.ts` (already the raw, state-agnostic counter §6.10 calls for). The two new
`countCardsWithFront` helpers are per-file rather than shared, matching how `deckIdOf` and
`createDeck` are already duplicated across these files.

Three one-line restructurings were needed and are the whole of the diff's `-3`: hoisting
`deck_id` out of the `insert({...})` in `seedCard`, hoisting `status` out of it in
`seedGenerationSession`, and hoisting the client into a `const` in the latter. **No assertion
was removed or weakened** — verified by reading every deletion in `git diff -- tests/`.

### 4.2 Test-first, seam by seam — silence demonstrated, then made loud

For each seam: (1) a scratch case (or a duplicated inline insert) writes the row **twice** with
no oracle present — the run stays green, which reproduces that seam's Phase 3 census verdict at
authoring time; (2) the oracle lands — the run goes red, **on that case alone**; (3) the scratch
is removed — green again.

| # | Seam | (1) silence, no oracle | (2) RED, oracle added | (3) scratch removed |
| --- | --- | --- | --- | --- |
| 8 | `createNonAcceptedCard` | 23/23 green | **1 of 23** — `AssertionError: expected 2 to be 1` | 22/22 green |
| 13 | `createCard` (study) | 23/23 green | **1 of 23** — `expected 2 to be 1` | 22/22 green |
| 9 | `seedCard` | 23/23 green | **1 of 23** — `expected 2 to be 1` | 22/22 green |
| 12 | `seedGenerationSession` | 23/23 green | **1 of 23** — `expected 2 to be 1` | 22/22 green |
| 10 | seeded `failed` session | 22/22 green | **1 of 22** — `expected [ …(2) ] to have a length of 1 but got 2` | 22/22 green |
| 11 | `insertDirect` / `inRange` | 13/13 green | **1 of 13** — `expected 2 to be 1` | 13/13 green |

The column that carries the evidence is not the red — it is the **green beside it**. Exactly
one case moves in each run, so the assertion observes the duplicate its own seam wrote and
nothing else; and column (1) is what rules out "the scratch never duplicated", which would
make column (2) a red for the wrong reason.

Seam 10's failure string differs from the other five because its oracle is a length assertion
on a filtered list rather than a scalar count — the same distinction §6.10 records for row
oracles vs count oracles.

### 4.3 Revert of the targeted edits

`retry-transport.ts` matches the criterion literally: md5 `57ee187e9448ea376961ee243320c822`
after `git checkout --`, identical to the pristine copy, and `git diff -- tests/setup/` empty.

**For the four test files the criterion's md5 form does not apply, and that is stated rather
than fudged.** The breakage was interleaved with authoring (that is what makes it test-first),
so no byte-identical earlier state exists to hash against — the file legitimately ends
different from its pristine copy, because the oracle is the deliverable. What was verified
instead, and is the criterion's actual purpose:

- `git diff -- tests/` is **121 insertions / 3 deletions across exactly 4 files**; every
  deletion read individually and confirmed to be one of the three hoists in §4.1.
- A residue grep for `SCRATCH`, `inRange2` and `seedError2` over all of `tests/` returns
  **nothing**.
- The full suite is green at the unchanged count, which no leftover scratch case could be.

### 4.4 The census re-run — zero silent seams

The Phase 3 neuter was re-applied verbatim (non-`GET` local replayable requests issued twice,
first response returned, one log line per replay), window opened at
`2026-08-01 13:57:31.353255+00`.

| | Phase 3 census | Phase 4 re-run |
| --- | --- | --- |
| Red blocks | 27 (26 tests + 1 suite) | **54** (51 tests + 3 suites/hooks) |
| Files red | 6 of 29 | 6 of 29 |
| Silent seams | **6** | **0** |

**The replay control.** 669 replays logged, of which **156 × `POST /rest/v1/flashcard`** and
**60 × `POST /rest/v1/generation_session`** — so the duplicates genuinely landed and a green
case would have been genuinely silent. Without this the zero would be equally consistent with
"the replay never happened".

**Seam by seam against Phase 3's silent list** (criterion 4.6), read by failure string and
owning `it()`, never by case colour alone:

| # | Seam | Phase 3 owning cases | Now red? |
| --- | --- | --- | --- |
| 8 | `createNonAcceptedCard` | "never returns a generated or rejected card from a session build"; "writes no schedule when a non-accepted card is rated" | **both red** |
| 13 | `createCard` (study) | twelve cases at `:251 :271 :379 :418 :447 :501 :532 :597 :740 :788 :820 :876` | **all twelve red** |
| 9 | `seedCard` | `Illegal target`, `Mixed already`, `Batch already`, `Batch guard`, `Batch cap` | **all five red** |
| 12 | `seedGenerationSession` | the four C10X-28 audit-column cases | **red** — the describe now fails at its seeding hook (`candidates.test.ts:212`) |
| 10 | seeded `failed` session | "still generates when the only prior session for that key is `failed`" | **red on its OWN oracle** — in Phase 3 it was red on seam 5's card count at `:377`, a different seam |
| 11 | `insertDirect` / `inRange` | "rejects an over-limit front and an over-limit back with 23514" | **red** |

**Nothing that was loud went quiet**: all 27 of Phase 3's red blocks are present in the 54,
checked by set comparison rather than by eye. The growth 27 → 54 is the six seams, not a
regression — the suite is green at 332/332 with the neuter removed.

**Duplicate-scan attribution.** 130 duplicated `flashcard` groups and 30 duplicated
`generation_session` groups in the window, spread over 42 deck families, **every one of them
inside one of the six red files**. No duplicated group sits under a file that passed.

### 4.5 Cleanup and final state

| Check | Result |
| --- | --- |
| Rows deleted | 528 decks (`ON DELETE CASCADE`) and 228 generation sessions, scoped to Phase 4's window |
| In-window residue | **0 decks, 0 flashcards, 0 sessions** |
| Duplicate groups in window | **0** on both tables |
| Orphaned `flashcard_schedule` | **0** — the cascade did its job |
| `npm test` | **332 passed / 332, 29 files** — unchanged from the Phase 3 baseline |
| `npm run lint` | exit **0** (6 pre-existing `no-console` warnings in `evals/`, unchanged) |
| `npx tsc --noEmit` | exit **0** |
| Kong | `upstream_keepalive_pool_size = 0`, unchanged by any of this |

**Wall clock did not regress**: 2.86 s at the baseline, 2.74 s at the end — the plan asked for
this to be recorded if it moved, and it did not.

### 4.6 What this does NOT prove

- **The seams are guarded, the wrapper is not narrowed.** `tests/setup/retry-transport.ts`
  still replays non-idempotent requests, deliberately (Kong absorbs every idempotent drop
  itself, so the POST/PATCH category is the wrapper's entire marginal value). These oracles
  turn a silent double-write into a loud one; they do not stop it happening.
- **Silence is proven only for the seams that existed on the day the census ran.** A helper
  added tomorrow with no count after its insert is a new silent seam, and nothing here detects
  that class automatically — there is no guard test over "every insert in `tests/` is followed
  by a count".
- **Two `createCard` twins are loud only by ACCIDENT, and were deliberately left alone.** The
  census classified `createCard` in `cards.test.ts` (row 6) and `isolation/flashcards.test.ts`
  (row 7) as loud — but row 6 only because `findCardByFront`'s `.maybeSingle()` happens to
  answer `PGRST116 … Results contain 2 rows`, i.e. an error rather than an assertion. The
  helper is blind by construction in all three files; two of them are covered by what the file
  re-reads afterwards. Closing "the list the experiment produced" is the plan's instruction, so
  these are named here rather than folded in — a cheap follow-up, not a gap this phase claims.
- **`flashcard` still carries no uniqueness constraint**, and cannot: `generate.test.ts` POSTs
  twice with no key into one deck while `mockCards` returns identical fronts, so duplicate
  `(deck_id, front)` rows are legitimate there. The oracle is per-seam precisely because the
  database cannot hold this rule.
- **Nothing here is evidence about the flake itself.** Whether Phase 1's Kong recreation
  removed the cause is Phase 5's measurement, untouched by this phase.

### 4.7 Manual verification (criteria 4.6 and 4.7)

**4.6 — the re-run's red set against Phase 3's silent list, case by case.** Attribution was
*checked*, not inferred, and the method matters: Phase 3 recorded its owning cases by LINE
NUMBER, and this phase shifted every one of them (+46 lines in `study.test.ts`, +62 in
`candidates.test.ts`). The line numbers were therefore resolved against the **pristine copies
taken before the first edit**, so the comparison is against what Phase 3 actually measured
rather than against whatever now sits at that line.

That resolved 23 owning `it()` titles across the four previously-silent helpers. Matched
against the re-run's 54 red blocks: **19 red by name, 4 not by name, 0 still passing.**

The four are `seedGenerationSession`'s, and the reason they carry no leaf name is the strongest
form of loud rather than a gap — **the oracle fires inside the `beforeAll`**, so the suite is
reported failed and its cases never run. Verified rather than asserted:

- the failing frame is `seedGenerationSession tests/review/candidates.test.ts:212:17`, which is
  `expect(count).toBe(1)` — the assertion added by this phase, not a pre-existing one;
- `describe("account B is denied account A's generation-session audit columns")` seeds through
  that helper in its `beforeAll` and holds exactly **4** `it()`s — the same four Phase 3 named
  at `:682 :703 :726 :740`;
- and the **skipped arithmetic closes exactly**, which is what rules out "they passed quietly":

  | Failed hook | its behind it |
  | --- | --- |
  | `cards.test.ts` edit-rules describe (already failing in Phase 3) | 4 |
  | `candidates.test.ts` "editing a card from the review screen…" (newly red, `seedCard`) | 3 |
  | `candidates.test.ts` "account B is denied … audit columns" (newly red, `seedGenerationSession`) | 4 |

  4 + 3 + 4 = **11 skipped**, exactly the re-run's `51 failed | 270 passed | 11 skipped (332)`.
  Phase 3 reported **4** skipped — the cards describe alone. So the +7 is fully accounted for by
  the two hooks this phase made loud, and no previously-silent case is hiding in the `passed`
  column.

**Nothing that was loud went quiet.** All **27** of Phase 3's red blocks were matched against
the re-run's 54 by set comparison: **0 went quiet**.

**4.7 — cleanup.** Census residue in the window: **0 decks, 0 flashcards, 0 sessions, 0
duplicate groups** on either table, and **0 orphaned `flashcard_schedule` rows** in the whole
table, so the `ON DELETE CASCADE` did its job.

One residual delta is explained rather than waved past, exactly as in Phase 3 §3.8. The single
ordinary suite run made after the cleanup left **6** duplicated `flashcard` groups (3 ×
`Different keys deck`, 3 × `No key deck`) and **2** duplicated `generation_session` groups —
the 6 + 2 signature Phase 3 measured for every ordinary run. They are `generate.test.ts`'s
keyless / two-key cases, which POST twice into one deck while `mockCards` returns identical
fronts: legitimate rows, and the plan's Key Discovery ("a `unique (deck_id, front)` index on
`flashcard` is impossible") seen from the other side. Nothing the census wrote survives.

**Stack unchanged by any of this**: `npx supabase status` reports the stack running, Kong
`Up (healthy)`, `upstream_keepalive_pool_size = 0` (idle timeout still 60, untouched).

## Phase 5 — Before/after flake measurement

Ran 2026-08-01, 14:14–15:00 UTC, on one machine, in one sitting, against one stack. The
question is narrow and the phase is built around the fact that **a quiet log is not evidence on
its own**: research already recorded two probes that provoked zero drops from an *unfixed*
stack, so the fixed matrix alone would have been unfalsifiable. The control is the load-bearing
half.

Oracle throughout: `docker logs supabase_kong_10x-astro-starter 2>&1 | grep -c "prematurely
closed"`, sampled after **every** run rather than only at the ends, so a drop is attributable to
the run that produced it. Not the suite's colour — the suite is green either way, which is the
whole reason `tests/setup/retry-transport.ts` exists.

### 5.0 Protocol, and the one thing it is not free to change

40 full-suite runs at fresh un-pinned seeds, each preceded by **35 s of quiet**. The spacing is
not padding: research measured a median **27 s** of quiet before a drop-bearing burst, and both
sides idle out at 60 s, so a back-to-back matrix never lets a pooled socket reach the state that
loses the race — it would have produced a zero meaning "no opportunity", not "no defect".

| | |
| --- | --- |
| Kong container | `supabase_kong_10x-astro-starter`, started `2026-08-01T13:16:05Z`, image `supabase-kong-keepalive-10x-astro-starter:latest` |
| `.kong_env` before | `pool_size = 0`, `max_requests = 100`, `idle_timeout = 60` |
| Drops in the log before | **0** — across ~1 h of container life that already carried all of Phase 4's work |
| Suite | `npm test`, `OPENROUTER_API_KEY` unset, seeds un-pinned |
| Runner | `matrix.sh` / `matrix-resume.sh` in the job scratch dir — measurement tooling, deliberately outside the repo; this phase touched no file in `src/` or `tests/` |

### 5.1 The fixed matrix — 40 runs, `pool_size = 0`

**40 / 40 exit 0, `332 passed (332)`, 29 files, 40 distinct seeds, 0 red.**

**Kong drop delta across the matrix: 0 → 0. Zero.** Against C10X-32's recorded baseline of **22
absorbed drops across a 0/40-red matrix**.

Wall clock per run: 16 × 5 s, 22 × 6 s, 1 × 7 s, 1 × 10 s. `.kong_env` re-read after the last
run: `pool_size = 0` — unchanged, so the setting did not revert mid-matrix (criterion 5.2's
second half, which exists because a reverted setting and a working fix produce the same quiet
log for every run after the revert).

**One deviation, recorded rather than smoothed over.** The matrix did not run as a single
process. Runs 1–8 ran under a background job the agent harness reaped at 14:20; runs 9–40 were
resumed in three foreground chunks (9–21, 22–34, 35–40) appending to the same summary. The 35 s
gap is per-run and was applied identically in every chunk; the only difference is that three of
the 39 inter-run gaps were *longer* than 35 s (the pause between chunks), which moves the
protocol **toward** the cold-pool condition the flake needs rather than away from it. The 40
rows, their seeds and their per-run drop counts are one continuous record.

### 5.2 The stock-pool control — the half that decides whether §5.1 means anything

Kong was recreated at the stock `upstream_keepalive_pool_size = 60` through the **shipped** pure
half (`buildRunArgs(spec, { …, value: "60" })` from `scripts/kong-keepalive.ts`), so the control
container differs from the fixed one in exactly the value under test and in nothing else — same
labels, same aliases, same port binding, same healthcheck, same baked entrypoint. Adoption was
verified the same way as the fix, by reading Kong's own dump back: `pool_size = 60`.

Then the identical protocol: same suite, same 35 s spacing, same oracle.

| Run | Cumulative drops | Δ | Suite |
| --- | --- | --- | --- |
| 1 | 1 | +1 | 332 passed |
| 2 | 5 | +4 | 332 passed |
| 3 | 6 | +1 | 332 passed |
| 4 | 9 | +3 | 332 passed |
| 5 | 11 | +2 | 332 passed |
| 6 | 14 | +3 | 332 passed |
| 7 | 15 | +1 | 332 passed |
| 8 | 16 | +1 | 332 passed |
| 9 | 16 | +0 | 332 passed |
| ~~10–12~~ | — | — | **void — see below** |
| 13 | 17 | +1 | 332 passed |
| 14 | 17 | +0 | 332 passed |
| 15 | 18 | +1 | 332 passed |
| 16 | 18 | +0 | 332 passed |

**13 valid runs, 18 drops, 0 red.** Ten of the thirteen produced at least one drop. The rate is
**1.38 drops/run**, against the ≈0.55/run C10X-32 implies — the control did not merely clear the
plan's floor, it cleared it by a wide margin. Ten was the plan's derived minimum because at
0.55/run a five-run zero happens ~6 % of the time by chance; that derivation is moot here, since
the control was never close to zero.

**The suite stayed green through all 18 drops**, which is the C10X-32 signature reproduced
exactly: the wrapper absorbs them, the colour says nothing, and only the log knows. It is also
the cleanest available demonstration that the fixed matrix's zero is not the log of a dead
proxy — the *same* oracle, on the *same* machine, an hour apart, counts 18 once pooling is on.

**Docker Desktop died at run 10** (`failed to connect to the docker API at
npipe:////./pipe/dockerDesktopLinuxEngine`), which voids runs 10, 11 and 12 — run 10 exited 127
with no suite at all, and 11–12 ran with no reliable oracle behind them. Docker was restarted,
the Kong container came back **at `pool_size = 60` with its log intact** (`RestartCount 0`, the
16 drops still counted), and the control was topped up with runs 13–16 so the ≥10-run floor is
met by *clean* runs alone. Not attributed to this change: it happened on the stock-pool
container, mid-matrix, and nothing comparable occurred across the 40 fixed runs before it.

### 5.2b The control, run a second time — and the rate is not stable

Criterion 5.4 was then executed again from scratch as an independent repeat: Kong recreated at
`pool_size = 60` through the same shipped `buildRunArgs`, adoption re-verified, a **fresh
container with a zero-drop log**, and the plan's floor of **10** spaced runs.

**10 / 10 exit 0, `332 passed (332)`, 0 red — and 2 drops**, on runs 3 and 5 (log `0 → 1 → 2`).

So the criterion is met twice over, and the repeat is more informative than a confirmation:
**0.20 drops/run, against the first control's 1.38 and C10X-32's ≈0.55.** Nearly a sevenfold
spread between two controls an hour apart on one machine, so the honest reading is that **this
flake's rate is highly variable** and no single control's number should be quoted as *the*
rate. That is also the retroactive justification for the plan's ≥10 floor: at 0.20/run a
five-run control returns zero **37 %** of the time, and would have been written down as
"inconclusive" while the defect was fully present.

Two conditions differed and neither can be ruled out as the cause, so both are recorded rather
than one being picked: the deck table had just been cut from 6567 rows to 3102 by the cleanup in
§5.4, and every run in the repeat took 9–12 s against the first control's 5–6 s (the machine was
still cold after the Docker Desktop restart). A slower, smaller run is a different traffic
profile, and this phase did not isolate which of the two moved the rate.

What the repeat does **not** weaken is the comparison in §5.3: it is a second independent
demonstration that the oracle counts drops on this machine when pooling is on, taken *after* the
fixed matrix rather than before it.

### 5.3 Verdict

**The recreation removes the flake on this machine.** 0 drops in 40 spaced runs with pooling
disabled, against **20 drops in 23 spaced runs across two independent controls** with pooling at
stock — same day, same machine, same suite, same oracle, same protocol.

The margin survives the rate instability §5.2b records, which is the reason to state it three
ways rather than once. At the *pooled* rate (0.87/run over both controls) the fixed matrix would
have been expected to log ≈35 drops; at C10X-32's ≈0.55/run, ≈22; and even at the **lowest**
rate anything here produced — the second control's 0.20/run — ≈8, which a zero contradicts at
p ≈ 3 × 10⁻⁴ under a Poisson reading. It logged none.

Not recorded as inconclusive, then: the plan reserved that branch for a control that failed to
reproduce, and both controls reproduced on their first attempt.

**Performance: no regression, measured.** Disabling upstream pooling costs a TCP handshake per
Kong→PostgREST request, and the plan asked for the cost to be recorded if it showed up. It does
not — the fixed matrix ran 5–6 s per run and the control's pre-crash runs ran 5–6 s per run, on
the same suite. (Control runs 13–16 took 9–11 s, but they ran minutes after a Docker Desktop
restart with cold caches, and the two post-restore runs at `pool_size = 0` took 7.4 s and 7.5 s
under those same cold conditions — so the outlier tracks the restart, not the pool size.)

### 5.4 Restore, and the state this phase leaves behind

| Check | Result |
| --- | --- |
| `npm run db:kong` | exit 0, **both times** — `before pool_size = 60` → `after pool_size = 0`, "OK — upstream keep-alive pooling is disabled" |
| `.kong_env` final | `upstream_keepalive_pool_size = 0`, `max_requests = 100`, `idle_timeout = 60` |
| Drops in the restored container | **0** |
| `npm test` after the restore | **332 passed / 332, 29 files** — three times across the two restores |
| Control image | `supabase-kong-control-10x-astro-starter:latest` removed after each control; only the fix's own `supabase-kong-keepalive-…` tag remains |
| `npx supabase status` | running; Kong `Up (healthy)` |

**Residue cleaned, scoped to this phase's window.** 67 suite runs provision two throwaway
accounts each and clean up after nothing. Deleted in three sweeps: **134 `harness-*` users
created at or after `14:14:33Z`**, cascading to their decks — `deck` **6567 → 3102**,
`flashcard` **11291 → 5461**, `generation_session` **2484 → 1219**. Verified after the last
sweep: **0** users left in the window, **0** orphaned `flashcard_schedule` rows. Only harness
accounts were in the window (`0` non-harness users created in it), and nothing older than
`14:14:33Z` was touched — the ~3100 decks that remain predate this phase and are not its to
delete. This matters past tidiness: `test-plan.md` §6.6 records a breakage check that decays
into a false pass once the deck table outgrows PostgREST's `max_rows = 1000`, and an uncleaned
matrix would have pushed it six times further past that line.

`supabase_edge_runtime` was left stopped by the Docker Desktop crash and was restarted;
`supabase_vector` is `Restarting`, which it also was **before** this phase began and is
therefore pre-existing.

### 5.5 What this does NOT prove

- **It is not a fix anyone gets by default.** The recreation is wiped by every `supabase stop`,
  so a developer who runs bare `npx supabase start` is back on the flaky configuration. That is
  exactly why `tests/setup/retry-transport.ts` stays, and nothing here justifies narrowing it.
  Phase 2 wires `npm run db:start`; it cannot wire the CLI.
- **One machine, one day, one Docker, one CLI.** No claim is made about another developer's
  stack, and the CI leg remains parity rather than necessity (research measured CI as
  structurally immune: 10–13 s suite, cold pool, one invocation per run).
- **Zero over 40 runs bounds the rate; it does not prove impossibility.** The idle timeouts are
  still equal at 60 s on both sides — untouched, and untouchable through any supported surface.
  What changed is that Kong no longer keeps an idle upstream socket it can lose. A drop stays
  conceivable through some path this matrix did not exercise.
- **The comparison carrying the weight is fixed-vs-control on the same day**, not
  fixed-vs-C10X-32. The historical 22/40 was measured on a different day against a smaller
  database with an unrecorded spacing, and the two controls here bracket it on both sides
  (1.38/run and 0.20/run) — so the *same-session* pair is the one to trust.
- **The drop RATE is not a stable quantity and nothing here models it.** Two controls an hour
  apart differ by a factor of seven (§5.2b), and this phase did not isolate which of the two
  conditions that changed — a much smaller deck table, or a 9–12 s run against a 5–6 s one —
  moved it. A future contributor comparing against a single number quoted here will be
  comparing against noise; compare a control run in their own session instead.
- **The drops' log LINES are gone.** Only the per-run counts survive — the restore replaced the
  control container and took its log with it. The count is the oracle the plan specified, and
  the line's text is already on record from C10X-32 and from this change's research.
- **Nothing here is evidence about the seam work.** Whether a replayed write is now loud is
  Phase 4's measurement; this phase reduces how often the replay happens locally and says
  nothing about what happens when it does.
