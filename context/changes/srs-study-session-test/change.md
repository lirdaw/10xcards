---
change_id: srs-study-session-test
title: SRS schedule correctness tests (test-plan Risk #3 / rollout Phase 4)
status: new
created: 2026-07-26
updated: 2026-07-26
archived_at: null
---

## Notes

Cover test-plan Risk #3 / rollout Phase 4 (SRS schedule correctness): prove a card rated well-known is deferred further than one rated hard, that the review schedule survives a restart between sessions, and that only `accepted` cards enter a study session; layers are unit (rating -> next-review mapping) plus integration (persistence); the assertion must be a property or an independent recomputation, never a constant copied from the implementation, and a happy path without a restart does not count. Important prior state: roadmap S-03 `srs-study-session` already shipped and its Phase 5 landed tests/study/schedule.test.ts and tests/study/study.test.ts, test-plan §3 Phase 4 is already marked complete and §6.6 claims Risk #3 covered — so /10x-research must first establish what real gap (if any) remains (a known candidate: the signed-out path on /study and /api/study, which §6.6 Phase 1 explicitly deferred until the SRS routes landed) before any new test is written. (source: C10X-27)
