---
change_id: bug-generation-failed-audit-swallowed
title: Unchecked "failed" audit-row insert on both generation failure paths
status: implementing
created: 2026-08-13
updated: 2026-08-13
archived_at: null
---

## Notes

Both failure paths in src/pages/api/generate.ts swallow the result of their `createGenerationSession` "failed" audit-row insert: the transport/timeout catch (currently ~line 426, answers 502) and the 0-saved branch (currently ~line 477, answers 422) both `await` the insert without reading `{data, error}`, so a failed audit write is completely silent — no audit row, no log (src/ forbids console.\*), and the user still gets a retriable error as if the failure had been recorded. This is the LAST of the three swallowed-error sites in this file: C10X-48 (compensation) and C10X-49 (deck undo) are Done and both left explicit `owned by C10X-50` comments at these two call sites. Acceptance: (1) a failed "failed"-audit insert is detected and signalled rather than swallowed; (2) the audit contract in test-plan.md §6.6 is not silently broken. Constraints: the 502/422 responses must stay retriable so FR-018 "Ponów" keeps working; `idempotency_key` stays NULL on both inserts by deliberate design (plan-review F1 — a keyed failed row would make the retry collide with itself); follow the C10X-48/C10X-49 precedent for how a checked compensating write is asserted, and note that no test in this suite can reach these branches (module doubles are confined to one file, §6.9), so the reachability half will rest on a recorded manual run. NOTE: the ticket's quoted line numbers (277-301, 314-328) are stale — they come from the 2026-08-11 audit and the file has grown since; the real sites are the two `createGenerationSession` calls verified at :426 and :477. (source: C10X-50)
