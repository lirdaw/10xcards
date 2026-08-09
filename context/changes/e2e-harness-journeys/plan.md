# E2E harness + two browser journeys — Implementation Plan

> `test-plan.md` §3 **Phase 6**. Jira **C10X-46**, roadmap **H-12** (row created by this change; the
> Status flip and the `## Done` entry stay `/10x-archive`'s).

## Overview

`test-plan.md` §3 Phase 6 claims an e2e layer that **nothing wires**: a Playwright runner and two
specs exist, they landed outside the phased rollout, and running them needs a hand-started dev
server plus a `storageState` file that no producer creates. This change makes the harness
**runnable and binding** (a preflight that executes before the app server starts, a `webServer`
that owns the process, a reproducible session producer, and a teardown that survives a mid-test
failure), then gives it the two journeys the phase was scoped for, then closes the four deferrals
the refresh handed forward.

The layer remains **never a gate** (§5): no CI job, nothing in `needs:`, no schedule.

## Current State Analysis

`playwright.config.ts` is 11 lines: `testDir`, a hardcoded `baseURL`, a consumed-but-unproduced
`storageState`, an inert `trace: "on-first-retry"` (no `retries` is configured and the default is
`0`, so no first retry can occur), and one chromium project. There is no `globalSetup`, no
`webServer`, no npm script and no browser-install step.

Two specs exist under `tests/e2e/`:

- `seed.spec.ts` — the exemplar `/10x-e2e` learns conventions from. Correct locators, no
  `waitForTimeout`, a hydration-safe `toPass` modal helper (`:8-17`). Its cleanup is **inline in
  the test body** (`:36-42`), and that has already failed in practice: `E2E deck 1785947414992`
  sits orphaned from 2026-08-05.
- `route-guard.spec.ts` — **untracked**, journey B in all but name. Its oracle is right (the final
  browser URL, never a fetch status — the C10X-27 bug hid precisely because `fetch` follows the
  302 to a `200`), and `test.use({ storageState: { cookies: [], origins: [] } })` at `:48` is
  load-bearing: without it the whole `describe` tests the opposite case and passes.

`playwright/.auth/user.json` exists, is gitignored, is 4 days old and **works** — measured green
three times. Research established the mechanism rather than inferring it: the stored refresh token
is a revoked parent and GoTrue answers its reuse with the pre-existing child, minting no rows. So
the producer problem is **reproducibility**, not expiry. The account behind it is `test@mail.com`,
created by hand on 2026-08-04, password recorded nowhere.

The dev database has grown to **487 users / 5459 decks / 9383 flashcards** against
`max_rows = 1000` — the condition §6.6 records as having already turned an assertion
unfalsifiable while it stayed green.

### Key Discoveries

Measured during planning, in the installed `@playwright/test@1.62.1` — **the ordering fact is not
in `research.md` and it moves the design**:

- `createGlobalSetupTasks` (`playwright/lib/runner/index.js:6003-6010`) orders tasks
  `removeOutputDirs` → **plugin setup** → globalTeardowns → **globalSetups**, and
  `WebServerPlugin.setup()` (`:823-834`) calls `_startProcess()` + `_waitForProcess()`. So
  **`globalSetup` runs AFTER the app server is already up.** A preflight placed there would let a
  `PROD_`-swapped `.env` boot the server first — violating the ordering discipline
  `tests/setup/preflight.ts:138` exists to state ("never even send a request to a non-local
  host"). The only point strictly earlier is **config-module evaluation**, which is also where the
  resolved map has to be anyway, because `webServer.env` is a config field.
- `env: { ...DEFAULT_ENVIRONMENT_VARIABLES, ...process.env, ...this._options.env }`
  (`:858-862`) — `webServer.env` wins. This is what makes an assertion **binding on the child**
  rather than descriptive of the runner.
- An existing listener with `reuseExistingServer` falsy throws
  `"… is already used, make sure that nothing is running on the port/url"` (`:851`).
- `chromium.executablePath()` **does not throw** when browsers are absent — it returns a path
  (measured: `…/ms-playwright/chromium-1234/chrome-win64/chrome.exe`). A presence check must be
  `fs.existsSync`, never a `try`/`catch`.
- The dev server binds **IPv6 loopback only**: `http://localhost:4321` → 200, `http://[::1]:4321`
  → 200, `http://127.0.0.1:4321` → **ECONNREFUSED** (research). `webServer.url` must use
  `localhost`.
- **`Edytuj` is not unique to the deck page** — `FlashcardItem.tsx:241` (deck page, ×N) and
  `CandidateItem.tsx:287` (review screen, ×N per candidate). Journey A's oracle is only an oracle
  while the browser is on `/decks/<publicId>`. `research.md` names the `Usuń` N+1 offset and does
  not name this one.
- The per-card action button is bare `Akceptuj` (`CandidateItem.tsx:268-278`); the bulk toolbar
  button is `` `${label} (${count} ${plural})` `` → `Akceptuj (3 fiszki)`
  (`CandidateReviewWorkspace.tsx:231`). Playwright's `name` is substring + case-insensitive by
  default, so **every counting assertion needs `exact: true`**.
- `tests/lib/kong-keepalive.test.ts:1-11` and `tests/lib/typecheck.test.ts:1-5` are the convention
  for a pure half that lives outside `src/`: relative import **with the `.ts` extension**, plus a
  header comment citing §6.1 on why the test sits in `tests/lib/`.
- `tests/fixtures/accounts.ts:34-62` is the account convention: a hardcoded `PASSWORD` constant,
  `signUp` tolerating `user_already_exists`, then sign-in. Not a secret — preflight forbids a
  non-local stack.

## Desired End State

`npm run e2e` runs the whole layer from a clean checkout after one documented
`npx playwright install chromium`: the config refuses to proceed against anything but the local
stack **before** a server exists, Playwright owns the dev server and hands it a verified
environment, a setup project mints `playwright/.auth/user.json` through the real UI, both journeys
run, and a teardown project removes every row the run created even if a spec died mid-way.

`test-plan.md` §3 Phase 6 reads `complete`; §4's e2e row no longer says "nothing runs it" (nor
"one spec", of which there are two); §5's e2e row still reads **never a gate**; §6.11 tells the
next contributor how to add an e2e test; §6.6 and §8 carry this change's entries with the
breakage splits as observed.

Verify by: `npm run e2e` green from a tree with no dev server running; `npm test`, `npm run lint`
and `npm run typecheck` all green; and each deliberate-break below reproduced red and restored.

## What We're NOT Doing

- **No CI job, no `schedule:`, nothing in `needs:`.** §5 makes e2e never a gate and this change
  does not soften that into "required — wired by §3 Phase 6". The phase's own CI evidence would be
  structurally ship-time anyway (`ci.yml` runs nothing on a branch with no PR).
- **No journey C (an SRS study session).** Risk #3 is covered on both halves by unit + integration
  (§6.6's Phase 4 entry); a browser adds no signal. A decision, never a gap.
- **No mass cleanup of the 5459 accumulated decks**, and **not** deleting the orphaned
  `E2E deck 1785947414992`. Both were offered and declined — a destructive sweep of the dev DB is
  outside this phase's mandate. The teardown stops the growth from here; it does not repay the
  debt.
- **No visual-diff or computed-style oracle.** §7's two exclusions were re-decided on 2026-08-05
  and **stand**; a browser runner is not a computed-style oracle. This change does not re-open
  them and does not satisfy their restated conditions.
- **No `scroll-padding-top` fix** (§7's nested deferral). It gains an owner in this phase's prose
  only if §7 already says so; no code.
- **No hand-edit of `context/foundation/jira-map.md`** — owned by `/jira-backlog-sync`
  (`jira-map.md:3-4`).
- **No git work for the predecessor.** `change.md` D-02: shipping and archiving
  `test-plan-refresh-2026-08-05` and branching off a clean `main` are `/ship`'s, and are a
  **prerequisite** of Phase 1, not a step in it.
- **No auth-input validation, no C10X-19 Polish sweep.** The sign-in page is still English and
  journey B's locator matches it deliberately.

## Implementation Approach

Four ideas carry the whole plan.

**The assertion must precede the process it protects.** Because plugin setup (and therefore
`webServer`) runs before `globalSetup`, the env resolution + assertions live at config-module
evaluation. That is strictly earlier than anything Playwright can run, and it is where
`webServer.env` needs the map regardless. Splitting by synchronicity falls out of it: the
synchronous seams (local host, key class, OpenRouter key, browser binary, cookie-name provenance)
are config-time; the two that need I/O or a session (Supabase reachability, a live signed-in
control) belong to the setup project, which by construction runs after the server exists.

**The lever is `webServer.env`, not the assertion text.** An assertion over `process.env` in the
runner says nothing about the child. Passing the same verified map through `webServer.env` — which
outranks `process.env`, which outranks `.env` — is what turns "we checked" into "it cannot be
otherwise". **With one exception, and naming it is what keeps the claim honest**: the Cloudflare
adapter merges `.dev.vars` into the child's `process.env` after `webServer.env` has landed, so on
that one source the guarantee is the assertion rather than the forcing (Phase 1 §1). `reuseExistingServer` stays unset for the same reason: with a foreign server there is
no oracle at all for which Supabase project it points at (research falsified the one candidate —
`POST /api/auth/signout` with no session answers 403 and leaks nothing).

**Cleanup is a lifecycle concern, never a test step.** The inline pattern already orphaned a row.
Specs register what they create in a fixture; a teardown project removes it after the run, signed
in as the same account, under RLS.

**Every guard gets a run that proves it can go red.** This file's own discipline (§6.6 passim):
a breakage edit, its observed failure string, its split with the denominator, and a verified
restore.

## Critical Implementation Details

**Ordering & lifecycle.** Three tiers, and putting a check in the wrong one silently weakens it:

| Tier                       | Runs                               | What belongs here                                                        |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Config module evaluation   | before every Playwright task       | `loadEnv` + the synchronous assertions; building the `webServer.env` map |
| `webServer` (plugin setup) | after config, before `globalSetup` | starting `npm run dev` with the verified map                             |
| Setup project              | after the server is up             | Supabase reachability, sign-in through the UI, writing `storageState`    |

**The setup project must assert it signed in before writing.** `context.storageState()` happily
serialises `{"cookies":[],"origins":[]}`; every downstream test then runs signed out, and journey
B's positive control is the only thing that would notice — reporting it as a guard defect. Assert
a signed-in DOM fact first.

**The failure mode of a wrong cookie is silence.** Name, domain, encoding, chunking — every way of
getting the session wrong produces the same observable, a logged-out browser, because the read
side `console.warn`s and reports the session as absent. That is the argument for producing it
through the real UI rather than assembling it (`lessons.md`: never hand-assemble an
`@supabase/ssr` session cookie), and the argument for the offline cookie-name check: the name is
derived from `SUPABASE_URL` (`sb-127-auth-token`), so a mis-pointed server cannot read a
correctly-made local session — protective by accident, and misleading, because the symptom is a
locator timeout whose natural remedy (re-mint the session against the swapped server) disarms the
protection.

**User-visible copy the specs depend on.** The sign-in page is still English
(`heading "Sign in"`, C10X-19 open). `role="alert"` is present on **every** authenticated page in
mock mode (the OpenRouter config banner, first in DOM order), so no assertion may select it
unscoped. Every `<dialog>` is permanently mounted and opened imperatively, so a click landing
before hydration is silently lost — reuse `seed.spec.ts:8-17`'s `toPass` helper rather than
re-deriving it. The deck search box is `searchbox`, not `textbox`; `Liczba kart` is `spinbutton`.

---

## Phase 1: Runner foundation — a preflight that precedes the server

### Overview

Turn the 11-line config into a harness that owns its server and refuses to run against anything
non-local, with the decidable half of that refusal under unit test.

**Prerequisite (D-02, not a step here):** `test-plan-refresh-2026-08-05` is shipped to `main` and
archived, and this change is branched off a clean `main`.

### Changes Required:

#### 1. The env resolution and its assertions (the pure half)

**File**: `tests/e2e/setup/env.ts` (new)

**Intent**: Resolve the environment once, the same way Astro does, assert the seams that can be
decided synchronously, and return the map the config will hand to `webServer.env`. Living here
rather than in a `globalSetup` is the whole point of the phase — see Critical Implementation
Details.

**Contract**: Two exports, split on I/O, because the whole value of the pure half is that it can be
driven into states the runner cannot be in (§6.1's C10X-34 rule — extract the decision **and** its
inputs; a no-arg function that reads `.env` and the filesystem is only ever testable in whatever
state this machine happens to hold, which is the state that never matters):

- `buildE2eEnv(source: Record<string, string | undefined>, opts: { browserExists: boolean; devVars?: Record<string, string> }): Record<string, string>`
  — **pure**. Every assertion below and the returned map live here, so every unit case is
  fabricated, including the two that would otherwise be unreachable: the forced
  `OPENROUTER_API_KEY: ""` in the output, and a `.dev.vars` layer.
- `resolveE2eEnv()` — the thin I/O wrapper the config calls: supplies `loadEnv(...)`,
  `fs.existsSync(chromium.executablePath())` and the parsed `.dev.vars`, then delegates. It is
  deliberately assertion-free, so nothing worth testing hides behind the seam.

The `source` the wrapper supplies comes from `vite`'s `loadEnv(mode, cwd, "")` — the byte-identical
call at `astro/dist/env/env-loader.js:40`, and `vite` is already installed.

**`loadEnv` is not the whole of what the child reads, and the second source outranks everything
this phase controls.** `@astrojs/cloudflare/dist/index.js:292-303` runs, at `astro:config:done`
**inside the child**, `if (existsSync(devVarsPath)) { … Object.assign(process.env, parsed) }`. That
is after `webServer.env` has already been applied, so a `.dev.vars` overwrites the verified map —
and the runner's `loadEnv` never sees that file, so the preflight would be asserting against a file
the server does not read. `README.md` documents the precedence ("if both exist, Cloudflare ignores
`.env` and reads `.dev.vars`") and `.gitignore` lists it, i.e. it is a local-only file exactly of
the kind a developer creates. Measured 2026-08-08: **no `.dev.vars` on this machine**, so this is a
latent **seam**, not a live incident — which is precisely the case `lessons.md`'s "Preflight musi
domknąć KAŻDY nielokalny szew" is written for, and the sentence §3 Phase 6 uses to justify
sub-phase 6.1.

So the value under assertion is the **merged** map, modelled in the child's own order:
`{ ...loadEnv(mode, cwd, ""), ...forced, ...parseDevVars() }` — parsed, not merely detected, so a
developer who legitimately keeps a local `.dev.vars` gets the same protection rather than a blanket
refusal. Every assertion below runs over that merge, and a failure message must name **which of the
two files** carries the offending value, or it sends the reader to edit the wrong one (the C10X-43
`pre-push` trap).

Assertions, in this order:

1. `SUPABASE_URL` / `SUPABASE_KEY` present.
2. **Key class** — `assertAnonKey`, **imported, never copied** (see the extraction below). Note
   what it cannot do: it asserts the key's _class_, never its _ownership_ — `PROD_SUPABASE_KEY` is
   also `sb_publishable_`.
3. **Local host** — hostname ∈ {`127.0.0.1`, `localhost`}, before anything else touches the
   network, from the same imported module, preserving `preflight.ts:138`'s ordering comment.
4. **Mock generation** — assert `OPENROUTER_API_KEY` falsy **and** force `OPENROUTER_API_KEY: ""`
   into the returned map. The forcing is the guarantee, not the assertion:
   `astro/templates/env.mjs:26` maps `'' → undefined`, so the child cannot receive a key
   whatever the ambient environment holds — **with the one exception the merge above closes**: a
   `.dev.vars` key lands on top of the forced value inside the child, so the assertion, not the
   forcing, is what covers that source.
5. **Cookie-name provenance** — derive `sb-${hostname.split(".")[0]}-auth-token` from the _same_
   asserted URL and expose it, so the setup project can check the artifact it wrote could pair
   with this server. It proves pairing, never liveness — the signed-in control does that.
6. **Browser binary** — `fs.existsSync(chromium.executablePath())`, mapped to a message naming
   `npx playwright install chromium`. **Last**, so a missing browser never masks the data-safety
   seams above.

Failure messages follow `preflight.ts`'s shape: what is wrong, why it matters, what to do.

**The two shared predicates are EXTRACTED, not duplicated** — a new
`tests/setup/env-assertions.ts` holding `assertAnonKey` (today `preflight.ts:33-65`) and
`assertLocal` (`:79-94`), imported by **both** `tests/setup/preflight.ts` and this module.
Copying them verbatim would put the guard that decides whether a key bypasses RLS in two places
with nothing keeping them in step, which is the class §6.6 records the cost of four times ("the
sweep was found incomplete twice by reading, not by a red run") and which this repo single-sources
everywhere else (`deck-limits.ts`, `generation-limits.ts`). Only `preflight.ts:1`'s
`astro:env/server` import blocks reuse; the predicates themselves take a string and throw.
`assertMockGeneration` does **not** move — it reads the Astro env and stays with the caller that
has one.

Two things the extraction must carry. `fail()`'s `HINT` text is preflight-specific, so the shared
module takes the message formatter (or emits a neutral message and lets each caller frame it) —
the e2e refusal must name `npx playwright install chromium` and `.dev.vars`, not
`npm run db:start`. And the edit touches the file every Vitest run depends on, so it is
**behaviour-neutral only if a green run says so**: the only confirmation available is that the
whole suite stays green across it, the same way C10X-27 confirmed the `enable_fuzz` line.

#### 2. The config

**File**: `playwright.config.ts`

**Intent**: Call `resolveE2eEnv()` at module scope, own the dev server, make `trace` actually
reachable, and declare the project graph the next two phases fill in.

**Contract**: `webServer` with `command: "npm run dev"`, `url: "http://localhost:4321"` (**never**
`127.0.0.1` — the server binds IPv6 loopback only), `env` = the resolved map, `reuseExistingServer`
**left unset**, and a `timeout` sized for a cold Astro/workerd boot.

**`trace` is fixed by keeping `retries: 0` and switching to `retain-on-failure`**, which fires
without a retry. The two available repairs are not equivalent and the plan decides rather than
handing the implementer a coin-flip: a non-zero `retries` on a human-triggered, **never-a-gate**
layer would hide exactly the flakes this project treats as findings — §6.2's "a red under a fresh
seed is normally a real inter-`it()` dependence", and C10X-39, which spent a whole change measuring
a transport flake instead of retrying past it. The comment states that reason, not just the
mechanism, because the mechanism alone reads as arbitrary and invites the retry back.

**Projects — and the two silent failures the graph invites.** `setup` → `chromium`
(`dependencies: ["setup"]`) → a `teardown` project wired as `chromium`'s `teardown`.

- **Both non-spec projects need an explicit `testMatch`** (`/.*\.setup\.ts/`,
  `/.*\.teardown\.ts/`). Playwright's default pattern requires `.test.` or `.spec.` in the
  filename, which `auth.setup.ts` and `cleanup.teardown.ts` do not carry — so a setup project
  without one collects **zero** tests, and `dependencies: ["setup"]` on an empty project passes
  trivially. A green run that produced no session.
- **`storageState` moves OUT of top-level `use`** (`playwright.config.ts:7`) into the `chromium`
  project only, with `setup` and `teardown` explicitly `storageState: undefined`. Left in `use`,
  every project inherits it and the setup project fails to create a context when the file it
  exists to produce is missing — precisely the state criterion 3.1 creates on purpose. Note the
  one spec that overrides it locally, `route-guard.spec.ts:48`, keeps doing so.

Phase 3 stands the projects up; Phase 1 may land the graph with a placeholder setup that only
asserts reachability — but it lands with the `testMatch` entries from the start, or the placeholder
is indistinguishable from an empty project.

#### 3. The entry point

**File**: `package.json`

**Intent**: Give the layer the one command §4's e2e row currently has to describe as absent.

**Contract**: `"e2e": "playwright test"` — the `eval` idiom (a second run path, never part of
`npm test`). No `postinstall`; the browser install stays a documented one-off that the preflight
names when it is missing.

#### 4. Artifact classes

**File**: `.gitignore`

**Intent**: Close deferral (1) while this phase is the one touching reporters and `outputDir`.

**Contract**: Add `playwright-report/`, `blob-report/`, a root-anchored `.last-run.json` and
`*-snapshots/`. Follow the existing entries' **path anchoring** (`/test-results/`,
`/.playwright-cli/`) deliberately or deliberately not, and say which in a comment — an anchored
ignore does not cover a moved `outputDir`. These are **latent** today (the default reporter
produces none of them); the note should say so, so the next reader does not read them as observed.

#### 5. The pure half's test

**File**: `tests/lib/e2e-env.test.ts` (new)

**Intent**: Make the assertions falsifiable without spawning a browser or a server.

**Contract**: Mirrors `tests/lib/typecheck.test.ts` — relative import with the `.ts` extension and
a header comment citing §6.1 on why it sits in `tests/lib/`. It drives **`buildE2eEnv`**, never
`resolveE2eEnv` — that is what makes the next sentence achievable rather than aspirational.
Every input is **fabricated**; the
real environment appears in no assertion (§6.1's C10X-34 rule: the state that matters is usually
the one the runner is not in). Cases: a cloud host rejected, `127.0.0.1` and `localhost` both
accepted, an `sb_secret_` key rejected, a JWT with `role: service_role` rejected, a set
`OPENROUTER_API_KEY` rejected, the returned map carrying `OPENROUTER_API_KEY: ""`, the derived
cookie name for both accepted hosts, **a `.dev.vars` layer carrying a cloud `SUPABASE_URL` over a
perfectly valid `.env` rejected — with the message naming `.dev.vars` rather than `.env`, because a
refusal that points at the wrong file is the C10X-43 trap — and the same layer carrying an
`OPENROUTER_API_KEY` rejected**, and — load-bearing — a **positive control**: a fully valid local
map resolves clean. Without it, a function that rejects everything satisfies every rejection case.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` exits 0 and its `Result (N files)` count is recorded as observed
- `npm run lint` exits 0 (the 3 pre-existing `no-console` warnings in `evals/` unchanged)
- `npm test` green; the new `tests/lib/e2e-env.test.ts` cases pass and the suite total is recorded as observed. This run is also the **only** available confirmation that extracting `assertAnonKey`/`assertLocal` out of `preflight.ts` was behaviour-neutral — a red here means the refactor, not the new file
- `npm run e2e` starts the dev server itself and completes, with **no** hand-started server running — and `npx playwright test --list` shows the `setup` project collecting a **non-zero** number of tests, because an empty setup project satisfies `dependencies: ["setup"]` silently
- Breakage: point `SUPABASE_URL` at a cloud host → the config **throws before any server starts** (evidenced by the absence of a dev-server line in the output), restored and verified by hash
- Breakage: start `npm run dev` by hand, then `npm run e2e` → Playwright's `"… is already used"` hard error, not a silent attach
- Breakage: rename the chromium binary directory → the S7 message naming `npx playwright install chromium`; restored
- Breakage: write a `.dev.vars` carrying a cloud `SUPABASE_URL` on top of a valid `.env` → the config throws **before any server starts** and the message names **`.dev.vars`**, not `.env`; delete the file and confirm green. Record that the file did not exist beforehand, so the restore is a deletion rather than a revert

#### Manual Verification:

- The `PROD_` swap is exercised by hand: put `PROD_SUPABASE_URL` into `SUPABASE_URL`, run `npm run e2e`, confirm the refusal names the host and that **no** request reached it; swap back and confirm green
- The failure text of each refusal is read as a developer would read it — does it name the fix, or does it diagnose the wrong file (the C10X-43 `pre-push` trap)

**Implementation Note**: Pause after this phase for manual confirmation before proceeding.

---

## Phase 2: Enforcement — the conventions stop depending on a reviewer

### Overview

Two guards land **before** the specs are authored, so the rules shape them rather than describe
them.

### Changes Required:

#### 1. Runner isolation

**File**: `tests/lib/e2e-isolation.test.ts` (new)

**Intent**: Close harness finding 4. Today the two runners are separated by a filename infix alone,
inside one directory, with nothing asserting it in either direction — weaker than the eval, whose
separation is a second config's `include` plus two preflights failing in opposite directions.

**Contract**: Assert that no file under `tests/e2e/` matches Vitest's `include`
(`tests/**/*.test.ts`, `vitest.config.ts:27`) — a `tests/e2e/foo.test.ts` would be collected by
**both** runners, and this node-only suite would then try to run a browser spec. Assert the
converse too: `testDir` is `./tests/e2e` and no spec lives outside it. Two positive controls, per
this file's own history of guards that were correct about what they looked at and silent about
what they never looked at: the walker must reach the files that exist (a non-zero count), and the
predicate must fire on a fabricated `.test.ts` path. Non-spec helpers under `tests/e2e/setup/`
must stay legal — the rule is about Vitest's `include`, not about the directory's contents.

#### 2. Lint rules for the layer

**File**: `package.json`, `eslint.config.js`

**Intent**: Make the five `/10x-e2e` anti-patterns lint-enforced instead of review-enforced.
`tests/e2e/**` is already under full type-aware `strictTypeChecked`; only the Playwright-specific
rules are missing.

**Contract**: Add `eslint-plugin-playwright` as a devDependency and enable its recommended config
scoped to `tests/e2e/**`. Record which rules fire on the existing specs **before** editing them —
a red here is a finding about the exemplar, not noise to silence. If a rule must be disabled,
disable it at the site with the reason, never globally.

### Success Criteria:

#### Automated Verification:

- `npm run lint` exits 0 after any triage; the pre-existing warning count is recorded as observed
- `npm test` green; `tests/lib/e2e-isolation.test.ts` passes with both positive controls
- Breakage: create `tests/e2e/scratch.test.ts` → the isolation guard goes red naming the file; delete it and confirm green
- Breakage: add a `page.waitForTimeout(100)` to a spec → `npm run lint` goes red on the Playwright rule; remove it
- `npm run typecheck` exits 0

#### Manual Verification:

- The isolation guard's message tells a reader **which** rule was broken and how to fix it, not merely that a path matched

**Implementation Note**: Pause after this phase for manual confirmation before proceeding.

---

## Phase 3: A reproducible session, and cleanup that survives a failure

### Overview

Replace the hand-made, undocumented `user.json` with a producer, and replace inline cleanup with a
lifecycle. This is the half of sub-phase 6.1 that needs a running server.

### Changes Required:

#### 1. The e2e account

**File**: `tests/e2e/setup/account.ts` (new)

**Intent**: One stable, dedicated account (D-01), reproducible on a fresh checkout with no env
surface.

**Contract**: A hardcoded email and password as module constants, following
`tests/fixtures/accounts.ts:34-62`: `signUp` tolerating `user_already_exists`
(`isAlreadyRegistered`'s shape), then use. Not a secret — the config-time preflight forbids a
non-local stack, which is the same reasoning that lets `accounts.ts` hardcode
`harness-passw0rd`. The header states the accepted price of D-01 explicitly: **the account carries
state between runs, so no spec may assume an empty starting deck list.**

Do **not** attempt to import `tests/fixtures/session.ts` or `src/lib/supabase.ts` — both import
`astro:env/server`, which a plain Node loader rejects (`ERR_UNSUPPORTED_ESM_URL_SCHEME`,
measured). `tsconfig` `paths` do resolve under Playwright; the Astro virtual modules are the
blocker.

#### 2. The session producer

**File**: `tests/e2e/setup/auth.setup.ts` (new)

**Intent**: Mint `playwright/.auth/user.json` through the real UI, so name, value, encoding,
chunking, domain, path and expiry all come from the app and the browser — satisfying
`lessons.md`'s "never hand-assemble the session cookie" **by construction** rather than by care.

**Contract**: A Playwright `setup` project test that asserts Supabase reachability first (port
`assertReachable` from `preflight.ts:121-131`, after the config's local-host assertion, preserving
that ordering), signs the account in through `/auth/signin`, **asserts a signed-in DOM fact**, and
only then calls `context.storageState({ path })`. Then a cheap offline check that the written
cookie's name equals the name the config derived — pairing, not liveness.

The header carries one sentence on the durability research measured: today's artifact survives on
GoTrue answering reuse of a revoked parent with its existing child, which is not a contract this
project owns, and any `npx supabase stop` / `db:reset` kills it outright. That is context for a
reader of a red run, not a mechanism to build on.

#### 3. The created-row registry

**File**: `tests/e2e/fixtures.ts` (new)

**Intent**: Give specs a place to declare what they created, so cleanup is not their job.

**Contract**: Extends Playwright's `test` with a worker-scoped fixture that records deck
identifiers (or the run-unique `Date.now()` name suffixes that already scope them) to a location
the teardown project reads. Unique suffixes **stay** — they are what makes re-runs and parallel
workers non-colliding, and what lets a teardown scope itself to the rows this run created.

**Two mechanics, both forced by the fact that workers are separate PROCESSES.** A "worker-scoped
fixture" cannot hand anything to the teardown project in memory, so the registry is on disk — and a
single shared file would take concurrent appends from every worker.

- **Register the NAME before the row is created, never after.** The name is minted first
  (`E2E deck ${Date.now()}`), so registering it costs nothing and closes the window that produced
  the incident this file exists for: a spec that dies between the create and the record orphans the
  row exactly as `E2E deck 1785947414992` was orphaned. Registering after creation reproduces the
  bug one layer up.
- **One file per worker, under `outputDir`.** Safe by the ordering already established in Key
  Discoveries: `removeOutputDirs` runs **first**, before any worker starts, so the directory is
  clean at the start of the run and nothing wipes it mid-run. The teardown reads every file in the
  directory, unions them, and de-duplicates.

**The residual risk is named rather than closed**: a worker killed between the registration write
and its flush still loses that entry. That is strictly narrower than the inline pattern it replaces
— which lost the row on any failure at all, not only a hard kill — and it belongs in §6.6's
does-NOT-prove list rather than in a comment nobody reads.

#### 4. The teardown

**File**: `tests/e2e/teardown/cleanup.teardown.ts` (new)

**Intent**: Remove this run's rows even when a spec died before its last line — the exact mode that
orphaned `E2E deck 1785947414992`.

**Contract**: A project wired as `chromium`'s `teardown`, so it runs after the dependent project
regardless of outcome. It is **RLS-aware**: it acts as the same e2e account that owns the rows, and
uses no service/secret key — RLS is the only lock in this app, and the config-time key assertion
refuses a non-anon key for that reason. It must be idempotent and must not fail the run when there
is nothing to remove.

**It removes TWO tables, not one, and the second is the one a deck-scoped teardown cannot reach.**
`flashcard.deck_id` cascades from `deck` (`init_core_schema.sql:60`) and `flashcard_schedule`
cascades from `flashcard` (`srs_study_schedule.sql:36`), so deleting the deck takes the cards and
their schedules with it. **`generation_session` has no deck FK at all** — it references
`auth.users` only (`generation_session.sql:24`), and `flashcard.generation_id` is
`on delete set null` (`:47`). So every journey-A run leaves one session row behind, permanently,
on the stable D-01 account: unbounded growth on exactly the axis this phase exists to stop. The
owner already has a DELETE policy (`generation_session.sql:73-74`), so the fix needs no migration
and no privilege change — the teardown deletes this run's sessions as the same account. **Scope by
a short leading marker inside `source_text`, never by the whole value**: a PostgREST filter
carrying a long value answers **414** before the query runs (§6.6's C10X-28 trap), and journey A's
source text is deliberately long.

#### 5. The exemplar moves off inline cleanup

**File**: `tests/e2e/seed.spec.ts`

**Intent**: The file `/10x-e2e` learns conventions from must stop teaching the pattern that failed.

**Contract**: The `:36-42` inline delete is replaced by registration with the fixture; the `toPass`
`openModal` helper and every locator stay. Its comment gains the reason — a mid-test failure skips
inline cleanup permanently, and that has already happened once, with the date.

### Success Criteria:

#### Automated Verification:

- `npm run e2e` green from a tree with `playwright/.auth/user.json` **deleted** — the producer creates it
- The written file is a real session: exactly one cookie, name matching the config's derivation, domain `localhost`
- Row-count oracle, **two counts and not one** (a total and its breakdown are two claims): count this account's `deck` rows **and** its `generation_session` rows before and after a full `npm run e2e`; each delta is **0**. A deck-only count reads green over the table with no deck FK — see Phase 3 §4
- Breakage: force the setup project's sign-in to fail (wrong password constant) → the setup fails loudly **and no `user.json` is written**; restore and confirm green. The red must not be a downstream locator timeout
- Breakage: make a spec throw after creating a deck → the run is red **and** both deltas are still 0; restore
- `npm test`, `npm run lint`, `npm run typecheck` all green

#### Manual Verification:

- Delete `user.json`, run `npm run e2e`, and confirm from the browser that the setup project genuinely drives the sign-in form rather than short-circuiting
- Confirm in Studio that a full run leaves no `E2E …` deck behind

**Implementation Note**: Pause after this phase for manual confirmation before proceeding.

---

## Phase 4: Journey B — the guard is mounted and runs on a real navigation

### Overview

Adopt `route-guard.spec.ts` with the seven named edits. Its mandate is **not** "`PROTECTED_ROUTES`
has a test" — `tests/middleware.test.ts` has driven `it.each` over the real imported array on both
branches since C10X-27. Its mandate is that `onRequest` is invoked by the runtime at all, which no
existing layer can see: the Container API mounts `NOOP_MIDDLEWARE_FN` and renders only
`routeType: "endpoint"`.

### Changes Required:

#### 1. The spec

**File**: `tests/e2e/route-guard.spec.ts` (adopt — currently untracked)

**Intent**: Land it as this phase's deliverable with its seven audited defects fixed.

**Contract**, in order of importance:

- **E1 (blocking)** — the public-route control asserts **presence**, not merely the absence of a
  sign-in heading: `getByRole("heading", { name: "10xCards" })` (`Welcome.astro:32-36`). As
  written it passes green over an app returning 500 on `/` — i.e. over "padnięty Supabase", the
  class its own comment claims to cover. Same shape as §6.6's four-policy neuter:
  absence-in-an-unbounded-set is not falsifiable.
- **E2** — the `/api/*` exclusion rationale at `:32-33` is **false as written**. "guard odpowiada
  tam w innej konwencji (401 JSON)" does not hold for a document navigation:
  `src/middleware.ts:20-21` makes the _caller_ the discriminator, so `page.goto("/api/decks")`
  gets a 302. The true reason is only the first half — a user's browser does not go there.
- **E3** — add the fourth "Sign in" ambiguity: `Topbar.astro:27-29` renders an `<a>Sign in</a>`,
  the only one of the four standing on the public-route control's own path, and therefore the one
  that actually proves role-scoping is load-bearing.
- **E4** — the CLEANUP claim at `:20-22` ("nie tworzy ani jednego wiersza w bazie") is false for
  the signed-in control: `getUser()` on an expired token triggers a refresh, which touches
  `auth.refresh_tokens`. True as written for the _application_ tables; scope it that way.
- **E5** — give `waitForURL` an explicit timeout. `navigationTimeout` defaults to 0, so a failure
  hangs to the 30 s test timeout with a generic message — 2.5 min per deliberate-break run instead
  of 25 s.
- **E6** — harden `/:\d+\/$/` at `:72`, which requires an explicit port in `baseURL` and couples
  the case to the environment.
- **E7** — record the hardcoded route copy's **second** side in the comment. The copy is the
  **only** oracle for _removing_ an entry from `PROTECTED_ROUTES`, because `it.each` over the real
  array simply loses a row and stays 100% green. The test-plan describes the copy purely as a
  cost; without this note the first tidying reader deletes it as debt.
- The signed-in control's comment (`:79-82`) is re-based on Phase 3: the artifact now has a
  producer, so a red there is again evidence about the guard.

### Success Criteria:

#### Automated Verification:

- `npx playwright test route-guard.spec.ts` green, 7 cases, both controls included
- Breakage **A** (the discriminator): delete `"/study"` from `src/middleware.ts:13` → **1 of 7 red**, that route only, on `waitForURL`; both controls green; and `npm test` **100% green** — the asymmetry is what proves this layer sees something no other layer does. Restore, verified by hash
- Breakage **C** (the pair, per §6.10): force the guard predicate to `true` → **1 of 7 red**, on the **public** control, i.e. a different case failing on a different assertion. Restore
- Breakage **E1's own falsification**: with E1 in place, make `/` answer 500 → the public control goes red; without E1 it stays green. Record both halves — the green is the evidence
- `npm run lint`, `npm run typecheck` green

#### Manual Verification:

- Read breakage B (`mv src/middleware.ts …off`) as the mandate's own class and record it: predicted 5 of 7 red, but it **cannot** leave vitest green, because `tests/middleware.test.ts:3` imports from that module — the two layers differ by _kind_ of red (module-resolution vs behavioural), not by colour. Run it or state explicitly that it was reasoned, not run

**Implementation Note**: Pause after this phase for manual confirmation before proceeding.

---

## Phase 5: Journey A — an accepted card survives a reload

### Overview

The generation → review → accept → deck-page path, asserted where the accept becomes visible. This
journey extends into a coverage hole §6.6's Phase 1 entry still lists as open after C10X-27: the
`.astro` page loaders that §6.4 records as deliberately never rendered.

### Changes Required:

#### 1. The spec

**File**: `tests/e2e/accepted-card-survives-reload.spec.ts` (new)

**Intent**: Prove that accepting a candidate makes it part of the deck, and that it is still there
after a reload — through the real UI, on both accept paths.

**Contract**: Create a deck (or generate into a new one), generate N candidates in mock mode, follow
the `link` named **`Przejrzyj kandydatów`** (`GeneratorForm.tsx:371`) to
`/decks/<deckPublicId>/review?generation=<sessionPublicId>`, accept **one card via its per-card
button**, then the remainder via the **bulk toolbar**, and assert on the deck page.

The oracle is a content-free count of `getByRole("button", { name: "Edytuj", exact: true })`,
**asserted only while the browser is on `/decks/<publicId>`** — `Edytuj` also renders once per
candidate on the review screen (`CandidateItem.tsx:287`), so the count is an oracle of the deck's
contents only there. The measurement is **0 → 1 → N**, then `reload()` → still N. Each step
asserts a distinct expected number, so a red names which transition failed.

Why this is a real before/after oracle rather than a proxy: `listFlashcards` filters
`.eq("state_id", STATE_ACCEPTED)` (`src/lib/flashcards.ts:97-104`), so a generated card is
invisible on the deck page at all — the zero point is genuine, and an SSR probe of a real 0-card
deck returned `Edytuj` ×0.

Hazards this spec must honour, each measured:

- **`exact: true` everywhere it counts.** The per-card button is bare `Akceptuj`; the bulk button is
  `Akceptuj (3 fiszki)`, and Playwright's default substring matching makes the bare name match
  both.
- **Do not count `Usuń`** — it over-counts by one under `getByRole` (the deck-delete button in the
  sticky header) and by two in the raw DOM (a third inside a closed `<dialog>`).
- **Do not assert card content.** `mockCards` is byte-identical across calls, so two generations
  into one deck produce duplicate fronts. State the reason as "not run-unique", not "not indexed"
  — it _does_ vary by index within a call.
- **Do not use the manual-create shortcut.** `CreateFlashcardModal` → `/api/decks/[publicId]/cards`
  writes `state_id: STATE_ACCEPTED` directly, so it never produces the `generated → accepted`
  transition that the word "accepted" in this journey means. Useful only as a cheap positive
  control.
- **The review screen self-reloads** (`CandidateReviewWorkspace.tsx:138`
  `window.location.reload()` on the accept branch), so hydration must be re-awaited after each
  accept — reuse the `toPass` helper, never a timeout. This is also why the review screen is
  **not** the oracle: an assertion there would partly assert what the application performs for the
  test, and its acceptance-metric line hides silently on an aggregate error, so its presence is
  evidence while its absence proves nothing.
- The deck is registered with Phase 3's fixture; there is no inline cleanup.

### Success Criteria:

#### Automated Verification:

- `npx playwright test accepted-card-survives-reload.spec.ts` green
- Breakage: remove the `state_id = STATE_ACCEPTED` filter from `listFlashcards` → the **0** assertion goes red (generated cards become visible before any accept), while journey B stays green. Restore, verified by hash
- Breakage: break the accept transition (make the batch endpoint's `setState` a no-op) → the 0 → 1 assertion goes red on the count, and the reload assertion is never reached. Restore
- Breakage: drop `exact: true` from the counting locator → record what it does. If it stays green, say so — that is a finding about the assertion's strength, not a pass
- `npm run e2e` green end to end (both journeys, setup and teardown), with **both** deltas 0 — `deck` and `generation_session`. Journey A is the run that writes the second one, so this is the criterion where a deck-only oracle would have read green over it
- `npm run lint`, `npm run typecheck`, `npm test` green

#### Manual Verification:

- Watch one run headed and confirm the accepted card is the one that appears — the count alone cannot say _which_ card crossed
- **Measure**, do not assume, what Ctrl-C mid-journey does, and record the answer as observed. The criterion used to read as a guarantee ("leaves no orphaned deck") and nothing established it: a teardown **project** is a dispatcher phase and a SIGINT interrupts the run, and on this machine Playwright's own `webServerPlugin` throws `"Graceful shutdown is not supported on Windows"`, so the interrupt path here is not the documented happy one. If the teardown does run, say so with the run behind it; if it does not, that is a **named gap** for §6.6's does-NOT-prove list — the registry's residual risk (Phase 3 §3) with a second way to reach it — never a criterion quietly dropped

**Implementation Note**: Pause after this phase for manual confirmation before proceeding.

---

## Phase 6: Doc-sync and bookkeeping

### Overview

The largest single piece of writing in this change, and the one this project judges most harshly.
Two rules govern every edit: a **live claim** is edited, a **dated record** takes an appended
correction and is never rewritten (the C10X-30 "4xx" precedent); and a **total and its breakdown
are two claims**, so every count is produced by running something, never by arithmetic (§8's
repeated self-catches against C10X-39, C10X-40, C10X-42).

### Changes Required:

#### 1. The cookbook

**File**: `context/foundation/test-plan.md` — new **§6.11**

**Intent**: Close deferral (2). §6 currently carries two trap sentences about e2e and no procedure.

**Contract**: Placed after §6.10 so every existing §6.x anchor keeps pointing where it did. Covers:
location and the `.spec.ts` suffix rule (and the isolation guard that now enforces it); how to run
one file; that the local stack must be up and the config-time preflight will say so; the account's
shared state (no spec may assume an empty deck list); registering created rows with the fixture
instead of cleaning up inline, **with the orphaned-deck incident as the reason**; the locator
hazards (`exact: true`, the `role="alert"` banner on every authenticated page, `Edytuj` on two
pages, `Usuń`'s N+1, `searchbox` not `textbox`); the `toPass` hydration helper; and the
deliberate-breakage expectation. Verification trap already recorded: check with
`grep -cF "### 6.11"` — the `-F` and the heading prefix are both load-bearing.

#### 2. The phase, the stack, the gate

**File**: `context/foundation/test-plan.md` — §3, §4, §5

**Intent**: Make the three sections say in one voice what is now true.

**Contract**:

- **§3 Phase 6** → `complete`, dated, with the change folder. Its sequencing note records which of
  the nine harness findings this change closed and which it deliberately did not, and states the
  ordering discovery (plugin setup precedes `globalSetup`) that moved the preflight from
  `globalSetup` into the config — because the note as written hands the phase a design that would
  have been late.
- **§4's e2e row** → rewritten, with **two** stale clauses fixed: it says "plus **one spec**"
  (there are two) and "nothing runs it" (there is now a script, a `webServer` and a preflight).
  New `checked:` date. `@playwright/test` version re-verified against the installed value;
  `eslint-plugin-playwright` added to the a11y/lint picture or to §4 as the layer's lint tool —
  **and the row says what that buys**: the layer's source is now type-checked and lint-checked in
  CI while the layer itself still never runs there. Same sentence shape as §6.6's C10X-43
  correction, so the next reader cannot mistake a green `ci` for an executed journey.
- **§5's e2e row** → still **never a gate**. The paragraph beneath it already warns that
  `never a gate` must not soften into `required — wired by §3 Phase 6` the day the phase lands;
  this is that day, and the row must survive it. Only the `Where` cell changes: it no longer
  describes a command nobody can run.

#### 3. The per-phase note and the ledger

**File**: `context/foundation/test-plan.md` — §6.6, §8

**Intent**: Record what this change proves and, at equal length, what it does not.

**Contract**: A §6.6 entry with the claims table, every breakage split **with its denominator and
observed failure string**, and a does-NOT-prove list naming at minimum: this layer is never a gate
and is not watched; the account carries state between runs; `reuseExistingServer` unset is what
makes the local-host assertion binding, so a hand-started server is outside the guarantee; the
storageState durability rests on GoTrue behaviour this project does not own; two journeys exercise
at most two islands on one happy path each while four carry a `fetch`, so §7's islands exclusion
survives; and the 5459-deck debt is stopped, not repaid.

Three more, each added by this change's plan-review and each easy to leave implied:

- **The specs' SOURCE is now CI-gated while the layer still never runs.** `eslint.config.js` is
  repo-wide and `npm run lint` is a fail-closed `ci` step, and `tests/e2e/**` has sat inside
  `npm run typecheck` since the 2026-08-05 refresh measured it. Adding `eslint-plugin-playwright`
  means a Playwright-rule violation reddens the `ci` job. That is the compiles-vs-runs distinction
  §6.6's C10X-43 correction already had to make once: **the gates say the layer compiles and lints,
  never that anything ran it** — and it is not a softening of §5, because linting a file is not
  executing a journey.
- **The cleanup registry keeps a residual failure mode** (Phase 3 §3): a worker killed between the
  registration write and its flush still loses that entry. Strictly narrower than the inline
  pattern it replaces, which lost the row on any failure at all — but not zero.
- **What Ctrl-C does is whatever Phase 5's 5.8 measured**, written as measured. If the teardown
  project does not run on SIGINT, this is where that gap is named rather than left to be
  rediscovered.

A §8 entry with the suite totals **as run** (Vitest files only — Playwright specs enter no figure
here), the `no-console` warning count as observed, the typecheck `Result (N files)` as observed,
and the prerequisites/deferrals that remain open.

#### 4. §7's two e2e-keyed exclusions

**File**: `context/foundation/test-plan.md` — §7

**Intent**: Both were re-decided on 2026-08-05 with **restated** conditions. Check whether either
condition is now met and record the answer either way. **Three sites, not two** — the nested
deferral is the one a §7 sweep counting "exclusions" walks straight past.

**Contract**: The focus-ring exclusion's restated condition is "when a computed-style or
visual-diff oracle is actually wired" — this change wires **neither**, so it stands, and the
absence of an edit is recorded rather than left for a reader to hunt for. The islands exclusion's
restated condition is per-island, "when a spec actually drives that island's failure branch" —
journeys A and B drive happy paths, so it stands too. If either sentence is nonetheless stale in
wording (e.g. "§4 gained a Playwright runner … nothing reads a computed style through it"), edit
the wording and not the decision.

**The third site is the nested `scroll-padding-top` deferral, and it names THIS phase as its
owner**: §7's 2026-08-05 re-decision says "whoever wires the e2e layer under §3 Phase 6 inherits
the cheapest place to collect the evidence". "What We're NOT Doing" declines it, so the decline
needs a dated entry at the site — with the reason (it needs a browser check of Focus Not Obscured,
which is a manual matrix this change's two happy-path journeys do not produce, and WCAG 2.4.11 is
outside every oracle here) and with the ownership re-stated so it points at something reachable
rather than at a phase that has just closed. Recording the decline is what stops it reading as an
omission at `/10x-impl-review`; the two exclusions above already carry that treatment and this one
would be the only one that does not.

#### 5. README

**File**: `README.md`

**Intent**: The scripts list is a live claim and gains a command.

**Contract**: `npm run e2e` documented alongside the browser-install one-off, with the layer's
boundary in the same breath: local only, human-triggered, never a gate, and it starts its own dev
server. Follow the existing entries' habit of stating what a command does **not** prove.

#### 6. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Close deferral (3) and correct a claim this change makes half-false.

**Contract**: Create the **H-12** row for `e2e-harness-journeys`, matching the H-11 row's shape
exactly (`roadmap.md:65`) and the detail-section pattern beneath. Leave the Status flip and the
`## Done` entry to `/10x-archive` (`roadmap.md:401`) — creating the row is what gives the archive
something to close, and its absence is the H-04/H-07/H-08 debt the predecessor just incurred
again. Separately, correct **`roadmap.md:234`**, which asserts the project "nie ma warstwy e2e ani
visual-diff": now half false — a runner exists and is wired; visual-diff genuinely does not. Edit
the e2e half only, and leave the visual-diff half exactly as it stands.

### Success Criteria:

#### Automated Verification:

- `grep -cF "### 6.11" context/foundation/test-plan.md` returns 1
- `npx prettier --check` on every edited markdown file passes, and passes **again** on a second write (the C10X-43 non-idempotency trap: a code span split across a line break inside a blockquote loses its `> ` marker, and a span's padding is stripped — so no span may wrap inside a blockquote and no span's padding may carry meaning)
- `git status --porcelain -uall` lists only the intended paths — **never** `git diff`, which is blind to an untracked file (the trap that took the predecessor's count to 136)
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e` all green after the edits
- Every `file:line` and evidence path written into the docs is checked to resolve on disk

#### Manual Verification:

- §5's e2e row is read back specifically to confirm it still says **never a gate**
- Each figure written into §6.6 and §8 is traced to the run that produced it; anything not measured today is stated as dated or omitted
- The §4 e2e row's `checked:` date is not bumped past what was actually re-verified (§8 records this exact restraint as a decision)

**Implementation Note**: This is the final phase; confirm manually before `/10x-impl-review`.

---

## Testing Strategy

### Unit tests (Vitest):

- `tests/lib/e2e-env.test.ts` — the decidable half of the config-time preflight, every input fabricated, with a whole-map positive control
- `tests/lib/e2e-isolation.test.ts` — the runner separation, with a walker control and a fabricated-path control

### Browser tests (Playwright):

- `tests/e2e/seed.spec.ts` — the exemplar, migrated off inline cleanup
- `tests/e2e/route-guard.spec.ts` — journey B, 7 cases, two controls
- `tests/e2e/accepted-card-survives-reload.spec.ts` — journey A, 0 → 1 → N → reload

### Deliberate-breakage runs:

**Fifteen — counted by enumerating the Progress section, not carried over.** This line read
"eleven" while the phases listed fourteen, which is the total-versus-breakdown defect §8 records
against C10X-39, C10X-40 and C10X-42, committed here by the sentence naming the discipline; the
fifteenth is this review's `.dev.vars` run (1.8). Fourteen are automated criteria (1.5–1.8,
2.3–2.4, 3.4–3.5, 4.2–4.4, 5.2–5.4); the fifteenth is journey B's breakage B (4.6), which may be
run or explicitly recorded as reasoned. Each records the edit, the **observed failure string**, the
split **with its denominator**, and a restore verified by hash or `git diff`. The pairs matter more than
the singles: journey B's A-vs-C pair separates "the route left the array" from "the guard stopped
discriminating" by failing different cases on different assertions (§6.10's shape), and E1's own
falsification is the rare case where **the green half is the evidence**.

### Manual browser verification:

Per `context/archive/2026-07-31-deck-form-hardening/verification.md`'s bar: assertions on the DOM,
hydration polled rather than assumed, and a positive control that can actually go red. Recorded in
this change's `verification.md`.

## Performance Considerations

`webServer` adds a cold Astro/workerd boot to every `npm run e2e` (the reason `reuseExistingServer`
is tempting and the reason it is refused — see What We're NOT Doing). Size `webServer.timeout`
against a measured cold boot rather than a guess, and record the measurement.

The teardown adds one authenticated cleanup pass per run; on a database already holding 5459 decks,
scope its queries by the run's own suffix rather than by a broad predicate — an unbounded query
against this table is the same `max_rows` cliff §6.6 records as having turned an assertion
unfalsifiable while it stayed green.

## Migration Notes

No database migration. `playwright/.auth/user.json` is replaced by a produced artifact — delete the
hand-made file once Phase 3 lands, so the producer is exercised rather than shadowed. The
`test@mail.com` account and the 5459 accumulated decks are left in place by decision.

## References

- Research: `context/changes/e2e-harness-journeys/research.md`
- Decisions D-01 (account + teardown) and D-02 (branch prerequisite): `context/changes/e2e-harness-journeys/change.md`
- The phase's mandate and the nine harness findings: `context/foundation/test-plan.md` §3 Phase 6
- The gate boundary that must survive this change: `context/foundation/test-plan.md` §5
- Preflight to port from: `tests/setup/preflight.ts:33-65,79-94,121-131,138`
- Account convention: `tests/fixtures/accounts.ts:34-62`
- Pure-half test convention: `tests/lib/typecheck.test.ts:1-5`, `tests/lib/kong-keepalive.test.ts:1-11`
- Playwright task ordering and `webServer.env` precedence: `node_modules/playwright/lib/runner/index.js:6003-6010,823-834,851,858-862`
- Browser-evidence bar: `context/archive/2026-07-31-deck-form-hardening/verification.md:21-47`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Runner foundation — a preflight that precedes the server

#### Automated

- [x] 1.1 `npm run typecheck` exits 0, `Result (N files)` recorded as observed — deec1d6
- [x] 1.2 `npm run lint` exits 0, pre-existing warning count unchanged — deec1d6
- [x] 1.3 `npm test` green (also the neutrality check for the `preflight.ts` extraction); `tests/lib/e2e-env.test.ts` passes; suite total recorded as observed — deec1d6
- [x] 1.4 `npm run e2e` starts its own dev server and completes with none running by hand; `--list` shows the `setup` project collecting a non-zero number of tests — deec1d6
- [x] 1.5 Breakage: cloud `SUPABASE_URL` → config throws before any server starts; restored — deec1d6
- [x] 1.6 Breakage: hand-started server on 4321 → Playwright's "already used" hard error — deec1d6
- [x] 1.7 Breakage: chromium binary hidden → the `npx playwright install chromium` message; restored — deec1d6
- [x] 1.8 Breakage: cloud `SUPABASE_URL` in a `.dev.vars` over a valid `.env` → throws before any server starts, message names `.dev.vars`; file deleted, green — deec1d6

#### Manual

- [x] 1.9 `PROD_` swap exercised by hand: refusal names the host, no request reached it, swap back green — deec1d6
- [x] 1.10 Each refusal message read as a developer would — names the fix, does not diagnose the wrong file — deec1d6

### Phase 2: Enforcement — the conventions stop depending on a reviewer

#### Automated

- [x] 2.1 `npm run lint` exits 0 after triage; warning count recorded as observed — 95a460e
- [x] 2.2 `npm test` green; isolation guard passes with both positive controls — 95a460e
- [x] 2.3 Breakage: `tests/e2e/scratch.test.ts` → isolation guard red naming the file; removed — 95a460e
- [x] 2.4 Breakage: `page.waitForTimeout(100)` in a spec → lint red on the Playwright rule; removed — 95a460e
- [x] 2.5 `npm run typecheck` exits 0 — 95a460e

#### Manual

- [x] 2.6 The isolation guard's message names the rule and the fix, not merely a path match — 95a460e

### Phase 3: A reproducible session, and cleanup that survives a failure

#### Automated

- [x] 3.1 `npm run e2e` green with `playwright/.auth/user.json` deleted beforehand — 38a45d2
- [x] 3.2 Written artifact verified: one cookie, derived name, domain `localhost` — 38a45d2
- [x] 3.3 Two deltas across a full run are each 0: `deck` and `generation_session` — 38a45d2
- [x] 3.4 Breakage: setup sign-in forced to fail → loud failure, no `user.json` written; restored — 38a45d2
- [x] 3.5 Breakage: spec throws after creating a deck → run red, both deltas still 0; restored — 38a45d2
- [x] 3.6 `npm test`, `npm run lint`, `npm run typecheck` green — 38a45d2

#### Manual

- [x] 3.7 Headed run confirms the setup project drives the real sign-in form — 38a45d2
- [x] 3.8 Studio confirms no `E2E …` deck left behind after a full run — 38a45d2

### Phase 4: Journey B — the guard is mounted and runs on a real navigation

#### Automated

- [x] 4.1 `route-guard.spec.ts` green, 7 cases, both controls — cf5a724
- [x] 4.2 Breakage A: `/study` removed → 1 of 7 red on `waitForURL`, controls green, `npm test` 100% green; restored — cf5a724
- [x] 4.3 Breakage C: guard predicate forced true → 1 of 7 red on the public control; restored — cf5a724
- [x] 4.4 E1 falsification pair: `/` answering 500 → red with E1, green without; both halves recorded — cf5a724
- [x] 4.5 `npm run lint`, `npm run typecheck` green — cf5a724

#### Manual

- [x] 4.6 Breakage B run or explicitly recorded as reasoned, with the module-resolution-vs-behavioural distinction — cf5a724

### Phase 5: Journey A — an accepted card survives a reload

#### Automated

- [x] 5.1 `accepted-card-survives-reload.spec.ts` green
- [x] 5.2 Breakage: `STATE_ACCEPTED` filter removed → the 0 assertion red, journey B green; restored
- [x] 5.3 Breakage: accept transition no-oped → 0 → 1 red on the count; restored
- [x] 5.4 Breakage: `exact: true` dropped → result recorded as observed, green included
- [x] 5.5 `npm run e2e` green end to end, both deltas 0 (`deck` and `generation_session`)
- [x] 5.6 `npm run lint`, `npm run typecheck`, `npm test` green

#### Manual

- [x] 5.7 Headed run confirms the accepted card is the one that appears
- [x] 5.8 Ctrl-C mid-journey measured, not assumed: does the teardown project run on SIGINT? Answer recorded as observed, and as a named §6.6 gap if it does not

### Phase 6: Doc-sync and bookkeeping

#### Automated

- [ ] 6.1 `grep -cF "### 6.11" context/foundation/test-plan.md` returns 1
- [ ] 6.2 `prettier --check` passes on every edited markdown file, and again on a second write
- [ ] 6.3 `git status --porcelain -uall` lists only intended paths
- [ ] 6.4 `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e` green after the edits
- [ ] 6.5 Every `file:line` and evidence path written into the docs resolves on disk

#### Manual

- [ ] 6.6 §5's e2e row re-read and confirmed still **never a gate**
- [ ] 6.7 Every §6.6 / §8 figure traced to the run that produced it
- [ ] 6.8 §4's `checked:` date not bumped past what was re-verified
