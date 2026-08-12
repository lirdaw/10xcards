# Verification — sentry-monitoring (C10X-53)

Written 2026-08-12 during `/10x-impl-review`, because the two implementation phases ticked their
Progress boxes without leaving a record anywhere. Everything below was **executed against the tree
on this date**, not transcribed from the plan. Where a claim is an inference rather than a
measurement, it says so.

Two runs are recorded per gate where it matters: the **pre-review** run (the tree as the phases
left it, `b63380b`) and the **post-review** run (after the impl-review fixes to `src/worker.ts`,
`context/foundation/infrastructure.md`, `context/foundation/roadmap.md`, `.env` and the runbook).

## Gates

| Gate                                    | Pre-review (`b63380b`)                              | Post-review (working tree)                          |
| --------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `npm run typecheck`                     | exit 0 — `Result (146 files): 0 errors, 0 warnings` | exit 0 — `Result (146 files): 0 errors, 0 warnings` |
| `npm run lint`                          | exit 0 — 3 warnings                                 | exit 0 — 3 warnings                                 |
| `npm test`                              | 405/405, 33 files, seed `1786546022289`             | 405/405, 33 files                                   |
| `npm run build`                         | exit 0                                              | exit 0                                              |
| `npm run e2e`                           | 12 passed (21.1 s)                                  | 12 passed (21.4 s)                                  |
| `npm run e2e` with ambient `SENTRY_DSN` | 12 passed (15.0 s)                                  | 12 passed (14.9 s)                                  |

The 3 lint warnings are all `no-console` in `evals/generation-quality.eval.ts` — pre-existing, the
same 3 this project has carried since C10X-42, and untouched by this change.

## Plan success criteria, criterion by criterion

**1.1 / 1.2 / 1.3 / 2.1 / 2.2 / 2.3 / 2.5** — the gate table above.

**1.4 — the generated config carries `version_metadata` and a rewritten `main`.** Inspected rather
than assumed, which is what the lesson about `@astrojs/cloudflare` deploying the _generated_ config
demands. `dist/server/wrangler.json` carries `"version_metadata":{"binding":"CF_VERSION_METADATA"}`,
`"main":"entry.mjs"`, `"compatibility_flags":["nodejs_compat"]`, the `SESSION` KV binding with its
concrete id, and `"observability":{"enabled":true}`.

**1.5 — no DSN value in the repo.** `git grep -inE "https://[a-z0-9]+@[a-z0-9.-]+ingest[a-z0-9.-]*/"`
over the tracked tree, excluding the `.example` fixture, returns **nothing**. The only DSN-shaped
strings are `https://fake@fake.ingest.example/1` in `tests/lib/e2e-env.test.ts` (an RFC-2606
`.example` host, not routable) and `<key>@<org>.ingest.<region>.sentry.io` placeholders in the
runbook. `.env` is untracked (`.gitignore:29`); `.dev.vars` is ignored (`.gitignore:100`).

**1.6 — `npm run dev` works with no `SENTRY_DSN`.** Supported indirectly but strongly:
`playwright.config.ts:22` sets `webServer.command: "npm run dev"`, so each `npm run e2e` boots the
real dev server and drives 12 browser journeys — sign-in, `/decks`, generation, card acceptance —
through `src/worker.ts`'s default export in workerd. Four such runs are recorded above. This is
evidence about the wrapper composing correctly and its no-op branch holding under real requests; it
is **not** evidence about the with-DSN transport path, which only a deployed Worker can show.

> **Corrected 2026-08-12 during the ship, by measurement, and the correction is larger than the
> criterion.** The clause "through `src/worker.ts`'s default export in workerd" is an
> **inference**, flagged here as "supported indirectly", and it does not survive contact:
> `npm run dev` emitted **45** dependency warnings with a valid, unquoted DSN in `.env` and sent
> **zero** events, while the built Worker under `npm run preview` sent on the first series. The
> DSN was proved good independently — a raw envelope POSTed at the ingest endpoint, bypassing the
> SDK, returned **HTTP 200**. So the e2e runs are evidence that **the app works**, not that
> requests traverse `src/worker.ts`; had the wrapper never been in the dev path at all, those 12
> journeys would have passed identically. The likely mechanism is `@astrojs/cloudflare` passing
> `viteEnvironment: { name: "ssr" }` to `@cloudflare/vite-plugin`, so `astro dev` runs Astro's SSR
> environment rather than `wrangler.jsonc`'s `main` — **the effect is measured, the mechanism is
> not.** What this criterion still supports, unchanged, is its own headline: `npm run dev` works
> with no `SENTRY_DSN`. What it never supported is the wrapper being exercised. The BUILD path is
> separately confirmed: `dist/server/entry.mjs` is 170 bytes and does
> `import { w } from "./chunks/worker-entry_*.mjs"`, re-exporting it — and that chunk is the one
> carrying `withSentry`.

**2.4 / 2.6 — the e2e blank holds against an ambient DSN.** Reproduced independently, twice, by
exporting `SENTRY_DSN=https://fake@fake.ingest.example/1` into the shell before `npm run e2e`: 12
passed both times. The mechanism is pinned where it is falsifiable — `tests/lib/e2e-env.test.ts:100`
asserts `expect(env.SENTRY_DSN).toBe("")` against a _non-empty_ source, so removing the blank goes
red. "No Sentry traffic" is deliberately **not** the claimed observable; it has no signal in either
direction.

**2.7 — the AGENTS.md carve-out.** Read in place. `AGENTS.md:8` makes the hard rule forward-point to
its two exceptions before a reader can form the wrong conclusion, and `:11` names file, reason and
boundary in the same shape as the `scripts/` exception, framed as a _shape_ constraint rather than a
key count.

**2.8 — the runbook.** Reviewed end to end; it exceeds its contract. Of note, it **corrects the
plan's own provocation**: the plan proposed `...auth-token=garbage`, and the runbook records a
measurement that `garbage` produces zero warnings, because a value without the `base64-` prefix is
returned unchanged. The working value is `base64-bm90anNvbg`. Executing the plan verbatim would
have produced a silent false negative in the one step that proves Sentry works.

## Impl-review fixes, and how each was verified

**F1 — request bodies no longer reach Sentry.** `Sentry.httpServerIntegration({ maxRequestBodySize: "none" })`
added. The load-bearing check is on the artifact, not the source: `dist/server/chunks/` now carries
`maxRequestBodySize: "none"` beside the library's own `"medium"`, so the override reaches the
deployed bundle. Both textual `src/` guards stay green (6/6) — `src/worker.ts` contains **zero**
occurrences of the lowercase `console` identifier, verified by grep, so the new comments did not
trip the guard.

**F3 — dependency-event sampling.** A blanket `sampleRate` was rejected on evidence: it cannot
separate the storm from the signal and would drop ~90% of the rare uncaught exception this
monitoring exists to surface. `captureconsole.js` stamps its events (`event.logger = "console"`,
mechanism `auto.core.capture_console`), so the classes are separable at `beforeSend`. Shipped: real
exceptions pass untouched, the dependency class is sampled at `DEPENDENCY_EVENT_SAMPLE_RATE = 0.1`.
Verified in the artifact — the shipped chunk carries `if (event.logger !== "console") return event;`.
**The rate is reasoned, not measured**; re-tune on production volume.

> **Corrected 2026-08-12 during the ship, by measurement, and this one changed the CODE.** The
> sentence "real exceptions pass untouched" was the design intent and was **false in this
> application**. `logger === "console"` does not separate the two classes, because **Astro catches
> route errors and re-emits them through its own logger** — so a genuine first-party exception
> arrives stamped `logger = "console"` exactly like a dependency warning, and the old `beforeSend`
> sampled it. Measured against the built Worker under `npm run preview`: **21** deliberate uncaught
> errors thrown from a temporary route produced **3** events (~14 %, i.e. the 0.1 rate), each tagged
> `console` in the Sentry UI. Since this app has no route that throws PAST Astro — the runbook says
> so itself — the unsampled branch would essentially never have fired in production, so ~90 % of
> real application errors would have been dropped silently.
>
> Fixed by keying the sampling on the noise's **signature** (`DEPENDENCY_NOISE`, matching
> `@supabase/ssr` and `@supabase/auth-js`) instead of on its transport, fail-open: anything not
> positively recognised as known dependency noise passes through. Re-measured against the built
> Worker with the DSN pointed at a local sink so envelopes could be counted exactly:
>
> | Class                              | Emitted                       | Envelopes | Expected   |
> | ---------------------------------- | ----------------------------- | --------- | ---------- |
> | first-party uncaught error         | 25 requests                   | **25**    | 25 (100 %) |
> | `@supabase/ssr` dependency warning | 180 warnings over 60 requests | **6**     | thinned    |
>
> **One thing is measured but NOT explained, and is recorded rather than smoothed over.** One
> request emits three identical warning lines, so 180 lines at a 0.1 rate would predict ~18
> envelopes, not 6. The observed count matches "~10 % of REQUESTS" (60 → 6) far better than "~10 %
> of LINES", which suggests the three identical lines within one request collapse into one event
> before `beforeSend` — Sentry's default dedupe integration is the obvious candidate. It was not
> isolated. The load-bearing claims do not depend on it: the first-party class is at **100 %** and
> the dependency class is demonstrably thinned.

**F2 — local `.env` no longer carries a live DSN.** Blanked in place, key kept. The other four keys
are untouched, including the `PROD_SUPABASE_URL`/`PROD_SUPABASE_KEY` pair; line count unchanged
13 → 13. Rebuilt, and `dist/server/.dev.vars` now carries `SENTRY_DSN=""`. **One measurement
correction worth carrying**: a first readout reported that artifact as still set, and it was false —
the adapter writes values **quoted**, so a naive split on `=` sees `""` as a two-character value.
The oracle that settles it is the raw line length (11 in `.env`, 13 in `.dev.vars`), not a
non-empty test on the split field.

> **Extended 2026-08-12 during the ship — the quoting is not merely a reading nuisance, it is
> load-bearing.** This note treats the quotes as an obstacle to _measuring_ the file. They also
> break it: wrangler does **not** strip them, so the SDK receives a DSN containing literal `"`
> characters, judges it malformed, and takes its silent no-op branch — presenting exactly as a
> missing secret. Measured as a pair on the same build: quoted → 30 warnings, **0** envelopes;
> the identical file unquoted → 30 warnings, **2** envelopes, i.e. the 10 % sampling working as
> designed. **This is a preview-harness artifact and not a production defect** —
> `wrangler secret put` stores the raw pasted value — but it is what makes any local proof via
> `npm run preview` silently fail, and `deploy-runbook.md` §2 now carries the strip step.

**F4 — `infrastructure.md` corruptions repaired.** `:133-134` re-wrapped so `queries + OpenRouter`
sits mid-line, which is the durable form: the `+` can no longer be read as a list marker on a future
reformat. `:148-149` puts the split code span on one line. `npx prettier --check` reports the file
already conforms, so `lint-staged` will not churn it back. A sweep for lines carrying an odd number
of backticks across the whole file returns **zero**, so no other latent split code span is waiting.

**F5 / F6 — docs.** A dated correction appended beneath `roadmap.md:106` that annotates the
`## Baseline` snapshot rather than rewriting it, pointing at H-14 as the live statement; the
generalised rule recorded in `context/foundation/lessons.md`. The runbook's §0 now prohibits a DSN
**value** rather than the key name, removing its tension with `.env.example`'s empty row.

## What remains unproven, by construction

- **The with-DSN path.** Transport of a real event and the `CF_VERSION_METADATA` version tag are
  provable only on a deployed Worker. That is precisely why the runbook's provoked-event step is
  mandatory: a green deploy proves nothing about monitoring, only an arrived event does.
- **The sampling rate's fitness.** `0.1` is reasoned from the storm's shape, not measured against
  real traffic.
- **Client-side errors.** `@sentry/astro` is not installed, so React-island errors stay invisible to
  Sentry, and without source-map upload prod stack traces are minified. Both are deliberate scope
  exclusions, not gaps discovered here.
- **Query strings and URLs still reach Sentry.** F1 closed the body channel; `?q=` search terms are
  a separate, live decision that nobody has taken yet.
