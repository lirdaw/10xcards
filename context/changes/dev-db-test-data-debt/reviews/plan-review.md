<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Local dev-DB test-data debt

- **Plan**: `context/changes/dev-db-test-data-debt/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-14
- **Verdict**: REVISE → **SOUND after triage** (8 of 8 fixed in the plan, 2026-08-14)
- **Findings**: 3 critical, 3 warnings, 2 observations — all FIXED

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | FAIL    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

8/8 paths ✓, 9/9 line anchors ✓, brief↔plan ✓, Progress↔Phase contract ✓ (5 phases, 27 steps,
all matched to Success Criteria; `#### Automated` / `#### Manual` subdivision conforms to
`references/progress-format.md`).

Verified directly rather than assumed: `tests/study/study.test.ts:400-412` (assertion at `:407`,
positive control at `:410-411`, `suffix` at `:42`, `Gate deck` at `:609`);
`tests/review/candidates.test.ts:613` / `:616-617` / `:47` / `:908`; `src/lib/decks.ts:11-13`
(`listDecks` ordering, no `user_id` predicate); both RPC bodies
(`20260724195248_srs_study_schedule.sql:139-150`, `20260725150000_candidate_counts_rpc.sql:31-40`);
`scripts/` pair inventory; `package.json` `db:*` block; `supabase/config.toml:5,18,328`;
`roadmap.md` (H-20 is the latest row, H-21 free); `.prettierignore` (`context/archive/**` present);
`context/archive/2026-08-08-e2e-harness-journeys/plan.md:105-112`.

One behaviour was **measured** rather than read: npm argument forwarding (see F2).

Recorded so it is not re-derived: the plan states the `scripts/` convention as
`<noun>.ts` + `run-<noun>.ts`, which holds for `typecheck` but not for
`kong-keepalive`/`disable-kong-keepalive` or `schema-drift`/`check-schema-drift`. The chosen name
`run-db-cleanup.ts` is fine either way; only the generalisation is loose. Not raised as a finding.

## Findings

### F1 — "a deck B owns" has no defined source, and Phase 2's criterion selects the one that breaks after Phase 4

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §1 and §2 (the hardening contract), Phase 2 manual criterion 2.4
- **Detail**: The contract is "**every key** in `foreign.data` is a deck B owns". The plan never
  says how the test establishes which decks B owns, and the two available sources are each
  broken — in opposite directions.
  - B owns 0–4 decks at that moment, created in OTHER files (`tests/isolation/decks.test.ts:55`,
    `flashcards.test.ts:103,121,286`), and `sequence.shuffle` is permanently on. So "assert
    `foreign.data` is empty" is order-dependent — the class C10X-32 fixed and §6.2 forbids. Not
    marginal: `study_due_counts` selects `from public.deck` with a LEFT JOIN and
    `group by d.public_id`, so it returns a row for **every** visible deck including zero-count
    ones (the file's own `:397` asserts `toBe(0)`). Every B deck appears.
  - The alternative — derive the set from `listDecks(b)` — is poisoned by the neuter itself:
    `src/lib/decks.ts:11-13` carries no `user_id` predicate, RLS is the only lock (§6.4 says so).
    Under `deck_select using (true)` B's "own set" becomes the whole database.

  The consequence:

  ```
  at 20,748 decks   listDecks(B) → newest 1000 · foreign.data → hash-agg 1000
                    the two windows barely overlap → RED   ✅ satisfies criterion 2.4
  after Phase 4     ~70 decks, no truncation anywhere
                    both sets = every deck → every key IS "owned" → GREEN  ❌
  ```

  So the implementation that passes Phase 2's success criterion is the one that becomes a
  permanent false pass on the repaid database — the defect being fixed, inverted. The other
  candidate (assert no deck A created in this file appears in B's result) is the mirror: green
  under the neuter at 20k decks (research measured 2/10 and 4/10 for exactly this), red forever
  after the cleanup. The plan's rationale — "falsifiability improves with row count" — holds only
  for the broken one.

- **Fix A ⭐ Recommended**: Assert absence of A's file-local decks, and move the hardened shape's
  red into Phase 4
  - Strength: Needs no reference query, so nothing the neuter can disable feeds the oracle, and it
    is order-independent — the test already knows every deck it created for A. It reddens at any
    size once the DB is small, the state Phase 4 creates and `db:clean` maintains.
  - Tradeoff: Phase 2's criterion 2.4 must be re-scoped — the perishable half is the OLD shape's
    false pass; the NEW shape's red is verified after Phase 4. The pair stops being simultaneous.
  - Confidence: HIGH — ownership sets and RPC bodies were read, not inferred; research's 2/10 and
    4/10 window measurements predict both directions.
  - Blind spot: The bound on "small enough that nothing truncates" is stated nowhere; at ~70 decks
    it is not close, but nothing watches it.
- **Fix B**: Give both RPCs a deterministic `ORDER BY created_at desc` (currently scoped out)
  - Strength: Fixes the class rather than two call sites — `listDecks` survives the cliff for
    exactly this reason (10/10 measured) — and every future consumer inherits falsifiability.
  - Tradeoff: A migration ships, so the C10X-29 drift gate and `/ship` acquire a database step the
    plan states it has none of; and it changes production SQL to fix a test-tooling problem, which
    the plan explicitly rejected.
  - Confidence: MEDIUM — mechanically sound, but the two production callers
    (`src/pages/decks/index.astro:18`, `src/pages/study/index.astro:15`) were not surveyed for
    ordering assumptions.
  - Blind spot: Plan-shape impact of `group by` + `order by` at production row counts unmeasured.
- **Decision**: FIXED via Fix A — both hardening contracts rewritten to a test-local reference set,
  Phase 2's criterion 2.4 re-scoped to the old shape's false pass alone, and the hardened shape's
  red moved to a new Phase 4 criterion + Progress step 4.8. Desired End State and the brief's
  matching sentence updated. **This also resolves F4**, whose fix was the same Phase 4 criterion.

### F2 — `npm run db:clean --yes` does not pass `--yes` to the script (measured)

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §1(f) + §4, Phase 4 §1, Progress 3.6
- **Detail**: npm parses `-`-prefixed arguments itself unless separated by `--`, and `yes` is a
  real npm config key. Measured on this machine (npm 11.16.0), the script's `process.argv`:

  ```
  npm run <script> --yes      → []          ← the plan's Phase 4 command
  npm run <script> --yess     → []
  npm run <script> -- --yes   → ["--yes"]
  ```

  Two consequences. Phase 4's repayment command deletes nothing and reports a census — fail-safe,
  but it is the phase the whole change exists for. And the contract "an unrecognised flag must be
  refused, not ignored — refuse both ways" is **unreachable through the npm script**: `--yess`
  never arrives either, so the guard fires only under a direct
  `node --experimental-strip-types scripts/run-db-cleanup.ts --yess`.

- **Fix**: Write the command as `npm run db:clean -- --yes` everywhere it appears (Phase 3 §4's
  contract, Phase 4 §1, Progress 3.6), and state in Phase 3's test contract that the unknown-flag
  refusal is asserted against the pure argv parser and exercised manually via the direct `node`
  invocation, never via `npm run`.
- **Decision**: FIXED

### F3 — An irreversible delete of cited evidence, with no pre-delete snapshot

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1 and §2
- **Detail**: Phase 4 deletes ~1,468 users cascading to ~20,748 decks / 35,810 flashcards, plus one
  deck by `public_id`. Every safety mechanism the plan names is **post-hoc**: the script's
  non-harness-unchanged invariant, and the independent read-back of the seven artifact decks. Both
  report afterwards that something was destroyed; neither can put it back. The change's charter is
  that these rows are evidence archived documents cite ("left in the local dev DB **as the artifact
  of record**"), and Phase 5 then writes dated corrections assuming they exist. The plan reasons
  carefully about restoring the RLS neuter and about the policy-vs-CHECK restore asymmetry — the
  same reflex is absent for the one genuinely irreversible operation in the change.
- **Fix**: Before the delete, dump `auth.users` + the five public tables to a gitignored path with
  `docker exec … pg_dump -U postgres -d postgres`, and record its size in `verification.md`. Note it
  is insurance against a mis-scoped pattern, not a rollback plan, and may be deleted once Phase 4's
  read-back passes. (Kept on one line deliberately: a code span split across a line break is the
  C10X-43 prettier landmine.)
- **Decision**: FIXED

### F4 — The headline end-state property is never verified in its end state

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 4 Success Criteria; plan-brief "Success Criteria (Summary)" bullet 1
- **Detail**: The brief's first success criterion is "a developer running the deliberate-breakage
  procedure gets a **red** where the guard is disabled". Nothing in the plan checks that after the
  repayment. Phase 4's criteria are: suite green, e2e green, counts recorded, seven decks present,
  orphan gone, census near-empty. The only neuter window is Phase 2, on the _un-repaid_ database.
  So the central claim is verified exclusively in the state it is about to destroy — and this is
  the cheapest check that would catch F1's failure mode.
- **Fix**: Add a Phase 4 manual criterion and Progress step: re-run the four-policy neuter on the
  repaid database, confirm the hardened assertion goes red, restore, verify by a `pg_policies`
  diff. Record it in `verification.md` beside the perishable pair and name it in Phase 5's §6.6
  entry as the claim that survives the cleanup.
  - Strength: Turns the brief's headline promise into a measurement, and is the only check that
    distinguishes a correct hardening from F1's broken one.
  - Tradeoff: One more neuter window, restore discipline paid twice.
  - Confidence: HIGH — the procedure is already written down for Phase 2 and reruns verbatim.
  - Blind spot: If the hardened shape does NOT redden there, Phase 2's work needs redesign after
    Phase 4 has already run — which argues for resolving F1 first.
- **Decision**: FIXED as part of F1's Fix A (Phase 4 manual criterion + Progress 4.8).

### F5 — Criterion 1.1 is filed as Automated but nothing automates it, and "cannot recur" overstates what Phase 1 delivers

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Changes Required; Phase 1 automated criterion 1.1; Desired End State
- **Detail**: Desired End State says "the `Gate deck` collision **cannot recur**". Phase 1 renames
  one literal and writes a prose bullet in §6.5; the entropy sweep is out of scope. So recurrence
  is prevented by a rule nothing enforces — and criterion 1.1 ("a sweep over `tests/` for literals
  passed to `createDeck` returns no duplicate stem") sits under **Automated Verification** while
  Phase 1's Changes Required creates no file that could run it. As written it is a one-off grep,
  i.e. manual. The project already has the idiom and the argument:
  `tests/lib/no-env-access.test.ts` opens with "A prose rule nothing enforces is not a rule", and
  `form-endpoint-guards.test.ts` / `e2e-isolation.test.ts` are textual guards of this exact shape,
  with the same origin story (a sweep found incomplete twice by reading).
- **Fix**: Add a fourth item to Phase 1 — a textual guard in `tests/lib/` extracting every deck
  name literal passed to `createDeck` across `tests/` and asserting no stem appears in two files,
  with a positive control (the walker reaches the files; a planted duplicate reddens it). Then 1.1
  is genuinely automated and "cannot recur" is true. Alternatively downgrade 1.1 to Manual and
  soften the End State to "this collision is removed and the class is recorded".
- **Decision**: FIXED

### F6 — The collision was already recorded on 2026-07-29 and the plan treats C10X-51 as the earliest sighting

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 contract; research §4 Defect A
- **Detail**: `context/archive/2026-07-29-flashcards-test-order/reviews/impl-review.md:303` already
  names it, under **"Deliberately not raised as findings"**: "Cross-file `Date.now().toString(36)`
  suffix collision (`Gate deck ${suffix}` in both study.test.ts:558 and candidates.test.ts:847) —
  explicitly out of scope by plan, and correctly recorded as such." So the mechanism was identified
  16 days before it cost C10X-51 two unattributable reds and this ticket a 92-run matrix. Phase 1
  §2's contract starts the history at C10X-51 and misses the more valuable lesson: a finding parked
  in one review's not-raised section is invisible afterwards — a class this ledger records
  repeatedly (C10X-34 F1's "no key at all", the C10X-37 deferrals).
- **Fix**: Cite `2026-07-29-flashcards-test-order/reviews/impl-review.md:303` in the §6.5 bullet as
  the first recorded sighting, and state the second-order rule — a deliberately-deferred finding
  needs a ticket or a live-document entry, not only a line in a review. The archive entry itself
  needs no dated correction: it was accurate and its scope decision was correct.
- **Decision**: FIXED

### F7 — `config.toml` carries a second, commented `project_id`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §1(b), §3
- **Detail**: `supabase/config.toml:5` is `project_id = "10x-astro-starter"`; `:328` is
  `# project_id = "my-firebase-project"`. A first-match regex is correct, but a `matchAll` or a
  last-wins read resolves to a container name that does not exist. Phase 3 §3 already says the
  fixture is "real `config.toml` text" — worth stating that "real" means text including line 328,
  and that the parser must ignore commented keys.
- **Fix**: Name the decoy explicitly in Phase 3 §3's fixture contract.
- **Decision**: FIXED

### F8 — The two unordered RPCs already have production consumers

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 5 §4 (the does-NOT-prove list)
- **Detail**: The list is to say "a new consumer inherits the trap". There are already two:
  `src/pages/decks/index.astro:18` (`countCandidatesByDeck`) and `src/pages/study/index.astro:15`
  (`listDueCounts`). They are safe today for a reason worth writing down rather than leaving
  implicit — under intact RLS a real user owns far fewer than 1,000 decks — which makes the safety
  a data-volume property of production, the same kind of property that decayed locally.
- **Fix**: Name both call sites in the does-NOT-prove list, with the reason they are safe.
- **Decision**: FIXED
