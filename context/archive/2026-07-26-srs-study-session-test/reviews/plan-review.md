<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Study session — silent rating loss + SRS schedule coverage gaps

- **Plan**: `context/changes/srs-study-session-test/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-26
- **Verdict**: REVISE → SOUND after triage (all 7 findings fixed in plan.md / plan-brief.md, 2026-07-26)
- **Findings**: 2 critical, 3 warnings, 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | FAIL    |
| Lean Execution        | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

Both CRITICALs have narrow, targeted fixes; the approach itself holds, which is why
this is REVISE rather than RETHINK.

## Grounding

9/9 existing paths ✓ (4 planned-new paths confirmed absent), 9/10 symbols ✓
(`PROTECTED_ROUTES` is not exported → F4), brief↔plan ✓, Progress↔Phase mechanical
contract ✓ (one `## Progress`, 5 phases matched, 24 criteria ↔ 24 numbered bullets,
no stray checkboxes in phase bodies).

`docs/reference/contract-surfaces.md` does not exist — contract-surface check skipped.

Verified directly (no sub-agent, per session rule): `rateCard`'s exact span
(`src/lib/study.ts:257-316`), both ts-fsrs scheduler classes in the installed 5.4.1,
the `study_due_cards` definition in `20260724220524`, every `fetch(` call site and
every native form target in `src/`, and a smoke test proving `astro:middleware`
resolves under `getViteConfig()` (so Phase 1 §4's approach is viable).

## Findings

### F1 — Blanket `/api/*` 401 breaks six native-form flows

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1 (the middleware guard) + Phase 1 §4 (guard coverage)
- **Detail**: The contract is `pathname.startsWith("/api/")` → 401 JSON. Only three
  protected `/api/*` paths are fetch-driven — exactly the three the Desired End State
  names. The rest are native `<form method="POST">` targets under the `/api/decks`
  prefix: `/api/decks` (`CreateDeckModal.tsx:61`), `/api/decks/{id}`
  (`DeckActions.tsx:78-79`), `/api/decks/{id}/delete` (`DeckActions.tsx:126`),
  `/api/decks/{id}/cards` (`CreateFlashcardModal.tsx:76-77`),
  `/api/decks/{id}/cards/{card}` (`FlashcardItem.tsx:108-109`,
  `CandidateItem.tsx:123-124`), `/api/decks/{id}/cards/{card}/delete`
  (`ConfirmDeleteModal.tsx:21`). These are full-page navigations: today a signed-out
  submit hits the 302 and lands on the sign-in page; after this change the browser
  renders `{"error":"Nie jesteś zalogowany"}` as a dead-end page. The trigger is this
  change's own scenario — session expires in tab 2, user clicks "Zapisz" in the
  rename-deck modal. Worse, Phase 1 §4's test contract ("for each protected prefix
  assert an `/api/*` path answers 401 JSON") would enshrine the regression.
- **Fix A ⭐ Recommended**: Discriminate on the caller, not the path — all three fetch
  sites send `Content-Type: application/json` and no native form does; combine with
  `Accept`/`Sec-Fetch-Dest`.
  - Strength: Removes the class as intended without collateral; a future JSON endpoint
    is handled with no list to maintain.
  - Tradeoff: Header negotiation is a heuristic; a GET fetch with no body would rely on
    the `Accept` half.
  - Confidence: HIGH — every fetch and every form target in `src/` enumerated; the split
    is clean.
  - Blind spot: Not verified against a non-browser client (none exists today).
- **Fix B**: Explicit JSON-endpoint allow-list beside `PROTECTED_ROUTES`.
  - Strength: No heuristics; matches the Desired End State's three endpoints exactly.
  - Tradeoff: `/api/decks/[publicId]/cards/batch` is dynamic so it needs a regex, and a
    second array is the same "someone forgets to add the route" trap Phase 1 §4 exists
    to close.
  - Confidence: HIGH — narrow and mechanical.
  - Blind spot: Silently reverts to the broken behaviour for any JSON endpoint added
    later and not listed.
- Either way, Phase 1 §4's table must assert the deck form endpoints still get a 302.
- **Decision**: FIXED via Fix A (caller-based discriminator; two guard-table rows added)

### F2 — Phase 2's lapse assertion targets a state this app cannot reach

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §4 (Every grade takes the write path)
- **Detail**: The contract says "rate `Again` and assert `lapses` incremented by exactly
  one **and `srs_state` is `Relearning`**". Under `enable_short_term: false` ts-fsrs uses
  `LongTermScheduler`, whose `next_state` sets every grade — Again included — to
  `State.Review` (`node_modules/ts-fsrs/dist/index.cjs:1271`). `State.Relearning` is
  assigned only by `BasicScheduler.reviewState` (`:1102`), which this app never
  instantiates. `srs_state` can only ever be 0 or 2, so the assertion cannot pass. The
  `lapses += 1` half is real (`:1237`). This is not confined to the test: "Review →
  Relearning" is stated as fact in Current State Analysis, in the brief, and in
  `test-plan.md` §6.7's trap bullet, which Phase 4 (d) would copy forward — a change
  whose stated purpose is "no false statement in `test-plan.md`" would ship a new one.
- **Fix**: Re-anchor the lapse case to what the scheduler actually does — assert `lapses`
  +1, and `due`/`stability` after Again strictly below the same card's Good, both against
  the in-memory oracle; correct the three prose sites; make Phase 4 (d) fix §6.7's bullet
  rather than repoint it.
  - Strength: Keeps the user-facing claim ("a hard card resurfaces sooner") and asserts it
    where it is observable; the four-grade matrix in the same section already provides the
    mechanism.
  - Tradeoff: Loses a state-machine assertion that would have been a canary if
    `enable_short_term` ever flips.
  - Confidence: HIGH — traced through both scheduler classes in the installed 5.4.1;
    `State.Relearning` has exactly one assignment site.
  - Blind spot: None significant. If the canary is wanted, add a separate assertion that
    `srs_state` is never 3 under this config.
- **Decision**: FIXED via Fix + canary (lapses & relative due/stability; `srs_state != 3` canary; 3 prose sites corrected)

### F3 — Phase 1 "pins" a signature Phase 3 must break

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2 vs Phase 3 §3
- **Detail**: Phase 1 §2 says "This signature is consumed by Phase 3, so pin it here" and
  pins `{ ok: false; message: string }`. Phase 3 §3 says "extend Phase 1's failure shape
  with the response status". The plan contradicts itself; the cost is a rewrite of
  `http.ts`, its consumers and its tests two phases after they were declared frozen.
- **Fix**: Pin `{ ok: false; message: string; status: number }` in Phase 1 §2, and change
  Phase 3 §3 to consume it rather than extend it.
- **Decision**: FIXED (`status` pinned in Phase 1 §2; Phase 3 §3 consumes it)

### F4 — `PROTECTED_ROUTES` is not exported, and Phase 1 forbids changing it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 ("`PROTECTED_ROUTES` itself is unchanged") vs §4 ("Table-driven
  over `PROTECTED_ROUTES`")
- **Detail**: `src/middleware.ts:4` declares `const PROTECTED_ROUTES = [...]` with no
  `export`, so §4's table cannot iterate it. The implementer must guess between exporting
  it — which §1 reads as forbidden — and copying the array into the test. A copied array is
  the likely default and the worse outcome: the stated purpose of this test is the
  prefix-match trap ("a future route nobody adds to the array is unprotected"), and a
  duplicated list stays green while the real array drifts.
- **Fix A ⭐ Recommended**: Export the constant and say so in §1.
  - Strength: The test iterates the real array, so adding a route to production
    automatically adds a row — the only version of this test that closes its own trap.
  - Tradeoff: Widens the module's public surface by one constant.
  - Confidence: HIGH — one-word edit, no consumer outside the module.
  - Blind spot: None significant.
- **Fix B**: Keep it private; test only a hard-coded representative set.
  - Strength: No production edit at all.
  - Tradeoff: Abandons the prefix-match trap — the test's main justification.
  - Confidence: MEDIUM — cheap, but proves materially less than §4 claims.
  - Blind spot: §6.6's "the guard is cheap to test" note assumes the table tracks the array.
- **Decision**: FIXED via Fix A (`PROTECTED_ROUTES` exported; table iterates the real array)

### F5 — Phase 4's Stryker line range is stale by the time Phase 4 runs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §2 and Progress 4.2
- **Detail**: `--mutate "src/lib/study.ts:257-316"` is exactly right today (verified:
  `rateCard` spans 257–316). Phase 3 §2 edits the same file above it — rewriting the
  comment at `:65-72`, adding a `DueCardRow` field, adding a line to `scheduleRowToCard` —
  shifting `rateCard` down ~4–6 lines. Phase 4 would then mutate a window clipping
  `rateCard`'s tail and including part of `setSessionSize`, while the run completes and the
  register looks legitimate. (`enable_fuzz: false` in Phase 2 shifts nothing — the line
  stays ~118 chars, under the 120 printWidth.)
- **Fix**: State the range as "re-derive `rateCard`'s current line span at Phase 4 time"
  and record the derived numbers in `verification.md` alongside the report.
- **Decision**: FIXED (span re-derived at Phase 4 time and recorded in verification.md)

### F6 — Phase 0 blocks the whole plan on a rationale Phase 2 doesn't carry

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 0; Implementation Approach; Phase 2 §2
- **Detail**: Two problems, one root. (a) Phase 0's stated reason is "Phase 2's
  `session_size` bounds assume a CHECK constraint that may only exist locally" — but Phase
  2 §2 never asserts the bounds; it sets a valid size, reads it back, and checks the cap
  reaches `p_limit`. Nothing in the plan touches `between 1 and 100`, so the cloud state of
  that constraint cannot affect any local test, and the audit's named gap ("bounds untested
  at all three layers") is neither closed nor listed in "What We're NOT Doing". (b) `npx
  supabase migration list` needs an active link + login; the link lives in gitignored
  `supabase/.temp/` (`lessons.md:147-150`) and `supabase login` is interactive. The plan has
  a fallback for "check says pending" but none for "cannot check", so a gate on purely local
  work can stall everything.
- **Fix**: Demote Phase 0 to a non-blocking note ("record the cloud state if reachable;
  otherwise hand `20260724220524` to `/ship` unverified"), restate its rationale as
  ship-hygiene rather than a Phase 2 prerequisite, and either add a bounds case to Phase 2
  §2 or list the three-layer bounds gap explicitly in "What We're NOT Doing".
  - Strength: Nothing local depends on the answer, so the gate buys no safety it can't buy
    at ship time.
  - Tradeoff: A drift is discovered later in the cycle.
  - Confidence: HIGH — Phase 2's contract read line by line; it never exercises the
    constraint.
  - Blind spot: Whether the cloud project is currently linked in this worktree was not
    checked (would require running the command).
- **Decision**: FIXED + bounds test (Phase 0 demoted to non-blocking; Zod + CHECK bounds added to Phase 2 §2)

### F7 — `scheduled_days` is output-only; the "same class" analogy overstates it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 3 §2
- **Detail**: The plan sells the round-trip as closing "the same class as the
  `learning_steps` bug … inert today only because the scheduler config removes it from the
  calculation". In the installed 5.4.1 no scheduler reads `current.scheduled_days` as a
  transition input at all: `LongTermScheduler` zeroes it (`:1183`), `BasicScheduler`
  overwrites it (`:1023`, `:1041`, `:1048`), and the only read is `buildLog` (`:424`) — this
  app persists no review log. `learning_steps` was a genuine cursor (an input);
  `scheduled_days` is not, under either config. The round-trip is good hygiene and the
  neutrality claim in Critical Implementation Details is correct — for a stronger reason
  than the plan gives — but it closes no risk class.
- **Fix**: Keep the change; reword the Intent so Phase 4 doesn't record it in
  `test-plan.md` as closing the `learning_steps` class, and note that the RPC path staying
  outside the round-trip means preview intervals and the actual write read different
  `scheduled_days` — harmless only while it is not an input.
- **Decision**: FIXED (Intent reworded as hygiene; Phase 4 record and preview/write divergence noted)
