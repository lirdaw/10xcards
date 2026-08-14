# Signout stops presenting a failed signOut as success — Implementation Plan

## Overview

`src/pages/api/auth/signout.ts` discards the `{ error }` from `supabase.auth.signOut()` and
redirects to `/` unconditionally; when `createClient` returns `null` it redirects having done
nothing at all. Both swallow points present a failure as success.

This is hit **#4** of the 2026-08-11 swallowed-errors audit and the last discarded-result Supabase
mutation in `src/` after C10X-48/49/50 closed the `generate.ts` class. It differs from all three
siblings in one decisive way: **a returned error means the user is still signed in.** Where the
siblings lost an audit record, this one leaves a live session behind a screen that says goodbye.

The fix gives the route three explicit branches, lands **both** failure branches on `/auth/signin`
(the one page that can carry a message whatever GoTrue's state), reports the failure on two
channels, and closes the two guard blind spots that this change itself makes load-bearing.

## Current State Analysis

The route in full, ten lines:

```ts
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    await supabase.auth.signOut();
  }
  return context.redirect("/");
};
```

- **Swallow A** (`:7`) — `await` with no destructuring.
- **Swallow B** (`:6-8`) — an `if` with no `else`. Both sibling auth routes answer the same `null`
  condition as a user-visible refusal (`signin.ts:35-37`, `signup.ts:25-28`); sign-out is the only
  auth route that treats it as success.

**What a returned error means, verified in the installed `@supabase/auth-js` 2.105.3.** Both
`return { error }` statements in `_signOut` (`GoTrueClient.js:3184`, `:3195`) sit **above**
`_removeSession()` at `:3200`, which is the only call that clears the cookie. On the dominant
failure path nothing is revoked and nothing is cleared. Research §2.2 tabulates the classes: every
transport failure, 500 and 429 leaves the user signed in, while 401/403/404 and
`AuthSessionMissingError` are allow-listed as success and come back `{ error: null }`.

**The observable symptom is a silent round trip, not a stale landing page.** `src/middleware.ts:55-58`
bounces an authenticated visitor from `/` to `/decks`, so the user clicks "Wyloguj", is thrown back
into the app with their own e-mail in the header, and nothing on any channel says why.

**Two facts a plain `if (error)` would miss.** `signOut()` can also **throw** —
`_notifyAllSubscribers` rethrows a callback error (`GoTrueClient.js:3964`) and neither `_signOut`
nor `signOut` has a `catch`, so a throw from this project's own `cookies.set` propagates. And the
ordinary already-signed-out case is safe (`GoTrueClient.js:2343`, plus the explicit
`AuthSessionMissingError` exclusion at `:3183`), so a plain `if (error)` produces no spurious
banner.

**There is nothing to break and nothing that would catch a regression.** One grep over all of
`tests/` returns a single hit for sign-out, and it is `tests/e2e/setup/auth.setup.ts:136` asserting
the "Wyloguj" button _exists_. No test drives this route.

### Key Discoveries

- **`/` cannot carry a message and a guard forbids teaching it to.** `src/pages/index.astro` reads
  no request state, and `tests/lib/error-param-guard.test.ts:242-297` scans all of `src/` for
  `?error=` reads outside two registered surfaces — naming `pages/index.astro` in its own positive
  control at `:259-267`.
- **`/decks` cannot carry the message either, and the reason is the same guard that was mistaken for
  an oracle** (plan-review F1, 2026-08-14; measured). `middleware.ts:46-53` sets `locals.user` from
  `supabase.auth.getUser()` — a real round trip to GoTrue on _every_ request. The top two rows of
  research §2.2 (`fetch` rejects at status 0; 502/503/504) are exactly "GoTrue is unreachable", so
  on the very next hop the middleware's own `getUser()` fails for the same reason, `locals.user`
  becomes `null`, `/decks` matches `PROTECTED_ROUTES` (`middleware.ts:9`), and the user is bounced
  to `/auth/signin` **with the parameter dropped**. In the class this plan itself calls dominant the
  banner would therefore never render, and the user would see the sign-in page with no message over
  a live session — the original defect wearing a different landing page. Research saw the mechanism
  and applied it only to the `null`-client branch (`research.md:502`); it applies identically here.
- **`/auth/signin` is the one page that cannot be bounced.** No `/auth/*` path is in
  `PROTECTED_ROUTES` and the `/` → `/decks` rule needs a user, so the page renders whatever GoTrue's
  state. It already reads and vouches at `signin.astro:7`
  (`ownedAuthMessage(Astro.url.searchParams.get("error"))`) into a **page-level** `ServerError`, so
  the message needs no new render site — unlike `/decks`, where `decks/index.astro:39` passes
  `serverError` only into `<CreateDeckModal defaultOpen={openCreate} …>` and `?error=X` alone shows
  nothing.
- **The §2.4 false-alarm class is therefore NOT neutralised by the landing page** and is accepted
  instead. Where `_callRefreshToken` clears the cookie _and_ propagates the error, the sign-out
  effectively succeeded and the user still reads "you are still signed in" on the sign-in page. That
  is a wrong message on a page they are already on, in a class research calls narrow — strictly
  better than the dominant class silently lying, which is what `/decks` would have bought. No
  `isAuthRetryableFetchError` discrimination is added; if it is ever wanted, that is the branch to
  add it on.
- **`form-endpoint-guards.test.ts` is narrower than its own comment claims.** Its SCOPE comment says
  `src/pages/api/` "is the whole population", but the two `?error=` describes are rooted at
  `DECKS_API_DIR` (`:221`, `:302` — verified directly). So `signout.ts` could emit any invented
  literal with the whole suite green.
- **`ownedNames` keys on the import from `@/lib/redirect-errors`** (`form-endpoint-guards.test.ts:307`),
  which is why widening the root is not a one-constant change — see Phase 3.
- **The Sentry sampling warning does not apply to a direct capture.** `sampleSentryEvent` opens with
  `if (event.logger !== "console") return event` (`sentry-sampling.ts:88`), and a direct
  `Sentry.captureException` carries no console stamp. Research §7's caution that a message naming
  `@supabase/ssr` could be 90%-dropped is true only for console-integration events; the next
  sentence of the same section says so correctly. Recorded rather than propagated.
- **`signOut()`'s default scope is `global`** (`GoTrueClient.js:3173`), so a _successful_ sign-out
  revokes every session for that user on every device. `tests/fixtures/accounts.ts` provisions
  accounts A and B **once per run** and shares them across files that run in parallel — so a
  success-path test signing out account A would invalidate A everywhere at once. See Phase 2.

## Desired End State

`POST /api/auth/signout` has three branches and no silent path:

| Condition                               | Response                                              | Channel                                |
| --------------------------------------- | ----------------------------------------------------- | -------------------------------------- |
| `createClient` returns `null`           | `302 → /auth/signin?error=<AUTH_UNAVAILABLE_MESSAGE>` | banner (page already vouches)          |
| `signOut()` returns an error, or throws | `302 → /auth/signin?error=<SIGNOUT_FAILED_MESSAGE>`   | banner + one `Sentry.captureException` |
| `signOut()` succeeds                    | `302 → /` (unchanged)                                 | —                                      |

Both failure branches land on the same page, which is the shape `signin.ts` and `signup.ts` already
have and the reason no page gains a new render site.

Verify by: `npm test` green with a new truth table covering every outcome; `npm run e2e` unaffected;
one recorded manual run showing the failure branch reached in a running app with the banner rendered
and the session provably still alive; and each new guard shown red under a deliberate breakage.

## What We're NOT Doing

- **No local remedy.** The route reports; it does not force the session closed. `scope: "local"`
  still performs the network call (the `admin.signOut(accessToken, scope)` call at
  `GoTrueClient.js:3188` runs for every scope), and clearing the cookie by hand would require the
  internal `sb-<host>-auth-token` name and its chunking — precisely what `lessons.md` forbids
  depending on. Same shape as C10X-49's "detection, not deletion". (D-04)
- **C10X-52 stays out** (`middleware.ts:47-50`, `getUser()`'s error read as "not signed in"). It is
  the read-side twin of Swallow B and both make "unconfigured" look like "signed out", but folding
  it in would repeat the pattern C10X-50 explicitly refused when it carved _this_ ticket out. (D-08)
  **Read this together with the landing-page choice, because the two were entangled and are now
  not** (plan-review F1, 2026-08-14). Under the original `/decks` landing, C10X-52 was not an
  unrelated twin at all — it was the mechanism that ate this change's only user-facing channel in
  the dominant failure class, i.e. a de-facto prerequisite that the exclusion hid. Landing on
  `/auth/signin` removes the dependency rather than the defect: the message now renders whether or
  not the middleware can reach GoTrue, so C10X-52 goes back to being what this bullet says it is —
  a separate read-side defect, still live, still C10X-52's.
- **No change to the three sign-out triggers' inconsistent accessible names** ("Wyloguj" ×1, "Sign
  out" ×2 — `AuthenticatedLayout.astro:25`, `Topbar.astro:16`, `dashboard.astro:17`), and no verdict
  on whether `dashboard.astro` is dead weight. Recorded as a follow-up note only. (D-14)
- **No new island, no `retriable` flag.** All three triggers are native form POSTs — zero `fetch`
  call sites — so the flag the three siblings shipped has no reader here. The landing page is the
  entire user-facing channel. (D-03)
- **No backfill of anything.** There is no lost record to reconstruct.

## Implementation Approach

The defect is two lines; the design is the landing page. Everything else follows from it.

Phases 1-2 fix the defect end to end and are independently shippable. Phases 3-4 close the two
guard blind spots that this change makes load-bearing — the new `?error=` producer under
`src/pages/api/auth/` and the first `Sentry.captureException` outside `generate.ts` — neither of
which is guarded by anything today. Phase 5 is evidence.

The decision itself is extracted into a pure function rather than left inline, because the failure
branch is **unreachable from this suite**: the runner drives a real local Supabase and nothing can
make GoTrue's `/logout` fail from inside it, while `§6.9` confines module doubles to one file and
admits them only for a claim unreachable otherwise — which this is not, once extracted. That is
the project's established answer to exactly this shape (`readJsonResponse` and `rateOutcome`,
C10X-27; `visibleConfigStatuses`, C10X-34). (D-05)

## Critical Implementation Details

**A successful sign-out revokes every session for that user — and that claim is UNMEASURED, which
matters because this plan leans on it in two opposite directions** (plan-review F4, 2026-08-14).
The default scope is `global` (`GoTrueClient.js:3173`) and the run's accounts are shared across
parallel files, from which this plan concludes that a success-path test must own its own account.
Phase 2 §3 then asks the same test to assert that "the same cookie no longer resolves a user". Those
are the same open question read both ways: Supabase's documented behaviour is that a global sign-out
revokes **refresh** tokens while the **access** token stays valid until it expires — under which the
assertion fails and the shared-account hazard does not exist at all. Under the opposite behaviour
both hold. Nothing in the plan or research measures it, and the two claims cannot both be safe.

**So Phase 2 opens with the measurement, not with the test.** A throwaway script against the local
stack: sign in, capture the cookie, `signOut({ scope: "global" })`, then call `getUser()` with the
old access token. Record the answer in `verification.md`; it picks the design:

- **Access token survives** → the shared-account hazard evaporates. Drop the third account, and
  replace the second assertion with one on the **staged clearing cookies** in the response, which is
  what the route actually controls. Note that this makes the hazard's absence a measured fact rather
  than an assumption, and it must be written down as such — the next reader will otherwise
  re-derive the scary version from `scope: "global"` alone.
- **Access token dies with the session** → keep the owned account, and budget what it actually costs:
  `provision()` is module-local, `provisionAccounts()` hardcodes labels `a`/`b` and returns exactly
  two, and `ProvidedContext` declares only `accountA`/`accountB`, so a third account is an edit to
  shared globalSetup (export `provision`, add a third `provide`, extend the type) rather than
  "following the existing path".

Either way the C10X-32 rule ("a positive control must OWN the fixture it mutates") is what governs;
what is unsettled is whether this test mutates a shared fixture at all.

**And the rate-limit budget is tighter than one extra account suggests.** `accounts.ts:10-15`
argues explicitly against per-file provisioning and records the current cost as **4 auth requests
per run — roughly 7 runs per 5 minutes** against a 30-sign-ins / 5-min / IP ceiling. A third account
takes that to 6 per run, and criterion 2.3 asks for three consecutive runs (18), alongside whatever
the e2e account spends. Within the limit, but not comfortably — which is the reason to settle the
measurement before paying for it.

**Ordering inside the route.** The `null` check comes first (it needs no client), then the
`try`/`catch` around `signOut()`, then the branch on the returned error. A throw and a returned
error must land on the same outcome — the user's state is identical in both.

**The report builder must not throw.** Same hard contract as `audit-failure-report.ts:136-144`: it
is called on the failure path, and a throw there would replace the intended redirect with an
uncaught framework 500 — strictly worse than the bug being fixed.

---

## Phase 1: The decision, the copy, and the closed set

### Overview

Extract the outcome→landing decision into a pure, exhaustively testable function; add the new
message to `REDIRECT_MESSAGES` and move its size pin; open the roadmap row. No route behaviour
changes in this phase.

### Changes Required:

#### 1. The new message

**File**: `src/lib/auth-errors.ts`

**Intent**: Add the one string a failed sign-out puts in `?error=`. It names the true state — the
user is still signed in — and gives a concrete way out, because this banner is the entire
observability surface for the failure (C10X-49 D-02). (D-01, D-02)

**Contract**: A new exported constant `SIGNOUT_FAILED_MESSAGE`, appended to the `AUTH_MESSAGES`
array — **not** to `REDIRECT_MESSAGES`, because the landing page is `/auth/signin`, which vouches
against `AUTH_MESSAGES` via `ownedAuthMessage` (`signin.astro:7`). `redirect-errors.ts` is not
touched by this change at all and `REDIRECT_MESSAGES` stays at eleven.

Polish copy naming: (a) that the sign-out did not go through and the session is still active,
(b) close the browser if this is a shared computer, (c) that signing in again and retrying is the
way to clear it. It must **not** say "retry with the Wyloguj button on this page" — the sign-in page
has no such button; that copy belonged to the `/decks` landing this plan no longer uses. This is
deliberately longer than most members — state that in a comment beside it, so a future tidier does
not shorten it back into "Nie udało się wylogować" and delete the only sentence that matters.

**The adjacency hazard, and it is the sharpest thing about this constant.** `auth-errors.ts:58`
already carries `AUTH_SESSION_MISSING_MESSAGE = "Twoja sesja wygasła. Zaloguj się ponownie."` — the
new member says the **opposite** ("the session is still active"), joins the **same** set, and renders
in the **same** banner on the **same** page. Two members of one closed set that contradict each other
is a copy hazard rather than a bug, and the mitigation is wording: the new message must be
unmistakable on its own, never a variation on the neighbouring one.

#### 2. The membership assertion

**File**: `tests/auth/errors.test.ts`

**Intent**: Pin the new constant into the closed set the sign-in page vouches against.

**Contract**: `AUTH_MESSAGES` carries **no exact size pin** — verified: the file asserts only
`AUTH_MESSAGES.length > 0` as a positive control (`:235`, `:332`) and iterates the whole set for
non-emptiness and distinctness. So there is no 11 → 12 speed bump to move here and
`tests/lib/redirect-errors.test.ts` is untouched. What is needed is a case asserting
`AUTH_MESSAGES` contains `SIGNOUT_FAILED_MESSAGE`, plus — because of the adjacency hazard above — one
asserting it is **not equal to** `AUTH_SESSION_MISSING_MESSAGE`, which the set's existing distinctness
sweep would catch only if that sweep is exact rather than pairwise; check which it is before relying
on it.

#### 3. The pure decision

**File**: `src/lib/signout-outcome.ts` (new)

**Intent**: Own the question "given what `signOut()` did, where does the user land and does an owner
get told?" — as a total function over a fabricated input, so every branch including the two the
runner cannot reach is asserted on every `npm test`.

**Contract**: A discriminated union describing the three outcomes (`unconfigured`, `failed` carrying
an auth-error-shaped cause, `signed-out`) and a function mapping it to `{ path, message, capture }`.
`path` is the landing path (`/auth/signin` on both failure branches, `/` on success); `message` is
the closed-set constant or `null`; `capture` is whether the Sentry channel fires (Phase 4 consumes
it, Phase 2 ignores it). Reuses `AUTH_UNAVAILABLE_MESSAGE`
verbatim for the `unconfigured` branch — byte-identical to `signin.ts:36` and `signup.ts:27`, no new
constant. (D-09)

Both failure branches now target `/auth/signin`, so this module imports from `@/lib/auth-errors`
only and never from `@/lib/redirect-errors` — one vouching set, one landing page.

**It returns the pair, never the finished URL** (plan-review F3, 2026-08-14). `?error=` is assembled
in `signout.ts` — one line, in the same shape as `signin.ts:36` — because Phase 3's sweeps are
TEXTUAL: a finished URL built here would leave `signout.ts` with no `error=` text, so
`emissionCount` would return 0 for it and the guard would be registered against a file carrying
nothing. The cost is stated rather than hidden: `encodeURIComponent` and the path concatenation are
two lines the truth table no longer covers, and the guard is what covers them instead.

Note the module boundary deviation from C10X-50, and why it is not one: that change split the report
into its own module because it took a database insert type, while both halves here take the same
auth-error-shaped cause. Phase 4 adds the report builder to _this_ module rather than a fourth one.

#### 4. The truth table

**File**: `tests/lib/signout-outcome.test.ts` (new)

**Intent**: Hold the decision as a truth table over fabricated outcomes, with a positive control, so
it cannot degrade into a function that sends everything to one place.

**Contract**: One case per outcome asserting the exact `path` and `message` pair; the false-alarm class (§2.4 —
error returned _and_ cookie already cleared) asserted to land on `/auth/signin` like any other
failure, with a comment recording that this class is **accepted, not neutralised** (the landing page
no longer re-verifies anything — see Key Discoveries); a case pinning that the emitted message is an
`AUTH_MESSAGES` member by **equality**; a case pinning that the two failure branches emit _different_
messages while sharing a path, so a collapse to one message is caught; and the control — the three
outcomes produce three _different_ `(path, message)` pairs, without which a constant function
satisfies every case above.

#### 5. The roadmap row

**File**: `context/foundation/roadmap.md`

**Intent**: Open the row in Phase 1 rather than at doc-sync, the C10X-49 D-08 / C10X-50 D-10 timing.
Without it `/10x-archive` has nothing to close and the change vanishes from the roadmap — a mechanism
that has fired four times in this project (H-04, H-07, H-08, H-13). (D-12)

**Contract**: **H-19** — the next id after H-18. Three edits following H-18's own shape exactly: the
summary table row (`:72`), the detail block (`### H-19: …`, sibling of `:446`), and the Done-list
bullet (sibling of `:521`). `Status: in progress`.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Full suite green: `npm test`
- The new truth table's control fails when the decision is collapsed to a single location

#### Manual Verification:

- The new copy reads as Polish a user would act on — it names the live session and both exits
- H-19's three roadmap edits match H-18's field order and formatting

---

## Phase 2: The route and the banner

### Overview

Three explicit branches in the route, and a page-level banner on the page they land on. **The defect
is fixed at the end of this phase**; Phases 3-4 are hardening.

### Changes Required:

#### 1. The route

**File**: `src/pages/api/auth/signout.ts`

**Intent**: Replace both swallow points with the three-branch shape `signin.ts` already has, driven
by the Phase 1 decision.

**Contract**: `createClient` → `null` redirects to the `unconfigured` decision's path with its
message encoded into `?error=` — the URL is assembled here, in `signin.ts:36`'s shape (F3). Otherwise
`signOut()` runs inside a `try`/`catch`, because it can throw as well as return (research §2.5); a
throw and a returned error both produce the `failed` decision. The success path keeps `redirect("/")`
unchanged — a real sign-out leaves no user, so the middleware does not bounce and the guest landing
is correct (D-11). No `console.*` anywhere (`no-logging.test.ts` walks all of `src/`), and no
`formData()` read (`form-endpoint-guards.test.ts:145-161` pins exactly six readers by name).

#### 2. The banner — nothing to build

**Files**: none.

`signin.astro:7` already reads and vouches the parameter
(`ownedAuthMessage(Astro.url.searchParams.get("error"))`) and renders it through a page-level
`ServerError`, which is what both sibling auth routes already rely on. Landing there costs **no**
render site, no `decks/index.astro` edit, and no change to `tests/lib/error-param-guard.test.ts`
(that guard's rule is per-line at the READ, and this page's read is already wrapped and registered).

This section is kept rather than deleted because its absence is the load-bearing consequence of the
landing-page change (plan-review F1): the original plan's page-level banner on `/decks`, its
`mb-4`-wrapper shape and its `?error=X&open=create` double-render question are all **gone**, not
deferred. `decks/index.astro` is untouched by this change.

#### 3. The route's success path, tested

**File**: `tests/auth/signout.test.ts` (new)

**Intent**: Give the route its first test of any kind, on the one branch the runner can reach.

**Contract**: Drives the real route through the Container API (`callEndpoint`, which does not follow
redirects, so `status` and the raw `Location` are directly assertable — `tests/fixtures/endpoint.ts:60-65`).
Asserts `302` to `/` and that the response stages the session-clearing cookies.

**Whether it also asserts that the cookie no longer resolves a user, and whether it needs its own
account, are both decided by the measurement that opens this phase** (Critical Implementation
Details; plan-review F4). Do not write either into the test before the answer is on record — they
are the same fact read in opposite directions, and getting it wrong costs either a failing assertion
or a shared-fixture mutation that surfaces as unrelated cross-file flakiness.

If the owned account is needed, state the reason in the file header: it is invisible from the test
body, and the globalSetup edit it requires is not "following the existing path" (see above).

The `unconfigured` branch is **not** reachable here: `createClient` returns `null` only when the env
is absent, and `astro:env/server` is inlined at transform time under Vitest, so reaching it needs the
module double `§6.9` confines to one file. It is covered by the Phase 1 truth table and by the manual
run in Phase 5, and this file says so.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Full suite green: `npm test`, run three times on fresh un-pinned shuffle seeds — the new account
  provisioning is exactly the kind of shared-fixture change §6.2's shuffle rule exists to catch
- `npm run e2e` still green: the harness asserts the "Wyloguj" button exists but never clicks it, so
  this should be unaffected — run it to confirm rather than infer

#### Manual Verification:

- The global-sign-out access-token question is measured and recorded **before** the test is written,
  and the design branch it selects is stated in `verification.md`
- Signing out normally still lands on the guest landing with no `sb-` cookie
- The banner renders on `/auth/signin` when the parameter is present, with `role="alert"` in the
  accessibility tree, and is absent on an ordinary load
- A crafted `/auth/signin?error=dowolny+tekst` renders **no** banner (`ownedAuthMessage` rejecting it)

---

## Phase 3: Close the `?error=` guard blind spot

### Overview

Bring `signout.ts` — and only `signout.ts` — inside `form-endpoint-guards.test.ts`'s two `?error=`
sweeps, so Phase 2's new emission is enforced rather than conventional. (D-06)

**Scope re-decided 2026-08-14 after plan-review F1/F2, and the original scope was measured before it
was dropped.** The plan called for widening the root from `src/pages/api/decks` to `src/pages/api`,
having identified one obstacle (`ownedNames` keying on the `@/lib/redirect-errors` import, fixed by
keying on the redirect target). Running this guard's own `rejection()` logic verbatim against the two
files a widened root newly sweeps in shows that under **that same target-keyed fix** four of the six
existing auth emissions are rejected:

| site                           | emission                                                                             | verdict under target keying                                  |
| ------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `signin.ts:43`, `signup.ts:33` | `error=${encodeURIComponent(authErrorMessage(error))}`                               | `not an identifier: authErrorMessage(error)`                 |
| `signin.ts:29`, `signup.ts:20` | `error=${encodeURIComponent(message)}` over a `isFormContentType(...) ? A : B` local | `local` message `mixes the closed set with a computed value` |
| `signin.ts:36`, `signup.ts:27` | `error=${encodeURIComponent(AUTH_UNAVAILABLE_MESSAGE)}`                              | accepted                                                     |

Greening those needs two new exemptions inside `rejection()` — accept a call to a mapper that is
total into the vouching set, and accept a ternary whose non-member residue is a predicate call. This
is the one guard in this repo whose every previous exemption turned out to be a defect
(`computedResidue` exists because "mentions an owned name" waved through `err.message` in three
shapes, C10X-40 F1; `localDeclarations` scans every declaration because first-match-wins hid a
shadowed leak, F2), so each would need its own falsification run and its own defence. That is a
ticket, not a sub-phase. The second reason the original scope is dropped is that its own headline
argument died with F1: `signout.ts` was said to prove per-directory keying wrong "because it emits
into `/decks` **and** `/auth/signin`" — after F1 it emits into `/auth/signin` only.

### Changes Required:

#### 1. A registered-surface table, not a widened root

**File**: `tests/lib/form-endpoint-guards.test.ts`

**Intent**: Cover this ticket's own new producer without touching `rejection()`'s rules.

**Contract**: Replace the bare `DECKS_API_DIR` root of the two `?error=` describes with a small
surface table — one row per scanned surface, carrying the paths it covers and the module that
vouches for them:

| surface     | paths                                | vouching module         |
| ----------- | ------------------------------------ | ----------------------- |
| deck routes | `src/pages/api/decks/**` (unchanged) | `@/lib/redirect-errors` |
| sign-out    | `src/pages/api/auth/signout.ts`      | `@/lib/auth-errors`     |

`ownedNames` (`:307`) takes the module specifier as a parameter instead of hardcoding
`@/lib/redirect-errors`; nothing else in `rejection()` changes. **Fail closed**: a scanned file whose
surface cannot be resolved is a failure, never a skip — the silent-skip direction is the one this
file's own "known limitation" comment (`:437-441`) already regrets for wrapped call sites.

**This phase depends on the route building its own URL** (plan-review F3): the sweeps are textual, so
if the finished `?error=` URL is assembled inside `src/lib/signout-outcome.ts` then `signout.ts`
contains no `error=` text, `emissionCount` returns 0 for it, and the producer filter at `:254` does
not even classify it as a producer — the registration would guard a file with nothing in it. Phase 1
§3's contract is written accordingly.

The two floors (`total >= 29`, `perFile.length >= 6`) are measured against the deck subtree and must
be **re-measured**, not scaled by arithmetic. The comment at `:430-436` records why the floor sits at
the measured value rather than below it.

Correct the SCOPE comment (`:25-26`) while here — but to what is now true, which is **not** what the
original plan intended. It claims `src/pages/api/` is the whole population; that was false for two of
the three describes and stays false. The honest wording is "the `formData()` sweep covers
`src/pages/api/`; the two `?error=` sweeps cover the registered surfaces below". Record the auth
mapper shape as a **deliberate, measured exclusion** with the table above beside it, so the next
person to consider widening starts from the four rejections rather than rediscovering them.

#### 2. The follow-up that carries what is left out

**File**: `context/changes/bug-signout-swallowed/follow-ups/error-param-guard-auth-routes.md` (new)

**Intent**: `signin.ts` and `signup.ts` remain outside the `?error=` sweep. That is now a written
gap with the evidence attached rather than an unstated one.

**Contract**: The rejection table above, the two exemptions a full widening would need, and the note
that `authErrorMessage`'s totality into `AUTH_MESSAGES` is asserted by `tests/auth/errors.test.ts`
rather than by the guard — so the exemption would import a property from another file's claims.

### Success Criteria:

#### Automated Verification:

- Full suite green: `npm test`
- Breakage: replacing Phase 2's constant with an inline literal in `signout.ts` turns this guard
  red, naming file and line — the check that the registration actually reached the new producer
- Breakage: emitting a `REDIRECT_MESSAGES` member from `signout.ts` is rejected, proving the surface
  table resolves per surface and is not a union of both sets
- The detector's own positive controls still pass (the four rejection shapes at `:456-460`)
- The deck surface's own claims are unchanged: same emissions inspected, same verdicts

#### Manual Verification:

- The re-measured floors were obtained by running, not derived from the previous numbers
- The SCOPE comment states what is scanned and what is deliberately not, and the follow-up exists

---

## Phase 4: The Sentry channel, and the guard that holds it

### Overview

Add the second channel and make it enforced. Today `audit-failure-wiring.test.ts` is hardcoded to
`src/pages/api/generate.ts` (`:38-39`), so a capture anywhere else is guarded by nothing. (D-03, D-07)

### Changes Required:

#### 1. The report builder

**File**: `src/lib/signout-outcome.ts` (extended)

**Intent**: Decide what leaves the process toward a third party, as a pure function over its
arguments, so the privacy property is a truth table rather than a reviewer's attention.

**Contract**: A fixed capture message constant and a builder taking the auth-error-shaped cause and
returning `{ tags, extra }`. Structured, low-cardinality fields (error `name`, `status`, `code`)
travel verbatim as tags; every free-form string leaves as a length plus a digest prefix, reusing
`audit-failure-report.ts`'s `fingerprint` shape rather than re-deriving it. **It must not throw**
(see Critical Implementation Details). No user identifier: the session's owner is exactly who the
event must not name.

The message constant must not interpolate anything, so the wiring guard can assert the capture's
first argument is a `new Error(...)`. Naming `@supabase/ssr` or `@supabase/auth-js` in it is
**safe** for a direct capture — the sampling gate returns early on a non-console event
(`sentry-sampling.ts:88`) — but avoid it anyway as a free hedge, and record the correction so
research §7's over-cautious half is not propagated. (D-13)

#### 2. The capture

**File**: `src/pages/api/auth/signout.ts`

**Intent**: Fire exactly one capture on the failed branch, composed by the builder.

**Contract**: `Sentry.captureException(new Error(<message constant>), await <builder>(cause))` — a
**synthetic** error as the first argument, never the auth error itself, because the first argument is
serialised onto the event where no builder can reach it. The response is unchanged by whether the
capture succeeds.

#### 3. The privacy truth table

**File**: `tests/lib/signout-outcome.test.ts` (extended)

**Contract**: A positive control (a fabricated leaky report **is** caught), retention of every
structured field, fingerprint stability and discrimination, and — the load-bearing half — that the
cause's own free-form text never appears verbatim in the output.

#### 4. The generalized wiring guard

**File**: `tests/lib/audit-failure-wiring.test.ts` → `tests/lib/sentry-capture-wiring.test.ts`
(`git mv`, then rewrite)

**Intent**: Turn a one-file guard into the registered-targets + catch-all shape this project already
trusts from `error-param-guard.test.ts` — so the claim becomes "every first-party Sentry capture
under `src/` is registered and delegates", and the _next_ capture site cannot land unguarded either.

**Contract**: A `TARGETS` table, one row per handler, carrying the handler path, its builder name and
module, the expected capture count, and the content fields that may not appear on a capture
statement. `generate.ts` is one row (its existing claims preserved: exactly two captures, both
delegating, synthetic first argument, no content field, builder imported); `signout.ts` is the second.

Plus the catch-all: walk all of `src/`, and any file containing `Sentry.captureException` that is not
a registered target fails, naming file and line. That is what makes this close the class instead of
adding a row.

Keep the statement-joining machinery as it stands (`:110-127`) — it exists because the capture
statement exceeds `printWidth: 120` and a per-line rule would redden correct code after
`npm run format` — including its "the joiner is not run away" control. The per-target line floor
(`:151`) must be re-measured per row, and the same four-line slack rationale applies: a floor at the
measured value goes red under this guard's own breakage run.

Rewrite the file header: its current framing is entirely about the audit row, and `src/worker.ts`'s
dated note plus `test-plan.md`'s §7 correction both point at it by name — those pointers move in
Phase 5.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `npm run typecheck`
- Full suite green: `npm test`
- Breakage: deleting the `signout.ts` capture turns the guard red by name
- Breakage: passing the raw auth error as the first argument turns the synthetic-first-argument
  assertion red while the delegation assertion stays green — the two rules proved independent, as
  C10X-50's B4 pair did
- Breakage: a `Sentry.captureException` planted in an unregistered file under `src/` turns the
  catch-all red — the assertion that makes this a class closure
- `generate.ts`'s existing claims all still pass after the rewrite — **seven `it()`s**, of which six
  assert about `generate.ts` and one (`:158`) is the detector's own positive control over fabricated
  strings. (Said "five" until plan-review F7, 2026-08-14; `test-plan.md` records the file at 7 cases
  in two places. Re-measure rather than trusting either number.)

#### Manual Verification:

- The rewritten header states what the guard does **not** prove — that no layer here asserts an event
  is emitted, sampled, transported or delivered, `/api/shipprobe` having been deleted by C10X-54

---

## Phase 5: Evidence and doc-sync

### Overview

One recorded manual run proving the failure branch is reachable in a running app, plus the document
edits this change makes necessary.

### Changes Required:

#### 1. The manual run

**File**: `context/changes/bug-signout-swallowed/verification.md` (new)

**Intent**: Prove the branch is reachable in production code, which no test in this project can.
(D-10)

**Contract**: Sign in normally, then point `SUPABASE_URL` at a non-listening port and click
"Wyloguj". Expected: `AuthRetryableFetchError` (status 0), the `/auth/signin` banner carrying
`SIGNOUT_FAILED_MESSAGE`, and the session **provably still alive**.

**The provocation reaches the banner only because the landing page is unprotected, and that is worth
recording as a result rather than assuming it** (plan-review F1, 2026-08-14). The same env change
also breaks the client the middleware reads the session with, so `locals.user` is `null` on the next
hop — which under the original `/decks` landing would have bounced the redirect to `/auth/signin` and
dropped the parameter, making this run structurally incapable of showing the banner. Write down what
the failing `getUser()` does to the hop, because it is the evidence for that finding as well as
context for this one.

**Sequencing is load-bearing, not housekeeping.** "Still alive" cannot be shown while the port is
dead — nothing can resolve a user then — so the order is: fail, observe the banner, restore the port,
then load `/decks` **without signing in again**. Landing in the app is the proof. And a **control**
differing in exactly one variable (the port restored) must land the ordinary success redirect, or a
message that fires on every failure is indistinguishable from one that fires on the right failure —
the unfalsifiable-rehearsal class this project records against C10X-29.

Also record the `null`-client provocation (unset the env after signing in), and heed research §6: a
browser POST may answer **403** on Astro's `checkOrigin` CSRF grounds for reasons unrelated to this
route's logic. Restore the env and prove it by hash.

#### 2. The carve-out, in four places

**File**: `context/foundation/test-plan.md`

**Intent**: Four sites name `src/pages/api/auth/signout.ts:7` as the last discarded-result mutation
and carve it out as C10X-51's. Enumerated by grep rather than trusted from research: `:16`, `:1860`,
`:1916`, `:5732`. None in `README.md` or `AGENTS.md`.

**Contract**: Live claims are **edited**; dated historical entries take a **dated correction line and
are not rewritten** — the precedent this file states repeatedly. Resolve each site by walking up to
its enclosing heading rather than by line number: this change's own edits will move them, which is
exactly the trap C10X-50's research names.

Add a new §6.6 entry for this change, stating the split evidence honestly (the suite owns the
decision and the privacy property; one manual run owns the endpoint's use of it; nothing bridges
them) and the two coverage boundaries — the `unconfigured` branch is unreachable from the suite, and
nothing here proves a Sentry event is delivered.

Add the shared-account hazard to §6 as a cookbook fact: **a successful sign-out revokes every session
for that user**, so a test that drives it must own its account. It is invisible from the test file
and would present as unrelated flakiness.

#### 3. The pointers that move

**Files**: eight live sites, enumerated below.

**Intent**: Phase 4 renames `tests/lib/audit-failure-wiring.test.ts`, and every live reference to
that path goes stale with it.

**Contract**: **Enumerate by grep at doc-sync; do not work from this list.** It is written down so
the scale is visible when the phase is scheduled, not as the contract — this is exactly the
incomplete-sweep class `form-endpoint-guards.test.ts`'s own header records ("found incomplete twice
by reading, not by a red run"), and the earlier version of this section named two of the eight
(plan-review F6, 2026-08-14).

Measured 2026-08-14:

| site                                        | kind                       |
| ------------------------------------------- | -------------------------- |
| `src/pages/api/generate.ts:484`             | live comment               |
| `src/worker.ts:43`                          | live dated note            |
| `tests/lib/audit-failure-report.test.ts:23` | live comment               |
| `context/foundation/test-plan.md:58`        | header block               |
| `context/foundation/test-plan.md:1952`      | §6.6 claims table          |
| `context/foundation/test-plan.md:1957`      | §6.6 suite-count breakdown |
| `context/foundation/test-plan.md:4237`      | §7                         |
| `context/foundation/test-plan.md:5652`      | §8 ledger                  |

Repoint the path; do not rewrite the dated claims around it. Archive hits (nine, across three files
under `context/archive/2026-08-13-bug-generation-failed-audit-swallowed/`) take dated corrections,
never edits.

**Plus one live CLAIM that is not a pointer**, and it goes false rather than stale:
`src/pages/api/generate.ts:6` reads "The ONLY module in `src/` that imports the Sentry SDK besides
`src/worker.ts`". Phase 4 adds that import to `signout.ts`, so the sentence must be corrected in the
same commit — a third first-party importer, and the reasons the comment gives for the import being
safe transfer verbatim (they are properties of the package and of the SDK's global hub, not of the
route).

#### 4. The roadmap row closes

**File**: `context/foundation/roadmap.md`

**Contract**: H-19 `Status: in progress` → `done` with the archive path, following H-18's wording.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Full suite green: `npm test`
- `git diff -- src/` empty after every breakage restore, verified by per-file hash

#### Manual Verification:

- The failure branch was reached in a running app and the banner observed, with its control
- The session was proved still alive after the failed sign-out — the claim the whole ticket rests on
- Every env change restored and the restore proved, not remembered
- All four carve-out sites resolved by heading, and each classified as live-edit or dated-correction

---

## Testing Strategy

### Unit Tests

- `tests/lib/signout-outcome.test.ts` — the outcome→landing truth table (every branch, including the
  two unreachable from the runner), the false-alarm class, membership by equality, and the control
  that the three outcomes differ; plus Phase 4's privacy truth table with its leaky-report control.

### Integration Tests

- `tests/auth/signout.test.ts` — the real route's success path through the Container API, on an
  account the file owns.

### Guard Tests

- `tests/lib/form-endpoint-guards.test.ts` — see Phase 3 (scope re-decided after plan-review F1/F2).
- `tests/lib/sentry-capture-wiring.test.ts` — registered targets plus a catch-all over `src/`.
- `tests/auth/errors.test.ts` — membership of the new constant in `AUTH_MESSAGES`, and its
  distinctness from `AUTH_SESSION_MISSING_MESSAGE`. `tests/lib/redirect-errors.test.ts` is
  **untouched**: `REDIRECT_MESSAGES` stays at eleven.

### Manual Testing Steps

1. Sign in; confirm the header shows the account e-mail.
2. Point `SUPABASE_URL` at a dead port; click "Wyloguj". Expect `/auth/signin` carrying
   `SIGNOUT_FAILED_MESSAGE` — reachable now precisely because that page is **not** protected, so the
   middleware's own failing `getUser()` cannot bounce it (contrast plan-review F1).
3. Restore the port **without signing in again**, then load `/decks`. Landing in the app proves the
   session survived the failed sign-out — the claim the whole ticket rests on. It cannot be proved
   while the port is dead (nothing can resolve a user then), so this ordering is not optional.
4. Click "Wyloguj" again with the port restored. Expect the guest landing and no `sb-` cookie — the
   one-variable control.
5. Unset the env entirely; click "Wyloguj". Expect `/auth/signin` with the unavailable message.
6. Load `/auth/signin?error=dowolny+tekst`. Expect **no** banner.

## Performance Considerations

None. The added work on the failure path is one digest of a short error message on a request that
has already made a network round trip and is about to redirect.

## Migration Notes

No migration, no schema change, nothing pushed to the cloud. The C10X-29 drift gate is not involved.

## References

- Research: `context/changes/bug-signout-swallowed/research.md`
- Sibling that shipped the two-channel shape: `context/archive/2026-08-13-bug-generation-failed-audit-swallowed/`
- Sibling that shipped "detection, not deletion": `context/archive/2026-08-13-bug-generation-deck-undo-swallowed/`
- The landing page and its existing vouched banner: `src/pages/auth/signin.astro:7`
- The three-branch route shape to copy: `src/pages/api/auth/signin.ts:34-46`
- Plan review: `context/changes/bug-signout-swallowed/reviews/plan-review.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The decision, the copy, and the closed set

#### Automated

- [x] 1.1 Type gate passes: `npm run typecheck` — 345249e
- [x] 1.2 Lint passes: `npm run lint` — 345249e
- [x] 1.3 Full suite green: `npm test` — 345249e
- [x] 1.4 The truth table's control fails when the decision is collapsed to a single location — 345249e

#### Manual

- [x] 1.5 The new copy names the live session and a way out, and cannot be confused with
      `AUTH_SESSION_MISSING_MESSAGE` beside it in the same set — 345249e
- [x] 1.6 H-19's three roadmap edits match H-18's field order and formatting — 345249e

### Phase 2: The route and the banner

#### Automated

- [x] 2.1 Type gate passes: `npm run typecheck` — 39e2b6c
- [x] 2.2 Lint passes: `npm run lint` — 39e2b6c
- [x] 2.3 Full suite green on three fresh shuffle seeds: `npm test` — 39e2b6c
- [x] 2.4 `npm run e2e` still green — 39e2b6c

#### Manual

- [x] 2.0 The global-sign-out access-token question measured and recorded **before** the test is
      written; the design branch it selects is stated in `verification.md` — 39e2b6c
- [x] 2.5 Normal sign-out still lands on the guest landing with no `sb-` cookie — 39e2b6c
- [x] 2.6 The banner renders on `/auth/signin` with `role="alert"`, and is absent on an ordinary load — 39e2b6c
- [x] 2.7 A crafted `/auth/signin?error=` value renders no banner — 39e2b6c

### Phase 3: Close the `?error=` guard blind spot

#### Automated

- [x] 3.1 Full suite green: `npm test` — 8a11341
- [x] 3.2 Breakage: an inline literal in `signout.ts` turns the guard red, naming file and line — 8a11341
- [x] 3.3 Breakage: a `REDIRECT_MESSAGES` member emitted from `signout.ts` is rejected — 8a11341
- [x] 3.4 The detector's four existing rejection controls still pass — 8a11341
- [x] 3.5 The deck surface's claims are unchanged — same emissions inspected, same verdicts — 8a11341

#### Manual

- [x] 3.6 The re-measured floors were obtained by running, not derived — 8a11341
- [x] 3.7 The SCOPE comment states what is scanned and what is deliberately not, and the follow-up exists — 8a11341

### Phase 4: The Sentry channel, and the guard that holds it

#### Automated

- [x] 4.1 Type gate passes: `npm run typecheck` — 54cb368
- [x] 4.2 Full suite green: `npm test` — 54cb368
- [x] 4.3 Breakage: deleting the `signout.ts` capture turns the guard red by name — 54cb368
- [x] 4.4 Breakage: a raw-cause first argument reddens only the synthetic-first-argument assertion — 54cb368
- [x] 4.5 Breakage: a capture planted in an unregistered `src/` file turns the catch-all red — 54cb368
- [x] 4.6 `generate.ts`'s existing claims all still pass — seven `it()`s, six about `generate.ts`
      plus the detector control; count re-measured, not carried over — 54cb368

#### Manual

- [x] 4.7 The rewritten header states what the guard does not prove (no delivery claim) — 54cb368

### Phase 5: Evidence and doc-sync

#### Automated

- [x] 5.1 Type gate passes: `npm run typecheck`
- [x] 5.2 Lint passes: `npm run lint`
- [x] 5.3 Build passes: `npm run build`
- [x] 5.4 Full suite green: `npm test`
- [x] 5.5 `git diff -- src/` empty after every breakage restore, verified by hash

#### Manual

- [x] 5.6 The failure branch reached in a running app, banner observed on `/auth/signin`, with its
      one-variable control
- [x] 5.7 The session proved still alive after the failed sign-out — port restored first, no re-sign-in
- [x] 5.8 Every env change restored and the restore proved
- [x] 5.9 All four carve-out sites resolved by heading and classified live-edit vs dated-correction
