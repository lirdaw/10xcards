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
