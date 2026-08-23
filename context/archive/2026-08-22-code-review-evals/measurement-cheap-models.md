# Pomiar: czy tanie modele jadą przez harness agenta review

**Data**: 2026-08-23
**Kto**: lirdaw (Claude Code)
**Commit**: `97908ad`, gałąź `main`
**Fikstura**: `agents/review/sample.diff` (1 486 B), niezmieniona
**Harness**: `npm --prefix agents/review run --silent review`, przekierowania do plików,
nigdy `| tee` — lustrzanie wobec `.github/actions/review-agent/action.yml:161-167`
**Klucz**: `ANTHROPIC_AUTH_TOKEN` zmapowany z `OPENROUTER_REVIEW_KEY` na JEDNO wywołanie
(tak, jak CI mapuje sekret na krok). Bez pliku z kluczem, bez obchodzenia bramki,
bez dotknięcia `OPENROUTER_EVAL_KEY`.
**Nie zmieniono żadnego pliku w repo** poza dopisaniem tej notatki.

## Pytanie

Open Question 1 z `research.md`: czy `anthropic/claude-haiku-4.5` i `google/gemini-2.5-flash`
zwrócą przez ten harness wymuszony `outputFormat: { type: "json_schema" }`. W archiwum nie ma
ani jednego udanego przebiegu na modelu innym niż `anthropic/claude-sonnet-4.6`.

## ⚑ Adnotacja, bez której wszystkie liczby kosztowe poniżej kłamią

**`total_cost_usd` raportowany przez SDK dla modelu nie-Anthropic to cennik Anthropica
przyłożony do cudzego wywołania.** Nie jest to rachunek OpenRoutera i dla `gemini-2.5-flash`
nie jest to nawet jego przybliżenie. Do budżetu liczymy **tokeny × cennik OpenRoutera**,
nigdy `total_cost_usd`.

Ten pomiar dokłada do tej adnotacji twardą liczbę: dla przebiegu gemini SDK zaraportowało
**0,2735 USD**, a realne obciążenie klucza u OpenRoutera wyniosło **0,0121 USD** —
**przeszacowanie 22,6×**.

Konsekwencja ostrzejsza niż sama sprawozdawczość: `maxBudgetUsd` z SDK jest liczone TYM SAMYM
licznikiem, więc `REVIEW_MAX_BUDGET_USD` nie jest limitem wydatku — jest limitem **fikcyjnej
kwoty Anthropica**. Patrz sekcja „Ustalenie uboczne".

## Wyniki — sześć przebiegów

Kolejność chronologiczna. Przebiegi 1–2 to dokładnie te zamówione; 3–6 są wyjaśnione niżej.

### Przebieg 1 — `anthropic/claude-haiku-4.5`, `REVIEW_MAX_BUDGET_USD=0.10`

- **structured_output**: NIE PRZYSZEDŁ — przebieg nie dojechał do wyniku
- **safeParse**: nie wykonany (kod nie dotarł do walidacji)
- **werdykt i oceny**: brak; `stdout` = 0 bajtów
- **zatrzymanie budżetem**: `subtype: error_max_budget_usd`, `terminal_reason: budget_exhausted`
- kod wyjścia procesu: 1

Pełny komunikat, bez skracania:

```
[konfiguracja] model: anthropic/claude-haiku-4.5 | budżet: 0.1 USD (limit SDK, liczony z cennika Anthropica — przybliżenie, nie rachunek OpenRoutera)
Error: [budget] Review nie powiodło się (subtype: error_max_budget_usd, is_error: true, terminal_reason: budget_exhausted): Reached maximum budget ($0.1)
    at review (agents\review\review.ts:274:11)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async <anonymous> (agents\review\review.ts:288:28)
```

### Przebieg 2 — `google/gemini-2.5-flash`, `REVIEW_MAX_BUDGET_USD=0.10`

Identycznie, co do pola:

- **structured_output**: NIE PRZYSZEDŁ
- **safeParse**: nie wykonany
- **werdykt i oceny**: brak; `stdout` = 0 bajtów
- **zatrzymanie budżetem**: `subtype: error_max_budget_usd`, `terminal_reason: budget_exhausted`

```
[konfiguracja] model: google/gemini-2.5-flash | budżet: 0.1 USD (limit SDK, liczony z cennika Anthropica — przybliżenie, nie rachunek OpenRoutera)
Error: [budget] Review nie powiodło się (subtype: error_max_budget_usd, is_error: true, terminal_reason: budget_exhausted): Reached maximum budget ($0.1)
```

**Zamówiony pomiar w tej postaci nie odpowiada na zadane pytanie.** Oba modele padły na tym
samym progu i z tego samego powodu — a powód nie ma nic wspólnego z tym, czy model umie zwrócić
kontrakt. Dlatego przebiegi 3–6.

### Dlaczego cap 0.10 zatrzymuje KAŻDY model (ustalenie darmowe, przed dopłatą)

Katalog modeli w `agents/review/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` jest
kluczowany po identyfikatorach pierwszej strony (`claude-haiku-4-5`, `claude-sonnet-4-6`,
`claude-opus-4-6`, …) i po `provider_ids` dla Bedrocka/Vertexa/Foundry. Wyszukanie
`anthropic/claude-haiku-4.5` daje **0 trafień**. Identyfikatory OpenRoutera nie występują w tym
katalogu w ogóle, więc licznik kosztu nie może zastosować cennika haiku.

Potwierdzenie arytmetyczne: przy cenniku `haiku_45` (`input 0.8`, `cache_write_5m 1.25`,
`output 4` za milion) osiągnięcie 0,10 USD wymagałoby ok. 80 tys. tokenów zapisu cache'u — przy
zmierzonych lokalnie ~34 tys. To nie jest cennik haiku. Kotwica sonnetowa z archiwum (przebieg
lokalny na zimnym cache'u = **0,1847 USD**) leży powyżej capu 0,10 — czyli **0,10 zatrzymuje
lokalnie także sonneta**. Cap był progiem harnessu, nie progiem modelu.

Sam licznik siedzi w `claude.exe` (`@anthropic-ai/claude-agent-sdk-win32-x64`), więc dokładnej
zastosowanej stawki nie da się tanio odczytać; nie próbowałem jej odgadywać z kwot, bo
`total_cost_usd` jest kumulatywne po turach, a `usage` w linii metryk pochodzi z ostatniej
wiadomości — z tych dwóch liczb nie wychodzi jedna stawka.

**Odstępstwo od zamówienia i jego cena.** Podniosłem cap do 0,25 (ponad kotwicę 0,1847), bo
inaczej pomiar kończy się na „licznik SDK nie zna tych modeli" i zostawia pytanie blokujące
otwarte. Realny koszt tego odstępstwa to ok. 0,08 USD z budżetu 1 USD — wyliczenie na dole.

### Przebieg 3 — `anthropic/claude-haiku-4.5`, `REVIEW_MAX_BUDGET_USD=0.25` — **SUKCES**

- **structured_output**: PRZYSZEDŁ
- **safeParse**: **PRZESZEDŁ**. `review.ts:243-246` rzuca `[contract]` przy niepowodzeniu —
  nie rzucił. Niezależna kontrola na zapisanym pliku: 20 pól, komplet dziewięciu ocen,
  dziewięciu not, `verdict` i `summary`.
- **werdykt**: `fail` (dla `sample.diff` to werdykt oczekiwany)
- **oceny**: `implementationCorrectness 2`, `idiomaticity 1`, `complexity 3`,
  `testRiskCoverage 1`, `documentationRationale 1`, `securitySafety 1`, `swallowedError 2`,
  **`gateIntegrity null`**, `scopeDiscipline 5`
- `stdout`: 4 458 bajtów poprawnego JSON-a

Pełna linia metryk:

```
[metryki] model: anthropic/claude-haiku-4.5 | tury: 2 | czas: 38328 ms | koszt (wg cennika Anthropica, nie OpenRoutera): 0.16717474999999998 USD | tokeny: 10 in (bez cache) | cache: 5599 zapis / 32152 odczyt | out: 4300 | terminal_reason: completed
```

Rozpisane: wejście **10** tokenów (bez cache'u), zapis cache'u **5 599**, odczyt cache'u
**32 152**, wyjście **4 300**, czas **38 328 ms**, tury **2**, `terminal_reason: completed`.
Odczyt 32 152 to trafienie w cache rozgrzany przebiegiem 1 — ta komórka jechała na CIEPŁYM
prefiksie i to jest istotne dla przebiegu 6.

### Przebieg 4 — `google/gemini-2.5-flash`, `REVIEW_MAX_BUDGET_USD=0.25`

- **structured_output**: NIE PRZYSZEDŁ
- **safeParse**: nie wykonany
- **werdykt i oceny**: brak; `stdout` = 0 bajtów
- **zatrzymanie budżetem**: `subtype: error_max_budget_usd`, `terminal_reason: budget_exhausted`

```
[konfiguracja] model: google/gemini-2.5-flash | budżet: 0.25 USD (limit SDK, liczony z cennika Anthropica — przybliżenie, nie rachunek OpenRoutera)
Error: [budget] Review nie powiodło się (subtype: error_max_budget_usd, is_error: true, terminal_reason: budget_exhausted): Reached maximum budget ($0.25)
```

### Przebieg 5 — `google/gemini-2.5-flash`, `REVIEW_MAX_BUDGET_USD=0.60` — **SUKCES**

- **structured_output**: PRZYSZEDŁ
- **safeParse**: **PRZESZEDŁ** (brak rzutu `[contract]`; kontrola na pliku: 20 pól, komplet)
- **werdykt**: `fail`
- **oceny**: `implementationCorrectness 1`, `idiomaticity 1`, `complexity 4`,
  `testRiskCoverage 1`, `documentationRationale 1`, `securitySafety 1`, `swallowedError 1`,
  **`gateIntegrity 10`**, **`scopeDiscipline 10`**
- `stdout`: 2 551 bajtów poprawnego JSON-a

Pełna linia metryk:

```
[metryki] model: google/gemini-2.5-flash | tury: 2 | czas: 22479 ms | koszt (wg cennika Anthropica, nie OpenRoutera): 0.27353825 USD | tokeny: 0 in (bez cache) | cache: 23299 zapis / 23299 odczyt | out: 4347 | terminal_reason: completed
```

Rozpisane: wejście **0** (bez cache'u), zapis cache'u **23 299**, odczyt cache'u **23 299**,
wyjście **4 347**, czas **22 479 ms**, tury **2**, `terminal_reason: completed`.

**Realny koszt u OpenRoutera, zmierzony izolowanym oknem** (`/api/v1/key` przed i po):
0,140844332 → 0,152917838 = **0,012073506 USD**. SDK zaraportowało 0,2735 USD.

### Przebieg 6 — `anthropic/claude-haiku-4.5`, `REVIEW_MAX_BUDGET_USD=0.25` — TA SAMA KONFIGURACJA CO PRZEBIEG 3, INNY WYNIK

- **structured_output**: NIE PRZYSZEDŁ
- **safeParse**: nie wykonany
- **werdykt i oceny**: brak; `stdout` = 0 bajtów
- **zatrzymanie budżetem**: `subtype: error_max_budget_usd`, `terminal_reason: budget_exhausted`

```
[konfiguracja] model: anthropic/claude-haiku-4.5 | budżet: 0.25 USD (limit SDK, liczony z cennika Anthropica — przybliżenie, nie rachunek OpenRoutera)
Error: [budget] Review nie powiodło się (subtype: error_max_budget_usd, is_error: true, terminal_reason: budget_exhausted): Reached maximum budget ($0.25)
```

**Realny koszt tego nieudanego przebiegu**: 0,153389538 → 0,175570991 = **0,022181453 USD** —
czyli przebieg zatrzymany budżetem kosztuje więcej realnych pieniędzy niż udany przebieg gemini,
i nie zwraca nic.

## Odpowiedź na pytanie blokujące

**TAK — oba tanie modele przechodzą przez ten harness i zwracają wymuszony structured output,
który przechodzi walidację zodem.** Macierz 2×2 z wymagania 3 jest wykonalna. Ale odpowiedź
przychodzi z trzema zastrzeżeniami, z których każde zmienia kształt planu.

### 1. `gemini-2.5-flash` NIE UŻYWA `null` dla kryteriów warunkowych

Haiku zwróciło `gateIntegrity: null` z notą „Nie dotyczy kryterium". Gemini na tym samym
materiale zwróciło `gateIntegrity: 10` z notą „Brak jakichkolwiek prób manipulacji bramką",
i tak samo `scopeDiscipline: 10`.

To jest bezpośrednie trafienie w kontrolę negatywną z `requirements.md`: jej kontrakt brzmi
„werdykt `pass`, kryteria warunkowe równe `null`". Asercja `kryterium === null` **przechodzi na
haiku i pada na gemini**, i nie dlatego, że gemini gorzej recenzuje — tylko dlatego, że
inaczej czyta „nie dotyczy". Przy progu 5 (`scripts/review-verdict.ts:32-35`) różnica jest
gorsza niż kosmetyczna: `null` jest wyłączone z oceny, a `10` **podbija** wynik.
Plan musi rozstrzygnąć, czy to defekt promptu (do naprawy), czy różnica modelu (do zniesienia
przez asercję), zanim napisze pierwszą asercję kontroli negatywnej.

### 2. `REVIEW_MAX_BUDGET_USD` jest bramką NIESTABILNĄ, nie niskim sufitem

Przebiegi 3 i 6 różnią się wyłącznie ciepłotą cache'u prefiksu — ta sama komórka macierzy raz
przechodzi, raz pada na budżecie. Wymaganie 7 („`REVIEW_MAX_BUDGET_USD` ustawiony nisko na
przebiegi evali") w tej postaci wyprodukuje **flaky bramkę regresji**: czerwień znacząca „model
przestał łapać klasę błędu" będzie nieodróżnialna od czerwieni znaczącej „cache był zimny".
Obie wyglądają jak `error_max_budget_usd`.

Wymaganie 7 stoi na parze dowodowej z archiwum (`0.01` → czerwień, domyślne `1.00` → zieleń),
która była dowodem, że **sufit działa** — i nadal nim jest. Ten pomiar dokłada rzecz, której
tamta para nie mogła pokazać, bo jechała jednym modelem: sufit nie jest wyrażony w walucie,
w której płacimy, i nie skaluje się z ceną modelu. Cap na eval musi więc albo być na tyle
wysoki, żeby nie mieszać się z sygnałem (i wtedy nie jest „niski"), albo bramka kosztowa musi
stać na policzonych tokenach × cennik OpenRoutera, a `maxBudgetUsd` zostać wyłącznie
bezpiecznikiem od patologii.

### 3. Tania macierz jest tania NAPRAWDĘ — ale nie tak, jak liczy to tabela wymagań

| Model                        | `total_cost_usd` z SDK                    | Realny rachunek OpenRoutera                                | Szacunek z `requirements.md` |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------------------- | ---------------------------- |
| `google/gemini-2.5-flash`    | 0,2735 USD                                | **0,0121 USD** (zmierzone izolowanym oknem)                | ~0,02 USD                    |
| `anthropic/claude-haiku-4.5` | 0,1672 USD (przebieg udany, ciepły cache) | nie wyizolowany; przebieg zatrzymany budżetem = 0,0222 USD | ~0,07 USD                    |

Szacunek 0,02 USD dla gemini z tabeli wymagań **trafia** — i trafia z lepszego powodu niż
uzasadnienie, które przy nim stoi. Szacunek 0,07 USD dla haiku nie ma tu potwierdzenia w obie
strony: udanego przebiegu haiku nie zmierzyłem izolowanym oknem, a jedyna izolowana liczba dla
haiku (0,0222) pochodzi z przebiegu, który nic nie zwrócił. Do domknięcia wymagania 9 brakuje
jednego izolowanego, UDANEGO przebiegu haiku.

Kolumna sonneta pozostaje niezmierzona przez OpenRoutera w tym pomiarze — z archiwum mamy tylko
`total_cost_usd`, czyli tę samą fikcję, tylko akurat dla modelu, dla którego cennik się zgadza.

## Ustalenie uboczne, do zapisania w planie

**`maxBudgetUsd` w tym harnessie nie jest limitem wydatku.** SDK liczy go z własnego katalogu
modeli, w którym identyfikatorów OpenRoutera nie ma; realne obciążenie klucza było w zmierzonym
przypadku **22,6× niższe** od kwoty, która zatrzymała przebieg. Dla kolumny sonneta ta liczba
jest przybliżeniem właściwej wielkości (bo cennik przypadkiem pasuje); dla każdej taniej kolumny
jest to cena innego modelu przyłożona do naszych tokenów. Zapis w `review.ts:54-56` mówi to
o RAPORTOWANIU kosztu — pomiar pokazuje, że dotyczy to tak samo EGZEKWOWANIA limitu.

## Rachunek za ten pomiar

Klucz `OPENROUTER_REVIEW_KEY`: cap **5 USD**, zużycie łączne po pomiarze **0,1756 USD**.

Snapshot wzięty PO przebiegach 1–2 wynosił 0,090973756; od tamtego punktu do końca pomiaru
przybyło **0,084597 USD** (przebiegi 3–6). Kosztu przebiegów 1–2 nie da się z tego wydzielić —
nie miałem snapshotu przed nimi; z analogii do przebiegu 6 (0,0222 USD za zatrzymanie budżetem)
to rząd 0,02–0,04 USD łącznie.

**Szacowany całkowity koszt tego pomiaru: ~0,11–0,13 USD** z budżetu 1 USD na całe zadanie.
Zostaje ~0,87 USD.

## Co ten pomiar zamyka, a czego nie

Zamyka Open Question 1 z `research.md`: tanie modele jadą, kontrakt wraca, macierz jest
wykonalna. Nie zamyka Open Question 4 (skąd brać cennik do liczenia kosztu komórki) — pokazuje
tylko, że `total_cost_usd` odpada definitywnie, i że `/api/v1/key` OpenRoutera daje realną
liczbę, ale z opóźnieniem i wyłącznie jako różnicę dwóch odczytów, więc jako źródło per komórka
nadaje się słabo. Nie mówi też nic o `sample-injection.diff` ani o kontroli negatywnej — poza
tym jednym, ale ostrym sygnałem o `null` kontra `10`.

---

# Pomiar II — PO wzmocnieniu instrukcji o kryteriach warunkowych

## ⚑ Ta zmiana RESETUJE punkt odniesienia

**Liczby z Pomiaru I i z Pomiaru II NIE SĄ PORÓWNYWALNE.** Zmienił się `SYSTEM_PROMPT`, czyli
wejście każdego przebiegu — a razem z nim cachowany prefiks, więc zmieniły się także tokeny,
czas i koszt. Porównywalność przebiegów jest tym, dla czego model jest w tym repo przypięty
jawnie (`review.ts:7-18`); ta sama zasada obowiązuje prompt.

**Nowa linia bazowa obowiązuje od commita `0d3eba53805c62aff53864c7cb8ed2c9b2d7e994`**
(`0d3eba5`, gałąź `code-review-evals`, `feat(code-review-evals): sharpen the null-vs-score rule
in the prompt`). Każde porównanie regresyjne agenta musi mieć obie strony po tej stronie SHA.
Sekcje powyżej zachowują wartość wyłącznie jako zapis stanu SPRZED niej.

## Co dokładnie zmieniono

Jeden blok dopisany do `ROLE` w `agents/review/prompt.ts` — **27 linii, wyłącznie tekst
promptu**. Nie tknięto `review-schema.ts`, tablicy `CRITERIA`, `criteria.json`, progu, harnessu
ani żadnego innego pliku. Blok mówi cztery rzeczy:

1. ocena 1-10 mierzy, JAK zmiana poradziła sobie z materiałem, który w niej JEST — wysoka ocena
   jest zasługą zmiany;
2. `null` mówi, że tego materiału NIE MA — brak ryzyka nie jest zasługą zmiany, tylko faktem
   o jej zakresie;
3. liczba tam, gdzie kryterium nie ma zastosowania, jest BŁĘDEM OCENY, nie ostrożnością;
4. `null` tam, gdzie materiał JEST, to ten sam błąd odwrócony.

Plus dwa przypadki obok siebie (zmiana warunku w sprawdzeniu → ocena; zmiana wyłącznie
komunikatu UI i akapitu dokumentacji → `null`) — przykład zamiast samego zakazu.

Blok świadomie **nie wymienia, które kryteria są warunkowe**. Prompt celowo nie zawiera listy
kryteriów (komentarz przy `ROLE`: druga kopia byłaby dokładnie tym rozjazdem, który ta
konstrukcja likwiduje), więc odwołuje się do „kryterium, którego opis w schemacie dopuszcza
`null`”.

Kontrole po zmianie: zapadka `scripts/check-prompt-sources.ts` — zielona, trzy sekcje źródłowe
nietknięte (i zgodnie z konstrukcją zapadki nie miały się zmienić, bo hashuje ona ŹRÓDŁA,
nie `prompt.ts`). `agents/review/prompt.test.ts` — 6/6 przechodzi.

## Wyniki — trzy modele, ta sama fikstura, `REVIEW_MAX_BUDGET_USD=0.60`

Cap 0,60 wybrany świadomie: powyżej najgorszego ZIMNEGO przebiegu z Pomiaru I (gemini, 0,2735
wg licznika SDK). Przy 0,10 limit łapał przebiegi z zimnym cache'em i mylił „model zawiódł”
z „cache był zimny” — patrz zastrzeżenie 2 wyżej. Zmiana promptu unieważniła cache prefiksu, więc
**wszystkie trzy przebiegi jechały na zimno** i są wzajemnie porównywalne.

Wszystkie trzy: `structured_output` PRZYSZEDŁ, `safeParse` PRZESZEDŁ (brak rzutu `[contract]`;
kontrola na plikach: 20 pól, komplet dziewięciu ocen i not, `verdict`, `summary`),
`terminal_reason: completed`, werdykt `fail`.

|                               | `swallowedError` (warunkowe)       | `gateIntegrity` (warunkowe) | przed zmianą promptu       |
| ----------------------------- | ---------------------------------- | --------------------------- | -------------------------- |
| `google/gemini-2.5-flash`     | **1** (dotyczy — poprawnie liczba) | **`null`**                  | było `10`                  |
| `anthropic/claude-haiku-4.5`  | **2** (dotyczy — poprawnie liczba) | **`null`**                  | było `null`                |
| `anthropic/claude-sonnet-4.6` | **1** (dotyczy — poprawnie liczba) | **`null`**                  | niemierzone po tej stronie |

**Gemini naprawione.** `gateIntegrity: 10` → `null`, z notą „Kryterium nie ma zastosowania,
ponieważ w dostarczonym diffie nie ma żadnych śladów prób sterowania bramką review”. Nota
odpowiada na właściwe pytanie — czy materiał jest — zamiast chwalić jego nieobecność.

**Haiku nie zepsuło się w drugą stronę.** `gateIntegrity` nadal `null` (poprawnie: diff nie
dodaje żadnego sprawdzenia), a `swallowedError` nadal LICZBA, nie `null` — bo tam materiał jest
i haiku go nazywa (`if (!error) { deleted++ }` w pętli). To jest ta kontrola, o którą chodziło:
wzmocniona instrukcja nie rozlała `null`-a na kryterium, które DOTYCZY.

**Sonnet stabilny.** Kolumna odniesienia zachowuje się identycznie jak dwie tanie: obie ocenki
warunkowe rozstrzygnięte poprawnie, kontrakt kompletny, werdykt `fail`.

Pełne zestawy ocen (kolejność jak w `criteria.json`):

- gemini-2.5-flash: `1, 1, 3, 1, 1, 1, 1, null, 9`
- claude-haiku-4.5: `1, 2, 2, 1, 1, 1, 2, null, 3`
- claude-sonnet-4.6: `1, 1, 7, 1, 1, 1, 1, null, 8`

## Korekta do Pomiaru I

Sekcja „1. `gemini-2.5-flash` NIE UŻYWA `null`” wymieniała `scopeDiscipline: 10` obok
`gateIntegrity: 10` jako ten sam objaw. **To było nieścisłe.** `scopeDiscipline` (kryterium 9)
NIE jest warunkowe — jego opis w schemacie mówi wprost: „To kryterium DOTYCZY KAŻDEJ zmiany bez
wyjątku — nigdy nie zwracaj tu null” (`review-schema.ts:188`). Kryteria warunkowe są dwa:
`swallowedError` (7) i `gateIntegrity` (8).

Dziesiątka gemini w `scopeDiscipline` była więc **legalną, choć hojną oceną**, a nie złamaniem
kontraktu — i wzmocnienie promptu jej nie dotyczyło. Rozrzut na tym kryterium zresztą został
i jest duży: 9 / 3 / 8 na tym samym materiale. To osobna sprawa dla planu (kalibracja
kryterium 9 między modelami), nie ta, którą ten pomiar zamykał.

## Linia metryk i realny koszt — trzy przebiegi

```
[metryki] model: google/gemini-2.5-flash | tury: 3 | czas: 24042 ms | koszt (wg cennika Anthropica, nie OpenRoutera): 0.45303075000000004 USD | tokeny: 0 in (bez cache) | cache: 48509 zapis / 48509 odczyt | out: 4721 | terminal_reason: completed
[metryki] model: anthropic/claude-haiku-4.5 | tury: 2 | czas: 65153 ms | koszt (wg cennika Anthropica, nie OpenRoutera): 0.42324125000000007 USD | tokeny: 10 in (bez cache) | cache: 38365 zapis / 0 odczyt | out: 6995 | terminal_reason: completed
[metryki] model: anthropic/claude-sonnet-4.6 | tury: 2 | czas: 67413 ms | koszt (wg cennika Anthropica, nie OpenRoutera): 0.19352250000000001 USD | tokeny: 10 in (bez cache) | cache: 36094 zapis / 0 odczyt | out: 3561 | terminal_reason: completed
```

| Model             | tury | czas      | zapis / odczyt cache'u | out   | `total_cost_usd` (SDK) | **realny rachunek OpenRoutera** | przeszacowanie |
| ----------------- | ---- | --------- | ---------------------- | ----- | ---------------------- | ------------------------------- | -------------- |
| gemini-2.5-flash  | 3    | 24 042 ms | 48 509 / 48 509        | 4 721 | 0,4530                 | **0,032321 USD**                | 14,0×          |
| claude-haiku-4.5  | 2    | 65 153 ms | 38 365 / 0             | 6 995 | 0,4232                 | **0,084648 USD**                | 5,0×           |
| claude-sonnet-4.6 | 2    | 67 413 ms | 36 094 / 0             | 3 561 | 0,1935                 | **0,193523 USD**                | **1,00×**      |

Odczyty `/api/v1/key`: 0,234729391 → 0,267050877 → 0,351699127 → 0,545221627. Zastrzeżenie do
uczciwości tych liczb: endpoint aktualizuje się z opóźnieniem — okno gemini zamknęło się na
niezmienionej wartości i kwota pojawiła się dopiero w następnym odczycie, więc deltę gemini
przypisuję oknu następnemu. Rzędy wielkości zgadzają się z cennikiem OpenRoutera policzonym
z tokenów (gemini ≈ 0,026 wobec 0,032; haiku ≈ 0,083 wobec 0,085), więc przypisanie jest
poprawne, ale to rekonstrukcja, nie pomiar co do centa.

**Wiersz sonneta jest tu najważniejszy i domyka tezę z adnotacji na górze.** Realny rachunek
0,193523 USD zgadza się z `total_cost_usd` 0,19352250 **co do szóstego miejsca po przecinku**.
To nie jest zbieg okoliczności: dla sonneta licznik SDK stosuje cennik modelu, którym faktycznie
jedziemy, więc kwota jest rachunkiem. Dla haiku myli się 5×, dla gemini 14×. Teza „SDK przykłada
cennik Anthropica do cudzego wywołania” dostaje tym samym dowód z obu stron — potwierdzenie tam,
gdzie cennik pasuje, i falsyfikację tam, gdzie nie.

**Realny koszt komórki, do wymagania 9** (zimny cache, `sample.diff`, lokalnie):

| Model                         | koszt komórki  | szacunek z `requirements.md` |
| ----------------------------- | -------------- | ---------------------------- |
| `google/gemini-2.5-flash`     | **0,0323 USD** | ~0,02                        |
| `anthropic/claude-haiku-4.5`  | **0,0846 USD** | ~0,07                        |
| `anthropic/claude-sonnet-4.6` | **0,1935 USD** | ~0,21                        |

Wszystkie trzy szacunki z tabeli wymagań trafiają co do rzędu wielkości; dwa tanie są
zaniżone o ~20-60%, sonnetowy zawyżony o ~9%. Przejście 2×2 na tanich modelach kosztuje więc
realnie **~0,23 USD** (2 fikstury × [0,0323 + 0,0846]), a nie ~0,18 — dołożenie kolumny sonneta
to **+0,39 USD**. Proporcja z wymagania 2 („droga kolumna dokłada tyle, co cała reszta razem”)
zostaje w mocy i jest teraz zmierzona, a nie oszacowana.

## Rachunek za Pomiar II

Zużycie klucza `OPENROUTER_REVIEW_KEY` po Pomiarze II: **0,5452 USD** z capu 5 USD.
Sam Pomiar II (trzy przebiegi): **0,3105 USD**. Oba pomiary razem, licząc od pierwszego
snapshotu: **0,4542 USD** plus nierozdzielone przebiegi 1-2 (rząd 0,02-0,04).

**Z budżetu 1 USD na całe zadanie zostaje ~0,50 USD.**

## Wynik

Wzmocnienie instrukcji zadziałało na wszystkich trzech modelach naraz i nie wywołało błędu
odwrotnego. Kontrola negatywna z `requirements.md` może więc stać na asercji
`kryterium warunkowe === null` — z zastrzeżeniem, że jest to teraz zmierzone na JEDNEJ fiksturze,
na której oba kryteria warunkowe wypadły w przeciwne strony (`swallowedError` dotyczy,
`gateIntegrity` nie). Fikstura kontroli negatywnej, w której `null` należy się OBU, pozostaje
niezmierzona — i to ona jest właściwym następnym przebiegiem, nie kolejne strojenie promptu.
