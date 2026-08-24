# Wymagania — bramka regresji na zmianach promptu agenta review

Notatka wejściowa przed `/10x-research`. Opisuje CO ma być prawdą po tej zmianie, nie jak to
zbudować — żadnego kodu, żadnego YAML-a. Rozstrzygnięcia mechanizmu należą do researchu i planu.

## Cel — domknięcie drugiego zdania zadania

Zadanie 3 z lekcji M5L3: „Złóż krótki zestaw w promptfoo (…) Przy okazji zostaw ten zestaw jako
bramkę regresji przed kolejnymi zmianami promptu."

**Pierwsze zdanie jest wykonane.** Zestaw istnieje — macierz 2×2 (haiku-4.5, gemini-2.5-flash ×
`sample.diff`, kontrola negatywna `clean-text-change.diff`), z asercjami deterministycznymi,
własnym cache'em w providerze i rachunkiem per komórka. Zmiana `code-review-evals`,
zarchiwizowana 2026-08-23 pod `context/archive/2026-08-22-code-review-evals/`.

**Drugie zdanie NIE jest wykonane.** Repo ma sześć workflow (`agents-gate`, `ci`, `eval`,
`pr-review`, `prompt-ratchet`, `schema-diff`) i **żaden nie uruchamia zestawu ani nie odwołuje się
do niego jako do warunku** — jedyne trafienia na „evals" w `.github/workflows/` to komentarz
w `agents-gate.yml` mówiący, że katalog wejdzie pod bramkę uprawnień, oraz `eval.yml`, który
dotyczy evala GENERACJI FISZEK, nie review. Zestaw uruchamia się wyłącznie ręcznie.

Skutek dzisiejszy: zmiana `SYSTEM_PROMPT` może wejść na `main` bez jednego pomiaru. Dokładnie ta
klasa raz już się zmaterializowała — `0d3eba5` naprawiał kontrakt `null`, a faza 7 tamtej zmiany
złapała na gemini regresję, której nikt by inaczej nie zobaczył. Ta zmiana domyka lukę.

> **Poprawka faktu wobec zlecenia.** Zestaw uruchamia się przez
> `npm --prefix agents/review run eval` (skrypt `eval` w `agents/review/package.json`, wołający
> `evals/report.ts`), a NIE przez rootowe `npm run eval` — to drugie to vitestowy eval generacji
> fiszek (`vitest.eval.config.ts`, `evals/**/*.eval.ts`): inny agent, inny klucz, inny cel.
> Rozróżnienie jest istotne dla bramki: nazwanie jej „bramką na `npm run eval`" wskazałoby w CI
> nie ten zestaw.

## Decyzje zamknięte — NIE otwierać ich ponownie

1. **Kształt: ZAPADKA NA DOWODZIE, nie uruchamianie macierzy w CI.** Krok w CI sprawdza, czy
   zmiana promptu ma dołączony AKTUALNY wynik evala. Macierz odpala człowiek, ręcznie; wynik
   trafia do repo razem ze zmianą promptu.
   **Powód:** bramka ma być DETERMINISTYCZNA. Czerwień ma znaczyć dokładnie „zmieniłeś prompt
   i nie zmierzyłeś skutku", nigdy „model miał gorszy dzień". Archiwum ma na to twardy materiał:
   ten sam model, ta sama fikstura, ten sam prompt (`0d3eba5`) dał w dwóch przebiegach koszt
   komórki różniący się o 58%, a cap budżetu rozjechał dwa identyczne przebiegi na sukces
   i `error_max_budget_usd` wyłącznie ciepłotą cache'u. Macierz w CI byłaby bramką flaky,
   a bramka flaky to bramka, którą wszyscy uczą się przeklikiwać.
2. **Zakres dowodu: pełna macierz 2×2** — oba modele (haiku-4.5, gemini-2.5-flash) × oba sloty
   (fikstura z defektem + kontrola negatywna). Dowód z jednej kolumny nie jest dowodem: kontrakt
   `null` jest u gemini NIESTABILNY, a nie równo odrzucany, więc kolumna, której się nie
   zmierzyło, jest kolumną, o której się nic nie wie.
3. **Bramka BLOKUJĄCA** — krok kończy się kodem 1, job czerwony. Spójne z `prompt-ratchet.yml`,
   który też kończy kodem 1 i też nie ma trybu ostrzegawczego.

## Wymagania twarde

1. **Koszt bramki w CI = 0 USD.** Zapadka NIE WOŁA modelu. Żadnego klucza w kroku, żadnego
   `OPENROUTER_REVIEW_KEY`, żadnego wywołania SDK. Wynika to wprost z decyzji 1 i jest tu zapisane
   osobno, bo jest niezależnie sprawdzalne: krok bez sekretu nie może wydać pieniędzy nawet przez
   pomyłkę.
2. **Lista wejść odcisku promptu NIE MOŻE być nową, ręcznie utrzymywaną listą plików.** Dwa źródła
   prawdy = jedno cicho się starzeje. To ta sama klasa, którą `prompt-ratchet.yml` świadomie
   odrzucił, odmawiając sobie filtra ścieżek („`PROMPT_SOURCES` jest listą w `scripts/`, i w dniu,
   w którym ktoś doda czwarte źródło, filtr byłby stale i cicho nieaktualny").
   Research ma ustalić, który z istniejących mechanizmów da się reużyć — i **czy obejmuje
   WSZYSTKO, co zmienia werdykt**: prompt systemowy, opisy kryteriów, schemat wyjścia, próg.
   Ostatnia pozycja tej listy jest dziś ZMIERZONĄ LUKĄ, nie hipotezą — rozstrzyga ją pierwsze
   pytanie otwarte niżej i **bez odpowiedzi na nie tego wymagania nie da się uznać za spełnione**.
3. **Kontrola pozytywna DWUSTRONNA.** Dowód, że zapadka czerwieni przy zmienionym prompcie
   i starym wyniku, ORAZ że przy niezmienionym prompcie nie czerwieni. Sama pierwsza połowa
   przechodzi też dla zapadki czerwieniącej ZAWSZE — czyli dla bramki bezwartościowej.
   Wzorzec do naśladowania istnieje w repo: `agents/review/evals/cache.test.ts` pilnuje każdej osi
   odcisku osobno, przypadkiem unieważnienia ORAZ kontrolą pozytywną („wariant ślepy na tę oś musi
   zaczerwienić DOKŁADNIE jej przypadek i tylko jego").
4. **Dowodu nie może dać się spełnić trafieniem w cache sprzed zmiany promptu.** Odcisk cache'a
   evali ma cztery osie (prompt systemowy, schemat wyjścia, kształt wiadomości użytkownika, stałe
   opcje wywołania), więc zmiana promptu POWINNA go unieważniać. **Zweryfikuj to pomiarem, nie
   założeniem** — nieświeży wynik podany jako zielona bramka jest najgroźniejszą klasą błędu
   w całym tym zestawie, bo znika razem z informacją, że coś zniknęło.
5. **Wynik macierzy musi przetrwać `lint-staged`.** Znana pułapka z poprzedniej zmiany:
   `prettier --write` idzie na każdy stagowany `*.{json,css,md}`, a `.prettierignore` zawiera dziś
   wyłącznie `context/archive/**` — `agents/**` nie jest wyłączone. Zapisany dowód, który
   pre-commit przeformatuje, przestaje odpowiadać odciskowi, którym został policzony.
6. **BUDŻET CAŁEJ ZMIANY: 0,50 USD** na wywołania modeli (kilka ręcznych przebiegów macierzy
   w trakcie developmentu). Przekroczenie = zatrzymać się i wrócić z liczbami, nie dokładać
   przebiegów „żeby już domknąć". Kotwica ze zmierzonego: pełne przejście 2×2 na tanich modelach
   kosztowało 0,118529 USD, ~~a jego powtórzenie na ciepłym cache'u 0,000000 USD — budżet starcza
   więc na kilka przejść zimnych, o ile cache nie jest kasowany bez powodu.~~

   > ⚑ **KOREKTA PO POMIARZE (research, sekcja 3.1).** Przekreślona połowa kotwicy jest MARTWA.
   > Trzy komórki leżące dziś w `~/.promptfoo/cache` niosą odcisk DWUOSIOWY sprzed `c2991a4`,
   > a dzisiejszy odcisk jest czteroosiowy — zmierzone, że odczyt pod dzisiejszym kluczem to PUDŁO.
   > Następne przejście macierzy będzie więc ZIMNE we wszystkich komórkach, mimo że promptu nikt nie
   > ruszył. „Kilka przejść zimnych" trzeba liczyć od ZERA trafień, nie od ciepłego cache'u.
   > Liczba 0,118529 USD zostaje w mocy; 0,000000 USD nie opisuje już żadnego stanu, który da się
   > dziś odtworzyć bez ponownego zapłacenia za te komórki.

   > ⚑ **KOREKTA BUDŻETU — 2026-08-23, po zatrzymaniu fazy 3.**
   > **Stara wartość: 0,50 USD** (zostaje wyżej NIETKNIĘTA — to jest liczba, wobec której
   > podejmowano wszystkie decyzje aż do fazy 3, i podmieniona w miejscu skasowałaby ślad, że
   > cokolwiek się przesunęło). **Nowa wartość: 1,50 USD.**
   >
   > Powód: faza 3 przejechała macierz i zatrzymała się na własnym kryterium 3.6 — dwie z czterech
   > komórek oblały na `error_max_turns` przy `maxTurns: 2`, przy prompcie NIETKNIĘTYM. Wyjście
   > z tego wymaga pomiaru liczników tur, a potem nowego pełnego przejścia macierzy. Ani jedno, ani
   > drugie nie mieści się w resztce 0,265 USD.
   >
   > Rozpiska nowego budżetu:
   >
   > | pozycja                                         | kwota                        |
   > | ----------------------------------------------- | ---------------------------- |
   > | wydane dotąd (faza 3, rachunek z `/api/v1/key`) | **0,235012**                 |
   > | pomiar liczników (faza 3a.1, sześć przebiegów)  | **~0,35**                    |
   > | nowe pełne przejście macierzy (faza 3)          | **> 0,235012** — patrz niżej |
   > | zapas na JEDNĄ pomyłkę                          | reszta                       |
   >
   > **Nie zakładamy, że nowe przejście kosztuje tyle co poprzednie.** Podniesiony `maxTurns` to
   > więcej tur, a więcej tur to więcej tokenów — nowe przejście jest z definicji DROŻSZE niż
   > 0,235012, a o ile, tego dziś nie wiadomo. Zapisujemy nierówność, nie liczbę, bo liczby nie
   > mamy.
   >
   > **⚑ Budżet podniesiony w momencie, w którym zaczyna wiązać, przestaje być budżetem — kolejne
   > podniesienie wymaga rozmowy, nie kolejnej notatki.** To zdanie jest tu przepisane z poprzedniej
   > zmiany świadomie, bo to jest **DRUGIE podniesienie z rzędu, w dwóch kolejnych zmianach**.
   > Rozmowa się odbyła: zatrzymanie fazy 3 wróciło do człowieka z liczbami i z trzema odrzuconymi
   > drogami na skróty, a podniesienie jest jego decyzją podjętą nad tym rachunkiem — nie
   > dopisaniem sobie miejsca przez agenta, któremu zabrakło.
   >
   > ⚑ **DOMKNIĘCIE (ten sam dzień, po pomiarze 3a.1): podniesiony budżet NIE ZOSTAŁ wykorzystany —
   > i to jest WYNIK, nie przeoczenie.** Wydatek kończy się na **0,616749 USD** (0,235012 faza 3 +
   > 0,381737 faza 3a.1) z 1,50 USD. Dalsze fazy **nie wołają modeli**: rozwiązaniem okazało się
   > rozdzielenie przyczyn w zapadce (D-6, D-9), a nie kolejne przejście macierzy — **dzisiejszy
   > rekord staje się ważnym dowodem TAKIM, JAKI JEST**, z dwiema komórkami w stanie „model nie
   > dowiózł". Podniesienie budżetu zostaje w mocy jako decyzja podjęta jawnie; nie cofamy go, bo
   > cofnięcie zacierałoby fakt, że zostało podjęte. Ale nie wolno go czytać jako środków do
   > wydania: **1,50 to sufit, którego ta zmiana nie dotknęła.**

7. **Diagnostyka czerwieni ma być jednoznaczna.** Komunikat kroku musi rozróżniać „zmieniłeś
   prompt, brakuje dowodu" od „dowód jest, ale dla innego promptu" i mówić wprost, jaką komendą
   dowód się wytwarza. Bramka, po której trzeba czytać źródło skryptu, żeby wiedzieć, co zrobić,
   jest bramką, którą się obchodzi.

## Obserwacje z repo — MATERIAŁ dla researchu, nie rozstrzygnięcia

Zapisane, bo wpływają na to, czy wymaganie 2 da się w ogóle spełnić. Research ma je potwierdzić
albo obalić; żadna z nich nie jest tu decyzją.

- **`PROMPT_SOURCES` idzie w PRZECIWNĄ stronę, niż potrzebuje ta bramka.** Hashuje SEKCJE ŹRÓDEŁ,
  z których prompt został zdestylowany (`AGENTS.md` §Hard Rules, §Conventions, `test-plan.md`
  §2 Risk Map) — czyli odpowiada na pytanie „czy destylat nadal opisuje repo", a nie „czy prompt
  się zmienił". `agents/review/prompt.ts`, `review-schema.ts` ani `criteria.json` nie są tam
  wymienione. Reużycie samej listy może więc być reużyciem niewłaściwej rzeczy.
- **Bliższym kandydatem wygląda `fingerprintPrompt` z `agents/review/evals/cache.ts`** — cztery
  osie liczone z WARTOŚCI faktycznie wysyłanych do `query(...)`, nie z listy ścieżek, więc
  z definicji nie jest ręcznie utrzymywaną listą i nie może się zestarzeć przez przeoczenie pliku.
  Jego własny komentarz stanowi wprost, że każda nowa wartość przekazywana do wywołania należy do
  odcisku. Do sprawdzenia: czy da się go policzyć BEZ wołania modelu i bez zależności runtime'owych
  (wymaganie 1, plus wzorzec „zero `npm ci`" z `prompt-ratchet.yml`).
- **Opisy kryteriów prawdopodobnie wchodzą do odcisku okrężną drogą.** `prompt.ts` świadomie nie
  zawiera listy kryteriów — mieszkają w `.describe()` na schemacie, a `REVIEW_JSON_SCHEMA` powstaje
  z `z.toJSONSchema(...)` i jest jedną z czterech osi. Jeśli `toJSONSchema` przenosi `description`,
  zmiana treści kryterium unieważnia odcisk sama z siebie. **To jest pomiar do wykonania**, nie
  wniosek — od niego zależy, czy wymaganie 2 jest już spełnione, czy wymaga dołożenia osi.
- **Próg werdyktu leży POZA odciskiem wywołania.** `SCORE_THRESHOLD = 5` mieszka
  w `scripts/review-verdict.ts`, a kolejność i etykiety kryteriów w `agents/review/criteria.json`
  — obie rzeczy zmieniają WERDYKT bramki review, nie zmieniając ani jednej z czterech osi.
  **To jedyna obserwacja z tej listy, która NIE jest tylko materiałem: podniesiona do pierwszego
  pytania otwartego niżej i wiąże wymaganie 2.** Reszta tej sekcji może się w researchu rozejść
  w dowolną stronę bez skutku dla kształtu bramki; ta nie.

## Pytania otwarte dla researchu

- **⚑ PYTANIE PIERWSZE: czy próg werdyktu i `criteria.json` wchodzą do dowodu?** To jedyna
  zmierzona LUKA w odcisku, a nie przypuszczenie: `SCORE_THRESHOLD = 5` (`scripts/review-verdict.ts`)
  oraz kolejność i etykiety kryteriów (`agents/review/criteria.json`) zmieniają werdykt bramki
  review, **nie ruszając ani jednej z czterech osi** `fingerprintPrompt`. Zapadka oparta na samym
  tym odcisku przepuści więc podniesienie progu z 5 na 8 jako zmianę niewymagającą dowodu — a to
  jest zmiana, po której agent review odrzuca PR-y, których wczoraj nie odrzucał.
  Cena pomyłki w obie strony, bo obie są realne:
  - **za wąsko** (próg poza dowodem) — bramka ma dziurę dokładnie w miejscu, w którym najłatwiej
    po cichu przestroić ostrość całego review, i to jednym znakiem w pliku, którego nikt nie kojarzy
    z promptem;
  - **za szeroko** (próg w odcisku wywołania) — dowód unieważnia się przy zmianie, która nie zmienia
    ODPOWIEDZI MODELU, więc człowiek płaci za przejście macierzy, żeby udowodnić coś, o czym macierz
    nic nie mówi. Bramka, która każe kupować bezużyteczny dowód, uczy obchodzenia siebie samej.
    Research ma rozstrzygnąć, czy to jedna zapadka o szerszym odcisku, dwie osobne, czy świadomie
    przyjęta luka z zapisanym uzasadnieniem — **decyzja „nie wiem" jest tu niedopuszczalna**, bo
    wymaganie 2 wprost pyta o „wszystko, co zmienia werdykt".
- **Gdzie ma zamieszkać zapadka — w istniejącym `prompt-ratchet.yml`, czy we własnym workflow?**
  Za `prompt-ratchet.yml`: pilnuje już promptu, nie ma filtra ścieżek (świadomie), jest sekundowy
  i bezzależnościowy, ma dokładnie tę samą własność „PR dotykający tylko dokumentacji też musi go
  uruchomić". Przeciw: zlewałby dwie różne gwarancje w jeden job — „destylat opisuje aktualne
  repo" i „zmiana promptu ma zmierzony skutek" — a wtedy nazwa czerwieni przestaje mówić, co jest
  zepsute. Sprawdź, którą diagnostykę widzi człowiek na czerwonym PR-ze w obu wariantach.
- **Gdzie zapisać wynik macierzy, żeby przetrwał `lint-staged`** (wymaganie 5) — wyłączenie
  w `.prettierignore`, inny format, inne miejsce w drzewie? Każda odpowiedź ma cenę; ta notatka
  żadnej nie przesądza. Uwaga na precedens: dzisiejszy `.prettierignore` wyłącza archiwum
  z uzasadnieniem „dowód jest niezmienny", co jest argumentem tej samej rodziny.
- **Co dokładnie ma być w zapisanym wyniku — sam odcisk i pass/fail, czy pełna tabela z kosztem
  i czasem?** Argument za pełną: byłoby to JEDYNE miejsce w repo, z którego widać trend kosztu,
  a archiwum pokazuje, że koszt komórki jest zmienną losową o rozrzucie dziesiątek procent, więc
  seria pomiarów ma wartość, której pojedynczy przebieg nie ma. Argument przeciw: im więcej pól
  zmiennych w pliku, tym hałaśliwszy diff — a plik, którego diffu się nie czyta, regeneruje się
  odruchowo.
- **Czy zapadka ma pilnować także OBECNOŚCI dowodu dla zmiany, która promptu nie rusza?** Czyli co
  robi, gdy odcisk się zgadza, a wyniku nie ma wcale — czerwień czy zieleń. Odpowiedź decyduje
  o tym, czy bramka jest zapadką, czy wymogiem dokumentacyjnym.

## Poza zakresem

- Rozszerzanie macierzy (więcej fikstur, więcej kolumn, `sample-injection.diff`) — zestaw wchodzi
  do bramki w kształcie, w jakim został zmierzony.
- Strojenie progu 5 i domykanie obserwacji miękkiej `conditional-null-contract` do twardej
  asercji — oba zapisane w archiwum jako pytania do pomiaru, oba niezależne od tej zmiany.
- Uruchamianie macierzy w CI w jakiejkolwiek postaci — wykluczone decyzją 1.

## ⚑ ROZSZERZENIE ZAKRESU — ROZWAŻONE, UZASADNIONE, COFNIĘTE NA DANYCH

> **Ta sekcja jest ŚLADEM, nie obowiązującą deklaracją zakresu.** Rozszerzenie zostało rozważone
> 2026-08-23 po zatrzymaniu fazy 3, faza 3a miała je uzasadnić pomiarem — i **pomiar je
> unieważnił**: 3a.1 nie ustaliło, co liczy `numTurns`, więc każda nowa wartość `maxTurns` byłaby
> zgadywaniem wdrożonym do wywołania produkcyjnego. **Zakres WRACA do pierwotnego: ta zmiana nie
> dotyka `FIXED_CALL_OPTIONS` ani niczego innego w wywołaniu recenzenta produkcyjnego.**
> Zatrzymanie fazy 3 rozwiązuje poprawka D-6 (rozdzielenie „model nie dowiózł" od „prompt
> zregresował") plus D-9 — obie po stronie ZAPADKI, czyli w pierwotnym zakresie.
>
> Nie kasujemy tej sekcji, bo decyzja, która się cofnęła na danych, jest warta dokładnie tyle, co
> pomiar, który ją cofnął — a dokument, z którego znika rozważona droga, czyta się jak dokument,
> który nigdy nie miał wątpliwości. Poniżej ORYGINALNE brzmienie.

### Oryginalne brzmienie (nieobowiązujące)

**Ta zmiana od teraz modyfikuje także wywołanie recenzenta PRODUKCYJNEGO**: wartość `maxTurns`
w `FIXED_CALL_OPTIONS` (`agents/review/run-review.ts`), czyli parametr, z którym agent review jedzie
na KAŻDYM PR-ze. Do tej pory zmiana dotykała wyłącznie warstwy bramki i dowodu.

**Powód.** Rozdzielenie tego na dwie zmiany kosztowałoby dodatkowe przejście całego łańcucha skilli
(`/10x-new` → `/10x-research` → `/10x-plan` → `/10x-plan-review` → `/10x-implement` → archiwizacja),
a obie zmiany i tak dzielą **tę samą oś odcisku**: `maxTurns` jest osią 4 `callFingerprint`, więc
zmiana „macierzowa" przesunęłaby kotwicę, wokół której napisana jest zmiana „bramkowa". Rozdzielone
musiałyby się nawzajem przekotwiczać — druga otwierałaby się od przepisania liczby, którą zamknęła
pierwsza, i żadna nie mogłaby być zweryfikowana samodzielnie.

**Koszt tej decyzji, zapisany jawnie, bo jest realny.** Kryterium **„dyscyplina zakresu"** z naszego
własnego zestawu review jest tutaj **NACIĄGNIĘTE**: zmiana o bramce dotyka konfiguracji produkcyjnej
agenta. Recenzent — ludzki albo nasz własny — ma prawo to zauważyć i **chcemy, żeby zauważył to nad
zapisanym uzasadnieniem, a nie nad milczeniem**. Zapis nie unieważnia zarzutu; sprawia tylko, że
rozmowa zaczyna się od „czy ten powód wystarcza", a nie od „dlaczego nikt tego nie nazwał".

Granica pozostaje wąska i wiążąca: w zakresie jest **jedna wartość** (`maxTurns`), wybrana
Z POMIARU w fazie 3a. Nie wchodzą: `tools`, cap budżetu, wybór modelu produkcyjnego ani nic innego
w `FIXED_CALL_OPTIONS`.
