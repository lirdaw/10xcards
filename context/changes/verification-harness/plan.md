# Test Harness Bootstrap + Per-Account Isolation Implementation Plan

## Overview

Stand up this project's first test infrastructure and use it to prove Risk #1 from
`context/foundation/test-plan.md:43`: account B cannot read or modify account A's decks or
flashcards, while account A still reaches its own data.

This is rollout Phase 1 of the test plan and roadmap F-03 (`verification-harness`) — the same
change, the same change-id. Four prior slices deferred the automated isolation test to F-03
(`context/archive/2026-07-05-per-user-data-isolation/plan.md:62` is the first of them). This change
is that accumulated debt.

## Current State Analysis

**Test infrastructure: zero.** No runner, no config, no test file, no CI test step. No `test` script
in `package.json:5-14`; no test dependency on disk.

**The application has no authorization layer.** `user_id` appears in `src/` at exactly four places
and all four are INSERT payloads (`src/lib/decks.ts:30`, `src/pages/api/generate.ts:136,161,198`).
No read, update, or delete query carries a `user_id` predicate. `listDecks` (`src/lib/decks.ts:11-13`)
has no `WHERE` clause at all. RLS is not one of two locks — it is the only lock. That is deliberate,
not oversight: `src/lib/decks.ts:4-7` states "all queries are RLS-scoped to the signed-in user" as
the design contract.

**The RLS policies themselves are well-built** (`init_core_schema.sql:109-142`): deny-by-default,
per-command, `WITH CHECK` on every write, correct `EXISTS`-join for flashcard ownership. The risk is
not that RLS is wrong — it is that RLS is alone, and nothing in code, tests, or CI would detect its
removal or bypass.

**The seam has never been verified.** The only isolation evidence is a manual, *database-level* proof
from 2026-07-05 (`context/archive/2026-07-05-per-user-data-isolation/rls-verification.md`), written
before any API endpoint existed. Nothing has ever verified that the endpoint layer actually carries
the session down to Postgres.

**Ground is ready**: Docker 29.2.1, Supabase CLI 2.98.2, `supabase/config.toml` present with
`enable_signup = true` (`:169`) and `enable_confirmations = false` (`:209`), `[db.migrations] enabled = true`.

## Desired End State

`npm test` runs a Vitest suite against the local Supabase stack that:

- fails loudly and immediately if the environment is not configured (rather than passing against a
  `null` client),
- proves account A reaches its own deck and cards through the real endpoints (positive control),
- proves account B is denied A's decks and cards on read **and** on write, asserted on **row state**,
  not response status,
- runs in CI on every push and PR, blocking merge on failure.

Verify by: `npm test` green locally and in CI; deliberately dropping a policy (e.g.
`drop policy deck_select on deck;`) turns the suite red.

### Key Discoveries:

- **The Container API does NOT run project middleware.** Source-verified in the installed
  `astro@6.3.1`: `dist/container/index.js` calls `createManifest(manifest, renderers)` with the third
  (`middleware`) argument undefined, so `NOOP_MIDDLEWARE_FN` runs. The Astro 6 docs are silent on
  this — there is no doc line to cite. `renderToResponse` accepts a `locals` option whose JSDoc reads
  "Useful if your component needs to access some locals **without the use of middleware**."
- **This does not block the phase, because each endpoint creates its own Supabase client.** Every
  endpoint calls `createClient(context.request.headers, context.cookies)` itself (e.g.
  `src/pages/api/decks/[publicId]/delete.ts:18`), and `createClient` reads the session from
  `parseCookieHeader(requestHeaders.get("Cookie"))` (`src/lib/supabase.ts:12`). A real `Cookie` header
  on the test `Request` therefore drives the real cookie → JWT → RLS → Postgres chain. Only
  `locals.user` must be injected.
- **Injecting `locals.user` is faithful, not a shortcut.** Middleware only ever answers "is someone
  signed in?" — it is resource-blind by construction. Injecting `locals.user = B` while sending B's
  real cookie is a literal encoding of the assumption under test: "authenticated implies authorized."
- **The session cookie format is internal, with no public contract.** Name is
  `sb-${hostname.split(".")[0]}-auth-token` (source: `@supabase/supabase-js/dist/index.cjs:369`), so
  `http://127.0.0.1:54321` yields **`sb-127-auth-token`** — and `localhost` yields a *different* name.
  Value is `"base64-" + base64url(JSON.stringify(session))`
  (`@supabase/ssr/dist/main/cookies.js:7,191,343`). The docs describe chunk naming **incorrectly**,
  which is itself the evidence this is not maintained as a public contract. **The read path swallows a
  malformed value with a `console.warn` and treats the session as absent** — hand-rolled serialization
  would fail as "mysteriously logged out," never as an error. Hence: capture cookies via `setAll`,
  never construct them.
- **`deleteDeck` (`src/lib/decks.ts:38`) is the only mutation without `RETURNING`.** Its endpoint
  redirects to `/decks` whether or not a row was deleted — a cross-account delete returns a response
  indistinguishable from success. Every sibling (`renameDeck:34`, `updateFlashcard`,
  `deleteFlashcard` in `src/lib/flashcards.ts:101-118`) has `.select().maybeSingle()` and returns 404.
  This is `context/foundation/lessons.md:47-52` live in production code.
- **Silent failure is this codebase's signature.** Cross-tenant `UPDATE`/`DELETE` under RLS is a
  0-row no-op, not an error (`rls-verification.md:95-101`); an unset env var makes `createClient`
  return `null` rather than throw. Both "no error" and "no rows" are indistinguishable from success
  here — so every assertion must be row-based and paired with a positive control
  (`lessons.md:54-59`).
- **404-not-403 is binding** (`context/archive/2026-07-07-deck-workspace/plan.md:104-106`): an absent
  row and an RLS-hidden row must be indistinguishable. Tests assert 404 on denial, never 403.
- `getViteConfig()` picks up the `@/*` tsconfig alias automatically via the `astro:tsconfig-alias`
  plugin (`astro/dist/core/create-vite.js:148`) — no `vite-tsconfig-paths` needed.

## What We're NOT Doing

- **Not testing the middleware guard** (`PROTECTED_ROUTES`, unauthenticated → redirect). Decided:
  Risk #1 is authorization, not authentication. The Container API cannot exercise it, and a mocked
  unit test of `onRequest` would prove little. Tracked in Open Risks below.
- **Not rendering `.astro` pages.** The `/decks` read surface is covered by calling `listDecks` with
  real session clients — same DB path, same signal, without the React renderer.
- **Not fixing the RLS gaps found in research** — the `generation_id` predicate, `FORCE ROW LEVEL
  SECURITY`, and `revoke ... from PUBLIC` on the search RPC. These are migrations, not tests; they
  belong to their own change. Only the `SUPABASE_KEY` anon-role assertion (test-shaped) is in scope.
- **No e2e.** No `test-plan.md` §3 phase claims it (`test-plan.md:99,126`).
- **No mocking of the LLM edge** — that is Phase 2 (`test-plan.md:97`).
- Not testing generation, SRS, validation parity, or leakage — Phases 2, 4, 5.

## Implementation Approach

Bottom-up, riskiest-unknown-first. Phase 1 stands the runner up and makes the environment fail loudly.
Phase 2 solves the one genuine unknown — fabricating real sessions — and delivers the positive control
that gives every later assertion meaning. Phase 3 is the actual risk coverage. Phase 4 makes it
enforceable. Phase 5 makes it reusable.

Tests hit the endpoints via the Container API with a real `Cookie` header and an injected
`locals.user`, against the real local Postgres. No database-level RLS test: it would re-prove the
2026-07-05 result and would pass even if the app stopped sending the JWT entirely.

## Critical Implementation Details

**The cookie name depends on `SUPABASE_URL`'s hostname, not on any project ref.** With
`SUPABASE_URL=http://127.0.0.1:54321` the cookie is `sb-127-auth-token`; switch the URL to
`localhost` and it becomes `sb-localhost-auth-token`. Because the fixture captures cookies via
`setAll` rather than naming them, this resolves itself — but any debugging that greps for a cookie
name must know it.

**`createServerClient` sets `autoRefreshToken: false`**, and `setAll` fires only when storage
actually changed. Captured cookies do not self-renew (`jwt_expiry = 3600`, `config.toml:158`);
regenerate per run rather than caching to disk.

**Ordering in Phase 3**: the `deleteDeck` `RETURNING` fix must land *before* its cross-account test is
meaningful — without it the endpoint cannot distinguish 0 rows from 1 and the test could only assert
on database state.

## Phase 1: Runner bootstrap + fail-fast preflight

### Overview

Stand up Vitest against the Astro config, make the local-stack workflow scriptable, and guarantee the
suite refuses to run in a misconfigured environment rather than passing vacuously.

### Changes Required:

#### 1. Test runner config

**File**: `vitest.config.ts` (new)

**Intent**: Configure Vitest through Astro so the `@/*` alias and the `astro:env/server` virtual
module resolve in tests.

**Contract**: Default-exports `getViteConfig({ test: {...} })` from `astro/config`. Test environment
is Node (no DOM needed — no component tests in this phase). Include `tests/**/*.test.ts`. Set a
per-test timeout above the default 5s: sign-in plus endpoint round-trips against local Postgres will
exceed it.

#### 2. Test dependencies and scripts

**File**: `package.json`

**Intent**: Add Vitest and the npm scripts the harness and CI need. The local-stack actions are
currently ad-hoc with no scripts at all.

**Contract**: Add `vitest` to `devDependencies`. Add scripts: `test` (`vitest run`), `test:watch`
(`vitest`), `db:start` (`supabase start`), `db:stop` (`supabase stop`), `db:reset`
(`supabase db reset`). Keep the existing `db:types` untouched.

#### 3. Environment repair

**File**: `.env`, `.env.example` (new)

**Intent**: `.env` line 11 is a pasted shell command and line 12 begins with a bare `=` (the intended
`PROD_SUPABASE_KEY` name was overwritten) — most dotenv parsers drop or error on both. The harness is
about to depend on this file. `.env.example` gives the committed manifest of required keys that no
file currently provides.

**Contract**: Repair the two malformed lines, preserving the cloud credentials under the `PROD_`
prefix (standing project rule). `.env.example` lists `SUPABASE_URL`, `SUPABASE_KEY`,
`OPENROUTER_API_KEY`, `OPENROUTER_MODEL` with empty values and a comment pointing at
`npx supabase start` for local values. Never commit real secrets.

#### 4. Preflight guard

**File**: `tests/setup/preflight.ts` (new)

**Intent**: All four env vars are `optional: true` (`astro.config.mjs:17-24`), so an unset
`SUPABASE_URL` makes `createClient` return `null` and the suite would proceed and mislead — the same
shape as the recorded lesson about prod silently degrading to mock mode (`lessons.md:117-122`). The
suite must refuse to run instead.

**Contract**: Runs as a Vitest `globalSetup` (not `setupFiles` — it must abort the whole run, once,
before any test). Throws with an actionable message when: `SUPABASE_URL` or `SUPABASE_KEY` is unset;
the stack at `SUPABASE_URL` is unreachable; or `SUPABASE_KEY` does not decode to `role: "anon"`.

The anon-role assertion is the one hardening item in scope. `SUPABASE_KEY` is a JWT; decode its
payload (base64url middle segment — no signature verification, this is a guard not an auth check) and
assert `role === "anon"`. Pasting a `service_role` key into `SUPABASE_KEY` silently disables every
ownership guarantee in the product — `service_role` is `BYPASSRLS`, and the app layer has no
`user_id` predicates to fall back on. `init_core_schema.sql:86-89` forbids this in prose only. No
test can see this from the outside; this assertion is what turns that prose into a check.

#### 5. Wiring smoke test

**File**: `tests/harness.test.ts` (new)

**Intent**: Prove the runner itself works — alias resolution, `astro:env/server` availability, and
that preflight passes — before any test depends on it.

**Contract**: One test importing something through `@/` and asserting `createClient` returns non-null
given a real request headers/cookies pair. This file may be deleted in Phase 5 once real tests exist;
its job is to make Phase 1 independently verifiable.

### Success Criteria:

#### Automated Verification:

- Dependencies install: `npm install`
- Type checking and lint pass: `npm run lint`
- Suite runs green against a started stack: `npm run db:start && npm test`
- Preflight fails loudly with `SUPABASE_URL` unset (expected failure, verified by hand once)
- Build still passes: `npm run build`

#### Manual Verification:

- `npm run db:start` / `db:stop` / `db:reset` work from a cold start
- Preflight's error message tells a new contributor exactly what to do
- `.env` parses correctly and prod credentials survive under `PROD_`

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Two-account session fixture + positive control

### Overview

The one genuine unknown in this change: fabricate two real, signed-in sessions and drive an endpoint
with them. Delivers the positive control — proof that A reaches A's own data — without which every
denial assertion in Phase 3 is meaningless (`lessons.md:54-59`).

### Changes Required:

#### 1. Test account fixture

**File**: `tests/fixtures/accounts.ts` (new)

**Intent**: Create and sign in two accounts (A and B) using the anon key already in `.env`. Decided:
no `service_role` key enters this repo — it is precisely the weapon that research identified as
one-paste-disables-all-isolation, and a phase that exists to prove isolation should not import it.

**Contract**: Exports a helper returning `{ userId, cookieHeader }` per account. Emails are unique
per run to avoid collision with prior runs. Signs up via `signUp` with the anon key
(`enable_signup = true`, `enable_confirmations = false`, so no email round-trip); tolerates an
already-registered email by falling back to `signInWithPassword`. Reuses two accounts for the whole
run — the auth rate limit is 30 sign-ins per 5 min per IP (`config.toml:191`), so per-test signup
would throttle the suite.

#### 2. Cookie capture helper

**File**: `tests/fixtures/session.ts` (new)

**Intent**: Turn a signed-in session into a `Cookie` header the app's own `createClient` will accept —
without encoding the library's internal serialization format into our tests.

**Contract**: Builds a throwaway `createServerClient` whose `getAll` returns `[]` and whose `setAll`
pushes `{name, value}` into an array, calls `signInWithPassword` on it, and serializes the captured
pairs into a `Cookie` header string. Name, value encoding, and chunking all come out correct by
construction.

Do **not** hand-build `"base64-" + base64url(JSON.stringify(session))`. The format is internal, the
docs describe its chunking wrongly, and the read path treats a malformed value as *no session* with
only a `console.warn` — a drift would surface as a mysteriously-logged-out test, not an error.

#### 3. Endpoint driver helper

**File**: `tests/fixtures/endpoint.ts` (new)

**Intent**: Single place that renders an API route with a given account's session, so tests read as
intent rather than Container plumbing.

**Contract**: Wraps `experimental_AstroContainer.create()` and `renderToResponse(module, { routeType:
"endpoint", request, params, locals })`. Takes a namespace-imported endpoint module (`import * as
Endpoint from "@/pages/..."` — the endpoint's `POST` export is passed as a whole, not a default),
plus method, URL, `params`, optional `FormData` body, and an account. Sets the `Cookie` header from
the account and injects `locals: { user: { id: account.userId } }`. Returns the raw `Response`;
assertions belong in the tests.

Note the endpoints redirect on success and take `formData` (`AGENTS.md` convention) — the driver must
not follow redirects, and tests assert on `status` + `Location`.

#### 4. Positive control test

**File**: `tests/isolation/positive-control.test.ts` (new)

**Intent**: Prove the whole chain works before asserting anything is denied. Without this, a wholesale
broken policy — or a `null` client — reads as perfect isolation.

**Contract**: Account A creates a deck via `POST /api/decks`, then renames it via
`POST /api/decks/[publicId]` and reads it back. Asserts the deck exists, is owned by A, and the rename
took effect. `listDecks` called with A's client returns A's deck. Deck names carry a unique suffix per
test (`deck.name` is UNIQUE per the schema).

### Success Criteria:

#### Automated Verification:

- Suite passes: `npm test`
- Lint passes: `npm run lint`
- Positive control demonstrably fails when `SUPABASE_URL` points at a stopped stack (verified once by
  hand — proves the test can fail)

#### Manual Verification:

- Two consecutive `npm test` runs both pass without a `db:reset` (unique-naming holds)
- No `service_role` key appears anywhere in the repo or `.env`
- The suite does not trip the auth rate limit across several consecutive runs

**Implementation Note**: This phase carries the change's main technical risk. If cookie capture does
not drive a real session to Postgres, STOP and re-plan before Phase 3 — do not fall back to a
database-level RLS test, which would re-prove the 2026-07-05 result and prove nothing about the
endpoints.

---

## Phase 3: Cross-account denial suite

### Overview

The actual risk coverage. Prove account B is denied A's decks and flashcards on read and on write.

### Changes Required:

#### 1. `deleteDeck` returns the deleted row

**File**: `src/lib/decks.ts`, `src/pages/api/decks/[publicId]/delete.ts`

**Intent**: `deleteDeck` is the only mutation in the codebase without `RETURNING`, so its endpoint
redirects to `/decks` whether it deleted a row or zero rows — a cross-account delete is answered with
a response indistinguishable from success. This is the recorded lesson (`lessons.md:47-52`) live in
production code, and the asymmetry with every sibling mutation is unjustified.

**Contract**: `deleteDeck` gains `.select("public_id").maybeSingle()`, mirroring
`deleteFlashcard` (`src/lib/flashcards.ts:111-118`). The endpoint branches on the returned row: no row
→ `new Response(null, { status: 404 })`, matching `[publicId].ts:52-54`. The success redirect to
`/decks` is unchanged. 404-not-403 holds: absent and RLS-hidden stay indistinguishable. Update the
comment at `delete.ts:7-9` — it currently asserts an ownership guarantee the endpoint does not itself
make.

#### 2. Deck denial tests

**File**: `tests/isolation/decks.test.ts` (new)

**Intent**: Cover both deck routes that are RLS-only on write.

**Contract**: With A's deck created via fixture, account B attempts `POST /api/decks/[publicId]`
(rename) and `POST /api/decks/[publicId]/delete` against A's `publicId`. Each asserts **both**: B gets
404, **and** A's deck still exists with its original name (re-read with A's client). The second
assertion is the load-bearing one — a 0-row no-op is silent, so "B got a 404" alone does not prove the
row survived.

Also assert `listDecks` with B's client does not contain A's deck, **and** does contain B's own
(positive control inline). This is the `/decks` read surface — `listDecks` has no `WHERE` at all, the
widest blast radius in the product.

#### 3. Flashcard denial tests

**File**: `tests/isolation/flashcards.test.ts` (new)

**Intent**: Flashcard policies are a separate mechanism — an `EXISTS`-join on `deck.user_id`
(`init_core_schema.sql:127-142`) rather than a direct `user_id` predicate — so deck tests do not
prove them.

**Contract**: A owns a deck with a card. B attempts, against A's deck/card `publicId`s:
`POST /api/decks/[publicId]/cards` (create), `POST /api/decks/[publicId]/cards/[cardPublicId]` (edit),
and `.../delete`. Each asserts B gets 404 **and** A's card is unchanged / still present / no new card
appeared in A's deck, re-read with A's client.

Include the containment case explicitly: B names **B's own deck** with **A's card id** — this must 404
via the `deck_id` scoping, and is the one place the app layer independently blocks a cross-resource
reach even without RLS (`src/lib/flashcards.ts:101-118`).

### Success Criteria:

#### Automated Verification:

- Full suite passes: `npm test`
- Lint and typecheck pass: `npm run lint`
- Build passes: `npm run build`
- Dropping a policy turns the suite red — verify once by hand with
  `drop policy deck_select on deck;` against the local stack, then `db:reset`

#### Manual Verification:

- Deck rename/delete still work normally in the running app (`npm run dev`) — the `deleteDeck` change
  did not regress the happy path
- Deleting a deck that does not exist returns 404 rather than a silent redirect
- Every denial test asserts row state, not just status codes

**Implementation Note**: Pause for manual confirmation after this phase. The policy-drop check is the
single most valuable manual step in this plan — it is what proves the suite can fail.

---

## Phase 4: CI gate

### Overview

Make `test-plan.md:120` true: unit + integration becomes required after this phase. A test that does
not run in CI does not protect against the regression it was written for.

### Changes Required:

#### 1. Test step in CI

**File**: `.github/workflows/ci.yml`

**Intent**: The `ci` job runs lint + build only (`:12-27`); nothing installs the Supabase CLI or starts
a stack, so the isolation suite could not run.

**Contract**: In the `ci` job, after `npm ci` and before or alongside lint: set up the Supabase CLI,
`supabase start`, then `npm test` with `SUPABASE_URL` / `SUPABASE_KEY` pointed at the *local* stack —
**not** the repository secrets. The local anon key is the CLI's fixed local value; the deploy job's
use of `secrets.SUPABASE_URL` / `secrets.SUPABASE_KEY` for `build` is unchanged.

Two constraints: the `deploy` job is `needs: ci` (`:29-48`), so a failing test blocks deploy without
further wiring. `paths-ignore: ["**/*.md", "context/**"]` (`:5,8`) stays — this change adds no
markdown-only trigger need.

The preflight's anon-role assertion means CI cannot accidentally run the isolation suite against a
`service_role` key, and its reachability check means a stack that failed to start fails the job
loudly instead of vacuously.

### Success Criteria:

#### Automated Verification:

- CI is green on the PR for this change
- The `ci` job log shows the suite running with a real test count, not "no tests found"
- `deploy` is correctly gated behind `ci`

#### Manual Verification:

- CI run time remains acceptable (`supabase start` adds roughly 1-2 min)
- A deliberately broken test (pushed to a scratch branch) turns CI red

**Implementation Note**: Pause for manual confirmation. Do not merge until CI has been observed both
green and red.

---

## Phase 5: Cookbook §6 + document sync

### Overview

Make the harness reusable and reconcile the plan documents with what shipped. §6 is what `/10x-tdd`
reads in Lesson 2.

### Changes Required:

#### 1. Cookbook entries

**File**: `context/foundation/test-plan.md`

**Intent**: §6.1, §6.2, and §6.4 currently read "TBD — see §3 Phase 1". Phase 1 has shipped; fill them
in.

**Contract**: Each entry names location, naming convention, a reference test to copy, and the run
command.

- §6.1 (unit test): `tests/`, `*.test.ts`, `npm test`.
- §6.2 (integration test): the cross-account denial pattern — reference `tests/isolation/decks.test.ts`;
  state the rule that assertions are row-based with a positive control, never status-only.
- §6.4 (data-access / ownership rule): the endpoint-driver pattern — real cookie via captured session,
  injected `locals.user`, real local Postgres; state explicitly that the Container API does not run
  middleware and that database-level RLS tests are not the pattern here and why.
- §6.6: one short note recording that the endpoint layer is now covered and the middleware guard is
  not.

Also update §4 Stack: the Supabase CLI row reads "2.23.4 (devDependency)" (`:98`) — that is the range
floor; the resolved version is 2.98.2. And §5: the unit+integration gate moves from "required after
§3 Phase 1" to required, wired.

#### 2. Rollout status

**File**: `context/foundation/test-plan.md`

**Intent**: §3's table is the orchestrator's state.

**Contract**: Phase 1 row Status → `complete`. Update the "Last updated" line.

#### 3. Roadmap reconciliation

**File**: `context/foundation/roadmap.md`

**Intent**: F-03's Outcome promises "one real cross-account test" on decks (S-01). This change shipped
decks *and* flashcards, read *and* write — confirmed as a deliberate widening. The roadmap should say
what was built.

**Contract**: Update F-03's Outcome to name the delivered scope; set Status → `done`. Leave the SRS
deferral to S-03 intact — that boundary is unchanged.

#### 4. Record the lessons

**File**: `context/foundation/lessons.md`

**Intent**: Two findings in this change are general rules that would otherwise be rediscovered the
hard way.

**Contract**: Add two entries in the file's existing Context/Problem/Rule/Applies-to shape:

- The Astro Container API does not run project middleware (source-verified in `astro@6.3.1`, docs
  silent); `locals` must be injected, and cookie-driven auth still works only because endpoints build
  their own client.
- Never hand-construct a `@supabase/ssr` session cookie; capture it via `setAll`. The format is
  internal, the docs get chunking wrong, and a malformed value reads as *no session* rather than an
  error.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Suite still green: `npm test`

#### Manual Verification:

- A contributor can add a new isolation test using only §6 without re-reading this plan
- §3 Phase 1 reads `complete`; re-running `/10x-test-plan` advances to Phase 2
- No document still claims the isolation test is deferred to F-03

---

## Testing Strategy

### Unit Tests:

- Preflight guard: rejects unset env, unreachable stack, and a non-anon `SUPABASE_KEY`.

### Integration Tests:

- Positive control: A creates, renames, reads back its own deck through the endpoints; `listDecks`
  with A's client returns it.
- Deck denial: B rename / delete against A's deck → 404 **and** A's row intact.
- Read denial: `listDecks` with B's client excludes A's decks, includes B's own.
- Flashcard denial: B create / edit / delete against A's deck+card → 404 **and** A's data intact.
- Containment: B's own deck + A's card id → 404.

### Manual Testing Steps:

1. `npm run db:start`, then `npm test` — suite green.
2. Drop a policy (`drop policy deck_select on deck;`) in the local DB, re-run — suite red. `db:reset`.
3. Unset `SUPABASE_URL`, re-run — preflight aborts loudly, no test reports a pass.
4. Point `SUPABASE_KEY` at a `service_role` key — preflight refuses to run.
5. `npm run dev` — create, rename, and delete a deck by hand; confirm the `deleteDeck` change did not
   regress the happy path.

## Performance Considerations

The suite signs in twice per run and issues a handful of endpoint round-trips against local Postgres —
seconds, not minutes. The auth rate limit (30 sign-ins / 5 min / IP, `config.toml:191`) is the real
constraint, which is why accounts are reused rather than created per test. In CI, `supabase start`
dominates at roughly 1-2 min.

## Migration Notes

No schema migration. The only production-code change is `deleteDeck` gaining `RETURNING` plus its
endpoint's 404 branch — behaviour-preserving on the happy path, and it changes a cross-account delete
from a false success redirect to a 404. No data migration, no rollback plan needed beyond reverting
the commit.

## Open Risks & Assumptions

- **The middleware guard stays untested** (decided). `PROTECTED_ROUTES` (`src/middleware.ts:4`) is
  prefix-matched, so a future route (e.g. `/api/study`) that is not added to the array is unprotected
  and nothing would catch it. Accepted for this phase; worth revisiting when Phase 4's SRS routes land.
- **The RLS gaps found in research remain open** — `flashcard.generation_id` unconstrained by any
  policy (a cross-account existence oracle over `generation_session`, not reachable through today's
  endpoints), no `FORCE ROW LEVEL SECURITY` on any table, and `revoke ... from PUBLIC` missing on the
  search RPC. Deliberately out of scope; file as their own change.
- **The Container API is `experimental_`-prefixed** in Astro 6. An Astro upgrade could move it.
- **Cookie capture depends on `setAll` firing**, which happens only when storage actually changed. If
  the fixture's throwaway client ever short-circuits sign-in, capture yields nothing — Phase 2's
  positive control is what surfaces that.

## References

- Research: `context/changes/verification-harness/research.md`
- Test plan: `context/foundation/test-plan.md` (Risk #1 at `:43`, response guidance at `:55`)
- Prior DB-level proof this supersedes:
  `context/archive/2026-07-05-per-user-data-isolation/rls-verification.md`
- Binding constraints: `context/foundation/lessons.md:47-52` (RETURNING), `:54-59` (role + JWT +
  positive control), `context/archive/2026-07-07-deck-workspace/plan.md:104-106` (404-not-403)
- Pattern to mirror for the `deleteDeck` fix: `src/lib/flashcards.ts:111-118`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner bootstrap + fail-fast preflight

#### Automated

- [x] 1.1 Dependencies install: `npm install` — 9fcfcee
- [x] 1.2 Type checking and lint pass: `npm run lint` — 9fcfcee
- [x] 1.3 Suite runs green against a started stack: `npm run db:start && npm test` — 9fcfcee
- [x] 1.4 Preflight fails loudly with `SUPABASE_URL` unset — 9fcfcee
- [x] 1.5 Build still passes: `npm run build` — 9fcfcee

#### Manual

- [x] 1.6 `npm run db:start` / `db:stop` / `db:reset` work from a cold start — 9fcfcee
- [ ] 1.7 Preflight's error message tells a new contributor exactly what to do
- [x] 1.8 `.env` parses correctly and prod credentials survive under `PROD_` — 9fcfcee

### Phase 2: Two-account session fixture + positive control

#### Automated

- [x] 2.1 Suite passes: `npm test` — 9c6ae8c
- [x] 2.2 Lint passes: `npm run lint` — 9c6ae8c
- [x] 2.3 Positive control demonstrably fails against a stopped stack — 9c6ae8c

#### Manual

- [x] 2.4 Two consecutive `npm test` runs pass without a `db:reset` — 9c6ae8c
- [x] 2.5 No `service_role` key appears anywhere in the repo or `.env` — 9c6ae8c
- [x] 2.6 The suite does not trip the auth rate limit across consecutive runs — 9c6ae8c

### Phase 3: Cross-account denial suite

#### Automated

- [x] 3.1 Full suite passes: `npm test`
- [x] 3.2 Lint and typecheck pass: `npm run lint`
- [x] 3.3 Build passes: `npm run build`
- [x] 3.4 Dropping a policy turns the suite red

#### Manual

- [x] 3.5 Deck rename/delete still work normally in the running app
- [x] 3.6 Deleting a nonexistent deck returns 404 rather than a silent redirect
- [x] 3.7 Every denial test asserts row state, not just status codes

### Phase 4: CI gate

#### Automated

- [ ] 4.1 CI is green on the PR for this change
- [ ] 4.2 The `ci` job log shows a real test count, not "no tests found"
- [ ] 4.3 `deploy` is correctly gated behind `ci`

#### Manual

- [ ] 4.4 CI run time remains acceptable
- [ ] 4.5 A deliberately broken test turns CI red

### Phase 5: Cookbook §6 + document sync

#### Automated

- [ ] 5.1 Lint passes: `npm run lint`
- [ ] 5.2 Suite still green: `npm test`

#### Manual

- [ ] 5.3 A contributor can add a new isolation test using only §6
- [ ] 5.4 §3 Phase 1 reads `complete`; `/10x-test-plan` advances to Phase 2
- [ ] 5.5 No document still claims the isolation test is deferred to F-03
