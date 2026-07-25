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
   plan's warning not to assume is resolved in the _favourable_ direction — but
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

| Powierzchnia      | Kontrolka (plik:linia)                                                                                      | Wskaźnik PRZED                                                   | Kontrast PRZED             | Wskaźnik PO                                         | Kontrast PO                                          | ≥3:1 |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------- | --------------------------------------------------- | ---------------------------------------------------- | ---- |
| `/auth/signin`    | Banner link — `Banner.astro:22` (slot from `Layout.astro:29`)                                               | outline:auto `oklab(0.708 0 0 / 0.5)`                            | **1.42** (vs `#fee2e2`)    | outline solid 2px `currentColor` = `rgb(127,29,29)` | **8.20**                                             | ✅   |
| `/auth/signin`    | e-mail field — `FormField.tsx:42-54,53`                                                                     | ring 2px `oklch(0.714 0.203 305.504)`                            | **4.93**                   | ring 2px `oklch(1 0 0)`                             | **13.78**                                            | ✅   |
| `/auth/signin`    | password field — `FormField.tsx:42-54,53`                                                                   | ring 2px `oklch(0.714 0.203 305.504)`                            | **4.93**                   | ring 2px `oklch(1 0 0)`                             | **13.76**                                            | ✅   |
| `/auth/signin`    | show/hide password — `PasswordToggle.tsx:13`                                                                | outline:auto `oklab(0.708 0 0 / 0.5)`                            | **2.44**                   | outline solid 2px `oklch(1 0 0)`                    | **13.76**                                            | ✅   |
| `/auth/signin`    | "Sign in" submit — `button.tsx:8`                                                                           | ring 3px `ring/50`                                               | **2.45**                   | ring 3px `oklch(1 0 0)` + border                    | **13.86** / border 13.86                             | ✅   |
| `/auth/signin`    | "Sign up" link — `pages/auth/signin.astro`                                                                  | outline:auto `oklab(0.708 0 0 / 0.5)`                            | **2.45**                   | outline solid 2px                                   | **13.93**                                            | ✅   |
| `/decks`          | "Wyloguj" — `AuthenticatedLayout.astro:26`                                                                  | outline:auto                                                     | **2.66**                   | outline solid 2px                                   | **17.25**                                            | ✅   |
| `/decks`          | wordmark link — `Sidebar.astro:41`                                                                          | outline:auto                                                     | **2.66**                   | outline solid 2px                                   | **17.12**                                            | ✅   |
| `/decks`          | rail toggle — `Sidebar.astro:46`                                                                            | outline:auto                                                     | **2.66**                   | outline solid 2px                                   | **17.12**                                            | ✅   |
| `/decks`          | nav links ×3 — `Sidebar.astro:75`                                                                           | outline:auto                                                     | **2.65**                   | outline solid 2px                                   | **16.88–17.03**                                      | ✅   |
| `/decks`          | "Nowa talia" — `button.tsx:8`                                                                               | ring 3px `ring/50` + border `oklch(0.708 0 0)` 0.8px             | **2.70** / border 7.40     | ring 3px `oklch(1 0 0)` + border                    | **19.11** / border 19.11                             | ✅   |
| `/decks`          | deck card link — `pages/decks/index.astro:51`                                                               | outline:auto                                                     | **2.51**                   | outline solid 2px                                   | **13.70–14.88**                                      | ✅   |
| `/decks`          | "N do przeglądu" link — `pages/decks/index.astro:58`                                                        | outline:auto                                                     | **2.49**                   | outline solid 2px                                   | **13.70–14.88**                                      | ✅   |
| `/decks` (modal)  | `#deck-name` — `CreateDeckModal.tsx:65` (`input.tsx:12`)                                                    | ring 3px `ring/50` + border 0.8px                                | **2.68** / border 7.01     | ring 3px + border                                   | **18.11** / border 18.11                             | ✅   |
| `/decks` (modal)  | "Anuluj" — `CreateDeckModal.tsx:89`                                                                         | ring 3px `ring/50` + border 0.8px                                | **2.68** / border 7.01     | ring 3px + border                                   | **18.11** / border 18.11                             | ✅   |
| `/decks` (modal)  | "Utwórz" — `CreateDeckModal.tsx:92`                                                                         | ring 3px `ring/50` + border 0.8px                                | **2.68** / border 7.01     | ring 3px + border                                   | **18.11** / border 18.11                             | ✅   |
| deck page         | "Wróć do talii" — `decks/[publicId]/index.astro:104`                                                        | outline:auto                                                     | **2.68**                   | outline solid 2px                                   | **18.11**                                            | ✅   |
| deck page         | "Zmień nazwę" — `DeckActions.tsx:56`                                                                        | ring 3px `ring/50` + border 0.8px                                | **2.68** / border 7.01     | ring 3px + border                                   | **18.11** / border 18.11                             | ✅   |
| deck page         | "Usuń" (destructive) — `DeckActions.tsx:66` (`button.tsx:14`)                                               | ring 3px `#fff` @80%                                             | **11.77**                  | ring 3px `oklch(1 0 0)` + border                    | **18.11** / border 18.11                             | ✅   |
| deck page         | `#deck-search` — `DeckContentToolbar.tsx:39`                                                                | ring 3px `ring/50` + border 0.8px                                | **2.70** / border 7.19     | ring 3px + border                                   | **18.58** / border 18.58                             | ✅   |
| deck page         | "Szukaj" — `DeckContentToolbar.tsx:49`                                                                      | ring 3px `ring/50` + border 0.8px                                | **2.70** / border 7.19     | ring 3px + border                                   | **18.58** / border 18.58                             | ✅   |
| deck page         | "Dodaj fiszkę" — `DeckContentToolbar.tsx:65`                                                                | ring 3px `ring/50` + border 0.8px                                | **2.70** / border 7.19     | ring 3px + border                                   | **18.58** / border 18.58                             | ✅   |
| deck page         | "Przegląd / odrzucone" — `FlashcardWorkspace.tsx:179`                                                       | outline:auto                                                     | **2.70**                   | outline solid 2px                                   | **18.70**                                            | ✅   |
| deck page         | card "Edytuj" — `FlashcardItem.tsx:241`                                                                     | ring 3px `ring/50` + border 0.8px                                | **2.35** / border 4.92     | ring 3px + border                                   | **12.70** / border 12.70                             | ✅   |
| deck page         | card "Odrzuć" — `FlashcardItem.tsx:250`                                                                     | ring 3px `ring/50` + border 0.8px                                | **2.35** / border 4.92     | ring 3px + border                                   | **12.70** / border 12.70                             | ✅   |
| deck page         | card "Usuń" (destructive) — `FlashcardItem.tsx:254`                                                         | ring 3px `#fff` @80%                                             | **8.74**                   | ring 3px `oklch(1 0 0)` + border                    | **12.70** / border 12.70                             | ✅   |
| deck page (modal) | "Anuluj" — `DeckActions.tsx:132`                                                                            | ring 3px `ring/50` + border 0.8px                                | **2.68** / border 7.01     | ring 3px + border                                   | **18.11** / border 18.11                             | ✅   |
| deck page (modal) | "Usuń" (destructive) — `DeckActions.tsx:142`                                                                | ring 3px `#fff` @80%                                             | **11.77**                  | ring 3px `oklch(1 0 0)` + border                    | **18.11** / border 18.11                             | ✅   |
| `/generate`       | `select#gen-deck` — `GeneratorForm.tsx:201`                                                                 | outline:auto + border `white/40` 0.8px                           | **2.70** / border **3.81** | outline solid 2px (border no longer flips)          | **18.95**                                            | ✅   |
| `/generate`       | `select#gen-language` — `GeneratorForm.tsx:225`                                                             | outline:auto + border `white/40` 0.8px                           | **2.70** / border **3.81** | outline solid 2px (border no longer flips)          | **18.95**                                            | ✅   |
| `/generate`       | `#gen-count` — `GeneratorForm.tsx:245`                                                                      | ring 3px `ring/50` + border `white/40`                           | **2.70** / border 3.81     | ring 3px + border `oklch(1 0 0)`                    | **18.95** / border 18.95                             | ✅   |
| `/generate`       | `#gen-source` textarea — `GeneratorForm.tsx:284`                                                            | ring 3px `ring/50` + border `white/40`                           | **2.70** / border 3.81     | ring 3px + border `oklch(1 0 0)`                    | **18.72** / border 18.72                             | ✅   |
| `/generate`       | "Generuj" submit — `button.tsx:8`                                                                           | ring 3px `ring/50` (border-ring computed, width 0 → not painted) | **2.69**                   | ring 3px (border width still 0)                     | **18.47**                                            | ✅   |
| review            | "Wróć do talii" — `decks/[publicId]/review.astro:135`                                                       | outline:auto                                                     | **2.70**                   | outline solid 2px                                   | **19.11**                                            | ✅   |
| review            | "Do przeglądu" tab — `review.astro:172`                                                                     | outline:auto                                                     | **2.70**                   | outline solid 2px                                   | **19.04**                                            | ✅   |
| review            | "Odrzucone" tab — `review.astro:175`                                                                        | outline:auto                                                     | **2.70**                   | outline solid 2px                                   | **19.04**                                            | ✅   |
| review            | candidate checkbox — `CandidateItem.tsx:214` **and** `CandidateSelectionBar.tsx:49` (identical class lists) | outline:auto, offset 1.6px                                       | **2.66**                   | outline solid 2px, offset 2px                       | karta **13.29** (13.17 zaznaczona) / pasek **17.85** | ✅   |
| review            | bar "Akceptuj (N)" — `CandidateSelectionBar.tsx`                                                            | ring 3px `ring/50`                                               | **2.66**                   | ring 3px + border                                   | **17.85** / border 17.85                             | ✅   |
| review            | bar "Odrzuć (N)" — `CandidateSelectionBar.tsx`                                                              | ring 3px `ring/50`                                               | **2.66**                   | ring 3px + border                                   | **17.85** / border 17.85                             | ✅   |
| review            | bar "Wyczyść" — `CandidateSelectionBar.tsx:80`                                                              | ring 3px `ring/50`                                               | **2.66**                   | ring 3px + border                                   | **17.85** / border 17.85                             | ✅   |
| review            | card "Akceptuj" — `CandidateItem.tsx:260-287`                                                               | ring 3px `ring/50`                                               | **2.34**                   | ring 3px + border                                   | **12.56** / border 12.56                             | ✅   |
| review            | card "Odrzuć" — `CandidateItem.tsx:260-287`                                                                 | ring 3px `ring/50`                                               | **2.34**                   | ring 3px + border                                   | **12.56** / border 12.56                             | ✅   |
| review            | card "Edytuj" — `CandidateItem.tsx:287`                                                                     | ring 3px `ring/50`                                               | **2.34**                   | ring 3px + border                                   | **12.56** / border 12.56                             | ✅   |
| study             | "Wróć do wyboru talii" — `pages/study/[publicId].astro:53`                                                  | outline:auto                                                     | **2.70**                   | outline solid 2px                                   | **19.11**                                            | ✅   |
| study             | `#session-size` — `StudySession.tsx:105,116`                                                                | ring 3px `ring/50` + border `white/40`                           | **2.65** / border 3.78     | ring 3px + border `oklch(1 0 0)`                    | **16.98** / border 16.98                             | ✅   |
| study             | "Zapisz" — `StudySession.tsx:127`                                                                           | ring 3px `ring/50` + border 0.8px                                | **2.65** / border 6.57     | ring 3px + border                                   | **16.98** / border 16.98                             | ✅   |
| study             | "Pokaż odpowiedź" — `StudySession.tsx:268`                                                                  | ring 3px `ring/50` (border width 0 → not painted)                | **2.70**                   | ring 3px (border width still 0)                     | **18.67**                                            | ✅   |
| study             | rating buttons ×4 — `StudySession.tsx:27` (GRADES)                                                          | ring 3px `ring/50` + border 0.8px                                | **2.69** / border 7.17     | ring 3px + border                                   | **18.54** / border 18.54                             | ✅   |

## Findings that bind later phases

### 1. No control paints nothing. Phase 3 §3's scope list is EMPTY.

This is the inventory Phase 3 §3 was waiting on, and the answer is that it has no
work to do. Every focusable control in the app paints _some_ indicator under
keyboard focus: the shared primitives paint their `ring-*`, and every control
that is not a primitive — the two `<select>`s, both checkboxes, the sidebar
toggle and its links, "Wyloguj", every text link — gets the browser's own
`outline: auto`, coloured by `global.css:219`. Nothing was found in the state the
plan listed as candidates.

The plan's candidate list is therefore resolved as follows, and none of these
files needs an added class:

| Candidate from the plan                   | Measured today                                        | Phase 3 §3 action           |
| ----------------------------------------- | ----------------------------------------------------- | --------------------------- |
| `PasswordToggle.tsx:13`                   | outline:auto @ 2.44                                   | none — reached by the token |
| `Sidebar.astro:46`                        | outline:auto @ 2.66                                   | none                        |
| `GeneratorForm.tsx:201,225` (`<select>`s) | outline:auto @ 2.70 **plus** `border-white/40` @ 3.81 | none — see §3 below         |
| `CandidateItem.tsx:214` (checkbox)        | outline:auto @ 2.66                                   | none                        |
| `CandidateSelectionBar.tsx:49` (checkbox) | outline:auto @ 2.66                                   | none                        |

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
(`GeneratorForm.tsx:93`) is the _whole_ focus treatment, and it measures
**3.81:1** — above the bar. Phase 2 §3 removes that class. After it lands they
keep `outline: auto` at whatever the retuned token gives (white → far above 3:1),
so removing the patch is safe — but this is the one row where the PO measurement
is not a formality, and Phase 2's manual item 2.9 exists precisely for it.

### 4. `focus-visible:border-ring` is a second, high-contrast indicator on the primitives — and it is 0.8px

Every `Button` / `Input` / `Textarea` also flips its border to full-alpha
`oklch(0.708 0 0)`, measuring 4.9–7.4:1. This is real and belongs in the PRZED
column, but it is not a reason to call the primitives compliant: it is a hairline
(0.8px computed), it is the _resting_ border being recoloured rather than an area
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

## Phase 2 spot-check (2026-07-25) — NOT the Phase 4 re-run

Recorded here because Phase 2's manual item 2.9 requires it. This is a **spot
check on four surfaces**, not the like-for-like re-run: the PO columns above stay
empty until Phase 4 walks every row with the same harness. Method identical to
§Method; measured on `npm run dev` at `http://localhost:4327`, keyboard modality
established by a real `Tab` per page, `:focus-visible === true` on every row.

| Kontrolka                                       | PRZED                           | Phase 2 spot-check                                  | Δ               |
| ----------------------------------------------- | ------------------------------- | --------------------------------------------------- | --------------- |
| „Sign in" submit — `button.tsx:8`               | ring 2.45                       | ring `oklch(1 0 0)` **13.85**                       | ✅              |
| show/hide password — `PasswordToggle.tsx:13`    | outline:auto 2.44               | outline solid 2px **13.76**                         | ✅              |
| „Sign up" link                                  | outline:auto 2.45               | **13.92**                                           | ✅              |
| „Wyloguj" — `AuthenticatedLayout.astro:26`      | outline:auto 2.66               | **17.25**                                           | ✅              |
| „Usuń" (destructive) — `DeckActions.tsx:66`     | ring `#fff`@80% 11.77           | ring `oklch(1 0 0)` **18.11**                       | ✅              |
| `#deck-search` — `DeckContentToolbar.tsx:39`    | ring 2.70                       | ring **18.58**                                      | ✅              |
| `select#gen-deck` — `GeneratorForm.tsx:201`     | outline:auto 2.70 + border 3.81 | outline solid 2px **18.95**, border no longer flips | ✅              |
| `select#gen-language` — `GeneratorForm.tsx:225` | outline:auto 2.70 + border 3.81 | outline solid 2px **18.95**, border no longer flips | ✅              |
| `#gen-count` — `GeneratorForm.tsx:245`          | ring 2.70 + border 3.81         | ring **18.95**                                      | ✅              |
| Banner link — `Banner.astro:22`                 | 1.42 (vs `#fee2e2`)             | **1.22**                                            | ❌ — Phase 3 §2 |

### The three things this spot-check settles

1. **Finding §3 is resolved in the safe direction.** The two `<select>`s were the
   only controls passing today by accident (`focus-visible:border-white/40` at
   3.81). Phase 2 §3 removed that class — confirmed, their border is now identical
   focused and blurred (`white/20` both ways) — and the explicit base-layer outline
   replaced it at **18.95**. They do **not** join Phase 3's scope.
2. **The outline is `solid`, not `auto`.** Every non-primitive now reports
   `outline-style: solid`, so trap §2's "Chromium ignores the author's
   outline-width on `auto`" no longer applies — the app controls the painted width.
   The primitives still report `outline-style: none` and carry their `ring`, which
   is the cascade-layer split Phase 2 §1 relied on, observed rather than assumed.
3. **Nothing is clipped (item 2.10), so `outline-offset: 2px` stays.** Swept all 62
   focusable controls on `/decks` plus the deck page: **0 clipped**. The nearest
   `overflow: hidden` ancestor leaves a minimum of **20.8px** where the indicator
   needs 3.2px. A controlled probe pins the mechanic — a control flush to such an
   ancestor's edge (room 0) _is_ clipped, one inset by 4px is not — so the zero here
   is a measured margin, not an absence of risk.

The banner remains the single failing surface, at the value Phase 3 §2 was written
for. No control paints nothing.

## Phase 3 spot-check (2026-07-25) — NOT the Phase 4 re-run

Same status as the Phase 2 block above: evidence for Phase 3's own manual gate, not
the like-for-like re-run. Method identical to §Method; `npm run dev` at
`http://localhost:4328`, keyboard modality established by a real `Tab` per page,
`:focus-visible === true` on every row. Only the two surfaces Phase 3 edited are
covered — `FormField` and the banner.

| Kontrolka                           | PRZED                                           | Phase 3 spot-check                                           | Δ                 |
| ----------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ | ----------------- |
| Banner link — `Banner.astro:22`     | outline:auto `ring/50` **1.42** (Phase 2: 1.22) | outline solid 2px `currentColor` = `rgb(127,29,29)` **8.20** | ✅                |
| e-mail field — `FormField.tsx:53`   | ring 2px `purple-400` 4.93                      | ring 2px `oklch(1 0 0)` **13.71**                            | ✅                |
| password field — `FormField.tsx:53` | ring 2px `purple-400` 4.93                      | ring 2px `oklch(1 0 0)` **13.71**                            | ✅                |
| e-mail field, **error** state       | ring 2px `red-400` (not measured in Phase 1)    | ring 2px `oklch(70.4% 0.191 22.216)` **4.80**                | ✅ red, not white |
| password field, **error** state     | —                                               | ring 2px `red-400` **4.75**                                  | ✅ red, not white |

### What this settles

1. **The banner exception works, and it is the variant's own foreground.** The
   measured outline colour is `rgb(127,29,29)` — `#7f1d1d`, the `banner--error`
   `color` — so `currentColor` resolves per variant as intended and needs no
   branch. A zoomed screenshot of the focused link shows the dark ring painted on
   the pink background. This was the single failing row after Phase 2; it now
   measures 8.20:1.
2. **The auth field joined the shared system without losing its click ring.** A
   **real** mouse click (not synthetic) on the e-mail field reports
   `:focus-visible === true` and paints the ring — the behaviour the plan predicted
   for text inputs, and the reason the `focus:` → `focus-visible:` switch is safe
   here. Its `outline-style` is `none`, so `focus-visible:outline-none` still beats
   the new base-layer outline: one indicator, not two.
3. **The error branch still rings red.** Only the trigger moved; the semantic red
   is unchanged and measures 4.75–4.80:1.

Nothing else was edited in Phase 3 — §3's scope list was empty (Finding §1 above),
and the Phase 2 spot-check re-confirmed each of the plan's five candidates.

### Full-app sweep (items 3.6 and 3.10)

Because §3's scope list was empty, "every control on the no-indicator list now
paints one" cannot be checked by walking a list — there is no list. It was checked
the other way round instead: **every focusable control on every surface** was
focused in sequence and classified as `ring` / `outline` / `NONE` / `BOTH`, where
`BOTH` means a ring _and_ an outline paint together (item 3.10's "second, competing
indicator"). Selector:
`a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])`, filtered to
visible and enabled. Keyboard modality re-established with a real `Tab` per page.

| Surface                           | Controls | ring | outline | NONE | BOTH | min           | max   |
| --------------------------------- | -------- | ---- | ------- | ---- | ---- | ------------- | ----- |
| `/auth/signin`                    | 6        | 3    | 3       | 0    | 0    | 8.20 (banner) | 13.71 |
| `/decks` (sidebar expanded)       | 62       | 1    | 61      | 0    | 0    | 8.20 (banner) | 19.10 |
| `/decks` (sidebar collapsed)      | 61       | 1    | 60      | 0    | 0    | 8.20 (banner) | 19.10 |
| `/decks` + `CreateDeckModal`      | 3        | 3    | 0       | 0    | 0    | 18.11         | 18.11 |
| deck page                         | 23       | 14   | 9       | 0    | 0    | 8.20 (banner) | 18.64 |
| `/generate`                       | 12       | 3    | 9       | 0    | 0    | 8.20 (banner) | 18.97 |
| review                            | 34       | 18   | 16      | 0    | 0    | 8.20 (banner) | 19.10 |
| study (session + answer revealed) | 14       | 6    | 8       | 0    | 0    | 8.20 (banner) | 19.10 |

**Zero `NONE`, zero `BOTH`, and `:focus-visible === true` on every row.** On every
dark surface the lowest reading is the flashcard/candidate card at 12.4–12.7 (the
`rgb(45,50,67)` backdrop Finding §6 predicted would be the worst case); the app-wide
minimum is the banner link at 8.20, which is the light surface Phase 3 §2 fixed.
Every control that is _not_ a shared primitive reports `outline`, every primitive
reports `ring` — the cascade-layer split holds across the whole app, not just the
four surfaces Phase 2 spot-checked.

The `border-ring` flip is still present on the primitives (Finding §4) and is not
counted as a competing indicator: it recolours the resting border rather than adding
an area, it is the same white token, and it was there before this change.

### Focus vs. selection, observed (informs Phase 4 §2)

On the review screen a candidate was selected and then keyboard-focused. The two
indicators are on **different elements** and read apart cleanly: selection is the
card's `ring-1 ring-purple-400/40` plus `border-purple-400/60`; focus is a **white**
2px outline on the checkbox inside it. Colour, width, element and persistence all
differ. Screenshot-confirmed. Phase 4 §2 writes this up as the binding contract.

### One measurement trap, in addition to §Method's three

**A real `Tab` must be pressed after _every_ navigation, not once per session.** The
first `/generate` sweep returned `NONE` for all 12 controls with `fv: false` across
the board — the harness had lost keyboard modality on the page load. That is trap §3
firing at page scope rather than per control, and it produces a uniformly alarming
result that looks exactly like a total regression. If a whole page reads `NONE`,
press `Tab` and re-run before believing it.

## Phase 4 re-run (2026-07-25) — the like-for-like measurement

Method as in §Method, same viewport (**1692 × 1559 CSS px, DPR 1.25**, verified
rather than assumed), `npm run dev` at `http://localhost:4328`, keyboard modality
re-established with a real `Tab` after **every** navigation. Every row above was
re-measured; nothing in the PO column is inferred from a token value.

**The harness was rebuilt, so it was calibrated against the earlier spot-checks
rather than trusted.** Nine controls measured in Phases 2 and 3 come back
identical to the hundredth — "Sign in" 13.85/13.86, `PasswordToggle` 13.76,
"Sign up" 13.92/13.93, "Wyloguj" 17.25, `#deck-search` 18.58, both `<select>`s
18.95, "Usuń" 18.11, banner 8.20. Where a value moves it moves by ≤ 0.08 and only
on rows whose backdrop is sampled from the page gradient (the auth fields read
13.78/13.76 against Phase 3's 13.71): the gradient is sampled at the element's
vertical position, so a few pixels of layout difference move the third
significant figure. No verdict anywhere depends on that margin.

### A fourth measurement trap, and it cost a wrong reading before it was caught

**`transition-all` makes a computed style read STALE immediately after
`.focus()`.** Every shared primitive carries `transition-all` at `0.15s`, so
`getComputedStyle(el).borderTopColor` sampled in the same task as `el.focus()`
returns the **pre-transition** colour. The ring is unaffected — it travels through
`--tw-ring-shadow`, a custom property that is not interpolated — so the first
Phase 4 pass reported every button as "ring, no border flip" while `#deck-name`
and the other `Input`s (whose flip the same bug happened not to hide) reported
both. That looked like a real behavioural split between Buttons and Inputs, and
it was an artifact.

It was run to ground rather than guessed at: cloning the real button's class list
reproduced it, bisecting the 33 classes named `transition-all` as the single
class whose presence killed the flip, and re-reading the same control 250 ms after
focus showed the border at `oklch(1 0 0)` after all.

The fix in the harness is not a longer wait — timers are throttled to ~1 s in a
hidden tab (trap §1's cause, second-order effect), which turned a 62-control sweep
into a CDP timeout. Transitions are **disabled** for the duration of the
measurement instead (`*,*::before,*::after{transition:none!important}`), which
removes the timing variable rather than racing it. A sweep then costs ~2 ms.

Two smaller corrections came out of the same pass: ring widths written as
`calc(2px + 0px)` need parsing (a naive "last px token" reads `0`), and colour
equality must be compared through the canvas — Chromium reports the _same_ colour
as `oklch(0.922 0 0)` blurred and `oklab(0.922 0 0)` focused, which a string
comparison reads as a flip that did not happen.

### Full-app sweep, re-run with the corrected harness

Same classification as Phase 3's sweep (`ring` / `outline` / `NONE` / `BOTH`),
selector `a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])`,
filtered to visible and enabled.

| Surface state                | Controls | NONE | BOTH | fv=false | min           | max   |
| ---------------------------- | -------- | ---- | ---- | -------- | ------------- | ----- |
| `/auth/signin`               | 6        | 0    | 0    | 0        | 8.20 (banner) | 13.93 |
| `/decks` (sidebar expanded)  | 62       | 0    | 0    | 0        | 8.20 (banner) | 19.11 |
| `/decks` + `CreateDeckModal` | 3        | 0    | 0    | 0        | 18.11         | 18.11 |
| deck page                    | 23       | 0    | 0    | 0        | 8.20 (banner) | 18.70 |
| deck page + delete confirm   | 2        | 0    | 0    | 0        | 18.11         | 18.11 |
| `/generate`                  | 12       | 0    | 0    | 0        | 8.20 (banner) | 18.95 |
| review                       | 14       | 0    | 0    | 0        | 8.20 (banner) | 19.11 |
| review + candidate selected  | 18       | 0    | 0    | 0        | 8.20 (banner) | 19.11 |
| study (session)              | 11       | 0    | 0    | 0        | 8.20 (banner) | 19.11 |
| study (answer revealed)      | 14       | 0    | 0    | 0        | 8.20 (banner) | 19.11 |

**165 control-measurements, 0 `NONE`, 0 `BOTH`, `:focus-visible === true` on every
one.** Visual confirmation kept alongside the numbers: a zoomed screenshot of the
focused "Dobre" rating button shows the white ring painted on all four sides.

## Verdict (PO)

**48 of 48 rows pass. Nothing is below 3:1, and no row has an empty
"Wskaźnik PO" cell.** The PRZED count was 43 of 48 failing.

- **App-wide minimum: 8.20:1** — the banner link, the app's only light surface,
  where the indicator is deliberately the banner's own dark foreground rather than
  the white token (Phase 3 §2).
- **Dark-surface minimum: 12.56:1** — the review candidate card's buttons, on the
  `rgb(45,50,68)` backdrop Finding §6 predicted would be the worst case.
- **Maximum: 19.11:1**, on the `bg-cosmic` page background.

Every row clears the bar by at least 2.7× the required ratio; the margin is wide
enough that the sub-0.1 measurement spread noted above cannot move a verdict.

### Controls that changed category

No control moved out of "paints nothing" — **that set was empty before the change
too** (Finding §1), and the plan's Phase 3 §3 candidate list correctly resolved to
no work. What did change category:

1. **Every non-primitive moved from `outline: auto` to `outline: solid 2px`** —
   34 of the 48 rows. This is the substantive category change of the whole change:
   the indicator is no longer the UA's hairline painted in the author's colour
   (whose width the app could not control, trap §2) but an outline the app
   declares. Width went from "whatever Chromium paints, computed as `0.8px`" to a
   declared 2px.
2. **The two `<select>`s lost their border indicator and gained a real outline.**
   PRZED they were the only controls passing, and only by accident, on
   `focus-visible:border-white/40` at 3.81. That class is gone; their border is now
   identical focused and blurred, and the outline carries them at 18.95.
3. **The auth fields moved from purple to the shared white token**, 4.93 → 13.78,
   and — the part that is not about contrast — from `focus:` to `focus-visible:`,
   which is what makes them satisfy the ticket's "not on mouse click" criterion.
4. **The three `destructive` buttons lost their local `ring-white/80` patch and got
   _better_, not worse** — 8.74/11.77 → 12.70/18.11. This is the row that proves
   the fold-in was safe: the default now exceeds the patch it replaced.
5. **The banner link inverted its colour source**, from the (white, then invisible)
   global token to `currentColor`: 1.42 PRZED, 1.22 after Phase 2 alone, **8.20**
   after the local exception.

### One row where PRZED and PO are not directly comparable

The border column on the primitives. PRZED recorded a `focus-visible:border-ring`
flip on the Buttons (4.92–7.40); PO records it at the ring's own value because the
token is now white. The **PO** numbers here were captured with transitions
disabled, the PRZED numbers were not — so a reader comparing only the border cells
is comparing two harnesses, not two builds. This does not affect any verdict: the
border is a 1px recolour of the resting border and Finding §4 already ruled it out
as the indicator carrying 1.4.11. The ring/outline columns are captured
identically on both sides and are what the ≥3:1 claim rests on.

## Focus vs. selection contract

Binding on C10X-16 unless that ticket deliberately supersedes it.

|          | Focus                                                         | Selection                                      |
| -------- | ------------------------------------------------------------- | ---------------------------------------------- |
| Colour   | white — `oklch(1 0 0)`                                        | purple — `oklch(71.4% 0.203 305.504)`          |
| Alpha    | full                                                          | translucent (ring 40%, border 60%)             |
| Geometry | outer — `outline` 2px at `outline-offset: 2px`, or `ring` 3px | inner — `ring-1` + `border` on the card itself |
| Element  | the focused control (the checkbox)                            | the card wrapper containing it                 |
| Lifetime | transient — only while `:focus-visible` matches               | persistent — until the user deselects          |

Measured together on the review screen with a candidate selected and its checkbox
keyboard-focused (`CandidateItem.tsx:204` for selection, the base-layer outline for
focus):

- focus: `outline: solid oklch(1 0 0)`, offset `2px`, **13.19:1**
- selection: `--tw-ring-shadow: 0 0 0 1px color-mix(in oklab, oklch(71.4% 0.203 305.504) 40%, transparent)`,
  `border-color: oklab(0.714 0.117894 -0.165257 / 0.6)`
- and they are on **different elements** — verified, not assumed.

All five axes differ, so the two remain distinguishable without either one being
restyled. This plan implements nothing here: the selection model is out of scope
(`CandidateItem.tsx:204` belongs to C10X-16) and the pair was checked visually and
by measurement, not covered by a test.

**What would break this contract**, and what C10X-16 should therefore avoid: moving
selection onto the focused control itself, taking selection to full alpha, or giving
selection an outer ring at the same offset the focus outline uses. Any of those
collapses one of the five axes and puts two indicators in the same visual slot.
