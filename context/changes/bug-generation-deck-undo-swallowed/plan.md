# Checked deck undo after a failed generation-session insert — Implementation Plan

## Overview

`src/pages/api/generate.ts:596-598` discards the result of `deleteDeck` — the compensating
undo of a deck THIS request created, run after the `generation_session` insert failed. When
that undo fails, the deck survives as an empty orphan and nothing anywhere says so. The next
"Ponów" replays the same payload, meets the orphan at `deckNameExists`, and answers
`409 "Talia o tej nazwie już istnieje"` with `retriable: false` — so the affordance is
withdrawn on the second click and the copy blames the user's choice of name.

This change reads that result, branches on `data` rather than `error` alone, and answers with
a distinct message that names the leftover deck and points at the one recovery route that
actually exists. It repairs nothing: the orphan survives a failed undo however loudly it is
reported. Detection is the deliverable.

## Current State Analysis

The call site, verbatim (`src/pages/api/generate.ts:596-598`):

```ts
if (createdDeckPublicId) {
  await deleteDeck(supabase, createdDeckPublicId);
}
return json(500, sessionFailure);
```

The helper already carries the contract that makes the result readable —
`src/lib/decks.ts:40-42` ends `.select("public_id").maybeSingle()`, and its header at `:37-39`
states why. **No lib change is needed.** The whole defect is the discarded pair at one call
site, and the sibling one branch down (`:628-632`) already does it right.

Three things about the surrounding code constrain the fix:

- **`createdDeckPublicId` is written at exactly one site** (`:518`), inside
  `if (newDeckName && deckId === null)`. The adoption path deliberately leaves it null
  (`:395-397`), so on an adopted deck the undo does not run at all — correctly, because that
  deck predates the request.
- **`sessionFailure` on the paths where the undo runs is essentially always the `:554`
  default** — the one variant carrying no `retriable` field. For the `23505` sub-branch to
  coincide with a non-null `createdDeckPublicId`, an earlier request with the same key (hence
  the same `newDeckName`) must already have committed; `deck_user_name_unique` stops any such
  request at `:362` or `:512-513`, in both cases with `createdDeckPublicId` still null.
- **`healedKey` cannot rescue the retry here, categorically.** It is set only when the top
  lookup returned a row, and the only row that could carry this per-attempt key is the session
  this attempt failed to insert. This is not a discovery — `:344-355` (D-10) names the
  session-insert 500 among the failures that forfeit the heal while the orphan survives.

### Key Discoveries:

- `src/lib/decks.ts:40-42` — `deleteDeck` already returns `{data, error}` with a real
  `.select(...)`. Layer two of the `lessons.md:243-248` rule is done; only layer one is missing.
- `src/pages/api/generate.ts:628-652` — the sibling's shape: `let deckUndone = true`, the
  combined gate, and an inline literal deliberately kept out of `REDIRECT_MESSAGES`.
- **The realistic failing arm here is `error`, not zero-rows** — the inverse of the sibling.
  The deck was created by this same client one round-trip earlier, so a zero-row DELETE needs
  the row to have vanished in between. Both arms must still be checked
  (`!deleteError && deleted !== null`), but do not inherit C10X-48's emphasis about which arm
  is the interesting one.
- **The failure is correlated with its cause.** The failing INSERT and the compensating DELETE
  are two round-trips over the same `fetch`, the same Kong→PostgREST path and the same JWT from
  one `createClient` call at `:182`. Transport, DB-operational and expired-JWT causes all take
  both down. The swallow is silent exactly when it matters.
- **The branch is unreachable from any test**, established three ways in `research.md` §8:
  the `failure-path.test.ts` seam never doubles the database (`:35-36`), and seeding cannot
  provoke a `23505` at `:531` because `findSucceededSessionByIdempotencyKey`'s filter set is
  _identical_ to the partial index predicate — any row that could collide is one the top lookup
  already found and then replayed or healed.
- **`deleteDeck` has no caller anywhere in `tests/`.** `tests/isolation/decks.test.ts:86-100`
  drives the DELETE _endpoint_ cross-account; nothing asserts the helper's own
  zero-row-vs-landed return value.
- `tests/generation/generate.test.ts:871` — the ordinary-409 guard a careless fix would break.
- `src/components/generate/GeneratorForm.tsx:192` — `"retriable" in data ? data.retriable !== false : true`.
  Absent means retriable (D-08); `:224` replays `lastPayload` verbatim.
- **`context/foundation/lessons.md:243-248` already carries this rule and names this exact
  site** ("`deleteDeck` po nieudanym wstawieniu sesji"). No new lesson is warranted.

## Desired End State

When the deck undo fails after a failed session insert, `/api/generate` answers `500` with a
message that (a) says the generation session could not be saved, (b) says an empty deck of that
name **may** have been left behind, and (c) names the two ways out — pick it from the deck list, or
change the name — carrying **`retriable: false`**. When the undo succeeds, the response is
unchanged from today.

**Why `false` on a 500, which is this handler's first** (plan-review F1). "Ponów" replays
`lastPayload` VERBATIM (`GeneratorForm.tsx:224`) — same key, same `newDeckName`. On the arm that
actually fires the orphan deck now exists, so that replay finds no keyed session, leaves
`healedKey` false, meets the orphan at `deckNameExists` and returns `409 retriable: false`
(`:362-363`) — deterministically, every time. Offering the button would reproduce this ticket's own
defect one click later. The flag's documented meaning is exactly this test: it "marks the ones a
repeat provably cannot fix" (`GeneratorForm.tsx:184-186`), which is why `:513`'s name-taken 409
already carries `false` for the identical reason. D-08 forbids a FORGOTTEN flag silently disarming
an affordance; it does not argue for `true` where `false` is the measured truth.

**The copy is therefore load-bearing, not decorative.** With `retriable: false` the banner offers no
button at all, so the message is the user's only route out — which is precisely why it names both
of them. A future edit that shortens the copy must move the flag back in the same commit.

**The residual, stated rather than left to be discovered** (plan-review F2). One flag covers both
failing arms, and on the near-unreachable zero-row arm the deck is already gone, so a verbatim
repeat WOULD have worked and `false` costs that user a click they must make by hand. Accepted
deliberately: splitting the arms means two literals and two flags for a state whose only realistic
cause (an account cascade, research §6) has also just destroyed the session the retry would write.
The copy is hedged to stay true on both arms; the flag is not, and this paragraph is why.

Verified by: one recorded manual DCL run showing the new body on the wire and the orphan deck in
the database, with a control run proving the ordinary message still answers when only the
session insert fails; a committed cross-account test pinning `deleteDeck`'s zero-row contract;
and a browser check confirming the recovery route the copy promises is real.

## What We're NOT Doing

- **Not removing the orphan deck.** The correction to C10X-48's D-01 is the sentence this
  change internalises: _hardening gives detection, not deletion._ A plan promising the orphan
  goes away would be overclaiming.
- **Not widening deck adoption.** Gating adoption on emptiness rather than on `healedKey` would
  generate into a deliberately-empty deck and turns `generate.test.ts:871` red. C10X-48 weighed
  that trade (D-06) and declined it.
- **Not retrying the delete.** The failure is correlated with its cause (research §7), so a
  second attempt buys latency rather than evidence.
- **Not changing `src/lib/decks.ts`.** The `.select(...)` contract is already there.
- **Not touching the `:566` early return's CODE.** Only the comment that misdescribes it.
- **Not touching the two failure-path `createGenerationSession` inserts** (`:426`, `:477`) —
  those are C10X-50's.
- **No new `lessons.md` entry** — `:243-248` already states the rule and names this site.
- **No migration.** Nothing under `supabase/` changes, so the C10X-29 drift gate is not involved.
- **No `jira-map.md` edit** — that file is owned by the Jira skills.

## Implementation Approach

Mirror the sibling branch's shape (`:628-652`) rather than inventing one: compute `deckUndone`
with a `true` default so "the undo never ran" is not "the undo failed", then gate on it before
the existing `return json(500, sessionFailure)`. The failed-undo message REPLACES
`sessionFailure` wholesale, as the sibling replaces its own — which costs nothing, because the
`sessionFailure` variants that carry extra information are unreachable in combination with a
non-null `createdDeckPublicId`.

Evidence is deliberately split, and the split is the honest part: the suite owns the HELPER's
contract, and the ENDPOINT's use of it is owned by one recorded manual run. Nothing bridges the
two, and no test in this project can.

## Critical Implementation Details

**The response is the only witness.** Nothing under `src/` writes a log line
(`tests/lib/no-logging.test.ts`), and this project reads no log sink (test-plan §7). So the copy
is not cosmetics — it is the entire observability surface for this failure, which is why the
message design was the real decision of this change rather than a finishing touch.

**Two doc-sync targets look live and are not.** `test-plan.md:1731` and `:5234` both name
C10X-49 as owner of this site, and both sit INSIDE dated C10X-48 entries — the §6.6 "Extended
2026-08-13" blockquote and the §8 ledger entry's "Still open after this entry" bullet. Per
`lessons.md:235-241` those take **dated corrections**, never in-place rewrites; the live
statement belongs in this change's own new §6.6 and §8 entries. Reading the line rather than its
section heading is precisely the trap that rule was written from.

## Phase 1: Checked undo, its copy, and the roadmap row

### Overview

The code change and the two comment corrections it makes necessary, plus the roadmap row —
opened first rather than last, so abandoning the change halfway cannot make it vanish from the
roadmap.

### Changes Required:

#### 1. The checked undo and its response

**File**: `src/pages/api/generate.ts` (the `if (sessionError)` block, `:596-599`)

**Intent**: Read `deleteDeck`'s result instead of discarding it, and answer differently when the
undo failed. Follow `:628-632` exactly — the shape is already in this file one branch down, and
a second shape for the same decision is how the two drift.

**Contract**: A `deckUndone` boolean defaulting to `true` (an undo that never ran has not
failed — `createdDeckPublicId` is null on the existing-deck and adopted paths), set to
`!deleteError && deleted !== null` when the undo does run. When it is false the handler returns
`500` with the new literal and **`retriable: false`** (Desired End State carries the argument);
otherwise it returns `500, sessionFailure` exactly as today — where the absent flag still means
retriable, so the successful-undo path is untouched in both body and affordance.
Both `data` and `error` are read, per `lessons.md:243-248`: under RLS a
zero-row DELETE resolves `{data: null, error: null}`, so `if (error)` alone would still swallow
one of the two arms.

#### 2. The failed-undo message

**File**: `src/pages/api/generate.ts` (inline literal at the new return)

**Intent**: Name the leftover deck and the way out. This is the option research §5 argues for:
the user's real pain is the NEXT click, and a message that mentions only the session tells them
nothing about the empty deck that is about to block them.

**Contract**: A single inline string literal, alongside its siblings in this handler and
**deliberately not a member of `REDIRECT_MESSAGES`** — that set's members are values the deck
pages render out of a URL, and its size is pinned at `tests/lib/redirect-errors.test.ts:92-95`.
Share a constant, never the membership. Wording decided here rather than left open:

> `"Nie udało się zapisać sesji generacji, a pusta talia o tej nazwie mogła zostać utworzona. Jeśli tak, odśwież stronę i wybierz ją z listy talii albo zmień nazwę i spróbuj ponownie."`

**`odśwież stronę` is not padding — without it the sentence names a route that is not on screen**
(plan-review F4). `generate.astro:21-28` reads `listDecks` in the frontmatter and hands `decks` to
the island as a PROP; `GeneratorForm` consumes it at `:117` / `:262` and never refetches. The
orphan is created DURING the failing request, i.e. after the page rendered, so it is absent from
the selector the user is looking at and only a reload puts it there. With `retriable: false` the
banner also carries no button, so this sentence is the entire recovery path: an unreachable
instruction here leaves the user with nothing at all. The second route (`zmień nazwę`) needs no
reload and works immediately, which is why the two are offered in that order.

**The hedge is load-bearing, not softness** (plan-review F2). `deckUndone` is false on TWO arms and
they contradict each other in the database: on the `error` arm the deck is there, on the zero-row
arm the DELETE matched nothing, i.e. the deck is already gone (research §6 — the one realistic
route is an account cascade). One literal covers both, so an unhedged "została utworzona" would
state a false fact on the second. `mogła` / `jeśli tak` is the whole cost of not splitting the
branch, and it is paid in a sentence rather than in a second code path. Do not "tighten" it back —
tightening it means splitting the arms, which means splitting `retriable` too.

Static, with **no interpolation of `newDeckName`** — the user still has the name in the form
field, and echoing submitted input into an error body buys nothing here while adding a class
this project guards against elsewhere.

#### 3. The C10X-49 handoff comment

**File**: `src/pages/api/generate.ts:588-595`

**Intent**: This comment exists to hand the site to the ticket that is now shipping, and to warn
the next reader not to "restore the symmetry" by re-swallowing the sibling. Rewrite it, do not
delete it: the warning survives its handoff, and what replaces the handoff is the boundary — the
undo is now checked, the response is the only witness, and the orphan deck still survives a
failed undo.

**Contract**: The paragraph keeps its "do not read the inversion backwards" warning and its
closing sentence naming the two remaining exceptions as C10X-50's. It loses the "Still
best-effort" framing and the C10X-49 ownership claim.

#### 4. The false claim about the `:566` early return

**File**: `src/pages/api/generate.ts:552-553`

**Intent**: The comment says the block is "built up rather than returned early, so the deck undo
below still runs on every one of these paths." That is accurate for the three `sessionFailure`
assignments and **false** for the `return outcome.response` at `:566`, which bypasses the undo
for both of `replaySession`'s answered outcomes. Under the reachability argument the combination
is ~unreachable, so this is a correctness-of-the-comment problem — but a change whose whole
subject is this undo must not leave a false claim about this undo standing in the same block.

**Contract**: The sentence gains a qualification naming the one path that returns early, and
states why it is left as code: on the 200-replay arm the deck being deleted is the deck the
response is handing back. Found by this change's research; recorded in no prior document.

#### 5. The roadmap row

**File**: `context/foundation/roadmap.md`

**Intent**: Open **H-17** with `Status: in progress` now, not during doc-sync. Without a row,
`/10x-archive` has nothing to close and the change disappears from the roadmap — a mechanism
this project has hit four times (H-04, H-07, H-08, H-13) and pre-empted twice (H-15, H-16).
Opening it in the first phase rather than the last is the cheapest possible insurance.

**Contract**: A row in the At-a-glance table after H-16, plus a detail block in the same shape
as H-16's (`Outcome` / `Change ID` / `PRD refs` / `Prerequisites` / `Parallel with` / `Blockers`
/ `Unknowns` / `Risk` / `Status`). PRD anchor: FR-018 and US-01. `Parallel with:` C10X-50.
H-16's own `Parallel with:` line naming C10X-49 is a **dated entry** (`Status: done`) and is
deliberately left untouched — it was true when written.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` exits 0
- `npm run lint` exits 0, with the 3 pre-existing `no-console` warnings in `evals/` unchanged
- `npm run build` exits 0
- `npm test` green, with `tests/generation/generate.test.ts:871` ("409s a newDeckName that is
  already taken") still passing — the guard a loosened adoption gate would break
- `git diff -- supabase/` empty: this change ships no migration

#### Manual Verification:

- Reading `:552-599` end to end, no comment now claims something the code does not do
- The new literal does not appear in `src/lib/redirect-errors.ts` and the set's size assertion
  is untouched

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 2: The helper's contract, in the suite

### Overview

The one genuinely new automated coverage available: `deleteDeck` is called by no test anywhere,
so its zero-row-vs-landed distinction — the thing the whole fix reads — is asserted nowhere.

### Changes Required:

#### 1. Cross-account zero-row test on `deleteDeck`

**File**: `tests/isolation/decks.test.ts`

**Intent**: Prove that a DELETE matching zero rows is visible to the caller as
`{data: null, error: null}` and that a landed one is not — the exact distinction
`deckUndone` branches on. Account B's client against account A's deck produces a zero-row DELETE
with no transport seam, no DDL and no fabrication (D-04).

**Contract**: Placed in `decks.test.ts` rather than in `generate.test.ts` on §6.2's
one-file-per-resource rule: the claim is about a deck helper, the account A/B fixtures and
`clientFor` are already imported there, and it sits directly beside the endpoint-level twin at
`:86-100` that it complements. Three assertions on the denial (`error` null, `data` null, and
A's row re-read as A — row-based, never return-value-based, because a null `data` with A's deck
actually gone would be a pass on the return and a leak in the database), then the positive
control, without which a helper returning `null` for every caller would satisfy the denial and
read as perfect reporting. The control **owns the deck it deletes**, created inside its own
`it()` — §6.2's rule, and the precedent is `:106` in the same file.

### Success Criteria:

#### Automated Verification:

- The new case passes; whole suite green on a fresh un-pinned shuffle seed
- Suite total re-measured by RUNNING the file, never by arithmetic — this ledger has been
  caught on a total-vs-breakdown mismatch three times
- Breakage run: drop `.maybeSingle()` from `deleteDeck` so a zero-row DELETE resolves to `[]`
  instead of `null`; record the observed failure string and the red/green split with its
  denominator. **Predict TWO reds in this file, not one** (plan-review F6), and name the second
  before running so a two-red result is not read as a mystery:
  - the new helper denial, on `expected [] to be null`;
  - the EXISTING endpoint-level denial at `:86-100`, because `[]` is truthy, so
    `src/pages/api/decks/[publicId]/delete.ts:37`'s `if (!deleted)` stops firing and the endpoint
    answers `302` where the case expects `404`.
    Both positive controls must stay GREEN — `[{public_id}]` is not null and is truthy, so the
    landed path is unaffected on either layer. That green pair is the attribution: this neuter
    removes the ZERO-ROW signal specifically, rather than breaking deletes outright. Note the
    narrower alternative and why it was not taken: dropping `.select("public_id")` nulls `data` for
    both callers, which inverts the split (denial green, positive control red) and is a cleaner
    single-red run — but it tests the `.select()` half of `lessons.md:243-248` rather than the
    `.maybeSingle()` half the endpoint's `deleted !== null` actually depends on
- Restore verified by `md5sum` against a pristine copy, and `git diff -- src/` empty

#### Manual Verification:

- The endpoint fix itself has **no automated witness** and the phase says so rather than
  implying otherwise — the branch is unreachable from the suite (§8), and Phase 3 is its only
  evidence

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Reachability — one recorded DCL run, and the promise the copy makes

### Overview

The only way to show this branch executes and returns the new body, in C10X-48's shape. The
browser check rides on the same state because there is no other way to reach this banner in the
UI — and because the new copy makes a claim about the UI that has to be true.

### Changes Required:

#### 1. The provocation

**File**: none — a recorded procedure, run against the local stack

**Intent**: Fail the session insert and the deck undo on one request. Two revokes, because
either alone reproduces nothing:

```sql
revoke insert on public.generation_session from authenticated;
revoke delete on public.deck from authenticated;
```

**Contract**: One real generation through the running app with a `newDeckName` — call it **X** —
and a key. Expected: `500`, body carrying the new literal and `retriable: false`; in the database,
deck X exists and no session row does. Record the response body verbatim and the row read directly
in psql, not a summary of them.

#### 2. Browser verification

**File**: none — recorded in `verification.md`

**Intent**: The island half is untestable by construction (§7), and this change's copy is
rendered by `ServerError`. Two things to see, and the second is the one that matters: the new
message in the banner **with "Ponów" ABSENT** (the `retriable: false` decision reaching the UI —
`GeneratorForm.tsx:192` reads `data.retriable !== false`, so a flag that fails to arrive leaves
the button rendering and this observation is what catches it), and the orphan deck **present and
selectable in the generate page's deck selector after doing what the copy says** — which is the
recovery route the copy promises, so if it is not there the copy is a lie. With no button on the
banner the copy is the user's ONLY route out, which is what makes the second observation
load-bearing rather than a nicety.

**Execute the sentence literally, in its own order** (plan-review F4): read the banner, then
reload, then open the selector. Reloading first — the reflex, and what a hurried check does — makes
the observation vacuous, because the prop is re-read on every render and the deck would be there
whatever the copy said. The pre-reload absence is the mechanism the word `odśwież` exists for and
is worth one line in `verification.md`, but the claim under test is the post-reload presence.

**Contract**: Run on step 1's state, **before either re-grant** — which is why it is step 2 and not
step 4 (plan-review F3). Once `delete on public.deck` comes back the state this observation needs
no longer exists, and re-provoking it costs a second revoke cycle. `ServerError` renders
`items-center` with no `break-words`, so record how the long literal wraps rather than assuming
it is fine.

#### 3. The control run

**File**: none — one re-grant, and a **different deck name**

**Intent**: The half a single run cannot give. With `delete on public.deck` re-granted and only
`revoke insert on public.generation_session` still in place, the same shape of request must answer
the ORDINARY `sessionFailure` message and leave **no** orphan deck. Without it, a message that
fires on every failure is indistinguishable from one that fires on the right one — the C10X-29
unfalsifiable-rehearsal class.

**Contract**: Two runs differing in **one** variable — the `delete on public.deck` grant — and a
fresh `newDeckName` **Y ≠ X**, plus a fresh idempotency key. The fresh name is not hygiene, it is
what makes the run possible at all (plan-review F3): step 1 left orphan **X** behind, so a repeat
under X is stopped at `generate.ts:362` with `409 "Talia o tej nazwie już istnieje"` — before
`createDeck`, before `:531`, before the undo — and would measure the name pre-check rather than
this branch. Deleting X first is the alternative and is worse: it needs raw psql (the app's own
delete path is exactly what step 1 revoked) and it destroys the artifact step 1 exists to produce.
Expected: `500` with `{ error: "Nie udało się zapisać sesji generacji" }` and **no** `retriable`
field, and no deck named Y anywhere. Both runs recorded with their observed bodies.

#### 4. The restore

**File**: none — recorded, with its oracles

**Intent**: Re-grant, then prove the re-grant rather than remember it. C10X-48's three oracles
transfer unchanged and all three are required: the `information_schema` projection matching the
BEFORE dump, the raw `pg_class.relacl` compared byte-for-byte against an untouched sibling
table, and `has_table_privilege` answering `t`.

**Contract**: `grant insert on public.generation_session to authenticated;` — `delete on
public.deck` was already re-granted by step 3, so the oracles must cover **both** tables rather
than only the one this step touches. Then all three oracles, then `npm test` green against the
restored stack — a green suite is the fourth, behavioural check that the grants are really back.
Orphan deck **X** is deliberately left in place: this change detects, it does not delete (D-01),
and the deck is the artifact of record.

### Success Criteria:

#### Automated Verification:

- `npm test` green after the restore, against the restored grants

#### Manual Verification:

- The provocation run's response body recorded verbatim and carrying the new literal
- The orphan deck X and the absent session row read directly in psql and recorded
- The control run recorded under a fresh name Y, answering the ordinary message with no deck Y
- All three restore oracles recorded as passing, for **both** tables
- Banner screenshot or transcription showing the message and **no** "Ponów" button
- The orphan deck visible in the generate page's deck selector after the reload the copy
  instructs, with the pre-reload absence noted alongside it

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Doc-sync

### Overview

Two documents claim C10X-49 owns this site, and both go stale the day it ships — but neither is
a live declaration, which decides how each is edited.

### Changes Required:

#### 1. `test-plan.md` — the live surfaces

**File**: `context/foundation/test-plan.md`

**Intent**: Add this change's own statement where live statements live. The header block's
current "Last updated" entry is demoted to "Previously" and a new entry describes this change,
leading with the boundary rather than the coverage: the suite owns the helper's contract, one
manual run owns reachability, and **no §2 risk row moves and no §3 phase status changes**.

**Contract**: A new dated note appended to §6.6's Phase-2 (C10X-48) entry, and a new §8 ledger
entry carrying the measured suite total, the gate results, the breakage run with its observed
string and denominator, and an explicit "still open" list (the orphan survives; the endpoint
branch has no automated witness; the island half rests on the browser check; C10X-50 owns the
two remaining sites).

#### 2. `test-plan.md` — the two dated corrections

**File**: `context/foundation/test-plan.md` (~`:1731` in §6.6, ~`:5234` in §8)

**Intent**: Both sentences say "the two remaining swallowed `await`s ... the deck undo after a
failed session insert (C10X-49) and the two failure-path `createGenerationSession` inserts
(C10X-50)". Both sit inside dated C10X-48 entries, so each takes a **dated correction line
beneath it and is not rewritten** — the C10X-30 "4xx" precedent, and the exact trap
`lessons.md:235-241` describes.

**Contract**: Each correction states that the deck undo is checked as of this change's date,
that the remaining exception is C10X-50's two inserts, and that the sentence stands as the
record of what was true when written. Target them by section and claim, never by line number
alone — the numbers will have moved by the time this phase runs.

#### 3. `change.md`

**File**: `context/changes/bug-generation-deck-undo-swallowed/change.md`

**Intent**: Record the decisions so none is rediscovered as a gap. `status: planned`,
`updated` stamped.

**Contract**: D-01 detection not deletion; D-02 the distinct message naming the leftover deck,
with the two rejected alternatives; D-03 explicit `retriable: false`, against the naive reading of
D-08 — the flag marks what a VERBATIM repeat provably cannot fix, and on this branch the orphan
makes that repeat a deterministic 409, so the copy replaces the button rather than accompanying it
(plan-review F1); D-04 the `:566` early
return fixed as a comment, not as code, with the reason; D-05 evidence split — suite owns the
helper, one manual run owns reachability, nothing bridges them; D-06 the test's home is
`decks.test.ts` on the resource rule; D-07 no `lessons.md` entry, because `:243-248` already
states this rule and names this site; D-08 the roadmap row opened in Phase 1.

#### 4. The roadmap row's Status

**File**: `context/foundation/roadmap.md`

**Intent**: Leave `Status: in progress` — `/10x-archive` closes it, not this plan.

**Contract**: The detail block's `Status` line records that the row was opened during Phase 1
rather than backfilled, and why.

### Success Criteria:

#### Automated Verification:

- `npm run format` leaves the edited markdown a fixed point — write twice, diff, no change
  (the prettier hazard C10X-43 recorded: a code span split across a line inside a blockquote
  loses its `>` marker, and a span's padding is stripped)
- `context/archive/**` untouched, as `.prettierignore` guarantees
- No document still claims C10X-49 owns an unchecked site, other than as a dated correction

#### Manual Verification:

- Every doc-sync target confirmed live-vs-dated by reading its SECTION HEADING, not its line
- The §8 entry's suite total matches a real run, and its breakdown adds up to it

---

## Testing Strategy

### Unit Tests:

None — the fix is I/O at a call site with no pure half worth extracting. Extracting one would
produce a function that takes `{data, error}` and returns a boolean, which asserts nothing the
type system does not.

### Integration Tests:

One: the cross-account zero-row case on `deleteDeck` (Phase 2). The endpoint branch itself is
unreachable from the suite for the structural reason research §8 establishes, and no amount of
seeding changes that.

### Manual Testing Steps:

The order is load-bearing and was corrected by plan-review F3 — (2) must precede any re-grant, and
(3) must not reuse (1)'s deck name:

1. Revoke both privileges; run one real generation with deck name **X** and a key; record the
   body, the orphan deck X and the missing session row.
2. **Still on that state, before any re-grant**: read the banner in the browser — new copy,
   "Ponów" ABSENT — then do what the copy says, in its order: reload, then open the selector and
   find deck X. Note the pre-reload absence on the way past.
3. Re-grant `delete on public.deck` only; repeat with a **fresh** name **Y** and a fresh key;
   confirm the ordinary message and that no deck Y survives. A repeat under X would 409 at the
   name pre-check and measure nothing.
4. Re-grant `insert on public.generation_session`; verify with all three oracles across **both**
   tables; run `npm test`. Leave orphan X in place — it is the artifact, not litter.

## Performance Considerations

None. The change adds no round-trip — it reads a result already being awaited.

## Migration Notes

No migration. Nothing under `supabase/` changes, so the C10X-29 drift gate is not involved. The
DCL in Phase 3 is a local-stack provocation that is revoked and restored within the phase, never
committed and never pushed.

## References

- Research: `context/changes/bug-generation-deck-undo-swallowed/research.md`
- The sibling fix this mirrors: `src/pages/api/generate.ts:628-652`
- The helper's contract: `src/lib/decks.ts:37-42`
- The rule, which already names this site: `context/foundation/lessons.md:243-248`
- The doc-sync live-vs-dated rule: `context/foundation/lessons.md:235-241`
- The test pattern: `tests/generation/generate.test.ts:1110-1160`; its home here,
  `tests/isolation/decks.test.ts:86-120`
- The guard a loosened fix would break: `tests/generation/generate.test.ts:871`
- C10X-48's manual DCL procedure and restore oracles:
  `context/archive/2026-08-12-bug-generation-compensation-swallowed/verification.md:138-206`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Checked undo, its copy, and the roadmap row

#### Automated

- [x] 1.1 `npm run typecheck` exits 0 — f6e5713
- [x] 1.2 `npm run lint` exits 0, 3 pre-existing `no-console` warnings unchanged — f6e5713
- [x] 1.3 `npm run build` exits 0 — f6e5713
- [x] 1.4 `npm test` green, `generate.test.ts:871` still passing — f6e5713
- [x] 1.5 `git diff -- supabase/` empty — f6e5713

#### Manual

- [x] 1.6 No comment in `:552-599` claims something the code does not do — f6e5713
- [x] 1.7 New literal absent from `redirect-errors.ts`; set-size assertion untouched — f6e5713

### Phase 2: The helper's contract, in the suite

#### Automated

- [x] 2.1 New case passes; suite green on a fresh un-pinned seed — f9052a8
- [x] 2.2 Suite total re-measured by running the file, not by arithmetic — f9052a8
- [x] 2.3 Breakage run recorded with observed string, split and denominator; two predicted reds, both positive controls green — f9052a8
- [x] 2.4 Restore verified by `md5sum`; `git diff -- src/` empty — f9052a8

#### Manual

- [x] 2.5 Phase records that the endpoint fix has no automated witness — f9052a8

### Phase 3: Reachability — one recorded DCL run, and the promise the copy makes

#### Automated

- [x] 3.1 `npm test` green after the restore — e63c340

#### Manual

- [x] 3.2 Provocation run's response body recorded verbatim, carrying the new literal — e63c340
- [x] 3.3 Orphan deck X and absent session row read in psql and recorded — e63c340
- [x] 3.4 Control run under a fresh name Y recorded: ordinary message, no deck Y — e63c340
- [x] 3.5 All three restore oracles recorded as passing, for both tables — e63c340
- [x] 3.6 Banner recorded: new message, "Ponów" absent — e63c340
- [x] 3.7 Orphan deck visible in the deck selector after the reload the copy instructs — e63c340

### Phase 4: Doc-sync

#### Automated

- [x] 4.1 `npm run format` idempotent on the edited markdown — 051f350
- [x] 4.2 `context/archive/**` untouched — 051f350
- [x] 4.3 No document claims C10X-49 owns an unchecked site except as a dated correction — 051f350

#### Manual

- [x] 4.4 Every doc-sync target confirmed live-vs-dated by its section heading — 051f350
- [x] 4.5 §8 entry's suite total matches a real run and its breakdown adds up — 051f350
