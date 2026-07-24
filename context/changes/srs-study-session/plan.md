# SRS Study Session (S-03) Implementation Plan

## Overview

Deliver the product's north-star slice: a signed-in user studies a chosen deck
in a spaced-repetition session. Only `accepted` cards enter, the `ts-fsrs`
scheduler (FSRS-6, 4-grade) selects cards due today, the user rates recall on
each card, the rating shifts the next-review date, and the schedule survives
between sessions. The hard acceptance condition is a schedule-correctness test
on the F-03 harness (test-plan Risk #3). PRD refs: US-02, FR-011, FR-012.

## Current State Analysis

Grounded in `context/changes/srs-study-session/research.md` (the codebase
baseline for this plan — not re-derived here):

- **No SRS persistence exists.** `flashcard` carries only lifecycle/content
  columns (`state_id`, `source_id`, `front`, `back`, …) — no schedule fields
  (`init_core_schema.sql:57-66`, `database.types.ts:65-76`).
- **`ts-fsrs` is not installed** and imported nowhere (`package.json`, grep of
  `src/` for `fsrs`/`Rating` = zero). S-03 is its first use. Latest published
  version is `5.4.1` (FSRS-6 engine).
- **No `/study` page or study endpoint.** Existing app routes: `auth`, `decks`,
  `decks/[publicId]/cards/*`, `generate`.
- **The "Nauka" nav item already exists but is disabled** (`enabled: false,
  href: null`); the layout `activeItem` union already includes `"study"`
  (`Sidebar.astro:25-31`, `AuthenticatedLayout.astro:7`). S-03 flips it on.
- **RLS is the single lock.** The app carries no `user_id` predicates on read;
  every query is scoped by RLS through an anon-key client + user JWT
  (`supabase.ts`, `preflight.ts` asserts anon-only). Any schema choice that
  breaks RLS scoping is the highest-risk mistake.
- **The F-03 test harness is ready to reuse** (`tests/fixtures/{accounts,
  session,endpoint}.ts`, `tests/setup/preflight.ts`): real accounts, real
  cookie capture, Astro Container API endpoint driver with hand-injected
  `locals.user`, hard local-only/anon-only preflight.

## Desired End State

A signed-in user opens **Nauka**, sees a grid of their decks each showing how
many cards are due, picks one, and studies a bounded session: for each card
they reveal the back, pick one of four rated buttons (each showing its next
interval), and advance. Ratings are persisted to a dedicated schedule table;
re-entering the deck later resumes exactly where the schedule left off. Only
`accepted` cards ever appear. A correctness
test proves — against the real local Postgres, under RLS — that Easy defers
further than Hard, that persisted `due`/`stability`/`difficulty`/`state` match a
direct `ts-fsrs` computation with the same `now`, that the schedule survives a
fresh client, and that non-accepted cards never enter a session.

### Key Discoveries:

- **Two axes named "state" must stay separate columns.** `flashcard.state_id`
  (1 generated / 2 accepted / 3 rejected, lifecycle) is a *different axis* from
  FSRS `State` (0 New / 1 Learning / 2 Review / 3 Relearning, scheduling).
  Risk #3's "only accepted cards enter" is the `state_id = 2` gate
  (`flashcards.ts:42,63-70`); the deferral ordering is pure FSRS. The schedule
  table's FSRS state column is named `srs_state` to make the distinction loud.
- **The Risk #3 oracle is solved by `ts-fsrs`'s explicit `now`.** `next(card,
  now, grade)`, `repeat(card, now)`, `createEmptyCard(now?)` all take `now` as a
  parameter; FSRS is pure/immutable and `enable_fuzz` defaults to `false`
  (`ts-fsrs-api-reference.md:82-89,186`). The library is a deterministic
  independent oracle — the test asserts the *property*, not a copied constant.
- **`createEmptyCard()` initial values are constant literals** (`due=now,
  srs_state=0, stability=0, difficulty=0, reps=0, lapses=0, last_review=null`),
  so a New schedule row can be seeded in pure SQL without importing `ts-fsrs`
  into the migration (`ts-fsrs-api-reference.md:33-48`).
- **Data-access convention** (`decks.ts`, `flashcards.ts`, `generations.ts`):
  every function takes an RLS-scoped `SupabaseClient<Database>`, returns the raw
  `{ data, error }` (no throw, no remap), addresses rows by `public_id`, uses
  `.select(...)` (RETURNING) so a 0-row RLS no-op is distinguishable from
  success. Dates are preformatted server-side (`Europe/Warsaw` `Intl`).
- **`/api/generate` is the JSON-endpoint template** (`generate.ts:37-101`):
  build client → null-check creds (500) → auth guard (401) → JSON parse (400) →
  Zod `safeParse` with whitelisted enums (400) → error-vs-empty on reads. The
  interactive rate→next loop maps to the fetch-JSON `Status` state machine
  (`GeneratorForm.tsx:71,127-161`).

## What We're NOT Doing

- **No custom scheduling math.** All interval logic is `ts-fsrs` (F-02 buy
  decision). We persist and replay its output; we do not tune FSRS weights.
- **No candidate-review / accept-reject UI.** Cards become `accepted` via S-02
  (manual create) today and S-05 later. This slice reads the accepted set; it
  does not change how cards *become* accepted.
- **No `rollback` / `reschedule` / `forget` features**, and **no `review_log`
  history table.** Durability ("no card is lost / survives restart") is proven by
  re-reading the `flashcard_schedule` row itself, which needs no append-only log.
  `review_log` is deferred to the first feature that consumes it (rollback /
  reschedule / per-card review history) — added then, not now.
- **No `get_retrievability` display, no per-card stats page, no due-date
  filters** (FR-016 is nice-to-have, later).
- **No timeout/abort apparatus.** Study is DB-only and fast; the
  `generate.ts` `SERVER_TIMEOUT_MS`/`AbortController` machinery is
  generation-specific and not copied.
- **No e2e / Playwright.** No §3 phase wires it; the correctness signal lives at
  the integration layer per test-plan §4.

## Implementation Approach

Vertical build in five phases, DDL-first so every later layer targets a real
schema. Phase 1 lands all schema (one new table + one column + backfill + the
due-selection/count RPCs) and installs `ts-fsrs`. Phase 2 builds the pure-TS SRS
data-access module (`src/lib/study.ts`) — scheduler config, DB↔`Card` mapping,
and the injectable-`now` rate path. Phase 3 exposes the
JSON `/api/study` endpoint and protects the routes. Phase 4 builds the page,
island, and enables the nav. Phase 5 delivers the hard Risk #3 test and updates
the test-plan cookbook.

## Critical Implementation Details

- **Schedule shape is a separate 1:1 table, not columns on `flashcard`.**
  `flashcard_schedule` keys on a `unique flashcard_id` FK. Its RLS is the
  two-hop `exists` join through `deck.user_id` (copy the `flashcard_*` policy
  shape, `init_core_schema.sql:126-142`) — a schedule row is reachable only by
  the owner of the card's deck. This is the load-bearing correctness constraint:
  get the join wrong and either the owner can't read their schedule or a
  cross-account leak opens.

- **Every accepted card must have a schedule row, and no read may depend on a
  prior write.** Enforced two ways: (a) the Phase 1 migration backfills a New
  schedule row for every existing `state_id = 2` card; (b) `src/lib/study.ts`
  runs an **idempotent `ensureSchedule`** (insert-on-conflict-do-nothing keyed
  on `flashcard_id`) for the capped set at session build, covering cards created
  after the migration without coupling to the S-02/S-05 accept paths. Reads that
  must not write (the deck-picker due-count) treat a *missing* schedule row as
  New/due-now via a `LEFT JOIN` + `coalesce(due, now())`, so a count never
  requires a row to exist first.

- **Injectable `now` is a lib parameter, never client-supplied.** `rateCard(...,
  now = new Date())` and the due-selection RPC (`p_now timestamptz default
  now()`) default to the server clock; the endpoint calls them without `now`.
  The integration test asserts *exact* `due` by calling the lib function with a
  fixed `now` against the real RLS-scoped client (the precedent for driving the
  RLS client directly where no seam exists is `generate.test.ts:108-128`). The
  HTTP endpoint test covers wiring, ordering, persistence, and the accepted
  gate. A client-supplied `now` is rejected on principle (it would let a client
  steer its own schedule).

- **Rating is idempotent via optimistic concurrency (compare-and-set), not a
  bare update.** A rating is a state transition — applying it twice (double
  click, retriable submit, network retry) would advance the schedule twice and
  corrupt exactly what Risk #3 guards (`lessons.md` "Klient↔serwer timeouty +
  Ponów wymagają idempotencji zapisu"). `reps` is the natural monotonic
  optimistic-lock version: every rating increments it by one. The card's public
  view carries its current `reps`; the rate request echoes it as `expectedReps`;
  `rateCard` does a conditional `update flashcard_schedule set <new columns>
  where flashcard_id = <resolved> and reps = expectedReps` (RETURNING). Zero rows
  returned means one of two things, disambiguated by a re-read: the schedule row
  is absent → genuine 404; the row exists but `reps ≠ expectedReps` → the rating
  was **already applied**, so the endpoint returns a benign idempotent `200`
  (current progress, no second transition) rather than re-rating. This closes the
  retry race at the write, independent of any client-side button guard.

- **Preview intervals are computed server-side.** The session loader runs
  `repeat(card, now)` per card and passes four preformatted Polish interval
  labels to the island, keeping it presentational (same rationale as the
  preformatted-date pattern, `flashcards.ts:29-37`). No hydration drift.

## Phase 1: Schema & data foundation

### Overview

Land all persistence for the slice: the `flashcard_schedule` (1:1, mutable)
table, the `deck.session_size` column, the backfill of existing accepted cards,
and the due-selection/count RPCs. Install and pin `ts-fsrs`. Regenerate the DB
types. (No `review_log` — deferred, see "What We're NOT Doing".)

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/<YYYYMMDDHHMMSS>_srs_study_schedule.sql`
(14-digit UTC prefix per convention; generate via `npx supabase migration new
srs_study_schedule`).

**Intent**: Create the schedule table, add the per-deck session limit, backfill
schedule rows for existing accepted cards, and expose the due-card
selection/count functions — all following the established migration template.

**Contract**:
- `flashcard_schedule` — dynamic table (`id bigint generated always as identity
  start with 100000`), `flashcard_id bigint not null unique references flashcard
  (id) on delete cascade`, FSRS columns `due timestamptz not null`, `stability
  double precision not null`, `difficulty double precision not null`, `srs_state
  smallint not null` (0–3, `check`), `reps integer not null`, `lapses integer
  not null`, `last_review timestamptz null`, plus `scheduled_days integer not
  null default 0`, `created_at`/`updated_at` with the `moddatetime` trigger.
  Index `flashcard_id` and `due`. No `public_id` — the row is never externally
  addressed; the card's `public_id` is the handle. RLS: `enable row level
  security`; `revoke all from anon`; `grant select, insert, update, delete to
  authenticated`; policies use the two-hop `exists` join `flashcard → deck →
  (select auth.uid())` in the `(select auth.uid())` initPlan form.
- `deck.session_size integer not null default 20 check (session_size > 0)` —
  the default backfills the populated `deck` table safely (no separate backfill
  needed).
- **Backfill** existing accepted cards: `insert into flashcard_schedule
  (flashcard_id, due, stability, difficulty, srs_state, reps, lapses,
  scheduled_days) select f.id, now(), 0, 0, 0, 0, 0, 0 from flashcard f where
  f.state_id = 2` (New-card literals, no `ts-fsrs`).
- `study_due_cards(p_deck_id bigint, p_now timestamptz default now(), p_limit
  integer default 20)` — `security invoker` (RLS still filters, the
  `search_flashcards_in_deck` precedent, `deck_keyword_search.sql:38-65`), `set
  search_path = ''`, `grant execute to authenticated`. Returns accepted cards in
  the deck that are due, treating a missing schedule row as New/due-now:

  ```sql
  select f.public_id, f.front, f.back,
         s.due, s.stability, s.difficulty, s.srs_state, s.reps, s.lapses, s.last_review
  from public.flashcard f
  left join public.flashcard_schedule s on s.flashcard_id = f.id
  where f.deck_id = p_deck_id
    and f.state_id = 2
    and coalesce(s.due, p_now) <= p_now
  order by coalesce(s.due, p_now) asc
  limit p_limit;
  ```
  A companion function `study_due_counts(p_now timestamptz default now())` —
  `security invoker`, `set search_path = ''`, `grant execute to authenticated`,
  `revoke ... from anon` — backs the deck-picker badge in **one** round-trip for
  **all** the caller's decks (no per-deck N+1): `select d.public_id, count(f.id)
  filter (where coalesce(s.due, p_now) <= p_now) as due_count from public.deck d
  left join public.flashcard f on f.deck_id = d.id and f.state_id = 2 left join
  public.flashcard_schedule s on s.flashcard_id = f.id group by d.public_id`.
  RLS on `deck`/`flashcard` still scopes it to the owner.

**Note on idempotency**: bare `create table` (not `if not exists`) per
convention — `npm run db:reset` replays the whole chain locally; never re-run a
single file.

#### 2. Install `ts-fsrs`

**File**: `package.json`

**Intent**: Add the FSRS library as a runtime dependency, pinned.

**Contract**: `ts-fsrs` at `^5.4.1` under `dependencies`. Run `npm install`.

#### 3. Regenerate DB types

**File**: `src/db/database.types.ts` (generator-owned — never hand-edited,
test-plan §7).

**Intent**: Reflect the new tables, column, and RPC in the typed client.

**Contract**: Produced by `npm run db:types` (`supabase gen types typescript
--local`) after `npm run db:reset`. Flow: write migration → `db:reset` →
`db:types`. Verify `flashcard_schedule`, `deck.session_size`, `study_due_cards`,
and `study_due_counts` appear in the generated `Database` type.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a fresh stack: `npm run db:reset`
- Types regenerate without diff drift beyond the new objects: `npm run db:types`
- Lint + typecheck pass: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- In local Studio, `flashcard_schedule` has RLS enabled and no `anon` grants.
- Backfill created exactly one schedule row per existing accepted card (spot
  check counts).
- `deck.session_size` defaults to 20 on existing decks.

**Implementation Note**: After automated verification passes, pause for manual
confirmation before Phase 2.

---

## Phase 2: SRS domain + lib data-access

### Overview

Build `src/lib/study.ts` — the pure-TS module that configures the scheduler,
maps DB rows to `ts-fsrs` `Card`s, selects due cards with an injectable `now`
and the per-deck cap, applies a rating (persisting the updated schedule), and
formats preview intervals for the UI.

### Changes Required:

#### 1. Study data-access + scheduler module

**File**: `src/lib/study.ts`

**Intent**: Own every SRS query and the scheduler wiring in one module, mirroring
`src/lib/flashcards.ts` conventions (client-arg first, raw `{ data, error }`,
`public_id` handles, RETURNING on writes, preformatted display strings).

**Contract**:
- **Scheduler**: a module-level `fsrs(generatorParameters({ request_retention:
  0.9, maximum_interval: 36500 }))` (FSRS-6 defaults; `enable_fuzz: false`).
- **Mapping**: `scheduleRowToCard(row)` builds a `ts-fsrs` `Card` from a schedule
  row (`due`/`last_review` → `Date`, `srs_state` → `State` via
  `TypeConvert.state`). Because `study_due_cards` LEFT-JOINs the schedule and the
  RPC coalesces only `due`, a never-seeded card comes back with **every other
  FSRS column NULL** — the mapping must coalesce each to its New-card literal
  (`stability`/`difficulty`/`reps`/`lapses` → 0, `srs_state` → `State.New`/0,
  `last_review` → null), not just `due`, so `repeat(card, now)` gets a valid
  `Card`. Inverse persists `Card` fields back to the schedule columns.
- **`listDueCards(supabase, deckId, now, limit)`** → calls the `study_due_cards`
  RPC; for the returned set, runs `ensureSchedule` (idempotent insert for any
  row that was still New/missing) and computes `repeat(card, now)` to attach the
  four preview interval labels. Returns a public view per card (`publicId`,
  `front`, `back`, four preformatted interval labels, and the current `reps` as
  the optimistic-lock version) — no internal `id`.
- **`ensureSchedule(supabase, flashcardIds)`** — idempotent
  insert-on-conflict-do-nothing keyed on the unique `flashcard_id`, seeding
  New-card literals. Safe to call on the read path.
- **`rateCard(supabase, deckId, cardPublicId, grade, expectedReps, now = new
  Date())`** — resolves the card + its schedule row (RLS-scoped,
  `.maybeSingle()`, branch on `error` before `null`→404), runs
  `scheduler.next(card, now, grade)`, then a **compare-and-set**
  `update flashcard_schedule set <new Card columns> where flashcard_id =
  <resolved> and reps = expectedReps` (RETURNING so a 0-row result is visible).
  Zero rows + row still present on re-read ⇒ **already applied** (idempotent, not
  an error); zero rows + no row ⇒ 404. `grade` is the 1–4 `Grade` (Manual/0
  forbidden). Returns the raw `{ data, error }` shape plus an `alreadyApplied`
  signal the endpoint maps to a benign 200.
- **Interval formatting**: a Polish relative-interval helper (e.g. `"za 3 dni"`,
  `"za 10 min"`) built on a fixed `Europe/Warsaw` formatter, used for the four
  button labels.
- **Constants**: reuse `STATE_ACCEPTED = 2` from `flashcards.ts` (do not
  redefine).

### Success Criteria:

#### Automated Verification:

- Typecheck passes (the `ts-fsrs` types resolve): `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- A quick REPL/script exercise (or the Phase 5 unit test, written early)
  confirms `rateCard` with a fixed `now` returns `due` matching a direct
  `scheduler.next` call.

**Implementation Note**: Pause for manual confirmation before Phase 3. The
Phase 5 unit test may be written here (TDD-friendly) since it needs no DB.

---

## Phase 3: Endpoint `/api/study` + route protection

### Overview

Expose a JSON endpoint for the rate→next loop and the per-deck session-size
edit, following the `generate.ts` template, and protect the study routes.

### Changes Required:

#### 1. Study JSON endpoint

**File**: `src/pages/api/study.ts`

**Intent**: Accept a rating (or a session-size change) as JSON and return a
structured result, so the island advances without a page reload.

**Contract**: `POST` only. Build client via `createClient(context.request
.headers, context.cookies)`; null-check creds → `json(500)`; auth guard `if
(!context.locals.user) return json(401)`; parse JSON in try/catch → 400;
validate with a **Zod discriminated union** on `action`:
- `{ action: "rate", deckPublicId, cardPublicId, grade, expectedReps }` —
  `grade` whitelisted to `1|2|3|4`; `expectedReps` a non-negative integer; UUID
  params shape-checked. Calls `rateCard(...)` (server `now`). Returns
  `{ ok: true, progress }`. A stale `expectedReps` (rating already applied) also
  returns a benign `200 { ok: true, alreadyApplied: true, progress }` — never a
  second transition. Error-vs-empty: a genuine `null` card → 404 (never reveal a
  foreign deck); a DB `error` → 500.
- `{ action: "setSessionSize", deckPublicId, size }` — `size` a positive integer
  (whitelist a sane max). Updates `deck.session_size` (RETURNING → 404 if the
  deck isn't the caller's). Returns `{ ok: true, size }`.

Status codes mirror `generate.ts`: 200/400/401/404/500. No timeout apparatus.

#### 2. Protect the routes

**File**: `src/middleware.ts`

**Intent**: Gate the study page and endpoint behind auth (prefix-matched).

**Contract**: Add `"/study"` and `"/api/study"` to `PROTECTED_ROUTES`. `/study`
covers `/study` and `/study/[publicId]`.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` clean (new route), then lint + typecheck pass: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- A signed-out `GET /study` redirects to `/auth/signin`.
- `POST /api/study` with a valid rating against a due card returns 200 and the
  schedule advances (checked in Studio); rating a card in another account's deck
  returns 404.
- `setSessionSize` persists and is reflected on reload.

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: UI — page, island, and nav

### Overview

Build the deck-picker page, the per-deck study session (loader + React island),
the inline session-size control, and enable the "Nauka" nav item.

### Changes Required:

#### 1. Deck-picker page

**File**: `src/pages/study/index.astro`

**Intent**: Land the user on a grid of their decks, each showing how many cards
are due, as the entry to a session.

**Contract**: `<AuthenticatedLayout activeItem="study">`. Loader gets every
deck's due-count in **one** `study_due_counts()` RPC call (not per deck); build
client, guard null inline,
branch error-vs-empty, render a distinct error state; no top-level `return` in
frontmatter. Deck cards link to `/study/[publicId]` (grid idiom from
`decks/index.astro:26-38`). Empty-decks state points to creating/generating
cards.

#### 2. Session page (loader)

**File**: `src/pages/study/[publicId].astro`

**Intent**: Build the initial due-card batch server-side and hand it to the
session island, plus the current `session_size` for the inline control.

**Contract**: Validate the `publicId` route param (UUID regex, malformed → 404).
Resolve the deck; `listDueCards(supabase, deckId, new Date(), deck.session_size)`
with preformatted preview labels; map to a public view (strip internal ids).
Render `<StudySession client:load ...>` with the batch, the deck name, and the
session-size value. Error-vs-empty per the lessons rule; no top-level `return`.

#### 3. Study session island

**File**: `src/components/study/StudySession.tsx`

**Intent**: Run the reveal-back → rate → next loop with a clean end state.

**Contract**: fetch-JSON `Status = "idle"|"pending"|"error"|"done"` state
machine posting `{ action: "rate", ..., expectedReps }` to `/api/study` (the
card's `reps` version travels back for the server-side compare-and-set;
`GeneratorForm.tsx:71,127-161` template). All rating buttons are disabled while
`Status === "pending"` and the card advances only on a `200` — a client-side
guard layered over the server's idempotency, not a substitute for it. Front/back
render echoes
`FlashcardItem.tsx:202-211` (uppercase muted "Przód"/"Tył", `whitespace-pre-wrap
break-words`), back hidden until "Pokaż odpowiedź". Four rating buttons labelled
**Powtórz / Trudne / Dobre / Łatwe** → `grade` `1/2/3/4`, each showing its
preview interval; style via `className` + `cn()` (the `ui/button.tsx` cva has no
Again/Hard/Good/Easy colour set — pick a sensible variant/colour per button).
On the last card, an end-of-session **summary** (count reviewed). A distinct
**empty state** ("Brak kart należnych dziś") when the batch is empty. Round-trip
params (if any) consumed once and stripped via `history.replaceState`
(`FlashcardWorkspace.tsx:73-87`).

#### 4. Session-size control

**File**: `src/components/study/StudySession.tsx` (or a sibling small island)

**Intent**: Let the user set the per-deck session cap at the start of a session.

**Contract**: A small numeric control shown before/at session start that POSTs
`{ action: "setSessionSize", deckPublicId, size }` to `/api/study`; on success,
the new cap governs the next session build. Positive-integer input with a sane
max, mirroring the client-side of the endpoint's Zod bound.

#### 5. Enable the nav item

**File**: `src/components/Sidebar.astro`

**Intent**: Turn "Nauka" from a disabled placeholder into a live link.

**Contract**: Set the `study` item to `href: "/study", enabled: true`
(`Sidebar.astro:25-31`). `activeItem="study"` highlighting is already wired.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` then lint + typecheck pass: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- "Nauka" appears enabled; clicking it lands on the deck grid with correct
  due-counts.
- Picking a deck runs a full session: reveal back, rate, advance; buttons show
  plausible intervals (Easy > Good > Hard > Powtórz).
- Session honours the per-deck cap; changing the size takes effect.
- End-of-session summary and the "brak kart należnych dziś" empty state render.
- No hydration warnings; interval/date strings are stable.

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Risk #3 schedule-correctness test (hard acceptance condition)

### Overview

Prove the schedule is correct and durable on the F-03 harness, then update the
test-plan cookbook and rollout status. This phase is the slice's acceptance
gate.

### Changes Required:

#### 1. Unit test — rating→next-review ordering

**File**: `tests/study/schedule.test.ts`

**Intent**: Assert the deferral property directly against the `ts-fsrs` oracle,
with no DB — the cheapest signal for "harder recall resurfaces sooner".

**Contract**: Configure `fsrs()` exactly as the app (FSRS-6 defaults,
`enable_fuzz:false`), `createEmptyCard(NOW)`, and assert `Easy.due > Good.due >
Hard.due > Again.due` for a fixed `NOW`. Property assertion, not a copied
constant.

```ts
const s = fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 36500 }));
const card = createEmptyCard(NOW);
const due = (g: Grade) => s.next(card, NOW, g).card.due.getTime();
expect(due(Rating.Easy)).toBeGreaterThan(due(Rating.Good));
expect(due(Rating.Good)).toBeGreaterThan(due(Rating.Hard));
expect(due(Rating.Hard)).toBeGreaterThan(due(Rating.Again));
```

#### 2. Integration test — persistence, exact due, restart, accepted-only

**File**: `tests/study/study.test.ts`

**Intent**: Prove the app persists the schedule correctly under real RLS and
that the session gate holds — the hard acceptance condition.

**Contract**: Reuse the F-03 fixtures (`provisionAccounts`, `signInAnd
CaptureCookies`, `clientFor`, `callEndpoint`). Seed an accepted card (via the
real card-create endpoint or a direct RLS-scoped insert), then:
- **Exact due (oracle)**: call `rateCard(clientFor(A), deckId, cardPublicId,
  Rating.Good, FIXED_NOW)`; read the schedule row back via a fresh
  `clientFor(A)` and assert `due`/`stability`/`difficulty`/`srs_state` equal a
  direct `scheduler.next(card, FIXED_NOW, Rating.Good)` — persistence + exact
  mapping (the injectable-`now` lib seam makes this deterministic).
- **Survives restart**: re-read via a brand-new `clientFor(A)` instance
  (= the restart) and assert the schedule columns are unchanged.
- **Idempotent re-rate**: `POST /api/study` `{action:"rate"}` twice with the
  same `expectedReps` applies the transition exactly once — `reps` advances by 1
  (not 2), the persisted schedule equals a single `scheduler.next(...)`, and the
  second call returns `200 { alreadyApplied: true }` with no further change.
- **Ordering through the endpoint**: drive `POST /api/study` `{action:"rate"}`
  with different grades on sibling cards and assert Easy's persisted `due` is
  later than Hard's.
- **Accepted-only gate**: a `generated`/`rejected` card is never returned by
  `study_due_cards` and rating it via the endpoint yields no schedule write.
- **Cross-account (extends Risk #1)**: account B rating account A's card → 404,
  and A's schedule row is unchanged (inline positive control).
- Follow harness conventions: row-based assertions paired with a positive
  control; **404, never 403**; counts scoped by a **file-level**
  `Date.now().toString(36)` namespace (distinct from the per-run id), scoped
  twice (by content and by the test's own deck). Verify by deliberate breakage:
  neuter the accepted gate → confirm a non-accepted card leaks → red.

#### 3. Update the test-plan cookbook and rollout status

**File**: `context/foundation/test-plan.md`

**Intent**: Record how to add SRS tests and mark Risk #3 covered.

**Contract**:
- §3 Phase 4 (SRS schedule correctness): Status → `complete`, change folder →
  `context/changes/srs-study-session/`.
- §6.1: extend with the rating→next-review unit pattern (oracle-property, no DB).
- New §6 cookbook entry for the SRS path: location `tests/study/`, naming by
  resource, reference `tests/study/study.test.ts`, run command, and the
  **injectable-`now`** note (exact-`due` asserted via the lib seam, not a
  client-supplied clock).
- §6.6: a Phase-4 note stating what Risk #3 coverage now means and the
  deliberate-breakage check used.
- Confirm §5's unit+integration gate (already required) now covers the study
  suite.

### Success Criteria:

#### Automated Verification:

- The full suite passes against a running local stack: `npm run db:start` then
  `npm test`
- The new files run in isolation: `npx vitest run tests/study/schedule.test.ts`
  and `npx vitest run tests/study/study.test.ts`
- Lint + typecheck pass: `npm run lint`

#### Manual Verification:

- Deliberate-breakage check performed and reverted: neutering the `state_id = 2`
  gate (or the RLS join) turns a specific assertion red, proving the test
  observes the real behaviour.
- The test-plan §3 Phase 4 row reads `complete` and §6 has a runnable SRS entry.

**Implementation Note**: This is the acceptance gate — the slice is not done
until both test files pass on the harness and the deliberate-breakage check is
confirmed.

---

## Testing Strategy

### Unit Tests:

- Rating→next-review ordering property against the `ts-fsrs` oracle (Phase 5.1).
- Interval-formatting helper (edge units: minutes vs days) — optional, cheap.

### Integration Tests:

- End-to-end schedule persistence, exact `due` with a fixed `now`,
  survives-restart, accepted-only gate, and cross-account denial —
  against the real local Postgres under RLS (Phase 5.2).

### Manual Testing Steps:

1. Enable "Nauka", open the deck grid, confirm due-counts.
2. Study a deck: reveal back, rate each card, confirm intervals order correctly.
3. Re-enter the deck later — confirm the schedule resumed (no reset, no loss).
4. Set a small `session_size`, confirm the session is capped.
5. Confirm a `generated`/`rejected` card never appears in a session.
6. Sign out mid-way, sign back in, resume — schedule intact.

## Performance Considerations

- The due query is a single indexed `left join` bounded by `session_size` — cap
  keeps payloads small. Index `flashcard_schedule.due` and `.flashcard_id`.
- `repeat()`/`next()` are pure in-memory FSRS calls — negligible cost.
- No N+1: the deck-picker due-counts are one `study_due_counts()` RPC for all
  decks; the session batch is one `study_due_cards` RPC; ratings are one
  round-trip each.

## Migration Notes

- `deck.session_size` uses a `default 20`, safe on the populated table.
- `flashcard_schedule` backfill seeds existing accepted cards; new accepted
  cards are covered by `ensureSchedule` at session build.
- Migrations are not idempotent for tables (bare `create table`) — `npm run
  db:reset` is the clean local replay path; never re-run one file.
- Type regen (`npm run db:types`) must follow `db:reset`; CI runs `astro sync`
  and lint fails on stale generated types.

## References

- Research: `context/changes/srs-study-session/research.md`
- FSRS API: `context/archive/2026-07-09-srs-library-choice/ts-fsrs-api-reference.md`
- F-02 decision: `context/archive/2026-07-09-srs-library-choice/srs-library-research.md`
- Test contract: `context/foundation/test-plan.md` §2 Risk #3, §3 Phase 4, §6
- Migration template: `supabase/migrations/20260705180246_init_core_schema.sql`
- RPC precedent: `supabase/migrations/20260712162359_deck_keyword_search.sql:38-65`
- JSON endpoint: `src/pages/api/generate.ts:37-101`
- Data-access convention: `src/lib/flashcards.ts`, `src/lib/decks.ts`
- Loader + island: `src/pages/generate.astro`, `src/pages/decks/[publicId]/index.astro:141-166`
- Harness: `tests/fixtures/{accounts,session,endpoint}.ts`, `tests/setup/preflight.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & data foundation

#### Automated

- [x] 1.1 Migration applies cleanly on a fresh stack: `npm run db:reset` — 4af2146
- [x] 1.2 Types regenerate without drift beyond new objects: `npm run db:types` — 4af2146
- [x] 1.3 Lint + typecheck pass: `npm run lint` — 4af2146
- [x] 1.4 Build passes: `npm run build` — 4af2146

#### Manual

- [x] 1.5 `flashcard_schedule` has RLS on, no anon grants — 4af2146
- [x] 1.6 Backfill created one schedule row per existing accepted card — 4af2146
- [x] 1.7 `deck.session_size` defaults to 20 on existing decks — 4af2146

### Phase 2: SRS domain + lib data-access

#### Automated

- [x] 2.1 Typecheck passes (`ts-fsrs` types resolve): `npm run lint` — a9cbebb
- [x] 2.2 Build passes: `npm run build` — a9cbebb

#### Manual

- [x] 2.3 `rateCard` with a fixed `now` returns `due` matching a direct `scheduler.next` call — a9cbebb

### Phase 3: Endpoint `/api/study` + route protection

#### Automated

- [x] 3.1 `npx astro sync` clean, then lint + typecheck pass: `npm run lint` — f90f9e7
- [x] 3.2 Build passes: `npm run build` — f90f9e7

#### Manual

- [x] 3.3 Signed-out `GET /study` redirects to `/auth/signin` — f90f9e7
- [x] 3.4 `POST /api/study` rate advances the schedule; rating a foreign deck's card → 404 — f90f9e7
- [x] 3.5 `setSessionSize` persists and is reflected on reload — f90f9e7

### Phase 4: UI — page, island, and nav

#### Automated

- [x] 4.1 `astro sync` then lint + typecheck pass: `npm run lint` — c64825a
- [x] 4.2 Build passes: `npm run build` — c64825a

#### Manual

- [x] 4.3 "Nauka" enabled; deck grid shows correct due-counts — c64825a
- [x] 4.4 Full session runs: reveal, rate, advance; intervals order Easy > Good > Hard > Powtórz — c64825a
- [x] 4.5 Session honours the per-deck cap; changing size takes effect — c64825a
- [x] 4.6 End-of-session summary and "brak kart należnych dziś" empty state render — c64825a
- [x] 4.7 No hydration warnings; interval/date strings stable — c64825a

### Phase 5: Risk #3 schedule-correctness test

#### Automated

- [x] 5.1 Full suite passes on a running stack: `npm run db:start` then `npm test`
- [x] 5.2 New files run in isolation via `npx vitest run tests/study/*.test.ts`
- [x] 5.3 Lint + typecheck pass: `npm run lint`

#### Manual

- [x] 5.4 Deliberate-breakage check performed and reverted (gate/RLS neuter → red)
- [x] 5.5 Test-plan §3 Phase 4 reads `complete` and §6 has a runnable SRS entry
