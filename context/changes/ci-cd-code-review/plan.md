# Workflow CI/CD uruchamiający agenta code review na PR-ach — Implementation Plan

## Overview

Budujemy workflow GitHub Actions, który przy każdym pull requeście do `main` uruchamia
agenta z `agents/review/` (Claude Agent SDK przez OpenRoutera), ocenia zmianę w dziewięciu
kryteriach, wylicza jeden werdykt `pass`/`fail` i zostawia na PR-ze dwa efekty: sticky
komentarz oraz jedną z etykiet `ai-cr:passed` / `ai-cr:failed`. Review jest **doradcze** —
nie blokuje merge'a i nie udaje, że blokuje.

Po drodze zamykamy trzy rzeczy, bez których to nie zadziałałoby albo zadziałałoby fałszywie:
naprawę połkniętego błędu we własnym agencie (awaria łączności przebiera się dziś za błąd
kontraktu), rozbudowę kontraktu wyjścia z pięciu kryteriów do dziewięciu (dwa warunkowe),
oraz dowód — parą przebiegów różniących się dokładnie jedną rzeczą — że ta bramka w ogóle
potrafi zaświecić na czerwono.

## Current State Analysis

**Co już jest i działa.** `agents/review/` to samodzielna paczka npm (pięć plików w gicie,
własny `package-lock.json` kompletny dla wszystkich platform, w tym `claude-agent-sdk-linux-x64`),
z czystym kontraktem runtime: diff wchodzi przez stdin, **stdout to wyłącznie JSON**, stderr
to metryki, pusty diff → `exit 1`, `verdict: "fail"` → `exit 0`. Ten podział mapuje się
na trzy stany z wymagań bez naciągania.

**Czego nie ma.** Repo nie ma ani jednego bloku `permissions:`, a domyślne uprawnienia
`GITHUB_TOKEN` to `read` — bez jawnego bloku komentarz i etykiety dostaną 403. Nie ma
żadnego composite action (`.github/actions/` jest pustym katalogiem), żadnego użycia
`$GITHUB_OUTPUT`, `$GITHUB_STEP_SUMMARY`, `gh` w CI, `fetch-depth`, komentarzy ani etykiet.
Trzech etykiet `ai-cr:*` też nie ma. Żaden z trzech workflow nie ustawia `fetch-depth`,
więc `git diff origin/main...HEAD` na gołym checkoucie **nie zadziała**.

**Granice, których nie wolno zatrzeć.** `agents/**` jest świadomie poza tsconfigiem
(`tsconfig.json:4`, commit `e1ed7e5`), poza ESLintem (`eslint.config.js:126-131`), poza
vitestem i poza `scripts/run-typecheck.ts`. To nie zaniedbanie — to decyzja, której
odwrócenie „przy okazji" byłoby wprost defektem opisanym przez kryterium 9 tego samego
review. Plan trzyma się po zewnętrznej stronie tej granicy: `scripts/` czyta z agenta
**dane** (`criteria.json`), nigdy kodu.

**Fałszywa przesłanka, już poprawiona.** `main` nie ma branch protection ani rulesetów
(`404 Branch not protected`, `rulesets → []`), więc `ci.yml` dziś **niczego nie blokuje**.
Decyzja „review nie blokuje" zostaje — zmienia się jej uzasadnienie: nie „od blokowania są
inne bramki", tylko „dziś nie blokuje nic, a review świadomie tego nie zmienia".

**Defekt w agencie, znaleziony pomiarem.** Przy awarii łączności SDK zwraca
`subtype: "success"` **razem z** `is_error: true` i `structured_output: undefined`.
`review.ts:31` sprawdza wyłącznie `subtype`, więc taki wynik wchodzi do walidacji zodem
i agent raportuje „Niepoprawny structured output" — komunikat o schemacie zamiast o braku
łączności. Przyczyna zostaje połknięta, operator idzie w złą stronę.

## Desired End State

Otwarcie PR-a do `main` (albo push do jego gałęzi, albo nałożenie `ai-cr:review`) uruchamia
przebieg, który w kilka minut zostawia na PR-ze jeden komentarz z tabelą dziewięciu ocen,
jawnie zaznaczonym „nie dotyczy" tam, gdzie ono padło, werdyktem i SHA commita — plus jedną
etykietę wyniku widoczną na liście PR-ów. Kolejne uruchomienia aktualizują ten sam komentarz.

**Weryfikacja końcowa jest parą, nie pojedynczym przebiegiem** (lekcja z `schema-drift-test`):
dwa ręczne `workflow_dispatch` na tym samym PR-ze, różniące się **wyłącznie** źródłem diffa
(`agents/review/sample.diff` vs realny diff), dają rozróżnialne wyniki — pierwszy `ai-cr:failed`
z nazwanymi kryteriami 6 i 7, drugi wynik realny. Trzeci przebieg, z celowo nieistniejącym
id modelu, daje **czerwony przebieg, zero etykiet** i nagłówek awarii doklejony nad zachowanym
poprzednim werdyktem.

### Key Discoveries:

- **Kontrakt runtime agenta jest już właściwy dla trzech stanów** — `agents/review/review.ts:63-68`:
  pusty diff → `exit 1`, wynik (także `fail`) → JSON na stdout + `exit 0`.
- **Wzorzec „czysta funkcja w `scripts/`, test w `tests/lib/`"** jest w repo ustalony i ma
  spisane uzasadnienie: `scripts/schema-drift.ts` ↔ `tests/lib/schema-drift.test.ts:1-5`
  (import przez `../../scripts/…`, bo `@/*` mapuje wyłącznie na `src/*`). To jedyne miejsce
  w repo, gdzie decyzja CI da się przetestować deterministycznie i offline.
- **Wzorzec bramki generuj-i-porównaj** też jest ustalony: `ci.yml` robi `npm run db:types`
  - `git diff --exit-code src/db/database.types.ts`. Ten sam kształt domyka listę kryteriów.
- **Reguła zasięgu sekretów ma jasny dyskryminator** (`eval.yml:74-85`, `schema-diff.yml:30-40`):
  _czy ten job uruchamia `npm ci`?_ Ten uruchamia — i to w katalogu z 335 MB binarki
  z postinstallem, na publicznym repo. Sekret idzie **na krok**, nigdy na job.
- **Redirect, nigdy pipe** (`eval.yml:156-162`): `npm run eval | tee …` kończyło się kodem 0
  na czerwonym przebiegu, bo domyślny shell `run:` to `bash -e {0}` **bez `pipefail`**.
  Jawne `shell: bash` daje `bash --noprofile --norc -eo pipefail {0}` — czyli Z `pipefail`.
  W composite action `shell:` jest **wymagany**, więc tam `pipefail` jest zawsze włączony.
- **Output composite action wymaga trzech rzeczy naraz**: `id:` na kroku, zapisu do
  `$GITHUB_OUTPUT` **oraz** deklaracji `outputs:` w `action.yml`. Sam zapis nie wystawia
  outputu na zewnątrz — to cicha awaria wyglądająca jak pusta zmienna.
- **`z.number().nullable()` przechodzi przez structured output** — zmierzone (research,
  Open Questions 1): schemat emituje `anyOf: [{type:"number"},{type:"null"}]`, model zwrócił
  `null`, `safeParse` dał `success: true`. Zagnieżdżone obiekty **nie** zostały zmierzone
  i dlatego ten plan ich nie używa.
- **Routing przez OpenRoutera jest udowodniony kontrolką negatywną**: zepsuty `ANTHROPIC_BASE_URL`
  → 10 × `api_retry` i `ENOTFOUND`, czyli SDK realnie bije pod adres z tej zmiennej.
  `modelUsage[].provider` **nie jest** dowodem routingu (podało `"firstParty"` przez OpenRoutera),
  a `costUSD` to przelicznik z cennika Anthropica, nie rachunek OpenRoutera.

## What We're NOT Doing

- **Nie oceniamy dopasowania biznesowego ani architektonicznego.** Obu nie da się ocenić
  z samego diffa; wracamy do tego, gdy agent dostanie kontrolowany dostęp do dokumentów.
- **Nie włączamy branch protection, required checks ani żadnej formy blokowania merge'a.**
  Review nie wchodzi na listę wymaganych sprawdzeń i nie dostaje `needs:` od niczego.
- **Nie kupujemy `ANTHROPIC_API_KEY`** — jedziemy przez OpenRoutera na istniejącym sekrecie
  `OPENROUTER_EVAL_KEY`.
- **Nie używamy `pull_request_target`** — to wzorzec „pwn request": checkout kodu forka
  plus `npm ci` z postinstallem oznacza wykradziony sekret i token zapisu.
- **Nie recenzujemy PR-ów z forków** — pominięcie bez sygnału dla autora, świadomie: token
  forka jest z definicji GitHuba read-only, więc komentarz wróciłby 403, a `skipped` na liście
  checków to jedyna powierzchnia, jaką mamy. Nie budujemy pod ten hipotetyczny dziś przypadek
  osobnego kroku ani nowego mechanizmu (`$GITHUB_STEP_SUMMARY` nie występuje jeszcze w tym repo).
- **Nie wciągamy `agents/**` do tsconfigu, ESLinta ani vitesta\*\*, żeby „mieć typecheck".
- **Nie kalibrujemy progu.** Próg 5 zostaje jako wartość startowa; jego weryfikacja wymaga
  kilkunastu realnych przebiegów i jest osobną decyzją.
- **Nie optymalizujemy cache'u promptu.** Metryki cache agent już wypisuje na stderr —
  najpierw je zmierzymy, potem ewentualnie coś z nimi zrobimy.
- **Nie dokładamy `paths-ignore`** wzorem `ci.yml` — patrz „czwarty stan" w fazie 5.

## Implementation Approach

Sześć faz idących od środka na zewnątrz: najpierw agent (runtime, potem kontrakt oceny),
potem czysta funkcja werdyktu z testami, potem opakowanie w composite action, potem workflow,
na końcu dowód czerwieni. Kolejność nie jest kosmetyczna — **faza 3 jest jedyną częścią
całego przedsięwzięcia, którą da się sprawdzić deterministycznie, offline i bez grosza kosztu**,
więc ląduje przed całą mechaniką GitHuba, a nie po niej.

Podział między composite action a plikiem workflow rozstrzyga kryterium **czytelnicze**
z wymagań: w akcji ląduje wszystko, co jest „jak uruchomić agenta" (instalacja 335 MB,
przekazanie sekretu, bramka dryfu listy kryteriów, redirect zamiast pipe, obsługa kodu
wyjścia, wystawienie outputów); w głównym pliku zostaje pięć czytelnych kroków: pobierz →
zbierz wejście → uruchom review → rozstrzygnij → opublikuj.

## Critical Implementation Details

**Prettier zje generowany JSON, jeśli generator nie zje go pierwszy.** `lint-staged` uruchamia
`prettier --write` na każdym stagowanym `*.json` (hook `pre-commit` żyje i działa), a
`agents/**` **nie jest** w `.prettierignore`. Generator `criteria.json` (a w fazie 7 także `prompt-sources.json`)
musi więc emitować dokładnie to, co wypluje prettier: wcięcie 2 spacje, `\n` na końcu pliku.
Inaczej pierwszy commit przeformatuje plik, a bramka `git diff --exit-code` w composite action
będzie **czerwona na zawsze** — i to czerwień myląca, bo o formatowaniu, nie o dryfie kontraktu.

**Kolejność zdejmowania etykiety-triggera.** `ai-cr:review` trzeba zdjąć **na początku**
przebiegu, nie na końcu: etykieta jest wyzwalaczem, nie stanem, a zdjęcie jej dopiero po
review uniemożliwia ponowne nałożenie w trakcie i myli ją z wynikiem. REST
`DELETE …/labels/{name}` zwraca **404, gdy etykiety nie ma** — to błąd, nie no-op, i trzeba
go połknąć jawnie, z komentarzem, że to jedyne miejsce w tej zmianie, gdzie połknięcie jest
decyzją, a nie przeoczeniem.

**Płytki fetch bazy psuje merge-base.** `fetch-depth: 0` jest wymagane; `git fetch --depth=1`
bazy zostawia repozytorium bez wspólnego przodka, a `git diff --merge-base` wtedy albo pada,
albo — gorzej — zwraca diff absurdalnie szeroki. Przy zdarzeniu `pull_request` checkout bierze
`refs/pull/<N>/merge` w detached HEAD.

**Lokalne uruchomienie agenta nie koliduje z `npm test`.** Agent czyta `ANTHROPIC_AUTH_TOKEN`,
nie `OPENROUTER_API_KEY` — a to właśnie ta druga zmienna przerywa preflight suity testowej.
Klucz podajemy więc na jedno wywołanie, nie eksportujemy go na stałe.

---

## Phase 1: Agent runtime — routing, pin modelu, naprawa połkniętego błędu

### Overview

Agent zaczyna jeździć przez OpenRoutera po jawnie przypiętym modelu i przestaje przebierać
awarię łączności za błąd kontraktu. Kontrakt wyjścia (pięć kryteriów) **nie zmienia się
w tej fazie** — dzięki temu, gdy pierwsze uruchomienie wyjdzie dziwnie, przyczyna jest jedna.

### Changes Required:

#### 1. Routing przez OpenRoutera

**File**: `agents/review/review.ts`

**Intent**: Ustawić trzy zmienne środowiskowe **przed** wywołaniem `query(...)`, żeby SDK
biło pod OpenRoutera zamiast pod pierwszostronne API Anthropica. Trzecia z nich nie jest
kosmetyką i wymaga komentarza w kodzie: niepusty `ANTHROPIC_API_KEY` **wygrywa** z
`ANTHROPIC_AUTH_TOKEN`, więc zostawiony w środowisku wysyła wywołanie w złe miejsce ze złym
kluczem — awaria, która wygląda jak problem z uprawnieniami.

**Contract**: `ANTHROPIC_BASE_URL = "https://openrouter.ai/api"`,
`ANTHROPIC_AUTH_TOKEN = <klucz OpenRoutera ze środowiska>`, `ANTHROPIC_API_KEY = ""`
(pusty, obowiązkowo). Ustawienie następuje na module scope, przed pierwszym `query(...)`.

#### 2. Bramka fail-fast na brak klucza

**File**: `agents/review/review.ts`

**Intent**: Brak klucza ma padać z komunikatem mówiącym, czego brakuje i skąd to wziąć —
zanim agent przeczyta stdin i zanim SDK zacznie retry'ować. Umiejscowienie jest całą wartością
tej bramki, dokładnie jak w `eval.yml:109-118`.

**Contract**: pusty lub nieustawiony klucz → komunikat na stderr + `process.exit(1)`. Nazwa
zmiennej wejściowej po stronie agenta to `ANTHROPIC_AUTH_TOKEN`, nigdy `OPENROUTER_API_KEY` —
ta druga przerywa preflight `npm test` (patrz Critical Implementation Details).

#### 3. Pin modelu

**File**: `agents/review/review.ts`

**Intent**: Zastąpić alias `"sonnet"` (`review.ts:21`) jawnym identyfikatorem OpenRoutera.
Alias nie jest identyfikatorem OpenRoutera i po prostu nie zadziała — ale decyzja o pinie jest
**samodzielna, nie uboczna**: warunek wyjścia z wymagań stoi na porównaniu przebiegów sprzed
i po zmianie progu, a model podmieniony pod aliasem po stronie dostawcy unieważnia to
porównanie po cichu. Komentarz w kodzie ma mówić właśnie to, a nie „bo OpenRouter tak ma".

**Contract**: nazwana stała `REVIEW_MODEL = "anthropic/claude-sonnet-4.6"`, nadpisywalna
zmienną środowiskową `REVIEW_MODEL`. Seam nadpisania istnieje **wyłącznie** dla ręcznego
`workflow_dispatch` (faza 5); żaden automatyczny wyzwalacz go nie ustawia. Rozstrzygnięty
model ląduje w linii metryk na stderr, więc każdy przebieg zapisuje, co go wyprodukowało —
to jest to, co odbiera nadpisaniu możliwość cichej zmiany zachowania.

#### 4. Naprawa rozpoznania sukcesu

**File**: `agents/review/review.ts`

**Intent**: Warunek na `message.subtype === "success"` (`review.ts:31`) jest fałszywym oraklem:
przy awarii łączności SDK zwraca `subtype: "success"` razem z `is_error: true`,
`terminal_reason: "api_error"` i `structured_output: undefined`. Sukces musi być rozstrzygany
na `is_error`/`terminal_reason`, a komunikat awarii ma nieść `result` z SDK — czyli realną
przyczynę, nie diagnozę kontraktu wyjścia.

**Contract**: sukces = `subtype === "success"` **i** `is_error !== true`. Każda inna
kombinacja rzuca błąd zawierający `terminal_reason` i `result`. Walidacja zodem zostaje
nietknięta i wykonuje się dopiero po przejściu tego warunku.

#### 5. Metryki

**File**: `agents/review/review.ts`

**Intent**: Do istniejącej linii metryk (`review.ts:39-49`) dołożyć rozstrzygnięty model
i `terminal_reason`. Przy pozycji `koszt` dopisać, że `total_cost_usd` to przelicznik
z cennika Anthropica, a nie rachunek OpenRoutera — bez tego pierwszy odczyt tej liczby
w CI zostanie wzięty za fakturę.

**Contract**: stderr pozostaje jedynym sinkiem metryk; stdout dalej wyłącznie JSON.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` przechodzi — a to sprawdza też, że nic nie wciągnęło agenta do programu `tsc`
- `npm run lint` przechodzi
- Uruchomienie na fiksturze zwraca JSON na stdout i kod 0: `Get-Content agents/review/sample.diff | npx tsx agents/review/review.ts`
- Bramka klucza: uruchomienie bez `ANTHROPIC_AUTH_TOKEN` kończy się kodem 1 i komunikatem o kluczu, **zanim** padnie jakiekolwiek wywołanie sieciowe

#### Manual Verification:

- Kontrolka negatywna routingu: z celowo zepsutym `ANTHROPIC_BASE_URL` przebieg kończy się komunikatem o **łączności** (`ENOTFOUND` / `api_error`), a **nie** o niepoprawnym structured output — to jest jedyny dowód naprawy z punktu 4
- Linia metryk na stderr zawiera rozstrzygnięty identyfikator modelu
- Zapisany JSON parsuje się `jq`-iem bez żadnego czyszczenia — stdout nie został zabrudzony

**Implementation Note**: Po tej fazie zatrzymaj się i potwierdź ręcznie kontrolkę negatywną — to jedyny moment, w którym naprawa defektu jest tania do udowodnienia.

---

## Phase 2: Kontrakt oceny — dziewięć kryteriów, destylat, `criteria.json`

### Overview

Kontrakt wyjścia rośnie z pięciu kryteriów do dziewięciu (dwa warunkowe), prompt systemowy
rośnie z pięciu linii do destylatu rzędu 2-4 tys. tokenów, a lista kryteriów przestaje istnieć
w dwóch miejscach: powstaje jedna tablica, z której **wyprowadzany jest schemat zoda**
i **generowany plik `criteria.json`** czytany później przez `scripts/`.

### Changes Required:

#### 1. Jedna lista kryteriów jako źródło schematu

**File**: `agents/review/review-schema.ts`

**Intent**: Zamiast dziewięciu ręcznie wypisanych pól zoda — jedna tablica `CRITERIA`, po
której schemat jest budowany mechanicznie. To eliminuje rozjazd między schematem a listą
przez konstrukcję, a nie przez czujność.

**Contract**: `CRITERIA: ReadonlyArray<{ key, noteKey, label, conditional, describe }>`,
dziewięć wpisów w kolejności z wymagań: `implementationCorrectness` (1), `idiomaticity` (2),
`complexity` (3), `testRiskCoverage` (4), `documentationRationale` (5), `securitySafety` (6),
`swallowedError` (7, `conditional: true`), `gateIntegrity` (8, `conditional: true`),
`scopeDiscipline` (9). `REVIEW_SCHEMA` powstaje z redukcji po tej tablicy: pole `key` to
`z.number()` (dla warunkowych `z.number().nullable()`, gdzie `null` znaczy „nie dotyczy"),
pole `noteKey` to `z.string()`. Do tego niezmienione `verdict` i `summary`.

**Uwaga o kształcie**: kryteria zostają **płaskie** (osobne pole oceny, osobne pole
uzasadnienia), a nie zagnieżdżone w obiekt `{ score, note }`. Powód jest pomiarowy:
`z.number().nullable()` zostało przez structured output **zmierzone**, zagnieżdżony obiekt
nie — a to jest dokładnie ta klasa twierdzenia, którą to repo każe mierzyć, nie zakładać.
Tablica obiektów zamiast nazwanych pól odpada z innego powodu: pozwoliłaby modelowi pominąć
kryterium, a wtedy brak wpisu byłby nieodróżnialny od oceny, o której zapomniał — wymagania
zakazują tego wprost.

#### 2. Opisy kryteriów — 1 i 10 wprost

**File**: `agents/review/review-schema.ts`

**Intent**: Każdy `describe` musi jawnie mówić, co znaczy 1, a co 10, na tyle konkretnie,
żeby dwie osoby oceniły ten sam diff podobnie. To nie kosmetyka: schemat **nie egzekwuje**
zakresu 1-10 (structured output odrzuca `minimum`/`maximum` na typie całkowitym — komentarz
`review-schema.ts:15-19`), więc opis pola jest jedyną realną dźwignią sterowania modelem.
Treść bierzemy wprost z `requirements.md` §„Kryteria oceny", bez rozwadniania.

**Contract**: dziewięć opisów; dla kryteriów 7 i 8 opis dodatkowo mówi, **kiedy zwrócić `null`**
(„nie dotyczy") i że `null` to nie jest ocena — z uzasadnieniem arytmetycznym z wymagań
(dziesiątka za brak ryzyka zawyżałaby wynik, jedynka karałaby za nieistniejące). Opisy pól
uzasadnienia: jedno-dwa zdania; dla „nie dotyczy" — dlaczego kryterium nie ma zastosowania.
**Próg nie pojawia się w żadnym opisie ani nigdzie w prompcie** — to wymaganie wprost, bo próg
wpleciony w prompt zmienia wejście modelu przy każdej zmianie czułości i unieważnia
porównanie przebiegów, na którym stoi warunek wyjścia.

#### 3. Destylat kontekstu repo

**File**: `agents/review/prompt.ts` (nowy)

**Intent**: Agent nie ma narzędzi ani dostępu do plików, więc kryteria 2, 4 i 9 oceniają
w ciemno, dopóki nie dostaną kontekstu tekstem. Destylat wydzielamy z `review-schema.ts`,
żeby ten plik pozostał o schemacie.

**Contract**: `SYSTEM_PROMPT` składany z nazwanych bloków, każdy z komentarzem wskazującym
źródło i defekt, który go uzasadnia:

- `REPO_RULES` — twarde reguły z `AGENTS.md` §Hard Rules i §Conventions: importy `@/*`,
  `astro:env/server` z dwoma udokumentowanymi wyjątkami (`scripts/`, `src/worker.ts`), `cn()`
  zamiast sklejania klas, brak dyrektyw Next.js, wspólny token `--ring`, polska kopia UI
  przy angielskich identyfikatorach.
- `RISK_MAP` — siedem ryzyk z `test-plan.md` §2 **wraz z kolumną „What would prove protection"**;
  to ta kolumna, nie sama lista ryzyk, jest tym, czego potrzebuje kryterium 4. Kolumna
  „Anti-pattern to avoid" jest gotowym materiałem na opis oceny 1.
- `SWALLOWED_SIGNATURE` — sygnatura wykrywalna z samego diffa dla kryterium 7:
  **niekonsekwencja wewnątrz jednego pliku** („każdy inny `await` w tym pliku najpierw
  rozgałęzia się na `error` — i to jest to, co sprawia, że te pięć się wyróżnia"), plus
  **obie granice**: `if (error)` bywa poprawne i bywa błędne (C10X-51 vs C10X-52, gdzie ta sama
  poprawka zbanerowałaby każdego anonimowego gościa), a bez jawnego `.select()` zero
  dopasowanych wierszy jest nieodróżnialne od udanego zapisu. Stąd instrukcja: zgłoś
  **podejrzenie z nazwaniem brakującego dowodu**, a nie werdykt, którego nie ma z czego wyprowadzić.
- `SCOPE_CALIBRATION` — kryterium 9: rozszerzenie **wynikające ze zmiany** (bugfix w komponencie
  wywołany przez nowe pola slice'a) nie jest naruszeniem zakresu; naruszeniem jest **nieujawniony
  nowy zakres** — oportunistyczny restyle współdzielonego prymitywu, „przy okazji" refaktor
  sąsiedniego modułu. Skala 1-10 ma to unieść, a nie karać każdą linię spoza tytułu.

Długość docelowa: 2-4 tys. tokenów. Powyżej tego dziewięć kryteriów zaczyna się rozcieńczać.

#### 4. Generator listy kryteriów

**Files**: `agents/review/generate-criteria.ts` (nowy), `agents/review/criteria.json` (nowy, generowany), `agents/review/package.json`

**Intent**: `scripts/` potrzebuje etykiet i informacji o warunkowości, żeby wyrenderować
komentarz — ale nie może importować kodu agenta bez zatarcia granicy `agents/` i bez odebrania
agentowi przenośności, która jest powodem, dla którego budujemy własnego agenta zamiast brać
gotową akcję. Rozwiązaniem jest wzorzec, który repo już stosuje przy `database.types.ts`:
agent **generuje** listę do zacommitowanego pliku, `scripts/` czyta **dane**, a bramka
regeneruje i porównuje. Druga lista po stronie `scripts/` **w ogóle nie powstaje** — nie ma
więc czemu dryfować, a jedyna para (tablica `CRITERIA` → `criteria.json`) jest domknięta
mechanicznie, bez parsowania źródła regexem.

**Contract**: skrypt npm `criteria` w `agents/review/package.json`; wyjście to
`[{ key, noteKey, label, conditional }]` w kolejności tablicy `CRITERIA`; formatowanie jak
w punkcie 4. Bramka `git diff --exit-code agents/review/criteria.json` siedzi w composite
action (faza 4), bo tam zależności agenta są już zainstalowane — dorzucanie `npm ci`
w `agents/review` (335 MB rozpakowane) do `ci.yml` kosztowałoby każdy przebieg CI.

### Success Criteria:

#### Automated Verification:

- `npm --prefix agents/review run criteria` generuje `criteria.json`, a ponowne uruchomienie nie zmienia pliku: `git diff --exit-code agents/review/criteria.json`
- `npx prettier --check agents/review/criteria.json` przechodzi — czyli generator i `pre-commit` nie będą się przepychać
- `npm run typecheck` i `npm run lint` przechodzą

#### Manual Verification:

- Uruchomienie na `agents/review/sample.diff` zwraca komplet dziewięciu ocen, a kryteria 6 i 7 są nisko — fikstura ma zahardkodowany service-role key oraz `if (!error) { deleted++ }`
- Uruchomienie na diffie bez ścieżek zapisu zwraca `null` w kryterium 7 — czyli „nie dotyczy" faktycznie przechodzi przez structured output na dziewięciopolowym schemacie, a nie tylko na sondzie
- Uzasadnienia wskazują plik albo nazwany brakujący dowód, zamiast parafrazować opis kryterium
- Liczba tokenów wejścia z linii metryk zapisana jako punkt odniesienia dla fazy 6

**Implementation Note**: Zatrzymaj się tu na potwierdzenie ręczne. To jedyna faza, w której kalibracja opisów kryteriów jest tania — po niej każda poprawka opisu wymaga przebiegu CI, żeby zobaczyć skutek.

---

## Phase 3: Werdykt i komentarz — czysta funkcja w `scripts/` plus testy

### Overview

Reguła werdyktu z wymagań jest **czystą funkcją**: bierze obiekt wyniku, listę kryteriów
i próg, zwraca `pass`/`fail` wraz z listą kryteriów, które spadły poniżej progu. Razem
z rendererem komentarza to jedyny element całego przedsięwzięcia, który da się przetestować
deterministycznie i offline — bez klucza, bez sieci, bez GitHuba. Dlatego powstaje **przed**
mechaniką CI, a nie po niej.

### Changes Required:

#### 1. Czysta funkcja werdyktu

**File**: `scripts/review-verdict.ts` (nowy)

**Intent**: Wyliczyć jeden werdykt dla całej zmiany według reguły z wymagań, z progiem jako
jawnie nazwaną liczbą w jednym miejscu — nigdy w prompcie. Dwa źródła `fail` są **alternatywą,
nie koniunkcją**: agent może dostrzec problem, którego nie wcisnął w żadne kryterium, i odwrotnie
— może wystawić jedynkę i mimo to podsumować całość łagodnie. Średniej **nie liczymy**, i to
jest decyzja, nie przeoczenie: średnia chowa jeden katastrofalny wymiar wśród ośmiu dobrych,
a tym jednym wymiarem będzie w praktyce bezpieczeństwo albo połknięty błąd — czyli dokładnie
to, po co ten agent istnieje.

**Contract**: `SCORE_THRESHOLD = 5` jako nazwany eksport (jedyne miejsce, gdzie ta liczba
występuje w całym repo). `decideVerdict({ review, criteria, threshold })` zwraca
`{ verdict: "pass" | "fail", failing: Array<{ key, label, score, note }>, skipped: Array<{ key, label, note }> }`.
Kryteria z `null` trafiają do `skipped` i **nie mogą** wpływać na werdykt w żadną stronę.
Brak kryterium wymienionego w `criteria.json` w obiekcie wyniku to **błąd**, nie ciche
pominięcie — inaczej „agent zapomniał ocenić" byłoby nieodróżnialne od „nie dotyczy".

#### 2. Renderer komentarza

**File**: `scripts/review-comment.ts` (nowy)

**Intent**: Wyprodukować treść komentarza, którą da się przeczytać w kilkanaście sekund i która
sama z siebie mówi, **które** kryterium zeszło poniżej progu i dlaczego. To wymaganie jest
ostrzejsze, niż wygląda: skoro przebieg zawsze kończy się sukcesem, cały ciężar sygnału
spoczywa na komentarzu i etykiecie. Komentarz, który trzeba rozwijać, żeby zobaczyć powód
`fail`, jest równie niemy co nieprzeczytany przebieg — więc powody `fail` idą **nad** tabelą,
nie w niej.

**Contract**: `renderComment({ verdict, failing, skipped, scores, summary, sha, model, runUrl })`
zwraca markdown zaczynający się od markera `<!-- ai-code-review v1 -->` (marker niesie też
wersję kontraktu komentarza). Zawiera: werdykt, SHA commita, na którym powstał, model,
listę kryteriów poniżej progu z uzasadnieniami, tabelę dziewięciu kryteriów z jawnym
**„nie dotyczy"** tam, gdzie padło `null`, podsumowanie agenta i link do przebiegu.
`renderFailureHeader(previousBody, { reason, runUrl })` dokleja nad zachowaną poprzednią
treścią blok o awarii i jest **idempotentny** — dwa kolejne wywołania nie dają dwóch nagłówków.

**Trzeci wariant treści: `renderNoCodeComment({ sha, runUrl })`.** Czwarty stan z fazy 5
(„filtrowany diff pusty, niefiltrowany niepusty") też potrzebuje komentarza, a `renderComment`
się do tego nie nadaje: bierze `verdict`, `failing`, `skipped`, `scores` i `summary`, z których
w tym stanie nie istnieje **ani jedno** — agent w ogóle się nie uruchomił. Kluczowe jest to,
czego łatwo nie dopisać: ta treść musi zaczynać się **tym samym markerem**
`<!-- ai-code-review v1 -->`. Bez markera wyszukiwanie z fazy 5 punkt 6 jej nie znajdzie
i kolejny przebieg doklei DRUGI komentarz — a SC „liczba komentarzy bota pozostaje 1" tego nie
złapie, bo mierzy PR-a z kodem, czyli ścieżkę, po której ten stan nie chodzi. Marker jest więc
własnością tego modułu, w trzech wariantach naraz, a nie stringiem powtórzonym w YAML-u.

#### 3. CLI dla workflow — **osobny plik-runner**

**File**: `scripts/run-review-verdict.ts` (nowy)

**Intent**: Workflow ma wywołać jedną komendę i dostać dwie rzeczy: werdykt do sterowania
etykietami i plik z treścią komentarza. Treść przez plik, nie przez argument ani output —
komentarz zawiera markdown wieloliniowy i dowolny tekst od modelu.

**Runner mieszka w OSOBNYM pliku, i to nie jest kwestia gustu.** `scripts/` ma na to jedyny
i czterokrotnie powtórzony wzorzec: `schema-drift.ts` ↔ `check-schema-drift.ts`,
`typecheck.ts` ↔ `run-typecheck.ts`, `db-cleanup.ts` ↔ `run-db-cleanup.ts`,
`kong-keepalive.ts` ↔ `disable-kong-keepalive.ts`. Czysta połowa nie ma **żadnego** efektu na
module scope; argv, `console.*` i `process.exitCode` należą wyłącznie do runnera. Powód jest
tu ostrzejszy niż konwencja: punkt 4 każe testowi importować czystą połowę przez
`../../scripts/…`, a `vitest.config.ts:50` ma **stały `sequence: { shuffle: true }`** — kod CLI
w importowanym module wykonałby się na argv vitesta w losowym miejscu suity, czyli byłby
awarią, którą najpierw zobaczy się jako flake.

**Contract**: `node --experimental-strip-types scripts/run-review-verdict.ts --result <json> --out <md> [--previous <md>] [--failure <reason>]`.
Importuje `decideVerdict`/`SCORE_THRESHOLD` z `./review-verdict.ts` i renderery z
`./review-comment.ts` (import względny, z rozszerzeniem — `@/*` mapuje wyłącznie na `src/*`).
Wypisuje na stdout jedną linię `verdict=pass|fail|failed-to-run` do przekierowania
do `$GITHUB_OUTPUT`; zapisuje treść komentarza do `--out`. Kończy się kodem 0 także przy
werdykcie `fail` — decyzja o czerwieni przebiegu należy do workflow, nie tutaj.

#### 4. Testy funkcji werdyktu

**File**: `tests/lib/review-verdict.test.ts` (nowy)

**Intent**: Pokryć decyzję, której koszt pomyłki jest asymetryczny w obie strony, i zrobić to
tak, żeby test potrafił zaświecić na czerwono. Import przez `../../scripts/…` z komentarzem
wyjaśniającym dlaczego — `@/*` mapuje wyłącznie na `src/*`, wzorzec z `tests/lib/schema-drift.test.ts:1-5`.

**Contract**: przypadki — granica dokładnie na progu (5 przechodzi, 4 nie); `null` nie wywołuje
`fail` i nie wchodzi do agregacji; `verdict: "fail"` od agenta przy wszystkich ocenach powyżej
progu **nadal** daje `fail` (alternatywa, nie koniunkcja); `verdict: "pass"` od agenta z jedną
jedynką daje `fail`; brakujące kryterium rzuca. **Kontrola pozytywna**: fikstura, na której
funkcja musi zwrócić `pass` — bez niej implementacja „zawsze `fail`" przeszłaby cały zestaw.
Fikstury są własnością tego pliku, nie współdzielone (lekcja „a positive control must OWN
the fixture it mutates").

#### 5. Testy renderera i kontraktu listy kryteriów

**Files**: `tests/lib/review-comment.test.ts` (nowy), `tests/lib/review-criteria.test.ts` (nowy)

**Intent**: Komentarz musi jawnie pokazywać pominięte kryterium (brak wpisu byłby
nieodróżnialny od oceny, o której agent zapomniał), a lista kryteriów musi mieć uzgodniony
kształt, zanim cokolwiek na niej stanie.

**Contract**: renderer — „nie dotyczy" obecne dosłownie dla kryterium z `null`; kryteria
poniżej progu wymienione **przed** tabelą; SHA i model obecne; nagłówek awarii idempotentny
i zachowujący poprzedni werdykt; **wszystkie trzy warianty treści** (`renderComment`,
`renderNoCodeComment`, wynik `renderFailureHeader`) zaczynają się tym samym markerem — to
jedyna asercja, która broni stickiness na ścieżce czwartego stanu. Lista — `criteria.json` ma dokładnie dziewięć wpisów,
klucze zgadzają się z listą oczekiwaną wypisaną w teście, dokładnie dwa mają `conditional: true`
i są to kryteria 7 oraz 8.

### Success Criteria:

#### Automated Verification:

- `npm test` przechodzi (wymaga lokalnego stacka: `npm run db:start`)
- `npm run typecheck` i `npm run lint` przechodzą
- CLI działa na przykładowym wyniku: `node --experimental-strip-types scripts/run-review-verdict.ts --result <json> --out <md>` zapisuje plik i wypisuje jedną linię `verdict=…`

#### Manual Verification:

- Podmiana `SCORE_THRESHOLD` na 8 zmienia werdykt na fiksturze granicznej — czyli próg naprawdę steruje, a nie jest dekoracją
- Wyrenderowany komentarz przeczytany „na oko" mówi w pierwszych trzech linijkach, czy jest `fail` i przez które kryterium

**Implementation Note**: Zatrzymaj się i potwierdź ręcznie — to ostatni punkt, w którym cokolwiek da się sprawdzić bez wydawania pieniędzy i bez GitHuba.

---

## Phase 4: Composite action — pierwszy taki byt w tym repo

### Overview

Wszystko, co jest „jak uruchomić agenta", chowa się za jedną nazwaną czynnością. Kryterium
sukcesu tego podziału jest **czytelnicze**: osoba widząca workflow pierwszy raz ma po
przeczytaniu głównego pliku wiedzieć, co się dzieje i w jakiej kolejności, bez wchodzenia
do środka akcji.

### Changes Required:

#### 1. Definicja akcji

**File**: `.github/actions/review-agent/action.yml` (nowy)

**Intent**: Opakować instalację zależności agenta, bramkę dryfu listy kryteriów, uruchomienie
agenta i obsługę kodu wyjścia. Sekret wchodzi jako `input`, bo **kontekst `secrets` jest
w composite action niedostępny** — i w środku trafia do `env:` kroku, nigdy do interpolacji
w treści `run:`.

**Contract**: `inputs`: `api-key` (required), `model` (optional), `diff-path` (required),
`result-path` (optional, domyślnie w `$RUNNER_TEMP`). `outputs`: `status` (kod wyjścia agenta),
`result-path`, `stderr-path`, `model` — każdy zadeklarowany w `outputs:` **i** zapisany do
`$GITHUB_OUTPUT` przez krok z `id:`; wszystkie trzy rzeczy naraz, bo sam zapis do
`$GITHUB_OUTPUT` nie wystawia outputu na zewnątrz akcji.

**Dlaczego `model` jest OUTPUTEM, a nie polem w JSON-ie wyniku.** Komentarz z fazy 3 wymaga
rozstrzygniętego identyfikatora modelu (`renderComment({ …, model })`), a JSON wyniku produkuje
**LLM** — model nie ma prawa raportować własnej tożsamości, bo mógłby ją zmyślić i nikt by tego
nie sprawdził. Wartość zna harness, bo sam ją podał (`inputs.model` albo domyślne
`REVIEW_MODEL`), więc to harness ją wystawia. To ten sam rozdział ról, co w lekcji
„wartość kontraktowa nigdy nie trafia do promptu LLM" (`lessons.md:215-221`), tylko czytany
z drugiej strony: wartość kontraktowa nie wraca też **z** promptu. Każdy krok `run` ma jawne
`shell: bash` (wymagane w composite — i przy okazji włącza `pipefail`).

#### 2. Kroki akcji

**File**: `.github/actions/review-agent/action.yml`

**Intent**: Kolejność jest uzasadniona kosztem awarii, nie estetyką: bramka na pusty klucz
pada w sekundach zamiast po ~60 s `npm ci` (uzasadnienie z `eval.yml:109-118` — cała wartość
tej bramki to umiejscowienie), a bramka dryfu kryteriów siedzi tuż po instalacji, bo stara
`criteria.json` oznacza komentarz z błędnymi etykietami.

**Contract**: kolejno — (1) fail-fast na pusty `api-key`; (2) `actions/setup-node@v6` z
`node-version: 22`, `cache: npm`, `cache-dependency-path: agents/review/package-lock.json`;
(3) `npm ci` w `agents/review`; (4) regeneracja `criteria.json` + `git diff --exit-code`;
(5) uruchomienie agenta z `timeout-minutes` na kroku (nie na jobie — job-level timeout
zostawia nieudokumentowanym, czy kroki `if: always()` jeszcze się wykonają).

#### 3. Uruchomienie agenta i przechwycenie wyniku

**File**: `.github/actions/review-agent/action.yml`

**Intent**: Przechwycić stdout do pliku wyniku, stderr do pliku logu i **kod wyjścia do
outputu**, nie do statusu kroku. Krok kończy się `exit 0` zawsze — rozróżnienie stanów należy
do workflow. `continue-on-error` **nie nadaje się** do tego zadania: skleiłby „agent mówi fail"
z „agent się wysypał" w jedno `outcome: failure`.

**Contract**: przekierowania, nigdy pipe (`> result.json 2> stderr.log || STATUS=$?`) —
`npm … | tee …` zostało w tym repo **zmierzone** jako kończące się kodem 0 na czerwonym
przebiegu. Przed czymkolwiek, co czyta lub wysyła `stderr.log`, klucz zostaje z niego wycięty
`sed`-em: maskowanie sekretów GitHuba działa na **logi, nie na artefakty**, a artefakt na
publicznym repo pobiera każdy zalogowany użytkownik.

### Success Criteria:

#### Automated Verification:

- Akcja wywołana z pustym `api-key` kończy krok bramki kodem 1 w kilka sekund, przed `npm ci`
- Ręcznie zdryfowana `criteria.json` (edycja bez regeneracji) czerwieni krok bramki dryfu
- Na zielonym przebiegu wszystkie **cztery** outputy (`status`, `result-path`, `stderr-path`, `model`) są niepuste w kroku wywołującym akcję

#### Manual Verification:

- `npm ci` w `agents/review` na `ubuntu-latest` kończy się sukcesem i wybiera `claude-agent-sdk-linux-x64` — lockfile ma go z `resolved` + `integrity`, ale to pierwsze uruchomienie na Linuksie w tym repo
- `stderr.log` nie zawiera klucza w żadnej postaci
- Główny plik workflow czyta się jako pięć kroków bez zaglądania do `action.yml`

**Implementation Note**: Zatrzymaj się i potwierdź ręcznie po pierwszym przebiegu na runnerze — instalacja 335 MB z postinstallem to najdroższy i najbardziej platformowo wrażliwy krok w całości.

---

## Phase 5: Workflow — wyzwalacze, uprawnienia, cztery stany, efekty uboczne

### Overview

Główny plik: pobierz stan PR-a → zbierz wejście → uruchom review → rozstrzygnij → opublikuj.
Tu ląduje cała mechanika GitHuba, którą to repo robi po raz pierwszy: `permissions:`,
`fetch-depth`, `gh` w CI, komentarze, etykiety.

### Changes Required:

#### 1. Wyzwalacze i współbieżność

**File**: `.github/workflows/pr-review.yml` (nowy)

**Intent**: Review odpala się przy otwarciu, pushu i ponownym otwarciu PR-a, na żądanie przez
etykietę, oraz ręcznie — ten ostatni tryb istnieje po to, żeby dało się zrobić parę przebiegów
z fazy 6. `types:` **nadpisuje** listę domyślną, więc `opened`/`synchronize`/`reopened` trzeba
wypisać ponownie razem z `labeled`. **Bez `paths-ignore`** — kopiując filtr z `ci.yml`,
sprawilibyśmy, że `ai-cr:review` na PR-ze dokumentacyjnym nie robi nic i nikt się o tym nie
dowie; filtry `paths` działają na zmienionych plikach niezależnie od typu aktywności.

**Contract**: `pull_request: types: [opened, synchronize, reopened, labeled], branches: [main]`
plus `workflow_dispatch` z inputami `pr_number` (required), `use_fixture` (boolean, default
false), `model` (optional). `concurrency` z **jawnym kluczem**
`group: pr-review-${{ github.event.pull_request.number || inputs.pr_number }}`
i `cancel-in-progress: true` — inaczej niż w `eval.yml`, gdzie `false` chroni współdzielone
konto przed równoległością; tu problemem jest nadmiar przebiegów, nie kolizja. Fallback na
`inputs.pr_number` nie jest ozdobą: przy `workflow_dispatch` nie ma kontekstu PR-a, więc bez
niego klucz zwija się do jednej wartości dla wszystkich dispatchów i drugi ręczny przebieg
anulowałby pierwszy. Konsekwencja dla fazy 6 jest zapisana tam wprost: przebiegi A i B lecą
**sekwencyjnie**, bo dzielą ten klucz.

#### 2. Uprawnienia i strażnicy jobu

**File**: `.github/workflows/pr-review.yml`

**Intent**: Pierwszy blok `permissions:` w tym repo. Wszystko niewymienione jest ustawiane na
`none`, więc jawny blok zawsze zawęża — i to jest wprost realizacja zdania z kryterium 6
wymagań o zakresie tokenów. Fork jest **pomijany w ciszy i świadomie**, a nie zostawiany
awarii na pustym sekrecie: czerwony przebieg na cudzym PR-ze czyta się jako „twój kod jest zły"
albo „repo jest zepsute", a nie jako „review się nie odbyło". Komunikatu dla autora forka
**nie obiecujemy i nie da się go dostarczyć**: przy `pull_request` z forka `GITHUB_TOKEN`
dostaje uprawnienia **read** niezależnie od bloku `permissions:`, więc komentarz wróciłby 403.
Pominięty job pokazuje się na liście checków PR-a jako `skipped` — to nie jest pełna cisza,
i na dziś (PR z forka jest w tym repo przypadkiem hipotetycznym) to wystarczy. Warunek powrotu
do tej decyzji jest w Open Risks briefu.

**Contract**: `permissions: { contents: read, pull-requests: write, issues: write }` —
`issues: write` **wyłącznie** dlatego, że workflow tworzy etykiety repo, a to endpoint Issues,
nie Pulls. Warunek jobu:
`github.event_name == 'workflow_dispatch' || github.event.pull_request.head.repo.full_name == github.repository`
oraz `github.event.action != 'labeled' || github.event.label.name == 'ai-cr:review'`
(dla pozostałych typów `github.event.label` jest `null`, wyrażenie zwraca pusty string i nie
rzuca — kolejność jest bezpieczna). Człon `workflow_dispatch` **nie jest kosmetyką i nie wolno
go „uprościć"**: przy ręcznym wyzwoleniu `github.event.pull_request` w ogóle nie istnieje,
dereferencja daje `null`, `null == '<owner>/<repo>'` jest fałszem — i bez tego członu **każdy**
dispatch kończy się pominiętym jobem, czyli cała faza 6 (przebiegi A, B, C) oraz wejścia
`use_fixture` i `model` są nieuruchamialne. Bezpieczeństwo tej furtki trzyma sam GitHub:
`workflow_dispatch` może wywołać wyłącznie ktoś z prawem zapisu do repo.

#### 3. Zdjęcie etykiety-triggera

**File**: `.github/workflows/pr-review.yml`

**Intent**: `ai-cr:review` schodzi **na starcie**, nie na końcu — jest wyzwalaczem, nie stanem.
Dzięki temu da się ją nałożyć ponownie za chwilę, a jej obecność na PR-ze nie jest mylona
z wynikiem review.

**Contract**: zdjęcie idempotentne, z jawnym połknięciem 404 (`DELETE …/labels/{name}` zwraca
404, gdy etykiety nie ma — to błąd, nie no-op). Komentarz w miejscu połknięcia ma mówić, że
jest to jedyne świadome połknięcie w tym pliku, i dlaczego.

#### 4. Zbieranie wejścia i cztery stany

**File**: `.github/workflows/pr-review.yml`

**Intent**: Diff liczony od punktu rozejścia z `main`, nie z ostatniego commita, i wyłącznie
z kodu. Surowy `git diff` w tym repo to w 69-89% dokumentacja i lockfile'e — wpuszczenie tego
karmi agenta materiałem, który systematycznie zaniża kryterium 9 i podbija koszt. **Świadoma
cena, zapisana wprost**: po odcięciu `context/**` kryterium 5 traci większość materiału
dowodowego, bo w tym repo „dlaczego" mieszka właśnie tam. Przyjmujemy to.

**Contract**: `actions/checkout@v7` z `fetch-depth: 0`; przy `workflow_dispatch` checkout
gałęzi PR-a po numerze. Diff:
`git diff --merge-base "origin/<base>" HEAD -- . ':(exclude)context/**' ':(exclude)**/package-lock.json' ':(exclude)src/db/database.types.ts' ':(exclude)agents/review/criteria.json'`.
Pliki `.md` **poza** `context/**` zostają w diffie — zmiana w `AGENTS.md` albo `README.md`
jest recenzowalna i kryterium 5 właśnie jej dotyczy.

**Reguła, nie lista nazw: z diffa wypada KAŻDY plik generowany.** Powód nie jest kosmetyczny —
agent oceniałby wtedy wyjście generatora jako czyjś kod, a więc wystawiał oceny (idiomatyczność,
złożoność, zakres) za decyzje, których nikt nie podjął. Ta sama reguła stoi już za wykluczeniem
`package-lock.json` i `src/db/database.types.ts`; `agents/review/criteria.json` dołącza do niej
w fazie 2 jako trzeci przypadek. **Każdy kolejny plik generowany dopisuje się do tego pathspeca
w tej samej fazie, w której powstaje** — dlatego `agents/review/prompt-sources.json` NIE jest tu
wymieniony: dochodzi razem z zapadką w fazie 7. Pathspec ma opisywać stan, który istnieje,
inaczej pierwszym objawem błędu jest wyjątek na nieistniejącej ścieżce.

**SHA do komentarza to `github.event.pull_request.head.sha`, nigdy `github.sha`.** Przy zdarzeniu
`pull_request` `github.sha` wskazuje syntetyczny commit `refs/pull/<N>/merge` — nie ma go na
liście commitów PR-a i autor nie zobaczy go nigdzie poza tym komentarzem. Kryterium sukcesu
„komentarz niesie SHA" przeszłoby wtedy na wartości nieprzypisywalnej, czyli byłoby dokładnie tą
niefalsyfikowalną weryfikacją, którą faza 6 tępi. Przy `workflow_dispatch` `head.sha` bierzemy
z API po `pr_number`.

Cztery stany rozstrzygane **logiką, nie opisem**, przez porównanie diffa filtrowanego
z niefiltrowanym:

| Sytuacja                                  | Przebieg | Etykieta       | Komentarz            |
| ----------------------------------------- | -------- | -------------- | -------------------- |
| filtrowany niepusty, agent zwrócił `pass` | zielony  | `ai-cr:passed` | aktualizowany        |
| filtrowany niepusty, agent zwrócił `fail` | zielony  | `ai-cr:failed` | aktualizowany        |
| filtrowany pusty, niefiltrowany niepusty  | zielony  | **żadna**      | „brak kodu do oceny" |
| oba puste albo agent padł                 | czerwony | **żadna**      | nagłówek awarii      |

Trzeci wiersz to czwarty stan z odpowiedzi na pytanie o PR-y dokumentacyjne: pustka jest tam
oczekiwana, a nie awarią zbierania wejścia. Treść tego komentarza renderuje
`renderNoCodeComment` z fazy 3 punkt 2 — **z tym samym markerem**, inaczej sticky komentarz
z punktu 6 rozjedzie się na dwa. Rozróżnia je para (kolor przebiegu, etykieta),
i to rozróżnienie musi wynikać z warunku w kodzie, a nie z treści komunikatu.

#### 5. Tryb fikstury

**File**: `.github/workflows/pr-review.yml`

**Intent**: Umożliwić parę przebiegów z fazy 6 różniącą się **dokładnie jedną rzeczą**.
Bez tego jedyną drogą do dowodu czerwieni jest PR-śmieć z zahardkodowanym kluczem, który na
publicznym repo zostaje w historii na zawsze.

**Contract**: gdy `github.event_name == 'workflow_dispatch' && inputs.use_fixture`, wejściem
agenta jest `agents/review/sample.diff` zamiast wyliczonego diffa; **wszystko inne przechodzi
tę samą ścieżkę**. Komentarz przy tym warunku ma mówić wprost, że to nie jest furtka do
„lekkiego review", tylko instrument pomiarowy, i wskazywać `verification.md` tej zmiany.
Input `model` również działa wyłącznie przy `workflow_dispatch` — żaden automatyczny wyzwalacz
go nie ustawia, więc automatyczne przebiegi zostają odtwarzalne.

#### 6. Sticky komentarz

**File**: `.github/workflows/pr-review.yml`

**Intent**: Jeden komentarz, aktualizowany w miejscu — wątek PR-a ma pozostać czytelny,
a aktualny stan review ma być jeden, nie do wyszukania w historii. Szukamy po **ukrytym
markerze HTML i autorze**, nie przez `gh pr comment --edit-last`: ta druga opcja bierze
„ostatni komentarz tego aktora" bez rozróżnienia po treści, więc pierwszy inny workflow
komentujący jako ten sam bot nadpisze nie ten komentarz.

**Contract**: wyszukanie komentarza z markerem `<!-- ai-code-review v1 -->` autorstwa
`github-actions[bot]`, potem `PATCH` po id albo `POST`, treść zawsze przez `-F "body=@plik"`
(markdown wieloliniowy nie wchodzi w argument). Krok ma `if: always()` — przy awarii renderuje
wariant z nagłówkiem, przekazując poprzednią treść jako `--previous`.

#### 7. Etykiety wyniku

**File**: `.github/workflows/pr-review.yml`

**Intent**: Etykieta jest jedynym sygnałem widocznym na liście PR-ów bez wchodzenia w środek —
i jedynym, który przeżyje moment, w którym nikt już nie klika w zielone przebiegi. Brak
etykiety musi pozostać odróżnialny od `ai-cr:passed`.

**Contract**: tworzenie idempotentne `gh label create "<nazwa>" --color <hex> --force` dla
wszystkich trzech etykiet (`--force` zamienia 422 `already_exists` w PATCH, więc exit 0);
nałożenie i wykluczenie jednym wywołaniem `gh pr edit --add-label … --remove-label …`.
**Nie używać `PUT /issues/{n}/labels`** — to zastępuje cały zestaw i skasuje etykiety
niezwiązane z review. Przy awarii nie nakładamy żadnej z dwóch etykiet wyniku.

#### 8. Kod wyjścia jobu

**File**: `.github/workflows/pr-review.yml`

**Intent**: Czerwony przebieg zawsze znaczy „review się nie wykonało", nigdy „review wypadło
źle". Ta asymetria jest całą treścią sekcji „Werdykt" z wymagań i musi być widoczna w kodzie
jako jeden jawny warunek, a nie rozproszona po krokach.

**Contract**: job kończy się kodem 1 wtedy i tylko wtedy, gdy `status` z akcji ≠ 0 albo
zbieranie wejścia zawiodło. Werdykt `fail` kończy job kodem 0. Komentarz przy tym warunku
odnotowuje, dlaczego to **nie jest** złamanie lekcji „komenda, która zawsze kończy się kodem 0,
nie jest bramką": tamten defekt polegał na tym, że krok **podawał się za bramkę** i nie
potrafił zaświecić na czerwono; ten niczego nie udaje — nie jest wymagany do merge'a, nie
wchodzi na listę wymaganych sprawdzeń, a jego werdykt jest jawnie doradczy. Do tego komentarza
należy warunek powrotu z wymagań: rewidujemy tę decyzję, gdy zmierzymy poziom fałszywych
alarmów na realnych PR-ach z tego repo.

### Success Criteria:

#### Automated Verification:

- Workflow parsuje się i uruchamia na PR-ze tej zmiany
- Diff wyliczony po `fetch-depth: 0` jest niepusty i nie zawiera `context/**` ani `package-lock.json`
- Trzy etykiety `ai-cr:*` istnieją w repo po pierwszym przebiegu (`gh label list`)
- Drugi przebieg na tym samym PR-ze **aktualizuje** komentarz — liczba komentarzy bota pozostaje 1

#### Manual Verification:

- Nałożenie `ai-cr:review` uruchamia przebieg, a etykieta znika w pierwszych sekundach
- PR dotykający wyłącznie `context/**` daje zielony przebieg, komentarz „brak kodu do oceny" i **zero** etykiet wyniku
- Etykiety wzajemnie się wykluczają — po przejściu z `fail` na `pass` PR nosi dokładnie jedną
- Komentarz niesie SHA, który **zgadza się z ostatnim commitem widocznym na liście commitów PR-a** — nie z SHA commita scalającego
- Główny plik przeczytany przez osobę, która go nie pisała, daje odpowiedź „co się dzieje i w jakiej kolejności" bez otwierania `action.yml`

**Implementation Note**: Zatrzymaj się i potwierdź ręcznie. Uprawnienia tokenu są tu pierwsze w repo — 403 na komentarzu albo etykiecie jest awarią głośną, ale tylko jeśli ktoś na nią patrzy.

---

## Phase 6: Próba czerwieni i pierwszy pomiar

### Overview

Zielony przebieg review **nie dowodzi, że review się odbyło**. Dowodzi tego dopiero para
przebiegów różniących się dokładnie jedną rzeczą — i ta faza istnieje po to, żeby ta para
powstała, zanim ktokolwiek zacznie temu sygnałowi ufać.

### Changes Required:

#### 1. Para przebiegów przy jednej zmiennej różnicy

**File**: `context/changes/ci-cd-code-review/verification.md` (nowy)

**Intent**: Udowodnić drogę do czerwieni tak, żeby wynik dało się przypisać. Lekcja
z `schema-drift-test` mówi wprost, co unieważnia taki dowód: tamten przebieg byłby
niefalsyfikowalny, bo „deploy pominięty" mogło być wyprodukowane przez strażnika gałęzi,
a odczytane jako wyprodukowane przez `needs`. Tutaj strażników jest kilka (fork, etykieta,
czwarty stan), więc para musi różnić się **wyłącznie** wartością `use_fixture`.

**Contract**: dwa `workflow_dispatch` na PR-ze tej zmiany, **jeden po drugim** — dzielą klucz
`concurrency` z fazy 5 punkt 1, więc odpalenie B przed końcem A anulowałoby A i para dowodowa
przestałaby istnieć. Przebieg A (`use_fixture: true`):
oczekiwane `ai-cr:failed`, komentarz nazywający kryteria 6 i 7 (fikstura ma zahardkodowany
service-role key, `import.meta.env`, off-by-one i `if (!error) { deleted++ }`). Przebieg B
(`use_fixture: false`): wynik realny, etykieta nałożona, poprzednia zdjęta, ten sam komentarz
zaktualizowany. Zapisujemy id obu przebiegów, oba werdykty i pełne tabele ocen.

#### 2. Trzeci przebieg — dowód ścieżki awarii

**File**: `context/changes/ci-cd-code-review/verification.md`

**Intent**: Stan „nie odbyło się" jest trzecim stanem i też wymaga dowodu, a nie deklaracji.
Bez niego nie wiadomo, czy nagłówek awarii w komentarzu w ogóle się renderuje i czy etykiety
faktycznie nie są nakładane.

**Contract**: `workflow_dispatch` z inputem `model` wskazującym nieistniejące id modelu — znowu
**jedna zmienna różnicy** względem przebiegu B. Oczekiwane: przebieg czerwony, zero etykiet
wyniku, komentarz z nagłówkiem awarii **nad zachowanym werdyktem** z przebiegu B. To jest
zarazem dowód naprawy z fazy 1: komunikat ma mówić o modelu i o łączności, a nie o niepoprawnym
structured output.

#### 3. Pomiar kosztu i zapis punktu odniesienia

**File**: `context/changes/ci-cd-code-review/verification.md`

**Intent**: Kalibracja progu i warunek wyjścia z decyzji o niesblokowaniu merge'a wymagają
pomiaru, a nie wrażenia. Pierwsze przebiegi są jedynym momentem, w którym te liczby powstają
za darmo — potem trzeba by je odtwarzać.

**Contract**: z linii metryk na stderr zapisujemy: tokeny wejścia, `cache_creation` /
`cache_read` (realny hit rate zamiast założonego), czas, `total_cost_usd` **z adnotacją, że
to przelicznik z cennika Anthropica, nie rachunek OpenRoutera**, oraz rozstrzygnięty model.
Do tego wall clock przebiegu i rozmiar diffa po filtrze. Odnotowujemy jawnie, że próg 5
jest wartością startową, nie wynikiem pomiaru, i czego trzeba, żeby ją zrewidować.

#### 4. Domknięcie dokumentacji

**Files**: `context/changes/ci-cd-code-review/change.md`, `AGENTS.md`

**Intent**: `AGENTS.md` §Commands nie wymienia żadnej komendy z `agents/`, a od tej zmiany
istnieją dwie generujące zacommitowane pliki. Aktualizujemy dokumentację **wtedy i tylko wtedy,
gdy zmiana unieważniła jej treść** — to jest dokładnie ten przypadek, i zarazem kryterium 5
zastosowane do nas samych.

**Contract**: jedno zdanie w §Commands o `npm --prefix agents/review run criteria` wraz
z bramką, która je pilnuje (`git diff --exit-code` w composite action). Uwaga na to, czego ta
edycja **nie** robi: §Commands (`AGENTS.md:21`) leży **między** §Hard Rules a §Conventions
i nie wchodzi do żadnej sekcji hashowanej przez zapadkę z fazy 7 — dopisanie tu zdania nie
ruszy żadnego hasha i **nie jest** testem zapadki. Realną próbę zapadki robi faza 7, na
sekcji, którą zapadka faktycznie pilnuje.

### Success Criteria:

#### Automated Verification:

- Przebieg A kończy się zielono i nakłada `ai-cr:failed`
- Przebieg B kończy się zielono, aktualizuje ten sam komentarz i zdejmuje `ai-cr:failed`
- Przebieg C kończy się czerwono i **nie** nakłada żadnej z dwóch etykiet wyniku
- `npm test` i `npm run typecheck` przechodzą po edycji `AGENTS.md`

#### Manual Verification:

- Werdykty A i B są rozróżnialne, a jedyną różnicą między przebiegami jest `use_fixture` — sprawdzone w logach obu przebiegów, nie założone
- Komentarz po przebiegu C niesie oba fakty naraz: nagłówek awarii i zachowany werdykt z B
- Komunikat awarii w C mówi o modelu i łączności, nie o structured output
- Pełny zapis pomiaru istnieje w `verification.md` i wystarcza, żeby porównać z nim przyszły przebieg po zmianie progu

**Implementation Note**: To jest faza, która czyni całą resztę wiarygodną. Jeśli para A/B nie da rozróżnialnych wyników, nie domykaj zmiany — bramka, która nie potrafi zaświecić na czerwono, jest gorsza niż jej brak, bo zdejmuje czujność.

---

## Phase 7: Zapadka na dryf destylatu promptu — po pomiarze, nie przed

### Overview

Destylat kontekstu repo z fazy 2 jest **kopią** i nic go nie pilnuje: gdy `AGENTS.md` albo mapa
ryzyk się zmieni, prompt zostanie w tyle po cichu. Ta faza domyka to hashem wyciętych sekcji.

**Dlaczego dopiero teraz, a nie w fazie 2.** Zapadka pilnuje treści, która do fazy 6 jest
kandydatem do przepisania: plan sam zapisuje w ryzykach, że kryterium 5 może okazać się szumem,
a destylat pierwszym miejscem do rewizji. Zapadka postawiona przed pomiarem kosztowałaby
regenerację rekordu po **każdej** iteracji opisu kryteriów — czyli obciążałaby dokładnie ten
etap, który Implementation Note fazy 2 nazywa jedynym tanim momentem na kalibrację. Do fazy 6
destylat jest niepilnowany, czyli dokładnie tak jak dziś; po fazie 6 wiadomo, czego pilnujemy.
Ta faza może też pojechać jako osobna zmiana — nic z faz 1-6 od niej nie zależy.

### Changes Required:

#### 1. Rekord hashy źródeł destylatu

**Files**: `scripts/prompt-sources.ts` (nowy), `agents/review/prompt-sources.json` (nowy, generowany)

**Intent**: Zapisać hash **wyciętych sekcji** źródeł i sprawdzać go testem. Hashujemy sekcje,
nie całe pliki: `test-plan.md` ma ~6,7 tys. linii, więc hash całości czerwieniałby przy każdej
literówce i po tygodniu byłby ignorowany — czyli byłby bramką, którą wszyscy obchodzą.

**Contract**: `scripts/prompt-sources.ts` eksportuje `extractSection(text, heading)` oraz
`hashSections()` — czyste funkcje, bez zależności runtime (konwencja `scripts/`: `node:fs`
i globalne API, `process.env`, importy względne z rozszerzeniem). Tryb `--write` regeneruje plik
rekordu i — zgodnie z parą pure/runner z fazy 3 punkt 3 — mieszka w osobnym
`scripts/run-prompt-sources.ts`, żeby import w teście nie wykonywał argv.
`agents/review/prompt-sources.json` to lista `{ path, heading, sha256 }` dla:
`AGENTS.md` §`## Hard Rules`, `AGENTS.md` §`## Conventions`,
`context/foundation/test-plan.md` §`## 2. Risk Map`. Rekord mieszka po stronie agenta, bo
opisuje właściwość **promptu** („z tej wersji dokumentów został zdestylowany"), a nie właściwość
repo. Emisja JSON-a: wcięcie 2 spacje, `\n` na końcu (Critical Implementation Details).
Razem z tym plikiem dochodzi `':(exclude)agents/review/prompt-sources.json'` do pathspeca diffa
w `pr-review.yml` — reguła „każdy plik generowany wypada z diffa" z fazy 5 punkt 4, zastosowana
w fazie, w której plik powstaje.

#### 2. Test zapadki

**File**: `tests/lib/review-prompt-sources.test.ts` (nowy)

**Intent**: Zaświecić na czerwono, gdy `AGENTS.md` albo mapa ryzyk się zmieni, a destylat promptu
zostanie nietknięty. Sam test też musi umieć zaświecić — inaczej byłby zielony także przy
zepsutym ekstraktorze sekcji, co jest dokładnie tą klasą, przed którą broni kryterium 8.

**Contract**: przelicza hashe sekcji z żywych plików i porównuje z `agents/review/prompt-sources.json`;
komunikat czerwieni mówi, **co zrobić** (przeczytaj zmienioną sekcję, zaktualizuj destylat
w `prompt.ts`, potem `scripts/run-prompt-sources.ts --write`), a nie tylko że hash się nie zgadza.
**Kontrola pozytywna**: ten sam ekstraktor puszczony na własnym, zmutowanym tekście testowym musi
dać inny hash — dowód, że hash reaguje na treść sekcji, a nie na sam fakt istnienia pliku.
Fikstura jest własnością tego pliku (lekcja „a positive control must OWN the fixture it mutates";
`vitest.config.ts:50` ma stały `sequence: { shuffle: true }`, więc zależność od kolejności
wypłynęłaby tu jako flake).

#### 3. Dopisanie komendy do dokumentacji

**File**: `AGENTS.md`

**Intent**: §Commands zyskuje drugą komendę generującą zacommitowany plik. To jest zarazem
**pierwsza realna próba zapadki**, ale tylko wtedy, gdy dotknie sekcji, którą zapadka pilnuje —
§Commands nią nie jest.

**Contract**: zdanie o `scripts/run-prompt-sources.ts --write` w §Commands; potem **osobno**
próba na §Hard Rules: zepsuj w niej jedną linię bez commita, potwierdź czerwień testu z punktu 2,
przywróć i potwierdź zieleń. Dopiero ta para (czerwono/zielono, jedna zmienna różnicy) dowodzi,
że zapadka działa — sama regeneracja rekordu tego nie dowodzi.

### Success Criteria:

#### Automated Verification:

- `node --experimental-strip-types scripts/run-prompt-sources.ts --write` jest idempotentne: `git diff --exit-code agents/review/prompt-sources.json`
- `npx prettier --check agents/review/prompt-sources.json` przechodzi
- `npm test`, `npm run typecheck` i `npm run lint` przechodzą

#### Manual Verification:

- Ręczne zepsucie jednej linii `AGENTS.md` §Hard Rules (bez commita) czerwieni test zapadki, a przywrócenie zieleni go z powrotem — para, nie pojedynczy przebieg
- Komunikat czerwieni mówi, co zrobić, a nie tylko że hash się nie zgadza
- Kontrola pozytywna ekstraktora daje inny hash na zmutowanym tekście własnym testu

**Implementation Note**: Jeśli po fazie 6 destylat idzie do przepisania, zrób to **przed** tą fazą — zapadka ma zamrozić treść, w którą już wierzysz.

---

## Testing Strategy

### Unit Tests:

- **Funkcja werdyktu** (`tests/lib/review-verdict.test.ts`) — granica progu z obu stron,
  `null` wyłączone z agregacji, alternatywa dwóch źródeł `fail`, brakujące kryterium jako błąd,
  **kontrola pozytywna** dowodząca, że funkcja umie zwrócić `pass`.
- **Renderer komentarza** (`tests/lib/review-comment.test.ts`) — „nie dotyczy" jawne, powody
  `fail` nad tabelą, idempotentny nagłówek awarii zachowujący poprzedni werdykt.
- **Kontrakt listy kryteriów** (`tests/lib/review-criteria.test.ts`) — dziewięć wpisów,
  dokładnie dwa warunkowe, klucze zgodne z oczekiwaną listą.
- **Zapadka na dryf destylatu** (`tests/lib/review-prompt-sources.test.ts`, **faza 7**) —
  hashe sekcji plus własna kontrola pozytywna na zmutowanym tekście.

### Integration Tests:

Integracji w rozumieniu suity vitest tu nie ma i nie będzie: wszystko powyżej funkcji werdyktu
wymaga sieci, klucza i GitHuba. Jej rolę pełnią przebiegi CI z fazy 6, i dlatego są opisane
jako para z jedną zmienną różnicy, a nie jako pojedynczy „smoke test".

### Manual Testing Steps:

1. Otwórz PR do `main` z realną zmianą kodu — sprawdź komentarz, etykietę i SHA w komentarzu.
2. Zrób push do gałęzi PR-a — sprawdź, że komentarz został **zaktualizowany**, nie dodany,
   i że SHA się zmieniło.
3. Nałóż `ai-cr:review` — sprawdź, że przebieg wystartował, a etykieta zniknęła.
4. Otwórz PR dotykający wyłącznie `context/**` — sprawdź czwarty stan (zielono, bez etykiet).
5. Odpal parę A/B z fazy 6 i przebieg C.

## Performance Considerations

Wąskim gardłem jest `npm ci` w `agents/review` (335 MB rozpakowane, postinstall), nie samo
wywołanie modelu. Cache npm w `setup-node` jest kluczowany na `agents/review/package-lock.json`,
więc drugi i kolejne przebiegi są istotnie tańsze czasowo.

Realnym czynnikiem kosztu **pieniężnego** jest `synchronize`: bez `cancel-in-progress` każdy
push uruchamiałby pełne review. Anulowanie domyka serię szybkich pushów do jednego przebiegu;
pushe rozłożone w czasie płacą osobno i to jest zaakceptowana cena za komentarz opisujący
aktualny stan PR-a. SHA w komentarzu domyka jedyny przypadek, w którym anulowanie zawodzi:
przebieg anulowany w ostatniej sekundzie zostawia komentarz sprzed jednego commita.

Cache promptu pomoże mniej, niż się wydaje — minimalny cachowalny prefiks to ~1024 tokeny
(prompt systemowy go przekroczy), ale domyślne TTL to 5 minut, a przebiegi CI dzielą minuty
lub godziny. Dlatego faza 6 **mierzy** hit rate ze stderr, zamiast go zakładać.

## Migration Notes

Nie ma migracji danych. Są trzy rzeczy do zrobienia po stronie GitHuba, wszystkie idempotentne
i wykonywane przez sam workflow przy pierwszym przebiegu: utworzenie trzech etykiet `ai-cr:*`.
Sekret `OPENROUTER_EVAL_KEY` **już istnieje** i nie wymaga zakładania — ale precedens
z `eval-ci-dispatch` mówi, że kontrola po nazwie sekretu niczego nie dowodzi: tamten klucz miał
w sobie BOM i pierwszy realny dispatch padł, mimo że kryterium „sekret istnieje" było zielone
przez cały czas. Dowodem jest pierwszy zielony przebieg z fazy 6, nie obecność nazwy na liście.

Cofnięcie zmiany to usunięcie jednego pliku workflow — reszta (agent, `scripts/`, testy) jest
bezużyteczna, ale nieszkodliwa i nie wchodzi na żadną istniejącą ścieżkę CI.

## References

- Wymagania: `context/changes/ci-cd-code-review/requirements.md`
- Badanie: `context/changes/ci-cd-code-review/research.md`
- Agent: `agents/review/review.ts:18-27`, `agents/review/review-schema.ts:15-19`, `agents/review/sample.diff`
- Precedens workflow z płatnym API: `.github/workflows/eval.yml:74-85`, `:109-118`, `:156-162`, `:176-186`
- Wzorzec generuj-i-porównaj: `.github/workflows/ci.yml` — `npm run db:types` + `git diff --exit-code`
- Wzorzec czystej funkcji CI + testu: `scripts/schema-drift.ts` ↔ `tests/lib/schema-drift.test.ts:1-5`
- Lekcje: `context/foundation/lessons.md:5-11` (nazwy gałęzi), `:194-199` (komenda zawsze zero), `:243-248` (zapis kompensujący)
- Mapa ryzyk: `context/foundation/test-plan.md` §2 i §2.1

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Agent runtime — routing, pin modelu, naprawa połkniętego błędu

#### Automated

- [x] 1.1 `npm run typecheck` przechodzi — dde452a
- [x] 1.2 `npm run lint` przechodzi — dde452a
- [x] 1.3 Uruchomienie na fiksturze zwraca JSON na stdout i kod 0 — dde452a
- [x] 1.4 Bramka klucza pada kodem 1 przed jakimkolwiek wywołaniem sieciowym — dde452a

#### Manual

- [x] 1.5 Kontrolka negatywna routingu daje komunikat o łączności, nie o structured output — dde452a
- [x] 1.6 Linia metryk zawiera rozstrzygnięty identyfikator modelu — dde452a
- [x] 1.7 Zapisany JSON parsuje się bez czyszczenia — dde452a

### Phase 2: Kontrakt oceny — dziewięć kryteriów, destylat, `criteria.json`

#### Automated

- [x] 2.1 Generator `criteria.json` jest idempotentny (`git diff --exit-code`)
- [x] 2.2 `prettier --check` przechodzi na `criteria.json`
- [x] 2.3 `npm run typecheck` i `npm run lint` przechodzą

#### Manual

- [x] 2.4 Fikstura daje komplet dziewięciu ocen z niskimi 6 i 7
- [x] 2.5 Diff bez ścieżek zapisu daje `null` w kryterium 7
- [x] 2.6 Uzasadnienia wskazują plik albo brakujący dowód, nie parafrazują opisu
- [x] 2.7 Liczba tokenów wejścia zapisana jako punkt odniesienia

### Phase 3: Werdykt i komentarz — czysta funkcja w `scripts/` plus testy

#### Automated

- [ ] 3.1 `npm test` przechodzi
- [ ] 3.2 `npm run typecheck` i `npm run lint` przechodzą
- [ ] 3.3 CLI zapisuje plik komentarza i wypisuje linię `verdict=…`

#### Manual

- [ ] 3.4 Podmiana progu na 8 zmienia werdykt na fiksturze granicznej
- [ ] 3.5 Komentarz mówi w pierwszych trzech linijkach, czy jest `fail` i przez które kryterium

### Phase 4: Composite action — pierwszy taki byt w tym repo

#### Automated

- [ ] 4.1 Pusty `api-key` kończy bramkę kodem 1 przed `npm ci`
- [ ] 4.2 Zdryfowana `criteria.json` czerwieni bramkę dryfu
- [ ] 4.3 Wszystkie cztery outputy (w tym `model`) są niepuste na zielonym przebiegu

#### Manual

- [ ] 4.4 `npm ci` na `ubuntu-latest` wybiera `claude-agent-sdk-linux-x64` i kończy się sukcesem
- [ ] 4.5 `stderr.log` nie zawiera klucza
- [ ] 4.6 Główny plik czyta się jako pięć kroków bez zaglądania do `action.yml`

### Phase 5: Workflow — wyzwalacze, uprawnienia, cztery stany, efekty uboczne

#### Automated

- [ ] 5.1 Workflow uruchamia się na PR-ze tej zmiany
- [ ] 5.2 Diff po filtrze jest niepusty i nie zawiera `context/**` ani lockfile'a
- [ ] 5.3 Trzy etykiety `ai-cr:*` istnieją po pierwszym przebiegu
- [ ] 5.4 Drugi przebieg aktualizuje komentarz zamiast dodawać nowy

#### Manual

- [ ] 5.5 `ai-cr:review` wyzwala przebieg i znika w pierwszych sekundach
- [ ] 5.6 PR z samym `context/**` daje czwarty stan: zielono, bez etykiet
- [ ] 5.7 Etykiety wyniku wzajemnie się wykluczają
- [ ] 5.8 SHA w komentarzu zgadza się z ostatnim commitem z listy commitów PR-a
- [ ] 5.9 Główny plik jest czytelny bez otwierania `action.yml`

### Phase 6: Próba czerwieni i pierwszy pomiar

#### Automated

- [ ] 6.1 Przebieg A (fikstura) kończy się zielono i nakłada `ai-cr:failed`
- [ ] 6.2 Przebieg B (realny diff) aktualizuje komentarz i zdejmuje poprzednią etykietę
- [ ] 6.3 Przebieg C (zły model) kończy się czerwono bez żadnej etykiety wyniku
- [ ] 6.4 `npm test` i `npm run typecheck` przechodzą po edycji `AGENTS.md`

#### Manual

- [ ] 6.5 A i B różnią się wyłącznie `use_fixture` — sprawdzone w logach obu przebiegów
- [ ] 6.6 Komentarz po C niesie nagłówek awarii nad zachowanym werdyktem z B
- [ ] 6.7 Komunikat awarii w C mówi o modelu i łączności, nie o structured output
- [ ] 6.8 Pełny zapis pomiaru w `verification.md` wystarcza do porównania z przyszłym przebiegiem

### Phase 7: Zapadka na dryf destylatu promptu — po pomiarze, nie przed

#### Automated

- [ ] 7.1 `scripts/run-prompt-sources.ts --write` jest idempotentne (`git diff --exit-code`)
- [ ] 7.2 `prettier --check` przechodzi na `prompt-sources.json`
- [ ] 7.3 `npm test`, `npm run typecheck` i `npm run lint` przechodzą

#### Manual

- [ ] 7.4 Zepsucie linii §Hard Rules czerwieni test, przywrócenie zieleni — para, nie pojedynczy przebieg
- [ ] 7.5 Komunikat czerwieni mówi, co zrobić
- [ ] 7.6 Kontrola pozytywna ekstraktora daje inny hash na zmutowanym tekście
