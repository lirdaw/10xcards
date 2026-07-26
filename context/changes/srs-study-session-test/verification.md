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

## Phases 2–4

Not run yet.
