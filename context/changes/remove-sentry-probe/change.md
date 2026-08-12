---
change_id: remove-sentry-probe
title: Remove the public /api/shipprobe error probe from production
status: implementing
created: 2026-08-12
updated: 2026-08-12
archived_at: null
---

## Notes

Remove the deliberately-failing public probe route src/pages/api/shipprobe.ts and ship that removal to production, now that H-14's Sentry prod sanity is confirmed closed. The route is anonymously reachable by design and its errors are the FIRST-PARTY class, which reaches Sentry UNSAMPLED at 100%, so a loop against it exhausts the Sentry quota — and that failure is self-masking: past the cap, unrelated errors stop arriving too and this project has no notification channel to say so. Scope: delete the route, deploy to prod. Unknown to settle BEFORE building: plain deletion vs keeping a permanently GUARDED replacement (secret header, or PROTECTED_ROUTES) so a real first-party error can still be provoked on prod later — a separate design decision, not the default. One-line stopgap if noise appears before removal: add /api/shipprobe to PROTECTED_ROUTES in src/middleware.ts. Anchors: sampling and DEPENDENCY_NOISE in src/worker.ts; monitoring context in context/archive/2026-08-11-sentry-monitoring/deploy-runbook.md; roadmap block ### H-15. (source: C10X-54)
