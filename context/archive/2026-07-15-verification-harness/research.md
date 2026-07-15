---
date: 2026-07-15T19:11:42+02:00
researcher: lirdaw
git_commit: 6e42985d8e8803661b74a09a767167bf485ea871
branch: main
repository: lirdaw/10xcards
topic: "Risk #1 — cross-account access to decks/flashcards: where ownership is actually enforced, what RLS covers, and what test infra exists"
tags: [research, codebase, rls, authorization, supabase, test-harness, verification-harness]
status: complete
last_updated: 2026-07-15
last_updated_by: lirdaw
---

# Research: Risk #1 — cross-account access to decks and flashcards

**Date**: 2026-07-15T19:11:42+02:00
**Researcher**: lirdaw
**Git Commit**: 6e42985d8e8803661b74a09a767167bf485ea871
**Branch**: main
**Repository**: lirdaw/10xcards

## Research Question

Risk #1 from `context/foundation/test-plan.md:43` — a new or changed API endpoint lets account B
read or modify account A's deck or flashcards: the ownership check does not hold, RLS is bypassed,
or a `publicId` from the URL is treated as authorization.

Investigate: where resource ownership is actually enforced (`src/pages/api/`, middleware, the
Supabase layer), which RLS policies exist in the migrations, and what test runner / test infra is
(not) configured. Challenge the assumptions "authenticated implies authorized" and "RLS is enabled,
therefore the endpoint is safe".

## Summary

**Both challenged assumptions are load-bearing in this codebase, and one of them is literally true
of the code as written.**

1. **"Authenticated implies authorized" is not an assumption here — it is the implementation.**
   Every deck/card mutation endpoint checks `context.locals.user` for *presence* and nothing more.
   `user_id` appears in `src/` at exactly four places, and all four are INSERT payloads
   (`src/lib/decks.ts:30`, `src/pages/api/generate.ts:136,161,198`). **Not one read, update, or
   delete query in the application carries a `user_id` predicate.** `listDecks`
   (`src/lib/decks.ts:11-13`) has no `WHERE` clause at all.

2. **"RLS is enabled, therefore the endpoint is safe" is *currently true* — and that is the
   problem.** RLS is not one of two locks; it is the only lock. The policies themselves are
   well-built (deny-by-default, per-command, `WITH CHECK` on every write, correct `EXISTS`-join for
   nested ownership). The risk is **not that RLS is wrong — it is that RLS is alone**, and nothing
   in code, tests, or CI would detect its removal or bypass.

3. **The seam named in the test plan has never been verified.** The only isolation evidence in the
   repo is a manual, *database-level* proof from 2026-07-05
   (`context/archive/2026-07-05-per-user-data-isolation/rls-verification.md`) — written **before any
   API endpoint existed**. No artifact has ever verified that the *endpoint layer* (middleware →
   `locals.user` → SSR client → cookie → JWT) actually carries the session down to Postgres. Four
   separate slices deferred that test to F-03. This change is that accumulated debt.

4. **One genuine hole found that RLS does not close**: `flashcard.generation_id` is unconstrained by
   any policy (§ Detailed Findings → RLS gaps). It yields a cross-account existence oracle over
   `generation_session`. It is *not* reachable through today's endpoints, so it is a policy gap, not
   a live exploit — but it is exactly the kind of gap a Phase 1 harness should be able to see.

5. **Test infra: zero.** No runner, no config, no test file, no CI test step. Docker 29.2.1 and
   Supabase CLI 2.98.2 are present and working, so the local Postgres path is open.

**Verdict for Phase 1**: the cross-account probe must run **through the endpoints**, not against the
database. A DB-level RLS test would re-prove the 2026-07-05 result and would pass even if the app
layer stopped sending the JWT entirely.

## Detailed Findings

### Ownership enforcement — the app layer

`src/middleware.ts:4` guards `PROTECTED_ROUTES = ["/dashboard", "/decks", "/api/decks", "/generate",
"/api/generate"]` via `startsWith`. **No coverage gap** — every data-touching route is matched, and
`/api/auth/*` is correctly excluded. It fails closed: when `createClient` returns `null`
(`src/lib/supabase.ts:7-9`), `locals.user = null` and every protected route redirects to sign-in
(`src/middleware.ts:8-15`).

But middleware answers exactly one question — *is someone signed in?* It is resource-blind by
construction; prefix matching cannot know **which** deck is addressed.

Per-endpoint reality (all routes are POST-only):

| Endpoint | File:line | `user_id` in query? | Layers |
|---|---|---|---|
| `POST /api/decks` (create) | `src/pages/api/decks/index.ts:36` | **yes** — stamped on insert | **2** (app + `deck_insert` WITH CHECK) |
| `POST /api/decks/[publicId]` (rename) | `src/lib/decks.ts:34` | **no** — `.eq("public_id", …)` only | **1** (RLS only) |
| `POST /api/decks/[publicId]/delete` | `src/lib/decks.ts:38` | **no** | **1** — and cascades all cards |
| `POST /api/decks/[publicId]/cards` (create) | `src/lib/flashcards.ts:56` | **no** | **1** |
| `POST /api/decks/[publicId]/cards/[cardPublicId]` (edit) | `src/lib/flashcards.ts:101-108` | **no** — `public_id` + `deck_id` | **1** + containment |
| `POST /api/decks/[publicId]/cards/[cardPublicId]/delete` | `src/lib/flashcards.ts:111-118` | **no** | **1** + containment |
| `POST /api/generate` | `src/pages/api/generate.ts:95` vs `:136,161,198` | **mixed** | session row **2**, target deck **1** |

The `if (!context.locals.user)` guards at `[publicId].ts:27`, `delete.ts:24`, `cards/index.ts:27`,
`[cardPublicId].ts:27`, `[cardPublicId]/delete.ts:27` are **authentication checks that the
surrounding comments describe as ownership guarantees** — e.g. `[publicId]/delete.ts:9` ("RLS
guarantees only the owner's deck can be deleted"). The comments are accurate *conditional on RLS*,
and they read to a reviewer as "this endpoint checks ownership." It does not.

`POST /api/generate` is internally inconsistent: it resolves the target deck with
`deckIdByPublicId` (`src/pages/api/generate.ts:95`, no `user_id`) but stamps `user_id: user.id` on
every `generation_session` write. The audit trail is defended at two layers; the deck it writes
cards into is defended at one.

### `publicId` — is it treated as authorization?

`public_id` is `uuid not null default gen_random_uuid() unique`
(`supabase/migrations/20260705180246_init_core_schema.sql:43,59`) — random v4, not enumerable.
Internal `id` is sequential (`bigint generated always as identity (start with 100000)`, `:42,58`)
but stays server-side; loaders pass only `public_id` to islands
(`src/pages/decks/[publicId]/index.astro:154-166`).

**Yes — on rename and delete deck.** `renameDeck` and `deleteDeck` (`src/lib/decks.ts:33-39`) go
straight from URL param to mutation with no ownership resolution. The only thing between
`POST /api/decks/<A's-uuid>/delete` and A's deck being destroyed is the `deck_delete` policy.
Elsewhere `publicId` at least passes through an RLS-scoped deck resolve first — which is still RLS,
just reached one hop earlier.

The `UUID_RE` checks on all five mutation routes (`[publicId].ts:7` et al.) are format validation
for redirect-header safety per their own comments — **not** an ownership control. Historically this
is consistent: `context/archive/2026-07-05-per-user-data-isolation/plan.md:78-81` establishes
`public_id` as an **ID-hiding contract**, never an authorization token. No prior doc claims
otherwise. The hazard is that with RLS absent, the UUID's entropy silently becomes the *de facto*
access control — security-by-obscurity, where any URL leak (shared link, log line, referrer,
screenshot) is a full data compromise.

### Nested resources — containment ≠ ownership

Both card mutation routes do a two-step resolve: `deckIdByPublicId` → internal `deck.id`
(`[cardPublicId].ts:40`), then scope the mutation by **both** `public_id` and `deck_id`
(`src/lib/flashcards.ts:101-108`).

**Can a card of deck A be reached via a URL naming deck B? No** — and this holds *even without RLS*.
It is the one place the app layer independently prevents a cross-resource reach.

**But it verifies containment, not ownership.** The deck's own ownership is never checked. Without
RLS, `POST /api/decks/<A's-deck>/cards/<A's-card>/delete` — a self-consistent URL naming A's deck and
a card genuinely inside it — passes the containment check cleanly and deletes A's card. The
`deck_id` scoping defends against *mismatched* pairs, not *foreign but consistent* ones. Which is
the attack that matters. Its origin confirms this: it was introduced as a **routing/UX fix**, not a
security control (`context/archive/2026-07-09-manual-card-crud/reviews/plan-review.md:56-57`).

### SSR loaders

| Page | File:line | `user_id` filter | If RLS absent |
|---|---|---|---|
| `/decks` | `src/pages/decks/index.astro:7-8` | **none** — `listDecks` has no `WHERE` | **renders every deck of every user** |
| `/decks/[publicId]` | `src/pages/decks/[publicId]/index.astro:16-79` | none | full read of A's deck + cards |
| `/generate` | `src/pages/generate.astro:11-13` | none | deck selector lists all users' decks |

The 404-not-403 handling (`decks/[publicId]/index.astro:18-33`) is good practice — absent and
RLS-hidden are indistinguishable, so no cross-account existence oracle — **but it only holds while
RLS is what hides the row.**

### The Supabase layer

`src/lib/supabase.ts:6-26` is the sole client factory; 13 call sites, all the identical two-arg
cookie form. It wires `getAll`/`setAll` to the request `Cookie` header, so the client is always
session-bound and `auth.uid()` is populated. **No `service_role` anywhere** — grep for
`service_role|SERVICE_ROLE|serviceRole|auth.admin` across the repo returns zero hits. No code path
bypasses RLS today.

**But the anon-ness of the key is a naming convention, not an invariant.** `SUPABASE_KEY` is a bare
`envField.string()` (`astro.config.mjs:20`), declared `optional: true`. Nothing validates that the
deployed value is the `anon` key. **Pasting a `service_role` key into `SUPABASE_KEY` silently
disables every ownership guarantee in the product** — RLS is bypassed for `service_role`, and since
the app layer has no `user_id` predicates, there is no second line of defense. The app would
function normally and leak every user's data. `init_core_schema.sql:86-89` forbids this in prose;
nothing enforces it. **This is the sharpest latent risk in the codebase**, and it is cheap to close:
`SUPABASE_KEY` is a JWT — its `role` claim is trivially inspectable.

### RLS policies — the inventory

RLS is `ENABLE`d on all 5 tables (`init_core_schema.sql:91-93`, `manual_card_source.sql:39`,
`generation_session.sql:58`). `anon` is explicitly `REVOKE`d on all 5. No `FOR ALL` policy, no
`USING (true)` on user data, **no `DROP POLICY` / `ALTER POLICY` / `DISABLE ROW LEVEL SECURITY` in
any migration** (verified directly: zero hits).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `deck` | `user_id = (select auth.uid())` | WITH CHECK same | USING + **WITH CHECK** | USING same |
| `flashcard` | `EXISTS`-join on `deck.user_id` | WITH CHECK same join | USING + **WITH CHECK** join | USING same join |
| `generation_session` | `user_id = (select auth.uid())` | WITH CHECK same | USING + **WITH CHECK** | USING same |
| `flashcard_state` / `flashcard_source` | `USING (true)`, select-only | — (deny-by-default) | — | — |

The two `USING (true)` policies are on 2–3 row static dictionaries with select-only grants — benign.

**What RLS genuinely stops** (stated so the plan does not over-rotate): direct cross-account SELECT
on decks/cards/sessions; inserting into a foreign deck; **moving a row to another owner** —
`WITH CHECK` is present on all three UPDATE policies, which is the failure mode that breaks most
hand-written RLS and this schema gets it right; and all `anon` table access. Flashcard ownership by
`EXISTS`-join to `deck` with **no denormalized `user_id`** is the safer design — no drift, no second
forgeable ownership claim (`context/archive/2026-07-05-per-user-data-isolation/plan-brief.md:30`).

### RLS gaps — where "RLS is enabled" is not enough

Ranked by what actually matters for this phase:

1. **`flashcard.generation_id` is constrained by no policy.** `flashcard_insert`/`_update` check
   *only* `deck_id`. `generation_session.id` is sequential from 100000. Account B can insert a card
   into **B's own deck** with `generation_id = <A's session id>`; the `WITH CHECK` passes (the deck
   is B's), and the FK to `generation_session(id)` is validated by the system **bypassing RLS**
   (referential integrity is not subject to RLS). Insert succeeds → session exists; FK violation →
   it doesn't. That is a **cross-account existence oracle over the whole `generation_session`
   table**, plus permanent audit corruption (`ON DELETE SET NULL` at `generation_session.sql:47`
   makes A's cleanup silently null B's link). Introduced by `generation_session.sql:46-47`, which
   widened the attack surface without widening the policy.
   **Not reachable through today's endpoints** — `src/lib/generations.ts:51` sets `generation_id`
   server-side. It is a policy gap, not a live exploit. Missing predicate:
   `WITH CHECK (generation_id IS NULL OR EXISTS (SELECT 1 FROM generation_session g WHERE g.id = flashcard.generation_id AND g.user_id = (select auth.uid())))`.

2. **No `FORCE ROW LEVEL SECURITY` on any table** (verified: zero hits across all migrations).
   Supabase runs migrations as `postgres`, so `postgres` **owns** all 5 tables — and a table owner is
   exempt from its own RLS unless `FORCE` is set. Consequence: any future `SECURITY DEFINER`
   function owned by `postgres` bypasses RLS entirely. `deck_keyword_search.sql:38-40` explicitly
   warns against exactly this — **the warning is a comment, not a constraint.** `ALTER TABLE … FORCE
   ROW LEVEL SECURITY` would turn that comment into an enforced rule.

3. **`service_role` is never revoked** (zero hits). It is a `BYPASSRLS` role receiving Supabase's
   default privileges on new `public` tables. Mitigated only by the fact that no service-role key
   exists in `src/` today — see the key-swap risk above.

4. **RLS is row-scoped, not column-scoped**, and `grant update` is table-wide with no column list.
   Within their own rows users can write anything: `flashcard.state_id` (flip `generated` →
   `accepted` without review) and `source_id` (relabel an AI card as `manual`) are user-writable.
   Own-data only — **not an isolation breach** — but it corrupts *both* PRD primary success metrics
   (≥75% acceptance rate, ≥75% created via generation). Also `generation_session` is documented as
   immutable (`generation_session.sql:10-11`) yet carries a full UPDATE policy and has no
   `updated_at` — the audit log is editable by its subject, and by design the tamper is unrecorded.

5. **Grant comment does not match its code.** `deck_keyword_search.sql:64` does `revoke all on
   function … from anon` but **not from `PUBLIC`**. Postgres grants `EXECUTE` to `PUBLIC` on every
   new function by default, and `anon` is a member of `PUBLIC` — so the default grant survives and
   the comment at `:63` ("anon bez dostepu") does not describe what the code does. Not exploitable
   today: the function is `SECURITY INVOKER` (`:48`) and `revoke all on flashcard from anon` means
   the inner select fails with `permission denied`. The intended barrier is missing; a *different*,
   incidental barrier holds. Flip that function to `SECURITY DEFINER` (nothing prevents it, per gap
   #2) and it becomes an unauthenticated full-table read of every user's flashcards.

The `search_flashcards_in_deck(p_deck_id bigint, p_query text)` RPC (`deck_keyword_search.sql:46-61`)
takes a **raw enumerable bigint** and filters only on `deck_id` with no owner predicate — but it is
`SECURITY INVOKER`, callers reach it only after an RLS-scoped `deckIdByPublicId` resolve, and
`flashcard_select` still filters. **Correctly defended in depth. Not exploitable.**

### Test infrastructure — what exists

**Nothing.** Verified exhaustively:

- `package.json:5-14` — no `test` script. Zero test dependencies (`vitest`, `jest`, `playwright`,
  `@testing-library/*`, `msw`, `happy-dom`, `jsdom` all absent from disk and manifest).
- No `vitest.config.*`, `vite.config.*`, `playwright.config.*`, `jest.config.*`. No `test` key in
  `astro.config.mjs`.
- Zero `**/*.test.*` / `**/*.spec.*` files; no `__tests__`/`test`/`tests`/`e2e` directory.
- `.github/workflows/ci.yml` — the only workflow. Job `ci`: checkout → setup-node 22 → `npm ci` →
  `npx astro sync` → `npm run lint` → `npm run build`. **No test step, no Supabase, no migration
  step.** Job `deploy` (`:29-48`) is `needs: ci`, gated on push to `main`. Triggers are correctly on
  `main` (the `master` lesson at `context/foundation/lessons.md:5-10` was applied).
- `lint-staged` runs `eslint --fix` + `prettier` — **no test step in the pre-commit hook.**

### Test infrastructure — what makes Phase 1 feasible

- **Docker 29.2.1 installed and on PATH** — `supabase start` has its prerequisite.
- **Supabase CLI resolves to 2.98.2** (`package.json:54` pins `^2.23.4`). Note `test-plan.md:98`
  records "2.23.4" — that is the range floor, not the installed version. Minor staleness.
- `supabase/config.toml` exists (`supabase init` was run). Fixed ports: API 54321, DB 54322,
  Studio 54323, Inbucket 54324. `db.major_version = 17`.
- **`[auth.email] enable_confirmations = false`** (`config.toml:209`) — test users can be created
  programmatically with no email round-trip. This is what makes a two-account fixture cheap.
- `[db.migrations] enabled = true` (`:55`) — `supabase db reset` builds the real schema from the 4
  migrations.
- `db:types` (`package.json:13`) already uses `--local`, proving the local stack is part of the
  existing workflow.
- `tsconfig.json:8-11` — path alias `@/* → ./src/*` must be replicated in the runner. `getViteConfig()`
  from `astro/config` handles this (as `test-plan.md:95` anticipated).

### Test infrastructure — friction to plan around

- **No `db:start` / `db:stop` / `db:reset` npm script** — every local-stack action is ad-hoc.
- **`supabase/seed.sql` is missing** while `[db.seed] enabled = true` points at it
  (`config.toml:62-65`). No deterministic baseline. Suits per-test fixtures (which the isolation
  tests want anyway), but there is no shared seed.
- **CI cannot run DB tests today** — `ci.yml` never installs the CLI or starts the stack. Wiring
  that is Phase 3's gate work, not Phase 1's.
- **All four env vars are `optional: true`** (`astro.config.mjs:17-24`) — a test run with unset
  `SUPABASE_URL` **will not fail loudly**; `createClient` returns `null` and the suite proceeds and
  misleads. This is the same shape as the recorded lesson about prod silently degrading to mock mode
  (`lessons.md:117-122`). The harness needs an explicit fail-fast preflight.
- **No `.env.example`** — no committed manifest of required keys.
- Auth rate limits (`config.toml:191,193`: 30 sign-ins per 5 min per IP) could throttle a suite that
  signs up many users per run. Favour a small fixed set of reused test accounts over per-test signup.
- **`.env` appears corrupted**: line 11 is a pasted shell command (`claude --resume …`), and line 12
  begins with a bare `=`, meaning the intended `PROD_SUPABASE_KEY` name was overwritten. Most dotenv
  parsers will drop or error on both lines. Unrelated to Risk #1 but worth repairing before anything
  depends on `.env`. (Cross-check with the standing rule to keep prod creds under a `PROD_` prefix.)

## Code References

- `src/middleware.ts:4` — `PROTECTED_ROUTES`; prefix matching, authentication only, no authorization
- `src/lib/supabase.ts:6-26` — sole client factory; always cookie-bound; `SUPABASE_KEY` unvalidated
- `src/lib/decks.ts:11-13` — `listDecks`: **no `WHERE` clause at all**
- `src/lib/decks.ts:30` — `createDeck`: the only app-layer `user_id` writer on decks
- `src/lib/decks.ts:33-39` — `renameDeck` / `deleteDeck`: `public_id` straight to mutation, RLS-only
- `src/lib/flashcards.ts:101-118` — card update/delete scoped by `public_id` + `deck_id` (containment)
- `src/lib/generations.ts:29-34` — `failGenerationSession`: raw bigint `id`, no `user_id`, RLS-only
- `src/pages/api/generate.ts:95` vs `:136,161,198` — deck lookup unscoped; session writes scoped
- `src/pages/decks/index.astro:7-8` — SSR loader; renders `listDecks` with no owner filter
- `supabase/migrations/20260705180246_init_core_schema.sql:86-89` — the anon-key rule, in prose only
- `supabase/migrations/20260705180246_init_core_schema.sql:109-142` — the 8 deck/flashcard policies
- `supabase/migrations/20260712162349_generation_session.sql:46-47` — `generation_id` FK, no policy
- `supabase/migrations/20260712162359_deck_keyword_search.sql:38-40,48,64` — `SECURITY INVOKER`
  warning-as-comment; `revoke … from anon` missing `PUBLIC`
- `.github/workflows/ci.yml:12-27` — the `ci` job: lint + build, no tests
- `astro.config.mjs:17-24` — all four env vars `optional: true`
- `supabase/config.toml:209` — `enable_confirmations = false`

## Architecture Insights

- **The database tier is the strong part of this system; the application tier has no authorization
  code at all.** That is a coherent, deliberate architecture — `src/lib/decks.ts:4-7` and
  `src/lib/flashcards.ts:4-8` both state "all queries are RLS-scoped to the signed-in user" as the
  design contract. It is single-layer by choice, not by oversight.
- **There is no defense-in-depth doctrine in this project.** Searching `context/` for
  `defense in depth|dwie warstwy|redundan` returns no hits in an authorization sense. The one
  explicit second layer (`deck_id` scoping) was justified as a routing fix.
- **Silent-failure is the recurring shape of this codebase's risk.** Cross-tenant `UPDATE`/`DELETE`
  under RLS is a **0-row no-op, not an error**
  (`context/archive/2026-07-05-per-user-data-isolation/rls-verification.md:95-101`); a missing env
  var degrades to `null` rather than throwing; a missing prod secret degraded to mock mode. Every
  assertion in this phase must therefore be **row-count-based, with a positive control** — "no error"
  and "no rows" are both indistinguishable from success here.
- The comments asserting ownership on the mutation endpoints are the most dangerous artifact found:
  they are true conditional on RLS, and they read as if the endpoint checks something. A reviewer
  scanning `[publicId]/delete.ts:9` would conclude ownership is handled.

## Historical Context (from prior changes)

- `context/archive/2026-07-05-per-user-data-isolation/plan.md:78-81` — the **hidden-ID contract**:
  `public_id` is for ID-hiding, never authorization. Still binding.
- `context/archive/2026-07-05-per-user-data-isolation/plan.md:82-84` — *"Nie wolno wprowadzać klienta
  z service-role dla ścieżek użytkownika — obszedłby RLS i złamał guardrail izolacji."* The single
  stated way RLS can be defeated. Still binding, still unenforced.
- `context/archive/2026-07-05-per-user-data-isolation/plan.md:62` — *"Brak automatycznego testu
  izolacji w CI — należy do F-03."* The first of four deferrals.
- `context/archive/2026-07-05-per-user-data-isolation/rls-verification.md:95-101` — cross-tenant
  `UPDATE`/`DELETE` is a **silent 0-row no-op**; the proof is the affected-row count. Directly
  reusable.
- `context/archive/2026-07-07-deck-workspace/plan.md:104-106` — **404-not-403**: a missing row and an
  RLS-hidden row must be indistinguishable. Binding constraint on assertions.
- `context/archive/2026-07-09-manual-card-crud/reviews/plan-review.md:56-57` — `deck_id` scoping
  introduced as a **routing fix**, not a security control.
- `context/archive/2026-07-11-deck-keyword-search/plan.md:34` — states outright that queries do not
  filter by `user_id`, trusting RLS.
- `context/foundation/roadmap.md:110-121` — F-03 scope: runner + test-plan + **one** cross-account
  test on **S-01 (decks)**; SRS test deferred to S-03. **Scope tension**: `change.md:22-25` and
  test-plan Phase 1 widen this to decks **and** flashcards, read **and** write. Worth confirming
  whether the roadmap line should be updated.
- `context/foundation/lessons.md:54-59` — RLS tests need role **+ JWT claims + a positive control**;
  never as `postgres`.
- `context/foundation/lessons.md:47-52` — `RETURNING` on write-isolation checks, or a policy failure
  reads as a PASS.

## Related Research

- `context/archive/2026-07-05-per-user-data-isolation/rls-verification.md` — the manual DB-level
  two-account proof this phase supersedes with an endpoint-level automated one
- `context/archive/2026-07-07-deck-workspace/isolation-check.md`,
  `context/archive/2026-07-09-manual-card-crud/isolation-check.md` — prior manual per-slice checks
- `context/foundation/test-plan.md:53-61` — the Risk Response Guidance row this research grounds

## Implications for the Phase 1 plan

Findings the plan must carry, in priority order:

1. **Test through the endpoints, not the database.** A DB-level RLS test re-proves 2026-07-05 and
   would pass even if the app stopped sending the JWT. The untested seam is middleware → cookie →
   JWT → Postgres. The Astro Container API (`test-plan.md:96`) is the right layer.
2. **Assert row counts and content, never just status codes.** Silent 0-row no-ops are the house
   failure mode. 404 is the expected cross-account response (404-not-403 is binding), so "B got a
   404" must be paired with "A's row is still there / still unchanged."
3. **Positive control is mandatory** (`lessons.md:54-59`). Without it, a wholesale broken policy —
   or an unset `SUPABASE_URL` making `createClient` return `null` — reads as perfect isolation.
4. **Fail-fast preflight.** All env vars are `optional: true`; the suite must refuse to run rather
   than silently pass against a null client.
5. **Cover both deck routes that are RLS-only on write** (rename, delete) and both card routes, plus
   at least the `/decks` SSR loader — that loader has no `WHERE` and is the widest blast radius.
6. **Cheap, high-leverage hardening to consider in-scope** (each closes a gap no test can otherwise
   see): assert `SUPABASE_KEY` decodes to `role: anon`; add `FORCE ROW LEVEL SECURITY`; add the
   `generation_id` predicate; `revoke … from public` on the search RPC. These are *findings*, not
   requirements — the plan should weigh them against Phase 1's deliberately minimal scope
   (`roadmap.md:120`).

## Open Questions

1. **Scope**: roadmap F-03 promises one cross-account test on decks; Phase 1 widens to decks +
   flashcards, read + write. Confirm the widening and update `roadmap.md:112`, or narrow the phase.
2. **Are the four RLS hardening items (§gaps 1–5) in scope for Phase 1, or a separate change?** They
   are migrations, not tests — Phase 1 is a harness phase. Recommendation: file the `generation_id`
   predicate and `FORCE RLS` as their own change; keep the `SUPABASE_KEY` role assertion in Phase 1
   since it is a test-shaped guard.
3. **Test-account strategy**: reused fixed accounts vs per-test signup, given the 30-per-5-min auth
   rate limit (`config.toml:191`).
4. **Does Phase 1 wire the local Supabase stack into CI, or only local?** `test-plan.md:120` marks
   unit+integration "required after Phase 1", but `ci.yml` has no Supabase step and Phase 3 owns
   gates. If Phase 1 does not wire CI, the gate cannot become required when the plan says it does.
5. **`.env` corruption** (line 11–12) — unrelated to Risk #1; repair before the harness depends on it.
