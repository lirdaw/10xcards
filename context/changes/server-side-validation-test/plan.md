# Server-side validation parity for card content rules (Risk #6) — Implementation Plan

## Overview

Close the **card-content half of test-plan Risk #6** — "the server trusts the client" — for
`FRONT_MAX` / `BACK_MAX`. A crafted request that breaches either bound must be refused **and
write nothing**, proven by a row oracle rather than by a status. This is the single item
between `test-plan.md` §3 Phase 2 and status `complete`.

The change is wider than the ticket in two deliberate directions, both decided during planning:

1. A **database backstop** (`char_length between 1 and N`) is added, closing the residual risk
   named on 2026-07-09 in `context/archive/2026-07-09-manual-card-crud/plan-brief.md:80-81`.
2. Three "server trusts the client" defects on the same four form endpoints — an unguarded
   `formData()`, a `File` part crashing the handler, and the untested `IDS_MAX` bound on
   `/cards/batch` — are fixed and covered here rather than deferred.

Auth is **out** (resolved in research: C10X-36, `auth-input-validation`).

## Current State Analysis

**The card-content validation logic in `src/` is already correct.** Four lines on two endpoints
enforce the rule and refuse before any write. What is missing is (a) any assertion that they do,
(b) any independent enforcer beneath them, and (c) controlled handling of two malformed-input
shapes.

What exists today:

- `POST /api/decks/[publicId]/cards` (`cards/index.ts:48-53`) and
  `POST /api/decks/[publicId]/cards/[cardPublicId]` (`[cardPublicId].ts:60-65`) check
  `length < 1 || length > FRONT_MAX/BACK_MAX` **after `.trim()`** and answer with
  `context.redirect(errorUrl(...))`.
- `FRONT_MAX = 200` / `BACK_MAX = 1000` live once, in `src/lib/flashcards.ts:61-62`, imported by
  both endpoints, three islands (`CreateFlashcardModal`, `FlashcardItem`, `CandidateItem`) and
  `openrouter.ts`'s Zod card schema. Verified by enumeration — no second literal anywhere.
- The database enforces only `char_length(front) > 0` / `char_length(back) > 0`
  (`flashcard_front_check`, `flashcard_back_check`, both auto-named by
  `init_core_schema.sql:62-63`). `text` is unbounded; there is no `varchar(n)`, no trigger.
- `createFlashcard` / `updateFlashcard` (`flashcards.ts:175-192`) put the strings straight into
  the query — no lib-layer re-validation.
- Test coverage of the rule: **zero**. `tests/isolation/flashcards.test.ts` and
  `tests/review/candidates.test.ts` drive these endpoints heavily but use card text only as an
  identity marker. `FRONT_MAX` appears in exactly one test file
  (`failure-path.test.ts:181-194`) and there it tests `openrouter.ts`'s schema, not these
  endpoints. `BACK_MAX` appears in no test at all.

Three defects on the same surface, each a genuine "crafted request" instance:

- `await request.formData()` is **unguarded** in all four form endpoints (`cards/index.ts:30`,
  `[cardPublicId].ts:23`, `auth/signin.ts:6`, `auth/signup.ts:6`). A POST carrying
  `Content-Type: application/json` makes it reject → an uncontrolled framework `500` with no
  project-owned body. Both JSON endpoints (`batch.ts:63-68`, `generate.ts`) wrap `.json()` in
  try/catch and answer a fixed `400`; the convention is applied on one side only.
- A multipart part of type `File` named `front` survives the `as string | null` cast, then
  `.trim()` throws `TypeError` → `500`. Same shape at `signin.ts:7-8`.
- `/cards/batch`'s `IDS_MAX = 100` (`batch.ts:24,31`) is its only input bound with no test. The
  client mirrors it as a **commented copy** `BATCH_MAX = 100`
  (`CandidateReviewWorkspace.tsx:27`), not an import.

### Key Discoveries

- **The card endpoints answer `302`, not `4xx`.** They are native-form targets and refuse by
  redirecting to `?error=<pl>&open=create-card` / `&edit=<cardPublicId>`. The ticket, both Jira
  comments, this change's `change.md:41`, the archived C10X-28 `change.md:52`, and
  `test-plan.md`'s Risk #6 guidance row all say "4xx". That wording is correct for
  `/cards/batch` and **wrong for create/edit**. It also says "POST/PATCH" — neither endpoint
  exports a `PATCH` handler. Both are corrected in Phase 5.
- **A `302` refusal is indistinguishable from a `302` success without reading rows.** No
  `?error=` refusal anywhere in the suite is paired with a row oracle today
  (`candidates.test.ts:402-412` is the nearest and asserts only the redirect target).
- **Deck resolution runs before length validation, deliberately** (`cards/index.ts:34-39`, from
  S-02 impl-review F5). An over-length body aimed at a foreign deck answers `404`, not the
  validation redirect — so every case must use a **real, owned** deck or it measures the wrong
  guard.
- **The trim asymmetry is the opposite of the source-text half.** `/api/generate` caps the raw
  string; both card endpoints `.trim()` **before** measuring (`index.ts:31-32`). C10X-28's case
  "over the cap, but trims back under it → still refused" does not transfer; the card-side
  mirror is *accepted*.
- **`char_length` ≤ JS `.length`, always** — a surrogate pair counts 2 in JS and 1 in Postgres.
  So a `between 1 and 200` CHECK can never reject a string the endpoint accepted; the backstop
  is strictly looser and adds no false refusals. (The converse is a real user-visible
  discrepancy — 101 astral characters measure 202 in JS and are refused by the endpoint — but it
  is a *stricter*, not a bypass, direction. Do not build boundary strings from non-ASCII.)
- **Local data is clean**: 7121 flashcards, `max(char_length(front)) = 33`,
  `max(char_length(back)) = 61`. The CHECK applies without repair. Measured 2026-07-28.
- **`AUTH_VALIDATION_MESSAGE`** ("Popraw dane w formularzu i spróbuj ponownie.") is already in
  `AUTH_MESSAGES` (`auth-errors.ts:55,78`), so the auth malformed-body branch needs no new copy
  and keeps the closed-set property `tests/auth/errors.test.ts` already asserts.
- **`callEndpoint` sets `Content-Type: application/json` for a string body**
  (`endpoint.ts:68-70`), so the malformed-body case is reachable with no fixture change. It also
  does **not** follow redirects (`endpoint.ts:50-55`), so `status` + `Location` are directly
  assertable.
- **Neither existing read helper may be the oracle, and the dangerous one is the COUNT.** Reaching
  for "a function that counts this deck's cards" lands on `countFlashcards`
  (`flashcards.ts:167-173`), which filters `state_id = STATE_ACCEPTED` — so a card written in any
  other state is invisible to it and "count unchanged" reads green over a real write.
  `listFlashcards` (`flashcards.ts:76-83`) carries the same filter and is the secondary trap. The
  oracle must be a raw, state-agnostic count scoped by `deck_id` only.

## Desired End State

`tests/validation/cards.test.ts` exists and proves, against the real local Postgres through the
real endpoints, that an over-`FRONT_MAX`/`BACK_MAX` request to create **or** edit a card is
refused with a project-owned redirect and leaves the database untouched — with a boundary
control at exactly the limit, so the refusals cannot be an endpoint refusing everything. The
database refuses the same content independently of the endpoint. Both facts are demonstrated by a
**pair** of deliberate-breakage runs, not asserted. `test-plan.md` §3 Phase 2 reads `complete`
with a date, and its Risk #6 row states what is and is not covered.

Verification: `npm test` green with the new file; the two breakage runs produce the predicted
red/green splits recorded in `verification.md`; `npm run lint` and `npm run build` exit 0;
`git diff -- src/ supabase/` empty after every breakage restore.

## What We're NOT Doing

- **Auth input validation.** Resolved in research and raised as **C10X-36**
  (`auth-input-validation`, type `Pomysł`, Post-MVP). Our auth routes contain zero validation
  lines, so a test there could not be turned red by any edit under `src/` — it would pin
  `supabase/config.toml`. The `formData()` guard added here is *malformed-body handling*, not an
  input rule, and does not overlap that ticket.
- **Re-testing `/cards/batch`'s existing bounds.** Five bad bodies plus a 404, each paired with a
  row re-read, are already covered at `candidates.test.ts:281-325`. Only the untested `IDS_MAX`
  case is added.
- **Client-side (island) enforcement.** No layer in this plan reaches an island's JSX (§7). The
  three card islands bounds-check the **imported** constants against the same trimmed string as
  the server, so the two ends agree by construction — that each end still enforces is a separate
  claim, and only the server half is assertable here.
- **The generation write path.** `insertCandidates` (`generations.ts:125-141`) stays unvalidated
  at the insert site; its content bound remains `openrouter.ts`'s Zod schema. The new CHECK
  becomes a backstop there for free — see Migration Notes for the one behavioural consequence.
- **Rewriting archived artifacts as if they had been right.** The archived C10X-28 `change.md`
  gets a **dated correction line**, not a silent edit — the archive records what was known then.
- **Rendering `.astro` pages.** Unchanged from §6.4.

## Implementation Approach

Bottom-up, so every assertion has something to observe by the time it is written:

1. The **database backstop** lands first, because the test's independence case asserts a `23514`
   and the second breakage run drops the constraint.
2. The **endpoint hardening** lands second, because two test cases (malformed body, `File` part)
   assert the controlled response it introduces.
3. The **tests** land third, in a new `tests/validation/` folder — a sibling folder named after
   the concern, per §6.2, keeping the one-claim-per-file property that makes a gap visible.
   `tests/isolation/flashcards.test.ts` is the **ownership** file and stays that.
4. The **breakage pair** runs fourth: decoupling the endpoint comparison shows the endpoint layer
   is observed; dropping the CHECK on top shows the database layer is a second, independent
   enforcer. Neither run alone separates the two.
5. **Doc-sync** last, including the "4xx"/"PATCH" correction in six places.

## Critical Implementation Details

**Ordering inside `[cardPublicId].ts`.** `formData()` is read at line 23, **before** the
supabase/session guards, because `errorUrl` is built from the `from` / `generation` form fields.
A `try/catch` around it therefore cannot use `errorUrl` in its catch — those fields do not exist
yet. The catch must fall back to the unscoped deck-view target
(`/decks/${publicId}?error=…&edit=${cardPublicId}`). Do not "fix" this by moving `formData()`
later: `from`/`generation` genuinely gate which base path the error round-trips to, and the S-05
round-trip tests (`candidates.test.ts:374-412`) pin that behaviour.

**What breakage run 1 actually observes.** With the endpoint comparison decoupled, the over-max
string reaches `createFlashcard`, the new CHECK rejects the insert, and the endpoint falls into
its *existing* error branch — so the response is **still a `302`, still carrying `error=` and
`open=create-card`**, and the row count is **still unchanged**. The only assertion that can go
red is the one comparing the decoded `error` param **by equality** against the length message.
Every over-max case must therefore assert the message by equality, never by `toContain("error=")`.

**Assertion ORDER inside every over-max case is load-bearing, and it is the count that goes
first.** Vitest aborts an `it()` at the first failed `expect`, and breakage run 2 makes the same
case fail on *both* the message and the count. With the message asserted first, run 2 would print
the identical failure string run 1 printed and the count assertion would never be reached — so
criterion 4.2 could not be observed and the pair would never separate "the endpoint caught it"
from "the database caught it". Ordered count-first, the pair yields two distinguishable strings:
run 1 is red on the **message** (the count having passed is itself the evidence that the CHECK
absorbed the write), run 2 is red on the **count**. Write this reason into the test file beside
the assertions — an ordering with no comment reads as arbitrary and gets "tidied" away.

**Restoring a dropped CHECK is not symmetric with restoring a function** (C10X-27, §6.7). Breakage
run 2 lets the suite persist a row the constraint forbids, so `add constraint` fails afterwards
with `violated by some row`. Delete the offending row — scoped to the run's own deck — *before*
re-adding, then confirm the restore with a `pg_get_constraintdef` before/after diff rather than
from memory.

## Phase 1: Database backstop on `front` / `back`

### Overview

Promote the two `char_length > 0` checks to bounded ranges, exactly as
`deck_session_size_check` was promoted in `20260724220524` — and for the same stated reason: the
maximum lived only in app code.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/<YYYYMMDDHHMMSS>_flashcard_content_bounds.sql`
(stamp after the last existing migration, `20260725150000_candidate_counts_rpc.sql`)

**Intent**: Give `flashcard.front` / `flashcard.back` a database-level upper bound so the four
endpoint lines stop being the only enforcer in the system, closing the residual risk named in
S-02's `plan-brief.md:80-81`.

**Contract**: Drop and re-add the two auto-named constraints
(`flashcard_front_check`, `flashcard_back_check` — verified against the live schema) as
`check (char_length(front) between 1 and 200)` and `check (char_length(back) between 1 and 1000)`.
Constraint names are preserved so `pg_constraint` reads identically apart from the definition.
Header comment in Polish, per the migration convention, and it must:

- state that the numbers duplicate `FRONT_MAX`/`BACK_MAX` in `src/lib/flashcards.ts` and that a
  change to either side needs the other — the same duplication `deck_session_size_check` carries;
- record why it is a separate migration rather than an edit to `init_core_schema.sql` (history is
  append-only);
- note that `char_length` counts code points while the endpoint counts UTF-16 units, so the CHECK
  is strictly looser and cannot reject what the endpoint accepted.

#### 2. Constant comment correction

**File**: `src/lib/flashcards.ts`

**Intent**: The comment at `:58-62` says "Max front/back length is a BUSINESS RULE, not a DB
CHECK … Enforced in two places only: the client form and the endpoint (after trim)." Both
sentences become false with this migration.

**Contract**: Rewrite those lines to name three enforcers (client form, endpoint, DB CHECK), point
at the new migration by filename, and state that changing either constant now requires a
migration.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies all migrations cleanly
- `npm run db:types` produces no diff (the CHECK does not change generated types; confirm rather than assume)
- `npm test` still green at the pre-change baseline count
- `npm run lint` exits 0

#### Manual Verification:

- The cloud database is checked for violating rows **before** any `db push`: `count(*) filter (where char_length(front) > 200)` and the `back` equivalent both return 0
- `pg_get_constraintdef` on the local DB shows `between 1 and 200` / `between 1 and 1000` under the original constraint names

**Implementation Note**: Pause here for manual confirmation before Phase 2. The `db push` to the
cloud itself belongs to `/ship`, not to this phase — but it must happen **before merge**, because
the `drift` gate compares migration versions on every push to `main`.

**If either cloud count comes back non-zero, STOP and decide here, not at `/ship`.** The two
options are repairing the offending rows (truncate to the bound) and loosening the bound to fit
them; both are product decisions, and the wrong moment to take one is with the merge already
blocked by a `db push` that cannot apply. It is unlikely — both write paths (`createFlashcard` via
the endpoints, `insertCandidates` via `openrouter.ts`'s `validate()`) already enforce the same two
constants, and locally the maxima are 33 / 61 across 7121 rows — but "unlikely" is why the check is
criterion 1.5 rather than an assumption.

---

## Phase 2: Controlled handling of malformed form input

### Overview

Apply the JSON endpoints' existing convention — parse failure → a fixed, project-owned response —
to the four form endpoints, and stop a non-string form part from crashing the handler.

### Changes Required:

#### 1. Card create endpoint

**File**: `src/pages/api/decks/[publicId]/cards/index.ts`

**Intent**: A crafted POST whose body is not a form currently produces an uncontrolled framework
`500`; it should produce the same owned redirect every other server-side failure on this endpoint
produces. Separately, a `File` part named `front`/`back` should read as empty rather than throw.

**Contract**: Wrap `await context.request.formData()` (line 30) in `try/catch`; the catch returns
`context.redirect(errorUrl("Nie udało się utworzyć fiszki"))` — the literal already used by the
two failure branches, so the closed set of owned messages does not grow. Replace the two
`(… as string | null) ?? ""` casts with a local helper that returns the value only when
`typeof value === "string"`, else `""` — a non-string part then falls into the existing length
guard and gets the existing Polish message. Behaviour on every valid request is unchanged.

#### 2. Card edit endpoint

**File**: `src/pages/api/decks/[publicId]/cards/[cardPublicId].ts`

**Intent**: Same two fixes, with the ordering constraint above.

**Contract**: `try/catch` around `formData()` (line 23). Because `errorUrl` is not yet defined at
that point — it is built from the `from`/`generation` fields — the catch returns a redirect to the
**unscoped** deck-view target carrying the same `Nie udało się zapisać zmian` literal and
`edit=${cardPublicId}`. The same string-only helper applies to `front`, `back`, `from` and
`generation`.

#### 3. Auth endpoints

**File**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`

**Intent**: Close the same unguarded `formData()` and the same `File`-to-GoTrue path. This is
malformed-body handling only — no presence, format or length rule is added, so C10X-36's scope is
untouched.

**Contract**: `try/catch` around `formData()`, redirecting to
`/auth/signin?error=<AUTH_VALIDATION_MESSAGE>` (resp. `/auth/signup?…`), which is already a member
of the exported `AUTH_MESSAGES` closed set. Replace `form.get("email") as string` with the same
string-only read so a `File` part becomes `""` rather than being posted verbatim to GoTrue.

### Success Criteria:

#### Automated Verification:

- `npm test` green — in particular `tests/auth/errors.test.ts` (closed-set membership) and `tests/review/candidates.test.ts`'s edit round-trip cases are unaffected
- `npm run lint` exits 0
- `npm run build` exits 0
- `npx vitest run tests/lib/no-logging.test.ts` green (no `console.*` introduced)

#### Manual Verification:

- Creating and editing a card through the browser still works, and a validation error still re-opens the modal / inline editor with the message
- Sign-in and sign-up through the browser are unchanged, including a wrong-password error

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: The card-content validation test

### Overview

The claim this whole change exists to make, plus the one untested `/cards/batch` bound.

### Changes Required:

#### 1. New test file

**File**: `tests/validation/cards.test.ts`

**Intent**: Prove that a crafted request breaching `FRONT_MAX`/`BACK_MAX` on create and on edit is
refused **and writes nothing**, that a request at exactly the limit succeeds and is stored whole,
and that the refusal response carries no submitted content.

**Contract**: §6.4's pattern throughout — real endpoint via `callEndpoint`, real session cookie,
real local Postgres, row-based assertions, file-level `Date.now().toString(36)` namespace. Two
decks created once in `beforeAll` (one for the create block, one for the edit block); every case
takes a **before/after delta** of a status- and state-agnostic count so the boundary-control cases,
which do write, cannot pollute the refusal cases.

In-file helpers (deliberately not added to `tests/fixtures/`, since only this file needs them):

- `countCards(deckId)` — `.from("flashcard").select("id", { count: "exact", head: true }).eq("deck_id", deckId)`
  read through `clientFor(a.cookieHeader)`. **Not** `countFlashcards` (`flashcards.ts:167-173`) —
  the helper this need points straight at — and not `listFlashcards` (`:76-83`): both filter
  `state_id = STATE_ACCEPTED` and would hide a card written in any other state.
- `rowOf(cardPublicId)` — column-for-column read, mirroring `candidates.test.ts:162-171`.
- `errorParam(location)` — `new URL(location, ORIGIN).searchParams.get("error")`, the pattern at
  `errors.test.ts:210-220`.

`createScoping` from `tests/fixtures/scoping.ts` is **not** used: the 414 trap it exists for binds
filters carrying ~10 000-character values, and an over-max card body is 201 / 1001 characters.
Scoping by the test's own `deck_id` is simpler and sufficient.

Cases:

| # | Claim |
|---|---|
| 1 | `front` at `FRONT_MAX + 1` on create → **card count unchanged (asserted FIRST)**, then `302`, `Location` carries `open=create-card`, decoded `error` **equals** `Przód fiszki musi mieć od 1 do 200 znaków` |
| 2 | `back` at `BACK_MAX + 1` on create → same shape and same order with the `back` literal |
| 3 | **Boundary control**: `front` at exactly 200 and `back` at exactly 1000 → `302` to `/decks/{publicId}`, count +1, and the stored strings re-read at exactly 200 / 1000 characters (not truncated) |
| 4 | **Trim direction**: a 200-character front padded with trailing whitespace is **accepted** and stored at exactly 200 — the mirror image of `/api/generate`'s raw cap, and the case C10X-28's does *not* transfer to |
| 5 | Missing, empty and whitespace-only `front` are one indistinguishable refusal (three sub-cases, same message, no write) |
| 6 | Over-max `front` and `back` on **edit** → the target row `toEqual(before)` column for column (asserted **first**, same reason), then `302` carrying `edit=<cardPublicId>` and the message by equality |
| 7 | **Boundary control on edit**: at exactly the limits the row updates and stores whole |
| 8 | **No echo**: an over-max `front` containing the per-run suffix and a distinctive marker → the **raw** `Location` string contains neither, and the decoded `error` is one of the two project literals |
| 9 | A body that is not a form at all (string body → `Content-Type: application/json`) → a project-owned `302`, not a framework `500`, and no write *(depends on Phase 2)* |
| 10 | A `File` part named `front` → the length refusal, not a `TypeError` `500`, and no write *(depends on Phase 2)* |
| 11 | **Layer independence**: direct RLS-scoped inserts with a 201-character `front` **and** with a 1001-character `back` each fail with `23514` (asserted by code, as `deck_session_size_check` is at `study.test.ts`), with an in-range insert as the positive control. Both sub-cases in one `it()`; the `back` half is the only thing in the suite that observes `flashcard_back_check`'s new upper bound, which breakage run 2 deliberately leaves in place *(depends on Phase 1)* |

Case 1, 2, 6 and 8 assert the message **by equality**, for the reason in Critical Implementation
Details — a `toContain("error=")` assertion would stay green under breakage run 1. Cases 1, 2
and 6 additionally assert the **row oracle before the message**, so the two breakage runs fail on
different assertions and print different strings; that ordering is what makes criterion 4.2
observable at all.

#### 2. The `IDS_MAX` case

**File**: `tests/review/candidates.test.ts`

**Intent**: `IDS_MAX = 100` is the one input bound on `/cards/batch` with no test, and the client
mirrors it as a commented copy rather than an import.

**Contract**: One `it()` inside the existing batch-guard `describe`, following its established
shape: a body with **101** distinct well-formed UUIDs → `400`, `Content-Type: application/json`,
and the seeded card `toEqual(before)`. A 100-id body is not added as a control — the block's
existing successful cases already establish that well-formed bodies are accepted.

#### 3. The auth malformed-body cases

**File**: `tests/auth/errors.test.ts`

**Intent**: Phase 2 changes four production files, and without this the two auth ones ship on
manual verification alone — in a change whose whole thesis is that a server-side refusal must be
asserted rather than assumed. Every piece the cases need already exists: `callEndpoint` sets
`Content-Type: application/json` for a string body (`endpoint.ts:68-70`), this file already drives
`POST /api/auth/signin` and reads its `?error=` param, and `AUTH_VALIDATION_MESSAGE` is already a
member of the exported `AUTH_MESSAGES` closed set.

**Contract**: Two `it()`s beside the existing endpoint case, following its shape — a string body
(so `formData()` rejects) and a `FormData` whose `email` part is a `File`. Each asserts a `302`
whose `Location` is `/auth/signin` with a decoded `error` **equal** to `AUTH_VALIDATION_MESSAGE`,
never a `500` and never an upstream string; the file's existing closed-set assertion then covers
membership for free. No new copy is introduced. A comment states the boundary these cases do
**not** cross: this is malformed-body handling, not an input rule — presence, format and length
rules on auth remain C10X-36's, so a later reader does not conclude auth validation landed here.

### Success Criteria:

#### Automated Verification:

- `npx vitest run tests/validation/cards.test.ts` green, all cases
- `npx vitest run tests/review/candidates.test.ts` green including the new case
- `npm test` green; record the exact new total (baseline is 178 / 15 files — do not predict it, read it from the run)
- `npm run lint` exits 0
- `npx vitest run tests/auth/errors.test.ts` green including the two new malformed-body cases

#### Manual Verification:

- The new file reads as one concern: every case is about a content rule, none about ownership
- No assertion in the file relies on a status alone
- The auth cases read as malformed-body handling, and their comment says so — nobody could mistake them for the input rules C10X-36 owns

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Deliberate-breakage pair and verification record

### Overview

Two runs, because one cannot separate "the endpoint caught it" from "the database caught it" —
which is the whole point of having added the second layer.

### Changes Required:

#### 1. Run 1 — decouple the endpoint's comparison

**File**: `src/pages/api/decks/[publicId]/cards/index.ts` (temporary, never committed)

**Intent**: Prove the test observes the **endpoint's** enforcement. Following C10X-28's rule
(`verification.md:279-285`): never raise the shared constant — `FRONT_MAX` is imported by the
endpoint, three islands, `openrouter.ts` **and the test**, so raising it moves all four together
and the suite stays green while proving nothing.

**Contract**: Replace `> FRONT_MAX` at line 48 with a literal `> 100000`. Predicted: the over-max
create case goes red **on the message equality** (`Nie udało się utworzyć fiszki` instead of the
length literal), because the CHECK now refuses the insert and the endpoint falls into its existing
error branch. Its **count assertion passes first** — and that pass is the evidence that the CHECK,
not the endpoint, absorbed the write. The boundary control stays green.

**Predicted red set: {case 1, case 8}** — not case 1 alone. Case 8 sends an over-max `front`
through the same endpoint and asserts the decoded `error` is one of the two length literals, so it
goes red on the same substitution. Everything else stays green for a stated reason: this edit
touches only the `front` comparison on **create**, so case 2 (`back`), case 6 (edit) and cases
5/9/10 — which trip the untouched `< 1` half — are unaffected, and case 11 asserts the constraint,
which is still in place. Record the observed failure strings and the exact red/green split with its
denominator; if the observed set differs from this one, record what was observed and say so — do
not round it to the prediction (`test-plan.md` §8 carries the precedent).

#### 2. Run 2 — drop the CHECK on top

**Intent**: With both layers disabled, the over-max card must actually be written — which is what
proves the database layer was doing independent work in run 1.

**Contract**: Keep run 1's edit and additionally
`alter table flashcard drop constraint flashcard_front_check` against the live local DB
(`docker exec … psql -i`, per §6.7 — the `-i` flag is load-bearing; a heredoc without it silently
no-ops). Predicted: the same case now fails **earlier and differently** — on its **count**
assertion, which run 1 saw pass. That difference in failure string, not the mere fact of a red, is
what proves the two layers are independent; if run 2 reports the same message-equality failure run
1 did, the count assertion was written after the message and the run proves nothing (see Critical
Implementation Details).

**Predicted red set: {case 1 (on the count), case 8, case 11}.** Case 8 stays red from run 1. Case
11 is the one that matters most here and is easy to overlook: it asserts a direct insert of a
201-character `front` fails with `23514`, so with the constraint gone that insert succeeds and the
case goes red — it is the assertion that most directly observes what run 2 removed. Case 2 and case
6 stay green because only `flashcard_front_check` is dropped, and that asymmetry is deliberate:
case 11's `back` sub-case stays green throughout and is what keeps `flashcard_back_check` observed
while the front one is gone, so the two constraints are never both unobserved at the same moment.
Then, in this order: delete the
row the run wrote (scoped to the run's own deck), re-add the constraint, dump
`pg_get_constraintdef` before/after and `diff`. Re-adding before deleting fails with
`violated by some row`.

#### 3. Verification record

**File**: `context/changes/server-side-validation-test/verification.md`

**Intent**: The evidence `test-plan.md` §6.6 will point at.

**Contract**: Every probe and breakage edit, its observed failure string, its red/green split with
the denominator, the constraint-definition diffs, the cloud row-count check from Phase 1, and
confirmation that `git diff -- src/ supabase/` is empty afterwards.

### Success Criteria:

#### Automated Verification:

- Run 1 turns exactly {case 1, case 8} red, both on the message equality, boundary control green — or the observed set is recorded as observed
- Run 2 turns {case 1 (on the **count**, a different failure string from run 1's), case 8, case 11} red, recorded side by side with run 1's
- After both restores: `npm test` green at the Phase 3 total, `git diff -- src/ supabase/` empty
- `pg_get_constraintdef` before/after diff is empty for both constraints

#### Manual Verification:

- The `verification.md` splits carry their denominators, not just numerators
- The temporary `psql` edit is confirmed applied (a silently no-opped restore is the failure mode §6.6 records)

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Documentation sync

### Overview

Move `test-plan.md` §3 Phase 2 to `complete`, record what the slice does and does not prove, and
correct the "4xx" / "POST/PATCH" wording in all six places.

### Changes Required:

#### 1. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Record the coverage claim with its date and its boundary, and stop the wording that
would send the next contributor after a status code that does not exist.

**Contract**:

- §2 Risk #6 row → **covered 2026-07-28 (C10X-30)**, naming the boundary: the server half is
  asserted, the island mirror is not (§7), and the DB backstop is now a second enforcer.
- §2 Risk Response Guidance row #6 → "gets a 4xx, not a write" becomes a refusal in the caller's
  own convention: a `4xx` on the JSON endpoints, a `302` to an owned error URL on the native-form
  targets — **and no write** in both.
- §3 Phase 2 Status `implementing` → **`complete`**, dated, with the sequencing note rewritten
  from "what it takes to flip" into what landed.
- §6.3's "Validation parity — a **4xx** AND no write" bullet gains the two-convention nuance and
  points at the new subsection.
- New **§6.10 "Adding a test for a redirect-style (native form) endpoint"** — where the `302`
  oracle rule lives: a refusal and a success are the same status, so the row oracle is not
  optional; assert the decoded `error` param by **equality**; never `listFlashcards` as a count
  oracle; `callEndpoint` does not follow redirects.
- New §6.6 entry: **"Phase 2, third slice (`server-side-validation-test`, C10X-30, 2026-07-28)"**
  — the claims table, the traps paid for, the breakage pair with its splits, and an explicit
  "what this does NOT prove" list (island enforcement, the generation write path's own bounds, the
  cloud's data, `PATCH` — which does not exist).
- §7 gains one line: the card islands have **no `maxLength` attribute**, unlike `GeneratorForm`,
  so their over-length branch **is** reachable through the browser — the opposite of the C10X-28
  note directly above it, and worth stating so the two are not read as the same situation.
- §8 Freshness Ledger: a dated entry with the measured suite total and the environment.

#### 2. This change's identity file

**File**: `context/changes/server-side-validation-test/change.md`

**Contract**: `status: complete`, `updated: <date>`; correct "4xx" → 302 and "POST/PATCH" → POST in
the technical-scope paragraph; record that the DB CHECK and the three extra defects were pulled in
by decision during planning, and that auth went to C10X-36.

#### 3. Archived C10X-28 identity file

**File**: `context/archive/2026-07-26-ai-candidate-generation-test-2/change.md`

**Contract**: Append a **dated correction line** to the paragraph at `:52`
("4xx" → the card endpoints answer 302; corrected 2026-07-28 by C10X-30). Do not rewrite the
original sentence — the archive records what was known then, which is the same discipline that
makes `complete` a dated claim.

#### 4. Lessons

**File**: `context/foundation/lessons.md`

**Contract**: One entry: **a refusal expressed as a redirect needs a row oracle and an
equality assertion on its message** — a `302` refusal and a `302` success are the same status, and
a `toContain("error=")` assertion survives a broken guard that falls into a different error branch.
Grounded in breakage run 1.

### Success Criteria:

#### Automated Verification:

- `npm test` green
- `npm run lint` and `npm run build` exit 0
- Every remaining "4xx" hit in `grep -rn "4xx" context/foundation/` is a JSON-endpoint use (`/api/generate`, `/cards/batch`), none a claim about the card create/edit endpoints. This change's own folder is deliberately **out** of the command — its plan, brief and research discuss the wrong wording and must keep saying "4xx"; `change.md:41` is corrected by Phase 5 §2 instead, and the archive by §3

#### Manual Verification:

- §2's Risk #6 row and §6.6's new entry are read together and do not contradict each other
- The archived file still reads as a historical record with a correction, not as a rewritten one
- The Jira description and its two comments are corrected at `/jira-finish-work` (not in this repo)

---

## Testing Strategy

### Unit Tests

None. Every claim here is about an endpoint's behaviour against a real database; there is no pure
function in this change to test. (The `Phase 2` string-only helper is three characters of logic
inside each handler, observed by cases 9 and 10.)

### Integration Tests

`tests/validation/cards.test.ts`, eleven cases; one added case in
`tests/review/candidates.test.ts`; two added cases in `tests/auth/errors.test.ts` — all enumerated
in Phase 3. The auth pair exists so no production file Phase 2 touches ships on manual
verification alone.

### Manual Testing Steps

1. Create a card through the deck page with a 201-character front — the modal stays open with
   "Przód fiszki musi mieć od 1 do 200 znaków" and no request is sent (client guard).
2. Same with exactly 200 — the card is created and the full text is visible.
3. Edit an existing card inline to 1001 characters on the back — the inline editor keeps the
   message; at exactly 1000 the edit saves.
4. Sign in with a wrong password — the message is unchanged from before Phase 2.
5. Against the running dev server, `curl` a `Content-Type: application/json` POST at
   `/api/decks/<id>/cards` — a `302` to the deck page with an owned message, not a `500`.

## Performance Considerations

None material. The two CHECKs are evaluated per row on insert/update of a table whose largest
value measured today is 61 characters; `char_length` on `text` is O(n) on a bounded n. No index or
query plan changes.

## Migration Notes

- The migration is **additive-tightening**: it forbids data that no current row holds (verified
  locally; the cloud must be verified before `db push`). Per `/ship`'s rule an additive migration
  goes to the cloud **before** merge, and the `drift` gate enforces that a committed migration was
  pushed.
- **Rollback** is a second migration restoring `char_length(front) > 0` — never an in-place edit of
  this one, since history is append-only.
- **One behavioural consequence to know about.** `insertCandidates` is a multi-row insert with no
  content validation; if a card longer than the bound ever reached it, the CHECK would now fail the
  **whole batch** rather than that one card. It cannot happen today — `openrouter.ts`'s
  `validate()` drops over-length cards individually using the same constants, and mock mode emits
  short strings — but a future change that loosens `validate()` would turn a partial success into a
  failed generation. Recorded rather than guarded against.

## References

- Research: `context/changes/server-side-validation-test/research.md`
- Change identity: `context/changes/server-side-validation-test/change.md`
- Risk row and phase status: `context/foundation/test-plan.md` §2, §3 Phase 2, §6.6
- The source-text half of the same risk: `context/archive/2026-07-26-ai-candidate-generation-test-2/`
  (`plan.md` Phase 3 — marked MOVED OUT; `verification.md:244-285` — the 414 trap, the
  status-filtered-count trap, and the breakage-decoupling rule)
- Where the constants and the "no DB backstop" decision were made:
  `context/archive/2026-07-09-manual-card-crud/plan.md:140-144`, `plan-brief.md:80-81`,
  `reviews/impl-review.md:72-80`
- The CHECK-promotion precedent: `supabase/migrations/20260724220524_srs_study_schedule_review_fixes.sql:9-20`
- The batch bounds already covered: `tests/review/candidates.test.ts:281-325`
- The boundary-control shape to mirror: `tests/generation/generate.test.ts:577-598`
- The no-echo assertion to mirror: `tests/generation/generate.test.ts:155-183`
- Auth follow-up: Jira **C10X-36** (`auth-input-validation`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database backstop on `front` / `back`

#### Automated

- [ ] 1.1 `npx supabase db reset` applies all migrations cleanly
- [ ] 1.2 `npm run db:types` produces no diff
- [ ] 1.3 `npm test` still green at the pre-change baseline count
- [ ] 1.4 `npm run lint` exits 0

#### Manual

- [ ] 1.5 Cloud checked for violating rows before any `db push` (both counts 0)
- [ ] 1.6 `pg_get_constraintdef` shows the bounded definitions under the original names

### Phase 2: Controlled handling of malformed form input

#### Automated

- [ ] 2.1 `npm test` green, including `tests/auth/errors.test.ts` and the edit round-trip cases
- [ ] 2.2 `npm run lint` exits 0
- [ ] 2.3 `npm run build` exits 0
- [ ] 2.4 `npx vitest run tests/lib/no-logging.test.ts` green

#### Manual

- [ ] 2.5 Card create and inline edit still work in the browser, errors still round-trip
- [ ] 2.6 Sign-in and sign-up unchanged, including a wrong-password error

### Phase 3: The card-content validation test

#### Automated

- [ ] 3.1 `npx vitest run tests/validation/cards.test.ts` green, all cases
- [ ] 3.2 `npx vitest run tests/review/candidates.test.ts` green including the new case
- [ ] 3.3 `npm test` green; exact new total recorded from the run
- [ ] 3.4 `npm run lint` exits 0
- [ ] 3.5 `npx vitest run tests/auth/errors.test.ts` green including the two new malformed-body cases

#### Manual

- [ ] 3.6 The new file reads as one concern — every case is a content rule
- [ ] 3.7 No assertion in the file relies on a status alone
- [ ] 3.8 The auth cases read as malformed-body handling, with the C10X-36 boundary stated in a comment

### Phase 4: Deliberate-breakage pair and verification record

#### Automated

- [ ] 4.1 Run 1 red on {case 1, case 8}, both on message equality, boundary control green
- [ ] 4.2 Run 2 red on {case 1 (count — different failure string), case 8, case 11}
- [ ] 4.3 After both restores: `npm test` green, `git diff -- src/ supabase/` empty
- [ ] 4.4 `pg_get_constraintdef` before/after diff empty for both constraints

#### Manual

- [ ] 4.5 `verification.md` splits carry their denominators
- [ ] 4.6 The temporary `psql` edit confirmed applied, not silently no-opped

### Phase 5: Documentation sync

#### Automated

- [ ] 5.1 `npm test` green
- [ ] 5.2 `npm run lint` and `npm run build` exit 0
- [ ] 5.3 `grep -rn "4xx" context/foundation/` returns only JSON-endpoint uses (this change's folder excluded by design)

#### Manual

- [ ] 5.4 §2 Risk #6 row and §6.6's new entry agree with each other
- [ ] 5.5 The archived file reads as a corrected historical record, not a rewritten one
- [ ] 5.6 Jira description and both comments corrected at `/jira-finish-work`
