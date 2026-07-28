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

## Phase 4 — Deliberate-breakage pair

Run 2026-07-28 against the tree at `030053c`. Environment as in the header; the local stack was
up and `npx supabase status` confirmed before the first edit.

### 4.0 Baseline, and the denominator every split below is read against

`npm test` → **193 passed / 193, 16 files**, 2.56 s. That is the Phase 3 total, measured at the
start of this phase rather than carried over from a remembered figure. `tests/validation/cards.test.ts`
holds **12** `it()`s — the plan's eleven numbered cases plus the edit-side malformed-body twin of
case 9 — so every split below is *of 12*, and the case numbers are the plan's, not the file's
order.

Constraint definitions captured **before** any edit (`/tmp/constraints-before.txt`):

```
flashcard_back_check|CHECK (((char_length(back) >= 1) AND (char_length(back) <= 1000)))
flashcard_front_check|CHECK (((char_length(front) >= 1) AND (char_length(front) <= 200)))
```

`src/pages/api/decks/[publicId]/cards/index.ts` copied pristine before editing:
`md5 f80813f1083f4132c7c9cac28732f7b0`.

### 4.1 Run 1 — the endpoint's comparison decoupled

Edit (temporary, never committed): `front.length > FRONT_MAX` → `front.length > 100000`, one line,
`git diff --stat` = `1 file changed, 1 insertion(+), 1 deletion(-)`. The **comparison only** — the
message on the next line keeps its `${FRONT_MAX}` interpolation, so a red here cannot come from a
changed literal. Per C10X-28's rule the shared constant itself is never raised: `FRONT_MAX` is
imported by the endpoint, three islands, `openrouter.ts` **and this test**, so raising it moves
every side together and proves nothing.

`npx vitest run tests/validation/cards.test.ts` → **2 of 12 red**, exactly the predicted set
{case 1, case 8}, both on the message:

```
FAIL … > refuses a front one character over the limit and writes nothing
AssertionError: expected 'Nie udało się utworzyć fiszki' to be 'Przód fiszki musi mieć od 1 do 200 zn…'
  Expected: "Przód fiszki musi mieć od 1 do 200 znaków"
  Received: "Nie udało się utworzyć fiszki"
  ❯ tests/validation/cards.test.ts:196:34

FAIL … > echoes no part of the submitted content back into the redirect
AssertionError: expected [ …(2) ] to include 'Nie udało się utworzyć fiszki'
  ❯ tests/validation/cards.test.ts:286:43
```

**The passing assertion is the evidence here, not the failing one.** Case 1's count check sits at
`:192`, *before* the message at `:196`, and it **passed** — so the over-max card was refused a
write even though the endpoint had stopped refusing it. That is the database CHECK doing
independent work, observed rather than argued. The endpoint fell into its existing
`createFlashcard` error branch, which is why the response is still a `302` still carrying
`error=` and `open=create-card` — and why a `toContain("error=")` assertion would have stayed
green over a guard that had stopped working. That is the whole reason cases 1, 2, 6 and 8 assert
the message by **equality**.

The other **10 stayed green for stated reasons**: the edit touches only the `front` comparison on
create, so case 2 (`back`), case 6 (edit) and cases 5/9/10 — which trip the untouched `< 1` half —
are unaffected; cases 3, 4 and 7 are boundary controls at or under the bound, which the CHECK also
admits; case 11 asserts the constraint, still in place.

### 4.2 Run 2 — the CHECK dropped on top

Run 1's edit kept, plus, against the live local DB via `docker exec -i … psql` (the `-i` is
load-bearing — a heredoc without it silently no-ops, §6.6's recorded failure mode):

```sql
alter table public.flashcard drop constraint flashcard_front_check;
```

**Confirmed applied, not assumed** (criterion 4.6): psql echoed `ALTER TABLE`, and an immediate
re-read of `pg_constraint` for the two names returned **one row** — `flashcard_back_check` alone.

`npx vitest run tests/validation/cards.test.ts` → **3 of 12 red**, the predicted set
{case 1, case 8, case 11}:

```
FAIL … > refuses a front one character over the limit and writes nothing
AssertionError: expected 1 to be +0
  ❯ tests/validation/cards.test.ts:192:38        ← the COUNT, not the message

FAIL … > echoes no part of the submitted content back into the redirect
AssertionError: expected 4 to be 3
  ❯ tests/validation/cards.test.ts:280:38        ← also the count

FAIL … > rejects an over-limit front and an over-limit back with 23514
AssertionError: expected undefined to be '23514'
  ❯ tests/validation/cards.test.ts:430:35
```

**What the pair proves is the difference between the two failure strings, not the reds.** Case 1
is red in both runs and for two different reasons: run 1 on the message at `:196` with the count at
`:192` passing, run 2 on that same count. Ordered the other way round, run 2 would have printed
run 1's string verbatim, the count would never have been reached, and the pair would have
separated nothing — "the endpoint caught it" and "the database caught it" would be one
indistinguishable red. That is why the ordering carries a comment in the file.

Case 11 is the assertion that most directly observes what run 2 removed: with the constraint gone
a direct 201-character insert succeeds, so `error?.code` is `undefined`. Its `back` half stayed
green throughout — only `flashcard_front_check` was dropped — which is what keeps the second
constraint observed while the first is absent. The two are never both unobserved.

**One deviation from the prediction, recorded as observed rather than rounded to it.** The plan
said "case 8 stays red from run 1". It does stay red, but **on a different assertion**: run 1
failed it at `:286` (the closed-set message), run 2 at `:280` (the count), because case 8 also
sends an over-max `front` and its count oracle likewise sits first. So run 2's red set is
{case 1, case 8, case 11} as predicted, but **two** of the three moved their failure from the
message to the count, not one. Nothing about the conclusion changes; the prediction was simply
less precise than the run.

### 4.3 Restore, in the order that works

A dropped CHECK is **not** symmetric with a replaced function (§6.7): the suite persisted rows the
constraint forbids while it was absent, so `add constraint` fails afterwards with
`violated by some row`. Inspected first, repaired second, re-added third:

```
   id   | deck_id |           deck_name           | front_len |            front_head
--------+---------+-------------------------------+-----------+----------------------------------
 100426 |  100228 | Validation create ms524r90    |       201 | over-front-ms524r90-xxxxxxxxxxxx
 100429 |  100228 | Validation create ms524r90    |       201 | ECHO-ms524r90-MARKERxxxxxxxxxxxx
 100432 |  100230 | Validation db bounds ms524r90 |       201 | db-front-ms524r90-xxxxxxxxxxxxxx
```

Exactly **three** rows, all carrying this run's own `ms524r90` suffix and all inside this run's own
decks — one from case 1, one from case 8, one from case 11's direct insert. `DELETE 3` by id, then
`count(*) where char_length(front) > 200` → **0**, then `ALTER TABLE` re-adding the constraint,
which succeeded.

**Restore verified by diff, never from memory** (criterion 4.4):

```
$ diff /tmp/constraints-before.txt /tmp/constraints-after.txt
IDENTICAL (exit 0)
```

Both constraints read back byte-identical to the pre-breakage dump — the `between` form
canonicalised to `>= AND <=` on both sides, as §1.6 records.

Source restore verified the same way:

```
f80813f1083f4132c7c9cac28732f7b0 *src/pages/api/decks/[publicId]/cards/index.ts
f80813f1083f4132c7c9cac28732f7b0 */tmp/cards-index-pristine.ts
```

`git diff --quiet -- src/ supabase/` → exit **0**, working tree empty for both paths.

`npm test` → **193 passed / 193, 16 files** — back at the Phase 3 total the splits above were read
against.

### 4.4 Two things the diff alone does not establish, probed separately

**A matching definition string is not proof of an enforced constraint.** The `diff` above compares
text; it would read identical for a constraint that had somehow come back `NOT VALID`. Probed
behaviourally instead, both halves inside a transaction and rolled back, so nothing persists:

```
begin; insert … front = repeat('x', 201) …
ERROR:  new row for relation "flashcard" violates check constraint "flashcard_front_check"
ROLLBACK
begin; insert … front = repeat('x', 200) …
INSERT 0 1
ROLLBACK
```

The second half is the positive control: a constraint that rejected *every* insert would satisfy
the first line alone. So the restored constraint fires at 201 and admits 200 — the bound is back,
not merely the string describing it.

**The `-i` echo is not the strongest evidence that the drop applied.** psql echoing `ALTER TABLE`
and the one-row `pg_constraint` re-read both come from the same session that issued the command.
The independent corroboration is **case 11's red in run 2**: `expected undefined to be '23514'` is
reachable *only* if the constraint was genuinely absent when the suite ran in a different process
over PostgREST. A silently no-opped heredoc — the §6.6 failure mode this criterion exists for —
would have left the constraint in place and case 11 green. It was not green.

## Phase 5 — Documentation sync

Run 2026-07-28 against the tree at `72e275e`. Docs-only; no file under `src/` or `supabase/`
was touched, which is why the three automated criteria are re-runs of the same commands rather
than new evidence.

### 5.1 / 5.2 Suite, lint, build

`npm test` → **193 passed / 193, 16 files**, 2.72 s — the Phase 3 total, unchanged by a
documentation phase, and the figure written into `test-plan.md` §8. `npm run lint` → exit
**0**; `npm run build` → exit **0**.

### 5.3 The "4xx" sweep, and what each surviving hit is

`grep -rn "4xx" context/foundation/` → **12 hits, none of them a claim that the card
create/edit endpoints answer a 4xx.** Classified individually rather than counted:

| Where                              | Kind                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `test-plan.md:1232`                | The **only** surviving load-bearing use: C10X-28's claims table row for `/api/generate`, a JSON endpoint. Correct as written |
| `test-plan.md:166`                 | The rewritten Risk Response row — attributes `4xx` to the JSON endpoints and `302` to the native-form targets |
| `test-plan.md:23,24,154,208,453,454,1295,1422,2128` | Nine corrections that must contain the word in order to correct it (header, Risk #6 row, §3 sequencing note, §6.3's dated block, C10X-28's bullet, §6.6's C10X-30 entry, §8) |
| `lessons.md:203`                   | The new entry's Context line — "odmawiają … zamiast statusem 4xx", i.e. the rule's own subject |

The change's own folder is deliberately outside the command, per criterion 5.3: `plan.md`,
`research.md` and `plan-brief.md` discuss the wrong wording and must keep quoting it.

### 5.4 Where the correction landed — six places, one of them an archive

1. `test-plan.md` §2 Risk Response Guidance row #6 — rewritten to the two-convention form.
2. `test-plan.md` §3 Phase 2 sequencing note — rewritten from "what it takes to flip" into
   what landed, naming the wrong wording as the first thing the slice found.
3. `test-plan.md` §6.3 — the "a 4xx AND no write" bullet keeps its sentence and gains a dated
   correction block pointing at the new §6.10.
4. `test-plan.md` §6.6, C10X-28's "card-content half" bullet — dated closure line; the bullet
   itself is left as written.
5. `change.md` — inline `[POPRAWKA 2026-07-28: …]` markers inside the ticket-sourced paragraph,
   so the ticket's own wording survives beside the correction, plus a `### Wynik` section.
6. `context/archive/2026-07-26-ai-candidate-generation-test-2/change.md:52` — a dated
   correction line appended under the paragraph, **not** a rewrite of it. Same discipline that
   makes `complete` a dated claim: the archive records what was known then.

The seventh place — the Jira description and its two comments — is outside this repo and is
corrected at `/jira-finish-work`, which is why criterion 5.6 is a manual row.

### 5.5 What was added rather than corrected

- **`test-plan.md` §6.10**, "Adding a test for a redirect-style (native form) endpoint" — the
  rule this file did not have. Six facts, plus the breakage-**pair** requirement and the
  constraint-restore asymmetry.
- **`test-plan.md` §6.6, the C10X-30 entry** — the claims table, the pair with its splits read
  against a denominator of 12, four traps, and an explicit "what this does NOT prove" list.
- **`test-plan.md` §7** — a third islands note, stated as the **opposite** of the C10X-28 one
  directly above it: the card islands carry no `maxLength` (verified by enumeration —
  `maxLength` appears in `src/components/` only in `GeneratorForm`), so their over-length
  branch is reachable through the browser rather than sealed behind an input stop.
- **`lessons.md`** — one entry, grounded in breakage run 1: a redirect-style refusal needs a
  row oracle and an equality assertion, with the oracle asserted first.

One deviation from the plan, recorded rather than silently applied: Phase 5 §2 asked for
`status: complete` in `change.md`. The vocabulary this repo's tooling actually uses is
`implementing` → `implemented` → `archived` (all 15 archived changes read `archived`; nothing
has ever carried `complete`), and `/10x-archive` reads that field. Set to **`implemented`**.

### 5.6 The manual pass found two defects in this phase's own output

Criteria 5.4 and 5.5 are the kind of check that is easy to perform by asserting the intent of
the edit rather than by reading what landed. Read instead, both came back red.

**5.5 — the correction block had merged into the paragraph it was correcting.** It was
inserted directly under item 2's original sentence, immediately above the pre-existing
`> **Annotate it with a comment…**` block. Both are blockquotes at the same indentation, so
markdown renders them as **one** quote and the original instruction read as a continuation of
the 2026-07-28 correction — the file no longer read as a record with a correction appended,
which is precisely what criterion 5.5 exists to catch. Moved to the **end** of item 2, after
the `✅ THE COMMENT IS POSTED` block, where it is also chronologically right. Item 3
("Phase 2 stays `implementing`… do not flip it for any other reason") got its own resolution
line in the same style, since this change is what flipped it and the honest close is to
record that it was flipped for exactly the named reason.

**5.4 — §2 and §6.6 disagreed about `IDS_MAX`.** The Risk #6 row said "Each limit has exactly
one definition", which is true of `SOURCE_MAX` and of `FRONT_MAX`/`BACK_MAX` and **false** of
`/cards/batch`'s `IDS_MAX`: `CandidateReviewWorkspace.tsx:27` mirrors it as a commented copy
(`BATCH_MAX = 100`), not an import — verified by reading both files, not inferred from the
test's comment. §6.6's new entry was silent on it, so the two documents would have been read
together (5.4's own instruction) and given opposite impressions. Both fixed: §2 now scopes the
claim to the two **length** limits and names `IDS_MAX` as the exception; §6.6's `IDS_MAX` row
states that the server assertion is the whole guard because the client copy can drift.

Nothing under `src/` changed for either fix. `npm test` re-run afterwards: **193 passed / 193,
16 files**, and the `4xx` sweep re-counted at **12** (the figure above was first written as 11
— the classification table was right and the headline was not, which is the same rot-in-hours
class item 4 of C10X-28's archived `change.md` warns about).

## Impl-review — corrections to this record (2026-07-28)

`/10x-impl-review` re-ran every automated criterion against `b2e009e` and reproduced all of
them: **193/193, 16 files**; `tests/validation/cards.test.ts` 12/12; lint 0; build 0;
`db:types` no diff; `git diff -- src/ supabase/` empty; both constraints bounded under their
original names and neither `NOT VALID`; the `4xx` sweep carrying only JSON-endpoint uses and
corrections. Three doc claims were checked independently rather than trusted and all hold: no
`PATCH` handler on any deck endpoint, `maxLength` present in `src/components/` only in
`GeneratorForm.tsx`, and `BATCH_MAX = 100` genuinely a commented copy rather than an import.

**One factual claim in this file and in the plan is wrong, and it is a count.** Phase 2 is
described throughout as hardening "the four form endpoints". Enumerated against the tree,
`src/pages/api/` holds **six** `formData()` readers:

```
src/pages/api/auth/signin.ts:17                          guarded (this change)
src/pages/api/auth/signup.ts:12                          guarded (this change)
src/pages/api/decks/[publicId]/cards/index.ts:44         guarded (this change)
src/pages/api/decks/[publicId]/cards/[cardPublicId].ts:35 guarded (this change)
src/pages/api/decks/index.ts:22                          UNGUARDED
src/pages/api/decks/[publicId].ts:31                     UNGUARDED
```

The last two — deck create and deck rename — still carry both of the defects this change
fixed elsewhere: the unguarded `formData()` (a crafted non-form body → uncontrolled framework
`500`) and `((form.get("name") as string | null) ?? "").trim()` (a `File` `name` part →
`TypeError` → `500`). Neither has a test. The plan's Current State Analysis asserted the
defect was present "in all four form endpoints", and nothing in "What We're NOT Doing"
excluded the deck pair, so this was an **incomplete enumeration rather than a scoped
exclusion** — the same class as the `IDS_MAX`/§2 disagreement §5.6 above records catching by
reading instead of by asserting intent.

Deferred to a follow-up ticket by decision at triage rather than patched in at review time:
the deck endpoints already carry a 1–100 name rule and a DB CHECK
(`init_core_schema.sql:45`), so §6.10's breakage-pair design transfers to them unchanged and
they deserve the same row-oracle treatment rather than an untested tail-end edit — which is
precisely what plan-review F4 refused for the auth half of this change.

### Triage outcome — suite 193/193 → **207/207, 17 files**

Ten findings, all decided. Five changed the suite; the rest were comments and one follow-up.
Environment unchanged; `npm run lint` exit 0, `npm run build` exit 0, `tests/lib/no-logging.test.ts`
green, `git diff -- src/` empty of every temporary probe (each restore confirmed by `md5sum`).

| Finding | Outcome |
| --- | --- |
| F1 deck endpoints missed | Docs corrected in three places; code raised as **C10X-37** (`follow-ups/review-fixes.md`) |
| F2 constraint name unasserted | Names added beside `23514`, matching `study.test.ts:717` |
| F3 `IDS_MAX` value unasserted | Boundary control at exactly 100 added |
| F4 six of eight branches asserted | Edit `File` case + the first two cases ever to touch `signup.ts` |
| F5 `formString` ×4 | Extracted to `src/lib/forms.ts` + `tests/lib/forms.test.ts` |
| F6 false comment in `auth-errors.ts` | Rewritten against a fresh probe |
| F7 bare `catch` conflates two causes | Split on the **header**, not the exception — see below |
| F8 auth-ordering asymmetry | Named in the comment block |
| F9 whole-batch failure undocumented in code | Comment at the insert site |
| F10 rate-limit + upstream coupling | Warning written for the next contributor |

**Two breakage runs on the review's own additions**, because an assertion added during a review
is not exempt from the rule the review enforced:

- `IDS_MAX` narrowed `100` → `2`: **1 of 22 red**, the new control on `expected 400 to be 200`,
  while the pre-existing 101-id case stayed **green** — which is precisely the blindness the
  control removes. `batch.ts` restored, `md5sum 23d279f5…` both sides.
- `isFormContentType` collapsed to `return false`: **3 of 47 red**, the endpoint case failing on
  exactly the right pair (`Expected "Nie udało się dokończyć operacji…"` /
  `Received "Popraw dane w formularzu…"`), so it observes the discriminator rather than an
  incidental redirect. `src/lib/forms.ts` restored, `md5sum 9041eb45…` both sides.

**Two measurements that changed a decision rather than confirming one.**

F7 was accepted as "branch on the error type" and that turned out not to be implementable —
probed against this runtime, both causes throw the *same* class:

```
Content-Type: application/json          -> TypeError: Content-Type was not one of "multipart/form-data"…
Content-Type: multipart/…, broken body  -> TypeError: Failed to parse body as FormData.
```

So the discriminator is the **Content-Type header**, which is where the runtime itself splits and
is fetch-spec stable rather than dependent on message wording. Applied only to `signin`/`signup`,
whose catch previously answered "Popraw dane w formularzu" — a claim about the user's input — for
what may be a dropped upload; a form-typed failure now answers `AUTH_GENERIC_MESSAGE`, already a
closed-set member, so **no new copy entered the set**. On the two card endpoints the same branch
collapses to a no-op (their owned copy already reads "the operation failed", truthful for both),
so those got the comment fix instead of unobservable code.

F4 uncovered that **GoTrue answers an empty address differently on the two auth routes**:

```
POST /auth/v1/signup                     {"code":422,"error_code":"anonymous_provider_disabled"}
POST /auth/v1/token?grant_type=password  {"code":400,"error_code":"validation_failed"}
```

signup's code is absent from the mapper's table, so it lands on the catch-all — asserted by
equality rather than smoothed over, so the day someone maps it the test goes red and the
improvement is noticed. This also disproved the `auth-errors.ts` comment F6 flagged, on a third
count beyond the two the finding named.

Corrected in three places, none of them a silent rewrite: `test-plan.md`'s header and its
§6.6 C10X-30 entry (which gains the deck pair as the first item of its "does NOT prove"
list), `change.md`'s `### Wynik` item 2 (a dated `[POPRAWKA]` marker beside the original
sentence), and this section. `plan.md`, `plan-brief.md` and `research.md` keep the original
wording on purpose — they record what was believed when the work was scoped, which is the
same discipline that makes `complete` a dated claim.
