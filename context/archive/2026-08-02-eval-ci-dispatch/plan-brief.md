# Run the generation-quality eval from CI on demand — Plan Brief

> Full plan: `context/changes/eval-ci-dispatch/plan.md`
> Research: `context/changes/eval-ci-dispatch/research.md`

## What & Why

The LLM-as-judge generation-quality eval is the project's only check that reaches the real AI
provider, and it runs only on a developer's machine when someone remembers to run it. This change
adds a `workflow_dispatch`-only GitHub Actions workflow that runs `npm run eval` on demand, with a
separate low-credit OpenRouter key as the blast-radius cap and the full card-by-card record attached
as an artifact. It closes a deferral C10X-31 made explicitly and an instruction C10X-31's
impl-review planted in `evals/lib/judge.ts` for whoever built this workflow.

The contract is deliberately not "keep it green": `npm run eval` exits 1 on a **real generation
defect** by design, so this workflow must never become a deploy-blocking gate.

## Starting Point

`npm run eval` works and is invoked by hand. Research proved the CI shape is smaller than expected —
five steps, no `astro sync`, no Supabase, no Docker — because one step-level env var feeds both key
seams (Astro's env loader uses an empty prefix and overlays the whole `process.env`). It also found
the brief's load-bearing premise half wrong in the reassuring direction: the claim in
`generation-quality.eval.ts:128-130` that Vitest 4 swallows passing tests' console output holds only
under the `agent` reporter, so a GitHub runner would print ~180 lines of card text on **every** run,
green ones included.

## Desired End State

A human with write access dispatches **Generation quality eval**, optionally overriding either
model, and reads the 11-row verdict table in the job log a few minutes later. The full record —
cards, judge verdicts, rationales, plus the raw console stream with Vitest's assertion diffs — is a
single artifact named for the run attempt, so a calibration re-run keeps both attempts side by side.
A red run fails honestly and uploads its artifact anyway. Nothing in the repository can make this
workflow block a release.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Output capture | Eval writes its own report **and** the workflow redirects the console | Two sinks let the log keep the verdict while the body goes to the artifact, without the YAML grepping a string owned by `scoring.ts` | Plan |
| Report sink | Always written, `*.log` extension | One code path for local and CI — no CI-only branch that is untestable until the first dispatch — and `.gitignore:20` already covers the name | Plan |
| Artifact condition | `if: always()`, name carries `github.run_attempt`, 30-day retention | The precedent's `if: failure()` justification ("a green run's file is zero bytes") does not hold when the green table *is* the deliverable; v4 immutability would otherwise fail the calibration re-run | Plan |
| Spend gate | Plain repository secret `OPENROUTER_EVAL_KEY`, exported as `OPENROUTER_API_KEY` | The real cap is OpenRouter's verified per-key credit limit, not workflow ceremony; a GitHub Environment with required reviewers would be a first-in-repo config with the author as their own reviewer | Plan |
| Inputs | `judge_model` + `generator_model`, both optional | The judge lever is the documented cross-examination mechanism; the generator lever additionally makes a controlled red dispatch possible with no commit | Plan |
| Ship-time evidence | Green dispatch + controlled red + one re-run | Both directions plus the immutability question, at ~$0.02 total, because the red run fails at the first call | Plan |
| No `schedule:` | Manual trigger only | No notification channel and no owner — a nightly red nobody reads is an alarm without a listener; same reasoning that parked C10X-35 | Charter |
| Disclosure rationale | Not inherited from `schema-diff` | Reference texts and model names are already committed verbatim; the key is unreachable from any error path; masking covers logs but **not** artifacts | Research |

## Scope

**In scope:** the new workflow; the eval writing two report files; correcting the false
console-swallowing comment and closing the pre-registered `judge.ts` instruction; provisioning the
low-credit key; syncing thirteen doc claims (README, test-plan §2/§3/§4/§5/§6.6/§8, roadmap H-10,
jira-map); ship-time dispatch evidence.

**Out of scope:** any `schedule:`/cron; any `needs:` or required-check wiring; `tsc --noEmit`
(C10X-43 owns it); GitHub Environments; widening `npm test`; an `.env.example` row; changes to the
eval's thresholds, matrix or prompts; fixing any generation defect a dispatch finds; alerting or a
budget pre-check step.

## Architecture / Approach

`workflow_dispatch` → checkout → setup-node → fail-closed credential guard → `npm ci` → the eval
step (secrets and both model inputs on **that step's** `env:`, redirect to a console file, exit
status captured explicitly, summary echoed into the job log) → `upload-artifact` with `if: always()`.
The eval itself writes `eval-report.log` (full record) and `eval-summary.log` (table only) from the
existing `afterAll`, which already prints before it asserts; the write reports its own failure and
continues, so an unwritable filesystem can never mask a real verdict.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Report sink in `evals/` | Two report files written on every run; two misleading comments corrected | A write placed before the run-level assertion could mask a real generation defect |
| 2. The workflow file | `.github/workflows/eval.yml`, dispatch-only, non-gating | Three measured traps — a pipe without `pipefail` makes a red eval read as green; `if: failure()`; a job-level timeout |
| 3. Credential + doc sync | Low-credit key stored; thirteen doc claims updated | Editing the "human-triggered" claim instead of the "local only" claim — the former stays true and appears in five targets |
| 4. Ship-time evidence | Green, red, and re-run dispatches recorded | Nothing is dispatchable until the file is on `main`; the controlled red proves the *infrastructure* class, not a real defect |

**Prerequisites:** an OpenRouter account able to mint a second key with a credit limit; write access
to the repository for `gh secret set` and dispatches; the merge to `main` before any of Phase 4.
**Estimated effort:** ~2 sessions — Phases 1-3 in one, Phase 4 after the merge — plus ~$0.02 of
provider spend.

## Open Risks & Assumptions

- The controlled red exercises the infrastructure failure class, not a real generation defect; the
  two are indistinguishable by exit code and separable only from the output. Stated, not hidden.
- A separate key buys **spend isolation only, not rate-limit isolation** — OpenRouter governs
  capacity globally per account.
- `evals/` is under no type gate (C10X-43 open), so a type error there still surfaces only at run
  time, after paid calls. In scope to name, not to fix.
- Artifacts on a public repository are downloadable by any signed-in user and are **not** covered by
  secret masking. The move narrows exposure; it does not remove it.
- Preflight proves a key *string* exists, never that it *works* — a truthy but invalid key passes
  and dies at the provider. Only Phase 4's green run settles that the stored secret is the working
  credential.

## Success Criteria (Summary)

- A human can dispatch the eval from the Actions tab and read the 11-row verdict without downloading
  anything, with the full record one click away.
- A red run fails visibly, uploads its artifact anyway, and cannot stop a release — proven by
  execution in both directions, not by reading the YAML.
- Every document that said "the eval has no CI leg" now says where it runs, while every sentence
  that said "human-triggered" survives untouched, because that part is still true.
