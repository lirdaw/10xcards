# Weryfikacja — bramka regresji na zmianach promptu agenta review

Rejestr pomiarów tej zmiany. Jedna sekcja na fazę, w kolejności chronologicznej.

> Faza 3a jest chronologicznie PÓŹNIEJSZA niż faza 3 (dopisana po jej zatrzymaniu), ale stoi
> niżej — sekcje idą w kolejności faz, nie zegara. Jej data i tak jest przy niej.

---

## Faza 3 — Przejście macierzy. ZATRZYMANA na kryterium 3.6

**Data**: 2026-08-23
**Gałąź**: `review-eval-gate`, HEAD `f8a9e80`
**Klucz**: `ANTHROPIC_AUTH_TOKEN` zmapowany z `OPENROUTER_REVIEW_KEY` na JEDNO wywołanie
(nigdy `OPENROUTER_EVAL_KEY`, nigdy eksport na stałe)
**Komenda**: `npm --prefix agents/review run eval -- --record`
**Status fazy**: **NIEDOMKNIĘTA**. Kryteria 3.1, 3.3, 3.4 spełnione; 3.6 NIE — i to jest wynik
fazy, nie przeszkoda do obejścia. Progress fazy 3 zostaje otwarty, żaden wiersz nie odhaczony.

### Rachunek — odczyty `/api/v1/key`

| moment                                 | UTC                    | `usage`         |
| -------------------------------------- | ---------------------- | --------------- |
| kotwica dolna, PRZED przejściem        | `2026-08-23T16:57:29Z` | **3,615500098** |
| odczyt natychmiastowy, po przejściu    | `2026-08-23T16:59:47Z` | **3,850512303** |
| odczyt OPÓŹNIONY (+7 min od przejścia) | `2026-08-23T17:07:02Z` | **3,850512303** |

**Realny wydatek: 0,235012205 USD.** Odczyt opóźniony jest identyczny z natychmiastowym, więc
tym razem opóźnione księgowanie niczego nie dołożyło — z zastrzeżeniem ustanowionym w
`measurement-negative-control.md:154-157`: rachunek zamyka się dopiero odczytem otwierającym
NASTĘPNE okno pomiarowe, a nie odczytem po przebiegu. Do tego czasu 0,235012 jest
oszacowaniem DOLNYM, choć potwierdzonym dwoma odczytami.

Suma z raportu obok: **0,110343 USD** z 2 z 4 komórek ZMIERZONYCH. Rozjazd między nią a rachunkiem
klucza — **0,124669 USD** — nie jest błędem, tylko ceną dwóch komórek wypalonych (patrz Fakt 2).

**Kotwica budżetowa zmiany: 0,50 USD. Wydano 0,235012. Zostaje ~0,265 USD.**
Zużycie klucza `OPENROUTER_REVIEW_KEY` po fazie: **3,850512303** z capu 5 USD
(`limit_remaining` 1,149487697).

### Tabela przejścia

```
| model                      | fikstura               | werdykt | kontrakt  | tury | in   | out  | cache zapis | cache odczyt | koszt USD | cache | asercje |
| -------------------------- | ---------------------- | ------- | --------- | ---- | ---- | ---- | ----------- | ------------ | --------- | ----- | ------- |
| google/gemini-2.5-flash    | sample.diff            | fail    | ok        | 3    | 0    | 3432 | 48600       | 48600        | 0.014088  | zimna | 6/6     |
| anthropic/claude-haiku-4.5 | sample.diff            | fail    | ok        | 3    | 18   | 6416 | 48703       | 32778        | 0.096255  | zimna | 6/6     |
| google/gemini-2.5-flash    | clean-text-change.diff | BRAK    | [unknown] | BRAK | BRAK | BRAK | BRAK        | BRAK         | BRAK      | BRAK  | BRAK    |
| anthropic/claude-haiku-4.5 | clean-text-change.diff | BRAK    | [unknown] | BRAK | BRAK | BRAK | BRAK        | BRAK         | BRAK      | BRAK  | BRAK    |

Koszt komórek: 0.110343 USD z 2/2 komórek ZMIERZONYCH; trafienia cache'u: 0/2.
ZAPŁACONE w tym przejściu: 0.110343 USD (trafienia cache'u nie kosztują).
Komórek uruchomionych: 4; z tego ZMIERZONYCH 2, BRAKÓW ZMIERZONYCH 2.
Przejście zimne we wszystkich czterech komórkach (0 trafień cache'u) — zgodnie z `research.md` §3.1.
```

Komunikat obu braków, co do znaku:

```
[unknown] Review nie powiodło się (subtype: error_max_turns, is_error: true,
terminal_reason: max_turns): Reached maximum number of turns (2)
```

### Co jest w drzewie i dlaczego tam zostaje

`agents/review/evals/eval-record.json` **zostaje**. Jest uczciwym pomiarem — tylko nie tym,
którego plan oczekiwał. Spełnia:

- `npx prettier --check agents/review/evals/eval-record.json` → **kod 0** (kryterium 3.1;
  pomiar kształtu z fazy 2 na dowodzie sfabrykowanym okazał się trafny na dowodzie prawdziwym)
- 4 wiersze, 2 różne modele, 2 różne fikstury (kryterium 3.3)
- `callFingerprint` = `59ee111bb431f77a4fc01d7f9bf33992f4ab783458c704d20aafb9e42edec8f1`,
  czyli **kotwica z planu, co do bajtu** (kryterium 3.4)

Nie spełnia kryterium 3.6: dwie z czterech komórek mają `ok: false`.

Blok `verdictConfig` **nie został dopisany** (`scripts/run-verdict-config.ts --write` nie
uruchomiony): to krok 3 fazy, a faza jest zatrzymana na kroku 2. Wartości, które by wpisał, są
policzone i wypisane na sucho: `threshold = 5`, `scoreMin = 1`, `scoreMax = 10`,
`assertionsDigest = ae850751ab7e…`.

**Do adnotacji dopisano SZÓSTE pole, `notes.redCells`** — ręcznie, drogą, którą `buildRecord`
przewiduje wprost (zastany blok `notes` przechodzi przez zapis nietknięty). Powód: plik był
uczciwy co do liczb i MYLĄCY co do wniosku. Pięć pól obowiązkowych mówi, czym te liczby nie są
w ogólności; żadne z nich nie mówiło, że dwie czerwone komórki tego konkretnego przejścia to
`error_max_turns` przy `maxTurns: 2`, a NIE regresja promptu — więc czytelnik za miesiąc wziąłby
je za dowód, że prompt jest zepsuty. To ta sama klasa co komunikat opisujący nie tę przyczynę.

Adnotacja **datuje się sama**: cytuje `generatedAt` przejścia, którego dotyczy, i niesie
ostrzeżenie, że `--record` zachowa ją także nad macierzą, w której nie ma już czerwieni. To jest
cena ręcznego dopisku do bloku, który z założenia przeżywa zapis — nazwana, nie przemilczana.

Sprawdzone po dopisku: `npx prettier --check` → kod 0, a `checkRecord()` (rdzeń przyszłej zapadki,
uruchomiony na pliku z drzewa) zwraca **dokładnie dwa problemy — oba `cellRed`**. Kształt,
komplet adnotacji, odcisk, kompletność macierzy i round-trip serializacji są zielone; szósty klucz
w `notes` niczego nie zepsuł.

### Obserwacje miękkie — zapisane, NIE awansowane (kryterium 3.7)

`conditional-null-contract` ma status `skip` we wszystkich czterech komórkach, z dwóch RÓŻNYCH
powodów, i ta różnica jest sama w sobie ustaleniem:

- na `sample.diff` (2 komórki) — „fikstura nie deklaruje, że oba kryteria warunkowe są bez
  zastosowania”, czyli obserwacja z definicji jej nie dotyczy;
- na `clean-text-change.diff` (2 komórki) — „brak recenzji w odpowiedzi”. To jest fikstura, dla
  której ta obserwacja POWSTAŁA, i na której jako jedyna coś mierzy.

**Wniosek: to przejście nie zmierzyło obserwacji miękkiej ani razu.** Komórka, która wypala tury,
nie oddaje recenzji, więc nie ma czego obserwować. Dopóki `clean-text-change.diff` nie dojeżdża,
pytanie z Open Risk (czy kontrakt `null` domknąć do asercji twardej) jest **niemierzalne**, a nie
tylko nierozstrzygnięte. Żadnej obserwacji nie awansowano.

---

## Zatrzymanie fazy 3 — uzasadnienie decyzji

Kryterium 3.6 planu mówi wprost: „jeśli nie, ZATRZYMAJ SIĘ: czerwona komórka na niezmienionym
prompcie jest sygnałem o macierzy, nie o zapadce, i wymaga rozstrzygnięcia przed fazą 4”.
Prompt nie był ruszany — `callFingerprint` się zgadza — więc sygnał jest o macierzy.

Rozważono i **odrzucono** dwie drogi na skróty. Powody są ważniejsze od samej decyzji:

### Odrzucone: podniesienie `maxTurns` 2 → 3 i ponowne przejście

**Po pierwsze, to jest ZGADYWANIE — i to zapisane jako takie.** Open Risk 4 poprzedniej zmiany
mówi wprost: dopóki nie wiadomo, co te liczniki liczą, żadna nowa wartość nie jest wyborem, tylko
zgadywaniem. Nic się od tego czasu nie zmieniło. Nadal nie wiemy, dlaczego haiku raportuje
`numTurns: 3` przy `maxTurns: 2` i kończy sukcesem
(`measurement-negative-control.md:136`, rozbieżność odłożona wtedy jako „do wyjaśnienia osobno”),
a dziś na tej samej wartości oblewa. Podniesienie na 3 nie jest naprawą — jest kolejnym
losowaniem, tyle że za pieniądze.

**Po drugie, i to jest cięższe od budżetu: `maxTurns` to oś 4 odcisku ORAZ parametr wywołania
recenzenta PRODUKCYJNEGO.** Podniesienie go zmienia zachowanie agenta na KAŻDYM PR-ze. To byłaby
zmiana produkcyjna przemycona do zmiany o bramce — wprost łamiąca kryterium **dyscypliny zakresu**
z naszego własnego zestawu review.

Budżet jest tu argumentem trzecim, nie pierwszym: przejście przy `maxTurns: 3` byłoby DROŻSZE od
tego (więcej tur = więcej tokenów), a zostało ~0,265 USD z 0,50.

### Odrzucone: przyjęcie czerwieni przez zmiękczenie D-6

Odrzucone **teraz i z tego powodu**, nie na zawsze — patrz pytanie projektowe niżej.

---

## Ustalenia do zabrania do re-planu

### Fakt 1 (ZMIERZONY, nowy) — granica `maxTurns: 2` jest własnością FIKSTURY, nie gemini

Dotąd zapis brzmiał: na kontroli negatywnej oblewa gemini. Podstawa była taka:

| przebieg                                    | haiku / `clean-text-change.diff`     | gemini / `clean-text-change.diff` |
| ------------------------------------------- | ------------------------------------ | --------------------------------- |
| Pomiar kontroli negatywnej (zimno)          | **pass**, `numTurns: 3`, asercje 5/5 | `api_error`, potem `max_turns`    |
| Faza 7 poprzedniej zmiany                   | pass, ale **TRAFIENIE cache'u**      | `max_turns`                       |
| **To przejście (zimno, wszystkie komórki)** | **`error_max_turns`**                | **`error_max_turns`**             |

Haiku przeszło tę fiksturę na zimno **raz na dwie** historyczne próby, a jego zieleń w fazie 7 nie
była nowym pomiarem, tylko odczytem z cache'u. Dziś, na zimno, oblewają **oba** tanie modele tym
samym błędem.

To **rozszerza Open Risk 4**: granica nie jest własnością gemini, tylko własnością tej fikstury
przy `maxTurns: 2`. Kandydat na wpis do `lessons.md`: zieleń pochodząca z trafienia cache'u nie
jest pomiarem i nie wolno jej liczyć jako próby — a raport pokazuje to w kolumnie `cache`, którą
łatwo przeczytać jako detal wydajnościowy.

### Fakt 2 (ZMIERZONY, kosztowy) — wypalona komórka PŁACI i nie oddaje licznika

| pozycja                                 | kwota            |
| --------------------------------------- | ---------------- |
| kotwica planu (prognoza)                | 0,12 USD         |
| suma z raportu (2 komórki zmierzone)    | 0,110343 USD     |
| **realny rachunek z `/api/v1/key`**     | **0,235012 USD** |
| różnica przypisana 2 komórkom wypalonym | ~0,124669 USD    |

**Realny wydatek to 2× kotwica.** Powód jest strukturalny, nie jednorazowy: komórka, która wypala
tury, została policzona przez dostawcę, a `usage` z SDK nie przyszło — więc jej kwoty nie da się
policzyć i nie ma jej w żadnej sumie raportu. Widać ją wyłącznie w różnicy odczytów klucza.

**Reguła do zapisania na przyszłość**: przy szacowaniu kosztu macierzy z NIEPEWNYM `maxTurns`
trzeba założyć, że część komórek zapłaci za nic. Prognoza liczona z kosztu komórek udanych jest
z definicji zaniżona, i to nie o szum, tylko o krotność.

### Pytanie projektowe — do rozstrzygnięcia W OSOBNEJ SESJI, nie tutaj

**Czy D-6 nie zlało dwóch różnych twierdzeń: „dowód jest ŚWIEŻY wobec promptu” oraz „dowód jest
ZIELONY”?**

Zapadka miała pilnować, ŻE ZMIERZYŁEŚ. Czy ma też pilnować, ŻE WYSZŁO DOBRZE — to jest osobne
twierdzenie, którego D-6 nie rozdziela. Rekord z dwiema czerwonymi komórkami jest uczciwym opisem
dzisiejszego stanu, a nie brakiem dowodu; dzisiejsza bramka odczytałaby go jako brak.

> ⚑ **Ostrzeżenie, bez którego to pytanie jest podejrzane.** Pojawia się DOKŁADNIE w momencie,
> w którym jego rozstrzygnięcie nas odblokowuje. Rozstrzygnięcie „poluzujmy D-6” podjęte TERAZ
> byłoby produkowaniem zieleni przez zmianę definicji zielonego — tym samym ruchem, którego ta
> praca odmówiła przy kryterium 7.5 poprzedniej zmiany. Pytanie ma zostać rozstrzygnięte na
> argumentach, w osobnej sesji planowania, nie pod presją budżetu i nie przez agenta, którego
> zadanie to odblokowuje.

---

## Czy da się podzielić tę zmianę — odpowiedź

**Nie na granicy faz, i nie chcę tego naciągać.** Poniżej, co niesie wartość samo z siebie, a co
nie, i gdzie dokładnie leży zależność.

**Fazy 1 i 2 są już wdrożone i stoją samodzielnie** (`be29442`, `f8a9e80`). Ich wartość nie zależy
od zielonej macierzy i już się zmaterializowała:

- odcisk wyszedł spod `promptfoo` (`agents/review/evals/fingerprint.ts`), więc ścieżka odcisku
  jedzie po `npm ci --omit=dev` — to jest zysk niezależny od tego, czy zapadka powstanie;
- kształt dowodu jest ZMIERZONY jako prettier-czysty, i to przejście właśnie potwierdziło pomiar
  na dowodzie prawdziwym, nie sfabrykowanym;
- oba rdzenie mają dwustronne kontrole pozytywne.

**Faza 4 rozpada się na dwie połowy o różnym statusie.** Kod obu checkerów i workflow dają się
napisać i przetestować bez zielonej macierzy — ich testy jednostkowe jadą na rekordach
SFABRYKOWANYCH (kontrola pozytywna per oś), nie na tym z drzewa. Ale kryterium 4.3 („oba checkery
na czystym drzewie → kod 0”) wymaga rekordu, który przechodzi — a dzisiejszy nie przechodzi.
Zbudowana teraz faza 4 dałaby bramkę, która potrafi zaświecić na CZERWONO i nie potrafi na
ZIELONO. To jest ta sama klasa co bramka zawsze zielona, tylko odwrócona: równie niefalsyfikowalna
i dodatkowo ucząca ludzi ignorować własną czerwień.

**Faza 5 jest zablokowana strukturalnie, bez połowy do uratowania.** Jej cała treść to dwustronna
kontrola pozytywna: sonda → czerwień → rewert → **zieleń**. Bez zielonej linii bazowej nie ma
czego rewertować do. Kryterium 5.5 jest nieosiągalne z definicji, a nie „trudne”.

Zależność nie jest wygodą — jest strukturalna: fazy 4 i 5 potrzebują zielonej linii bazowej,
a zielona linia bazowa potrzebuje macierzy, która potrafi dojechać. Jedyną rzeczą, która by je
rozłączyła, jest rozstrzygnięcie pytania projektowego wyżej (czy `ok: false` ma czerwienić
zapadkę) — czyli dokładnie ta decyzja, której nie wolno podjąć pod presją odblokowania.

**Podział, który proponuję**, jest więc inny niż „fazy 1-2-4-5 kontra faza 3”:

1. **Ta zmiana zostaje zatrzymana po fazie 2**, z dowodem w drzewie i tym dokumentem jako
   zapisem, dlaczego dalej nie poszła.
2. **Nowa zmiana: „macierz, która potrafi dojechać”** — wyjaśnić rozbieżność `numTurns` vs
   `maxTurns` (pomiar, nie zgadywanie), rozstrzygnąć wartość `maxTurns` świadomie i jako zmianę
   PRODUKCYJNĄ agenta, z własnym budżetem i własną kotwicą odcisku.
3. **Osobna sesja planowania na pytanie projektowe D-6** — niezależna od obu powyższych i
   nierozstrzygana przez nikogo, kogo jej wynik odblokowuje.
4. **Fazy 4 i 5 wracają dopiero nad macierzą, która potrafi zzielenieć** — czyli po (2), a jeśli
   (3) rozstrzygnie się w drugą stronę, to w kształcie, który ta decyzja wyznaczy.

> ⚑ **KOREKTA punktu 2 tej propozycji — 2026-08-23, decyzja D-8.** Człowiek rozstrzygnął inaczej:
> „macierz, która potrafi dojechać" NIE staje się osobną zmianą, tylko wchodzi do TEJ jako
> faza 3a, a budżet rośnie 0,50 → 1,50 USD. Powód (pełny zapis w `requirements.md`): obie połowy
> dzielą oś 4 odcisku, więc rozdzielone musiałyby się nawzajem przekotwiczać. Punkty 1, 3 i 4
> zostają w mocy — w szczególności punkt 3, czyli pytanie o D-6, dalej nie jest rozstrzygane tutaj.

---

## Faza 3a.1 — POMIAR licznika tur. Sześć przebiegów

**Data**: 2026-08-23
**Gałąź**: `review-eval-gate`, HEAD `317a720`
**Fikstura**: `agents/review/evals/fixtures/clean-text-change.diff` (ta, która dziś nie dojeżdża)
**Siatka**: 2 modele × `maxTurns` ∈ {3, 4, 5}, po JEDNYM przebiegu na komórkę
**Klucz**: `ANTHROPIC_AUTH_TOKEN` zmapowany z `OPENROUTER_REVIEW_KEY` na czas komendy
**Dane surowe**: `context/changes/review-eval-gate/measurement-turn-counter.json`

### Jak mierzono — i czego NIE dotknięto

`maxTurns` nadpisywany przez szew, który `runReview` już ma: wstrzykiwalne `query`. Wrapper
podmienia `options.maxTurns` i podgląda strumień, żeby złapać wiadomość `result` TAKŻE wtedy, gdy
`runReview` rzuci — bo `numTurns` na przebiegu NIEUDANYM jest tu całym przedmiotem pomiaru.
**W drzewie nie zmieniła się ani jedna linia produkcyjna**: `agents/review/run-review.ts` ma dalej
`maxTurns: 2` (kryterium 3a.2 sprawdzone przez `git status`). Skrypt pomiarowy żyje poza repo.

**Cap budżetu SDK podniesiony na czas pomiaru do 2,0 USD** (macierz używa 0,6) i to jest decyzja,
nie niechlujstwo: pytaniem jest licznik TUR, a przebieg ubity capem oddałby
`error_max_budget_usd` zamiast odpowiedzi o turach. Realny wydatek ogranicza się i tak tokenami,
a odczyt `/api/v1/key` między przebiegami widzi go od razu.

### Wynik — sześć przebiegów

| #   | model            | `maxTurns` | `numTurns` | `subtype`                             | `terminal_reason`                   | wynik |
| --- | ---------------- | ---------- | ---------- | ------------------------------------- | ----------------------------------- | ----- |
| 1   | haiku-4.5        | **3**      | **3**      | `success`                             | `completed`                         | ✅    |
| 2   | gemini-2.5-flash | **3**      | **4**      | `error_max_turns`                     | `max_turns`                         | ❌    |
| 3   | haiku-4.5        | **4**      | **3**      | `success`                             | `completed`                         | ✅    |
| 4   | gemini-2.5-flash | **4**      | **3**      | `success`                             | `completed`                         | ✅    |
| 5   | haiku-4.5        | **5**      | **3**      | `success`                             | `completed`                         | ✅    |
| 6   | gemini-2.5-flash | **5**      | **6**      | `error_max_structured_output_retries` | `structured_output_retry_exhausted` | ❌    |

Tokeny i czas (z SDK — sprawozdawczo, NIE do rachunku):

| #   | out   | cache zapis | cache odczyt | czas [ms] | `total_cost_usd` SDK |
| --- | ----- | ----------- | ------------ | --------- | -------------------- |
| 1   | 8 313 | 54 776      | 32 778       | 88 360    | 0,574589             |
| 2   | 2 989 | 53 873      | 53 873       | 197 024   | 0,725685             |
| 3   | 5 364 | 20 440      | 65 556       | 49 680    | 0,302413             |
| 4   | 3 918 | 53 830      | 53 830       | 25 794    | 0,468173             |
| 5   | 4 803 | 20 388      | 65 556       | 48 806    | 0,288153             |
| 6   | 7 308 | 110 017     | 110 017      | 52 304    | 0,932225             |

### Rachunek

| moment                                    | `usage`         |
| ----------------------------------------- | --------------- |
| przed przebiegiem 1                       | **3,850512303** |
| po przebiegu 6 (odczyt natychmiastowy)    | **4,198824674** |
| **odczyt OPÓŹNIONY, `2026-08-23T17:41Z`** | **4,232249153** |

**Pomiar kosztował 0,381737 USD** (prognoza: ~0,35). Odczyt opóźniony dołożył **0,033424** ponad
odczyt natychmiastowy — czyli opóźnione księgowanie zadziałało tym razem realnie, dokładnie tak,
jak przewiduje reguła z `measurement-negative-control.md:154-157`.

**Łącznie na tę zmianę: 0,235012 (faza 3) + 0,381737 (faza 3a.1) = 0,616749 USD z 1,50 USD.**

> ⚑ **Kosztu POJEDYNCZEGO przebiegu ten pomiar NIE ustala i nie wolno go z tej tabeli czytać.**
> Odczyty między przebiegami są rozjechane opóźnionym księgowaniem tak mocno, że kolumna „delta"
> byłaby fikcją: przebieg 3 (haiku, udany, 5 364 tokeny wyjścia) pokazuje deltę **0,000000**,
> a przebieg 2 (gemini, model kilkukrotnie tańszy) — **0,143496**, czyli oczywiście cudzy rachunek
> zaksięgowany z poślizgiem. Wiarygodna jest wyłącznie **suma**, bo jest domknięta odczytem
> opóźnionym z obu stron. Per-przebieg wymagałby okien izolowanych odczekaniem, czego ta siatka
> nie robiła. Surowe `usageBefore`/`usageAfter` są w JSON-ie obok — jako dane, nie jako rachunek.

> Uwaga porządkowa: `limit_remaining` klucza `OPENROUTER_REVIEW_KEY` w trakcie tej sesji wzrósł
> (cap podniesiony poza tą zmianą). Budżetem tej zmiany jest kotwica 1,50 USD z `requirements.md`,
> nie cap klucza — i to ona wiąże.

### ⚑ Odpowiedź na pytanie fazy: czy WIADOMO, co liczy `numTurns`?

**NIE. Nadal nie wiadomo — i dlatego nie proponuję wartości `maxTurns`.**

Pomiar dołożył trzy fakty i ani jeden z nich nie jest odpowiedzią:

1. **`numTurns` POTRAFI PRZEKROCZYĆ `maxTurns`** — przebieg 2 (4 > 3) i przebieg 6 (6 > 5). Więc
   nie jest to licznik przycinany capem. To wyklucza najprostszą hipotezę („to ta sama wielkość"),
   ale nie mówi, czym jest.
2. **haiku jest STABILNY na `numTurns: 3`** przy capach 3, 4 i 5 — trzy przebiegi, trzy razy ta
   sama liczba, za każdym razem `completed`.
3. **Przy capie 5 gemini oddało NOWĄ klasę awarii** — `error_max_structured_output_retries`
   (`structured_output_retry_exhausted`), która z turami nie ma wprost nic wspólnego. Czyli
   podnoszenie capu **nie pomaga monotonicznie**: wyżej czeka inny licznik, którego ten pomiar
   nie dotknął ani razu.

**Czego to NIE wyjaśnia — czyli oryginalnej anomalii.** Zapisany przypadek brzmi: haiku,
`maxTurns: 2`, `numTurns: 3`, `terminal_reason: completed`. Siatka miała 3/4/5, więc `maxTurns: 2`
nie został powtórzony ani razu i anomalia stoi nietknięta. Co gorsza, nowe dane czynią ją
**bardziej** dziwną, nie mniej: z przebiegów 1 i 2 układa się reguła „na sukcesie `numTurns` ≤ cap,
na wywrotce `numTurns` = cap + 1" — a pod tą regułą haiku z `numTurns: 3` przy capie 2 wywrócić
się MUSIAŁO. Raz się nie wywróciło. Przebieg 6 tę regułę i tak łamie z drugiej strony
(`numTurns` 6 przy capie 5, ale `terminal_reason` NIE jest `max_turns`).

**Druga, niezależna dziura: ta siatka nie potrafi przypisać różnic capowi.** Jeden przebieg na
komórkę, a niestabilność gemini między identycznymi przebiegami jest w tym repo **zmierzona**
(`verification.md` poprzedniej zmiany: ten sam model, materiał i prompt, dwa różne wyniki). Gemini
dało tu trzy różne zakończenia przy trzech capach — i przy n = 1 **nie da się odróżnić „zrobił to
cap" od „zrobił to przebieg"**. Do rozdzielenia trzeba powtórzeń na komórkę, których ten pomiar
nie miał.

**Pułapka, którą nazywam, żeby jej nie wdepnąć.** Z tabeli kusi wniosek „cap 4, bo to jedyna
wartość, przy której oba modele przeszły". To jest dokładnie wybór z niezrozumianego licznika:
gemini przeszło przy 4, a oblało przy 3 i przy 5 — pod modelem o zmierzonej niestabilności to nie
jest sygnał monotoniczny, tylko jeden rzut monetą na komórkę. Wdrożenie tej wartości do wywołania
PRODUKCYJNEGO (D-8) na takiej podstawie byłoby zgadywaniem, tyle że droższym i na każdym PR-ze.

**Wobec tego 3a.2 się NIE odbywa.** Warunkiem wejścia w wybór wartości było, żeby 3a.1
odpowiedziało na pytanie o licznik. Nie odpowiedziało. Wracamy do rozmowy.

---

## Decyzja po pomiarze 3a.1 — rozdzielenie przyczyn w rekordzie

**Data**: 2026-08-23, po `fadc918`
**Rozstrzygnął**: człowiek, nad tabelą sześciu przebiegów

Pomiar rozstrzygnął sprawę **w drugą stronę, niż zakładała faza 3a**. Nie wybieramy capu — zmieniamy
to, co zapadka uznaje za czerwień.

### Co się zmienia

Rekord i zapadka rozróżniają DWIE rzeczy, które `ok: false` zlewało w jedną:

- **(A) MODEL NIE DOWIÓZŁ** — `max_turns`, wyczerpane retry structured output, brak łączności.
  Odpowiedzi NIE MA, więc nie ma czego porównywać z promptem. Stan **KWALIFIKACJI MODELU**:
  zapisywany, widoczny, raportowany — **nie blokuje**.
- **(B) PROMPT ZREGRESOWAŁ** — odpowiedź przyszła, ale nie spełnia asercji. **Zapadka czerwieni.**

`maxTurns` i `FIXED_CALL_OPTIONS` **zostają NIETKNIĘTE**. Wywołanie produkcyjne się nie zmienia,
`callFingerprint` `59ee111b…` zostaje kotwicą, przekotwiczenie z fazy 3a jest niepotrzebne
i zostało cofnięte (ślad w planie, sekcja „Przekotwiczenie — ROZWAŻONE I COFNIĘTE").

### ⚑ Dlaczego to NIE jest poluzowanie pod presją — i dlaczego to ostrzeżenie tu stoi

To jest **dokładnie pytanie o D-6, rozstrzygane w momencie, w którym jego rozstrzygnięcie nas
odblokowuje** — czyli w tym, przed którym sam ostrzegałem w sekcji „Pytanie projektowe" wyżej.
Ostrzeżenie zostaje zapisane **razem z decyzją, nie zamiast niej**: kto to czyta za rok, ma zobaczyć
obie rzeczy naraz, a nie samo rozstrzygnięcie z wygodną datą.

Dwa argumenty, które mimo to przeważają:

**1. To repo już ma ten kontrakt — piętro wyżej, i to dosłownie.** `pr-review.yml:10-15` mówi
o bramce review: _„A red run here means REVIEW DID NOT HAPPEN — never that review went badly."_
Bramka produkcyjna **od początku** oddziela BRAK WYKONANIA od ZŁEGO WYNIKU. D-6 wprowadzało w tym
samym repo kontrakt **ODWROTNY**: czerwień z „nie dowiózł" i czerwień z „wynik zły" zlane w jedną.
Zmiana nie rozluźnia standardu — **usuwa niespójność z kontraktem, który już obowiązuje**.

**2. Decyzja stoi na NOWEJ WIEDZY, nie na wygodzie.** Pomiar 3a.1 (0,381737 USD) ustalił trzy
rzeczy, których 2026-08-23 rano nie wiedzieliśmy: czerwień bierze się z `error_max_turns`
i `error_max_structured_output_retries` **przy niezmienionym promptcie**; `numTurns` potrafi
przekroczyć cap; podnoszenie capu **nie pomaga monotonicznie** (przy 5 czeka inny licznik). Gdyby
decyzja zapadła przed pomiarem, byłaby tym, przed czym ostrzegałem. Zapadła po nim i na nim.

### ⚑ Dziura, której trzeba pilnować — i odpowiedź, czy zamyka się w tej zmianie

**Dziura jest realna**: zmiana promptu, która wpycha model w pętlę, **wywoła `max_turns`** —
przyczyna siedzi w promptcie, a objaw wygląda jak niedowiezienie. Zapadka zostałaby wtedy zielona
nad regresją, którą miała łapać.

**Odpowiedź: TAK, zamyka się w tej zmianie i nie rozdmuchuje zakresu.** Mechanizm to D-9 w planie.
Trzy rzeczy o tym rozstrzygają:

1. **Klasyfikacja (A)/(B) NIE wymaga nowego przejścia macierzy.** Jest wyprowadzalna z pola, które
   rekord **już niesie** — `contract`. `contract === "ok"` zachodzi dokładnie wtedy, gdy `runReview`
   nie rzuciło, bo `response.error` ustawia wyłącznie nasz provider (`report.ts:148-149`).
   Mapowanie idzie po KLASIE AWARII, nigdy przez parsowanie tekstu komunikatu — inaczej złamałoby
   lekcję „Stan niesiony przez DWA pola". **Koszt: zero.** Dzisiejszy rekord zostaje bez zmian.
2. **Reguła przejścia jest ADDYTYWNA.** `previousDelivery` (odcisk poprzedniego rekordu + jego
   klasyfikacja per komórka) pisze `buildRecord` z `existing`, które **już czyta** — read-modify-write
   jest w module od fazy 2, więc to nie jest nowy szew. Przy braku bloku checker po prostu reguły
   nie stosuje.
3. **Robota mieści się w modułach, które ta zmiana i tak buduje**: jedna czysta funkcja, jedno
   porównanie w checkerze, jedno przeniesienie w zapisywaczu — faza 2 i faza 4, po jednej stronie
   granicy kierunkowej.

**Reguła**, dla każdej komórki: `previousDelivery.fingerprint !== callFingerprint` **ORAZ**
poprzednio `delivered` **ORAZ** dziś `!delivered` → **CZERWIEŃ**. Czyli przejście na „nie dowiózł"
jest regresją **tylko wtedy, gdy między pomiarami zmieniło się wywołanie**. Ten sam odcisk i inny
wynik to niestabilność modelu — zmierzona, nieblokująca.

**Trzy ceny, nazwane — bo bez nich to zamknięcie byłoby deklaracją, nie mechanizmem:**

1. **Reguła jest BEZCZYNNA do następnego przejścia macierzy.** `previousDelivery` powstanie dopiero
   przy kolejnym `--record`. Testowalna w pełni na rekordach sfabrykowanych, ale **żywych danych
   dziś nie ma** i nie udajemy, że są.
2. **Dwie dzisiejsze komórki (A) są ŚLEPE po tej osi**, dopóki raz nie dowiozą — nie da się
   zregresować z „już nie dowoziłem". `clean-text-change.diff` jest więc niepilnowany na
   dowiezieniu, i to jest bezpośrednia konsekwencja przyjęcia (A) jako stanu dopuszczalnego.
3. **Flake w stronę niedowiezienia pod nowym odciskiem kosztuje jedno przejście.** Ta sama cena co
   w starym Open Risk 2, ale na powierzchni DUŻO węższej: nie „każda czerwona asercja", tylko
   przejście `dowiózł → nie dowiózł` przy zmienionym wywołaniu.

Dodatkowo, przy okazji mapowania klas, dwie rzeczy, których „(A) nie blokuje" **nie obejmuje** —
obie czerwienią:

- **`[contract]` jest po stronie (B), nie (A).** „Model odpowiedział, ale złamał wymuszony schemat"
  to sygnał o PROMPCIE — dokładnie klasa, którą naprawiał `0d3eba5`. Wrzucona do (A) byłaby tym
  samym połknięciem, co pętla udająca niedowiezienie.
- **Klasa NIEROZPOZNANA czerwieni (fail-closed)**, tak samo `[config]` (przejście się nie odbyło).
  Inaczej nowy podtyp awarii SDK stałby się po cichu nieblokujący — a cicha nieblokowalność jest
  gorsza niż brak bramki, bo zdejmuje czujność.

### Budżet — podniesiony i NIEWYKORZYSTANY

Wydatek kończy się na **0,616749 USD** (0,235012 + 0,381737) z 1,50 USD. Dalsze fazy nie wołają
modeli: rozwiązaniem okazało się rozdzielenie przyczyn w zapadce, a nie kolejne przejście macierzy —
**dzisiejszy rekord staje się ważnym dowodem takim, jaki jest**. Podniesienia nie cofamy (decyzja
była podjęta jawnie), ale 1,50 to **sufit, którego ta zmiana nie dotknęła**, a nie środki do wydania.

### ⚑ Poprawka mapowania klas — `[unknown]` wraca do czerwieni (2026-08-23, po zatwierdzeniu D-9)

Pierwsza wersja tabeli D-6 wpisywała `[unknown]` do klasy (A), nieblokującej. **To był błąd
znoszący fail-closed** i człowiek go złapał, zanim cokolwiek na nim stanęło.

`unknown` jest w tym repo **jawnym KOSZEM NA NIEWIADOME**: `classifyFailure` kończy się
`return "unknown"`, a komentarz przy `reportFailureKind` mówi wprost „konsument traktuje brak
wartości jak `unknown`, czyli fail-closed". Kosz umieszczony w klasie nieblokującej **odwraca** tę
własność — i przeczy ostatniemu wierszowi tej samej tabeli, który obiecywał czerwień dla klasy
nierozpoznanej. Dzisiejsze dwie komórki mają `[unknown]` nie dlatego, że wiemy, iż to
niedowiezienie, tylko dlatego, że **klasyfikator nie umiał ich nazwać** — a tą samą drogą przejdzie
kiedyś awaria WYWOŁANA promptem.

Poprawka: (A) klasyfikowane po **podtypach wymienionych z imienia**
(`error_max_turns` / `max_turns`, `error_max_structured_output_retries` /
`structured_output_retry_exhausted`, `[provider]`, `[budget]`), a wszystko, co nie dopasuje się do
nazwanego wiersza — łącznie z `[unknown]` — **czerwieni**. Nowy podtyp awarii SDK trafia do kosza
i blokuje, zamiast milczeć.

### Gdzie giną `subtype` i `terminal_reason` — prześledzone do końca

**Rekord NIE niesie ich strukturalnie. Są wyłącznie w prozie `failures[].reason`.**

| ogniwo               | co przenosi                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------- |
| SDK → `runReview`    | `subtype`, `terminal_reason` jako pola wiadomości                                            |
| `classifyFailure`    | czyta oba, zwraca **wyłącznie** `FailureKind`                                                |
| `reviewFailure`      | `Object.assign(new Error(...), { kind })` — **jedno pole**; oryginały tylko wewnątrz stringa |
| provider (`runCell`) | `{ ok, failureKind, message }`                                                               |
| promptfoo            | `metadata.failureKind` + `response.error` (proza)                                            |
| `eval-record.json`   | `contract` + `failures[].reason` (proza)                                                     |

Sprawdzone też trzy miejsca, w których wartości mogłyby przetrwać poza tym łańcuchem, i **żadne
ich nie ma**: `reportFailureKind` zapisuje samo `failure-kind=` do `$GITHUB_OUTPUT` (a w evalu jest
CICHE, bo `GITHUB_OUTPUT` nie istnieje); cache promptfoo trzyma **wyłącznie komórki UDANE**
(`writeCell` woła się na sukcesie); `results.json` przejścia leży w katalogu tymczasowym kasowanym
w `finally`.

### Co z tego wynika — i czego NIE zrobiłem

**Rekord trzeba rozszerzyć o `subtype` i `terminalReason`.** Zmiana kodu jest addytywna i tania:
`ReviewFailure` dostaje dwa opcjonalne pola niosące to, co SDK i tak dało, dalej przez provider →
`ReportRow` → `EvalRecordCell`. **Nie rusza `callFingerprint`** (osiami odcisku są `tools`
i `maxTurns`, nie warstwa klasyfikacji), nie zmienia `failure-kind=` czytanego przez
`pr-review.yml`, nie zmienia komunikatu. `classifyFailure` zostaje nietknięta — przenosimy pola,
których ona i tak używa, zamiast dokładać jej gałęzi.

**Ale kodu nie da się wypełnić danymi.** Dla dzisiejszego rekordu wartości istnieją na dysku
wyłącznie w prozie, a prozy nie parsujemy: to byłaby ta sama klasa, którą tropi lekcja „Stan
niesiony przez DWA pola", tyle że drugim polem byłby string przeznaczony dla człowieka.

> **Wypełnienie wymaga PONOWNEGO PŁATNEGO PRZEJŚCIA — i nie zostało wykonane.**
> **Kotwica: ~0,235 USD.** Przejście identyczne w kształcie z dzisiejszym (`maxTurns` nietknięty,
> więc znów 2 komórki dowiozą i 2 wypalą); dzisiejsze kosztowało **0,235012**, rozrzut dziesiątek
> procent. Budżet to unosi: wydane 0,616749 z 1,50, **zostaje 0,883251**.
> **Ryzyko do zapisania:** gemini bywa niestabilne między przebiegami, więc powtórzenie NIE
> gwarantuje tego samego układu komórek.

**Droga za 0 USD, wymieniona i NIEPOLECANA:** przepisać dwie wartości z prozy ręcznie, raz, z
zapisem tutaj. Wada nie jest formalna — to wpisanie **danych pomiarowych ręką** do pliku, którego
cała doktryna brzmi „wytwarzany komendą, nie pisany ręcznie" (`remedyFor`, gałąź `malformed`),
czyli dokładnie ta powierzchnia fałszowania, o której Open Risk 3 mówi, że jej nie domykamy.
Adnotacja `notes.redCells` była KOMENTARZEM; to byłby POMIAR.

**Stan otwarty:** dopóki decyzja nie zapadnie, dzisiejszy `eval-record.json` **czerwieni pod
poprawioną tabelą** — jego dwie komórki `[unknown]` nie mają nazwanego podtypu. To jest uczciwa
konsekwencja fail-closed, a nie nowa awaria.

---

## Kroki 1–2 po decyzji D-6/D-9 — kształt rekordu i zapadka. ZERO wydatku

**Data**: 2026-08-23, po `35f3874`
**Wydatek**: **0,00 USD.** Żaden model nie został zawołany.

### Krok 1 — pola strukturalne `subtype` / `terminalReason`

Przeniesione przez cały łańcuch, tam gdzie dotąd ginęły: `ReviewFailure` (obok `kind`, nie zamiast
niego) → `ReviewMetrics` → `CellResult` providera → `metadata` promptfoo → `ReportRow` →
`EvalRecordCell`. `classifyFailure` **nietknięta** — przenosimy pola, których ona i tak używa,
zamiast dokładać jej gałęzi. `callFingerprint` niezmieniony: osiami odcisku są `tools` i `maxTurns`,
nie warstwa klasyfikacji.

Pod testem stoi to, po co ta zmiana jest, a nie sam fakt istnienia pól: rzut z `error_max_turns`
niesie `subtype` JAKO POLE przy `kind === "unknown"` — czyli w przypadku, w którym kosz na
niewiadome sam z siebie nie odróżnia niczego. Drugi test pilnuje, że ścieżka bez wiadomości
`result` **nie udaje**, że zna `subtype`: `undefined`, nie pusty string.

Walidacja kształtu odrzuca rekord sprzed tej zmiany z NAZWANYM powodem, zamiast po cichu czytać
brakujące pole jako `null`:

```
matrix[0].subtype nie istnieje — rekord sprzed rozdzielenia przyczyn (D-6)
```

To jest zamierzone: rekord bez tych pól kazałby zapadce klasyfikować niedowiezienie po polu,
którego nie ma, czyli wpuszczać KAŻDĄ komórkę `[unknown]`.

### Krok 2 — zapadka

`agents/review/evals/check-eval-record.ts`, `scripts/check-verdict-config.ts`,
`.github/workflows/eval-ratchet.yml`. Klasyfikacja (A)/(B), fail-closed na koszu, D-9 i osobna
klasa `cellNotRun` dla `[config]` — „nie odbyło się" to nie „nie umiemy nazwać", a diagnoza
wskazująca nie tę przyczynę jest tu całym defektem, nie niedogodnością.

Czternaście nowych przypadków testowych, każdy dwustronny: mutacja WEJŚCIA daje DOKŁADNIE swój
rodzaj problemu i tylko jego, przy kontroli zerowej w (D1). Nazwany podtyp NIE czerwieni, kosz
CZERWIENI, `[contract]` czerwieni jako (B) a nie jako niedowiezienie, obserwacje (A) idą osobnym
kanałem i komórka nierozpoznana NIE trafia tam wcale, przejście D-9 czerwieni pod zmienionym
odciskiem i NIE czerwieni pod tym samym.

⚑ **Korekta po impl-review (2026-08-24).** Ten akapit brzmiał wcześniej „każdy dwustronny (wzorzec
`blindTo`)" i to twierdzenie było MOCNIEJSZE niż to, co robi kod: `blindTo` z `cache.test.ts:92-104`
mutuje FUNKCJĘ decydującą, a te testy mutują WEJŚCIE. Zapis, który nazywa słabszy dowód mocniejszym,
jest tym samym kształtem, który ta zmiana tropi u innych — stąd korekta zamiast nadpisania.

**I dlaczego `blindTo` tutaj NIE zarabia na siebie** (rozstrzygnięcie, nie brak zasobów): tamten
wzorzec istnieje, bo w `cache.ts` wyjściem jest HASH — po zmienionym odcisku nie da się powiedzieć,
KTÓRA oś go ruszyła, więc oślepienie funkcji jest jedyną drogą do przypisania skutku osi. Tutaj
wyjściem jest `problems[].kind`, czyli NAZWA osi. Gdyby checker przestał czytać oś X, nie byłoby
ŻADNEGO problemu i test padłby na `length`. Blindness-testing zarabia na siebie przy wyjściu
NIEPRZEZROCZYSTYM; przy wyjściu, które samo się nazywa, dokłada szew w module produkcyjnym i nie
kupuje nowej informacji. Kontrakt fazy 4 wymieniał `blindTo` z nazwy — i to jest ta jedna pozycja
kontraktu, którą świadomie zrealizowano inaczej, z zapisanym powodem.

### ⚑ BRAMKA D-10 — i defekt, który złapała, zanim padł cent

Sfabrykowany rekord o docelowym kształcie przepuszczony przez PRAWDZIWY zapisywacz agencki
(`buildRecord` + `serializeRecord`, czyli rdzeń `writeRecord` z `report.ts`), PRAWDZIWY zapisywacz
`scripts/` (`run-verdict-config.ts --write`) i OBA prawdziwe checkery. Dwa scenariusze, bo jeden
nie dowodzi niczego:

| scenariusz                                               | `run-verdict-config` | `check-verdict-config` | `check-eval-record`        | `prettier` |
| -------------------------------------------------------- | -------------------- | ---------------------- | -------------------------- | ---------- |
| **S1** — stan OCZEKIWANY po zapłaceniu                   | 0                    | 0                      | **0**                      | 0          |
| **S2** — kontrola pozytywna: komórka poprzednio DOWOZIŁA | 0                    | 0                      | **1**, „PRZESTAŁA dowozić" | 0          |

**Pierwszy przebieg bramki NIE PRZESZEDŁ i to jest jej cała wartość.** Znalazł defekt, którego
żaden z istniejących testów nie widział: **dwaj zapisywacze trzymają DWIE KOPIE kolejności kluczy
rekordu** (granica kierunkowa zabrania wspólnego modułu), a przy dopisywaniu bloku
`previousDelivery` urosła tylko kopia po stronie agenta. Skutek: każdy z zapisywaczy emitował INNĄ
kolejność bajtów tego samego rekordu, więc checker czerwieniałby na round-tripie **zależnie od
tego, który pisał ostatni** — czerwień nie do zdiagnozowania z komunikatu.

Naprawione w obu kopiach, a zgodność jest teraz PINOWANA z obu stron granicy: literał w
`tests/lib/verdict-config.test.ts` i literał w `agents/review/evals/eval-record.test.ts`, każdy
z komentarzem wskazującym drugą kopię. Istniejący pin z fazy 2 zaświecił się przy tej zmianie na
czerwono — dokładnie tak, jak miał.

**Gdyby przejście macierzy kupiono PRZED tą bramką, dane wróciłyby w kształcie, który zaraz potem
trzeba by zmienić — czyli drugie ~0,235 USD za tę samą informację.** Kolejność z D-10 zapłaciła za
siebie przy pierwszym użyciu.

### Co to znaczy dla płatnego przejścia

**Kształt jest ZAMKNIĘTY.** Płatny przebieg dostarczy już tylko DANE. Warunek wejścia w fazę 3
(kryterium 3.0) jest spełniony.

### Kryterium 4.5 — oba checkery po `npm ci --omit=dev`

Na KOPII drzewa, nie na roboczym: `--omit=dev` usunąłby `promptfoo` i `tsx`, czyli zepsuł każde
następne przejście macierzy do czasu ponownej instalacji.

```
promptfoo: nieobecny (tak ma być)
tsx:       nieobecny (tak ma być)
node_modules: 354 MB   (pełny graf: ~2 099 MB)

check-eval-record.ts    -> exit 0   (+ dwie adnotacje ::notice, klasa (A))
check-verdict-config.ts -> exit 0
```

⚑ **Sprawdzenie nieobecności `promptfoo` i `tsx` jest częścią POMIARU, nie porządkiem.** Gdyby
którykolwiek został zainstalowany, przebieg zieleniłby się nad drzewem, w którym `--omit=dev`
niczego nie odjęło — czyli mierzyłby, że kod działa tam, gdzie i tak by działał. Bez tej kontroli
`ERR_MODULE_NOT_FOUND` wyszedłby dopiero na CI, gdzie czyta się go jako awarię bramki, a nie jako
brakującą zależność.

Adnotacje klasy (A) wychodzą jako `::notice` i **nie blokują** — to jest D-6 w działaniu na
prawdziwym runnerze, nie tylko w teście.

---

## Faza 3 (podejście DRUGIE) — przejście macierzy. DOMKNIĘTA

**Data**: 2026-08-23
**Gałąź**: `review-eval-gate`, HEAD `6eb9bb4`
**Klucz**: `ANTHROPIC_AUTH_TOKEN` zmapowany z `OPENROUTER_REVIEW_KEY` na JEDNO wywołanie
(nigdy `OPENROUTER_EVAL_KEY`, nigdy eksport na stałe)
**Komendy**: `npm --prefix agents/review run eval -- --record`, potem
`node --experimental-strip-types scripts/run-verdict-config.ts --write`
**Warunek wejścia**: kryterium 3.0 (bramka D-10) spełnione PRZED przejściem — kształt rekordu
zamknięty na rekordzie SFABRYKOWANYM, więc płatny przebieg dostarczył wyłącznie DANE.

### Rachunek — odczyty `/api/v1/key`

| moment                              | UTC                    | `usage`         |
| ----------------------------------- | ---------------------- | --------------- |
| kotwica dolna, PRZED przejściem     | `2026-08-23T19:20:57Z` | **4,248652133** |
| odczyt natychmiastowy, po przejściu | `2026-08-23T19:25:22Z` | **4,284443686** |
| odczyt OPÓŹNIONY (+3 min 47 s)      | `2026-08-23T19:28:56Z` | **4,387906986** |
| potwierdzenie stabilności (+23 s)   | `2026-08-23T19:29:19Z` | **4,387906986** |
| odczyt PÓŹNY (+7 min 53 s)          | `2026-08-23T19:33:02Z` | **4,387906986** |

**Realny wydatek: 0,139254853 USD.** Odczyt opóźniony dołożył **0,103463** ponad natychmiastowy —
czyli opóźnione księgowanie zadziałało i to mocno: odczyt zaraz po przebiegu pokazywał ledwie
0,0358, czyli **jedną czwartą** prawdziwego rachunku. Zastrzeżenie z
`measurement-negative-control.md:154-157` zostaje w mocy: rachunek domyka odczyt otwierający
NASTĘPNE okno pomiarowe, więc 0,139255 jest oszacowaniem DOLNYM, potwierdzonym dwoma odczytami.

**Suma z raportu obok: 0,103463 USD zapłacone.** Różnica wobec klucza — **0,035792 USD** — to
komórka wypalona (gemini / `clean-text-change.diff`): przebieg się odbył, dostawca go policzył,
SDK nie oddało liczników, więc nie ma jej w żadnej sumie raportu. Ten sam kształt co Fakt 2
z poprzedniego podejścia, tym razem z jedną wypaloną komórką zamiast dwóch.

### Budżet — i rozjazd, który złapało dopiero rozliczenie całościowe

| pozycja                                      | USD              |
| -------------------------------------------- | ---------------- |
| faza 3, przejście zatrzymane                 | 0,235012205      |
| faza 3a.1, sześć przebiegów pomiarowych      | 0,381737000      |
| faza 3, przejście drugie                     | 0,139254853      |
| **suma pozycji**                             | **0,756004058**  |
| **delta klucza** (4,387906986 − 3,615500098) | **0,772406888**  |
| **ROZJAZD**                                  | **+0,016402830** |

**Wiąże delta klucza: 0,772407 USD z 1,50. Zostaje ~0,728 USD.**

⚑ **Rozjazd nie jest błędem rachunkowym — jest ZMIERZONYM potwierdzeniem reguły, którą ten plik
cytuje trzy razy i która dotąd nie miała świadka.** „Odczyt opóźniony" fazy 3a.1
(`2026-08-23T17:41Z`, 4,232249153) został zapisany jako domknięcie tamtego rachunku. Kotwica dolna
TEGO przejścia, wzięta 1 h 40 min później, pokazuje **4,248652133** — czyli po tamtym „domknięciu"
doszło jeszcze **0,016403 USD**. Dokładnie to mówi
`measurement-negative-control.md:154-157`: rachunek zamyka odczyt otwierający NASTĘPNE okno
pomiarowe, a nie odczyt po przebiegu — więc każda kwota per faza jest oszacowaniem **DOLNYM**,
także 0,139255 z tego przejścia.

**Konsekwencja, którą zapisuję wprost: budżetu nie wolno rozliczać sumą pozycji per faza.**
Sumowanie dolnych oszacowań daje liczbę systematycznie ZANIŻONĄ, i to o tyle, o ile każda faza
kończyła się przed doknięciem się księgowania. Wiąże różnica dwóch odczytów: kotwicy sprzed
PIERWSZEGO wydatku zmiany i najpóźniejszego dostępnego. Pierwsza wersja tego akapitu podawała
0,772407 jako sumę trzech pozycji — **nieprawda, one sumują się do 0,756004** — i błąd wyszedł
dopiero przy ręcznym wykonaniu kryterium 3.5.

### Tabela przejścia

```
| model                      | fikstura               | werdykt | kontrakt  | tury | in   | out  | koszt USD | cache     | asercje |
| -------------------------- | ---------------------- | ------- | --------- | ---- | ---- | ---- | --------- | --------- | ------- |
| anthropic/claude-haiku-4.5 | sample.diff            | fail    | ok        | 3    | 18   | 6416 | 0.096255  | TRAFIENIE | 6/6     |
| google/gemini-2.5-flash    | sample.diff            | fail    | ok        | 3    | 0    | 3432 | 0.014088  | TRAFIENIE | 6/6     |
| google/gemini-2.5-flash    | clean-text-change.diff | BRAK    | [unknown] | BRAK | BRAK | BRAK | BRAK      | BRAK      | BRAK    |
| anthropic/claude-haiku-4.5 | clean-text-change.diff | pass    | ok        | 3    | 18   | 7857 | 0.103463  | zimna     | 5/5     |

Koszt komórek: 0.213806 USD z 3/3 komórek ZMIERZONYCH; trafienia cache'u: 2/3.
ZAPŁACONE w tym przejściu: 0.103463 USD (trafienia cache'u nie kosztują).
Komórek uruchomionych: 4; z tego ZMIERZONYCH 3, BRAKÓW ZMIERZONYCH 1.
```

Komunikat jedynego braku, co do znaku:

```
[unknown] Review nie powiodło się (subtype: error_max_turns, is_error: true,
terminal_reason: max_turns): Reached maximum number of turns (2)
```

### ⚑ Przejście NIE było zimne we wszystkich czterech komórkach — odstępstwo od planu, nazwane

`research.md` §3.1 przewidywał przejście zimne we wszystkich czterech komórkach i plan powtarzał to
w Changes Required. **Przewidywanie było prawdziwe w swojej dacie i unieważniło je zatrzymane
przejście**: pass z `f8a9e80` (16:57Z) zapisał obie udane komórki `sample.diff` do
`~/.promptfoo/cache` pod DZISIEJSZYM kluczem (`v1` + model + fikstura + `59ee111b…`), a od tamtej
pory nie ruszył się ani prompt, ani `FIXED_CALL_OPTIONS`. Dziś obie wróciły jako **TRAFIENIE**.

**Co to znaczy dla dowodu:** rekord niesie pomiary z DWÓCH momentów — `sample.diff` z 16:57Z,
`clean-text-change.diff` z 19:23Z — pod JEDNYM odciskiem. To jest dokładnie to, po co ten cache
istnieje (kluczem jest odcisk, więc trafienie znaczy „to samo wywołanie"), ale komórka
`cached: true` **nie jest pomiarem z chwili zapisu**, a pole `cached` jest jedynym miejscem, po
którym to widać. Nie awansowałem tego do usterki i nie wymuszałem `--no-cache`: zimne przejście
kupowałoby ~0,11 USD za dane, o których cache twierdzi — sprawdzalnie, kluczem — że są te same.

### ⚑ Fakt 1 z poprzedniego podejścia WYMAGA KOREKTY: granica nie jest własnością fikstury

Poprzednie podejście zapisało: „granica `maxTurns: 2` jest własnością FIKSTURY, nie gemini — dziś,
na zimno, oblewają OBA tanie modele". **Dziś, na zimno, na tej samej fiksturze i przy tym samym
`maxTurns: 2`, haiku DOWIOZŁO**: recenzja `pass`, 5/5 asercji twardych, `numTurns: 3`, a obserwacja
miękka `conditional-null-contract` po raz pierwszy w stanie `pass`, a nie `skip`.

Poprawny zapis brzmi więc: **`clean-text-change.diff` leży NA GRANICY `maxTurns: 2`, a wynik
komórki jest losem przebiegu — nie własnością modelu i nie własnością fikstury.** Bilans zimnych
prób na tej fiksturze przy `maxTurns: 2`: haiku oblało (zatrzymane przejście) i dowiozło (dziś),
gemini oblało dwa razy; wejście z fazy 7 poprzedniej zmiany było TRAFIENIEM cache'u, więc nie jest
próbą. Próbek jest tyle, że **nie wolno z nich czytać częstości** — wolno czytać wyłącznie to, że
oba wyniki są osiągalne przy niezmienionym wywołaniu.

To jest zarazem potwierdzenie decyzji D-6 na ŻYWYCH danych, a nie w teście: gdyby zapadka dalej
czerwieniła na `ok: false`, ten sam, nietknięty prompt zieleniałby albo czerwieniał **zależnie od
przebiegu**, a człowiek płaciłby za powtórzenia do skutku. Ostrzeżenie z sekcji „Dlaczego to NIE
jest poluzowanie pod presją" zostaje w mocy i nic tu go nie unieważnia — ale przewidywana cena
starej reguły właśnie się zmaterializowała w drugą stronę.

### Klasyfikacja przyczyn — D-6 na prawdziwym rekordzie

| komórka                           | `contract`  | `subtype`         | `terminalReason` | klasa | zapadka                 |
| --------------------------------- | ----------- | ----------------- | ---------------- | ----- | ----------------------- |
| haiku / `sample.diff`             | `ok`        | `null`            | `completed`      | —     | zielona                 |
| gemini / `sample.diff`            | `ok`        | `null`            | `completed`      | —     | zielona                 |
| haiku / `clean-text-change.diff`  | `ok`        | `success`         | `completed`      | —     | zielona                 |
| gemini / `clean-text-change.diff` | `[unknown]` | `error_max_turns` | `max_turns`      | (A)   | `::notice`, NIE blokuje |

Pola `subtype` / `terminalReason` są w rekordzie **jako pola**, nie w prozie — czyli krok 1 po
decyzji D-6 zadziałał na całej drodze, na której miał: SDK → `ReviewFailure` → provider →
`ReportRow` → `EvalRecordCell`. Dwie komórki z trafieniem cache'u mają `subtype: null`, bo wpis
cache'u powstał przed dołożeniem tych pól — `null` znaczy tu „SDK go nie podało" i dokładnie tak
jest udokumentowane w kształcie. Na klasyfikację to nie wpływa: `contract: "ok"` rozstrzyga
`delivered` bez pomocy `subtype`.

### `previousDelivery` — pierwszy raz z żywych danych

Blok powstał, tak jak przewidywała D-9, dopiero przy tym zapisie: niesie odcisk poprzedniego
rekordu (`59ee111b…`, ten sam) i klasyfikację jego czterech komórek — w tym `delivered: null` dla
obu dawnych `[unknown]`, **bo tamten rekord powstał przed polami `subtype` i klasyfikator nie ma
ich jak nazwać.** `null` jest tu wartością, nie brakiem; to ta sama uczciwość, którą w zapadce
wymusza fail-closed.

Reguła D-9 **nie miała dziś czego złapać**: odcisk się nie zmienił, więc warunek „pod ZMIENIONYM
wywołaniem" nie jest spełniony i przejście gemini `null → false` przechodzi bez czerwieni — zgodnie
z zamysłem, bo to jest niestabilność modelu, nie regresja promptu. Cena 1 z D-9 („reguła jest
BEZCZYNNA do następnego przejścia") obowiązuje nadal: pierwszym przejściem, na którym ta reguła
cokolwiek powie, będzie to po zmianie promptu.

### Kod wyjścia ręcznego runnera ≠ werdykt zapadki

`npm --prefix agents/review run eval -- --record` wyszło z **kodem 100** (kod promptfoo, przeniesiony
przez `report.ts:510`), a zapadka na tym samym rekordzie daje **0**. To nie jest sprzeczność ani
usterka: rozdzielenie przyczyn z D-6 dotyczy ZAPADKI, a ręczny runner dalej czerwieni na każdej
czerwonej komórce promptfoo. Zapisuję to, bo następna osoba zobaczy „exit 100" i może odczytać je
jako „bramka by zaczerwieniła" — nie zaczerwieni, i to jest sprawdzone uruchomieniem obu checkerów
niżej. Rekord zapisał się mimo kodu 100 świadomie (`report.ts:661-663`: „dowód ma opisywać
przejście, które się odbyło; dowód »poprawiony« przez pominięcie czerwonej komórki byłby dowodem
czegoś, czego nie zmierzono").

### Kryteria automatyczne

```
3.1  npx prettier --check agents/review/evals/eval-record.json   -> exit 0
3.3  4 wiersze, 2 różne modele, 2 różne fikstury                 -> OK
3.4  callFingerprint = 59ee111bb431f77a4fc01d7f9bf33992f4ab783458c704d20aafb9e42edec8f1
     == kotwica z planu (przekotwiczenie rozważone i cofnięte)   -> OK

4.3  node agents/review/evals/check-eval-record.ts   -> exit 0 (+ 1 adnotacja ::notice, klasa (A))
     node scripts/check-verdict-config.ts            -> exit 0
```

Kryterium **4.3 domyka się właśnie tu** — było jedynym wierszem fazy 4 czekającym na płatne
przejście, bo poprzedni rekord powstał przed polami `subtype`/`terminalReason` i checker odrzucał
go jako `malformed` z nazwanym powodem. Nowy rekord przechodzi bez tego zastrzeżenia.

Krok 3 fazy (zapis `verdictConfig`) sprawdzony na swój kontrakt „blok `matrix` i `callFingerprint`
przetrwają co do bajtu": porównanie rekordu przed i po `run-verdict-config.ts --write` daje
`notes`, `generatedAt`, `callFingerprint`, `previousDelivery` i `matrix` **identyczne**, a plik
rośnie wyłącznie o cudzy blok. To jest trzeci, niezależny dowód round-tripu dwóch zapisywaczy — po
dwóch pinach literałowych z obu stron granicy kierunkowej, i pierwszy na pliku PRAWDZIWYM.

Zestaw pozostały: testy pakietu agenta **101/101**, `tests/lib/verdict-config.test.ts`

- `tests/lib/review-prompt-sources.test.ts` **38/38**, `npm run typecheck` 180 plików / 0 błędów,
  `npm run lint` 0 błędów (3 ostrzeżenia `no-console` w `evals/generation-quality.eval.ts` — zastane,
  spoza tej zmiany).

### Obserwacje miękkie — zapisane, NIE awansowane (kryterium 3.7)

`conditional-null-contract` po raz pierwszy w stanie **`pass`** (haiku / `clean-text-change.diff`:
„oba kryteria warunkowe rozstrzygnięte przez `null`"). W pozostałych trzech komórkach `skip`, przy
czym z dwóch RÓŻNYCH powodów i ta różnica jest informacją: obie komórki `sample.diff` — „fikstura
nie deklaruje, że oba kryteria warunkowe są bez zastosowania"; gemini / `clean-text-change.diff` —
„brak recenzji w odpowiedzi".

**Nie awansuję jej do asercji twardej** — ta sama decyzja co poprzednio, teraz z mocniejszym
powodem: jedyna komórka, która tę obserwację w ogóle rozstrzygnęła, to ta sama komórka, o której
akapit „Fakt 1 wymaga korekty" mówi, że jej wynik jest losem przebiegu. Twarda asercja postawiona
na niej byłaby asercją na rzucie monetą.

---

## Faza 5 — Dwustronna kontrola pozytywna NA ŻYWYM CI. DOMKNIĘTA

Bramka, której nie widziano na czerwono, jest deklaracją. `lessons.md` („Gwarancja w workflow
należy do konfiguracji PLIKU, nie do czujności autora") żąda próby czerwieni **na tej ścieżce, na
której bramka będzie żyła** — nie lokalnie. Ta faza ją wykonuje: dwie sondy, każda z JEDNĄ zmienną
różnicy, każda odwrócona rewertem, wszystko zwykłym `git push` przez `pull_request` na PR #49.

Wydatek fazy: **0,00 USD.** Zapadka nie ma sekretu i nie może wydać centa; jedyne pieniądze, które
tu groziły, to cudza bramka — patrz strażnik niżej.

### Strażnik kosztu (krok 0a) — zmierzony, nie zadeklarowany

`PR code review` **wyłączony PRZED otwarciem PR-a**, `gh workflow disable "PR code review"` →
`gh workflow list --all` pokazuje `disabled_manually`. Powód: `pr-review.yml:33-36` deklaruje
`types: [opened, synchronize, reopened, labeled]` i **nie ma warunku na draft**, więc otwarcie
draftu to `opened` = jeden przebieg, a każdy z czterech pushy sondy to `synchronize` = kolejny.
Kotwica: 0,6447345 USD za przebieg (PR #48, run `32637738782`, `sonnet-4.6`).

**Dowód, że strażnik zadziałał, jest odczytem, nie deklaracją:** ostatni przebieg `pr-review.yml`
w repo to `989b062` z **12:39Z** — i tak zostało po zamknięciu fazy, sprawdzone PO ponownym
włączeniu bramki. Faza 5 wyprodukowała **sześć** zdarzeń `pull_request` (1 × `opened`, 5 ×
`synchronize`: `3b905af`, `1b2c9ed`, `bef7696`, `ea93869`, `5d7c5ad`) i żadne z nich nie wywołało
przebiegu review. Bez strażnika byłoby to **~3,87 USD** (6 × 0,6447345) — dwuipółkrotność budżetu
1,50 USD całej tej zmiany, wydana na bramce, która z nią nie ma nic wspólnego.

⚑ `concurrency` z `cancel-in-progress: true` część tego rachunku by odjęło (szybkie kolejne pushe
kasują starsze przebiegi), więc 3,87 USD jest górnym oszacowaniem, nie kwotą pewną. Nie zmienia to
wniosku: żaden z tych sześciu przebiegów nie był potrzebny do niczego w tej fazie.

### Otwarcie ścieżki (krok 0b)

PR **#49** `review-eval-gate` → `main`, draft: https://github.com/lirdaw/10xcards/pull/49.
`Eval ratchet` pojawia się na liście checków PR-a i biegnie od zdarzenia `opened` — plik workflow
brany z merge-refa gałęzi, mimo że na `main` jeszcze go nie ma. Kryterium 5.2 domknięte.

Przebieg bazowy `2b6835d` → **ZIELONY** w 23 s, z jedną adnotacją `::notice` klasy (A)
(gemini / `clean-text-change.diff`, `error_max_turns`). To jest pierwszy dowód NA CI, że
rozdzielenie przyczyn z D-6 działa nie tylko lokalnie: klasa (A) wychodzi jako `notice`, job kończy
się kodem 0.

### Para P1 — oś `callFingerprint`. Zmienna różnicy: JEDEN ZNAK

| przebieg  | commit    | co się różniło                                                 | `Eval ratchet`                                                                                |
| --------- | --------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| P1        | `3b905af` | `uzasadnieniem.` → `uzasadnieniem!` w `ROLE` (`prompt.ts:244`) | **CZERWONY** ([run 32662246416](https://github.com/lirdaw/10xcards/actions/runs/32662246416)) |
| rewert P1 | `1b2c9ed` | ten sam znak z powrotem                                        | ZIELONY ([run 32662469988](https://github.com/lirdaw/10xcards/actions/runs/32662469988))      |

Miejsce mutacji wybrane pod kontrakt planu: `prompt.test.ts` twierdzi o `SYSTEM_PROMPT` dokładnie
dwie rzeczy (brak `MATERIAL-DOWODOWY-`, obecność „ogłoszonymi w PIERWSZEJ linii"), a znak leży poza
obiema — sprawdzone lokalnie PRZED pushem: **6/6 zielone**.

Cytat czerwieni (`::error`, log joba):

```
Odcisk wywołania rozjechał się z dowodem: dowód opisuje wywołanie 59ee111bb431…,
a dziś do modelu pojechałoby 2b652e1f8398….

Zmieniła się któraś z czterech osi wywołania: prompt systemowy (agents/review/prompt.ts),
schemat wymuszonego wyjścia (agents/review/review-schema.ts, w tym opisy kryteriów),
kształt wiadomości użytkownika albo stałe wywołania SDK (agents/review/run-review.ts).
Dowód w drzewie opisuje przejście na POPRZEDNIM wywołaniu i nie mówi nic o dzisiejszym.

Ta oś wymaga PRZEJŚCIA MACIERZY i KOSZTUJE — kotwica zimnego przejścia 2x2 to
~0.12 USD, z rozrzutem dziesiątek procent między przebiegami.
```

**Kryterium 5.10 (komunikat mówi wprost, że przejście KOSZTUJE): spełnione, dosłownie** — kwota
pada liczbą, razem z ostrzeżeniem o rozrzucie. Komunikat dokłada też wskazanie osi sąsiedniej
(„To NIE jest oś `verdictConfig` — tamta jest DARMOWA"), czyli sam odsyła od remedium droższego do
tańszego, gdy czytelnik trafił nie tam.

**Izolacja P1 — wynik mocniejszy, niż kryterium wymagało.** Na `3b905af` czerwieni się DOKŁADNIE
jedna bramka: `Eval ratchet` **failure**, `CI` success, `Agents gate` success, `Prompt ratchet`
success. Zieleń `Prompt ratchet` nie jest zbiegiem okoliczności: `prompt-sources.json` niesie
digesty SEKCJI ŹRÓDŁOWYCH (`AGENTS.md` ×2, `test-plan.md` §2), nigdy samego `prompt.ts` — tamta
zapadka pilnuje kierunku „źródło ruszyło, destylat nie", a nie odwrotnego. Sonda zaczerwieniła
zatem to, co miała, i nic poza tym.

### Para P2 — oś `verdictConfig` i ZASIĘG WYZWALACZA

| przebieg  | commit    | co się różniło                                               | `Eval ratchet`                                                                                |
| --------- | --------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| P2        | `bef7696` | `SCORE_THRESHOLD = 5` → `8` (`scripts/review-verdict.ts:35`) | **CZERWONY** ([run 32662531587](https://github.com/lirdaw/10xcards/actions/runs/32662531587)) |
| rewert P2 | `ea93869` | ta sama liczba z powrotem                                    | ZIELONY ([run 32662797663](https://github.com/lirdaw/10xcards/actions/runs/32662797663))      |

Cytat czerwieni:

```
Blok `verdictConfig` w agents/review/evals/eval-record.json opisuje INNE wartości niż dzisiejsze drzewo.

Ta oś NIE wymaga przejścia macierzy evali i nie kosztuje ani centa. Macierz mierzy ODPOWIEDŹ
modelu; te pola opisują wyłącznie sposób, w jaki tę odpowiedź się ODCZYTUJE.

Co się rozjechało:
  - próg akceptacji (SCORE_THRESHOLD w scripts/review-verdict.ts): 5 → 8
```

**Kryterium 5.4 (cytat `5 → 8`): spełnione dosłownie.** **Kryterium 5.9 (mówi wprost, że macierzy
przejeżdżać nie trzeba): spełnione** — i to zdaniem, które podaje POWÓD („macierz mierzy odpowiedź
modelu; te pola opisują sposób, w jaki tę odpowiedź się odczytuje"), a nie samą instrukcją.

**Kolejność kroków z D-1 opłaciła się mierzalnie.** Na P2 job padł na kroku PIERWSZYM, a kroki
`npm ci --omit=dev` i checker agencki są w logu **`skipped`**. Rozjazd progu — czyli oś, której
remedium jest darmowe — kosztuje więc sekundy, nie instalację pakietu agenta. To jedyne miejsce
w tym workflow, gdzie kolejność ma znaczenie funkcjonalne, i to znaczenie zostało zaobserwowane,
nie tylko zapisane w komentarzu.

**Czerwień `CI` na P2 — PRZEWIDZIANA, nie defekt sondy.** `tests/lib/review-verdict.test.ts`
przypina `expect(SCORE_THRESHOLD).toBe(5)`; przebieg dał 6 czerwonych testów (5 w `review-verdict`,
1 w `verdict-config`), pierwszy z komunikatem `expected 'fail' to be 'pass'`. Plan tę czerwień
zapowiadał i dlatego status czytamy per job. Zapisane, żeby nikt później nie odczytał tego jako
usterki.

#### ⚑ Korekta do uzasadnienia D-1 — sonda dowiodła MNIEJ, niż plan zakładał

Plan uzasadniał odrzucenie `agents-gate.yml` jako domu tym, że jego filtr `paths: ["agents/**", …]`
nie sięga `scripts/review-verdict.ts`, więc „zapadka milczałaby dokładnie na PR-ze zmieniającym
próg". Na tym PR-ze **`Agents gate` NIE zamilkł: pobiegł i był zielony.**

Powód jest mechaniką, nie przypadkiem: przy `pull_request` filtr `paths` liczy się względem
**całego diffa PR-a**, nie ostatniego commita — a diff #49 dotyka 11 plików pod `agents/`, więc
filtr przepuścił. `Agents gate` był zatem zielony na PR-ze, który ruszał próg — bo jego JOB progu
nie sprawdza, a nie dlatego, że filtr go odsiał.

Co z tego zostaje: **wniosek D-1 trzyma, jego uzasadnienie było za wąskie.** Ta sonda dowiodła
rzeczy słabszej, ale wystarczającej — że wyzwalacz `Eval ratchet` (bez `paths` w ogóle) SIĘGA
zmiany zamkniętej w `scripts/`. Przypadek, w którym filtr `agents-gate` naprawdę by odsiał, to PR
dotykający WYŁĄCZNIE `scripts/review-verdict.ts`; ten PR nim nie był i fazy 5 na niego nie
naciągam. Zapis wprost, bo to dokładnie klasa „prawdziwe liczby, wniosek, którego nie unoszą".

### Połowa zielona (krok 3) i stan końcowy

Na `ea93869` — po OBU rewertach, na tej samej gałęzi i tym samym workflow — **pełny zestaw
zielony**: `Eval ratchet` success (21 s), `CI` success (4 m 21 s), `Agents gate` success (1 m 38 s),
`Prompt ratchet` success (9 s). Bez tej połowy dowód przechodziłby także dla zapadki czerwieniącej
ZAWSZE (wymaganie 3).

Rewerty czyste, i to sprawdzone najmocniejszym dostępnym testem, nie oglądaniem plików:
`git diff 2b6835d HEAD --stat` **pusty** — drzewo po obu rewertach jest co do bajtu tym samym
drzewem, co przed pierwszą sondą. Odcisk wywołania z powrotem `59ee111b…` (kotwica niezmieniona,
D-8 cofnięte), oba checkery lokalnie kod 0.

### Dlaczego `pre-push` sond nie zablokował — i dlaczego to NIE jest obejście

Żadna sonda nie użyła `--no-verify`; hook biegł za każdym razem i **wypisał `typecheck: OK — 180
plików`** na wszystkich czterech pushach (`core.hooksPath` = `.husky/_`, husky zainstalowany).
Powody, że przepuścił:

- **P1**: `.husky/pre-push` to jedna linia `npm run typecheck`, czyli ROOTOWY type gate, a
  `agents/**` jest świadomie poza rootowym `tsconfig.json`. Zmiana znaku w stringu i tak nie jest
  błędem typu.
- **P2**: `8` to poprawny `number` w miejscu, gdzie stoi `5`. Sprzeczność jest z ASERCJĄ testu
  (`review-verdict.test.ts`), a testów `pre-push` nie uruchamia — złapało ją dopiero `CI`.

Precedens przewidziany w planie (sonda `de97385`, `agents/review/probe.ts`) potwierdzony: droga
przez GitHub Contents API była tu zbędna.

### Weryfikacja RĘCZNA fazy 5 — wykonana, z jednym znaleziskiem

Cztery wiersze fazy 5 (5.9–5.12) i trzy zaległe z fazy 4 (4.7–4.9). Każdy sprawdzony wykonaniem,
nie odczytaniem z pamięci przebiegu.

**5.9 / 5.10 — komunikaty czerwieni.** Oba cytaty wyżej, z logów żywych jobów. P2: „Ta oś NIE
wymaga przejścia macierzy evali i nie kosztuje ani centa" + POWÓD („macierz mierzy ODPOWIEDŹ
modelu; te pola opisują sposób, w jaki tę odpowiedź się ODCZYTUJE"). P1: „Ta oś wymaga PRZEJŚCIA
MACIERZY i KOSZTUJE — kotwica zimnego przejścia 2x2 to ~0.12 USD". Oba spełnione dosłownie.

**5.11 — zapis niesie obie połowy i zmienną różnicy.** Dwie tabele z kolumną „co się różniło",
cztery linki do przebiegów (`32662246416`, `32662469988`, `32662531587`, `32662797663`), cytaty obu
czerwieni, opis zieleni końcowej.

**5.12 — rewerty czyste, w formie MOCNIEJSZEJ niż oglądanie plików.** `git diff 2b6835d HEAD --stat`
z wyłączeniem `context/changes` → **pusty**: kod jest co do bajtu tym samym kodem, co przed pierwszą
sondą. Odcisk **POLICZONY** (`productionPromptFingerprint()` uruchomione na drzewie), nie odczytany
z rekordu: `59ee111bb431f77a4fc01d7f9bf33992f4ab783458c704d20aafb9e42edec8f1` = kotwica. Odczyt
z rekordu byłby tu bezwartościowy — rekord jest właśnie tym, co odcisk ma sprawdzać.

**4.7 — `eval-ratchet.yml` bez sekretu, z KONTROLĄ DODATNIĄ metody.** Samo „grep nic nie znalazł"
nie jest dowodem, dopóki nie wiadomo, czy grep umie znaleźć. Wynik: w `eval-ratchet.yml` jedyne
wystąpienie ciągu `env:` jest w KOMENTARZU (linia 8, proza uzasadniająca), `secrets.` zero, jedyne
`with:` to konfiguracja `setup-node` (`node-version`, `cache`, `cache-dependency-path`). Ten sam
grep na `pr-review.yml` — bramce, która sekret MA — daje **15** dopasowań. Zero jest więc wynikiem,
nie ślepotą narzędzia. `permissions: contents: read` zawęża resztę do `none`.

**4.8 — wymaganie 7, sprawdzone na OBU stanach, nie na jednym.** Wymaganie żąda rozróżnienia
„zmieniłeś prompt, brakuje dowodu" od „dowód jest, ale dla innego promptu". Stan drugi mam z
żywego CI (P1). Stan pierwszy wywołany lokalnie: plik dowodu odsunięty na bok, checker uruchomiony,
plik przywrócony — i przywrócenie sprawdzone `sha256sum` przed i po (**identyczne**) oraz `git
status` (czysty), bo „przywróciłem" bez porównania hasza jest deklaracją. Wynik:

| stan             | tytuł adnotacji                            | treść                            |
| ---------------- | ------------------------------------------ | -------------------------------- |
| dowodu brak      | `Brak dowodu przejścia evali`              | „… nie istnieje"                 |
| dowód dla innego | `Odcisk wywołania rozjechał się z dowodem` | podaje OBA odciski, stary i nowy |

Różne tytuły, różne treści, obie gałęzie cytują komendę wytwarzającą
(`npm --prefix agents/review run eval -- --record`) i obie kończą się zdaniem, że sam krok
zapisujący niczego nie sprawdza. Wymaganie 7 spełnione.

**4.9 — i tu weryfikacja ręczna ZNALAZŁA USTERKĘ.**

Sama treść kryterium przechodzi: nazwa (`Eval ratchet`, job `ratchet`, kroki „Check the eval
evidence against today's call fingerprint") nigdzie nie sugeruje „prompt sprawdzony", a
`notes.scope` mówi dokładnie to, czego żąda D3 — „reakcję DWÓCH TANICH MODELI …, NIE zachowanie
recenzenta produkcyjnego", razem z odmową tezy o wspólnym regresowaniu rodziny („to jest
prawdopodobne i NIEZMIERZONE").

Ale D3 wymienia adnotację jako jedną z trzech powierzchni, które muszą mówić prawdę — i **klucz
`notes.redCells` był NIEAKTUALNY, sprzeczny z macierzą, obok której stał**:

- ogłaszał „STAN DWÓCH CZERWONYCH KOMÓREK" i „obie komórki `clean-text-change.diff` — haiku-4.5
  i gemini-2.5-flash — mają `ok: false`", podczas gdy dzisiejszy rekord ma **jedną** komórkę
  `ok: false` (gemini), a haiku na tej samej fiksturze **dowiozło**;
- niósł zdanie „granica `maxTurns: 2` jest własnością TEJ FIKSTURY, nie własnością gemini", które
  `change.md` już odnotowuje jako **zmierzone i nieprawdziwe**;
- podawał rachunek pierwszego przejścia (0,235012 / 0,110343 USD) jako rachunek tego rekordu;
- opisywał przejście `generatedAt 2026-08-23T16:58:56.006Z`, a rekord niesie
  `2026-08-23T19:25:09.445Z`.

Zadziałało dokładnie to, co ta adnotacja sama o sobie przewidywała: jej ostrzeżenie o świeżości
mówi, że `--record` **zachowuje** zastany blok `notes`, więc zdanie przeżywa każde następne
przejście — i kazało sprawdzić `generatedAt`, zanim się mu uwierzy. Sprawdzenie wykonane, warunek
się spełnił, remedium wykonane: klucz przepisany i przemianowany na **`undeliveredCell`** (stara
nazwa opisywała stan, którego w tym rekordzie nie ma), z jawną korektą tezy o „własności fikstury"
i z rachunkiem tego przejścia (0,139255 USD).

Dlaczego to było bezpieczne: `redCells` nie występuje w `NOTES_KEYS`
(`eval-record.ts:79` — obowiązkowe są `scope`, `oneMeasurement`, `costSource`, `uncovered`,
`fixtures`), nie jest referencjonowany przez żaden kod, test ani workflow (sprawdzone gremem po
całym repo), i nie wchodzi do `callFingerprint`. Po zmianie: **diff to JEDNA linia**,
`npx prettier --check` kod 0, oba checkery kod 0, testy pakietu agenta **101/101**.

Warta zapisania jest sama mechanika, bo to jest wzorzec do powtórzenia: adnotacja, która niesie
WŁASNY warunek nieświeżości i pole, po którym się go sprawdza, dała się złapać zwykłym odczytem —
zamiast zestarzeć się cicho i być czytana jako opis dzisiejszego stanu. Kosztem jest to, że ktoś
musi ten warunek sprawdzić; tu zrobiła to weryfikacja ręczna kryterium 4.9 i to jest jedyny powód,
dla którego ta usterka nie pojechała na `main`.

### Wiersze ODWOŁANE fazy 3a — weryfikacja PRZESŁANEK, nie samych kroków

Pięć wierszy Progress zostaje pustych (`3a.3`, `3a.4`, `3a.7`, `3a.8`, `3a.9`). Pusty checkbox
z powodem jest uprawniony **tylko wtedy, gdy powód jest prawdziwy** — inaczej „ODWOŁANE" jest
tańszą wersją „nie zrobiłem". Sprawdzone przed domknięciem planu, każdy z osobna.

**3a.7 — „pomiar nie dał czego cytować".** PRAWDA, i to zapisana dosłownie: sekcja pomiaru 3a.1
w tym pliku kończy się nagłówkiem „⚑ Odpowiedź na pytanie fazy: czy WIADOMO, co liczy `numTurns`?"
i zdaniem **„NIE. Nadal nie wiadomo — i dlatego nie proponuję wartości `maxTurns`."** Krok żądał
wartości wybranej z CYTOWANEGO odczytu; odczyt, z którego można by cytować, nie powstał. Krok jest
więc niewykonalny, a nie pominięty — i to jest różnica, którą pusty wiersz ma nieść.

**3a.8 — „produkcji nie ruszamy".** PRAWDA, sprawdzona DWOMA niezależnymi drogami, bo pierwsza
sama z siebie nie wystarcza:

1. _Diff całej zmiany_ (`git diff <merge-base z main> HEAD`) na plikach wywołania produkcyjnego:
   `review.ts`, `prompt.ts`, `review-schema.ts` — **zero zmian**; `run-review.ts` — 39 linii, ale
   **wyłącznie diagnostyka**: przeniesienie surowego `subtype` i `terminal_reason` z wyniku SDK
   obok `kind`, plus opcjonalny parametr `reviewFailure`. `FIXED_CALL_OPTIONS.maxTurns` = **2**,
   `tools` = `[]`, pin modelu `anthropic/claude-sonnet-4.6` — wszystkie nietknięte.
2. _Odcisk POLICZONY na drzewie_ = `59ee111bb431…`, czyli kotwica sprzed zmiany, co do bajtu.
   To jest niezależne potwierdzenie, a nie powtórzenie punktu 1: jedną z czterech osi tego odcisku
   są **stałe wywołania SDK z `run-review.ts`**, więc gdyby te 39 linii dotknęły wywołania, odcisk
   by się ruszył. Nie ruszył się.

Wniosek: nie ma nowej wartości, na której miałoby się ćwiczyć recenzenta produkcyjnego, bo nie ma
żadnej nowej wartości. Krok stracił przedmiot.

**3a.9 — „koszt produkcyjny się nie zmienia, więc ~135 USD/mies. zostaje w mocy".** PRAWDA, i to
WYNIKA z 3a.8, a nie jest osobnym twierdzeniem. Projekcja liczyła się z dwóch wielkości:
**0,6447345 USD** za przebieg i **2 tury**. Podniesienie `maxTurns` było jedynym powodem, dla
którego miałaby się przeliczać (plan: „podniesienie `maxTurns` skaluje rachunek produkcyjny, a nie
tylko rachunek macierzy"). `maxTurns` = 2 stoi, więc obie wielkości stoją, a projekcja zostaje
w mocy **nieprzeliczona** — nie „nieaktualna". Kotwica 0,6447345 USD została przy okazji użyta na
świeżo w fazie 5, przy rachunku strażnika kosztu.

**3a.3 / 3a.4 (automatyczne).** `3a.3` („po wyborze wartości: typecheck, testy, lint") ma tę samą
przesłankę co 3a.7 — wyboru nie było. Dla porządku: te trzy bramki i tak biegły później, w fazach
3–5, i są zielone. `3a.4` („nowy odcisk jako NOWA kotwica") jest odwołany w mocniejszy sposób niż
pozostałe: kotwica została **sprawdzona i celowo utrzymana** na `59ee111b…`, przeliczeniem, nie
odczytem z rekordu. Ten wiersz nie jest niewykonany — jest wykonany w drugą stronę.

### Krok 5 — przywrócenie bramki review

`gh workflow enable "PR code review"` → `gh workflow list --all` pokazuje `active`. To warunek
zamknięcia fazy, nie sprzątanie: bramka wyłączona po cichu i niewłączona z powrotem jest stanem
GORSZYM niż brak tej zmiany — krok 0a otworzył okno, ten je zamyka, a między nimi nie ma nic, co
zamknęłoby je samo.

**Kolejność, i to jest odstępstwo od planu warte nazwania:** włączenie idzie **PO** pushu commita
fazy 5, nie przed. Powód jest ten sam, który stoi za krokiem 0a: push commita z tym zapisem jest
także zdarzeniem `synchronize`, a warunek joba review (`pr-review.yml:105-108`) przy
`synchronize` z tego samego repo jest spełniony bez żadnej etykiety. Włączenie przed pushem
kupiłoby więc recenzję za ~0,64 USD za PROTOKÓŁ tej fazy — z budżetu, którego zostało ~0,73 USD.
Plan mówił „po domknięciu wszystkich sond"; to jest to samo miejsce, tyle że policzone o jeden
push dalej. Okno zamyka się w tej samej sesji i przed ogłoszeniem fazy za domkniętą, więc klasa
z `lessons.md` („gwarancja, która przestała pilnować, a nikt tego nie widzi") się nie
materializuje.

---

## Faza 6 — recenzja PR #49 jako POMIAR bramki (2026-08-24)

**Data**: 2026-08-24 · **Sha**: `db71946` · **Przebieg**: `PR code review`
[32715460981](https://github.com/lirdaw/10xcards/actions/runs/32715460981) · **Model**:
`anthropic/claude-sonnet-4.6` · **Koszt**: 0,654817 USD (delta `/api/v1/key`, cztery zgodne
odczyty — `change.md` §Domknięcie rachunku)

Ta sekcja NIE jest notatką „review przeszło". Jest zapisem tego, **co bramka wykryła na prawdziwym
materiale za konkretne pieniądze** — bo jedyną znaną nam metodą oceny agenta review jest
skonfrontowanie jego wyniku z tym, co niezależnie wiemy o recenzowanym kodzie.

### Werdykt

`pass`, etykieta `ai-cr:passed`. Oceny: poprawność 8, idiomatyczność 8, złożoność 7, pokrycie
testami 8, dokumentacja 9, bezpieczeństwo 9, połknięty błąd 8, integralność bramki 8, dyscyplina
zakresu 8. Suma 73/90 przy `SCORE_THRESHOLD = 5`.

### Co agent MIAŁ na wejściu — zmierzone, nie założone

`pr-review.yml:280-287` buduje materiał jako `git diff --merge-base` z sześcioma wykluczeniami:
`context/**`, `**/package-lock.json`, `src/db/database.types.ts`, `agents/review/criteria.json`,
`agents/review/prompt-sources.json` oraz **`agents/review/evals/eval-record.json`**. Do promptu
idzie `DIFF_PATH` (filtrowany); `RAW_PATH` służy wyłącznie do odróżnienia stanu `no-code` od
`empty`. Cena wycięcia `context/**` jest w tym pliku nazwana wprost (`:250-252`) i przyjęta.

Materiał odtworzony wobec bazy sprzed merge'a (`0290af6^1` = `4f0605b`): **195 580 bajtów**.
Trafienia w nim:

| czego szukano                                  | trafień | wniosek                                |
| ---------------------------------------------- | ------- | -------------------------------------- |
| `haiku` / `gemini` / `sonnet`                  | **14**  | skład macierzy BYŁ widoczny            |
| `::notice` / `::error`                         | **11**  | powierzchnia Open Risk 7 BYŁA widoczna |
| blok JSDoc `Dowód po zapisie połowy AGENCKIEJ` | **1**   | osierocony JSDoc BYŁ widoczny          |

### KOREKTA hipotezy „agent nie widział, więc nie mógł" — hipoteza NIE PRZESZŁA

Robocza teza brzmiała: skoro `context/**` jest wycięte, agent nie widział `plan.md` ani tej sekcji,
więc Open Risks były dla niego niewidoczne i zarzut o nieuwagę jest bezpodstawny. **Połowa tej tezy
jest prawdziwa, połowa fałszywa, a fałszywa połowa jest ważniejsza.**

- **Prawda:** Open Risks jako NAZWANE ryzyka rzeczywiście były poza materiałem — `plan.md` leży
  w `context/**`. Agent nie mógł ich przeczytać jako listy i nie należy mu tego wypominać.
- **Fałsz:** obie dziury były w diffie jako **linie DODANE**, nie jako wiedza do odkrycia.
  - **Dziura sonnetowa jest w materiale CYTATEM, nie inferencją.** `eval-record.ts`,
    `MANDATORY_NOTES.scope`, linie `+` diffa: „Ten dowód opisuje reakcję DWÓCH TANICH MODELI
    (anthropic/claude-haiku-4.5, google/gemini-2.5-flash) na zmieniony prompt — NIE zachowanie
    recenzenta produkcyjnego (anthropic/claude-sonnet-4.6). **Regresja uderzająca w sonneta,
    a omijająca oba tanie modele, przejdzie tę bramkę na ZIELONO z dowodem kompletnym
    i aktualnym.**" Agent dostał to zdanie gotowe i wystawił „Pokryciu testami względem ryzyka"
    8/10, nie odnosząc się do niego.
  - **Open Risk 7 jest w materiale KODEM.** `check-eval-record.ts:320,338` (oraz
    `check-verdict-config.ts`) wchodzą do diffa jako linie `+` z niecytowaną interpolacją danych
    prosto w komendę `::notice` / `::error`. Agent wystawił „Bezpieczeństwu" 9/10, wymieniając
    `permissions: contents: read`, brak `pull_request_target`, brak sekretów i `--ignore-scripts`
    — a interpolacji nie nazwał.

**Wniosek, który zostaje:** to jest wynik o CZUŁOŚCI bramki, nie o jej uwadze na dokumenty. Agent
nie przeoczył dokumentu, którego nie dostał — **nie zareagował na materiał, który dostał**. Tak
sformułowany wniosek jest mocniejszy niż pierwotny i mniej wygodny.

**Osobna obserwacja strukturalna, warta własnego wiersza:** `pr-review.yml:287` wycina
`agents/review/evals/eval-record.json` — czyli DOWÓD, którego pilnowanie jest całym powodem
istnienia tej zmiany — z materiału recenzji. Wykluczenie jest sensowne (plik generowany, szum
w diffie), ale konsekwencja jest niebanalna: agent review nigdy nie zobaczy zawartości rekordu,
nad którym stoi zapadka. Dziś nie boli, bo prozę z rekordu niesie `MANDATORY_NOTES` w `.ts`.
Zaboli w dniu, w którym ktoś przeniesie tę treść wyłącznie do `.json`.

### Pomyłka atrybucji — nazwana właściwie

Agent zakwalifikował reformatowania w `report.ts` (łamanie linii w `asNumber`, rozwinięcie tablicy
`ABSENT`, przeniesienie `process.stderr.write`) jako scope creep. Sam fakt jest trafny; churn
istnieje. Nietrafna była tylko nasza próba przypisania go do `7ef6886` — ten commit dotknął
wyłącznie `scripts/check-verdict-config.ts` i `scripts/verdict-config.ts`, a `report.ts` zmienił
`30a88c0`.

**Właściwa nazwa tej klasy błędu nie brzmi „agent pomylił commity".** Agent **nie widzi granic
commitów**: `pr-review.yml:280` podaje mu JEDEN diff od merge-base, bez historii, bez `git log`,
bez podziału na commity. Jeśli w komentarzu pada twierdzenie przypisujące zmianę do commita, jest
to **twierdzenie o wymiarze, którego materiał nie zawiera** — nie da się go z tego wejścia ani
potwierdzić, ani obalić. Klasa jest ogólniejsza niż commity i dlatego warta zapisu: model
wypowiada się o osi nieobecnej w danych.

### Co znalazł, czego NIE MA w impl-review

**Jedno, sprawdzone w pliku, prawdziwe.** Osierocony JSDoc: `agents/review/evals/eval-record.ts`
— dwa bloki JSDoc stoją jeden na drugim (`:447-465` i `:466-471`), oba przed
`previousDeliveryFrom`, a pierwszy dokumentuje `buildRecord` (mówi o kolejności `RECORD_KEYS`,
o `verdictConfig` przechodzącym nietkniętym, o `MANDATORY_NOTES`), który zaczyna się dopiero
w `:484`. Każde narzędzie wiążące komentarz z NASTĘPNĄ deklaracją (hover, typedoc, LSP) przypisze
kontrakt `buildRecord` do `previousDeliveryFrom`, a eksportowany `buildRecord` nie pokaże
dokumentacji żadnej. Stan istniał już na `5d7c5ad`, czyli wewnątrz zakresu diffa impl-review
(`69d4b1c..HEAD`); grep po `reviews/impl-review.md` na `jsdoc` daje zero trafień.

Dwie obserwacje bez statusu defektu, też nieobecne w impl-review: `readRaw()` w
`check-eval-record.ts` łapie WSZYSTKIE wyjątki, więc ENOENT i EACCES mapują się na ten sam
`kind: "missing"` (agent sam znalazł udokumentowane uzasadnienie i nie nazwał tego błędem); oraz
brak AUTOMATYCZNEGO testu integracyjnego uruchamiającego `check-eval-record.ts` i mierzącego kod
wyjścia (impl-review zrobił to ręcznie na kopii drzewa, kryterium 4.4, ale luki nie nazwał).

### Plon wobec poprzedniego przebiegu — i co z tego wynika

| przebieg                      | defekty nieznalezione przez plan-review, impl-review i ich subagenty    |
| ----------------------------- | ----------------------------------------------------------------------- |
| `code-review-evals` (C10X-56) | **3**                                                                   |
| `review-eval-gate` (C10X-57)  | **1** (dokumentacyjny, mały) + 2 obserwacje + 1 odrzucony fałszywy trop |

Spadek jest realny i **nie wolno go czytać jako „kod był lepszy"**, bo dwie hipotezy tłumaczą go
równie dobrze i żadnej nie zmierzyliśmy: (a) materiał wszedł w recenzję PO triażu dziesięciu
findingów impl-review, więc łatwe rzeczy były już zebrane; (b) czułość spada na diffie ~2500 linii.
Rozstrzygnięcie wymaga pomiaru, którego nie mamy — jedna recenzja to jedna próbka.

Jedna rzecz jest natomiast pewna i jest najmocniejszym pojedynczym zdaniem tej sekcji:
**agent nie zgłosił żadnej z dwóch dziur, które miał podane w materiale wprost.** Bramka, która
nie odkrywa ryzyk już nazwanych w cudzym kodzie, tym bardziej nie jest dowodem, że nie ma ryzyk
nienazwanych.

### ⚑ TRZY KANDYDATURY NA FIKSTURY do zestawu evali

To są **ZMIERZONE zachowania na prawdziwym materiale**, nie hipotezy — każde ma sha, przebieg
i cytat. Autor następnej zmiany o evalach: to jest gotowy materiał wejściowy, nie pomysł do
zaprojektowania od zera.

1. **(a) Miskalibracja oceny wobec własnego findingu.** Agent wystawił „Dokumentacji i uzasadnieniu"
   **9/10**, a jedyny defekt, jaki w całej recenzji znalazł, jest defektem dokumentacji (osierocony
   JSDoc). Fikstura: diff z jednym wyraźnym defektem w wymiarze X plus wysoka ocena wymiaru X.
   Asercja kandydacka: ocena wymiaru, w którym zgłoszono defekt, nie może być w górnym kwartylu
   skali. **Uwaga na granicę D-2**: oceny RAPORTUJĄ, kontrakt BRAMKUJE — więc to jest kandydat na
   asercję kontraktową o SPÓJNOŚCI wyjścia, nie na asercję o wartości oceny.
2. **(b) Twierdzenie ponad dowód.** Agent przypisał zmianę do commita, mając na wejściu jeden diff
   od merge-base, bez historii. Fikstura: diff bez jakiejkolwiek informacji o commitach plus
   asercja, że wyjście nie zawiera przypisań do sha ani sformułowań „w commicie X". Klasa ogólna:
   wypowiedź o osi nieobecnej w danych.
3. **(c) Fałszywy trop z cutoffu — „nie wiem" kontra „nie istnieje".** Agent podał w wątpliwość
   `actions/checkout@v7` i `actions/setup-node@v6` jako wersje „przekraczające moje dane (v4)".
   Zachował się **poprawnie** — nazwał to niemożliwym do rozstrzygnięcia z diffa, zamiast orzec
   nieistnienie — i to jest właśnie powód, dla którego jest to dobra fikstura: mierzy zachowanie
   POŻĄDANE, a nie defekt. Fikstura: diff używający zależności nowszej niż cutoff modelu. Asercja
   kandydacka: wyjście oznacza to jako niepewność, a NIE jako błąd do naprawienia. Kontrola
   negatywna: ta sama fikstura z zależnością realnie nieistniejącą (`actions/checkout@v999`), gdzie
   poprawną odpowiedzią jest już zgłoszenie problemu.
