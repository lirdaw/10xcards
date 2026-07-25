# Focus indicator — measured verification (C10X-22)

> Baseline (PRZED) measured 2026-07-25, Phase 1. The PO columns are filled by
> Phase 4 using **exactly** the method below, so the before/after comparison is
> like-for-like. This artifact is what stands in for an automated test: the
> project has no e2e / visual-diff layer and `test-plan.md §7` names focus-ring
> rendering as deliberately untested.

## Method

- **App under test**: `npm run dev` (Astro 6 on workerd), `http://localhost:4326`,
  signed in as a local Supabase account. `OPENROUTER_API_KEY` is unset, so the
  config `Banner` renders on every page — which is how the one light surface in
  the app was reachable without touching env vars.
- **Browser**: Chrome (Claude-in-Chrome), viewport 1692 × 1559 CSS px, DPR 1.25.
- **Focus modality**: a real `Tab` keypress is issued on each page first, so the
  browser is in keyboard modality; every control is then focused in sequence and
  `el.matches(':focus-visible')` is **recorded per control**. Every row below was
  captured with `:focus-visible === true` — a row measured under a broken
  modality chain reports no indicator and would be invalid, so this flag is the
  gate, not a footnote.
- **What is read**: `--tw-ring-shadow` / `--tw-ring-color` (the ring), plus
  `outlineStyle` / `outlineWidth` / `outlineColor` / `outlineOffset`, plus
  `borderTopColor` / `borderTopWidth` compared against the same element's
  **blurred** values. The border is included because on the primitives
  (`focus-visible:border-ring`) and on the two generator `<select>`s
  (`focus-visible:border-white/40`, `GeneratorForm.tsx:93`) it is a real part of
  what the user sees today; omitting it would understate the PRZED column.
- **Colour resolution**: every colour string (`oklch()`, `oklab()`,
  `color-mix()`) is resolved to sRGB by painting it into a 1 × 1 canvas and
  reading the pixel back — no hand-conversion, so `color-mix(in oklab, …)` and
  alpha are handled by the browser itself.
- **Backdrop**: composited from the live DOM by walking the element's ancestor
  chain outside-in, alpha-compositing each `background-color` and sampling each
  `linear-gradient` at the element's own vertical position (this is what resolves
  `bg-cosmic`). Contrast is WCAG relative luminance,
  `(L1 + 0.05) / (L2 + 0.05)`, between the indicator composited over that
  backdrop and the backdrop itself.

### Three measurement traps, recorded so the Phase 4 re-run does not fall into them

1. **`getComputedStyle(el).boxShadow` is unreliable here.** The tab runs with
   `document.visibilityState === "hidden"`, so no animation frames are served,
   and Tailwind 4's ring travels through `@property`-registered custom properties
   whose substitution into `box-shadow` only lands on the next rendering
   opportunity. A programmatically focused control therefore reads
   `oklab(0 0 0 / 0) 0px 0px 0px 0px` — "no ring" — while the paint has one
   (confirmed by screenshot on `DeckActions.tsx:56`). The custom property
   `--tw-ring-shadow` updates synchronously and correctly, and is what this
   measurement reads. A real `Tab` press also forces the update; the two agree
   (`oklab(0.708 0 0 / 0.5)`, 3px, on the same control).
2. **`outline-style: auto` — Chromium DOES honour the author's `outline-color`,
   and does NOT honour `outline-width`.** Verified with a controlled probe: a
   `div` with `outline-style: auto; outline-color: red; outline-width: 8px`
   paints a **red** ring at the UA's own hairline width, next to a reference
   `outline: 8px solid green` that paints 8px. So `global.css:219`
   (`outline-ring/50`) genuinely colours every non-primitive control today — the
   plan's warning not to assume is resolved in the *favourable* direction — but
   the app has no control over the painted width until an explicit `outline` is
   declared (Phase 2 §1). Computed `outline-width` reads `0.8px` for `auto` and
   is not the painted value.
3. **A control measured while `:focus-visible` is false shows nothing.** That is
   the spec, not a defect. Rows with `fv=false` were discarded and re-measured.

### Scope note

Every measurement below is under **keyboard** focus. The mouse-click asymmetry
(a `<button>` clicked with the mouse matches `:focus` but not `:focus-visible`
and paints nothing; a text `<input>` clicked with the mouse does match and paints
its ring) is not re-measured here — it was measured with real clicks in
`frame.md` (2026-07-25) and it is Phase 2's manual verification item. Synthetic
clicks did not land reliably in this harness, so nothing about click behaviour is
asserted from it.

Not measured, deliberately: `CreateFlashcardModal` / `ConfirmRejectModal` and the
`FlashcardItem` inline editor. They are built from the same `Input`, `Textarea`
and `Button` primitives with the same class lists as rows already in the table,
so they carry those rows' numbers. If Phase 2 changes a primitive, it changes
them too.

## Baseline vs. post-change

`ring` = `box-shadow` ring from the Tailwind ring utilities.
`outline:auto` = the browser's own focus outline, coloured by `global.css:219`.
`border` = `border-color` change on focus (a real, if thin, second indicator).

| Powierzchnia | Kontrolka (plik:linia) | Wskaźnik PRZED | Kontrast PRZED | Wskaźnik PO | Kontrast PO | ≥3:1 |
| --- | --- | --- | --- | --- | --- | --- |
| `/auth/signin` | Banner link — `Banner.astro:22` (slot from `Layout.astro:29`) | outline:auto `oklab(0.708 0 0 / 0.5)` | **1.42** (vs `#fee2e2`) | | | ❌ |
| `/auth/signin` | e-mail field — `FormField.tsx:42-54,53` | ring 2px `oklch(0.714 0.203 305.504)` | **4.93** | | | ✅ |
| `/auth/signin` | password field — `FormField.tsx:42-54,53` | ring 2px `oklch(0.714 0.203 305.504)` | **4.93** | | | ✅ |
| `/auth/signin` | show/hide password — `PasswordToggle.tsx:13` | outline:auto `oklab(0.708 0 0 / 0.5)` | **2.44** | | | ❌ |
| `/auth/signin` | "Sign in" submit — `button.tsx:8` | ring 3px `ring/50` | **2.45** | | | ❌ |
| `/auth/signin` | "Sign up" link — `pages/auth/signin.astro` | outline:auto `oklab(0.708 0 0 / 0.5)` | **2.45** | | | ❌ |
| `/decks` | "Wyloguj" — `AuthenticatedLayout.astro:26` | outline:auto | **2.66** | | | ❌ |
| `/decks` | wordmark link — `Sidebar.astro:41` | outline:auto | **2.66** | | | ❌ |
| `/decks` | rail toggle — `Sidebar.astro:46` | outline:auto | **2.66** | | | ❌ |
| `/decks` | nav links ×3 — `Sidebar.astro:75` | outline:auto | **2.65** | | | ❌ |
| `/decks` | "Nowa talia" — `button.tsx:8` | ring 3px `ring/50` + border `oklch(0.708 0 0)` 0.8px | **2.70** / border 7.40 | | | ❌ |
| `/decks` | deck card link — `pages/decks/index.astro:51` | outline:auto | **2.51** | | | ❌ |
| `/decks` | "N do przeglądu" link — `pages/decks/index.astro:58` | outline:auto | **2.49** | | | ❌ |
| `/decks` (modal) | `#deck-name` — `CreateDeckModal.tsx:65` (`input.tsx:12`) | ring 3px `ring/50` + border 0.8px | **2.68** / border 7.01 | | | ❌ |
| `/decks` (modal) | "Anuluj" — `CreateDeckModal.tsx:89` | ring 3px `ring/50` + border 0.8px | **2.68** / border 7.01 | | | ❌ |
| `/decks` (modal) | "Utwórz" — `CreateDeckModal.tsx:92` | ring 3px `ring/50` + border 0.8px | **2.68** / border 7.01 | | | ❌ |
| deck page | "Wróć do talii" — `decks/[publicId]/index.astro:104` | outline:auto | **2.68** | | | ❌ |
| deck page | "Zmień nazwę" — `DeckActions.tsx:56` | ring 3px `ring/50` + border 0.8px | **2.68** / border 7.01 | | | ❌ |
| deck page | "Usuń" (destructive) — `DeckActions.tsx:66` (`button.tsx:14`) | ring 3px `#fff` @80% | **11.77** | | | ✅ |
| deck page | `#deck-search` — `DeckContentToolbar.tsx:39` | ring 3px `ring/50` + border 0.8px | **2.70** / border 7.19 | | | ❌ |
| deck page | "Szukaj" — `DeckContentToolbar.tsx:49` | ring 3px `ring/50` + border 0.8px | **2.70** / border 7.19 | | | ❌ |
| deck page | "Dodaj fiszkę" — `DeckContentToolbar.tsx:65` | ring 3px `ring/50` + border 0.8px | **2.70** / border 7.19 | | | ❌ |
| deck page | "Przegląd / odrzucone" — `FlashcardWorkspace.tsx:179` | outline:auto | **2.70** | | | ❌ |
| deck page | card "Edytuj" — `FlashcardItem.tsx:241` | ring 3px `ring/50` + border 0.8px | **2.35** / border 4.92 | | | ❌ |
| deck page | card "Odrzuć" — `FlashcardItem.tsx:250` | ring 3px `ring/50` + border 0.8px | **2.35** / border 4.92 | | | ❌ |
| deck page | card "Usuń" (destructive) — `FlashcardItem.tsx:254` | ring 3px `#fff` @80% | **8.74** | | | ✅ |
| deck page (modal) | "Anuluj" — `DeckActions.tsx:132` | ring 3px `ring/50` + border 0.8px | **2.68** / border 7.01 | | | ❌ |
| deck page (modal) | "Usuń" (destructive) — `DeckActions.tsx:142` | ring 3px `#fff` @80% | **11.77** | | | ✅ |
| `/generate` | `select#gen-deck` — `GeneratorForm.tsx:201` | outline:auto + border `white/40` 0.8px | **2.70** / border **3.81** | | | ❌ |
| `/generate` | `select#gen-language` — `GeneratorForm.tsx:225` | outline:auto + border `white/40` 0.8px | **2.70** / border **3.81** | | | ❌ |
| `/generate` | `#gen-count` — `GeneratorForm.tsx:245` | ring 3px `ring/50` + border `white/40` | **2.70** / border 3.81 | | | ❌ |
| `/generate` | `#gen-source` textarea — `GeneratorForm.tsx:284` | ring 3px `ring/50` + border `white/40` | **2.70** / border 3.81 | | | ❌ |
| `/generate` | "Generuj" submit — `button.tsx:8` | ring 3px `ring/50` (border-ring computed, width 0 → not painted) | **2.69** | | | ❌ |
| review | "Wróć do talii" — `decks/[publicId]/review.astro:135` | outline:auto | **2.70** | | | ❌ |
| review | "Do przeglądu" tab — `review.astro:172` | outline:auto | **2.70** | | | ❌ |
| review | "Odrzucone" tab — `review.astro:175` | outline:auto | **2.70** | | | ❌ |
| review | candidate checkbox — `CandidateItem.tsx:214` **and** `CandidateSelectionBar.tsx:49` (identical class lists) | outline:auto, offset 1.6px | **2.66** | | | ❌ |
| review | bar "Akceptuj (N)" — `CandidateSelectionBar.tsx` | ring 3px `ring/50` | **2.66** | | | ❌ |
| review | bar "Odrzuć (N)" — `CandidateSelectionBar.tsx` | ring 3px `ring/50` | **2.66** | | | ❌ |
| review | bar "Wyczyść" — `CandidateSelectionBar.tsx:80` | ring 3px `ring/50` | **2.66** | | | ❌ |
| review | card "Akceptuj" — `CandidateItem.tsx:260-287` | ring 3px `ring/50` | **2.34** | | | ❌ |
| review | card "Odrzuć" — `CandidateItem.tsx:260-287` | ring 3px `ring/50` | **2.34** | | | ❌ |
| review | card "Edytuj" — `CandidateItem.tsx:287` | ring 3px `ring/50` | **2.34** | | | ❌ |
| study | "Wróć do wyboru talii" — `pages/study/[publicId].astro:53` | outline:auto | **2.70** | | | ❌ |
| study | `#session-size` — `StudySession.tsx:105,116` | ring 3px `ring/50` + border `white/40` | **2.65** / border 3.78 | | | ❌ |
| study | "Zapisz" — `StudySession.tsx:127` | ring 3px `ring/50` + border 0.8px | **2.65** / border 6.57 | | | ❌ |
| study | "Pokaż odpowiedź" — `StudySession.tsx:268` | ring 3px `ring/50` (border width 0 → not painted) | **2.70** | | | ❌ |
| study | rating buttons ×4 — `StudySession.tsx:27` (GRADES) | ring 3px `ring/50` + border 0.8px | **2.69** / border 7.17 | | | ❌ |

## Findings that bind later phases

### 1. No control paints nothing. Phase 3 §3's scope list is EMPTY.

This is the inventory Phase 3 §3 was waiting on, and the answer is that it has no
work to do. Every focusable control in the app paints *some* indicator under
keyboard focus: the shared primitives paint their `ring-*`, and every control
that is not a primitive — the two `<select>`s, both checkboxes, the sidebar
toggle and its links, "Wyloguj", every text link — gets the browser's own
`outline: auto`, coloured by `global.css:219`. Nothing was found in the state the
plan listed as candidates.

The plan's candidate list is therefore resolved as follows, and none of these
files needs an added class:

| Candidate from the plan | Measured today | Phase 3 §3 action |
| --- | --- | --- |
| `PasswordToggle.tsx:13` | outline:auto @ 2.44 | none — reached by the token |
| `Sidebar.astro:46` | outline:auto @ 2.66 | none |
| `GeneratorForm.tsx:201,225` (`<select>`s) | outline:auto @ 2.70 **plus** `border-white/40` @ 3.81 | none — see §3 below |
| `CandidateItem.tsx:214` (checkbox) | outline:auto @ 2.66 | none |
| `CandidateSelectionBar.tsx:49` (checkbox) | outline:auto @ 2.66 | none |

What is left for Phase 3 is exactly what the plan already scoped independently of
this measurement: the auth field's trigger and colour (§1) and the light-surface
banner exception (§2).

### 2. The `PasswordToggle` question, answered by measurement

`frame.md` reported this control "paints nothing at all under genuine keyboard
focus". That reading was `box-shadow: none` — correct as far as it goes, and
incomplete. The element carries no `outline-none`, so the browser paints its own
outline, coloured by `global.css:219` to `oklab(0.708 0 0 / 0.5)`: **2.44:1**.

So this is not a WCAG 2.4.7 "no indicator" failure. It is the same 1.4.11
contrast failure as everything else, from the same token — which means it is
fixed by Phase 2 and does not need its own patch. The harder failure the plan
braced for does not exist.

Because this reverses `frame.md`, it was re-checked independently rather than
left resting on the harness: four real `Tab` presses from a fresh page load land
on this control with `:focus-visible === true`, `box-shadow: none` (exactly what
the brief saw), `outline-style: auto`, `outline-color: oklab(0.708 0 0 / 0.5)`,
`outline-offset: 0px` — and a zoomed screenshot of the focused control shows the
ring painted around the icon. Both halves agree: no box-shadow, real outline.

### 3. The two `<select>`s are the app's only controls whose focus style passes today by accident

They are the only place where `focus-visible:border-white/40`
(`GeneratorForm.tsx:93`) is the *whole* focus treatment, and it measures
**3.81:1** — above the bar. Phase 2 §3 removes that class. After it lands they
keep `outline: auto` at whatever the retuned token gives (white → far above 3:1),
so removing the patch is safe — but this is the one row where the PO measurement
is not a formality, and Phase 2's manual item 2.9 exists precisely for it.

### 4. `focus-visible:border-ring` is a second, high-contrast indicator on the primitives — and it is 0.8px

Every `Button` / `Input` / `Textarea` also flips its border to full-alpha
`oklch(0.708 0 0)`, measuring 4.9–7.4:1. This is real and belongs in the PRZED
column, but it is not a reason to call the primitives compliant: it is a hairline
(0.8px computed), it is the *resting* border being recoloured rather than an area
being added, and on two controls ("Generuj", "Pokaż odpowiedź") the border width
is `0`, so the recolour paints nothing at all. The 3px ring is the indicator that
has to carry 1.4.11, and it is at 2.3–2.7:1 app-wide.

### 5. The destructive variant is the proof that the fix works

`focus-visible:ring-white/80` (`button.tsx:14`) measures **8.7–11.8:1** on the
same backdrops where the default ring measures 2.3–2.7:1 — same geometry, same
mechanism, only the colour differs. Phase 2 folds this patch away by making the
default match it; these three rows are the control that says the target value is
achievable without changing anything structural.

### 6. Backdrops are consistent, so one token is genuinely enough

Every dark surface measured lands between `rgb(11,15,28)` and `rgb(46,51,67)` —
the widest spread is the flashcard/candidate card at `rgb(45,50,67)`, which is
why those rows read 2.34 rather than 2.70. A single white token clears 3:1 on all
of them with a wide margin. The one exception is the banner at `#fee2e2`, and it
is the only light surface in the app — which is what makes Phase 3 §2 a local
exception rather than the start of a light theme.

## Verdict (PRZED)

43 of 48 rows fail the 3:1 bar. The 5 that pass are: the three `destructive`
buttons (`ring-white/80`) and the two auth fields (`ring-purple-400`) — i.e.
exactly the two local patches the plan set out to fold in. Nothing passes through
the shared default.

Counted mechanically from the table above (48 data rows, 7 columns each, no empty
PRZED cell, no PO cell filled yet), not by eye — the first hand count of this
line said 44/4 and was wrong, because the auth field is two rows.

<!-- Phase 4 fills the PO columns, the verdict below, and the focus-vs-selection
     contract section. Do not restructure the table; the row order is the
     like-for-like key. -->

## Verdict (PO)

_Filled by Phase 4._

## Focus vs. selection contract

_Filled by Phase 4._
