# Swallowed compensation error — Implementation Plan

## Overview

`src/pages/api/generate.ts:396` discards the result of `failGenerationSession(...)`. When the
compensating UPDATE fails — which research §2 shows is the **expected** outcome on the most
likely road to `cardsError`, because both writes share one connection, one token and one proxy —
the `generation_session` row survives as `status='succeeded'`, `saved_count > 0`, keyed, with
zero cards behind it. The audit row lies, and every subsequent "Ponów" on that key replays into
a permanent 500, inverting FR-018.

This plan closes both halves through research §7's families **(a) + (c)**: the compensation
becomes a checked write that also retires the row's replayability, and the replay path stops
conflating "the query failed" with "this session is empty" — healing a poisoned row before it
can cost a paid LLM call.

## Current State Analysis

Verified against the tree at `efc6aeb`, not carried over from research:

- **The swallow.** `generate.ts:392-403` — the `cardsError` branch awaits `failGenerationSession`
  and `deleteDeck` and branches on neither. Every other `await` in the file checks `error` first,
  which is what makes these read as an outlier rather than as house style.
- **`failGenerationSession` cannot report success even if checked.** `src/lib/generations.ts:119-124`
  issues no `.select()`, so under PostgREST's default `Prefer: return=minimal` a **zero-row**
  UPDATE resolves `{ data: null, error: null }`. Under RLS a vanished row or an unreadable
  `auth.uid()` produces exactly that. `if (error)` alone is not the fix.
- **The fix shape already exists two files away.** `src/lib/decks.ts:40-41` — `deleteDeck` carries
  `.select("public_id").maybeSingle()` with a comment stating this exact rule.
- **One caller.** `failGenerationSession` is called only at `generate.ts:396`, and is a plain
  (non-`async`) function returning the builder, matching the module contract at `generations.ts:5-8`.
  Changing its signature touches one call site.
- **The conflation is at the CALL SITE, not in the lib.** `generationResultByGenerationId`
  correctly returns `{data:null, error}` for a query failure (`generations.ts:73`) and
  `{data:null, error:null}` for zero cards (`:79-80`). `replaySession` collapses them in one
  predicate — `if (error || !data)` at `generate.ts:121` — and maps both to a 500.
- **`replaySession` has two call sites** with different pasts: `:186` (top lookup, before the LLM
  call) and `:377` (the `23505` branch, **after** a paid generation).
- **The retry gate never reads the response.** `GeneratorForm.tsx` sets `canRetry` true at the top
  of `runGeneration`, _before the fetch_, and false at exactly one place — the client-side
  validation branch in `handleSubmit`. Grep over `src/` confirms `retriable` is declared at
  `GeneratorForm.tsx:89`, emitted at `generate.ts:302,329`, and **read nowhere**.
- **The escape is blocked on one path.** A fresh "Generuj" mints a new key and bypasses the
  replay lookup — unless the twin swallowed `deleteDeck` (`:400`) left an orphan deck, in which
  case `deckNameExists` (`:249-255`) answers a permanent `409`.
- **Existing coverage is zero.** No test references any of these branches; `failGenerationSession`
  has no caller in `tests/`; the archived mutation register lists the whole function as 5 NoCov.

## Desired End State

1. A failed card insert can no longer leave a replayable session. On the success path of the
   compensation the row is retired — `status='failed'`, `saved_count=0`, `error_message` set, and
   `idempotency_key` **nulled** — so it falls out of `generation_session_idempotency_key_uidx` for
   two independent reasons.
2. When the compensation provably fails (error **or** zero rows matched), the endpoint says so in
   its own copy and marks the failure retriable, because the next attempt now genuinely heals it.
3. A "Ponów" whose key resolves to a succeeded session with zero cards no longer 500s forever: the
   poisoned row is retired first, the retirement is **verified to have matched a row**, and only
   then does the request fall through to an ordinary generation.
4. If that retirement does not match a row, the request refuses **without paying for an LLM call** —
   which is what disarms the `23505` loop research §7 identified in the naive self-heal.
5. "Ponów" stops appearing where it is guaranteed pointless: `canRetry` derives from the response.

**Verification**: `npm test` green with new cases that go red when the guard is removed;
`npm run typecheck`, `npm run lint`, `npm run build` all exit 0; one recorded deliberate-breakage
run proving the endpoint can produce the poisoned row; a manual browser matrix for the island.

### Key Discoveries

- `src/lib/generations.ts:119-124` — no `.select()`; the zero-row case is invisible by construction.
- `src/lib/decks.ts:37-42` — the `.select().maybeSingle()` precedent and the comment stating why.
- `src/pages/api/generate.ts:121` — `if (error || !data)`: two facts, one branch, one 500.
- `src/pages/api/generate.ts:178-188` vs `:368-379` — the two replay entries; only the first can
  fall through, because the second sits after a paid generation.
- `supabase/migrations/20260725133600_generation_idempotency_key.sql:44-49` — the partial index
  `where idempotency_key is not null and status = 'succeeded'`. **Nulling the key on retirement
  changes which of its two predicates is load-bearing in production** (see Migration Notes).
- `tests/generation/generate.test.ts:336-387` — the seeded-`failed`-keyed-row precedent a new test
  copies verbatim, including the `allSessions` status-agnostic reader and the `mark`/`scope`
  marker discipline.
- `src/components/generate/GeneratorForm.tsx:158-160, 196-208, 336` — key minting, `canRetry`, the
  gate.

## What We're NOT Doing

- **No migration and no third `status` value.** Research §7's family (b) is rejected for this
  ticket: it trades this failure mode for a new one (cards landed, flip failed → the retry writes
  duplicates) and does not touch the §6 dead-end at all.
- **No data migration or backfill of already-poisoned cloud rows.** They are inert until someone
  replays that key, and at that moment the self-heal retires them. A cleanup UPDATE would, **by
  construction**, also strip the key from §6 rows — sessions that never failed and whose cards the
  user deleted deliberately — and the two are byte-identical from the row.
- **No attempt to distinguish a poisoned row from a user-emptied one.** Research §6 establishes
  the row shape is identical; separating them needs a new column. Both heal the same way.
- **The `:387` twin (`deleteDeck` after a failed session insert) stays with C10X-49.** Only the
  `:400` occurrence is taken here, and only because the self-heal does not work on the
  `newDeckName` path without it — see Implementation Approach.
- **No fabricating transport seam in the suite**, and no DDL/DCL inside a test. Test-plan §6.9
  confines module doubles to one file and `tests/setup/retry-transport.ts` fabricates nothing by
  written decision; reachability is proved once by a recorded manual breakage run instead.
- **`review.astro`'s misattribution is out of scope.** `decks/[publicId]/review.astro:196-201`
  renders a lying session as ordinary and blames the missing cards on generation. It is only
  reachable with the session's `public_id`, which the user never receives on this failure path —
  so for C10X-48's rows it is unreachable. It stays a live (separate) defect for §6 rows; named
  here so it is a decision, not an oversight.
- **No change to `insertCandidates`, the write ordering, or the FK direction.**

## Implementation Approach

Three layers, in dependency order.

**The decision moves out of the handler.** The replay classification is a pure function of
`(queryError, result)` — exactly the `readJsonResponse` / `rateOutcome` shape test-plan §7 records
as how this project makes island- and handler-bound decisions testable. The I/O around it (the
retirement UPDATE, the fall-through) stays in the endpoint, where it belongs.

**The compensation becomes a real write with a real result.** `.select()` is what makes a zero-row
UPDATE visible; nulling the key in the same statement is what makes the retirement independent of
the index's `status` predicate. One round-trip, two guarantees.

**Why `:400` is in scope and `:387` is not.** The replay lookup sits at `generate.ts:178-188`,
_above_ deck resolution at `:246`. So a healed retry on the `newDeckName` path falls through into
`deckNameExists` — and if the first attempt's deck undo was also swallowed, that answers a
permanent `409`. The failures are correlated (§2: same connection, same token), so in practice
both swallows happen together. Without `:400`, this ticket ships a fix that does not restore the
retry on the path it was reported from. `:387` is a different branch (the session insert failed,
no cards exist, no compensation involved) with its own test tree, and is left to C10X-49.

**Why the `23505` branch cannot fall through.** At `:377` the handler has already paid for a
generation. Retiring the poisoned winner and answering with a retriable error costs one round-trip
and lets the user's next click generate cleanly; re-driving the write path in place is family (b)
work. This asymmetry between the two call sites is deliberate and is stated at both.

## Critical Implementation Details

**Ordering inside the self-heal is the whole safety property.** Retire → confirm a row was matched
→ _only then_ fall through to generation. Inverting those two steps reproduces research §7's trap:
the fall-through inserts a session carrying the same key with `status='succeeded'`, collides with
the still-poisoned row on `generation_session_idempotency_key_uidx`, lands in the `:374-379`
handler, finds the same row, and returns the same 500 — now after a paid LLM call. The confirmation
is not defensive nicety; it is what bounds the cost of the failure.

**A retirement that matches zero rows is a refusal, never a fall-through.** Same reason.

## Phase 1: The replay decision as a pure function, and a lib contract that can be checked

### Overview

Both endpoint phases depend on this. Nothing user-visible changes; the suite gains the first
coverage `failGenerationSession`'s surroundings have ever had.

### Changes Required:

#### 1. The replay classifier

**File**: `src/lib/generation-replay.ts` (new)

**Intent**: Split the two facts `generate.ts:121` collapses, so the endpoint can act on them
differently and so the decision is testable without a database, a container or a session.

**Contract**: A pure function taking the `{ data, error }` pair `generationResultByGenerationId`
already returns and answering a discriminated union with three arms — the query failed, the
session is replayable, the session is empty. Error is classified **before** absence, matching the
error-vs-empty rule this handler cites in five comments. No Supabase types in the signature beyond
what is already exported; no I/O.

#### 2. The compensation becomes a checked, key-retiring write

**File**: `src/lib/generations.ts`

**Intent**: Give the compensating update a result its caller can act on, and make the retirement
independent of the partial index's `status` predicate rather than reliant on it.

**Contract**: The function currently named `failGenerationSession` (`:119-124`) gains
`idempotency_key: null` in the same `update({...})` payload and a
`.select("id").maybeSingle()` tail, so the caller can distinguish an error, a zero-row no-op, and
a landed retirement. Rename it to `retireGenerationSession` — the name is now the whole point, and
a name that describes half of what a function does is the defect class this repo keeps recording.
Its docblock (`:115-118`) currently justifies the swallow ("_closes the audit gap best-effort_")
and must state the new contract instead, including why `.select()` is load-bearing (cite
`decks.ts:40-41`).

#### 3. The three comments that cite the old behaviour by name

**File**: `src/pages/api/generate.ts` (`:289-299`), `tests/generation/generate.test.ts` (`:38-41`)

**Intent**: Both passages assert that the compensation **leaves the key in place**, and use that to
explain why the index predicate is load-bearing. After this change that is false on the success
path and true only when the retirement itself failed.

**Contract**: Correct both at the site, dated, and keep the conclusion they support — the predicate
must still not be removed, and the seeded-`failed`-keyed-row test remains its guard. The applied
migration `20260725133600:27-36` carries the same now-stale claim and is **deliberately not
edited** (amending a pushed migration is a drift class this project records as invisible to its own
gate); the correction lives in `generations.ts` with a pointer, and Migration Notes below names the
stale header.

#### 4. Unit tests for the classifier

**File**: `tests/lib/generation-replay.test.ts` (new)

**Intent**: Pin all three arms plus the ordering (a query error with `data === null` classifies as
a failure, never as empty).

**Contract**: Every input fabricated — no database. Include the positive control the rest of the
file would otherwise be satisfied by: a genuinely replayable result classifies as replayable.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- New classifier unit tests pass: `npx vitest run tests/lib/generation-replay.test.ts`
- Full suite still green: `npm test`
- Grep confirms `failGenerationSession` has no remaining references in `src/` or `tests/`

#### Manual Verification:

- The renamed function's docblock states the zero-row rule and cites `decks.ts:40-41`
- The two corrected comments keep their conclusion (do not remove the index predicate) and are dated

---

## Phase 2: The compensation path stops swallowing

### Overview

`generate.ts:392-403` learns to read both of its writes. Nothing heals yet — this phase makes the
failure **nameable**, which is the precondition for the response ever being testable.

### Changes Required:

#### 1. The `cardsError` branch

**File**: `src/pages/api/generate.ts`

**Intent**: Branch on the retirement's result (error, zero rows, or landed) and on the deck undo's
result, and answer differently when either provably failed — so the copy stops promising a retry
that today is guaranteed to fail.

**Contract**: On a landed retirement and a landed (or unnecessary) deck undo, the existing 500 and
its existing copy are unchanged. On a provable failure of either, a **distinct** Polish message
naming the state plus `retriable: true`. The new string stays an inline literal in this handler,
alongside its siblings — it must **not** join `REDIRECT_MESSAGES`, whose members are values the
deck pages render out of a URL and whose size is pinned.

Note the composition: `deleteDeck` already returns `.select("public_id").maybeSingle()`, so the
zero-row case is readable there today without any lib change. `createdDeckPublicId` is null on the
existing-deck path, where the undo is correctly not attempted at all.

#### 2. The comment that called it best-effort

**File**: `src/pages/api/generate.ts` (`:393-401`)

**Intent**: "_best-effort_" entered this codebase as a comment and was never a decision (research,
Architecture Insights). Replace it with what the branch now guarantees and what it still cannot.

**Contract**: State plainly that the response is now the only witness of a failed compensation,
and that the row remains poisoned until the next attempt heals it (Phase 3) — so a reader does not
conclude this branch repairs anything.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Full suite still green: `npm test` — no existing case asserts on this branch's copy
- Build passes: `npm run build`

#### Manual Verification:

- Re-read the branch: every `await` in `generate.ts` now branches on its result, with no exceptions
  left in the file except the two owned by C10X-49 (`:387`) and C10X-50 (`:277`, `:314`)

---

## Phase 3: The self-healing replay

### Overview

The user-visible fix. A key resolving to a succeeded-but-empty session stops being a permanent 500.

### Changes Required:

#### 1. `replaySession` splits into a classification and two outcomes

**File**: `src/pages/api/generate.ts` (`:116-134`)

**Intent**: Replace `if (error || !data)` with the Phase 1 classifier, so the caller — not this
helper — decides what an empty session means. The two call sites want different things from it.

**Contract**: The helper returns a value the caller discriminates rather than always a `Response`;
the replayable arm keeps today's 200 body byte-for-byte (counters still come from the session's
own columns, never from the cards read back). The query-failure arm keeps today's 500 and its copy.

#### 2. The top lookup heals and falls through

**File**: `src/pages/api/generate.ts` (`:178-188`)

**Intent**: On an empty session, retire the poisoned row, confirm the retirement matched a row, and
continue into the ordinary generation path — one click, no dead end.

**Contract**: Ordering is the contract (see Critical Implementation Details): retire → confirm →
fall through. A retirement that errors or matches zero rows returns a 500 with `retriable: true`
and **must not** reach `generateCandidates`. Structurally this means `:186` can no longer be a bare
`return replaySession(...)`; the branch resolves an outcome and only the replay and refusal arms
return.

#### 3. The `23505` branch retires and refuses

**File**: `src/pages/api/generate.ts` (`:374-379`)

**Intent**: The same poisoned winner is reachable here, but this code has already paid for a
generation, so falling through would buy a second one.

**Contract**: On the empty arm, retire the winner and return a retriable 500; the next attempt finds
no key and generates cleanly. Comment the asymmetry with `:186` at the site so it does not read as
an inconsistency. The existing `if (!error && won)` swallow of this lookup's own error (research §1)
is tightened in the same edit: a query failure here is reported, not folded into the generic 500.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Full suite still green, including the three existing idempotency controls (two different keys →
  two sessions; no key → two sessions; a `failed`-only key still generates): `npm test`
- The existing replay-after-language-deactivation case still passes — the language lookup must stay
  below the replay branch

#### Manual Verification:

- Trace the healed path by hand: a fall-through carries the same key into `createGenerationSession`
  at `:366`, and the retired row is provably out of the partial index before it does

---

## Phase 4: The island reads `retriable`

### Overview

The endpoint has distinguished retriable from non-retriable failures since it was written, and the
UI has never read it. This phase makes the flag mean something — and this change is what gives the
distinction its first real payoff, since a healed retry is now genuinely worth offering.

### Changes Required:

#### 1. `canRetry` derives from the response

**File**: `src/components/generate/GeneratorForm.tsx` (`:158-190`)

**Intent**: Stop asserting retriability before the request is even issued.

**Contract**: On a non-ok response, `canRetry` follows the parsed body's `retriable` flag; the
`catch` arm (abort/network) stays retriable by nature, since no body exists there and the class is
retriable by definition. The client-side validation branch keeps setting it false. The type at
`:89` is unchanged — it already declares the field.

#### 2. The stale-gate artifact, narrowly

**File**: `src/components/generate/GeneratorForm.tsx` (`:222`, `:285`, `:304`)

**Intent**: Typing in the textarea clears `error` but not `status`, so the banner disappears while
"Ponów" keeps rendering — and clicking it re-sends the _old_ payload, silently discarding what the
user just typed. This is a retry-state defect inside the exact state machine this phase edits.

**Contract**: Clear the error status **only** when it is `"error"`. Guard it: clearing
unconditionally would hide a completed result list (`status === "done"` renders the candidates) and
`"pending"` is unreachable here because the inputs are disabled.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Full suite still green: `npm test` (no test reaches an island — test-plan §7)
- Build passes: `npm run build`

#### Manual Verification:

- A 502/422 (retriable) still shows "Ponów"; a plain non-retriable 500 does not
- A client-side validation error still hides "Ponów"
- A client timeout / offline still shows "Ponów"
- Typing after an error hides the banner **and** "Ponów" together
- A successful generation still renders its candidate list, and typing does not clear it

---

## Phase 5: Proof, the breakage run, and the docs

### Overview

The consequence half is provable in the committed suite today. The reachability half is not, by a
written decision — so it is proved once, by hand, and recorded.

### Changes Required:

#### 1. Integration tests for the healed replay

**File**: `tests/generation/generate.test.ts`

**Intent**: Pin that a key whose only session is succeeded-with-zero-cards now generates instead of
500ing, and that the poisoned row is retired rather than left behind.

**Contract**: Copy the seeding pattern at `:336-387` verbatim — an RLS-scoped direct insert, the
`mark`/`scope` marker discipline, and `allSessions` (status-agnostic) rather than
`succeededSessions`, which filters `status='succeeded'` and is blind to the correct-behaviour case.
Two cases:

- **The poisoned row** (`saved_count > 0`, no cards ever inserted) → `POST` with that key → 200,
  a fresh session exists, cards exist, and the seeded row reads retired (`status='failed'`,
  `idempotency_key` null).
- **The §6 row** (the user's own cards deleted after a real generation) → same outcome. This case
  needs no seeding trickery at all: generate normally, delete the cards, replay the key.

Oracle constraints, all from test-plan's own recorded traps: count cards by `generation_id`, never
by deck and never by `front` (mock output repeats fronts; `countFlashcards`/`listFlashcards` filter
`state_id = STATE_ACCEPTED` and read 0 whatever happens); never `.single()`/`.maybeSingle()` as a
count; scope every session read by the case marker with `.like(...)`.

#### 2. The deliberate-breakage runs

**File**: `context/changes/bug-generation-compensation-swallowed/verification.md` (new)

**Intent**: Prove each new guard can go red, and prove **once** that the endpoint really can
produce the poisoned row — the half no committed test covers.

**Contract**: Four runs, each with its observed failure string, its red/green split **with the
denominator**, and a verified restore (hash for source edits, `pg_policies` / grant dump
before-and-after for the DCL run):

- Remove the confirmation between retirement and fall-through → the `23505` loop research §7
  predicted should appear; record what actually happens rather than what was predicted.
- Point the classifier's empty arm back at the query-failure arm → the healed-replay cases go red.
- Neuter the retirement's `idempotency_key: null` → the retired-row assertion goes red while the
  generation assertion stays green.
- **Reachability (manual, uncommitted, one run):** revoke `UPDATE` on `generation_session` from
  `authenticated` against the local stack, drive one real generation whose card insert is made to
  fail, observe the poisoned row directly, then restore the grant and verify it. Run this with the
  suite **not** running — shuffle is on and files run in parallel, which is why this is not a test.

#### 3. The rule

**File**: `context/foundation/lessons.md`

**Intent**: The class — a compensating write whose result is discarded — has no rule, and the
nearest one (error-vs-empty) covers **reads** only. It propagated by symmetry across two sites and
five tickets precisely because it was a comment rather than a decision.

**Contract**: One entry: a compensating write's result is checked like any other, and under RLS
zero rows is **not** an error — so without an explicit `.select()` there is nothing to check.
Written via `/10x-lesson` so it lands in the file's own format.

#### 4. Doc-sync

**File**: `context/foundation/test-plan.md`, `context/changes/bug-generation-compensation-swallowed/change.md`

**Intent**: Record what moved and, at equal length, what did not.

**Contract**: `test-plan.md` §6.6's Phase-2 (S-05 / Risk #2) entry gains a dated note: the replay
dead-end is now covered on the consequence half, the reachability half is carried by one recorded
manual run and **not** by the suite, and no §2 risk row moves. `change.md` records the scope
decision to take `generate.ts:400` under this key rather than C10X-49's — the "fix landed under a
foreign key" confusion this repo has already recorded twice — and the four other decisions from
planning.

### Success Criteria:

#### Automated Verification:

- Full suite green: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- `git diff -- src/ supabase/` is empty after every breakage restore

#### Manual Verification:

- Each of the four breakage runs recorded with its observed failure string and denominator
- The DCL grant restored and verified by an independent dump, not by memory
- `lessons.md` entry present and scoped to writes
- `test-plan.md` note states the reachability boundary explicitly

---

## Testing Strategy

### Unit Tests

- The replay classifier: three arms, error-before-absence ordering, plus a replayable positive
  control so the failure arms cannot be satisfied by a function that classifies everything as broken.

### Integration Tests

- Poisoned row → keyed POST → 200 + fresh session + cards + the seeded row retired.
- §6 row (cards deleted by the user) → keyed POST → same outcome, no seeding shortcut.
- The three existing idempotency controls must stay green — they are what keep "one session" from
  being satisfied by an endpoint that silently refuses every second request.

### Manual Testing Steps

1. Sign in, generate into an existing deck — the happy path is unchanged, 200 with candidates.
2. Force a non-retriable 500 and confirm "Ponów" is **not** offered.
3. Force a 502/422 and confirm "Ponów" is offered.
4. Type into the textarea after an error — banner and "Ponów" disappear together.
5. Generate successfully, then type — the candidate list survives.
6. The reachability run (Phase 5 §2, fourth bullet) — driven in the browser or through the endpoint,
   with the row inspected in Studio.

## Performance Considerations

The self-heal adds at most one UPDATE round-trip, and only on a path that today ends in a 500. The
retirement's `.select("id")` changes `Prefer` on an UPDATE that already ran. Nothing on the happy
path gains a query.

## Migration Notes

**No migration ships with this change**, and no production data is written.

One consequence must be recorded rather than discovered later. The partial index
`generation_session_idempotency_key_uidx` has two predicates — `idempotency_key is not null` and
`status = 'succeeded'` — and its header (`20260725133600:27-36`) argues the second is load-bearing
**because** `failGenerationSession` leaves the key in place, making a keyed `failed` row reachable
in normal operation. After this change a successful retirement nulls the key and flips the status
together, so that production route to a keyed `failed` row closes: the two guards become genuinely
independent, which is exactly what impl-review F3 deferred in July.

Three things follow, and all three belong in the code rather than in memory:

- **Do not remove the predicate.** A retirement that _fails_ still leaves a keyed `succeeded` row,
  and the index is what keeps a second succeeded row for that key from ever existing.
- The existing test "still generates when the only prior session for that key is `failed`" seeds its
  row directly and is therefore **unaffected** — it remains the guard against the predicate being
  dropped, and its comment needs the dated correction from Phase 1 §3.
- The applied migration's header is now stale and is deliberately left unedited; the correction and
  a pointer live in `src/lib/generations.ts`.

## References

- Change: `context/changes/bug-generation-compensation-swallowed/change.md`
- Research: `context/changes/bug-generation-compensation-swallowed/research.md`
- The `.select()`-on-write precedent: `src/lib/decks.ts:37-42`
- The seeding precedent for a hand-built session row: `tests/generation/generate.test.ts:336-387`
- The pure-extraction precedent: `src/lib/http.ts` (`readJsonResponse`), `src/lib/study-session.ts`
  (`rateOutcome`), and test-plan §7's note on why they exist
- Prior art on the deferred key decision: `context/archive/2026-07-25-candidate-review/reviews/impl-review.md:132-175`
- The only prior statement of this bug's primary effect: `context/archive/2026-07-18-ai-candidate-generation-test/research.md:92-103`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The replay decision as a pure function, and a lib contract that can be checked

#### Automated

- [ ] 1.1 Type checking passes: `npm run typecheck`
- [ ] 1.2 Linting passes: `npm run lint`
- [ ] 1.3 New classifier unit tests pass: `npx vitest run tests/lib/generation-replay.test.ts`
- [ ] 1.4 Full suite still green: `npm test`
- [ ] 1.5 Grep confirms `failGenerationSession` has no remaining references in `src/` or `tests/`

#### Manual

- [ ] 1.6 The renamed function's docblock states the zero-row rule and cites `decks.ts:40-41`
- [ ] 1.7 The two corrected comments keep their conclusion (do not remove the index predicate) and are dated

### Phase 2: The compensation path stops swallowing

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Full suite still green: `npm test`
- [ ] 2.4 Build passes: `npm run build`

#### Manual

- [ ] 2.5 Every `await` in `generate.ts` branches on its result, except the two owned by C10X-49 and C10X-50

### Phase 3: The self-healing replay

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Full suite still green, including the three existing idempotency controls: `npm test`
- [ ] 3.4 The existing replay-after-language-deactivation case still passes

#### Manual

- [ ] 3.5 Traced by hand: the retired row is provably out of the partial index before the fall-through inserts its session

### Phase 4: The island reads `retriable`

#### Automated

- [ ] 4.1 Type checking passes: `npm run typecheck`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 Full suite still green: `npm test`
- [ ] 4.4 Build passes: `npm run build`

#### Manual

- [ ] 4.5 A 502/422 still shows "Ponów"; a plain non-retriable 500 does not
- [ ] 4.6 A client-side validation error still hides "Ponów"
- [ ] 4.7 A client timeout / offline still shows "Ponów"
- [ ] 4.8 Typing after an error hides the banner and "Ponów" together
- [ ] 4.9 A successful generation still renders its candidate list, and typing does not clear it

### Phase 5: Proof, the breakage run, and the docs

#### Automated

- [ ] 5.1 Full suite green: `npm test`
- [ ] 5.2 Type checking passes: `npm run typecheck`
- [ ] 5.3 Linting passes: `npm run lint`
- [ ] 5.4 Build passes: `npm run build`
- [ ] 5.5 `git diff -- src/ supabase/` is empty after every breakage restore

#### Manual

- [ ] 5.6 Each of the four breakage runs recorded with its observed failure string and denominator
- [ ] 5.7 The DCL grant restored and verified by an independent dump, not by memory
- [ ] 5.8 `lessons.md` entry present and scoped to writes
- [ ] 5.9 `test-plan.md` note states the reachability boundary explicitly
