---
date: 2026-08-08T21:20:21+02:00
researcher: lirdaw
git_commit: 2c7ec3b3d21059713f5f0da7a91ac731c0c93102
branch: docs-test-plan-refresh-2026-08-05
repository: My10xCards_v2
topic: "E2E harness + two browser journeys (test-plan.md §3 Phase 6)"
tags: [research, codebase, e2e, playwright, preflight, storage-state, middleware-guard]
status: complete
last_updated: 2026-08-08
last_updated_by: lirdaw
---

# Research: E2E harness + two browser journeys (test-plan.md §3 Phase 6)

**Date**: 2026-08-08T21:20:21+02:00
**Researcher**: lirdaw
**Git Commit**: `2c7ec3b` (`chore(archive): close test-plan-refresh-2026-08-05`)
**Branch**: `docs-test-plan-refresh-2026-08-05` — **not the branch this change should ship on**, and HEAD is on no remote (`git branch -r --contains HEAD` is empty), so no GitHub permalinks are generated below; every reference is a local `path:line`.
**Repository**: My10xCards_v2

## Research Question

What must this change build so that the existing Playwright harness becomes trustworthy and
runnable, and what exactly do the two browser journeys assert? `test-plan.md` §3 Phase 6 hands
the phase nine measured harness findings _with verdicts_ plus four deferrals; the job of this
research is to **re-measure them on 2026-08-08**, map the two journeys against live markup, and
settle the questions the refresh left open.

Scope confirmed with the user before starting: harness (sub-phase 6.1) + both journeys + the
four deferred bookkeeping items. The untracked `tests/e2e/route-guard.spec.ts` is treated as
**prior art to audit and adopt**, not as noise.

## Summary

**The harness is in a better state than the documents say, and its central risk is different
from the one they name.**

1. **The nine findings from 2026-08-05 mostly still hold**, with three corrections. Finding 5
   stays closed; finding 8 is still true _of the repo_ but false _of this machine_ (Chromium is
   installed); and finding 2's wording — "a fresh checkout has no such file" — is true while its
   practical implication is not: the file exists here, it is 4 days old, and **it works**.

2. **The single most consequential correction in this document.** Two independent sub-agents
   concluded from code-reading that `playwright/.auth/user.json` is "already dead" and that
   journey B's signed-in control "is failing right now." **I measured it green three times.** The
   mechanism is now established rather than inferred: the stored refresh token is a _revoked
   parent_ (`p77oszzyzarv`), and GoTrue answers its reuse with the pre-existing _child_
   (`fe74g3zzieqe`, `parent = p77oszzyzarv`) — minting a fresh access token every time and
   **creating no new rows**. So the artifact is durable, not one-shot. This is exactly the class
   `lessons.md` warns about (the Kong entry): inference written as fact, in the reassuring
   direction — except here the inference was _pessimistic_, which would have sent the plan
   chasing a non-existent expiry bug.

3. **Sub-phase 6.1 remains a genuine entry condition, but the danger has a sharper shape.** A
   `PROD_`-swapped `.env` does **not** currently reach production, because the cookie name is
   derived from `SUPABASE_URL` (`sb-127-auth-token`) and a cloud-pointed server would not read
   it — the run would land signed-out and die on a locator timeout. That is **a fail-safe that
   instructs the developer to disarm it**: the natural response to "my session must have expired"
   is to re-mint `user.json` against the swapped server, which produces a real production session
   and hands `seed.spec.ts:36-42` a production deck to delete. Frame it that way, never as
   "already safe" and never as "an open hole."

4. **The lever that makes a preflight binding is `webServer`, not the assertion.** Resolve env
   once with Vite's own `loadEnv` (already installed — the byte-identical call Astro makes),
   assert on it, then pass the same map through `webServer.env`, which wins over `process.env`,
   which wins over `.env`. Without `webServer` — or with `reuseExistingServer: true` — the
   assertions are advisory, because **nothing the running server exposes reveals which Supabase
   project it points at.** I falsified the one candidate host-oracle by measurement (below).

5. **Journey B already exists and should be adopted with named edits.** Its oracle (final browser
   URL, never a fetch status) is correct and is the only layer that can see an _unmounted_
   middleware. Its weakest point is the public-route control, which passes green over an app
   returning 500 on `/`.

6. **Journey A's oracle guidance is confirmed and strengthened.** `listFlashcards` filters
   `state_id = STATE_ACCEPTED`, so a card must be accepted to appear on the deck page _at all_ —
   the count goes 0 → K across the accept, which is a real before/after oracle rather than a
   proxy.

### Live measurements taken during this research (2026-08-08)

| Measurement                               | Result                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                       | `Result (136 files): 0 errors, 0 warnings`, exit 0, floor 50                                                                             |
| `npx playwright test --list`              | 8 tests in 2 files                                                                                                                       |
| `npx playwright test route-guard.spec.ts` | **7 passed (2.3 s)** — incl. the signed-in control; re-run of that one case minutes later: passed                                        |
| `playwright/.auth/user.json`              | 1 cookie `sb-127-auth-token`, `domain=localhost`, `expires 2027-09-08`, value 2771 chars, `origins: []`                                  |
| Stored access-token `exp`                 | `2026-08-04T22:13:57Z` — **expired 93 h ago**                                                                                            |
| `GET /decks` + stored cookie              | **200 OK** + `Set-Cookie`; fresh access `exp 2026-08-08T20:24:32Z`; access **and** refresh token differ from stored                      |
| `auth.refresh_tokens`                     | stored `p77oszzyzarv` `revoked=t`; returned `fe74g3zzieqe` `revoked=f`, `parent=p77oszzyzarv`; 985 rows, **max `created_at` 2026-08-05** |
| DB growth                                 | 487 users (484 `harness-*`), **5459 decks**, 9383 flashcards                                                                             |
| Orphaned e2e data                         | **1** deck `E2E deck 1785947414992`, created 2026-08-05 16:30                                                                            |
| Dev server binding                        | `localhost:4321` → 200, `[::1]:4321` → 200, **`127.0.0.1:4321` → ECONNREFUSED**                                                          |
| Node DNS                                  | v24.18.0, `getDefaultResultOrder = verbatim`, `localhost` → `::1` first                                                                  |
| `GET /decks` no cookie                    | 302 → `/auth/signin` (guard live on a real request)                                                                                      |
| Deck page SSR, 0 cards                    | `Edytuj` ×0, `role="alert"` ×1, 9 `astro-island`s                                                                                        |
| After 2 Playwright runs                   | only `test-results/.last-run.json`; `playwright-report/`, `blob-report/`, root `.last-run.json` **absent**                               |
| `POST /api/auth/signout`, no session      | **403**, no `Set-Cookie`, no project ref leaked                                                                                          |

## Detailed Findings

### 1. The harness as it stands — the nine findings re-measured

`playwright.config.ts` is byte-unchanged since 2026-08-05 (11 lines).

| #   | Finding (2026-08-05)                         | Verdict 2026-08-08                                                                                                                                                                                                                              |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | No Playwright preflight                      | **LIVE** — no `globalSetup`, no setup project, no `webServer`, no `retries`; grep returns empty                                                                                                                                                 |
| 2   | `storageState` has no producer               | **LIVE for the producer; the artifact itself works** — see §2                                                                                                                                                                                   |
| 3   | No `webServer`; hardcoded `baseURL`          | **LIVE**                                                                                                                                                                                                                                        |
| 4   | Vitest/Playwright isolation is incidental    | **LIVE** — `vitest.config.ts:27` `tests/**/*.test.ts` vs Playwright's default `testMatch` (both suffixes) inside `testDir: ./tests/e2e`. A `tests/e2e/foo.test.ts` is collected by **both**. Nothing asserts the separation in either direction |
| 5   | `test-results/` + `.playwright-cli/` ignored | **CLOSED** (`.gitignore:127-128`)                                                                                                                                                                                                               |
| 6   | One persistent account, zero auth requests   | **LIVE, and sharper** — `route-guard.spec.ts:48` discards the session for 5 of its 7 cases, so the 30-sign-ins/5-min limit is untouched                                                                                                         |
| 7   | `trace: "on-first-retry"` inert              | **LIVE** — no `retries` anywhere; default 0, so no first retry can occur                                                                                                                                                                        |
| 8   | No npm script, no browser install            | **LIVE in the repo** (no `e2e` script, no `postinstall`, `playwright install` appears only in prose) — **but false of this machine**: `~/AppData/Local/ms-playwright/chromium-1234` is present                                                  |
| 9   | Four artifact classes unignored              | **LIVE but latent — now confirmed by experiment**, see §6                                                                                                                                                                                       |

`test-plan.md:826` (§4's e2e row) is stale in one clause: it says "plus **one spec**"; there are two.

### 2. The `storageState` artifact — measured, and two agents' inference corrected

**What both sub-agents concluded (independently, from code):** `jwt_expiry = 3600` plus
`enable_refresh_token_rotation = true` with `refresh_token_reuse_interval = 10`
(`supabase/config.toml:158,164,167`) means a cached file survives ~1 hour plus at most one
refresh; the on-disk file is 4 days old; therefore it is dead and
`route-guard.spec.ts:84-89` "is failing right now."

**What is actually true, measured:**

- `npx playwright test route-guard.spec.ts` → **7 passed**, including that control. Re-run of the
  single control minutes later → passed. `md5sum` of `user.json` unchanged across both.
- `curl -H "Cookie: sb-127-auth-token=…" http://[::1]:4321/decks` → **200 OK** with a
  `Set-Cookie` carrying a **new** access token (`exp 2026-08-08T20:24:32Z`) — so the server _does_
  refresh on `getUser()` and re-issues the cookie, which Playwright then discards with the
  context.
- The database explains why it repeats indefinitely:

  | token                                | revoked | created             | parent         |
  | ------------------------------------ | ------- | ------------------- | -------------- |
  | `p77oszzyzarv` (the one in the file) | **t**   | 2026-08-04 21:13:58 | —              |
  | `fe74g3zzieqe` (the one returned)    | f       | 2026-08-05 16:26:31 | `p77oszzyzarv` |

  985 rows total, **max `created_at` 2026-08-05** — i.e. today's three refreshes minted nothing.
  GoTrue answers reuse of a revoked parent with its existing child.

**Consequence for the plan.** The producer problem is real, but it is a **reproducibility**
problem (a fresh checkout has no file; the one here is hand-made and undocumented), not an
**expiry** problem. Do not scope 6.1 around "the session keeps expiring" — that would be building
against a symptom that does not occur. The honest boundary: this durability rests on GoTrue's
reuse-of-revoked-parent behaviour, which is not a contract this project controls, and any
`npx supabase stop` / `db:reset` wipes `auth.users` and kills the file outright.

**The mechanical facts a producer must honour** (all verified in the installed packages):

- Cookie **name** is derived from `SUPABASE_URL`:
  `supabase-js/dist/index.mjs:373` → `` `sb-${baseUrl.hostname.split(".")[0]}-auth-token` `` →
  `sb-127-auth-token`. `src/lib/supabase.ts` passes no `cookieOptions`, so the default stands.
- Cookie **domain** must be `baseURL`'s host (`localhost`) — the _app server_ reads it, not
  Supabase. **Two different hosts in one file, by design.**
- Value is `"base64-" + base64url(JSON.stringify(session))`; chunk threshold is
  `MAX_CHUNK_SIZE = 3180` (`@supabase/ssr/…/chunker.js:1`) and the live value is **2771** — one
  cookie, with 409 characters of headroom.
- Every way of getting this wrong produces **the same observable**: a logged-out browser. There is
  no error path — the read side `console.warn`s and reports the session as absent.

**Ranked options for producing it** (detail in §3 of the sub-agent findings, condensed here):

1. **A setup project that signs in through the real UI, then `context.storageState({ path })`.**
   Name, value, encoding, chunking, domain, path, expiry all come from the app and the browser, so
   `lessons.md`'s "never hand-assemble the cookie" rule is satisfied _by construction_. Needs no
   `SUPABASE_URL`/`SUPABASE_KEY` in the Playwright process. **Must assert it actually signed in
   before writing** — otherwise it writes `{"cookies":[],"origins":[]}` and every downstream test
   is quietly signed out.
2. Headless re-implementation of the `tests/fixtures/session.ts` capture — fast, but re-derives
   the five attributes that capture deliberately discards (`session.ts:65-72`), i.e. a second
   hand-assembly surface.
3. `APIRequestContext` sign-in + `request.storageState()`.
4. ❌ Reuse the hand-made file — works today, unreproducible tomorrow.
5. ❌ Hand-write the cookie — forbidden by `lessons.md`.

**Not one line of the existing session machinery is importable** from a Playwright setup file:
`tests/fixtures/session.ts:3` and `src/lib/supabase.ts:3` both import `astro:env/server`, which a
plain Node loader rejects (`ERR_UNSUPPORTED_ESM_URL_SCHEME`, measured). `tests/fixtures/accounts.ts`
additionally imports `vitest`. Playwright _does_ honour `tsconfig` `paths`, so `@/*` resolves —
the blocker is the Astro virtual modules, exactly as `route-guard.spec.ts:27-33` already states.

### 3. Sub-phase 6.1 — the preflight, and what it can and cannot close

`tests/setup/preflight.ts` (wired at `vitest.config.ts:32`) makes six assertions with no env
opt-out — its only import is `astro:env/server`, so there is no variable that _could_ gate a skip.
One ordering decision is worth copying verbatim (`preflight.ts:138`): `assertLocal` runs **before**
`assertReachable`, so a mis-pointed run never emits a packet at production. That matters more in a
browser run, where the "request" is a whole session.

**Seams a Playwright preflight must close** — the three inherited, plus four that exist only
because the server is a separate process:

| Seam                          | Mechanism                                                                                                                                                                                                | Blind spot                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| S1 Supabase host is local     | `loadEnv("development", cwd, "")` from `vite` (installed; the identical call at `astro/dist/env/env-loader.js:40`), then hostname ∈ {`127.0.0.1`, `localhost`}, **then pass it through `webServer.env`** | Asserts the runner's resolution; only `webServer.env` makes it binding on the child                                 |
| S2 key is publishable/anon    | Port `assertAnonKey` verbatim — pure, no Astro dependency                                                                                                                                                | Asserts key _class_, never _ownership_: `PROD_SUPABASE_KEY` is also `sb_publishable_`                               |
| S3 `OPENROUTER_API_KEY` unset | Static: assert falsy + pass `OPENROUTER_API_KEY: ""` (works because `astro/templates/env.mjs:26` maps `'' → undefined`). Runtime: assert the OpenRouter banner **is present** on a signed-in page        | The runtime layer needs a session and must assert _presence_; absence conflates "key set" with "signed out"         |
| S4 server identity            | `webServer` with `reuseExistingServer` left unset/false — `playwright/lib/runner/index.js:851` then hard-errors on a pre-existing listener                                                               | Playwright's readiness probe accepts 2xx/3xx/**400/401/402/403**, so a misconfigured server still reads as "ready"  |
| S5 session provenance         | Offline: assert the cookie **name** equals `sb-${hostname.split(".")[0]}-auth-token` computed from the same asserted URL                                                                                 | Proves the artifact _could_ pair with the server, not that the session is live — needs a signed-in positive control |
| S6 reachability               | Port `assertReachable`, **after** S1                                                                                                                                                                     | Proves the stack answers, not that it is the right stack                                                            |
| S7 browsers installed         | `chromium.executablePath()` check, mapped to a "run `npx playwright install`" message                                                                                                                    | Runnability, not data safety — keep it last so it never masks S1                                                    |

**The composition is the design, not the individual assertions.** Resolve env once, assert on the
resolved map, then hand that map to `webServer.env`. Precedence measured end to end:
`webServer.env` (`playwright/lib/runner/index.js:858-862`) **>** `process.env` **>** `.env`
(`vite/…/config.js:9416-9417`).

**What no preflight can close.** With `reuseExistingServer: true`, or any hand-started server,
**nothing determines the server's `SUPABASE_URL`.** `src/lib/config-status.ts:31,40` exposes two
booleans and never a host. I tested the one candidate host-oracle a sub-agent proposed and
**falsified it**: `POST /api/auth/signout` with no session answers **403** with no `Set-Cookie` and
no project ref (`src/pages/api/auth/signout.ts` returns before touching Supabase). So
`reuseExistingServer` must be false or unset — that is the difference between S1 being enforceable
and S1 being decorative.

**A live trap for the `webServer` block.** The dev server binds **IPv6 loopback only**: measured,
`http://localhost:4321` → 200 and `http://[::1]:4321` → 200, but `http://127.0.0.1:4321` →
`ECONNREFUSED`. Node 24 resolves `localhost` verbatim with `::1` first, so `url:
"http://localhost:4321"` works and `url: "http://127.0.0.1:4321"` would fail the readiness probe
for a reason unrelated to the app.

**A stale pointer to fix while in the file:** `tests/setup/preflight.ts:102` cites
`src/lib/openrouter.ts:149` for the mock fallback; the branch is at **`:160`**.

### 4. Journey A — "an accepted card survives a reload"

All four pieces of the test-plan's response guidance are **confirmed**, one with a correction:

- **(a) Assert on the deck page** — confirmed _and stronger than stated_. `listFlashcards` filters
  `.eq("state_id", STATE_ACCEPTED)` (`src/lib/flashcards.ts:97-104`), as do `countFlashcards`
  (`:188-194`) and search. A generated card is invisible on the deck page, so the `Edytuj` count
  goes **0 → K** across the accept — a genuine before/after oracle.
- **(b) `getByRole("button", { name: "Edytuj" })`, one per card** — confirmed;
  `FlashcardItem.tsx:241` is the only `Edytuj` on that page. My SSR probe of a real 0-card deck
  returned `Edytuj` ×0, which pins the oracle's zero point.
- **(c) `Usuń` over-counts by one** — confirmed **for `getByRole` (N+1)**, and the raw DOM holds
  **N+2**: `FlashcardItem.tsx:254` ×N, `DeckActions.tsx:76` (header), plus
  `DeckActions.tsx:146` inside a closed `<dialog>` that `getByRole` excludes but a
  text/CSS locator would not. The claim is correct _for the mandated locator strategy_ and off by
  one for any other.
- **(d) The review screen self-reloads and its metric hides silently** — confirmed both halves:
  `CandidateReviewWorkspace.tsx:138` `window.location.reload()` on the accept branch, and
  `review.astro:103-110` + `:188` (`if (!error)` … `{metric && (`), which renders nothing in three
  distinct situations.
- **(e) Don't assert on card content** — confirmed, with a precision correction. `mockCards`
  (`src/lib/openrouter.ts:119-124`) _does_ vary by index within a call
  (`Przykładowe pytanie 1..N`); what matters is that it is **byte-identical across calls**, so two
  generations into one deck produce duplicate fronts. State the reason as "not run-unique", not
  "not indexed".

**Flow facts a spec needs.** Generation is synchronous JSON (`200`, no redirect); the browser stays
on `/generate` and gets a `link` named **`Przejrzyj kandydatów`** pointing at
`/decks/<deckPublicId>/review?generation=<sessionPublicId>`. Mock mode returns before validation,
so `generatedCount === count` exactly. Single-card and bulk accept share one code path
(`/api/decks/[publicId]/cards/batch`, `action: "setState"`).

**Locator hazards measured.** `role="alert"` is present on **every** authenticated page in mock
mode — the OpenRouter config banner (`config-status.ts:41-43`), first in DOM order; my SSR probe
counted exactly 1 on the deck page. Playwright's `name` is substring + case-insensitive by
default, so `{ name: "Akceptuj" }` also matches `Akceptuj (3 fiszki)` — **every counting assertion
needs `exact: true`**. Every `<dialog>` is permanently mounted (`Modal.tsx:49`) and opened
imperatively, so a click landing before hydration is silently lost — reuse `seed.spec.ts:8-17`'s
`toPass` retry verbatim. The deck search box is `searchbox`, not `textbox`; `Liczba kart` is
`spinbutton`.

**The manual-create shortcut exists and must not be used for this journey.**
`CreateFlashcardModal` → `/api/decks/[publicId]/cards` writes `state_id: STATE_ACCEPTED` directly
(`flashcards.ts:196-200`). It never produces the `generated → accepted` transition that the word
"accepted" in journey A means, and it proves roughly what `seed.spec.ts` already proves one level
up. Useful only as a cheap positive control.

### 5. Journey B — audit of the existing `route-guard.spec.ts`

**Verdict: adopt with named edits.** The spec's oracle is right (final browser URL, never a fetch
status — the C10X-27 bug hid precisely because `fetch` follows the 302 to a `200`), its locators
are entirely role-based, it has no `waitForTimeout`, and `test.use({ storageState: { cookies: [],
origins: [] } })` at `:48` is necessary — without it the whole `describe` tests the opposite case
and passes.

**What it adds over `tests/middleware.test.ts`** (which already drives `it.each(PROTECTED_ROUTES)`
on both branches, 9 cases): that `onRequest` is **invoked by the runtime at all**. And a
non-obvious bonus — the hardcoded route copy is the **only** oracle for _removing_ an entry from
`PROTECTED_ROUTES`, because `it.each` over the real array simply loses rows and stays 100 % green.
The test-plan describes the copy purely as a cost; this is its other side.

**Edits, in order of importance:**

| #                 | Edit                                                                                                                                                  | Why                                                                                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1** (blocking) | Add a presence assertion to the public-route control: `expect(page.getByRole("heading", { name: "10xCards" })).toBeVisible()` (`Welcome.astro:32-36`) | Today it passes green over an app returning 500 on `/` — i.e. over "padnięty Supabase", a class its own comment (`:65-67`) claims to cover. Same shape as §6.6's four-policy neuter: absence-in-an-unbounded-set is not falsifiable                                               |
| E2                | Fix the `/api/*` exclusion rationale (`:32-33`)                                                                                                       | "guard odpowiada tam w innej konwencji (401 JSON)" is **false for a document navigation** — `src/middleware.ts:20-21` says the discriminator is the _caller_, so `page.goto("/api/decks")` gets a 302. The true reason is only the first half: a user's browser does not go there |
| E3                | Add the fourth "Sign in" ambiguity (`:57-58`)                                                                                                         | `Topbar.astro:27-29` renders `<a>Sign in</a>` — the **only** one of the four that stands on the public-route control's own path, and therefore the one that actually proves role-scoping is load-bearing                                                                          |
| E4                | Correct the CLEANUP claim (`:20-22`)                                                                                                                  | "nie tworzy ani jednego wiersza w bazie" is false for the signed-in control: `getUser()` on an expired token triggers a refresh, which touches `auth.refresh_tokens`. True as written for the _application_ tables                                                                |
| E5                | Give `waitForURL` an explicit timeout (`:55`)                                                                                                         | `navigationTimeout` defaults to 0, so a failure hangs to the 30 s test timeout and reports a generic message — 2.5 min per deliberate-break run instead of 25 s                                                                                                                   |
| E6                | Harden `/:\d+\/$/` (`:72`)                                                                                                                            | Requires an explicit port in `baseURL`; couples the case to the environment                                                                                                                                                                                                       |
| E7                | Record the copy's _second_ side in the comment (`:27-33`)                                                                                             | Otherwise the first tidying reader deletes it as debt                                                                                                                                                                                                                             |

**Correction to the audit itself.** The sub-agent predicted the signed-in control is red today. It
is green — measured three times (§2). Its comment at `:79-82` is accurate about the dependency but
imprecise in one word: the file **exists**, hand-made and unreproducible, which is a worse state
than absent (absence gives a hard error; a stale file gives a red that looks like a guard defect).

**Deliberate-break design.** Best discriminator is **A**: delete `"/study"` from
`src/middleware.ts:13` → predicted **1 of 7 red** (that one route, on `waitForURL`), both controls
green, and `tests/middleware.test.ts` **100 % green** — the asymmetry that proves the layer. Pair
with **C** (force the guard predicate to `true`) → 1 of 7 red on the public control, different
case, different assertion — the §6.10 separation shape. **B** (`mv src/middleware.ts …off`) is the
mandate's own class → predicted 5 of 7 red, but note it cannot leave vitest green, because
`tests/middleware.test.ts:3` imports from that module: the two layers differ by _kind_ of red
(module-resolution vs behavioural), not by colour.

### 6. Runner integration and the four deferrals

**Type gate.** `npm run typecheck` → `Result (136 files): 0 errors`, exit 0. `playwright.config.ts`
and both specs are resolved project members (`npx tsc --showConfig`), via `tsconfig.json:3`
`include: ["**/*"]`. The gate asserts a **floor of 50** (`scripts/typecheck.ts:54,269`), which is
why the layer entered silently and why a rising count can never break it.

**Lint.** `tests/e2e/**` is under full type-aware `strictTypeChecked` lint today — measured:
`npx eslint tests/e2e/route-guard.spec.ts` returns 0 errors, 0 warnings, and
`npm run lint` exits 0 with only the 3 pre-existing `no-console` warnings in `evals/`.
**`eslint-plugin-playwright` is not installed**, so none of the five anti-patterns is
lint-enforced.

**npm script.** Three idioms exist to follow: bare runner (`"test": "vitest run"`), config-flag
second run path (`"eval": "vitest run -c vitest.eval.config.ts"` — the closest precedent, since
the eval is the other "never part of `npm test`" layer), and chained prerequisite
(`"db:start": "supabase start && npm run db:kong"`). No script starts the app for a test run, and
there is no `postinstall`.

**CI.** `ci.yml` has no Playwright step and no browser install. Its `paths-ignore` skips
markdown-only commits, and a feature branch with no PR runs nothing at all — so the phase's own CI
evidence is structurally ship-time. §5 says e2e is **never a gate**; nothing may declare it in
`needs:`.

**The four deferrals:**

1. **`.gitignore` artifact classes — latent, now confirmed by experiment.** After my two real
   Playwright runs, the only artifact produced was `test-results/.last-run.json`, i.e. _inside_ the
   already-ignored `/test-results/`. `playwright-report/`, `blob-report/`, root `.last-run.json`
   and `*-snapshots/` remain absent and unignored. Note the existing ignores are **path-anchored**
   (`/test-results/`), so a moved `outputDir` is unignored.
2. **§6.11 cookbook subsection** — belongs to this phase. Verification trap already recorded:
   `grep -cF "### 6.11"`; `-F` and the heading prefix are both load-bearing.
3. **Roadmap `H-12`** — still free (highest is `H-11`), still uncreated. `/10x-archive` is the sole
   owner of the Status flip and the `## Done` entry (`roadmap.md:401`). Also note
   **`roadmap.md:234`**, which claims the project "nie ma warstwy e2e ani visual-diff" — now
   **half false** (a runner exists; visual-diff genuinely does not).
4. **Jira `C10X-46`** — reserved; `C10X-45` was spent on the refresh itself.
   `context/foundation/jira-map.md` exists locally but is stale (highest key `C10X-44`, last synced
   2026-08-01) and is owned by `/jira-backlog-sync` — do not hand-edit.

**A predecessor's unpaid debt, inherited in practice:** the refresh has a Jira key and **no
roadmap row**, so it archived with nothing to close, exactly as H-04/H-07/H-08 did before being
backfilled.

## Code References

- `playwright.config.ts:1-11` — the whole harness config; no `webServer`, no `retries`, no `globalSetup`
- `tests/e2e/seed.spec.ts:8-17` — the hydration-safe `toPass` modal helper to reuse
- `tests/e2e/seed.spec.ts:36-42` — inline cleanup that deletes a deck through the real UI
- `tests/e2e/route-guard.spec.ts:48` — the signed-out `storageState` scoping that makes journey B mean anything
- `tests/e2e/route-guard.spec.ts:55` — `waitForURL`, the correct oracle
- `src/middleware.ts:7-15` — `PROTECTED_ROUTES` (7 entries; the spec copies the 4 page routes)
- `src/middleware.ts:20-21` — "Branching on the PATH would be wrong"; the caller is the discriminator
- `src/middleware.ts:56-58` — `/` → `/decks` for authenticated users only
- `src/lib/supabase.ts:13` — the `Cookie` request header is the only session input
- `src/lib/flashcards.ts:97-104` — `listFlashcards` filters `state_id = STATE_ACCEPTED`; journey A's oracle rests here
- `src/components/flashcards/FlashcardItem.tsx:241,254` — `Edytuj` (×N) and `Usuń` (×N)
- `src/components/decks/DeckActions.tsx:76,146` — the header `Usuń` (+1) and the dialog `Usuń` (hidden)
- `src/components/review/CandidateReviewWorkspace.tsx:138` — `window.location.reload()` on accept
- `src/pages/decks/[publicId]/review.astro:103-110,188` — the metric that hides silently
- `src/lib/openrouter.ts:119-124,160` — `mockCards`, and the fallback branch (preflight cites `:149`, stale)
- `src/lib/config-status.ts:31,40-46` — two booleans; no host is ever exposed
- `tests/setup/preflight.ts:87-93,112-118,138` — the local-host assertion, the OpenRouter clamp, the ordering comment
- `scripts/typecheck.ts:54,269` — `MIN_CHECKED_FILES = 50`, the floor the gate asserts on
- `vitest.config.ts:27,32` — `include` and the two `globalSetup` entries
- `.gitignore:125,127,128` — the three Playwright-related ignores

## Architecture Insights

- **A guard's own discriminator can invert a test's meaning.** Because `src/middleware.ts` branches
  on the _caller_ (`Sec-Fetch-Dest`), the same path answers 302 or 401 depending on how it is
  reached. Any e2e assertion about `/api/*` therefore measures something other than what its name
  suggests.
- **Cookie naming is an accidental environment lock.** Deriving the session cookie's name from
  `SUPABASE_URL` means a mis-pointed server cannot read a correctly-made local session. That is
  protective by accident and misleading by design: the symptom is a locator timeout, and the
  natural remedy disarms the protection.
- **A floor-based gate absorbs growth silently.** The type gate's `>= 50` is correct design and is
  exactly why a whole new test directory entered CI with no document noticing.
- **This project's dominant failure mode is inference written as fact.** `lessons.md` records it
  for Kong keep-alive; this research reproduced it twice in one session, with two sub-agents
  independently declaring a working artifact dead. Every claim below the summary that came from
  reading rather than running is labelled as such.

## Historical Context (from prior changes)

- `context/archive/2026-08-05-test-plan-refresh-2026-08-05/research.md:38-43` — the 133 → 135
  arithmetic and the discovery that the e2e layer was already inside the type gate
- `.../reviews/plan-review.md:59-98` — finding F1: an untracked `route-guard.spec.ts` took the
  count to **136**; removed during triage. It is back, at a **different size** (5169 B vs 6076 B),
  and takes the count to 136 again. The durable half of that fix — use `git status --porcelain`,
  never `git diff`, as the scope guard — applies to this change too
- `.../plan-review.md:83-88` — the _rejected_ alternative: committing that spec under the refresh
  would have "hand[ed] the §3 Phase 6 row a partly-done journey B — the orphan pattern the refresh
  exists to stop, one step further along"
- `.../change.md:62-77` — journey B's re-scoping, and the record that its original justification
  ("`PROTECTED_ROUTES` is uncovered") has been false since C10X-27
- `.../research.md:540-551` — the H-12/C10X-45 reservation, and the knowing acceptance that the
  refresh would itself archive as an orphan
- `context/archive/2026-07-15-verification-harness/plan.md:103` — the earliest e2e deferral,
  reasoned purely procedurally ("No §3 phase claims it"), which is the loophole the refresh closed
- `context/archive/2026-07-31-deck-form-hardening/verification.md:21-47` — the browser-evidence bar
  this phase must meet: assertions on the DOM, hydration polled rather than assumed (403–901 ms
  measured), and a positive control that can actually go red
- `context/archive/2026-07-25-focus-ring-a11y/verification.md` — the format for manual browser
  measurement, including viewport/DPR and the "only the second pass is evidence" discipline

## Related Research

None prior on this topic other than the 2026-08-05 refresh — its `research.md:466-469` records
itself as the first. This document is the second.

## Open Questions

1. ~~**Which account should the setup project use?**~~ **DECIDED 2026-08-08 — see `change.md`
   D-01: one stable, dedicated e2e account, NOT per-run.** The deciding axis is the one this
   research measured: the harness issues **zero auth requests per run**, so the 30/5-min sign-in
   limit is currently unexposed (test-plan harness risk 6, "INVERTED on the rate-limit axis"), and
   per-run accounts would re-introduce that exposure plus a user per run on top of the 487/5459
   already there. The accumulation this question was really about is closed by a **teardown**
   instead — `afterEach`/`afterAll` or a teardown project, RLS-aware and signed in as the same
   account, **never inline in the test body** (the mode that already orphaned
   `E2E deck 1785947414992`). Unique `Date.now()` suffixes stay. Accepted price: the account
   carries state between runs, so no spec may assume an empty starting deck list.
2. **Does `reuseExistingServer: false` fit this developer's workflow?** It is what makes S1
   enforceable, and it forbids the hand-started `npm run dev` that is currently the only way to run
   the suite — including the one running right now.
3. **How long does the durability in §2 last?** Measured over 4 days and 3 refreshes; it rests on
   GoTrue returning a revoked parent's child, which is not a contract this project owns. Worth one
   sentence in the setup project's header rather than a mechanism.
4. **Should `seed.spec.ts` keep its inline cleanup?** It has already orphaned one deck
   (`E2E deck 1785947414992`, 2026-08-05). A fixture teardown would survive a mid-test failure.
5. **Does journey A need its own deck-scoped cleanup**, or is deleting the deck (which cascades
   the cards) sufficient? The `Usuń` N+1 offset makes the deck-delete trigger ambiguous once cards
   exist.
6. ~~**Which branch should this change ship on?**~~ **DECIDED 2026-08-08 — see `change.md` D-02:
   recorded as a PREREQUISITE, deliberately not resolved in code.** The refresh is code-complete
   but unpushed; before the first `/10x-implement` of this phase it must be shipped to `main` and
   `/10x-archive`d, and this change branched off a clean `main`. Git is the `/ship` bookend's job,
   **outside the plan** — so the plan states the prerequisite and carries no branch/merge/archive
   step for the predecessor.
