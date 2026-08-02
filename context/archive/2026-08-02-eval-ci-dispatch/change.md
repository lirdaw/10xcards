---
change_id: eval-ci-dispatch
title: Run the generation-quality eval from CI on demand
status: archived
created: 2026-08-02
updated: 2026-08-02
archived_at: 2026-08-02T19:29:27Z
---

## Notes

Work branch: `C10X-42-eval-ci-dispatch` (Phase 1's commit `73d8749` was authored on `main` by
mistake and moved onto the branch immediately, before any push — `main` is back at `origin/main`).

Two criteria were adapted during implementation, both recorded here so Phase 3's write-up does not
have to rediscover them. **Phase 1 §4** asks for `??` → `||` in `resolveJudgeModel`, which ESLint
refuses (`@typescript-eslint/prefer-nullish-coalescing`, an _error_); the rule is disabled on that
one line with the reason stated at the site, because its message ("`??` is safer") is exactly
backwards there. **Phase 2 criteria 2.4 and 2.11 are mutually unsatisfiable as literally worded** —
2.4 wants `grep -c "needs:\|schedule:\|workflow_run:"` to return 0 while 2.11 requires a comment
stating the deliberate absence of `schedule:`. All four hits are comment mentions; on non-comment
lines the count is 0, which is 2.4's evident intent.

**Phase 3** adds two more, both measured before any edit. Criterion **3.2** asks that prettier
leave the edited markdown clean; `test-plan.md` and `roadmap.md` were **already** prettier-dirty
at `HEAD` (`*italic*` → `_italic_` across ~190 lines of test-plan; table column padding in
roadmap). The first decision was to leave that alone and write only clean new text — and
checking that decision is what found the real problem: **`npx prettier --write` was DESTRUCTIVE
on `test-plan.md`, reproducibly on the pristine `HEAD` copy too.** A code span split across two
lines inside a blockquote (`` `npm run `` / `` db:start` `` in §6.2's C10X-39 correction) loses
its `> ` marker on pass 1, and pass 2 collapses that whole correction block into one line — i.e.
`npm run format`, a documented script, silently damaged a paragraph, and prettier was not
idempotent here. Joining that code span onto one line fixes it; the file is then clean **and** a
verified fixed point (written twice, diffed), so the whole file is normalised and the landmine
is gone rather than stepped over. Content-neutrality was proved, not asserted: canonicalising
emphasis and whitespace, exactly **33** lines differ from `HEAD` and all are accounted for — 14
this change deliberately edits (incl. the 2-line fix) and 19 that merely gained a `> ` prefix
with **no** rendering change (that paragraph in §8's C10X-32 entry follows a blockquote with no
blank line, so markdown's lazy continuation already rendered it inside the quote). Related
finding, recorded not fixed: **the husky pre-commit hook is not installed in this tree**
(`core.hooksPath` unset, no `.husky/_/`, only `pre-commit.sample` in `.git/hooks/`), so
`lint-staged` never runs here — which is why the drift accumulated, and which makes AGENTS.md's
"commits auto-fix" false in this working tree. Criterion **3.1** (`gh secret list`
shows `OPENROUTER_EVAL_KEY`) was met without minting a new key: the developer already keeps a
separate eval key in the User environment (the `OPENROUTER_EVAL_KEY` convention this project's
archived verification files record), and it was piped into `gh secret set` straight from that
variable so the value never entered the session transcript — which is C10X-38's subject. The
plan's "create a NEW key with a low limit" therefore became "verify the existing eval key carries
one", and it was **measured** via `GET /api/v1/key` rather than assumed: `limit` $5,
`limit_remaining` $4.909, ≈370 runs of headroom at ~$0.013/run. It is separate from production's,
which lives as a Cloudflare Worker secret and is not a repository secret at all. **The divergence
has a documentation consequence that the manual check caught and reading would not have**: the
plan's phrase "never the developer's own" had already shipped into three places (README's secrets
row, the workflow's guard message and the comment above it), and it is **false** for what is
actually stored — this IS the developer's eval key. All three are corrected to the true claim
(dedicated to the eval, capped, never production's). Deliberate tradeoff: one key with one
purpose and one cap beats a second key, which would add a rotation surface without adding a
limit — OpenRouter governs rate limits per account and only spend per key.

**Phase 4** is written up in full in this change's `verification.md` (the only phase that has one —
Phases 1–3 live here instead). Two deviations belong in this list rather than only there. **The
dispatch order was inverted**: the plan numbers the green run 4.2 and the red 4.3, but nothing in
4.3 depends on 4.2 and a bogus `generator_model` fails at the first generation call, so the red
run doubles as a free credential probe and went first — which mattered, because the first dispatch
had already failed on a corrupted secret. And **Phase 4 §4's contract was falsified by its own
measurement**: "both attempts remain downloadable" is false, because `gh run rerun` deletes the
previous attempt's artifacts. Recorded as observed, with the operational consequence — honour
C10X-31's calibration re-run with a NEW dispatch, never `gh run rerun`.

**A stale figure was found while satisfying 3.6 and is corrected in `test-plan.md` rather than
worked around.** §8 has recorded the suite at `342/342` since C10X-40; the measured figure on
`main` and here is **345/345, 30 files**, because C10X-40's ledger entry was written at `63696e5`
and its own impl-review commit `6bc6a1f` then added three cases. `git diff --name-only 20b1866
HEAD -- tests/` is empty for this change, so the three are not ours.

Add a workflow_dispatch-only GitHub Actions workflow running `npm run eval` on demand, so the LLM-as-judge generation-quality eval — the project's only check against the real AI provider — stops being local-only. Scope: new workflow modelled on .github/workflows/schema-diff.yml; manual trigger with deliberately NO schedule/cron (no alert channel and no owner, so a nightly red nobody reads is an alarm without a listener — same decision as C10X-35); a SEPARATE low-credit OpenRouter key as a repository secret passed per step, which is the real blast-radius cap; full result uploaded as an artifact, not printed to the world-readable log. Hard contract: a red run means a REAL generation defect (the eval exits 1 by design, as C10X-41 showed), not a hygiene failure — it must NEVER be wired as a deploy-blocking gate; the contract is "run it and read the table", not "keep it green". One run ~$0.012 and 2-5 minutes. Deferred by decision from C10X-31's plan; recorded in context/foundation/test-plan.md §5 (LLM-as-judge row) and §6.6's C10X-31 "does NOT prove" list. (source: C10X-42)
