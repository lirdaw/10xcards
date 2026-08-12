---
date: 2026-08-11T19:17:01+02:00
researcher: Claude Code
git_commit: 3d0bee8bb79b68a80443ce6b43bf38d7f6302edf
branch: C10X-53-sentry-monitoring
repository: My10xCards_v2
topic: "Sentry monitoring on production — Astro 6.3.1 on Cloudflare Workers (adapter v13 path)"
tags: [research, codebase, sentry, cloudflare, astro, observability, worker-entry, swallowed-errors]
status: complete
last_updated: 2026-08-11
last_updated_by: Claude Code
---

# Research: Sentry monitoring on production — Astro 6.3.1 on Cloudflare Workers

**Date**: 2026-08-11T19:17:01+02:00
**Researcher**: Claude Code
**Git Commit**: 3d0bee8bb79b68a80443ce6b43bf38d7f6302edf
**Branch**: C10X-53-sentry-monitoring
**Repository**: My10xCards_v2

## Research Question

From `context/changes/sentry-monitoring/change.md` (Jira C10X-53): establish the CURRENT state of
the repo's configuration for a Sentry integration — which `@astrojs/cloudflare` adapter major is
installed and therefore which Sentry wiring path applies (v13 custom entry point vs v14
`virtual:cloudflare/worker-entry`, per getsentry/sentry-javascript#21901); minimum
`@sentry/astro` / `@sentry/cloudflare` versions supporting that variant; how to wire
`captureConsoleIntegration({ levels: ["warn","error"] })` for the swallowed-error audit class;
DSN from a Cloudflare secret with no-op behavior on empty; `nodejs_compat` state. No deploy —
research and plan inputs only.

## Summary

**The repo is on the v13 path, and it is exactly the path the current Sentry docs are written
for.** Installed (from `package-lock.json`, not ranges): `@astrojs/cloudflare` **13.5.0**,
`astro` **6.3.1**, `wrangler` **4.90.0**, `vite` **7.3.3**, `@cloudflare/vite-plugin` **1.36.3**.
The canonical guidance is Sentry's "Astro on Cloudflare" guide, whose prerequisites are verbatim
this stack (Astro ≥6, adapter v13+, `@sentry/astro` ≥10.40.0, `@sentry/cloudflare` ≥10.40.0;
latest of both is 10.70.0, published 2026-08-10). The wiring is one config line plus one new
file: point `wrangler.jsonc`'s `main` at a custom entry that imports the adapter handler and
default-exports `Sentry.withSentry((env) => ({ dsn: env.SENTRY_DSN, … }), handler)`. CI needs
**zero** changes — the vite plugin bundles the custom entry and rewrites `main` in the generated
`dist/server/wrangler.json`, which is what `wrangler deploy` actually reads.

Four load-bearing findings that adjust the change brief:

1. **The v13-vs-v14 dichotomy in the brief is not the real picture for 13.5.0.** Adapter 13.5.0
   _already_ builds through `@cloudflare/vite-plugin` and its `virtual:cloudflare/worker-entry` —
   but the user's `main` wins verbatim (the adapter only _defaults_ it), and the plugin bundles a
   file-path `main` as the user entry. Issue #21901's maintainer confirms auto-wrap has been dead
   since **v13** (not v14) and names the custom entry as the working path for both v13 and v14.
   So the plan does not need to hedge between two variants: custom entry is the documented,
   maintainer-endorsed seam for this exact adapter version.
2. **`captureConsoleIntegration` captures ZERO of the five audit findings.** The
   "swallowed-error" audit (session audit 2026-08-11, tickets C10X-48…C10X-52, recorded only in
   `context/foundation/jira-map.md:119-155` — no repo artifact) consists of dropped `{ error }`
   results and discarded awaited calls with **no console call at all**. First-party `console.*`
   in `src/` is impossible (`tests/lib/no-logging.test.ts` gates it). What
   `captureConsoleIntegration` will actually capture is **dependency-emitted** output:
   `@supabase/ssr` cookie warnings and `@supabase/auth-js` fetch errors. Closing the audit class
   itself requires `Sentry.captureException`/`captureMessage` at the five sites (or checking the
   errors) — that work belongs to C10X-48…52, and the plan must not claim the integration covers
   it.
3. **DSN-from-secret with no-op on empty is confirmed at the API level.** `withSentry`'s options
   callback receives the Worker `env` per invocation, so `dsn: env.SENTRY_DSN` reads the
   Cloudflare secret at runtime — no build-time DSN. A falsy DSN (unset or `""`) takes the
   no-transport branch in `@sentry/core` (debug-only warning, no throw), so the same code ships
   to environments with and without Sentry.
4. **`nodejs_compat` is already on** (`wrangler.jsonc:6`), which is the only compatibility flag
   current docs require. `observability.enabled: true` is also already on — Workers Logs is
   today's only sink and receives only dependency output.

One naming decision is left open for the plan: the docs name the entry file
`sentry.server.config.ts`, but the `@sentry/astro` integration auto-detects that exact filename
and injects it into the SSR graph — harmless in the Workers shape (the file only exports, no
side-effectful `Sentry.init()`), but undocumented. Naming it e.g. `src/worker.ts` avoids the
injection at the cost of 1:1 docs parity (and puts it inside `src/`'s census guards, all of
which it passes — see Detailed Findings §7).

## Detailed Findings

### 1. Installed versions — the adapter-version question is settled

From `package-lock.json` (exact, not ranges):

| Package                   | Installed  | Note                                                 |
| ------------------------- | ---------- | ---------------------------------------------------- |
| `@astrojs/cloudflare`     | **13.5.0** | `^13.5.0` in `package.json:27` — v14 is out of range |
| `astro`                   | 6.3.1      |                                                      |
| `wrangler`                | 4.90.0     | also pinned in CI (`wranglerVersion: "4.90.0"`)      |
| `vite`                    | 7.3.3      | via `overrides` (`package.json:75-77`)               |
| `@cloudflare/vite-plugin` | 1.36.3     | the adapter's build engine                           |

No `@sentry/*` package is installed and nothing in code/config references Sentry yet — only
`context/changes/sentry-monitoring/change.md` and the branch name.

### 2. Entry-point mechanics of adapter 13.5.0 — the real seam

- The current `wrangler.jsonc:4` is `"main": "@astrojs/cloudflare/entrypoints/server"`. That
  specifier resolves (via `node_modules/@astrojs/cloudflare/package.json:22-24`) to a 6-line
  file, `node_modules/@astrojs/cloudflare/dist/entrypoints/server.js`:

  ```js
  import { handle } from "../utils/handler.js";
  var server_default = { fetch: handle };
  export { server_default as default };
  ```

  The default export is a standard `ExportedHandler` (`{ fetch(request, env, ctx) }`) —
  signature-compatible with `Sentry.withSentry(optionsFn, handler)`.

- **The adapter only defaults `main`; a user-set value wins verbatim** —
  `node_modules/@astrojs/cloudflare/dist/wrangler.js:31`:
  `main: config.main ?? "@astrojs/cloudflare/entrypoints/server"`.
- **13.5.0 already uses `virtual:cloudflare/worker-entry`.** The build delegates to
  `@cloudflare/vite-plugin` (`dist/index.js:6`, `:137-141`), whose worker-entry virtual module
  re-exports the _user entry_ — which is whatever `main` points at
  (`@cloudflare/vite-plugin/dist/index.mjs:40716-40745`). A relative `main` ending in
  `.js/.mjs/.ts/.mts/.jsx/.tsx` is resolved against the config dir and **existence-checked at
  build time** (`index.mjs:41167-41187`) — a path typo fails `npm run build`, not the deploy.
- **Generated deploy config rewrites `main`.** The build writes `dist/server/wrangler.json` with
  `main: "entry.mjs"`, `no_bundle: true` (`index.mjs:53057-53061`) plus a
  `.wrangler/deploy/config.json` redirect (`index.mjs:34472-34503`, constant at `:1587`). A bare
  `wrangler deploy` reads the generated config — this is the mechanism behind the existing
  lesson "rebuild after editing wrangler.jsonc" (`context/foundation/lessons.md:19-24`).
- Two fields the adapter injects that are not in `wrangler.jsonc`: `images: { binding: "IMAGES" }`
  and `previews.*` (`dist/wrangler.js:13-25,35`). Also noteworthy: the build emits
  `dist/server/.dev.vars` containing real local + `PROD_`-prefixed values
  (`index.mjs:53071-53076`, preview-only mechanism; gitignored via `dist/`, but worth knowing it
  exists in the build dir).

**Conclusion**: the change is `wrangler.jsonc:4` → a repo file (e.g. `"./sentry.server.config.ts"`
or `"./src/worker.ts"`) that imports `@astrojs/cloudflare/entrypoints/server` and wraps it. The
import keeps the adapter's module-scope side effects (`setGetEnv` before `createApp()`,
`handler.js:19-20`) intact.

### 3. Deploy pipeline — zero CI changes for the entry swap

`.github/workflows/ci.yml` `deploy` job: `npm ci` → `npx astro sync` → `npm run build` →
`cloudflare/wrangler-action@v4` with `command: deploy` (no `-c`), pinned
`wranglerVersion: "4.90.0"`. Because the custom entry is consumed at **build** time and the
deployed config still says `main: entry.mjs`, no CI edit is needed for the wiring itself.

Two boundaries with precedent value:

- The `build` step has **no `env:` block by explicit design** (repo carries no
  `SUPABASE_URL`/`SUPABASE_KEY` secrets; the build tolerates that only because every
  `astro:env` field is `optional: true`). A `SENTRY_DSN` runtime secret via
  `wrangler secret put` needs nothing here. **Source-map upload would** need a new
  `SENTRY_AUTH_TOKEN` secret plus a first-ever `env:` on the build step — a real scope decision,
  not a default.
- The change brief's "wrangler.toml" is `wrangler.jsonc` in this repo; nothing functional
  references it besides the build (only prose mentions: `README.md:66`,
  `tests/lib/no-logging.test.ts:25` — the latter cites `wrangler.jsonc:17-19` by line number,
  which will drift if lines above it are edited).

### 4. Runtime env — where the DSN can come from

- The adapter wires `astro:env/server` at module scope from the `cloudflare:workers` global env:
  `node_modules/@astrojs/cloudflare/dist/utils/handler.js:1,8,19` (`setGetEnv(createGetEnv(globalEnv))`).
  Astro 6 removed `Astro.locals.runtime.env` (handler.js:70-76 throws pointing at
  `cloudflare:workers`); `locals.cfContext` (handler.js:66) carries the `ExecutionContext`.
- For the wrapper itself, the cleanest DSN source is the `env` parameter that `withSentry`'s
  options callback receives per invocation — no dependency on `astro:env` initialization order
  and no schema change strictly required.
- If the DSN should _also_ be readable from app code (e.g. a config-status banner), adding
  `SENTRY_DSN` to the `astro:env` schema (`astro.config.mjs:17-24`) works, but it **must stay
  `optional: true`** — CI's secret-free `npm run build` depends on every field being optional.

### 5. Current Sentry guidance (docs + issue #21901 + versions, as of 2026-08-11)

- **Canonical page**: "Astro on Cloudflare" under the Cloudflare guide
  (docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/astro/). The generic Astro
  guide explicitly redirects Workers users there ("This SDK currently only works on Node
  runtimes…"). Prerequisites quoted by the docs: Astro ≥6.0.0, `@astrojs/cloudflare` v13+,
  `@sentry/astro` ≥10.40.0, `@sentry/cloudflare` ≥10.40.0.
- **Recommended setup**: install **both** `@sentry/astro` and `@sentry/cloudflare`;
  `nodejs_compat` in `compatibility_flags` (already on); change `main` to the custom entry:

  ```ts
  import * as Sentry from "@sentry/cloudflare";
  import handler from "@astrojs/cloudflare/entrypoints/server";

  export default Sentry.withSentry(
    (env) => ({ dsn: env.SENTRY_DSN, tracesSampleRate: 1.0, enableLogs: true }),
    handler,
  );
  ```

  keep `sentry()` in `astro.config.mjs` integrations (it owns the **browser** half —
  `sentry.client.config.ts` injection — and source-map upload); "Server-side Sentry is already
  configured in your custom entry point file" — no Node-style server config exists on this path.

- **Issue #21901** (open, no fix PR): `@sentry/astro`'s auto-wrap transform matches the
  `astrojs-ssr-virtual-entry` module id, which was a **v12** artifact — maintainer (JPeer264,
  2026-07-02): "this got removed in v13+ … In the meantime please use the worker entrypoint to
  make it work." So auto-wrap is silently dead on v13 _and_ v14, and custom entry is the
  endorsed path for both. The brief's framing ("v13 = custom entry, v14 = different approach")
  collapses into one answer for this repo: custom entry.
- **Versions** (npm, 2026-08-11): `@sentry/astro` and `@sentry/cloudflare` latest **10.70.0**
  (2026-08-10). Floor for this path: **10.40.0** (release 2026-02-24, "feat(astro): Add support
  for Astro on CF Workers (#19265)"). `@sentry/astro` peerDeps:
  `astro: ">=3.x || >=4.0.0-beta || >=7.0.0-beta"` — 6.3.1 satisfies; no vite peer constraint.
  `@sentry/cloudflare` optional peers: `wrangler ^4.x` ✓.
- **`captureConsoleIntegration`**: exported by `@sentry/cloudflare` (docs page
  …/guides/cloudflare/configuration/integrations/captureconsole/); option shape
  `{ levels: ["warn", "error"] }` is valid (default is all six levels).
- **DSN no-op**: docs — "The DSN tells the SDK where to send the events. If this is not set, the
  SDK will not send any events." Source (`packages/core/src/client.ts`): falsy `dsn` → debug-only
  `debug.warn('No DSN provided, client will not send events.')`, no throw, no transport. Empty
  string is falsy → same branch. Note there is **no** `process.env.SENTRY_DSN` fallback at
  runtime on Workers — the DSN must be passed explicitly from `env`.
- **Changelog items worth knowing**: 10.42.0 "Do not inject withSentry into Cloudflare Pages";
  10.35.0+ auto-release from `CF_VERSION_METADATA.id` (optional `version_metadata` binding);
  10.64.0+ optional `@sentry/cloudflare/nodejs_compat` entrypoint unlocking extra Node features
  (will become default in next major).
- **Flagged ambiguity — entry file name**: docs name the entry `sentry.server.config.ts`, the
  same filename `@sentry/astro`'s integration auto-detects and injects into the SSR graph
  (`injectScript("page-ssr", …)` mechanism described in #21901). In the Workers shape the file
  only default-exports `withSentry(...)` (no top-level `Sentry.init()`), so the SSR-graph
  evaluation is effectively side-effect-free — but the docs never say so explicitly. Naming the
  file differently (e.g. `src/worker.ts`) avoids the injection entirely; `main` points at it by
  path either way.

### 6. `captureConsoleIntegration` vs the swallowed-error audit class — the correction

The change brief motivates `captureConsoleIntegration` with "ciche console.warn z handlerów
(klasa swallowed-error z audytu)". Research falsifies the premise on both halves:

- **The audit class has no console calls.** The audit lives only in
  `context/foundation/jira-map.md:119-155` (session audit 2026-08-11, label
  `audit-swallowed-errors`, tickets C10X-48…C10X-52; no repo artifact). All five findings are
  **dropped results**, confirmed present today:

  | Ticket  | Site                                        | What is dropped                                                                                                 |
  | ------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
  | C10X-48 | `src/pages/api/generate.ts:396`             | result of compensating `failGenerationSession(...)` — a failed compensation leaves `saved_count` over-reporting |
  | C10X-49 | `src/pages/api/generate.ts:387,400`         | result of `deleteDeck(...)` undo — an orphan deck permanently 409s every "Ponów"                                |
  | C10X-50 | `src/pages/api/generate.ts:277-301,314-328` | result of the `status:"failed"` audit-row insert — a failed audit write is invisible                            |
  | C10X-51 | `src/pages/api/auth/signout.ts:7-9`         | result of `supabase.auth.signOut()` — unconditional success redirect                                            |
  | C10X-52 | `src/middleware.ts:47-50`                   | `error` from `getUser()` — auth/transport failure reads as "not signed in"                                      |

  None of these emits anything; `tests/lib/no-logging.test.ts:102-104` guarantees no first-party
  `console.*` exists anywhere under `src/`. **`captureConsoleIntegration` therefore captures
  zero of C10X-48…52.** Making those errors reach Sentry requires `captureException` /
  `captureMessage` at the sites (or checking and surfacing the errors) — work that belongs to
  those five tickets, not to the integration's mere presence.

- **What the integration WILL capture** — dependency-emitted output reachable in the Worker:
  - `@supabase/ssr/dist/module/cookies.js:22` — `console.warn` on undecodable chunked cookie
    (includes the caught error) and `:29` — `console.warn` on invalid-JSON cookie. (`:103,117`
    "without setAll" warns are unreachable — `src/lib/supabase.ts:18` supplies `setAll`.)
  - `@supabase/auth-js/dist/module/lib/fetch.js:110` — `console.error(e)` on every failed
    GoTrue fetch before rethrowing `AuthRetryableFetchError` (the fetch `TypeError`, not request
    init).
  - `@supabase/auth-js/dist/module/GoTrueClient.js:3427,3430` — `console.error` on
    auth-state-change callback errors (reachable; most other auth-js sites are browser-gated).

  This matches the boundary `test-plan.md` §7 records: dependency log lines are "in scope but
  unowned" for Risk #4 — the integration finally gives them an owner with alerting, which is a
  real (if different from the brief's stated) gain.

- **Adjacent swallow sites not in the audit** (candidates if the plan adds `captureException`):
  `src/pages/api/generate.ts:374-379` (23505-replay lookup error folded into generic 500),
  `src/lib/supabase.ts:7-9` + `src/middleware.ts:51-53` (missing config presents as
  "everyone logged out" — named in `context/foundation/infrastructure.md:138-140`),
  `src/lib/openrouter.ts:212,219,231` (parse reasons discarded, though converted into surfaced
  errors).

### 7. Repo gates the change must pass

All verdicts below are from reading the guards' current code:

- **`tests/lib/no-logging.test.ts`** — scans `src/` only (every file, regex on the literal
  identifier `console`, `:38`). Sentry API calls in `src/` pass. Trap: the guard is textual —
  even a _comment_ containing `console.warn` inside a `src/` file fails. A root-level entry file
  is not scanned at all.
- **`tests/lib/no-env-access.test.ts`** — scans `src/` only for `import.meta.env` /
  `process.env` (`:37-40`). Cloudflare-style `env.SENTRY_DSN` (property on an `env` parameter or
  `cloudflare:workers` import) **passes** both patterns. Root files are out of scope. Note the
  _prose_ rule `AGENTS.md:9` ("read env only through `astro:env/server`") — a `src/worker.ts`
  reading the Worker env binding is textually legal but stylistically novel; worth an explicit
  comment or an AGENTS.md touch-up in the plan.
- **`tests/lib/error-param-guard.test.ts`** — scans the whole of `src/` (`.astro/.ts/.tsx`,
  `:112-118,242-247`); a new `src/worker.ts` is walked and must not contain a
  `.get("error")` call on a non-comment line. Floors only (`>=69`), growth safe.
- **`tests/lib/form-endpoint-guards.test.ts`** — binds `src/pages/api/**` only; the exact
  `toHaveLength(6)` on `formData()` readers (`:152`) is untouched by this change.
- **`tests/lib/e2e-isolation.test.ts`** — walks the repo root; a root config file and
  `src/worker.ts` trip nothing (only `.test.ts` under `tests/e2e/` or stray `.spec.ts` files
  do). It re-reads `vitest.config.ts:26` and `playwright.config.ts:14` textually — don't
  restructure those literals.
- **Typecheck** (`npm run typecheck`, CI + `pre-push`): `tsconfig.json:3` includes `**/*`
  (excluding `dist`, `context`), so both a root entry file and `src/worker.ts` enter the gate
  under `strict` + `noUncheckedIndexedAccess`; the file-count assertion is a floor
  (`MIN_CHECKED_FILES = 50`, `scripts/typecheck.ts:54`), growth safe. `@sentry/cloudflare` types
  must resolve under this tsconfig (they ship their own; `@cloudflare/workers-types` is an
  optional peer if an `Env` interface is wanted).
- **Lint** (`eslint.config.js`): type-aware `strictTypeChecked` + `stylisticTypeChecked` with
  `projectService: true` applies to every `.ts` including root files (root `.ts` is traversed
  via the `files: ["**/*.{js,jsx,ts,tsx}"]` block, `:54`); `prettier/prettier` is an **error**.
  Name the entry `.ts` — `.mts`/`.cts` match no `files` pattern. Watch `no-unsafe-*` /
  `no-floating-promises` around SDK calls.
- **Vitest/Playwright collection**: `include: ["tests/**/*.test.ts"]` and
  `testDir: "./tests/e2e"` — no new file is collected by either runner.
- **Env seams for tests**: no allow-list anywhere blocks a new `SENTRY_DSN`. But
  `tests/e2e/setup/env.ts:109-115,190-200` builds a **fixed map** for `webServer.env` that does
  _not_ blank unknown keys — Playwright merges `{...process.env, ...options.env}`, so an ambient
  `SENTRY_DSN` in the shell/`.env` **would flow into the e2e dev server**. If e2e runs must be
  Sentry-silent, add `SENTRY_DSN: ""` to the `E2eEnv` map — `tests/lib/e2e-env.test.ts:235` uses
  `toMatchObject`, so the added key breaks nothing. `tests/setup/preflight.ts` asserts only its
  three known keys and is indifferent.
- **Husky**: `pre-commit` lint-staged auto-fixes the new `.ts`; `pre-push` runs the full
  typecheck. Never `--no-verify`.

### 8. What already exists that the change interacts with

- `wrangler.jsonc` today: `main: "@astrojs/cloudflare/entrypoints/server"` (`:4`),
  `nodejs_compat` (`:6` — the brief's requirement is already satisfied), `observability.enabled`
  (`:17-19` — Workers Logs stays as a second sink alongside Sentry).
- Error-recording today is the DB audit row, not a log: `src/lib/generations.ts:119-124`
  (`failGenerationSession`) and the two `status:"failed"` inserts in
  `src/pages/api/generate.ts:277-301,314-328`. `context/foundation/roadmap.md:105` records
  observability as "partial — tylko wbudowane Cloudflare observability".
- Client-side errors surface via the closed-set `?error=` channel and island `setError` states;
  every API `catch` returns a 4xx/redirect with owned Polish copy (no swallowing there).

## Code References

- `wrangler.jsonc:4` — `main`, the single seam to change; `:6` — `nodejs_compat` already on;
  `:17-19` — observability enabled
- `astro.config.mjs:16-24` — `cloudflare()` with no options; `astro:env` schema (4 optional
  server secrets)
- `package.json:27` / `package-lock.json` — `@astrojs/cloudflare` 13.5.0 exact
- `node_modules/@astrojs/cloudflare/dist/entrypoints/server.js` — `{ fetch: handle }` default
  export (the handler to wrap)
- `node_modules/@astrojs/cloudflare/dist/wrangler.js:31` — `main: config.main ?? …` (user value
  wins)
- `node_modules/@astrojs/cloudflare/dist/utils/handler.js:1,8,19,66,70-76` — env wiring from
  `cloudflare:workers`, `locals.cfContext`, removed `locals.runtime.env`
- `node_modules/@cloudflare/vite-plugin/dist/index.mjs:40716-40745` — user entry via
  `virtual:cloudflare/worker-entry`; `:41167-41187` — `maybeResolveMain` (build-time existence
  check); `:53057-53061` — generated config rewrites `main: entry.mjs`
- `.github/workflows/ci.yml` — deploy job: build → `wrangler-action@v4 command: deploy`, no
  `-c`, no `env:` on build (by design)
- `src/pages/api/generate.ts:277-301,314-328,374-379,387,396,400` — swallowed-error sites
  (C10X-48/49/50 + one adjacent)
- `src/pages/api/auth/signout.ts:7-9` — C10X-51; `src/middleware.ts:47-53` — C10X-52 + null-client
  fold
- `node_modules/@supabase/ssr/dist/module/cookies.js:22,29` and
  `node_modules/@supabase/auth-js/dist/module/lib/fetch.js:110` — the dependency console output
  `captureConsoleIntegration` will actually capture
- `tests/lib/no-logging.test.ts:38,102-104` — console guard (src/ only, textual);
  `tests/lib/no-env-access.test.ts:37-40` — env guard (src/ only);
  `tests/lib/error-param-guard.test.ts:242-247` — whole-src scan a new `src/worker.ts` enters
- `tests/e2e/setup/env.ts:109-115,190-200` — fixed e2e env map that does NOT blank `SENTRY_DSN`
- `context/foundation/jira-map.md:119-155` — the swallowed-errors audit record (C10X-48…52)

## Architecture Insights

- **The custom entry is a supported composition point, not a hack.** Adapter v13 delegates
  worker bundling to `@cloudflare/vite-plugin`, which treats `main` as the user entry and
  re-exports its default through the virtual worker-entry. Wrapping the imported handler
  preserves the adapter's module-scope initialization (`setGetEnv` → `createApp`) because the
  wrapper imports the same module.
- **DSN resolution belongs in the `withSentry` options callback**, not in `astro:env` — it runs
  per invocation with the real Worker `env`, needs no schema change, and makes the no-op-on-empty
  contract structural (falsy DSN → no transport, same code everywhere). Adding the key to the
  `astro:env` schema is optional and only needed if app code (e.g. a config banner) should see
  it; if added, it must stay `optional: true`.
- **Two sinks, different jobs**: Workers Logs (already on) keeps raw dependency output;
  Sentry adds aggregation/alerting plus — only where explicitly instrumented — first-party
  exceptions. The repo's own architecture (closed-set error messages, no first-party logging,
  DB audit rows) means Sentry's marginal value on day one is: uncaught exceptions at the fetch
  boundary, dependency console output (via `captureConsoleIntegration`), and a place for the
  C10X-48…52 fixes to send their newly-checked errors.
- **The gates constrain style, not feasibility.** Every repo guard passes with the documented
  setup; the only genuinely new patterns are (a) a file reading Worker env outside
  `astro:env/server` (legal — the guards check `process.env`/`import.meta.env` literally — but
  contra the AGENTS.md prose rule, worth a written carve-out like the existing `scripts/` one)
  and (b) possibly the repo's first root-level runtime source file if docs naming is kept.

## Historical Context (from prior changes)

- `context/foundation/lessons.md:19-24` — "@astrojs/cloudflare deploys the generated dist config
  — rebuild after editing wrangler.jsonc": directly applicable; the `main` edit reaches prod only
  through `npm run build`.
- `context/foundation/lessons.md:33-38` — ".env XOR .dev.vars": a `SENTRY_DSN` for local dev
  goes in `.env` only; note the build emits `dist/server/.dev.vars` on its own (preview
  mechanism).
- `context/foundation/lessons.md:117-122` — "Zweryfikuj, że feature DZIAŁA na PROD": the no-op
  contract makes a missing prod secret _deliberately silent_, so prod-sanity must verify an
  actual event arrives in Sentry (e.g. a provoked test error), not just a green deploy. The user
  deploys manually per the brief — this is a checklist item for them, not for CI.
- `context/foundation/lessons.md:12-17` — one deploy pipeline per Worker (GitHub Actions is the
  one; unchanged by this work).
- `context/foundation/jira-map.md:119-155` — the audit this change's brief cites; C10X-48…52
  own the per-site fixes, C10X-48↔C10X-26 and C10X-52↔C10X-39 are linked.
- `context/foundation/test-plan.md` §7 — dependency log lines "in scope but unowned" for Risk
  #4; `captureConsoleIntegration` changes that boundary (they gain a monitored sink).
- `context/foundation/infrastructure.md:138-140` — the `createClient` null-swallow observation
  (adjacent to C10X-52, not in the audit's five).

## Related Research

- `context/archive/2026-07-26-ai-candidate-generation-test-2/` — Risk #4 (leak/log) coverage and
  the measurement of the two dependency console sites this change would start capturing.
- `context/changes/e2e-harness-journeys/` (archived 2026-08-09) — the e2e env map mechanics
  relevant to keeping Sentry out of test runs.

## Open Questions

1. **Entry file name & location** — `./sentry.server.config.ts` at root (1:1 with docs; exempt
   from `src/` census guards; but auto-detected and injected into the SSR graph by the
   `sentry()` integration — harmless yet undocumented) vs `./src/worker.ts` (no injection;
   enters `src/` guards, which it passes; contra AGENTS.md's env-prose unless annotated).
   Plan-time decision.
2. **Client-side half in scope?** The docs path includes the `sentry()` integration +
   `sentry.client.config.ts` (browser errors, optional tracing/replay). The brief says
   "monitoring produkcji" and centers server-side capture; whether the browser half ships in
   C10X-53 or is deferred is a scope decision. If deferred, `@sentry/astro` may be droppable
   entirely (install only `@sentry/cloudflare`) — but then no source-map upload and no client
   config injection exist to inherit later.
3. **Source maps** — upload requires `SENTRY_AUTH_TOKEN` in CI's build step (`env:` block has
   zero precedent there, by design). Likely defer; stack traces will show minified frames until
   then.
4. **Scope boundary vs C10X-48…52** — the plan should state explicitly that
   `captureConsoleIntegration` does not close the audit class; decide whether C10X-53 adds any
   `captureException` calls (e.g. at the five sites) or strictly ships the platform and leaves
   instrumentation to the five tickets.
5. **`enableLogs: true`** (docs snippet) — opts into Sentry Logs (a separate product surface)
   alongside error events; include or drop?
6. **`@sentry/cloudflare/nodejs_compat` entrypoint** (≥10.64.0) — extra Node features, becomes
   default next major; adopt now or stay on the default entrypoint?
7. **e2e/test hygiene** — add `SENTRY_DSN: ""` to the e2e `E2eEnv` map so an ambient DSN can't
   leak events from test runs? (Cheap, tolerated by existing assertions.)
8. **Release tagging** — optional `version_metadata` binding (`CF_VERSION_METADATA`) gives
   automatic release ids on ≥10.35.0; include in `wrangler.jsonc` now or later?
