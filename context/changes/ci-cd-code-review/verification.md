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

> **Korekta z 2026-08-22 (faza 6), bez nadpisywania powyższych liczb.** Ten sam prompt, ten sam
> schemat i ta sama fikstura zmierzone NA RUNNERZE dały 10 946 tokenów wejścia zamiast 34 728 —
> czyli narzut SDK ~33%, nie ~79%. Powyższa tabela pozostaje wiernym zapisem tego, co zmierzono
> lokalnie; drugi z dwóch wniosków pod nią **nie przenosi się na CI**. Szczegóły i liczby:
> sekcja fazy 6, punkt 3.

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

---

## Faza 6 — próba czerwieni w CI i pierwszy pomiar na runnerze

Trzy przebiegi `workflow_dispatch` na PR #45, **jeden po drugim** (dzielą klucz `concurrency`,
więc równoległe odpalenie skasowałoby parę dowodową). Wszystkie trzy na tym samym HEAD-zie
`c786027ed33b4742eda651dbb41b204d8a728009` i tej samej bazie `main`. Data: 2026-08-22.

| Pomiar                          | A — fikstura                           | B — realny diff                                          | C — nieistniejący model                           |
| ------------------------------- | -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| Id przebiegu                    | 32562627568                            | 32562732421                                              | 32562910222                                       |
| `use_fixture`                   | `true`                                 | `false`                                                  | `false`                                           |
| `model` (input)                 | pusty                                  | pusty                                                    | `anthropic/claude-sonnet-4.6-nie-istnieje`        |
| Kolor przebiegu                 | zielony                                | zielony                                                  | **czerwony**                                      |
| Wall clock przebiegu            | 1 min 32 s                             | 3 min 15 s                                               | 30 s                                              |
| Wejście                         | `sample.diff`: 1 486 znaków / 47 linii | 141 395 znaków / 2 711 linii po filtrze (5 570 surowych) | jak B                                             |
| Model rozstrzygnięty            | `anthropic/claude-sonnet-4.6`          | `anthropic/claude-sonnet-4.6`                            | — (odrzucony przez providera)                     |
| Tury                            | 2                                      | 2                                                        | —                                                 |
| Czas agenta wg SDK              | 58 766 ms                              | 166 728 ms                                               | ~11 s do błędu                                    |
| Tokeny wejścia (poza cache)     | 9                                      | 9                                                        | —                                                 |
| `cache_creation` / `cache_read` | 10 937 / 0                             | 47 206 / 8 298                                           | —                                                 |
| Tokeny wyjścia                  | 3 201                                  | 8 342                                                    | —                                                 |
| `total_cost_usd`\*              | 0,0934                                 | 0,4426                                                   | 0                                                 |
| `terminal_reason`               | `completed`                            | `completed`                                              | `api_error`                                       |
| Werdykt                         | `fail`                                 | `pass`                                                   | `failed-to-run`                                   |
| Etykieta po przebiegu           | `ai-cr:failed` (zdjęta `ai-cr:passed`) | `ai-cr:passed` (zdjęta `ai-cr:failed`)                   | **żadna nie nałożona ani nie zdjęta**             |
| Komentarz                       | nowy, id 5376117828                    | **ten sam id**, zaktualizowany                           | **ten sam id**, nagłówek awarii nad werdyktem z B |

\* `total_cost_usd` to **przelicznik z cennika Anthropica, nie rachunek OpenRoutera** — ta sama
adnotacja co przy pomiarze z fazy 2 i z tego samego powodu.

### Dlaczego to jest para dowodowa, a nie dwa przebiegi obok siebie

Wartości odczytane z logów obu przebiegów, nie założone:

- **A vs B różnią się dokładnie jedną rzeczą.** Oba: `Reviewing PR #45, head c786027…, base main`,
  `BASE_REF: main`, `REVIEW_MODEL:` (pusty, czyli pin agenta), `MODEL: anthropic/claude-sonnet-4.6`.
  Jedyna różnica w logu: `USE_FIXTURE: true` wobec `USE_FIXTURE: false`.
- **B vs C różnią się dokładnie jedną rzeczą.** Oba `USE_FIXTURE: false`, ten sam HEAD, ten sam
  wynik filtra diffa (`state=code (2711 filtered lines, 5570 raw)` w obu). Jedyna różnica:
  `REVIEW_MODEL: anthropic/claude-sonnet-4.6-nie-istnieje`.

To jest dokładnie to, czego lekcja o bramce zawsze-zielonej wymaga od próby zepsucia: przebieg
czerwony **z kontrolą pozytywną**, różniące się jedną zmienną. Sam czerwony przebieg C nie
dowodziłby, że to bramka go wywołała.

### Co pokazał każdy z trzech

**A — bramka potrafi zaświecić na czerwono.** Werdykt `fail`, siedem kryteriów poniżej progu,
w tym oba, pod które fikstura jest pisana: kryterium 6 (bezpieczeństwo) **1/10** za hardkodowany
service-role JWT i brak sprawdzenia sesji, kryterium 7 (połknięty błąd) **2/10** za zignorowane
pole `error` w `countAll()`. Kryterium 8 (integralność bramki) wróciło jako `null` — „nie
dotyczy", bo fikstura nie rusza żadnego testu ani hooka. Uzasadnienia wskazują plik i konstrukcję
(`i <= ids.length`, `import.meta.env.SUPABASE_URL`), nie parafrazują opisu kryterium.

**B — na realnym diffie tej zmiany werdykt jest inny i rozróżnialny.** `pass`, oceny 7–9,
z dwoma konkretnymi zastrzeżeniami, które warto zapisać, bo agent trafił nimi w rzeczy realne:
(1) `gh pr edit --remove-label` przy nieobecnej etykiecie nie ma jawnej obsługi, jaką ma krok
zdejmujący etykietę-trigger — zachowania nie da się rozstrzygnąć z samego diffa;
(2) `sed "s|${API_KEY}|***|g"` zepsułby się, gdyby klucz zawierał metaznak sedu. Żadne z nich
nie jest halucynacją i oba są sprawdzalne. To jest pierwszy dowód TRAFNOŚCI na realnym kodzie —
słaby, bo jednopunktowy, ale nie zerowy.

**C — stan „review się nie odbyło" renderuje się i nie udaje wyniku.** Przebieg czerwony,
`verdict=failed-to-run`, w logu `Verdict 'failed-to-run' carries no result label — that is the
point of it.` Komentarz (ten sam id) dostał nagłówek **nad** zachowanym werdyktem z B; stopka
pod tabelą nadal wskazuje przebieg 32562732421 i model `anthropic/claude-sonnet-4.6`, więc oba
fakty stoją naraz. Treść przyczyny, dosłownie:

> agent zakończył się kodem 1: Error: Review nie powiodło się (subtype: success, is_error: true,
> terminal_reason: api_error): API Error: 400 anthropic/claude-sonnet-4.6-nie-istnieje is not
> a valid model ID

**To jest dowód naprawy z fazy 1 wykonany w CI, nie lokalnie**: komunikat mówi o modelu
i o providerze (`api_error`), a nie „Niepoprawny structured output". Bez tej naprawy ten sam
przebieg raportowałby diagnozę kontraktu wyjścia — i defektu szukałoby się w schemacie zamiast
w routingu.

**Precyzyjnie o etykietach w C.** Kryterium sukcesu 6.3 brzmi „bez żadnej etykiety wyniku"
i jest spełnione w znaczeniu, w jakim workflow je definiuje: **żadna etykieta nie została
nałożona ani zdjęta**. Etykieta `ai-cr:passed` z przebiegu B została na PR-ze — to jest
zachowanie zaprojektowane i udokumentowane w `pr-review.yml` (na awarii nie zdejmujemy
poprzedniego wyniku, bo komentarz już niesie nagłówek mówiący, że jest nieaktualny). Zapisujemy
to wprost, żeby przyszły czytelnik nie odczytał zielonej etykiety obok czerwonego przebiegu jako
defektu.

### Pomiar — co z niego wynika dla kosztu i progu

**1. Realny diff kosztuje 4,7× tyle co fikstura, a najszybciej rośnie wyjście, nie wejście.**
Wejście B jest ~5× większe niż A (47 206 + 8 298 wobec 10 937), wyjście urosło 2,6× (8 342 wobec
3 201) przy tej samej liczbie tur. Dziewięć uzasadnień pisanych do 2 700 linii diffa jest po
prostu dłuższe. Wniosek na przyszłość: koszt review skaluje się z ROZMIAREM PR-a po obu stronach,
więc typowy PR z tego repo (dziesiątki linii, nie tysiące) będzie bliżej A niż B.

**2. Cache działa MIĘDZY przebiegami na runnerze — zmierzone, nie założone.** B odczytał
8 298 tokenów z cache zapisanego przez A cztery minuty wcześniej, na innym runnerze. To jest
prefiks (prompt systemowy plus schemat kryteriów), czyli dokładnie ta część, która jest wspólna
dla wszystkich przebiegów. Reszta wejścia B (47 206) to jego własny diff — nie ma powodu, żeby ją
współdzielił, i nie współdzieli.

**3. Narzut SDK w CI jest RADYKALNIE mniejszy niż zmierzony lokalnie w fazie 2 — i to unieważnia
tamten wniosek nr 2.** Przebieg A i lokalny B2 miały ten sam prompt systemowy, ten sam schemat
i tę samą fiksturę. Lokalnie wejście wyniosło 34 728 tokenów, w CI **10 946** — 3,2× mniej.
Nasze własne części to ~7 330 tokenów (pomiar z fazy 2), więc narzut samego SDK w CI to
~3 600 tokenów (**~33%** wejścia), a nie ~27 390 (~79%), jak wyszło lokalnie. Zdanie z fazy 2
„cztery piąte wejścia to narzut samego SDK" jest więc **artefaktem środowiska lokalnego
i nie przenosi się na CI** — punktem odniesienia dla przyszłych porównań jest liczba z CI.
Czego NIE ustaliliśmy: co dokładnie dokłada te ~24 tys. tokenów przy uruchomieniu lokalnym.
Ta sama wersja SDK z lockfile'a szła w obu przypadkach, więc różnica jest po stronie środowiska,
nie zależności. Zapisane jako otwarte pytanie, nie jako diagnoza.

**4. Próg 5 nadal jest wartością startową, nie wynikiem pomiaru.** Te trzy przebiegi go nie
kalibrują i nie miały. Dają jeden punkt na każdej skrajności: fikstura pisana pod defekt schodzi
do 1–3, realna zmiana infrastrukturalna trzyma 7–9. Między nimi jest cała przestrzeń, której nie
zmierzyliśmy. Żeby zrewidować próg, potrzeba kilkunastu realnych PR-ów z tego repo — w tym tych,
które faktycznie wwiozły defekty udokumentowane w `context/archive/` — i odpowiedzi na pytanie
o poziom fałszywych alarmów. Do tego czasu decyzja „review nie blokuje merge'a" stoi.

### Punkt odniesienia do porównania z przyszłym przebiegiem

Żeby porównanie po zmianie progu, promptu albo modelu było możliwe, przyszły przebieg trzeba
zestawić z **A**, nie z B: A ma wejście stałe (fikstura leży w gicie), więc jest jedynym z tych
trzech, który się powtarza. Wartości do porównania, wszystkie z linii metryk przebiegu
32562627568:

```
model: anthropic/claude-sonnet-4.6 | tury: 2 | czas: 58766 ms |
koszt (wg cennika Anthropica, nie OpenRoutera): 0.09335774999999999 USD |
tokeny: 9 in (bez cache) | cache: 10937 zapis / 0 odczyt | out: 3201 |
terminal_reason: completed
```

Werdykt do porównania: `fail`, kryteria 6 i 7 na 1 i 2, kryterium 8 równe `null`.
Sposób powtórzenia: `gh workflow run pr-review.yml -f pr_number=<N> -f use_fixture=true`
(dopóki ta zmiana nie jest na `main`, dochodzi `--ref ci-cd-code-review` — `workflow_dispatch`
bierze definicję z gałęzi domyślnej, a tam tego pliku jeszcze nie ma).
**Jedna pułapka przy odczycie**: `cache_read` w powtórzeniu nie będzie zerem, jeśli jakikolwiek
przebieg poszedł w ciągu ostatnich minut — porównywalne między przebiegami są `czas`, `out`
i SUMA wejścia, nie sam rozkład zapis/odczyt.

## Faza 7 — próba zapadki na dryf destylatu

Zapadka pilnuje trzech sekcji, z których wycięty jest destylat w `agents/review/prompt.ts`:
`AGENTS.md` §Hard Rules, `AGENTS.md` §Conventions i `context/foundation/test-plan.md`
§2. Risk Map (razem z podsekcją `### Risk Response Guidance`, bo to w niej stoi kolumna
„What would prove protection", czyli dokładnie ta treść, o którą chodzi kryterium 4).

Rekord: `agents/review/prompt-sources.json`, regenerowany przez
`node --experimental-strip-types scripts/run-prompt-sources.ts --write`.

### Para czerwono/zielono przy jednej zmiennej różnicy

Sama regeneracja rekordu niczego nie dowodzi — rekord zgadza się ze sobą z definicji. Dowodem
jest para przebiegów różniących się **wyłącznie** jedną linią w pilnowanej sekcji.

| Przebieg | Zmiana                                                    | Wynik `tests/lib/review-prompt-sources.test.ts` |
| -------- | --------------------------------------------------------- | ----------------------------------------------- |
| czerwony | `AGENTS.md:7` — `do not use` → `do NOT use` (bez commita) | 1 failed / 12 passed                            |
| zielony  | ta sama linia przywrócona                                 | 13 passed                                       |

Czerwień zaświeciła **tylko** przypadek `still matches AGENTS.md §## Hard Rules`; §Conventions
i §2. Risk Map zostały zielone. To jest osobny fakt od samej czerwieni: dowodzi, że hash jest
zawężony do sekcji, a nie liczony z całego pliku — bez tego zawężenia zapadka na ~6,7 tys.
linii `test-plan.md` czerwieniałaby przy każdej literówce i po tygodniu byłaby regenerowana
bez czytania.

Zmierzone hashe §Hard Rules: `ffffb7e3c103…` (stan zapisany) vs `bf668e60e08f…` (po zepsuciu
jednej linii).

Restytucja potwierdzona przez hash pliku, nie na oko: `sha256(AGENTS.md)` = `bd791f35027de1cc…`
przed zepsuciem, `b2db54db5613ed2f…` po nim i znów `bd791f35027de1cc…` po przywróceniu.

### Sonda na granicę sekcji — czy podsekcja naprawdę wchodzi

Najbardziej ryzykowna decyzja tego ekstraktora to zasięg: `## 2. Risk Map` kończy się dopiero na
następnym nagłówku tego samego lub wyższego poziomu, więc `### Risk Response Guidance` jest
w środku. Gdyby było odwrotnie, zapadka pilnowałaby samej listy ryzyk i przestałaby widzieć
kolumnę „What would prove protection" — czyli dokładnie to, po co ten blok jest w prompcie.
Sprawdzone parą, nie założone:

| Sonda | Zmieniona linia                                           | Wynik                |
| ----- | --------------------------------------------------------- | -------------------- |
| 1     | `test-plan.md:962`, wewnątrz `### Risk Response Guidance` | 1 failed / 12 passed |
| 2     | `test-plan.md:975`, w `## 3. Phased Rollout` (poza)       | 13 passed            |

### Próba na samej kontroli — czy kontrola potrafi zaświecić

Kontrola pozytywna, która nie potrafi zaświecić, jest tą samą klasą co bramka zawsze zielona.
Zmutowany ekstraktor (`return ""` zamiast wycięcia sekcji) daje **7 failed / 6 passed** — padają
wszystkie trzy porównania z rekordem, „gives a different digest when a line INSIDE the section
changes", „keeps the heading line", „owns its sub-sections" i „does not let a comment inside
a fenced block end the section early". Po przywróceniu: 13 passed.

Jeden przypadek pod tą mutacją **został zielony** — „gives the same digest when a line OUTSIDE
the section changes" — i to jest cała odpowiedź na pytanie, po co ta kontrola jest dwustronna:
sama połowa „poza sekcją nic się nie zmienia" przechodzi też dla ekstraktora, który nie czyta
niczego.

### Komunikat czerwieni

Asercja niesie instrukcję, nie tylko dwa ciągi szesnastkowe — i niesie ją w kolejności, która
jest całą treścią komunikatu: przeczytaj sekcję → zaktualizuj `prompt.ts` → **dopiero teraz**
odśwież rekord → zacommituj oba razem. Ostatnie zdanie mówi wprost, że sam krok 3 zieleni test
i nie naprawia niczego. Odwrotna kolejność jest jedynym ruchem, po którym zapadka jest gorsza
niż jej brak: zapisuje zgodę na prompt, którego nikt nie przeczytał.

### Kontrola pozytywna ekstraktora

Test posiada własną fiksturę Markdown i mutuje ją u siebie (lekcja „a positive control must OWN
the fixture it mutates"; `vitest.config.ts` ma stały `sequence: { shuffle: true }`, więc
zależność od kolejności wypłynęłaby jako flake). Kontrola jest **dwustronna** i dopiero para
coś znaczy: zmiana linii **wewnątrz** sekcji zmienia hash, zmiana linii **poza** nią — nie.
Sama pierwsza połowa przeszłaby też dla ekstraktora hashującego cały plik.

Do tego trzy odmowy zamiast cichego `""`: brakujący nagłówek, nagłówek występujący dwa razy
i string, który nagłówkiem nie jest. Pusta sekcja ma doskonale stabilny hash, więc chybienie
zostałoby zapisane raz i już nigdy nie zauważone — zapadka pilnowałaby niczego i raportowała
to jako zgodę.

## Post-review — zapadka miała dowód, ale nie miała ścieżki (F1 z impl-review)

Cała próba zapadki opisana wyżej biegła **lokalnie**, przez `npm test`. Była prawdziwa i nic
z niej nie unieważniamy — ale nie mogła zobaczyć tego, co znalazł impl-review: `npm test`
uruchamia się w repo w **jednym** miejscu, w jobie `ci` z `.github/workflows/ci.yml`, którego
wyzwalacze niosą `paths-ignore: ["**/*.md", "context/**"]`. Wszystkie trzy pilnowane sekcje
leżą w `AGENTS.md` albo `test-plan.md`, więc zmiana wyłącznie dokumentacyjna wypadała spod
bramki. `pre-push` odpala tylko `typecheck`, więc drugiej ścieżki nie było.

To jest dokładnie ta klasa, którą ta zmiana zwalcza — bramka świecąca **przypadkiem**, przy
okazji commitów dotykających też kodu — tyle że popełniona w niej samej. I jest to zarazem
lekcja o dowodzie: weryfikacja 7.4 nie kłamała, tylko mierzyła nie tę ścieżkę, na której
bramka miała żyć.

**Zakres luki, zmierzony a nie założony.** Przy zdarzeniu `pull_request` GitHub liczy
`paths-ignore` względem **całego diffa PR-a**, nie pojedynczego pusha — commit `e0a4e87`
zmieniał wyłącznie `AGENTS.md`, a mimo to `CI` na nim wystartował, bo PR #45 zawiera kod.
Luka dotyczy więc PR-a **w całości** dokumentacyjnego (czyli typowej zmiany reguły wnoszonej
osobnym PR-em) oraz docs-only pusha na `main` — nie każdego docs-only commita.

### Poprawka

`scripts/check-prompt-sources.ts` (runner CI, wzorzec `check-schema-drift.ts`) plus
`.github/workflows/prompt-ratchet.yml` — **osobny plik** workflow, bo `paths-ignore` filtruje
workflow, a nie job, więc żaden job dorzucony do `ci.yml` z pod niego nie ucieka. Runner nie
może iść przez vitesta: `vitest.config.ts` deklaruje
`globalSetup: ["tests/setup/preflight.ts", "tests/setup/accounts.ts"]`, więc każde wywołanie
vitesta przerwałoby się w preflighcie bez lokalnego stacka Supabase. Decyzja ma dalej jeden dom
w `scripts/prompt-sources.ts`; różni się tylko powierzchnia raportowania.

### Para czerwono/zielono — tym razem NA RUNNERZE, nie lokalnie

Trzy przebiegi workflow `Prompt ratchet` na PR #45, każdy różniący się od poprzedniego
dokładnie jedną rzeczą:

| Przebieg    | Commit    | Co się zmieniło                                                 | Wynik         |
| ----------- | --------- | --------------------------------------------------------------- | ------------- |
| 32591341509 | `466a206` | bramka wprowadzona, rekord zgodny z destylatem                  | zielony (8 s) |
| 32591415154 | `e0a4e87` | **wyłącznie** `AGENTS.md` §Conventions, bez regeneracji rekordu | **czerwony**  |
| 32591539397 | `71b98c0` | destylat w `prompt.ts` uzupełniony + `--write` na rekordzie     | zielony       |

Czerwień przebiegu 32591415154 nazwała sekcję i podała instrukcję, dosłownie:

> `##[error]AGENTS.md §## Conventions zmieniło się, a destylat promptu w agents/review/prompt.ts — nie.`

po czym cztery kroki w kolejności „przeczytaj → zaktualizuj destylat → **dopiero teraz** odśwież
rekord → zacommituj oba razem" i zdanie, że sam krok 3 zieleni bramkę i nie naprawia niczego.

**Zawężenie do sekcji potwierdzone po raz drugi, teraz w CI**: między `e0a4e87` a `71b98c0`
hash §Conventions przeszedł z `14fae424be43…` na `1dfbd54d25dc…`, a §Hard Rules
(`ffffb7e3c103…`) i §2. Risk Map (`a58e1962bb67…`) zostały bez zmian. Gdyby hash liczył się
z całego pliku, ruszyłyby wszystkie trzy.

**Czego ta para NIE dowodzi.** Nie dowodzi, że `ci` faktycznie się pomija na PR-ze w całości
dokumentacyjnym — PR #45 zawiera kod, więc `CI` biegł na wszystkich trzech commitach.
Dowodem tamtej połowy byłby osobny PR bez ani jednego pliku kodu; do tego czasu zakres luki
opisany wyżej jest wyprowadzony z zaobserwowanej semantyki `paths-ignore`, nie z próby.
