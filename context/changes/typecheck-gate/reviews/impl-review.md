<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Typecheck Gate (C10X-43)

- **Plan**: `context/changes/typecheck-gate/plan.md`
- **Scope**: All 6 phases (full plan review)
- **Date**: 2026-08-03
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Success criteria re-run (this review, against the current tree)

| Check                                       | Result                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run typecheck`                         | exit 0 — `Result (133 files): 0 errors / 0 warnings`, `133 files checked (floor 50)` |
| `npm run lint`                              | exit 0 — 0 errors, 3 pre-existing `no-console` warnings in `evals/`                  |
| `npm test`                                  | **364/364, 31 files** — matches the recorded Phase 5/6 figure exactly                |
| `npm run build`                             | exit 0                                                                               |
| `npx astro check` (bare, hint-visible)      | `0 errors / 0 warnings / 0 hints` — the 4 `ts(6387)` are gone at source              |
| Archive diff shape                          | **13 files, 129 insertions, 0 deletions** — pure additions, as claimed by 6.6        |
| Non-null assertions repo-wide               | zero                                                                                 |
| `prettier --check` on edited non-archive md | clean                                                                                |
| CI step                                     | `ci.yml:54`, between `astro sync` (:22) and `lint` (:56), no `continue-on-error`     |
| husky                                       | `core.hooksPath` → `.husky/_`; `pre-push` runs `npm run typecheck`                   |
| `git status`                                | clean                                                                                |

Three criteria (2.2, 2.3, 2.5) remain unticked and are marked SHIP-TIME in the Progress
section. That is correct and precedented, not an omission: `ci.yml` triggers only on push to
`main` and `pull_request` to `main`, so a branch with no PR runs nothing — the same structural
reason `test-plan.md §8` records for C10X-39's criteria 2.3 and 2.5. They close at `/ship`.

## Scope guardrails — all six clean

| Guardrail                            | Result                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------ |
| No typecheck step in `eval.yml`      | ✅ grep returns nothing                                                  |
| No typecheck in the `deploy` job     | ✅ `ci.yml` diff has zero `deploy`/`drift` hits                          |
| Eval isolation byte-identical        | ✅ neither `vitest.eval.config.ts` nor `vitest.config.ts` is in the diff |
| `jira-map.md` not edited             | ✅ absent from the diff; flagged in `test-plan.md §8` instead            |
| No roadmap `Status` flipped          | ✅ only H-11 added, `Status` unset, absent from `## Done`                |
| `flashcards.ts` fields stay optional | ✅ `source?` / `state?` unchanged                                        |

## Findings

### F1 — A missing `node_modules` is reported as a config problem, and the `npm ci` hint it should print is unreachable for that case

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/run-typecheck.ts:84, 102-108, 162-171
- **Detail**: The catch block at `:164-170` prints _"The checker could not be started at all. If
  this is a fresh clone, run `npm ci` first."_ It is reached only when `result.error` is set. But
  the spawned binary is always `process.execPath`, which always exists — so a missing
  `node_modules` is a module-resolution failure _inside_ Node. Measured on this machine:

  ```
  spawnSync(process.execPath, ['./node_modules/astro-NOPE/bin/astro.mjs','sync'], …)
  → status = 1   error = undefined
  ```

  With no `result.error`, that flows into leg 1's ordinary path. `readSyncResult` finds no
  `[types] Generated` and the developer is told (`scripts/typecheck.ts:100-102`):

  > _astro sync failed before generating any types — this is a config problem, not a type error.
  > `astro.config.mjs` and the content/route definitions are what to look at._

  So a fresh clone is sent to `astro.config.mjs`, which is fine, and the `npm ci` line that was
  written for exactly this case never prints. The gate still **fails closed** (exit 1), so this is
  a diagnosis-quality defect, not a false green — but it is precisely the class commit `e962ff2`
  ("diagnose tsc failures by their actual class") was written to remove, reproduced one leg over.
  On a `pre-push` hook a misdiagnosis is a standing incentive to reach for `--no-verify`, which is
  the thing Phase 4's own rationale exists to remove.

- **Fix A ⭐ Recommended**: Give `readSyncResult` a third branch keyed on `Cannot find module`, returning the "run `npm ci`" reason, with a measured fixture beside `SYNC_REAL_FAILURE` in `tests/lib/typecheck.test.ts`.
  - Strength: Puts the decision in the pure half where it is testable and falsifiable — the same move `e962ff2` made for the tsc leg, so the fix matches the precedent the defect violates.
  - Tradeoff: Keys on an English message string from Node's loader, which could change across major versions; a wrong match degrades to today's behaviour, not worse.
  - Confidence: HIGH — reproduced the exact `status: 1 / error: undefined` shape by measurement.
  - Blind spot: Only the `astro sync` leg was measured; the `tsc` leg has the same shape and would want the same branch.
- **Fix B**: Add an `existsSync(ASTRO_BIN) / existsSync(TSC_BIN)` preflight in the runner with its own message.
  - Strength: Catches the cause directly rather than by matching a message, and covers both legs at once.
  - Tradeoff: Puts a new decision in the I/O half, which is deliberately untested by design — so it is carried by reading, against the split this file's own header defends.
  - Confidence: MEDIUM — correct, but it adds `node:fs` to a script whose header advertises `node:child_process` + `node:url` only.
  - Blind spot: Does not cover a `node_modules` that exists but is partially installed.
- **Decision**: FIXED via Fix A — third branch in `readSyncResult` keyed on `MODULE_NOT_FOUND` (the stable Node code, not the English sentence), plus two measured cases in `tests/lib/typecheck.test.ts`. Breakage run: removing the branch turns **1 of 21** red on the diagnosis case while the sibling rejection case stays green — the right split, since the old code also rejected, just with the wrong reason. Restored, MD5 `ac1c530c8ec7a8aa94dd0721f0082932`.

### F2 — Raw child exit statuses are propagated, and a status that is a positive multiple of 256 would exit 0

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/run-typecheck.ts:107, 123, 155
- **Detail**: Each failing leg returns the child's own status into `process.exitCode`. Measured:
  `node -e "process.exitCode=256"` makes the shell see **exit 0**. On Linux this is unreachable
  (a child status is already 0–255). On Windows a child can return a full 32-bit status — this
  file's own header documents `astro sync` returning `3221226505` — and husky's `_/h` runs the
  hook under `sh -e`, which truncates. Stated honestly: I could **not** reach the bad case with a
  plausible status. `0xC0000409`'s low byte is `0x09`, so it survives; the failure needs a status
  whose low byte is exactly `00`, which no observed run produces. So this is a latent edge, not a
  live defect — but it is the exact "a gate that reports success on a failure" class the change
  exists to close, and the specific code carries no information the printed message lacks.
- **Fix**: Normalise each failing return, e.g. `return status % 256 || 1`, or simply `return 1` on each failing leg.
- **Decision**: FIXED — `exitFor(status)` (`Math.abs(status) % 256 || 1`) at the three return sites. The RAW status is still what gets printed, since `3221226505` is the searchable string in the message; the narrowing applies only where the number stops being information and becomes a signal. Verified end to end: green run exit 0, a `TS2322` probe exit 2.

### F3 — A `maxBuffer` overflow fails closed but prints the "could not be started at all" diagnosis

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/run-typecheck.ts:76, 84
- **Detail**: `maxBuffer` is a generous 32 MB, and on overflow `spawnSync` returns
  `status: null, error: ENOBUFS, signal: SIGTERM` with stdout truncated. `if (result.error) throw`
  routes that to the catch, which exits 1 — correctly fail-closed, and it is the one case that can
  lose the `Result (N files):` line the verdict depends on, so failing closed matters. The
  residue is only that the message says the checker "could not be started at all… run `npm ci`",
  which is not the state the reader is in. Same misdiagnosis family as F1.
- **Fix**: Branch the catch on `err instanceof Error && "code" in err && err.code === "ENOBUFS"` with its own line.
- **Decision**: FIXED — the catch now branches on `err.code === "ENOBUFS"` and says the output was truncated and that this is not a verdict about the code. The `else` keeps the `npm ci` line, which after F1 is genuinely a spawn failure rather than the dead end it was.

### F4 — The Result-line parser takes the first match rather than the last

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/typecheck.ts:196, 204
- **Detail**: `RESULT_LINE.exec(output)` returns the **first** `^Result \((\d+) files?\)` match.
  Confirmed against `node_modules/@astrojs/check/dist/index.js:71` that the block is emitted
  exactly once and _after_ all diagnostics, so today there is only one match and the ANSI strip
  plus the singular/trailing-space tolerance are all correct. The residual risk is ordering: any
  earlier line matching at column 0 wins. In the usual direction that fails closed (a small number
  falls below the floor), but an earlier large number ahead of a genuine below-floor Result would
  be a false green. Narrow — diagnostic excerpts are indented, so column 0 is hard to hit.
- **Fix**: `[...output.matchAll(RESULT_LINE)].at(-1)` (add the `g` flag) — the block is always last by construction.
- **Decision**: FIXED — `RESULT_LINE` gained `g` and the reader is `[...output.matchAll(RESULT_LINE)].at(-1)`, plus a case asserting the FALSE-GREEN shape (`Result (999 …)` before a genuine `Result (3 …)` → `files: 3`, `ok: false`). First breakage run turned **3 of 22** red because reverting to `.exec` while keeping `g` changes TWO things — `lastIndex` bleeds across calls — so it was re-run against the exact pre-fix code (no `g`, `.exec`), giving the clean **1 of 22**. Recorded as observed rather than as predicted.

### F5 — The file-count claim went stale inside the change that changed it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/typecheck.ts:36, 44; tests/lib/typecheck.test.ts:303
- **Detail**: The docblock says _"`astro check` reports 130 files today (112 tsc roots + 18
  `.astro`)"_ and _"50 sits far enough below 130"_, and the test asserts
  `expect(MIN_CHECKED_FILES).toBeLessThan(130)`. The shipped gate reports **133** (verified by
  running it), and `README.md:49`, `AGENTS.md:22` and `test-plan.md:2765` all correctly say 133 —
  the count moved because Phases 1 and 5 added the three files the docblock describes. Nothing is
  broken: the floor is 50 and the parser is a regex. But three lines below the stale number the
  same docblock invokes _"this repository has recorded a count going stale four separate times"_
  as its justification for the floor being a floor, so this is the fifth — inside the file that
  cites the rule.

  **The fixtures at `:35`, `:82`, `:131`, `:134` are NOT stale and must not be touched** — they
  are the _measured_ output of the day, which the plan explicitly required ("the FM-1 fixture must
  be the **measured** text, not a paraphrase"). Only the two prose lines and the one assertion
  track project size.

- **Fix**: Say 133 in the two prose lines, and decouple the assertion from project size — `toBeLessThan(100)` expresses "a generous floor" without tracking file count at all.
- **Decision**: FIXED — prose now reads 133 (115 tsc roots + 18 `.astro`) with the staleness recorded at the site rather than silently corrected, and the test's upper bound moved from `130` to `100`, which bounds the FLOOR's generosity instead of the project's size and therefore cannot go stale again. The four `130` FIXTURES were deliberately left untouched: they are measured text, which the plan explicitly required.

### F6 — `"prepare": "husky"` is unguarded against a production install

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: package.json:22
- **Detail**: The plan established this script is CI-safe with no `|| true`, and that reasoning is
  correct **for the case it addresses** — husky's `index.js:11` returns a string when `.git` is
  absent rather than throwing, so a `.git`-less checkout exits 0. It does not cover a second
  case: husky is a devDependency, so any `npm ci --omit=dev` / `NODE_ENV=production` install fails
  the _entire install_ with `sh: husky: not found`. Not reachable today — every install path in
  this repo (`ci`, `deploy`, `eval.yml`) is a full `npm ci` — so this is insurance against a
  future Dockerfile or a Cloudflare build step, not a live defect.
- **Fix**: `"prepare": "husky || true"`, the form husky's own docs recommend for exactly this.
- **Decision**: FIXED — `"prepare": "husky || true"`.

### F7 — The eval's own report-write path is unaffected, but `evals/lib/judge.ts`'s backoff edit deserves its measurement recorded in the file

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: evals/lib/judge.ts:165-172
- **Detail**: No defect. Recorded because it is the one edit in the sweep that touches a paid
  external provider and it got the hard call right, which is worth being able to cite later:
  `TRUNCATION_BACKOFFS_MS = [3_000, 10_000]`, so attempt 0 → 3 s, 1 → 10 s, 2 → `undefined` →
  throw. `backoff !== undefined` is exactly the old `attempt < TRUNCATION_BACKOFFS_MS.length`
  bound with the value narrowed rather than the length re-derived, there is **no `?? 0`**, and a
  0 ms hot retry is unreachable. The comment naming that hazard matches the code. Verified against
  the array's actual contents and the loop bounds, not just read.
- **Fix**: None required — informational, so the next reader does not re-derive it.
- **Decision**: NO CHANGE NEEDED — informational; the code was already correct and the entry exists so the next reader need not re-derive it.

## What the review confirmed correct (no finding)

- **Cross-platform spawning** — `spawnSync(process.execPath, [ASTRO_BIN|TSC_BIN, …])` with
  absolute paths from `import.meta.url`. No `shell: true`, so no injection surface and no
  `.cmd`-shim `EINVAL`. `stdio: ["ignore", "pipe", "pipe"]` is load-bearing (it turns `astro
check`'s interactive install prompt into the exit-0-with-no-Result-line the gate rejects), and
  `status: result.status ?? 1` correctly turns a signal kill into a failure.
- **Exit code on every path** — enumerated: sync-fail → non-zero; tsc-fail → non-zero;
  verdict-not-ok → 1; check errors → non-zero; throw → 1. No zero-returning failure path apart
  from F2's truncation edge.
- **`StudySession.tsx`** — the ordering risk holds: `cards.length === 0` (`:250`) still precedes
  `!card` (`:264`), so an empty batch renders "Brak kart należnych dziś.", never "Sesja
  zakończona". `finished` is fully removed and the stale comment went with the code it described,
  as the plan required. No card can be skipped — `advance()` only ever does `i + 1`.
- **`generations.ts:76-85`** — `data.length === 0` → `!data[0]` is equivalent for a PostgREST
  result array (never sparse), and it collapses the guard and the `first.deck.public_id` read
  into one fact.
- **The nUIA sweep weakens no assertion.** Each `?.` sits behind an assertion that already fails
  on the empty case, and `toHaveLength` on `undefined` fails rather than passing vacuously. Three
  sites got the hard call right and say so at the site:
  `error-param-guard.test.ts:67-69` uses `expect(surface).toBeDefined(); if (surface === undefined) return;`
  instead of a default; `:329` picks `?? ""` _because_ `WRAPPED_Q` cannot match the empty string,
  i.e. the default is red-preserving; `form-endpoint-guards.test.ts:99-101` drops
  non-participating captures rather than defaulting them. `form-endpoint-guards.test.ts:117-122`
  is a genuine **strengthening**: filtering `""` out of the owned-name set closes a hole where a
  trailing comma in an import list would have produced `\b\b` and vouched for every local in the
  file.
- **`scripts/` pattern compliance** — mirrors the `schema-drift.ts` / `check-schema-drift.ts`
  precedent in split, naming, header structure, export shape, and the "I/O half is deliberately
  untested" boundary. AGENTS.md's `scripts/` exception fully obeyed: sibling import **with the
  `.ts` extension**, no `@/*`, no `astro:env/server`, `node:` builtins only, `console.*` confined
  to the runner behind the same file-scoped disable `check-schema-drift.ts` uses.
- **`eslint.config.js` migration** — all four call sites moved to `defineConfig`, the file-level
  `no-deprecated` disable removed with the rationale it carried, and the replacement comment
  records both halves of the old rationale as measured false. `0 hints` confirmed hint-visibly.
- **`readSyncResult` is a justified addition beyond the plan** — it handles a measured Windows
  defect (`astro sync` writes the types, prints `[types] Generated`, then aborts at teardown with
  `0xC0000409` at ~1 run in 5). Judging that leg by its exit code would have made the gate
  intermittently red _on a successful sync, with the wrong diagnosis_ — the strongest argument
  against it being scope creep. It has a positive control (a real config failure never reaches the
  marker), so the leg is falsifiable.

## Triage outcome (2026-08-03)

| Finding | Decision                         |
| ------- | -------------------------------- |
| F1      | FIXED via Fix A                  |
| F2      | FIXED                            |
| F3      | FIXED                            |
| F4      | FIXED                            |
| F5      | FIXED                            |
| F6      | FIXED                            |
| F7      | NO CHANGE NEEDED (informational) |

Six fixed, none skipped, none accepted-as-risk. Files touched by the triage:
`scripts/typecheck.ts`, `scripts/run-typecheck.ts`, `tests/lib/typecheck.test.ts`,
`package.json`.

**Post-triage verification, all re-run against the fixed tree:**

| Check                                                 | Result                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` (green tree)                      | exit **0**                                                                                                    |
| `npm run typecheck` (`TS2322` probe under `src/lib/`) | exit **2**, naming file and line — the `exitFor` change preserves a real failure; probe deleted, `src/` clean |
| `npm run lint`                                        | exit 0 — 0 errors, the same 3 pre-existing `no-console` warnings in `evals/`                                  |
| `npm test`                                            | **367/367, 31 files** (was 364; **+3** = two F1 cases and one F4 case, no assertion moved)                    |
| `npm run build`                                       | exit 0                                                                                                        |

**Both new guards were proved falsifiable, and one breakage run had to be re-run:**

- F1 — removing the `MISSING_MODULE` branch turns **1 of 21** red, on the diagnosis case only.
  The sibling rejection case staying green is the evidence rather than a gap: the old code also
  rejected an uninstalled checker, it simply blamed the config, so only the diagnosis half is new.
- F4 — the first attempt reverted `.at(-1)` to `.exec` while leaving the `g` flag on and turned
  **3 of 22** red. That is two variables, not one: a `g` regex carries `lastIndex` across calls,
  so the two extra reds were state bleed rather than first-vs-last. Re-run against the exact
  pre-fix code (no `g`, `.exec`) it is a clean **1 of 22**. Recorded as observed rather than as
  predicted — the same discipline this repo applies to C10X-29's `missingLocal` neuter and
  C10X-30's case 8.

Every restore was verified by MD5 against a pristine copy taken before the edit
(`scripts/typecheck.ts` → `ce7aaeb4d7d3d6c6446dd700dbb4e4f2`), and `git status` is clean for
`src/`.

**Not done here, deliberately:** the changes are uncommitted — this repo commits on the user's
say-so. F1's blind spot also stands: the `tsc` leg has the same `status: 1 / error: undefined`
shape if `typescript` alone is missing, which only a partial install produces (leg 1 catches a
wholly absent `node_modules` first). Left as recorded residue rather than silently widened scope.
