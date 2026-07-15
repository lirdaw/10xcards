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

**Open at `implemented`**: Progress rows 4.1, 4.2, 4.4 and 4.5 (CI green on the PR, real test
count in the log, run time, and a deliberately broken test turning CI red) stay unchecked. They
need a real CI run, which needs the branch pushed and a PR open — that belongs to `/ship`, not
here. Everything else, including the CI step itself, is implemented and verified locally.

**Out of scope for this phase**
- Endpoint validation-parity and no-leak assertions (Phase 2)
- CI gates (Phase 3)
- SRS schedule (Phase 4, blocked on S-03)
- AI-native judging (Phase 5, blocked on S-05)
