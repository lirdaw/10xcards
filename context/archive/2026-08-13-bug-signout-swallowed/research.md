---
date: 2026-08-13T22:35:23+02:00
researcher: Claude (Fable 5) for lirdaw
git_commit: 65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf
branch: main
repository: lirdaw/10xcards
topic: "Signout stops presenting a failed signOut as success (C10X-51)"
tags: [research, codebase, auth, signout, swallowed-errors, supabase, middleware, redirect-errors]
status: complete
last_updated: 2026-08-13
last_updated_by: Claude (Fable 5)
---

# Research: Signout stops presenting a failed signOut as success (C10X-51)

**Date**: 2026-08-13T22:35:23+02:00
**Researcher**: Claude (Fable 5), driven by lirdaw
**Git Commit**: `65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf` (pushed; `origin/main` 0 ahead / 0 behind)
**Branch**: `main`
**Repository**: `lirdaw/10xcards`

## Research Question

Fix the swallowed `signOut()` in `src/pages/api/auth/signout.ts` (lines 6-9): the `{ error }` from
`supabase.auth.signOut()` is discarded and the route unconditionally redirects to `/` as success;
when `createClient` returns `null`, sign-out does not happen at all yet the redirect still fires.

Acceptance, from `change.md`: **a failed `signOut` must not present as success**, and **the
missing-client (`null`) branch is handled, not ignored**.

This is hit **#4** of the 2026-08-11 swallowed-errors audit, and the last discarded-result Supabase
mutation in `src/` after C10X-48/49/50 closed the `generate.ts` class.

## Summary

Six findings, in the order they change what the plan should do.

**1. A returned error means the user is still signed in — this is a live authentication defect, not
a lost audit record.** Verified in the installed `@supabase/auth-js` 2.105.3 source:
`_removeSession()` (the only thing that clears the cookie) sits at `GoTrueClient.js:3200`, _below_
the two early `return { error }` statements at `:3184` and `:3195`. So on the dominant failure path
the local cookie is never cleared and nothing is revoked anywhere. This is the sharpest difference
from all three siblings, where the swallowed result cost the user nothing.

**2. The observable symptom is not what the ticket implies.** A failed sign-out does not leave the
user on the guest landing with a stale session. `src/middleware.ts:55-58` bounces an authenticated
visitor from `/` to `/decks`, so the user clicks "Wyloguj", is thrown back into the app on `/decks`
with their own e-mail in the header, and nothing on any channel says why. The state is _visible_ to
someone who looks, and _narrated_ nowhere.

**3. The benign cases are already safe, so a plain `if (error)` will not produce a spurious banner.**
A signed-out caller gets `{ error: null }` (`GoTrueClient.js:2343`, and `AuthSessionMissingError` is
explicitly excluded at `:3183`), and 401/403/404 from `/logout` are allow-listed as success at
`:3192-3193`. But **`signOut()` can also throw rather than return** — `_notifyAllSubscribers`
rethrows a callback error at `:3964` and neither `_signOut` nor `signOut` has a `catch` — so
`if (error)` alone is an incomplete fix.

**4. The redirect target `/` cannot carry a message, and a guard actively forbids teaching it to.**
`src/pages/index.astro` reads no request state at all (its frontmatter is two imports), and
`tests/lib/error-param-guard.test.ts:242-297` scans the whole of `src/` for `?error=` reads outside
two registered surfaces — with `pages/index.astro` named in its own positive control at `:259-267`.
So the fix's real design question is **which page the user should land on**, and the message set
follows from that, not the other way around.

**5. `/decks` looks like the honest landing but does not render the message where it lands today.**
`decks/index.astro:39` passes `serverError` only into `<CreateDeckModal defaultOpen={openCreate} …>`,
so `/decks?error=X` without `open=create` shows nothing at all. Choosing `/decks` therefore costs one
page-level banner render — precedented by `decks/[publicId]/index.astro:170` — on top of a
`REDIRECT_MESSAGES` member.

**6. There is nothing to break and nothing that would catch a regression.** No test in this
project touches `/api/auth/signout` — one grep over all of `tests/` returns a single hit, and it is
`auth.setup.ts:136` asserting the "Wyloguj" button _exists_ as proof of a signed-in shell. Every
guard listed in §5 constrains _how_ the fix is written; none asserts _what the route does_.

A design that follows from these: **on a failed sign-out redirect to `/decks`, because the middleware
guard then verifies the claim for free** — if the session really did die, the guard bounces the user
to `/auth/signin` and they never see a false alarm; if it survived, they land on the page that both
matches reality and carries the "Wyloguj" button to retry. That property removes the need to
discriminate the one false-alarm error class (§2.4). The `null`-client branch goes to
`/auth/signin?error=AUTH_UNAVAILABLE_MESSAGE`, byte-identical to what `signin.ts:36` and
`signup.ts:27` already do for the same condition. §8 records the alternative and its cost.

## Detailed Findings

### 1. The defect, and its two swallow points

`src/pages/api/auth/signout.ts` in full — ten lines:

```ts
import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    await supabase.auth.signOut();
  }
  return context.redirect("/");
};
```

- **Swallow A — the discarded result** (`:7`). `await` with no destructuring.
- **Swallow B — the `if` with no `else`** (`:6-8`). `createClient` returns `null` only when
  `SUPABASE_URL`/`SUPABASE_KEY` are absent (`src/lib/supabase.ts:6-9`), and the route then redirects
  to `/` having done nothing.

Both siblings answer the same `null` condition as a user-visible refusal: `signin.ts:34-37` and
`signup.ts:25-28` redirect with `AUTH_UNAVAILABLE_MESSAGE`. Sign-out is the only auth route that
treats it as success.

**Reachability of Swallow B is narrow and worth stating in the plan rather than assuming.** To see
any of the three sign-out controls the page must have rendered with `Astro.locals.user` truthy, and
`locals.user` is set from a client that is `null` under exactly the same condition
(`src/middleware.ts:44-53`). So the `null` branch is reachable only if the configuration disappears
between the page render and the POST. That does not make it optional — the acceptance criterion names
it — but it does mean no test or manual run will reach it without forcing the env.

### 2. What a failed `signOut()` actually means (the crux)

Verified against installed sources, not from memory: `@supabase/ssr` **0.10.3**,
`@supabase/supabase-js` **2.105.3**, `@supabase/auth-js` **2.105.3** (hoisted, pinned exactly by
supabase-js). `supabase-js` does not override `signOut`; `SupabaseAuthClient extends AuthClient`.

The entire answer is in one function, `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:3179-3205`:

```js
3179:    async _signOut({ scope } = { scope: 'global' }) {
3180:        return await this._useSession(async (result) => {
3182:            const { data, error: sessionError } = result;
3183:            if (sessionError && !isAuthSessionMissingError(sessionError)) {
3184:                return this._returnResult({ error: sessionError });      // ← EARLY RETURN (A)
3185:            }
3186:            const accessToken = data.session?.access_token;
3187:            if (accessToken) {
3188:                const { error } = await this.admin.signOut(accessToken, scope);
3189:                if (error) {
3190:                    // ignore 404s since user might not exist anymore
3191:                    // ignore 401s since an invalid or expired JWT should sign out the current session
3192:                    if (!((isAuthApiError(error) &&
3193:                        (error.status === 404 || error.status === 401 || error.status === 403)) ||
3194:                        isAuthSessionMissingError(error))) {
3195:                        return this._returnResult({ error });            // ← EARLY RETURN (B)
3196:                    }
3197:                }
3198:            }
3199:            if (scope !== 'others') {
3200:                await this._removeSession();                             // ← THE ONLY LOCAL CLEAR
3201:                await removeItemAsync(this.storage, `${this.storageKey}-code-verifier`);
3202:            }
3203:            return this._returnResult({ error: null });
3204:        });
3205:    }
```

**Both `return { error }` statements sit above the only call that clears the cookie.** That single
structural fact is the finding.

#### 2.1 The cookie-clearing path, end to end

Every hop is awaited, so by the time `await supabase.auth.signOut()` resolves the `Set-Cookie`
headers are already staged on the response:

1. `_removeSession()` — `GoTrueClient.js:4012-4022` — removes the storage keys, then
   `await this._notifyAllSubscribers('SIGNED_OUT', null)` at `:4021`.
2. The **server** storage adapter writes no cookie itself; it only records intent —
   `@supabase/ssr/dist/module/cookies.js:307-315` (`removedItems[key] = true`). The module says so
   at `:246-252`: changes are persisted "_at once_ when appropriate (usually only when the
   TOKEN_REFRESHED, USER_UPDATED or SIGNED_OUT events are fired)".
3. `_notifyAllSubscribers` awaits every callback (`:3951-3959`).
4. `createServerClient` registered one (`createServerClient.js:45-62`): on `SIGNED_OUT` with pending
   storage changes it calls `applyServerStorage`.
5. `applyServerStorage` calls `setAll` with blank `maxAge: 0` cookies (`cookies.js:348-372`).
6. Because `src/lib/supabase.ts:12-22` supplies a `getAll`/`setAll` pair, `setAll` is bound directly
   to this project's function (`cookies.js:112-113`) → `cookies.set(name, "", { …, maxAge: 0 })`.

**Conditional on the network call.** The early return at `:3195` means `removedItems` stays empty,
`hasStorageChanges` is false, `applyServerStorage` never fires, and **`setAll` is never called at
all**.

#### 2.2 What each error class actually implies

| /logout outcome                | Class                                   | `_removeSession()` reached?         | User's real state         |
| ------------------------------ | --------------------------------------- | ----------------------------------- | ------------------------- |
| `fetch` rejects (DNS/TCP/CORS) | `AuthRetryableFetchError`, status **0** | **No**                              | **Still signed in**       |
| 502/503/504/520-524/530        | `AuthRetryableFetchError`               | **No**                              | **Still signed in**       |
| 500, 429                       | `AuthApiError`                          | **No**                              | **Still signed in**       |
| unparseable body               | `AuthUnknownError`                      | **No**                              | **Still signed in**       |
| 401 / 403 / 404                | `AuthApiError`                          | **Yes** (allow-listed `:3192-3193`) | Signed out, `error: null` |
| `session_not_found`            | `AuthSessionMissingError`               | **Yes** (allow-listed)              | Signed out, `error: null` |

#### 2.3 The no-session case is safe

A signed-out caller reaches `__loadSession`'s clean absence branch —
`return { data: { session: null }, error: null }` (`GoTrueClient.js:2342-2344`) — so `sessionError`
is falsy, `accessToken` is `undefined`, the network block is skipped entirely, and the result is
`{ error: null }`. Even if `AuthSessionMissingError` were raised, `:3183` excludes it from the early
return by name. **The ordinary double-click / already-signed-out case cannot produce a banner.**

#### 2.4 One false-alarm class, and why the landing choice can neutralise it

If the stored session is expired and the refresh fails **non-retryably**, `_callRefreshToken`'s catch
clears the session itself before propagating the error (`GoTrueClient.js:3925-3933`):

```js
3927:            if (isAuthError(error)) {
3928:                const result = { data: null, error };
3929:                if (!isAuthRetryableFetchError(error)) {
3930:                    await this._removeSession();
3931:                }
```

That error then surfaces through `__loadSession` → `_signOut:3183-3184` **accompanied by a cookie
that is already gone** — i.e. an error on a sign-out that effectively succeeded. Discriminating it
would mean branching on `isAuthRetryableFetchError`. Landing on `/decks` makes that unnecessary: the
middleware guard re-checks the session on the very next request and bounces a genuinely signed-out
user to `/auth/signin`, dropping the parameter with it (§4.3).

#### 2.5 Two more facts the fix must not miss

- **`signOut()` can throw.** `_notifyAllSubscribers` rethrows the first callback error (`:3960-3965`)
  and neither `_signOut` nor `signOut` has a `catch`, so a throw from `applyServerStorage` or from
  this project's own `cookies.set` propagates. `GoTrueAdminApi.signOut` likewise rethrows anything
  that is not an `isAuthError` (`GoTrueAdminApi.js:81`). **A complete fix needs `try`/`catch` in
  addition to `if (error)`.**
- **The default scope is `global`** (`:3173`, `SIGN_OUT_SCOPES[0]` in `lib/types.js:19`). The route
  passes no options, so a _successful_ sign-out revokes every session on every device. The library's
  own docblock flags this at `:3140`. Worth stating in whatever the fix documents, because it is the
  reason the network call is not optional and cannot be replaced by a local cookie wipe.
- **Chunked cookies are handled and fail safe.** `isChunkLike` matches `sb-…-auth-token` plus any
  `.0`/`.1` suffix (`chunker.js:2-12`), and the 5-chunk cap applies only to the deprecated
  `get`/`set`/`remove` shape, which this project does not use. A _partial_ removal decodes to invalid
  JSON and is treated as absent (`cookies.js:25-31`) — i.e. signed out, never a resurrected session.

### 3. The observable symptom: the middleware bounce

`src/middleware.ts:55-58`, which runs on every request and **before** the `PROTECTED_ROUTES` block:

```ts
// Authenticated users skip the guest landing and go straight to their decks.
if (context.url.pathname === "/" && context.locals.user) {
  return context.redirect("/decks");
}
```

`locals.user` comes from `supabase.auth.getUser()` (`:46-53`), a real round-trip to GoTrue rather
than a cookie parse, so it reflects true server-side state. The sequence on a failed sign-out:

1. "Wyloguj" → native form POST → `signout.ts`.
2. `signOut()` fails (or `supabase` is `null`); the result is discarded.
3. `context.redirect("/")` → the browser follows with a document GET, cookie still live.
4. Middleware bounces it to `/decks`.
5. `/decks` renders inside `AuthenticatedLayout`, whose header shows `{user?.email}` next to the
   "Wyloguj" button (`AuthenticatedLayout.astro:21-30`).

So the user ends up back inside the authenticated app. `/api/auth/signout` is **not** in
`PROTECTED_ROUTES` (`middleware.ts:7-15`), so nothing about the guard interferes with the POST itself.

**The `/` → `/decks` branch has no test of any kind.** `tests/middleware.test.ts:162` covers only the
signed-_out_ case (`it.each(["/auth/signin", "/api/auth/signin", "/"])("lets a public path through")`),
and no e2e navigates to `/` while signed in.

### 4. Where a message can land

#### 4.1 The three triggers are all native form POSTs

Exhaustive — a grep for `/api/auth` over `src/` finds exactly three sign-out triggers, **zero**
`fetch()` call sites and zero links:

- `src/layouts/AuthenticatedLayout.astro:25` — "Wyloguj", the authenticated shell (`/decks`,
  `/decks/[publicId]`, `…/review`, `/generate`, `/study`, `/study/[publicId]`).
- `src/components/Topbar.astro:16` — "Sign out", rendered via `Welcome.astro:28` ← `index.astro:7`,
  i.e. on `/` itself, only when `Astro.locals.user` is truthy.
- `src/pages/dashboard.astro:17` — "Sign out", the legacy demo page.

Consequences: `retriable` (the JSON-island flag the three siblings used) **does not apply here** —
there is no island, no fetch, no JSON body. The only feedback channel is the page the response lands
on. Note also the accessible name differs across surfaces ("Wyloguj" vs "Sign out"), which matters if
a test ever locates the control by role+name.

There is **no other sign-out path**: no client-side `supabase.auth.signOut()`, no manual cookie
clearing anywhere in `src/`. The only cookie writer in the app is `src/lib/supabase.ts:18-22`.

#### 4.2 `/` is a dead end, by construction and by guard

`src/pages/index.astro` in full is two imports plus `<Layout><Welcome /></Layout>`. It reads no
`Astro.url`, no `searchParams`, no `Astro.locals`. The only banner reachable on `/` is the
config-status one from `Layout.astro:27-42`, which reports missing env vars and can never carry a
per-request error.

Teaching it to read `?error=` fails the suite. `tests/lib/error-param-guard.test.ts` registers exactly
two surfaces (`:82-90`) — `src/pages/auth` → `ownedAuthMessage`, `src/pages/decks` →
`ownedRedirectMessage` — and then runs a catch-all over all of `src/` (`:242-297`) whose positive
control names `pages/index.astro` explicitly at `:259-267`. Its stated policy (`:222-225`):

> every `.astro` page outside the registered surfaces must carry NO read at all. A new page that
> needs one has two honest options, and no third — register a surface above (declaring which closed
> set it vouches against), or do not read the parameter.

Registering `src/pages` as a surface would swallow the whole tree and defeat the catch-all, so
option "register" is effectively closed for `/`.

#### 4.3 The complete inventory of `?error=`-capable pages

Five `.astro` files read any query parameter at all (14 reads). The vouched `error` reads are:

| `file:line`                                   | Helper                 | Rendered where                    |
| --------------------------------------------- | ---------------------- | --------------------------------- |
| `src/pages/auth/signin.astro:8`               | `ownedAuthMessage`     | page-level `ServerError`          |
| `src/pages/auth/signup.astro:8`               | `ownedAuthMessage`     | page-level `ServerError`          |
| `src/pages/decks/index.astro:27`              | `ownedRedirectMessage` | **inside `CreateDeckModal` only** |
| `src/pages/decks/[publicId]/index.astro:95`   | `ownedRedirectMessage` | `.astro` markup at `:170`         |
| `src/pages/decks/[publicId]/review.astro:119` | `ownedRedirectMessage` | island                            |

**The `/decks` trap, verified directly** — `decks/index.astro:39`:

```astro
<CreateDeckModal defaultOpen={openCreate} serverError={error} client:load />
```

with `openCreate = Astro.url.searchParams.get("open") === "create"` at `:28`. So `/decks?error=X`
alone renders **nothing**; the message only appears if the create-deck modal is open, and popping a
"create deck" modal to report a sign-out failure would be absurd. Choosing `/decks` as the landing
therefore requires adding a page-level banner render to `decks/index.astro` — the shape
`decks/[publicId]/index.astro:170` already has.

`ServerError` (`src/components/auth/ServerError.tsx`, **not** `src/components/ui/`) takes a single
`message?: string | null`, returns `null` for a falsy value (`:8`) — which is the documented reason an
unvouchable value degrades to _no banner_ — and renders `role="alert"` on its `<p>` (`:44-50`). Its
own comment (`:11-18`, `:28-33`) records that a message arriving by full-page redirect is present at
**mount**, which is the weak case: the node is exposed as an alert in the accessibility tree, but
announcement is not claimed. A sign-out message lands in exactly that class.

#### 4.4 Which closed set — and the conflict between two sub-reports

The two research threads disagreed, and the disagreement is worth recording because both were half
right.

- One concluded `AUTH_MESSAGES`, because `REDIRECT_MESSAGES`' docblock scopes it to "the six
  redirect-style endpoints" and only the three deck pages consume `ownedRedirectMessage`, so "a
  sign-out failure never lands on a deck page".
- The other concluded `REDIRECT_MESSAGES`, because `/api/auth/signout` _is_ a native form-POST +
  redirect endpoint, which is exactly the channel that set governs.

**Resolution: the second premise of the first argument is circular** — a sign-out failure lands on a
deck page if and only if we choose to send it there. The set is a _consequence_ of the landing
decision, not an input to it. And the docblock's actual prohibition (`redirect-errors.ts:92-95`) is
narrower than "only these six endpoints":

> A message only a **JSON endpoint** emits must NOT be added here: every member is a value the deck
> pages will render from a URL … Share the constant, not the membership.

`signout.ts` is not a JSON endpoint, so a genuine `?error=` producer joining the set is within the
docblock's own criterion. The size pin at `tests/lib/redirect-errors.test.ts:92-95`
(`toHaveLength(11)` twice) is a deliberate speed bump, not a prohibition — its comment at `:79-91`
says so: _"This going red is not a failure — it is the question 'does a redirect-style endpoint
actually emit this?' If yes, bump the number in the same commit."_ The docblock's own "six" would
need to become "seven" in the same edit.

`AUTH_MESSAGES` (19 members, `auth-errors.ts:44-95`) has **no** size pin that a new constant would
move: `tests/auth/errors.test.ts:132-153` builds its `expect(distinct.size).toBe(17)` set from named
imports rather than from the array, while the two array-driven cases (`:234-239`, `:331-336`) iterate
`AUTH_MESSAGES` and would cover a new member automatically.

**`AUTH_UNAVAILABLE_MESSAGE` already exists and already means the right thing** for the `null`-client
branch: _"Uwierzytelnianie jest chwilowo niedostępne. Spróbuj ponownie później."_ — no new constant
needed there.

### 5. The guard map: what fires on which edit

Ten `tests/lib/*.test.ts` files scan source text. Four have `signout.ts` in scope; the rest are
scoped elsewhere and are listed because their _absence_ is load-bearing.

| Edit                                                        | Result                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Read `{ error }` but keep the unconditional `redirect("/")` | **all green** — and nothing proves the change                                        |
| `console.error(error)`                                      | **RED** — `no-logging.test.ts:102-104`, walks all of `src/`                          |
| `import.meta.env` / `process.env`                           | **RED** — `no-env-access.test.ts`                                                    |
| Add a `formData()` read to `signout.ts`                     | **RED** — `form-endpoint-guards.test.ts:145-161` pins exactly six readers by name    |
| Teach `src/pages/index.astro` to read `?error=`             | **RED** — `error-param-guard.test.ts:290-297`, naming file and line                  |
| Redirect to `/auth/signin?error=<AUTH_* member>`            | all green; `signin.astro` already vouches                                            |
| Add a new `AUTH_MESSAGES` member                            | all green (no size pin)                                                              |
| Add a `REDIRECT_MESSAGES` member                            | **RED by design** — `redirect-errors.test.ts:92-95`; bump 11 → 12 in the same commit |
| Emit a fresh inline `?error="…"` literal from `signout.ts`  | **GREEN — blind spot**, see below                                                    |
| `Sentry.captureException` in `signout.ts`                   | **GREEN** — `audit-failure-wiring.test.ts` is hardcoded to `generate.ts`             |

**The blind spot is the one worth acting on.** `form-endpoint-guards.test.ts`'s second and third
describes — "no deck route puts an inline literal into `?error=`" (`:220-263`) and "every `?error=`
value is a member of the closed set" (`:301-503`) — walk `DECKS_API_DIR` (`:34`), i.e.
`src/pages/api/decks/` only. So `signout.ts` could emit
`?error=${encodeURIComponent("dowolny nowy tekst")}` — or even relay an upstream string — with the
whole suite green. The auth routes' discipline of only ever emitting closed-set constants is enforced
by _nothing textual_ today; it rests on `tests/auth/errors.test.ts`'s per-case equality assertions,
which cover `signin`/`signup` only. If the fix makes `signout.ts` the third `?error=` producer under
`src/pages/api/auth/`, widening that guard's root from `src/pages/api/decks` to `src/pages/api` is
the cheap way to stop the new member being enforced by attention alone.

### 6. The test vacuum, and how a test would drive this route

**No test anywhere touches `/api/auth/signout`.** One case-insensitive grep for
`signout|signOut|sign-out|wyloguj` over all of `tests/` returns a single hit —
`tests/e2e/setup/auth.setup.ts:136`, asserting the "Wyloguj" button is _visible_ as proof that the
minted session is signed in. The e2e setup mints its session by driving the real `/auth/signin` form
and the teardown talks to PostgREST directly; **neither depends on the sign-out route**, and
signed-out e2e cases come from `test.use({ storageState: { cookies: [], origins: [] } })`
(`route-guard.spec.ts:70`), never from signing out.

The driving pattern, should the plan want one:

- `tests/auth/errors.test.ts` drives the real route through the Astro Container API via
  `callEndpoint` (`tests/fixtures/endpoint.ts:66-69`), which **does not follow redirects** (`:60-65`)
  — so `status` plus the raw `Location` header are directly assertable. The template case is
  `errors.test.ts:343-363`.
- `callEndpoint` **always injects a user** (`endpoint.ts:88-100`), so the signed-out branch is
  unreachable through it. `tests/validation/signed-out.test.ts:145-165` records the established
  workaround — drive `AstroContainer` directly with `locals: { user }` — mirroring `studySignedOut`
  and `generateSignedOut`.
- A body-less POST gets no `Content-Type` from the fixture (`endpoint.ts:74-80`), matching the real
  navigation.

**One stale claim to not trip over.** `playwright.config.ts:29` and
`context/archive/2026-08-08-e2e-harness-journeys/research.md:214-220` both state that
`POST /api/auth/signout` with no session answers **403** because the route "returns before touching
Supabase". The second half does not match the source — the route has no session check and no 403
branch. The 403 is almost certainly Astro's default `checkOrigin` CSRF rejection: `astro.config.mjs`
sets no `security` block, and `output: "server"` makes on-demand POSTs subject to it. That is a
real-browser/dev-server phenomenon, not a Container-API one, which is why `errors.test.ts` gets a
clean `302` out of `signin.ts` today. Worth correcting where it is cited, and worth knowing before a
manual run reads a 403 as evidence about this route's logic.

### 7. Prior art: the audit and the three siblings

**The audit has no repo artifact.** Stated three times — `context/archive/2026-08-11-sentry-monitoring/research.md:55-58`,
`:231-233`, and `context/archive/2026-08-12-bug-generation-compensation-swallowed/research.md:360-364`.
It lives in Jira (label `audit-swallowed-errors`) and in `context/foundation/jira-map.md:155-159`.
The fullest in-repo record of the hit list is `sentry-monitoring/research.md:236-242`; hit #4 reads:

> | C10X-51 | `src/pages/api/auth/signout.ts:7-9` | result of `supabase.auth.signOut()` — unconditional success redirect |

Disposition: #1 C10X-48, #2 C10X-49, #3 C10X-50 all fixed and archived (roadmap H-16/H-17/H-18, all
`done`); **#4 C10X-51 is this ticket**; #5 C10X-52 (`middleware.ts:47-50`, `getUser()`'s error read as
"not signed in") is **open, with no change folder** — and is the read-side twin of this ticket's
`null`-client branch.

**What the siblings decided about the response channel:**

- **C10X-48** and **C10X-49** used the response body alone, no Sentry. C10X-49's plan states the
  principle (`plan.md:145-148`): _"The response is the only witness. Nothing under `src/` writes a log
  line … So the copy is not cosmetics — it is the entire observability surface for this failure."_
- **C10X-50** added Sentry **and** said why the siblings did not (`research.md:575-578`): _"This is
  the first of the three where the loss is invisible to the user. Both siblings could route their new
  signal through the response body because the user was already stuck. Here the response is the wrong
  channel by default — the user is unaffected."_

**C10X-51 sits on the siblings' side of that line, not C10X-50's**: the user is directly affected and
can act (retry, close the browser, clear cookies). That argues the response/landing page is the
primary channel and Sentry is optional — see §8.

**Three transferable rules from the siblings:**

- **Detection, not repair** (C10X-49 D-01): _"hardening gives detection, not deletion"_. The analogue
  here is that the fix reports a failed sign-out; it does not force the session closed.
- **Copy is the decision, not the finishing touch** (C10X-49 D-02): a distinct literal that names the
  true state and the way out, with a load-bearing hedge, and deliberately **not** a
  `REDIRECT_MESSAGES` member when the emitter is a JSON endpoint.
- **The evidence splits and nothing bridges it** (C10X-49 D-05, C10X-50 D-07): the suite owns the
  contract, one recorded manual run owns the endpoint's use of it, and the plan says so rather than
  implying otherwise.

**If Sentry is chosen, two traps apply.** `tests/lib/audit-failure-wiring.test.ts:38-39` is hardcoded
to `src/pages/api/generate.ts`, so a capture in `signout.ts` is guarded by nothing. And
`src/lib/sentry-sampling.ts:44` samples at 10% any event that is console-stamped **and** whose message
or exception `type`/`value` matches `/@supabase\/ssr/` or `/@supabase\/auth-js/` — so a synthetic
capture message naming either package can be silently 90%-dropped. A direct `captureException`
carrying no `logger === "console"` stamp passes unsampled through the fail-open branch at `:88`.

### 8. The landing decision, laid out

This is the plan's central choice; research's job is to price it, not settle it.

**Option A — `/auth/signin?error=<AUTH_MESSAGES member>`.**
Cheapest and fights nothing: `signin.astro:8` already vouches, the set has no size pin, and it mirrors
what both sibling auth routes do. The objection is safety-shaped rather than technical: the page's
whole visual language says "you are signed out" to a user who is still signed in, and it offers no
sign-out control to retry with. On the shared computer this ticket is about, that is the most
reassuring possible thing to show the wrong person.

**Option B — `/decks?error=<new REDIRECT_MESSAGES member>` plus a page-level banner in
`decks/index.astro`.**
The page state matches reality, the "Wyloguj" button is right there in the header to retry, and —
the decisive property — **the middleware guard verifies the claim for free**: if the session really
did die (the §2.4 false-alarm class), the guard bounces the user to `/auth/signin` and the parameter
is dropped with it, so no false alarm is ever shown and no `isAuthRetryableFetchError` discrimination
is needed. Costs: one page-level render (precedented at `decks/[publicId]/index.astro:170`), a
`REDIRECT_MESSAGES` bump 11 → 12 with the docblock's "six" → "seven", and — because of §5's blind
spot — ideally widening `form-endpoint-guards.test.ts`'s root so the new member is actually enforced.

**Option C — keep `/` and register a third surface.** Effectively refused by
`error-param-guard.test.ts`'s own design (§4.2). Not recommended.

**The `null`-client branch points at `/auth/signin?error=AUTH_UNAVAILABLE_MESSAGE` under either
option**, because with no client `locals.user` is `null` and `/decks` would bounce to `/auth/signin`
anyway, dropping the message. That makes it byte-identical to `signin.ts:36` / `signup.ts:27` for the
same condition, and needs no new constant.

## Code References

Permalinks are at `65ecb47` (`origin/main`, pushed).

- [`src/pages/api/auth/signout.ts:4-10`](https://github.com/lirdaw/10xcards/blob/65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf/src/pages/api/auth/signout.ts#L4-L10) — the defect: both swallow points
- [`src/lib/supabase.ts:6-9`](https://github.com/lirdaw/10xcards/blob/65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf/src/lib/supabase.ts#L6-L9) — the only condition under which `createClient` returns `null`
- [`src/middleware.ts:55-58`](https://github.com/lirdaw/10xcards/blob/65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf/src/middleware.ts#L55-L58) — the `/` → `/decks` bounce that turns a failed sign-out into a silent round trip
- [`src/middleware.ts:7-15`](https://github.com/lirdaw/10xcards/blob/65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf/src/middleware.ts#L7-L15) — `PROTECTED_ROUTES`; `/api/auth/signout` is deliberately absent
- [`src/pages/index.astro`](https://github.com/lirdaw/10xcards/blob/65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf/src/pages/index.astro) — the redirect target; reads no request state at all
- [`src/pages/decks/index.astro:27-39`](https://github.com/lirdaw/10xcards/blob/65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf/src/pages/decks/index.astro#L27-L39) — `serverError` reaches only `CreateDeckModal`, gated on `open=create`
- [`src/pages/api/auth/signin.ts:24-46`](https://github.com/lirdaw/10xcards/blob/65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf/src/pages/api/auth/signin.ts#L24-L46) — the three-branch shape sign-out is missing
- [`src/lib/auth-errors.ts:44-95`](https://github.com/lirdaw/10xcards/blob/65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf/src/lib/auth-errors.ts#L44-L95) — `AUTH_MESSAGES`, 19 members incl. `AUTH_UNAVAILABLE_MESSAGE`
- [`src/lib/redirect-errors.ts:78-123`](https://github.com/lirdaw/10xcards/blob/65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf/src/lib/redirect-errors.ts#L78-L123) — `REDIRECT_MESSAGES`, its extension rule, and `ownedRedirectMessage`
- [`src/components/auth/ServerError.tsx:1-50`](https://github.com/lirdaw/10xcards/blob/65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf/src/components/auth/ServerError.tsx#L1-L50) — falsy → `null`; `role="alert"`; the at-mount announcement caveat
- [`src/layouts/AuthenticatedLayout.astro:21-30`](https://github.com/lirdaw/10xcards/blob/65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf/src/layouts/AuthenticatedLayout.astro#L21-L30) — the "Wyloguj" trigger beside `{user?.email}`
- [`src/lib/sentry-sampling.ts:44-95`](https://github.com/lirdaw/10xcards/blob/65ecb47fbd2d35fe86a229c1c51d054f41f6d9cf/src/lib/sentry-sampling.ts#L44-L95) — `DEPENDENCY_NOISE`; the fail-open branch a direct capture rides
- `tests/lib/error-param-guard.test.ts:82-90, 242-297` — the two registered surfaces and the catch-all that names `pages/index.astro`
- `tests/lib/form-endpoint-guards.test.ts:34, 145-161, 220-263, 301-503` — the six pinned `formData()` readers, and the `DECKS_API_DIR` scope that leaves `signout.ts` unguarded
- `tests/lib/redirect-errors.test.ts:79-95` — the size pin and its "bump it in the same commit" rationale
- `tests/fixtures/endpoint.ts:60-100` — `callEndpoint`: no redirect following, always injects a user
- `tests/validation/signed-out.test.ts:145-165` — the established way to render a route with no session
- `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:3179-3205` — `_signOut`; both early returns above `_removeSession()`
- `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:3925-3933` — the false-alarm class: cookie cleared _and_ error returned
- `node_modules/@supabase/ssr/dist/module/createServerClient.js:45-62` + `cookies.js:307-315, 348-372` — why `setAll` fires only on the `SIGNED_OUT` event

## Architecture Insights

- **A guard can double as an oracle.** `/decks` is protected, so redirecting there after a failed
  sign-out makes the middleware re-verify the session on the next hop. The design gets its own
  false-alarm suppression for free — a property worth reaching for elsewhere: _land the user on a page
  whose access rules re-assert the claim you are making about their state._
- **The message set is downstream of the landing page.** Both closed sets are defined by which page
  vouches for them, so "which set?" is unanswerable until "which page?" is settled. Two sub-reports
  reached opposite conclusions here precisely by treating the set as the primary question.
- **This project has no first-party log channel at all** (`no-logging.test.ts` walks all of `src/`),
  so for a redirect-style route the landing page _is_ the observability surface. That is why C10X-49
  called its copy the decision rather than the finishing touch.
- **A `?error=` producer under `src/pages/api/auth/` is currently unguarded** — the membership guard
  is rooted at `src/pages/api/decks`. The auth routes have stayed disciplined by convention plus
  per-case equality assertions, which is exactly the "correct on what it looks at, silent about what
  it never looks at" shape `test-plan.md` records four times.
- **`retriable` does not generalise off the JSON endpoints.** All three siblings shipped a flag that
  only means something to a React island reading a JSON body. Sign-out has no island, so the affordance
  question becomes "which page has the button", not "which flag".

## Historical Context (from prior changes)

- `context/foundation/test-plan.md:14-16` — the live carve-out: _"the one remaining discarded-result
  Supabase mutation anywhere in `src/` is `src/pages/api/auth/signout.ts:7`, carved out explicitly as
  C10X-51's"_. Repeated at `:1851-1860`, `:1914-1917`, `:5732-5738`.
- `context/archive/2026-08-13-bug-generation-failed-audit-swallowed/research.md:530-538` — the most
  complete prior statement of this defect, and the instruction that every "last of them" sentence must
  carve it out.
- `context/archive/2026-08-13-bug-generation-deck-undo-swallowed/change.md:10-71` — C10X-49's D-01
  (detection, not deletion), D-02 (distinct literal, not a `REDIRECT_MESSAGES` member), D-05 (split
  evidence), D-06 (a positive control needs its own `it()`), D-08 (open the roadmap row in Phase 1).
- `context/archive/2026-08-13-bug-generation-failed-audit-swallowed/plan.md:832-847` — C10X-50's
  decision table, incl. D-01 (both channels) and D-04 (synthetic error, fingerprinted cause).
- `context/archive/2026-08-11-sentry-monitoring/research.md:236-248` — the audit's hit table and the
  finding that `captureConsoleIntegration` captures **zero** of C10X-48…52.
- `context/archive/2026-07-30-auth-error-copy/verification.md:434` — the closest thing to a recorded
  sign-out success oracle: _"After 'Wyloguj': no `sb-` cookie, `/` served the guest landing"_.
- `context/archive/2026-07-26-srs-study-session-test/verification.md:92-96` — sign-out in a second tab
  is a live trigger for the expired-session path; the study island already answers it correctly.
- `context/foundation/jira-map.md:155-159, 193-209` — the five audit rows; C10X-51 carries epic
  **C10X-10 Foundations & Infra**, component `auth`, Fix Version Post-MVP, Priority Medium, label
  `audit-swallowed-errors`, `Change ID` empty on both sides. The file is owned by the Jira skills
  (`:3-4`, _"Do not hand-edit"_).
- `context/foundation/roadmap.md:446-456` — H-18 is the highest id, so this change is **H-19**; the
  field order and the Phase-1-not-doc-sync timing are both established (C10X-49 D-08, C10X-50 D-10).
- `context/foundation/lessons.md:243-248` — the compensating-write rule. It does **not** transfer
  verbatim: it is scoped to UPDATE/DELETE helpers and their zero-row ambiguity, whereas this defect is
  a discarded `{ error }` on a call with no legal zero-row outcome. The discriminator, per C10X-50's
  research, is _"does the statement have a legal zero-row outcome"_ — here it does not.

## Related Research

- `context/archive/2026-08-12-bug-generation-compensation-swallowed/research.md` — hit #1
- `context/archive/2026-08-13-bug-generation-deck-undo-swallowed/research.md` — hit #2
- `context/archive/2026-08-13-bug-generation-failed-audit-swallowed/research.md` — hit #3, and §8.4 of
  it is this ticket's prologue
- `context/archive/2026-08-11-sentry-monitoring/research.md` — the audit's only in-repo record
- `context/archive/2026-08-08-e2e-harness-journeys/research.md:214-220` — the 403 claim corrected in §6

## Open Questions

1. **Where does a failed sign-out land the user?** §8 prices the three options. Recommendation:
   `/decks` for the failed-`signOut` branch (the guard self-verifies the claim and the retry
   affordance is on that page), `/auth/signin?error=AUTH_UNAVAILABLE_MESSAGE` for the `null`-client
   branch. Needs a numbered decision either way, because it determines the message set, whether
   `decks/index.astro` is touched, and whether the `11 → 12` pin moves.
2. **Is Sentry in scope?** The user is affected and can act, which puts this on C10X-48/49's side of
   C10X-50's line — so the landing page may be sufficient. Against that: an unreachable GoTrue is
   exactly the kind of thing an owner wants to know about, and this is a security-adjacent event. If
   yes, note that nothing would guard the capture (§5) and that the message must not name
   `@supabase/ssr` or `@supabase/auth-js` (§7).
3. **Does the fix attempt any local remedy, or only report?** C10X-49's "detection, not deletion"
   suggests report-only. A local cookie wipe would need the internal `sb-<host>-auth-token` name and
   its chunking — precisely what `lessons.md:138-143` forbids depending on — and `scope: "local"`
   still requires the network. Recommend an explicit "report only" decision with that reasoning
   recorded, rather than silence.
4. **Should `form-endpoint-guards.test.ts`'s root widen from `src/pages/api/decks` to
   `src/pages/api`?** Cheap, and it is what makes a new `?error=` member on this route enforced rather
   than merely conventional. Scope call: arguably its own hardening ticket, but the blind spot becomes
   load-bearing the moment this change lands.
5. **How is the failure branch provoked for the manual run?** Unlike the siblings, no DCL revoke
   reaches it — GoTrue's `/logout` is not a Postgres grant. Candidates: point `SUPABASE_URL` at a dead
   port after signing in (forces `AuthRetryableFetchError`, status 0), or block the host. Needs
   settling in the plan, together with the `null`-branch provocation (unset the env after signing in)
   and the §6 warning that a browser POST may answer 403 on CSRF grounds for unrelated reasons.
6. **Does C10X-52 (`middleware.ts` `getUser()`) get pulled in?** It is the read-side twin of Swallow B
   — both make "unconfigured" look like "signed out". Recommend keeping it out and saying so, matching
   how C10X-50 carved out this ticket, but the boundary should be written down rather than assumed.
7. **Do the three sign-out triggers keep their inconsistent accessible names** ("Wyloguj" ×1, "Sign
   out" ×2)? Out of scope for the defect, but it is a live trap for any future locator, and
   `dashboard.astro` may itself be dead weight worth a separate note.
