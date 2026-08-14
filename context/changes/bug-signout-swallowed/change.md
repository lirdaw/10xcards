---
change_id: bug-signout-swallowed
title: Signout stops presenting a failed signOut as success
status: implemented
created: 2026-08-13
updated: 2026-08-14
archived_at: null
---

## Decisions recorded at implementation time

- **The roadmap Status flip in Phase 5 §4 was deliberately NOT performed.** H-19 stays
  `Status: in progress` with no `## Done` bullet, because `lessons.md` reserves both for
  `/10x-archive` ("if a plan instructs the flip, treat it as a defect and defer to archive") and
  `roadmap.md:79-87` states the same ownership. Phase 1 had already behaved that way. `/10x-archive`
  closes H-19 with the archive path it will then know. Recorded here so the absence reads as a
  decision rather than a missed edit.
- **Doc-sync deviated from Phase 5 §3's "repoint the path" for five of eight sites.** The three live
  code comments were repointed; the five inside `test-plan.md`'s dated entries were left verbatim,
  because there the old filename sits _inside_ a dated measurement ("+7 in the new
  `audit-failure-wiring.test.ts`") rather than beside it. The rename is recorded once as a dated
  correction instead. Full reasoning in `verification.md`.

## Notes

Fix swallowed signOut in src/pages/api/auth/signout.ts (l.6-9): the { error } from supabase.auth.signOut() is discarded and the route unconditionally redirects to "/" as success; when createClient returns null, sign-out does not happen at all yet the redirect still fires. Risk: on a shared computer the user believes they are signed out while the session lives, with no message. Acceptance: a failed signOut must not present as success; the missing-client (null) branch is handled, not ignored. Context: last remaining discarded-result Supabase mutation in src/, explicitly carved out for this ticket by test-plan.md after C10X-48/49/50 closed the generate.ts swallowed-write class; found by the swallowed-errors audit (2026-08-11), hit #4. (source: C10X-51)
