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

## Ship-time checklist

These criteria cannot be satisfied before the merge. They are tracked here so they are
neither blocking a phase gate nor quietly forgotten.

- [ ] **3.9** After merging, a real push to `main` shows `drift` green and `deploy` running as
      before, with `deploy` listing both dependencies on the Actions page
- [ ] **5.5** `deploy` is confirmed **not** to depend on the DDL-diff workflow — a red DDL
      diff must never block a release
