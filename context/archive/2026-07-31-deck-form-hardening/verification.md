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

### Step 6 — a REAL delete failure, as a pair

The rows above reach the page-level banner by putting an owned message in the URL by hand.
That proves the consumer accepts a set member; it does **not** prove the endpoint's own
`if (error)` branch — the one a user actually meets — still produces one. The two are
distinguishable here, and cheaply: `delete.ts:33-39` answers a **query error** with the
`?error=` redirect and a **zero-row** result with a bare `404`, so the response shape says
which branch ran.

Induced against the LOCAL stack only, on a **throwaway deck created for this run** (never on
existing data — if the neuter had failed to take, the deck deleted would have been the probe):

| Run | Edit | Observed |
| --- | --- | --- |
| Red | `revoke delete on public.deck from authenticated` (privilege gone from `role_table_grants`) | delete → `302` to `/decks/<probe>?error=…` → banner `Nie udało się usunąć talii`, `role="alert"`, icon present, wrapper `mb-4`. Deck **still present**. Not a `404`, so the `error` branch is what ran |
| Green (positive control) | `grant delete on public.deck to authenticated` | the **same** delete on the **same** deck succeeds: redirect to `/decks`, deck gone, no banner |

The green run is the half that makes the red one evidence — without it, "the delete failed"
is compatible with the click never landing. Restore verified by a `role_table_grants`
before/after `diff`: **empty**. The probe deck was consumed by the positive control, so the
dev database is back to its two original decks.

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

---

## Phase 4 — Server-side tests for the deck form rules (2026-07-31)

### Automated

| Check | Result |
| --- | --- |
| `npx vitest run tests/validation/decks.test.ts` | **16 passed / 16**, seed `1785529167512`; re-run verbose at seed `1785529180542`, same 16 |
| `npm test` | **278 passed / 278, 24 files**, seed `1785529194605` |
| Three further fresh un-pinned seeds | **278/278** at `1785529230802`, `1785529235608`, `1785529240374` |
| `npm run lint` | exit 0 — the same 6 pre-existing `no-console` warnings in `evals/generation-quality.eval.ts`, unchanged |
| `npx tsc --noEmit` | exit 0 (not a Phase 4 criterion; run because the phase adds a fixture module) |

**The count movement, measured rather than derived.** The Phase 3 row above records
**266/266, 24 files**. `git show c9cc103:tests/validation/decks.test.ts | grep -c '  it('`
returns **4** — the four malformed-body cases Phase 2 landed as its own evidence — and the
file now holds **16**. 266 + 12 = **278**, which is what ran. No other file's case count
moved: `cards.test.ts` was edited, but only to import two helpers it previously declared.

### What the file asserts, and with which oracle

The split is the part worth reading, because `deck` has no containing column and the two
helpers the need points at are both wrong (`deckNameExists` filters one exact name and
`.maybeSingle()`s; `listDecks` has **no WHERE clause at all** and decays into a false pass
past PostgREST's `max_rows`, exactly as the `listDueCounts` denial did).

| Claim | Oracle |
| --- | --- |
| Over-`NAME_MAX` create is refused and writes nothing | raw count scoped by a per-case name **marker**, `.like()` — the name under test *is* the marker |
| Over-`NAME_MAX` rename is refused and the row is untouched | the **row**, `toEqual(before)` column for column — an UPDATE leaves no count to move |
| …and the refusals are not an endpoint refusing everything | **two** boundary controls (create and rename at exactly `NAME_MAX`), each asserting length **and** equality of the stored string |
| The trim direction is the mirror of `/api/generate`'s raw cap | a `NAME_MAX`-character name padded with trailing whitespace is **accepted** and stored at exactly `NAME_MAX` |
| Missing / empty / whitespace-only is one indistinguishable refusal | **create: no row oracle** (below); **rename: the row**, all three shapes |
| A body that was never a form answers an owned redirect | create: none; rename: the row. Both assert the decoded `error` by equality |
| A body announced as a form that does not parse answers the same | same, plus `not.toBe(NAME_MESSAGE)` — which pins that the **catch** answered, not the length guard reading an unparsed body as empty |
| A `File` part reads as empty rather than crashing | create: none; rename: the row. Message is the existing length copy — no new set member |
| A refusal echoes nothing back | the **raw** `Location`, before decoding, carries neither the case marker nor the run suffix |
| A duplicate name is refused and the existing deck is untouched | count **and** row, on a deck the case creates inside its own `it()` |
| The database refuses the same names independently of the endpoint | direct RLS-scoped inserts → `23514`, asserted by **code and by constraint name `deck_name_check`**, with an in-range insert as the positive control |

### Three decisions recorded rather than left to be inferred

**1. The nameless CREATE cases have no row oracle, and the file says so.** There is no name to
carry a marker, so a marker-scoped count reads `0` before and after whatever the endpoint
does — an assertion that cannot go red, which is the `listDueCounts` false-pass class one
table over. A delta over account A's own decks is not the escape either: A is shared across
**files**, and `generate.test.ts` (`newDeckName`) and `isolation/decks.test.ts` both create
decks as A in parallel workers, so the delta races. Those four cases rest on the `302` plus
the decoded `error` **equality**, and that is honest for a second reason: `deck_name_check`
refuses a `''` name independently — asserted in the DB-layer `describe` — so at the endpoint
layer there is nothing a row oracle could have distinguished. **Consequence for Phase 6:
under run 1 these particular cases attribute nothing to either enforcement layer.** Their
rename twins are where the same refusal gets a real oracle, which is why every nameless case
is routed through both endpoints.

**2. The messages are spelled out in the test, not imported from `@/lib/redirect-errors`.**
Phase 2's four cases imported the constants; Phase 4 changed them to literals, with the
bound-derived one interpolated from `NAME_MAX` exactly as the endpoint builds it — the
discipline `cards.test.ts` already follows for `FRONT_MESSAGE`/`BACK_MESSAGE`. Importing the
constant makes the assertion agree with itself, and the failure this file exists to catch is
precisely a "tidied" string: a reworded message drops out of the closed set silently, so the
banner stops appearing rather than anything going red. `NAME_MAX` itself is still imported,
which is why Phase 6's run 1 must decouple the endpoint's **comparison** and never raise the
constant.

**3. `sized()` and `errorParam()` moved to `tests/fixtures/redirect-cases.ts`.** They were
authored in `cards.test.ts` and are needed verbatim here; a character-for-character copy
between two test files is the drift `tests/fixtures/scoping.ts` was extracted to end (C10X-28
impl-review F7). `cards.test.ts` now imports them and declares neither, along with the `ORIGIN`
const that only `errorParam` used. Its 12 cases are unchanged and stayed green throughout.

### Shuffle safety

The create `describe` has **no shared fixture at all**: every case owns the marker it counts
and, where it creates a deck, the deck it reads back. The rename `describe` shares one deck,
which is safe because every case that touches it is a refusal asserting `toEqual(before)`
against a row it re-reads **inside its own `it()`**; the one case that genuinely mutates a
deck — the boundary control — creates its own. That is §6.2's owned-fixture rule, and the five
green un-pinned seeds above are the evidence rather than the argument.

### Not claimed by this phase

- **Nothing here is falsifiable evidence yet.** Every split, every red/green attribution and
  every restore belongs to Phase 6; a green suite is a claim about today, not about the
  assertions' worth.
- **The island half.** `CreateDeckModal` and `DeckActions` run their own trimmed 1..100 check
  and `preventDefault()` on failure, so the server's over-length branch is not reachable
  through the hydrated UI. No layer in this plan reaches an island's JSX (§7); their half is
  carried by the Phase 1–3 manual checks.
- **The cloud's rows.** Every assertion runs against the local stack. `deck_name_check` ships
  in `20260705180246_init_core_schema.sql` and long predates this change, so no migration is
  pending and the drift gate is not involved.
- **The signed-out branch of either endpoint** — Phase 5 owns it, for all six redirect-style
  routes rather than these two.

### Manual — the island half, run because the plan leaves it to manual checks

The plan's Phase 4 has **no** manual list ("assertions only"), and this matrix is not an
attempt to invent one. It covers the thing Phase 4 explicitly does **not** assert and §7 names
as unreachable by any layer in this project: the two deck islands' own 1..100 guard. Driven in
a real browser against `npm run dev` (localhost:4321), signed in as a throwaway local account.
Deck `7ff17480-…`.

**Measured first, because it decides whether the matrix is worth running at all**: neither
`#deck-name` nor `#deck-rename` carries a `maxLength` attribute (`hasAttribute('maxlength')`
→ `false` on both). So unlike `GeneratorForm`, nothing truncates the input first and the
islands' over-length branch is the branch a **user actually meets** — §7's "third instance"
note, confirmed rather than assumed.

Hydration was polled (`astro-island[ssr]` gone, then a further 400 ms) before every read, per
the methodology Phase 3 had to correct; measured at **975 ms** on the first `/decks` load.

| Island / input | Navigated? | `POST /api/decks*` | Banner inside the modal |
| --- | --- | --- | --- |
| create, 101 chars | no | **0** | equal to `DECK_NAME_MESSAGE` |
| create, empty | no | **0** | equal |
| create, whitespace-only `"   "` | no | **0** | equal |
| create, exactly 100 | **yes** | **1**, 200 | deck created |
| create, duplicate of that 100-char name | **yes** | **1**, 200 | modal re-opened, equal to `"Talia o tej nazwie już istnieje"`, URL stripped back to `/decks` |
| rename, 101 chars | no | **0** | equal |
| rename, empty | no | **0** | equal |
| rename, whitespace-only `"  \t "` | no | **0** | equal |
| rename, exactly 100 | **yes** | **1**, 200 | `h1` is the new name, length 100 |

Every banner was compared to the constant by **equality** in the DOM, and scoped to the node
inside the `<form>` — the page also carries the OpenRouter config banner as a second
`[role="alert"]`, so an unscoped `querySelector('[role="alert"]')` reads that one and the case
passes on the wrong node. That is a live trap on this surface, not a hypothetical.

**"Zero POSTs" is only evidence because of the rows that produced one.** Network requests were
cleared between groups and re-read; the accepting cases fired exactly one POST each, so a
blocked case's zero is the guard working rather than a form that never submits. Without those
rows the whole table would be satisfied by an island whose submit handler was broken outright.

**The duplicate row is a bonus this phase did not plan for and is worth keeping**: it is the
only check anywhere in this change that exercises the Phase 3 read-side guard on a message the
**server actually produced**, rather than one hand-crafted into the URL — island passes it →
endpoint refuses → `?error=` → `ownedRedirectMessage` vouches → banner renders inside the modal
→ `replaceState` strips the parameter. The crafted-URL matrix in Phase 3 cannot show that the
producer and the consumer agree in the real round trip; this does.

**Methodology, recorded rather than smoothed over.** Values were set through the native
`HTMLInputElement.prototype.value` setter plus an `input` event (React controlled inputs ignore
a plain assignment), and submitted with `form.requestSubmit()` after a click on the resolved
submit-button ref did not register. `requestSubmit()` dispatches the same `submit` event a
button click does, so the islands' `onSubmit`/`preventDefault()` is exercised faithfully — but
it is a scripted submit, not a mouse-and-keyboard one, and the table should be read as
evidence about the **guard**, not about pointer handling.

---

## Phase 5 — Guards: the closed set, the page wiring, and the signed-out class (2026-07-31)

### Automated

| Check | Result |
| --- | --- |
| `npx vitest run tests/lib/redirect-errors.test.ts tests/lib/error-param-guard.test.ts tests/validation/signed-out.test.ts` | **23 passed / 23, 3 files**, seed `1785530536385` |
| `npm test` | **298 passed / 298, 26 files**, seed `1785530573036` |
| Two further fresh un-pinned seeds | **298/298** at `1785530592055`, `1785530597362` |
| `npm run lint` | exit 0 — the same 6 pre-existing `no-console` warnings in `evals/generation-quality.eval.ts`, unchanged |
| `npx tsc --noEmit` | exit 0 |

**The count movement, measured rather than derived.** Phase 4 recorded **278/278, 24 files**.
`redirect-errors.test.ts` adds **6**, `signed-out.test.ts` adds **9**, and the page guard went
**3 → 8** (`+5`) — 278 + 20 = **298**, which is what ran. Files move by **2**, not 3, because the
page guard replaced an existing file rather than adding one: `error-param-guard.test.ts` was
produced by `git mv`-ing `auth-error-param-guard.test.ts` and then rewriting it.
No other file's case count moved.

> **Corrected in Phase 6's read-back, 2026-07-31.** This paragraph first ended "…is a `git mv` of
> `auth-error-param-guard.test.ts`, **not a new file**", which invites a check that fails: the
> move came with a rewrite, so at git's default similarity threshold the commit records **`D` +
> `A`**, not `R`, and `git log --follow` shows nothing before `036357c`. Rename detection needs
> `-M30%` or lower, where it reports **`R031`** — 31% survived. The **+2 file count is
> independently verifiable and unchanged**; only the provenance was overstated as something git
> would confirm.

### What each file claims, and what it deliberately does not

| File | Claim | The case that makes it falsifiable |
| --- | --- | --- |
| `tests/lib/redirect-errors.test.ts` | `ownedRedirectMessage` admits a set member and rejects everything else — including a value that **contains** a real message and a one-character truncation | the **whole-set positive control**; without it `() => null` satisfies every rejection case and reads as perfect protection |
| …same | No member is `""` | an empty member would render as no reason at all (`ServerError.tsx:8`), i.e. indistinguishable from a clean load |
| …same | The two card-content members are built from the LIVE `FRONT_MAX`/`BACK_MAX` | the expectation is **interpolated**, not imported — a moved bound would otherwise leave a stale member the endpoint no longer emits |
| `tests/lib/error-param-guard.test.ts` | Both surfaces' pages still call **their own** helper, per LINE | the walker control, the detector control, **and** the new cross-surface case |
| `tests/validation/signed-out.test.ts` | All six redirect-style endpoints answer a signed-out caller with `Location` **equal** to `/auth/signin` | three signed-**in** controls reaching each endpoint's own owned error copy |

**Why the page guard became a table, and it is not tidiness.** The two surfaces vouch against
**different** closed sets — `src/pages/auth` against `AUTH_MESSAGES`, `src/pages/decks` against
`REDIRECT_MESSAGES`. A single shared "is it wrapped in something?" regex would therefore accept a
deck page wrapped in `ownedAuthMessage`: lexically a wrap, semantically the wrong vocabulary, and
that page would vouch for "Nieprawidłowy e-mail lub hasło" while refusing its own endpoints' copy.
So `WRAPPED_READ` is now built per surface from ITS helper's name, and a case asserts each
surface's pattern **rejects the other's helper by name**. The `?open=` non-firing case was
written for exactly these deck pages and now runs against both surfaces.

**The one measurement taken here rather than in Phase 6, because it backs a claim written into a
comment.** The `cards/[cardPublicId].ts` row sends a real `FormData`, and the file states that is
a **precondition** and not incidental setup. Verified by deleting the body and re-running:
**1 of 9 red**, exactly that row, on

```
expected '/decks/00000000-0000-4000-8000-000000000001?error=Nie%20uda%C5%82o%20si%C4%99%20zapisa%C4%87%20zmian&edit=00000000-0000-4000-8000-000000000002' to be '/auth/signin'
```

with every other row green. That endpoint reads `formData()` at `:48`, **before** its
`!context.locals.user` check at `:71` — the only one of the six in that order, and its own comment
records it as "an ordering nobody chose". Restored, and the observed string is now in the comment
beside the row so the next reader does not tidy the six rows into one uniform shape.

### Not claimed by this phase

- **Nothing here is falsifiable evidence yet, except the one probe above.** Every other split and
  every restore belongs to Phase 6.
- **The signed-out file's three missing positive controls, and the reason is stated in the file
  rather than left to be inferred from a count.** Both delete endpoints reach a **query**
  immediately after their user check, so a control for them needs the database this file
  deliberately does not touch; `cards/[cardPublicId].ts`'s only query-free branch (its `formData()`
  catch) runs **before** the user check, so a control routed through it would prove nothing about
  the gate. Three controls over three endpoints is what can be had for free.
- **The page guard proves the read is lexically WRAPPED**, not that the wrapped value reaches
  `serverError`, and not that either helper behaves — three files, three claims.
- **Nothing observes the URL cleanup.** No assertion reads `window.location`; the islands'
  `replaceState` strip is still browser-checked only (Phase 3, and the duplicate-name row in
  Phase 4's manual matrix).
- **`SUPABASE_UNCONFIGURED_MESSAGE`'s branch is asserted nowhere**, deliberately: reaching it needs
  `createClient() === null`, i.e. an `astro:env/server` double, and §6.9 admits one only for a
  claim unreachable otherwise. It is a set member and is covered as such by the whole-set control.
- **`cards/batch.ts` is absent from the signed-out class on purpose** — a JSON endpoint answering
  `401`, already covered by `tests/middleware.test.ts`.

### Shuffle safety

All three files are order-independent **by construction**: none opens a database connection, none
provisions an account, and none shares a fixture — the two guard files read the source tree, and
`signed-out.test.ts` builds a fresh container and a fresh `Request` per row. The three green
un-pinned seeds above are the evidence rather than the argument.

---

## Phase 6 — Deliberate breakage, and the documents that still say this is open (2026-07-31)

Everything above is a claim about today. This phase is what those claims are worth.

### Baseline, taken before the first edit

| Check | Result |
| --- | --- |
| `npm test` | **298 passed / 298, 26 files**, seed `1785534827060` — unchanged from Phase 5 |
| `pg_get_constraintdef` on `public.deck` | `deck_name_check :: CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))) :: convalidated=true` (+ `deck_session_size_check`) |
| Pristine MD5s of the four files any run touches | `index.ts e8266ff5…`, `[publicId].ts a5d613f9…`, `redirect-errors.ts 8b0dc6b7…`, `decks/index.astro 0ae897e9…` |
| Rows the CHECK would forbid, before run 2 | `0` — measured, so the four that appear later are attributable to the run |

### The pair — endpoint vs database

Run 1 replaced `> NAME_MAX` with the literal `> 100000` on **both** deck endpoints. Never raising
`NAME_MAX` is the load-bearing half of that instruction: after Phase 1 six sites **and the test**
import it, so raising it moves every side together and the suite stays green while proving
nothing.

| Run | Edit | Split | Where they failed |
| --- | --- | --- | --- |
| 1 | endpoint comparison decoupled | **3 of 16 red** | all on the **message equality**, with every count/row oracle **passing** |
| 2 | run 1's edit **plus** `deck_name_check` dropped | **4 of 16 red** | the same three now on their **oracles**, plus the DB-layer independence case |

Observed strings, which are the evidence rather than the counts:

| Case | Run 1 | Run 2 |
| --- | --- | --- |
| create, one over the limit | `expected 'Nie udało się utworzyć talii' to be 'Nazwa talii musi mieć od 1 do 100 znaków'` (`:189`) | `expected 1 to be +0` (`:185`, the count) |
| create, no-echo | same string (`:313`) | `expected 1 to be +0` (`:307`, the count) |
| rename, one over the limit | `expected 'Nie udało się zmienić nazwy talii' to be 'Nazwa talii musi mieć od 1 do 100 znaków'` (`:355`) | the row: `name` and `updated_at` diverge from `before` (`:351`) |
| DB-layer independence | green | `expected undefined to be '23514'` (`:449`) |

**Run 1's PASSES are half the evidence.** The count and row oracles passing there is what shows
`deck_name_check` absorbed the write the decoupled endpoint let through — i.e. the two layers are
genuinely independent, which is the only thing that lets run 2 attribute anything. And the two
runs fail the **same** cases with **different** strings, which is what §6.10's count-first
assertion order exists to produce; message-first would have printed run 1's string in both runs
and the pair would have separated nothing.

One consequence worth restating because a reader could infer the opposite from the headline: the
**nameless CREATE** refusals (missing / empty / whitespace-only, the non-form body, the
broken-form body, the `File` part) are green in both runs and attribute nothing to either layer.
They have no row oracle — there is no name to mark — as Phase 4 recorded rather than faked. Their
rename twins are where those refusals get a real oracle.

### Restoring the CHECK — the asymmetry, and this time it worked

While the constraint was absent the suite persisted **four** rows it forbids. Inspected before
deletion rather than deleted blind:

| `public_id` | len | head | what it is |
| --- | --- | --- | --- |
| `8a69030a…` | 101 | `over-rename-ms9hd0qj-xxx…` | the shared rename fixture, renamed by the run |
| `ee858615…` | 101 | `db-over-ms9hd0qj-xxx…` | the DB-layer case's own insert |
| `e16238d2…` | 101 | `echo-create-ms9hd0qj-xxx…` | the no-echo case |
| `d7b81bc5…` | 101 | `over-create-ms9hd0qj-xxx…` | the over-limit create |

All four carry the run's own suffix `ms9hd0qj`; `delete … returning` reported **DELETE 4**, then
`add constraint` succeeded. That ordering is what C10X-27's `deck_session_size_check` restore
discovered the hard way — it failed with `violated by some row` *after* its evidence was
collected.

Then both checks, because the cheap one is not sufficient:

- **Textual**: `pg_get_constraintdef` before/after `diff` — **empty**, and `convalidated=true`.
- **Behavioural**, in a rolled-back transaction, because a text match reads identical for a
  constraint that came back `NOT VALID`:

  | Insert | Result |
  | --- | --- |
  | `'probe-in-range-' || repeat('x', 85)` → 100 chars (**positive control**) | `INSERT 0 1`, `inserted_len = 100` |
  | `repeat('x', 101)` | `ERROR: … violates check constraint "deck_name_check"` |
  | `''` (own transaction — the first had already aborted) | `ERROR: … violates check constraint "deck_name_check"` |

  The control is what separates "the bound is back" from "the table rejects everything".

### Three more falsifiability runs

| Neuter | Split | Observed |
| --- | --- | --- |
| `formString(form.get("name"))` → `((form.get("name") as string \| null) ?? "")`, on **`decks/index.ts` only** | **1 of 16 red** | exactly the create-side `File` case, failing with the production defect itself: `TypeError: (form.get(...) ?? "").trim is not a function` at `src/pages/api/decks/index.ts:49`, escaping the handler through `renderEndpoint`. Its **rename twin stayed green** — the control that attributes the red to the neutered endpoint rather than to the case |
| `ownedRedirectMessage` → `return raw` | **2 of 6 red** in `redirect-errors.test.ts` | the crafted-value case (`expected 'Twoje konto zostało zablokowane…' to be null`) and the empty-parameter case (`expected '' to be null`). `error-param-guard.test.ts` stayed **8/8 green** |
| unwrap `src/pages/decks/index.astro:27` | **1 of 8 red** in `error-param-guard.test.ts` | names file and line: `index.astro:27: const error = Astro.url.searchParams.get("error");`. `redirect-errors.test.ts` stayed **6/6 green** |

**What stays green is the point in two of the three.** For the identity neuter: the member case,
the non-emptiness scan, the template case and — the load-bearing one — the **whole-set positive
control**. Without it `() => null` satisfies every rejection case and reads as perfect protection.
For the unwrap: both of that surface's positive controls, the whole auth surface, and
`redirect-errors.test.ts` in full — a behaviourally perfect helper nothing calls is exactly the
regression the page guard exists to catch, and the two neuters demonstrate the complement of each
other.

**One prediction was rounder than the run, recorded as observed.** The plan expected the identity
neuter to turn "the rejection cases" red and it turns **two**, the second being the `""` half of
the empty-parameter case — under `return raw`, `null` still maps to `null`, so only the
empty-string and whitespace inputs move. Same shape as C10X-29's `missingLocal` neuter, C10X-30's
case 8 and C10X-34's check E.

### Restores, verified rather than assumed

| Check | Result |
| --- | --- |
| `md5sum -c` against the four pristine copies | **4/4 OK**, run after the pair and again after run 5 |
| `git diff --stat -- src/ supabase/` | **empty** |
| `npm test` after the last restore | **298 passed / 298, 26 files**, seed `1785535019998` |
| `npm test` after the first document-sync pass | **298 passed / 298, 26 files**, seed `1785535690662` |
| `npm test` after the read-back corrections — the shipping state | **298 passed / 298, 26 files**, seed `1785563577358`, with `tsc`/`lint`/`build` all exit 0 and the four pristine MD5s re-checked **4/4 OK** |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 — the same 6 pre-existing `no-console` warnings in `evals/generation-quality.eval.ts`, unchanged |
| `npm run build` | exit 0 |

### The documents

Three live comments told a contributor this class was still open, and after this change they
would have been false in the way this project keeps paying for:

| File | Was | Now |
| --- | --- | --- |
| `src/lib/forms.ts` | "the deck pair was missed … owned by **C10X-37**" | a dated statement that all six `formData()` readers are guarded and the helper has six callers — with the paragraph's own three-version history kept, because every correction so far was in the direction that reads as reassurance |
| `src/lib/generation-limits.ts` | "Deliberately NOT here: the deck-name 1..100 bound, which lives in six places" | a pointer to `deck-limits.ts`, and the reason the generation module keeps only the generation concern |
| `tests/lib/forms.test.ts` | "the FOUR endpoints that call this helper … C10X-37 outstanding" | six, with the count's two previous wrong values kept as history |

Plus the pointer rot the rename would otherwise have caused — the failure this ledger has already
recorded twice (C10X-28's evidence paths, C10X-34's denominators). Three live references to
`tests/lib/auth-error-param-guard.test.ts` in `test-plan.md` (§6.6's C10X-34 bullet and two §8
entries) are repointed to `error-param-guard.test.ts` **without rewriting the historical claims**;
the archived `2026-07-30-auth-error-copy/reviews/impl-review.md:128` reference keeps its wording
and takes an appended **dated correction line** instead, per this project's own precedent
(C10X-30's "4xx" wording).

`test-plan.md` also gains: §2's Risk #6 row (a **third** dated half, with the no-row-oracle
boundary stated in the row itself), a full §6.6 C10X-37 entry with the claims table, both breakage
splits and a does-NOT-prove list, §6.10 extended for a second worked example and the extracted
`tests/fixtures/redirect-cases.ts`, §7's third-instance note extended with a **fourth** (the deck
islands side with the card islands, not with `GeneratorForm` — measured: neither input carries
`maxLength`), and a §8 ledger entry with the counts above.

### The finding this phase produced, which is a bookkeeping one and belongs in the record

The plan's Phase 6 contract asked `change.md` to record that the read-side half was "previously
unticketed". **It is not.** `follow-ups/review-fixes.md:8` says "to be ticketed via
`/jira-backlog-sync`. No key yet" — true when the review wrote it, stale the same day, because
that sync created **C10X-40** for exactly that finding (`jira-map.md:65`, `:243-262`, DoR fields
set, Priority Medium). The plan and `change.md` were both written from the stale line, and neither
the planning pass nor the plan review caught it, because both read the follow-up rather than the
map.

Writing "previously unticketed" would have put a fresh falsehood into the record during the phase
whose job is removing them — and worse, left C10X-40 open in the backlog as a ticket whose fix had
already landed under another key, which is the *exact* confusion this change's scope decision was
written down to prevent, one level up. So:

- `change.md` carries a dated correction section stating the accurate position: the read-side work
  shipped here under C10X-37, and C10X-40 is a key whose work is done.
- `jira-map.md` records it on both rows, and C10X-37's `Change ID` cell is filled with
  `deck-form-hardening` **explicitly flagged as map-side only** — the Jira field
  `customfield_10041` is still unset, and that file's own rule against a one-sided mapping is
  respected rather than quietly broken.
- **Closing C10X-40 and setting C10X-37's `Change ID` in Jira are deferred to
  `/jira-finish-work`**, by decision: `/10x-implement` writes no Jira, and the skill that owns
  those writes is the one that carries the artifact fields with them.

The transferable rule, now in `jira-map.md`: **for a deferred finding, the map is the source of
truth about its key — not the review note, which could not have known the key yet.**

### 6.9 — the new §6.6 entry read back against the code, and one claim it caught

Not a re-read of the prose: each factual claim was re-derived from the tree.

| Claim in the entry | Re-derived | Verdict |
| --- | --- | --- |
| `REDIRECT_MESSAGES` has eleven members | 11 | ✓ |
| Six `formData()` readers under `src/pages/api/`, both deck endpoints among them | 6, enumerated by path | ✓ |
| `decks.test.ts` 16 cases, `redirect-errors.test.ts` 6, `signed-out.test.ts` 9, page guard 8 | as recorded | ✓ |
| `tests/fixtures/redirect-cases.ts` exists and holds `sized()`/`errorParam()` | present | ✓ |
| The deck islands carry no `maxLength` | `grep -rn "maxLength" src/components/` → **only `GeneratorForm.tsx`**, twice | ✓ — and **stronger than the browser measurement**: confirmed at the source, and it surfaces an asymmetry worth recording (the generate surface's own new-deck field IS input-stopped at `NAME_MAX` while the two deck forms' are not) |
| `decks.test.ts` 16 / `redirect-errors` 6 / page guard 8 / `signed-out` 9 | re-run per file: **16 / 6 / 8 / 9**, 39 together | ✓ — and see the oracle note below |
| The eleven literals are a closed set: no `.message`, `String(err)` or `JSON.stringify` "on any deck-route branch" | `.message` **none**, `String(err)` **none**, `catch` binding a variable **none**, `error.code` **2 sites, both `=== "23505"`** — but `JSON.stringify` **does** appear, at `cards/batch.ts:45` | ✗ **wording too loose** — that call serialises a JSON endpoint's response **body**, on one of the three endpoints this channel excludes. Rescoped to "the redirect branches" |
| "a thirteenth hand-rolled banner became the **twelfth** call site" | `grep -rn "<ServerError" src/` → **13 JSX usages across 12 files** (excluding two comment lines inside `ServerError.tsx`) | ✗ **wrong, and corrected before the entry shipped** |
| "`error-param-guard.test.ts` is a **`git mv`** of `auth-error-param-guard.test.ts`" (Phase 5's note, repeated into the §8 ledger) | at the default threshold git records **`D` + `A`**, and `git log --follow` shows nothing earlier; rename detection needs **`-M30%`**, where it reports **`R031`** | ✗ **does not survive a check** — the move came with a rewrite, so only 31% survived. The substantive claim (**files +2, not +3**) is independently true; the provenance is not readable from git |

The last three rows are what justifies the read-back, and two of them are corrections to claims
this change had already written down.

**A methodology note that falls out of the count row.** `grep -c '\bit('` returns **21** on
`decks.test.ts` against the runner's **16**, because this repo's test files carry heavy commentary
and several comments contain the literal `it()` ("inside its own `it()`"). Phase 4's narrower
`grep -c '  it('` — two-space indent, i.e. describe-body depth — returns **16**, matching the
runner exactly, and **0** of its matches are comment lines; the same grep against `c9cc103`
returns the **4** Phase 4 recorded. So Phase 4's oracle was sound and the loose one used during
this read-back was not. Counting cases in this repo needs either the runner or the indented form. C10X-34 enumerated **12 call sites across
11 components**; this change adds one, so it is the **thirteenth** call site, not the twelfth —
the sentence had conflated "thirteenth render" (12 component sites plus the raw markup, which is
what the plan said) with the call-site index after the swap. Recomputed by running the grep rather
than by adding one to the remembered figure, which is exactly how C10X-34's own version of this
count went wrong and was recorded as having gone wrong.

### Not claimed by this phase

- **The five runs falsify five specific assertions, not the suite.** Nothing here says an
  unfalsified assertion is wrong; it says nobody has shown it can go red.
- **No mutation run.** Stryker was not pointed at `redirect-errors.ts` or either endpoint. The
  closed-set helper is four lines and its `includes` is exercised in both directions by the
  whole-set control and the containment case, so the project's selective-mutation rule
  (`CLAUDE.md`: risk-critical modules covered by the change) would have bought classification
  work rather than signal — recorded as a decision, not an oversight.
- **Nothing about the cloud.** No migration, no `db push`, no drift gate: `deck_name_check` ships
  in `20260705180246_init_core_schema.sql` and long predates this change.
- **The island half**, as everywhere in this change — carried by the Phase 1–4 browser matrices.
