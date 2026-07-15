# Test Harness Bootstrap + Per-Account Isolation — Plan Brief

> Full plan: `context/changes/verification-harness/plan.md`
> Research: `context/changes/verification-harness/research.md`

## What & Why

Stand up this project's first test infrastructure and use it to prove Risk #1 from the test plan:
account B cannot read or modify account A's decks or flashcards. This is rollout Phase 1 of
`context/foundation/test-plan.md` and roadmap F-03 — the same change. Per-account isolation is a PRD
guardrail ("no user can ever see another user's flashcards — a hard boundary"), and four prior slices
each deferred its automated test to F-03. This change is that accumulated debt.

## Starting Point

There is no test infrastructure at all — no runner, no config, no test file, no CI test step. The
application has no authorization code: `user_id` appears in `src/` at four places, all INSERT
payloads, and `listDecks` has no `WHERE` clause. RLS is not one of two locks; it is the only lock.
The policies themselves are well-built — the risk is that RLS is alone, and nothing would detect its
removal. The only isolation evidence in the repo is a manual, database-level proof from 2026-07-05,
written before any API endpoint existed.

## Desired End State

`npm test` runs a Vitest suite against the local Supabase stack that proves account A reaches its own
data through the real endpoints, and that account B is denied A's decks and cards on read and on
write — asserted on row state, not response codes. It runs in CI on every push and PR, blocking
merge. Deliberately dropping an RLS policy turns the suite red.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Test layer | Through the endpoints (Container API), not the database | A DB-level RLS test re-proves the 2026-07-05 result and would pass even if the app stopped sending the JWT | Research |
| Middleware seam | Inject `locals.user`; cookie drives the real chain | The Container API does not run middleware (source-verified), but each endpoint builds its own client from the request cookie, so cookie → JWT → RLS is genuinely exercised | Plan |
| Scope | Decks + flashcards, read + write, incl. the `listDecks` surface | `listDecks` has no `WHERE` at all (widest blast radius); flashcard policies are a separate `EXISTS`-join that deck tests don't prove | Plan |
| Test accounts | `signUp` with the anon key, two accounts reused per run | Keeps a `service_role` (BYPASSRLS) key out of a repo whose whole point is proving isolation; reuse dodges the 30-per-5-min auth rate limit | Plan |
| Session cookies | Capture via `setAll`, never hand-construct | The format is internal, the docs describe chunking wrongly, and a malformed value reads as *no session* rather than an error | Plan |
| RLS hardening | Only the `SUPABASE_KEY` = anon assertion | It's the one item test-shaped rather than migration-shaped; the rest are schema changes needing their own change and a prod `db push` | Plan |
| `deleteDeck` | Fix it — add `RETURNING`, return 404 | It's the only mutation without `RETURNING`, so a cross-account delete currently returns a response indistinguishable from success | Plan |
| Test data | Unique names per test, no global reset | Tests stay independent and `npm test` doesn't wipe the developer's local data | Plan |
| CI | Wired in this phase | A test that doesn't run in CI doesn't protect against the regression it was written for; it also makes test-plan §5 true when it claims to be | Plan |
| Middleware guard test | Out of scope | Risk #1 is authorization, not authentication | Plan |

## Scope

**In scope:** Vitest runner via `getViteConfig()`; fail-fast preflight incl. the anon-key assertion;
`.env` repair + `.env.example`; two-account session fixture; positive control; cross-account denial
tests for decks, flashcards, and the read surface; the `deleteDeck` `RETURNING` fix; CI gate;
cookbook §6 + roadmap/test-plan sync; two new lessons.

**Out of scope:** the middleware guard test; RLS hardening migrations (`generation_id` predicate,
`FORCE ROW LEVEL SECURITY`, `revoke ... from PUBLIC`); e2e; LLM mocking; rendering `.astro` pages;
generation, SRS, validation-parity, and leakage risks (Phases 2, 4, 5).

## Architecture / Approach

Tests drive real API route modules through Astro's Container API with a real `Cookie` header captured
from a genuine sign-in, plus an injected `locals.user`, against real local Postgres. The cookie is
consumed by the endpoint's own `createClient` call — so the full cookie → JWT → `auth.uid()` → RLS
chain runs. Injecting `locals.user` is faithful rather than a shortcut: middleware only ever answers
"is someone signed in?", so injecting it is a literal encoding of the assumption under test —
"authenticated implies authorized."

Every assertion is paired: B gets a 404 **and** A's row is verifiably intact. Cross-tenant writes
under RLS are silent 0-row no-ops, so a status code alone proves nothing.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner bootstrap + preflight | `npm test` runs; suite refuses to run misconfigured | `astro:env/server` resolution under Vitest is undocumented |
| 2. Session fixture + positive control | Two real sessions; proof A reaches A's own data | **The main unknown** — if cookie capture doesn't drive a real session, Phase 3 has nothing to stand on |
| 3. Cross-account denial suite | The actual risk coverage, incl. the `deleteDeck` fix | Silent 0-row no-ops: a test that asserts only status codes would pass vacuously |
| 4. CI gate | Green CI means "isolation still holds" | `supabase start` adds ~1-2 min per run |
| 5. Cookbook §6 + doc sync | Reusable pattern; documents match reality | — |

**Prerequisites:** Docker (29.2.1 ✓) and Supabase CLI (2.98.2 ✓) both present and working; local
stack configured with signup enabled and confirmations off; S-01 shipped (the capability under test).

**Estimated effort:** ~2-3 sessions across 5 phases; Phase 2 dominates the uncertainty.

## Open Risks & Assumptions

- The middleware guard stays untested — `PROTECTED_ROUTES` is prefix-matched, so a future route left
  off the array would be unprotected with nothing to catch it.
- The RLS gaps research found remain open (`generation_id` existence oracle, no `FORCE RLS`, RPC
  grant) — deliberately deferred to their own change.
- The Container API is `experimental_`-prefixed in Astro 6; an upgrade could move it.
- Cookie capture depends on `setAll` firing only when storage changed; Phase 2's positive control is
  what would surface a silent failure.

## Success Criteria (Summary)

- Account B is provably denied A's decks and cards on read and on write, with A's data verified
  intact — not merely a 404.
- Account A still reaches its own data (positive control), so a green suite cannot mean "everything
  is broken."
- Dropping an RLS policy turns CI red, which is what makes the guardrail durable rather than a
  one-time manual proof.
