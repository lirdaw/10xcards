<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Study session — silent rating loss + SRS schedule coverage gaps

- **Plan**: `context/changes/srs-study-session-test/plan.md`
- **Scope**: Phases 0–4 of 4 (all complete)
- **Date**: 2026-07-26
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 7 observations

## Triage outcome (same session, 2026-07-26)

**All 10 findings fixed.** The verdict above is the review's finding at the time it was written and
is deliberately left standing — it is the record of what the code looked like when it arrived, not
a live status. Post-triage state, re-verified end to end:

| Check | Result |
|---|---|
| `npx astro sync` | pass |
| `npm run lint` | pass |
| `npm run build` | pass |
| `npm test` | **115/115 green, 11 files** (109 → 115: +1 `Sec-Fetch-Dest: empty` row, +1 `Vary` row, +2 for the `parsed` split, +2 for F2's recovery path) |

Four of the ten touched production code. **F2 closed the last silent rating loss in the codebase**
— an `alreadyApplied` reply no longer advances past a grade the server refused; the card is held,
the user is told, and the endpoint's previously-ignored `progress.reps` makes the retry apply. F7
widened `JsonResult`'s failure variant with `parsed` (and made `status` truthful again), F8 routed
`SessionSizeControl.save()` through the same helper as `rate()`, F9 added `Vary` to both guard
representations. F10 changed a type; the rest were documentation. `Vary` was confirmed on a **live** dev server rather than only through
the fabricated test context, because the redirect branch mutates a `Response` Astro constructs:

```
GET /decks  (Sec-Fetch-Dest: document) -> 302, vary: Sec-Fetch-Dest, Content-Type, Accept
POST /api/study (Content-Type: json)   -> 401, vary: Sec-Fetch-Dest, Content-Type, Accept
```

F6 was re-run rather than waived: Phase 3's three manual criteria now carry observed output in
`verification.md`, including `"Powtórzono kart: 2"` for four rating clicks and row-level proof that
the `404` and network-failure paths write nothing.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

**Nothing here blocks shipping.** The production fix is correct on both halves, every automated
criterion was re-run and passes (`astro sync`, `lint`, `build`, `npm test` → **109/109, 11 files**),
and the evidence trail in `verification.md` / `mutation-register.md` is the strongest this repo has
produced. The warnings are one correctness nuance the change newly documents incorrectly, one
self-contradiction inside the change's own evidence file, and one unplanned production module.

## Findings

### F1 — `verification.md` contradicts itself on whether Phase 0 ran

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/srs-study-session-test/verification.md:513`
- **Detail**: Lines 8–44 record Phase 0 as executed, with the full `npx supabase migration list`
  output and the conclusion "**Local and Remote match on every row** … Nothing for `/ship` to carry
  on this front." Line 513 then states "**Phase 0 (0.1 / 0.2) — still not run**, and deliberately
  so … `20260724220524` goes to `/ship` as **unverified against cloud**." Both cannot be true.
  Confirmed by `git show bfe53dd`: the epilogue commit rewrote the top section and left the closing
  paragraph untouched. `test-plan.md` §8 and the plan's Progress (`0.1`/`0.2` = `[x]`) both side
  with the top, so the trailing paragraph is the stale one. This matters beyond tidiness: `/ship`
  reads exactly this file to decide whether a `db push` is owed, and the change's own Desired End
  State is "contains no false statement".
- **Fix**: Delete the stale closing paragraph at `:513-516` (or replace it with a one-line pointer
  to the Phase 0 section above).
- **Decision**: FIXED — the paragraph now points at the Phase 0 section and states the real answer,
  with a short note recording that it contradicted the top of its own file for one commit.

### F2 — `alreadyApplied` cannot mean what the new docstring says, and the gap is a silent grade loss

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/study-session.ts:46-48`; behaviour at `src/lib/study.ts:331-347`
- **Detail**: The compare-and-set is `.eq("reps", expectedReps)` — it keys on the optimistic-lock
  **version**, not on the grade. If the same card is rated in another tab with a *different* grade,
  this tab's CAS matches zero rows, the re-read finds the row present, and `rateCard` returns
  `alreadyApplied: true`. `rateOutcome` then returns `advance: true, message: null`, so the island
  advances with **no message** and this user's grade is silently discarded. The new comment asserts
  the stronger claim the server cannot make: *"the compare-and-set matched zero rows because this
  exact rating had already landed."* The behaviour is pre-existing (S-03); what this change adds is
  a docstring stating it wrongly and a new test (`tests/lib/study-session.test.ts:47-53`) that
  enshrines `message: null` without qualification. In a change whose whole purpose is closing
  silent rating loss and deleting false statements, this is the one path that still produces both.
- **Fix A ⭐ Recommended**: Correct the comment to what the server actually checks — "the version no
  longer matches: the card was rated since it was served, by this client or another" — and add the
  same caveat to the test's comment.
  - Strength: Removes a false statement at the cost of two comment lines, with zero behavioural
    risk; matches the change's own standard of "correct the record, do not repeat it".
  - Tradeoff: The silent-discard behaviour itself remains; only the documentation becomes honest.
  - Confidence: HIGH — verified against `src/lib/study.ts:331-347` by reading the CAS predicate.
  - Blind spot: Whether a user can realistically hit the cross-tab different-grade case often
    enough to matter has not been measured.
- **Fix B**: Also surface a neutral notice on `alreadyApplied` — the endpoint already returns
  `progress: { reps, due }`, which the client currently ignores — so a dropped grade is visible.
  - Strength: Actually closes the residual silent-loss path rather than documenting it.
  - Tradeoff: A UX change beyond this plan's scope, needing its own copy decision and manual check;
    `rateOutcome`'s shape and its four tests would change.
  - Confidence: MEDIUM — the data is available, but the right copy for "someone else already rated
    this" is a product call, not a review call.
  - Blind spot: Whether showing a notice on a benign replay (same tab, double-click) would be more
    confusing than the current silence.
- **Decision**: FIXED via Fix A — `rateOutcome`'s comment now states that the CAS keys on the `reps`
  version rather than the grade, names the cross-tab different-grade case as a residual silent loss
  that is pre-existing and out of scope, and points at `progress` as the way to close it. The test's
  comment now reads `message: null` as "no message today", not as a claim that silence is correct.
  Note `src/lib/study.ts:337-338` carries the same imprecision in a pre-existing comment and was
  left alone.
- **Decision (follow-up, same session)**: **also FIXED via Fix B** — the residual defect is closed,
  not merely documented. `alreadyApplied` no longer advances: `rateOutcome` holds the card, returns
  a neutral `notice`, and hands back `progress.reps` as `syncReps`, which the island adopts as
  `expectedReps` so the next click applies for real. No migration and no API change — the endpoint
  already returned `progress` (`src/pages/api/study.ts:113`) and the island ignored it.
  Verified live with two tabs sharing one snapshot: tab B rated **Łatwe**, tab A's **Powtórz** was
  refused with the notice and the card held (rating buttons still live, no skip), then applied on
  the retry — `lapses` 0 → 1, `due` 2026-08-03 → 2026-07-27, `stability` 8.296 → 1.182, and the
  summary read `"Powtórzono kart: 3"` (the recovered rating counted once; the refused attempt
  counted for nothing). Suite 113 → **115**; the case that asserted `advance: true` was inverted,
  not deleted. Rejected on the way: inferring "was it the same grade?" from the rating buttons'
  interval previews — those are computed from `scheduled_days = 0` while `rateCard` uses the
  persisted value, a divergence this very change documented, so the inference would have been
  quietly wrong.

### F3 — `src/lib/study-session.ts` and its test are a new production module with no plan entry

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/lib/study-session.ts` (new, 56 lines), `tests/lib/study-session.test.ts` (new, 4 cases)
- **Detail**: Neither file appears anywhere in the plan — not in Changes Required, not in Testing
  Strategy, not in References. Phase 3 §1 and §3 both name `StudySession.tsx` as the only file and
  describe the behaviour as living in `rate()`. What shipped is a second pure extraction
  (`rateOutcome`) implementing exactly those two behaviours. It is *not* the forbidden shared
  `postJson()` — it is study-specific and touches no other island — and it is the same
  "extract the decision so it is testable without a DOM layer" move the plan authorised for
  `http.ts`. It is documented after the fact in `test-plan.md` §7. Flagged because the plan's own
  Phase 1 §2 rationale ("pin the signature *here*, so a later phase does not rewrite the module two
  phases after it was declared frozen") shows the author cared about precisely this class of late
  addition, and `lessons.md` carries an accepted rule about settling adjacent scope before building.
- **Fix**: Record it as a plan addendum under Phase 3 (and in `change.md`'s scope notes) so the plan
  stays usable as ground truth for the next review — the work itself is sound and should stay.
- **Decision**: FIXED — `plan.md` Phase 3 gained an "Addendum" block naming both files, why they are
  kept, and why a second module belonged in the plan before it was built; `change.md`'s scope notes
  record the same. No code changed.

### F4 — `tests/study/schedule.test.ts` was changed beyond its header, contradicting the plan

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `tests/study/schedule.test.ts:86-126`
- **Detail**: The plan's Testing Strategy states this file is "unchanged apart from its header
  correction". It gained two `scheduled_days` cases in `da5e9c2` (6 → 8 tests). Both are correct and
  are a sensible neutrality probe for Phase 3 §2 — this is a stale plan sentence, not bad work.
- **Fix**: Amend the Testing Strategy line in the plan to name the two added cases.
- **Decision**: FIXED — the plan's Testing Strategy now names both `scheduled_days` cases and why
  the field is optional.

### F5 — one of the guard's three discriminator branches has no test

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/middleware.ts:32`; `tests/middleware.test.ts`
- **Detail**: `wantsJson` has three branches. `Sec-Fetch-Dest: document` is covered by
  `PAGE_CALLER`, `Content-Type: application/json` by `JSON_CALLER`, and the `Accept` fallback by
  `FORM_CALLER`. **`Sec-Fetch-Dest: empty` appears in no test** — grep confirms the string exists
  only at `tests/middleware.test.ts:39` as `"document"`. Deleting `if (dest === "empty") return true`
  leaves the suite fully green, because every JSON row also carries a JSON `Content-Type`. That
  branch is exactly the "body-less JSON GET" widening the plan asked for, so the case the branch
  exists to serve is the case nothing exercises.
- **Fix**: Add one row — a GET to a protected path with `Sec-Fetch-Dest: empty` and no body — and
  confirm it answers 401.
- **Decision**: FIXED — `tests/middleware.test.ts` gained "answers a body-less fetch
  (Sec-Fetch-Dest: empty) with a 401, not a redirect", carrying `Accept: */*` and no
  `Content-Type` so it can only pass through the `dest === "empty"` branch.

### F6 — Phase 3's manual criteria are marked complete with no recorded observation

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/srs-study-session-test/verification.md:247`
- **Detail**: Criteria 3.4–3.6 (counter increases by one; "Pomiń kartę" appears on a card rejected
  elsewhere; a network failure offers no skip) are recorded only as "were met and confirmed at the
  time", with the evidence explicitly not duplicated. Phases 1 and 2 by contrast carry deck ids,
  row-level `psql` dumps, a signed-out probe matrix and screenshots-in-prose. The three Phase 3
  behaviours are the ones a pure-function test cannot reach (they live in the JSX that §7 names as
  unreachable), so this is the phase where a recorded manual observation was worth the most and is
  the only one missing.
- **Fix**: Either re-run the three UI checks and paste what was observed, or state plainly in
  `verification.md` that Phase 3's manual evidence was not captured.
- **Decision**: FIXED — all three re-run against a live dev server and written into
  `verification.md` with observed output. **3.4**: the same session opened in two tabs so an
  `alreadyApplied` reply was guaranteed, not hoped for — four rating clicks, three writes,
  `"Powtórzono kart: 2"` (it read 3 before Phase 3), with each card's `reps = 1` proving the
  un-counted rating also wrote nothing. **3.5**: a card rejected out-of-band while its session was
  open showed `"Karta nie istnieje"` + `"Pomiń kartę"` and did not advance; the skip then moved the
  session on and cleared the error. **3.6**: `fetch` forced to reject gave `"Błąd sieci. Spróbuj
  ponownie."` with no skip and the rating buttons still live. Neither 3.5 nor 3.6 wrote a row.

### F7 — `readJsonResponse` discards the real status on any unparseable body

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/http.ts:47-53`
- **Detail**: Two related edges. (a) Any response whose body does not parse returns `status: 0`, so
  a genuine `404` behind a proxy/CDN HTML error page — or a `204`, which `res.json()` also rejects
  on — reads as "retry in place" and the user is stuck on a card that can never be rated: the exact
  state `skippable` exists to fix. (b) The `401`/`redirected` check runs *before* the `!parsed`
  check, so a redirected **and** unparseable response returns `res.status` (e.g. 200) rather than
  the `0` the plan's contract specifies. Both are harmless today (neither yields 404, so `skippable`
  stays false) and (a) is deliberate and documented at `:20-25`. Worth knowing which failure mode
  was traded into: a stuck session rather than a lost rating. No test covers the combination in (b).
- **Fix A ⭐ Recommended**: Leave the behaviour as is — the trade (never mistaking an HTML page for
  a 404) is the right one — and add a sentence to the docstring naming the stuck-session case as the
  accepted cost.
  - Strength: Zero risk; the current default fails safe, and the reasoning is already half-written.
  - Tradeoff: A real 404 behind an HTML error page stays unskippable.
  - Confidence: HIGH — traced every branch of `readJsonResponse`; it cannot throw.
  - Blind spot: Whether any deployment path in front of this app returns HTML for a 404.
- **Fix B**: Add `parsed: boolean` to the failure variant, keep `status` truthful, and have
  `rateOutcome` read `status === 404 && parsed`.
  - Strength: Keeps both signals; removes the edge in (b) as a side effect.
  - Tradeoff: Widens a contract Phase 1 deliberately froze, and touches `http.ts`, its 7 tests,
    `study-session.ts` and its 4 tests.
  - Confidence: MEDIUM — mechanically simple, but the plan pinned this shape on purpose.
  - Blind spot: No caller needs the distinction today.
- **Decision**: FIXED via Fix B — `JsonResult`'s failure variant gained `parsed: boolean`, `status`
  is now always the response's own status (the `UNPARSEABLE = 0` sentinel is gone), and
  `rateOutcome` reads `status === 404 && result.parsed`. Two new tests pin the split: an
  unparseable `404` keeps its status and is marked unparsed, and `rateOutcome` withholds the skip
  for it while still offering it for a JSON `404`. Suite 111 → 113.

### F8 — `SessionSizeControl` still hand-rolls the decision `readJsonResponse` now owns

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/study/StudySession.tsx:86-91`
- **Detail**: The plan **deliberately** left this unchanged ("it already parses before checking
  `ok`"), and that reasoning is sound — it cannot silently succeed. But it now leaves one file
  internally inconsistent about the exact decision this change exists to centralise: a lost session
  in `save()` shows the endpoint's terser "Nie jesteś zalogowany" while `rate()` shows
  `SESSION_EXPIRED_MESSAGE`, and `res.redirected` is not checked at all. Same screen, same endpoint,
  two different answers to the same event.
- **Fix**: Route `save()` through `readJsonResponse<{ size?: number }>(res, "Nie udało się zapisać rozmiaru sesji.")` — a five-line edit in the file this change already owns.
- **Decision**: FIXED — `save()` now uses the same helper as `rate()`, so one screen gives one
  answer to a lost session, and `res.redirected` is covered on both paths.

### F9 — no `Vary` header on the guard's two representations

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/middleware.ts:63-69`
- **Detail**: The same URL now returns two different representations selected by `Sec-Fetch-Dest` /
  `Content-Type` / `Accept`, with no `Vary` on either branch. A shared cache that stored the 401 JSON
  could serve it to a document navigation — the dead-end JSON page the discriminator exists to
  prevent. Low risk today: `401` is not cacheable without explicit headers, `302` is not cacheable by
  default, and neither response sets `Cache-Control`.
- **Fix**: Add `Vary: Sec-Fetch-Dest, Content-Type, Accept` to both the 401 and the redirect.
- **Decision**: FIXED — a `VARY_ON_CALLER` constant is set on both branches, with a test asserting
  both representations carry it.

### F10 — `RateResponse.ok` is declared and never read

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/study-session.ts:13`, `:50-55`
- **Detail**: `rateOutcome` branches on `result.ok` (the transport flag from `JsonResult`) and on
  `data.alreadyApplied`, never on `data.ok`. Two fields named `ok` at different layers in one
  function is the same readability trap the project's own "two axes are called state" warning
  describes; a hypothetical `200 { ok: false }` would be treated as success.
- **Fix**: Drop `ok` from `RateResponse` — the endpoint's 200 always carries `ok: true`, so it
  carries no information.
- **Decision**: FIXED — `RateResponse` is now `{ alreadyApplied: boolean }`, with a docstring
  recording why the endpoint's constant `ok` is deliberately not modelled.

## What was verified and found correct

Recorded so a future reader does not re-derive it:

- **The guard cannot be weakened by a crafted header.** The `wantsJson` branch is nested strictly
  inside `if (!context.locals.user)`, itself inside the `PROTECTED_ROUTES.some(...)` match; both
  arms `return`. It changes the *shape* of an already-decided denial, never whether the check runs.
  `Sec-Fetch-Dest` is a forbidden header name, so page script cannot forge it, and a cross-origin
  `<form>` cannot send `Content-Type: application/json`. `PROTECTED_ROUTES` contents are
  byte-identical — only `export` and formatting changed.
- **The `scheduled_days` round-trip is genuinely behaviour-neutral**, verified against
  `ts-fsrs@5.4.1` source rather than only against the tests: `LongTermScheduler` zeroes it on input
  (`index.cjs:1183`), `BasicScheduler` overwrites it (`:1023`, `:1041`, `:1048`), and every read
  feeds `review_log`, which this app never persists. `?? 0` is correct for both a NULL column and
  the RPC path's `undefined`.
- **The Phase 2 oracles are truly independent**: built by `createEmptyCard` and advanced in memory,
  never through `scheduleRowToCard`; `lapses` is asserted against the oracle *and* against `1`, not
  inside a self-comparing `toEqual`.
- **The Stryker span was genuinely re-derived**: `rateCard` occupies `src/lib/study.ts:291-350`
  today — confirmed independently, exact — not the `257-316` the plan recorded.
- **Every "What We're NOT Doing" boundary held**: `package.json` and `vitest.config.ts` have zero
  diff (no DOM layer), `supabase/` has zero diff (no migration), only `StudySession.tsx` appears
  under `src/components/`, and roadmap H-02's Status was **not** flipped — only Outcome gained a
  paragraph, per the accepted `lessons.md` rule.
- **Automated criteria re-run at review time**: `npx astro sync` pass, `npm run lint` pass,
  `npm run build` pass, `npm test` → **109/109, 11 files**. No `.skip`/`.only`/`.todo`. Working tree
  clean for `src/`.
