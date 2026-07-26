---
date: 2026-07-26T11:26:41+0200
researcher: lirdaw
git_commit: 8f09518aa66292a38a8915adc442ea60f862153e
branch: C10X-27-srs-study-session-test
repository: lirdaw/10xcards
topic: "SRS schedule correctness (test-plan Risk #3 / rollout Phase 4) — full audit: what is actually handled in code, not what the docs claim"
tags: [research, codebase, srs, study, flashcard_schedule, ts-fsrs, test-plan, risk-3]
status: complete
last_updated: 2026-07-26
last_updated_by: lirdaw
---

# Research: SRS schedule correctness — full audit of Risk #3 / Phase 4

**Date**: 2026-07-26T11:26:41+0200
**Researcher**: lirdaw
**Git Commit**: 8f09518aa66292a38a8915adc442ea60f862153e
**Branch**: C10X-27-srs-study-session-test
**Repository**: lirdaw/10xcards

## Research Question

Cover test-plan Risk #3 / rollout Phase 4 (SRS schedule correctness). But Phase 4 is
already marked `complete` and §6.6 already claims Risk #3 **covered**, so the brief was:
establish what real gap (if any) remains before writing any new test.

Scope as chosen by the requester: **a full audit — verify from the code whether everything
is actually handled, do not trust the records that say it was done.**

## Summary

The headline claim survives, but the surrounding bookkeeping does not, and the audit turned
up **one live production bug that no document anywhere records**.

1. **Risk #3's three named claims are genuinely covered.** 22 tests across
   `tests/study/schedule.test.ts` (6) and `tests/study/study.test.ts` (16). Verified by
   execution, not by reading: full suite **69/69 green**, study files **22/22**, no
   `.skip` / `.only` / `.todo` anywhere in `tests/`. The independent in-memory oracle the
   S-03 impl-review demanded (F2) really is in the file (`study.test.ts:410-460`), not just
   promised in a document.

2. **There is a real, unrecorded production defect on the study path**, and it lands
   directly on Risk #3's own wording ("the schedule stops being trustworthy"):
   `StudySession.rate()` silently discards every rating when the session is gone. A
   signed-out `POST /api/study` is answered by middleware with a **302 to an HTML page**,
   `fetch` follows it, `res.ok` is `true`, and the client advances the card and bumps the
   counter without a single write. The user walks the whole session, sees no error, and
   nothing is scheduled. This is **not** what the test-plan deferred — nobody had named it.

3. **The single most load-bearing untested wire is `session_size` → the batch limit.**
   The page passes `deck.session_size` as the cap
   (`src/pages/study/[publicId].astro:37`), but **every** test call hardcodes `20`. A
   regression to a literal, or to dropping `p_limit`, would be invisible while
   `setSessionSize`'s test kept passing — the setter is proven, the reader is not.

4. **"No card is lost" — the second half of the Risk #3 durability claim — has no test.**
   Every `listDueCards` call in the suite passes `new Date()`; nothing ever advances the
   clock and re-enters a session to prove a card rated today comes **back** when due. The
   seam for it already exists (`now` is a lib parameter), so this is cheap.

5. **Three test-plan statements are factually wrong** and one is stale in both directions.
   Most sharply: §6.1 and both test-file headers assert the app configures
   `enable_fuzz: false`. **It does not** — determinism rests on an unpinned upstream default
   under a `^` range.

6. **Nothing was already done under another change.** Every SRS test file traces to C10X-6
   (S-03); the last touch is `e9b8cd9`. C10X-27 and C10X-6 are two tickets over one body of
   work — the same duplication `jira-map.md` already resolved once for Risk #1 and never for #3.

Bottom line: this change should not start by writing the three tests its `change.md`
describes — they exist. It should close a production bug, one high-value coverage gap
(`session_size` → limit, plus due-re-entry), and correct the record.

## Detailed Findings

### 1. What is actually covered (verified by execution)

```
npm test            → Test Files 8 passed (8), Tests 69 passed (69), 2.08s
npx vitest run tests/study --reporter=verbose → 22 passed
```

Local stack up, `.env` points at `http://127.0.0.1:54321`, `OPENROUTER_API_KEY` unset, no
`.dev.vars` — so preflight's seams (`tests/setup/preflight.ts:132-141`) all held.

§6.6's Phase 4 table, row by row, against the assertions that back it:

| §6.6 claim                            | Verdict                               | Evidence                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deferral follows the rating           | **fully backed** (narrow)             | `schedule.test.ts:20-22` all four grades (library only); `study.test.ts:520` Easy > Hard **persisted**. Through the write path only Easy/Hard are proven.                                                                                                                                                                      |
| Right schedule at the FIRST review    | **partially backed**                  | `study.test.ts:372-378` asserts 7 columns exactly, but its oracle (`:350`) is built by feeding the read-back row through `scheduleRowToCard` — the same computation `rateCard` performs (`src/lib/study.ts:290`). §6.6's prose admits this; the table row does not qualify it.                                                 |
| …and at every review after it         | **fully backed**                      | `study.test.ts:410-460` — oracle from `createEmptyCard` (`:430`), advanced in memory only (`:435`), never round-tripping Postgres or the mapper.                                                                                                                                                                               |
| Schedule survives between sessions    | **partially backed / overstated**     | `:398-407` is two reads on fresh clients, milliseconds apart, same process. Nothing restarts. It proves the value lives in the row — a read-after-write. It does **not** back "no card is lost" (see §4 below).                                                                                                                |
| A retry does not advance the schedule | **fully backed**                      | `:471-474` 0→1, `:482-487` `alreadyApplied`, `:490` row byte-identical.                                                                                                                                                                                                                                                        |
| Only accepted cards enter             | **fully backed — doc understates it** | `:525-544` read gate with inline positive control; `:546-558` 404 + no row; and the strongest case the table omits: `:560-598`, where the schedule row exists first and the card then leaves `accepted` — the only case separating the write gate (`src/lib/study.ts:277`) from the read gate.                                 |
| No cross-account write                | **fully backed**                      | `:246` 404, `:253` column-for-column unchanged. Two caveats: the positive control is a sibling `it()` (`:216`), not inline; and B is stopped at the first gate (`src/pages/api/study.ts:73`), so this proves the composite denial, not the schedule policies independently — consistent with §6.7's "neuter all four at once". |

Anti-pattern sweep found no wrong-state-axis error (`state_id` vs `srs_state` used correctly
throughout), no hard-coded `due`/`stability`/`difficulty` literal anywhere in
`study.test.ts`, and two harmless status-only cases (`:257-268` 400, `:270-283` 401) that
target a bogus UUID so no write was reachable anyway.

### 2. The production bug: `rate()` treats a signed-out redirect as success

`src/components/study/StudySession.tsx:174-179` — read and confirmed first-hand:

```ts
if (!res.ok) {
  const data = (await res.json()) as { error?: string };
  setError(...); setStatus("error"); return;
}
setReviewed((n) => n + 1);
setRevealed(false);
setIndex((i) => i + 1);
```

The chain for a signed-out (or revoked-session) rate:

1. `POST /api/study` → `src/middleware.ts:23-27` → `context.redirect("/auth/signin")` = **302**.
2. `fetch` defaults to `redirect: "follow"`; a 302 on POST is re-issued as GET, body dropped.
3. `/auth/signin` is **not** in `PROTECTED_ROUTES` → renders → **200 `text/html`**.
4. `res.ok === true` → the guard is skipped → card advances, `reviewed` climbs, **no write**.

`rate()` is the **only** island method in the repo with this ordering. Every sibling parses
the body _before_ checking `ok`, so an HTML response throws in `res.json()` and at least
surfaces something: `StudySession.tsx:83-84` (`setSessionSize`, same file),
`GeneratorForm.tsx:161-162`, `FlashcardWorkspace.tsx:123-124`,
`CandidateReviewWorkspace.tsx:115-116`.

The root cause is architectural, not a typo: **middleware answers a JSON endpoint with an
HTML redirect**, pre-empting the endpoint's own correct 401 (`src/pages/api/study.ts:52-55`).
That 401 is well written and can never run in production. `/api/generate` and
`/api/decks/[publicId]/cards/batch` share the shape.

Likelihood is moderate, not high: `@supabase/ssr` refreshes the token during middleware's
`getUser()`, so ordinary access-token expiry is handled. The live triggers are sign-out in
another tab, a revoked/expired refresh token, or a deleted user. Verified by reading the
code path plus Fetch redirect semantics — **not** reproduced in a browser.

Two candidate fixes, not mutually exclusive: a `context.url.pathname.startsWith("/api/")`
branch in the middleware returning 401 JSON (makes the endpoint contract honest for all
three JSON endpoints), and/or checking `res.redirected` / parsing before `ok` in `rate()`
(matches the other four islands).

### 3. `session_size` → `p_limit`: wired, load-bearing, unobserved

Verified end to end in the source:

```
src/pages/study/[publicId].astro:37   listDueCards(supabase, deck.id, new Date(), deck.session_size)
src/lib/study.ts:208                  getStudyDeck …select("id, public_id, name, session_size")
src/lib/study.ts:157-162              rpc("study_due_cards", { p_deck_id, p_now, p_limit: limit })
```

Every test call passes the literal `20` — `tests/study/study.test.ts:104`, `:531-536`, and
`tests/review/candidates.test.ts:626`. No test creates more due cards than the limit, and no
test asserts "deck with `session_size = 3` and 5 due cards returns exactly 3".
`study.test.ts:601-618` proves only that the column holds `7`.

The related bounds are equally unobserved: the DB CHECK `session_size between 1 and 100`
(`20260724220524_srs_study_schedule_review_fixes.sql:16-20`, itself an S-03 impl-review fix),
the endpoint's Zod `min(1).max(100)` (`src/pages/api/study.ts:34`), and the client mirror
`SIZE_MIN`/`SIZE_MAX` (`StudySession.tsx:18-19`) — only the legal value `7` is ever written.

### 4. "No card is lost" and the batch's ordering

The final RPC (`20260724220524_srs_study_schedule_review_fixes.sql:59-67`, quoted verbatim):

```sql
  where f.deck_id = p_deck_id
    and f.state_id = 2
    and coalesce(s.due, p_now) <= p_now
  order by coalesce(s.due, p_now) asc, f.id asc
  limit p_limit
```

- The `f.id asc` tie-break is deterministic **by design** — the migration records that
  without it, an all-unseeded deck collapses every sort key to `p_now` and `LIMIT` became
  planner-dependent. **No test asserts the ordering**; every assertion uses
  `find`/`toContain`.
- A never-seeded card coalesces to exactly `p_now` — the _maximum_ admissible key — so brand
  new cards sort **after every overdue seeded card**. In a deck with more overdue cards than
  `session_size`, new cards do not appear until the backlog clears. Product behaviour, not a
  bug, and untested.
- **Nothing re-enters a session at a future clock.** `listDueCards` takes `now` as a
  parameter, so proving "a card rated today comes back when due, and is not lost" is cheap
  at the lib layer — exactly the seam §6.7 documents for the exact-`due` oracle.

### 5. Grades: only `Good` ever reaches the database

Confirmed by grep over `tests/study/study.test.ts`: every persistence-path rating is
`RATING.GOOD`, except `:507`/`:512` (Easy and Hard, once each, for the ordering property).
**`Rating.Again` (grade 1) never touches the write path at all.** Consequences:

- `lapses` is never asserted against an oracle anywhere — only inside `toEqual`
  self-comparisons (`:253`, `:401`, `:490`, `:584`).
- The lapse transition (Review → Relearning, `lapses + 1`) — i.e. the "hard card resurfaces
  sooner" half of PRD US-02 — is unproven through persistence.

### 6. `enable_fuzz` — the docs assert a configuration that does not exist

`src/lib/study.ts:28-30`:

```ts
export const scheduler = fsrs(
  generatorParameters({ request_retention: 0.9, maximum_interval: 36500, enable_short_term: false }),
);
```

There is **no `enable_fuzz` anywhere in `src/`**. Fuzz is off solely because
`default_enable_fuzz = false` in ts-fsrs (`node_modules/ts-fsrs/dist/index.cjs:507`,
`dist/index.d.ts:379`), installed at 5.4.1 under `"ts-fsrs": "^5.4.1"` (`package.json:40`).
Three places state otherwise as fact: `context/foundation/test-plan.md:177`,
`tests/study/schedule.test.ts:7`, `tests/study/study.test.ts:337`.

An upstream default flip inside the caret range would make `study.test.ts:372` and `:443`
intermittently red with no change in this repo. One-line fix; the exact-due oracles are the
thing that depends on it.

### 7. `scheduled_days` is written but never read — the same class as the bug that shipped

`cardToScheduleColumns` writes it (`src/lib/study.ts:97`), `newScheduleColumns` seeds `0`
(`:125`) — but `rateCard`'s re-read (`:284`) does not select it, and `DueCardRow` (`:52-63`)
has no such field, so `scheduleRowToCard` always leaves `createEmptyCard`'s `0`. Grep
confirms no read anywhere in `src/`.

Currently **inert**, verified at library level rather than assumed: with
`enable_short_term: false` the `LongTermScheduler` zeroes the incoming card's
`scheduled_days` and `elapsed_days` before computing
(`node_modules/ts-fsrs/dist/index.cjs:1183-1184`). This is precisely the class S-03's
impl-review F1 caught for `learning_steps` — a Card field whose column never round-trips —
and its own Fix B blind spot says so: _"`elapsed_days`/`scheduled_days` are still not
round-tripped … the class remains."_ Masked by config, not removed.

### 8. The signed-out path — narrower than the docs say, in both directions

- **The middleware guard is correct and complete.** `PROTECTED_ROUTES`
  (`src/middleware.ts:4`) covers `/study`, `/study/[publicId]` and `/api/study`; note
  `/study` does **not** prefix-match `/api/study`, so the separate entry is load-bearing. No
  study route is missed; no non-study route is caught by accident. It has **zero** automated
  coverage — and it is cheaply testable: `onRequest` is an ordinary exported function taking
  a fabricable context, so a table-driven unit test over `PROTECTED_ROUTES` needs neither a
  container nor a database.
- **The endpoint's own 401 branch IS already tested** — `tests/study/study.test.ts:270-283`
  via a local `studySignedOut` helper (`:190-201`) that bypasses `callEndpoint`'s hardcoded
  `locals` with `locals: { user: null }`. `git log -S` places it in
  `f90f9e7 feat(C10X-6): … (p3)` — it shipped with the endpoint in Phase 3, was never in the
  plan's Phase 5 bullets, and was never recorded in the test-plan.
- So §6.6's Phase 1 note (`test-plan.md:386-393`) is stale **both ways**: it overstates the
  gap (the 401 branch is covered for `/api/study` and `/api/generate`) and understates it
  (nobody named the consequence in §2 above). What genuinely remains is the middleware guard
  and the two `.astro` page loaders.

### 9. Zero-coverage inventory beyond the above

Ranked, from the SQL/page/island sweep:

1. Every page loader branch (16 across `study/index.astro` and `study/[publicId].astro`) —
   pages are deliberately not rendered (§6.4), so this is zero by construction. Two
   deviations worth naming regardless of coverage:
   - The `supabase === null` path is folded into the empty/404 branch
     (`index.astro:14-15`, `[publicId].astro:24`), so a missing secret renders "Nie masz
     jeszcze talii do nauki" / "Nie znaleziono talii" — a config failure wearing the
     empty-state costume. Satisfies the letter of `lessons.md:68-73` (it does branch on
     `error`) and violates its spirit.
   - Status inconsistency: `deckError` sets 500 (`[publicId].astro:25-26`), `cardsError`
     sets nothing (`:36-42`) — the error page for a failed batch query ships **HTTP 200**.
2. The whole island outside `rate()`: empty state, finished state, progress counter, reveal
   toggle, `SessionSizeControl`'s four fetch branches and its validation.
3. **`reviewed` counts every `200`, including the benign `alreadyApplied: true`**
   (`StudySession.tsx:182` vs `src/pages/api/study.ts:113`) — the end-of-session summary can
   overstate what was actually rescheduled.
4. **Stuck-on-404 desync**: the batch is a load-time snapshot. A card rejected in the review
   screen or rated in another tab returns 404 → error banner, no advance, **and there is no
   skip affordance** — the session is stuck on that card until reload.
5. **No keyboard affordance exists at all** in the session island — no `onKeyDown`, no 1-4
   shortcuts, no autofocus. A gap against the PRD's baseline-keyboard NFR, not merely
   untested.
6. `flashcard_schedule` constraints: cascade delete, the 1:1 unique violation,
   `check (srs_state between 0 and 3)`, `scheduled_days default 0`.
7. The schedule's `moddatetime` trigger is **unqualified** (`before update on
flashcard_schedule`) and `updated_at` is never selected — contrast the _flashcard_
   trigger, narrowed by `20260725112700` and tested at `candidates.test.ts:577-609`.
8. `flashcard_schedule_delete` policy + DELETE grant are dead surface (no code path deletes
   a schedule row — orphans are kept on purpose); cross-account INSERT is unproven.
9. Function ACLs have no automated coverage. §6.6's "cosmetic gap" note is slightly off: an
   anon call to `study_due_cards` fails with _permission denied for table flashcard_
   (`init_core_schema` revokes it) rather than returning zero rows under RLS. Safe either
   way.
10. Selective mutation testing has never touched this path — `stryker.config.json`'s
    `mutate` list is `["src/pages/api/generate.ts", "src/lib/generations.ts"]` only.

### 10. Documentation defects found (the record vs the code)

| Statement                                                                             | Where                                                         | Reality                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "the app configures it with `enable_fuzz: false`"                                     | `test-plan.md:177`; `schedule.test.ts:7`; `study.test.ts:337` | No `enable_fuzz` in `src/`; relies on an unpinned upstream default (§6)                                                                                                                                                                             |
| "the other 13 cases stayed green" (14 total) / "the other 14 … stay green" (15 total) | §6.6 Phase 4 breakage notes                                   | `study.test.ts` now holds **16** `it()`s — `e9b8cd9` added two _after_ the 2026-07-24 note. **No recorded deliberate-breakage run has been executed against the current file**; the `45/45` / `46/46` figures are superseded (suite is 69/69 today) |
| "Not covered, deliberately — the whole signed-out path"                               | §6.6 Phase 1, `test-plan.md:386-393`                          | Stale both ways (§8)                                                                                                                                                                                                                                |
| §6.6 Phase 4 table, "survives between sessions"                                       | `test-plan.md:489`ff                                          | Backs read-after-write, not "no card is lost" (§4)                                                                                                                                                                                                  |
| §6.6 Phase 4 table, "only accepted cards enter"                                       | same                                                          | Understates: omits the strongest case, `:560-598`                                                                                                                                                                                                   |

## Code References

- `src/lib/study.ts:28-30` — the configured scheduler; no `enable_fuzz`
- `src/lib/study.ts:73-84` — `scheduleRowToCard`, coalescing every NULL column
- `src/lib/study.ts:89-99` — `cardToScheduleColumns`; writes `scheduled_days`
- `src/lib/study.ts:138-151` — `ensureSchedule`, idempotent seed, own `state_id` gate
- `src/lib/study.ts:157-202` — `listDueCards`: RPC → seed unseeded → preview intervals
- `src/lib/study.ts:257-316` — `rateCard`: resolve (deck + accepted) → read → `next()` →
  compare-and-set on `reps` → disambiguating re-read
- `src/lib/study.ts:284` — the re-read that omits `scheduled_days`
- `src/pages/api/study.ts:46-114` — the two-action endpoint; 401 at `:52-55`, deck resolution
  and error-before-null at `:73-79`
- `src/pages/study/[publicId].astro:37` — `deck.session_size` as the batch cap
- `src/components/study/StudySession.tsx:155-190` — `rate()`; the `!res.ok` inversion at `:174`
- `src/components/study/StudySession.tsx:83-84` — the correct ordering, same file
- `src/middleware.ts:4`, `:23-27` — `PROTECTED_ROUTES` and the HTML redirect
- `supabase/migrations/20260724195248_srs_study_schedule.sql:34-95` — table, index, trigger,
  backfill, four RLS policies
- `supabase/migrations/20260724220524_srs_study_schedule_review_fixes.sql:16-20`, `:59-67` —
  the `between 1 and 100` CHECK and the final RPC with its tie-break
- `tests/study/schedule.test.ts:16-23` — the four-grade ordering property
- `tests/study/study.test.ts:341-378` — first-review oracle (mapper-round-tripped)
- `tests/study/study.test.ts:410-460` — the independent in-memory chained oracle
- `tests/study/study.test.ts:190-201`, `:270-283` — the signed-out 401 case
- `tests/study/study.test.ts:560-598` — accepted → studied → un-accepted, with inline control
- `tests/fixtures/endpoint.ts:11-17`, `:78-83` — no middleware, `locals.user` always injected
- `stryker.config.json` — `mutate` list excludes the whole study path

## Architecture Insights

- **The `now` seam is the whole testability story.** `rateCard`/`listDueCards`/`listDueCounts`
  take `now` as a trailing parameter, the endpoint never accepts it from the client
  (`src/pages/api/study.ts:94-102`). Exact-`due` and future-clock assertions are therefore
  possible at the lib layer and impossible over HTTP — by design, and the design is right.
- **Two independent gates enforce accepted-only**, and both are needed: the RPC's
  `f.state_id = 2` on the read, `.eq("state_id", STATE_ACCEPTED)` on the write
  (`src/lib/study.ts:277`). They must both exist because a card can be accepted, studied
  (row seeded), then rejected — S-03's impl-review F3 anticipated S-05 landing exactly that.
- **Persisting a schedule row rather than a `Card` is the recurring hazard.** Any ts-fsrs
  `Card` field without a column is silently re-derived on every load. That shipped once as a
  real bug (`learning_steps`, cards pinned in Learning at +10 min forever), was fixed by
  removing the field from the calculation (`enable_short_term: false`) rather than by adding
  the column — so the _class_ is still open for `scheduled_days`/`elapsed_days`.
- **Middleware and JSON endpoints disagree about the auth contract.** Guards return
  `redirect`; JSON endpoints return 401. The redirect wins, so three well-written 401
  branches are unreachable in production and one client trusts `res.ok`. This is a shell-level
  contract, not a study-specific slip.
- **Idempotency is uniform across the app.** `reps` as an optimistic-lock version here,
  `idempotencyKey` on generation — both answer a benign `200` rather than erroring.

## Historical Context (from prior changes)

- `context/archive/2026-07-24-srs-study-session/reviews/impl-review.md` — APPROVED after
  triage; 9 findings, **all FIXED, none deferred**. F1 (CRITICAL) is the `learning_steps`
  bug: _"App round-trip `Learning` +10 min, forever"_, fixed by `enable_short_term: false`.
  F2 is the circular oracle: _"the Risk #3 oracle is circular past the first review, so
  'Risk #3 covered' is overstated"_ — fixed by adding the in-memory chained case and by
  amending §6.1/§6.6. Fix B's own blind spot: _"`elapsed_days`/`scheduled_days` are still not
  round-tripped … the class remains."_
- Same file, "Not done here, deliberately": the follow-up migration
  `20260724220524_…` was applied to the **local stack only**; `supabase db push` to cloud is
  a distinct step. Later slices shipped `20260725*` migrations, so a subsequent `db push`
  would have carried it — **unverified from here** (needs live prod access), so treat it as
  open until confirmed at ship.
- `context/archive/2026-07-24-srs-study-session/plan.md:78-96` — deliberate non-goals still
  standing: no `review_log` (deferred to its first consumer: rollback / reschedule / per-card
  history), no `get_retrievability`, no due-date filters (FR-016), no e2e.
- `context/archive/2026-07-15-verification-harness/reviews/impl-review.md:133-147` — F5, the
  signed-out deferral. Fixed **as documentation of negative space**, not as coverage. Its
  plan also predicted the prefix-match trap: _"a future route (e.g. `/api/study`) that is not
  added to the array is unprotected and nothing would catch it. Accepted for this phase;
  worth revisiting when Phase 4's SRS routes land."_ Phase 4 landed; nothing was revisited.
- `context/archive/2026-07-25-candidate-review/` — consumes the schedule and confirms S-03's
  decisions (cascade FK, orphaned schedule rows kept on purpose). Contradicts nothing.
- `context/foundation/roadmap.md:158-168`, `:264` — S-03 `done`, Outcome explicitly promises
  _"żadna karta nie ginie, harmonogram się nie psuje"_. The first half is the one this audit
  finds unproven (§4).
- `context/foundation/jira-map.md:18`, `:29` — `S-03 → C10X-6` and `#3 → C10X-27` are two
  tickets over one body of work. `jira-map.md:59-60` already resolved the identical situation
  for Risk #1 (_"Risk #1 maps to the EXISTING F-03 issue … No separate risk ticket"_) and
  never did for #3.

## Related Research

- `context/archive/2026-07-24-srs-study-session/research.md` — the S-03 exploration that
  produced this surface (incl. the `PROTECTED_ROUTES` note at `:226-231`)
- `context/archive/2026-07-09-srs-library-choice/srs-library-research.md` — the ts-fsrs / FSRS
  4-grade decision (PRD Open Question 2)
- `context/archive/2026-07-18-ai-candidate-generation-test/` and
  `context/archive/2026-07-18-mutation-generate-risk2/` — the precedent for a
  characterization-then-inversion test and for narrowed mutation testing

## Open Questions

1. **Is the C10X-27 ticket the right vehicle at all, or should it be closed as covered by
   C10X-6 (the Risk #1 precedent) and the real findings re-filed?** The three tests its
   `change.md` asks for exist. This is a call for the requester, not for research.
2. **Is the `rate()` redirect bug fixed in the middleware, in the client, or both?** The
   middleware fix repairs all three JSON endpoints at once but touches the shell — which
   `lessons.md:96-101` says to scope _before_ building, not after.
3. **Was `20260724220524_srs_study_schedule_review_fixes.sql` actually pushed to cloud?**
   Not observable from the repo; needs `supabase migration list` against the linked project.
4. Should the `supabase === null` empty-state masquerade on the study pages be fixed here or
   filed separately? It is a project-wide loader pattern, not an SRS defect.
5. Does the never-seeded-cards-sort-last consequence (§4) need a product decision, or is
   "clear the backlog first" the intended behaviour?
