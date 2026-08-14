---
change_id: dev-db-test-data-debt
title: Pay down the local dev-DB test-data debt and attribute the decks.test.ts flake
status: implemented
created: 2026-08-14
updated: 2026-08-15
archived_at: null
---

## Notes

Pay down accumulated test data in the LOCAL dev database, where the cost is not cosmetic: with 5459 decks against `max_rows = 1000`, a denial asserted as "absent from an unbounded result set" becomes unfalsifiable and still reads green — test-plan.md §6.6 records exactly that, the four-policy `listDueCounts` neuter passing while the guard was fully disabled. Scope: (1) one-off cleanup of the backlog — `harness-*` accounts with their decks, plus the orphaned "E2E deck 1785947414992" left by a failed inline cleanup in seed.spec.ts on 2026-08-05; (2) a decision on whether a scoped reset / hygiene step belongs to the harness, to CI, or stays manual; (3) attribution of the `tests/validation/decks.test.ts` flake under a random shuffle seed (createDeck ends on the generic "Nie udało się utworzyć talii", re-run green — commit 5f3c87e, run #66, 2026-08-05) — pure accumulation, or the H-08 Kong 502 transport flake; if the latter, split it out. BOUNDARY: C10X-46's teardown project stops FUTURE growth but does not repay the existing 5459 decks (roadmap.md:376 says so outright), and this change is the repayment. Note there is no roadmap row for this work yet — it will need one so /10x-archive has something to close. (source: C10X-47)
