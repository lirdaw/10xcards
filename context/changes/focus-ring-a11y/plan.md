# Global Focus Ring — Implementation Plan

## Overview

Give the app a single focus-indicator system: one ring colour token in
`src/styles/global.css` that feeds **both** mechanisms already present in the
codebase (the `ring-*` box-shadow on the shared primitives, and the
`outline-color` that `@layer base` sets on every element), raised to a value that
clears WCAG 1.4.11's 3:1 against the cosmic surface. Then fold in the three local
patches that grew around the weak default, close the controls that paint no
indicator at all, and prove the result by measuring the running app.

This is a contrast-and-consistency fix, not a repair of the Tailwind 4 ring
configuration. The frame brief refuted that framing three independent ways
(compiled bundle, the reporter's own "przy tab obwódka jest", live-page paint).

## Current State Analysis

The `--ring` token is `oklch(0.708 0 0)` (`src/styles/global.css:25`) — a
light-theme grey — and the app renders permanently dark (`bg-cosmic`,
`global.css:113-115`) because the `dark` variant never activates
(`@custom-variant dark (&:is(.dark *))` at `global.css:4`, and no `.dark` class
exists anywhere in `src/`). Every token therefore resolves to its light value on
a dark surface.

That single token drives two separate mechanisms, which is why the defect is
app-wide:

1. **The shared primitives.** `button.tsx:8`, `input.tsx:12` and `textarea.tsx:11`
   all carry stock shadcn `focus-visible:border-ring focus-visible:ring-ring/50
   focus-visible:ring-[3px]`, and all three also set `outline-none`, so the ring
   is the *only* indicator they have. Measured in-browser: `oklab(0.708 0 0 / 0.5)`
   over the app's real backdrop `rgb(39,44,62)` = **2.43:1**.
2. **Everything else.** `global.css:219` applies `outline-ring/50` to `*`, so the
   same weak token colours the browser's own focus outline on every control that
   is *not* a shared primitive: both `<select>`s (`GeneratorForm.tsx:201,225`),
   the selection checkboxes (`CandidateItem.tsx:214`,
   `CandidateSelectionBar.tsx:49`), the sidebar toggle (`Sidebar.astro:46`), the
   sign-out button (`Topbar.astro:17`, `AuthenticatedLayout.astro:26`) and every
   text link.

Three local patches already work around the weak default, which is the strongest
evidence that the default is the problem:

- `button.tsx:14` — the `destructive` variant overrides with
  `focus-visible:ring-white/80` (~12:1).
- `GeneratorForm.tsx:93` and `StudySession.tsx:58` — a shared `fieldClass`
  constant adds `focus-visible:border-white/40`. Note this constant is applied to
  the two raw `<select>`s as well (`GeneratorForm.tsx:209,232`), not only to
  `Input`/`Textarea`.

A fourth divergence is structural: the auth screens do not use the shared `Input`
at all. `FormField.tsx:6,53` renders a raw `<input>` with `focus:outline-none
focus:ring-2 focus:ring-purple-400` — a different trigger (`focus:` rather than
`focus-visible:`), a different width (2px vs 3px) and a different colour. It
measures **4.97:1** and is, by accident, the only focus ring in the app that
passes. Its `focus:` trigger does violate the ticket's own acceptance criterion
("shown only on `:focus-visible`, not on mouse click").

Finally, one control was found painting no `box-shadow` at all under genuine
keyboard focus: `PasswordToggle.tsx:13`. See "Critical Implementation Details" —
that measurement did not cover `outline`, and the distinction decides how much
work Phase 3 is.

There is no test layer that can carry this. `test-plan.md §7` explicitly excludes
`src/components/ui/` from testing, there is no e2e, and accessibility coverage is
`eslint-plugin-jsx-a11y` at lint level only. The proof is a browser measurement,
which is also the method the frame brief used.

## Desired End State

Every focusable control in the app paints a focus indicator that measures ≥ 3:1
against whatever is actually behind it, driven by one token, with no per-component
focus patches left in `src/`. Verified by re-running the frame brief's measurement
across all four surfaces and recording before/after numbers in
`context/changes/focus-ring-a11y/verification.md`.

Concretely, when this plan is done:

- `--ring` is white in both `:root` and `.dark`, so a future theme toggle cannot
  silently regress the fix.
- `grep -rn "ring-white/80\|focus-visible:border-white/40\|focus:ring-purple-400" src/`
  returns nothing.
- No control appears in `verification.md` with an empty "indicator (after)" cell.
- `AGENTS.md` and `context/foundation/lessons.md` carry the rule that stops the
  next local patch from being written.

### Key Discoveries:

- The ring token feeds **two** mechanisms, not one (`global.css:25` → primitives;
  `global.css:219` → everything else). This is what makes a one-line token change
  a genuinely app-wide fix, and it is not visible from the ticket.
- `--sidebar-ring` (`global.css:38,72` → `--color-sidebar-ring` at `:110`) has
  **zero consumers** in `src/` — no `ring-sidebar-ring` utility is used anywhere.
  It is retuned anyway, because leaving one of two ring tokens at the old value
  recreates exactly the split this change exists to remove.
- "Full alpha" costs two edits beyond the token: the primitives say `ring-ring/50`
  and the base layer says `outline-ring/50`. Retuning the token alone would land
  on white-at-50% (~4.6:1) — the option that was explicitly not chosen.
- `Banner.astro` is the **only light surface in the app**: it renders outside every
  `bg-cosmic` wrapper (`Layout.astro:21-37`), on `#fee2e2` / `#fef3c7` / `#dbeafe`,
  and it contains a link. A white outline there computes to ~1.1:1 — invisible.
  It needs a local exception (Phase 3).
- Enabling `.dark` is **not** the fix and must not be attempted: the frame brief
  measured it moving the ring to 1.87:1, i.e. worse.
- `context/foundation/lessons.md` carries a rule aimed squarely at this kind of
  change ("Poleruj tylko własne komponenty slice'a — zakres sąsiednich rozstrzygaj
  PRZED budową"). The scope below is that up-front decision; anything not listed is
  out, including anything merely adjacent in a file being edited.

## What We're NOT Doing

- **Not enabling `.dark`, and not removing the dead `dark` variant.** The `.dark`
  block gets its ring token aligned (one line) so it cannot become a trap; the
  wider cleanup of a dead theme system is a separate ticket.
- **Not touching the element-selection model.** `CandidateItem.tsx:204`'s
  `ring-1 ring-purple-400/40` marks *selection*, belongs to C10X-16, and stays.
  Phase 4 records a contract for how the two must differ; it implements nothing.
- **Not redesigning the auth screens.** `FormField` keeps its shape, background,
  radius and error colour. Only the trigger and the ring token change.
- **Not adding hover affordance to buttons.** The reporter's hover observation is a
  UX wish, not an a11y defect (frame brief, hypothesis 5) and belongs in its own
  ticket.
- **Not adding an automated contrast test.** Chosen deliberately: a token-level test
  passes green while a control with `outline-none` paints nothing, so it would
  guard the wrong half of the risk.
- **Not styling text links individually.** They inherit the token through
  `global.css:219`; the one exception is the banner, handled locally.
- **Not flipping `roadmap.md`'s Status.** This *is* a roadmap item — H-01
  (`roadmap.md:55,211`), currently `in-progress` — so the earlier framing of it as
  "a Jira bug, not a roadmap slice" was wrong. What stays out is only the Status
  flip and the `## Done` entry, which `lessons.md:170` reserves for `/10x-archive`.
  Correcting H-01's stale Change ID and its refuted Risk text is Outcome-level
  doc-sync and is in scope (Phase 4 §3).

## Implementation Approach

Measure first, change second, sweep third, prove fourth.

Phase 1 exists because the scope of Phase 3 is unknown until the app is measured:
the frame brief read `box-shadow` only, so "paints nothing" is currently a
hypothesis, not a fact, for every control that lacks `outline-none`. Phase 1
converts that into a list.

Phase 2 is the whole "one place" fix and should be a small diff: four token lines,
one base-layer line plus one new base-layer rule that paints the outline instead of
merely recolouring the UA's, three primitives, three patches folded.

Phase 3 closes what the token cannot reach: controls that suppress the outline,
controls on the one light surface, and the auth field's divergent trigger.

Phase 4 re-runs the measurement into the same artifact and writes the rule down so
the next contributor does not re-create the patches Phase 2 just removed.

## Critical Implementation Details

**The `PasswordToggle` uncertainty, and why Phase 1 is still not optional.** The
frame brief reports this control "paints nothing at all under genuine keyboard
focus", but the measurement it cites is `box-shadow: none`. The element carries no
`outline-none` (`PasswordToggle.tsx:13`), so the browser's own focus outline may
well be painting — coloured by `global.css:219`, i.e. weakly. Measure
`outlineStyle`, `outlineWidth`, `outlineColor` and `borderColor` alongside
`boxShadow` for every control, and do not assume Chromium honours `outline-color`
when `outline-style` is `auto` — read what is actually painted.

What that measurement no longer decides is whether the fix works. Phase 2 stops
relying on the UA's `auto` outline and paints an explicit one (`§1`), so a control
that lacks `outline-none` is covered either way. The measurement's job is narrower
and still necessary: it separates controls the explicit outline reaches from those
that suppress it or sit on the light banner, and that split is Phase 3's binding
scope. A control found painting nothing today is not automatically Phase 3 work —
re-check it after Phase 2 lands.

**Ordering.** Phase 2 must land before Phase 3's sweep list is acted on, because
the token change is what removes most candidates from that list.

## Phase 1: Baseline measurement and inventory

### Overview

Measure what every focusable control actually paints today, on all four surfaces,
and turn the result into the binding scope list for Phase 3.

### Changes Required:

#### 1. Verification artifact

**File**: `context/changes/focus-ring-a11y/verification.md` (new)

**Intent**: Record, per control, what the running app paints before the change, so
Phase 4 has something to compare against and a future contributor has numbers
rather than impressions. This is the artifact that replaces an automated test.

**Contract**: One table, one row per control, columns:
`Powierzchnia | Kontrolka (plik:linia) | Wskaźnik PRZED | Kontrast PRZED | Wskaźnik PO | Kontrast PO | ≥3:1`.
The PO columns stay empty until Phase 4. A header block records the method
(dev server, browser, how the backdrop was composited, WCAG relative-luminance
formula) so the numbers are reproducible rather than asserted.

#### 2. Measurement run

**File**: none — this is a browser session against `npm run dev`

**Intent**: Cover all four surfaces the reporter named, not just the public one the
frame brief could reach. Each control is focused by keyboard `Tab` (and, for text
inputs, also by mouse click, since the two differ by specification) and its
computed `boxShadow`, `outlineStyle`, `outlineWidth`, `outlineColor`, `borderColor`
and `borderWidth` are read from the live DOM, with the backdrop composited from
ancestor backgrounds. The border is in that list because on four controls it *is*
today's indicator — `focus-visible:border-ring` on all three primitives, and
`focus-visible:border-white/40` (`GeneratorForm.tsx:93`) as the only focus style
the two `<select>`s have. Omit it and the PRZED column understates what a user
actually sees, which is the one thing this artifact exists to get right.

**Contract**: Surfaces and their controls —

- `/auth/signin` — `FormField` input, `PasswordToggle`, submit `Button`, page links.
- `/decks` and a deck page — deck actions, `CreateDeckModal` / `ConfirmDeleteModal`
  controls, `DeckContentToolbar` search `Input` + submit `Button`, sidebar nav +
  `Sidebar.astro:46` toggle, `AuthenticatedLayout.astro:26` sign-out.
- `/generate` and `/decks/[publicId]/review` — both `<select>`s, count `Input`,
  source `Textarea`, candidate checkboxes, `CandidateSelectionBar` checkbox and
  buttons, the review tab links.
- `/study/[publicId]` — the rating buttons and the `StudySession.tsx:116` `Input`.

Also measure the `Banner.astro` link on its light background — force it by
temporarily unsetting a required env var, or measure the banner rendered on any
page where `missingConfigs` is non-empty.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (no source changes yet — this is the clean baseline)

#### Manual Verification:

- `verification.md` exists with a filled PRZED column for every control listed above
- Every control that paints **no** indicator at all (neither box-shadow nor outline)
  is explicitly marked — this list is Phase 3's scope
- The `PasswordToggle` question is answered with a measurement, not an inference

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 2: One token, one system

### Overview

Retune the ring token so both mechanisms clear 3:1, drop the alpha that would
halve it, and remove the three local patches that exist only because the default
was too weak.

### Changes Required:

#### 1. Ring tokens and the base outline

**File**: `src/styles/global.css`

**Intent**: Make the ring colour white at full strength in every theme block, so a
future `.dark` toggle cannot regress the fix, and stop the base layer from halving
it on everything that is not a shared primitive.

**Contract**: `--ring` → `oklch(1 0 0)` at `:25` (`:root`) and `:59` (`.dark`);
`--sidebar-ring` → the same at `:38` and `:72`. At `:219`, `outline-ring/50` →
`outline-ring`. A comment above the `:root` ring token records the two facts that
are invisible from the declaration: that this token feeds both the primitives'
`ring-*` and the app-wide `outline-color`, and that white is required because the
app is permanently dark (`bg-cosmic`) while these are the light-theme tokens.

Then make the outline **deterministic** rather than only recoloured: add
`*:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }` to the
same `@layer base` block. `global.css:219` sets `outline-color` alone, so today
every non-primitive control depends on the UA painting its own `outline: auto` in
the author's colour — behaviour that varies by browser and version, and which the
app cannot afford to bet its entire "everything else" mechanism on. This rule
removes that dependency without leaving "one place": the primitives are
unaffected, because their `outline-none` sits in `@layer utilities`, which beats
`@layer base` by cascade layer regardless of specificity. Keep `outline-ring`
(the colour) as well — it is what a UA outline still uses on any surface this
rule does not reach.

#### 2. Shared primitives

**File**: `src/components/ui/button.tsx`, `src/components/ui/input.tsx`,
`src/components/ui/textarea.tsx`

**Intent**: Take the ring to full alpha so the token's measured contrast is the
contrast the user sees; drop the destructive variant's local override, which the
new default now matches.

**Contract**: `focus-visible:ring-ring/50` → `focus-visible:ring-ring` in all three
(`button.tsx:8`, `input.tsx:12`, `textarea.tsx:11`). `focus-visible:ring-white/80`
removed from the `destructive` variant (`button.tsx:14`). `focus-visible:border-ring`
stays — with a white token it reinforces the ring rather than competing with it.
`aria-invalid:*` rules are untouched.

#### 3. Fold the two field patches

**File**: `src/components/generate/GeneratorForm.tsx`,
`src/components/study/StudySession.tsx`

**Intent**: Remove the border-based workaround now that the ring itself is visible,
so these two surfaces stop carrying their own focus treatment.

**Contract**: `focus-visible:border-white/40` removed from the `fieldClass`
constant at `GeneratorForm.tsx:93` and `StudySession.tsx:58`; the rest of each
constant (`border-white/20 bg-white/5 text-white placeholder:…`) is unchanged.
Both `<select>`s at `GeneratorForm.tsx:209,232` consume this constant too and
therefore lose their only focus-related style — they must appear in Phase 1's
measurement and, if they end up with no indicator, in Phase 3's sweep.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- No local focus patch remains in the primitives or the two field constants:
  `grep -rn "ring-white/80\|focus-visible:border-white/40" src/` returns nothing
- No `ring-ring/50` or `outline-ring/50` remains: `grep -rn "ring-ring/50\|outline-ring/50" src/` returns nothing

#### Manual Verification:

- The submit button on `/auth/signin` under keyboard `Tab` paints a white ring, and
  a spot measurement puts it comfortably above 3:1 (computed ~13:1 against
  `rgb(39,44,62)`; the authoritative number is Phase 4's measurement)
- The `destructive` button variant looks unchanged from before (the folded patch was
  `white/80`, so this should be visually indistinguishable)
- Mouse-clicking a button still paints **no** ring — the ticket requires
  `:focus-visible` only, and this behaviour must survive the change
- Clicking into the "Szukaj w fiszkach" field still paints a ring (text inputs match
  `:focus-visible` on mouse click by specification) and it is now clearly visible
- What the two generator `<select>`s paint on keyboard focus, now that their border
  patch is gone, is **recorded** in `verification.md` — a nothing here is a legal
  outcome that adds them to Phase 3's scope list, not a failed gate (the study count
  field is an `Input` primitive and rings regardless)
- The new base-layer outline is not clipped by an ancestor: keyboard-focus a raw
  control inside `AuthenticatedLayout.astro:20` and one inside a `flashcard-panel`
  (both set `overflow: hidden`) and confirm the full ring is visible on all four
  sides — if `outline-offset: 2px` is cut off, drop the offset to `0`

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 3: Sweep — auth field and controls with no indicator

### Overview

Close what the token cannot reach: the auth field's divergent trigger, the one
light surface in the app, and whichever controls Phase 1 proved paint nothing.

### Changes Required:

#### 1. Auth field trigger and colour

**File**: `src/components/auth/FormField.tsx`

**Intent**: Fold the third focus system into the shared one without redesigning the
auth screens — the field keeps its background, radius, padding and icon layout.
The `focus:` → `focus-visible:` switch is what makes this surface comply with the
ticket's "not on mouse click" criterion; for a text input the visible behaviour
barely changes, because browsers match `:focus-visible` on click for text fields.

**Contract**: In `inputBase` (`:6`), `focus:outline-none` → `focus-visible:outline-none`
and `focus:ring-2` → `focus-visible:ring-2`. At `:53`, `focus:ring-purple-400` →
`focus-visible:ring-ring` (the shared token); the error branch keeps a semantic red
but moves to the same trigger: `focus:ring-red-400` → `focus-visible:ring-red-400`.
Ring width stays 2px here — the shared *colour* and *trigger* are what unify the
system; matching the primitives' 3px would change the auth layout, which is out of
scope.

#### 2. The one light surface

**File**: `src/components/Banner.astro`

**Intent**: Keep the banner's link visible. The banner renders outside every
`bg-cosmic` wrapper on a light background, where the now-white global outline
computes to roughly 1.1:1.

**Contract**: A rule in the component's scoped `<style>` giving the banner's links a
focus outline in the banner's own foreground colour, which is dark by construction
in all three variants (`#1e3a8a` / `#78350f` / `#7f1d1d`) and therefore contrasts
strongly with each variant's light background. Concretely:
`.banner :global(a:focus-visible) { outline: 2px solid currentColor; outline-offset: 2px; }`.

The `:global()` is load-bearing, not stylistic. The link is slotted in from
`Layout.astro:29`, so it is not part of `Banner.astro`'s own template and Astro's
scoping never reaches it — `.banner a:focus-visible` would compile to a
`[data-astro-cid-…]` selector and match nothing, silently. This is exactly why the
existing colour rule is already written `.banner :global(a)` (`Banner.astro:22`).
`currentColor` is what keeps the outline in step with all three variants without
branching, since `color: inherit` is already set there.

Scope the exception to the banner —
do not add a light-surface branch to `global.css`, since the banner is the only such
surface and a global branch would imply a light theme the app does not have.

#### 3. Controls with no indicator

**File**: whichever files Phase 1's inventory named — candidates, none of them
confirmed until measured: `src/components/auth/PasswordToggle.tsx:13`,
`src/components/Sidebar.astro:46`, `src/components/generate/GeneratorForm.tsx:201,225`
(the two `<select>`s), `src/components/review/CandidateItem.tsx:214` and
`src/components/review/CandidateSelectionBar.tsx:49` (checkboxes)

**Intent**: Give each control that paints nothing the shared indicator, and nothing
else. This is the WCAG 2.4.7 half of the defect — a harder failure than the contrast
one that was originally filed.

**Contract**: Add `focus-visible:ring-ring focus-visible:ring-[3px]` (or, for a
control whose layout cannot carry a ring, an equivalent `focus-visible:outline`
using the same token) to the control's own class list. Do **not** restyle, resize,
recolour or restructure anything else in these files while editing them —
`lessons.md` records what opportunistic polish on shared components cost this
project once already. If Phase 1 found a control's existing indicator adequate after
Phase 2, it is not touched.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- The last local focus patch is gone: `grep -rn "focus:ring-purple-400" src/` returns nothing
- No `focus:` focus-styling trigger survives in `src/` (only `focus-visible:`):
  `grep -rn "focus:ring\|focus:outline\|focus:border" src/` returns nothing
- Test suite still green (guards against an accidental edit outside the focus
  surface): `npm run db:start` then `npm test`

#### Manual Verification:

- Every control on Phase 1's "no indicator" list now paints one under keyboard `Tab`
- The auth field's ring appears on keyboard focus and on mouse click (expected for a
  text input) and is the shared colour, while the auth screens are otherwise visually
  unchanged
- An auth field showing a validation error still rings red, not white
- The banner link, focused by keyboard, is clearly visible on the light banner
- No control gained a second, competing indicator

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 4: Proof and durability

### Overview

Re-measure into the same artifact, record the contract that keeps focus
distinguishable from selection, and write down the rule that prevents the next
local patch.

### Changes Required:

#### 1. Post-change measurement

**File**: `context/changes/focus-ring-a11y/verification.md`

**Intent**: Fill the PO columns using exactly the method Phase 1 used, so the
before/after comparison is like-for-like and the ≥3:1 claim is measured rather than
computed from tokens.

**Contract**: Same table, same rows, PO columns filled, plus a short verdict line
naming any row that still fails and why. A control that changed category (e.g. from
"no indicator" to "ring") is called out explicitly.

#### 2. Focus-vs-selection contract

**File**: `context/changes/focus-ring-a11y/verification.md` (short section) —
implement nothing

**Intent**: The review card already carries a purple `ring-1` for *selection*
(`CandidateItem.tsx:204`) and now also receives a white focus ring. Record how the
two must stay distinguishable so C10X-16 inherits a decision instead of a collision.

**Contract**: Focus = white, full alpha, outer, transient. Selection = purple,
translucent, inner, persistent. Binding on C10X-16 unless that ticket deliberately
supersedes it. Note that this plan does not verify the two rendering together on one
card beyond a visual check, because the selection model is out of scope.

#### 3. Durable rule

**File**: `AGENTS.md`, `context/foundation/lessons.md`,
`context/foundation/roadmap.md`, `context/foundation/test-plan.md`

**Intent**: Stop the next contributor re-creating the patches Phase 2 removed. The
three folded patches all existed because nothing wrote the rule down. And stop the
two foundation documents a contributor actually opens from carrying a cause this
change disproved, under a change-id that resolves to no folder on disk.

**Contract**: `AGENTS.md` gains one line under Conventions: the focus indicator comes
from the shared ring token only; never add a per-component `focus-visible:ring-*`
override, and never suppress the outline without replacing it. `lessons.md` gains an
append-only entry in the file's existing shape (Context / Problem / Rule / Applies
to) recording the specific trap: one token feeds two mechanisms (`ring-*` on the
primitives and `outline-color` on `*`), so retuning it fixes the whole app — and
conversely, a local patch hides the systemic defect instead of fixing it.

`roadmap.md` H-01 gets two Outcome-level corrections and **no Status change**:
`Change ID: bug-focus-ring-a11y` → `focus-ring-a11y` (`:211`), and the Risk field's
suspected cause ("konfiguracja ring w Tailwind 4 … `ring-*` nie mapuje się na
realny box-shadow") replaced by the measured one — light-theme tokens on a
permanently dark surface, plus one control with no indicator at all. `test-plan.md`
§7's focus-ring bullet gets the same correction to its parenthetical and its dead
`context/changes/bug-focus-ring-a11y/` path. Status → done and the `## Done` entry
stay with `/10x-archive` (`lessons.md:170`).

#### 4. Change bookkeeping

**File**: `context/changes/focus-ring-a11y/change.md`

**Intent**: Reflect the delivered state.

**Contract**: `updated:` set to the completion date. `status:` advanced per the
change-folder convention. Do **not** flip H-01's Status in `roadmap.md` — its text
corrections belong to §3 above, but the Status → done flip and the `## Done` entry
are `/10x-archive`'s alone (`lessons.md:170`).

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- Formatting is clean: `npx prettier --check .` — **not** `npm run format`, which is
  `prettier --write .` (it always exits 0 and would rewrite files this change never
  touched)

#### Manual Verification:

- Every row in `verification.md` has a PO measurement and none is below 3:1
- No row has an empty "indicator (after)" cell
- The focus-vs-selection section is present and unambiguous
- `AGENTS.md` and `lessons.md` entries are readable by someone with no context on
  this ticket
- `roadmap.md` H-01 names the real change-id and the measured cause, `test-plan.md`
  §7 no longer points at a folder that does not exist, and H-01's Status is still
  `in-progress`

**Implementation Note**: This is the final phase — after manual confirmation, the
change is ready for `/10x-impl-review`.

---

## Testing Strategy

### Unit Tests:

None. `test-plan.md §7` excludes `src/components/ui/` from testing as vendored
library surface, and a token-level contrast assertion was considered and rejected
during planning: it passes green while a control with `outline-none` paints
nothing, so it would guard the wrong half of the risk.

### Integration Tests:

None added. The existing suite is run once in Phase 3 as a regression guard — its
job here is only to prove that editing shared components did not break behaviour
elsewhere, not to cover the focus ring.

### Manual Testing Steps:

1. `npm run dev`, open `/auth/signin`, `Tab` through every control and confirm each
   one paints a visible white indicator.
2. Click the same controls with the mouse: buttons must paint **nothing**, text
   inputs must paint a ring. This asymmetry is the specified behaviour and the
   ticket's own acceptance criterion.
3. Sign in and repeat on `/decks` (including the create/delete modals and the
   sidebar in both expanded and collapsed states), `/generate`,
   `/decks/[publicId]/review` and `/study/[publicId]`.
4. Trigger a validation error on an auth field and confirm the ring goes red.
5. Force a config banner and confirm its link's focus indicator is visible on the
   light background.
6. On the review screen, select a candidate and then keyboard-focus it — confirm the
   selection ring and the focus ring are distinguishable.

## Performance Considerations

None. The change is CSS-token and class-list only; no new selectors run at
interaction time and no JavaScript is added.

## Migration Notes

None — no schema, no data, no deployment step beyond the ordinary build. Rollback is
a straight revert of the CSS token and the touched class lists.

## References

- Frame brief: `context/changes/focus-ring-a11y/frame.md` — measured evidence,
  refutation of the original framing, and the `.dark` trap
- Change identity: `context/changes/focus-ring-a11y/change.md` (Jira C10X-22)
- Scope discipline rule: `context/foundation/lessons.md` — "Poleruj tylko własne
  komponenty slice'a — zakres sąsiednich rozstrzygaj PRZED budową"
- Roadmap-status ownership: `context/foundation/lessons.md` — "/10x-archive owns the
  roadmap Status → done flip"
- Testing exclusions: `context/foundation/test-plan.md §7`
- Related research: none (`research.md` not present for this change)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Baseline measurement and inventory

#### Automated

- [x] 1.1 `npm run lint` passes on the clean baseline — 8d90543

#### Manual

- [x] 1.2 `verification.md` exists with a filled PRZED column for every listed control — 8d90543
- [x] 1.3 Controls painting no indicator at all are explicitly marked (Phase 3 scope) — 8d90543
- [x] 1.4 The `PasswordToggle` question is answered by measurement, not inference — 8d90543

### Phase 2: One token, one system

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — e3d841f
- [x] 2.2 Production build succeeds: `npm run build` — e3d841f
- [x] 2.3 `grep -rn "ring-white/80\|focus-visible:border-white/40" src/` returns nothing — e3d841f
- [x] 2.4 `grep -rn "ring-ring/50\|outline-ring/50" src/` returns nothing — e3d841f

#### Manual

- [x] 2.5 Sign-in submit button paints a white ring under `Tab`, spot-measured above 3:1 — e3d841f
- [x] 2.6 `destructive` button variant is visually unchanged — e3d841f
- [x] 2.7 Mouse-clicking a button still paints no ring — e3d841f
- [x] 2.8 Mouse-clicking a text input still paints a ring, now clearly visible — e3d841f
- [x] 2.9 What the two generator `<select>`s now paint is recorded; nothing → they join Phase 3's scope — e3d841f
- [x] 2.10 The base-layer outline is not clipped inside an `overflow-hidden` ancestor — e3d841f

### Phase 3: Sweep — auth field and controls with no indicator

#### Automated

- [x] 3.1 Linting passes: `npm run lint`
- [x] 3.2 Production build succeeds: `npm run build`
- [x] 3.3 `grep -rn "focus:ring-purple-400" src/` returns nothing
- [x] 3.4 `grep -rn "focus:ring\|focus:outline\|focus:border" src/` returns nothing
- [x] 3.5 Test suite green: `npm run db:start` then `npm test`

#### Manual

- [x] 3.6 Every control on Phase 1's "no indicator" list now paints one under `Tab`
- [x] 3.7 Auth field uses the shared colour and trigger; auth screens otherwise unchanged
- [x] 3.8 An auth field in error state still rings red
- [x] 3.9 Banner link's focus indicator is visible on the light banner
- [x] 3.10 No control gained a second, competing indicator

### Phase 4: Proof and durability

#### Automated

- [ ] 4.1 Linting passes: `npm run lint`
- [ ] 4.2 Production build succeeds: `npm run build`
- [ ] 4.3 Formatting is clean: `npx prettier --check .`

#### Manual

- [ ] 4.4 Every row in `verification.md` has a PO measurement, none below 3:1
- [ ] 4.5 No row has an empty "indicator (after)" cell
- [ ] 4.6 Focus-vs-selection contract section is present and unambiguous
- [ ] 4.7 `AGENTS.md` and `lessons.md` entries are readable without ticket context
- [ ] 4.8 `roadmap.md` H-01 change-id + cause corrected, `test-plan.md` §7 path fixed, Status untouched
