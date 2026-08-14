---
date: 2026-08-14T20:30:53+02:00
researcher: Claude (Opus 5) with Dawid Liro
git_commit: 23b1b91c23b89692abd63f7d980cfac58bcf9f47
branch: main
repository: lirdaw/10xcards
topic: "Local dev-DB test-data debt: blast radius, cleanup mechanics, hygiene ownership, and attribution of the decks.test.ts flake"
tags: [research, codebase, test-harness, max_rows, flake-attribution, dev-database, C10X-47]
status: complete
last_updated: 2026-08-14
last_updated_by: Claude (Opus 5)
---

# Research: dev-DB test-data debt (C10X-47 / `dev-db-test-data-debt`)

**Date**: 2026-08-14T20:30:53+02:00
**Researcher**: Claude (Opus 5), directed by Dawid Liro
**Git Commit**: `23b1b91c23b89692abd63f7d980cfac58bcf9f47`
**Branch**: `main`
**Repository**: lirdaw/10xcards

## Research Question

C10X-47's three scope items:

1. One-off cleanup of the accumulated backlog in the local dev database — `harness-*` accounts with their decks, plus the orphaned `E2E deck 1785947414992`.
2. A decision on whether a scoped reset / hygiene step belongs to the harness, to CI, or stays a manual step.
3. Whether the `tests/validation/decks.test.ts` flake under a random shuffle seed is pure accumulation, or the C10X-39 Kong 502 transport flake — and if the latter, split it out.

## Summary

Four verdicts, three of which contradict something the ticket assumes.

**1 — The debt is ~2.7× larger than the ticket records, and it is growing at 68 decks per full suite run.** The ticket's `5459 decks` is the 2026-08-09 figure. Measured at the start of this research: **14,495 decks / 1,192 harness accounts**. 99.94 % of decks belong to `harness-*` accounts. The per-run cost was measured three independent ways that agree exactly: 68 decks, 116 flashcards, 33 generation sessions, 22 schedule rows, and **2 auth users per `vitest` invocation** — the users are paid even by a filtered single-file run, because provisioning is in `globalSetup`.

**2 — The accumulation harms exactly two assertions, and only under the deliberate-breakage neuter — not during a normal run.** This is a real narrowing of the ticket's premise. The maximum decks owned by any **single** account is **64**, against `max_rows = 1000`, because accounts are minted fresh per run. So no per-account query truncates today. The `max_rows` cliff is reached only when an RLS policy is neutered and the result set becomes database-wide — i.e. exactly when a developer runs the falsification procedure the project relies on. **The accumulation disarms the project's falsification tooling, not its everyday assertions.** Research also found a **second vulnerable assertion that no artifact in this project has ever named** (`candidate_counts_by_deck`, `tests/review/candidates.test.ts:613`), and corrected a premise: `study_due_cards` is **not** in the vulnerable class.

**3 — The flake is NOT accumulation. It is two distinct defects, and one of them is now reproduced, measured and fixable in one line.** CI run #66's first attempt failed on a database `npx supabase start` had created two minutes earlier on a throwaway runner — there was nothing accumulated, so accumulation is refuted structurally rather than by argument. Separately, a 92-run local matrix reproduced a **different** flake at **3/92 ≈ 3.3 %**, with **zero** Kong drops in all 92 runs: two test files create a deck with the _literally identical_ name `Gate deck ${suffix}` for the _same_ account, and collide whenever their module-load timestamps land in the same millisecond.

**4 — CI's database is ephemeral, so accumulation is structurally a local-only condition.** `.github/workflows/ci.yml:68` runs `npx supabase start` on a fresh GitHub-hosted runner every job, with no cache, volume, restore or teardown. Nothing accumulates in CI, ever. This removes "add a CI hygiene step" from the option set entirely.

**Recommendation (scope item 2), stated up front and argued in §6:** a one-off cleanup now, plus a repeatable, developer-invoked **`npm run db:clean`** script following the project's existing `scripts/` pure+IO convention — and **not** an automatic per-run teardown. The deciding constraint is that the suite holds an anon key by design (`assertAnonKey`), so a teardown inside the suite could only ever delete its **own** run's rows and could never delete `auth.users` at all; it would stop the marginal bleed while leaving both the existing debt and the user-row counter untouched, and it would destroy post-mortem evidence after a red run.

---

## Detailed Findings

### 1. Measured state of the local dev database

All figures read directly from `supabase_db_10x-astro-starter` via `docker exec … psql`, read-only.

| Table                  | At research start (2026-08-14 ~20:05) | After this research's own 92 suite runs |
| ---------------------- | ------------------------------------: | --------------------------------------: |
| `auth.users`           |                                 1,206 |                                   1,482 |
| — of which `harness-*` |                                 1,192 |                                   1,468 |
| `deck`                 |                            **14,495** |                                  20,748 |
| `flashcard`            |                                25,145 |                                  35,810 |
| `flashcard_schedule`   |                                 4,796 |                                   6,817 |
| `generation_session`   |                                 6,316 |                                   9,352 |

**Disclosure: this research added 6,253 decks.** 92 full-suite runs × 68, minus 3 for the runs that failed a deck creation. `14,495 + 6,253 = 20,748` closes exactly against the measured total — which is itself the strongest confirmation of the per-run figure. The additions were deliberate (a rate estimate for the flake is worth more than rows we are about to delete), but they are mine and are recorded here rather than buried.

**Ownership split — the cleanup target is unambiguous:**

| Bucket                              |            Decks | Generation sessions |
| ----------------------------------- | ---------------: | ------------------: |
| `harness-*` accounts                | 14,487 (99.94 %) |               6,305 |
| 7 named accounts (manual-run + e2e) |                8 |                  11 |

**Growth by day** (decks created): 2026-08-14 = 2,787 · 08-13 = 2,911 · 08-12 = 1,134 · 08-09 = 2,204 · 08-05 = 64 · 08-03 = 567 · 08-02 = 504 · 08-01 = 2,437 · 07-31 = 1,887. Days with no rows are days nobody ran the suite.

**The accumulation costs nothing but falsifiability.** Total footprint of all five tables is ~20 MB (`flashcard` 8.9 MB, `generation_session` 5.3 MB, `deck` 4.6 MB). Every column a query filters on is indexed — `deck_user_id_idx`, `deck_user_name_unique`, `flashcard_deck_id_idx`, `generation_session_user_id_idx`. There is no performance or disk argument for cleanup, and stating one would be false.

### 2. Where the rows come from, and what cleanup would have to touch

**Provisioning is global, not per-file.** `vitest.config.ts:32` lists `globalSetup: ["tests/setup/preflight.ts", "tests/setup/accounts.ts"]`; `tests/setup/accounts.ts:9-13` calls `provisionAccounts()` once per invocation and publishes via `project.provide(...)`. Two accounts (A and B) are minted per run, `harness-${label}-${runId}@example.com` with `runId = Date.now().toString(36)` (`tests/fixtures/accounts.ts:60,86`). A third is minted inside `tests/auth/signout.test.ts:43`, because `signOut()` is `scope: "global"` and would otherwise kill the shared cookie mid-run.

**Consequence worth naming: 2 user rows are paid by every `vitest` invocation, including a filtered single-file run that creates zero decks.** Measured corroboration: ~290 `harness-a` accounts own **zero** decks. So the 1,192-account backlog represents ~589 invocations, of which only ~228 were full-suite-equivalents.

**Per-run row cost — three independent derivations agree:**

| Table                | Per full run | How established                                                                                                                                         |
| -------------------- | -----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deck`               |       **68** | static census of `createDeck` call sites (70 created − 2 deleted); measured as 64 on A + 4 on B; and measured as a constant `deck_delta` across 92 runs |
| `flashcard`          |          116 | 119 written − 3 deleted at `tests/generation/generate.test.ts:1088-1091`                                                                                |
| `generation_session` |           33 | 23 + 6 + 4 across three files                                                                                                                           |
| `flashcard_schedule` |           22 | measured; seeded lazily by `ensureSchedule` inside `listDueCards`                                                                                       |
| `auth.users`         |            2 | `provisionAccounts` (+1 for the sign-out file)                                                                                                          |

**There is no cleanup of any kind in the Vitest suites.** An exhaustive sweep for `afterAll|afterEach|.delete(|deleteDeck|teardown` found no hygiene hook. The only two deck deletions that land (`tests/isolation/decks.test.ts:144,158`) are _assertions_ proving `deleteDeck`'s zero-row-vs-landed distinction, and are already netted into the 68.

**The cascade makes cleanup a one-liner, and this was measured from `pg_constraint`, not read from a migration:**

```
deck.user_id                   → auth.users(id)          ON DELETE CASCADE
generation_session.user_id     → auth.users(id)          ON DELETE CASCADE
flashcard.deck_id              → deck(id)                ON DELETE CASCADE
flashcard_schedule.flashcard_id → flashcard(id)          ON DELETE CASCADE
flashcard.generation_id        → generation_session(id)  ON DELETE SET NULL
```

Deleting one `harness-*` user removes that run's entire footprint. There is no orphan class: every application row is reachable from its owning user by cascade, and a direct check confirms **0 decks with a missing owner**.

> **A methodological note worth carrying.** An `information_schema` join for foreign keys returned these FKs as _absent_, because the parent table lives in the `auth` schema. Read that way, the conclusion would have been "deleting a user silently orphans their decks" — the opposite of the truth, and it would have produced a materially worse cleanup design. `pg_constraint` is the reliable source for cross-schema FKs.

### 3. The unfalsifiability class — actual blast radius

**The mechanism, restated precisely.** PostgREST truncates any result set at `max_rows = 1000` (`supabase/config.toml:18`). An assertion of the form "the foreign deck is _absent_ from this result set" passes when the deck is merely _outside the truncation window_. `test-plan.md` §6.6 records this happening for real: the four-policy `listDueCounts` neuter passed while all four guarding policies were disabled.

**Why it does not bite today, and this is the narrowing:** under intact RLS, `study_due_counts` returns only the caller's decks, and the **maximum decks owned by any single account is 64**. The cliff is reached only when a policy is set `using (true)` and the scan becomes database-wide. So the accumulation has disarmed **the deliberate-breakage procedure**, not the suite's everyday green.

**Exactly two assertions are affected:**

| Assertion                             | Surface                                                                                          | Status                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------- |
| `tests/study/study.test.ts:407`       | `study_due_counts` (`supabase/migrations/20260724195248_srs_study_schedule.sql:139-150`)         | the documented incident       |
| `tests/review/candidates.test.ts:613` | `candidate_counts_by_deck` (`supabase/migrations/20260725150000_candidate_counts_rpc.sql:31-40`) | **never documented anywhere** |

The second is a genuine discovery of this research. Its own migration header documents the `max_rows` truncation class as the _reason it exists_ — it replaced a JS counter that truncated — while reproducing the identical shape one layer down.

**`ORDER BY` is the discriminator, and it was measured rather than reasoned about.** Simulating a neutered policy (running each RPC body unscoped and taking the first 1000 rows as PostgREST would), then asking whether the 10 newest decks land inside that window:

| Surface                                | Newest 10 decks inside the first 1000 | Why                                              |
| -------------------------------------- | ------------------------------------- | ------------------------------------------------ |
| `candidate_counts_by_deck`             | **4 of 10**                           | `group by`, no `ORDER BY` → hash-aggregate order |
| `study_due_counts`                     | **2 of 10**                           | same                                             |
| `listDecks` (`src/lib/decks.ts:11-13`) | **10 of 10**                          | orders `created_at desc`                         |

So `tests/isolation/decks.test.ts:65` — which its own comment calls "the widest blast radius in the product" — stays falsifiable even under a neuter, purely because its query is ordered. Every other absence-assertion in the suite is scoped by `deck_id`, by a `.like()` marker, or by `.eq("public_id", …)`, and is safe by construction.

**Two corrections to the received account:**

- **`study_due_cards` is not in the vulnerable class.** It carries both `where f.deck_id = p_deck_id` and `limit p_limit` (`supabase/migrations/20260724220524_srs_study_schedule_review_fixes.sql:46-68`). It is bounded on both axes.
- **The `srs_state = 3` canary (`tests/study/study.test.ts:922-943`) is not vulnerable today**, and its safety rests entirely on accounts being fresh per run — max 22 schedule rows per user against a cap of 1000. The C10X-32 fix is in place: the case seeds a row it owns before scanning.

**Boundary, stated because it is one step of reasoning rather than a measurement:** the four-policy neuter was **not executed** during this research — it is a write to RLS policies and outside a read-only remit. That the two assertions _would_ false-pass under it is inferred from the window measurement plus the documented 2026-07-26 incident. The window measurement itself is real.

### 4. Flake attribution — two distinct defects, neither of them accumulation

#### Defect A — cross-file deck-name collision (reproduced, measured, one-line fix)

**Reproduction matrix**: 92 full-suite runs (12 + 80) on 2026-08-14, un-pinned seeds, `upstream_keepalive_pool_size = 0` confirmed applied in `.kong_env`. Per run: seed captured, exit code, Kong keep-alive drops during the run, deck delta.

| Metric                             | Result             |
| ---------------------------------- | ------------------ |
| Runs                               | 92                 |
| Red                                | **3** (≈ 3.3 %)    |
| Kong keep-alive drops, all 92 runs | **0**              |
| `deck_delta` on green runs         | 68, every time     |
| `deck_delta` on red runs           | **67**, every time |
| Mean runtime                       | 10.3 s             |

All three reds carry a byte-identical message: `/decks?error=Talia%20o%20tej%20nazwie%20ju%C5%BC%20istnieje&open=create`. Two fired in `tests/study/study.test.ts`, the third in `tests/review/candidates.test.ts` — the two files are the pair, and whichever loses the race is the victim.

**The seeds are recorded, because §6.2 says to and because C10X-51 lost them twice** (`npx vitest run --sequence.seed=<n>` replays a permutation, though not the millisecond race itself):

| Red run | Seed            | Failing file                      |
| ------: | --------------- | --------------------------------- |
|       9 | `1786731422978` | `tests/study/study.test.ts`       |
|      27 | `1786731618655` | `tests/study/study.test.ts`       |
|      53 | `1786731911688` | `tests/review/candidates.test.ts` |

Note the honest limit of a seed replay here: the seed fixes the _permutation_, not the module-load timestamps, so it does not deterministically reproduce the collision. The reproducible oracle is the `deck_delta` — 67 instead of 68 — which identifies the defect on any run without reading a log.

**Mechanism, confirmed by construction and then in the data.** Both files create a deck named with the _identical literal stem_, for the **same** account A:

- `tests/study/study.test.ts:609` — `createDeck(a, \`Gate deck ${suffix}\`)`
- `tests/review/candidates.test.ts:908` — `createDeck(a, \`Gate deck ${suffix}\`)`

Each file computes its own `const suffix = Date.now().toString(36)` at module scope (`study.test.ts:42`, `candidates.test.ts:47`). Millisecond resolution: when both modules load within the same millisecond, the suffixes are equal, the deck names are equal, the account is the same, and `deck_user_name_unique` rejects the second insert.

**The data confirms it.** For the red run's account, exactly **one** `Gate deck` row exists; every green run's account around it has **two, with different suffixes**:

```
harness-a-mst9r1sz  Gate deck mst9r2xs   18:16:56   ┐ green run: two rows,
harness-a-mst9r1sz  Gate deck mst9r2vk   18:16:58   ┘ different suffixes
harness-a-mst9r9uq  Gate deck mst9rayc   18:17:05   ← RED run: one row only
harness-a-mst9rhxo  Gate deck mst9rj1y   18:17:17   ┐ green
harness-a-mst9rhxo  Gate deck mst9rj5y   18:17:17   ┘
```

**It is exactly one pair, not a diffuse class.** Extracting every deck-name literal passed to `createDeck` across `tests/`: `Gate deck <S>` is the **only** stem used by two files. All ~30 others are unique.

**This is the flake C10X-51 saw twice and could not attribute.** That change's §8 entry records a red in `tests/study/study.test.ts` reading `expected "/decks", received /decks?error=Talia o tej nazwie już istnieje&open=create`, notes the seed was not captured, and leaves the cause unattributed. It is this defect.

#### Defect B — CI run #66: a generic create failure on an empty database

**`gh run list` reports run #66 as `success`. It is `run_attempt: 2`.** Attempt 1 failed and was re-run, which overwrites the visible conclusion. Verbatim from attempt 1's log (run id `31030491078`, head `5f3c87e`, 2026-08-05):

```
Running tests with seed "1785951361767"
FAIL tests/validation/decks.test.ts > POST /api/decks/[publicId] enforces the same rules on rename
AssertionError: expected '/decks?error=Nie%20uda%C5%82o%20si%C4…' to be '/decks'
Received: "/decks?error=Nie%20uda%C5%82o%20si%C4%99%20utworzy%C4%87%20talii&open=create"
 ❯ createDeck tests/validation/decks.test.ts:175:44
 ❯ tests/validation/decks.test.ts:374:20
Test Files  1 failed | 30 passed (31)
      Tests  361 passed | 6 skipped (367)
```

Five facts, none of which was on record:

1. **No test failed.** It is a `beforeAll` (suite) failure; the "6 skipped" are the six `it()`s of the rename describe.
2. The message is `DECK_CREATE_FAILED_MESSAGE` — the **generic** one, not the duplicate-name one.
3. `createDeck` succeeded ≥3 times in the same file, same worker, within the same ~500 ms immediately before failing once. A single-request transient.
4. **Accumulation is refuted structurally**: CI ran `npx supabase start` on a clean runner ~2 minutes earlier. `deck` had zero rows.
5. `npm run db:kong` ran and **succeeded** in that attempt, reporting `pool_size = 0` — and it had **recreated the Kong container at 17:35:46–57, with the suite starting at 17:36:02**, about five seconds later.

**The keep-alive hypothesis is argued against on three independent grounds:** the pool was 0 and the container six seconds old, so no socket existed to go stale; the endpoint's Supabase calls _do_ traverse the wrapped `globalThis.fetch`, so a genuine keep-alive 502 would have been replayed (verified through `supabase-js` → `postgrest-js` → `retry-transport.ts`); and had a replay landed on an already-committed insert, the message would have been `DECK_NAME_TAKEN_MESSAGE`, not the generic one.

**What the evidence favours is a third family the ticket does not name**: an unabsorbed, non-keep-alive gateway or transport failure on the single `POST /rest/v1/deck`. The retry wrapper is keyed to **one status and one body string** (`retry-policy.ts:19,28`), and does not cover a rejected `fetch` at all (`retry-transport.ts:160` awaits outside the `try`). Every GET beside it has three retry layers; the POST has one.

**Not reproduced.** This fired once in 87 CI runs and never locally on record. The other two CI failures are different classes (#72 an `npm ci` registry failure, #63 C10X-43's own deliberate typecheck probe).

**It also falsifies a claim in the archive.** `context/archive/2026-08-01-local-stack-transport-flake/research.md:360-395` argues CI is structurally immune to the transport flake and records "Runs with `attempt > 1`: 0". Run #66 is the counterexample. That entry needs a dated correction.

**Three generic-message sites are indistinguishable from outside** — `src/pages/api/decks/index.ts:47` (formData rejected), `:63` (`deckNameExists` errored), `:74` (`createDeck` errored with a non-`23505` code) all emit the same string, and the project writes no console output. No amount of log reading can narrow this further; settling it needs the marker experiment in §Open Questions.

### 5. What a cleanup must preserve

**A blanket `npx supabase db reset` would destroy evidence that archived documents cite.** All 8 non-harness decks are artifacts of recorded manual verification runs:

| Account                          | Deck                                   | Cards |
| -------------------------------- | -------------------------------------- | ----: |
| `c10x41-phase4@example.com`      | `C10X-41 Faza 4`                       |    33 |
| `c10x41-phase4@example.com`      | `C10X-37 Faza 2 po zmianie`            |     0 |
| `c10x37-p4-manual@example.com`   | 100-char name (C10X-37 P4 bound probe) |     0 |
| `test@mail.com`                  | **`E2E deck 1785947414992`**           |     0 |
| `e2e-harness@example.com`        | `Matryca 4.11`                         |     5 |
| `c10x49-phase3@example.com`      | **`C10X-49 orphan X`**                 |     0 |
| `c10x49-phase3@example.com`      | **`C10X-49 orphan X2`**                |     0 |
| `manual-c10x52-p5-…@example.com` | `C10X52 Study Probe`                   |     3 |

`test-plan.md` states of C10X-49 that "the manual run's two orphan decks are left in the local dev DB **as the artifact of record**". Both are still present. A reset destroys them and makes that sentence unverifiable. This is the decisive argument for a **narrow, pattern-scoped delete** over a reset — and the ticket's scope 1 already specifies the narrow form.

**Two corrections about the orphan deck the ticket names:**

- **`E2E deck 1785947414992` is owned by `test@mail.com`, not by the e2e account.** `e2e-harness@example.com` was created 2026-08-09, four days _after_ that deck. Anyone sweeping "the documented orphan" by account will not find it. It must be deleted by `public_id` (`3b720154-174f-4735-8cb7-74a087453817`) or by name.
- **The e2e account's own residue is not a teardown defect.** `Matryca 4.11` plus three generation sessions all land inside a five-minute window on 2026-08-13 — the date of C10X-48/49's manual browser matrix, and `Probka 4.5` / `Matryca 4.11` are manual-matrix labels. A human driving the browser as the shared e2e account writes rows through no registry, so the teardown structurally cannot see them. The C10X-46 teardown design is sound for the rows it owns.

**Other reset costs on record**: `tests/e2e/setup/auth.setup.ts:124-127` (a reset drops the e2e account; re-created automatically next run), `test-plan.md:4134-4137` and several archived impl-reviews which deliberately avoided `db reset` because it "would wipe the dev data a reviewer is likely mid-way through using". Dictionary rows (`flashcard_state`, `card_source`, `language`) are migration-seeded and survive a reset by construction; `supabase/seed.sql` does not exist, though `[db.seed]` is enabled.

**A reset does _not_ wipe the Kong keep-alive fix.** Every recorded statement of its fragility names `supabase stop` only, and mechanically the fix is a recreated Docker container plus a committed image, while `db reset` only replays migrations into Postgres. A cross-search for any line mentioning both `reset` and `kong` returns zero hits.

### 6. Hygiene ownership — options, constraints, recommendation

**Constraints that bound the option set:**

- **C-1. CI needs nothing.** `.github/workflows/ci.yml:68` starts a fresh stack on a throwaway runner every job. Accumulation is structurally local-only.
- **C-2. The suite may not hold a privileged key.** `tests/setup/env-assertions.ts:36-68` (`assertAnonKey`) rejects anything that is not `sb_publishable_` / `role:anon`, with no env opt-out, deliberately. Under RLS an in-suite sweep can therefore reach only rows the account it signed in as owns — **its own run's rows**. Prior runs' debt is unreachable.
- **C-3. `auth.users` is unreachable from the suite entirely.** Deleting a user needs the admin API and a service-role key, which C-2 forbids. An in-suite teardown cannot stop the 2-users-per-run counter — the one class that grows even on runs creating no decks.
- **C-4. The existing contract is "never inherits", not "actively removes".** `tests/fixtures/accounts.ts:82-83`: "a run never inherits rows a previous run left behind … `npm test` must not need a db:reset". Per-run accounts already deliver isolation; cleanup buys falsifiability, not isolation.
- **C-5. There are three unoccupied hooks** — before provisioning, after provisioning, and a returned end-of-run globalSetup teardown. Only the last is safe under `sequence.shuffle` + `pool: "forks"`.
- **C-6. The project has an established shape for this**: `scripts/` pure+IO pairs (`schema-drift`, `kong-keepalive`, `typecheck`), each with its pure half tested in `tests/lib/`, runners with `eslint-disable no-console`, zero runtime dependencies, and a fail-closed contract.

| Option                                              | What it buys                                                                                                                                                                         | What it costs / breaks                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **A. One-off cleanup only**                         | Repays the debt now; zero new surface                                                                                                                                                | Debt returns at 68 decks/run; the neuter is disarmed again within weeks                                                                  |
| **B. `npm run db:clean` script, developer-invoked** | Repays and _stays_ repayable; can delete `auth.users` (runs outside the suite, via `docker exec`, like `db:kong`); local-only by construction; preserves manual artifacts by pattern | Needs someone to run it; not automatic                                                                                                   |
| **C. Automatic per-run Vitest teardown**            | Stops the marginal bleed with no human in the loop                                                                                                                                   | Cannot touch `auth.users` (C-3); cannot repay existing debt (C-2); **destroys post-mortem rows after a red run**; changes C-4's contract |
| **D. CI hygiene step**                              | —                                                                                                                                                                                    | Refuted by C-1: nothing accumulates in CI                                                                                                |

**Recommendation: A + B — the one-off cleanup now, and a `db:clean` script; explicitly not C.**

The reasoning, in the order that decides it:

1. **The harm is realised only at neuter time.** §3 establishes that everyday runs are unaffected, and that the damage is to the deliberate-breakage procedure. That procedure is always run by a human who is already at a terminal — which is exactly when a developer-invoked script is sufficient and an automatic teardown is not needed.
2. **Option C cannot do the job even in principle.** Under C-2 and C-3 it deletes only its own run's decks and leaves every user row. It would stop ~68 decks/run of bleed while leaving the 1,468-row user counter growing and the existing 14 k untouched — that is, it addresses the symptom this ticket is least harmed by.
3. **Option C has a real cost the e2e layer already pays knowingly**: rows vanish after a failed run, exactly when you want to inspect them. The e2e teardown accepts that for a two-journey layer; accepting it for a 527-test suite is a larger trade with no compensating benefit given (2).
4. **Option B fits the project's existing shape** (C-6) and is local-only by construction: operating through `docker exec` on `supabase_db_<project_id>` resolved from `config.toml` — the `disable-kong-keepalive.ts` pattern — means it _cannot_ reach a cloud project, which is a stronger safety property than a runtime host assertion.

**Sketch of B, for the plan to accept or reject:** pure half decides which emails match the harness pattern and builds the statement; IO half executes via `docker exec` and reports counts before/after, fail-closed. The delete is `delete from auth.users where email like 'harness-%'` — one statement, cascading to decks → flashcards → schedules and to generation sessions. Non-harness accounts are untouched by construction, which preserves every artifact in §5. The orphaned `E2E deck 1785947414992` is _not_ matched by that pattern and needs its own explicit one-off deletion.

**A boundary worth flagging to the plan:** cleanup makes the neuter procedure _possible_ again, but it does not make the two assertions in §3 _robust_ — the next few hundred runs disarm them again. The durable fix is to scope those two assertions so they cannot decay (or to give the two RPCs a deterministic `ORDER BY`). That is arguably a different ticket; it is named here so the decision is deliberate rather than implied.

---

## Code References

- `tests/fixtures/accounts.ts:60,82-88` — per-run account minting, `runId`, and the "must not need a db:reset" contract
- `tests/setup/accounts.ts:9-13` — provisioning in `globalSetup`; why 2 users are paid per invocation
- `tests/setup/env-assertions.ts:36-68,80-95` — `assertAnonKey` / `assertLocal`, the constraint that rules out an in-suite sweep
- `tests/study/study.test.ts:42,407,609,922-943` — file suffix; the documented vulnerable assertion; the colliding `Gate deck` literal; the canary
- `tests/review/candidates.test.ts:47,613,908` — file suffix; the **undocumented** vulnerable assertion; the other half of the colliding pair
- `tests/validation/decks.test.ts:62,164-177,374` — file suffix; the `createDeck` helper; the `beforeAll` that failed in CI #66
- `src/pages/api/decks/index.ts:43-48,61-64,69-75` — the three indistinguishable generic-message sites
- `src/lib/decks.ts:11-13,21-23,29-31` — `listDecks` ordering (what keeps it falsifiable); `deckNameExists`; `createDeck`
- `tests/setup/retry-transport.ts:160` · `tests/setup/retry-policy.ts:19,28,36-44,53-59` — what the wrapper absorbs and what it does not
- `supabase/migrations/20260724195248_srs_study_schedule.sql:139-150` — `study_due_counts`, no user predicate, no LIMIT, no ORDER BY
- `supabase/migrations/20260725150000_candidate_counts_rpc.sql:31-40` — `candidate_counts_by_deck`, same shape
- `supabase/migrations/20260724220524_srs_study_schedule_review_fixes.sql:46-68` — `study_due_cards`, bounded on both axes (**not** vulnerable)
- `supabase/migrations/20260705180246_init_core_schema.sql:48` — `deck_user_name_unique`, the constraint Defect A trips
- `supabase/config.toml:18,190` — `max_rows = 1000`; `sign_in_sign_ups = 30`
- `.github/workflows/ci.yml:68,78-85,98-100,125` — ephemeral stack; the Kong parity step and its own argument against itself
- `tests/e2e/teardown/cleanup.teardown.ts:31-35,96,105` — registry-scoped delete and the explicit refusal to repay the debt
- `scripts/kong-keepalive.ts` · `scripts/disable-kong-keepalive.ts` — the pure+IO pattern a `db:clean` script should follow

## Architecture Insights

- **Per-run account isolation and row cleanup are different problems, and this project solved only the first.** `runId`-namespaced accounts guarantee a run never _inherits_ rows, which is why the suite has never needed a reset. Nothing follows from that about rows _accumulating_, and the design never claimed it did.
- **A guard's falsifiability can decay from the outside.** The four-policy neuter was correct when written and is disarmed today by data volume alone, with no code change and nothing going red. This is the same family as `lessons.md`'s "a command that always exits 0 is not a gate" — a check that cannot fail is worse than no check, because it removes vigilance.
- **`ORDER BY` is load-bearing for falsifiability, not just for presentation.** `listDecks` survives the truncation cliff purely because it orders `created_at desc`; the two `group by` RPCs do not order and therefore hand back a hash-aggregate window in which a freshly created deck usually does not appear.
- **Retry coverage in this stack is deeply asymmetric.** A GET has three independent layers (Kong's own idempotent retry, postgrest-js's `RETRYABLE_METHODS`, and the test wrapper); a POST has exactly one, keyed to a single status and a single body string. Every transport-shaped defect in this project has surfaced on a POST, and that is why.
- **Cross-schema foreign keys are invisible to `information_schema`.** Reading FK structure that way produced a confidently wrong picture of the cascade. `pg_constraint` is authoritative.

## Historical Context (from prior changes)

- `context/archive/2026-08-08-e2e-harness-journeys/change.md:29-33` — D-01 measured the debt at 487 users / 5,459 decks and chose a stable e2e account **plus** a teardown, explicitly because per-run accounts "would make that worse, not better".
- `context/archive/2026-08-08-e2e-harness-journeys/plan.md:108-111` — mass cleanup was "offered and declined — a destructive sweep of the dev DB is outside this phase's mandate". C10X-47 is the ticket that mandate was deferred to.
- `context/archive/2026-08-01-local-stack-transport-flake/research.md:100-152,360-395` — the Kong 502's measured properties (equal 60 s timeouts; drops cluster in a burst's first 1–2 s; no `proxy_next_upstream`, so only non-idempotent methods surface) **and** the CI-immunity claim that run #66 falsifies.
- `context/foundation/test-plan.md` §6.6 Phase 4 — the four-policy neuter's false pass, with the generalisation this research confirms: "any denial asserted as 'absent from an unbounded, unordered result set' is vulnerable to the same row cap as the dev database grows."
- `context/foundation/lessons.md` — "A positive control must OWN the fixture it mutates" (C10X-32) is the nearest relative of Defect A: both are cross-`it()`/cross-file coupling invisible in declaration order.

## Related Research

- `context/archive/2026-08-01-local-stack-transport-flake/research.md` — the transport flake this ticket asks to distinguish from
- `context/archive/2026-08-08-e2e-harness-journeys/research.md` — the nine harness findings, including the orphan deck and the accumulation measurement
- `context/archive/2026-07-26-srs-study-session-test/research.md` — the audit that first found the `listDueCounts` false pass

## Open Questions

1. **Defect B is unattributed at the mechanism level.** The three generic sites in `src/pages/api/decks/index.ts` are indistinguishable from outside. Settling it needs a temporary marker at `:47`, `:63`, `:74` carrying the PostgREST `status` and `code`, then a loop in two arms differing in one variable (stock Kong pool vs `db:kong` applied), with `docker logs … | grep -c "prematurely closed"` as the independent oracle. Expected outcome is a non-reproduction — it fired once in 87 CI runs — which is itself informative. **Recommendation: its own ticket**, since the likely fix is widening the retry policy, a change to harness semantics that deserves separate review.
2. **Should Defect A be fixed inside this ticket?** It is one line (rename one of the two `Gate deck` literals), it removes a measured 3.3 % red rate, and this ticket already owns "flake attribution". The alternative — making the whole class impossible by adding entropy to each file's `suffix` — touches 11 files. My reading is: fix the literal here, and record the class in `test-plan.md` §6.5's namespacing rule so it cannot recur silently.
3. **Do the two vulnerable assertions get hardened, or only unblocked?** Cleanup restores the neuter's falsifiability; it does not stop it decaying again. Hardening (deterministic `ORDER BY` on the two RPCs, or ownership-scoped assertions) is the durable answer and is probably a separate ticket.
4. **Is the 2-users-per-invocation cost worth addressing at all?** 1,468 rows, no measured harm, and it is the only class an in-suite teardown could never fix. Probably: name it, leave it, let `db:clean` absorb it.
5. **Does `test-plan.md` need a correction for `study_due_cards`?** §2/§6.6 imply it belongs to the vulnerable class; it does not. A dated correction, not a rewrite, per this project's convention.
6. **The archive's CI-immunity claim needs a dated correction** — `local-stack-transport-flake/research.md`'s "Runs with `attempt > 1`: 0" is falsified by run #66.
