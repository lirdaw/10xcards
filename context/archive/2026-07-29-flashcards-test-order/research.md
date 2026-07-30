---
date: 2026-07-29T21:35:00+02:00
researcher: Claude (Fable 5)
git_commit: ea7758441273394c344b4a72353417b01eee3b2a
branch: main
repository: My10xCards_v2
topic: "Order-dependence across the test suite — what blocks enabling vitest sequence.shuffle (C10X-32)"
tags: [research, codebase, tests, vitest, sequence-shuffle, order-dependence, flashcards-test-order]
status: complete
last_updated: 2026-07-29
last_updated_by: Claude (Fable 5)
---

# Research: Order-dependence across the test suite — what blocks enabling `sequence.shuffle` (C10X-32)

**Date**: 2026-07-29T21:35:00+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: ea7758441273394c344b4a72353417b01eee3b2a
**Branch**: main
**Repository**: My10xCards_v2

## Research Question

Deferred finding F6 from the C10X-26 impl-review: `tests/isolation/flashcards.test.ts:193` passes only by declaration order — under `npx vitest run --sequence.shuffle` it fails. The ticket's scope is explicitly wider than that one line: sweep the WHOLE suite (18 files, 220 tests) for the same order-dependence class, because only the first shuffled failure was ever investigated. Acceptance: shuffled runs green, `sequence.shuffle` enabled in `vitest.config.ts` so this class fails loudly in CI.

## Summary

**Six order-dependent case-pairs exist, across three files — four confirmed by execution, two latent (visible only to static analysis).** F6 was the tip; the same class lives in a second describe of the same file, in `tests/review/candidates.test.ts`, and (latently) in `tests/study/study.test.ts`. The other 15 files are order-safe, verified by per-`it()` enumeration.

Ground truth from execution: three full-suite runs with `--sequence.shuffle --sequence.seed={101,202,303}` (local stack up, 2026-07-29). **All three exit 1**: `flashcards.test.ts` fails 2–3 cases per seed (in BOTH its describes), `candidates.test.ts` fails 1 case in every seed. Logs preserved for the implementation phase in the session job dir (`tmp/shuffle-{101,202,303}.log`); the failures reproduce deterministically per seed.

Every finding has the same shape, and it is the same shape as F1 (fixed in C10X-26): **a positive control that mutates the shared `beforeAll` fixture which the denial cases assert constants against** — or, in the study canary's case, an account-wide aggregate that assumes its siblings already ran. Every fix is the F1 pattern: the mutating/aggregating case gets its own fixture; no assertion changes meaning.

Vitest 4 semantics (docs, verified against the observed runs): `sequence.shuffle` accepts a boolean (shuffles files AND tests) or `{ files, tests }` separately; seed defaults to `Date.now()`, is printed in the run banner (`Running tests with seed "101"` — observed), and is reproducible via `--sequence.seed`; `beforeAll`/`beforeEach` still run before the tests in their scope; a suite can opt out locally with `describe("…", { shuffle: false }, …)`.

## Detailed Findings

### The complete order-dependence inventory (what must be fixed)

| # | File | Mutator (case, lines) | Broken case (assertion line) | Proof | Mechanism |
|---|------|----------------------|------------------------------|-------|-----------|
| 1 | `tests/isolation/flashcards.test.ts` | `still lets A edit A's own card` — edits the shared card to `A's edited front ${suffix}` (`:204-212`) | `refuses B's card creation in A's deck…` — `cards[0].front === A_FRONT` (`:145`) | **seeds 101, 202, 303** | Denials assert the shared `beforeAll` card's pre-edit content captured as a file-scope constant (`:25`) |
| 2 | same | same mutator | `refuses B's edit of A's card…` — `cards[0].front === A_FRONT` (`:160`) | **latent** — no seed fired it; same mechanism as #1/#3 | (`:161` `back === A_BACK` survives — the edit resubmits `A_BACK`) |
| 3 | same | same mutator | `refuses B's own deck paired with A's card id…` — `cards[0].front === A_FRONT` (`:194`) | **seed 202**; = the original F6 repro | The ticket's named line |
| 4 | same (describe 2) | `still lets A transition A's own card` — `setState(…, "rejected")` (`:310-315`) | `refuses B's transition on A's card…` — precondition `expect(before.state_id).toBe(STATE_ACCEPTED)` (`:278`) | **seeds 101, 202, 303** | The denial's "the transition B attempts is a LEGAL one" precondition reads the shared card the positive control already moved to `rejected`. The `toEqual(before)` at `:286` itself is safe (re-read inside the `it`) — it is the hard-coded state precondition that breaks |
| 5 | `tests/review/candidates.test.ts` | `still lets A rewrite A's own audit columns` — updates `error_message` to `Audit repaired ${suffix}`, never restored (`:741-745`) | `returns none of the four private columns to B, while A reads every one of them` — `expect(owner.error_message).toBe(upstreamMessage)` (`:697`) | **seeds 101, 202, 303** — observed string: `expected 'Audit repaired ms6h9cep' to be 'Audit upstream failure ms6h9cep'` | The audit describe shares ONE session seeded in `beforeAll` (`:649-665`) across four `it()`s; the rewrite is persisted. The overwrite/delete denials (`:700-722`, `:723-735`) are safe — their `before` snapshots are re-read inside each `it` |
| 6 | `tests/study/study.test.ts` | (no mutator — an aggregate with no fixture of its own) | `never writes srs_state 3 — the canary for a flipped enable_short_term` — positive control `expect(data?.length ?? 0).toBeGreaterThan(0)` (`:878`) over an account-wide `flashcard_schedule` scan (`:875`) | **latent** — statically found; not fired by the three seeds | The canary owns no fixture; its `length > 0` control holds only because in declaration order every rating/session case has already seeded schedule rows. Shuffled first, account A has zero rows from this file. Worse: another file's parallel worker (e.g. `candidates.test.ts`'s study-gate case) can race rows in, turning a deterministic red into a **flake** — and the main assertion (`:879 not.toContain(State.Relearning)`) is vacuously green on empty, which is exactly what the positive control exists to prevent |

### Files verified order-SAFE (15)

Verdicts from exhaustive per-`it()` enumeration by two parallel audit agents; "safe" below means every case was checked, not that nothing was found by silence.

| File | Verdict | Why it holds under shuffle |
|------|---------|---------------------------|
| `tests/harness.test.ts` | SAFE | pure, no shared state |
| `tests/isolation/decks.test.ts` | SAFE | the delete positive control already uses its own fixture (`doomedId`, `:106`) — the F1 pattern applied avant la lettre; no case renames/deletes the shared decks |
| `tests/isolation/positive-control.test.ts` | SAFE | the rename case asserts only its own write; the other case reads `user_id`, which rename doesn't touch |
| `tests/study/schedule.test.ts` | SAFE | pure; per-case literals |
| `tests/study/study.test.ts` (rest of file) | SAFE | **every rating case creates its own deck and card(s)**, so the optimistic-lock `expectedReps` hazard never materializes — no two cases rate the same card |
| `tests/generation/generate.test.ts` | SAFE | **F1 fix verified to hold today**: the dedup case is the only one generating into the shared deck; different-keys/no-key/failed-key/positive-control each own a deck (`:296`, `:314`, `:338`, `:374`); the C10X-31 audit-columns case owns "Audit deck" (`:769`); session counts are per-case-marker `.like()` scoped, never per-deck |
| `tests/generation/failure-path.test.ts` | SAFE | fetch double installed in file-level `beforeAll` (`:129-131`), restored in `afterAll` (`:133-144`); `upstream` is set as each `it`'s first statement and reset in `afterEach` (`:150-152`); `captured` reset in `beforeEach` (`:146-148`) — no cross-`it` double state |
| `tests/review/candidates.test.ts` (rest of file) | SAFE | review-round-trip cases assert only `Location` with identical rewrites; IDS_MAX/boundary cases own their decks (`:336-337`, `:366-367`); `updated_at` stamp case owns its card (`:783-786`) |
| `tests/validation/cards.test.ts` | SAFE | two cases DO add rows to the shared deck, but **every count takes its `before` snapshot inside the same `it()`** (`:182`, `:200`, `:217`, `:237`, `:263`, `:276`, `:294`, `:315`), so accumulation cancels out under any order; the at-limits edit uses its own target (`:368`) |
| `tests/auth/errors.test.ts` | SAFE | mapper cases pure; endpoint cases build their own form per `it()`, accounts read-only |
| `tests/middleware.test.ts` | SAFE | fabricated context per call; `nextCalled` local |
| `tests/lib/*.test.ts` (6 files) | SAFE | pure; factories return fresh objects; `no-logging`'s `const files` is read-only FS state; its regex has no `g` flag (no `lastIndex` statefulness); `schema-drift`'s `REAL_*` consts are always spread, never mutated |

### Empirical shuffled runs (ground truth, 2026-07-29)

Command: `npx vitest run --sequence.shuffle --sequence.seed=<seed>` from repo root, local stack up, `OPENROUTER_API_KEY` unset. Vitest prints `Running tests with seed "<seed>"`, so every result below is replayable.

| Seed | Result | Failing cases |
|------|--------|---------------|
| 101 | exit 1 — 3 failed / 217 passed | flashcards #1, #4; candidates #5 |
| 202 | exit 1 — 4 failed / 216 passed | flashcards #1, #3 (=F6), #4; candidates #5 |
| 303 | exit 1 — 3 failed / 217 passed | flashcards #1, #4; candidates #5 |

Reading: pairs #1, #4, #5 fire on effectively any reorder (3/3 seeds); #3 (the ticket's named line) needs a specific permutation (1/3); #2 and #6 never fired in three runs — which is precisely why the static sweep was necessary and why "run shuffle a few times until green" would under-count the fix list.

### Vitest 4 `sequence.shuffle` semantics (docs: /vitest-dev/vitest, checked 2026-07-29)

- **Config**: `test.sequence.shuffle` — boolean (shuffles files AND tests) or `{ files?: boolean, tests?: boolean }`. CLI: `--sequence.shuffle`, `--sequence.shuffle.files`, `--sequence.shuffle.tests`.
- **Seed**: `sequence.seed`, default `Date.now()` — so an un-pinned config produces a different order per run (good: CI accumulates coverage of permutations over time). The seed is printed in the run banner and replayable via `--sequence.seed=<n>`; no effect when shuffle is off.
- **Scope of the shuffle**: tests are shuffled within each suite and suites within the file; `shuffle` set on a `describe` is inherited by nested suites; `describe("…", { shuffle: false }, …)` opts a suite out locally. **Hooks are unaffected**: `beforeAll`/`beforeEach` still run before the tests in their scope, so fixture setup keeps working — only inter-`it()` dependencies break.
- **`shuffle.files` caveat**: file order is randomized too, and the docs note this disables the "long-running tests start earlier" scheduling optimization. Files already run in parallel workers (`fileParallelism` default true), so cross-file DB interference is a live concern with or without shuffle — file shuffle mostly costs scheduling efficiency and buys little extra signal. A `tests: true, files: false` config is the option that keeps the optimization; a plain `true` matches what the F6 repro and this research actually ran. Decision for the plan.

## Code References

- `tests/isolation/flashcards.test.ts:25` — file-scope `A_FRONT` constant the denials assert
- `tests/isolation/flashcards.test.ts:145,160,194` — the three assertions broken by the edit positive control
- `tests/isolation/flashcards.test.ts:204-212` — the mutating edit (positive control, describe 1)
- `tests/isolation/flashcards.test.ts:278` — `STATE_ACCEPTED` precondition broken by the transition positive control
- `tests/isolation/flashcards.test.ts:310-315` — the mutating transition (positive control, describe 2)
- `tests/review/candidates.test.ts:649-665` — shared audit session seeded in `beforeAll`
- `tests/review/candidates.test.ts:697` — seed-value equality broken by the rewrite
- `tests/review/candidates.test.ts:741-745` — the mutating rewrite (positive control), never restored
- `tests/study/study.test.ts:871-879` — the srs_state-3 canary: account-wide scan (`:875`), fixture-less positive control (`:878`), vacuously-green main assertion on empty (`:879`)
- `vitest.config.ts:22-36` — current `test` block; no `sequence` key today; `globalSetup` order (preflight → accounts) is unaffected by shuffle
- `tests/fixtures/accounts.ts:71-74` — per-run accounts; within-run sharing is what makes the class possible
- `tests/generation/generate.test.ts:371-374` — the F1 fix ("Control deck") — the precedent every fix here copies

## Architecture Insights

1. **The class has ONE shape here: positive controls are the mutators.** All five mutation-pair findings (#1–#5) are a positive control mutating the shared `beforeAll` fixture that the denial cases assert constants against. That is not a coincidence: this suite's discipline pairs every denial with a positive control (test-plan §6.2), and a control written against the shared fixture is the cheap way to write it. `decks.test.ts` shows the correct form (own `doomedId`), `generate.test.ts` shows the F1-fixed form ("Control deck") — the fix is to bring the three offending controls (and the canary) up to the standard the rest of the suite already follows.
2. **`before` snapshots re-read inside the `it()` are structurally order-safe** — this is why `validation/cards.test.ts` survives shuffle despite genuinely sharing a deck that cases write into, and why the overwrite/delete audit denials in `candidates.test.ts` are fine while the read case (`:697`, asserting the seed constant) is not. The distinction "assert what you re-read vs assert a file-scope constant" is the load-bearing one for any future test.
3. **Shuffle does not touch hooks or files' internal parallelism**, so no `beforeAll` needs restructuring — every fix is local to an `it()`.
4. **A latent cross-file trap, out of scope but worth recording**: each file's `const suffix = Date.now().toString(36)` is minted at module load; two files loaded in the same millisecond by parallel workers share a suffix. Harmless today only because every name carries a distinct per-file prefix. Not a shuffle issue.
5. **The canary (#6) is the only finding where the fix is not "own fixture for the mutator"** but "own fixture for the aggregate": seed one deck + card + `loadSession` inside the canary's `it()` so `length > 0` is guaranteed by a row the case owns, while keeping the scan account-wide (that breadth is the canary's point — §6.6 documents it as the guard for a flipped `enable_short_term`).

## Historical Context (from prior changes)

- `context/archive/2026-07-18-ai-candidate-generation-test/reviews/impl-review.md` — F1 (fixed: the "Control deck" pattern; verified green under 3 consecutive shuffled runs of that file) and F6 (deferred; this change). F6's blind-spot note — "whether other suites hide the same class behind declaration order" — is answered here: yes, two more files.
- `context/foundation/test-plan.md` §6.5 — the within-a-run threat model (all cases share account A) and the file-level suffix rule; §6.2 — the positive-control discipline that, ironically, produced all five mutation pairs; §6.6 Phase 4 — the canary's purpose (do not weaken its assertion; give it a fixture).
- `context/foundation/lessons.md` — "Preflight musi domknąć KAŻDY nielokalny szew" (why the shuffled runs required the stack up and the key unset); no existing lesson covers order-dependence — a candidate `/10x-lesson` after implementation: "positive control must own its fixture".

## Related Research

- `context/archive/2026-07-26-srs-study-session-test/research.md` — the audit methodology this sweep mirrors (static enumeration + execution as corroboration).

## Open Questions

1. **Config shape**: `sequence: { shuffle: true }` (files + tests, matches the repro command) vs `{ shuffle: { tests: true } }` (keeps the long-running-first scheduling optimization; file order is already effectively nondeterministic via parallel workers). Either satisfies the ticket; plan should pick one and say why. Seed should stay un-pinned (default `Date.now()`) so CI accumulates permutations — the banner prints the seed for replay.
2. **`vitest.eval.config.ts`** (the `npm run eval` path, C10X-31): out of the ticket's scope and its 10 cases are independent by construction; enabling shuffle there is a cheap follow-up, not part of this change. The two configs are deliberately separate files — touching only `vitest.config.ts` keeps the byte-identical-preflight invariant untouched.
3. **CI seed reporting**: on a red shuffled CI run, the seed is in the log banner. Worth one line in test-plan §6 (how to replay: `npx vitest run --sequence.shuffle --sequence.seed=<n>`) so the first person to hit a shuffle-red doesn't rediscover it.
4. **Verification denominators**: several §6.6 deliberate-breakage splits carry declaration-order assumptions in their "N of M" counts only in the sense that M is dated — shuffle does not change the counts, but the first shuffled re-run of any breakage check should re-derive its denominator (existing §6.6 discipline, unchanged).
