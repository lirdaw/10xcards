# CI Gate for Database Schema Drift — Implementation Plan

## Overview

Add a CI job that stops the Worker deploy whenever the cloud database is missing a
migration that the repository carries, or carries a migration the repository does not.
The gate compares migration **versions** — local filenames against the remote
`supabase_migrations.schema_migrations` table read through the Supabase Management API —
and fails closed. It closes test-plan Risk #5 for drift classes 1, 2 and 3, and states in
writing which classes it cannot see.

Two adjacent items ride along because the same files are already open: the phantom
`SUPABASE_URL`/`SUPABASE_KEY` secrets injected into the build, and a generated-types drift
step in the existing `ci` job. An on-demand `db diff` workflow covers the two classes the
history oracle is provably blind to.

## Current State Analysis

`.github/workflows/ci.yml` has exactly two jobs. `ci` (`:12-46`) lints, builds, starts a
**local** Supabase stack and runs the suite. `deploy` (`:48-67`) ships the Worker on every
push to `main`, guarded only by `needs: ci` (`:49`). **No workflow, npm script or hook
anywhere runs a cloud-facing supabase command** — `package.json:15-18` has only the four
local `db:*` scripts. "Prod is migrated" exists solely as a step in a human runbook
(`.claude/skills/ship/SKILL.md:86-91`), whose own pending-migration detection is a
`git diff` and never a database query (`:61-64`).

So Risk #5 is not a hypothetical about a future regression — it is the literal current
design, and `lessons.md:40-45` already names the rule that nothing enforces.

Constraints discovered that shape every decision below:

- **Two of the three obvious CLI oracles always exit 0.** `supabase migration list` renders
  a table and returns nil — a mismatch is a *blank cell*, there is no `--output json`, and
  the table is piped through glamour ASCII rendering. `supabase db diff` likewise always
  exits 0, printing `No schema changes found` to **stderr**. A gate written from the docs
  would have looked correct and enforced nothing.
- **The repository has two secrets**, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`
  (verified with `gh secret list`). There is no Supabase token, no project ref, no DB
  password; the cloud ref lives only in gitignored `supabase/.temp/`.
- **`tests/lib/no-logging.test.ts` fails the build on any `console.*` under `src/`** — it
  walks the whole tree textually. Anything that prints therefore cannot live in `src/`.
- **`tsconfig.json` includes `**/*`** and `astro/tsconfigs/base.json` sets
  `allowImportingTsExtensions: true` and `verbatimModuleSyntax: true`. A new `scripts/*.ts`
  is inside the TS project and inside `eslint .` with no config change, and may import a
  sibling `.ts` by explicit extension.
- **`.gitattributes` is `* text=auto eol=lf`**, so a regenerated file cannot differ from the
  committed one purely by line endings on a Linux runner.
- **The nine drift classes referred to throughout this plan are enumerated exactly once**,
  in `research.md:219-227` — class, mechanism, whether this project has observed it, and
  which oracle sees it. Every "class N" below means that table's row N. Read it before
  writing Phase 6's boundary text: `test-plan.md` is read without this change folder beside
  it, so the numbers have to arrive there with their names attached.
- **The out-of-order migration pair is real and still in the tree**:
  `20260712162349_generation_session` (earlier version) reached `main` about 1.5 h *after*
  `20260712162359_deck_keyword_search` (later version). Any comparison must treat this as
  normal, not as drift.

## Desired End State

A push to `main` that carries a migration nobody pushed to the cloud fails CI **before**
`deploy` runs, with a message naming the missing versions. A push whose migrations are all
applied deploys exactly as it does today. The gate needs one genuine new credential (a
dedicated Supabase personal access token) plus the project ref, and never touches the
production database with anything but a read-only query.

Verification: the comparator's behaviour is proven by unit fixtures covering each drift
direction; the wiring is proven by one live read against the real project recorded in
`verification.md`; and `test-plan.md` states which drift classes remain uncovered rather
than letting Risk #5 read as closed.

### Key Discoveries:

- `.github/workflows/ci.yml:49` — `needs: ci` is the only existing gate; extending it to
  `needs: [ci, drift]` is a one-line change and `deploy` consumes no artifact from `ci`.
- `.github/workflows/ci.yml:50` — the branch guard the new job copies verbatim, which is
  also what makes PR behaviour correct for free (see below).
- `.github/workflows/ci.yml:26-27` — `secrets.SUPABASE_URL` / `secrets.SUPABASE_KEY` are
  injected into the build and **neither exists**; harmless only because
  `astro.config.mjs:17-23` marks every field `optional: true`.
- `.claude/skills/ship/SKILL.md:39-44` — `supabase db push` is PROD-tier and human-default.
  The gate must only *detect*; a CI job that applied migrations would break that contract
  outright, and `infrastructure.md:154-156` records the rollback asymmetry that makes it
  worse (a Worker rollback does not roll back the schema).
- Context7 / `packages/api-types/types/api.d.ts` — the Management API's documented body type
  is `V1RunQueryBody: { query: string; read_only?: boolean; parameters?: unknown[] }` on
  `POST /v1/projects/{ref}/database/query`. That is the **stable** shape; the
  `/database/query/read-only` path the research cited is a separate, `[Beta]`-marked
  endpoint. Phase 1 decides which one this project uses by calling them.
- A Supabase PAT carries the same privileges as the account that minted it — hence a
  dedicated, revocable token for CI rather than reusing a developer's own.

## What We're NOT Doing

- **Not applying migrations from CI.** The gate detects; `db push` stays a human PROD-tier
  step per `SKILL.md:39-44`.
- **Not gating Pull Requests.** `/ship` runs `db push` *after* `gh pr create`, so at PR time
  prod is legitimately behind and a blocking PR gate would be red by design.
- **Not covering drift classes 6-9** — `repair --status applied` on something never applied,
  `config.toml` vs dashboard, seed/dictionary row drift. Class 8 (generated types) *is*
  covered, by a separate cheap step, and is called out as such.
- **Not adding `supabase/setup-cli`** — the CLI is already a devDependency and `npm ci`
  provides it; the drift job does not need the CLI at all.
- **Not building a hand-rolled schema differ.** The DDL-diff job uses migra via the CLI.
- **Not touching `.gitignore` or `.gitattributes`.** Both appear in this plan only as
  read-only facts. In particular `.claude/` stays ignored, so Phase 6's `ship/SKILL.md` edit
  is a deliberate local-only change — see that phase for what carries the same information
  into tracked files instead.
- **Not adding a notification channel** — and, because none exists, **not putting the
  DDL-diff job on a cron either** (plan-review F4). Its signal is a red run someone asked
  for; wiring alerts, and only then a schedule, is a separate concern.

## Implementation Approach

The gate is a **history oracle**: it answers "would a `db push` have anything to do?" by
comparing two sets of version strings. That is deliberately not a schema diff — the one
incident this project actually lived through (`lessons.md:110-115`) was a `migration repair`
desync that left the schema *identical* and the history wrong, which a DDL diff cannot see.
The two oracles are complementary, not ranked, which is why the on-demand `db diff` exists as
its own phase rather than as a replacement.

The remote read goes through the Management API rather than the CLI. Both oracles cover
**exactly the same drift classes**, because both compare filenames against
`supabase_migrations.schema_migrations`; the CLI route additionally requires the production
database password and a `supabase link` on every run (the IPv6 fallback config lives in
gitignored `supabase/.temp/`). Paying a production DB password for zero extra detection is
the wrong trade. `supabase db push --dry-run` remains the documented escape hatch if the
API endpoint is withdrawn or rate-limits in practice.

Logic and I/O are split so the logic is testable: a pure comparator, covered by ordinary
Vitest fixtures, and a runner that reads the directory, performs the fetch, prints, and
chooses the exit code. **Both live in `scripts/`, neither in `src/`.** The runner cannot live
in `src/` at all, because `tests/lib/no-logging.test.ts` fails on any `console.*` there. The
comparator could have, and deliberately does not: `src/` is the Worker's source, this module
is CI tooling the app never imports, and — the deciding point — a `scripts/ → src/` import
would have to be a relative `../src/lib/…` path with an explicit `.ts` extension, because
Node's type stripping resolves neither the `@/*` alias nor an extensionless specifier. That
is precisely the deep relative import AGENTS.md's first Hard Rule forbids. Keeping both files
in `scripts/` makes the import a sibling and leaves the rule intact. Nothing is lost: `scripts/`
is inside `tsconfig.json`'s `**/*`, inside `eslint .` (type-checked via `projectService: true`),
and its test is collected by Vitest's `tests/**/*.test.ts` like any other.

## Critical Implementation Details

**Skipped-job semantics make PR behaviour correct without a second condition.** The `drift`
job carries the same `if` as `deploy` (`github.event_name == 'push' && github.ref ==
'refs/heads/main'`). On a pull request `drift` is skipped, and a job whose `needs`
dependency was skipped is itself skipped — which is what `deploy` already does on its own.
Nothing regresses, and no `always()` / `!cancelled()` escape hatch is needed. Adding one
would silently let `deploy` run when `drift` failed, so do not.

**Fail closed means every non-success path exits 1.** Missing token, missing ref, non-2xx,
a body that does not parse, a result set that is empty — all are gate failures, not
pass-throughs. The one exception is a single retry on `429`, because the endpoint defines
that status and a rate-limit is not evidence about the schema. This mirrors the project's
existing rule that a denial is only meaningful when it is paired with a positive control:
a gate that goes green on its own malfunction is the unfalsifiable-assertion failure
`test-plan.md` §6.6 already records.

**But "exits 1" is one outcome covering two different facts, and the report must say which.**
"The schema is drifted" and "the gate could not find out" both block the deploy — correctly —
yet they call for opposite responses: the first is fixed by a `db push`, the second by waiting
out an incident or rotating a token. The runner therefore separates them in what it *prints*
(not in its exit code), and the operational consequence is written down rather than
discovered: this gate makes every Worker deploy depend on the Supabase Management API being
reachable, and a job whose `needs` failed **cannot be started on its own** — so there is no
"just run deploy" escape. The recovery for the ordinary case is `db push` then
`gh run rerun --failed`, which re-runs `drift` and then the dependent `deploy`; the escape
for a prolonged outage is a commit that removes `drift` from `deploy`'s `needs`. Both belong
in the runbook (Phase 6), because an undocumented fail-closed gate is how a hotfix stalls at
2 a.m.

## Phase 1: Spike the endpoint and record the starting state

### Overview

Decide which Management API shape this project uses by calling all three, mint the CI
token, and measure whether the cloud database is currently in sync — so that the first red
build after the gate lands is *expected* rather than debugged as two hypotheses at once.

Nothing in this phase is committed code; its output is a decision plus a recorded
observation. It is blocked on one human action (minting the token) and one lookup (the
project ref, which lives in gitignored `supabase/.temp/project-ref`).

### Changes Required:

#### 1. A dedicated CI token

**Human action**: mint a new personal access token at the Supabase dashboard's account
tokens page, named for its purpose (e.g. `ci-schema-drift`), and do not reuse the token
behind the developer's own `supabase login`.

**Contract**: the token is revocable independently of local development. It is stored only
in GitHub Actions Secrets as `SUPABASE_ACCESS_TOKEN`; `SUPABASE_PROJECT_ID` holds the ref.
Neither value is ever written to a tracked file.

#### 2. Endpoint probe

**File**: none tracked — a throwaway `curl` sequence, results recorded in
`context/changes/schema-drift-test/verification.md`.

**Intent**: establish which of three candidate reads works with a plain PAT, in decreasing
order of preference, and record the observed status and body shape for each.

**Contract**: probe in this order and stop at the first success —

1. `GET /v1/projects/{ref}/database/migrations` — supported and SQL-free if it works, but
   documented as available only to selected partner OAuth apps, so a `403` is the expected
   outcome and must be recorded either way.
2. `POST /v1/projects/{ref}/database/query` with body
   `{"query": "...", "read_only": true}` — the stable `V1RunQueryBody` shape.
3. `POST /v1/projects/{ref}/database/query/read-only` with body `{"query": "..."}` — the
   `[Beta]` path.

The query in cases 2 and 3 is
`select version from supabase_migrations.schema_migrations order by version`.

#### 3. Baseline observation

**File**: `context/changes/schema-drift-test/verification.md` (new).

**Intent**: record the remote version list as returned today, beside the ten filenames in
`supabase/migrations/`, and state plainly whether the project is currently in sync.

**Contract**: the record names the date, the endpoint variant used, both lists, and the
verdict. If a drift already exists, that is a finding to raise with the user before the gate
lands — not something to fix inside this change (a `db push` is PROD-mutating and belongs to
`/ship`).

#### 4. Secrets

**Human action**: `gh secret set SUPABASE_ACCESS_TOKEN` and `gh secret set SUPABASE_PROJECT_ID`.

**Contract**: `gh secret list` afterwards shows four entries. Fork PRs receive no secrets,
which is consistent with the job being scoped to `push` on `main`.

### Success Criteria:

#### Automated Verification:

- One endpoint variant returns `200` with the remote version list: recorded in `verification.md`
- `gh secret list` shows `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID`

#### Manual Verification:

- The CI token is a newly minted, dedicated token — not the one behind the local `supabase login`
- The baseline verdict (in sync / drifted) is recorded with its date, and any drift is raised with the user before Phase 3 lands

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 2: The comparator, with fixtures for each drift direction

### Overview

The whole decision — is prod migrated? — expressed as a pure function over two sets of
version strings, plus the test file that proves it distinguishes the drift directions and
tolerates the out-of-order pair this repository actually contains.

### Changes Required:

#### 1. The comparator

**File**: `scripts/schema-drift.ts` (new)

**Intent**: turn a list of local migration filenames and a list of remote applied versions
into a verdict that names *which* versions are missing on each side. Pure — no filesystem,
no network, no `console`; purity here is what makes it testable, not a lint rule (this file
is outside `no-logging.test.ts`'s `src/` scan, which is the runner's constraint, not this
one).

**Contract**: two exports.

- A version extractor mapping a migration filename to its leading timestamp, returning a
  miss (not a throw) for a filename that does not match, so a malformed name is a testable,
  reportable case rather than a silent drop.
- A comparator taking `{ local, remote }` version lists and returning a verdict carrying at
  least: an overall boolean, `missingRemote` (local versions absent from the cloud — drift
  class 1 "never pushed" and class 3 "out-of-order skipped"), `missingLocal` (cloud versions
  with no local file — drift class 2, the `repair` desync), and any filenames the extractor
  rejected.

Comparison is **set-based, not order-based**: `20260712162349` arriving after
`20260712162359` is not drift, and a comparator that assumed monotonic ordering would go red
on the repository as it stands today.

#### 2. The fixtures

**File**: `tests/lib/schema-drift.test.ts` (new)

**Intent**: prove each drift direction is distinguished and that the comparator is not a
function that simply always fails.

**Contract**: cases covering — identical sets → clean (**the positive control**, and it is
load-bearing: without it every failure assertion below is satisfied by a comparator that
rejects everything); a local version absent remotely → reported in `missingRemote` only; a
remote version absent locally → `missingLocal` only; both at once → both, not one; the real
out-of-order pair → clean; an empty remote set (fresh or wrong project) → every local
version in `missingRemote`; a filename with no leading timestamp → surfaced, never dropped;
a non-`.sql` entry → ignored.

Location: `tests/lib/`, which is where the suite's other pure-function files already sit
(`http.test.ts`, `study-session.test.ts`, `no-logging.test.ts`). §6.1's rule is that `tests/`
mirrors the path of what it tests, and the subject here lives in `scripts/` rather than
`src/` (see Implementation Approach) — so the mirroring convention gets one clarifying
sentence in Phase 6's test-plan edits rather than a `tests/scripts/` folder holding a single
file. The file inherits the suite's preflight, so it needs the local stack running even
though it touches nothing — the same trade `tests/lib/http.test.ts` already makes.

### Success Criteria:

#### Automated Verification:

- New tests pass: `npx vitest run tests/lib/schema-drift.test.ts`
- Full suite still passes: `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Deliberate-breakage check: invert the comparator's `missingLocal` direction (report it as clean) and confirm exactly the class-2 case goes red while the positive control stays green; revert and confirm the suite is green again

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 3: The runner and the CI gate

### Overview

Wire the comparator to the real world: read the migrations directory, read the cloud, print
a verdict a human can act on, and block `deploy` when it is bad.

### Changes Required:

#### 1. The runner

**File**: `scripts/check-schema-drift.ts` (new)

**Intent**: perform the I/O the comparator refuses to do, and own the exit code.

**Contract**: reads `supabase/migrations/` from the repository root, fetches the remote
versions from the endpoint Phase 1 selected, calls the comparator, prints a report naming
every missing version on either side, and exits `1` on any drift.

Fail-closed rules, each its own distinct message so a red build is diagnosable at a glance:
absent `SUPABASE_ACCESS_TOKEN` or `SUPABASE_PROJECT_ID`; any non-2xx; a body that does not
parse into a version list; an empty remote set. A `429` gets **one** retry after a wait, then
fails like anything else.

Those messages fall into **two labelled kinds**, because the reader's next action differs:
`DRIFT` (the comparison ran and disagreed — name the versions, and say the fix is `db push`
then `gh run rerun --failed`) and `GATE UNAVAILABLE` (the comparison never ran — missing
credential, non-2xx, unparseable body, empty result set — say plainly that this is not
evidence about the schema). Both exit `1`; the distinction is in the report, never in the exit
code, so nothing about the fail-closed contract is weakened.

Two mechanical constraints: it imports the comparator as a **sibling** with an explicit
`.ts` extension — `./schema-drift.ts` (Node's type stripping resolves neither the `@/*` alias
nor an extensionless specifier; `allowImportingTsExtensions` is already on, and keeping both
files in `scripts/` is what stops this from becoming the deep relative `../src/lib/…` import
AGENTS.md forbids) — and it uses `import type` for type-only imports because
`verbatimModuleSyntax` is set.

It has **zero runtime dependencies** — `node:fs` and global `fetch` only. That is a property
worth preserving: it is what lets the CI job skip `npm ci` entirely.

#### 2. The gate

**File**: `.github/workflows/ci.yml`

**Intent**: add a `drift` job between `ci` and `deploy`, so a failure reads as "prod is not
migrated" rather than "tests failed", and so cloud credentials never share a job with the
suite that `:35-37` explicitly warns must stay on the local stack.

**Contract**: the new job carries `needs: ci` and the same guard as `deploy`
(`github.event_name == 'push' && github.ref == 'refs/heads/main'`), checks out, sets up
Node 22, and runs the script under `node --experimental-strip-types`. No `npm ci`, no npm
cache — the script has no dependencies. `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID`
come from secrets at job level.

Then `deploy` gains the second dependency: `needs: [ci, drift]`.

Do **not** add `always()` or `!cancelled()` to `deploy`'s condition — that would let it run
after a failed gate, which is the one thing this change exists to prevent.

### Success Criteria:

#### Automated Verification:

- Lint passes on the new script: `npm run lint`
- The script runs locally end-to-end against the real project with the CI token exported, and reports the same verdict Phase 1 recorded
- Full suite still passes: `npm test`
- The workflow is valid YAML and the job graph is as intended: `gh workflow view CI`, read on the rehearsal run below (the branch push) — not deferred to after the merge

#### Manual Verification:

- On a scratch branch, a fabricated extra migration filename makes the script exit 1 locally and name that version — then remove it
- Missing-token and missing-ref paths each exit 1 with their own message (unset the variable and run)
- **Deliberate-breakage check on the guard itself** — the one claim this change exists to make. Temporarily widen the `drift` job's `if` to include this feature ref, commit a fabricated migration filename, push, and record from the Actions run that `drift` is **red** *and* `deploy` is **skipped** (not merely "not green"). Asserting the script's exit code is not this claim: `needs: [ci, drift]` is what carries it, and a stray `always()` / `!cancelled()` would let `deploy` run while every other criterion here stayed green
- The widened `if` and the fabricated migration are both reverted, and `gh workflow view CI` shows the job graph back to `push`-on-`main` only — this revert is its own check because forgetting it ships a gate that runs on every branch
- **(ship-time, after the merge — see the Implementation Note)** A real push to `main` shows `drift` green and `deploy` running as before
- The run's whole log is checked for the token — GitHub masks secrets, but the script must not be printing it in the first place

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase. **The pause covers only the criteria that can be
satisfied before the merge** — 3.1-3.8 and 3.10. Criterion 3.9 is ship-time by construction:
the merge happens once, at `/ship`, after all six phases, so treating it as a phase gate
would block the plan on an event the plan has not reached. Carry 3.9 (and 5.5) into
`verification.md` as a ship-time checklist and tick them there, so they are neither
blocking nor quietly forgotten.

---

## Phase 4: Adjacent CI corrections

### Overview

Two things the same file already contains and that are cheap while it is open: a build step
injecting secrets that do not exist, and drift class 8 — generated types diverging from the
schema — which the `ci` job can close for the cost of one step because the local stack is
already running.

### Changes Required:

#### 1. Phantom secrets

**File**: `.github/workflows/ci.yml`

**Intent**: stop injecting `secrets.SUPABASE_URL` / `secrets.SUPABASE_KEY` into the build
step. Neither exists; the build succeeds only because `astro.config.mjs:17-23` marks every
field `optional: true`, so today the step passes empty strings and reads as configured.

**Contract**: the `env:` block on the `npm run build` step is removed. Nothing else in the
job changes — the *test* credentials are exported later from the local stack (`:38-44`) and
are unaffected.

#### 2. Generated-types gate

**File**: `.github/workflows/ci.yml`

**Intent**: fail the build when `src/db/database.types.ts` no longer matches what the
migrations generate.

**Contract**: a step after `Start local Supabase stack` running `npm run db:types` followed
by `git diff --exit-code src/db/database.types.ts`. It must come after the stack is up
(the script is `--local`) and it belongs in the existing `ci` job precisely because that
stack is already paid for — a second `supabase start` would add ~1m46s to every run.

`.gitattributes` is `* text=auto eol=lf`, so a Linux runner cannot produce a diff from line
endings alone; a red step means a genuine schema/type divergence.

### Success Criteria:

#### Automated Verification:

- `npm run db:types && git diff --exit-code src/db/database.types.ts` is clean locally against a freshly reset stack
- CI is green on the branch after both edits
- `npm run build` still succeeds without the removed `env:` block

#### Manual Verification:

- Deliberate-breakage check: hand-edit one line of `src/db/database.types.ts`, confirm the new step goes red, revert
- The CI log shows the build step no longer referencing the two non-existent secrets

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 5: On-demand DDL diff for the classes the history oracle cannot see

### Overview

The gate from Phase 3 compares *versions*; it never compares *contents*. Two drift classes
live in that blind spot: a migration file amended after it was pushed (which `/ship` makes
reachable by construction, since `db push` runs from the feature branch before the merge),
and production changed by hand in Studio. Both need a real DDL diff, which needs Docker, a
shadow replay of all ten migrations, and — the part that matters for this project's
"fewest keys" constraint — the production database password.

That password is confined to this workflow. The deploy-blocking gate stays password-free.

**It ships on `workflow_dispatch` only — no cron, deliberately** (plan-review F4). A schedule
would pay a Docker run plus a `supabase link` against production every night, and re-triage
migra's extension/grant noise on every one of them, for a signal with no consumer: there is
no notification channel here and none is being built, so the sole output would be a red run
in a tab nobody is committed to reading — an alarm nobody hears is not coverage. The two
classes this covers are also the ones the research rates lowest: class 4 is "mechanism
reachable, **no observed prod instance**" and class 5 is "channel exists"
(`research.md:222-224`). On demand, the capability and its calibration record exist and cost
nothing when unused, and the credential is exercised only while a human is already looking.
Adding `schedule:` later is one line — do it the day a notification channel and an owner
exist, not before.

This phase is deliberately severable: deleting the file it adds leaves Phases 1-4 intact.

### Changes Required:

#### 1. The DDL-diff workflow

**File**: `.github/workflows/schema-diff.yml` (new)

**Intent**: run migra against the cloud project on demand, and go red when the deployed
schema differs from what replaying the migrations produces.

**Contract**: the only trigger is `workflow_dispatch` — no `schedule:` block, and its absence
is asserted by criterion 5.2 so a later "while I'm here" cron addition is a deliberate act.
Steps:
checkout, Node 22, `npm ci` (this job *does* need the pinned CLI), `npx supabase link
--project-ref "$SUPABASE_PROJECT_ID"`, then `npx supabase db diff --linked --schema public`.

**The gate condition is "stdout is non-empty", not the exit code.** `db diff` returns nil
regardless of outcome and prints `No schema changes found` to **stderr** — a job that
trusted `$?` here would be green forever. This is the same trap that disqualified
`migration list`, one command over.

Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID` and **`SUPABASE_DB_PASSWORD`**. The
password is required rather than optional: with it unset the CLI mints a temporary database
role via the Management API with `ReadOnly: false` — a read-write role created on
production, which is worse than storing the password.

#### 2. Calibration record

**File**: `context/changes/schema-drift-test/verification.md`

**Intent**: record the first run's output as the baseline, because migra reports false
positives on extensions and grants and an uncalibrated first run will look like drift.

**Contract**: the record states what the first `db diff` printed, which lines are genuine
and which are known migra noise, and — if noise exists — how the workflow filters it. If the
first run reveals real class-4 or class-5 drift, that is a finding for the user, not
something this change repairs.

### Success Criteria:

#### Automated Verification:

- A `workflow_dispatch` run completes; then a **second** dispatch, run after the first one's output has been triaged and recorded below, matches that baseline. It must be a second run: checking the first run against a baseline taken from that same run is an assertion agreeing with itself, which §6.1 names as the oracle problem
- The workflow is valid YAML, appears in `gh workflow list`, and declares `workflow_dispatch` as its **only** trigger — the absence of `schedule:` is asserted, so re-adding a cron is a deliberate act rather than a drift

#### Manual Verification:

- The first run's full output is triaged into genuine vs migra noise and recorded in `verification.md`
- Deliberate-breakage check: run it once from a branch carrying an added column in a scratch migration and confirm the job reports a difference; revert the branch
- **(ship-time, after the merge)** `deploy` is confirmed **not** to depend on this workflow — a red DDL diff must never block a release

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase. As in Phase 3, criterion 5.5 is ship-time and belongs
on `verification.md`'s ship-time checklist rather than in this gate.

---

## Phase 6: Documentation and the gate's stated boundary

### Overview

Risk #5 must not read as fully closed. This phase writes down what the gate covers, what it
cannot see, and the two operational facts that changed: `db push` before merge is now
enforced rather than conventional, and two `supabase` commands that look like gates are not.

### Changes Required:

#### 1. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: move §3 Phase 3 to `complete` **with its boundary stated in the same breath**,
following the file's own dated-claim discipline.

**Contract**: six touch points —

- §2, Risk #5's row — mark covered with the date and the change id, and state the coverage
  **per class, not as one range** (mirroring how Risk #4's and Risk #6's rows carry their
  qualifiers). Writing "classes 4-9 are not covered" would be false for four of the six by
  this change's own doing, which fails the same accuracy test the row exists to pass. The
  true split, with each class named as `research.md:219-227` names it: **1-3** (never
  pushed / `repair` desync / out-of-order skipped) — gated in CI and deploy-blocking;
  **4-6** (file amended after push / hand-edit in Studio / `repair --status applied` on
  something never applied) — detectable off the deploy path by the on-demand DDL diff, which
  nobody is scheduled to run; **8** (stale `database.types.ts`) — gated in the `ci` job;
  **7 and 9** (`config.toml` vs dashboard, seed-row drift) — not covered at all.
- §3, Phase 3's row — status `not started` → `complete`, change folder filled in, plus a
  sequencing note recording that the gate is a history oracle by deliberate choice, because
  the incident behind the risk was a history desync over an identical schema that a DDL diff
  cannot see.
- §5 — the `migration/schema drift check` row moves from `required after §3 Phase 3` to
  wired, and the on-demand `db diff` is added as an optional, human-triggered check — recorded
  as such, not as a scheduled gate, so §5 does not imply a signal nobody is watching.
- §6.6 — a new per-phase entry for Phase 3, in the shape the existing entries use: a claim
  table (what proves each claim), the deliberate-breakage checks with their observed splits,
  and an explicit "what this does NOT prove" list. That list is about **the gate**, so
  classes 4-9 all belong in it and the range is correct here — the gate is a history oracle
  and compares versions, never contents. Say so in those terms rather than as a coverage
  claim about the risk, and cross-reference §2's per-class row so the two cannot be read as
  contradicting each other. Name each class, do not cite bare numbers. Plus the fact that no
  test here reaches the real Management API — Phase 1's live read is a recorded observation,
  not an assertion in the suite.
- §6.1 — one clarifying sentence on the mirroring rule: `tests/` mirrors the path of what it
  tests, and where the subject is CI tooling under `scripts/` rather than app code under
  `src/`, its test still sits in `tests/lib/` beside the suite's other pure-function files.
  Without it the next contributor reads `tests/lib/schema-drift.test.ts` as a convention break.
- §8 — a freshness-ledger entry dating the claim and recording the suite state at completion.

#### 2. Lessons

**File**: `context/foundation/lessons.md`

**Intent**: capture the most portable finding — that a CI gate built on `supabase migration
list` or `db diff` enforces nothing, because both always exit 0.

**Contract**: one new entry in the file's existing Context / Problem / Rule / Applies-to
shape. The rule has two halves: verify a command's exit code against the pinned version
before building a gate on it, and assert the **positive** string (`Remote database is up to
date.`) rather than the absence of a negative one, so an upstream wording change fails
closed.

#### 3. Ship runbook

**File**: `.claude/skills/ship/SKILL.md`

**Intent**: the runbook's ordering rule is now enforced by CI, and skipping `db push` is a
hard failure rather than a later problem.

**This file is gitignored, and that is left alone deliberately.** `.gitignore` carries
`.claude/`, so every edit below is a **local, untracked** change: it persists on this machine
and reaches neither the repository, CI, nor a fresh clone. Do **not** "fix" that — un-ignoring
`.claude/` is not in scope for this change and no phase here touches `.gitignore` or
`.gitattributes` at all (both are read-only facts in Current State Analysis). The consequence
to accept rather than work around: the runbook edits serve the human who runs `/ship` on this
machine, and the durable, shared record of the same two facts is `README.md` (§4 below),
`AGENTS.md` (§5) and `test-plan.md` (§1) — which is why the recovery procedure is stated in
the README as well, not only here.

**Contract**: three edits, no behaviour change to the skill's tiers. The ordering rule at
`:86-91` gains a sentence stating that CI now blocks the deploy when the migration was not
pushed. The Step 0 pending-migration detection at `:61-64` gains a note that its `git diff`
heuristic is now backed by an actual database query in CI — the runbook stays the place the
human acts, the gate is the backstop. And a short **"the gate went red — now what"** block
states the recovery for both report kinds: `DRIFT` → `supabase db push` (PROD tier, unchanged)
then `gh run rerun --failed`, which re-runs `drift` and then the dependent `deploy`;
`GATE UNAVAILABLE` → this is not evidence about the schema, and because a job whose `needs`
failed cannot be started on its own, a prolonged Management API outage is escaped only by a
commit removing `drift` from `deploy`'s `needs`. Naming the escape is the point — an
undocumented fail-closed gate is worse than a documented one.

#### 4. README

**File**: `README.md`

**Intent**: the CI section is wrong in three ways at once — it names `master` where the
workflow targets `main`, it tells the reader to configure `SUPABASE_URL`/`SUPABASE_KEY` as
repository secrets (Phase 4 removes the step that would have read them), and it does not
mention the drift gate.

**Contract**: the CI section describes the three jobs, names `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_PROJECT_ID` as the secrets the gate requires and `SUPABASE_DB_PASSWORD` as the
DDL-diff-only one, and drops the stale instruction. It also states the deploy-path consequence
in one sentence — a deploy now requires the Management API to be reachable, and a red `drift`
is recovered by `db push` + `gh run rerun --failed` (or, for an outage, by removing `drift`
from `deploy`'s `needs`) — pointing at the ship runbook for the full procedure.

#### 5. Agent onboarding

**File**: `AGENTS.md`

**Intent**: an agent shipping a slice must know the migration goes to the cloud before the
merge, or CI stops the deploy.

**Contract**: one line in `## Commands`, next to the existing `npm test` line, in that
file's reference-heavy style. Keep it to one line — the file is deliberately short and a
deploy narrative does not belong in it.

### Success Criteria:

#### Automated Verification:

- Every file:line reference added to `test-plan.md` resolves: spot-check each with `sed -n`
- `npm run lint` and `npm run format` are clean (Prettier formats the markdown in this repo)
- `npm test` still passes

#### Manual Verification:

- §3 Phase 3's row and §2's Risk #5 row agree with each other about what is and is not covered
- The "what this does NOT prove" list in §6.6 names drift classes 4-9 explicitly, and does not claim the suite tests the Management API
- The `lessons.md` entry is readable standing alone, without this change folder

---

## Testing Strategy

### Unit Tests:

- The comparator, over fixtures: each drift direction in isolation and together, the real
  out-of-order pair, an empty remote set, a malformed filename, a non-`.sql` entry.
- The positive control (identical sets → clean) is the case that makes the rest mean
  anything; without it a comparator that rejects every input passes every failure assertion.

### Integration Tests:

None in the suite. This is deliberate and must be stated in `test-plan.md` rather than
implied: the remote read is a live cloud call requiring an account credential, and the
project's preflight (`tests/setup/preflight.ts`) exists precisely to abort a run that points
at anything non-local. The wiring is proven by the recorded live run in Phase 1 and by the
CI job itself, not by a test.

### Manual Testing Steps:

1. Export the CI token locally and run the script — it must report the same verdict Phase 1
   recorded against the same project.
2. Add a fabricated migration filename, re-run, confirm exit 1 naming that version, remove it.
3. Unset `SUPABASE_ACCESS_TOKEN`, re-run, confirm exit 1 with the missing-credential message
   rather than a stack trace.
4. After merge, confirm on a real push to `main` that `drift` runs green and `deploy`
   proceeds; confirm on the Actions page that `deploy` lists both dependencies.
5. Trigger the DDL-diff workflow by hand and triage its first output.

## Performance Considerations

The `drift` job adds roughly ten seconds to the path between merge and deploy: it skips
`npm ci` entirely because the script has no dependencies, so it is checkout + Node setup +
one HTTPS request. For comparison the existing `ci` job takes about 2m57s, of which
`npx supabase start` alone is 1m46s.

The DDL-diff workflow is the expensive one — Docker, a shadow database, ten migrations
replayed, then migra in a second container: minutes. It is off the deploy path by design, and
since it runs only on `workflow_dispatch` that cost is paid when someone asks for it rather
than every night.

## Migration Notes

If Phase 1 finds the cloud database already drifted, the first push to `main` after Phase 3
lands will go red. That is the gate working, not a defect — but it must be *expected*, which
is why Phase 1 measures and records the state before anything is wired. Repairing an existing
drift is a `db push`, a PROD-tier step belonging to `/ship`, and is out of scope here.

If the Management API endpoint is withdrawn or rate-limits in practice, the documented
fallback is `supabase db push --dry-run` in the same job shape — which then, and only then,
justifies storing the production database password for the deploy path. That command exits 1
on a history desync and on an out-of-order local migration, but exits **0** with a message
for the ordinary "committed but never pushed" case, so it needs a `grep` asserting the
positive string `Remote database is up to date.` Its exit-code semantics were verified
against CLI v2.98.2, the lockfile-pinned version; `package.json` allows `^2.23.4`, so
re-verify before relying on them.

## References

- Related research: `context/changes/schema-drift-test/research.md`
- Risk and acceptance criterion: `context/foundation/test-plan.md` §2 Risk #5, §3 Phase 3, §5
- The incident: `context/foundation/lessons.md:110-115`
- The runbook the gate enforces: `.claude/skills/ship/SKILL.md:39-44`, `:61-64`, `:86-91`
- Prior art, a `migration list` check explicitly demoted from a gate:
  `context/archive/2026-07-26-srs-study-session-test/plan.md:198-236`
- Pure-function-plus-fixtures pattern to follow: `src/lib/http.ts` with `tests/lib/http.test.ts`
- The `console.*` guard that dictates where the runner lives: `tests/lib/no-logging.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Spike the endpoint and record the starting state

#### Automated

- [x] 1.1 One endpoint variant returns 200 with the remote version list: recorded in `verification.md` — 9ddabf1
- [x] 1.2 `gh secret list` shows `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` — 9ddabf1

#### Manual

- [x] 1.3 The CI token is a newly minted, dedicated token — not the one behind the local `supabase login` — 9ddabf1
- [x] 1.4 The baseline verdict (in sync / drifted) is recorded with its date, and any drift is raised with the user before Phase 3 lands — 9ddabf1

### Phase 2: The comparator, with fixtures for each drift direction

#### Automated

- [x] 2.1 New tests pass: `npx vitest run tests/lib/schema-drift.test.ts` — b387017
- [x] 2.2 Full suite still passes: `npm test` — b387017
- [x] 2.3 Lint passes: `npm run lint` — b387017

#### Manual

- [x] 2.4 Deliberate-breakage check: inverting the `missingLocal` direction turns exactly the class-2 case red while the positive control stays green; revert restores green — b387017

### Phase 3: The runner and the CI gate

#### Automated

- [x] 3.1 Lint passes on the new script: `npm run lint`
- [x] 3.2 The script runs locally against the real project and reports the same verdict Phase 1 recorded
- [x] 3.3 Full suite still passes: `npm test`
- [x] 3.4 The workflow is valid YAML and the job graph is as intended: `gh workflow view CI`

#### Manual

- [x] 3.5 A fabricated extra migration filename makes the script exit 1 locally and name that version
- [x] 3.6 Missing-token and missing-ref paths each exit 1 with their own message
- [x] 3.7 Deliberate-breakage check on the guard: with the `if` widened to this branch and a fabricated migration pushed, `drift` is red AND `deploy` is skipped in the Actions run
- [x] 3.8 The widened `if` and the fabricated migration are reverted; `gh workflow view CI` shows the graph back to `push`-on-`main` only
- [ ] 3.9 (ship-time) After merging, a real push to `main` shows `drift` green and `deploy` running as before
- [x] 3.10 The run's log contains no token material

### Phase 4: Adjacent CI corrections

#### Automated

- [ ] 4.1 `npm run db:types && git diff --exit-code src/db/database.types.ts` is clean against a freshly reset stack
- [ ] 4.2 CI is green on the branch after both edits
- [ ] 4.3 `npm run build` still succeeds without the removed `env:` block

#### Manual

- [ ] 4.4 Deliberate-breakage check: a hand-edit to `database.types.ts` turns the new step red; revert restores green
- [ ] 4.5 The CI log shows the build step no longer referencing the two non-existent secrets

### Phase 5: On-demand DDL diff for the classes the history oracle cannot see

#### Automated

- [ ] 5.1 A `workflow_dispatch` run completes; a SECOND dispatch, after the first run's output has been triaged and recorded, matches that baseline
- [ ] 5.2 The workflow is valid YAML, appears in `gh workflow list`, and declares `workflow_dispatch` as its ONLY trigger — no `schedule:`

#### Manual

- [ ] 5.3 The first run's full output is triaged into genuine vs migra noise and recorded in `verification.md`
- [ ] 5.4 Deliberate-breakage check: a scratch migration adding a column makes the job report a difference; revert
- [ ] 5.5 (ship-time) `deploy` is confirmed not to depend on this workflow

### Phase 6: Documentation and the gate's stated boundary

#### Automated

- [ ] 6.1 Every file:line reference added to `test-plan.md` resolves
- [ ] 6.2 `npm run lint` and `npm run format` are clean
- [ ] 6.3 `npm test` still passes

#### Manual

- [ ] 6.4 §3 Phase 3's row and §2's Risk #5 row agree about what is and is not covered
- [ ] 6.5 §6.6's "what this does NOT prove" list names drift classes 4-9 and does not claim the suite tests the Management API
- [ ] 6.6 The `lessons.md` entry is readable standing alone, without this change folder
