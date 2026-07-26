# Mutation register — `rateCard` (C10X-27, Phase 4)

Selective mutation run over the one function on the study write path. Per CLAUDE.md the
permanent `mutate` list in `stryker.config.json` was **not** touched; the scope came from the
CLI only.

## The run

| | |
| --- | --- |
| Command | `npx stryker run --mutate "src/lib/study.ts:291-350"` |
| Span | **291–350** — `rateCard`, re-derived on the file as it stands after Phase 3 |
| Date | 2026-07-26 |
| Result | **56.90% total / 71.74% covered** — 33 killed, 13 survived, 12 no coverage, 0 errors, 0 timeouts |
| Report | `reports/mutation/mutation.html` (gitignored) |

**The span was re-derived, not carried forward, and that mattered.** `plan.md` recorded
257–316 when it was written; Phase 3 §2 edited the same file above `rateCard` (the comment
block at `:81-105`, a `DueCardRow` field, a line in `scheduleRowToCard`) and pushed the
function down **34 lines**. A stale range would have completed happily while mutating the
tail of `setSessionSize` and produced a plausible-looking register about the wrong function.

## Survived — all 13, one by one

**No assertion was added for any of them.** That is a classification result, not a claim that
the coverage is good; read the reasoning per row.

| # | Line | Mutator | Mutation | Verdict |
| --- | --- | --- | --- | --- |
| 1–2 | 324 ×2 | StringLiteral | `front: ""` / `back: ""` → `"Stryker was here!"` | **Equivalent.** Placeholder fields on the object handed to `scheduleRowToCard`, which builds a ts-fsrs `Card` and never reads either. Nothing observable to assert. |
| 3 | 308 | StringLiteral | `.select("id")` → `.select("")` | **Equivalent — verified, not assumed** (see below). |
| 4 | 318 | StringLiteral | schedule `.select("due, stability, …")` → `.select("")` | **Equivalent** — same reason. |
| 5 | 341 | StringLiteral | re-read `.select("reps, due")` → `.select("")` | **Equivalent** — same reason. |
| 6 | 313 | ConditionalExpression | `if (resolveError)` → `if (false)` | Error branch. Unkillable without fault injection. |
| 7 | 321 | ConditionalExpression | `if (schedError)` → `if (false)` | Error branch. Same. |
| 8 | 334 | ConditionalExpression | `if (updateError)` → `if (false)` | Error branch. Same. |
| 9 | 344 | ConditionalExpression | `if (rereadError)` → `if (false)` | Error branch. Same. |
| 10–11 | 314 ×2 | ObjectLiteral / BooleanLiteral | the `!resolved` return → `{}` / `alreadyApplied: true` | **Equivalent.** On that branch `data` is nullish either way, and the endpoint maps nullish `data` to 404 without consulting `alreadyApplied`. The *condition* at 314 was killed in both directions, so the accepted-only / wrong-deck gate itself **is** asserted. |
| 12 | 322 | ConditionalExpression | `if (!sched)` → `if (false)` | **Equivalent by a longer path.** Dropping the "card has no schedule row yet" early return does not change the answer: the spread of a null `sched` yields a New card, the compare-and-set then matches 0 rows, the re-read finds nothing, and the function returns the same 404 — one extra round-trip later. |
| 13 | 345 | ConditionalExpression | `if (!current)` → `if (false)` | Requires the schedule row to disappear between the failed UPDATE and the re-read. Unreachable in a test and effectively unreachable in production. |

### Why rows 3–5 are equivalent, and why that inverts the S-05 precedent

S-05's register recorded that `.in("state_id", "")` died on a **malformed query** (`PGRST100`)
rather than on a behavioural assertion — a mutant killed by a parse error is not evidence the
gate is asserted. The instinct here is to expect the same and move on. It does not hold.

Reproduced by hand on line 318 (`.select("")` written into the file, full file run):
**22/22 green**, not one red. Then probed PostgREST directly to find out why:

```
select=""         -> 200 [{"id":100060,"flashcard_id":100305,"due":…,"stability":0,…,"scheduled_days":0,"created_at":…}]
select="reps,due" -> 200 [{"reps":0,"due":"2026-07-25T17:09:16.453+00:00"}]
```

An empty `select=` is **not** malformed — PostgREST reads it as `select=*` and returns a strict
**superset** of the requested columns. So the mutation cannot change behaviour: every field the
code goes on to read is still present. Killing it would mean asserting that a query returns *no
extra* columns, i.e. asserting an implementation detail, which is worth less than the mutant.

The general lesson is the opposite of S-05's: a surviving `""` string mutant on a Supabase call
is not automatically a coverage gap, and a killed one is not automatically a behavioural kill.
**Both directions need the query semantics checked before the mutant is classified.**

### Why the four error branches (rows 6–9) are left alone

Each guards an `{ error }` returned by Supabase — a transport or database failure mid-`rateCard`.
Nothing in this project can produce one on demand: §6.4 fixes the pattern as "drive the real
endpoint against the real local Postgres", with no mocking layer and no seam for injecting a
failure into a specific query. Killing these four would mean introducing that layer for the sake
of the score. The failure they guard is also not silent — an unhandled `error` surfaces as a 500
rather than as a wrong schedule, so it is not a Risk #3 failure mode.

The same root cause explains the **12 "no coverage"** mutants exactly: they are the
`ObjectLiteral` / `BooleanLiteral` variants of the return payloads inside those same never-executed
branches (313, 321, 322, 334, 344, 345 — two each).

## Killed — 33, and what they died on

S-05's precedent asks whether each kill was behavioural or an artefact. The split here is much
healthier than S-05's, because these mutants change **query predicates**, not query syntax:

Classified programmatically from the JSON report rather than by eye — a mutant counts as
*structural* if it is a `BlockStatement → {}` or empties a `.from("…")` table name, i.e. it
stops the call addressing anything at all:

- **Behavioural (27).** The `.eq(...)` column names at 309/310/311 (`public_id`, `deck_id`,
  `state_id`), 319, 330, 331 and 342 (`flashcard_id`, `reps`), the `.select` projections at
  332, the branch conditions at 313/314, 321/322, 334/336, 344/345 in both directions, and the
  returned payloads at 324/346/349. These fail on assertions about the persisted row or the
  endpoint's status — e.g. dropping the `state_id` predicate breaks "writes no schedule when a
  non-accepted card is rated"; forcing `!updated` false breaks the idempotent-retry case.
- **Structural (6).** `BlockStatement → {}` at 298 and 336, and the four table-name literals
  at 307/317/328/340 that make the call address a table that does not exist. These die because
  the function stops doing anything at all, which is a weaker signal — the suite would notice
  almost any change there.

> First written here as "26 / 7" from a hand count. Re-derived by script during the Phase 4
> manual verification: **27 / 6**. Recorded rather than quietly amended, because a register
> whose own arithmetic is unchecked is the same failure mode as the stale counts this change
> exists to replace.

The 27/6 split is the number worth carrying forward. `rateCard`'s **predicates** are genuinely
asserted; its **failure handling** is not asserted at all, and this run says so in two
independent ways (four survivors plus twelve uncovered).

## Conclusion

No assertion added — 13 survivors, all either provably equivalent (7) or reachable only through
a fault-injection layer this project deliberately does not have (6). The score of **56.90%** is
recorded and deliberately not chased; the meaningful figure is that no survivor corresponds to a
user-visible or business-relevant defect on the study write path.
