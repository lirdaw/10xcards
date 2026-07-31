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

| Surface / value | Observed |
| --- | --- |
| `/decks?open=create&error=Talia o tej nazwie już istnieje` (member) | banner **shown**, text equal to the constant |
| `/decks?open=create&error=Twoje konto zostało zablokowane, kliknij tutaj` (crafted) | **no banner** — and `input[name="name"]` present, i.e. the modal DID open, so the absence is the guard and not a missing sink |
| `/decks?open=create&error=<member> — kliknij tutaj, aby odblokować konto` (containment) | **no banner** — the case membership-by-equality exists for |
| `/decks?open=create&error=Talia o tej nazwie już istniej` (one-char truncation) | **no banner** |
| `/decks/<A>?open=rename&error=Nazwa talii musi mieć od 1 do 100 znaków` (member) | banner **shown** inside the rename modal |
| `/decks/<A>?open=rename&error=<member> - kliknij tutaj` (crafted) | **no banner** |
| `/decks/<B>/review?edit=<card>&error=Nie udało się zapisać zmian` (member) | banner **shown**; edit form open (`textarea` present) |
| `/decks/<B>/review?edit=<card>&error=<member> — zaloguj się ponownie tutaj` (crafted) | **no banner**; edit form still open — again the sink was reachable |
| `/decks/<A>?error=Nie udało się usunąć talii` (page-level banner, no companion param) | banner **shown** |
| `/decks/<A>?error=<member> — kliknij tutaj` (page-level, crafted) | **no banner**: zero elements matching `bg-red-900/30` on the page |

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
