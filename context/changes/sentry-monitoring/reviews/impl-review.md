<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Sentry Monitoring on Production (C10X-53)

- **Plan**: `context/changes/sentry-monitoring/plan.md`
- **Scope**: Full plan — Phase 1 and Phase 2 (both `[x]` in Progress)
- **Date**: 2026-08-12
- **Verdict**: REJECTED (one data-safety CRITICAL; everything else clean)
- **Findings**: 1 critical, 3 warnings, 3 observations
- **Range reviewed**: `3d0bee8..b63380b` (16 files), working tree clean

> **Post-triage status (2026-08-12): all 7 findings resolved — 7 fixed, 1 of them also recorded as
> a project rule. The `REJECTED` verdict above is the state the review FOUND and is deliberately
> not rewritten;** the per-finding `Decision:` fields below are the state now. The CRITICAL that
> drove the verdict (F1, request bodies reaching Sentry) is closed and verified in the shipped
> bundle, so the blocker on `wrangler secret put SENTRY_DSN` is lifted. Evidence for every claim:
> `context/changes/sentry-monitoring/verification.md`.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Success criteria — re-executed, not read off Progress

Every automated criterion was run against the current tree during this review, plus manual 2.6:

| Criterion                            | Result                                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 / 2.1 `npm run typecheck`        | exit 0 — `Result (146 files): 0 errors, 0 warnings`                                                                                                               |
| 1.2 / 2.2 `npm run lint`             | exit 0 — 3 warnings, all pre-existing `no-console` in `evals/`                                                                                                    |
| 1.3 / 2.3 `npm test`                 | 405/405, 33 files, seed `1786546022289`                                                                                                                           |
| 1.4 `dist/server/wrangler.json`      | `version_metadata: { binding: CF_VERSION_METADATA }`, `main: entry.mjs`, `nodejs_compat`, KV `SESSION` with id — inspected                                        |
| 1.5 DSN grep                         | no DSN value anywhere; only `fake@fake.ingest.example` in tests and `<key>@<org>.ingest.<region>` placeholders in the runbook                                     |
| 2.4 `npm run e2e`                    | 12 passed (21.1s)                                                                                                                                                 |
| 2.5 `npm run build`                  | exit 0                                                                                                                                                            |
| 2.6 ambient `SENTRY_DSN` → e2e green | reproduced independently: 12 passed (15.0s)                                                                                                                       |
| 1.6 `npm run dev` works              | supported indirectly — `playwright.config.ts:22` runs `webServer.command: "npm run dev"`, so both e2e runs drove 12 real browser journeys through `src/worker.ts` |

Plan adherence was verified item by item (1.1–1.4, 2.1–2.4): every load-bearing item is a MATCH.
Item 1.4 (update the `wrangler.jsonc:17-19` line cite in `tests/lib/no-logging.test.ts`) was **not
executed, and correctly so** — `version_metadata` was appended _after_ the observability block, so
that block still occupies lines 17–19 and the cite never drifted. The plan's premise was wrong;
making the edit would have introduced the error.

## Findings

### F1 — Request bodies (plaintext passwords, pasted source text) are attached to every Sentry event

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/worker.ts:25-37`
- **Detail**:
  The change reasons carefully about _what the console integration logs_ and concludes the capture
  surface is dependency `warn`/`error` output. That reasoning is correct and irrelevant to this
  finding: the leak is in the **ambient request data** the SDK attaches to every event, regardless
  of what triggered it. Each link verified by reading the installed packages:
  1. `httpServerIntegration()` is a **default** integration — `@sentry/cloudflare/build/esm/sdk.js`
     lists it in `defaultIntegrations`.
  2. Passing `integrations` as an **array merges with the defaults**, it does not replace them —
     `@sentry/core/build/esm/integration.js:24-26`: `integrations = [...defaultIntegrations, ...userIntegrations]`.
     So the default instance is live.
  3. `maxRequestBodySize` defaults to `"medium"` = **10 000 bytes**
     (`integrations/httpServer.js:7`, `core/utils/request.js:18`). The only gates are
     `=== "none"`, method ∈ {GET, HEAD, OPTIONS}, and `ignoreRequestBody` — **there is no
     `sendDefaultPii` gate on the body**.
  4. `requestDataIntegration` hardcodes `data: true` with the comment _"Always attach body data
     that's already on the scope — dataCollection.httpBodies gates write-time, not read-time"_
     (`core/integrations/requestdata.js:25-26`). The cloudflare SDK passes only
     `{ include: { cookies: false } }`, which spreads over `cookies` and leaves `data: true` intact.

  Concretely for this app: `src/components/auth/SignInForm.tsx:60` is a native
  `<form method="POST" action="/api/auth/signin">` and `src/pages/api/auth/signin.ts:26,31-32`
  reads `email`/`password` off `formData()` — so a captured event during sign-in carries
  `email=…&password=…` in plaintext. `/api/generate` posts `sourceText` up to `SOURCE_MAX = 10 000`
  against a 10 000-byte cap, i.e. essentially the whole pasted source text — precisely the material
  test-plan §2 Risk #4 exists to protect.

  **The change supplies its own trigger.** `src/middleware.ts` calls `supabase.auth.getUser()` on
  every request; during any Supabase/egress failure `@supabase/auth-js/.../fetch.js:110` emits an
  error-level line, which `captureConsoleIntegration` turns into an event — and that event carries
  the body. So: _Supabase outage + a user signing in → password to Sentry._

  **Correctly mitigated already, and worth crediting**: cookies are **not** sent
  (`sdk.js` passes `include: { cookies: false }` when `sendDefaultPii` is falsy, and
  `requestdata.js` deletes `headers.cookie`), so the Supabase session cookie is safe, and IP is
  excluded. The change's own worry was the right one — it just does not cover bodies, because
  bodies are not PII-gated.

  This is inherited from the plan, which specified the exact options object (`plan.md:184-199`) —
  not a deviation by the implementer. It must nonetheless land before `wrangler secret put`,
  because the runbook's provoked-event step targets `/decks` while a real user's sign-in is the
  flow that transmits.

- **Fix A ⭐ Recommended**: Disable body capture outright — add
  `Sentry.httpServerIntegration({ maxRequestBodySize: "none" })` to the `integrations` array in
  `src/worker.ts`, and correct the `:28-34` comment, which currently claims the capture surface is
  only dependency warn/error output.
  - Strength: One line, no allow-list to maintain, and it cannot rot as routes are added. Verified
    to work: `filterDuplicates` (`core/integrations/integration.js`) keeps a user instance over a
    default one of the same name, and user integrations are appended after the defaults.
  - Tradeoff: Loses request bodies as debugging context on _all_ routes, including ones that carry
    nothing sensitive.
  - Confidence: HIGH — the override mechanism was read in the installed source, not inferred.
  - Blind spot: Does not touch `query_string`/`url`, which stay on by default; `?q=` search terms
    still reach Sentry. Worth a separate decision.
- **Fix B**: Keep bodies but exclude the sensitive routes — pass
  `ignoreRequestBody: (url) => /\/api\/(auth|generate)/.test(url)` instead.
  - Strength: Preserves body context where it is genuinely useful for debugging.
  - Tradeoff: An allow-list that must be updated whenever a route starts accepting sensitive
    input — the failure mode is silent and the class is exactly what this repo's guard tests exist
    to prevent.
  - Confidence: MEDIUM — the hook is real (`httpServer.js:8,24`), but correctness depends on a
    pattern staying in sync with the route tree.
  - Blind spot: Has not been checked against every current POST route.
- **Decision**: FIXED via Fix A (2026-08-12). `Sentry.httpServerIntegration({ maxRequestBodySize: "none" })`
  added to the `integrations` array with a comment recording why naming a default integration is
  not redundant, and stating the two remaining boundaries (cookies were never at risk; URLs and
  query strings still are). Verified: guards 6/6, `typecheck` 146 files 0 errors, `lint` 0 errors,
  `npm test` 405/405, `build` exit 0 — and, the load-bearing check, `dist/server/chunks/` now
  carries `maxRequestBodySize: "none"` beside the library's own `"medium"`, so the override
  reaches the deployed bundle rather than only the source.

### F2 — A live 95-character `SENTRY_DSN` is still sitting in the local `.env`, which the runbook says to remove

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.env` (gitignored), `context/changes/sentry-monitoring/deploy-runbook.md:173`
- **Detail**:
  Checked without printing the value: `.env` carries `SENTRY_DSN` with a non-empty 95-character
  value, and `npm run build` materialises it into `dist/server/.dev.vars` (gitignored, alongside
  `PROD_SUPABASE_URL`/`PROD_SUPABASE_KEY`). Nothing leaks into the repository — `.gitignore:29`
  covers `.env`, `.gitignore:82` covers `dist/`, and `git ls-files` confirms `.env` is untracked.

  The consequence is about behaviour, not disclosure: **`npm run dev` is not currently in the
  no-op branch** — it initialises a live transport. The runbook's own §2b anticipates this and
  ends with _"Then remove `SENTRY_DSN` from `.env` for good: local dev is meant to be silent"_
  (`:173`); that cleanup step has not been performed. Combined with F1, a local sign-in during any
  warn/error event ships a plaintext password to a real Sentry project today — so this is what
  turns F1 from "before you deploy" into "already reachable".

  The e2e layer is unaffected and this is the seam Phase 2 built: `tests/e2e/setup/env.ts:227`
  forces `SENTRY_DSN: ""`, which I verified end to end by re-running `npm run e2e` with an ambient
  DSN exported — 12 passed.

- **Fix**: Remove the `SENTRY_DSN` line from `.env` (or blank it), then re-run `npm run build` so
  `dist/server/.dev.vars` stops carrying it. Do this before, or together with, F1.
- **Decision**: FIXED (2026-08-12). `.env`'s `SENTRY_DSN` value blanked in place — key kept so it
  stays discoverable, matching `.env.example`. The other four keys are untouched, including the
  `PROD_SUPABASE_URL`/`PROD_SUPABASE_KEY` pair the project deliberately preserves; line count
  unchanged 13 → 13. Rebuilt, and `dist/server/.dev.vars` now carries `SENTRY_DSN=""`.
  One measurement correction worth keeping: a first readout reported that artifact as still set —
  false, caused by the adapter writing values **quoted**, so a naive `split("=")` sees `""` as a
  two-character value. The oracle that settles it is the raw line length (11 in `.env`, 13 in
  `.dev.vars`), not a non-empty test on the split field. Local dev is back in the no-op branch.

### F3 — Errors-only config is unsampled, so one dependency failure mode produces one event per request

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/worker.ts:26-36`
- **Detail**:
  The options object sets no `sampleRate` and no `beforeSend`. `src/middleware.ts` calls
  `supabase.auth.getUser()` on **every** request, and `@supabase/auth-js/.../fetch.js:110` emits an
  error-level line whenever that fetch rejects — which `captureConsoleIntegration({ levels: ["warn","error"] })`
  converts into an event. A Supabase outage therefore yields one Sentry event per inbound request,
  site-wide, unsampled. Two lesser per-user-persistent storms exist: an expired refresh token
  (`GoTrueClient.js`) and a corrupt session cookie (`@supabase/ssr/cookies.js:22,29`), the latter
  persisting until the cookie is overwritten.

  The plan's Performance Considerations section concluded "no budget needed", which is right about
  CPU and wrong about quota. Quota exhaustion is self-masking: once the plan cap is hit, unrelated
  errors stop arriving, and this project has no notification channel to tell anyone.

  Reassuring result from the same audit, worth recording so nobody re-derives it: the console
  **arguments** are clean. `cookies.js:29` is a static literal; `fetch.js:110` logs only the fetch
  rejection, never the request params that hold the `Authorization` header and the password. The
  worst argument-level exposure is one character of a base64url cookie payload plus its offset.

- **Fix**: Set a `sampleRate` (or a `beforeSend` dedupe on the recurring dependency messages)
  before the production secret is set. Tradeoff to weigh explicitly: sampling reduces quota risk
  and simultaneously means a rare error may not arrive — pick the rate against the free-tier cap
  rather than by feel.
- **Decision**: FIXED (2026-08-12), and **narrower than the fix as written**, for a reason found by
  reading rather than assumed. A blanket `sampleRate` was rejected: it cannot separate the storm
  from the signal, so it would also drop ~90% of the rare uncaught exception this monitoring exists
  to surface. `captureconsole.js` stamps its own events (`event.logger = "console"`, mechanism
  `auto.core.capture_console`), which makes the two classes separable at `beforeSend`. Shipped: a
  `beforeSend` that returns real exceptions untouched and samples only the dependency class at
  `DEPENDENCY_EVENT_SAMPLE_RATE = 0.1`. The comment records why the narrow instrument is the right
  one, why sampling this class loses little (the conditions worth acting on persist, so a survivor
  arrives quickly; what is dropped is the least actionable one-off), and — stated deliberately —
  that the value is **reasoned, not measured**, and should be re-tuned on production volume.
  Verified: typecheck 146 files 0 errors, lint 0 errors, guards 6/6, `npm test` 405/405, build
  exit 0, and the shipped chunk carries `if (event.logger !== "console") return event;`.

### F4 — `infrastructure.md` was reformatted whole-file, corrupting two unrelated passages

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `context/foundation/infrastructure.md:134`, `:147-148`
- **Detail**:
  The plan's contract was explicit: _"One-line correction, nothing else in that file"_
  (`plan.md:312`). The `main` correction itself is right (`:174`, now `./src/worker.ts`, with a
  dated six-line explanation). But the commit also let `lint-staged`'s `prettier --write` reformat
  the whole file, and that damaged two passages that have nothing to do with this change:
  1. `:134` — a prose `+` at the start of a wrapped line was reflowed into a **list bullet**:
     `+ OpenRouter climbs the counter…` became `- OpenRouter climbs the counter…`. The sentence
     "One request doing Supabase auth + a few queries + OpenRouter climbs the counter faster than
     the simple flow suggests" now reads as truncated at "a few queries", with the remainder
     rendering as a nested bullet.
  2. `:147-148` — a code span split across a line break lost its indentation, putting
     `` SUPABASE_URL` `` at column 0.

  Both are the exact hazard `test-plan.md` §8 records twice against C10X-43 and the 2026-08-05
  refresh ("a code span split across a line break… prettier damages it"; "a span's padding must
  never carry meaning"). The rule was available and the plan's scope limit would have avoided it.

- **Fix**: Restore the two passages (rejoin the `+` continuation onto the preceding line so
  prettier cannot re-bullet it; put the split code span on one line). Leave the rest of the
  reformat — reverting it now would be a second whole-file churn.
- **Decision**: FIXED (2026-08-12). `:133-134` re-wrapped so `queries + OpenRouter` sits mid-line —
  the sentence is whole again and the `+` can no longer be read as a list marker, which is the
  durable form of the fix rather than just undoing the character. `:148-149` puts
  `` `wrangler secret put SUPABASE_URL` `` on one line. Verified the repair is stable rather than
  assumed: `npx prettier --check` reports the file already conforms, so the next `lint-staged` run
  will not churn it back. One extra sweep, since the class is what matters more than the instance:
  a scan for lines carrying an odd number of backticks across the whole file returns **zero**, so
  no other latent line-split code span is waiting for the next reformat.

### F5 — The plan's roadmap doc-sync item pointed at a dated historical snapshot; the implementation correctly ignored it

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/roadmap.md:106` (untouched), `:68` + `:393-404` (added)
- **Detail**:
  `plan.md:303` instructed: _"Update the roadmap's observability Outcome line (`roadmap.md:105`
  records 'partial — tylko wbudowane Cloudflare observability')"_. That line was **not** edited,
  which initially reads as missing doc-sync. It is not: the line sits under `## Baseline`, whose
  own preamble reads _"Co jest już w bazie kodu na `2026-07-04`"_ — a dated snapshot of the
  starting state. Its neighbours are equally "stale" by construction —
  `Testy: absent — brak runnera (vitest/playwright)` and `Data: absent — supabase/migrations/ puste`.
  Editing it would have falsified a dated historical record, against this project's convention that
  historical entries take a dated correction rather than a rewrite.

  The implementation instead added a full **H-14** roadmap entry (At-a-glance row `:68` plus the
  detail block `:393-404`) whose `Outcome` is the live, accurate statement. `Status: in progress`,
  not `done` — so the `/10x-archive`-owns-the-flip lesson is respected, and the block says so
  explicitly. That work was unplanned but is the correct roadmap bookkeeping, and it closes the
  orphan-row pattern this project has hit four times (H-04, H-07, H-08, H-13). A grep for
  `observability|sentry|error-tracking` across `roadmap.md` confirms no live claim is now false.

  Recorded as a **plan defect**, not an implementation defect: no action on the code or the docs.

- **Fix**: None. Noted so the unexecuted plan item is not mistaken for an oversight.
- **Decision**: FIXED + ACCEPTED-AS-RULE (2026-08-12): _"Doc-sync edytuje ŻYWĄ deklarację; datowany
  snapshot dostaje datowaną korektę, nigdy nadpisania"_ appended to `context/foundation/lessons.md`,
  next to its sibling about `/10x-archive` owning the roadmap Status flip. Its Rule adds the part
  that would have prevented the plan defect: cite doc-sync targets by section and claim, never by
  line number alone, because a line number resolves to a place and the decision needs the place's
  KIND. A dated one-line correction was also appended beneath `roadmap.md:106` — it annotates the
  Baseline snapshot rather than rewriting it, and points at H-14 as the live statement. Both files
  verified prettier-stable.

### F6 — `.env.example` was edited after the epilogue commit, outside every Progress checkbox

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `.env.example:19-31` (commit `b63380b`)
- **Detail**:
  Fifteen lines, all comment except `SENTRY_DSN=` (empty). The content is accurate and useful — it
  states the value is optional locally, that prod uses `wrangler secret put`, that piping can
  prepend a BOM producing a non-empty-but-broken DSN, and that unlike the four keys above it is
  not in the `astro:env` schema. It breaks nothing: verified that no test or CI step reads
  `.env.example` (the only references are prose inside hint strings in `tests/setup/preflight.ts`
  and `tests/e2e/setup/env.ts`), and an empty value is falsy on every path.

  Two process notes. It landed **after** `ebb3484` marked `status: implemented`, so it sits outside
  plan review and outside every Progress row. And it mildly contradicts the runbook's own §0
  (`deploy-runbook.md:45`): _"No DSN in any file in this repo. Not `.env.example`…"_ — the letter
  holds (no value is present) but the two documents now point in slightly different directions.
  There is also a prior precedent for the opposite call (`eval-ci-dispatch`: _"No `.env.example`
  row"_), whose reasoning does not transfer here, so the different decision is defensible — it
  just was not written down.

- **Fix**: Reword `deploy-runbook.md:45` so "not `.env.example`" reads as "no DSN _value_ in any
  file", removing the tension.
- **Decision**: FIXED (2026-08-12). §0's first bullet now reads "No DSN VALUE in any tracked file",
  drops `.env.example` from the prohibition list, and states positively that the empty
  `SENTRY_DSN=` row is the template telling a developer the variable exists — explicitly not an
  exception being carved out, so the next reader does not treat it as a precedent for loosening the
  rule. The invariant was re-asserted rather than assumed: a grep for a real
  `https://<key>@…ingest…/` string across the tracked tree, excluding the `.example` test fixture,
  returns nothing. Runbook verified prettier-stable. The process half of the finding (the commit
  landing after the epilogue, outside Progress) is history and is left recorded, not rewritten.

### F7 — Eight ticked Progress criteria carried no recorded evidence

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/sentry-monitoring/plan.md:436-462`
- **Detail**:
  No `verification.md` was produced. The plan does not contract for one, so this is a convention
  gap rather than a breach — but this project's `test-plan.md` §8 repeats that "a split is a claim
  about a run", and the three most load-bearing claims (1.4 the generated-config inspection, 1.5
  the grep, 2.6 the ambient-DSN e2e run) survived nowhere in the repo.

  Largely closed by this review: all five automated criteria plus manual 2.6 were re-executed today
  and are recorded in the table above, and 1.6 gained indirect support via the e2e web server. The
  residual gap is that those observations now live in this review file rather than in the change's
  own verification record.

- **Fix**: Treat this report's success-criteria table as the change's verification record, or lift
  it into `context/changes/sentry-monitoring/verification.md` before archiving.
- **Decision**: FIXED (2026-08-12). `context/changes/sentry-monitoring/verification.md` created. It
  records **two** runs per gate — pre-review (`b63380b`, the tree as the phases left it) and
  post-review (after the F1/F3 fixes changed `src/worker.ts`) — because the earlier table described
  a tree that no longer exists, and a verification record that silently describes the wrong tree is
  the defect it exists to prevent. Every criterion 1.1–2.8 is covered with what was actually
  observed, and the file closes with what remains unproven by construction: the with-DSN transport
  path, the sampling rate's fitness, client-side errors, and the still-open `?q=` question.
  All six gates re-run green on the post-fix tree, including two more `npm run e2e` runs (plain
  12 passed / 21.4 s, ambient-DSN 12 passed / 14.9 s).

## What is clean — stated so it is not re-audited

- **Secret handling**: `git grep -inE "ingest\.[a-z.]*sentry\.io|https://[0-9a-f]{8,}@"` over the
  tracked tree returns nothing. Placeholders and `.example` hosts only. `.env` untracked and
  ignored; `.dev.vars` ignored. The prod Supabase project ref in the runbook is not new exposure —
  it has been in three archived documents since before this branch.
- **`src/worker.ts` against all five plan constraints**: imports the adapter entrypoint rather than
  re-implementing it; no `tracesSampleRate` / `enableLogs` / `release`; no `console` literal
  anywhere (the guard regex is case-sensitive, so `captureConsoleIntegration` survives — a narrow
  but correct margin); no Workers global type names; header comment explains the carve-out and the
  silent-no-op cost. Import order differs cosmetically from the plan snippet with no behavioural
  effect.
- **Reliability**: a malformed DSN does not throw — `makeDsn` returns `undefined` and no transport
  is constructed, which independently confirms the `.env.example` BOM warning. `withSentry` wraps
  instrumentation in `try/catch`, so an instrumentation failure degrades to the bare handler. No
  floating promises. `CF_VERSION_METADATA` → `release` is automatic, so the roadmap's version-tag
  claim is true with no code needed.
- **e2e seam**: `tests/e2e/setup/env.ts` mirrors the `OPENROUTER_API_KEY` forcing+assertion pattern
  faithfully — same `refuse()`, same `originOf()` attribution, placed before the browser check. The
  deliberate asymmetry (refuse only on `devVars`, blank on `effective`) is documented **and pinned
  by its own test**, so it cannot be "tidied" into symmetry. The fixed-map pin is
  `expect(env.SENTRY_DSN).toBe("")` fed a non-empty source — falsifiable, not vacuous.
- **AGENTS.md carve-out**: the hard rule at `:8` now forward-points to its two exceptions, and the
  new `:11` bullet names file, reason and boundary in the same shape as the `scripts/` one, framed
  as a _shape_ constraint rather than a key count. A fresh agent would not flag `src/worker.ts`.
- **Runbook**: exceeds its contract. All five steps present and ordered, plus a required scratch
  Sentry project (so step 2's own event cannot satisfy step 5's oracle), a prerequisites table, an
  independent `wrangler tail` oracle, and rollback. It **corrects the plan's own provocation**:
  the plan proposed `...auth-token=garbage`, and the runbook records a measurement that `garbage`
  produces zero warnings — the working value is `base64-bm90anNvbg`. Following the plan verbatim
  would have produced a silent false negative.
- **Config**: `version_metadata` correctly placed and named; the generated `dist/server/wrangler.json`
  carries it plus `nodejs_compat`, the KV `SESSION` id and observability. The bundled chunk behind
  `entry.mjs` genuinely contains the Sentry wrapper.
