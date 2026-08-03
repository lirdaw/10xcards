---
date: 2026-07-27T00:00:00+02:00
researcher: lirdaw
git_commit: fed0bdfb93ed6635cce554a36723053e25744f74
branch: main
repository: lirdaw/10xcards
topic: "CI gate for database schema drift vs migration history (Risk #5, test-plan Phase 3)"
tags: [research, codebase, ci, supabase, migrations, schema-drift, C10X-29]
status: complete
last_updated: 2026-07-27
last_updated_by: lirdaw
last_updated_note: "Credential constraint resolved with the user; recommendation switched from db push --dry-run to the password-free Management API oracle"
---

# Research: CI gate for database schema drift vs migration history

**Date**: 2026-07-27
**Researcher**: lirdaw
**Git Commit**: `fed0bdf`
**Branch**: `main`
**Repository**: `lirdaw/10xcards` (**PUBLIC** — this matters, see §6)

## Research Question

Design input for C10X-29 / `schema-drift-test`: what is the cheapest reliable CI gate
that stops the pipeline **before the app deploys** whenever the deployed database schema
has drifted from the migration history? Scope agreed with the user: **the CI gate plus the
whole migration path** (what the gate replaces and what it only polices), and a
**comparison of oracle candidates with a recommendation**.

## Summary

Six findings decide the shape of this change. Four of them are things no document in the
repo currently states.

1. **The deploy pipeline has no migration step of any kind.** `.github/workflows/ci.yml`
   deploys the Worker on every push to `main` (`ci.yml:48-67`) and never touches the cloud
   database. "Prod is migrated" exists **only** as a step in a human runbook
   (`.claude/skills/ship/SKILL.md`). Risk #5 is therefore not a hypothetical — it is the
   literal current design.

2. **The gate is blocked on credentials that do not exist, on a public repo.** Verified by
   running `gh secret list`: the repository has exactly **two** secrets,
   `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. There is no
   `SUPABASE_ACCESS_TOKEN`, no project ref, no DB password — and the cloud project ref is
   not in any tracked file (it lives in gitignored `supabase/.temp/`). The repo is
   **PUBLIC**. Adding Supabase cloud credentials to it is a decision for the user, not an
   implementation detail.

3. **Incidental defect, unrelated but adjacent:** `ci.yml:26-27` injects
   `secrets.SUPABASE_URL` / `secrets.SUPABASE_KEY` into the build — **neither secret
   exists**. It is harmless only because `astro.config.mjs:19-22` marks every env field
   `optional: true`, so the build receives empty strings. `README.md:167` instructs the
   reader to configure them. Whoever opens `ci.yml` for this change should fix or document
   that.

4. **Exit codes are the whole ballgame, and two of the three candidates always exit 0.**
   Verified against the **v2.98.2 CLI source** (the version `package-lock.json` actually
   pins), not just docs: `supabase migration list` renders a table and returns nil — a
   mismatch is a *blank cell*, there is no `--output json`, and the table is piped through
   glamour ASCII rendering. `supabase db diff` likewise always exits 0. Only
   `supabase db push --dry-run` returns a real non-zero exit, and it does so on exactly the
   failure this project actually suffered.

5. **No single cheap oracle covers everything, and the two halves are complementary in a
   non-obvious way.** A *history* oracle (filenames vs the remote
   `supabase_migrations.schema_migrations` table) catches "migration never pushed" and
   "history has a gap". A *DDL* oracle (migra against a shadow DB) catches "someone changed
   prod by hand" and is the only thing that sees a migration file edited after it was
   applied — but it is **blind to a history desync over an identical schema**, which is
   precisely the M2L5 incident. Neither is a superset of the other.

6. **A drift class exists that this repo's own runbook makes reachable and that no history
   oracle can ever see: a migration file edited in place after `db push` ran.** Two
   migrations were genuinely edited in place after their first version existed
   (`20260705180246`, `20260712162359`). **Correction to an intermediate finding:** both
   edits reached `main` in the *same merge* as the file itself (verified with
   `git merge-base --is-ancestor`), so `main` never carried the pre-edit text and there is
   **no evidence prod is affected**. But `/ship` runs `db push` from the feature branch
   *before* the merge (`SKILL.md:86-91`), so the window is real by construction, not by
   accident.

**Recommendation: `supabase db push --dry-run` as a separate job that `deploy` depends on**,
gated to pushes on `main`. It is the only candidate with real exit-code semantics, it is
provably non-mutating at the source level, it needs no Docker, and it encodes the
acceptance criterion literally ("would a `db push` have anything to do?"). Its boundary —
it cannot see hand-edits — must be written into `test-plan.md` rather than letting Risk #5
read as fully closed.

## Detailed Findings

### 1. The pipeline today: what deploys, and what does not migrate

`.github/workflows/ci.yml` has two jobs and one gate between them.

| Job | Trigger / guard | Steps | file:line |
| --- | --- | --- | --- |
| `ci` | push + PR on `main`, `paths-ignore: ["**/*.md", "context/**"]` | `checkout` → `setup-node` → `npm ci` → `astro sync` → `lint` → `build` → `supabase start` (**local** stack) → export local creds → `npm test` | `ci.yml:12-46` |
| `deploy` | `needs: ci`, `if: push && ref == refs/heads/main` | `checkout` → `setup-node` → `npm ci` → `astro sync` → `build` → `cloudflare/wrangler-action@v4 command: deploy` | `ci.yml:48-67` |

- **The only existing gate is `needs: ci` (`ci.yml:49`).** Extending it to
  `needs: [ci, drift]` is a one-line change; the `deploy` job consumes no artefact from
  `ci` (it re-checks-out and re-builds), so an extra upstream job costs only its own wall
  clock.
- The two jobs share nothing. Measured from the last real run (merge of PR #14): `ci`
  2m57s of which `npx supabase start` alone is 1m46s; `deploy` 47s of which 37s is
  duplicated setup and 8s is the actual deploy.
- `paths-ignore` (`ci.yml:6`, `:9`) means a docs-only push runs **neither** job — so it
  also never deploys, which is consistent. A push touching only
  `supabase/migrations/*.sql` **does** trigger both.
- **No workflow, npm script, or hook anywhere runs a cloud-facing supabase command.**
  `package.json:15-18` has only `db:start`, `db:stop`, `db:reset`, `db:types --local`.
  `ci.yml:33` and `ci.yml:40` are the local stack. `.husky/pre-commit` is
  `npx lint-staged`. `db push` / `link` / `migration list` appear **only in prose**:
  `lessons.md:44`, `lessons.md:113` and the human runbook `SKILL.md`.

### 2. The manual migration path the gate must police (and must not break)

`.claude/skills/ship/SKILL.md` is the entire procedure. It is human-driven end to end.

- **Detection today is a `git diff`, not a database query** (`SKILL.md:61-64`): "pending
  migrations: does `git diff --name-only origin/main..HEAD` include a new file under
  `supabase/migrations/`? If yes → a prod `db push` is required". Nothing ever asks the
  cloud database what it actually has.
- **Ordering rule** (`SKILL.md:86-91`): "if there is a migration, `supabase db push` comes
  BEFORE whatever step triggers the deploy (`gh pr merge`, or `git push origin main`).
  Reason: when CI deploys the code, prod must already have the new columns or the first
  insert fails."
- **Risk tiers** (`SKILL.md:39-44`): `supabase db push` is **PROD-MUTATING**, "the skill
  defaults to the human running these and NEVER runs one unless the user, at that step,
  explicitly assigns it to the agent".
- Feature-branch runbook (`SKILL.md:93-99`): `git push` → `gh pr create` → **`db push`** →
  `gh pr merge`. Worktree variant (`:112-120`): every command from inside the worktree.
- Prod sanity is a human `select` in Studio plus a real feature run
  (`SKILL.md:148-156`; `lessons.md:117-122`).

**The gate's relationship to this runbook is "enforce, do not replace".** It must only
*detect*; a CI job that applied migrations would break the PROD-tier contract at
`SKILL.md:39-44` outright.

### 3. The incident behind Risk #5 (M2L5), and what it teaches about oracles

Recorded in exactly one place — `lessons.md:110-115` — plus a one-line citation at
`test-plan.md:104`. **Neither M2L5 change folder contains a `verification.md`**; there is
no incident write-up anywhere.

Sequence:
1. Two slices ran in parallel git worktrees, each carrying migrations.
2. `supabase link` / `db push` were run **from the parent folder, not the worktree** → the
   CLI saw a partial migration set and threw `"Remote migration versions not found"`.
3. The CLI's suggested fix was run blindly: `migration repair --status reverted <base>` →
   **two baseline migrations marked reverted on PROD** = history desync. Schema and data
   untouched — `repair` only writes `schema_migrations`.
4. Repair: `repair --status applied <same IDs>` → `migration list` → `db push`.
5. Separate hazard from the same episode: a migration whose timestamp predates the last
   remote one needs `db push --include-all`.

**The out-of-order pair is real and still in the tree** (verified independently here):

| Migration (version) | First landed on `main` (first-parent) |
| --- | --- |
| `20260712162349_generation_session` (**earlier** version) | 2026-07-13 **21:22:23** (`d28e1de`) |
| `20260712162359_deck_keyword_search` (**later** version, +10 s) | 2026-07-13 **19:47:47** (`c33d9cb`) |

The earlier-versioned migration reached `main` about 1.5 h **after** the later-versioned
one. They are additive and independent, so lexicographic replay is still correct — but any
oracle must tolerate this shape.

**Why this incident, specifically, argues for a history oracle:** a `repair` desync leaves
the *schema* identical and the *history* wrong. A DDL diff sees nothing. Only a history
comparison sees it.

### 4. What "the schema" is here, and the drift classes this project is actually exposed to

Ten migrations, `supabase/migrations/`. The split that matters for drift:

- **Replaceable objects** (`create or replace function` / `create or replace trigger`) —
  `20260712162359` (`f_unaccent`, `search_flashcards_in_deck`), `20260725112700` (trigger),
  `20260725150000` (`candidate_counts_by_deck`), and the RPC halves of `20260724195248` /
  `20260724220524`. These can be re-run or hand-patched on any database with **no history
  entry and no error** — silent drift.
- **Non-replaceable objects** (`create table` / `create index` / `create policy` / CHECK
  swaps) — `20260705180246`, `20260710195327`, `20260712162349`, `20260725112600` (a
  `drop function` + recreate, which also destroys and re-issues the ACL), `20260725133600`
  (partial unique index). These fail loudly on replay, so their drift shows up as a failed
  push rather than as silent divergence.

**Migrations edited in place after their version existed — with a correction.** Two files
gained real DDL in a later commit:

| File | Later commit | Added |
| --- | --- | --- |
| `20260712162359_deck_keyword_search.sql` | `d917de0` | `revoke all on function public.f_unaccent(text) from public, anon;` |
| `20260705180246_init_core_schema.sql` | `2b8abc7` | 68 lines: RLS enable, grants, 9 policies |

**Both edits landed on `main` in the same merge as the file itself** — verified with
`git merge-base --is-ancestor d917de0 c33d9cb` → YES, and the same for `2b8abc7`. So `main`
never carried the pre-edit text, and there is **no evidence the cloud database is
affected**. The mechanism is nonetheless reachable: `/ship` runs `db push` from the feature
branch *before* the merge, so a multi-phase slice that pushed at p1 and amended the
migration at p2 would leave prod holding the old text while every history oracle reports
green. Record it as a live class with no observed instance, not as a known defect.

**Other surfaces neither oracle covers.** `supabase/snippets/` is gitignored
(`.gitignore:123`) and is the institutionalised channel for hand-run SQL (its one file is a
read-only probe). `supabase/config.toml` has **exactly one commit ever** (`c7fd1a8`, the
bootstrap) and describes only the local stack: `max_rows = 1000` (`:18`) is
behaviourally load-bearing and is dashboard config in the cloud; `enable_confirmations`
(`:209`), `jwt_expiry` (`:158`), `site_url` (`:154`) are all local-only values whose cloud
equivalents live in the dashboard. `src/db/database.types.ts` is generated by hand from the
**local** stack (`package.json:18`), is excluded from lint (`eslint.config.js:73`), and
there is **no typecheck gate at all** in this repo. `supabase/seed.sql` referenced at
`config.toml:65` **does not exist**.

> **Dated correction, 2026-08-03 (C10X-43 `typecheck-gate`).** "There is **no typecheck gate at
> all** in this repo" was true on 2026-07-27 and is not now: `npm run typecheck` runs in the `ci`
> job, fail-closed, between `astro sync` and `lint`. Not rewritten. Two things about the sentence
> around it are unchanged and worth keeping straight, because the gate does not touch either:
> `src/db/database.types.ts` is still excluded from lint, and it is still guarded by the `ci` job's
> regenerate-and-diff step rather than by any type check — a stale generated file compiles
> perfectly.

**Consolidated drift-class table** (this is the core scoping artefact):

| # | Drift class | Evidenced here? | History oracle (`db push --dry-run` / `migration list`) | DDL oracle (`db diff --linked`) |
| --- | --- | --- | --- | --- |
| 1 | Merge deploys the Worker, nobody runs `db push` | **The current design** (`ci.yml:48-67`); `lessons.md:40-44` | **Yes** | Yes |
| 2 | History desynced by `migration repair` | **Yes, on prod** (`lessons.md:113`) | **Yes — only this** | **No** (schema identical) |
| 3 | Out-of-order version skipped by `db push` | **Yes** (`d28e1de` / `c33d9cb`) | **Yes** | Yes |
| 4 | Migration file edited in place after being pushed | Mechanism reachable; **no observed prod instance** (§4) | **No** — versions match, contents never compared | **Yes** |
| 5 | Prod changed by hand in Studio | Channel exists (`supabase/snippets/`, gitignored) | No | **Yes — only this** |
| 6 | `repair --status applied` on something never applied | Not observed | **No** — the list lies by construction | **Yes** |
| 7 | Config drift (`config.toml` vs dashboard) | `config.toml` untouched since bootstrap | No | No — needs `supabase config push` |
| 8 | Stale `src/db/database.types.ts` | Discipline has held; no gate | No | No — needs `db:types` + `git diff --exit-code` |
| 9 | Seed/dictionary row drift (`flashcard_state` 1/2/3) | App hardcodes the literals | No | No — migra diffs schema, not rows |

Classes 1–3 are the ones this project has actually lived through. A history oracle covers
all three. Classes 4–6 need the DDL oracle; 7–9 need separate, cheaper checks and are out
of the agreed scope.

**No orphan objects.** Every RPC called from `src/` is created by a migration
(`candidate_counts_by_deck`, `search_flashcards_in_deck`, `study_due_cards`,
`study_due_counts`), and every `.from()` table likewise.

### 5. Oracle comparison — verified against the pinned CLI source (v2.98.2)

The claims below were checked against the `supabase/cli` Go source **at the version
`package-lock.json` pins**, not only against the docs. That distinction earned its keep:
two of the three candidates behave nothing like a gate would assume.

#### `supabase migration list --linked` — **always exits 0**

`internal/migration/list/list.go` loads remote versions, loads local versions, builds a
table, and returns `RenderTable(...)`. There is no comparison error path; a mismatch is a
**blank cell**. The only non-zero exits are connection failures. Worse: `RenderTable` pipes
markdown through **glamour** ASCII rendering (`internal/utils/output.go:109`), and
`cmd/migration.go:110-116` registers no `--output json`. A gate would have to regex
ASCII art. **Rejected on brittleness.**

#### `supabase db push --dry-run` — **exits 1 on a desync, and is provably non-mutating**

`pkg/migration/apply.go` defines exactly the two errors this project has already seen:

- remote versions absent locally → `ErrMissingLocal` — *"Remote migration versions not
  found in local migrations directory."* → **exit 1**. This is verbatim the M2L5 error
  string.
- local migrations ordered before the last remote one → `ErrMissingRemote` → **exit 1**
  (unless `--include-all`).
- otherwise → **exit 0**, printing to **stderr** `Would push these migrations:` + the list,
  or to **stdout** `Remote database is up to date.`

Exit plumbing: `cmd/root.go` `Execute()` → `recoverAndExit()` → `os.Exit(1)`.

**Non-mutating, proven structurally**: the `if dryRun {…} else {…}` split puts the prompt,
`ApplyMigrations` and the migrations-catalog cache write all in the *else* branch.

The one gap: the ordinary "migration committed but never pushed" case exits **0** with a
message. That needs one `grep` — and the correct form is to assert the **positive** string
(`Remote database is up to date.`), so a changed upstream message fails **closed**.

#### `supabase db diff --linked` — always exits 0, and needs Docker

`internal/db/diff/pgadmin.go:20` prints `No schema changes found` to **stderr** and returns
`nil` regardless. The gate condition must be **"stdout is empty"**.

More costly: `DiffDatabase` unconditionally calls `CreateShadowDatabase` → `DockerStart`,
replays all ten migrations into it, then runs migra in a second container. The newer
`--from migrations --to linked` form falls back to the same shadow DB unless a cached
catalog exists under `supabase/.temp/pgdelta/` — and **`supabase/.temp` is gitignored
here**, so CI never has that cache. There is no Docker-free path. `--use-pg-schema` prints
its own `WARNING: … experimental and may not include all entities, such as views and
grants` (`cmd/db.go:116`) — disqualifying for a gate over an RLS-dependent schema.

#### `supabase db pull` — **disqualified: mutates production**

`internal/db/pull/pull.go` prompts *"Update remote migration history table?"* with default
**true**, then calls `repair.UpdateMigrationTable(...)`. `PromptYesNo` documents that *"any
error will be handled as default value"*, and `--yes` short-circuits to true. It also
writes migration files into the working tree. Never put this in a gate.

#### `supabase db lint` — not a drift oracle

Runs `plpgsql_check` over function bodies. `--fail-on` does give a non-zero exit, but it
never compares history to schema.

#### Password-free alternative: Management API read-only query

```
POST https://api.supabase.com/v1/projects/{ref}/database/query/read-only
Authorization: Bearer $SUPABASE_ACCESS_TOKEN
{"query":"select version from supabase_migrations.schema_migrations order by version"}
```

Per the live OpenAPI spec: `operationId: v1-read-only-query`, *"[Beta] Run a sql query as
supabase_read_only_user"*. No Docker, no `link`, no IPv6 problem, no DB password, and exit
codes entirely under your own script's control. **Caveats:** marked **[Beta]**, defines a
`429`, and the comparison logic is hand-rolled with no upstream test behind it. The cleaner
`GET /v1/projects/{ref}/database/migrations` is documented as *"Only available to selected
partner OAuth apps"* — a plain personal access token will very likely 403 (**unverified —
not called**).

#### Comparison

| Oracle | Compares | Classes 1/2/3 | Classes 4/5/6 | Exit code on drift | Requires | Mutates prod? | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `migration list --linked` | history | ✅ | ❌ | **0 always** — parse ASCII art, no JSON | link, token, DB conn | No | ~5 s |
| **`db push --dry-run`** | history | ✅ | ❌ | **1** for desync/out-of-order; **0** + message for unpushed | link, token, DB conn | **No** (proven) | ~10 s |
| `db diff --linked -s public` | real DDL | 1,3 only | ✅ | **0 always** — gate on empty stdout | **Docker** + shadow replay + link | No | minutes |
| `db pull` | both | ✅ | ✅ | mixed | Docker + conn | **YES** | minutes |
| MgmtAPI read-only query | history | ✅ | ❌ | **your script's** | token + ref only | No | ~2 s |

### 6. The blocker: credentials that do not exist, on a public repo

Verified by execution, not inference:

```
$ gh secret list
CLOUDFLARE_ACCOUNT_ID   2026-07-04T15:42:49Z
CLOUDFLARE_API_TOKEN    2026-07-04T15:47:04Z
$ gh variable list        # empty
$ gh repo view --json visibility,nameWithOwner
{"nameWithOwner":"lirdaw/10xcards","visibility":"PUBLIC"}
```

So:

- `SUPABASE_URL` and `SUPABASE_KEY` are referenced at `ci.yml:26-27` and **do not exist**
  (see Summary #3).
- `SUPABASE_ACCESS_TOKEN`, project ref, and DB password appear **nowhere in the repo** —
  zero hits across `*.md`, `*.yml`, `*.json`, `*.jsonc`, `*.ts`, `*.toml` including
  `.claude/` and `context/`.
- The cloud project ref exists only in gitignored `supabase/.temp/project-ref` and
  `linked-project.json` (`supabase/.gitignore:3`, confirmed with `git check-ignore -v`).
  `config.toml:5` `project_id = "10x-astro-starter"` is the **local** stack name, not the
  cloud ref.
- No GitHub Environments exist, so there are no environment-scoped secrets either.

**`supabase link` is mandatory in CI, and the reason is IPv6.** Supabase's own docs list
GitHub Actions among the services that "only accept IPv4 connections", while Supabase
Postgres uses IPv6 by default; the Supavisor pooler is always IPv4.
`internal/utils/flags/db_url.go` dials `db.<ref>.supabase.co:5432` with a 5 s timeout and
falls back to a cached pooler config — which `link` writes to `supabase/.temp/pooler-url`.
Since `.temp` is gitignored, **CI must run `link` on every run**, and `--db-url` is
deliberately excluded from that fallback.

`supabase/setup-cli` is **not needed**: its only input is `version`, defaulting to
lockfile detection — which `npm ci` already provides. The CI already calls `npx supabase`.

**The decision this forces onto the user:** adding a Supabase access token (and possibly a
DB password) as secrets on a **public** repository. Fork PRs receive no secrets, so the
gate must be scoped to `push` on `main` (matching `ci.yml:50`) or explicitly guarded.
Note also the CLI's implicit fallback when `SUPABASE_DB_PASSWORD` is empty: it mints a
temporary DB role via the Management API — but with `ReadOnly: false`, i.e. **a read-write
role created on production**. Do not rely on that path for a gate.

### 7. Recommended shape

A separate job, so the failure reads as "prod is not migrated" rather than "tests failed",
and so cloud credentials never share a job with the suite that `ci.yml:35-37` explicitly
warns must stay on the local stack:

```yaml
  drift:
    needs: ci
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
      SUPABASE_PROJECT_ID:  ${{ secrets.SUPABASE_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx supabase link --project-ref "$SUPABASE_PROJECT_ID"
      - name: Fail if prod is not migrated
        run: |
          set -o pipefail
          npx supabase db push --dry-run 2>&1 | tee out.txt   # exit 1 on desync / out-of-order
          grep -q "Remote database is up to date." out.txt    # exit 1 on unpushed migrations
```

…then `deploy: needs: [ci, drift]` (`ci.yml:49`).

Why this and not the alternatives:

1. It is the **only** candidate returning a real non-zero exit for the failure this project
   has actually suffered (`ErrMissingLocal` is verbatim the M2L5 error string).
2. The remaining case needs one `grep`, not a table parser — and asserting the positive
   string makes an upstream message change fail **closed**.
3. Proven non-mutating at source level, unlike `db pull`.
4. No Docker, no shadow replay; reuses the pinned devDependency CLI.
5. It encodes the acceptance criterion literally: *would a `db push` have anything to do?*

**Consequence to state in the plan:** the gate turns `/ship`'s convention
(additive migration **before** merge) into an enforced rule. A merge that ships a migration
without pushing it first becomes a hard CI failure, which is the intended behaviour — the
Worker simply does not deploy against an un-migrated schema.

**Runner-up — `db diff --linked --schema public`**, gated on empty stdout. It wins the day
hand-edits in Studio (class 5) or an amended-after-push migration (class 4) becomes a live
concern. Conditions to accept first: Docker plus a full ten-migration shadow replay
(minutes), migra false positives on extensions/grants needing triage, and — the
non-obvious part — **it misses class 2 entirely**, the very incident behind Risk #5. It is
a complement, never a replacement; a nightly schedule is the natural home.

**Password-free variant — the Management API read-only query.** Wins if the user declines
to put a DB password on a public repo, or if `link` proves flaky from runners. Cleanest
exit-code semantics of the lot; costs a Beta endpoint and hand-rolled comparison logic.

### 8. What the gate will NOT cover — write this into test-plan.md

Risk #5 must not read as fully closed. The recommended gate covers drift classes 1, 2 and 3
and is **provably blind** to:

- **class 4** — a migration file amended after it was pushed (versions match, contents are
  never compared);
- **class 5** — prod changed by hand in Studio;
- **class 6** — `repair --status applied` on something never actually applied;
- **classes 7–9** — `config.toml` vs dashboard, stale `database.types.ts`, seed-row drift.

That is the same dated-claim discipline `test-plan.md` §3 already uses for `complete`.

## Code References

- `.github/workflows/ci.yml:12-46` — the `ci` job; `:24-27` build with two secrets that do not exist; `:32-44` local Supabase stack + credential override; `:35-37` the comment forbidding cloud creds in this job
- `.github/workflows/ci.yml:48-67` — the `deploy` job; `:49` `needs: ci` is the only existing gate; `:50` the branch guard the drift job should copy
- `astro.config.mjs:17-23` — env schema, all four fields `optional: true`
- `README.md:167` — instructs configuring `SUPABASE_URL`/`SUPABASE_KEY` as repo secrets (they are not configured)
- `.claude/skills/ship/SKILL.md:39-44` — `db push` is PROD-tier, human-default
- `.claude/skills/ship/SKILL.md:61-64` — pending-migration detection is a `git diff`, never a DB query
- `.claude/skills/ship/SKILL.md:86-91`, `:145` — the additive-migration-before-merge ordering rule
- `.claude/skills/ship/SKILL.md:93-120` — the three runbook shapes (feature-branch / on-main / worktree)
- `.claude/skills/ship/SKILL.md:148-156` — prod sanity gate
- `context/foundation/lessons.md:40-45` — "Cloud migration is a separate step from app deploy"
- `context/foundation/lessons.md:110-115` — the M2L5 worktree / blind-`repair` incident
- `context/foundation/lessons.md:145-150` — gitignored files (incl. the Supabase link) do not follow a worktree
- `supabase/.gitignore:3` — `.temp` ignored, so the cloud link never reaches CI
- `supabase/config.toml:5` — `project_id` is the local stack name, not the cloud ref
- `supabase/config.toml:18` — `max_rows = 1000`, dashboard config in the cloud
- `supabase/config.toml:65` — points at `./seed.sql`, which does not exist
- `package.json:15-18` — the four db scripts, all local
- `eslint.config.js:73` — `database.types.ts` excluded from lint
- `context/foundation/test-plan.md:104`, `:116` — Risk #5 row and its response guidance ("A unit test where a gate is required")
- `context/foundation/jira-map.md:32` — C10X-29 ↔ `schema-drift-test` mapping

## Architecture Insights

- **Two oracles, two blind spots, and neither dominates.** History vs DDL is not a
  precision/cost tradeoff — they answer different questions. The instinct that "the schema
  diff is the stronger check" is wrong for *this* project, whose one real incident was a
  history desync over an identical schema.
- **Exit codes are not a detail.** Two of the three obvious commands always exit 0. A gate
  written from the docs, without reading the source or testing the failure, would have
  looked correct and enforced nothing — the same class of failure `test-plan.md` calls a
  deliberate-breakage check.
- **The gate closes a hole the project already knows about and has only ever papered over
  with prose.** `lessons.md:40-44` states the rule; `SKILL.md` restates it; every slice plan
  repeats it. Nothing enforces it. That is the shape of a risk that keeps recurring.
- **Assert positive strings, not negative ones.** `grep -q "Remote database is up to date."`
  fails closed when upstream changes wording; `grep -qv "Would push"` fails open. This
  mirrors the project's existing rule that a denial must be paired with a positive control.
- **The gate can only ever detect.** Making CI run `db push` would be cheaper to write and
  would break the PROD-tier contract at `SKILL.md:39-44` and the rollback asymmetry recorded
  at `infrastructure.md:154-156` (a Worker rollback does not roll back the schema).

## Historical Context (from prior changes)

- `context/foundation/lessons.md:110-115` — the M2L5 incident; the only record that exists.
  Neither `context/archive/2026-07-24-srs-study-session/` nor
  `context/archive/2026-07-25-candidate-review/` has a `verification.md`.
- `context/archive/2026-07-26-srs-study-session-test/verification.md:8-44` — **the only
  `supabase migration list` output ever recorded**, run from the worktree with the branch
  confirmed first: Local == Remote on all ten migrations, 2026-07-26. `test-plan.md` §8
  restates that same run; it is one observation, not two.
- `context/archive/2026-07-26-srs-study-session-test/plan.md:198-236` — the closest prior
  art: a per-change `migration list` check that was **explicitly demoted from a gate**.
  Verbatim: "This phase is NOT a gate (plan-review F6) … `npx supabase migration list` also
  needs an active `supabase link` (the link lives in gitignored `supabase/.temp/`) and a
  non-interactive session may have neither. If the check cannot be run at all, record that
  … and proceed." The reasoning is at `reviews/plan-review.md:172-195`; the accepted
  tradeoff was "a drift is discovered later in the cycle". **This change is that later
  cycle.**
- `context/archive/2026-07-24-srs-study-session/reviews/impl-review.md:363-368` — a
  migration recorded as applied locally only, cloud push left open (later closed by the
  2026-07-26 `migration list` run).
- `context/changes/deployment/deployment-plan.md` — the word "migration" appears nowhere;
  `:117` records the rollback asymmetry. `context/foundation/infrastructure.md:142-163` has
  no migration step in its operational story and `:201-207` puts CI/CD out of scope.
- `context/foundation/jira-workflow.md:136-146` — `Deployed` is self-declared by the dev
  and never verified: "finish-work only READS it … it does not verify deploy".

## Related Research

- `context/foundation/test-plan.md` §2 Risk #5, §3 Phase 3, §5 (the gate row), §8 — the
  origin of this change and the acceptance criterion.
- `context/archive/2026-07-26-srs-study-session-test/research.md` — the audit that first
  recorded the cloud/local migration parity question.
- `context/archive/2026-07-26-ai-candidate-generation-test-2/verification.md` — the
  precedent for how a gate's boundary gets written down rather than smoothed over.

## Open Questions

1. **Will the user put Supabase cloud credentials on a PUBLIC repo?** The gate cannot exist
   otherwise. Three shapes, decreasing exposure: access token + project ref + DB password
   (the canonical Supabase workflow); access token + project ref only (CLI mints a
   temporary role — but a **read-write** one, so not recommended); access token + project
   ref against the Management API read-only endpoint (least exposure, Beta). **This is the
   blocking decision for the plan.**
2. **PR-time behaviour.** `/ship` runs `db push` *after* `gh pr create`, so at PR time prod
   is legitimately behind — a blocking PR gate would be red by design. Recommendation:
   gate only on `push` to `main` (mirroring `ci.yml:50`), and treat a PR-time run, if any,
   as advisory.
3. **Does `supabase link` succeed non-interactively without `SUPABASE_DB_PASSWORD`?** The
   canonical workflow always sets it; the fallback path was read in source but not
   executed. Verify during implementation, before choosing the secret set.
4. **Does `GET /v1/projects/{ref}/database/migrations` 403 for a plain PAT?** The spec says
   partner-OAuth-only. Untested (cloud-facing). Decides whether the password-free variant
   is a clean API call or a hand-rolled read-only query.
5. **Is the cloud database currently clean?** The last observation is 2026-07-26. If the
   gate is added while prod is already drifted, the first `main` push after it lands will
   go red — which is correct, but should be expected rather than debugged.
6. **CLI version pinning.** All exit-code claims are verified against **v2.98.2**, the
   lockfile-pinned version. `package.json:62` allows `^2.23.4`, so a future `npm update`
   could change the semantics silently. Consider pinning exactly, or re-verifying the
   failure mode in the change's own deliberate-breakage check.
7. **Adjacent and nearly free, deliberately out of the agreed scope:** the `ci` job already
   runs the local stack, so `npm run db:types && git diff --exit-code src/db/database.types.ts`
   would close drift class 8 for the cost of one step. Named here so a later change can pick
   it up; not proposed for this one.

## Follow-up Research 2026-07-27 — credential constraint resolved, recommendation changed

**Open Question #1 is closed, and it changes the primary recommendation.**

### The decision

The user's constraint, in their words: no passwords, logins or keys **in the code
repository**; a secret held in a secret store is acceptable, "and that is how it is done
now anyway". After inspecting
`https://github.com/lirdaw/10xcards/settings/secrets/actions` they confirmed the two
existing entries and accepted that store.

That store — GitHub Actions Secrets — is not part of the git tree: values are
write-only (unreadable after being set, including by the owner), masked in logs, and
withheld from fork PRs. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` have lived
there since 2026-07-04 and are what deploys the Worker today. **Nothing in any variant
was ever going to be committed to a file** — the original framing "on a public repo" was
about that store, and it caused avoidable confusion.

### What changes

The constraint that actually binds is **minimise how much credential the gate needs**, not
where it is stored. That flips the ranking of §5's two viable candidates:

| | §7 primary (`db push --dry-run`) | **New primary** (Management API read-only query) |
| --- | --- | --- |
| Secrets required | PAT + project ref + **production DB password** | PAT + project ref |
| Strongest credential exposed | the prod DB password — unrestricted DDL/DML | an account-scoped PAT |
| Non-mutating | proven by reading the `if dryRun` branch in v2.98.2 source | proven by construction — runs as `supabase_read_only_user` |
| Needs `supabase link` / IPv6 workaround | yes, on every run | no |
| Needs Docker | no | no |
| Exit-code control | upstream's (`ErrMissingLocal` / `ErrMissingRemote` → 1; unpushed → 0 + message, needs a `grep`) | entirely the script's |
| Maintenance risk | upstream message wording; CLI version drift under `^2.23.4` | **[Beta]** endpoint; hand-rolled comparison, no upstream test |
| Drift classes covered | 1, 2, 3 | **1, 2, 3 — identical** |

The decisive line is the last one: **both oracles cover exactly the same drift classes**,
because both compare migration filenames against the remote
`supabase_migrations.schema_migrations` table. The password buys no additional detection —
only a connection method. Under a "fewest keys" constraint, paying a production DB
password for zero extra coverage is the wrong trade.

### Recommendation (supersedes §7)

**Primary: the password-free Management API oracle.** Two secrets, one of which
(`SUPABASE_PROJECT_ID`) is not really secret — it is visible in the project's own URL. So
the gate adds **one genuine credential**.

```
POST https://api.supabase.com/v1/projects/{ref}/database/query/read-only
Authorization: Bearer $SUPABASE_ACCESS_TOKEN
{"query":"select version from supabase_migrations.schema_migrations order by version"}
```

Compare the returned versions against the leading timestamps of
`supabase/migrations/*.sql`; fail when any local version is absent remotely (class 1 or 3)
or any remote version is absent locally (class 2). Roughly fifteen lines of `curl` + `jq`,
running in a job gated to `push` on `main` and added to `deploy`'s `needs`.

Honest caveats, both for the plan to carry:

1. **A Supabase PAT is account-wide, not project-scoped.** It is the same class of
   credential as the Cloudflare API token already stored beside it, but the plan should
   mint a **dedicated** token for CI (revocable from the dashboard without disturbing the
   developer's own `supabase login`) rather than reusing a personal one.
2. **The endpoint is marked [Beta]** in the live OpenAPI spec and defines a `429`. If it is
   withdrawn or rate-limits in practice, the fallback is §7's `db push --dry-run` — which
   then, and only then, justifies storing the DB password. Record that as the documented
   escape hatch rather than discovering it under a red build.

Nothing else in this document changes: the gate's **blind spots are unchanged** (drift
classes 4–9, §8), the placement is unchanged (separate job, `deploy: needs: [ci, drift]`,
scoped to `push` on `main`), and the runner-up for hand-edit detection is still
`db diff --linked` on a nightly schedule.

### Consequences for the remaining open questions

- **#1 — closed** by this decision.
- **#3** (`does supabase link work without SUPABASE_DB_PASSWORD`) — **no longer blocking**;
  the primary oracle never calls `link`. It reverts to a question the fallback would have
  to answer.
- **#4** (does `GET /v1/projects/{ref}/database/migrations` 403 for a plain PAT) — **now
  the first thing to test during implementation.** If that documented-but-partner-gated
  endpoint happens to work, it replaces the hand-rolled query with a supported one and
  removes the [Beta] caveat. If it 403s, fall back to the read-only query above. Either
  way this is a two-minute check, and it must be run before the gate is written.
- **#6** (CLI version pinning) — **no longer applies to the primary**, which does not use
  the CLI at all. Still applies to the fallback.
