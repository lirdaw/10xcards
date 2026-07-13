---
change_id: ai-candidate-generation
title: Generacja kandydatów fiszek AI z wklejonego tekstu
status: archived
created: 2026-07-11
updated: 2026-07-13
archived_at: 2026-07-13T19:38:15Z
---

## Notes

Generacja kandydatów fiszek AI z wklejonego tekstu: użytkownik wkleja tekst źródłowy do zdefiniowanego maksimum (FR-003), uruchamia generację LLM, kandydaci zapisywani ze statusem `generated` powiązani z sesją generacji — nowa tabela GenerationSession (FR-004, FR-006); widoczny postęp bez zawieszania UI (guardrail ~200ms/>2s); przy błędzie/timeoucie jasny komunikat + retry jako twarde kryterium "done" (FR-018). Prereq F-01 (RLS) i S-01 (talie) — oba done. Ref US-01. (source: C10X-7)
