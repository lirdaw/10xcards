---
date: 2026-08-05T20:18:55+02:00
researcher: lirdaw
git_commit: 5f3c87ed42776964fca93355f27122c59db2863e
branch: main
repository: lirdaw/10xcards
topic: "Refresh test-plan.md for the arrival of e2e — what is false today, what the harness actually is, and what the two journeys can assert"
tags: [research, codebase, test-plan, e2e, playwright, typecheck-gate, doc-sync]
status: complete
last_updated: 2026-08-05
last_updated_by: lirdaw
last_updated_note: "Open Questions resolved — six decisions recorded, see the closing section"
---

# Research: refreshing `test-plan.md` for the arrival of e2e

**Date**: 2026-08-05T20:18:55+02:00
**Researcher**: lirdaw
**Git Commit**: `5f3c87ed42776964fca93355f27122c59db2863e`
**Branch**: `main`
**Repository**: lirdaw/10xcards

## Research Question

`change.md` for this change opens a `/10x-test-plan --refresh` triggered by the arrival of a
Playwright layer. It asserts what is false in the guide, lists six harness risks, scopes two
browser journeys, and flags one item as `INFERENCE — confirm by measurement`. This research
answers four things: (1) is that inference true; (2) exactly which document sites are false,
and which way each must be corrected; (3) what the committed harness actually is, since at
least two of the six risks predate it; (4) what the two journeys can actually assert against
the real UI.

Scope agreed before starting: full — docs + harness + journey feasibility — and the extra
documents `README.md`, `AGENTS.md`, `roadmap.md`, `lessons.md`.

## Summary

**The brief's central inference is TRUE and is now measured.** `npm run typecheck` reports
`Result (135 files): 0 errors`; exactly two files were added since the last pre-e2e commit;
both are members of the resolved `tsconfig` project. The arithmetic closes in the same
decomposition the documents themselves use: **117 `tsc` roots + 18 `.astro` = 135** today,
against **115 + 18 = 133** as documented. So the e2e layer is already inside the type gate —
in CI on every push/PR to `main`, and on `pre-push` locally — and no document knows it.

**Five things this research corrects in the brief itself**, all found by measurement rather
than by reading it more carefully:

1. **AGENTS.md quotes no file total.** The brief says README _and_ AGENTS.md describe the gate
   as "133 files". `133` appears in exactly two places repo-wide, and AGENTS.md is neither.
   The second is `test-plan.md:2765`.
2. **Those two sites need OPPOSITE edits.** `README.md:49` is a live claim → corrected in
   place. `test-plan.md:2765` is a row in §6.6's dated C10X-43 claims table → takes a dated
   correction line and is not rewritten, per this file's own "4xx" precedent.
3. **`18 .astro templates` is still TRUE** (measured: 18). Only the total is false. The
   correct-the-false-half convention applies inside a single sentence.
4. **"No rollout phase claims e2e" is still TRUE**, and so is §5's "no §3 phase wires it, so
   listing it as a gate would be aspirational". The harness landed _outside_ the phased
   rollout, exactly like C10X-39/40/42/43. Consequence: §7's three re-evaluation triggers,
   worded "the moment any §3 phase wires e2e", have **not literally fired**. The refresh must
   close that loophole deliberately rather than claim the condition was met.
5. **Two of the six harness risks are stale**, and the brief's framing "uncommitted as of this
   handoff" no longer holds — the harness is committed (`8a12d07`, `5f3c87e`).

**The journey-B correction in the brief is right, and has independent corroboration.**
`tests/middleware.test.ts` does drive `it.each(PROTECTED_ROUTES)` over the real imported array
on both branches, and `lessons.md:135` ends with the rule that makes the gap explicit:
_"Nie testuj przez Container API tego, co robi middleware (np. guard `PROTECTED_ROUTES`) —
Container tego nie uruchomi."_ Journey B's mandate is "the guard is **mounted** and executes on
a real request", never "`PROTECTED_ROUTES` has a test".

**Journey A needs one scoping revision the brief does not anticipate.** The production accept
path already calls `window.location.reload()` on its success branch
(`CandidateReviewWorkspace.tsx:138`). So "the accepted card survives a page reload" is, on the
review screen, _what the app does by itself_. The journey's distinct claim has to be stated more
precisely, or the test asserts something the app performs for it.

**The harness is thinner than the six-risk list suggests.** Beyond the four risks that remain
live, three findings are new: `trace: "on-first-retry"` can never fire (no `retries`
configured, default `0`), there is no npm script and no browser-install step, and the seed spec
deletes a whole deck through the real UI against whatever database the hand-started dev server
points at — the exact seam `preflight.ts`'s `assertLocal` exists to close, with no equivalent
on the Playwright side.

**Bookkeeping is silent in all three places**: no roadmap row (next free **H-12**), no
`jira-map.md` row, no minted key (next free **C10X-45**).

## Detailed Findings

### 1. The measurement: the e2e layer is already type-gated

Three independent measurements, all run against this commit.

```
$ npm run typecheck
Result (135 files):
- 0 errors
- 0 warnings
typecheck: OK — 135 files checked (floor 50).

$ git diff --name-status ebe1d92 HEAD
M  .gitignore
M  package-lock.json
M  package.json
A  playwright.config.ts
A  tests/e2e/seed.spec.ts

$ npx tsc --showConfig     # both are resolved project members
        "./playwright.config.ts",
        "./tests/e2e/seed.spec.ts",
  → 117 root files, 0 of them .astro

$ git ls-files '*.astro' | wc -l
18
```

`117 + 18 = 135` today; `115 + 18 = 133` as documented at C10X-43. The delta is fully
attributed to the two e2e files, with no residue. The cause is `tsconfig.json:3` —
`include: ["**/*"]` with only `dist` and `context` excluded — which `test-plan.md:738-740`
already names as the reason "the local gate and CI agree on scope by construction". The same
line is why a new top-level directory enters the gate silently.

**Why the gate stayed green.** `test-plan.md:24-25` records that the wrapper asserts on the
`Result (N files):` line **against a floor**, not a pinned count. A floor cannot break when the
count rises. That is correct design and it is also why nothing announced the change.

Two consequences worth carrying into the plan:

- `tests/e2e/seed.spec.ts` is type-checked in CI on every push and PR to `main`, and blocks a
  local `git push`. No document states this. It is the same denominator rot §8 records against
  C10X-39 and C10X-40 — committed this time by the gate that C10X-43 built.
- ESLint also lints it (`eslint.config.js:53`, `files: ["**/*.{js,jsx,ts,tsx}"]`) and
  `lint-staged` auto-fixes it on commit (`AGENTS.md:31`), but **`eslint-plugin-playwright` is
  not installed**, so none of the five anti-patterns the `/10x-e2e` skill names (`waitForTimeout`
  chief among them) is lint-enforced.

### 2. The document edit surface

#### 2a. Denominator sites — two, needing opposite treatments

| Site                | Verbatim                                                                                                                                         | Status                                                                                                      | Treatment                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `README.md:49`      | ``…`astro check` over all 133 files (`src/`, `tests/`, `evals/`, `scripts/`, the root configs, and the 18 `.astro` templates `tsc` cannot see)`` | `133` **FALSE** (135); `18 .astro` **TRUE**; directory list **TRUE** (`tests/` now also holds `tests/e2e/`) | live claim → edit in place, false half only                                         |
| `test-plan.md:2765` | ``the gate is `astro check` (133 files) preceded by `tsc --noEmit` (115 roots)``                                                                 | both figures **FALSE** (135 / 117)                                                                          | §6.6 C10X-43 claims table = dated record → **dated correction line, not a rewrite** |
| `AGENTS.md:22`      | ``…the root configs and the 18 `.astro` templates at once… asserts on the checked-file count rather than the exit code``                         | **no total quoted** — nothing false; `checked-file count` survives (it is a floor)                          | no edit on this axis                                                                |

#### 2b. "e2e does not exist" sites

`Playwright` appears **zero** times in `README.md`, `AGENTS.md` and `test-plan.md`. `CLAUDE.md`
is the only file that already knows e2e exists (its `/10x-e2e` block) and contains no false
claim.

- **`test-plan.md:680`** — §4 Stack, the whole `e2e` row: `none yet — deliberately deferred`,
  version cell `—`, and `promote only if a risk survives cheaper layers`. All false. The row
  also carries no `checked:` date, which §4's own header (`:671-672`) requires. **Surviving
  clause: `No rollout phase claims e2e`** — literally still true (§3's table has no e2e row).
- **`test-plan.md:688`** — the tooling line: `Runtime/browser: claude-in-chrome — available;
not used, no §2 risk is DOM-unreachable and no phase claims e2e; checked: 2026-07-15`. The
  clause `no §2 risk is DOM-unreachable` was already contradicted by §7's focus-ring bullet
  when written; the date is stale.
- **`test-plan.md:710-712`** — §5's closing paragraph. `e2e on critical flows is deliberately
absent` is false; `Add it only if a risk survives the integration layer` is superseded. But
  **`no §3 phase wires it, so listing it as a gate would be aspirational` is accurate and now
  load-bearing**: the spec is in no CI job, no husky hook and no npm script, so it genuinely is
  not a gate. §5's gate table correctly has no e2e row.
- **`test-plan.md:4207-4212`** — §8's refresh triggers. Two of the four are met: "the project's
  tech stack changes (new test runner)" and "§7 negative-space no longer matches". Not the
  `checked:`-date trigger, which is what bounds this change's mandate.

#### 2c. Collection / naming claims that survive but now under-specify

- `test-plan.md:783-784` (§6.1): ``Only files matching `tests/**/*.test.ts` are collected``.
  Still true, but it no longer describes the whole of `tests/` — `tests/e2e/seed.spec.ts` lives
  inside `tests/` and is invisible to Vitest **only because of the `.spec.` infix**.
- The "npm test collects ZERO eval files" family (`test-plan.md:14`, `:344-346`, `:682`,
  `:2055-2057`, `:4033`) all survive verbatim. The gap is that **the identical statement for
  e2e is asserted nowhere**, and unlike the eval — whose separation is a second config plus a
  runtime preflight in both directions — the e2e separation rests on a filename suffix.
- Every suite total (`364/364, 31 files` at `:42-43` and `:4168`, plus ~27 historical ones) is
  a Vitest-only count and none is falsified. The risk to flag rather than fix: this file's own
  discipline ("a total and its breakdown are two claims") means the next entry must say whether
  `31 files` is Vitest-only, or the number becomes ambiguous the day someone counts `tests/**`.

### 3. §7 — the trigger that never literally fired

Exactly two §7 bullets carry an e2e-keyed trigger, plus one nested deferral whose blocker is
removed. Every other `Re-evaluate if…` clause in §7 is unfired.

- **`test-plan.md:3227-3243`, focus-ring rendering.** Conditional clause at `:3238-3240`. The
  adjacent clause `the e2e / visual-diff layer §4 and §5 deliberately do not have` (`:3237-3238`)
  is now **half false**: an e2e runner exists, visual-diff genuinely does not (no
  `toMatchSnapshot`, no Argos, no Lost Pixel). The guard sentence at `:3240-3242` — the measured
  contrast check, WCAG 1.4.11 only — survives, because `seed.spec.ts` asserts nothing about
  contrast.
- **`test-plan.md:3256-3258`**, nested inside that bullet's correction block: the
  `scroll-padding-top` fix for WCAG 2.4.11 was deferred because it _"needs its own browser
  verification"_. That blocker is now removed. `2.4.11 is Focus Not Obscured, and nothing tests
it` (`:3245-3246`) remains true.
- **`test-plan.md:3279-3293`, React islands' fetch handling.** Conditional clause at
  `:3292-3293`. Two framings are now false: `untested by _construction_` (`:3279`) and `no layer
in this plan could see the difference` (`:3287-3288`). The `reviewed by reading, deliberately
and every time` rule (`:3288-3292`) **survives** — one exemplar spec covers one flow, not the
  class.
- **`test-plan.md:3524`** carries the same clause but sits in **§8**, not §7 (the C10X-30 ledger
  entry on Risk #6's island half). Easy to miss when working a §7-scoped list.

**The loophole, stated plainly.** All three triggers say _"the moment any §3 phase wires e2e"_.
No §3 phase did — the harness landed as ordinary hardening work, the same way C10X-39, C10X-40,
C10X-42 and C10X-43 did. So a reader applying the triggers literally concludes nothing has
changed. The brief's decision (exclusions stay excluded, replacing the conditional clause with a
dated re-decision) is the right shape; the wording must acknowledge that the trigger was
**mis-keyed**, not that it fired.

One reusable detail buried in §7's fourth instance (`:3361-3364`): the deck page renders a
**second `[role="alert"]`** (the OpenRouter config banner), so an unscoped
`querySelector('[role="alert"]')` reads the wrong node and passes on it. That is written as a
manual-check caveat and is directly reusable as a Playwright locator rule.

### 4. Harness re-audit — the six risks against the committed tree

`playwright.config.ts` is 11 lines. Verdicts:

| #   | Risk                                           | Verdict                            | Evidence                                                                                                                                                       |
| --- | ---------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | No Playwright preflight                        | **LIVE**                           | no `globalSetup`, no setup project, no env assertion anywhere in the config; `globalSetup` exists only at `vitest.config.ts:32` and `vitest.eval.config.ts:45` |
| 2   | `storageState` has no producer                 | **LIVE, sharpened**                | `playwright.config.ts:7` is the only reference; `projects:` (`:10`) has no `dependencies`                                                                      |
| 3   | No `webServer`                                 | **LIVE**                           | hardcoded `baseURL: "http://localhost:4321"` (`:6`), nothing asserts a server is up or which env it loaded                                                     |
| 4   | Isolation from `npm test` is incidental        | **LIVE**                           | `vitest.config.ts:30` `tests/**/*.test.ts` vs `playwright.config.ts:4` `testDir: "./tests/e2e"`; no test asserts the separation                                |
| 5   | `test-results/` + `.playwright-cli/` unignored | **CLOSED**                         | `5f3c87e` added exactly `/test-results/` and `/.playwright-cli/` (`.gitignore:127-128`)                                                                        |
| 6   | One persistent account vs per-run accounts     | **LIVE, and inverted on one axis** | the harness never signs in at all — `seed.spec.ts:21` goes straight to `/decks`                                                                                |

Refinements that change what the plan must specify:

- **Risk 1 is worse than "no preflight".** `seed.spec.ts:36-42` deletes a whole deck through
  the real `Usuń talię` UI. `.env:7-9` documents the cloud-credential swap under a `PROD_`
  prefix, and `preflight.ts:68-77` names exactly that swap as the reason `assertLocal` exists
  with no env opt-out. In the swapped state, `npm run dev` + `npx playwright test` creates and
  deletes decks in **production**, and nothing stops it. `SUPABASE_URL` is local today
  (measured), so this is a live seam, not a live incident.
- **Risk 2 is not "the file is missing".** `playwright/.auth/user.json` exists on disk, 3032
  bytes, mtime 2026-08-04, gitignored at `.gitignore:125`, hand-made. Its single cookie is
  `domain: localhost`, name `sb-127…` — i.e. **the cookie name is derived from the
  `SUPABASE_URL` hostname**, which `test-plan.md` §6.4 states for `@supabase/ssr`. Change the
  URL (a port change, or the `PROD_` swap) and the cookie is simply not read: the run presents
  as signed-out and surfaces as a locator timeout, not a legible error. `lessons.md:138-143`
  is the measured rule for producing such a cookie properly.
- **Risk 6 inverts on the rate limit.** The e2e path issues **zero** auth requests per run, so
  the 30-sign-ins/5-min limit is not exposed at all — cheaper than Vitest on that axis. The
  price is the unreproducible cookie. Row growth **is** exposed: cleanup at `seed.spec.ts:36-42`
  is inline test-body code, not a fixture teardown, so any failure earlier in the test leaves an
  orphaned deck permanently, on the dev DB §6.6 already records at 1053 decks against
  `max_rows = 1000`.

**Three findings not on the six-risk list:**

- **`trace: "on-first-retry"` is inert.** `playwright.config.ts:8` declares it, but no `retries`
  is configured and Playwright's default is `0`. With zero retries there is never a first retry,
  so no trace is ever written — the only debugging affordance the config declares cannot fire.
- **No entry point and no browsers.** `package.json` has no `e2e`/`test:e2e` script (only
  `test`, `test:watch`, `eval`); `@playwright/test` sits at `package.json:51`, invocable only as
  `npx playwright test`. There is no `postinstall` and no `npx playwright install` anywhere, so
  a fresh clone has the runner and no browser binaries.
- **Unignored artifacts remain**: `playwright-report/`, `blob-report/`, a root-level
  `.last-run.json`, `*-snapshots/`, and any second auth-state file. None is produced today (the
  reporter is the default `list`/`dot`, and `.last-run.json` currently lands inside
  `test-results/`), so this is a latent rather than live hygiene gap — but the two ignores are
  path-anchored (`/test-results/`), so a moved `outputDir` is unignored.

What the seed spec gets right and is worth preserving as the pattern: role-based locators
throughout, no `waitForTimeout`, unique `Date.now()` names, a hydration-retry helper
(`seed.spec.ts:8-17`) that wraps modal opening in `toPass`, and dialog-scoped queries.

### 5. Journey A — feasibility

**The flow is not what the brief's wording implies.** There is no form POST and no redirect:
`GeneratorForm.tsx:171-176` does `fetch("/api/generate")` and puts the result in React state;
the page never navigates. The user then clicks an ordinary `<a href>` at `GeneratorForm.tsx:367`
to `/decks/<deckPublicId>/review?generation=<sessionPublicId>`. Accepting posts to
`/api/decks/<deckPublicId>/cards/batch` (`CandidateReviewWorkspace.tsx:106-114`) and then —
this is the scoping finding — **calls `window.location.reload()` itself** on the success branch
(`:138`), with `status` deliberately left `"pending"` so the controls stay inert until the
navigation lands.

So on the review screen, "the accepted card survives a reload" is already performed by the
application. The journey must either assert **after a second, test-driven reload**, or — better,
and closer to what the integration layer genuinely cannot reach — assert on the **deck page**,
whose loader is a different `.astro` frontmatter that no test in this project renders.

**Locators: no `data-testid` is needed anywhere on this journey.** Measured: zero
`data-testid` in the whole repo, and the complete `aria-label` inventory in `src/` is 11
occurrences. Every control on this path has a real accessible name:

- Generator: `combobox` "Talia docelowa" (`:216-235`), `combobox` "Język fiszek" (`:240-255`),
  `spinbutton` "Liczba kart" (`:260-272`), `textbox` "Nazwa nowej talii" (`:279-292`,
  conditionally rendered when the deck select is `__new__`), `textbox` "Tekst źródłowy"
  (`:298-321`), `button` "Generuj" → **"Generuję…"** while pending (`:328-335`, U+2026 ellipsis).
  **Do not hard-code the language option labels** — they come from the DB (`generate.astro:30`,
  `language.ui_label`); only `Ten sam co tekst` is a constant (`:36`).
- Review: `checkbox` "Zaznacz fiszkę N" (1-based, `CandidateItem.tsx:213-220`), `button`
  "Akceptuj"/"Odrzuć"/"Przywróć"/"Edytuj". The **bulk** accept button's name is composed with a
  Polish plural — `Akceptuj (3 fiszki)`, where 1 → `fiszkę`, 2-4 → `fiszki`, else `fiszek`
  (`CandidateReviewWorkspace.tsx:231`, `:50-56`) — so match `/^Akceptuj \(/`. The toolbar
  (`role="toolbar"`, `CandidateSelectionBar.tsx:42-45`) **renders `null` when nothing is
  selected**.
- Name collisions are the real hazard, not missing names: `Usuń` is both the deck-delete button
  and the confirm inside `ConfirmDeleteModal`; `Odrzuć` is both a card button and the confirm
  inside `ConfirmRejectModal`. Modals always render their `<dialog>` and open it with
  `showModal()`, so closed ones are `display:none` and excluded from role queries — but once
  open, scope with `getByRole("dialog", { name })`, as the seed spec already does.

**Content-free oracles, ranked:**

1. **The acceptance-metric line**, server-rendered at `review.astro:188-203`:
   `Zaakceptowano 3 z 5 — do przeglądu: 2, odrzucone: 0.` Best oracle — it survives a reload by
   construction. **Two preconditions a test must respect**: it renders only when the URL carries
   a resolvable `?generation=` (`:102-110`, `metric` is computed only `if (session && supabase)`,
   and `session` needs a UUID-shaped, resolvable id, `:59-71`); and a failed aggregate **hides
   the line silently** (`if (!error)`). So the line's _presence_ is evidence and its _absence_
   is ambiguous — never assert on absence here.
2. **The deck-list chip** at `decks/index.astro:61-68`: a `link` named `"3 do przeglądu"`,
   counting `state_id = generated` per deck, and **absent entirely when zero** — itself an
   assertable state.
3. **The deck page's state filter.** `listFlashcards` filters `state_id = STATE_ACCEPTED`
   (`src/lib/flashcards.ts:97-104`), so before acceptance the deck page shows
   `Brak fiszek w tej talii.` and after it shows N cards. A content-free count:
   `getByRole("button", { name: "Edytuj" })` is one per card and appears nowhere else on that
   page. **`Usuń` would over-count by one** — the deck-delete button in the sticky header.
4. **Review empty states**, three distinct strings (`CandidateReviewWorkspace.tsx:183-205`); the
   middle one, `Wszystkie fiszki z tej generacji zostały przejrzane.`, is the natural
   "I accepted them all" assertion.

**Waits.** Every island is `client:load`, so the hydration race is real and the seed spec's
`toPass` helper is the established answer. Generation pending: the submit button is `disabled`,
its name flips, and `role="status"` renders `Trwa generacja — to może potrwać kilka sekund.`
(`:348-352`). Generation done: `<section aria-label="Wygenerowane fiszki">` appears (`:360`)
with the `Przejrzyj kandydatów` link. **There is no spinner element and no `aria-busy` anywhere**
— the two waitable primitives are `role="status"` and `disabled`. Client timeout is 55 s
(`:25`), server ~40 s, but with `OPENROUTER_API_KEY` unset the server short-circuits to mock
cards and returns immediately. The **no-op branch** is a real failure signal to assert against:
if nothing moved there is no reload and `Nic nie zmieniono — te fiszki są już w tym stanie.`
renders instead (`:144`).

### 6. Journey B — feasibility

**The redirect.** `middleware.ts:77` — `context.redirect("/auth/signin")`, **no query parameter
of any kind** (no `?redirect=`, no `?next=`, no `?error=`). The guarded prefixes at `:7-15`
include `/decks`, so `/decks/<id>/review` is covered by prefix match. The JSON/document
discriminator (`:32-41`) checks `Sec-Fetch-Dest: document` **first**, so a real top-level
browser navigation deterministically takes the redirect branch and never the 401 JSON.

**Mounting is confirmed by reading, and nothing can bypass it.** `middleware.ts:43` exports
`onRequest` at the ordinary path; `astro.config.mjs` is `output: "server"` with the Cloudflare
adapter, and there is **no `prerender` anywhere in `src/pages/`**. `npm run dev` runs the real
workerd runtime. So the guard executes on every real request — which is precisely the claim no
existing layer reaches, and precisely what `lessons.md:135` says a Container-API test cannot
cover.

**The sign-in page is in English.** C10X-19's Polish sweep has not landed. `signin.astro:14-18`
is `<h1>Sign in</h1>`; the form's submit is also named "Sign in" and the document `<title>` is
"Sign in" — **three ambiguous matches**, so the oracle must be
`getByRole("heading", { name: "Sign in" })`, never a bare `getByText`. `PasswordToggle.tsx:14`
adds a "Show password"/"Hide password" button inside the password field. Password inputs carry
no `textbox` role — use `getByLabel("Password")`.

**No client-side router exists** (zero hits for `ClientRouter`, `ViewTransitions`,
`astro:transitions`, `prefetch`), so a redirect cannot be swallowed. The strongest oracle is the
browser's final URL — `waitForURL("**/auth/signin")` — which is exactly the brief's response
guidance, and the reason it matters is C10X-27: a `fetch`-based assertion follows the 302 to a
page that answers **200**, which is how that bug hid.

**One harness dependency the journey must declare.** `storageState` is set **globally**
(`playwright.config.ts:7`) with a single `chromium` project. Journey B therefore needs an
explicit signed-out context — `test.use({ storageState: { cookies: [], origins: [] } })` — or
its own project, otherwise it runs authenticated and the redirect never fires.

### 7. Bookkeeping

- **`roadmap.md`**: no row for this change and no e2e/Playwright row anywhere. Highest id is
  **H-11** (`typecheck-gate`); next free is **H-12**. The `H-` prefix semantics (`:67-72`) say
  hardening items exist in the table _"wyłącznie po to, żeby `/10x-archive` miał co domknąć"_.
  The trap note at `:74-79` is the direct warning the brief cites, with H-04/H-07/H-08 (`:414`,
  `:417`, `:418`) as three backfilled precedents.
- **Ownership**: `roadmap.md:401` and `lessons.md:180-185` both say `/10x-archive` is the sole
  owner of the Status → `done` flip and the `## Done` entry; doc-sync updates Outcome only.
  **Stale pointer found**: `lessons.md:184` cites `roadmap.md:234` for that ownership sentence,
  which now lives at `roadmap.md:401` (`:234` is H-01's Risk paragraph).
- **`jira-map.md`**: no row for this change; highest key is **C10X-44**, next free **C10X-45**.
  The file's own header (`:1-14`) says it is managed by `/jira-backlog-sync` and must not be
  hand-edited. It already documents the recurring gap at `:51-53` — adding a roadmap item does
  not add it here, and `/10x-archive` does not see this table — and indeed **H-10 and H-11 are
  themselves missing** from its roadmap table.
- **`lessons.md` rules that bear on this change**, beyond `:131-136` (Container API) and
  `:152-164` (the two preflight rules): `:187-192` (middleware must not answer JSON with a
  redirect — the C10X-27 bug), `:194-199` (a command that always exits 0 is not a gate),
  `:201-206` (a positive control must own the fixture it mutates), `:208-213` (a redirect
  refusal needs a row oracle and equality on the message), `:229-234` (`.single()` is a false
  oracle for a duplicate write), `:222-227` (the Kong keep-alive flake, absorbed by
  `tests/setup/retry-transport.ts` — which a Playwright run driving a real dev server does
  **not** go through), `:138-143` (never hand-assemble a `@supabase/ssr` session cookie),
  `:166-178` (two browser-measurement lessons on focus rings that become live the moment a
  browser layer exists).
- **One thing `lessons.md` does NOT contain**: any rule that a doc-only change must not trigger
  a migration or deploy. Both migration lessons (`:40-45`, `:110-115`) are conditioned on _"any
  change carrying a database migration"_. If the plan asserts such a rule it is asserting
  something the lessons file does not say.

## Code References

- `playwright.config.ts:4-10` — the whole harness: `testDir`, hardcoded `baseURL`, global
  `storageState`, inert `trace`, single project with no dependencies
- `tests/e2e/seed.spec.ts:8-17` — the hydration-retry `openModal` helper (the pattern to reuse)
- `tests/e2e/seed.spec.ts:36-42` — the deck deletion through real UI, with no local-host guard
- `tests/setup/preflight.ts:33-65,68-77,79-94,111-119` — the three seams Vitest closes and
  Playwright does not
- `tests/middleware.test.ts:21-24` — the comment recording why the Container API is not used
- `tests/middleware.test.ts:85,94` — `it.each(PROTECTED_ROUTES)` on both branches
- `src/middleware.ts:7-15,32-41,43,77` — protected prefixes, the caller discriminator,
  `onRequest`, the parameter-free redirect
- `src/components/generate/GeneratorForm.tsx:171-176,328-335,348-352,360,367` — fetch (no
  navigation), submit-button name flip, `role="status"`, results section, the review link
- `src/components/review/CandidateReviewWorkspace.tsx:106-114,131-139,144,231` — the batch call,
  the app's own `window.location.reload()`, the no-op message, the pluralised bulk label
- `src/pages/decks/[publicId]/review.astro:59-71,102-110,188-203` — the `?generation=` gate, the
  silently-hidden metric, the acceptance-metric line
- `src/lib/flashcards.ts:97-104` — `listFlashcards` filters `state_id = STATE_ACCEPTED` (the
  structural, content-free oracle on the deck page)
- `src/pages/auth/signin.astro:11,14-18` — English `<title>` and `<h1>`, both "Sign in"
- `tsconfig.json:3` — `include: ["**/*"]`, the mechanism by which the e2e files entered the gate

## Architecture Insights

- **A floor assertion is the right design and a silent one.** C10X-43 chose a floor over a
  pinned count precisely so the gate could not break on unrelated growth. The cost, visible for
  the first time here, is that a whole new layer can enter the gate with no signal. The lesson
  is not "pin the count" — it is that the _documents_ carrying the number are the only thing
  that can notice, which makes them load-bearing rather than decorative.
- **This project separates test layers three different ways, and the newest is the weakest.**
  The eval is separated by a second config's `include` **plus** two runtime preflights that fail
  in opposite directions. Vitest/e2e are separated by a filename suffix alone, with the e2e
  files living _inside_ `tests/`. Nothing asserts the latter.
- **The distinction that makes an e2e layer worth having here is "mounted", not "covered".**
  Three layers already prove the guard's _logic_ (`tests/middleware.test.ts`), the endpoints'
  _contracts_ (`callEndpoint`, `routeType: "endpoint"`) and the schedule's _arithmetic_. None
  proves that the middleware is wired into the running app at all. That is a narrow, real, and
  otherwise unreachable claim.
- **The app already reloads for you.** `CandidateReviewWorkspace.tsx:138` means a naive
  "accept, then reload, then assert" test asserts a property the application supplies. Journeys
  must be written against what the _layer_ uniquely reaches — here, the `.astro` page loaders
  that §6.4 records as deliberately never rendered.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md` §6.6, C10X-27 entry — the production bug where a `fetch`
  read a followed 302 as success. Directly shapes journey B's oracle choice (final URL, never a
  response status).
- `context/foundation/test-plan.md` §6.6, S-05 entry — records that `review.astro`'s loader and
  the review screen's empty states are covered by **manual verification alone**, because pages
  are deliberately not rendered. That is the coverage hole journey A extends into.
- `context/foundation/test-plan.md` §6.6, C10X-43 entry — the claims table containing the now-
  stale `133 files` / `115 roots` figures.
- `context/foundation/test-plan.md` §8, C10X-39 and C10X-40 entries — the two precedents for
  "a total and its breakdown are two claims", which is the class this refresh's own numbers
  belong to.
- `context/foundation/roadmap.md:74-79` and the H-04/H-07/H-08 backfills — the bookkeeping trap
  the brief cites for keeping this change separate from the phase it adds.

## Related Research

None. No prior `research.md` under `context/changes/**` or `context/archive/**` covers e2e or a
test-plan refresh; this is the first.

## Open Questions — RESOLVED 2026-08-05

Each question is kept verbatim as the record of what was open; the decision is appended. None
was deferred.

1. **Does §3 gain a Phase 6 row, or does the e2e work land as hardening like C10X-39/40/42/43?**
   The brief specifies a §3 row, but the harness that already exists landed outside the rollout,
   and §5's surviving "no §3 phase wires it" clause is only true while that stays so. Adding the
   row is what makes the §7 triggers fire honestly — but it also means the phase must be driven
   through `/10x-new → /10x-research → /10x-plan → /10x-implement`, not shipped as a hardening
   ticket. This is a decision, not a lookup.

   > **DECIDED 2026-08-05: §3 gains a Phase 6 row, `not started`.** The phase runs the full
   > chain — `/10x-new` → `/10x-research` → `/10x-plan` → `/10x-implement` / `/10x-e2e` — and
   > explicitly **not** as a hardening ticket. The stated reason is that this closes the orphan
   > pattern of C10X-39/40/42/43 rather than repeating it. Two consequences the refresh must
   > carry rather than leave to be inferred: §5's `no §3 phase wires it` clause stops being true
   > the moment the phase ships (not when the row is added), and §7's three triggers are to be
   > described as **mis-keyed — the condition was never literally met** — never as "the condition
   > fired". The three a11y/island exclusions **stay excluded**, with the conditional clause
   > replaced by a re-decision dated 2026-08-05.

2. **Does the refresh state that the e2e layer is type-gated, or does that belong to the phase?**
   It is true today and no document says it. Stating it here is cheap; but §4/§5 cannot carry
   coverage claims for work that does not exist, which is the brief's own boundary.

   > **DECIDED 2026-08-05: the refresh states it.** It is a correction of a NUMBER — 135
   > includes the two e2e files — and not a coverage claim, so it sits inside the refresh's
   > mandate rather than crossing the boundary the brief draws. It rides on the 133 → 135
   > correction and nowhere else: `README.md:49` edited **in place, false half only**;
   > `test-plan.md:2765` given a **dated correction line, the §6.6 row not rewritten**;
   > `AGENTS.md` untouched on this axis (it quotes no total); `18 .astro` left standing (true).

3. **Journey A's oracle: review-screen metric or deck-page count?** The metric line is the
   richer assertion but is `?generation=`-scoped and silently hidden on aggregate failure; the
   deck page reaches a loader nothing else renders. Deciding this is plan work, but the choice
   changes what the journey proves.

   > **DECIDED 2026-08-05: the DECK-PAGE count, recorded as response guidance.** Two reasons,
   > both measured above: the review screen calls `window.location.reload()` itself
   > (`CandidateReviewWorkspace.tsx:138`), so an oracle there partly asserts what the app
   > performs; and the metric line **disappears silently on an aggregate error**
   > (`review.astro:107`, `if (!error)`), so its absence proves nothing. The deck page reaches
   > the `.astro` loader that §6.6's S-05 entry records as covered by manual verification alone.
   > Content-free form: count `getByRole("button", { name: "Edytuj" })`, one per card —
   > **`Usuń` over-counts by one**, the deck-delete button in the sticky header. The final shape
   > of the oracle is `/10x-plan`'s work; this fixes the surface, not the assertion.

4. **Do the three unignored-artifact classes get closed now or by the phase?** They are latent
   (nothing produces them under the default reporter), so this may be deliberate deferral rather
   than an omission — but it should be written down either way.

   > **DECIDED 2026-08-05: deliberate DEFERRAL to the phase.** `playwright-report/`,
   > `blob-report/`, a root-level `.last-run.json` and `*-snapshots/` are latent — the default
   > `list`/`dot` reporter produces none of them, and `.last-run.json` currently lands inside the
   > already-ignored `test-results/`. **`.gitignore` is not touched by this refresh.** Recorded
   > as a decision so the next reader does not rediscover it as an omission.

5. **`lessons.md:184`'s stale pointer** (`roadmap.md:234` → `:401`): in scope for this refresh,
   or a separate hygiene fix? It is a pointer, and this project's §8 records pointer rot as a
   recurring class.

   > **DECIDED 2026-08-05: in scope, fixed IN PLACE.** It is false today, which puts it in the
   > same class as the number corrections — not a historical record needing a dated line. The
   > ownership sentence it cites lives at `roadmap.md:401`.

6. **Bookkeeping — who gets `H-12` and `C10X-45`?** (Not an Open Question above; decided in the
   same pass and recorded here so the plan does not have to re-derive it.)

   > **DECIDED 2026-08-05: both are reserved for the PHASE, not for this refresh.** The refresh
   > only NAMES them as future ids; it creates no roadmap row and no Jira key, and it must not
   > hand-edit `jira-map.md`, which `jira-map.md:3-4` reserves for `/jira-backlog-sync`.
   >
   > **Consequence, recorded rather than left to be inferred: this refresh is then itself an
   > orphan in the exact class it closes for the phase.** `/10x-archive` matches an archived
   > change to a roadmap row by `Change ID`; with no row, this change archives with nothing to
   > close and disappears from `## Done`, precisely as H-04, H-07 and H-08 did before being
   > backfilled (`roadmap.md:414`, `:417`, `:418`, and the trap note at `:74-79`). The two ways
   > out, neither taken here: give the refresh its own row (`H-12`) and the phase `H-13`, or
   > accept the orphan and backfill at archive time. **Accepted knowingly**; a plan-time
   > re-decision is cheap and this note is where a future reader should look first.
