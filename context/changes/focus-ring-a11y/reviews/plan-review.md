<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Global Focus Ring (C10X-22)

- **Plan**: `context/changes/focus-ring-a11y/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-25
- **Verdict**: REVISE → **SOUND** after triage (all 6 findings fixed in the plan)
- **Findings**: 1 critical, 4 warnings, 1 observation

## Verdicts

| Dimension | Verdict (as reviewed) | After fixes |
|-----------|-----------------------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

13/13 paths ✓, 18/18 line refs ✓ (`global.css:25/38/59/72/219`, `button.tsx:8/14`,
`input.tsx:12`, `textarea.tsx:11`, `FormField.tsx:6/53`,
`GeneratorForm.tsx:93/201/209/225/232`, `StudySession.tsx:58`,
`CandidateItem.tsx:204/214`), blast radius clean — only `FormField.tsx` matches the
Phase-3 `focus:` grep, brief↔plan ✓, Progress↔Phase ✓ (1 heading, 4/4 phases, all
criteria mapped, no checkbox leakage). Contrast arithmetic re-derived independently:
white / `rgb(39,44,62)` = 13.8:1, white @ 50% = 4.66:1 — both match the plan's numbers.

Post-triage re-check: 32 Progress items ↔ 32 phase criteria (1.1–1.4, 2.1–2.10,
3.1–3.10, 4.1–4.8), still one `## Progress` heading, still no checkbox leakage.

## Findings

### F1 — The second mechanism is a colour, not an outline

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1 / Critical Implementation Details
- **Detail**: `global.css:219` is `@apply border-border outline-ring/50` — it sets
  `outline-color` and nothing else: no `outline-style`, `outline-width` or
  `outline-offset`. So the entire "everything else" half of the architecture (both
  `<select>`s, both checkboxes, the sidebar toggle, the sign-out button, every link)
  depended on the UA honouring an author `outline-color` under `outline-style: auto`
  — behaviour the plan itself refused to assume and which varies by browser and
  version. Phase 2 changed only `/50` → full alpha, never making the outline
  deterministic. Two consequences had no branch: (a) a negative measurement would
  leave Phase 2 fixing three primitives only, Phase 3's list ballooning from 6
  candidates to every raw control, and the global edit needed in no phase's contract;
  (b) Phase 1's contract is one browser session, while PRD §NFR asks for the latest
  two majors — and `outline-style: auto` is where UAs diverge most, so the end state
  could read green on Chrome while Firefox users get nothing, recorded as passing in
  the artifact that stands in for a test here.
- **Fix A ⭐ Recommended**: Paint the outline explicitly in the base layer —
  `@layer base { *:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px } }`
  - Strength: Removes the UA dependency entirely while staying "one place"; the
    primitives are unaffected because their `outline-none` sits in `@layer utilities`,
    which beats `@layer base` by cascade layer regardless of specificity.
  - Tradeoff: One more global rule to own; `outline-offset` can be clipped.
  - Confidence: HIGH — layer ordering and the `outline-none` override verified in
    this codebase, not inferred.
  - Blind spot: Clipping unverified — `AuthenticatedLayout.astro:20` and the
    `flashcard-panel` utility both set `overflow: hidden`.
- **Fix B**: Keep the colour-only change, make Phase 1 an explicit two-browser
  decision gate with Phase 2/3 scope re-derived on a negative result.
  - Strength: Smallest diff if the measurement is favourable.
  - Tradeoff: Leaves the app one Chromium release from a silent regression on ~15
    controls, with no test to catch it.
  - Confidence: MED — depends on a UA behaviour nobody here has measured.
  - Blind spot: A green measurement pins today's Chrome, not "the latest two majors".
- **Decision**: FIXED via Fix A — Phase 2 §1 gains the explicit `*:focus-visible`
  rule (keeping `outline-ring` as the colour for surfaces it does not reach); the
  Critical Implementation Details paragraph is reframed so the measurement decides
  Phase 3's scope rather than whether the fix works at all; new criterion 2.10 covers
  the `overflow: hidden` clipping blind spot.

### F2 — "Not touching roadmap.md" rests on a false premise

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: What We're NOT Doing / Phase 4 §3
- **Detail**: The plan stated "This is a Jira bug (C10X-22), not a roadmap slice." It
  is one: `roadmap.md:55` and `:211` carry **H-01** for exactly this ticket, status
  `in-progress`. Three consequences: H-01 declares `Change ID: bug-focus-ring-a11y`
  while the folder is `focus-ring-a11y`, and `test-plan.md:818` cites the same dead
  path; H-01's Risk field and `test-plan.md:810` still state the cause the frame brief
  refuted; and `lessons.md:170` reserves only the **Status** flip for `/10x-archive`
  ("doc-sync updates only the Outcome"), so the blanket exclusion over-applied the
  rule. Phase 4 would write the durable rule into AGENTS.md and lessons.md while the
  two foundation docs a contributor actually opens kept naming a disproved cause under
  a change-id resolving to nothing.
- **Fix**: Phase 4 §3 gains a doc-sync step — correct H-01's Change ID and Risk text,
  and `test-plan.md` §7's parenthetical + folder path; leave Status to `/10x-archive`.
  - Strength: Closes the last mile of the plan's own durability goal, scoped to
    Outcome-level text so it stays inside `lessons.md:170`.
  - Tradeoff: Touches two foundation docs the plan wanted to leave alone.
  - Confidence: HIGH — both files read directly; both already modified and uncommitted.
  - Blind spot: Whether `/10x-archive` keys off the roadmap change-id or the folder
    name is unverified — the mismatch may be cosmetic or may break archival.
- **Decision**: FIXED — "What We're NOT Doing" rewritten to exclude only the Status
  flip; Phase 4 §3's file list and contract extended; §4's bookkeeping line corrected;
  new criterion 4.8.

### F3 — Criterion 2.9 is not pass/fail, and Progress drops its escape clause

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 Manual Verification / Progress 2.9
- **Detail**: "…still show something on keyboard focus — if not, they are Phase 3
  work." A criterion whose failure is also an acceptable outcome is not a gate.
  Progress 2.9 stated it flatly with the escape clause removed, so `/10x-implement`
  would pause on a red box the plan intends to allow. (The study count field is an
  `Input` primitive and rings regardless; only the two `<select>`s are at risk.)
- **Fix**: Reword both to the observation it actually is — record what the selects
  paint; nothing is a legal outcome that adds them to Phase 3's scope list.
- **Decision**: FIXED

### F4 — Phase 1 measures no border, yet the border is today's indicator on 4 controls

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2 Contract
- **Detail**: The contract read `boxShadow`, `outlineStyle`, `outlineWidth`,
  `outlineColor` — no border. But `focus-visible:border-ring` is on all three
  primitives and `focus-visible:border-white/40` (`GeneratorForm.tsx:93` → `:209,232`)
  is the only focus style the two `<select>`s have. The PRZED column would understate
  what a user sees today on Input, Textarea and both selects, weakening the artifact
  that stands in for a test here.
- **Fix**: Add `borderColor` and `borderWidth` to the measured property list.
- **Decision**: FIXED

### F5 — `npm run format` is a writer, not a check

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 Automated / Progress 4.3
- **Detail**: `package.json` defines `"format": "prettier --write ."`. It always exits
  0 and rewrites the whole repo, so "Formatting is clean" verifies nothing and can
  leave uncommitted reformatting in files this change never touched.
- **Fix**: Replace with `npx prettier --check .`.
- **Decision**: FIXED

### F6 — The banner rule will silently match nothing without `:global()`

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 Contract
- **Detail**: The banner's link is slotted in from `Layout.astro:29`, not authored in
  `Banner.astro`. Astro scoped styles do not reach slot content — which is why the
  existing rule is `.banner :global(a)` (`Banner.astro:22`). A rule written as
  `.banner a:focus-visible` compiles to a `[data-astro-cid-…]` selector and matches
  nothing; criterion 3.9 would catch it, but only after a confusing debug session.
- **Fix**: State the selector in the contract —
  `.banner :global(a:focus-visible) { outline: 2px solid currentColor; outline-offset: 2px }`;
  `color: inherit` is already set, so `currentColor` tracks all three variants.
- **Decision**: FIXED
