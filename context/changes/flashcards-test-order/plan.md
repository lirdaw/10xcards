# Order-Independent Test Suite + `sequence.shuffle` Implementation Plan

## Overview

Fix the six order-dependent case-pairs the C10X-32 research inventoried across three test files, then permanently enable `sequence.shuffle` in BOTH Vitest configs (`vitest.config.ts` and `vitest.eval.config.ts`) so this defect class fails loudly in CI instead of hiding behind declaration order. Deferred finding F6 from the C10X-26 impl-review is pair #3 of the six; the ticket's scope is the whole suite, and the research already swept it.

## Current State Analysis

Ground truth is `context/changes/flashcards-test-order/research.md` (2026-07-29, same commit as HEAD `ea77584`) — read it before implementing; every claim below cites it.

- **Six order-dependent pairs, three files** — four confirmed by execution (shuffled runs with seeds 101/202/303 all exit 1), two latent (#2, #6 — found only by static analysis; three seeds never fired them, which is why "shuffle until green" would under-count).
- **One shape**: a positive control mutates the shared `beforeAll` fixture that denial cases assert file-scope constants against (pairs #1–#5), or an aggregate assumes its siblings already ran (#6, the `srs_state=3` canary).
- **The fix pattern already exists in-repo**: F1 from C10X-26 — the mutating case gets its own fixture ("Control deck" at `tests/generation/generate.test.ts:371-374`; `doomedId` at `tests/isolation/decks.test.ts:106` is the same form avant la lettre). No assertion changes meaning.
- The six pairs share only **four mutation sites**: pairs #1/#2/#3 have one mutator (the edit positive control), #4 one, #5 one, #6 is the fixture-less canary. So the fix is four edits.
- **The other 15 files are order-safe**, verified per-`it()` — do not touch them.
- Neither config has a `sequence` key today. The two configs are deliberately independent copies (commented in both files); nothing propagates — each needs its own edit.
- `npm run eval` currently exits **1 on a real generation defect** (forced `niemiecki`/`francuski` → Polish cards, C10X-31). Its 10 cases are independent by construction.
- Shuffle logs from the research runs are preserved at `C:\Users\lirda\.claude\jobs\<research-session>\tmp\shuffle-{101,202,303}.log` (session job dir; if gone, the seeds reproduce the runs).

## Desired End State

- All 220 ordinary tests pass under any shuffle permutation: the three known-red seeds replay green, and fresh (unpinned-seed) runs stay green.
- `vitest.config.ts` and `vitest.eval.config.ts` both carry `sequence: { shuffle: true }`, seed deliberately un-pinned (default `Date.now()`), so CI accumulates permutations and the banner (`Running tests with seed "<n>"`) makes any red replayable.
- The eval path's failure set under shuffle equals its known baseline (forced de/fr red, everything else green) — shuffle introduces no new eval failures.
- `test-plan.md` documents the replay procedure and the order-safety rule; `lessons.md` carries the "positive control must own its fixture" lesson.

### Key Discoveries:

- The three broken assertions in `flashcards.test.ts` describe 1 (`:145`, `:160`, `:194`) all break via ONE mutator (`:204-212`) — one owned-card fix covers pairs #1–#3.
- `candidates.test.ts` overwrite/delete audit denials (`:700-735`) are safe (they re-read `before` inside the `it()`); only the read case `:697` asserts the seed constant — the distinction "assert what you re-read vs assert a file-scope constant" is the load-bearing rule (research, Architecture Insight #2).
- Shuffle never touches hooks — `beforeAll`/`beforeEach` still run before the tests in their scope, so no fixture setup needs restructuring; every fix is local to an `it()`.
- With `shuffle: true` in config, replaying a red run needs only `npx vitest run --sequence.seed=<n>` — no extra flag.

## What We're NOT Doing

- **No production code changes.** Tests + two configs + docs only.
- **No changes to the 15 order-safe files.**
- **No weakening of any assertion.** Denial cases keep asserting `A_FRONT` / `STATE_ACCEPTED` / the seeded `error_message` against the shared fixture; the canary keeps its account-wide scan and its `not.toContain(State.Relearning)` assertion.
- **No restore-after-mutate.** Restoring the shared fixture at the end of a mutating case is itself order-dependent hygiene; the pattern is an owned fixture, full stop.
- **No pinned seed.** A pinned seed would test one permutation forever; un-pinned accumulates coverage per CI run by design.
- **Not fixing the eval's forced-language defect** (de/fr → Polish) — that red is a separate follow-up from C10X-31 and stays red here.
- **Not fixing the latent cross-file suffix collision** (two files loaded the same millisecond share `Date.now().toString(36)`) — recorded by research as out of scope, not a shuffle issue.
- **Not re-running §6.6 deliberate-breakage checks** — shuffle does not change their splits; the existing rule (re-derive denominators before citing) stands unchanged.

## Implementation Approach

Fix first, enable second — the config flip lands only after the fixes are proven green under manual shuffle flags, so enabling shuffle never lands red. All four fixes copy the F1 pattern: the mutating positive control (or the fixture-less aggregate) creates and uses its own row(s) inside its `it()`, leaving the shared `beforeAll` fixture immutable for the denial cases. Then both configs gain `sequence: { shuffle: true }`, verification runs the known seeds plus ten fresh permutations plus one paid eval run, and docs record the rule and the replay procedure.

## Critical Implementation Details

- **Eval verification oracle is failure-set equality, not exit code.** `npm run eval` exits 1 today on a real generation defect. After enabling shuffle, one run (key in the SHELL env, ~$0.012) must fail on exactly `forced/niemiecki` + `forced/francuski` and nothing else. Treat `hiszpański` per the calibration rule (intermittent 4/5 in research history; a red there gets one hand re-run before being believed — two reds = real).
- **The canary fix (#6) inverts the pattern**: the fixture goes to the *aggregate*, not a mutator. Seed one deck + accepted card + `loadSession` (which runs `ensureSchedule`) inside the canary's `it()` so `length > 0` is guaranteed by a row the case owns — while keeping the scan account-wide (that breadth is the canary's documented point, test-plan §6.6 Phase 4). Note the scan may also see rows raced in by parallel workers of other files; harmless, since the main assertion is a `not.toContain`.
- **The audit-rewrite fix (#5) needs its own seeded session**, mirroring the `beforeAll` insert at `candidates.test.ts:649-665` (a direct RLS-scoped insert with the four private audit columns, per-run-unique values). The rewrite then targets that session; the shared one stays holding `upstreamMessage` for the read case at `:697`.
- **Optimistic-lock trap when creating cards for #4/#6**: a schedule row exists only after `listDueCards`/`loadSession` runs (§6.7) — the transition fix (#4) does not need a schedule, but the canary fix (#6) does; go through the file's existing `loadSession` helper.

## Phase 1: Fix the six order-dependent pairs

### Overview

Four edits across three files remove every inter-`it()` dependency the research inventoried, verified by replaying the three known-red seeds green before any config changes.

### Changes Required:

#### 1. Isolation suite — describe 1 (pairs #1, #2, #3)

**File**: `tests/isolation/flashcards.test.ts`

**Intent**: The positive control "still lets A edit A's own card" (`:204-212`) currently edits the shared `beforeAll` card, breaking the three denial assertions that compare `cards[0].front` to the file-scope `A_FRONT` constant (`:145`, `:160`, `:194` — the last is the original F6 line). Give the control its own card so the shared card is never mutated.

**Contract**: Inside the `it()`, create the control's OWN deck and a fresh card in it (the full "Control deck" F1 form — suffix-namespaced names per §6.5), edit *that* card through the endpoint, and assert the edit landed on it. The owned card must NOT go into the shared `aDeckId`: the three denials assert `expect(cards).toHaveLength(1)` on that deck (`:144`, `:159`, `:193`) before the `A_FRONT` lines, so any card added there is itself a new order dependence — the same reason the "Control deck" comment at `generate.test.ts:371-374` gives verbatim. The shared card, `A_FRONT`, `A_BACK`, and all three denial assertions stay byte-identical.

#### 2. Isolation suite — describe 2 (pair #4)

**File**: `tests/isolation/flashcards.test.ts`

**Intent**: The positive control "still lets A transition A's own card" (`:310-315`) moves the shared card to `rejected`, breaking the denial's precondition `expect(before.state_id).toBe(STATE_ACCEPTED)` (`:278`) — the check that B's attempted transition is a legal one. Give the transition control its own card.

**Contract**: Inside the `it()`, create the control's own deck and an own accepted card in it, then run the transition against that card — the same uniform rule as change #1. (Describe 2 happens to carry no length assertion on A's batch deck today — the only count is `cardsOf(b, bDeckId)` at `:304` — so a shared-deck card would not break anything *yet*; the own deck is chosen so the fix does not lean on what the describe accidentally omits.) The denial case and its precondition stay unchanged. (The `toEqual(before)` at `:286` is already safe — re-read inside the `it()`.)

#### 3. Review suite — audit describe (pair #5)

**File**: `tests/review/candidates.test.ts`

**Intent**: "still lets A rewrite A's own audit columns" (`:741-745`) persists `error_message = "Audit repaired <suffix>"` into the ONE session the describe seeds in `beforeAll` (`:649-665`), breaking the read case's `expect(owner.error_message).toBe(upstreamMessage)` (`:697`) — the observed failure in all three seeds. Seed the rewrite case its own session.

**Contract**: Inside the `it()`, insert a second `generation_session` row (same shape as the `beforeAll` seed: four private audit columns, per-run-unique values) and rewrite that one. The shared session and the three other audit `it()`s stay unchanged.

#### 4. Study suite — the `srs_state=3` canary (pair #6)

**File**: `tests/study/study.test.ts`

**Intent**: The canary (`:871-879`) owns no fixture — its positive control `expect(data?.length ?? 0).toBeGreaterThan(0)` (`:878`) over an account-wide `flashcard_schedule` scan holds only because, in declaration order, earlier cases already seeded schedule rows. Shuffled first it goes red (or, worse, flakes green off another file's raced rows while the main assertion is vacuous). Give the canary one owned schedule row.

**Contract**: Inside the `it()`, seed an own deck + accepted card and run the file's `loadSession` helper (which triggers `ensureSchedule`), guaranteeing at least one row the case owns. The scan stays account-wide and the `not.toContain(State.Relearning)` assertion stays unchanged.

### Success Criteria:

#### Automated Verification:

- Replay seed 101 green: `npx vitest run --sequence.shuffle --sequence.seed=101` → 220/220 (was 3 failed)
- Replay seed 202 green: same command, seed 202 → 220/220 (was 4 failed, incl. the F6 line)
- Replay seed 303 green: same command, seed 303 → 220/220 (was 3 failed)
- Declaration-order run still green: `npm test` → 220/220
- Lint passes: `npm run lint`

#### Manual Verification:

- Diff review: every fix only ADDS an owned fixture — no denial assertion, precondition, or canary scan changed meaning

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation of the diff review before proceeding to Phase 2.

---

## Phase 2: Enable `sequence.shuffle` in both configs + verification matrix

### Overview

Flip shuffle on permanently in both runners, then prove it: known seeds, ten fresh permutations, one paid eval run compared against the known baseline.

### Changes Required:

#### 1. Ordinary suite config

**File**: `vitest.config.ts`

**Intent**: Enable permanent shuffling so the order-dependence class fails loudly in CI (the ticket's acceptance criterion).

**Contract**: Add `sequence: { shuffle: true }` to the `test` block, with a short comment: seed deliberately un-pinned (default `Date.now()`) so CI accumulates permutations; the banner prints the seed — replay a red with `npx vitest run --sequence.seed=<n>`. `globalSetup` ordering (preflight → accounts) is unaffected by shuffle.

#### 2. Eval config

**File**: `vitest.eval.config.ts`

**Intent**: Same policy for the eval runner (user decision — both configs). The two configs are deliberate independent copies; this edit keeps them structurally parallel.

**Contract**: Add the same `sequence: { shuffle: true }` to its `test` block, comment noting the eval's 10 cases are independent by construction and that the eval's red baseline (forced de/fr) is unrelated to ordering.

### Success Criteria:

#### Automated Verification:

- Config-driven shuffle active: `npm test` banner prints `Running tests with seed "<n>"` with no CLI flags
- Known seeds replay green through config: `npx vitest run --sequence.seed=101|202|303` → 220/220 each
- Ten fresh unpinned runs: `npm test` ×10 → all 220/220; record each banner seed in `verification.md`. Policy for a red fresh run (mirrors the brief): an order dependence the inventory missed is a finding to fix in-change with the F1 pattern, not a blocker — fix it, record the seed and the pair in `verification.md`, then re-run the matrix
- Lint and build unaffected: `npm run lint` exit 0, `npm run build` exit 0
- One shuffled eval run (key in SHELL env, ~$0.012): failure set equals baseline — exactly `forced/niemiecki` + `forced/francuski` red, `auto` cases and `polski`/`angielski` green; banner prints a seed

#### Manual Verification:

- Accept the eval's exit 1 as the known baseline red (not a shuffle failure) and record the run table in `verification.md`

**Implementation Note**: After this phase's automated verification passes, pause for manual confirmation of the eval-baseline reading before Phase 3.

---

## Phase 3: Doc-sync

### Overview

Record the rule, the replay procedure, and the coverage claim where future contributors will look.

### Changes Required:

#### 1. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Make the shuffle regime discoverable: how to replay a red shuffled run, and the order-safety rule for new tests.

**Contract**: (a) In §6's cookbook (the §6.2 rule list is the natural home, beside the positive-control discipline that produced all five mutation pairs): the rule — a positive control must own its fixture; assert what you re-read inside the `it()`, never a file-scope constant captured before a sibling could mutate it. (b) The replay line: shuffle is permanently on; on a red, the seed is in the run banner — `npx vitest run --sequence.seed=<n>`. (c) A dated entry in §8 Freshness Ledger (suite 220/220 under shuffle, both configs, eval baseline unchanged) and a header "Last updated" note per the file's convention.

#### 2. Lessons

**File**: `context/foundation/lessons.md`

**Intent**: The class-level lesson the research named as a candidate: this suite's own §6.2 discipline (every denial pairs with a positive control) produced all five mutation pairs, because a control written against the shared fixture is the cheap way to write it.

**Contract**: New entry following the file's existing format — rule: "positive control must own its fixture"; why: five order-dependent pairs across three files, green only by declaration order; how to apply: F1 pattern (own row/deck inside the `it()`), and the re-read-vs-constant distinction.

#### 3. Change epilogue

**File**: `context/changes/flashcards-test-order/change.md` + `verification.md`

**Intent**: Close out the change folder: status update and the evidence file (seed table, ten fresh-run seeds, eval baseline comparison).

**Contract**: `change.md` status → `implemented` (per its lifecycle), `verification.md` carries every run with its seed and result, per the project's evidence discipline.

### Success Criteria:

#### Automated Verification:

- `grep -n "sequence.seed" context/foundation/test-plan.md` finds the replay line; `grep -n "positive control" context/foundation/lessons.md` (or Polish equivalent) finds the lesson
- Full suite still green after doc edits: `npm test` → 220/220

#### Manual Verification:

- Read-through: test-plan §6 rule, §8 ledger entry, and the lesson are accurate and dated; no §6.6 claim was silently altered

---

## Testing Strategy

### Unit Tests:

- No new tests — this change makes existing tests order-independent. The "test of the tests" is the shuffle itself, permanently enabled.

### Integration Tests:

- The verification matrix in Phase 2 IS the integration test: 3 deterministic seed replays + 10 fresh permutations + 1 eval baseline comparison.

### Manual Testing Steps:

1. Diff review after Phase 1: fixes only add owned fixtures.
2. Eval run reading after Phase 2: red set equals the C10X-31 baseline.
3. Doc read-through after Phase 3.

## Performance Considerations

`shuffle: true` (files + tests) drops Vitest's "long-running files first" scheduling optimization — measured cost on a 220-test suite is noise relative to the 30 s per-test timeouts already in place. Accepted in the config-shape decision.

## Migration Notes

None — no schema, no production code. The one operational change: a future red `npm test` in CI may be a genuine new order-dependence surfacing under a fresh seed. That is the feature working; the replay line in test-plan §6 is the runbook.

## References

- Research (complete inventory + empirical runs): `context/changes/flashcards-test-order/research.md`
- F1 fix pattern: `tests/generation/generate.test.ts:371-374` ("Control deck"); `tests/isolation/decks.test.ts:106` (`doomedId`)
- Original F6 finding: `context/archive/2026-07-18-ai-candidate-generation-test/reviews/impl-review.md`
- Canary purpose (do not weaken): `context/foundation/test-plan.md` §6.6 Phase 4, §6.7
- Eval baseline: `context/changes/ai-candidate-generation-test-3/verification.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fix the six order-dependent pairs

#### Automated

- [x] 1.1 Replay seed 101 green (220/220)
- [x] 1.2 Replay seed 202 green (220/220)
- [x] 1.3 Replay seed 303 green (220/220)
- [x] 1.4 Declaration-order `npm test` green (220/220)
- [x] 1.5 `npm run lint` exit 0

#### Manual

- [x] 1.6 Diff review — fixes only add owned fixtures, no assertion changed meaning

### Phase 2: Enable `sequence.shuffle` in both configs + verification matrix

#### Automated

- [ ] 2.1 `npm test` banner prints seed with no CLI flags
- [ ] 2.2 Seeds 101/202/303 replay green through config
- [ ] 2.3 Ten fresh unpinned runs green, seeds recorded
- [ ] 2.4 `npm run lint` and `npm run build` exit 0
- [ ] 2.5 Shuffled eval run — failure set equals de/fr baseline, seed in banner

#### Manual

- [ ] 2.6 Eval exit-1 accepted as baseline red; run table in verification.md

### Phase 3: Doc-sync

#### Automated

- [ ] 3.1 Replay line present in test-plan; lesson present in lessons.md
- [ ] 3.2 `npm test` green after doc edits (220/220)

#### Manual

- [ ] 3.3 Read-through of test-plan §6 + §8 and the lesson
