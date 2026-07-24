<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: SRS Study Session (S-03)

- **Plan**: `context/changes/srs-study-session/plan.md`
- **Scope**: Full plan — Phases 1–5 of 5
- **Date**: 2026-07-24
- **Verdict**: APPROVED (after triage; original REJECTED)
- **Findings**: 1 critical, 3 warnings, 5 observations — all 9 triaged and fixed

## Verdicts

| Dimension | Verdict (as reviewed) | After triage |
|-----------|-----------------------|--------------|
| Plan Adherence | PASS | PASS |
| Scope Discipline | WARNING | resolved (F8, F9 recorded in the plan's Post-Implementation Notes) |
| Safety & Quality | FAIL | resolved (F1, F3, F4, F5, F6, F7 fixed) |
| Architecture | PASS | PASS |
| Pattern Consistency | PASS | PASS |
| Success Criteria | WARNING | resolved (F2 — the oracle is no longer circular) |

## Automated Verification (run during this review)

| Command | Result |
|---------|--------|
| `npx astro sync` | clean |
| `npm run lint` | PASS (0 errors) |
| `npm run build` | PASS |
| `npm test` | PASS — 7 files, 45/45 |
| `npx vitest run tests/study/schedule.test.ts` | PASS — 6/6 |
| `npx vitest run tests/study/study.test.ts` | PASS — 14/14 |
| `npm run db:types` → `git diff` | no drift |
| `npm run db:reset` | **not re-run** — destructive to the local dev database; the migration is proven applied by the passing integration suite and by the no-drift type regen |

Every automated success criterion in the plan passes. F2 below is why that is
not the same as Risk #3 being covered.

**Re-run after triage**: `npm run lint` PASS · `npm run build` PASS · `npm test`
PASS 7 files / **47** tests (45 before, +1 from F2, +1 from F3) · `npm run db:types`
→ no drift after the follow-up migration was applied with
`npx supabase migration up --local`.

## Findings

### F1 — `learning_steps` is never persisted, so a card rated "Dobre" never leaves Learning

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (schedule correctness — test-plan Risk #3, PRD US-02)
- **Location**: `src/lib/study.ts:56-83`, `supabase/migrations/20260724195248_srs_study_schedule.sql:34-47`
- **Detail**:
  `ts-fsrs@5.4.1`'s `Card` carries a `learning_steps: number` cursor — the field that
  walks a card through `params.learning_steps` (`['1m','10m']`, `enable_short_term: true`
  by default) and eventually graduates it to `State.Review`. `flashcard_schedule` has no
  column for it, `cardToScheduleColumns` never writes it, and `scheduleRowToCard`
  re-derives it from `createEmptyCard` — i.e. **0 on every load**. The comment at
  `study.ts:55` asserts the opposite ("createEmptyCard supplies the derived fields …
  persisted columns override") — `learning_steps` is derived but never overridden.
  `grep -rn "learning_steps" src/ supabase/migrations/` returns only that comment.

  Reproduced against the installed `ts-fsrs@5.4.1`, replaying the app's exact round-trip
  (`scheduleRowToCard → scheduler.next → cardToScheduleColumns`) vs. an in-memory chain,
  from a fresh card at a fixed `now`:

  | Grade repeated | App round-trip | Correct (in-memory) |
  |---|---|---|
  | Dobre (Good) | `Learning` +10 min, **forever** | `Learning` 10 min → `Review` 2 d → 11 d → 60 d → … |
  | Łatwe (Easy) | `Review`, intervals grow | identical ✓ |
  | Powtórz (Again) | `Learning` +1 min | identical ✓ (correct FSRS behaviour) |
  | Trudne (Hard) | `Learning` +6 min | identical ✓ (correct FSRS behaviour) |

  A mixed 9-rating sequence (Good, Good, Again, Good, Hard, Good, Easy, Again, Good)
  diverges from the correct chain at review #2 and never re-converges: the app ends at
  `Review @ 2026-06-04`, the correct chain at `Review @ 2026-06-25`.

  **User-visible effect**: unless the learner presses **Łatwe** on every card, spaced
  repetition does not space. Cards re-enter the due queue ~10 minutes later,
  indefinitely, and the four preview labels the loader computes
  (`listDueCards`, `study.ts:161-166`) read "za 10 minut" on the hundredth review.
  This is verbatim the failure Risk #3 names ("writes the wrong next-review date…
  the schedule stops being trustworthy") and contradicts PRD US-02's "a card the user
  rates as well-known is deferred further than a card they struggle with".

  Both fixes below were verified against the mixed sequence and reproduce the correct
  chain exactly.
- **Fix A ⭐ Recommended**: Turn off short-term scheduling — `enable_short_term: false`
  in the `generatorParameters(...)` at `study.ts:17`.
  - Strength: One line, no migration, no RPC signature change, no type regen. It removes
    the *class* of bug rather than one instance: with short-term off, no step cursor
    participates in scheduling, so the persisted column set becomes complete. It also
    matches the session model this slice actually built — the batch is fetched once and
    the island advances to the end, so a 1 min / 10 min re-queue is never shown inside a
    session anyway.
  - Tradeoff: Product behaviour changes — a card rated Powtórz returns tomorrow, not in
    a minute; intra-day learning steps are gone. Existing `Learning` rows resume on the
    day scale.
  - Confidence: HIGH — verified faithful over a 9-rating mixed sequence including a lapse.
  - Blind spot: Whether intra-day learning steps are wanted is a product call, not a
    technical one; nothing in the PRD requires them. Existing local/prod schedule rows
    would shift scale on their next rating.
- **Fix B**: Persist and round-trip the cursor — `alter table flashcard_schedule add
  column learning_steps integer not null default 0`; add it to `cardToScheduleColumns`,
  to `scheduleRowToCard` (+`DueCardRow`), to the `study_due_cards` return table and
  select list, and to `rateCard`'s `.select(...)` at `study.ts:246`; regen types.
  - Strength: Keeps ts-fsrs's default behaviour intact — full library fidelity, no
    product decision required.
  - Tradeoff: Five coordinated edits across a migration, an RPC signature, the lib, and
    generated types; leaves the "a Card field is not persisted" class open for any field
    a future ts-fsrs version adds.
  - Confidence: HIGH — verified faithful over the same mixed sequence.
  - Blind spot: `elapsed_days`/`scheduled_days` are still not round-tripped; they were
    faithful in every sequence tested, but the class remains.
- **Decision**: FIXED via Fix A — `enable_short_term: false` added at `study.ts:27-29`,
  with the rationale recorded in the scheduler comment and the misleading
  `scheduleRowToCard` comment corrected. Verified red-then-green by F2's new test.

### F2 — The Risk #3 oracle is circular past the first review, so "Risk #3 covered" is overstated

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `tests/study/study.test.ts:341-378`, `tests/study/schedule.test.ts:16-23`, `context/foundation/test-plan.md` §6.6
- **Detail**:
  Every schedule case in the suite performs **exactly one** review of a freshly created
  card. The exact-due oracle builds its expectation by feeding the DB row back through
  the app's own lossy mapper:

  ```ts
  const before = await scheduleOf(a, cardPublicId);   // no learning_steps column
  const expected = scheduler.next(scheduleRowToCard({ ...before }, FIXED_NOW), FIXED_NOW, Rating.Good).card;
  ```

  Oracle and code-under-test drop the same field, so they agree — on the wrong value.
  `schedule.test.ts` has the same blind spot: it asserts ordering across grades for one
  transition of `createEmptyCard(NOW)`, which is the single review F1 does not affect.
  This is precisely the anti-pattern test-plan §2 lists for Risk #3 ("assertion copied
  from the implementation — the oracle problem") wearing the costume of a property test.
  `test-plan.md` §6.6 currently claims Risk #3 is **covered**, with a row reading "The
  written schedule is the right one → exact-due oracle"; that claim does not hold from
  review #2 onward, and 45/45 green is what hid F1.
- **Fix**: Add a multi-review case that chains an **in-memory** card (never re-read from
  the DB) as the independent oracle and asserts the persisted row matches it at reviews
  2 and 3 — e.g. rate the same card Dobre three times with an injected `now` and assert
  the row reaches `srs_state = 2` (Review) with `scheduled_days > 0`. Then restate §6.6's
  Phase 4 row to say what the single-transition oracle does and does not prove.
- **Decision**: FIXED — `tests/study/study.test.ts` gained "stays faithful across
  consecutive reviews, against an oracle kept only in memory" (three chained Good ratings
  vs a `createEmptyCard` chain never round-tripped through the DB). Suite is now 46/46.
  Deliberate-breakage confirmed: reverting F1's fix turns exactly that one case red at
  review 2 (`expected 1780316400000 to be 1780488600000`) while the other 14 stay green —
  including the single-transition oracle, which is the point. `test-plan.md` §6.1 gained
  the "independent source has a sharp edge when the state is stored" rule, and §6.6's
  Phase 4 table now splits "first review" from "every review after it", with the third
  deliberate-breakage check recorded.

### F3 — The accepted-only gate exists only in SQL; `rateCard` has no `state_id` check

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/study.ts:235-240` (and `ensureSchedule`, `study.ts:120`)
- **Detail**:
  The "only accepted cards enter" rule (PRD FR-006, Risk #3) lives in exactly one place:
  `and f.state_id = 2` inside `study_due_cards`. `rateCard` resolves the card by
  `public_id` + `deck_id` with no state filter; the gate holds on the write path only
  *indirectly*, because a non-accepted card has no schedule row and so 404s at
  `study.ts:250`. `study.test.ts:493-505` pins that indirect behaviour.

  It stops holding the moment S-05 (`candidate-review`) lands a reject transition: a card
  that was accepted, studied (row seeded), then rejected keeps its schedule row — so
  `rateCard` would rate a rejected card while `study_due_cards`/`study_due_counts`
  correctly exclude it. `ensureSchedule`'s `.in("public_id", …)` lookup carries no state
  filter either; it is safe today only because its input comes from the gated RPC.
- **Fix**: Add `.eq("state_id", STATE_ACCEPTED)` (import the constant from
  `@/lib/flashcards` rather than redefining `2`) to the resolve query in `rateCard` and to
  `ensureSchedule`'s id lookup — both keep the 404-never-403 shape — plus an `it()` that
  rates an already-seeded card after flipping its `state_id` to 3.
- **Decision**: FIXED — `.eq("state_id", STATE_ACCEPTED)` (imported from `@/lib/flashcards`) added to
  the resolve query in `rateCard` and to `ensureSchedule`'s id lookup, each with a comment
  saying why the redundancy is deliberate. New case in `study.test.ts`: "stops rating a card
  that already had a schedule row and then left `accepted`" — seeds the row first, flips
  `state_id` to 3, asserts 404 and a byte-identical row, then flips back as the positive
  control. Deliberate-breakage confirmed: removing the filter turns exactly that case red
  (`expected 200 to be 404`), the other 15 stay green.

### F4 — The read path rewrites every schedule row on every session load, and a write failure kills the read

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/study.ts:143-148`
- **Detail**:
  `listDueCards` re-seeds the whole batch unconditionally:

  ```ts
  const { error: ensureError } = await ensureSchedule(supabase, data.map((row) => row.public_id), now);
  if (ensureError) return { data: null, error: ensureError };
  ```

  Two consequences. Every `GET /study/[publicId]` issues a `select … in (…)` plus an
  `insert … on conflict do nothing` for up to `session_size` rows even when all of them
  already exist — a wasted round-trip plus per-row speculative-insert churn on a pure
  read, on every page load and every resume. And a transient failure on that *write*
  fails the whole *read*: `[publicId].astro` renders the error page for a session whose
  rows were all already seeded.

  The information needed to avoid it is already in hand — `study_due_cards` returns
  `due` as `NULL` exactly for never-seeded cards, which is why `DueCardRow` widens the
  columns (`study.ts:39-50`).
- **Fix**: Seed only the unseeded rows —
  `const unseeded = data.filter((row) => row.due === null).map((row) => row.public_id);`
  `ensureSchedule` already early-returns on an empty array, so the steady state becomes
  zero writes on the read path. Keep fail-the-read for the genuinely-unseeded case.
- **Decision**: FIXED — `listDueCards` now seeds only `rows.filter((row) => row.due === null)`.
  The generated non-null RPC type is widened to `DueCardRow[]` once at the top of the
  function (the comparison is a type error otherwise), which also removes the duplicated
  nullability comment further down. Steady state is zero writes on the read path.

### F5 — `session_size` has no upper bound in the database

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260724195248_srs_study_schedule.sql:24`, `src/lib/study.ts:196-198`
- **Detail**: `check (session_size > 0)` has no ceiling; the 100 cap lives only in Zod
  (`SIZE_MAX`) and the island. `study.ts:196-198` states the DB CHECK is "the backstop"
  for the endpoint bound, then only half-delivers. The stored value flows straight into
  `p_limit` and into `ensureSchedule`'s insert count. Not reachable by a hostile client
  today (the publishable key is a server-only secret, so there is no direct PostgREST
  path), which is why this is an observation.
- **Fix**: `check (session_size between 1 and 100)` in a follow-up migration, matching `SIZE_MAX`.
- **Decision**: FIXED — in `20260724220524_srs_study_schedule_review_fixes.sql`:
  `deck_session_size_check` dropped and re-added as `check (session_size between 1 and 100)`.
  Verified in the live DB (`CHECK (((session_size >= 1) AND (session_size <= 100)))`).
  `study.ts`'s setSessionSize comment updated to name the real bound and its SIZE_MAX twin.

### F6 — No stable tiebreaker in the due-card ordering

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260724195248_srs_study_schedule.sql:125`
- **Detail**: `order by coalesce(s.due, p_now) asc limit p_limit` — for a deck whose
  accepted cards have never been seeded, every row collapses to the same sort key
  (`p_now`), so which `session_size` cards the `limit` returns is planner-dependent. Two
  loads of the same deck can hand back different subsets. Not corruption (the seeded
  `due` differentiates them next time), but it makes "resume my session" irreproducible
  and any future test of batch composition flaky.
- **Fix**: `order by coalesce(s.due, p_now) asc, f.id asc`.
- **Decision**: FIXED — same migration: `study_due_cards` re-created with
  `order by coalesce(s.due, p_now) asc, f.id asc`. Verified in the live DB, grants
  re-asserted explicitly so the migration is complete on a clean replay.

### F7 — Redundant index on `flashcard_id`; `due` index unusable by either RPC

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260724195248_srs_study_schedule.sql:49-50`
- **Detail**: `flashcard_id` is declared `not null unique`, which Postgres already backs
  with a unique btree index — the explicit `flashcard_schedule_flashcard_id_idx` is a
  duplicate (write + storage overhead). Neither RPC can use a plain index on `due`
  either: both filter on `coalesce(s.due, p_now) <= p_now`, which is not sargable against
  a bare-column index, and both drive from `flashcard` → `flashcard_schedule` on
  `flashcard_id`. Note this came from the plan ("Index `flashcard_id` and `due`"), so it
  is a plan defect faithfully implemented, not implementation drift.
- **Fix**: Drop `flashcard_schedule_flashcard_id_idx`; keep or drop the `due` index
  deliberately (if it is meant for FR-016, say so in the header comment).
- **Decision**: FIXED via option 1 — same migration drops
  `flashcard_schedule_flashcard_id_idx`; the `unique`-backed
  `flashcard_schedule_flashcard_id_key` remains (verified in `pg_indexes`).
  `flashcard_schedule_due_idx` is kept deliberately for FR-016, with that reason written
  into the migration so a future reader does not delete it as unused.

### F8 — `CLAUDE.md` toolkit block swapped on this branch, unrelated to S-03

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `CLAUDE.md` (the `<!-- BEGIN @przeprogramowani/10x-cli -->` managed block)
- **Detail**: The branch replaces ~90 lines of "Module 3, Lesson 1" (`/10x-test-plan`
  orchestrator docs) with "Module 3, Lesson 4 (E2E Tests)" (`/10x-e2e` skill, locator
  rules, DOM-vs-vision, healer boundaries). Nothing in `plan.md` mentions `CLAUDE.md` —
  not in any phase's "Changes Required", not in Progress. It is a toolkit-managed lesson
  swap that rode along on this branch. Mildly ironic against the plan's "No e2e /
  Playwright" line, but documentation only: no Playwright dependency, config, or test
  exists anywhere in the repo.
- **Fix**: Leave it (it is tool-managed, and reverting would only be undone on the next
  toolkit run) — but note it in the change's epilogue so a future reader does not read it
  as S-03 scope.
- **Decision**: FIXED — left in place (tool-managed) and recorded in the new
  "Post-Implementation Notes" section of `plan.md`, stating explicitly that it is not S-03
  scope and does not contradict the plan's "No e2e / Playwright" line.

### F9 — Sidebar edit wider than the contract: the `enabled` flag mechanism was deleted

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/components/Sidebar.astro:10-12, 71-106`
- **Detail**: The plan said "set the `study` item to `href: "/study", enabled: true`".
  The implementation removed the `enabled` flag from all three items and deleted the
  disabled-`<span>` JSX branch entirely (96 lines changed). Net behaviour is what the plan
  asked for, the dead branch genuinely had no remaining user, and the rationale is
  documented in-file. But `Sidebar.astro` is shell — the exact surface the lesson
  "Poleruj tylko własne komponenty slice'a" says to scope-decide *before* building, after
  S-02's F2. Consequence to know: a future disabled nav placeholder must re-add both the
  flag and the branch.
- **Fix**: Accept as-is and record it in the epilogue; the alternative (restoring the
  flag for one item) would leave genuinely dead markup.
- **Decision**: FIXED — accepted as-is and recorded in `plan.md`'s "Post-Implementation
  Notes", including the consequence that a future disabled nav placeholder must re-add both
  the flag and the branch.

## What came back clean

- **Plan adherence**: 0 drift on any contract point across all five phases — two-hop RLS
  policies with `(select auth.uid())` initPlan form and `with check` mirrored on
  insert/update; `revoke all … from anon`; both RPCs `security invoker` + `set search_path
  = ''`; the `state_id = 2` backfill; `ts-fsrs ^5.4.1` pinned; generated types regenerated;
  Zod discriminated union with grade whitelisted as literals 1–4; `expectedReps` threaded
  through island → endpoint → CAS; middleware `PROTECTED_ROUTES` updated; all six Phase-5
  test bullets present; test-plan §3/§6.1/§6.6/§6.7 all updated.
- **Client cannot steer its own schedule**: `now` is a trailing lib parameter that
  `/api/study` never passes; `p_now` is always the server clock; `Rating.Manual` (0) is
  unreachable through the whitelist.
- **The rate compare-and-set is a real fix**, not a deferral, for the lesson
  "Klient↔serwer timeouty + Ponów wymagają idempotencji zapisu": `.eq("reps",
  expectedReps)` under READ COMMITTED re-evaluates after the row lock, `reps` is
  monotonic so a stale version can never re-match, and the re-read correctly separates
  "already applied" (200) from "row gone" (404).
- **Secrets / PII**: no `console.*` in the new study code; every error body is a fixed
  Polish string.
- **404-never-403** honoured in the endpoint, the loader, and the tests.
- **Error-vs-empty** branched in both loaders, and no top-level `return` in `.astro`
  frontmatter — both recorded lessons respected.
- **No N+1**: one `study_due_counts()` for the whole deck picker, one RPC per session build.
- **Migration data safety**: purely additive; `add column … not null default 20` is
  metadata-only on PG11+; `on delete cascade` makes orphans impossible.
- **Scope guardrails**: no `review_log`, no rollback/reschedule/forget, no
  `get_retrievability`, no stats page, no due-date filters, no timeout/abort apparatus in
  the study path, no Playwright, no custom scheduling math.

## Triage Summary

- **Fixed**: F1 (Fix A), F2, F3, F4, F5, F6, F7 (option 1), F8, F9 — all 9.
- **Skipped / Accepted / Dismissed**: none.
- **Verdict after fixes**: REJECTED → APPROVED.

Landed by this triage:

| File | What changed |
|------|--------------|
| `src/lib/study.ts` | `enable_short_term: false` (F1) · `state_id` filter in `rateCard` + `ensureSchedule` (F3) · seed only unseeded rows in `listDueCards` (F4) · corrected mapper/setSessionSize comments |
| `tests/study/study.test.ts` | multi-review in-memory oracle case (F2) · rejected-after-seeding gate case with positive control (F3) — suite 45 → 47 |
| `supabase/migrations/20260724220524_srs_study_schedule_review_fixes.sql` | new: `session_size` upper bound (F5) · `, f.id asc` tiebreaker (F6) · drop duplicate index (F7) |
| `context/foundation/test-plan.md` | §6.1 stateful-oracle rule · §6.6 Phase 4 table split + third deliberate-breakage check |
| `context/changes/srs-study-session/plan.md` | new "Post-Implementation Notes" section (F1 narrative, F8, F9, follow-up migration) |

Both new tests were checked by deliberate breakage, red-then-green, and each turned
exactly one assertion red while every other case stayed green.

**Not done here, deliberately**: the follow-up migration is applied to the local stack
only. It still has to reach the cloud database as its own step — `supabase db push` is
distinct from the app deploy (`lessons.md`, "Cloud migration is a separate step from app
deploy"), and `deck.session_size` now rejects values above 100, so any existing row above
that would have to be squashed first (there are none locally).
