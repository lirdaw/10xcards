# Local dev-DB test-data debt — Implementation Plan

## Overview

Repay the accumulated test data in the local dev database, give the repayment a repeatable
tool, close the one reproduced flake, and — before the repayment makes it impossible —
convert research's central inference into a measurement.

The debt's cost is narrow and specific: it does not slow the suite, fill a disk, or redden a
run. It disarms the project's **deliberate-breakage procedure**, which is the instrument every
`§6.6` coverage claim in `test-plan.md` rests on. Two assertions asserted as "absent from an
unbounded result set" now pass while the guard they test is fully disabled.

## Current State Analysis

Measured directly on `supabase_db_10x-astro-starter` at planning time (2026-08-14), and these
figures reproduce research's post-research table exactly:

| Table                  |   Rows |
| ---------------------- | -----: |
| `auth.users`           |  1,482 |
| — of which `harness-*` |  1,468 |
| `deck`                 | 20,748 |
| `flashcard`            | 35,810 |
| `flashcard_schedule`   |  6,817 |
| `generation_session`   |  9,352 |

99.94 % of decks belong to `harness-*` accounts. Growth is **68 decks + 2 auth users per
`vitest` invocation** — the users are paid even by a filtered single-file run, because
provisioning is in `globalSetup` (`tests/setup/accounts.ts:9-13`).

**Eight non-harness decks exist and every one is an artifact of a recorded manual run.** All
eight were confirmed present at planning time. Seven must survive this change; the eighth is
the orphan this ticket is chartered to delete:

| Deck                             | Owner                                     | Disposition |
| -------------------------------- | ----------------------------------------- | ----------- |
| `C10X-41 Faza 4`                 | `c10x41-phase4@example.com`               | survives    |
| `C10X-37 Faza 2 po zmianie`      | `c10x41-phase4@example.com`               | survives    |
| 100-char name (C10X-37 P4 probe) | `c10x37-p4-manual@example.com`            | survives    |
| **`E2E deck 1785947414992`**     | **`test@mail.com`**                       | **deleted** |
| `Matryca 4.11`                   | `e2e-harness@example.com`                 | survives    |
| `C10X-49 orphan X`               | `c10x49-phase3@example.com`               | survives    |
| `C10X-49 orphan X2`              | `c10x49-phase3@example.com`               | survives    |
| `C10X52 Study Probe`             | `manual-c10x52-p5-1786720259@example.com` | survives    |

`test-plan.md` states of the two `C10X-49 orphan` decks that they are "left in the local dev DB
**as the artifact of record**". That sentence is the decisive argument against
`npx supabase db reset` and for a narrow, pattern-scoped delete.

## Desired End State

- The local dev database holds only the non-harness artifact rows plus whatever the current
  session's runs created. The seven artifact decks above are provably intact; the orphan is gone.
- `npm run db:clean` exists, reports before it deletes, and can repay the debt again in one
  command without a human remembering a SQL statement.
- The two absence-assertions can no longer decay: their oracle is **test-local**, so no policy the
  breakage procedure disables can feed it, and they are falsifiable precisely on the repaid
  database this change creates and `db:clean` maintains.
- The `Gate deck` collision cannot recur, and the class behind it is written down.
- Research's inferred false pass is a **measurement** on record, taken while the fat database
  still existed.

### Key Discoveries

- **The cascade makes cleanup one statement.** From `pg_constraint` (not `information_schema`,
  which reports cross-schema FKs as absent and would have produced the opposite conclusion):
  `deck.user_id` and `generation_session.user_id` both `ON DELETE CASCADE` to `auth.users`,
  `flashcard.deck_id` cascades from `deck`, `flashcard_schedule.flashcard_id` from `flashcard`.
  Deleting one harness user removes that run's entire footprint. Zero orphaned decks exist.
- **The suite cannot do this itself, in principle.** `assertAnonKey`
  (`tests/setup/env-assertions.ts:36-68`) rejects any non-anon key with no env opt-out, so an
  in-suite teardown reaches only its own run's rows under RLS and can never touch `auth.users`.
  This is why the answer is a script beside the suite, not a hook inside it.
- **`ORDER BY` is what keeps an absence-assertion falsifiable.** Under a simulated neuter, the
  10 newest decks land inside PostgREST's 1000-row window 10/10 times for `listDecks` (orders
  `created_at desc`) but only 4/10 for `candidate_counts_by_deck` and 2/10 for
  `study_due_counts` — both `group by` with no `ORDER BY`, so the window is hash-aggregate order.
- **Defect A is one pair, not a class.** `Gate deck <S>` is the only deck-name stem used by two
  files (`tests/study/study.test.ts:609`, `tests/review/candidates.test.ts:908`), each computing
  its own `const suffix = Date.now().toString(36)` at module scope (`:42`, `:47`). ~30 other
  stems are unique.
- **The `scripts/` pair convention is `<noun>.ts` + `run-<noun>.ts`** (`typecheck.ts` /
  `run-typecheck.ts`), with the pure half tested in `tests/lib/`, the runner carrying
  `eslint-disable no-console`, zero runtime dependencies, and a fail-closed contract.
- **`docker exec supabase_db_10x-astro-starter psql -U postgres -d postgres` works and needs no
  shell.** `execFileSync` never goes near one, so the `MSYS_NO_PATHCONV` trap that bites a
  hand-run `docker exec` does not apply to the runner — the same note `disable-kong-keepalive.ts:87`
  already carries.

## What We're NOT Doing

- **No `npx supabase db reset`.** It destroys the seven artifact decks archived documents cite.
- **No automatic per-run Vitest teardown** (research option C). It cannot reach `auth.users`
  (C-3), cannot repay existing debt (C-2), and destroys post-mortem rows after a red run.
- **No CI hygiene step** (research option D). `.github/workflows/ci.yml:68` starts a fresh stack
  on a throwaway runner every job; nothing accumulates in CI, ever.
- **No `ORDER BY` migration on the two RPCs.** Hardening lands in the assertions, so no migration
  is pushed and the C10X-29 drift gate stays uninvolved.
- **No fix for Defect B**, and no marker experiment here. It gets a follow-up with its
  experiment design; the likely fix widens the retry policy, which is a change to harness
  semantics deserving its own review.
- **No entropy sweep across the 11 files that declare a `suffix`.** One rename plus a recorded
  rule, per the Defect A decision.
- **No action on the 2-users-per-invocation cost.** Named, left, absorbed by `db:clean`.
- **No `db:clean` wiring into `db:start`, a hook, or CI.** Developer-invoked, by decision.

## Implementation Approach

Five phases, ordered by one hard constraint and one soft one.

**The hard constraint is that Phase 2's evidence is perishable.** Research §3 explicitly records
that the four-policy neuter was _not_ executed and that the false pass is inferred. It can be
measured — but only while ~20,748 decks exist. After the repayment both the old and the hardened
assertion go red under a neuter, and the pair that distinguishes them proves nothing. So
hardening and its measurement run **before** the cleanup, not after.

The soft one: Defect A goes first so that every later suite run in this change is free of a
known 3.3 % red rate, and a red during Phase 2's neuter window is unambiguous.

## Critical Implementation Details

**Ordering.** Phase 2's neuter must run against the un-repaid database. If Phase 4 runs first,
Phase 2's central measurement is no longer obtainable and the plan should be re-scoped rather
than the measurement faked from a small dataset.

**The neuter window is a write to RLS policies.** Follow `test-plan.md` §6.6's recorded
procedure exactly: dump `qual`/`with_check` from `pg_policies` **before**, neuter, measure,
restore, dump again, and `diff` the two. §6.6 also records the failure mode this catches — a
heredoc piped to `docker exec` **without `-i`** silently no-ops, and only the before/after diff
notices.

**Restoring a policy is symmetric; restoring a dropped CHECK is not.** This phase neuters
policies only, so the C10X-27 `violated by some row` trap does not apply — but do not widen the
neuter to a constraint without reading that note first.

## Phase 1: Defect A and the roadmap row

### Overview

Remove the reproduced 3.3 % flake by renaming one of two identical deck-name stems, record the
class so it cannot recur silently, and create the roadmap row `/10x-archive` will close.

### Changes Required

#### 1. The colliding literal

**File**: `tests/review/candidates.test.ts`

**Intent**: Rename this file's `Gate deck` stem so the two files can no longer produce an
identical `(user_id, name)` pair when their module-load timestamps land in the same millisecond.
Rename **this** one rather than `study.test.ts`'s, because `study.test.ts`'s stem is the one
`test-plan.md` §6.6's Phase 4 breakage table refers to by name.

**Contract**: The literal at `:908`, currently `` `Gate deck ${suffix}` ``. The new stem must
not match any other deck-name stem anywhere under `tests/` — the sweep that proves it is in the
Success Criteria. Nothing else about the case changes.

#### 2. The rule behind it

**File**: `context/foundation/test-plan.md`

**Intent**: Record the cross-file deck-name collision class in §6.5's namespacing guidance, so
the rename is a closed class rather than a one-off patch. State the mechanism (per-file
`Date.now()` suffixes are only millisecond-resolution, and two files can share one), the oracle
(`deck_delta` of 67 instead of 68 identifies it without reading a log), and the rule: a deck-name
stem is owned by exactly one file.

**Contract**: A new bullet under §6.5's existing "Scope every count twice" namespacing
discussion. It must also name this as the flake C10X-51's §8 entry recorded twice and could not
attribute.

**And it must start the history in the right place, because that is the more valuable half.** The
first recorded sighting is **not** C10X-51: `context/archive/2026-07-29-flashcards-test-order/reviews/impl-review.md:303`
names the mechanism verbatim — `Gate deck ${suffix}` in both files, the cross-file
`Date.now().toString(36)` collision — under the heading **"Deliberately not raised as findings"**,
correctly out of scope by that plan. So it was identified **16 days** before it cost C10X-51 two
unattributable reds and this ticket a 92-run reproduction matrix. Record the second-order rule
beside the first: **a deliberately-deferred finding needs a ticket or an entry in a live document —
a line in one review's not-raised section is invisible to everyone afterwards.** That archive entry
takes **no** dated correction: it was accurate and its scope decision was right; what failed is that
nothing carried it forward.

#### 3. The roadmap row

**File**: `context/foundation/roadmap.md`

**Intent**: Add `H-21` for this change — the summary table row and its detail block — created
during implementation rather than backfilled, following H-16's precedent. Without it
`/10x-archive` has nothing to close and the change vanishes from the roadmap, the mechanism that
has already fired four times here.

**Contract**: `Status: in progress`. The `Status → done` flip and the `## Done` entry are
`/10x-archive`'s and must **not** be written here — `lessons.md` treats a plan instructing that
flip as a defect. Latest existing row is `H-20` (`bug-middleware-getuser-swallowed`).

#### 4. The guard that makes the rule a rule

**File**: `tests/lib/deck-name-stems.test.ts`

**Intent**: Make the stem-uniqueness rule enforceable rather than conventional. Without it, Desired
End State's "the collision **cannot** recur" is carried by a prose bullet in a document nobody runs,
and Success Criterion 1.1 is a one-off grep an implementer performs once — which is exactly the
shape `tests/lib/no-env-access.test.ts` opens by rejecting: **"A prose rule nothing enforces is not
a rule."** This project already has three textual guards of this form
(`no-logging`, `no-env-access`, `form-endpoint-guards`, `e2e-isolation`), each written after a sweep
was found incomplete by reading rather than by a red run — the same history this stem has.

**Contract**: A textual scan over `tests/` extracting every deck-name literal passed to `createDeck`
and asserting that no stem is used by two files, with **two positive controls** in the idiom those
guards use: the walker reaches the files it claims to (name `study.test.ts` and `candidates.test.ts`
explicitly, and assert a floor on the file count), and the detector fires on a fabricated duplicate.
Textual for the reason the siblings are: the literals are template strings inside call arguments and
nothing in this suite parses TypeScript. State the accepted cost at the site — a stem mentioned in a
comment also trips it, and the fix is to reword the comment.

### Success Criteria

#### Automated Verification

- No deck-name stem is shared by two test files, and the claim is carried by a committed guard
  rather than by a one-off sweep: `tests/lib/deck-name-stems.test.ts` passes, and is proved
  falsifiable by a planted duplicate turning it red and naming both files
- Full suite green: `npm test`
- Type gate passes: `npm run typecheck`
- Lint passes: `npm run lint` (3 standing `no-console` warnings in
  `evals/generation-quality.eval.ts`, unchanged)

#### Manual Verification

- **Deterministic reproduction, as a pair.** Temporarily replace `const suffix = ...` with a
  fixed literal in both `study.test.ts` and `candidates.test.ts` so the collision is forced
  rather than raced. Against the pre-rename tree the suite goes red with
  `Talia o tej nazwie już istnieje`; against the post-rename tree it goes green. Both suffix
  lines restored afterwards, restore verified by hash. This replaces a 92-run probabilistic
  matrix with a two-run deterministic one — and it is the only form that does not itself add
  ~6,000 decks to the database this change exists to empty.
- `roadmap.md` renders correctly and carries no `## Done` entry for `H-21`

---

## Phase 2: Harden the two assertions, and measure the false pass while it exists

### Overview

Change both absence-assertions so they cannot be satisfied by PostgREST truncation, then spend
one neuter window on the un-repaid database capturing the pair research could only infer:
the old shape passing while the guard is disabled, the new shape failing.

### Changes Required

#### 1. The documented vulnerable assertion

**File**: `tests/study/study.test.ts`

**Intent**: Make the cross-account denial at `:400-412` ("never exposes another account's deck")
prove that B's result set is **bounded to B's own decks**, rather than only that A's specific
deck is missing from it. The current form reads green when A's deck merely fell outside the
1000-row window.

**Contract**: The assertion at `:407`, `expect(foreign.data?.[deckPublicId]).toBeUndefined()`.
Keep it — it is cheap and still meaningful — and add the bounding claim beside it: **none of the
decks this file created for A** appears as a key in `foreign.data`. The existing positive control at
`:410-411` stays untouched.

The oracle's reference set is **test-local by construction**, and that is the whole point: A's deck
`public_id`s are values this file already holds, so nothing the neuter can disable feeds the
assertion. Both alternatives were considered and both fail, in opposite directions.

- _"Assert `foreign.data` is empty"_ is **order-dependent**. B owns 0–4 decks created in **other**
  files (`tests/isolation/decks.test.ts:55`, `flashcards.test.ts:103,121,286`) while
  `sequence.shuffle` is permanently on, and `study_due_counts` LEFT JOINs and groups, so every deck
  B can see appears as a key even at `due_count = 0` — this file's own `:397` asserts exactly that.
  It is the C10X-32 class §6.2 forbids.
- _"Assert every key is a deck B owns, read through `listDecks(b)`"_ is **worse**:
  `src/lib/decks.ts:11-13` carries no `user_id` predicate — RLS is the only lock (§6.4) — so under
  `deck_select using (true)` B's reference set becomes the whole database. On the repaid database
  (~70 decks, nothing truncated) every key is then "owned" and the assertion **passes under a full
  neuter**: this ticket's own defect, inverted and made permanent.

**This re-scopes Phase 2's measurement, and the direction is the opposite of what a first reading
suggests.** The test-local shape is falsifiable when the window is **not** truncated — i.e. on the
repaid database — because A's decks are then all present in B's neutered result. At 20,748 decks
A's freshly created decks land inside the hash-aggregate window only 2/10 (`study_due_counts`) to
4/10 (`candidate_counts_by_deck`) of the time, so **the hardened shape must not be asserted to go
red during Phase 2's window**. Phase 2 captures the **old** shape's false pass, which is the
genuinely perishable datum research could only infer; the hardened shape's red is captured **after**
the repayment, in Phase 4. Falsifiability is restored by the repayment and the assertion is made to
depend on it, rather than on volume.

#### 2. The undocumented vulnerable assertion

**File**: `tests/review/candidates.test.ts`

**Intent**: The same change at `:613`, on `countCandidatesByDeck`. This site is a discovery of
this change's research and has never been named in any artifact — note that
`20260725150000_candidate_counts_rpc.sql`'s own header documents the `max_rows` truncation class
as the reason the RPC exists, while reproducing the identical shape one layer down.

**Contract**: `expect(foreign.data?.[withCandidates]).toBeUndefined()` at `:613`, same treatment —
the added claim is that **none of the decks this file created for A** appears as a key in
`foreign.data`, with the same test-local reference set and for the same reasons. The existing
positive control at `:616-617` stays untouched.

One difference from the sibling, and it decides which decks belong in the reference set here:
`candidate_counts_by_deck` INNER JOINs on `state_id = 1`, so a deck appears only if it holds a
generated card. Build the set from the decks this file created for A **that carry a generated
card**, not from every deck it created — otherwise the assertion is satisfiable by a deck that was
never eligible to appear.

#### 3. The measurement's home

**File**: `context/changes/dev-db-test-data-debt/verification.md`

**Intent**: Record the neuter window's observations — the policy dumps, the observed failure
strings, the split with its denominator, and the restore diff — as the primary evidence of this
change.

**Contract**: New file. It carries the perishable measurement, so it must state plainly that the
run was taken at ~20,748 decks and cannot be reproduced after Phase 4.

### Success Criteria

#### Automated Verification

- Full suite green with both hardened assertions: `npm test`
- Type gate passes: `npm run typecheck`
- Lint passes: `npm run lint`

#### Manual Verification

- **The perishable measurement, in one neuter window on the un-repaid database.** With the guarding
  policies set `using (true)` per §6.6's four-policy recipe: the **pre-hardening** assertion shape
  **passes** — the false green, measured rather than inferred for the first time, and the whole
  reason this phase runs before the cleanup. The deck count is recorded beside it. The hardened
  shape's behaviour in this window is **recorded as observed and asserted in neither direction**:
  at this row count it is expected to be unreliable (2/10 to 4/10), and its red belongs to Phase 4
  on the repaid database, where the reference set is test-local and the window is not truncated.
- Policies restored, and the restore **verified** by a `pg_policies` before/after `diff` rather
  than by memory — including confirmation that the heredoc reached `psql` (`docker exec -i`),
  the silent no-op §6.6 records
- Full suite green after the restore

---

## Phase 3: `npm run db:clean`

### Overview

A repeatable, developer-invoked cleanup following the project's established `scripts/` pure + IO
pair convention. Report-first: a bare invocation counts and prints; deletion needs `--yes`.

### Changes Required

#### 1. The pure half

**File**: `scripts/db-cleanup.ts`

**Intent**: Everything decidable without touching Docker — which emails the harness pattern
matches, the container name, the statements, the census parser, and the argument parser — so it
is testable with ordinary fixtures. Mirrors `scripts/kong-keepalive.ts`'s split and its reasoning.

**Contract**: Exports covering (a) the harness email pattern, pinned as a value rather than
inlined, for the reason `KONG_KEEPALIVE_ENV` is pinned — a typo produces a statement that runs
perfectly and matches nothing; (b) `project_id` extraction from `config.toml` text, by regex, no
TOML parser, preserving the zero-runtime-dependency property; (c) the DB container name,
`supabase_db_${projectId}`; (d) the census statement and the delete statement; (e) a census
parser over `psql -t -A -F'|'` output; (f) an argv parser resolving `--yes`.

Two contracts are load-bearing and both are the `parseKongEnv` lesson restated:

- **A census that cannot be parsed must not read as zero.** A malformed or short row means the
  query failed, and reporting `0 harness rows` there is "nothing to clean" — the exact false
  green this script exists to prevent. It must be distinguishable from a genuine zero.
- **An unrecognised flag must be refused, not ignored.** A mistyped `--yess` that silently reads
  as "report only" is harmless; one that silently reads as "delete" is not. Refuse both ways.

**And know what npm does to that flag before writing either half.** npm parses `-`-prefixed
arguments itself unless they follow a `--` separator, and `yes` is a real npm config key. Measured
on npm 11.16.0: `npm run <script> --yes` and `npm run <script> --yess` both hand the script an
**empty** `process.argv`; only `npm run <script> -- --yes` forwards anything. Two consequences the
contracts above must be read against: **the invocation is `npm run db:clean -- --yes`, everywhere**,
and the unrecognised-flag refusal is **unreachable through the npm script** — a mistyped flag never
arrives at all, which is fail-safe (report-only) but means the guard fires only under a direct
`node --experimental-strip-types scripts/run-db-cleanup.ts --yess`. Assert it against the pure argv
parser; exercise it manually through the direct `node` invocation, never through `npm run`.

#### 2. The runner

**File**: `scripts/run-db-cleanup.ts`

**Intent**: The I/O half — read `config.toml`, run the census through `docker exec … psql`, print
the report, and on `--yes` delete, re-census, and verify. Owns the exit code. Carries
`eslint-disable no-console` with the same justification `disable-kong-keepalive.ts:1-4` states:
this file **is** the report.

**Contract**: Fail-closed throughout. Two verification properties the script must own rather than
assume:

- **After a delete, the harness row count must be zero.** If it is not, the delete did not do
  what it reported and the script exits non-zero.
- **After a delete, the non-harness counts must be UNCHANGED.** This is the safety invariant that
  makes the seven artifact decks a property of the tooling rather than of the operator's
  attention. A future edit that widens the pattern reddens here instead of destroying evidence.

Local-only by construction: it reaches Postgres only through `docker exec` on a container name
derived from this checkout's `config.toml`, so it **cannot** address a cloud project. That is a
stronger safety property than a runtime host assertion, and it is the `disable-kong-keepalive.ts`
pattern.

No `MSYS_NO_PATHCONV` handling is needed — `execFileSync` never invokes a shell.

#### 3. The pure half's tests

**File**: `tests/lib/db-cleanup.test.ts`

**Intent**: Assert the pure half, including the two fail-closed properties above, which are the
ones a green run would otherwise never exercise.

**Contract**: The load-bearing case is a **whole-set positive control on the pattern**: fixture
the seven real non-harness emails measured in Current State Analysis and assert the pattern
matches **none** of them, alongside a real harness email it does match. Without both directions,
a pattern matching everything and a pattern matching nothing are indistinguishable. Also: census
parsing on real observed output, refusal on malformed input, `project_id` extraction on real
`config.toml` text and refusal when absent, and argv parsing for bare / `--yes` / unknown flag.

"Real `config.toml` text" is meant literally and carries a decoy: the file has a **second**
`project_id` at `:328`, commented out (`# project_id = "my-firebase-project"`). A first-match regex
resolves `:5` correctly; a `matchAll` or a last-wins read resolves a container name that does not
exist, and the failure surfaces as `docker exec` refusing an unknown container rather than as
anything about parsing. The fixture must include that line, and the extractor must ignore commented
keys.

#### 4. The npm script

**File**: `package.json`

**Intent**: Wire `db:clean` beside the existing `db:*` block.

**Contract**: `"db:clean": "node --experimental-strip-types scripts/run-db-cleanup.ts"`, matching
`db:kong`'s invocation exactly. **Not** chained into `db:start` — developer-invoked by decision.

### Success Criteria

#### Automated Verification

- New tests pass and the suite is green: `npm test`
- Type gate passes: `npm run typecheck` (it covers `scripts/`)
- Lint passes: `npm run lint`

#### Manual Verification

- A bare `npm run db:clean` prints the census and **deletes nothing** — verified by a row count
  taken independently before and after
- The script's fail-closed census parsing is proved falsifiable: fed a malformed census it
  refuses rather than reporting zero
- `npm run db:clean -- --yes` is **not** run in this phase; the repayment is Phase 4

---

## Phase 4: Repay the backlog

### Overview

Use the script from Phase 3 to repay ~20,748 decks and ~1,468 harness users, delete the orphan
separately as an explicit recorded act, and prove the seven artifact decks survived.

### Changes Required

#### 1. The repayment

**File**: — (a recorded operation, no file changes)

**Intent**: Run `npm run db:clean -- --yes` — the `--` separator is load-bearing, see Phase 3 §1.
This doubles as the script's first genuine exercise, on the real dataset rather than a fixture.

**Take the snapshot first.** This is the one irreversible operation in the change, and every safety
mechanism named below is **post-hoc**: the script's invariant and the read-back both report, after
the fact, that something was destroyed. Neither can put it back, and the rows in question are
evidence archived documents cite. So before the delete, dump `auth.users` plus the five public
tables to a gitignored path
(`docker exec supabase_db_10x-astro-starter pg_dump -U postgres -d postgres …`) and record its size
in `verification.md`. It is insurance against a mis-scoped pattern, **not** a rollback plan, and it
may be deleted once the read-back passes. The plan already reasons this carefully about restoring an
RLS policy; the same reflex belongs on the operation that cannot be restored at all.

**Contract**: Before/after counts on all six measures from Current State Analysis, captured into
`verification.md`. The script's own non-harness-unchanged invariant is the primary safety oracle;
an independent row-by-row read of the seven artifact decks is the corroboration, because an
invariant and the code that checks it share a failure mode.

#### 2. The orphan

**File**: — (a recorded operation, no file changes)

**Intent**: Delete `E2E deck 1785947414992` by `public_id`, as a separate statement.

**Contract**: `public_id = 3b720154-174f-4735-8cb7-74a087453817`. It is **not** matched by the
harness pattern and never will be — it is owned by `test@mail.com`, not by the e2e account, which
was created four days later. Deliberately kept out of the script rather than hardcoded into it: a
one-time 2026-08-05 artifact baked into a permanent tool is dead weight forever after its first
run.

### Success Criteria

#### Automated Verification

- Full suite green after the repayment: `npm test`
- `npm run e2e` green — it signs in as the e2e account, and this is what proves the cleanup did
  not disturb it

#### Manual Verification

- **The pre-delete snapshot exists before anything is deleted** — `pg_dump` of `auth.users` plus the
  five public tables at a gitignored path, its size recorded in `verification.md`
- Harness rows are zero, and all six table counts recorded before and after
- **The seven artifact decks are read back individually by `public_id` and all seven are present**
- The orphan `3b720154-…` is gone, confirmed by a direct read
- `npm run db:clean` re-run bare afterwards reports a near-empty census — the idempotency check
- **The end-state property itself, on the database it must hold on.** Re-run §6.6's four-policy
  neuter against the **repaid** database and confirm the hardened assertion goes **red**, then
  restore and verify by a `pg_policies` before/after `diff`. This is the change's headline claim —
  "a developer running the deliberate-breakage procedure gets a red where the guard is disabled" —
  and Phase 2's window measured it only in the state this phase destroys. It is also the one check
  that tells a correct hardening from a reference set the neuter can poison, so a green here is a
  finding, not a pass

---

## Phase 5: Documentation sync

### Overview

Four dated corrections, the Defect B follow-up, and this change's own records.

### Changes Required

#### 1. `study_due_cards` is not in the vulnerable class

**File**: `context/foundation/test-plan.md`

**Intent**: §2 and §6.6 imply `study_due_cards` belongs to the truncation-vulnerable class. It
does not — it carries both `where f.deck_id = p_deck_id` and `limit p_limit`
(`20260724220524_srs_study_schedule_review_fixes.sql:46-68`), bounded on both axes. A contributor
reading the guide before writing a neuter is being misdirected.

**Contract**: A **dated correction block**, not a rewrite — this project's convention, and the
sentences being corrected were true claims about other things on their dates.

#### 2. The undocumented second site

**File**: `context/foundation/test-plan.md`

**Intent**: Name `candidate_counts_by_deck` / `tests/review/candidates.test.ts:613` as the second
member of the vulnerable class. The whole point of §6.6's generalisation is that the class is
findable; leaving the second instance unnamed defeats it.

**Contract**: Folded into this change's own §6.6 entry, together with what Phase 2 hardened and
the perishable measurement it took.

#### 3. The archive's CI-immunity claim

**File**: `context/archive/2026-08-01-local-stack-transport-flake/research.md`

**Intent**: That document argues CI is structurally immune to the transport flake and records
"Runs with `attempt > 1`: 0". CI run #66 is the counterexample — reported as `success` because it
is `run_attempt: 2`, with attempt 1 having failed on `tests/validation/decks.test.ts`.

**Contract**: An **appended dated correction**, never a rewrite. `.prettierignore` carries
`context/archive/**`, so the append will not be reformatted. Note what the correction does _not_
claim: run #66's failure is **not** attributed to the keep-alive flake — research argues against
that on three independent grounds — so what is falsified is the `attempt > 1` count and the
immunity inference drawn from it, not the flake's mechanism.

#### 4. This change's §6.6 entry and §8 ledger entry

**File**: `context/foundation/test-plan.md`

**Intent**: Record what this change proves and, at equal length, what it does not.

**Contract**: The does-NOT-prove list must carry at minimum: Defect B is unattributed and open;
the hardening covers two assertions, not the class of every future assertion written against an
unordered RPC; the two RPCs still have no `ORDER BY`, so a new consumer inherits the trap — and
there are already **two** consumers, both in production (`src/pages/decks/index.astro:18` for
`countCandidatesByDeck`, `src/pages/study/index.astro:15` for `listDueCounts`), safe today for a
reason worth writing down rather than leaving implicit: under intact RLS a real user owns far fewer
than 1,000 decks, so their safety is a **data-volume property of production** — the same kind of
property that decayed locally and produced this ticket; the
neuter measurement is one window on one machine and cannot be reproduced after Phase 4; and
`db:clean` is developer-invoked, so the debt returns at 68 decks per run with nothing watching a
counter.

#### 5. The Defect B follow-up

**File**: `context/changes/dev-db-test-data-debt/follow-ups/deck-create-transient.md`

**Intent**: Carry the finding forward with enough detail that the next owner starts from the
analysis rather than from scratch.

**Contract**: The verbatim attempt-1 log, the five facts none of which was on record, the
three-ground argument against the keep-alive hypothesis, the retry-asymmetry analysis (a GET has
three layers, a POST has one, keyed to a single status and a single body string, and
`retry-transport.ts:160` awaits outside the `try` so a rejected fetch is not covered at all), the
three indistinguishable generic-message sites at `src/pages/api/decks/index.ts:47,63,74`, and the
marker-experiment design with its expected outcome stated as a **non-reproduction**. To be
ticketed via `/jira-backlog-sync`.

#### 6. Change identity

**File**: `context/changes/dev-db-test-data-debt/change.md`

**Intent**: `status: planned` → the implementation status, `updated` stamped.

**Contract**: `archived_at` stays `null`; archiving is `/10x-archive`'s.

### Success Criteria

#### Automated Verification

- Markdown is prettier-clean and a fixed point: run `prettier --write` on an in-repo copy first
  and diff, per the C10X-51 finding that a `/tmp` copy escapes config resolution
- Full suite still green: `npm test`
- Type gate passes: `npm run typecheck`

#### Manual Verification

- The archive edit is an **append** — verified by diff, with nothing above the appended block
  altered
- Every corrected claim is left standing with a dated correction beneath it, never rewritten
- The follow-up file is self-contained: a reader who has not seen this research can run the
  marker experiment from it alone

---

## Testing Strategy

### Unit Tests

- `tests/lib/deck-name-stems.test.ts` — the stem-uniqueness guard (Phase 1), with a walker control
  and a fabricated-duplicate control, in the idiom of the four existing textual guards
- `tests/lib/db-cleanup.test.ts` — the pure half, with the whole-set positive control on the
  harness pattern against the seven real artifact emails as its load-bearing case

### Integration Tests

None added. This change's subject is the harness and the data beneath it, not the product. The
two assertions in Phase 2 are existing integration cases whose **shape** changes; no new `it()`
is created by that edit, so the suite count moves only by Phase 1's and Phase 3's additions — two
figures, each to be measured by running the file alone, never by arithmetic.

### Manual Testing Steps

1. Phase 1's forced-collision pair, red before the rename and green after, both suffix lines
   restored and hash-verified
2. Phase 2's neuter window on the un-repaid database, with the `pg_policies` before/after diff
3. Phase 3's bare `db:clean` proving it deletes nothing
4. Phase 4's repayment, the seven artifact decks read back individually, the orphan confirmed gone
5. `npm run e2e` after the repayment

## Performance Considerations

None. Research measured the total footprint at ~20 MB across five tables with every filtered
column indexed. There is no performance or disk argument for this cleanup and stating one would
be false — the entire justification is falsifiability.

## Migration Notes

**No migration ships.** The hardening lands in assertions rather than in the two RPCs' SQL, so
nothing is pushed to the cloud, the C10X-29 drift gate is uninvolved, and `/ship` has no
database step for this change.

The repayment touches the **local** dev database only, and by construction: `db:clean` reaches
Postgres solely through `docker exec` on a container name derived from this checkout's
`config.toml`.

## References

- Research: `context/changes/dev-db-test-data-debt/research.md`
- Charter: `context/changes/dev-db-test-data-debt/change.md`
- Script pattern to follow: `scripts/kong-keepalive.ts` + `scripts/disable-kong-keepalive.ts`
- Test pattern to follow: `tests/lib/kong-keepalive.test.ts`
- The neuter procedure and its recorded failure modes: `context/foundation/test-plan.md` §6.6
  Phase 4, §6.7
- The deferred mandate this change discharges:
  `context/archive/2026-08-08-e2e-harness-journeys/plan.md:108-111`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Defect A and the roadmap row

#### Automated

- [x] 1.1 `tests/lib/deck-name-stems.test.ts` passes and is proved falsifiable by a planted duplicate — 0365900
- [x] 1.2 Full suite green: `npm test` — 0365900
- [x] 1.3 Type gate passes: `npm run typecheck` — 0365900
- [x] 1.4 Lint passes: `npm run lint` — 0365900

#### Manual

- [x] 1.5 Deterministic forced-collision pair: red before the rename, green after, suffix lines restored and hash-verified — 0365900
- [x] 1.6 `roadmap.md` H-21 renders correctly and carries no `## Done` entry — 0365900

### Phase 2: Harden the two assertions, and measure the false pass while it exists

#### Automated

- [x] 2.1 Full suite green with both hardened assertions: `npm test` — 3eea344
- [x] 2.2 Type gate passes: `npm run typecheck` — 3eea344
- [x] 2.3 Lint passes: `npm run lint` — 3eea344

#### Manual

- [x] 2.4 The perishable false pass measured in one neuter window on the un-repaid database: the pre-hardening shape passes; the hardened shape's behaviour recorded as observed, asserted in neither direction — 3eea344
- [x] 2.5 Policies restored, verified by a `pg_policies` before/after diff — 3eea344
- [x] 2.6 Full suite green after the restore — 3eea344

### Phase 3: `npm run db:clean`

#### Automated

- [x] 3.1 New tests pass and the suite is green: `npm test` — 8441374
- [x] 3.2 Type gate passes: `npm run typecheck` — 8441374
- [x] 3.3 Lint passes: `npm run lint` — 8441374

#### Manual

- [x] 3.4 A bare `npm run db:clean` prints the census and deletes nothing, verified independently — 8441374
- [x] 3.5 Fail-closed census parsing proved falsifiable: malformed input refuses rather than reporting zero — 8441374
- [x] 3.6 `--yes` deliberately not run in this phase — 8441374

### Phase 4: Repay the backlog

#### Automated

- [x] 4.1 Full suite green after the repayment: `npm test`
- [x] 4.2 `npm run e2e` green

#### Manual

- [x] 4.3 Pre-delete snapshot taken: `pg_dump` of `auth.users` + the five public tables to a gitignored path, size recorded
- [x] 4.4 Harness rows zero; all six table counts recorded before and after
- [x] 4.5 The seven artifact decks read back individually by `public_id`, all present
- [x] 4.6 The orphan `3b720154-…` confirmed gone
- [x] 4.7 Bare `npm run db:clean` re-run reports a near-empty census
- [x] 4.8 Four-policy neuter re-run on the repaid database: the hardened assertion goes red, policies restored and verified by `pg_policies` diff

### Phase 5: Documentation sync

#### Automated

- [ ] 5.1 Markdown prettier-clean and a fixed point, checked on an in-repo copy
- [ ] 5.2 Full suite still green: `npm test`
- [ ] 5.3 Type gate passes: `npm run typecheck`

#### Manual

- [ ] 5.4 The archive edit is an append, verified by diff
- [ ] 5.5 Every corrected claim left standing with a dated correction beneath it
- [ ] 5.6 The Defect B follow-up is self-contained
