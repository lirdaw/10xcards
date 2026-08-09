<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: E2E harness + two browser journeys (C10X-46)

- **Plan**: `context/changes/e2e-harness-journeys/plan.md`
- **Scope**: Phases 1–6 of 6 (all complete)
- **Date**: 2026-08-09
- **Verdict at review time**: REJECTED (one critical security finding)
- **Verdict after triage**: **APPROVED** — all 9 findings fixed and each proved falsifiable
- **Findings**: 1 critical, 4 warnings, 4 observations — 9 fixed, 0 skipped, 0 accepted

> The initial verdict followed this skill's rubric — any critical safety FAIL rejects. It was
> **not** a judgment on the change as a whole: plan adherence is 20/20 with zero drift, every scope
> boundary holds, and every automated criterion was independently re-run green during this review.
> One parser was the whole of it, and it is closed.

## Verdicts

| Dimension           | At review | After triage |
| ------------------- | --------- | ------------ |
| Plan Adherence      | PASS      | PASS         |
| Scope Discipline    | PASS      | PASS         |
| Safety & Quality    | FAIL      | **PASS**     |
| Architecture        | PASS      | PASS         |
| Pattern Consistency | WARNING   | **PASS**     |
| Success Criteria    | PASS      | PASS         |

## State after triage

| Gate                              | Before triage                         | After triage                                               |
| --------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `npm run typecheck`               | `Result (145 files): 0 errors`        | unchanged                                                  |
| `npm run lint`                    | 0 errors, 3 pre-existing `no-console` | unchanged                                                  |
| `npm test`                        | 399 passed / 399, 33 files            | **402 passed / 402, 33 files** (+3, all F7's origin cases) |
| `npm run e2e`                     | 12 passed                             | 12 passed                                                  |
| deck / generation_session residue | 0 / 0                                 | 0 / 0                                                      |

Six deliberate-breakage runs were executed during triage, each restored and each restore verified
by hash or by an empty `git diff`. Three of them are **pairs** whose green half is the evidence —
F3 (old reader loses 2 decks + 1 session where the new one loses only the corrupted entry), F4 (old
reader reports a clean teardown in 4 ms having deleted nothing), and F1 (23 of 26 cases stay green
while exactly the three `export` cases go red).

## Independent verification performed during this review

Every figure the change documents was re-measured, not cited:

| Gate                                        | Documented                         | Re-measured today |
| ------------------------------------------- | ---------------------------------- | ----------------- |
| `npm run typecheck`                         | `Result (145 files): 0 errors`     | identical         |
| `npm run lint`                              | exit 0, 3 `no-console` in `evals/` | identical         |
| `npm test`                                  | 399 passed / 399, 33 files         | identical         |
| `npm run e2e` (warm)                        | 12 passed, 15.3 s                  | 12 passed, 21.4 s |
| `npm run e2e` (cold cache, `.vite` deleted) | 12 passed, 21.1 s                  | 12 passed, 21.1 s |
| deck / generation_session residue           | 0 / 0                              | 0 / 0, twice      |
| `grep -cF "### 6.11"`                       | 1                                  | 1                 |
| `prettier --check` on edited markdown       | clean                              | clean             |
| `git status --porcelain -uall`              | clean                              | clean             |

Scope guardrails verified independently: no workflow references e2e or playwright; no `schedule:`
added; `jira-map.md` untouched; the orphaned `E2E deck 1785947414992` still present (deliberately
not deleted); roadmap H-12 present with Status `doing` (flip correctly left to `/10x-archive`);
§5's e2e row still reads **never a gate**.

## Findings

### F1 — `.dev.vars` preflight is bypassed by `export KEY=value`, booting the dev server against a cloud project

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/setup/env.ts:211-231 (consumed at :191)
- **Detail**: The preflight parses `.dev.vars` with a first-party `parseDevVars`; the child parses
  the **same file** with `node:util`'s `parseEnv` (`@astrojs/cloudflare/dist/index.js:20,292-303` —
  verified). The two disagree, in the unsafe direction. `parseDevVars` splits on the first `=` and
  takes everything before it as the key (`:218-221`), so `export SUPABASE_URL=…` is stored under the
  key `"export SUPABASE_URL"` and `effective.SUPABASE_URL` is never touched; Node's `parseEnv`
  strips `export `. Reproduced end to end against the real modules during this review:

  ```
  .dev.vars:  export SUPABASE_URL=https://prod-project.supabase.co
              export OPENROUTER_API_KEY=sk-or-v1-real

  node:util parseEnv → {"OPENROUTER_API_KEY":"sk-or-v1-real","SUPABASE_URL":"https://prod-project.supabase.co"}
  repo parseDevVars  → {"export SUPABASE_URL":"…","export OPENROUTER_API_KEY":"…"}
  buildE2eEnv        → PASSED, returns SUPABASE_URL=http://127.0.0.1:54321, OPENROUTER_API_KEY=""
  ```

  `.dev.vars` is the **one source `webServer.env` cannot outrank** — the plan says so explicitly and
  makes the assertion, not the forcing, the entire guarantee there. So a green preflight is followed
  by `Object.assign(process.env, parseEnv(data))` inside the child, and the journeys then create
  decks and cards through the UI against **production**, with generation placing **billed OpenRouter
  calls carrying the journey's source text**. The teardown runs in the runner against the asserted
  local URL and deletes nothing there. `export FOO=bar` is how env lines are copy-pasted out of
  shell instructions, so the shape is ordinary rather than exotic. The module's own docstring names
  this failure direction ("every shape it does not parse simply stays invisible … the failure
  direction to watch if a refusal ever reads as a false green"); it under-estimated how cheaply it
  is reached.

  A second, latent instance of the same divergence: `readDevVars` resolves `.dev.vars` from
  `process.cwd()` (`:191`) while the adapter resolves it from `new URL(".dev.vars", config.root)`.
  Identical for the documented invocation from the repo root, divergent otherwise — and in the
  divergent case the preflight asserts against a file the server does not read.

- **Fix**: Delete `parseDevVars` and call `parseEnv` from `node:util` — the exact function the child
  uses. Repoint `tests/lib/e2e-env.test.ts`'s `parseDevVars` block at it and add an
  `export KEY=value` case as the regression pin. Resolve the path from the repo root
  (`import.meta.dirname`-derived) rather than `process.cwd()` in the same edit.
  - Strength: Eliminates the divergence **class** by construction rather than patching one shape —
    which is this repo's own stated standard (`env-assertions.ts`: single-source rather than keep
    two copies in step). `parseEnv` is built-in, so the reason `parseDevVars` was written at all
    ("this repo carries no `dotenv` dependency to borrow") is satisfied better, not worse.
  - Tradeoff: Removes a tested first-party module and its documented narrowness; `parseEnv`'s
    behaviour on exotic shapes becomes Node's contract rather than this repo's, which is the point
    but is a real handover.
  - Confidence: HIGH — the adapter's import was read at source and the bypass reproduced end to end
    in this review, not inferred.
  - Blind spot: Other `.dev.vars` shapes where the two parsers still differ were not enumerated;
    switching to `parseEnv` makes that enumeration unnecessary, which is the argument for switching
    rather than hardening.
- **Decision**: FIXED — applied as written (2026-08-09).
  - `parseDevVars` deleted; `readDevVars` now calls `parseEnv` from `node:util`, filtering
    `NodeJS.Dict<string>`'s `undefined` values rather than casting, so `originOf`'s `key in devVars`
    stays honest. `.dev.vars` and `loadEnv`'s dir now resolve from a module-derived `REPO_ROOT`
    instead of `process.cwd()`, closing the second divergence in the same edit.
  - `tests/lib/e2e-env.test.ts`'s `parseDevVars` block is replaced rather than repointed: with no
    first-party parser left, testing Node's would be testing Node. The 8 parser cases became 8
    cases that feed **real `.dev.vars` text, parsed the way the server parses it**, into
    `buildE2eEnv` — six syntaxes of a cloud `SUPABASE_URL` (including two `export` shapes), an
    `export`-prefixed `OPENROUTER_API_KEY`, and a positive control. The suite total is therefore
    unchanged at 399, correctly.
  - **Breakage run**: the pre-fix hand-rolled parser reinstated as a probe → **3 of 26 red** in
    `tests/lib/e2e-env.test.ts`, exactly the three `export` cases, on
    `AssertionError: expected [Function] to throw an error`, while the other 23 — including the
    non-`export` cloud cases and the positive control — stayed green. Probe removed; `env.ts`
    md5 `52b092ee8cdb857c7652ab015860616c` unchanged across the run.
  - **End-to-end confirmation**: the exact payload that passed before now refuses with
    `SUPABASE_URL (from .dev.vars) points at "prod-project.supabase.co", not the local stack`.
  - Gates after the fix: `typecheck` `Result (145 files): 0 errors`; `lint` 0 errors / 3
    pre-existing `no-console`; `npm test` **399/399, 33 files**; `npm run e2e` **12 passed**.

### F2 — The teardown's residue oracle reads a failed query as zero residue

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/teardown/cleanup.teardown.ts:110-121
- **Detail**: `countDecks` and `countSessions` destructure only `{ count }` and `return count ?? 0`,
  discarding `error`. Any failure of the count round-trip — transport, 4xx, RLS — yields
  `count === null`, becomes residue `0`, and satisfies
  `expect({decks, sessions}).toEqual({decks:0, sessions:0})` at `:52` while the rows are still
  there. That assertion is the layer's entire cleanup guarantee. Not theoretical in this repo:
  C10X-39 measured a Kong keep-alive `502` on this stack and mitigates it with
  `tests/setup/retry-transport.ts`, which is a Vitest `setupFiles` entry and is **not installed in
  the e2e layer** (verified: no reference in `playwright.config.ts` or `tests/e2e/`). Same shape as
  §6.6's `listDueCounts` false pass — a denial asserted as absence decaying into a pass. The delete
  path at `:78-88` handles its error correctly; the counts should match it.
- **Fix**: Push a count error onto `failures` (already asserted empty at `:51`) and make the residue
  non-nullable — e.g. `if (error) failures.push(...); return count ?? -1;`.
- **Decision**: FIXED — applied as written (2026-08-09).
  - Both counters now return the **whole** response (`CountResult`) instead of `count ?? 0`, and a
    new `tally()` converts it: an `error` **or** a `null` count is pushed onto `failures` and
    returns the sentinel `-1`, so an unreadable count can never be laundered into "zero rows left".
    The docblock records why (`listDueCounts` false-pass shape; `retry-transport.ts` is a Vitest
    `setupFiles` entry this Playwright layer does not load).
  - **Breakage run**: `countDecks` forced to return `{count: null, error: null}` — the exact shape a
    failed round-trip produces → **1 of 12 red**, the teardown itself, at `cleanup.teardown.ts:51`.
    Before the fix that identical state yielded residue `0` and passed green. Probe removed; md5
    back to `a56415428a8a9cf0ff2c78287e21bd05`.
  - Side confirmation: the run attached `trace.zip`, so `trace: "retain-on-failure"` is genuinely
    reachable with `retries: 0` — the repair the plan chose over a non-zero `retries`.
  - `npm run typecheck` `Result (145 files): 0 errors` after the change.

### F3 — One torn registry line makes the teardown delete nothing at all

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/teardown/cleanup.teardown.ts:100-108
- **Detail**: `readRegistry` maps every non-blank line through `JSON.parse(line)` with no
  `try`/`catch`. `appendFileSync` is not atomic against a hard kill, so a worker killed mid-append
  can leave a torn final line — precisely the crash scenario `fixtures.ts:22-25` names as the
  registry's residual risk, and the one `verification.md`'s 5.8 measured by abrupt termination. In
  that state the parse throws, the teardown test fails, and **none** of the well-formed entries on
  the preceding lines are deleted either: the mechanism built to narrow crash-orphaning amplifies it
  from one lost entry to the whole run's rows. `readdirSync` + `readFileSync` will also throw
  `EISDIR` if anything ever creates a subdirectory under the registry dir.
- **Fix**: Parse per line inside a `try`/`catch` — record the unparseable line into `failures` so it
  stays loud, but let every well-formed entry be deleted; filter `readdirSync(dir, {withFileTypes:true})` to files.
- **Decision**: FIXED — applied as written (2026-08-09).
  - `readRegistry(dir, failures)` now parses per line in a `try`/`catch`: a torn line is skipped and
    pushed onto `failures` (naming the worker file and the truncated text), while every well-formed
    entry above it is still deleted. `readdirSync(dir, {withFileTypes:true}).filter(isFile)` closes
    the `EISDIR` route to the same "abandon everything" outcome. `failures` is declared before the
    read so the record survives the empty-registry short-circuit.
  - **Breakage run, as a PAIR** — the same probe (a torn `{"kind":"deck","na` appended after every
    registration in `fixtures.ts`) against both readers, with the account cleaned to `0/0` between:

    | Reader                      | Result                                                                                                                      | Rows left behind                                                 |
    | --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
    | old, unguarded `JSON.parse` | red with a raw `SyntaxError: Expected ':' after property name in JSON at position 20` at `.map((line) => JSON.parse(line))` | **2 decks / 1 session** — including the entries that parsed fine |
    | new, guarded                | red on named `failures` at `:51`, each torn line quoted                                                                     | **1 deck / 1 session** — only the corrupted entries              |

    Same probe, both loud, and the fix strictly narrows the loss — which is the claim. Probes
    removed: `cleanup.teardown.ts` md5 back to `ac5f34cbb3a794973b953f95b2f8d774`, `fixtures.ts`
    diff against `HEAD` empty; probe rows deleted; a clean `npm run e2e` afterwards is **12 passed**
    with residue `0/0`.

  - `npm run typecheck` `Result (145 files): 0 errors`; `npm run lint` 0 errors.

### F4 — The residue post-condition is vacuous on an empty registry, and its comment claims otherwise

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/teardown/cleanup.teardown.ts:42-53, :72, :100-101
- **Detail**: The comment at `:46-50` claims the residue assertion catches "a delete that silently
  matched nothing — wrong predicate, wrong account, **a registry read from the wrong directory**".
  It cannot catch the third. If the directory is wrong, `readRegistry` returns `[]` (`:101`),
  `removeRegisteredRows` short-circuits at `:72`, and the residue is computed from that same empty
  list — so `{decks:0, sessions:0}` is vacuous and the run reports a clean teardown having deleted
  nothing. Reachable without touching the teardown: the writer uses `workerInfo.project.outputDir`
  (`fixtures.ts:70`), the reader uses `teardown.info().project.outputDir` (`:43`), and they agree
  today only because no project sets `outputDir` so all three resolve to the shared default. Adding
  a per-project `outputDir` to `chromium` — an ordinary artifact-separation change — decouples them
  silently. In a file whose own discipline is that a comment claiming coverage it lacks is a defect,
  the overstated comment is the finding as much as the vacuity is.
- **Fix A ⭐ Recommended**: Read the registry from a config-level constant independent of
  `project.outputDir`, and correct the comment to state what the assertion does and does not cover.
  - Strength: Removes the decoupling at the root; the writer and reader stop depending on two
    different projects agreeing about a field neither sets.
  - Tradeoff: The directory then sits outside `outputDir`, so it loses `removeOutputDirs`' free
    start-of-run wipe — the very property `fixtures.ts:15-20` relies on to guarantee the teardown
    reads only this run's registrations. That would have to be replaced explicitly.
  - Confidence: MEDIUM — the ordering guarantee is load-bearing and its replacement is not free.
  - Blind spot: Whether a non-`outputDir` location interacts badly with parallel `npm run e2e`
    invocations was not checked.
- **Fix B**: Keep the location and make the post-condition non-vacuous instead — assert the teardown
  observed at least the registry files the run was expected to produce — and correct the comment.
  - Strength: Preserves the `removeOutputDirs` guarantee untouched; strictly additive.
  - Tradeoff: Encodes an expectation about worker count / spec set that a future spec change must
    remember to update.
  - Confidence: HIGH — no mechanism moves, only an assertion is added.
  - Blind spot: A run where journey A is skipped legitimately registers less, so the expectation
    needs care not to become brittle.
- **Decision**: FIXED via Fix B, in a stronger form than proposed (2026-08-09).
  - The brittle count-expectation was avoided entirely. Instead the teardown reads **every
    project's** registry directory —
    `teardown.info().config.projects.map((p) => registryDir(p.outputDir))`, de-duplicated
    (`FullProject.outputDir` is public API, verified in `playwright/types/test.d.ts:803`). That
    removes the writer/reader coupling rather than documenting it, so no expectation about worker
    count or spec set is encoded and nothing becomes brittle.
  - The comment is corrected: the false third claim ("a registry read from the wrong directory") is
    gone, replaced by a statement of the coupling and of what the assertion still does **not**
    cover — a run that registered nothing is indistinguishable from a run that cleaned perfectly,
    which is correct for read-only journey B.
  - **Breakage run, as a PAIR** — `chromium` given `outputDir: "test-results-chromium"`, the
    ordinary artifact-separation change, with the account cleaned to `0/0` between:

    | Reader                | Teardown          | Rows left behind                                                        |
    | --------------------- | ----------------- | ----------------------------------------------------------------------- |
    | old, single-directory | **green in 4 ms** | **2 decks / 1 session** — the vacuous false green, exactly as described |
    | new, all projects     | green in 124 ms   | **0 / 0**                                                               |

    The registry was confirmed to have genuinely landed in `test-results-chromium/.e2e-registry`,
    so the old reader's green really was "looked in the wrong place and found nothing". **The GREEN
    half is the evidence here** — same shape as journey B's E1 falsification.

  - Probes removed: `playwright.config.ts` md5 back to `8b688c98a770fa51ef05ca80fa06e044`, stray
    directory deleted, probe rows deleted. Final state: `npm run e2e` **12 passed**, `npm test`
    **399/399, 33 files**, `typecheck` **145 files / 0 errors**, `lint` 0 errors, residue `0/0`.

### F5 — A caller-supplied marker flows unescaped into a `LIKE` DELETE pattern

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/fixtures.ts:85-87 → tests/e2e/teardown/cleanup.teardown.ts:87, :119
- **Detail**: `registry.generation(marker)` accepts any string, and the teardown issues
  `.like("source_text", \`${marker}%\`)`. `%`and`_`are LIKE metacharacters, so`e2e_`matches`e2eX…`and a marker containing`%`matches essentially everything. Blast radius is genuinely
bounded — RLS caps it to the shared e2e account, and both DELETE policies are`using (user*id = (select auth.uid()))`— but it can still delete a concurrent or previous run's`generation_session`rows on that account, and the residue check at`:119`uses the **same**
over-matching predicate, so it would still read`0`. The invariant exists today only as prose in
one spec (`accepted-card-survives-reload.spec.ts:119`, "Bez `%`ani`*`") — an obligation on the
  next spec author rather than something the API that mints the marker enforces, which is exactly
  the "closed by construction is not closed by a test" distinction this repo draws elsewhere.
- **Fix**: Reject a marker matching `/[%_\\]/` inside `registry.generation()`, with a message naming
  the rule — validating where the marker is minted keeps the refusal next to the author who can fix it.
- **Decision**: FIXED — applied as written (2026-08-09).
  - `assertLiteralMarker` in `tests/e2e/fixtures.ts` refuses any marker containing `%`, `_` or `\`,
    from inside `registry.generation()`. Because registration happens **before** creation, the
    refusal lands before any row exists and the wildcard never reaches a DELETE at all.
  - The message states the mechanism and the remedy (`LIKE '<marker>%'` … "use a literal prefix such
    as `e2e-${Date.now()}`"), and the docblock records the RLS bound honestly: the blast radius was
    always capped at the shared e2e account by `generation_session_delete`'s
    `using (user_id = (select auth.uid()))`; what this closes is over-matching **within** it.
  - **Breakage run**: journey A's marker changed to `e2e_%${Date.now()}` → **1 of 12 red**, on
    `Error: Registry marker "e2e_%1786296476110" contains a LIKE metacharacter (% _ \)…`. Probe
    reverted (`git diff` empty); clean re-run **12 passed**, residue `0/0`.
  - `typecheck` 145 files / 0 errors; `lint` 0 errors.

### F6 — This change introduced its own pointer rot: `preflight.ts:138` no longer exists

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/setup/env.ts:9, tests/e2e/setup/auth.setup.ts:39
- **Detail**: Both cite `tests/setup/preflight.ts:138` as the ordering rule they are aligned
  against. The same change shortened that file to **75 lines** (verified), so the citation resolves
  to nothing. This is the class `test-plan.md` §8 records repeatedly — and the review criterion 6.5
  ("every `file:line` written into the docs resolves on disk") was scoped to the docs, so the two
  new source files fell outside it.
- **Fix**: Cite the symbol (`assertLocal` / preflight's "Before reachability" comment) rather than a
  line number, as `env-assertions.ts` already does.
- **Decision**: FIXED (2026-08-09). Both sites now cite `tests/setup/preflight.ts`'s `assertLocal`
  call and quote its "Before reachability: never even send a request to a non-local host" comment,
  with a note that the citation is by symbol precisely because this change moved that file.

### F7 — `originOf` reports a shell-supplied value as coming from `.env`

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/setup/env.ts:141
- **Detail**: `originOf` decides between `.env` and `.dev.vars` by `key in devVars`, but vite's
  `loadEnv` with an empty prefix overlays `process.env` **on top of** the parsed files — verified
  behaviourally in this review: `SUPABASE_URL=https://from-shell.supabase.co npm …` makes `loadEnv`
  return the shell value. The refusal still fires correctly (no safety hole), but it names `.env`,
  sending the reader to edit a file that does not contain the offending value. That is the C10X-43
  "correct verdict, wrong diagnosis" trap this helper was written to prevent, on its third source.
- **Fix**: Compare against `process.env` too and emit a third origin label ("from the shell environment").
- **Decision**: FIXED (2026-08-09). `buildE2eEnv` gained an `opts.shellEnv` **parameter** — an input,
  never read from the ambient environment inside the pure half, per §6.1's C10X-34 rule — and
  `originOf` now resolves three origins in the child's own precedence: `.dev.vars` → the shell →
  `.env`. The shell is named only when it is the value that actually won; where the shell and
  `.env` agree they are indistinguishable and either answer is actionable, which the comment states
  rather than hides. Three fabricated cases added (shell blamed, `.env` blamed, `.dev.vars` blamed
  ahead of both) — the **+3** that takes the Vitest suite from 399 to **402**.

### F8 — The designated exemplar spec teaches the opposite of the layer's `exact: true` rule

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/seed.spec.ts:18, :35-36, :40, :44
- **Detail**: `seed.spec.ts` is explicitly the file "`/10x-e2e` learns conventions from" (`:1`) and
  uses **no `exact: true` anywhere** (verified: 0 occurrences), while the layer declares it a
  layer-wide rule in three other places — `auth.setup.ts:66-72` ("assume it applies to every name in
  this layer rather than discovering it one locator at a time"), `accepted-card-survives-reload.spec.ts:175-176`,
  and the new §6.11. None of its locators is currently ambiguous, so this is a teaching defect
  rather than a live one.
- **Fix**: Add `exact: true` to `seed.spec.ts`'s locators, or a one-line note there pointing at the rule.
- **Decision**: FIXED (2026-08-09). All five locators in `seed.spec.ts` now carry `exact: true`
  (dialog, trigger button, textbox, submit button, the deck link ×2), with a comment stating that
  none of them is ambiguous _today_ and that the flag is there because this is the file `/10x-e2e`
  learns conventions from — an exemplar teaching something other than the declared rule is worse
  than no exemplar. Verified by running the layer: **12 passed**, so the tightening did not break
  a single locator.

### F9 — `isAlreadyRegistered` duplicated byte-for-byte

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/setup/account.ts:39-41 (vs tests/fixtures/accounts.ts:37-39)
- **Detail**: The two bodies are identical. This change's own thesis is that a copied predicate is
  the class §6.6 records the cost of four times, and it acted on that for `assertAnonKey` /
  `assertLocal` — where an `astro:env/server` import was the only obstacle. Here there is no
  obstacle at all, only a missing shared module. Low stakes (a signup-tolerance check, not a
  security guard), which is presumably why it was left, but it is the one shared predicate the
  change did not single-source.
- **Fix**: Move it beside the other extracted predicates in `tests/setup/env-assertions.ts` or a
  sibling shared module.
- **Decision**: FIXED (2026-08-09). `isAlreadyRegistered` moved into `tests/setup/env-assertions.ts`
  beside `assertAnonKey` / `assertLocal`; both copies deleted and both harnesses now import it —
  `tests/fixtures/accounts.ts` (extensionless, its siblings' convention) and
  `tests/e2e/setup/account.ts` (with `.ts`, as Playwright's loader requires). The docblock records
  why both clauses exist (a machine-readable `code` on current GoTrue, the legacy message text
  otherwise) so neither is dropped as redundant. Behaviour-neutrality is carried the only way a
  refactor can carry it — a green run of both harnesses: `npm test` **402/402** and `npm run e2e`
  **12 passed**, each exercising a different call site.
