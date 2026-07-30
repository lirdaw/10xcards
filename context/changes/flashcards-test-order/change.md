---
change_id: flashcards-test-order
title: Make the test suite order-independent and enable sequence.shuffle
status: implemented
created: 2026-07-29
updated: 2026-07-30
archived_at: null
---

## Notes

Make the isolation test suite order-independent and enable vitest sequence.shuffle permanently. Deferred finding F6 from C10X-26 impl-review: tests/isolation/flashcards.test.ts:193 ("refuses B's own deck paired with A's card id") asserts cards[0].front is A_FRONT, but the later "still lets A edit A's own card" case mutates that same card — green only by declaration order; under npx vitest run --sequence.shuffle it fails (1 failed | 17 passed, expected "A's edited front …" to be "A's front …"). Fix: give the edit case its own card (or assert against the card it actually owns). Scope is the WHOLE suite, not just line 193 — only the first shuffled failure was investigated, so sweep all suites for the same order-dependence class (same class as F1 fixed in C10X-26 for tests/generation/generate.test.ts). Acceptance: shuffled runs green, sequence.shuffle enabled in vitest.config.ts so this class fails loudly in CI. (source: C10X-32)
