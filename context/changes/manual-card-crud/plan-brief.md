# Manual Flashcard CRUD (S-02) — Plan Brief

> Full plan: `context/changes/manual-card-crud/plan.md`

## What & Why

Give a signed-in user the ability to manually author, browse, edit, and permanently delete
flashcards inside one of their decks (FR-007..FR-010). Manual cards are the cheapest path to
having study-ready cards — they enter the standard status lifecycle as `accepted` — and they
unlock the SRS study star (S-03) without waiting on the AI branch.

## Starting Point

The `flashcard` table already exists (F-01) with RLS per-account isolation, but has **no
column marking manual vs generated authorship**. The deck detail page `/decks/[publicId]`
ships a static "Brak fiszek" placeholder built as the anchor this slice replaces. The deck
slice (S-01) established every pattern to mirror: `src/lib/decks.ts` helpers, form-POST →
redirect endpoints, modal error round-trip, `UUID_RE` guards, 404-not-403.

## Desired End State

On a deck's page the user sees a content toolbar (add-card, plus a reserved slot for the
future S-06 search) and their cards, newest first. They add cards via a two-field modal, edit
any card in place, and delete one behind a confirm modal. Every card is `accepted` + `manual`,
private to that user, and a loader DB failure shows a distinct error state — never a fake
empty list.

## Key Decisions Made

| Decision                     | Choice                                              | Why (1 sentence)                                                            | Source |
| ---------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- | ------ |
| FR-007 authorship marker     | New `flashcard_source` lookup (`manual`/`ai`) + FK  | Records authorship literally and matches the existing `flashcard_state` convention. | Plan |
| Front/back field UX          | Both multi-line `Textarea` (new `ui/textarea.tsx`)  | Cards can hold multi-line answers; no textarea primitive existed yet.       | Plan |
| Length limits                | front ≤200, back ≤1000 — business rule (client + endpoint), NOT a DB CHECK | Keeps limits tunable without a migration; DB enforces only non-empty.       | Plan |
| Edit UX                      | Inline edit per card (native POST, error round-trip)| User-requested; keeps the redirect-driven, RLS-safe mutation model.         | Plan |
| Delete UX                    | Single delete behind a confirm modal                | Confirmation guards permanent removal; bulk delete deferred (see below).    | Plan |
| Bulk delete / select-mode    | Deferred to a future task (Jira "Pomysły")          | Considered for S-02 but cut to keep the slice focused on core CRUD.         | Plan |
| Sorting                      | Deferred to a future task (Jira "Pomysły")          | Considered for S-02 but cut; list ships in default `created_at desc`.       | Plan |
| List state/source badge      | None in S-02                                        | Every card is `accepted`+`manual`; a single-value badge is noise until S-05.| Plan |
| Keyword search               | Deferred to S-06 / C10X-9                            | Search is its own slice (FR-015); toolbar leaves a labelled gap.            | Plan |

## Scope

**In scope:** manual create (two fields), list (newest first), inline edit, single delete
(confirm), `flashcard_source` marker, business-rule length limits, `textarea` primitive,
two-account isolation proof + a11y pass.

**Out of scope:** bulk delete / select-mode (deferred), sorting control (deferred), keyword
search (S-06), reject action/state UI (S-05), AI generation / `generated` cards (S-04),
state/source badges, DB-level length CHECK, filtering by state/date (FR-014), pagination,
soft-delete/undo, SRS fields (S-03).

## Architecture / Approach

Bottom-up: schema delta → `src/lib/flashcards.ts` helper → replace the deck-detail
placeholder with a single `client:load` React island (`FlashcardWorkspace`) that owns a
little view state (create-modal open, which card is editing). Mutations stay native
`<form method="POST">` to dedicated endpoints under `/api/decks/[publicId]/cards/*` (create,
edit, single delete), preserving S-01's no-fetch, redirect-with-`?error=` round-trip and RLS
scoping. `/api/decks` is already guarded by middleware.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Schema + data layer | `flashcard_source` lookup + `source_id`, regen types, `flashcards.ts` helper (incl. length constants), `textarea` primitive | `NOT NULL` column + type regen (Docker/local stack needed) |
| 2. List + create | Card workspace island, minimal content toolbar, create modal + endpoint | Loader must branch error-vs-empty; two-field validation |
| 3. Inline edit + single delete + close-out | Editable-in-place card, edit endpoint, confirm-delete modal + endpoint, a11y pass, isolation proof | Inline edit keeps redirect round-trip (`?edit=` param); proof must be run + signed |

**Prerequisites:** S-01 (deck-workspace) done; local Supabase stack (Docker) to apply the
migration and regenerate types.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Type regeneration assumes the local Supabase stack (Docker) is running; hand-editing
  `database.types.ts` is the fallback if not.
- `state_id`/`source_id` are referenced as pinned constants (2 / 1) matching the seed rather
  than re-queried — correct as long as the seed values are not changed.
- Length limits (`FRONT_MAX`/`BACK_MAX`) live in app code only; there is no DB backstop for
  max length by design, so an out-of-band writer could exceed them.
- Inline edit is a deviation from the deck slice's modal-only mutations; it reuses the same
  round-trip mechanics but via an `?edit=<cardPublicId>` param instead of a modal.

## Success Criteria (Summary)

- User can create, browse, inline-edit, and single-delete manual cards in a deck.
- Every card is recorded `accepted` + `manual`, private to its owner (executed two-account
  proof).
- No card is lost to a masked DB error (loader shows a distinct error state).
