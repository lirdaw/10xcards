# SRS Study Session (S-03) — Plan Brief

> Full plan: `context/changes/srs-study-session/plan.md`
> Research: `context/changes/srs-study-session/research.md`

## What & Why

The product's north-star slice: a signed-in user studies a deck in a
spaced-repetition session. Only `accepted` cards enter, `ts-fsrs` (FSRS-6,
4-grade) picks cards due today, the user rates recall, the rating shifts the
next-review date, and the schedule survives between sessions. Delivering this
proves the hardest guardrail — schedule correctness and durability (Risk #3) —
and the retention thesis. PRD: US-02, FR-011, FR-012.

## Starting Point

Cards, decks, RLS isolation, and the F-03 test harness all exist. What is
missing is all SRS persistence (no schedule columns anywhere), the `ts-fsrs`
library (never installed), and any study page/endpoint. The "Nauka" nav item
exists but is disabled.

## Desired End State

A user opens **Nauka**, sees their decks each with a due-count, picks one, and
studies a bounded session: reveal the back, choose one of four rated buttons
(each showing its next interval), advance. Ratings persist to a dedicated
schedule table; re-entering later resumes the schedule exactly. A correctness
test proves, under real RLS, that Easy defers
further than Hard, that persisted fields match a direct `ts-fsrs` computation
with the same `now`, that the schedule survives a fresh client, and that
non-accepted cards never enter a session.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Schedule storage | Separate 1:1 `flashcard_schedule` table | Isolates the SRS domain; keeps `flashcard` lean (generation_session precedent) | Plan |
| Review history | Defer `review_log` | Durability is proven by re-reading the schedule row itself; add the log when rollback/reschedule needs it | Plan |
| Rating idempotency | Server compare-and-set on `reps` | Applying a rating twice would corrupt the schedule; CAS makes a retry a no-op | Plan |
| Injectable `now` | Server clock + lib-param test seam (never client-supplied) | Enables exact-`due` integration assertions without trusting the client | Plan/Research |
| Rating channel | JSON fetch endpoint `/api/study` | Structured response, no page reload in the rate→next loop | Plan |
| Deck picker | Grid of clickable deck cards + due-count | Consistent with `/decks`; room for the due badge | Plan |
| Button labels | Interval preview on each button via `repeat()` | Standard SRS UX; informed rating | Plan |
| Backfill | Existing accepted cards → New, `due=now` | Matches FSRS New-card semantics; no extra logic | Plan |
| Session cap | Per-deck `deck.session_size` (default 20), editable at start | User-configurable per deck without a full settings surface | Plan |
| Session UX | Reveal-back + end summary + distinct empty state | Complete US-02 flow with closure | Plan |
| Rating copy | Powtórz / Trudne / Dobre / Łatwe | Polish UI mandate (AGENTS.md) | Plan |
| Library version | `ts-fsrs@^5.4.1`; FSRS-6 defaults | Latest stable; `request_retention 0.9`, `max_interval 36500` | Plan |
| Routes | `/study` + `/api/study` (English), label "Nauka" | Follows `/decks` `/generate` convention | Plan |

## Scope

**In scope:** one new table (`flashcard_schedule`) + RLS,
`deck.session_size`, backfill, due-selection/count RPCs, `ts-fsrs` install,
`src/lib/study.ts`, the `/api/study` JSON endpoint, `/study` + `/study/[publicId]`
pages, the study React island, enabling the nav, and the Risk #3 test.

**Out of scope:** custom scheduling math, candidate accept/reject UI (S-05),
user-facing rollback/reschedule/forget, retrievability display, due-date
filters, timeout apparatus, e2e.

## Architecture / Approach

DDL-first vertical build. `flashcard_schedule` keys 1:1 on `flashcard_id`, its
RLS a two-hop `exists` join through `deck.user_id` (the load-bearing correctness
constraint). The `study_due_cards` / `study_due_counts` RPCs (security invoker)
select `accepted` + due cards, treating a missing schedule row as New/due-now so
reads never require a prior write. `src/lib/study.ts` owns the scheduler,
DB↔`Card` mapping, an idempotent `ensureSchedule`, and `rateCard(..., expectedReps,
now = new Date())` which persists the new schedule via a compare-and-set on
`reps` (a repeated rating is a no-op). The page loader builds the first batch
(with server-computed preview intervals); the island posts ratings to
`/api/study`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & data foundation | Table, column, backfill, RPCs, `ts-fsrs` install, types | RLS two-hop join wrong → leak or owner locked out |
| 2. SRS domain + lib | `src/lib/study.ts`: scheduler, mapping, `rateCard` (CAS on `reps`) | `state_id` vs FSRS `srs_state` collision |
| 3. Endpoint + protection | `/api/study` JSON + `PROTECTED_ROUTES` | Unprotected route via prefix-match gap |
| 4. UI + nav | `/study` pages, study island, enable "Nauka" | Hydration drift on intervals; unbounded first session |
| 5. Risk #3 test | Unit ordering + integration persistence/restart/gate | Oracle copied from impl instead of asserting a property |

**Prerequisites:** F-01, F-02, S-02 (all done); running local Supabase stack
(`npm run db:start`).
**Estimated effort:** ~4–5 sessions across 5 phases (`/clear` between).

## Open Risks & Assumptions

- The two-hop RLS join for both new tables must be verified by deliberate
  breakage — a broken policy reads as perfect isolation from the outside.
- `ensureSchedule` on the read path is a controlled write; the deck-picker
  due-count deliberately avoids it via `LEFT JOIN` + `coalesce`.
- Backfill assumes every existing `state_id = 2` card should become due now;
  the per-deck cap limits the first-session size.

## Success Criteria (Summary)

- A user runs a full study session; ratings persist and the schedule resumes
  intact across sessions — no card lost, no reset.
- Only `accepted` cards ever enter a session; harder recall resurfaces sooner.
- The Risk #3 test passes on the F-03 harness (exact `due`, survives restart,
  accepted-only, cross-account 404), verified by deliberate breakage.
