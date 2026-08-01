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
