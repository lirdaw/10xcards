---
date: 2026-07-25T00:00:00+02:00
researcher: Dawid Liro
git_commit: 132fa4705067a6f4cf533ce300f7a890c4578724
branch: main
repository: lirdaw/10xcards
topic: "S-05 candidate-review — what the codebase already provides for reviewing, accepting, editing and rejecting AI candidates"
tags: [research, codebase, candidate-review, flashcard-state, generation, bulk-selection, idempotency]
status: complete
last_updated: 2026-07-25
last_updated_by: Dawid Liro
---

# Research: S-05 `candidate-review` — accept / edit / reject of AI candidates

**Date**: 2026-07-25
**Researcher**: Dawid Liro
**Git Commit**: `132fa4705067a6f4cf533ce300f7a890c4578724`
**Branch**: `main`
**Repository**: `lirdaw/10xcards` (Jira C10X-8)

Permalink base for every reference below:
`https://github.com/lirdaw/10xcards/blob/132fa4705067a6f4cf533ce300f7a890c4578724/<path>#L<line>`

## Research Question

What does the codebase already provide for slice S-05 — the user reviews AI-generated
candidates (`state_id = generated`) and accepts, edits, or rejects each one, individually
or in bulk; accepted cards become studyable — and what must this slice build, inherit, or
deliberately leave alone?

Two scope questions were settled before the research and shaped it: the generation
idempotency debt is to be **researched and costed** (decision deferred to planning), and
the bulk-selection UI is to be **costed both ways** against the parked C10X-16 selection
model.

## Summary

The slice is materially larger than "add three buttons to a list", but it is larger in
plumbing, not in risk. Six findings drive planning:

1. **No state transition exists anywhere in the codebase.** Every writer sets `state_id`
   once, at INSERT, with a hardcoded literal. There is no `.update({ state_id })` in all
   of `src/`, and `STATE_REJECTED` is not even defined as a constant. S-05 writes the
   first lifecycle transition this product has ever had.
2. **Candidates are currently unreachable.** `listFlashcards` hard-filters to
   `state_id = 2`, so a `generated` card is visible only in an ephemeral read-only list
   held in React state on `/generate`, which dies on reload. S-05 must build the read path
   and the route before it can build any control.
3. **The database is already permissive enough — no migration is needed for the core.**
   `flashcard_update` gates on deck ownership via an EXISTS-join and says nothing about
   columns, so an owner's `state_id` update already passes RLS. The corollary is that
   nothing in the DB constrains *which* transitions are legal.
4. **Bulk is the project's first multi-row mutation.** Every existing mutation touches one
   row scoped by one `public_id`; the only multi-row write is the candidate bulk INSERT.
   There is no checkbox primitive and no selection state anywhere. A narrow, local
   selection costs ~4 new files and touches zero existing components; the shared model
   costs 3 existing files and is exactly what C10X-16 parks.
5. **Two debts were explicitly assigned to S-05 by earlier slices** — generation
   idempotency (impl-review F5, ACCEPTED-AS-RULE) and the S-06 search state-filter gap.
   Neither appears in the Jira ticket or the roadmap entry. Both are small; both are
   separable.
6. **The acceptance metric needs no new column.** It is derivable today from
   `flashcard.generation_id` + `state_id`. This reframes the ticket's "bulk must not
   bypass the per-card control" warning into something concrete and checkable (§8).

What S-05 does **not** need: an RLS change, an S-03 coordination change (S-03 pre-fixed
the reject-after-study hazard), and schedule seeding on accept (`ensureSchedule` is lazy
and deliberately decoupled from the accept path).

## Detailed Findings

### 1. Where S-04 stopped

`/api/generate` writes candidates and returns them, and the UI shows them once, read-only.

- The endpoint's success path writes in this order: optional deck read → `generateCandidates`
  (LLM or mock) → optional `createDeck` (deliberately *after* generation, so a failure does
  not orphan an empty deck) → `createGenerationSession` → `insertCandidates`; on insert
  failure a compensating `failGenerationSession` zeroes `saved_count`
  (`src/pages/api/generate.ts:95-220`, `src/lib/generations.ts:29-54`).
- Every candidate lands with `state_id = 1`, `source_id = 2` (ai), and
  `generation_id = <session.id>` (`src/lib/generations.ts:44-53`).
- The response carries `{ candidates, counts, deckPublicId, sessionPublicId }`
  (`src/pages/api/generate.ts:222-227`), but the island renders only a count banner and a
  plain `<ul>` of front/back with **no per-card controls and no navigation anywhere**
  (`src/components/generate/GeneratorForm.tsx:316-332`).
- The seam is marked in source, twice:
  `// Accept/edit/reject is deliberately NOT here — that's S-05 (candidate-review)`
  (`src/components/generate/GeneratorForm.tsx:88-89`) and
  `{/* Read-only results (S-05 adds accept/edit/reject) */}` (`:315`).
- `deckPublicId` is returned but never used by the component; the test comments it as
  "the island navigates to this id" — i.e. planned, unimplemented navigation
  (`tests/generation/generate.test.ts:338-348`).

### 2. The state model, and the transition that does not exist

The lookup table is seeded `1 = generated, 2 = accepted, 3 = rejected`, with a `CHECK` on
the code column and **no DEFAULT on `flashcard.state_id`** — deliberately, so a candidate
cannot be silently written as accepted
(`supabase/migrations/20260705180246_init_core_schema.sql:21-34`).

An exhaustive search of `src/` for `state_id` returns exactly these sites:

| Site | Kind |
| --- | --- |
| `src/lib/flashcards.ts:42` | `STATE_ACCEPTED = 2` constant |
| `src/lib/flashcards.ts:68` | read filter (`listFlashcards`) |
| `src/lib/flashcards.ts:94` | fixed-value INSERT (`createFlashcard`, always accepted) |
| `src/lib/generations.ts:15` | `STATE_GENERATED = 1` constant |
| `src/lib/generations.ts:49` | fixed-value INSERT (`insertCandidates`, always generated) |
| `src/lib/study.ts:144` | read filter (`ensureSchedule`) |
| `src/lib/study.ts:277` | read filter (`rateCard` resolve) |
| `src/pages/api/decks/[publicId]/cards/[cardPublicId].ts:10` | comment: edit does *not* touch `state_id` |

`updateFlashcard` only ever does `.update({ front, back })`
(`src/lib/flashcards.ts:101-109`). **No code path transitions a card between states**, and
`state_id = 3` is never written by anything. This was corroborated independently by two
agents (schema/lifecycle sweep and the generation-path sweep).

One consequence worth planning around: **editing a candidate already works today**.
`updateFlashcard` scopes by `public_id` + `deck_id` and does not filter on state, so the
existing edit endpoint can edit a `generated` card as-is. The "edit" third of FR-005 is
mostly reuse, not new work — the new work is accept and reject.

### 3. The read path: candidates are invisible after a reload

```ts
// src/lib/flashcards.ts:63-70
supabase.from("flashcard")
  .select("public_id, front, back, created_at, updated_at")
  .eq("deck_id", deckId)
  .eq("state_id", STATE_ACCEPTED)
  .order("created_at", { ascending: false });
```

The deck page calls exactly this (`src/pages/decks/[publicId]/index.astro:8,54`), so a
`generated` card exists in the database and appears in no server-rendered view. S-04's plan
deferred the fix by name: *"Świadome oglądanie kandydatów `generated` (przełącznik /
round-trip po `?state=`) należy do S-05"*
(`context/archive/2026-07-11-ai-candidate-generation/plan.md:450`), and Phase 5 there added
the filter *without* a signature change or UI toggle, precisely so S-05 owns that decision
(`:443-471`).

`listFlashcards` has no pagination and no state parameter. A deck's candidate count is
unbounded in principle (up to 15 per generation × N generations), which makes paging or at
least a per-generation scope a real design question rather than a nicety.

### 4. The mutation surface, and why bulk is genuinely new

| Function | Endpoint | Body | Notes |
| --- | --- | --- | --- |
| `createFlashcard` | `POST /api/decks/[publicId]/cards` | formData | redirect + `?error=…&open=create-card` |
| `updateFlashcard` | `POST /api/decks/[publicId]/cards/[cardPublicId]` | formData | redirect + `?error=…&edit=<id>` |
| `deleteFlashcard` | `POST …/cards/[cardPublicId]/delete` | formData | redirect |
| `insertCandidates` | `POST /api/generate` | **JSON** | the project's first JSON endpoint |
| `rateCard` / `setSessionSize` | `POST /api/study` | **JSON** | second JSON endpoint |

Card and deck CRUD are formData + redirect; `/api/generate` and `/api/study` are JSON and
both carry a source comment calling that a *deliberate departure* justified by being
React-island-driven (`src/pages/api/generate.ts:10-14`, `src/pages/api/study.ts:7-11`).

**There is no bulk UPDATE or DELETE anywhere.** Every mutation on an existing row is
single-row, scoped by one `public_id`. `.in()` appears once, in `ensureSchedule`, and only
for a scoped read (`src/lib/study.ts:143`). The single multi-row write in the project is
`insertCandidates`' bulk INSERT (`src/lib/generations.ts:44-53`). S-05's bulk accept/reject
has no precedent to copy — including no precedent for how a partial failure over N ids
should be reported to the user.

This is the strongest argument for S-05's mutation endpoint being **JSON rather than
formData**: a bulk result is inherently structured (accepted k of n, these ids failed), and
the two existing JSON endpoints already establish the exception and its justification.

### 5. RLS, and what accept/reject touches downstream

Policies (`supabase/migrations/20260705180246_init_core_schema.sql:126-142`) gate flashcards
by an EXISTS-join to `deck.user_id = auth.uid()`, identically on `using` and `with check`,
and reference no columns. **An owner's `state_id` update already passes as written — no
policy change is required.** Equally: nothing in the database constrains transitions, so
`accepted → generated` is legal at the DB level. Any invariant must live in application
code or a new CHECK, and that is a choice for planning, not a given.

Downstream of accept, everything is already handled:

- `study_due_cards` gates on the literal `f.state_id = 2`
  (`supabase/migrations/20260724220524_srs_study_schedule_review_fixes.sql:46-68`), as does
  `study_due_counts`.
- `ensureSchedule` runs lazily inside `listDueCards` and upserts with
  `ignoreDuplicates: true` (`src/lib/study.ts:138-151,179`). S-03's plan states it is
  decoupled "bez couplingu do ścieżek accept S-02/S-05"
  (`context/archive/2026-07-24-srs-study-session/plan.md:119-127`). **S-05 must not seed a
  schedule row on accept** — flipping `state_id` is sufficient.
- The reject-after-study hazard was fixed pre-emptively **in S-03**: impl-review F3 named
  S-05 by name and the fix (adding `.eq("state_id", STATE_ACCEPTED)` to `rateCard`'s
  resolve and to `ensureSchedule`) shipped there, with a test flipping a card 2→3 and
  asserting 404 (`context/archive/2026-07-24-srs-study-session/reviews/impl-review.md:155-183`).
  S-05 inherits a safe write path and needs no coordination change in S-03.
- Residue: a card accepted, studied, then rejected keeps its `flashcard_schedule` row.
  There is no trigger or cascade on `state_id`; the row is orphaned-but-inert, invisible to
  every read gate. Anticipated in a source comment (`src/lib/study.ts:267-271`). S-05 is the
  first slice that can create this state; it is harmless, and it is worth stating explicitly
  in the plan rather than discovering in review.

### 6. UI inventory and the C10X-16 boundary

Conventions to match:

- One island per screen owns state; children are prop-driven. `FlashcardWorkspace` owns
  `createOpen`/`activeEditId`/`deleteCard` and renders `FlashcardItem` rows
  (`src/components/flashcards/FlashcardWorkspace.tsx:62-66,145`). Every mounted island uses
  `client:load`, with no exceptions in the repo.
- The error round-trip is uniform: seed `serverError` from a prop, strip `open`/`error`
  from the URL with `history.replaceState` on mount, render through the shared
  `<ServerError />` (`src/components/decks/CreateDeckModal.tsx:21,25-32`,
  `src/components/auth/ServerError.tsx:7`).
- Rows are fixed-height (`h-[40rem]`) with a 3-region flex column, protected by comments
  against layout shift when toggling edit mode (`src/components/flashcards/FlashcardItem.tsx:170-228`).
- Primitives present: `Modal`, `Button`, `Input`, `Label`, `Textarea` (`card.tsx` exists but
  is imported nowhere — the project hand-rolls card markup). **Absent: Checkbox, Toolbar,
  Toast, Badge, Table.** `components.json` confirms shadcn-CLI vendoring, so
  `npx shadcn@latest add checkbox` is a one-file, one-dependency addition — or a bare
  `<input type="checkbox">` is equally in keeping, since the project already uses bare
  `<select>` over a vendored Select (`src/components/generate/GeneratorForm.tsx:186-204`).

**Zero selection state exists in `src/` today** — an exhaustive grep returned only Tailwind's
`selection:` utility and two unrelated comments. The cost comparison:

| | (a) Narrow — local to the review island | (b) Shared — reusable selection model |
| --- | --- | --- |
| New files | ~4 (`CandidateReviewWorkspace`, `CandidateItem`, `CandidateToolbar`, route) + optional `ui/checkbox.tsx` | the same 4, **plus** a shared hook/toolbar primitive |
| Existing files changed | **0** | **3**: `FlashcardWorkspace.tsx`, `FlashcardItem.tsx` (Props + the protected fixed-height JSX), `DeckContentToolbar.tsx` (mode-switching) |
| Relation to C10X-16 | untouched | this *is* C10X-16's artifact, built early |
| Risk | none beyond new code | re-runs the S-02 impl-review F2 failure mode (`lessons.md:96-101`) |

The narrow option is not a compromise — it delivers FR-005's bulk requirement in full. It
only declines to *generalise* the mechanism, which is precisely what C10X-16 exists to hold.

Navigation: `Sidebar.astro:13-32` holds a static three-item array and `activeItem` is passed
explicitly by each page (typed union in `Sidebar.astro:4` and `AuthenticatedLayout.astro:7`).
A review screen either folds under `"generate"`/`"decks"` or adds a literal to that union —
a deliberate, visible choice, not an incidental edit.

### 7. Two debts assigned to S-05 that the ticket does not mention

**(a) Generation idempotency — impl-review F5, ACCEPTED-AS-RULE.** The verdict reads:
*"fix kodu (idempotencja, Wariant A) świadomie odłożony do S-05"*
(`context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108`). A
characterization test already pins the current behaviour and is waiting to be inverted:
*"When S-05 lands idempotency, the first `it()` will go red. The correct action is to invert
the assertion (2 → 1)… not to delete the test"* (`context/foundation/test-plan.md:418`,
`tests/generation/generate.test.ts:20-22`).

Seams, as they actually exist: there is **no** idempotency key, request id, in-flight
registry, or UNIQUE constraint on `generation_session` beyond `public_id`
(`supabase/migrations/20260712162349_generation_session.sql:21-38`). The only UNIQUE that
dedups anything is `deck_user_name_unique`, which dedups deck *names* — the test file
explicitly warns that the `newDeckName` 409 looks like protection and is not
(`tests/generation/generate.test.ts:194-212`).

Costed recommendation (decision belongs to `/10x-plan`): `(user_id, source_text)` is the
wrong key — a user may legitimately regenerate from the same text with a different count or
language, and a UNIQUE there would block that. The shape that fits this codebase is a
client-generated attempt key: `GeneratorForm` already keeps `lastPayload` in a ref and
replays it verbatim on "Ponów" (`src/components/generate/GeneratorForm.tsx:106,175-177`), so
minting one uuid per *attempt* and reusing it on retry is a few lines; server-side, a
nullable `idempotency_key` plus a partial unique index, checked before the LLM call exactly
as `deckNameExists` is checked today (`src/pages/api/generate.ts:107-113`). S-03's
`reps`-based compare-and-set is the in-repo precedent for retry-safety
(`context/archive/2026-07-24-srs-study-session/plan.md:139-152`).

Estimated blast radius: 1 migration, ~1 endpoint change, ~3 client lines, 1 inverted test
assertion. **Recommendation: carry it as a final, clearly separable phase.** It does not
block any review work, so dropping it costs only the decision to skip that phase — and note
that the review UI *reduces* the harm of duplication (duplicates become visible and
rejectable) without removing it (wasted paid LLM calls remain).

**(b) The S-06 search state-filter gap.** `search_flashcards_in_deck` filters by deck only
and returns cards in **every** state
(`supabase/migrations/20260712162359_deck_keyword_search.sql:46-61`), while `listFlashcards`
filters to accepted. S-04's plan assigned the reconciliation to S-05 and forbade doing it
there: *"Domknięcie tej niespójności… jest świadomie odłożone do S-05… Nie implementować
tutaj i nie dotykać plików S-06"* (`context/archive/2026-07-11-ai-candidate-generation/plan.md:94-99`).
This is dormant today only because nothing writes `rejected` and candidates are invisible.
**The moment S-05 ships, search starts surfacing rejected cards and candidates in a view
that otherwise hides them** — a regression S-05 itself triggers in someone else's slice.
This one is not optional in the way (a) is.

### 8. The acceptance metric — derivable, no new column

Nothing in `src/` computes an acceptance rate or any count grouped by `state_id`; the only
counters are `generation_session`'s own `requested_count` / `generated_count` /
`saved_count`, and `saved_count` is explicitly not an oracle because the compensating update
zeroes it (`src/lib/generations.ts:29-34`, `context/foundation/test-plan.md` §6.5).

But the PRD metric does not need a new counter: every AI card carries `generation_id`
(`ON DELETE SET NULL`) and `source_id = 2`, so "accepted ÷ generated per session" and "share
of cards created via generation" are both plain aggregates over `flashcard` as it exists.

This sharpens the ticket's warning — *"tryb zbiorczy nie może omijać kontroli per-karta,
która daje metrykę"*. Concretely: the metric survives bulk **automatically**, provided bulk
performs the same per-row state writes as the single path. It is violated only by a shortcut
that destroys the per-row record — e.g. deleting unaccepted candidates instead of marking
them `rejected`, or accepting the remainder without recording the rejects. That is a
checkable design constraint, and it lines up exactly with S-02's standing rule that **reject
is not delete** (`context/archive/2026-07-09-manual-card-crud/plan.md:87-88`).

## Code References

- `src/lib/flashcards.ts:42,63-70,91-95,101-109` — state constant, accepted-only read, fixed-state insert, edit that ignores state
- `src/lib/generations.ts:15-16,29-34,38-54` — `STATE_GENERATED`/`SOURCE_AI`, compensating update, bulk candidate insert
- `src/pages/api/generate.ts:37-47,95-227` — request schema, write order, status codes, response shape
- `src/components/generate/GeneratorForm.tsx:88-89,106,175-177,315-332` — the S-05 seam, retry payload replay, read-only results
- `src/components/flashcards/FlashcardWorkspace.tsx:62-66,145` — island state ownership, row grid
- `src/components/flashcards/FlashcardItem.tsx:16-33,95-97,170-228` — props contract, native POST edit form, fixed-height row
- `src/lib/study.ts:138-151,179,267-271,277` — lazy schedule seeding, orphan-row comment, accepted-only resolve
- `supabase/migrations/20260705180246_init_core_schema.sql:21-34,57-69,126-142` — state lookup, flashcard table, RLS
- `supabase/migrations/20260712162349_generation_session.sql:21-49` — session table (no dedup constraint), `generation_id` link
- `supabase/migrations/20260712162359_deck_keyword_search.sql:46-61` — search RPC with no state filter
- `supabase/migrations/20260724220524_srs_study_schedule_review_fixes.sql:46-68` — `study_due_cards`, `f.state_id = 2`
- `tests/generation/generate.test.ts:20-22,130-213` — the characterization test to invert
- `src/components/Sidebar.astro:13-32` — static nav array and `activeItem` union

## Architecture Insights

- **State is set, never changed.** The codebase's whole write surface is insert-or-replace-fields;
  S-05 introduces lifecycle mutation as a concept. Expect the plan to need a named lib
  function (the counterpart to `updateFlashcard`) rather than an inline `.update()`.
- **RLS is the only lock, and it is column-blind.** Ownership is enforced once, structurally,
  by EXISTS-join. Any rule about *which* state change is legal is application-level by
  construction — consistent with `FRONT_MAX`/`BACK_MAX` living in `src/lib/flashcards.ts`
  rather than as DB CHECKs.
- **Two endpoint conventions coexist on purpose**, each documented at its own seam. S-05
  picking JSON would be the third instance of the same justified exception, not a new
  precedent.
- **Progressive disclosure is the project's habit**: `generation_session` arrived with S-04,
  schedule columns with S-03, `source_id` with S-02. A minimal `?state=` view now, with
  FR-014's full filter left parked, is the established shape.
- **Deferrals are written down and honoured.** Three separate archived slices name S-05 and
  say what it inherits. This research's main value is that two of those handoffs are
  invisible from the Jira ticket and the roadmap row.

## Historical Context (from prior changes)

- `context/archive/2026-07-11-ai-candidate-generation/plan.md:77-78,94-99,443-471` — review flow,
  the `?state=` toggle and the S-06 search reconciliation all deferred here by name.
- `context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108` — F5,
  idempotency deferred to S-05 as an accepted rule; F1–F4 fixed in place.
- `context/archive/2026-07-09-manual-card-crud/plan.md:87-88,91-92` — reject ≠ delete; the
  state/source badge deferred to S-05. `change.md:14-22` — deferred ideas including a
  selection-driven toolbar (the closest existing sketch of a bulk UI, never built).
- `context/archive/2026-07-09-manual-card-crud/reviews/impl-review.md:42-50` → `context/foundation/lessons.md:96-101`
  — decide the scope of neighbouring components *before* building, not in review.
- `context/archive/2026-07-24-srs-study-session/plan.md:82-84,119-127` and
  `reviews/impl-review.md:155-183` — accepted-only gate, lazy seeding, and the pre-emptive
  F3 fix that makes S-05's reject safe.
- `context/archive/2026-07-18-mutation-generate-risk2/mutation-register.md:14,38` — Risk #2
  marked "odroczone → F5 / S-05".
- `context/changes/bootstrap-verification/` and `context/changes/deployment/` — checked, not
  relevant: project-bootstrap and first-deploy runbooks, no schema or UI decisions.

## Related Research

- `context/archive/2026-07-09-srs-library-choice/srs-library-research.md` — FSRS choice and
  the constraint that FSRS `srs_state` stays a separate column from `flashcard.state_id`.
- `context/foundation/test-plan.md` §6.2, §6.5, §6.6 — the integration-test pattern S-05's
  tests must follow, the generation-path facts (mock determinism, `saved_count` is not an
  oracle), and the standing instruction to invert the duplication assertion when idempotency
  lands.
- No `research.md` exists for `ai-candidate-generation` — that slice went plan-first.

## Open Questions

These are decisions for `/10x-plan`, not gaps in the research:

1. **Where does review live?** S-04's plan assumed the deck view with a `?state=`
   round-trip, but a fresh generation is naturally scoped by `generation_id` (one session's
   candidates) while a deck view is scoped by state across all sessions. These are different
   screens with different empty states. Picking one — or building the deck-view toggle and
   linking into it from the generator with a `?generation=` scope — is the first design call.
2. **formData or JSON for accept/reject?** Bulk pushes toward JSON (structured partial-failure
   result); per-card would fit the existing formData + `?error=` round-trip. Mixing them for
   the same action would be the worst outcome.
3. **Is the idempotency debt in this slice?** Costed in §7(a); recommended as a separable
   final phase. Needs an explicit yes/no so the characterization test's fate is deliberate.
4. **What guards the transition graph?** Nothing does today. Does `accepted → rejected`
   (un-accepting a studied card) need to be possible, blocked, or merely unexercised?
   Answering it also decides whether the orphaned-schedule-row residue (§5) needs any note
   in the UI.
5. **Does the state/source badge ship here?** S-02 deferred it to S-05 on the grounds that a
   single-valued badge is noise — with three states in play that reasoning now inverts.
6. **How much of the acceptance metric is surfaced?** §8 shows it is derivable with no
   migration; whether S-05 *displays* it (per-generation acceptance) or merely preserves its
   derivability is a scope choice.
7. **Pagination / scope for candidate lists.** `listFlashcards` has none, and candidates can
   accumulate across generations. Per-generation scoping may make this moot for the MVP.
