# Pomiar: kontrola negatywna (`clean-text-change.diff`)

**Data**: 2026-08-23
**Linia bazowa promptu**: `0d3eba5` (niezmieniona)
**Fikstura**: `agents/review/evals/fixtures/clean-text-change.diff` — 26 linii, dwa pliki,
wyłącznie treść UI (`Welcome.astro`) i akapit dokumentacji (`README.md`)
**Droga przebiegu**: `npm --prefix agents/review run eval -- --filter-pattern clean-text`, czyli
PRZEZ ZESTAW, nie przez CLI — warunek, na którym stoi budżet fazy 7 (wyniki lądują w cache'u
zestawu, więc komórki slotu 2 wchodzą tam jako TRAFIENIA)
**Cap**: `maxBudgetUsd: 0.6` (bezpiecznik od patologii, nie bramka kosztowa)

## Pytanie

Co modele robią z kryteriami warunkowymi na materiale, na którym `null` należy się OBU?

`measurement-cheap-models.md` (Pomiar II) potwierdził naprawę `0d3eba5` wyłącznie na
`sample.diff` — czyli tam, gdzie kryteria 7 i 8 wypadły w PRZECIWNE strony (`swallowedError`
dotyczy, `gateIntegrity` nie). Przypadek, w którym model ma powiedzieć „nie dotyczy" DWA RAZY
z rzędu, pozostawał niezmierzony. To właśnie tam najbardziej kusi go wystawienie dziesiątek.

## Wynik: oczekiwanie NIE zostało dotrzymane

| model                        | `structured_output` | `safeParse` | `verdict` | `swallowedError` (7) | `gateIntegrity` (8) | `terminal_reason` |
| ---------------------------- | ------------------- | ----------- | --------- | -------------------- | ------------------- | ----------------- |
| `anthropic/claude-haiku-4.5` | PRZYSZEDŁ           | PRZESZEDŁ   | `pass` ✅ | **10** ❌            | **10** ❌           | `completed`       |
| `google/gemini-2.5-flash`    | —                   | —           | —         | —                    | —                   | patrz niżej       |

**Wynik inny niż oczekiwany jest POMIAREM, nie regresją.** Uruchamia decyzję opisaną na końcu,
a nie poprawkę odruchową.

## Haiku — pełny zestaw ocen

Kolejność jak w `criteria.json`:

| #   | kryterium                   | ocena                         |
| --- | --------------------------- | ----------------------------- |
| 1   | `implementationCorrectness` | 10                            |
| 2   | `idiomaticity`              | 10                            |
| 3   | `complexity`                | 10                            |
| 4   | `testRiskCoverage`          | 10                            |
| 5   | `documentationRationale`    | 7                             |
| 6   | `securitySafety`            | 10                            |
| 7   | `swallowedError`            | **10** ❌ (oczekiwano `null`) |
| 8   | `gateIntegrity`             | **10** ❌ (oczekiwano `null`) |
| 9   | `scopeDiscipline`           | 9                             |

### ⚑ Noty mówią WPROST, że model wie, iż kryterium nie dotyczy — i mimo to wystawia dziesiątkę

> `swallowedError`: „Zmiana nie dotyka żadnej operacji, zapisu, kompensacji ani wywoływania,
> które mogłoby zawiść. Czysta zmiana tekstowa — żaden wynik do sprawdzania. **Kryterium nie
> dotyczy, ale ocena 10 oddaje fakt braku ryzyka na tej ścieżce.**"

> `gateIntegrity`: „Zmiana nie dodaje ani nie modyfikuje żadnych testów, kroków CI, hooków,
> asercji ani sprawdzeń. Nie dotyka bramek — **kryterium nie ma zastosowania, ale ocena 10 oddaje
> fakt, że żadna bramka nie została osłabiona ani naruszona.**"

To nie jest nieporozumienie co do materiału — model rozpoznał go POPRAWNIE. To jest odrzucenie
samej reguły: dokładnie ten ruch, który `0d3eba5` opisał jako BŁĄD OCENY, nie ostrożność, i który
schemat uzasadnia arytmetycznie („dziesiątka za brak ryzyka zawyżałaby wynik: zmiana, która nie
ruszyła żadnej ścieżki zapisu, wypadłaby lepiej niż zmiana, która ruszyła ją i obsłużyła
porządnie").

Ta sama choroba widać też w `testRiskCoverage = 10`: „Kryterium testów nie ma zastosowania do
czystej zmiany tekstowej, **więc ocena 10 oddaje fakt, że nic nie wymaga testów**". Kryterium 4
nie jest warunkowe, więc `null` byłby tam nielegalny — ale rozumowanie jest to samo i pokazuje,
że wzorzec „nie dotyczy → dziesiątka" jest u haiku ogólny, nie ograniczony do dwóch kryteriów
warunkowych.

### Skutek dla werdyktu, czyli dlaczego to nie jest kosmetyka

Średnia z tych dziewięciu ocen wynosi 9,56 — czysta zmiana tekstowa wypada więc niemal idealnie,
lepiej niż jakakolwiek prawdziwa zmiana, która musiała się zmierzyć z obsługą błędu i bramką.
Próg z `scripts/review-verdict.ts` (5) jest daleko, więc dziś nie zmienia to werdyktu — ale
kalibracja jest zepsuta dokładnie w kierunku, przed którym broni opis kryterium.

### Metryki i koszt

```
model: anthropic/claude-haiku-4.5 | tury: 3 | czas: 52 582 ms | terminal_reason: completed
tokeny: 18 in (bez cache) | cache: 46 776 zapis / 32 778 odczyt | out: 5 376
```

| pozycja                                   | wartość                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `total_cost_usd` z SDK                    | 0,451259 (cennik Anthropica — NIE rachunek)                               |
| **koszt policzony z cennika OpenRoutera** | **0,088646 USD**                                                          |
| rozbicie                                  | in 0,000018 / out 0,026880 / cache zapis 0,058470 / cache odczyt 0,003278 |
| realna delta `/api/v1/key`                | **0,090682 USD**                                                          |
| iloraz (policzone / rachunek)             | **0,98**                                                                  |

⚑ Przebieg jest TRZYTUROWY, więc zgodnie z zastrzeżeniem w `pricing.ts` policzona kwota jest
DOLNYM oszacowaniem. Mimo to trafia w rachunek co do 2% — lepiej niż trzyturowy gemini z Pomiaru
II (0,54). Jedna obserwacja nie unieważnia zastrzeżenia, ale zawęża je: rozbieżność nie jest
funkcją samej liczby tur.

Wiersz raportu z fazy 5 (zamiast linii `[metryki]`, której przez providera nie ma):

```
| model                      | fikstura               | werdykt | kontrakt | tury | in | out  | cache zapis | cache odczyt | koszt USD | cache | asercje |
| anthropic/claude-haiku-4.5 | clean-text-change.diff | pass    | ok       | 3    | 18 | 5376 | 46776       | 32778        | 0.088646  | zimna | 5/5     |
```

**Asercje 5/5 ZIELONE — i to jest dowód, że projekt fazy działa, a nie że wynik jest dobry.**
Asercji `=== null` w tej fazie celowo nie ma; wchodzi dopiero PO pomiarze. Gdyby weszła wcześniej,
ta komórka byłaby czerwona i nie dałoby się odróżnić czerwieni znaczącej „zapisz to" od czerwieni
znaczącej „regresja".

## Gemini — DWA przebiegi, dwie różne awarie, żadnego wyniku

| próba | `subtype`         | `terminal_reason` | komunikat                                  | klasa        |
| ----- | ----------------- | ----------------- | ------------------------------------------ | ------------ |
| 1     | `success`         | `api_error`       | API Error: stream closed before completion | `[provider]` |
| 2     | `error_max_turns` | `max_turns`       | Reached maximum number of turns (2)        | `[unknown]`  |

**Żadna z nich NIE jest regresją kontraktu.** `safeParse` nie został osiągnięty ani razu, więc
rzut `[contract]` nie padł — ale to znaczy „nie dojechał", a nie „kontrakt trzyma". Kryterium 6.2
jest dla gemini niesprawdzone, nie spełnione.

Obie komórki są w tabeli CZERWONE i NAZWANE — to jest dokładnie ta własność, dla której faza 4
kazała `callApi` łapać rzut i zwracać `{ error }` zamiast go wypuszczać. Gdyby rzut wyszedł na
zewnątrz, promptfoo oznaczyłoby komórkę jako błąd providera i asercji nie wykonało wcale, a
„padnięta sieć" i „regresja kontraktu wyjścia" wyglądałyby identycznie.

### `maxTurns: 2` — sprawdzone, że to NIE jest regresja ekstrakcji z fazy 2

`git show 0d3eba5:agents/review/review.ts` → `maxTurns: 2` w linii 223, z tym samym komentarzem
(„tura 1: model czyta i ocenia | tura 2: emituje JSON wg schematu"). `run-review.ts` na HEAD ma
tę samą wartość. Ekstrakcja niczego tu nie przestawiła — limit jest oryginalny.

Nowa jest FIKSTURA. Na `sample.diff` gemini zdążyło (Pomiar II: `numTurns: 3`,
`terminal_reason: completed`); na kontroli negatywnej nie zdąża. Zestaw evali odsłonił granicę
konfiguracji, której dotąd nikt nie widział, bo nikt nie puścił przez ten harness materiału
innego niż `sample.diff`.

⚑ Rozbieżność do wyjaśnienia osobno, nie w tej fazie: haiku raportuje `numTurns: 3` przy
`maxTurns: 2` i kończy `completed`, a gemini na tej samej wartości dostaje `error_max_turns`.
Licznik `num_turns` w wyniku SDK i limit `maxTurns` najwyraźniej nie liczą tego samego.

### Rachunek gemini: ZERO — **i to było FAŁSZ, sprostowane w fazie 7**

Odczyt `/api/v1/key` po obu nieudanych próbach był IDENTYCZNY z odczytem sprzed nich
(0,946898827), więc zapisano tu „nieudane przebiegi gemini nie zostały obciążone" — z zastrzeżeniem
o opóźnionym księgowaniu OpenRoutera, znanym już z Pomiaru II.

> **⚑ SPROSTOWANIE (faza 7, ten sam dzień).** Zastrzeżenie okazało się właściwe, a wniosek — nie.
> Odczyt otwierający fazę 7 pokazał **0,978206026**, czyli **+0,031307 USD** od zamknięcia fazy 6,
> mimo że pomiędzy tymi odczytami NIE URUCHOMIONO NICZEGO. Jedyne wywołania w tym oknie to dwie
> nieudane próby gemini. **Nieudany przebieg JEST obciążany** — model przepalił tury, zanim uderzył
> w limit — a zerowa delta była wyłącznie opóźnieniem księgowania.
>
> **Rzeczywisty koszt fazy 6: 0,121989 USD**, nie 0,0907. Rozbicie: haiku 0,090682 (zaksięgowane
> od razu) + dwie próby gemini ~0,031307 (zaksięgowane z opóźnieniem).
>
> **Reguła, którą to ustanawia dla każdego następnego pomiaru w tym repo:** odczyt `/api/v1/key`
> wykonany BEZPOŚREDNIO po przebiegu nie jest rachunkiem, tylko dolnym oszacowaniem. Rachunek
> zamyka się dopiero odczytem otwierającym NASTĘPNE okno. Zapis „nic nie kosztowało" wymaga
> odczytu z opóźnieniem, a nie natychmiastowego.

## Rachunek fazy

| moment                        | `usage`           |
| ----------------------------- | ----------------- |
| przed fazą 6                  | **0,856216627**   |
| po przebiegu haiku            | **0,946898827**   |
| po obu nieudanych gemini      | **0,946898827**   |
| **odczyt otwierający fazę 7** | **0,978206026** ⚑ |

**Faza 6 kosztowała 0,121989 USD** — nie 0,090682, jak zapisano tu pierwotnie. Ostatni wiersz
tabeli jest tym, który to rozstrzyga: między zamknięciem fazy 6 a otwarciem fazy 7 nie uruchomiono
NICZEGO, a licznik urósł o 0,031307. To rachunek za dwie nieudane próby gemini, zaksięgowany
z opóźnieniem — patrz sprostowanie wyżej.

Faza 7 potrzebuje dwóch zimnych komórek `sample.diff` (~0,117 USD). **Nie mieści się.**
Zgodnie z wymaganiem 1 to jest zatrzymanie i rozmowa, nie dopłata.

## Decyzja o asercji `=== null` — warianty przedstawione człowiekowi

Plan (faza 6 §2) przewidywał decyzję binarną. Pomiar dołożył trzecią możliwość, której wtedy nie
było widać, bo nie znaliśmy jeszcze granicy `maxTurns`.

**A. Poprawka promptu** (jak `0d3eba5`). Adresuje rzeczywisty defekt: haiku odrzuca regułę,
którą rozumie. Koszt: unieważnia cache prefiksu i cache zestawu, więc faza 7 płaci pełną stawkę
za wszystkie cztery komórki (~0,23 USD) plus ponowny pomiar kontroli negatywnej. Przy 0,0531 USD
pod capem — niewykonalne bez podniesienia budżetu.

**B. Zniesienie różnicy asercją** — asercja `=== null` NIE wchodzi, a slot 2 zostaje przy pięciu
asercjach wspólnymi. Wtedy trzeba zapisać wprost, co przestaje być bramkowane: **zestaw nie
pilnuje reguły „null zamiast oceny tam, gdzie kryterium nie dotyczy" w ogóle** — czyli tej samej
reguły, dla której `0d3eba5` w ogóle powstał. Pozostaje bramką na werdykt, zakres ocen,
niepustość uzasadnień i kompletność kontraktu, ale kalibracji kryteriów warunkowych nie mierzy.

**C. Asercja wchodzi jako MIĘKKA** (do tabeli, nie do zieleni), a defekt zostaje zapisany jako
ryzyko otwarte z warunkiem zamknięcia. Zestaw wtedy WIDZI regresję i pokazuje ją w raporcie, ale
nie blokuje na niej przejścia — a różnica między „zmierzone i nienaprawione" a „niemierzone" jest
dokładnie tym, po co ten zestaw powstał.

Osobno od A/B/C: **gemini pozostaje niezmierzone na tej fiksturze** dopóki nie rozstrzygnie się
`maxTurns`. Podniesienie limitu jest zmianą na PRODUKCYJNEJ ścieżce review (`run-review.ts` jedzie
w CI na każdym PR-ze), więc nie wolno jej zrobić przy okazji — potrzebuje własnej pary dowodowej,
tak jak każda inna zmiana zachowania agenta.

---

## Decyzja PODJĘTA: wariant C (asercja miękka) — 2026-08-23

Wybrany wariant **C**: reguła `null` wchodzi jako **obserwacja miękka**
(`conditional-null-contract` w `evals/assertions.ts`) — raportowana w każdym przejściu, NIE
bramkująca zieleni. Wpięcie przez `vars.expectConditionalNull: true` na slocie 2.

**Dlaczego nie A (poprawka promptu):** nie dlatego, że jest zła — jest merytorycznie najbliżej
defektu. Odpada, bo unieważniłaby cache i wymusiła ponowny pomiar plus pełne przejście fazy 7
(~0,23 USD) przy **0,0531 USD** pozostałych pod capem z wymagania 1. Podjęcie jej tutaj byłoby
dopłatą, a wymaganie 1 mówi w tej sytuacji „zatrzymać się i wrócić z liczbami".

**Dlaczego nie B (asercja nie wchodzi wcale):** defekt zniknąłby z raportu razem z informacją,
że go zmierzono. Różnica między „zmierzone i świadomie nienaprawione" a „niemierzone" jest tym,
po co ten zestaw powstał.

**Co C realnie daje i czego NIE daje.** Daje: każde przejście wypisuje, że kryteria warunkowe
zostały rozstrzygnięte oceną zamiast `null`, z nazwami pól i wartościami. Nie daje: nic tego nie
BLOKUJE — nowa regresja tej samej klasy przejdzie przez bramkę tak samo jak stan dzisiejszy.
To jest cena wariantu i ma być czytana jako cena, nie jako kompromis bez kosztu.

Dowód, że obserwacja nie jest ozdobą — trzy przypadki w `evals/assertions.test.ts`, wszystkie
zielone: zmierzony wynik haiku jest WIDZIANY (`fail`), ten sam wynik NIE rusza ani jednej asercji
twardej, a materiał z poprawnym `null` obserwację dotrzymuje. Plus czwarty, że rejestr twardy
i miękki są rozłączne, więc nic nie bramkuje dwa razy.

Wyrenderowane na żywym przebiegu (trafienie cache'u, koszt 0,00 USD):

```
Wszystkie komórki zielone na asercjach twardych.

Obserwacje MIĘKKIE (raportowane, NIE bramkują zieleni) — 1 niedotrzymanych z 1:
  ✗ anthropic/claude-haiku-4.5 / clean-text-change.diff [conditional-null-contract] ocena zamiast
    `null` tam, gdzie kryterium nie ma zastosowania: swallowedError = 10, gateIntegrity = 10
```

### Warunki zamknięcia zapisane jako PYTANIA DO POMIARU

Oba ryzyka poszły do sekcji „Open Risks" w `plan.md` sformułowane jako pytania, na które trzeba
ODPOWIEDZIEĆ POMIAREM — nie jako zadania do odhaczenia. Powód jest procedury, nie stylu: warunek
zapisany jako zadanie ktoś za tydzień „domknie" bez liczby.

- **Ryzyko 3 (kontrakt `null`)**: czy regułę da się wyegzekwować promptem u KAŻDEGO kandydata, czy
  jest własnością modelu. Jeśli własnością modelu — **to nie jest defekt do naprawienia, tylko
  kryterium kwalifikacji modelu do tej bramki**, i tak trzeba je zapisać.
- **Ryzyko 4 (`maxTurns`)**: przy jakim materiale dwie tury przestają wystarczać. Domknięcie wymaga
  pary dowodowej na ścieżce PRODUKCYJNEJ, bo `run-review.ts` jedzie na każdym PR-ze.

### Gemini: NIEZMIERZONE, i tak to nazywamy

Kolumna gemini na slocie 2 pozostaje pusta. Nie „przeszła", nie „padła" — **niezmierzona**,
bo dwie próby skończyły się awariami przed dojściem do `safeParse`. Kryteria 6.1 i 6.2 zostają
w Progresie NIEODHACZONE. Podniesienie `maxTurns` byłoby zmianą produkcyjnej ścieżki review
podjętą w zmianie o innym celu — dokładnie ta klasa, przed którą broni kryterium 9.
