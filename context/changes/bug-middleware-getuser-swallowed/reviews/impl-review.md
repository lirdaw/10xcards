<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Middleware reads a `getUser()` auth error as "not signed in"

- **Plan**: `context/changes/bug-middleware-getuser-swallowed/plan.md`
- **Scope**: Full plan — Phases 1–6 of 6
- **Date**: 2026-08-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Success criteria — re-run rather than cited

Every automated criterion across all six phases was executed against the tree as it now stands,
not read off the Progress checkboxes.

| Command                                                 | Result                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npx vitest run tests/lib/auth-outcome.test.ts`         | **20 passed** — matches the figure the doc-sync recorded                                                        |
| `npx vitest run tests/middleware.test.ts`               | **23 passed**, and `git diff main...HEAD -- tests/middleware.test.ts` is **empty** — the regression proof holds |
| `npx vitest run` (guards + http + error-param, 5 files) | **72 passed (5 files)**                                                                                         |
| `npm test`                                              | **521 passed / 521, 41 files** — exactly the doc-synced total                                                   |
| `npm run typecheck`                                     | exit 0, `Result (159 files): 0 errors, 0 warnings`                                                              |
| `npm run lint`                                          | exit 0, **3** warnings, all `no-console` in `evals/generation-quality.eval.ts` — the standing set, unchanged    |

Scope discipline was verified by diff rather than by assertion. `git diff --name-only main...HEAD --
src/ tests/ supabase/` returns **exactly four files**: `src/lib/auth-outcome.ts`,
`src/middleware.ts`, `tests/lib/auth-outcome.test.ts`, `tests/lib/form-endpoint-guards.test.ts`.
Every "What We're NOT Doing" item is respected with an empty diff: `src/lib/http.ts`, the `Locals`
declaration, `tests/lib/sentry-capture-wiring.test.ts`, `tests/middleware.test.ts`, and everything
under `supabase/`. No Sentry capture, no `Retry-After`, no migration.

Phase 4's five breakage runs are each recorded with an observed failure string and a denominator,
and B2's divergence (red count held exactly, **green** set six rather than the enumerated four) is
recorded **as observed** rather than rounded to the prediction. Phase 5's six manual rows are
present, including row 6's `503`-vs-`401` measurement through a mounted island. Roadmap **H-20** is
`in progress` and was not flipped to `done`.

Two things the implementation did **beyond** the plan and got right:

- Phase 3 re-measured the `producers.length` floor and found it carrying **slack** (7 against a
  measured 8) rather than merely moving it — closing a shrink direction the plan did not ask about.
- The label root moved to `SRC_DIR` for the two `?error=` sweeps while the `formData()` describe
  correctly keeps `API_DIR`, with the split argued at both sites. That is contract 23 answered by
  rooting rather than by commenting, which is the better of the two options the plan offered.

## Findings

### F1 — A thrown non-`AuthError` is now silently reported as a backend outage

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/middleware.ts:88-101` (the `catch`)
- **Detail**:
  D-03 closes a real hole — a thrown non-`AuthError` was an uncaught 500 on every request. But the
  `catch` binds nothing and emits nothing, so the class it closes now degrades **silently**: a
  programming error inside `getUser()` (a cookie-parsing bug, a broken adapter, a bad upgrade)
  becomes `{ kind: "unavailable" }`, and the user is told the auth backend is temporarily
  unreachable. It reaches no owner at all — D-01 rules out a Sentry capture, and
  `tests/lib/no-logging.test.ts` forbids a `console.*` under `src/`. Before this change the same
  state at least produced a loud 500.

  The plan applies D-01 to this branch by inheritance, and D-01's argument does not cover it.
  D-01 reasons from volume — "sits on every request; unsampled by construction and self-masking on
  quota exhaustion" — which is true of the `unavailable` outcome reached from a _returned_ error
  during an outage. A **throw** is a different population: it is rare by construction (auth-js
  rethrows only non-`AuthError` values), so it carries none of the quota hazard D-01 describes.
  The two were collapsed onto one response deliberately and correctly; they were also collapsed
  onto one _monitoring_ decision, and that half is not argued anywhere.

  Not a defect in what ships — the user-facing behaviour is the right one either way — but the
  change makes a bug class harder to discover than it was before it landed, and no document says so.

- **Fix A ⭐ Recommended**: Bind the caught value and emit one `Sentry.captureException` from the
  `catch` only, following `buildSignOutFailureReport`'s shape (structured fields as tags, free-form
  text as length + digest, no user identifier).
  - Strength: Scoped to the population D-01's argument does not reach, so it costs nothing on the
    every-request path; restores an owner for the one class here that is a _bug_ rather than an
    infrastructure event.
  - Tradeoff: Introduces the first capture site in `src/middleware.ts`, which the plan's "NOT
    doing" list rules out wholesale; `tests/lib/sentry-capture-wiring.test.ts`'s catch-all would
    then need the file registered as a target, so the "empty diff" on that file is spent.
  - Confidence: MEDIUM — the shape is proven one route over (C10X-51), but this reverses a written
    decision rather than filling a gap the decision left open.
  - Blind spot: I did not verify whether an uncaught middleware throw actually reached Sentry
    before this change (via the Worker wrapper or via `captureConsoleIntegration` picking up
    Astro's own error log). If it did not, this is _adding_ a channel rather than restoring one —
    which strengthens the case, but the framing above would be wrong.

- **Fix B**: Leave the code exactly as shipped and record the trade — one line at the `catch`
  saying a thrown non-`AuthError` now presents as a transient outage and reaches no owner, and the
  same clause added to the test-plan §6.6 does-NOT-prove list beside the existing D-01 bullet.
  - Strength: Zero behaviour change on a file that runs on every request; stays consistent with
    D-01 as written; the boundary becomes visible to the next reader, which is this project's
    stated standard for an accepted cost.
  - Tradeoff: The bug class stays invisible indefinitely, and the only thing that would surface it
    is a user reporting an outage that is not one.
  - Confidence: HIGH — it is a documentation edit with no blast radius.
  - Blind spot: None significant.

- **Decision**: **FIXED via Fix A** (2026-08-14)

  The capture is scoped to the `catch` and to nothing else, so the returned-`AuthError` path keeps
  D-01 intact — and `captures: 1` on the new guard row is now load-bearing in **both** directions:
  it reddens on the capture being deleted, and on a second one being added to the outage branch,
  which is the edit D-01 exists to refuse.

  Four files: `src/lib/auth-outcome.ts` gains `AUTH_CHECK_CAPTURE_MESSAGE`,
  `thrownAsAuthCheckCause` and `buildAuthCheckFailureReport` (the third builder, beside its own
  decision module, sharing `fingerprint` from `@/lib/audit-failure-report` — the pattern the two
  siblings already establish); `src/middleware.ts` binds the thrown value and emits one synthetic
  capture, itself wrapped so a rejecting `crypto.subtle.digest` cannot reinstate the uncaught 500
  that D-03 exists to close; `tests/lib/sentry-capture-wiring.test.ts` registers the third target.

  **Both structural blockers the plan named were real and are now removed rather than worked
  around.** `expect(source).toContain("export const POST: APIRoute")` was hardcoded for every row
  and `src/middleware.ts` exports no route handler, so the field became per-target `signature`
  (`"defineMiddleware("` here) — the control keeps full strength on all three rows and merely stops
  assuming every capture site is a POST route. And the catch-all's `middleware.ts` exemplar was
  **moved rather than dropped** to `lib/utils.ts`, so the walk keeps the one entry proving it
  reaches beyond the Sentry-adjacent modules; `expect(named).not.toContain("middleware.ts")` joins
  the two existing exclusions.

  **Falsified rather than assumed.** Deleting the capture statement turns
  `sentry-capture-wiring.test.ts` **1 of 23 red**, naming the target by path:
  `expected [] to have a length of 1 but got +0`. Restored by byte copy from a pristine pre-edit
  copy, `md5sum` identical (`f8309a184bd416db0536ed756f565d35`).

  Gates after the fix, all re-run: `npm test` **527 passed / 527, 41 files** (521 → 527; the +6 is
  the third target's `describe.each` block, measured by running rather than by arithmetic),
  `npm run typecheck` exit 0 at `Result (159 files): 0 errors`, `npm run lint` exit 0 with the 3
  standing `no-console` warnings unchanged, `npm run build` exit 0.

  **The stated cost was paid, exactly as the tradeoff predicted**: the plan's Phase 3 manual
  criterion "`git diff tests/lib/sentry-capture-wiring.test.ts` is empty" no longer describes the
  tree. It remains an accurate record of what Phase 3 itself did, and the file was edited by this
  review rather than by the phase.

  **The blind spot is unresolved and stays on record**: it was not established whether an uncaught
  middleware throw reached Sentry before C10X-52 (via the Worker wrapper or via
  `captureConsoleIntegration` picking up Astro's own error log). If it did not, this adds a channel
  rather than restoring one — which strengthens the fix, but the wording at the site says
  "reaches nobody", scoped to the post-C10X-52 tree, where it is measured and true.

### F2 — `unconfigured` changes the anonymous visitor's experience, while the docs claim it does not

- **Severity**: 👀 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/middleware.ts:70-77`; `plan.md:107-109` (Desired End State)
- **Detail**:
  The plan's Desired End State says flatly "An anonymous visitor's experience is byte-identical to
  today", and the test-plan entry backs it with the short-circuit argument — `getUser()` answers
  `AuthSessionMissingError` before any transport is attempted, so a dead port cannot reach the
  outage branch for a visitor with no cookie. That reasoning is correct and was measured (Phase 5
  row 5, in both stack states).

  It does **not** hold for `unconfigured`, which has no such short-circuit. On a deployment missing
  `SUPABASE_URL`/`SUPABASE_KEY`, an anonymous visitor to a protected route previously got a bare
  `302` (or a `401`); they now get `/auth/signin?error=<AUTH_UNAVAILABLE_MESSAGE>` (or a `503`,
  carrying the same). That is the D-02 widening working as designed and it is consistent
  with the three sibling auth routes — but it means the "byte-identical" claim is true of the
  _configured_ case only, and the branch was never exercised (`verification.md:704`: "no run here
  removed `SUPABASE_URL`/`SUPABASE_KEY`").

- **Fix**: Scope the claim — in `plan.md`'s Desired End State and in the test-plan §6.6 entry, say
  "an anonymous visitor's experience is byte-identical to today **on a configured deployment**",
  and note that the `unconfigured` branch answers every caller including anonymous ones.
- **Decision**: **FIXED** (2026-08-14)

  Three sites, each edited in the register it belongs to rather than uniformly. `plan.md`'s Desired
  End State is a **live** claim and is scoped in place, with a blockquote naming the mechanism (the
  short-circuit exists for a dead backend and has no counterpart for a `null` client) and the fact
  that the branch was never exercised. The test-plan §6.6 does-NOT-prove list gains the consequence
  on its existing `unconfigured` bullet. The §8 ledger bullet is a **dated snapshot**, so it takes
  an appended correction and is not rewritten — this project's live-declaration-versus-dated-snapshot
  rule.

  One clause was checked and deliberately **not** edited, recorded so nobody hunts for a missing
  change: the header block's "during the outage … an anonymous visitor is byte-identical to today
  because the short-circuit fires before any transport is attempted" is already scoped to the
  outage by its own opening words, and is true as written.

  `npx prettier --check` clean on all three files afterwards, and idempotent (written twice, second
  write changed nothing). The one line prettier would have damaged — a code span split across a
  line break inside a list item, exactly the C10X-43 hazard — was found by probing on an **in-repo**
  copy first and fixed at the source rather than accepted.

### F3 — The `code` allow-list and status rules are not gated on `AuthApiError`

- **Severity**: 👀 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/auth-outcome.ts:149-152`
- **Detail**:
  The plan's Phase 1 contract words both halves of the split as gated on the class — "plus
  **`AuthApiError`** whose `code` is one of …" and "plus **`AuthApiError`** with `status >= 500` or
  `status === 429`". The implementation tests `code` and `status` on **any** value that is not one
  of the two explicitly named classes.

  Benign, and arguably better: from `getUser()` the only remaining class is `AuthApiError`, so the
  populations coincide today, and a future class carrying `status >= 500` would land on
  `unavailable`, which is the answer that class would want anyway. The truth table cannot tell the
  two readings apart — every fabricated row carries `name: "AuthApiError"` — so nothing pins the
  looser behaviour either.

  Worth a line because the module header is otherwise unusually careful about _why_ each test is
  where it is, and this is the one ordering decision it argues (`code` before `status`) without
  also saying why neither is gated on the class the plan named.

- **Fix**: Add one sentence to `classifyAuthError`'s docblock stating that the `code` and `status`
  rules deliberately apply to any residual class rather than to `AuthApiError` alone, and that both
  directions coincide for every value `getUser()` can produce.
- **Decision**: **FIXED** (2026-08-14)

  One paragraph added to `classifyAuthError`'s docblock, beside the ordering argument it was
  missing from. It records that the two readings coincide for every value the function can be
  handed, that no case below can tell them apart (every fabricated row carries a real class name),
  and what the ungated form buys on the population nobody has enumerated: a `429` or a `>= 500` on
  an unforeseen class still means the backend refused to serve, where adding the gate would send
  exactly those to `no-session` — a silent narrowing.

  No test row was added. That was considered and declined: a row pinning the looser behaviour would
  fabricate a class name auth-js does not produce, so it would assert a state production cannot
  reach — the same objection the module's own header raises against a `signed-in` variant of
  `AuthCheckOutcome`.

## Final gate state, after all three fixes

| Command                | Result                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `npm test`             | **527 passed / 527, 41 files** (521 before this review; +6 from F1's third guard target)  |
| `npm run typecheck`    | exit 0, `Result (159 files): 0 errors, 0 warnings`                                        |
| `npm run lint`         | exit 0, 3 standing `no-console` warnings in `evals/generation-quality.eval.ts`, unchanged |
| `npm run build`        | exit 0                                                                                    |
| `npx prettier --check` | clean on every edited markdown file, and idempotent                                       |

Files edited by this review: `src/lib/auth-outcome.ts`, `src/middleware.ts`,
`tests/lib/sentry-capture-wiring.test.ts`, `context/changes/bug-middleware-getuser-swallowed/plan.md`,
`context/foundation/test-plan.md`, and this report.
