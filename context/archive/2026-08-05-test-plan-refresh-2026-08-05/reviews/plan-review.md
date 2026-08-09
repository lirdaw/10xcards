<!-- PLAN-REVIEW-REPORT -->

# Plan Review: test-plan.md refresh for the arrival of e2e

- **Plan**: `context/changes/test-plan-refresh-2026-08-05/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-05
- **Verdict**: REVISE → **SOUND after triage** (all 6 findings fixed in the plan, 2026-08-05)
- **Findings**: 2 critical, 4 warnings, 0 observations — 6 fixed, 0 skipped, 0 accepted, 0 dismissed

> **Triage note.** F1's subject — an untracked `tests/e2e/route-guard.spec.ts` — was removed from the
> working tree **during** triage, between the 21:25 measurement (136 files) and the 21:27 re-check
> (135). The finding is left standing as written because it was true when measured and because its
> durable half was applied: criterion 7.3 now uses `git status --porcelain`, since `git diff` is
> structurally blind to the untracked file that moved the count. Read the count history in F2 with
> this in mind — 133 → 135 → 136 → 135 inside four days is the evidence for dropping the total, not
> a bookkeeping error.

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | FAIL    |
| Plan Completeness     | WARNING |

## Grounding

6/6 paths exist (`README.md`, `context/foundation/test-plan.md`, `context/foundation/lessons.md`,
`context/foundation/roadmap.md`, `playwright.config.ts`, `tests/e2e/seed.spec.ts`). 14 line-anchors
checked: 12 exact, 2 off-by-one (§6.1 Naming is `:784-785` not `:783-784`; §6.2 Location is
`:863-864` not `:862-863`). brief↔plan consistent. Working tree clean vs `HEAD` for all three
target documents.

Claims the plan makes that were **confirmed** by measurement:

- `lessons.md:184` cites `roadmap.md:234`; the archive-ownership sentence is at `roadmap.md:401`. ✓
- `AGENTS.md` quotes no file total (`AGENTS.md:22` states the gate with no number). ✓
- `git ls-files '*.astro' | wc -l` → 18. ✓
- `133` appears in exactly two places: `README.md:49` and `test-plan.md:2765`. ✓
- `.gitignore` carries `/test-results/` and `/.playwright-cli/` (harness risk #5 closed by `5f3c87e`);
  `playwright-report/`, `blob-report/`, `.last-run.json`, `*-snapshots/` remain unignored. ✓
- `playwright.config.ts` sets `trace: "on-first-retry"` with no `retries` key, and there is no
  `webServer`, no npm script, no browser-install step. ✓
- Every version §4 states matches its installed value — Vitest 4.1.10, Astro 6.3.1, Supabase CLI
  2.98.2, `eslint-plugin-jsx-a11y` 6.10.2, `@playwright/test` 1.62.1. Phase 2's re-verification
  will pass cleanly with no edits. ✓

Claims **contradicted** by measurement — see F1, F3, F6:

- `npm run typecheck` → `Result (136 files): 0 errors`, not the 135 the plan asserts.
- A literal grep for the mis-keyed trigger returns **2** occurrences, not the 4 criterion 5.1 expects.
- `npx prettier --check context/foundation/lessons.md` exits **1** at `HEAD`.

## Findings

### F1 — An untracked journey-B spec is already in the tree

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Current State Analysis · What We're NOT Doing · Phase 7 (7.4)
- **Detail**: `git status` shows an untracked `tests/e2e/route-guard.spec.ts` (6076 bytes, Polish
  comments, scoped exactly as `change.md`'s journey-B correction prescribes — "guard jest
  ZAMONTOWANY", oracle = final browser URL). Three plan statements are false against it: Current
  State says "Exactly two files were added since `ebe1d92`" (three exist); What We're NOT Doing says
  "no spec" (journey B's spec is written); and `npm run typecheck` reports **136 files**, not 135, so
  criterion 7.4 fails on its first run. Criterion 7.3 (`git diff --stat` touches nothing under
  `tests/`) passes anyway, because untracked files never appear in `git diff` — the guard the plan
  relies on to catch exactly this is blind to it.
- **Fix A ⭐ Recommended**: Decide the file's disposition in the plan, before Phase 1 — park it
  (stash, or move it into the change folder as a draft the phase picks up), state that in What We're
  NOT Doing, and Phase 1's number becomes 135.
  - Strength: Restores the scope boundary `change.md` argues for at length ("do not collapse this
    change with the phase it adds"), and makes the denominator deterministic.
  - Tradeoff: The spec sits outside git until the phase opens; if lost, it is re-derivable from
    `change.md`'s response guidance.
  - Confidence: HIGH — both the file and the 136 count measured directly.
  - Blind spot: Whether the spec was authored deliberately for this session or is exploratory
    output — the author knows, the tree does not.
- **Fix B**: Commit it under this change and re-scope the refresh to include it.
  - Strength: Nothing is lost or re-derived; the count settles at 136 and Phase 6's §6.1/§6.2 trap
    sentences gain a live example.
  - Tradeoff: Breaks the change's central scope decision and hands the §3 Phase 6 row a partly-done
    journey B — the orphan pattern the refresh exists to stop, one step further along.
  - Confidence: MEDIUM — cheap mechanically, but it contradicts the plan's stated reason for existing.
  - Blind spot: Whether the spec passes; it has never been run (no npm script, no `storageState`
    producer — the plan's own harness risk #2).
- **Decision**: FIXED via Fix A, in a narrowed form — **the spec was removed from the tree during
  triage, before any plan edit landed**. Re-measured: `npm run typecheck` → `Result (135 files)`,
  `git status --porcelain` clean. So Current State's "exactly two files" and criterion 7.4's `135`
  are both true again and needed no edit. What was applied is the durable half: criterion 7.3 now
  uses `git status --porcelain` instead of `git diff --stat`, because a diff is structurally blind
  to an untracked file and would have reported a clean sweep over the very spec that moved the
  count. The 136 measurement is recorded at the criterion so a future reader knows the guard was
  changed by an observed miss, not by a preference.

### F2 — README pins an exact file count the gate deliberately does not

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1 — README's script list
- **Detail**: The plan replaces one exact count with another exact count (133 → 135) on a **live**
  claim. That number has been 133, then 135, then 136 within four days, and moves whenever any file
  is added outside `dist`/`context`. The plan itself records why it should not be pinned:
  `test-plan.md:24-25` — the gate asserts on a **floor**, precisely so a rising count cannot go red.
  §8 records this denominator-rot class four times (C10X-39's 18/332, C10X-40's 342, C10X-42's stale
  warning count, C10X-43's 13-vs-9). Writing `135` schedules the next entry.
- **Fix A ⭐ Recommended**: Describe the scope, drop the total.
  - Strength: Makes the sentence permanently true. `AGENTS.md:22` already states the identical gate
    with no total and needs no correction on this axis — the plan measured that and can match it.
    Removes the criterion-7.4 coupling in the same edit.
  - Tradeoff: A reader loses the "is my run checking everything?" sanity number; mitigated because
    `run-typecheck.ts` prints it live on every run.
  - Confidence: HIGH — grounded in the plan's own §4/§8 evidence and in AGENTS.md's existing wording.
  - Blind spot: None significant.
- **Fix B**: Keep an exact count, but date-qualify it in §4's `checked:` idiom.
  - Strength: Preserves the number; a stale figure then reads as a dated measurement, not a false claim.
  - Tradeoff: README carries no `checked:` idiom today; and the figure still needs F1 resolved first
    to know whether to write 135 or 136.
  - Confidence: MEDIUM — consistent with test-plan.md's conventions, novel for README.
  - Blind spot: Whether a dated count in an "Available Scripts" list reads as clutter.
- **Decision**: FIXED via Fix A. Phase 1 §1's Contract now removes the total from `README.md:49`
  instead of replacing `133` with `135`, cites the floor design and the four-day 133/135/136/135
  history as the reason, and points at `AGENTS.md:22` as the wording to match. Criterion 1.2 flipped
  from "carries 135" to "carries no total". A guard clause was added so the fix is not over-applied:
  §2's dated correction block **keeps** its `135` / `117`, because a count inside a dated record is a
  measurement carrying its own date rather than a standing claim. Criterion 7.4 was softened in the
  same spirit — it now asserts 0 errors and records `N`, with a differing `N` routed to 7.3 rather
  than to a document edit.

### F3 — Phase 5's trigger grep misses a line-wrapped occurrence

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 5 — Success Criteria / Progress 5.1 (and 7.7)
- **Detail**: Criterion 5.1 states "expected total: 4". Measured, a literal grep for
  `Re-evaluate the moment any §3 phase wires e2e` returns **2** (`:3292`, `:3524`). The two missing
  ones are missing for different reasons, and both matter: `:3237-3239` wraps the phrase across a
  line break ("any §3 phase\n wires e2e"), so no single-line grep will ever see it; and `:3256-3258`
  (the `scroll-padding-top` deferral) never carried the clause at all — its blocker is worded "needs
  its own browser verification". This is verbatim the failure §8's C10X-39 entry records against this
  very file ("the obvious grep for the phrase misses it because it breaks across two comment lines —
  which is why the criterion for this phase is a **pair** of patterns, not one"). It recurs a second
  time in this plan: criterion 7.7 greps `364/364, 31 files`, which matches only `:4168` — the
  `:42-43` occurrence the same Contract names is wrapped and invisible to it.
- **Fix**: Split 5.1 into a per-site check keyed on the Contract's four line anchors (each must sit
  in a block containing `2026-08-05`), and add a second, wrap-tolerant pattern (e.g.
  `Re-evaluate the moment any §3 phase`) beside the full phrase — the C10X-39 pair idiom. Apply the
  same to 7.7.
  - Strength: Uses the file's own recorded remedy for its own recorded defect.
  - Tradeoff: Two patterns per criterion instead of one.
  - Confidence: HIGH — both counts measured against `HEAD`.
  - Blind spot: None significant.
- **Decision**: FIXED. Criterion 5.1 (Success Criteria and Progress) now checks the four
  Contract-named anchors individually and explicitly forbids a hit count, recording why a count is
  wrong twice over. It also adopts the C10X-39 **pair** idiom — the full phrase plus the
  wrap-tolerant `Re-evaluate the moment any §3 phase`. Criterion 7.7 got the same treatment: both
  `364/364, 31` sites are now checked per anchor, with the wrapped `:42-43` twin named.

### F4 — A false clause survives on test-plan.md:688

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §3 — the `claude-in-chrome` tooling line
- **Detail**: Line 688 reads "available; not used, no §2 risk is DOM-unreachable **and no phase claims
  e2e**; checked: 2026-07-15". Phase 2's Contract names only the first clause as false and says
  "`not used` remains true". It never mentions the second — which Phase 3 turns false by adding the §3
  Phase 6 row, and which the plan elsewhere treats as the headline consequence of that row (it is the
  stated reason §4's e2e row must be rewritten). So the Desired End State ("no statement about e2e …
  that is false on 2026-08-05") fails on its own terms, at a line the plan already has open.
- **Fix**: Extend Phase 2 §3's Contract to name both clauses on `:688`, and note the ordering
  dependency the plan applies elsewhere — this line, like §4's row and §5's paragraph, can only be
  finalised after Phase 3.
- **Decision**: FIXED. Phase 2 §3's Contract now names both clauses explicitly, flags why the second
  is easy to miss (it sits after an `and` on the same line), and states that `:688` inherits the same
  after-Phase-3 ordering dependency as §4's row and §5's paragraph. The claims-vs-wires consistency
  check — criterion 4.5 and Testing Strategy manual step 1 — was widened from three sites to four.

### F5 — Three automated criteria cannot do what they claim

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress 6.3, 3.2, 1.3
- **Detail**: Measured against `HEAD`: (a) **6.3** — `grep -c "6.11" test-plan.md` returns **1**, not
  0, before any edit, because `.` is a regex wildcard and matches `6011` inside the migration
  timestamp `'20260601120000'` at `:1866`; `grep -cF "6.11"` returns 0, so the criterion as written can
  never pass. (b) **3.2** — the nine "distinguishing tokens" are grepped file-wide, but three already
  occur at `HEAD`: `preflight` ×18, `trace` ×5, `.gitignore` ×4; those three pass whether or not the
  sequencing note mentions them — the unfalsifiable-assertion class §6.6 records against
  `listDueCounts`. (c) **1.3** — `grep -c "(133 files)"` must "still return 1", but §6.6's correction
  blocks conventionally quote the figure they supersede; doing so makes it 2 and fails the criterion,
  pressuring the implementer to write a vaguer correction to keep a grep green.
- **Fix**: 6.3 → `grep -cF "### 6.11"`; 3.2 → scope the greps to the sequencing note's line range (or
  use phrase-level tokens unique to the note); 1.3 → assert the row's full text is byte-identical to
  `HEAD` via `git diff` on that line instead of counting a substring.
- **Decision**: FIXED, all three. 6.3 → `grep -cF "### 6.11"`, with the reason the bare form can
  never pass recorded at the criterion. 3.2 → greps scoped to the sequencing note's own line range,
  naming which three tokens would otherwise pass vacuously and which six are genuinely falsifiable.
  1.3 → the §6.6 row is asserted byte-identical via `git diff` on `:2765`, and the criterion now
  states why a substring count would have pushed the writer toward a vaguer correction. Each fix was
  applied in both the Success Criteria block and the matching Progress line.

### F6 — lessons.md is prettier-dirty at HEAD, and lint-staged will fix it silently

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 6 — Success Criteria 6.4 / Progress 6.6
- **Detail**: Measured: `npx prettier --check context/foundation/lessons.md` exits **1** at `HEAD`
  (`README.md` and `test-plan.md` both exit 0). The drift is small — 2 lines, trailing whitespace at
  `:204` and `:211` — but it has two consequences the plan does not anticipate. Criterion 6.4 goes red
  before the change touches anything. And because `.prettierignore` covers `context/archive/**` only —
  the plan quotes this correctly — staging `lessons.md` for the one-line pointer fix makes
  `lint-staged` normalise those two lines too, so manual criterion 6.6 ("a pointer change and nothing
  else") is false as written. The plan's Critical Implementation Details section anticipated this exact
  hazard for `test-plan.md` and checked the wrong file for it.
- **Fix**: Note the pre-existing drift in Phase 6, and either normalise it in the same commit with the
  reason stated, or re-word 6.6 to "the pointer change plus prettier's normalisation of two
  pre-existing trailing-whitespace lines". Keep 6.4 — it should pass _after_ the phase, not before it.
- **Decision**: FIXED via "normalise + state it". Phase 6 §2's Contract now records the measurement,
  names the two lines, explains why `lint-staged` will touch them whether or not it is asked, and
  instructs that they be normalised deliberately in the same commit. Criterion 6.4 is marked an
  **after**-check (expected red at `HEAD`); 6.6 now reads "the pointer change plus exactly two
  whitespace-only lines" with "three or more content hunks" as the failure signal. The plan's
  Critical Implementation Details prettier note gained the measurement too, since that is where a
  reader looks for this hazard and it was written about the wrong file.
