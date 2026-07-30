# Order-Independent Test Suite + `sequence.shuffle` — Plan Brief

> Full plan: `context/changes/flashcards-test-order/plan.md`
> Research: `context/changes/flashcards-test-order/research.md`

## What & Why

Six test-case pairs across three files pass only by declaration order: a positive control mutates the shared `beforeAll` fixture that denial cases assert file-scope constants against. Under `npx vitest run --sequence.shuffle` the suite exits 1 (verified with seeds 101/202/303). This change fixes all six pairs with the established F1 pattern (the mutator gets its own fixture) and permanently enables `sequence.shuffle` in both Vitest configs, so the class fails loudly in CI instead of hiding. Deferred finding F6 from C10X-26 was the tip; the research swept the whole suite (ticket C10X-32).

## Starting Point

Research (2026-07-29, same commit as HEAD) delivered the complete inventory: 6 order-dependent pairs sharing 4 mutation sites in `tests/isolation/flashcards.test.ts`, `tests/review/candidates.test.ts`, `tests/study/study.test.ts`; the other 15 files verified order-safe per-`it()`. Neither config carries a `sequence` key; the fix pattern already exists in-repo (`generate.test.ts` "Control deck", `decks.test.ts` `doomedId`).

## Desired End State

All 220 tests green under any shuffle permutation; both configs shuffle permanently with an un-pinned seed (CI accumulates permutations; the banner seed makes any red replayable); the eval path's failure set unchanged from its known baseline; the rule and replay procedure recorded in test-plan and lessons.md.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| -------- | ------ | ---------------- | ------ |
| Fix scope | All 6 pairs, incl. 2 latent | Ticket says sweep the whole suite; three seeds provably under-count | Research |
| Fix pattern | F1 — mutator/aggregate owns its fixture | Proven in-repo, no assertion changes meaning | Research |
| Config shape | `sequence: { shuffle: true }` (files + tests) | Matches the verified repro exactly; replay needs only `--sequence.seed=<n>` | Plan |
| Seed | Un-pinned (default `Date.now()`) | CI accumulates permutation coverage per run | Research |
| Eval config | Shuffle enabled there too | One consistent policy for both runners (user widened scope) | Plan |
| Eval oracle | Failure-set equality, not exit code | `npm run eval` exits 1 today on a real, unrelated generation defect | Plan |
| Verification depth | 3 known seeds + 10 fresh runs | Seeds prove the exact fixes; fresh runs probe new permutations incl. the latent pairs | Plan |
| Doc-sync | test-plan §6 + §8 + lessons.md | Replay runbook for the first CI red; class-level lesson closes the pattern | Plan |

## Scope

**In scope:** 4 test-file edits (owned fixtures), 2 config edits, test-plan + lessons.md + change epilogue.

**Out of scope:** production code; the 15 order-safe files; the eval's forced-language defect (separate C10X-31 follow-up); the cross-file suffix-collision latent trap; re-running §6.6 breakage checks.

## Architecture / Approach

Fix first, enable second — the config flip lands only after seeds 101/202/303 replay green, so enabling shuffle never lands red. All fixes are local to an `it()` (shuffle never touches hooks). The canary fix inverts the pattern: the *aggregate* gets an owned schedule row (via `loadSession`), while its account-wide scan — the canary's documented point — stays intact.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Fix six pairs | 4 edits, 3 files; known seeds replay green | Accidentally weakening a denial assertion instead of adding a fixture |
| 2. Enable shuffle + verify | Both configs shuffled; 3 seeds + 10 fresh runs + 1 eval run | A fresh seed surfaces a 7th, unlisted pair (that's signal, not failure) |
| 3. Doc-sync | Replay runbook, order-safety rule, lesson, evidence file | Doc drift with §6.6's existing claims |

**Prerequisites:** local Supabase stack up (`npm run db:start`), `OPENROUTER_API_KEY` unset for `npm test`, set in SHELL only for the one eval run.
**Estimated effort:** ~1 session; Phase 2's verification matrix (~14 full suite runs) dominates wall-clock.

## Open Risks & Assumptions

- A fresh unpinned seed may surface an order dependence the static sweep missed — treated as a finding to fix in-change, not a blocker.
- Line numbers in the plan reference commit `ea77584`; re-derive if anything lands on these files first.
- One eval run costs ~$0.012 and requires the shell-env key; its exit 1 is the known baseline, not a regression.

## Success Criteria (Summary)

- `npm test` green (220/220) with shuffle permanently on — across 3 known-red seeds and 10 fresh permutations.
- A future red shuffled CI run is replayable from the banner seed via a documented one-liner.
- No assertion lost meaning: denials, preconditions, and the canary's account-wide scan are byte-identical.
