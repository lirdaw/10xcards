<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Run the generation-quality eval from CI on demand (C10X-42)

- **Plan**: `context/changes/eval-ci-dispatch/plan.md`
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-08-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## What was re-verified by execution, not taken on report

Every automated criterion in all four phases was re-run against the current tree, and Phase 4's
ship-time evidence was re-fetched from GitHub rather than read out of `verification.md`:

| Check                                                   | Result                                                                                                                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                          | exit 0 — **3 warnings**, all in `evals/generation-quality.eval.ts` (the 6→3 claim holds). `:169,258,259` before triage, `:169,238,268` after it — the count is what the claim is about, and it did not move |
| `npm run build` / `npx tsc --noEmit`                    | exit 0 / exit 0                                                                                                                                                                                             |
| `npm test`                                              | **345 passed / 345, 30 files**, seed `1785693539103`                                                                                                                                                        |
| eval files collected by `npm test`                      | **zero** (`npx vitest list --filesOnly \| grep -c "evals/"` = 0; only `tests/lib/eval-scoring.test.ts` matches on name)                                                                                     |
| `npx prettier --check` on all four edited markdown/YAML | clean                                                                                                                                                                                                       |
| `needs:` / `schedule:` / `workflow_run:` in eval.yml    | **0** on non-comment lines; the 4 hits are comment mentions (the documented 2.4/2.11 adaptation)                                                                                                            |
| LF line endings                                         | `git ls-files --eol` → `i/lf w/lf`                                                                                                                                                                          |
| `gh workflow list` / `gh secret list`                   | `Generation quality eval` id 325665475 present; `OPENROUTER_EVAL_KEY` present (2026-08-02T16:24:47Z)                                                                                                        |
| Green dispatch `30756678180`                            | `success`, artifact re-downloaded: **three files**, table byte-for-byte as recorded                                                                                                                         |
| Red dispatch `30756592782`                              | `failure` — eval step `failure`, **upload step `success`** (i.e. `if: always()` did its job)                                                                                                                |
| Key material in artifact + job log                      | `grep "sk-or-\|Bearer "` → **0** in both                                                                                                                                                                    |
| Card text in the green job log                          | **0** hits for all five reference-fixture markers                                                                                                                                                           |
| CI run `30755905899` at merge `92bc9de`                 | `ci` / `drift` / `deploy` all `success`                                                                                                                                                                     |
| Required checks / branch protection                     | `main` is **not protected** — nothing can adopt this workflow as a required check                                                                                                                           |

Two things checked and **not** raised as findings. `jira-map.md` is absent from the diffstat
because `.gitignore:70` untracks it — Phase 3 §5 was done on the working copy, correctly. And the
workflow declares no `permissions:` block, which looked like a gap until measured:
`default_workflow_permissions` on this repository is already **`read`**, so the posited
push-capable-token risk does not exist. The absence also matches `ci.yml` and `schema-diff.yml`,
so it is an inherited repo-wide pattern rather than something this change introduced.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — `eval-console.log` is uploaded unmasked, and it is the one artifact member whose contents are unbounded

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/eval.yml:157,198-207`
- **Detail**: The eval step redirects **both streams** into `eval-console.log`, which is then
  uploaded to a public repository for 30 days. `eval-report.log` and `eval-summary.log` are
  composed by first-party code and their contents are known; `eval-console.log` is whatever the
  process happened to write, including third-party error rendering. Two facts make this the
  weakest member. GitHub's secret masking applies to **logs, not artifacts** — so the artifact is
  strictly the less-protected sink, which the workflow comment at `:194-197` and
  `judge.ts:216-224` both already state, to their credit. And the key is in that step's
  `process.env`, which Astro's env loader serialises **in full** into the `astro:env/server`
  virtual module (verified against the installed Astro: `env-loader.js` calls
  `loadEnv(mode, envDir, "")` with an empty prefix, and `vite-plugin-env.js` inlines the whole
  merged object as a JSON literal). Any tool error path that rendered module source or dumped the
  environment into stderr would land it in that file in cleartext.
  **This is a structurally reachable vector, not an observed leak**: no such path was
  demonstrated, the module id is `\0`-prefixed so Vitest's code-frame reader cannot `fs`-read it,
  first-party errors carry `rawRequest` = the request **body** (never headers,
  `src/lib/openrouter.ts:190`), and my own grep over both downloaded artifacts returned zero hits.
  The exposure this change **does** create knowingly — reference texts, generated cards, judge
  rationales — was analysed in the plan and is a deliberate, argued decision; the key is the one
  class that analysis treats as unreachable rather than accepted.
- **Fix A ⭐ Recommended**: Scrub the key from the console file before upload — one line at the end
  of the eval step, e.g. `sed -i "s/\$OPENROUTER_API_KEY/***/g" eval-console.log` guarded so it
  cannot change `$STATUS`.
  - Strength: Keeps every stated benefit of capturing the raw stream (Vitest assertion diffs, the
    `Eval preflight failed:` marker the no-report branch points at) while closing the one class
    the current analysis assumes away. Costs nothing on a green run.
  - Tradeoff: Adds a line to a script whose comments explicitly warn against "simplifying" it, so
    the placement needs the same `|| true` care as the surrounding statements.
  - Confidence: HIGH — `$OPENROUTER_API_KEY` is already in scope on that step; the substitution is
    local and testable.
  - Blind spot: A key that appears in the stream percent-encoded or line-wrapped would survive a
    literal substitution. Not applicable to any known path here.
- **Fix B**: Drop `eval-console.log` from the artifact and keep only the two composed reports.
  - Strength: Removes the unbounded member entirely; the card-by-card record — the stated
    deliverable — lives in `eval-report.log`, and the `else` branch already tails the console into
    the job log, where masking **does** apply.
  - Tradeoff: Loses Vitest's own assertion diffs and the seed banner, which the plan's Desired End
    State names as part of what the artifact is for, and which `verification.md` used.
  - Confidence: MEDIUM — it trades a documented capability away to close an undemonstrated vector.
  - Blind spot: Whether anyone has actually needed the console file for triage yet; only three
    dispatches exist.
- **Decision**: FIXED via Fix A — `sed -i "s|${OPENROUTER_API_KEY}|***|g" eval-console.log
2>/dev/null || true` inserted immediately after the eval run (so the `else` branch's `tail`
  also prints scrubbed content), with the rationale stated at the site.

### F2 — The no-report branch enumerates four causes and misses a fifth, which is the only one that exits GREEN

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/eval.yml:170-178` (against `evals/generation-quality.eval.ts:150-158`)
- **Detail**: `writeReports` is deliberately best-effort — it catches and `console.error`s rather
  than throwing, so the run-level `expect` is always reached. That is correct and is the plan's
  own Critical Implementation Detail. But it creates a fifth path to "no `eval-summary.log`" that
  the branch does not list: **the hook ran fine and the write failed.** In that state the step
  exits **0** — green — while the job log asserts
  `"the run never reached the eval's afterAll hook"`, which is provably false (the write is only
  reachable _from_ that hook), and adds `"the exit code does not separate them"`, which is the one
  thing that is not true here: a zero status separates this cause from all four listed. The `tail`
  would show the `Could not write the eval report files:` line, so it is recoverable — but the
  branch text sends the reader down the wrong path first. This is precisely the shape the comment
  three lines above warns against ("naming the one cause the author happened to think of is the
  reassurance-shaped inference this repo has already had to measure and retract once").
- **Fix**: Add cause 5 ("the reports could not be written — look for
  `Could not write the eval report files:` below") and, since `$STATUS` is already in scope,
  branch the headline on it so a zero-status miss does not claim the hook never ran.
- **Decision**: FIXED — and the applied fix is slightly sharper than the one described here.
  `$STATUS` does not separate the fifth cause from the other four _symmetrically_: a zero status
  admits **only** cause 5, but a non-zero status admits **all five** (a red eval whose write also
  failed is a real state). So the zero branch is definitive and the non-zero branch enumerates
  five rather than four. Both branches still tail the console file.

### F3 — Two sentences in `test-plan.md` contradict each other about how many doc-sync targets took no edit, and neither total matches its own list

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/test-plan.md:23` and `:3837`
- **Detail**: The plan closes its Phase 3 enumeration with a standing instruction: "If the count
  and the list ever disagree, the **list** is right — recount rather than trusting the number,
  **including in this change's own §8 ledger entry**" (`plan.md:503`). That recount was not
  performed on two sentences, and they now disagree with each other:
  - `:23` (rolling header) — "**One** of those **eight** was re-checked and left deliberately
    untouched". The lists in the same sentence are 5 live + 5 historical = **10**, and the plan's
    enumeration is **11**. "Eight" matches neither.
  - `:3837` (§8 ledger) — "**Two** of the eleven produced no edit and say so at the site", then
    names exactly **one** (§8's C10X-41 bullet), which is also the only such site I could find.
    So the file says "one" in one place and "two" in another about the same fact. Nothing about
    coverage is affected — every one of the eleven targets was verified individually as correctly
    edited or correctly corrected — but this is the exact "a total and its breakdown are two claims"
    defect that §8 records C10X-40 catching against C10X-39, committed by the entry that cites it.
- **Fix**: Recount from the lists and make the two sentences agree — `:23` to ten (or eleven, if
  the Phase 5 note is counted in both classes as the plan does) with "one … was re-checked", and
  `:3837` from "Two of the eleven" to "One of the eleven".
- **Decision**: FIXED at **eleven**, which required settling which total is right rather than
  just aligning them. Verified that §3's Phase 5 note genuinely carries _both_ kinds of sentence —
  a live edit at `:593` ("That other item is CLOSED as of 2026-08-02") and a historical correction
  at `:604-606` ("Two sentences ABOVE are left standing … corrected here rather than rewritten") —
  so the plan's eleven (Phase 5 counted in both classes) is the accurate figure and the header's
  ten was an under-count of its own list. The header now enumerates the Phase 5 note in both
  classes and says so; `:3837` reads "One of the eleven" and carries a dated note recording that
  it read "Two". Prettier re-checked clean.

### F4 — An unguarded `cat` in the then-branch can replace the eval's exit code, while its sibling `tail` is guarded

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/eval.yml:160` (compare `:178`)
- **Detail**: `cat eval-summary.log` sits in an `if` **body**, not a condition, so it is not
  `-e`-exempt. If it failed, the step would abort before `exit $STATUS` and report `cat`'s status
  instead of the eval's. Practically unreachable behind the `[ -f ]` test, and it fails closed
  (never a false green) — but it discards the distinction between "the eval was red" and "the
  summary became unreadable", and the `tail` four lines below is guarded with `|| echo` for
  exactly this reason.
- **Fix**: `cat eval-summary.log || echo "(eval-summary.log became unreadable)"`, matching the
  `tail` line beside it.
- **Decision**: FIXED — applied, with the `-e`-exemption reason stated at the site so the guard
  is not tidied away as redundant.

### F5 — The `concurrency` comment is true for a second dispatch and stops being true at the third

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/eval.yml:45-49`
- **Detail**: The grouping key (`github.workflow` alone, not `-${{ github.ref }}`) is **correct**
  and the reason given for it is sound. The description of what it buys is not quite: GitHub keeps
  at most **one** pending run per concurrency group, so with `cancel-in-progress: false` a third
  dispatch arriving while one runs and one is pending **cancels the pending one** (confirmed
  against the workflow-syntax reference: "any existing `pending` job or workflow in the same
  concurrency group will be canceled and the new queued job or workflow will take its place").
  So "a second dispatch does not vanish, it QUEUES and then runs, so both still pay" holds for two
  and stops holding at three, where the middle one does vanish — silently, and without paying.
  The error is in the cheap direction, but this comment exists specifically because "the obvious
  reading is wrong", so an incomplete model in it is worth one clause.
- **Fix**: Add a clause noting that only one run stays pending, so a third dispatch silently
  cancels the queued one.
- **Decision**: FIXED — clause added, including that the cancellation is silent and costs
  nothing, which is why it would never surface on the bill.

### F6 — §6.6 says "all three planned dispatches" where four job executions exist, dropping the strongest datum

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/test-plan.md:2605`
- **Detail**: The durable §6.6 does-NOT-prove bullet reads "All **three planned** dispatches
  produce both report files". That is literally true — but `verification.md:239-244` and §8 both
  say **four job executions**, and the fourth (the BOM run `30756346671`) is the one worth
  carrying: **every one of its 11 cases threw**, and `afterAll` still ran and still wrote both
  files. That is stronger evidence that the branch is hard to reach than the three planned runs
  give, and §6.6 is the entry that outlives the change folder.
- **Fix**: Change to "all four job executions" and add the BOM run's clause, matching
  `verification.md`.
- **Decision**: FIXED — and the same bullet's neighbouring "It has **four** causes" sentence was
  updated to **five** in the same edit, because F2's fix made it stale. §6.6 now records the
  missed cause, why it is the only one compatible with a zero exit code, and that the shipped
  branch asserted two provably-false things in that state before the fix.

### F7 — Moving `evaluateRun` above the printing widened what a throw inside the hook destroys

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `evals/generation-quality.eval.ts:236-261`
- **Detail**: Pre-edit, `cardLog` and the whole table printed **before** `evaluateRun` ran.
  Post-edit, `resolveModel()`, `resolveJudgeModel()`, `summaryRows()` and `evaluateRun()` all run
  at `:237-253`, before the first `console.log` at `:258`. A throw in any of them now costs the
  card log as well as the table and skips `writeReports`, where previously the record was already
  on stdout. **Latent, not live**: `scoring.ts` is total over `CaseResult[]` (every division is
  guarded by `Math.max(x, 1)`), and the reorder is forced by criterion 1.7's own requirement that
  the summary be composed after `evaluateRun`. The comment at `:250-252` checks the right thing
  ("every line is emitted before the assertion") but does not cover the throw case, which is the
  one the reorder actually changed.
- **Fix**: Move `for (const line of cardLog) console.log(line);` back above the composition — it
  depends on nothing the composition produces — or state the throw-case tradeoff in the comment.
- **Decision**: FIXED — the card-log print moved to the top of the hook, with the reason stated
  at the site (including that it buys against a latent regression, not a live one, so nobody
  "tidies" it back down). Emitted order is unchanged: card log, then the summary section.
  `tsc --noEmit` exit 0 afterwards.

### F8 — The plan's cost/wall-clock qualification bullet is vacuously satisfied

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `.github/workflows/eval.yml` (absent)
- **Detail**: Phase 2's last contract bullet asks that comments "admit uncertainty rather than
  assert it away — in particular that the cost and wall-clock figures are recorded local
  measurements, not guarantees." The workflow carries **no** cost figure and no wall-clock figure;
  the only quantity is the timeout sizing at `:131-132`. The bullet is satisfied because the
  figures are absent, not because they are qualified. Nothing misleading ships — recorded so a
  future reader does not conclude the qualification was written and later removed.
- **Fix**: None required. If a cost figure is ever added to the header, add the qualification with it.
- **Decision**: FIXED — the figures were added rather than the bullet written off, so the plan's
  contract is met substantively: wall clock **2m03s** (run 30756678180) against C10X-31's
  117-312 s local range, spend **~$0.013** (C10X-41, local), each labelled a recorded measurement
  and not a guarantee. The green dispatch's own CI cost is deliberately **not** quoted, because
  it could not be separated from the key's accounting rounding — the header says so and points at
  `verification.md`, which states both hypotheses.

## Not verified in this review

- The 33-line content-neutrality accounting behind the whole-file prettier normalisation of
  `test-plan.md` — only that prettier now passes and is a fixed point.
- The BOM-in-the-secret mechanism (PowerShell's `[Console]::OutputEncoding`), which
  `verification.md` itself labels "likely rather than measured".
- The `judge_model` input on a non-empty value — never dispatched, and `verification.md` says so.
