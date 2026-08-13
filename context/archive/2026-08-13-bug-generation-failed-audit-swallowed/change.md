---
change_id: bug-generation-failed-audit-swallowed
title: Unchecked "failed" audit-row insert on both generation failure paths
status: archived
created: 2026-08-13
updated: 2026-08-13
archived_at: 2026-08-13T19:28:26Z
---

## Notes

Both failure paths in src/pages/api/generate.ts swallow the result of their `createGenerationSession` "failed" audit-row insert: the transport/timeout catch (currently ~line 426, answers 502) and the 0-saved branch (currently ~line 477, answers 422) both `await` the insert without reading `{data, error}`, so a failed audit write is completely silent — no audit row, no log (src/ forbids console.\*), and the user still gets a retriable error as if the failure had been recorded. This is the LAST of the three swallowed-error sites in this file: C10X-48 (compensation) and C10X-49 (deck undo) are Done and both left explicit `owned by C10X-50` comments at these two call sites. Acceptance: (1) a failed "failed"-audit insert is detected and signalled rather than swallowed; (2) the audit contract in test-plan.md §6.6 is not silently broken. Constraints: the 502/422 responses must stay retriable so FR-018 "Ponów" keeps working; `idempotency_key` stays NULL on both inserts by deliberate design (plan-review F1 — a keyed failed row would make the retry collide with itself); follow the C10X-48/C10X-49 precedent for how a checked compensating write is asserted, and note that no test in this suite can reach these branches (module doubles are confined to one file, §6.9), so the reachability half will rest on a recorded manual run. NOTE: the ticket's quoted line numbers (277-301, 314-328) are stale — they come from the 2026-08-11 audit and the file has grown since; the real sites are the two `createGenerationSession` calls verified at :426 and :477. (source: C10X-50)

**Corrected during implementation (plan's Key Discoveries).** "No test in this suite can reach
these branches" overshot: `tests/generation/failure-path.test.ts` drives both branches end to end
today (split 3-to-1 in Site A's favour), so the LANDED arm of both audit inserts was already owned
by four committed cases. What no layer could reach — and what Phase 3/4 close, the first with a
committed cross-account `42501` denial plus its own positive control, the second with two manual
DCL runs one per site — is the insert **failing**. Implemented across five phases: the pure report
builder + privacy truth table (p1), both call sites wired on two channels — a per-site response
literal and a fingerprinted `Sentry.captureException` (p2), the committed error-arm test plus the
wiring guard and five breakage criteria (p3), two manual reachability runs (p4), and this doc-sync
(p5). Suite 437 → 467, 38 files. Full record: `verification.md`.

**Impl-reviewed 2026-08-13.** APPROVED, 0 critical/warning findings; one OBSERVATION (F1 —
`error_message`'s verbatim-to-Sentry exception rests on an unenforced invariant in
`openrouter.ts`) was fixed in place with a cross-reference comment. Full record:
`reviews/impl-review.md`.
