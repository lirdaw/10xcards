<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Signout stops presenting a failed signOut as success

- **Plan**: `context/changes/bug-signout-swallowed/plan.md`
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-08-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Gates re-run for this review

Independently executed against the tree at `78a6557`, not carried over from the plan's Progress section:

| Gate                           | Result                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `npm run typecheck`            | OK — `Result (157 files)`, 0 errors, 0 warnings                                                  |
| `npm run lint`                 | 0 errors, 3 pre-existing `no-console` warnings in `evals/generation-quality.eval.ts`             |
| `npm test`                     | **501 passed / 501, 40 files**, seed `1786708098540` — matches the figure `test-plan.md` records |
| `npm run build`                | Complete; only the standing `@astrojs/sitemap` `site` warning                                    |
| `git status --porcelain -uall` | clean                                                                                            |

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

**Plan Adherence — PASS.** Every planned item is implemented as contracted; nothing is MISSING and there is no undocumented DRIFT. Four deviations exist and all four were recorded in `change.md` or `verification.md` _before_ this review: the `rejection()` exemption (Phase 3, measured first, user-decided, given its own control — see F1 for the residual), H-19's `Status`/Done-bullet left to `/10x-archive` per `lessons.md`, five `test-plan.md` pointer sites left verbatim under the dated-entry rule, and `tests/fixtures/endpoint.ts` added because a planned assertion was otherwise unassertable (measured: the Container API materialises no `Set-Cookie`).

**Scope Discipline — PASS.** All five "What We're NOT Doing" guardrails hold, verified by _absence from the diff_ rather than by reading: `src/middleware.ts` (C10X-52), `src/lib/redirect-errors.ts`, `tests/lib/redirect-errors.test.ts`, `AuthenticatedLayout.astro`, `Topbar.astro`, `dashboard.astro`. `REDIRECT_MESSAGES` still pinned at eleven. No local session-clearing, no island, no `retriable` flag, no backfill.

**Success Criteria — PASS.** All four automated gates re-run green above. The manual criteria are evidenced rather than rubber-stamped: `verification.md` (713 lines) carries the Phase 2 §0 access-token measurement with its control, the re-measured guard floors obtained by `toBe(-1)` probes in both directions, per-neuter breakage tables with observed failure strings, the manual run driven twice (curl + real browser), and hash-verified restores.

## Findings

### F1 — The new `?error=` guard exemption grants per MODULE while its defence is per FUNCTION

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/lib/form-endpoint-guards.test.ts:487
- **Detail**:
  `decisionBoundNames` vouches for any name destructured from a call to **every** identifier the file imported from the declared decision module — `for (const fn of ownedNames(source, module))` at `:487`, where `ownedNames` (`:428-443`) returns the whole braced import list. `src/pages/api/auth/signout.ts:12` imports three names from `@/lib/signout-outcome` in one list: `buildSignOutFailureReport`, `signOutLanding`, `SIGNOUT_CAPTURE_MESSAGE`.

  The exemption's own docblock (`:472-478`) grounds its safety on one of them only: _"`signOutLanding` is total into `AUTH_MESSAGES` … which is why it names the file rather than merely asserting 'trust the decision module'."_ The code does assert trust the decision module. Concretely, `const { tags } = await buildSignOutFailureReport(cause);` followed by `` `?error=${encodeURIComponent(tags)}` `` passes the sweep — and `tags` carries `cause.name` and `cause.code` verbatim from upstream (`src/lib/signout-outcome.ts:212-218`).

  **Not a live leak today**, and the finding is scoped accordingly: nothing destructures the builder, and `tags` would stringify to `[object Object]` rather than to a value. It is a latent widening of the grant beyond what backs it.

  What makes it worth a finding rather than a note is this file's own recorded history, stated in its header at `:63-66`: _"This is the one guard in this repo where EVERY previous exemption turned out to be a defect."_ The exemption does carry a falsification control (`:681-700`), and it is a good one — but its fixture imports only `signOutLanding`, and it tests a call to a function **not** imported from the module (`somebodyElse`, `:686`, `:693`). The case that would have caught this — a binding destructured from a _different_ function that **is** imported from the declared module — is the one shape the control does not fabricate.

- **Fix**: Narrow the grant to the function(s) the defence actually covers, and give the narrowing its own control.
  - Add a `decisionFunctions: readonly string[]` (or a single `decisionFunction: "signOutLanding"`) to `ErrorParamSurface` beside `decisionModule` (`:82-87`), and in `decisionBoundNames` iterate `ownedNames(source, module)` **intersected** with it rather than whole.
  - Extend the control at `:681-700` with a fourth line in the fixture — a `const { message: fromSibling } = buildSignOutFailureReport(cause);` whose import sits in the same braced list — asserting `fromSibling` keeps the `neither imported` verdict.
  - Strength: makes the code's grant equal to the docblock's claim, so the borrowed-claim sentence at `:472-478` becomes literally true; closes the shape before a second function on that module makes it reachable.
  - Tradeoff: one more field to keep in step, and it re-opens the guard file that Phase 3 just measured — so the three floor probes and both breakage runs in `verification.md` §Phase 3 should be re-run to confirm the numbers are unmoved (they should be: the intersection is a no-op for the only binding in the file today).
  - Confidence: HIGH — read directly off `:487` plus the single-list import at `signout.ts:12`; the grant's breadth is three lines of code, not an inference.
  - Blind spot: I did not execute a probe proving the wider grant accepts a builder-destructured binding — the functions are closure-local and not exported, and mutating `src/` during a review was out of scope. The fix should ship with that falsification run, per this file's own standard.

### F2 — `accounts.ts`'s rate-limit budget is now false, in the file whose purpose is that invariant

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/fixtures/accounts.ts:13
- **Detail**:
  The module header still reads: _"Provisioning once per run keeps the whole suite at **4 auth requests per run** — roughly **7 runs per 5 minutes** before the limit bites."_ Phase 2 exported `provision` and `tests/auth/signout.test.ts:43` now calls it, adding a `signUp` + a `signIn` on every run that executes that file. Against `sign_in_sign_ups = 30` per 5 min per IP (`supabase/config.toml`), the suite is at **6 per run — roughly 5 runs**, not 7.

  This matters more than an ordinary stale number because the same header tells the reader what to check when it bites: _"if you are iterating hard and globalSetup starts failing to sign in, suspect the rate limit before the harness."_ The budget it quotes is the figure they will check against.

  The new `provision` docblock (`:37-49`) documents _why_ the caller must mint its own account and is silent on the cost, and `test-plan.md`'s new §6.4 bullet does state "Rate-limit cost: 2 auth requests" — so the doc-sync reached the plan and missed the source. Same shape as the pointer-rot class this project's own ledger keeps recording.

- **Fix**: Amend `accounts.ts:13-14` to 6 auth requests per run / roughly 5 runs per 5 minutes, naming the third account and `tests/auth/signout.test.ts` as the file that mints it — and say that the cost is paid only on runs that execute that file.

### F3 — The capture statement is the one link on the failure path with nothing above it

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signout.ts:106
- **Detail**:
  `src/lib/signout-outcome.ts:190-195` states the no-throw requirement as _"a hard contract rather than a nicety"_, and the builder honours it — verified, not assumed: `fingerprint` wraps both the serialisation and `crypto.subtle.digest` in a total `try`/`catch` returning `UNSERIALIZABLE` (`src/lib/audit-failure-report.ts:150-157`), and everything else in `buildSignOutFailureReport` is a property read on a plain object. The contract even has a `resolves` assertion over hostile input (`tests/lib/signout-outcome.test.ts:307`).

  What the contract does not cover is `Sentry.captureException` itself, which sits outside any handler at `:106-108`. If the SDK ever threw, the rejection escapes the async `APIRoute` and Astro answers an uncaught 500 — replacing the 302 that carries the banner. That is the regression class this ticket exists to remove, and worse than the pre-fix behaviour, because the user then gets no page at all rather than a wrong one.

  Two things hold the severity at OBSERVATION rather than WARNING. The exposure is **identical in shape to the sibling** (`src/pages/api/generate.ts:509`, `:568`), so it is the established project pattern rather than drift introduced here. And with no client configured — the state under the runner and under `npm run dev` without a DSN — `captureException` returns an event id and does nothing else, which `signout.ts:5-11` already documents. What differs from the sibling is the consequence: there a throw replaces an already-error 502/422; here it replaces the **only** channel the user has.

- **Fix A ⭐ Recommended**: Wrap `:106-108` in `try { … } catch { /* a forensic report must never outrank the response it annotates */ }`.
  - Strength: makes the response unconditional, which is exactly what the contract at `signout-outcome.ts:190-195` reasons toward and stops one level short of. The wiring guard is unaffected — `captureStatements` joins on parenthesis depth (`tests/lib/sentry-capture-wiring.test.ts:190-207`) and is indifferent to indentation or an enclosing block.
  - Tradeoff: `signout.ts` then diverges from `generate.ts`'s two call sites, so the honest options are to accept the inconsistency or to wrap all three — and the second is scope this ticket did not take.
  - Confidence: MED — that the wrap is safe and cheap is high confidence; that it is _needed_ rests on the SDK throwing, which is not demonstrated and which the SDK's design argues against.
  - Blind spot: I did not attempt to make `captureException` throw. Whether a configured client with a throwing `beforeSend` can propagate out of `captureException` on `@sentry/cloudflare` is unverified in either direction.
- **Fix B**: Leave the code and record the reasoning at the site — one sentence saying the capture is deliberately unwrapped, that it matches `generate.ts`, and that the SDK is a documented no-op without a client.
  - Strength: keeps the three first-party capture sites byte-identical in shape, which is what the new registered-targets guard reads.
  - Tradeoff: leaves the one asymmetry that matters unrecorded — that here the 500 would eat the user's only channel, where at the sibling it replaces an error response.
  - Confidence: MED — defensible; it trades a real if unlikely failure mode for consistency.
  - Blind spot: same as A.

### F4 — `thrownAsCause` drops `message`, and its docblock justifies the narrowing by a mapper this route never calls

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signout.ts:52
- **Detail**:
  Two halves, both small.

  The docblock (`:47-50`) says: _"Anything unrecognisable degrades to `{}`, which **the mapper** answers with a project constant rather than by failing."_ There is no mapper on this path — `signOutLanding` returns a fixed `SIGNOUT_FAILED_MESSAGE` for every `failed` cause regardless of the cause, and `authErrorMessage` has exactly two callers, `signin.ts:43` and `signup.ts:33`. The narrowing's only real consumer is the report builder.

  The consequence: because `message` is stripped before the builder sees it, a **thrown** failure produces `{name:"none", code:"none", status:"none"}` with `cause_message_fingerprint: null` — an event with zero discriminating content, on a path the route's own comment (`:41-46`) names as genuinely reachable. That is the _safe_ direction, so it is not a security finding. But it partly defeats the argument at `signout-outcome.ts:139-144`, which widens `SignOutFailureCause` with `message` specifically _"so this builder has to see the field in order to promise it never leaves verbatim"_ — a promise the throw path never gets to make.

- **Fix**: Let `thrownAsCause` carry `message` through when it is a string and return `SignOutFailureCause` rather than `AuthErrorLike`; correct the docblock sentence to name the report builder rather than "the mapper". The builder already fingerprints the field, the truth table already covers a non-string `message` (`tests/lib/signout-outcome.test.ts:308`), and the URL is unaffected because no message from the cause ever reaches it.

### F5 — The "tags are a closed upstream vocabulary" claim does not cover the throw path

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/signout-outcome.ts:208
- **Detail**:
  The builder justifies passing `name`/`code`/`status` verbatim as tags: _"assigned by the SDK's own error classes and by GoTrue's response envelope, not by anything the user typed"_ — borrowed from `audit-failure-report.ts:192-197`, where the equivalent claim is about PostgREST's closed `code` vocabulary.

  That is exactly right for the `{ error }` branch, where `cause` is a real `AuthError`. It is not established for the `catch` branch: `thrownAsCause` (`signout.ts:52-60`) accepts **any** thrown object and copies whatever strings sit on its `.code` and `.name` into Sentry tags, with no bound on origin or length. Realistically the throwers are Astro's `cookies.set` and auth-js subscriber callbacks, neither of which puts submitted values in those fields — so the residual risk is genuinely small. The finding is that the comment asserts a property the code does not enforce, which is the "correct on what it looks at, silent about what it never looks at" shape this repo's guards keep re-recording.

- **Fix**: Scope the sentence to the returned-`AuthError` path and say the throw path is bounded by who can throw — or, cheaper and checkable, clamp both tag values to a fixed length in the builder and let the truth table pin it.

## What this review confirmed rather than found

Recorded so the absence of a finding does not read as an absence of looking.

- **No leak on either channel.** `tags` and `extra` carry no user id, e-mail, access/refresh token or cookie value; the builder reads named properties and never spreads `cause`, pinned at `tests/lib/signout-outcome.test.ts:295-300` with two sentinels. `message` travels only as length + digest prefix.
- **The captured exception is synthetic** (`signout.ts:107`), so an `AuthError`'s own `message` never lands on `exception.values[].value` where no builder can reach it — enforced textually by the wiring guard.
- **No open redirect**: `path` is one of two module-level constants; nothing from the request reaches it. The route reads no query string, no `Referer`, no form field. `encodeURIComponent` is applied at `:115`, matching `signin.ts:36`.
- **`signOutLanding` is total** over its union with no `default`, so a fourth variant is a compile error; no branch maps a failure onto `/`, and the control's second half (`Set(paths).size === 2`) is what catches a collapsed path — added after a measurement showed pair-distinctness alone stays green.
- **All four AGENTS.md hard rules hold** in the changed `src/` files: `@/*` imports only, no `import.meta.env` / `process.env`, no `console.*`. `generate.ts` and `worker.ts` are comment-only, verified mechanically by stripping comment and blank lines from the diff.
- **The `generate.ts:6` live claim was corrected in the same commit that made it false** (`54cb368`) — "the ONLY module besides `worker.ts`" → "one of THREE".
- **The catch-all in `sentry-capture-wiring.test.ts:391-433` closes the class** rather than adding a row, and carries its own positive control (≥80 files scanned; four named files present; both registered targets excluded).

## Decisions

### F1 — Guard exemption grants per module, defence is per function

- **Decision**: FIXED — grant narrowed to declared functions, driven TEST-FIRST.
  - `ErrorParamSurface` gained `decisionFunctions`; the sign-out surface declares
    `SIGNOUT_DECISION_FUNCTIONS = ["signOutLanding"]`, named once so the table and its control
    cannot disagree. `decisionBoundNames(source, functions, module)` now **intersects**
    `ownedNames(...)` with the declared set rather than taking it whole.
  - **The blind spot this report recorded is closed by measurement.** The control case was written
    and run BEFORE the narrowing: with the module-keyed grant it went **1 of 11 red**, on
    `expected [ 'fromSibling', 'message', …(2) ] to deeply equal [ 'message', 'path', 'relabelled' ]`
    — i.e. the wider grant demonstrably did bind a name destructured from a sibling export
    (`const { tags: fromSibling } = await buildSignOutFailureReport(cause);`). After the narrowing:
    **11 of 11 green**.
  - The control gained two further halves: a binding off a declared-module export the surface never
    declared keeps its `neither imported` verdict, and a surface naming a module but no function
    opts into nothing (the other side of the intersection).
  - **Denominator unchanged at 11** — the new assertions went into the existing `it()`, so the deck
    surface's verdicts and all three re-measured floors (8 / 30 / 7) are untouched by construction
    and observed green.
  - Re-verified: `npm run typecheck` 157 files 0 errors; `npm test` **501/501, 40 files**, fresh
    seed `1786709221101`.

### F2 — `accounts.ts` rate-limit budget now false

- **Decision**: FIXED — header at `tests/fixtures/accounts.ts:13` now states 6 auth requests per
  whole-suite run and roughly 5 runs per 5 minutes, names the third account and
  `tests/auth/signout.test.ts` as the file that mints it, and records that the third pair is paid
  only on runs that execute that file (a filtered run is back to 4). The "suspect the rate limit
  before the harness" sentence it precedes now points at a true number.

### F3 — Capture statement unwrapped on the failure path

- **Decision**: FIXED via Fix A — `src/pages/api/auth/signout.ts:106-108` wrapped in `try`/`catch`,
  so the redirect is unconditional.
  - The **divergence from `generate.ts:509`/`:568` is deliberate and stated at the site**, with the
    asymmetry that justifies it: at the siblings a throw would replace an already-error 502/422,
    here it would replace the only channel the user has. The empty `catch` carries a comment
    explaining that it is the one correct swallow in this file, and that nothing is logged because
    `src/` writes no console output.
  - The wiring guard is unaffected, as predicted: `captureStatements` joins on parenthesis depth
    and is indifferent to the enclosing block. Verified green rather than argued.

### F4 — `thrownAsCause` drops `message`; docblock cites a mapper not on this path

- **Decision**: FIXED — `thrownAsCause` now returns `SignOutFailureCause` and carries `message`
  through when it is a string, so a thrown failure produces a fingerprinted event instead of
  `{name:"none", code:"none", status:"none"}` with a null digest. The docblock no longer cites "the
  mapper" (which this route never calls) and instead names the report builder as the only consumer,
  and records that the field is safe because it leaves as a length plus a digest prefix — the very
  promise `SignOutFailureCause` widens the type to make, and which stripping the field had denied
  the throw path. The now-unused `AuthErrorLike` type import was removed.

### F5 — Tags-verbatim claim does not cover the throw path

- **Decision**: FIXED (documentation) — the claim at `src/lib/signout-outcome.ts:207` is scoped to
  the returned-`AuthError` path, and the throw path's actual bound is written down as what it is:
  not "a closed upstream vocabulary" but _who can throw_ (Astro's `cookies.set`, auth-js subscriber
  callbacks), which is a narrower guarantee. `message` is noted as needing no caveat on either path
  because it is fingerprinted.
  - The alternative in the original Fix — clamping both tag values to a fixed length — was **not
    taken**, deliberately: the finding is that a comment asserted more than the code enforced, and a
    clamp would be a behaviour change needing its own truth-table case. Left as the cheaper option
    if the throw path ever gains an untrusted thrower.

## Post-triage verification

Run after all five fixes, against the working tree:

| Gate                | Result                                                              |
| ------------------- | ------------------------------------------------------------------- |
| `npm run typecheck` | OK — 157 files, 0 errors, 0 warnings                                |
| `npm run lint`      | 0 errors, the same 3 pre-existing `no-console` warnings in `evals/` |
| `npm test`          | **501 passed / 501, 40 files**, seed `1786709623331`                |
| `npm run build`     | Complete; only the standing sitemap warning                         |

Suite count unmoved at 501 — correct rather than suspicious: F1's three new assertions went into
the guard's existing `it()`, and F2–F5 are a comment, a wrap, a field and a comment. No `it()` was
added or removed anywhere.

Files touched by triage: `src/pages/api/auth/signout.ts`, `src/lib/signout-outcome.ts`,
`tests/lib/form-endpoint-guards.test.ts`, `tests/fixtures/accounts.ts`.
