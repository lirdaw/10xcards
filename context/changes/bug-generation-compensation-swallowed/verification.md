# Verification — C10X-48 `bug-generation-compensation-swallowed`

Every figure below comes from a run executed on **2026-08-13** against the tree at Phase 5,
local stack up, `OPENROUTER_API_KEY` unset. Splits are per-file (`tests/generation/generate.test.ts`,
**26** cases) unless the row says otherwise, because that is the denominator each run was measured
against; the full-suite figure is stated once, here, and not repeated per run.

## 1. Gates

| Gate                         | Result                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm test`                   | **434 passed / 434, 36 files**, seed `1786609020668`, exit 0                                             |
| `npm run typecheck`          | `Result (151 files): 0 errors, 0 warnings` — `typecheck: OK — 151 files checked (floor 50)`, exit 0      |
| `npm run lint`               | exit 0, **3** warnings, all `no-console` in `evals/generation-quality.eval.ts` — pre-existing, unchanged |
| `npm run build`              | exit 0 (the standing `@astrojs/sitemap` "requires the `site` astro.config option" warning, unchanged)    |
| `git diff -- src/ supabase/` | **empty** after every breakage restore, and each restore additionally verified by per-file `md5sum`      |

**Suite delta: 430 → 434, files unchanged at 36.** The +4 are the four cases Phase 5 §1 adds to
`tests/generation/generate.test.ts` (22 → 26). No other file gains or loses a case, and no
`supabase/` file is touched at all — this change ships no migration.

Pristine hashes, taken before the first breakage edit and re-checked after every restore:

```
0f69047609b94085b434f51302fa2c57 *src/pages/api/generate.ts
55a8d3febfe62603a38313ac889062ca *src/lib/generations.ts
d7e2c7432a1f805cc4f7f0b1218197d1 *src/lib/generation-replay.ts
ec328b1b9451d5cc808cda7cfb19d7bb *tests/generation/generate.test.ts
```

## 2. Deliberate-breakage runs

Five code runs rather than the plan's four. The fifth exists because **run 1 as the plan worded it
did not go red**, and the honest completion of a green breakage run is a second run that reaches
the state the first one was aiming at — not a rewritten prediction.

### Run 1 — remove the confirmation between the key-clearing update and the fall-through

Edit: `generate.ts`'s `const { data: cleared, error: clearError } = await clearSessionIdempotencyKey(...)`
plus its `if (clearError || !cleared)` refusal collapsed to a bare `await clearSessionIdempotencyKey(...)`.

**Observed: 0 of 26 red** — `Tests  26 passed (26)`, seed `1786608731035`.

The plan predicted research §7's `23505` loop and it did **not** appear, for a reason worth writing
down rather than smoothing over: **the confirmation guards a state a healthy stack never produces.**
On this machine the clear always lands, so removing the check that it landed is observationally a
no-op. A breakage run that stays green is a claim about the EDIT before it is a claim about the
guard — the same discipline C10X-40 records against its own failed `sed`.

### Run 1b — the pair: run 1's edit, plus a clear that does not clear

Edit: run 1's, **and** `clearSessionIdempotencyKey`'s payload changed from `{ idempotency_key: null }`
to `{ error_message: null }`, so the UPDATE still matches its row (and still returns `data`) while
the key survives.

**Observed: 4 of 26 red.**

| Case                                                             | Failure string                 |
| ---------------------------------------------------------------- | ------------------------------ |
| clears a POISONED key and generates…                             | `expected 500 to be 200`       |
| heals a session the USER emptied without rewriting its audit row | `expected 500 to be 200`       |
| makes a ZERO-ROW compensating write visible to its caller        | `expected '<uuid>' to be null` |
| adopts an owned EMPTY deck on the healed newDeckName path        | `expected 500 to be 200`       |

The three `500`s are the loop, and the **body** is what proves it rather than the status. Captured
with a temporary `console.log` in the poisoned case (removed immediately; the file's `md5sum` is
identical before and after, see §1):

```
PROBE 500 {"error":"Nie udało się zapisać sesji generacji. Spróbuj ponownie.","retriable":true}
```

That copy exists at exactly one site — the `23505` branch's healed-refusal arm — and it is
reachable only after `createGenerationSession` collides on
`generation_session_idempotency_key_uidx`. So the fall-through did carry the still-live key into a
second session insert, collided, found the same empty row, and answered a 500 **after** paying for
a generation. Research §7's prediction is confirmed; only the neuter that reaches it is bigger than
the plan assumed.

### Run 2 — the classifier's empty arm points back at the query-failure arm

Edit: `generation-replay.ts`, `if (!outcome.data) return { kind: "empty" }` →
`return { kind: "query-failed" }`.

**Observed: 3 of 26 red** in `generate.test.ts`, plus **1 of 5 red** in
`tests/lib/generation-replay.test.ts` (combined run: `4 failed | 27 passed (31)`).

```
FAIL  classifyReplay > classifies a successful lookup that found no cards as empty
      AssertionError: expected { kind: 'query-failed' } to deeply equal { kind: 'empty' }
FAIL  clears a POISONED key and generates…                              expected 500 to be 200
FAIL  heals a session the USER emptied…                                 expected 500 to be 200
FAIL  adopts an owned EMPTY deck on the healed newDeckName path         expected 500 to be 200
```

**What stayed green is the evidence.** "makes a ZERO-ROW compensating write visible to its caller"
never touches the classifier, and it passed — so the three endpoint reds attribute to the
classification and not to the write beneath it. Two files going red on the same edit, on two
different assertions, is also what shows the pure extraction and its consumer are wired to each
other rather than agreeing by coincidence.

### Run 3 — neuter `clearSessionIdempotencyKey`'s `idempotency_key: null`, confirmation INTACT

Edit: run 1b's second half alone.

**Observed: 4 of 26 red — the identical set to run 1b.**

**The plan's prediction was wrong and this is the run's real finding.** It said "the cleared-key
assertion goes red while the generation assertion stays green". Both go red, because the
confirmation asserts that a row was **MATCHED**, never that the key is **GONE**. An update that
finds its row and writes the wrong column satisfies `!cleared === false`, so the request falls
through into precisely the collision the confirmation exists to prevent.

That bounds what the safety property buys, and the boundary belongs in the record: the
confirm-before-fall-through step protects against a clear that matched **nothing** (the RLS /
vanished-row case, which is the case `.select()` was added for and which the cross-account test
below pins). It does not, and cannot, protect against a clear that matched the right row and did
the wrong thing — that failure mode is held by the helper's own body plus the assertion in the
poisoned-row case, not by the ordering.

### Run 4 — drop the heal-gate from the adoption rule

Edit: `generate.ts`, the `if (existing && !healedKey) return json(409, …)` block deleted, so any
owned deck of that name enters the adoption path.

**Observed: exactly 1 of 26 red.**

```
FAIL  /api/generate creates the deck inline on the newDeckName path > 409s a newDeckName that is already taken
      AssertionError: expected 200 to be 409
```

And its twin — "409s the second newDeckName request without a session", whose deck this endpoint
generated into and which therefore carries cards — **stayed green**. That split is the whole
evidence for D-06: the gate is the **healed path**, not emptiness. Gate on emptiness alone and a
deck the user deliberately made and left empty gets silently generated into.

## 3. The reachability run (manual, uncommitted, DCL)

The half no committed test covers: that `/api/generate` can **produce** the poisoned row. Driven
once, by hand, with the suite **not** running, from a temporary spec that was deleted afterwards
(the tree carries no `tests/generation/reachability-probe.test.ts`; `git status` after the run
listed only `plan.md` and `generate.test.ts`).

**Grants BEFORE** (`information_schema.role_table_grants`, `grantee='authenticated'`):

```
flashcard|DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE
generation_session|DELETE INSERT REFERENCES SELECT TRIGGER TRUNCATE UPDATE
```

**Two revokes, not one.** `revoke insert on public.flashcard from authenticated` is what makes
`insertCandidates` fail; `revoke update on public.generation_session from authenticated` is what
makes the compensation fail **on top of it**. Either alone reproduces nothing: the first gives an
ordinary, correctly-compensated card-insert failure, the second is never reached. Dump taken while
revoked confirmed `INSERT` absent from `flashcard` and `UPDATE` absent from `generation_session`,
everything else untouched.

**The request** — one keyed generation into an owned, existing deck:

```
status = 500
body   = {"error":"Nie udało się zapisać wygenerowanych fiszek, a wycofanie nieudanego zapisu nie powiodło się. Spróbuj ponownie.","retriable":true}
```

That is Phase 2's distinct copy, carrying `retriable: true` — i.e. the failure this ticket was
reported for is now **nameable in the response**, which before this change it was not, at all, on
any channel (nothing in `src/` writes a log line, and nothing in this project reads a log sink).

**The row, read directly in psql** (`select … , (select count(*) from flashcard f where f.generation_id = s.id)`):

```
105680|succeeded|3|3|t|0
105679|succeeded|3|3|t|0
```

`status='succeeded'`, `saved_count=3`, `generated_count=3`, `idempotency_key` NOT NULL — and
asserted in-process to be **the request's own key** — with **zero cards** behind it. That is the
poisoned row, produced by the shipped endpoint, exactly as research §2 describes it. There are two
because the probe ran twice: the first run's `console.log` was swallowed by Vitest's `agent`
reporter (`silent: "passed-only"` — the fact test-plan §6.6's C10X-42 entry records), and it was
re-run with `--disable-console-intercept`. Both rows are left in the local dev DB deliberately:
they belong to that run's throwaway accounts, so nothing can ever reach them again, and deleting
the evidence immediately after recording it buys nothing.

**Restore, verified by three oracles rather than by memory.** `grant insert on public.flashcard to
authenticated; grant update on public.generation_session to authenticated;` then:

1. the same `information_schema` projection — **identical to the BEFORE dump**, line for line;
2. the raw ACL from `pg_class.relacl`, compared against a sibling table the run never touched —
   `deck`, `flashcard` and `generation_session` all read `authenticated=arwdDxtm/postgres`, byte
   for byte. This is the independent oracle: it is a different catalogue, a different projection,
   and it carries its own control;
3. behaviourally — `has_table_privilege('authenticated','public.flashcard','INSERT')` and
   `…('public.generation_session','UPDATE')` both `t`.

Then the full suite, which exercises both grants on every generation case: **434/434 green.**

**WHAT THIS RUN PROVES AND WHAT IT DOES NOT.** With the grant revoked the compensating UPDATE
returns an **error**, so this is evidence about the **error arm** only. The **zero-row** arm — where
PostgREST answers `{ data: null, error: null }` and `if (error)` alone would still have swallowed
it, which is the case `.select("id").maybeSingle()` was actually added for — is proved instead by
the committed cross-account test ("makes a ZERO-ROW compensating write visible to its caller, on
both helpers"), which drives account B's client at account A's session under RLS. That is the
stronger evidence of the two: it is a regression guard that runs on every `npm test`, where this is
a one-off observation nothing re-checks.

## 4. What is NOT proved here

- **No test in this suite can produce the poisoned row.** D-04 stands: no fabricating transport
  seam, no DDL/DCL inside the suite. The consequence half is committed; the reachability half is
  the one run above and nothing re-runs it.
- **The island half**, as always (test-plan §7). Phase 4's `retriable` read and the stale-gate fix
  rest on the browser matrix recorded against Phase 4's Progress rows; no layer in this project
  reaches an island's JSX.
- **Nothing about the cloud.** Every assertion above ran against the local stack, and D-05 leaves
  already-poisoned production rows alone — they are inert until someone replays that key, and the
  heal clears it at that moment.
- **The `:387` twin and the two failure-path inserts.** Still best-effort, owned by C10X-49 and
  C10X-50 respectively, and annotated as exceptions at their sites.
