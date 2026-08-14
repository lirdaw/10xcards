# Middleware reads a `getUser()` auth error as "not signed in" — Plan Brief

> Full plan: `context/changes/bug-middleware-getuser-swallowed/plan.md`
> Research: `context/changes/bug-middleware-getuser-swallowed/research.md`

## What & Why

`src/middleware.ts` discards the error from `supabase.auth.getUser()`, so a transient
GoTrue/network failure is indistinguishable from an absent session: a user holding a valid session
is bounced to `/auth/signin`, and a JSON-fetching island is told "Twoja sesja wygasła". This is
hit #5 — the last — of the 2026-08-11 swallowed-errors audit, and the read-side twin of C10X-51.
The fix separates an auth **error** from **no session**, so a temporary backend outage never
presents as an expired session.

## Starting Point

`middleware.ts:46-53` destructures `{ data: { user } }` and drops `error`, with no `try`/`catch`
around the call. It is the only `getUser()` call in `src/`. The guard below it answers a
signed-out caller in the caller's own format — `401` for fetch, `302 /auth/signin` for documents —
and today a backend outage takes both of those paths silently.

## Desired End State

A signed-in user whose auth backend is briefly unreachable is told the **backend** is unreachable,
on both branches, in each caller's own convention. An anonymous visitor's experience is
byte-identical to today.

## Key Decisions Made

| Decision               | Choice                             | Why (1 sentence)                                                                                                                                                      | Source          |
| ---------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Fix shape              | A **classifier**, not `if (error)` | `getUser()` returns `AuthSessionMissingError` for the ordinary signed-out visitor _before any network call_, so C10X-51's shape would banner every anonymous visitor. | Research        |
| Sentry capture         | **None**                           | It would sit on every request, pass unsampled by construction, and exhaust quota self-maskingly — `sentry-sampling.ts:14-19` pre-wrote the warning.                   | Plan            |
| `App.Locals`           | **Unchanged**                      | Avoids 17 consumers plus 5 test casts, and kills the `Layout.astro` config-banner disclosure hazard outright.                                                         | Plan            |
| JSON branch            | **`503`**, not a changed `http.ts` | `http.ts:52-53` overrides _any_ 401's body with "Twoja sesja wygasła"; a 503 falls through to the islands' own copy for free.                                         | Research + Plan |
| Thrown non-`AuthError` | **In scope**, one `try`/`catch`    | It is an uncaught 500 on every request today and is owned by no ticket.                                                                                               | Plan            |
| Classifier input       | **Structural `AuthErrorLike`**     | Measured: the auth-js guards are duck-typed on the same `name` string, so they buy only a marker check while coupling fixtures to a private field.                    | Plan            |
| Copy                   | **Reuse two existing constants**   | `AUTH_NETWORK_MESSAGE` / `AUTH_UNAVAILABLE_MESSAGE` already mean this and are already vouched by `ownedAuthMessage` — no new render site, no adjacency hazard.        | Research + Plan |
| `?error=` guard        | **Register a third surface**       | `form-endpoint-guards.test.ts` has no catch-all, so the new producer would be inspected by nothing in the repo.                                                       | Research + Plan |
| Evidence               | **Fresh before/after pair**        | The archive already records this defect firing live — but that proves the bug and cannot prove the fix.                                                               | Plan            |

## Scope

**In scope:** the `getUser()` error, the `createClient() === null` branch, a thrown
non-`AuthError`, both guard branches (302 and JSON), and registering the new `?error=` producer.

**Out of scope:** any Sentry capture; any `App.Locals` change; `/` and `Topbar.astro` still
reading as guest during an outage; `src/lib/http.ts`; `getClaims()`; `Retry-After`; any migration.

## Architecture / Approach

Extract the decision and its inputs (test-plan §6.1), the project's fifth such extraction after
`readJsonResponse`, `rateOutcome`, `visibleConfigStatuses` and `signOutLanding`. A new pure
`src/lib/auth-outcome.ts` classifies an `AuthErrorLike` into `no-session` or `unavailable` and
maps it to a landing message; `src/middleware.ts` keeps only what a pure function cannot do —
observing `getUser()` and assembling the two responses. Both failure branches are unreachable from
Vitest, so the classifier's fabricable argument is what makes every branch assertable on every
`npm test`.

The split keys on `name` and `code`, never on `status`: `AuthSessionMissingError` hardcodes 400
even for a 403, and `500` is **not** in auth-js's retryable list — two facts that would each have
cost a wrong branch.

## Phases at a Glance

| Phase                  | What it delivers                                | Key risk                                                                            |
| ---------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1. The classifier      | Pure module + exhaustive truth table, no wiring | The `default` arm must fall to the _safe_ side or it re-creates the bug inverted    |
| 2. Middleware wiring   | `try`/`catch`, 503 + `?error=` branches         | Appending `?error=` to the _existing_ redirect reddens 8 Vitest + 5 Playwright rows |
| 3. Guard registration  | Third `?error=` surface                         | Four floors must be **re-measured**, never scaled by arithmetic                     |
| 4. Falsification       | B1-B5 breakage runs with observed splits        | A neuter that stops the run proves nothing                                          |
| 5. Manual before/after | The only evidence covering the wiring           | `.env` restore must be hash-verified (the CRLF trap)                                |
| 6. Doc sync            | test-plan §6.6 + §8, roadmap row                | Do not flip roadmap Status to `done` — that is `/10x-archive`'s                     |

**Prerequisites:** local Supabase stack up (`npm run db:start`), `OPENROUTER_API_KEY` unset.
**Estimated effort:** ~2 sessions; Phases 1-3 are the code, 4-6 are the evidence and bookkeeping.

## Open Risks & Assumptions

- The `code` allow-list is **inference** for codes this stack cannot produce — same class as
  `auth-errors.ts`'s reachability record, mitigated by checking each against the `ErrorCode` union
  at auth-js 2.105.3.
- One GoTrue version, one stack: whether hosted GoTrue answers 401 where local answers 403 is
  unestablished — which is exactly why the split avoids `status`.
- The `default` arm falls to `no-session`, so an unrecognised code during a real outage still
  shows the old message. A deliberate bet against the worse failure.
- `tests/middleware.test.ts` gains **no** case for the new branch — there is no seam. Its 23 cases
  are a regression proof, not coverage of the fix.
- The 500 and 429 classes are covered by the truth table only; the manual run provokes the
  transport class alone.

## Success Criteria (Summary)

- A user with a live session, during a backend outage, reads that the auth server is unreachable —
  not that their session expired — on both the page and the fetch path.
- An anonymous visitor sees exactly what they see today: a bare redirect, no banner.
- `tests/middleware.test.ts` stays 23/23 with no row edited.
