# Bramka regresji na zmianach promptu agenta review — Implementation Plan

## Overview

Zapadka na DOWODZIE: krok CI, który sprawdza, czy w drzewie leży aktualny wynik ręcznego przejścia
macierzy evali, zgodny z tym, co dziś naprawdę jedzie do modelu. Macierz odpala człowiek, ręcznie,
za pieniądze; CI nie woła modelu ani razu i nie ma do tego klucza.

Dowód niesie **dwa odciski o rozłącznych remediach**: `callFingerprint` (hash czterech osi
wywołania — remedium PŁATNE, przejście macierzy) i `verdictConfig` (trzy jawne liczby warstwy
interpretacji — remedium DARMOWE, przepisanie wartości). Rozdzielenie ich jest treścią decyzji D-2
niżej, a nie ozdobą: zlanie w jeden odcisk kazałoby kupować przejście macierzy za ~0,12 USD po to,
żeby udowodnić coś, o czym macierz nic nie mówi.

## Current State Analysis

**Zestaw istnieje i jest zmierzony.** Macierz 2×2 (`haiku-4.5`, `gemini-2.5-flash` × `sample.diff`,
`clean-text-change.diff`) z asercjami deterministycznymi, własnym cache'em w providerze i rachunkiem
per komórka. Uruchamiana wyłącznie ręcznie: `npm --prefix agents/review run eval`
(`agents/review/package.json:11` → `evals/report.ts`).

**Nic go nie egzekwuje.** Sześć workflow (`agents-gate`, `ci`, `eval`, `pr-review`, `prompt-ratchet`,
`schema-diff`) i żaden nie uruchamia zestawu ani nie odwołuje się do niego jako do warunku. Zmiana
`SYSTEM_PROMPT` wchodzi dziś na `main` bez jednego pomiaru — klasa, która raz już się zmaterializowała
(`0d3eba5` naprawiał kontrakt `null`, a faza 7 poprzedniej zmiany złapała na gemini regresję,
której nikt by inaczej nie zobaczył).

**Odcisk, na którym ta zapadka stanie, już istnieje.** `productionPromptFingerprint()`
(`agents/review/evals/provider.ts:169-176`) liczy `sha256` z czterech WARTOŚCI faktycznie wysyłanych
do `query(...)`, nie z listy ścieżek — więc z definicji nie jest ręcznie utrzymywaną listą i nie może
się zestarzeć przez przeoczenie pliku. Wartość na `970af2b`:
`59ee111bb431f77a4fc01d7f9bf33992f4ab783458c704d20aafb9e42edec8f1`.

### Key Discoveries:

- **`criteria.json` NIE jest luką w odcisku — jest w nim w całości, i to ZMIERZONE**
  (`research.md` §1.2, §2). `.describe()` trafia do `REVIEW_JSON_SCHEMA` w 20 polach na 20, `label`
  wchodzi okrężną drogą przez szablon opisu pola `*Note` (`review-schema.ts:242`), `conditional`
  widać w kształcie (`anyOf` vs `type`). Zmiana `describe`, `label`, `key`, `conditional` ORAZ samej
  KOLEJNOŚCI kryteriów — każda z osobna rusza odcisk. Kontrola negatywna trzyma: `SCORE_MAX 10 → 99`
  odcisku NIE rusza.
- **Próg jest luką prawdziwą.** `SCORE_THRESHOLD = 5` (`scripts/review-verdict.ts:35`) leży poza
  wszystkimi czterema osiami — zmierzone (`research.md` §3.2, przypadek C4: nie jest argumentem
  `fingerprintPrompt`, więc nie ma drogi wpływu).
- **Odcisku nie da się policzyć bez instalacji** (`research.md` §1.6). Trzy z czterech osi ciągną
  zależność runtime: oś 2 wymaga `zod`, oś 4 `@anthropic-ai/claude-agent-sdk`, a sama funkcja
  `fingerprintPrompt` — `promptfoo`, przez wartościowy import w `cache.ts:2`. To wyklucza
  `prompt-ratchet.yml` jako dom (patrz D-1).
- **Granica kierunkowa jest twarda i uzasadniona przenośnością agenta.** `scripts/` czyta z `agents/`
  DANE, nigdy kodu (`review-schema.ts:6-12`, `run-review-verdict.ts:29-37`: „importing the agent's
  code would take away the portability that is the whole reason for building our own agent"). Odcisk
  wywołania wymaga KODU agenta; `verdictConfig` wymaga stałych ze `scripts/`. Jeden checker nie może
  dotknąć obu — stąd dwa, w jednym jobie.
- **Prettier zwija TABLICE WARTOŚCI PROSTYCH do jednej linii poniżej 120 kolumn** — zmierzone na
  realistycznym kandydacie (`research.md` §5.2). `JSON.stringify(x, null, 2)` NIE jest bezwarunkowo
  prettier-czysty; oba istniejące generatory przetrwały przypadkiem swojego kształtu.
  `lint-staged` (`package.json:80-87`) dopasowuje `*.{json,css,md}` na dowolnej głębokości
  (`matchBase`), a `.prettierignore` ma DOKŁADNIE jeden wzorzec i nie wyłącza `agents/**`.
- **Następne przejście macierzy będzie ZIMNE we wszystkich komórkach.** Trzy komórki leżące
  w `~/.promptfoo/cache` niosą odcisk dwuosiowy sprzed `c2991a4` (`d87ce99a…`), a dzisiejszy jest
  czteroosiowy (`59ee111b…`) — odczyt pod dzisiejszym kluczem to PUDŁO (`research.md` §3.1).
- **`pre-push` NIE zablokuje sondy** — zweryfikowane w tej sesji. `.husky/pre-push` to jedna linia
  `npm run typecheck`, czyli ROOTOWY type gate; `agents/**` jest poza rootowym `tsconfig.json`,
  a `SCORE_THRESHOLD = 8` jest poprawnym `number`. Precedens: sonda `de97385`
  (`agents/review/probe.ts`, „add a deliberate type error to prove the gate") weszła zwykłym pushem.
  Droga przez GitHub Contents API jest tu zbędna.
- **`report.ts` ma już tryb `--from <plik>`** (`report.ts:495-499`), renderujący raport z zapisanego
  wyniku bez wywołania modelu. To jest zarazem droga do SFAŁSZOWANIA dowodu — patrz D-5.

## Desired End State

Na `main`:

1. `agents/review/evals/eval-record.json` istnieje, jest prettier-czysty, niesie odcisk wywołania,
   trzy liczby `verdictConfig`, pełną tabelę 2×2 z kosztem i czasem oraz obowiązkową adnotację
   mówiącą, czym te liczby NIE są.
2. Workflow `Eval ratchet` biegnie na każdym PR-ze do `main` i na pushu na `main`, bez filtra
   `paths`, kończy się kodem 1, gdy dowodu brak, gdy jest nieaktualny, gdy macierz jest niepełna,
   gdy którakolwiek komórka jest czerwona albo gdy plik został przeformatowany. Nie ma w nim żadnego
   sekretu i nie może wydać ani centa.
3. Czerwień nazywa, KTÓRY z dwóch odcisków się rozjechał, podaje starą i nową wartość tam, gdzie
   wartości są czytelne (`próg 5 → 8`), i cytuje komendę, która dowód wytwarza — wraz z informacją,
   czy ta komenda kosztuje.
4. Dwustronna kontrola pozytywna jest wykonana NA ŚCIEŻCE CI, na której zapadka żyje, i zapisana
   w `verification.md`.

Weryfikacja: `verification.md` niesie zrzuty obu czerwieni z żywego CI, zieleń po rewercie, odczyt
`/api/v1/key` przed i po przejściu (opóźniony), oraz wynik `npx prettier --check` na dowodzie.

## What We're NOT Doing

- **Nie uruchamiamy macierzy w CI** w żadnej postaci — wykluczone decyzją 1 z `requirements.md`.
- **Nie rozszerzamy macierzy** (żadnych nowych fikstur, żadnego `sample-injection.diff`, żadnego
  `anthropic/claude-sonnet-4.6`). D3 z researchu: sonnet to 0,1935 USD/komórka, czyli macierz 3×2 =
  ~0,50 USD za JEDEN przebieg, cały budżet zmiany.
- **Nie stroimy progu 5** i nie domykamy obserwacji miękkiej `conditional-null-contract` do twardej
  asercji — oba zapisane w archiwum jako pytania do pomiaru.
- **Nie podbijamy `CACHE_FORMAT_VERSION`** — Z1 z researchu: osierocenie daje PUDŁO, czyli zachowanie
  fail-safe; nie ma usterki, wobec której trzeba by się opowiedzieć. Materiał na wpis do
  `lessons.md`, nie na robotę tutaj.
- **Nie ruszamy `.prettierignore`** — dowód ma być prettier-czysty KSZTAŁTEM, zmierzonym, nie
  wyłączeniem. Plik ma dziś dokładnie jeden wzorzec i długie uzasadnienie, dlaczego jest jeden.
- **Nie robimy z bramki review bramki blokującej merge.** `pr-review.yml:10-15` deklaruje ją jako
  DORADCZĄ i to zostaje bez zmian. Zapadka evali jest osobną bramką i blokuje siebie, nie review.

## Implementation Approach

### Decyzje architektoniczne (zamknięte — nie otwierać ponownie)

**D-1. Dom: własny plik `.github/workflows/eval-ratchet.yml`, bez filtra `paths`.**
`prompt-ratchet.yml` odpada, bo zapadka ma zależności runtime, a bezzależnościowość jest tym, co ten
plik deklaruje o sobie jako powód swojego kształtu (`:43-49`), i regułą zapisaną o dwa pliki dalej
(`agents-gate.yml:20-22`: „testy, które zależności MAJĄ, dostają dlatego inny job").
`agents-gate.yml` odpada **niepoprawnością, nie gorszością**: jego filtr `paths: ["agents/**", …]`
nie sięga `scripts/review-verdict.ts`, a skoro próg wchodzi do dowodu (D-2), zapadka milczałaby
dokładnie na PR-ze zmieniającym próg. Koszt własnego pliku to ~38 s wall-clocku na PR — repo jest
publiczne, standardowe runnery są darmowe, więc to cena, nie problem.

**D-2. Dwa odciski, jeden plik, rozłączne remedia.**
`callFingerprint` = `productionPromptFingerprint()`, hash, remedium PŁATNE.
`verdictConfig` = warstwa INTERPRETACJI, remedium NIEPŁATNE. Trzy liczby
(`threshold`, `scoreMin`, `scoreMax`) ze `scripts/review-verdict.ts` wchodzą jako **WARTOŚCI, nie
hash** — bo wtedy sam diff pliku czyta się `5 → 8` i remedium ma co nazwać; hash mógłby powiedzieć
tylko „rozjechało się", a to jest dokładnie ten kształt, po którym odcisk przepisuje się odruchowo,
bez czytania. Czwarte pole, `assertionsDigest`, jest hashem **z konieczności, nie z wyboru**: dla
całego pliku nie istnieje forma wartościowa, więc nazwa pola musi mówić wprost, że to digest, a nie
udawać liczby.

**D-3. Linia podziału między odciskami to ODPOWIEDŹ vs INTERPRETACJA, nie „agenckie vs `scripts/`".**
Odcisk wywołania mierzy wszystko, co zmienia to, CO MODEL ODPOWIEDZIAŁ. `verdictConfig` mierzy to,
co zmienia ODCZYT tej odpowiedzi — a odczyt da się poprawić bez wołania modelu, stąd niepłatne
remedium. Z tej linii wynikają trzy rozstrzygnięcia:

- **Kryteria do `verdictConfig` NIE wchodzą.** Kolejność, `key`, `label` i `conditional` są już
  zmierzone w odcisku wywołania (`research.md` §1.2), a `criteria.json` jest dodatkowo pod bramką
  dryfu (`.github/actions/review-agent/action.yml:138-146`). Zdublowanie dałoby przy zmianie
  kryterium PODWÓJNĄ czerwień z dwoma sprzecznymi remediami („przejedź macierz" i „przepisz
  wartość"), a wtedy człowiek wykonuje to tańsze i zielenieje bramkę, nie mierząc niczego.
- **`agents/review/evals/assertions.ts` WCHODZI, jako `assertionsDigest`.** Asercje nigdy nie jadą
  do modelu — żadna z nich nie ma drogi do `query(...)` — więc ich zmiana nie unieważnia tego, co
  model odpowiedział, tylko odczyt tej odpowiedzi. To ta sama klasa co `SCORE_THRESHOLD` i należy
  do tego samego odcisku. To nie jest nowa lista ścieżek, przed którą przestrzega wymaganie 2:
  `verdictConfig` i tak sięga po wartości z konkretnego pliku (próg ze `scripts/review-verdict.ts`),
  a digest liczy się z BAJTÓW pliku (`node:fs` + `node:crypto`), więc `scripts/` dalej czyta
  z `agents/` DANE, nigdy kodu, i dalej nie ma zależności runtime. Cena do zapisania: digest jest
  z całego pliku, więc zaczerwieni go też edycja samego komentarza — dokładnie ta sama własność,
  którą repo już przyjęło dla `prompt-sources.ts`, i przy niepłatnym remedium jest do zniesienia.
- **Remedium tej osi jest CZYNNOŚCIĄ LUDZKĄ, nie przeliczeniem.** Sprawdzone na kształcie rekordu
  z fazy 2: żeby przeliczyć `ok` pod nowymi asercjami, trzeba pełnego obiektu `Review` — każda
  z sześciu asercji startuje od `toReview(cell)` i czyta oceny per kryterium
  (`assertions.ts:151-154`), uzasadnienia (`:187-190`), `scopeDiscipline` (`:175`) i `cell.error`
  (`:120`). Rekord niesie tylko `verdict`, `ok`, `contract`, `failures[].reason` i metryki; pełny
  `Review` żyje wyłącznie w `CachedCell` w cache'u promptfoo, czyli lokalnie, nieskomitowany i wg
  §3.1 zimny. Remedium brzmi więc „przeczytaj rekord, oceń, czy zapisane wyniki trzymają się pod
  nowymi asercjami, dopiero potem przepisz digest" — i tak ma być napisane, bez sugerowania, że
  narzędzie coś przeliczy.

**D-4. Nazwana i przyjęta dziura.** Poza `verdictConfig` zostaje reszta warstwy INTERPRETACJI
z `research.md` §1.3: reguła agregacji (`review-verdict.ts:231`), surowość `parseReview`
(`:128-195`), literały werdyktu, `case "$VERDICT"` w `pr-review.yml:658-665`, mapowanie etykiet.
To jest KOD, nie wartości — odcisk z wartości go nie widzi, a hash pliku byłby listą ścieżek, czyli
tą klasą, którą wymaganie 2 odrzuca. **Zapisujemy to jawnie w adnotacji dowodu**, tak jak D3 zapisuje
dziurę sonnetową. Nie zapisujemy nigdzie, że „reszta jest pokryta przez review kodu" — nie jest,
i milczące założenie jest tu gorsze niż nazwana dziura.

**D-5. `--from` i `--record` wykluczają się wzajemnie.** Tryb `--from` renderuje raport z ZAPISANEGO
wyniku, a odcisk liczony jest ŻYWO w chwili zapisu — więc `--from` + `--record` wyprodukowałby dowód
zgodny z odciskiem i opisujący przebieg sprzed zmiany promptu. Research nazywa tę oś wprost: „dowód
może być zgodny i przy tym pusty, wewnętrznie sprzeczny albo skopiowany. Odcisk tego nie łapie".
Domykamy jedyną drogę, którą własne narzędzie by ją otwierało; ręcznej edycji pliku nie domknie nic
i nie udajemy, że domykamy.

**D-6. Zapadka czerwieni także na macierzy NIEPEŁNEJ i na komórce `ok: false`.**
Niepełnej — bo dowód z jednej kolumny nie jest dowodem (decyzja 2 z `requirements.md`: kontrakt
`null` jest u gemini NIESTABILNY, więc kolumna, której się nie zmierzyło, jest kolumną, o której się
nic nie wie). Sprawdzane STRUKTURALNIE, nie listą nazw modeli: liczba wierszy musi być iloczynem
liczby różnych modeli i różnych fikstur, przy co najmniej dwóch każdego — dzięki temu późniejsze
poszerzenie macierzy nie wymaga dotykania zapadki.
`ok: false` — bo dowód regresji nie jest dowodem jej braku. Cena jest realna i zapisana: gemini bywa
niestabilne między przebiegami przy tym samym prompcie (`verification.md:809-820`), więc flake na
asercji TWARDEJ zmusi człowieka do zapłacenia za ponowne przejście. Przyjęte świadomie (Open Risk 2).

**D-7. Ścieżka zapadki nie potrzebuje `promptfoo`.** `fingerprintPrompt` wędruje do nowego modułu
`agents/review/evals/fingerprint.ts` bez tej zależności; `cache.ts` re-eksportuje. Dzięki temu
workflow instaluje `npm ci --omit=dev` (~335 MB wg `action.yml:124-125`) zamiast pełnego grafu
(~2 099 MB, mediana 38 302 ms — `context/archive/2026-08-22-code-review-evals/change.md:38-42`).
Na workflow bez filtra `paths`, biegającym na KAŻDYM PR-ze, to jest różnica warta jednego
przeniesienia funkcji.

### Wzorce, które kontynuujemy

Od precedensu B (`prompt-sources`, `research.md` §6.1): pomiar zamiast `git diff --exit-code`;
rozdział rdzeń/runner (decyzja w module czystym, druk i kod wyjścia w runnerze); remedium jako
ponumerowane KROKI z ostrzeżeniem, że sam krok odświeżający „zapisze zgodę na prompt, którego nikt
nie przeczytał"; jedna adnotacja na pozycję, nie zbiorcza; awaria samej bramki odróżnialna od zgody
(`try/catch` → kod 1 z prefiksem `AWARIA`); treść remedium pod testem.
Od precedensu E (`cache.test.ts:92-104, 382-411`): kontrola pozytywna per oś przez mutację FUNKCJI
liczącej (`blindTo`), z komunikatem nazywającym oba kierunki porażki.

## Critical Implementation Details

**Kolejność kroków w workflow jest ODWROTNA do kolejności faz.** Krok bezzależnościowy
(`check-verdict-config.ts`) idzie PRZED `npm ci`, żeby rozjazd progu czerwienił w sekundach, nie po
38-sekundowej instalacji. To jest jedyne miejsce, gdzie kolejność ma znaczenie funkcjonalne, a nie
kosmetyczne.

**Ale NIE przed `setup-node`** — i to nie jest niuans, tylko warunek działania tego kroku.
`node --experimental-strip-types` wymaga Node ≥ 22.6, a przed `setup-node` biegnie Node
preinstalowany w obrazie `ubuntu-latest`, którego to repo nie pinuje NIGDZIE i który może się
zmienić bez PR-a tutaj. Repo pinuje `22.14.0` (`.nvmrc`), i wszystkie trzy istniejące runnery
bezzależnościowe robią to samo: `setup-node@v6` z `node-version: 22` PRZED, pomijany jest wyłącznie
`npm ci` — `prompt-ratchet.yml:37-39` → `:51`, `ci.yml:148-150` → `:156`, `pr-review.yml:229-231` →
`:463`. Oszczędność, o którą tu chodzi, siedzi w `npm ci` (38 s), nie w `setup-node` (sekundy), więc
poprawna kolejność nic z niej nie oddaje.

**Prettier-czystość mierzymy w fazie 2, na dowodzie SFABRYKOWANYM.** Pomiar musi paść ZANIM padnie
pierwszy cent: jeśli kształt payloadu okaże się prettier-brudny, poprawka wymaga zmiany serializatora,
a nie ponownego przejścia macierzy. Odwrotna kolejność kosztowałaby ~0,12 USD za informację, którą da
się kupić za darmo.

**Dwaj zapisywacze piszą do jednego pliku i każdy zachowuje cudzy blok.** Obaj robią
read-modify-write przez `JSON.parse` → podmiana swojego klucza → `JSON.stringify(x, null, 2) + "\n"`.
Nie mogą dzielić modułu serializującego (granica kierunkowa), więc jedna linia jest zdublowana —
i dlatego każda strona ma własny test round-tripu, a checker ma trzeci, na pliku zacommitowanym.

## Phase 1: Rdzenie odcisków

### Overview

Dwa czyste moduły i ich testy. Zero CI, zero wydatku, zero nowych plików danych. Po tej fazie oba
odciski dają się policzyć — jeden pod `npm ci --omit=dev`, drugi bez żadnej instalacji.

### Changes Required:

#### 1. Wydzielenie odcisku spod `promptfoo`

**File**: `agents/review/evals/fingerprint.ts` (nowy)

**Intent**: Przenieść tu `FINGERPRINT_NONCE`, `CallFingerprintParts`, `fingerprintPrompt`
i `productionPromptFingerprint` wraz z ich komentarzami uzasadniającymi, tak żeby ścieżka odcisku nie
ciągnęła `promptfoo` (devDep) i dała się uruchomić po `npm ci --omit=dev`. Komentarz o czterech
osiach jedzie RAZEM z funkcją — jego wartość jest w tym, że stoi nad kodem, który opisuje.

**Contract**: eksportuje `FINGERPRINT_NONCE`, `CallFingerprintParts`, `fingerprintPrompt(parts)`,
`productionPromptFingerprint()`. Importuje wyłącznie `node:crypto`, `../prompt.ts`,
`../review-schema.ts` (zod, prod dep) i `../run-review.ts` (SDK, prod dep). **Zero importu
`promptfoo`, także typowego** — `import type` znika przy type strippingu, ale nie znika przy
`tsc -p`, a `promptfoo` w `--omit=dev` nie istnieje także dla typów.

#### 2. Zachowanie jednego domu dla nazw

**File**: `agents/review/evals/cache.ts`, `agents/review/evals/provider.ts`

**Intent**: `cache.ts` re-eksportuje `FINGERPRINT_NONCE`, `fingerprintPrompt`
i `CallFingerprintParts` z `./fingerprint.ts`, żeby żaden istniejący import się nie zmienił;
`provider.ts` przestaje definiować `productionPromptFingerprint` i re-eksportuje ją stamtąd.
`cellCacheKey`, `readCell`, `writeCell`, `deleteCell`, `isCacheEnabled` zostają w `cache.ts` —
one promptfoo potrzebują naprawdę.

**Contract**: publiczna powierzchnia obu modułów bez zmian; `cache.test.ts` i `provider` importują
dalej to samo pod tymi samymi nazwami. Zmiana jest czysto lokalizacyjna i musi być widoczna
wyłącznie w liście plików.

#### 3. Rdzeń osi `verdictConfig`

**File**: `scripts/verdict-config.ts` (nowy)

**Intent**: Czysta decyzja „czy zapisana konfiguracja werdyktu opisuje dzisiejsze wartości", bez
`fs`, bez `console` — tak jak `./review-verdict.ts` obok. Tu mieszka też treść remedium, która ma
nazywać STARĄ i NOWĄ wartość per pole, a nie kazać przepisać nieczytelny odcisk.

**Contract**: eksportuje `VERDICT_CONFIG_FIELDS` (kolejność pól), `liveVerdictConfig()` zwracające
`{ threshold, scoreMin, scoreMax, assertionsDigest }`, `compareVerdictConfig(recorded, live)`
zwracające listę rozjazdów `{ field, recorded, live }`, `REFRESH_COMMAND` jako eksportowaną stałą
(wzorzec `prompt-sources.ts:64-65`) i `remedyFor(drifts)` w krokach ponumerowanych, kończące się
zdaniem, że sam krok odświeżający zapisuje zgodę na próg, którego nikt nie przeczytał. Remedium
**musi** zawierać zdanie, że ta oś NIE wymaga przejścia macierzy — inaczej człowiek zapłaci
za dowód, o którym macierz nic nie mówi.

Trzy pierwsze pola to WARTOŚCI czytane z `./review-verdict.ts` (`SCORE_THRESHOLD`, `SCORE_MIN`,
`SCORE_MAX`). Czwarte, `assertionsDigest`, to `sha256` z bajtów
`agents/review/evals/assertions.ts` — `node:fs` + `node:crypto`, ścieżka liczona z `import.meta.url`,
**zero importu kodu agenta** (D-3). Jego gałąź w `remedyFor` jest INNA niż gałąź trzech liczb:
nie mówi „przepisz wartość", tylko „przeczytaj rekord, oceń, czy zapisane `ok` trzymają się pod
nowymi asercjami, dopiero potem przepisz digest" — bo z rekordu nie da się ich przeliczyć (D-3,
punkt trzeci). Nie wolno jej napisać tak, żeby sugerowała mechaniczne przeliczenie.

#### 4. Testy dwustronne osi `verdictConfig`

**File**: `tests/lib/verdict-config.test.ts` (nowy)

**Intent**: Kontrola pozytywna per POLE: rekord ślepy na `threshold` czerwieni dokładnie przypadek
progu i tylko jego; to samo dla `scoreMin`, `scoreMax` i `assertionsDigest`. Plus przypadek
zgodności (zielono) i test treści remedium — że cytuje `REFRESH_COMMAND` i obie wartości.

Gałąź `assertionsDigest` dostaje własną asercję na TREŚĆ remedium: ma nie zawierać zdania
sugerującego przeliczenie i ma nazywać czynność ludzką (D-3). To jest ta połowa remedium, którą
najłatwiej napisać źle, więc idzie pod test tak samo jak reszta (wzorzec
`review-prompt-sources.test.ts:82-91`).

**Contract**: vitest, import z `../../scripts/verdict-config.ts`. Komunikat asercji nazywa OBA
kierunki porażki („albo mutacja nie czerwieni swojego przypadku, albo czerwieni cudzy") — wzorzec
`cache.test.ts:395`.

### Success Criteria:

#### Automated Verification:

- Typecheck pakietu agenta: `npm --prefix agents/review run typecheck`
- Testy pakietu agenta bez regresji: `npm --prefix agents/review test` (w tym `cache.test.ts`)
- Rootowy type gate: `npm run typecheck`
- Lint: `npm run lint`
- Nowy test przechodzi: `npx vitest run tests/lib/verdict-config.test.ts`
- **Odcisk liczy się bez `promptfoo`**: w czystym katalogu po `npm ci --omit=dev` w `agents/review`,
  `node --experimental-strip-types` liczący `productionPromptFingerprint()` kończy się kodem 0
- **Odcisk się nie zmienił**: wypisana wartość to
  `59ee111bb431f77a4fc01d7f9bf33992f4ab783458c704d20aafb9e42edec8f1` — przeniesienie funkcji nie ma
  prawa ruszyć ani jednego bajtu

#### Manual Verification:

- `git diff` na `cache.ts` i `provider.ts` pokazuje wyłącznie przeniesienie i re-eksport — żadnej
  zmiany semantyki w hydraulice cache'u
- Komentarz o czterech osiach stoi nad `fingerprintPrompt` w nowym pliku, nie został osierocony

**Implementation Note**: Po tej fazie zatrzymaj się i potwierdź manualnie, zanim przejdziesz dalej.

---

## Phase 2: Zapisywacze dowodu i pomiar prettiera

### Overview

Dwie komendy zapisujące, jeden plik, każda właścicielem swojego bloku. Prettier-czystość mierzona
TUTAJ, na dowodzie sfabrykowanym — zanim padnie pierwszy cent.

### Changes Required:

#### 1. Kształt dowodu i jego serializacja

**File**: `agents/review/evals/eval-record.ts` (nowy)

**Intent**: Czysty moduł opisujący kształt pliku dowodu, jego serializację i decyzję „czy ten dowód
jest aktualny wobec dzisiejszego odcisku". Bez `fs`, bez `console` — runner osobno.

**Contract**: eksportuje `EvalRecord` (kształt), `RECORD_PATH`, `serializeRecord(record)`
= `` `${JSON.stringify(record, null, 2)}\n` ``, `MANDATORY_NOTES` (adnotacja z D1),
`RECORD_COMMAND`, `checkRecord({ record, raw, liveFingerprint })` zwracające listę nazwanych
problemów, oraz `remedyFor(problem)`.

Kształt — **żadnego pola nie będącego tablicą OBIEKTÓW**, bo prettier zwija tablice wartości
prostych (`research.md` §5.2):

```jsonc
{
  "notes": { "scope": "…", "oneMeasurement": "…", "costSource": "…", "uncovered": "…", "fixtures": "…" },
  "generatedAt": "2026-08-…",
  "callFingerprint": "59ee111b…",
  "verdictConfig": { "threshold": 5, "scoreMin": 1, "scoreMax": 10, "assertionsDigest": "…" },
  "matrix": [
    {
      "model": "anthropic/claude-haiku-4.5",
      "fixture": "sample.diff",
      "verdict": "fail",
      "ok": true,
      "cached": false,
      "contract": "ok",
      "turns": 2,
      "inputTokens": 0,
      "outputTokens": 0,
      "costUsd": 0.0,
      "durationMs": 0,
      "failures": [{ "reason": "…" }],
      "softObservations": [{ "id": "…", "status": "pass", "reason": "…" }],
    },
  ],
}
```

`notes` to OBIEKT, nie tablica zdań — i to jest ta jedna rzecz w kształcie, która nie jest kwestią
gustu. Treść pól wynika z D1 i D-4: jedna komórka to jeden pomiar, a nie średnia; rozrzut
kosztu sięga dziesiątek procent, więc różnica między dwoma przebiegami nie jest sama z siebie
sygnałem; koszt liczony jest z tokenów × cennik OpenRoutera, nie z licznika SDK; **dowód dotyczy
reakcji DWÓCH TANICH MODELI na zmieniony prompt, a nie zachowania recenzenta produkcyjnego
(`anthropic/claude-sonnet-4.6`), i nie obejmuje warstwy interpretacji poza tym, co mierzy
`verdictConfig`**.

Piąte pole, `fixtures`, nazywa dziurę po stronie ODPOWIEDZI i jest OBOWIĄZKOWE tak samo jak reszta:
**ten dowód nie obejmuje treści `agents/review/evals/fixtures/*.diff`.** Fikstura nie wchodzi do
żadnej z czterech osi odcisku — `productionPromptFingerprint()` liczy go z `wrapDiff("",
FINGERPRINT_NONCE)`, czyli z PUSTYM diffem (`provider.ts:174`) — więc jej edycja nie rusza
`callFingerprint`. Rekord opisuje pomiar na materiale, który mógł się od tego czasu zmienić, a jego
oceny przestają wtedy cokolwiek znaczyć. Tej dziury ta zmiana **nie zamyka**: fikstura jest po
stronie ODPOWIEDZI (D-3), więc jej remedium byłoby PŁATNYM przejściem macierzy, a wciągnięcie jej do
`verdictConfig` zlałoby dwa remedia, których rozłączność jest treścią D-2. Nazwana i przyjęta, tak
jak dziura sonnetowa.

#### 2. Zapisywacz połowy agenckiej

**File**: `agents/review/evals/report.ts`

**Intent**: Dołożyć flagę `--record`, która po przejściu zapisuje `callFingerprint` (liczony ŻYWO)
i `matrix` do `eval-record.json`, zachowując cudzy blok `verdictConfig` i istniejące `notes`, jeśli
plik już jest. Reszta zachowania `report.ts` bez zmian — kod wyjścia dalej należy do promptfoo.

**Contract**: `--record` **odmawia** z nazwanym powodem i kodem 1, gdy (a) podano także `--from`
(D-5), (b) w argumentach jest cokolwiek zawężającego przebieg (`--filter…`), (c) przejście zwróciło
zero wierszy. Odmowa jest twarda, nie ostrzeżeniem — dowód zapisany z zawężonego przebiegu jest
zgodny z odciskiem i nic nie znaczy.

Sama flaga jest **konsumowana przez `splitArgs` tak samo jak `--from` i NIE trafia do `rest`**.
To nie jest detal stylu: `report.ts:501-507` przekazuje całą nieskonsumowaną resztę argumentów do
`promptfoo eval` (komentarz mówi to wprost), więc `--record` zostawiony w `rest` dojechałby tam jako
nieznana opcja.

#### 3. Zapisywacz połowy `scripts/`

**File**: `scripts/run-verdict-config.ts` (nowy)

**Intent**: `--write` odświeża blok `verdictConfig` w tym samym pliku, zachowując wszystko inne;
bez flagi wypisuje dzisiejsze wartości i kończy kodem 0. Ten runner NIGDY nie liczy odcisku
wywołania i nie importuje niczego z `agents/` poza odczytem JSON-a jako DANYCH.

**Contract**: wzorzec `scripts/run-prompt-sources.ts`; zero zależności runtime (`node:fs` +
`node:url`); `/* eslint-disable no-console */` na górze z uzasadnieniem, jak w siostrzanych plikach.
Ścieżka do pliku liczona z `import.meta.url`, nie z `process.cwd()`.

#### 4. Testy zapisywaczy

**File**: `agents/review/evals/eval-record.test.ts` (nowy), `tests/lib/verdict-config.test.ts`

**Intent**: Round-trip (`JSON.parse(serialize(x))` = `x`, i `serialize(parse(raw))` = `raw`),
zachowanie cudzego bloku przez każdego z zapisywaczy, oraz trzy odmowy `--record`.

**Contract**: strona agencka pod `node:test` (jej runner), strona `scripts/` pod vitest.

### Success Criteria:

#### Automated Verification:

- `npm --prefix agents/review test` — nowe testy zielone
- `npx vitest run tests/lib/verdict-config.test.ts`
- `npm run typecheck`, `npm run lint`, `npm --prefix agents/review run typecheck`
- **POMIAR PRETTIERA na dowodzie SFABRYKOWANYM**: zapisz plik z pełnym, realistycznym kształtem
  (4 wiersze, wypełnione `failures` i `softObservations`) pod ścieżką SONDUJĄCĄ
  `agents/review/evals/eval-record.prettier-probe.json` i uruchom na niej `npx prettier --check`
  → kod 0. Kod ≠ 0 = kształt do poprawy TERAZ, nie po zapłaceniu za przejście.
  **Ten sam katalog jest warunkiem, nie wygodą** — prettier rozstrzyga config od położenia pliku,
  więc pomiar poza `agents/review/evals/` mierzyłby inne `printWidth`. **Prawdziwa ścieżka
  `eval-record.json` nie powstaje w tej fazie ani na chwilę**: atrapa pod nią weszłaby do commita
  fazy 2, bo rytuał commita `/10x-implement` staguje pliki dotknięte w fazie i biegnie PRZED
  weryfikacją ręczną
- Kontrola dodatnia pomiaru: ten sam plik sondujący z jednym polem zamienionym na tablicę wartości
  prostych daje `prettier --check` kod 1 — inaczej pomiar nie mierzy niczego
- **Plik sondujący usunięty w TYM SAMYM kroku automatycznym**, w którym powstał — nie w weryfikacji
  ręcznej, bo ta gaśnie już po commicie

#### Manual Verification:

- Adnotacja `notes` przeczytana i odpowiada na pytanie „co ten plik NIE dowodzi" bez sięgania po plan
- **Dowód, że prawdziwa ścieżka nigdy nie istniała — jako PARA, nie jedno polecenie:**
  (a) `git log -- agents/review/evals/eval-record.json` jest PUSTE ORAZ
  (b) to samo polecenie na ścieżce, która na pewno istnieje
  (`git log -- agents/review/evals/cache.ts`) zwraca NIEPUSTY wynik.
  Bez (b) kryterium spełnia każda literówka w ścieżce — pusty wynik nie odróżnia „nie było takiego
  pliku" od „zapytałem o nic", czyli jest jednostronną kontrolą tej samej klasy co zmutowany
  ekstraktor z poprzedniej zmiany

**Implementation Note**: Po tej fazie zatrzymaj się i potwierdź manualnie. Następna faza wydaje
pieniądze i jest nieodwracalna.

---

## Phase 3: Przejście macierzy — PŁATNE

### Overview

Jedno zimne przejście 2×2, zapis dowodu, rozliczenie budżetu. Faza z jednym krokiem i jedną liczbą,
której nie da się przewidzieć.

### Changes Required:

#### 1. Odczyt bazowy

**Intent**: Odczytać `/api/v1/key` PRZED przejściem i zapisać wartość z timestampem.

**Contract**: to jest dolna kotwica rachunku; bez niej „przejście kosztowało X" nie ma odjemnika.

#### 2. Przejście i zapis dowodu

**Intent**: `npm --prefix agents/review run eval -- --record`, z `OPENROUTER_REVIEW_KEY` zmapowanym
na czas komendy. Przejście będzie ZIMNE we wszystkich czterech komórkach (`research.md` §3.1) —
kotwica 0,118529 USD z poprzedniej zmiany, ale z rozrzutem dziesiątek procent.

**Contract**: kotwica budżetowa zmiany to **0,50 USD**. Przekroczenie = zatrzymać się i wrócić
z liczbami, nie dokładać przebiegów.

#### 3. Zapis połowy `verdictConfig`

**Intent**: `node --experimental-strip-types scripts/run-verdict-config.ts --write`.

**Contract**: blok `matrix` i `callFingerprint` zapisane w kroku 2 muszą przetrwać co do bajtu.

#### 4. Rozliczenie

**File**: `context/changes/review-eval-gate/verification.md` (nowy)

**Intent**: Zapisać odczyt bazowy, odczyt OPÓŹNIONY (nie natychmiastowy — część obciążeń księguje
się z poślizgiem, `measurement-negative-control.md:154-157`), różnicę, i sumę z raportu obok.
Rozjazd między nimi jest informacją, nie błędem.

**Contract**: do rozliczenia budżetu wchodzi liczba z `/api/v1/key`, nigdy prognoza ani licznik SDK
(zmierzone przeszacowanie: 5,0× dla haiku, 14,0× dla gemini).

### Success Criteria:

#### Automated Verification:

- `npx prettier --check agents/review/evals/eval-record.json` → kod 0 na dowodzie PRAWDZIWYM
- `git add agents/review/evals/eval-record.json && git status` po `pre-commit` — plik nie został
  przeformatowany przez `lint-staged`
- `agents/review/evals/eval-record.json` niesie 4 wiersze, 2 różne modele, 2 różne fikstury
- `callFingerprint` w pliku = `59ee111b…` (prompt nie był ruszany, więc musi się zgadzać)

#### Manual Verification:

- Odczyt `/api/v1/key` opóźniony wykonany i zapisany; różnica mieści się w 0,50 USD
- Wszystkie cztery komórki `ok: true` — jeśli nie, ZATRZYMAJ SIĘ: czerwona komórka na
  niezmienionym prompcie jest sygnałem o macierzy, nie o zapadce, i wymaga rozstrzygnięcia
  przed fazą 4
- Obserwacje miękkie zapisane bez awansowania ich do twardych

**Implementation Note**: Po tej fazie zatrzymaj się i potwierdź manualnie.

---

## Phase 4: Zapadka

### Overview

Dwa checkery, workflow, kontrola pozytywna per oś w teście. Po tej fazie zapadka istnieje, ale nie
została jeszcze zaczerwieniona na żywym CI — to jest faza 5.

### Changes Required:

#### 1. Checker połowy agenckiej

**File**: `agents/review/evals/check-eval-record.ts` (nowy)

**Intent**: Runner: wczytaj `eval-record.json`, policz dzisiejszy odcisk, oddaj decyzję z rdzenia,
wypisz adnotacje i kod wyjścia.

**Contract**: importuje `./fingerprint.ts` i `./eval-record.ts` — **nigdy `./provider.ts` ani
`./cache.ts`**, bo te ciągną `promptfoo`. Czerwieni na: braku pliku (D2), rozjeździe
`callFingerprint`, niepełnej macierzy (D-6), komórce `ok: false` (D-6), nieudanym round-tripie
serializacji (plik przeformatowany). Jedna adnotacja `::error` na problem, nie zbiorcza. `try/catch`
na wierzchu → kod 1 z prefiksem `AWARIA`, żeby awaria bramki nie czytała się jak zgoda.

#### 2. Checker połowy `scripts/`

**File**: `scripts/check-verdict-config.ts` (nowy)

**Intent**: Bezzależnościowy odpowiednik dla trzech liczb. Wzorzec 1:1 z
`scripts/check-prompt-sources.ts`.

**Contract**: `node:fs` + import siostrzanego `./verdict-config.ts`; czyta `eval-record.json` oraz
`agents/review/evals/assertions.ts` jako DANE (ten drugi tylko po to, żeby policzyć digest — nigdy
importem). Czerwień nazywa pole i obie wartości (`próg 5 → 8`) i mówi wprost, że macierzy
przejeżdżać NIE TRZEBA. Dla `assertionsDigest` obie wartości są nieczytelne, więc komunikat nie
udaje, że są: mówi, KTÓRY plik się zmienił, i cytuje gałąź remedium nazywającą czynność ludzką
(D-3).

#### 3. Workflow

**File**: `.github/workflows/eval-ratchet.yml` (nowy)

**Intent**: Dom zapadki (D-1), z zapisanym w komentarzu uzasadnieniem, dlaczego to osobny plik
i dlaczego decyzja o filtrze jest tu taka sama jak w `prompt-ratchet.yml`, a odwrotna niż
w `agents-gate.yml`.

**Contract**: `on: push[main] + pull_request[main]`, **bez `paths` i bez `paths-ignore`** —
`scripts/review-verdict.ts` musi być widziany, a filtr, który by go objął, zestarzałby się cicho.
`permissions: contents: read`. `concurrency` z `cancel-in-progress: true`, wzorem sąsiadów.
`timeout-minutes`. Kroki w kolejności: checkout → `setup-node` (`node-version: 22`,
`cache-dependency-path: agents/review/package-lock.json`) → **`check-verdict-config.ts` (bez
instalacji)** → `npm ci --omit=dev` w `agents/review` →
`node --experimental-strip-types agents/review/evals/check-eval-record.ts`.
**Żadnego `env:` z sekretem** — wymaganie 1 jest sprawdzalne wzrokowo dokładnie przez jego brak.
`setup-node` idzie pierwszy z powodu zapisanego w „Critical Implementation Details"; jego krok
cache'uje wyłącznie klucz npm i niczego nie instaluje, więc krok bezzależnościowy dalej czerwieni
w sekundach.

**`--omit=dev` nakłada trzy warunki na kod, który ten workflow uruchamia.** `agents/review/package.json`
ma w `dependencies` wyłącznie `@anthropic-ai/claude-agent-sdk` i `zod`; `@types/node`, `promptfoo`,
`tsx` i `typescript` są w `devDependencies` i po `--omit=dev` po prostu ich nie ma. Stąd:

1. **`productionPromptFingerprint()` nie może importować `promptfoo` — ani wprost, ani przez
   `evals/cache.ts`**, który robi `import { cache as promptfooCache } from "promptfoo"`
   (`cache.ts:2`, import WARTOŚCIOWY). Musi mieszkać w module, którego jedynymi zależnościami są
   `zod` i `@anthropic-ai/claude-agent-sdk` — czyli w `evals/fingerprint.ts` z fazy 1 (D-7). To ten
   sam rozdział rdzeń/runner co w czterech precedensach repo, tylko wymuszony tu ograniczeniem
   instalacji, a nie estetyką.
2. **Runner idzie przez `node --experimental-strip-types`, NIE przez `tsx`.** `tsx` też jest
   devDependency, więc `--omit=dev` go nie zainstaluje — a to on odpala `evals/report.ts`
   (`package.json:11`), więc instynkt „tak się tu uruchamia pliki agenta" prowadzi wprost pod ścianę.
   Precedens jest po drugiej stronie: `prompt-ratchet.yml:51,62` i `check-prompt-sources.ts` biegają
   bez `npm ci` właśnie pod bare node.
3. **Warunek zamknięcia fazy: OBA kroki uruchomione w drzewie po `npm ci --omit=dev`, z pokazanym
   wynikiem.** Bez tego pomiaru faza nie jest zamknięta — `ERR_MODULE_NOT_FOUND` wyszedłby dopiero
   na CI, czyli w miejscu, gdzie czyta się go jako awarię bramki, a nie jako brakującą zależność.

⚑ Przy okazji, do odnotowania dla czytelnika długu z poprzedniej zmiany: `--omit=dev` spłaca jego
część. Kotwice `npm ci` 5 758 → 38 302 ms i `node_modules` 392 MB → 2 099 MB
(`context/archive/2026-08-22-code-review-evals/change.md:38-42`) pochodzą z wejścia `promptfoo` do
devDeps, więc na TEJ ścieżce już nie obowiązują. To skutek uboczny D-7, nie cel tej zmiany: dług
zostaje otwarty tam, gdzie go zapisano — `.github/actions/review-agent/action.yml:126` robi dalej
gołe `npm ci`, bo `tsx` jest devDependency, więc każdy przebieg review na każdym PR-ze wciąż
instaluje pełny graf. Ta zmiana tamtego warunku zamknięcia NIE realizuje.

#### 4. Kontrola pozytywna per oś (test)

**File**: `agents/review/evals/eval-record.test.ts`

**Intent**: Wzorzec `blindTo` z `cache.test.ts:92-104`: wariant decyzji ślepy na oś X musi
zaczerwienić DOKŁADNIE przypadek X i tylko jego. Osie: `callFingerprint`, kompletność macierzy,
`ok: false`, round-trip.

**Contract**: mutowana jest FUNKCJA decydująca, nie wejście; komunikat nazywa oba kierunki porażki.

#### 5. Wyłączenie dowodu z recenzowanego diffa

**File**: `.github/workflows/pr-review.yml`

**Intent**: Dopisać `:(exclude)agents/review/evals/eval-record.json` do pathspec przy `:282-286`,
zgodnie z konwencją „każdy generowany artefakt jest wyłączany z diffa recenzowanego przez agenta"
(`research.md` §5.4).

**Contract**: dopisanie do istniejącej listy, bez zmiany jej kształtu.

#### 6. Dokumentacja komend

**File**: `AGENTS.md`

**Intent**: Dwa wpisy w §Commands — jeden na `npm --prefix agents/review run eval -- --record`
(z informacją, że KOSZTUJE i że `--from` jest z nim wykluczone), jeden na
`scripts/run-verdict-config.ts --write` (z informacją, że NIE kosztuje).

**Contract**: ⚑ §Commands **nie jest** jedną z trzech sekcji pilnowanych przez `PROMPT_SOURCES`
(te to §Hard Rules, §Conventions i `test-plan.md` §2), więc ta edycja **nie** wymaga
`run-prompt-sources.ts --write`. Sprawdź to przed commitem — uruchomienie odświeżacza „na wszelki
wypadek" zapisałoby zgodę na destylat, którego nikt nie przeczytał.

### Success Criteria:

#### Automated Verification:

- `npm --prefix agents/review test`, `npx vitest run tests/lib/verdict-config.test.ts`
- `npm run typecheck`, `npm run lint`, `npm --prefix agents/review run typecheck`
- **Oba checkery na czystym drzewie kończą kodem 0** — lokalnie, obie połowy
- **Oba checkery czerwienią na podmienionym dowodzie**: tymczasowa zmiana odcisku w pliku → kod 1;
  tymczasowe `threshold: 8` → kod 1 z komunikatem cytującym `5 → 8`; zmiany cofnięte
- **OBA checkery uruchomione w drzewie po `npm ci --omit=dev`, z pokazanym wynikiem** — nie
  zadeklarowane. `ERR_MODULE_NOT_FOUND` znaczy tu, że przecieka `promptfoo` (import przez
  `cache.ts`/`provider.ts`) albo `tsx` (runner odpalony nie tym poleceniem)
- `node --experimental-strip-types scripts/check-prompt-sources.ts` dalej zielone po edycji AGENTS.md

#### Manual Verification:

- `eval-ratchet.yml` przeczytany pod kątem obecności sekretu — nie ma żadnego
- Komunikat obu czerwieni przeczytany przez pryzmat wymagania 7: czy człowiek wie, CO zrobić, nie
  otwierając źródła skryptu
- Nazwa workflow i treść komunikatów nie sugerują, że „prompt jest sprawdzony" — mówią o reakcji
  dwóch tanich modeli (D3)

**Implementation Note**: Po tej fazie zatrzymaj się i potwierdź manualnie.

---

## Phase 5: Dwustronna kontrola pozytywna na żywym CI

### Overview

Bramka, której nie widziano na czerwono, jest deklaracją. `lessons.md:250-255` żąda próby czerwieni
NA ŚCIEŻCE, na której bramka będzie żyła — a żaden precedens w tym repo takiej próby nie ma
(`research.md` §6.2). Ta faza ją wykonuje, dwiema sondami, zwykłym `git push`.

### Changes Required:

#### 0. Otwarcie ścieżki CI i strażnik kosztu — PRZED pierwszą sondą

**Intent**: Sondy nie mają czego zaczerwienić, dopóki nie istnieje PR. Wyzwalacz zapadki to
`push[main]` + `pull_request[main]`, a sondy jadą na gałąź `review-eval-gate` — więc bez otwartego
PR-a `git push` nie uruchamia NICZEGO: ani czerwieni, ani zieleni, i faza nie ma czego zaobserwować.
Otwarcie PR-a jest jednak zdarzeniem PŁATNYM na innej bramce, więc idzie po strażniku, nie przed nim.

**Contract**: dwa kroki, w tej kolejności.

- **0a. `gh workflow disable "PR code review"`** — PRZED otwarciem PR-a. Powód jest zmierzony:
  `pr-review.yml:29-31` deklaruje `types: [opened, synchronize, reopened, labeled]`,
  `branches: [main]`, i **nie ma warunku na draft** — jedyny `if:` w pliku (`:109-112`) filtruje
  tylko przynależność repo i etykietę przy akcji `labeled`. Otwarcie PR-a, także jako draft, to
  `opened` = jeden przebieg review; **każdy** push sondy to `synchronize` = kolejny. Kotwica kosztu:
  ostatni przebieg na PR #48 kosztował 0,6447345 USD (`PR code review` #42, run `32637738782`,
  `sonnet-4.6`). Faza 5 przewiduje kilka pushy, więc bez strażnika kosztowałaby WIELOKROTNOŚĆ
  budżetu 0,50 USD całej tej zmiany — i to na review, które z nią nie ma nic wspólnego.
  ⚑ `concurrency` w `pr-review.yml:70-72` ma `cancel-in-progress: true` grupowane per PR, więc
  szybkie kolejne pushe kasują starsze przebiegi i część rachunku odpada. To go ZMNIEJSZA, nie
  usuwa — nie zastępuje strażnika i nie wolno go tak czytać.
- **0b. Otwórz PR `review-eval-gate` → `main`** (draft wystarczy). Przy `pull_request` GitHub bierze
  plik workflow z merge-refa gałęzi, więc świeżo dodany `eval-ratchet.yml` biegnie — ale dopiero od
  zdarzenia `opened`, nie od wcześniejszych pushy. Sprawdzian: `Eval ratchet` pojawia się na liście
  checków PR-a.

#### 1. Sonda P1 — odcisk wywołania

**Intent**: Jeden znak w `SYSTEM_PROMPT` (`agents/review/prompt.ts`), commit, push, obserwacja
czerwieni joba `Eval ratchet`, rewert.

**Contract**: przed pushem uruchom lokalnie `node --experimental-strip-types --test
agents/review/prompt.test.ts` — jeśli wybrane miejsce mutacji czerwieni ten test, wybierz inne;
sonda ma zaczerwienić JEDNĄ bramkę, nie dwie. Miejsce mutacji ma być poza tekstem, o którym
`prompt.test.ts` cokolwiek twierdzi.

#### 2. Sonda P2 — `verdictConfig` i zasięg wyzwalacza

**Intent**: `SCORE_THRESHOLD = 5 → 8` (`scripts/review-verdict.ts:35`), commit, push, obserwacja
czerwieni, rewert. Ta sonda dowodzi DWÓCH rzeczy naraz: że oś `verdictConfig` czerwieni, i że
wyzwalacz sięga `scripts/` — czyli że wybór domu z D-1 był konieczny, a nie preferencyjny.

**Contract**: **oczekiwana czerwień także w jobie `ci`** — `tests/lib/review-verdict.test.ts:141`
przypina `expect(SCORE_THRESHOLD).toBe(5)`. To jest przewidziane; czytamy status per job, a fakt
zapisujemy, żeby nikt później nie odczytał go jako defektu sondy.

#### 3. Połowa zielona

**Intent**: Po obu rewertach ten sam workflow na tej samej gałęzi biegnie ZIELONO.

**Contract**: to jest druga połowa kontroli — bez niej dowód przechodzi także dla zapadki
czerwieniącej ZAWSZE (wymaganie 3).

#### 4. Zapis

**File**: `context/changes/review-eval-gate/verification.md`

**Intent**: Dopisać do rozliczenia z fazy 3: linki do obu czerwonych przebiegów, cytat komunikatu
każdej, link do zielonego, oraz zdanie o tym, dlaczego `pre-push` sond nie zablokował (rootowy
typecheck, `agents/**` poza tsconfigiem, `8` to poprawny `number`).

**Contract**: zmienna różnicy ma być widoczna — dla każdej pary czerwień/zieleń zapisane, CO
dokładnie się różniło.

#### 5. Przywrócenie bramki review — WARUNEK ZAMKNIĘCIA FAZY

**Intent**: `gh workflow enable "PR code review"` po domknięciu wszystkich sond, ze sprawdzeniem
przez `gh workflow list`, że stan wrócił do `active`.

**Contract**: to nie jest sprzątanie, tylko warunek zamknięcia fazy — bramka wyłączona po cichu
i niewłączona z powrotem to stan GORSZY niż brak tej zmiany, i dokładnie ta klasa, którą
`lessons.md:250-255` nazywa: gwarancja, która przestała pilnować, a nikt tego nie widzi. Krok 0a
otwiera okno, ten je zamyka; między nimi nie ma nic, co by je zamknęło samo. Osobny odhaczalny
wiersz w Progress, nie zdanie w prozie.

### Success Criteria:

#### Automated Verification:

- **`PR code review` WYŁĄCZONY przed otwarciem PR-a** — `gh workflow list` pokazuje go jako
  `disabled_manually`, nie `active`
- **PR `review-eval-gate` → `main` otwarty**, a `Eval ratchet` widoczny na jego liście checków
- Job `Eval ratchet` CZERWONY na przebiegu z sondą P1, z komunikatem o rozjeździe `callFingerprint`
- Job `Eval ratchet` CZERWONY na przebiegu z sondą P2, z komunikatem cytującym `5 → 8`
- Job `Eval ratchet` ZIELONY na przebiegu po obu rewertach
- `git log` nie zawiera żadnego `--no-verify`; obie sondy weszły zwykłym pushem
- **`PR code review` WŁĄCZONY z powrotem** — `gh workflow list` pokazuje `active`. Warunek
  zamknięcia fazy, nie sprzątanie
- Pełny zestaw bramek zielony na finalnym stanie gałęzi

#### Manual Verification:

- Komunikat czerwieni P2 przeczytany: czy mówi wprost, że macierzy przejeżdżać nie trzeba
- Komunikat czerwieni P1 przeczytany: czy mówi wprost, że przejście KOSZTUJE
- `verification.md` niesie obie połowy kontroli i nazwaną zmienną różnicy
- Rewerty nie zostawiły nic w drzewie (`git status` czysty, odcisk z powrotem `59ee111b…`)

---

## Testing Strategy

### Unit Tests:

- `tests/lib/verdict-config.test.ts` — porównanie per pole, dwustronnie; treść remedium pod testem
  (wzorzec `review-prompt-sources.test.ts:82-91`)
- `agents/review/evals/eval-record.test.ts` — round-trip serializacji, zachowanie cudzego bloku,
  trzy odmowy `--record`, kontrola pozytywna per oś w stylu `blindTo`

### Integration Tests:

- Oba checkery uruchomione lokalnie na drzewie czystym (kod 0) i na czterech osobno zepsutych
  stanach (kod 1 z właściwym komunikatem)
- Checker agencki uruchomiony po `npm ci --omit=dev` — dowód, że `promptfoo` nie przecieka

### Manual Testing Steps:

1. Zapisz dowód sfabrykowany, uruchom `npx prettier --check` — musi być kod 0 (faza 2)
2. Zamień jedno pole na tablicę wartości prostych, powtórz — musi być kod 1 (kontrola pomiaru)
3. Po fazie 3: `git add` dowodu, sprawdź, że `pre-commit` go nie przeformatował
4. Sondy P1 i P2 na żywym CI, obie z rewertem (faza 5)

## Performance Considerations

Workflow biega na każdym PR-ze bez filtra. Krok bezzależnościowy idzie pierwszy i kończy w sekundach;
`npm ci --omit=dev` to ~335 MB zamiast ~2 099 MB dzięki D-7. Sumarycznie rząd wielkości poniżej
`agents-gate`, który i tak biegnie obok przy zmianach w `agents/**`.

## Migration Notes

Nie dotyczy — nowa bramka, brak stanu do przeniesienia. Jedyna rzecz do zapamiętania przy rewercie
całości: usunięcie `eval-ratchet.yml` bez usunięcia `eval-record.json` zostawia plik, którego nic
nie pilnuje; usunięcie odwrotne zostawia bramkę bez dowodu, czyli stałą czerwień (D2, celowo).

## Open Risks & Assumptions

1. **Dwie kopie skali `SCORE_MIN`/`SCORE_MAX`** (`scripts/review-verdict.ts:32-33`
   i `agents/review/review-schema.ts:46-47`) nadal nie mają nic, co pilnowałoby ich zgodności —
   Open Risk 1 z archiwum. `verdictConfig` zapisuje kopię ze `scripts/`, bo to ona egzekwuje skalę
   przy werdykcie; kopia agencka zostaje niepilnowana. Ta zmiana ryzyka nie zamyka i nie udaje, że
   zamyka.
2. **Flake gemini na asercji TWARDEJ zmusi do zapłacenia za ponowne przejście** (D-6). Zmierzone:
   kontrakt `null` bywa u gemini niestabilny między przebiegami przy tym samym prompcie
   (`verification.md:809-820`). Warunek przeglądu tej decyzji: dwa kolejne przebiegi, w których
   czerwień komórki znika bez zmiany promptu.
3. **Dowód da się sfałszować ręczną edycją pliku.** Odcisk tego nie łapie i nic tego nie złapie.
   Domknięta jest wyłącznie droga przez własne narzędzie (D-5).
4. **Dziura fiksturowa.** Treść `agents/review/evals/fixtures/*.diff` nie wchodzi do żadnej z czterech
   osi odcisku (`wrapDiff("", …)`, `provider.ts:174`), więc edycja fikstury zostawia zapadkę ZIELONĄ
   nad rekordem, którego oceny powstały na innym materiale. Świadomie niezamknięta: fikstura jest po
   stronie ODPOWIEDZI (D-3), więc jej remedium byłoby płatne, a wciągnięcie jej do `verdictConfig`
   zlałoby dwa remedia, których rozłączność jest treścią D-2. Nazwana w polu `notes.fixtures`
   dowodu. Warunek przeglądu: pierwsza zmiana fikstury, przy której ktoś zauważy, że rekord nie
   zaczerwienił.
5. **Dziura sonnetowa** (D3): regresja uderzająca w `anthropic/claude-sonnet-4.6`, a omijająca oba
   tanie modele, przejdzie tę bramkę na ZIELONO z dowodem kompletnym i aktualnym. Nazwana, przyjęta,
   zapisana w adnotacji dowodu. Nie zapisujemy nigdzie, że modele z jednej rodziny regresują razem —
   to jest prawdopodobne i NIEZMIERZONE.

## References

- Wymagania: `context/changes/review-eval-gate/requirements.md`
- Research: `context/changes/review-eval-gate/research.md` (§1.2 pomiar `describe`, §1.6 zależności,
  §3.1 zimny cache, §5.2 pułapka prettiera, §6.1 wzorce, D1–D3)
- Wzorzec zapadki: `scripts/prompt-sources.ts:64-65, 176-194`, `scripts/check-prompt-sources.ts:88-107`
- Wzorzec kontroli pozytywnej: `agents/review/evals/cache.test.ts:92-104, 382-411`
- Uzasadnienie osobnego pliku workflow: `.github/workflows/prompt-ratchet.yml:3-18, 43-49`
- Odwrotna decyzja o filtrze: `.github/workflows/agents-gate.yml:10-22`
- Granica kierunkowa: `agents/review/review-schema.ts:6-12`, `scripts/run-review-verdict.ts:29-37`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Rdzenie odcisków

#### Automated

- [x] 1.1 Typecheck pakietu agenta — be29442
- [x] 1.2 Testy pakietu agenta bez regresji — be29442
- [x] 1.3 Rootowy type gate — be29442
- [x] 1.4 Lint — be29442
- [x] 1.5 `tests/lib/verdict-config.test.ts` przechodzi — be29442
- [x] 1.6 Odcisk liczy się po `npm ci --omit=dev` — be29442
- [x] 1.7 Odcisk niezmieniony (`59ee111b…`) — be29442

#### Manual

- [x] 1.8 `git diff` na `cache.ts`/`provider.ts` to wyłącznie przeniesienie i re-eksport — be29442
- [x] 1.9 Komentarz o czterech osiach nie został osierocony — be29442

### Phase 2: Zapisywacze dowodu i pomiar prettiera

#### Automated

- [x] 2.1 Testy pakietu agenta zielone
- [x] 2.2 `tests/lib/verdict-config.test.ts` zielony
- [x] 2.3 Typecheck (root + agent) i lint
- [x] 2.4 `prettier --check` na ścieżce sondującej → kod 0
- [x] 2.5 Kontrola dodatnia pomiaru: tablica wartości prostych → kod 1
- [x] 2.6 Plik sondujący usunięty w tym samym kroku automatycznym

#### Manual

- [x] 2.7 Adnotacja `notes` odpowiada na „co ten plik NIE dowodzi"
- [x] 2.8 Para (a)+(b): `git log` na `eval-record.json` pusty, na `cache.ts` niepusty

### Phase 3: Przejście macierzy — PŁATNE

#### Automated

- [ ] 3.1 `prettier --check` na dowodzie prawdziwym → kod 0
- [ ] 3.2 `lint-staged` nie przeformatował dowodu przy `git add`
- [ ] 3.3 Dowód niesie 4 wiersze, 2 modele, 2 fikstury
- [ ] 3.4 `callFingerprint` = `59ee111b…`

#### Manual

- [ ] 3.5 Odczyt `/api/v1/key` opóźniony wykonany; różnica w budżecie 0,50 USD
- [ ] 3.6 Wszystkie cztery komórki `ok: true`
- [ ] 3.7 Obserwacje miękkie zapisane bez awansowania do twardych

### Phase 4: Zapadka

#### Automated

- [ ] 4.1 Testy pakietu agenta i vitest zielone
- [ ] 4.2 Typecheck (root + agent) i lint
- [ ] 4.3 Oba checkery na czystym drzewie → kod 0
- [ ] 4.4 Oba checkery na podmienionym dowodzie → kod 1 z właściwym komunikatem
- [ ] 4.5 Oba checkery uruchomione po `npm ci --omit=dev`, wynik pokazany
- [ ] 4.6 `check-prompt-sources.ts` zielony po edycji AGENTS.md

#### Manual

- [ ] 4.7 `eval-ratchet.yml` bez sekretu — sprawdzone wzrokowo
- [ ] 4.8 Komunikaty czerwieni spełniają wymaganie 7
- [ ] 4.9 Nazwa i komunikaty nie sugerują „prompt sprawdzony" (D3)

### Phase 5: Dwustronna kontrola pozytywna na żywym CI

#### Automated

- [ ] 5.1 `PR code review` wyłączony przed otwarciem PR-a (`disabled_manually`)
- [ ] 5.2 PR `review-eval-gate` → `main` otwarty, `Eval ratchet` na liście checków
- [ ] 5.3 `Eval ratchet` CZERWONY na sondzie P1
- [ ] 5.4 `Eval ratchet` CZERWONY na sondzie P2 z cytatem `5 → 8`
- [ ] 5.5 `Eval ratchet` ZIELONY po rewertach
- [ ] 5.6 Brak `--no-verify` w historii; sondy weszły zwykłym pushem
- [ ] 5.7 `PR code review` WŁĄCZONY z powrotem (`active`) — warunek zamknięcia fazy
- [ ] 5.8 Pełny zestaw bramek zielony na finalnym stanie gałęzi

#### Manual

- [ ] 5.9 Komunikat P2 mówi wprost, że macierzy przejeżdżać nie trzeba
- [ ] 5.10 Komunikat P1 mówi wprost, że przejście kosztuje
- [ ] 5.11 `verification.md` niesie obie połowy i nazwaną zmienną różnicy
- [ ] 5.12 Rewerty czyste, odcisk z powrotem `59ee111b…`
