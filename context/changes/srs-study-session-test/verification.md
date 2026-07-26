# Verification log — srs-study-session-test (C10X-27)

Evidence produced by execution, phase by phase. Phase 4 consolidates the deliberate-breakage
runs recorded here into `context/foundation/test-plan.md` §6.6.

---

## Phase 0 — cloud migration history

Deferred through Phases 1–3 (it is explicitly **non-blocking**, plan-review F6 — every result
below is against the local stack, where the migration is applied), then **run at the end of
Phase 4**. Answer: **`20260724220524` is present on the remote.** Run from this worktree,
branch confirmed first (`lessons.md`: never run a migration command from the parent folder):

```
$ git branch --show-current
C10X-27-srs-study-session-test
$ npx supabase migration list
   Local          | Remote         | Time (UTC)
  ----------------|----------------|---------------------
   20260705180246 | 20260705180246 | 2026-07-05 18:02:46
   20260710195327 | 20260710195327 | 2026-07-10 19:53:27
   20260712162349 | 20260712162349 | 2026-07-12 16:23:49
   20260712162359 | 20260712162359 | 2026-07-12 16:23:59
   20260724195248 | 20260724195248 | 2026-07-24 19:52:48
   20260724220524 | 20260724220524 | 2026-07-24 22:05:24
   20260725112600 | 20260725112600 | 2026-07-25 11:26:00
   20260725112700 | 20260725112700 | 2026-07-25 11:27:00
   20260725133600 | 20260725133600 | 2026-07-25 13:36:00
   20260725150000 | 20260725150000 | 2026-07-25 15:00:00
```

**Local and Remote match on every row** — all ten migrations, no pending push, no
out-of-order gap. So the two objects this change's tests lean on are live in production: the
`session_size between 1 and 100` CHECK and the `study_due_cards` tie-break definition. The
S-03 impl-review's open question ("applied locally only, cloud push left to a later slice and
never confirmed") is **closed**: it was pushed at some point between then and now.

Nothing for `/ship` to carry on this front. **This change itself adds no migration**, so
`/ship`'s migration step is a no-op for C10X-27.

(Incidental: the CLI reports v2.109.1 available against v2.98.2 installed. Not acted on —
`test-plan.md` §4 pins 2.98.2 as the checked version, and bumping it mid-change would
invalidate that line without evidence.)

---

## Phase 1 — stop the silent rating loss

Environment: local Supabase stack up (`supabase status` → running), `OPENROUTER_API_KEY`
unset (generation in mock mode), dev server on `http://localhost:4321`, branch
`C10X-27-srs-study-session-test`.

### Automated

| Check                              | Result                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `npx astro sync`                   | pass (`[types] Generated`)                                                               |
| `npm run lint`                     | pass (two prettier errors in the new test files auto-fixed by `lint:fix`, then clean)    |
| `npm run build`                    | pass (server built in 5.27s)                                                             |
| `npm test`                         | **97/97 green, 10 files** — up from 69/69 / 8 files (+7 `http`, +21 `middleware`)        |
| `npx vitest run tests/lib/http.test.ts`      | 7/7                                                                            |
| `npx vitest run tests/middleware.test.ts`    | 21/21                                                                          |

### Deliberate-breakage check — the `ok`-before-parse ordering (criterion 1.5)

Neuter: an early `if (res.ok) return { ok: true, data: await res.json().catch(() => ({})) }`
inserted at the top of `readJsonResponse` (`src/lib/http.ts`), i.e. the pre-fix ordering the
defect had.

Observed: **exactly 2 of 7 red**, and they are precisely the two cases that observe the
ordering —

```
× fails on a 200 text/html body — the shape a followed sign-in redirect produces
    AssertionError: expected true to be false
× fails on a followed redirect even when the body parses as JSON
    AssertionError: expected true to be false
 Tests  2 failed | 5 passed (7)
```

The other 5 (JSON success, 4xx/5xx error copy, 404 status, 401 session-lost) stayed green.
That split is what proves those two assertions observe the ordering rather than an incidental
failure. Reverted; `7/7` green again, and `git status` shows no production edit left behind.

### Manual

All four criteria performed against the running dev server. Manual test account
`c10x27-manual@example.com`, deck **Sesja C10X-27** (`841f2326-58ff-4096-9200-92042048d098`)
with two accepted cards.

**1.6 — sign out in a second tab, then rate.** Session open on card 2, answer revealed;
signed out via "Wyloguj" in the other tab; clicked **Dobre**. Result: the error panel showed
**"Twoja sesja wygasła. Zaloguj się ponownie."** and the card did **not** advance (still
"Karta 1 z 1"). Before this change the same sequence advanced the card and incremented the
counter with no write.

Row-level confirmation, the claim's hard evidence:

```
      front      | reps | srs_state |            due             |        last_review
-----------------+------+-----------+----------------------------+----------------------------
 Karta 1 — przód |    1 |         2 | 2026-07-29 11:19:50.444+00 | 2026-07-26 11:19:50.444+00
 Karta 2 — przód |    0 |         0 | 2026-07-26 11:18:41.79+00  |
```

Karta 1 (rated with a live session) carries the transition; Karta 2 (the rating attempted
after sign-out) is untouched — `reps` 0, `srs_state` 0 New, `last_review` null. The failed
rating wrote nothing **and** the user was told.

**1.7 — a normal session still rates and advances.** Rating Karta 1 as **Dobre** advanced the
session to "Karta 2 z 2" with no error, and re-entering the session afterwards showed
"Karta 1 z 1" (Karta 1 correctly deferred by 3 days) — an independent check that the write
landed.

**1.8 — generation / review on an expired session show their own error copy.** Generation
performed live: source text entered, signed out in the other tab, clicked **Generuj** →
GeneratorForm rendered **"Nie jesteś zalogowany"** plus its **Ponów** button, no silent
success. The review screen and the flashcard workspace consume the identical 401 through the
identical code path — `POST /api/decks/<id>/cards/batch` answers
`401 application/json {"error":"Nie jesteś zalogowany"}` (probe below), and
`CandidateReviewWorkspace.tsx:115-117`, `FlashcardWorkspace.tsx:123-125` and
`GeneratorForm.tsx:161-163` all parse the body **before** checking `ok` and surface
`data.error`. `rate()` was the only one that did not; it now routes through
`readJsonResponse`.

**1.9 — a deck/card form on an expired session still lands on `/auth/signin`** (the F1
regression check). Signed-out probes against the dev server, `redirect: "manual"`:

| Request (signed out)                                                    | Result                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------- |
| `POST /api/study` (`Content-Type: application/json`)                    | `401 application/json {"error":"Nie jesteś zalogowany"}` |
| `POST /api/generate` (json)                                             | `401 application/json`                             |
| `POST /api/decks/<id>/cards/batch` (json)                               | `401 application/json`                             |
| `POST /api/decks` (form, urlencoded + `Accept: text/html` + `Origin`)   | `302 → /auth/signin`                               |
| `POST /api/decks/<id>` (rename form)                                    | `302 → /auth/signin`                               |
| `POST /api/decks/<id>/delete` (form)                                    | `302 → /auth/signin`                               |
| `POST /api/decks/<id>/cards` (create-card form)                         | `302 → /auth/signin`                               |
| `GET /decks`, `GET /study` (page navigations)                           | `302 → /auth/signin`                               |
| `GET /auth/signin`                                                      | `200 text/html` — untouched                        |
| `POST /api/auth/signin` (bad creds)                                     | `302 → /auth/signin?error=Invalid%20login%20credentials` — the endpoint's own answer, so the guard did not lock out sign-in |

And the defect's own path, `fetch` with the default `redirect: "follow"`:

```
POST /api/study -> status=401 ok=false redirected=false content-type=application/json
```

Previously this was `status=200 ok=true content-type=text/html` — the value `rate()` read as
success.

> **Harness note for whoever repeats these probes.** Astro's `checkOrigin` runs **before**
> middleware for form content-types, so a form POST without an `Origin` header answers
> `403 Cross-site POST form submissions are forbidden` and never reaches the guard. The first
> run hit exactly that and looked like a guard failure; it is not. JSON callers are unaffected.

---

## Phase 2 — close the four named coverage gaps

Environment: local Supabase stack up, `OPENROUTER_API_KEY` unset, branch
`C10X-27-srs-study-session-test`. Dev server on `http://localhost:4322` — port 4321 was still
held by the Phase 1 instance, which is also why that phase's manual account
(`c10x27-manual@example.com`) already existed.

### Automated

| Check                                                              | Result                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `npm test` **immediately after** the `enable_fuzz: false` edit, before any new test | **97/97 green, 10 files** — unchanged from the Phase 1 baseline    |
| `npx vitest run tests/study/study.test.ts`                         | **22/22** (16 → 22; six new cases)                                |
| `npm test` with the new cases                                      | **103/103 green, 10 files**                                       |
| `npx astro sync`                                                   | pass (`[types] Generated`)                                        |
| `npm run lint`                                                     | pass (one prettier error on a wrapped `listDueCards` call, fixed) |

The first row is the load-bearing one. `enable_fuzz: false` matches ts-fsrs 5.4.1's
`default_enable_fuzz`, so adding it explicitly must be behaviour-neutral; the suite staying at
97/97 across that single-line edit is what confirms the assumption this whole change rests on.
A red test there would have meant determinism was **not** already off and every exact-`due`
oracle in the file was measuring something else.

### What the six new cases are

| Case                                                       | What it observes                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| cap + batch composition                                    | `deck.session_size` → `p_limit` (5 due, cap 3 → 3 returned) and `toEqual` on the members, i.e. the RPC's `f.id asc` tie-break |
| cap bounds                                                 | endpoint Zod (`0`, `-1`, `101`, `2.5` → 400, value unchanged on re-read) **and** the DB CHECK (`23514` + `deck_session_size_check` in the message), with an in-range positive control |
| due re-entry                                               | rated at `FIXED_NOW`; absent from the batch at `FIXED_NOW + 1 min`, present at its persisted `due`, and back with `reps = 1` |
| four-grade write matrix                                     | every column vs an oracle from `createEmptyCard` advanced **only in memory**, for Again/Hard/Good/Easy                    |
| lapse from Review                                          | `lapses` 0 → 1 against the oracle, and `due`/`stability` strictly below what `Good` yields at the same `now`              |
| Relearning canary                                          | no row carries `srs_state = 3`, with a non-emptiness positive control                                                     |

**`State.Relearning` is unreachable, and this was confirmed by execution, not by reading.**
Under `enable_short_term: false` ts-fsrs runs `LongTermScheduler`, whose `next_state` sends
every grade — `Again` included — to `State.Review`. The lapse case asserts `State.Review` and
passes; asserting the "Review → Relearning" transition that `test-plan.md` §6.7 and the
C10X-27 audit note both describe would have failed. Phase 4 owes both documents that correction.

Deliberate-breakage runs for these assertions belong to **Phase 4** — as of this entry the six
cases are claims backed by a green run, not by a red one.

### Manual

Fixture: account `c10x27-p2@example.com` (fresh — the Phase 1 account's password was not
recoverable), deck **Cap manual P2** (`4313b23f-bdfa-4835-b344-40f7d7469901`) with **5** accepted
cards seeded via `psql`. The deck and cards are a fixture; how they were created is independent
of the cap mechanism, and the automated suite drives the real endpoints for creation anyway.
All 5 got schedule rows on the first session load, so every later load has more due cards than
the cap — which is what makes the cap binding rather than incidental.

**2.4 — a small session size set in the UI caps the batch.** Opened the session at the deck's
default cap of 20 → **"Karta 1 z 5"**. Typed `3` into "Kart na sesję", clicked **Zapisz** →
**"Zapisano — obowiązuje od następnej sesji."**, and the batch in hand stayed at 5 (correct by
design — it was already built server-side). Re-entered the session → **"Karta 1 z 3"**.

**2.5 — re-entry uses the deck's cap, not a default.** On that re-entry the control was
pre-filled with **3**, not the default 20 — i.e. the loader read `deck.session_size` and handed
it to the island. To rule out a coincidence, the cap was then changed to `4` and the session
re-entered: **"Karta 1 z 4"**. The batch tracks the stored value rather than any constant.

**Bonus — the third bound layer, which no test layer here can reach.** `test-plan.md` §7 records
islands' JSX as unreachable, and Phase 2's bounds case says so explicitly for
`SessionSizeControl`'s `SIZE_MIN`/`SIZE_MAX` mirror. Checked by hand instead: entering `101` and
clicking **Zapisz** rendered **"Rozmiar sesji musi być liczbą od 1 do 100."** and sent no
request. Row-level confirmation that the rejected value never landed:

```
     name      | session_size | accepted_cards | schedule_rows
---------------+--------------+----------------+---------------
 Cap manual P2 |            4 |              5 |             5
```

So all three layers of the bound are now accounted for: two by tests, the client mirror by this
observation. Phase 4 must record it that way and not imply the bound is proven end to end by
the suite.

> **Harness note.** The session-size input is a controlled React input. A `triple_click` + `type`
> issued too soon after a navigation is discarded when the island hydrates and re-renders from
> its props — the first `101` attempt silently reverted to `4`. Verify the typed value in a
> screenshot **before** clicking Zapisz; `form_input` alone is worse, since it does not always
> drive React state (it left the sign-in form's `validate()` reading empty strings).

---

## Phase 3 — the three recorded-but-unfixed items

Committed as `da5e9c2`. Its automated criteria (3.1–3.3) and manual criteria (3.4–3.6) were met
and confirmed at the time; the phase's own **evidence** is deliberately not duplicated here,
because Phase 4 owns every deliberate-breakage run in this change. The one Phase 3 claim that
needed re-checking — that the `scheduled_days` round-trip is behaviour-**neutral**, with the
exact-`due` oracles as the check — was re-verified by execution at the top of Phase 4: the full
suite is green at **109/109**, including `study.test.ts`'s single-transition and chained oracles.
Had the round-trip moved anything, those two would be red.

Phase 3 also grew the suite by one file: `tests/lib/study-session.test.ts` (4 cases over the
pure `rateOutcome` decision), which is why the count is 11 files / 109 tests rather than
Phase 2's 10 / 103.

---

## Phase 4 — produce the evidence, then rewrite the record

Environment: local Supabase stack up, `OPENROUTER_API_KEY` unset, branch
`C10X-27-srs-study-session-test`, working tree clean apart from `plan.md`.

**Baseline before any neuter: `npm test` → 109/109 green, 11 files.**
**Baseline after every restore: `npm test` → 109/109 green, 11 files**, `git diff` clean for
`src/` — no production edit left behind by any check below.

SQL-level neuters ran against the **live local DB** via `docker exec -i … psql` (§6.7), never a
`db:reset`. Every one of them dumps the object's definition before the neuter and after the
restore and `diff`s the two; the result is recorded per check.

### 1. The middleware guard's JSON-caller discriminator (Phase 1) — neutered BOTH ways

One direction is not enough here, and this is the pair that proves it: F1 (the plan-review
finding that the guard must branch on the **caller**, not the path) is only visible in the first
direction, and the fix itself is only visible in the second.

| Neuter | Result | What it proves |
| --- | --- | --- |
| `wantsJson(context.request)` → `context.url.pathname.startsWith("/api/")` | **8 of 21 red** | The F1 regression row — `redirects a native form POST to a deck endpoint` — goes red on `expected 401 to be 302`. Plus 4 JSON-caller rows on page paths (`/dashboard`, `/decks`, `/generate`, `/study`: `expected 302 to be 401`) and 3 page navigations on `/api/*` paths (`expected 401 to be 302`). |
| discriminator disabled outright (`false && wantsJson(…)`) | **8 of 21 red** | Exactly the eight JSON rows — the seven `it.each(PROTECTED_ROUTES)` cases plus `answers the SAME deck path with a 401 when the caller sends JSON`. **Every redirect row stayed green**, which is what proves the redirect half was never accidentally coupled to the new branch. |

A path-based discriminator turns the form row red; removing the discriminator turns the JSON rows
red; the two sets are disjoint. That disjointness is the actual evidence that the table pins the
discriminator rather than the paths.

Restored; `git diff src/` empty, `tests/middleware.test.ts` 21/21.

### 2. The `ok`-before-parse ordering (Phase 1), re-run on the current file

Neuter: an early `if (res.ok) return { ok: true, data: … }` at the top of `readJsonResponse`,
i.e. the pre-fix ordering the defect had.

**2 of 11 red** across `tests/lib/http.test.ts` + `tests/lib/study-session.test.ts` (7 + 4) —
`fails on a 200 text/html body` and `fails on a followed redirect even when the body parses as
JSON`, both `expected true to be false`. The other 9 stayed green, including all four
`rateOutcome` cases, which consume the *result* rather than the ordering. Same split Phase 1
recorded, now re-observed against the current files.

### 3. `session_size` → `p_limit` (Phase 2)

Neuter: `study_due_cards` re-created without `limit p_limit`.

**1 of 22 red** in `study.test.ts` — `caps the batch at the deck's cap and composes it
deterministically`, on `expected [ …(5) ] to have a length of 3 but got 5`. The wire from the
deck row to the RPC argument is observed.

### 4. The RPC's `f.id asc` tie-break (Phase 2) — the one check that did NOT behave as documented

Two variants, and they disagree:

| Neuter | Result |
| --- | --- |
| tie-break **removed** (`order by coalesce(s.due, p_now) asc` only) | **0 of 22 red — the suite stayed fully green** |
| tie-break **reversed** (`f.id desc`) | **1 of 22 red** — the same case, on `expected [ …(3) ] to deeply equal [ …(3) ]` |

**Record this honestly: the composition assertion observes the batch's ORDER, not the presence
of the tie-break.** With the tie-break gone every sort key collapses to `p_now` and the order is
formally unspecified — but on this data volume the planner returns insertion order anyway, so the
assertion passes. It would catch a change that reorders the batch; it would **not** catch someone
deleting the `f.id asc` clause, which is precisely the regression migration `20260724220524` was
written to prevent. Making that catchable needs a data volume or plan shape where the planner
actually diverges, and no test here creates one. Left as a named gap rather than papered over.

### 5. The `coalesce(s.due, p_now) <= p_now` predicate (Phase 2)

Neuter: the predicate dropped from `study_due_cards`.

**1 of 22 red** — `returns the card at its persisted due and withholds it a minute after the
rating`, on `expected [ Array(1) ] to not include '<card>'`. The red is on the **negative** half,
exactly as the plan predicted: it is the half that separates durability from "the RPC returned
something", and a positive-only test would have stayed green.

### 6. The `session_size` bounds, both layers (Phase 2)

| Neuter | Result |
| --- | --- |
| endpoint Zod `z.number().int().min(1).max(SIZE_MAX)` → `z.number()` | **1 of 22 red** — the bounds case, on `expected 500 to be 400`. The `500` is itself informative: with the Zod bound gone the value reaches Postgres and the CHECK refuses it, so the two layers are demonstrably independent rather than one shadowing the other. |
| `alter table deck drop constraint deck_session_size_check` | **1 of 22 red** — the same case one layer down, on `expected undefined to be '23514'`. |

> **Restore failure, caught by the verification and worth the next contributor's attention.**
> Re-adding the CHECK **failed**: `check constraint "deck_session_size_check" of relation "deck"
> is violated by some row`. The breakage run had itself written an out-of-range value — the
> test's own `setSessionSize(client, deckPublicId, 0)` landed while the constraint was absent.
> One row was affected (`Bounds deck ms1sa4dl`, `session_size = 0`, owned by the run's
> `harness-a-*` account); it was set back to the column default `20` and the constraint then
> re-added cleanly.
>
> The general rule this earns: **a constraint neuter is not symmetric with a function neuter.**
> `create or replace function` leaves no residue, but dropping a CHECK lets the suite persist
> data the constraint forbids, so the restore can fail *after* the evidence is collected. Inspect
> the violating rows before repairing, and never assume the `alter table … add constraint`
> succeeded — the `diff` below is what caught it.
>
> Definition `diff` after the repair: **identical** to the pre-neuter dump.

### 7. Re-run: `study_due_cards`' `and f.state_id = 2` predicate (§6.6's first recorded check)

Neuter: the accepted-only predicate dropped.

**1 of 22 red** — `never returns a generated or rejected card from a session build`, on
`expected [ …(3) ] to not include '<generated card>'`. §6.6 recorded this as "1 of 14"; the file
has since grown to 22 cases, so **the count is updated, the split is unchanged**.

Restore: `pg_get_functiondef` before/after **diff identical**. The function's ACL was re-checked
against the untouched `search_flashcards_in_deck` and is byte-identical
(`{=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`).

### 8. Re-run: the four-policy neuter — **this check has silently stopped working**

Neuter: `deck_select`, `flashcard_select`, `flashcard_schedule_select` and
`flashcard_schedule_update` all set to `using (true)` at once.

**3 of 22 red**, and the composition of those three is the finding:

| Red case | Assertion | Is it evidence? |
| --- | --- | --- |
| `returns 404 when B rates a card in A's deck` | `expected 200 to be 404` | **Yes.** B genuinely rated A's card. This is the one assertion that observed the neuter. |
| `stops counting a card once its schedule is rated into the future` | `expected undefined to be 1` | **No — knock-on.** |
| `never exposes another account's deck` | `expected undefined to be 1` on the **positive control** | **No — knock-on.** |

And the case that should have gone red **did not**: `never exposes another account's deck`
asserts `foreign.data?.[deckPublicId]` is `undefined`, and it **passed while the guard was
completely disabled** — a false pass.

The cause was traced, not guessed. `study_due_counts` carries no user predicate and no `LIMIT`
(RLS is its only scoping), so with `deck_select using (true)` it returns **every** deck in the
database. The local dev DB now holds **1053** decks and `supabase/config.toml:18` sets
`max_rows = 1000`, so PostgREST truncates the result and the freshly-created deck — A's own as
well as the one B must not see — simply falls outside the returned window. Both sides then read
`undefined`: the denial "passes" and the positive control fails.

That the policy really was wide open was confirmed independently at the SQL layer, under the
role-plus-JWT-claims pattern (`lessons.md`): as one user, `select count(*) from deck where
user_id = <other user>` returned **4**. So the guard was off and the test still said fine.

**Consequences for the record.** §6.6's recorded result for this check ("`listDueCounts` returned
A's deck to B — `expected 1 to be undefined`") was true when written and is **not reproducible
today**; it depended on the dev DB holding fewer decks than `max_rows`. Anyone re-running this
check must do so from a `db:reset` (or with `max_rows` raised), and until then the cross-account
claim for `listDueCounts` rests on the rate-path 404 alone. This is a live example of §6.6's own
warning that a coverage claim is only as good as its audit date — and of a subtler failure than
the ones catalogued so far: not a stale count, but an assertion that has quietly become
unfalsifiable because of the environment it runs in.

Restore: `qual`/`with_check` dumped from `pg_policies` before and after, **diff identical**.

### 9. Re-run: removing `enable_short_term: false` (§6.6's third recorded check)

**2 of 30 red** across `tests/study/` (22 + 8), up from the single red §6.6 records:

- `stays faithful across consecutive reviews, against an oracle kept only in memory` —
  `expected 1780316400000 to be 1780488600000`, the **same value pair** §6.6 recorded.
- `increments lapses on Again from Review and resurfaces the card sooner than Good would` — a new
  second witness, added by Phase 2. It fails on its **precondition**
  (`study.test.ts:831 expect(settled?.srs_state).toBe(State.Review)` → `expected 1 to be 2`):
  with short-term steps on, three `Good` ratings leave the card in `Learning` rather than
  graduating it to `Review` — literally the pinned-in-Learning bug from the S-03 impl-review F1,
  reproduced from the user's side rather than from the oracle's.

**The `srs_state = 3` canary did NOT fire, and that is worth knowing.** It stayed green under the
flip, because the card never reaches `Review`, so `Again`-from-`Review` never happens and
`Relearning` is never written. The canary is a guard against a *silently different* schedule, not
a detector for this flag — the two cases above are what detect it.

### 10. Narrowed mutation run — `rateCard`

Span **re-derived** as required: `rateCard` occupies `src/lib/study.ts:291-350` today, not the
`257-316` the plan recorded — Phase 3 §2's edits above it shifted the function down 34 lines.

```
npx stryker run --mutate "src/lib/study.ts:291-350"
→ 56.90% total / 71.74% covered — 33 killed, 13 survived, 12 no coverage, 0 errors, 0 timeouts
```

The permanent `mutate` list in `stryker.config.json` was **not** modified. Every survivor is
classified individually in
`context/changes/srs-study-session-test/mutation-register.md`; **no assertion was added**, and
the register states per mutant why. The two findings worth surfacing here:

- Three survivors mutate a `.select("…")` to `.select("")`. Reproduced by hand (22/22 still
  green) and then explained by probing PostgREST directly: an empty `select=` is read as
  `select=*`, i.e. a strict **superset** of the requested columns, so the mutation cannot change
  behaviour. This **inverts** S-05's precedent, where a `""` string mutant died on a malformed
  query — here it is not malformed at all. Neither a surviving nor a killed `""` mutant can be
  classified without checking the query semantics first.
- The remaining survivors and **all twelve** uncovered mutants sit in `rateCard`'s four
  `if (…Error)` branches and their return payloads. `rateCard`'s query **predicates** are well
  asserted (**27 of 33** kills are behavioural, 6 merely structural — classified by script from
  the JSON report during the manual-verification pass, after a hand count first said 26/7); its
  **failure handling** is not asserted at all, and
  cannot be without a fault-injection seam §6.4 deliberately does not provide.

### 11. Final state

| Check | Result |
| --- | --- |
| `npm test` | **109/109 green, 11 files** |
| `npm run lint` | pass |
| `npx astro sync` | pass |
| `git diff` on `src/` | empty — no production edit left behind by any breakage check |
| Every restore | verified by a before/after definition `diff`; all identical (the CHECK required a row repair first — §6) |

### Manual verification (4.5–4.7), performed by the agent

**4.5 — every restore verified by a definition `diff`.** Done per check at the time, then
re-confirmed in one consolidated pass at the end: `study_due_cards`, `deck_session_size_check`
and the four RLS policies all diff **identical** against their pre-neuter dumps.

Then a stronger check than the criterion asked for, because a `diff` against one's own "before"
dump proves nothing if that dump was already contaminated: the live objects were compared to the
**migrations** as the source of truth. `study_due_cards`' body is byte-identical (whitespace
normalised) to `20260724220524`'s definition; the CHECK's live rendering
`((session_size >= 1) AND (session_size <= 100))` is Postgres' canonical form of that migration's
`between 1 and 100`; and all four policy predicates match `20260705180246` / `20260724195248`.
Code-level restores are covered by `git diff` on `src/` being empty.

**4.6 — `test-plan.md` re-read end to end.** Six defects found and fixed, **five of which
pre-date this change** and one of which I had just written:

| Where | Defect | Fix |
| --- | --- | --- |
| §6.1 | "For three months this paragraph asserted…" — **written by me in this phase**. Phase 4 wrote it on 2026-07-24; the span was **two days** | corrected to the dated span |
| §6.5 | "`/api/generate` is the project's only JSON endpoint" — false since S-03; enumeration shows **three** (`generate`, `study`, `cards/batch`) | corrected, and tied to why it now matters (the guard branches on exactly those three) |
| §6.4 | Preflight's abort list omitted **two** seams `lessons.md` calls non-negotiable: the local-host assertion and the `OPENROUTER_API_KEY` refusal | both documented |
| §6.5 | `src/lib/generations.ts:29-34` — the compensating update is nowhere near those lines | replaced with the symbol name |
| §6.6 | `study.test.ts:270-283` / `:190-201` cited for the signed-out 401 — those lines are now a different case | replaced with case/helper names; the audit note gained an "as-of-audit" caveat for its remaining line refs |
| §6.6 | "the **seven** redirect-style deck endpoints" | **six** — there are seven files under `api/decks/`, but `cards/batch.ts` is JSON, not a form target |

Verified-and-correct while reading: §4's stack versions against the tree (Vitest 4.1.10, Astro
6.3.1, ts-fsrs 5.4.1 under `^5.4.1`, jsx-a11y 6.10.2, Supabase CLI 2.98.2 over a `^2.23.4`
floor), `vitest.config.ts`'s `include`/`environment`/`testTimeout`, `openrouter.ts:149-158`,
`SERVER_TIMEOUT_MS = 40_000`, `decks.test.ts:22`, the `1 of 13` split (`generate.test.ts` still
holds 13 cases), and `tests/middleware.test.ts`'s 21 cases.

Historical counts inside dated entries (`45/45`, `46/46`, `66/66`, `69/69`) were **left alone** —
they are records of runs that happened, not current claims. The two that could be misread as
current were stamped with their date.

**4.7 — the survived-mutant register.** Cross-checked mechanically against Stryker's JSON, not
by eye: 13 survived mutants across 11 distinct lines, and **every one of those lines appears in
the register's table** (11 rows numbered 1–13; two rows cover pairs on the same line). Each row
carries a verdict and a reason, and the three `""`-select rows carry the reproduction and the
PostgREST probe that justify calling them equivalent rather than gaps.

One error surfaced in that check and is recorded rather than silently amended: the killed-mutant
split was hand-counted as "26 behavioural / 7 structural" and is actually **27 / 6**. Re-derived
by script over the JSON report. A register whose own arithmetic goes unchecked is the same
failure mode as the stale counts this change exists to replace.

**Phase 0 (0.1 / 0.2) — still not run**, and deliberately so: it is non-blocking by design
(plan-review F6), every result above is against the local stack where `20260724220524` is
applied, and `npx supabase migration list` needs an active `supabase link` that lives in
gitignored `supabase/.temp/`. `20260724220524` goes to `/ship` as **unverified against cloud**.
