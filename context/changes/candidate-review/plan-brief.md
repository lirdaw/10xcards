# S-05 candidate-review — Plan Brief

> Full plan: `context/changes/candidate-review/plan.md`
> Research: `context/changes/candidate-review/research.md`
> Plan review: `context/changes/candidate-review/reviews/plan-review.md` — all 10 findings
> fixed in the plan (2026-07-25); F8 reshaped Phase 4 and F2/F4 added work to Phase 1.

## What & Why

AI candidates are already written to the database but are unreachable the moment the page
reloads, and nothing in the codebase can change a card's state. This slice makes candidates
visible and curatable — accept, edit, reject, individually or in bulk (FR-005) — so accepted
cards become part of the deck the user studies (FR-006, US-01). It is the second half of
US-01 and the slice that makes the PRD's primary success metric (≥75% acceptance) observable.

## Starting Point

`/api/generate` writes candidates with `state_id = generated` and returns them; the generator
island renders them once, read-only, with no controls and no navigation. `listFlashcards`
hard-filters to `accepted`, so a candidate exists in the database and appears in no
server-rendered view. No code path anywhere transitions a card between states, `STATE_REJECTED`
is not defined, and there is no selection state or checkbox primitive in the project. RLS
already permits everything this slice needs to write.

## Desired End State

Generating candidates leads to a review screen scoped to that generation, where each card can
be accepted, edited, or rejected — one at a time or several at once. Accepted cards appear in
the deck and enter study; rejected cards keep their content and stay visible under a rejected
view. Unreviewed candidates are reachable later from a "N do przeglądu" counter on the deck
list, and the review screen stays reachable from the deck view even at zero pending — the
per-card "odrzuć" the deck view gains would otherwise be a one-way trap. Selection, bulk delete
and the source badge in the deck view belong to C10X-16. Keyword search returns accepted cards
only.

## Key Decisions Made

| Decision                        | Choice                                                            | Why (1 sentence)                                                                                             | Source   |
| ------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| Where review lives              | Dedicated route `/decks/[publicId]/review`                        | Survives reload, owns its own empty states, and folds under the existing `decks` sidebar item.                | Plan     |
| Candidate list scope            | Whole deck, optionally narrowed by `?generation=`                 | Covers both "review what I just generated" and "finish the backlog" without inventing pagination.            | Plan     |
| Endpoint convention             | One JSON endpoint for single **and** bulk                         | A bulk result is inherently structured; `/api/generate` and `/api/study` already justify the JSON exception.  | Plan     |
| Selection model                 | Review-local `useSelection` + `CandidateSelectionBar`             | One consumer here; C10X-16 promotes them to shared primitives when it adds the second (plan-review F8).       | Review   |
| C10X-16 reach in this slice     | None — selection, bulk delete, source badge all stay parked       | The end state lands without them; deferring drops two touched neighbours and the batch `delete` action.       | Review   |
| Reject stays recoverable        | Permanent review link in the deck view, not just the counter chip | The chip vanishes at zero pending — exactly the state a freshly rejected card creates (plan-review F3).       | Review   |
| Transition graph                | `generated → accepted/rejected`, `accepted → rejected`, guarded in app code | Mirrors S-03's `.eq("state_id", …)` compare-and-set, so retries and double-clicks are benign by construction. | Plan     |
| `rejected → accepted` (restore) | Added                                                             | Without it, reject is a one-way trap less recoverable than delete — see Open Risks, this extends the answer given. | Plan     |
| Un-accept action lives          | Per-card in the deck view                                         | The action sits where the user sees the accepted card; realises S-02's "reject ≠ delete" rule for the first time. | Plan     |
| Rejected cards visible          | Under the review screen's rejected view                           | Derived: the deck view shows only accepted, so without this "odrzuć" would look identical to "usuń".         | Plan     |
| Search state gap (S-06)         | Migration adds the filter **and `source_id`** to the RPC          | Parity at the data source; a return-type change, so drop+create with re-granted ACL (plan-review F2).          | Research |
| Idempotency debt (F5)           | In scope, as a separable final phase                              | Closes the deferral lessons.md records, and the characterization test already documents how to invert it.    | Research |
| Idempotency key on failures     | Written only on the `succeeded` session; 23505 → replay           | Otherwise the partial unique index kills the very FR-018 retry it protects (plan-review F1).                   | Review   |
| `updated_at` on a transition    | Trigger narrowed to `update of front, back`                       | The first non-content UPDATE would otherwise stamp every accepted card "Edytowano" (plan-review F4).           | Review   |
| UI extras                       | State badge on review, per-session acceptance metric, deck-list counter | Metric needs no new column (`n` = the session's surviving rows); source badge waits for C10X-16.          | Plan     |
| Testing                         | Full §6.2/§6.4 pattern + selective Stryker on the transition      | First lifecycle transition and first multi-row (including destructive) mutation — exactly Risk #1's class.    | Plan     |

## Scope

**In scope:** candidate read path and review route · state transitions with a guarded graph ·
one JSON batch endpoint (`setState`) · review-local selection · review island with per-card and
bulk actions · deck-view per-card reject + permanent review link · deck-list candidate counter ·
per-generation acceptance metric · S-06 search state filter + `source_id` · `updated_at` trigger
narrowing · generation idempotency · integration tests + selective mutation testing.

**Out of scope:** full FR-014 filter panel · pagination · RLS/policy changes · schedule seeding
on accept · DB-level transition constraints · **deck-view selection, bulk delete and source
badge, plus the batch `delete` action and `deleteFlashcards` (all C10X-16, with the promotion of
the selection components to shared primitives)** · keyboard-shortcut layer · new sidebar item ·
any admin/metrics dashboard.

## Architecture / Approach

Server-first, in dependency order. `src/lib/flashcards.ts` gains the single named transition
function whose UPDATE carries `.in("state_id", ALLOWED_FROM[target])` — the one place the
transition graph is enforced, and the reason an illegal or repeated action is a zero-row no-op
rather than an error. One JSON endpoint (`/api/decks/[publicId]/cards/batch`, a Zod
discriminated union on `action` with `setState` as its only member for now, modelled on
`/api/study`) serves both UI surfaces and returns `{ changed, skipped }` derived from
`RETURNING` — never from the absence of an error, because under RLS a foreign write is a silent
0-row no-op. Both surfaces reload after a successful call, keeping the project's redirect-driven
model and making stale selection impossible.

## Phases at a Glance

| Phase                                            | What it delivers                                                        | Key risk                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1. Data layer                                    | Transition function + guard, state-scoped reads, badges, **three** migrations | The transition guard is the whole safety model — a wrong `ALLOWED_FROM` is invisible until tested; two migrations replace existing objects |
| 2. Batch endpoint                                | One JSON route for `setState`, with per-id results                      | Astro route precedence against `[cardPublicId].ts`; a 0-row write read as success           |
| 3. Review screen + review-local selection        | The screen the slice exists for, plus `useSelection`/`CandidateSelectionBar` | Bulk must perform the same per-row writes as the single path, or the metric dies             |
| 4. Deck-view integration (narrow)                | Per-card reject, permanent review link, deck-list counter               | Only `FlashcardItem` + two loaders now; the protected fixed-height row absorbs one action    |
| 5. Tests + Stryker                               | Cross-account denial, transition gate, partial results, mutation review | A green suite that never went red proves nothing — deliberate breakage is mandatory         |
| 6. Idempotency (separable)                       | `idempotency_key` + partial unique index; characterization test inverted | The index adds failure paths (retry-after-failure, 23505 race) that must be handled, not just added |

**Prerequisites:** S-04 shipped (it is) · local Supabase stack running (`npm run db:start`) ·
`OPENROUTER_API_KEY` unset so generation stays in mock mode for tests.
**Estimated effort:** ~4–6 sessions across 6 phases; Phases 1–2 are small and server-only,
Phase 4 is the largest, Phase 6 is droppable.

## Open Risks & Assumptions

- **`rejected → accepted` extends the answer given during questioning.** The transition set
  chosen was "also `accepted → rejected`"; restore was added because without it a mis-click in
  the deck view is irreversible and less recoverable than delete. Cheap to remove — drop one
  entry from `ALLOWED_FROM` and the "Przywróć" action.
- **Phase 4 touches neighbouring components, now minimally**: `FlashcardItem` (one action),
  `FlashcardWorkspace` and `decks/index.astro` (one link, one counter). `DeckContentToolbar` is
  no longer touched. That is the failure mode `lessons.md:96-101` was written from; it is in
  scope here because it was settled before building, and the list above is exhaustive.
- **The selection abstraction is validated by one consumer only, and stays review-local
  because of it.** If C10X-16 reshapes `useSelection` when it wires the second consumer, that
  is expected work, not drift.
- **The fixed `h-[40rem]` row absorbs one addition** (the third action). Layout parity between
  read-only and edit mode is an invariant, not a nicety.
- **No pagination anywhere** — safe only while a generation caps at 15 cards and the batch
  endpoint caps at 100 ids. A deck with hundreds of candidates degrades to a long list.

## Success Criteria (Summary)

- A user generates candidates, reviews them (single and bulk), and the accepted ones appear in
  the deck and in a study session — while rejected ones never do and are never deleted.
- Every screen survives a reload; the acceptance metric agrees with the database.
- No account can read or write another account's cards through any path added here, proven by
  row-based assertions with positive controls and a verified deliberate-breakage run.
