# Characterization test — retry after generation timeout duplicates candidates

## Overview

Land an integration test that pins the **current** behaviour of `/api/generate`: two
identical requests write **two** `generation_session` rows and two distinct sets of
cards. The test measures test-plan §2 Risk #2; it does not prevent it. Idempotency
stays deferred to F5 / S-05 by explicit decision (research Open Question 1, resolved
2026-07-18).

This is a characterization test by intent. It is expected to go **red** when S-05
ships idempotency, and going red is the signal to *invert* the assertion, not to
delete the test.

## Current State Analysis

- `/api/generate` (`src/pages/api/generate.ts`) is the project's first and only JSON
  endpoint. Every write on its path is a separate PostgREST call; there is no
  transaction and no RPC.
- **The duplication is unconditional, not a race.** No client-side attempt id
  (`GeneratorForm.tsx:175-177` re-sends `lastPayload.current` verbatim), no server-side
  idempotency key or in-flight registry, no unique constraint on `(user_id, source_text)`
  or `(deck_id, front, back)`. Any second request with the same payload writes a second
  complete set, whenever it arrives.
- The 40 s / 55 s timeout ordering (`generate.ts:31`, `GeneratorForm.tsx:20`) narrows
  *how often a user triggers* a second request; it has no bearing on what the server does
  when one arrives. `lessons.md:103-108` already records this ("NIE eliminuje wyścigu —
  tylko go zawęża").
- The deferral is documented, not accidental:
  `context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108`
  (finding F5, ACCEPTED-AS-RULE), mirrored in a source comment at `generate.ts:26-30`.
- Generation already runs in deterministic mock mode locally and in CI —
  `OPENROUTER_API_KEY` is absent from `.env` and `.github/workflows/ci.yml`, so
  `generateCandidates` short-circuits to `mockCards(count)` (`src/lib/openrouter.ts:149-158`)
  and returns instantly. No HTTP double is needed; the project has none and deliberately
  never added one.
- The Phase 1 harness is reusable as-is except for one blocker: `CallOptions.body` is
  typed `FormData` (`tests/fixtures/endpoint.ts:39`) and no `Content-Type` is set
  (`:57` sets only `Cookie`).

## Desired End State

`npm test` is green and `tests/generation/generate.test.ts` asserts, against the real
local Postgres through a real session:

1. Two identical POSTs to `/api/generate` targeting the same existing deck produce
   **exactly 2** `generation_session` rows with `status = 'succeeded'` for that
   `source_text`, and **exactly 2** distinct `generation_id` values among the deck's cards.
2. A third POST with *different* source text produces its own session — the positive
   control that separates "duplication observed" from "generation is broken".
3. Two identical POSTs using `newDeckName` behave differently: the second answers 409 and
   writes **no** session, while both paid for an LLM call. This apparent protection comes
   from `deck_user_name_unique`, not from any dedup.

`test-plan.md` §6.5 is no longer TBD, §6.6 records that Risk #2 is **measured, not
protected**, and §3 Phase 2 reads `implementing` (risks #4 and #6 remain untouched).

### Key Discoveries

- `src/pages/api/generate.ts:26-30` — the hazard is acknowledged in-source; the test
  encodes what the comment describes.
- `src/pages/api/generate.ts:107-113`, `:179-189` — `deckNameExists` pre-check happens
  *before* the LLM call, `createDeck` *after* it. Both requests pay; one loses on `23505`
  and returns 409 **before any session row is written**. A test written only against
  `newDeckName` would read green today and prove nothing.
- `src/lib/generations.ts:29-34` — `failGenerationSession` zeroes `saved_count` on the
  compensating path. **Do not assert on `saved_count`**: a duplicated-then-compensated run
  reads as `0` while its row still exists.
- `src/lib/openrouter.ts:109-114` — mock mode returns identical card text every call
  (`Przykładowe pytanie 1..N`). **Do not assert on card content**; `group by front` cannot
  distinguish duplication from the mock repeating itself.
- `tests/fixtures/endpoint.ts:53` — `await AstroContainer.create()` per call, no
  module-level state; `clientFor` (`session.ts:80`) likewise builds fresh. Concurrent calls
  are safe, though this plan uses sequential ones.
- `vitest.config.ts:33` — `testTimeout: 30_000` is below `SERVER_TIMEOUT_MS = 40_000`, so
  reproducing the real timeout window is mechanically impossible. Another reason the
  sequential test is the right one.
- `tests/fixtures/accounts.ts:68-70` — accounts are shared across the run and the suite
  deliberately does not `db:reset`. Rows accumulate; namespace with
  `Date.now().toString(36)` as `decks.test.ts:22` does, and scope every count.

## What We're NOT Doing

- **Not implementing idempotency.** No dedup key, no unique index, no in-flight registry.
  F5 / S-05 keeps ownership.
- **Not reproducing the timeout window.** No fake timers, no delayed mock, no concurrent
  `Promise.all` race. The duplication is unconditional, so timing adds cost and no signal.
- **Not adding an HTTP mocking library.** Mock mode already neutralises the outbound seam.
- **Not marking Risk #2 covered.** §3 Phase 2 stays open; this test measures the bug.
- **Not touching `GeneratorForm.tsx`** or any production code beyond the temporary,
  reverted edit in Phase 2's verification sub-step.
- **Not resolving research Open Questions 2 and 3** (content-hash key vs. attempt id;
  dedup window). Both are S-05's.

## Implementation Approach

Three phases, each ending on a green `npm test`. Phase 1 unblocks the harness for JSON
bodies, Phase 2 writes the test and proves it observes the second write, Phase 3 records
what the coverage does and does not mean.

The test drives the real endpoint with a real session cookie against the real local
Postgres — the §6.4 pattern, nothing mocked. The oracle is row-based at two layers because
the session count alone would miss the case where the second session was compensated to
`failed` while its cards still landed.

## Critical Implementation Details

**Ordering within Phase 2's verification sub-step.** The deliberate-breakage check here is
inverted relative to the §6.6 precedent. For a denial test you neuter the policy and
confirm red. For a test asserting *two* sessions, you must introduce a crude dedup (or make
the second request a no-op) and confirm the test goes red — proving it observes the second
write rather than counting something that was always ≥ 1. Run this **after** the test is
green, then revert the production edit before committing.

**Every count must be scoped twice** — by `source_text` (the suite shares accounts and
never resets the database, so prior runs' rows are present) and by the per-test deck for
the card-layer assertion. An unscoped `count(*)` grows with every run and the test would
pass or fail depending on history.

## Phase 1: Widen the endpoint driver for JSON bodies

### Overview

`/api/generate` is the first endpoint that reads `request.json()`. The Phase 1 driver was
built for the form-POST convention and cannot express a JSON call.

### Changes Required:

#### 1. Endpoint driver

**File**: `tests/fixtures/endpoint.ts`

**Intent**: Allow `callEndpoint` to send a JSON body, so the generation test uses the same
driver as every other integration test rather than reconstructing Container plumbing.

**Contract**: `CallOptions.body` widens from `FormData` to `BodyInit`. The request headers
gain `Content-Type: application/json` **only when the body is not `FormData`** — setting it
unconditionally would break the existing form-POST tests, since `fetch`/`Request` must be
left to derive the multipart boundary itself. The doc comment on `body` ("Endpoints here
read formData, never JSON") is now false and is replaced with a note naming
`/api/generate` as the JSON exception and why (`generate.ts:10-14`).

### Success Criteria:

#### Automated Verification:

- `npm test` passes with no changes to `tests/isolation/*` — existing FormData calls still
  land as multipart
- `npm run lint` passes
- `npx astro sync` produces no diff

#### Manual Verification:

- The widened `body` type reads as intentional in review, and the replaced comment states
  the JSON exception rather than merely deleting the stale claim

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 2: Characterization test + inverted breakage check

### Overview

Write the test that pins the duplication, plus the positive control and the `newDeckName`
asymmetry case. Then prove the primary assertion actually observes the second write.

### Changes Required:

#### 1. The test file

**File**: `tests/generation/generate.test.ts` (new folder, per §6.2 "a sibling folder named
after the concern")

**Intent**: Pin the current non-idempotent contract of `/api/generate` and document, in the
file itself, that this is characterization rather than protection.

**Contract**: A header comment is load-bearing here and must state four things: this test
asserts the bug; it references F5
(`context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108`); S-05
is expected to turn it red; going red is the signal to invert the assertion, not to delete
the test. It must also carry the two mock-mode traps — do not assert on card content, do
not assert on `saved_count`.

Setup: create one deck for account A through the real `/api/decks` endpoint (the
`createDeck` helper pattern from `decks.test.ts:31-44`, including its "Setup failed" guard),
namespaced with `Date.now().toString(36)`.

Three cases:

- **`it()` — two identical requests write two generation sessions.** Two sequential POSTs
  with an identical body `{ deckPublicId, sourceText, language: "auto", count }`. Both
  assert `200`. Then, read back with `clientFor(a.cookieHeader)`:
  `generation_session` filtered by `source_text` and `status = 'succeeded'` → length `2`;
  and the deck's `flashcard` rows → `new Set(rows.map(r => r.generation_id)).size` is `2`.
- **`it()` — a different source text gets its own session (positive control).** A third
  POST to the same deck with distinct `sourceText`, then the same session query scoped to
  *that* text → length `1`. This is what separates "duplication observed" from "generation
  stopped writing entirely"; §6.2 makes it non-negotiable.
- **`it()` — the newDeckName path 409s without a session, and that is not dedup.** Two
  sequential POSTs with the same `newDeckName` and identical source text. First `200`,
  second `409`. Assert exactly **1** `generation_session` for that source text — the loser
  returns before writing one. A comment must state that this comes from
  `deck_user_name_unique` (`20260705180246_init_core_schema.sql:48`), not from any dedup,
  that both requests paid for an LLM call, and that removing the constraint would remove
  the apparent protection.

#### 2. Inverted deliberate-breakage verification (temporary, reverted)

**File**: `src/pages/api/generate.ts` — edited locally, **not committed**

**Intent**: Prove the primary assertion observes the *second* write rather than counting
something that was always ≥ 1.

**Contract**: Introduce a crude dedup before the success-path session insert (`:197`) — e.g.
short-circuit to `200` when a `succeeded` session already exists for
`(user_id, source_text)`. Confirm the first `it()` goes **red** on the session count.
Revert the edit; confirm green. The observed result is written up in Phase 3's §6.5 entry.

### Success Criteria:

#### Automated Verification:

- `npm test` passes with all three new cases green
- `npm run lint` passes
- Running `npm test` twice in a row is green both times — the counts are scoped, not
  history-dependent

#### Manual Verification:

- With the crude dedup applied, the first `it()` fails on the session-count assertion (not
  on a 500 or a timeout); with it reverted, the suite is green again
- The header comment makes it unambiguous to a future reader that a red result means
  "invert me", not "delete me"

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation that the inverted breakage check behaved as described before
proceeding.

---

## Phase 3: Record the coverage — and its limits — in test-plan.md

### Overview

The cookbook entry and the honest status. This is the sub-phase that keeps a green CI from
being read as "duplication is handled".

### Changes Required:

#### 1. Cookbook entry

**File**: `context/foundation/test-plan.md` — §6.5 "Adding a test for the generation path"

**Intent**: Replace the TBD with the pattern this phase established, so the next person
testing the generation path does not re-derive it.

**Contract**: Location (`tests/generation/`), naming (resource, not scenario), reference
test (`generate.test.ts`), run command (`npm test`). Four project-specific facts that are
not obvious from the file: mock mode is the default because `OPENROUTER_API_KEY` is unset,
so no HTTP double is needed; mock output is identical every call, so card content is not an
oracle; `saved_count` is zeroed by the compensating update, so it is not an oracle either;
`testTimeout` (30 s) is below `SERVER_TIMEOUT_MS` (40 s), so the real timeout window cannot
be reproduced in this suite. Plus the outcome of Phase 2's inverted breakage check.

#### 2. Phase note

**File**: `context/foundation/test-plan.md` — §6.6 "Per-rollout-phase notes"

**Intent**: State precisely what this slice does and does not buy.

**Contract**: A dated entry naming this change, stating that Risk #2 is **measured, not
protected**; that the test asserts two sessions because idempotency is deferred to F5 /
S-05; and that when S-05 lands, the correct action is to invert the assertion and only then
mark Risk #2 covered.

#### 3. Rollout status

**File**: `context/foundation/test-plan.md` — §3 Phased Rollout table

**Intent**: Reflect reality without over-claiming.

**Contract**: Phase 2's Status moves `not started` → `implementing`, Change folder →
`context/changes/ai-candidate-generation-test/`. It must **not** read `complete`: risks #4
and #6 are untouched and #2 is characterized rather than covered.

#### 4. Change identity

**File**: `context/changes/ai-candidate-generation-test/change.md`

**Intent**: Keep the change folder's status truthful for the orchestrator.

**Contract**: `status: planned` → `implementing` → `complete` as phases land;
`updated:` stamped.

### Success Criteria:

#### Automated Verification:

- `npm run format` leaves `test-plan.md` unchanged (or its changes are committed)
- `npm test` still passes

#### Manual Verification:

- A reader arriving at §3 cannot conclude from the table that duplication on retry is
  prevented
- §6.5 is actionable cold — someone who has not read this plan can add a generation test
  from it

**Implementation Note**: Final phase. After this, the change is ready for `/10x-impl-review`.

---

## Testing Strategy

### Integration Tests

- Two identical POSTs → exactly 2 `succeeded` sessions and 2 distinct `generation_id`
  values (primary + secondary oracle).
- Third POST with different source text → its own session (positive control).
- Two identical `newDeckName` POSTs → 409 on the second, exactly 1 session (asymmetry).

### Manual Testing Steps

1. `npm test` — confirm green.
2. Apply the crude dedup to `src/pages/api/generate.ts` before `:197`; run `npm test` —
   confirm the first `it()` goes red on the session count.
3. Revert; run `npm test` — confirm green.
4. Re-run `npm test` once more without any DB reset — confirm the counts are still exact,
   proving the scoping holds across accumulated rows.

### Unit Tests

None. There is no pure function here to test — the behaviour under observation is a
sequence of database writes.

## Performance Considerations

Mock mode returns instantly, so the three cases add roughly five endpoint round-trips
against local Postgres — well inside the 30 s `testTimeout`. No CI cost: `OPENROUTER_API_KEY`
is not set in the workflow, so no paid LLM call is made.

## Migration Notes

None. No schema change, no production code change committed.

## References

- Research: `context/changes/ai-candidate-generation-test/research.md`
- Risk source: `context/foundation/test-plan.md` §2 Risk #2, §3 Phase 2
- The deferral this test collides with:
  `context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108` (F5)
- Why deck creation follows generation: same file, `:23-43` (F1)
- Harness this extends: `context/archive/2026-07-15-verification-harness/research.md`
- Reference test to copy: `tests/isolation/decks.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Widen the endpoint driver for JSON bodies

#### Automated

- [x] 1.1 `npm test` passes with no changes to `tests/isolation/*` — 49f1f65
- [x] 1.2 `npm run lint` passes — 49f1f65
- [x] 1.3 `npx astro sync` produces no diff — 49f1f65

#### Manual

- [x] 1.4 Widened `body` type reads as intentional; replaced comment states the JSON exception — 49f1f65

### Phase 2: Characterization test + inverted breakage check

#### Automated

- [x] 2.1 `npm test` passes with all three new cases green — 30e017f
- [x] 2.2 `npm run lint` passes — 30e017f
- [x] 2.3 `npm test` green on two consecutive runs without a DB reset — 30e017f

#### Manual

- [x] 2.4 Crude dedup makes the first `it()` fail on the session-count assertion; revert restores green — 30e017f
- [x] 2.5 Header comment makes "invert me, don't delete me" unambiguous — 30e017f

### Phase 3: Record the coverage — and its limits — in test-plan.md

#### Automated

- [x] 3.1 `npm run format` leaves `test-plan.md` clean — 7925640
- [x] 3.2 `npm test` still passes — 7925640

#### Manual

- [x] 3.3 §3 table cannot be read as "duplication on retry is prevented" — 7925640
- [x] 3.4 §6.5 is actionable cold, without reading this plan — 7925640
