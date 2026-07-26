# Study session — silent rating loss + SRS schedule coverage gaps: Implementation Plan

## Overview

Close a live production defect on the study path and the coverage gaps the C10X-27 audit
found beyond the record. A signed-out `POST /api/study` is answered by middleware with a
302 to an HTML page; `fetch` follows it, `res.ok` is `true`, and `StudySession.rate()`
advances the card and bumps the counter **without a single write**. The user walks a whole
session believing they are studying, and nothing is scheduled — a direct hit on test-plan
Risk #3 ("the schedule stops being trustworthy") and on the roadmap H-02 Outcome.

Alongside the fix, this change closes four named coverage gaps (`session_size` → the batch
limit, "a card comes back when it falls due", the batch's deterministic ordering, and the
grades that never reach the write path), pulls in three items the audit recorded but did
not fix, and replaces the stale parts of `context/foundation/test-plan.md` with evidence
produced by execution rather than by reading.

## Current State Analysis

**The defect.** `src/middleware.ts:23-27` answers every unauthenticated request to a
`PROTECTED_ROUTES` prefix with `context.redirect("/auth/signin")`. For a page that is
right. For a JSON endpoint fetched by a React island it is not: `fetch` defaults to
`redirect: "follow"`, a 302 on POST is re-issued as GET with the body dropped,
`/auth/signin` is public so it renders **200 `text/html`**, and `res.ok` is `true`.
`src/components/study/StudySession.tsx:174` branches on `!res.ok` alone, so the guard is
skipped entirely.

`rate()` is the **only** island method in the repo with that ordering. Verified
line-by-line during planning: `StudySession.tsx:83-84` (`SessionSizeControl`, same file),
`GeneratorForm.tsx:161-162`, `FlashcardWorkspace.tsx:123-124` and
`CandidateReviewWorkspace.tsx:115-116` all parse the body **before** checking `ok`, so a
JSON 401 reaches their error branch correctly and an HTML body would at least throw.

The root cause is architectural, not a typo: middleware answers a JSON endpoint in a page's
format, which pre-empts the endpoint's own correct 401 (`src/pages/api/study.ts:52-55`).
That branch — and the identical ones in `/api/generate` and
`/api/decks/[publicId]/cards/batch` — is unreachable in production today. The rule is
already accepted: `context/foundation/lessons.md:187-192`.

**The coverage.** Risk #3's three originally briefed tests already exist and pass: 22 cases
across `tests/study/study.test.ts` (16) and `tests/study/schedule.test.ts` (6), full suite
69/69, no `.skip`/`.only`/`.todo`. What is missing is narrower and named:

- `src/pages/study/[publicId].astro:37` caps the batch with `deck.session_size`; **every**
  test call passes the literal `20` (`study.test.ts:104`, `:531-536`,
  `candidates.test.ts:626`). The setter is proven; the reader is not.
- Every `listDueCards` call passes `new Date()`. Nothing advances the clock and re-enters a
  session, so "no card is lost" — half of Risk #3's own scenario — has no test.
- The RPC's `order by coalesce(s.due, p_now) asc, f.id asc` tie-break (added by
  `20260724220524` precisely so `LIMIT` would stop being planner-dependent) has no
  assertion; every check uses `find`/`toContain`.
- Only `Rating.Good` ever reaches the write path. `Again` never does, so `lapses` and the
  Review → Relearning transition — the "hard card resurfaces sooner" half of US-02 — are
  unproven through persistence.
- `src/middleware.ts` has **zero** automated coverage, including the prefix-match trap that
  `context/archive/2026-07-15-verification-harness/` explicitly deferred to "when Phase 4's
  SRS routes land". They landed; nothing was revisited.

**The record.** Three statements in `test-plan.md` are false or stale. Most sharply: §6.1
and both test-file headers assert the app configures `enable_fuzz: false`. It does not —
`src/lib/study.ts:28-30` passes only `request_retention`, `maximum_interval` and
`enable_short_term`, and determinism rests on `default_enable_fuzz = false` in ts-fsrs
5.4.1 under a `^5.4.1` range. The exact-`due` oracles (`study.test.ts:372`, `:443`) depend
on it.

**The harness.** `vitest.config.ts:25` runs `environment: "node"`; there is no jsdom,
happy-dom or `@testing-library` in `package.json`. A React component test would be a new
stack layer, which is why the client contract is covered by extracting the decision into a
pure function instead.

## Desired End State

A user whose session expired or was revoked in another tab sees an error on the first
rating instead of walking the whole session in silence, and every rating that reports
success has actually been written. `/api/study`, `/api/generate` and
`/api/decks/*/cards/batch` all answer an unauthenticated caller with a JSON 401 their
islands already know how to display, while pages keep redirecting.

The schedule's promises carry proof rather than assertion: the batch is bounded by the
deck's own `session_size` and composed deterministically, a card rated today comes back
exactly when it falls due and not a minute earlier, and all four grades — including the
lapse transition — are asserted against an oracle advanced independently of the store.

`test-plan.md` contains no false statement, every deliberate-breakage count in it comes
from a run executed against the current files, and §3 Phase 4 is `complete` again with a
dated claim naming what closed it.

### Key Discoveries:

- `GoTrueClient.js:2497` — `getUser()` with no session returns `AuthSessionMissingError`
  **without a network call**, so the middleware's signed-out rows need no database.
- All four sibling islands parse before `ok` (line refs above) — the middleware change is
  safe for `/api/generate` and `/api/decks/*/cards/batch` without touching their code.
- `src/pages/api/auth/*` are **not** in `PROTECTED_ROUTES`, so a `/api/*` branch inside the
  guard cannot affect sign-in/sign-up/sign-out.
- `/study` does **not** prefix-match `/api/study` — the separate array entry in
  `src/middleware.ts:4` is load-bearing, and the table-driven test must pin it.
- The `study_due_cards` RPC's `returns table (...)` ends at `last_review` — it does **not**
  return `scheduled_days` (verified in `20260724220524_…sql:52-55`). Round-tripping that
  column on the RPC path would need a `drop function` migration; on the `rateCard` path it
  needs neither.
- `now` is a trailing parameter on `rateCard`/`listDueCards`/`listDueCounts` and is
  deliberately unreachable from a request body (`src/pages/api/study.ts:94-102`). Exact
  `due` and future-clock assertions are possible at the lib layer and impossible over HTTP.
- With `enable_short_term: false`, ts-fsrs' `LongTermScheduler` zeroes the incoming card's
  `scheduled_days` and `elapsed_days` before computing
  (`node_modules/ts-fsrs/dist/index.cjs:1183-1184`) — so round-tripping `scheduled_days` is
  behaviour-neutral today and must stay that way (the existing oracles will catch it if not).
- An all-unseeded deck collapses every sort key to `p_now`, so the tie-break degenerates to
  `f.id asc` — i.e. insertion order. That is what makes a batch-composition assertion
  writable without seeding schedules by hand.

## What We're NOT Doing

- **Not** unifying the fetch pattern across the other four islands, and not introducing a
  shared `postJson()` they all migrate to. Only `rate()` has the inverted ordering; the
  rest are correct and out of this change's scope (`lessons.md:96-101`).
- **Not** adding a DOM environment, `@testing-library` or any component-test layer. §4 of
  the test plan would need a new row with a `checked:` date; the pure-function extraction
  gets the same signal for the logic that actually failed.
- **Not** widening the `/api/*` branch beyond `PROTECTED_ROUTES` — public API paths keep
  their current behaviour.
- **Not** adding `elapsed_days` as a column, and not adding `scheduled_days` to the RPC's
  return type. Both would need a migration; both are inert under the current scheduler
  config. The remaining half of the class is recorded, not fixed.
- **Not** fixing the `supabase === null` empty-state masquerade on the study pages
  (`index.astro:14-15`, `[publicId].astro:24`) or the `cardsError`-ships-200 status
  inconsistency. Project-wide loader patterns, filed separately.
- **Not** adding keyboard shortcuts (1–4) or autofocus to the session island. A real
  a11y gap against the PRD's baseline-keyboard NFR, but a feature, not this fix.
- **No e2e.** No §3 phase wires it; §7's re-evaluation trigger stays as written.
- **Not** flipping the roadmap Status → done. `/10x-archive` owns that (`lessons.md:180-185`).

## Implementation Approach

Four working phases behind one verification gate, ordered so the only thing that harms a
user today ships first and each later phase is severable without breaking the earlier ones.

Phase 1 fixes the defect on both halves the accepted rule requires — the shell stops lying
about its response format, and the client stops trusting `res.ok` alone — and covers both
with tests that need no new stack layer. Phase 2 closes the four named coverage gaps at the
lib layer, where the `now` seam makes exact assertions possible. Phase 3 pulls in the three
recorded-but-unfixed items, all on surfaces the earlier phases already touched. Phase 4
produces the evidence and rewrites the record against it.

Phase 0 is a read-only check against the linked cloud project, run before any code, because
Phase 2's `session_size` bounds assume a CHECK constraint that may only exist locally.

## Critical Implementation Details

**Ordering inside the middleware guard.** The `/api/*` branch must sit **inside** the
existing `PROTECTED_ROUTES` check, not before it. Hoisting it would make every `/api/` path
require a session, including `/api/auth/signin` — which would lock out sign-in entirely and
present as "the login form does nothing".

**`scheduled_days` must stay behaviour-neutral.** Feeding the persisted value back into
`scheduleRowToCard` changes the `Card` handed to `next()`. Under `enable_short_term: false`
the scheduler zeroes it on input, so nothing should move — and the existing exact-`due`
oracles (`study.test.ts:372`, `:443`) are the check. If any of them goes red after the
change, the round-trip is *not* neutral and the correct response is to stop and re-scope,
not to update the expectation.

**Phase 2's `enable_fuzz` edit lands before its tests.** Adding the parameter cannot change
today's behaviour (it matches the upstream default), so the whole suite must stay green
across that single-line edit. A red test there means the assumption this change is built on
was wrong, and everything downstream needs re-checking.

**Restores are verified, never assumed.** Every deliberate-breakage check in Phase 4 dumps
the object's definition before the neuter and after the restore and `diff`s the two.
`test-plan.md` §6.6 records a restore that silently no-opped (a heredoc piped to
`docker exec` without `-i`) and was caught only by that diff.

## Phase 0: Verify the cloud schema matches the migration history

### Overview

Confirm that `20260724220524_srs_study_schedule_review_fixes.sql` — which carries both the
`session_size between 1 and 100` CHECK and the RPC tie-break this change tests — actually
reached the linked cloud project. The S-03 impl-review recorded it as applied to the
**local stack only**, with the cloud push left to a later slice and never confirmed.

### Changes Required:

#### 1. Migration history check (read-only, no code)

**File**: none — a verification step.

**Intent**: Establish before any test is written whether the constraint and RPC definition
those tests assume exist on production, so a drift is found now rather than at ship.

**Contract**: Run from **this worktree** and confirm the branch first
(`lessons.md:110-115`): `git branch --show-current` → `npx supabase migration list`. The
`20260724220524` row must show a Remote timestamp. Record the observed output verbatim in
`context/changes/srs-study-session-test/verification.md`. If the row is local-only, do
**not** run `db push` here — record it as a ship-time action for `/ship` and note that the
plan's local tests are unaffected (they run against the local stack).

### Success Criteria:

#### Automated Verification:

- `npx supabase migration list` runs from the worktree and its output is captured

#### Manual Verification:

- `20260724220524` is confirmed present (or explicitly recorded as pending) on the linked
  cloud project, with the raw output pasted into `verification.md`

---

## Phase 1: Stop the silent rating loss

### Overview

Make the shell answer JSON endpoints in JSON, make `rate()` stop trusting `res.ok` alone,
and cover both. After this phase the endpoint's own 401 is reachable in production for the
first time, and the client's response handling has a test that goes red if the ordering is
ever inverted again.

### Changes Required:

#### 1. The middleware guard

**File**: `src/middleware.ts`

**Intent**: A guard must answer in the format its caller expects — JSON for `/api/*`, a
redirect for pages. This is the fix that makes three well-written 401 branches reachable.

**Contract**: Inside the existing `PROTECTED_ROUTES` branch (never before it — see Critical
Implementation Details), when `context.url.pathname.startsWith("/api/")`, return a `401`
`Response` with `Content-Type: application/json` and the same body shape the endpoints use
(`{ error: "Nie jesteś zalogowany" }`, matching `src/pages/api/study.ts:54`). Everything
else keeps `context.redirect("/auth/signin")`. `PROTECTED_ROUTES` itself is unchanged.

#### 2. The response-handling decision, extracted

**File**: `src/lib/http.ts` (new)

**Intent**: The ordering bug was possible because each island re-decides "did this succeed"
by hand. Move that decision into one testable place so `rate()` cannot get it wrong, and so
a lost session is a named outcome rather than an accidental success.

**Contract**: One exported async function taking a `Response` and a fallback message, and
returning a discriminated result — success with the parsed body, or failure with a
user-facing Polish message. It must treat as failure: a non-`ok` status, a `401` (with a
session-lost message distinct from the generic one), a followed redirect
(`res.redirected`), and a body that is not JSON. Parsing happens before the `ok` check, the
way the four correct islands already do it. This signature is consumed by Phase 3, so pin
it here:

```ts
export type JsonResult<T> = { ok: true; data: T } | { ok: false; message: string };
export async function readJsonResponse<T>(res: Response, fallback: string): Promise<JsonResult<T>>;
```

#### 3. `rate()` uses it

**File**: `src/components/study/StudySession.tsx`

**Intent**: Remove the `!res.ok`-only branch — the single line that turned a lost session
into a silent success.

**Contract**: `rate()` routes its response through `readJsonResponse` and advances the card
only on a success result; on failure it sets the returned message and `status = "error"`,
as today. `SessionSizeControl` in the same file is deliberately left unchanged (it already
parses before checking `ok`); the surrounding comment at `:180-181` is updated so it stops
describing the removed guard.

#### 4. Guard coverage

**File**: `tests/middleware.test.ts` (new)

**Intent**: The guard has never had a test, and this change alters it. Cover both the new
branch and the prefix-match trap that F-03 deferred and Phase 4 never revisited.

**Contract**: Table-driven over `PROTECTED_ROUTES`, calling the exported `onRequest` with a
fabricated context (`url`, `request`, a minimal `cookies` stub, `locals`, `redirect`, and a
`next` spy). For each protected prefix assert: an `/api/*` path answers `401` with a JSON
content-type and an `error` string, a page path answers a `302` to `/auth/signin`, and
`next` was not called. Assert explicitly that `/api/study` is matched by its own entry and
not by `/study`. Public paths (`/auth/signin`, `/api/auth/signin`) must reach `next`.
Positive control in the same file: a request carrying `accountA`'s real cookie header to a
protected path passes through — without it, a wholesale-broken guard reads as perfect
protection. Signed-out rows need no database (see Key Discoveries).

#### 5. Response-handling coverage

**File**: `tests/lib/http.test.ts` (new)

**Intent**: Pin the ordering that failed, using hand-built `Response` objects — no network,
no DOM, no container.

**Contract**: Cases for a `200` JSON success; a `4xx`/`5xx` JSON body whose `error` becomes
the message; a `401` mapping to the session-lost message; and **the defect's exact shape**
— a `200` with `Content-Type: text/html` (what the followed redirect produced) resolving to
failure, not success. A body that is not parseable JSON must yield the fallback message
rather than throw.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes
- `npm run lint` passes
- `npm run build` passes
- `npm test` passes, including the two new files
- `tests/lib/http.test.ts` fails when the `ok` check is moved back before the parse (run it,
  record the observed failure, revert)

#### Manual Verification:

- Sign in, open a study session, sign out in a second tab, then rate a card: an error is
  shown and the card does **not** advance
- A normal session still rates and advances with no visible change
- Generation and the review screen still show their own error copy when the session is gone
  (they consume the new 401 through their existing branches)

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 2: Close the four named coverage gaps

### Overview

Make determinism real rather than inherited, then cover the three promises the schedule
makes that nothing observed: the batch is bounded by the deck's own cap and composed
deterministically, a rated card comes back exactly when due, and every grade — not just
`Good` — writes what ts-fsrs computes.

### Changes Required:

#### 1. Pin fuzz in the configuration, not in a comment

**File**: `src/lib/study.ts`

**Intent**: Three documents assert the app configures `enable_fuzz: false`; it does not, and
the exact-`due` oracles depend on an upstream default under a caret range.

**Contract**: Add `enable_fuzz: false` to the `generatorParameters({...})` call at `:28-30`.
Behaviour must not change (it matches ts-fsrs 5.4.1's default) — the full suite staying
green across this edit is the check. The comment above the call is updated to describe the
configured value rather than the assumed one.

#### 2. `session_size` reaches the batch, and the batch is ordered

**File**: `tests/study/study.test.ts`

**Intent**: The single most load-bearing untested wire. `deck.session_size` caps the batch
in production while every test passes a literal, so a regression to `20`, to the RPC's own
default, or to dropping `p_limit` would be invisible.

**Contract**: A new `it()` in a dedicated `describe`: create a deck, set its `session_size`
through the real endpoint, create more accepted cards than the cap, then read the deck via
`getStudyDeck` and pass **`deck.session_size`** — never a literal — into `listDueCards`.
Assert the batch length equals the cap, and that its members are the first-created cards in
creation order (all cards are unseeded, so every sort key collapses to `p_now` and the
tie-break degenerates to `f.id asc`). §6.7's new trap note applies: copying the existing
`listDueCards(..., 20)` call shape is exactly how this stayed unobserved.

#### 3. A card comes back when it falls due

**File**: `tests/study/study.test.ts`

**Intent**: The unproven half of Risk #3. Nothing in the suite advances the clock, so
"survives between sessions" only ever demonstrated read-after-write.

**Contract**: A new `it()`: rate a card at `FIXED_NOW` through `rateCard`, read its
persisted `due`, then call `listDueCards` twice on a fresh client — once at that `due`
(the card **is** in the batch) and once at `FIXED_NOW + 1 minute` (it is **not**). The
negative half is what separates durability from "the RPC returned something"; a `due <=
p_now` predicate that was always true would pass the positive half alone.

#### 4. Every grade takes the write path

**File**: `tests/study/study.test.ts`

**Intent**: `Rating.Again` has never reached persistence, so `lapses` and the
Review → Relearning transition are unproven — the "hard card resurfaces sooner" half of
US-02.

**Contract**: Two additions. First, a matrix case: four fresh cards, one per grade
(Again/Hard/Good/Easy), each rated through `rateCard` at `FIXED_NOW`, each asserted
column-for-column against an oracle built by `createEmptyCard` and advanced **in memory**
(§6.1's independent-oracle rule — never through `scheduleRowToCard`). Second, the lapse
case: take one card to `State.Review` with three `Good` ratings, then rate `Again` and
assert `lapses` incremented by exactly one and `srs_state` is `Relearning`, both against
the in-memory oracle. Assert `lapses` against the oracle, never inside a `toEqual`
self-comparison — that is how it stayed unobserved.

### Success Criteria:

#### Automated Verification:

- `npm test` passes with the whole suite green immediately after the `enable_fuzz` edit,
  before any new test is added
- `npx vitest run tests/study/study.test.ts` passes with the new cases
- `npm run lint` passes

#### Manual Verification:

- Set a deck's session size to a small value in the UI, then open its session and confirm
  the batch is capped at that value
- Re-entering the same session shows the cap taken from the deck, not a default

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 3: The three recorded-but-unfixed items

### Overview

Three defects the audit named and deliberately left: a counter that overstates what was
rescheduled, a write-only column of the same class as the bug that already shipped once,
and a session that can get stuck on a card with no way out but a page reload. All three sit
on surfaces Phases 1–2 already touch.

### Changes Required:

#### 1. `reviewed` counts transitions, not responses

**File**: `src/components/study/StudySession.tsx`

**Intent**: The end-of-session summary increments on every `200`, including the benign
`alreadyApplied: true` — so it can report more cards rescheduled than were.

**Contract**: `rate()` reads `alreadyApplied` from the parsed success body (available via
Phase 1's `JsonResult.data`) and increments `reviewed` only when a transition actually
happened. The card still advances in both cases — an already-applied rating is a completed
card, not a failure.

#### 2. `scheduled_days` stops being write-only

**File**: `src/lib/study.ts`

**Intent**: `cardToScheduleColumns` writes it (`:97`) and nothing reads it back — the same
class as the `learning_steps` bug that pinned cards in Learning at +10 min forever
(S-03 impl-review F1), inert today only because the scheduler config removes it from the
calculation.

**Contract**: `rateCard`'s schedule re-read (`:284`) selects `scheduled_days`, `DueCardRow`
gains it as an **optional** nullable field, and `scheduleRowToCard` prefers the persisted
value over `createEmptyCard`'s `0`. Optional because the `study_due_cards` RPC does not
return the column (verified) and widening its `returns table` would need a `drop function`
migration — out of scope. Behaviour must not move: the existing exact-`due` oracles are the
check (see Critical Implementation Details). Update the comment at `:65-72`, which
currently lists `scheduled_days` among the fields the table does not store, and record in
the same comment that `elapsed_days` and the RPC path remain outside the round-trip.

#### 3. A stuck session gets an exit

**File**: `src/components/study/StudySession.tsx`

**Intent**: The batch is a load-time snapshot. A card rejected in the review screen or rated
in another tab answers 404, the island shows an error and does not advance, and there is no
skip affordance — the session is stuck until the page is reloaded.

**Contract**: When a rating fails with a 404 (the card is no longer part of this session),
the error panel offers a "Pomiń kartę" action that advances the index without incrementing
`reviewed` and clears the error. Other failures keep today's retry-in-place behaviour, with
no skip offered. This needs the failure result to carry the status — extend Phase 1's
failure shape with the response status rather than inferring it from the message.

### Success Criteria:

#### Automated Verification:

- `npm test` passes — in particular the exact-`due` oracles at `study.test.ts:372` and
  `:443`, which are the neutrality check for the `scheduled_days` round-trip
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Rate the same card twice quickly: the counter increases by one, not two
- Reject a card in the review screen while its session is open, then rate it: the error
  offers "Pomiń kartę" and the session continues
- A network failure still shows the retry-in-place error with no skip offered

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 4: Produce the evidence, then rewrite the record

### Overview

Every deliberate-breakage count in §6.6 predates two cases added by `e9b8cd9`, so no
recorded run has ever been executed against the current files. Produce fresh evidence for
the new assertions and re-run the three existing checks, add a narrowed mutation run on the
study path, and only then correct `test-plan.md` — against observed output, not memory.

### Changes Required:

#### 1. Deliberate-breakage runs

**File**: `context/changes/srs-study-session-test/verification.md`

**Intent**: An assertion with no red run is a claim, not coverage. This is the phase that
makes the new tests' claims checkable and replaces stale counts with real ones.

**Contract**: For each new assertion, neuter the thing it observes and record the exact
red/green split: the guard's `/api/*` branch (Phase 1), the `p_limit` argument and the RPC's
`f.id asc` tie-break (Phase 2), the `due <= p_now` predicate (Phase 2), and the
`ok`-before-parse ordering (Phase 1). Re-run the three checks §6.6 already documents —
`study_due_cards`' `and f.state_id = 2` predicate, the four-policy neuter, and removing
`enable_short_term: false` — and record today's numbers. SQL-level checks run against the
live local DB via `docker exec … psql` (§6.7), not a `db:reset`. **Dump each object's
definition before the neuter and after the restore and `diff` them**; record the diff
result. No production edit is ever committed.

#### 2. Narrowed mutation run

**File**: `stryker.config.json`, `context/changes/srs-study-session-test/mutation-register.md`

**Intent**: The `mutate` list has never covered the study path.

**Contract**: Run Stryker narrowed with `--mutate "src/lib/study.ts:257-316"` (`rateCard`)
— the permanent `mutate` list stays untouched, per CLAUDE.md. Record every survived mutant
individually and add an assertion **only** where the mutant is a user-visible or
business-relevant bug. Do not chase 100%. Follow S-05's precedent in the register: for each
killed mutant, note whether it died on a behavioural assertion or on a malformed
query/parse error — a mutant killed by `PGRST100` is not evidence the gate is asserted.

#### 3. Correct the record

**File**: `context/foundation/test-plan.md`

**Intent**: The plan currently contains statements that are false, counts that are stale,
and a phase status that no longer matches what is proven.

**Contract**: (a) §6.1 — the `enable_fuzz` correction block becomes a statement of fact now
that the parameter is configured, with the ts-fsrs default noted as history. (b) §6.6
Phase 4 — the "…and the card comes BACK when it falls due" row moves from **NOTHING** to
the new test; every breakage count is replaced with the Phase 4 run's real numbers; the
audit note's open items that this change closed are marked closed and the ones it did not
(the `.astro` loaders, the rest of the island) stay open. (c) §6.6 Phase 1 — the signed-out
note gains the middleware guard's new coverage. (d) §6.7 — the three trap bullets added by
the audit are updated to point at the tests that now close them. (e) §7 — the "React
islands' own fetch-response handling" bullet records that the decision is now covered by a
pure function while the JSX remains unreachable. (f) §3 — Phase 4 `reopened` → `complete`,
with a dated line naming what closed it, and the `reopened` vocabulary entry kept. (g) §8 —
freshness ledger updated with today's suite state. Two test-file headers
(`tests/study/schedule.test.ts:7`, `tests/study/study.test.ts:337`) carry the same false
`enable_fuzz` sentence and are corrected in the same pass.

#### 4. Doc-sync

**File**: `context/changes/srs-study-session-test/change.md`, `context/foundation/roadmap.md`

**Intent**: Close the change's own record.

**Contract**: `change.md` status → `implemented`, `updated` → today, and the "deliberately
out of scope" list edited to reflect the three items Phase 3 pulled in. `roadmap.md` H-02:
**Outcome only** — do not touch Status; `/10x-archive` owns that flip (`lessons.md:180-185`).

### Success Criteria:

#### Automated Verification:

- `npm test` green at the end, with the final count recorded
- `npx stryker run --mutate "src/lib/study.ts:257-316"` completes and its report is captured
- `npm run lint` passes
- `git diff` shows no production edit left behind from any breakage check

#### Manual Verification:

- Every restore verified by a before/after definition `diff`, with the result recorded
- `test-plan.md` re-read end to end: no statement in it is false, and every count cites a
  run from this change
- The survived-mutant register explains, per mutant, why an assertion was or was not added

**Implementation Note**: This is the final phase. After it, hand off to `/10x-impl-review`.

---

## Testing Strategy

### Unit Tests:

- `tests/lib/http.test.ts` — the response-handling decision, including the defect's exact
  shape (a `200 text/html` from a followed redirect) and a `401`.
- `tests/middleware.test.ts` — table-driven over `PROTECTED_ROUTES`: `/api/*` → 401 JSON,
  pages → 302, public paths → `next`, `/study` vs `/api/study`, plus a signed-in positive
  control.
- `tests/study/schedule.test.ts` — unchanged apart from its header correction; the ordering
  property already covers all four grades at the library layer.

### Integration Tests:

- `tests/study/study.test.ts` — `session_size` → `p_limit` with deterministic batch
  composition; due re-entry with a positive and a negative clock; the four-grade write
  matrix and the lapse transition, both against in-memory oracles.

### Manual Testing Steps:

1. Sign in, start a session, sign out in a second tab, rate a card — expect a visible error
   and no advance (this is the defect; it must be reproducible before Phase 1 and gone after).
2. Rate the same card twice quickly — the counter advances by one.
3. Set a deck's session size to 3, give it 5 due cards, open the session — 3 cards.
4. Reject a card elsewhere while its session is open, rate it — "Pomiń kartę" appears and
   the session continues.
5. Trigger a generation and a bulk accept with an expired session — both show their own
   error copy, not a silent success.

## Performance Considerations

None. The middleware branch is a string prefix check on a path already being matched; the
`scheduled_days` round-trip adds one column to a query that already runs. The new tests add
a handful of local round-trips to a suite that currently completes in ~2 s.

## Migration Notes

**No migration.** The `scheduled_days` round-trip is deliberately scoped to the `rateCard`
path precisely so no `drop function` / `create function` cycle is needed for the RPC's
return type. Phase 0's cloud check concerns an **existing** migration
(`20260724220524`), not a new one; if it is pending, `db push` belongs to `/ship`.

## References

- Research: `context/changes/srs-study-session-test/research.md`
- Change identity: `context/changes/srs-study-session-test/change.md`
- The accepted rule this fix implements: `context/foundation/lessons.md:187-192`
- Prior art for the test harness: `tests/study/study.test.ts:190-201` (signed-out endpoint
  call), `tests/isolation/decks.test.ts` (row-based denial with a positive control)
- Deliberate-breakage precedent and its restore-verification failure:
  `context/foundation/test-plan.md` §6.6 (S-05 entry)
- The class this change half-closes: `context/archive/2026-07-24-srs-study-session/reviews/impl-review.md` (F1, F2)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 0: Verify the cloud schema matches the migration history

#### Automated

- [ ] 0.1 `npx supabase migration list` runs from the worktree and its output is captured

#### Manual

- [ ] 0.2 `20260724220524` confirmed present (or recorded as pending) on cloud, output pasted into `verification.md`

### Phase 1: Stop the silent rating loss

#### Automated

- [ ] 1.1 `npx astro sync` completes
- [ ] 1.2 `npm run lint` passes
- [ ] 1.3 `npm run build` passes
- [ ] 1.4 `npm test` passes, including the two new files
- [ ] 1.5 `tests/lib/http.test.ts` goes red when the `ok` check is moved before the parse (observed, then reverted)

#### Manual

- [ ] 1.6 Signing out in a second tab then rating shows an error and does not advance the card
- [ ] 1.7 A normal session still rates and advances unchanged
- [ ] 1.8 Generation and the review screen show their own error copy on an expired session

### Phase 2: Close the four named coverage gaps

#### Automated

- [ ] 2.1 Whole suite green immediately after the `enable_fuzz` edit, before any new test
- [ ] 2.2 `npx vitest run tests/study/study.test.ts` passes with the new cases
- [ ] 2.3 `npm run lint` passes

#### Manual

- [ ] 2.4 A small session size set in the UI caps the batch at that value
- [ ] 2.5 Re-entering the session uses the deck's cap, not a default

### Phase 3: The three recorded-but-unfixed items

#### Automated

- [ ] 3.1 `npm test` passes, including the exact-`due` oracles (the `scheduled_days` neutrality check)
- [ ] 3.2 `npm run lint` passes
- [ ] 3.3 `npm run build` passes

#### Manual

- [ ] 3.4 Rating the same card twice increases the counter by one
- [ ] 3.5 A card rejected elsewhere offers "Pomiń kartę" and the session continues
- [ ] 3.6 A network failure still shows retry-in-place with no skip offered

### Phase 4: Produce the evidence, then rewrite the record

#### Automated

- [ ] 4.1 `npm test` green at the end, final count recorded
- [ ] 4.2 Narrowed Stryker run on `src/lib/study.ts:257-316` completes and its report is captured
- [ ] 4.3 `npm run lint` passes
- [ ] 4.4 `git diff` shows no production edit left behind from any breakage check

#### Manual

- [ ] 4.5 Every restore verified by a before/after definition `diff`, result recorded
- [ ] 4.6 `test-plan.md` re-read end to end: no false statement, every count cites a run from this change
- [ ] 4.7 The survived-mutant register explains per mutant why an assertion was or was not added
