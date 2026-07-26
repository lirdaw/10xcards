# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-26, second entry of the day (C10X-27 shipped — the change the
> morning's audit opened). **Phase 4 `reopened` → `complete`**: "the session loses a
> card" now has a test that advances the clock and re-enters the session, so both halves
> of Risk #3's scenario are proven. The production bug is fixed on both sides (middleware
> answers JSON callers with a 401; the client decision moved into `src/lib/http.ts`), and
> `session_size` → `p_limit`, the batch's composition, the cap's bounds and all four
> grades are covered. `enable_fuzz: false` is now **actually configured**, so §6.1's
> correction block becomes a statement of fact.
>
> Two things this entry adds that nobody had named. §6.6's four-policy neuter has
> **silently stopped working** — the dev DB outgrew PostgREST's `max_rows`, so the
> `listDueCounts` denial passes while the guard is fully disabled. And the batch's
> composition assertion observes ORDER, not the presence of the `f.id asc` tie-break:
> removing the clause leaves the suite green. Both are recorded as open gaps rather than
> smoothed over. Every count in §6.6 now comes from a run executed against the current
> files. Evidence: `context/changes/srs-study-session-test/verification.md` and
> `mutation-register.md`.
>
> Previously: 2026-07-26 (C10X-27 / roadmap H-02 audit of §3 Phase 4 — the first
> entry in this file written by auditing the code instead of a shipping change, and
> the first to move a phase BACKWARDS. **Phase 4 `complete` → `reopened`**: Risk #3's
> scenario has two halves and only "writes the wrong date" was proven; "the session
> loses a card" has no test, because nothing advances the clock and re-enters a
> session. Same audit: a **production bug** on the study path (`StudySession.rate()`
> reads the signed-out 302→HTML 200 as success and silently discards ratings),
> `session_size` → `p_limit` unobserved, `Rating.Again` never on the write path, and
> **§6.1's `enable_fuzz: false` claim is false** — the app never configures it. §6.6's
> Phase-1 signed-out note was stale in both directions and is corrected; §6.7 gained
> three traps; §3's Status vocabulary gained `reopened`. Evidence:
> `context/changes/srs-study-session-test/research.md`.)
>
> Previously: 2026-07-25 (roadmap S-05 `candidate-review`: Phase 5 extended
> Risk #1's surface to the first lifecycle transition and the first multi-row
> write — §6.6 extended, §6.8 added; Phase 6 landed generation idempotency, so
> **Risk #2 moved from characterized to covered** — §3, §6.5 and §6.6's Phase-2
> entry rewritten. Also: §7 negative space corrected and extended from C10X-22 —
> the `src/components/ui/` exclusion does not cover the global style layer, and
> focus-ring rendering is named as untested. No change to §2 or §3.)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in `<area>`"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`
(excluding docs, `context/`, build output, `node_modules`).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                                                   | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A new or changed API endpoint lets one account read or modify another account's deck or flashcards — the ownership check does not hold, RLS is bypassed, or a `publicId` from the URL is treated as authorization. Private content leaks across accounts. | High   | High       | interview Q1, interview Q3; PRD §Guardrails (per-account data isolation), PRD §Access Control; hot-spot dir `src/lib/` (18 commits/30d); hot-spot dir `src/pages/api/decks/[publicId]/cards/` (4 commits/30d)                          |
| 2   | A retry after a generation timeout writes a second set of candidates — the user gets duplicated cards and a duplicated generation session.                                                                                                                | Medium | High       | `context/foundation/lessons.md` (recorded tradeoff: write is not idempotent under client+server timeout with a retry button); PRD FR-018; hot-spot dir `src/lib/` (18 commits/30d)                                                     |
| 3   | The study session loses a card or writes the wrong next-review date, and cards that were never accepted enter review — the schedule stops being trustworthy.                                                                                              | High   | Medium     | PRD §Guardrails (spaced-repetition scheduling correctness), PRD §NFR (schedule survives across sessions), PRD US-02 acceptance criteria, PRD FR-006; roadmap S-03 (north star, next in sequence)                                       |
| 4   | Private source text or the LLM API key escapes into a log line or an error response body.                                                                                                                                                                 | High   | Medium     | PRD §Guardrails (privacy of pasted source text), PRD §NFR (privacy); `context/foundation/lessons.md` (prod secret is separate from `.env`; missing secret silently degraded to mock mode); abuse lens (secret/PII leakage)             |
| 5   | The production schema drifts from the migration history — the deployed app writes against an un-migrated database.                                                                                                                                        | High   | Medium     | interview Q2 (real incident during M2L5); `context/foundation/lessons.md` ×2 (cloud migration is a step distinct from app deploy; blind `migration repair` desynced prod history); hot-spot dir `supabase/migrations/` (6 commits/30d) |
| 6   | The server trusts the client — a crafted request bypasses the source-text length limit and the card content rules that the UI enforces.                                                                                                                   | Medium | Medium     | PRD FR-003 (maximum source-text length), PRD FR-007; abuse lens (untrusted input, server-side validation parity); hot-spot dir `src/lib/` (18 commits/30d)                                                                             |
| 7   | Generation returns cards in the wrong language or cards that are unusable, so the acceptance rate falls below 75% and the product thesis fails.                                                                                                           | High   | Medium     | PRD §Success Criteria (≥75% of generated cards accepted; ≥75% of cards created via generation), PRD §NFR (cards follow the source-text language: PL/EN/ES); roadmap S-05                                                               |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                | Must challenge                                                                       | Context `/10x-research` must ground                                                                                          | Likely cheapest layer                                           | Anti-pattern to avoid                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| #1   | Account B is denied account A's resource on read **and** on write, while account A still reaches its own data                              | "Authenticated implies authorized"; "RLS is enabled, therefore the endpoint is safe" | Session/JWT shape, where the ownership check is enforced, how a `publicId` maps to a row, which queries run under which role | integration on the endpoint + RLS exercised with JWT claims     | Testing as `postgres` (bypasses RLS); no positive control, so "zero rows" reads as isolation when the policy is simply broken |
| #2   | Two identical requests produce exactly one set of cards                                                                                    | "Client timed out, therefore the server did not commit"                              | Idempotency key or dedup boundary, timeout ordering, where the write transaction ends                                        | integration (two requests against one endpoint)                 | Asserting only the timeout ordering instead of the actual race                                                                |
| #3   | A card rated well-known is deferred further than a card rated hard; the schedule survives a restart; only `accepted` cards enter a session | "The session returned cards, therefore the schedule works"                           | FSRS schedule columns vs the existing card `state_id`, source of "now", persistence boundary                                 | unit on rating→next-review mapping + integration on persistence | Assertion copied from the implementation (oracle problem); happy path with no restart                                         |
| #4   | Neither the error body nor the log line contains source text or the API key                                                                | "A 500 is harmless"                                                                  | The FR-018 error path, what is written to logs vs returned to the client                                                     | integration on the failure path                                 | Asserting the status code instead of the payload contents                                                                     |
| #5   | A drift between migration history and the deployed schema stops the pipeline **before** the app deploys                                    | "Green locally means prod is migrated"                                               | The CI steps, how (and whether) `db push` is wired relative to deploy                                                        | CI gate (drift check)                                           | A unit test where a gate is required                                                                                          |
| #6   | A request that bypasses the UI gets a 4xx, not a write                                                                                     | "Validated in the form means validated"                                              | Where the schema validation runs, client/server parity                                                                       | integration on the endpoint                                     | Driving the case through the UI only, never touching the server                                                               |
| #7   | Cards come back in the source language and are usable for PL/EN/ES material                                                                | "The model returned valid JSON, therefore the cards are good"                        | The prompt, the response contract, the model selection                                                                       | AI-native (LLM-as-judge over a reference set)                   | Snapshotting the model response — non-deterministic, breaks without signal                                                    |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status normally moves left-to-right (`not started` →
`implementing` → `complete`); the orchestrator updates Status as artifacts
appear on disk. A fourth value, **`reopened`**, exists because a later audit can
show a `complete` phase never covered all of its risk — see Phase 4. Treat
`complete` as a dated claim, not a permanent state.

| #   | Phase name                      | Goal (one line)                                                                         | Risks covered                                                        | Test types                         | Status       | Change folder                                                                    |
| --- | ------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------- | ------------ | -------------------------------------------------------------------------------- |
| 1   | Harness + per-account isolation | Stand up the runner and prove cross-account denial on read and write                    | #1                                                                   | runner bootstrap, integration, RLS | complete     | `context/changes/verification-harness/`                                          |
| 2   | Endpoint contract               | Prove the server does not trust the client and does not leak; stop duplication on retry | #2 (**covered** — idempotency landed in S-05 Phase 6), #4, #6        | integration                        | implementing | `context/changes/ai-candidate-generation-test/`                                  |
| 3   | Quality gates + schema drift    | Make green CI mean "tested and prod actually migrated"                                  | #5                                                                   | gates                              | not started  | —                                                                                |
| 4   | SRS schedule correctness        | Prove the schedule defers by rating, survives restart, and admits only accepted cards   | #3 (**covered** — both halves; closed by C10X-27, 2026-07-26)        | unit + integration                 | complete     | `context/changes/srs-study-session/` → `context/changes/srs-study-session-test/` |
| 5   | AI-native generation quality    | Prove cards match the source language and are usable, so the 75% thesis is measurable   | #7                                                                   | LLM-as-judge                       | not started  | —                                                                                |

Sequencing notes:

- Phase 1 corresponds to roadmap **F-03 `verification-harness`**. It reused
  that change-id rather than opening a competing one. Delivered wider than
  F-03's "one real cross-account test": decks **and** flashcards, read
  **and** write, driven through the real endpoints and gated in CI — see
  §6.6.
- Phase 2's first slice (`ai-candidate-generation-test`) landed a
  **characterization** test for Risk #2: it asserted that a retry _did_
  duplicate, because idempotency was deferred to roadmap S-05 (finding F5).
  Roadmap slice **S-05 Phase 6 landed that idempotency**, so the standing
  instruction was carried out — the assertion was inverted (2 sessions → 1),
  not deleted, and Risk #2 is now **covered**. §6.6's Phase-2 entry records
  exactly what the inverted suite does and does not prove. Risks #4 and #6
  are still untouched, so the phase stays `implementing`.
- Phase 4 shipped inside roadmap **S-03 `srs-study-session`** (its Phase 5),
  which is where the schedule itself was built — roadmap F-03 had already
  deferred this test to S-03, so the phase reused that change folder rather
  than opening a competing one. Read §6.6 for exactly what that claim does and
  does not include, and §6.7 for how to add the next SRS test.
  **Reopened 2026-07-26** (status `complete` → `reopened`) by a full audit run
  under C10X-27 / roadmap **H-02**, change folder
  `context/changes/srs-study-session-test/`. The phase's own three claims hold and
  were re-verified by execution (69/69) — what reopens it is that Risk #3's
  scenario has two halves and only one is proven. "Writes the wrong next-review
  date" is covered; "**the study session loses a card**" is not, because no test
  ever advances the clock and re-enters a session. The same audit found a
  **production bug** on this path (`StudySession.rate()` treats the signed-out
  302 → HTML 200 as success and silently discards every rating) plus three
  unobserved wires: `session_size` → `p_limit`, the RPC's `f.id` tie-break, and
  `Rating.Again`. Details and evidence in §6.6's Phase 4 audit note. This is the
  first phase in this file to move _right-to-left_: treat "complete" as a claim
  with a date on it, not a permanent state.
  **Closed again 2026-07-26** (status `reopened` → `complete`) by C10X-27 itself, the
  change that audit opened. Both halves of Risk #3's scenario now carry a test: "writes
  the wrong next-review date" as before, and "**the study session loses a card**" by a
  case that rates at a fixed `now`, then re-enters the session at the persisted `due`
  (card present, still rated) and a minute after the rating (card absent). The production
  bug is fixed on both sides — middleware answers a JSON caller with a real 401, and the
  client's ok/parse decision moved into `src/lib/http.ts` where it has its own tests —
  and the three unobserved wires are covered: `session_size` → `p_limit`, the batch's
  composition, and all four grades including the `Again` lapse. The `reopened` vocabulary
  entry above **stays**: it earned its place, and this phase's history is the reason to
  keep reading `complete` as dated.
  Two gaps are deliberately left open rather than claimed — the `f.id asc` tie-break is
  not observable by any assertion here (only the batch's order is), and §6.6's four-policy
  neuter no longer reproduces. Both are described in the Phase 4 entry of §6.6.
- Phase 5 depends on roadmap **S-05 `candidate-review`** shipping — the
  acceptance signal the judge calibrates against is produced there.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                | Tool                                                    | Version                                                                     | Notes                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration   | Vitest                                                  | 4.1.10                                                                      | Configured through `getViteConfig()` from `astro/config` (`vitest.config.ts`), which is what resolves the `@/*` alias and `astro:env/server`. The adapter's `@cloudflare/vite-plugin` is stripped there — it fights Astro over the `ssr` environment and tests target Node; checked: 2026-07-15 |
| endpoint rendering   | Astro Container API                                     | ships with Astro 6                                                          | `renderToResponse` with `routeType: "endpoint"` renders an API route against a real `Request`; checked: 2026-07-15                                                                                                                                                                              |
| API mocking          | none yet — see Phase 2                                  | —                                                                           | Only the external HTTP edge (the LLM provider) needs a double; the database is real via local Supabase                                                                                                                                                                                          |
| database under test  | Supabase CLI local stack                                | 2.98.2 (devDependency; `^2.23.4` in `package.json` is only the range floor) | Driven by `npm run db:start` / `db:stop` / `db:reset`; RLS is only meaningful against a real Postgres. CI starts the same stack and reads its URL + publishable key from `supabase status -o env`; checked: 2026-07-15                                                                          |
| e2e                  | none yet — deliberately deferred                        | —                                                                           | No rollout phase claims e2e; promote only if a risk survives cheaper layers                                                                                                                                                                                                                     |
| accessibility        | `eslint-plugin-jsx-a11y`                                | 6.10.2                                                                      | Lint-level only; PRD names baseline a11y but no risk in §2 requires an axe run yet                                                                                                                                                                                                              |
| (optional) AI-native | LLM-as-judge over a reference set — checked: 2026-07-15 | n/a                                                                         | **When NOT to use**: any assertion a deterministic check can make (JSON shape, card count, field presence, language tag). The judge is for usability and language fidelity only, and only once Phase 5's dependency lands                                                                       |

**Stack grounding tools (current session):**

- Docs: Context7 (`/withastro/docs`) — checked Astro's testing guide for the current Vitest setup path (`getViteConfig()`) and the Container API endpoint-testing shape; checked: 2026-07-15
- Search: Exa.ai — available; not used, the docs MCP answered the stack question directly; checked: 2026-07-15
- Runtime/browser: claude-in-chrome — available; not used, no §2 risk is DOM-unreachable and no phase claims e2e; checked: 2026-07-15
- Provider/platform: Supabase MCP (requires interactive auth, unavailable in headless runs), Atlassian/Jira MCP — noted for Phase 3 gate work only; GitHub Actions is the CI surface every gate in §5 must map onto; checked: 2026-07-15

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase `<N>`" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                               | Where                                           | Required?                              | Catches                                                               |
| ---------------------------------- | ----------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| lint + typecheck                   | local (husky `pre-commit` via lint-staged) + CI | required — wired today                 | syntactic / type drift                                                |
| build                              | CI                                              | required — wired today                 | broken production build                                               |
| unit + integration                 | local + CI                                      | required — wired by §3 Phase 1         | logic regressions, cross-account access, endpoint contract breaks     |
| migration/schema drift check       | CI, before deploy                               | required after §3 Phase 3              | deployed app running against an un-migrated prod schema               |
| post-edit hook                     | local (agent loop)                              | recommended local, not a CI substitute | regressions at edit time                                              |
| prod smoke on a real flow          | between merge and "done"                        | optional                               | environment-specific failures (missing prod secret, silent mock mode) |
| LLM-as-judge on generation quality | CI, nightly or on generation-path changes       | optional after §3 Phase 5              | wrong-language or unusable cards                                      |

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

**The oracle-property pattern (added by Phase 4).** For logic whose expected
value is produced by a library — the rating→next-review mapping is the case
here — assert the **property**, never a copied constant.
`tests/study/schedule.test.ts` is the reference: it imports the app's own
configured `scheduler` (not a fresh inline `fsrs()`), so it pins the module's
configuration and not just the library, and asserts the ordering
`Easy.due > Good.due > Hard.due > Again.due` for a fixed `NOW`.

Two things make this legitimate rather than circular. `ts-fsrs` is pure and
immutable and **the app configures `enable_fuzz: false` explicitly**
(`generatorParameters(...)` in `src/lib/study.ts`), so the transition is a
deterministic function of `(card, now, grade)` — the library is an _independent_
oracle, and `next(card, now, grade)` takes `now` as a parameter, so nothing depends
on the wall clock.

> **History, kept because it is the reason the line is now trustworthy (C10X-27,
> 2026-07-26).** From 2026-07-24, when Phase 4 wrote this paragraph, to 2026-07-26 it
> asserted that configuration while nothing in `src/` performed it — two days, and the
> claim was already in two test-file headers as well: the call passed only `request_retention`,
> `maximum_interval` and `enable_short_term`, and fuzz was off solely because
> `default_enable_fuzz = false` upstream in ts-fsrs 5.4.1 — under a `^5.4.1` range.
> Every exact-`due` oracle in `tests/study/study.test.ts` therefore rested on an
> unpinned third-party default that an upstream flip inside the caret range would
> have turned intermittently red with no change in this repo. C10X-27 added the
> single line and confirmed the edit was behaviour-neutral the only way that can be
> confirmed: the whole suite stayed green (97/97 at that moment) across it. Had it
> gone red, determinism had never been off and every oracle was measuring something
> else. The same false sentence had been copied into both test-file headers; both
> are corrected.

What you must not do is
paste the number the implementation currently produces into an
`expect(...).toBe(...)`: that asserts the code agrees with itself and goes
green even when the schedule is wrong. If a case cannot be phrased as a
property or as a recomputation from an independent source, it does not belong
at this layer.

**"Independent source" has a sharp edge when the state is stored** (added by
the S-03 impl-review). Feeding the row you just read back through the app's own
mapper to build the expectation is _not_ an independent recomputation: whatever
the store fails to persist is dropped on both sides at once, and the oracle
agrees with the code on a wrong value. For a stateful transition, advance the
oracle **independently of the store** — chain it in memory across several
transitions and compare against what actually landed. §6.6's Phase 4 note
records the bug this rule was written from.

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
  is a different thing and not a template: it proves the _harness itself_
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
  `SUPABASE_URL` hostname, and a malformed value is read as _no session_
  with only a `console.warn` — drift would surface as a mysteriously
  logged-out test, not an error.

**Pages (`.astro`) are deliberately not rendered.** `callEndpoint` drives API
routes only (`routeType: "endpoint"`); there is no page-rendering helper and
you are not expected to write one. To cover a read surface that a page owns
(e.g. `/decks/[publicId]`), call the data-access functions its frontmatter
calls — `getDeckByPublicId`, `listFlashcards` — with an RLS-scoped client
from `clientFor`. Same database path, same RLS, same signal, without the
renderer. Know the limit this buys: an ownership check added _only_ in a
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

> **This list was incomplete; corrected 2026-07-26 (C10X-27) by reading the file.**
> Preflight closes **two more** seams, both of which `lessons.md` records as
> non-negotiable and neither of which was written here:
>
> - **The host must be local.** It hard-fails unless the `SUPABASE_URL` hostname is
>   `127.0.0.1` or `localhost`. "Key is anon" is *not* sufficient — a production
>   project's anon key is anon and its stack is reachable, so without this check the
>   documented "swap cloud creds in" workflow would have `npm test` signing up real
>   accounts and writing rows in **production**.
> - **`OPENROUTER_API_KEY` must be unset.** It hard-fails if the key is set, because the
>   suite asserts card counts that only mock generation guarantees — and because a set
>   key means paid calls with test text, plus a timeout inversion (`SERVER_TIMEOUT_MS`
>   40 s > `testTimeout` 30 s).
>
> Neither has an env opt-out, by design: a genuine non-local run must require a
> deliberate code edit. Securing one seam and documenting only that one is exactly how a
> reader concludes the rest are closed too.

### 6.5 Adding a test for the generation path

- **Location**: `tests/generation/` — the sibling folder §6.2 calls for when
  the concern is not ownership.
- **Naming**: `*.test.ts`, named after the resource, not the scenario
  (`generate.test.ts`). A new generation case goes in that file as another
  `it()`.
- **Reference**: `tests/generation/generate.test.ts`.
- **Run**: `npm test` (the local stack must be up — `npm run db:start`).
- **Check §6.6 first**, as §6.2 requires: the case you are about to add may
  already exist, and §6.6 is where its absence is visible.
- **Not here**: input-validation cases (bad `count`, over-length source
  text) belong to §6.3, still TBD — §3 Phase 2 owns risks #4 and #6 and has
  not landed the status-code and error-body contract yet. Do not infer it
  from §6.2's "404, never 403" rule: that rule is about ownership, not bad
  input.
- **Pattern**: identical to §6.4 — drive the real endpoint with a real
  session cookie against the real local Postgres, and read the result back
  with `clientFor(...)`. `callEndpoint` accepts a JSON string body and sets
  `Content-Type: application/json` for any non-`FormData` body.
  > **Corrected 2026-07-26 (C10X-27).** This bullet used to call `/api/generate` "the
  > project's only JSON endpoint". It was true when written and has not been since:
  > `/api/study` (S-03) and `/api/decks/[publicId]/cards/batch` (S-05) both parse a JSON
  > body and answer JSON — verified by enumeration, all three and only these three. The
  > distinction is no longer trivia, because the middleware guard now branches on whether
  > the caller wants JSON (§6.6 Phase 1): these three are exactly the paths that receive a
  > `401` instead of a redirect, while every other protected `/api/*` route is a native
  > form target and keeps its `302`.

Four project-specific facts that are not visible from the test file and
will cost you a wasted afternoon if you rediscover them the hard way:

- **No HTTP double is needed, and none exists.** `OPENROUTER_API_KEY` is
  unset locally and in `.github/workflows/ci.yml`, so `generateCandidates`
  short-circuits to `mockCards(count)` (`src/lib/openrouter.ts:149-158`)
  and returns instantly. The outbound seam is already neutralised; do not
  add a mocking library for it. The corollary is that no test in this suite
  exercises the real provider — a change to the prompt or the response
  contract is invisible here (that is §3 Phase 5's job).
- **Card content is not an oracle.** Mock output is identical on every call
  (`Przykładowe pytanie 1..N`), so grouping by `front` cannot tell a
  duplicated generation apart from the mock repeating itself. Use
  `generation_id`, which is unique per session.
- **`saved_count` is not an oracle.** The compensating update zeroes it
  (`failGenerationSession` in `src/lib/generations.ts`), so a
  duplicated-then-compensated run reads as `0` while its row still exists.
- **The real timeout window cannot be reproduced here.** `testTimeout` is
  30 s (`vitest.config.ts:33`), below `SERVER_TIMEOUT_MS` = 40 s
  (`generate.ts`) and the client's 55 s. Any test that tries to sit out
  the timeout fails on the runner, not on the behaviour. This is not a
  limitation to work around: since S-05 Phase 6 the dedup keys off the
  request's `idempotencyKey`, not off timing, so a sequential pair of
  requests exercises the whole guard and waiting adds cost without signal.
  The one thing that genuinely needs the window — the commit race that
  produces a `23505` on the session insert — is unreachable from here and is
  carried by code review plus the manual retry check instead.

**Scope every count twice** — by `source_text` and by the test's own deck.
The threat is _within_ a run, not across runs: `provisionAccounts` gives
every run fresh accounts carrying a per-run id, precisely so the suite never
inherits a previous run's rows without a `db:reset`
(`tests/fixtures/accounts.ts`). What that does **not** buy you is separation
between the `it()`s of one run — they all read as the same account A, so an
unscoped `count(*)` silently sums every case in the file (and every other
file touching the same table). Namespace with `Date.now().toString(36)` at
**file** level, as `decks.test.ts:22` does — that is a different id from
`provisionAccounts`' per-run one, and it is the file-level one your
`source_text` values must carry.

**The deliberate-breakage check, and why its shape changed.** §6.6's precedent
is "neuter the guard, confirm red". While this file asserted that _two_
sessions were written, that was impossible — the assertion would have been
satisfied by anything ≥ 1 — so the 2026-07-18 check ran **inverted**: a crude
dedup on `(user_id, source_text)` was introduced and turned the first `it()`
red (2 expected, 1 received), not on a 500 and not on a timeout, which is what
proved the assertion observed the _second_ write.

Since S-05 Phase 6 inverted the assertion for real, the ordinary shape applies
again: neuter the guard and confirm red. §6.6's Phase-2 entry records the run —
widening the partial unique index to every `status` turns exactly the
failed-key case red (`expected 500 to be 200`) while the other 12 stay green.
Neither production edit was ever committed.

### 6.6 Per-rollout-phase notes

(Filled in by each rollout phase's final sub-phase.)

- **Phase 1 (`verification-harness`, 2026-07-15)** — what Risk #1 coverage
  now means, precisely:

  | Surface    | Non-owner denied on write                                | Non-owner denied on read                |
  | ---------- | -------------------------------------------------------- | --------------------------------------- |
  | decks      | rename, delete (`decks.test.ts`)                         | `listDecks` (`decks.test.ts`)           |
  | flashcards | create, edit, delete, containment (`flashcards.test.ts`) | `listFlashcards` (`flashcards.test.ts`) |

  Read denial is asserted on the **data-access functions the pages call**,
  not on a rendered page (see §6.4 on why pages are not rendered). Every
  denial is paired with an owner-side re-read and a positive control.

  **Not covered by THIS phase — the signed-out path.** `callEndpoint` always
  injects `locals.user` (`tests/fixtures/endpoint.ts:82`), so nothing driven
  through it can exercise a request from a logged-out visitor. That left two
  things untested: the middleware guard (`PROTECTED_ROUTES` in
  `src/middleware.ts` is prefix-matched, so a future route nobody adds to the
  array is unprotected), and each endpoint's own `if (!context.locals.user)`
  branch. Out of scope by decision — Risk #1 is authorization, not
  authentication — and worth revisiting when Phase 4's SRS routes land.

  > **Correction (2026-07-26, C10X-27 audit). This paragraph was stale in BOTH
  > directions and used to say "the whole signed-out path".** It overstated the
  > gap: the **endpoint's own 401 branch is tested** for `/api/study`
  > ("returns 401 for a signed-out request") and `/api/generate`
  > ("401s a request with no session"). Both bypass `callEndpoint`
  > with a local helper that renders the endpoint with `locals: { user: null }`
  > (`studySignedOut` in `study.test.ts`) — so widening the fixture was never needed. The
  > `/api/study` case shipped in `f90f9e7` with the endpoint itself, was not in
  > the S-03 plan's Phase 5 bullets, and never reached this file. It also
  > understated the gap: nobody had named what the guard's _response shape_ does
  > to a fetch client — see the Phase 4 audit note on `StudySession.rate()`.
  >
  > What genuinely remains untested is narrower: the **middleware guard** and the
  > two `.astro` page loaders. The guard is correct and complete today (verified
  > by enumeration; note `/study` does **not** prefix-match `/api/study`, so that
  > separate array entry is load-bearing) and it is **cheap** to test — `onRequest`
  > is an ordinary exported function taking a fabricable context, so a
  > table-driven unit over `PROTECTED_ROUTES` needs neither a container nor a
  > database. The six redirect-style deck endpoints still have no signed-out
  > test at all.
  > (The audit said "seven"; re-counted 2026-07-26 it is **six**. There are seven endpoint
  > files under `src/pages/api/decks/`, but `cards/batch.ts` is a JSON endpoint, not a
  > form target — which is precisely the distinction the guard now turns on.)
  >
  > **Closed 2026-07-26 by C10X-27** — the middleware guard now has that table-driven
  > unit (`tests/middleware.test.ts`, 21 cases), and it turned out the guard was **not**
  > correct: it answered every signed-out caller with a redirect, including the three
  > JSON endpoints fetched by islands. It now answers **in the caller's own format**.
  >
  > The discriminator is the **caller, not the path**, and that distinction is the whole
  > design. Six protected `/api/*` routes are native `<form method="POST">` targets —
  > deck rename/delete, card create/edit/delete — i.e. full-page navigations. Answering
  > those with a JSON 401 would strand the submit on a dead-end JSON page with no way
  > back to sign-in, in exactly the expired-session scenario the change exists to fix.
  > So the guard reads `Sec-Fetch-Dest`, then `Content-Type`, then `Accept`: fetch
  > callers get a `401 application/json`, page and form navigations keep their `302` to
  > `/auth/signin`, and a **new JSON endpoint needs no registration anywhere**.
  >
  > The test drives the **real, imported** `PROTECTED_ROUTES` (the array gained an
  > `export`; its contents are unchanged), so adding a protected route adds a row and a
  > duplicated list cannot stay green while production drifts. It pins the prefix trap
  > explicitly — `/api/study` does not begin with `/study`, so that entry is
  > load-bearing — lets the public paths through, and carries a signed-in positive
  > control so a wholesale-broken guard cannot read as perfect protection. Two rows
  > exist purely to stop the form regression: the same deck path answers `302` for a
  > urlencoded form POST and `401` for a JSON one. The Container API is deliberately
  > **not** used — it mounts `NOOP_MIDDLEWARE_FN` and would never run this code
  > (`lessons.md`); `onRequest` is an ordinary function and a fabricated context is both
  > sufficient and faithful. Signed-out rows need no database: `getUser()` with no
  > session fails locally, with no network call.
  >
  > Still open after C10X-27: the two `.astro` page loaders, and the six
  > redirect-style deck endpoints have no signed-out test of their **own** (the guard
  > now covers them as a class, which is a different claim).

  Phase 1 also shipped one production fix: `deleteDeck` gained `RETURNING`,
  so a cross-account delete answers 404 instead of a redirect
  indistinguishable from success.

  **How the flashcard read test got written is the cautionary tale**: it did
  not exist until a contributor exercise (§6 read cold, plan unread) tried to
  add one and found the gap — the write suite passed happily while a
  neutered `flashcard_select` policy leaked A's cards to B. If you are
  tempted to trust a row in the table above, neuter the matching policy
  (`using (true)`) and confirm something goes red.

- **Phase 2, first slice (`ai-candidate-generation-test`, 2026-07-18; Risk #2
  closed by S-05 Phase 6, 2026-07-25)** — Risk #2 is **covered**.

  For its first seven days this entry read "measured, not protected":
  `tests/generation/generate.test.ts` asserted that two identical POSTs to
  `/api/generate` wrote **two** `succeeded` sessions, because idempotency was
  deferred by an explicit decision — finding F5 (ACCEPTED-AS-RULE) in
  `context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108`,
  owned by roadmap **S-05**. That slice's Phase 6 landed the dedup, the first
  `it()` went red exactly as this section predicted, and the instruction was
  followed to the letter: **the assertion was inverted (2 → 1), not deleted.**

  What covers the risk now:

  | Claim                                        | What proves it                                                                                                 |
  | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
  | A retry writes one session, not two          | two POSTs with the same `idempotencyKey` → one `succeeded` session, one `generation_id`, `COUNT` cards         |
  | …and the replay is usable, not just harmless | the second response carries the **same** `sessionPublicId`, `deckPublicId` and `counts` as the first           |
  | The dedup is keyed, not blanket              | two different keys → two sessions; the control the "one session" claim would otherwise be satisfied by falsely |
  | An old client still works                    | two POSTs with **no** key at all → two sessions (column nullable, request field optional)                      |
  | A failure does not kill the retry (FR-018)   | a `failed` session seeded for a key → the same key still generates and succeeds                                |

  **The key is per ATTEMPT, not per request.** `GeneratorForm` mints a
  `crypto.randomUUID()` on submit and stores it in `lastPayload`; "Ponów"
  replays that payload verbatim, so the retry carries the same key while a
  fresh submit mints a new one. Regenerating the same source text on purpose
  is not a duplicate and must keep working.

  **Two guards keep FR-018 alive, they are NOT independent, and only one of them is
  testable from the outside.** The partial unique index is scoped to
  `(user_id, idempotency_key) where idempotency_key is not null and status = 'succeeded'`,
  and both failure-path _inserts_ in `generate.ts` write the key as `null`. A `failed`
  audit row holding the key would make "Ponów" collide on its own insert and answer
  `500` — retry permanently dead after the first failure, the exact flow FR-018 exists
  for (plan-review F1). Note that the plan's own migration contract specified the index
  **without** the `status` predicate; that made the criterion "a key whose only prior
  session is `failed` still generates" unsatisfiable, and the predicate was added
  deliberately during S-05 Phase 6.

  **This entry used to say "either alone would do". That was wrong** (impl-review F3,
  2026-07-25). The two failure inserts are not the only route to a `failed` row:
  `failGenerationSession` — the compensating update after a failed _card_ insert — flips
  an already-inserted `succeeded` row to `failed` and **leaves its key in place**
  (`src/lib/generations.ts`, which sets only `status`, `saved_count`, `error_message`).
  A keyed `failed` row is therefore reachable in ordinary operation, and the index
  predicate is the only thing covering that path. Neither guard is redundant; do not
  drop the predicate on the strength of the NULL writes. The test that pins this
  ("still generates when the only prior session for that key is `failed`") seeds the row
  directly, which is why the production route to it was easy to miss.

  **The deliberate-breakage check, and it is a sharp one.** Widen the index by
  dropping `and status = 'succeeded'`, then run
  `npx vitest run tests/generation/generate.test.ts`. Exactly **1 of 13** goes
  red — the failed-key case, on `expected 500 to be 200` — while the other 12,
  including the dedup case itself, stay green. That split is what proves the
  failed-key assertion observes the index predicate rather than an incidental
  success. Two things are worth knowing before you run it:
  - The widened index may refuse to **build at all** against a database that
    already holds a suite run's rows (`Key (user_id, idempotency_key)=… is
duplicated`, the seeded `failed` row against its own `succeeded` result).
    That failure is itself evidence, but run the check from a `db reset` if you
    want the red test rather than the build error.
  - Restore with `npx supabase db reset` and then **verify it** — dump
    `indexdef` from `pg_indexes` before and after and `diff`. Done here; the
    restored definition came back identical, full suite green at **69/69** _as the
    suite stood on 2026-07-26 before C10X-27_ (it is 109/109 now). The `1 of 13` split
    above is still current — `generate.test.ts` holds 13 cases, re-counted 2026-07-26.

  One case in the file still looks like protection and is not: two identical
  `newDeckName` requests produce a 409 and exactly one session. That comes from
  `deck_user_name_unique`, not from any dedup, so it is kept deliberately
  **key-less** — a test written only against `newDeckName` would read green
  while proving nothing about the idempotency above.

  **What is NOT covered.** The dedup lookup runs before the LLM call and a
  `23505` on the session insert maps to the same replay, which together cover
  the sequential retry and the commit race. Two **concurrent** `newDeckName`
  requests still race at `createDeck`, and the loser 409s because the winner's
  session may not have committed yet — pre-existing, unchanged, and out of the
  flow a human performs. No test here reaches the real provider, for the reason
  §6.5 records.

  Phase 2 stays `implementing`: risks #4 (leakage in the error body) and #6
  (server-side validation parity) are untouched.

- **Phase 4 (`srs-study-session`, 2026-07-24; audited 2026-07-26; closed by C10X-27
  the same day)** — Risk #3 is **covered, both halves**. "The schedule writes the wrong
  next-review date" was covered by S-03; "**the study session loses a card**" is covered
  as of C10X-27. Re-verified by execution: suite **109/109, 11 files**, `tests/study`
  30/30. Precisely what that means:

  | Claim from Risk #3                                             | What proves it                                                                                                                                                                     |
  | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Deferral follows the rating                                    | `schedule.test.ts` ordering property (no DB) + `study.test.ts` Easy-vs-Hard `due` persisted through the endpoint                                                                   |
  | The written schedule is the right one, at the FIRST review     | `study.test.ts` exact-due oracle: `due`/`stability`/`difficulty`/`srs_state`/`reps`/`lapses`/`scheduled_days` vs a direct `scheduler.next`                                         |
  | …and at every review after it                                  | `study.test.ts` "stays faithful across consecutive reviews": three chained ratings vs an oracle Card advanced only in memory (added by impl-review F2)                             |
  | The written schedule survives a re-read                        | re-read on a brand-new client, column-for-column, asserted still rated (not silently reset to New). This is read-after-write, **not** a restart — same process, milliseconds apart |
  | …and the card comes BACK when it falls due ("no card is lost") | `study.test.ts` "returns the card at its persisted due and withholds it a minute after the rating" — rated at a fixed `now`, then `listDueCards` at `now + 1 min` (absent) and at the persisted `due` (present, `reps` advanced). **Added by C10X-27**                     |
  | A retry does not advance the schedule                          | two identical POSTs → `reps` 0→1 (not 2), second answers `200 { alreadyApplied: true }`, row byte-identical                                                                        |
  | Only accepted cards enter                                      | a `generated` and a `rejected` sibling never come back from `listDueCards`; rating one is a 404 that writes no schedule row                                                        |
  | No cross-account write (extends Risk #1)                       | B rating A's card → 404 and A's row unchanged column-for-column, with A's own successful rate as the positive control                                                              |
  | The batch is bounded by the deck's OWN cap                     | `study.test.ts` cap case: `session_size` set through the endpoint, read back via `getStudyDeck`, and passed to `listDueCards` — never a literal — with 5 due cards against a cap of 3. **Added by C10X-27**                                                              |
  | …and that cap is itself bounded                                | endpoint Zod (`0`, `-1`, `101`, `2.5` → 400, value unchanged on re-read) **and** the DB CHECK `deck_session_size_check` (`23514`, by name), with an in-range positive control. The island's own `SIZE_MIN`/`SIZE_MAX` mirror is NOT covered — see §7. **Added by C10X-27** |
  | Every grade writes what ts-fsrs computes, not just `Good`      | four fresh cards, one per grade, each column-for-column against an oracle from `createEmptyCard` advanced only in memory; plus the lapse case (`Again` from `Review`: `lapses` 0→1, `due`/`stability` strictly below `Good`'s at the same `now`). **Added by C10X-27**    |
  | The batch's composition is deterministic                       | **PARTIAL — read the caveat.** `toEqual` on the batch members pins their ORDER, but not the presence of the `f.id asc` tie-break: removing the clause leaves the suite green (see the breakage runs below)                                                               |

  **What the single-transition oracle does NOT prove, and why there are now two
  rows for it** (added by impl-review F2, 2026-07-24). The exact-due oracle
  recomputes its expectation from the row it just read back — i.e. _through_
  `scheduleRowToCard`, the app's own mapper. Any `ts-fsrs` `Card` field the
  schedule table fails to persist is therefore dropped on both sides at once, so
  the oracle and the code agree on a wrong value and the assertion passes. That
  is §2's "assertion copied from the implementation" wearing the costume of a
  property test, and it was not hypothetical: it let a card rated Good sit in
  `Learning` at a +10 min interval **forever** (the `Card.learning_steps` cursor
  was never persisted) while the suite stayed green at 45/45.

  The rule that follows: **an oracle for a stateful transition must be advanced
  independently of the store under test.** "Stays faithful across consecutive
  reviews" does that — it chains three ratings against a `Card` built by
  `createEmptyCard` and advanced purely in memory, never round-tripping Postgres
  and never passing through the mapper, so a missing column surfaces as a
  divergence from review 2 onward instead of cancelling out. A seeded row's `due`
  does not feed the New → first transition, which is what makes `createEmptyCard`
  a faithful starting point.

  **The third deliberate-breakage check, for that case**: remove
  `enable_short_term: false` from the `generatorParameters(...)` at
  `src/lib/study.ts` (which restores the unpersisted-cursor bug) and run
  `npx vitest run tests/study/`. **Re-run 2026-07-26 (C10X-27): 2 of 30 red**, up
  from the single red first recorded. The chained case's `due` at review 2 fails on
  the same value pair as ever (`expected 1780316400000 to be 1780488600000`), and
  C10X-27's lapse case now fails too — on its **precondition**
  (`expect(settled?.srs_state).toBe(State.Review)` → `expected 1 to be 2`): with
  short-term steps on, three `Good` ratings leave the card in `Learning` instead of
  graduating it, which is the S-03 impl-review F1 bug seen from the user's side rather
  than the oracle's. **The `srs_state = 3` canary does NOT fire** under this flip — the
  card never reaches `Review`, so `Again`-from-`Review` never happens; the canary guards
  against a silently different schedule, it is not a detector for this flag. Restoring
  the flag restored green (109/109 full suite).

  **The deliberate-breakage check**: `study_due_cards` was replaced in the
  running local DB with a copy missing its `and f.state_id = 2` predicate
  (`create or replace`, no `db:reset`, so dev data survived). **Re-run 2026-07-26
  (C10X-27): exactly 1 of 22 red** — `expected [ …(3) ] to not include
  '<generated card>'` in "never returns a generated or rejected card from a session
  build" — which is what proves that assertion observes the real gate rather than an
  incidental empty batch. (The split is unchanged since 2026-07-24; only the
  denominator moved, 14 → 22.) Restore: `pg_get_functiondef` dumped before and after,
  **diff identical**; the ACL re-verified byte-identical to the untouched
  `search_flashcards_in_deck`.

  **The second deliberate-breakage check, for the cross-account path — READ THIS
  BEFORE RELYING ON IT: it has silently stopped working.** It neuters all four
  guarding policies **at once** (`deck_select`, `flashcard_select`,
  `flashcard_schedule_select`, `flashcard_schedule_update`), because a single-policy
  neuter stops at the next policy down and still answers 404.

  When first run (2026-07-24) it produced two clean reds: B's rate returned `200`
  instead of `404`, and `listDueCounts` returned A's deck to B
  (`expected 1 to be undefined`). **Re-run 2026-07-26 (C10X-27) it produces 3 of 22
  red, and only ONE of the three is evidence:**

  | Red case | Verdict |
  | --- | --- |
  | `returns 404 when B rates a card in A's deck` (`expected 200 to be 404`) | **Evidence.** B genuinely rated A's card. |
  | `stops counting a card once its schedule is rated into the future` (`expected undefined to be 1`) | Knock-on. |
  | `never exposes another account's deck` — the **positive control** (`expected undefined to be 1`) | Knock-on. |

  And the assertion that should have gone red **did not**: `never exposes another
  account's deck` asserts `foreign.data?.[deckPublicId]` is `undefined`, and it
  **passed while the guard was completely disabled**. A false pass.

  The cause was traced, not guessed. `study_due_counts` carries no user predicate and
  no `LIMIT` — RLS is its only scoping — so with `deck_select using (true)` it returns
  **every** deck in the database. The local dev DB now holds **1053** decks while
  `supabase/config.toml` sets `max_rows = 1000`, so PostgREST truncates and the
  freshly-created deck (A's own as well as the one B must not see) falls outside the
  window; both sides then read `undefined`. That the policy really was wide open was
  confirmed independently at the SQL layer under the role-plus-JWT-claims pattern: as
  one user, `select count(*) from deck where user_id = <other user>` returned **4**.

  **What follows for whoever runs this next.** Re-run it from a `db:reset` (or with
  `max_rows` raised) or it proves nothing about `listDueCounts`; until then the
  cross-account claim on that surface rests on the rate-path 404 alone. This is a
  subtler failure than a stale count: an assertion that has become **unfalsifiable
  because of the environment it runs in**, while still reading green. It generalises —
  any denial asserted as "absent from an unbounded, unordered result set" is vulnerable
  to the same row cap as the dev database grows.

  Restore by `alter policy` and then **verify it**, do not assume it: dump
  `qual`/`with_check` from `pg_policies` before the neuter, dump again after
  the restore, and `diff` the two. Done on both runs; identical both times, full suite
  green (109/109 on the re-run). Restoring RLS from memory is how a suite
  quietly stops testing anything.

  **Four more breakage runs, added by C10X-27 (2026-07-26)** for the assertions that
  slice added. Full detail, including the observed failure strings, is in
  `context/changes/srs-study-session-test/verification.md`:

  | Neuter | Result |
  | --- | --- |
  | `limit p_limit` dropped from `study_due_cards` | **1 of 22 red** — the cap case, `to have a length of 3 but got 5` |
  | `f.id asc` tie-break **removed** | **0 of 22 red — the suite stays fully GREEN** |
  | `f.id asc` tie-break **reversed** to `f.id desc` | **1 of 22 red** — same case, on `toEqual` |
  | `coalesce(s.due, p_now) <= p_now` dropped | **1 of 22 red** — the due re-entry case, on its **negative** half (`to not include`) |
  | endpoint Zod `min(1).max(SIZE_MAX)` → `z.number()` | **1 of 22 red** — bounds case, `expected 500 to be 400` (the 500 shows the DB CHECK caught what Zod let through, i.e. the layers are genuinely independent) |
  | `deck_session_size_check` dropped | **1 of 22 red** — same case, `expected undefined to be '23514'` |

  **The tie-break rows are the important pair, and the honest reading is
  uncomfortable**: the composition assertion observes the batch's ORDER, not the
  presence of the tie-break. With the clause gone every sort key collapses to `p_now`
  and the order is formally unspecified, but at this data volume the planner returns
  insertion order anyway. So the assertion would catch a change that reorders the
  batch and would **not** catch someone deleting the `f.id asc` that migration
  `20260724220524` exists to provide. Making that catchable needs a data volume or plan
  shape where the planner actually diverges, and nothing here creates one. Named as an
  open gap rather than papered over.

  > **A constraint neuter is not symmetric with a function neuter.** Re-adding
  > `deck_session_size_check` **failed** — `violated by some row` — because the breakage
  > run itself had persisted an out-of-range `session_size` while the constraint was
  > absent (one row, the run's own `harness-a-*` fixture deck; repaired to the column
  > default `20`, then the constraint re-added cleanly and the definition `diff` came
  > back identical). `create or replace function` leaves no residue; dropping a CHECK
  > lets the suite write data the constraint forbids, so the restore can fail *after*
  > the evidence is collected. Inspect the violating rows before repairing, and never
  > assume the `add constraint` succeeded — the `diff` is what caught it.

  **Selective mutation testing on `rateCard` (C10X-27).** First time the study path was
  mutated: `npx stryker run --mutate "src/lib/study.ts:291-350"` (permanent `mutate`
  list untouched) → **56.90% total / 71.74% covered — 33 killed, 13 survived, 12 no
  coverage**. **No assertion was added**; every survivor is classified individually in
  `context/changes/srs-study-session-test/mutation-register.md`. Two results worth
  carrying:
  - **The span had to be re-derived.** The plan recorded `257-316`; Phase 3's edits
    above `rateCard` pushed it to `291-350`. A stale range completes happily while
    mutating a different function.
  - **A surviving `""` string mutant is not automatically a coverage gap, and this
    inverts S-05's precedent.** Three survivors mutate `.select("…")` → `.select("")`.
    Reproduced by hand (22/22 still green) and then explained by probing PostgREST
    directly: an empty `select=` is read as `select=*`, a strict **superset** — not the
    malformed query that killed S-05's `.in("state_id", "")` on `PGRST100`. Check the
    query semantics before classifying a mutant in either direction.
  - The remaining survivors and **all twelve** uncovered mutants sit in `rateCard`'s
    four `if (…Error)` branches and their return payloads. Its query **predicates** are
    well asserted (**27 of 33** kills are behavioural, 6 merely structural — classified
    by script, not by eye); its **failure handling** is not asserted at all and cannot be
    without a fault-injection seam §6.4 deliberately does not provide.

  **Known cosmetic gap, not a leak**: the migration's
  `revoke all on function … from anon` does not remove `PUBLIC`'s default
  `EXECUTE`, so `has_function_privilege('anon', …)` is `true` for both study
  RPCs. Both are `security invoker`, so an anon caller still gets zero rows
  under RLS. This matches the untouched `search_flashcards_in_deck`
  precedent — it is a project-wide pattern, not something S-03 introduced.
  Refined by the 2026-07-26 audit: an anon call actually fails with _permission
  denied for table flashcard_ (`init_core_schema` revokes it) rather than returning
  zero rows under RLS. Safe either way, still untested.

  **Audit note (2026-07-26, C10X-27 / roadmap H-02).** A full audit re-verified this
  entry against the code and by execution. **C10X-27 then shipped the same day and
  closed most of what it found** — each item below is marked CLOSED or OPEN, and the
  counts above have been replaced with runs executed against the current files.

  > Every `file:line` in this note points at the tree **as it stood at the audit**, before
  > the fixes below landed; the fixes moved most of those lines. Read them as a record of
  > what was found, not as navigation. Cited symbol names are still accurate.
  - **CLOSED.** **Every deliberate-breakage count in this entry is stale.** They read "the other
    14 cases stay green" (15 total) and "the other 13 cases stayed green" (14 total),
    but `tests/study/study.test.ts` now holds **16** `it()`s — `e9b8cd9` added two
    _after_ this note was written (the chained-oracle case and the
    accepted-then-un-accepted case). The `45/45` / `46/46` full-suite figures are
    superseded twice over: 66/66 after S-05, **69/69** today. **No recorded
    deliberate-breakage run has been executed against the current file.** Re-run
    them before citing them.
    → Every check above was re-run on 2026-07-26 against the current files (22 cases in
    `study.test.ts`, 109/109 full suite) and its count replaced. One re-run changed its
    meaning entirely — see the four-policy check.
  - **CLOSED.** **`session_size` → `p_limit` is the biggest untested wire on this surface.**
    `src/pages/study/[publicId].astro:37` caps the batch with `deck.session_size`,
    but every test call passes the literal `20` (`study.test.ts:104`, `:531-536`;
    `candidates.test.ts:626`) and no test creates more due cards than the limit. A
    regression to a hardcoded value, to the RPC's own `default 20`, or to dropping
    `p_limit` would be invisible, while `study.test.ts:601-618` (the setter) kept
    passing. The setter is proven; the reader is not. Its bounds are untested at all
    three layers (client mirror, endpoint Zod, DB CHECK `between 1 and 100`).
    → The reader is now covered (`deck.session_size` read via `getStudyDeck` and passed
    to `listDueCards`, 5 due cards against a cap of 3), and two of the three bound layers
    with it. The **client mirror stays uncovered** — no layer here reaches an island's
    JSX (§7) — and it was checked by hand instead: entering `101` renders "Rozmiar sesji
    musi być liczbą od 1 do 100." and sends no request. Do not read the suite as proving
    the bound end to end.
  - **PARTLY CLOSED — read the caveat.** **The RPC's `order by … , f.id asc` tie-break
    and `limit p_limit` have no assertion.** Every test checks membership with
    `find`/`toContain`, never order — even though M2 added the tie-break precisely so
    batch composition would stop being planner-dependent.
    → `limit p_limit` is closed. The **tie-break is not**: the new `toEqual` on the batch
    members pins the order, and removing `f.id asc` leaves the suite green (breakage run
    above). Order is asserted; the clause that guarantees it is not.
  - **CLOSED, and the claim in this bullet was itself FALSE.** **Only `Rating.Good` ever
    reaches the database.** Easy and Hard appear once each, in the ordering case
    (`:507`, `:512`); **`Rating.Again` never takes the write path at all**, so `lapses`
    and the ~~Review → Relearning~~ transition are unproven on persistence — that is the
    "hard card resurfaces sooner" half of US-02.
    → All four grades now take the write path, each column-for-column against an
    in-memory oracle, plus a lapse case asserting `lapses` 0→1 and a `due`/`stability`
    strictly below `Good`'s at the same `now`.
    **But "Review → Relearning" is wrong and must not be repeated.** With
    `enable_short_term: false` ts-fsrs runs `LongTermScheduler`, whose `next_state` sends
    **every** grade — `Again` included — to `State.Review`
    (`node_modules/ts-fsrs/dist/index.cjs:1271`). `State.Relearning` is assigned at
    exactly one site, `BasicScheduler.reviewState` (`:1102`), which this configuration
    never instantiates. So `srs_state` can only ever be `0` or `2`; `lapses += 1` on
    `Again` is real (`:1237`). Confirmed by execution, not by reading: the lapse case
    asserts `State.Review` and passes — asserting `Relearning`, as this bullet and §6.7
    both described, would have failed. A one-line **canary** now pins it: no row this
    suite writes ever carries `srs_state = 3`.
  - **CLOSED.** **A production bug on this path was found that no document had named**, and it is
    a Risk #3 failure in the user's terms: `StudySession.rate()`
    (`src/components/study/StudySession.tsx:174`) checks only `!res.ok`, while
    middleware answers a signed-out `POST /api/study` with a **302 to an HTML page**
    that `fetch` follows to a `200`. The card advances, the counter climbs, and no
    rating is written. The endpoint's own correct 401 (`src/pages/api/study.ts:52-55`)
    is therefore unreachable in production, as are `/api/generate`'s and
    `cards/batch`'s. Carried by C10X-27.
    → Fixed on both sides. The middleware now answers a JSON caller with a real `401`
    (§6.6 Phase 1's note carries the design and its table), so those three endpoints'
    own 401 branches are reachable in production for the first time. And the client
    decision moved out of the island into `src/lib/http.ts`'s `readJsonResponse` —
    parse before `ok`, with a followed redirect and a non-JSON body as failures in their
    own right — where it has seven tests including the defect's exact shape, a
    `200 text/html`. Confirmed live: the same signed-out `POST /api/study` that used to
    answer `status=200 ok=true content-type=text/html` now answers
    `401 application/json`, the UI shows "Twoja sesja wygasła", and the row is provably
    untouched (`reps` 0, `srs_state` 0, `last_review` null).
  - **CLOSED as hygiene — and the class was misdiagnosed here.** Also recorded,
    deliberately not fixed there: `scheduled_days` is written
    (`src/lib/study.ts:97`) and never read back (`:284` omits it; `DueCardRow` has no
    field), so it is ~~the same un-round-tripped class as impl-review F1's
    `learning_steps` bug~~ — inert today **only** because `enable_short_term: false`
    makes `LongTermScheduler` zero it on input.
    → It now round-trips on the `rateCard` path (`DueCardRow` gained it as an optional
    nullable field; `scheduleRowToCard` prefers the persisted value). **It is NOT the
    `learning_steps` class**, and recording it as such would be a second false statement.
    `learning_steps` was a genuine scheduler *input* — a cursor the scheduler read, so
    losing it changed the transition. `scheduled_days` is **output-only** in ts-fsrs
    5.4.1 under **either** config: `LongTermScheduler` zeroes it (`index.cjs:1183`),
    `BasicScheduler` overwrites it (`:1023`, `:1041`, `:1048`), and the single read is
    `buildLog` (`:424`), whose review_log this app never persists. So the round-trip is
    behaviour-neutral for a stronger reason than "the config removes it from the
    calculation" — nothing reads it at all — and it closes **no risk class**. It is
    hygiene on the value FR-016 will want. The exact-`due` oracles were the neutrality
    check and stayed green. Two things stay outside it on purpose: `elapsed_days` has no
    column, and the RPC does not project `scheduled_days` (widening its `returns table`
    needs a `drop function` migration), so a session's **preview** intervals are still
    computed from `0` while `rateCard` uses the persisted value — harmless precisely
    because the column is output-only, and recorded so a future reader who makes it an
    input sees the divergence immediately.

  Full evidence: `context/changes/srs-study-session-test/research.md` for the audit that
  opened these items, and `verification.md` + `mutation-register.md` in the same folder
  for the runs that closed them.

- **Roadmap slice S-05 (`candidate-review`, 2026-07-25)** — not a §3 rollout phase.
  It is recorded here because it widened **Risk #1's surface**: the project's first
  lifecycle state transition (`setFlashcardState`) and its first **multi-row**
  mutation (`POST /api/decks/[publicId]/cards/batch`). Every Phase-1 denial covers a
  single-row write addressed by one `public_id`, so none of them touches this path —
  a bulk UPDATE that forgot its deck scoping would have leaked while the Phase-1
  table stayed green.

  Extends the Phase 1 table by one row:

  | Surface    | Non-owner denied on write                                                                  | Non-owner denied on read |
  | ---------- | ------------------------------------------------------------------------------------------ | ------------------------ |
  | flashcards | **state transition, single and bulk, via `/cards/batch`** (`isolation/flashcards.test.ts`) | unchanged                |

  What the slice's own file (`tests/review/candidates.test.ts`) proves:

  | Claim                                               | What proves it                                                                                             |
  | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
  | Every legal edge of the transition table writes     | all four `(from,to)` pairs asserted on `RETURNING` **and** on the row re-read                              |
  | Every illegal edge writes nothing                   | anything → `generated`, and a repeat of an applied move: empty `RETURNING`, row `toEqual(before)`          |
  | A mixed batch writes only its legal subset          | one movable + one already-in-target card; `changed`/`skipped` split, sibling row byte-identical            |
  | A zero-row write is a 200, not an error             | the endpoint's `{ ok, changed, skipped }` contract, with `skipped` = requested minus returned              |
  | Route precedence cannot become a wrong write        | `batch` fails `UUID_RE` in `[cardPublicId].ts` → 404, never an edit                                        |
  | A transition moves the card through the study gate  | accepted → enters `listDueCards`; rejected → gone even at a far-future clock; Przywróć resumes at `reps` 1 |
  | Search stays accepted-only, and carries `source_id` | one token, three cards, one per state — only the accepted one matches                                      |
  | A transition is not a content edit                  | `updated_at === created_at` after a state write, while a real edit still bumps it                          |

  **What it does NOT prove.** The edit round-trip cases assert the `Location` header
  only — no test renders `review.astro`, so the review screen's own loader, its empty
  states and the acceptance-metric line are covered by manual verification alone
  (§6.4's "pages are deliberately not rendered" applies unchanged). The `?generation=`
  scope is proved at the data layer (`listFlashcardsByState`), not through the page.
  Nothing here exercises the signed-out path, for the same reason Phase 1 records.

  **Selective mutation testing, and why its 100% is weak evidence.** Stryker narrowed
  to the transition function (`--mutate "src/lib/flashcards.ts:181-212"`, permanent
  `mutate` list untouched): 100% — 12 killed, **0 survived**. Do not read that as "the
  gate is well asserted". Reproducing the two gate mutants by hand shows both die on a
  **malformed query**, not on a behavioural assertion: `.in("state_id", …)` → `""`
  fails with `PGRST100`, and the `?? []` fallback → `["Stryker was here"]` fails with
  `22P02` (integer parse). Only **4 of 12** are behavioural — the ones that collapse the
  allow-list to `[]` while leaving the query valid — and all four break _legal_
  transitions. **No mutant in this run makes an illegal transition succeed**, because
  the operator that would has to substitute a string that Postgres rejects. So the
  direction that actually harms a user (a gate too permissive — a rejected card
  drifting back into the deck) is carried by deliberate-breakage check 1 below, not by
  Stryker. Per-mutant record: `context/changes/candidate-review/mutation-register.md`.

  **Three deliberate-breakage checks, all run, with observed results.**
  1. _The transition guard._ Delete `.in("state_id", ALLOWED_FROM[target])` from
     `setFlashcardState`. Exactly **3 of 16** red in `candidates.test.ts` — the
     off-graph case (`expected [ {…} ] to deeply equal []`), the mixed batch
     (2 returned instead of 1), and the endpoint's `changed`/`skipped` split. The
     other 13 stayed green, including every legal-edge assertion, which is what
     proves those three observe the gate rather than an incidental empty result.
     Reverting restored 16/16.

  2. _Cross-account denial._ This one needs **three** policies neutered, not the two
     the plan anticipated. With `deck_select` + `flashcard_update` set to
     `using (true)`, the new batch denial does go red — but only on its **status**
     (`expected 200 to be 404`, i.e. B resolved A's deck). The write half stayed
     invisible: Postgres also applies the **SELECT** policy to an UPDATE whose WHERE
     reads columns, so `flashcard_select` still hid the row and nothing landed
     (verified — zero rows matching B's intended content). Adding
     `flashcard_select using (true)` took it to **6 of 9** red, including B genuinely
     rewriting A's card (`expected 'Edited by B …' to be "A's front …"`). Note that
     the positive control went red as a **knock-on**, not as an independent signal:
     B's transition had already moved the card, so A's own accept→reject then matched
     zero rows. This is the same "stops at the next policy down" trap §6.6 records for
     S-03, one layer deeper — the next contributor should start from all three.

  3. _The trigger narrowing._ Restore the unqualified
     `before update on flashcard` moddatetime trigger. Exactly **1 of 25** red across
     both files — the `updated_at` assertion
     (`expected '…844183+00:00' to be '…839253+00:00'`) — and nothing else. A
     migration whose only effect is a _non_-event has no other witness.

  **Restores were verified, not assumed — and the verification earned its keep.** The
  first policy restore silently no-opped: the heredoc was piped to `docker exec`
  **without `-i`**, so psql never received it and reported nothing. Only the
  `pg_policies` before/after `diff` caught it; a "restored from memory, looks fine"
  pass would have left the suite testing nothing. Second attempt with `-i`: diff
  identical. The trigger was likewise re-dumped with `pg_get_triggerdef` and matched
  byte-for-byte. Full suite green afterwards: **66/66**.

### 6.7 Adding a test for the SRS / study path

(Added by §3 Phase 4. It sits after §6.6 so the existing §6.6 references in
`tests/study/study.test.ts`, `tests/generation/generate.test.ts` and §6.2/§6.5
keep pointing at the per-phase notes.)

- **Location**: `tests/study/` — the sibling folder §6.2 calls for when the
  concern is not ownership. Two files, split by cost, not by feature:
  `schedule.test.ts` (pure, no DB) and `study.test.ts` (real endpoint, real
  Postgres).
- **Naming**: `*.test.ts`, named after the resource. A new case goes into the
  matching file as another `it()`.
- **Reference**: `tests/study/schedule.test.ts` for the oracle-property shape
  (§6.1), `tests/study/study.test.ts` for anything that must persist.
- **Run**: `npm test`, or one file with
  `npx vitest run tests/study/study.test.ts`. The local stack must be up
  (`npm run db:start`) — preflight aborts the run otherwise, even for the
  pure file.
- **Check §6.6 first**, as §6.2 requires: the Phase 4 table there tabulates
  what each Risk #3 claim already rests on.
- **Pattern**: identical to §6.4 — drive the real endpoint with a real session
  cookie against the real local Postgres, read back with `clientFor(...)`,
  row-based assertions paired with a positive control, **404 never 403**, and
  a file-level `Date.now().toString(36)` namespace (§6.5).

Five project-specific facts that are invisible from the test file and will
cost you an afternoon if you rediscover them the hard way:

- **`now` is a lib parameter, never an HTTP input — and that is the only seam
  where an exact `due` can be pinned.** `rateCard` takes it as a trailing
  argument defaulting to `new Date()`; `/api/study` calls it without one,
  deliberately, because a client-supplied clock would let a client steer its
  own schedule. So: assert an **exact** `due` by
  calling `rateCard` directly with `clientFor(a.cookieHeader)` and a fixed
  `now`; over HTTP you can only assert **relative** properties (Easy later
  than Hard, `reps` advanced by one). Do not try to reach the fixed clock
  through the endpoint — there is no route, and adding one would be a
  security regression, not a testability win.
- **A schedule row does not exist until a session loads the card.** Manual
  create writes the card `accepted`, but `flashcard_schedule` is seeded by
  `ensureSchedule`, which runs inside `listDueCards`. Rate a freshly created
  card without loading a session first and you get a 404 that looks like an
  ownership failure and is not. `study.test.ts`'s `loadSession` helper does
  exactly what the real `/study/[publicId]` loader does; go through it.
- **`expectedReps` is an optimistic-lock version, not a payload field.** It
  must be the `reps` the session served. Pass a stale one and the
  compare-and-set matches zero rows, so the endpoint answers a benign
  `200 { alreadyApplied: true }` — no transition. A test that hard-codes `0`
  and expects a schedule change will fail on its **second** run against the
  same card, not its first.
- **Two axes are called "state" and they are not the same.**
  `flashcard.state_id` is the lifecycle (1 generated / 2 accepted /
  3 rejected) and owns the "only accepted cards enter" gate;
  `flashcard_schedule.srs_state` is FSRS's (0 New / 1 Learning / 2 Review /
  3 Relearning) and owns scheduling. Asserting the wrong column proves
  nothing while reading as a passing test.
- **No endpoint creates a non-accepted card.** Manual create always writes
  `accepted` and `/api/generate` would drag the whole generation path in, so
  the accepted-only gate needs a direct RLS-scoped insert
  (`createNonAcceptedCard` in `study.test.ts`). That seam is deliberate and
  stays RLS-scoped — it is a shortcut around the _UI_, not around the lock.

Three more, added by the 2026-07-26 audit and **closed by C10X-27 the same day**. They
stay here as rules, not as gaps — each now names the case that pins it, so a new test
can be modelled on one instead of re-deriving the trap:

- **Never pass a literal batch limit again.** Every call used to be
  `listDueCards(client, deckId, <date>, 20)` — a literal, never the deck's own
  `session_size`, which is what production uses
  (`src/pages/study/[publicId].astro`). Copying that call shape is how the wire
  stayed unobserved. A new case must set `session_size` on the deck and let the
  value reach `p_limit`, with more due cards than the cap, or it proves nothing
  about bounding. **Model it on** "caps the batch at the deck's cap and composes it
  deterministically": the cap is set through the real endpoint, read back with
  `getStudyDeck`, and handed to `listDueCards` — 5 due cards, cap 3.
- **`new Date()` is the wrong clock for a durability claim.** `now` is a lib
  parameter on `listDueCards`/`rateCard`, so a re-entry test rates at `T`, then
  calls `listDueCards` at `T + interval` and asserts the card comes back — and at
  `T + 1 min` asserts it does not. Passing `new Date()` can only ever prove
  read-after-write, which is why "no card is lost" went unproven under a table that
  said otherwise. **Model it on** "returns the card at its persisted due and withholds
  it a minute after the rating", and write the **negative** half first — that is the
  half a `due <= p_now` predicate that was always true would fail, and the positive
  half alone would not.
- **`Rating.Good` is not a representative grade.** It was for a long time the only
  grade that took the write path. `Rating.Again` drives a _different_ transition —
  `lapses + 1` — and a lapse bug would have been invisible. When adding a grade case,
  assert `lapses` and `srs_state` against an oracle advanced in memory (§6.1's rule),
  never against the row. **Model it on** the four-grade matrix and the lapse case.

  > **Correction (C10X-27).** This bullet used to say `Again` drives "Review →
  > Relearning". **It does not, in this app.** `enable_short_term: false` means ts-fsrs
  > runs `LongTermScheduler`, whose `next_state` sends every grade — `Again` included —
  > to `State.Review` (`index.cjs:1271`). `State.Relearning` is assigned at exactly one
  > site, `BasicScheduler.reviewState` (`:1102`), which this configuration never
  > instantiates, so `srs_state` can only be `0` or `2`. `lapses += 1` on `Again` is
  > real (`:1237`). A test asserting the Relearning transition would fail — confirmed by
  > execution, which is how this was caught. The user-facing claim is still observable,
  > just on different columns: assert that `Again`'s persisted `due` and `stability` are
  > strictly **below** what `Good` yields for the same card at the same `now`. §6.8
  > repeats the two-axes warning and is unaffected; only the transition target was wrong.
  > A one-line canary now pins the invariant: **no row this suite writes ever carries
  > `srs_state = 3`.** If it fires, `enable_short_term` was flipped and every exact-`due`
  > oracle in the file is suspect. Note it is a canary, not a detector for that flag —
  > under the flip the card never reaches `Review`, so it stays green while two other
  > cases go red (§6.6).

**The deliberate-breakage check for this path** runs against the live local DB
(`docker exec … psql`), not through a `db:reset` — the behaviour under test
lives in SQL, and a reset would wipe the dev data a reviewer is likely
mid-way through using. Two variants, depending on which claim you are
checking:

- **The accepted-only gate**: `create or replace` `study_due_cards` without
  its `and f.state_id = 2` predicate; exactly the gate assertion should go
  red. Restore by re-applying the migration's definition.
- **Cross-account denial**: neuter all four guarding policies at once
  (`deck_select`, `flashcard_select`, `flashcard_schedule_select`,
  `flashcard_schedule_update`) with `using (true)`. Neutering one is not
  enough — the request stops at the next policy down and still answers 404,
  so the test stays green and you learn nothing.

  > **This variant no longer works on a grown dev database (C10X-27, 2026-07-26).**
  > `study_due_counts` has no user predicate and no `LIMIT`, so with `deck_select`
  > wide open it returns every deck in the database; once that exceeds
  > `max_rows` (1000, `supabase/config.toml`) PostgREST truncates and the deck under
  > test falls outside the window. The `listDueCounts` denial then **passes while the
  > guard is fully disabled**, and its positive control fails as a knock-on. Run this
  > variant from a `db:reset`, or read only the rate-path 404 as evidence. §6.6 records
  > the full trace. The general form is worth remembering: **a denial asserted as
  > "absent from an unbounded result set" decays into a false pass as the dataset
  > grows.**

Whichever you run, **verify the restore rather than trusting it**: dump
`qual`/`with_check` (or `\sf` for a function) before and after, and `diff`.
An RLS policy restored from memory is how a suite silently stops testing
anything. §6.6 records the observed results of both.

**And note which objects are safe to neuter.** `create or replace function` leaves no
residue, so a function neuter always restores. **A dropped CHECK constraint does not**:
the suite goes on to persist data the constraint forbids, so `add constraint` fails
*after* the evidence is collected (`violated by some row`). C10X-27 hit exactly that on
`deck_session_size_check`. Inspect the offending rows, repair them, then re-add — and let
the `diff` confirm it, never your memory.

### 6.8 Adding a test for the state-transition path

(Added by roadmap slice S-05. Sits after §6.7 so the existing §6.6/§6.7 references
in the test files keep pointing at the same anchors.)

- **Location**: `tests/review/candidates.test.ts` for the transition itself and the
  batch endpoint's contract; `tests/isolation/flashcards.test.ts` for anything about
  **who** may perform it — §6.2's one-file-per-resource rule puts cross-account
  denial with the other flashcard denials, not here.
- **Naming**: `*.test.ts`, named after the resource. A new transition case goes into
  the matching file as another `it()`.
- **Run**: `npm test`, or one file with
  `npx vitest run tests/review/candidates.test.ts`. The local stack must be up
  (`npm run db:start`).
- **Check §6.6 first**, as §6.2 requires: the S-05 entry there tabulates what each
  claim already rests on, and what the slice deliberately leaves to manual checks.
- **Pattern**: §6.4's, unchanged — real endpoint, real cookie, real Postgres,
  row-based assertions with a positive control, **404 never 403**, and a file-level
  `Date.now().toString(36)` namespace (§6.5).

Five facts that are invisible from the test file and will cost you an afternoon:

- **A zero-row write is a `200`, not an error — so a status assertion proves
  nothing.** Under RLS an UPDATE that matches nothing reports no error, and the
  batch endpoint deliberately reports it as `{ ok: true, changed: [], skipped: [...] }`
  (the same benign shape `/api/study` uses for `alreadyApplied`). `changed` is
  therefore the _only_ signal that separates a refused reach from a successful one.
  Always pair it with the row re-read as the owner.
- **`skipped` is derived, not reported by the database**: it is the requested set
  minus what `RETURNING` produced. An id lands there for four indistinguishable
  reasons — already in the target state, illegal for it, in another deck, or another
  account's. That conflation is intentional (an owner must not be able to probe
  another account's ids), so never write a test that expects `skipped` to explain why.
- **Two axes are called "state" and they are not the same** (repeated from §6.7
  because this is the file where it bites hardest). `flashcard.state_id` is the
  lifecycle — 1 generated / 2 accepted / 3 rejected — and is what a transition moves;
  `flashcard_schedule.srs_state` is FSRS's (0 New / 1 Learning / 2 Review /
  3 Relearning). Asserting the wrong column proves nothing while reading as a pass.
- **`generated` is not a reachable target, and it is refused twice.** The Zod union
  on the endpoint rejects the _value_ with a `400`, while `ALLOWED_FROM` has no key
  for it so the lib layer matches an empty allow-list. Test the lib layer through
  `setFlashcardState` directly if you want the second guard — over HTTP you only ever
  see the first.
- **Accepting a card does not seed its schedule.** `ensureSchedule` stays lazy inside
  `listDueCards`, so a card accepted-then-rated-then-rejected keeps an orphaned
  `flashcard_schedule` row on purpose — that is what lets "Przywróć" resume the real
  schedule instead of resetting the card to New. Do not "fix" an orphan you find; a
  test asserting `reps` survives a reject→accept round trip is what pins it.

**The deliberate-breakage check for this path**: delete the
`.in("state_id", ALLOWED_FROM[target])` predicate from `setFlashcardState` and
confirm exactly the illegal-transition and mixed-batch assertions go red while every
legal edge stays green. For the ownership half, neuter `deck_select`,
`flashcard_update` **and `flashcard_select`** together — two are not enough, because
Postgres applies the SELECT policy to an UPDATE's WHERE clause, so the write half
stays invisible and you would conclude more than you tested. §6.6 records both runs
and the restore-verification failure that nearly slipped through.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Generated Supabase types (`src/db/database.types.ts`)** — the generator
  is the test. Re-evaluate if the file is ever hand-edited. (Source: Phase 2
  interview Q5.)
- **shadcn-style primitives in `src/components/ui/`** — vendored library
  surface, not this project's logic. Re-evaluate if a primitive grows
  project-specific behaviour. (Source: Phase 2 interview Q5.)
  > **Scope correction (2026-07-25, from C10X-22).** This exclusion covers the
  > primitives' own behaviour. It does **not** extend to the global style layer
  > they all inherit — `src/styles/global.css` is written by this project, not
  > vendored, and a single line there breaks every input and button at once. Read
  > the exclusion as "we don't test the vendored component", never as "we don't
  > test anything rendered by `ui/`".
- **Visual rendering of the focus ring (and contrast generally)** — no
  automated coverage, by capacity, not by belief that it is safe. The defect
  class is real and shipped: C10X-22 is invisible to `eslint-plugin-jsx-a11y`,
  because the JSX is correct and so is the Tailwind ring configuration — the
  ring rendered a real `box-shadow` all along. The fault was the **value** of
  the shared `--ring` token, which feeds both the primitives' `ring-*` and the
  app-wide `outline-color`, resolving to its light-theme grey on a permanently
  dark surface: 43 of 48 controls measured 2.3–2.7:1 against a 3:1 bar. (The
  ticket's own suspected cause — "`ring-*` never maps to a real box-shadow" —
  was refuted by measurement; do not re-derive the plan from it.) Catching this
  needs a computed style in a real browser — i.e. the e2e / visual-diff layer
  §4 and §5 deliberately do not have. Re-evaluate the moment any §3 phase
  wires e2e; that is the point at which this becomes cheap rather than a new
  layer. Until then the guard is the measured acceptance check in the change
  itself (contrast ≥ 3:1, **WCAG 1.4.11 only**), recorded per control before
  and after in `context/archive/2026-07-25-focus-ring-a11y/verification.md`.
  (Source: C10X-22 / `context/archive/2026-07-25-focus-ring-a11y/`.)
  > **Citation corrected (2026-07-25, impl-review F4).** This bullet used to
  > claim "WCAG 1.4.11 / 2.4.11". Only 1.4.11 (Non-text Contrast) is measured.
  > **2.4.11 is Focus Not Obscured, and nothing tests it** — the harness reads a
  > computed style on a control focused in place, so an indicator that paints
  > correctly and is then scrolled underneath something reads as a pass. That is
  > not hypothetical here: the deck page stacks two opaque `sticky` bars
  > (`pages/decks/[publicId]/index.astro` `sticky top-0 h-16`,
  > `components/flashcards/FlashcardWorkspace.tsx` `sticky top-16`) over the
  > scroll container in `layouts/AuthenticatedLayout.astro`, and there is no
  > `scroll-margin-*` or `scroll-padding-*` anywhere in `src/`, so Tab-driven
  > scroll-into-view aligns a control with the top of the scrollport — i.e.
  > under both bars. Treat Focus Not Obscured as untested negative space, not as
  > covered by C10X-22. Fixing it is a one-property change
  > (`scroll-padding-top`) but needs its own browser verification; deliberately
  > left out of C10X-22 rather than claimed without evidence.
- **Marketing/landing pages and static copy** — snapshot tests break
  constantly and catch nothing. Re-evaluate if the landing gains a real
  flow (e.g. the inline sign-in form parked as C10X-20). (Source: Phase 2
  interview Q5.)
- **Rate limiting on generation** — no rate limit exists, so a test would
  require adding the safeguard first. Re-evaluate if a limit is
  implemented; the cost exposure is partially covered by Risk #6
  (server-side length enforcement). (Source: Phase 3 challenger pass.)
- **React islands' own fetch-response handling** — untested by _construction_, not
  by decision, and named here because that distinction was invisible until it cost
  something. §6.4's "pages are deliberately not rendered" is well known; the islands
  those pages mount are equally unreachable, and nobody had written it down. The
  gap is not academic: **the one production bug the C10X-27 audit found lives
  exactly there** — `StudySession.rate()` checks `!res.ok` on a response that
  middleware turned into an HTML `200`, so every rating is silently discarded while
  the UI reports progress. Four sibling islands parse before checking `ok` and would
  survive it; only `rate()` inverts the order, and no layer in this plan could see
  the difference. What follows: an island's response handling is **reviewed by
  reading, deliberately and every time** — when a change touches a `fetch` in an
  island, diff its ok/parse/redirect handling against `GeneratorForm.tsx`,
  `FlashcardWorkspace.tsx` and `CandidateReviewWorkspace.tsx` rather than trusting
  the suite. Re-evaluate the moment any §3 phase wires e2e; that is the layer this
  belongs to. (Source: C10X-27 audit, 2026-07-26.)
  > **Narrowed, not closed (C10X-27, 2026-07-26).** The **decision** is now testable and
  > tested; the **JSX remains unreachable**. Rather than add a DOM environment and a
  > component-test layer — which §4 would need a new row and a `checked:` date for — the
  > two decisions that failed were extracted into pure functions and covered directly:
  > `readJsonResponse` in `src/lib/http.ts` (`tests/lib/http.test.ts`, 7 cases, including
  > the defect's exact `200 text/html` shape) and `rateOutcome` in
  > `src/lib/study-session.ts` (`tests/lib/study-session.test.ts`, 4 cases: counting a
  > real transition, not counting `alreadyApplied`, offering a skip on 404 and not on a
  > retryable failure). What is still uncovered by construction is everything around
  > them — the island's rendering, its state wiring, whether `rate()` actually calls the
  > helper. So the review-by-reading rule above **stands unchanged**; the extraction
  > shrinks what a reading has to catch, it does not remove the need for one. The same
  > applies to `SessionSizeControl`'s `SIZE_MIN`/`SIZE_MAX` mirror, which §6.6's Phase 4
  > entry names as the one bound layer no test reaches.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-07-15
- Stack versions last verified: 2026-07-15
- AI-native tool references last verified: 2026-07-15
- §3 Phase 4 / Risk #3 coverage claims last **audited against the code**:
  2026-07-26 (C10X-27). Suite state at that moment: 69/69 green, 8 files, local
  stack up, `OPENROUTER_API_KEY` unset. Three claims in this file were found false
  or stale and are corrected in place — see the header. **A coverage claim in §6.6
  is only as good as its audit date**; the two-day-old Phase 4 table already
  overstated one row.
- §3 Phase 4 / Risk #3 coverage claims last **proven by execution**: 2026-07-26, later
  the same day, by C10X-27 shipping. Suite state: **109/109 green, 11 files**, local
  stack up, `OPENROUTER_API_KEY` unset, `git diff` clean for `src/` after every breakage
  check. Every deliberate-breakage count in §6.6's Phase 4 entry now comes from a run
  executed against these files, and each restore was confirmed by a before/after
  definition `diff`. Mutation coverage on `rateCard`: 56.90% (33 killed / 13 survived /
  12 uncovered), no assertion added — register in
  `context/changes/srs-study-session-test/mutation-register.md`.
- **Two coverage gaps are open and named**, deliberately not folded into the `complete`
  status: the RPC's `f.id asc` tie-break has no assertion that observes its *presence*
  (only the batch's order), and §6.6's four-policy neuter no longer reproduces on a dev
  DB past PostgREST's `max_rows`. Both are described where they bite, in §6.6 and §6.7.
- **Not verified: whether `20260724220524` reached the cloud project.** Phase 0 of
  C10X-27 was explicitly non-blocking and was not run; every result above is against the
  local stack, where the migration is applied. `/ship` owns that check.

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
