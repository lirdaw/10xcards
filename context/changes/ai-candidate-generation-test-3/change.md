---
change_id: ai-candidate-generation-test-3
title: AI-native tests for generation quality — language fidelity and usability
status: implementing
created: 2026-07-29
updated: 2026-07-29
archived_at: null
---

## Notes

AI-native test slice for Risk #7 (test-plan §3 Phase 5, AI-native generation quality): prove generated flashcards come back in the source-text language (PL/EN/ES) and are usable for study, so the 75% acceptance thesis is measurable. Layer: LLM-as-judge over a reference set — judge ONLY usability and language fidelity; anything a deterministic check can assert (JSON shape, card count, field presence, language tag) must not go to the judge. Anti-pattern to avoid: snapshotting model responses. Challenge the assumption "model returned valid JSON therefore cards are good". Dependency satisfied: roadmap S-05 candidate-review is shipped, so the acceptance signal the judge calibrates against exists. Oracle + cheapest test layer to be settled by /10x-research at work start. (source: C10X-31)
