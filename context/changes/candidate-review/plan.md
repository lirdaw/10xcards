# S-05 candidate-review — Implementation Plan

## Overview

Close the generation loop. AI candidates land in the database as `state_id = generated`
and are currently unreachable after a page reload; this slice makes them visible and
curatable — accept, edit, reject — one at a time or in bulk (FR-005), so accepted cards
become part of the deck the user studies (FR-006, US-01).

Along the way the slice writes the project's **first lifecycle state transition** and its
**first multi-row mutation** (`setState` over a set of cards). The selection model stays
**local to the review island**: plan-review F8 moved C10X-16's deck-view half — selection,
bulk delete, source badge — back to C10X-16, so the abstraction gets promoted to a shared
primitive when its second consumer actually arrives, not before. It also closes two debts
earlier slices assigned to S-05 by name: the S-06 search state-filter gap (a regression S-05
itself would otherwise trigger) and generation idempotency (impl-review F5).

## Current State Analysis

Verified in the working tree at `132fa47`, not inferred from the research doc:

- **No state transition exists anywhere.** Every writer sets `state_id` once, at INSERT,
  with a hardcoded literal. `updateFlashcard` does `.update({ front, back })` only
  (`src/lib/flashcards.ts:101-109`); `STATE_REJECTED` is not defined; `state_id = 3` is
  never written by anything.
- **Candidates are invisible after a reload.** `listFlashcards` hard-filters
  `state_id = STATE_ACCEPTED` (`src/lib/flashcards.ts:63-70`), and `GeneratorForm` keeps
  the generation result in React state only, rendering a read-only `<ul>` with no controls
  and no navigation (`src/components/generate/GeneratorForm.tsx:315-332`). The seam is
  marked in source twice, naming S-05.
- **Editing a candidate already works.** `updateFlashcard` scopes by `public_id` + `deck_id`
  and never filters on state, so the existing edit endpoint edits a `generated` card as-is.
  The new work is accept and reject, not edit.
- **The database needs no policy change for the core.** `flashcard_update` gates on deck
  ownership via an EXISTS-join and references no columns
  (`supabase/migrations/20260705180246_init_core_schema.sql:126-142`), so an owner's
  `state_id` update already passes RLS. The corollary: nothing in the DB constrains *which*
  transitions are legal — that rule is application-level by construction.
- **Bulk has no precedent.** Every mutation on an existing row is single-row scoped by one
  `public_id`. The only multi-row write is `insertCandidates`' bulk INSERT. There is no
  checkbox primitive and no selection state in `src/` at all.
- **Two endpoint conventions coexist deliberately.** Card/deck CRUD is formData + redirect;
  `/api/generate` and `/api/study` are JSON, each carrying a source comment justifying the
  departure as React-island-driven.
- **Downstream of accept, everything is already handled.** `study_due_cards` gates on
  `f.state_id = 2`; `ensureSchedule` seeds lazily inside `listDueCards` and is deliberately
  decoupled from any accept path; S-03 pre-emptively guarded `rateCard`/`ensureSchedule`
  with `.eq("state_id", STATE_ACCEPTED)` so a reject after study is safe.
- **The S-06 search RPC returns every state.** `search_flashcards_in_deck` filters by deck
  only (`supabase/migrations/20260712162359_deck_keyword_search.sql:46-61`). This is dormant
  only because nothing writes `rejected` and candidates are invisible — both of which this
  slice changes.
- **The deck loader maps both card sources through ONE `.map()`** — the list branch
  (`listFlashcards`) and the search branch (the RPC) share it
  (`src/pages/decks/[publicId]/index.astro:52-65`), and the RPC's projection is a fixed five
  columns. So any field added to `FlashcardView` that only one branch can supply breaks the
  other silently: `npm run lint` is plain ESLint (a missing property is a `tsc` error, not a
  rule violation), `astro build` does not type-check, and no script or CI step runs
  `astro check` (`package.json:5-17`, `.github/workflows/ci.yml:20-25`). Plan-review F2.
- **`updated_at` is maintained by an unqualified trigger.** `flashcard_set_updated_at` is
  `before update ... for each row` moddatetime
  (`supabase/migrations/20260705180246_init_core_schema.sql:79-81`), so it fires on a
  `state_id`-only update too — and `FlashcardView.edited` is `updated_at !== created_at`,
  rendered as "Edytowano: …" (`src/components/flashcards/FlashcardItem.tsx:197`). Until now
  every UPDATE in the project *was* a content edit; this slice is the first that is not.
  Plan-review F4.

## Desired End State

A signed-in user who generates candidates is taken to a review screen for that generation,
where every candidate can be accepted, edited, or rejected individually, or several at once
via checkboxes and a selection toolbar. Accepted cards appear in the deck and enter study;
rejected cards keep their content and stay visible under the review screen's rejected view,
never deleted. Candidates left unreviewed are reachable later from a "N do przeglądu"
counter on the deck list — and the review screen is reachable **from the deck view at all
times**, including when nothing is pending, because that is the state in which a per-card
"odrzuć" needs somewhere to send the user (plan-review F3). The deck view gains that per-card
"odrzuć" and nothing else: its selection, bulk delete and source badge belong to C10X-16
(plan-review F8). Keyword search inside a deck returns accepted cards only, as it did before
candidates became writable in three states.

Verify by: generating candidates, reviewing them through both paths (single and bulk),
confirming accepted cards appear in `/decks/<id>` and in a study session while rejected ones
do not, and confirming the counters and the acceptance metric agree with the database.

### Key Discoveries

- `src/lib/flashcards.ts:101-109` — the shape a named transition function must mirror
  (`RETURNING` + `maybeSingle`, scoped by `deck_id` on top of RLS).
- `src/pages/api/study.ts:13-44,96-113` — the JSON endpoint template: Zod discriminated
  union on `action`, a local `json()` helper, `404 never 403`, and the benign
  `alreadyApplied` 200 for a no-op compare-and-set.
- `src/lib/decks.ts:38-45` — `deleteDeck`'s `RETURNING` comment states the rule the batch
  endpoint depends on: under RLS a foreign row's write is a **silent 0-row no-op**, so only
  a returned row proves it happened.
- `src/components/flashcards/FlashcardItem.tsx:170-228` — the fixed-height (`h-[40rem]`)
  3-region row, protected by comments against layout shift. Its one addition here (the third
  action) must preserve the identical footprint in read-only and edit mode.
- `src/components/Sidebar.astro:1-32` — `activeItem` is a typed union of three literals. The
  review route folds under `"decks"`, so the shell stays untouched.
- `context/foundation/lessons.md:96-101` — polish only your own components; settle the scope
  of neighbouring ones **before** building. This slice does touch neighbours; that scope was
  settled during planning and is written down below.
- `context/foundation/test-plan.md` §6.2, §6.5, §6.6 — row-based assertions paired with a
  positive control, `404 never 403`, file-level `Date.now().toString(36)` namespace, and the
  standing instruction to invert the duplication assertion when idempotency lands.

## What We're NOT Doing

- **No full FR-014 filter panel.** The review screen carries a minimal state scope
  (`generated` default, `rejected` view) and an optional `?generation=` narrowing — not date
  ranges, not a general state filter in the deck view.
- **No pagination.** Neither `listFlashcards` nor the new candidate read paginates. A
  generation caps at 15 cards; the `?generation=` scope keeps the common case small.
- **No RLS/policy change.** The existing EXISTS-join policies already permit an owner's
  `state_id` update and multi-row delete.
- **No schedule seeding on accept.** `ensureSchedule` stays lazy inside `listDueCards`;
  flipping `state_id` is sufficient. Do not call it from any path added here.
- **No DB-level transition guard.** No CHECK, no trigger — the rule lives in
  `src/lib/flashcards.ts`, consistent with `FRONT_MAX`/`BACK_MAX`.
- **No admin/metrics dashboard.** The acceptance metric is surfaced per generation session
  on the review screen only.
- **No keyboard-shortcut layer.** C10X-16's other half (keyboard-driven UX) stays parked.
- **No selection, bulk delete or source badge in the deck view** (plan-review F8). Those are
  C10X-16's, and they ship together with the promotion of `useSelection` /
  `CandidateSelectionBar` from review-local components to shared primitives — one commit, one
  second consumer, one honest abstraction. Consequences held here: the batch endpoint carries
  **no `delete` action** (C10X-16 adds it alongside `deleteFlashcards` and the confirmation
  modal), no `checkbox.tsx` is vendored into `src/components/ui/`, and
  `FlashcardWorkspace`/`DeckContentToolbar` are left structurally alone — only
  `FlashcardItem` gains the per-card "Odrzuć".
- **No new sidebar item.** The review route folds under `activeItem="decks"`.

## Implementation Approach

Server-first, in dependency order: the transition function and the reads that expose
candidates (Phase 1), then the one JSON endpoint that mutates them (Phase 2), then the two
UI surfaces that consume it (Phases 3 and 4), then the test layer that pins all of it
(Phase 5), then the separable idempotency debt (Phase 6).

**The transition graph is enforced in exactly one place** — a named function whose UPDATE
carries `.in("state_id", ALLOWED_FROM[target])`. An illegal or already-applied transition
matches zero rows, which under RLS is indistinguishable from a foreign row, so the endpoint
reports it as "not changed" rather than an error. That is the same shape S-03 used for
`rateCard`'s compare-and-set, and it makes double-clicks and retries benign by construction.

**Legal transitions** (final, including one derived decision — see Open Risks):

| From        | To         | Where triggered                                  |
| ----------- | ---------- | ------------------------------------------------ |
| `generated` | `accepted` | review screen — single and bulk                  |
| `generated` | `rejected` | review screen — single and bulk                  |
| `accepted`  | `rejected` | deck view — per-card "odrzuć"                    |
| `rejected`  | `accepted` | review screen, rejected view — "przywróć"        |

Nothing transitions **to** `generated`; a card never returns to being a candidate.

## Critical Implementation Details

**Astro route precedence at the `cards/` level.** The batch endpoint file
`src/pages/api/decks/[publicId]/cards/batch.ts` is a static segment sitting next to the
dynamic `[cardPublicId].ts`. Astro resolves the static segment first, so `/cards/batch`
reaches the new endpoint — and even if resolution ever changed, `batch` fails the `UUID_RE`
guard in `[cardPublicId].ts` and yields a 404 rather than a wrong write. This is load-bearing
enough to assert: Phase 5 must include a case that POSTs to `/cards/batch` and asserts a JSON
body, not a redirect.

**A zero-row write is not an error.** Under RLS, an UPDATE or DELETE against another
account's row (or against a card whose state disqualifies it) affects zero rows and reports
no error. Every write added here must `.select(...)` its identifiers back and derive the
per-id outcome from what returned — never from the absence of an error. This is the same
reason `deleteDeck` grew `RETURNING` during Phase 1 of the test rollout.

**The edit round-trip must return to the screen it started on.** `[cardPublicId].ts`
redirects to `/decks/<publicId>?saved=…`. Editing from the review screen needs to land back
on the review screen. Add an optional `from` form field whose only accepted value is
`"review"`, and build the target path **server-side** from the already-validated route
params (plus the `generation` value if one was posted). Never echo a client-supplied URL into
`Location`.

**Orphaned schedule rows are expected and must not be cleaned up.** A card accepted, studied,
then rejected keeps its `flashcard_schedule` row. It is invisible to every read gate
(`study_due_cards` filters `state_id = 2`; `ensureSchedule` and `rateCard` filter accepted),
and keeping it means a later "przywróć" resumes the real schedule instead of resetting the
card to New. Anticipated in a source comment at `src/lib/study.ts:267-271`. Do not add a
trigger, cascade, or cleanup pass.

**Selection state resets through a reload, deliberately.** After a successful batch call the
island reloads the page so the server re-renders the authoritative list. This keeps the
project's redirect-driven model, avoids reconciling optimistic client state with partial
results, and makes stale selection impossible. The batch response is still structured —
it is read to render the result message before the reload.

---

## Phase 1: Data layer — the first state transition and the candidate read path

### Overview

Everything server-side that has no HTTP surface: the transition function with its guard,
reads that can see non-accepted cards, the badge fields, the acceptance aggregate, and the
migration that stops the S-06 search RPC from leaking non-accepted cards.

### Changes Required:

#### 1. Flashcard state constants and the transition function

**File**: `src/lib/flashcards.ts`

**Intent**: Give the codebase its first lifecycle mutation, with the legal-transition graph
enforced in one place so no caller can bypass it.

**Contract**: Add `STATE_GENERATED = 1` and `STATE_REJECTED = 3` alongside the existing
`STATE_ACCEPTED` (`generations.ts` already exports its own `STATE_GENERATED`; import from
one home rather than duplicating a third literal). Add an `ALLOWED_FROM` map keyed by target
state, per the transition table above. Add:

```ts
setFlashcardState(supabase, deckId: number, cardPublicIds: string[], targetStateId: number)
// UPDATE flashcard SET state_id = target
//   WHERE public_id IN (...) AND deck_id = deckId AND state_id IN ALLOWED_FROM[target]
//   RETURNING public_id, state_id
```

The `RETURNING` list is the contract the endpoint diffs against its request to produce
per-id outcomes. `deleteFlashcards(supabase, deckId, cardPublicIds)` — the bulk sibling of
`deleteFlashcard` — is **not** added here; it ships with the bulk-delete UI in C10X-16
(plan-review F8).

#### 2. Reads that can see candidates

**File**: `src/lib/flashcards.ts`

**Intent**: Expose cards by state so the review screen exists at all, without changing what
the deck view shows.

**Contract**: `listFlashcards` keeps its accepted-only behaviour and signature (the deck view
must not change). Add `listFlashcardsByState(supabase, deckId, stateId, generationId?)` —
same column projection as `listFlashcards` plus `state_id`, `source_id`, and `generation_id`,
ordered `created_at desc`, optionally narrowed to one generation.

For the deck-list counter add `countCandidatesByDeck(supabase)` — **one** RLS-scoped query
(`select deck_id from flashcard where state_id = generated`) whose rows the caller groups into
a `Record<deckPublicId, number>`, mirroring `listDueCounts`' shape. Explicitly **not** a
per-deck `countCandidates(deckId)`: `src/pages/study/index.astro:14-15` already settled this
for the structurally identical due-count chip, with a source comment reading "never a per-deck
query (that would be an N+1 growing with the deck list)" (plan-review F5). The grouping key
needs the deck's `public_id`, so select it through the FK (`deck!inner(public_id)`) or map via
the internal `id` added in change #5 — either way one round-trip.

#### 3. Badge fields on the view model

**File**: `src/lib/flashcards.ts`

**Intent**: Let a row render its provenance and (on the review screen) its state without the
island learning about lookup ids.

**Contract**: Extend `FlashcardView` with **optional** `source?: "ai" | "manual"` and
`state?: "generated" | "accepted" | "rejected"`, mapped from the lookup ids server-side next
to `formatCardDate`. Only the review loader fills them; `listFlashcards` and the deck loader
are **untouched**.

Optional, not required, for two reasons that both bite (plan-review F2 + F8): the deck view's
source badge moved to C10X-16, so this slice has no deck-side consumer; and the deck loader
maps the list branch and the search branch through one `.map()`
(`decks/[publicId]/index.astro:52-65`), so a *required* field the RPC cannot supply would be
`undefined` at runtime with **no gate catching it** — ESLint does not report a missing
property, `astro build` does not type-check, and nothing runs `astro check`. Change #6 still
closes the RPC side at the data source so C10X-16 does not inherit the trap.

#### 4. Generation session lookup and the acceptance aggregate

**File**: `src/lib/generations.ts`

**Intent**: Resolve `?generation=<sessionPublicId>` to its internal id, and produce the
"zaakceptowano k z n" figure without a new column.

**Contract**: `getGenerationSessionByPublicId(supabase, publicId)` returning
`id, public_id, requested_count, generated_count` via `maybeSingle()`. Plus
`generationStateCounts(supabase, generationId)` returning
`{ accepted, rejected, pending }` derived from `flashcard.state_id` grouped in application
code over the session's rows (a session caps at 15 cards).

**The denominator is `accepted + rejected + pending` — the session's surviving rows — not a
stored counter** (plan-review F6). Neither counter works: `saved_count` is zeroed by the
compensating update (`src/lib/generations.ts:29-34`), and `generated_count` counts what the
model returned *before* Zod dropped some, so `skipped = generated - saved` can be > 0
(`src/pages/api/generate.ts:153-155`) and `k z generated_count` would carry a ceiling the user
can never reach while the three group counts sum to something else. Matches research.md §8
("a plain aggregate over `flashcard`"). Note both traps in a comment.

#### 5. Deck list needs its internal id server-side

**File**: `src/lib/decks.ts`

**Intent**: Let the deck list map candidate counts onto decks.

**Contract**: `listDecks` adds `id` to its projection. It stays server-side (the deck list
page renders directly, passing nothing to an island) — keep the existing comment's promise
by restating it at the call site.

#### 6. Migration: state filter in the search RPC

**File**: `supabase/migrations/<timestamp>_search_accepted_only.sql`

**Intent**: Close the S-06 gap before this slice makes it live. `search_flashcards_in_deck`
returns cards in every state; the moment `rejected` becomes writable and candidates exist,
search starts surfacing them in a view that otherwise hides them.

**Contract**: Redefine `public.search_flashcards_in_deck(bigint, text)` with `and f.state_id = 2`
added to the WHERE clause **and `f.source_id` added to the returned projection**, preserving
`security invoker`, `set search_path = ''`, the LIKE-metacharacter escaping and the
`order by f.created_at desc`.

**This is a `drop function` + `create function`, not a `create or replace`** (plan-review F2):
adding a column to `returns table (...)` is a return-type change, which Postgres refuses on
replace ("cannot change return type of existing function"). A drop also **loses the ACL**, so
re-applying `revoke all ... from anon` + `grant execute ... to authenticated` is mandatory
here, not cosmetic. Nothing in the DB depends on the function (the TS wrapper is not a
dependency), so the drop is safe without `cascade` — do not use `cascade`.

`source_id` has no consumer in this slice (the deck-view badge is C10X-16's). It ships anyway
for the same reason the state filter does: parity at the data source, so the next caller does
not inherit a projection that silently cannot feed `FlashcardView`.

#### 7. Migration: a state transition is not a content edit

**File**: `supabase/migrations/<timestamp>_flashcard_state_no_touch_updated_at.sql`

**Intent**: Stop the first non-content UPDATE in the project from lying about the card.

**Contract**: `flashcard_set_updated_at` is an unqualified `before update ... for each row`
moddatetime trigger (`20260705180246_init_core_schema.sql:79-81`), so flipping `state_id`
bumps `updated_at`; `FlashcardView.edited` is `updated_at !== created_at`
(`decks/[publicId]/index.astro:64`), rendered as "Edytowano: <date>"
(`FlashcardItem.tsx:197`). Without this, every accepted candidate arrives in the deck already
stamped as edited, and each "Odrzuć"/"Przywróć" restamps it (plan-review F4).

Narrow the trigger to the content columns:
`create or replace trigger flashcard_set_updated_at before update of front, back on flashcard
for each row execute function extensions.moddatetime (updated_at);` (`create or replace
trigger` is PG14+; the stack is PG15+ — otherwise `drop trigger` + `create trigger`). `update
of` fires only when a listed column appears in the SET list, which is exactly right here:
`updateFlashcard` sets `front, back` only and `setFlashcardState` sets `state_id` only. Note in
a comment that a future writer touching content *and* other columns in one statement still
fires it — intended.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` succeeds (route/content types)
- Type checking and linting pass: `npm run lint`
- Migrations apply cleanly on a reset stack: `npm run db:start` then `npx supabase db reset`
- Existing suite still green: `npm test`
- Search RPC returns only accepted cards: a psql query against the local stack for a deck
  holding one card per state returns exactly the accepted one
- Supabase types regenerated for the RPC's new return shape: `npm run db:types` (this — not
  `astro sync` — is what writes `src/db/database.types.ts`; see `package.json:17`), and the
  regenerated file leaves `npm run lint` green
- The search RPC's grants survived the drop: `has_function_privilege('anon', …)` unchanged
  versus a pre-migration dump, `authenticated` still holds `EXECUTE`
- A `state_id`-only UPDATE leaves `updated_at` untouched: psql `update flashcard set state_id
  = 2 where … returning updated_at = created_at` comes back `true`, while an UPDATE of
  `front` still bumps it

#### Manual Verification:

- Deck view is visually and behaviourally unchanged (the `listFlashcards` signature and
  result shape did not move; `FlashcardView`'s new fields are optional and unfilled here)

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 2: The batch endpoint — accept and reject over JSON

### Overview

One JSON endpoint owns every multi-card mutation this slice introduces. Single-card actions
are a one-element array, so there is exactly one code path, one error contract, and one set
of tests per action.

### Changes Required:

#### 1. The batch endpoint

**File**: `src/pages/api/decks/[publicId]/cards/batch.ts`

**Intent**: Apply a state transition to a set of cards in one deck, and report which ids
actually changed — the structured result a bulk UI needs and a formData redirect cannot carry.

**Contract**: `POST`, JSON in and out, modelled on `src/pages/api/study.ts` (local `json()`
helper, Zod discriminated union on `action`, Polish copy). Body:

```ts
{ action: "setState", cardPublicIds: string[], state: "accepted" | "rejected" }
```

One member in the union today. `{ action: "delete", cardPublicIds }` is **deliberately absent**
— it ships with its UI and `deleteFlashcards` in C10X-16 (plan-review F8), because an endpoint
action with no caller is untested surface. The union shape is kept precisely so adding it there
is additive.

`cardPublicIds`: non-empty, max 100, every element matching `UUID_RE`. Responses:
`401` not signed in · `400` unparseable or invalid body · `404` deck absent or RLS-hidden
(never 403) · `500` transient DB failure · `200 { ok: true, changed: string[], skipped: string[] }`
where `skipped` is the requested set minus what `RETURNING` produced. An empty `changed` is a
**200, not an error** — it means every id was already in the target state, illegal for it, or
not the caller's; the client renders that as "nic nie zmieniono", mirroring `/api/study`'s
benign `alreadyApplied`.

Resolve the deck via `deckIdByPublicId` and branch on the query error before treating `null`
as not-found (lessons: SSR error-vs-empty), exactly as `study.ts:73-79` does.

#### 2. Edit round-trip back to the review screen

**File**: `src/pages/api/decks/[publicId]/cards/[cardPublicId].ts`

**Intent**: Let a candidate be edited from the review screen without the save bouncing the
user to the deck view.

**Contract**: Read an optional `from` form field; the only accepted value is `"review"`, and
an optional `generation` field is carried through only if it matches `UUID_RE`. Build both the
success target and the `errorUrl(...)` from the validated route params — `/decks/<publicId>/review`
(+ `?generation=…`) instead of `/decks/<publicId>`. No other behaviour changes; `state_id` and
`source_id` remain untouched, as the file's header comment already promises.

#### 3. Middleware coverage check

**File**: `src/middleware.ts`

**Intent**: Confirm, don't assume, that the new routes are guarded.

**Contract**: `PROTECTED_ROUTES` is prefix-matched and already contains `/api/decks` and
`/decks`, which covers `/api/decks/*/cards/batch` and `/decks/*/review`. No edit is expected —
verify and note it; if the review page were ever moved outside `/decks`, this becomes a real
change.

### Success Criteria:

#### Automated Verification:

- Type checking and linting pass: `npm run lint`
- Build succeeds: `npm run build`
- A smoke integration case drives `/cards/batch` through `callEndpoint` and gets a JSON body
  (not a redirect), proving route precedence against `[cardPublicId].ts`

#### Manual Verification:

- With the dev server running, a hand-issued `POST` to `/cards/batch` for a foreign deck's
  `publicId` answers `404` with a JSON body and writes nothing

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 3: Review screen and review-local selection

### Overview

The screen the whole slice exists for, plus the selection mechanism it needs — built
**review-local**, not as a shared primitive (plan-review F8). The review route folds under the
existing `decks` sidebar item, so the shell is untouched.

### Changes Required:

#### 1. Selection, local to the review island

**Files**: `src/components/review/useSelection.ts`,
`src/components/review/CandidateSelectionBar.tsx`

**Intent**: Bulk actions on the review screen — the one consumer this slice actually has.

**Contract**: `useSelection(ids: string[])` returns
`{ selected: Set<string>, isSelected(id), toggle(id), toggleAll(), clear(), count, allSelected, someSelected }`,
pruning any selected id no longer present in `ids`. `CandidateSelectionBar` is presentational:
it takes `count`, `total`, `allSelected`, `onToggleAll`, `onClear` and a list of actions
(`{ label, icon, variant, onRun }`), renders nothing when `count === 0`, and owns no state.

**Deliberately review-local, and deliberately not vendored**: it lives under
`src/components/review/` rather than `src/components/selection/`, and the checkbox is a bare
`<input type="checkbox">` (consistent with the existing bare `<select>`) rather than
`npx shadcn@latest add checkbox`. With one consumer there is nothing to keep the abstraction
honest, and a shared directory plus a vendored `ui/` primitive would both advertise a contract
this slice cannot validate. C10X-16 promotes both when it adds the deck-view consumer — a
mechanical move, and the shape above is already written for it.

#### 2. Review route

**File**: `src/pages/decks/[publicId]/review.astro`

**Intent**: Server-render the candidate list so it survives a reload — the gap that made this
slice necessary.

**Contract**: Loader mirrors `decks/[publicId]/index.astro`: resolve the deck (404 on a
genuine null, 500 on a query error, never a top-level `return` in frontmatter — see
lessons.md), then load cards via `listFlashcardsByState`. Params: `?state=rejected` switches
the list from `generated` (default) to `rejected`; `?generation=<sessionPublicId>` narrows to
one session and, when present, loads the session for the acceptance metric. Round-trip params
(`error`, `edit`, `saved`) follow the deck page's contract. `AuthenticatedLayout` with
`activeItem="decks"`.

#### 3. Review island

**Files**: `src/components/review/CandidateReviewWorkspace.tsx`,
`src/components/review/CandidateItem.tsx`

**Intent**: The per-card control that produces the acceptance metric, plus the bulk path that
must not bypass it.

**Contract**: `CandidateReviewWorkspace` is the single `client:load` island: owns selection
(via `useSelection`), inline-edit state (`activeEditId`, seeded from `?edit=`), and the batch
call. Actions map to the batch endpoint — `Akceptuj` / `Odrzuć` for `generated`, `Przywróć`
(→ accepted) for the `rejected` view — and each is available per card and over the selection.
Bulk performs the **same per-row state writes** as the single path (this is the checkable form
of the ticket's warning: the metric survives bulk automatically as long as no shortcut destroys
the per-row record — never delete instead of rejecting). After a response, render
`changed`/`skipped` as a short Polish message, then reload. `CandidateItem` renders the
checkbox, the state + source badges, front/back, per-card actions, and reuses the existing
inline-edit form posting to `[cardPublicId].ts` with `from="review"`. Empty states: no
candidates at all vs. none left in this generation vs. no rejected cards — three distinct
copies. Strip round-trip params on mount with `history.replaceState`, as
`FlashcardWorkspace.tsx:73-87` does.

#### 4. Acceptance metric

**File**: `src/pages/decks/[publicId]/review.astro` (+ the island's header area)

**Intent**: Make the PRD's primary success criterion visible where the behaviour it measures
happens.

**Contract**: When `?generation=` is present, show `zaakceptowano k z n` from
`generationStateCounts`, where `k` is `accepted` and **`n` is `accepted + rejected + pending`**
— the session's surviving rows, per change #4's denominator rule (plan-review F6). State
alongside how many are still pending. If `generated_count > n` (the model returned cards Zod
dropped), that difference is a *generation* fact, not an acceptance fact: show it separately or
not at all, never folded into `n`. Absent a `generation` param, no metric line.

#### 5. Entry point from the generator

**File**: `src/components/generate/GeneratorForm.tsx`

**Intent**: Connect the two halves of US-01 — the response already carries `deckPublicId` and
`sessionPublicId`, and today neither is used.

**Contract**: On success, the results section gains a primary link to
`/decks/<deckPublicId>/review?generation=<sessionPublicId>`. The read-only list stays as the
immediate preview; replace the `S-05 adds accept/edit/reject` comments with what the code now
does. This is the slice's own seam, not a neighbouring component — polish is in scope here.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` succeeds (new route)
- Type checking and linting pass: `npm run lint`
- Build succeeds: `npm run build`
- Existing suite still green: `npm test`

#### Manual Verification:

- Generate candidates → the link lands on the review screen showing exactly that session
- Accept one card individually; it disappears from the candidate list and appears in
  `/decks/<id>`
- Select several and reject in bulk; the result message reports the count and the cards move
  to the rejected view with their content intact
- Edit a candidate from the review screen; the save returns to the review screen (not the
  deck view), with the generation scope preserved
- "Przywróć" on the rejected view returns a card to the deck
- The acceptance metric matches what the database holds for that generation
- Reloading the review screen preserves everything (the reload-survival gap is closed)

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 4: Deck view integration — per-card reject, review entry point, counter

### Overview

The narrow half of deck-view integration: what the transition table and the reachability of the
rejected view actually require. Selection, bulk delete and the source badge were moved to
C10X-16 by plan-review F8, which also removes two of the three neighbouring components this
phase used to touch (lessons.md:96-101). What remains: `FlashcardItem` gains one action, the
deck view gains one link, the deck list gains one chip — and `FlashcardWorkspace` /
`DeckContentToolbar` keep their structure.

### Changes Required:

#### 1. Card row: per-card reject

**File**: `src/components/flashcards/FlashcardItem.tsx`

**Intent**: Realise `accepted → rejected` where the user sees the accepted card — S-02's
"reject ≠ delete" rule, for the first time.

**Contract**: Add a third action `Odrzuć` (→ `rejected` via the batch endpoint) alongside
Edytuj/Usuń. **The fixed `h-[40rem]` footprint and the read-only/edit parity are invariants** —
the footer grid becomes three columns in both modes, or the third action moves into the meta
row; either way both modes must occupy identical space. No checkbox and no source badge (both
C10X-16's), and no state badge either: every card in this view is accepted, so it would be the
constant-value noise S-02 rejected. Reject needs a confirmation affordance so it does not read
as a delete.

#### 2. A durable way back to the review screen

**Files**: `src/pages/decks/[publicId]/index.astro`,
`src/components/flashcards/FlashcardWorkspace.tsx`

**Intent**: Make the rejected view reachable at all times — without this, "Odrzuć" is a
one-way trap and "Przywróć" is unreachable (plan-review F3).

**Contract**: The deck view carries a **permanent** link to `/decks/<publicId>/review`,
independent of how many candidates are pending — the two existing routes in (the generator's
success link and the deck-list chip) both vanish once nothing is pending, which is exactly the
state a freshly rejected card lands in. Copy must read as access to review **and** the rejected
archive (e.g. "Przegląd / odrzucone"), not as a counter, so it does not look broken at zero.
Place it in the sticky toolbar block the workspace already renders
(`FlashcardWorkspace.tsx:100-108`) — as a sibling of `DeckContentToolbar`, **not inside it**, so
that component stays untouched (plan-review F9). `position: sticky` depends on the container
**not** having `overflow: hidden` (the comment at `:91-99` explains why the toolbar sits outside
the decorative panel) — preserve that.

A post-action message is **not** a substitute: the island reloads after a successful batch call
(see Critical Implementation Details), which destroys it.

#### 3. Deck list: candidates-to-review counter

**Files**: `src/pages/decks/index.astro`, `src/lib/flashcards.ts`

**Intent**: Surface pending candidates when the user no longer has the generation link.

**Contract**: The loader calls `countCandidatesByDeck` (Phase 1 change #2 — **one** grouped
query, not a per-deck count) and maps the counts onto the deck list. A deck with candidates
shows a `N do przeglądu` chip linking to `/decks/<publicId>/review`; decks with zero show
nothing — which is safe only because change #2 gives the deck view its own permanent link.

Branch on **both** query errors (plan-review F10): `decks/index.astro:8` currently reads
`const { data: decks } = …` and drops `error`, the exact "SSR error-vs-empty" case lessons.md
names and that `generate.astro:12` and `study/index.astro:14-17` both handle. Deck-list failure
→ the deck-list error state, mirroring `study/index.astro:17`. Count failure → render the decks
**without** chips rather than implying zero candidates.

### Success Criteria:

#### Automated Verification:

- Type checking and linting pass: `npm run lint`
- Build succeeds: `npm run build`
- Existing suite still green: `npm test`

#### Manual Verification:

- Per-card "Odrzuć" moves an accepted card out of the deck and into the review screen's
  rejected view — content intact, not deleted
- The review link in the deck view is present and works when the deck has **zero** pending
  candidates, and "Przywróć" from there returns the card
- An accepted candidate shows "Edytowano: —" — accepting did not stamp it as edited
- A rejected card no longer appears in a study session; a re-accepted one does
- The card row's height and the read-only ↔ edit transition are unchanged (no layout shift)
- The deck list counter matches the number of candidates and links to the right review screen
- Keyword search in a deck returns accepted cards only (the Phase 1 migration, seen from the UI)

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 5: Tests — full §6.2/§6.4 pattern, plus selective mutation testing

### Overview

This slice adds the project's first lifecycle transition and its first multi-row mutation.
Both classes are exactly what the test plan's Risk #1 names, and
`deleteDeck` already proved once that a cross-account write can look like success from the
outside. Tests follow the cookbook: drive the real endpoint with a real session cookie against
the real local Postgres, row-based assertions, positive controls, 404 never 403.

### Changes Required:

#### 1. Cross-account denial for the new write paths

**File**: `tests/isolation/flashcards.test.ts`

**Intent**: §6.2 requires a new case for an existing resource to go in that resource's file —
these are flashcard writes, so they belong here, not in a new file.

**Contract**: Account B targets account A's cards via `/cards/batch` with `setState`. Assert B
gets `404` **and** that A's rows are unchanged when re-read with A's own client
(column-for-column, including `state_id` *and* `updated_at` — the trigger narrowed in Phase 1
makes that column a meaningful witness), with A's own successful batch call as the positive
control in the same `describe`. The bulk-`delete` denial case ships with the action itself in
C10X-16 (plan-review F8); per-card delete denial is already covered in this file.

#### 2. Transition and batch behaviour

**File**: `tests/review/candidates.test.ts`

**Intent**: Pin the transition graph and the partial-result contract — the claims no other
test can make.

**Contract**: Cases: every legal transition writes the expected `state_id`; every illegal one
(anything → `generated`; a no-op repeat) returns `200` with the id in `skipped` and leaves the
row untouched; a mixed batch (some legal, some not) reports both lists correctly and writes
only the legal subset; the route-precedence case from Phase 2 (POST `/cards/batch` returns
JSON, not a redirect); an accepted card enters a study session and a rejected one does not
(the gate, read through `listDueCards`); search returns accepted cards only **and carries
`source_id`** (the Phase 1 drop+create, asserted at the data layer since no UI consumes it yet);
a transition leaves `updated_at` equal to `created_at` while a content edit still bumps it
(plan-review F4 — the only automated witness for that migration). File-level
`Date.now().toString(36)` namespace per §6.5, and every count scoped twice — by the namespace
and by the test's own deck.

#### 3. Deliberate-breakage check

**File**: `context/foundation/test-plan.md` §6.6 (documentation of the run)

**Intent**: §6.6's standing precedent — a green suite proves nothing until something has been
made to go red.

**Contract**: Neuter the transition guard (drop the `.in("state_id", ALLOWED_FROM[target])`
predicate) and confirm exactly the illegal-transition assertions go red while the rest stay
green. Separately, for the isolation cases, neuter `deck_select` and `flashcard_update` with
`using (true)` **together** (a single-policy neuter stops at the next policy down and still
answers 404 — §6.6 records why). Restore by `alter policy`, then **verify** the restore:
dump `qual`/`with_check` from `pg_policies` before and after and `diff`. Record observed
results in §6.6.

Third variant, for the trigger migration: restore the unqualified trigger
(`before update on flashcard`) and confirm exactly the `updated_at` assertion goes red — a
migration whose only effect is a *non*-event needs its own red run, or it proves nothing.

#### 4. Selective mutation testing on the transition function

**Files**: `context/changes/candidate-review/mutation-register.md` (new)

**Intent**: Check that the assertions actually observe the state gate rather than merely
passing — the gate is a single predicate, which is exactly where a surviving mutant is
meaningful.

**Contract**: Run Stryker narrowed to the transition function's line range
(`npx stryker run --mutate "src/lib/flashcards.ts:<start>-<end>"`), leaving
`stryker.config.json`'s permanent `mutate` list alone. Keep `OPENROUTER_API_KEY` unset.
Review survived mutants one by one and add an assertion only where the mutant is a
user-visible or business-relevant bug — do not chase the score. Record each decision in
`mutation-register.md`, following the precedent at
`context/archive/2026-07-18-mutation-generate-risk2/mutation-register.md`.

#### 5. Test-plan doc-sync

**File**: `context/foundation/test-plan.md`

**Intent**: Keep the plan's coverage claims true — §6.6 is where a gap is meant to be visible.

**Contract**: Add a per-phase note recording what these tests do and do not prove, and update
the §6.2/§6.7-style cookbook with a short "adding a test for the state-transition path"
entry naming the batch endpoint, the `skipped`-not-error contract, and the two-axes-of-state
trap (`flashcard.state_id` vs `flashcard_schedule.srs_state`).

### Success Criteria:

#### Automated Verification:

- Full suite green: `npm test`
- Linting passes: `npm run lint`
- Each deliberate-breakage variant turns exactly the expected assertions red and nothing else
- Policy restore verified by a `pg_policies` before/after diff that comes back identical

#### Manual Verification:

- Survived mutants reviewed one by one, with each keep/fix decision written down and justified

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 6: Generation idempotency (separable — impl-review F5)

### Overview

The debt S-04's impl-review deferred here by name (F5, ACCEPTED-AS-RULE), with a
characterization test already waiting to be inverted. Fully separable: nothing in Phases 1–5
depends on it, and dropping it costs only the decision to skip this phase.

### Changes Required:

#### 1. Migration: idempotency key

**File**: `supabase/migrations/<timestamp>_generation_idempotency_key.sql`

**Intent**: Give the server something to dedup on. `(user_id, source_text)` is the wrong key —
a user may legitimately regenerate the same text with a different count or language.

**Contract**: Add a nullable `idempotency_key uuid` to `generation_session` plus a partial
unique index over `(user_id, idempotency_key) where idempotency_key is not null`. Nullable so
existing rows and any client that omits the key keep working.

**The column is written ONLY on the `succeeded` insert.** The two failure-path inserts
(`generate.ts:135-147` transport/timeout, `:160-172` zero-saved) leave it `null` — deliberately,
and load-bearing (plan-review F1). The index covers every row regardless of `status`, while the
dedup lookup below matches only a *succeeded* session; if a failed audit row carried the key,
"Ponów" — which replays the payload **verbatim**, key included — would collide on its own
session insert and answer `500 "Nie udało się zapisać sesji generacji"`. Retry would be
permanently dead after any failure, which is precisely the flow FR-018 exists for. Comment this
in the migration and next to each failure-path insert, because the null looks like an oversight.

#### 2. Client mints one key per attempt

**File**: `src/components/generate/GeneratorForm.tsx`

**Intent**: The retry must be recognisable as the *same* attempt.

**Contract**: Mint a `crypto.randomUUID()` when a generation is submitted, store it in the
existing `lastPayload` ref, and have "Ponów" replay it **verbatim** — the ref already replays
the payload unchanged (`:106,175-177`), so the key rides along for free. A new submit (not a
retry) mints a fresh key.

#### 3. Endpoint checks the key before calling the LLM

**File**: `src/pages/api/generate.ts`

**Intent**: Kill the duplicate before it costs a paid LLM call, not after.

**Contract**: Accept an optional `idempotencyKey` (UUID) in the request schema. When present,
look up an existing succeeded session for `(user_id, key)` **before** `generateCandidates`,
exactly where `deckNameExists` is checked today (`:107-113`), and if found return that
session's result instead of generating again. Replace the deliberate "not idempotent" comment at
`:26-30` with what the code now guarantees.

**Two things the lookup alone does not cover** (plan-review F1):

- **The 23505 on the session insert must map to the replay path, not to a 500.** The lookup
  loses the race it exists for: in the real duplication window request 1 is still committing
  when the client aborts at 55 s, so request 2 finds nothing, generates, and only then collides.
  Catch `error.code === "23505"` on the `succeeded` insert, re-read the session for
  `(user_id, key)` and return **that** — a benign 200, the same shape `/api/study` uses for
  `alreadyApplied`. Without it the user sees an error while request 1's cards did land.
- **Replaying the result needs the cards and the deck, and `generation_session` stores
  neither.** There is no `deck_id` column on the session (see the S-04 migration). Read the
  session's cards back by `generation_id` and derive `deckPublicId` from them (the flashcard →
  deck FK), so a replay answers with the same `{ candidates, counts, deckPublicId,
  sessionPublicId }` shape — including for the `newDeckName` path, where the first attempt
  already created the deck and a second `createDeck` would 409. Do **not** reconstruct the deck
  by name.

#### 4. Invert the characterization test

**File**: `tests/generation/generate.test.ts`

**Intent**: The test plan's standing instruction: when idempotency lands the first `it()` goes
red, and the correct action is to invert the assertion — **not** to delete the test.

**Contract**: Two identical POSTs carrying the same `idempotencyKey` now assert **one**
succeeded session and one `generation_id`. Keep a case proving that two requests with
*different* keys still produce two sessions, so the dedup is provably keyed and not blanket.
Add a case for the F1 path that would otherwise regress silently: after a **failed** session
exists for a key (drive it by pointing the generation at a failure — or insert the failed audit
row directly with an RLS-scoped client, the `createNonAcceptedCard` precedent), the same key
still generates and succeeds. Update the file's header comment (`:20-22`) and the
`newDeckName`-409 warning, which still holds.

#### 5. Doc-sync

**Files**: `context/foundation/test-plan.md`, `context/foundation/roadmap.md`

**Intent**: Risk #2 moves from *characterized* to *covered*; the roadmap records the outcome.

**Contract**: In `test-plan.md`, flip Risk #2's §3 Phase 2 note and the §6.6 Phase-2 entry
from "measured, not protected" to covered, citing this change. In `roadmap.md`, update S-05's
**Outcome** only — `/10x-archive` owns the Status → done flip and the `## Done` entry
(lessons.md:166-171). Do not set Status here.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- `src/db/database.types.ts` regenerated for the new column via `npm run db:types` — `astro
  sync` does **not** write that file (`package.json:17`); run `astro sync` separately if routes
  moved
- Type checking and linting pass: `npm run lint`
- Full suite green with the inverted assertion: `npm test`
- A dropped-key control still generates twice (proves the dedup is keyed, not blanket)
- A key whose only prior session is `failed` still generates and succeeds (proves the index
  does not eat the FR-018 retry)

#### Manual Verification:

- With the dev server running, a generation that is retried via "Ponów" after an induced
  client timeout produces exactly one set of candidates
- The review screen for that generation shows one session's worth of cards, not two

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before the change is handed to review.

---

## Testing Strategy

### Unit Tests

- The transition graph as a table: for each `(from, to)` pair, legal pairs write and illegal
  pairs are skipped. This is the one piece of logic here with a real branch structure.
- No unit test for the view-model mapping (`state_id` → badge string) beyond what type
  checking already guarantees.

### Integration Tests

- Cross-account denial on `setState` through `/cards/batch`, paired with the owner's positive
  control (`tests/isolation/flashcards.test.ts`).
- Transition gate, mixed-batch partial results, route precedence, the study gate for accepted
  vs rejected, the search state filter, and the `updated_at` non-event
  (`tests/review/candidates.test.ts`).
- The inverted generation-idempotency case (`tests/generation/generate.test.ts`, Phase 6).

### Manual Testing Steps

1. Generate candidates into a new deck; follow the link to the review screen.
2. Accept one candidate individually; confirm it appears in the deck, in a study session, and
   shows "Edytowano: —" (accepting is not an edit).
3. Select the rest and reject in bulk; confirm the result message, then confirm they are in
   the rejected view with content intact and absent from study.
4. Edit a candidate from the review screen; confirm the save returns to the review screen.
5. "Przywróć" a rejected card; confirm it returns to the deck.
6. In the deck view — now with **zero** pending candidates — reject an accepted card per-card,
   then reach the rejected view through the deck view's permanent review link and restore it.
   This is the F3 path; do it in that order or the link is not actually under test.
7. Reload every screen at each step — nothing may be lost.
8. Search inside the deck; confirm only accepted cards match.
9. Return to `/decks` and confirm the "N do przeglądu" counter agrees with reality, and that a
   deck with zero candidates shows no chip while its review screen stays reachable from inside.

## Performance Considerations

No pagination anywhere, by decision. The bounds that make that safe: a generation caps at 15
cards, the batch endpoint caps at 100 ids per request, and the deck-list counter reads only
`state_id = generated` rows for the signed-in user. If a deck ever accumulates hundreds of
candidates the review screen degrades gracefully (a long list), not incorrectly — revisit with
FR-014's filter panel, not with a hotfix here.

## Migration Notes

Three migrations, none backfilling or rewriting data: the search state filter + `source_id`
projection (Phase 1 #6), the `updated_at` trigger narrowing (Phase 1 #7), and the idempotency
key (Phase 6). Per lessons.md, a cloud migration is a step distinct from the app deploy —
`supabase db push` must run from this change's worktree, and `db push --include-all` is the
correct form for a pending migration older than the last one on remote.

Two are **replacements of existing objects**, not pure additions, so both need their rollback
written down before `db push`: keep the prior `create or replace function` body (with its
grants) and the prior unqualified `create trigger` statement to hand — reverting either is one
statement, but only if the old definition is not being reconstructed from memory (§6.6's rule
about verifying a restore rather than assuming it applies here too). The RPC one is a
`drop function` + `create function`, so it is briefly absent inside the transaction; grants must
be re-applied in the same migration.

After `db reset` or `db push`, regenerate types with `npm run db:types` — the RPC's return shape
and the new column both land in `src/db/database.types.ts`, which `astro sync` never touches.

Existing candidate rows written by S-04 keep `state_id = generated` and simply become visible
for the first time. Nothing needs migrating for them.

## References

- Research: `context/changes/candidate-review/research.md`
- Prior slice that owns the generation seam: `context/archive/2026-07-11-ai-candidate-generation/`
  (`plan.md:94-99,443-471`, `reviews/impl-review.md:95-108` — F5)
- Reject ≠ delete, badge deferral: `context/archive/2026-07-09-manual-card-crud/plan.md:87-88,91-92`
- Accepted-only gates and lazy seeding: `context/archive/2026-07-24-srs-study-session/plan.md:82-84,119-127`
- JSON endpoint template: `src/pages/api/study.ts:13-44,96-113`
- Test cookbook: `context/foundation/test-plan.md` §6.2, §6.4, §6.5, §6.6
- Mutation-register precedent: `context/archive/2026-07-18-mutation-generate-risk2/mutation-register.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer — the first state transition and the candidate read path

#### Automated

- [x] 1.1 `npx astro sync` succeeds (route/content types) — feaca47
- [x] 1.2 Type checking and linting pass — feaca47
- [x] 1.3 Migrations apply cleanly on a reset stack — feaca47
- [x] 1.4 Existing suite still green — feaca47
- [x] 1.5 Search RPC returns only accepted cards — feaca47
- [x] 1.7 Supabase types regenerated via `npm run db:types`, lint still green — feaca47
- [x] 1.8 Search RPC grants survived the drop (anon/authenticated unchanged) — feaca47
- [x] 1.9 A `state_id`-only UPDATE leaves `updated_at` untouched; a content UPDATE bumps it — feaca47

#### Manual

- [x] 1.6 Deck view is visually and behaviourally unchanged — feaca47

### Phase 2: The batch endpoint — accept and reject over JSON

#### Automated

- [x] 2.1 Type checking and linting pass — 8491e0c
- [x] 2.2 Build succeeds — 8491e0c
- [x] 2.3 Smoke case proves `/cards/batch` returns JSON, not a redirect — 8491e0c

#### Manual

- [x] 2.4 Foreign deck's `publicId` answers 404 JSON and writes nothing — 8491e0c

### Phase 3: Review screen and review-local selection

#### Automated

- [x] 3.1 `npx astro sync` succeeds (new route)
- [x] 3.2 Type checking and linting pass
- [x] 3.3 Build succeeds
- [x] 3.4 Existing suite still green

#### Manual

- [x] 3.5 Generator link lands on the review screen scoped to that session
- [x] 3.6 Single accept moves a card into the deck
- [x] 3.7 Bulk reject reports its count and preserves card content
- [x] 3.8 Edit from review returns to review with the generation scope preserved
- [x] 3.9 "Przywróć" returns a rejected card to the deck
- [x] 3.10 Acceptance metric matches the database
- [x] 3.11 Every review screen survives a reload

### Phase 4: Deck view integration — per-card reject, review entry point, counter

#### Automated

- [ ] 4.1 Type checking and linting pass
- [ ] 4.2 Build succeeds
- [ ] 4.3 Existing suite still green

#### Manual

- [ ] 4.6 Per-card reject moves the card to the rejected view, content intact
- [ ] 4.7 Rejected card is absent from study; re-accepted card is present
- [ ] 4.8 Card row height and edit-mode parity unchanged
- [ ] 4.9 Deck list counter matches and links correctly
- [ ] 4.10 Keyword search returns accepted cards only
- [ ] 4.11 Review link works from a deck with zero pending candidates; "Przywróć" returns the card
- [ ] 4.12 An accepted candidate shows "Edytowano: —"

### Phase 5: Tests — full §6.2/§6.4 pattern, plus selective mutation testing

#### Automated

- [ ] 5.1 Full suite green
- [ ] 5.2 Linting passes
- [ ] 5.3 Each deliberate-breakage variant turns exactly the expected assertions red
- [ ] 5.4 Policy restore verified by a `pg_policies` before/after diff

#### Manual

- [ ] 5.5 Survived mutants reviewed one by one with decisions recorded

### Phase 6: Generation idempotency (separable — impl-review F5)

#### Automated

- [ ] 6.1 Migration applies cleanly
- [ ] 6.2 Database types regenerated via `npm run db:types`
- [ ] 6.3 Type checking and linting pass
- [ ] 6.4 Full suite green with the inverted assertion
- [ ] 6.5 Dropped-key control still generates twice
- [ ] 6.8 A key whose only prior session is `failed` still generates and succeeds

#### Manual

- [ ] 6.6 A retried generation produces exactly one set of candidates
- [ ] 6.7 The review screen shows one session's worth of cards, not two
