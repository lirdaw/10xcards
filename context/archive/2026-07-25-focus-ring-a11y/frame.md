# Frame Brief: Global focus ring on shared controls

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.
>
> Status: reframed **and verified in-browser** (2026-07-25). Every contrast number
> below is measured off the running app, not computed from tokens.

## Reported Observation

The focus ring on form controls (input / button) is barely visible, especially on
the dark background; the reporter states it affects the whole app rather than a
single view, and that `focus-visible:ring-[3px]` on `@/components/ui/input`
"produces no box-shadow".

## Initial Framing (preserved)

- **User's stated cause or approach**: the Tailwind 4 `ring` configuration in
  `src/styles/global.css` is missing the required variables/utilities, so `ring-*`
  never maps to a real `box-shadow`. (The ticket itself hedges: "Do zbadania".)
- **User's proposed direction**: investigate and fix the `ring` configuration
  globally, in one place, rather than patching per view.
- **Pre-dispatch narrowing**: the reporter clarified the observation — buttons were
  observed **on hover** ("najeżdżam na buttony i lekko zmieniają kolor, nie mają
  obwódki"), the focus was entered **with the mouse**, and critically: **"przy tab
  obwódka jest"** — with keyboard Tab the ring IS present. Scope reported as all
  four surfaces (auth forms, deck/card modals, AI generator + candidate review,
  buttons/sidebar/study).

## Dimension Map

The observation could originate at any of these dimensions:

1. **Ring utility compilation** — Tailwind 4 fails to emit a real `box-shadow` for
   `ring-[3px]` / `ring-ring/50`. ← initial framing
2. **`:focus-visible` activation semantics** — the ring is gated behind
   `:focus-visible`, which browsers do NOT match for a mouse click on a `<button>`;
   hover never matches it at all.
3. **Ring colour token contrast** — the ring renders, but `--ring` at 50% alpha is
   too weak against this app's dark background.
4. **Dead `dark` variant** — the app renders dark (`bg-cosmic`) while the `dark`
   variant never activates, so every token resolves to its **light**-theme value.
5. **Hover affordance on buttons** — a separate expectation about the cursor state.
6. **Divergent focus systems per surface** — _added during verification_: not every
   control routes through the shared primitives at all.

## Hypothesis Investigation

Investigated inline (no sub-agents — per the operator's standing rule; the surface is
a handful of files), then verified in a running browser. Evidence is from this repo
and this app, with file:line.

| Hypothesis                                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Verdict                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1. Ring utility does not compile to a box-shadow (initial framing) | Built CSS `dist/client/_astro/Layout._MFHaibd.css` carries `.focus-visible\:ring-\[3px\]:focus-visible{--tw-ring-shadow:… 0 0 0 calc(3px + …) var(--tw-ring-color…);box-shadow:…}` and `.focus-visible\:ring-ring\/50:focus-visible{--tw-ring-color:color-mix(in oklab, var(--ring) 50%, transparent)}`; bundle (2026-07-25 14:34) is newer than all sources (≤ 2026-07-11). **In-browser**: the Sign-in submit button under real Tab focus paints `oklab(0.708 0 0 / 0.5) 0px 0px 0px 3px`.                                                                            | **NONE** (refuted three ways)                  |
| 2. `:focus-visible` semantics explain what was seen                | `input.tsx:12`, `button.tsx:8`, `textarea.tsx:11` gate on `focus-visible:`. **Measured in-browser**: `<button>` clicked with the mouse → `:focus` true, `:focus-visible` **false**, `box-shadow: none`. Text `<input>` clicked with the mouse → `:focus-visible` **true**, ring painted.                                                                                                                                                                                                                                                                                | **STRONG**                                     |
| 3. Ring colour contrast is below the a11y bar                      | Token `:root --ring: oklch(0.708 0 0)` (`global.css:25`) at 50% alpha. **Measured**: ring colour `oklab(0.708 0 0 / 0.5)` over the app's real backdrop `rgb(39,44,62)` (card over `bg-cosmic`, read from the live DOM) = **2.43:1** — below the 3:1 of WCAG 1.4.11 and of the ticket's own criterion. At full alpha the same hue would give ~7:1, so the `/50` is what destroys it.                                                                                                                                                                                     | **STRONG**                                     |
| 4. `dark` variant is dead app-wide                                 | `@custom-variant dark (&:is(.dark *))` (`global.css:4`) needs a `.dark` ancestor; **live DOM**: `documentElement.className === ""`, `body.className === ""`; grep over `src/` finds no `dark` class. So `.dark`'s `--ring: oklch(0.556 0 0)` (`global.css:59`) never applies and `dark:` utilities (`input.tsx:13`, `button.tsx:16`) are inert. Corroborating oddity: `body` is painted **white** (`--background: oklch(1 0 0)`, `global.css:8,221-223`) and is only hidden by inner `bg-cosmic` wrappers. Trap: enabling `.dark` moves the ring to **1.87:1** — worse. | **STRONG** (systemic cause + trap for the fix) |
| 5. Hover affordance                                                | Buttons carry colour-shift hovers only (`button.tsx:12,17,18`). Real as a UX wish, not the focus indicator.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **WEAK** (separate concern)                    |
| 6. Divergent focus systems                                         | **Measured**: the auth fields are NOT the shared `Input` — `FormField.tsx:42-54` renders a raw `<input>` with `focus:outline-none focus:ring-2` + `focus:ring-purple-400`, painting `oklch(0.714 0.203 305.504)` 2px = **4.97:1 (passes)**, on plain `:focus` so it also shows on mouse click. Meanwhile the show/hide toggle (`PasswordToggle`, first `<button>` in that field) paints **nothing at all** under genuine keyboard focus (`:focus-visible` true, `box-shadow: none`).                                                                                    | **STRONG** (found only by verifying)           |

## Verification (in-browser, measured 2026-07-25)

Run against `npm run dev` on `/auth/signin` (public, same `bg-cosmic` surface and the
same shared primitives). Colours read from the live page; backdrop composited from the
live DOM; contrast per WCAG relative luminance.

| Control                                                     | Focus indicator actually painted  | Contrast vs real backdrop | 3:1                      |
| ----------------------------------------------------------- | --------------------------------- | ------------------------- | ------------------------ |
| Submit button — shared `Button`                             | `oklab(0.708 0 0 / 0.5)`, 3px     | **2.43:1**                | ❌                       |
| Auth email/password field — raw `<input>` (`FormField.tsx`) | `oklch(0.714 0.203 305.504)`, 2px | **4.97:1**                | ✅                       |
| Show/hide toggle inside the field                           | **none**                          | n/a                       | ❌ (no indicator at all) |

Interaction semantics, measured rather than assumed:

- `<button>` + mouse click → `:focus-visible` **false**, nothing painted. This is the
  specified behaviour and is exactly what the reporter saw.
- text `<input>` + mouse click → `:focus-visible` **true**, ring painted. So the
  "Szukaj w fiszkach" field (`DeckContentToolbar.tsx:38`, shared `Input`) _does_ get a
  ring when clicked — a 2.43:1 grey one, i.e. present but too weak to notice. **The
  sixth-dimension risk this brief flagged before verification is closed: there is no
  hidden defect there, only the contrast one.**

## Narrowing Signals

- **"Przy tab obwódka jest"** — a ring that appears on keyboard focus cannot be a ring
  that fails to compile. This alone refuted the initial framing.
- **The observation was made on hover / mouse click** — the one mode in which a button
  is _supposed_ to show no ring.
- **All four surfaces reported equally affected** — consistent with a token-level
  property, not a per-view defect.
- **Two components already patched around the weak default**: `button.tsx:14`
  (`focus-visible:ring-white/80`, ~12:1) and `GeneratorForm.tsx:93` /
  `StudySession.tsx:58` (`focus-visible:border-white/40`).
- **The auth surface bypasses the primitives entirely** and, by accident, is the only
  place whose focus ring passes 3:1.

## Cross-System Convention

The primitives are stock shadcn/ui (`focus-visible:border-ring
focus-visible:ring-ring/50 focus-visible:ring-[3px]`), whose `--ring` values assume a
`.dark` class toggles the token set. This project kept the primitives and the token
file but built a permanently-dark UI without ever setting `.dark`, so it runs the
light-theme tokens on a dark surface. Separately, the auth screens grew their own
hand-rolled field with a different trigger (`focus:` vs `focus-visible:`), a different
width (2px vs 3px) and a different colour (purple vs grey) — so the app currently has
**three** focus treatments plus one control with none. No prior change in
`context/archive/` or `context/changes/` touches focus rings (grep: no hits).

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the app has no single focus-indicator
> system — the shared primitives paint a ring measuring **2.43:1** (below the required
> 3:1), the auth screens paint a different, passing ring via a hand-rolled field, and
> at least one keyboard-focusable control paints **nothing at all**. The root cause of
> the weak default is that light-theme tokens are used on a permanently dark UI.

The initial framing was **not** confirmed: nothing is broken in the Tailwind 4 `ring`
configuration, and the utility emits a real `box-shadow` — verified in the compiled
bundle and again in the live page. What the reporter saw on hover / mouse click is the
specified behaviour of `:focus-visible`, and is precisely what the ticket's own
acceptance criterion demands. What survives is a **contrast and consistency** defect —
plus one outright **missing** indicator, which is a harder failure (WCAG 2.4.7) than
the one originally filed.

Two things the plan must not assume: (a) enabling `.dark` is **not** the fix — it drops
the ring to 1.87:1; (b) the hover half of the report is a UX wish, not an a11y defect,
and belongs in its own ticket.

## Confidence

**HIGH** — measured, not inferred. The refutation rests on three independent sources
(compiled CSS, the reporter's Tab observation, live-page paint), and every contrast
figure comes from colours and backdrops read out of the running app.

Residual scope note, not a confidence caveat: verification ran on `/auth/signin`
because it is public. The authenticated surfaces (deck workspace, generator, review,
study) reuse the same primitives, so the 2.43:1 figure carries; a control there with a
**missing** indicator (like the show/hide toggle found here) would not have been seen
and should be swept during implementation.

## What Changes for /10x-plan

Plan a **single focus-indicator system**, not a repair of the ring configuration:
(1) raise the shared primitives' ring to ≥ 3:1 against the dark surface in one place;
(2) fold in the three existing local overrides so the app stops carrying per-component
patches; (3) sweep for controls with **no** indicator (`PasswordToggle` is a confirmed
case) and give them the shared one; (4) decide whether the auth fields keep their own
purple `focus:` ring or adopt the shared `focus-visible:` one — that is a real design
choice, since the two differ in trigger, width and colour. Do not include enabling the
`dark` class as the remedy; treat button hover affordance as out of scope.

## References

- Source files: `src/styles/global.css:4,8,25,59,113-115,217-223`,
  `src/components/ui/input.tsx:11-13`, `src/components/ui/button.tsx:8,14,16`,
  `src/components/ui/textarea.tsx:11`, `src/layouts/Layout.astro:14,21`,
  `src/components/auth/FormField.tsx:5-6,42-54`,
  `src/components/auth/PasswordToggle.tsx`,
  `src/components/flashcards/DeckContentToolbar.tsx:38-46`,
  `src/components/generate/GeneratorForm.tsx:93`,
  `src/components/study/StudySession.tsx:58`
- Compiled evidence: `dist/client/_astro/Layout._MFHaibd.css` (built 2026-07-25 14:34,
  newer than all sources above)
- In-browser verification: `npm run dev` → `/auth/signin`, Chrome; keyboard Tab and
  real mouse clicks; colours and backdrop read from the live DOM
- Related research: none (`research.md` not present for this change)
- Investigation tasks: none registered — investigated inline without sub-agents, per the
  operator's standing rule against dispatching agents unrequested
- Jira: C10X-22
