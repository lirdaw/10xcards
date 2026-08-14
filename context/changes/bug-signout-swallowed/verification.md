# C10X-51 — verification record

Evidence for `bug-signout-swallowed`. Opened in Phase 2 because criterion 2.0 requires a
measurement recorded **before** the test that depends on it is written; Phase 5 extends it with
the manual run that reaches the failure branch in a running app.

---

## Phase 2 §0 — does a global sign-out kill the ACCESS token, or only the refresh token?

**Why this had to be measured before anything was written.** The plan leaned on this fact in two
opposite directions at once (plan-review F4). `signOut()`'s default scope is `global`
(`GoTrueClient.js:3173`) and `tests/fixtures/accounts.ts` provisions accounts A and B **once per
run**, shared across files running in parallel — from which the plan concluded a success-path test
must own its own account. Phase 2 §3 then asked the same test to assert that "the same cookie no
longer resolves a user". Supabase's documented behaviour is that a global sign-out revokes
**refresh** tokens while the **access** token stays valid until it expires — under which that
assertion fails and the shared-account hazard does not exist at all. The two claims could not both
be safe, and nothing in the plan or the research measured which held.

### Method

A throwaway ESM script against the local stack (`http://127.0.0.1:54321`), run
2026-08-14. Two accounts are provisioned through the **same** code path
`tests/fixtures/session.ts` uses — a `createServerClient` whose `getAll` returns `[]` and whose
`setAll` collects the pairs — so the captured cookie is the library's own and never hand-assembled
(`lessons.md`). One account signs out; the other is the **control** and does not, so a difference
is attributable to the sign-out rather than to elapsed time, to the probe, or to the stack.

Two readings per account, before and after:

- `GET /auth/v1/user` with the captured **access token** as a bearer — the raw question.
- the captured **Cookie header** replayed through a `createServerClient` `getUser()` — the shape
  the suite actually hands every test file.

> **Run 1 was discarded and is recorded here rather than dropped.** It probed the refresh token in
> the same before/after pair, which **rotated** it before the sign-out — so its `AFTER` refresh
> `400` could equally have meant "already used". The access-token question is the one the design
> rests on, so run 2 measures it alone and adds the control. Run 1's access-token reading (200 → 403) agreed with run 2's; it is the refresh half that was confounded.

### Result — run 2, with the control

| account                         | `GET /auth/v1/user` | captured cookie → `getUser()`        |
| ------------------------------- | ------------------- | ------------------------------------ |
| subject, **before** `signOut`   | `200`               | user                                 |
| control, **before**             | `200`               | user                                 |
| subject, **after** `signOut`    | **`403`**           | **null (`AuthSessionMissingError`)** |
| control, **after** (no signOut) | `200`               | user                                 |

`signOut()` itself returned `error: null` and staged exactly one clearing cookie:

```
[{"name":"sb-127-auth-token","value":"","maxAge":0}]
```

### Verdict, and the design branch it selects

**The access token dies with the session — immediately, not at expiry.** This is the plan's second
branch:

- **The shared-account hazard is REAL.** Signing out `accountA` or `accountB` would invalidate the
  `cookieHeader` every other file is still using, mid-run. It would surface as unrelated
  cross-file flakiness in whatever happened to be running, never as the sign-out test.
  → `tests/auth/signout.test.ts` mints its **own** account.
- **"the same cookie no longer resolves a user" IS assertable**, and is the strongest oracle
  available on this route. → kept as the closing assertion of that test.

**The account is minted inside the `it()`, not in `beforeAll` and not in globalSetup** — a
deviation from the plan's cost note, which enumerated "export `provision`, add a third `provide`,
extend the type". Only the first of those three turned out to be needed: routing the account
through `provide`/`inject` would make it injectable from every file, i.e. owned by convention
rather than owned, and would cap this file at one session-consuming case forever because the
session is minted once per run. The session is the fixture being mutated, so the case that mutates
it creates it (test-plan §6.2 / C10X-32). `provision` is now exported and carries the measurement
above in its docblock; `provisionAccounts` and the globalSetup are untouched.

**Rate-limit cost:** 2 auth requests, and only on runs that execute this file — against
`accounts.ts`'s recorded baseline of 4 per run and a 30-sign-ins / 5-min / IP ceiling. A third
globalSetup account would have billed every run instead.

### What this measurement does NOT establish

- It is one machine, one day, one local stack, at `jwt_expiry = 3600`. Cloud GoTrue is not
  observed here, and neither is any other scope — `scope: "local"` and `scope: "others"` were not
  measured, because this route calls neither.
- The `403` is GoTrue's answer to a revoked session; nothing here inspects **how** it is revoked,
  and no claim is made that a JWT-signature-only verifier (one that never asks GoTrue) would also
  reject that token. Every read path in this app goes through `getUser()`, which does ask.

---

## Phase 2 — automated criteria, as run

All against the local stack, `OPENROUTER_API_KEY` unset, 2026-08-14.

| criterion                     | result                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| 2.1 `npm run typecheck`       | exit 0 — `Result (157 files): 0 errors, 0 warnings`                                      |
| 2.2 `npm run lint`            | exit 0 — 3 warnings, all pre-existing `no-console` in `evals/generation-quality.eval.ts` |
| 2.3 `npm test` ×3 fresh seeds | **477/477, 40 files** green on seeds `1786692511730`, `1786692524651`, `1786692537691`   |
| 2.4 `npm run e2e`             | **12 passed** — see the cold-cache note below                                            |

**Suite delta measured by running, never by arithmetic** (the trap §8 records against C10X-39,
C10X-40, C10X-46 and C10X-48): `npx vitest run --exclude tests/auth/signout.test.ts` reports
**476/476, 39 files**, and the new file alone reports **1/1**. So 476/39 → 477/40, +1 case in +1
file. The two fixture edits (`provision` exported, `stagedCookies` added) add no case.

**The e2e layer went red on its first run and it was the documented flake, reproduced rather than
inferred.** Freeing port 4321 meant stopping a stale `astro dev` (PID 49928, running since
2026-08-13 20:07), so the next run started against a **cold Vite dependency cache** — the exact
condition test-plan §6.6's C10X-46 entry measures at four reds in ten runs. Run 1: **1 failed / 11
passed**, the failure in `accepted-card-survives-reload.spec.ts:160` on the `toPass` that waits for
`GeneratorForm` to hydrate (`Timeout 15000ms exceeded while waiting on the predicate`). Run 2, warm
cache: **12 passed (20.9s)**. Attribution: the failing spec drives generation and acceptance and
never touches sign-out — the e2e layer's only sign-out contact is `auth.setup.ts` asserting the
"Wyloguj" button EXISTS, and it never clicks it.

### Falsifiability of the new test

`tests/auth/signout.test.ts` was shown able to go red, because a success-path test on a route whose
refusal is **also** a `302` proves nothing on its status (test-plan §6.10).

| neuter                                                                                                                     | observed                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `const { error } = await supabase.auth.signOut()` → `const error = null` (the route redirects without ever calling GoTrue) | **1 of 1 red** on `expected 0 to be greater than 0` at the staged-cookie assertion — **while the `302` and the `Location: /` assertions stayed green** |

That green pair is the evidence, not a footnote: the redirect is byte-identical whether or not
anything was signed out, so the two oracles (the staged clearing cookie, and the cookie no longer
resolving a user) are the whole test. Route restored and the restore verified by hash —
`md5 5f6b0700e9053335a3b22c4a9f84e05c` before and after, `git diff -- src/` showing only the
intended Phase 2 diff.

**One assertion had to be rewritten because the first version was measured wrong, and the reason
is worth carrying.** `response.headers.getSetCookie()` returns `[]` for a cookie an endpoint
genuinely staged: Astro carries `context.cookies` on the response under
`Symbol.for("astro.cookies")` and only the **app/adapter** layer materialises them into real
headers (`dist/core/app/prepare-response.js`), which the Container API never runs. Measured — the
carried cookies held `sb-127-auth-token=; Max-Age=0; Path=/; SameSite=Lax` while `getSetCookie()`
was empty. Read through `stagedCookies()` in `tests/fixtures/endpoint.ts`, which delegates to
Astro's own public accessor `App.getSetCookieFromResponse` rather than reading the symbol by hand
— a renamed internal symbol would otherwise report "no cookie staged", which is indistinguishable
from the defect. The fixture header now records this as its third numbered gotcha.

### Phase 2 manual criteria — browser run, 2026-08-14

`npm run dev` on `localhost:4321` against the local stack, Chrome, a throwaway account
(`manual-c10x51-1786692936@example.com`) created for this run and used for nothing else.

**A note on the oracle, because the obvious one is wrong on this surface.** An ordinary signed-out
load of `/auth/signin` already carries **one** `[role="alert"]` — the OpenRouter
mock-mode configuration banner, which is a `requiresSession: false` entry and therefore renders in
both session states. So "no banner" cannot be `document.querySelector('[role="alert"]') === null`;
every count below is scoped to the `ServerError` node specifically (`p[role="alert"]` carrying
`bg-red-900/30`). This is the same trap test-plan §6.6's C10X-37 entry records for the deck page,
met here on a second surface.

**2.6 / 2.7 — measured SERVER-SIDE with `curl`, not in the DOM, and that matters.** The sign-in
island strips `?error=` from the URL on mount (`history.replaceState`), so `location.search` reads
empty either way and a DOM-only check cannot tell "the parameter was rejected" from "the parameter
was cleaned up". Four `curl`s against the running dev server, counting the rendered banner in the
HTML before any JS runs:

| `?error=` value                             | server-rendered `ServerError` banners |
| ------------------------------------------- | ------------------------------------- |
| _(absent — ordinary load)_                  | **0**                                 |
| exact `SIGNOUT_FAILED_MESSAGE`              | **1** ← positive control              |
| `dowolny tekst`                             | **0**                                 |
| `SIGNOUT_FAILED_MESSAGE` + ` Kliknij tutaj` | **0**                                 |

The second row is what makes the other three mean anything: without it, three zeros are equally
satisfied by a page that never renders a banner at all. The fourth row is the attack the closed set
actually exists for — appending to copy the user already trusts, which any containment check would
wave through and which `ownedAuthMessage`'s equality check rejects (test-plan §6.3).

In the DOM, the valid-member case exposes the node as an **alert** in the accessibility tree (found
by role, not by CSS: `alert "Wylogowanie nie powiodło się — Twoja sesja nadal jest aktywna…"`),
with the full copy intact and rendered inside the sign-in card. Announcement is **not** claimed —
this is an at-mount live region, the weak case `ServerError.tsx`'s own comment refuses to overclaim.

**2.5 — a real sign-out through the UI**, cookie NAMES counted only (values never read):

| step                        | path           | `sb-` cookies | note                                         |
| --------------------------- | -------------- | ------------- | -------------------------------------------- |
| signed in                   | `/decks`       | **1**         | header shows the account e-mail              |
| after clicking "Wyloguj"    | `/`            | **0**         | title `10xCards`, no "Wyloguj", no `?error=` |
| then navigating to `/decks` | `/auth/signin` | **0**         | independent check, see below                 |

Two independent facts, not one. Landing on `/` and **staying** there is itself evidence the session
is gone — `src/middleware.ts` bounces an authenticated visitor from `/` to `/decks`, which is the
very mechanism that made the original defect a silent round trip. And `/decks` afterwards redirects
to `/auth/signin`, so the guard agrees. Neither reading depends on the cookie count, which is why
the cookie count is the third leg rather than the only one.

**What this run does NOT cover, deliberately:** the two failure branches. `unconfigured` and
`failed` cannot be provoked by clicking — they need the env or GoTrue broken — and reaching them in
a running app is Phase 5's recorded manual run, with its one-variable control. Everything above is
the SUCCESS path plus the landing page's rendering contract.

---

## Phase 3 — the `?error=` guard blind spot, as run

**Date**: 2026-08-14. All figures below were obtained by RUNNING, never by arithmetic; where a
floor is quoted, the measurement that produced it is quoted with it.

### The plan's Phase 3 could not be implemented as written, and the mismatch was measured first

The plan required the surface table with "`ownedNames` takes the module specifier as a parameter;
**nothing else in `rejection()` changes**". Running the guard's own `rejection()` logic verbatim
against `src/pages/api/auth/signout.ts`, keyed on `@/lib/auth-errors`, BEFORE any edit:

```
owned names: []
77: encodeURIComponent(message)
    -> `message` is neither imported from the closed set nor declared here
```

i.e. registering the file under the untouched rules turns the guard **red on correct code**. The
cause is Phase 2's shape: `const { path, message } = signOutLanding(outcome);` is neither an import
nor a `const <name> = …;`, and `localDeclarations` matches only the latter.

The same probe reproduced the plan's own rejection table for `signin.ts`/`signup.ts` exactly — four
refused, two accepted — so the table was right; it simply did not anticipate that this ticket's own
producer needs a third exemption of its own. Resolution chosen (user decision, 2026-08-14): a
**declared per-surface** exemption, `decisionBoundNames`. Its narrowness, its controls and the
claim it borrows are documented at the site and in
`follow-ups/error-param-guard-auth-routes.md`.

> Note on the probe itself: its first two runs reported `owned names: []` for `signin.ts` too,
> which would have made the plan's table look wrong. That was the harness, not the guard — Git Bash
> MSYS path conversion rewrote the argv `@/lib/auth-errors` into
> `@C:/Program Files/Git/lib/auth-errors`. Re-run under `MSYS_NO_PATHCONV=1` it agrees with the
> plan. Recorded because a measurement that contradicts a written claim is worth doubting twice.

### Floors, re-measured rather than scaled

Each measured by temporarily asserting `toBe(-1)` and reading the reported actual, then restoring:

| floor                            | before (deck subtree) | measured now | composition                |
| -------------------------------- | --------------------- | ------------ | -------------------------- |
| scanned files                    | ≥ 6                   | **8**        | 7 deck + 1 sign-out        |
| total emissions                  | ≥ 29                  | **30**       | 29 deck + 1 sign-out       |
| producing files                  | ≥ 6                   | **7**        | 6 deck + 1 sign-out        |
| `emissionCount(auth/signout.ts)` | —                     | **1**        | the line this ticket added |

That last row is what evidences criterion **3.5 numerically instead of by assertion**: sign-out
contributes exactly one emission, so the deck subtree's own figures are 30 − 1 = 29 and 7 − 1 = 6 —
both unchanged. The deck surface declares no `decisionModule`, so `decisionBoundNames` returns an
empty set there and its verdicts are byte-identical by construction as well.

### Breakage runs

`src/pages/api/auth/signout.ts` hashed before the first edit: `5f6b0700e9053335a3b22c4a9f84e05c`.

| #   | neuter                                                 | observed                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.2 | the emitted value replaced by an inline literal        | **2 of 11 red** — `interpolates only identifiers` on `auth/signout.ts:77: … encodeURIComponent("Nie udało się wylogować")`, and `emits only values …` on `auth/signout.ts:77: not an identifier: "Nie udało się wylogować"` |
| 3.3 | a `REDIRECT_MESSAGES` member emitted from `signout.ts` | **1 of 11 red** — `emits only values …` on ``auth/signout.ts:78: `DECK_CREATE_FAILED_MESSAGE` is neither imported from the closed set nor declared here``                                                                   |

**3.2 came back redder than predicted and it is recorded as observed**: the plan said "turns this
guard red", singular; both `?error=` sweeps catch it, on different assertions, because an inline
literal is simultaneously an inline literal and a non-identifier.

**3.3's failure STRING is the evidence, not its colour.** `DECK_CREATE_FAILED_MESSAGE` _is_
imported by the file under that neuter — just from `@/lib/redirect-errors`, which is not the
sign-out surface's vouching module. A table that vouched for the union of both closed sets would
have accepted it silently. Note also which sweep stayed **green**: the inline-literal sweep (it is
not a literal) and the vocabulary check (the owned imports are still there) — so the reds are
attributable to per-surface keying and to nothing else.

Restore after each: `git checkout -- src/pages/api/auth/signout.ts`, hash re-read as
`5f6b0700e9053335a3b22c4a9f84e05c` (identical), `git diff --stat -- src/` empty.

### The exemption's own falsifiability

`decisionBoundNames` gets a control of its own rather than being trusted, because an exemption
nobody can turn red is a hole with a docblock. It asserts, over a fabricated source: the binding is
vouched for only when the call is to a function imported from the surface's **declared** decision
module; the same name bound from any other call keeps its old verdict (`neither imported`); a
member access off the binding is still refused (the exemption sits after the identifier test); and
a surface declaring no decision module opts into nothing.

### Suite

| criterion                                           | result                                                                                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 `npm test`                                      | **478/478, 40 files** green (Phase 2 closed at 477/40; +1 is this phase's exemption control, measured in-file at 11 cases, up from 10)                          |
| 3.4 the detector's four existing rejection controls | untouched and green — the `it()` was not edited, and `rejection()` gained a defaulted fourth parameter precisely so its existing call sites stay byte-identical |
| type gate                                           | `npm run typecheck` OK, **157 files**, 0 errors 0 warnings                                                                                                      |
| lint                                                | `npm run lint` 0 errors, the same **3** pre-existing `no-console` warnings in `evals/generation-quality.eval.ts`                                                |

### What Phase 3 does NOT prove

`signin.ts` and `signup.ts` remain outside the membership sweep — a written gap with its evidence
attached (`follow-ups/error-param-guard-auth-routes.md`), not an unstated one. And the sweeps stay
TEXTUAL: the known per-line limitation this guard's own comment records (a call Prettier has broken
across lines is unexamined rather than rejected) is unchanged by this phase.

### Phase 3 manual criteria — 2026-08-14

**3.6 — the floors were obtained by running, and they sit AT the measured value.** Two probes,
because "measured" and "not slack below the measurement" are different claims and only the second
is what C10X-40 F3 asks for. Guard file hashed `9313a0d0a464c2c4a807d33d61e13d7a` before and after
every probe; the file was restored from a copy each time, not edited back by hand.

Each floor raised by exactly one:

| floor           | at measured + 1                             |
| --------------- | ------------------------------------------- |
| scanned files   | **1 of 11 red** — `expected 8 to be >= 9`   |
| total emissions | **1 of 11 red** — `expected 30 to be >= 31` |
| producing files | **1 of 11 red** — `expected 7 to be >= 8`   |

…and the shrink direction, which is the silent one: **deleting the `sign-out` row from
`ERROR_PARAM_SURFACES`** goes **2 of 11 red**, `expected 7 to be >= 8` and
`expected 29 to be >= 30`.

That second probe is worth more than the floors it was run for. Without the row the walker reports
exactly **7 files / 29 emissions** — the deck-only figures as they stood before this phase. So
criterion **3.5 is measured in both directions** rather than obtained by subtracting: the deck
subtree's numbers are what they always were, and the one emission the table's second row adds is
this ticket's own.

**3.7 — the SCOPE comment and the follow-up.** The comment now states the split per describe (the
`formData()` sweep covers `src/pages/api/` entire; the two `?error=` sweeps cover the registered
surfaces) and names `signin.ts`/`signup.ts` as a deliberate, MEASURED exclusion rather than an
omission. `context/changes/bug-signout-swallowed/follow-ups/error-param-guard-auth-routes.md`
exists, carries the four rejection verdicts, the two exemptions a widening would need, and the
third exemption this phase did take — and the guard file points at it by path from the surface
table's docblock, so a reader who meets the table finds the gap without knowing to look for it.
