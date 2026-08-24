---
change_id: review-eval-gate
title: Wire the promptfoo eval suite as a regression gate on prompt changes
status: archived
created: 2026-08-23
updated: 2026-08-24
archived_at: 2026-08-24T11:04:55Z
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

| pozycja                                     | USD          |
| ------------------------------------------- | ------------ |
| zatrzymane przejście fazy 3                 | 0,235012     |
| pomiar 3a.1 (sześć przebiegów)              | 0,381737     |
| przejście fazy 3 (podejście 2)              | 0,139255     |
| suma pozycji                                | 0,756004     |
| delta klucza po fazie 5 — WIĄZAŁA wtedy     | 0,772407     |
| rozjazd (księgowanie po „domknięciu")       | +0,016403    |
| recenzja PR #49 (`PR code review`, db71946) | 0,654817     |
| **delta klucza po shipie — to WIĄŻE DZIŚ**  | **1,427224** |
| kotwica (D-8)                               | 1,50         |
| **zostaje**                                 | **0,072776** |

### Domknięcie rachunku po shipie (2026-08-24)

Wiersz „recenzja PR #49" jest ZMIERZONY, nie oszacowany. Klucz `OPENROUTER_REVIEW_KEY` — ten sam,
którego dotyczą wszystkie pozycje wyżej, bo `pr-review.yml:370` podaje go recenzji, a
`agents/review` bierze go na przejścia macierzy.

| odczyt `/api/v1/key`                    | znacznik czasu         | `usage`         |
| --------------------------------------- | ---------------------- | --------------- |
| domknięcie fazy 5 (odczyt PÓŹNY)        | `2026-08-23T19:33:02Z` | **4,387906986** |
| po recenzji, +13 min 46 s               | `2026-08-24T10:28:52Z` | **5,042723736** |
| potwierdzenie stabilności, +15 min 31 s | `2026-08-24T10:30:37Z` | **5,042723736** |
| potwierdzenie stabilności, +16 min 18 s | `2026-08-24T10:31:24Z` | **5,042723736** |
| odczyt PÓŹNY, +19 min 34 s              | `2026-08-24T10:34:40Z` | **5,042723736** |

**Delta za recenzję: 0,654816750 USD.** Atrybucja jest czysta i sprawdzona, nie założona: w oknie
między odczytem domykającym fazę 5 a dzisiejszym odbył się DOKŁADNIE jeden przebieg `PR code
review` (`2026-08-24T10:10:52Z`, `db71946`, `success`) — poprzedni jest z `2026-08-23T12:39:34Z`,
czyli sprzed odczytu kotwiczącego. Żaden inny konsument tego klucza nie biegł.

**Suma zmiany: 1,427224 USD z kotwicy 1,50. Zostaje 0,072776.** To mniej niż jedno przejście
macierzy (kotwica ~0,24, zmierzony zakres 0,139–0,235), więc **budżet tej zmiany nie kupi już
ŻADNEGO płatnego przebiegu** — ani przejścia macierzy, ani drugiej recenzji PR-a. Kolejna praca
płatna na tym obszarze potrzebuje własnej kotwicy, a nie reszty po tej.

Zastrzeżenie w mocy, to samo co przy każdej pozycji wyżej
(`measurement-negative-control.md:154-157`): 0,654817 jest oszacowaniem DOLNYM, potwierdzonym
czterema odczytami rozłożonymi na 6 minut, a domknie je dopiero odczyt otwierający następne
okno pomiarowe. Część tej
kwoty może być zresztą ogonem księgowania z przejścia fazy 3 — tak jak rozjazd +0,016403 był
ogonem pomiaru 3a.1.

**Prognoza „~1,41" NIE jest pomiarem i nie trafiła do żadnego dokumentu** — sprawdzone gremem po
`context/changes/review-eval-gate/` i `AGENTS.md`. Padła wyłącznie w rozmowie, jako oszacowanie
przy założeniu 0,64 za recenzję. Zmierzone wyszło 0,654817, czyli o 0,015 wyżej; wiąże liczba
z tabeli, nie prognoza.

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

## Follow-up po shipie (2026-08-24) — NIE na tej gałęzi i NIE z tego budżetu

Cztery pozycje wyszły z recenzji PR #49. **Żadnej nie wolno domknąć tutaj:** gałąź jest zmergowana
(`0290af6`), a z kotwicy 1,50 zostało **0,072776 USD**, czyli mniej niż jedno przejście macierzy.
Każda z nich potrzebuje własnej zmiany i własnej kotwicy. Pełne dane: `verification.md` §Faza 6
(po archiwizacji: `context/archive/<DATA>-review-eval-gate/verification.md`).

1. **Osierocony JSDoc** — `agents/review/evals/eval-record.ts:447-465`. Blok dokumentujący
   `buildRecord` stoi przed `previousDeliveryFrom`; hover, typedoc i LSP przypiszą kontrakt nie tej
   funkcji, a eksportowany `buildRecord` nie pokaże dokumentacji żadnej. Defekt dokumentacyjny,
   mały, ale realny — i **przeoczony przez impl-review**, mimo że leżał w zakresie jego diffa.
2. **Kandydat na kryterium promptu agenta review: „nie orzekaj o tym, czego nie ma w diffie".**
   Materiałem jest JEDEN diff od merge-base (`pr-review.yml:280`) — bez historii, bez granic
   commitów. Przypisanie zmiany do konkretnego commita jest więc twierdzeniem o osi nieobecnej
   w danych. Klasa jest szersza niż commity i tak należy ją sformułować.
3. **Trzy kandydatury na fikstury do zestawu evali** — miskalibracja oceny wobec własnego findingu;
   twierdzenie ponad dowód; odróżnianie „nie wiem" od „nie istnieje" (fałszywy trop z cutoffu).
   Wszystkie trzy to **zachowania ZMIERZONE na prawdziwym materiale**, z sha, przebiegiem i cytatem
   — opisane z proponowanymi asercjami i kontrolą negatywną w `verification.md` §Faza 6.

4. **Dowód jest niewidoczny dla recenzenta** — `.github/workflows/pr-review.yml:287` wycina
   `agents/review/evals/eval-record.json` z diffa podawanego agentowi review. Wykluczenie jest samo
   w sobie sensowne (plik generowany, szum w diffie), ale konsekwencja jest niebanalna: **dowód,
   którego pilnowanie jest całym powodem istnienia tej zmiany, nie trafia do materiału recenzji.**
   Dziś nieszkodliwe, bo prozę niesie `MANDATORY_NOTES` w `eval-record.ts`, a `.ts` do diffa wchodzi
   — zmierzone na `db71946`. Szkodliwe w dniu, w którym ktoś przeniesie tę prozę wyłącznie do
   `.json`: recenzent przestanie widzieć treść, o której ma się wypowiadać, i nikt tego nie
   zauważy, bo bramka pozostanie zielona. **Warunek domknięcia:** przy następnej zmianie dotykającej
   filtrów diffa w `pr-review.yml` — wtedy, nie osobno.

**Czego ten follow-up NIE zawiera i dlaczego.** Open Risk 6 (dziura sonnetowa) i Open Risk 7
(ucieczka w adnotacjach) zostają tam, gdzie były, z niezmienionymi warunkami domknięcia. Recenzja
ich nie zgłosiła, ale to **nie jest przesłanka w żadną stronę** — jest brakiem dowodu, i to
brakiem mierzącym czułość recenzenta, a nie stan kodu.
