# Run the generation-quality eval from CI on demand — Implementation Plan

## Overview

Add `.github/workflows/eval.yml`, a `workflow_dispatch`-only workflow that runs `npm run eval`
against the real OpenRouter provider, so the LLM-as-judge generation-quality eval — the project's
only check that reaches the real AI provider — stops being local-only. The change also makes the
eval write its own report files (so the verdict survives the run in a readable, uploadable form),
corrects two comments in `evals/` that would otherwise mislead the next reader, closes one
empty-string hole in the judge's model override that the new workflow inputs would otherwise open
(plan-review F1), and syncs the documentation claims that go false the moment this ships (count
enumerated in Phase 3, not asserted here).

The hard contract, carried in the workflow's own header and repeated in every doc entry: **a red
run here means a REAL generation defect, not a hygiene failure.** `npm run eval` exits 1 by design
(C10X-41's baseline was an honest red), so this workflow must never be wired as a deploy-blocking
gate. The contract is "run it and read the table", not "keep it green".

## Current State Analysis

`npm run eval` (= `vitest run -c vitest.eval.config.ts`) exists, works, and is invoked by hand with
`OPENROUTER_API_KEY` in the shell environment. Nothing automates it. `test-plan.md` §5 records the
CI leg as deliberately deferred by C10X-31, and `evals/lib/judge.ts:204-207` carries an instruction
written by that change's impl-review **for the builder of this workflow**.

What research established that changes the shape of the work (`research.md` §1-§4):

- **The mechanical part is five steps and needs almost nothing.** No `npx astro sync` (the
  `astro:env` runtime module comes from the Vite plugin's `load` hook, never from `.astro/`), no
  `supabase start`, no Docker, no `SUPABASE_*`, no `.env`. Each proved by execution.
- **One step-level env var feeds both key seams.** `getViteConfig()` installs the `astroEnv`
  plugin, whose loader calls Vite's `loadEnv(mode, envDir, "")` with an **empty prefix**; `loadEnv`
  overlays the whole `process.env` onto `.env` values, and under Vitest the merged object is
  inlined as a JSON literal into the `astro:env/server` virtual module. So the generator's seam
  (`eval-preflight.ts:39`) and the judge's `process.env` seam (`:46`) are both satisfied by one
  export.
- **The brief's load-bearing premise is half wrong, in the direction that reads as reassurance.**
  `evals/generation-quality.eval.ts:128-130` claims Vitest 4 swallows `console.log` from passing
  tests. Measured on this repo's Vitest 4.1.10: that holds only under the auto-selected `agent`
  reporter (`std-env` keys on `CLAUDECODE`) and is **false** under `default`, which is what a
  GitHub runner gets. In CI the eval therefore prints ~165 lines of card text plus the summary
  table on **every** run, green ones included.
- **`schema-diff.yml`'s disclosure rationale does not transfer.** Its argument needs content that
  is both absent from the public repo _and_ security-relevant. Of the eval's four content classes,
  two (reference texts, model names) are already committed byte-for-byte, and the other two
  (generated cards, judge rationales) are low-value derivatives of a published fixture through a
  published prompt. The API key is not reachable from any first-party error path — two sites only,
  both `Authorization` headers. And masking inverts the intuition: **secret redaction applies to
  logs, not to artifacts.**
- **Three traps each produce a workflow that looks correct and is not.** `if: failure()` on the
  upload (the precedent's justification — "a green run's file is zero bytes" — does not hold when
  the green table _is_ the deliverable); `| tee` without `pipefail`, which makes **a red eval read
  as green** (measured; GitHub's default `run:` shell on Linux is `bash -e {0}` with no pipefail);
  and a **job**-level `timeout-minutes`, after which whether an `if: always()` step still runs is
  **undocumented** — a **step**-level timeout is documented to kill the process and let the job
  continue.

### Key Discoveries

- `evals/setup/eval-preflight.ts:39,46` — the two seams the workflow env must satisfy; the secret
  must arrive as `OPENROUTER_API_KEY`, whatever it is named in the secret store.
- `evals/lib/judge.ts:5-7` — the written precedent that `evals/lib/` may do I/O and log, both of
  which are `src/`-only prohibitions. Nothing under `tests/` imports `judge.ts` or the eval file.
- `evals/lib/scoring.ts:1-5` — the opposite constraint: that file is pure and is pulled into the
  ordinary `npm test`, so no I/O may land there.
- `evals/generation-quality.eval.ts:185-210` — the report-then-assert order already exists; the
  summary prints before the run-level assertion, deliberately.
- `evals/lib/scoring.ts:135,141-152` — `SUMMARY_HEADER` and `summaryRows()` already **return
  strings**; only the sink moves.
- `astro.config.mjs` — `OPENROUTER_MODEL` is declared `optional: true`, and
  `astro/templates/env.mjs` maps `'' → undefined` inside `_internalGetSecret`, so an empty
  workflow input degrades to `openai/gpt-4o-mini` (`openrouter.ts:19`) rather than breaking.
- **That property is NOT shared by the judge's model override, and the difference is the whole
  reason both inputs need separate handling** (plan-review F1). `EVAL_JUDGE_MODEL` is
  `process.env` **only** — never in the Astro schema (`research.md:150`) — so `judge.ts:32`
  reads the raw value through `??`, which does not fall through on `""`. GitHub Actions sets an
  env key whose expression resolves empty to the empty **string**, not unset. Left unhandled, the
  no-input dispatch — the default one — sends `model: ""`, OpenRouter answers `400`, and
  `judge.ts:128` classes `400` as neither `429` nor `≥500`, so it throws on the first card of the
  first case with no retry. Both halves of the fix are in this plan: the workflow never exports an
  empty value (Phase 2), and the reader stops accepting one (Phase 1 §3).
- `.gitignore:20` — `*.log` is already ignored; a report file with any other extension would not be.
- `.github/workflows/ci.yml:106,128` — the complete set of `needs:` in the repo, both inside one
  file. `needs:` cannot reference a job in another workflow, and a `workflow_dispatch`-only
  workflow produces no check run on a PR, so it cannot be auto-adopted as a required check.
- `.github/workflows/schema-diff.yml:16-23,30-40,100-109` — the no-`schedule:` paragraph to
  parallel, the per-step-secret rationale (discriminator: "does `npm ci` run in this job"), and the
  log-vs-artifact reasoning whose disclosure half does **not** transfer.
- Exit codes do not distinguish the three failure classes (preflight abort, mid-run infrastructure,
  real generation defect) — all exit 1. They are separable only from the output: a preflight
  failure prints `Eval preflight failed:` and produces **no table at all**.

## Desired End State

A human with write access opens the Actions tab, dispatches **Generation quality eval**, optionally
overriding either model, and ~3-6 minutes later reads the 11-row verdict table in the job log. The
full card-by-card record — every generated card, every judge verdict and rationale, plus the raw
console stream including Vitest's own assertion diffs — is attached as a single artifact named for
the run attempt, so a re-run under C10X-31's calibration rule ("a red case is re-run once by hand
before being believed") keeps both attempts side by side. A red run fails the step honestly and the
artifact is uploaded anyway. Nothing in the repository can make this workflow block a release.

Verified by: a green dispatch and a deliberately red dispatch, both from `main`, with the artifacts
downloaded and read (Phase 4).

## What We're NOT Doing

- **No `schedule:` / cron.** Deliberate and load-bearing, same reasoning that parked C10X-35: this
  project has no notification channel and no owner for the result, so a nightly red in a tab nobody
  reads is an alarm without a listener, not coverage. Adding it is one line; do it the day a channel
  and an owner exist.
- **Not a gate, in any form.** No `needs:`, no `workflow_run:`, no required status check, no
  branch-protection entry. A red run must never stop a release.
- **No `tsc --noEmit`** anywhere in this workflow. `evals/` sitting under no type gate is real and
  is owned by **C10X-43** — `jira-map.md:369-372` already draws the boundary: C10X-42 gives
  running-in-CI, C10X-43 gives compilability. Do not merge the two.
- **No GitHub Environment and no required reviewers.** Considered and rejected (see Key Decisions):
  the blast-radius cap lives on the OpenRouter key, not on the workflow.
- **No widening of `npm test`.** `vitest.eval.config.ts`'s `include` replacement and the two
  inverse preflights stay exactly as they are. This is a third run path, not a widening of the
  second.
- **No `.env.example` row.** A key in `.env` satisfies only seam 1 and additionally breaks the next
  `npm test` (`tests/setup/preflight.ts`).
- **No changes to the eval's thresholds, matrix, prompts, or `scoring.ts` logic.** If a dispatch
  finds a generation defect, that is the instrument working; fixing it is a separate ticket, exactly
  as C10X-31 → C10X-41 already went.
- **No OpenRouter Provisioning API.** The low-credit key is created in the dashboard by hand; the
  Provisioning API needs a separate _Management_ key, which would be a new credential class for a
  one-off operation.
- **No alerting, no cost dashboard, no budget pre-check step.** Named as a possible future, not
  built.

## Implementation Approach

Four phases, ordered so that each one's evidence is available before the next one claims anything.

Phase 1 puts the report where it can be uploaded, and does it inside `evals/` where the I/O
precedent already exists. Phase 2 writes the workflow against a report format that already exists
on disk, so nothing in the YAML has to guess at file names or grep for a string owned by another
module. Phase 3 provisions the credential and syncs the documents, with the run-identifier fields
left to be filled. Phase 4 is the only place a dispatch can happen at all — the workflow is
undispatchable until it reaches the default branch — and it closes both directions (green and red)
plus the artifact-immutability question, then fills the numbers Phase 3 left open.

**The report split is derived from the "both" capture decision and is what buys the house
principle for free.** Rather than have the workflow grep a summary table out of a larger file
(which would couple the YAML to a string literal living in `scoring.ts`), the eval writes two
files: the full record and the summary alone. The workflow prints the summary file into the job log
and uploads all three files — summary, full record, raw console stream — as one artifact. That is
`schema-diff`'s "the log keeps the verdict, the body goes to an artifact" shape, obtained without a
fragile text coupling, and it keeps card text out of the world-readable log as a side effect rather
than as its justification.

## Critical Implementation Details

**The report write must never mask the verdict.** The eval's `afterAll` prints and then asserts, in
that order, on purpose. A file write placed in that hook sits _before_ the run-level assertion, so
an unwritable filesystem would abort the hook and turn a real generation defect into a write error —
this repository's recurring "the check is correct about what it looks at and silent about what it
never looks at" shape, inverted. The write therefore reports its own failure and continues; the
verdict assertion must be reached in every case where it would have been reached before.

**Exit-code capture, and why no pipe appears anywhere.** GitHub's default `run:` shell on Linux is
`bash -e {0}` with **no** `pipefail`. `npm run eval | tee eval.log` was measured to exit **0 on a
red run** — verbatim the class `lessons.md` records as "a command that always exits 0 is not a
gate". The step therefore uses a redirect (never a pipe), captures the status with `|| STATUS=$?`
so `-e` does not abort the step before the summary is echoed and the upload step is reached, and
ends on an explicit `exit`. Do not "simplify" this back to a bare command or a pipe.

**`generator_model` travels the transform-time seam.** `OPENROUTER_MODEL` is read through
`astro:env/server`, whose value is inlined when the config loads — so it must be on the _eval
step's_ `env:`, not exported later, and an empty input value is correct (it maps to `undefined` and
falls through to the default) rather than something to guard against.

**`judge_model` travels a different seam, and the two must not be written alike.**
`EVAL_JUDGE_MODEL` is read from `process.env` at **run time** (`judge.ts:32`), through `??`, which
accepts `""` as a value. Two consequences, and both are deliberate rather than stylistic. It does
**not** have to sit on the step's `env:` at all — a guarded export inside the run script is
sufficient and is what keeps an empty input from ever reaching the reader. And the reader is
hardened in the same change (`??` → `||`), so the two guards are independent: the workflow half
protects this call path, the `judge.ts` half protects every other caller, including a developer who
exports `EVAL_JUDGE_MODEL=` locally. Do not "unify" the two inputs into one `env:` block — that is
exactly the edit that reintroduces the defect.

**Artifacts are immutable since v4 and names must be unique per run.** A second attempt uploading
the same artifact name **fails the step**. C10X-31's calibration rule makes re-runs a normal
operation here, so the name carries `github.run_attempt`.

**An absent report has FOUR causes, so the step must show evidence rather than name one**
(plan-review F2). A preflight abort throws in `globalSetup` before any file is collected, so neither
report file exists — but so does a collection-time error (live here: `evals/` sits under no type
gate, C10X-43, so a type error surfaces only at run time), a step-timeout kill, and any crash before
`afterAll`. Because every stream is redirected to a file, that branch's output is the job log's
_only_ diagnostic in all four states, and a sentence asserting the one cause the author happened to
think of is the reassurance-shaped inference this repo has already had to measure and retract
(C10X-39). So: **tail the last ~40 lines of `eval-console.log` into the log** and enumerate the
causes rather than picking one. A preflight abort identifies itself in that tail — it prints
`Eval preflight failed:` — which is strictly better than a guess and costs one line. The tradeoff is
stated rather than hidden: a mid-run failure can put card text in those 40 lines, so the "no card
text in the job log" property becomes "no card text on the paths anyone runs", not an invariant.

**And that branch ships unexercised.** Phase 4's controlled red uses a bogus `generator_model`,
which throws _inside_ a test, so `afterAll` still runs and both report files exist (criterion 4.4's
"three files for both runs" is correct precisely because of this). Nothing in the plan reaches the
no-report state, and nothing cheaply can — provoking it needs the secret removed or a broken commit
on `main`. Recorded as an unexercised branch in Phase 4's write-up, not claimed as covered.

---

## Phase 1: The report sink in `evals/`

### Overview

Make the eval write its verdict to disk on every run — local and CI alike, correct the two comments
in `evals/` that this change falsifies or fulfils, and close the empty-`EVAL_JUDGE_MODEL` hole
before Phase 2's inputs make it reachable.

### Changes Required:

#### 1. The eval's `afterAll` composes, prints, and writes

**File**: `evals/generation-quality.eval.ts`

**Intent**: The hook currently `console.log`s five groups of lines in a fixed order. Compose those
same lines into two arrays instead — the card-by-card record, and the summary section (the
generator/judge header line, `SUMMARY_HEADER`, the rows, the `MISSING` lines, and the `failures:`
block) — then print both in the existing order so the console output is byte-identical to today,
and additionally write them to disk. Two sinks, because the summary alone is what the workflow
echoes into the public job log while the full record goes only to the artifact.

**Contract**: two files written into the process cwd (the repo root under both `npm run eval` and
the workflow): `eval-report.log` = card record followed by summary section; `eval-summary.log` =
summary section only. Both names end in `.log`, which `.gitignore:20` already covers — that
extension is load-bearing, not incidental, and the file must say so.

The write is wrapped so a failure is reported and swallowed: the run-level `expect` at the end of
the hook must still be reached. Ordering inside the hook is unchanged — every line is printed
before `evaluateRun`'s verdict is asserted.

#### 2. Correct the false console-swallowing comment

**File**: `evals/generation-quality.eval.ts` (the comment block at `:124-130`)

**Intent**: The sentence "Vitest 4 swallows console output of PASSING tests" is false as a
statement about Vitest and true only about the `agent` reporter that `std-env` selects when
`CLAUDECODE` is set. Left as-is, the next reader concludes the CI log is already quiet — which is
exactly the reassurance-shaped inference this repo has already had to measure and retract once
(C10X-39's Kong keep-alive mechanism). Replace it with the measured statement, name the reporter
and the env key, and state the consequence for CI.

**Contract**: the reason the card log exists is unchanged (the calibration record needs the raw
pairs from green cases too); only the mechanism claim is corrected. Add the corollary that
`--disable-console-intercept` is an agent-terminal remedy and must not be copied into the workflow
reflexively.

#### 3. Close the pre-registered instruction in the judge client

**File**: `evals/lib/judge.ts` (the comment at `:204-207`)

**Intent**: That comment was planted by C10X-31's impl-review F5 to be met by whoever built this
workflow: "if the deferred `workflow_dispatch` leg ever lands, route this message to an artifact,
not the world-readable job log". It has now landed and the instruction is met — the throw's message
reaches stdout, which the workflow redirects into the console file and uploads. Rewrite the comment
as a dated statement of what now happens, rather than deleting it or leaving it as an open IOU.

**Contract**: the 300-character excerpt at `:208` stays exactly as it is. The comment states where
the message now lands and, per `research.md` §2, the honest qualification that an artifact on a
public repository is downloadable by any signed-in user and is **not** covered by secret masking
(masking applies to logs), so this narrows exposure rather than removing it.

#### 4. Stop `resolveJudgeModel()` accepting an empty override

**File**: `evals/lib/judge.ts` (`:32`)

**Intent**: `process.env.EVAL_JUDGE_MODEL ?? JUDGE_MODEL_DEFAULT` treats `""` as a chosen model, so
an empty override POSTs `model: ""` and every judge call dies on a `400` that the retry classifier
correctly refuses to retry. Reachable from the workflow (an empty `judge_model` input — Phase 2
guards that end too) and from any shell that exports the variable empty. Change `??` to `||`.

**Contract**: this **is** a behaviour change, stated as one rather than folded into the comment work
above — the only reachable difference is `""`, which today produces a guaranteed run failure and
afterwards produces the shipped default. A real override is unaffected (`||` and `??` agree on every
non-empty string). The header comment at `:10-12` gains one sentence saying an empty value means
"unset", so the next reader does not restore `??` as a tidy-up. Adding this makes Phase 1 a
**two-file, four-change** phase; criterion 1.5 is unchanged (still only the two `evals/` files).

### Success Criteria:

#### Automated Verification:

- `npm run lint` exits 0, and **no `no-console` warning appears outside
  `evals/generation-quality.eval.ts`**. Deliberately NOT "the 6 warnings are unchanged in count and
  location" (plan-review F3): all six sit at `:191-206`, inside the very hook this phase
  restructures, so composing-then-printing legitimately collapses them to about two at new lines —
  the old wording goes red on a correct implementation and pressures the implementer into keeping
  six call sites for no reason. Record the resulting count as **observed**, and carry it into the
  doc entries; the standing "6 pre-existing warnings in `evals/`" line that appears throughout
  test-plan §8 becomes stale on this change and is one of Phase 3's targets
- `npm run build` exits 0
- `npx tsc --noEmit` exits 0
- `npm test` is green at its current count and still collects **zero** eval files
- `git diff --stat` touches only the two files in `evals/`

#### Manual Verification:

- One local `npm run eval` produces `eval-report.log` and `eval-summary.log` in the repo root
- The hook still emits, in this order: card log → `generator: … | judge: …` → `SUMMARY_HEADER` →
  rows → `MISSING` lines → the `failures:` block — with the summary section composed **after**
  `evaluateRun` so the `failures:` block is inside it. Verified by **read-through against the
  pre-edit hook**, deliberately not by diffing two runs (plan-review F8): `vitest.eval.config.ts`
  sets `sequence: { shuffle: true }` with an un-pinned seed, and the cards come from a
  temperature-0.4 model, so two runs differ in content and row order whatever this edit does — "the
  output is unchanged" is not a property any run can falsify
- `eval-summary.log` contains the generator/judge line, the header, 11 rows, and no card text
- The process exit code is what it was before the edit for the same outcome
- `git status --porcelain` shows neither file (i.e. `.gitignore:20` genuinely covers them)
- Run that same local eval with `EVAL_JUDGE_MODEL` exported **empty**: the summary header prints
  `judge: google/gemini-2.5-flash`, i.e. the `||` coercion holds. No extra paid run — set the
  variable on the one run above, since the empty value is now indistinguishable from unset

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 2: The workflow file

### Overview

Write `.github/workflows/eval.yml`: dispatch-only, two optional model inputs, a fail-closed
credential guard, per-step secret scoping, a redirect that cannot lose the exit code, and an
unconditional artifact upload.

### Changes Required:

#### 1. The workflow

**File**: `.github/workflows/eval.yml` (new)

**Intent**: Run `npm run eval` on demand against the real provider, print the summary to the job
log, and attach the full record as an artifact — while making it structurally impossible for the
result to block a release.

**Contract**:

- `name: Generation quality eval`; job id `eval`; `runs-on: ubuntu-latest` (GitHub Actions is free
  for public repositories on standard runners, so the only spend is OpenRouter).
- `on: workflow_dispatch:` and nothing else. A file-header comment block **before** `name:`, in the
  `schema-diff.yml` shape, ending on the contract sentence; a separate comment on the trigger
  justifying the **absence** of `schedule:`.
- Two optional string `inputs:` — `judge_model` and `generator_model` — both defaulting to the empty
  string. These are the first `inputs:` in the repository; the comment states what each is for
  (`judge_model` is the documented cross-examination lever from test-plan §6.6; `generator_model`
  allows comparing generation quality between models without a commit) and that neither is
  validated, so a typo costs a failed run rather than a wrong verdict.
- **The two inputs reach the run by different mechanisms, and the asymmetry is load-bearing**
  (plan-review F1). `generator_model` goes on the eval step's `env:` as `OPENROUTER_MODEL`, where an
  empty value is correct — `astro:env` maps `'' → undefined`. `judge_model` must **not** be written
  that way: `EVAL_JUDGE_MODEL` is read raw from `process.env` through `??`, so an empty value is a
  _chosen_ model and kills the default dispatch. Pass it into the step as an intermediate variable
  and export `EVAL_JUDGE_MODEL` only when it is non-empty
  (`[ -n "$JUDGE_MODEL_INPUT" ] && export EVAL_JUDGE_MODEL="$JUDGE_MODEL_INPUT"`), which is safe
  because the judge reads it at run time. The comment must say why the two differ, or the next
  reader unifies them and reintroduces the defect. Phase 1 §4 hardens the reader independently; both
  guards ship, neither is redundant.
- `concurrency:` grouped on `github.workflow` **alone** with `cancel-in-progress: false`. The
  common `${{ github.workflow }}-${{ github.ref }}` is wrong here — two dispatches on different
  branches would land in different groups and run **at the same time**, against one OpenRouter
  account. **State the reason as serialisation, not as deduplication** (plan-review F6): with
  `cancel-in-progress: false` a second dispatch in the same group does not vanish, it queues and
  then runs, so both still pay. What the grouping buys is that they never run concurrently — which
  matters precisely because a separate key gives spend isolation and **not** rate-limit isolation
  (Phase 3 §1). Writing the comment as "this prevents the double spend" would be a false rationale
  of the class C10X-37's impl-review had to correct, in a comment nobody would ever re-measure.
- Steps: `actions/checkout@v7` → `actions/setup-node@v6` (`node-version: 22`, `cache: npm`) →
  credential guard → `npm ci` → the eval step → the upload step. Pins match `ci.yml` exactly so
  this file does not introduce a second version story.
- **The guard runs before `npm ci`**, in the `schema-diff.yml:60-72` idiom
  (`test -n "$X" || { …; exit 1; }`). The eval's own preflight already closes this seam, so the
  guard's value is that it fails in seconds instead of after a 60-second install — and the comment
  should say that rather than implying the preflight is absent.
- **Secrets are declared per step, never at job level.** The discriminator, stated at the site, is
  "does `npm ci` run in this job" — it does, and `npm ci` runs install lifecycle scripts for the
  whole tree on a public repository. A second, sharper reason applies specifically to the eval step
  and belongs in the comment: because Astro's env loader uses an **empty prefix**, every variable
  visible to that step is serialised into the `astro:env/server` module literal.
- **The secret name mapping.** `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_EVAL_KEY }}` — the store
  name is distinct from production's on purpose, the exported name is what both preflight seams
  read, and a workflow exporting it under the store name fails with a message confusingly about
  `.env`.
- The eval step carries a step-level `timeout-minutes` (worst case is ~22 minutes of test time:
  11 cases × the 120 s `testTimeout`). Job-level is deliberately avoided — see Critical
  Implementation Details.
- The eval step's script: redirect both streams to `eval-console.log`, capture the status with
  `|| STATUS=$?`, echo `eval-summary.log` into the job log if it exists — and if it does **not**,
  enumerate the four causes and **tail the last ~40 lines of `eval-console.log`** rather than
  asserting one of them (see Critical Implementation Details) — point the reader at the artifact for
  the full record, then `exit` the captured status. No pipe anywhere.
- The upload step: `actions/upload-artifact@v7`, `if: always()`, `name: eval-${{ github.run_attempt }}`,
  all three files, `retention-days: 30`. The comment states this as a **deliberate deviation** from
  the repo's only artifact precedent, with the reason the precedent's justification does not
  transfer (a green eval's table is the deliverable, not a zero-byte file) and the reason the name
  carries the attempt (v4 immutability against the calibration re-run rule).
- Comments admit uncertainty rather than assert it away, per house style — in particular that the
  cost and wall-clock figures are recorded local measurements, not guarantees.

### Success Criteria:

#### Automated Verification:

- `npx prettier --check .github/workflows/eval.yml` passes (a clean parse is also the YAML validity
  check; note `lint-staged`'s globs do **not** cover `*.yml`, so this must be run by hand)
- `npm run lint` exits 0 — ESLint does not cover YAML, so this only proves nothing else broke
- The file has LF line endings (`.gitattributes` enforces `* text=auto eol=lf`)
- `grep -c "needs:\|schedule:\|workflow_run:" .github/workflows/eval.yml` returns 0
- `gh workflow list` does **not** yet show the workflow — the "before" half of C10X-29's
  registration check, which is what turns Phase 4's "after" into evidence

#### Manual Verification:

- Read-through against the three measured traps: no pipe, exit status captured and re-raised,
  `timeout-minutes` on the step and not the job
- The upload is `if: always()` and its name carries `github.run_attempt`
- Every secret sits on a step's `env:`, none at job level
- `EVAL_JUDGE_MODEL` is exported **conditionally inside the run script**, never as a bare key on the
  step's `env:` — and `OPENROUTER_MODEL` is the other way round, on the `env:` block
- The file header states the never-a-gate contract, and the trigger comment states the deliberate
  absence of `schedule:`

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: The credential and the documentation

### Overview

Provision the separate low-credit OpenRouter key, and update the thirteen documentation claims that
go false when this ships. Entries that will cite run identifiers are written with those fields
explicitly marked as pending; Phase 4 fills them.

### Changes Required:

#### 1. The repository secret

**File**: none — an operational step, recorded here so it cannot be assumed

**Intent**: Create a **new** OpenRouter API key with a per-key credit limit set low, in the
OpenRouter dashboard, and store it as the repository secret `OPENROUTER_EVAL_KEY`. This key is the
change's actual blast-radius cap: per-key credit limits are verified to be enforced by refusing
requests with `402`, and `judge.ts:128` treats `402` as neither `429` nor `≥500`, so it throws
immediately with no retry — the loud behaviour we want.

**Contract**: the key is neither the developer's own nor production's. Its cap should be set to a
small multiple of a run (~$0.013 measured for the 11-case matrix), high enough that a legitimate
dispatch plus a calibration re-run cannot be strangled by it. Verify presence with `gh secret list`
— the API lists names only, never values, so "the stored value is the working credential" is a
claim only Phase 4's green run can settle. Note the honest limit: a separate key buys **spend
isolation only, not rate-limit isolation** — OpenRouter governs capacity globally per account.

#### 2. README

**File**: `README.md` (the CI section, `:167-194`)

**Intent**: The workflow inventory paragraph currently names `schema-diff` as _the_ separate
workflow; there are now two dispatch-only workflows. The secrets table needs a row for
`OPENROUTER_EVAL_KEY`.

**Contract**: the table's house style is `yes — <em-dash clause naming the property that matters>`;
the property that matters here is that it is a **separate** OpenRouter key with a low credit limit,
never the developer's or production's. The inventory prose must repeat that neither dispatch-only
workflow can block a release, and that this one's red is a finding rather than a hygiene failure.

#### 3. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: **Eleven** existing locations claim the eval has no CI leg, plus two new entries. Counted
by enumerating them, not by carrying a total over — `research.md`'s doc-sync table has twelve ROWS,
two of which cover two locations each, and re-labelling rows as claims is how "thirteen" and "eight"
both entered this plan while neither matched the list beneath it (plan-review F7; the same
total-vs-breakdown defect §8 records against C10X-40). The list, live class first:

1. §2's Risk #7 row — _live_
2. §4's Stack AI-native row (invocation and `checked:` date) — _live_
3. §5's gate table LLM-as-judge row — _live_
4. §5's deferral paragraph beneath it — _live_
5. §3's Phase 5 sequencing note, where it states the current situation — _live_
6. §3's Phase 5 sequencing note, where it narrates what C10X-31/C10X-41 did — _historical_
7. §6.6's C10X-31 "No CI leg" bullet — _historical_
8. §6.6's C10X-41 "Nothing about CI" bullet — _historical_
9. §8's C10X-31 ledger entry — _historical_
10. §8's C10X-41 ledger entry — _historical_
11. the rolling header block's C10X-31 summary (`:248`) — _historical_, added by plan-review F4

Then a new §6.6 entry and a new §8 ledger entry for this change. Outside test-plan: README (the
workflow inventory paragraph **and** the secrets table row — two edits, not one), roadmap H-10,
jira-map. The `no-console` warning count that appears throughout §8 as "6 pre-existing warnings in
`evals/`" also goes stale on this change (Phase 1's refactor moves them); fix it wherever it is a
**live** figure and leave the dated ledger entries to their correction lines.

If the count and the list ever disagree, the **list** is right — recount rather than trusting the
number, including in this change's own §8 ledger entry.

**Contract**: **the wording trap is the whole difficulty and it appears in five of those targets.**
Every one says "human-triggered", and that stays **true** after this ships — `workflow_dispatch`
_is_ human-triggered. What changes is "local only" / "no CI". Edit the **location** claim, never the
trigger claim; §8's "this coverage date does not refresh itself" sentences survive verbatim and
must not be softened.

**Two target CLASSES, two different edits — decide per site before touching anything**
(plan-review F4). A **live** claim (what the project is protected by _today_: §2's Risk #7 row, §4's
Stack row, §5's gate row and deferral paragraph, §3's Phase 5 note where it describes the current
state) is **edited**. A **historical** entry (a dated record of what an earlier change did or
deferred: §6.6's C10X-31 / C10X-41 does-NOT-prove bullets, §8's two ledger entries, and the file's
rolling header block) takes a **dated correction line, never a rewrite** — the C10X-30 "4xx"
precedent, which test-plan §8 states four separate times. The one documented exception is C10X-39,
where paraphrase was chosen _because_ a standing regression grep would otherwise never pass; that
reason does not apply here, so it is not the precedent to copy.

**One target is missing from the enumeration above and from `research.md`'s table**: the rolling
header block at `test-plan.md:248`, inside the "Previously: … (C10X-31)" summary — "the CI/workflow
leg is deliberately deferred (local-only, human-triggered; §5)". It is the **first** thing a reader
of that file meets, and it is a historical entry, so it takes a correction line. Add it to the list;
the count in this section moves with it. The new §6.6 entry carries a claims table and a does-NOT-prove list in the
established shape, including: this proves the eval _can_ run in CI, never that anyone runs it; the
75% acceptance rate is still not measured; `evals/` is still under no type gate (C10X-43); and the
red class exercised in Phase 4 is infrastructure, not a real generation defect.

#### 4. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Add row **H-10** for this change. H-06's Outcome already names this follow-up in
Polish, including the separate low-credit key as the damage limiter.

**Contract**: follows the H-01…H-09 row shape (id, change-id, user-facing outcome in Polish,
milestone, PRD anchor, status). Unlike H-07/H-08 this is not a backfill — the row exists before the
change archives.

#### 5. Jira map

**File**: `context/foundation/jira-map.md` (C10X-42's row, `:84`)

**Intent**: `Change ID` is empty on both sides; the change folder now exists, so fill the map side.

**Contract**: map side only. `customfield_10041` on the Jira side is `/jira-finish-work`'s job, not
this plan's — and the file itself records that the review's own note is never the source of truth
about a key; this file is.

### Success Criteria:

#### Automated Verification:

- `gh secret list` shows `OPENROUTER_EVAL_KEY`
- `npm run format` leaves the edited markdown clean (or `npx prettier --check` passes on it)
- `grep -rn "local only\|local-only\|no CI leg\|Nothing about CI" context/foundation/test-plan.md`
  returns **only** hits that are (a) unrelated to the eval — `:1735` is `config.toml`'s "local-only
  values" and is a permanent false positive — or (b) inside a historical entry that now carries a
  dated correction line beside it. It must NOT be read as "the strings are gone": under the
  live-vs-historical rule above, several survive on purpose. Take the hit list **before** the edit
  and classify every line, so this criterion compares against that list rather than against zero
- Every **pre-existing** "human-triggered" occurrence still exists, checked **per site** against a
  `grep -n` list taken before the edit (13 hits today), pinning the surrounding sentence rather than
  the total. Deliberately NOT `grep -c … is unchanged` (plan-review F5): that count goes UP for a
  correct edit, because this phase's own new §6.6 and §8 entries must say the eval is still
  human-triggered — and it stays level if one site is destroyed while a new entry adds one, which is
  the "a total and its breakdown are two claims" false green §8 records against C10X-40
- `grep -n "H-10" context/foundation/roadmap.md` returns the new row
- `npm test` still green (documentation-only edits, but the suite is the regression check)

#### Manual Verification:

- The new §6.6 entry's does-NOT-prove list is present and names all four boundaries above
- The README secrets row states the separateness and the credit limit, not just "yes"
- No document claims a measured run identifier that Phase 4 has not yet produced — pending fields
  are visibly marked as such

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Ship-time evidence

### Overview

Everything dispatch-related lives here, because a `workflow_dispatch` workflow is not dispatchable
until it exists on the default branch — measured on this repository once already (C10X-29:
`HTTP 404: workflow schema-diff.yml not found on the default branch`, with the recorded conclusion
that there is no honest workaround). Close both directions, settle the artifact-immutability
question at near-zero cost, and fill the identifiers Phase 3 left pending.

### Changes Required:

#### 1. Registration

**Intent**: After the merge to `main` (via `/ship`), confirm the workflow registered. Paired with
Phase 2's "before" check, this turns registration into evidence rather than an assumption.

**Contract**: `gh workflow list` before (absent, Phase 2) and after (present). Record both.

#### 2. The green dispatch

**Intent**: Prove the happy path end to end, and prove the stored secret is the working credential —
which nothing before this point can establish.

**Contract**: `gh workflow run` with no inputs. Record run id, wall clock, and outcome. Then: the
job log contains the 11-row summary and **no card text**; the artifact `eval-<attempt>` exists and
carries all three files; the full record contains the card-by-card log; the generator/judge line
names the shipped defaults. If the run is red on a real generation defect, that is the instrument
working — record it, do not fix it here (C10X-31 → C10X-41 is the precedent).

#### 3. The controlled red dispatch

**Intent**: Prove the three things a green run cannot: that a red genuinely fails the step, that the
artifact is uploaded anyway, and that the exit code survived the redirect.

**Contract**: `gh workflow run` with `generator_model` set to a bogus model id. This fails at the
first generation call, so the red run costs a fraction of a green one and needs no commit and no
revert — which is what the `generator_model` input buys beyond its stated purpose. **State the
boundary in the write-up rather than letting it be inferred: this exercises the _infrastructure_
failure class, not the _real generation defect_ class.** The distinction matters because the two are
indistinguishable by exit code and separable only from the output.

#### 4. The re-run

**Intent**: Settle the artifact-immutability decision by execution rather than by reading the docs.

**Contract**: re-run the **red** dispatch (the cheap one) so it reaches attempt 2, and confirm the
upload succeeds with a distinct artifact name and both attempts remain downloadable. Had the name
been fixed, this step would have failed.

#### 5. Fill the pending fields

**Intent**: Replace Phase 3's pending markers with the measured values.

**Contract**: run identifiers, wall clock, observed cost, and the outcome of each of the three
dispatches land in the change's `verification.md` and in the test-plan §6.6 / §8 entries. Figures
are recorded as observed, never rounded to the prediction — this file's standing discipline.

The write-up must also state, in its own sentence rather than by omission, that **the no-report
branch of the eval step was never executed**: all three dispatches produce both report files,
because a bogus model throws inside a test and `afterAll` still runs. Its four causes and its tail
are carried by reading, like the drift runner's I/O branches (test-plan §6.6, C10X-29).

### Success Criteria:

#### Automated Verification:

- `gh workflow list` shows the workflow after the merge and did not before
- `gh run view <green-run> --json jobs` shows the eval job `success`
- `gh run view <red-run> --json jobs` shows the eval job `failure`
- `gh run download` succeeds for both runs and yields three files each
- The red run's second attempt produced a second, distinctly named artifact
- `grep -rn "sk-or-\|Bearer " <downloaded logs>` returns nothing

#### Manual Verification:

- The green run's job log carries the summary table and no card text
- The red run's artifact exists despite the failure — i.e. `if: always()` did its job
- The red run's console file names the generator failure, and the step is red rather than green —
  the redirect did not swallow the status
- The full record in the green artifact is readable as a calibration record (card, verdict,
  rationale per line)
- No workflow anywhere lists this one in `needs:`, and it appears in no branch-protection required
  check

**Implementation Note**: This phase spends real money (two to three paid dispatches, ~$0.02 total
at recorded rates) and mutates the default branch. Confirm before each dispatch.

---

## Testing Strategy

### Unit Tests

None added. The report sink is I/O inside a hook that only the eval run path executes, and
`evals/lib/scoring.ts` — the one part of this surface the ordinary suite covers — is untouched, by
design: it is pure and is imported by `tests/lib/eval-scoring.test.ts`, so I/O there would be
dragged into a suite whose preflight forbids the key.

### Integration Tests

None. The workflow's behaviour is not assertable from any test layer this project has; it is
carried by the recorded dispatches in Phase 4. This is the same boundary `test-plan.md` §6.6 draws
for the drift runner: no test in the suite touches the cloud, and the wiring is evidence rather than
an assertion.

### Manual Testing Steps

1. Run `npm run eval` locally after Phase 1; confirm both files, unchanged terminal output,
   unchanged exit code, and that git ignores both.
2. Read the workflow against the three traps after Phase 2.
3. After the merge, dispatch once with no inputs; read the summary in the log and download the
   artifact.
4. Dispatch once with a bogus `generator_model`; confirm the job is red and the artifact is present.
5. Re-run that red dispatch; confirm the second artifact uploads under a distinct name.

## Performance Considerations

Wall clock is dominated by the provider, not the runner: 117-312 s recorded locally for the matrix,
plus `npm ci`. The worst case is bounded by the 120 s `testTimeout` × 11 sequential cases ≈ 22
minutes, which is what the step timeout is sized against. Cases are sequential on purpose — to
avoid parallel-hammering the provider and to keep the verdict table readable — and this change does
not alter that.

## Migration Notes

None. No schema change, no migration, so the C10X-29 drift gate is not involved. The one
out-of-repo state is the new repository secret, created in Phase 3 and proven working in Phase 4.

## References

- Research: `context/changes/eval-ci-dispatch/research.md`
- Charter: `context/changes/eval-ci-dispatch/change.md`
- The deferral this closes: `context/archive/2026-07-29-ai-candidate-generation-test-3/plan.md:87-90,102-103`
- The pre-registered instruction: `context/archive/2026-07-29-ai-candidate-generation-test-3/reviews/impl-review.md:122-137`
- The design already sketched: `context/archive/2026-07-29-ai-candidate-generation-test-3/research.md:179-195` ("Escape route C")
- The default-branch trap, measured: `context/archive/2026-07-27-schema-drift-test/verification.md:474-507,926-937`
- The artifact precedent and its own concession: `context/archive/2026-07-27-schema-drift-test/reviews/impl-review.md:144-173`
- Workflow template: `.github/workflows/schema-diff.yml`
- Version pins to match: `.github/workflows/ci.yml:14-20`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The report sink in `evals/`

#### Automated

- [x] 1.1 `npm run lint` exits 0; no `no-console` warning outside `generation-quality.eval.ts`; new count recorded as observed — 73d8749
- [x] 1.2 `npm run build` exits 0 — 73d8749
- [x] 1.3 `npx tsc --noEmit` exits 0 — 73d8749
- [x] 1.4 `npm test` green at its current count, zero eval files collected — 73d8749
- [x] 1.5 `git diff --stat` touches only the two `evals/` files — 73d8749

#### Manual

- [x] 1.6 Local `npm run eval` produces `eval-report.log` and `eval-summary.log` — 73d8749
- [x] 1.7 Hook emits the five groups in the pre-edit order, summary composed after `evaluateRun` (read-through) — 73d8749
- [x] 1.8 `eval-summary.log` carries the table and no card text — 73d8749
- [x] 1.9 Exit code unchanged for the same outcome — 73d8749
- [x] 1.10 `git status --porcelain` shows neither file — 73d8749
- [x] 1.11 With `EVAL_JUDGE_MODEL` exported empty, the summary header names the default judge model — 73d8749

### Phase 2: The workflow file

#### Automated

- [x] 2.1 `npx prettier --check .github/workflows/eval.yml` passes — fc114d8
- [x] 2.2 `npm run lint` exits 0 — fc114d8
- [x] 2.3 File has LF line endings — fc114d8
- [x] 2.4 No `needs:`, `schedule:` or `workflow_run:` in the file — fc114d8
- [x] 2.5 `gh workflow list` does NOT yet show the workflow (registration "before") — fc114d8

#### Manual

- [x] 2.6 No pipe; exit status captured and re-raised — fc114d8
- [x] 2.7 `timeout-minutes` on the step, not the job — fc114d8
- [x] 2.8 Upload is `if: always()` with `github.run_attempt` in the name — fc114d8
- [x] 2.9 Every secret on a step `env:`, none at job level — fc114d8
- [x] 2.10 `EVAL_JUDGE_MODEL` exported conditionally in the script; `OPENROUTER_MODEL` on the step `env:` — fc114d8
- [x] 2.11 Header states the never-a-gate contract; trigger comment states the deliberate absence of `schedule:` — fc114d8

### Phase 3: The credential and the documentation

#### Automated

- [x] 3.1 `gh secret list` shows `OPENROUTER_EVAL_KEY` — 39a50e4
- [x] 3.2 Prettier clean on the edited markdown — 39a50e4
- [x] 3.3 Every surviving "local only" / "no CI leg" hit in test-plan.md is classified: unrelated, or historical with a dated correction beside it — 39a50e4
- [x] 3.4 Every pre-existing `human-triggered` site survives, checked per site against the pre-edit `grep -n` list — 39a50e4
- [x] 3.5 Roadmap row H-10 present — 39a50e4
- [x] 3.6 `npm test` still green — 39a50e4

#### Manual

- [x] 3.7 New §6.6 entry carries a does-NOT-prove list naming all four boundaries — 39a50e4
- [x] 3.8 README secrets row states separateness and the credit limit — 39a50e4
- [x] 3.9 Pending run-identifier fields visibly marked, none fabricated — 39a50e4

### Phase 4: Ship-time evidence

#### Automated

- [x] 4.1 `gh workflow list` shows the workflow after the merge
- [x] 4.2 Green dispatch: eval job `success`
- [x] 4.3 Red dispatch (bogus `generator_model`): eval job `failure`
- [x] 4.4 `gh run download` yields three files for both runs
- [x] 4.5 Red run's second attempt produced a distinctly named artifact
- [x] 4.6 No key material in either downloaded log

#### Manual

- [x] 4.7 Green run's job log carries the summary and no card text
- [x] 4.8 Red run's artifact present despite the failure
- [x] 4.9 Red run's console file names the generator failure; step red, not green
- [x] 4.10 Green artifact readable as a calibration record
- [x] 4.11 No `needs:` reference and no required-check entry anywhere
- [x] 4.12 Pending fields in Phase 3's documents replaced with measured values
