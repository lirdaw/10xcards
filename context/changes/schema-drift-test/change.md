---
change_id: schema-drift-test
title: CI gate for database schema drift vs migration history
status: plan_reviewed
created: 2026-07-27
updated: 2026-07-27
archived_at: null
---

## Notes

Add a CI gate that stops the pipeline BEFORE the app deploys whenever the deployed database schema has drifted from the migration history (test-plan.md Risk #5, rollout Phase 3; the gate belongs in .github/workflows, wired relative to db push and deploy). Goal: green CI must mean "tested AND prod actually migrated" — the assumption to challenge is "green locally means prod is migrated". Layer is a CI gate, explicitly NOT a unit test (that is the named anti-pattern). Evidence behind the risk: a real drift incident during M2L5, plus two lessons.md entries (cloud migration is a step distinct from app deploy; a blind `migration repair` desynced prod history); supabase/migrations/ is a hot spot at 6 commits/30d. Acceptance: drift between migration history and the deployed schema fails CI before the deploy step runs. The oracle and the cheapest concrete check are deliberately left to /10x-research at the start of work. (source: C10X-29)
