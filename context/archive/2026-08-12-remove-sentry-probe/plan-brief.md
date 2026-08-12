# Remove the public /api/shipprobe error probe — Plan Brief

> Full plan: `context/changes/remove-sentry-probe/plan.md`

## What & Why

`GET /api/shipprobe` is a public, unauthenticated route that throws on every request. It shipped
deliberately with H-14 so the Sentry prod-sanity step could be repeated on demand, and it was always
temporary. The risk is not in removing it — it is in **delaying**: every hit is one **unsampled** event,
so a loop against it exhausts the Sentry quota, and that failure is self-masking (past the cap,
unrelated errors stop arriving and this project has no notification channel to say so).

## Starting Point

The route is inert and isolated: zero importers, zero tests, no config entry, not in `PROTECTED_ROUTES`,
routed by filesystem convention alone. Deleting it breaks nothing automated — the type gate asserts a
floor of 50 against a total far above it, and the tightest tree-walking guard (the unregistered-file
scan in `error-param-guard.test.ts`, `>= 69` against a measured 71) keeps a spare. The entire cost is documentary: 11 present-tense claims across three
live files and 7 in the archived deploy runbook, whose §5 opens by telling its reader to call this route.

The gap the ticket does not name: the `beforeSend` discriminator in `src/worker.ts` that lets first-party
errors through at 100 % while thinning dependency noise to ~10 % has **no test at any layer** — and its
first version sampled on the wrong signal and silently dropped ~90 % of real application errors, caught
only by measurement during the C10X-53 ship and fixed in `d381c07`. The probe was the only instrument
that would have surfaced a recurrence.

## Desired End State

`GET /api/shipprobe` returns **404** on production where it returned **500** before, and exists in
neither the repo nor the deployed Worker. The sampling discriminator behaves identically, now as a pure
function with a test that goes red if a first-party error ever becomes sampled again. Every live document
matches reality; the archived runbook tells its next reader the cheap path is gone without falsifying
what was true on its own date.

## Key Decisions Made

| Decision                       | Choice                                           | Why (1 sentence)                                                                                                                | Source |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Plain deletion vs replacement  | Delete, and cover the regression class by a test | The reason to want a permanent probe is regression detection, which a unit test does at a cheaper layer and inside CI.          | Plan   |
| Guarded replacement endpoint   | Declined                                         | A permanent throwing route plus another secret buys a prod convenience the test already covers; roadmap H-15 calls it separate. | Plan   |
| Prod oracle                    | Pair: `500` before → `404` after, same host      | A lone `404` is also what a typo'd URL, a wrong host or a stale Worker returns — the pair is what makes it evidence.            | Plan   |
| Re-prove monitoring after ship | No                                               | Removing a route cannot break the wrapper, so a provocation series would test something this change does not touch.             | Plan   |
| Archived runbook               | Dated corrections under §5 and §6, no rewrite    | `lessons.md:236` — a dated snapshot takes a correction, never an overwrite.                                                     | Plan   |
| Roadmap `Status → done`        | Not touched                                      | `lessons.md:180` reserves the flip and the `## Done` entry for `/10x-archive`.                                                  | Plan   |
| `test-plan.md` scope           | §7 exclusion correction only                     | No §2 risk row moves and no coverage claim widens; a full ledger entry would be disproportionate to one test file.              | Plan   |
| Randomness in the extraction   | Injected as a parameter                          | `Math.random()` inside the decision makes it untestable; same idiom as `rateCard`'s `now`.                                      | Plan   |

## Scope

**In scope:** deleting `src/pages/api/shipprobe.ts`; extracting `beforeSend` plus its two constants into
`src/lib/sentry-sampling.ts` as a pure function; a new `tests/lib/sentry-sampling.test.ts` plus a
`tests/lib/sentry-wiring.test.ts` guard that `src/worker.ts` still calls it; doc-sync
across roadmap H-15 and H-14, `src/worker.ts`'s comment, the archived runbook and `test-plan.md` §7;
deploy and the production `404` reading.

**Out of scope:** any guarded replacement endpoint; any change to sampling behaviour or to the rate;
re-proving Sentry is alive post-deploy; the roadmap `Status` flip and `## Done` entry; `jira-map.md`;
a `test-plan.md` §6.6/§8 ledger entry; client-side Sentry, source maps and alert rules; any local
`wrangler deploy`.

## Architecture / Approach

`src/worker.ts` keeps everything that makes it the Worker entry — the adapter import that triggers
`setGetEnv`, the `WorkerEnv` interface, the `dsn: env.SENTRY_DSN` read, both integrations. Only the
sampling decision moves out, into a pure module that reads no env and owns no randomness:
`beforeSend(event)` becomes one line supplying `Math.random()` to
`sampleSentryEvent(event, roll)`. The test drives the real imported function, so the real
`DEPENDENCY_NOISE` array is what decides — the same idiom as `tests/middleware.test.ts` driving the real
`PROTECTED_ROUTES` rather than a copy.

## Phases at a Glance

| Phase                               | What it delivers                                         | Key risk                                                                                        |
| ----------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. Baseline + delete                | The `500` reading, and the route gone from the repo      | The baseline is **unrecoverable after merge**; forget it and the `404` proves nothing           |
| 2. Extract + test the discriminator | `src/lib/sentry-sampling.ts`, its test, its wiring guard | The `@/*` alias is unproven in the Worker entry — `npm run build` is the check, with a fallback |
| 3. Doc-sync                         | Live docs true; archive corrected without a rewrite      | Editing a dated snapshot in place instead of appending to it                                    |
| 4. Ship + prod sanity               | `404` on production, paired with Phase 1's `500`         | A `skipped` deploy job would make the reading measure the previous Worker                       |

**Prerequisites:** H-14 (C10X-53) done and Sentry prod sanity confirmed closed — settled 2026-08-12.
The production hostname — `wrangler.jsonc` gives the shape (`10xcards.<account-subdomain>.workers.dev`),
only the **account subdomain** is unrecorded, so confirm the full host from the last `deploy` job or the
Cloudflare dashboard (runbook P5); rights to merge to `main`;
an authenticated `gh`.
**Estimated effort:** ~1 session across 4 phases; the code is one deletion plus one extraction, the bulk
is documentation discipline and the two production readings.

## Open Risks & Assumptions

- **Assumption, already acted on:** prod sanity for Sentry is closed and nobody needs to repeat it. If
  that turns out to be false, the probe is the only way to provoke a first-party error on production and
  this change should not ship yet.
- The `@/*` alias resolving inside `src/worker.ts` is inferred from `src/middleware.ts`, not observed for
  this file. Fallback is a sibling-directory import.
- After this change the cheapest "is Sentry alive on prod?" check is the runbook's 20-request dependency
  series read against an event counter. That is a deliberate, stated cost, not an oversight.
- The extraction is asserted to be semantics-preserving by the new test plus the existing suite; no test
  exercised the old inline code, so there is no before/after behavioural baseline beyond that.

## Success Criteria (Summary)

- `GET /api/shipprobe` returns `404` on the production host that returned `500` before the change.
- A first-party error can no longer become sampled without a test going red — proved by a deliberate
  breakage that restores the pre-`d381c07` discriminator and turns exactly those cases red.
- No live document still describes the probe as existing, and the archived runbook's §5 remains a
  runnable procedure rather than an instruction pointing at a 404.
