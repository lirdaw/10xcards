---
project: "10xCards"
context_type: greenfield
created: 2026-06-29
updated: 2026-06-29
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 5
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "workflow friction + entry barrier + lack of time — manual card creation is the bottleneck that kills spaced-repetition adoption"
    - topic: "primary persona"
      decision: "self-directed learning student who already has source material and wants to turn it into flashcards fast"
    - topic: "insight"
      decision: "AI removes the most expensive step (card authoring); quality of cards matters more than a fancy SRS algorithm; simplicity lowers the barrier vs Anki"
  frs_drafted: 19
  quality_check_status: accepted
---

# Shape Notes — 10xCards

## Vision & Problem Statement

Creating high-quality educational flashcards by hand is slow and tedious. A
self-directed learner who already has source material — lecture notes, a textbook
chapter, an article — wants to study it with spaced repetition, a proven method,
but is blocked by the upfront cost of turning that material into a deck. The
friction shows up at the very start: building the first deck is so laborious that
most learners either abandon spaced repetition entirely or study less effectively
because they never make enough cards.

The insight: spaced repetition is already proven — the real, unmet bottleneck is
the *authoring* of good cards, not a better repetition algorithm. AI can remove
the most expensive step by generating cards directly from pasted text, while a
minimal, simple tool lowers the barrier to entry that heavier tools (e.g. Anki)
raise. The product bets on card-generation quality plus simplicity, not on owning
the scheduling algorithm.

## User & Persona

**Primary persona — Self-directed learning student.** A student or adult self-learner
who studies independently (exam prep, coursework, picking up a new subject). They
already have source material in text form and are motivated to learn, but lack a
cheap, fast way to convert that material into study-ready flashcards. They reach
for 10xCards at the moment they have a block of text and want a usable deck without
manually authoring every card.

<!-- Pain category: workflow friction + entry barrier + lack of time (all three reinforce). -->

## Access Control

Multi-user web app with email + password authentication. Flashcard data is private
per user — each account sees and manages only its own decks.

Two roles:

- **User** (primary) — signs up / signs in with email + password; creates, generates,
  reviews, edits, and deletes their own flashcards; studies their own decks. Cannot
  see other users' data.
- **Admin** — DEFERRED to v2. The full admin panel (user management, AI usage
  statistics & monitoring, content moderation) is out of MVP scope. MVP ships a
  visible **mock/placeholder** for the admin area so the planned capability is
  discoverable, but no working admin functionality.

For MVP, the working model is therefore flat: a single user role. Each user sees and
manages only their own flashcards. Unauthenticated visitors can reach only sign-up /
sign-in; all flashcard and study routes are gated.

<!-- SCOPE DECISION (Phase 3): full admin panel cut from MVP → v2; MVP keeps only a
     visible mock so the roadmap is signalled. Flat single-role model in MVP. -->

## Success Criteria

### Primary
- At least 75% of AI-generated flashcards are accepted by the user (acceptance rate
  measured over generated cards).
- At least 75% of all flashcards a user creates are produced with AI generation
  (vs. manual authoring) — proves AI is the primary creation path.
- The end-to-end flow works: paste text → generate → review/accept/edit → save deck
  → study via spaced repetition.

> Measurement: both 75% thresholds are computable from the data model alone, with no separate
> analytics in MVP. The `status` and `origin` fields exist partly for this — acceptance rate =
> cards with status `accepted` ÷ cards with status `generated`; AI share = cards with
> `origin: ai` ÷ all created cards. A simple query answers both.

### Secondary
- Users return for a subsequent study session (retention signal — the spaced-repetition
  loop is actually used, not just deck creation).

### Guardrails
- Per-account data isolation: no user can ever see another user's flashcards or source
  text — a hard boundary.
- Privacy of pasted source text: submitted text and generated cards stay private to the
  account; not public, not shared across users.
- Spaced-repetition scheduling correctness: the review algorithm does not lose cards or
  corrupt the review schedule — study stays trustworthy.
- Responsive generation feedback: AI generation gives visible feedback and does not
  freeze the UI during longer processing.

## Timeline acknowledgment

Acknowledged on 2026-06-29: ~4–5-week MVP (recorded as 5) requires sustained dedication
across after-hours evenings/weekends; user explicitly accepted the sustained-effort cost
after scoping the admin panel out of MVP. Project is after-hours, no hard deadline.

## Functional Requirements

### Accounts & access
- FR-001: User can register an account with email and password. Priority: must-have
  > Socratic: Counter-arguments considered (passwords add friction vs OAuth; accounts maybe
  > unneeded in MVP). Resolution: stands — private per-user decks require accounts.
- FR-002: User can sign in and sign out. Priority: must-have
  > Socratic: Counter (session management is hidden cost). Resolution: stands — login is the
  > foundation for private decks.

### AI flashcard generation
- FR-003: User can paste a block of text as source material, up to a defined maximum length. Priority: must-have
  > Socratic: Counter (no length limit hurts AI quality/cost; users may want file import).
  > Resolution: stands — paste is the simplest core input; file import is deliberately out of
  > MVP. A maximum source-text length DOES apply (decided); the exact value is tuned during
  > stack / AI-model selection.
- FR-004: User can generate a set of candidate flashcards from the pasted text via AI. Priority: must-have
  > Socratic: Counter-argument accepted: "poor AI generation quality would push the acceptance
  > rate below the 75% success criterion." Resolution: kept — generation is the whole product
  > thesis; the risk is mitigated by generation-quality work and the responsive-feedback
  > guardrail, and acceptance rate is the primary metric watched.
- FR-005: User can review the candidates and accept, edit, or reject each one — individually or in bulk, whichever is more convenient. Priority: must-have
  > Socratic: Counter (per-card review is heavy UI). Resolution: revised — support BOTH
  > single-card and bulk accept/reject so the user picks what's convenient; per-card control is
  > also what produces the acceptance metric.
- FR-006: Each flashcard carries a status — generated / accepted / rejected; only accepted cards feed the spaced-repetition mechanism, and the user can revisit a deck and review cards by status. Priority: must-have
  > Socratic: Counter (explicit save vs auto-save). Resolution: revised into a status model —
  > cards have generated/accepted/rejected status; the user can return to the deck and browse
  > by status; only accepted cards are pulled into review.
- FR-018: When AI generation fails or times out, the user sees a clear error message and can retry the generation. Priority: must-have
  > Added during refinement: until now only the success path was specified; the MVP must handle
  > the failure path so a flaky/slow generation does not strand the user with no feedback.

### Manual flashcard management (CRUD)
- FR-007: User can manually create a flashcard (front/back). Priority: must-have
  > Socratic: Counter (manual creation undercuts the AI-first 75% thesis). Resolution: stands —
  > needed as a complement/fallback when AI misses something; the 75%-via-AI target is a goal,
  > not a lock-out of manual authoring.
- FR-008: User can browse the list of their flashcards within a deck. Priority: must-have
  > Socratic: Counter (a flat list doesn't scale without filters/search). Resolution: stands as
  > the base read; filtering and search are split out into FR-014, FR-015, FR-016, FR-019.
- FR-009: User can edit an existing flashcard. Priority: must-have
  > Socratic: Counter (edit only during review, not later). Resolution: stands — editing a saved
  > card is necessary and consistent with the status model (edit at any time).
- FR-010: User can delete a flashcard. Priority: must-have
  > Socratic: Counter (does 'rejected' status make hard delete redundant?). Resolution: revised
  > note — a rejected card is NOT deleted; it keeps its rejected status, but the user can still
  > explicitly pick any card and hard-delete it. Reject and delete are distinct operations.

### Decks
- FR-017: User can create and name multiple decks, and every flashcard (AI-generated or manual) belongs to a deck; generation, filtering, and search operate within a deck. Priority: must-have
  > Resolution of OQ#1: the product supports multiple named decks (not a single flat per-user
  > collection). This is the grouping that FR-008/FR-014/FR-015 mean by "within a deck."

### Flashcard discovery (filter & search)
- FR-015: User can search flashcards within a deck by keyword. The user types a query and presses Enter; matching is a simple substring match against the card's `front` and `back`. Priority: must-have
  > Simplified for MVP: substring match on Enter, no relevance ranking and no live-as-you-type.
  > The richer behaviour moves to FR-019 (nice-to-have).
- FR-014: User can filter flashcards within a deck by status (generated / accepted / rejected) and by generation date range (from–to). Priority: nice-to-have
- FR-016: User can filter flashcards by review status per the SRS schedule (e.g. due in 1 / 5 / 10 days). Priority: nice-to-have
  > Note: explicitly a later-stage capability tied to the spaced-repetition algorithm; not core MVP.
- FR-019: Relevance-ranked, live-as-you-type search — results ranked by match quality and updated live after 3 characters typed. Priority: nice-to-have
  > Extension of FR-015: upgrades the MVP substring-on-Enter search to ranked, incremental search.

### Study (spaced repetition)
- FR-011: User can start a study session in which a ready-made SRS algorithm selects the cards due for review. Priority: must-have
  > Socratic: Counter (SRS is the biggest retained cost; deck-building alone could prove value).
  > Resolution: stands — deliberately kept in MVP; spaced repetition is the core of the
  > "effective method" in the vision, and generation without study is only half the value.
- FR-012: User can rate their recall on a card, which feeds the review schedule. Priority: must-have
  > Socratic: Counter (a complex rating scale overwhelms). Resolution: stands — recall rating is
  > required to drive the ready-made SRS. Decided: the rating scale follows whatever the chosen
  > ready-made SRS library expects; the exact scale is pinned at stack selection.

### Roadmap / admin (mock)
- FR-013: User (future admin) sees a placeholder for the admin area signalling the planned capability. Priority: nice-to-have
  > Socratic: Counter (a non-working mock confuses users / is wasted MVP effort). Resolution:
  > stands — the visible mock is a deliberate Phase-3 decision to signal the roadmap; kept as
  > nice-to-have.

## User Stories

### US-01: Learner turns pasted text into a study-ready deck

- **Given** a signed-in user with a block of source text (e.g. lecture notes)
- **When** they paste the text and request AI generation, then review the candidates
- **Then** they can accept, edit, or reject each candidate and save the accepted cards
  to their own deck, ready to study

#### Acceptance Criteria
- Each candidate card can be individually accepted, edited, or rejected before saving.
- Only accepted cards are persisted to the user's deck.
- Saved cards belong solely to that user (no cross-account visibility).
- Generation gives visible feedback and does not freeze the UI during processing.

### US-02: Learner studies a deck via spaced repetition

- **Given** a signed-in user with a deck containing accepted flashcards
- **When** they start a study session and rate their recall on each card
- **Then** the SRS shows only the cards due now, and each rating shifts that card's next review
  date (known cards resurface less often, hard cards sooner); rejected or not-yet-accepted cards
  never appear in study

#### Acceptance Criteria
- Only cards with status `accepted` enter a study session.
- The review schedule survives between sessions — no card is lost and the schedule is not corrupted.
- A card the user rates as well-known is deferred further than a card they struggle with.

### US-03: Learner creates a flashcard manually

- **Given** a signed-in user inside a deck
- **When** they manually create a flashcard (front/back)
- **Then** the card is saved into that deck with `origin: manual` and becomes available for study
  under the standard status rules

#### Acceptance Criteria
- A manually created card is persisted with `origin: manual`.
- The card follows the same status lifecycle as any other card before it can be studied.
- The card belongs to the deck it was created in and to that user only.

## Business Logic

The application turns a block of user-supplied text into a set of candidate flashcards and
then schedules the accepted cards for review over time so as to maximise long-term retention.

The rule consumes two kinds of user-facing input. First, the source text the user pastes in:
from it the product derives a set of question/answer candidate cards, which the user accepts,
edits, or rejects — only accepted cards become part of what the user studies. Second, during
study the user's self-rated recall on each card: each rating is the input that decides when
that card should next resurface.

The output is twofold and is how the user encounters the rule in the flow: at authoring time,
a reviewable set of candidate cards (so the expensive step of writing cards is removed); at
study time, a session that presents exactly the cards due now and defers the rest, spacing
repetitions further apart for cards the user knows well and sooner for cards they struggle
with. The user never schedules anything manually — the product decides what to show and when,
which is the decision that makes this more than a CRUD list of notes.

## Data Model

> Note: a column-level data model is normally pinned downstream (during stack selection), not in
> a PRD. This section is captured here as an explicit user decision and is informational input for
> the downstream stack step, not a PRD-schema section.

Entities and key fields:

- **User** — an account identified by email + password.
- **Deck** — belongs to a User; has a name. A User may own many Decks.
- **Flashcard** — belongs to a Deck. Fields:
  - `front`, `back` — card content
  - `status` — `generated` | `accepted` | `rejected`
  - `origin` — `ai` | `manual`
  - SRS scheduling fields (e.g. due date, interval / ease factor) — shaped by the chosen ready-made
    SRS library; pinned at stack selection
  - timestamps (`created`, `updated`)
- **GenerationSession (source text)** — belongs to a User; stores the pasted source text and links
  to the Flashcards generated from it.

Relations: User 1—N Deck; Deck 1—N Flashcard; User 1—N GenerationSession; GenerationSession 1—N
Flashcard (the cards it produced).

### Flashcard lifecycle (confirmed decision)

Consistent with FR-005 / FR-006 / FR-010:

- AI-generated cards are PERSISTED to the database immediately with status `generated`.
- ONLY cards with status `accepted` are pulled into study (SRS).
- Rejecting a card sets status `rejected` but the card REMAINS in the database (reject ≠ delete).
- During accept/reject the user may also fully hard-delete a card, or edit it.

### Source-text retention (confirmed decision)

The pasted source text is STORED and linked to its generation session, so a generation can later be
re-run from the same input. Source text is private per user (consistent with the data-isolation
guardrail).

### Content language (confirmed decision)

Two distinct language facts — keep them separate:

- **User interface = Polish.** The site/app UI is in Polish.
- **Flashcard content + source text = the language of the user's material.** Whatever language the
  user is studying (e.g. learning English → English cards; a Spanish text → Spanish cards). Pasted
  source text and the generated cards are in that language; generation produces cards in the
  language of the source material — not always Polish.

This is a direct input to AI-model selection in the next chain step: the model must generate well in
the languages users actually supply (Polish included), not just English. (Also recorded under
`## Forward: tech-stack`.)

## Non-Functional Requirements

- The user sees acknowledgement of any action within ~200 ms, and continuous visible progress
  during any operation that takes longer than ~2 s (notably AI generation).
- Source text and flashcards stay private to the account that created them; no user can observe
  another user's text or cards under any flow.
- Accepted flashcards and each card's review schedule survive intact across sessions — no card
  is silently lost and no schedule is corrupted.
- The product remains usable on the latest two major versions of the mainstream desktop
  browsers, with baseline keyboard and screen-reader accessibility.

## Non-Goals

- **No custom spaced-repetition algorithm.** The MVP integrates a ready-made SRS; it does not
  build its own SuperMemo/Anki-style scheduler. (buy-vs-build closed in favour of buy.)
- **No multi-format import.** Input is copy-paste text only; no PDF, DOCX, or other file import
  in the MVP.
- **No mobile app and no external integrations.** Web only; no native/mobile client and no
  integration with external educational platforms.
- **No working admin panel.** Full admin functionality (user management, AI usage statistics,
  content moderation) is deferred to v2; the MVP ships only a visible mock/placeholder so the
  roadmap is signalled.
- **No deck sharing between users.** The MVP is hard single-tenant: decks and cards are private
  to their owner; no sharing, publishing, or collaboration. Consistent with the per-account
  data-isolation guardrail. (Resolved from an earlier open question.)

## Open Questions

All product-level open questions raised during shaping were resolved (decks → multiple named
decks; sharing → non-goal; source-text limit → a limit applies; recall scale → follows the SRS
library). Two specifics remain bound to the downstream stack/AI-model choice, not to product
shape:

1. **Exact maximum source-text length** — a limit is decided (FR-003); the concrete value is
   tuned during stack / AI-model selection. Owner: downstream stack step.
2. **Exact recall-rating scale** — decided to follow the chosen ready-made SRS library (FR-012);
   the concrete scale is pinned at stack selection. Owner: downstream stack step.
3. **Cards produced per generation** — fixed target count vs. let the AI decide based on the input.
   Likely model-dependent; deferred to the stack / AI-model selection step. Owner: downstream stack step.

## Forward: tech-stack

<!-- Not part of the PRD schema — informational input for the downstream tech-stack-selection step. -->
- **UI language is Polish; content language follows the user's material.** The interface is Polish,
  but flashcard content and source text are in whatever language the user studies (Polish, English,
  Spanish, …). This constrains AI-model choice — model selection must weigh generation quality
  across the languages users actually supply (Polish + others), not just English benchmarks and not
  Polish alone.
- **Ready-made SRS library required.** No custom scheduler (see Non-Goals); the SRS library choice
  determines the scheduling fields and the recall-rating scale (Open Questions #2/#3 above).

## Forward: technical-roadmap

<!-- Not part of the PRD schema — informational for downstream chain steps. -->
- **Tests addressing a defined risk** (criteria.md #3): a `context/foundation/test-plan.md`
  defining at least one concrete risk, plus at least one real test that exercises it, is a
  required project deliverable. This is intentionally NOT captured as an FR — testing strategy
  is gathered downstream of stack selection. Candidate risks to cover: per-account data
  isolation (a user must never see another's cards), and SRS scheduling correctness (cards
  not lost / schedule not corrupted).
- **README** (criteria.md #5): project README describing what 10xCards is, alongside the PRD
  produced by this chain.

## Quality cross-check

Closing soft-gate, all six elements present (greenfield):

- **Access Control** — present. Email+password; flat single-user role in MVP; flashcard/study
  routes gated; admin deferred to v2 (visible mock).
- **Data Model** — present. User / Deck / Flashcard / GenerationSession with fields, relations,
  and a confirmed flashcard lifecycle. (User-requested; informational input for downstream.)
- **Business Logic** — present. One-sentence rule: text → candidate cards, then schedule accepted
  cards over time to maximise retention.
- **Project artifacts** — present. shape-notes.md with a valid checkpoint block.
- **MVP timeline (three-week target)** — passed via acknowledgment. Estimated 5 weeks (> 3), with
  a `## Timeline acknowledgment` recording the accepted sustained-effort cost. The Phase-7
  simplification (search/filter demoted to nice-to-have) reduces scope, making the 5-week estimate
  more comfortable; the user may optionally revise `mvp_weeks` down.
- **Non-Goals** — present. Five entries (no custom SRS, no file import, no mobile/integrations, no
  working admin panel, no deck sharing).

Result: no gaps — `quality_check_status: accepted`.
