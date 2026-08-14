# Verification — `dev-db-test-data-debt` (C10X-47)

> **This file carries a PERISHABLE measurement.** Phase 2 §Neuter window below was taken on the
> **un-repaid** local dev database, at **21,345 decks**, on **2026-08-14**. Phase 4 deletes those
> rows. After that, the observation cannot be reproduced on this machine at all — not "is harder
> to reproduce", but cannot: the mechanism it measures is PostgREST truncating a database-wide
> result set at `max_rows = 1000`, and a repaid database has ~70 decks in it. Nothing in this
> project will ever measure it again unless somebody deliberately re-inflates the database first.
>
> Read the neuter window's numbers as one window, on one machine, on one day.

---

## Phase 2 — Harden the two assertions, and measure the false pass while it exists

### 0. What this phase changed

Two existing integration cases keep their assertion and gain a second one beside it. **No new
`it()` is created**, and that was measured rather than assumed: `tests/study/study.test.ts` +
`tests/review/candidates.test.ts` report **44 tests** both before the edit (seed
`1786741105992`) and after it. Full suite **531 / 531, 42 files** — unchanged from the Phase 1
figure, correctly.

| File                              | Site                                         | Added                                                                |
| --------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| `tests/study/study.test.ts`       | `listDueCounts` cross-account denial         | `aDeckPublicIds` registry + `expect(leakedToB).toEqual([])`          |
| `tests/review/candidates.test.ts` | `countCandidatesByDeck` cross-account denial | `aCandidateDeckPublicIds` registry + `expect(leakedToB).toEqual([])` |

Both reference sets are **test-local by construction** — public_ids the file already holds — so
nothing the neuter disables can feed the oracle. The two rejected alternatives and why each fails
in the opposite direction are argued at the sites, not repeated here.

### 1. Database state when the window opened

Census immediately before the neuter, `docker exec … psql`, read-only:

| Table                  |   Rows |
| ---------------------- | -----: |
| `auth.users`           |  1,523 |
| — of which `harness-*` |  1,509 |
| `deck`                 | 21,312 |
| `flashcard`            | 36,809 |
| `flashcard_schedule`   |  7,123 |
| `generation_session`   |  9,517 |

`deck` measured again after the neuter statements and before the first in-window run:
**21,345** — the +33 is the baseline two-file run, not a full-suite 68.

### 2. Control — intact RLS, pre-hardening shape

`npx vitest run tests/study/study.test.ts tests/review/candidates.test.ts`, seed
`1786741105992`: **44 passed (44), 2 files**, 7.12 s. This is the control the window's reds are
attributed against: without it, "the neuter reddened things" is indistinguishable from "these
files were already red".

### 3. The neuter window

Opened with §6.6's four-policy recipe, `alter policy … using (true)` on `deck_select`,
`flashcard_select`, `flashcard_schedule_select`, `flashcard_schedule_update`. psql echoed four
`ALTER POLICY` and a `pg_policies` read-back confirmed all four `qual` values were literally
`true` — the §6.6 silent-no-op failure mode (a heredoc piped without `-i`) is closed here by
construction, because every statement went in as a `-c` argument and psql echoed each one.

#### 3.1 The perishable measurement — the pre-hardening shape PASSES with the guard fully disabled

**In situ.** Same two files, same command, still pre-hardening. **5 failed | 39 passed (44)**.
The one that matters is `listDueCounts backs the deck picker > never exposes another account's
deck`, and what matters is **which line** reddened:

```
AssertionError: expected undefined to be 1 // Object.is equality
 ❯ tests/study/study.test.ts:411:40
    410|     const owner = await listDueCounts(clientFor(a.cookieHeader), new D…
    411|     expect(owner.data?.[deckPublicId]).toBe(1);
```

Line **411 is the positive control**. Line **407 is the denial**
(`expect(foreign.data?.[deckPublicId]).toBeUndefined()`). Vitest aborts a case at its first
failed `expect`, so :411 failing proves :407 **executed and passed** — with `deck_select`,
`flashcard_select`, `flashcard_schedule_select` and `flashcard_schedule_update` all set
`using (true)`.

**That is the false pass, measured.** `test-plan.md` §6.6 recorded it on 2026-07-26 and every
artifact since has carried it as an inference; research §3 states explicitly that the four-policy
neuter "was **not** executed" and that the false pass is inferred from a window measurement. It is
now an observation.

**The mechanism, measured directly at the SQL layer** so the number behind the pass is on record
rather than reasoned about. Run as `authenticated` with account B's real `sub`
(`e673b813-9647-4634-a4e6-7dcd0bfd6ee5`), inside a rolled-back transaction, taking the first 1,000
rows exactly as PostgREST's `max_rows` does:

| RPC, called as B under the neuter | Rows visible to B | PostgREST window | A's deck inside the window |
| --------------------------------- | ----------------: | ---------------: | -------------------------: |
| `study_due_counts(now())`         |        **21,378** |            1,000 |                      **0** |
| `candidate_counts_by_deck()`      |         **7,420** |            1,000 |                      **0** |

21,378 is the whole database — the guard is not partially disabled, it is gone — and the deck the
assertion asks about is not among the 1,000 rows that survive truncation. So `toBeUndefined()` is
satisfied by the truncation, not by the isolation.

#### 3.2 The second site is real, and in situ it is MASKED rather than observable

`tests/review/candidates.test.ts:613`'s denial is the second member of the class and the one no
artifact had ever named. **It could not be observed in situ**, and that is itself the finding: the
same case reads A's own count at `:605` **before** reaching the denial at `:613`, and under the
neuter that owner read is the first thing to fail —

```
AssertionError: expected undefined to be 2
 ❯ tests/review/candidates.test.ts:605:36
```

— because A's own deck is truncated out of A's own database-wide result too. The denial below it
never runs. So the site's false pass is carried by the SQL-layer row in §3.1 (7,420 → 1,000, deck
absent), which is deterministic and order-free, and not by an in-situ red. Recorded as observed
rather than worked around: an assertion that an earlier assertion in the same `it()` prevents from
ever executing is a second way for a guard to be unfalsifiable, and it is not the way this ticket
was chartered to fix.

#### 3.3 The hardened shape in the same window — recorded as observed, asserted in neither direction

The plan predicted the hardened shape would be unreliable here (2/10 to 4/10) and instructed that
its behaviour be recorded, not asserted. **It was red, and the reason is worth more than the
colour.**

Whole-file run, hardened, same window:

```
AssertionError: expected [ …(2) ] to deeply equal []
 ❯ tests/study/study.test.ts:450:23
```

**Two** of the decks this file had given account A were inside B's 1,000-row window. Run the
**same case alone** (`-t "never exposes another account's deck"`), same window, same tree, and the
hardened assertion at :450 is **GREEN** — the case falls through to the positive control at :454
exactly as the pre-hardening shape did:

```
AssertionError: expected undefined to be 1
 ❯ tests/study/study.test.ts:454:40
```

One tree, one window, two runs, opposite colours on the same line. The mechanism is the reference
set's size: alone, it holds **one** deck and a fresh deck lands inside a hash-aggregate window
about 2 times in 10; in a whole-file run it holds every deck the file gave A, and the per-deck
2/10 compounds. So on the un-repaid database the hardening is **probabilistic** — which is exactly
why the plan refused to assert it here — and Phase 4 is where it becomes deterministic, on a
database where nothing truncates.

Neither run is evidence that the hardening works. Phase 4 §4.8 owns that claim.

> **Emphasis corrected by window 2 (§3.5), same day.** "It was red" is the accurate record of
> window 1 and is left standing, but a single sample made it read as though the whole-file run
> reddens. It does not reliably: window 2's whole-file run, hardened, is **GREEN on the same
> line**. Two samples, opposite colours, same tree — the paragraph's own conclusion
> ("probabilistic") is what survives, and it is now measured rather than reasoned from one run.

#### 3.4 One divergence from `test-plan.md` §6.6's recorded run, recorded as observed

§6.6 records that under this neuter `returns 404 when B rates a card in A's deck` fails
`expected 200 to be 404` — B genuinely rating A's card. In this window it fails
**`expected 500 to be 404`** (`study.test.ts:352`). The likely cause is stated as inference and
not as measurement: `flashcard_schedule_update` was neutered on `using` only, per §6.6's wording,
so B's UPDATE now MATCHES A's row and is then refused by the policy's still-intact `with_check` —
an RLS violation the endpoint answers as 500 rather than as a silent 0-row no-op. That would mean
§6.6's 2026-07-26 run neutered `with_check` as well, which its own wording does not say. **Not
verified**, and left as a note rather than a correction to §6.6.

#### 3.5 Window 2 — the same window re-opened and fully instrumented, with the seeds captured

Window 1 recorded its two in-window runs without their seeds. That was defended below (§6) as a
decision rather than a gap, and the defence still holds — a seed replays a permutation and these
reds were induced by a policy write. It was re-run anyway, on request, and re-running bought two
things a seed never would.

The hardening was stashed to recover the pre-hardening tree byte-exactly
(`md5 7ecc2a97… / 2ff5b31d…` at `HEAD`), the window re-opened with the identical four statements,
and the tree restored afterwards with `md5sum -c` confirming both files (`09bf05f3… / b1c45606…`).
Deck count at window 2: **21,480**. The pre-window `pg_policies` dump was **byte-identical to
window 1's** (`md5 373cdb7b…`), which is an independent second confirmation that window 1's
restore actually held.

| Run                             | Seed            | Result                      | Case fails at                 |
| ------------------------------- | --------------- | --------------------------- | ----------------------------- |
| pre-hardening, both files       | `1786741812359` | 5 failed \| 39 passed (44)  | `:411` — the positive control |
| hardened, both files            | `1786741834232` | 5 failed \| 39 passed (44)  | `:454` — the positive control |
| hardened, the case alone (`-t`) | `1786741883314` | 1 failed \| 21 skipped (22) | `:454` — the positive control |

**The false pass reproduced.** The pre-hardening run fails at `:411`, so the denial at `:407`
executed and passed again with the guard fully disabled — a second sample of §3.1's central
observation, at a different permutation and a different deck count.

**And the hardened shape came back GREEN this time**, which is the reason window 2 was worth
running. Window 1's whole-file run reddened at `:450` with two decks leaked; window 2's does not
reach `:450` as a failure at all. Same tree, same window recipe, opposite colour — so
"probabilistic" is now two samples rather than one inference from one.

**Two mechanisms drive that variance and this phase did not separate them**, stated as an open
attribution rather than resolved by argument. Measured after both runs, as B: of the hardened
run's account's 33 decks, **2** sit inside the 1,000-row window, and of the pre-hardening run's
account's 33, **0** do. So the window itself moves (hash-aggregate order over a table that is
being written to), _and_ the registry holds only the decks created before the case ran, which
`sequence.shuffle` decides afresh every time. Either alone explains a colour flip; nothing here
says which dominated, and separating them would need instrumentation this phase does not justify
on a database Phase 4 deletes.

Policies restored again; `w2-before.txt` / `w2-after.txt` diff empty, and all **four** dumps taken
across both windows carry the same `md5 373cdb7bd66dee58aecc673a3b6e9930`. Full suite after
window 2: **531 passed (531), 42 files**, seed `1786741902373`. Census after both windows:
`auth.users` 1,543 (1,529 harness) · `deck` 21,615 · `flashcard` 37,343 · `flashcard_schedule`
7,273 · `generation_session` 9,613.

#### 3.6 The hardening's own falsifiability, proved deterministically and independently of any neuter

§3.3 and §3.5 measure what the hardened assertion does under a neuter, and the answer there is
"probabilistically red". That leaves the question a neuter cannot settle on this database: **can
the new assertion go red at all, and for the right reason?** Two failure modes make that a real
question rather than a formality — a reference set that is silently always empty (`[]` compared to
`[]`, green forever), and a filter that never matches. Both were closed by measurement.

**Probe P1 — the reference set is not empty, and its size is shuffle-dependent.** Temporarily
asserting `expect(<registry>).toEqual([])` at the assertion site turns the registry's contents
into the failure message. Across four permutations:

| Seed            | `aDeckPublicIds` (study, of 20 A-decks) | `aCandidateDeckPublicIds` (candidates) |
| --------------- | --------------------------------------: | -------------------------------------: |
| `1786742295341` |                                      16 |                                      2 |
| `1786742313795` |                                      17 |                                      2 |
| `1786742323157` |                                       4 |                                     10 |
| `1786742332834` |                                       3 |                                     12 |

Never empty, and ranging **3-17** / **2-12**. That is the second variance mechanism §3.5 leaves
unattributed, now quantified: how much falsifiability the assertion buys on a given run is decided
by `sequence.shuffle`, while what it claims is true in every order.

**Probe P3 — a real leak reddens it, deterministically, and it names what leaked.** A deck
account **B genuinely owns** was created and pushed into A's reference set immediately **before**
the `foreign` read, then the case run alone:

| Site                                  | Seed            | Result                                                         |
| ------------------------------------- | --------------- | -------------------------------------------------------------- |
| `tests/study/study.test.ts:452`       | `1786742397404` | RED — `expected [ Array(1) ] to deeply equal []`, `61bf3a5f-…` |
| `tests/review/candidates.test.ts:660` | `1786742428235` | RED — `expected [ Array(1) ] to deeply equal []`, `34bcdfbf-…` |

Those two line numbers are **as the runs reported them** and the first has already moved: a later
comment edit in this same phase puts `expect(leakedToB).toEqual([])` at `study.test.ts:459` as of
the closing commit. Kept as observed rather than silently re-based, and flagged rather than left to
rot — a line number resolves to a place, and a place carries no evidence of what stands there.
Resolve both by the assertion, not by the number.

Both leaked ids were then read back in psql and both resolve to a `harness-b-…@example.com`
account — so the assertion reddened on a genuine cross-account key, not on a bookkeeping artefact.
The candidates plant additionally seeds a **generated** card, because that RPC's INNER JOIN admits
a deck only while it holds one; the psql read-back confirms `generated = 1`. Both sites redden
**before** their positive control, which is the ordering §6.10 requires.

**One false start, recorded because it nearly became a false finding.** P3's first attempt planted
the leak _after_ the `foreign` read and came back **green**. Read as an observation about the
assertion, that would have said "a real leak does not redden it" — the opposite of the truth. It
was a defect in the probe: `foreign` had already been read, so nothing planted afterwards could be
in it. The lesson is the one this project keeps re-recording one layer up — **check what your
probe actually exercises before you read its colour** — and it is why the plant is placed above
the read in the table's runs.

Both probes were removed and the tree restored, verified by `md5sum -c` against the pre-probe
hashes (`09bf05f3… study.test.ts`, `b1c45606… candidates.test.ts`), both `OK`.

### 4. Restore, verified rather than remembered

Policies restored with `alter policy … using (<original qual>)`, four `ALTER POLICY` echoed. The
`pg_policies` dump (`schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check`
over all 19 public policies) was taken **before** the neuter and **again** after the restore:

```
diff policies-before.txt policies-after.txt   →  no output
md5  373cdb7bd66dee58aecc673a3b6e9930          →  identical, both files
```

A text match is necessary and not sufficient — this project has recorded that once already for a
CHECK constraint that came back `NOT VALID`. The behavioural corroboration is §5: the whole suite,
including every cross-account denial in it, is green against the restored policies, which a
still-disabled `deck_select` could not produce.

### 5. Gates, after the restore

| Gate                | Result                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `npm test`          | **531 passed (531), 42 files**, seed `1786741370990`, 8.41 s                                 |
| `npm run typecheck` | **OK — 160 files checked**, 0 errors, 0 warnings                                             |
| `npm run lint`      | **0 errors**, 3 warnings — all `no-console` in `evals/generation-quality.eval.ts`, unchanged |

Census after the phase: `auth.users` 1,534 (1,520 harness) · `deck` 21,480 · `flashcard` 37,106 ·
`flashcard_schedule` 7,209 · `generation_session` 9,568.

### 6. What this phase does NOT prove

- **Not that the hardening works UNDER A NEUTER.** Across two windows the hardened line is red
  once and green twice, in the state Phase 4 destroys. §3.6 proves the assertion can go red and
  reddens on a genuine cross-account key — that is the detector working, and it is a different
  claim from "the deliberate-breakage procedure now yields a red". The latter is Phase 4 §4.8's,
  on the repaid database, and a green there is a finding rather than a pass.
- **The second site has no in-situ red UNDER A NEUTER**, in either shape and in either window
  (§3.2). Its evidence there is the SQL-layer measurement plus its being the same RPC shape as the
  first; its detector is separately proved in §3.6.
- **The variance in §3.5 is unattributed.** Two mechanisms can flip the hardened line's colour —
  a moving hash-aggregate window and a shuffle-dependent registry size — and nothing here says
  which did. Deliberately not chased on a database this change is about to delete.
- **Two windows, one machine, one day.** Window 1's two in-window runs have no seed; window 2's
  three do (`1786741812359`, `1786741834232`, `1786741883314`). The seeds are recorded for
  discipline rather than for replay value: the reds were induced by a deliberate policy write, not
  by a permutation, so §6.6's protocol for a breakage run asks for observed failure strings and
  denominators — which are above for every run in both windows.
- **Nothing about production.** Both RPCs still carry no `ORDER BY`, and both have live consumers
  (`src/pages/decks/index.astro`, `src/pages/study/index.astro`). Their safety is a data-volume
  property of production — a real user owns far fewer than 1,000 decks — i.e. the same kind of
  property that decayed locally and produced this ticket.
- **The class is not closed.** Two assertions are hardened. A future assertion written against an
  unordered, unbounded RPC inherits the trap, and nothing detects that automatically.

---

## Phase 3 — `npm run db:clean`

### 0. What this phase added

Four files, following the project's `scripts/` pure + IO pair convention (`kong-keepalive` /
`disable-kong-keepalive`, `schema-drift` / `check-schema-drift`, `typecheck` / `run-typecheck`).

| File                           | Role                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `scripts/db-cleanup.ts`        | pure half — pattern, `LIKE` mirror, `project_id`, container name, statements, parsers |
| `scripts/run-db-cleanup.ts`    | I/O half — `docker exec … psql`, the report, the delete, the two read-back oracles    |
| `tests/lib/db-cleanup.test.ts` | the pure half's assertions, **32 cases**                                              |
| `package.json`                 | `"db:clean": "node --experimental-strip-types scripts/run-db-cleanup.ts"`             |

**Nothing is wired into `db:start`, a hook, or CI** — developer-invoked by decision (plan
§What We're NOT Doing). `db:clean -- --yes` is deliberately **not run in this phase**; the
repayment is Phase 4.

### 1. Gates

| Gate                | Result                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `npm test`          | **563 passed (563), 43 files**, seed `1786743760368`, 7.97 s                                 |
| `npm run typecheck` | **OK — 163 files checked**, 0 errors, 0 warnings                                             |
| `npm run lint`      | **0 errors**, 3 warnings — all `no-console` in `evals/generation-quality.eval.ts`, unchanged |

**Both suite figures were measured by RUNNING, not by arithmetic**, which is the discipline this
project has caught itself missing four times. `npx vitest run tests/lib/db-cleanup.test.ts` alone
reports **32 passed (32)** (seed `1786743584256`); the full suite moved **531 → 563** and
**42 → 43 files** from the Phase 2 figure. The two agree, and the agreement is a check on the
measurement rather than its source. `typecheck` moved **160 → 163 files** — the three new `.ts`
files, entering the gate silently through `tsconfig.json`'s `include: ["**/*"]`.

### 2. Criterion 3.4 — a bare `npm run db:clean` prints the census and deletes nothing

Verified by a row count taken **independently of the script**, before and after, through a
different statement (five scalar sub-selects rather than the script's five-branch `UNION ALL`):

```
BEFORE  users=1570 deck=21958 flashcard=37939 sched=7427 gs=9736
AFTER   users=1570 deck=21958 flashcard=37939 sched=7427 gs=9736
```

Byte-identical on all five measures; the script exited 0. Its own report in between:

```
db:clean: supabase_db_10x-astro-starter — harness accounts match `harness-%`

before:
  table                 harness      other
  users                    1556         14
  deck                    21950          8
  flashcard               37898         41
  flashcard_schedule       7424          3
  generation_session       9725         11

db:clean: 78553 harness row(s) would be deleted. Nothing was deleted.
db:clean: to delete, re-run with:  npm run db:clean -- --yes
db:clean: the `--` is required — npm eats a bare `--yes` and this script reports only.
```

**The independent read also corroborates the census itself, which is the stronger half of this
criterion.** `harness + other` reconciles exactly on every one of the five measures
(1556 + 14 = 1570 · 21950 + 8 = 21958 · 37898 + 41 = 37939 · 7424 + 3 = 7427 · 9725 + 11 = 9736).
So the split the delete will act on is not merely self-consistent; it agrees with a query sharing
none of its joins.

An earlier pass of the same criterion, before this phase's last few suite runs, reads
`users=1562 deck=21822 flashcard=37707 sched=7383 gs=9670` before and after, and reconciles the
same way. The two passes differ only by the growth this change exists to measure — 2 users and
~68 decks per `vitest` invocation — which is itself the debt, observed twice an hour apart.

### 3. Criterion 3.5 — fail-closed census parsing, proved falsifiable on the RUNNER

The unit cases pin `parseCensus` in isolation; these runs prove the runner honours it. **Three
variants, one per layer of the contract**, because "the census did not parse" is not one failure
mode — and a single variant would have left the other two carried by reading.

| Variant                            | Neuter                                         | Observed                                                                                        |
| ---------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **1 — short result**               | the `deck` branch deleted from the `UNION ALL` | `census: no row for deck — the query did not run to completion`, **exit 1**                     |
| **2 — unreadable count**           | `deck`'s two counts replaced with `null, null` | `census: \`deck\` count is not a number: ""`, **exit 1**                                        |
| **3 — the statement itself fails** | `public.deck` → `public.no_such_deck_table`    | psql's own `ERROR: relation … does not exist`, then `Command failed: docker exec …`, **exit 1** |

Each is the shape of a real failure, and each is a different layer:

- **Variant 1** is a truncated or partially-failed result — every row that arrives parses fine and
  one is simply missing. This is the one a positional or forgiving parser reports as `deck 0`.
- **Variant 2** is the field a bare `Number("")` reads as **0**, i.e. as a genuine zero. It is the
  narrowest gap between "nothing to clean" and "I could not tell", and it is closed by
  `countOf`'s `/^\d+$/` rather than by a `Number.isFinite` check, which `""` passes.
- **Variant 3** proves `-v ON_ERROR_STOP=1` is doing its job **through the runner**, not merely
  when typed at a shell: without that flag psql prints its error and exits **0**, which is
  verbatim `lessons.md`'s "a command that always exits 0 is not a gate" one vendor over.
  `execFileSync` throws on the non-zero exit, so the failed statement becomes a refusal.

**In all three the script printed no census table at all, and in none of them did any measure read
`0`.** That is the whole contract: a census that cannot be read must never resolve to "nothing to
clean", because that sentence is indistinguishable from a debt already repaid.

> **A restore that did not happen, recorded because it is the reason this project checks them.**
> Between variants 1 and 2 the neuter was reverted with `git checkout -- scripts/db-cleanup.ts`,
> which **silently did nothing** — the file is still untracked at that point in the phase, so git
> had no version to restore and reported no error either. `md5sum -c` caught it immediately
> (`scripts/db-cleanup.ts: FAILED` beside two `OK`s) and the revert was redone as an edit. A
> restore command that no-ops on an untracked file is a new instance of the class §6.6 already
> records for a heredoc piped without `-i`: the operation reports success and changes nothing.

### 4. Breakage run — the whole-set positive control on the pattern

`HARNESS_EMAIL_PATTERN` widened `harness-%` → `%harness%`, i.e. the containment read a reasonable
implementer would reach for. **3 of 32 red**, and the three are the ones that carry the claim:

```
× matches every per-run harness account and NONE of the accounts that must survive
    AssertionError: expected true to be false   tests/lib/db-cleanup.test.ts:87
× spares `e2e-harness@example.com`, which contains `harness` but does not begin with it
    AssertionError: expected true to be false   tests/lib/db-cleanup.test.ts:94
× is anchored at the start and pinned as a value
    AssertionError: expected '%harness%' to be 'harness-%'   tests/lib/db-cleanup.test.ts:102
```

The remaining **29 stayed green**, which is the attribution: the neuter removes the pattern's
anchor, it does not break parsing, statement building or the oracles.

**Why `e2e-harness@example.com` has a case of its own rather than being element 4 of a loop.** The
whole-set control iterates, so its failure message names no address — it reports
`expected true to be false` and nothing else. The one account whose deletion a widened pattern
actually causes therefore appears in a **test title**, so a reader scanning failures meets it by
name. Concretely, that widening deletes C10X-46's dedicated e2e identity, and `npm run e2e` signs
in as it: the layer would not go red, it would silently start minting a new account every run.

### 5. The npm flag semantics, measured rather than assumed

The plan predicted these; they were re-measured on this machine (npm 11.16.0) because the
invocation depends on them.

| Invocation                                    | What the script receives | Observed                                            |
| --------------------------------------------- | ------------------------ | --------------------------------------------------- |
| `node … scripts/run-db-cleanup.ts --yess`     | `["--yess"]`             | **exit 1** — `unrecognised argument \`--yess\``     |
| `npm run db:clean --yess`                     | `[]`                     | **exit 0**, report only — npm ate the flag          |
| `npm run db:clean -- --proof-that-…-forwards` | the flag, verbatim       | **exit 1** — refused, so `--` demonstrably forwards |

The third row is how `-- --yes` was proved to reach the script **without deleting anything**: a
harmless unknown flag exercises the same forwarding path as `--yes` and is refused instead of
acted on. So `npm run db:clean -- --yes` is confirmed as the working invocation for Phase 4, and
the unknown-flag guard is confirmed as unreachable-but-fail-safe through the npm script — a
mistyped flag never arrives, and report-only is the safe direction.

Second layer, also measured: `psql -v ON_ERROR_STOP=1` exits **1** on a bad table name. Without
that flag psql prints its error and exits 0, which is verbatim `lessons.md`'s "a command that
always exits 0 is not a gate" one vendor over — `execFileSync` throws on the non-zero exit, so a
failed statement becomes a refusal rather than an empty result the parser has to catch.

### 6. Two findings this phase produced that were not predicted

**`UNION ALL` came back in a different order than it was written.** Run against the live stack,
the five-branch census returned `users, deck, generation_session, flashcard_schedule, flashcard`.
`UNION ALL` guarantees no ordering, and a positional parser would have reported `flashcard`'s
counts under `generation_session` with nothing looking wrong. `parseCensus` keys rows by **label**
and requires all five exactly once; the real, reordered output is the test fixture, so a
positional rewrite reddens. (Re-running a three-branch variant three times gave a stable order —
which is precisely why "it looked fine when I ran it" is not evidence here.)

**A gate's own failure message is part of the gate, and this one was wrong.** The short-census run
in §3 exited correctly and then advised `The local stack must be running before this step` — for a
failure where the stack was up and answering. Same class as C10X-43's `readTscFailure`, which
announced a `tsconfig` problem for an ordinary `TS2322`. The top-level catch now **enumerates**
candidate causes instead of asserting one, and names the census-parse refusal as deliberate. Found
by running the check, not by reading the code.

### 7. One divergence from the plan's contract, recorded rather than smoothed over

Plan Phase 3 §3 asks the fixture to carry "the seven real non-harness emails measured in Current
State Analysis". The fixture carries **fourteen** — every non-harness account in `auth.users` on
2026-08-14, read directly:

```
docker exec supabase_db_10x-astro-starter psql -U postgres -d postgres -t -A \
  -c "select email from auth.users where email not like 'harness-%' order by created_at;"
```

The plan's seven counts the accounts that own the eight artifact **decks**; the delete's blast
radius is every non-harness **account**, including the seven that own no deck (C10X-50's phase-4
account, three sign-out probes, three C10X-51/52 manual accounts). Fixturing the smaller set would
have left a pattern free to delete accounts that carry generation-session rows the census counts.
Strictly stronger, and it is the set the sharpest decoy lives in.

### 8. Criterion 3.6 — `--yes` was not run in this phase

Confirmed by the state it would have destroyed: after every run above, `npm run db:clean` still
reports **78,553 harness row(s) would be deleted**. The repayment is Phase 4's, and this figure is
its starting point rather than a leftover.

### 9. Restores, verified rather than remembered

**Four** breakage edits across this phase — one to the pattern (§4) and three to the census
statement (§3) — all to `scripts/db-cleanup.ts`, each reverted and each confirmed against hashes
taken before the first edit of its run:

```
md5sum -c  →  scripts/db-cleanup.ts: OK
              scripts/run-db-cleanup.ts: OK
              tests/lib/db-cleanup.test.ts: OK
```

One of those checks came back `FAILED` and is the §3 note above; the rest are `OK` at the close.
`run-db-cleanup.ts` was additionally edited **on purpose** between runs — §6's failure-message fix
— which is why its hash differs from the earliest recording and matches the latest.

Gates re-run on the fully restored tree, after every neuter: `npm test` **563 passed (563), 43
files**, `npm run typecheck` **OK — 163 files**, `npm run lint` **0 errors / 3 standing warnings**.

### 10. What this phase does NOT prove

- **The delete has never been executed.** Every claim above is about the census, the parsers, the
  oracles and the report. `--yes` is Phase 4's, deliberately, and until it runs the two read-back
  oracles (`harnessRemnants`, `nonHarnessDrift`) have been exercised only against fabricated
  censuses — never against a real before/after pair.
- **No test touches Docker, and none will.** `npm test` covers the pure half only;
  `scripts/run-db-cleanup.ts` gets no unit test, because every branch in it is I/O against the
  local Docker daemon — the same boundary test-plan.md §6.6 draws for the drift runner and for
  `disable-kong-keepalive.ts`. The wiring is carried by the runs recorded here, not by an
  assertion.
- **The `LIKE` mirror is a translation, not the database's own answer.** `matchesLikePattern`
  implements `%`, `_`, both anchors and case-sensitivity, and the test fixtures real addresses —
  but Postgres evaluates the delete, not this function. What connects them is that both read
  `HARNESS_EMAIL_PATTERN`, and §2's reconciliation (the census's `harness`/`other` split agreeing
  with an independent count) is the closest thing here to a cross-check of the two.
- **The safety invariant is post-hoc by construction.** `nonHarnessDrift` reports, after the fact,
  that something outside the pattern was destroyed. It cannot put it back. That is why plan
  Phase 4 takes a `pg_dump` snapshot **before** the delete rather than relying on this.
- **Nothing here repays the debt.** The database is measured, reported, and untouched: 21,822
  decks at the close of this phase, up from 21,312 when Phase 2 opened, because this phase ran the
  suite four times.

---

## Phase 4 — Repay the backlog

> **This is the change's one irreversible phase**, executed 2026-08-15. Everything above measures;
> this deletes. Read §1 before §2: the snapshot was taken **first**, because every safety mechanism
> the tooling owns is post-hoc — the script's invariant and the read-backs report, after the fact,
> that something was destroyed, and neither can put it back.

### 0. What this phase did

No file changed. Four recorded operations against the local dev database, in this order: a
`pg_dump` snapshot, `npm run db:clean -- --yes`, a separate delete of the 2026-08-05 orphan, and a
four-policy neuter window on the **repaid** database to test the change's headline claim.

### 1. Criterion 4.3 — the pre-delete snapshot

Whole-database `pg_dump`, taken before anything was deleted:

| Property | Value                                                                      |
| -------- | -------------------------------------------------------------------------- |
| Command  | `docker exec … pg_dump -U postgres -d postgres --no-owner --no-privileges` |
| Path     | `supabase/.temp/pre-cleanup-snapshot-20260815.sql` (gitignored)            |
| Size     | **27,944,305 bytes**                                                       |
| Exit     | 0, stderr empty                                                            |

**Two deviations from the plan's wording, both widening rather than narrowing.** The plan asks for
"`auth.users` plus the five public tables"; this is a dump of the **whole database**, because the
insurance is worth more than the curation and a table-list argument is one more thing to get wrong
on the one operation that cannot be undone. And the path is `supabase/.temp/` rather than a new
gitignored directory — `git check-ignore -v` resolves it to `supabase/.gitignore:3`, and
`git status --porcelain -uall` after the dump reported nothing new, so the ignore is measured
rather than assumed.

**The snapshot was verified to contain the rows that matter, not merely to exist.** All five data
blocks are present (`COPY auth.users`, `COPY public.deck`, `COPY public.flashcard`,
`COPY public.flashcard_schedule`, `COPY public.generation_session`), and each of the seven artifact
decks' `public_id` values appears in it exactly once. A dump that had silently come back
schema-only would have passed a size check and failed this one.

It is insurance, **not a rollback plan**, and it was never needed. Left in place at the close.

### 2. Criterion 4.4 — the repayment

Census taken **independently of the script** immediately before, through a different statement
(six scalar branches rather than the script's five-branch split), then `npm run db:clean -- --yes`:

| Measure                | Before |  After | Delta   |
| ---------------------- | -----: | -----: | ------- |
| `auth.users`           |  1,573 | **14** | −1,559  |
| — of which `harness-*` |  1,559 |  **0** | −1,559  |
| `deck`                 | 22,026 |  **8** | −22,018 |
| `flashcard`            | 38,055 | **41** | −38,014 |
| `flashcard_schedule`   |  7,449 |  **3** | −7,446  |
| `generation_session`   |  9,769 | **11** | −9,758  |

`DELETE 1559` on `auth.users`; the cascade did the rest. **78,795 rows removed on one statement.**

**Both of the script's oracles fired and both were green**, and this is the first time either has
run against a real before/after pair rather than a fabricated census (Phase 3 §10 recorded exactly
that gap):

- `harnessRemnants` — every harness count is **0** after. A `delete` that matched nothing also
  exits 0 and prints `DELETE 0`, so the statement's own success proves nothing here.
- `nonHarnessDrift` — every non-harness count is **unchanged**: 14, 8, 41, 3, 11 on both sides.
  This is the invariant that makes the surviving artifacts a property of the tooling.

**The script's census and the independent read reconcile exactly on all six measures**
(1559 + 14 = 1573 · 22018 + 8 = 22026 · 38014 + 41 = 38055 · 7446 + 3 = 7449 · 9758 + 11 = 9769),
and the post-delete independent read matches the script's `after` table line for line. So the split
the delete acted on agrees with a query sharing none of its joins — the same cross-check Phase 3 §2
made on the report, now made on the operation.

### 3. Criterion 4.5 — the seven artifact decks

Read back **individually by `public_id`** through a `values`-list LEFT JOIN, so a missing row would
surface as `<<MISSING>>` rather than as a short result nobody counted:

| `public_id`  | Owner                                     | Name                       | After |
| ------------ | ----------------------------------------- | -------------------------- | ----- |
| `3adb78e2-…` | `c10x41-phase4@example.com`               | C10X-41 Faza 4             | ✓     |
| `be4edf97-…` | `c10x41-phase4@example.com`               | C10X-37 Faza 2 po zmianie  | ✓     |
| `7ff17480-…` | `c10x37-p4-manual@example.com`            | the 100-char C10X-37 probe | ✓     |
| `487fc250-…` | `e2e-harness@example.com`                 | Matryca 4.11               | ✓     |
| `90f08eac-…` | `c10x49-phase3@example.com`               | C10X-49 orphan X           | ✓     |
| `4ecb548f-…` | `c10x49-phase3@example.com`               | C10X-49 orphan X2          | ✓     |
| `29a77fed-…` | `manual-c10x52-p5-1786720259@example.com` | C10X52 Study Probe         | ✓     |

Seven of seven, owners intact, no `<<MISSING>>`. Re-read again at the close of the phase after
three further suite runs and a neuter window: still **7**.

**The strongest evidence for one of them is not in this table.** `487fc250-…` belongs to
`e2e-harness@example.com`, and `npm run e2e` (§6) signs in as that account through the real sign-in
form. A cleanup that had deleted it would not have reddened the e2e layer — C10X-46's teardown
would simply have minted a new account — so the row read-back and the green e2e run are two
independent checks on the same account, not one restated.

### 4. Criterion 4.6 — the orphan

`E2E deck 1785947414992`, the 2026-08-05 artifact of `seed.spec.ts`'s failed inline cleanup, owned
by `test@mail.com`. **Not** matched by the harness pattern, deliberately not baked into the script,
so it was deleted as a separate statement:

```
before:  3b720154-174f-4735-8cb7-74a087453817 | test@mail.com | E2E deck 1785947414992 | 0 cards
delete:  DELETE 1
after:   orphan_rows 0 · deck_total 7 · flashcard_total 41 · users_total 14
```

It held **0 flashcards**, so `flashcard_total` is unchanged at 41 across the delete — the delta is
one deck row and nothing else, which is what a deck-scoped delete of an empty deck should look
like. `test@mail.com` itself is left standing: the plan scopes this to the deck.

### 5. Criterion 4.7 — idempotency

A bare `npm run db:clean` immediately afterwards:

```
before:
  table                 harness      other
  users                       0         14
  deck                        0          7
  …
db:clean: nothing to clean — no harness rows. (Report only; nothing was deleted.)
```

Exit 0. **This is the first time the `removable === 0` branch has ever executed** — every Phase 3
run met a database holding 78,553 removable rows, so that branch shipped unexercised and is named
in Phase 3 §10. It now has a run behind it.

### 6. Criteria 4.1 / 4.2 — the gates on the repaid database

| Gate                | Result                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `npm test`          | **563 passed (563), 43 files**, seed `1786744936390`, 7.64 s                                 |
| `npm run e2e`       | **12 passed**, 22.3 s — setup, 3 specs, teardown                                             |
| `npm run typecheck` | **OK — 163 files checked**, 0 errors, 0 warnings                                             |
| `npm run lint`      | **0 errors**, 3 warnings — all `no-console` in `evals/generation-quality.eval.ts`, unchanged |

`npm test` was run again **after** the neuter window closed (§7): **563 passed (563)**, seed
`1786745173431`. That second run is the behavioural half of the restore verification — a text-match
on `pg_policies` is necessary and not sufficient, and a still-disabled `deck_select` could not
produce a green cross-account suite.

**The growth this change exists to measure was observed once more, cleanly, and for the first time
against a small denominator.** Entering the neuter window the database held **75** decks: the 7
artifacts plus **68** from a single `vitest` invocation — the per-run figure research states,
now read off a database where it is the whole population rather than a rounding error.

### 7. Criterion 4.8 — the four-policy neuter on the REPAID database

The change's headline claim: _a developer running the deliberate-breakage procedure now gets a red
where the guard is disabled._ Window opened with §6.6's recipe — `alter policy … using (true)` on
`deck_select`, `flashcard_select`, `flashcard_schedule_select`, `flashcard_schedule_update`, each
as a `-c` argument so psql echoed four `ALTER POLICY`, with a `pg_policies` read-back confirming
all four `qual` values were literally `true`. `with_check` was left intact, matching §6.6's wording
and Phase 2's window.

#### 7.1 The claim is proved — and by the assertion this change did NOT write

Both files, hardened tree, inside the window: **3 failed | 41 passed (44)**, seed `1786745041736`.

```
FAIL tests/study/study.test.ts > listDueCounts backs the deck picker > never exposes another account's deck
AssertionError: expected 1 to be undefined
 ❯ tests/study/study.test.ts:432:42
    432|     expect(foreign.data?.[deckPublicId]).toBeUndefined();

FAIL tests/review/candidates.test.ts > … > counts pending candidates per deck, in one query, and never across accounts
AssertionError: expected 2 to be undefined
 ❯ tests/review/candidates.test.ts:638:44
    638|     expect(foreign.data?.[withCandidates]).toBeUndefined();
```

**Both sites redden. Neither reddens on the line this change added.** `:432` and `:638` are the
_original_ single-deck absence assertions — the exact two lines that were measured GREEN under this
same neuter at 21,345 decks (§3.1). With nothing truncated, A's deck is now inside B's result and
they fail by themselves.

So the deliberate-breakage procedure is repaired, and **the repayment alone repairs it**. That is a
stronger result than the criterion asked for and a deflating one for the hardening's marginal
value, and both halves are recorded rather than the convenient one.

#### 7.2 The prediction did not survive contact, and the reason is a shape this file already names

Criterion 4.8 says "confirm **the hardened assertion** goes red". It did not execute. Vitest aborts
a case at its first failed `expect`, so `:432` failing means `:460` — the hardened
`expect(leakedToB).toEqual([])` — never ran. That is **§3.2's masking shape reproduced one layer
up**: in Phase 2 an earlier owner-read masked the candidates denial; here the earlier denial masks
the hardening meant to back it up. Recorded as observed rather than rounded to the prediction, the
discipline this project has applied to C10X-29's `missingLocal` neuter and C10X-30's case 8.

#### 7.3 So the hardened line was made observable, by probe, and it is deterministically RED

The single preceding assertion was commented out at each site — nothing else touched — and each
case run alone inside the same window:

| Site                                  | Seed            | Result                                                             |
| ------------------------------------- | --------------- | ------------------------------------------------------------------ |
| `tests/study/study.test.ts:460`       | `1786745106559` | **RED** — `expected [ Array(1) ] to deeply equal []`, `b6aa29a6-…` |
| `tests/review/candidates.test.ts:661` | `1786745118131` | **RED** — `expected [ Array(1) ] to deeply equal []`, `c12c11ff-…` |

**Both leaked ids were read back in psql and both are account A's decks**, so the assertion
reddened on a genuine cross-account key rather than on a bookkeeping artefact:

```
b6aa29a6-… | harness-a-msthwk5w@example.com | Private counts deck msthwkxy | generated 0
c12c11ff-… | harness-a-msthwt3h@example.com | Chip deck msthwtxd           | generated 2
```

The candidates deck carries `generated = 2`, so it was genuinely eligible for that RPC's INNER JOIN
on `state_id = 1` — the eligibility condition the plan singles out for this site.

**And this is the deterministic red Phase 2 could not obtain.** Under `-t` filtering the reference
set holds exactly **one** deck, which on the un-repaid database landed inside the window about 2
times in 10 — §3.3's single-case run in the same shape came back **green**. Here it is red, on the
first attempt, at both sites. The falsifiability is a property of the **database**, and the
repayment is what supplies it.

Probe removed and the tree restored: `md5sum -c` **OK** on both files against the pre-probe hashes
(`23b0962b… study.test.ts`, `f541bb87… candidates.test.ts`), and `git diff` over the two files
empty.

#### 7.4 One divergence, and it reproduces Phase 2's exactly

`returns 404 when B rates a card in A's deck` failed **`expected 500 to be 404`**
(`study.test.ts:352`), not §6.6's recorded `expected 200 to be 404`. This is the second window in
this change to observe it, at a different deck count and on a different database state, which
promotes §3.4's note from a one-off to a reproducible divergence — the inference there (a `using`-only
neuter lets B's UPDATE match A's row and then be refused by the still-intact `with_check`, which the
endpoint answers as 500) is unchanged and still **not verified**. Left as a note, not as a correction
to §6.6.

#### 7.5 Restore, verified rather than remembered

The four original `qual` expressions were captured verbatim to files **before** the neuter and the
restore built from those files, so nothing was retyped. `pg_policies` dumped over all public
policies before and after:

```
diff policies-before.txt policies-after.txt   →  no output
md5  6bd70d47466b27b730bef96572ba6f47          →  identical, both files
```

Behavioural corroboration in §6: the full suite, including every cross-account denial, green
against the restored policies.

### 8. End state

| Measure                | At the close |
| ---------------------- | -----------: |
| `auth.users`           |           26 |
| — of which `harness-*` |           12 |
| `deck`                 |          179 |
| `flashcard`            |          339 |
| `flashcard_schedule`   |           69 |
| `generation_session`   |           83 |

179 decks: the 7 artifacts plus this phase's own runs — five `vitest` invocations, three of them
full-suite. **The debt is already accruing again**, visibly, which is the honest end state of a
developer-invoked tool and is §9's first bullet rather than a footnote.

### 9. What this phase does NOT prove

- **`db:clean` is developer-invoked and nothing watches a counter.** The database went from 7 decks
  to 179 inside this phase. Nothing detects the decay, and the next person to meet an unfalsifiable
  absence-assertion will meet it exactly the way C10X-51 did.
- **The hardened assertions' red under a neuter is not what produced §7.1's result**, and on a
  repaid database they are not what a developer would see redden first — the original single-deck
  assertions get there one line earlier. Their value is insurance against the volume returning, and
  §7.3 is the measurement that they work; §7.1 is not.
- **The masking in §7.2 is not fixed.** An assertion an earlier `expect` in the same `it()` prevents
  from executing is a second way for a guard to be unfalsifiable, this file has now recorded it
  twice (§3.2 and §7.2), and this ticket was chartered to fix neither.
- **The neuter is one window, on one machine, on one day**, and it neuters `using` only — §7.4's
  divergence is an open question about §6.6's own recipe, unresolved here for the second time.
- **Nothing was verified against production.** Both RPCs still carry no `ORDER BY` and both still
  have live consumers; their safety remains the data-volume property of production §6 records.
- **The snapshot proves the insurance existed, never that a restore works.** It was never replayed,
  and a `pg_dump` that restores cleanly is a claim nothing here tested.
- **`test@mail.com` survives** with no decks. The orphan deck is gone; the account that owns nothing
  is left, deliberately, because the plan scopes the delete to the deck.

### 10. Re-verification pass, run fresh at the phase gate

Every manual criterion above was re-executed against the live state at the close of the phase
rather than re-read from the notes taken while it ran. Four checks reproduce, one has legitimately
moved, and one number is new.

| Criterion                 | Re-verified                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.3 snapshot              | 27,944,305 bytes, mtime **00:01:05** — i.e. before the delete; `git check-ignore` resolves it to `supabase/.gitignore:3`; 5 `COPY` data blocks; all 7 artifact ids **and the orphan's** present |
| 4.5 seven artifact decks  | **7/7 PRESENT**, owners intact, and each carrying its **original `created_at`** (2026-07-31 / 08-13 / 08-14) — so these are the original rows, not rows recreated by a later run                |
| 4.6 orphan                | gone on three independent probes: by `public_id` **0**, by name **0**, decks owned by `test@mail.com` **0**; the account itself still exists, as designed                                       |
| 4.8 restore               | `pg_policies` dumped a **third** time; `before` / `after` / `now` all `md5 6bd70d47466b27b730bef96572ba6f47`, `diff` empty; all four policies read `restored`                                   |
| 4.4 non-harness invariant | **14 / 7 / 41 / 3 / 11** — byte-identical to the values measured immediately after the repayment, across five further suite runs, an e2e run and a neuter window                                |
| 4.7 bare `db:clean`       | **moved, legitimately** — see below                                                                                                                                                             |

**The one that moved is the most informative result of this pass.** §5 recorded criterion 4.7
immediately after the repayment, where the census read `0` harness rows and the script printed
`nothing to clean`. Re-run now it reads:

```
users 12 · deck 172 · flashcard 298 · flashcard_schedule 66 · generation_session 72
db:clean: 620 harness row(s) would be deleted.
```

Nothing regressed. Those rows are **this verification's own footprint** — five `vitest`
invocations, an `npm run e2e`, and the in-window runs of §7 — and the non-harness side did not move
by a single row while they accrued. That is the safety invariant holding across an hour of ordinary
use rather than across one statement.

It also puts a number on §9's first bullet that the phase could not otherwise have supplied: **7 →
172 harness decks in roughly one hour of one developer's work.** The plan's Desired End State
permits exactly this ("plus whatever the current session's runs created"), so the database is left
as it stands rather than re-cleaned — a second `--yes` would buy a tidier census and destroy the
only direct measurement of the decay rate this change owns.

**A trailing detail checked rather than assumed.** A scan for permanently-`true` policies returns
**3** — `flashcard_state_select`, `flashcard_source_select`, `language_select`. All three are
read-only dictionary tables, all three are `using (true)` in committed migrations
(`20260705180246`, `20260710195327`, `20260731120000`), and all three are inside the byte-identical
dumps, so they predate the window. Recorded because a bare "3 policies are `true`" in a restore
check is exactly the kind of number that reads as an alarm to the next person who runs it.
