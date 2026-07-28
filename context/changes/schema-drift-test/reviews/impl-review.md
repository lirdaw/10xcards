<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: CI Gate for Database Schema Drift

- **Plan**: `context/changes/schema-drift-test/plan.md`
- **Scope**: Full plan — Phases 1–6 (Phase 5 partially landed; its automated criteria are open by construction)
- **Date**: 2026-07-28
- **Verdict**: NEEDS ATTENTION (triaged 2026-07-28 — 8 fixed, 1 accepted; **post-triage: APPROVED**)
- **Findings**: 0 critical, 4 warnings, 5 observations

> **Post-triage state.** Every finding was decided in the same sitting. F1–F3 and F5–F9 were
> fixed and re-verified; F4 was accepted, because the ship-time checklist it concerns already
> exists and the issue was follow-through rather than a defect. Suite **178 / 178, 15 files**,
> `npm run lint` exit 0, `npx prettier --check` clean, both fail-closed paths re-measured at
> exit 1. The fix record is in `../verification.md` under "Impl-review — fixes applied after
> Phase 6"; the dimension verdicts below describe the code **as reviewed**, not as it now
> stands.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## What was re-verified by execution

Run against the current files, local stack up, `OPENROUTER_API_KEY` unset:

| Check                                                 | Result                                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                        | exit **0**                                                                                                                                            |
| `npx eslint scripts/`                                 | exit **0** (`scripts/` is linted — `eslint.config.js:73` ignores only `database.types.ts`, so the `eslint-disable no-console` header is load-bearing) |
| `npm test`                                            | **177 passed / 177, 15 files**                                                                                                                        |
| `npm run build`                                       | exit **0**                                                                                                                                            |
| `npx prettier --check` on all 9 edited code/doc files | clean                                                                                                                                                 |
| Runner with both credentials unset                    | `GATE UNAVAILABLE` + the token-specific message, exit **1**                                                                                           |
| `git status` after every run                          | clean — no residue                                                                                                                                    |
| `supabase/migrations/`                                | 10 entries, no fabricated file left behind                                                                                                            |
| `gh repo view --json visibility`                      | **PUBLIC** — the fact behind F2 and F3                                                                                                                |

Contract-level audit (independent, every file read on disk): **all six Phase 6 touch points
present; every Phase 2/3/4/5 contract clause met; no DRIFT, no MISSING.** Both "EXTRA"s are
justified and documented — the DDL workflow's `Require the database password` guard (which is
what makes the plan's own "required rather than optional" true), and the comparator folding
`unparseable` into `clean`.

"What We're NOT Doing" holds on all seven prohibitions, verified by `grep`: no `db push` in
any `run:` block (comments only), no PR gating, no `supabase/setup-cli`, no hand-rolled
differ, `.gitignore`/`.gitattributes` absent from the diff, no `schedule:`/`cron`, and no
`workflow_run`/`workflow_call` coupling — so a red DDL diff has no mechanism by which to
block a release.

**Fail-closed contract verified, not assumed.** `process.exitCode` (not `process.exit()`) lets
the report flush; every throw site is `GateUnavailable`, caught at `:215`, with a catch-all
`else` at `:218`, so no async rejection can escape to a default-0 exit. The only path
returning 0 is `verdict.clean`. **No credential reaches any message**: the token lives in the
`Authorization` header only, the ref is `encodeURIComponent`-escaped into a constant origin
(so the URL-echoing `TypeError` variant is unreachable), and `String(err)` on a real fetch
failure was measured as exactly `TypeError: fetch failed`.

## Notable strengths (recorded, not findings)

- The plan-review's CRITICAL F1 — "nothing ever observes `deploy` being blocked" — was not
  merely addressed but **strengthened**. The implementation recognised that the single run
  the plan asked for would have been _unfalsifiable_ (`deploy` carries its own branch guard,
  so it skips on a feature branch whatever `drift` does) and ran it as a **pair** with a
  positive control, widening `deploy`'s guard alongside `drift`'s so the two runs differ in
  exactly one variable. Conclusions read from `gh run view --json jobs`, not the UI.
- **Two plan predictions were wrong and are recorded as observed rather than rounded**: the
  `missingLocal` neuter turns 2 of 11 red (not 1), and criterion 4.4 **as worded does not go
  red** because `db:types` overwrites the working tree before `git diff` runs.
- Every revert was **verified, not assumed** — `md5sum` against a pristine copy, the
  rehearsal commits dropped from the branch, a tree-wide `grep` for the marker.
- Risk #5 is documented **per drift class rather than as one range**, because "classes 4–9
  are uncovered" would have been false for four of them.

## Findings

### F1 — Two migration files sharing one version read as CLEAN — a false green

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/schema-drift.ts:80,94`
- **Detail**: `localVersions` is a `Set`, so a duplicated timestamp collapses silently.
  Measured against the real module:

  ```
  local: ["20260705180246_a.sql","20260705180246_b.sql"], remote: ["20260705180246"]
  → {"clean":true,"missingRemote":[],"missingLocal":[],"unparseable":[]}
  ```

  `schema_migrations.version` is the key on the cloud side, so a duplicated timestamp means
  **at most one of the two files can ever be recorded as applied** — the other is committed
  and never applied, which is drift class 1, the exact class this gate exists to catch. The
  gate reports OK.

  This is the **one input where the set-based design loses information it needs**. Set-based
  comparison is correct and load-bearing for the out-of-order pair, so the fix is additive,
  not a redesign. Reachability is low but real: `supabase migration new` stamps to the second,
  and this repo already carries a pair 10 seconds apart. Note this blind spot is **not** in
  §6.6's "what this does NOT prove" list, in a change whose whole discipline is enumerating
  its blind spots — so today it is an _undocumented_ false green.

- **Fix**: Add `duplicate: string[]` to `DriftVerdict`, populated when `localVersions.has(version)`
  before the `add`, folded into `clean`, with its own section in `reportDrift` whose remedy is
  "rename one file — `db push` cannot fix this". ~4 lines plus one `it()`.
- **Decision**: FIXED — `duplicate: string[]` added and folded into `clean`, recorded before the
  `Set.add` that swallowed it, with its own report section. Twelfth fixture added. Verified both
  ways: the collision now reads `clean:false` with empty set differences (so it is not
  misreported as a missing migration), and the out-of-order pair still reads clean — the fix is
  additive. `tests/lib/schema-drift.test.ts` 11 → **12 passed**.

### F2 — The production DB password sits in the environment of `npm ci`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/schema-diff.yml:30-33`, `:45`
- **Detail**: All three secrets are declared at **job level**, so `SUPABASE_DB_PASSWORD` is
  readable in `process.env` by every install lifecycle script in the whole dependency tree
  when `- run: npm ci` executes — and by `actions/checkout` and `actions/setup-node`. The
  repository is **PUBLIC** (verified). One compromised transitive package exfiltrates the
  production database password.

  The contrast shows the author understood the pattern: `ci.yml`'s `drift` job also uses
  job-level `env` but deliberately runs **no `npm ci`** and only first-party steps — that
  design is fine and should be kept as-is.

  Exposure today is **zero**, because the secret is not set and the workflow has never run
  past `npm ci`. That makes this cheap to fix now and important to fix _before_ the ship-time
  `gh secret set SUPABASE_DB_PASSWORD`.

- **Fix**: Move the three variables from job-level `env:` to step-level `env:` on the three
  steps that need them (`Require the database password`, `Link the cloud project`, `Diff the
deployed schema`) — all of which run after `npm ci`.
- **Decision**: FIXED — job-level `env:` removed; all three secrets moved to step level. Verified by parsing the YAML rather than by eye: `job-level env: null`, `npm ci` carries no secret, the three credential steps carry all three, and the trigger set is still `["workflow_dispatch"]`, so criterion 5.2 is intact.

### F3 — `cat diff.sql` publishes the production DDL delta to a world-readable log

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/schema-diff.yml:85`
- **Detail**: The repository is public, so Actions logs are readable by anyone. `db diff
--schema public` output is by definition the DDL that exists in production and **not** in
  the public `supabase/migrations/` — hand-made Studio changes, RLS policy predicates,
  function bodies. That is strictly higher-value than the migrations already public in the
  repo, because it is precisely the part nobody reviewed.

  The tradeoff is genuine: the `cat` is what makes a red run diagnosable at a glance, and the
  whole workflow is a diagnostic. Note that artifacts on a public repo are also publicly
  downloadable, so uploading is a partial mitigation, not a fix.

- **Fix A ⭐ Recommended**: Keep `[ -s diff.sql ]` and `exit 1`, but replace the unconditional
  `cat` with `wc -l diff.sql` plus `actions/upload-artifact`.
  - Strength: Keeps the red/green signal and the object count; removes the unreviewed DDL from
    the always-public log body.
  - Tradeoff: One extra click to triage; artifacts on a public repo are still downloadable.
  - Confidence: MEDIUM — reduces exposure, does not eliminate it on a public repo.
  - Blind spot: Whether the retention default is acceptable here has not been checked.
- **Fix B**: Leave the `cat` and state the exposure explicitly in the workflow header.
  - Strength: Preserves diagnosability; makes the choice deliberate rather than incidental.
  - Tradeoff: Accepts publishing unreviewed production DDL to a public log.
  - Confidence: HIGH — trivially correct, it is purely a documentation act.
  - Blind spot: Nobody has audited what is currently in the prod-vs-migrations delta, so the
    size of what would be published is unknown.
- **Decision**: FIXED via Fix A — the `cat` is replaced by a line count plus `actions/upload-artifact@v7` (`if: failure()`, 7-day retention). The `@v7` was checked against the API, not assumed: `upload-artifact`'s latest is `v7.0.1`, so a reflexive `@v4` would have been three majors stale. The residual exposure (artifacts on a public repo are downloadable) is stated in the workflow header rather than glossed.

### F4 — Phase 5 ships a workflow that has never been executed end-to-end

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `plan.md` Progress 5.1–5.4; `.github/workflows/schema-diff.yml`
- **Detail**: `change.md` reads `implemented` and the workflow is committed, but 5.1, 5.2
  (third clause), 5.3 and 5.4 are all `- [ ]`, and `SUPABASE_DB_PASSWORD` is unset. The
  `db diff --linked` path — link, Docker, shadow replay, password — is entirely unexercised
  and has no calibration baseline.

  This is **correctly disclosed, not hidden**: `verification.md` _measures_ rather than infers
  the cause (`gh workflow run … --ref tmp-… → HTTP 404: workflow schema-diff.yml not found on
the default branch`), states there is no honest workaround, and carries a ship-time
  checklist with an explicit loop-back ritual. The finding is about **follow-through**: the
  risk is that the merge happens and the checklist is never returned to, leaving §5's row
  implying a working capability.

- **Fix**: Treat the `verification.md` ship-time checklist as a release blocker for
  `/10x-archive` — fix F2 first, then set the secret, then complete 3.9 and 5.1–5.5 and flip
  the matching Progress rows with the commit SHA.
- **Decision**: ACCEPTED — the ship-time checklist in `verification.md` already carries the mechanism and the loop-back ritual; the concern was follow-through, not a defect. Note F2 is now fixed, so the checklist's `gh secret set SUPABASE_DB_PASSWORD` no longer hands the password to `npm ci`.

### F5 — No explicit timeout bounds the gate's only network call

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/check-schema-drift.ts:73-75`; `.github/workflows/ci.yml:73-91`
- **Detail**: No `signal` on either `fetch`, and no `timeout-minutes` on the `drift` job. The
  hang is not unbounded — undici's default `headersTimeout`/`bodyTimeout` (300 s each) fire,
  so worst case is ~5 min, or ~10 min if the retry path is taken — and it fails closed
  correctly via the existing try/catch. But that bound is an **undici implementation default,
  not a decision by this repository**, on a job whose stated design goal is "roughly ten
  seconds on the path between merge and deploy". `response.json()` is covered by no bound of
  the script's own.
- **Fix**: `signal: AbortSignal.timeout(15_000)` on both calls; the existing `catch` already
  routes it to `GATE UNAVAILABLE` + exit 1. A `timeout-minutes` on the job is the belt-and-braces
  alternative.
- **Decision**: FIXED — `AbortSignal.timeout(15_000)` on the request, as a named constant with the reasoning attached. The failure direction was already right; the number now belongs to this repository instead of to undici.

### F6 — The remote side is trusted where the local side is strictly validated

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/check-schema-drift.ts:88-99`, `:61`; `scripts/schema-drift.ts:87`
- **Detail**: Three related asymmetries, all measured:
  - **Untrimmed/unvalidated remote versions.** `"20260705180246 "` yields
    `missingRemote:["20260705180246"]` **and** `missingLocal:["20260705180246 "]` — two
    visually identical strings sending the reader to `db push` _and_ the `migration repair`
    runbook at once. `""` prints a blank bullet. Fail-closed in direction, worst-possible in
    report. The local side is deliberately strict (`/^\d{14}$/`, with a good comment); the
    remote side is not.
  - **`.endsWith(".sql")` is case-sensitive.** `20260705180246_a.SQL` with an empty remote →
    `{"clean":true}` — neither compared nor reported, though on a Linux runner it is a real
    file a human would call a migration.
  - **`readdirSync` without `withFileTypes`**, so a directory named `<14 digits>_x.sql` counts
    as a migration and any subdirectory inflates the printed `local.length`.
- **Fix**: `.trim()` each remote version and reject one failing `/^\d{14}$/` as
  `GateUnavailable`; lowercase the extension test so `.SQL` lands in `unparseable`; add
  `withFileTypes: true` + `isFile()`.
- **Decision**: FIXED — all three: remote versions are trimmed and held to `/^\d{14}$/` (else `GATE UNAVAILABLE`), the `.sql` test is case-insensitive so `_x.SQL` lands in `unparseable`, and `readdirSync` uses `withFileTypes` + `isFile()`. Re-measured: `_x.SQL` now reports rather than being skipped.

### F7 — AGENTS.md records the new command but not the `scripts/` carve-out

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `AGENTS.md:24`; `scripts/check-schema-drift.ts:181-182`; `tests/lib/schema-drift.test.ts:5`
- **Detail**: The change introduces two standing exceptions to AGENTS.md's Hard Rules, both
  legitimate and both undocumented there. `check-schema-drift.ts` reads `process.env` rather
  than `astro:env/server` (which is a Vite virtual module that does not exist under bare
  `node --experimental-strip-types`), and the test carries the only deep-relative import in
  `tests/` (because `@/*` maps to `src/*` only). Each is explained _at its own call site_, but
  a future agent reading Hard Rules top-down sees two apparent violations with no sanction —
  which is exactly what that file exists to prevent.
- **Fix**: One line under Hard Rules: `scripts/` runs under bare Node — no Vite, no `@/*`, no
  `astro:env` — so it reads `process.env` and imports siblings relatively; the exception is
  `scripts/` only.
- **Decision**: FIXED — one Hard-Rules line in `AGENTS.md` recording the `scripts/` carve-out (bare Node, so `process.env` and relative sibling imports), with an explicit "do not extend this to `src/`".

### F8 — `supabase link` is framed as part of a read-only job

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/schema-diff.yml:8-13`, `:50-52`, `:64`
- **Detail**: The header and guard comment both frame the whole job as read-only against
  production. `db diff --linked` genuinely is (shadow replay is local Docker; migra
  introspects prod read-only), but `supabase link` reportedly bootstraps the
  `supabase_migrations` schema/table on the remote when absent. Effect here is nil — the table
  demonstrably exists, the `drift` job reads 10 rows from it — but the framing is slightly
  stronger than the truth, which matters in a change this careful about stated boundaries.

  **Flagged as unverified**: this could not be confirmed against the pinned CLI (the npm
  package is a binary downloader). Treat as "verify, then document", not as a defect.

- **Fix**: Confirm against CLI 2.98.2, then adjust the header comment to say what `link` does.
- **Decision**: FIXED — the workflow header now says `link` _may_ induce a bootstrap write and flags it as **unconfirmed against the pinned CLI**, with the check to run. Deliberately not asserted as fact.

### F9 — Two small consistency nits

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `context/foundation/lessons.md:187`; `tests/lib/schema-drift.test.ts:5`
- **Detail**: (a) `lessons.md` calls itself an "append-only register", but the new entry was
  inserted at `:187`, **before** the last existing entry (the C10X-27 middleware lesson at
  `:194`) rather than appended — trivial, except that this project's docs lean hard on
  chronological reading order. (b) The runner imports `"./schema-drift.ts"` **with** the
  extension (mandatory under type stripping) while the test imports
  `"../../scripts/schema-drift"` **without** it (Vite resolves either), so the two files model
  opposite conventions for the same import with no note explaining the difference.

  Not carried, having been checked and found wrong: the test's `test-plan.md §6.1` pointer is
  **correct** — the mirroring clarification is at `test-plan.md:311-317`, inside §6.1.

- **Fix**: Move the lessons entry to the end of the file; add the `.ts` extension in the test
  import (Vitest resolves it unchanged).
- **Decision**: FIXED — the lessons entry moved to the end of the file (which calls itself append-only), and the test import gained the `.ts` extension so it reads the same way as the runner's.
