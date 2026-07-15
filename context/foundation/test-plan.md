# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-15 (§3 Phase 1 complete; §4, §5, §6.1/6.2/6.4/6.6 filled in)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in `<area>`"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`
(excluding docs, `context/`, build output, `node_modules`).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|--------------------------|--------|------------|--------------------------------|
| 1 | A new or changed API endpoint lets one account read or modify another account's deck or flashcards — the ownership check does not hold, RLS is bypassed, or a `publicId` from the URL is treated as authorization. Private content leaks across accounts. | High | High | interview Q1, interview Q3; PRD §Guardrails (per-account data isolation), PRD §Access Control; hot-spot dir `src/lib/` (18 commits/30d); hot-spot dir `src/pages/api/decks/[publicId]/cards/` (4 commits/30d) |
| 2 | A retry after a generation timeout writes a second set of candidates — the user gets duplicated cards and a duplicated generation session. | Medium | High | `context/foundation/lessons.md` (recorded tradeoff: write is not idempotent under client+server timeout with a retry button); PRD FR-018; hot-spot dir `src/lib/` (18 commits/30d) |
| 3 | The study session loses a card or writes the wrong next-review date, and cards that were never accepted enter review — the schedule stops being trustworthy. | High | Medium | PRD §Guardrails (spaced-repetition scheduling correctness), PRD §NFR (schedule survives across sessions), PRD US-02 acceptance criteria, PRD FR-006; roadmap S-03 (north star, next in sequence) |
| 4 | Private source text or the LLM API key escapes into a log line or an error response body. | High | Medium | PRD §Guardrails (privacy of pasted source text), PRD §NFR (privacy); `context/foundation/lessons.md` (prod secret is separate from `.env`; missing secret silently degraded to mock mode); abuse lens (secret/PII leakage) |
| 5 | The production schema drifts from the migration history — the deployed app writes against an un-migrated database. | High | Medium | interview Q2 (real incident during M2L5); `context/foundation/lessons.md` ×2 (cloud migration is a step distinct from app deploy; blind `migration repair` desynced prod history); hot-spot dir `supabase/migrations/` (6 commits/30d) |
| 6 | The server trusts the client — a crafted request bypasses the source-text length limit and the card content rules that the UI enforces. | Medium | Medium | PRD FR-003 (maximum source-text length), PRD FR-007; abuse lens (untrusted input, server-side validation parity); hot-spot dir `src/lib/` (18 commits/30d) |
| 7 | Generation returns cards in the wrong language or cards that are unusable, so the acceptance rate falls below 75% and the product thesis fails. | High | Medium | PRD §Success Criteria (≥75% of generated cards accepted; ≥75% of cards created via generation), PRD §NFR (cards follow the source-text language: PL/EN/ES); roadmap S-05 |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | Account B is denied account A's resource on read **and** on write, while account A still reaches its own data | "Authenticated implies authorized"; "RLS is enabled, therefore the endpoint is safe" | Session/JWT shape, where the ownership check is enforced, how a `publicId` maps to a row, which queries run under which role | integration on the endpoint + RLS exercised with JWT claims | Testing as `postgres` (bypasses RLS); no positive control, so "zero rows" reads as isolation when the policy is simply broken |
| #2 | Two identical requests produce exactly one set of cards | "Client timed out, therefore the server did not commit" | Idempotency key or dedup boundary, timeout ordering, where the write transaction ends | integration (two requests against one endpoint) | Asserting only the timeout ordering instead of the actual race |
| #3 | A card rated well-known is deferred further than a card rated hard; the schedule survives a restart; only `accepted` cards enter a session | "The session returned cards, therefore the schedule works" | FSRS schedule columns vs the existing card `state_id`, source of "now", persistence boundary | unit on rating→next-review mapping + integration on persistence | Assertion copied from the implementation (oracle problem); happy path with no restart |
| #4 | Neither the error body nor the log line contains source text or the API key | "A 500 is harmless" | The FR-018 error path, what is written to logs vs returned to the client | integration on the failure path | Asserting the status code instead of the payload contents |
| #5 | A drift between migration history and the deployed schema stops the pipeline **before** the app deploys | "Green locally means prod is migrated" | The CI steps, how (and whether) `db push` is wired relative to deploy | CI gate (drift check) | A unit test where a gate is required |
| #6 | A request that bypasses the UI gets a 4xx, not a write | "Validated in the form means validated" | Where the schema validation runs, client/server parity | integration on the endpoint | Driving the case through the UI only, never touching the server |
| #7 | Cards come back in the source language and are usable for PL/EN/ES material | "The model returned valid JSON, therefore the cards are good" | The prompt, the response contract, the model selection | AI-native (LLM-as-judge over a reference set) | Snapshotting the model response — non-deterministic, breaks without signal |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|-----------|------------------|---------------|------------|--------|----------------|
| 1 | Harness + per-account isolation | Stand up the runner and prove cross-account denial on read and write | #1 | runner bootstrap, integration, RLS | complete | `context/changes/verification-harness/` |
| 2 | Endpoint contract | Prove the server does not trust the client, does not leak, and does not duplicate on retry | #2, #4, #6 | integration | not started | — |
| 3 | Quality gates + schema drift | Make green CI mean "tested and prod actually migrated" | #5 | gates | not started | — |
| 4 | SRS schedule correctness | Prove the schedule defers by rating, survives restart, and admits only accepted cards | #3 | unit + integration | not started | — |
| 5 | AI-native generation quality | Prove cards match the source language and are usable, so the 75% thesis is measurable | #7 | LLM-as-judge | not started | — |

Sequencing notes:

- Phase 1 corresponds to roadmap **F-03 `verification-harness`**. It reused
  that change-id rather than opening a competing one. Delivered wider than
  F-03's "one real cross-account test": decks **and** flashcards, read
  **and** write, driven through the real endpoints and gated in CI — see
  §6.6.
- Phase 4 depends on roadmap **S-03 `srs-study-session`** shipping — the
  schedule does not exist yet, and roadmap F-03 already deferred this test
  to S-03.
- Phase 5 depends on roadmap **S-05 `candidate-review`** shipping — the
  acceptance signal the judge calibrates against is produced there.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | Vitest | 4.1.10 | Configured through `getViteConfig()` from `astro/config` (`vitest.config.ts`), which is what resolves the `@/*` alias and `astro:env/server`. The adapter's `@cloudflare/vite-plugin` is stripped there — it fights Astro over the `ssr` environment and tests target Node; checked: 2026-07-15 |
| endpoint rendering | Astro Container API | ships with Astro 6 | `renderToResponse` with `routeType: "endpoint"` renders an API route against a real `Request`; checked: 2026-07-15 |
| API mocking | none yet — see Phase 2 | — | Only the external HTTP edge (the LLM provider) needs a double; the database is real via local Supabase |
| database under test | Supabase CLI local stack | 2.98.2 (devDependency; `^2.23.4` in `package.json` is only the range floor) | Driven by `npm run db:start` / `db:stop` / `db:reset`; RLS is only meaningful against a real Postgres. CI starts the same stack and reads its URL + publishable key from `supabase status -o env`; checked: 2026-07-15 |
| e2e | none yet — deliberately deferred | — | No rollout phase claims e2e; promote only if a risk survives cheaper layers |
| accessibility | `eslint-plugin-jsx-a11y` | 6.10.2 | Lint-level only; PRD names baseline a11y but no risk in §2 requires an axe run yet |
| (optional) AI-native | LLM-as-judge over a reference set — checked: 2026-07-15 | n/a | **When NOT to use**: any assertion a deterministic check can make (JSON shape, card count, field presence, language tag). The judge is for usability and language fidelity only, and only once Phase 5's dependency lands |

**Stack grounding tools (current session):**

- Docs: Context7 (`/withastro/docs`) — checked Astro's testing guide for the current Vitest setup path (`getViteConfig()`) and the Container API endpoint-testing shape; checked: 2026-07-15
- Search: Exa.ai — available; not used, the docs MCP answered the stack question directly; checked: 2026-07-15
- Runtime/browser: claude-in-chrome — available; not used, no §2 risk is DOM-unreachable and no phase claims e2e; checked: 2026-07-15
- Provider/platform: Supabase MCP (requires interactive auth, unavailable in headless runs), Atlassian/Jira MCP — noted for Phase 3 gate work only; GitHub Actions is the CI surface every gate in §5 must map onto; checked: 2026-07-15

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase `<N>`" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck | local (husky `pre-commit` via lint-staged) + CI | required — wired today | syntactic / type drift |
| build | CI | required — wired today | broken production build |
| unit + integration | local + CI | required — wired by §3 Phase 1 | logic regressions, cross-account access, endpoint contract breaks |
| migration/schema drift check | CI, before deploy | required after §3 Phase 3 | deployed app running against an un-migrated prod schema |
| post-edit hook | local (agent loop) | recommended local, not a CI substitute | regressions at edit time |
| prod smoke on a real flow | between merge and "done" | optional | environment-specific failures (missing prod secret, silent mock mode) |
| LLM-as-judge on generation quality | CI, nightly or on generation-path changes | optional after §3 Phase 5 | wrong-language or unusable cards |

e2e on critical flows is deliberately absent: no §3 phase wires it, so
listing it as a gate would be aspirational. Add it only if a risk survives
the integration layer.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase `<N>`."

### 6.1 Adding a unit test

- **Location**: `tests/`, mirroring the `src/` path of what you test.
- **Naming**: `*.test.ts`. Only files matching `tests/**/*.test.ts` are
  collected (`vitest.config.ts`).
- **Reference**: `tests/harness.test.ts` — the smallest possible case;
  imports through the `@/` alias and asserts on the result.
- **Run**: `npm test` (single pass) or `npm run test:watch`. One file while
  iterating: `npx vitest run tests/isolation/decks.test.ts`.
- **Note**: the whole suite requires a running local stack, because
  preflight (§6.4) aborts the run without one — even for a test that never
  touches the database. Start it with `npm run db:start`.
- Phase 4 extends this with the rating→next-review mapping pattern.

### 6.2 Adding an integration test

- **Location**: `tests/isolation/` for ownership cases; a sibling folder
  named after the concern otherwise.
- **Naming**: `*.test.ts`, named after the **resource**, not the scenario
  (`decks.test.ts`, `flashcards.test.ts`). A new case for a resource that
  already has a file goes in that file as another `it()` — do not open
  `decks-read.test.ts` next to `decks.test.ts`. One file per resource keeps
  every claim about that resource in one place, which is what makes a gap
  visible.
- **Check §6.6 first.** It tabulates what is already covered per resource.
  Read it before writing anything — the case you are about to add may exist,
  and if it does not, that table is where its absence is visible.
- **Reference**: `tests/isolation/decks.test.ts` — copy this one. It drives
  the real endpoint with account B's session against account A's
  `publicId`, and for each attempt asserts **both** that B gets 404 **and**
  that A's row is unchanged when re-read with A's client.
- **Run**: `npm test`.
- **The rule that makes these tests real**: assertions are row-based and
  always paired with a positive control — never status-only. A cross-tenant
  `UPDATE`/`DELETE` under RLS is a silent 0-row no-op, and a misconfigured
  `createClient` returns `null`; both are indistinguishable from success
  from the outside. "B got a 404" alone does not prove A's row survived, and
  a wholesale broken policy reads as perfect isolation unless something also
  proves the owner still reaches their own data.
- **Where the positive control goes**: inline, in the same `describe`, next
  to the denial it backs — `decks.test.ts` and `flashcards.test.ts` both do
  this, and it is the pattern to follow. `tests/isolation/positive-control.test.ts`
  is a different thing and not a template: it proves the *harness itself*
  (session, cookie, endpoint driver) works end-to-end, so that a green
  denial suite cannot be the result of a chain that was never connected.
- **Denials assert 404, never 403** — an absent row and an RLS-hidden row
  must stay indistinguishable.

### 6.3 Adding a test for a new API endpoint

- TBD — see §3 Phase 2 for the server-side validation-parity and
  no-leak-in-error-body patterns.

### 6.4 Adding a test for a data-access or ownership rule

The pattern is: **drive the real endpoint with a real session cookie against
the real local Postgres.** Nothing is mocked. The three helpers in
`tests/fixtures/` are the whole apparatus:

- `accounts.ts` — provisions the run's two accounts (A and B) once, via the
  anon key, and hands them to every file. Two accounts per run, not per
  test: the auth rate limit is 30 sign-ins / 5 min / IP.
- `session.ts` — turns a signed-in session into a `Cookie` header by
  capturing what `createServerClient` writes through `setAll`.
- `endpoint.ts` — renders an API route via the Astro Container API with that
  cookie plus an injected `locals.user`.

Two things about this pattern are non-obvious and easy to get wrong:

- **The Container API does not run project middleware**, so `locals` must be
  injected by hand. This is faithful rather than a shortcut: the middleware
  only ever answers "is someone signed in?" — it is resource-blind. Injecting
  `locals.user = B` while sending B's real cookie is a literal encoding of
  the assumption under test, "authenticated implies authorized". The cookie
  still drives the real chain because each endpoint builds its own Supabase
  client from the request headers.
- **Never hand-construct the session cookie.** Capture it via `setAll`. The
  format is internal to `@supabase/ssr`, its name depends on the
  `SUPABASE_URL` hostname, and a malformed value is read as *no session*
  with only a `console.warn` — drift would surface as a mysteriously
  logged-out test, not an error.

**Pages (`.astro`) are deliberately not rendered.** `callEndpoint` drives API
routes only (`routeType: "endpoint"`); there is no page-rendering helper and
you are not expected to write one. To cover a read surface that a page owns
(e.g. `/decks/[publicId]`), call the data-access functions its frontmatter
calls — `getDeckByPublicId`, `listFlashcards` — with an RLS-scoped client
from `clientFor`. Same database path, same RLS, same signal, without the
renderer. Know the limit this buys: an ownership check added *only* in a
page's frontmatter would not be caught. That is acceptable today because the
pages carry no such check — RLS is the lock — but if one is ever added there,
this pattern stops being sufficient.

**Translating "404, never 403" below the HTTP layer**: a lib function has no
status code. `getDeckByPublicId` returning `{ data: null, error: null }` is
the equivalent of the 404 — absence, not a raised denial. Assert `data` is
null; never assert on an error.

**Database-level RLS tests are deliberately not the pattern here.** Setting a
role and JWT claims in SQL proves the policies; it does not prove the app
sends the JWT at all, and would stay green if the endpoint layer stopped
doing so. That proof already exists once, at
`context/archive/2026-07-05-per-user-data-isolation/rls-verification.md`;
re-doing it buys nothing. Test the endpoint.

**Preflight** (`tests/setup/preflight.ts`) runs as a `globalSetup` and aborts
the whole run when `SUPABASE_URL`/`SUPABASE_KEY` are unset, the stack is
unreachable, or `SUPABASE_KEY` is not the publishable/anon key. That last
check is load-bearing, not hygiene: a secret/`service_role` key bypasses RLS,
and RLS is the only lock — the app carries no `user_id` predicates on read.
No test could see that from the outside.

### 6.5 Adding a test for the generation path

- TBD — see §3 Phase 2 for the retry-idempotency pattern (two identical
  requests, one set of cards); §3 Phase 5 for language and usability
  judging.

### 6.6 Per-rollout-phase notes

(Filled in by each rollout phase's final sub-phase.)

- **Phase 1 (`verification-harness`, 2026-07-15)** — what Risk #1 coverage
  now means, precisely:

  | Surface | Non-owner denied on write | Non-owner denied on read |
  |---------|---------------------------|--------------------------|
  | decks | rename, delete (`decks.test.ts`) | `listDecks` (`decks.test.ts`) |
  | flashcards | create, edit, delete, containment (`flashcards.test.ts`) | `listFlashcards` (`flashcards.test.ts`) |

  Read denial is asserted on the **data-access functions the pages call**,
  not on a rendered page (see §6.4 on why pages are not rendered). Every
  denial is paired with an owner-side re-read and a positive control.

  **Not covered, deliberately**: the middleware guard. `PROTECTED_ROUTES`
  (`src/middleware.ts`) is prefix-matched, so a future route nobody adds to
  the array is unprotected and no test here would catch it — out of scope
  (Risk #1 is authorization, not authentication), worth revisiting when
  Phase 4's SRS routes land.

  Phase 1 also shipped one production fix: `deleteDeck` gained `RETURNING`,
  so a cross-account delete answers 404 instead of a redirect
  indistinguishable from success.

  **How the flashcard read test got written is the cautionary tale**: it did
  not exist until a contributor exercise (§6 read cold, plan unread) tried to
  add one and found the gap — the write suite passed happily while a
  neutered `flashcard_select` policy leaked A's cards to B. If you are
  tempted to trust a row in the table above, neuter the matching policy
  (`using (true)`) and confirm something goes red.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Generated Supabase types (`src/db/database.types.ts`)** — the generator
  is the test. Re-evaluate if the file is ever hand-edited. (Source: Phase 2
  interview Q5.)
- **shadcn-style primitives in `src/components/ui/`** — vendored library
  surface, not this project's logic. Re-evaluate if a primitive grows
  project-specific behaviour. (Source: Phase 2 interview Q5.)
- **Marketing/landing pages and static copy** — snapshot tests break
  constantly and catch nothing. Re-evaluate if the landing gains a real
  flow (e.g. the inline sign-in form parked as C10X-20). (Source: Phase 2
  interview Q5.)
- **Rate limiting on generation** — no rate limit exists, so a test would
  require adding the safeguard first. Re-evaluate if a limit is
  implemented; the cost exposure is partially covered by Risk #6
  (server-side length enforcement). (Source: Phase 3 challenger pass.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-07-15
- Stack versions last verified: 2026-07-15
- AI-native tool references last verified: 2026-07-15

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
