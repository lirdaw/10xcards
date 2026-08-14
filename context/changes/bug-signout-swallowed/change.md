---
change_id: bug-signout-swallowed
title: Signout stops presenting a failed signOut as success
status: implementing
created: 2026-08-13
updated: 2026-08-14
archived_at: null
---

## Notes

Fix swallowed signOut in src/pages/api/auth/signout.ts (l.6-9): the { error } from supabase.auth.signOut() is discarded and the route unconditionally redirects to "/" as success; when createClient returns null, sign-out does not happen at all yet the redirect still fires. Risk: on a shared computer the user believes they are signed out while the session lives, with no message. Acceptance: a failed signOut must not present as success; the missing-client (null) branch is handled, not ignored. Context: last remaining discarded-result Supabase mutation in src/, explicitly carved out for this ticket by test-plan.md after C10X-48/49/50 closed the generate.ts swallowed-write class; found by the swallowed-errors audit (2026-08-11), hit #4. (source: C10X-51)
