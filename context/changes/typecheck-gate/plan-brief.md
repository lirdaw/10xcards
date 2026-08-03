# Typecheck Gate (C10X-43) — Plan Brief

> Full plan: `context/changes/typecheck-gate/plan.md`
> Research: `context/changes/typecheck-gate/research.md`

## What & Why

Add a type gate — npm script, CI step, `pre-push` hook — so a TypeScript error can no longer
hide behind a fully green `lint` + `build` + `test`. This is not hypothetical: reverting to
`b015662` makes `tsc --noEmit` exit 2 on a `TS2353` in `evals/generation-quality.eval.ts`, so
Risk #7's only acceptance instrument sat uncompilable for two fully green phases. None of the
three existing gates performs TypeScript diagnostics — `lint` is ESLint with type-*aware rules*,
`astro build` does not type-check, and `npm test` never collects `evals/**`.

## Starting Point

`package.json` has 15 scripts and no `typecheck`. `ci.yml` runs `npm ci` → `astro sync` →
`lint` → `build`. Both candidate commands are **green today** — `astro check` exits 0 at
`Result (130 files): 0 errors`, re-verified for this plan — including over `scripts/`, so the
charter's fear of "a gate that must be weakened on day one" does not materialise. The local half
does not exist at all: husky is tracked but was never installed here (no `prepare` script, no
`.husky/_`, `core.hooksPath` unset), which means AGENTS.md's claim that commits auto-fix is
currently false.

## Desired End State

`npm run typecheck` runs both checkers and refuses to report success on a run that checked
nothing. CI runs it fail-closed before `lint`. A `pre-push` hook runs it locally.
`noUncheckedIndexedAccess` is on with a zero-error tree. The 11 live documentation claims that
this project has no type gate are corrected — including the one that ships as executable output
in a job log.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Which checker | `astro check`, not `tsc` | Genuine superset at identical strictness: 130 files = tsc's 112 + the 18 `.astro` this project keeps loaders and `?error=` reads in. | Research |
| FM-1 (missing tooling exits 0) | Node wrapper in `scripts/` asserting the `Result (N files):` line | Works identically on Windows and Linux, and its pure half is testable exactly like `scripts/schema-drift.ts`. | Plan |
| FM-2 (malformed tsconfig invisible) | Run `tsc --noEmit` too | The redundancy is not total — `tsc` reports `TS5xxx`, `astro check` reports zero; 2.7 s buys the class back. | Plan |
| Placement | Between `astro sync` and `lint`, fail-closed | Cheaper than lint, before `build`, far before the ~1m46s stack start; the drift-gate side of `ci.yml:54-64`'s asymmetry. | Research |
| Local hook | `pre-push` | 8–11 s per *commit* is a standing incentive to reach for `--no-verify`, which two rule files forbid absolutely. | Plan |
| `noUncheckedIndexedAccess` | **In this change**, after the gate is green | Research recommended a separate ticket; the user chose to include it, so the flag and its 33 fixes land in one commit — the lint config makes any intermediate state red. | Plan |
| Tidy-ups | `exclude: ["context"]`, `--minimumSeverity warning`, `.prettierignore` for `context/archive/**`, fix the 4 `ts(6387)` hints | Closes a local-vs-CI scope asymmetry, keeps the hook off archived evidence, and makes a green log genuinely empty rather than four lines a reader learns to skim. | Plan + review |
| `eval.yml` | Correct the parenthetical, add no step | `eval.yml:10-15` defends across four documents that a red there is a *finding*; a typecheck red is a hygiene failure. | Research |

## Scope

**In scope:** the `typecheck` script and its wrapper; the CI step; the husky repair and
`pre-push` hook; prettier normalisation of three dirty foundation docs; the `ts(6387)` fix;
`noUncheckedIndexedAccess` plus its 33-site sweep; doc-sync across 11 live and 17 historical
locations plus a new roadmap row.

**Out of scope:** a typecheck step in `eval.yml`; typecheck in the `deploy` job; any change to
the eval's isolation from `npm test`; editing `jira-map.md` (skill-owned — flagged only);
flipping any roadmap `Status`; making `flashcards.ts`'s two optional fields required.

## Architecture / Approach

`npm run typecheck` → `scripts/run-typecheck.ts` → runs `astro sync` (~1 s; `tsc` hard-depends on
`.astro/types.d.ts` — 13 errors without it, measured — and only `astro check` self-syncs, so the
tsc-first short-circuit would otherwise skip the leg that fixes it), then `tsc --noEmit` (cheap;
owns the `TS5xxx` config class) and, only if that is clean, `astro check` (owns the 18 `.astro`
files).
The wrapper captures `astro check`'s output and applies a pure verdict from `scripts/typecheck.ts`:
no `Result (N files):` line, or N below a floor, means the run checked nothing and is a failure
regardless of exit code. The floor is deliberately not an equality — a pinned `130` becomes a
stale count, and this repo has recorded counts going stale four times.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. The gate, locally | Wrapper, script, `exclude`, unit test, five falsification runs | A probe left behind, or an FM-1 guard that cannot itself go red |
| 2. The CI step | Fail-closed step before `lint` | Proving the red path needs a real scratch push |
| 3. Doc hygiene | `.prettierignore` for `context/archive/**`, four staged docs normalised, 4 hints removed | `prettier --write` was already destructive and non-idempotent on this repo's markdown once |
| 4. The local hook | `prepare: husky` + `.husky/pre-push` | Enabling husky also activates the tracked `pre-commit` — hence Phase 3 first |
| 5. nUIA | Flag + 33 fixes in one commit | Three of the 33 change control flow, not just types |
| 6. Doc-sync | 11 live edits, 17 dated corrections, roadmap H-11 | Rewriting a dated entry instead of appending a correction line |

**Prerequisites:** none beyond a clean tree — the gate needs no `.env`, no database, no Docker
and no network (all measured).
**Estimated effort:** ~3–4 sessions across 6 phases; Phase 5 and Phase 6 are the two long ones.

## Open Risks & Assumptions

- **Phase 3 is the phase whose failure mode is silent.** Prettier's landmine was disarmed for
  `test-plan.md` only; the other documents are unexplored, so idempotency must be checked by
  writing twice and diffing, not assumed. Phase 3 also puts `context/archive/**` in a new
  `.prettierignore`: measured, all nine archive files Phase 6 edits are prettier-dirty, so once
  the hook is live `lint-staged` would reformat archived evidence wholesale in the same commit as
  a one-line dated correction.
- **nUIA's behaviour-adjacent fixes** (`StudySession.tsx` ×5, `generations.ts:82`,
  `judge.ts:166`) are the only places this change can introduce a real defect. `StudySession`'s
  five are one root cause behind one guard; `judge.ts:166` is a bounded backoff index, so the only
  care needed is that its default cannot turn a 3 s/10 s backoff into a 0 s hot retry.
- **A `typescript-eslint` major can turn the gate red with no source change** — `allowJs` plus
  `include: ["**/*"]` puts `eslint.config.js` and `astro.config.mjs` in the checked set. A true
  positive, but budget for it.
- **No test in the suite runs the gate itself.** `npm test` covers the pure verdict function and
  nothing more; the wiring is carried by recorded runs, exactly as C10X-29's drift runner is.
- Research recorded nUIA as touching 14 files; re-measured for this plan it is **13** (33
  diagnostics, distribution otherwise identical) — split 27/10 type-level and 6/3
  behaviour-adjacent, with no file counted twice.
- **Phase 2's two CI rehearsals need an open PR to `main`** and a `.ts`/`.tsx`/`.astro` scratch
  commit: `ci.yml` triggers only on push to `main` and PR to `main`, with
  `paths-ignore: ["**/*.md", "context/**"]`, so a feature-branch push runs nothing. Same trap
  test-plan.md §8 records against C10X-39; ship-time if no PR exists yet.

## Success Criteria (Summary)

- A type error anywhere in `src/`, `tests/`, `evals/`, `scripts/` or an `.astro` file fails CI in
  seconds, and fails a `git push` locally.
- The gate goes red for the historical C10X-41 defect it is named after — proved, not argued.
- The gate cannot report success on a run that checked nothing, and a green `ci` job does imply
  this step passed.
