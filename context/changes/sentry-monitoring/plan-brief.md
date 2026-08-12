# Sentry Monitoring on Production (C10X-53) — Plan Brief

> Full plan: `context/changes/sentry-monitoring/plan.md`
> Research: `context/changes/sentry-monitoring/research.md`

## What & Why

Wire server-side Sentry error monitoring into 10xCards (Astro 6.3.1 on Cloudflare Workers) so
production errors stop being invisible: today the only sink is Workers Logs, which nobody is
alerted by. The wiring follows the documented custom-entry path for `@astrojs/cloudflare` v13 —
a new `src/worker.ts` wraps the adapter handler in `Sentry.withSentry`, with the DSN read
exclusively from the Worker environment (Cloudflare secret), never from code.

## Starting Point

No `@sentry/*` package exists anywhere in the repo. Research settled the adapter-version question
the brief raised: 13.5.0 is on the custom-entry path (auto-wrap has been dead since v13 per the
Sentry maintainer), `nodejs_compat` is already on, and the wiring needs zero CI changes — the vite
plugin bundles the custom entry at build time.

## Desired End State

A deployed Worker (deployed by the user, from a runbook — this change stops before deploy) reports
uncaught exceptions and dependency warn/error console output to Sentry, each event tagged with the
deploy's version id. With no DSN set, the same code is a structural no-op — local dev, tests, and
CI behave byte-identically to today.

## Key Decisions Made

| Decision        | Choice                                                                        | Why (1 sentence)                                                                                       | Source                  |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------- |
| Wiring path     | Custom entry (`main` → wrapper file)                                          | Adapter 13.5.0's user-set `main` wins verbatim; maintainer-endorsed path for v13+ (#21901)             | Research                |
| Entry file      | `src/worker.ts` (not root `sentry.server.config.ts`)                          | Names what it is, avoids undocumented SSR-graph auto-injection, passes all `src/` guards               | Plan                    |
| Scope           | Server-only — `@sentry/cloudflare` alone, no `@sentry/astro`                  | Brief centers "monitoring produkcji"; no browser bundle impact                                         | Plan                    |
| Audit boundary  | Platform only — no `captureException` at the 5 audit sites                    | C10X-48…52 own their fixes; `captureConsoleIntegration` captures ZERO of them (no console calls there) | Research                |
| SDK options     | Errors only — no tracing, no Sentry Logs                                      | Brief asks for error monitoring, not APM; minimal quota surface                                        | Plan                    |
| Release tagging | Yes — `version_metadata` binding now                                          | Cheap; every event carries the deploy id, else error↔deploy correlation is manual                      | Plan                    |
| DSN handling    | Cloudflare secret (prod) / gitignored `.env` (optional local) / never in repo | User's explicit requirement; `withSentry` reads `env.SENTRY_DSN` per invocation, falsy → no-op         | Frame-level requirement |
| Source maps     | Deferred                                                                      | Needs `@sentry/astro` + first-ever `env:` on CI build step; minified frames accepted for now           | Plan                    |
| e2e hygiene     | `SENTRY_DSN: ""` in the e2e env map                                           | Ambient DSN would leak events from test runs — "close EVERY non-local seam" lesson                     | Research                |

## Scope

**In scope:** `@sentry/cloudflare` dependency; `src/worker.ts` custom entry; `wrangler.jsonc`
(`main` + `version_metadata`); e2e env blanking; AGENTS.md carve-out; doc-sync; manual deploy +
prod-sanity runbook.

**Out of scope:** deploy itself (user runs it); client-side Sentry; source-map upload;
instrumenting C10X-48…52's five sites; tracing/Sentry Logs; any `astro:env` schema change;
`SENTRY_AUTH_TOKEN` (not needed anywhere in this scope).

## Architecture / Approach

`wrangler.jsonc` `main` → `./src/worker.ts`, which imports the adapter's default handler
(preserving its module-scope env wiring) and default-exports
`Sentry.withSentry((env) => ({ dsn: env.SENTRY_DSN, integrations: [captureConsole(warn,error)] }), handler)`.
The vite plugin bundles this at build time; the generated `dist/server/wrangler.json` is what
deploys — so verification inspects the generated config, per the standing lesson. Two sinks
coexist: Workers Logs keeps raw output, Sentry adds aggregation/alerting.

## Phases at a Glance

| Phase                | What it delivers                                                           | Key risk                                                                                  |
| -------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1. Platform wiring   | Package + `src/worker.ts` + wrangler config; build produces wrapped Worker | Wrapper breaking the adapter's env init (mitigated: import, never copy; manual dev check) |
| 2. Hygiene + runbook | e2e env blank, AGENTS.md carve-out, doc-sync, deploy runbook               | Silent no-op on prod if secret forgotten — runbook makes provoked-event check mandatory   |

**Prerequisites:** local Supabase stack for the suites; a Sentry account/project only at deploy
time (user's step).
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- Corrected by plan-review F1: `npm run dev` and e2e DO execute `src/worker.ts` — the vite plugin
  dispatches `wrangler.jsonc`'s `main` in workerd on every dev request, so local runs exercise the
  wrapper's no-op branch. Only the with-DSN behavior (real transport, version tag) is provable
  solely on a deployed Worker — hence the mandatory provoked-event step in the runbook.
- Day-one signal is modest by design: uncaught fetch-boundary exceptions + Supabase dependency
  console output. First-party swallowed errors start arriving only as C10X-48…52 land.
- Assumes `@sentry/cloudflare` 10.x types resolve cleanly under `strict` +
  `noUncheckedIndexedAccess` (they ship their own types; no contrary signal found).

## Success Criteria (Summary)

- All repo gates green (typecheck, lint, test, e2e, build) with the wrapper in place; generated
  deploy config carries the new entry + binding.
- No DSN literal anywhere in the repo — secret-only, no-op on empty, proven by grep and by a
  dev-mode run without the variable.
- User can execute the deploy end-to-end from the runbook alone and sees a provoked test event in
  Sentry tagged with the deploy version.
