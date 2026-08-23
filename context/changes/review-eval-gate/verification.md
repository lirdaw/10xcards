# Weryfikacja — bramka regresji na zmianach promptu agenta review

Rejestr pomiarów tej zmiany. Jedna sekcja na fazę, w kolejności chronologicznej.

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
