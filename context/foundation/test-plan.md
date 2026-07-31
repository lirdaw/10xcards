# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-31 (C10X-34 `auth-error-copy` shipped — roadmap H-03, not a §3 rollout
> phase). **No risk row moves.** What it adds is the READ end of a channel this file only ever
> pinned at the write end, the first automated coverage of the OpenRouter banner gate, and — the
> reason to read it even if auth is not your concern — the correction of five comments and one
> denominator that contradicted the code they explained.
>
> The framing is the finding. The work this ticket named was **already on `main`**, shipped as
> side work under a foreign key (C10X-28's Phase 1 and Phase 4 §1, every commit scoped
> `(C10X-28)`), and the audit of what lands "along the way" is where the edges were: the mapper
> answered its single most common ordinary error — a blank e-mail on sign-up — with the
> catch-all, while the constant written for that case was **dead by construction**; `AUTH_MESSAGES`
> was enforced where messages are produced and ignored where they are consumed, so a crafted
> `?error=` link rendered attacker-chosen text inside this project's own red banner; the banner
> gate had **zero** automated coverage of a decision that is self-hiding when it regresses; and
> `confirm-email.astro` carried the only `import.meta.env` in all of `src/`, against a hard
> AGENTS.md rule and with a heuristic that lies under a production build.
>
> Two things about the evidence rather than the coverage. **Two assertions were unfalsifiable and
> are now killable** — a case titled "on `name` alone" fed a `status` that reached the same
> constant through a different rung (deleting the production entry left the file **0 of 50 red**;
> after one input changed, **1 of 50**), and `signup.ts`'s malformed-body discriminator was half
> tested while signin's twin was covered on both branches. And **two comments were corrected by
> measurement, not by reading**: breakage check B proved the distinctness case is blind to a
> repointed map key (it stayed green while the mapping row went red), and the mapper's truthiness
> branch proves the non-emptiness scan cannot kill a `→ ""` mutant — the closed-set assertion is
> what does. Suite **254/254, 21 files**; Stryker on the mapper **92.98%**, four survivors, all
> confirmed equivalent **by execution**, no assertion added. Evidence:
> `context/changes/auth-error-copy/verification.md`.
>
> Previously: 2026-07-30 (C10X-32 `flashcards-test-order` shipped). **The suite is now
> order-independent and shuffled by default** — `sequence: { shuffle: true }` is on
> permanently in BOTH runners, seed un-pinned, so an inter-`it()` dependence fails loudly
> instead of hiding behind declaration order. No risk row moves and no coverage claim
> changes: this is about whether the existing claims are *trustworthy*, not about what they
> cover.
>
> What it found and what it fixed. Six order-dependent case-pairs across three files, all
> one shape — a positive control mutating the shared `beforeAll` fixture that the denials
> beside it assert a file-scope constant against (plus one fixture-less aggregate, the
> `srs_state = 3` canary, whose `length > 0` control held only because siblings had run
> first). Four confirmed by execution, **two latent** — visible only to static analysis, so
> "shuffle until green" would have under-counted them. Four edits, no assertion weakened:
> every mutating control now owns the row it mutates. The rule is in **§6.2**, together
> with the replay procedure (`npx vitest run --sequence.seed=<n>`). One thing surfaced that
> is NOT this change's: a local-stack transport flake (Kong keep-alive → PostgREST `502`),
> measured at the **same rate with shuffle off**, now absorbed by a narrow `fetch` wrapper
> with a positive control proving it fired (22 absorbed drops across a 0/40-red matrix), and
> whose predicate the impl-review then made assertable rather than only argued.
> Suite: **228/228, 19 files** (220/220, 18 at phase completion), green across 40 fresh permutations; the eval's failure set
> under shuffle equals its C10X-31 baseline (forced `niemiecki`/`francuski`, still red, still
> out of scope). Evidence: `context/changes/flashcards-test-order/verification.md`.
>
> Previously: 2026-07-29 (C10X-31 `ai-candidate-generation-test-3` shipped). **§3 Phase 5
> is `complete` and Risk #7 is covered as far as a proxy can cover it** — the project's
> first LLM-as-judge eval exists, ran against the real provider, and its very first
> calibrated run found a REAL generation defect, which is the eval doing its job rather
> than failing at it.
>
> What the slice built, and the boundary it states in the same breath. A separate run
> path — `npm run eval` (= `vitest run -c vitest.eval.config.ts`, key in the SHELL env
> only) — drives the production `generateCandidates()` through a 10-case language matrix
> (5× `auto`, 5× forced) and grades every card with `google/gemini-2.5-flash`, a
> different model family from the generator's `openai/gpt-4o-mini`, so the generator
> never grades itself. `npm test` collects ZERO eval files — exclusion is structural, by
> `include` replacement, with `vitest.config.ts` and `tests/setup/preflight.ts`
> byte-identical — and the eval's own preflight is the INVERSE of the main one: it fails
> when the key is ABSENT, because mock mode returns fixed Polish strings and a PL
> fidelity case would pass vacuously. The first recorded run: `auto` flawless (25/25
> cards in the source language), but the FORCED path answers in Polish for
> `niemiecki`/`francuski` (0/5, four of four runs) — the Polish exonym inside an English
> prompt sentence reads as more Polish context. Fixing the prompt is out of scope by
> plan; raised as a follow-up. First-ever measurements of the two dormant metrics: count
> compliance 100%, skip-rate 0%. The judge does NOT measure the 75% acceptance rate —
> only real users produce that — and the CI/workflow leg is deliberately deferred
> (local-only, human-triggered; §5). The ordinary suite gained the success-path
> audit-columns case C10X-28's hand-off named. Suite: **220/220, 18 files**.
> Evidence: `context/changes/ai-candidate-generation-test-3/verification.md`.
>
> Previously: 2026-07-28, second entry of the day (C10X-30 `server-side-validation-test`
> shipped). **§3 Phase 2 is `complete` and Risk #6 is covered on the server side** — the
> card-content half that C10X-28 named as the single thing between this phase and `complete`
> now has its test, so the status is a dated claim rather than a standing IOU.
>
> What the slice added beyond the assertion, and the boundary it keeps. `FRONT_MAX`/`BACK_MAX`
> gained a **second, independent enforcer** — a DB CHECK (`char_length between 1 and N`) that
> closes the residual risk S-02 recorded on 2026-07-09, when the maximum lived only in app
> code — and the breakage **pair** is what separates the two layers: one run alone cannot tell
> "the endpoint caught it" from "the database caught it". Three "server trusts the client"
> defects were fixed rather than deferred on four of the **six** endpoints that read
> `formData()` — the deck-form pair was missed and still carries two of them (impl-review
> F1, see §6.6): an unguarded
> `formData()` that answered an uncontrolled framework `500`, a `File` part that crashed the
> handler on `.trim()`, and the untested `IDS_MAX` bound on `/cards/batch`. The rule this file
> did not have is now **§6.10**: the two card endpoints are native-form targets that refuse
> with a **`302`**, not a `4xx`, so a refusal and a success carry the same status and the row
> oracle is not optional. That wording — "4xx", plus a `PATCH` handler that does not exist —
> was wrong in six places and is corrected here and, as a dated correction line, in the
> archive. Auth input validation is deliberately **out**, owned by C10X-36; what landed on the
> auth routes is malformed-body handling only. Suite: **207/207, 17 files** (193/193, 16 at
> phase completion; the impl-review added 14 across 5 findings — see §8).
> Evidence: `context/changes/server-side-validation-test/verification.md`.
>
> Previously: 2026-07-28 (C10X-29 `schema-drift-test` shipped). **§3 Phase 3 is
> `complete`, and Risk #5 is covered per drift CLASS rather than wholesale** — the row
> names which classes are gated, which are only detectable off the deploy path, and which
> are not covered at all, because "Risk #5 closed" would be false in both directions.
>
> What the slice built, and the boundary it states in the same breath. A `drift` job now
> sits between `ci` and `deploy` and compares the repository's migration **versions**
> against `supabase_migrations.schema_migrations`, read through the Supabase Management
> API; `deploy` gains `needs: [ci, drift]`, so an unpushed migration stops the Worker
> deploy. It is a **history oracle by deliberate choice**: the incident behind this risk
> was a `migration repair` desync over a byte-identical schema, which a DDL diff cannot
> see. The two oracles are complementary, so an on-demand `db diff` workflow covers the
> contents-side classes — **on `workflow_dispatch` only, with no schedule and no
> notification channel**, and §5 records it as human-triggered rather than as a gate.
> Drift class 8 (stale `src/db/database.types.ts`) is closed by one step in the existing
> `ci` job. Two traps are recorded rather than smoothed over: `supabase migration list`
> and `db diff` **both always exit 0**, so a gate written from the docs would have enforced
> nothing (now a `lessons.md` entry), and Phase 4's own breakage criterion does not go red
> as worded, because `db:types` overwrites the working tree before the diff runs. **No test
> in the suite touches the cloud** — the wiring is carried by recorded runs, not by an
> assertion. Suite: **178/178, 15 files** (177 when the phases closed; the impl-review added
> the twelfth comparator case, having found that two migration files sharing one version read
> as `clean` — a false green in the gate's own core claim).
> **Ship-time verification is complete, not deferred**: the gate ran green on a real push to
> `main`, and the DDL workflow — dispatchable only once it reached the default branch — was
> exercised three times, two green and one deliberately red.
> Evidence: `context/changes/schema-drift-test/verification.md`.
>
> Previously: 2026-07-26, third entry of the day (C10X-28 shipped, with C10X-34 and
> C10X-30's source-text half riding along). **Risk #4 is covered; Risk #6 is half covered;
> §3 Phase 2 deliberately stays `implementing`** — the row now names the one test that
> flips it (a crafted request against the card-content endpoints) so "implementing" reads
> as a decision rather than as leftover state.
>
> What the slice proved, and what it refuses to claim. The no-leak property on
> `/api/generate` already held by construction and is now **asserted** on both failure
> branches, behind the project's first module double (`astro:env/server` only — never
> `@/lib/openrouter`, which would make the `Authorization` half unassertable); the key is
> pinned to the header by production code. The two surfaces where private data genuinely
> _did_ escape — the auth routes' verbatim relay of an upstream message into a URL, and
> `generation_session`'s four private audit columns, which had no cross-account test at
> all — are closed. The log half is a first-party guard over the whole of `src/` and
> nothing more: **no test here reads a log sink**, and dependency-emitted lines are in
> scope but unowned (§7). Three pointer-level falsehoods in this file are corrected —
> every archived-change evidence path (each verified to resolve), the S-05 Stryker range,
> and a stale anchor in a live test comment. Suite at completion: **166/166, 14 files**.
> Evidence: `context/changes/ai-candidate-generation-test-2/verification.md`.
>
> Previously: 2026-07-26, second entry of the day (C10X-27 shipped — the change the
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
> files. Evidence: `context/archive/2026-07-26-srs-study-session-test/verification.md` and
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
> `context/archive/2026-07-26-srs-study-session-test/research.md`.)
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

| #   | Risk (failure scenario)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A new or changed API endpoint lets one account read or modify another account's deck or flashcards — the ownership check does not hold, RLS is bypassed, or a `publicId` from the URL is treated as authorization. Private content leaks across accounts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | High   | High       | interview Q1, interview Q3; PRD §Guardrails (per-account data isolation), PRD §Access Control; hot-spot dir `src/lib/` (18 commits/30d); hot-spot dir `src/pages/api/decks/[publicId]/cards/` (4 commits/30d)                          |
| 2   | A retry after a generation timeout writes a second set of candidates — the user gets duplicated cards and a duplicated generation session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Medium | High       | `context/foundation/lessons.md` (recorded tradeoff: write is not idempotent under client+server timeout with a retry button); PRD FR-018; hot-spot dir `src/lib/` (18 commits/30d)                                                     |
| 3   | The study session loses a card or writes the wrong next-review date, and cards that were never accepted enter review — the schedule stops being trustworthy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | High   | Medium     | PRD §Guardrails (spaced-repetition scheduling correctness), PRD §NFR (schedule survives across sessions), PRD US-02 acceptance criteria, PRD FR-006; roadmap S-03 (north star, next in sequence)                                       |
| 4   | Private source text or the LLM API key escapes into a log line or an error response body. **Covered 2026-07-26 (C10X-28), with a named boundary: the response-body half is pinned on both failure branches, the log half only for what `src/` itself writes. Read §6.6's C10X-28 entry before citing this as closed.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | High   | Medium     | PRD §Guardrails (privacy of pasted source text), PRD §NFR (privacy); `context/foundation/lessons.md` (prod secret is separate from `.env`; missing secret silently degraded to mock mode); abuse lens (secret/PII leakage)             |
| 5   | The production schema drifts from the migration history — the deployed app writes against an un-migrated database. **Covered 2026-07-28 (C10X-29) per drift CLASS, not as one range — writing "classes 4-9 are uncovered" would be false for four of them. Gated in CI and deploy-blocking: a migration committed but never pushed; a history desync from `migration repair`; an out-of-order version skipped by `db push`. Gated in the `ci` job: a stale generated `src/db/database.types.ts`. Detectable only off the deploy path, by an on-demand DDL diff nobody is scheduled to run: a migration file amended after it was pushed; production changed by hand in Studio; `repair --status applied` on something never applied. Not covered at all: `config.toml` vs dashboard config, and seed/dictionary row drift. Read §6.6's C10X-29 entry before citing this as closed.** | High   | Medium     | interview Q2 (real incident during M2L5); `context/foundation/lessons.md` ×2 (cloud migration is a step distinct from app deploy; blind `migration repair` desynced prod history); hot-spot dir `supabase/migrations/` (6 commits/30d) |
| 6   | The server trusts the client — a crafted request bypasses the source-text length limit and the card content rules that the UI enforces. **Covered on the server side, in two dated halves: source text 2026-07-26 (C10X-28), card content 2026-07-28 (C10X-30). Both LENGTH limits have exactly one definition (`SOURCE_MAX`; `FRONT_MAX`/`BACK_MAX`), and the card pair now carries a second enforcer independent of the endpoints — a DB CHECK. `/cards/batch`'s `IDS_MAX` is the exception and is asserted rather than single-sourced: the review island mirrors it as a commented copy, so the server is its only enforcer. The boundary: only the SERVER half is asserted. The three card islands mirror the constants by import but their enforcement is not tested (§7), and unlike `GeneratorForm` they carry no `maxLength`, so their over-length branch IS reachable through the browser and rests on a manual check. Read §6.6's C10X-30 entry before citing this as closed — on the card endpoints the refusal is a `302`, not a `4xx`.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Medium | Medium     | PRD FR-003 (maximum source-text length), PRD FR-007; abuse lens (untrusted input, server-side validation parity); hot-spot dir `src/lib/` (18 commits/30d)                                                                             |
| 7   | Generation returns cards in the wrong language or cards that are unusable, so the acceptance rate falls below 75% and the product thesis fails. **Covered 2026-07-29 (C10X-31), as far as a proxy can cover it: a local, human-triggered LLM-as-judge eval (`npm run eval` — never part of `npm test`) proves language fidelity and usability across all six selector values against the real provider, and its first calibrated run found a real defect — the forced-language prompt path answers in Polish for `niemiecki`/`francuski` while `auto` is flawless; recorded and raised as a follow-up, not fixed here. The judge does NOT measure the 75% acceptance rate — only real users produce that. Read §6.6's C10X-31 entry before citing this as closed.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | High   | Medium     | PRD §Success Criteria (≥75% of generated cards accepted; ≥75% of cards created via generation), PRD §NFR (cards follow the source-text language: PL/EN/ES); roadmap S-05                                                               |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                | Must challenge                                                                       | Context `/10x-research` must ground                                                                                          | Likely cheapest layer                                           | Anti-pattern to avoid                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| #1   | Account B is denied account A's resource on read **and** on write, while account A still reaches its own data                              | "Authenticated implies authorized"; "RLS is enabled, therefore the endpoint is safe" | Session/JWT shape, where the ownership check is enforced, how a `publicId` maps to a row, which queries run under which role | integration on the endpoint + RLS exercised with JWT claims     | Testing as `postgres` (bypasses RLS); no positive control, so "zero rows" reads as isolation when the policy is simply broken |
| #2   | Two identical requests produce exactly one set of cards                                                                                    | "Client timed out, therefore the server did not commit"                              | Idempotency key or dedup boundary, timeout ordering, where the write transaction ends                                        | integration (two requests against one endpoint)                 | Asserting only the timeout ordering instead of the actual race                                                                |
| #3   | A card rated well-known is deferred further than a card rated hard; the schedule survives a restart; only `accepted` cards enter a session | "The session returned cards, therefore the schedule works"                           | FSRS schedule columns vs the existing card `state_id`, source of "now", persistence boundary                                 | unit on rating→next-review mapping + integration on persistence | Assertion copied from the implementation (oracle problem); happy path with no restart                                         |
| #4   | Neither the error body nor the log line contains source text or the API key                                                                | "A 500 is harmless"                                                                  | The FR-018 error path, what is written to logs vs returned to the client                                                     | integration on the failure path                                 | Asserting the status code instead of the payload contents                                                                     |
| #5   | A drift between migration history and the deployed schema stops the pipeline **before** the app deploys                                    | "Green locally means prod is migrated"                                               | The CI steps, how (and whether) `db push` is wired relative to deploy                                                        | CI gate (drift check)                                           | A unit test where a gate is required                                                                                          |
| #6   | A request that bypasses the UI is refused in the caller's own convention — a `4xx` on the JSON endpoints, a `302` to an owned error URL on the native-form targets — and writes nothing either way | "Validated in the form means validated"; "the refusal has its own status" — on a redirect-style endpoint it does not (§6.10) | Where the schema validation runs, client/server parity, and which convention the endpoint answers in                        | integration on the endpoint                                     | Driving the case through the UI only, never touching the server                                                               |
| #7   | Cards come back in the source language and are usable for PL/EN/ES material                                                                | "The model returned valid JSON, therefore the cards are good"                        | The prompt, the response contract, the model selection                                                                       | AI-native (LLM-as-judge over a reference set)                   | Snapshotting the model response — non-deterministic, breaks without signal                                                    |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status normally moves left-to-right (`not started` →
`implementing` → `complete`); the orchestrator updates Status as artifacts
appear on disk. A fourth value, **`reopened`**, exists because a later audit can
show a `complete` phase never covered all of its risk — see Phase 4. Treat
`complete` as a dated claim, not a permanent state.

| #   | Phase name                      | Goal (one line)                                                                         | Risks covered                                                                                        | Test types                         | Status       | Change folder                                                                                                  |
| --- | ------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | Harness + per-account isolation | Stand up the runner and prove cross-account denial on read and write                    | #1                                                                                                   | runner bootstrap, integration, RLS | complete     | `context/archive/2026-07-15-verification-harness/`                                                             |
| 2   | Endpoint contract               | Prove the server does not trust the client and does not leak; stop duplication on retry | #2 (**covered** — S-05 Phase 6), #4 (**covered** — C10X-28), #6 (**covered, server side** — C10X-30, 2026-07-28) | integration                        | complete     | `context/archive/2026-07-18-ai-candidate-generation-test/` → `context/archive/2026-07-26-ai-candidate-generation-test-2/` → `context/changes/server-side-validation-test/` |
| 3   | Quality gates + schema drift    | Make green CI mean "tested and prod actually migrated"                                  | #5 (**covered** — the deploy-blocking classes and the stale generated types; C10X-29, 2026-07-28)    | gates                              | complete     | `context/changes/schema-drift-test/`                                                                           |
| 4   | SRS schedule correctness        | Prove the schedule defers by rating, survives restart, and admits only accepted cards   | #3 (**covered** — both halves; closed by C10X-27, 2026-07-26)                                        | unit + integration                 | complete     | `context/archive/2026-07-24-srs-study-session/` → `context/archive/2026-07-26-srs-study-session-test/`         |
| 5   | AI-native generation quality    | Prove cards match the source language and are usable, so the 75% thesis is measurable   | #7 (**covered as far as a proxy can be** — C10X-31, 2026-07-29; the judge does not measure the 75% acceptance rate) | LLM-as-judge                       | complete     | `context/changes/ai-candidate-generation-test-3/`                                                              |

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
  exactly what the inverted suite does and does not prove.
  **Phase 2's second slice (`ai-candidate-generation-test-2`, C10X-28, 2026-07-26)
  covered Risk #4 and half of Risk #6**, and left the phase at `implementing` on purpose:
  the outstanding work was one named test — a crafted request against the card-content
  endpoints breaching `FRONT_MAX`/`BACK_MAX` and shown to write nothing — not a slice.
  **Phase 2's third slice (`server-side-validation-test`, C10X-30, 2026-07-28) landed it,
  and the row is now `complete`, dated.** Three things about how it landed are worth
  carrying forward, because none was visible when the work was scoped as "one test".
  First, the named test could not be written as described: the create/edit endpoints are
  **native-form targets that refuse with a `302`**, so "assert a 4xx" was wrong wording
  (as was "PATCH", which neither endpoint exports), and a refusal is indistinguishable
  from a success without a row oracle plus an **equality** assertion on the decoded
  `error` param. That rule now has its own subsection, **§6.10**. Second, C10X-28's
  reason for excluding this half — "those endpoints already share one constant with their
  islands, so they are the low-drift side of #6" — was true and still left the constants
  with **no enforcer beneath the app**, so the slice added a DB CHECK and proved the two
  layers independent with a breakage **pair** rather than a single run. Third, three
  "server trusts the client" defects (unguarded `formData()`, a `File` part crashing the
  handler, the untested `IDS_MAX` bound) were fixed here instead of being deferred a second
  time — on **four of the six** endpoints that read `formData()`. The plan's own enumeration
  said "all four form endpoints" and that was simply wrong: `decks/index.ts` and
  `decks/[publicId].ts` (deck create and rename) carry the first two defects verbatim and
  were never touched. Found by this change's impl-review (F1), deferred by decision, and
  named in the "does NOT prove" list below rather than left to be inferred from a count.
  Auth input validation was
  considered and routed out to **C10X-36**; what landed on `signin.ts`/`signup.ts` is
  malformed-body handling, not an input rule. §6.6's C10X-30 entry states what the slice
  does **not** prove — chiefly the island half, which is where §7's note now matters more
  than it did for `GeneratorForm`.
- Phase 3 shipped as **C10X-29 `schema-drift-test`** (2026-07-28), and the one decision
  worth carrying forward is what kind of oracle the gate is. It compares migration
  **versions** — the repository's filenames against the cloud's
  `supabase_migrations.schema_migrations` — and never compares **contents**. That is a
  deliberate choice, not a shortcut: the incident this risk was written from
  (`lessons.md`, "Operacje migracji Supabase") was a `migration repair` desync that left
  the deployed schema byte-identical and the history wrong, which a DDL diff cannot see at
  all. So the cheap, deploy-blocking gate is the one that covers the classes this project
  has actually lived through, and the expensive DDL diff — which covers the classes the
  history oracle is blind to — sits off the deploy path on `workflow_dispatch`. The two
  oracles are complementary, not ranked. §2's Risk #5 row states the split per class, and
  §6.6's C10X-29 entry states what the gate does **not** prove; the two are written to be
  read together and must not be allowed to drift apart.
- Phase 4 shipped inside roadmap **S-03 `srs-study-session`** (its Phase 5),
  which is where the schedule itself was built — roadmap F-03 had already
  deferred this test to S-03, so the phase reused that change folder rather
  than opening a competing one. Read §6.6 for exactly what that claim does and
  does not include, and §6.7 for how to add the next SRS test.
  **Reopened 2026-07-26** (status `complete` → `reopened`) by a full audit run
  under C10X-27 / roadmap **H-02**, change folder
  `context/archive/2026-07-26-srs-study-session-test/`. The phase's own three claims hold and
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
  **Shipped as C10X-31 `ai-candidate-generation-test-3` (2026-07-29), roadmap H-06** — as a
  SEPARATE run path (`npm run eval`), not a new `npm test` layer, because the mock clamp in
  preflight is load-bearing and stays byte-identical; exclusion is by collection (a second
  Vitest config with its own `include`), not by a guard. The first calibrated run was
  honestly red with a real finding — the forced-language prompt path answers in Polish for
  `niemiecki`/`francuski` while `auto` is flawless — recorded, out of scope by plan ("No
  changes to the generation path"), raised as a follow-up. §6.6's C10X-31 entry carries the
  claims table and the does-NOT-prove list; §5's LLM-as-judge row is rewritten to the
  local-only, human-triggered reality.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                | Tool                                                    | Version                                                                     | Notes                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration   | Vitest                                                  | 4.1.10                                                                      | Configured through `getViteConfig()` from `astro/config` (`vitest.config.ts`), which is what resolves the `@/*` alias and `astro:env/server`. The adapter's `@cloudflare/vite-plugin` is stripped there — it fights Astro over the `ssr` environment and tests target Node; checked: 2026-07-15                                                                 |
| endpoint rendering   | Astro Container API                                     | ships with Astro 6                                                          | `renderToResponse` with `routeType: "endpoint"` renders an API route against a real `Request`; checked: 2026-07-15                                                                                                                                                                                                                                              |
| API mocking          | one confined module double — **see §6.9**               | Vitest's own `vi.mock` / `vi.hoisted`; no mocking library                   | Only the external HTTP edge (the LLM provider) is ever doubled; the database is real via local Supabase. Exactly one file does it (`tests/generation/failure-path.test.ts`), doubling **`astro:env/server`** plus a pass-through `globalThis.fetch` to reach the 502/422 branches the harness otherwise seals. Read §6.9 before copying it; checked: 2026-07-26. Since 2026-07-30 a **second** `fetch` seam exists and is NOT a double — `tests/setup/retry-transport.ts`, a suite-wide `setupFiles` wrapper that replays Kong's keep-alive `502` and nothing else; it fabricates no response, so it is not precedent for a second double (§6.9) |
| database under test  | Supabase CLI local stack                                | 2.98.2 (devDependency; `^2.23.4` in `package.json` is only the range floor) | Driven by `npm run db:start` / `db:stop` / `db:reset`; RLS is only meaningful against a real Postgres. CI starts the same stack and reads its URL + publishable key from `supabase status -o env`; checked: 2026-07-15                                                                                                                                          |
| e2e                  | none yet — deliberately deferred                        | —                                                                           | No rollout phase claims e2e; promote only if a risk survives cheaper layers                                                                                                                                                                                                                                                                                     |
| accessibility        | `eslint-plugin-jsx-a11y`                                | 6.10.2                                                                      | Lint-level only; PRD names baseline a11y but no risk in §2 requires an axe run yet                                                                                                                                                                                                                                                                              |
| AI-native            | LLM-as-judge over a reference set — shipped by §3 Phase 5 (C10X-31); judge `google/gemini-2.5-flash` via OpenRouter, `temperature: 0`, structured outputs, `EVAL_JUDGE_MODEL` override; checked: 2026-07-29 | judge pinned in `evals/lib/judge.ts` as a revisable constant                 | Invocation: `npm run eval` with `OPENROUTER_API_KEY` in the SHELL env — a `.env` key feeds only the generator's seam and the inverse preflight rejects it. NOT part of `npm test` (collection-level exclusion via `vitest.eval.config.ts`). **When NOT to use**: any assertion a deterministic check can make (JSON shape, card count, field presence, language tag) — those live in the ordinary suite (`tests/lib/eval-scoring.test.ts`). The judge is for usability and language fidelity only                                                                                                                                       |

**Stack grounding tools (current session):**

- Docs: Context7 (`/withastro/docs`) — checked Astro's testing guide for the current Vitest setup path (`getViteConfig()`) and the Container API endpoint-testing shape; checked: 2026-07-15
- Search: Exa.ai — available; not used, the docs MCP answered the stack question directly; checked: 2026-07-15
- Runtime/browser: claude-in-chrome — available; not used, no §2 risk is DOM-unreachable and no phase claims e2e; checked: 2026-07-15
- Provider/platform: Supabase MCP (requires interactive auth, unavailable in headless runs), Atlassian/Jira MCP — noted for Phase 3 gate work only; GitHub Actions is the CI surface every gate in §5 must map onto; checked: 2026-07-15

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase `<N>`" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                               | Where                                           | Required?                                | Catches                                                                   |
| ---------------------------------- | ----------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| lint + typecheck                   | local (husky `pre-commit` via lint-staged) + CI | required — wired today                   | syntactic / type drift                                                    |
| build                              | CI                                              | required — wired today                   | broken production build                                                   |
| unit + integration                 | local + CI                                      | required — wired by §3 Phase 1           | logic regressions, cross-account access, endpoint contract breaks         |
| migration/schema drift check       | CI, `drift` job between `ci` and `deploy`       | required — wired by §3 Phase 3 (C10X-29) | deployed app running against an un-migrated prod schema; a history desync |
| generated-types check              | CI, inside the `ci` job after the local stack   | required — wired by §3 Phase 3 (C10X-29) | `src/db/database.types.ts` stale against the migrations that generate it  |
| DDL diff against the cloud         | GitHub Actions, `workflow_dispatch` only        | optional, human-triggered — no schedule  | a migration amended after it was pushed; production edited by hand        |
| post-edit hook                     | local (agent loop)                              | recommended local, not a CI substitute   | regressions at edit time                                                  |
| prod smoke on a real flow          | between merge and "done"                        | optional                                 | environment-specific failures (missing prod secret, silent mock mode)     |
| LLM-as-judge on generation quality | local only (`npm run eval`, key in the shell env) — no CI, no schedule | optional, human-triggered — wired by §3 Phase 5 (C10X-31) | wrong-language or unusable cards                                          |

e2e on critical flows is deliberately absent: no §3 phase wires it, so
listing it as a gate would be aspirational. Add it only if a risk survives
the integration layer.

The DDL-diff row says **human-triggered** rather than "nightly", and the wording is
load-bearing: `.github/workflows/schema-diff.yml` carries no `schedule:` block, because a
red run in a tab nobody is committed to reading is not coverage — this project has no
notification channel and none is being built. Read that row as a capability that exists
and is exercised when someone asks, never as a signal being watched. Adding a cron is one
line; do it the day an alerting channel and an owner exist, not before.

The LLM-as-judge row follows the same rule as of C10X-31, and for the same reason: the
eval exists and runs when a human runs it. The `workflow_dispatch` leg (schema-diff.yml
idiom, per-step secrets, a SEPARATE OpenRouter key with a low credit limit as the
blast-radius cap) was deliberately deferred to a named follow-up — a scheduled run with no
notification channel would be an alarm nobody hears, not coverage. One operational fact a
runner must know: the eval's red is not hygiene — as of 2026-07-29 `npm run eval` exits
**1** on a REAL generation defect (§6.6's C10X-31 entry), so the contract is "run it, read
the table", not "keep it green".

Two of these gates depend on a cloud credential, which changes what a red run means. The
`drift` job needs `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_ID` and the DDL diff
additionally needs `SUPABASE_DB_PASSWORD`; every failure path in the drift runner —
missing secret, non-2xx, unparseable body, empty result set — **exits 1 by design**, so a
Management API outage blocks the deploy. That is the fail-closed contract working, and the
runner labels it `GATE UNAVAILABLE` (as opposed to `DRIFT`) precisely so the reader knows
it is not evidence about the schema. The recovery for each is in `README.md`'s CI section
and, in full, in the ship runbook.

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
- **The mirroring rule has one clarification, added by §3 Phase 3.** `tests/` mirrors the
  path of what it tests, and the subject is usually app code under `src/`. Where it is CI
  tooling under `scripts/` instead, its test still sits in `tests/lib/` beside the suite's
  other pure-function files — `tests/lib/schema-drift.test.ts` covers
  `scripts/schema-drift.ts`, and that is deliberate, not a convention break. A
  `tests/scripts/` folder holding one file would buy nothing; the pure-function pattern
  (`http.test.ts`, `study-session.test.ts`) is what the file actually follows.

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

**When you extract a decision out of a layout or an island so it can be tested, the
env-derived input must become a PARAMETER** (added 2026-07-31 by C10X-34, and it is the
condition that makes the extraction worth anything). This project reads config through
`astro:env/server`, which Vite inlines at transform time — so a module-level constant computed
from it (`missingConfigs` in `src/lib/config-status.ts`) can only ever describe **the local
stack** under the runner: Supabase configured, OpenRouter not. A function that closes over that
constant is therefore testable only in the one state the runner happens to be in, and the state
that matters is usually the other one. `visibleConfigStatuses(entries, hasSession)` takes the
list; `Layout.astro` supplies `missingConfigs` and `Boolean(Astro.locals.user)`. Every entry in
`tests/lib/config-status.test.ts` is fabricated and the real constant appears in no assertion —
which is precisely what let breakage check F go red on an **un**configured Supabase, a state no
test run can otherwise reach. Same shape as C10X-27's `readJsonResponse` / `rateOutcome`
extractions (§7), with one extra rule: extract the decision **and** its inputs.

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
- **A positive control must OWN the fixture it mutates** (added 2026-07-30 by
  C10X-32, and it is this section's own discipline that produced the defect).
  The bullet above requires a control beside every denial; the cheap way to
  write one is against the shared `beforeAll` fixture — which is exactly what
  makes the pair pass in declaration order and fail in any other. Create the
  deck / card / session the control mutates **inside its own `it()`**
  (`tests/isolation/flashcards.test.ts`'s two `controlDeckId` cases,
  `candidates.test.ts`'s own-session rewrite, and the `generate.test.ts:371-374`
  "Control deck" this pattern was copied from). Never restore the shared
  fixture at the end of a mutating case — restore-after-mutate is itself
  order-dependent hygiene; the owned fixture is the whole fix.
  - The load-bearing distinction on the reading side: **assert what you re-read
    inside the `it()`, never a file-scope constant** captured before a sibling
    could have moved it. `candidates.test.ts`'s overwrite/delete denials are safe
    for precisely this reason (each re-reads `before` itself); the read denial
    beside them, which compares against the seeded `error_message`, was not.
  - And an aggregate that owns no fixture — a scan whose positive control is
    `length > 0` — depends on its siblings just as hard. The `srs_state = 3`
    canary (§6.6 Phase 4) now seeds one schedule row it owns before scanning, and
    keeps the scan account-wide.
- **Shuffle is permanently on, in both runners** (`sequence: { shuffle: true }`
  in `vitest.config.ts` and `vitest.eval.config.ts`, files AND tests within a
  file). The seed is deliberately **un-pinned**, so each run draws a fresh
  permutation and CI accumulates coverage instead of re-testing one order
  forever. Every run's banner prints `Running tests with seed "<n>"` — **to
  replay a red run exactly, `npx vitest run --sequence.seed=<n>`** (no extra
  flag; the config already supplies `shuffle`). A red under a fresh seed is
  normally a real inter-`it()` dependence, and the fix is the owned-fixture rule
  above, not a pinned seed.
  - **If it does not reproduce at its own seed, it is not an ordering defect.**
    The local stack has a pre-existing transport flake — Kong holds a keep-alive
    socket to PostgREST longer than PostgREST does, so the first request after an
    idle gap can answer `502 upstream prematurely closed connection` — measured at
    the same rate with shuffle off. `tests/setup/retry-transport.ts` (a
    `setupFiles` `fetch` wrapper) absorbs exactly that response, from a local URL,
    at most twice, and nothing else. Read its header before widening what it
    retries; every other status in this suite is a signal something asserts on.

### 6.3 Adding a test for a new API endpoint

(Filled in 2026-07-26 by C10X-28; it read "TBD — see §3 Phase 2" until then, and §6.5
had to warn readers off inferring the contract from §6.2's ownership rule.)

Two contracts, and they are separate claims — assert both:

- **Validation parity — a refusal AND no write.** Copy
  `tests/generation/generate.test.ts`'s input-contract block. A status assertion alone
  is not enough: a 400 returned _after_ a write had landed reads as a pass. Every
  rejection case re-counts the rows it could have created and asserts zero, and the
  block carries a **boundary-value success** so the refusals cannot be an endpoint
  refusing everything. Two traps live here, both recorded in §6.6's C10X-28 entry: a
  **status-filtered** count is an argument rather than an assertion, and a PostgREST
  filter scoped by a long value answers **414** before the query runs — scope by a short
  per-case marker with `.like()`.
  > **This bullet used to say "a 4xx AND no write"; corrected 2026-07-28 by C10X-30.**
  > A `4xx` is the convention of the three **JSON** endpoints (`/api/generate`,
  > `/api/study`, `/cards/batch`), not of the project as a whole. The six protected
  > `/api/*` routes that are native `<form method="POST">` targets refuse by
  > **redirecting** to an owned `?error=` URL — the same `302` a success returns — so on
  > those the row oracle is not a supplement to the status assertion, it is the only
  > thing separating a refusal from a write. That case has its own subsection: read
  > **§6.10** before writing one. The "AND no write" half was always the load-bearing
  > part and is unchanged.
- **No leak in the error body.** The invariant is that every `error` string an endpoint
  returns comes from a closed set of module-level literals, never from an upstream
  message, an exception, a Zod issue, or user input. It has a consumer:
  `src/lib/http.ts` renders that string verbatim in every island for anything that is
  neither a `401` nor a redirect. Where private material must be kept (an audit row, a
  log), assert the **contrast on one request** — the row records it, the body does not —
  rather than asserting the status. `tests/generation/failure-path.test.ts` is the
  reference, and reaching a sealed failure branch is the one case where a module double
  is permitted: read **§6.9** first.
- **A closed set enforced only where messages are PRODUCED is half a guarantee** (added
  2026-07-31 by C10X-34). The bullet above pins what an endpoint puts into a URL; it says
  nothing about what a page does with that URL on the way back. Both auth pages read
  `?error=` straight into a trust-carrying red banner, so a crafted link rendered
  attacker-chosen text on this project's own sign-in page — not XSS (React escapes), but
  content injection. The rule: when a message travels through a URL, enforce membership on the
  **read** side too, in a pure helper that lives **beside the set** (`ownedAuthMessage` in
  `src/lib/auth-errors.ts`), so producer and consumer cannot drift. Three things make the test
  real rather than decorative — membership by **equality**, never containment (the attack
  appends to trusted copy, which any "does it look like ours?" check waves through); rejection
  to a value the renderer already treats as "nothing", so an unvouchable error degrades to **no
  banner**; and a positive control over the **whole set**, without which `() => null` satisfies
  every rejection case and reads as perfect protection.

Everything else follows §6.4 — real endpoint, real cookie, real Postgres, row-based
assertions with a positive control, **404 never 403** for ownership, and a file-level
`Date.now().toString(36)` namespace (§6.5). A signed-out case needs no fixture change:
render the endpoint with `locals: { user: null }` through a local container helper, as
`generate.test.ts` and `study.test.ts` already do.

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
>   `127.0.0.1` or `localhost`. "Key is anon" is _not_ sufficient — a production
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
- **Read §6.3 before adding an input-validation case** (bad `count`, over-length
  source text). It owns the status-code and error-body contract, and as of
  C10X-28 it is written rather than TBD — the cases themselves live in _this_
  file's input-contract block. Do not infer that contract from §6.2's "404,
  never 403" rule: that rule is about ownership, not bad input.
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

- **No HTTP double is needed in THIS file, and one exists in exactly one other.**
  `OPENROUTER_API_KEY` is unset locally and in `.github/workflows/ci.yml`, so
  `generateCandidates` short-circuits to `mockCards(count)`
  (`src/lib/openrouter.ts:149-158`) and returns instantly. The outbound seam is
  already neutralised for every case here; do not add a mocking library for it.
  The corollary is that no test in this suite exercises the real provider — a
  change to the prompt or the response contract is invisible (that is §3 Phase 5's
  job).
  > **Corrected 2026-07-26 (C10X-28); this bullet used to end "and none exists".**
  > That was true until the failure branches had to be reached: the same clamp that
  > makes mock mode reliable also seals 502 and 422, so `tests/generation/failure-path.test.ts`
  > lifts it with a confined `astro:env/server` double plus a pass-through `fetch`.
  > It is the **only** file in the suite that doubles anything, and §6.9 states the
  > conditions. Nothing above changes for a test that stays on the success path.
  > **Still true as written on 2026-07-30 (C10X-32), and worth stating so nobody reads it
  > as stale**: `tests/setup/retry-transport.ts` also wraps `globalThis.fetch`, for every
  > file, but it **doubles nothing** — it replays Kong's keep-alive `502` from a local URL
  > and passes everything else through untouched, so no test here sees a fabricated
  > response. §6.9 carries the distinction.
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
    suite stood on 2026-07-26 before C10X-27_ (109/109 after it; **166/166** after
    C10X-28 — read every figure here with the date attached to it).
    **The `1 of 13` split's denominator is stale and the run has not been repeated**
    (corrected 2026-07-26 by C10X-28): `generate.test.ts` held 13 cases when that check
    ran and holds **20** now, because Phase 3 of C10X-28 added seven. Nothing suggests
    the failed-key case stopped observing the index predicate, but "1 of 13" is a claim
    about a run, so re-run it before citing the split.

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

  | Claim from Risk #3                                             | What proves it                                                                                                                                                                                                                                                             |
  | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Deferral follows the rating                                    | `schedule.test.ts` ordering property (no DB) + `study.test.ts` Easy-vs-Hard `due` persisted through the endpoint                                                                                                                                                           |
  | The written schedule is the right one, at the FIRST review     | `study.test.ts` exact-due oracle: `due`/`stability`/`difficulty`/`srs_state`/`reps`/`lapses`/`scheduled_days` vs a direct `scheduler.next`                                                                                                                                 |
  | …and at every review after it                                  | `study.test.ts` "stays faithful across consecutive reviews": three chained ratings vs an oracle Card advanced only in memory (added by impl-review F2)                                                                                                                     |
  | The written schedule survives a re-read                        | re-read on a brand-new client, column-for-column, asserted still rated (not silently reset to New). This is read-after-write, **not** a restart — same process, milliseconds apart                                                                                         |
  | …and the card comes BACK when it falls due ("no card is lost") | `study.test.ts` "returns the card at its persisted due and withholds it a minute after the rating" — rated at a fixed `now`, then `listDueCards` at `now + 1 min` (absent) and at the persisted `due` (present, `reps` advanced). **Added by C10X-27**                     |
  | A retry does not advance the schedule                          | two identical POSTs → `reps` 0→1 (not 2), second answers `200 { alreadyApplied: true }`, row byte-identical                                                                                                                                                                |
  | Only accepted cards enter                                      | a `generated` and a `rejected` sibling never come back from `listDueCards`; rating one is a 404 that writes no schedule row                                                                                                                                                |
  | No cross-account write (extends Risk #1)                       | B rating A's card → 404 and A's row unchanged column-for-column, with A's own successful rate as the positive control                                                                                                                                                      |
  | The batch is bounded by the deck's OWN cap                     | `study.test.ts` cap case: `session_size` set through the endpoint, read back via `getStudyDeck`, and passed to `listDueCards` — never a literal — with 5 due cards against a cap of 3. **Added by C10X-27**                                                                |
  | …and that cap is itself bounded                                | endpoint Zod (`0`, `-1`, `101`, `2.5` → 400, value unchanged on re-read) **and** the DB CHECK `deck_session_size_check` (`23514`, by name), with an in-range positive control. The island's own `SIZE_MIN`/`SIZE_MAX` mirror is NOT covered — see §7. **Added by C10X-27** |
  | Every grade writes what ts-fsrs computes, not just `Good`      | four fresh cards, one per grade, each column-for-column against an oracle from `createEmptyCard` advanced only in memory; plus the lapse case (`Again` from `Review`: `lapses` 0→1, `due`/`stability` strictly below `Good`'s at the same `now`). **Added by C10X-27**     |
  | The batch's composition is deterministic                       | **PARTIAL — read the caveat.** `toEqual` on the batch members pins their ORDER, but not the presence of the `f.id asc` tie-break: removing the clause leaves the suite green (see the breakage runs below)                                                                 |

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

  | Red case                                                                                          | Verdict                                   |
  | ------------------------------------------------------------------------------------------------- | ----------------------------------------- |
  | `returns 404 when B rates a card in A's deck` (`expected 200 to be 404`)                          | **Evidence.** B genuinely rated A's card. |
  | `stops counting a card once its schedule is rated into the future` (`expected undefined to be 1`) | Knock-on.                                 |
  | `never exposes another account's deck` — the **positive control** (`expected undefined to be 1`)  | Knock-on.                                 |

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
  `context/archive/2026-07-26-srs-study-session-test/verification.md`:

  | Neuter                                             | Result                                                                                                                                                      |
  | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `limit p_limit` dropped from `study_due_cards`     | **1 of 22 red** — the cap case, `to have a length of 3 but got 5`                                                                                           |
  | `f.id asc` tie-break **removed**                   | **0 of 22 red — the suite stays fully GREEN**                                                                                                               |
  | `f.id asc` tie-break **reversed** to `f.id desc`   | **1 of 22 red** — same case, on `toEqual`                                                                                                                   |
  | `coalesce(s.due, p_now) <= p_now` dropped          | **1 of 22 red** — the due re-entry case, on its **negative** half (`to not include`)                                                                        |
  | endpoint Zod `min(1).max(SIZE_MAX)` → `z.number()` | **1 of 22 red** — bounds case, `expected 500 to be 400` (the 500 shows the DB CHECK caught what Zod let through, i.e. the layers are genuinely independent) |
  | `deck_session_size_check` dropped                  | **1 of 22 red** — same case, `expected undefined to be '23514'`                                                                                             |

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
  > lets the suite write data the constraint forbids, so the restore can fail _after_
  > the evidence is collected. Inspect the violating rows before repairing, and never
  > assume the `add constraint` succeeded — the `diff` is what caught it.

  **Selective mutation testing on `rateCard` (C10X-27).** First time the study path was
  mutated: `npx stryker run --mutate "src/lib/study.ts:291-350"` (permanent `mutate`
  list untouched) → **56.90% total / 71.74% covered — 33 killed, 13 survived, 12 no
  coverage**. **No assertion was added**; every survivor is classified individually in
  `context/archive/2026-07-26-srs-study-session-test/mutation-register.md`. Two results worth
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
    `learning_steps` was a genuine scheduler _input_ — a cursor the scheduler read, so
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

  Full evidence: `context/archive/2026-07-26-srs-study-session-test/research.md` for the audit that
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
  to the transition function — `ALLOWED_FROM` + `setFlashcardState`, today
  `--mutate "src/lib/flashcards.ts:202-226"`, permanent `mutate` list untouched:
  100% — 12 killed, **0 survived**.

  > **The range in this line was wrong for a day and is now corrected (C10X-28,
  > 2026-07-26).** It read `:181-212`, which is where those two symbols sat when the run
  > was made; `75df78f` moved `setFlashcardState` to `:218` **two hours later**, so the
  > recorded command had since been mutating a different part of the file — and Stryker
  > completes happily on a stale range, reporting a score for code nobody meant to test.
  > The symbols are named beside the numbers deliberately: **re-derive the span before
  > running it** (`grep -n "ALLOWED_FROM\|setFlashcardState" src/lib/flashcards.ts`) rather
  > than trusting either figure. The frozen copy in
  > `context/archive/2026-07-25-candidate-review/mutation-register.md:3` keeps the original
  > range on purpose — it records what was actually run that day. Do not read that as "the
  > gate is well asserted". Reproducing the two gate mutants by hand shows both die on a
  > **malformed query**, not on a behavioural assertion: `.in("state_id", …)` → `""`
  > fails with `PGRST100`, and the `?? []` fallback → `["Stryker was here"]` fails with
  > `22P02` (integer parse). Only **4 of 12** are behavioural — the ones that collapse the
  > allow-list to `[]` while leaving the query valid — and all four break _legal_
  > transitions. **No mutant in this run makes an illegal transition succeed**, because
  > the operator that would has to substitute a string that Postgres rejects. So the
  > direction that actually harms a user (a gate too permissive — a rejected card
  > drifting back into the deck) is carried by deliberate-breakage check 1 below, not by
  > Stryker. Per-mutant record: `context/archive/2026-07-25-candidate-review/mutation-register.md`.

  **Three deliberate-breakage checks, all run, with observed results.**

  > **Denominators below are dated, not current (noted 2026-07-26 by C10X-28).**
  > `candidates.test.ts` held **16** cases when these ran and holds **20** now — C10X-28
  > added the four generation-session audit-column cases, which touch a different table
  > and no `ALLOWED_FROM` path, so the _numerators_ should be unchanged. Neither check has
  > been re-run since. Same rule as everywhere in this file: a split is a claim about a
  > run, so re-run it before citing it.
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

- **Phase 2, second slice (`ai-candidate-generation-test-2`, 2026-07-26)** — Risk #4 is
  **covered, with a boundary this entry states rather than hides**; Risk #6 is **half**
  covered. Three tickets own the work and one branch carried it: **C10X-28** (audit-column
  isolation, the module double, the `console.*` guard, this doc-sync), **C10X-34** (auth error
  copy, the banner gate), **C10X-30** (bounds parity — its source-text half only).

  What the slice found first is why it is not the change its ticket described: the no-leak
  property on `/api/generate` **already held by construction** — 17 of its 18 error returns are
  fixed Polish literals and the 18th is a double ternary over two module-local literals, while
  `err.message` is computed once and routed **only** to the DB column. It was asserted nowhere,
  and it could not be asserted at all with the harness as it stood. So the slice pinned the
  property, and closed the two surfaces where private data genuinely did escape — neither of
  which the risk row names.

  | Claim                                                                                                                                                                             | What proves it                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
  | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | On a failed generation the response body carries **neither** the pasted source text **nor** the upstream error string **nor** the key — while the audit row carries the first two | `tests/generation/failure-path.test.ts`, three cases (502 upstream HTTP, 502 transport, 422). One request each: the **raw** body (not just `error`) is asserted free of both sentinels and of the key, while the row is asserted to hold the source text in `source_text` **and** inside `request_payload`, the upstream string inside `response_payload`, and a non-empty `error_message` — the payload assertions run over the serialised column, so they pin presence, not a JSON path |
  | …and those branches are genuinely reached, not simulated                                                                                                                          | the only module doubled is `astro:env/server` (`OPENROUTER_API_KEY` → a sentinel) plus a pass-through `globalThis.fetch`. `@/lib/openrouter` is **never** doubled, so `OpenRouterError`'s identity, the request build and the audit payloads are production's own. Breakage: remove the seam → **4 of 4 red on `expected 200 to be 502/422`** — without it the request falls through to mock mode and _succeeds_                                                                          |
  | 422's contrast is its own, not 502's with two extra rows                                                                                                                          | on that branch `error_message` is the fixed literal `"Model nie zwrócił poprawnych kart"` — asserted by **equality**, because substituting that literal for the upstream string _is_ the no-leak property here — while the upstream sentinel is asserted inside `response_payload`; both together with `generated_count > 0` and `saved_count = 0`, the pair that separates 422 from 502                                                                                                  |
  | `OPENROUTER_API_KEY` travels in `Authorization` and lands in no audit column                                                                                                      | the same file's key pin: the sentinel **is** in the captured header (the positive control — built by `openrouter.ts`, not by the test), **is not** in the captured request body, and appears in **no** field of the persisted row                                                                                                                                                                                                                                                         |
  | This repo writes no log line at all                                                                                                                                               | `tests/lib/no-logging.test.ts` — a textual scan of the **whole** `src/` tree (`.astro` frontmatter included), with two positive controls: the walker finds >50 files including four named ones, and the regex fires on four spellings of a console call                                                                                                                                                                                                                                   |
  | Account B cannot read A's four private audit columns                                                                                                                              | `tests/review/candidates.test.ts` → "returns none of the four private columns to B, while A reads every one of them": B's select resolves to `null` (absence, §6.4's below-HTTP form of "404, never 403") while A resolves all four with per-run-unique values                                                                                                                                                                                                                            |
  | …nor overwrite or delete the row                                                                                                                                                  | "refuses B's overwrite of the audit columns and leaves A's row byte-identical" (empty `RETURNING`, A re-reads column-for-column) and "refuses B's delete of A's session", with "still lets A rewrite A's own audit columns" as the positive control                                                                                                                                                                                                                                       |
  | A crafted request outside the UI gets a 4xx **and writes nothing**                                                                                                                | `tests/generation/generate.test.ts`, **six** refusal cases covering nine inputs — `sourceText` over the cap (raw, and again when it trims back under it), `count` below/above/non-integer, `language` off the whitelist, malformed `deckPublicId` and malformed `idempotencyKey`, `newDeckName` over 100 — each asserting the status **and** a **status-agnostic** session count, plus a deck count on the one path that could have created a deck                                        |
  | …with a boundary control, so the refusals are not an endpoint refusing everything                                                                                                 | "accepts a sourceText at exactly the limit and stores it whole"                                                                                                                                                                                                                                                                                                                                                                                                                           |
  | The source-text limit has exactly one definition                                                                                                                                  | `src/lib/generation-limits.ts`, imported by `api/generate.ts` **and** `GeneratorForm.tsx` (with `COUNT_MIN`, `COUNT_MAX` and `LANGUAGES`). Breakage: decouple the endpoint's own `.max()` from the shared constant → **exactly 2 of 20 red**, both over-limit cases, both on `expected 200 to be 400`, boundary control green                                                                                                                                                             |
  | No upstream auth string can reach a URL                                                                                                                                           | `tests/auth/errors.test.ts` (**55 cases as of 2026-07-31**; 33 when this row was written — the denominator moved under C10X-30 and again under C10X-34, so read any split quoted against "33" with its own date attached): a mapper keyed on `AuthError.code` with a documented `code → name → status → default` chain, "never lets an input substring reach the output", "has no empty constant in the closed set", and one endpoint case asserting the `?error=` param **equals** a project constant and contains neither the submitted address nor `{`                                                                                                                    |
  | An anonymous visitor is not told whether generation is live                                                                                                                       | **not a test — manual, and named as such.** The gate is per **entry** (`requiresSession` on `ConfigStatus`), applied in `Layout.astro`; the three browser-level checks are recorded in the change's `verification.md`                                                                                                                                                                                                                                                                     |

  **Four traps this slice paid for, so the next contributor does not.**
  - **Never scope a PostgREST filter by a long body.** `.eq("source_text", <a 10 000-char
string>)` answers **`414 URI too long`** — PostgREST carries filters in the query string and
    Kong caps the request line at ~8 KB. Measured against this stack: `n=8000` through,
    `n=10000` and `n=10001` → 414. That is exactly the over-limit case and its boundary control,
    so the oracle would have gone red for a reason unrelated to the behaviour. Scope by a short
    `<suffix>-<case>` marker in the first characters of every `sourceText` and query
    `.like("<marker>%")`. `succeededSessions` carried the same latent defect and was widened in
    the same edit.
  - **A status-filtered count is an argument, not an assertion.** `succeededSessions` filters
    `status = 'succeeded'`, so it is blind to the `failed` rows the 502/422 paths write. The
    bounds cases assert against a status-agnostic count instead; it happens to be sound either
    way today (every input-contract rejection returns before the first DB statement), which is
    precisely why the defect was invisible.
  - **On `generation_session`, neutering a write policy alone proves nothing.** With
    `generation_session_update` wide open the suite stays **20/20 green**: Postgres applies the
    **SELECT** policy to an UPDATE whose `WHERE` reads a column, so the restrictive select hides
    the row and the write matches nothing. Neuter select **with** the write policy. Same trap
    §6.8 records for S-05, one table over. Observed splits, from a `db`-live run: select alone →
    **2 of 20 red**; select + update → **3 of 20**; select + delete → **4 of 20** (the fourth
    being the positive control as a second-order knock-on). Restore verified by a `pg_policies`
    before/after dump, **diff empty**.
  - **A breakage check can come back green and be recorded as evidence for a claim it never
    tested.** The plan's own check for Phase 5 — "make the 502 body interpolate `err.message`" —
    **passes** against the HTTP-failure case, because there `err.message` is
    `"OpenRouter HTTP <status>"`, a string carrying nothing private. A fourth test case (a
    **transport** failure, where the upstream string _is_ `err.message`) was added rather than
    the check weakened; it then goes **1 of 4 red**, and a variant interpolating the source text
    goes **2 of 4**. Check what your check would observe before you trust its green.

  **What this does NOT prove — read this before citing Risk #4 as closed.**
  - **The dependency-emitted log lines.** They are inside Risk #4's scope and are **not owned
    here**: `@supabase/ssr/…/cookies.js:22,29` and `@supabase/auth-js/…/fetch.js:110` reach
    Workers Logs via `wrangler.jsonc`'s `observability`. They were measured and carry
    session/transport material — on `fetch.js:110` a fetch `TypeError`, not the request `init` —
    never pasted text. Pinning `node_modules` internals would break on every patch bump with no
    user-visible cause. **Nothing in this suite reads a real log sink**; the log half is a
    source-tree guard over first-party code, nothing more.
  - **The client-bundle half of the key question.** Closed by construction at three independent
    layers (`astro:env`'s `ServerOnlyModule` throw at build, the `_internalGetSecret`
    indirection, the key absent from CI) and deliberately recorded rather than re-tested.
  - **The provider contract.** The upstream shapes are fabricated by the fetch double, so a
    change to the prompt, the model or the real response format is invisible here. That is §3
    Phase 5's job, unchanged.
  - **The success path's audit columns.** Only the two failure branches are asserted.
  - **Anything an island renders**, as always (§7): `GeneratorForm`'s `maxLength`, `min`/`max`,
    `<select>` and char counter, and the banner gate itself, rest on the manual checks in the
    change's `verification.md`. Single-sourcing buys that the two ends cannot disagree about the
    **value**; that each end still enforces it is one assertion here and one pair of human eyes
    there.
  - **The card-content half of Risk #6** — the `FRONT_MAX`/`BACK_MAX` endpoints, excluded on
    purpose (they already share one constant with their islands). It is the single thing between
    §3 Phase 2 and `complete`.
    > **Closed 2026-07-28 by C10X-30** (`server-side-validation-test`), which flipped §3 Phase 2
    > to `complete`. Two of this bullet's own words did not survive the work: the exclusion's
    > reason ("they already share one constant with their islands") was true and still left the
    > constants with no enforcer beneath the app — a DB CHECK is now that second layer — and the
    > refusal these endpoints answer with is a **`302`**, not the `4xx` the entry above assumes
    > throughout. See §6.10 and this section's C10X-30 entry.
  - **The 502/422 error copy.** `error_message`'s wording on the 502 path is asserted non-empty,
    not pinned; the only copy assertion in the file is 422's literal, and it is there because
    substituting it for the upstream string **is** the no-leak property on that branch.

  Full evidence — every breakage edit, its observed failure string, its red/green split with the
  denominator, and each verified restore:
  `context/changes/ai-candidate-generation-test-2/verification.md` (after archiving:
  `context/archive/<date>-ai-candidate-generation-test-2/verification.md`). Before adding a
  module double of your own, read **§6.9** — it exists because of this slice and says where the
  seam may and may not go.

- **Phase 3 (`schema-drift-test`, C10X-29, 2026-07-28)** — Risk #5 is **covered for the drift
  classes named in §2's row, and this entry is about the GATE**, so its "does not prove" list
  below is a range (everything the history oracle cannot see) rather than a per-class coverage
  claim. The two are written to agree: §2 says which classes the project is protected against,
  this entry says what the gate itself observes. If they ever read as contradicting each other,
  §2's row is the coverage claim and this one is the mechanism.

  The gate is a **history oracle**: it compares the repository's migration **versions** against
  the cloud's `supabase_migrations.schema_migrations`, and never compares contents. Deliberate —
  the incident behind this risk was a `migration repair` desync over a byte-identical schema.

  | Claim                                                                             | What proves it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
  | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | The comparator distinguishes the two drift directions rather than collapsing them | `tests/lib/schema-drift.test.ts`, **12 cases**: a local version absent remotely → `missingRemote` only; a cloud version with no local file → `missingLocal` only; both at once → **both**, not whichever it found first                                                                                                                                                                                                                                                                                                                             |
  | …and is not a function that simply rejects everything                             | the **positive control** — identical sets → clean. Load-bearing: without it every failure assertion in the file is satisfied by a comparator that fails on all input                                                                                                                                                                                                                                                                                                                                                                                |
  | The comparison is set-based, so this repository is not "drifted" today            | the real out-of-order pair (`20260712162349` applied _after_ the later `20260712162359`) asserted clean. An order-based comparator would call `main` drifted as it stands                                                                                                                                                                                                                                                                                                                                                                           |
  | An empty remote set is drift, not a pass                                          | fresh-or-wrong-project case → every local version in `missingRemote`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
  | A malformed filename is surfaced, never silently dropped                          | the extractor returns a miss rather than throwing; a non-`.sql` entry is ignored, a `.sql` file with no leading timestamp is reported (extension matched case-**insensitively**, so `_x.SQL` lands here rather than being skipped). The runner prints it as its **own section with a different remedy** — `db push` cannot repair a filename                                                                                                                                                                                                        |
  | Two local files claiming one version are drift, not a clean run                   | **Added by this change's impl-review (F1), which found the opposite.** `schema_migrations.version` is the cloud's key, so a collision means at most ONE file can ever be recorded as applied — the other is committed and never applied, i.e. drift class 1. The `Set` that makes the comparison correctly order-blind was swallowing it, and the verdict read `clean`: measured, `{local:[a.sql,b.sql same stamp], remote:[stamp]} → clean:true`. Now a `duplicate` list folded into `clean`, with its own report section whose remedy is a rename |
  | The cloud's own version strings are held to the local side's shape                | **Added by impl-review (F6).** Remote versions are trimmed and must match `/^\d{14}$/`, else `GATE UNAVAILABLE`. Previously any string was accepted, so a trailing space or BOM printed the _same_ migration in `missingRemote` **and** `missingLocal` as two visually identical entries — sending the reader to `db push` and the `repair` runbook at once — and `""` printed a blank bullet                                                                                                                                                       |
  | The gate blocks the **deploy**, which is the claim the change exists to make      | a **paired** rehearsal on the feature branch, not a single run — see the breakage table below. Asserting the script's exit code would not have carried this: `needs: [ci, drift]` does                                                                                                                                                                                                                                                                                                                                                              |
  | Every non-success path fails closed, and says which kind of failure it is         | three paths exercised live — no token, no ref, and a real `401` round trip — each exiting **1** and printing `GATE UNAVAILABLE` (as opposed to `DRIFT`), so a red build separates "the schema is drifted" from "the gate could not find out" in the report while both still block                                                                                                                                                                                                                                                                   |
  | The secret stored in GitHub is the working credential                             | the control run's `drift` job reproduced `10 local entries against 10 applied cloud migrations` from inside CI, using the secret and nothing else. Phase 1 could not establish this from a developer machine — the API lists secret _names_, never values                                                                                                                                                                                                                                                                                           |
  | No credential reaches the log                                                     | both `drift` job logs downloaded in full: zero hits for `sbp_`, zero for `bearer`, zero for the project ref in clear. Masking is not the claim — the script never puts the token in a message                                                                                                                                                                                                                                                                                                                                                       |
  | A stale `src/db/database.types.ts` fails CI                                       | the `Check generated types against the schema` step, and the **staged** variant of its breakage check (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                   |

  **Deliberate-breakage checks, all run, with the splits as observed.**

  | Neuter                                                                                | Result                                                                                                                                                                                                                                                                                                                                               |
  | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `missingLocal` forced to `[]` — the `repair`-desync direction reported as clean       | **2 of 11 red**, both on `expected [] to deeply equal [ '20260601120000' ]`. The plan predicted **1**; the second red is the both-directions-at-once case, which asserts the same field by construction and is what stops the two directions collapsing into one. Positive control green. Recorded as observed rather than rounded to the prediction |
  | The rehearsal **pair** — same ref, same guards, one variable: a fabricated migration  | control run: `ci` success, `drift` **success**, `deploy` **success** (its wrangler step swapped for an `echo` marker). Gate run: `drift` **failure**, `deploy` **skipped**. Conclusions read from `gh run view --json jobs`, not from the UI's colours                                                                                               |
  | Criterion 4.4 **as worded** — hand-edit a line of `database.types.ts`, nothing staged | **green — the criterion as written does not go red.** `npm run db:types` overwrites the working tree before `git diff` runs, and `git diff --exit-code <path>` compares against the **index**, not `HEAD`                                                                                                                                            |
  | The same edit, then `git add`                                                         | **red**, printing the hunk. This is what CI actually does: after `actions/checkout` the index equals `HEAD`, so the step's real claim is "**regenerated ≠ committed**" — provokable only by bad content that is _committed_, never by a dirty working tree                                                                                           |
  | The DDL workflow's password guard, probed three ways                                  | all three secrets set → exit **0**; `SUPABASE_DB_PASSWORD` empty → exit **1** with its own message; `SUPABASE_PROJECT_ID` empty → exit **1** with its own. The all-set control is the point: a guard that fails on everything and one that fails on the right thing are indistinguishable without it                                                 |

  **Why the rehearsal had to be a pair, and it generalises.** The plan asked for one run —
  widen the `drift` job's `if`, push a fabricated migration, record `drift` red and `deploy`
  skipped. That run would have been **unfalsifiable**: `deploy` carries its own
  `github.ref == 'refs/heads/main'` guard, so on a feature branch it is skipped _whatever_
  `drift` does, and the skip produced by the branch guard would have read as a skip produced
  by `needs`. This is the same shape §6.6 has now recorded three times (the four-policy
  neuter that passed while the guard was disabled; the status-filtered count blind to the rows
  it claimed to check). The fix was a positive control: `deploy`'s guard widened alongside
  `drift`'s so the two runs differ in exactly one thing. All four temporary edits were
  reverted and the revert **verified** — `md5sum` against a pristine copy taken before the
  first edit, the fabricated file deleted, a tree-wide `grep` for the marker clean, and the two
  rehearsal commits dropped so the branch reaching the PR carries neither.

  **What this does NOT prove — read this before citing Risk #5 as closed.**
  - **No test in this suite touches the cloud, and none ever will.** `npm test` covers the
    comparator (12 cases) and nothing else; `scripts/check-schema-drift.ts` has **no unit test
    and deliberately gets none**, because every branch in it is I/O against a live account
    credential — exactly what `tests/setup/preflight.ts` exists to abort (§6.4). The wiring is
    carried by the recorded live runs and by the CI job itself, never by an assertion. Do not
    read "Phase 3 complete" as "the suite tests the Management API".
  - **The gate compares versions, never contents.** Three drift classes are invisible to it by
    construction, and naming them is the point: a **migration file amended in place after it
    was pushed** (which `/ship` makes reachable, since `db push` runs from the feature branch
    before the merge — mechanism live, no observed instance here), **production changed by hand
    in Studio** (the channel exists: `supabase/snippets/` is gitignored), and
    **`repair --status applied` on something never applied**, where the history table lies by
    construction so no history oracle can help. All three need the on-demand DDL diff, which
    nobody is scheduled to run.
  - **Two classes have no check anywhere**: `supabase/config.toml` versus the cloud dashboard
    (`max_rows`, `jwt_expiry`, `site_url` — local-only values whose cloud equivalents live in
    the dashboard and need `supabase config push`), and **seed/dictionary row drift** (migra
    diffs schema, not rows). Out of the agreed scope, not overlooked.
  - **Stale generated types are invisible to THIS gate too.** The `drift` job never reads
    `src/db/database.types.ts`; that class is closed by a separate step in the `ci` job, which
    is a different job with a different trigger — so "the drift gate is green" says nothing
    about the types. And what that step asserts is "**regenerated ≠ committed**": see the 4.4
    rows above, where a dirty working tree provably cannot provoke it. Correct behaviour, not
    a hole, but it means the two checks are independent and neither backs up the other.
  - **The `db diff --linked` path WAS unexercised until the merge, and is now covered.**
    Until `schema-diff.yml` reached the default branch it could not be dispatched at all —
    measured, not inferred: the file pushed to a throwaway ref did not register in
    `gh workflow list` and a dispatch answered
    `HTTP 404: workflow schema-diff.yml not found on the default branch`. That is a permanent
    property of `workflow_dispatch` and the reason most of Phase 5 is ship-time work; there is
    **no honest workaround**, because adding a `push:` trigger to manufacture a run would
    change the trigger set whose exclusivity criterion 5.2 asserts. **Closed at ship time
    (2026-07-28)**: three real dispatches — two green from `main` (30380427876, 30380687338,
    matching, which is the calibration baseline) and one red from a scratch branch carrying a
    column-adding migration (30381750723). So link, Docker, the shadow replay against
    production and the database password are all now exercised, in both directions, with the
    green pair as the control. Detail in the change's `verification.md`.
  - **The calibration baseline is EMPTY, which is not what the plan expected.** It warned that
    migra reports false positives on extensions and grants and that an uncalibrated first run
    would look like drift. On this project it does not: both green runs printed
    `No difference between the deployed schema and a replay of the migrations.` with a
    zero-byte diff. There is no noise filter because none was needed — so if a future run is
    non-empty, treat **every** line as a candidate for real drift rather than hunting for the
    known-noise list that this entry would otherwise have carried.
  - **The `429` retry has never fired.** The endpoint defines the status; provoking one would
    mean hammering the real API. Carried by reading.
  - **The endpoint the gate depends on is documented as partner-only.**
    `GET /v1/projects/{ref}/database/migrations` is marked available to selected partner OAuth
    apps and answers **200** to a plain PAT anyway. That is a documented restriction that
    happens not to be enforced — a weaker guarantee than a documented contract. If it is ever
    enforced the gate fails closed (correctly) and the fallback is
    `POST /v1/projects/{ref}/database/query`, measured at the same time and answering **201**,
    which is why the runner branches on `res.ok` and never on `status === 200`.

  Full evidence — every probe, breakage edit, observed failure string, red/green split with its
  denominator, and each verified revert:
  `context/changes/schema-drift-test/verification.md` (after archiving:
  `context/archive/<date>-schema-drift-test/verification.md`). The nine drift classes are
  enumerated once, with their mechanisms and which oracle sees each, in that change's
  `research.md`.

- **Phase 2, third slice (`server-side-validation-test`, C10X-30, 2026-07-28)** — Risk #6's
  **card-content** half is covered on the server, which closes §3 Phase 2. The entry states
  its boundary in the same breath: **the server half is asserted, the island half is not**,
  and on these endpoints the refusal is a `302`, not the `4xx` five documents said it was.

  Two things about the shape of the work, because neither was visible when C10X-28 scoped
  this as "one named test". The validation logic in `src/` **was already correct** — four
  lines on two endpoints, refusing before any write — so the slice's job was to make it
  observable and to give it something underneath: `FRONT_MAX`/`BACK_MAX` had **no enforcer
  below the app**, the residual risk S-02 recorded on 2026-07-09. And the same four form
  endpoints carried three genuine "server trusts the client" defects that a test of the
  length rule alone would have walked straight past.

  | Claim                                                                                             | What proves it                                                                                                                                                                                                                                                                                    |
  | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | An over-`FRONT_MAX`/`BACK_MAX` **create** is refused and writes nothing                           | `tests/validation/cards.test.ts`, two cases: a state- and status-agnostic count scoped by `deck_id` asserted **first**, then `302`, then the decoded `error` **equal** to the project literal. The count-first order is what makes the breakage pair separable — see below                        |
  | …and the same on **edit**, where a count would prove nothing                                      | the edit case's oracle is the **row**, `toEqual(before)` column for column (an over-max edit is an UPDATE, which leaves any count untouched however badly it goes), for both `front` and `back`, each with its own literal                                                                        |
  | …and the refusals are not an endpoint refusing everything                                         | **three** boundary controls: create at exactly 200/1000, edit at exactly 200/1000, and a re-read asserting the stored strings are the submitted ones — length **and** equality, because a silent truncation to the bound satisfies a length check alone                                          |
  | The lower bound is one indistinguishable refusal                                                  | missing, empty and whitespace-only `front` — three sub-cases, same message, no write. They measure 0 after the trim, so telling them apart from outside is not a property the endpoint has                                                                                                       |
  | The trim direction is the **mirror** of `/api/generate`, not a copy of it                         | a 200-character front padded with trailing whitespace is **accepted** and stored at exactly 200. These endpoints `.trim()` before measuring; `/api/generate` caps the raw string. C10X-28's "trims back under it → still refused" does not transfer                                              |
  | A refusal does not echo the submitted content back                                                | the **raw** `Location` (before decoding — percent-encoding would hide a marker from a decoded read) contains neither the case marker nor the run suffix, and the decoded `error` is one of the two project literals                                                                              |
  | A body that is not a form at all is an owned redirect, not a framework `500`                      | one case per endpoint. On create the `Location` carries `open=create-card` and `Nie udało się utworzyć fiszki`; on edit it carries `edit=<cardPublicId>` and `Nie udało się zapisać zmian` — the **unscoped** fallback, which is the ordering constraint below made assertable                    |
  | A `File` part does not crash the handler                                                          | a multipart `front` of type `File` reads as empty and falls into the length guard the endpoint already owns — the existing Polish message, no new copy                                                                                                                                           |
  | The database refuses the same content **independently of the endpoint**                           | direct RLS-scoped inserts (around the endpoint, never around the lock): 201-character `front` and 1001-character `back` each `23514`, asserted by **code** as `deck_session_size_check` is in `study.test.ts`, with an in-range insert as the positive control                                   |
  | `/cards/batch`'s `IDS_MAX` is bounded on the server — the **only** place it is bounded          | `candidates.test.ts`: 101 **distinct, well-formed** UUIDs → `400`, JSON content type, and the one real card in that body `toEqual(before)`. Distinct on purpose — the endpoint's dedupe runs after the schema, so 101 repeats of one id would be refused for a different reason and prove less. Unlike the length limits this bound is **not** single-sourced: `CandidateReviewWorkspace.tsx:27` mirrors it as a commented copy (`BATCH_MAX = 100`, chunk size) rather than an import, so the two can drift silently and the server assertion is the whole guard |
  | The two auth routes answer their own copy on a malformed body                                     | `errors.test.ts`, two cases: a non-form body and a `File` `email` part → `302` to `/auth/signin` with `error` **equal** to `AUTH_VALIDATION_MESSAGE`, and the crafted address not echoed. The `File` case also asserts `not.toBe(AUTH_GENERIC_MESSAGE)` — measured: posted verbatim, GoTrue's reply maps to the catch-all, i.e. no reason at all |

  **The breakage PAIR, and why one run could not have done it.** Run 1 decoupled the
  endpoint's comparison (`> FRONT_MAX` → a literal `> 100000`, never raising the shared
  constant, which the endpoint, three islands, `openrouter.ts` **and the test** all import).
  **2 of 12 red**, the predicted {case 1, case 8}, both on the message equality. Run 2 kept
  that edit and additionally dropped `flashcard_front_check` against the live local DB:
  **3 of 12 red**, {case 1, case 8, case 11}. Case 1 is red in both runs **and for different
  reasons** — run 1 on the message with its count **passing** (that pass is the evidence the
  CHECK absorbed the write), run 2 on that same count. The difference in failure string is
  the proof, not the reds; with the message asserted first, run 2 would have printed run 1's
  string verbatim and the pair would have separated nothing.

  Four things this slice paid for, so the next contributor does not:
  - **A `302` refusal and a `302` success are the same status**, so a status assertion is
    worthless alone and `toContain("error=")` is worse than useless: under run 1 the
    endpoint still answered `302` with an `error=` param — a different one, from its generic
    failure branch. Only an **equality** assertion went red. This is now §6.10.
  - **The helper your need points at is the wrong one.** "Count this deck's cards" lands on
    `countFlashcards` (`flashcards.ts:167-173`), which filters `state_id = STATE_ACCEPTED`;
    `listFlashcards` (`:76-83`) carries the same filter. A card written in any other state is
    invisible to both, so "count unchanged" reads green over a real write. Same class as
    C10X-28's status-filtered count, one layer down.
  - **Restoring a dropped CHECK is not symmetric with restoring a function.** The suite
    persisted three rows the constraint forbids while it was absent — all carrying the run's
    own suffix, all in the run's own decks — so `add constraint` fails with
    `violated by some row` until they are deleted. Inspect, repair, re-add, then `diff` the
    `pg_get_constraintdef` before/after. And know what that diff does **not** establish: it
    is a text match, identical for a constraint that came back `NOT VALID`. Probed
    behaviourally as well, in a rolled-back transaction, with an in-range insert as the
    positive control.
  - **The `-i` echo is not the strongest evidence that a `psql` drop applied.** psql echoing
    `ALTER TABLE` and the `pg_constraint` re-read come from the same session that issued the
    command. The independent corroboration is **case 11's red in run 2**, reachable only if
    the constraint was genuinely absent when the suite ran in a different process over
    PostgREST. A silently no-opped heredoc — §6.6's recorded failure mode — would have left
    it green.

  **What this does NOT prove — read this before citing Risk #6 as closed.**
  - **The two deck-form endpoints, which were missed entirely** (impl-review F1, 2026-07-28).
    `decks/index.ts:22-23` and `decks/[publicId].ts:31-32` still read `formData()` unguarded
    and still carry `((form.get("name") as string | null) ?? "").trim()`, so a crafted
    non-form body answers an uncontrolled framework `500` and a `File` `name` part crashes
    the handler — the exact two defects this slice fixed one directory over. There are
    **six** `formData()` readers in `src/pages/api/`, not four; the plan's Current State
    enumerated four and nothing in "What We're NOT Doing" excluded the other two, so this is
    an incomplete sweep rather than a scoped exclusion. They have a 1–100 name rule and a DB
    CHECK (`init_core_schema.sql:45`) already, so §6.10's breakage-pair design transfers to
    them unchanged. Deferred by decision at impl-review triage and raised as **C10X-37**.
  - **The island half.** The three card islands import the same constants, so the two ends
    cannot disagree about the **value**; that each end still enforces it is a separate claim
    and only the server half is asserted. And these islands differ from `GeneratorForm` in a
    way that matters: they carry **no `maxLength`**, so their over-length branch is genuinely
    reachable through the browser rather than being a second belt behind an input stop (§7).
    It rests on the manual checks in the change's `verification.md`.
  - **The cloud's data.** The pre-`db push` row check ran read-only against production and
    found `bad_front`/`bad_back` both 0 over 38 rows — a point-in-time observation recorded
    in `verification.md`, not a gate. The migration itself is pushed by `/ship`, and the
    `drift` gate (C10X-29) is what enforces that a committed migration reached the cloud.
  - **The generation write path's own bounds.** `insertCandidates` stays unvalidated at the
    insert site; its content bound is still `openrouter.ts`'s Zod schema. The new CHECK is a
    free backstop there with one consequence recorded rather than guarded against: a
    single over-length card would now fail the **whole batch**, not just itself.
  - **Auth input rules.** Nothing here asserts presence, format or length of credentials —
    those routes still call GoTrue with whatever they were given. That is **C10X-36**
    (`auth-input-validation`), deliberately left open; the test file says so in a comment so
    a green run of that `describe` cannot be read as "auth input is validated".
  - **`PATCH`.** Neither card endpoint exports a `PATCH` handler. The five documents that
    said "POST/PATCH" were wrong; they are corrected here and, as a dated correction line,
    in C10X-28's archived `change.md`.

  Full evidence — the cloud probe, every breakage edit, its observed failure string, its
  red/green split with the denominator, the constraint-definition diffs and the verified
  restores: `context/changes/server-side-validation-test/verification.md` (after archiving:
  `context/archive/<date>-server-side-validation-test/verification.md`).

- **Phase 5 (`ai-candidate-generation-test-3`, C10X-31, 2026-07-29)** — Risk #7 is **covered
  as far as a proxy can cover it, and the boundary belongs in the same sentence: the judge
  measures language fidelity and usability, never the 75% acceptance rate — only real users
  produce that metric.** This is the project's first AI-native layer and it is NOT part of
  `npm test`: `npm run eval` (= `vitest run -c vitest.eval.config.ts`, `OPENROUTER_API_KEY`
  in the shell environment) runs a 10-case language matrix through the production
  `generateCandidates()` against the real provider and exits with the verdict's code.
  Exclusion from the ordinary suite is structural — the second config's `include` collects
  only `evals/**/*.eval.ts`, so `npm test` sees zero eval files while `vitest.config.ts`
  and `tests/setup/preflight.ts` stay byte-identical — and the eval's own preflight is the
  INVERSE of the main one: it fails when the key is ABSENT on either seam
  (`astro:env/server`, the generator's; `process.env`, the judge's), because with no key
  `generateCandidates()` silently returns fixed Polish mock strings and a PL fidelity case
  would pass vacuously.

  The matrix: cases 1–5 run `language: "auto"` over authored reference texts in
  PL/EN/ES/DE/FR (`evals/fixtures/reference-texts.ts` — distinct topics, so a
  cross-language contamination in a verdict is attributable); cases 6–10 force each
  whitelist language over the fixed PL text. Case 6 (`polski`×PL) is the identity positive
  control. Judge: `google/gemini-2.5-flash` via OpenRouter, `temperature: 0`, one card per
  call, `EVAL_JUDGE_MODEL` override — a different model family from the generator's
  `openai/gpt-4o-mini`, so the generator never grades itself. Structured outputs
  (`response_format: json_schema`) SHIPPED as the judge request shape — the documented
  fallback was never needed. Thresholds, kept unchanged by the calibration decision:
  language fidelity 100% per case (hard), usability ≥80% aggregate; floors: ≥1 card per
  case, aggregate skip-rate <50%. Count compliance and skip-rate are REPORTED, never
  gated — a first measurement cannot be a blindly-tuned gate.

  | Claim                                                                | What proves it                                                                                                                                                                                                                                                                                                                                                              |
  | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `auto` produces cards in the source language, all five languages     | cases 1–5: 25/25 cards `language_ok` in every complete run of the calibration day (four runs)                                                                                                                                                                                                                                                                               |
  | The forced path is PARTIALLY broken — the first real finding         | `forced/niemiecki` and `forced/francuski`: **0/5 cards in the target language, every card Polish, four of four runs**; `forced/hiszpański` intermittent (4/5 in four runs — one mixed card — 5/5 once). Mechanism visible in the cards: the prompt says `Write the flashcards in this language: niemiecki.` — a Polish exonym in an English sentence (`src/lib/openrouter.ts:98-111`) |
  | "Generation broken" is separable from "the eval refuses everything"  | case 6 (`polski`×PL, the identity positive control) and `forced/angielski` stayed green in every run while de/fr stayed red                                                                                                                                                                                                                                                  |
  | The judge observes the EXPECTATION, not an incidental pass           | breakage check, judge leg: `auto/en`'s `expectedLanguage` → `niemiecki` turned **exactly that case** additionally red (`5/5 cards not in niemiecki (detected: English)`); every other case identical to baseline; reverted, diff clean                                                                                                                                     |
  | The run-level floor is what fires, not a per-case assertion          | breakage check, floor leg: `SKIP_RATE_CEILING` → `0` → the `afterAll` run-level assertion failed with the floor's own message; reverted, `npm test` 219/219 re-proved the restored semantics deterministically                                                                                                                                                              |
  | The judge grades correctly on both prompt paths                      | spot-checks against a human read (recorded): the mixed card (ES front, PL back) → `language_ok=false, usable=false`; a grounding violation (an answer not in the source text) → `usable=false` — the rubric bites for real                                                                                                                                                   |
  | Threshold/floor semantics are deterministic facts, not judge opinion | `tests/lib/eval-scoring.test.ts` in the ordinary suite (12 cases): the 80% usability boundary, one-bad-card language fail, empty-list floor, 50% skip-rate edge, and the all-good positive control                                                                                                                                                                           |
  | The success-path audit columns persist (the C10X-28 hand-off gap)    | `tests/generation/generate.test.ts` "records the five audit columns…": mock-mode POST, then `status`, `source_text` by EQUALITY, `model` ending `" (mock)"`, `language`, the three counters, and serialized-column CONTAINMENT on `request_payload`/`response_payload` (the C10X-28 precedent: pin presence, not shape)                                                     |
  | Count compliance and skip-rate exist as numbers for the first time   | measured across the calibration day: count compliance 50/50 (100%), skip-rate 0% — the generator's Zod layer dropped nothing. First data for the trigger condition of the S-04 plan-review F5 lever (the 1-shot corrective re-call)                                                                                                                                          |

  Operational facts a future runner needs: one full run ≈ **$0.012** (10 generations + ~50
  judge calls; the whole six-run calibration day stayed under ~$0.10), wall-clock 117–312 s
  observed. The calibration rule: **a red case is re-run once by hand before being
  believed — two reds = real.** Two judge-client adaptations were measured before being
  written: `reasoning: { enabled: false }` (gemini-2.5-flash's thinking tokens drew from
  `max_tokens` and truncated verdicts mid-key; raising the budget did not help), and a
  truncated verdict body (HTTP 200, `finish_reason: "error"`, ~10% of calls, in bursts) is
  a TRANSIENT class retried twice with growing backoff — every other parse/HTTP error still
  throws loudly, because an unreachable judge must never read as a verdict.

  **What this does NOT prove — read this before citing Risk #7 as closed.**
  - **The 75% acceptance rate.** The judge is a proxy for quality; the product metric is
    produced by real users on the review screen, and nothing here measures it.
  - **The finding is FOUND, not fixed.** The forced-language defect ships in production
    today; fixing the prompt (candidate: name the target language in English or natively —
    `German`/`Deutsch`) is its own follow-up, with this eval as the acceptance check.
  - **No CI leg.** The `workflow_dispatch` leg (schema-diff.yml idiom, per-step secrets, a
    separate OpenRouter key with a low credit limit) was deliberately deferred at
    planning — local-only, human-triggered, no schedule, same rule as the DDL diff (§5).
    To be ticketed via `/jira-backlog-sync`; named in roadmap H-06's row.
  - **One run per case, no statistical power.** A single green is one sample at
    temperature 0.4; the re-run-once calibration rule is the mitigation, not a fix.
  - **Judge verdicts are themselves an LLM's opinion**, calibrated once by hand (the
    spot-checks above). `EVAL_JUDGE_MODEL` exists precisely so a suspect verdict can be
    cross-examined with a different judge.
  - **`npm test` still never touches the real provider** — unchanged, by design. The eval
    is the only thing that does, and only when a human runs it.

  Full evidence — the run table verbatim, both judge adaptations with their measurements,
  both breakage checks with observed failure strings, and the calibration decision:
  `context/changes/ai-candidate-generation-test-3/verification.md` (after archiving:
  `context/archive/<date>-ai-candidate-generation-test-3/verification.md`).

- **Roadmap slice H-03 (`auth-error-copy`, C10X-34, 2026-07-31)** — not a §3 rollout phase. It
  is recorded here because it closes the **read** end of the `?error=` channel C10X-28 opened
  (Risk #4's auth half), gives the OpenRouter banner gate its first automated coverage, and
  because it is the change that ended this file's own denominator rot. Its framing is unusual
  and worth carrying: **the deliverable it was ticketed for was already on `main`**, shipped as
  side work under a foreign ticket key (C10X-28's Phase 1 and Phase 4 §1, every commit scoped
  `(C10X-28)`). So this slice audited what landed "along the way" and fixed the edges — which is
  where the interesting findings were.

  | Claim                                                                              | What proves it                                                                                                                                                                                                                                                                              |
  | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | The most common ordinary auth error stops reading as the catch-all                 | `tests/auth/errors.test.ts`: `anonymous_provider_disabled` → `AUTH_MISSING_CREDENTIALS_MESSAGE` as a pure row **and** through the real `/api/auth/signup` route (the File-part case, re-pointed from `AUTH_GENERIC_MESSAGE`). GoTrue reads an empty address on `/signup` as an anonymous sign-in attempt — measured, and the two routes answer **different** codes for the same input |
  | The catch-all's "Spróbuj ponownie" no longer survives where a retry cannot work     | four new constants behind `email_address_not_authorized`, `email_provider_disabled`, `captcha_failed`, `conflict` (plus `request_timeout` reusing the network copy). **Retry semantics, not wording, is the property** — and five of the six are INFERENCE, see the does-NOT-prove list      |
  | The `name` rung is observed on `name` **alone**                                     | the case titled so now feeds `status: 0` (what auth-js's `fetch.js` passes for a real transport failure) instead of `503`, which reached the same constant through `messageByStatus`. Two rungs, two inputs                                                                                 |
  | `signup.ts`'s malformed-body discriminator is covered on **both** branches          | a body announced `multipart/form-data` with a boundary it does not contain → `AUTH_GENERIC_MESSAGE` by equality plus `not.toBe(AUTH_VALIDATION_MESSAGE)`. Costs no GoTrue budget: it returns before `createClient`                                                                          |
  | The closed set is enforced where a message is **consumed**, not only produced       | `ownedAuthMessage` (`src/lib/auth-errors.ts`) — membership by EQUALITY, `null` on anything else, so a crafted `?error=` degrades to **no banner**. Four cases including a value that CONTAINS a real message and a one-character truncation, plus the whole-set positive control            |
  | The banner gate's decision is per **entry**, not per block                          | `tests/lib/config-status.test.ts` (6 cases) over the extracted `visibleConfigStatuses`. Entries are **fabricated**; the real `missingConfigs` appears in no assertion, because it is import-time env and under the runner can only ever describe the local stack                             |
  | …and the self-hiding Supabase invariant is the one that matters                     | a `requiresSession: false` entry shown in **both** session states, and a mixed list signed-out returning only the ungated entry. That is the case a block-level gate breaks — see check F                                                                                                    |
  | `src/` reads no build-time env                                                      | `tests/lib/no-env-access.test.ts` — a textual scan of the whole tree with two positive controls (the walker reaches >50 files; the patterns fire on six spellings while staying silent on `import.meta.url`). Same first-party-guard shape as `no-logging.test.ts`                          |
  | The auth error surface announces itself and its fields carry their errors           | **not a test — manual, and named as such.** `role="alert"` on `ServerError`; `aria-invalid` + `aria-describedby` on `FormField` only while an error is present; `autocomplete` on all six credential fields. Observed as DOM facts in a browser, asserted nowhere (§7)                      |

  **Six deliberate-breakage checks, all run, splits as observed.** Denominators move phase by
  phase in this change (38 → 50 → 51 → 55 in `errors.test.ts`), so every row carries its own.

  | Neuter                                                                | Result                                                                                                                                                                                                                             |
  | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | A — remove the `anonymous_provider_disabled` map entry                | **2 of 50 red**, identical string on both: the pure row **and** the real-route signup case. The endpoint red is the load-bearing one — it shows the code arrives from upstream rather than that the table agrees with itself         |
  | B — repoint `captcha_failed` at `AUTH_GENERIC_MESSAGE`                | **1 red** (filtered run, denominator 50) on its mapping row — and `keeps the distinct code classes distinct` **stayed GREEN**, which is how the false comment on that case was found                                                |
  | C — delete `AuthRetryableFetchError` from `MESSAGE_BY_NAME`           | **0 of 50 red against the test as it stood**, then **1 of 50** after one input changed. The pair is the deliverable: the first row is the finding, the second is the same neuter made catchable                                     |
  | D — collapse `signup.ts:19` to always `AUTH_VALIDATION_MESSAGE`       | **1 of 51 red** on the new case while the already-covered non-form case stayed green. The route still answered `302` to `/auth/signup?` still carrying `error=` — only the **equality** went red (§6.10 confirmed by measurement)   |
  | E — make `ownedAuthMessage` return its input unchanged                | **2 of 55 red** (the plan predicted 1; the second is the empty-string half, recorded as observed). **What stayed green is the evidence**: the member case and the whole-set positive control, without which `() => null` reads as perfect protection |
  | F — gate the whole banner block when signed out                       | **2 of 6 red**, both on the ungated entry signed out; both `requiresSession: true` cases and the signed-in control stayed green. **That asymmetry is the evidence** — a block gate hides a gated entry just as correctly as a per-entry one does |

  **Mutation testing on the mapper.** `npx stryker run --mutate "src/lib/auth-errors.ts"`
  (permanent `mutate` list untouched), 2026-07-31: **92.98% — 53 killed, 4 survived, 0 with no
  coverage**. C10X-28's run was 93.33% (42/3/0) before six map entries and `ownedAuthMessage`
  existed. **No assertion was added**: all four survivors are `ConditionalExpression` mutants
  stripping an `x !== undefined` / `raw === null` guard, and each was confirmed **equivalent by
  execution** rather than argued — `Object.hasOwn(map, undefined)` is `false`,
  `undefined >= 500` is `false`, and `AUTH_MESSAGES.includes(null)` is `false`, so every mutated
  branch returns what the original returns. Three of them are the same three C10X-28 classified;
  the fourth is the new helper's null guard, same class.

  **What this does NOT prove — read this before citing the auth surface as closed.**
  - **Five of the six new codes are INFERENCE, not measurement.** `email_address_not_authorized`,
    `email_provider_disabled`, `captcha_failed`, `conflict` and `request_timeout` cannot be
    produced against this project's local stack, and their `it.each` rows use the **same literal
    as the map key** — so the suite proves only that the module agrees with itself, and a typo'd
    or renamed code is invisible to it **and** to Stryker. No runtime guard is available
    (`error-codes.js` is `export {}`; the codes exist only as a type). The mitigation is an
    artifact, named in the module: all six were checked against the `ErrorCode` union in
    `node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts` at auth-js **2.105.3**.
    The two production-only divergences (`user_already_exists` under confirmations-on,
    `email_address_invalid` appearing hosted-only) are inference for the same reason.
  - **`AUTH_UNAVAILABLE_MESSAGE` is asserted nowhere**, deliberately: its branch needs
    `createClient() === null`, i.e. an `astro:env/server` double, and §6.9 admits one only for a
    claim unreachable otherwise. It was seen once end to end during Phase 4's manual checks and
    that changes nothing. A surviving Stryker mutant on it is expected, not a gap.
  - **The island and `.astro` halves, as always (§7)** — but **one of the three is now closed, and
    the sentence that used to end this bullet is no longer true** (corrected 2026-07-31 by this
    change's impl-review, F2). It read: "A regression deleting the `ownedAuthMessage(...)` call from
    `signin.astro` leaves the suite green." It did, and it no longer does —
    `tests/lib/auth-error-param-guard.test.ts` is a textual guard over `src/pages/auth/**/*.astro`
    asserting **per line** that a read of the parameter is the same line that wraps it, so
    co-presence of an unused import cannot satisfy it. Proved falsifiable rather than argued:
    unwrapping `signin.astro:8` turns **1 of 3** red, naming file and line
    (`signin.astro:8: const error = Astro.url.searchParams.get("error");`), while **both positive
    controls stay green** — and, the reason the guard exists, `errors.test.ts` stayed **55/55 green
    through the same neuter**. Restored, `md5` identical to the pristine copy
    (`0e0221b42845c63a2130bcb7cfd7266a`), `git diff -- src/` empty. It proves the call is *present
    and composed*, never that its value reaches `serverError`. **Still resting on browser checks
    alone**: that both islands strip the parameter with `replaceState`, and that `Layout.astro`
    calls `visibleConfigStatuses` with `Boolean(Astro.locals.user)`.
  - **The field/description association covers the ERROR only, never the `hint`** (added
    2026-07-31 by this change's impl-review, F4). `FormField.tsx:69` emits `aria-describedby` on
    the same condition that renders the error `<p>`, which is what makes a dangling reference
    impossible — and `hint` is that condition's `else` branch, so it is never described. Concrete
    cost: `SignUpForm.tsx:74-80`'s live "N more characters needed" is **visible-only**, so a
    screen-reader user meets the guidance only after triggering the error it would have prevented.
    Left open by decision, not by omission — `hint` arrives as an opaque `ReactNode`, so an id
    needs a prop-contract change or a `cloneElement`, and the manual check that closed 5.6 would
    have to be re-run. Recorded at the site in `FormField.tsx` with the shape it would take.
  - **`role="alert"` is a shared edit with a wider blast radius than auth**, and the counts here
    are enumerated (`grep -rn "<ServerError" src/`), not carried over: **twelve call sites across
    eleven components**, ten of those sites (nine components) off the auth surface and every one
    of them a *dynamic* insertion, which is the case the role is specified for. Exactly **one**
    of the ten was exercised (`GeneratorForm`); the other nine rest on the shared-component
    argument. Nothing here is evidence about what a screen reader announces — three manual rows
    are closed to the *mechanism* only, because a screen reader and a password manager cannot be
    driven from automation.
  - **Nothing observes the URL cleanup automatically.** No assertion reads `window.location`.
  - **Other `?error=` consumers are untouched, and this one has an OWNER now** (added 2026-07-31 by
    this change's impl-review, F1). `decks/index.astro:22`, `decks/[publicId]/index.astro:86` and
    `review.astro:115` still read the parameter unconstrained; their messages come from a
    different set (or none), so the helper does not apply as written. What the review added is not
    the observation but the ticket: all three pass the raw value as `serverError` into an island
    that renders it through the **same** `ServerError` red banner (`decks/index.astro:34` →
    `CreateDeckModal.tsx:80`), i.e. the identical content-injection class this change closed on the
    auth pages — behind the middleware guard, so the victim must already be signed in, which lowers
    the severity and does not remove it. Every other deferred edge in this list carries a key
    (C10X-36, C10X-37); a live vector recorded in prose alone is how one becomes a rediscovery. **To
    be ticketed via `/jira-backlog-sync`** (same idiom as C10X-31's deferred `workflow_dispatch`
    leg): a deck-side closed set plus an `ownedAuthMessage`-shaped helper — membership by equality,
    `null` on anything else. The first step of that ticket is the thing this review did **not**
    establish: enumerate what the six deck endpoints actually put in `?error=` and confirm it is a
    closed set of literals.
  - **The two deck endpoints still carry the defects C10X-30 swept elsewhere** — unguarded
    `formData()` and the `as string | null` cast (`decks/index.ts:22-23`,
    `decks/[publicId].ts:31-32`). Owned by **C10X-37**; only the false *comment* about them, in
    `src/lib/forms.ts`, is corrected here.
  - **Auth INPUT validation is still absent** (presence, format, length before the GoTrue call) —
    **C10X-36**. What exists on these routes is malformed-body handling only, and the test file
    says so in a comment so a green `describe` cannot be read as "auth input is validated".
  - **The auth UI is still English** (`signin.astro`, `signup.astro`, `confirm-email.astro`, the
    three auth islands) while the banner copy is Polish — **C10X-19**'s sweep. `confirm-email`'s
    new copy was written in English on purpose, to match the page it lives in.

  Full evidence — every breakage edit with its observed failure string and denominator, the
  verified restores, the Stryker register, and what each manual browser row actually showed:
  `context/changes/auth-error-copy/verification.md` (after archiving:
  `context/archive/<date>-auth-error-copy/verification.md`).

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
_after_ the evidence is collected (`violated by some row`). C10X-27 hit exactly that on
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

### 6.9 Adding a test that needs a module double

(Added by C10X-28 / §3 Phase 2's Risk #4 slice. It sits after §6.8 so every existing
§6.x anchor keeps pointing where it did.)

**The default is still "no doubles."** Every other file in this suite drives the real
endpoint against the real local Postgres, and §6.4 explains why: the lock under test is
RLS, and a double is the fastest way to mock away the thing you meant to prove. This
section exists because exactly one claim could not be reached any other way — not to open
the door generally.

- **Location**: `tests/generation/failure-path.test.ts`. **Module doubles live in that one
  file.** If you find yourself adding a second one somewhere else, that is the moment to
  re-read this section rather than to imitate it.
- **Run**: `npx vitest run tests/generation/failure-path.test.ts` (the local stack must be
  up — the database is still real, so preflight still applies).
- **Check §6.6 first**, as §6.2 requires: the C10X-28 entry there tabulates what the two
  branches now prove and what they deliberately do not.

**The only module ever doubled is `astro:env/server`**, and only to lift a clamp that is
otherwise airtight in three independent places: preflight aborts the run when
`OPENROUTER_API_KEY` is set (§6.4), `src/lib/openrouter.ts` short-circuits to `mockCards`
when it is unset, and under Vitest an `astro:env` secret is a **transform-time inlined
literal** — so `vi.stubEnv`, `process.env` and `setGetEnv` are all dead seams. Replacing
the module is not the convenient option; it is the only one.

**Why `@/lib/openrouter` is the WRONG module to double, and this is the load-bearing
paragraph.** Doubling `generateCandidates` also reaches the 502 branch, so it looks
equivalent and is not: `openrouter.ts`'s request-building code then never runs, no request
is issued, and the `Authorization` header the key-pin exists to observe does not exist. The
absence assertion ("the key is in no audit column") would still pass — because nothing was
ever sent. Half the claim evaporates and the suite stays green. A double that removes the
code your positive control observes is a false pass by construction; check for that before
choosing a seam, not after.

Four mechanical traps, three of which were only found by running it:

1. **`vi.hoisted` is mandatory for the sentinel.** `vi.mock` factories are hoisted above
   every import, so a plain module-scope `const SENTINEL` is in its TDZ when the factory
   runs. Share it with `const { SENTINEL_KEY } = vi.hoisted(() => ({ SENTINEL_KEY: "…" }))`.
2. **The factory must spread `...actual`,** for a reason unrelated to the key:
   `SUPABASE_URL`/`SUPABASE_KEY` come from the same module (`src/lib/supabase.ts`). A
   factory returning only the key makes `createClient` return `null`, and `/api/generate`
   answers **500** without ever reaching the LLM call — which presents as a mysterious
   failure rather than as the wiring error it is.
3. **The `fetch` double must be a pass-through, not a replacement.** Inside one
   `callEndpoint` the endpoint makes six Supabase calls over `globalThis.fetch`, and the
   assertions read the audit row back the same way. Match on `openrouter.ts`'s
   `OPENROUTER_URL` and delegate every other URL to the captured original.
4. **Install the `fetch` double BEFORE the key seam.** The `astro:env` mock deliberately
   lifts the clamp preflight exists to enforce (`lessons.md`: "Preflight musi domknąć KAŻDY
   nielokalny szew"), so the pass-through is the **replacement guard**, not a convenience:
   without it, a sentinel key produces a real, billed call to `openrouter.ai`.

**The database and RLS are never doubled**, here or anywhere. Every row this file asserts
on is read back through the app's own RLS-scoped client.

**Isolation: know which hazard the config already handles.** Vitest 4.1.10's defaults apply
(nothing is set in `vitest.config.ts`): `pool: "forks"`, `isolate: true`. So a `vi.mock`
**cannot** leak into another file — which means "the full suite is still green" is a smoke
check, not evidence that the double is confined. The live hazard is **intra**-file:
`restoreMocks`, `clearMocks`, `mockReset` and `unstubGlobals` all default to `false`, so a
`globalThis.fetch` replacement must be restored in an `afterAll` or a later `it()` in the
same file reads the database through a stale double.

> **There is now a SECOND `fetch` seam in this suite, and it is deliberately not a double**
> (added 2026-07-30 by C10X-32; this section otherwise still reads as if `failure-path.test.ts`
> were the only one). `tests/setup/retry-transport.ts` is a `setupFiles` entry, so it wraps
> `globalThis.fetch` for **every** test file — but it fabricates no response and intercepts no
> module: it replays one transport failure (Kong's keep-alive `502` from a local URL, at most
> twice) and hands everything else straight through. Three consequences for a reader of this
> section. It is **not precedent for a second module double** — the rule above stands, and the
> location bullet still means what it says. Its predicate is falsifiable rather than
> reasoned-about: the pure half lives in `tests/setup/retry-policy.ts` and is asserted by
> `tests/lib/retry-transport.test.ts`. And it is **never restored**, which does not violate the
> intra-file rule above — that rule is about a per-file double outliving its `describe`, while
> this one is installed by the harness for the whole file on purpose. §6.2's shuffle bullet
> carries the reason it exists.

**The deliberate-breakage check for this path** is the one that decides whether the seam is
doing anything at all: **comment out the `vi.mock("astro:env/server", …)` factory.** The
right red is `expected 200 to be 502` — without the seam the request falls through to mock
mode and **succeeds**. Any other failure means the file is observing something else. §6.6
records that run, plus the three that pin the individual assertions (a body interpolating
`err.message`, a body interpolating the source text, and `Authorization` moved into the
request body).

### 6.10 Adding a test for a redirect-style (native form) endpoint

(Added by C10X-30 / §3 Phase 2's card-content slice. It sits after §6.9 so every existing
§6.x anchor keeps pointing where it did.)

§6.3 tells you to assert a refusal **and** no write. On the six protected `/api/*` routes
that are native `<form method="POST">` targets — deck rename/delete, card create/edit/delete
— "the refusal" has no status of its own, and that changes what an assertion has to look
like. This subsection is the difference; everything §6.3 and §6.4 say still applies on top
of it.

- **Location**: `tests/validation/cards.test.ts` for a **content rule**;
  `tests/isolation/*.test.ts` stays the **ownership** file (§6.2's one-file-per-resource
  rule is about the resource, and these two concerns are deliberately not mixed).
- **Reference**: `tests/validation/cards.test.ts` — copy this one.
- **Run**: `npm test`, or one file with `npx vitest run tests/validation/cards.test.ts`.
  Local stack up (`npm run db:start`).
- **Check §6.6 first**, as §6.2 requires: the C10X-30 entry tabulates what each claim
  already rests on.

Six facts that are invisible from the test file and will cost you an afternoon:

- **A refusal and a success are the SAME status.** Both are a `302`; only the `Location`
  differs. So `expect(response.status).toBe(302)` proves nothing at all here, and the row
  oracle is not a supplement — it is the assertion. Every refusal case must re-read the
  rows it could have written.
- **Assert the decoded `error` param by EQUALITY, never `toContain("error=")`.** A guard
  that stops working does not remove the redirect; the request falls through to the
  handler's *other* error branch, which redirects with a **different** owned message and
  the same `error=` key. C10X-30's breakage run 1 is exactly that: with the endpoint's
  length comparison decoupled, the response was still a `302` still carrying `error=` and
  `open=create-card`, and only the equality assertion went red. Read the param with
  `new URL(location, ORIGIN).searchParams.get("error")` (`errors.test.ts:210-220`).
- **Order the assertions with the row oracle FIRST, and say why in a comment.** Vitest
  aborts an `it()` at the first failed `expect`. When two enforcement layers exist (here:
  the endpoint's comparison and the DB CHECK), the breakage pair only separates them if the
  two runs fail on *different* assertions — count-first yields "red on the message" for the
  endpoint layer and "red on the count" for the database layer. Message-first collapses
  both runs into one indistinguishable failure string. An ordering with no comment reads as
  arbitrary and gets tidied away.
- **`callEndpoint` does not follow redirects** (`endpoint.ts:50-55`), so `status` and the
  raw `Location` string are directly assertable — which is also what makes a **no-echo**
  case cheap: assert the raw header contains neither the submitted marker nor the run
  suffix, before decoding.
- **Never `countFlashcards` or `listFlashcards` as the count oracle.** Both filter
  `state_id = STATE_ACCEPTED` (`flashcards.ts:167-173`, `:76-83`), so a card written in any
  other state is invisible to them and "count unchanged" reads green over a real write. The
  oracle must be a raw, state- and status-agnostic count scoped by `deck_id` only. This is
  the same class as C10X-28's status-filtered-count trap, and the helper your need points
  straight at is the wrong one.
- **Deck resolution runs before content validation, deliberately** (`cards/index.ts`, from
  S-02 impl-review F5). An over-length body aimed at a foreign deck answers `404`, not the
  validation redirect — so every case must use a **real, owned** deck or it measures the
  ownership guard instead of the rule it names.

One asymmetry worth stating because it inverts a case you may be copying: the card
endpoints `.trim()` **before** measuring, while `/api/generate` caps the raw string. So
C10X-28's "over the cap, but trims back under it → still refused" does **not** transfer —
the card-side mirror is *accepted*, and `tests/validation/cards.test.ts` carries it as its
own case. And do not build boundary strings from non-ASCII: `char_length` counts code
points while JS `.length` counts UTF-16 units, so an astral character measures 2 on the
endpoint and 1 in the CHECK.

**The deliberate-breakage check for this path is a PAIR, not a single run**, whenever the
rule has a second enforcer beneath the endpoint. Run 1 decouples the endpoint's comparison
(replace `> FRONT_MAX` with a literal — **never** raise the shared constant, which the
endpoint, three islands, `openrouter.ts` *and the test* all import, so raising it moves
every side together and the suite stays green while proving nothing). Run 2 keeps run 1's
edit and additionally drops the CHECK against the live local DB
(`docker exec -i … psql` — the `-i` is load-bearing, §6.7). One run alone cannot tell "the
endpoint caught it" from "the database caught it"; the pair can, because the *failure
strings* differ. Restoring a dropped CHECK is **not** symmetric with restoring a function:
the suite persists rows the constraint forbids while it is absent, so delete those rows
(scoped to the run's own deck) *before* re-adding, then confirm with a
`pg_get_constraintdef` before/after `diff`. And know what that diff does not establish — a
text match would also read identical for a constraint that came back `NOT VALID`, so probe
the restored bound behaviourally too, inside a rolled-back transaction and with an in-range
insert as the positive control. §6.6's C10X-30 entry records both runs with their splits.

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
- **Log lines emitted by dependencies** — inside Risk #4's scope, deliberately not
  owned. `@supabase/ssr/dist/module/cookies.js:22,29` and
  `@supabase/auth-js/dist/module/lib/fetch.js:110` do write to Workers Logs via
  `wrangler.jsonc`'s `observability`, and they were **measured** rather than assumed
  safe: they carry session/transport material — on `fetch.js:110` a fetch `TypeError`
  (message + stack), not the request `init` — never pasted source text. Pinning
  `node_modules` internals would break on every patch bump with no user-visible cause.
  What _is_ guarded is first-party code: `tests/lib/no-logging.test.ts` fails on any
  `console.*` anywhere under `src/`, which is a real gate because `no-console` is
  configured `"warn"` and `npm run lint` exits **0** on a warning (measured, C10X-28).
  Re-evaluate if a dependency is ever found logging request bodies. (Source: C10X-28 /
  `context/changes/ai-candidate-generation-test-2/`.)
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
  > `readJsonResponse` in `src/lib/http.ts` (`tests/lib/http.test.ts`, 9 cases, including
  > the defect's exact `200 text/html` shape) and `rateOutcome` in
  > `src/lib/study-session.ts` (`tests/lib/study-session.test.ts`, 7 cases: counting a
  > real transition, holding the card and offering a recovery on `alreadyApplied`,
  > offering a skip on a JSON 404 and withholding it on an unparseable one or a
  > retryable failure).
  >
  > **Both were widened again the same day by `/10x-impl-review` on this change**, and the
  > second one closed a defect rather than adding coverage. `JsonResult`'s failure variant
  > gained `parsed`, because collapsing "unparseable" into `status: 0` lost the real status
  > and made a 404 behind a proxy's HTML error page indistinguishable from "not an HTTP
  > failure" — leaving the user stuck on a card the skip affordance existed to release. And
  > `alreadyApplied` no longer advances: the compare-and-set keys on the `reps` **version**,
  > not the grade, so a second tab rating the same card with a _different_ grade landed
  > there and that grade was discarded in silence. The island now holds the card, says so
  > neutrally, and adopts the `progress.reps` the endpoint always returned and nobody read,
  > so re-rating applies. Evidence, including the row-level before/after showing an `Again`
  > actually landing after recovery:
  > `context/archive/2026-07-26-srs-study-session-test/verification.md`. What is still uncovered by construction is everything around
  > them — the island's rendering, its state wiring, whether `rate()` actually calls the
  > helper. So the review-by-reading rule above **stands unchanged**; the extraction
  > shrinks what a reading has to catch, it does not remove the need for one. The same
  > applies to `SessionSizeControl`'s `SIZE_MIN`/`SIZE_MAX` mirror, which §6.6's Phase 4
  > entry names as the one bound layer no test reaches.
  >
  > **A second instance, and it shows what single-sourcing does and does not buy (C10X-28,
  > 2026-07-26).** `GeneratorForm`'s `maxLength`, `min`/`max`, `<select>` options and char
  > counter now import their values from `src/lib/generation-limits.ts`, the same module the
  > endpoint imports — so the two ends can no longer disagree about the **value**. That each
  > end still _enforces_ it is a different claim: the server half is asserted
  > (`tests/generation/generate.test.ts`), the client half is one manual browser run
  > recorded in the change's `verification.md`, exactly as with `SessionSizeControl`. Worth
  > knowing before writing a case against it: `maxLength` truncates first, so the island's
  > own `text.length > SOURCE_MAX` branch and `CharCount`'s red state are **unreachable
  > through the UI** — a second belt, not the visible guard.
  >
  > **A third instance, and it is the OPPOSITE situation — do not read the two as the same
  > (C10X-30, 2026-07-28).** The three card islands (`CreateFlashcardModal`, `FlashcardItem`,
  > `CandidateItem`) import `FRONT_MAX`/`BACK_MAX` the same way, but they carry **no
  > `maxLength` attribute** — verified by enumeration: `maxLength` appears in `src/components/`
  > only in `GeneratorForm`. So nothing truncates the input first, their over-length branch
  > **is** the visible guard, and it is genuinely reachable through the browser. Where the
  > `GeneratorForm` note above says an untested branch is unreachable anyway, here an untested
  > branch is the one a user actually meets. The server half is asserted
  > (`tests/validation/cards.test.ts`) and backed by a DB CHECK; the client half rests on the
  > manual browser checks in `context/changes/server-side-validation-test/verification.md`.

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
  `context/archive/2026-07-26-srs-study-session-test/mutation-register.md`.
- **Two coverage gaps are open and named**, deliberately not folded into the `complete`
  status: the RPC's `f.id asc` tie-break has no assertion that observes its _presence_
  (only the batch's order), and §6.6's four-policy neuter no longer reproduces on a dev
  DB past PostgREST's `max_rows`. Both are described where they bite, in §6.6 and §6.7.
- §3 Phase 2 / Risks #4 and #6 coverage claims last **proven by execution**: 2026-07-26
  (C10X-28 / C10X-34 / C10X-30, change folder `ai-candidate-generation-test-2`). Suite state
  measured at completion: **166 passed / 166, 14 files**, local stack up,
  `OPENROUTER_API_KEY` unset, `npm run lint` and `npm run build` clean, and
  `git diff -- src/` empty after every deliberate-breakage check. Every count in §6.6's
  C10X-28 entry comes from a run against these files; each RLS restore was confirmed by a
  `pg_policies` before/after `diff` (empty), and the `.env` edit behind the banner check by a
  `diff` against its backup (empty). Mutation coverage on the new auth mapper: **93.33%**
  (42 killed / 3 survived / 0 uncovered) — the three survivors are equivalent mutants,
  each checked individually rather than assumed, and one assertion was added because of the
  run (every constant in the exported closed set is non-empty; an empty one renders as no
  reason at all). Register: the change's `verification.md`.
- **Three false or stale statements in THIS file were corrected by that slice**, all of them
  pointers rather than claims — and pointers rot silently: every
  `context/changes/<archived-id>/…` evidence path was rewritten to its
  `context/archive/<date>-<id>/…` form and **each one verified to resolve on disk**; the S-05
  Stryker command's line range (`src/lib/flashcards.ts:181-212`) was corrected and the two
  symbols named beside it, because `75df78f` had moved them two hours after the recorded run
  and Stryker reports a score for whatever the stale range happens to contain; and the same
  wrong `generations.ts` anchor was fixed in a live comment at
  `tests/generation/generate.test.ts`. Three earlier items this change's research had listed
  were already closed by C10X-27 and are not re-fixed.
- **Risk #4's boundary and Risk #6's remaining half are named, not folded into the
  headline.** Risk #4: no test reads a real log sink, and dependency-emitted lines are in
  scope but unowned. Risk #6: the card-content endpoints are untested, which is the single
  item between §3 Phase 2 and `complete`. Both are described where they bite, in §6.6's
  C10X-28 entry and §7.
  > **Risk #6's half is closed as of 2026-07-28 (C10X-30); Risk #4's boundary stands
  > unchanged.** The line above is kept as written because it was the accurate statement on
  > 2026-07-26 and because §3 Phase 2's `implementing` status hung on it. What replaced it is
  > the entry below.
- **Cloud schema checked, and it matches.** `npx supabase migration list` run from the
  worktree on 2026-07-26 shows Local == Remote on **all ten** migrations, including
  `20260724220524` — the one carrying the `session_size` CHECK and the RPC tie-break these
  tests lean on. The S-03 impl-review's open "applied locally only, cloud push never
  confirmed" is closed. Note this was a point-in-time observation, not a gate — **which
  C10X-29 changed on 2026-07-28**: there is now a CI drift check, so the same fact is
  re-established on every push to `main` instead of by hand.
- §3 Phase 3 / Risk #5 coverage claims last **proven by execution**: 2026-07-28 (C10X-29,
  change folder `schema-drift-test`). Suite state **after the change's impl-review**:
  **178 passed / 178, 15 files** (166 before, + 12 comparator cases); it was 177/177 at
  phase completion, and the twelfth case came from the review — see the entry below. Local
  stack up, `OPENROUTER_API_KEY` unset, `npm run lint` exit 0, `npm run build` exit 0. The baseline
  was measured **before** the gate was wired — ten local migrations against ten applied
  cloud migrations, **IN SYNC as of 2026-07-27**, confirmed against a second independent
  remote oracle — precisely so the first red run after the gate landed would have one
  hypothesis rather than two. Every breakage split in §6.6's C10X-29 entry comes from a run
  against these files, and each temporary edit was reverted with the revert **verified**
  (`md5sum` against a pristine copy; the rehearsal commits dropped from the branch).
- **The impl-review found a false green in the gate itself, and it is worth reading as a
  pattern rather than a one-off.** `/10x-impl-review` (2026-07-28) verified every plan
  contract as met and every automated criterion as green — and then found, by probing the
  comparator with inputs no criterion named, that **two migration files sharing one version
  returned `clean: true`**. That is drift class 1 (committed, never applied) reported as OK
  by the gate built to catch exactly it. The cause is instructive: the `Set` that makes the
  comparison correctly **order-blind** — load-bearing, because this repo carries a genuine
  out-of-order pair — is the same thing that makes it **collision-blind**. A design property
  and a defect from one line. Closed by a `duplicate` list folded into `clean` with its own
  remedy (rename, not `db push`), plus a twelfth fixture; the out-of-order case was
  re-checked and still reads clean, so the fix is additive. Two further review fixes hardened
  the same file: remote versions are now trimmed and shape-checked, and the `.sql` test is
  case-insensitive so `_x.SQL` is surfaced rather than skipped. Full record in the change's
  `verification.md` and `reviews/impl-review.md`.
- **One prediction in the plan was wrong and is recorded as observed, not rounded.** The
  `missingLocal` neuter was predicted to turn exactly one case red; it turns **two**,
  because the both-directions-at-once case asserts the same field. And **criterion 4.4 does
  not go red as worded** — `db:types` overwrites the working tree before the diff runs, so
  the check only works on _staged_ content. Both are in §6.6; the second is a trap a
  contributor following the wording would read as "the gate does not work".
- **Risk #5's boundary is per class, and it is stated in two places on purpose.** §2's row
  is the coverage claim (which classes the project is protected against); §6.6's C10X-29
  entry is the mechanism (what the gate observes). Three classes are invisible to the gate
  by construction — a migration amended after being pushed, production hand-edited in
  Studio, `repair --status applied` on something never applied — and reachable only through
  the on-demand DDL diff, **which now works end to end but which nobody is scheduled to
  run** — the gap is the schedule and the owner, not the capability. Two classes (config
  drift, seed-row drift) have no check at all. **No test in the suite touches the cloud.**
- **Ship-time items are CLOSED, and closed by observation rather than by assertion**
  (2026-07-28, merge `f7a83c0`). The gate ran on the real path for the first time — run
  30379662871, `ci` → `drift` (5 s) → `deploy`, all green, the gate printing
  `10 local entries against 10 applied cloud migrations` / `OK`, with zero credential hits in
  the log. The DDL workflow registered only **after** the merge (checked before and after, so
  the registration is evidence rather than a fact), and was then dispatched three times: two
  green from `main` that agree with each other, and one red from a scratch branch, which is
  the negative control the three green runs would otherwise have lacked. That red run also
  fired the artifact-upload path for the first time and confirmed the impl-review's F3 fix by
  measurement: the diff body is in the artifact and **not** in the world-readable log. Every
  `## Progress` box in the change is now ticked. Full record, including the reverted scratch
  branch, in the change's `verification.md`.

- §3 Phase 2 / Risk #6's **card-content** half last **proven by execution**: 2026-07-28
  (C10X-30, change folder `server-side-validation-test`). Suite state measured at the start of
  the breakage phase and again after both restores: **193 passed / 193, 16 files**
  (178 before this change; +12 in the new `tests/validation/cards.test.ts`, +1 in
  `candidates.test.ts`, +2 in `errors.test.ts`). Local stack up, `OPENROUTER_API_KEY` unset,
  `npm run lint` exit 0, `npm run build` exit 0, and `git diff -- src/ supabase/` empty after
  every breakage restore — verified by `md5sum` against a pristine copy for the source edit and
  by a `pg_get_constraintdef` before/after `diff` for the constraint. Both splits in §6.6's
  C10X-30 entry come from runs against these files, read against a denominator of **12**.
- **The impl-review then took the suite to 207/207, 17 files, and two of its additions were
  proven falsifiable by their own breakage runs.** `/10x-impl-review` (2026-07-28) reproduced
  every automated criterion above and raised 10 findings, all triaged. Five changed the suite:
  a **boundary control at exactly `IDS_MAX`** (`candidates.test.ts`) — narrowing `IDS_MAX` to
  `2` turns **1 of 22** red on it while the pre-existing 101-id case stays green, which is
  exactly the blindness it removes; **constraint NAMES** alongside `23514` in
  `cards.test.ts`'s independence case, matching `study.test.ts:717`, because the code alone
  cannot say WHICH guard fired and layer attribution is that case's purpose; a `File`-part
  case on the **edit** endpoint and the first two cases ever to touch **`signup.ts`**; and
  `tests/lib/forms.test.ts` (9 cases) for `src/lib/forms.ts`, where the four inlined copies of
  the string-only form read were extracted so they could be tested at all.
  Two measurements are worth carrying. **GoTrue answers an empty address differently per
  route** — `signup` → `anonymous_provider_disabled` (it reads it as an anonymous sign-in
  attempt), `token?grant_type=password` → `validation_failed` — so signup lands on the
  catch-all; that is now pinned by equality rather than smoothed over, and it corrects a false
  comment in `auth-errors.ts`. And **both causes of a `formData()` rejection throw the same
  `TypeError`**, so the auth routes tell "never a form" from "a form that arrived broken" by
  the **Content-Type header**, not by the exception; collapsing that discriminator turns
  **3 of 47** red. Full record: the change's `reviews/impl-review.md` and `verification.md`.
- **One prediction was less precise than the run, and is recorded as observed.** The plan said
  run 2's case 8 "stays red from run 1"; it does, but on a **different assertion** — run 1
  failed it on the closed-set message, run 2 on the count, because case 8 also sends an
  over-max `front` and its count oracle likewise sits first. Two of run 2's three reds moved
  from the message to the count, not one. Same discipline as C10X-29's `missingLocal` neuter:
  the conclusion is unchanged, the prediction was simply rounder than reality.
- **Six documents said "4xx" (and "POST/PATCH") about endpoints that answer `302` and export no
  `PATCH`.** Corrected 2026-07-28 in this file (§2's guidance row, §6.3, the §3 sequencing
  note), in the change's own `change.md`, and as a **dated correction line** — not a rewrite —
  in `context/archive/2026-07-26-ai-candidate-generation-test-2/change.md`. The Jira description
  and its two comments are corrected outside this repo at `/jira-finish-work`. The wording was
  not cosmetic: a contributor following it would have written a status assertion on a status
  that a refusal and a success share.
- **Risk #6's remaining boundary is the ISLAND half, and it is not the same situation as
  `GeneratorForm`'s.** The three card islands carry no `maxLength`, so their over-length branch
  is reachable through the browser rather than sealed behind an input stop — an untested branch
  a user actually meets. Named in §7 and in §6.6's C10X-30 entry, carried by manual browser
  checks. Re-evaluate the moment any §3 phase wires e2e.
- **A migration is committed and NOT yet pushed to the cloud** as of this entry
  (`20260728104500_flashcard_content_bounds.sql`). The pre-push row check ran read-only against
  production — `bad_front` 0, `bad_back` 0 over 38 rows, maxima 64/157 — so it applies without
  repair, but until `/ship` runs `db push` this is exactly drift class 1 and the C10X-29 gate
  will say so on the first push to `main`. That is the gate working, not a failure.

- §3 Phase 5 / Risk #7 coverage last **proven by execution**: 2026-07-29 (C10X-31, change
  folder `ai-candidate-generation-test-3`). Ordinary suite: **220/220, 18 files** (207 at
  C10X-30; +12 in `tests/lib/eval-scoring.test.ts`, +1 success-path audit-columns case in
  `generate.test.ts`), local stack up, `OPENROUTER_API_KEY` unset, `npm run lint` exit 0,
  `npm run build` exit 0, zero eval files collected by `npm test`, `git diff` empty for
  `vitest.config.ts` and `tests/setup/preflight.ts`. The eval itself: first calibrated run
  2026-07-29 — exit **1**, honestly red with a real finding (forced `niemiecki`/`francuski`
  → Polish cards, four of four runs; `auto` 25/25 green), thresholds kept unchanged by the
  recorded calibration decision, ~$0.012 and 158 s for the recorded run, structured outputs
  shipped as the judge request shape. Both deliberate-breakage checks ran and were reverted,
  reverts verified (diff clean, marker grep clean, suite green). **This coverage date does
  not refresh itself**: the eval is human-triggered, so "covered" here means "the capability
  exists and was exercised on this date", never "a signal is being watched".
- **Risk #7's boundary is stated in three places on purpose**: §2's row (the coverage
  claim), §6.6's C10X-31 entry (the mechanism and the does-NOT-prove list), and §5's
  LLM-as-judge row (local-only, human-triggered, no schedule). The deferred
  `workflow_dispatch` leg — with a separate, low-credit-limit OpenRouter key — is a named
  follow-up to be ticketed via `/jira-backlog-sync`, and the forced-language prompt defect
  the first run found is another; neither is folded into the headline.

- **Suite ORDER-INDEPENDENCE last proven by execution: 2026-07-30** (C10X-32, change folder
  `flashcards-test-order`). This is a different axis from every entry above — it says the
  claims are trustworthy in any order, not that anything new is covered. Suite **228/228,
  19 files after this change's impl-review** (220/220, 18 at phase completion; the review
  added `tests/lib/retry-transport.test.ts`, 8 cases, so the transport wrapper's predicate is
  asserted rather than only argued — see the entry below). The matrix was run at 220/220 and
  re-confirmed at 228/228 on seeds 101/202/303 plus five fresh permutations. It comprised: the
  three seeds that were red before the fix (101 / 202 / 303, replayed
  green), **40 fresh un-pinned permutations, 0 red**, and a no-shuffle control
  (`--sequence.shuffle=false`) so declaration-order green was not traded away. Local stack
  up, `OPENROUTER_API_KEY` unset, `npm run lint` exit 0 (6 pre-existing `no-console` warnings,
  all in `evals/generation-quality.eval.ts` — warnings, not errors, because `no-console` is
  configured `"warn"`, and `tests/lib/no-logging.test.ts` gates `src/` only; **this line first
  said "in `scripts/`, allowed by AGENTS.md" and both halves were wrong** — `scripts/` emits
  none of them, and AGENTS.md's carve-out names `scripts/`, not `evals/`; corrected 2026-07-30
  by this change's impl-review, F5), `npm run build` exit 0. `sequence: { shuffle: true }`
  now lives in **both** configs — the two are deliberate independent copies, so each was
  edited on its own. Six pairs across three files were fixed by four edits; **two of the six
  were latent**, found by static analysis after three shuffled seeds never fired them, which
  is why the inventory came from reading rather than from re-rolling seeds.
- **A pre-existing local-stack flake was diagnosed here and is NOT an ordering defect** —
  recorded because a future contributor will meet it and reach for the wrong hypothesis. Kong
  pools keep-alive connections to PostgREST and holds them idle longer than PostgREST does,
  so the first request after a gap can answer `502 upstream prematurely closed connection`;
  it surfaced downstream as whatever assertion was in flight, and none of the reds reproduced
  at their own seed. Measured, not assumed: **3/20 red with shuffle on, 3/20 with shuffle
  off** — equal, therefore independent of this change — and two candidate causes were
  **refuted** by measurement (restarting `rest` + `kong` did not clear it; cutting file
  parallelism to `--maxWorkers=4` did not either). `tests/setup/retry-transport.ts` replays
  only that response, only from a local URL, at most twice, only for a replayable body — and
  **that predicate is asserted, not just described**: its pure half lives in
  `tests/setup/retry-policy.ts` and `tests/lib/retry-transport.test.ts` pins it in 8 cases,
  two of which were proved falsifiable by breakage runs (drop the body half → 1 of 8 red;
  hostname equality → substring → 1 of 8 red). Added by this change's impl-review (F2),
  because a guard that can swallow a failing response must be able to go red itself. Its
  positive control in the wild is what makes the green evidence: over the 40-run matrix Kong logged
  **22 more** such drops (86 → 108) while the suite went **0/40 red**, and no
  duplicate-write failure appeared. **How loud such a failure would be is narrower than first
  written** (corrected by this change's impl-review, F3): a duplicated `deck` insert 409s on
  `deck_user_name_unique` and every count oracle goes red, but `flashcard` carries no
  uniqueness constraint, so a duplicate from `createNonAcceptedCard` / `seedCard` — neither
  followed by a count assertion — would be **silent**. Those seams rest on the
  never-committed argument in the wrapper's header, not on a loud failure. The retry is
  deliberately not method-gated: the measured flake was a POST.
- **The eval path is shuffled too, and its failure set is unchanged.** Three runs
  (~$0.012 each), oracle = failure-set equality, never the exit code: run 3 reproduces the
  C10X-31 baseline exactly (`forced/niemiecki` + `forced/francuski`, 8 passed), the de/fr core
  is red in 3 of 3, and every red in every run sits on the **forced** path — no `auto` case,
  no `polski`/`angielski`. `forced/hiszpański` behaved as the documented intermittent (1 of 5
  cards mixed, green on its calibration re-run). Two reds in run 1 are **unidentified** — that
  run's output was truncated before it was saved — and the change's `verification.md` says so
  rather than rounding them up. The forced-language defect stays open, owned by the C10X-31
  follow-up.

- **Roadmap H-03 / the auth `?error=` channel last proven by execution: 2026-07-31** (C10X-34,
  change folder `auth-error-copy`). Suite **257/257, 22 files after this change's impl-review**
  (254/254, 21 at phase completion; the review added `tests/lib/auth-error-param-guard.test.ts`, 3
  cases, closing the one gap the entry above had disclosed rather than closed — see F2). At phase
  completion it was 228/228, 19 at the Phase 0
  baseline; +17 in `tests/auth/errors.test.ts` — which went 38 → 55 — plus two new files,
  `tests/lib/config-status.test.ts` (6) and `tests/lib/no-env-access.test.ts` (3). Local stack
  up, `OPENROUTER_API_KEY` unset, `npm run lint` exit 0 (the same 6 pre-existing `no-console`
  warnings in `evals/generation-quality.eval.ts`), `npm run build` exit 0. Six deliberate-breakage
  checks ran, each restored and each restore **verified** by a hash or `diff` against a pristine
  copy taken before the edit — including the `.env` and `supabase/config.toml` flips behind the
  manual checks. Mutation coverage on `src/lib/auth-errors.ts`: **92.98%** (53 killed / 4
  survived / 0 uncovered), no assertion added — every survivor confirmed **equivalent by
  execution**, not by argument.
- **Two predictions in that plan were less precise than the runs, and both are recorded as
  observed.** Breakage check E was predicted to turn 1 case red and turns **2** (the identity
  function also fails the empty-string half), and check A's red is a **pair** — a pure row and a
  real-route endpoint case — not the single row the plan named. Same discipline as C10X-29's
  `missingLocal` neuter and C10X-30's case 8: the conclusion is unchanged, the prediction was
  rounder than reality.
- **This change is also the one that closed the denominator rot this ledger keeps warning
  about.** `tests/auth/errors.test.ts` was cited as "33 cases" in §6.6's C10X-28 entry while
  holding 55, and the matching "1 of 33 red" lives in two **archived** artifacts. The §6.6 figure
  is corrected in place; the archived pair gained **dated correction lines and were not
  rewritten**, per this project's own precedent (C10X-30's "4xx" wording). Five comments in
  `tests/auth/errors.test.ts` that contradicted the code are corrected at the site a reader meets
  them — two of them found by *measurement* rather than by reading (breakage check B showed the
  distinctness case is blind to a repointed map key; the mapper's truthiness branch showed the
  non-emptiness scan cannot kill a `→ ""` mutant). The `role="alert"` call-site counts in
  `ServerError.tsx` were **re-derived by enumeration** and were wrong in the version that shipped
  in this change's own Phase 5 — recorded rather than quietly fixed.
- **What is NOT closed by this entry, and is named rather than left to be inferred**: the island
  and `.astro` halves of every claim above (§7 — **with one exception added by this change's
  impl-review**: a page that stops calling `ownedAuthMessage` now fails
  `tests/lib/auth-error-param-guard.test.ts`, so that one sentence in the parenthesis no longer
  holds; the `replaceState` strip and `Layout.astro`'s call are unchanged),
  `AUTH_UNAVAILABLE_MESSAGE`, the five inference-only GoTrue codes,
  the two deck endpoints (**C10X-37**), auth input validation (**C10X-36**) and the English auth
  UI (**C10X-19**). §6.6's C10X-34 entry carries each with its reason.
- **The impl-review left one live vector with an owner rather than a fix** (F1): the three deck
  pages still read `?error=` unconstrained into the same `ServerError` banner — the class this
  change closed on auth, one surface over, behind the session guard. Queued in the change's
  `follow-ups/review-fixes.md` and named in §6.6's does-NOT-prove list; **to be ticketed via
  `/jira-backlog-sync`**. Its first step is the enumeration this review did not do: confirm the
  six deck endpoints' `?error=` values are a closed set of literals.

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
