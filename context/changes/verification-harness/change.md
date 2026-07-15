---
change_id: verification-harness
title: Test harness bootstrap and per-account isolation tests (test-plan Phase 1)
status: impl_reviewed
created: 2026-07-15
updated: 2026-07-15
archived_at: null
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md`: "Harness + per-account isolation".
This change also delivers roadmap F-03 (verification-harness) — same scope, same change-id.

**Risks covered**
- Risk #1 — a new or changed API endpoint lets one account read or modify another account's
  deck or flashcards (ownership check does not hold, RLS bypassed, or `publicId` from the URL
  treated as authorization).

**Test types planned**: test-runner bootstrap, integration, RLS.

**Risk response intent**: prove that account B is denied account A's deck/flashcard resources
on read AND on write, while account A still reaches its own data (positive control). Challenge
the assumption that "authenticated implies authorized" and that "RLS is enabled, therefore the
endpoint is safe".

**CI verification (was open at `implemented`, closed at `/ship` on 2026-07-15)**: Progress rows
4.1, 4.2, 4.4 and 4.5 needed a real CI run, so they were deferred to `/ship`. All four are now
checked, on PR #7 (run 29449372588, green — 15 tests / 4 files, 3m06s) and throwaway scratch PR #8
(run 29449673825, red at `decks.test.ts:80`, `deploy: skipped`). Every Progress row is now `[x]`.

**Out of scope for this phase**
- Endpoint validation-parity and no-leak assertions (Phase 2)
- CI gates (Phase 3)
- SRS schedule (Phase 4, blocked on S-03)
- AI-native judging (Phase 5, blocked on S-05)
