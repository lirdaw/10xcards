<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Typecheck Gate (C10X-43)

- **Plan**: `context/changes/typecheck-gate/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-02
- **Verdict**: REVISE
- **Findings**: 2 critical, 4 warnings, 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | FAIL    |
| Plan Completeness     | WARNING |

## Grounding

13/13 paths ✓, 14/14 symbols & line refs ✓, brief↔plan ✓.

Re-measured live against `main` @ `9fb37bb` during this review:

- `npx tsc --noEmit` → exit **0** (the plan asserts both candidate commands are green today and
  only shows `astro check`'s output; the `tsc` half is now confirmed).
- `npx astro check` → `Result (130 files): 0 errors / 0 warnings / 4 hints`, the four being
  `ts(6387)` on `tseslint.config` at `eslint.config.js:14,40,62,71` ✓.
- `npx tsc --noEmit --noUncheckedIndexedAccess` → **33 errors across 13 files**, per-file
  distribution identical to Phase 5's list ✓ (codes: 16× TS2532, 7× TS18048, 5× TS2322,
  4× TS2345, 1× TS2769).
- husky 9.1.7: `bin.js` `init` writes `prepare = 'husky'` ✓, `bin.js:24` deprecates `install` ✓,
  `index.js:11` returns a string when `.git` is absent ✓, `index.js` writes `.husky/_/.gitignore`
  with `*` ✓ — so the plan's correction of test-plan.md's "husky's installed half is gitignored"
  mechanism is right (`grep -n husky .gitignore` has no match).
- Doc-sync anchors all resolve: `eval.yml:217`, `flashcards.ts:30`, `candidates.test.ts:855`,
  `test-plan.md:642` and `:459`, `README.md:49` and `:167-180`, `AGENTS.md:9` and `:22`,
  `roadmap.md:349`, `package.json:5-21` (15 scripts, no `typecheck`) ✓.
- `## Progress` passes the mechanical contract in full: one heading at the bottom, six
  `### Phase N` subsections matching six `## Phase N` bodies, every Success Criteria bullet
  carrying an `N.M` entry, no checkboxes outside Progress.
- Windows spawn trap reproduced: `spawnSync('npx.cmd', […], { shell: false })` → `EINVAL`. The
  plan already names this class.

## Findings

### F1 — Phase 3's hygiene sweep is inverted: it normalises what this change never stages and skips everything it does

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 3 (Overview + §1) vs Phase 4 vs Phase 6 §2
- **Detail**: Phase 3's stated purpose is "so that Phase 4's first hook run discovers nothing."
  Measured, it does not achieve that. `lint-staged` runs `prettier --write` on _staged_ `*.md`.
  Phase 3 normalises `roadmap.md` (correctly — Phase 6 §3 stages it) plus `prd.md` and
  `lessons.md`, neither of which any phase of this change stages. Meanwhile every markdown file
  Phase 6 does stage is dirty and untreated. `prettier --check`, run during this review:
  - DIRTY, staged by Phase 6 §2: `2026-07-25-candidate-review/reviews/impl-review.md`,
    `2026-07-27-schema-drift-test/research.md`,
    `2026-07-05-per-user-data-isolation/reviews/plan-review.md`,
    `2026-07-31-forced-language-prompt-fix/verification.md`,
    `.../reviews/impl-review.md`, `.../follow-ups/typecheck-gate.md` (this change's own charter),
    `2026-08-02-eval-ci-dispatch/plan-brief.md`, `.../research.md`, `.../reviews/plan-review.md`.
  - DIRTY, staged from Phase 1 onward: `context/changes/typecheck-gate/{plan,plan-brief,research}.md`.
  - CLEAN, no action needed: `test-plan.md`, `README.md`, `AGENTS.md`, `package.json`, `tsconfig.json`.

  From Phase 4 onward the hook therefore reformats ~12 documents wholesale, including archived
  evidence, using the command `test-plan.md §8` records as destructive and non-idempotent on this
  repo's markdown. Two consequences: criterion 6.6 ("a correction LINE, not a rewrite — verify by
  diff shape") becomes unverifiable because the diff is the whole file; and the repo's rule that
  archived artifacts take dated corrections and are never rewritten is violated by a tool,
  unsupervised.

- **Fix A ⭐ Recommended**: Add a `.prettierignore` with `context/archive/**` (none exists today;
  Prettier 3 reads it alongside `.gitignore`), and drop `prd.md` / `lessons.md` from Phase 3.
  - Strength: Permanent and principled — makes "archived evidence is not rewritten" a property of
    the tooling rather than of a reviewer's attention, and closes the class for every future
    change. Also shrinks Phase 3, the phase the brief itself calls the silent-failure one.
  - Tradeoff: Changes `npm run format` semantics repo-wide, and leaves `context/changes/**` (this
    plan's own artifacts) still reformatted on first commit — decide whether to widen the ignore
    to `context/**` or accept it for working documents.
  - Confidence: HIGH — dirtiness measured on 12 files; Prettier 3's default ignore-path behaviour
    is documented.
  - Blind spot: Whether the team wants live change folders normalised is a preference this review
    has no evidence about.
- **Fix B**: Widen Phase 3 to normalise every markdown file this change stages (enumerate from
  Phase 6's own list) under the same write-twice-and-diff landmine review.
  - Strength: Keeps one convention ("all committed markdown is prettier-clean") and satisfies
    criterion 6.3 without a new ignore file.
  - Tradeoff: Puts ~12 documents including six archived ones through the known-destructive
    command, and the landmine review is manual — the phase whose failure mode is silent, made
    four times bigger.
  - Confidence: MEDIUM — the landmine class is real but its incidence across archive files is
    unmeasured.
  - Blind spot: A reformat commit touching six archive files is itself hard to review for
    content-neutrality.
- **Decision**: FIXED via Fix A — `.prettierignore` with `context/archive/**` added as Phase 3 §0; Phase 3 §1 retargeted to `roadmap.md` + the three change-folder artifacts (`prd.md` / `lessons.md` dropped); Phase 6 §2 gained the precondition; criteria 3.1-3.3 and 6.3 rewritten.

### F2 — `tsc` runs first and short-circuits, but `tsc` cannot run without `.astro/types.d.ts` — and only `astro check` syncs it

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details ("`tsc` runs first and short-circuits") + Phase 1 §2 + Phase 4
- **Detail**: Key Discoveries credits the gate with "it self-syncs" — true of `astro check` (its
  own log prints `[types] Generated 969ms` before `[check]`), false of `tsc`. `tsconfig.json:3`
  lists `.astro/types.d.ts` explicitly because `**/*` skips dotted directories. Measured with
  that entry removed, `tsc --noEmit` exits 2 with 13 errors — `TS2307 Cannot find module
'astro:env/server'` ×10, `astro:middleware` ×1, plus two `TS7006`. Because the wrapper reports
  and stops on a non-zero `tsc`, `astro check` never runs, so the leg that would have regenerated
  the file is exactly the one skipped. Reachable states: a fresh clone (`npm ci` does not sync), a
  branch switch that changed routes or content, any `.astro/` wipe — `AGENTS.md:9` already
  documents this as a standing footgun for `lint`. Phase 4 is where it costs most: `git push`
  blocked by 13 errors that name no file the developer touched and do not say "run astro sync",
  which is precisely the `--no-verify` pressure Phase 4's own rationale exists to remove.
- **Fix A ⭐ Recommended**: Run `astro sync` in the wrapper before `tsc`.
  - Strength: ~1 s (measured), restores the "self-syncs" property the plan already relies on,
    keeps the tsc-first short-circuit and its FM-2 coverage intact, and makes the local invocation
    match CI's `astro sync` → typecheck ordering by construction rather than by convention.
  - Tradeoff: The wrapper now writes to the working tree; a sync failure needs its own message so
    it does not read as a type error. Adds ~1 s to every CI run for a step CI already performed.
  - Confidence: HIGH — both the dependency and the sync cost measured in this session.
  - Blind spot: Whether `astro sync` inside the pre-push hook can race a concurrent `astro dev`
    writing `.astro/` is unverified.
- **Fix B**: Keep the leg order and make the wrapper recognise `TS2307` on an `astro:*` specifier,
  then exit with "run `npx astro sync` first".
  - Strength: No tree writes; matches the plan's own standard that a rejection message must name
    the cause a reader is in (the FM-1 message contract, Phase 1 §2).
  - Tradeoff: Still red, still blocks the push — it converts a confusing failure into a clear one
    rather than removing it, so the `--no-verify` pressure is only partly relieved.
  - Confidence: HIGH — the diagnostic shape is deterministic.
  - Blind spot: Other sync-dependent failure shapes (content collections) were not enumerated.
- **Decision**: FIXED via Fix A **and** Fix B — the wrapper now runs `astro sync` before `tsc` and appends a "run `npx astro sync`" line when the `tsc` leg fails with `TS2307` on an `astro:*` specifier. Critical Implementation Details, Key Discoveries, Phase 1 §2, Phase 2's sync-step paragraph, Falsification F (a pair), criteria 1.10/1.14/1.15 and Performance Considerations (~11 s → ~12 s) all updated.

### F3 — Criterion 3.4 ("reports 0 hints") cannot go red

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3, Success Criteria / Progress 3.4
- **Detail**: Phase 1 §2 pins `--minimumSeverity warning`. Measured, that flag does not merely
  hide the four hint lines — it removes the hints row from the Result block entirely:
  `Result (130 files): 0 errors / 0 warnings / 4 hints` becomes
  `Result (130 files): 0 errors / 0 warnings`. So `npm run typecheck` reports "0 hints" before
  Phase 3 does anything, and the criterion passes identically whether the `eslint.config`
  migration happened or not. Phase 3's own intent — "the log is empty because there is nothing to
  hide, not because it was hidden" — is exactly what this criterion cannot distinguish. The plan
  already measured the discriminator and then did not use it (Key Discoveries:
  `--minimumFailingSeverity hint` → 1 today).
- **Fix**: Verify with a checker invocation that can still see hints — bare `npx astro check`
  reporting `- 0 hints`, or `npx astro check --minimumFailingSeverity hint` exiting 0 (today it
  exits 1). Keep `--minimumSeverity warning` in the wrapper; it is the right default for the
  gate's own log.
- **Decision**: FIXED — the hint check moved to a hint-visible invocation (bare `astro check` reporting `- 0 hints`, and `--minimumFailingSeverity hint` exiting 0) paired against today's control; `npm run typecheck` demoted to its own exit-code criterion with the reason stated.

### F4 — Phase 3's eslint.config migration contradicts the file's own line-1 comment, and its neutrality oracle is weak

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 §2
- **Detail**: `eslint.config.js:1` reads
  `/* eslint-disable @typescript-eslint/no-deprecated -- tseslint.config() is the only way to use extends; core defineConfig has incompatible API */`
  — an explicit documented constraint against precisely the migration Phase 3 proposes, which the
  plan does not engage with. It may well be stale (`@eslint/config-helpers` is already a
  dependency and already imported at line 2 for `includeIgnoreFile`), but "stale" is a claim that
  needs measuring. The plan also does not say what becomes of the line-1 disable directive, which
  turns into an unused-directive warning once the deprecation is gone — the same "a comment must
  not be left contradicting the code it describes" rule the plan itself applies to
  `StudySession.tsx:170-172` in Phase 5. Separately, the stated neutrality check ("`npm run lint`
  still exits 0 and still reports the same findings on a deliberately broken file") only exercises
  the handful of rules that one file happens to trigger — thin evidence for rewriting the resolved
  config of a required gate that fans four configs across `.ts`, `.tsx`, `.astro` and `.js`.
- **Fix**: Make the oracle exact — `npx eslint --print-config <file>` before and after, diffed,
  for one file of each type (`src/lib/utils.ts`, a `.tsx`, a `.astro`, `eslint.config.js`); an
  empty diff is proof, a non-empty one names the divergence. And resolve the line-1 comment plus
  disable directive in the same edit, or record why the migration is impossible and drop
  Phase 3 §2 (F3's fix makes the hints visible either way).
- **Decision**: FIXED via Fix + escape hatch — Phase 3 §2 now settles the line-1 constraint before editing, carries the comment with the code, uses `eslint --print-config` diffed across four file kinds as the exact oracle (new criterion 3.5), and records a written escape hatch: if the config cannot be shown equivalent, measure it, drop the sub-phase and record `4 hints` as observed.

### F5 — Phase 2's CI criteria cannot be run as written from the change branch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2, criteria 2.2 / 2.3; Manual Testing step 4
- **Detail**: `ci.yml:3-9` triggers only on `push` to `main` and `pull_request` to `main`, with
  `paths-ignore: ["**/*.md", "context/**"]`. A push to the feature branch runs nothing at all.
  This is the same trap `test-plan.md §8` records against C10X-39: criteria 2.3 and 2.5 "were
  unmet at phase completion by decision, not by omission: `ci.yml` triggers only on push to `main`
  and on `pull_request` to `main`, so a feature-branch push runs nothing at all." Criterion 2.3
  also needs the scratch commit to touch a non-`.md`, non-`context/**` path or the workflow is
  skipped by `paths-ignore`.
- **Fix**: State in Phase 2 that both CI rehearsals require an open PR to `main`, and that the
  deliberate-error commit must touch a `.ts`/`.tsx`/`.astro` path. If the PR does not exist at
  Phase 2 time, mark 2.2/2.3 as ship-time items explicitly — the C10X-39 precedent — rather than
  leaving them to be discovered unrunnable.
- **Decision**: FIXED — Phase 2 gained a blockquote stating both rehearsals need an open PR to `main` and a `.ts`/`.tsx`/`.astro` scratch commit, with the C10X-39 ship-time precedent named; criteria 2.2/2.3 and Manual Testing step 4 reworded.

### F6 — Phase 5's counts do not reconcile, and one of the three behaviour-adjacent fixes is misdescribed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §2 heading and §3 contract
- **Detail**: The per-file list is right — re-measured, 33 errors across 13 files, matching the
  plan line for line. The aggregates around it do not, which is this repo's own recorded "a total
  and its breakdown are two claims" defect:
  - §2's heading says "30 sites, **12 files**" over a list of **11** files (13 total minus
    `generations.ts` and `judge.ts`).
  - `StudySession.tsx (5 — see below)` is counted in full in §2 and again in §3, so §2+§3 reads 34
    against a measured 33. Its five errors (lines 202, 209, 287, 293, 336) are one root cause —
    `card` possibly undefined — closed by one guard, so splitting them 4/1 across two
    sub-sections describes work that does not exist.
  - `judge.ts:166` is described as "a `?.` on a possibly-absent choice". Measured, line 166 is
    `await sleep(TRUNCATION_BACKOFFS_MS[attempt])` — `number | undefined` into `number`, guarded
    by `attempt < TRUNCATION_BACKOFFS_MS.length` on the line above. The possibly-absent choice is
    `judge.ts:235`, which already carries `choices?.[0]` and is not in the error set. `?.` cannot
    fix `:166`; the fix is a bounded-index narrowing, which also demotes it from "cannot be
    exercised without a provider run" to mechanical.
- **Fix**: Correct the file count to 11, remove the double count of StudySession's five (they are
  one guard), and restate the `judge.ts:166` fix as the backoff-array index it is.
- **Decision**: FIXED — §2 is now "27 diagnostics, 10 files" with a counts note reconciling 27/10 + 6/3 = 33/13; the StudySession double count removed; §3 restates `judge.ts:166` as the guarded backoff index it is (never `?.`), points at `:234-235` as the real `choices?.[0]` site, and drops the "needs a provider run" framing for a concrete risk (no 0 s hot retry).

### F7 — Three verification items that cannot fail, plus one mis-citation

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 6 (criterion 6.8, Desired End State), What We're NOT Doing
- **Detail**:
  - Criterion 6.8 — "`git diff --stat -- context/foundation/jira-map.md` is empty" — is
    permanently true: `.gitignore:70` ignores that file, so the diff is empty even if the file is
    rewritten.
  - Desired End State says "every one of the **11** live claims is corrected", while Phase 6's
    eleventh entry is "flag only, do not edit". It is 10 corrected, 1 flagged.
  - "Not adding typecheck to the `deploy` job … `ci.yml:119-121` states the principle" — those
    three lines are the **drift** job's "no `npm ci`, deliberately" comment about keeping that job
    at seconds; they say nothing about deploy's steps being artifact-production rather than gates.
    The conclusion is right, the pointer sends a reader to the wrong comment.
- **Fix**: Verify `jira-map.md` untouched with a content hash before/after instead of `git diff`;
  say "10 corrected, 1 flagged"; and either drop the `ci.yml:119-121` citation or repoint it at
  the deploy job's own steps (`ci.yml:138-140`).
- **Decision**: FIXED — 6.8 now uses `md5sum` before/after with the gitignore reason stated; Desired End State reads "10 corrected, 1 flagged"; the `ci.yml:119-121` citation repointed to `:138-140` with the old pointer's error recorded.
