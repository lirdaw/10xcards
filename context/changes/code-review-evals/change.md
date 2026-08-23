---
change_id: code-review-evals
title: Promptfoo evals for the code review agent
status: implementing
created: 2026-08-22
updated: 2026-08-23
archived_at: null
---

## Notes

introducing promptfoo evals for the code review agent

## Dług zapisany jawnie

**Workflow evali nie został ani razu uruchomiony w tej zmianie, więc jest gwarancją
NIEPRZETESTOWANĄ** — dokładnie tą klasą, którą archiwum tego repo zapisało przy `concurrency`
w `eval.yml` jako „never contended". Zestaw jechał wyłącznie lokalnie; że pojedzie na runnerze,
jest przewidywaniem, nie pomiarem.

**Warunek zamknięcia:** osobna zmiana, która dodaje workflow evali wzorem
`.github/workflows/eval.yml` — `workflow_dispatch` jako JEDYNY wyzwalacz, sekret na KROK a nie
na job, `concurrency` na samym workflow, artefakt z pełnym zapisem, `sed` wycinający klucz przed
uploadem, żadnego `schedule:`, `needs:` ani required check — **i odpala go RAZ, na dowód**.

⚑ Ten workflow musi przy okazji zamknąć ryzyko otwarte nr 2 z planu: cache promptfoo to jeden
plik `cache.json`, więc dwa równoległe przebiegi kasują sobie wpisy. Albo `concurrency` na
workflow, albo własny `PROMPTFOO_CACHE_PATH` na przebieg — inaczej wyścig objawi się nie awarią,
tylko rachunkiem.

## Stan na zamknięcie fazy 7

Pełny zapis: `verification.md` (dowody per faza), `plan.md` (sekcja „Open Risks"),
`requirements.md` (rachunki przy wymaganiu 1).

- **Wydano: 1,096735 USD** z progu **1,20 USD** podniesionego jawnie i jednorazowo 2026-08-23
  (pierwotny próg 1,00 USD zostaje w zapisie obok, nie zamiast).
- **Cztery ryzyka otwarte**, każde z warunkiem zamknięcia sformułowanym jako PYTANIE DO POMIARU:
  duplikacja `SCORE_MIN`/`SCORE_MAX`, wyścig cache'u promptfoo, kontrakt `null` odrzucany przez
  model, `maxTurns: 2` jako nienazwane założenie o wielkości wejścia.
- **Pięć pozycji `## Progress` zostaje NIEODHACZONYCH** (6.1, 6.2, 7.1, 7.2, 7.5) — świadomie.
  Każda z nich opisuje warunek, który NIE został spełniony, a odhaczenie z przypisem zrównałoby
  „niezmierzone" ze „zmierzonym i w porządku". Powody per pozycja: `verification.md`, faza 7.
