---
change_id: srs-study-session-test
title: Study session — silent rating loss on a lost session + SRS schedule coverage gaps
status: implemented
created: 2026-07-26
updated: 2026-07-26
archived_at: null
---

## Notes

**Scope rewritten 2026-07-26 after the audit** (`research.md`; C10X-27 rewritten to match).
The original brief asked for three Risk #3 tests — deferral by rating, schedule survives a
restart, only `accepted` cards enter. **All three already exist**, shipped by S-03 (C10X-6)
Phase 5 plus its impl-review triage: `tests/study/study.test.ts` (16 cases),
`tests/study/schedule.test.ts` (6). Verified by execution, not by reading the docs: full
suite 69/69, `tests/study` 22/22, no `.skip`/`.only`/`.todo` anywhere. The named candidate
gap (the signed-out path) turned out to be half-closed already — the endpoint's own 401 has
been tested since `f90f9e7`, unrecorded in the test-plan.

This change therefore carries what the audit found _beyond_ the record:

1. **BUG (highest priority) — `rate()` treats a signed-out redirect as success.**
   `POST /api/study` on a lost session → middleware returns a 302 → `fetch` follows it →
   `/auth/signin` renders 200 HTML → `StudySession.tsx:174` checks only `!res.ok` → the card
   advances and the counter climbs with **no write**. The user walks the whole session, sees
   no error, and nothing is scheduled. `rate()` is the only island method in the repo with
   this ordering. Root cause is architectural: middleware answers a JSON endpoint with an
   HTML redirect, so three correct 401 branches are unreachable in production.
   **Scope decision (middleware / client / both) belongs in `/10x-plan`, before building** —
   the middleware fix touches the shell (lessons: decide adjacent scope up front).
2. **`session_size` → batch limit is unobserved.** The page passes `deck.session_size`
   (`study/[publicId].astro:37`); every test passes the literal `20`. The setter is proven,
   the reader is not, and its bounds are untested at all three layers.
3. **"No card is lost" has no test.** Every `listDueCards` call uses `new Date()`; nothing
   advances the clock and re-enters a session to prove a rated card comes _back_ when due.
   The seam exists (`now` is a lib parameter), so this is cheap. Same for the RPC's
   `order by … f.id asc` tie-break and `limit p_limit`.
4. **Only `Good` reaches the database.** `Rating.Again` never takes the write path, so
   `lapses` and the ~~Review → Relearning~~ transition are unproven.
   > Corrected during Phase 2, by execution: **`Relearning` is unreachable in this app.**
   > Under `enable_short_term: false` ts-fsrs runs `LongTermScheduler`, which sends every
   > grade — `Again` included — to `State.Review`; the single `Relearning` assignment
   > lives in a scheduler this config never instantiates. `lapses += 1` is real. The
   > user-facing claim is asserted on `due`/`stability` instead, plus a canary that no row
   > ever carries `srs_state = 3`.
5. **Record corrections.** `enable_fuzz: false` is asserted as configured in three places
   and is not configured anywhere in `src/` — determinism rests on an unpinned ts-fsrs
   default under `^5.4.1`. §6.6's deliberate-breakage counts predate two cases added by
   `e9b8cd9`, and its Phase 1 signed-out note is stale in both directions.

**Scope grew during planning: three of the "recorded not fixed" items were pulled in** and
shipped in Phase 3, because all three sat on surfaces Phases 1–2 already touched:

- `reviewed` now counts real transitions, not every `200` — an `alreadyApplied` reply no
  longer inflates the end-of-session summary.
- `scheduled_days` round-trips on the `rateCard` path instead of being write-only. **This
  is hygiene, not risk closure, and it is NOT the `learning_steps` class** — that one was a
  scheduler *input*, while this column is output-only in ts-fsrs 5.4.1 under either config
  (nothing reads it). Neutrality was confirmed by the exact-`due` oracles staying green.
- A session stuck on a card that left the batch (rejected elsewhere, rated in another tab)
  now offers "Pomiń kartę" on a `404`, keyed off the status rather than the message text.

Still deliberately out of scope, recorded not fixed: the `supabase === null` empty-state
masquerade on the study pages, the `cardsError`-ships-200 status inconsistency, the absent
keyboard affordances (1–4 shortcuts, autofocus), and `elapsed_days` / the RPC's half of the
`scheduled_days` round-trip (both would need a `drop function` migration; both inert today).

**Two gaps this change found and left open, named rather than smoothed over**: the RPC's
`f.id asc` tie-break has no assertion observing its *presence* (only the batch's order —
removing the clause leaves the suite green), and `test-plan.md` §6.6's four-policy neuter has
silently stopped working, because the dev database outgrew PostgREST's `max_rows` and the
`listDueCounts` denial now passes while the guard is fully disabled. Both are written into
`test-plan.md` where they bite; evidence in `verification.md`.

Roadmap: tracked as **H-02** (hardening, post-MVP — not a vertical slice, unblocks nothing).
(source: C10X-27)
