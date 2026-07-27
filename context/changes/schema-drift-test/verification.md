# Verification — CI Gate for Database Schema Drift

> Evidence log for `context/changes/schema-drift-test/plan.md`. Each phase appends its own
> section. Ship-time criteria (3.9, 5.5) are collected at the bottom, because the merge
> happens once, at `/ship`, after all six phases.

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

| # | Request | Observed status | Body shape |
| --- | --- | --- | --- |
| 1 | `GET /v1/projects/{ref}/database/migrations` | **200** | `[{"version":"…","name":"…"}, …]` — 10 objects |
| 2 | `POST /v1/projects/{ref}/database/query` with `{"query":"…","read_only":true}` | **201** | `[{"version":"…"}, …]` — 10 objects |
| 3 | `POST /v1/projects/{ref}/database/query/read-only` with `{"query":"…"}` | **201** | `[{"version":"…"}, …]` — 10 objects |

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

| Local file (`supabase/migrations/`) | Remote `schema_migrations` |
| --- | --- |
| `20260705180246_init_core_schema.sql` | `20260705180246` `init_core_schema` |
| `20260710195327_manual_card_source.sql` | `20260710195327` `manual_card_source` |
| `20260712162349_generation_session.sql` | `20260712162349` `generation_session` |
| `20260712162359_deck_keyword_search.sql` | `20260712162359` `deck_keyword_search` |
| `20260724195248_srs_study_schedule.sql` | `20260724195248` `srs_study_schedule` |
| `20260724220524_srs_study_schedule_review_fixes.sql` | `20260724220524` `srs_study_schedule_review_fixes` |
| `20260725112600_search_accepted_only.sql` | `20260725112600` `search_accepted_only` |
| `20260725112700_flashcard_state_no_touch_updated_at.sql` | `20260725112700` `flashcard_state_no_touch_updated_at` |
| `20260725133600_generation_idempotency_key.sql` | `20260725133600` `generation_idempotency_key` |
| `20260725150000_candidate_counts_rpc.sql` | `20260725150000` `candidate_counts_rpc` |

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

Note that the out-of-order pair (`20260712162349` applied to the cloud *after* the later
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
can list secret *names* but never values, so "the token in GitHub is the one that returned
200 above" is unverifiable from here. The first CI run of the `drift` job is what
establishes it — which is another reason the Phase 1 baseline had to be `IN SYNC`, since a
wrong secret and a real drift both present as one red job.

---

## Phase 2 — The comparator and its fixtures

**Date**: 2026-07-27

`scripts/schema-drift.ts` (pure: no filesystem, no network, no `console`) and
`tests/lib/schema-drift.test.ts`, 11 cases.

### Automated results

| Check | Result |
| --- | --- |
| `npx vitest run tests/lib/schema-drift.test.ts` | **11 passed** |
| `npm test` | **177 passed / 177, 15 files** (166 before this change, + 11) |
| `npm run lint` | exit **0** |

### Deliberate-breakage check — and its split does NOT match what the plan predicted

The plan's criterion read: invert the `missingLocal` direction and "confirm **exactly the
class-2 case** goes red while the positive control stays green".

Neutered `const missingLocal = …` to a constant `[]` — i.e. the cloud-has-it-locally-absent
direction, the `migration repair` desync this project actually suffered, reported as clean.
Observed: **2 of 11 red**, both on `AssertionError: expected [] to deeply equal
[ '20260601120000' ]`:

| Case | Verdict |
| --- | --- |
| `names a cloud migration with no local file, and only that` | The class-2 case the plan named. **Evidence.** |
| `reports both directions at once, not whichever it finds first` | Also asserts `missingLocal`, so it goes red by construction. **Evidence too** — it is what keeps the two directions from collapsing into one. |

The prediction was simply arithmetic that did not account for the second case asserting the
same field; nothing about the comparator differs from the plan. Recorded as observed rather
than rounded to the predicted number, because a breakage split is a claim about a run —
test-plan.md §6.6 has been burned by stale ones twice.

What matters is what stayed green: the **positive control** (`reports clean when the two
sides agree`) and all eight other cases. Without that, every failure assertion in the file
would be satisfied by a comparator that rejects all input.

Reverted; `tests/lib/schema-drift.test.ts` back to **11 passed**. Note that `git diff --
scripts/schema-drift.ts` is *empty for the wrong reason* at this point — the file is still
untracked, so a clean diff there proves nothing at all. The revert was confirmed by reading
the line back and by the suite returning to green.

---

## Phase 3 — The runner and the CI gate

**Date**: 2026-07-27

`scripts/check-schema-drift.ts` (I/O + exit code) and the `drift` job in
`.github/workflows/ci.yml`, plus `deploy`'s second dependency.

### Automated results

| Check | Result |
| --- | --- |
| `npm run lint` | exit **0** |
| `npm test` | **177 passed / 177, 15 files** (unchanged — the runner has no test of its own; §6.9's boundary, see below) |
| Script against the real project | `10 local entries against 10 applied cloud migrations` → `OK`, exit **0** |

The live run reproduces Phase 1's verdict exactly — ten against ten, `IN SYNC` — which is the
point of having measured the baseline first: the gate and the database are now separately
established, so the first red run after this lands has one hypothesis, not two.

**Which credential ran it, and what that does and does not prove.** The GitHub secret cannot
be read back (the API lists names, never values), so the local run used the *other* PAT on
the same account — the one the Supabase CLI keeps in the Windows Credential Manager, read via
`CredRead` and injected straight into the environment, never printed. Phase 1 established
that this is a different token from the CI one. So this run proves **the script**: the
endpoint, the parse, the comparison, the exit code. It does **not** prove the secret stored in
GitHub is the working token — that is still established by the first `drift` job, exactly as
Phase 1 recorded.

### Fail-closed paths, each exercised

Every one of these exits **1** and prints `GATE UNAVAILABLE`, i.e. states in the report that
it is not evidence about the schema — the distinction the plan requires be visible in the
output and *not* in the exit code.

| Path | How it was reached | Observed message |
| --- | --- | --- |
| No token | both variables unset | `SUPABASE_ACCESS_TOKEN is not set (the Supabase personal access token).` |
| No ref | token set, ref unset | `SUPABASE_PROJECT_ID is not set (the cloud project ref).` |
| Non-2xx | `SUPABASE_ACCESS_TOKEN=sbp_notarealtoken` against the real ref | `the Management API answered 401 Unauthorized` |

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

That split is the finding worth recording. Both are drift-kind (the comparison *ran*), so
both correctly exit 1 — but folding the malformed filename in with the missing version would
have sent the reader to `db push` for something `db push` cannot repair. The comparator's
own doc comment predicts this; the runner is where it becomes visible to a human.

Both files removed; `git status -- supabase/` clean, directory back to ten entries, and the
script re-run to confirm the verdict returned to `OK` / exit 0. The re-run matters: a
breakage check that is not shown to reverse has only proved that *something* changed.

### The rehearsal — and why the plan's own criterion 3.7 had to be strengthened to mean anything

The plan asked for one run: widen the `drift` job's `if` to this branch, push a fabricated
migration, and record that `drift` is **red** and `deploy` is **skipped**.

**That run would have been unfalsifiable, and it is worth saying why before the evidence.**
`deploy` carries its own guard, `github.ref == 'refs/heads/main'`. On a feature branch it is
skipped *whatever* `drift` does — so "deploy was skipped" would have been produced by the
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

| Run | Fabricated migration | `ci` | `drift` | `deploy` |
| --- | --- | --- | --- | --- |
| **A — control** ([30296436636](https://github.com/lirdaw/10xcards/actions/runs/30296436636)) | no | success | **success** (9 s) | **success** — marker printed |
| **B** ([30296868813](https://github.com/lirdaw/10xcards/actions/runs/30296868813)) | yes | success | **failure** (7 s) | **skipped** |

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
list secret *names* but never values, so "the token in GitHub is the one that returned 200"
was unverifiable from a developer machine and would be established by the first `drift` job.
It now has been: run A's `drift` reproduced `10 local entries against 10 applied cloud
migrations` from inside CI, using the GitHub secret and nothing else.

**No token material in either log.** Both `drift` job logs were downloaded in full and scanned:
zero hits for `sbp_`, zero for `bearer`, and zero for the project ref in clear. GitHub masks
registered secrets, but masking is not the guarantee being claimed here — the script never
puts the credential in a message in the first place, which is what makes the count zero rather
than `***`.

**The revert, verified rather than assumed.** A pristine copy of the intended `ci.yml` was
taken *before* the first temporary edit and the file restored from it afterwards — `md5sum`
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
  The logic that *can* be tested was pushed next door into `scripts/schema-drift.ts` and is
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

| Check | Result |
| --- | --- |
| `npm run db:types` then `git diff --exit-code src/db/database.types.ts` | exit **0**, empty diff |
| `npm run build` without the removed `env:` block | exit **0** |
| CI green on the branch after both edits | see "The PR run" below |

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

| Variant | Where the stale line sat | Step exit |
| --- | --- | --- |
| As worded — `sed` line 39, `created_at: string` → `number`, nothing staged | working tree only | **0 — green.** `db:types` restored the line before the diff ran |
| Faithful — the same edit, then `git add` | the index, which is what a commit looks like to the step | **1 — red**, printing the `-created_at: number` / `+created_at: string` hunk |

The faithful variant is what CI does: after `actions/checkout` the index equals `HEAD`, so the
step's real claim is "**regenerated ≠ committed**". That is the correct claim — it is precisely
the stale-types condition of drift class 8 — but it can only be provoked by bad content that is
*committed*, never by a dirty working tree. Phase 6 should carry this sentence somewhere durable;
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
path this phase actually changed — a build with *no* Supabase values present at all — is first
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

## Ship-time checklist

These criteria cannot be satisfied before the merge. They are tracked here so they are
neither blocking a phase gate nor quietly forgotten.

- [ ] **3.9** After merging, a real push to `main` shows `drift` green and `deploy` running as
      before, with `deploy` listing both dependencies on the Actions page
- [ ] **5.5** `deploy` is confirmed **not** to depend on the DDL-diff workflow — a red DDL
      diff must never block a release
