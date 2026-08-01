---
change_id: local-stack-transport-flake
title: Remove the cause of the local stack's Kong 502 transport flake
status: new
created: 2026-08-01
updated: 2026-08-01
archived_at: null
---

## Notes

Remove the CAUSE of the local Supabase stack's Kong 502 "upstream prematurely closed connection" flake, not just the workaround: Kong holds keep-alive connections to PostgREST longer than PostgREST does, so the first request after ~28s of idle can 502 and surfaces as a random red test wherever the assertion happened to be. Scope: (1) confirm — do not assume — the cause in the local stack's configuration (Kong keepalive_timeout / keepalive_requests shorter than PostgREST's, or a newer Supabase CLI image that already patches it); (2) make the two unguarded write seams loud — createNonAcceptedCard and seedCard have no count assertion after them and flashcard carries no uniqueness constraint, so a retried write that had in fact committed would pass SILENTLY (deck is loud via deck_user_name_unique); (3) once the cause is gone, narrow or delete tests/setup/retry-transport.ts plus tests/lib/retry-transport.test.ts and sync test-plan.md §4/§6.2/§6.9. Acceptance: cause established by a configuration change with a before/after measurement on the SAME 40-run matrix as C10X-32, and the ORACLE is Kong's own log going quiet on "prematurely closed" — NOT a green suite, which is already green thanks to the workaround (0/40 red while Kong logged 22 more drops). Out of scope: production (no local Kong there — the Cloudflare Worker talks to cloud Supabase) and anything about test ordering / sequence.shuffle (C10X-32, closed). Evidence: context/archive/2026-07-29-flashcards-test-order/verification.md and its reviews/impl-review.md F3; class recorded in test-plan.md §6.2 and §8. (source: C10X-39)
