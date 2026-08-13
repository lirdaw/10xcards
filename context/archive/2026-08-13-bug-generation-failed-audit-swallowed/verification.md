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

---

## Phase 4 — manual reachability runs, both sites

**The boundary, stated before the coverage.** Nothing committed can make either
`createGenerationSession` insert fail — B3/B5 above prove the wiring is untouched by the
failure and the truth table never sees the endpoint at all. This phase owns the other half:
that `/api/generate` actually reaches each `if (auditError)` branch and answers with the new
body. Two recorded DCL runs, each against a control differing in exactly one privilege.

**Environment, checked before the first revoke.** `SUPABASE_URL=http://127.0.0.1:54321`,
cloud credentials parked under `PROD_`, **no `.dev.vars`**, `OPENROUTER_API_KEY` unset —
confirmed independently by the mock-mode banner ("Uwaga: OpenRouter nie jest
skonfigurowany…") on `/auth/signup` before sign-up. Local Supabase stack up
(`supabase_db_10x-astro-starter`), branch `C10X-50-bug-generation-failed-audit-swallowed`.

**One operational aside, unrelated to the code under test but worth recording so a future
runner does not mistake it for a defect.** The first `npm run dev` boot of this session hit
the C10X-46 §6.11 class verbatim — Vite re-optimized `astro/env/runtime` mid-boot and the
next few requests to `/auth/signin` / `/auth/signup` answered `200` with an **empty body**
(no error, no HTML), then a hard SSR crash (`Invalid hook call … Cannot read properties of
null (reading 'useState')`) once the reload landed on a stale `deps_ssr` chunk. It settled on
its own after ~10 s and every later boot (two more restarts, for the bogus-key set/unset)
came up clean in under 2 s with no re-optimization at all. Recorded because it is the same
class §6.11 describes for `npm run e2e`, seen here for the first time outside that layer.

**The throwaway account** — `c10x50-phase4@example.com`, created through the real sign-up
form (confirmations disabled locally), zero decks at the start. Fresh rather than the e2e
harness account, for the same reason C10X-49 gives: nothing here needs to be parked on an
account another layer signs into every run.

### 4.1 Grants BEFORE (baseline, both sites)

`information_schema.role_table_grants`, `grantee='authenticated'`:

```
deck               |DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE
flashcard          |DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE
generation_session |DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE
```

`deck` and `flashcard` are dumped alongside `generation_session` and **never touched by
either site** — unlike C10X-49, this ticket's two branches sit before any deck exists
(newDeckName's `createDeck` is deferred to the success path, past both catch blocks), so a
single revoke is sufficient at both sites and the write-up says so rather than copying "two"
from the sibling.

### 4.2 Site A — transport failure, one revoke

```sql
revoke insert on public.generation_session from authenticated;
```

`has_table_privilege('authenticated','public.generation_session','INSERT')` → **f**.

A bogus `OPENROUTER_API_KEY` was set in `.env` (`sk-or-v1-bogus-c10x50-manual-run-…`) and the
dev server restarted to pick it up — confirmed live: the mock-mode banner **disappeared** from
`/generate`, proving the key was read as configured rather than absent.

**Run 1 — the real form, clicking Generuj.** Deck name `C10X-50 phase4 site A`, source text
marked `[c10x50-siteA]`. The banner rendered:

```
Nie udało się wygenerować fiszek, a szczegóły tego błędu nie zostały zapisane — nie wpływa to
na Twoje fiszki. Spróbuj ponownie.
```

with a **"Ponów" button present** — expected and different from C10X-49's sibling run:
`retriable` stays `true` on both of this ticket's arms (D-09), so the button must survive
where C10X-49's did not. Clicking it produced a second `POST /api/generate`,
**status 502** (network-panel capture).

**Run 2 — `fetch` from the page context, verbatim on the wire** (fresh marker
`[c10x50-siteA2]`, same account, same revoked state):

```
status = 502
body   = {"error":"Nie udało się wygenerować fiszek, a szczegóły tego błędu nie zostały zapisane — nie wpływa to na Twoje fiszki. Spróbuj ponownie.","retriable":true}
```

**Read directly in psql** — no session, no deck, for either marker:

```
select count(*) from generation_session gs join auth.users u on u.id=gs.user_id
where u.email='c10x50-phase4@example.com';  →  0

select d.name from deck d join auth.users u on u.id=d.user_id
where u.email='c10x50-phase4@example.com';  →  (0 rows)
```

Zero decks is not a coincidence of this run — it is structural at this site (§4.1): the
`newDeckName` deck is created only after `generateCandidates` returns, and here it never
does.

**Control run — one variable, a different answer.** `INSERT` re-granted, bogus key kept, a
fresh deck name (`C10X-50 phase4 control`) and marker (`[c10x50-siteA-control]`):

```
status = 502
body   = {"error":"Nie udało się wygenerować fiszek. Spróbuj ponownie.","retriable":true}
```

— the **ordinary** literal, no audit clause. And in the database:

```
 id     | status | source_text                                                                | error_message        | saved_count
 106846 | failed | [c10x50-siteA-control] Wire capture for the control run, grant restored.  | OpenRouter HTTP 401  | 0
```

A landed `failed` row, `error_message = "OpenRouter HTTP 401"` — proof a REAL call was made
with the bogus key rather than the request short-circuiting to `mockCards` (which would carry
no `(mock)`-suffixed `model` and no such error). One privilege apart, two different bodies,
two different database outcomes — the pair a single run cannot give.

### 4.3 Site B — zero-saved, one revoke, via the temporary spec

`generation_session` `INSERT` revoked again (`has_table_privilege` → **f**). §6.9's second
double, admissible on its own terms (plan §Phase 4 item 2): unreachable otherwise (`mockCards`
always passes Zod), temporary, run alone, deleted, deletion proved, explicitly not precedent —
`tests/generation/tmp-c10x50-site-b.test.ts`, reusing `failure-path.test.ts`'s confined
`astro:env/server` + pass-through `fetch` double verbatim, queuing one card that breaches
`FRONT_MAX` so `saved === 0` for its real reason.

**Run 1 — revoked**, `npx vitest run tests/generation/tmp-c10x50-site-b.test.ts
--disable-console-intercept --reporter=verbose` (the flag was needed: `--disable-console-intercept`
is what makes the printed wire capture visible — C10X-48's own recorded trap):

```
C10X50_ACCOUNT_EMAIL harness-a-msru13px@example.com
C10X50_SOURCE_TEXT   [msru14my:c10x50-site-b] zero-saved audit-insert reachability probe
C10X50_STATUS        422
C10X50_BODY          {"error":"Model nie zwrócił poprawnych fiszek, a szczegóły tego błędu nie zostały zapisane — nie wpływa to na Twoje fiszki. Spróbuj ponownie.","retriable":true}
 ✓ 1 passed (1)
```

psql, scoped by the printed marker: **0 rows**.

**Run 2 — control**, `INSERT` re-granted, same file, same invocation (a fresh `harness-a-…`
account and a fresh `Date.now()` marker every invocation — globalSetup re-provisions on each
process start, so the two runs never collide):

```
C10X50_ACCOUNT_EMAIL harness-a-msru1g03@example.com
C10X50_SOURCE_TEXT   [msru1gvs:c10x50-site-b] zero-saved audit-insert reachability probe
C10X50_STATUS        422
C10X50_BODY          {"error":"Model nie zwrócił poprawnych fiszek. Spróbuj ponownie.","retriable":true}
 ✓ 1 passed (1)
```

psql: **1 row landed**:

```
 id     | status | source_text                                                          | error_message                      | generated_count | saved_count
 106847 | failed | [msru1gvs:c10x50-site-b] zero-saved audit-insert reachability probe | Model nie zwrócił poprawnych kart  | 1                | 0
```

`error_message` is the fixed Site-B literal (never the upstream string, per this site's own
contract), `generated_count > 0` and `saved_count = 0` is the pair that separates this branch
from Site A's. One privilege apart, two different bodies, two different database outcomes —
the same shape as Site A's pair.

**Deletion, proved rather than assumed.**

```
rm tests/generation/tmp-c10x50-site-b.test.ts
git status --porcelain -uall -- tests/   →  (empty)
grep -rn "c10x50-site-b|tmp-c10x50-site-b" (excluding node_modules)  →  (empty)
```

### 4.4 Restore, verified by three catalogue oracles plus the suite

`INSERT` was already re-granted by both control runs, so the three oracles below cover the
one table both sites touched:

1. **`information_schema` projection — identical to the §4.1 baseline, line for line**, all
   three tables back to `DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE`.
2. **Raw ACL from `pg_class.relacl`**, compared against the two sibling tables neither site
   ever touched:

   ```
   deck               |{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
   flashcard          |{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
   generation_session |{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
   ```

   Byte for byte identical across all three.

3. **Behaviourally** — `has_table_privilege('authenticated','public.generation_session','INSERT')`
   and `…('public.deck','INSERT')` both **t**.

Then the fourth, behavioural check the three catalogue reads cannot give: the full suite —
**467 passed / 467, 38 files**, seed `1786644587897`, exit 0 — the same figure Phase 3
recorded, unmoved by anything in this phase. `git diff -- src/` empty; `git diff -- supabase/`
empty (no migration, this change ships none). `.env` restored to its pre-Phase-4 content
(the bogus `OPENROUTER_API_KEY` block added and removed, nothing else touched — confirmed by
re-reading the file rather than by memory); no `.dev.vars` exists.

### 4.5 What this phase proves, and what it does not

- **It proves both branches are reachable in production and answer with the new body — the
  half no committed test can reach (§3.7's B5).** Site A's response, Site B's response and
  their psql pairs are each one-privilege-apart, so a message that fires on every failure is
  ruled out by the control.
- **It says nothing about delivery.** `npm run dev`'s `astro dev` process never loads
  `src/worker.ts`, so `Sentry.captureException` ran with no client configured on every run in
  this phase — the same "no-op with no client" state the test runner is in, and the same
  state `generate.ts`'s own header comment names ("under `npm run dev` without a DSN"). That
  every one of the four provoked requests above answered 502/422 rather than an uncaught
  framework 500 is the incidental evidence the plan calls for (criterion 4.6): a throw inside
  the capture statement would have replaced the intended status with a 500, and none did.
  This is **not** proof an event arrived anywhere — D-05 and `follow-ups/sentry-delivery.md`
  own that boundary, unchanged by this phase.
- **The account's artifact of record is one `failed` row, not an orphan deck.** Unlike
  C10X-49, both of this ticket's branches sit strictly before deck creation (§4.1), so there
  is no deck to leave behind — `c10x50-phase4@example.com` ends this phase holding exactly the
  Site-A control run's row (`106846`) and zero decks.
- **Nothing bridges §3 and §4.** The suite owns each helper's contract on its landed arm
  (Phase 3, and the four pre-existing `failure-path.test.ts` cases); this phase owns each
  endpoint's use of the failure arm; no test in this project can join them, for the same
  structural reason C10X-49's `research.md` §8 gives for its own branch.
- **These are observations, not regression guards.** Nothing re-runs them, and a future edit
  to either branch will not turn anything red.
