<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Run the generation-quality eval from CI on demand

- **Plan**: `context/changes/eval-ci-dispatch/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-02
- **Verdict**: REVISE → **SOUND** after triage (all 8 findings fixed in `plan.md`, 2026-08-02)
- **Findings**: 1 critical, 4 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

14/14 paths ✓ (`.github/workflows/eval.yml` correctly absent), 9/9 symbols ✓ —
`resolveModel`/`resolveJudgeModel`/`SUMMARY_HEADER`/`summaryRows`/`evaluateRun`, both
`eval-preflight.ts` seams, the pre-registered `judge.ts:204-207` comment, `.gitignore:20`
= `*.log`, and the action pins (`checkout@v7`, `setup-node@v6`, `upload-artifact@v7`)
matching `ci.yml`/`schema-diff.yml`. brief↔plan ✓. Progress↔Phase mechanical contract ✓
(one `## Progress` at the bottom, 4/4 phase headings match, every Success Criteria bullet
has a numbered Progress item; Phases 2 and 4 split one bullet into two items each, which
is a superset and parses fine).

Two of the plan's load-bearing Astro claims were verified independently rather than taken
on trust, and both hold: `node_modules/astro/templates/env.mjs` does map `'' → undefined`
inside `_internalGetSecret`, and `node_modules/astro/dist/env/env-loader.js:40` is
`loadEnv(mode, config.vite.envDir ?? …, "")` — empty prefix, so the whole `process.env` is
overlaid. Also confirmed: `lint-staged`'s globs do not cover `*.yml`, so Phase 2's
by-hand prettier check is genuinely necessary.

## Findings

### F1 — An empty `judge_model` input kills every default dispatch

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1 ("two optional string `inputs:` … both defaulting to the empty string, which resolves to the shipped defaults"); Key Discoveries, the `astro.config.mjs` bullet
- **Detail**: The plan proves the empty-input-degrades-to-default property for one of the two inputs and generalises it to both. It holds only for `generator_model`: `OPENROUTER_MODEL` travels `astro:env/server`, and `astro/templates/env.mjs` coerces `'' → undefined` before `resolveModel()`'s `??` (verified — the plan is right about this half).

  `judge_model` does not travel that seam. `judge.ts:32` is `process.env.EVAL_JUDGE_MODEL ?? JUDGE_MODEL_DEFAULT` — raw `process.env`, no coercion, and `??` does not fall through on `""`. GitHub Actions sets an env key whose expression resolves empty to the empty **string**, not unset. So on the documented default dispatch (no inputs): `resolveJudgeModel()` → `""` → `body.model: ""` → OpenRouter `400` → `judge.ts:128` treats `400` as neither `429` nor `≥500` → immediate throw on the first card of the first case. All 11 cases throw before their `results.push`, `afterAll` prints 0 rows plus 11 `MISSING` lines, and the run-level assertion is red too.

  Phase 4's criterion 4.2 (green dispatch, eval job `success`) cannot pass, and the failure presents as an infrastructure outage rather than a wiring bug.

  `research.md:150` already recorded the asymmetry — `EVAL_JUDGE_MODEL` is marked "`process.env` **only** (not in the Astro schema)" — so this is a discovery the plan dropped, not one it lacked.
- **Fix A ⭐ Recommended**: Set the env var only when the input is non-empty (export inside the run script, guarded)
  - Strength: Keeps `judge.ts` semantics untouched (Phase 1 §3 promises "no behaviour change" there), and the judge reads `process.env` at **runtime**, so unlike `OPENROUTER_MODEL` it does not have to sit on the step's `env:` — a guarded export inside the run script is sufficient and correct.
  - Tradeoff: Two mechanisms in one step (declarative `env:` for the generator, imperative export for the judge) — needs a comment saying why they differ, or the next reader "tidies" it into a bug.
  - Confidence: HIGH — the seam difference is verified in both source files.
  - Blind spot: None significant.
- **Fix B**: Make `resolveJudgeModel()` treat an empty string as unset (`??` → `||`)
  - Strength: One-token change; closes the class for every caller, including a developer who exports `EVAL_JUDGE_MODEL=` locally.
  - Tradeoff: Widens Phase 1 §3's scope from "comment only, no behaviour change" to a behaviour change in `judge.ts`, which then needs its own doc note.
  - Confidence: HIGH — same evidence.
  - Blind spot: Whether any document asserts the current `??` semantics; not surveyed.
- **Decision**: FIXED — Fix A **and** Fix B both applied (guarded export in the workflow + `??` → `||` in `resolveJudgeModel()`); Phase 1 gained a §4, Phase 2 gained an asymmetry bullet, Progress 1.11 / 2.10 added

### F2 — The missing-report branch names one cause for a multi-cause absence, and nothing exercises it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details ("A preflight abort produces no table"); Phase 2 §1, the eval step's script; Phase 4 §3
- **Detail**: The step prints "a message naming a preflight abort as the likely cause" when `eval-summary.log` is absent. At least four states produce that absence: a preflight abort, a collection-time error (the plan-brief itself names this as live — `evals/` is under no type gate, C10X-43), a step-timeout kill, and any crash before `afterAll`. With every stream redirected to a file, the job log's only diagnostic in those states is a sentence asserting the one cause that may not be the actual one — the reassurance-shaped inference this repo has already had to measure and retract (C10X-39).

  And no phase exercises the branch. Phase 4's controlled red uses a bogus `generator_model`, which throws **inside** a test, so `afterAll` still runs and both report files exist (correctly predicted by criterion 4.4's "three files for both runs"). The branch written to prevent a bare `cat: No such file` ships unexecuted.

  > **Dated correction, 2026-08-03 (C10X-43).** The parenthetical "`evals/` is under no type gate,
  > C10X-43" is no longer true — it is, in the `ci` job and on `pre-push`. The finding is not
  > rewritten, and nothing in its substance moves: **a type gate does not see a collection-time
  > error**, so that cause stays live and the branch this finding produced still has to enumerate
  > it. `eval.yml`'s own message was corrected in place for exactly that reason — the parenthetical
  > changed, cause #2 did not.
- **Fix**: When `eval-summary.log` is absent, tail `eval-console.log` (last ~40 lines) into the job log instead of guessing, and list the absence's causes rather than one — a preflight abort is recognisable from its own `Eval preflight failed:` string, which the tail will carry. Then either exercise the branch in Phase 4 or state it in the write-up as an unexercised branch.
  - Strength: The tail is self-diagnosing for all four causes and costs one line.
  - Tradeoff: A tail can print card text if the failure lands mid-run; bounding it to the last N lines weakens (does not break) the "no card text in the log" property.
  - Confidence: HIGH — the four states are enumerable from the code read.
  - Blind spot: Whether Vitest writes the preflight throw to stdout or stderr under the `default` reporter — not measured here.
- **Decision**: FIXED — the step now tails the last ~40 lines of `eval-console.log` and enumerates the four causes; Phase 4 §5 must record the branch as unexercised

### F3 — Criterion 1.1 is falsified by Phase 1's own refactor

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Success Criteria / Progress 1.1
- **Detail**: "the 6 pre-existing `no-console` warnings in `evals/` are unchanged in count and location". Enumerated: all six are `console.log` sites in `evals/generation-quality.eval.ts` at `:191, :192, :193, :194, :201, :206` — every one inside the exact hook Phase 1 restructures. Composing two arrays and printing them makes the natural implementation two `console.log` sites, not six, and none at the old lines. A correct implementation turns this criterion red, and an implementer trying to satisfy it literally would contort the code to preserve six call sites.
- **Fix**: Reword to "`npm run lint` exits 0 and no `no-console` warning appears outside `evals/generation-quality.eval.ts`", and record the new count as observed rather than predicting it.
- **Decision**: FIXED — criterion 1.1 rewritten to a location claim; the new warning count is recorded as observed and named as a Phase 3 doc target

### F4 — Criterion 3.3's grep hits historical records the house style forbids rewriting, and the target list omits one

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3 Contract; Progress 3.3
- **Detail**: Two problems, one root. The criterion demands the **strings** disappear, while this project's repeatedly-stated rule is that a historical entry takes a dated correction, never a rewrite (test-plan §8, C10X-30's "4xx" precedent) — with one documented exception, C10X-39, where paraphrase was chosen *because* a standing grep would otherwise never pass. That is precisely the situation here, and the plan does not pick a side, so the implementer guesses.

  Ran the grep against the current file: it hits `test-plan.md:248` — inside the file's own rolling **header** block, a "Previously: … (C10X-31)" summary reading "the CI/workflow leg is deliberately deferred (local-only, human-triggered; §5)" — and `:529`/`:535`, both narrative sentences about what C10X-31/C10X-41 did. Line 248 appears in neither the plan's Phase 3 enumeration nor `research.md`'s doc-sync table, and it is the first thing a reader of that file meets. It also hits `:1735` ("local-only values" about `config.toml`), an unrelated false positive.

  Separately, §2's Risk #7 row (`:401`, "a local, human-triggered … eval") is **not** matched by any of the four grep patterns, so the criterion does not protect the target the plan cares most about.
- **Fix A ⭐ Recommended**: State the rewrite-vs-correction rule per target class, add `:248` to the enumeration, and scope the grep to the live claims
  - Strength: Matches the file's own precedent set (live claim → edit; historical entry → dated correction block), and removes the guess from the implementer.
  - Tradeoff: A correction block on `:248` keeps the stale string on disk, so criterion 3.3 must be narrowed to a line allowlist or it becomes permanently unsatisfiable.
  - Confidence: HIGH — all four line locations verified by running the grep.
  - Blind spot: Whether `:529`/`:535` read as live or historical is a judgment call this review did not settle for the implementer.
- **Fix B**: Follow C10X-39's precedent and paraphrase every hit, live or historical
  - Strength: Keeps criterion 3.3 exactly as written and falsifiable.
  - Tradeoff: Rewrites two historical entries, which is the thing this file says four separate times not to do.
  - Confidence: MEDIUM — the precedent exists but its stated reason (a standing regression grep) would have to be adopted here too.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — live-vs-historical target classes stated, `test-plan.md:248` added to the enumeration, criterion 3.3 rescoped to a classified pre-edit hit list

### F5 — Criterion 3.4 can pass while the property it names is destroyed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 Success Criteria / Progress 3.4
- **Detail**: `grep -c "human-triggered" test-plan.md` is **13** today. The criterion says the count must be unchanged. Both directions are broken. False red: Phase 3 also adds a §6.6 entry and a §8 ledger entry in the established shape, and the plan's own Contract says the new §6.6 entry must state the eval is still human-triggered — writing that raises the count, so a correct edit fails the criterion. False green: deleting one occurrence while a new entry adds one leaves the count at 13 with the surviving trigger claim destroyed. A count is not an oracle for a per-site property — the same "a total and its breakdown are two claims" defect §8 records against C10X-40.
- **Fix**: Replace with a per-site check — grep with line numbers before the edit and assert each pre-existing occurrence survives at its (possibly shifted) site, pinning the surrounding sentence rather than the count.
- **Decision**: FIXED — criterion 3.4 replaced by a per-site check against a pre-edit `grep -n` list

### F6 — The `concurrency` rationale is wrong: it serializes, it does not deduplicate

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §1, the `concurrency:` bullet
- **Detail**: "two dispatches on different branches would land in different groups and both run, which is exactly the double spend." With `cancel-in-progress: false`, a second dispatch in the same group does not vanish — it queues and then runs. Both dispatches pay. The mechanism prevents **concurrent** spend, never double spend. The choice (group on `github.workflow` alone) is still right, and a better justification is already in the plan's own text: a separate key buys spend isolation but **not** rate-limit isolation, so serialising two runs against one OpenRouter account is worth having. Shipping the stated reason as a workflow comment repeats the "a stated rationale was measured and found FALSE" class C10X-37's impl-review recorded.
- **Fix**: Keep the grouping; restate the reason as rate-limit serialisation, and say plainly that a queued second dispatch still runs and still pays.
- **Decision**: FIXED — grouping kept, rationale restated as rate-limit serialisation with "a queued second dispatch still runs and still pays" said plainly

### F7 — "Thirteen documentation claims" does not reconcile with its own enumeration

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Overview; Phase 3 §3 ("Eight existing locations")
- **Detail**: Phase 3 §3 says "Eight existing locations" and then lists nine: §2 Risk #7; §3 Phase 5 note; §4 Stack row; §5 gate row; §5 deferral paragraph; §6.6 C10X-31 bullet; §6.6 C10X-41 bullet; §8 C10X-31 entry; §8 C10X-41 entry. "Thirteen" appears to have been carried over from `research.md`'s doc-sync **table** (12 rows, two of which cover two locations each) and re-labelled as claims. Counting actual editable sites: 9 existing + 2 new in test-plan, 2 in README (inventory prose + secrets row), roadmap, jira-map = 15, plus `:248` from F4 = 16. Low stakes alone; it matters because the number is quoted in the Overview, the brief, and will be quoted again in the §8 ledger entry.
- **Fix**: Recount by enumeration and let the number follow the list; state it once, in Phase 3, and have the Overview point at it.
- **Decision**: FIXED — Phase 3 §3 now enumerates eleven existing locations by class and the count follows the list; the Overview points at Phase 3 instead of asserting a number

### F8 — Criterion 1.7 cannot be checked as worded

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Success Criteria / Progress 1.7
- **Detail**: "The terminal output is unchanged in content and order from before the edit." Two runs cannot be diffed: `vitest.eval.config.ts` sets `sequence: { shuffle: true }` with an un-pinned seed, so `cardLog` and the summary rows come back in a different order every run, and the cards themselves come from a temperature-0.4 model. The property the plan means — the hook still emits the same five groups in the same relative order — is real and checkable, but only by reading the composed arrays, not by comparing outputs, and the criterion as written costs a paid run to fail to settle.
- **Fix**: Reword to a structural claim (card log → generator/judge line → header → rows → `MISSING` → `failures:`, in that order, with the summary section composed **after** `evaluateRun` so the `failures:` block is included), verified by read-through against the pre-edit hook.
- **Decision**: FIXED — criterion 1.7 restated as a structural read-through against the pre-edit hook, with the shuffle/temperature reason given
