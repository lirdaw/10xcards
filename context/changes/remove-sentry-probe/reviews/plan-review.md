<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Remove the public /api/shipprobe error probe

- **Plan**: `context/changes/remove-sentry-probe/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-12
- **Verdict**: REVISE
- **Findings**: 1 critical, 3 warnings, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | FAIL    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

9/9 existing paths ✓ (`src/lib/sentry-sampling.ts` and `tests/lib/sentry-sampling.test.ts` correctly
absent — they are this plan's deliverables). 6/6 symbols ✓ (`DEPENDENCY_NOISE`,
`DEPENDENCY_EVENT_SAMPLE_RATE`, `beforeSend`, `MIN_CHECKED_FILES`, roadmap H-14/H-15, test-plan §7
exclusion), but four line anchors are stale — see F5. brief↔plan ✓.

Verified by execution rather than by reading:

- `shipprobe` has zero importers anywhere under `src/`, `tests/`, `scripts/`, `.github/`,
  `wrangler.jsonc` — the only hit is its own docblock.
- The tightest tree-walking floor is real and has slack: `error-param-guard.test.ts`'s unregistered
  set measures **71** against `>= 69`; Phase 1 takes it to 70 and Phase 2's new module returns it to 71.
- No `404.astro`, no catch-all route, no `public/` fallback for the path.
- **No test in this repo loads or textually guards `src/worker.ts`** — the only Sentry mentions under
  `tests/` are the e2e preflight blanking the DSN. This is F1's premise.
- `npx prettier --check` on the archived runbook prints `All matched files use Prettier code style!`
  and exits 0 — it does **not** report the file as ignored. This is F2's premise.
- `context/foundation/jira-map.md` carries a live `shipprobe` claim. This is F3's premise.

## What held up

Not re-litigated below, and worth recording so a later reader does not re-derive it:

- The Progress↔Phase contract is well-formed: 4 phases, every Success Criteria bullet mirrored, no
  stray `- [ ]` in phase bodies, exactly one `## Progress` heading at the bottom.
- The deletion's blast radius is genuinely nil, measured rather than argued.
- The deliberate-breakage design in criterion 2.8 is sound. Tracing the pre-`d381c07` neuter
  (`if (event.logger !== "console") return event; return Math.random() < RATE ? event : null;`)
  through all nine proposed cases: the two first-party cases go red, and every dependency case,
  the non-`console` case and the rate-boundary case stay green — exactly the split the plan predicts.
- Every doc-sync target exists where the plan says it does (roadmap H-14 detail block + H-15 block,
  `test-plan.md` §7's "Log lines emitted by dependencies" exclusion, the archived runbook).

## Findings

### F1 — The extraction's test cannot see the wiring it depends on

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §3 (the discriminator's test) + Desired End State
- **Detail**: The stated end state is "a test that fails if a first-party error ever becomes sampled
  again". The proposed test drives `sampleSentryEvent` directly, so it fails if the _helper's logic_
  changes and stays fully green if `src/worker.ts` stops calling it, drops `beforeSend`, or reverts
  to an inline copy. Every success criterion in Phase 2 passes while the goal is unmet. The gap is
  unusually sharp here: no test in this repo loads or scans `src/worker.ts` (verified); the probe
  being deleted was, by the plan's own Current State, the only end-to-end instrument for this
  property; and this repo has already paid for this exact split twice and closed it both times with
  a textual wiring guard — `error-param-guard.test.ts` (C10X-34 F2: "deleting the
  `ownedAuthMessage(...)` call leaves the suite green") and `no-client-redirect-errors.test.ts`
  (C10X-40). The plan copies the extraction half of that precedent and not the guard half. Criterion
  2.9 (`git diff src/worker.ts` shows X unchanged) is a one-time manual read, not a standing guard.
- **Fix A ⭐ Recommended**: Add a textual wiring guard over `src/worker.ts`
  - Strength: Same species as the three guards already in `tests/lib/` — a per-line pattern asserting
    `beforeSend` delegates to the imported `sampleSentryEvent`, with a positive control that the
    detector fires on an inline re-implementation. ~3 cases, no Worker, no DSN, no network. Makes the
    End State claim literally true.
  - Tradeoff: One more file, and a reformat splitting the delegation across lines trips it — the
    accepted trade the sibling guards already document at their own sites.
  - Confidence: HIGH — the pattern exists three times in this repo and the target is a one-line call.
  - Blind spot: A guard proves the call is present, never that Sentry actually invokes `beforeSend`;
    state that boundary at the site, as `error-param-guard.test.ts` does.
- **Fix B**: Narrow the End State claim instead of adding a guard
  - Strength: Zero new code; honest about what the test buys.
  - Tradeoff: Leaves the property genuinely unguarded end-to-end at the same moment the only prod
    instrument is deleted — a net reduction in what is provable, which the plan presents as a pure
    win.
  - Confidence: MEDIUM — defensible, but it makes Phase 2's stated "whole compensating value of
    deleting the probe" weaker than the sentence claims.
  - Blind spot: Nothing then detects an unwiring until someone reads a Sentry dashboard that this
    project has no notification channel for.
- **Decision**: FIXED via Fix A — Phase 2 gained §4 (the wiring guard), criterion 2.5, breakage run 2.10, a Testing Strategy entry, and the brief's scope line.

### F2 — Criterion 3.2 passes vacuously and misstates prettier's behaviour

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Automated Verification / Progress 3.2
- **Detail**: The criterion says `npx prettier --check <archived runbook>` "reports it as ignored".
  Measured on this repo: it prints `Checking formatting... / All matched files use Prettier code
style!` and exits 0. Prettier never reports "ignored" — an ignored file and a genuinely clean file
  are indistinguishable, so the criterion is satisfied whether or not `.prettierignore` is doing
  anything. This is verbatim the trap `test-plan.md` §6.6's C10X-43 entry already records ("A
  criterion phrased as 'no files matched' can be true vacuously"), and that entry names the remedy:
  meet it as a pair.
- **Fix**: Replace with a falsifiable pair, run AFTER the correction blocks are appended:
  `npx prettier --list-different <file>` prints nothing (ignored), while
  `npx prettier --ignore-path /dev/null --list-different <file>` prints the file — proving the ignore,
  not cleanliness, is what silenced the first. (`--check` and `--list-different` cannot be combined;
  measured.)
- **Decision**: FIXED — 3.2 replaced with the falsifiable `--list-different` / `--ignore-path /dev/null` pair, with the C10X-43 trap named inline.

### F3 — Criterion 3.4 contradicts "What We're NOT Doing"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3.4 vs. What We're NOT Doing
- **Detail**: 3.4 demands that a repo-wide search for `shipprobe` outside `context/archive/` and
  `dist/` return "only this change's own folder and the resolved roadmap entries". Measured, the live
  tree also hits `context/foundation/jira-map.md` — which the plan's Current State counts (×1) and
  which "What We're NOT Doing" forbids editing (owned by the jira-\* skills, gitignored). As worded
  the criterion cannot pass, and the implementer's two options are both wrong: edit a forbidden file,
  or silently reinterpret an automated criterion.
- **Fix**: Add `context/foundation/jira-map.md` to the criterion's exclusion list in both the Success
  Criteria and Progress 3.4, with the reason inline ("owned by the jira-\* skills; the ticket's own
  record is updated by `/jira-finish-work`").
- **Decision**: FIXED — `context/foundation/jira-map.md` added to 3.4's exclusion list in both the Success Criteria and Progress, with the reason inline.

### F4 — Phase 4 has no pre-merge confirmation and no stated contingency

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §2 + Migration Notes
- **Detail**: The whole oracle rests on the post-deploy response being exactly `404`, and nothing
  exercises that shape before the irreversible merge. The "after" behaviour is not Astro's alone:
  `wrangler.jsonc` declares `assets.not_found_handling: "404-page"` over `./dist`, and there is no
  `404.astro` and no catch-all — so the response for an unmatched `/api/*` path comes from a path no
  one in this project has ever exercised. The plan reasons it ("falls through to Astro's default
  404") but never observes it. Separately, the plan says a reading that is neither `500` nor `404`
  means "the pair is void" and then stops — Phase 4 has no rollback sentence at all, even though the
  remedy is trivially available (this is a pure deletion; revert the PR and redeploy).
- **Fix A ⭐ Recommended**: Observe the 404 locally in Phase 1, and name the revert in Phase 4
  - Strength: Turns the strongest assumption in the plan into a measurement for the cost of one
    command — after the `git rm`, start the dev server and request the path, expecting `404`. Keeps
    the prod pair as the real oracle (the stale-`dist/` argument is untouched); this only removes the
    "we have never seen a 404 from this app" unknown before the merge.
  - Tradeoff: One extra local step, and a local `404` does not prove the deployed Worker's — so it
    must be recorded as a pre-check, never as half of the pair.
  - Confidence: HIGH — the check is one request and the revert path is unambiguous for a
    deletion-only change.
  - Blind spot: `npm run dev` does not execute `src/worker.ts` (roadmap H-14's correction), so this
    observes routing only, never the Sentry path — which is all this criterion needs.
- **Fix B**: Keep the prod-only oracle, add the contingency sentence only
  - Strength: Smallest edit; the plan's reasoning about Astro's default 404 is probably right.
  - Tradeoff: The first time anyone sees the "after" shape is after an irreversible merge, on the one
    reading that cannot be retaken.
  - Confidence: MEDIUM — likely correct, unverified.
  - Blind spot: `not_found_handling` interaction with the assets router remains unobserved either
    way.
- **Decision**: FIXED via Fix A — Phase 1 gained §3 (local 404 pre-check) and criterion 1.7; Phase 4 gained an explicit revert contingency.

### F5 — Every src/worker.ts line anchor is ~10 lines stale

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis / Key Discoveries / Phase 2 §1
- **Detail**: Measured against HEAD: `beforeSend` is `:96-104`, not `:81-91`; `DEPENDENCY_NOISE` is
  `:53`, not `:63`; `DEPENDENCY_EVENT_SAMPLE_RATE` is `:60`, not `:70`; the comment block is ~`:29-60`,
  not `:39-70`. The file is 107 lines. The drift comes from `440bd14`, which landed after the plan was
  written. Symbol names are all correct, so it is navigable rather than wrong — but the plan cites
  `lessons.md:236` ("name doc-sync targets by section and claim, never by line number") three lines
  above using line numbers for its own primary code target. Same class: "~133 checked files" is stale
  (test-plan records 145 as of C10X-46), though nothing depends on it since the gate asserts a floor.
- **Fix**: Cite the worker.ts anchors by symbol (`beforeSend`, `DEPENDENCY_NOISE`,
  `DEPENDENCY_EVENT_SAMPLE_RATE`) and drop the file-count figure, keeping only "far above the floor
  of 50".
- **Decision**: FIXED — every `src/worker.ts` anchor re-cited by symbol; the stale file-count figure dropped from plan and brief.

### F6 — The prod hostname is more recoverable than the plan states

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries + plan-brief Prerequisites
- **Detail**: "The prod hostname is not recorded anywhere in this repo" gates Phase 1, which gates
  everything. It is half-true: `wrangler.jsonc` records `"name": "10xcards"` and
  `"workers_dev": true`, so the host is `10xcards.<account-subdomain>.workers.dev` — only the account
  subdomain is genuinely unrecorded. Stated as-is, an implementer may treat a blocking prerequisite as
  harder than it is.
- **Fix**: Reword to "only the account subdomain is unrecorded; the worker name and `workers_dev` host
  shape come from `wrangler.jsonc`", keeping the deploy-job / dashboard route as the confirmation.
- **Decision**: FIXED — reworded in both plan and brief: only the account subdomain is unrecorded, confirmation from the deploy job still required.
