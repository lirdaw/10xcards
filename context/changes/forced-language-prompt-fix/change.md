---
change_id: forced-language-prompt-fix
title: Forced-language generation returns Polish cards for German and French
status: impl_reviewed
created: 2026-07-31
updated: 2026-07-31
archived_at: null
---

## Notes

Fix the forced-language path in AI card generation: choosing niemiecki or francuski returns Polish cards (0/5 cards in the target language, 4 of 4 measured runs; hiszpanski intermittent — one mixed card; polski/angielski fine), while the auto-detect path is flawless at 25/25 across five languages. Cause is in the prompt at src/lib/openrouter.ts:98-111 — an English sentence carrying the POLISH exonym ("Write the flashcards in this language: niemiecki.") reads as Polish context to the model; candidate fix is the English or native language name (German / Deutsch), to be verified, not assumed.

BUSINESS RATIONALE (for a non-engineering reader): this is a silent, user-visible production defect — a learner picks German, gets Polish flashcards, and gets no error message explaining why; the likely reaction is rejecting the whole generated batch. It hits the product's headline success metric directly: the PRD assumes at least 75% of generated cards are accepted, and a card in the wrong language is a rejected card by definition, so two of the six selector values structurally push the metric down. It also breaks an explicit first-class PRD requirement — cards must come out in the language of the user's material, and handling the languages users actually supply is a requirement, not a nice-to-have. The blast radius is bounded and the fix is cheap: the defect is isolated to the manual language selector (the automatic path, which most users hit, is unaffected), the root cause is a single prompt string, and the acceptance test already exists and costs about $0.012 per run — so this is a high-value, low-effort fix that removes a known drag on the acceptance rate before it is measured with real users.

ACCEPTANCE: `npm run eval` (OPENROUTER_API_KEY in the shell env, not part of npm test, ~$0.012 per run, currently exits 1 on exactly this defect) goes green on forced/niemiecki and forced/francuski with no other case regressing below today's level.

SCOPE: the generation prompt path only; the acceptance eval was delivered by C10X-31 and needs no new test infrastructure. (source: C10X-41)
