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

**A note on the oracle, because the obvious one is wrong on this surface.** A page in this app can
carry a second `[role="alert"]` — a configuration banner — so "no banner" cannot be
`document.querySelector('[role="alert"]') === null`; every count below is scoped to the
`ServerError` node specifically (`p[role="alert"]` carrying `bg-red-900/30`). This is the same trap
test-plan §6.6's C10X-37 entry records for the deck page, met here on a second surface.

> **Corrected 2026-08-14 by the Phase 5 browser run — the REASON above was wrong, in the
> reassuring direction, and the practice it argues for is right.** This paragraph originally read
> "an ordinary signed-out load of `/auth/signin` already carries one `[role="alert"]` — the
> OpenRouter mock-mode configuration banner, which is a `requiresSession: false` entry and
> therefore renders in both session states". The OpenRouter entry is `requiresSession: **true**`
> (`src/lib/config-status.ts:46`), so a signed-out `/auth/signin` carries **zero** alerts, which
> the browser run then measured directly (krok 6: `?error=dowolny+tekst` → `alerts: []`). What
> misled the Phase 2 reading is that a successful sign-up leaves a session, so every `/auth/*` page
> visited straight afterwards _is_ a signed-in load. The scoped oracle stands and the trap is real
> — it bites on `/decks` (measured: two alerts, config + none-or-error) and on the
> **unconfigured** landing, where the SUPABASE entry appears beside the `ServerError` because that
> one genuinely is `requiresSession: false`, by the deliberate design its own doc comment
> explains: with Supabase down nobody is ever signed in, so gating it would hide the banner that
> explains the breakage. Recorded rather than silently fixed — a wrong mechanism written up as
> fact is the class `lessons.md` keeps naming.

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

---

## Phase 4 — the Sentry channel's guard, RE-EXECUTED 2026-08-14

**Read the label before the table.** Phase 4's criteria 4.3-4.5 were checked off when that phase
shipped and their observed strings were written down **nowhere** — this file stopped at Phase 3.
Rather than reconstruct splits nobody recorded, the three neuters were **re-run against the tree as
it now stands**, at the start of Phase 5. That is the C10X-46 precedent verbatim (test-plan §6.6 re-
executed eight criteria for the same reason, and labelled them the same way). So this section is
evidence that the guard **can go red today**; it is not a record of what was seen on the day Phase 4
landed, and it must not be cited as one.

Baseline, and every denominator below is this: `npx vitest run tests/lib/sentry-capture-wiring.test.ts`
→ **17 passed (17)**. Composition read from `--reporter=verbose` rather than counted by hand: **6**
`it()`s scoped to `src/pages/api/generate.ts`, **6** to `src/pages/api/auth/signout.ts` (the
`describe.each` row this ticket added), **3** detector controls over fabricated strings, **2** in the
catch-all. Files hashed before the first edit: `signout.ts` `83c26831bcab5efe55dadb38140f56f0`,
`middleware.ts` `2117332b09665068d3b93188ce2383aa`.

| #   | neuter                                                                                       | observed                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.3 | the whole `if (capture …)` block deleted from `signout.ts`                                   | **1 of 17 red**, and the describe names the target: `'src/pages/api/auth/signout.ts' … > captures on exactly 1 statement(s), and all call the builder` — `expected [] to have a length of 1 but got +0`            |
| 4.4 | `new Error(SIGNOUT_CAPTURE_MESSAGE)` → `outcome.cause` as the first argument                 | **1 of 17 red**, `passes a synthetic Error as the first argument, never the failure itself`, naming file and line: `src/pages/api/auth/signout.ts:107: Sentry.captureException(outcome.cause, await buildSignOut…` |
| 4.5 | `Sentry.captureException(new Error("C10X51-PLANTED-CATCHALL-PROBE"))` in `src/middleware.ts` | **1 of 17 red**, `no unregistered file under src/ captures to Sentry > finds no Sentry.captureException outside the registered targets`, naming `src/middleware.ts:44`                                             |

**4.4's green is the half that matters, and it reproduces C10X-50's B4 pair one route over.** Under
that neuter the delegation assertion (`captures on exactly 1 statement(s), and all call the builder`)
stayed **green** — the statement still calls `buildSignOutFailureReport`, it just hands the raw
`AuthError` to the argument no builder can reach. So the synthetic-first-argument rule is proved
**not** to be carried incidentally by the delegation rule; they are two rules and each needs its own.

**4.3 also exercised the `lineFloor` slack as designed rather than by luck.** Deleting three lines
left `signout.ts` above its floor of 30 (measured 35), so the read-the-real-handler control stayed
green and the red is attributable to the count assertion alone — which is exactly the trade that
field's docblock argues for, met by the neuter it was written against.

**4.5 is honest about what it caught.** `middleware.ts` imports no Sentry namespace, so the planted
line would not have compiled; the guard is TEXTUAL and reported it anyway. That is the claim — every
file under `src/` is _inspected_, not merely the two registered ones — and the neuter is a probe of
the walker's reach rather than of a realistic edit.

**Restores, proved rather than remembered.** After each run the edit was reverted and the file
re-hashed: `signout.ts` back to `83c26831bcab5efe55dadb38140f56f0`, `middleware.ts` back to
`2117332b09665068d3b93188ce2383aa`, `git diff --stat -- src/` **empty**, and the guard re-run
**17 passed (17)**.

**4.6, re-measured rather than carried over — and the plan's own number is superseded.** The plan
predicted "seven `it()`s, of which six assert about `generate.ts` and one is the detector's own
positive control", flagging it as a figure to re-measure. It was the pre-rewrite file's shape. The
rewritten guard runs **17**, and `generate.ts`'s six claims are all present and green by name:
`reads the real handler (334 code lines, 2026-08-14)`, `joins each capture into a terminated
statement`, `imports the builder from @/lib/audit-failure-report`, `captures on exactly 2
statement(s), and all call the builder`, `passes a synthetic Error as the first argument`, and
`names no content field on any capture statement`. The detector control grew from one `it()` to
**three**, the third being the sign-out row's own — `message` is a common English word where
`generate.ts`'s five content fields are column names, so a shipped line naming
`SIGNOUT_CAPTURE_MESSAGE` had to be shown NOT to trip it.

---

## Phase 5 — the failure branch, reached in a running app

**Date**: 2026-08-14. `npm run dev` on `localhost:4321` against the local stack, driven with `curl`
against the running server. A throwaway account created for this run and used for nothing else:
`manual-c10x51-p5-1786703279@example.com` — left in the local dev DB as the artifact of record,
the C10X-49 precedent for its two orphan decks.

### Why `curl` and not a click, and it is a measurement rather than a convenience

The plan says "click Wyloguj". **In the state this run has to reach, no page renders that button** —
measured, not assumed: with GoTrue unreachable the middleware's own `getUser()` fails, `locals.user`
is `null`, and `/auth/signin` (the only page a signed-out visitor can hold) contains **0**
occurrences of `Wyloguj`. A click is structurally impossible there, which is a property of the
defect's own failure class and not of the harness.

So the POST is issued directly — and it is the **same** request the button submits. All three
triggers are `<form method="POST" action="/api/auth/signout">` carrying **no fields at all**
(`AuthenticatedLayout.astro:25`, `Topbar.astro:16`, `dashboard.astro:17`), so a same-origin,
form-content-type POST with an empty body is byte-equivalent to the submit.

**And research §6's `checkOrigin` caution is settled by measurement instead of inherited.** Three
POSTs to this route, differing only in headers:

| request shape                                       | status                                            |
| --------------------------------------------------- | ------------------------------------------------- |
| `Origin: http://localhost:4321` + form content-type | **302** — the route's own answer, no CSRF refusal |
| form content-type, **no** `Origin`                  | **403**                                           |
| `Origin: http://evil.example` + form content-type   | **403**                                           |

The 403 research warned about is real and is **not** the browser's shape: a real form submit always
carries a same-origin `Origin`. Rows two and three are what make row one mean something — without
them a 302 is equally compatible with `checkOrigin` being off entirely.

### The run, in the order the plan fixes and for the reason it fixes it

Sequencing is load-bearing: "still alive" cannot be shown while the port is dead, because nothing can
resolve a user then.

| #   | state                                        | request                        | observed                                                                            |
| --- | -------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| 1   | signed in, stack live                        | `GET /decks`                   | `200`, the account e-mail rendered in the page                                      |
| 2   | signed in, stack live                        | `GET /`                        | `302 → /decks` — the middleware bounce, i.e. `locals.user` is set                   |
| 3   | `SUPABASE_URL` → `127.0.0.1:54399` (dead)    | `GET /decks`                   | `302 → /auth/signin` — **the F1 mechanism, live**                                   |
| 4   | dead port                                    | `GET /`                        | `200` — the guest landing, no bounce                                                |
| 5   | dead port                                    | `GET /auth/signin`             | `Wyloguj` occurrences: **0**                                                        |
| 6   | dead port                                    | **`POST /api/auth/signout`**   | `302 → /auth/signin?error=<SIGNOUT_FAILED_MESSAGE>`, **and no `Set-Cookie` at all** |
| 7   | dead port                                    | `GET` that redirect target     | **1** `ServerError` banner carrying the copy (`bg-red-900/30`, `role="alert"`)      |
| 8   | dead port                                    | `GET /auth/signin` (ordinary)  | **0** `ServerError` banners                                                         |
| 9   | port restored, **no re-sign-in**             | `GET /decks` with the same jar | **`200`, e-mail rendered** — the session survived                                   |
| 10  | port restored, no re-sign-in                 | `GET /`                        | `302 → /decks` — the middleware agrees                                              |
| 11  | port restored — **the one-variable control** | `POST /api/auth/signout`       | `302 → /`, `set-cookie: sb-127-auth-token=…; Max-Age=0; Path=/; SameSite=Lax`       |
| 12  | after the control                            | `GET /decks` / `GET /`         | `302 → /auth/signin` / `200` — the session is genuinely gone                        |
| 13  | `SUPABASE_URL`+`SUPABASE_KEY` commented out  | `POST /api/auth/signout`       | `302 → /auth/signin?error=<AUTH_UNAVAILABLE_MESSAGE>`, banner **1** on that landing |

**Row 9 is the claim the whole ticket rests on**, and it is three readings rather than one: the same
cookie that had just been "signed out" lands in `/decks` with a `200`, the account e-mail is rendered
there, and `/` bounces back into the app. Row 6's **absent `Set-Cookie`** is the mechanism behind it,
observed on the wire: both `return { error }` statements in `_signOut` sit above the
`_removeSession()` that clears the cookie, so on the transport-failure class nothing is revoked and
nothing is cleared. That is research §2.2 confirmed against a running app rather than read out of
`GoTrueClient.js`.

**Row 11 is the control the C10X-29 unfalsifiable-rehearsal class demands.** Exactly one variable
differs from row 6 — the Supabase port — and it produces the ordinary success: `/`, a clearing
cookie, and a session that is afterwards provably gone (row 12). Without it, a message that fires on
every sign-out is indistinguishable from one that fires on the right sign-out.

**Row 3 is the evidence for plan-review F1, and it is why this run could show a banner at all.** The
same env change that breaks `signOut()` breaks the client the middleware reads the session with, so
`locals.user` is `null` on the very next hop. Under the plan's original `/decks` landing, the
redirect this route emits would have been bounced by `PROTECTED_ROUTES` to `/auth/signin` **with the
`?error=` dropped** — the user would have met the sign-in page with no message over a live session,
which is the original defect wearing a different landing page. Landing on `/auth/signin` is what
makes rows 6-7 possible; F1 is therefore measured here, not merely argued in review.

### The same six steps, driven in a REAL BROWSER — 2026-08-14

The `curl` run above is complete on its own and is the reproducible record. It was then repeated
in Chrome against the same dev server, for the one thing `curl` structurally cannot do: **click the
actual "Wyloguj" button**. A throwaway account created for it and used for nothing else,
`manual-c10x51-browser-1786704600@example.com`.

**The trick that makes step 2 performable as the plan words it.** With GoTrue unreachable no page
RENDERS the button — that is measured above and it is why the `curl` run exists. But a page
**already rendered while the stack was healthy** still has the button in its DOM, and that is the
realistic user scenario: the app worked, then the backend went away, then they clicked. So the tab
is left on `/decks` and the dev server is restarted underneath it.

| step | state                                        | action                                  | observed                                                                                                                                         |
| ---- | -------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | stack live                                   | sign in through the real form           | `/decks`, `title: Talie`, account e-mail in the header, **1** sign-out form, button labelled `Wyloguj`                                           |
| 2    | `SUPABASE_URL` → dead port, tab NOT reloaded | **click "Wyloguj"**                     | `/auth/signin`, banner text = `SIGNOUT_FAILED_MESSAGE` **in full**, and `sb-127-auth-token` **still in `document.cookie`**                       |
| 3    | port restored, **no re-sign-in**             | load `/decks`                           | `title: Talie`, e-mail rendered, sign-out form back — **the session survived**                                                                   |
| 4    | port restored — **the one-variable control** | **click "Wyloguj"**                     | `/`, `h1: 10xCards`, `sbCookies: []`, no "Wyloguj", no alerts — and it **stayed** on `/` rather than bouncing to `/decks`                        |
| 5    | `SUPABASE_URL`+`SUPABASE_KEY` commented out  | **click "Wyloguj"**                     | `/auth/signin` carrying `AUTH_UNAVAILABLE_MESSAGE`, **beside** the Supabase config banner; cookie untouched (no client, no request, no clearing) |
| 6    | stack live, signed out                       | load `/auth/signin?error=dowolny+tekst` | **`alerts: []`**, the text nowhere in the page, and the URL reads `/auth/signin` after mount                                                     |

**Step 2 is the strongest single observation in this change.** The banner and the live session cookie
are visible in the same DOM read: the app says the sign-out failed, and the thing it says is still
there, is still there. Screenshot: `C:\Users\lirda\AppData\Local\Temp\claude-chrome-screenshots-2dDbE5\screenshot-1786704756494-5.jpg`.

**Step 6 closes something §7 lists as unobserved.** "Nothing observes the URL cleanup
automatically" — still true of the suite, but the island's `history.replaceState` strip was watched
here directly: `?error=dowolny+tekst` went in and `location.href` read `/auth/signin` after mount,
with no banner. That is also why Phase 2 measured the banner server-side with `curl`: in the DOM
alone, "rejected" and "cleaned up" look identical.

**Step 5 confirmed a design decision rather than only a branch.** The **Supabase** config banner
renders beside the error, because that entry is `requiresSession: false` by deliberate design
(`config-status.ts:20-24`): with Supabase down nobody is ever signed in, so gating it would hide
the one banner explaining the breakage. Two `[role="alert"]` nodes on that landing — a third page
state where the unscoped-selector trap bites.

**One methodological note, stated because it is a weaker gesture than the others.** Steps 2 and 4
are physical clicks at the button's screen coordinates. In step 5 the bridge stopped delivering
them (three attempts, no submit), so the button was activated with its own `click()` — still the
real button and still the native form POST with the browser's own `Origin`, but not a synthetic
mouse event. Recorded rather than glossed: the physical-click path is evidenced twice, and step 5's
outcome matches the `curl` run's row 13 exactly.

> **A second attempt to upgrade step 5's gesture was made and FAILED, recorded because a silent
> retry is how an unproven claim becomes an assumed one.** A fresh tab and a fresh dev server were
> stood up specifically to redo step 5 with a physical click. Neither a coordinate click (two
> attempts, target confirmed at viewport `(1458, 83)` by `getBoundingClientRect`) nor a keyboard
> activation (`focus()` verified as `document.activeElement`, then a real `Return` keypress) was
> delivered to the page — the input tool reported success each time and the DOM never changed.
> Cause not diagnosed; it is a property of this automation bridge, not of the app. **The claim is
> unaffected**: step 5 is proved twice already, by the `curl` run's row 13 and by the button's own
> `click()`, and both agree. The attempt is logged so the next person does not read "physical click
> on all six steps" into this section.
>
> **It did produce one piece of genuinely new evidence, incidentally.** The fresh tab still carried
> `sb-127-auth-token` from the earlier unconfigured sign-out, and against a healthy stack it
> resolved a user: `/decks` rendered with the account e-mail. So the `unconfigured` branch's
> **"detects, does not clear"** property is confirmed on a second occasion, hours later, on a
> session it never touched. And it is a third independent confirmation of the `requiresSession`
> correction above — that `/auth/signin` load showed the OpenRouter banner precisely because the
> stale cookie made it a SIGNED-IN load, which is the exact confusion that produced the original
> false note.

**Restore**: `.env` copied back from the byte backup, MD5 `d56648ca7e65776ccf80bdd31f4dbc32` —
identical to pristine — no `C10X51` marker left, dev server stopped, browser tab closed.

### What this run does NOT prove

- **Nothing about Sentry delivery.** `npm run dev` never loads `src/worker.ts`, so no DSN is
  configured and `captureException` is the no-op that returns an event id — the same state the test
  runner is in, and the same boundary C10X-50 recorded for its own two manual runs. That every
  provoked request answered `302` rather than an uncaught framework `500` is incidental evidence the
  capture statement does not throw; it is **not** evidence an event arrived anywhere. The debt has an
  owner: `context/archive/2026-08-13-bug-generation-failed-audit-swallowed/follow-ups/sentry-delivery.md`.
- **One machine, one day, one local stack.** The `failed` branch was provoked by one class only — a
  dead port, i.e. `AuthRetryableFetchError` at status 0. The 500/429 classes research §2.2 groups
  with it were not provoked separately; they reach the same `if (error)` and are covered by the truth
  table, not by this run.
- **The `curl` half drove no browser**, deliberately: the banner is measured server-side, in the
  HTML before any JS runs, because the sign-in island strips `?error=` on mount and a DOM-only
  check cannot tell rejection from cleanup. The browser section above then covers what that cannot
  — a real click on the real button — and the two agree row for row. Neither claims announcement by
  a screen reader; the accessibility-tree observation is Phase 2's and stands unextended.

### Every env change restored, and the restore PROVED — including one that was not

`.env` was hashed `d56648ca7e65776ccf80bdd31f4dbc32` and copied to a pristine backup before the
first edit, then restored from that backup and re-hashed: **identical**. No `C10X51` marker remains
in it, and a tree-wide grep for `C10X51-TEMP` / `C10X51-PLANTED` over `src/`, `tests/` and this
change folder returns nothing. `git status --porcelain -uall` afterwards lists only
`context/changes/bug-signout-swallowed/plan.md` — Phase 4's own SHA write-back.

**One restore attempt failed the hash while reading correct, and it is recorded because it is the
whole reason this project verifies restores instead of remembering them.** Putting the port back with
a regex (`(?m)^SUPABASE_URL=.*$`) produced a file whose `SUPABASE_URL` line read exactly right and
whose hash was `02091b7b741c842929e353ae88dbd689` — .NET's `.` consumes the `\r`, so that one line
came back LF where the rest of the file is CRLF. A restore checked by reading the value back would
have passed. It was redone from the byte copy.

**Two things left in the local dev DB on purpose**: the throwaway account above, and Phase 2's
(`manual-c10x51-1786692936@example.com`). Neither owns a row in any table this project writes.

---

## Phase 5 — doc-sync, per site and per classification

### 5.9 — the four carve-out sites, resolved by HEADING and classified

Every one was located by walking up to its enclosing heading rather than by the line number the
plan carried, and **every one of those numbers had already moved** — which is the trap the plan
predicted. The `:7` inside the claims themselves was stale too: this change's own comments push the
call site well past line 7.

| site (by heading)                                             | kind                                  | treatment                                                                                |
| ------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Header block, `Last updated: 2026-08-13 (C10X-50 …)`          | dated entry, demoted to `Previously:` | **dated correction** appended inside it; a new `Last updated: 2026-08-14` entry above it |
| §6.6 › `Corrected 2026-08-13 (C10X-50 …)` (the C10X-48 chain) | dated correction block                | **dated correction** — a FOURTH line on the same original sentence                       |
| §6.6 › `Extended 2026-08-13 (C10X-50 …)`                      | dated entry                           | **dated correction** nested under the parenthesis it falsifies                           |
| §8 › C10X-50's `Still open after this entry, deliberately`    | dated ledger bullet                   | **dated correction**, scoped to the FIRST item — the other three are still open          |

Zero of the four were rewritten. All four are dated snapshots, so none qualified as a live
declaration — the split `lessons.md` states as a rule, applied here without an exception.

### The renamed guard's pointers — three repointed, five deliberately not

Enumerated by `grep` at doc-sync rather than worked from the plan's list, per its own instruction.
The plan's list of eight was **correct** and is reproduced by the grep.

| site                                      | kind         | treatment                                                                    |
| ----------------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `src/worker.ts`                           | live comment | **repointed**, plus its `context/changes/…` `sentry-delivery.md` path        |
| `src/pages/api/generate.ts`               | live comment | **repointed**, plus a note on what the generalisation did and did not change |
| `tests/lib/audit-failure-report.test.ts`  | live comment | **repointed**, plus a note that its own scope did NOT widen                  |
| `test-plan.md` header (now `Previously:`) | dated        | left verbatim                                                                |
| `test-plan.md` §6.6 claims table          | dated        | left verbatim                                                                |
| `test-plan.md` §6.6 suite-count breakdown | dated        | left verbatim                                                                |
| `test-plan.md` §7                         | dated note   | left verbatim, **dated note appended** covering both stale pointers          |
| `test-plan.md` §8 ledger                  | dated        | left verbatim                                                                |

**This is a deviation from the plan's wording and it is deliberate.** Phase 5 §3 said "repoint the
path; do not rewrite the dated claims around it". In the five `test-plan.md` sites the path is not
_around_ the claim — it is _inside_ it: "+7 in the new `tests/lib/audit-failure-wiring.test.ts`" is
a measurement made under that name, and repointing it would assert that a file called
`sentry-capture-wiring.test.ts` was new on 2026-08-13 and ran 7 cases, neither of which is true.
So the rename is recorded **once**, in §6.6's new entry and again in §7 where a live reader meets
it, and the dated figures stand. The three code comments carry no date and are pure rot, so they
were repointed.

**Two pointers moved rather than one, at two of those sites.** `src/worker.ts` and `test-plan.md`
§7 also carried `context/changes/bug-generation-failed-audit-swallowed/follow-ups/sentry-delivery.md`,
which stopped resolving when C10X-50 was archived — flagged by
`tests/lib/sentry-capture-wiring.test.ts`'s own header on 2026-08-14 and closed here.

**Nine archive hits across three files** under
`context/archive/2026-08-13-bug-generation-failed-audit-swallowed/` (`verification.md`, `plan.md`,
`follow-ups/sentry-delivery.md`) took **one dated correction each, placed at the top** rather than
appended at the bottom — a reader who greps the old path meets the correction before the hits.
Nothing in any of them is edited.

### `src/pages/api/generate.ts:6` — the live CLAIM, already corrected in Phase 4

The plan flagged one pointer that goes **false** rather than stale: "The ONLY module in `src/` that
imports the Sentry SDK besides `src/worker.ts`". It was corrected in Phase 4's own commit
(`54cb368`), in the same commit that made it false, which is what the plan asked for. Re-verified
here rather than assumed: the comment now reads "One of THREE modules", names
`src/pages/api/auth/signout.ts` and the date, and `signout.ts` carries the mirror-image note.

### The roadmap flip was NOT performed, by decision

Phase 5 §4 says to set H-19 `Status: in progress` → `done` with the archive path. **It is left at
`in progress` and no `## Done` bullet is added.** `lessons.md` reserves both for `/10x-archive`
("if a plan instructs the flip, treat it as a defect and defer to archive"), `roadmap.md:79-87`
states the same ownership, and Phase 1 had already behaved that way — it added H-19's summary row
and detail block and no Done bullet. The archive path the plan wants written does not exist yet
either. Recorded here, in test-plan.md's §8 entry and in `change.md` so the absence reads as a
decision rather than as a missed edit.

**H-19's Outcome was re-read and deliberately left unedited**, which is the other half of that
rule (doc-sync updates the Outcome only). It already states the landing-page choice and its
mechanism — "`getUser()` na następnym hopie padnie z tego samego powodu i zabrałby parametr razem
z przekierowaniem" — written at plan time as an argument. Phase 5 **measured** it (row 3 above).
Nothing in the sentence changes; it is simply better evidenced than when it was written.

### Phase 5 automated criteria, as run

| criterion               | result                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 `npm run typecheck` | exit 0 — `Result (157 files): 0 errors, 0 warnings`, `typecheck: OK — 157 files checked (floor 50)`                                     |
| 5.2 `npm run lint`      | exit 0 — **3** warnings, all `no-console` in `evals/generation-quality.eval.ts` (`:169`, `:238`, `:268`), unchanged by this change      |
| 5.3 `npm run build`     | exit 0 — `[build] Complete!`; the standing `@astrojs/sitemap` `site` warning unchanged                                                  |
| 5.4 `npm test`          | **501/501, 40 files**, five green runs; one non-reproducing red before them (below). Final run seed `1786704163448`                     |
| 5.5 restores            | `git diff -- src/` empty after every breakage restore; per-file `md5sum` identical in all cases (`signout.ts`, `middleware.ts`, `.env`) |

**5.5's scope, so it is not over-read.** `git diff -- src/` is **not** empty at the end of Phase 5,
and correctly so: it carries the two intentional doc-sync comment edits (`src/worker.ts`,
`src/pages/api/generate.ts`). The criterion is about breakage residue, and it was checked at the
moment of each restore rather than at the end of the phase.

**TWO reds across 14 full-suite runs, neither reproducing — recorded as a live harness finding
rather than as a one-off.** The first framing of this paragraph called it "the suite's one red"
and treated it as an isolated event; a second red later in the same phase falsified that, so the
paragraph is rewritten rather than defended.

| run                   | result                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1st of the phase      | **RED**, 1 case: `tests/study/study.test.ts` `createDeck` expected `Location: /decks`, received `/decks?error=Talia o tej nazwie już istnieje&open=create` |
| next 5                | green (seeds `1786703619429`, `1786703664924`, `1786703674852`, `1786703685039`, `1786704163448`)                                                          |
| after the browser run | **RED**, `1 failed                                                                                                                                         | 39 passed (40)` — **case unidentified** |
| the 7 after that      | green (`1786705289772`, `1786705310123`, `1786705319537`, `1786705329469`, `1786705339144`, `1786705349002`, `1786705358485`)                              |

**The first red is characterised: a duplicate deck name inside one run**, which is the seam C10X-39's
census records as `deck` being **LOUD by `deck_user_name_unique`** — the constraint doing its job and
surfacing as a test failure. The obvious cause is **ruled out by measurement**: `docker exec … grep
upstream_keepalive /usr/local/kong/.kong_env` reads `upstream_keepalive_pool_size = 0`, so the
C10X-39 pooling fix is applied on this machine and the Kong keep-alive `502` that the retry wrapper
replays should be absent. Cause unattributed.

**The second red is NOT characterised, and that is my error rather than a property of the suite.**
The command that ran it filtered its own output down to the summary lines, so neither the failing
case nor the seed survived — I do not know whether it was the same case, and this record does not
claim it was. **Both mistakes are the same one**: §6.2's exact replay
(`npx vitest run --sequence.seed=<n>`) needs the seed, and the seed is printed in the banner that
gets filtered away. The final six runs were executed with full output captured to a file on red,
precisely so a third occurrence would be diagnosable; none occurred.

**What this does and does not implicate.** Nothing in this change touches `tests/study/`,
`src/lib/decks.ts` or the deck endpoints, and both reds sat in a file this change never edits. The
honest reading is a pre-existing harness flake at roughly 2-in-14 on this machine today, not a
regression from C10X-51 — but "roughly 2-in-14" is a rate measured over 14 runs on one machine on
one day, which C10X-39's own entry warns is noise rather than a baseline. Same shape as C10X-46's
post-review unexplained red, now seen twice.
