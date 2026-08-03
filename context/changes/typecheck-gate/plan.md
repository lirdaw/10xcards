# Typecheck Gate (C10X-43) Implementation Plan

## Overview

Wire a type gate into this project — an npm script, a CI step, and a local `pre-push` hook —
so a type error can no longer hide behind a fully green `lint` + `build` + `test`. The gate is
`astro check` (130 files: 112 tsc roots + 18 `.astro`) preceded by `tsc --noEmit` (which sees
the `TS5xxx` config-error class `astro check` is blind to), driven by a wrapper that asserts on
the checker's **output** rather than trusting its exit code. The same change turns on
`noUncheckedIndexedAccess` and sweeps the 33 sites it surfaces.

## Current State Analysis

`package.json:5-21` has 15 scripts and no `typecheck`. `.github/workflows/ci.yml:21-29` runs
`npm ci` → `astro sync` → `lint` → `build`, none of which performs TypeScript diagnostics:
`npm run lint` is ESLint with type-**aware rules**, `astro build` does not run `astro check`,
and `npm test` deliberately never collects `evals/**`. That is the exact gap C10X-41 measured —
reverting to `b015662` makes `npx tsc --noEmit` exit 2 on a single `TS2353` in
`evals/generation-quality.eval.ts`, meaning Risk #7's only acceptance instrument sat
uncompilable for two fully green phases.

Both candidate commands are green on `main` @ `9fb37bb` today, re-verified for this plan:
`npx astro check` → exit **0**, `Result (130 files): 0 errors / 0 warnings / 4 hints`.
`scripts/` passes despite being AGENTS.md's documented exception to the import rules, so the
charter's "confirm rather than assume" item is closed and nothing has to be weakened on day one.

The local half does not exist at all. `.husky/pre-commit` is tracked and contains
`npx lint-staged`, but `.husky/_/` is absent, `core.hooksPath` is unset in every scope, and
`.git/hooks/` holds only `*.sample` — re-verified for this plan. Root cause is a missing
`prepare` script, so husky v9 never installed itself. Consequence: **AGENTS.md's claim that a
pre-commit hook auto-fixes commits is false in this tree**, and enabling husky starts running
`prettier --write` on three currently-dirty foundation documents for the first time.

## Desired End State

`npm run typecheck` exists, runs both checkers, and refuses to report success on a run that
checked nothing. CI runs it between `astro sync` and `lint`, fail-closed. A `pre-push` hook runs
it locally. `noUncheckedIndexedAccess` is on with a zero-error tree. `test-plan.md §5`'s first
gate row — which claims `lint + typecheck` is "wired today" and is presently false in **both**
halves — becomes true, and of the 11 live documentation claims that the project has no type gate, **10 are
corrected and 1 is flagged** — `jira-map.md:86` is owned by the Jira skills and deliberately not
hand-edited. One of the ten ships as executable output in a job log.

Verification: `npm run typecheck` exits 0 on a clean tree and 1 on each falsification probe;
a CI run shows the step green before `lint`; `git push` triggers the hook.

### Key Discoveries:

- `astro check` is a genuine superset of `tsc` at identical strictness — same `tsconfig.json`
  resolved by `@astrojs/language-server/dist/check.js:153-165`, full TS language service via
  `@volar/kit/lib/createChecker.js:125-129`. 130 = 112 + 18, and `git ls-files "*.astro"` = 18
  (a `find`-based count returns 19 by matching the generated `./.astro` directory).
- **FM-1 (severe):** `astro check` exits **0** when its own tooling is missing, printing
  `[ERROR]` on the way out — `astro/dist/cli/index.js:224` evaluates
  `process.exit(typeof checkServer === "boolean" && checkServer ? 1 : 0)`. Proven with a
  positive control: same broken file, exit 1 with the package present, exit 0 with it hidden.
- **FM-2:** a malformed `tsconfig.json` is invisible to `astro check` — `strctNullChecks`
  makes `tsc` exit 2 with `TS5025` while `astro check` reports `0 errors` over 130 files,
  because `@volar/kit/lib/createChecker.js:15-17` drops the parsed command line's `errors` array.
- Only `errors > 0` fails at the default `--minimumFailingSeverity error`; the 4 permanent
  `ts(6387)` diagnostics at `eslint.config.js:14,40,62,71` **print a yellow `warning` label but
  are tallied as hints** — disambiguated by measurement (`--minimumFailingSeverity warning` → 0,
  `hint` → 1), not by reading the label.
- CI-portable: no `.env` (all four `envField` entries are `optional: true`,
  `astro.config.mjs:16-23`), no database, no network. 8.0–8.6 s across five runs; a red run costs
  the same as a green one. **`astro check` self-syncs; `tsc` does not** — measured, 13 errors
  without `.astro/types.d.ts` — which is why the wrapper syncs explicitly rather than relying on
  the leg it may short-circuit past (Critical Implementation Details).
- `@typescript-eslint/no-unnecessary-condition` is **error**, so the nUIA fixes cannot precede
  the flag — `arr[i]?.x` is an unnecessary condition while the flag is off. Same mechanism the
  comment at `src/components/study/StudySession.tsx:170-172` already describes.
- nUIA re-measured for this plan: **33 errors across 13 files** (22 `tests/`, 7 `src/`,
  3 `scripts/`, 1 `evals/`). Research recorded 14 files; the file count is corrected here.

## What We're NOT Doing

- **Not adding a typecheck step to `eval.yml`.** `eval.yml:10-15` defends across four documents
  what a red in that file means — "a FINDING, not a hygiene failure" — and a typecheck red is
  precisely a hygiene failure. `ci.yml` already covers `evals/` on every push and PR to `main`;
  the residue is a feature-branch dispatch, where a ~$0.013 wasted run is the accepted cost.
- **Not adding typecheck to the `deploy` job.** Its `npm ci` + `astro sync` + `build`
  (`ci.yml:138-140`) are artifact-production steps, not gates: `deploy` declares
  `needs: [ci, drift]`, so the gate has already run by the time it starts. (An earlier draft cited
  `ci.yml:119-121` here — that is the **drift** job's "no `npm ci`, deliberately" comment about
  keeping that job at seconds, a different point.)
- **Not touching the eval's isolation from `npm test`.** Staying out of the test run and being
  type-checked are not in tension; `vitest.eval.config.ts` and the collection-level exclusion
  stay byte-identical.
- **Not editing `context/foundation/jira-map.md`.** Its line 86 carries an empty `Change ID` and
  a stale `context/changes/…` path for an archived change, but `jira-map.md:3-4` says do not
  hand-edit — it is owned by `/jira-backlog-sync` and `/jira-finish-work`. Flagged, not fixed.
- **Not flipping any roadmap `Status`.** `lessons.md:180` reserves that for `/10x-archive`.
- **Not making `flashcards.ts`'s two optional fields required.** The gate changes the rationale
  (see Phase 6) but the type change is a separate design decision with its own blast radius.

## Implementation Approach

Six phases, ordered by two hard constraints and one soft one.

**Hard: the gate must be proved green and falsifiable before nUIA moves the baseline.** Landing
the flag first would make "green from day one" unprovable — the gate's own claim would be
entangled with a 33-item sweep.

**Hard: doc hygiene precedes enabling the hook.** Turning husky on activates the tracked
`pre-commit` hook too, not just the new `pre-push`, so the first enabled commit would run
`prettier --write` on three dirty foundation documents unsupervised — and `test-plan.md §8`
records that command as destructive and non-idempotent on this repo's markdown once already.

**Soft: doc-sync last**, because Phases 1–5 are what make the 11 live claims false.

## Critical Implementation Details

**The nUIA ordering is not a preference.** `@typescript-eslint/no-unnecessary-condition` is
configured `error`, so with the flag off `arr[i]` is typed `T` and every `?.` / `?? fallback`
the sweep introduces is reported as an unnecessary condition. The flag and the 33 fixes must
land in **one commit**; there is no intermediate green state.

**`tsc` runs first and short-circuits — which is why the wrapper must sync before it.** On a
non-zero `tsc` exit the wrapper reports and stops without running `astro check`: a `TS5xxx` means
the config is broken, and `astro check`'s verdict under a broken config is exactly the
untrustworthy thing FM-2 describes. It also avoids printing the same diagnostics twice at 3× the
cost.

The cost of that ordering is that **"it self-syncs" is a property of `astro check`, not of the
gate.** `tsconfig.json:3` lists `.astro/types.d.ts` explicitly because `**/*` skips dotted
directories, and `tsc` hard-depends on it: measured with that file absent, `tsc --noEmit` exits 2
with **13 errors** — `TS2307 Cannot find module 'astro:env/server'` ×10, `astro:middleware` ×1,
plus two `TS7006` on `middleware.ts:43`. Short-circuiting on `tsc` therefore skips the one leg
that would have regenerated the file. Reachable in ordinary use: a fresh clone (`npm ci` does not
sync), a branch switch that changed routes or content — the case `AGENTS.md:9` already documents
for `lint` — or any `.astro/` wipe. Under Phase 4 that is a `git push` blocked by 13 errors naming
no file the developer touched, i.e. the exact standing incentive to reach for `--no-verify` that
Phase 4's own rationale exists to remove. So the wrapper syncs first, and keeps a diagnostic for
the residue.

**The file-count assertion is a floor, not an equality.** A pinned `130` becomes a stale count
the day a file is added, and this repository has recorded a count going stale four separate
times. The assertion's job is to distinguish "checked the project" from "checked nothing"
(FM-1), which a generous floor does completely.

**Cross-platform spawn.** `scripts/` runs under bare `node --experimental-strip-types` on both
this Windows machine and the Linux runner. `astro` / `tsc` resolve through `node_modules/.bin`,
whose Windows entries are `.cmd` shims — a bare `spawn("astro")` fails there. Verify the chosen
invocation on **both** platforms rather than only where it was written.

## Phase 1: The gate, locally

### Overview

A `typecheck` npm script that runs both checkers and cannot report success on a run that
checked nothing. Split pure/I-O exactly as `scripts/schema-drift.ts` + `scripts/check-schema-drift.ts`
does, so the decision is falsifiable by a unit test while the I/O half stays untested by design.

### Changes Required:

#### 1. Pure half

**File**: `scripts/typecheck.ts`

**Intent**: Own the FM-1 decision as a pure function so it can be tested without spawning
anything, following the `scripts/schema-drift.ts` precedent (pure module, tested from
`tests/lib/`, per `test-plan.md §6.1`'s mirroring clarification).

**Contract**: Exports a minimum-files floor constant and a function taking `astro check`'s
combined output and returning a verdict object carrying `ok`, the parsed file count (or `null`
when no `Result (N files):` line was produced) and a human-readable reason. Absent line → not
ok; count below the floor → not ok. `console.*` is permitted here — `tests/lib/no-logging.test.ts`
scans `src/` only, and `AGENTS.md:11` carves out `scripts/`.

#### 2. I/O half

**File**: `scripts/run-typecheck.ts`

**Intent**: Run `astro sync`, then `tsc --noEmit`, and only if that is clean run `astro check`,
capture its output, print it verbatim, and apply the pure verdict. Exit non-zero when any leg
fails or the verdict rejects.

**Contract**: **`astro sync` runs first**, before `tsc` — see Critical Implementation Details:
`tsc` hard-depends on `.astro/types.d.ts` (13 errors without it, measured) and the tsc-first
short-circuit means `astro check`, the only self-syncing leg, never gets to fix it. ~1 s
(`[types] Generated 969ms`, measured). A sync failure must report as **"astro sync failed"** with
its own message and exit — never as a type error, since a broken `astro.config.mjs` is a
different diagnosis.

Belt for the residue, because sync is not the only way generated types go stale: if the `tsc` leg
fails and its output contains `TS2307` on an `astro:*` specifier, the wrapper appends
"generated types look stale — run `npx astro sync`" to its own summary. It never suppresses or
rewrites `tsc`'s output; it adds a line. Same standard as the FM-1 message below — name the state
the reader is actually in.

`astro check` is invoked with `--minimumSeverity warning` so a green log is actually empty. Never
`--minimumFailingSeverity hint` (4 pre-existing hints turn it red today) and never `--watch`
(`cli/index.js:220-221` awaits a promise that never resolves in watch mode). The FM-1 rejection
message must name the cause — missing `@astrojs/check` / `typescript` — since that is the state a
reader will be in.

#### 3. Script registration

**File**: `package.json`

**Intent**: Add the `typecheck` script alongside the existing 15.

**Contract**: `"typecheck": "node --experimental-strip-types scripts/run-typecheck.ts"` — the
same invocation shape `db:kong` already uses.

#### 4. Scope symmetry

**File**: `tsconfig.json`

**Intent**: Add `"context"` to `exclude`, so the local gate and CI agree on scope by
construction.

**Contract**: `exclude` becomes `["dist", "context"]`. Zero effect today (no `.ts`/`.tsx`/`.astro`
under `context/`); it closes the asymmetry that `ci.yml:6,9`'s `paths-ignore: ["context/**"]`
creates — a scratch `.ts` in a change folder would be checked locally and never in CI.

#### 5. The pure half's test

**File**: `tests/lib/typecheck.test.ts`

**Intent**: Prove the FM-1 guard can go red, and that it accepts the real green output.

**Contract**: Cases covering — today's real `Result (130 files):` output accepted (the positive
control, without which a function returning `ok: false` for everything reads as perfect
protection); the verbatim FM-1 output (install message + `[ERROR]`, no `Result` line) rejected;
a `Result` line below the floor rejected; and an output with a `Result` line but non-zero errors
handled per the contract. The FM-1 fixture must be the **measured** text, not a paraphrase.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` exits 0 on the clean tree
- `npx vitest run tests/lib/typecheck.test.ts` passes
- `npm run lint` exits 0 (the two new `scripts/` files are inside the linted set)
- Full suite green: `npm test`
- Falsification A — a `TS2322` probe under `src/lib/` turns it red, exit 1
- Falsification B — a probe in `.astro` frontmatter turns it red, exit 1 (the class `tsc` cannot see)
- Falsification C — reproducing C10X-41's defect (`generateCandidates({ language: … })`) yields `ts(2353)`, exit 1
- Falsification D (FM-1) — with `@astrojs/check` hidden and a broken file present, the wrapper exits **non-zero** where bare `astro check` exits 0; positive control = same broken file with the package present
- Falsification E (FM-2) — a typo'd compiler option in a probe tsconfig is caught by the `tsc` leg, exit non-zero
- Falsification F (stale generated types) — a **pair**: with `.astro/` deleted, `npm run typecheck` still exits **0** (the sync leg regenerated it), against the control of the same tree with the sync leg neutered, which exits non-zero on 13 `TS2307`/`TS7006` and prints the "run `npx astro sync`" line rather than only the raw diagnostics
- Every probe deleted afterwards; `git status` clean and per-file hashes match a pristine copy

#### Manual Verification:

- The green run's output is genuinely empty of the 4 `ts(6387)` hints
- The FM-1 rejection message tells a reader what to install, not just that something failed
- Wall clock is in the expected band (~12 s: ~1 s astro sync + ~2.7 s tsc + ~8.4 s astro check)
- A sync failure reports as "astro sync failed", not as a type error

**Implementation Note**: pause here for manual confirmation before Phase 2.

---

## Phase 2: The CI step

### Overview

One fail-closed step, placed where a type error fails the run in seconds rather than after the
~1m46s Supabase start.

### Changes Required:

#### 1. The step

**File**: `.github/workflows/ci.yml`

**Intent**: Insert `npm run typecheck` between `npx astro sync` (line 22) and `npm run lint`
(line 23), with no `continue-on-error`.

**Contract**: Placement rationale to carry in the comment, each item measured: only `npm ci`
must precede it (no stack, Docker, credential or `.env`); before `lint` because typecheck is
_cheaper_ (~12 s vs 12.3 s) and type-aware ESLint rules degrade confusingly when types are
broken; before `build` because `astro build` provably does not type-check; far before
`supabase start`. The comment must place this step on the **drift-gate** side of the asymmetry
`ci.yml:54-64` names, applying that comment's own test item by item — no flake mode, CI is
exactly where this defect hid, a red is evidence about code that ships. And it must state the
corollary explicitly: **unlike the Kong step, a green `ci` job does imply this step passed**,
because `continue-on-error` reports a failed step's `conclusion` as `success`.

`npx astro sync` stays its own step even though the wrapper now syncs too: a broken
`astro.config.mjs` should read as "sync failed" at the step named for it, and `AGENTS.md:9`'s
ordering rule exists for **`lint`**, whose `projectService: true` depends on
`.astro/types.d.ts` — that contract must not become a side effect of a different step. The
duplicate ~1 s is the price of the wrapper being correct when invoked with no CI around it
(Phase 1 §2).

Note the cost margin is now within measurement noise (~12 s vs 12.3 s), so "cheaper than lint"
carries less of this decision than it did; the load-bearing reasons are the remaining three —
type-aware ESLint degrades confusingly on a broken type graph, `astro build` provably does not
type-check, and both sit far before the ~1m46s stack start.

### Success Criteria:

#### Automated Verification:

> **Both CI rehearsals below need an open PR to `main`, and a scratch commit touching a
> `.ts`/`.tsx`/`.astro` path.** `ci.yml:3-9` triggers only on `push` to `main` and
> `pull_request` to `main`, with `paths-ignore: ["**/*.md", "context/**"]` — so a push to this
> change's branch with no PR runs **nothing at all**, and a markdown-only commit on an open PR is
> skipped. This is the trap `test-plan.md §8` records against C10X-39, where criteria 2.3 and 2.5
> were "unmet at phase completion by decision, not by omission" for exactly this reason. If the
> PR does not exist when Phase 2 lands, mark 2.2 and 2.3 **ship-time** here and close them at
> `/ship`, per that precedent — do not leave them to be discovered unrunnable.

- The workflow file parses: `gh workflow view CI` (or `actions/workflow-parse` equivalent) reports no error
- A real CI run **on the PR** shows `npm run typecheck` **green**, positioned before `lint`
- A deliberate type error pushed to a scratch commit **on the PR branch** turns the `ci` job **red on that step**, and `build` / `supabase start` never run — then reverted

#### Manual Verification:

- The red run's log names the file and line, readable without downloading an artifact
- Step wall clock in CI is within ~2× the local measurement (cold cache is the variable)
- `deploy` and `drift` are untouched

**Implementation Note**: pause here for manual confirmation before Phase 3.

---

## Phase 3: Doc hygiene before the hook

### Overview

Make the set of markdown files this change stages prettier-clean, put archived evidence
permanently out of prettier's reach, and remove the 4 permanent `ts(6387)` hints at their source.
All three exist so that Phase 4's first hook run discovers nothing.

### Changes Required:

#### 0. Put the archive out of reach

**File**: `.prettierignore` (new — none exists today)

**Intent**: `lint-staged` runs `prettier --write` on every staged `*.md`, so from Phase 4 onward
the hook would reformat archived evidence wholesale the moment Phase 6 appends a correction line
to it. That contradicts this repo's stated rule — archived artifacts take dated corrections and
are **never rewritten** — and it would make criterion 6.6 ("verify by diff shape") unverifiable,
because the diff would be the whole file. Measured: **all nine** archive markdown files Phase 6
edits are currently prettier-dirty, including this change's own charter.

**Contract**: one line, `context/archive/**`. Prettier 3 reads `.prettierignore` **alongside**
`.gitignore` rather than replacing it, so nothing already ignored becomes visible. Scoped to
`archive` deliberately, **not** to `context/**`: a live `context/changes/` folder is a working
document that should arrive at `/10x-archive` already normalised, and freezing it only once it is
archived is what makes "the archive is immutable" a property of the tooling instead of of a
reviewer's attention. Consequence to state rather than leave implicit: `npm run format` no longer
touches the archive, by design.

#### 1. Prettier normalisation

**File**: `context/foundation/roadmap.md`, and this change's own
`context/changes/typecheck-gate/{plan,plan-brief,research}.md`

**Intent**: Run `prettier --write` on exactly the markdown this change stages after the hook goes
live, in a commit that contains nothing else, so the diff is reviewable as formatting.

**Contract**: The list is derived from what gets staged, not from what happens to be dirty.
`roadmap.md` is staged by Phase 6 §3 and is dirty again despite C10X-42 formatting it; the three
change-folder artifacts are staged repeatedly from Phase 1 onward (`/10x-implement` re-commits
`plan.md` every time it ticks a Progress box) and are all dirty. **`prd.md` and `lessons.md` are
deliberately NOT in this list** — measured, no phase of this change stages either, so normalising
them is unrelated scope carrying the landmine risk below for no benefit. `test-plan.md`,
`README.md` and `AGENTS.md` are already prettier-clean (measured) and need nothing.

`test-plan.md §8` records `prettier --write` as **destructive and non-idempotent** on this repo's
markdown — it stripped a `> ` continuation from a blockquote-embedded code span and then collapsed
the block on a second pass. That landmine was disarmed for `test-plan.md` only. So: write, then
write again and diff the two results (idempotency), and review the diff specifically for lines
that lost a `> ` prefix or joined a wrapped code span.

#### 2. The four hints

**File**: `eslint.config.js`

**Intent**: Migrate off the deprecated `tseslint.config` signature at lines 14, 40, 62, 71 so
the log is empty because there is nothing to hide, not because it was hidden. Measured, the
deprecated member is the variadic overload:
`'(...configs: InfiniteDepthConfigWithExtends[]): ConfigArray' of 'tseslint.config' is deprecated`.

**First, settle the constraint the file states against this edit.** `eslint.config.js:1` reads
`/* eslint-disable @typescript-eslint/no-deprecated -- tseslint.config() is the only way to use
extends; core defineConfig has incompatible API */`. That is an explicit, documented reason not to
do this, and it may be stale — `@eslint/config-helpers` is already a dependency and already
imported at line 2 for `includeIgnoreFile`, and its `defineConfig` supports `extends` natively —
but **stale is a claim to measure, not to assume**. Establish it before editing anything.

**The comment travels with the code it describes**, exactly as Phase 5 requires of
`StudySession.tsx:170-172`: if the migration lands, the line-1 rationale is false and the
`eslint-disable` becomes an unused directive (ESLint 9 defaults `reportUnusedDisableDirectives`
to `warn`), so both go with it. Do not leave a disable for a deprecation that no longer fires.

**Contract**: Behaviour-neutral, proved by an **exact** oracle rather than a sampled one.
`npx eslint --print-config <file>` before and after, diffed, for one file of each kind the config
fans across — `src/lib/utils.ts`, an island `.tsx`, an `.astro`, and `eslint.config.js` itself
(the `allowJs` case). An empty diff on all four is the proof; a non-empty one names the
divergence. `npm run lint` exiting 0 is a smoke check on top, not the evidence: it only exercises
the rules the tree happens to trigger.

**Escape hatch, taken deliberately rather than discovered late**: if `--print-config` diverges on
any of the four and the divergence cannot be closed, or `defineConfig` genuinely cannot express
this config, **record the measurement and drop this sub-phase**. The four hints then stay, and
nothing else in the change depends on their absence — Phase 1 §2's `--minimumSeverity warning`
already keeps them out of the gate's own log, and F3's hint-visible criterion above simply
records `4 hints` as the observed state instead of `0`. A stale line-1 comment corrected in place
is a perfectly good outcome for this sub-phase; a silently different lint config is not.

### Success Criteria:

#### Automated Verification:

- `npx prettier --check context/foundation/roadmap.md context/changes/typecheck-gate/*.md` exits 0
- Idempotency: a second `--write` produces a byte-identical file (diff empty) for all four
- `npx prettier --check "context/archive/**/*.md"` reports **no files matched** — the ignore is in effect, proved as a pair against the same command before the file existed (it reports 9+ dirty files today)
- `npm run lint` exits 0
- `npx eslint --print-config` is byte-identical before and after for all four file kinds (`src/lib/utils.ts`, an island `.tsx`, an `.astro`, `eslint.config.js`) — the exact neutrality oracle
- The four hints are gone **at their source, proved with an invocation that can still see them**: `npx astro check` (bare, no severity flag) reports `- 0 hints`, and `npx astro check --minimumFailingSeverity hint` exits **0** — against today's control, where the same two report 4 hints and exit 1. `npm run typecheck` is NOT the oracle here: Phase 1 §2 pins `--minimumSeverity warning`, which — measured — drops the hints row from the Result block entirely, so it reads "0 hints" whether or not this phase happened. **If the escape hatch was taken**, this criterion is met by recording the measurement that closed it plus the unchanged `4 hints` — not by leaving it unticked
- `npm run typecheck` exits 0
- `npm test` green (nothing here should move it)

#### Manual Verification:

- Read the four normalisation diffs for the blockquote/code-span landmine class specifically
- Confirm no `> ` prefix was lost and no dated correction block was reflowed into unreadability
- Spot-check that the ESLint config still lints an `.astro`, a `.tsx` and a `.ts` file

**Implementation Note**: pause here for manual confirmation before Phase 4 — this is the phase
whose failure mode is silent.

---

## Phase 4: The local hook

### Overview

Repair husky (it has never been installed in this tree) and put the gate on `pre-push`.

### Changes Required:

#### 1. husky installation wire

**File**: `package.json`

**Intent**: Add the missing `prepare` script that husky v9 installs itself from.

**Contract**: `"prepare": "husky"` — the bare word, read from `node_modules/husky/bin.js:14`;
`bin.js:24` prints a deprecation for the v8 `husky install` spelling. **CI-safe with no
`|| true`**: `index.js:11` returns a string when `.git` is absent rather than throwing, and
`bin.js:26` only writes it to stdout, so the exit code is always 0. Then run it once in this
tree — nothing retroactively fixes an existing checkout.

#### 2. The hook

**File**: `.husky/pre-push`

**Intent**: Run the project-wide gate once per push.

**Contract**: A single `npm run typecheck` line. `pre-push` rather than `pre-commit` because
8–11 s on every commit is a standing incentive to reach for `--no-verify`, which AGENTS.md and
the global CLAUDE.md **both** forbid absolutely. The check goes in the **hook**, never in
`lint-staged`: lint-staged appends staged file paths as arguments, which makes `tsc` discard
`tsconfig.json` (its own README FAQ, `node_modules/lint-staged/README.md:1077-1092`) and makes
`astro check` — which accepts no positional file arguments — silently discard them and re-check
the whole project once per chunk. The documented function-value workaround is unavailable
because this repo's lint-staged config lives in `package.json`, which is JSON.

### Success Criteria:

#### Automated Verification:

- After the one-time install: `.husky/_/` exists and `git config --get core.hooksPath` returns `.husky/_`
- `git push` on a clean tree runs the hook and succeeds
- A staged type error makes `git push` **fail** at the hook, naming the file — then reverted
- The now-live `pre-commit` hook runs `lint-staged` on a real commit without rewriting any foundation document (Phase 3's precondition, verified rather than assumed)

#### Manual Verification:

- The hook's failure output is readable in the terminal the developer is actually in
- Confirm `--no-verify` was not needed at any point during the phase

**Implementation Note**: pause here for manual confirmation before Phase 5.

---

## Phase 5: `noUncheckedIndexedAccess`

### Overview

Flip the flag and fix the 33 sites it surfaces, in one commit, because the lint configuration
makes any intermediate state red.

### Changes Required:

#### 1. The flag

**File**: `tsconfig.json`

**Intent**: Add `"noUncheckedIndexedAccess": true` to `compilerOptions`.

**Contract**: `astro/tsconfigs/strict` does not enable it. One setting governs both checkers —
verified: `astro check --tsconfig` against a probe config reports the same 33 errors, same files,
same codes.

#### 2. The sweep — type-level only (27 diagnostics, 10 files)

**File**: `tests/lib/form-endpoint-guards.test.ts` (10), `tests/isolation/flashcards.test.ts` (5),
`tests/lib/error-param-guard.test.ts` (2), `tests/validation/decks.test.ts` (2),
`tests/validation/cards.test.ts` (1), `tests/generation/generate.test.ts` (1),
`tests/setup/preflight.ts` (1), `scripts/kong-keepalive.ts` (2),
`scripts/disable-kong-keepalive.ts` (1), `src/components/generate/GeneratorForm.tsx` (1)

> **Counts, stated so the total and the breakdown are one claim rather than two** — the defect
> this repo has recorded against C10X-39, C10X-40 and C10X-42. Re-measured for this plan:
> **33 diagnostics across 13 files** in total. This list is 27 across 10; §3 below owns the
> remaining 6 across 3 files (`StudySession.tsx` ×5, `generations.ts` ×1, `judge.ts` ×1). The
> earlier "30 sites, 12 files" was arrived at by splitting `StudySession.tsx` across both
> sub-sections, which double-counted it and described a 4/1 division of work that does not
> exist — its five diagnostics are one root cause behind one guard.

**Intent**: Narrow each indexed access so the compiler sees what the code already guarantees.
None of these is a latent defect: they are indexes guarded by a `.length` test, by a preceding
`if (!match) throw`, or by a bounds check in the same `if`, plus tests indexing a fixture they
just built.

**Contract**: `@typescript-eslint/no-non-null-assertion` is **error**, so `!` is unavailable —
every fix is `?.`, `??`, or an explicit guard. There are zero `!` assertions in the repo today
and this phase must not introduce the first. No assertion may be weakened: a test that indexes
`data[0]` to assert on it must still fail when `data` is empty, so `?.` plus an existing
`expect` is fine only where the expectation would still go red.

#### 3. The sweep — behaviour-adjacent (6 diagnostics, 3 files)

**File**: `src/components/study/StudySession.tsx`, `src/lib/generations.ts`, `evals/lib/judge.ts`

**Intent**: The fixes that touch control flow or a runtime path rather than only types, and
therefore need real review rather than mechanical narrowing.

**Contract**: `StudySession.tsx` accounts for **five** of the six diagnostics — `card` possibly
undefined at lines 202, 209, 287, 293 and 336 — and they are **one root cause closed by one
guard**, not five edits. `:170-172` carries a comment explaining it _cannot_ write an honest
`if (!card)` guard while the flag is off; **this phase deletes a workaround rather than adding
one**, and that comment must be removed with the code it describes, not left contradicting it.

`generations.ts:82` moves from a `data.length === 0` test to a `!data[0]` test — same predicate,
different justification.

`judge.ts:166` is **not** what an earlier draft of this plan called it, and the correction matters
because it changes the fix and the risk. The line is
`await sleep(TRUNCATION_BACKOFFS_MS[attempt])` inside `judgeCard`'s retry loop — `number |
undefined` handed to a `number` parameter (`TS2345`), already guarded by
`attempt < TRUNCATION_BACKOFFS_MS.length` on the line directly above, so the fix is a bounded-index
narrowing (`?? ` a default, or destructure the entry and branch on it), **never `?.`**, which does
not apply to a numeric argument. The "possibly-absent choice" is a different site,
`judge.ts:234-235`, which already reads `choices?.[0]` and produces no diagnostic. Consequence:
this is a mechanical fix on a guarded index, not a change that needs a paid provider run to
justify — the only care required is that the chosen default cannot silently turn a 3 s/10 s
backoff into a 0 s hot retry against the provider.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` exits 0 with the flag on
- `npm run lint` exits 0 — specifically, no `no-unnecessary-condition` and no `no-non-null-assertion` findings
- `npm test` green, with the count recorded **as observed** (a change here would mean an assertion moved)
- `grep -rn '!\.' src/ tests/ scripts/ evals/` produces no new non-null assertion (the repo's count of `!` stays zero)
- Falsification: reproduce C10X-41's F3 shape (`PROMPT_LANGUAGE_NAMES[code]` into a non-optional `string`) and confirm it now goes red — the measurement that justifies the flag; then revert

#### Manual Verification:

- Read the three behaviour-adjacent diffs individually against their surrounding logic
- Confirm `StudySession`'s early return cannot strand a session on a card it silently skipped
- Confirm no test's oracle became unfalsifiable (a `?.` that turns a would-be failure into `undefined === undefined`)

**Implementation Note**: pause here for manual confirmation before Phase 6.

---

## Phase 6: Doc-sync

### Overview

11 live claims edited, 17 dated entries given correction lines rather than rewrites, one roadmap
row created, one file flagged and deliberately not touched. The **list** is the contract; the
count is fragile and this repo has recorded counts going stale repeatedly.

### Changes Required:

#### 1. Live claims (11)

**File**: as listed

**Intent**: Each of these asserts, in the present tense, that this project has no type gate.
After Phases 1–5 each is false.

**Contract**:

- `context/foundation/test-plan.md:642` — §5 gate row 1 (`lint + typecheck … required — wired today`) is presently false in **both** halves; it becomes true, but the local half is **`pre-push`, not `pre-commit` via lint-staged**, so the row's wording must say what is actually wired.
- `context/foundation/test-plan.md:459` — §2 Risk #7: append a **fourth dated half**, per C10X-42's own idiom, retiring "`tsc` is in no gate".
- `context/foundation/test-plan.md:652-686` — §5 prose: this gate earns its paragraph, including the fail-closed statement and the FM-1/FM-2 boundary.
- `README.md:49` — Available Scripts: add `typecheck`; the existing "type-checked rules" phrasing on the `lint` line is the exact confusion the charter names and needs disambiguating.
- `README.md:169-178` — `## CI` job inventory.
- `AGENTS.md:22` — Commands.
- `AGENTS.md:9` — the `astro sync` ordering rule now binds this step too. **Also correct the false pre-commit claim** in `## Conventions` — measured: husky was never installed here, so "commits auto-fix" was untrue until Phase 4.
- `.github/workflows/eval.yml:217` — the only falsified claim in this repo that **ships as executable output**. Correct the parenthetical only; **do not delete cause #2** — a collection-time error (an import throw, a top-level side effect, a bad `vi.mock` path) stays fully live and no type gate sees it.
- `src/lib/flashcards.ts:30` — the parenthetical's third clause becomes false. Note the nuance: the gate would now catch a required field one branch cannot supply, so the two optional fields' rationale shifts from "nothing catches this" to "these two branches genuinely differ". Rewrite the reason honestly rather than deleting the clause.
- `tests/review/candidates.test.ts:855` — "with no type gate to catch the difference".
- `context/foundation/jira-map.md:86` — **flag only, do not edit** (empty `Change ID`, stale `context/changes/…` path for an archived change; owned by the Jira skills per `jira-map.md:3-4`).

#### 2. Historical entries (17)

**File**: `context/foundation/test-plan.md` (§6.6's C10X-41 and C10X-42 entries, four §8 ledger
lines), the charter, and the archive sites enumerated in `research.md:533-539`

**Intent**: Dated correction lines, never rewrites — the C10X-30 "4xx" precedent this repo
states four times.

**Precondition, and it is what makes "never rewrites" survive contact with the hook**: Phase 3 §0
put `context/archive/**` in `.prettierignore`, so the now-live `pre-commit` `lint-staged` cannot
reformat these nine dirty files as a side effect of the one line you appended. Do not "tidy" them
by hand either — the diff for each of these must be the correction line and nothing else, which
is exactly what criterion 6.6 verifies by diff shape.

**Contract**: The highest-value one is
`context/archive/2026-07-25-candidate-review/reviews/impl-review.md:38-42` — _"`astro check`
cannot be added as a CI gate until those three are fixed"_ — an instruction addressed to this
change, whose three errors are measured gone. Also correct `test-plan.md §8`'s **mechanism**
claim that "husky's installed half is gitignored": measured false — `grep -i husky .gitignore`
has no match and `git check-ignore` returns not-ignored for all five paths. The ignoring is done
by `.husky/_/.gitignore`, which husky itself writes, and the real reason the setup does not
travel is `core.hooksPath`, per-repository git config that `git worktree add` never copies. The
conclusion was right; the mechanism sends a reader grepping for something that is not there.
`context/foundation/roadmap.md:349` and `jira-map.md:342-357` are the mixed class — a
present-tense sentence inside a dated block — and take a dated **supplement** per the H-03
precedent (roadmap only; jira-map stays untouched).

#### 3. Roadmap row

**File**: `context/foundation/roadmap.md`

**Intent**: Create `H-11` for this change in `## At a glance` and `## Slices`, before
`/10x-archive` runs.

**Contract**: `Status` left unset — `lessons.md:180` reserves the flip for archive. The note at
`roadmap.md:68-76` is explicit about the cost of a missing row, and H-04, H-07 and H-08 were all
backfilled retroactively.

### Success Criteria:

#### Automated Verification:

- `grep -rn "no type gate\|astro check.*cannot be added\|tsc.*in no gate" --include="*.md" --include="*.ts" --include="*.yml" context/foundation README.md AGENTS.md src tests .github` returns only dated-correction contexts, never a live claim
- `grep -rn "C10X-43" .github/` shows the corrected parenthetical
- `npx prettier --check` passes on every edited markdown file **outside `context/archive/`** (`test-plan.md`, `README.md`, `AGENTS.md`, `roadmap.md`). Archive files are ignored by Phase 3 §0 and must NOT be normalised — a `--check` there reports "no matching files", which is the ignore working, not a pass
- `npm test` green (the `candidates.test.ts` comment edit must not move an assertion)
- `npm run typecheck` and `npm run lint` both exit 0

#### Manual Verification:

- Every dated entry received a correction **line**, not a rewrite — verify by diff shape
- `test-plan.md §2` (coverage claim) and `§6.6` (mechanism) are consistent and readable together
- `jira-map.md` is untouched, checked by **content hash** before and after (`md5sum`), never by `git diff` — the file is gitignored (`.gitignore:70`), so a diff there is empty whatever happens to it
- The roadmap H-11 row's `Status` is unset

---

## Testing Strategy

### Unit Tests:

- `tests/lib/typecheck.test.ts` — the FM-1 verdict function: real green output accepted (positive
  control), the measured FM-1 output rejected, a below-floor count rejected.

### Integration Tests:

- None. The gate has no integration surface: it spawns two first-party CLIs and reads their
  output. Consistent with `test-plan.md §6.6`'s C10X-29 boundary — `scripts/check-schema-drift.ts`
  deliberately gets no test because every branch is I/O, and the wiring is carried by recorded
  runs rather than by an assertion. **State this explicitly rather than let it be inferred:
  `npm test` covers the pure half and nothing else; no test in this suite runs the gate.**

### Manual Testing Steps:

1. Break a type in `src/`, run `npm run typecheck`, confirm red with file and line; revert.
2. Break a type in an `.astro` frontmatter; confirm red (the class `tsc` cannot see); revert.
3. Hide `@astrojs/check`, confirm the wrapper is red where bare `astro check` is green; restore.
4. With a PR to `main` open, push a scratch commit carrying a type error in a `.ts`/`.tsx`/`.astro`
   file (a markdown-only commit is skipped by `paths-ignore`, and a branch with no PR runs nothing
   at all), confirm the `ci` job is red on that step and that `build` and `supabase start` never
   ran; revert.
5. `git push` with a staged type error, confirm the hook blocks it.

## Performance Considerations

~12 s added to every CI run (~1 s `astro sync` + ~2.7 s `tsc` + ~8.4 s `astro check`; the sync is
paid twice in CI, once by its own step and once inside the wrapper — the wrapper's copy is what
makes the LOCAL invocation correct and costs a second in CI to keep one code path), placed before the ~1m46s
Supabase start so a type error fails at roughly T+15 s instead of T+2 min. Locally the cost is
once per push, not once per commit. Red runs cost the same as green ones.

One budgeted coupling: `allowJs: true` plus `include: ["**/*"]` puts `eslint.config.js` and
`astro.config.mjs` inside the checked set, so a `typescript-eslint` major can turn the gate red
with no source change. That is a true positive, not a false one, but it couples CI to
devDependency typings and should not be a surprise the first time it happens.

## Migration Notes

The husky repair is a one-time action in each existing checkout — `core.hooksPath` is
per-repository git config that `git worktree add` never copies and that no `npm ci` sets without
the `prepare` script. A fresh clone gets it from `npm install`; an existing worktree needs the
script run once by hand.

## References

- Research: `context/changes/typecheck-gate/research.md`
- Charter: `context/archive/2026-07-31-forced-language-prompt-fix/follow-ups/typecheck-gate.md`
- Retired blocker: `context/archive/2026-07-25-candidate-review/reviews/impl-review.md:38-42`
- Gate-design precedent (fail-closed, positive control, "a gate carrying no test must say so"):
  `context/archive/2026-07-27-schema-drift-test/`
- The `lessons.md:194-199` exit-code rule this change must satisfy
- Doc-sync idiom (live edited, dated corrected): `context/archive/2026-08-02-eval-ci-dispatch/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The gate, locally

#### Automated

- [x] 1.1 `npm run typecheck` exits 0 on the clean tree — 73e78fd
- [x] 1.2 `npx vitest run tests/lib/typecheck.test.ts` passes — 73e78fd
- [x] 1.3 `npm run lint` exits 0 — 73e78fd
- [x] 1.4 Full suite green: `npm test` — 73e78fd
- [x] 1.5 Falsification A — `TS2322` probe under `src/lib/` turns it red — 73e78fd
- [x] 1.6 Falsification B — `.astro` frontmatter probe turns it red — 73e78fd
- [x] 1.7 Falsification C — C10X-41's `ts(2353)` defect turns it red — 73e78fd
- [x] 1.8 Falsification D (FM-1) — hidden `@astrojs/check` exits non-zero, with positive control — 73e78fd
- [x] 1.9 Falsification E (FM-2) — typo'd compiler option caught by the `tsc` leg — 73e78fd
- [x] 1.10 Falsification F — `.astro/` deleted still exits 0; control with the sync leg neutered exits non-zero and prints the "run `npx astro sync`" line — 73e78fd
- [x] 1.11 All probes deleted; tree clean and hash-verified — 73e78fd

#### Manual

- [x] 1.12 Green run's output is empty of the 4 `ts(6387)` hints — 73e78fd
- [x] 1.13 FM-1 rejection message names what to install — 73e78fd
- [x] 1.14 Wall clock in the expected ~12 s band — 73e78fd
- [x] 1.15 A sync failure reports as "astro sync failed", not as a type error — 73e78fd

### Phase 2: The CI step

#### Automated

- [x] 2.1 Workflow file parses — 21c39ff
- [ ] 2.2 Real CI run **on an open PR to `main`** shows `npm run typecheck` green, before `lint` (ship-time if no PR exists yet) — SHIP-TIME: no PR open at Phase 2 (`gh pr list` empty, branch unpushed), close at `/ship`
- [ ] 2.3 Deliberate type error in a `.ts`/`.tsx`/`.astro` file on the PR branch turns the `ci` job red on that step; `build` / `supabase start` never run; reverted (ship-time if no PR exists yet) — SHIP-TIME: same reason, close at `/ship`

#### Manual

- [x] 2.4 Red run's log names file and line without an artifact download — 21c39ff
- [ ] 2.5 CI step wall clock within ~2× the local measurement — SHIP-TIME: needs a CI run, close at `/ship` (local baseline 12.39 s, so the CI bar is ≤ ~25 s)
- [x] 2.6 `deploy` and `drift` untouched — 21c39ff

### Phase 3: Doc hygiene before the hook

#### Automated

- [x] 3.1 `prettier --check` exits 0 on `roadmap.md` + the three change-folder artifacts — f3861b9
- [x] 3.2 Idempotency: second `--write` is byte-identical for all four — f3861b9
- [x] 3.3 `prettier --check "context/archive/**/*.md"` matches no files (paired against its 9+ dirty files before `.prettierignore`) — met as a PAIR, and the predicted message is corrected as observed: prettier 3 prints `All matched files use Prettier code style!` (exit 0), never "no files matched", so that sentence is true VACUOUSLY and is indistinguishable from a genuinely-clean run. The evidence is the pair plus `--list-different`: **116** dirty archive files before, **0 files considered** after, and a known-dirty file named EXPLICITLY on the command line (which is how `lint-staged` invokes prettier) is skipped — f3861b9
- [x] 3.4 `npm run lint` exits 0 — f3861b9
- [x] 3.5 `eslint --print-config` byte-identical before/after for `.ts`, `.tsx`, `.astro`, `.js` — f3861b9
- [x] 3.6 Hints gone at source, proved hint-visibly: bare `astro check` reports `- 0 hints` and `--minimumFailingSeverity hint` exits 0, against today's control (4 hints, exit 1) — or the escape hatch's measurement recorded instead — escape hatch NOT taken: all four `--print-config` oracles identical, so the migration landed and both halves of the line-1 rationale were measured FALSE — f3861b9
- [x] 3.7 `npm run typecheck` exits 0 — f3861b9
- [x] 3.8 `npm test` green — 358/358, 31 files, seed 1785746530044 — f3861b9

#### Manual

- [x] 3.9 Four normalisation diffs read for the blockquote/code-span landmine class — read, and closed by SEQUENCE comparison rather than by eye: prettier's effect isolated (pristine vs pass-1, before any Progress edit) leaves blockquote lines, inline code spans, headings and links **all four at zero differences** in all four files. Residual content difference after normalising emphasis + whitespace + table padding is **0/0/0/0**, so the entire diff is `*x*`→`_x_`, table column padding, and one blank line before a list (`plan.md:597`) — f3861b9
- [x] 3.10 No `> ` prefix lost, no dated correction block reflowed — strongest available form: **every `>` line is byte-identical, in order, in all four files**, which covers every dated block at once rather than by sampling. Spot-read confirms rendering, including the structurally riskiest element — the bare `>` continuation line inside `roadmap.md`'s C10X-40 correction block (`:435`), which is exactly what the recorded landmine strips — f3861b9
- [x] 3.11 ESLint config still lints an `.astro`, a `.tsx` and a `.ts` file — proved FALSIFIABLY, because `npm run lint` exiting 0 is also what a config that ignores everything produces: a real rule violation injected into each of the three kinds turns each one red on `@typescript-eslint/no-unused-vars` carrying this project's own `/^_/u` option — i.e. the `extends` chain survived the migration and reaches `.astro` too. Restored, per-file MD5 identical, `git diff -- src/` empty — f3861b9

### Phase 4: The local hook

#### Automated

- [x] 4.1 `.husky/_/` exists and `core.hooksPath` is set — `npm run prepare` exit 0, 16 dispatchers written under `.husky/_/`, `git config --get core.hooksPath` → `.husky/_` — cab55a8
- [x] 4.2 `git push` on a clean tree runs the hook and succeeds — measured with `git push --dry-run origin HEAD`, which **does** fire `pre-push` (verified rather than assumed: the wrapper's full output appeared and the run took 13.35 s). Green: `Result (133 files): 0 errors / 0 warnings`, `typecheck: OK — 133 files checked (floor 50)`, push exit 0, `* [new branch] HEAD -> C10X-43-typecheck-gate`. A real (non-dry) push belongs to `/ship` — cab55a8
- [x] 4.3 Staged type error makes `git push` fail at the hook; reverted — a `TS2322` staged into `src/lib/utils.ts` turns the same command red: `src/lib/utils.ts(7,7): error TS2322`, `husky - pre-push script failed (code 2)`, `error: failed to push some refs`, exit 1. The **pair** is the evidence — same command, one variable. Restored from a pristine copy, MD5 identical (`D9837F38CC05303254571985E3164050`), `git diff -- src/` empty — cab55a8
- [x] 4.4 Live `pre-commit` runs `lint-staged` without rewriting any foundation document — closed by the phase's own first commit (`e962ff2`), which is the first commit this tree has ever run a hook on. `lint-staged` stashed, ran `eslint --fix` on 3 `.ts` files, applied and cleaned up. Proved by **hash**, not by inspection: all ten `context/foundation/*.md` plus `README.md`, `AGENTS.md`, `CLAUDE.md` and `.husky/pre-commit` are MD5-identical to a snapshot taken before the commit. Two things Phase 3's precondition also has to survive and did — the unstaged work (`package.json`, `plan.md`) came back intact through the stash, and `git stash list` is empty, so no backup was orphaned — cab55a8

#### Manual

- [x] 4.5 Hook failure output readable in the developer's terminal — **the criterion did its job: it found a defect.** Re-run in a real `sh` (not through the PowerShell host, whose `NativeCommandError` wrapper is not what a developer sees), the tsc branch printed "A tsconfig error (TS5xxx) makes `astro check`'s own verdict untrustworthy" for an ordinary `TS2322` — sending a developer whose defect was one line of `utils.ts` to a `tsconfig.json` that is fine. Fixed in the pure half (`readTscFailure`, +6 cases) rather than in the runner, and the summary line for the `astro check` leg was reworded too ("found errors across 133 files" read as "133 files have errors"; it is the coverage figure). Exercised through the **hook** on all four failure classes it can report, each blocking the push and each naming the state the reader is in: ordinary `TS2322`; config `TS5025`; an `.astro` frontmatter error (the class `tsc` cannot see — file:line:col plus a source excerpt and caret); and FM-1 with `@astrojs/check` hidden, which blocks where the bare command exits 0 and names what to install — e962ff2
- [x] 4.6 `--no-verify` was not needed at any point — and was not used. Both deliberate red pushes were **reverted, never bypassed**, each restore hash-verified. Audited more widely than the phase: outside `context/archive/`, `--no-verify` appears in 8 files and every occurrence is prose explaining why it must not be used — zero invocations. `HUSKY` is unset, so the hooks were genuinely live for every commit and push in this phase — cab55a8

### Phase 5: `noUncheckedIndexedAccess`

#### Automated

- [x] 5.1 `npm run typecheck` exits 0 with the flag on — `Result (133 files): 0 errors / 0 warnings`, `typecheck: OK — 133 files checked (floor 50)`, exit 0. The sweep is **33 diagnostics across 13 files**, re-measured against the plan's own figure and matching it exactly (10 `form-endpoint-guards` / 5 `flashcards` / 5 `StudySession` / 2 `decks` / 2 `error-param-guard` / 2 `kong-keepalive` / 1 each in `cards`, `preflight`, `generate`, `generations`, `GeneratorForm`, `disable-kong-keepalive`, `judge`). `npm run build` also exit 0 — c63b720
- [x] 5.2 `npm run lint` exits 0 — no `no-unnecessary-condition`, no `no-non-null-assertion` — **0 errors**, 3 warnings, all three `no-console` in `evals/generation-quality.eval.ts` and all three pre-existing (the C10X-42 figure, unchanged by this phase). Zero findings of either named rule, which is what makes the flag-then-fix ordering provably necessary rather than merely argued — c63b720
- [x] 5.3 `npm test` green, count recorded as observed — **364/364, 31 files**, seed 1785753412997. The count MOVED from Phase 3's 358 and this phase added none of it: `358 + 6 = 364`, the +6 being `readTscFailure` from Phase 4's own `e962ff2`. Proved rather than reconciled by arithmetic — `git diff -U0 -- tests/` contains **no added or removed `it()` / `describe()` line**, its single apparent hit being the substring `.test(` inside `WRAPPED_Q.test(...)` — c63b720
- [x] 5.4 Repo's non-null-assertion count stays zero — the plan's `grep -rn '!\.' src/ tests/ scripts/ evals/` returns nothing, and so does a **wider** pattern covering the spellings that grep cannot see (`x!)`, `x!;`, `x!,`, `x![0]`, `x!` at end of line) across `.ts`/`.tsx`/`.astro`. The lint run above is the third, independent oracle: `no-non-null-assertion` is configured `error` — c63b720
- [x] 5.5 Falsification: C10X-41's F3 shape now goes red; reverted — a probe returning `PROMPT_LANGUAGE_NAMES[code]` as a non-optional `string` yields `tests/lib/__nuia-probe.ts(6,3): error TS2322: Type 'string | undefined' is not assignable to type 'string'`, `npm run typecheck` **exit 2**, correctly short-circuiting before `astro check`. The **pair** is what makes it the measurement that justifies the flag: the identical probe with `noUncheckedIndexedAccess` removed exits **0 with zero diagnostics** — i.e. the gate built in Phases 1-4 genuinely could not see this class until this phase. Probe deleted, flag restored, `tsconfig.json` MD5-identical to its pre-probe copy, gate green again — c63b720

#### Manual

- [x] 5.6 Three behaviour-adjacent diffs read individually — and each closed by MEASUREMENT rather than by reading, since all three are predicate swaps and a swap is exactly the thing reading is bad at. **`judge.ts`**: `attempt < LEN` vs `BACKOFFS[attempt] !== undefined` enumerated over the whole reachable domain (attempt 0-5) — **0 disagreements**, array confirmed dense (no holes), and no `0 ms` sleep reachable, which is the single behaviour-change risk the plan named. **`generations.ts`**: the empty branch has NO coverage in the suite (only `api/generate.ts` calls it, and only its non-empty path is exercised), so it was driven directly against the real local Postgres — `generationResultByGenerationId(client, 2_000_000_000)` returns `{ data: null, error: null }`, unchanged. Proved load-bearing rather than assumed: with the guard removed the same probe fails `TypeError: Cannot read properties of undefined (reading 'deck')`. Restored, MD5 identical (`cb387a49fa5405d98311b50761117894`). **`StudySession.tsx`**: see 5.7 — c63b720
- [x] 5.7 `StudySession`'s early return cannot strand a session — driven as a REAL session in the browser (dev server + local stack), not argued. Deck `5835342c…` with 4 due cards, each rated with a DIFFERENT grade: the island walked `Karta 1 z 4 → 2 → 3 → 4 → Sesja zakończona`, `Powtórzono kart: 4`, zero console errors. Every rating LANDED — all four `reps` advanced `1 → 2`, each with its own `last_review`, and `lapses` went `0 → 1` on exactly the card rated `Powtórz` (Again) and on no other, which is what shows the grade reached the server rather than the counter merely climbing (the C10X-27 defect's exact shape). **The ordering was the real risk and it holds**: with `!card` now the finish signal, an empty batch would ALSO satisfy it, so the `cards.length === 0` branch had to keep winning — re-entering the same deck with nothing due renders `Brak kart należnych dziś.`, not `Sesja zakończona`. `card.intervals[rating.key]` still renders (`za 1 dzień / 3 dni / 5 dni / 9 dni`). Also browser-verified, though only type-level: `GeneratorForm`'s `decks[0]?.publicId ?? NEW_DECK` on BOTH branches — a 60-deck account preselects the first deck, a genuinely zero-deck account falls through to `__new__` with one option — c63b720
- [x] 5.8 No test oracle became unfalsifiable — measured at the matcher, which is where "unfalsifiable" is decided. A scratch suite ran all five shapes Phase 5 introduced against an EMPTY array: **5/5 red** — `expected undefined to be 'A's front'`, `expected undefined to be 'A's back'`, `Target cannot be null or undefined.` (the `toHaveLength` chain), `expected false to be true` (the `?? ""` fallback, since `WRAPPED_Q` does not match the empty string), `expected undefined to be defined`. Two things stated rather than implied: each `?.` sits BEHIND a `toHaveLength(1)` / `toBeDefined()` that fires first, so an empty array is red before the chained line is even reached — the matcher run proves it would be red even if it were reached; and the one place a `?.` could have no-opped a mutation (`bodies[0][1].delete(...)`) was NOT given a `?.` at all, the fixture being rebuilt so the indexed access disappears. Probe deleted — c63b720

### Phase 6: Doc-sync

#### Automated

- [x] 6.1 No live "no type gate" claim survives the sweep grep — **7 hits, every one accounted for by reading rather than by the count**: 4 are dated entries whose correction block sits directly below them (`test-plan.md` header `:75`, §6.6 `:2693`, §8 `:4149`, and the Risk #7 cell `:516`, where the new fourth half names the retired clause verbatim — "it retires exactly one clause: '`tsc` is in no gate'"), 1 is `candidates.test.ts:855` quoting its own former claim as no longer true, and 2 are **new and true** (`eval.yml:219` and `test-plan.md:2705`, both saying no type gate sees a _collection-time_ error). Zero live falsified claims — 6a9009f
- [x] 6.2 `grep -rn "C10X-43" .github/` shows the corrected parenthetical — two hits: `ci.yml:24` (the step's own comment) and `eval.yml:218`. Cause #2 is **kept and widened**, not deleted: it now enumerates the class (`an import throw, a top-level side effect, a bad vi.mock path`) and states the boundary explicitly — `evals/ HAS been type-checked since C10X-43, and that changes nothing here: no type gate sees this class` — 6a9009f
- [x] 6.3 `prettier --check` passes on every edited markdown file — exit 0 on `test-plan.md`, `roadmap.md`, `README.md`, `AGENTS.md` and this `plan.md`. `AGENTS.md`/`README.md` needed no write (already clean); the two `context/foundation/` files did, and the write was proved safe rather than assumed: **idempotent** (a second `--write` is byte-identical, both files), and every `>` line **byte-identical and in order** in both — the strongest available form of the landmine check, covering every dated block at once. Prettier's own changes are confined to table-cell padding in the three tables this phase touched plus one blank line before a nested blockquote; **zero** non-table deletions in either file. The archive is untouched by prettier — `--list-different "context/archive/**/*.md"` reports nothing, which is `.prettierignore` doing exactly the job Phase 3 §0 built it for — 6a9009f
- [x] 6.4 `npm test` green — **364/364, 31 files**, seed 1785756285955. Unchanged from Phase 5, and correctly so: the only test-tree edit this phase makes is a comment in `candidates.test.ts`, so a moved count would have meant an assertion moved — 6a9009f
- [x] 6.5 `npm run typecheck` and `npm run lint` both exit 0 — `Result (133 files): 0 errors / 0 warnings`, `typecheck: OK — 133 files checked (floor 50)`; lint **0 errors**, 3 warnings, all three the pre-existing `no-console` in `evals/generation-quality.eval.ts`. The `flashcards.ts` and `candidates.test.ts` edits are comment-only and neither gate moved — 6a9009f

#### Manual

- [x] 6.6 Every dated entry received a correction line, not a rewrite — **the criterion was run twice: once as diff shape, then again by reading every diff, and only the reading found anything.** Shape: `git diff --numstat -- context/archive/` is **13 files, 129 insertions, 0 deletions** — pure additions, so no archived sentence was altered, reflowed or reformatted, which is the strongest available form of "a line, not a rewrite" and is only possible because Phase 3 §0's `.prettierignore` kept `lint-staged` off these files. In `test-plan.md` the only non-table deleted line in the whole diff is `> Last updated: 2026-08-02` → `> Previously: …`, that file's own header-rotation idiom and not a historical entry; in `roadmap.md` there are **zero** non-table deletions, so H-10's dated block took a supplement on a new line exactly as the H-03 precedent requires. **Reading then found two defects in the corrections themselves, both of the class this repo keeps recording.** (1) The highest-value correction — on the retired blocker — asserted the three `astro check` errors "were fixed by changes that did not record doing so". **False**, and reassurance-shaped: `git log` on the three paths names `674e919` (2026-07-30), whose subject line is `fix(types): clear 4 latent type errors for a green astro check (M3L3)` and which touches exactly those files. Corrected to name the commit, with the retraction recorded at the site. (2) **Pointer rot inside a correction I had just written**: `candidate-review/plan.md`'s first block said "same correction applies at `:268` below", but its own insertion had already shifted that line to `:274`. Both blocks re-anchored on heading text rather than on a number — the failure mode §8 records for C10X-28's evidence paths and C10X-34's denominators, reproduced here in the act of correcting it. **Two of the plan's counts were also wrong and are recorded as observed rather than rounded**: the archive carries **13** files making a falsified claim, not the nine Phase 3 measured (that nine counted prettier-DIRTY files and was used only to justify `.prettierignore`, which covers `context/archive/**` wholesale — so nothing operational rested on it), and the dated corrections total **21 sites across 14 files**, not 17. **Re-measured after the commit, because that is the run that matters**: this phase's commit is the first time the now-live `pre-commit` hook has ever staged an archive file, so `.prettierignore` was under test rather than under argument — `git diff --numstat HEAD~1 HEAD -- context/archive/` reports **13 files, 129 insertions, 0 deletions**, i.e. `lint-staged`'s `prettier --write` ran over 18 markdown files and reformatted none of these thirteen — 6a9009f
- [x] 6.7 `test-plan.md` §2 and §6.6 consistent and readable together — **the check forced one addition and then caught two inconsistencies, which is the argument for it being a read rather than a grep.** The addition: **§6.6 had no C10X-43 entry to be consistent WITH**, so one was written in the established shape (a 9-row claims table, three traps, a does-NOT-prove list), together with a §8 ledger entry and a header-block entry, because §2 now points a reader at all three. The two catches: §6.6 called this "the **third** entry whose subject is whether the project's own instruments can be trusted" while listing **three** predecessors, and the §8 entry independently called it "a **fifth** axis" listing four — the total-versus-breakdown defect this file records against C10X-39, C10X-40 and C10X-42, caught only because the two entries disagreed with each other; both now read **fifth** over the same four predecessors, and the miscount is disclosed at the site rather than silently fixed. And §2 claimed the gate runs "on **every** push and PR to `main`" while §6.6 correctly stated `paths-ignore` skips a markdown-only commit; §2 is tightened to say so, with the reason it is not a hole (a markdown-only commit cannot carry a type error). Read together now, they agree on the boundary in near-identical words from both ends: §2's fourth half says the gate "proves the eval **compiles**, never that it RAN", §6.6's first does-NOT-prove bullet says "It proves the project COMPILES, never that anything RAN" and traces it back — "so §2's fourth dated half retires one clause and moves nothing else". §2 remains the coverage claim, §6.6 the mechanism, per this file's own house rule — 6a9009f
- [x] 6.8 `jira-map.md` untouched, verified by `md5sum` before/after (it is gitignored, so a `git diff` proves nothing) — `c151ead0cc61c582bf190b3c960e7ba1`, and corroborated independently by an **mtime of 2026-08-02 15:11:22**, i.e. predating this session entirely, which is the stronger evidence since it cannot be produced by a write-then-restore. `git check-ignore -v` confirms `.gitignore:70` covers it, so the diff really would have proved nothing. Both flagged defects re-verified present and deliberately left: line 86's `Change ID` still reads `— (jeszcze nie nadany)` although the change-id is `typecheck-gate`, and its source path still points at `context/changes/forced-language-prompt-fix/…` for a change archived at `context/archive/2026-07-31-forced-language-prompt-fix/…`. Owned by the Jira skills (`jira-map.md:3-4`); flagged in `test-plan.md` §8's still-open bullet so it is recorded somewhere a reader meets it — 6a9009f
- [x] 6.9 Roadmap H-11 row present with `Status` unset — row at `## At a glance` `:65` with an empty Status cell, block `### H-11` at `:354` with a bare `- **Status:**` at `:364`, and **absent from `## Done`**, which is the half that matters: `lessons.md:180` reserves both the Status flip and the `## Done` entry for `/10x-archive` — 6a9009f
