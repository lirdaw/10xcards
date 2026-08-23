# Zestaw evali (promptfoo) dla agenta code review — Implementation Plan

## Overview

Wydzielić `runReview` z `agents/review/review.ts` pod siatką testu charakteryzującego, założyć
bramkę typów nad pakietem agenta, zbudować zestaw promptfoo w `agents/review/evals/` z własnym
cache'em i własnym rachunkiem kosztu, i przejechać macierz 2×2 na dwóch tanich modelach —
lokalnie, w ~0,23 USD z ~0,50 USD, które zostały z budżetu 1 USD na całe zadanie.

Zestaw odpowiada na dwa pytania z `requirements.md` i tylko na nie: (1) czy zmiana w agencie nie
zepsuła wykrywania klasy błędu, (2) czy tańszy model wystarcza. Pytanie blokujące — czy tanie
modele w ogóle jadą przez ten harness — zostało zamknięte pomiarem (`measurement-cheap-models.md`):
jadą, kontrakt wraca, `safeParse` przechodzi.

## Current State Analysis

**Agent istnieje i jest w produkcji, ale nie ma szwu ani siatki.** `agents/review/review.ts`
(288 linii) ma DOKŁADNIE JEDEN eksport — `export type FailureKind` (`:107`) — i żadnej
eksportowanej funkcji. Sam import tego pliku uruchamia osiem efektów ubocznych na module scope
(`:19`, `:78-91`, `:137-159`, `:173-194`) i kończy się blokadą na stdin plus top-level `await`.
Zweryfikowane bezpośrednio w pliku, nie z notatki.

**Nie istnieje żaden test na `review.ts`.** `prompt.test.ts` pokrywa wyłącznie `prompt.ts`
(6 przypadków pod `node:test`); `tests/lib/review-criteria.test.ts` i `review-verdict.test.ts`
pokrywają stronę konsumenta. Nic w repo nie zauważyłoby, że wydzielona funkcja rozjechała się ze
skryptem.

**Granica `agents/` jest twarda i zweryfikowana osobno.** Root `package.json` nie ma `workspaces`;
`agents/review/` ma własny `package-lock.json` i własne `node_modules`. Rootowy `tsconfig.json`
ma `exclude: ["dist", "context", "agents"]`, a `eslint.config.js:130` ignoruje `agents/**`. SDK
zainstalowane w roocie jest przypadkowe — rootowy lock nie zna słowa „anthropic", więc `npm ci`
w CI je wytnie. Każdy pomysł „eval pod `evals/` zaimportuje agenta" rozbija się o tę granicę albo
o `npm ci`.

**Bramki typów nad `agents/` NIE MA — i wbrew pierwszemu wrażeniu nie ma czego rozszerzać.**
Zweryfikowane: w `agents/review/` nie ma `tsconfig.json`, w `package.json` nie ma skryptu
`typecheck` ani zależności `typescript` (tylko `tsx`, `@types/node`, SDK, `zod`). Jedyny tsconfig
w repo to rootowy, który `agents` wyklucza. Bramkę trzeba **założyć**.

**Kontrakty tego agenta są STRINGOWE.** Rodzaj awarii jedzie w treści rzutu, workflow grepuje
stderr, metryki istnieją wyłącznie jako linia tekstu. Composite action woła agenta jako
`npm --prefix agents/review run --silent review` z przekierowaniami stdin/stdout/stderr
(`action.yml:188-189`) i czyta z tego: `model=` w `$GITHUB_OUTPUT` (pisane przez SAM proces
agenta), linię `[metryki]`, kod wyjścia. Ekstrakcja, która ruszy którąkolwiek z tych linii,
jest zmianą zachowania, nie refaktorem.

**Trzy kolumny modelowe są zmierzone, nie zgadnięte** (`measurement-cheap-models.md`, linia bazowa
`0d3eba5`): koszt komórki na `sample.diff` przy zimnym cache'u lokalnie — gemini-2.5-flash
0,0323 USD, haiku-4.5 0,0846 USD, sonnet-4.6 0,1935 USD.

## Desired End State

`npm --prefix agents/review run eval` odpala macierz 2 modele × 2 fikstury przez PRAWDZIWĄ
funkcję `runReview` — tę samą, którą wywołuje CI — i wypisuje tabelę per komórka z werdyktem,
kontraktem, kosztem policzonym z cennika OpenRoutera i wiekiem tego cennika. Powtórzenie bez
zmiany promptu jest darmowe. `pr-review.yml` i composite action działają bez zmiany choćby jednej
linii. Pakiet agenta ma bramkę typów biegnącą w CI na własnym triggerze, z parą dowodową.

Weryfikacja końcowa: przejście macierzy zielone, tabela kosztów zapisana w notatce zmiany, para
dowodowa bramki typów (czerwień → poprawka → zieleń) z numerami przebiegów, i suma wydatków
poniżej 1 USD.

### Key Discoveries:

- `agents/review/review.ts:107` — jedyny eksport to typ; funkcja `review(diff)` (`:211-281`) jest
  nieeksportowana i to ona jest funkcją do wydzielenia.
- `agents/review/review.ts:189-194` — najostrzejszy szew: `ANTHROPIC_API_KEY = ""` jest
  OBOWIĄZKOWE (niepuste wygrywa z tokenem auth). To globalna prekondycja procesu, nie argument.
- `agents/review/prompt.ts:299` — `wrapDiff(diff, nonce = makeFenceNonce())`: repo ma już wzorzec
  „zależność wstrzykiwalna WYŁĄCZNIE po to, by test był deterministyczny". `runReview` dziedziczy
  ten wzorzec dla `query`, zamiast wynajdywać własny.
- `.github/workflows/prompt-ratchet.yml:53-62` — agent ma już w CI krok uruchamiający JEGO własne
  testy (`node --experimental-strip-types --test`), świadomie **bez `npm ci`**, bo `prompt.test.ts`
  nie ma zależności runtime. Nowe testy zależności MAJĄ, więc potrzebują innego joba — a nie
  przeniesienia `prompt.test.ts`.
- `.github/actions/review-agent/action.yml:124-126` — instalacja pakietu agenta to „najwolniejszy
  i najbardziej wrażliwy na platformę krok w całej zmianie: ~335 MB rozpakowane".
- Zmierzone samodzielnie: `tsc --strict` nad `agents/review` daje **zero błędów**, więc założenie
  bramki nie odsłania długu (probe wykonany i usunięty; `git status` czysty).
- Zmierzone samodzielnie: lokalny Node to **v24.18.0**, więc `engines: >=22.22.0` z promptfoo nie
  jest lokalnie problemem. `.nvmrc` 22.14.0 dotyczy aplikacji, nie tego pakietu.
- Potwierdzone w dokumentacji promptfoo: provider to KLASA z `constructor(options)` →
  `options.config`; `callApi` zwraca `{ output, tokenUsage, cost, cached, metadata }`; jest
  `getCache()` (`get/set/del/clear`) i `isCacheEnabled()`; konwencja `cached: true` przy trafieniu.
- `scripts/review-verdict.ts:32-35` — próg 5 leży POZA promptem i pozostaje nietknięty.

## What We're NOT Doing

- **Workflow evali w CI.** Odłożony do osobnej zmiany — patrz „Dług zapisany jawnie" w fazie 7.
- **Kolumny sonneta w macierzy.** +0,39 USD na przejście przy ~0,50 USD dostępnych. Liczba
  odniesienia jest już zmierzona (0,1935 USD/komórka) i wystarcza do odpowiedzi na pytanie 2.
- **`sample-injection.diff` jako trzeciej fikstury.** Wymaganie 3 (macierz startowa 2×2) jest
  ważniejsze niż domknięcie tamtej luki w pierwszym podejściu.
- **`llm-rubric` w jakiejkolwiek asercji.** Decyzja podjęta, nie odłożona: agent zwraca structured
  output, więc „czy złapał klasę błędu" jest asercją `javascript` — deterministyczną i darmową.
  Do tego promptfoo **nie raportuje kwoty sędziego w ogóle** (`GradingResult` niesie `tokensUsed`,
  nie `cost`), więc każde wywołanie rubryki byłoby wydatkiem poza raportowanym budżetem — dokładnie
  tym, czego zakazuje wymaganie 9.
- **Wbudowanego providera `anthropic:claude-agent-sdk`.** Wygląda jak darmowe domknięcie wymagań 6
  i 9 (cachuje i raportuje koszt z pudełka), ale jechałby WŁASNYM wywołaniem SDK: bez `wrapDiff`
  z noncem, bez naszej walidacji zodem, bez klasyfikacji awarii. To jest wariant odrzucony
  z `requirements.md` wchodzący innymi drzwiami.
- **Strojenia progu 5, dodatkowych dostawców, rozszerzania macierzy.** Po pierwszym przejściu.
- **`tsx` → `dependencies` + `npm ci --omit=dev` w composite action.** Kusi, bo uczyniłoby akcję
  SZYBSZĄ niż dziś. Odrzucone tutaj: to zmiana na produkcyjnej ścieżce CI podjęta bez liczby,
  w zmianie o innym celu, a pierwszy dowód, że nie zepsuła review, przyszedłby na cudzym PR-ze.
  Optymalizacja przy okazji to dokładnie ta klasa, przed którą broni kryterium 9. Ma warunek
  uruchomienia — patrz faza 4.

## Implementation Approach

Kolejność faz wymusza dyscyplinę, której inaczej nikt nie dopilnuje:

1. **Siatka przed refaktorem.** Test charakteryzujący powstaje i przechodzi na NIEZMIENIONYM
   kodzie, osobnym commitem. Dopiero potem cokolwiek się rozcina. „Ekstrakcja nic nie zmieniła"
   ma być pomiarem, nie deklaracją.
2. **Bramka przed kodem evala.** Typecheck nad `agents/` wchodzi zanim powstanie pierwszy plik
   zestawu, żeby zestaw od pierwszej linii był pod bramką, a nie „dołożymy potem".
3. **Zero wywołań modelu do fazy 6.** Cały szkielet — provider, cennik, cache, asercje — buduje
   się i testuje na stubie. Pierwsze pieniądze idą dopiero wtedy, gdy jest co mierzyć.
4. **Pomiar przed bramką.** Kontrola negatywna najpierw MIERZY (zapisz, co modele zwróciły),
   a dopiero potem jej wynik staje się asercją. Czerwień, która znaczy „zapisz to", i czerwień,
   która znaczy „regresja", nie mogą wyglądać tak samo.

## Critical Implementation Details

**Kolejność efektów w CLI jest kontraktem, nie stylem.** W dzisiejszym `review.ts` odmowa przy
niepoprawnym `REVIEW_MAX_BUDGET_USD` (`:78-91`) zachodzi PRZED zapisem `model=` do
`$GITHUB_OUTPUT` (`:137-159`), a ten PRZED bramką klucza (`:173-186`), a ta PRZED przestawieniem
zmiennych `ANTHROPIC_*` (`:189-194`) i odczytem stdin (`:197-201`). Test z fazy 1 pinuje tę
kolejność przez obserwowalny skutek (czy `$GITHUB_OUTPUT` jest pusty, czy zawiera `model=`).
Implementer ma tę kolejność odczytać z pliku i potwierdzić, zanim wpisze ją w asercje — plan
podaje ją jako to, co zobaczyłem, nie jako to, w co należy wierzyć.

**Trzy zmienne `ANTHROPIC_*` ustawia `runReview` i TYLKO ona.** Niepusty `ANTHROPIC_API_KEY`
wygrywa z tokenem auth, więc te trzy przypisania (`review.ts:189-194`) są prekondycją KAŻDEGO
wywołania modelu, nie ozdobą wrappera. Gdyby zostały w wrapperze, provider evali musiałby je
odtworzyć — a wtedy istnieją DWIE kopie tej samej prekondycji i ich rozjazd jest cichy: oba
wywołania (CI i eval) jadą do INNEGO endpointu z INNĄ precedencją poświadczeń, ta sama funkcja,
inny dostawca, i nic w wyniku o tym nie mówi. Jedna kopia wewnątrz `runReview` czyni to
niemożliwym PRZEZ KONSTRUKCJĘ, a nie przez czujność autora providera.

Zmiana kolejności, którą to powoduje, jest nieobserwowalna i została sprawdzona: dziś env
przestawia się przed drukiem `[konfiguracja]` (`:206-209`), po przeniesieniu — po nim. Żadna
z tych trzech wartości nie trafia na stdout ani stderr, więc siatka z fazy 1 nie widzi różnicy.
W wrapperze zostaje wyłącznie bramka klucza (`:173-186`) — bo ona jest komunikatem dla CZŁOWIEKA
przy CLI, a nie prekondycją wywołania.

**Wrapper NIE MOŻE łapać rzutu z `runReview`.** Dziś `review.ts:288` nie ma try/catch, więc rzut
staje się unhandled rejection i Node drukuje `Error: [kind] …` OSOBNĄ LINIĄ nad stackiem. To nie
jest przypadek: `pr-review.yml:529` wyciąga powód do komentarza PR-a przez
`grep -m1 -E '^[A-Za-z]*Error:'` — i komentarz w tamtym pliku mówi wprost, że kształt zmierzono
na przebiegu 32534464639. Wrapper drukujący `console.error(err.message)` kasuje prefiks `Error:`,
ekstrakcja spada do gałęzi opisanej jako „Nothing was thrown", a komentarz na publicznym PR-ze
zmienia treść. Z tego samego powodu `reportFailureKind` zostaje WEWNĄTRZ `runReview` — patrz
faza 2.

**Nieświeży wynik z cache'u wyglądający jak zielona bramka to RYZYKO PIERWSZEJ KATEGORII tej
zmiany** — groźniejsze niż brak cache'u, bo znika razem z informacją, że coś zniknęło. Dlatego
test cache'u dowodzi dwóch kierunków, a ważniejszy z nich (zmieniony prompt → PUDŁO) dostaje
kontrolę pozytywną przez mutację funkcji liczącej klucz. Test, który przechodzi także dla klucza
nieuwzględniającego hasha promptu, nie pilnuje niczego — a zmiana taka jak `0d3eba5` zostałaby
wtedy zaserwowana ze starego wyniku.

**`REVIEW_MAX_BUDGET_USD` NIE jest limitem wydatku.** SDK liczy go z katalogu modeli Anthropica,
w którym identyfikatorów OpenRoutera nie ma wcale; zmierzone przeszacowanie to 14× dla gemini
i 5× dla haiku, a dla sonneta 1,00× wyłącznie dlatego, że cennik przypadkiem pasuje. Na przebiegi
evali cap ustawiamy na **0,60 USD** — POWYŻEJ najgorszego zimnego przebiegu (0,4530 wg licznika
SDK) — i traktujemy wyłącznie jako bezpiecznik od patologii. Bramką kosztową są policzone tokeny
× cennik OpenRoutera. Cap ustawiony „nisko" produkuje flaky bramkę: dwa przebiegi haiku różniące
się WYŁĄCZNIE ciepłotą cache'u rozeszły się na sukces i `error_max_budget_usd`.

**Nonce nie może wejść do klucza cache'u.** Jest losowy per wywołanie i siedzi wyłącznie
w wiadomości użytkownika, więc ani prefiksu cache'u Anthropica, ani porównywalności przebiegów
nie rusza — ale wpuszczony do klucza czyni cache martwym kodem, który zawsze pudłuje.

---

## Phase 1: Siatka charakteryzująca — przed jakąkolwiek ekstrakcją

### Overview

Zamrozić tekstowe kontrakty CLI, które czyta composite action, na NIEZMIENIONYM kodzie. Ten test
ma przejść przed fazą 2 i po niej, na tym samym wejściu i bez zmiany ani jednej asercji.

### Changes Required:

#### 1. Test procesowy CLI

**File**: `agents/review/review-cli.test.ts` (nowy)

**Intent**: przechwycić wszystko, co composite action i `pr-review.yml` czytają z uruchomienia
agenta, zanim ekstrakcja zacznie to przestawiać. Cztery przypadki, z których ŻADEN nie dochodzi do
modelu — czyli test jest darmowy, deterministyczny i pokrywa dokładnie te efekty uboczne modułowe,
które faza 2 przenosi.

**Contract**: `node:test` + `node:assert`, wzorem `prompt.test.ts`. Każdy przypadek spawnuje
agenta tak, jak robi to `action.yml:188-189` (przekierowania, nigdy potok), z kontrolowanym `env`
i tymczasowym plikiem podstawionym pod `GITHUB_OUTPUT`, i asertuje kod wyjścia, pełną treść stderr
oraz zawartość `$GITHUB_OUTPUT`:

- pusty stdin, poprawny token, `GITHUB_OUTPUT` ustawiony → exit 1; stderr zawiera linię
  `[konfiguracja]` w dzisiejszym brzmieniu, a po niej komunikat o pustym diffie; `$GITHUB_OUTPUT`
  zawiera dokładnie `model=<id>\n`;
- `REVIEW_MAX_BUDGET_USD=abc` → exit 1; dwie linie stderr co do znaku; `$GITHUB_OUTPUT` **pusty**
  (odmowa zachodzi przed zapisem — to jest asercja na KOLEJNOŚĆ);
- brak `ANTHROPIC_AUTH_TOKEN` → exit 1; komplet linii bramki klucza co do znaku;
- `REVIEW_MODEL` zawierający znak nowej linii, **przy USTAWIONYM `GITHUB_OUTPUT`** → exit 1; linia
  odmowy co do znaku; `$GITHUB_OUTPUT` **pusty** (odmowa zachodzi przed zapisem `model=`, tak jak
  przy złym capie). Przesłanka o `GITHUB_OUTPUT` jest tu warunkiem poprawności testu, nie
  szczegółem: sprawdzenie nowej linii siedzi WEWNĄTRZ `if (githubOutput)` (`:138-145`), więc bez
  tej zmiennej proces idzie dalej i kończy się exit 1 — ale z komunikatem o PUSTYM DIFFIE. Ten sam
  kod wyjścia, inna linia, i test przechodzi z niewłaściwego powodu.

Test NIE stubuje niczego i nie wymaga szwu — dlatego może powstać przed ekstrakcją.

### Success Criteria:

#### Automated Verification:

- Nowy test przechodzi na niezmienionym `review.ts`
- `agents/review/prompt.test.ts` nadal 6/6
- `git diff --stat` pokazuje wyłącznie nowy plik testu (zero zmian w `review.ts`)

#### Manual Verification:

- Każda asercja przeczytana obok `review.ts:78-209` — potwierdzone, że pinuje linię, którą naprawdę
  czyta action lub workflow, a nie tekst wymyślony przez test
- Potwierdzona kolejność efektów w pliku (cap → `model=` → klucz → env → stdin); jeśli różni się od
  zapisanej w planie, wygrywa plik, a plan dostaje korektę

**Implementation Note**: ta faza kończy się WŁASNYM commitem, przed jakąkolwiek zmianą
w `review.ts`. Commit „siatka" i commit „ekstrakcja" muszą być rozdzielne, bo inaczej nie da się
pokazać, że test przechodził po obu stronach.

---

## Phase 2: Ekstrakcja `runReview` i cienki wrapper CLI

### Overview

Wydzielić funkcję, którą pojedzie eval, tak żeby CI jechało DOKŁADNIE tą samą — i żeby wrapper był
za krótki, by zmieścić drugą ścieżkę.

### Changes Required:

#### 1. Wydzielona funkcja

**File**: `agents/review/run-review.ts` (nowy)

**Intent**: przenieść tu ciało dzisiejszego `review(diff)` (`:211-281`) plus dwie czyste decyzje
(`classifyFailure`, walidacja capa) i oddać metryki jako DANE, a nie jako linię tekstu. Funkcja nie
drukuje niczego i nie woła `process.exit`.

**Contract**: `export async function runReview(diff: string, opts: RunReviewOptions): Promise<RunReviewResult>`,
gdzie `RunReviewOptions = { model: string; maxBudgetUsd: number; query?: QueryFn }`, a
`RunReviewResult = { review: Review; metrics: ReviewMetrics }`. `ReviewMetrics` niesie każdą
wartość, którą dziś składa linia `[metryki]` (model, tury, czas, koszt SDK, tokeny wejścia, zapis
i odczyt cache'u, wyjście, `terminal_reason`) — formatowanie zostaje w wrapperze. Przy awarii
funkcja RZUCA, niosąc `FailureKind` tak jak dziś.

**`reportFailureKind` przenosi się tu RAZEM z ciałem i NIE wraca do wrappera** — mimo że jest
efektem na `$GITHUB_OUTPUT`, a nie logiką recenzji. Trzy powody, wszystkie sprawdzone w plikach:

- Jest dziś wołane WEWNĄTRZ wydzielanej funkcji, w dwóch miejscach (`:244`, `:273`), więc
  „zostawić po stronie wrappera" to nie przeniesienie, tylko przecięcie ścieżki awarii — a to
  jedyna ścieżka, której siatka z fazy 1 **nie umie zobaczyć** (wszystkie cztery przypadki kończą
  się przed wywołaniem modelu).
- Wrapper mógłby poznać `FailureKind` wyłącznie wyłuskując `[kind]` z treści komunikatu — czyli
  budując bramkę na TREŚCI, klasa z `lessons.md:194-199`, w dodatku między dwoma plikami tego
  samego pakietu.
- Sam wrapper musiałby wtedy złapać rzut, żeby to zawołać — a to kasuje linię `Error:`, którą
  czyta `pr-review.yml:529` (patrz „Critical Implementation Details").

W evalu ta funkcja jest darmowa i cicha: `:125-126` sprawdza `process.env.GITHUB_OUTPUT` i wraca
bez efektu, gdy zmiennej nie ma — a poza CI jej nie ma. Zysk z „czystej funkcji" byłby więc
estetyczny, a koszt kontraktowy realny.

**Trzy przypisania `ANTHROPIC_*` (`:188-194`) też przenoszą się tutaj**, na początek funkcji,
przed `query(...)` — patrz „Critical Implementation Details". `runReview` czyta
`process.env.ANTHROPIC_AUTH_TOKEN?.trim()` sama, więc provider evali nie ustawia tych zmiennych
w ogóle i nie może się z CI rozjechać.

`query` jest wstrzykiwalny WYŁĄCZNIE po to, by test był deterministyczny — dokładnie tak, jak
`nonce` w `wrapDiff` (`prompt.ts:299`), i z takim samym komentarzem przy sygnaturze. Domyślną
wartością jest prawdziwe `query` z SDK.

Wyeksportować też `classifyFailure` i czystą wersję walidacji capa (zwracającą wynik albo błąd,
bez `console.error` i bez `exit`).

#### 2. Wrapper CLI

**File**: `agents/review/review.ts`

**Intent**: zostaje wyłącznie to, czego nie da się przenieść bez zmiany zachowania procesu: odczyt
env, odmowa przy złym capie, zapis `model=`, bramka klucza (komunikat dla człowieka), odczyt
stdin, druk `[konfiguracja]` i `[metryki]`, jedyny `console.log`, kody wyjścia.

Trzech rzeczy tu NIE ma i to jest decyzja, nie przeoczenie: `reportFailureKind`, przestawienie
`ANTHROPIC_*` i jakikolwiek `try/catch` wokół `runReview`. Pierwsze dwie mieszkają w `runReview`
(§1), trzeciej nie ma dziś i nie może się pojawić — inaczej znika linia `Error:` czytana przez
`pr-review.yml:529`.

**Contract**: żadna linia stderr ani stdout nie zmienia się o bajt — łącznie ze ŚCIEŻKĄ AWARII,
gdzie tą linią jest `Error: [kind] Review nie powiodło się …` wyprodukowana przez unhandled
rejection, nie przez `console.error`; kolejność efektów zachowana;
`package.json` agenta nadal wskazuje `tsx review.ts`, więc composite action i `pr-review.yml`
pozostają NIETKNIĘTE. Jeśli wrapper zaczyna rosnąć — to znak, że coś, co należy do `runReview`,
zostało tutaj.

#### 3. Testy nowej powierzchni

**File**: `agents/review/run-review.test.ts` (nowy)

**Intent**: pokrycie, które przed szwem nie mogło istnieć — ścieżka sukcesu i cztery klasy awarii,
na wstrzykniętym stubie `query`, bez ani jednego wywołania modelu.

**Contract**: `node:test`; stub zwraca zamrożone wiadomości SDK. Przypadki: sukces (kontrakt
dziewięciu ocen + dziewięciu not + `verdict` + `summary`, metryki jako dane); `subtype` inny niż
`success` → rzut `[provider]`; `is_error: true` → to samo; wyjście łamiące schemat → `[contract]`;
`error_max_budget_usd` → `[budget]`.

Każda z czterech klas awarii asertuje DWIE rzeczy naraz, bo dopiero razem pokrywają to, czego
faza 1 nie umiała zobaczyć: (a) `err.message` zaczyna się od `[<kind>]` — to jest to, co po
sformatowaniu przez Node trafia w `grep '^[A-Za-z]*Error:'` z `pr-review.yml:529`; (b) przy
`GITHUB_OUTPUT` wskazanym na plik tymczasowy plik ten zawiera dokładnie `failure-kind=<kind>\n`,
a przy zmiennej NIEUSTAWIONEJ `runReview` nie próbuje niczego zapisać (dowód, że w evalu ta
funkcja jest cicha). To zamyka szew, którego siatka procesowa z fazy 1 z definicji nie dosięga —
i robi to bez ani jednego wywołania modelu.

### Success Criteria:

#### Automated Verification:

- `review-cli.test.ts` z fazy 1 przechodzi **bez zmiany ani jednej asercji**
- `run-review.test.ts` przechodzi, łącznie z parą asercji (`[kind]` w komunikacie +
  `failure-kind=` w `$GITHUB_OUTPUT`) dla każdej z czterech klas awarii
- `prompt.test.ts` nadal 6/6
- `git diff` po stronie `.github/**` jest PUSTY

#### Manual Verification:

- Wrapper przeczytany w całości — potwierdzone, że nie mieści logiki recenzji
- Potwierdzone w wrapperze, że NIE MA `try/catch` wokół `runReview` ani żadnego
  `console.error(err…)` na ścieżce awarii — linia `Error:` czytana przez `pr-review.yml:529`
  powstaje z unhandled rejection i tylko tak

**Implementation Note**: ręczny przebieg na `sample.diff` z prawdziwym kluczem NIE jest tu
wymagany i nie jest robiony (kosztowałby komórkę) — dowodem jest siatka z fazy 1 plus
`run-review.test.ts`. To jest zakres, nie kryterium, więc świadomie nie ma go w `## Progress`.

---

## Phase 3: Bramka pakietu agenta (typecheck + testy zależne) w CI

### Overview

Założyć nad `agents/` bramkę, której dziś nie ma, we własnym pliku workflow — żeby zmiana ruszająca
wyłącznie `agents/review/evals/` nie mogła przejść niesprawdzona.

### Changes Required:

#### 1. Konfiguracja typów pakietu

**File**: `agents/review/tsconfig.json` (nowy)

**Intent**: objąć typecheckiem cały pakiet agenta, łącznie z katalogiem `evals/`, który powstanie
w fazie 4.

**Contract**: `strict`, `noEmit`, ESM zgodne z `"type": "module"`, `include: ["**/*.ts"]`,
`exclude: ["node_modules"]`. Zmierzone przed napisaniem tej fazy: dzisiejszy pakiet przechodzi
`tsc --strict` z **zerem błędów**, więc bramka nie odsłania długu i nie wymaga fazy naprawczej.

#### 2. Skrypty pakietu

**File**: `agents/review/package.json`

**Intent**: dać bramce wywołanie, którym pojedzie i CI, i człowiek lokalnie.

**Contract**: `typescript` w `devDependencies`; skrypt `typecheck` uruchamiający `tsc` na tym
tsconfigu; skrypt `test` uruchamiający WSZYSTKIE pliki `*.test.ts` pakietu jednym poleceniem pod
`node --experimental-strip-types --test`, w formie działającej i na Windows, i na Linuksie (glob
rozwijany przez shell nie spełnia tego warunku).

#### 3. Nowy workflow

**File**: `.github/workflows/agents-gate.yml` (nowy)

**Intent**: bramka biegnie na własnym triggerze, niezależnie od tego, czy odpalił się review.

**Contract**: `on: push/pull_request` na `main` z
`paths: ["agents/**", ".github/workflows/agents-gate.yml"]`; `permissions: contents: read`;
`concurrency` z `cancel-in-progress: true`; `defaults: run: shell: bash` (gwarancja należy do
konfiguracji PLIKU); `setup-node` z `cache: npm` i
`cache-dependency-path: agents/review/package-lock.json`; `npm ci` w `agents/review`; potem
`typecheck` i `test` pakietu.

Filtr `paths` jest tu **odwrotną decyzją niż w `prompt-ratchet.yml` i wymaga zapisania dlaczego**:
tamten plik świadomie NIE ma filtra, bo „the job is seconds long with no install, so there is
nothing to buy by filtering". Tutaj instalacja jest najwolniejszym krokiem w całym repo (~335 MB,
`action.yml:124-126`), więc filtr coś kupuje — a klasa błędu, przed którą tamten komentarz
przestrzega (filtr zestarzeje się cicho, gdy strzeżona lista urośnie poza filtr), tu nie zachodzi:
zbiór strzeżony to zawartość `include` z tsconfiga, który leży WEWNĄTRZ `agents/`, a sam plik
workflow jest w filtrze wymieniony.

#### 4. Rozgraniczenie wobec istniejącego workflow

**File**: `.github/workflows/prompt-ratchet.yml` — **bez zmian**

**Intent**: nie przenosić `prompt.test.ts`. Jego wartością jest brak zależności runtime — dlatego
biegnie tam bez `npm ci` i w sekundach. Nowe testy zależności mają i dlatego dostają inny job.

### Success Criteria:

#### Automated Verification:

- `npm --prefix agents/review run typecheck` — zielone lokalnie
- `npm --prefix agents/review run test` — wszystkie pliki testowe pakietu wykryte i zielone
- Nowy workflow zielony na PR-ze

#### Manual Verification:

- **Para dowodowa NA ŚCIEŻCE CI**: commit z celowym błędem typów → przebieg CZERWONY → poprawka →
  przebieg ZIELONY. Numery obu przebiegów zapisane w notatce zmiany.
  **Sonda ląduje w pliku, który w TEJ fazie już istnieje** — `agents/review/evals/` powstaje
  dopiero w fazie 4, więc celowanie w niego tutaj byłoby kryterium niewykonalnym. Użyć
  tymczasowego `agents/review/probe.ts`, usuwanego poprawką: filtr `paths` (`agents/**`) łapie go
  tak samo, a `include: ["**/*.ts"]` obejmuje go tym samym tsconfigiem, który później obejmie
  `evals/`. To, że bramka sięga także `evals/`, potwierdza kryterium 4.4 na PR-ze fazy 4
- Potwierdzone przed próbą, że tę sondę da się wypchnąć ZWYKŁYM gitem, bez `--no-verify`: rootowy
  `npm run typecheck` wyklucza `agents`, a ESLint ignoruje `agents/**`, więc ani `pre-commit`, ani
  `pre-push` jej nie zatrzymają. Jeśli jednak zatrzymają — sondę wprowadzamy przez GitHub Contents
  API, nigdy przez obejście hooka
- Sprawdzone, że przebieg wystartował z powodu filtra `paths`, a nie mimo niego

---

## Phase 4: Szkielet promptfoo — provider, cennik, cache. Zero wywołań modelu

### Overview

Zbudować i przetestować całą mechanikę zestawu na stubie, zanim wyda się pierwszego centa.

### Changes Required:

#### 1. Narzędzie

**File**: `agents/review/package.json`

**Intent**: promptfoo jako `devDependency` PAKIETU AGENTA — jeden lock, jedna ścieżka
rozwiązywania, zgodnie z granicą `agents/**`. Plus skrypt `eval`.

**Contract**: `promptfoo` w `devDependencies`, skrypt uruchamiający `promptfoo eval` na konfiguracji
z `evals/`. Konsekwencja do zmierzenia w tej fazie: composite action robi `npm ci` z devDeps (bo
`tsx` jest devDependency), więc każdy przebieg review na PR-ze zainstaluje też promptfoo.

**Pomiar i PRÓG URUCHOMIENIA fallbacku** — bez progu liczba trafia do dokumentu i nikt nigdy nie
podejmuje decyzji: zmierzyć medianę z trzech `npm ci` w `agents/review` przy ciepłym cache'u npm,
przed dodaniem promptfoo i po. **Jeśli mediana rośnie o ≥ 15 s LUB o ≥ 25% wartości bazowej —
fallback (`tsx` → `dependencies` + `npm ci --omit=dev` w `action.yml`) zostaje otwarty jako OSOBNA
zmiana z własną parą dowodową, przed zarchiwizowaniem tej.** Poniżej obu progów — liczba zostaje
zapisana, a fallback jawnie skreślony, żeby nikt go nie re-litygował.

#### 2. Provider

**File**: `agents/review/evals/provider.ts` (nowy)

**Intent**: pojedyncza klasa, wpinana do macierzy N razy z różnym `label` i `config`, wołająca
`runReview` i zwracająca promptfoo wszystko, czego ten sam nie policzy.

**Contract**: klasa implementująca `ApiProvider`: `constructor(options: ProviderOptions)` odbiera
`options.config` (konstruktorem, NIE przez `context`) z `{ model, maxBudgetUsd }`; `id()` zwraca
etykietę zawierającą model; `callApi(prompt, context)` zwraca
`{ output, tokenUsage, cost, cached, metadata }`. Diff jedzie przez `context.vars`, nie przez
`prompt`. `cost` liczony z tabeli cennika — **NIGDY** z `total_cost_usd`.

**Ścieżka awarii ma własny kontrakt, bo bez niego znika z tabeli.** `runReview` rzuca przy
czterech klasach, a jedna z nich — `[contract]` — jest bezpośrednio jednym z dwóch pytań, na które
ten zestaw istnieje. Rzut wypuszczony z `callApi` sprawia, że promptfoo oznacza komórkę jako błąd
PROVIDERA i asercji nie wykonuje wcale: regresja kontraktu wyjścia wygląda wtedy jak awaria
infrastruktury i nie da się jej odróżnić od padniętej sieci. Dlatego `callApi` **łapie** rzut,
wyciąga `FailureKind` (ta sama wartość, którą `runReview` już zaklasyfikowało — nie parsowana
z tekstu ponownie), wkłada ją do `metadata` i zwraca promptfoo `{ error }` z tą klasą w treści.
Komórka jest wtedy czerwona i NAZWANA. Domknięciem jest asercja twarda z fazy 5: „odpowiedź nie
niesie `error`" — w odróżnieniu od asercji na kształt kontraktu ta ma realny kierunek czerwony.
To także jedyny sposób, by kryterium fazy 6 „`safeParse` przeszedł w obu (brak rzutu
`[contract]`)" dało się odczytać z raportu, a nie z logu.

**Provider NIE ustawia `ANTHROPIC_*` w ogóle** — robi to `runReview` (faza 2 §1). Nie jest to
uproszczenie, tylko jedyny sposób, żeby eval i CI nie mogły rozjechać się po cichu na endpoincie
i precedencji poświadczeń. Provider czyta klucz wyłącznie po to, by odmówić czytelnie, gdy go
nie ma (kryterium niżej), i nie zapisuje go z powrotem do środowiska.

#### 3. Cennik

**File**: `agents/review/evals/pricing.ts` (nowy)

**Intent**: statyczne, deterministyczne źródło stawek — bo `total_cost_usd` z SDK odpadło
definitywnie (myli się 14× dla gemini, 5× dla haiku), a odczyt sieciowy czyniłby przebieg
nieodtwarzalnym.

**Contract**: mapa `model → { inputPerM, outputPerM, cacheWritePerM, cacheReadPerM }`, obok niej
`PRICING_AS_OF` (data) i `PRICING_SOURCE` (URL cennika), oraz funkcja licząca koszt komórki
z `ReviewMetrics`. **Wiek cennika jest wypisywany w raporcie przejścia obok kwot** — nie
automatyzujemy odświeżania; chodzi o to, żeby czytelnik widział „cennik z 2026-08-22" obok liczby
i sam ocenił, czy jej ufa. Cicha nieaktualność przestaje wtedy być cicha, a to wystarcza.
Poprawność metody jest już potwierdzona: rekonstrukcja z cennika trafiła w rachunek (gemini 0,026
wobec 0,032; haiku 0,083 wobec 0,085).

#### 4. Cache

**File**: `agents/review/evals/cache.ts` (nowy)

**Intent**: darmowe powtórzenie, którego promptfoo dla customowego providera JS nie da — jego cache
dostają tylko wywołania przez `fetchWithCache` albo provider deklarujący `cached: true` sam.

**Contract**: klucz z `(hash fikstury, model, hash SYSTEM_PROMPT + JSON Schema)`. **Nonce
z definicji poza kluczem.** Dostęp przez `getCache()`; `isCacheEnabled()` respektowane, więc
`--no-cache` działa; trafienie zwraca odpowiedź z `cached: true`.

#### 5. Test cache'u — dwa kierunki i kontrola pozytywna

**File**: `agents/review/evals/cache.test.ts` (nowy)

**Intent**: udowodnić nie tylko, że oszczędność działa, ale przede wszystkim że unieważnienie
działa. To jest test najgroźniejszej klasy błędu w całym zestawie.

**Contract**: (i) ten sam materiał i ten sam prompt → TRAFIENIE, stub `query` nie został wywołany;
(ii) zmieniony `SYSTEM_PROMPT` → PUDŁO, stub `query` wywołany. Przypadek (ii) jest ważniejszy
i dostaje **kontrolę pozytywną**: wariant funkcji klucza pomijający hash promptu musi wywołać
CZERWIEŃ przypadku (ii). Probe wykonywany realnie i jego wynik zapisywany — nie komentarz „można
by sprawdzić". Bez tego pilnujemy cache'u testem, który przechodzi także dla klucza
niezawierającego promptu, a wtedy zmiana taka jak `0d3eba5` zostałaby zaserwowana ze starego
wyniku.

### Success Criteria:

#### Automated Verification:

- `npm --prefix agents/review run typecheck` — zielone, z nowymi plikami w zakresie
- `npm --prefix agents/review run test` — testy cache'u zielone
- Uruchomienie zestawu bez `ANTHROPIC_AUTH_TOKEN` kończy się czytelną odmową, nie próbą wywołania
- Nowy workflow `agents-gate.yml` zielony na PR-ze z tymi plikami

#### Manual Verification:

- Probe mutacyjny wykonany: klucz bez hasha promptu → przypadek (ii) czerwony. Wynik zapisany
- Mediana `npm ci` przed i po dodaniu promptfoo zmierzona (3 przebiegi, ciepły cache npm), liczba
  wpisana obok progu, decyzja o fallbacku podjęta i zapisana — TAK albo NIE, nie „do rozważenia"
- Potwierdzone, że w tej fazie nie padło ani jedno wywołanie modelu (zużycie klucza
  `OPENROUTER_REVIEW_KEY` niezmienione: odczyt `/api/v1/key` przed fazą i po)

---

## Phase 5: Fikstury, macierz i asercje

### Overview

Złożyć macierz 2×2 i zdefiniować, co czyni komórkę zieloną — nadal bez wydawania pieniędzy.

### Changes Required:

#### 1. Fikstura slotu 1 — bez zmian

**File**: `agents/review/sample.diff` — **NIE modyfikujemy**

**Intent**: wchodzi jako slot 1, a plan ma zapisać, **czym ta komórka JEST**, żeby nikt jej później
nie przecenił: to jest bramka regresji na „agent nadal widzi ten diff jako zły", a **nie** test
wykrywania połkniętego błędu. Klasy defektów z `requirements.md` (`appendFileSync` poza
`try/catch`, dopasowanie po podciągu w miejscu fail-closed, `wrapDiff` przepisujący materiał)
wchodzą dopiero drugim slotem, po pierwszym zmierzonym przejściu.

**Contract**: powód wyboru jest jeden i też ma być zapisany — to JEDYNY materiał, na którym
wszystkie trzy modele są już zmierzone po `0d3eba5` (werdykt `fail`, `swallowedError` liczba,
`gateIntegrity` `null`). Asercje piszemy na zmierzonym, nie na przewidywanym; inaczej pierwsza
czerwień będzie dwuznaczna, a przy ~0,50 USD nie ma z czego płacić za rozstrzyganie tej
dwuznaczności.

#### 2. Fikstura slotu 2 — kontrola negatywna

**File**: `agents/review/evals/fixtures/clean-text-change.diff` (nowy)

**Intent**: czysta zmiana, która MUSI przejść na zielono. Bez niej agent odpowiadający zawsze
„fail" zalicza cały zestaw, a zestaw mierzy skłonność do czerwieni, nie wykrywanie.

**Contract**: kilkanaście linii, wyłącznie zmiany tekstowe — copy UI w pliku `.astro` plus akapit
w `README.md`. Tekstowość jest WARUNKIEM POPRAWNOŚCI, nie wygodą: definicja „nie dotyczy" dla
kryterium 7 wymienia wprost zmianę wyłącznie w treści UI lub dokumentacji, więc tylko przy takim
materiale `null` jest legalny, a nie ratunkiem. **Materiał z `verification.md` nie istnieje jako
plik** — przenosimy KONTRAKT (dwie zmiany tekstowe, werdykt `pass`, kryteria 7 i 8 równe `null`),
nie treść.

#### 3. Konfiguracja macierzy

**File**: `agents/review/evals/promptfooconfig.yaml` (nowy)

**Intent**: iloczyn 2 providerów × 2 testów w jednym przebiegu z tabelą per komórka — to jest
jedyna rzecz, którą promptfoo daje nam realnie i której harness vitestowy nie umie bez dwóch
dispatchy i ręcznego diffowania logów.

**Contract**: ten sam plik providera wpięty dwa razy z różnym `label` i `config.model`
(`anthropic/claude-haiku-4.5`, `google/gemini-2.5-flash`); `config.maxBudgetUsd: 0.60` jako
bezpiecznik, nie bramka kosztowa; dwa testy z fiksturami przez `vars`.

#### 4. Asercje dwupoziomowe

**File**: `agents/review/evals/assertions.ts` (nowy)

**Intent**: bramkować to, co zmierzono jako stabilne, i raportować to, co zmierzono jako rozrzucone.

**Zanim cokolwiek napiszesz — dwie asercje, które SAME SIĘ PROSZĄ i są TAUTOLOGIAMI.** „Komplet
20 pól kontraktu" i „kryteria 7 i 8 typu `number | null`" nie mogą zaświecić na czerwono dla
żadnej wartości, jaką provider jest w stanie zwrócić: `runReview` oddaje wynik WYŁĄCZNIE po
udanym `REVIEW_SCHEMA.safeParse` (`review.ts:242-246`), a schemat wymaga wszystkich 20 pól — zero
`.optional()` i zero `.passthrough()` w całym `review-schema.ts`, a kryteria warunkowe to dokładnie
`z.number().nullable()` (`:214-220`). Asercja na nich powtarza to, co safeParse już wymusił. To ta
sama pułapka, co `is-json` niżej, tylko lepiej ukryta, i dotyczy jej ta sama reguła:
`lessons.md:196` — bramka, która nie potrafi zaświecić na czerwono, jest gorsza niż jej brak, bo
zdejmuje czujność.

**Contract**: **TWARDE** (decydują o zieleni), wszystkie jako `javascript` nad
`context.providerResponse` — więc deterministyczne i darmowe. Każda z nich pilnuje czegoś, czego
`safeParse` NIE gwarantuje:

- **odpowiedź nie niesie `error`** — czyli `runReview` nie rzuciło (faza 4 §2). Jedyna asercja
  w tym zestawie, która potrafi odróżnić „agent ocenił źle" od „agent w ogóle nie dojechał";
- `verdict` zgodny z oczekiwanym dla fikstury (`fail` dla slotu 1, `pass` dla slotu 2);
- **każda z dziewięciu ocen mieści się w 1..10, gdy nie jest `null`** — schemat tego NIE wymusza
  i mówi o tym wprost (`review-schema.ts:211-213`: structured output Anthropica odrzuca
  `minimum`/`maximum` na typie liczbowym, więc zakres trzyma wyłącznie OPIS pola). To jedyne
  miejsce, gdzie zakres da się w ogóle egzekwować; wartości progowe brać z `SCORE_MIN`/`SCORE_MAX`
  (`scripts/review-verdict.ts:32-33`), nie z literałów;
- `scopeDiscipline !== null` — kryterium 9 jest bezwarunkowe (`review-schema.ts:188`: „nigdy nie
  zwracaj tu null"), a schemat i tak dopuszcza `null` na każdej ocenie, więc tę regułę trzyma
  wyłącznie prompt i wyłącznie ta asercja;
- **każde z dziewięciu uzasadnień jest niepuste po `trim()`** — `z.string()` przepuszcza `""`;
- dla slotu 1: `swallowedError` jest LICZBĄ przy `gateIntegrity === null` — czyli dokładnie ta
  para, którą naprawiał `0d3eba5`, i jedyna rzecz w tym zestawie, która realnie pilnuje
  wykrywania klasy błędu na tej fiksturze.

**MIĘKKIE** (tylko do tabeli, nie bramkują): konkretne wartości ocen.

Uzasadnienie podziału jest zmierzone, nie estetyczne: na TEJ SAMEJ fiksturze `scopeDiscipline`
wyszło 9 / 3 / 8, a `complexity` 3 / 2 / 7 — asercja na wartości oceny byłaby flaky między
modelami; kontrakt i werdykt były stabilne w KAŻDYM zmierzonym przebiegu. **Kryterium 9
(`scopeDiscipline`) NIE jest warunkowe** (`review-schema.ts:188`: „nigdy nie zwracaj tu null"),
więc asercja `=== null` na nim byłaby sprzeczna ze schematem.

Uwaga na naturalny odruch: `is-json` na wyjściu obiektowym jest TAUTOLOGIĄ (obiekt jest wcześniej
serializowany), więc kontrakt sprawdza się asercją `javascript`, nie typem wbudowanym.

Dla slotu 2 w TEJ fazie asercji `=== null` jeszcze NIE MA — wchodzi po fazie 6.

#### 5. Kontrola pozytywna asercji — jedna mutacja na asercję

**File**: `agents/review/evals/assertions.test.ts` (nowy)

**Intent**: dowieść, że NOWY zestaw asercji umie zaświecić na czerwono. Bez tego powtarzamy ten
sam błąd o poziom wyżej: wymieniamy bramkę, której nie da się zaświecić, na bramkę, o której nie
wiadomo, czy da się zaświecić. To, że asercja brzmi mocniej, nie jest dowodem — a dowód jest tu
darmowy i offline.

**Contract**: `node:test`; wejściem jest jeden zamrożony, POPRAWNY obiekt `Review` (wzięty
z zapisanych wyjść Pomiaru II), na którym wszystkie asercje twarde muszą przechodzić — to jest
kontrola negatywna zestawu. Potem po jednej mutacji na asercję, każda w osobnym przypadku, każda
zmieniająca DOKŁADNIE JEDNO pole, i każda musząca wywalić DOKŁADNIE TĘ asercję, której dotyczy:

- `verdict` odwrócony (`fail` ↔ `pass`);
- jedna ocena ustawiona na `42` (i osobno na `0`) — pilnuje zakresu 1..10;
- `scopeDiscipline` ustawione na `null`;
- jedno uzasadnienie ustawione na `"   "` — pilnuje `trim()`, a nie samej obecności pola;
- odpowiedź z `error` zamiast obiektu (kształt, który provider zwraca po złapaniu rzutu);
- dla slotu 1: `gateIntegrity` ustawione na liczbę przy `swallowedError` pozostawionym liczbą —
  czyli mutacja odwrotna do naprawy `0d3eba5`.

Warunek, który czyni to kontrolą, a nie zbiorem czerwieni: mutacja ma czerwienić **swoją** asercję
i **tylko** ją. Jeśli jedna mutacja wywala dwie asercje, to znaczy, że jedna z nich pilnuje czegoś
innego, niż deklaruje — i to jest wynik do zapisania, nie do obejścia.

Zero wywołań modelu, zero kosztu: test operuje na obiekcie, nie na przebiegu.

#### 6. Raport przejścia

**File**: `agents/review/evals/report.ts` (nowy)

**Intent**: wymaganie 9 — bez kosztu per komórka reżim kosztowy jest życzeniem, nie bramką.

**Contract**: tabela per komórka (model, fikstura, werdykt, kontrakt, tokeny, koszt, trafienie
cache'u) plus suma przejścia plus **wiek cennika**. Kwoty liczone z tokenów × tabela z `pricing.ts`.

### Success Criteria:

#### Automated Verification:

- `npm --prefix agents/review run typecheck` i `test` — zielone
- Przebieg zestawu z wymuszonym trafieniem cache'u (zaseedowanym w teście) renderuje pełną tabelę
  bez ani jednego wywołania modelu
- Asercje przepuszczone przez zapisane wyjścia z `measurement-cheap-models.md` (trzy zestawy ocen
  z Pomiaru II) — wszystkie twarde przechodzą
- `assertions.test.ts` zielony: obiekt niezmutowany przechodzi wszystkie asercje twarde, a KAŻDA
  mutacja czerwieni dokładnie tę asercję, której dotyczy, i tylko ją

#### Manual Verification:

- Kontrola negatywna przeczytana jako diff: potwierdzone, że nie zawiera NICZEGO poza tekstem —
  żadnego warunku, żadnej obsługi błędu, żadnego sprawdzenia
- Potwierdzone, że zużycie klucza nadal niezmienione

---

## Phase 6: Pomiar kontroli negatywnej

### Overview

Zmierzyć najtrudniejszy przypadek naprawy `0d3eba5` — fiksturę, na której model ma dwa razy z rzędu
powiedzieć „nie dotyczy". To właśnie tam najbardziej kusi go wystawienie dziesiątek, a
`measurement-cheap-models.md` potwierdził naprawę wyłącznie na materiale, gdzie kryteria 7 i 8
wypadły w PRZECIWNE strony — czyli w przypadku najłatwiejszym.

### Changes Required:

#### 1. Przebieg pomiarowy

**File**: `context/changes/code-review-evals/measurement-negative-control.md` (nowy)

**Intent**: dwa przebiegi (haiku, gemini) na kontroli negatywnej, zimny cache, lokalnie; zapis
w układzie Pomiaru II i z realnym rachunkiem z różnicy odczytów `/api/v1/key`.

**Przebiegi idą przez `npm --prefix agents/review run eval` zawężone do kontroli negatywnej — NIE
przez CLI**, i to jest warunek, na którym stoi budżet fazy 7: tylko wtedy wyniki lądują w cache'u
zestawu i dwie komórki slotu 2 wchodzą tam jako TRAFIENIA. Powtórzenie Pomiaru II dosłownie
(`git diff | npm run review`) zostawia cache pusty i faza 7 płaci ~0,12 USD ponad plan.
Konsekwencja formatu: linii `[metryki]` tu NIE BĘDZIE — drukuje ją wrapper CLI, a przez providera
metryki wracają jako dane. Do notatki idzie WIERSZ RAPORTU z fazy 5 (model, fikstura, werdykt,
kontrakt, tokeny, koszt, trafienie cache'u), nie linia stderr.

**Contract**: dla każdego modelu zapisać: czy `structured_output` przyszedł, czy `safeParse`
przeszedł, `verdict`, pełny zestaw dziewięciu ocen, wartości kryteriów 7 i 8, linię metryk i koszt.
Oczekiwanie z kontraktu: `verdict: pass`, oba kryteria warunkowe `null`. **Wynik inny niż
oczekiwany jest POMIAREM, nie regresją** — i uruchamia decyzję opisaną niżej, a nie poprawkę
odruchową.

#### 2. Domknięcie asercji

**File**: `agents/review/evals/assertions.ts`

**Intent**: dopiero po zobaczeniu liczb asercja `=== null` na obu kryteriach warunkowych dla slotu 2
staje się bramką.

**Contract**: jeśli oba modele dotrzymały kontraktu — asercja twarda `swallowedError === null`
oraz `gateIntegrity === null` dla kontroli negatywnej. Jeśli któryś wystawił liczbę — decyzja jest
binarna i ma być zapisana z uzasadnieniem: **poprawka promptu** (jak `0d3eba5`; wtedy cache się
unieważnia i faza 7 płaci pełną stawkę — na to idzie rezerwa) albo **zniesienie różnicy asercją**
(wtedy zapisać, co dokładnie przestaje być bramkowane i dlaczego to jeszcze jest bramka).

> **⛑ KOREKTA PO POMIARZE** (2026-08-23). Pomiar wyprodukował trzecią możliwość, której ten
> akapit nie przewidział, i to ona została wybrana — **wariant C: obserwacja MIĘKKA**
> (`conditional-null-contract` w `evals/assertions.ts`), raportowana w każdym przejściu
> i NIEBRAMKUJĄCA. Powodem jest to, czego „binarne” ujęcie nie obejmowało: haiku ODRZUCIŁO samą
> regułę, a nie pomyliło się co do materiału, więc asercja twarda czerwieniłaby każde przejście
> na stanie ZMIERZONYM i świadomie nienaprawionym — a wtedy czerwień przestaje odróżniać NOWĄ
> regresję od ZNANEGO stanu. Zniesienie różnicy asercją (druga opcja wyżej) skasowałoby przy tym
> sam sygnał; obserwacja miękka go zachowuje.
>
> Pełne uzasadnienie i **warunek awansu na asercję twardą** — sformułowany jako PYTANIE DO
> POMIARU, nie jako zadanie — leżą w sekcji „Open Risks”, ryzyko nr 3. Zapis pomiaru:
> `measurement-negative-control.md`; zapis decyzji: `verification.md`, faza 6.
>
> Akapit powyżej zostaje NIEZMIENIONY, bo taki był stan wiedzy przed pomiarem — korekta stoi
> obok niego, nie zamiast niego.

### Success Criteria:

#### Automated Verification:

- Oba przebiegi kończą się `terminal_reason: completed` (a nie `error_max_budget_usd` — cap 0,60
  leży powyżej najgorszego zimnego przebiegu 0,4530)
- `safeParse` przeszedł w obu (brak rzutu `[contract]`)

#### Manual Verification:

- Notatka pomiarowa napisana i zawiera realny rachunek z `/api/v1/key`, nie `total_cost_usd`, oraz wiersz raportu z fazy 5 zamiast linii `[metryki]`
- Decyzja o asercji `=== null` podjęta i uzasadniona w notatce
- Wydatek zsumowany i porównany z rezerwą; przekroczenie ~0,15 USD oznacza ZATRZYMANIE i rozmowę,
  zgodnie z wymaganiem 1, nie dopłatę

---

## Phase 7: Pierwsze pełne przejście macierzy 2×2

### Overview

Przejechać macierz i zapisać liczby, o które pyta wymaganie 9.

### Changes Required:

#### 1. Przejście

**Intent**: 2 modele × 2 fikstury. Dwie komórki kontroli negatywnej wchodzą jako TRAFIENIA
cache'u z fazy 6 (ten sam materiał, ten sam model, niezmieniony prompt), więc realnie płacimy tylko
za dwie komórki `sample.diff`.

**Contract**: tabela per komórka z werdyktem, kontraktem, tokenami, kosztem i wiekiem cennika; suma
przejścia. Warunek zaliczenia: cztery komórki zielone na asercjach twardych.

#### 2. Zapis liczb do notatek zmiany

**File**: `context/changes/code-review-evals/requirements.md`

**Intent**: dopisać zmierzony koszt PRZEJŚCIA (dotąd zmierzone były tylko komórki) w tej samej
formie co dotychczasowe korekty — jako blok `⚑ KOREKTA PO POMIARZE`, nie przez przepisywanie
wcześniejszych szacunków.

**Contract**: zmierzony koszt przejścia, faktyczny udział trafień cache'u, stan budżetu po
zadaniu, zużycie klucza `OPENROUTER_REVIEW_KEY`.

#### 3. Dług zapisany jawnie

**File**: `context/changes/code-review-evals/change.md` (plus notatka zamykająca zmianę)

**Intent**: zapisać, czego ten plan NIE dowiódł, z nazwą i warunkiem zamknięcia — bo bez tego za
miesiąc przeczytamy zielony plan i uznamy, że workflow działa.

**Contract**: dosłownie: **workflow evali nie został ani razu uruchomiony, więc jest gwarancją
nieprzetestowaną — dokładnie tą klasą, którą archiwum zapisało przy `concurrency` w `eval.yml`
jako „never contended".** Warunek zamknięcia: osobna zmiana, która dodaje workflow evali wzorem
`.github/workflows/eval.yml` (`workflow_dispatch` jako JEDYNY wyzwalacz, sekret na KROK a nie na
job, `concurrency` na samym workflow, artefakt z pełnym zapisem, `sed` wycinający klucz przed
uploadem, żadnego `schedule:`, `needs:` ani required check) **i odpala go RAZ, na dowód**.

#### 4. Domknięcie zmiany

**File**: `context/changes/code-review-evals/change.md`

**Contract**: `status` i `updated` zaktualizowane.

### Success Criteria:

#### Automated Verification:

- Przejście macierzy: cztery komórki, wszystkie asercje twarde zielone
- Powtórzenie tego samego przejścia bez zmiany promptu jest DARMOWE (cztery trafienia cache'u,
  zużycie klucza niezmienione) — to jest weryfikacja wymagania 6 na żywym przebiegu
- `npm --prefix agents/review run typecheck` i `test` zielone; `agents-gate.yml` zielony

#### Manual Verification:

- Tabela kosztów przeczytana: wiek cennika widoczny obok kwot
- Suma wszystkich wydatków tego zadania (pomiary I, II, fazy 6-7) policzona i poniżej 1 USD
- Dług workflow evali zapisany dosłownie, z warunkiem zamknięcia
- `pr-review.yml` i composite action potwierdzone jako nietknięte przez cały plan (`git diff`
  względem punktu startowego po stronie `.github/actions/**` i `.github/workflows/pr-review.yml`
  jest pusty)

---

## Testing Strategy

### Unit Tests:

- **Siatka charakteryzująca** (`review-cli.test.ts`) — cztery ścieżki CLI niedochodzące do modelu;
  pinuje treść stderr, kody wyjścia, zawartość `$GITHUB_OUTPUT` i KOLEJNOŚĆ efektów
- **Powierzchnia `runReview`** (`run-review.test.ts`) — sukces plus cztery klasy awarii na
  wstrzykniętym stubie `query`; każda klasa asertuje prefiks `[kind]` w komunikacie ORAZ zapis
  `failure-kind=` do podstawionego `$GITHUB_OUTPUT` (i jego brak, gdy zmiennej nie ma). To jest
  jedyne pokrycie ścieżki awarii w całym planie — siatka procesowa z fazy 1 z definicji jej
  nie dosięga
- **Asercje zestawu** (`assertions.test.ts`) — obiekt niezmutowany zielony, plus jedna mutacja
  na asercję twardą; każda musi zaczerwienić dokładnie swoją asercję i tylko ją
- **Cache** (`cache.test.ts`) — trafienie przy niezmienionym promptcie, PUDŁO przy zmienionym,
  plus probe mutacyjny jako kontrola pozytywna kierunku ważniejszego
- **Cennik** — każdy model z macierzy ma wpis; `PRICING_AS_OF` i `PRICING_SOURCE` obecne

Wszystkie pod `node:test` w pakiecie agenta — nigdy pod vitestem. `agents/**` jest świadomie poza
tsconfigiem, ESLintem i vitestem aplikacji; wciągnięcie tych testów do `npm test` skasowałoby tę
granicę, a `vitest.config.ts` i tak przerwałby je w preflighcie dla braku lokalnego Supabase.

### Integration Tests:

- Przejście macierzy na zaseedowanym cache'u — pełna tabela bez wywołania modelu (faza 5)
- Przejście macierzy na żywo — cztery komórki (fazy 6-7)
- Powtórzenie przejścia — cztery trafienia, zero wydatku

### Manual Testing Steps:

1. Odczytać `/api/v1/key` przed fazą 4 i po niej — zużycie musi być IDENTYCZNE (dowód, że szkielet
   nie woła modelu)
2. Wykonać probe mutacyjny cache'u i potwierdzić czerwień
3. Wypchnąć commit z celowym błędem typów w `agents/review/evals/`, potwierdzić czerwony przebieg
   `agents-gate.yml`, poprawić, potwierdzić zielony; zapisać oba numery
4. Po fazie 7 przeczytać tabelę i sprawdzić, czy wiek cennika jest widoczny obok kwot

## Performance Considerations

Jedyny wymiar wydajności, który tu ma znaczenie, to **czas instalacji pakietu agenta na
produkcyjnej ścieżce CI**. Dodanie promptfoo i `typescript` do devDeps agenta wydłuża `npm ci`
w composite action, który już dziś jest najwolniejszym krokiem review (~335 MB). Faza 4 mierzy tę
różnicę i ma zapisany PRÓG uruchomienia fallbacku (≥ 15 s mediany lub ≥ 25%), żeby liczba
prowadziła do decyzji, a nie tylko do dokumentu.

Czas samego przejścia evali nie jest optymalizowany: zmierzone przebiegi to 22-67 s na komórkę,
przy czterech komórkach i cache'u dla powtórzeń to nie jest wąskie gardło niczego.

## Migration Notes

Brak migracji danych. Jedyna rzecz o charakterze migracyjnym: **`agents/review/package-lock.json`
zmienia się w fazach 3 i 4**, a `action.yml:113-117` cachuje po tym właśnie locku. Pierwszy przebieg
review po merge'u odbuduje cache — jednorazowy koszt, świadomy.

Odwracalność: fazy 1-2 są odwracalne czystym `git revert` (composite action ich nie widzi). Faza 3
dokłada plik workflow — usunięcie go przywraca stan sprzed. Fazy 4-7 żyją w nowym katalogu
`agents/review/evals/` i w devDeps.

## Open Risks

Ryzyka OTWARTE, nazwane, z warunkiem zamknięcia. Nie są to „rzeczy do rozważenia": każde ma
zapisane, co dokładnie musi się wydarzyć, żeby przestało być ryzykiem — bo komentarz w kodzie bez
takiego warunku starzeje się cicho, a to jest dokładnie ta klasa, o którą rozbił się destylat
promptu w poprzedniej zmianie.

### 1. `SCORE_MIN`/`SCORE_MAX` istnieją w DWÓCH miejscach i nic nie pilnuje ich zgodności

Skala ocen jest zadeklarowana niezależnie w `agents/review/review-schema.ts` (dla asercji zestawu)
i w `scripts/review-verdict.ts:32-33` (dla werdyktu na PR-ze). Powód jest twardy: granica
`agents/**` zakazuje importu W OBIE STRONY — `scripts/` czyta z agenta DANE (`criteria.json`),
nigdy kodu, a import przez tę granicę odebrałby agentowi przenośność, która jest powodem, dla
którego w ogóle budujemy własnego agenta.

**Czym to grozi:** rozjazd jest CICHY w obie strony. Podniesienie skali po stronie agenta bez
poprawki w `scripts/` daje eval przepuszczający ocenę, którą renderer werdyktu odrzuci jako „poza
skalą" — i odwrotnie: obniżenie po stronie `scripts/` zwęża bramkę PR-a, o czym zestaw evali nigdy
się nie dowie. Żaden test tego dziś nie łapie.

**Warunek zamknięcia:** przeniesienie skali do `criteria.json` (jedno źródło, kierunek agent →
`scripts/` jako DANE, ten sam wzorzec co lista kryteriów), OSOBNĄ zmianą, z regeneracją przez
`npm --prefix agents/review run criteria`.

**Dlaczego nie tutaj:** kształt `criteria.json` jest bramkowany przez `git diff --exit-code`
w composite action, czyli leży na PRODUKCYJNEJ ścieżce CI. Ruszenie go w zmianie o zupełnie innym
celu to kryterium 9 (dyscyplina zakresu) użyte przeciwko nam.

### 2. Cache promptfoo to JEDEN plik i dwa równoległe przebiegi kasują sobie wpisy

Zmierzone przy pisaniu fazy 5, nie założone: `getCacheInstance` w promptfoo trzyma cały cache
w pojedynczym `cache.json` przez `KeyvFile`, który wczytuje mapę do pamięci i zapisuje ją w
CAŁOŚCI. Dwa procesy piszące równolegle nadpisują sobie wpisy — przypadek (B) w
`evals/report.test.ts` był zielony uruchomiony sam i czerwony (cztery PUDŁA) w komplecie
`npm run test`, gdzie `node --test` biegnie równolegle z `cache.test.ts`.

**Czym to grozi:** wyścig objawia się jako PUDŁO cache'u, czyli jako WYDATEK — dwa przebiegi evali
odpalone naraz zapłacą za komórki, które miały być darmowe. Nie objawia się jako awaria, więc nikt
go nie zauważy poza rachunkiem.

**Warunek zamknięcia:** odłożony workflow evali (patrz faza 7 §3) musi mieć `concurrency` na samym
workflow ALBO nadawać każdemu przebiegowi własny `PROMPTFOO_CACHE_PATH`. Do tego czasu obowiązuje
zasada operacyjna: przebiegi evali idą SEKWENCYJNIE.

### 3. Kontrakt `null` nie jest bramkowany, bo model go ODRZUCA — a nie dlatego, że go nie zna

Zmierzone w fazie 6 (`measurement-negative-control.md`): na kontroli negatywnej haiku wystawiło
`swallowedError: 10` i `gateIntegrity: 10` zamiast `null`, z notami mówiącymi WPROST „kryterium nie
dotyczy, **ale ocena 10 oddaje fakt braku ryzyka**". Model rozpoznał materiał poprawnie i odrzucił
samą regułę — mimo że `0d3eba5` dopisał do promptu 27 linii, które nazywają ten ruch BŁĘDEM OCENY.
Ten sam wzorzec widać w `testRiskCoverage: 10` („nie ma zastosowania, więc 10"), czyli nie jest
ograniczony do dwóch kryteriów warunkowych.

Reguła weszła więc jako OBSERWACJA MIĘKKA (`conditional-null-contract` w `evals/assertions.ts`):
raportowana w każdym przejściu, nie bramkująca zieleni. Twarda czerwieniłaby każde przejście na
stanie zmierzonym i świadomie nienaprawionym, a wtedy czerwień przestaje odróżniać NOWĄ regresję od
ZNANEGO stanu.

**Czym to grozi:** ocena tam, gdzie kryterium nie ma zastosowania, zawyża wynik arytmetycznie.
Średnia dziewięciu ocen haiku na czystej zmianie tekstowej wyszła **9,56** — zmiana, która nie
ruszyła żadnej ścieżki zapisu, wypada więc LEPIEJ niż zmiana, która ruszyła ją i obsłużyła
porządnie. Próg 5 z `scripts/review-verdict.ts` jest daleko, więc dziś werdykt się nie zmienia;
kalibracja jest zepsuta dokładnie w kierunku, przed którym broni opis kryterium.

**Warunek zamknięcia — PYTANIE DO POMIARU, nie zadanie do zrobienia:**

> Czy regułę „`null` zamiast oceny tam, gdzie kryterium nie ma zastosowania" da się wyegzekwować
> PROMPTEM u KAŻDEGO modelu-kandydata do tej bramki — czy jest ona własnością MODELU?

Odpowiedź rozstrzyga, co w ogóle jest tu defektem:

- **Da się promptem** → to jest defekt promptu, poprawka wzorem `0d3eba5`, i wtedy obserwacja
  miękka awansuje na asercję twardą.
- **Jest własnością modelu** → **to NIE jest defekt do naprawienia, tylko KRYTERIUM KWALIFIKACJI
  modelu do tej bramki.** Zapisać wtedy trzeba nie „poprawiliśmy prompt", tylko „model X nie
  kwalifikuje się do roli recenzenta, bo nie dotrzymuje kontraktu `null`" — a to jest odpowiedź na
  pytanie 2 z `requirements.md` („czy tańszy model wystarcza"), nie obejście go.

Pomiar, który na to odpowiada: ta sama fikstura kontroli negatywnej × wszyscy kandydaci
(minimum haiku, gemini, sonnet) × prompt bieżący, a przy wyniku negatywnym — × prompt wzmocniony.
Dopóki tego pomiaru nie ma, **żadna z dwóch odpowiedzi nie jest ustalona**, i to jest cała treść
tego ryzyka.

### 4. `maxTurns: 2` nie jest własnością agenta, tylko NIENAZWANYM założeniem o wielkości wejścia

Zmierzone w fazie 6: gemini nie dojechało na kontroli negatywnej — druga próba skończyła się
`error_max_turns` („Reached maximum number of turns (2)"). Sprawdzone osobno, że to NIE jest
regresja ekstrakcji z fazy 2: `git show 0d3eba5:agents/review/review.ts` ma `maxTurns: 2` z tym
samym komentarzem, a `run-review.ts` na HEAD ma tę samą wartość.

**Obserwacja warta więcej niż sam limit:** ten sam limit WYSTARCZA na jednym materiale
(`sample.diff` — gemini kończyło `completed` w Pomiarze II) i NIE WYSTARCZA na drugim (kontrola
negatywna). Czyli `maxTurns: 2` nie opisuje agenta — opisuje ZAŁOŻENIE O WIELKOŚCI I KSZTAŁCIE
WEJŚCIA, którego nigdzie nie nazwano. Komentarz przy tej linii („tura 1: model czyta i ocenia |
tura 2: emituje JSON wg schematu") opisuje ZAMIAR, a nie warunek, przy którym zamiar się spełnia.
Do dziś nikt tego nie zauważył, bo przez ten harness nie przejechał żaden materiał inny niż
`sample.diff`. Zestaw evali odsłonił to pierwszym nowym diffem.

**Czym to grozi:** limit leży na PRODUKCYJNEJ ścieżce review — `run-review.ts` jedzie w CI na
KAŻDYM PR-ze. PR o innym kształcie niż `sample.diff` może dostać `error_max_turns` zamiast
recenzji, a autor zobaczy awarię agenta bez informacji, że to limit, nie model.

**Warunek zamknięcia — PYTANIE DO POMIARU:**

> Przy jakim materiale dwie tury przestają wystarczać, i czy zależność jest od ROZMIARU wejścia,
> czy od czegoś innego (liczby plików, obecności materiału dla kryteriów warunkowych, modelu)?

Podniesienie limitu bez tej odpowiedzi zamienia jedno nienazwane założenie na drugie. A ponieważ
zmiana dotyczy ścieżki produkcyjnej, **domknięcie wymaga PARY DOWODOWEJ na tej właśnie ścieżce**
(czerwień → poprawka → zieleń, oba numery przebiegów zapisane), tak samo jak bramka z fazy 3 —
nie samego lokalnego przebiegu evali.

⚑ Do tego samego pomiaru należy rozbieżność zauważona przy okazji: haiku raportuje `numTurns: 3`
przy `maxTurns: 2` i kończy `completed`, a gemini na tej samej wartości dostaje `error_max_turns`.
Licznik `num_turns` w wyniku SDK i limit `maxTurns` najwyraźniej nie liczą tego samego — a dopóki
nie wiadomo, czego liczą, żadna nowa wartość limitu nie jest wyborem, tylko zgadywaniem.

### Stan budżetu w chwili zatrzymania

| pozycja                                           | kwota            |
| ------------------------------------------------- | ---------------- |
| licznik klucza `OPENROUTER_REVIEW_KEY` po fazie 6 | **0,946899 USD** |
| budżet zadania (`requirements.md`, wymaganie 1)   | **1,00 USD**     |
| **zostaje**                                       | **0,0531 USD**   |
| faza 7 (dwie zimne komórki `sample.diff`)         | **~0,117 USD**   |

**Zadanie zatrzymuje się na PROGU Z WYMAGANIA 1, a nie dlatego, że coś padło.** Fazy 1-6 są
zamknięte i zielone w tym, co obiecywały; faza 7 nie mieści się w budżecie i jej uruchomienie jest
decyzją o podniesieniu budżetu, nie krokiem implementacji. To rozróżnienie ma tu zostać zapisane,
bo za miesiąc „plan zatrzymany na fazie 7" i „plan, któremu coś padło" wyglądają tak samo.

## References

- Wymagania: `context/changes/code-review-evals/requirements.md`
- Badanie: `context/changes/code-review-evals/research.md`
- Pomiar tanich modeli (I i II): `context/changes/code-review-evals/measurement-cheap-models.md`
- Linia bazowa promptu: commit `0d3eba5` — każde porównanie regresyjne musi mieć obie strony po tej
  stronie SHA
- Szew do rozcięcia: `agents/review/review.ts:19,78-91,110-135,137-159,173-194,197-209,211-281,283-288`
- Wzorzec wstrzykiwalnej zależności: `agents/review/prompt.ts:288-299`
- Wzorzec osobnego workflow i jego uzasadnienie: `.github/workflows/prompt-ratchet.yml:1-22,44-62`
- Wywołanie agenta i kontrakty tekstowe, których nie wolno ruszyć: `.github/actions/review-agent/action.yml:113-117,146,188-189`
- Wzorzec workflow dispatchu (dla ODŁOŻONEGO workflow evali): `.github/workflows/eval.yml:28-34,51-69,74-85,99-111,144-162,176-186,247-256`
- Kryteria warunkowe i zakaz `null` na kryterium 9: `agents/review/review-schema.ts:43-190,188`
- Próg werdyktu poza promptem: `scripts/review-verdict.ts:32-35`

## Progress

> Konwencja: `- [ ]` do zrobienia, `- [x]` zrobione. Dopisz ` — <commit sha>`, gdy krok wyląduje.
> Nie zmieniaj tytułów kroków. Patrz `references/progress-format.md`.

### Phase 1: Siatka charakteryzująca — przed jakąkolwiek ekstrakcją

#### Automated

- [x] 1.1 Nowy test przechodzi na niezmienionym `review.ts` — 0e08a09
- [x] 1.2 `prompt.test.ts` nadal 6/6 — 0e08a09
- [x] 1.3 `git diff --stat` pokazuje wyłącznie nowy plik testu — 0e08a09

#### Manual

- [x] 1.4 Każda asercja przeczytana obok `review.ts:78-209` i potwierdzona wobec action/workflow — 0e08a09
- [x] 1.5 Kolejność efektów potwierdzona w pliku (cap → `model=` → klucz → env → stdin) — 0e08a09

### Phase 2: Ekstrakcja `runReview` i cienki wrapper CLI

#### Automated

- [x] 2.1 `review-cli.test.ts` przechodzi bez zmiany ani jednej asercji — bc95229
- [x] 2.2 `run-review.test.ts` przechodzi, z parą asercji (`[kind]` + `failure-kind=`) dla każdej z czterech klas awarii — bc95229
- [x] 2.3 `prompt.test.ts` nadal 6/6 — bc95229
- [x] 2.4 `git diff` po stronie `.github/**` jest pusty — bc95229

#### Manual

- [x] 2.5 Wrapper przeczytany w całości — nie mieści logiki recenzji — bc95229
- [x] 2.6 Potwierdzone, że wrapper nie łapie rzutu z `runReview` (linia `Error:` z unhandled rejection zachowana) — bc95229

### Phase 3: Bramka pakietu agenta (typecheck + testy zależne) w CI

#### Automated

- [x] 3.1 `npm --prefix agents/review run typecheck` zielone lokalnie — 1bbbbe1
- [x] 3.2 `npm --prefix agents/review run test` wykrywa i przechodzi wszystkie pliki testowe pakietu — 1bbbbe1
- [x] 3.3 `agents-gate.yml` zielony na PR-ze — 3b674fd

#### Manual

- [x] 3.4 Para dowodowa na ścieżce CI: czerwień → poprawka → zieleń, oba numery przebiegów zapisane — 3b674fd
- [x] 3.5 Potwierdzone, że sondę da się wypchnąć zwykłym gitem, bez `--no-verify` — 3b674fd
- [x] 3.6 Potwierdzone, że przebieg wystartował z powodu filtra `paths`, a nie mimo niego — 3b674fd

### Phase 4: Szkielet promptfoo — provider, cennik, cache. Zero wywołań modelu

#### Automated

- [x] 4.1 `typecheck` zielony z nowymi plikami w zakresie — 1b311ce
- [x] 4.2 Testy cache'u zielone — 1b311ce
- [x] 4.3 Uruchomienie bez klucza kończy się czytelną odmową, nie próbą wywołania — 1b311ce
- [x] 4.4 `agents-gate.yml` zielony na PR-ze z tymi plikami — 84c3257

#### Manual

- [x] 4.5 Probe mutacyjny wykonany: klucz bez hasha promptu → przypadek (ii) czerwony, wynik zapisany — 1b311ce
- [x] 4.6 Mediana `npm ci` przed/po zmierzona, liczba wpisana obok progu, decyzja o fallbacku podjęta — 1b311ce
- [x] 4.7 Zużycie klucza niezmienione (odczyt `/api/v1/key` przed fazą i po) — 1b311ce

### Phase 5: Fikstury, macierz i asercje

#### Automated

- [x] 5.1 `typecheck` i `test` zielone — 8b0f3fe
- [x] 5.2 Przejście na zaseedowanym cache'u renderuje pełną tabelę bez wywołania modelu — 8b0f3fe
- [x] 5.3 Asercje twarde przechodzą na trzech zapisanych zestawach ocen z Pomiaru II — 8b0f3fe
- [x] 5.4 `assertions.test.ts` zielony: każda mutacja czerwieni dokładnie swoją asercję i tylko ją — 8b0f3fe

#### Manual

- [x] 5.5 Kontrola negatywna przeczytana jako diff — wyłącznie tekst, zero konstrukcji — 8b0f3fe
- [x] 5.6 Zużycie klucza nadal niezmienione — 8b0f3fe

### Phase 6: Pomiar kontroli negatywnej

#### Automated

- [ ] 6.1 Oba przebiegi kończą się `terminal_reason: completed`
- [ ] 6.2 `safeParse` przeszedł w obu (brak rzutu `[contract]`)

#### Manual

- [x] 6.3 Notatka pomiarowa zawiera realny rachunek z `/api/v1/key`, nie `total_cost_usd` — ee894b7
- [x] 6.4 Decyzja o asercji `=== null` podjęta i uzasadniona — ee894b7
- [x] 6.5 Wydatek zsumowany; przekroczenie rezerwy = zatrzymanie i rozmowa, nie dopłata — ee894b7

### Phase 7: Pierwsze pełne przejście macierzy 2×2

#### Automated

- [ ] 7.1 Cztery komórki, wszystkie asercje twarde zielone
- [ ] 7.2 Powtórzenie przejścia darmowe (cztery trafienia, zużycie klucza niezmienione)
- [x] 7.3 `typecheck`, `test` i `agents-gate.yml` zielone — 74346b0 (przebieg 32637270773, TAP `1..70`)

#### Manual

- [x] 7.4 Tabela kosztów przeczytana, wiek cennika widoczny obok kwot — b83f8f7
- [ ] 7.5 Suma wydatków całego zadania policzona i poniżej 1 USD
- [x] 7.6 Dług workflow evali zapisany dosłownie, z warunkiem zamknięcia — b83f8f7
- [x] 7.7 `pr-review.yml` i composite action potwierdzone jako nietknięte — b83f8f7
