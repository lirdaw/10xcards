---
change_id: bug-middleware-getuser-swallowed
title: Middleware reads a getUser() auth error as "not signed in"
status: impl_reviewed
created: 2026-08-14
updated: 2026-08-14
archived_at: null
---

## Notes

src/middleware.ts discards the error from supabase.auth.getUser(), so a transient GoTrue/network failure is indistinguishable from an absent session: a user holding a valid session gets a 302 to /auth/signin, and a JSON-fetching island gets a 401 plus the misleading "Twoja sesja wygasła" banner. Read-side twin of C10X-51 (write side, closed) and hit #5 — the last — of the 2026-08-11 swallowed-errors audit. Scope: read {data, error} in the middleware and separate an auth ERROR from no-session (the error-vs-empty pattern) so a temporary backend outage never presents as an expired session. Acceptance: auth error distinguished from absent session; a transient backend failure no longer shows a misleading "session expired". Note both branches are likely unreachable from the Vitest suite (healthy local stack, astro:env inlined), so expect a pure decision function with a truth table plus one manual run, as in C10X-51. (source: C10X-52)
