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

Czternaście nowych przypadków testowych, każdy dwustronny (wzorzec `blindTo`): nazwany podtyp NIE
czerwieni, kosz CZERWIENI, `[contract]` czerwieni jako (B) a nie jako niedowiezienie, obserwacje
(A) idą osobnym kanałem i komórka nierozpoznana NIE trafia tam wcale, przejście D-9 czerwieni pod
zmienionym odciskiem i NIE czerwieni pod tym samym.

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
