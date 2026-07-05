---
project: "10xCards"
version: 1
status: draft
created: 2026-06-29
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 5
  hard_deadline: null
  after_hours_only: true
---

# 10xCards — Product Requirements Document

## Vision & Problem Statement

Creating high-quality educational flashcards by hand is slow and tedious. A self-directed
learner who already has source material — lecture notes, a textbook chapter, an article — wants
to study it with spaced repetition, a proven method, but is blocked by the upfront cost of
turning that material into a deck. The friction shows up at the very start: building the first
deck is so laborious that most learners either abandon spaced repetition entirely or study less
effectively because they never make enough cards.

The insight: spaced repetition is already proven — the real, unmet bottleneck is the authoring
of good cards, not a better repetition algorithm. Generating cards directly from pasted text
removes the most expensive step, while a minimal, simple tool lowers the barrier to entry that
heavier study tools raise. The product bets on card-generation quality plus simplicity, not on
owning the scheduling algorithm.

## User & Persona

**Primary persona — Self-directed learning student.** A student or adult self-learner who
studies independently (exam prep, coursework, picking up a new subject). They already have
source material in text form and are motivated to learn, but lack a cheap, fast way to convert
that material into study-ready flashcards. They reach for 10xCards at the moment they have a
block of text and want a usable deck without manually authoring every card. They use the product
in Polish (the interface is Polish), but the material they study can be in any language — they
might paste Polish notes, or an English or Spanish text — and expect cards in that language.

## Success Criteria

### Primary
- At least 75% of automatically generated flashcards are accepted by the user (acceptance rate
  measured over generated cards).
- At least 75% of all flashcards a user creates are produced through automatic generation rather
  than manual authoring — proving generation is the primary creation path.
- The end-to-end flow works: paste text → generate → review/accept/edit → save deck → study via
  spaced repetition.

### Secondary
- Users return for a subsequent study session — a retention signal that the spaced-repetition
  loop is actually used, not just deck creation.

### Guardrails
- Per-account data isolation: no user can ever see another user's flashcards or source text — a
  hard boundary.
- Privacy of pasted source text: submitted text and generated cards stay private to the account;
  not public, not shared across users.
- Spaced-repetition scheduling correctness: the review schedule does not lose cards or become
  corrupted — study stays trustworthy.
- Responsive generation feedback: generation gives visible feedback and does not freeze the
  interface during longer processing.

## User Stories

### US-01: Learner turns pasted text into a study-ready deck

- **Given** a signed-in user with a block of source text (e.g. lecture notes)
- **When** they paste the text and request generation, then review the candidates
- **Then** they can accept, edit, or reject each candidate, and the accepted cards become part of
  their own deck, ready to study

#### Acceptance Criteria
- Each candidate card can be individually accepted, edited, or rejected.
- Generated candidates are saved with a generated state; only accepted cards become part of what
  the user studies.
- Saved cards belong solely to that user (no cross-account visibility).
- Generation gives visible feedback and does not freeze the interface during processing.

### US-02: Learner studies a deck via spaced repetition

- **Given** a signed-in user with a deck containing accepted flashcards
- **When** they start a study session and rate their recall on each card
- **Then** the schedule shows only the cards due now, and each rating shifts that card's next
  review date (known cards resurface less often, hard cards sooner); rejected or not-yet-accepted
  cards never appear in study

#### Acceptance Criteria
- Only accepted cards enter a study session.
- The review schedule survives between sessions — no card is lost and the schedule is not corrupted.
- A card the user rates as well-known is deferred further than a card they struggle with.

### US-03: Learner creates a flashcard manually

- **Given** a signed-in user inside a deck
- **When** they manually create a flashcard (front/back)
- **Then** the card is saved into that deck, recorded as manually authored, and becomes available
  for study under the standard status rules

#### Acceptance Criteria
- A manually created card is recorded as manually authored.
- The card follows the same status lifecycle as any other card before it can be studied.
- The card belongs to the deck it was created in and to that user only.

## Functional Requirements

### Accounts & access
- FR-001: User can register an account with email and password. Priority: must-have
  > Socratic: Counter-arguments considered (passwords add friction vs OAuth; accounts maybe
  > unneeded in MVP). Resolution: stands — private per-user decks require accounts.
- FR-002: User can sign in and sign out. Priority: must-have
  > Socratic: Counter (session management is hidden cost). Resolution: stands — login is the
  > foundation for private decks.

### Automatic flashcard generation
- FR-003: User can paste a block of text as source material, up to a defined maximum length. Priority: must-have
  > Socratic: Counter (no length limit hurts generation quality/cost; users may want file import).
  > Resolution: stands — paste is the simplest core input; file import is deliberately out of MVP.
  > A maximum source-text length does apply (decided); the exact value is tuned downstream.
- FR-004: User can generate a set of candidate flashcards from the pasted text. Priority: must-have
  > Socratic: Counter-argument accepted: "poor generation quality would push the acceptance rate
  > below the 75% success criterion." Resolution: kept — generation is the whole product thesis;
  > the risk is mitigated by generation-quality work and the responsive-feedback guardrail, and
  > acceptance rate is the primary metric watched.
- FR-005: User can review the candidates and accept, edit, or reject each one — individually or in bulk, whichever is more convenient. Priority: must-have
  > Socratic: Counter (per-card review is heavy UI). Resolution: revised — support both
  > single-card and bulk accept/reject so the user picks what's convenient; per-card control is
  > also what produces the acceptance metric.
- FR-006: Each flashcard carries a state — generated, accepted, or rejected; only accepted cards feed the spaced-repetition mechanism, and the user can revisit a deck and review cards by state. Priority: must-have
  > Socratic: Counter (explicit save vs auto-save). Resolution: revised into a state model —
  > cards have generated/accepted/rejected state; the user can return to the deck and browse by
  > state; only accepted cards are pulled into review.
- FR-018: When generation fails or times out, the user sees a clear error message and can retry the generation. Priority: must-have
  > Added during refinement: until now only the success path was specified; the MVP must handle
  > the failure path so a flaky/slow generation does not strand the user with no feedback.

### Manual flashcard management (CRUD)
- FR-007: User can manually create a flashcard (front/back). Priority: must-have
  > Socratic: Counter (manual creation undercuts the generation-first 75% thesis). Resolution:
  > stands — needed as a complement/fallback when generation misses something; the 75%-via-generation
  > target is a goal, not a lock-out of manual authoring.
- FR-008: User can browse the list of their flashcards within a deck. Priority: must-have
  > Socratic: Counter (a flat list doesn't scale without filters/search). Resolution: stands as
  > the base read; filtering and search are split out into FR-014, FR-015, FR-016, FR-019.
- FR-009: User can edit an existing flashcard. Priority: must-have
  > Socratic: Counter (edit only during review, not later). Resolution: stands — editing a saved
  > card is necessary and consistent with the state model (edit at any time).
- FR-010: User can permanently delete a flashcard. Priority: must-have
  > Socratic: Counter (does the 'rejected' state make permanent deletion redundant?). Resolution:
  > revised note — a rejected card is not deleted; it keeps its rejected state, but the user can
  > still explicitly pick any card and permanently delete it. Reject and delete are distinct.

### Decks
- FR-017: User can create and name multiple decks, and every flashcard (generated or manual) belongs to a deck; generation, filtering, and search operate within a deck. Priority: must-have
  > Resolution of an earlier open question: the product supports multiple named decks (not a
  > single flat per-user collection). This is the grouping that FR-008/FR-014/FR-015 mean by
  > "within a deck."

### Flashcard discovery (filter & search)
- FR-015: User can search flashcards within a deck by keyword. The user types a query and confirms it; matching looks for the keyword inside the card's front and back text. Priority: must-have
  > Simplified for MVP: keyword match on confirm, no relevance ranking and no live-as-you-type.
  > The richer behaviour moves to FR-019 (nice-to-have).
- FR-014: User can filter flashcards within a deck by state (generated / accepted / rejected) and by generation date range (from–to). Priority: nice-to-have
- FR-016: User can filter flashcards by review status per the spaced-repetition schedule (e.g. due in 1 / 5 / 10 days). Priority: nice-to-have
  > Note: explicitly a later-stage capability tied to the spaced-repetition schedule; not core MVP.
- FR-019: Relevance-ranked, live-as-you-type search — results ranked by match quality and updated live after 3 characters typed. Priority: nice-to-have
  > Extension of FR-015: upgrades the MVP keyword-on-confirm search to ranked, incremental search.

### Study (spaced repetition)
- FR-011: User can start a study session in which the spaced-repetition schedule selects the cards due for review. Priority: must-have
  > Socratic: Counter (spaced repetition is the biggest retained cost; deck-building alone could
  > prove value). Resolution: stands — deliberately kept in MVP; spaced repetition is the core of
  > the "effective method" in the vision, and generation without study is only half the value.
- FR-012: User can rate their recall on a card, which feeds the review schedule. Priority: must-have
  > Socratic: Counter (a complex rating scale overwhelms). Resolution: stands — recall rating is
  > required to drive the schedule; the exact rating scale is pinned downstream.

### Roadmap / admin (mock)
- FR-013: User (future admin) sees a placeholder for the admin area signalling the planned capability. Priority: nice-to-have
  > Socratic: Counter (a non-working mock confuses users / is wasted MVP effort). Resolution:
  > stands — the visible mock is a deliberate decision to signal the roadmap; kept as nice-to-have.

## Non-Functional Requirements

- The user sees acknowledgement of any action within ~200 ms, and continuous visible progress
  during any operation that takes longer than ~2 s (notably generation).
- Source text and flashcards stay private to the account that created them; no user can observe
  another user's text or cards under any flow.
- Accepted flashcards and each card's review schedule survive intact across sessions — no card is
  silently lost and no schedule is corrupted.
- The product remains usable on the latest two major versions of the mainstream desktop browsers,
  with baseline keyboard and screen-reader accessibility.
- The product's user interface is in Polish.
- Flashcard content and pasted source text follow the user's chosen material and may be in any
  language the user supplies (e.g. Polish, English, Spanish); automatic generation produces cards
  in the language of the source text. Handling the languages users actually supply — Polish
  included — is a first-class requirement, not an afterthought.

## Business Logic

The application turns a block of user-supplied text into a set of candidate flashcards and then
schedules the accepted cards for review over time so as to maximise long-term retention.

The rule consumes two kinds of user-facing input. First, the source text the user pastes in: from
it the product derives a set of question/answer candidate cards, which the user accepts, edits, or
rejects — only accepted cards become part of what the user studies. Second, during study the
user's self-rated recall on each card: each rating is the input that decides when that card should
next resurface.

The output is twofold and is how the user encounters the rule in the flow: at authoring time, a
reviewable set of candidate cards (so the expensive step of writing cards is removed); at study
time, a session that presents exactly the cards due now and defers the rest, spacing repetitions
further apart for cards the user knows well and sooner for cards they struggle with. The user
never schedules anything manually — the product decides what to show and when, which is the
decision that makes this more than a CRUD list of notes.

## Access Control

Multi-user web app with email + password authentication. Flashcard data is private per user —
each account sees and manages only its own decks.

Two roles:

- **User** (primary) — signs up / signs in with email and password; creates, generates, reviews,
  edits, and deletes their own flashcards; studies their own decks. Cannot see other users' data.
- **Admin** — deferred to a later version. The full admin area (user management, usage statistics
  & monitoring, content moderation) is out of MVP scope. The MVP ships a visible mock/placeholder
  for the admin area so the planned capability is discoverable, but no working admin functionality.

For MVP, the working model is therefore flat: a single user role. Unauthenticated visitors can
reach only sign-up / sign-in; all flashcard and study routes are gated.

## Non-Goals

- **No custom spaced-repetition algorithm.** The MVP relies on an existing, ready-made scheduling
  approach; it does not build its own advanced, self-authored repetition algorithm. (buy-vs-build
  closed in favour of buy.)
- **No multi-format import.** Input is copy-paste text only; no PDF, DOCX, or other file import in
  the MVP.
- **No mobile app and no external integrations.** Web only; no native/mobile client and no
  integration with external educational platforms.
- **No working admin area.** Full admin functionality (user management, usage statistics, content
  moderation) is deferred to a later version; the MVP ships only a visible mock/placeholder so the
  roadmap is signalled.
- **No deck sharing between users.** The MVP is hard single-tenant: decks and cards are private to
  their owner; no sharing, publishing, or collaboration. Consistent with the per-account
  data-isolation guardrail.

## Architektura informacji (nawigacja)

Po zalogowaniu aplikacja ma stałą nawigację po lewej stronie. Pozycje menu
odpowiadają głównym przepływom produktu:

- **Talie** — lista własnych talii; wejście w talię pokazuje jej fiszki.
  Widok startowy.
- **Generuj fiszki** — wklejenie tekstu źródłowego, generacja kandydatów AI,
  a następnie ich przegląd (akceptacja / edycja / odrzucenie) przed zapisem
  do talii.
- **Nauka** — wybór talii, po czym rusza sesja powtórek SRS: karty należne
  dziś i ocena przypomnienia na każdej.

Sama nawigacja i pierwszy widok („Talie") powstają z pierwszym slice'em
produktowym; kolejne pozycje włączają się wraz z dostarczeniem
odpowiadającego im przepływu. Szczegóły każdego ekranu (układ, komponenty)
należą do planu danego slice'a, nie do PRD.

## Open Questions

1. **Exact maximum source-text length** — a limit is decided (FR-003); the concrete value is tuned
   during the downstream stack / generation step. Owner: downstream stack step.
2. **Exact recall-rating scale** — the rating scale will follow the chosen ready-made scheduling
   approach (FR-012); the concrete scale is pinned at stack selection. Owner: downstream stack step.
3. **Cards produced per generation** — a fixed target count vs. letting the generator decide based
   on the input. Likely depends on the chosen generation approach; deferred to the downstream stack
   step. Owner: downstream stack step.
