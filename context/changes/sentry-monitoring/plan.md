# Sentry Monitoring on Production (C10X-53) Implementation Plan

## Overview

Wire Sentry server-side error monitoring into 10xCards (Astro 6.3.1 + `@astrojs/cloudflare` 13.5.0
on Cloudflare Workers) via the documented custom-entry path: point `wrangler.jsonc`'s `main` at a
new `src/worker.ts` that imports the adapter handler and default-exports
`Sentry.withSentry((env) => ({ dsn: env.SENTRY_DSN, … }), handler)`. The DSN comes exclusively from
the Worker environment (Cloudflare secret in prod, optional `.env` locally, never a literal in
code); a falsy DSN takes the SDK's no-transport branch, so the same code ships to environments with
and without Sentry. **This change stops before deployment** — the user deploys manually per the
change brief, following the runbook Phase 2 produces.

## Current State Analysis

From `context/changes/sentry-monitoring/research.md` (2026-08-11, commit `3d0bee8`):

- **No Sentry anywhere yet.** No `@sentry/*` package installed; nothing in code/config references
  Sentry. Today's only observability sink is Workers Logs (`wrangler.jsonc:17-19`,
  `observability.enabled: true`), which receives only dependency-emitted console output.
- **The adapter-version question is settled: this repo is on the v13 custom-entry path.**
  `@astrojs/cloudflare` 13.5.0 (exact, from lockfile) delegates bundling to
  `@cloudflare/vite-plugin` 1.36.3; the user-set `main` wins verbatim over the adapter default
  (`dist/wrangler.js:31`), and a relative `.ts` `main` is resolved and **existence-checked at build
  time**. Sentry's "Astro on Cloudflare" guide targets exactly this stack (Astro ≥6, adapter v13+,
  `@sentry/astro`/`@sentry/cloudflare` ≥10.40.0; latest 10.70.0). Issue
  getsentry/sentry-javascript#21901 confirms auto-wrap has been dead since v13 and the custom entry
  is the maintainer-endorsed seam.
- **`nodejs_compat` is already on** (`wrangler.jsonc:6`) — the brief's requirement is pre-satisfied.
- **Zero CI changes needed for the wiring.** The custom entry is consumed at build time; the
  generated `dist/server/wrangler.json` still says `main: entry.mjs`, which is what
  `wrangler deploy` reads (lesson: rebuild after editing `wrangler.jsonc`,
  `context/foundation/lessons.md:19-24`).
- **Correction to the change brief**: `captureConsoleIntegration` captures **zero** of the five
  swallowed-error audit findings (C10X-48…52) — those are dropped results with no console call at
  all, and `tests/lib/no-logging.test.ts` guarantees no first-party `console.*` exists under
  `src/`. What the integration WILL capture is dependency-emitted output (`@supabase/ssr`
  cookie warns, `@supabase/auth-js` fetch errors) — the "in scope but unowned" boundary
  test-plan.md §7 records for Risk #4 finally gains a monitored sink.
- **Repo gates**: every guard passes with this setup (verified per guard in research §7). The two
  genuinely new patterns are a `src/` file reading Worker env outside `astro:env/server` (textually
  legal — the guards match `process.env`/`import.meta.env` literally — but contra the AGENTS.md
  prose rule, needs a written carve-out) and the e2e env map not blanking unknown keys (an ambient
  `SENTRY_DSN` would flow into the e2e dev server).

## Desired End State

- `npm run build` produces a Worker whose entry wraps the adapter handler in `withSentry`;
  `dist/server/wrangler.json` carries the bundled entry plus the `version_metadata` binding.
- With `SENTRY_DSN` unset (local dev, tests, CI, a prod without the secret) the app behaves
  byte-identically to today — no transport, no errors, no warnings outside debug mode.
- With the `SENTRY_DSN` Cloudflare secret set, the deployed Worker reports: uncaught exceptions at
  the fetch boundary, and `console.warn`/`console.error` emitted by dependencies (via
  `captureConsoleIntegration({ levels: ["warn", "error"] })`), each event tagged with the deploy's
  version id (via `CF_VERSION_METADATA`).
- All repo gates green: `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`,
  `npm run build`.
- The user holds a runbook for the manual deploy + prod sanity (secret via `wrangler secret put`,
  provoked test event), because the no-op contract makes a missing prod secret deliberately silent
  (lesson `lessons.md:117-122`).

### Key Discoveries:

- `wrangler.jsonc:4` (`"main": "@astrojs/cloudflare/entrypoints/server"`) is the single seam to
  change; that specifier resolves to a 6-line file default-exporting `{ fetch: handle }` —
  signature-compatible with `Sentry.withSentry(optionsFn, handler)`.
- Importing `@astrojs/cloudflare/entrypoints/server` from the wrapper preserves the adapter's
  module-scope init (`setGetEnv` before `createApp()`, `handler.js:19-20`) — the wrapper must go
  through that import, never re-implement it.
- `withSentry`'s options callback receives the Worker `env` per invocation → DSN from
  `env.SENTRY_DSN` at runtime, no build-time DSN, no `astro:env` schema change required. Falsy DSN
  → debug-only warn in `@sentry/core`, no throw, no transport.
- The SDK reads **no** `process.env.SENTRY_DSN` fallback on Workers — the explicit `env` read is
  the only channel, which is exactly the "never in code, only in the environment" contract.
- `tests/e2e/setup/env.ts` builds a fixed `webServer.env` map that does NOT blank unknown keys;
  Playwright merges `{...process.env, ...options.env}`, so an ambient `SENTRY_DSN` would leak into
  e2e runs. `tests/lib/e2e-env.test.ts:235` uses `toMatchObject`, so adding a key breaks nothing.
- `tests/lib/no-logging.test.ts:25` cites `wrangler.jsonc:17-19` by line number in a comment — the
  `version_metadata` addition shifts those lines, so the cite must be updated in the same commit.
- Sentry ≥10.35.0 auto-derives the release from `CF_VERSION_METADATA.id` when the
  `version_metadata` binding exists — no release code needed in the wrapper.

## What We're NOT Doing

- **No deploy.** The change stops after local verification; the user runs the deploy and prod
  sanity themselves from the Phase 2 runbook.
- **No client-side half.** `@sentry/astro` is not installed; no `sentry()` integration in
  `astro.config.mjs`, no `sentry.client.config.ts`. Browser errors from React islands stay
  invisible to Sentry. Adding this later is an independent install.
- **No source-map upload.** Follows from server-only: upload runs through `@sentry/astro` and would
  need a `SENTRY_AUTH_TOKEN` secret plus the first-ever `env:` block on CI's build step. Known
  tradeoff: prod stack traces show minified frames.
- **No instrumentation of the five audit sites (C10X-48…52).** This change ships the platform
  only. `captureConsoleIntegration` does NOT close the swallowed-error audit class — those findings
  are dropped results with no console call; each of the five tickets owns checking its error (and
  may then send it to Sentry). The plan states this boundary so nobody reads "Sentry is live" as
  "the audit class is monitored".
- **No tracing, no Sentry Logs.** `tracesSampleRate` omitted, `enableLogs` omitted — errors-only
  monitoring, minimal quota surface.
- **No `@sentry/cloudflare/nodejs_compat` entrypoint** (≥10.64.0 optional import path) — we stay on
  the default entrypoint; the SDK will flip the default in its next major on its own schedule.
- **No `astro:env` schema change.** `SENTRY_DSN` is read only in the wrapper from the Worker `env`;
  app code has no need to see it. If a config-status banner ever wants it, that addition must keep
  `optional: true` (CI's secret-free build depends on every field being optional).
- **No `SENTRY_AUTH_TOKEN` anywhere** — it exists only for source-map upload, which is deferred.

## Implementation Approach

One new runtime file plus three config touches, then repo hygiene:

1. Install `@sentry/cloudflare` (only), create `src/worker.ts` wrapping the adapter handler, point
   `wrangler.jsonc`'s `main` at it and add the `version_metadata` binding. Verify through the
   build's generated config, not the source config (lesson: the adapter deploys
   `dist/server/wrangler.json`).
2. Close the test seam (`SENTRY_DSN: ""` in the e2e env map — lesson "preflight musi domknąć KAŻDY
   nielokalny szew"), write the AGENTS.md carve-out for the Worker-env read, sync docs, and hand
   the user a deploy + prod-sanity runbook.

DSN handling contract (the user's explicit requirement): the DSN never appears in the repo. Prod:
Cloudflare secret via `npx wrangler secret put SENTRY_DSN` (interactive, lands in no file). Local
(optional): `SENTRY_DSN=…` in gitignored `.env` (lesson ".env XOR .dev.vars" — never `.dev.vars`).
Unset anywhere → structural no-op.

## Critical Implementation Details

- **Timing & lifecycle** — the wrapper MUST import `@astrojs/cloudflare/entrypoints/server` (not
  copy its body): the adapter's module-scope side effects (`setGetEnv(createGetEnv(globalEnv))`
  before `createApp()`) run on that import and Astro's `astro:env/server` depends on them.
- **Build is the propagation step.** `wrangler deploy` reads the generated
  `dist/server/wrangler.json` via a `.wrangler/deploy/config.json` redirect — an edit to
  `wrangler.jsonc` that isn't followed by `npm run build` never reaches a deploy. Verification of
  the `main`/binding changes happens by inspecting the generated file.
- **Lint/typecheck posture around the SDK call**: the repo lints root+src `.ts` with
  `strictTypeChecked` (`no-unsafe-*`, `no-floating-promises` are live) under `strict` +
  `noUncheckedIndexedAccess`. Type the `env` parameter explicitly (a small local interface with
  `SENTRY_DSN?: string` is enough) rather than `any`, so `env.SENTRY_DSN` is a typed read.
  `@sentry/cloudflare` ships its own types. The file must be `.ts` — `.mts`/`.cts` match no ESLint
  `files` pattern. Do NOT reference Workers global type names (`Env`, `ExecutionContext`,
  `ExportedHandler`) in `src/worker.ts` — the repo has no `@cloudflare/workers-types` and the
  injected `cloudflare.d.ts` declares only `App.Locals`, so a bare annotation (e.g.
  `satisfies ExportedHandler`) is a `Cannot find name` typecheck red; stay with the local
  interface (plan-review F4).
- **The `no-logging` guard is textual**: even a comment containing `console.warn` inside a `src/`
  file fails `tests/lib/no-logging.test.ts`. The `src/worker.ts` comments must describe the console
  integration without spelling the literal `console` identifier (e.g. write "warn/error output").
- **`wrangler.jsonc` line-number cite drift**: `tests/lib/no-logging.test.ts:25` mentions
  `wrangler.jsonc:17-19` in prose; adding `version_metadata` shifts lines — update the cite in the
  same commit so the comment doesn't rot (the class §8 of test-plan.md keeps recording).

## Phase 1: Platform wiring — package, worker entry, wrangler config

### Overview

Install the SDK, create the custom entry, rewire `wrangler.jsonc`, and prove the build produces a
deployable artifact with the wrapper inside — without deploying anything.

### Changes Required:

#### 1. Install `@sentry/cloudflare`

**File**: `package.json`, `package-lock.json`

**Intent**: Add the only new dependency, `@sentry/cloudflare` (latest 10.x, ≥10.40.0 — the floor
for the Astro-on-CF-Workers path). As a runtime dependency of the deployed Worker it belongs in
`dependencies`, not `devDependencies`. `@sentry/astro` is deliberately NOT installed (client half
out of scope).

**Contract**: `npm install @sentry/cloudflare` — peer constraints already satisfied
(`wrangler ^4.x` ✓). No other package changes.

#### 2. Create the custom worker entry

**File**: `src/worker.ts` (new)

**Intent**: The Worker's real entry point: imports the adapter's default handler (preserving its
module-scope init) and default-exports it wrapped in `Sentry.withSentry`. DSN comes from the
per-invocation `env`; options are errors-only plus the console integration for warn/error levels.
A header comment explains why this file reads Worker env directly (the AGENTS.md carve-out's
counterpart in code) and that a falsy DSN is a deliberate no-op.

**Contract**: default export is a standard `ExportedHandler`. Shape (non-obvious composition —
kept as the contract other steps depend on):

```ts
import * as Sentry from "@sentry/cloudflare";
import handler from "@astrojs/cloudflare/entrypoints/server";

interface WorkerEnv {
  SENTRY_DSN?: string;
}

export default Sentry.withSentry(
  (env: WorkerEnv) => ({
    dsn: env.SENTRY_DSN,
    integrations: [Sentry.captureConsoleIntegration({ levels: ["warn", "error"] })],
  }),
  handler,
);
```

No `tracesSampleRate`, no `enableLogs`, no release option (release auto-derives from
`CF_VERSION_METADATA` once the binding exists). Comments must not contain the literal `console`
identifier (textual no-logging guard).

#### 3. Rewire `wrangler.jsonc`

**File**: `wrangler.jsonc`

**Intent**: Point `main` at the new entry and add the `version_metadata` binding so Sentry
auto-tags events with the deploy's version id.

**Contract**: `"main": "./src/worker.ts"` (line 4; build-time existence-checked by the vite
plugin — a typo fails `npm run build`, not the deploy) and a new
`"version_metadata": { "binding": "CF_VERSION_METADATA" }` field. Everything else unchanged.

#### 4. Update the drifting line cite

**File**: `tests/lib/no-logging.test.ts`

**Intent**: The comment at `:25` cites `wrangler.jsonc:17-19` (observability block) by line
number; the `version_metadata` addition shifts those lines. Update the cite to the new numbers in
the same commit. No assertion changes.

**Contract**: comment-only edit; the test's behavior and count are untouched.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` exits 0 (`src/worker.ts` enters the gate under `strict` +
  `noUncheckedIndexedAccess`; file count grows past the floor, which is growth-safe)
- `npm run lint` exits 0 (root+src `.ts` under `strictTypeChecked`; prettier as error; the 3
  pre-existing `no-console` warnings in `evals/` are the only warnings)
- `npm test` green with the local stack up (no new file is collected — `src/worker.ts` matches no
  `include`; the textual guards over `src/` pass: no `console` literal, no
  `process.env`/`import.meta.env`, no `.get("error")` read)
- `npm run build` exits 0, and the generated `dist/server/wrangler.json` contains the
  `version_metadata` binding and a rewritten `main` (the bundled `entry.mjs`) — inspected, not
  assumed (lesson: the adapter deploys the generated config)
- Grep proof the DSN is not in the repo: `git grep -i "sentry_dsn"` matches only `src/worker.ts`'s
  typed read, the e2e env map (Phase 2), and prose/docs — never a DSN value (no `https://…@…ingest`
  literal anywhere)

#### Manual Verification:

- `npm run dev` (no `SENTRY_DSN` set): app boots on workerd and behaves as before — sign-in, decks
  page render. Dev requests dispatch `src/worker.ts` itself (plan-review F1), so this exercises
  the wrapper's no-op branch and the adapter's env wiring (`astro:env/server` consumers like
  `createClient` still work) on real requests

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: Repo hygiene, docs, and the manual-deploy runbook

### Overview

Close the e2e env seam, write the carve-outs and doc-sync, and hand the user everything needed to
deploy and verify by hand. No deploy happens in this phase.

### Changes Required:

#### 1. Blank `SENTRY_DSN` in the e2e env map

**File**: `tests/e2e/setup/env.ts`

**Intent**: Playwright's `webServer.env` merges over `process.env`, so an ambient `SENTRY_DSN` (in
the shell or `.env`) would flow into the e2e dev server — which DOES execute the wrapper on every
request (plan-review F1) — and test runs would emit real events. Add
`SENTRY_DSN: ""` to the fixed `E2eEnv` map so e2e runs are structurally Sentry-silent — the lesson
"preflight musi domknąć KAŻDY nielokalny szew" applied to this change's one new seam.

**Contract**: one new key in the `E2eEnv` map type and its builder, PLUS the assertion half of the
pair (plan-review F2): the forcing covers `.env`/shell, but `.dev.vars` merges INSIDE the child
AFTER `webServer.env` — the one source the map cannot outrank (`env.ts:21-27`), the same reason
`OPENROUTER_API_KEY` pairs forcing with an assertion (`env.ts:174-183`). So `buildE2eEnv` must
refuse when `SENTRY_DSN` comes from `devVars` — ONLY from `devVars`, never from `effective`
(a `.env`/shell DSN is the documented optional-local workflow and the blank covers it).
`tests/lib/e2e-env.test.ts:235` uses `toMatchObject`, so existing assertions tolerate the added
key; extend the fixed-map test to pin the new key (removing the blank later is a red, not a
silent regression) and add one case: a `devVars` `SENTRY_DSN` → throw naming `.dev.vars`.

#### 2. AGENTS.md carve-out for the Worker-env read

**File**: `AGENTS.md`

**Intent**: The hard rule "read env only through `astro:env/server`" gains its second exception
(after `scripts/`): `src/worker.ts` runs BEFORE Astro exists — it is the module that wraps the
adapter — so it reads the Worker `env` parameter directly. Write the exception the way the
`scripts/` one is written: name the file, the reason, and the boundary (do not extend the pattern
to any other `src/` file).

**Contract**: prose addition to the Hard Rules section; no rule weakened, one exception named.

#### 3. Doc-sync

**File**: `context/foundation/roadmap.md`, `context/foundation/infrastructure.md`,
`context/changes/sentry-monitoring/change.md`

**Intent**: Update the roadmap's observability Outcome line (`roadmap.md:105` records "partial —
tylko wbudowane Cloudflare observability") to reflect that server-side Sentry exists — Outcome
only, never a Status flip (lesson: `/10x-archive` owns Status → done). Correct
`infrastructure.md:184` (plan-review F5): it advises `main: ./dist/_worker.js/index.js`, which
contradicts the v13 adapter and this change — after this change the accurate line is
`main: ./src/worker.ts` (bundled by the vite plugin; the generated `dist/server/wrangler.json`
is what deploys). One-line correction, nothing else in that file. Update `change.md` status to
`implementing`→ as the phases land (per the change lifecycle).

**Contract**: Outcome text only in roadmap; one corrected line in `infrastructure.md`;
`change.md` frontmatter `status`/`updated` fields.

#### 4. Manual deploy + prod-sanity runbook

**File**: `context/changes/sentry-monitoring/deploy-runbook.md` (new)

**Intent**: The user deploys manually. The runbook must make the deliberately-silent failure mode
(missing secret → no-op → green deploy, zero events, no error) impossible to miss — lesson
"Zweryfikuj, że feature DZIAŁA na PROD". Steps, in order: (1) create the Sentry project and copy
the DSN; (2) `npx wrangler secret put SENTRY_DSN` — value pasted interactively, lands in no file;
(3) merge/deploy through the normal pipeline (CI deploy job; NOT a local `wrangler deploy`, per the
one-pipeline lesson); (4) prod sanity: provoke a real test event with the CONCRETE, code-free
provocation this app actually has (plan-review F3 — the app deliberately has no route that throws
uncaught: every API `catch` answers owned copy): send a request to prod carrying a garbage session
cookie, `curl -H "Cookie: sb-<ref>-auth-token=garbage" https://<prod-host>/decks` — the malformed
value fires the measured `@supabase/ssr` cookie-parse warn (`cookies.js:22,29`, the dependency
output `captureConsoleIntegration` exists to capture) — and confirm a `warning` event ARRIVES in
the Sentry UI, tagged with the deploy's version id (the cookie name derives from the prod
`SUPABASE_URL` hostname; the runbook spells the exact name); (5) negative control: confirm local
dev still runs no-op. The runbook states explicitly that a green deploy proves nothing about
Sentry — only an arrived event does.

**Contract**: markdown checklist; no code. It also records what NOT to do: no DSN in any file, no
`.dev.vars`, no second deploy pipeline.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` exits 0
- `npm run lint` exits 0
- `npm test` green (the extended e2e-env fixed-map test pins `SENTRY_DSN: ""`)
- `npm run e2e` 12+ passed with the local stack up (the added env key reaches the dev server; no
  spec changes)
- `npm run build` exits 0

#### Manual Verification:

- With `SENTRY_DSN=https://fake@fake.ingest.example/1` exported in the shell, `npm run e2e` still
  passes — 12+ green with the ambient value present. The blank's mechanism is pinned where it is
  falsifiable: the fixed-map unit test asserts `SENTRY_DSN: ""` and Playwright's documented merge
  order (`webServer.env` outranks `process.env`) carries it to the child; "no Sentry traffic" is
  deliberately NOT the claimed observable (plan-review F1: it has no signal in either direction)
- AGENTS.md carve-out reads correctly next to the existing `scripts/` exception (a fresh agent
  reading only AGENTS.md would not flag `src/worker.ts` as a violation)
- The runbook is complete enough for the user to execute the deploy without asking anything

**Implementation Note**: After this phase, the change is code-complete. STOP — do not deploy, do
not run `wrangler deploy`, do not set any Cloudflare secret. Hand the runbook to the user.

---

## Testing Strategy

### Unit Tests:

- No new unit tests for `src/worker.ts` itself: every branch in it is I/O composition against two
  external modules (the SDK and the adapter handler) — the same boundary test-plan.md §6.6 draws
  for the drift runner and `run-typecheck.ts`. The wiring is carried by the build inspection and
  the manual no-op check, not by an assertion.
- Two new assertions live in `tests/lib/e2e-env.test.ts`: the fixed map carries `SENTRY_DSN: ""`
  (pinning the blank so its removal is a red), and a `devVars` `SENTRY_DSN` is refused with a
  throw naming `.dev.vars` (the assertion half of the forcing+assertion pair — plan-review F2).

### Integration Tests:

- Full existing suite (`npm test`, 402/402 at last count) — must stay green untouched; nothing new
  is collected.
- `npm run e2e` — drives real browser requests through the dev server, and every dev request
  dispatches `src/worker.ts`'s default export in workerd — the journeys exercise the wrapper's
  no-op branch end to end (see note below).

### Manual Testing Steps:

1. Phase 1: `npm run dev` without `SENTRY_DSN` → app works (wrapper dispatched on every dev
   request; no-op branch, adapter init intact).
2. Phase 2: ambient fake `SENTRY_DSN` in shell → `npm run e2e` green (blank pinned by the unit
   test + Playwright's merge order).
3. Post-merge (user, from the runbook): secret via `wrangler secret put`, deploy via CI, provoke a
   test event, confirm arrival in Sentry UI with a version tag.

**Honest boundary, stated up front (corrected by plan-review F1)**: `npm run dev` and the e2e
harness DO execute `src/worker.ts`. The Cloudflare vite plugin reads `wrangler.jsonc`'s `main`
and every dev request dispatches that module's `default.fetch` in workerd
(`@cloudflare/vite-plugin/dist/index.mjs:48278-48286`,
`dist/workers/runner-worker/index.js:354-359`; the adapter's `handler.js:48-55` carries the
`app.isDev()` branch — one entry serves dev and build). Local verification therefore proves the
wrapper composes correctly and its no-op branch holds under real requests — and a wrapper bug
breaks `npm run dev` and every e2e run loudly, which is a property, not a risk. What remains
provable only on a deployed Worker is the with-DSN behavior: transport of a real event and the
`CF_VERSION_METADATA` version tag — which is exactly why the runbook's provoked-event step is
mandatory and not optional.

## Performance Considerations

Errors-only configuration: no tracing, no logs product, console integration limited to
`warn`/`error`. The wrapper adds one function composition per request; `withSentry` instruments
the fetch handler but with no DSN it short-circuits to pass-through. No measurable impact expected;
no budget needed.

## Migration Notes

No database changes, no migrations, no drift-gate involvement. Rollback = revert the branch
(`main` back to the adapter specifier, remove the package); the Cloudflare secret can stay set
harmlessly — nothing reads it after revert.

## References

- Related research: `context/changes/sentry-monitoring/research.md` (settles adapter version, entry
  mechanics, SDK floor 10.40.0, gate-by-gate verdicts)
- Change brief: `context/changes/sentry-monitoring/change.md` (Jira C10X-53)
- Sentry guide: docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/astro/
- Auto-wrap dead since v13: getsentry/sentry-javascript#21901
- Lessons applied: `context/foundation/lessons.md:19-24` (generated dist config), `:33-38`
  (.env XOR .dev.vars), `:117-122` (verify it WORKS on prod), `:12-17` (one deploy pipeline),
  `:159-164` (close EVERY non-local seam)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Platform wiring — package, worker entry, wrangler config

#### Automated

- [x] 1.1 `npm run typecheck` exits 0 — 8629eb7
- [x] 1.2 `npm run lint` exits 0 — 8629eb7
- [x] 1.3 `npm test` green with the local stack up — 8629eb7
- [x] 1.4 `npm run build` exits 0 and generated `dist/server/wrangler.json` carries `version_metadata` + rewritten `main` (inspected) — 8629eb7
- [x] 1.5 `git grep -i "sentry_dsn"` shows no DSN value anywhere in the repo — 8629eb7

#### Manual

- [x] 1.6 `npm run dev` without `SENTRY_DSN`: app works as before (no-op branch, adapter env wiring intact) — 8629eb7

### Phase 2: Repo hygiene, docs, and the manual-deploy runbook

#### Automated

- [x] 2.1 `npm run typecheck` exits 0
- [x] 2.2 `npm run lint` exits 0
- [x] 2.3 `npm test` green (e2e-env fixed-map test pins `SENTRY_DSN: ""`)
- [x] 2.4 `npm run e2e` passes with the local stack up
- [x] 2.5 `npm run build` exits 0

#### Manual

- [x] 2.6 Ambient fake `SENTRY_DSN` in shell → `npm run e2e` still green (blank pinned by unit test + merge order)
- [x] 2.7 AGENTS.md carve-out reads correctly beside the `scripts/` exception
- [x] 2.8 Runbook complete enough to execute the deploy without questions
