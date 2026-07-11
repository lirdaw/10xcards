# Manual Flashcard CRUD (S-02) Implementation Plan

## Overview

Enable a signed-in user to manually author, browse, edit, and permanently delete
flashcards inside one of their decks. The `flashcard` table already exists (created by
F-01), and the deck detail page `/decks/[publicId]` already ships a placeholder empty
state built as the stable anchor this slice hangs card UI on. We replace that placeholder
with a card workspace: a content toolbar ("add card", with a reserved slot for the future
S-06 search), a card list, per-card inline edit, and single delete with confirmation.
All mutations follow the established native-form-POST → redirect-with-`?error=` round-trip
pattern from S-01; all reads honour RLS through the SSR anon-key client.

Manual authorship (FR-007) is recorded with a new `flashcard_source` lookup table
(`manual` / `ai`) mirroring the existing `flashcard_state` convention; manually created
cards are inserted as `state = accepted` and `source = manual`.

## Current State Analysis

- **Data layer.** `flashcard` exists with `public_id uuid` (front-facing handle),
  `deck_id bigint` (internal FK to `deck.id`), `front`/`back` (`NOT NULL`,
  `char_length > 0`, **no upper bound**), `state_id smallint NOT NULL` (no default; the
  migration comment pins S-02 inserts to `accepted`), `created_at`/`updated_at` with a
  `moddatetime` trigger. RLS is live: SELECT/INSERT/UPDATE/DELETE policies scope every row
  to the owning user via a `deck` join (`supabase/migrations/20260705180246_init_core_schema.sql:126-142`).
  There is **no column distinguishing manually authored from generated cards** — FR-007's
  "recorded as manually authored" has nowhere to live yet.
- **Deck detail page.** `src/pages/decks/[publicId]/index.astro:67-69` renders a static
  "Brak fiszek w tej talii." placeholder. The loader already implements the not-found
  pattern (`Astro.response.status = 404`, never a top-level `return`) and the rename/delete
  error round-trip (`src/pages/decks/[publicId]/index.astro:16-26`). This slice replaces
  the placeholder block only.
- **Data helper.** `src/lib/decks.ts` is the model to mirror: thin query functions taking
  an already-created RLS-scoped client, addressing decks by `public_id`, leaving Polish
  error mapping to the endpoints. No flashcard helper exists yet.
- **Endpoints.** `src/pages/api/decks/*` establish the form-POST → redirect style: no JSON,
  no explicit status codes (relies on 302), `createClient` null-check, `locals.user`
  null-check → `/auth/signin`, `UUID_RE` guard on route params before they land in a
  redirect `Location`, Postgres `23505` mapping, 0-row update → 404.
- **Components.** `src/components/decks/` holds `CreateDeckModal.tsx` and `DeckActions.tsx`;
  both are `client:load` islands using native `<form method="POST">`, seeding server errors
  from `?error=&open=` and stripping those params on mount. Reusable primitives:
  `ui/Modal.tsx`, `ui/button.tsx`, `ui/input.tsx`, `ui/label.tsx`, `auth/ServerError.tsx`,
  `auth/SubmitButton.tsx`. **There is no `textarea` primitive.**
- **Middleware.** `PROTECTED_ROUTES = ["/dashboard","/decks","/api/decks"]` guards by
  `startsWith`, so new endpoints under `/api/decks/[publicId]/cards/...` are already
  protected — no middleware change needed.

## Desired End State

On `/decks/[publicId]`, the user sees a content toolbar and the deck's cards. They can:
add a card (modal, two multi-line fields), edit any card in place (inline textareas →
save), and delete a single card (confirmation modal). Every card is `accepted` + `manual`,
belongs to that deck and that user only, and is invisible and immutable to any other account
(RLS). The list renders in the data helper's default order (`created_at desc`, newest first).
A DB failure in the loader shows a distinct error state, not an empty list.

Verify by: creating a card and seeing it listed; editing it inline and seeing the change
persist across reload; deleting one via the modal; and a two-account isolation proof that
user B cannot read, edit, or delete user A's cards.

### Key Discoveries:

- Cards must be inserted with an explicit `state_id` (no DB default) — pin to `accepted`
  per the schema comment (`supabase/migrations/20260705180246_init_core_schema.sql:21-23`).
- Routes expose only `public_id`; inserting a card needs the internal `deck.id`, so the
  create endpoint must resolve `public_id → deck.id` server-side
  (`src/lib/decks.ts:15` selects only `public_id, name` today — add a dedicated resolver).
- The modal error round-trip and the on-mount URL-param cleanup effect
  (`src/components/decks/CreateDeckModal.tsx:25-32`) are the exact pattern for the create
  modal; inline edit reuses the same idea with an `?edit=<cardPublicId>` param.
- 404-not-403 and "no top-level return in `.astro`" are enforced lessons
  (`context/foundation/lessons.md:82-87`); the loader already follows them.
- Loaders must branch on the query `error`, not treat it as empty
  (`context/foundation/lessons.md:68-73`).

## What We're NOT Doing

- **No keyword search** — that is S-06 / C10X-9 (FR-015). The toolbar leaves a labelled
  gap for it; no search input ships here.
- **No bulk delete / select-mode** — a multi-select "tick several cards and delete them"
  flow was considered for S-02 but is **deliberately deferred to a separate future task**
  (to be filed on Jira under "Pomysły"). S-02 deletes one card at a time.
- **No sorting control** — a client-side sort (newest / oldest / alphabetical × direction)
  was considered for S-02 but is **deliberately deferred to a separate future task** (Jira
  "Pomysły"). The list ships in the helper's default `created_at desc` order.
- **No `reject` action or state UI** — reject is part of candidate review (S-05); this
  slice's delete is a permanent row removal, distinct from reject (FR-010).
- **No AI generation, no `generated` cards, no GenerationSession** (S-04). The `source`
  lookup includes `ai` for forward-compatibility but S-02 only ever writes `manual`.
- **No state/source badge on the list** — every S-02 card is `accepted` + `manual`, so a
  single-value badge is noise; badges arrive with S-05.
- **No DB-level length limit** — front/back max length is a business rule (client + endpoint),
  not a DB CHECK; the database keeps only the F-01 `NOT NULL` + `char_length > 0` (non-empty)
  constraints.
- **No filtering by state or date** (FR-014, nice-to-have, parked) and **no pagination /
  virtualization** — a deck's cards are loaded in full (MVP volumes).
- **No soft-delete / undo / trash** — deletion is permanent (C10X-14 is the future home).
- **No SRS scheduling fields** — those arrive with S-03.

### Also changed (addendum — shell UX polish beyond the plan)

Recorded post-implementation (impl-review F2). The p3 commit shipped app-shell UX
alongside the card CRUD, none of it touching data or security surface:

- **`ui/Modal.tsx`** — in-scope bugfix: a `mousedown` guard so a drag that starts
  inside modal content (e.g. resizing the new card Textareas) and releases on the
  backdrop no longer closes the modal.
- **`Sidebar.astro`** — collapsible icon-rail with `localStorage` persistence + per-item
  icons (widest scope stretch; app-shell only).
- **`AuthenticatedLayout.astro`** — full-height flex shell + footer with mock/placeholder
  roadmap links (Pomoc/Prywatność/Kontakt as non-navigable `<span>`s, visual only) — this
  does NOT satisfy FR-013; FR-013 remains open.
- **`ui/button.tsx`, `auth/SubmitButton.tsx`, `decks/CreateDeckModal.tsx`** — destructive/
  purple restyle for visual consistency with the new card controls.
- **`global.css`** — cosmetic `custom-scrollbar` + `flashcard-panel` utilities
  (`prefers-reduced-motion`-disabled).

The full-height-scrollbar shell restructure remains deferred (see change.md → Deferred ideas).

## Implementation Approach

Build bottom-up, mirroring S-01's "schema → data helper → read/create → mutate" arc, but
the app shell and deck detail page already exist, so we start at the schema delta and end
with the interactive workspace.

The card list becomes a single `client:load` React island that receives the server-loaded
cards as props and owns the small amount of view state the UI needs: whether the create
modal is open, and which card (if any) is in inline-edit mode. Mutations do **not** go
through the island's state — they remain native `<form method="POST">` submissions to
dedicated endpoints, so the whole slice keeps S-01's no-fetch, redirect-driven model and its
error round-trip. Create, inline edit, and single delete are all server round-trips.

## Critical Implementation Details

- **State/source IDs are pinned constants.** `flashcard_state` seeds `accepted = 2` and the
  new `flashcard_source` seeds `manual = 1`. The data helper references these as named
  constants with a comment pointing at the seed, rather than re-querying the lookup on every
  insert (matches how the schema already treats `state_id` as a known value).
- **Length limits are a business rule, not a DB constraint.** `front`/`back` maximum lengths
  live as named constants (`FRONT_MAX = 200`, `BACK_MAX = 1000`) enforced in two places only
  — the client modal/edit form (`preventDefault`) and the endpoint (after `trim`). They carry
  a comment noting they are a business rule, not a DB CHECK, and can be changed **without a
  migration**. The database enforces only non-emptiness (F-01's `char_length > 0`).
- **Two distinct round-trip params.** Create uses `?error=&open=create-card`; inline edit
  uses `?error=&edit=<cardPublicId>`; single delete errors carry only `?error=` (page
  banner, no re-open). The island strips `open`, `edit`, and `error` from the URL on mount
  (as `CreateDeckModal` does) so a reload never re-enters a stale modal/edit.

## Phase 1: Schema delta + data layer + textarea primitive

### Overview

Add the authorship marker at the database, regenerate types, and create the flashcard query
helper plus the missing `textarea` UI primitive — everything the UI phases build on, with no
user-visible change yet. No length constraints are added to the database.

### Changes Required:

#### 1. Migration — source lookup + marker column

**File**: `supabase/migrations/<new-timestamp>_manual_card_source.sql` (create via `npx supabase migration new manual_card_source`)

**Intent**: Record manual-vs-AI authorship consistent with the existing lookup-table + RLS
conventions. The `flashcard` table is empty (S-01 created no cards), so a `NOT NULL` marker
column needs no backfill. No upper-bound length CHECKs — max length is a business rule (see
Critical Implementation Details).

**Contract**: New `flashcard_source` lookup mirroring `flashcard_state`; a `NOT NULL`
`source_id` FK on `flashcard`; grants + RLS for the new lookup. Load-bearing SQL:

```sql
create table flashcard_source (
  id   smallint primary key,
  code text     not null unique check (code in ('manual', 'ai'))
);
insert into flashcard_source (id, code) values (1, 'manual'), (2, 'ai');

alter table flashcard
  add column source_id smallint not null references flashcard_source (id);
create index flashcard_source_id_idx on flashcard (source_id);

alter table flashcard_source enable row level security;
revoke all on flashcard_source from anon;
grant select on flashcard_source to authenticated;
create policy flashcard_source_select on flashcard_source for select to authenticated
  using (true);
```

The F-01 `front`/`back` `NOT NULL` + `char_length > 0` checks are left untouched — no upper
bound is added.

#### 2. Regenerate database types

**File**: `src/db/database.types.ts`

**Intent**: Reflect the new `flashcard_source` table and `flashcard.source_id` column so the
data helper and endpoints are type-safe.

**Contract**: Regenerate with `npx supabase gen types typescript --local > src/db/database.types.ts`
against the freshly reset local stack (or hand-add the `flashcard_source` table plus
`source_id: number` on `flashcard` Row/Insert/Update if Docker is unavailable). `Insert`
for `flashcard` must now require `source_id`.

#### 3. Flashcard data helper

**File**: `src/lib/flashcards.ts` (new)

**Intent**: One home for card queries, mirroring `src/lib/decks.ts` — each function takes an
RLS-scoped client, addresses cards by `public_id`, resolves decks by `public_id`, and leaves
Polish error mapping to endpoints. Also the single source of the business-rule length limits.

**Contract**: Named constants `STATE_ACCEPTED = 2`, `SOURCE_MANUAL = 1` (comment → seed) and
`FRONT_MAX = 200`, `BACK_MAX = 1000` (comment: "business rule, not a DB CHECK — change
without a migration"). Functions: `deckIdByPublicId(supabase, deckPublicId)` (returns the raw
`{ data, error }` like the other helpers — `data.id` is the internal id, stays
server-side; callers MUST branch on `error` before treating `data == null` as
"not found", so a transient DB error is never mistaken for a 404, per
`context/foundation/lessons.md:68-73`); `listFlashcards(supabase, deckId)` (select `public_id, front,
back, created_at` ordered `created_at desc`); `createFlashcard(supabase, deckId, front, back)`
(insert with `state_id: STATE_ACCEPTED, source_id: SOURCE_MANUAL`); `updateFlashcard(supabase,
deckId, cardPublicId, front, back)` (update `front/back` only, scoped
`.eq("public_id", cardPublicId).eq("deck_id", deckId)` so a card that isn't in this deck can't
be hit, `.select("public_id").maybeSingle()` to detect 0-row/404); `deleteFlashcard(supabase,
deckId, cardPublicId)` (same `deck_id` scoping). Scoping by `deck_id` — on top of RLS's
cross-account guard — makes a mismatched-but-owned deck path resolve to a clean 404 instead of
mutating a card that belongs to a different deck.

#### 4. Textarea primitive

**File**: `src/components/ui/textarea.tsx` (new)

**Intent**: Provide the multi-line field the card front/back inputs need, in the shadcn
style already used by `ui/input.tsx`.

**Contract**: Default-exported (or named) `Textarea` forwarding refs, merging classes via
`cn()` from `@/lib/utils`, matching `Input`'s styling contract so the dark-glass form styling
applies.

#### 5. Extend `getDeckByPublicId` to return the internal id

**File**: `src/lib/decks.ts`

**Intent**: Let the deck-detail loader obtain the `bigint id` it needs for `listFlashcards`
from the deck fetch it already performs, instead of a second `deck` query (`deckIdByPublicId`).

**Contract**: Add `id` to `getDeckByPublicId`'s select (`select("id, public_id, name")`). The
`id` is consumed only server-side (loader frontmatter, create/mutation endpoints) and is never
passed to the React island. `deckIdByPublicId` in `flashcards.ts` stays as the resolver for
the create endpoint, which does not otherwise fetch the deck.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a reset local stack: `npx supabase db reset`
- Generated types include `flashcard_source` and `flashcard.source_id`: `npx astro sync`
- Type checking passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- In Supabase Studio, `flashcard_source` holds `(1,manual)` and `(2,ai)`; `flashcard` has a
  `NOT NULL source_id` FK; `front`/`back` still carry only the non-empty check (no max).
- As an authenticated role, `flashcard_source` is selectable; `anon` gets nothing (RLS).

**Implementation Note**: After automated verification passes, pause for human confirmation
of the Studio checks before Phase 2.

---

## Phase 2: Card list workspace + create card

### Overview

Replace the deck-detail placeholder with the card workspace (list + minimal content toolbar),
and wire the "add card" modal end-to-end.

### Changes Required:

#### 1. Deck detail loader — load cards, branch on error

**File**: `src/pages/decks/[publicId]/index.astro`

**Intent**: Fetch the deck's cards after resolving the deck, distinguishing a query error
from an empty deck, and pass everything the island needs. Replace only the placeholder block
(`:67-69`) and extend the existing round-trip parsing to the card params.

**Contract**: `getDeckByPublicId` now also selects the internal `id` (see Phase 1 §5) — the
loader reuses that `id` for `listFlashcards` instead of a second deck query. Capture
`{ data, error }` for both the deck fetch and `listFlashcards`; the deck `id` is used only in
the frontmatter and is NOT passed to the island props. On a `listFlashcards` query error →
distinct `cardsError` state (never a silent 404); only a null deck (`data == null && !error`)
is a genuine not-found. Compute `cardsError` (distinct "coś poszło nie tak" state) vs an empty
array. Parse `open === "create-card"`, `edit` (a card public_id), and route `error`
into the right target (create modal, the edited card, or a page banner). Render
`<FlashcardWorkspace client:load ... />` in place of the placeholder; keep the existing
not-found and rename/delete banner behaviour untouched.

#### 2. Flashcard workspace island

**File**: `src/components/flashcards/FlashcardWorkspace.tsx` (new)

**Intent**: Own the small amount of client-side view state — whether the create modal is
open and which card is being edited — and render the toolbar, list, and create modal.
Mutations stay as native form POSTs from child components.

**Contract**: Props `deckPublicId`, `cards: { publicId, front, back, createdAt }[]`,
`defaultOpenCreate`, `editId`, `serverError`. Holds create-modal open state and the active
`editId`. On mount, strips `open`/`edit`/`error` from the URL (as
`CreateDeckModal.tsx:25-32`). Renders `DeckContentToolbar`, the card list of `FlashcardItem`
(in the order received — `created_at desc`), and `CreateFlashcardModal`. Empty state: "Brak
fiszek w tej talii." Error state (`cardsError`): distinct red banner, not the empty copy.

#### 3. Content toolbar

**File**: `src/components/flashcards/DeckContentToolbar.tsx` (new)

**Intent**: The per-deck content panel above the cards (distinct from the top user bar): the
add-card button, with a reserved, labelled slot for the future search box (S-06).

**Contract**: Props for the add-card trigger. Renders a "Dodaj fiszkę" button and a
commented placeholder where the S-06 search input will mount (no input rendered). No sort
control and no select-mode toggle.

#### 4. Create-card modal

**File**: `src/components/flashcards/CreateFlashcardModal.tsx` (new)

**Intent**: Two-field (front/back) creation mirroring `CreateDeckModal`, using the new
`Textarea`, posting to the create endpoint with the modal error round-trip.

**Contract**: `<form method="POST" action="/api/decks/${deckPublicId}/cards">` with `front`
and `back` textareas; client-side validation front 1..`FRONT_MAX`, back 1..`BACK_MAX`
(`e.preventDefault()` on fail), importing the limits from `@/lib/flashcards`; seeds
`serverError`; reuses `Modal`, `ServerError`, `SubmitButton`. Re-opens on `?open=create-card`.

#### 5. Create endpoint

**File**: `src/pages/api/decks/[publicId]/cards/index.ts` (new)

**Intent**: Validate and insert a manual card, following the deck create endpoint's shape.

**Contract**: `POST`. `UUID_RE` guard on `publicId`; `createClient` + `locals.user`
null-checks; read `front`/`back` from `formData`, trim, validate lengths against
`FRONT_MAX`/`BACK_MAX`; resolve `deckIdByPublicId` and branch on its `error` (query error →
redirect `?error=<pl>&open=create-card`, don't mask it as 404) — only `data == null && !error`
is a real not-found → 404, don't reveal foreign decks; `createFlashcard`; on error redirect `/decks/${publicId}?error=<pl>&open=create-card`; success
redirect `/decks/${publicId}`.

#### 6. Card item (read-only for this phase)

**File**: `src/components/flashcards/FlashcardItem.tsx` (new)

**Intent**: Render one card's front/back inside a `Card`, with slots for the edit/delete
controls that Phase 3 fills in.

**Contract**: Props `card`, plus edit/delete callbacks (wired in Phase 3). This phase renders
front/back only; controls are stubbed. No select checkbox.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` clean (routes/types current)
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Deck with no cards shows "Brak fiszek w tej talii."; a simulated query error shows the
  distinct error state, not the empty copy.
- "Dodaj fiszkę" opens the modal; creating a valid card redirects back and lists it (newest
  first).
- Over-length or empty front/back is rejected client-side and, if forced, server-side with
  the error shown inside the re-opened modal.
- A created card is `accepted` + `manual` in Studio.

**Implementation Note**: Pause for human confirmation after automated verification.

---

## Phase 3: Inline edit + single delete + close-out

### Overview

Turn each card into an editable-in-place item, add per-card permanent delete behind a
confirmation modal, then close out with an accessibility pass and a real two-account
isolation proof.

### Changes Required:

#### 1. Inline edit in the card item

**File**: `src/components/flashcards/FlashcardItem.tsx`

**Intent**: Let a card toggle into an edit mode showing front/back textareas and Save/Cancel,
saving via a native form POST so the redirect round-trip and RLS still apply.

**Contract**: An "edytuj" control switches the item to an inline
`<form method="POST" action="/api/decks/${deckPublicId}/cards/${card.publicId}">` with two
`Textarea`s prefilled from the card, client-side length validation against
`FRONT_MAX`/`BACK_MAX`, and Save/Cancel. When the workspace's `editId` matches this card
(post-error round-trip), it renders in edit mode with the seeded `serverError`. Cancel
restores read-only view.

#### 2. Edit endpoint

**File**: `src/pages/api/decks/[publicId]/cards/[cardPublicId].ts` (new)

**Intent**: Validate and persist a front/back edit, 404 on a missing/foreign card.

**Contract**: `POST`. `UUID_RE` on both `publicId` and `cardPublicId`; client + user
null-checks; validate lengths against `FRONT_MAX`/`BACK_MAX`; resolve `deckIdByPublicId`
(branch on `error` vs null per F1) and pass its `id` to `updateFlashcard` so the update is
scoped to this deck → if `!updated` respond 404; on validation error redirect
`/decks/${publicId}?error=<pl>&edit=${cardPublicId}`; success redirect `/decks/${publicId}`.
Never changes `deck_id`, `state_id`, or `source_id`.

#### 3. Single-delete confirmation + endpoint

**File**: `src/components/flashcards/ConfirmDeleteModal.tsx` (new) and `src/pages/api/decks/[publicId]/cards/[cardPublicId]/delete.ts` (new)

**Intent**: Guard permanent deletion behind an explicit confirm (FR-010 stresses
permanence), mirroring the deck delete modal.

**Contract**: A "usuń" control opens `ConfirmDeleteModal` (Polish "Czy na pewno usunąć tę
fiszkę? Tej operacji nie można cofnąć.", destructive `SubmitButton`) whose form POSTs to the
delete path. Endpoint: `POST`, `UUID_RE` guards, resolve `deckIdByPublicId` (branch on `error`
vs null per F1) and pass its `id` to `deleteFlashcard` so the delete is scoped to this deck
(mismatched deck path → 0 rows → 404), error → `?error=<pl>` (page banner), success →
`/decks/${publicId}`.

#### 4. Quality close-out artifact

**File**: `context/changes/manual-card-crud/isolation-check.md` (new)

**Intent**: Record an executed two-account proof (not code-reasoned) that user B cannot
read, edit, or delete user A's cards, per the S-01 impl-review lesson that the proof must be
run and signed.

**Contract**: A short procedure + a "Wynik" section filled with date + tester after running
it: user B hitting user A's card edit/delete endpoints gets 404 / zero rows; user B's deck
detail never lists user A's cards.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` clean
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Editing a card inline saves and persists across reload; an over-length edit is rejected
  and re-enters edit mode with the error on the right card.
- Cancel discards edits and restores read-only view.
- Deleting a single card requires confirming the modal; after confirm the card is gone.
- A deleted card no longer exists in Studio.
- Keyboard: modals trap focus and close on Esc; toolbar controls are reachable and labelled;
  all copy is Polish.
- `isolation-check.md` "Wynik" is filled with a real run (date + tester): user B cannot see,
  edit, or delete user A's cards.

**Implementation Note**: Pause for human confirmation; this closes the slice.

---

## Testing Strategy

### Unit / manual-validation checks:

- Front length 1..`FRONT_MAX` and back length 1..`BACK_MAX` enforced client-side and at the
  endpoint (two business-rule layers); the DB enforces only non-emptiness.
- Create inserts `state_id = accepted`, `source_id = manual`.
- Update touches only `front`/`back`.

### Integration scenarios:

- Create → list → inline edit → reload (persists) → single delete, all via the redirect
  round-trip.
- Error round-trips: over-length create re-opens the modal with the error; over-length edit
  re-enters that card's edit mode; delete error surfaces as a page banner.

### Manual Testing Steps:

1. Create several cards; verify they list newest-first.
2. Edit one inline; reload; confirm the change stuck.
3. Delete one via the confirm modal.
4. Two-account isolation: user B cannot read/edit/delete user A's cards (fill
   `isolation-check.md`).

## Performance Considerations

A deck's cards load in full — fine for MVP volumes (no pagination, per roadmap). Indexes
`flashcard_deck_id_idx` and the new `flashcard_source_id_idx` cover the list and marker
lookups.

## Migration Notes

The `flashcard` table is empty (S-01 created no cards), so the `NOT NULL source_id` column
needs no backfill or default. No length CHECKs are added — max length is enforced in the app,
not the DB. Applying to the cloud is a separate step from app deploy
(`context/foundation/lessons.md:40-45`): after merge, `supabase db push` against the linked
project.

## References

- Change identity: `context/changes/manual-card-crud/change.md`
- Schema baseline: `supabase/migrations/20260705180246_init_core_schema.sql`
- Deck slice to mirror: `src/lib/decks.ts`, `src/pages/api/decks/*`, `src/components/decks/*`
- Prior slice archive: `context/archive/2026-07-07-deck-workspace/plan.md`
- Lessons: `context/foundation/lessons.md` (SSR error-vs-empty, no top-level return in
  `.astro`, form-error round-trip through modal, cloud migration separate from deploy)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema delta + data layer + textarea primitive

#### Automated

- [x] 1.1 Migration applies cleanly on a reset local stack: `npx supabase db reset` — c4a839e
- [x] 1.2 Generated types include `flashcard_source` and `flashcard.source_id`: `npx astro sync` — c4a839e
- [x] 1.3 Type checking passes: `npm run lint` — c4a839e
- [x] 1.4 Production build passes: `npm run build` — c4a839e

#### Manual

- [x] 1.5 `flashcard_source` seeded `(1,manual)`/`(2,ai)`; `flashcard` has `NOT NULL source_id` FK; front/back keep only the non-empty check (no max) (Studio) — c4a839e
- [x] 1.6 `flashcard_source` selectable as authenticated, denied to `anon` — c4a839e

### Phase 2: Card list workspace + create card

#### Automated

- [x] 2.1 `npx astro sync` clean — 58684f1
- [x] 2.2 `npm run lint` passes — 58684f1
- [x] 2.3 `npm run build` passes — 58684f1

#### Manual

- [x] 2.4 Empty deck shows empty copy; simulated query error shows distinct error state — 58684f1
- [x] 2.5 Add-card modal creates a card and lists it (newest first) — 58684f1
- [x] 2.6 Over-length/empty front/back rejected client- and server-side (error in re-opened modal) — 58684f1
- [x] 2.7 Created card is `accepted` + `manual` in Studio — 58684f1

### Phase 3: Inline edit + single delete + close-out

#### Automated

- [x] 3.1 `npx astro sync` clean — 5c2f406
- [x] 3.2 `npm run lint` passes — 5c2f406
- [x] 3.3 `npm run build` passes — 5c2f406

#### Manual

- [x] 3.4 Inline edit saves and persists across reload; over-length edit re-enters edit mode with error — 5c2f406
- [x] 3.5 Cancel discards edits, restores read-only view — 5c2f406
- [x] 3.6 Single delete requires modal confirm; card removed after confirm — 5c2f406
- [x] 3.7 Deleted card gone in Studio — 5c2f406
- [x] 3.8 A11y: modals trap focus + Esc-close; controls labelled; all copy Polish — 5c2f406
- [x] 3.9 `isolation-check.md` "Wynik" filled with a real two-account run (date + tester) — 5c2f406
