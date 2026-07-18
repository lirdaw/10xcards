---
date: 2026-07-18T14:43:57+02:00
researcher: lirdaw
git_commit: defff10a7bece4ae90e917993b106b18aab377a3
branch: main
repository: My10xCards_v2
topic: "Integration tests — retry after generation timeout must not duplicate candidates (test-plan Risk #2)"
tags: [research, codebase, generation, idempotency, testing, api-generate]
status: complete
last_updated: 2026-07-18
last_updated_by: lirdaw
---

# Research: retry after generation timeout must not duplicate candidates

**Date**: 2026-07-18T14:43:57+02:00
**Researcher**: lirdaw
**Git Commit**: defff10a7bece4ae90e917993b106b18aab377a3
**Branch**: main
**Repository**: My10xCards_v2

## Research Question

Cover test-plan §2 Risk #2 with integration tests: a retry after a generation
timeout must not write a second set of candidates. Establish the cheapest test
and a concrete oracle. Challenge the assumption "the client timed out, therefore
the server did not commit". Avoid the anti-pattern of asserting on timeout
ordering instead of the actual race.

Scope confirmed with the user: **Risk #2 only** (not #4 / #6, which share §3 Phase 2).

## Summary

Four findings, in order of consequence.

**1. There is nothing to protect yet — the test as specified fails today, by
design.** Idempotency was explicitly deferred, not overlooked:
`context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108`
(finding F5, ACCEPTED-AS-RULE) records "the code fix (idempotency, Variant A)
deliberately deferred to S-05", and `src/pages/api/generate.ts:26-30` carries the
same statement in a source comment. test-plan §3 Phase 2 asks to "prove the
server … does not duplicate on retry", but the server *does* duplicate on retry
and the repo knows it. **This change must first decide whether it ships
idempotency or only specifies it** — see [Open Questions](#open-questions). This
is the single most important input to `/10x-plan`.

**2. The duplication is not a race — it is unconditional.** The change brief and
test-plan §2 both frame Risk #2 as a timing window. The code says otherwise:
there is no dedup at any layer — no client-side attempt id
(`GeneratorForm.tsx:176` re-sends `lastPayload.current` verbatim), no server-side
in-flight registry or idempotency key, and no database constraint on
`(user_id, source_text)` or `(deck_id, front, back)`. Any second request with the
same payload writes a second complete set, whenever it arrives. The 40 s/55 s
timeout ordering narrows *how often a user triggers* the second request; it has
no bearing on what the server does when one arrives.

**3. Therefore the cheapest test needs no timing control at all** — two
*sequential* identical requests, asserting exactly one `generation_session`. This
is cheaper, deterministic, and gives strictly more signal than any attempt to
reproduce the >15 s insert window. Reproducing the real window is also mechanically
blocked: `vitest.config.ts:33` sets `testTimeout: 30_000`, below
`SERVER_TIMEOUT_MS = 40_000` (`src/pages/api/generate.ts:31`).

**4. The generation path already runs in deterministic mock mode locally and in
CI**, because `OPENROUTER_API_KEY` is absent from both `.env` and
`.github/workflows/ci.yml`. `generateCandidates` returns canned cards instantly
(`src/lib/openrouter.ts:149-158`). No HTTP mocking library is needed — which
matters, because the project has none and has deliberately never added one.

## Detailed Findings

### The write path — where the commit actually happens

`src/pages/api/generate.ts` is the only generation endpoint; only `POST` is
exported. The ordering is: auth (`:62-65`, reads `context.locals.user` only) →
Zod validate (`:74-82`) → deck resolve, **no write yet** (`:89-117`) → LLM call
(`:119-151`) → writes.

Every write is a separate PostgREST call. **There is no transaction and no RPC**
for this path — the only `.rpc()` in the codebase is `search_flashcards_in_deck`
(`src/lib/flashcards.ts:79`).

| # | When | Table | Helper | Site |
|---|---|---|---|---|
| 1 | LLM threw (timeout/transport/parse) | `generation_session` `status:'failed'` | `createGenerationSession` | `generate.ts:135-147` |
| 1a | LLM answered, 0 cards passed Zod | `generation_session` `status:'failed'` | `createGenerationSession` | `generate.ts:160-172` |
| 2 | Success + `newDeckName` | `deck` | `createDeck` | `generate.ts:180` |
| 3 | Success | `generation_session` `status:'succeeded'` | `createGenerationSession` | `generate.ts:197-209` |
| 4 | Success | `flashcard` × N (one bulk insert) | `insertCandidates` | `generate.ts:214` |
| 5 | Only if #4 errored | `generation_session` UPDATE → `failed`, `saved_count:0` | `failGenerationSession` | `generate.ts:218` |

**Answer to "where does the write transaction end": it does not — there is no
transaction.** The first durable row on the success path lands at `:180`
(new-deck) or `:197` (existing-deck), always *after* the model responded. The
last lands at `:214`. The gap between `:197` and `:214` is durable-but-incomplete;
`src/lib/generations.ts:26-34` documents the compensating update as best-effort
("the writes aren't a single transaction (the card insert needs the session's FK
id first)"). If that compensating UPDATE itself fails, an over-reporting
`succeeded` session persists.

Partial writes that are possible: session without cards (compensated
best-effort); deck without session (new-deck path, session insert fails at
`:210`). Cards without session is impossible — the FK requires the session id.

### Challenging "the client timed out, therefore the server did not commit"

**Confirmed false, and already known.** `src/pages/api/generate.ts:26-30`:

> the client aborts, sees "timeout + Ponów", while the server finishes and saves
> a succeeded session + cards, and the retry doubles them.

`context/foundation/lessons.md:103-108` states the general rule and, at `:106`,
that timeout ordering "NIE eliminuje wyścigu — tylko go zawęża". The abort is
purely client-side (`AbortController` in `GeneratorForm.tsx:134-137`); it severs
the response, not the server's execution. On Cloudflare Workers the isolate
continues through its remaining awaits.

The sharper form of the challenge, which the test should encode: **the client's
abort is irrelevant to the outcome.** The server is not "sometimes" committing
after a client timeout — it is committing on every completed request, and a
retry is just a second completed request.

### Why the retry is indistinguishable from the first attempt

`src/components/generate/GeneratorForm.tsx:175-177` — `handleRetry` calls
`runGeneration(lastPayload.current)`; the ref is set once at `:128` and never
mutated. The comment at `:105` says it outright: "'Ponów' re-issues it verbatim
(FR-018)".

Payload (`GeneratorForm.tsx:51-57`), mirrored exactly by the server schema
(`generate.ts:37-47`):

```ts
{ sourceText, language, count, deckPublicId? | newDeckName? }
```

Headers are `Content-Type: application/json` only. A repo-wide grep for
`idempot|nonce|requestId|randomUUID|dedup|hash` over `src/**` returns one English
code comment and the two `AbortController` hits — nothing functional.

**Consequence for design (not just for the test):** the server's only inputs are
those five fields plus the session cookie. A content-derived key
`(user_id, deck, sha(sourceText), language, count)` is therefore the only
dedup boundary available without a client change — and it *cannot* distinguish
an accidental retry from a deliberate "generate 5 more cards from the same text".
Making that distinction requires introducing a client-supplied attempt id. This
is a real design fork that `/10x-plan` must resolve before a test can be written
against the intended behaviour.

### The database offers no dedup boundary

`generation_session` (`supabase/migrations/20260712162349_generation_session.sql:21-36`)
stores `source_text` verbatim (`:25`), plus `model`, `language`,
`requested_count`, `generated_count`, `saved_count`, `status`
(CHECK `in ('succeeded','failed')`), and jsonb request/response payloads.
`flashcard.generation_id` (bigint, nullable, ON DELETE SET NULL) was added at
`20260712162349:46-47`.

Uniqueness audit — **nothing blocks a duplicate generation**:

| Constraint | Blocks duplication? |
|---|---|
| `generation_session.id` PK / `public_id` UNIQUE | No — fresh identity/uuid per insert |
| `flashcard.id` PK / `public_id` UNIQUE | No — same |
| CHECK `char_length(source_text) > 0`, `front`/`back` > 0 | No |
| all FKs | No |
| `deck_user_name_unique (user_id, name)` | Only deck names — see the asymmetry below |

There is no unique index on `(user_id, source_text)`, no partial unique index,
no exclusion constraint, no hash column. No BEFORE INSERT trigger exists on
either table (only `moddatetime` BEFORE UPDATE, `init_core_schema.sql:75-81`), so
nothing can reject an insert at DB level. No Edge Functions —
`supabase/functions/` does not exist.

RLS is enabled deny-by-default on all tables; the app uses the `authenticated`
role via anon key + user JWT, and `init_core_schema.sql:88-89` explicitly forbids
a service-role client on user paths. A count query run as the user is therefore
self-scoping.

### The `newDeckName` asymmetry — a trap for the test author

The two deck paths behave differently under duplication, and the difference is
accidental:

- **`deckPublicId`** (existing deck): both requests write in full → 2 sessions,
  2×N cards.
- **`newDeckName`**: both requests pass the `deckNameExists` pre-check
  (`generate.ts:107-113`), **both pay for an LLM call**, then one wins
  `createDeck` (`:180`) and the other hits `23505` → returns `409` at `:183`
  **before any session row is written**.

So the new-deck path *looks* deduplicated while leaving no audit trail and still
burning the API budget. Deck creation was deliberately moved after a successful
generation precisely so "Ponów" is not blocked by a `23505`
(`context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:23-43`,
finding F1). A test written only against `newDeckName` would read green today
and prove nothing. **Drive the test through `deckPublicId` against a
freshly-created deck.**

### Existing harness — what is reusable and what blocks

`vitest.config.ts` builds config through `getViteConfig()` from `astro/config`
(`:22-36`) so `@/*` and `astro:env/server` resolve; `environment: "node"` (`:24`);
`include: ["tests/**/*.test.ts"]` (`:25`); ordered `globalSetup: [preflight,
accounts]` (`:31`); `testTimeout/hookTimeout: 30_000` (`:33-34`).

Fixtures (signatures verified):

- `tests/fixtures/accounts.ts:71` `provisionAccounts(): Promise<{a,b}>`;
  `:77`/`:81` `accountA()`/`accountB(): TestAccount` (`{email,userId,cookieHeader}`, `:20-25`).
- `tests/fixtures/session.ts:38` `signInAndCaptureCookies(email,password)`;
  `:80` `clientFor(cookieHeader)` → the app's own RLS-scoped `createClient`.
- `tests/fixtures/endpoint.ts:49` `callEndpoint(endpoint, opts): Promise<Response>`,
  `CallOptions { url, method?, params?, body?: FormData, as: TestAccount }` (`:32-41`).
- `tests/setup/preflight.ts:107` — guards creds set, anon-not-service-role, host is
  local (no env opt-out), `/auth/v1/health` reachable.

**Concurrency is safe.** `endpoint.ts:53` does `await AstroContainer.create()` per
call — no module-level container, no memoization, no mutable fixture state.
`clientFor()` likewise builds fresh. Two `callEndpoint` calls can be fired with
`Promise.all`.

Three concrete blockers for the plan:

1. **`CallOptions.body` is typed `FormData`** (`endpoint.ts:39`, comment:
   "Endpoints here read formData, never JSON"). `/api/generate` is the project's
   **first and only JSON endpoint** (`generate.ts:10-14, 69`). The fixture needs
   its `body` widened to `BodyInit` plus a `Content-Type: application/json`
   header — today only `Cookie` is set (`endpoint.ts:57`).
2. **`testTimeout: 30_000` < `SERVER_TIMEOUT_MS: 40_000`.** Any test that lets
   the real server timeout elapse dies on the vitest timeout first. Another
   reason not to test the timing.
3. **Accounts are shared across the whole run and the suite deliberately does not
   `db:reset`** (`tests/fixtures/accounts.ts:68-70`). Rows accumulate. Existing
   tests namespace with `Date.now().toString(36)` (`decks.test.ts:22`) — do the
   same, and scope every count to a per-test deck.

**No outbound HTTP mocking exists** — no msw, nock, `vi.mock`, `vi.stubGlobal`,
or fetch reassignment anywhere in `src/` or `tests/`; `vitest@^4.1.10` is the only
test devDependency. Confirmed as a deliberate baseline in
`context/archive/2026-07-15-verification-harness/research.md:248-254`.

### Mock mode is the default, and that is a cost win

`src/lib/openrouter.ts:149-158`: absent `OPENROUTER_API_KEY` ⇒ `mockCards(count)`
(`:109-114`, deterministic Polish cards `Przykładowe pytanie 1..N`), `model`
stamped `"<model> (mock)"`, payloads carry `{ mock: true }`. All four env vars are
`optional: true` in `astro.config.mjs:17-24`.

`OPENROUTER_API_KEY` is absent from `.env` and never set in
`.github/workflows/ci.yml`. So the generation path already runs deterministically
and for free in both places, and `generateCandidates` returns *instantly*.

Two consequences that pull in opposite directions:

- **Good:** no HTTP double is needed for a duplication test; the seam is already
  neutralised, and no new devDependency is required.
- **Careful:** mock mode returns *identical* card text on every call, so
  `group by front having count(*) > 1` cannot distinguish "duplicated generation"
  from "the mock always says the same thing". **Do not assert on card content.**

### The oracle

Primary assertion — count `generation_session` rows, scoped to the run:

```sql
select count(*) from generation_session
where user_id = auth.uid() and source_text = $1 and status = 'succeeded';
```

The session row is written exactly once per server-side completion, so `2` means
the generation ran twice, independent of how many cards each run produced and
independent of the LLM's non-determinism.

Secondary — the card-layer fingerprint, which survives the case where the second
session was flipped to `failed` by `failGenerationSession` while its cards still
landed:

```sql
select count(distinct generation_id) from flashcard where deck_id = $1;
```

**Do not assert on `saved_count` alone** — `failGenerationSession`
(`generations.ts:29-34`) zeroes it on the compensating path, so a
duplicated-then-compensated run reads as `0` while its row still exists.

### Positive control — required by the suite's own rule

test-plan §6.2 makes this non-negotiable: assertions are paired with a positive
control, because a wholesale-broken mechanism reads as perfect protection. Here
the failure mode is exact: **a dedup implementation that simply stops writing
would pass a "exactly one session" assertion.** The control is a generation with
*different* source text (or an explicitly-distinct second intent) that must
produce a *second* session. Without it, "1 session" is indistinguishable from
"generation is broken".

## Code References

- `src/pages/api/generate.ts:26-30` — in-source acknowledgement of the duplication hazard
- `src/pages/api/generate.ts:31` — `SERVER_TIMEOUT_MS = 40_000`
- `src/pages/api/generate.ts:107-113`, `:180-189` — `deckNameExists` TOCTOU and the `23505` → 409 path
- `src/pages/api/generate.ts:197-220` — session insert, card insert, compensating update
- `src/lib/generations.ts:21-54` — `createGenerationSession`, `failGenerationSession`, `insertCandidates`; `:26-28` the "not a single transaction" comment
- `src/lib/openrouter.ts:149-158` — mock-mode short-circuit; `:183-193` the only outbound `fetch`
- `src/components/generate/GeneratorForm.tsx:20` — `CLIENT_TIMEOUT_MS = 55_000`; `:105`, `:175-177` verbatim retry
- `supabase/migrations/20260712162349_generation_session.sql:21-38` — table DDL, no dedup constraint
- `supabase/migrations/20260705180246_init_core_schema.sql:48` — `deck_user_name_unique`, the only business uniqueness in the schema
- `tests/fixtures/endpoint.ts:32-53` — `CallOptions` (FormData-only) and per-call container creation
- `vitest.config.ts:31-34` — globalSetup order and the 30 s timeout
- `context/foundation/lessons.md:103-108` — the recorded rule this change is testing

## Architecture Insights

- **The generation path trades atomicity for retriability, on purpose.** Deck
  creation deferred past the LLM call (so "Ponów" is not blocked by a duplicate
  name), session before cards (FK ordering), compensating update instead of a
  transaction. Each choice is individually defensible and documented; together
  they make duplicate-on-retry the natural behaviour rather than an accident.
- **RLS is the only lock, so tests must run as a real authenticated user.** A
  service-role fixture would exercise a different path and is forbidden by
  `init_core_schema.sql:88-89`; `preflight.ts` enforces the anon key precisely
  for this reason.
- **The harness philosophy is "real database, doubled only at the external HTTP
  edge".** This risk needs no double at all, so it fits the harness better than
  any other Phase 2 risk.

## Historical Context (from prior changes)

- `context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108`
  — finding **F5**, the deferral of idempotency to S-05, with the >15 s insert
  window named explicitly. This is the decision this change is now colliding with.
- `context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:23-43`
  — finding **F1**, why deck creation happens after generation succeeds.
- `context/archive/2026-07-11-ai-candidate-generation/reviews/plan-review.md:63`
  — flags that "Ponów" + timeout can multiply paid calls with no throttling; only
  the $5 budget limits it. Relevant to the `newDeckName` asymmetry above.
- `context/archive/2026-07-11-ai-candidate-generation/plan.md:118-124` — the
  `AbortController`-not-`AbortSignal.timeout` decision (workerd `nodejs_compat`).
- `context/archive/2026-07-15-verification-harness/research.md:248-254` — confirms
  the deliberate absence of any HTTP mocking library.
- `context/foundation/test-plan.md:250-254` — §6.5 "Adding a test for the
  generation path" is `TBD`; this change owns filling it in.

## Related Research

- `context/archive/2026-07-15-verification-harness/research.md` — the harness this
  change extends (fixtures, preflight, Container API constraints)
- `context/archive/2026-07-11-ai-candidate-generation/plan.md` — the slice that
  built the endpoint under test

## Open Questions

1. **RESOLVED (2026-07-18, user decision): characterization test, fix stays deferred.**
   This change lands a **green** test pinning the *current* non-idempotent
   contract — two identical requests produce **two** `generation_session` rows —
   and does **not** implement idempotency. F5 / S-05 keeps ownership of the fix.
   Executor: `/10x-implement` (no `/10x-plan` pass). Verification: deliberate
   breakage, per the §6.6 pattern.

   Three constraints this decision carries, all binding on the implementer:

   - **The test asserts the bug, so it must say so.** Name and comment it as a
     characterization test, referencing F5
     (`context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108`)
     and stating that S-05 is expected to turn it red — and that going red is the
     signal to *invert* it, not to delete it.
   - **Risk #2 stays UNCOVERED.** `test-plan.md` §3 Phase 2 must not read
     `complete` for #2 on the strength of this test, and §6.5 must record it as
     characterization rather than protection. This test measures the duplication;
     it does not prevent it.
   - **The deliberate-breakage check has a specific shape here.** For a normal
     denial test you neuter the policy and confirm red. For a characterization
     test asserting *two* sessions, the equivalent is to introduce a crude dedup
     (or make the second request a no-op) and confirm the test goes red — proving
     it actually observes the second write rather than counting something that was
     always ≥1.

   Original framing of the decision, kept for the record. Three coherent options:
   - **(a) Implement + test.** The change stops being test-only and absorbs the
     S-05 deferral. Largest scope; delivers actual risk coverage.
   - **(b) Land the test red/skipped as an executable spec**, referencing F5, and
     let S-05 turn it green. Honest and cheap, but §5 lists unit+integration as a
     *required* CI gate — a knowingly-failing test cannot sit in a required gate,
     so it would need `.todo`/`.skip` with a comment, which weakens the signal.
   - **(c) Defer Risk #2 to S-05 entirely** and let Phase 2 cover only #4 and #6.
     Cheapest; leaves §3 Phase 2 honestly partial rather than falsely green.
2. **Deferred to S-05 (not this change): content-hash key or client-supplied attempt id?** A content hash
   cannot distinguish an accidental retry from a deliberate re-generation of the
   same text; an attempt id can, but requires a client change. See
   [the retry indistinguishability finding](#why-the-retry-is-indistinguishable-from-the-first-attempt).
3. **Deferred to S-05 (not this change): what is the dedup window?** A partial unique index on
   `(user_id, source_hash) where status = 'succeeded'` is permanent and would
   block legitimate re-generation forever. A time-bounded window needs a
   deliberate value and a source of "now".
4. **Should the `newDeckName` path get its own case?** It behaves differently and
   its apparent protection is accidental. Recommend at minimum a comment in the
   test; a second `it()` is cheap.
