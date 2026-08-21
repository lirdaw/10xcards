# Weryfikacja — workflow CI/CD agenta code review

Zapis pomiarów, nie narracja. Każda liczba pochodzi z linii metryk na stderr agenta albo
z zegara przebiegu; nic tu nie jest przepisane z dokumentacji ani oszacowane, chyba że jest
to przy niej napisane wprost.

---

## Faza 2 — punkt odniesienia sprzed CI (przebiegi lokalne)

Powód, dla którego ten zapis powstaje w fazie 2, a nie dopiero w fazie 6: to jedyny moment,
w którym liczby dla **dziewięciopolowego kontraktu bez narzutu GitHub Actions** powstają za
darmo. Po dołożeniu composite action każdy pomiar niesie już koszt runnera i nie da się go
odjąć wstecz.

**Środowisko**: lokalnie, Windows, `npx tsx review.ts < <diff>`, klucz OpenRoutera podany na
jedno wywołanie jako `ANTHROPIC_AUTH_TOKEN`. Data: 2026-08-21.
**Model rozstrzygnięty**: `anthropic/claude-sonnet-4.6` (z linii metryk, nie z konfiguracji).

Trzy przebiegi, nie dwa — i trzeci istnieje z powodu, który trzeba przeczytać razem z tabelą
(sekcja „Kalibracja opisu uzasadnienia" niżej).

| Pomiar                            | A — `sample.diff`      | B1 — czysty diff, opis v1 | B2 — czysty diff, opis v2 |
| --------------------------------- | ---------------------- | ------------------------- | ------------------------- |
| Rozmiar diffa (znaki)             | 1 486                  | 1 084                     | 1 084                     |
| Tokeny wejścia (poza cache)       | 9                      | 9                         | 9                         |
| `cache_creation_input_tokens`     | 34 135                 | 5 194                     | 34 719                    |
| `cache_read_input_tokens`         | 0                      | 28 832                    | 0                         |
| Tokeny wyjścia                    | 3 492                  | 2 648                     | 1 959                     |
| Czas wg SDK                       | 64 089 ms              | 52 192 ms                 | 40 380 ms                 |
| `total_cost_usd`\*                | 0,1847                 | 0,0718                    | 0,1636                    |
| `terminal_reason`                 | `completed`            | `completed`               | `completed`               |
| Werdykt                           | `fail`                 | `pass`                    | `pass`                    |
| Kryterium 7 (połknięty błąd)      | 1                      | `null` („nie dotyczy")    | `null` („nie dotyczy")    |
| Kryterium 8 (integralność bramki) | `null` („nie dotyczy") | `null` („nie dotyczy")    | `null` („nie dotyczy")    |

\* `total_cost_usd` to **przelicznik z cennika Anthropica, nie rachunek OpenRoutera** —
jedziemy przez OpenRoutera, więc ta liczba nie jest fakturą. Traktujemy ją jako wskaźnik
porównawczy między przebiegami, nigdy jako kwotę.

Przebiegi B używały diffa złożonego na potrzeby tego pomiaru (dwie zmiany wyłącznie tekstowe:
kopia UI w komponencie `.astro` + akapit w `README.md`) — celowo bez jednej ścieżki zapisu,
wywołania ani sprawdzenia. To jest kontrola, której szukało kryterium sukcesu 2.5.

### Kalibracja opisu uzasadnienia — para przy jednej zmiennej różnicy

**Co zmierzył B1.** Na czystym diffie model schodził przy wysokich ocenach na ogólne
stwierdzenia braku: „Zmiana dotyczy wyłącznie tekstu wyświetlanego użytkownikowi. Żadnych
sekretów, żadnych tras, żadnego sprawdzania uprawnień." Takie zdanie da się napisać **bez
czytania tego diffa** — jest nieodróżnialne od uzasadnienia domyślnego, a więc nie jest
uzasadnieniem w sensie, którego wymaga kryterium 5 zastosowane do nas samych. Na fiksturze
(przebieg A) problem nie występował: tam, gdzie są znaleziska, model sam podaje plik i linię.
**To jest luka w opisie pola, nie w wyjściu modelu** — opis żądał dowodu, ale tylko przy
ocenach niskich, przez samo sformułowanie „wskaż brakujący dowód".

**Co zmieniło B2.** Dokładnie jedna rzecz: opis pól uzasadnienia w `review-schema.ts` dostał
zdanie żądające tego samego przy ocenach WYSOKICH („napisz, CO konkretnie w tym diffie
sprawdziłeś… uzasadnienie, które pasowałoby do dowolnej zmiany, nie jest uzasadnieniem").
Prompt systemowy, schemat kryteriów, model i diff pozostały te same.

**Wynik.** Te same trzy uzasadnienia w B2 wskazują konkret: bezpieczeństwo → „Zmiana statycznego
tekstu w komponencie i README.md"; złożoność → „Dwie zamiany stringów + jedno zdanie dopisane
do README.md"; idiomatyczność → „EmptyDeckState.astro nadal używa cn()… kopia UI jest po polsku…
plik pozostaje .astro dla treści statycznej". Wyjście spadło z 2 648 do 1 959 tokenów — opis
żądający konkretu dał uzasadnienia **krótsze**, nie dłuższe.

**Uczciwa cena tej pary**: B2 poszedł na ZIMNY cache (34 719 zapisu / 0 odczytu), bo zmiana
promptu systemowego unieważnia prefiks. Dlatego jego koszt i czas nie są porównywalne z B1 —
porównywalna jest wyłącznie TREŚĆ uzasadnień, i to ona była zmienną tego pomiaru.

### Co z tego wynika — trzy odczyty, nie jeden

**1. Cache działa i to on, a nie długość destylatu, rządzi kosztem.** Przebieg B1 odczytał
z cache 28 832 tokeny — czyli prefiks (prompt systemowy + schemat) był realnie współdzielony,
a nie przeliczany od nowa. Różnica kosztu między A i B1 to w 60% właśnie to. B2 pokazuje drugą
stronę tej samej właściwości: **każda edycja promptu systemowego kasuje cache wszystkim
przebiegom po niej**, więc kalibracja opisów nie jest darmowa w CI i należy do fazy 2, nie do
późniejszych.

**2. Destylat NIE jest dominującym składnikiem wejścia i warto to zapisać, zanim ktoś zacznie
go skracać „dla kosztu".** Zmierzone rozmiary naszych własnych części promptu (znaki / szacunek
tokenów przy 3,2 znaku na token), stan po kalibracji (opis v2):

| Składnik                         | Znaki  | ~Tokeny | Udział w prefiksie 34 719 |
| -------------------------------- | ------ | ------- | ------------------------- |
| `SYSTEM_PROMPT` (destylat)       | 9 077  | ~2 840  | ~8%                       |
| JSON Schema kontraktu            | 12 880 | ~4 025  | ~12%                      |
| Diff fikstury                    | 1 486  | ~465    | ~1%                       |
| **Razem — nasze**                | 23 443 | ~7 330  | **~21%**                  |
| Narzut Claude Agent SDK (reszta) | —      | ~27 390 | **~79%**                  |

Dwa wnioski, które z tego wychodzą, i oba są przeciwintuicyjne:

- **Destylat mieści się w zaplanowanym budżecie 2-4 tys. tokenów a mimo to jest MNIEJSZYM składnikiem
  niż sam schemat.** Opisy kryteriów (`describe`) ważą ~4 tys. tokenów, czyli więcej niż
  cały destylat repo. Skracanie destylatu „dla kosztu" celowałoby więc w mniejszą z dwóch części,
  które kontrolujemy, i płaciłoby za to jakością oceny kryteriów 2, 4 i 9.
- **Cztery piąte wejścia to narzut samego SDK**, na który ta zmiana nie ma wpływu — mimo
  `tools: []`. Gdyby koszt kiedykolwiek stał się problemem, dźwignia jest tam, nie w naszym
  tekście.

**3. Kontrakt dziewięciopolowy przeszedł przez structured output bez naciągania.** Wszystkie
20 pól jest `required` w wygenerowanym schemacie (model nie może pominąć kryterium), oba pola
warunkowe emitują `anyOf: [{"type":"number"},{"type":"null"}]`, a `null` wrócił z modelu
i przeszedł `safeParse` — na dziewięciopolowym schemacie, nie tylko na sondzie z researchu.
Pola niewarunkowe odrzucają `null` (sprawdzone kontrolą negatywną).

### Czego ten pomiar NIE dowodzi

- **Nie dowodzi kosztu w CI.** Runner dokłada `npm ci` (335 MB rozpakowane) i pobranie repo;
  wall clock przebiegu GitHub Actions będzie wielokrotnie wyższy niż 52-64 s samego agenta.
- **Nie dowodzi hit rate'u cache w CI.** Dwa przebiegi tuż po sobie na jednej maszynie to
  najlepszy możliwy przypadek. Przebiegi rozrzucone w czasie mogą trafiać w zimny cache.
- **Nie kalibruje progu.** Próg 5 jest **wartością startową, nie wynikiem pomiaru**. Żeby go
  zrewidować, potrzeba kilkunastu realnych przebiegów na PR-ach z tego repo — w tym na tych,
  które faktycznie wwiozły defekty udokumentowane w `context/archive/` — i odpowiedzi na
  pytanie o poziom fałszywych alarmów. Do tego czasu decyzja „review nie blokuje" stoi.
- **Nie dowodzi, że komplet dziewięciu ocen jest TRAFNY.** Dowodzi, że jest KOMPLETNY
  i rozróżnialny. Trafność mierzy się na realnych PR-ach, nie na fiksturze pisanej pod defekt.

### Obserwacja z przebiegów, która należy do fazy 4/5, nie do tej

We wszystkich trzech przebiegach agent napisał w uzasadnieniu kryterium 9 **„brak deklaracji (tytułu PR)"** —
i zachował się zgodnie z instrukcją z bloku ZAKRES: ocenił spójność wewnętrzną i zapisał, że
deklaracji nie było. To jest zachowanie zaprojektowane, nie awaria. Ale zapisujemy fakt, którego
ono dotyka: **wymagania dają agentowi trzy rzeczy (tytuł, opis, diff), a kontrakt composite
action z fazy 4 wymienia wyłącznie `diff-path`.** Dopóki tytuł i opis nie zostaną przekazane,
kryterium 9 pracuje na węższym wejściu, niż zakładają wymagania. Do rozstrzygnięcia w fazie 4.
