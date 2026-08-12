<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Sentry Monitoring on Production (C10X-53)

- **Plan**: context/changes/sentry-monitoring/plan.md
- **Mode**: Deep
- **Date**: 2026-08-11
- **Verdict**: REVISE → SOUND after triage (all 5 findings fixed in the plan, 2026-08-11)
- **Findings**: 1 critical, 2 warnings, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | FAIL    |
| Plan Completeness     | WARNING |

## Grounding

6/6 paths ✓ (`wrangler.jsonc`, `tests/e2e/setup/env.ts`, `tests/lib/no-logging.test.ts`, `tests/lib/e2e-env.test.ts`, `context/foundation/roadmap.md`, `context/foundation/lessons.md`); symbols ✓ (`main` at `wrangler.jsonc:4`, observability at `:17-19`, `no-logging.test.ts:25` cite, `e2e-env.test.ts:235` `toMatchObject`, `roadmap.md:105`, all five cited `lessons.md` ranges); brief↔plan ✓ — consistent, including the shared false claim corrected by F1.

Deep-mode verification (sub-agent over installed packages) additionally confirmed: user-set `main` wins verbatim (`@astrojs/cloudflare/dist/wrangler.js:31`); the `entrypoints/server` subpath resolves WITH types under `moduleResolution: "Bundler"` (adjacent `server.d.ts`); the textual guards (`no-env-access`, `no-logging`, `error-param-guard`) all pass for the planned `src/worker.ts` under the plan's stated comment constraints; CI deploy runs `npm run build` before `wrangler-action` (`ci.yml:171-179`) so zero CI changes are needed.

## Findings

### F1 — "Honest boundary" is false: the dev server DOES execute `src/worker.ts`

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; edits in 4+ places, but no architectural change
- **Dimension**: Blind Spots
- **Location**: Testing Strategy ("Honest boundary"), Phase 2.1 intent, plan-brief "Open Risks", criteria 1.6/2.6
- **Detail**: The plan claims "`npm run dev` and the e2e harness run Astro's dev server, which does NOT execute `src/worker.ts`". Verified false against the installed packages: the adapter registers `@cloudflare/vite-plugin` in `astro:config:setup` (runs in dev too — `@astrojs/cloudflare/dist/index.js:69,137-141`); the plugin finds `wrangler.jsonc` itself and hands `workerConfig.main` to workerd; every dev request dispatches `default.fetch` of THAT module via the Vite module runner (`@cloudflare/vite-plugin/dist/index.mjs:48278-48286`, `dist/workers/runner-worker/index.js:354-359`; `handler.js:48-55` carries an `app.isDev()` branch — the same entry serves dev and build). The plan also contradicts itself: criterion 1.6 says dev "prov[es] the no-op branch" (assumes the wrapper runs in dev) while Testing Strategy says it does not run there. Consequences: (a) local verification proves MORE than claimed — the wrapper executes on every dev request; (b) the Phase 2.1 e2e blank is genuinely load-bearing, not just hygiene; (c) a wrapper bug breaks `npm run dev` and every e2e run — a property worth stating; (d) manual check 2.6's "the run emits no Sentry traffic" spot-check has no observable signal in any scenario — unfalsifiable.
- **Fix**: Rewrite the Honest-boundary paragraph (plan + brief) to the true model: dev/e2e DO execute the wrapper (the `main` module via the module runner); what stays prod-only is transport with a real DSN + version tagging from `CF_VERSION_METADATA`, so the runbook's provoked-event step stays mandatory for that narrower reason. Align 1.6 (it proves the no-op branch IN dev) and replace 2.6's spot-check with something falsifiable (the unit-test pin + the `webServer.env` merge-order argument).
  - Strength: Removes the internal contradiction and a false claim before it propagates into verification.md (this repo's evidence discipline).
  - Tradeoff: Text edits in four places; zero code change.
  - Confidence: HIGH — four-link evidence chain in the installed packages, plus the fact that `main` is already explicitly set today and dev works through this path.
  - Blind spot: Not confirmed empirically with a trial wrapper — the proof is source-level (criterion 1.6 will close that).
- **Decision**: FIXED — Honest-boundary paragraph, e2e Integration bullet, Phase 1 manual criterion, 2.6 (body + Progress), Phase 2.1 intent, Manual Testing Steps, and the brief's Open Risks bullet all rewritten to the true model.

### F2 — The `.dev.vars` seam for `SENTRY_DSN` is left open (forcing without the assertion)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2.1 (`tests/e2e/setup/env.ts`)
- **Detail**: The plan adds the forcing `SENTRY_DSN: ""` to `webServer.env` — but `env.ts:21-27` itself documents the one exception: `@astrojs/cloudflare` merges `.dev.vars` INSIDE the child AFTER `webServer.env`, so a `SENTRY_DSN` in `.dev.vars` overrides the blank. For `OPENROUTER_API_KEY` the file pairs forcing + assertion (`env.ts:174-183`) for exactly this reason; the plan adds only half the pair. Given F1 (dev executes the wrapper), a `.dev.vars` DSN would initialize Sentry inside e2e runs despite the blank.
- **Fix**: In `buildE2eEnv`, refuse when `SENTRY_DSN` comes from `devVars` (only from `devVars` — a `.env`/shell value is legitimate for local testing and the forcing blanks it effectively; refusing on `effective` would block the documented "optional local `.env` DSN" workflow). One assertion + one case in `tests/lib/e2e-env.test.ts`.
- **Decision**: FIXED — Phase 2.1 contract now requires the devVars refusal + its test case; Testing Strategy's unit-test bullet updated to the pair.

### F3 — The runbook's event provocation is an "e.g." with no verified path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Plan Completeness
- **Location**: Phase 2.4 (deploy-runbook.md), criterion 2.8
- **Detail**: The runbook says "hit a URL that throws or temporarily trigger a dependency warn path" — but this app deliberately has NO route that throws uncaught (research: every API `catch` returns owned copy; closed message set). Criterion 2.8 demands a runbook "complete enough to execute without asking anything" — an "e.g." does not meet that bar. A concrete, code-free provocation exists: a request carrying a garbage `sb-*-auth-token` cookie fires the measured `console.warn` in `@supabase/ssr/cookies.js:22,29` (documented at `no-logging.test.ts:22-28` and in lessons), which `captureConsoleIntegration({levels:["warn","error"]})` captures.
- **Fix**: Write the concrete provocation into Phase 2.4's contract: `curl` against prod with `Cookie: sb-<ref>-auth-token=garbage` → expect a `warning` event in Sentry carrying the version tag.
- **Decision**: FIXED — Phase 2.4 step (4) now names the malformed-cookie provocation with the exact curl shape and the cookie-name derivation note.

### F4 — Workers globals are absent from the typecheck scope — do not "improve" the typing

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 1.2, Critical Implementation Details
- **Detail**: The `@astrojs/cloudflare/entrypoints/server` import types fine (adjacent `server.d.ts`, `moduleResolution: "Bundler"`), but the repo has no `@cloudflare/workers-types` and the injected `cloudflare.d.ts` declares only `App.Locals`. Bare `Env` / `ExecutionContext` / `ExportedHandler` in `src/worker.ts` = red typecheck (`Cannot find name`). The plan's snippet is safe (local `WorkerEnv` interface); its prose "default export is a standard `ExportedHandler`" could tempt an implementer into writing the annotation.
- **Fix**: One sentence in Critical Implementation Details: do not reference Workers type names (workers-types absent); keep the local interface, no `satisfies ExportedHandler`.
- **Decision**: FIXED — warning sentence added to the lint/typecheck bullet in Critical Implementation Details.

### F5 — `infrastructure.md:184` carries stale `main` advice

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 2.3 (doc-sync)
- **Detail**: Blast-radius sweep: `context/foundation/infrastructure.md:184` advises `main: ./dist/_worker.js/index.js` — contradicting the v13 adapter and what this change does. The plan's doc-sync (Phase 2.3) does not know about this file; the next reader gets two conflicting instructions.
- **Fix**: Add `infrastructure.md` to the doc-sync scope (one-line correction) or explicitly record it as out of scope.
- **Decision**: FIXED — `infrastructure.md` added to Phase 2.3's files with the exact one-line correction (`main: ./src/worker.ts`).
