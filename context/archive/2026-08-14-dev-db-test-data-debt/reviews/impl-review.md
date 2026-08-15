<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Local dev-DB test-data debt

- **Plan**: `context/changes/dev-db-test-data-debt/plan.md`
- **Scope**: full plan — Phases 1–5 of 5
- **Date**: 2026-08-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Success criteria — re-run rather than cited

Every automated criterion was re-executed against the tree at `cab5da8`:

| Command             | Result                                               |
| ------------------- | ---------------------------------------------------- |
| `npm test`          | **563 passed (563), 43 files**, seed `1786747458700` |
| `npm run typecheck` | **OK — 163 files checked**, 0 errors, 0 warnings     |
| `npm run lint`      | **0 errors, 3 warnings** (standing, `evals/`)        |
| `npm run e2e`       | **12 passed** (22.2 s)                               |
| `prettier --check`  | all changed markdown + `package.json` clean          |

Manual criteria independently corroborated rather than taken from `verification.md`:

- **4.5 / 4.6** — all seven artifact decks queried back by owner and name, present with their
  original `created_at`; the orphan `3b720154-…` returns `count 0`.
- **2.5 / 4.8** — live `pg_policies` dump compared against `supabase/.temp/neuter/policies-before.txt`:
  the four neutered policies carry their real predicates (`deck_select` reads
  `(user_id = ( SELECT auth.uid() AS uid))`, not `true`). The only diff is a column-set mismatch
  between the two dump shapes.
- **4.3** — the snapshot exists at 27,944,305 bytes and `git check-ignore -v` resolves it to
  `supabase/.gitignore:3`.
- **5.4** — the archive diff is `@@ -415,3 +415,49 @@`, a pure tail append; exactly one `-` line
  in the whole diff and it is the `---` file header.
- **1.6** — `roadmap.md:75` carries `in progress`; `H-21` appears nowhere in `## Done`.

Two independent checks beyond the criteria: `plan.md`'s own diff contains **only** Progress
checkboxes and commit SHAs (no retroactive plan editing), and `roadmap.md`'s diff is additive with
the rest of the table merely re-padded by prettier.

## Findings

### F1 — The LIKE pattern is string-interpolated into SQL on the DELETE path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/db-cleanup.ts:167-201
- **Detail**: `censusStatement(pattern = HARNESS_EMAIL_PATTERN)` and
  `deleteStatement(pattern = HARNESS_EMAIL_PATTERN)` both build SQL by template interpolation with
  no escaping and no validation. No runtime caller supplies an argument — `run-db-cleanup.ts:106`
  and `:156` both call bare — so this is **latent, not live**, which is why it is not CRITICAL. But
  the parameter is an exported public entry point that is _already exercised with a caller-supplied
  value_ (`tests/lib/db-cleanup.test.ts:202-209` passes `"fabricated-prefix-%"`), and psql runs
  `-c` as multiple statements, so `deleteStatement("'; delete from public.deck; --")` yields a
  valid statement-splitting payload against `auth.users`. The docblock at `:47-51` defends the
  parameter as safe _because it is documented_ ("never reaches either function from a caller's
  input") — which is precisely the shape this repo's own guards exist to reject:
  `tests/lib/no-env-access.test.ts` opens with "A prose rule nothing enforces is not a rule", and
  this very change added `deck-name-stems.test.ts` on that exact argument.
- **Fix**: Validate the pattern at the top of both builders, e.g.
  `if (!/^[A-Za-z0-9%_@.\-]+$/.test(pattern)) throw new Error(...)`.
  - Strength: One line each; converts the safety claim from a comment into a property, in the same
    move the change itself makes for the stem rule. The existing test's fabricated pattern still
    passes unchanged.
  - Tradeoff: None material — the guard is stricter than any pattern this module would ship.
  - Confidence: HIGH — the injection path was traced to a concrete payload; the fix is local.
  - Blind spot: None significant.
- **Decision**: FIXED

### F2 — The JS `LIKE` mirror diverges from Postgres on backslash, and its scope comment states the divergence backwards

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/db-cleanup.ts:69-83
- **Detail**: Postgres `LIKE` has a **default escape character of backslash** — no `ESCAPE` clause
  is needed for `LIKE 'a\%'` to match a literal `a%`. `matchesLikePattern` escapes `\` as a regex
  literal (`:78`) and then translates `%` unconditionally (`:79`), so for any pattern containing a
  backslash the mirror and the database disagree about which rows match. The docblock's
  "No `ESCAPE` clause, and case-SENSITIVE" reads as "backslash is not special", which is the
  opposite of Postgres's behaviour. No live defect: `HARNESS_EMAIL_PATTERN` contains no backslash.
  It matters because this function is the **only assertable proxy for the delete predicate** — the
  whole-set positive control at `db-cleanup.test.ts:85-88`, the file's stated reason for existing,
  is evidence about the delete _only while the mirror is faithful_, and a pattern change is exactly
  when someone would lean on it hardest.
- **Fix**: Make it fail closed —
  `if (pattern.includes("\\")) throw new Error("backslash is LIKE's default escape; this mirror does not model it")`
  — and correct the "No `ESCAPE` clause" sentence.
- **Decision**: FIXED

### F3 — Both post-delete oracles assert a cause where a concurrent `vitest` run is the likelier one

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/run-db-cleanup.ts:162-180
- **Detail**: The census, the delete and the re-census are three separate `docker exec`
  invocations — three transactions, no snapshot between them. A `vitest` run in another terminal
  mints ~2 harness accounts and ~68 decks per invocation. If one lands between `:156` and `:158`,
  ORACLE 1 prints "the delete did not do what it reported", which is false: the delete did exactly
  what it reported and new rows arrived afterwards. Data-safe (exit 1, nothing extra removed), but
  it is the class this file's own `catch` block was rewritten to avoid and which it names by
  citation — "A wrapper can be right about the exit code and wrong about the diagnosis … C10X-43's
  `readTscFailure`". The `catch` enumerates candidates; these two branches assert one. Secondary
  and much less likely: ORACLE 2 compares `other` as a scalar count, not an identity set, so a
  concurrent non-harness insert could numerically mask a non-harness deletion — worth knowing as a
  bound on what the invariant proves, not worth engineering around.
- **Fix**: Add "a `vitest` run in flight — harness rows are created ~2 accounts / ~68 decks per
  invocation" as the first candidate in ORACLE 1's message, matching the enumerated style already
  used at `:199-203`.
- **Decision**: FIXED

### F4 — No `timeout` on `execFileSync`, and one call sits after the irreversible operation

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/run-db-cleanup.ts:83-102
- **Detail**: `maxBuffer: 32 * 1024 * 1024` is right and the default `stdio` correctly surfaces
  stderr on throw. The absent `timeout` is pattern-consistent (`disable-kong-keepalive.ts:79` has
  none either), but the consequence differs here: a wedged Docker daemon during the **post-delete**
  census at `:158` hangs after `db:clean: deleting harness accounts…` has already printed, leaving
  the operator with no way to tell whether the delete landed. Elsewhere in `scripts/` a hang is
  merely a hang.
- **Fix**: Add `timeout: 120_000` to the `psql` helper's options, turning an ambiguous hang into a
  named failure the `catch` block can explain.
- **Decision**: FIXED

### F5 — `readProjectId`'s regex now exists twice in `scripts/`, byte-identical

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/db-cleanup.ts:114 (and scripts/disable-kong-keepalive.ts:72)
- **Detail**: `/^\s*project_id\s*=\s*"([^"]+)"/m` is now in both files. The new module's own
  docblock argues against exactly this shape — "Deriving the predicate FROM
  `HARNESS_EMAIL_PATTERN` rather than hand-writing a second `startsWith` is the point: two
  spellings of one rule is the drift this project has recorded more than once." The new copy is the
  better one: pure, takes the text as an argument, and tested against real `config.toml` including
  the commented `[auth.third_party.firebase]` decoy. The kong runner's copy has none of that
  coverage. Impact is low because divergence surfaces loudly as an unknown-container error.
- **Fix**: Have `disable-kong-keepalive.ts` import the tested `readProjectId`, so the decoy case
  starts protecting both callers.
- **Decision**: FIXED

### F6 — The reference sets' non-emptiness is justified by measurement where the code guarantees it by construction

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/study/study.test.ts:452-457 (and tests/review/candidates.test.ts:650-656)
- **Detail**: Both agents converged on this independently. The comments defend "the set is never
  empty" by measurement across shuffle permutations — "3, 4, 16 and 17" and "2, 2, 10, 12". True,
  but weaker than what the code actually guarantees: the case's **own** `createDeck(a, …)` at
  `study.test.ts:426` and `seedCard(a, withCandidates, …, STATE_GENERATED)` at
  `candidates.test.ts:621-622` both run above the assertion, so the floor is **1 in every
  permutation** and the new claim strictly subsumes the pre-existing single-deck absence. As
  written, a future reader who moves deck creation into a shared `beforeAll` would not know which
  property they were relying on — and the measured range would still read as reassuring after the
  guarantee had been removed.
- **Fix**: State the construction argument in both comments — the floor is 1 because the case's own
  create/seed call above the assertion pushes into the set; the measured 3–17 / 2–12 range is only
  how much _extra_ falsifiability shuffle happens to buy.
- **Decision**: FIXED

## What was verified clean and is recorded so it is not re-derived

- **No path reaches a cloud database.** `process.env`, `SUPABASE`, `http`, `postgres://`, `PGHOST`,
  `connectionString` and `--host` all return nothing across both scripts. The only external inputs
  are `process.argv` and one `readFileSync` pinned by `import.meta.url`. `execFileSync` invokes no
  shell, and `dbContainerName` prefixes `supabase_db_`, so a hostile `project_id` can never begin
  with `-` and be read by `docker` as a flag. Local-only **by construction**, as claimed.
- **The delete's scope is correct.** `-` is a literal in LIKE and the pattern carries no `_`;
  Postgres LIKE is case-sensitive so `Harness-…` under-matches (fail-safe); `NULL LIKE …` is NULL
  so null-email rows are not matched. `e2e-harness@example.com` is spared and has its own named
  case.
- **The cascade set has no blind table.** Checked against the migrations: only `deck` and
  `generation_session` reference `auth.users`, both `on delete cascade`; `flashcard` and
  `flashcard_schedule` cascade transitively; `flashcard_state`, `flashcard_source` and `language`
  carry no `user_id`. `CENSUS_TABLES` covers exactly the affected set.
- **The invariants are real captures, not self-comparisons.** `before` at `:128` (pre-delete),
  `after` at `:158` (post-delete); a parse failure throws rather than coercing, so no path
  manufactures a `0`.
- **Neither new guard can pass vacuously.** `deck-name-stems.test.ts` was re-run by extracting its
  two seam regexes and executing them over the real tree: 43 files walked, all four resolution
  paths genuinely resolve, no phantom `as` stem, `sharedStems` empty across 71 distinct stems, and
  re-planting `Gate deck` produces exactly one finding naming both files. `db-cleanup.test.ts`'s
  whole-set control asserts both directions in one case over **fourteen real addresses** read out
  of `auth.users`, and `:202-209` closes the blindness that every default-pattern assertion would
  pass over a hardcoded implementation.
- **The guard has no under-reach today**: the only deck-creating seam outside `.test.ts` is the e2e
  spec, deliberately skipped (different account, own teardown).
- **Pattern compliance with `scripts/`'s pair convention is complete** — module split, line-1 block
  `eslint-disable no-console` with the exemplars' wording, zero runtime dependencies, explicit
  `.ts` import extensions, `main(): number` + `process.exitCode` + enumerated-guidance `catch`,
  `CONFIG_TOML` from `import.meta.url`, and `ON_ERROR_STOP=1` as the "exit code is not the oracle"
  discipline.

## Two deliberate widenings, both self-reported (not findings)

- **`db-cleanup.test.ts` fixtures 14 non-harness emails, not the plan's 7** (`:51-66`), recorded at
  `verification.md:494-509`: the plan's seven counts accounts owning artifact _decks_, but the
  delete's blast radius is _accounts_. Strictly stronger, and the set contains the sharpest decoy,
  `e2e-harness@example.com`.
- **Phase 5 target 1 was re-scoped after its premise was checked** (`verification.md:945-970`). The
  plan asserted §2 and §6.6 imply `study_due_cards` is in the vulnerable class; a grep found §2
  mentions neither RPC and no sentence was actually false. So the edit shipped as a
  _disambiguation_ rather than a retraction, the non-edit to §2 is recorded so nobody hunts for it,
  and §6.7 was added as a third target — what a contributor reads immediately before typing a
  neuter. A departure from the plan's letter that better serves its intent.

## One number worth knowing

The plan says the neuter window ran at **~20,748 decks**; the recorded figure is **21,345**
(`verification.md:4`, `:41-47`). Not drift — 20,748 was the planning-time census on 2026-08-14 and
the database kept growing until the window opened. The **measured** number is what propagated into
the code comments and `test-plan.md`, which is the correct direction.

## Triage outcome — 2026-08-15

All six findings **FIXED**. Applied, then verified:

| Gate                | Before triage        | After triage                      |
| ------------------- | -------------------- | --------------------------------- |
| `npm test`          | 563 / 43 files       | **565 / 43 files**                |
| `npm run typecheck` | 163 files, 0 errors  | 163 files, 0 errors               |
| `npm run lint`      | 0 errors, 3 warnings | 0 errors, 3 warnings              |
| `npm run db:clean`  | —                    | census only, deletes nothing      |
| `npm run db:kong`   | —                    | `already applied — nothing to do` |

The **+2** is one case per new guard, and that is not incidental: F1's whole content is that this
project rejects a rule nothing enforces, so closing it with another unenforced rule would have been
the finding wearing the costume of a fix. Both new guards were proved falsifiable by a neuter rather
than by reading, each reddening **exactly its own case** with the other 33 green:

| Neuter                                                        | Observed                                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `assertPatternIsSafe(pattern)` dropped from `deleteStatement` | **1 of 34 red** — "refuses a pattern that could break out of the SQL string literal"     |
| the backslash `throw` dropped from `matchesLikePattern`       | **1 of 34 red** — "refuses a pattern carrying a backslash rather than mistranslating it" |

`scripts/db-cleanup.ts` restored from a pristine copy after each, `md5sum -c` **OK** both times
(`106140f34cf0134342ab30867b0c0a3e`).

F5 was verified at **runtime**, not only by the type gate: `npm run db:kong` resolved `project_id`
through the now-shared `readProjectId` and found its container. That run also re-read the
non-harness invariant as **14 / 7 / 41 / 3 / 11** — the same five figures `test-plan.md` records —
so the safety invariant is unmoved by this triage.

One correction propagated out of the triage, in the shape this project keeps catching itself in:
`test-plan.md`'s header, §6.6 entry and §8 entry all carried **563**, the pre-impl-review figure.
Each is left standing with a dated correction beneath it rather than rewritten — C10X-40, C10X-46
and C10X-48 each recorded the identical slip, which is why the §8 block says so explicitly.

**Deliberately not fixed**, and recorded so it is not read as an omission: ORACLE 2's message was
left as it stands. F3's agreed scope was ORACLE 1, and ORACLE 2's scalar-count bound is stated in
F3's Detail as a limit on what the invariant proves rather than as a defect to engineer around.
