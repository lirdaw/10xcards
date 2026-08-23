<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Zestaw evali (promptfoo) dla agenta code review

- **Plan**: `context/changes/code-review-evals/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-23
- **Verdict**: REVISE → SOUND po triage (8/8 findings naprawionych w planie)
- **Findings**: 3 critical, 3 warnings, 2 observations

## Verdicts

| Dimension             | Verdict (review) | Po triage                        |
| --------------------- | ---------------- | -------------------------------- |
| End-State Alignment   | PASS             | PASS                             |
| Lean Execution        | PASS             | PASS                             |
| Architectural Fitness | WARNING          | PASS — F2 naprawione             |
| Blind Spots           | FAIL             | PASS — F1, F3, F7 naprawione     |
| Plan Completeness     | WARNING          | PASS — F4, F5, F6, F8 naprawione |

## Grounding

10/10 ścieżek ✓ (nowe pliki poprawnie nieobecne: `agents/review/tsconfig.json`, `agents/review/evals/`);
6/7 symboli ✓ — `wrapDiff` jest w `prompt.ts:299`, nie `:272` (plan cytuje tę linię 3×: Key
Discoveries, Faza 2 §1, References `prompt.ts:270-272`); `contract-surfaces.md` nie istnieje —
kontrola pominięta; brief↔plan ✓ (fazy, decyzje, zakres zgodne).

Zweryfikowane bezpośrednio: `review.ts` ma 288 linii (plan mówi 289); kolejność efektów
cap → `model=` → klucz → env → stdin potwierdzona; `tsconfig.json:4` wyklucza `agents`,
`eslint.config.js:130` ignoruje `agents/**` (czyli sonda z fazy 3 przejdzie zwykłym gitem);
numeracja kryteriów 7 `swallowedError` / 8 `gateIntegrity` / 9 `scopeDiscipline` ✓;
`review-schema.ts:188` „nigdy nie zwracaj tu null" ✓; `SCORE_THRESHOLD = 5` poza promptem ✓.

## Findings

### F1 — Siatka z fazy 1 nie pokrywa szwu, który przenosi faza 2

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — stawka architektoniczna; przemyśl, zanim zdecydujesz
- **Dimension**: Blind Spots
- **Location**: Faza 1 (cztery przypadki) ↔ Faza 2 §1 („`reportFailureKind` zostaje po stronie wrappera")
- **Detail**: Wszystkie cztery przypadki fazy 1 kończą się PRZED wywołaniem modelu, więc żaden nie
  dotyka ścieżki awarii — a to ją faza 2 przestawia. `reportFailureKind` jest dziś wołane WEWNĄTRZ
  `review()` (`review.ts:244`, `:273`), czyli wewnątrz funkcji do wydzielenia. Ścieżka jest podwójnie
  kontraktowa: `failure-kind` jedzie do komentarza PR-a (`action.yml:70,77` → `pr-review.yml:453,558`),
  a treść stderr też — `pr-review.yml:529` wycina powód przez `grep -m1 -E '^[A-Za-z]*Error:'`, a ta
  linia istnieje WYŁĄCZNIE dlatego, że `review.ts:288` nie ma try/catch (rzut → unhandled rejection →
  Node drukuje `Error: [budget] …` nad stackiem; zmierzone na przebiegu 32534464639, komentarz
  w `pr-review.yml`). Wrapper łapiący rzut i drukujący `console.error(err.message)` kasuje prefiks
  `Error:` — ekstrakcja spada do gałęzi opisanej jako „Nothing was thrown". Kontrakt fazy 2 mówi
  „żadna linia stderr ani stdout nie zmienia się o bajt"; nic w planie by tego nie zauważyło.
- **Fix A ⭐ Recommended**: NIE przenosić `reportFailureKind` — zostaje w `runReview`
  - Strength: `reportFailureKind` (`:124-126`) sam sprawdza `GITHUB_OUTPUT` i jest no-opem, gdy
    zmiennej nie ma — w evalu nie robi nic. Szew znika zamiast być testowany; linia `Error:` i
    `failure-kind=` zachowane przez konstrukcję. Znika też potrzeba wyciągania `FailureKind` z treści
    komunikatu — bramka na TREŚCI, klasa z `lessons.md:194-199`.
  - Tradeoff: `runReview` zachowuje jeden efekt uboczny na `$GITHUB_OUTPUT`.
  - Confidence: HIGH — sprawdzone w pliku: funkcja jest już warunkowa i cicha.
  - Blind spot: Brak.
- **Fix B**: Dołożyć do fazy 1 piąty przypadek na ścieżce awarii
  - Strength: `REVIEW_MODEL` = nieistniejące id (wzorzec już używany w repo jako „dowód czerwieni")
    → `[provider]`. Asercje: `failure-kind=provider` w `$GITHUB_OUTPUT` i linia stderr pasująca do
    `^[A-Za-z]*Error:` — dokładnie tego regexa, którego używa `pr-review.yml:529`.
  - Tradeoff: Wymaga tokenu, więc nie pojedzie w `agents-gate.yml` — przypadek opt-in, lokalny.
  - Confidence: MED — odmowa dostawcy przy złym id powinna być darmowa, ale niezmierzone tutaj.
  - Blind spot: Czy OpenRouter odrzuca nieznane id przed naliczeniem czegokolwiek.
- **Decision**: Fixed via Fix A (`reportFailureKind` zostaje w `runReview`; wrapper bez try/catch; `run-review.test.ts` pinuje `[kind]` + `failure-kind=`)

### F2 — `ANTHROPIC_*`: plan każe trzymać w jednym miejscu i jednocześnie zduplikować

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — realny tradeoff; zatrzymaj się i przemyśl
- **Dimension**: Architectural Fitness
- **Location**: „Critical Implementation Details" ↔ Faza 4 §2 (Provider)
- **Detail**: Critical Details: „**`ANTHROPIC_API_KEY = ""` musi zostać w wrapperze i tylko w nim** […]
  Jeśli zestaw evali ustawi te trzy zmienne gdzie indziej […] oba wywołania jadą do INNEGO endpointu
  z INNĄ precedencją poświadczeń: ta sama funkcja, inny dostawca, i nic w wyniku o tym nie mówi."
  Faza 4: „Provider ustawia `ANTHROPIC_*` wyłącznie tak, jak robi to wrapper CLI, i w tym samym
  miejscu w kolejności." To dokładnie ten scenariusz — druga kopia trzech przypisań
  (`review.ts:189-194`), której rozjazd jest z definicji cichy. Implementer musi tę sprzeczność
  rozstrzygnąć sam, a łatwiejszy wybór (skopiować do providera) jest tym gorszym.
- **Fix ⭐**: Przenieść trzy przypisania `ANTHROPIC_*` do `runReview`, nie do wrappera
  - Strength: Jedna kopia; oba wywołania (CI i eval) dostają identyczny routing przez konstrukcję.
    Wrapper zachowuje tylko bramkę klucza, czyli komunikat dla CZŁOWIEKA (`:174-186`). Zmiana
    kolejności (env po druku `[konfiguracja]`) jest nieobserwowalna — żadna z tych wartości nie jest
    nigdzie drukowana.
  - Tradeoff: `runReview` czyta env zamiast dostać token argumentem.
  - Confidence: HIGH — `review.ts:188-194` to trzy bezwarunkowe przypisania bez wyjścia obserwowalnego.
  - Blind spot: Brak.
- **Decision**: Fixed (trzy przypisania `ANTHROPIC_*` przeniesione do `runReview`; provider ich nie ustawia)

### F3 — Dwie z trzech rodzin asercji TWARDYCH są tautologiami

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — realny tradeoff; zatrzymaj się i przemyśl
- **Dimension**: Blind Spots
- **Location**: Faza 5 §4 (Asercje dwupoziomowe)
- **Detail**: Plan wymienia trzy rodziny twarde: (a) komplet 20 pól kontraktu, (b) `verdict` zgodny
  z oczekiwanym, (c) kryteria 7 i 8 typu `number | null`. (a) i (c) nie mogą zaświecić na czerwono:
  `runReview` zwraca wynik WYŁĄCZNIE po udanym `REVIEW_SCHEMA.safeParse`, inaczej rzuca `[contract]`
  (`review.ts:242-246`), a schemat (`review-schema.ts:214-235`) wymaga wszystkich 20 pól — zero
  `.optional()`, zero `.passthrough()` w całym pliku, kryteria warunkowe to `z.number().nullable()`.
  To ta sama pułapka, którą plan sam nazywa cztery akapity wyżej („`is-json` […] jest TAUTOLOGIĄ").
  Zostaje jedna realnie bramkująca asercja: `verdict`. Kryterium 5.3 sprawdza tylko kierunek zielony,
  więc tego nie ujawni. `lessons.md:196`: „bramka, która nie potrafi zaświecić na czerwono, jest
  gorsza niż jej brak, bo zdejmuje czujność".
- **Fix A ⭐ Recommended**: Przesunąć bramkę na to, czego `safeParse` NIE gwarantuje
  - Strength: Asercje z realnym kierunkiem czerwonym: zakres ocen 1..10 (`SCORE_MIN`/`SCORE_MAX`) —
    schemat go NIE wymusza, `review-schema.ts:211-213` mówi wprost, że structured output odrzuca
    `minimum`/`maximum`, więc zakres trzyma sam OPIS pola; `scopeDiscipline !== null` na obu
    fiksturach; niepuste uzasadnienia; a dla slotu 1 — `swallowedError` liczbą przy
    `gateIntegrity === null`, czyli para, którą naprawiał `0d3eba5`.
  - Tradeoff: Trzeba przejrzeć trzy zestawy z Pomiaru II, by potwierdzić, że przechodzą.
  - Confidence: HIGH — zakres 1-10 nie jest walidowany nigdzie w kodzie.
  - Blind spot: Czy trzy zapisane zestawy trzymają zakres — do sprawdzenia przy pisaniu fazy 5.
- **Fix B**: Zostawić asercje jak są i dodać kontrolę pozytywną do fazy 5
  - Strength: Zgodne z dyscypliną, którą plan już stosuje przy cache'u.
  - Tradeoff: Probe pokaże, że tautologii nie da się zmutować w czerwień bez mutowania `safeParse` —
    koszt bez wyniku.
  - Confidence: MED — potwierdzi diagnozę, nie naprawi bramki.
  - Blind spot: Brak.
- **Decision**: Fixed via Fix A + kontrola pozytywna z Fix B (asercje na zakres 1..10, `scopeDiscipline !== null`, niepuste uzasadnienia, para 7/8 dla slotu 1; `assertions.test.ts` = jedna mutacja na asercję)

### F4 — Kontrakt providera milczy o tym, co zwrócić, gdy `runReview` rzuca

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff; zatrzymaj się i przemyśl
- **Dimension**: Plan Completeness
- **Location**: Faza 4 §2 (Provider)
- **Detail**: Kontrakt `callApi` wymienia `{ output, tokenUsage, cost, cached, metadata }` i nic
  o ścieżce awarii. `runReview` rzuca przy czterech klasach, z czego `[contract]` to bezpośrednio
  jedno z dwóch pytań, na które zestaw ma odpowiadać. Jeśli rzut ucieknie z `callApi`, promptfoo
  oznaczy komórkę jako błąd providera i asercje w ogóle się nie wykonają — regresja kontraktu wyjścia
  wygląda wtedy jak awaria infrastruktury. Faza 6 ma kryterium „`safeParse` przeszedł w obu (brak
  rzutu `[contract]`)", którego nie da się odczytać z raportu bez tej decyzji.
- **Fix**: Dopisać do kontraktu providera: rzut jest łapany, `FailureKind` (albo prefiks komunikatu)
  ląduje w `metadata`, promptfoo dostaje `{ error }` — komórka czerwona z NAZWANĄ klasą, a nie pusta.
  Domknąć asercją twardą „brak `error`", która ma realny kierunek czerwony.
- **Decision**: Fixed (provider łapie rzut → `metadata` + `{ error }`; asercja twarda „brak `error`")

### F5 — Para dowodowa fazy 3 celuje w katalog, który powstaje dopiero w fazie 4

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Plan Completeness
- **Location**: Faza 3, Manual Verification (Progress 3.4)
- **Detail**: „commit z celowym błędem typów wyłącznie w `agents/review/evals/`" — ale ten katalog nie
  istnieje przed fazą 4 (zweryfikowane `ls`). Kryterium 3.4 jest w fazie 3 niewykonalne bez wciągnięcia
  kawałka fazy 4.
- **Fix**: Sonda w fazie 3 ląduje w pliku, który już istnieje (np. tymczasowy `agents/review/probe.ts`,
  usuwany poprawką) — filtr `paths` (`agents/**`) i tak ją złapie. Albo przesunąć 3.4 do fazy 4, gdzie
  kryterium 4.4 już czeka.
- **Decision**: Fixed (sonda w tymczasowym `agents/review/probe.ts`; zasięg na `evals/` potwierdza 4.4)

### F6 — Progress rozjeżdża się z tytułami faz 6 i 7; brak pozycji 2.6

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Plan Completeness
- **Location**: `## Progress`
- **Detail**: Tytuły dopasowywane są DOKŁADNIE, a dwa się nie zgadzają: `## Phase 6: Pomiar kontroli
negatywnej (~0,12 USD)` ↔ `### Phase 6: Pomiar kontroli negatywnej`; `## Phase 7: Pierwsze pełne
przejście macierzy 2×2 (~0,12 USD)` ↔ `### Phase 7: Pierwsze pełne przejście macierzy 2×2`. Do tego
  faza 2 ma dwie pozycje w Manual Verification, a Progress tylko jedną (2.5).
- **Fix**: Usunąć sufiksy `(~0,12 USD)` z nagłówków `## Phase 6/7` (kwoty są w Overview obu faz),
  a drugą pozycję manualną fazy 2 dopisać jako 2.6 albo wykreślić z Success Criteria (opisuje, czego
  NIE robimy, więc nie jest kryterium).
- **Decision**: Fixed (sufiksy `(~0,12 USD)` usunięte z Phase 6/7; bullet „ręczny przebieg" przeniesiony do Implementation Note; 7/7 faz zgodnych mechanicznie)

### F7 — Nie powiedziano, że pomiar fazy 6 ma jechać przez providera

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Blind Spots
- **Location**: Faza 6 §1 ↔ Faza 7 §1
- **Detail**: Faza 7 stoi na „dwie komórki kontroli negatywnej wchodzą jako TRAFIENIA cache'u z fazy 6".
  Ale faza 6 mówi „zapis w formacie Pomiaru II, z linią metryk" — Pomiar II był bezpośrednim wywołaniem
  CLI, a linię `[metryki]` drukuje wrapper CLI; przez providera metryki wracają jako DANE. Odczytanie
  tego jako „powtórz Pomiar II" zostawia cache pusty i faza 7 płaci ~0,12 USD ponad plan.
- **Fix**: Dopisać w fazie 6: przebiegi idą przez `npm --prefix agents/review run eval` (jedna
  fikstura), nie przez CLI; „linię metryk" zastąpić wierszem raportu z fazy 5.
- **Decision**: Fixed (faza 6 jedzie przez `npm run eval`, nie CLI; wiersz raportu zamiast linii `[metryki]`)

### F8 — Przypadek 4 fazy 1 nie mówi, że `GITHUB_OUTPUT` musi być ustawiony

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Plan Completeness
- **Location**: Faza 1 §1, przypadek „`REVIEW_MODEL` ze znakiem nowej linii"
- **Detail**: Odmowa przy nowej linii siedzi WEWNĄTRZ `if (githubOutput)` (`review.ts:138-145`). Bez
  ustawionego `GITHUB_OUTPUT` proces idzie dalej i kończy exit 1 z komunikatem o PUSTYM DIFFIE — ten
  sam kod wyjścia, inna linia. Test napisany bez tej przesłanki przechodzi z niewłaściwego powodu.
- **Fix**: Dopisać „przy ustawionym `GITHUB_OUTPUT`" i asertować `$GITHUB_OUTPUT` PUSTY (odmowa przed
  zapisem `model=`), tak jak w przypadku 2.
- **Decision**: Fixed (przypadek 4 wymaga ustawionego `GITHUB_OUTPUT` i asertuje go PUSTY)
