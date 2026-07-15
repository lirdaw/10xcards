<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test Harness Bootstrap + Per-Account Isolation

- **Plan**: `context/changes/verification-harness/plan.md`
- **Scope**: Full plan (Phases 1–5)
- **Date**: 2026-07-15
- **Verdict**: REJECTED at review → **APPROVED after triage** (all 6 findings fixed)
- **Findings**: 1 critical, 2 warnings, 3 observations — 6 fixed, 0 skipped

## Verdicts

| Dimension | At review | After triage |
|-----------|-----------|--------------|
| Plan Adherence | WARNING | PASS |
| Scope Discipline | PASS | PASS |
| Safety & Quality | FAIL | PASS |
| Architecture | PASS | PASS |
| Pattern Consistency | PASS | PASS |
| Success Criteria | PASS | PASS |

Automated criteria re-run during this review: `npm run lint` clean, `npm test` 15/15 across 4 files,
`npm run build` complete. Re-run again after all triage fixes: all three still green.

The REJECTED verdict rests entirely on F1 — a data-safety hole with a ~6-line fix. Everything else
in this change is sound.

## Findings

### F1 — Preflight never asserts the target stack is local

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (data safety)
- **Location**: `tests/setup/preflight.ts:78-84`
- **Detail**: Preflight checks four things — `SUPABASE_URL` set, `SUPABASE_KEY` set, key is anon,
  stack reachable. A **cloud/production project passes all four**: its anon key is
  `sb_publishable_`, and it is trivially reachable. Nothing checks the host.

  This is not theoretical. `.env` in this repo instructs, verbatim: *"To run dev against cloud, swap
  these into SUPABASE_URL / SUPABASE_KEY above"* — the documented workflow puts the production URL
  into the exact variable the suite reads. In that state `npm test`:
  1. passes preflight,
  2. signs up real users `harness-{a,b}-<runId>@example.com` in **production auth**
     (`tests/fixtures/accounts.ts:45,54`) with the hardcoded password `"harness-passw0rd"`
     (`accounts.ts:33`) — a known-credential account in the production auth table,
  3. creates and deletes decks for real (`tests/isolation/decks.test.ts:99-117`).

  The change **knows** about this hazard and guards it in CI only — `.github/workflows/ci.yml:35-37`
  says "Point it at the cloud project and it would create junk users in production". CI is
  fail-closed; the developer machine, which is exactly where the documented swap happens, is
  fail-open.

  This is also a **plan flaw**, not just an implementation gap: the plan's preflight contract
  (`plan.md:189-191`) names only the three checks that were built. The guard's stated purpose is to
  refuse a misconfigured environment — and "pointed at production" is the worst misconfiguration
  available.
- **Fix**: Add a hostname assertion to `preflight.ts`: reject any `SUPABASE_URL` whose hostname is
  not `127.0.0.1` or `localhost`, in the same `fail()` style as the existing checks. Deliberately
  **no env opt-out** — an escape hatch in `.env` would re-open the exact hole, and a genuine
  non-local run should require a deliberate code edit.
  - Strength: Closes the one path that turns a test suite into a production writer, in ~6 lines,
    using the mechanism already in the file. Also hardens the CI failure mode where reordering
    `npm test` above the export step would silently inherit the cloud secrets from `npm run build`.
  - Tradeoff: None meaningful — no phase in `test-plan.md` §3 targets a non-local stack.
  - Confidence: HIGH — the swap workflow is documented in `.env`; the hazard is stated in this
    change's own CI comment.
  - Blind spot: None significant.
- **Decision**: FIXED — `assertLocal()` added to `tests/setup/preflight.ts`, called before the
  reachability check so no request is ever sent to a non-local host. No env opt-out. Verified:
  `SUPABASE_URL=https://abcdefgh.supabase.co` is rejected with the actionable message; the normal
  local run still passes 15/15.

### F2 — `createDeck` helper's 302 assertion cannot distinguish success from failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (test integrity)
- **Location**: `tests/isolation/decks.test.ts:33`, `tests/isolation/flashcards.test.ts:44`
- **Detail**: Both helpers assert only `expect(response.status).toBe(302)`. But
  `src/pages/api/decks/index.ts` answers **every error path with a 302 too** (lines 14, 27, 33, 41 —
  `/decks?error=…&open=create`), per the AGENTS.md form-POST convention. A validation failure,
  duplicate name, or DB error is therefore indistinguishable from success at that assertion; it is
  decorative.

  Not currently vacuous — the `if (!created) throw new Error("Setup failed…")` guard on the next
  lines catches a genuinely absent deck. But `positive-control.test.ts:38-39` already does this
  right (`expect(response.headers.get("Location")).toBe("/decks")`), so the suite is inconsistent
  with itself on exactly the "status is not evidence" point this change exists to make.
- **Fix**: Assert `Location` alongside the status in both helpers, matching `positive-control.test.ts`.
- **Decision**: FIXED — `expect(response.headers.get("Location")).toBe("/decks")` added to both
  `createDeck` helpers, with a comment naming why the status alone is not evidence.

### F3 — Roadmap F-03 Status deviates from the plan with no record of why

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/roadmap.md:49`, `:122`
- **Detail**: Plan Phase 5 §3 (`plan.md:498`) says: "Update F-03's Outcome to name the delivered
  scope; set Status → `done`." The Outcome landed; Status reads `proposed` in both carriers (slice
  table `:49` and detail block `:122` — consistent with each other).

  The deviation was deliberate and correct: `roadmap.md:234` reserves the Status flip and the `Done`
  entry for `/10x-archive` ("NIE wypełniać ręcznie"), and the change is not shipped. But **nothing in
  the change records that reasoning** — the plan still instructs the flip, and Progress rows 5.4/5.5
  are `[x]`. A future reader sees an unexplained miss, not a decision.
- **Fix**: Add a note to the plan's Phase 5 Progress block recording that §3's "Status → `done`"
  instruction was deliberately not followed because `/10x-archive` owns that flip, and the change is
  not yet shipped.
  - Strength: Keeps the plan honest as the source of truth without pre-declaring a `done` that isn't
    true, and without double-writing what `/10x-archive` will do anyway.
  - Tradeoff: The plan text and the artifact stay out of step until archive runs.
  - Confidence: HIGH — `roadmap.md:234` is explicit about ownership.
  - Blind spot: None significant.
- **Decision**: FIXED — deviation note added to the plan's Phase 5 Progress block, recording that
  `/10x-archive` owns the Status flip and the change is not shipped.

### F4 — "consecutive runs never throttle" is overstated

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `tests/fixtures/accounts.ts:12-13`
- **Detail**: With `sign_in_sign_ups = 30` per 5 min per IP and 4 auth requests per run, real
  headroom is ~7 runs per 5 minutes, not "never". The 8th run inside 5 minutes throttles in
  `globalSetup` and surfaces as a generic sign-in failure rather than a rate limit — misleading
  exactly when a developer is iterating fastest.
- **Fix**: Soften the comment to state the real headroom (~7 runs / 5 min), and/or detect the 429 and
  report it as a rate limit.
- **Decision**: FIXED — comment now states ~7 runs / 5 min and tells the reader to suspect the rate
  limit before the harness when globalSetup fails to sign in.

### F5 — The signed-out path is uncoverable by this harness and is not recorded as negative space

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `tests/fixtures/endpoint.ts:65`
- **Detail**: `locals.user` is always injected, so the harness cannot exercise the signed-out path —
  neither the middleware `PROTECTED_ROUTES` guard nor each endpoint's own
  `if (!context.locals.user)` branch. This is correct and follows the recorded Container-API lesson.
  `test-plan.md` §6.6 records the middleware guard as uncovered, but not the per-endpoint
  signed-out branch.
- **Fix**: Extend the §6.6 "Not covered, deliberately" note to name the per-endpoint
  `!locals.user` branch alongside the middleware guard.
- **Decision**: FIXED — §6.6's note reframed as "the whole signed-out path", naming both the
  middleware guard and each endpoint's own `!locals.user` branch.

### F6 — Two justified deviations documented in code but never reflected in the plan

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `vitest.config.ts:38-41`, `.github/workflows/ci.yml:29-46`
- **Detail**: (a) The plan's contract says `vitest.config.ts` default-exports `getViteConfig({test})`;
  it actually exports an async wrapper that strips `@cloudflare/vite-plugin`, because that plugin
  fights Astro over the `ssr` environment and kills config resolution. Reason is documented in-file
  (`:8-12`). (b) The plan says the test step goes "before or alongside lint"; it sits after lint and
  build. Behaviourally identical — same job, same `deploy: needs: ci` gate — only feedback latency
  differs. Both are justified; neither is wrong; the plan text was simply never amended.
- **Fix**: No code change. Note both in the plan if the plan is meant to stay a faithful record.
- **Decision**: FIXED — deviation notes added to the Phase 1 and Phase 4 Progress blocks.

## Cleared (verified, not assumed)

- **No secrets committed.** `.env` is gitignored (`.gitignore:29`); `.env.example` values are empty;
  `git grep` for `service_role` / `sb_secret_` over tracked non-doc files returns only prose in
  comments and the preflight guard itself.
- **The anon-key assertion is the standout.** `preflight.ts:33-64` rejects a secret key in both
  formats, enforcing what `init_core_schema.sql:86-89` states in prose only.
- **Tests are non-vacuous.** Verified against pre-fix code: `deleteDeck` had no RETURNING and always
  redirected 302, so `decks.test.ts:92`'s `expect(404)` genuinely fails without the fix.
  Independently verified this review cycle: relaxing `flashcard_select` to `using (true)` turns the
  flashcard read test red while the other 5 stay green.
- **CI is fail-closed.** The credential export runs before `npm test` and overwrites the build step's
  cloud secrets in `GITHUB_ENV`; step-scoped secrets don't persist; only `API_URL` / `PUBLISHABLE_KEY`
  reach `status.env`; `deploy` has `needs: ci`.
- **Pattern compliance clean.** `deleteDeck` matches `deleteFlashcard` / `renameDeck` exactly
  (`.select("public_id").maybeSingle()`); the endpoint branches error-first then `!deleted` → 404,
  respecting the recorded "error is not empty" lesson.
- **All five "What We're NOT Doing" boundaries hold**: no middleware test, no `.astro` rendering, no
  RLS-gap migrations, no e2e, no LLM mocking.
- **Extras are justified, not creep**: `tests/setup/accounts.ts` (globalSetup shim required by the
  plan's own rate-limit constraint), `plan-brief.md` (standard chain artifact), `session.ts`'s
  `clientFor` (what makes every owner-side re-read possible).
- **`lessons.md` compliance**: four applicable recorded rules, all followed — the RETURNING rule is
  literally what this change applies to production code.
