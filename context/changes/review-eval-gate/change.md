---
change_id: review-eval-gate
title: Wire the promptfoo eval suite as a regression gate on prompt changes
status: impl_reviewed
created: 2026-08-23
updated: 2026-08-23
archived_at: null
---

## Notes

wire the promptfoo eval suite as a regression gate on prompt changes

## ⚑ Zatrzymanie po fazie 2 — ODWOŁANE, faza 3 domknięta (2026-08-23)

**Stan: WSZYSTKIE fazy wdrożone** (`be29442`, `f8a9e80`, faza 3a `fadc918`, faza 3 `2b6835d`,
faza 4 `6eb9bb4`, faza 5 `5d7c5ad`). Faza 5 domknęła dwustronną kontrolę pozytywną na żywym CI:
`Eval ratchet` widziany na CZERWONO na obu osiach z osobna (sonda P1 — odcisk wywołania, jeden
znak w `SYSTEM_PROMPT`; sonda P2 — `SCORE_THRESHOLD 5 → 8`) i na ZIELONO po obu rewertach, na tej
samej gałęzi i tym samym workflow. Drzewo po rewertach jest co do bajtu tym samym drzewem, co
przed sondami. Wydatek fazy 5: **0,00 USD** — a strażnik kosztu (`PR code review` wyłączony na czas
sond i włączony z powrotem jako warunek zamknięcia fazy) oszczędził do ~3,87 USD na cudzej bramce.

Zatrzymanie fazy 3 na kryterium 3.6 (`ok: false` w dwóch z czterech komórek) **rozwiązało się
przez poprawę D-6/D-9**, a nie przez podniesienie `maxTurns`: rekord i zapadka rozróżniają dziś
**(A) model nie dowiózł** — raportowane, nieblokujące — od **(B) prompt zregresował** — czerwień.
`FIXED_CALL_OPTIONS` **nietknięte**, kotwica `59ee111b…` niezmieniona, wywołanie produkcyjne bez
zmian. Zapis zatrzymania zostaje w `verification.md` — razem z tym, że było słuszne: doprowadziło
do pomiaru 3a.1 i do rozdzielenia przyczyn.

Drugie przejście macierzy (2026-08-23, 19:23Z) dało **trzy komórki dowiezione i żadnej w klasie
(B)**; jedyny brak to gemini / `clean-text-change.diff` na `error_max_turns` — klasa (A), `::notice`,
nie blokuje. Oba checkery na prawdziwym rekordzie: **kod 0**. To domknęło też kryterium 4.3, jedyny
wiersz fazy 4 czekający na płatne przejście.

### Budżet

| pozycja                               | USD           |
| ------------------------------------- | ------------- |
| zatrzymane przejście fazy 3           | 0,235012      |
| pomiar 3a.1 (sześć przebiegów)        | 0,381737      |
| przejście fazy 3 (podejście 2)        | 0,139255      |
| suma pozycji                          | 0,756004      |
| **delta klucza — to WIĄŻE**           | **0,772407**  |
| rozjazd (księgowanie po „domknięciu") | **+0,016403** |
| kotwica (D-8)                         | 1,50          |
| zostaje                               | ~0,728        |

Rozjazd nie jest błędem rachunku: „odczyt opóźniony" fazy 3a.1 nie był ostatni — po nim doszło
jeszcze 0,016403 USD. Każda kwota per faza jest więc oszacowaniem DOLNYM, a budżet wiąże
**różnicą dwóch odczytów klucza**, nie sumą pozycji.

### Zmierzony fakt, który KORYGUJE wcześniejszy zapis

„Granica `maxTurns: 2` jest własnością FIKSTURY, nie gemini” — **nieprawda**. Dziś, na zimno, na
tej samej fiksturze i przy tym samym `maxTurns: 2`, **haiku dowiozło** (5/5 asercji twardych).
Poprawny zapis: `clean-text-change.diff` leży NA GRANICY `maxTurns: 2`, a wynik komórki jest losem
przebiegu — nie własnością modelu ani fikstury. Próbek jest za mało, żeby czytać z nich
częstość; wystarczy, żeby wiedzieć, że oba wyniki są osiągalne przy niezmienionym wywołaniu.

Pełny rachunek, tabela przejścia i odstępstwa od planu (dwie komórki weszły z cache'u):
`context/changes/review-eval-gate/verification.md`.
