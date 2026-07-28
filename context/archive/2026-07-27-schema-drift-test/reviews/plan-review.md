<!-- PLAN-REVIEW-REPORT -->
# Plan Review: CI Gate for Database Schema Drift

- **Plan**: `context/changes/schema-drift-test/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-27
- **Verdict**: REVISE (all 8 findings fixed in-plan on 2026-07-27 — post-triage: SOUND)
- **Findings**: 1 critical, 5 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

13/13 existing paths ✓ (4 new paths correctly absent), 11/11 symbols & line refs ✓,
brief↔plan ✓, Progress↔Phase 6/6 phases and 32/32 criteria ✓.

Verified directly: `ci.yml:26-27/:35-37/:49/:50`; `.claude/skills/ship/SKILL.md:39-44`
(PROD tier incl. `supabase db push`), `:61-64` (git-diff pending-migration heuristic),
`:86-91` (ordering rule) and the FEATURE-BRANCH runbook confirming `db push` runs *after*
`gh pr create` and *before* `gh pr merge`; `lessons.md:110-115` (the `repair` desync);
`infrastructure.md:154-156` (Worker rollback does not roll back schema);
`astro.config.mjs:17-23` (all four env fields `optional: true`); `.gitattributes`
(`* text=auto eol=lf`); `package.json` `db:types`; `tests/lib/no-logging.test.ts` walks the
whole `src/` tree textually; `astro/tsconfigs/base.json` sets `allowImportingTsExtensions`,
`verbatimModuleSyntax`, `noEmit`, and `tsconfig.json` includes `**/*`; `eslint.config.js`
uses `projectService: true` so a new `scripts/*.ts` is type-checked with no config change.
The out-of-order migration pair exists (`20260712162349_generation_session` authored at
16:37:28, `20260712162359_deck_keyword_search` at 16:29:09 — later version, earlier commit),
so the set-based comparison is required as the plan states. No `docs/reference/contract-surfaces.md`
in this repo, so that check was skipped.

## Findings

### F1 — Nothing ever observes `deploy` being blocked

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Success Criteria (3.5–3.7)
- **Detail**: The one claim this change exists to make is "a drifted repo does not deploy",
  and every verification step stops short of it. 3.5 proves the *script* exits 1 locally;
  3.6 proves its error paths locally; 3.7 proves the *green* path in CI ("`drift` green and
  `deploy` running as before"). No step anywhere observes a red `drift` and a skipped
  `deploy`. That matters because `needs: [ci, drift]` plus a job-level `if` is exactly the
  combination that misbehaves quietly — a stray `always()` / `!cancelled()` (which the plan
  itself warns against twice) flips "skipped on failure" into "runs anyway", and the green
  path looks identical either way. The plan applies the repo's deliberate-breakage discipline
  to the comparator (2.4), the types gate (4.4) and the nightly job (5.4) — and not to the
  guard itself. It is also structurally hard to check as written: the `drift` job's `if` is
  scoped to `push` on `main`, so the CI wiring gets its first real execution after the merge,
  when the only observable outcome is the green one.
- **Fix A ⭐ Recommended**: Rehearse the red path on the feature branch — in Phase 3,
  temporarily widen the `drift` job's `if` to include the feature ref, add a fabricated
  migration filename, push, and record that `drift` is red AND `deploy` shows *skipped*; then
  revert both edits and confirm the graph via `gh workflow view CI`.
  - Strength: This is §6.6's "neuter the guard, confirm red" applied to the guard, in the same
    shape as 2.4/4.4/5.4; the fabricated-migration fixture already exists in 3.5.
  - Tradeoff: Two throwaway commits on the branch, and the widened `if` must be reverted before
    merge (make the revert its own checked item).
  - Confidence: HIGH — it only moves an existing fixture from local to CI.
  - Blind spot: Does not exercise the real `push`-to-`main` trigger.
- **Fix B**: Prove it on `main` with a two-push sequence after merge.
  - Strength: Exercises the genuine trigger and job graph.
  - Tradeoff: Deliberately reds `main` and withholds a real deploy; PROD-tier by /ship's tiering.
  - Confidence: MEDIUM — recovery depends on F2's undocumented rerun path.
  - Blind spot: If it misfires, the repo is left un-deployed.
- **Decision**: FIXED via Fix A — Phase 3 gained two manual criteria (3.7 red-path rehearsal
  with the `if` widened to the feature ref; 3.8 the revert as its own check), Progress
  renumbered to 3.5–3.10.

### F2 — Fail-closed couples every deploy to Supabase API uptime, with no bypass and no documented recovery

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: "Critical Implementation Details" — Fail closed; Phase 3
- **Detail**: "Every non-success path exits 1" collapses two different things into one
  outcome: *the schema is drifted* and *the gate could not find out*. A Management API
  incident, a rotated/expired PAT, a 5xx or a body-shape change now blocks the Cloudflare
  deploy of an unrelated hotfix — and `deploy` cannot be started on its own, because a job
  whose `needs` failed cannot be run. The only escape is a commit editing `ci.yml` on `main`.
  The plan also never states the ordinary recovery: run `db push`, then
  `gh run rerun --failed` (which re-runs `drift` and then the dependent `deploy`). Phase 6
  already opens both documents where that belongs (`ship/SKILL.md`, `README.md`) and neither
  contract mentions it. Fail-closed is the right default; the gap is that its cost is unpriced
  and its exit undocumented.
- **Fix A ⭐ Recommended**: Distinguish the two failure kinds and document the recovery in the
  phase already open — make "could not answer" a distinct named message in the runner (Phase 3
  §1 already requires a message per failure mode), and add the `db push` →
  `gh run rerun --failed` recovery plus the one-commit outage bypass to Phase 6's
  `ship/SKILL.md` and `README.md` contracts.
  - Strength: Zero new mechanism; both files are already in Phase 6's scope.
  - Tradeoff: Still blocks on an outage — buys diagnosability and a known exit, not availability.
  - Confidence: HIGH.
  - Blind spot: Retry/backoff count for 5xx (vs the single 429 retry) is still unspecified.
- **Fix B**: Add an auditable manual override (`workflow_dispatch` input, e.g. `skip_drift`).
  - Strength: The override lands in the run log instead of in a commit that edits the gate.
  - Tradeoff: Ships a documented way to defeat the gate; at this scale the one-commit bypass
    is already sufficient.
  - Confidence: MEDIUM.
  - Blind spot: Nothing prevents it becoming the habitual path.
- **Decision**: FIXED via Fix A — "Critical Implementation Details" now separates
  `DRIFT` from `GATE UNAVAILABLE` (report only, both still exit 1) and names the
  availability coupling; Phase 3 §1 carries the two labelled report kinds; Phase 6 §3 gained
  a "the gate went red — now what" block (recovery + outage escape) and §4 states the
  deploy-path consequence in the README.

### F3 — The runner's import breaks AGENTS.md's hard rule on relative cross-boundary imports

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §1 / Phase 3 §1 — file placement
- **Detail**: AGENTS.md's first Hard Rule is "Import via `@/*` (maps to `src/*`); do not use
  deep relative paths like `../../lib`". Phase 3 §1 requires exactly that —
  `scripts/check-schema-drift.ts` importing `../src/lib/schema-drift.ts` by explicit relative
  path, because Node's type stripping resolves neither the alias nor an extensionless import.
  The plan states the mechanical constraint correctly (verified against
  `astro/tsconfigs/base.json`) but never notices it is knowingly breaking a documented rule.
  The cause is the placement, not the import: nothing requires the comparator to live under
  `src/`, and the plan's justification ("Location follows §6.1: `tests/` mirrors the `src/`
  path") is circular — §6.1 says tests mirror source, not that logic must be in `src/`. As it
  stands, `src/lib/` gains a module the Worker never imports.
- **Fix A ⭐ Recommended**: Put the comparator in `scripts/schema-drift.ts`; the runner imports
  `./schema-drift.ts` as a sibling and `tests/lib/schema-drift.test.ts` imports it by relative
  path.
  - Strength: No boundary crossed, the hard rule untouched, `src/` left as app source. Still
    inside `tsconfig` (`**/*`), still linted by `eslint .`, still type-checked
    (`projectService: true`), still collected by Vitest via `tests/**/*.test.ts` — verified.
  - Tradeoff: The test no longer mirrors a `src/` path, so §6.1's mirroring convention needs
    one sentence in Phase 6's test-plan edits.
  - Confidence: HIGH — nothing in the toolchain is `src/`-scoped.
  - Blind spot: None significant.
- **Fix B**: Keep it in `src/lib/` and add an explicit one-line carve-out to AGENTS.md's import rule.
  - Strength: Keeps the comparator in the aliased, conventional mainstream.
  - Tradeoff: Weakens a hard rule for a single caller, and leaves CI-only code in the Worker's
    source tree.
  - Confidence: MEDIUM.
  - Blind spot: Future `scripts/` files will cite the carve-out.
- **Decision**: FIXED via Fix A — comparator moved to `scripts/schema-drift.ts` (sibling
  import `./schema-drift.ts`); Implementation Approach, Phase 2 §1/§2, Phase 3 §1 and the
  brief's decision row + scope updated; Phase 6 §1 gained a §6.1 touch point for the
  mirroring convention (and its miscounted "four touch points" corrected to six).

### F4 — Phase 5 buys a prod DB password and a nightly Docker run for classes with no observed instance and no owner

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 5 — Nightly DDL diff
- **Detail**: Applying "if I removed this, would the end state still be achievable?" — yes.
  The Desired End State is entirely about the deploy-blocking gate; Phase 5 is explicitly
  severable and off that path. Its cost is concrete and recurring: the production database
  password in Actions secrets, a `supabase link` against prod on every run, Docker plus a
  ten-migration shadow replay, and manual triage of migra's known false positives on
  extensions and grants. What it buys, per the plan's own research (`research.md:222-224`):
  class 4 is "mechanism reachable; **no observed prod instance**", class 5 is "channel
  exists". And the brief concedes the signal has no consumer — "only as useful as someone's
  attention on the Actions tab — there is no notification channel and none is being built".
  A nightly red run nobody is committed to reading is the same unfalsifiable-green failure the
  plan quotes §6.6 about, one layer up.
- **Fix A ⭐ Recommended**: Ship it `workflow_dispatch`-only; drop the `schedule` trigger.
  - Strength: Keeps the capability, the calibration record and the Phase 6 boundary text
    intact, while removing the unwatched-red-run problem and the recurring cost; the password
    is exercised only when a human is already looking. Re-adding `schedule:` is one line.
  - Tradeoff: Classes 4/5 are then detected only when someone thinks to ask.
  - Confidence: HIGH — the job is already designed to run under `workflow_dispatch`.
  - Blind spot: Nothing then prompts anyone to run it.
- **Fix B**: Defer Phase 5 to its own change.
  - Strength: The prod DB password is not stored at all until classes 4/5 have an observed
    instance or a consumer exists; Phases 1-4 are unaffected.
  - Tradeoff: Phase 6's stated boundary gets wider; calibration is paid later anyway.
  - Confidence: HIGH — severability is asserted by the plan itself.
  - Blind spot: "Later" tends not to arrive for unowned signals.
- **Decision**: FIXED via Fix A — Phase 5 renamed "On-demand DDL diff", workflow file
  `.github/workflows/schema-diff.yml`, `workflow_dispatch` as the only trigger with the
  absence of `schedule:` asserted by criterion 5.2; the rationale is written into the phase
  Overview, "What We're NOT Doing", Performance Considerations, Phase 6 §5's test-plan
  wording, and the brief (decision row, scope, phase table, open risks).

### F5 — Phase 6's boundary text contradicts the change's own scope

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 6 §1 (test-plan contract) vs Phases 4 and 5
- **Detail**: Phase 6 §1 instructs to "name in the row itself that classes 4-9 are not
  covered", and §6.6's entry must carry "a 'what this does NOT prove' list covering drift
  classes 4-9". That is false for four of the six classes it names, by this change's own
  doing: Phase 5 covers 4 and 5 (and per `research.md:225`, 6), and Phase 4 covers 8 — which
  the plan acknowledges elsewhere ("Class 8 (generated types) *is* covered, by a separate
  cheap step, and is called out as such"). The brief's Out-of-scope list gets it right
  ("classes 6, 7 and 9"); the plan's phase contract does not. The whole purpose of Phase 6 is
  to stop Risk #5 reading as closed when it is closed in part; a boundary that is wrong in the
  other direction fails the same test, in a file whose culture is dated, precise claims.
- **Fix**: Split the contract per surface — §6.6's Phase-3 entry states what *the gate* does
  not prove (4-9, correct for a history oracle), while §2's Risk #5 row states coverage per
  class: 1-3 gated and deploy-blocking, 4-6 detected off the deploy path by the nightly,
  8 gated in `ci`, 7 and 9 uncovered.
- **Decision**: FIXED — Phase 6 §1's §2 bullet now specifies coverage per class with each
  class named; the §6.6 bullet keeps the 4-9 range but reframes it as a claim about *the
  gate* and cross-references §2 so the two cannot read as contradicting each other.

### F6 — Phase 3's gate cannot be satisfied before Phase 4 starts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — criterion 3.7 + Implementation Note
- **Detail**: 3.7 reads "After merging: a real push to `main` shows `drift` green and `deploy`
  running as before", and 3.4 reads "`gh workflow view CI` after the push". The Implementation
  Note then says to pause until manual verification passes before proceeding. The merge happens
  once, at /ship, after all six phases — so as written the implementer either blocks forever or
  silently ignores the gate. Phase 5's 5.5 ("`deploy` is confirmed not to depend on this
  workflow") has the same shape.
- **Fix**: Mark 3.4, 3.7 and 5.5 explicitly as post-merge/ship-time checks, say in Phase 3's
  Implementation Note that the pause covers only the locally-verifiable criteria, and fold the
  post-merge items into the change's `verification.md` as a ship-time checklist.
- **Decision**: FIXED — 3.9 and 5.5 are labelled "(ship-time)" in both the Success Criteria
  and Progress; 3.4 is re-pointed at the rehearsal run's branch push instead of "after the
  push"; Phase 3's and Phase 5's Implementation Notes now scope the pause to the
  pre-merge criteria and send the ship-time items to `verification.md`.

### F7 — The drift-class taxonomy is used everywhere and defined nowhere in the plan

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Overview, "What We're NOT Doing", Phases 4, 5, 6
- **Detail**: Classes 1-9 are referenced in five places and defined only parenthetically and
  inconsistently. The canonical table exists — `research.md:219-227` — but the plan never
  cites it, and Phase 6 writes those class numbers into `test-plan.md`, a document explicitly
  read without the change folder beside it.
- **Fix**: Cite `research.md:219-227` in Current State Analysis, and have Phase 6's contract
  require the class *names* (not just numbers) in the test-plan text.
- **Decision**: FIXED — Current State Analysis gained a bullet citing `research.md:219-227`
  as the single enumeration; Phase 6 §1's two doc bullets now require the class names.

### F8 — Phase 5's automated criterion checks a run against a baseline derived from that same run

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 5 — criterion 5.1 vs Phase 5 §2
- **Detail**: §2 says the *first* run's output becomes the baseline; 5.1 says the
  `workflow_dispatch` run "completes and its verdict matches the recorded baseline". Read in
  order those are the same run, so the assertion agrees with itself — the oracle problem §6.1
  warns about.
- **Fix**: Word 5.1 as a *second* dispatch, after the first run's output has been triaged and
  recorded, matching the baseline.
- **Decision**: FIXED — criterion 5.1 (Success Criteria and Progress) now requires a
  *second* dispatch against the triaged baseline, and says why the first-run form is the
  oracle problem.

## Post-triage addendum (2026-07-27, not a finding)

Raised by the user after triage closed, recorded here so the report matches the plan on disk.

**`.claude/skills/ship/SKILL.md` is gitignored.** `.gitignore` carries `.claude/`, so Phase 6
§3's runbook edits are local and untracked — they reach neither the repository, CI, nor a
fresh clone. Left that way on purpose: un-ignoring `.claude/` is out of scope, and the
tracked files in the same phase (`README.md`, `AGENTS.md`, `test-plan.md`) carry the shared
record, which is the reason F2's recovery procedure was put in the README as well as in the
runbook.

**Confirmed by enumeration: no phase modifies `.gitignore` or `.gitattributes`.** All five
mentions in `plan.md` are read-only facts (`.gitattributes` as the `eol=lf` justification for
Phase 4's types gate; "gitignored" describing `supabase/.temp/`), and neither file appears in
any *Changes Required* block. `git status` on both is clean.

Written into the plan in two places so it survives without this report: a new bullet in
"What We're NOT Doing", and a paragraph before Phase 6 §3's contract. The brief's Docs scope
line carries the same qualifier.
