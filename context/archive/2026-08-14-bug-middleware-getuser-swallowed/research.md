---
date: 2026-08-14T15:29:56+02:00
researcher: Claude (Opus 5) for lirdaw
git_commit: 2326ecc3cbb18d5b33301bc26db30db56d738443
branch: main
repository: lirdaw/10xcards
topic: "Middleware reads a getUser() auth error as 'not signed in' (C10X-52)"
tags: [research, codebase, auth, middleware, swallowed-errors, supabase, sentry, locals]
status: complete
last_updated: 2026-08-14
last_updated_by: Claude (Opus 5)
---

# Research: Middleware reads a `getUser()` auth error as "not signed in" (C10X-52)

**Date**: 2026-08-14T15:29:56+02:00
**Researcher**: Claude (Opus 5) for lirdaw
**Git Commit**: `2326ecc3cbb18d5b33301bc26db30db56d738443`
**Branch**: `main`
**Repository**: lirdaw/10xcards

## Research Question

`src/middleware.ts` discards the error from `supabase.auth.getUser()`, so a transient
GoTrue/network failure is indistinguishable from an absent session: a user holding a valid
session gets a 302 to `/auth/signin`, and a JSON-fetching island gets a 401 plus the misleading
"Twoja sesja wygasła" banner. Read-side twin of C10X-51 (write side, closed) and hit #5 — the
last — of the 2026-08-11 swallowed-errors audit.

Scope confirmed with the requester before research began, on three axes, each taken at its
widest: **(1)** the `createClient() === null` branch is IN scope alongside the `getUser()`
error; **(2)** BOTH guard branches are in scope — the `302` for documents and the `401` for
fetch callers; **(3)** the Sentry channel is in scope, _with its cost measured_ rather than
assumed.

## Summary

**The ticket's premise is right and its implied fix is wrong, in a way that would have been
found only after writing it.** `change.md` predicts "a pure decision function with a truth
table plus one manual run, as in C10X-51". The shape transfers; the _discriminator_ does not,
and the reason is a single upstream fact that inverts C10X-51's central mechanism:

> `getUser()` returns an **error** for the ordinary signed-out visitor.
> `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:2495-2497` — with no access token
> it returns `{ data: { user: null }, error: new AuthSessionMissingError() }` **before any
> network call**.

C10X-51 could ship a plain `if (error)` precisely because `_signOut` allow-lists that same
class into `{ error: null }`. `_getUser` has **no such allow-list**. So the naive fix banners
every anonymous visitor to `/`, `/auth/signin` and `/auth/signup`, and reddens ~16 rows of
`tests/middleware.test.ts` — which is the good news, because the existing suite catches it on
the first run. This was established independently by three of the four research agents and then
verified directly against the installed package (auth-js **2.105.3**).

Five further findings shape the plan more than the defect statement does:

1. **There are five states, not three.** Signed-in · signed-out · auth error · `createClient()`
   `=== null` · **a thrown non-`AuthError`** — the last is unhandled anywhere: `_getUser`
   rethrows it (`GoTrueClient.js:2506-2517`) and `src/middleware.ts:46-53` has no `try`/`catch`,
   so it is an uncaught 500 on **every** request. Nothing in this repo names that state today.
2. **The discrimination logic already exists in this repo, and reusing it wholesale would
   re-introduce the bug.** `src/lib/auth-errors.ts` already keys on `error.name` + `code` +
   status (`:224-266`), already maps `AuthRetryableFetchError → AUTH_NETWORK_MESSAGE` (`:226`)
   and `status >= 500 → AUTH_NETWORK_MESSAGE` (`:264`), and `AUTH_NETWORK_MESSAGE` (`:46`)
   already says exactly what this ticket wants to say. But `authErrorMessage` is a **message**
   mapper for a caller that already knows a failure happened — it maps
   `AuthSessionMissingError → AUTH_SESSION_MISSING_MESSAGE` ("Twoja sesja wygasła", `:256`),
   i.e. it _presumes_ the very answer the middleware must compute. **The vocabulary is
   reusable; the classification is not.** The new pure function is a classifier, and it must be
   argued as distinct from the existing mapper or a reviewer will reasonably ask why both exist.
3. **The evidence splits into three tiers, not C10X-51's two — this ticket is better off than
   its sibling.** The signed-out branch is already driven ~16× by `tests/middleware.test.ts`
   with **no database and no network** (`:23-24`, verified). Only the transport-failure and
   `null`-client branches need a manual run. And **that manual run has already been executed
   once**: C10X-51's own Phase 5 recorded `SUPABASE_URL` → a dead port, then
   `GET /decks → 302 → /auth/signin` with a live cookie
   (`context/archive/2026-08-13-bug-signout-swallowed/verification.md:448`, annotated at
   `:474-479` as "the F1 mechanism, live"). That is this defect, observed, with a one-variable
   control and a hash-verified restore already in the archive.
4. **A Sentry capture in middleware is a first-order hazard, and this project already wrote the
   warning.** `src/lib/sentry-sampling.ts:14-19` names _this exact scenario_: middleware
   authenticates on every request, so an outage emits one error per inbound request site-wide;
   a first-party `captureException` carries no `logger === "console"` stamp and therefore takes
   the fail-open branch **unsampled** (`:88`); and exhausting the quota is **self-masking**,
   because unrelated errors then stop arriving and this project has no notification channel to
   say so. A capture here needs de-duplication or an explicitly accepted cost — it is not the
   free second channel it was at the four sibling sites.
5. **The `401` branch cannot change what an island shows by changing its body.**
   `src/lib/http.ts:52-53` overrides the body for **any** 401 with `SESSION_EXPIRED_MESSAGE`
   ("Twoja sesja wygasła") — verified verbatim. The clean route is a **different status**: a
   `503` falls through to `:60-62` and renders the middleware's own copy, a path already pinned
   green for a 500 at `tests/lib/http.test.ts:50-54`. Three of the four islands take a raw
   `res.json()` path and would surface a new `{ error }` for free.

The fix is cheap in code and expensive in bookkeeping. The cheapest defensible shape — a
classifier over the error, a distinct outcome for each of the five states, `/auth/signin` as
the document landing (it cannot be bounced), an existing `AUTH_MESSAGES` member as the copy, a
non-401 status for JSON callers — touches four guard tests, one of which has **two structural
blockers** against registering middleware at all.

## Detailed Findings

### 1. Upstream truth: what `getUser()` actually returns

Established by reading the installed `@supabase/auth-js` **2.105.3**, with the network-facing
classes measured against the live local stack. Verified by me directly for the load-bearing rows.

| #   | Condition                          | Shape                | `name` / `status` / `code`                           | Network?  |
| --- | ---------------------------------- | -------------------- | ---------------------------------------------------- | --------- |
| a   | No cookie at all                   | `{user:null}, error` | `AuthSessionMissingError` / **400** / `undefined`    | **No**    |
| b1  | Corrupt / undecodable cookie       | as (a)               | `AuthSessionMissingError` / 400 / —                  | No        |
| b2  | Cookie parses, not a session shape | as (a)               | `AuthSessionMissingError` / 400 / —                  | No        |
| b3  | Expired session, refresh rejected  | `{user:null}, error` | **`AuthApiError`** / 400 / `validation_failed`       | Yes       |
| c   | GoTrue unreachable (transport)     | `{user:null}, error` | `AuthRetryableFetchError` / **0** / —                | attempted |
| d   | GoTrue **500**                     | `{user:null}, error` | **`AuthApiError`** / 500 / server code               | Yes       |
| d'  | GoTrue 502/503/504/520-524/530     | `{user:null}, error` | `AuthRetryableFetchError` / that status              | Yes       |
| e   | GoTrue **429**                     | `{user:null}, error` | **`AuthApiError`** / 429 / `over_request_rate_limit` | Yes       |
| f1  | Revoked session, valid signature   | `{user:null}, error` | `AuthSessionMissingError` / **400** / —              | Yes       |
| f2  | Tampered / garbage token           | `{user:null}, error` | **`AuthApiError`** / **403** / `bad_jwt`             | Yes       |

**Nothing in this list returns `error: null`, and nothing in it throws.** `_getUser:2516`
rethrows only non-`AuthError` values; `_returnResult:243-248` throws only under
`throwOnError`, which defaults `false` and is not set by `@supabase/ssr`.

Three results contradict the obvious assumption and each one would have cost a wrong branch:

- **`500` is NOT retryable.** `lib/fetch.js:32` —
  `NETWORK_ERROR_CODES = [502,503,504,520,521,522,523,524,530]` (verified). A plain 500 becomes
  an `AuthApiError`. "5xx ⇒ `AuthRetryableFetchError`" is false, so a discriminator written from
  the class name alone misses the single most likely server-side failure.
- **`AuthSessionMissingError` fabricates its status.** A revoked token answers HTTP **403** with
  `code: "session_not_found"`, and `fetch.js:76-81` converts it to a constructor that hardcodes
  **400**. `error.status` is therefore not a usable discriminator on that class.
- **An ordinarily expired session does not produce `AuthSessionMissingError`.** It produces
  `AuthApiError(400, 'validation_failed')`. Discriminating on `isAuthSessionMissingError`
  **alone** would banner a user whose session merely lapsed — the same defect, one class over.

**The reliable split** (type guards exported from `lib/errors.js`, re-exported by
`@supabase/supabase-js`):

- **"not signed in", must NOT banner** — `isAuthSessionMissingError`, plus `isAuthApiError`
  where `code` ∈ {`bad_jwt`, `validation_failed`, `refresh_token_not_found`,
  `refresh_token_already_used`, `session_expired`, `session_not_found`}.
- **"backend broken", the real signal** — `isAuthRetryableFetchError`, plus `isAuthApiError &&
(status >= 500 || status === 429)`.

`error-codes.d.ts` carries its own header warning that the server may return codes absent from
the union, so a `default` arm is required and must fall to the _safe_ side.

**Two side effects the fix must not regress.** `_getUser:2508-2513` calls `_removeSession()` on
`AuthSessionMissingError` **only**, which emits `SIGNED_OUT` and makes `@supabase/ssr` write
cookie-clearing `Set-Cookie` headers through this project's `setAll`. Transport/500/429 errors
deliberately do _not_ clear the cookie — correct behaviour that a rewrite could easily lose.
And the transport class **already logs**: `fetch.js:120` does `console.error(e)` before
throwing, which `Sentry.captureConsoleIntegration` in `src/worker.ts` already captures. So
class (c) is _partly_ observable in production today; classes (d)/(e)/(f2) are not.

**Cost of the call.** `getUser()` is a network round trip on every request **that carries a
token** — no memoisation (`:2499-2503`), and `src/lib/supabase.ts:10` builds a fresh client per
request, so no cross-request cache exists. An **anonymous** request costs zero network (it
short-circuits at `:2496`). So the failure branch is reachable on every _authenticated_
request, and the middleware has no timeout, no circuit breaker and no `try`/`catch` around it.

`getClaims()` exists in this version (`:4821-4884`) and would change the taxonomy — with an
asymmetric signing key it verifies locally and issues no `/user` round trip, and it returns
`{data: null, error: null}` for the ordinary signed-out case, the opposite convention. **Not a
recommendation**: whether this project's JWTs are asymmetrically signed was not established,
and switching is a different ticket.

### 2. The five states, and the type that only fits two

`src/env.d.ts:1-5` (verified):

```ts
declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
  }
}
```

Two states fit. A third needs either a new field (`authStatus`) or a widened union. An **added
optional field compiles unchanged** against the test call sites, which cast
`{ user } as App.Locals` (`tests/fixtures/endpoint.ts:101,107`;
`tests/validation/signed-out.test.ts:163`; `tests/generation/generate.test.ts:171`;
`tests/study/study.test.ts:280`); the `satisfies Pick<App.Locals,"user">` at
`endpoint.ts:101` needs review either way. Declaration merging is established here — the
Cloudflare adapter already augments `App.Locals` with a required `cfContext`.

`src/middleware.ts:49` is the **only** `getUser()` call in `src/`.

### 3. Blast radius — every consumer of `locals.user`

| #     | Site                                                                                                                                                                  | Behaviour                                                     | Meaning of a third state                                            |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1     | `src/middleware.ts:50`                                                                                                                                                | `user ?? null`                                                | the write site                                                      |
| 2     | `src/middleware.ts:52`                                                                                                                                                | `null` on unconfigured client                                 | condition (3) — its own outcome                                     |
| 3     | `src/middleware.ts:56`                                                                                                                                                | `"/" && locals.user` → 302 `/decks`                           | truthiness only; a third state must not be truthy here              |
| 4     | `src/middleware.ts:61`                                                                                                                                                | `!locals.user` → guard fires                                  | **the branch point**                                                |
| 5     | `src/layouts/Layout.astro:15`                                                                                                                                         | `visibleConfigStatuses(missingConfigs, Boolean(locals.user))` | disclosure hazard — §7                                              |
| 6     | `src/layouts/AuthenticatedLayout.astro:11,24`                                                                                                                         | `{user?.email}`                                               | protected pages only; null-safe                                     |
| 7     | `src/components/Topbar.astro:2,9-35`                                                                                                                                  | `user ? … : "Not signed in"`                                  | rendered on `/`; **reachable with a live session during an outage** |
| 8     | `src/pages/dashboard.astro:4,14`                                                                                                                                      | `{user?.email}`                                               | protected; unreachable with null                                    |
| 9     | `src/pages/api/study.ts:56-59`                                                                                                                                        | `!user` → `401 {error}`                                       | JSON convention                                                     |
| 10    | `src/pages/api/generate.ts:200-203`                                                                                                                                   | `!user` → `401 {error, retriable:false}`                      | note the flag — §6                                                  |
| 11-16 | `decks/index.ts:29`, `decks/[publicId].ts:35`, `.../delete.ts:28`, `.../cards/index.ts:37`, `.../cards/[cardPublicId].ts:71`, `.../cards/[cardPublicId]/delete.ts:28` | `!user` → bare `redirect("/auth/signin")`, no `?error=`       | redirect convention                                                 |
| 17    | `.../cards/batch.ts:62-64`                                                                                                                                            | `!user` → `401 {error}`                                       | JSON convention                                                     |

Sites 9-17 are **defence in depth behind the middleware guard** — every one is prefix-matched
by `PROTECTED_ROUTES`, so in production the middleware answers first. Their behaviour is
nonetheless pinned by `tests/validation/signed-out.test.ts` (9 cases) and by two more files.

**The pages do not read `locals.user` at all.** `decks/index.astro:9`,
`decks/[publicId]/index.astro`, `review.astro`, `generate.astro:20`, `study/index.astro:13` and
`study/[publicId].astro` each build their own client and query under RLS. Their queries go to
PostgREST carrying the JWT — **they need no GoTrue round trip**. So today a transport blip
evicts a user from pages whose data would have loaded perfectly. That is the sharpest statement
of why this defect is gratuitous rather than merely misleading.

### 4. The two guard branches

**The `302` branch (`middleware.ts:77-79`)** targets `/auth/signin` with no query string.
`signin.astro:8` already reads `ownedAuthMessage(Astro.url.searchParams.get("error"))` into a
page-level `ServerError`, which renders nothing for a falsy message. **Vouching already exists**
and is enforced two ways (the helper at `auth-errors.ts:140-143`, and the per-line page guard
`tests/lib/error-param-guard.test.ts:82-90`). So a message on this branch costs **no new render
site** — the same free ride C10X-51 took.

> ⚠️ `tests/middleware.test.ts:98` and `:113` assert
> `expect(response.headers.get("Location")).toBe("/auth/signin")` **by equality**. Appending
> `?error=` to the _existing_ signed-out redirect reddens 8 cases. `tests/e2e/route-guard.spec.ts:77`
> waits on the bare glob `**/auth/signin`, which a query string would not match — 5 more rows.
> **Only the new branch may carry a parameter.**

**The `401` branch (`middleware.ts:71-75`)** carries `{ error: "Nie jesteś zalogowany" }`, a
bare literal in no closed set (twins at `study.ts:58`, `generate.ts:202`, `batch.ts:63`).
`tests/middleware.test.ts:90` asserts only `typeof … === "string"`, so the copy is free to
change — and equally, unguarded. The `Vary` header is pinned exactly
(`tests/middleware.test.ts:140-148`), so **any third representation must carry the identical
`Vary`**, and that test probes the two known branches by URL rather than by iteration, so it
will not cover a third one automatically.

### 5. Message sets — what a new member costs

| Set                       | Definition                              | Read guard                                                          | Size pin                           | Distinctness                                                                             |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `AUTH_MESSAGES` (20)      | `auth-errors.ts:97-118`                 | `ownedAuthMessage` `:140-143` at `signin.astro:8`, `signup.astro:8` | **none**                           | none over the array; a hand-built Set pinned at 17 (`tests/auth/errors.test.ts:133-154`) |
| `REDIRECT_MESSAGES` (11)  | `redirect-errors.ts:97-109`             | `ownedRedirectMessage` at three deck pages                          | **hard, exact** `toHaveLength(11)` | **yes**, `Set(...).size === 11`                                                          |
| `SESSION_EXPIRED_MESSAGE` | `http.ts:16` — a lone export, not a set | none (island side)                                                  | n/a                                | n/a                                                                                      |

- Adding to **`AUTH_MESSAGES` is free** — nothing goes red, and two whole-set controls pick a
  new member up automatically. Membership and distinctness rows are opt-in; C10X-51's
  `SIGNOUT_FAILED_MESSAGE` is the precedent for writing them by hand.
- Adding to **`REDIRECT_MESSAGES` is red on sight**, and it is the wrong channel anyway.
- **`AUTH_NETWORK_MESSAGE` already exists and already means this** (`auth-errors.ts:46`:
  "Brak połączenia z serwerem uwierzytelniania. Spróbuj ponownie za chwilę."), already mapped
  from `AuthRetryableFetchError` at `:226`. `AUTH_UNAVAILABLE_MESSAGE` (`:44`) covers the
  `null`-client condition. **Reuse is very likely cheaper than a new constant** — and it is the
  option that keeps the copy consistent with what `/api/auth/signin` already says during the
  same outage.

**The adjacency hazard is real and the plan must face it.** `SESSION_EXPIRED_MESSAGE`
(`http.ts:16`) and `AUTH_SESSION_MISSING_MESSAGE` (`auth-errors.ts:58`) are **byte-identical**,
and `SIGNOUT_FAILED_MESSAGE` says the opposite thing in the same banner. A backend-outage
message joins a set where three neighbours already talk about sessions.

### 6. The client side — four islands, three behaviours

`readJsonResponse` (`http.ts:38-65`) has exactly **one** consumer: `StudySession.tsx` (`:91`,
`:215`).

| Island                                 | Today, on the middleware 401                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `StudySession.tsx` ×2                  | **`SESSION_EXPIRED_MESSAGE`** — `http.ts:52-53` discards the body's `error` on any 401                                                       |
| `GeneratorForm.tsx:176-196`            | raw `res.json()` → shows "Nie jesteś zalogowany", **and offers "Ponów"**, because `retriable` is absent and `:192` reads absent-as-retriable |
| `FlashcardWorkspace.tsx:118-128`       | raw path → "Nie jesteś zalogowany"                                                                                                           |
| `CandidateReviewWorkspace.tsx:106-120` | raw path → "Nie jesteś zalogowany"                                                                                                           |

For the three raw-path islands **nothing has to change** — they surface the body's `error`
verbatim, so a new middleware body reaches the user for free. For `StudySession` the 401 branch
hard-overwrites, pinned by equality at `tests/lib/http.test.ts:63-72`. **Changing the status is
cheaper than changing `http.ts`**, which has 9 cases and five island call sites.

**`retriable` is back on the table**, and it was not for C10X-51 (whose three triggers were all
native form POSTs, so the flag had no reader). The middleware _does_ answer JSON callers.
C10X-48's D-08 governs: absent means retriable, measured, so a forgotten flag keeps the
affordance rather than silently removing it. Note the pre-existing inconsistency the plan may
want to leave alone deliberately: the middleware's 401 offers "Ponów" while `generate.ts:202`'s
own 401 does not.

### 7. Paths an outage reaches although they are not protected

1. **`/`** — `middleware.ts:56` stops bouncing, so a signed-in user lands on the guest page and
   `Topbar.astro:25` reads "Not signed in". The C10X-51 symptom, inverted. There is no message
   channel on `/` and there must not be one: `error-param-guard.test.ts`'s catch-all over all of
   `src/` names `pages/index.astro` explicitly in its positive control.
2. **`Layout.astro:15` — every page in the app.** `visibleConfigStatuses` filters
   `!cfg.requiresSession || hasSession`, and the OpenRouter entry carries `requiresSession: true`
   precisely so an anonymous visitor is not told whether generation is live or degraded to mock.
   **Today the false `null` suppresses that banner — the safe direction.** The hazard is created
   by the fix: if the third state is truthy, or if `Boolean(...)` sees anything but a real user,
   **the OpenRouter banner leaks to anonymous visitors** on `/` and `/auth/signin`, both of which
   render `Layout.astro`. `config-status.ts:20-23` should be re-read when the fix lands.
3. **`/auth/*`** — render normally, but each still pays a failing round trip.
4. **`/api/auth/*`** — pass the guard and then fail inside their own client: `signin.ts:38` →
   `AUTH_NETWORK_MESSAGE`, `signout.ts:82` → `SIGNOUT_FAILED_MESSAGE`. **These three already
   handle the outage correctly and are the model to copy.**
5. **Every request** pays one failing GoTrue round trip with no timeout and no `try`/`catch`.

**Circularity: clean, and already measured.** No `/auth/*` path is in `PROTECTED_ROUTES`
(pinned by `tests/middleware.test.ts:162-167`); `signin.astro` makes no Supabase call
(`ownedAuthMessage` is a pure array `includes`); `Layout.astro` makes none; `SignInForm` is a
native form POST, not a `fetch`. So `/auth/signin` **cannot be bounced and cannot itself fail** —
and since the middleware is itself the redirector here, it can answer in place without a second
hop at all.

### 8. Test reachability — three tiers, not two

| Outcome                   | Reachable from Vitest?              | Mechanism                                                                  |
| ------------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| ordinary signed-out       | **YES — already driven ~16× today** | `_getUser` short-circuits at `GoTrueClient.js:2496`, before any `_request` |
| signed-in                 | **YES**                             | `tests/middleware.test.ts:171-181`, real cookie from `accountA()`          |
| backend outage            | **NO**                              | needs a doubled module or a fabricated GoTrue response                     |
| `createClient() === null` | **NO**                              | needs `astro:env/server` doubled — identical to C10X-51's `unconfigured`   |

The test-plan's claim that "signed-out rows need no database — `getUser()` with no session fails
locally, without a network call" (`tests/middleware.test.ts:23-24`) is **verified, and is
stronger than the ticket assumes**: those rows already ride the `AuthSessionMissingError` path,
which is exactly why a naive `if (error)` is caught on the first run rather than in production.

Options for reaching the outage branch, each with the rule it breaks:

| Option                                              | Available?                                                                       | Rule it breaks                                                                                                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vi.mock("@/lib/supabase")`                         | technically                                                                      | §6.9's one-file confinement, **and** the load-bearing paragraph in `failure-path.test.ts:26-30`: doubling the module under test removes the code the assertion observes — `createClient` is the whole subject here |
| `vi.mock("astro:env/server")` → unset creds         | yes                                                                              | reaches only the `null`-client branch; §6.9 admits it only when unreachable any other way                                                                                                                          |
| same, → `SUPABASE_URL` at a dead local port         | yes, and it produces a **real** `AuthRetryableFetchError` from real auth-js code | still a second doubling file; note `@supabase/ssr` derives the cookie name from the URL **hostname**, so a port-only change may keep the captured cookie readable                                                  |
| `globalThis.fetch` double scoped to `/auth/v1/user` | the only option needing no module double                                         | collides with §6.4's "the database and RLS are never doubled" and §4's "only the external HTTP edge is ever doubled"                                                                                               |
| `msw`                                               | **no**                                                                           | not a dependency; §4 forbids a mocking library                                                                                                                                                                     |

`tests/setup/retry-transport.ts` would **not** absorb a deliberately failed auth request: its
predicate requires status **502** _and_ a body containing Kong's exact literal. A 500, a 503 or a
`TypeError` rejection all pass straight through.

**A browser journey cannot exercise this either.** `playwright.config.ts:11` resolves and asserts
the env at config-module evaluation, before `webServer` boots, and the `setup` project mints a
session by driving the real sign-in form — stopping Supabase mid-run kills the setup project
first. Same verdict as Vitest.

### 9. Guards a fix would trip

**Will go red — `tests/lib/sentry-capture-wiring.test.ts`.** Its catch-all (`:391-433`) scans
every `.ts/.tsx/.astro` under `src/` outside `TARGETS`. C10X-51 **proved this fires on this exact
file**: breakage 4.5 planted a capture in `src/middleware.ts` and went 1 of 17 red, naming
`src/middleware.ts:44`
(`context/archive/2026-08-13-bug-signout-swallowed/verification.md:369`). Registering middleware
as a third target hits **two structural blockers**:

1. `:414` — the scan control asserts `named` _contains_ `"middleware.ts"`. Registering it removes
   it from `named`, reddening that assertion. A neutral replacement file must be swapped in.
2. `:234` — every registered target is asserted to contain the literal
   `"export const POST: APIRoute"`. **`src/middleware.ts` has no such token** — it exports
   `onRequest` via `defineMiddleware`. That assertion is hardcoded outside the table and must be
   generalised into `CaptureTarget`.

Per-target shape constraints a new capture must satisfy: `lineFloor` + `measured` + a unique
`marker`; exactly one single-line `import { <builder> } from "<module>"`; exactly `captures`
statements, all delegating to that builder; first argument `new Error(...)`, **never the failure
itself**; no `contentFields` identifier on the statement.

**The blind spot — `tests/lib/form-endpoint-guards.test.ts`.** Its two `?error=` sweeps are keyed
on a registered table (`ERROR_PARAM_SURFACES`, `:112-121`) rooted at `src/pages/api/decks` and
`src/pages/api/auth/signout.ts`, with **no catch-all over `src/`** — unlike
`error-param-guard.test.ts` and `sentry-capture-wiring.test.ts`, which both have one. **A
`?error=` emission from `src/middleware.ts` would be inspected by nothing in this repo.** That is
precisely the "incomplete sweep left unstated" class that file's own header says it exists to
close, and the class that produced C10X-37. Registering a third surface forces three floors
upward, each of which this project requires to be **re-measured** rather than scaled.

**Scans middleware but will not fire:** `no-logging.test.ts` (only `console.*` — but note it is
textual, so a comment quoting `console.log(` trips it), `no-env-access.test.ts` (only
`import.meta.env` / `process.env`), `error-param-guard.test.ts` (only `.get("error")` **reads**,
so a middleware _producer_ is invisible to it). `no-client-redirect-errors.test.ts` is scoped to
`src/components/` and is unaffected.

**`tests/middleware.test.ts` itself carries the biggest blast radius** — 23 cases, an Astro
context fabricated by hand at `:66-73`. Five constraints a new branch inherits: it must not break
the two `it.each(PROTECTED_ROUTES)` tables (which drive the real imported array); it must keep the
C10X-27 F1 disjointness rows (`:110` and `:118` hit the **same path** and diverge on the caller
alone); it must set `Vary` on any third representation; it must stay inside both the
`PROTECTED_ROUTES` match and the `!locals.user` check or the public-path rows redden; and
**`context.cookies` is stubbed with only `set`**, so any new code path calling `cookies.get` /
`has` / `delete` throws there.

### 10. The Sentry channel, with its cost

`src/lib/sentry-sampling.ts:88` — `if (event.logger !== "console") return event;`. A first-party
`captureException` carries no such stamp, so it passes **unsampled** whatever the roll, pinned by
`tests/lib/sentry-sampling.test.ts:121-125`. The module's own header (`:14-19`) names this
ticket's scenario in advance:

> `src/middleware.ts` authenticates on EVERY request, so a Supabase outage makes
> `@supabase/auth-js` emit one error-level line per inbound request, site-wide. Unsampled, that
> is one event per request until the outage ends, and exhausting the plan's quota is
> **self-masking** — once the cap is hit, UNRELATED errors stop arriving and this project has no
> notification channel to say so.

So a capture placed here would, during precisely the outage it exists to report, produce one
unsampled first-party event per request **on top of** the dependency stream that _is_ thinned to
~10%. Nothing in `beforeSend` will thin it. This is a design constraint, not a footnote: the
capture needs its own de-duplication or rate limit at the call site, or an explicit
accepted-cost decision.

**One C10X-51 privacy argument does not transfer.** Its "no user identifier" rule had two
halves — intentional ("the session's owner is exactly who the event must not name") and
structural ("nothing on this path even reads the user — the route never touches `locals.user`").
**The middleware's whole job is to read the user.** Only the intentional half survives, and it
will need its own argument.

**The delivery boundary is unchanged and still open**: no DSN is configured under the test runner
or `npm run dev`, `/api/shipprobe` was deleted by C10X-54, and nothing in this project proves an
event ever arrives. Owner: `context/archive/2026-08-13-bug-generation-failed-audit-swallowed/follow-ups/sentry-delivery.md`.

## Code References

- `src/middleware.ts:46-53` — the defect: `{ data: { user } }` destructured, `error` discarded, no `try`/`catch`
- `src/middleware.ts:56` — `/` → `/decks`, gated on truthiness
- `src/middleware.ts:60-81` — the guard; `:71-75` the 401 branch, `:77-79` the 302 branch
- `src/middleware.ts:29-30`, `:74`, `:78` — `VARY_ON_CALLER` on both branches
- `src/env.d.ts:1-5` — `Locals.user: User | null`, the two-state type
- `src/lib/supabase.ts:7-9` — the `null` return; `:10` a fresh client per request
- `src/lib/auth-errors.ts:44,46` — `AUTH_UNAVAILABLE_MESSAGE`, `AUTH_NETWORK_MESSAGE`
- `src/lib/auth-errors.ts:224-266` — `MESSAGE_BY_NAME`, `messageByStatus`, the existing taxonomy
- `src/lib/auth-errors.ts:140-143` — `ownedAuthMessage`, equality membership
- `src/lib/http.ts:16` — `SESSION_EXPIRED_MESSAGE`; `:52-53` the 401 body override; `:60-62` the fall-through a non-401 takes
- `src/lib/sentry-sampling.ts:14-19` — the pre-written warning about a middleware-rate capture; `:88` the unsampled fail-open branch
- `src/lib/signout-outcome.ts:14-49` — C10X-51's extraction rationale and landing-page reasoning, the direct template
- `src/layouts/Layout.astro:15` + `src/lib/config-status.ts:46,63-65` — the session-gated config banner
- `src/components/Topbar.astro:25` — "Not signed in" on `/` during an outage
- `tests/middleware.test.ts:23-24` — the no-network claim, verified; `:66-73` the fabricated context; `:98`,`:113` Location by equality; `:140-148` the `Vary` pin
- `tests/lib/sentry-capture-wiring.test.ts:234`,`:414`,`:391-433` — the two registration blockers and the catch-all
- `tests/lib/form-endpoint-guards.test.ts:112-121` — the registered-surface table with no catch-all (the blind spot)
- `tests/lib/http.test.ts:50-54`,`:63-72` — the 500 fall-through and the 401 override, both pinned
- `tests/e2e/route-guard.spec.ts:77` — `waitForURL("**/auth/signin")`, a bare glob
- `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:2495-2497` — **the headline**; `:2506-2517` the rethrow; `:2508-2513` the cookie-clearing side effect
- `node_modules/@supabase/auth-js/dist/main/lib/fetch.js:32` — `NETWORK_ERROR_CODES`, without 500

## Architecture Insights

1. **A swallowed error is not always a missing `if (error)`.** The four shipped siblings all had
   one shape — read the result, branch on it. This one is a **classification** problem: the error
   is present on the success path too, so the fix is a discriminator, not a check. That is why
   the ticket's own predicted shape needs amending before planning.
2. **"Extract the decision, and extract its inputs with it"** (test-plan §6.1, C10X-34) applies
   here for a reason it did not at the four siblings: the classifier's input is an
   `AuthErrorLike`, which is fabricable, so **every branch becomes assertable on every
   `npm test`** even though two of them are unreachable through the endpoint.
3. **A guard rooted at a directory is a guard with an unstated boundary.** Two of this repo's
   textual guards carry a catch-all over `src/` and one does not; the one that does not is
   exactly the one a middleware `?error=` would need. This is the third recorded instance of the
   class (C10X-30's sweep, C10X-37's producers, C10X-51's per-surface table).
4. **The failure's landing page must not be one the same failure can gate** (test-plan §6.6,
   C10X-51). Here the middleware _is_ the gate, so the rule resolves in the friendliest possible
   way: it can answer in place, and `/auth/signin` — the one page no guard can bounce — is
   already a vouching surface.
5. **Observability has a rate, and rate is a design input.** Every prior capture site in this
   project sits on a path a user reaches deliberately (a generation, a sign-out). This one sits
   on _every request_, and the sampling module already knew that would be a problem.
6. **`Boolean(user)` is a session predicate that a third state silently redefines.** The config
   banner's gate is the one place where getting the truthiness wrong turns a suppression into a
   disclosure.

## Historical Context (from prior changes)

- `context/archive/2026-08-13-bug-signout-swallowed/` — the direct sibling and template.
  `plan.md:129-138` carves this ticket out and, after plan-review F1, explains the entanglement:
  under the original `/decks` landing "C10X-52 was not an unrelated twin at all — it was the
  mechanism that ate this change's only user-facing channel"; landing on `/auth/signin` "removes
  the dependency rather than the defect".
  `reviews/plan-review.md:42-64` is the measurement behind that.
  **`verification.md:448` (row 3) and `:474-479` record this defect firing live** — dead
  Supabase port, `GET /decks` → `302 → /auth/signin` with a live cookie — with a one-variable
  control (row 11) and a hash-verified restore. `verification.md:369` proves the Sentry catch-all
  fires on `src/middleware.ts` today. `verification.md:575-580` carries the restore failure worth
  inheriting: a regex restore of `.env` produced a line that _read_ correct and hashed wrong,
  because .NET's `.` consumed the `\r` in a CRLF file.
- `context/archive/2026-08-11-sentry-monitoring/research.md:236-242` — the fullest in-repo record
  of the 2026-08-11 audit (the audit itself has no repo artifact; it lives in Jira under
  `audit-swallowed-errors`). Hit #5 is this ticket, and its line numbers **still resolve** —
  three of the five had gone stale, this one did not. `:264-266` and `:403` hold
  `src/lib/supabase.ts:7-9` + `src/middleware.ts:51-53` as **"adjacent to C10X-52, not in the
  audit's five"** — so including the `null`-client branch (as this research does, by the
  requester's decision) is a deliberate widening the plan must state, not an inherited scope.
- `context/archive/2026-07-26-srs-study-session-test/` — C10X-27, which built the guard's current
  shape. `reviews/plan-review.md:46-79`: `wantsJson` discriminates on the **caller, not the
  path**, because a path rule would turn six native form targets into dead-end JSON pages.
  `reviews/impl-review.md:262-275` added `Vary` (F9). `verification.md:415-427` measured the
  disjointness that makes the two same-path rows evidence rather than decoration.
- `context/archive/2026-08-13-bug-generation-*` — the three generation-side siblings supply the
  two-channels pattern, the `retriable` decision records (C10X-48 D-08 absent-means-retriable,
  measured; C10X-49 D-03 the deliberate `false`), the report-builder privacy rules (synthetic
  `Error`, length + SHA-256 prefix, no user identifier), and **the C10X-49 control lesson**: a
  positive control sharing an `it()` with the assertion it attributes never runs under the
  breakage, because Vitest aborts at the first failed `expect`.
- `context/foundation/lessons.md:187-191` — the live, binding rule that a middleware guard must
  answer in the caller's format; `:131-135` — the Container API does not run project middleware.

## Related Research

- `context/archive/2026-08-13-bug-signout-swallowed/research.md` — the write-side twin; §2.2's
  failure-row taxonomy and §2.3's allow-list finding are the two things this research had to
  re-derive and found inverted.
- `context/archive/2026-08-11-sentry-monitoring/research.md` — the audit register and the
  `captureConsoleIntegration` boundary that makes all five hits invisible to the existing sink.
- `context/archive/2026-07-26-srs-study-session-test/research.md` — the origin of the JSON-vs-page
  discrimination this ticket must not disturb.

## Open Questions

1. **Does the `null`-client branch ship with this ticket?** Research covered it by decision, and
   `AUTH_UNAVAILABLE_MESSAGE` already exists for it — but the audit explicitly held it _outside_
   the five. Cheap to include, and the plan must say which it is doing and why.
2. **Does the JSON branch change status, or does `http.ts` change?** A `503` reaches the islands'
   own copy for free and leaves a 9-case helper untouched; changing `http.ts:52-53` touches five
   call sites. Recommended: change the status. Either way `Vary` must be carried and
   `tests/middleware.test.ts` extended, and the `retriable` flag decided under C10X-48's D-08.
3. **Does a Sentry capture ship at all, and if so at what rate?** The wiring guard has two
   structural blockers, and `sentry-sampling.ts:14-19` argues against an unthrottled capture at
   this site. Options: no capture (rely on the dependency `console.error` that already reaches
   Sentry for the transport class); a capture with call-site de-duplication; or a capture with an
   explicitly accepted quota cost. **This is the decision with the widest blast radius in the
   ticket** and it wants an explicit D-record.
4. **Does the fourth state — a thrown non-`AuthError` — ship with this ticket?** It is currently
   an uncaught 500 on every request, it is one `try`/`catch` away, and it is in no ticket at all.
5. **Is a new `?error=` producer registered in `form-endpoint-guards.test.ts`, or is the message
   carried some other way?** Leaving it unregistered re-opens the exact blind-spot class C10X-51
   closed one level down; registering it forces three re-measured floors.
6. **Does the third state alter `Boolean(Astro.locals.user)` at `Layout.astro:15`?** If it can be
   truthy, the OpenRouter config banner leaks to anonymous visitors. The safe default is that
   only a real `User` is ever truthy there.
7. **`getClaims()` was not evaluated as an alternative** and should not be, in this ticket — but
   it would remove the per-request round trip entirely for asymmetrically-signed projects, and
   whether this project's JWTs qualify was not established.

## Boundaries of this research

- **Classes (d) 500 and (e) 429 were not provoked**; they are read from `fetch.js:33-83` only.
- **Whether hosted GoTrue ever answers 401 where the local build answers 403** was not
  established — every measurement is one GoTrue version on the local stack. A discriminator keyed
  on `status === 403` alone would be fragile; key on `name`/`code`.
- **The happy refresh path** (expired access token + live refresh token) is read from source, not
  measured.
- **`tests/middleware.test.ts` case counts are static** (`it(` / `it.each` read from the file),
  not from a run — this project's own rule is that a figure quoted from a run must come from a
  run. The plan should re-measure by running the file alone.
- **Disclosure**: establishing failure class (f1) required a live probe that created **one
  throwaway auth user in the local dev database** (`c10x52-probe-<epoch>@example.com`, signed out
  globally, not deleted). Consistent with the dev-DB accumulation test-plan §6.6 already records;
  flagged here rather than left to be discovered. No file in the repository was modified by this
  research.
