---
change_id: eval-ci-dispatch
title: Run the generation-quality eval from CI on demand
status: implementing
created: 2026-08-02
updated: 2026-08-02
archived_at: null
---

## Notes

Add a workflow_dispatch-only GitHub Actions workflow running `npm run eval` on demand, so the LLM-as-judge generation-quality eval — the project's only check against the real AI provider — stops being local-only. Scope: new workflow modelled on .github/workflows/schema-diff.yml; manual trigger with deliberately NO schedule/cron (no alert channel and no owner, so a nightly red nobody reads is an alarm without a listener — same decision as C10X-35); a SEPARATE low-credit OpenRouter key as a repository secret passed per step, which is the real blast-radius cap; full result uploaded as an artifact, not printed to the world-readable log. Hard contract: a red run means a REAL generation defect (the eval exits 1 by design, as C10X-41 showed), not a hygiene failure — it must NEVER be wired as a deploy-blocking gate; the contract is "run it and read the table", not "keep it green". One run ~$0.012 and 2-5 minutes. Deferred by decision from C10X-31's plan; recorded in context/foundation/test-plan.md §5 (LLM-as-judge row) and §6.6's C10X-31 "does NOT prove" list. (source: C10X-42)
