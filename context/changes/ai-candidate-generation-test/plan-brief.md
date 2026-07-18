# Characterization test — retry duplicates candidates — Plan Brief

> Full plan: `context/changes/ai-candidate-generation-test/plan.md`
> Research: `context/changes/ai-candidate-generation-test/research.md`

## What & Why

Test-plan §2 Risk #2 says a retry after a generation timeout writes a second set of
candidates. Research confirmed it — and found the duplication is **unconditional**, not a
timing race, and that the fix was deliberately deferred to F5 / S-05. So this change lands a
**characterization test**: it pins the current non-idempotent contract (two identical
requests → two generation sessions) rather than preventing it.

## Starting Point

`/api/generate` has no dedup at any layer — no client attempt id, no server idempotency
key, no unique constraint. Every write on its path is a separate PostgREST call with no
transaction. The Phase 1 harness (real session, real Postgres, nothing mocked) is reusable,
except its endpoint driver only speaks `FormData` and `/api/generate` is the project's first
JSON endpoint. Generation already runs in deterministic mock mode locally and in CI because
`OPENROUTER_API_KEY` is unset — so no HTTP double is needed and no LLM call is paid for.

## Desired End State

`tests/generation/generate.test.ts` proves, against real Postgres, that two identical
requests write two `succeeded` sessions and two distinct `generation_id` values, backed by a
positive control and a case documenting the misleading `newDeckName` path. `test-plan.md`
§6.5 stops being TBD, and §6.6 records in plain words that Risk #2 is **measured, not
protected**.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Ship idempotency or only specify it? | Characterization test only | The fix belongs to F5 / S-05; this slice measures the bug honestly instead of absorbing that scope. | Research |
| Reproduce the timeout race? | No — two sequential requests | Duplication is unconditional, and `testTimeout` (30 s) sits below `SERVER_TIMEOUT_MS` (40 s) anyway. | Research |
| Endpoint driver for JSON | Widen `CallOptions.body` to `BodyInit` | One driver for the whole suite; existing FormData tests stay untouched. | Plan |
| Test location | `tests/generation/generate.test.ts` | §6.2 says folder-per-concern, file-per-resource; `isolation/` means Risk #1. | Plan |
| `newDeckName` path | Its own `it()` plus a comment | Its apparent protection comes from `deck_user_name_unique`, not dedup — worth pinning so removing the constraint goes red. | Plan |
| Oracle | Session count + distinct `generation_id` | The card layer catches a second session compensated to `failed` whose cards still landed. | Research + Plan |
| Positive control | Third request, different source text | Separates "duplication observed" from "generation stopped writing entirely" — §6.2 requires it. | Plan |
| Breakage check | One-off crude dedup, result written into §6.5 | Proves the assertion sees the second write, without leaving test-only code in production. | Research + Plan |
| Risk #2 status | Stays uncovered; §3 Phase 2 `implementing` | This test measures duplication; it does not prevent it. | Research |

## Scope

**In scope:** widening `tests/fixtures/endpoint.ts` for JSON bodies; three integration cases
in a new `tests/generation/generate.test.ts`; the inverted deliberate-breakage verification;
`test-plan.md` §6.5 / §6.6 / §3 updates.

**Out of scope:** implementing idempotency (dedup key, unique index, in-flight registry);
reproducing the timeout window; adding an HTTP mocking library; changes to
`GeneratorForm.tsx`; research Open Questions 2 and 3 (hash key vs. attempt id, dedup window)
— all S-05's.

## Architecture / Approach

The §6.4 pattern, unchanged: drive the real endpoint through the Astro Container with a real
captured session cookie, read rows back with an RLS-scoped `clientFor` client, assert on
rows and never on status alone. The only new mechanics are a JSON body and a two-layer
oracle (`generation_session` count, then distinct `generation_id` among the deck's cards).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. JSON driver | `callEndpoint` sends JSON without breaking FormData callers | Setting `Content-Type` unconditionally would break multipart boundary derivation |
| 2. Test + breakage check | Three cases green; proof the assertion observes the second write | Asserting on mock card content or `saved_count` — both are false oracles |
| 3. test-plan updates | §6.5 filled, §6.6 honest, §3 Phase 2 `implementing` | Marking Phase 2 `complete` and making the duplication look solved |

**Prerequisites:** local Supabase stack running (`npx supabase start`); `.env` with the anon
key; `OPENROUTER_API_KEY` left unset so mock mode stays active.
**Estimated effort:** one session, ~3 phases.

## Open Risks & Assumptions

- The test asserts a bug, so it is designed to break. If the header comment fails to make
  "invert me, don't delete me" obvious, S-05 may simply delete it and lose the signal.
- Accounts are shared across the run and the suite never resets the database; every count
  must be scoped by `source_text` and by the per-test deck, or the test becomes
  history-dependent.
- Mock mode is load-bearing. If `OPENROUTER_API_KEY` is ever added to CI, this test starts
  making paid, slower, non-deterministic calls.

## Success Criteria (Summary)

- `npm test` green, twice in a row, with no database reset between runs.
- A crude dedup in `generate.ts` turns the primary case red — proving it observes the second
  write rather than counting something always ≥ 1.
- Nobody reading `test-plan.md` can conclude that duplication on retry is prevented.
