# E2E harness + two browser journeys — Plan Brief

> Full plan: `context/changes/e2e-harness-journeys/plan.md`
> Research: `context/changes/e2e-harness-journeys/research.md`
> Decisions D-01 / D-02: `context/changes/e2e-harness-journeys/change.md`

## What & Why

`test-plan.md` §3 Phase 6 **claims** an e2e layer that nothing **wires**. A Playwright runner and
two specs exist — they landed outside the phased rollout, the fifth time that pattern has repeated
— but running them needs a hand-started dev server plus a `storageState` file no producer creates,
and nothing stops a `PROD_`-swapped `.env` from pointing the whole thing at production. This change
makes the harness runnable and binding, adds the two journeys the phase was scoped for, and closes
the four deferrals the 2026-08-05 refresh handed forward.

## Starting Point

`playwright.config.ts` is 11 lines: hardcoded `baseURL`, a consumed-but-unproduced `storageState`,
an inert `trace: "on-first-retry"` (no `retries` is configured, so no first retry can occur), no
`webServer`, no preflight, no npm script, no browser install. `seed.spec.ts` cleans up **inline in
the test body** — which has already failed once, orphaning `E2E deck 1785947414992` on 2026-08-05.
`route-guard.spec.ts` is untracked and is journey B in all but name, with seven audited defects.
The session artifact works but is hand-made, undocumented, and belongs to an account
(`test@mail.com`) whose password is recorded nowhere. The dev database has grown to 487 users /
5459 decks against `max_rows = 1000`.

## Desired End State

`npm run e2e` runs the whole layer from a clean checkout after one documented
`npx playwright install chromium`. The config refuses to proceed against a non-local Supabase
**before a server exists**; Playwright owns the dev server and hands it a verified environment; a
setup project mints the session through the real UI; both journeys run; and a teardown project
removes every row the run created even when a spec dies mid-way. The layer stays **never a gate**.

## Key Decisions Made

| Decision                        | Choice                                                                                                                           | Why (1 sentence)                                                                                                                                                                                                | Source                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Where the preflight runs        | **Config-module evaluation**, not `globalSetup`                                                                                  | Measured in Playwright 1.62.1: plugin setup (and therefore `webServer`) runs _before_ `globalSetup`, so an assertion there would let a mis-pointed server boot first                                            | Plan                              |
| What the preflight asserts over | The **merged** map `{ …loadEnv, …forced, …parseDevVars() }`                                                                      | The Cloudflare adapter merges `.dev.vars` into the child's `process.env` _after_ `webServer.env` lands, so a file the runner's `loadEnv` never sees outranks everything else                                    | Plan-review F2                    |
| The two shared predicates       | **Extracted** to `tests/setup/env-assertions.ts`, imported by both callers                                                       | A verbatim copy would put the guard deciding whether a key bypasses RLS in two places with nothing keeping them in step                                                                                         | Plan-review F4                    |
| `trace` repair                  | `retries: 0` + `trace: "retain-on-failure"`                                                                                      | A non-zero `retries` on a never-a-gate layer hides exactly the flakes this repo treats as findings (§6.2, C10X-39)                                                                                              | Plan-review F7                    |
| Server ownership                | `webServer`, `reuseExistingServer` **unset**                                                                                     | It is the only arrangement where the local-host assertion is binding — `webServer.env` outranks `process.env` outranks `.env`, and nothing a running server exposes reveals which Supabase project it points at | Plan                              |
| E2E account                     | One stable account, constants in the setup file, sign-up-or-sign-in                                                              | Exactly `tests/fixtures/accounts.ts:34-62`; zero env surface, works on a fresh checkout, and the harness keeps its current zero-auth-requests-per-run cheapness                                                 | Change.md D-01 + Plan             |
| Cleanup                         | Worker-scoped fixture + **teardown project**, name registered _before_ the row is created, one file per worker under `outputDir` | Survives a mid-test failure — the mode that already orphaned a deck; inline cleanup is banned. Registering after creation would reproduce the bug one layer up                                                  | Change.md D-01 + Plan + review F6 |
| What the teardown removes       | `deck` **and** `generation_session`                                                                                              | `generation_session` has no deck FK, so a deck-scoped teardown leaves it — and a deck-only row oracle reads green over that                                                                                     | Plan-review F1                    |
| `seed.spec.ts`                  | Kept as the exemplar, migrated off inline cleanup                                                                                | The file `/10x-e2e` learns conventions from must stop teaching the pattern that failed                                                                                                                          | Plan                              |
| Enforcement                     | Isolation guard + `eslint-plugin-playwright`, landed **before** the specs                                                        | A lint rule written after the specs describes them instead of shaping them                                                                                                                                      | Plan                              |
| Mock-generation seam            | Static assertion only, forced through `webServer.env`                                                                            | The forcing is a construction guarantee; the runtime banner oracle is ambiguous exactly when it is needed (absence conflates "key set" with "signed out")                                                       | Plan                              |
| Journey A accept path           | Both — single card, then bulk, asserting 0 → 1 → N                                                                               | Covers both UI paths; distinct expected counts keep a red attributable                                                                                                                                          | Plan                              |
| Bookkeeping in scope            | `.gitignore`, §6.11 + full doc-sync, roadmap H-12 + `:234`                                                                       | The three deferrals this phase owns; the orphaned-deck deletion and the 5459-deck sweep were declined as outside mandate                                                                                        | Plan                              |
| Branch handling                 | Recorded as a **prerequisite**, no git steps in the plan                                                                         | Git is `/ship`'s bookend                                                                                                                                                                                        | Change.md D-02                    |

## Scope

**In scope:** config-time preflight + `webServer`; `npm run e2e`; `.gitignore` artifact classes;
runner-isolation guard; `eslint-plugin-playwright`; session producer (setup project); fixture +
teardown project; `seed.spec.ts` migration; journey B adopted with edits E1–E7; journey A; full
doc-sync (test-plan §3/§4/§5/§6.6/§6.11/§7/§8, README, roadmap H-12 and `:234`).

**Out of scope:** any CI job or `needs:` entry; journey C (SRS — Risk #3 is covered by unit +
integration); mass cleanup of the 5459 decks and the one orphaned deck; visual-diff or
computed-style oracles (§7's exclusions stand); `scroll-padding-top`; hand-edits to `jira-map.md`;
git work for the predecessor.

## Architecture / Approach

Three tiers, and putting a check in the wrong one silently weakens it:

```
config module eval   →  loadEnv + .dev.vars merge + sync assertions  →  builds webServer.env map
        ↓                (local host, key class, OpenRouter, cookie name, browser binary)
webServer (plugin)   →  npm run dev, with the verified map (outranks process.env and .env)
        ↓
setup project        →  Supabase reachability, sign-in through the real UI, write storageState
        ↓
chromium project     →  journey A + journey B + seed exemplar   (register rows in a fixture)
        ↓
teardown project     →  RLS-aware cleanup as the same account, runs regardless of outcome
```

## Phases at a Glance

| Phase                 | What it delivers                                                                      | Key risk                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. Runner foundation  | Config-time preflight, `webServer`, `npm run e2e`, `.gitignore`, pure-half unit tests | Getting the tier wrong makes the assertion decorative rather than binding                         |
| 2. Enforcement        | Isolation guard + `eslint-plugin-playwright`                                          | The lint plugin may red the existing specs — that is a finding, not noise                         |
| 3. Session + teardown | Setup project, account constants, fixture, teardown, `seed.spec.ts` migration         | A setup that writes an empty `storageState` fails silently downstream                             |
| 4. Journey B          | `route-guard.spec.ts` adopted with E1–E7 + breakage pair                              | E1 is blocking: today the public control passes over an app returning 500                         |
| 5. Journey A          | Generate → accept (single + bulk) → deck page 0 → 1 → N → reload                      | `Edytuj` exists on two pages and `Akceptuj` matches the bulk button without `exact`               |
| 6. Doc-sync           | §6.11 + §3/§4/§5/§6.6/§7/§8, README, roadmap H-12 + `:234`                            | §5's `never a gate` must survive the day the phase lands; prettier is non-idempotent on this file |

**Prerequisites:** `test-plan-refresh-2026-08-05` shipped to `main` and archived; this change
branched off a clean `main`; local Supabase stack up (`npm run db:start`);
`npx playwright install chromium`.

**Estimated effort:** ~4–6 sessions across 6 phases; Phase 6 is the single largest piece of work.

## Open Risks & Assumptions

- `reuseExistingServer` unset **forbids the hand-started `npm run dev`** that is currently the only
  way to run the suite. This is the accepted price of a binding preflight, and it is the change
  most likely to be re-argued later.
- The stable account **carries state between runs**, so no spec may assume an empty starting deck
  list — the accepted price of D-01.
- The current `storageState`'s durability rests on GoTrue answering reuse of a revoked refresh
  token with its existing child. Not a contract this project owns; any `supabase stop` / `db:reset`
  kills it. Phase 3 makes that irrelevant by producing the file, but a reader of a red run needs
  the sentence.
- The teardown **stops** row growth; it does not repay the 5459-deck debt, which stays as an
  unfalsifiability hazard for any future unbounded-result-set assertion.
- Two journeys exercise at most two islands on one happy path each, while four carry a `fetch` —
  so §7's islands exclusion survives this phase, per its own restated per-island condition.
- The cleanup registry keeps a residual failure mode: a worker killed between the registration
  write and its flush still loses that entry. Narrower than the inline pattern it replaces, which
  lost the row on any failure at all — but not zero.
- Whether a teardown **project** runs on SIGINT is **not established**; Phase 5's 5.8 measures it
  and records the answer either way, rather than the plan asserting the guarantee.
- Adding `eslint-plugin-playwright` puts the specs' _source_ under a fail-closed CI step, on top of
  the type gate that has covered `tests/e2e/**` since 2026-08-05. The gates say the layer compiles
  and lints; they never say anything ran it, and that is not a softening of §5.

## Success Criteria (Summary)

- `npm run e2e` is green from a clean checkout with no dev server running and no `user.json` on
  disk, and leaves **two** deltas of `0` — `deck` and `generation_session`, counted separately
  because a total and its breakdown are two claims.
- A `PROD_`-swapped `.env` — **or a `.dev.vars` layered over a valid one** — is refused **before**
  any server starts or any packet leaves the machine.
- Fifteen deliberate-breakage runs reproduce red with their observed failure strings and
  denominators, and every restore is verified — including the two pairs whose _green_ half is the
  evidence. (Enumerated from the plan's Progress section: this line read "eleven" while the phases
  listed fourteen, before the review added the fifteenth.)
