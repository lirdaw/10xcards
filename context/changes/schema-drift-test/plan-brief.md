# CI Gate for Database Schema Drift — Plan Brief

> Full plan: `context/changes/schema-drift-test/plan.md`
> Research: `context/changes/schema-drift-test/research.md`

## What & Why

Green CI currently means "tested", not "prod is actually migrated". The deploy pipeline has
no migration step of any kind — merging to `main` ships the Worker while the cloud database
is whatever a human last remembered to `db push`. This change adds a CI job that compares
local migration versions against the cloud's `supabase_migrations.schema_migrations` table
and blocks the deploy when they disagree. It closes test-plan Risk #5 for the three drift
classes this project has actually lived through, and writes down the ones it cannot see.

## Starting Point

`.github/workflows/ci.yml` has two jobs: `ci` (lint, build, local Supabase stack, suite) and
`deploy` (Worker on every push to `main`), with `needs: ci` as the only gate. No workflow,
npm script or hook anywhere runs a cloud-facing supabase command. "Prod is migrated" lives
solely in a human runbook (`.claude/skills/ship/SKILL.md`), whose own pending-migration
detection is a `git diff` and never a database query. The repository holds exactly two
secrets, both Cloudflare's.

## Desired End State

A push to `main` carrying a migration nobody pushed to the cloud fails CI before `deploy`
runs, naming the missing versions. Everything else deploys as before. The gate costs one new
credential — a dedicated, revocable Supabase access token — and never touches production with
anything but a read-only query. A separate on-demand workflow covers the DDL-level drift the
version comparison is blind to.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Which oracle | Management API read-only query, not `db push --dry-run` | Both compare the same two lists and cover the same drift classes, so the CLI route's production DB password buys a connection method and zero extra detection | Research + Plan |
| Endpoint shape | Probe three variants, prefer the stable `POST /database/query` with `read_only: true` | Context7 shows `V1RunQueryBody` as the documented body type, which removes most of the `[Beta]` caveat the research carried | Plan |
| PR behaviour | Gate only on `push` to `main` | `/ship` runs `db push` *after* `gh pr create`, so at PR time prod is legitimately behind and a blocking PR gate would be red by design | Research + Plan |
| Where the logic lives | Pure comparator AND runner both in `scripts/`, neither in `src/` | `tests/lib/no-logging.test.ts` fails the build on any `console.*` under `src/`, so the runner cannot live there; keeping the comparator beside it makes the import a sibling instead of the deep relative `../src/lib/…` path AGENTS.md's first Hard Rule forbids (the alias is unresolvable under Node's type stripping) | Plan + plan-review F3 |
| How the runner executes | `node --experimental-strip-types` | Zero new dependencies; the script imports only `node:fs` and global `fetch`, which also lets the CI job skip `npm ci` | Plan |
| Failure semantics | Fail closed, one retry on `429` | A gate that goes green on its own malfunction is the unfalsifiable-assertion failure test-plan §6.6 already records | Plan |
| Proof it works | Unit fixtures per drift direction + one recorded live run | Production cannot be deliberately drifted, so the fixtures carry the drift classes and the live run carries the wiring | Plan |
| Prod's starting state | Measure and record before wiring anything | Otherwise a first red build presents two hypotheses at once — real drift, or a broken new script | Plan |
| DDL coverage | On-demand `db diff` (`workflow_dispatch` only, no cron), severable, password confined to it | It is the only thing that sees hand-edits, but it needs Docker, a shadow replay and the prod DB password — so it stays off the deploy path, and a nightly cron would pay all of that for a red run nobody is committed to reading | Research + Plan + plan-review F4 |

## Scope

**In scope:**
- `drift` job on `push` to `main`; `deploy: needs: [ci, drift]`
- Pure comparator with fixtures + runner, both in `scripts/`
- Removing the phantom `SUPABASE_URL`/`SUPABASE_KEY` injected into the build step
- Generated-types drift step (`db:types` + `git diff --exit-code`) in the existing `ci` job
- On-demand `db diff` workflow (`workflow_dispatch` only — no `schedule:`)
- Docs: `test-plan.md`, a new `lessons.md` entry, `README.md`, `AGENTS.md`, and `ship/SKILL.md`
  (local-only — `.claude/` is gitignored and stays that way, so the tracked files carry the
  shared record)

**Out of scope:**
- CI applying migrations — `db push` stays a human PROD-tier step
- Gating pull requests
- Drift classes 6, 7 and 9 (`repair --status applied` on something never applied,
  `config.toml` vs dashboard, seed-row drift)
- A hand-rolled schema differ, and any notification channel beyond a red run

## Architecture / Approach

A **history** oracle, deliberately not a schema diff: the one incident behind Risk #5 was a
`migration repair` desync that left the schema identical and the history wrong — invisible to
migra. Two version lists (filenames vs the remote table) go into a pure comparator that
reports each direction separately: `missingRemote` = never pushed or skipped out-of-order,
`missingLocal` = the `repair` desync. Comparison is set-based, because this repository
genuinely contains an out-of-order pair (`20260712162349` merged 1.5 h after `...162359`)
that an order-based check would flag today. The runner does the I/O and owns the exit code;
the DDL-diff workflow adds the DDL half from a separate file that can be deleted without
touching the gate.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Spike + baseline | Chosen endpoint variant, CI token, recorded state of prod | The partner-gated endpoint 403s and the `[Beta]` one is the only option |
| 2. Comparator | Pure function + fixtures per drift direction | An order-based comparison would flag the repo's real out-of-order pair |
| 3. Runner + gate | `drift` job blocking `deploy` | An `always()` on `deploy` would silently defeat the whole change |
| 4. Adjacent CI fixes | Phantom secrets removed, types gate added | A generator format change makes every build red for an unrelated reason |
| 5. On-demand DDL diff | Classes 4-5 covered off the deploy path | Migra false positives on extensions/grants make the first run look like drift |
| 6. Docs + boundary | Risk #5 marked covered *with* its blind spots named | Claiming Risk #5 closed is exactly the dated-claim failure this file guards against |

**Prerequisites:** a dedicated Supabase personal access token and the cloud project ref
(gitignored, in `supabase/.temp/project-ref`), both set as GitHub Actions secrets; the DB
password additionally for Phase 5. Phase 1 is blocked on the human minting the token.

**Estimated effort:** ~2-3 sessions across six phases; Phases 1-3 are the gate, 4-6 are
severable.

## Open Risks & Assumptions

- The `[Beta]` read-only query endpoint could be withdrawn or rate-limit; the documented
  escape hatch is `db push --dry-run`, which then justifies storing the DB password.
- The cloud database may already be drifted — last observation is 2026-07-26. Phase 1
  measures it so the first red build is expected rather than debugged.
- CLI exit-code claims are verified against v2.98.2 (lockfile-pinned) while `package.json`
  allows `^2.23.4`; this affects the fallback and Phase 5, not the primary gate.
- Migra false positives on extensions and grants need triage before the DDL-diff job's output
  is trustworthy.
- The DDL-diff job has no notification channel and none is being built, which is exactly why
  it ships without a cron — it runs when someone asks, not nightly into an empty room.

## Success Criteria (Summary)

- A merge that ships a migration without pushing it first fails CI and the Worker does not
  deploy against an un-migrated schema.
- A `migration repair` desync — schema identical, history wrong — is caught, which is the
  failure this project actually suffered.
- `test-plan.md` states which drift classes remain uncovered, so Risk #5 does not read as
  closed when it is closed only in part.
