# Verification — CI Gate for Database Schema Drift

> Evidence log for `context/changes/schema-drift-test/plan.md`. Each phase appends its own
> section. Ship-time criteria are collected at the bottom, because the merge happens once, at
> `/ship`, after all six phases. That set grew after the plan was written: it started as
> 3.9 and 5.5, and Phase 5 added **5.1, 5.3, 5.4 and one clause of 5.2** — `workflow_dispatch`
> is only offered for a workflow file that already sits on the default branch, so most of
> that phase cannot be verified from a feature branch at all. Read the checklist at the
> bottom, not this sentence, for the current list — and read the loop-back note beside it,
> which says who ticks what once the merge has happened.

## Phase 1 — Endpoint spike and baseline observation

**Date**: 2026-07-27
**Project ref**: `bhwnautkdfzrhepkuozx` (read from gitignored `supabase/.temp/project-ref`)
**Credential**: a dedicated Supabase personal access token named `ci-schema-drift`, minted
for this purpose. Not written to any tracked file.

### Endpoint probe — all three variants, in the plan's preference order

The plan's contract was "probe in this order and stop at the first success". The first
variant succeeded, so it is the one this project uses. Variants 2 and 3 were run anyway —
deliberately beyond the stop rule — because both are read-only `select`s and the fallback
story in the plan's Migration Notes is worth having measured rather than assumed.

| #   | Request                                                                        | Observed status | Body shape                                     |
| --- | ------------------------------------------------------------------------------ | --------------- | ---------------------------------------------- |
| 1   | `GET /v1/projects/{ref}/database/migrations`                                   | **200**         | `[{"version":"…","name":"…"}, …]` — 10 objects |
| 2   | `POST /v1/projects/{ref}/database/query` with `{"query":"…","read_only":true}` | **201**         | `[{"version":"…"}, …]` — 10 objects            |
| 3   | `POST /v1/projects/{ref}/database/query/read-only` with `{"query":"…"}`        | **201**         | `[{"version":"…"}, …]` — 10 objects            |

The query used in 2 and 3:
`select version from supabase_migrations.schema_migrations order by version`.

**Selected: variant 1.** It is SQL-free, needs no `supabase_migrations` schema knowledge,
and carries the migration `name` alongside the version at no extra cost.

**Two findings that change what the runner must do.**

- **The plan predicted `403` on variant 1** — the Management API docs mark
  `/database/migrations` as available only to selected partner OAuth apps. A plain PAT gets
  **200**. The plan required this outcome to be "recorded either way"; it is recorded here as
  the favourable direction, and it is what removes the `[Beta]` endpoint from this project's
  deploy path entirely. Re-probe before assuming it still holds: this is a documented
  restriction that happens not to be enforced, which is a weaker guarantee than a documented
  contract.
- **Variants 2 and 3 answer `201`, not `200`.** A runner written as `if (res.status !== 200)`
  would fail closed on a perfectly good response the day it fell back to either of them. The
  plan's rule is "any non-2xx" and it must be implemented literally as `res.ok`, not as an
  equality check on 200. Recorded here because the trap is invisible from the docs.

### Baseline observation

Compared programmatically (set difference on version strings), not by eye.

| Local file (`supabase/migrations/`)                      | Remote `schema_migrations`                             |
| -------------------------------------------------------- | ------------------------------------------------------ |
| `20260705180246_init_core_schema.sql`                    | `20260705180246` `init_core_schema`                    |
| `20260710195327_manual_card_source.sql`                  | `20260710195327` `manual_card_source`                  |
| `20260712162349_generation_session.sql`                  | `20260712162349` `generation_session`                  |
| `20260712162359_deck_keyword_search.sql`                 | `20260712162359` `deck_keyword_search`                 |
| `20260724195248_srs_study_schedule.sql`                  | `20260724195248` `srs_study_schedule`                  |
| `20260724220524_srs_study_schedule_review_fixes.sql`     | `20260724220524` `srs_study_schedule_review_fixes`     |
| `20260725112600_search_accepted_only.sql`                | `20260725112600` `search_accepted_only`                |
| `20260725112700_flashcard_state_no_touch_updated_at.sql` | `20260725112700` `flashcard_state_no_touch_updated_at` |
| `20260725133600_generation_idempotency_key.sql`          | `20260725133600` `generation_idempotency_key`          |
| `20260725150000_candidate_counts_rpc.sql`                | `20260725150000` `candidate_counts_rpc`                |

- `missingRemote` (local, never applied in the cloud): **none**
- `missingLocal` (cloud rows with no local file — the `repair`-desync direction): **none**
- Name mismatches on shared versions: **none**
- Non-`.sql` or unparseable filenames in the directory: **none**

**Verdict: IN SYNC as of 2026-07-27.**

**Confirmed against a second, independent remote oracle.** Variant 1 is a Management API
abstraction over the migration history; variant 2 is a raw `select` against
`supabase_migrations.schema_migrations` itself. Both return the same ten versions, and both
agree with the local directory. So the verdict is a fact about the project, not an artefact
of one endpoint's view of it — which matters because the whole gate will rest on variant 1
alone.

Consequence for Phase 3, which is the reason this measurement exists: the first push to
`main` after the gate lands must be **green**. A red one is evidence of a defect in the new
script, not of pre-existing drift — the two hypotheses are separated in advance rather than
debugged together.

Note that the out-of-order pair (`20260712162349` applied to the cloud _after_ the later
`20260712162359`) is present on both sides and reads as clean, which is exactly what the
set-based comparison in Phase 2 must reproduce. An order-based comparator would call this
repository drifted today.

### The credential is dedicated — verified, not asserted

The plan's manual criterion was "a newly minted, dedicated token — not the one behind the
local `supabase login`". Taking that on trust would have been the easy path; it was checked
instead, by two independent routes, because "I made a new one" and "the CI job is now
authenticated as the developer" are indistinguishable from the outside.

- **Direct comparison against the CLI's stored credential.** The Supabase CLI keeps its token
  in the Windows Credential Manager under the generic target `Supabase CLI:supabase` (there is
  no `~/.supabase/access-token` file on this machine). Read via `CredRead` and compared with
  the token now in GitHub: both are well-formed PATs (`sbp_`, 44 chars) and their SHA-256
  digests **differ**. Only the digests were printed, never the values.
- **The account's token list.** The dashboard shows three tokens: `ci-schema-drift`, last used
  9 minutes earlier — i.e. by the probes above — plus two auto-named `cli_<host>@<host>_<id>`
  entries, last used a day and three days earlier. The CI credential is its own purpose-named
  entry and is not a member of the CLI-login family.

Both hold, so the token is revocable without breaking local development, which was the point
of the criterion.

### Secrets

Both set by hand (never by a script, never written to a tracked file). `gh secret list`
afterwards, 2026-07-27:

```
CLOUDFLARE_ACCOUNT_ID   2026-07-04T15:42:49Z
CLOUDFLARE_API_TOKEN    2026-07-04T15:47:04Z
SUPABASE_ACCESS_TOKEN   2026-07-27T18:29:54Z
SUPABASE_PROJECT_ID     2026-07-27T18:30:03Z
```

Four entries, as the plan's contract predicted. Note what this does **not** prove: the API
can list secret _names_ but never values, so "the token in GitHub is the one that returned
200 above" is unverifiable from here. The first CI run of the `drift` job is what
establishes it — which is another reason the Phase 1 baseline had to be `IN SYNC`, since a
wrong secret and a real drift both present as one red job.

---

## Phase 2 — The comparator and its fixtures

**Date**: 2026-07-27

`scripts/schema-drift.ts` (pure: no filesystem, no network, no `console`) and
`tests/lib/schema-drift.test.ts`, 11 cases.

### Automated results

| Check                                           | Result                                                        |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `npx vitest run tests/lib/schema-drift.test.ts` | **11 passed**                                                 |
| `npm test`                                      | **177 passed / 177, 15 files** (166 before this change, + 11) |
| `npm run lint`                                  | exit **0**                                                    |

### Deliberate-breakage check — and its split does NOT match what the plan predicted

The plan's criterion read: invert the `missingLocal` direction and "confirm **exactly the
class-2 case** goes red while the positive control stays green".

Neutered `const missingLocal = …` to a constant `[]` — i.e. the cloud-has-it-locally-absent
direction, the `migration repair` desync this project actually suffered, reported as clean.
Observed: **2 of 11 red**, both on `AssertionError: expected [] to deeply equal
[ '20260601120000' ]`:

| Case                                                            | Verdict                                                                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `names a cloud migration with no local file, and only that`     | The class-2 case the plan named. **Evidence.**                                                                                                |
| `reports both directions at once, not whichever it finds first` | Also asserts `missingLocal`, so it goes red by construction. **Evidence too** — it is what keeps the two directions from collapsing into one. |

The prediction was simply arithmetic that did not account for the second case asserting the
same field; nothing about the comparator differs from the plan. Recorded as observed rather
than rounded to the predicted number, because a breakage split is a claim about a run —
test-plan.md §6.6 has been burned by stale ones twice.

What matters is what stayed green: the **positive control** (`reports clean when the two
sides agree`) and all eight other cases. Without that, every failure assertion in the file
would be satisfied by a comparator that rejects all input.

Reverted; `tests/lib/schema-drift.test.ts` back to **11 passed**. Note that `git diff --
scripts/schema-drift.ts` is _empty for the wrong reason_ at this point — the file is still
untracked, so a clean diff there proves nothing at all. The revert was confirmed by reading
the line back and by the suite returning to green.

---

## Phase 3 — The runner and the CI gate

**Date**: 2026-07-27

`scripts/check-schema-drift.ts` (I/O + exit code) and the `drift` job in
`.github/workflows/ci.yml`, plus `deploy`'s second dependency.

### Automated results

| Check                           | Result                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run lint`                  | exit **0**                                                                                                 |
| `npm test`                      | **177 passed / 177, 15 files** (unchanged — the runner has no test of its own; §6.9's boundary, see below) |
| Script against the real project | `10 local entries against 10 applied cloud migrations` → `OK`, exit **0**                                  |

The live run reproduces Phase 1's verdict exactly — ten against ten, `IN SYNC` — which is the
point of having measured the baseline first: the gate and the database are now separately
established, so the first red run after this lands has one hypothesis, not two.

**Which credential ran it, and what that does and does not prove.** The GitHub secret cannot
be read back (the API lists names, never values), so the local run used the _other_ PAT on
the same account — the one the Supabase CLI keeps in the Windows Credential Manager, read via
`CredRead` and injected straight into the environment, never printed. Phase 1 established
that this is a different token from the CI one. So this run proves **the script**: the
endpoint, the parse, the comparison, the exit code. It does **not** prove the secret stored in
GitHub is the working token — that is still established by the first `drift` job, exactly as
Phase 1 recorded.

### Fail-closed paths, each exercised

Every one of these exits **1** and prints `GATE UNAVAILABLE`, i.e. states in the report that
it is not evidence about the schema — the distinction the plan requires be visible in the
output and _not_ in the exit code.

| Path     | How it was reached                                             | Observed message                                                         |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| No token | both variables unset                                           | `SUPABASE_ACCESS_TOKEN is not set (the Supabase personal access token).` |
| No ref   | token set, ref unset                                           | `SUPABASE_PROJECT_ID is not set (the cloud project ref).`                |
| Non-2xx  | `SUPABASE_ACCESS_TOKEN=sbp_notarealtoken` against the real ref | `the Management API answered 401 Unauthorized`                           |

The two credential messages are deliberately separate rather than one shared "credentials
missing": a red build must name the secret to set, not send the reader to check both.

The `401` case is worth more than it looks. It is a **live** round trip — the request was
built, sent and rejected — so it is also the positive control for reachability behind the
happy path above, and it is what confirms the runner branches on `res.ok` having actually
issued a request.

**`res.ok`, never `status === 200`.** Phase 1 measured the two fallback endpoints answering
**201**; a runner written as an equality check on 200 would fail closed on a perfectly good
response the day it fell back to either. Implemented literally as `!response.ok`.

### Deliberate-breakage check — the drift verdict, locally

Two fabricated files were dropped into `supabase/migrations/` (never pushed anywhere, never
committed) and the script re-run against the real project:

- `20260728090000_fabricated_drift_check.sql` — a well-formed name the cloud has never seen
- `hotfix_by_hand.sql` — a `.sql` file carrying no version at all

Observed: `12 local entries against 10 applied cloud migrations`, exit **1**, and the report
split them into **two sections with different remedies** —

```
  Committed here, never applied in the cloud (1):
    20260728090000
  Fix: `supabase db push` (PROD tier …), then `gh run rerun --failed` …

  Unreadable migration filenames (1):
    hotfix_by_hand.sql
  Not a missing migration and `db push` cannot fix it: rename each file to …
```

That split is the finding worth recording. Both are drift-kind (the comparison _ran_), so
both correctly exit 1 — but folding the malformed filename in with the missing version would
have sent the reader to `db push` for something `db push` cannot repair. The comparator's
own doc comment predicts this; the runner is where it becomes visible to a human.

Both files removed; `git status -- supabase/` clean, directory back to ten entries, and the
script re-run to confirm the verdict returned to `OK` / exit 0. The re-run matters: a
breakage check that is not shown to reverse has only proved that _something_ changed.

### The rehearsal — and why the plan's own criterion 3.7 had to be strengthened to mean anything

The plan asked for one run: widen the `drift` job's `if` to this branch, push a fabricated
migration, and record that `drift` is **red** and `deploy` is **skipped**.

**That run would have been unfalsifiable, and it is worth saying why before the evidence.**
`deploy` carries its own guard, `github.ref == 'refs/heads/main'`. On a feature branch it is
skipped _whatever_ `drift` does — so "deploy was skipped" would have been produced by the
branch guard and read as produced by `needs`. That is precisely the shape §6.6 has recorded
twice (the four-policy neuter that passed while the guard was disabled; the status-filtered
count that was blind to the rows it claimed to check). A second obstacle sat in front of it:
`on.push.branches` is `[main]`, so a push to this branch does not trigger the workflow at all.

So the check was run as a **pair**, with a positive control, and `deploy`'s own guard widened
alongside `drift`'s so that the two runs differ in exactly one thing — the gate's outcome.
Temporary edits, all four reverted: `on.push.branches` widened; `drift.if` widened;
`deploy.if` widened; and `deploy`'s `cloudflare/wrangler-action` step replaced by
`echo "REHEARSAL-MARKER deploy job body reached"`. That last one is not a weakening of the
test — the claim under examination is the **job graph**, not wrangler — and it is what let the
control run prove reachability without shipping a feature branch to production.

| Run                                                                                          | Fabricated migration | `ci`    | `drift`           | `deploy`                     |
| -------------------------------------------------------------------------------------------- | -------------------- | ------- | ----------------- | ---------------------------- |
| **A — control** ([30296436636](https://github.com/lirdaw/10xcards/actions/runs/30296436636)) | no                   | success | **success** (9 s) | **success** — marker printed |
| **B** ([30296868813](https://github.com/lirdaw/10xcards/actions/runs/30296868813))           | yes                  | success | **failure** (7 s) | **skipped**                  |

Conclusions read from the API, not from the web UI's colours:
`gh run view … --json jobs` gives `drift conclusion=failure`, `deploy conclusion=skipped` for
run B, and `success` / `success` for run A. Same ref, same `if` on both jobs, same everything
else. The only variable is the gate's outcome — so the skip in run B is attributable to
`needs: [ci, drift]` and to nothing else. Run A alone is what buys that; without it the table
is one column of unfalsifiable green.

Run B's gate output, verbatim from the job log:

```
schema-drift: 11 local entries against 10 applied cloud migrations
DRIFT — the repository's migration history and the cloud database disagree.
    20260728090000
  Fix: `supabase db push` (PROD tier — run it yourself, from this branch's
##[error]Process completed with exit code 1.
```

**Run A closes an open question Phase 1 had to leave open.** Phase 1 recorded that the API can
list secret _names_ but never values, so "the token in GitHub is the one that returned 200"
was unverifiable from a developer machine and would be established by the first `drift` job.
It now has been: run A's `drift` reproduced `10 local entries against 10 applied cloud
migrations` from inside CI, using the GitHub secret and nothing else.

**No token material in either log.** Both `drift` job logs were downloaded in full and scanned:
zero hits for `sbp_`, zero for `bearer`, and zero for the project ref in clear. GitHub masks
registered secrets, but masking is not the guarantee being claimed here — the script never
puts the credential in a message in the first place, which is what makes the count zero rather
than `***`.

**The revert, verified rather than assumed.** A pristine copy of the intended `ci.yml` was
taken _before_ the first temporary edit and the file restored from it afterwards — `md5sum`
identical (`e369230e…`). The fabricated migration was deleted (`supabase/migrations/` back to
ten entries) and a tree-wide `grep` for `REHEARSAL` returns nothing outside this document. The
two rehearsal commits were then dropped (`git reset --mixed b387017` + force-push), so the
branch that reaches the PR carries neither the widened guards nor the fabricated file; the
runs above stay linkable as the evidence. Forgetting this revert would have shipped a gate
running on every branch, which is why the plan makes it a criterion of its own.

### What this does NOT prove, and it is a real boundary

- **No test in the suite touches this file.** `npm test` is unchanged at 177 because the
  runner has no unit test and deliberately gets none: every branch in it is I/O against a
  live cloud credential, which is exactly what `tests/setup/preflight.ts` exists to abort.
  The logic that _can_ be tested was pushed next door into `scripts/schema-drift.ts` and is
  covered there (11 cases). What is left here is carried by the runs recorded above and by
  the CI job itself.
- **The gate compares versions, never contents.** A migration amended in place after it was
  pushed leaves both lists identical and is invisible here by construction. That is drift
  class 4, and it belongs to Phase 5's DDL diff.
- **The `429` retry has not been exercised.** The endpoint defines the status; nothing here
  provoked it, and manufacturing one would mean hammering the real API. Carried by reading.

---

## Phase 4 — Adjacent CI corrections

**Date**: 2026-07-27

Two edits to `.github/workflows/ci.yml`: the phantom `env:` block removed from the build step,
and a generated-types step (drift class 8) added to the `ci` job directly after the stack starts.

### Automated results

| Check                                                                   | Result                 |
| ----------------------------------------------------------------------- | ---------------------- |
| `npm run db:types` then `git diff --exit-code src/db/database.types.ts` | exit **0**, empty diff |
| `npm run build` without the removed `env:` block                        | exit **0**             |
| CI green on the branch after both edits                                 | see "The PR run" below |

### 4.1's "freshly reset stack" was satisfied without a reset — and the substitute is stronger

The criterion asked for the check "against a freshly reset stack". A `supabase db reset` would
have destroyed the dev database a reviewer is likely mid-way through using — test-plan.md §6.7
makes exactly that point about breakage checks on this stack, and §6.6 records it holding ~1053
decks. The reset is in the criterion to rule out one thing: that the local database carries
schema objects the migrations do not create, which would make `gen types --local` generate from
something other than the migration history. In this project that is a live concern, not a
theoretical one — §6.6 records `create or replace function` neuters and a dropped CHECK
constraint performed against this very database.

So the question was answered directly instead:

```
npx supabase db diff --local --schema public
→ stdout: 0 bytes
→ stderr: "Applying migration …" ×10, then "No schema changes found"
```

`db diff --local` replays all ten migrations into a **separate shadow database** and diffs the
dev database against it. Zero-byte stdout means the dev `public` schema is identical to a fresh
replay, so the types generated from it are the types a freshly reset stack would produce and the
reset would have changed nothing but the data. The exit code was **0** — as it is on every
outcome, which is the always-exit-0 trap this plan's Current State Analysis records for
`db diff`. The verdict was read from stdout being empty, never from `$?`.

**Boundary**: `--schema public` was compared, while `database.types.ts` also carries a
`graphql_public` block. That block comes from the `pg_graphql` extension rather than from any
migration in this repository, and both databases run the same extension from the same pinned CLI
(2.98.2) — so it is identical by construction, not by measurement. Recorded because it is the
one part of the generated file this check did not compare.

### Deliberate-breakage check 4.4 — the criterion as worded does NOT go red

Criterion 4.4 reads: "hand-edit one line of `src/db/database.types.ts`, confirm the new step goes
red, revert." Run literally, **it stays green**. That deserves a paragraph, because a contributor
who follows the wording will conclude the gate does not work.

The step is two commands. `npm run db:types` **overwrites** the working-tree file, so a hand-edit
made before it is gone by the time the diff runs. And `git diff --exit-code <path>` compares the
working tree against the **index**, not against `HEAD`.

| Variant                                                                    | Where the stale line sat                                 | Step exit                                                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| As worded — `sed` line 39, `created_at: string` → `number`, nothing staged | working tree only                                        | **0 — green.** `db:types` restored the line before the diff ran              |
| Faithful — the same edit, then `git add`                                   | the index, which is what a commit looks like to the step | **1 — red**, printing the `-created_at: number` / `+created_at: string` hunk |

The faithful variant is what CI does: after `actions/checkout` the index equals `HEAD`, so the
step's real claim is "**regenerated ≠ committed**". That is the correct claim — it is precisely
the stale-types condition of drift class 8 — but it can only be provoked by bad content that is
_committed_, never by a dirty working tree. Phase 6 should carry this sentence somewhere durable;
the wording of 4.4 is a trap, not a defect in the step.

Restore verified rather than assumed: `git reset -- src/db/database.types.ts`, after which
`git status --porcelain` on the path is empty, a `diff` against a copy taken before the check is
**byte-identical**, and the step re-run returns to exit **0**. A breakage check not shown to
reverse has only proved that something changed.

### The PR run — 4.2 and 4.5

`on.push.branches` is `[main]`, so a push to this branch triggers nothing; the branch's CI run
comes from opening the pull request, which is how every prior change in this repo got one
(C10X-22, C10X-27, C10X-28 all show `pull_request` runs). `drift` carries
`if: github.event_name == 'push' && github.ref == 'refs/heads/main'` and is therefore **skipped**
on a pull request — so the run exercises the `ci` job, which is the only job this phase touched.

The run is not a formality. The local build above printed `Using secrets defined in .env`, so the
path this phase actually changed — a build with _no_ Supabase values present at all — is first
exercised on the runner, and the types step likewise first runs on Linux against a stack started
there from scratch.

**PR [#15](https://github.com/lirdaw/10xcards/pull/15), run
[30301025609](https://github.com/lirdaw/10xcards/actions/runs/30301025609)** — opened as a draft,
because phases 5 and 6 still have to land on this branch. Conclusions read from the API, not from
the web UI's colours:

```
gh run view 30301025609 --json jobs
→ ci: success    drift: skipped    deploy: skipped
```

`ci` succeeded in 3m39s, and the two `push`-guarded jobs skipped exactly as the plan's
skipped-job reasoning predicts on a pull request.

**4.2 — the new step, on the runner.** `Check generated types against the schema` ran in ~2.2 s:
`npm run db:types` regenerated the file and `git diff --exit-code` printed nothing. Three lines of
the log are worth keeping:

- `shell: /usr/bin/bash -e {0}` — `-e` is in force, so a failing `db:types` fails the step instead
  of falling through to the diff against a file the redirect has already truncated. That
  fail-closed property was reasoned about before the run; this is the line that confirms it.
- `currently installed v2.98.2` — the runner generates with the same lockfile-pinned CLI as the
  local check, so "clean locally" and "clean on Linux" are one generator agreeing with itself
  rather than two that happen to coincide.
- The step sits after `Start local Supabase stack` and before `Export local stack credentials`,
  which is what makes `--local` resolvable at all.

**4.5 — the build step references no secret.** The whole 1492-line log was scanned rather than the
build step eyeballed. `SUPABASE_URL` / `SUPABASE_KEY` appear exactly **four** times, all four on
the test path: twice in `Export local stack credentials` writing them into `$GITHUB_ENV`, twice in
`Run npm test` receiving `http://127.0.0.1:54321` and an `sb_publishable_…` key. The 26 log lines
belonging to `Run npm run build` contain no `env`, no `secret` and no masked `***` — the step
carries no `env:` block at all now, so there is nothing for GitHub to mask and nothing that reads
as configured while being empty.

And the removal's one real risk is now measured rather than argued: `npm run build` succeeded on
the runner with **no `.env` present**, which the local 4.3 run could not establish because it
printed `Using secrets defined in .env`.

---

## Phase 5 — On-demand DDL diff

**Date**: 2026-07-28

`.github/workflows/schema-diff.yml` (new): `workflow_dispatch` only, `npm ci`,
`supabase link`, `supabase db diff --linked --schema public`, verdict read from stdout.

### Most of this phase's verification is ship-time, and that is a structural fact, not a shortcut

The plan expected 5.1, 5.3 and 5.4 to be satisfied on this branch by dispatching the workflow
twice. They cannot be. **GitHub only offers `workflow_dispatch` for a workflow file that
exists on the DEFAULT branch** — "This event will only trigger a workflow run if the workflow
file exists on the default branch"
([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).
The default branch here is `main`; this work is on `C10X-29-schema-drift-test`.

This is why phases 3 and 4 could be rehearsed on the branch and this one cannot: `push` and
`pull_request` fire on any ref, `workflow_dispatch` does not. It is the same class as 5.5,
which the plan already routed to the ship-time checklist — the plan simply did not anticipate
that it swallows most of the phase.

**Measured rather than inferred from the doc sentence.** The file was pushed to a throwaway
ref (`tmp-workflow-registration-probe`) precisely to test whether a non-default branch is
enough:

| Probe                                                                   | Observed                                                                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `gh workflow list --all`                                                | `CI  active  307162826` — one row. The new workflow is **not registered at all**         |
| `gh api repos/:owner/:repo/actions/workflows`                           | one entry, `.github/workflows/ci.yml`. Same answer from the API, not just the CLI's view |
| `gh workflow run schema-diff.yml --ref tmp-workflow-registration-probe` | `HTTP 404: workflow schema-diff.yml not found on the default branch`                     |

So the third clause of criterion 5.2 ("appears in `gh workflow list`") is post-merge as well;
the other two clauses are satisfied below. The probe was reverted: the remote ref was deleted
(`git ls-remote --heads origin` back to `main` + `C10X-29-schema-drift-test`), the local
commit reset, and the file left untracked exactly as before.

**There is no honest workaround, which is worth stating so nobody invents one later.** Adding
a `push:` trigger to manufacture a run would change the trigger set whose _exclusivity is the
thing criterion 5.2 asserts_ — the check would then be verifying a file that no longer matches
the one shipping. Temporarily changing the repository's default branch to get a dispatch is
worse. Waiting for the merge is the correct answer.

### Automated results — what a static check can and did establish

| Check                                                           | Result                                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| YAML parses (`yaml` package, the one already in `node_modules`) | OK                                                                                            |
| Trigger set                                                     | `["workflow_dispatch"]` — length **1**                                                        |
| `schedule:` present                                             | **false** — criterion 5.2's substantive half, asserted programmatically rather than eyeballed |
| `bash -n` on all four `run` blocks                              | syntax OK on each                                                                             |
| Password guard, all three variables set                         | exit **0**                                                                                    |
| Password guard, `SUPABASE_DB_PASSWORD` empty                    | exit **1**, `Refusing to continue: without it the CLI mints a temporary READ-WRITE role…`     |
| Password guard, `SUPABASE_PROJECT_ID` empty                     | exit **1**, its own message                                                                   |

The guard's three-way probe matters more than it looks: a guard that fails on everything and a
guard that fails on the right thing are indistinguishable without the all-set control — the
same positive-control rule test-plan.md §6.6 applies to RLS denials.

### One step the plan's contract did not list, added deliberately

The plan says the password is "**required** rather than optional", and gives the reason: with
`SUPABASE_DB_PASSWORD` unset the CLI does not fail — it asks the Management API to mint a
temporary database role with `ReadOnly: false`, i.e. **creates a read-write role on production**
in order to run a read-only comparison. Nothing in "checkout, Node, `npm ci`, link, diff" makes
that requirement true; a missing secret would expand to the empty string and the run would
proceed. So `Require the database password` asserts all three secrets before anything touches
the project, and turns the omission into a red run naming the missing secret.

Two further fail-closed properties, both relying on the runner's default `bash -e`:

- `npx supabase db diff … > diff.sql` — if the CLI dies (Docker unavailable, link refused,
  wrong password) the step fails instead of leaving an empty `diff.sql` that the next line
  would read as "no differences". The redirect is the dangerous part here, and `-e` is what
  makes it safe.
- The verdict is `[ -s diff.sql ]`, **never `$?`**. `db diff` returns nil on every outcome and
  prints `No schema changes found` to _stderr_ — the same always-exit-0 trap that disqualified
  `migration list` as the history oracle, one command over.

### 5.5 is a claim about the job graph, so it does not have to wait for the merge

The plan files 5.5 ("`deploy` is confirmed **not** to depend on this workflow") as ship-time.
Its _substance_ is structural and was settled here by enumeration rather than by watching a
run:

| Question                                                              | Answer                                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Is there any `workflow_run` / `workflow_call` coupling in `.github/`? | **None** — `grep -rn` over the whole directory returns nothing, so no workflow can gate another |
| What does `deploy` depend on?                                         | `needs: [ci, drift]` — both jobs live in `ci.yml`                                               |
| What does `schema-diff.yml` contain?                                  | one trigger (`workflow_dispatch`), one job (`schema-diff`), referenced by nothing               |

A red DDL diff has no mechanism by which to block a release. That is stronger than the
observation the criterion asks for — it is a property of the graph, not a sample of its
behaviour — so what remains at ship time is only confirming it on the Actions page, which is
where a human will look anyway.

### `SUPABASE_DB_PASSWORD` does not exist yet, and it is not on this machine either

`gh secret list` still shows four entries (`CLOUDFLARE_*`, `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_PROJECT_ID`). Setting it is a human action carrying the production database
password, and it is a prerequisite for the first dispatch — recorded on the ship-time
checklist below rather than left to be discovered by a red run.

Where that password is **not**, checked rather than assumed, because the obvious guess is that
the CLI cached it during an earlier `db push`:

| Location                             | Contents                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Windows Credential Manager           | exactly one Supabase entry, `Supabase CLI:supabase` — the PAT Phase 1 identified, not a database password |
| `supabase/.temp/pooler-url`          | `postgresql://postgres.<ref>@…pooler.supabase.com:5432/postgres` — userinfo with **no** password segment  |
| `supabase/.temp/linked-project.json` | `ref`, `name`, `organization_id`, `organization_slug`                                                     |
| `.env`                               | `SUPABASE_URL/KEY` and `PROD_SUPABASE_URL/KEY` — the anon key, which is a different credential            |

So it comes from whoever holds the note taken at project creation (Supabase displays it once
and never again), or from a **Reset database password** in the dashboard. That reset is safe
for this project, and the reason is verifiable rather than reassuring: `astro.config.mjs`
declares four env fields (`SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_*`), and neither `src/`
nor `wrangler.jsonc` contains a Postgres connection string, pooler host or password — the
Worker reaches the database through PostgREST on the anon key. The database password is used
only by CLI tooling (`db push`, `db diff`), so rotating it cannot disturb the deployed app.
It would invalidate a connection string saved _outside_ this repository (a psql/pgAdmin
profile, another machine), which is the one thing this check cannot see.

### What this phase does NOT prove

- **Nothing here ran migra.** There is no calibration baseline yet; producing and triaging one
  is 5.3, at ship time. Until then, the first dispatch's output has nothing to be compared
  against and every line of it is untriaged by definition.
- **The whole `db diff --linked` path is unexercised** — link, Docker, shadow replay of ten
  migrations, the password. The checks above prove the file's _shape_ (triggers, syntax, the
  guard's branching), not that the comparison works. This is a thinner claim than phases 2-4
  made, and the gap is entirely the dispatch restriction above.
- **Phase 4's `db diff --local` run says nothing about this.** That compared the dev database
  against a shadow replay and returned empty stdout; the target here is the cloud project.
  Same command name, different oracle.

---

## Phase 6 — Documentation and the gate's stated boundary

**Date**: 2026-07-28

Five files: `context/foundation/test-plan.md` (six touch points), `context/foundation/lessons.md`
(one entry), `.claude/skills/ship/SKILL.md` (three edits, **local-only — `.claude/` is
gitignored**), `README.md` (CI section rewritten), `AGENTS.md` (one line).

### Automated results

| Check                                                                 | Result                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every path referenced by the new `test-plan.md` text resolves on disk | **10 of 10 OK** — `scripts/schema-drift.ts`, `scripts/check-schema-drift.ts`, `tests/lib/schema-drift.test.ts`, both workflow files, `src/db/database.types.ts`, `tests/setup/preflight.ts`, `supabase/config.toml`, and this change's `verification.md` + `research.md` |
| `npx prettier --check` on all four tracked edited files               | `All matched files use Prettier code style!`                                                                                                                                                                                                                             |
| `npm run lint`                                                        | exit **0**                                                                                                                                                                                                                                                               |
| `npm test`                                                            | **177 passed / 177, 15 files** — unchanged, as a docs-only phase must be                                                                                                                                                                                                 |

**No `file:line` anchor was added, deliberately.** Criterion 6.1 asks that every one resolve;
the cheapest way to satisfy it permanently is not to create any. This file's own §8 records
that C10X-28 had to repair three rotted pointers, and the S-05 Stryker range had drifted two
hours after it was written. So the new text names **paths and symbols** — `scripts/schema-drift.ts`,
the `drift` job, `deploy`'s `needs`, the `lessons.md` entry by its title — and never a line
number. The paths were still checked rather than assumed, which is the table row above.

### What the six touch points say, and the one thing they were written to prevent

- **§2, Risk #5's row** — covered **per class, not as one range**. Writing "classes 4-9 are
  not covered" would have been false for four of the six by this change's own doing. Each
  class is named in words (a migration committed but never pushed; a `repair` desync; an
  out-of-order version skipped; a file amended after being pushed; a hand edit in Studio;
  `repair --status applied` on something never applied; stale generated types; config drift;
  seed-row drift), because `test-plan.md` is read without this change folder beside it and a
  bare number would be unresolvable.
- **§3, Phase 3's row** — `not started` → `complete`, folder filled in, plus a sequencing note
  recording that the gate is a **history oracle by deliberate choice**: the incident behind
  the risk left the schema byte-identical, so a DDL diff could not have seen it.
- **§5** — the drift row moves to wired; a generated-types row is added (Phase 4 wired it);
  the DDL diff is added as **optional, human-triggered**, with the no-schedule reasoning
  attached so §5 cannot be read as implying a signal someone watches. A closing paragraph
  states the deploy-path consequence: two gates now depend on a cloud credential, and every
  fail-closed path exits 1 by design.
- **§6.6** — a new per-phase entry in the shape the existing ones use: a claim table, the
  breakage checks **with their observed splits** (including the two that contradicted the
  plan's predictions), and a "what this does NOT prove" list that is a range _about the gate_
  and cross-references §2's per-class row so the two cannot be read as contradicting.
- **§6.1** — one clarifying sentence: `tests/` mirrors what it tests, and where the subject is
  CI tooling under `scripts/`, its test still sits in `tests/lib/`. Without it the next
  contributor reads `tests/lib/schema-drift.test.ts` as a convention break.
- **§8** — a dated freshness entry recording the suite state, that the baseline was measured
  _before_ the gate was wired, that two of the plan's predictions were wrong and are recorded
  as observed, and that the ship-time items below are open rather than silently done.

The accuracy risk this phase exists to avoid is the opposite of under-claiming: **Risk #5 must
not read as fully closed**. Three classes are invisible to the gate by construction and two
have no check at all, and the DDL diff that covers the first three has itself never been run
end-to-end. All of that is stated in §2, §6.6 and §8 rather than left to be inferred.

### `lessons.md` — one entry, readable standing alone

"Komenda, która ZAWSZE kończy się kodem 0, nie jest bramką". The most portable finding here:
`supabase migration list` and `db diff` both always exit 0, so a gate written from the docs
would have looked correct and enforced nothing. The rule has two halves as the plan required —
measure the exit code in **both** directions against the lockfile-pinned version before
building on it, and assert the **positive** string rather than the absence of a negative one,
so an upstream wording change fails closed. It names no file in this change folder and needs
none.

### `ship/SKILL.md` is gitignored, and that is deliberate

`.gitignore` carries `.claude/`, so all three edits (the Step 0 heuristic note, the ordering
rule now being _enforced_, and the new "the drift gate went red — now what" block naming both
report kinds and the outage escape) are **local and untracked**: they persist on this machine
and reach neither the repository nor a fresh clone. Not "fixed" — un-ignoring `.claude/` is
out of scope and no phase here touches `.gitignore`. The durable, shared record of the same
two facts is `README.md`'s CI section (which restates the recovery procedure for exactly this
reason), `AGENTS.md`'s one line, and `test-plan.md`.

`README.md`'s CI section was wrong in three independent ways before this: it named `master`
where the workflow targets `main`, it instructed the reader to configure `SUPABASE_URL` /
`SUPABASE_KEY` as repository secrets (Phase 4 removed the step that would have read them —
and adding them is now actively wrong), and it did not mention the gate at all.

### The three manual checks — and two of them found something

They were run against the files as they stood **after** Prettier had reformatted them, not
against what had just been typed, because the check is on the shipped text.

**6.4 — §3 Phase 3's row and §2's Risk #5 row agree. PASS.** Both partition the same nine
classes the same way, and neither is a superset of the other: §3's Risks-covered cell reads
"#5 (**covered** — the deploy-blocking classes and the stale generated types)", which is
exactly §2's "gated in CI and deploy-blocking" set plus its "gated in the `ci` job" one, and
claims nothing about the four §2 marks as off-the-deploy-path or uncovered. The
cross-references run **both** ways — §2 sends the reader to §6.6 before citing the risk as
closed; §3's sequencing note names §2 as the per-class split and §6.6 as the mechanism — so a
future edit to one has a visible obligation to the others.

**6.5 — the "what this does NOT prove" list. FIXED DURING THE CHECK, then PASS.** Reading it
against the criterion rather than against my memory of writing it turned up a real gap: the
list named classes 4, 5, 6, 7 and 9 explicitly, and for **8** it only said "the generated-types
gate is about committed content only". That is a boundary on the _other_ check, not a statement
about this gate — and the criterion asks for 4-9. A reader could have finished the list still
assuming the `drift` job somehow covers types. The bullet was rewritten to say plainly that the
`drift` job never reads `src/db/database.types.ts`, that class 8 is closed by a **separate step
in a different job with a different trigger**, and that the two checks are independent so
neither backs up the other. The second clause of the criterion held throughout: the list's very
first bullet is "No test in this suite touches the cloud, and none ever will", ending "Do not
read 'Phase 3 complete' as 'the suite tests the Management API'".

**6.6 — the `lessons.md` entry stands alone. FIXED DURING THE CHECK, then PASS.** It names no
file in this change folder and needs none; read cold it is about `supabase migration list` and
`db diff` and the general rule. But one detail read wrong: the Rule offered
`Remote database is up to date.` as the positive string to assert without saying **whose**
string it is — it belongs to `db push --dry-run`, a third command, not to either of the two the
entry opens with. Someone copying it against `migration list` would have grepped for a string
that command never prints, and got a gate that is red forever instead of green forever. Now
attributed, with the reason `db push --dry-run` needs the grep at all: it exits **0** in the
ordinary "committed but never pushed" case.

Re-verified after both edits: `prettier --check` clean on all five files, `npm run lint` exit
**0**, `npm test` **177 passed / 177, 15 files**.

The finding worth carrying past this change: **a self-review of documentation is not a formality
when the criterion is about accuracy.** Two of three checks changed the text, and neither defect
was a typo — one was an incomplete enumeration that read as complete, the other an unattributed
constant that would have failed in the opposite direction from the one the reader expected.

---

## Impl-review — fixes applied after Phase 6

**Date**: 2026-07-28. Report: `reviews/impl-review.md`.

The per-phase sections above are **left exactly as they were**: each records what was true when
that phase closed, and `177 passed / 177` was true then. Rewriting them to today's number would
destroy the dated record this file exists to keep. The current figure is **178 / 178, 15 files**,
and this section is where that came from.

The review confirmed every plan contract as met and every automated criterion as green — and
then found one thing that no criterion had asked about.

### The finding that mattered: the gate returned a false green

Probing the comparator with an input the fixtures never covered:

```
local: ["20260705180246_a.sql","20260705180246_b.sql"], remote: ["20260705180246"]
→ {"clean":true,"missingRemote":[],"missingLocal":[],"unparseable":[]}
```

`schema_migrations.version` is the cloud's key, so two files claiming one timestamp means **at
most one of them can ever be recorded as applied** — the other is committed and never applied.
That is drift class 1, reported as OK by the gate built to catch precisely it.

The cause is worth carrying past this change: the `Set` that makes the comparison correctly
**order-blind** — load-bearing, because this repository carries a real out-of-order pair — is
the very same thing that makes it **collision-blind**. One line is both the design property and
the defect. Reachable by a copy-paste, or by two `supabase migration new` calls inside one
second; this repo already holds a pair 10 seconds apart.

**Fix**: a `duplicate: string[]` on `DriftVerdict`, recorded _before_ the `Set.add` that would
swallow it, folded into `clean`, with its own section in `reportDrift` whose remedy is a rename
— because `db push` cannot repair a filename collision. Plus a twelfth fixture.

**Verified in both directions**, which is the point:

| Check                                                 | Result                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The collision case                                    | `clean:false`, `duplicate:["20260705180246"]`, both set differences empty — so it is not misreported as a missing migration |
| The out-of-order pair (the case the `Set` exists for) | still `clean:true` — the fix is additive, not a redesign                                                                    |
| `npx vitest run tests/lib/schema-drift.test.ts`       | 11 → **12 passed**                                                                                                          |

### Three hardening fixes in the same pass

| Finding                        | Change                                                                       | Why it was not cosmetic                                                                                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F6** remote side unvalidated | versions `.trim()`ed and held to `/^\d{14}$/`, else `GATE UNAVAILABLE`       | Measured: `"20260705180246 "` printed the _same_ migration in `missingRemote` **and** `missingLocal` as two visually identical entries — sending the reader to `db push` and the `repair` runbook simultaneously. `""` printed a blank bullet. Fail-closed in direction, worst-possible in report |
| **F6** `.sql` case-sensitive   | extension matched case-insensitively while `MIGRATION_FILENAME` stays strict | `_x.SQL` was measured `clean:true` — neither compared nor reported. It now lands in `unparseable` with the rename remedy. The asymmetry is deliberate: the CLI's glob is lowercase so such a file would never be pushed either                                                                    |
| **F6** `readdirSync` untyped   | `withFileTypes: true` + `isFile()`                                           | A directory named `<14 digits>_x.sql` would have counted as a migration                                                                                                                                                                                                                           |
| **F5** no request timeout      | `AbortSignal.timeout(15_000)`                                                | The only bound was undici's 300 s default — the failure _direction_ was always right (abort → `GATE UNAVAILABLE`, exit 1), but the number belonged to a dependency, in a job whose premise is ~10 s                                                                                               |

### The DDL workflow: the production password no longer shares an environment with `npm ci`

`SUPABASE_DB_PASSWORD` sat in **job-level** `env:`, so it was readable by every install
lifecycle script in the dependency tree when `npm ci` ran — and by `actions/checkout` and
`actions/setup-node`. The repository is **PUBLIC** (`gh repo view` → `"visibility":"PUBLIC"`).
Exposure to date is nil, because the secret has never been set and the workflow has never run,
which is exactly why this was cheap to fix now and had to be fixed **before** the ship-time
`gh secret set`.

All three secrets moved to **step-level** `env:` on the three steps that need them, all of
which run after `npm ci`. Verified by parsing the YAML rather than by eye:

```
triggers: ["workflow_dispatch"]        ← criterion 5.2 intact
job-level env: null
 step actions/checkout@v7                | env: -
 step actions/setup-node@v6              | env: -
 step npm ci                             | env: -      ← the point
 step Require the database password      | env: TOKEN,PROJECT_ID,DB_PASSWORD
 step Link the cloud project             | env: TOKEN,PROJECT_ID,DB_PASSWORD
 step Diff the deployed schema …         | env: TOKEN,PROJECT_ID,DB_PASSWORD
 step Upload the diff for triage         | env: -
```

Note the contrast that is _not_ a defect: `ci.yml`'s `drift` job keeps its job-level `env:`,
because it deliberately runs no `npm ci` and only first-party steps. Same reasoning, different
answer.

**And the diff body no longer goes to a public log.** `cat diff.sql` published the
production-vs-migrations DDL delta — by definition the DDL that is _not_ in the public
`supabase/migrations/`, i.e. the part nobody reviewed — into a world-readable Actions log. The
step now prints the verdict and a line count and uploads the body as an artifact
(`actions/upload-artifact@v7`, `if: failure()`, 7-day retention). Two things stated rather than
glossed: artifacts on a public repo are downloadable too, so this **narrows** the exposure
rather than removing it (the honest fix would be a private repository); and the upload cannot
rescue the job, because the diff step has already exited 1 by the time it runs.

`@v7` was checked against the API, not assumed — `upload-artifact`'s latest is `v7.0.1`, so the
reflexive `@v4` would have been three majors stale.

### Documentation, and two smaller items

`AGENTS.md` gained a Hard-Rules line recording the `scripts/` carve-out. The change introduced
two standing exceptions — `process.env` instead of `astro:env/server`, and the only
deep-relative import in `tests/` — each explained at its own call site but neither sanctioned
where an agent reads the rules. `lessons.md`'s new entry was moved to the **end** of the file,
which calls itself an append-only register. The test's import gained the `.ts` extension so it
reads the same way as the runner's.

One review claim was checked and **not** carried: the suggestion that the test file's
`test-plan.md §6.1` pointer was stale is wrong — the mirroring clarification is in §6.1.
Another, that `supabase link` may bootstrap `supabase_migrations` on the remote, could not be
confirmed against the pinned CLI (the npm package is a binary downloader), so the workflow
header was **softened** rather than made to assert an unverified behaviour.

### State after the review

`npm run lint` exit **0**, `npx prettier --check` clean on every edited file, `npm test`
**178 passed / 178, 15 files**, and both fail-closed paths re-measured with real exit codes
(`no-token EXIT=1`, `no-ref EXIT=1`, each with its own message). `F4` was **accepted, not
fixed**: Phase 5's ship-time checklist below already carries the mechanism, and the reviewer's
concern was follow-through rather than a defect.

---

## Ship-time checklist

These criteria cannot be satisfied before the merge. They are tracked here so they are
neither blocking a phase gate nor quietly forgotten.

**Closing the loop — do not skip this, it is the step that gets forgotten.** Ticking a box
below is only half of it. `plan.md`'s `## Progress` still carries **5.1, 5.2, 5.3, 5.4** and
**3.9, 5.5** as `- [ ]`, deliberately: at the time each phase committed, those criteria were
genuinely unverified, and marking them done in advance is the dated-claim failure this
project keeps correcting. So whoever performs the checklist below must, in the same sitting:

1. tick the box here **and record what was observed** — a run id, the triaged diff, the
   Actions-page screenshot's content — because a bare `[x]` is an assertion with no evidence;
2. flip the matching row in `plan.md`'s `## Progress` to `- [x]`, appending the SHA of the
   commit that carries this update (the same ritual every phase used);
3. only then hand the change to `/10x-archive`.

If this is skipped, `/10x-archive` surfaces the rows as warnings and the change archives with
Phase 5 reading as unverified — which would be an accurate record of a job left half done,
not a bookkeeping glitch to wave through.

**One of these is not really pending.** 5.5's substance is already settled structurally (see
Phase 5 above); what remains is an eyeball confirmation on the Actions page. It is kept on the
list rather than pre-ticked because the criterion as written asks for the observation.

**Prerequisite for everything under Phase 5**: `gh secret set SUPABASE_DB_PASSWORD` (the
production database password). Without it the DDL-diff workflow fails closed at its guard
step — by design, but it means no dispatch can succeed until it is set. The password is not
cached anywhere on the development machine (see Phase 5 above for where it was looked for);
it comes from the note taken at project creation, or from a dashboard reset, which is safe
here for the reason recorded there.

- [x] **3.9** After merging, a real push to `main` shows `drift` green and `deploy` running as
      before, with `deploy` listing both dependencies on the Actions page
- [x] **5.1** A `workflow_dispatch` run completes; then a **second** dispatch, run after the
      first one's output has been triaged and recorded, matches that baseline
- [x] **5.2 (third clause only)** `schema-diff` appears in `gh workflow list`. The YAML-validity
      and only-`workflow_dispatch` clauses are already established above
- [x] **5.3** The first run's full output is triaged into genuine drift vs migra noise
      (extensions, grants) and recorded here as the baseline
- [x] **5.4** Deliberate-breakage check: dispatch once from a branch carrying a scratch
      migration that adds a column, confirm the job reports a difference; revert
- [x] **5.5 (observation only)** `deploy` is confirmed **not** to depend on the DDL-diff
      workflow on the Actions page. The structural half is already established above — no
      `workflow_run` coupling exists and `deploy`'s `needs` is `[ci, drift]` — so this is a
      confirmation, not an open question

---

## Ship — the merge, and the criteria that could only run after it

**Date**: 2026-07-28. Merge commit **`f7a83c0`** (PR #15, `--merge`, phase commits preserved).
`SUPABASE_DB_PASSWORD` was set by the dev at 14:48Z, before the merge.

The whole of Phase 5 was blocked on the merge for the reason Phase 5 measured rather than
assumed — `workflow_dispatch` is offered only for a workflow file already on the default
branch. This section records what that unblocked.

### 3.9 — the gate on the real path, first time

Run [30379662871](https://github.com/lirdaw/10xcards/actions/runs/30379662871), `push` to
`main`: `ci` **success** (3m18s) → `drift` **success** (**5s**) → `deploy` **success**.
Conclusions read from `gh run view --json jobs`. The gate's own output, verbatim:

```
schema-drift: 10 local entries against 10 applied cloud migrations
schema-drift: OK — every migration in this repository is applied in the cloud.
```

The comparison itself took ~1s; the plan budgeted ~10s for the job and it came in at 5. The
GitHub secret is now proven twice over — once by the pre-merge rehearsal, once here.

**No credential material in the log**, measured rather than trusted: the 180-line `drift` job
log has **zero** hits for `sbp_`, zero for `bearer`, and zero for the project ref in clear.
GitHub renders both as `***`, but the count is zero because the script never puts them in a
message.

### 5.2 — registration, and the before/after that makes it evidence

Checked **before** the merge: `gh workflow list --all` returned one row (`CI`), and the API
agreed. Checked **after**: `Schema diff  .github/workflows/schema-diff.yml  active`, id
**322349050**. The pre-merge check is what turns this from a fact into evidence — it is the
same before/after discipline the rest of this file uses.

The file **as merged onto `main`** was re-parsed rather than trusted from the branch:
triggers `["workflow_dispatch"]`, `schedule` absent, job-level `env` **null**, and the three
secrets scoped to the three steps that run after `npm ci`. So the first dispatch ran the
version carrying the impl-review's F2 fix — there was never a window in which the production
password could reach `npm ci`.

### 5.1 + 5.3 — two dispatches, and a baseline with nothing in it

| Run                                                                                               | Result                                                                                         |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [30380427876](https://github.com/lirdaw/10xcards/actions/runs/30380427876) — first ever           | **success**; `Upload the diff for triage` **skipped** (`if: failure()`), i.e. `diff.sql` empty |
| [30380687338](https://github.com/lirdaw/10xcards/actions/runs/30380687338) — second, after triage | **success**; upload skipped; output identical to the first                                     |

Both printed, from the CLI and then from the job:

```
Finished supabase db diff on branch main.

No schema changes found
No difference between the deployed schema and a replay of the migrations.
```

**5.3's triage is the short kind: the baseline is EMPTY.** Zero genuine drift and — contrary
to what the plan expected — **zero migra noise**. The plan warned that "migra reports false
positives on extensions and grants and an uncalibrated first run will look like drift"; on
this project it does not, so there is nothing to separate and no filter to write. Recorded as
observed, because the next contributor will otherwise go looking for a noise filter that was
never needed. If a future run is non-empty, **every** line is a candidate for real drift.

The run also demonstrates the trap `lessons.md` was written from, live: `No schema changes
found` arrives on **stderr** while the CLI exits 0 regardless, and the job's verdict comes
from `[ -s diff.sql ]`. CLI on the runner: **v2.98.2**, the lockfile-pinned version (it
advertises v2.110.0 as available; the pin is what makes these results reproducible).

### 5.4 — NOT satisfied as written, and the substitute is weaker on purpose

The criterion asks for a dispatch from a branch carrying a scratch migration. **That was not
done** — by an explicit decision to avoid pushing a scratch branch. The substitute ran the
same probe against the **local** oracle:

| Step                                                                                         | Observed                                                                    |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Control, before the probe                                                                    | `db diff --local --schema public` → stdout **0 bytes**, exit **0**          |
| With `20260728170000_ship_probe_tmp.sql` (`alter table deck add column ship_probe_tmp text`) | `diff.sql` **non-empty**, and the workflow's own verdict logic exited **1** |
| The diff body                                                                                | `alter table "public"."deck" drop column "ship_probe_tmp";`                 |
| After removing the probe file                                                                | verdict back to "no difference", exit **0**, `git status` clean             |

Note the direction, because it reads backwards at first: migra emits the SQL that would make
the **replay** match the **target**, so a column present in the replay and absent from the
target surfaces as a `drop`. Against the cloud it would be the same shape. The gate keys on
non-emptiness, not on the statement.

**What this proves**: migra detects the difference, and the workflow's `[ -s diff.sql ]`
gating turns it into a red step — with a positive control on both sides of the probe, so the
red is attributable to the migration and the green to its removal. **What it does not
prove**: the `--linked` path, the production round trip, the password, and the artifact
upload on failure are all still unexercised. The upload step has now been _skipped_ twice and
never _run_. Anyone who needs 5.4 closed properly still owes the branch dispatch.

### 5.4 — closed properly, the same day

The branch dispatch the paragraph above says was owed **was then performed**, so 5.4 is
satisfied as written rather than by substitute. Branch `tmp-schema-diff-probe` off `main`,
carrying one file — `20260728190000_ship_probe_tmp.sql`, `alter table deck add column
ship_probe_tmp text;` — and nothing else. No `db push` at any point: the difference exists
because the shadow replay has the column and production does not.

Run [30381750723](https://github.com/lirdaw/10xcards/actions/runs/30381750723),
`headBranch: tmp-schema-diff-probe`:

| Step                                              | Conclusion                                                     |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `Require the database password`                   | success                                                        |
| `Link the cloud project`                          | success                                                        |
| `Diff the deployed schema against the migrations` | **failure**                                                    |
| `Upload the diff for triage`                      | **success** — first execution ever; skipped on both green runs |
| Job                                               | **failure**                                                    |

Log:

```
The deployed schema differs from a replay of supabase/migrations/.
4 lines of DDL; the body is in the 'schema-diff' artifact.
Triage it against the calibrated baseline in …
```

Artifact `schema-diff`, downloaded and read:

```sql
alter table "public"."deck" drop column "ship_probe_tmp";
```

**Three things this closes that the local substitute could not.**

- The **`--linked` path end to end** — link, the production round trip, the password, migra
  against the real deployed schema. Everything the two green runs exercised, now with a red
  outcome to compare against.
- **The upload path**, which had been skipped twice and never run. `if: failure()` fires, the
  artifact exists, and its content is the diff.
- **The impl-review's F3 fix, empirically.** The diff body is in the artifact and **not in the
  log** — the log carries only the line count. Until this run that was a design claim; it is
  now a measurement. On a public repository that is the difference between a stated intention
  and a verified one.

**Paired, so the red means something.** Same workflow file, same secrets, same production
project; the two `main` dispatches are the green control and this is the red case, and the one
variable between them is the scratch migration. A red run on its own would not have been
evidence — that is the trap this file records three times over.

**Reverted, and the revert verified**: remote branch deleted (`git ls-remote --heads origin`
back to `main` plus the merged feature branch), local branch deleted,
`supabase/migrations/` back to **10** files, `git status` clean.
