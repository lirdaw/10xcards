<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Bramka regresji na zmianach promptu agenta review

- **Plan**: `context/changes/review-eval-gate/plan.md`
- **Scope**: wszystkie fazy (1, 2, 3a, 3, 4, 5) — pełny przegląd planu
- **Date**: 2026-08-23 (triaż domknięty 2026-08-24)
- **Verdict**: NEEDS ATTENTION → **po triażu: APPROVED** (8 z 10 findingów naprawionych, 1 SKIPPED
  świadomie jako Open Risk 7, 1 DEFERRED do `/ship` z przestemplowanym kryterium)
- **Findings**: 0 critical, 4 warnings, 6 observations
- **Diff range**: `69d4b1c..HEAD` (23 pliki, +4808 / −171) + poprawki triażu (nieskomitowane)

## Stan po triażu

| finding | decyzja  | gdzie wylądowało                                                                     |
| ------- | -------- | ------------------------------------------------------------------------------------ |
| F1      | FIXED    | `eval-record.ts` (stała przemianowana + zakres w remedium), `AGENTS.md`              |
| F2      | FIXED    | sekcja (F) w `eval-record.test.ts`, `recordedVerdictConfig` w rdzeniu + testy vitest |
| F3      | FIXED    | `verification.md` (korekta z datą), komentarz sekcji (D)                             |
| F4      | FIXED    | znacznik `[przeniesione z przejścia …]` + warunkowy `::notice`, sekcja (G)           |
| F5      | FIXED    | `eval-ratchet.yml` (`--ignore-scripts`)                                              |
| F6      | SKIPPED  | **Open Risk 7** w `plan.md`, z nazwanym warunkiem domknięcia                         |
| F7      | FIXED    | `check-eval-record.ts` (martwa dyrektywa usunięta)                                   |
| F8      | FIXED    | `plan.md` §Progress (dziesięć sha)                                                   |
| F9      | DEFERRED | `plan.md` — 5.8 przestemplowane na `[ ]`, plan `/ship` w czterech krokach            |
| F10     | FIXED    | `report.ts` (`splitArgs` + `narrowingArgs`), sekcja (H)                              |

**Bramki po komplecie poprawek:** 118/118 (node:test, +17 wobec wejścia), 35/35 (vitest, +10),
lint 0 błędów, typecheck root (180 plików) + agent, `prettier --check` czysty, oba checkery kod 0,
`check-prompt-sources.ts` kod 0. Zapadka na dzisiejszym rekordzie **milczy o świeżości prozy** —
czyli nowy warunek z F4 działa w obie strony także na żywych danych.

⚡ **Trzy reguły do `lessons.md` przy domykaniu zmiany** (użytkownik polecił zapisać je na listę,
nie teraz):

1. „Liczba czytana w chwili decyzji musi być tą wielkością, o którą decyzja pyta. Dwie wielkości
   pod jedną nazwą znajdą się w komunikacie w najgorszym możliwym momencie." (F1)
2. „Jednorazowa obserwacja czerwieni nie jest kontrolą pozytywną. Zaświeci się raz, przy następnej
   refaktoryzacji już nie." (F2)
3. „Proza przenoszona przez zapis potrzebuje własnego warunku nieświeżości. Adnotacja, która
   ostrzega o własnej nieświeżości, zestarzeje się pierwsza." (F4)

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Co zweryfikowano wykonaniem, nie odczytaniem

Wszystkie kryteria automatyczne przejechane w tej sesji, na czystym drzewie:

| sprawdzenie                                                 | wynik                                              |
| ----------------------------------------------------------- | -------------------------------------------------- |
| `npx prettier --check agents/review/evals/eval-record.json` | kod 0                                              |
| `scripts/check-verdict-config.ts`                           | kod 0, 4 pola OK                                   |
| `agents/review/evals/check-eval-record.ts`                  | kod 0, jedna adnotacja `::notice` klasy (A)        |
| `npm --prefix agents/review test`                           | 101/101                                            |
| `npx vitest run tests/lib/verdict-config.test.ts`           | 25/25                                              |
| `npm run typecheck`                                         | 0 błędów, 180 plików                               |
| `npm --prefix agents/review run typecheck`                  | kod 0                                              |
| `npm run lint`                                              | 0 błędów (3 warningi w pliku spoza zakresu zmiany) |
| `scripts/check-prompt-sources.ts`                           | kod 0 — §Commands nie jest sekcją pilnowaną        |

**Kryterium 4.4 odtworzone niezależnie** na KOPII drzewa (`git archive`, junction na `node_modules`),
żeby nie ruszać drzewa roboczego: podmieniony `callFingerprint` → kod 1 z oboma odciskami; usunięty
dowód → kod 1 „Brak dowodu przejścia evali"; `threshold` 5→8 w rekordzie → kod 1 z cytatem `8 → 5`.
Drzewo robocze po pomiarze czyste.

**Kryteria fazy 5 potwierdzone z GitHuba, nie z `verification.md`:** `Eval ratchet` na gałęzi —
`3b905af` (P1) **failure** → `1b2c9ed` (rewert) **success** → `bef7696` (P2) **failure** →
`ea93869` (rewert) **success** → `5d7c5ad` **success**. Dwustronna kontrola pozytywna faktycznie się
odbyła na ścieżce, na której zapadka żyje. `PR code review` w API: **`active`** (kryterium 5.7).
`git diff 2b6835d..ea93869` na `agents/ scripts/ .github/` — **pusty**, więc rewerty są czyste co do
bajtu. Zero `--no-verify` w historii; `core.hooksPath = .husky/_`.

**Gałęzie czerwieni bez testu — sprawdzone bezpośrednio, DZIAŁAJĄ.** `eval-record.ts` nie ma ani
jednego importu, więc `checkRecord` da się zawołać punktowo: macierz obcięta do 3 wierszy →
`matrixIncomplete`; macierz z jednego modelu → `matrixIncomplete`; ten sam obiekt z wcięciem 4 spacji
albo bez końcowej nowej linii → `reformatted`. To odróżnia „nie ma testu" (F2) od „nie działa" —
drugiego nie ma.

## Findings

### F1 — Kotwica kosztu drukowana w CI jest 2× niższa od zmierzonej i sprzeczna z AGENTS.md

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: `agents/review/evals/eval-record.ts:47`
- **Detail**: `COLD_PASS_COST_ANCHOR_USD = 0.12` wchodzi do `PAID_REMEDY` (`:701-706`), czyli do
  komunikatu, który człowiek czyta w logu CI dokładnie w chwili, gdy decyduje, czy zapłacić:
  „kotwica zimnego przejścia 2x2 to ~0.12 USD". Tymczasem `AGENTS.md:36` — dopisane w TEJ SAMEJ
  zmianie — mówi „~0.24 USD for a cold pass", a `verification.md` zapisuje dwa realne przejścia:
  **0,235012** i **0,139255 USD**. Liczba 0,12 pochodzi z fazy 7 poprzedniej zmiany (0,118529) i
  została przez tę zmianę zmierzona jako zaniżona — `verification.md` §Fakt 2 nazywa powód
  (wypalona komórka PŁACI i nie oddaje licznika, więc nie wchodzi do sumy raportu). Dwie powierzchnie
  tego samego repo podają dwie liczby dla tej samej komendy, a niższa stoi w miejscu, w którym się
  podejmuje decyzję. Znalezione niezależnie przez oba podagenty.
- **Fix**: Podnieś stałą do zmierzonej wartości (`0.24`) albo przemianuj ją tak, żeby było jasne, że
  to kotwica SUMY Z RAPORTU, a nie rachunku z `/api/v1/key` — i dopisz jedno zdanie o różnicy.
- **Decision**: FIXED — wykonane OBIE połowy naraz, na wskazanie użytkownika, że przyczyną nie jest zła
  wartość, tylko JEDNA NAZWA NA DWIE WIELKOŚCI (suma z raportu vs. rachunek z `/api/v1/key`;
  różnią się o komórki, które zapłaciły i nie oddały licznika). Wykonane:
  (1) stała przemianowana na `COLD_PASS_BILLED_COST_ANCHOR_USD` z komentarzem nazywającym, KTÓRA
  to wielkość; (2) wartość = **wyższa** ze zmierzonych, nie średnia — przy decyzji o wydatku
  niedoszacowanie kosztuje więcej niż przeszacowanie; (3) remedium cytuje **ZAKRES**
  (`0.139255 i 0.235012 USD`), nie punkt — bo pojedyncza liczba łamałaby doktrynę `oneMeasurement`
  z rekordu, którego ta bramka pilnuje; (4) `AGENTS.md:35` zsynchronizowane z wartością i zakresem.
  Weryfikacja: 101/101, typecheck (root + agent), `prettier --check`, oba checkery kod 0,
  `check-prompt-sources.ts` kod 0 (§Commands nie jest sekcją pilnowaną).
  ⚡ Reguła do `lessons.md` **przy domykaniu zmiany, nie teraz**: „Liczba czytana w chwili decyzji
  musi być tą wielkością, o którą decyzja pyta. Dwie wielkości pod jedną nazwą znajdą się
  w komunikacie w najgorszym możliwym momencie."

### F2 — Pięć z dziewięciu gałęzi czerwieni rdzenia zapadki nie ma żadnego testu

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny kompromis; warto się zatrzymać i przemyśleć
- **Dimension**: Safety & Quality
- **Location**: `agents/review/evals/eval-record.test.ts`, `tests/lib/verdict-config.test.ts`
- **Detail**: `eval-record.ts` definiuje dziewięć rodzajów problemu (`missing` `:604`, `malformed`
  `:475`, `callFingerprint` `:619`, `matrixIncomplete` `:560`, `cellRed` `:639`, `cellNotRun` `:649`,
  `cellUnclassified` `:657`, `deliveryRegression` `:676`, `reformatted` `:688`). Testy asertują
  `.kind` w pięciu miejscach i pokrywają **cztery**: `cellUnclassified`, `cellRed`, `cellNotRun`,
  `deliveryRegression`. Bez żadnego testu zostają `missing`, `malformed`, `callFingerprint`,
  `matrixIncomplete`, `reformatted`. Po stronie `scripts/` to samo dla `MISSING_RECORD` i
  `MISSING_BLOCK` w `check-verdict-config.ts`. Plan wymieniał w kontrakcie fazy 4 cztery osie
  (`plan.md:948`): `callFingerprint`, kompletność macierzy, `ok: false`, round-trip — pokryta jest
  **jedna** (`ok: false`, D5). To jest dokładnie ta klasa, przed którą ostrzega przyjęta reguła
  `lessons.md:194` („bramka, która nie potrafi zaświecić na czerwono, jest gorsza niż jej brak").
  Łagodzące, i to mocno: trzy z tych pięciu były widziane na czerwono realnie —
  `callFingerprint` na żywym CI (sonda P1), `missing` w weryfikacji ręcznej 4.8, `malformed` na
  poprzednim rekordzie (`verification.md:805`) — a `matrixIncomplete` i `reformatted` odpaliłem w tym
  review. Żadna z tych czerwieni nie jest jednak **powtarzalna**: to sześć jednorazowych obserwacji,
  a nie sześć asercji, które zaświecą się przy następnej refaktoryzacji `checkRecord`.
- **Fix A ⭐ Recommended**: Dopisz po jednym teście na każdy nieprzykryty rodzaj problemu —
  `checkRecord` jest czystą funkcją bez importów, a fikstury (`recordWith`, `withCell`, `FOUR_CELLS`)
  już stoją, więc każdy przypadek to 3–4 linie.
  - Strength: Domyka dokładnie tę lukę, o której mówi `lessons.md:194`, i robi to w mechanice, którą
    plik już ma — zero nowej infrastruktury.
  - Tradeoff: Siedem nowych testów; asercje na wejście, nie na ślepotę funkcji (patrz F3).
  - Confidence: HIGH — sam odpaliłem dwie z tych gałęzi punktowo, więc wiem, że kontrakt jest
    stabilny i test da się napisać bez zgadywania.
  - Blind spot: Nie sprawdziłem, czy `cellShapeError` ma gałęzie, których nie da się osiągnąć przez
    `serializeRecord` — jeśli ma, część z nich będzie wymagała surowego JSON-a zamiast fikstury.
- **Fix B**: Wprowadź literalny wzorzec `blindTo` z `cache.test.ts:92-104` — wariant `checkRecord`
  ślepy na oś X — i przepuść przez niego wszystkie dziewięć osi.
  - Strength: Realizuje kontrakt planu co do litery i odpowiada na mocniejsze pytanie („czy gdyby
    checker przestał patrzeć na oś X, coś by się zaczerwieniło"), a nie tylko „czy defekt X czerwieni".
  - Tradeoff: Wymaga wystawienia mutowalnego szwu w module, który dziś jest szczelnie czysty —
    czyli zmiany produkcyjnego kodu na potrzeby testu.
  - Confidence: MEDIUM — wzorzec działa w `cache.ts`, bo odcisk liczy się z JAWNYCH `parts`;
    `checkRecord` nie ma analogicznego punktu wstrzyknięcia i trzeba by go dorobić.
  - Blind spot: Nie policzyłem, ile z dziewięciu osi da się wyrazić jako „ślepota", a ile jest
    sekwencyjna (`parseRecord` przerywa przed resztą, `plan.md` opisuje to jako zamierzone).
- **Decision**: FIXED via **Fix A** — i to NIE jako „tańsze zamiast lepszego". Użytkownik rozstrzygnął,
  że tutaj Fix A jest **dokładnie tak mocny** jak Fix B: wzorzec `blindTo` istnieje
  w `cache.test.ts`, bo tam wyjściem jest HASH — po zmienionym odcisku nie da się powiedzieć, KTÓRA
  oś go ruszyła, więc oślepienie funkcji jest jedyną drogą do przypisania skutku osi. Tutaj wyjściem
  jest `problems[].kind`, czyli NAZWA osi — gdyby checker przestał czytać oś X, nie byłoby żadnego
  problemu i test padłby na `length`. Blindness-testing zarabia na siebie przy wyjściu
  NIEPRZEZROCZYSTYM; przy wyjściu, które samo się nazywa, dokłada szew w module produkcyjnym i nie
  kupuje nowej informacji. **Fix B odrzucony z uzasadnienia, nie z braku zasobów** — powód zapisany
  w nagłówku sekcji (F) w `eval-record.test.ts` i w `verification.md`, żeby nie czytało się to za
  miesiąc jako pójście na skróty.

  Dopisane — strona agencka, sekcja (F) w `eval-record.test.ts`: F1 `missing`, F2 `callFingerprint`
  (z asercją na OBA odciski w komunikacie), F3 macierz obcięta, F4 macierz jednomodelowa (iloczyn
  się zgadza, a dowodem to nie jest), F5 `reformatted` × 2, F6 rekord sprzed D-6 × 2,
  F7 `malformed` × 4. Strona `scripts/`: cztery warianty `missingRecord` i cztery `missingBlock`,
  plus asercja, że oba stany mają RÓŻNY komunikat — bo różnią się CENĄ remedium (brak pliku →
  płatne, brak bloku → darmowe).

  ⚡ **Jeden refaktor produkcyjny był konieczny i jest zgodny z wzorcem repo, nie wbrew niemu.**
  `MISSING_RECORD`/`MISSING_BLOCK` i decyzja między nimi siedziały w RUNNERZE
  (`scripts/check-verdict-config.ts`), który wykonuje `main()` w module scope — więc nie dało się
  ich dotknąć testem i **to jest cała diagnoza, dlaczego nie były testowane**. Przeniesione do
  rdzenia jako `recordedVerdictConfig(parsed: unknown)`; `fs` został w runnerze. Przy okazji
  poprawiony realny defekt komunikatu: tytuł adnotacji był JEDEN na oba stany („Brak bloku
  verdictConfig w dowodzie" także nad brakującym PLIKIEM), czyli wysyłał po darmową komendę tam,
  gdzie remedium jest płatne. Zweryfikowane wykonaniem na kopii drzewa — oba stany dają kod 1
  z własnym tytułem.

  ⚡ **Mój blind spot rozstrzygnięty, tak jak użytkownik kazał.** Przebadałem każdą gałąź
  `cellShapeError` empirycznie (13 przypadków przez `serializeRecord` + `JSON.parse`): **wszystkie
  są osiągalne, kategoria (c) — MARTWA GAŁĄŹ — jest PUSTA**, więc nie ma tu osobnego znaleziska.
  Dwie z nich (`subtype`/`terminalReason` „nie istnieje") są osiągalne bez żadnego rzutowania, bo
  `JSON.stringify` kasuje klucze o wartości `undefined` — czyli dokładnie tak, jak powstałby rekord
  sprzed D-6; to jest test F6.

  Weryfikacja: **108/108** (node:test), **35/35** (vitest), lint 0 błędów, typecheck root + agent,
  `prettier --check`, oba checkery kod 0.
  ⚡ Reguła do `lessons.md` **przy domykaniu zmiany**: „Jednorazowa obserwacja czerwieni nie jest
  kontrolą pozytywną. Zaświeci się raz, przy następnej refaktoryzacji już nie."

### F3 — `verification.md` twierdzi „wzorzec `blindTo`", a testy mutują WEJŚCIE, nie funkcję decydującą

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Plan Adherence
- **Location**: `context/changes/review-eval-gate/verification.md:569`, `agents/review/evals/eval-record.test.ts:261,296`
- **Detail**: Kontrakt fazy 4 (`plan.md:950`) mówi wprost: „mutowana jest FUNKCJA decydująca, nie
  wejście". Implementacja mutuje wejście — `withCell(patch)` podmienia jedną komórkę macierzy
  (`:294-297`), a komentarz nad sekcją (D) deklaruje „Wzorzec `blindTo` z `cache.test.ts:92-104`"
  (`:261`). `verification.md:569` powtarza to jako fakt: „czternaście nowych przypadków testowych,
  każdy dwustronny (wzorzec `blindTo`)". Same testy są dobre — asertują `problems.length === 1` plus
  konkretny `.kind`, więc niosą obie połowy („czerwieni swój przypadek" i „nie czerwieni cudzego") —
  ale to jest test tabelaryczny, nie kontrola ślepoty. Różnica jest realna: mutacja wejścia nie
  odpowiada na pytanie, czy oś w ogóle jest jeszcze czytana. Zapis, który nazywa słabszy dowód
  mocniejszym, jest tym samym kształtem, który ta zmiana tropi u innych.
- **Fix**: Popraw zdanie w `verification.md` (i komentarz w `:261`) na to, co kod robi — „każdy
  przypadek dwustronny: mutacja wejścia czerwieni DOKŁADNIE swój rodzaj problemu i tylko jego" — bez
  przywoływania `blindTo`, chyba że zostanie przyjęty Fix B z F2.
- **Decision**: FIXED — **jedna poprawka z F2, nie dwie** (wskazanie użytkownika). Poprawione OBA
  miejsca: akapit w `verification.md` i komentarz nad sekcją (D) w `eval-record.test.ts`. Zapis
  nie został nadpisany, tylko **skorygowany z datą i powodem** — razem z rozstrzygnięciem, dlaczego
  `blindTo` tutaj nie zarabia na siebie, żeby korekta nie czytała się jako rezygnacja.

### F4 — Blok `notes` przeżywa każde przejście nietknięty, a zapadka sprawdza tylko obecność pól

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny kompromis; warto się zatrzymać i przemyśleć
- **Dimension**: Safety & Quality
- **Location**: `agents/review/evals/eval-record.ts:414-417` (`buildRecord`), `:513-520` (`parseRecord`)
- **Detail**: `--record` z założenia zachowuje zastany blok `notes`, a walidacja sprawdza wyłącznie,
  czy pięć pól z `NOTES_KEYS` jest niepustymi stringami. Treść nie jest z niczym porównywana, więc
  adnotacja może opisywać przejście, którego już nie ma w pliku, i bramka będzie zielona.
  **To nie jest ryzyko teoretyczne — już się zmaterializowało w tej zmianie**: klucz `notes.redCells`
  ogłaszał „dwie czerwone komórki", podczas gdy rekord miał jedną, cytował rachunek pierwszego
  przejścia i niósł tezę, którą `change.md` odnotowuje jako zmierzoną i nieprawdziwą. Złapała to
  weryfikacja ręczna kryterium 4.9 — czyli człowiek, jednorazowo, i `verification.md:1066` mówi
  wprost, że to jedyny powód, dla którego usterka nie pojechała na `main`. Remedium było przepisaniem
  klucza na `undeliveredCell`, czyli **szósty klucz `notes`, który tak samo nie jest w `NOTES_KEYS`,
  tak samo nie ma odpowiednika w typie i tak samo przeżyje następne przejście**. Mechanizm został,
  zmieniła się tylko treść, która się zestarzeje.
- **Fix A ⭐ Recommended**: Niech `checkRecord` wypisze `::notice` dla każdego klucza `notes` spoza
  `NOTES_KEYS`, cytując `generatedAt` rekordu — „ta proza została PRZENIESIONA przez przejście
  z `<data>`; sprawdź, czy nadal je opisuje".
  - Strength: Nieblokujące, korzysta z istniejącego kanału obserwacji (klasa (A) już tam pisze), a
    warunek nieświeżości przestaje zależeć od tego, czy ktoś sobie o nim przypomni — dokładnie ta
    zamiana czujności na konfigurację, której żąda `lessons.md:250`.
  - Tradeoff: Adnotacja pojawia się na KAŻDYM przebiegu, dopóki klucz istnieje, więc może się zetrzeć
    do szumu; nie odróżnia prozy świeżej od zestarzałej, tylko przypomina o sprawdzeniu.
  - Confidence: HIGH — kanał `::notice` istnieje i działa (widzę go dziś na komórce gemini),
    a `parseRecord` już iteruje po kluczach `notes`.
  - Blind spot: Nie sprawdziłem, czy `undeliveredCell` ma zostać na stałe, czy jest zapisem
    jednorazowym — jeśli to drugie, tańsze może być jego usunięcie niż pilnowanie.
- **Fix B**: Niech `buildRecord` KASOWAŁ klucze `notes` spoza `NOTES_KEYS` przy zapisie, żeby
  doraźna proza nie mogła przeżyć przejścia, którego nie opisuje.
  - Strength: Zamyka klasę całkowicie, bez polegania na czyimkolwiek odczycie adnotacji.
  - Tradeoff: Kasuje `undeliveredCell` po cichu przy następnym `--record`, i stoi w sprzeczności
    z jawną decyzją projektową „klucze nieznane temu modułowi przeżywają zapis" (test A6,
    `eval-record.test.ts:155`) — tam ta reguła chroni blok `verdictConfig` cudzego zapisywacza.
  - Confidence: MEDIUM — zawężenie kasowania do `notes` (a nie do korzenia rekordu) nie łamie
    granicy kierunkowej, ale wymaga rozdzielenia dwóch reguł, które dziś są jedną.
  - Blind spot: Nie prześledziłem, czy `withVerdictConfig` po stronie `scripts/` też przenosi
    nieznane klucze `notes` — jeśli tak, kasowanie po jednej stronie da wahadło.
- **Decision**: FIXED via **Fix A w wersji WARUNKOWEJ** (zmiana wobec zaproponowanej przeze mnie),
  **Fix B odrzucony**. Użytkownik nazwał właściwą oś i to ona jest teraz zapisana w kodzie:
  ryzykowne nie jest to, że klucz jest NIEZNANY, tylko to, że proza opisuje KONKRETNE PRZEJŚCIE.
  Piątka `NOTES_KEYS` to doktryna BEZCZASOWA („koszt komórki to zmienna losowa") i znacznika nie
  dostaje; `undeliveredCell` to obserwacja z jednego przebiegu i starzeje się natychmiast.

  **Fix B odrzucony z powodu, który trafia w MÓJ blind spot**: kasowanie obcych kluczy `notes`
  łamie regułę „nieznane klucze przeżywają" (test A6), a ta reguła chroni blok `verdictConfig`
  CUDZEGO zapisywacza po drugiej stronie granicy kierunkowej. Prześledziłem `withVerdictConfig`,
  czego wcześniej nie zrobiłem: on też przenosi `notes` w całości (`record.notes`), więc
  rozdzielenie reguły na „`notes` wolno kasować, korzenia nie" dałoby wahadło przy pierwszym
  zapisywaczu, który o tym rozdziale nie wie.

  **Adnotacja jest WARUNKOWA, nie stała** — to usuwa wadę, którą sam nazwałem przy Fix A
  („zetrze się do szumu"). Mechanizm: `buildRecord` stempluje przenoszoną doraźną prozę
  prefiksem `[przeniesione z przejścia <generatedAt źródłowego>]`, a `observationsFor` wypisuje
  `::notice` **tylko** gdy stempel wskazuje inne przejście niż `generatedAt` rekordu. Proza
  przepisana razem z przejściem milczy. Znacznik siedzi W TREŚCI, nie w nowym kluczu rekordu
  — dzięki temu `RECORD_KEYS` (literаł ZDUBLOWANY po obu stronach granicy) zostaje nietknięty
  i nie powtarzam dryfu, który ta zmiana już raz złapała przy `previousDelivery`.

  ⚡ **Mój blind spot rozstrzygnięty POMIAREM, nie założeniem.** Pytałem, czy `undeliveredCell`
  ma zostać. **Zostaje** — sprawdziłem każde jego twierdzenie wobec bieżącego rekordu i wszystkie
  są prawdziwe: `generatedAt` się zgadza (`2026-08-23T19:25:09.445Z`), jedna komórka z czterech
  niedowieziona (gemini / `clean-text-change.diff`, `error_max_turns`), haiku na tej samej
  fiksturze DOWIOZŁO, odcisk `59ee111b…`, dwie komórki `sample.diff` z cache'u. Klucz zostaje
  BEZ znacznika i to jest poprawne: nie został przeniesiony, został napisany pod TO przejście.

  Testy — sekcja (G), pięć przypadków: znacznik na przeniesionej prozie, BRAK znacznika na
  piątce obowiązkowej, brak narastania łańcucha prefiksów przy kolejnych przejściach, `::notice`
  na prozie przeniesionej **i milczenie na przeępisanej** (obie strony jednego warunku), kontrola
  zerowa na rekordzie bez doraźnej prozy. Weryfikacja: **113/113**, 35/35, lint 0 błędów,
  typecheck root + agent, `prettier --check`, oba checkery kod 0 i zapadka na dzisiejszym
  rekordzie MILCZY o świeżości — czyli warunek działa w obie strony także na żywych danych.
  ⚡ Reguła do `lessons.md` **przy domykaniu zmiany**: „Proza przenoszona przez zapis potrzebuje
  własnego warunku nieświeżości. Adnotacja, która ostrzega o własnej nieświeżości, zestarzeje
  się pierwsza."

### F5 — `npm ci --omit=dev` w zapadce wykonuje skrypty instalacyjne zależności na każdym PR-ze

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/eval-ratchet.yml:88`
- **Detail**: Krok instaluje z `package.json`/lockfile POBRANEGO PR-a, więc `preinstall`/`postinstall`
  zależności biegną na runnerze. Zasięg jest wąski i to jest powód, dla którego to obserwacja, a nie
  ostrzeżenie: workflow nie ma żadnego sekretu (zweryfikowane — zero `env:`, zero `secrets.`),
  `permissions: contents: read`, wyzwalacz to `pull_request`, nie `pull_request_target`. Zapadka
  potrzebuje tylko `zod` i SDK NA DYSKU, żaden z nich nie wymaga kroku budowania.
- **Fix**: Dopisz `--ignore-scripts` do `npm ci --omit=dev` i potwierdź jednym przebiegiem, że
  checker agencki dalej daje kod 0.
- **Decision**: FIXED — `npm ci --omit=dev --ignore-scripts`, z uzasadnieniem w komentarzu obok kroku.
  **Sprawdzone, że NIC nie wyłącza** (użytkownik słusznie kazał to zrobić przed, nie po CI): prod-graf
  tego pakietu to dokładnie DWA pakiety — `zod` i `@anthropic-ai/claude-agent-sdk` — i żaden nie ma
  `preinstall`/`install`/`postinstall`/`prepare`. Potwierdzone PRZEBIEGIEM na kopii drzewa: świeże
  `npm ci --omit=dev --ignore-scripts`, `promptfoo` i `tsx` nieobecne, checker agencki **kod 0**.

### F6 — Dane z rekordu wchodzą do adnotacji GitHuba bez ucieczki

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: `agents/review/evals/check-eval-record.ts:73,91`
- **Detail**: `` `::notice file=…,title=${observation.title}::${observation.detail}` `` wstawia
  `cell.model`, `cell.fixture` i `subtype` prosto w komendę workflow. Znak nowej linii w tych danych
  urywa komendę, a przecinek trafia w listę parametrów. Konsekwencją jest wyłącznie fałszowanie
  logu/adnotacji — kod wyjścia bierze się z wartości zwróconej przez `main()`, więc bramki to nie
  obchodzi (prześledzone i potwierdzone). Warto odnotować przy okazji, że remedia są WIELOLINIOWE, a
  dymek adnotacji GitHuba kończy się na pierwszej nowej linii — pełna treść jest w logu i to tam
  czytał ją autor. To jest **wzorzec dziedziczony**: `scripts/check-prompt-sources.ts:95` robi
  dokładnie to samo, więc poprawka tylko tutaj rozjedzie trio.
- **Fix**: Jeśli w ogóle — wprowadź wspólny helper kodujący `%0A`/`%0D`/`%2C`/`%3A` i zastosuj go w
  obu checkerach naraz, nigdy w jednym.
- **Decision**: SKIPPED — **świadomie, z zapisanym powodem i warunkiem domknięcia**, nie przeoczone.
  Zapisane jako **Open Risk 7** w `plan.md`. Dwa powody: (a) wzorzec jest DZIEDZICZONY po
  `check-prompt-sources.ts:95`, więc poprawka po jednej stronie rozjechałaby trio — a dotknięcie
  tamtego pliku wychodzi poza tę zmianę, która już raz rozszerzyła zakres i cofnęła to na danych;
  (b) powierzchnia jest DZIŚ PUSTA — `cell.model` i `cell.fixture` pochodzą z `promptfooconfig.yaml`
  i z nazw plików w repo, `subtype` to enum SDK, więc żadne z tych pól nie może dziś nieść nowej
  linii ani przecinka. **Warunek domknięcia (nazwany, nie „kiedyś"):** wspólny helper ucieczki dla
  OBU checkerów, jedną zmianą, w dniu w którym którekolwiek z tych trzech pól zacznie pochodzić
  z danych SPOZA repo.

### F7 — `eslint-disable` w `check-eval-record.ts` jest martwy — ESLint nie widzi `agents/**`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: `agents/review/evals/check-eval-record.ts:1-3`
- **Detail**: `eslint.config.js:130` to `{ ignores: ["src/db/database.types.ts", "agents/**"] }`, więc
  dyrektywa nic nie wyłącza. To JEDYNY plik pod `agents/` z takim komentarzem (sprawdzone gremem po
  całym pakiecie), a siostrzany `agents/review/review.ts` używa `console.*` bez niego. Uzasadnienie
  w komentarzu powołuje się dodatkowo na `tests/lib/no-logging.test.ts`, który skanuje `src/`, czyli
  na inny mechanizm niż wyłączana reguła. To szablon z `scripts/` przeniesiony przez granicę — tam
  jest konieczny, tutaj jest ozdobą, która sugeruje, że lint sięga dalej, niż sięga.
- **Fix**: Usuń dyrektywę, zostaw prozę (albo przepisz ją na zdanie o tym, dlaczego runner pisze na
  stdout/stderr, bez udawania, że coś wyłącza).
- **Decision**: FIXED — dyrektywa usunięta, proza przepisana na zdanie o tym, **dlaczego runner
  pisze na stderr** (adnotacje `::error`/`::notice` GitHub czyta z obu strumieni, stdout zostaje
  wolny dla potoku) — bez sugerowania, że cokolwiek wyłącza. Nowe zdanie nazywa też wprost, że
  poprzednia dyrektywa NICZEGO nie wyłączała i dlaczego (`eslint.config.js:130` ignoruje
  `agents/**`), żeby nikt jej nie „przywrócił" jako brakującej.

### F8 — Dziesięć pozycji Progress odhaczonych bez sha wbrew konwencji zapisanej w samym planie

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Plan Adherence
- **Location**: `context/changes/review-eval-gate/plan.md:1273,1289-1290,1297-1303`
- **Detail**: Nagłówek `## Progress` (`:1194`) mówi „Append ` — <commit sha>` when a step lands".
  Bez sha są: 3.0, 4.1, 4.2, 4.4, 4.4a, 4.4b, 4.4c, 4.4d, 4.5, 4.6 — całą fazę 4 poza 4.3 i wierszami
  ręcznymi. Merytorycznie nie jest to podbicie pieczątki: 4.1, 4.2 i 4.6 przejechałem w tym review
  na zielono, 4.4 odtworzyłem na kopii drzewa, 4.4a–4.4d mają nazwane testy (D2/D3/D4/D5/D7/E1/E2/E3),
  a 4.5 ma własną sekcję w `verification.md:607`. Brakuje wyłącznie śladu, po którym następna osoba
  ma dojść do commita — a fazy 1, 2, 3a, 3 i 5 ten ślad mają, więc to niespójność wewnątrz jednego
  dokumentu, nie przyjęta konwencja.
- **Fix**: Dopisz ` — 6eb9bb4` (faza 4) i ` — 35f3874` (3.0) do tych dziesięciu wierszy.
- **Decision**: FIXED — dziesięć wierszy ostemplowanych: `— 35f3874` (3.0) i `— 6eb9bb4`
  (4.1, 4.2, 4.4, 4.4a, 4.4b, 4.4c, 4.4d, 4.5, 4.6). Kontrola po edycji: w `## Progress` nie ma już
  żadnej pozycji `[x]` bez sha.

### F9 — HEAD nie jest wypchnięty; komplet bramek widziano na `5d7c5ad`, nie na stanie końcowym

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Success Criteria
- **Location**: `11f75a7` (lokalny HEAD) vs `origin/review-eval-gate` = `5d7c5ad`
- **Detail**: Kryterium 5.8 („pełny zestaw bramek zielony na finalnym stanie gałęzi") jest spełnione
  dla `5d7c5ad` i to potwierdziłem w API GitHuba (CI, Agents gate, Prompt ratchet, Eval ratchet —
  wszystkie `success`). Ale lokalny HEAD to `11f75a7`, o jeden commit dalej, i PR #49 go nie niesie.
  Commit jest wyłącznie dokumentacyjny (`change.md`, `plan.md`, `verification.md`), więc ryzyko jest
  bliskie zeru — odnotowuję, bo `Eval ratchet` NIE MA filtra `paths`, czyli jako jedyna z bramek
  pobiegnie także na commicie dokumentacyjnym, i to jest stan, którego jeszcze nikt nie widział.
- **Fix**: Wypchnij `11f75a7` przed merge'em i potwierdź komplet bramek na tym sha.
- **Decision**: DEFERRED — **odłożone do `/ship`, nie pominięte**, i zapisane w `plan.md` jako
  jedyny otwarty wiersz fazy 5. Użytkownik podał powód, którego nie miałem: `pr-review.yml` liczy
  diff od **merge-base, nie z commita**, więc każdy push kupuje recenzję CAŁEGO PR-a (~0,64 USD) —
  a ten triaż właśnie produkuje kolejne commity, więc push teraz zapłaciłby za stan pośredni
  i drugi raz za finalny. Kryterium **5.8 przestemplowane na `- [ ]`** z powodem; domyka je krok
  `/ship`: (1) domknięcie triażu lokalnie → (2) `git push` (`11f75a7` + commity triażu razem) →
  (3) `gh pr ready 49` → (4) potwierdzenie kompletu bramek NA TYM sha. Zapisane też, że
  `Eval ratchet` jako JEDYNA bramka bez filtra `paths` pobiegnie także na commicie czysto
  dokumentacyjnym — czyli ten stan zobaczymy pierwszy raz dopiero w punkcie 4.

### F10 — Odmowa `--record` łapie `--filter…`, ale nie zawężenie przez `--config`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka jest oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: `agents/review/evals/report.ts:595-604`
- **Detail**: `narrowingArgs` dopasowuje prefiks `--filter`, co pokrywa wszystkie osiem flag
  filtrujących promptfoo — sprawdzone, kolejność i powtórzenia flag nic nie zmieniają, bo `splitArgs`
  konsumuje `--record` przez `filter` po dokładnej wartości, a odmowy 1 i 2 padają PRZED wydatkiem.
  Poza zasięgiem zostaje `-c` / `--config` wskazujący okrojony `promptfooconfig`. Dziś to nie ma
  skutku, bo `matrixProblem` żąda ≥2 modeli × ≥2 fikstur i `matrix.length === models × fixtures`,
  więc okrojone przejście zaczerwieni się jako niepełna macierz — ale dopiero na CI i już po
  wydatku, czyli dokładnie w miejscu, którego reszta odmów unika. Strażnik zestarzeje się w dniu,
  w którym macierz urośnie ponad 2×2. Drobiazg drugiej klasy: `--record=true` nie jest rozpoznawane
  i dojedzie do promptfoo jako nieznana opcja (przebieg padnie — bezpiecznie, ale bez nazwanego powodu).
- **Fix**: Dopisz `-c`/`--config` do `narrowingArgs` (odmowa z powodem „dowód z cudzej konfiguracji
  nie opisuje macierzy") oraz odmowę na `--record=*`.
- **Decision**: FIXED — i **szerzej niż zaproponowałem**, bo wskazówka użytkownika trafiła
  w rzecz, której nie sprawdziłem: `splitArgs` ma **tę samą dziurę dla `--from`**
  (`indexOf("--from")` — dopasowanie po dokładnej wartości), więc `--from=plik` też przelatywało
  do `rest` i stąd do `promptfoo eval`. Najgorszy skutek nie jest kosmetyczny: **`--record=true
--from=plik` nie wywoływało odmowy wykluczającej tę parę**, bo dla parsera żadnej z tych flag
  tam nie było. Naprawione jako JEDNA klasa: `--from=` jest teraz konsumowane tak samo jak
  `--from <plik>` (flaga z wartością, postać jednoznaczna), a `--record=` to twarda odmowa
  z nazwanym powodem (flaga boolean — `--record=false` czytane jako „zapisuj" byłoby dokładnie
  tą cichą pułapką, przed którą broni reszta odmów). Do `narrowingArgs` dopisane
  `-c` / `--config` / `--config=`. Testy — sekcja (H), pięć przypadków, w tym jawny na parę
  `--record` + `--from=`.

## Czego NIE znaleziono — sprawdzone wprost

- **Obie bramki są fail-closed.** Prześledzona każda ścieżka do `return 0`: w
  `check-eval-record.ts:84` osiągalna wyłącznie po przejściu `parseRecord` (kształt, komplet `notes`,
  `callFingerprint` jako 64 hex, kształt każdej komórki) i pustej liście problemów; w
  `check-verdict-config.ts:92` po realnym odczycie bloku i zerowym rozjeździe, przy czym BRAK pola
  liczy się jako rozjazd. Oba `catch` na wierzchu ustawiają kod 1 z prefiksem `AWARIA`.
- **Dwaj zapisywacze jednego pliku nie kasują sobie bloków.** `buildRecord` przenosi
  `verdictConfig` nietknięte, `withVerdictConfig` przenosi `notes`/`generatedAt`/`callFingerprint`/
  `previousDelivery`/`matrix`; obaj rozwijają nieznane klucze; obaj emitują tę samą sześcioklucznikową
  kolejność, przypiętą NIEZALEŻNYM literałem po każdej stronie granicy (`eval-record.test.ts:107`,
  `verdict-config.test.ts:227`). Pin zadziałał w praktyce — komentarz `:222-224` zapisuje, że
  zaświecił się na czerwono, gdy `previousDelivery` doszło tylko po stronie agenta.
- **Granica kierunkowa trzyma.** `scripts/verdict-config.ts` importuje wyłącznie `node:crypto`,
  `node:fs` i siostrzany `./review-verdict.ts`; `assertions.ts` czytany jako BAJTY, `eval-record.json`
  jako DANE. Nic pod `agents/**` nie importuje z `scripts/`.
- **`FIXED_CALL_OPTIONS` nietknięte, wywołanie produkcyjne bez zmian.** 43 linie w `run-review.ts` to
  w całości addytywna carriage D-6 (`subtype`, `terminalReason` jako POLA rzutu, trzeci opcjonalny
  argument `reviewFailure`), zgodna z przyjętą regułą `lessons.md:257`. Kotwica odcisku
  `59ee111b…` policzona, nie odczytana z rekordu.
- **Wszystkie guardraile „What We're NOT Doing" utrzymane**: macierz nie biega w CI i nie może
  (zero `env:`), nierozszerzona (2×2), `SCORE_THRESHOLD` = 5, `conditional-null-contract` dalej
  miękka, `CACHE_FORMAT_VERSION` = `v1`, `.prettierignore` nietknięty, `pr-review.yml` dalej doradczy.
- **Kryterium 1.8 nie jest podbiciem pieczątki.** `provider.ts` dostał pola `subtype`/`terminalReason`
  dopiero w `6eb9bb4` (faza 4, po decyzji D-6); w `be29442`, przy którym 1.8 odhaczono, diff był
  faktycznie samym przeniesieniem i re-eksportem. Kryterium było prawdziwe w swojej dacie.
- **`prompt-sources.json` nie został odświeżony** przy edycji AGENTS.md — i to jest poprawne,
  bo §Commands nie jest sekcją pilnowaną. `check-prompt-sources.ts` zielony.
