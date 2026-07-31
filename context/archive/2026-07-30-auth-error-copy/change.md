---
change_id: auth-error-copy
title: Audit and close H-03 — auth error copy and the OpenRouter banner gate
status: archived
created: 2026-07-30
updated: 2026-07-31
archived_at: 2026-07-31T07:56:44Z
---

## Notes

Audit and close H-03 — the auth error mapper (src/lib/auth-errors.ts, ending the verbatim relay of GoTrue's error.message into ?error=) and the per-entry OpenRouter banner gate. CRITICAL FRAMING, do NOT plan a rebuild: this scope is ALREADY IMPLEMENTED and merged to main. It shipped inside C10X-28's change ai-candidate-generation-test-2 as Phase 1 and Phase 4 section 1 (commits b0ab625, 34e8837, eb621be), i.e. as side work under a foreign ticket key, and every commit carries scope (C10X-28) so git log never mentions C10X-34. The job here is to AUDIT what landed "along the way" and fix what the other ticket's scope did not cover — side-quest work is exactly where plan/plan-review usually finds unfinished edges. Verified already by reading the code this session: the closed-set invariant (no input substring reaches the output), the code->name->status keying chain, the Object.hasOwn prototype guard from impl-review F1, the banner gate being per entry with Supabase never gated (Layout.astro filters missingConfigs on Astro.locals.user, and AuthenticatedLayout wraps Layout so the gate covers every page), no runtime import of @supabase/auth-js, and tests/auth/errors.test.ts green at 38/38. Existing artifacts to read before planning: context/archive/2026-07-26-ai-candidate-generation-test-2/ — plan.md Phase 1 and Phase 4 section 1 marked MOVED OUT, verification.md sections Phase 1 and Phase 4, reviews/impl-review.md finding F1, research.md on @supabase/auth-js 2.105.3 error classes, frame.md on why the relay is a leak rather than XSS. Known open items: roadmap.md H-03 still reads "not started" and /10x-archive will NOT flip it because it matches on Change ID while the work shipped under a different one; partial overlap with C10X-19 (Polish UI copy); auth INPUT validation is explicitly out of scope and owned by C10X-36; the "address already registered" manual check is reachable only locally because supabase/config.toml sets enable_confirmations = false. (source: C10X-34)
