# Middleware reads a `getUser()` auth error as "not signed in" — Implementation Plan

## Overview

`src/middleware.ts:46-53` destructures `{ data: { user } }` from `supabase.auth.getUser()` and
discards `error`. So a transient GoTrue/network failure is indistinguishable from an absent
session: a user holding a valid session is bounced to `/auth/signin`, and a JSON-fetching island
is told "Twoja sesja wygasła". This is hit #5 — the last — of the 2026-08-11 swallowed-errors
audit, and the read-side twin of C10X-51 (write side, closed).

The fix is a **classifier**, not a check. That distinction is the whole plan, and it inverts what
`change.md` predicted.

## Current State Analysis

### The upstream fact that decides everything

`getUser()` returns an **error for the ordinary signed-out visitor**. Verified directly against
the installed `@supabase/auth-js` **2.105.3** during planning:

```
GoTrueClient.js:2496-2497
  if (!data.session?.access_token && !this.hasCustomAuthorizationHeader) {
      return { data: { user: null }, error: new errors_1.AuthSessionMissingError() };
  }
```

— returned **before any network call**. C10X-51 could ship a plain `if (error)` because
`_signOut` allow-lists that class into `{ error: null }`. `_getUser` has **no such allow-list**.
A naive `if (error)` here banners every anonymous visitor to `/`, `/auth/signin` and
`/auth/signup`, and reddens roughly 16 rows of `tests/middleware.test.ts` on the first run.

### The failure taxonomy, and the three rows that contradict the obvious assumption

| #   | Condition                          | `name` / `status` / `code`                           | Network?  |
| --- | ---------------------------------- | ---------------------------------------------------- | --------- |
| a   | No cookie at all                   | `AuthSessionMissingError` / 400 / —                  | **No**    |
| b1  | Corrupt / undecodable cookie       | `AuthSessionMissingError` / 400 / —                  | No        |
| b2  | Cookie parses, not a session shape | `AuthSessionMissingError` / 400 / —                  | No        |
| b3  | Expired session, refresh rejected  | **`AuthApiError`** / 400 / `validation_failed`       | Yes       |
| c   | GoTrue unreachable (transport)     | `AuthRetryableFetchError` / **0** / —                | attempted |
| d   | GoTrue **500**                     | **`AuthApiError`** / 500 / server code               | Yes       |
| d'  | GoTrue 502/503/504/520-524/530     | `AuthRetryableFetchError` / that status              | Yes       |
| e   | GoTrue **429**                     | **`AuthApiError`** / 429 / `over_request_rate_limit` | Yes       |
| f1  | Revoked session, valid signature   | `AuthSessionMissingError` / **400** / —              | Yes       |
| f2  | Tampered / garbage token           | **`AuthApiError`** / **403** / `bad_jwt`             | Yes       |

Three of these would each have cost a wrong branch:

- **`500` is NOT retryable.** Verified: `lib/fetch.js:32` —
  `NETWORK_ERROR_CODES = [502,503,504,520,521,522,523,524,530]`, no 500. A plain 500 becomes an
  `AuthApiError`. "5xx ⇒ `AuthRetryableFetchError`" is false, so a discriminator written from the
  class name alone misses the single most likely server-side failure.
- **`AuthSessionMissingError` fabricates its status.** A revoked token answers HTTP 403 with
  `session_not_found`; `fetch.js:76-81` converts it to a constructor hardcoding **400**. So
  `error.status` is not a usable discriminator on that class.
- **An ordinarily expired session is NOT `AuthSessionMissingError`.** It is
  `AuthApiError(400, validation_failed)`. Discriminating on `isAuthSessionMissingError` **alone**
  would banner a user whose session merely lapsed — the same defect, one class over.

Nothing in that list returns `error: null`, and nothing in it throws. `_getUser` rethrows only
**non-`AuthError`** values (`GoTrueClient.js:2516`), and `src/middleware.ts` has no `try`/`catch`
— so that fifth state is an uncaught 500 on **every** request today.

### The two guard branches

- **`302` (`middleware.ts:77-79`)** targets `/auth/signin` with no query string. `signin.astro:8`
  already reads `ownedAuthMessage(Astro.url.searchParams.get("error"))` into a page-level
  `ServerError` that renders nothing for a falsy message. **A message here costs no new render
  site.**
- **`401` (`middleware.ts:71-75`)** carries `{ error: "Nie jesteś zalogowany" }`.
  `tests/middleware.test.ts:90` asserts only `typeof … === "string"`, so the copy is free.

### Key Discoveries

- `src/middleware.ts:49` is the **only** `getUser()` call in `src/`.
- `src/lib/http.ts:52-53` overrides the body of **any** 401 with `SESSION_EXPIRED_MESSAGE` —
  verified. So the JSON branch cannot fix its copy by changing its body; it must change status.
  A non-401 falls through to `http.ts:60-62` and renders the endpoint's own `error`, a path
  already pinned green for a 500 at `tests/lib/http.test.ts:50-54`.
- Three of the four `fetch`-carrying islands (`GeneratorForm`, `FlashcardWorkspace`,
  `CandidateReviewWorkspace`) take a raw `res.json()` path and surface a new body **for free**.
  Only `StudySession` goes through `readJsonResponse`.
- `AUTH_NETWORK_MESSAGE` (`auth-errors.ts:46`) and `AUTH_UNAVAILABLE_MESSAGE` (`:44`) already
  exist, already mean exactly this, and are already `AUTH_MESSAGES` members — so `ownedAuthMessage`
  vouches for them with no size or distinctness work.
- **The auth-js type guards are duck-typed, not `instanceof`** — measured during planning:
  `isAuthApiError(e)` is `'__isAuthError' in e && e.name === 'AuthApiError'` (`errors.js:39-62`).
  They read the same `name` string a structural check reads, so they buy only a marker-presence
  test.
- `@supabase/supabase-js` **does** re-export them (`export * from "@supabase/auth-js"`, verified
  in `dist/index.d.mts:7`) and is a direct dependency at `^2.99.1`. So `auth-errors.ts:29-34`'s
  claim that the family is "reachable only from `@supabase/auth-js`, a hoisted transitive dep" is
  **weaker than it reads** — see D-05.
- `tests/middleware.test.ts` is **23 cases**, measured by running the file, not read from it.
- `tests/lib/sentry-capture-wiring.test.ts:414` asserts the catch-all's scanned list **contains**
  `middleware.ts`. With no capture shipping, that stays true and **the file needs no change**.
- `tests/lib/form-endpoint-guards.test.ts` has a registered-surface table
  (`ERROR_PARAM_SURFACES`, `:112-121`) and **no catch-all over `src/`** — so a `?error=` emission
  from the middleware would be inspected by nothing in this repo.
- The "exactly six `formData()` readers" hard count (`:262-278`) walks `API_DIR`, **not**
  `ERROR_PARAM_SURFACES` — verified. Registering a surface outside `src/pages/api/` therefore
  cannot disturb it.

## Desired End State

A signed-in user whose auth backend is briefly unreachable is told the **backend** is unreachable,
not that their session expired — on both guard branches, in each caller's own convention. An
anonymous visitor's experience is byte-identical to today **on a configured deployment**.

> **Scoped by this change's impl-review (F2, 2026-08-14), and the scope is the whole of the
> correction.** The unqualified claim held for `unavailable` and was measured there (Phase 5 row 5,
> in both stack states): `getUser()` answers `AuthSessionMissingError` before any transport is
> attempted, so a visitor with no cookie cannot reach the outage branch however dead the backend
> is. **`unconfigured` has no such short-circuit.** On a deployment missing
> `SUPABASE_URL`/`SUPABASE_KEY` the guard answers EVERY caller — anonymous ones included — with
> `AUTH_UNAVAILABLE_MESSAGE`, where before this change they got a bare `302` (or a `401`). That is
> D-02 working as designed and it matches what all three sibling auth routes already do with the
> same condition, so it is a widening rather than a defect — but the branch was never exercised
> (`verification.md:704`: no run removed the two variables), so it is inference, and the
> unqualified sentence would have read as a measurement covering it.

Verified by: the classifier's truth table green on every `npm test`; `tests/middleware.test.ts`
still 23/23 with no row edited; and one manual before/after run against a dead Supabase port,
where the same request answers today's misleading redirect before the fix and the outage message
after it.

## What We're NOT Doing

- **No Sentry capture** (D-01). The middleware authenticates on every request; a first-party
  capture here is unsampled by construction and self-masking on quota exhaustion.
- **No `App.Locals` change** (D-04). No new field, no widened union.
- **Not fixing `/` and `Topbar.astro`.** During an outage a signed-in user still lands on the
  guest page reading "Not signed in" (research §7.1). Out of scope, stated rather than hidden.
- **Not changing `src/lib/http.ts`.** Its 401 override stays exactly as C10X-27 left it.
- **Not touching `sentry-capture-wiring.test.ts`**, and not registering middleware as a capture
  target. Its two structural blockers never arise.
- **No `getClaims()` evaluation.** It would remove the per-request round trip for
  asymmetrically-signed projects; whether this project's JWTs qualify is unestablished, and
  switching is a different ticket.
- **No `Retry-After` header** on the 503 (D-09).
- **No migration.** Nothing under `supabase/` is touched, so the C10X-29 drift gate is not
  involved.

## Implementation Approach

Extract the decision, and extract its inputs with it (test-plan §6.1). Both failure branches are
unreachable from Vitest — a healthy local stack cannot be made to fail, and `astro:env/server` is
inlined at transform time — so the classification lives in a pure module over a **fabricable**
argument, where every branch is asserted on every `npm test`. The middleware keeps only what a
pure function cannot do: observing `getUser()`, and assembling the two responses.

This is the project's fifth such extraction, after `readJsonResponse` / `rateOutcome` (C10X-27),
`visibleConfigStatuses` (C10X-34) and `signOutLanding` (C10X-51). The template is
`src/lib/signout-outcome.ts`, which this module should read as a sibling of.

**Why the classifier is distinct from `authErrorMessage`, and this must be argued at the site or a
reviewer will reasonably ask why both exist.** `authErrorMessage` is a **message mapper for a
caller that already knows a failure happened** — it maps `AuthSessionMissingError` →
`AUTH_SESSION_MISSING_MESSAGE` ("Twoja sesja wygasła"), i.e. it _presumes_ the very answer the
middleware has to compute. The vocabulary is reusable; the classification is not. Reusing
`authErrorMessage` wholesale would re-introduce this exact bug.

## Critical Implementation Details

**Ordering: `locals.user` must be assigned before the `/` rule, and the classification must not
change it.** `middleware.ts:56` gates the `/` → `/decks` bounce on `context.locals.user`
truthiness. Under D-04 `locals.user` stays `User | null` and is truthy only for a real user, so
that rule, `Layout.astro:15`'s `Boolean(Astro.locals.user)` and all 17 consumers behave exactly as
today. This is what keeps the OpenRouter config banner suppressed for anonymous visitors — the one
place where getting truthiness wrong turns a suppression into a **disclosure**.

**The classification must stay inside both existing conditions.** The new branch belongs inside
`PROTECTED_ROUTES.some(...)` **and** inside `if (!context.locals.user)`. Hoisting it above either
one reddens the public-path rows (`tests/middleware.test.ts:162-167`) and would make an outage
gate `/auth/signin` itself — the circularity this design exists to avoid.

**The 302 branch may carry `?error=` only on the NEW branch.** `tests/middleware.test.ts:98` and
`:113` assert `Location` **by equality** against `/auth/signin`, and
`tests/e2e/route-guard.spec.ts:77` waits on the bare glob `**/auth/signin`. Appending a query
string to the _existing_ signed-out redirect reddens 8 Vitest rows and 5 Playwright rows.

**Any third representation must carry the identical `Vary`.** `middleware.test.ts:140-148` pins it
exactly — and probes the two known branches **by URL rather than by iteration**, so it will not
cover a third branch automatically.

**`context.cookies` is stubbed with only `set`** in the test harness (`middleware.test.ts:71`), so
any new code path calling `cookies.get` / `has` / `delete` throws there.

**Do not regress the cookie-clearing side effect.** `_getUser:2508-2513` calls `_removeSession()`
on `AuthSessionMissingError` **only**, which makes `@supabase/ssr` write cookie-clearing headers
through this project's `setAll`. Transport / 500 / 429 errors deliberately do _not_ clear the
cookie — correct behaviour a rewrite could easily lose. The fix must not move, wrap or suppress
that call; it only reads what `getUser()` returned.

---

## Phase 1: The classifier

### Overview

A pure, total module that answers "does this `getUser()` result mean _no session_ or _the auth
backend is unavailable_", with an exhaustive truth table. No production wiring — so the table is
written and falsified before anything depends on it.

### Changes Required:

#### 1. The decision module

**File**: `src/lib/auth-outcome.ts` (new)

**Intent**: Own the classification and the landing for a failed session check, so both branches
that are unreachable through the endpoint become assertable on every `npm test`. Its header must
carry three arguments a reviewer will otherwise ask for: why it exists as a module (both failure
branches unreachable from the suite), why it is **not** `authErrorMessage` (that mapper presumes
the answer this one computes), and why the split is keyed on `name`/`code` rather than on
`status` (`AuthSessionMissingError` fabricates 400).

**Contract**: A discriminated union over the three states the guard can be in, and a total
function from it to a landing:

- `AuthCheckOutcome = { kind: "no-session" } | { kind: "unavailable" } | { kind: "unconfigured" }`

  **Three states, and none of them is `signed-in`.** A `signed-in` variant would be constructed by
  nobody: Phase 2 computes an outcome only where `context.locals.user` is null, and the landing is
  read only inside `if (!context.locals.user)`, so its branch is unreachable and a truth-table row
  for it would assert a state production cannot produce. Every variant here has a named call site,
  which is the property `SignOutOutcome` has and the discarded fourth would have broken.

  **`unconfigured` is separate from `unavailable` because the two carry DIFFERENT copy**
  (`AUTH_UNAVAILABLE_MESSAGE` vs `AUTH_NETWORK_MESSAGE`, D-06), so one variant cannot hold both —
  and it is the same split `SignOutOutcome` draws for the same `!supabase` condition. Its producer
  is the `else` arm at `middleware.ts:51-53`, i.e. it never passes through `classifyAuthError` at
  all; only `unavailable` and `no-session` do.

- `classifyAuthError(error: AuthErrorLike | null | undefined): "no-session" | "unavailable"`
- `authGuardLanding(outcome)` → `{ message: string | null }`, where `message` is a member of
  `AUTH_MESSAGES` or `null`.

`AuthErrorLike` is **imported from `@/lib/auth-errors`**, not redeclared (D-05). The classifier
reads `name` and `code` only; `status` participates solely through the 429 / ≥500 rule, and never
on the `AuthSessionMissingError` class.

The split, which is the substance of the module:

- **"not signed in"** — `name === "AuthSessionMissingError"`, plus `AuthApiError` whose `code` is
  one of `bad_jwt`, `validation_failed`, `refresh_token_not_found`,
  `refresh_token_already_used`, `session_expired`, `session_not_found`.
- **"backend unavailable"** — `name === "AuthRetryableFetchError"`, plus `AuthApiError` with
  `status >= 500` or `status === 429`.
- **The `default` arm must fall to the SAFE side**, i.e. `no-session`.
  `error-codes.d.ts` carries its own header warning that the server may return codes absent from
  the union, and a wrong `unavailable` banners a visitor who is simply signed out — the defect
  this ticket exists to remove, inverted. Write the reason at the site.
  **The arm is unconditional, and that is what keeps it one arm rather than two.** It is not
  softened for a value that matches nothing at all (`{}`, an arbitrary object), because the only
  producer of such a value — a thrown non-`AuthError` — **never reaches this function**: Phase 2's
  `catch` answers `unavailable` itself. A default that fell to `no-session` for an unknown `code`
  and to `unavailable` for an unknown shape would be one arm doing two jobs in opposite
  directions, and the direction it got wrong would ship this ticket's own defect inverted.

`unavailable` maps to `AUTH_NETWORK_MESSAGE`; `unconfigured` maps to `AUTH_UNAVAILABLE_MESSAGE`;
`no-session` maps to `null` (D-06).

#### 2. The truth table

**File**: `tests/lib/auth-outcome.test.ts` (new)

**Intent**: Assert every branch, including the two the endpoint cannot reach, over fabricated
inputs — the property that makes the extraction worth anything.

**Contract**: One case per row of the taxonomy table in Current State Analysis (a, b1, b2, b3, c,
d, d', e, f1, f2), each asserting the classification **and** the resulting message. Plus:

- `null` and `undefined` inputs.
- An `AuthApiError` carrying an **unknown** `code` → `no-session` (the safe default), with a
  comment naming why.
- A value matching nothing at all (`{}`, and one carrying arbitrary fields) → `no-session`, by the
  same default rule and asserted **in that direction**. The classifier is total, but it is not the
  route a thrown value takes: Phase 2's `catch` answers `unavailable` without calling it, so no row
  here asserts `{}` → `unavailable`. Comment the division of labour at the case, or the next reader
  will read this row as the bug.
- A **positive control over the whole set**: the function returns at least two distinct
  classifications and every non-null message is an `AUTH_MESSAGES` member by **equality** — without
  which a classifier returning one constant satisfies half the file.
- A **distinctness** case: the two failure messages are not the same string, so a collapse to one
  message is caught (the `signout-outcome.test.ts` precedent).

Every input is **fabricated**. Nothing here imports auth-js or constructs a real error.

### Success Criteria:

#### Automated Verification:

- `npx vitest run tests/lib/auth-outcome.test.ts` passes, and its case count is recorded **from
  the run**, not from counting `it(`
- `npm run typecheck` exits 0
- `npm run lint` exits 0, with the standing 3 `no-console` warnings in
  `evals/generation-quality.eval.ts` unchanged
- `npx vitest run tests/middleware.test.ts` still reports **23 passed** — nothing is wired yet, so
  a change here means something leaked

#### Manual Verification:

- The module header argues all three points (module-not-branches, not-`authErrorMessage`,
  `name`/`code`-not-`status`) and a reader who has not read this plan can follow them

---

## Phase 2: Middleware wiring

### Overview

Read the error, catch the throw, and answer the two new representations — without touching
`locals.user`, the `/` rule, or the signed-out branches.

### Changes Required:

#### 1. The guard

**File**: `src/middleware.ts`

**Intent**: Replace the discarding destructure with an observation of all three results
(`user`, `error`, and a throw), classify a null-user result, and give the outage its own response
on each branch. The signed-out path must come out byte-identical in behaviour.

**Contract**:

- The `getUser()` call moves inside a `try`/`catch`. A thrown value maps onto `unavailable` — the
  same "a throw and a returned error are the same outcome" collapse `signout-outcome.ts:58-61`
  argues one route over, and it closes a live uncaught-500-on-every-request hole (D-03).
  **The `catch` constructs `{ kind: "unavailable" }` DIRECTLY and must not call
  `classifyAuthError`.** The classifier's `default` falls to `no-session` on purpose (Phase 1 §1),
  and a thrown value is the one input for which that direction is wrong — so routing the throw
  through it would force two opposite defaults into one arm. Same division of labour as
  `signout.ts:62`, which reads a thrown value into an outcome rather than classifying it.
- `context.locals.user` is assigned exactly as today: the `User` when there is one, `null`
  otherwise. **No new field, no widened union** (D-04).
- The outcome is held in a local, not on `locals`.
- **The landing is consumed as `const { message } = authGuardLanding(outcome);` — the shape is
  load-bearing, not style.** `decisionBoundNames` (`form-endpoint-guards.test.ts:526`) binds names
  only from the literal pattern `const {…} = <fn>(`, so a value held as an object and read as
  `landing.message` is bound by nothing; `rejection` then refuses it at the identifier test
  (`:548`), which sits **before** the exemption is consulted **by design** — its own comment says
  the grant "can only ever vouch for a bare name, never for a member access off the same binding".
  `signout.ts:89` is the shape to copy verbatim.
- Inside `PROTECTED_ROUTES.some(...)` → `if (!context.locals.user)`, the existing branch splits:
  - **`unavailable` / `unconfigured` + `wantsJson`** → `503`, body `{ error: <message> }`, headers
    `Content-Type: application/json` and `Vary: VARY_ON_CALLER`. No `retriable`, no `Retry-After`
    (D-09).
  - **`unavailable` / `unconfigured` + document** → ``context.redirect(`/auth/signin?error=${encodeURIComponent(message)}`)``,
    then `Vary` set on the response as the existing branch does.
    Assembled **in this file**, not returned finished by the helper — `form-endpoint-guards`'s
    sweeps are textual, so a URL built inside the module would leave this file carrying no
    `error=` text for the guard to inspect (the `signout.ts:138-142` precedent, and the reason
    Phase 3 works at all).
    **A template literal, on ONE line, and neither half of that is style.** Phase 3's guard reads
    this line with two patterns and a concatenation fails both: `ERROR_INTERPOLATION`
    (`form-endpoint-guards.test.ts:177`) is `/error=\$\{([^}]*)\}/g`, so
    `"…?error=" + encodeURIComponent(msg)` contributes **zero** emissions and the sweep inspects
    nothing; and `INLINE_ERROR_LITERAL` (`:172`) carries a second alternative matching `?error=`
    followed immediately by a quote character — double, single or backtick — which the closing
    quote in `?error="` **matches**, turning `:372` red on a correct line. One
    line, because `:660`'s recorded limitation is that a call Prettier wraps (printWidth 120)
    matches nothing and is never inspected: not rejected, unexamined.
  - **`no-session`** → today's `401` and bare `302`, unchanged.
- The `null`-client condition (`!supabase`) takes the **`unconfigured`** outcome — its own variant,
  not `unavailable`, because it lands `AUTH_UNAVAILABLE_MESSAGE` rather than `AUTH_NETWORK_MESSAGE`
  (D-06) — and is constructed in the `else` arm at `middleware.ts:51-53` without passing through
  `classifyAuthError`. Both non-`no-session` outcomes answer through the **same** two
  representations (503 / `?error=` redirect); only the message differs. This is a **deliberate
  widening** past the audit's five hits, and the plan says so rather than inheriting it (D-02).

### Success Criteria:

#### Automated Verification:

- `npx vitest run tests/middleware.test.ts` reports **23 passed**, with **no row edited** — the
  regression proof
- `npx vitest run tests/lib/http.test.ts` passes unchanged
- `npm test` green; the total is recorded **from the run**
- `npm run typecheck` exits 0
- `npm run lint` exits 0
- `npm run build` exits 0

#### Manual Verification:

- `git diff tests/middleware.test.ts` is **empty** — if that file needed an edit, the signed-out
  path was not preserved
- The new branch is inside both existing conditions, confirmed by reading the diff

---

## Phase 3: Guard registration

### Overview

The middleware becomes a new `?error=` producer on a file that no guard in this repo inspects.
Register it, and re-measure the floors that registration moves.

### Changes Required:

#### 1. The third surface

**File**: `tests/lib/form-endpoint-guards.test.ts`

**Intent**: Bring `src/middleware.ts` inside the `?error=` sweeps, so a future edit cannot put an
unvouched string into that channel. Leaving it unregistered re-opens the exact blind-spot class
C10X-51 closed one level down.

**Contract**: A third `ERROR_PARAM_SURFACES` entry — `paths: [MIDDLEWARE_FILE]`,
`vouchingModule: "@/lib/auth-errors"`, `decisionModule: "@/lib/auth-outcome"`, and
`decisionFunctions` naming **only** the landing function, never the module wholesale (the C10X-51
impl-review F1 narrowing: the grant must equal what backs it).

Four floor assertions move and **each must be re-measured by running, never scaled by
arithmetic** — this project's own rule, and the reason C10X-51 re-measured rather than adding one:

| Site   | Assertion          |
| ------ | ------------------ |
| `:349` | `scanned.length`   |
| `:391` | `producers.length` |
| `:662` | `total` emissions  |
| `:663` | `perFile.length`   |

**Two NAMED pins ship with the row, and they are what makes the registration mean anything.** All
four floors below are `toBeGreaterThanOrEqual` and are **already satisfied** by the existing
8 / 7 / 30 / 7 — so a middleware emission the walker cannot see (F1's shape, a Prettier-wrapped
call, a later refactor) leaves every floor green while the sweep inspects **zero** lines in the
file it was added for. That is verbatim the "an empty sweep is green" failure this file's own
header states at `:340-347`, and it is why both existing surfaces carry a named pin rather than
relying on the floors. Add the two analogous ones:

- `expect(scanned.map(({ file }) => file)).toContain(MIDDLEWARE_FILE)` beside `:354`'s
  `toContain(SIGNOUT_ROUTE)` — the surface resolves.
- `expect(emissionCount(MIDDLEWARE_FILE)).toBeGreaterThan(0)` beside `:666-668`'s two per-file
  pins — the emission is inside the walker's reach. This is the one that would have caught F1, and
  it is a standing guard where B5 is a one-off run.

Two consequences to handle rather than discover:

- `label()` and `unresolvedSurfacePaths()` compute paths `relative(API_DIR, …)`, so a file outside
  `src/pages/api/` reports as `../../middleware.ts`. Either root the label per surface or accept
  and comment it; do not leave a reader guessing whether the path is a bug.
- The "exactly six `formData()` readers" count (`:262-278`) walks `API_DIR` and **not** the
  surface table — verified during planning — so it is unaffected. State that at the site, because
  a reader seeing a new surface will reasonably fear that hard count.

### Success Criteria:

#### Automated Verification:

- `npx vitest run tests/lib/form-endpoint-guards.test.ts` passes with all four floors at their
  newly **measured** values, **and both named pins on `MIDDLEWARE_FILE` present and passing**
- The `finds exactly the six known formData() readers` case still passes with `toHaveLength(6)`
  and an unchanged file list
- `npx vitest run tests/lib/sentry-capture-wiring.test.ts` passes **with no edit to that file** —
  its `:414` control still finds `middleware.ts` in the unregistered list
- `npx vitest run tests/lib/error-param-guard.test.ts` passes unchanged
- `npm test` green

#### Manual Verification:

- `git diff tests/lib/sentry-capture-wiring.test.ts` is **empty**
- Each moved floor's comment records the value and the date it was measured

---

## Phase 4: Falsification

### Overview

Every new assertion is shown able to go red for the right reason. Record the observed failure
string and the split **with its denominator**; restore; verify the restore by hash.

### Changes Required:

#### 1. Breakage runs

**File**: `context/changes/bug-middleware-getuser-swallowed/verification.md` (new)

**Intent**: Produce the evidence, and record predictions against observations rather than rounding
one to the other.

**Contract**: At minimum:

| #   | Neuter                                                         | What it must separate                                                                              |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| B1  | Classifier's `unavailable` arm returns `no-session`            | The truth table observes the split, not an incidental default                                      |
| B2  | Classifier maps `AuthSessionMissingError` to **`unavailable`** | The naive-`if (error)` regression, caught — and caught at the layer that actually rides that class |
| B3  | Classifier's `default` arm flipped to `unavailable`            | The safe-default case is real (truth table only — see below)                                       |
| B4  | The landing function **removed from `decisionFunctions`**      | The surface row's exemption is load-bearing rather than decorative                                 |
| B5  | Emit a bare literal into `?error=` from the middleware         | Phase 3's registration actually inspects this file — the claim the whole phase rests on            |

**B2 is the load-bearing one and its prediction is specific.** It is a neuter on the
`AuthSessionMissingError` arm and **not** on the `default` arm, because that class is matched
explicitly by `name` (Phase 1 §1) and never falls through — a `default` flip leaves every
`middleware.test.ts` row green and would prove nothing about this file. Predicted red, by row:
both `it.each(PROTECTED_ROUTES)` blocks (7 + 7), the form-POST row (`:110`), the same-deck JSON row
(`:118`) and the body-less fetch row (`:130`) — **≈ 17 of 23**. Predicted **green**, and that green
is the attribution rather than a leftover: the `Vary` row (`:142`, which asserts the header on both
new representations too) and the three public-path rows (`:162`, unprotected, never reaching the
branch). Record the number observed; if it diverges, record it **as observed**.

**Three rows carry a caveat the plan states rather than lets a runner discover.**

- **B3 reddens `tests/lib/auth-outcome.test.ts` ONLY.** Under Phase 1 §1 the default arm is reached
  by an unknown `code` and by a shapeless value — neither of which any `middleware.test.ts` row
  produces — so a middleware-side red here would mean the arms are wired wrongly, not that the
  neuter worked. Denominator is the truth table's own.
- **B4 must neuter `decisionFunctions`, not `vouchingModule`.** The middleware imports nothing from
  `@/lib/auth-errors` under this plan, so `ownedNames()` is empty either way and the vocabulary
  check at `:681` resolves `decisionModule ?? vouchingModule` — a wrong `vouchingModule` changes
  nothing and comes back green. Dropping the landing name empties `decisionBound`, and
  `rejectionsIn` must redden naming the line and the reason
  (`` `message` is neither imported from the closed set nor declared here ``).
- **The 503's STATUS is observed by nothing automated**, by the same structural absence of a seam
  Phase 2 records — so "return 401 instead" is not a Phase 4 criterion at all. It moves into
  **Phase 5** as a second variable of the dead-port run, where `http.ts:52-53` turns it back into
  "Twoja sesja wygasła" and the regression is visible. Stated here so the Phase 4 table is not read
  as covering it.

**Check what each neuter does to the harness before reading its colour** (test-plan §6.11). A
neuter that prevents the run from starting proves nothing.

### Success Criteria:

#### Automated Verification:

- Each of B1-B5 run, its observed failure string and red/green split recorded with the file's own
  denominator
- After every restore: `git diff -- src/ tests/` empty, and each edited file `md5sum`-verified
  against a pristine copy taken before the first edit
- `npm test` green after the last restore, with the total recorded from the run

#### Manual Verification:

- Any prediction that did not survive contact is recorded **as observed**, not rounded to the
  prediction

---

## Phase 5: Manual before/after

### Overview

Both failure branches are unreachable from Vitest, so one manual run owns the endpoint's use of
the classifier. Nothing bridges this and the suite, and no test in this project can.

### Changes Required:

#### 1. The recorded run

**File**: `context/changes/bug-middleware-getuser-swallowed/verification.md`

**Intent**: Prove the fix on the path the suite cannot reach, as a **pair on one machine** — the
archived C10X-51 observation proves the bug and cannot prove the fix.

**Contract**: With a live session cookie and `SUPABASE_URL` pointed at a **dead local port**:

1. **Before** (fix stashed): `GET /decks` → `302 → /auth/signin` with **no** `?error=` — today's
   defect, reproducing `context/archive/2026-08-13-bug-signout-swallowed/verification.md:448`.
2. **After**: the same request → `302 → /auth/signin?error=<AUTH_NETWORK_MESSAGE>`, and the
   sign-in page renders that banner.
3. **JSON caller**, same conditions: `503` with the outage body, and the identical `Vary`.
4. **One-variable control**: port restored, everything else identical → the ordinary signed-in
   `200`, no banner.
5. **Anonymous control**: no cookie, healthy stack → bare `302 → /auth/signin`, **no** `?error=`.
   This is the case a naive fix breaks, and it is the one worth having in writing.
6. **The status choice, observed rather than assumed** (moved here from Phase 4, where nothing can
   see it): with the port still dead, change the JSON branch's `503` to `401`, re-issue row 3, and
   record what the island receives — `http.ts:52-53` overrides **any** 401's body, so the outage
   copy is replaced by "Twoja sesja wygasła", i.e. the original defect restored through a different
   door. Restore the `503` and re-run row 3. This is the only place in the change where D-07 is
   falsifiable at all.

The provoked class is `AuthRetryableFetchError` (status 0). **Classes 500 and 429 are not
provoked** and are covered by the truth table alone — state that rather than implying the run
covers them.

**Restore by byte copy, and verify by hash.** C10X-51 recorded a `.env` restore that _read_
correct and _hashed_ wrong, because a regex `.` consumed the `\r` in a CRLF file
(`verification.md:575-580`). Do not repeat it.

### Success Criteria:

#### Automated Verification:

- `npm test` green after the `.env` restore
- `.env` `md5sum` identical to the pristine copy taken before the run
- `git status --porcelain -uall` shows nothing outside the change folder

#### Manual Verification:

- All six rows above observed and recorded, each with its raw status and `Location` / body — row 6
  including the restore, `md5sum`-verified like every other
- The banner confirmed rendered on `/auth/signin`, scoped past the trap that this app renders a
  **second** `[role="alert"]` (the config banner) — an unscoped `querySelector` reads the wrong node

---

## Phase 6: Doc sync

### Overview

Record what shipped, what it does **not** prove, and close the ticket's bookkeeping.

### Changes Required:

#### 1. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Add the §6.6 entry and the §8 ledger bullet, in this project's established shape: a
claims table, a does-NOT-prove list of equal length, and suite figures measured by running with
their per-file breakdown.

**Contract**: The entry must state, at minimum:

- **No §2 risk row moves and no §3 phase status changes.** This closes the audit's fifth and last
  hit; the class is now closed on the read side as well as the write side.
- The header block's C10X-51 correction chain gains its final link: that entry's "still live as
  **C10X-52**" clause is now closed, and is **corrected rather than rewritten** (this project's
  live-declaration-versus-dated-snapshot rule).
- **What it does not prove**: no Sentry channel exists for this failure, by decision (D-01) — the
  500/429/`bad_jwt` classes reach no owner at all; classes 500 and 429 were never provoked; the
  `/` and `Topbar` symptom survives; and `tests/middleware.test.ts` gained **no** case for the new
  branch, so the 23 are a regression proof and not coverage of the fix.

#### 2. Roadmap and change identity

**Files**: `context/foundation/roadmap.md`, `context/changes/bug-middleware-getuser-swallowed/change.md`

**Intent**: Give `/10x-archive` a row to close, and stamp the change.

**Contract**: A new roadmap row at `Status: in progress`, created during implementation rather
than backfilled — the omission that produced the H-04/H-07/H-08 backfills. **Do not flip it to
`done` and do not add a `## Done` entry**: `lessons.md` reserves both for `/10x-archive`, and a
plan instructing the flip is to be treated as a defect. `change.md` moves to `status: implemented`
with `updated:` stamped.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck`, `npm run lint`, `npm run build` all exit 0
- `npm test` green, total recorded from the run with its per-file breakdown
- `npx prettier --check` clean on every edited markdown file — and run it on a **copy** first
  (test-plan §6.6's C10X-43 entry: a code span split across a line break inside a blockquote loses
  its `> ` marker on `--write`)

#### Manual Verification:

- The §6.6 does-NOT-prove list is as long as the claims table
- No roadmap Status flipped to `done`

---

## Testing Strategy

### Unit Tests

- `tests/lib/auth-outcome.test.ts` — the full taxonomy, both failure branches, the safe default,
  the whole-set positive control, and the distinctness case.

### Integration Tests

- None new, and that is structural rather than an omission. `tests/middleware.test.ts` drives the
  real `createClient` and the real `getUser`, so the outage and null-client branches have **no
  seam** there. Its 23 cases serve as the regression proof that the signed-out path is untouched.

### Manual Testing Steps

Phase 5, in full. It is the only evidence covering the wiring.

## Performance Considerations

None added. The fix reads a value that was already computed; `getUser()` remains one round trip per
**authenticated** request (an anonymous one short-circuits at `GoTrueClient.js:2496` with no
network). The middleware still has no timeout and no circuit breaker — unchanged, and out of scope.

## Migration Notes

None. No schema change, no migration file, nothing pushed to the cloud.

## Open Risks & Assumptions

- **The `code` allow-list is inference for the codes this stack cannot produce.** Same class as
  `auth-errors.ts`'s reachability record, and the mitigation is the same: check each string against
  the `ErrorCode` union in `node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts` at
  **2.105.3**, and name the artifact rather than trusting prose.
- **One GoTrue version, one stack.** Whether hosted GoTrue ever answers 401 where the local build
  answers 403 is unestablished — which is exactly why the split keys on `name`/`code` and not on
  `status`.
- **The `default` arm's direction is a bet.** It falls to `no-session`, so an unrecognised code
  during a real outage still shows the old misleading message. Chosen because the opposite failure
  — bannering an ordinary signed-out visitor — is the defect this ticket exists to remove.
- **Sentry delivery remains unproven**, unchanged by this ticket, and this ticket adds no capture
  site. Owner:
  `context/archive/2026-08-13-bug-generation-failed-audit-swallowed/follow-ups/sentry-delivery.md`.
- **One throwaway auth user** (`c10x52-probe-<epoch>@example.com`) already exists in the local dev
  DB from research; consistent with the accumulation test-plan §6.6 records.

## References

- Research: `context/changes/bug-middleware-getuser-swallowed/research.md`
- Direct sibling and template: `context/archive/2026-08-13-bug-signout-swallowed/` —
  `plan.md:129-138` carves this ticket out; `verification.md:448` and `:474-479` record **this
  defect firing live**; `:575-580` the CRLF restore trap
- The extraction template: `src/lib/signout-outcome.ts:14-49`
- The mapper this classifier must be argued as distinct from: `src/lib/auth-errors.ts:224-266`
- The pre-written warning against a capture here: `src/lib/sentry-sampling.ts:14-19`
- The audit register: `context/archive/2026-08-11-sentry-monitoring/research.md:236-242`

## Decisions

| #    | Decision               | Choice                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | Sentry capture         | **None**                                                                  | Sits on every request; unsampled by construction and self-masking on quota. The transport class already reaches Sentry via auth-js's own `console.error`, thinned to ~10%. Deliberate break from the four siblings' two-channel pattern, argued not inherited.                                                                                                                                          |
| D-02 | `null`-client branch   | **In scope**                                                              | Requester-confirmed at research time; the audit held it outside the five, so this is a stated widening. `AUTH_UNAVAILABLE_MESSAGE` already exists for it.                                                                                                                                                                                                                                               |
| D-03 | Thrown non-`AuthError` | **In scope, one `try`/`catch`; the `catch` maps to `unavailable` itself** | Currently an uncaught 500 on every request, owned by no ticket. Same throw-and-return collapse C10X-51 argued. The mapping stays in the `catch` rather than in `classifyAuthError` because the classifier's `default` must fall to `no-session` (Phase 1 §1) and a throw is the one input where that is wrong — two opposite defaults in one arm is how this ticket's own defect gets shipped inverted. |
| D-04 | `App.Locals`           | **Unchanged**                                                             | Avoids 17 consumers and 5 test casts, and kills the `Layout.astro:15` disclosure hazard outright. Cost: `/` and `Topbar` still read as guest during an outage.                                                                                                                                                                                                                                          |
| D-05 | Classifier input       | **Structural `AuthErrorLike`**                                            | Measured: the auth-js guards are duck-typed on the same `name` string, so they buy only a marker check while coupling fixtures to the private `__isAuthError`. Matches the sibling mapper.                                                                                                                                                                                                              |
| D-06 | Copy                   | **Reuse `AUTH_NETWORK_MESSAGE` / `AUTH_UNAVAILABLE_MESSAGE`**             | Both already exist, already mean this, already `AUTH_MESSAGES` members — vouched free, no new render site, no adjacency hazard, and consistent with `/api/auth/signin` in the same outage.                                                                                                                                                                                                              |
| D-07 | JSON branch            | **`503`, not a changed `http.ts`**                                        | `http.ts:52-53` overrides any 401's body; the 500 fall-through is already pinned green, and three of four islands surface the new body for free.                                                                                                                                                                                                                                                        |
| D-08 | `?error=` guard        | **Register a third surface**                                              | The file has no catch-all, so the producer would be inspected by nothing. Proportionate; a repo-wide catch-all is a bigger ticket.                                                                                                                                                                                                                                                                      |
| D-09 | 503 body shape         | **`{ error }` only**                                                      | C10X-48 D-08 (measured) makes an absent `retriable` mean retriable, which is correct for a transient outage. `Retry-After` would be an invented value nothing reads.                                                                                                                                                                                                                                    |
| D-10 | Evidence               | **Fresh before/after pair**                                               | The archive proves the bug and cannot prove the fix; only a pair on one machine attributes the change.                                                                                                                                                                                                                                                                                                  |

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The classifier

#### Automated

- [x] 1.1 `tests/lib/auth-outcome.test.ts` passes; case count recorded from the run — 889042d
- [x] 1.2 `npm run typecheck` exits 0 — 889042d
- [x] 1.3 `npm run lint` exits 0, 3 standing `no-console` warnings unchanged — 889042d
- [x] 1.4 `tests/middleware.test.ts` still 23 passed — 889042d

#### Manual

- [x] 1.5 Module header argues module-not-branches, not-`authErrorMessage`, `name`/`code`-not-`status` — 889042d

### Phase 2: Middleware wiring

#### Automated

- [x] 2.1 `tests/middleware.test.ts` 23 passed, no row edited — 9c38382
- [x] 2.2 `tests/lib/http.test.ts` passes unchanged — 9c38382
- [x] 2.3 `npm test` green, total recorded from the run — 9c38382
- [x] 2.4 `npm run typecheck` exits 0 — 9c38382
- [x] 2.5 `npm run lint` exits 0 — 9c38382
- [x] 2.6 `npm run build` exits 0 — 9c38382

#### Manual

- [x] 2.7 `git diff tests/middleware.test.ts` empty — 9c38382
- [x] 2.8 New branch confirmed inside both existing conditions — 9c38382

### Phase 3: Guard registration

#### Automated

- [x] 3.1 `form-endpoint-guards.test.ts` passes with all four floors re-measured and both `MIDDLEWARE_FILE` pins present — f380799
- [x] 3.2 The six-`formData()`-readers case unchanged — f380799
- [x] 3.3 `sentry-capture-wiring.test.ts` passes with no edit — f380799
- [x] 3.4 `error-param-guard.test.ts` passes unchanged — f380799
- [x] 3.5 `npm test` green — f380799

#### Manual

- [x] 3.6 `git diff tests/lib/sentry-capture-wiring.test.ts` empty — f380799
- [x] 3.7 Each moved floor comments its measured value and date — f380799

### Phase 4: Falsification

#### Automated

- [x] 4.1 B1-B5 run, each with observed failure string and split with denominator — 8fb99d4
- [x] 4.2 After every restore: `git diff -- src/ tests/` empty, each file `md5sum`-verified — 8fb99d4
- [x] 4.3 `npm test` green after the last restore — 8fb99d4

#### Manual

- [x] 4.4 Any prediction that did not survive contact recorded as observed — 8fb99d4

### Phase 5: Manual before/after

#### Automated

- [x] 5.1 `npm test` green after the `.env` restore — ebcba85
- [x] 5.2 `.env` `md5sum` identical to the pristine copy — ebcba85
- [x] 5.3 `git status --porcelain -uall` clean outside the change folder — ebcba85

#### Manual

- [x] 5.4 All six rows observed and recorded with raw status and `Location` / body — ebcba85
- [x] 5.5 Banner confirmed rendered, scoped past the second `[role="alert"]` — ebcba85

### Phase 6: Doc sync

#### Automated

- [x] 6.1 `npm run typecheck`, `npm run lint`, `npm run build` all exit 0 — f53ca5c
- [x] 6.2 `npm test` green, total with per-file breakdown from the run — f53ca5c
- [x] 6.3 `prettier --check` clean on every edited markdown file — f53ca5c

#### Manual

- [x] 6.4 §6.6 does-NOT-prove list as long as the claims table — f53ca5c
- [x] 6.5 No roadmap Status flipped to `done` — f53ca5c
