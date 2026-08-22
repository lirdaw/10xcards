# Wymagania — workflow CI/CD uruchamiający agenta code review na PR-ach

Notatka wymagań, nie plan i nie implementacja. Opisuje, CZEGO oczekujemy od
workflow, który przy każdym pull requeście uruchomi istniejącego agenta
z `agents/review/` (M5L2, Claude Agent SDK).

## Koncepcja

Workflow uruchamiany dla każdego pull requesta kierowanego do gałęzi domyślnej
repozytorium. Gałęzią domyślną jest **`main`** — sprawdzone, nie założone:
`origin/HEAD` wskazuje na `refs/remotes/origin/main`, a wszystkie trzy istniejące
workflow'y w `.github/workflows/` celują w `main`. Lekcja „Match branch names in
CI/hooks to the repo's actual default (`main`)" z `context/foundation/lessons.md`
opisuje dokładnie ten defekt: scaffoldowany workflow wyzwalany na `master`, który
po cichu nie uruchomił się nigdy. Każde miejsce w nowym workflow odwołujące się do
gałęzi ma używać nazwy `main`.

Samo review ma być wydzielone do osobnej, nazwanej czynności (composite action),
a główny scenariusz workflow ma zostać czytelny jednym rzutem oka: pobierz stan
PR-a → zbierz wejście dla agenta → uruchom review → opublikuj efekty. Szczegóły
uruchomienia agenta (instalacja zależności agenta, przekazanie sekretu, obsługa
kodu wyjścia, kształt wyniku) chowamy za tą jedną czynnością. Kryterium sukcesu
dla tego podziału jest czytelnicze, nie techniczne: osoba, która widzi ten
workflow pierwszy raz, ma po przeczytaniu głównego pliku umieć powiedzieć, co się
dzieje i w jakiej kolejności, bez wchodzenia w środek composite action.

Nowy workflow jest osobnym bytem obok istniejącego `ci.yml` (lint / typecheck /
testy / drift). Review agenta jest sygnałem doradczym dla autora i recenzenta,
a nie zamiennikiem tamtych bramek. Co dokładnie z tego wynika — czym steruje
werdykt, czym nie steruje i pod jakim warunkiem tę decyzję rewidujemy — opisuje
sekcja „Werdykt".

## Wejście dla agenta

Agent dostaje dokładnie trzy rzeczy:

1. **Tytuł PR-a** — deklaracja intencji, punkt odniesienia dla kryterium
   dyscypliny zakresu (czy PR robi to, co obiecuje).
2. **Opis PR-a** — uzasadnienie i kontekst od autora; również materiał dla
   kryteriów dokumentacji i zakresu.
3. **`git diff` względem gałęzi bazowej** — cała zmiana PR-a liczona od punktu
   rozejścia z `main`, a nie diff ostatniego commita. Wymaga to pobrania historii
   sięgającej punktu rozejścia; płytkie pobranie da diff pusty albo absurdalnie
   szeroki, w obu wypadkach po cichu.

Agent dziś czyta diff ze standardowego wejścia i kończy błędem, gdy wejście jest
puste — to zachowanie jest pożądane i workflow ma je uszanować. **Pusty diff to
awaria zbierania wejścia, nie „zero uwag"**; workflow nie może zamienić go
w zielony wynik. To ta sama klasa błędu co „bramka, która zawsze świeci na
zielono" (patrz kryterium 8).

Poza tymi trzema rzeczami agent nie dostaje nic: bez dostępu do narzędzi, bez
plików repo, bez `CLAUDE.md` i skilli. To świadome ograniczenie z M5L2 — review
ma być wąskie i przewidywalne — i to ono wyznacza granicę sekcji „Odłożone na
później".

## Kryteria oceny

Dziewięć kryteriów, każde w skali **1–10**. Obecny agent ocenia pięć z nich
(`agents/review/review-schema.ts`: poprawność implementacji, idiomatyczność,
złożoność, pokrycie testami względem ryzyka, bezpieczeństwo) — dokładamy cztery:
dokumentację i uzasadnienie oraz trzy własne (7, 8, 9).

Wymaganie przekrojowe: **każde kryterium musi mieć w opisie jawnie napisane, co
znaczy 1, a co znaczy 10**, i to na tyle konkretnie, żeby dwie osoby czytające ten
opis oceniły ten sam diff podobnie. To nie jest kosmetyka — schemat wyjścia nie
egzekwuje zakresu 1–10 (structured output odrzuca `minimum`/`maximum` na typie
całkowitym), więc opis pola jest jedyną realną dźwignią sterowania modelem. Opis
w rodzaju „kod jest czytelny" nie steruje niczym.

### 1. Poprawność implementacji

Czy kod robi to, co deklaruje — na ścieżce głównej, w przypadkach brzegowych
i w obsłudze błędów.

- **1** — logika jest błędna albo po cichu psuje istniejące zachowanie: warunek
  odwrócony, ścieżka błędu renderuje się jako sukces (loader SSR pokazuje stan
  pusty zamiast błędu zapytania), endpoint JSON odpowiada przekierowaniem, którego
  klient nie odróżni od sukcesu, `.astro` robi top-level `return` we frontmatterze.
- **10** — poprawny na ścieżce głównej, w przypadkach brzegowych (brak danych,
  zasób nieistniejący, żądanie powtórzone) i w obsłudze błędów; błąd zapytania jest
  odróżniony od braku danych, a odmowa od awarii.

### 2. Idiomatyczność

Zgodność z konwencjami języka **i tego projektu** — konwencje spisane są
w `AGENTS.md` i mają pierwszeństwo przed ogólnym gustem.

- **1** — łamie twarde reguły repo: głębokie ścieżki względne zamiast `@/*`,
  odczyt środowiska przez `import.meta.env`/`process.env` zamiast
  `astro:env/server` (poza dwoma udokumentowanymi wyjątkami: `scripts/`
  i `src/worker.ts`), ręczne sklejanie klas Tailwind zamiast `cn()`, dyrektywy
  z Next.js (`"use client"`), które w Astro nie robią nic, wyspa React tam, gdzie
  wystarczał statyczny `.astro`, lokalne nadpisanie pierścienia focusu zamiast
  wspólnego tokenu `--ring`.
- **10** — nieodróżnialny od kodu, który już w repo jest: te same importy, ten sam
  podział `.astro`/wyspa, ta sama obsługa błędu formularza (przekierowanie
  z parametrem `error`), polska kopia UI, angielskie identyfikatory.

### 3. Złożoność

Prostota rozwiązania **względem problemu**, który rozwiązuje — nie krótkość kodu.

- **1** — rozwiązanie nieproporcjonalne: warstwa abstrakcji dla jednego wywołania,
  konfiguracja pod przyszłe potrzeby, których nikt nie zamówił, stan trzymany
  w dwóch miejscach i ręcznie synchronizowany, przepływ sterowania, którego nie da
  się prześledzić bez rysowania.
- **10** — najprostsza rzecz, która pokrywa opisane wymaganie; nowe pojęcia
  pojawiają się tylko tam, gdzie problem je faktycznie ma; czytelnik trzyma całą
  ścieżkę w głowie naraz.

### 4. Pokrycie testami względem ryzyka

Nie „ile procent linii", tylko: czy testy dotykają tego, co w tym projekcie
naprawdę potrafi zaboleć. Odniesieniem jest mapa ryzyk z
`context/foundation/test-plan.md` §2 — izolacja danych między kontami (#1),
podwojony zapis po powtórzeniu żądania (#2), harmonogram powtórek (#3), wyciek
tekstu źródłowego lub klucza API (#4), drift schematu (#5), walidacja po stronie
serwera (#6), język i użyteczność wygenerowanych kart (#7) — wraz z kolumną
„co dowodzi ochrony".

- **1** — zmiana dotyka ścieżki z mapy ryzyk i nie przynosi żadnego testu, albo
  przynosi test, który przechodzi niezależnie od zachowania (asercja
  niefalsyfikowalna, brak kontroli pozytywnej przy teście odmowy).
- **10** — każda ścieżka ryzyka, której zmiana dotyka, ma test dowodzący dokładnie
  tego, co według §2 dowodzi ochrony (np. dla #1: konto B odbite na odczycie
  **i** na zapisie, przy jednoczesnym dowodzie, że konto A nadal sięga po swoje);
  kod bez ryzyka nie jest obudowywany testami na siłę.

### 5. Dokumentacja i uzasadnienie

Czy z diffa da się odtworzyć **dlaczego**, a nie tylko **co**.

- **1** — brak uzasadnienia tam, gdzie decyzja jest nieoczywista; komentarz opisuje
  linijkę pod nim („zwiększamy licznik"); komentarz-etykieta w rodzaju
  „best-effort" udaje decyzję, której nikt nie podjął; zmiana łamie regułę spisaną
  w `AGENTS.md`/`CLAUDE.md` i nigdzie tego nie odnotowuje; zmiana zachowania
  widocznego dla użytkownika nie ma śladu w opisie PR-a.
- **10** — nieoczywiste decyzje mają zapisany powód **wraz z konsekwencją** (co się
  stanie, gdy założenie przestanie obowiązywać, kto zauważy awarię); kontrakty,
  na których opiera się poprawność, są opisane jako kontrakty, a nie jako
  dekoracja; dokumentacja projektowa (`AGENTS.md`, `context/foundation/*`) jest
  aktualizowana wtedy i tylko wtedy, gdy zmiana unieważniła jej treść.

### 6. Bezpieczeństwo

- **1** — sekret trafia do repo, do logu albo do treści odpowiedzi; sprawdzenie
  właściciela zasobu zdjęte lub obchodzone (identyfikator z URL-a traktowany jako
  dowód dostępu); nowa trasa chroniona zapomniana w liście tras chronionych
  w middleware; tekst źródłowy użytkownika albo klucz LLM w komunikacie błędu
  (ryzyko #4 z mapy ryzyk).
- **10** — dane wejściowe walidowane po stronie serwera niezależnie od UI
  (ryzyko #6); dostęp rozstrzygany na tożsamości z sesji, nie na parametrze
  żądania; komunikaty błędów nie wynoszą treści użytkownika ani sekretów;
  uprawnienia i zakres tokenów w CI ograniczone do tego, co dany krok naprawdę robi.

### 7. Połknięty błąd — **kryterium warunkowe**

Czy wynik zapisu, kompensacji albo wywołania jest **sprawdzany**, czy cicho
ignorowany.

Podstawa w repozytorium — nie teoria, tylko to, co ten projekt przerobił
w sierpniu 2026. Pięć folderów w `context/archive/` to ta jedna klasa defektu:
`2026-08-12-bug-generation-compensation-swallowed`,
`2026-08-13-bug-generation-deck-undo-swallowed`,
`2026-08-13-bug-generation-failed-audit-swallowed`,
`2026-08-13-bug-signout-swallowed`,
`2026-08-14-bug-middleware-getuser-swallowed`. Reguły, które z nich zostały
(wszystkie w `context/foundation/lessons.md`): „Wynik zapisu KOMPENSUJĄCEGO
sprawdzasz jak każdy inny — a bez jawnego `.select()` nie ma czego sprawdzić",
„Loadery SSR rozróżniają błąd zapytania od braku danych" oraz „Middleware nie może
odpowiadać endpointowi JSON redirectem — klient czyta 302 jako sukces".

- **1** — wynik operacji, która może się nie udać, jest porzucany albo sprowadzony
  do samego pola `error`; zapis sprzątający po nieudanym kroku wygląda jak
  sprzątanie i milczy, gdy zawiedzie; zero dopasowanych wierszy jest nieodróżnialne
  od udanego zapisu; komentarz „best-effort" zastępuje sprawdzenie.
- **10** — każdy wynik jest odczytany i rozgałęziony na tym, co faktycznie dowodzi
  skutku (nie na samym braku błędu); kompensacja jest traktowana jak zwykły zapis;
  tam, gdzie awaria ma pozostać nieobsłużona, jest to zapisana decyzja
  z konsekwencją i wskazanym świadkiem awarii, a nie przeoczenie.
- **„nie dotyczy"** — gdy diff nie dotyka żadnej ścieżki zapisu, kompensacji ani
  wywołania mogącego zawieść (np. zmiana wyłącznie w treści UI, w dokumentacji,
  w statycznym stylu).

### 8. Integralność bramki — **kryterium warunkowe**

Jeśli zmiana dodaje albo modyfikuje sprawdzenie — test, krok CI, hook, asercję —
to czy to sprawdzenie **w ogóle potrafi zaświecić na czerwono**.

Podstawa w repozytorium: lekcja „Komenda, która ZAWSZE kończy się kodem 0, nie
jest bramką — sprawdź exit code, zanim na niej zbudujesz gate" (kandydaci na
wykrywacz driftu schematu wracali z kodem 0 niezależnie od wyniku, więc krok CI
napisany z dokumentacji był zielony na zawsze), lekcja „A positive control must OWN
the fixture it mutates" oraz „`.insert(...).select(...).single()` to FAŁSZYWY orakl
na zduplikowany zapis". Foldery: `context/archive/2026-08-02-typecheck-gate`,
`context/archive/2026-07-27-schema-drift-test`,
`context/archive/2026-07-15-verification-harness`. Zdanie, które zostało z tamtej
lekcji: **bramka, która nie potrafi zaświecić na czerwono, jest gorsza niż jej
brak, bo zdejmuje czujność.**

- **1** — sprawdzenie jest niefalsyfikowalne: werdykt oparty na kodzie wyjścia
  komendy, która zawsze zwraca 0; asercja na braku negatywnego komunikatu zamiast
  na obecności pozytywnego; test, który przechodzi także na celowo zepsutym kodzie;
  kontrola pozytywna oparta na cudzej fixture, więc zielona tylko w jednej
  kolejności; krok CI, który zapisuje wynik do pliku i czyta pusty plik jako „brak
  różnic".
- **10** — pokazana albo oczywista jest droga do czerwieni: sprawdzenie zostało
  zmierzone w obu kierunkach (stan dobry i celowo zepsuty), różnica między
  przebiegiem zielonym a czerwonym to dokładnie jedna rzecz, werdykt opiera się na
  treści wyniku, a nie na samym kodzie wyjścia, i zmiana po stronie dostawcy wywala
  bramkę na czerwono (fail closed), zamiast ją po cichu wyłączać.
- **„nie dotyczy"** — gdy diff nie dodaje ani nie modyfikuje żadnego sprawdzenia.

#### Dlaczego 7 i 8 nie są zwykłymi ocenami

Dla obu kryteriów agent ma **wprost odpowiedzieć „nie dotyczy"**, kiedy diff nie
wchodzi w ich zakres — zamiast wystawiać jakąkolwiek ocenę.

Powód jest arytmetyczny: **ocena 10 za brak ryzyka zawyżałaby wynik**. PR, który
nie dotyka żadnej ścieżki zapisu, dostałby wtedy komplet punktów za coś, czego
w ogóle nie zrobił, i wypadłby lepiej niż PR, który tę ścieżkę ruszył i obsłużył ją
porządnie. Sygnał odwróciłby się przeciwko dokładnie tym zmianom, na których nam
zależy najbardziej. Ocena 1 w tej sytuacji jest równie fałszywa — karałaby za
nieistniejące ryzyko.

Stąd wymagania: wynik ma odróżniać „nie dotyczy" od oceny liczbowej (to muszą być
rozróżnialne wartości — nie zero i nie puste pole), a „nie dotyczy" nie może
wchodzić do żadnej agregacji ani wpływać na werdykt. W komentarzu PR-a takie
kryterium pokazujemy jawnie jako pominięte; brak wpisu byłby nieodróżnialny od
oceny, o której agent zapomniał.

### 9. Dyscyplina zakresu

Czy PR robi dokładnie to, co deklaruje w tytule i opisie, bez przypadkowych
poprawek w sąsiednim kodzie.

Podstawa w repozytorium: lekcja „Poleruj tylko własne komponenty slice'a — zakres
sąsiednich rozstrzygaj przed budową" z `context/foundation/lessons.md`. Wprost
opisany przypadek pochodzi z `context/archive/2026-07-09-manual-card-crud`: commit
trzeciej fazy wwiózł zwijanie panelu bocznego, stopkę-mock i restyle przycisków —
rzeczy spoza CRUD-u kart. Wyłapane dopiero w przeglądzie implementacji, kiedy było
już zbudowane i zacommitowane, więc nie dało się tanio odłożyć. Typowy wyzwalacz:
„jestem tu, to od razu poprawię", zwłaszcza na współdzielonych prymitywach UI,
powłoce aplikacji i globalnych stylach.

- **1** — diff zawiera zmiany bez związku z deklaracją: oportunistyczny restyle
  współdzielonego komponentu, „przy okazji" refaktor sąsiedniego modułu, zmiana
  formatowania w plikach, których zadanie nie dotyczyło, albo dwie niezależne
  zmiany zlepione w jeden PR tak, że nie da się cofnąć jednej bez drugiej.
- **10** — każdy dotknięty plik daje się wyprowadzić z deklaracji PR-a; rzeczy
  zauważone po drodze, a niebędące w zakresie, są odłożone i odnotowane, a nie
  zrobione mimochodem; zmiana jest odwracalna jako całość.

W odróżnieniu od kryteriów 7 i 8 to kryterium **dotyczy każdego PR-a bez wyjątku** —
każda zmiana ma jakąś deklarację i jakiś zakres, więc jest to zwykła ocena 1–10,
bez wariantu „nie dotyczy".

## Werdykt

### Jak powstaje

Werdykt jest **jeden dla całej zmiany** i przyjmuje jedną z dwóch wartości:
`pass` albo `fail`. Nie ma werdyktów cząstkowych ani „warunkowego przejścia".

Reguła: **`fail`, gdy całościowa ocena agenta to `fail`, LUB gdy którekolwiek
pojedyncze kryterium dostało ocenę poniżej progu** (próg: 5). Kryteria oznaczone
„nie dotyczy" są z tego wyłączone — nie mają liczby, więc nie mogą progu ani
przekroczyć, ani nie przekroczyć; ich pominięcie nie jest ani argumentem za
`pass`, ani za `fail`. Dwa źródła `fail` są celowo alternatywą, nie koniunkcją:
agent może dostrzec problem, którego nie umiał wcisnąć w żadne pojedyncze
kryterium, i odwrotnie — może wystawić jedynkę i mimo to podsumować całość
łagodnie.

**Nie używamy średniej z ocen** i to jest decyzja, nie przeoczenie. Średnia chowa
jeden katastrofalny wymiar wśród ośmiu dobrych: dziewiątka na ośmiu kryteriach
i jedynka na dziewiątym daje wynik, który w każdym zestawieniu wygląda dobrze.
A tym jednym wymiarem będzie w praktyce **bezpieczeństwo** (kryterium 6) albo
**połknięty błąd** (kryterium 7) — czyli dokładnie to, po co ten agent w ogóle
istnieje. Pięć folderów `…-swallowed` w `context/archive/` z jednego tygodnia to
nie hipoteza, tylko zmierzony rozkład defektów w tym repo. Uśrednianie zamienia
weto na jeden głos w głosowaniu, w którym pozostałe osiem kryteriów zawsze
przegłosuje to jedno.

**Próg ma być jedną, jawnie nazwaną liczbą w konfiguracji** — nie wartością
wplecioną w treść promptu ani w opis któregokolwiek kryterium. Powód jest
praktyczny: przesunięcie czułości review ma być zmianą jednej wartości, a nie
przeredagowaniem opisów kryteriów. Gdy próg siedzi w prompcie, każde jego
ruszenie zmienia wejście modelu, więc jednocześnie zmienia to, **co** agent
ocenia, i unieważnia porównanie przebiegów sprzed i po zmianie — a to jest
dokładnie ten pomiar, którego potrzebujemy do warunku wyjścia opisanego niżej.

### Co werdykt wywołuje

Werdykt steruje **wyłącznie dwiema rzeczami**: którą etykietę wyniku dostaje PR
(`ai-cr:passed` / `ai-cr:failed`) i jak brzmi treść komentarza. Nic poza tym.

**Krok workflow kończy się sukcesem także przy werdykcie `fail`. Review agenta
niczego nie blokuje.**

Uzasadnienie stoi na fakcie, nie na założeniu: **dziś nie blokuje nic.** `main` nie ma
branch protection (`404 Branch not protected`) ani żadnego ruleseta (`rulesets → []`),
więc `ci.yml` — lint, typecheck, testy, drift — **nie rozstrzyga o merge'u**: może być
czerwony, a merge i tak przejdzie. Wcześniejsza wersja tego akapitu twierdziła, że
„o merge'u rozstrzygają istniejące bramki z `ci.yml`", i to było nieprawdą — stan
żywy odczytany 2026-08-21, `research.md` §3.

Decyzja przez to się nie zmienia, tylko lepiej trzyma: review **świadomie nie zmienia
tego stanu** — nie dokłada bramki tam, gdzie żadnej nie ma, i nie udaje, że jakąś
zastaje. Gdyby kiedyś włączyć ochronę `main`, objęłaby ona `ci.yml`, a nie ten
workflow — chyba że zapadnie osobna decyzja opisana w „Warunku powrotu" niżej.

**To nie jest to samo co awaria review** i te dwa stany muszą pozostać
rozróżnialne. Awaria — pusty diff, brak sekretu, błąd wywołania agenta — nadal
wywala workflow na czerwono i **nie nakłada żadnej etykiety wyniku**. Stany są
trzy i każdy wygląda inaczej: przeszło (zielony przebieg, `ai-cr:passed`), nie
przeszło (zielony przebieg, `ai-cr:failed`), nie odbyło się (czerwony przebieg,
zero etykiet wyniku). Czerwony przebieg zawsze znaczy „review się nie wykonało",
nigdy „review wypadło źle".

### Ryzyko tej decyzji i warunek wyjścia z niej

Nazwijmy koszt wprost: **przebieg, który zawsze kończy się sukcesem, z czasem
przestaje być czytany.** Po kilkunastu zielonych przebiegach nikt nie klika
w szczegóły, więc cały ciężar sygnału spoczywa na etykiecie i na komentarzu —
i tylko na nich. To podnosi poprzeczkę obu tym efektom ubocznym: etykieta musi
być widoczna na liście PR-ów bez wchodzenia w środek, a komentarz musi dać się
przeczytać w kilkanaście sekund i sam z siebie powiedzieć, **które** kryterium
zeszło poniżej progu i dlaczego. Komentarz, który trzeba rozwijać, żeby zobaczyć
powód `fail`, jest w tym układzie równie niemy co nieprzeczytany przebieg.

Lekcja „Komenda, która ZAWSZE kończy się kodem 0, nie jest bramką" z
`context/foundation/lessons.md` opisuje pozornie ten sam kształt, ale **nie jest
tu złamana**. Tamten defekt polegał na tym, że krok **podawał się za bramkę**
(wykrywacz driftu schematu), a nie potrafił zaświecić na czerwono — zdejmował
czujność, bo ludzie wierzyli, że ryzyko jest domknięte. Tutaj krok niczego nie
udaje: nie jest wymagany do merge'a, nie wchodzi na listę wymaganych sprawdzeń,
a jego werdykt jest jawnie doradczy. Reguła bije w bramkę niezdolną do czerwieni;
my nie stawiamy bramki.

Ale to jest **świadome zawieszenie, nie wyjątek na zawsze**. Powód zawieszenia:
nie wiemy jeszcze, ile fałszywych alarmów ten agent wystawia na naszych realnych
PR-ach. Twarda bramka o nieznanym poziomie fałszywych alarmów uczy zespół, jak ją
obchodzić — a bramka, którą wszyscy obchodzą, jest gorsza niż jej brak z tego
samego powodu, który wypisuje tamta lekcja.

Warunek powrotu do tej decyzji zapisujemy jako **pytanie do sprawdzenia, nie jako
termin**: czy na zestawie evali zbudowanym z realnych PR-ów z tego repozytorium —
w tym z tych, które faktycznie wwiozły defekty udokumentowane w
`context/archive/` — poziom fałszywych alarmów jest na tyle niski, żeby `fail`
mógł zostać warunkiem merge'a? Dopóki nie ma na to odpowiedzi opartej na
pomiarze, a nie na wrażeniu, decyzja stoi. Przy tej samej okazji warto zmierzyć
drugą stronę tego ryzyka: czy komentarz i etykieta są w ogóle czytane, skoro nikt
nie musi już czytać przebiegu.

## Odłożone na później

**Dopasowanie biznesowe** (czy zmiana realizuje to, czego naprawdę wymaga produkt —
PRD, roadmapa, ticket) i **dopasowanie architektoniczne** (czy mieści się
w granicach modułów i w przyjętym kształcie systemu) świadomie zostają poza tą
iteracją.

Powód jest jeden i twardy: obu nie da się ocenić z samego diffa. Wymagają kontekstu
szerszego niż zmienione linie — treści PRD i roadmapy, ticketu, całych plików wokół
zmiany, historii wcześniejszych decyzji. Agent w obecnym kształcie działa bez
narzędzi i bez dostępu do repozytorium, dokładnie po to, żeby review było wąskie
i przewidywalne. Wystawienie oceny „dopasowania do architektury" na podstawie
samego diffa dałoby liczbę wyglądającą wiarygodnie i pozbawioną pokrycia — czyli to
samo, przed czym broni kryterium 8.

Wracamy do tego wtedy, gdy agent dostanie kontrolowany dostęp do dokumentów
projektowych i do ticketu — jako osobna decyzja, nie przy okazji.

## Oczekiwane efekty uboczne

1. **Komentarz z podsumowaniem w PR-ie.** Publikowany po zakończeniu review;
   zawiera podsumowanie od agenta, komplet ocen kryteriów (z jawnie zaznaczonym
   „nie dotyczy" tam, gdzie ono padło) oraz werdykt. Kolejne uruchomienia
   aktualizują ten sam komentarz zamiast dokładać nowe — wątek PR-a ma pozostać
   czytelny, a aktualny stan review ma być jeden, a nie do wyszukania w historii.
2. **Etykiety wyniku:** `ai-cr:passed` (kolor zielony) przy werdykcie pozytywnym,
   `ai-cr:failed` (kolor czerwony) przy negatywnym. Są wzajemnie wykluczające się:
   nakładając jedną, workflow zdejmuje drugą, żeby PR nigdy nie nosił obu naraz.
   Jeśli etykieta nie istnieje w repozytorium, workflow ma ją utworzyć — brak
   etykiety nie może cicho pominąć tego kroku.
3. **Awaria samego review jest widoczna.** Gdy agent nie zwróci wyniku (pusty diff,
   brak sekretu, błąd wywołania), workflow kończy się niepowodzeniem i nie nakłada
   żadnej z dwóch etykiet wyniku. Brak etykiety oznacza „review się nie odbyło"
   i musi być odróżnialny od `ai-cr:passed`.

## Oczekiwane zachowanie

**Ponowne uruchomienie review na żądanie — przez nałożenie etykiety
`ai-cr:review`.** Nałożenie tej etykiety na pull request wyzwala workflow jeszcze
raz, na aktualnym stanie PR-a (bieżący diff względem `main`, bieżący tytuł
i opis) — bez wypychania pustego commita i bez klikania w interfejsie przebiegów.

Etykieta jest wyzwalaczem, nie stanem: po starcie przebiegu workflow ją zdejmuje,
żeby dało się ją nałożyć ponownie za chwilę i żeby jej obecność na PR-ie nie była
mylona z wynikiem review (wynik niosą wyłącznie `ai-cr:passed` / `ai-cr:failed`).

Uruchomienie z etykiety przechodzi tę samą ścieżkę co uruchomienie z otwarcia lub
aktualizacji PR-a — to samo wejście, te same kryteria, te same efekty uboczne
(z aktualizacją istniejącego komentarza włącznie). Nie ma trybu „lekkiego review".
