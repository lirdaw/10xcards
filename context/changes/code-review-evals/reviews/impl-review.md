<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Zestaw evali (promptfoo) dla agenta code review

- **Plan**: `context/changes/code-review-evals/plan.md`
- **Scope**: Phases 1-7 (pełny plan; 6 pozycji `## Progress` świadomie otwartych)
- **Range**: `380fff6..HEAD` (`a29fae5`), 24 pliki
- **Date**: 2026-08-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension           | Verdict | Findings   |
| ------------------- | ------- | ---------- |
| Plan Adherence      | WARNING | F2, F5     |
| Scope Discipline    | PASS    | —          |
| Safety & Quality    | WARNING | F1, F3, F6 |
| Architecture        | PASS    | —          |
| Pattern Consistency | WARNING | F4, F8     |
| Success Criteria    | WARNING | F7         |

## Grounding — co zweryfikowałem sam, nie z notatki

| sprawdzenie                                                                  | wynik                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm --prefix agents/review run typecheck`                                   | **zielone**                                                         |
| `npm --prefix agents/review run test`                                        | **57/57**, 6/6 plików testowych wykrytych                           |
| `git diff 380fff6..HEAD -- .github/actions/ .github/workflows/pr-review.yml` | **pusto** — kryterium 7.7 dowiedzione                               |
| `review-cli.test.ts` między `0e08a09` a HEAD                                 | **bajtowo identyczny** — kryterium 2.1 dowiedzione, nie deklarowane |
| arytmetyka `pricing.ts` wobec tabeli fazy 7                                  | gemini 0,013447 ✓, haiku 0,068446 ✓ (co do 6. miejsca)              |
| wpisy `node_modules/` w locku agenta                                         | **141 → 827** (+686 paczek)                                         |
| stan gałęzi wobec `origin/code-review-evals`                                 | **9 commitów przed** — fazy 5-7 nigdy nie przeszły przez CI         |
| `.github/actions/review-agent/action.yml:126`                                | gołe `npm ci`, bez `--omit=dev` — devDeps jadą na produkcji         |
| `SCORE_MIN`/`SCORE_MAX` w obu kopiach                                        | 1/10 = 1/10, zgodne; dług nazwany jako Open Risk 1                  |

Wszystkie jedenaście twardych kontraktów planu (brak `try/catch` w wrapperze, `reportFailureKind`
w `runReview`, jedna kopia `ANTHROPIC_*`, kolejność efektów, klucz cache'u bez nonce'u, `callApi`
łapiące rzut z polem `kind`, koszt z cennika a nie z `total_cost_usd`, progi z `SCORE_MIN/MAX`,
dwa wpięcia providera, brak asercji-tautologii, nietykalność ścieżki produkcyjnej) — **potwierdzone
w kodzie**. Jakość zapisu (`verification.md`, `measurement-negative-control.md`, korekty
w `requirements.md`) jest ponadprzeciętna: wszystkie odstępstwa są zapisane jako decyzje z liczbą,
a nie ukryte.

## Findings

### F1 — Odcisk cache'u pomija wszystko poza `SYSTEM_PROMPT` i schematem

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `agents/review/evals/cache.ts:44-51`
- **Detail**: `fingerprintPrompt(systemPrompt, jsonSchema)` liczy `sha256(SYSTEM_PROMPT ‖ REVIEW_JSON_SCHEMA)`
  i nic więcej. Poza kluczem zostaje wszystko pozostałe, co `runReview` realnie wysyła: dwa zdania
  instrukcji i `FENCE_LABEL` z `wrapDiff` (`prompt.ts:310-315`), `maxTurns: 2`, `tools: []`
  i routing `ANTHROPIC_BASE_URL` (`run-review.ts:239-249`). Docblock deklaruje „odcisk tego, co
  realnie jedzie do modelu poza samym materiałem" — a to jest węższe niż deklaracja.
  **Scenariusz awarii jest już zaplanowany w tym samym dokumencie**: Open Risk 4 zapowiada podniesienie
  `maxTurns` (gemini padło na `error_max_turns`). Ktoś podnosi limit do 3, odpala `npm run eval`,
  dostaje cztery `TRAFIENIE` i zieloną tabelę ze STARYCH wyników — czyli dokładnie „nieświeży wynik
  z cache'u wyglądający jak zielona bramka", nazwany w planie jako RYZYKO PIERWSZEJ KATEGORII.
  `cache.test.ts` (ii) dowodzi unieważnienia wyłącznie dla `SYSTEM_PROMPT`, więc kontrola pozytywna
  tej osi nie dotyka.
- **Fix A ⭐ Recommended**: wciągnąć do `fingerprintPrompt` odcisk realnie wysyłanej wiadomości
  (`wrapDiff("", "FIXED-NONCE")` — kształt bez nonce'u) oraz stałych wywołania (`maxTurns`, `tools`).
  - Strength: klucz przestaje być węższy niż wywołanie PRZEZ KONSTRUKCJĘ, tą samą metodą, którą
    plan wybrał dla `ANTHROPIC_*` (jedna kopia zamiast czujności autora).
  - Tradeoff: jednorazowe unieważnienie całego cache'u (trzy komórki, ~0,08 USD przy następnym
    zimnym przejściu); trzeba dopisać do `cache.test.ts` przypadek na tę drugą oś.
  - Confidence: HIGH — `wrapDiff` przyjmuje nonce jako argument właśnie po to, by dało się go
    zdeterminizować (`prompt.ts:299`), więc szew już istnieje.
  - Blind spot: nie sprawdziłem, czy `REVIEW_JSON_SCHEMA` jest stabilny bajtowo między wersjami
    zoda — jeśli nie, dołożenie osi zwiększa częstotliwość fałszywych PUDEŁ.
- **Fix B**: zostawić klucz, ale uczynić obowiązek podbicia `CACHE_FORMAT_VERSION` jawnym —
  komentarz przy `maxTurns`/`wrapDiff` plus przypadek w `cache.test.ts`.
  - Strength: zero kosztu, zero unieważnienia, natychmiastowe.
  - Tradeoff: przenosi gwarancję na czujność autora — dokładnie ta klasa, którą `lessons.md`
    („Gwarancja w workflow należy do konfiguracji PLIKU") zapisało jako defekt.
  - Confidence: MEDIUM — działa, dopóki ktoś pamięta.
  - Blind spot: nie ma bramki, która by to wyłapała.
- **Decision**: **FIXED via Fix A** — z zaostrzeniem wniesionym przez użytkownika w triage'u:
  nowe przypadki mają dowodzić **PUDŁA**, nie trafienia, a każda nowa oś potrzebuje **własnej
  mutacji** czerwieniącej dokładnie swój przypadek i tylko jego. Zrealizowane:
  - `run-review.ts` — `tools`/`maxTurns` wyniesione do eksportowanego `FIXED_CALL_OPTIONS`
    (jeden egzemplarz, bo drugim czytelnikiem jest odcisk cache'u).
  - `cache.ts` — `fingerprintPrompt` bierze `CallFingerprintParts` z **czterema** osiami
    (`systemPrompt`, `jsonSchema`, `userMessageShape`, `callOptions`) + `FINGERPRINT_NONCE`.
  - `provider.ts` — `productionPromptFingerprint()` składa wszystkie cztery ze źródeł, którymi
    jedzie `runReview` (`wrapDiff("", FINGERPRINT_NONCE)`, `FIXED_CALL_OPTIONS`).
  - `cache.test.ts` — +7 przypadków: `(ix/<oś>)` × 4 (zmiana → inny KLUCZ), `(x)` kontrola
    pozytywna przez mutację funkcji odcisku, `(xi/<oś>)` × 2 dla nowych osi na PRAWDZIWYM
    magazynie (PUDŁO, model wołany drugi raz).
  - **Para dowodowa wykonana**: odcisk ślepy na `callOptions` → **3 czerwone**
    (`ix/callOptions`, `x`, `xi/callOptions`), zero kolateralnych; ślepy na `userMessageShape`
    → **3 czerwone** (`ix/userMessageShape`, `x`, `xi/userMessageShape`), zero kolateralnych;
    po przywróceniu **64/64 zielone**. `typecheck` zielony.
  - Koszt: jednorazowe unieważnienie trzech wpisów cache'u — następne przejście macierzy będzie
    zimne (~0,08 USD). Zapisane, nie ukryte.

### F2 — Fallback `--omit=dev` zdecydowany jako TAK, ale nieotwarty i niewidoczny w `change.md`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `agents/review/package.json:23`, `verification.md:180`, `change.md` (sekcja „Dług zapisany jawnie")
- **Detail**: Faza 4 §1 ustawiła PRÓG (≥ 15 s mediany lub ≥ 25%) i zobowiązała: przekroczenie →
  fallback otwarty jako OSOBNA zmiana **przed zarchiwizowaniem tej**. Próg przekroczony
  dwudziestopięciokrotnie: mediana `npm ci` 5 758 → 38 302 ms, `node_modules` 392 MB → 2 099 MB,
  lock 141 → 827 paczek (zweryfikowane osobiście). `verification.md:180` zapisuje „**DECYZJA:
  fallback TAK**" — ale (a) nie istnieje folder zmiany pod `context/changes/`, (b) sekcja „Dług
  zapisany jawnie" w `change.md` wymienia **wyłącznie** dług workflow evali, nie ten. To jest
  jedyne miejsce, do którego zagląda `/10x-archive` i następny czytelnik — obowiązek żyje dziś
  w 860-liniowym `verification.md`, czyli tam, gdzie się go nie znajdzie.
  Ubocznie: komentarz `action.yml:124-126` („~335 MB rozpakowane") jest teraz nieprawdziwy o rząd
  wielkości i leży na ścieżce produkcyjnej.
- **Fix**: przenieść zobowiązanie do `change.md` (sekcja „Dług zapisany jawnie", obok długu
  workflow evali, z tym samym kształtem: nazwa + warunek zamknięcia + liczba) i otworzyć zmianę
  przez `/10x-new` przed archiwizacją. Liczbę w `action.yml:124-126` poprawić przy tamtej zmianie,
  nie tutaj — to ścieżka produkcyjna.
- **Decision**: **FIXED (zapis)** — wariant „tylko change.md, bez zakładania folderu”, wybrany
  w triage’u. Dług dopisany do sekcji „Dług zapisany jawnie” obok długu workflow evali, z trzema
  LICZBAMI zamiast oceny (mediana `npm ci` 5 758 → 38 302 ms, `node_modules` 392 → 2 099 MB,
  lock 141 → 827 paczek) i z warunkiem zamknięcia sformułowanym jako CZYNNOŚĆ Z DOWODEM:
  `tsx` → `dependencies` + `npm ci --omit=dev` w composite action **plus para dowodowa na PR-ze**,
  bo to ścieżka produkcyjna i nie wolno jej domknąć samym commitem. Założenie folderu zmiany
  (`/10x-new`) zostaje po stronie użytkownika. Komentarz `action.yml:124-126` („~335 MB”) —
  świadomie NIE ruszony tutaj: to plik na ścieżce produkcyjnej, poprawka należy do tamtej zmiany.

### F3 — `runEval` spawnuje promptfoo bez `timeout`, a job bramki nie ma `timeout-minutes`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `agents/review/evals/report.ts:438-444`, `.github/workflows/agents-gate.yml:48`
- **Detail**: `spawnSync(process.execPath, [...])` bez opcji `timeout`. Deklarowany limit
  w `report.test.ts:198` (`{ timeout: 300_000 }`) jest opcją `node:test`, a `spawnSync` blokuje
  pętlę zdarzeń — timer nie ma jak wystrzelić, dopóki dziecko nie wróci. Job `gate` też nie ma
  `timeout-minutes`, więc zawieszony promptfoo (padnięta sieć na PUDLE cache'u, zablokowany zapis
  `cache.json`) dobija do domyślnych 6 h runnera. Wzorzec w repo istnieje po obu stronach
  i nie został tu zastosowany: `review-cli.test.ts:116` ma `timeout: 60_000` przy tym samym
  `spawnSync`, `eval.yml:150` ma `timeout-minutes: 30`.
- **Fix**: dodać `timeout` + `killSignal` do `spawnSync` w `runEval` i `timeout-minutes` do joba
  `gate`.
- **Decision**: **FIXED** — `runEval(extraArgs, timeoutMs = EVAL_TIMEOUT_MS)` z `timeout`
  i `killSignal: "SIGKILL"` (SIGTERM potrafi przespać proces wiszący na I/O). Wymiar wzięty ze
  ZMIERZONYCH przebiegów: 22-67 s na komórkę × 4 komórki ≈ 4,5 min, więc 20 min zostawia ~4×
  zapasu. `report.test.ts` (B) podaje własne 240 s — mniej niż jego `node:test` 300 s, żeby limit
  zadziałał w DZIECKU, zanim runner uzna przypadek za wiszący. `agents-gate.yml` dostał
  `timeout-minutes: 15` na JOBIE (a nie na kroku jak `eval.yml:150`, bo nie ma tu żadnego kroku
  `if: always()`, który limit krokowy miałby oszczędzić). `typecheck` zielony, **64/64**.

### F4 — `HARD_ASSERTIONS` i wpięcia w YAML-u zsynchronizowane ręcznie, nic tego nie pilnuje

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `agents/review/evals/assertions.ts:291-350`, `agents/review/evals/promptfooconfig.yaml:54-86`
- **Detail**: Rejestr sześciu asercji twardych, sześć adapterów i sześć wpięć w YAML-u są trzema
  ręcznie utrzymywanymi listami. `byId()` broni kierunku „adapter bez wpisu w rejestrze", ale nie
  broni kierunku ważniejszego: siódma asercja dodana do rejestru i wyeksportowana, a nie wpięta
  w YAML, byłaby zielono weryfikowana przez `assertions.test.ts` i **nigdy nie uruchomiona
  w prawdziwym przejściu**. To ta sama klasa, przed którą broni komentarz na górze pliku. Repo ma
  już wzorzec na taki ratchet: `criteria.json` + `git diff --exit-code` w composite action.
- **Fix**: test czytający `promptfooconfig.yaml` i sprawdzający, że każde `id` z `HARD_ASSERTIONS`
  ma odpowiadające `value: file://assertions.ts:<adapter>` (z uwzględnieniem `sampleDiffOnly`).
- **Decision**: **FIXED** — z warunkiem z triage’u: OBA kierunki plus własna kontrola pozytywna.
  `HardAssertion` dostało pole `adapter` (nazwa eksportu, którą wpina YAML) — zadeklarowane,
  nie wywnioskowane z `id`, bo to ono jest tym, co zapadka porównuje. Dwa nowe przypadki
  w `assertions.test.ts`:
  - **(R1)** każda asercja z rejestru: eksport istnieje, wpięcie występuje DOKŁADNIE raz, i leży
    w tym obszarze, który deklaruje `sampleDiffOnly` (`defaultTest` vs pod testem `sample.diff`).
  - **(R2)** kierunek odwrotny, którego broniło dotąd samo `byId`: konfiguracja nie wpina niczego
    spoza rejestru — obserwacja MIĘKKA wpięta jako `assert:` przestałaby być miękka.
  - Sprawdzenie jest TEKSTOWE, nie przez parser: `js-yaml` jest w tym pakiecie zależnością
    tranzytywną promptfoo, więc import z niego byłby fantomem w locku. Ceną jest ryzyko „czyta
    pusto i zieleni się na wszystkim” — zamknięte asercją `wired > 0` w obu przypadkach.
  - **Trzy kontrole pozytywne, wykonane realnie:** (A) usunięte wpięcie `notesNonEmpty` → R1+R2
    czerwone; (B) `swallowedErrorPair` przeniesione do `defaultTest` → **R1 czerwone, R2 zielone**
    (licznik się zgadza, więc czerwieni się dokładnie kontrola OBSZARU); (C) rozjechany kształt
    znacznika → R1+R2 czerwone na strażniku `wired > 0`. Po przywróceniu **66/66 zielone**,
    `typecheck` zielony.

### F5 — Faza 6 §2 zapisała decyzję jako BINARNĄ, implementacja wybrała trzecią drogę

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `plan.md:744-756` vs `agents/review/evals/assertions.ts:252-276`
- **Detail**: Faza 6 §2 daje dwie opcje: asercja twarda `=== null` albo „zniesienie różnicy
  asercją (wtedy zapisać, co dokładnie przestaje być bramkowane i dlaczego to jeszcze jest bramka)".
  Implementacja wybrała wariant C — obserwację MIĘKKĄ, raportowaną i niebramkującą. Wybór jest
  uzasadniony (twarda czerwieniłaby każde przejście na stanie zmierzonym i świadomie nienaprawionym)
  i udokumentowany w czterech miejscach naraz: `verification.md:648`, Open Risk 3 w planie,
  `assertions.ts:214-230`, `promptfooconfig.yaml:93-111`. **Nie jest to defekt — jest to
  nieoznaczona rozbieżność w samym planie**: ciało fazy 6 §2 nigdy nie zostało poprawione, więc
  czytelnik porównujący fazę z kodem widzi opcję, której faza nie autoryzuje, i musi dojść do
  Open Risks, żeby zrozumieć dlaczego.
- **Fix**: dopisać do fazy 6 §2 jedno zdanie odsyłające do Open Risk 3 („wariant C — obserwacja
  miękka — wybrany po pomiarze; uzasadnienie w Open Risks §3"), zgodnie z konwencją korekt użytą
  w `requirements.md`.
- **Decision**: **FIXED** — blok `⛑ KOREKTA PO POMIARZE` dopisany pod kontraktem fazy 6 §2,
  OBOK oryginalnego akapitu, nie zamiast niego (ta sama konwencja co korekty w `requirements.md`).
  Nazywa wariant C, mówi wprost, czego „binarne” ujęcie nie obejmowało — model odrzucił samą
  REGUŁĘ, a nie pomylił się co do materiału — i odsyła do Open Risk 3 po warunek awansu
  na asercję twardą.

### F6 — `runEval` ignoruje `child.error`: nieudany spawn raportuje się jako problem z plikiem wyniku

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `agents/review/evals/report.ts:438-452`
- **Detail**: Gdy proces w ogóle się nie uruchomi (ENOENT, EPERM), `child.status` jest `null`
  → `exitCode = 1` (fail-closed, dobrze), ale jedyny komunikat brzmi „nie udało się wczytać wyniku
  przejścia z …results.json", a raport pokazuje brak wierszy. Operator dostaje diagnozę o pliku
  wyniku zamiast o nieudanym spawnie. `review-cli.test.ts:123` przy tym samym `spawnSync` sprawdza
  `child.error` jawnie.
- **Fix**: wypisać `child.error.message` (albo rzucić) przed próbą odczytu pliku wyniku.
- **Decision**: **FIXED** — diagnoza wyniesiona do czystej funkcji `describeSpawnFailure(error, timeoutMs)`
  (stąd jej test) i wypisywana PRZED próbą odczytu pliku wyniku. Rozróżnia dwa przypadki, których
  kod wyjścia nie odróżnia: **limit czasu** (`ETIMEDOUT`, z liczbą ms i zdaniem „to nie jest
  wynik”) i **proces, który się nie uruchomił** (kod + treść błędu + podpowiedź o `npm ci`).
  Cztery przypadki w `report.test.ts` (A14-A17): brak błędu → brak komunikatu; limit → nazwany
  jako limit i NIE jako problem z plikiem; ENOENT → cytuje kod i treść i NIE udaje limitu;
  błąd bez pola `code` → nadal komunikat, nie ciche `undefined`. **70/70**, `typecheck` zielony.

### F7 — 7.3 zamyka CZYNNOŚĆ, nie pomiar: bramka nigdy nie widziała faz 5-7

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `plan.md` `## Progress` 7.3
- **Detail**: Gałąź jest **9 commitów przed `origin/code-review-evals`** (zdalny czubek to
  `b87f897`, czyli koniec fazy 4). `agents-gate.yml` nie przejechał więc ani przez fazę 5
  (`assertions.ts`, `promptfooconfig.yaml`, fikstury), ani 6, ani 7 — a to są 1 500+ linii kodu
  objętego bramką. `change.md` mówi o tym wprost i jest to jedyna z sześciu otwartych pozycji,
  którą zamyka czynność, a nie pomiar. Lokalnie zweryfikowałem `typecheck` i `test` jako zielone,
  ale `lessons.md` („Gwarancja w workflow…") mówi wprost: próbę czerwieni robi się NA TEJ ŚCIEŻCE,
  na której bramka żyje, nie lokalnie. Pozostałe pięć pozycji (6.1, 6.2, 7.1, 7.2, 7.5) jest
  otwartych słusznie i nie ma tu nic do naprawienia.
- **Fix**: wypchnąć gałąź i potwierdzić zielony przebieg `agents-gate.yml` — wtedy 7.3 zamyka się
  pomiarem.
- **Decision**: **FIXED** — gałąź wypchnięta zwykłym gitem (`b87f897..74346b0`, hook `pre-push`
  przeszedł, bez `--no-verify`). **`Agents gate` przebieg 32637270773 — success** na czubku
  zawierającym fazy 5-7 ORAZ wszystkie poprawki z tego triage’u. Zieleń sprawdzona jako
  NIEPUSTA: floor na wykrywanie wypisał w logu plan TAP **`1..70`** i `# pass 70 / # fail 0`.
  `## Progress` 7.3 odhaczone — pomiarem, nie czynnością. Pozostałe pięć pozycji (6.1, 6.2,
  7.1, 7.2, 7.5) zostaje otwartych i tak ma zostać.

### F8 — `runReview` przestawia globalny `process.env` wewnątrz procesu promptfoo

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `agents/review/run-review.ts:225-231`
- **Detail**: Trzy przypisania `ANTHROPIC_*` są celowo jedyną kopią prekondycji (to jest dobra
  decyzja i F1 opiera się na tej samej zasadzie), ale w evalu `runReview` biega WEWNĄTRZ procesu
  promptfoo, więc mutuje środowisko całego przebiegu. Dziś nieszkodliwe — zestaw nie ma ani jednego
  gradera LLM, a plan wyklucza `llm-rubric` jako decyzję. W chwili, w której ktoś tę decyzję cofnie,
  grader Anthropica pojedzie na `ANTHROPIC_API_KEY=""` i na endpoincie OpenRoutera, a diagnostyka
  będzie wyglądać na problem z uprawnieniami.
- **Fix**: dopisać to sprzężenie do uzasadnienia braku `llm-rubric` w `assertions.ts` — jedno
  zdanie tam, gdzie przeczyta je autor przyszłego gradera.
- **Decision**: PENDING

## Co NIE jest znaleziskiem — zweryfikowane i czyste

- **Sekrety**: nic nie loguje `ANTHROPIC_AUTH_TOKEN`; `writeCell` zapisuje wyłącznie `review`
  - `metrics`; `metadata` providera nie niesie poświadczeń; `agents-gate.yml` nie ma żadnego
    sekretu ani artefaktu, więc konwencja „sekret na KROK" z `eval.yml` go nie dotyczy.
- **Prompt injection**: materiał jedzie przez `wrapDiff`, nie przez `prompt:` promptfoo;
  `loadFixture` odmawia głośno przy nierozwiniętym `file://`.
- **Command injection**: `spawnSync` bez `shell`, ścieżka promptfoo z `require.resolve`.
- **Granica `agents/**`\*\*: żaden nowy plik nie importuje przez nią w żadną stronę.
- **Falsyfikowalność asercji**: wszystkie sześć twardych ma mutację czerwieniącą JE i tylko je
  (`assertOnlyOneRed`); nie znalazłem asercji niezdolnej do czerwieni.
- **Ekstras poza planem** (`report.test.ts`, `SCORE_MIN`/`SCORE_MAX` w `review-schema.ts`,
  `ReviewFailure.kind`, floor TAP w bramce, kategoria „BRAK ZMIERZONY", tryb `--from`) — każdy
  uzasadniony w pliku i wymuszony przez kontrakt planu. Scope Discipline: PASS.
