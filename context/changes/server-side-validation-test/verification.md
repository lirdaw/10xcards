# Verification — server-side-validation-test (C10X-30)

> Evidence record for every probe, breakage edit and restore. Phases fill this in as they land.
> Environment unless stated otherwise: local Supabase stack up (`127.0.0.1:54321`),
> `OPENROUTER_API_KEY` unset, Node 22, Vitest 4.1.10, Supabase CLI 2.98.2.

## Phase 1 — Database backstop on `front` / `back`

Migration: `supabase/migrations/20260728104500_flashcard_content_bounds.sql`.
Both constraints dropped and re-added under their original auto-generated names.

### 1.1 Clean replay

`npx supabase db reset` — all **11** migrations applied in order, the new one last:

```
Applying migration 20260725150000_candidate_counts_rpc.sql...
Applying migration 20260728104500_flashcard_content_bounds.sql...
Finished supabase db reset on branch C10X-30-server-side-validation-test.
```

The reset was run on a knowingly-empty target: the local DB held **399** `harness-*` accounts,
**3808** per-run decks and **7121** flashcards, all suite residue plus a handful of
`*@example.com` probe accounts from C10X-27/C10X-34 verification runs — checked before the
reset, no genuine content. Side effect worth carrying: `test-plan.md` §6.6/§6.7 record that the
four-policy neuter stopped reproducing once the dev DB outgrew PostgREST's `max_rows = 1000`
(1053 decks at the time). A fresh database puts that check back in reach.

### 1.2 Generated types

`npm run db:types` → `git diff --quiet -- src/db/database.types.ts` exits **0**. A CHECK
constraint does not surface in the generated types; confirmed by running it rather than assumed,
per the criterion's own wording.

### 1.3 Suite at the pre-change baseline

`npm test` → **178 passed / 178, 15 files**, 2.63 s. Exactly the baseline `test-plan.md` §8
records after C10X-29's impl-review.

### 1.4 Lint

`npm run lint` → exit **0**.

### 1.6 Constraint definitions, local

```
        conname        |                        pg_get_constraintdef
-----------------------+---------------------------------------------------------------------
 flashcard_back_check  | CHECK (((char_length(back) >= 1) AND (char_length(back) <= 1000)))
 flashcard_front_check | CHECK (((char_length(front) >= 1) AND (char_length(front) <= 200)))
```

**Postgres canonicalises `between` into `>= AND <=`**, so the definition never reads back in the
form the migration was written in. The plan's criterion says "shows `between 1 and 200`"; judge it
on the expanded form, which is the same predicate. Same normalisation `deck_session_size_check`
carries from `20260724220524`. Names are unchanged from `init_core_schema`, so `pg_constraint`
reads identically apart from the definition — which is what makes the Phase 4 restore diff
meaningful.

### 1.5 Cloud checked for violating rows — BEFORE any `db push`

Run read-only against project `bhwnautkdfzrhepkuozx` (`My10Cards`, West EU) through the Supabase
Management API `POST /v1/projects/{ref}/database/query`, using the access token the CLI already
holds in the Windows Credential Manager (`Supabase CLI:supabase`). No write of any kind was
issued; the token was never printed or persisted.

```sql
select count(*)                                            as total_rows,
       count(*) filter (where char_length(front) > 200)    as bad_front,
       count(*) filter (where char_length(back)  > 1000)   as bad_back,
       max(char_length(front))                             as max_front,
       max(char_length(back))                              as max_back
from public.flashcard;
```

```json
{"total_rows":38,"bad_front":0,"bad_back":0,"max_front":64,"max_back":157}
```

**Both counts are 0**, with the largest live values at 64 / 157 — a third and a sixth of the new
bounds. The migration is additive-tightening against data that does not exist, so the plan's
stop-and-decide branch (repair the rows vs loosen the bound) is not triggered and no repair step
is needed. Recorded here rather than left to `/ship`, which is the point of the criterion: the
wrong moment to take that decision is with the merge already blocked by a `db push` that cannot
apply.

Cloud state captured at the same moment, as the "before" half of the `/ship` step:

```json
[{"conname":"flashcard_back_check","def":"CHECK ((char_length(back) > 0))"},
 {"conname":"flashcard_front_check","def":"CHECK ((char_length(front) > 0))"}]
```

```json
[{"version":"20260725150000"},{"version":"20260725133600"},{"version":"20260725112700"}]
```

So the cloud still carries the unbounded checks and its latest applied migration is
`20260725150000` — `20260728104500` is pending there by design. It must be pushed **before**
merge: the `drift` gate (C10X-29) compares migration versions on every push to `main` and a
committed-but-unpushed migration is exactly drift class 1.
