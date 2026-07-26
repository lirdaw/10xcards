# Verification log — srs-study-session-test (C10X-27)

Evidence produced by execution, phase by phase. Phase 4 consolidates the deliberate-breakage
runs recorded here into `context/foundation/test-plan.md` §6.6.

---

## Phase 0 — cloud migration history

Not run yet. `npx supabase migration list` still owes an answer on whether
`20260724220524_srs_study_schedule_review_fixes.sql` reached the linked cloud project. The
phase is explicitly **non-blocking** (plan-review F6) — every result below is against the
local stack, where the migration is applied — so Phase 1 proceeded without it.

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

## Phases 3–4

Not run yet.
