<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Signout stops presenting a failed signOut as success

- **Plan**: `context/changes/bug-signout-swallowed/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-13
- **Verdict**: REVISE → **SOUND after triage** (all 8 findings fixed or resolved, 2026-08-14)
- **Findings**: 2 critical, 3 warnings, 3 observations
- **Triage**: F1 Fix A · F2 Fix A · F3 fixed · F4 fixed · F5 fixed (mostly dissolved by F1) ·
  F6 fixed · F7 fixed · F8 resolved by F1. Progress↔Phase contract re-verified after the edits:
  5 phases, titles matching, 24 automated + 13 manual criteria all mapped.

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | FAIL    |
| Lean Execution        | PASS    |
| Architectural Fitness | FAIL    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

The rubric's "multiple FAILs → RETHINK" applies mechanically, but the verdict is REVISE:
Phases 1, 2, 4 and 5 are sound in shape, and both FAILs are fixable with targeted edits —
change the landing page (F1) and rescope Phase 3 (F2) — rather than by redesigning the change.

## Grounding

13/14 paths ✓ (`src/lib/signout-outcome.ts` new by design), 6/6 symbols ✓, brief↔plan ✓,
Progress↔Phase contract ✓ (5 phases, 25 criteria, every Success Criteria bullet mapped).

Verified correct beyond the sample: all four `test-plan.md` carve-out sites are at the exact
lines claimed (`:16`, `:1860`, `:1916`, `:5732`) and none in `README.md`/`AGENTS.md`; H-19 is
genuinely the next roadmap id and H-18's three anchors are exact (`:72`, `:446`, `:521`);
`src/pages/decks/index.astro:27` already vouches with `ownedRedirectMessage` and is a registered
surface, so `error-param-guard.test.ts` needs no change for Phase 2's banner; `callEndpoint` does
not follow redirects.

## Findings

### F1 — The /decks banner is dropped by the middleware in the dominant failure class

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Key Discoveries ("The guard doubles as an oracle") · Desired End State · Phase 2
- **Detail**: The plan's central claim is that `/decks` verifies the session for free — "if the
  session really did die … the middleware bounces the user to `/auth/signin` and drops the
  parameter with it. No false alarm is ever shown." But `middleware.ts:46-53` sets `locals.user`
  from `supabase.auth.getUser()`, a real round trip to GoTrue on every request. Research §2.2's
  top two failure rows are "`fetch` rejects (DNS/TCP/CORS), status 0" and "502/503/504" — i.e.
  GoTrue is unreachable. On the next hop the middleware's own `getUser()` fails for the same
  reason, `locals.user` becomes null, `/decks` matches `PROTECTED_ROUTES` (`middleware.ts:9`), and
  the user is redirected to `/auth/signin` **with the parameter dropped**. So in the class the plan
  itself calls dominant — and the class Phase 5 provokes — the user clicks "Wyloguj", lands on the
  sign-in page, sees no message, and the session cookie is still live: the original defect with a
  different landing page. The banner renders only where GoTrue answers `/user` but failed `/logout`
  (500, 429, unparseable) or where `signOut()` threw. Research half-saw this: `research.md:502`
  applies exactly this reasoning to the `null`-client case and routes that branch to `/auth/signin`
  for it, but never carries it back to the transport-failure branch. Note what this does to D-08:
  C10X-52 (`middleware.ts:47-50` reading `getUser()`'s error as "not signed in") is excluded as an
  unrelated read-side twin — it is not unrelated, it is the mechanism that eats this change's only
  user-facing channel.
- **Fix A ⭐ Recommended**: Land the failed sign-out on `/auth/signin?error=<new AUTH_MESSAGES member>`
  - Strength: Renders in every failure class whatever GoTrue's state — `/auth/*` is not in
    `PROTECTED_ROUTES`, and `signin.astro:7` already vouches with `ownedAuthMessage` into a
    page-level `ServerError`. No `decks/index.astro` edit, no `REDIRECT_MESSAGES` member, no
    size-pin move — and it is the landing already chosen for the `unconfigured` branch, so the
    route gets one landing page instead of two.
  - Tradeoff: The copy can no longer say "retry with the Wyloguj button on this page"; telling a
    still-signed-in user this on the sign-in page needs care in the wording. Phase 1's set/pin work
    moves from `redirect-errors.ts` to `auth-errors.ts`, which also removes Phase 3's reason to
    exist (see F2/F3).
  - Confidence: HIGH — the bounce, the protected-route list and the vouching read were each
    verified directly.
  - Blind spot: Whether "you are still signed in" on a sign-in page is acceptable UX is untested;
    it is at least truthful, which the current behaviour is not.
- **Fix B**: Keep `/decks` and state the boundary instead of claiming it away
  - Strength: No redesign; keeps the "retry here" copy for the classes where it works, and the deck
    page is where a still-signed-in user belongs.
  - Tradeoff: The dominant failure class keeps the original user-visible defect. Plan, brief and
    Success Criteria must all say so, and the ticket's acceptance ("a failed signOut must not
    present as success") is then met only partly — a call for the ticket's author.
  - Confidence: HIGH — same evidence.
  - Blind spot: Whether folding in C10X-52 is cheap enough to change this answer was never costed,
    because D-08 ruled it out before the interaction was noticed.
- **Decision**: FIXED via Fix A (2026-08-14) — landing moved to `/auth/signin`, message moved to
  `AUTH_MESSAGES`. Knock-ons applied: Phase 1 §1/§2 rewritten (`REDIRECT_MESSAGES` untouched at
  eleven; no size pin exists on `AUTH_MESSAGES`), Phase 2 §2 (the `/decks` banner) deleted with its
  absence recorded, D-08 annotated, the §2.4 false-alarm class re-recorded as accepted rather than
  neutralised, and the `AUTH_SESSION_MISSING_MESSAGE` adjacency hazard written into the copy
  contract. `plan-brief.md` synced.

### F2 — Widening the ?error= guard reddens four existing auth emissions; Phase 3 is silent on it

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 — Close the `?error=` guard blind spot
- **Detail**: Phase 3 widens `form-endpoint-guards.test.ts`'s two `?error=` sweeps from
  `DECKS_API_DIR` to `API_DIR` and identifies exactly one obstacle: `ownedNames` keying on the
  `@/lib/redirect-errors` import, fixed by keying on the redirect target. Running the guard's own
  `rejection()` logic verbatim (`ENCODE_WRAPPER`, `BARE_IDENTIFIER`, `localDeclarations`,
  `valuePositionLiterals`, `computedResidue`) against the two files the widening newly sweeps in
  shows that under the plan's **own** target-keyed fix, four of the six existing auth emissions are
  rejected:
  - `signin.ts:43` / `signup.ts:33` — `error=${encodeURIComponent(authErrorMessage(error))}` →
    "not an identifier: authErrorMessage(error)"
  - `signin.ts:29` / `signup.ts:20` — `error=${encodeURIComponent(message)}` where
    `const message = isFormContentType(...) ? AUTH_GENERIC_MESSAGE : AUTH_VALIDATION_MESSAGE` →
    "local `message` mixes the closed set with a computed value"

  Only `AUTH_UNAVAILABLE_MESSAGE` (`signin:36`, `signup:27`) is accepted. Target keying is necessary
  and nowhere near sufficient. Making these pass needs two new exemptions in `rejection()`: accept a
  call to a mapper total into the vouching set (`authErrorMessage`), and accept a ternary whose
  non-member residue is a predicate call. That is the one guard in this repo whose every previous
  exemption turned out to be a defect — `computedResidue` exists because "mentions an owned name"
  waved through `err.message` in three shapes (C10X-40 F1), and `localDeclarations` scans every
  declaration because first-match-wins hid a shadowed leak (F2). Each new exemption needs its own
  falsification run. Phase 3 is specified as one keying change and is at least a phase of work.

- **Fix A ⭐ Recommended**: Register `signout.ts` as an additional scanned path, do not widen the root
  - Strength: Closes the blind spot this ticket actually creates — its own new producer — without
    touching `rejection()`'s rules at all. The floors stay measurable against a set that grows by
    one file, and the "known limitation" comment keeps meaning what it says.
  - Tradeoff: `signin.ts`/`signup.ts` stay outside the sweep, so the SCOPE comment must be corrected
    to "the deck tree plus registered files" rather than "the whole API tree", and the auth mapper
    shape becomes a written, deliberate exclusion.
  - Confidence: HIGH — the rejection set was measured, not reasoned about.
  - Blind spot: A future auth-route emission still lands unguarded; the gap is named, not closed.
- **Fix B**: Do the full widening and add the two missing rules
  - Strength: Genuinely closes the class for the whole API tree, which is what the phase's title
    claims.
  - Tradeoff: Two exemptions in the file with the worst track record for exemptions, each needing
    its own breakage run and its own comment defending why it cannot chaperone an upstream string.
    Realistically doubles Phase 3.
  - Confidence: MEDIUM — the two shapes are known; whether a third surfaces once the sweep is green
    has not been established.
  - Blind spot: `authErrorMessage`'s totality into `AUTH_MESSAGES` is asserted by
    `tests/auth/errors.test.ts`, not by this guard — the exemption imports a property from another
    file's claims.
- **Decision**: FIXED via Fix A (2026-08-14) — Phase 3 rewritten from "widen the root" to a
  registered-surface table (deck tree → `redirect-errors`; `signout.ts` → `auth-errors`), with
  `ownedNames` parameterised on the module and `rejection()` untouched. The measured rejection table
  is written into the phase as the reason the original scope was dropped, the SCOPE comment's
  correction is re-specified to what is now true, a follow-up file carries the auth-route gap, and
  the criteria/Progress rows are re-cut (5 automated, 2 manual).

### F3 — Phase 3 cannot reach the emission it exists to enforce

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 §3 contract ↔ Phase 3 overview and criterion 3.2
- **Detail**: Phase 1 specifies that the pure module returns `location` as "the full relative URL
  including the encoded `?error=` value", so `signout.ts` becomes
  `return context.redirect(decision.location)` and contains no `error=` text at all. Phase 3's
  sweeps are textual and rooted at `src/pages/api`: applied to that route they find zero
  `ERROR_INTERPOLATION` matches, `emissionCount` returns 0, and the producer filter at `:254`
  (`/[?&]error=/.test(source)`) does not even classify the file as a producer. The real emission
  sits in `src/lib/signout-outcome.ts`, outside both guards' roots. So Phase 3's stated intent —
  "so Phase 2's new emission is enforced rather than conventional" — is not achieved by its
  contract. Criterion 3.2 would still go red (planting an inline literal puts `error=` text in the
  file), but it would test a hypothetical file, not the shipped one. What actually pins the emitted
  message is Phase 1's truth table (membership by equality) — fine, just not what Phase 3 claims to
  buy.
- **Fix**: Have `signout-outcome.ts` return the message plus a path (a `{ message, path }` pair) and
  assemble `?error=` in `signout.ts`, so the emission is textual in the file the guard scans.
  - Strength: Makes 3.2 assert the shipped code path; keeps the decision pure.
  - Tradeoff: `encodeURIComponent` and the path move back into the route, i.e. two lines the truth
    table no longer covers.
  - Confidence: HIGH — verified against the guard's walker and producer filter directly.
  - Blind spot: If F1 is resolved by Fix A (`/auth/signin` landing), Phase 3 may not be worth doing
    at all — decide F1 first.
- **Decision**: FIXED (2026-08-14) — Phase 1 §3's contract now returns `{ path, message, capture }`
  and `signout.ts` assembles `?error=` itself, in `signin.ts:36`'s shape. The truth table asserts the
  pair; the two uncovered lines are named as the guard's job rather than left implicit. Phase 2 §1
  and Phase 3 both state the dependency.

### F4 — The shared-account hazard and the success-path assertion rest on the same unverified fact

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details · Phase 2 §3
- **Detail**: Two claims stated as settled are the same open question read in opposite directions.
  The plan says a global sign-out "would invalidate A everywhere at once" (hence a third account),
  and the test must assert "the same cookie no longer resolves a user". Supabase's documented
  behaviour is that a global sign-out revokes refresh tokens while the **access token stays valid
  until it expires** — under which the assertion fails and the hazard does not exist. Under the
  opposite behaviour both hold. Nothing in the plan or research measures it. The third-account
  mechanism is also thinner than "follow `accounts.ts`'s provisioning path" suggests: `provision()`
  is module-local, `provisionAccounts()` hardcodes labels a/b and returns exactly two, and
  `ProvidedContext` declares only `accountA`/`accountB` — a third account means editing shared
  globalSetup, and `accounts.ts:10-15` argues explicitly against per-file provisioning on the rate
  limit it documents ("4 auth requests per run … roughly 7 runs per 5 minutes"). Criterion 2.3
  requires three consecutive `npm test` runs, taking that to 18 requests per triple against a
  30/5-min ceiling, alongside the e2e account.
- **Fix**: Settle the fact first with a throwaway script — sign in, capture the cookie,
  `signOut({ scope: "global" })`, then call `getUser()` with the old access token — and let the
  answer pick the design. If the token survives, drop the third account and assert on the staged
  clearing cookies in the response instead. If it dies, keep the third account and budget the
  globalSetup edit (`provision` export, a third `provide`, the `ProvidedContext` entry) into
  Phase 2.
- **Decision**: FIXED (2026-08-14) — Critical Implementation Details rewritten around the
  measurement, with both design branches spelled out and the rate-limit budget quantified. Phase 2 §3
  no longer prescribes the second assertion or the owned account; both now wait on the measured
  answer. New criterion 2.0 (Phase 2 Manual + Progress) makes the measurement a gated step rather
  than an intention.

### F5 — The manual provocation breaks the middleware's own client, so it cannot observe the branch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5 §1 · Testing Strategy steps 2-3
- **Detail**: Phase 5 points `SUPABASE_URL` at a dead port and expects "`AuthRetryableFetchError`
  (status 0), the `/decks` banner, and the session provably still alive". The same env change
  disables `getUser()` for every subsequent request, so the redirect to `/decks?error=…` is bounced
  to `/auth/signin` and the parameter is dropped (F1). The banner cannot appear. The plan senses
  this — "write down what that does to the next hop — otherwise the run is uninterpretable" — but
  still records the banner as the expected outcome, and this is the run that carries the whole
  ticket's evidence. It holds independently of how F1 is resolved: a whole-project outage cannot
  isolate a `/logout` failure, so no landing page is observable through it.
- **Fix**: Provoke `/logout` only. Point `SUPABASE_URL` at a small local reverse proxy that answers
  `/auth/v1/logout` with 500 and passes every other path through to `127.0.0.1:54321` — GoTrue stays
  reachable for `getUser()`, so the intended landing is actually reached and the still-alive session
  is provable on the next hop. Keep the dead-port run as a second, separately recorded observation:
  it is the evidence for F1, not for the fix.
- **Decision**: FIXED (2026-08-14), and mostly dissolved by F1's fix rather than by this one. With
  the landing on `/auth/signin` — an unprotected page — the middleware's failing `getUser()` has
  nothing to bounce, so the dead-port provocation reaches the banner after all and the proxy is not
  needed. What survived is the sequencing, now binding in Phase 5 §1 and steps 1-6: "still alive"
  cannot be shown while the port is dead, so the order is fail → observe → restore → load `/decks`
  without re-signing-in. The proxy variant (500 on `/auth/v1/logout` only, covering the 500 class
  rather than status 0) was offered and deliberately not taken.

### F6 — The rename's pointer sweep names 2 of 8 live references

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §3 "The pointers that move"
- **Detail**: Phase 4 renames `tests/lib/audit-failure-wiring.test.ts`; Phase 5 §3 names
  `src/worker.ts` and `test-plan.md` §7 as the pointers to repoint. There are eight live references:
  `src/pages/api/generate.ts:484`, `src/worker.ts:43`, `tests/lib/audit-failure-report.test.ts:23`,
  and `test-plan.md` at `:58`, `:1952`, `:1957`, `:4237` (§7) and `:5652`. Archive hits take dated
  corrections, not edits. Separately, `generate.ts:6` ("the ONLY module in `src/` that imports the
  Sentry SDK besides `src/worker.ts`") goes false the moment Phase 4 adds the import to
  `signout.ts` — a live claim, not a pointer. This is the incomplete-sweep class
  `form-endpoint-guards.test.ts`'s own header records ("found incomplete twice by reading, not by a
  red run").
- **Fix**: Enumerate by grep at doc-sync rather than from this list, and add `generate.ts:6`'s "ONLY
  module" sentence as a ninth target.
- **Decision**: FIXED (2026-08-14) — Phase 5 §3 now carries the eight measured sites as a table,
  with the contract stated as "enumerate by grep at doc-sync; do not work from this list", the
  archive's dated-correction rule restated, and `generate.ts:6`'s "ONLY module" sentence added as a
  live claim that goes false rather than stale.

### F7 — Criterion 4.6's denominator is wrong

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 success criteria · Progress 4.6
- **Detail**: "`generate.ts`'s existing five claims all still pass after the rewrite."
  `audit-failure-wiring.test.ts` has seven `it()`s — six about `generate.ts`, one a detector-only
  positive control on fabricated strings (`:158`). `test-plan.md` records the file at 7 cases in two
  places. An implementer checking off 4.6 against "five" will either hunt for a missing claim or
  drop one.
- **Fix**: Restate as "seven `it()`s — six `generate.ts` claims plus the detector control", or
  re-measure and write the number down at implementation time.
- **Decision**: FIXED (2026-08-14) — corrected in Phase 4's criteria, in Progress 4.6 and in
  `plan-brief.md`'s phase table, with the superseded "five" recorded and a re-measure instruction
  attached.

### F8 — Phase 2 leaves a decision unresolved in the plan body

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §2
- **Detail**: "Verify the double-render question explicitly … Decide and record which one wins
  (recommended: leave both, since no producer emits both parameters together — but assert that
  rather than assume it)." That is a decision deferred into implementation, with no criterion in
  Phase 2's list and no Progress row covering it.
- **Fix**: Decide it in the plan — no producer emits `error` and `open=create` together, so leave
  both renders and record the reason; if it is worth asserting, give it a Progress row.
- **Decision**: RESOLVED BY F1 (2026-08-14) — not deferred, removed. F1's fix replaces Phase 2 §2
  with "The banner — nothing to build": `decks/index.astro` is no longer touched, so there is no
  page-level `ServerError`, no `mb-4` wrapper and no `?error=X&open=create` double render to decide
  about. The section is kept with its absence recorded, so nobody hunts for a missing decision.
