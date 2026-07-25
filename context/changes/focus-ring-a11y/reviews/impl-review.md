<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Global Focus Ring (C10X-22)

- **Plan**: `context/changes/focus-ring-a11y/plan.md`
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-07-25
- **Verdict**: NEEDS ATTENTION → **all findings triaged and resolved** (see Triage outcome)
- **Findings**: 0 critical, 4 warnings, 3 observations

## Triage outcome (2026-07-25)

All 7 findings decided; 6 FIXED, 1 PARTIALLY FIXED. Two of the review's own claims were
**refuted by measurement during triage** and are corrected in place rather than quietly
dropped — F5's de-indentation (prettier requires that form) and F6's `<dialog>` half
(`showModal()` focuses the first focusable descendant, so it never happens here). F1's
prescribed fix was also wrong on its own terms — no alpha could clear 3:1 — and was
replaced by the token-level fix after measurement.

Code changed during triage: `global.css` (`--destructive`, `--background`, `--secondary`
and their foregrounds aligned to the `.dark` values), `input.tsx` / `textarea.tsx` /
`button.tsx` (`aria-invalid:ring-destructive` at full alpha), `AGENTS.md` (rule scoped to
the neutral state). Docs: `verification.md` (+ `aria-invalid` section, sweep-scope
boundaries, F6 measurements), `test-plan.md` §7 (WCAG citation corrected), `plan.md`
(criterion 4.3 re-scoped).

Final gates: `npm run lint` ✅ · `npm run build` ✅ · `npm test` **69/69** ✅ ·
`npx prettier --check $(git diff --name-only main...HEAD)` ✅ · focus indicator
re-measured in Chrome at **19.11 / 17.25 / 8.20**, identical to `verification.md`.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | FAIL    |

### Evidence behind the PASS dimensions

**Plan Adherence** — every "Changes Required" item across all four phases verified
against the file on disk: 0 MISSING, 0 DRIFT. Phase 3 §3 (controls with no
indicator) correctly resolved to _no work_, because Phase 1's measurement found the
candidate list empty and recorded the resolution per candidate
(`verification.md:140-159`). All seven "What We're NOT Doing" boundaries hold:
`.dark` not enabled, the `dark` custom-variant still present, `CandidateItem.tsx:204`
selection ring untouched, no `hover:` class changed, no test file added, no light-surface
branch in `global.css`, roadmap H-01 Status still `in-progress` and absent from `## Done`.

**Architecture** — the change's load-bearing claim (the primitives' `outline-none`
in `@layer utilities` beats the new `*:focus-visible` in `@layer base` by cascade
layer) was verified on compiled output, not assumed: the emitted stylesheet opens
`@layer theme, base, components, utilities;`, `.outline-none` lands in `utilities`,
the author rule in `base`. The comment at `global.css:231-237` is factually correct.
Ring-token indirection is clean — all six consumers of `--ring` / `--color-ring` in
`src/` are on the focus path; no decorative, divider or chart use silently turned white.

## Findings

### F1 — `aria-invalid` ring overrides the new white token, at ~1.1:1

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/ui/input.tsx:13, src/components/ui/textarea.tsx:12
- **Detail**: On any field carrying `aria-invalid="true"`, the focus ring is **not**
  the white token. Verified on the shipped build (`dist/client/_astro/Layout.msfg-0Zf.css`):

  ```
  byte 47517  .focus-visible\:ring-ring:focus-visible               { --tw-ring-color: var(--ring) }
  byte 48656  .aria-invalid\:ring-destructive\/20[aria-invalid=true]{ --tw-ring-color: color-mix(in oklab, var(--destructive) 20%, transparent) }
  ```

  Identical specificity (0,2,0 — class + pseudo-class vs class + attribute), same
  cascade layer, and `aria-invalid` is emitted **later**, so it wins. The ring still
  paints (width comes from `focus-visible:ring-[3px]`) but composited over the app's
  backdrop `rgb(39,44,62)` it measures ≈ **1.1:1** — below the 2.4:1 baseline this
  ticket was filed to fix, and far below the 3:1 bar.

  Reachable on **8** sites, all of the `error ? true : undefined` form (a server-side
  validation error): `CreateDeckModal.tsx:75`, `DeckActions.tsx:96`,
  `CreateFlashcardModal.tsx:98,115`, `FlashcardItem.tsx:137,153`,
  `CandidateItem.tsx:153,169`.

  > **Correction to this finding, made during triage.** It originally counted 9 sites and
  > named `GeneratorForm.tsx:293` as the cheapest — "flips invalid from typing past
  > `SOURCE_MAX`, no server round-trip". That is wrong: the textarea carries
  > `maxLength={SOURCE_MAX}` (`GeneratorForm.tsx:291`), so the value cannot exceed 10 000
  > and `trim().length > SOURCE_MAX` is effectively unreachable through the UI. The
  > defect and its severity are unchanged — a duplicate deck name reaches it in two
  > clicks, and that is the path the browser measurement used.

  This is **not a regression** — the same conflict existed with `ring-ring/50` before
  the change. What is new is that three documents now assert a claim that is false on
  this path: `verification.md`'s "48 of 48 rows pass / nothing below 3:1",
  `AGENTS.md:32`'s "the focus indicator comes from the shared `--ring` token only", and
  `test-plan.md §7`'s "contrast ≥ 3:1, WCAG 1.4.11 / 2.4.11". The plan's
  "`aria-invalid:*` rules are untouched" (`plan.md:298`) was a deliberate exclusion, but
  it was decided without analysing the _interaction_, and `verification.md`'s sweep
  focused every control in its resting state, so no measurement could have caught it.

- **Fix A ⭐ Recommended**: Raise the invalid-state ring to a measured, passing alpha —
  `aria-invalid:ring-destructive/20` → `/70` (or higher, measured) in `input.tsx` and
  `textarea.tsx` — then add the invalid state as rows in `verification.md` using the
  same harness.
  - Strength: Closes the actual a11y hole on the axis the ticket exists for, and keeps
    the error state semantically red rather than reverting it to white. Matches the
    precedent already set in this change for `FormField.tsx:57`, where a red error ring
    was deliberately kept and measured at 4.75–4.80:1.
  - Tradeoff: Touches two vendored-shape primitives beyond the plan's stated scope, and
    needs a fresh browser measurement to pick the alpha rather than guessing it.
  - Confidence: HIGH — the mechanism is confirmed on the compiled build, and
    `FormField`'s red ring proves a semantic red clears 3:1 on these backdrops.
  - Blind spot: `dark:aria-invalid:ring-destructive/40` (byte 51127) is dead today
    because `.dark` never activates, but would need the same treatment if a theme
    toggle ever lands.
- **Fix B**: Leave the code as-is and narrow the three claims — add the `aria-invalid`
  exception to `AGENTS.md:32`, to `verification.md`'s verdict, and to `test-plan.md §7`,
  and open a follow-up ticket.
  - Strength: Keeps this change inside its declared scope and stops the documentation
    from overstating what was measured, which is the part that misleads future readers.
  - Tradeoff: Ships a known sub-1.2:1 focus indicator on a state a user reaches by
    ordinary typing; the ticket's own acceptance criterion stays unmet there.
  - Confidence: HIGH — purely documentary, no cascade risk.
  - Blind spot: A follow-up that is only written down tends not to get built.
- **Decision**: FIXED via Fix A, **corrected during triage** — Fix A's stated remedy
  (`/20` → `/70`) was measured before it was applied and does not work: `--destructive`
  in `:root` is `oklch(0.577 0.245 27.325)` = `#e7000b`, dark enough that **no alpha**
  clears 3:1 on this app's surfaces (`/100` tops out at 2.64–2.91). The root cause was
  the same one this whole change was filed for — a LIGHT-theme token resolving on a
  permanently dark app — so the applied fix mirrors Phase 2's `--ring` move:
  `--destructive` in `:root` → `oklch(0.704 0.191 22.216)` (`#ff6467`, the `.dark`
  block's own value, byte-identical to Tailwind `red-400`), and
  `aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40` →
  `aria-invalid:ring-destructive` in `input.tsx`, `textarea.tsx` and `button.tsx`.
  Result 4.35–6.26:1, and the error ring is now the same colour `FormField.tsx:57`
  already used. Blast radius checked first: the token's only consumers are the
  primitives' `aria-invalid:*` classes; the `variant="destructive"` button is
  hand-rolled from `red-*` and is untouched. Recorded in `verification.md`
  §"The `aria-invalid` state". **The browser re-measurement that section owed has since
  been run** (during F6's session, same calibrated harness): with a duplicate deck name
  driving `aria-invalid="true"` on `#deck-name`, PRZED reconstructed live in the browser
  reads **1.11** and PO reads **6.27** on the modal backdrop — matching the computed
  table to 0.01 on both sides, which promotes the remaining three backdrops from
  arithmetic to a calibrated estimate. Verified: `npm run lint` ✅, `npm run build` ✅,
  compiled bundle shows `--destructive:oklch(70.4% .191 22.216)` in both blocks and no
  `/20` or `/40` class left in `src/`.

### F2 — The durable rule in `AGENTS.md` forbids what this change deliberately shipped

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: AGENTS.md:32
- **Detail**: The new line reads "Never add a per-component `focus-visible:ring-*`
  override". Two per-component ring overrides are shipped in this very change and are
  correct: `FormField.tsx:57`'s `focus-visible:ring-red-400` (the semantic error ring
  the plan explicitly preserved, measured 4.75–4.80:1) and `FormField.tsx:10`'s
  `focus-visible:ring-2` (the 2px width the plan deliberately kept to avoid changing
  the auth layout). The primitives likewise keep `aria-invalid:ring-destructive/20`.

  Phase 4's whole purpose was a rule that survives contact with the next contributor.
  A rule contradicted by the repo it governs gets one of two responses from a reader —
  ignored, or enforced into a regression by removing the red error ring.

- **Fix**: Narrow the rule to the neutral state, e.g. "…never add a per-component
  `focus-visible:ring-*` override for the **neutral** focus colour; the error /
  `aria-invalid` colour is the documented exception (see `FormField.tsx:57`)."
- **Decision**: FIXED — `AGENTS.md:32` now scopes the prohibition to the **neutral**
  focus colour, names the error state as the one documented exception (`--destructive`
  via `aria-invalid:ring-destructive` and `FormField.tsx`'s `focus-visible:ring-red-400`,
  now the same value after F1), and adds the trap both tokens share: full alpha is
  load-bearing, an alpha modifier on either drops it below 3:1.

### F3 — Automated criterion 4.3 is marked `[x]` but does not pass

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/focus-ring-a11y/plan.md:661
- **Detail**: `npx prettier --check .` exits non-zero: **58 files** report style issues.
  Progress item 4.3 ("Formatting is clean: `npx prettier --check .`") is checked off
  against commit `5031d8e`.

  Two separable facts. Most of the 58 are pre-existing and untouched by this branch
  (`context/foundation/prd.md`, `idea-notes.md`, `wrangler.jsonc`, `src/db/database.types.ts`,
  the whole `context/archive/` tree) — so the gate as written could never have passed
  and the plan specified an unsatisfiable criterion. But **5 of the failing files were
  added by this change**: `context/changes/focus-ring-a11y/{change,frame,plan-brief,plan}.md`
  and `reviews/plan-review.md`.

  Practical impact is low: every touched file under `src/`, plus `AGENTS.md`,
  `lessons.md`, `roadmap.md`, `test-plan.md` and — notably — `verification.md` itself
  are all clean. The failures are the change's own planning docs.

  Other automated criteria re-run and genuinely green: `npm run lint` ✅,
  `npm run build` ✅, `npm test` **69/69** ✅, and all four `grep` gates (2.3, 2.4, 3.3,
  3.4) return nothing ✅.

- **Fix**: Run `npx prettier --write` on the five files this change added, then restate
  criterion 4.3 as scoped to the change's own files (e.g.
  `npx prettier --check $(git diff --name-only main...HEAD)`) so a future reader is not
  handed a gate that cannot go green.
- **Decision**: FIXED — `npx prettier --write` run over the change's seven own files
  (the five failing ones plus `verification.md` and this report). Criterion 4.3 restated
  in `plan.md` as `npx prettier --check $(git diff --name-only main...HEAD)`, with the
  reason recorded inline: the repo-wide form is unsatisfiable because 53 files unrelated
  to this branch already fail it on `main`, and "fixing" them would be exactly the
  out-of-scope rewrite the bullet warns against. Re-run: **"All matched files use
  Prettier code style!", exit 0.**

### F4 — WCAG 2.4.11 is claimed in the docs but never checked; sticky headers can hide the focused control

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/decks/[publicId]/index.astro:120, src/components/flashcards/FlashcardWorkspace.tsx:157
- **Detail**: `test-plan.md §7` and `change.md` both cite "WCAG 1.4.11 / 2.4.11" as what
  the measured acceptance check guards. 1.4.11 is contrast and _is_ thoroughly measured.
  **2.4.11 is Focus Not Obscured**, and nothing in this change tests it.

  There are two opaque sticky layers stacked on the deck page —
  `index.astro:120` (`sticky top-0 z-20 h-16`, opaque `#0a0e1a`) and
  `FlashcardWorkspace.tsx:157` (`sticky top-16 z-10`) — over the scroll container at
  `AuthenticatedLayout.astro:43`. There is **no `scroll-margin-*` or `scroll-padding-*`
  anywhere in `src/`**. Tab-driven scroll-into-view aligns the control with the top of
  the scrollport, i.e. underneath both bars: the new white outline is painted and not
  visible. The measurement harness focused controls in place and read computed style, so
  it structurally could not observe this.

  This is genuinely outside what the ticket asked for (the ticket is a contrast defect).
  It is flagged because the change's own documents assert the broader criterion.

- **Fix A ⭐ Recommended**: Drop the `2.4.11` citation from `test-plan.md §7` and
  `verification.md`, keep `1.4.11`, and note Focus-Not-Obscured as explicitly untested
  in `test-plan.md §7`'s negative space.
  - Strength: Makes the documented claim exactly as wide as the evidence — which is the
    standard this change otherwise holds itself to throughout `verification.md`.
  - Tradeoff: Leaves a real (if secondary) a11y gap open with only a note.
  - Confidence: HIGH — no code risk, and it aligns with how §7 already records the
    focus-ring exclusion.
  - Blind spot: None significant.
- **Fix B**: Add `scroll-padding-top` to the scroll container at
  `AuthenticatedLayout.astro:43` (~`4rem`, ~`8rem` inside the workspace) and keep the
  2.4.11 claim.
  - Strength: Actually fixes the obscuring rather than documenting around it; one
    property, no per-control work.
  - Tradeoff: New scope in a change already at four completed phases, and it needs its
    own browser verification to pick the offsets — otherwise it repeats the mistake of
    claiming an unmeasured criterion.
  - Confidence: MEDIUM — the mechanism is standard, but the correct offsets differ per
    surface and were not measured here.
  - Blind spot: Interaction with the modal scroll containers was not examined.
- **Decision**: FIXED via Fix A — `test-plan.md §7` now claims **1.4.11 only** and
  carries a "Citation corrected" note naming Focus Not Obscured as untested negative
  space, with the concrete mechanism (two opaque sticky bars, no `scroll-*` property in
  `src/`) and the one-property fix left explicitly unclaimed. `verification.md`'s
  "48 of 48 pass" verdict gained a "What this verdict is a verdict ABOUT" block naming
  both boundaries — 1.4.11-only, and resting-state-only (which is F1's gap). The
  `change.md` Notes were left alone deliberately: that text is the verbatim Jira ticket,
  a record of what was asked, not a claim this change makes.

### F5 — Collateral edits beyond the phase contracts

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/lessons.md:173, context/foundation/test-plan.md:465,527
- **Detail**: Three items landed outside the contract they belong to. None changes
  behaviour; all are worth naming in a project whose own `lessons.md` carries "Poleruj
  tylko własne komponenty slice'a".
  1. Phase 4 §3 contracted **one** append-only `lessons.md` entry. **Two** were added —
     the contracted "Jeden token focusu zasila DWA mechanizmy…" plus "Pomiar stylu tuż
     po `.focus()` jest NIEŚWIEŻY…". The second is genuinely useful (it records the
     measurement trap that produced a wrong reading in Phase 4) and is in the correct
     Context/Problem/Rule/Applies-to shape, but it is unrequested scope.
  2. Commit `5031d8e` reflowed `roadmap.md` and `test-plan.md` wholesale with Prettier —
     `test-plan.md` alone is 74 added / 51 removed lines, overwhelmingly `*italic*` →
     `_italic_`, table alignment and list spacing unrelated to the focus ring. Two
     code-span continuation lines lost their indentation to column 0
     (`test-plan.md:465` `duplicated\`…`, `test-plan.md:527` `1780488600000\`)…`).
Both still render (CommonMark lazy continuation), so this is source noise, not a
rendering break. The plan's warning against `npm run format` was honoured in effect:
     no file outside the change's own scope was rewritten.
  3. The roadmap H-01 row, the `H-` hardening-prefix paragraph and the `test-plan.md §7`
     focus-ring bullet were committed in **Phase 1** (`8d90543`), whose Changes Required
     lists only `verification.md` and describes itself as "no source changes yet — this
     is the clean baseline". They carried the ticket's _refuted_ cause into two
     foundation documents for three commits, until Phase 4 corrected them exactly as
     contracted. The end state versus `main` is what the plan intended; only the phase
     hygiene drifted.

- **Fix**: Restore the two de-indented continuation lines in `test-plan.md`; leave the
  extra lessons entry (it earns its keep) but note it in the change record.
- **Decision**: PARTIALLY FIXED — and **the de-indentation half of this finding was
  wrong.** Restoring the indentation on `test-plan.md:465,527` was applied, then
  measured, and reverted: `npx prettier <file>` emits those two lines **at column 0**
  under the project's own config, so the indented form fails the formatting gate. This
  is prettier's requirement, not sloppiness by the implementer — an inline code span
  straddles the line break there, and indentation added inside a code span would become
  part of its content. If anyone wants it to read better, the fix is to stop breaking
  the line inside the code span, which is a content edit to `test-plan.md` and outside
  this change. (Two probes were needed to get this right: the first compared against a
  copy outside the repo, where prettier never loaded `.prettierrc.json`, and a `python`
  rewrite converted the whole file to CRLF — both artifacts of the check, not of the
  file. File verified LF-clean and gate green afterwards.)

  The other two parts stand as recorded and need no edit: the second `lessons.md` entry
  is kept deliberately (it documents the `transition`-staleness trap that produced a
  wrong reading in Phase 4 and earns its place), and the Phase-1 commit's roadmap /
  test-plan edits are noted as phase hygiene only — the end state versus `main` is what
  the plan intended.

### F6 — Two element classes are covered by the new universal rule but excluded from the sweep selector

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/focus-ring-a11y/verification.md:410
- **Detail**: The sweep selector is
  `a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])`. The new
  `*:focus-visible` rule applies to every element, and two focusable classes fall
  outside that selector:
  - **`<dialog>` itself** (`Modal.tsx:49`). `ConfirmDeleteModal` and `ConfirmRejectModal`
    render `Modal` with no `autoFocus` descendant (unlike `CreateDeckModal.tsx:74`,
    `CreateFlashcardModal.tsx:97`, `DeckActions.tsx:95`), so `showModal()` focuses the
    dialog element — a 2px white outline around the whole modal.
  - **Focusable scroll containers** (Chrome 127+ makes a scroller with no focusable
    descendants keyboard-focusable): `FlashcardItem.tsx:217`, `CandidateItem.tsx:249`.

  Neither is a regression — both previously took the UA's `outline: auto` coloured by
  `outline-ring/50` — and both have ≥ 20px padding, so the 4px indicator is not clipped.
  The point is narrower: the "165 control-measurements, 0 NONE, 0 BOTH" claim is scoped
  by that selector, and these two classes sit outside it.

- **Fix**: Add one line to `verification.md §Method` recording what the sweep selector
  does not reach, and spot-check the confirm modals once in Chrome.
- **Decision**: FIXED — both classes measured in Chrome (harness calibrated against this
  file first: "Nowa talia" 19.11, "Wyloguj" 17.25, both exact). Results recorded in
  `verification.md` §"Two element classes the sweep selector never reached".
  **The `<dialog>` half of this finding was wrong and the measurement is what showed it**:
  opening the deck's delete-confirm modal leaves `document.activeElement` on the "Anuluj"
  button, not the dialog (`activeIsDialog: false` with `hasAutofocusChild: false`) —
  HTML's dialog focusing steps pick the first focusable descendant, and every modal here
  has buttons. The 19.98:1 the dialog paints is only reachable by focusing it
  deliberately, which nothing does. **The scroll-container half is real**: 30 real `Tab`
  presses land on `FlashcardItem.tsx:217` with `:focus-visible === true`, and it paints
  the shared white outline at **12.69:1** on the `rgb(45,50,66)` card backdrop, unclipped
  (20.8px room vs 4px needed). Both pass; what needed correcting was the claim's scope,
  not the code.

### F7 — `variant="outline"` and `secondary` carry light backgrounds that a white ring cannot sit on

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/ui/button.tsx:16
- **Detail**: `variant="outline"` carries `bg-background`, and `--background` is
  `oklch(1 0 0)` — pure white, because these are the light-theme tokens and `.dark`
  never activates (the same root cause this ticket fixed for `--ring`). All 14 current
  callers override it with `bg-white/10`, so **there is no defect today**. But the white
  ring now silently assumes a dark surface: the first caller that forgets the override
  gets a white button with a white 3px ring flush against it — WCAG 1.4.11 requires
  contrast against the component as well as the backdrop. `variant="secondary"`
  (`oklch(0.97 0 0)`) is unused and has the same shape.
- **Fix**: Add a comment at `buttonVariants` noting that `outline`/`secondary` require a
  background override, because the shared focus ring assumes a dark surface.
- **Decision**: FIXED by aligning the tokens, **after the scope conflict was raised and
  the user reaffirmed**. The plan's "What We're NOT Doing" reserves the wider dead-theme
  cleanup for a separate ticket, and F7 describes a future trap rather than a present
  defect — that was put to the user before any edit, along with the measured blast
  radius, and the direction was confirmed.

  Applied in `global.css` `:root`: `--background` → `oklch(0.145 0 0)` and `--secondary`
  → `oklch(0.269 0 0)`, **each paired with its foreground** (`--foreground` →
  `oklch(0.985 0 0)`, `--secondary-foreground` → `oklch(0.985 0 0)`). Pairing is not
  optional: flipping a surface without its foreground would have produced dark-on-dark
  text — the exact defect class this ticket exists to remove — and `--foreground` reaches
  `body`. Consumers verified first: `--background` feeds only `body` (covered on every
  page by `bg-cosmic`) and `button.tsx`'s `outline` variant (all 14 call sites override
  with `bg-white/10`); `--secondary` feeds only the `secondary` variant, which has zero
  call sites.

  Verified: `npm run lint` ✅, `npm run build` ✅, bundle shows the new values in both
  blocks, `/decks` screenshotted and visually unchanged, and — the regression check that
  matters — the focus indicator re-measured in Chrome at **19.11 / 17.25 / 8.20** for
  "Nowa talia", "Wyloguj" and the banner link, identical to `verification.md`.
