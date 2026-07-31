# Verification — deck-form-hardening (C10X-37)

Evidence log. Each entry records what was RUN and what was OBSERVED, with the denominator
attached to every split — a count without its date and denominator is the failure this
project's ledger has already paid for twice.

---

## Phase 3 — Close the read side on the deck surface (2026-07-31)

### Automated

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 — 6 pre-existing `no-console` warnings in `evals/generation-quality.eval.ts`, unchanged |
| `npm run build` | exit 0 |
| `npm test` | **266 passed / 266, 24 files**, seed `1785526198099` (same count as the Phase 2 baseline — this phase adds no case) |
| `grep 'searchParams.get("error")' src/pages/` | 5 hits, **every one wrapped**: 2× `ownedAuthMessage` (auth), 3× `ownedRedirectMessage` (decks) |

### Manual, driven in a real browser against `npm run dev` (localhost:4321)

Signed in as `c10x41-phase4@example.com`. Deck A `be4edf97-…`, deck B `3adb78e2-…`,
card `0e1e7ca8-…`.

Every row asserts on the DOM (`[role="alert"]` node text), not on a glance at a screenshot.

> **Two methodology defects were found in the FIRST pass of this matrix and the whole matrix
> was re-run. Recorded rather than quietly fixed, because both are traps the next contributor
> will meet.**
>
> 1. **The reads raced hydration.** Every banner on the modal surfaces is rendered by a React
>    island, and the first pass read the DOM immediately after `navigate` returned. Measured on
>    the re-run: hydration completes **403–901 ms** after navigation. A "no banner" read taken
>    inside that window says nothing about the guard. The re-run polls
>    `astro-island[ssr]` until Astro drops the attribute, then waits a further 400 ms.
> 2. **The positive control was unfalsifiable.** "The modal DID open" was asserted as
>    `!!document.querySelector('input[name="name"]')` — and that input is in the SSR markup
>    **whether the modal is open or closed** (measured with the modal closed: `exists: true`,
>    `getClientRects().length: 0`, `offsetParent: null`). So the control was satisfied by a
>    closed modal and could not have gone red. The re-run asserts **visibility**
>    (`getClientRects().length > 0`), which is what separates "the guard suppressed the banner"
>    from "the sink was never rendered". Same class as the `listDueCounts` false pass in
>    test-plan §6.6 — an assertion that reads green because it cannot fail.
>
> The conclusions below are from the **second** pass. They agree with the first pass; the point
> is that only the second pass is evidence.

| Surface / value | Sink reachable? | Banner |
| --- | --- | --- |
| `/decks?open=create&error=Talia o tej nazwie już istnieje` (member) | modal **visible** | **shown**, text equal to the constant |
| `/decks?open=create&error=Twoje konto zostało zablokowane, kliknij tutaj` (crafted) | modal **visible** | **none** |
| `/decks?open=create&error=<member> — kliknij tutaj, aby odblokować konto` (containment) | modal **visible** | **none** — the case membership-by-equality exists for |
| `/decks?open=create&error=Talia o tej nazwie już istniej` (one-char truncation) | modal **visible** | **none** |
| `/decks/<A>?open=rename&error=Nazwa talii musi mieć od 1 do 100 znaków` (member) | rename modal **visible** | **shown** |
| `/decks/<A>?open=rename&error=<member> - kliknij tutaj` (crafted) | rename modal **visible** | **none** |
| `/decks/<B>/review?edit=<card>&error=Nie udało się zapisać zmian` (member) | edit form **visible** (2 textareas) | **shown** |
| `/decks/<B>/review?edit=<card>&error=<member> — zaloguj się ponownie tutaj` (crafted) | edit form **visible** (2 textareas) | **none** |
| `/decks/<A>?error=Nie udało się usunąć talii` (page-level, no companion param) | SSR — no hydration involved | **shown**, with icon, wrapper `mb-4` |
| `/decks/<A>?error=<member> — kliknij tutaj` (page-level, crafted) | SSR | **none**: zero elements matching `bg-red-900/30`, page otherwise intact |

### Real flows — the round trip nothing else proves

The crafted-URL matrix proves the consumer rejects what it should. It does **not** prove that
what the six producers actually emit still passes — after Phase 1 hoisted every literal into
`redirect-errors.ts`, a single reworded producer would fall out of the set and the banner would
silently stop appearing. Only a live refusal closes that loop. Driven through the real forms:

| Flow | Observed |
| --- | --- |
| Create, empty name | client guard fires, **no request**, message `Nazwa talii musi mieć od 1 do 100 znaków` (the hoisted `DECK_NAME_MESSAGE`, unchanged) |
| Create, duplicate name | **real server refusal** → full-page navigation (`performance` navigation type `navigate`) → modal re-opens with `Talia o tej nazwie już istnieje`. **Producer → `?error=` → `ownedRedirectMessage` → banner, end to end** |
| Create, unique name | deck created, appears in the list, no banner |
| Rename → duplicate name | **real server refusal** → banner `Talia o tej nazwie już istnieje`; `<h1>` unchanged, modal pre-filled with the ORIGINAL name |
| Rename → unique name | `<h1>` becomes the new name, modal closed, no banner |
| Delete | deck removed, redirect to `/decks`, no banner (also the cleanup of the deck this pass created — the dev DB is back to its two original decks) |
| Generate form (step 8) | new-deck name input `maxLength: 100` (from `NAME_MAX`), and its own copy is intact: `Nazwa nowej talii musi mieć od 1 do 100 znaków.` — **with** the trailing period, i.e. still distinct from the deck copy, which has none |

### 3.8 — spacing, measured rather than eyeballed

The plan asks for a comparison against "a screenshot taken before the swap". Taken as a
**numeric** before/after instead: the page file was backed up, `git show HEAD:…` written over
it (HEAD = `c9cc103`, the pre-Phase-3 version), the same four numbers read, then the file
restored and the restore verified by MD5 (`dd63328f85966c3d3d70e2fd29122f52`, identical
before and after; `git diff --stat -- src/` shows only this phase's three files).

| Measurement | OLD (`c9cc103`, raw `<p class="mb-4 …">`) | NEW (`<div class="mb-4"><ServerError/></div>`) |
| --- | --- | --- |
| header bottom | 199.400 | 199.400 |
| banner box top | 199.400 | 199.400 |
| banner box bottom | 237.000 | 237.000 |
| banner box height | 37.600 | 37.600 |
| computed `margin-bottom` | 16px | 16px |
| toolbar top (`sticky top-16`), error page | 253 | 253 |
| toolbar top, **error-free** page | 199.400 | 199.400 |
| children after the sticky header, error-free | `[ASTRO-ISLAND]` | `[ASTRO-ISLAND]` |
| container height, error-free | 316.800 | 316.800 |

Identical to the sub-pixel in both states. The error-free row is the one that matters for the
`{bannerError && …}` conditional staying **outside** the wrapper: an always-rendered `<div>`
would have moved `toolbarTop` by 16px there, and it does not.

Two deltas, both intended: `role` `null` → `"alert"`, and `svg` `false` → `true` (the
`CircleAlert` icon). The banner's own class list is byte-identical to the old `<p>`'s minus
`mb-4`, which the wrapper supplies.

### 3.9 — alert exposure

`read_page` on the error page returns `alert "Nie udało się usunąć talii"` — the node is
**exposed as an alert in the accessibility tree**. **Announcement is deliberately NOT claimed
on this surface**: the banner arrives by a full-page redirect, so the live region is present
at MOUNT, the case `ServerError.tsx:12-19` records as unreliable across screen readers.
