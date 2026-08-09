<!-- PLAN-REVIEW-REPORT -->

# Plan Review: E2E harness + two browser journeys

- **Plan**: `context/changes/e2e-harness-journeys/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-08
- **Verdict**: REVISE → **SOUND after triage** (10 of 10 findings fixed in the plan, 2026-08-08)
- **Findings**: 2 critical, 6 warnings, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots           | FAIL    |
| Plan Completeness     | WARNING |

## Grounding

9/9 paths ✓, 12/12 symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓ (6 phases, 36/36 criteria
mapped, one `## Progress` heading, no stray checkboxes in phase bodies).

Two claims the plan states as measured were **re-measured and confirmed**:

- Vite `loadEnv(mode, cwd, "")` overlays `process.env` over `.env` (executed) — so
  `webServer.env` genuinely is binding on the child, and the plan's central mechanism holds.
- `chromium.executablePath()` returns a path without throwing (executed) — so `fs.existsSync`
  is the right presence check, and the binary is in fact installed on this machine.

Also confirmed by reading `node_modules/playwright/lib/runner/index.js`:
`createGlobalSetupTasks` orders `removeOutputDirs` → plugin setup → globalTeardowns →
globalSetups (the plan's ordering discovery), the `webServer` env spread is
`{...DEFAULT_ENVIRONMENT_VARIABLES, ...process.env, ...this._options.env}`, and the
`"… is already used"` throw exists as quoted.

Journey B's seven audited defects were checked against `tests/e2e/route-guard.spec.ts` line by
line and every reference resolves (E1 `:73`, E2 `:32-33`, E4 `:20-22`, E5 `:55`, E6 `:72`,
E7 `:27-33`, signed-in comment `:79-82`). E3's fourth "Sign in" exists at
`src/components/Topbar.astro` as an `<a>` on the public path.

Breakage A's premise was verified rather than assumed: `/study` is `src/middleware.ts:13`,
`src/pages/study/index.astro` exists and carries **no** page-level auth redirect (no
`locals.user` read in any page or layout except `Layout.astro:15`), and
`tests/middleware.test.ts:152-159` filters by `"/api/study".startsWith(route)` — which never
matched `/study` — so `npm test` does stay 100% green under that neuter, as the plan claims.

## Findings

### F1 — Teardown and its oracle are deck-scoped; `generation_session` survives

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §4 (the teardown) + Success Criteria 3.3 and 5.5
- **Detail**: Desired End State promises "a teardown project removes every row the run created".
  Measured against the schema that is false for one table, and the plan's own oracle cannot see
  it. `init_core_schema.sql:60` cascades `flashcard` from `deck`, and
  `srs_study_schedule.sql:36` cascades `flashcard_schedule` from `flashcard` — but
  `generation_session.sql:24` references `auth.users` only (no deck FK) and
  `generation_session.sql:47` makes `flashcard.generation_id` `ON DELETE SET NULL`. Deleting the
  deck therefore leaves the session row. Journey A generates on every run, on a **stable** account
  (D-01) that persists across runs, so this is unbounded growth on exactly the axis this change
  exists to stop. Criteria 3.3 / 5.5 measure "deck-count delta 0" and read green over it — the
  class §6.6 records four times: correct about what it looks at, silent about what it never looks
  at. The fix is available: `generation_session.sql:73-74` grants the owner a DELETE policy.
- **Fix**: Widen both the teardown and the oracle to `generation_session` — delete this run's
  sessions scoped by the run marker (in `source_text`, matching the suffix discipline the decks
  use), and make criteria 3.3/5.5 assert a delta of 0 on decks **and** generation_sessions, as two
  counts rather than one.
  - Strength: Closes the promise as written; the DELETE policy already exists, so no migration and
    no privilege change.
  - Tradeoff: A second scoped query in the teardown; `source_text` is long, so scope by a short
    leading marker with `.like()` — §6.6's C10X-28 trap is that a long value in a PostgREST filter
    answers 414 before the query runs.
  - Confidence: HIGH — FK directions and the policy read off the migrations.
  - Blind spot: Not enumerated whether journey A writes any other table with no deck FK; the sweep
    should be by schema, not by memory.
- **Decision**: FIXED — Phase 3 §4 gained the two-table contract with the FK evidence and the 414
  scoping trap; criteria 3.3 / 3.5 / 5.5 and Progress 3.3 / 3.5 / 5.5 now assert two deltas.

### F2 — `.dev.vars` bypasses the config-time preflight AND outranks `webServer.env`

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (the six assertions) + Implementation Approach
- **Detail**: The plan's central claim — "the config refuses to proceed against anything but the
  local stack", and "`webServer.env` … turns 'we checked' into 'it cannot be otherwise'" — has one
  documented bypass none of the six assertions cover.
  `@astrojs/cloudflare/dist/index.js:292-303`, at `astro:config:done`, does
  `if (existsSync(devVarsPath)) { … Object.assign(process.env, parsed) }`. That runs inside the
  child, **after** `webServer.env` was applied, so `.dev.vars` overwrites the verified map. The
  preflight reads only `.env` via `loadEnv` in the runner process, where `.dev.vars` was never
  merged — so it asserts against a file the server does not read. `README.md` already documents the
  precedence ("if both exist, Cloudflare ignores `.env` and reads `.dev.vars`") and `.gitignore`
  lists `.dev.vars`, i.e. a local-only file exactly the kind a developer creates. Measured: no
  `.dev.vars` on this machine today, so this is a latent **seam**, not a live incident — and it is
  verbatim the rule `lessons.md` states as "Preflight musi domknąć KAŻDY nielokalny szew", the
  sentence §3 Phase 6 uses to justify sub-phase 6.1 in the first place.
- **Fix**: Add a seventh config-time assertion — refuse when `.dev.vars` exists (message naming
  README's mutual-exclusivity rule), or parse it and run the same host/key assertions over the
  merged result. Add a fabricated unit case and a breakage run to Phase 1.
  - Strength: Three lines; makes the "binding" claim true rather than nearly true, before §6.6
    records it as a guarantee.
  - Tradeoff: Refusing outright is blunt for a developer who legitimately uses `.dev.vars`;
    parsing is friendlier and slightly more code.
  - Confidence: HIGH — read off the adapter source and confirmed against README's own warning.
  - Blind spot: Whether wrangler/workerd injects a further env source ahead of `process.env` in dev
    was not traced end to end.
- **Decision**: FIXED (parse-and-assert variant) — Phase 1 §1 now asserts over the **merged** map
  `{ ...loadEnv, ...forced, ...parseDevVars() }` with the adapter evidence and the
  name-the-right-file requirement; assertion 4 records that `.dev.vars` is the one source the
  forcing cannot cover; §5 gained two fabricated cases; a new breakage criterion 1.8 (Progress 1.8,
  manual shifted to 1.9/1.10); Implementation Approach's "the lever is `webServer.env`" paragraph
  names the exception.

### F3 — Project graph omits `testMatch` and the `storageState` override

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2 ("Projects: setup → chromium → teardown")
- **Detail**: Two omissions, both of which fail **silently** — the failure mode this whole change is
  written against. (a) `auth.setup.ts` and `cleanup.teardown.ts` do not match Playwright's default
  spec pattern, which requires `.test.` or `.spec.`; without an explicit
  `testMatch: /.*\.setup\.ts/` the setup project collects **zero** tests, and
  `dependencies: ["setup"]` on an empty project passes trivially — a green run that produced no
  session. (b) `playwright.config.ts:7` puts `storageState` in top-level `use`, so every project
  inherits it, setup included, and Playwright fails to create the context when the file is absent —
  precisely the state criterion 3.1 creates on purpose. The plan is elsewhere specific down to the
  line number in `node_modules`; this is the one place its contract is looser than the implementer
  needs.
- **Fix**: Spell both out in the Phase 1 contract — `testMatch` on the setup and teardown projects,
  and `storageState` moved out of top-level `use` into the `chromium` project only, with
  setup/teardown explicitly `storageState: undefined`.
- **Decision**: FIXED — Phase 1 §2's Contract now spells out both `testMatch` entries and the
  `storageState` move, with the empty-setup-project trivial pass named; criterion 1.4 and Progress
  1.4 gained the `--list` non-zero check.

### F4 — `assertAnonKey` ported "verbatim" — a second copy of a security predicate

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1, assertion 2 (and assertion 3, `assertLocal`)
- **Detail**: "Port `assertAnonKey` from `tests/setup/preflight.ts:33-65` verbatim" creates a second
  copy of the guard that decides whether a key bypasses RLS, with nothing keeping the two in step;
  the same applies to `assertLocal` (`:79-94`). Only line 1's `astro:env/server` import blocks
  reuse — the predicates themselves are pure (they take a string and throw). This repo
  single-sources exactly this class everywhere else (`deck-limits.ts`, `generation-limits.ts`), and
  §6.6 records the cost of a copy four separate times, most recently as "the sweep was found
  incomplete twice by reading, not by a red run".
- **Fix A ⭐ Recommended**: Extract the pure predicates into a shared module (e.g.
  `tests/setup/env-assertions.ts`) that both `preflight.ts` and `tests/e2e/setup/env.ts` import;
  preflight keeps its `astro:env` reads.
  - Strength: One definition, one test file, and the existing preflight gains the unit coverage it
    has never had.
  - Tradeoff: Touches a file outside this change's stated scope, and `preflight.ts` is load-bearing
    for the whole Vitest suite — the edit must be proved behaviour-neutral by a green run.
  - Confidence: HIGH — the two functions are pure and dependency-free.
  - Blind spot: `fail()`'s `HINT` text is preflight-specific; the shared module needs an injected
    formatter or a neutral message.
- **Fix B**: Keep the copy and add a guard test asserting the two implementations agree over a
  shared table of inputs.
  - Strength: Zero risk to the existing preflight.
  - Tradeoff: A third artifact to maintain, and it catches drift in behaviour only — never a copy
    nobody updated at all.
  - Confidence: MEDIUM — works, but it is the pattern this file criticises.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — Phase 1 §1 now specifies `tests/setup/env-assertions.ts` imported
  by both callers, keeps `assertMockGeneration` with the Astro-env caller, names the `HINT`
  formatter problem, and makes criterion 1.3 the behaviour-neutrality check for the refactor.

### F5 — `resolveE2eEnv()` takes no parameter — the rule the plan itself cites

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 (Contract) vs Phase 1 §5 (the unit test)
- **Detail**: Phase 1 §5 requires "every input fabricated; the real environment appears in no
  assertion" and cites §6.1's C10X-34 rule, stated as "extract the decision **and** its inputs".
  But the contract exports `resolveE2eEnv()` with no parameter: it reads `.env` through `loadEnv`
  and the filesystem through `existsSync`. So the criterion "the returned map carrying
  `OPENROUTER_API_KEY: \"\"`" is only testable in the state the runner happens to be in — the exact
  defect the cited rule exists to prevent. "Plus the individually testable predicates it composes"
  covers the predicates but not the map.
- **Fix**: Split the contract — a pure
  `buildE2eEnv(source: Record<string, string | undefined>, opts: { browserExists: boolean }): Record<string, string>`
  that is fully fabricable, plus a thin `resolveE2eEnv()` supplying `loadEnv(...)` and
  `fs.existsSync(chromium.executablePath())`.
- **Decision**: FIXED — Phase 1 §1's Contract now opens with the two-export split (pure
  `buildE2eEnv(source, opts)` carrying every assertion and the returned map; `resolveE2eEnv()` a
  deliberately assertion-free I/O wrapper), and §5 states that the unit test drives `buildE2eEnv`.

### F6 — The cross-process row registry can fail in the mode it exists to fix

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 3 §3 (`fixtures.ts`) and §4 (the teardown)
- **Detail**: Playwright workers are separate processes, so a "worker-scoped fixture that records …
  to a location the teardown project reads" must persist to disk and tolerate concurrent appends
  from several workers. Its failure mode is the bug it was written for: a worker that dies hard
  between creating the deck and flushing its entry orphans the row exactly as
  `E2E deck 1785947414992` was orphaned. The specs already mint run-unique `Date.now()` names, and
  the plan already notes the suffix is "what lets a teardown scope itself" — so the registry may be
  machinery for information the data already carries.
- **Fix A ⭐ Recommended**: Drop the registry. Mint one run id at config-module evaluation, pass it
  to the specs and the teardown via `webServer.env` / `process.env`, name every row
  `E2E <runId> …`, and let the teardown delete by `.like("name", "E2E <runId>%")` (plus F1's
  `generation_session` scope).
  - Strength: Nothing has to be recorded, so nothing can fail to be recorded — it survives a worker
    crash, which the registry cannot. One fewer file, no cross-process write.
  - Tradeoff: Binds cleanup to a naming convention, so a row created without that name escapes it —
    that constraint must go into §6.11.
  - Confidence: HIGH — the run-unique suffix already exists in both specs.
  - Blind spot: `generation_session` has no name column, so F1's scope needs the marker inside
    `source_text` instead.
- **Fix B**: Keep the fixture but register the **name** before the row is created, and append
  per-worker files under `outputDir` (safe: `removeOutputDirs` runs before any worker starts).
  - Strength: Works for rows a naming convention cannot scope.
  - Tradeoff: More machinery, and it still loses a row if the process dies between the write intent
    and the append.
  - Confidence: MEDIUM — correct, but strictly more moving parts.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix B — Phase 3 §3 now requires registering the NAME before the row is
  created, one file per worker under `outputDir` (safe because `removeOutputDirs` runs before any
  worker starts), and names the residual risk — a worker killed between the write and its flush —
  for §6.6's does-NOT-prove list rather than leaving it implied.

### F7 — `retries`-vs-`trace` left as an unresolved either/or

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2 ("pick one and say which in a comment")
- **Detail**: The two options are not equivalent here. `retries > 0` on a human-triggered,
  never-a-gate layer hides exactly the flakes this repo treats as findings — §6.2 ("a red under a
  fresh seed is normally a real inter-`it()` dependence"), and C10X-39, which spent a whole change
  measuring a transport flake rather than retrying past it. A plan that hands the implementer a
  coin-flip on that axis is handing over a policy decision.
- **Fix**: Decide it in the plan — keep `retries: 0` and set `trace: "retain-on-failure"`, which
  fires without a retry; the comment states the anti-flake reason, not just the mechanism.
- **Decision**: FIXED — Phase 1 §2 decides it: `retries: 0` + `trace: "retain-on-failure"`, with the
  §6.2 / C10X-39 anti-flake reason stated as the reason rather than the mechanism.

### F8 — Criterion 5.8 asserts a Ctrl-C guarantee that was never established

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 5 Manual Verification / Progress 5.8
- **Detail**: "Ctrl-C mid-journey leaves no orphaned deck" assumes a teardown **project** runs on
  SIGINT. Teardown projects are dispatcher phases and a SIGINT interrupts the run; the plan states
  the guarantee without measuring it. Relevant on this machine specifically: Playwright's
  `webServerPlugin` throws `"Graceful shutdown is not supported on Windows"`, so the Ctrl-C path
  here is not the documented happy path.
- **Fix**: Measure it and record the answer as observed. If teardown does not run on SIGINT, reword
  5.8 to what is true — under F6's Fix A the next run's prefix sweep is the answer; otherwise record
  it as a named gap in §6.6's does-NOT-prove list rather than dropping it.
- **Decision**: FIXED — Phase 5's Manual Verification and Progress 5.8 now read as a measurement
  with the answer recorded either way, carrying the dispatcher-phase and Windows-graceful-shutdown
  evidence; Phase 6 §3's does-NOT-prove list is where a negative answer lands.

### F9 — Phase 2 makes the specs' SOURCE CI-gated; nothing says so

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2, and Phase 6 §3's does-NOT-prove list
- **Detail**: `eslint.config.js` is repo-wide and `npm run lint` is a fail-closed CI step;
  `tests/e2e/**` is already inside `npm run typecheck` (§6.6's 2026-08-05 correction). Adding
  `eslint-plugin-playwright` means a Playwright-rule violation in a spec now reddens the `ci` job,
  while the layer itself still never runs. That is the compiles-vs-runs distinction this file
  already had to correct once — worth stating before, not after.
- **Fix**: One sentence in §6.6's does-NOT-prove list and in §4's e2e row: the gates say the layer
  compiles and lints, never that anything ran it.
- **Decision**: FIXED — Phase 6 §3's does-NOT-prove list gained the compiles-vs-runs bullet (with
  the not-a-softening-of-§5 clause), and Phase 6 §2's §4-row contract now states what the lint
  plugin buys.

### F10 — §7's nested `scroll-padding-top` deferral names this phase as its owner

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 6 §4 (§7 edits) vs "What We're NOT Doing"
- **Detail**: §7's 2026-08-05 re-decision says "whoever wires the e2e layer under §3 Phase 6
  inherits the cheapest place to collect the evidence". The plan declines it in What We're NOT
  Doing, but Phase 6 §4's contract covers only the **two** exclusions — so the nested deferral gets
  no dated entry and will read as an omission at impl-review rather than as a decision.
- **Fix**: Add the nested deferral to Phase 6 §4's checklist — record the decline with its date and
  its reason, the same way the two exclusions record their standing.
- **Decision**: FIXED — Phase 6 §4 is now "three sites, not two", with the nested deferral's
  decline to be recorded dated, with its reason and with its ownership restated so it points at
  something reachable.

## Triage outcome (2026-08-08)

All ten findings were fixed in `plan.md`; none skipped, accepted or dismissed.

| #   | Decision                 | Where the plan changed                                                                          |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| F1  | Fixed                    | Phase 3 §4 two-table teardown; criteria and Progress 3.3, 3.5, 5.5                              |
| F2  | Fixed (parse-and-assert) | Phase 1 §1 merged map; assertion 4; §5 cases; new criterion 1.8; Implementation Approach        |
| F3  | Fixed                    | Phase 1 §2 `testMatch` + `storageState` move; criterion 1.4's `--list` check                    |
| F4  | Fixed via Fix A          | Phase 1 §1 extraction to `tests/setup/env-assertions.ts`; criterion 1.3 as the neutrality check |
| F5  | Fixed                    | Phase 1 §1 `buildE2eEnv` / `resolveE2eEnv` split; §5 drives the pure half                       |
| F6  | Fixed via Fix B          | Phase 3 §3 register-before-create, per-worker files under `outputDir`, residual risk named      |
| F7  | Fixed                    | Phase 1 §2 decides `retries: 0` + `trace: "retain-on-failure"`                                  |
| F8  | Fixed                    | Phase 5 Manual and Progress 5.8 reworded from a guarantee into a measurement                    |
| F9  | Fixed                    | Phase 6 §3 does-NOT-prove bullet; Phase 6 §2's §4-row contract                                  |
| F10 | Fixed                    | Phase 6 §4 "three sites, not two"                                                               |

**One incidental correction, found while reconciling the fixes.** Testing Strategy said "Eleven"
deliberate-breakage runs while the phases listed **fourteen** — the total-versus-breakdown defect
§8 records against C10X-39, C10X-40 and C10X-42, committed by the very sentence naming the
discipline. Re-enumerated from the Progress section: **fifteen** after F2's addition (fourteen
automated — 1.5-1.8, 2.3-2.4, 3.4-3.5, 4.2-4.4, 5.2-5.4 — plus 4.6's breakage B). Corrected in
`plan.md` and `plan-brief.md`.

`plan-brief.md` was re-synced with the plan: three new rows in Key Decisions Made, the `.dev.vars`
merge in the config tier of the diagram, four new Open Risks, and both Success Criteria figures.
