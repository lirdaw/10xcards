---
change_id: ai-candidate-generation-test
title: Integration tests — retry after generation timeout must not duplicate candidates
status: implementing
created: 2026-07-18
updated: 2026-07-18
archived_at: null
---

## Notes

Pokryć testami ryzyko #2 z test-plan.md §2: retry po timeoucie generacji nie może zapisać drugiego zestawu kandydatów (duplikaty kart + zduplikowana sesja generacji). Warstwa: integration, faza rolloutu §3 Faza 2 (Endpoint contract) wokół /api/generate. Oracle: dwa identyczne żądania produkują dokładnie jeden zestaw kart. Zakwestionować założenie "klient dostał timeout, więc serwer nie zacommitował"; antywzorzec do uniknięcia: asercja wyłącznie na kolejności timeoutów zamiast na faktycznym wyścigu. Sygnał: lessons.md (zapis nieidempotentny przy timeoucie klient+serwer z przyciskiem retry), PRD FR-018, hot-spot src/lib/. Najtańszy test i konkretny oracle do ustalenia przez /10x-research na starcie. (source: C10X-26)
