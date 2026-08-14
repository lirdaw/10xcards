<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Middleware reads a `getUser()` auth error as "not signed in"

- **Plan**: `context/changes/bug-middleware-getuser-swallowed/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-14
- **Verdict**: REVISE
- **Findings**: 3 critical, 2 warnings, 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots           | WARNING |
| Plan Completeness     | FAIL    |

The approach is sound and unusually well grounded — the auth-js taxonomy is verified against the
installed 2.105.3, and the three counter-intuitive rows (500 is not retryable,
`AuthSessionMissingError` fabricates status 400, an expired session is `validation_failed`) are each
true and each would have cost a wrong branch. Every findings below concerns the **mechanics of
Phase 3** and the **evidential value of Phase 4**, not the design.

## Grounding

10/10 paths ✓ (`src/lib/auth-outcome.ts` and `tests/lib/auth-outcome.test.ts` correctly absent);
14/14 symbols and line anchors ✓ — `middleware.ts:46-53/56/60/71-79`, `signin.astro:8`,
`http.ts:52-53`, `auth-errors.ts:38/44/46` and `AUTH_MESSAGES` membership,
`form-endpoint-guards.test.ts:112-121/262-278/349/391/662/663`,
`sentry-capture-wiring.test.ts:414`, `route-guard.spec.ts:77`, `signout.ts:89/138-142`;
`tests/middleware.test.ts` counted at **23** cases by enumeration ✓; brief↔plan ✓;
Progress↔Phase contract ✓ (6 phases, 34 criteria, all mapped, exactly one `## Progress`).
`docs/reference/contract-surfaces.md` does not exist — that check skipped.

## Triage (2026-08-14)

All six findings **FIXED** in `plan.md`; no finding skipped, accepted or dismissed. **Verdict after
fixes: SOUND.** One consequence worth reading before implementation: applying F6 surfaced a latent
second defect in the same contract — `unavailable` had been specified as carrying two different
messages — so `AuthCheckOutcome` is now `no-session | unavailable | unconfigured`, and Phase 2's two
response bullets answer for both non-`no-session` variants.

Both this file and `plan.md` were run through Prettier on a **copy** first (test-plan §6.6's C10X-43
hazard), the diff inspected — no blockquote marker lost, no line collapsed — then written and
verified as a fixed point. One code span whose padding carried meaning (a regex alternative ending
in a backtick) was reworded rather than left for `--write` to strip.

## Findings

### F1 — Phase 2's `?error=` assembly is a shape Phase 3's guard rejects

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 → "`unavailable` + document" bullet
- **Detail**: The plan prescribes `context.redirect("/auth/signin?error=" + encodeURIComponent(message))`
  — string concatenation. Phase 3's guard, which the same plan registers this file with, cannot
  read that shape and actively rejects it. (a) `ERROR_INTERPOLATION`
  (`form-endpoint-guards.test.ts:177`) is `/error=\$\{([^}]*)\}/g` and matches **only** template-literal
  interpolation, so a concatenation yields zero emissions and the sweeps at `:595`/`:625` inspect
  nothing. (b) `INLINE_ERROR_LITERAL` (`:172`) carries a second alternative matching `?error=`
  followed immediately by a quote character — double, single or backtick; in `"…?error="` the
  character after `error=` **is** the closing double quote, so the detector fires and the case at
  `:372` goes red on a legitimate line. The precedent the plan itself cites does it the other way:
  `signout.ts:142` is a template literal.
- **Fix**: In Phase 2's contract, replace the concatenation with a single-line template literal
  matching `signout.ts:142` — a `context.redirect` over a template literal interpolating
  `encodeURIComponent(message)` — then set `Vary` on it as the existing branch does. Keep it on ONE
  line: `:660`'s known limitation is that a call Prettier wraps across lines matches nothing and is
  never inspected.
- **Decision**: FIXED — applied to Phase 2's contract, with both detector reasons stated at the site.

### F2 — The classifier is specified with two contradictory defaults

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 ("The `default` arm must fall to the SAFE side") vs Phase 1 §2
  ("A thrown-shaped plain object (`{}`) → `unavailable`")
- **Detail**: Phase 1 §1 mandates `default → no-session` and argues the direction at length ("a wrong
  `unavailable` banners a visitor who is simply signed out — the defect this ticket exists to remove,
  inverted"). Phase 1 §2 then requires `classifyAuthError({})` → `unavailable`. `{}` carries no `name`
  and no `code`, so it reaches the same default arm as an `AuthApiError` with an unrecognised `code`.
  One arm cannot answer both. Not cosmetic: an implementer who satisfies §2 by flipping the default
  ships the exact inverted defect §1 warns about; one who satisfies §1 leaves a truth-table row
  unsatisfiable.
- **Fix A ⭐ Recommended**: Keep `default → no-session` in the classifier, and map a THROW to
  `unavailable` in the middleware's `catch` without consulting it.
  - Strength: Matches the sibling exactly — `signout-outcome.ts:62-65` has the route build the outcome
    variant and the module map it, and `signout.ts:62` destructures a thrown value rather than
    classifying it. One arm, one direction, one argument.
  - Tradeoff: The `{}` / arbitrary-object rows leave the truth table (they become unreachable inputs),
    so Phase 1 §2's list shortens.
  - Confidence: HIGH — the throw path is the only producer of a shapeless value, and Phase 2 already
    owns it in a `try`/`catch`.
  - Blind spot: Whether any `AuthError` subclass can reach the classifier with `name` undefined is
    unverified; A treats that as `no-session`.
- **Fix B**: Two-tier default — nothing recognised at all (no known `name`) → `unavailable`; a
  recognised `AuthApiError` with an unknown `code` → `no-session`.
  - Strength: Both Phase 1 rows survive verbatim; a future GoTrue class rename surfaces as an outage
    rather than silently as `no-session`.
  - Tradeoff: Re-introduces §1's own hazard on the `name` axis — if auth-js ever renames
    `AuthSessionMissingError`, every anonymous visitor gets the outage banner.
  - Confidence: MEDIUM — defensible, but it splits the safety argument in two and both directions
    would have to be argued at the site.
  - Blind spot: Not measured against auth-js 2.105.3's full class list.
- **Decision**: FIXED via Fix A — Phase 1 §1's default arm made explicitly unconditional, Phase 1 §2's
  `{}` row re-pointed to `no-session`, Phase 2's `catch` required to construct `unavailable` directly
  without calling `classifyAuthError`, and D-03 restated to carry the division of labour.

### F3 — Three of Phase 4's five neuters cannot produce the evidence they claim

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 — the B1–B5 table
- **Detail**:
  - **B2** ("`default` arm flipped to `unavailable`", predicted ~16 red rows in `middleware.test.ts`
    "because those rows already ride the `AuthSessionMissingError` path"). They do — and under Phase 1's
    own split `AuthSessionMissingError` is matched **explicitly by name**, never by the default. Flipping
    the default touches unknown codes only, so the run comes back GREEN. The plan then instructs "If it
    comes back green, something is wrong with the wiring, not with the prediction", sending the
    implementer hunting a defect in correct code.
  - **B4** ("register the surface with the wrong `vouchingModule`"). The middleware imports nothing from
    `auth-errors` under this plan, so `ownedNames()` is empty either way; the exemption comes from
    `decisionModule`/`decisionFunctions` (`:516-533`), and the vocabulary check at `:681` resolves
    `decisionModule ?? vouchingModule`, so `decisionModule` still wins. Also a no-op — green.
  - **B3** ("the 503 branch returns 401 instead"). Nothing automated observes the 503 — Phase 2 adds no
    case, by the plan's own reasoning — so it reddens nothing in Phase 4, while criterion 4.1 requires an
    observed split with a denominator.
  - Only B1 and B5 work as written.
- **Fix**: Rewrite the three rows. **B2** → classify `AuthSessionMissingError` as `unavailable` (the
  literal naive-`if (error)` regression); predicted red is the two `it.each(PROTECTED_ROUTES)` blocks
  (7 + 7), the form-POST row (`:110`), the same-deck JSON row (`:118`) and the body-less fetch row
  (`:130`) ≈ **17 of 23**, with the `Vary` row and the three public-path rows staying GREEN as the
  attribution. **B4** → drop the landing function from `decisionFunctions` (or point `decisionModule`
  elsewhere): `decisionBound` goes empty, `message` stops being a vouched bare identifier, and
  `rejectionsIn` reddens with "`message` is neither imported from the closed set nor declared here".
  **B3** → move it into Phase 5 as a second variable of the dead-port run, or drop it and state that the
  status choice is observed manually only.
- **Decision**: FIXED — B2 re-targeted onto the `AuthSessionMissingError` arm with its per-row red/green
  prediction; the old B2 kept as B3 with an explicit "truth table only" denominator; B4 re-targeted onto
  `decisionFunctions` with the reason `vouchingModule` is a no-op; the 503-status neuter moved into
  Phase 5 as row 6 (Phase 5's criterion and Progress 5.4 updated to six rows).

### F4 — Phase 3 registers the surface but pins nothing to it; every floor is `>=`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — the four-floor table
- **Detail**: All four moved assertions are `toBeGreaterThanOrEqual` (`:349`, `:391`, `:662`, `:663`) and
  are already satisfied by the existing 8/7/30/7. So a middleware emission the walker cannot see — F1's
  shape, a Prettier-wrapped call, a later refactor — leaves every one of them green while the sweep
  inspects zero lines in the file it was added for. That is the "an empty sweep is green" failure the
  file's own header (`:340-347`) warns about, and the reason the existing surfaces carry NAMED pins the
  plan does not replicate: `:354` `toContain(SIGNOUT_ROUTE)` and `:666-668` per-file
  `emissionCount(...) > 0`.
- **Fix**: Add the two analogous pins in the same commit —
  `expect(scanned.map(({ file }) => file)).toContain(MIDDLEWARE_FILE)` at `:354`, and
  `expect(emissionCount(MIDDLEWARE_FILE)).toBeGreaterThan(0)` beside the two existing named pins.
  Re-measure the four floors to their new values as the plan already requires.
- **Decision**: FIXED — both named pins written into Phase 3's contract with the "empty sweep is green"
  reason, and carried into criterion 3.1 and Progress 3.1.

### F5 — The landing's return value must be destructured in one exact shape

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 contract / Phase 2 contract
- **Detail**: `decisionBoundNames` (`form-endpoint-guards.test.ts:526`) binds names only from the literal
  pattern `const\s*\{([^}]*)\}\s*=\s*(?:await\s+)?<fn>\s*\(`. The plan specifies
  `authGuardLanding(outcome)` → `{ message: string | null }` but never says how to consume it.
  `const landing = authGuardLanding(...)` followed by `landing.message` binds nothing, and `rejection()`
  refuses it at the identifier test (`:548`) **before** the exemption is consulted — deliberately, per
  its own comment. The precedent does it correctly at `signout.ts:89`.
- **Fix**: State in Phase 2's contract that the landing is consumed as
  `const { message } = authGuardLanding(outcome);`, and that a member access off a held object is
  refused by the guard by design.
- **Decision**: FIXED — the destructure shape pinned in Phase 2's contract with the `:526`/`:548`
  mechanism and the `signout.ts:89` template named.

### F6 — `{ kind: "signed-in" }` is a variant no call site constructs

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 §1 — `AuthCheckOutcome`
- **Detail**: Phase 2 computes the outcome only for a null-user result, and the landing is only ever
  reached inside `if (!context.locals.user)`. So `signed-in` is never constructed and its landing branch
  is unreachable — the truth table would assert a state production cannot produce. `SignOutOutcome`'s
  three variants are all constructed by `signout.ts`; this one's third is not.
- **Fix**: Drop the variant (leaving a two-state union) unless Phase 2 names the call site that builds it.
- **Decision**: FIXED — `signed-in` dropped. Applying it surfaced a second, latent defect in the same
  contract and it was fixed in the same edit: `unavailable` was specified as carrying **two different
  messages** (`AUTH_NETWORK_MESSAGE` for the outage, `AUTH_UNAVAILABLE_MESSAGE` for the `!supabase`
  branch, D-06), which one variant cannot hold. The union is now
  `no-session | unavailable | unconfigured` — every variant with a named call site, `unconfigured`
  produced by the `else` arm at `middleware.ts:51-53` and never passing through `classifyAuthError`.
  Both non-`no-session` outcomes answer through the same two representations; only the message differs.
