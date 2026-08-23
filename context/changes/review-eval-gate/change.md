---
change_id: review-eval-gate
title: Wire the promptfoo eval suite as a regression gate on prompt changes
status: implementing
created: 2026-08-23
updated: 2026-08-23
archived_at: null
---

## Notes

wire the promptfoo eval suite as a regression gate on prompt changes

## ⚑ ZATRZYMANA po fazie 2 — czeka na re-plan (2026-08-23)

Fazy 1 i 2 wdrożone (`be29442`, `f8a9e80`). **Faza 3 zatrzymana na własnym kryterium 3.6**,
Progress fazy 3 zostaje otwarty, żaden wiersz nie odhaczony. Faz 4 i 5 nie zaczynano.

Płatne przejście macierzy się odbyło i **dwie z czterech komórek oblały** — obie na
`clean-text-change.diff`, obie z `error_max_turns` przy `maxTurns: 2`. To nie jest regresja
promptu: `callFingerprint` w zapisanym dowodzie to `59ee111b…`, czyli kotwica z planu co do bajtu.
Sygnał jest o MACIERZY, nie o zapadce — dokładnie ten przypadek, dla którego kryterium 3.6
kazało się zatrzymać.

`agents/review/evals/eval-record.json` **zostaje w drzewie**: jest uczciwym pomiarem, tylko nie
tym, którego plan oczekiwał. Blok `verdictConfig` nie został dopisany (krok 3 fazy nie doszedł).

Pełny rachunek, obie połowy dokumentacji i propozycja podziału:
`context/changes/review-eval-gate/verification.md`.

### Dlaczego nie poszliśmy dalej

- **Podniesienie `maxTurns` 2 → 3 to ZGADYWANIE, zapisane jako takie.** Open Risk 4 poprzedniej
  zmiany: dopóki nie wiadomo, co te liczniki liczą, żadna nowa wartość nie jest wyborem, tylko
  zgadywaniem. Nadal nie wiemy, dlaczego haiku raportuje `numTurns: 3` przy `maxTurns: 2`
  i kończy sukcesem, a dziś na tej samej wartości oblewa.
- **`maxTurns` to oś 4 odcisku ORAZ parametr wywołania recenzenta produkcyjnego.** Podniesienie
  go zmienia zachowanie agenta na KAŻDYM PR-ze — zmiana produkcyjna przemycona do zmiany
  o bramce, czyli złamanie dyscypliny zakresu z naszego własnego zestawu review.
- **Zmiękczenie D-6 odrzucone TERAZ i z tego powodu**, nie na zawsze: pytanie „czy zapadka ma
  pilnować, że ZMIERZYŁEŚ, czy że WYSZŁO DOBRZE” jest realne, ale pojawia się dokładnie wtedy,
  gdy jego rozstrzygnięcie nas odblokowuje. Ma je rozstrzygnąć osobna sesja, na argumentach.

### Zmierzone fakty do zabrania do re-planu

1. **Granica `maxTurns: 2` jest własnością FIKSTURY, nie gemini.** Dotąd oblewało tylko gemini;
   haiku przeszło tę fiksturę na zimno raz na dwie próby, a w fazie 7 weszło wyłącznie jako
   TRAFIENIE cache'u. Dziś, na zimno, oblewają OBA tanie modele.
2. **Realny wydatek 0,235012 USD wobec kotwicy 0,12 — 2×.** Wypalona komórka PŁACI, a licznika
   nie oddaje, więc nie ma jej w żadnej sumie raportu; widać ją tylko w różnicy odczytów
   `/api/v1/key`. Reguła na przyszłość: przy niepewnym `maxTurns` prognoza liczona z komórek
   udanych jest zaniżona o krotność, nie o szum. Zostało ~0,265 USD z 0,50.
