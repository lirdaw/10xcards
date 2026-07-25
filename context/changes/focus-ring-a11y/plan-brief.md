# Global Focus Ring — Plan Brief

> Full plan: `context/changes/focus-ring-a11y/plan.md`
> Frame brief: `context/changes/focus-ring-a11y/frame.md`

## What & Why

The app has no single focus-indicator system. The shared primitives paint a ring
measuring **2.43:1** (below WCAG 1.4.11's 3:1), the auth screens paint a different,
passing ring via a hand-rolled field, and at least one keyboard-focusable control
paints nothing at all. The root cause of the weak default is that light-theme
tokens are used on a permanently dark UI.

The originally filed cause — a broken Tailwind 4 `ring` configuration — was refuted
by the frame brief three independent ways. Nothing is broken in the ring
configuration; what survives is a contrast-and-consistency defect plus one outright
missing indicator, which is a harder failure (WCAG 2.4.7) than the one filed.

## Starting Point

`--ring` is a light-theme grey (`global.css:25`) on a permanently dark surface,
because the `dark` variant never activates. That one token drives **two** separate
mechanisms: the `ring-*` box-shadow on `button`/`input`/`textarea`, and the
`outline-color` that `@layer base` applies to `*` — which is what every raw control
(both `<select>`s, the checkboxes, the sidebar toggle, every link) relies on. Three
local patches already work around the weak default, and the auth screens bypass the
primitives entirely with their own purple `focus:` ring.

## Desired End State

Every focusable control paints an indicator measuring ≥ 3:1 against whatever is
actually behind it, driven by one white token, with no per-component focus patch
left in `src/`. The auth screens look the same but stop being a separate system.
Before/after numbers, measured in the running app, live in `verification.md`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Root cause | Contrast + consistency, not ring config | Refuted three ways: compiled bundle, the reporter's own Tab observation, live-page paint | Frame |
| `.dark` is not the remedy | Excluded | Enabling it measures 1.87:1 — worse than today | Frame |
| Hover affordance | Out of scope | A UX wish, not an a11y defect; its own ticket | Frame |
| Mechanism | Retune the `--ring` token | One token already feeds both mechanisms, so it fixes primitives *and* every raw control without editing their files | Plan |
| Ring colour | White, full alpha | Only colour with margin on **all** cosmic surfaces (~13:1); already proven locally by `ring-white/80` | Plan |
| Auth field | Keeps its look; shared trigger + token | Kills the divergence that matters (trigger, contrast) without redesigning auth screens | Plan |
| Sweep scope | Primitives + controls with no indicator | Closes the WCAG 2.4.7 half; links inherit from the token for free | Plan |
| Proof | Browser measurement + artifact | Measures what is painted, so a control with `outline-none` cannot pass silently | Plan |
| Dead `.dark` block | Ring token aligned, block kept | One line disarms the regression trap; removing the dead theme is a separate ticket | Plan |
| Durability | `AGENTS.md` + `lessons.md` entry | The three folded patches exist precisely because no one wrote the rule down | Plan |
| Focus vs selection | Contract recorded, nothing implemented | C10X-16 owns selection; the collision risk is real and gets a decision, not code | Plan |

## Scope

**In scope:** ring tokens in `global.css` (`:root` and `.dark`); the base-layer
outline colour; `button`/`input`/`textarea` primitives; folding three local patches
(`ring-white/80`, two `border-white/40`); `FormField`'s trigger and colour; controls
proved to paint nothing; the banner's light-surface exception; measurement artifact;
`AGENTS.md` + `lessons.md`.

**Out of scope:** enabling or removing the `dark` variant; the selection model
(C10X-16); redesigning auth screens; button hover affordance; automated contrast
tests; per-link focus styling; `roadmap.md`.

## Architecture / Approach

One token in `global.css` feeds two mechanisms that between them reach every
focusable element:

```
--ring (white)
  ├─ ring-ring          → focus box-shadow on button / input / textarea
  └─ outline-ring on *  → focus outline on everything else
                          (selects, checkboxes, sidebar, links, sign-out)
```

Two things escape that reach and are handled locally: controls that suppress the
outline without replacing it, and `Banner.astro` — the app's only light surface,
where a white outline would be invisible.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Baseline measurement | `verification.md` PRZED column + the binding "no indicator" list | Three of four surfaces need a signed-in account |
| 2. One token, one system | White token in all theme blocks, full alpha, three patches folded | Removing the field patch leaves the two `<select>`s with no focus style of their own |
| 3. Sweep | Auth trigger, banner exception, controls that paint nothing | Editing components from four different slices invites out-of-scope polish |
| 4. Proof and durability | PO measurements, focus↔selection contract, AGENTS + lessons | — |

**Prerequisites:** running dev server, a signed-in test account, local Supabase
stack for Phase 3's regression run.
**Estimated effort:** ~2 sessions; Phase 2 is a small diff, Phases 1 and 4 are
measurement work.

## Open Risks & Assumptions

- **Phase 3's size is unknown until Phase 1 runs.** The frame brief read
  `box-shadow` only, so "paints nothing" is a hypothesis for every control lacking
  `outline-none`. If the browser's own outline is present, the token change fixes a
  dozen controls for free and Phase 3 nearly vanishes.
- **Chromium's handling of `outline-color` under `outline-style: auto` is not
  assumed.** Phase 1 reads what is painted rather than reasoning about it.
- **Editing shared components across four slices is exactly the scope-creep pattern
  `lessons.md` warns about.** The plan's "not doing" list is the up-front decision
  that rule demands.
- **`--sidebar-ring` has no consumers today.** It is retuned anyway so the two ring
  tokens cannot diverge.

## Success Criteria (Summary)

- A keyboard user sees a clearly visible indicator on every control, on every screen.
- A mouse user still sees no ring on buttons — the ticket's own criterion.
- No focus patch survives in `src/`, and the rule preventing the next one is written
  into `AGENTS.md` and `lessons.md`.
