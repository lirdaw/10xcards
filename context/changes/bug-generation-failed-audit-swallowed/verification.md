# Verification — C10X-50 `bug-generation-failed-audit-swallowed`

> Evidence for the plan's Success Criteria, recorded per run rather than per claim. Every split
> below carries its denominator and its observed failure string, read from a
> `--reporter=verbose` run — the default reporter names only failures, so a "control stayed
> green" claim is otherwise unobserved.

**Scope of this file.** Phases 1 and 2 shipped without an evidence section; their criteria are
checked in the plan's `## Progress` against `f42aa65` and `8b3b141`, and this file deliberately
does **not** restate runs it did not observe. It opens at Phase 3.

---

## Phase 3 — committed tests, guards, and the breakage runs that prove them

Environment for every run below: local Supabase stack up
(`supabase_db_10x-astro-starter`), `OPENROUTER_API_KEY` unset, no `.dev.vars`, branch
`C10X-50-bug-generation-failed-audit-swallowed`.

### 3.1 / 3.2 — the suite, measured by running

| Run                                                                                       | Result                                                                                                |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npx vitest run tests/generation/generate.test.ts tests/lib/audit-failure-wiring.test.ts` | **36 passed (36)**, 2 files                                                                           |
| `npm test` — baseline (both Phase-3 test edits removed)                                   | **458 passed (458)**, 37 files                                                                        |
| `npm test` — after                                                                        | **467 passed (467)**, 38 files                                                                        |
| `npm run typecheck`                                                                       | `Result (154 files): 0 errors, 0 warnings`, exit 0                                                    |
| `npm run lint`                                                                            | exit 0 — 3 warnings, all `no-console` in `evals/generation-quality.eval.ts`, unchanged by this change |

**The breakdown, and BOTH halves are measured rather than one being arithmetic** — the
total-vs-breakdown slip `test-plan.md` records against C10X-39, C10X-40 and C10X-48:

- `tests/generation/generate.test.ts` — **27 → 29** (+2), each figure from a run of that file
  alone (the 27 by checking the file out at `HEAD` and running it).
- `tests/lib/audit-failure-wiring.test.ts` — new, **7**, from a run of that file alone.
- 27 + 2 = 29 and 458 + 2 + 7 = 467 close, which is a check on the two measurements rather
  than the source of either.

### 3.3 — B1, the RLS neuter: **a PAIR, because the run as planned came back GREEN**

The plan asked for one neuter — `generation_session_insert`'s `WITH CHECK` to `true` — and
predicted the denial case red. It is **green**, and that is a finding rather than a pass: _a
breakage run that stays green is a claim about the EDIT before it is a claim about the guard_
(the C10X-48 idiom).

**B1(a) — insert policy alone.**

```
alter policy generation_session_insert on generation_session with check (true);
```

`npx vitest run tests/generation/generate.test.ts -t "audit insert"` → **2 passed | 27
skipped (29)**. Both new cases green; nothing red anywhere.

**Why, measured at the SQL layer rather than reasoned about.** `createGenerationSession` ends
`.insert(row).select("id, public_id").single()`, i.e. `INSERT … RETURNING`, and Postgres applies
the **SELECT** policy to the `RETURNING` clause. So the write policy is not the enforcer this
case observes on its own. Probed directly, as `authenticated` with B's `sub` claim, inserting a
row carrying A's `user_id`:

| Policies                                             | `INSERT … RETURNING id`                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `insert` = `true`, `select` = `user_id = auth.uid()` | `ERROR: new row violates row-level security policy for table "generation_session"` |
| `insert` = `true`, `select` = `true`                 | `INSERT 0 1`, `id = 106681`                                                        |

Both probes ran inside a transaction and were rolled back. This is the documented trap one
operation over: `test-plan.md` §6.6's C10X-28 entry records "on `generation_session`, neutering
a **write** policy alone proves nothing … neuter select WITH the write policy" for an `UPDATE`
whose `WHERE` reads a column; the same holds for an `INSERT` whose `RETURNING` does.

**B1(b) — insert AND select neutered.**

```
alter policy generation_session_insert on generation_session with check (true);
alter policy generation_session_select on generation_session using (true);
```

`npx vitest run tests/generation/generate.test.ts -t "audit insert"` → **1 failed | 1 passed |
27 skipped (29)**.

- RED: `resolves a REFUSED insert as an error with no data, and writes nothing` —
  `AssertionError: expected null not to be null` at `tests/generation/generate.test.ts:1331`
  (`expect(denied.error).not.toBeNull()`).
- GREEN: `resolves a LANDED insert as a row carrying id and public_id` — **the attribution**.
  The neuter removes the refusal SIGNAL; it does not break inserts. A control that reddened here
  would have said only "the database is broken".

Corroborated independently of the return value: the restore had to **delete one row** the
neutered run genuinely landed —
`106683 | [msrt7jpi:audit-denied] Tekst sesji audytowej spoza konta` — which is the row-based
oracle's own claim, observed from psql rather than from the assertion (the case aborts at its
first failed `expect` and never reached that line).

**Restore, verified rather than assumed.** `pg_policies` `qual`/`with_check` for all four
policies dumped before and after; `diff` **empty**. Re-run of the whole file afterwards:
**29 passed (29)**.

### 3.4 — B2, the builder privacy pair: **both predictions were rounder than the runs**

**B2(a) — `source_text` passed through verbatim** (`source_text_fingerprint: row.source_text`).
`npx vitest run tests/lib/audit-failure-report.test.ts` → **3 failed | 18 passed (21)**.

| Case                                                             | Line   | Observed                                                    |
| ---------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| `carries neither the source text nor either payload`             | `:99`  | `expected true to be false // Object.is equality`           |
| `replaces them with fingerprints that describe what was dropped` | `:109` | `.toMatch() expects to receive a string, but got undefined` |
| `carries none of the cause's message, details or hint`           | `:132` | `expected true to be false // Object.is equality`           |

The plan predicted **one** red. The second is the same claim from the other side (the
fingerprint became the raw string, so it has no `sha256`). The third is at `:132` — the line
that asserts the ROW's source text is absent from the report _reached through the cause's
DETAIL_ — not at `:129`, the cause's own three sentinels. Attribution read from the failure
locations, not inferred.

**B2(b) — the cause's `details` passed through verbatim** (`cause_details_fingerprint:
cause.details`). → **2 failed | 19 passed (21)**.

| Case                                                   | Line   | Observed                                          |
| ------------------------------------------------------ | ------ | ------------------------------------------------- |
| `carries none of the cause's message, details or hint` | `:129` | `expected true to be false // Object.is equality` |
| `carries neither the source text nor either payload`   | `:99`  | `expected true to be false // Object.is equality` |

The plan predicted "(a)'s case stays green" and that is **false**, for a reason worth carrying:
the fixture's `details` is `Failing row contains (1, <CAUSE_DETAILS>, <SOURCE_TEXT>, …)` — the
real CHECK-violation shape — so leaking the cause's DETAIL leaks the row's source text too. The
two cases are therefore **not** separated by field; they are separated by ROUTE, and the lines
that separate them are the two that flip:

| Line                                       | Under B2(a) | Under B2(b) |
| ------------------------------------------ | ----------- | ----------- |
| `:109` — the row's fingerprints are intact | **RED**     | green       |
| `:129` — the cause's own three sentinels   | green       | **RED**     |

That flip is the attribution the pair was designed to produce; only the lines differ from the
prediction. Retention, `code`-substitution, site-discrimination and all six `fingerprint` cases
stayed green in **both** runs.

Restore verified by per-file `md5sum` against the pristine copy; file re-run **21 passed (21)**.

### 3.5 — B3, Site A's capture deleted

The four-line `Sentry.captureException(…)` statement at Site A removed, nothing else touched.
`npx vitest run tests/lib/audit-failure-wiring.test.ts tests/lib/audit-failure-report.test.ts
--reporter=verbose` → **1 failed | 27 passed (28)**.

- RED, in the guard only, **1 of 7**:
  `AssertionError: src/pages/api/generate.ts:553: Sentry.captureException( new Error(AUDIT_CAPTURE_MESSAGE), await buildAuditFailureReport(auditRow, "zero-saved", auditError), );: expected [ Array(1) ] to have a length of 2 but got 1`
  — i.e. the red names the surviving statement by file and line.
- `tests/lib/audit-failure-report.test.ts` **fully green, 21/21**, and that is **counted from
  21 `✓` lines rather than inferred from the total** — which is the whole reason this criterion
  demands a verbose read, and the whole reason the truth table is a second file.
- The read control (`reads the real generation handler`) stayed **green**, which is why its
  floor sits four code lines below the measured 334: a floor AT the measured value would have
  reddened under the very neuter it exists to attribute (C10X-46 §6.11).

**B3 was run three times, and the reason is worth stating rather than hiding in a count.** The
first run failed with a bare `expected [ Array(1) ] to have a length of 2` — Vitest abbreviates
a long array — so a custom message carrying the located statements was added to the guard and
B3 re-run against the shipped file; only the failure MESSAGE changed, never the predicate. The
second re-run's per-case greens were then read off a **total** (`27 passed`) rather than
observed, which is exactly the substitution this criterion exists to forbid, so it was run a
third time under `--reporter=verbose`. The figures above are that third run's.

### 3.6 — B4, the delegation/first-argument pair

**B4(a) — the builder call replaced by an inline object literal** on the capture statement
(deliberately naming no content field, so the delegation rule is what fires rather than the
content rule). → **1 failed | 6 passed (7)**.

- RED: `captures on exactly two statements, and both call the builder` —
  `expected [ Array(1) ] to deeply equal []`.
- GREEN: the import assertion, the first-argument assertion, the content assertion.

**B4(b) — the synthetic error swapped back to `auditError`** as the first argument (the F1
defect, restored). → **1 failed | 6 passed (7)**.

- RED: `passes a synthetic Error as the first argument, never the failure itself` —
  `expected [ Array(1) ] to deeply equal []`.
- GREEN: `captures on exactly two statements, and both call the builder`, and
  `names no content field on any capture statement`.

**The split IS the attribution**: a call that delegates perfectly and leaks its first argument
is caught, and it is caught by a rule the delegation assertion demonstrably does not carry.

### 3.7 — B5, **predicted GREEN, and green**

At Site A the failed-audit arm was made to return the **ordinary** literal, so both arms of the
return are byte-identical. The capture statement was deliberately left in place — deleting
`if (auditError)` would have taken its body with it and reddened the exactly-two assertion **by
construction, every time**, a red that says nothing about coverage while reading exactly like
the falsification this criterion watches for (plan-review F2; C10X-46 §6.11).

`npm test` → **467 passed (467), 38 files. Whole suite green.**

**Written up as a finding, not as a pass.** The user-visible half of the defect is restored —
on the wire a lost audit row is again indistinguishable from a recorded one — and **no layer in
this project notices**. That is this ticket's coverage boundary, measured rather than asserted:

- the wiring guard is untouched by construction (it asserts the capture is present and
  composed, never what the response says);
- the truth table never sees the endpoint at all;
- `tests/generation/failure-path.test.ts`'s four cases drive both branches end to end but all
  four land on the **audit-insert-SUCCEEDS** arm, which is the arm this neuter does not touch;
- and nothing in the suite can make that insert fail — which is Phase 4's whole reason to
  exist.

Had it gone red, something reached the branch this plan says cannot be reached, and Phase 4's
scope would have changed. It did not.

### 3.8 — restores

| Oracle                                                          | Result                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `md5sum -c` against pristine copies taken before the first edit | `src/lib/audit-failure-report.ts: OK`, `src/pages/api/generate.ts: OK` |
| `git diff --quiet -- src/`                                      | **empty**                                                              |
| `pg_policies` `qual`/`with_check` before/after `diff`           | **identical**                                                          |
| `npm test` after every restore                                  | **467 passed (467)**, 38 files                                         |

One row and no more was left behind by the neutered runs, and it was deleted with its id and
`source_text` recorded above. The two SQL probes ran inside `begin … rollback`.
