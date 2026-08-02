---
change_id: eval-ci-dispatch
title: Run the generation-quality eval from CI on demand
status: implementing
created: 2026-08-02
updated: 2026-08-02
archived_at: null
---

## Notes

Work branch: `C10X-42-eval-ci-dispatch` (Phase 1's commit `73d8749` was authored on `main` by
mistake and moved onto the branch immediately, before any push — `main` is back at `origin/main`).

Two criteria were adapted during implementation, both recorded here so Phase 3's write-up does not
have to rediscover them. **Phase 1 §4** asks for `??` → `||` in `resolveJudgeModel`, which ESLint
refuses (`@typescript-eslint/prefer-nullish-coalescing`, an *error*); the rule is disabled on that
one line with the reason stated at the site, because its message ("`??` is safer") is exactly
backwards there. **Phase 2 criteria 2.4 and 2.11 are mutually unsatisfiable as literally worded** —
2.4 wants `grep -c "needs:\|schedule:\|workflow_run:"` to return 0 while 2.11 requires a comment
stating the deliberate absence of `schedule:`. All four hits are comment mentions; on non-comment
lines the count is 0, which is 2.4's evident intent.


Add a workflow_dispatch-only GitHub Actions workflow running `npm run eval` on demand, so the LLM-as-judge generation-quality eval — the project's only check against the real AI provider — stops being local-only. Scope: new workflow modelled on .github/workflows/schema-diff.yml; manual trigger with deliberately NO schedule/cron (no alert channel and no owner, so a nightly red nobody reads is an alarm without a listener — same decision as C10X-35); a SEPARATE low-credit OpenRouter key as a repository secret passed per step, which is the real blast-radius cap; full result uploaded as an artifact, not printed to the world-readable log. Hard contract: a red run means a REAL generation defect (the eval exits 1 by design, as C10X-41 showed), not a hygiene failure — it must NEVER be wired as a deploy-blocking gate; the contract is "run it and read the table", not "keep it green". One run ~$0.012 and 2-5 minutes. Deferred by decision from C10X-31's plan; recorded in context/foundation/test-plan.md §5 (LLM-as-judge row) and §6.6's C10X-31 "does NOT prove" list. (source: C10X-42)
