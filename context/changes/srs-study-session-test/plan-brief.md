# Study session — silent rating loss + SRS coverage gaps — Plan Brief

> Full plan: `context/changes/srs-study-session-test/plan.md`
> Research: `context/changes/srs-study-session-test/research.md`

## What & Why

A user whose session expired or was revoked in another tab can walk an entire study session
without a single rating being written, and without seeing an error. Middleware answers
`POST /api/study` with a 302 to an HTML page, `fetch` follows it to a 200, and
`StudySession.rate()` — the only island in the repo that checks `!res.ok` before parsing —
reads that as success. The card advances, the counter climbs, nothing is scheduled. This
change fixes that, closes the four schedule promises nothing ever tested, and replaces the
stale parts of the test plan with evidence from actual runs.

## Starting Point

Risk #3's three originally briefed tests already exist and pass (22 cases, suite 69/69) —
the audit found the real gaps elsewhere. `src/middleware.ts` has zero automated coverage.
Every `listDueCards` call in the suite passes the literal `20` and `new Date()`, so the
deck's `session_size` and "a card comes back when due" are unobserved. Only `Rating.Good`
has ever reached the write path. And `test-plan.md` asserts in three places that the app
configures `enable_fuzz: false` — it does not; determinism rests on an unpinned ts-fsrs
default under `^5.4.1`.

## Desired End State

A lost session produces an error on the first rating instead of a silent walk-through, and
all three JSON endpoints answer an unauthenticated caller with a 401 their islands already
display. The batch is bounded by the deck's own cap and composed deterministically, a rated
card returns exactly when it falls due and not a minute earlier, and all four grades —
including the lapse transition (`lapses` +1, with `due`/`stability` below `Good`) — are
asserted against an oracle advanced independently of the database. `test-plan.md` contains no false statement and every count in it comes from a
run executed against the current files.

## Key Decisions Made

| Decision                          | Choice                                                            | Why (1 sentence)                                                                                     | Source   |
| --------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------- |
| Where to fix the defect           | Both middleware and client                                        | `lessons.md:187-192` names both halves as required; together they make the endpoint's 401 reachable.  | Plan     |
| Middleware blast radius           | JSON **callers** inside `PROTECTED_ROUTES`, not every `/api/*` path | Removes the class without breaking the six native deck/card forms, which are page navigations and must keep the redirect (plan-review F1). | Plan     |
| Client blast radius               | Only `rate()`, matched to its siblings                            | The other four islands already parse before `ok`; refactoring them would be adjacent-scope creep.     | Plan     |
| Determinism                       | Explicit `enable_fuzz: false` in the config                       | Makes true what three documents already claim, without pinning the whole library.                     | Plan     |
| Middleware coverage               | Table-driven over `PROTECTED_ROUTES` + response-contract asserts  | Also closes the prefix-match trap F-03 deferred; needs no container and no database.                  | Plan     |
| Client coverage                   | Extract the decision to a pure function, test it in node          | Covers the logic that actually failed without adding a DOM/testing-library stack layer.               | Plan     |
| `session_size` test depth         | Cap from the deck + deterministic ordering + the Zod/CHECK bounds | One setup covers the unobserved reader and the `f.id` tie-break; the bounds close the audit's "untested at all three layers" (plan-review F6; the island mirror stays uncovered by construction). | Plan     |
| "No card is lost" test            | Returns at `T + interval`, absent at `T + 1 min`                  | The negative control is what separates durability from "the RPC returned something".                  | Plan     |
| Grade coverage                    | Full four-grade write matrix, plus the lapse case + a `srs_state != 3` canary | `Again` has never reached persistence, so `lapses` is unproven; `Relearning` is unreachable under `enable_short_term: false`, so the lapse is asserted on `lapses` and on `due`/`stability` below `Good` (plan-review F2). | Plan     |
| Evidence                          | New + all three existing breakage checks, plus narrowed Stryker   | No recorded run exists against the current files; stale counts are the problem this change fixes.     | Plan     |
| Record                            | Full correction + Phase 4 `reopened` → `complete`                 | The named half of Risk #3 gets proven here, which is exactly what `reopened` was waiting for.         | Plan     |
| Previously deferred items         | Pull in `reviewed`, `scheduled_days`, skip affordance             | All three sit on surfaces this change already touches; scope settled before building.                 | Plan     |
| Cloud migration question          | Check early, but **non-blocking** (Phase 0)                       | Ship-hygiene, not a prerequisite: every test runs against the local stack, where the migration is applied (plan-review F6). | Plan     |

## Scope

**In scope:** the middleware `/api/*` 401 branch; `rate()`'s response handling via a new
pure helper; middleware and helper tests; explicit `enable_fuzz`; tests for `session_size` →
`p_limit` with batch ordering, due re-entry, and the four-grade write matrix with the lapse
transition; `reviewed` counting transitions not responses; `scheduled_days` round-tripped on
the rate path; a skip affordance on a 404; deliberate-breakage evidence; a narrowed Stryker
run; the `test-plan.md` correction.

**Out of scope:** unifying the fetch pattern across the other four islands; any DOM/component
test layer; widening the `/api/*` branch past `PROTECTED_ROUTES`; `elapsed_days` and the
RPC's return type (both need a migration); the `supabase === null` empty-state masquerade
and the `cardsError`-ships-200 inconsistency; keyboard shortcuts; e2e; the roadmap Status
flip (archive owns it).

## Architecture / Approach

The fix is two-sided by design. The shell stops answering a JSON caller in a page's format
(401 JSON for `/api/*`, redirect for pages), which makes three already-correct endpoint
guards reachable for the first time. The client stops re-deciding "did this succeed" inline:
that decision moves into one pure `readJsonResponse` in `src/lib/`, where it is testable in
the existing node environment and where a `200 text/html` — the exact shape the followed
redirect produced — is a named failure rather than an accidental success.

The coverage work all lands at the lib layer, because `now` is a trailing parameter on
`rateCard`/`listDueCards` and deliberately unreachable from a request body. That seam is the
only place an exact `due` or a future clock can be pinned — and it is why "a card comes back
when due" is cheap rather than an e2e problem.

## Phases at a Glance

| Phase                          | What it delivers                                              | Key risk                                                                     |
| ------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 0. Cloud schema check          | Confirmation that `20260724220524` reached production          | Non-blocking: needs interactive cloud auth, so "unverifiable" is a valid outcome that hands the push to `/ship` |
| 1. Stop the silent loss        | 401 JSON guard, hardened `rate()`, two new test files          | Middleware touches every route — the `/api/*` branch must stay *inside* the guard, or sign-in breaks |
| 2. Named coverage gaps         | `enable_fuzz`, session cap + ordering, due re-entry, 4 grades  | The `enable_fuzz` edit must be behaviour-neutral; a red suite invalidates the premise |
| 3. Previously deferred items   | Honest counter, `scheduled_days` round-trip, skip affordance   | The round-trip changes the `Card` fed to `next()` — the exact-`due` oracles are the neutrality check |
| 4. Evidence + record           | Breakage runs, narrowed Stryker, corrected `test-plan.md`      | Restores must be diff-verified; §6.6 records one that silently no-opped      |

**Prerequisites:** local Supabase stack up (`npm run db:start`), `OPENROUTER_API_KEY` unset,
Docker available for the SQL-level breakage checks, and cloud access for Phase 0 only.
**Estimated effort:** ~4–5 sessions across five phases; Phase 4 is the slowest (policy and
function neuters with verified restores).

## Open Risks & Assumptions

- **Assumed:** `20260724220524` is applied on cloud. Phase 0 tries to settle it but gates
  nothing; if it is pending — or if the check cannot run at all — `db push` moves to `/ship`
  and nothing in the local plan changes.
- The `scheduled_days` round-trip is behaviour-neutral **only** because
  `enable_short_term: false` makes ts-fsrs zero it on input. If an oracle goes red, stop and
  re-scope rather than update the expectation.
- The defect was confirmed by reading the code path plus Fetch redirect semantics, **not**
  reproduced in a browser. Phase 1's manual step is the first real reproduction — if it does
  not reproduce, the diagnosis needs revisiting before the fix is credited.
- Fixing `rate()` alone leaves the JSX and state of five islands unreachable by any test
  layer. §7 keeps that as named negative space, re-evaluated when a phase wires e2e.
- Mutation testing on a path this DB-heavy may kill mutants on malformed queries rather than
  on assertions (S-05's precedent). The register must say which, or the score misleads.

## Success Criteria (Summary)

- Signing out in a second tab and then rating shows an error and does **not** advance the
  card — the failure a user could not see is now visible.
- A card rated today comes back exactly when it falls due, and a session built from a deck
  with a small `session_size` returns that many cards, in a deterministic order.
- `test-plan.md` §3 Phase 4 reads `complete` again, and every claim in §6.6 cites a run
  executed against the files as they stand.
