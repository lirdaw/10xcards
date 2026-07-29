# AI-Native Generation Quality Eval (Risk #7) — Plan Brief

> Full plan: `context/changes/ai-candidate-generation-test-3/plan.md`
> Research: `context/changes/ai-candidate-generation-test-3/research.md`

## What & Why

The project's first LLM-as-judge eval, closing test-plan §3 Phase 5 (Risk #7: generation
returns wrong-language or unusable cards, so the 75% acceptance thesis fails). Every earlier
test phase declared the prompt, the model and the real response format invisible to itself;
this slice is the layer that finally observes them — against the real provider, with a judge
from a different model family.

## Starting Point

`npm test` is sealed against the real provider by design (preflight hard-fails on a set
`OPENROUTER_API_KEY`; mock mode returns fixed Polish strings). Nothing has ever tested either
prompt path (`auto` vs forced language), real-model count compliance, skip-rate, or the
success-path audit columns. No calibration corpus exists (prod ~38 rows, local DB empty) —
the reference set must be authored.

## Desired End State

`npm run eval` (with the key in the shell env) drives a 10-case language matrix through the
production `generateCandidates()`, grades every card with a pinned judge
(`google/gemini-2.5-flash`), prints a verdict table (fidelity, usability, count compliance,
skip-rate) and goes red on threshold/floor breaches. `npm test` is provably untouched and
gains two deterministic tests (scoring functions, success-path audit columns). Docs state
the coverage and its boundary.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Runner location | Second Vitest config (`vitest.eval.config.ts`), lib-level `generateCandidates()` | Only `getViteConfig()` resolves the production prompt path; `scripts/` can't import `src/` — a rebuilt request would drift into false passes | Research |
| Trigger | **Local only** — shell-env invocation; GH workflow deferred to a follow-up ticket | User decision: no OpenRouter secret in the public repo this slice (capped-key mitigation recorded for the follow-up) | Plan |
| Judge model | Different family than the generator, pinned, env-overridable | Avoids self-grading bias at zero infrastructure cost (same OpenRouter key) | Plan |
| Language matrix | Full 6 selector values: `auto`×{PL,EN,ES,DE,FR} + forced 5 over a fixed PL source (10 cases) | Covers both prompt paths and the whole shipped selector, no named gaps | Plan |
| Deterministic metrics | Count compliance + skip-rate **reported, not gated**; floors: ≥1 card/case, skip-rate <50% | First measurement can't be a blindly-tuned gate, but floors keep the eval falsifiable | Plan |
| Thresholds | Language 100% per case (hard); usability ≥80% aggregate per run | Wrong language is a binary NFR failure; the aggregate tolerates temperature-0.4 noise | Plan |
| Extra scope | Success-path audit-columns test under mock in `npm test` | Closes the C10X-28-named gap cheaply and deterministically | Plan |
| Judge ≠ product metric | The eval never claims to measure the 75% acceptance rate | Only real users produce that number — stated in plan and doc-sync | Research |

## Scope

**In scope:** eval config + inverse preflight (fails when key ABSENT — mock would pass PL
fidelity vacuously), authored 5-language reference set, judge client, pure scoring with unit
tests, 10-case matrix + first recorded calibration run, audit-columns mock test, doc-sync
(test-plan §2/§3/§5/§6.6/§8, roadmap H-06 row).

**Out of scope:** GH workflow + repo secret (deferred, named follow-up), any `src/` change
(no prompt tuning, no re-call lever), endpoint-level eval, schedule/notifications, judge
benchmark artifact, repeat-sampling.

## Architecture / Approach

The repo's two-piece "check that cannot be a gate" idiom with the runner swapped to a second
Vitest config: `evals/**/*.eval.ts` collected only by `vitest.eval.config.ts` (exclusion by
collection — `npm test`'s include glob never sees it; the existing clamp stays
byte-identical). Support code in `evals/lib/` (judge over plain fetch + `process.env`; pure
scoring unit-tested from `tests/lib/` via the schema-drift precedent). One sequential eval
file; red only from judge thresholds, floors, or infrastructure throws.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Eval harness | Second config, inverse preflight, proof `npm test` collects nothing | `astro:env` inlining trap (key must be in env at config load) |
| 2. Reference set + judge + scoring | 5 authored texts, judge client, unit-tested pure scoring | Bad fixture or vague rubric → unattributable verdicts later |
| 3. Matrix + calibration run | 10 cases, thresholds/floors, first recorded real run + 2 breakage checks | Provider may reject structured outputs for the judge (fallback documented); threshold calibration |
| 4. Audit-columns mock test | First-ever assertion of the success-path audit write | Low — fully deterministic |
| 5. Doc-sync | §3 Phase 5 → complete with boundary; §5 gate row corrected to local-only; roadmap H-06 | Docs drifting from the local-only decision |

**Prerequisites:** a real OpenRouter key on the dev machine (shell env); local stack for
`npm test` phases.
**Estimated effort:** ~2–3 sessions across 5 phases; eval run cost in cents.

## Open Risks & Assumptions

- `google/gemini-2.5-flash` via OpenRouter accepts `response_format: json_schema` — verified
  at first live call; documented fallback to prompt-enforced JSON if not.
- Thresholds (100% / ≥80%) are pre-calibration guesses; the first recorded run may adjust
  them, with the change documented in verification.md.
- One run per case — a red is re-run once by hand before being believed (recorded rule).
- Judge verdicts are themselves an LLM's opinion; the one-time human spot-check is the only
  calibration.

## Success Criteria (Summary)

- A human can run one command and get a red/green answer to "does generation return
  usable cards in the right language?" across all six shipped language values.
- `npm test` provably never touches the real provider and gains the audit-columns assertion.
- test-plan Risk #7 reads Covered — with the judge-vs-75% boundary and the deferred workflow
  leg named in the same breath.
