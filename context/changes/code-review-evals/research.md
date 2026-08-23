---
date: 2026-08-23T00:05:00+02:00
researcher: lirdaw
git_commit: 97908add37dca7c628ebe51cbc5529eb7a2acbd8
branch: main
repository: lirdaw/10xcards
topic: "Zestaw evali (promptfoo) dla agenta code review — wykonalność, szew ekstrakcji, reżim kosztowy"
tags: [research, codebase, code-review-agent, evals, promptfoo, agent-sdk, cost-budget]
status: complete
last_updated: 2026-08-23
last_updated_by: lirdaw
---

# Research: zestaw evali dla agenta code review

**Data**: 2026-08-23T00:05:00+02:00
**Badacz**: lirdaw
**Commit**: `97908ad`
**Gałąź**: `main`
**Repozytorium**: lirdaw/10xcards

## Research Question

Zbadać wykonalność zestawu evali promptfoo dla agenta code review wg
`context/changes/code-review-evals/requirements.md`: szew ekstrakcji `runReview`,
reżim kosztowy, fikstury, wzorzec workflow — oraz (na wyraźne życzenie) porównać
promptfoo z istniejącym w repo harnessem evali na vitest i zweryfikować zewnętrznie
tezy techniczne o promptfoo.

## Summary

Wymagania są w większości trafne, a ich najostrzejsze decyzje (prawdziwy `runReview`,
odrzucenie wariantu „goły prompt", osobny klucz, mała fikstura, kontrola negatywna)
bronią się dowodami. Badanie zmienia jednak siedem rzeczy — pięć z nich przed pisaniem
planu, nie po.

1. **Miejsce zestawu jest przesądzone przez granicę `agents/`, nie przez preferencję.**
   `agents/review` to OSOBNY projekt npm z własnym lockiem; SDK nie ma w rootowym
   `package-lock.json`. Eval pod `evals/` importujący agenta zadziała lokalnie i padnie
   po `npm ci` w CI. To ograniczenie twarde, zweryfikowane osobno.
2. **Istniejący harness `evals/` jest dla review PUŁAPKĄ KLUCZOWĄ, nie skrótem.** Jego
   preflight żąda `OPENROUTER_API_KEY` na dwóch szwach, a review ma jechać na
   `ANTHROPIC_AUTH_TOKEN` / `OPENROUTER_REVIEW_KEY` — `review.ts` wprost zakazuje klucza
   evala. Wsadzenie review do `evals/` tworzy drugą ścieżkę **konfiguracją, nie kodem**.
3. **Cztery tezy o promptfoo z wymagań: wszystkie POTWIERDZONE** — plus jedna korekta
   ostrzejsza od zapisanej: koszt sędziego `llm-rubric` **nie występuje w wyniku promptfoo
   w ogóle** (tylko tokeny pod `tokenUsage.assertions`). Formuła budżetu z wymagania 5
   musi być składana ręcznie.
4. **promptfoo ma wbudowany provider `anthropic:claude-agent-sdk`**, który cachuje i raportuje
   koszt — ale użycie go to wariant ODRZUCONY w przebraniu: testowałby kopię agenta, nie
   `runReview`. Warto go nazwać w planie i odrzucić świadomie, bo wygląda jak darmowy skrót.
5. **„~55 tys. tokenów na przebieg" nie ma źródła** — zero trafień w archiwum. Liczby
   docelowe z wymagań i tak się bronią, ale z INNEGO powodu, i kotwicą jest pomiar **lokalny**
   (0,1847 USD za komórkę sonnetową), bo wymaganie 8 każe iterować lokalnie.
6. **Trzy korekty do fikstur**: materiał kontroli negatywnej NIE ISTNIEJE jako plik;
   defekt „dopasowanie po podciągu" agent ocenił pod **kryterium 3**, nie 8; przebieg
   32596615686 to zapisany **fałszywy alarm**, nie wykrycie.
7. **Cała premisa taniej kolumny jest NIEZMIERZONA.** W archiwum nie ma ani jednego przebiegu
   tego harnessu na modelu innym niż `anthropic/claude-sonnet-4.6`.

## Detailed Findings

### 1. Szew ekstrakcji `runReview` — co dokładnie trzeba rozciąć

`agents/review/review.ts` (289 linii) ma **jeden eksport** (`FailureKind`, `:107`) i żadnej
eksportowanej funkcji. Import tego pliku dziś uruchamia osiem efektów ubocznych i kończy się
blokadą na stdin.

| Efekt uboczny                                                                        | Linie      | Dokąd należy                                          |
| ------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------- |
| `REVIEW_MODEL` z env, z pinem jako domyślną                                          | `:19`      | **wstrzyknąć** (czytane w `:221` i `:250`)            |
| `resolveMaxBudgetUsd()` — `console.error` + `process.exit(1)`                        | `:78-89`   | **rozciąć**: decyzja czysta, `exit` do wrappera       |
| `REVIEW_MAX_BUDGET_USD = resolveMaxBudgetUsd(...)` na module scope                   | `:91`      | **wstrzyknąć** — dziś sam import może ubić proces     |
| `classifyFailure()` — czysta                                                         | `:110-121` | funkcja wydzielona (i wyeksportować)                  |
| `reportFailureKind()` → `appendFileSync($GITHUB_OUTPUT)`                             | `:124-135` | wrapper — ale wołane Z WNĘTRZA pętli (`:244`, `:273`) |
| walidacja znaku nowej linii w modelu + `appendFileSync("model=")` + 2× `exit`        | `:137-159` | wrapper (celowo PRZED wywołaniem modelu)              |
| bramka klucza `ANTHROPIC_AUTH_TOKEN` + `exit(1)`                                     | `:173-186` | wrapper — ale jej UMIEJSCOWIENIE jest wartością       |
| `process.env.ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY = ""` | `:189-194` | **globalna prekondycja procesu**, nie argument        |
| `readDiff()` ze stdin                                                                | `:197-201` | wrapper                                               |
| linia `[konfiguracja]` na stderr                                                     | `:206-209` | wrapper — jest KONTRAKTEM pary dowodowej              |
| `async function review(diff)` — nieeksportowana                                      | `:211-281` | **to jest funkcja do wydzielenia**                    |
| top-level `await` + `exit` + jedyny `console.log`                                    | `:283-288` | wrapper                                               |

Wewnątrz samej funkcji: wywołanie `query()` z `tools: []`, `maxTurns: 2`,
`outputFormat: { type: "json_schema", schema: REVIEW_JSON_SCHEMA }` (`:212-229`); orakl sukcesu
na DWÓCH polach `subtype === "success"` oraz `is_error !== true` (`:239`); walidacja zodem
(`:242-246`); linia metryk (`:249-262`); klasyfikacja awarii i rzut z rodzajem w treści
(`:267-277`).

**Najostrzejszy szew to `:189-194`.** `ANTHROPIC_API_KEY = ""` jest obowiązkowe: niepuste
wygrywa z tokenem auth. Jeśli eval ustawi te trzy zmienne gdzie indziej (własny preflight,
`globalSetup`, `.env`), oba wywołania jadą **do innego endpointu z inną precedencją poświadczeń**
— ta sama funkcja, inny dostawca, i nic w wyniku tego nie mówi.

**Dziś nie ma ŻADNEGO testu na `review.ts`.** `prompt.test.ts` pokrywa wyłącznie `prompt.ts`
(6 przypadków pod `node:test`, potwierdzone), a `tests/lib/review-criteria.test.ts` i
`review-verdict.test.ts` pokrywają stronę konsumenta. Nie istnieje więc sygnał, który
zauważyłby rozjazd wydzielonej funkcji ze skryptem — ekstrakcja musi przynieść własny dowód,
np. zostawiając `review.ts` wrapperem tak krótkim, że nie zmieści logiki.

**Zapadka promptu nie stoi na drodze**: `prompt-sources.json` hashuje SEKCJE ŹRÓDŁOWE
(`AGENTS.md` §Hard Rules, §Conventions, `test-plan.md` §2), nigdy `prompt.ts` ani `review.ts`.
Zaświeci tylko wtedy, gdy ta zmiana ruszy tamte sekcje — a wtedy obowiązuje kolejność
z `AGENTS.md`: najpierw destylat, potem `--write`.

### 2. Gdzie ten zestaw może fizycznie mieszkać

To jest ustalenie, które przesądza architekturę, i zweryfikowałem je poza agentem:

- `node_modules/@anthropic-ai/claude-agent-sdk` istnieje w roocie w wersji **0.3.237**,
  a rootowy `package-lock.json` ma **zero** wystąpień „anthropic".
- Root `package.json` **nie ma `workspaces`**; `agents/review/` ma własny `package-lock.json`
  (27 odwołań do SDK) i własne `node_modules`.

Czyli rootowa instalacja SDK jest **przypadkowa i nieodtwarzalna** — `npm ci` w CI ją wytnie.

Pokrycie narzędziami (z konfiguracji, nie z założenia):

|                     | nowy moduł w `agents/review/`                      | nowy katalog `evals/`              |
| ------------------- | -------------------------------------------------- | ---------------------------------- |
| `npm run typecheck` | **NIE** (`tsconfig.json:4` wyklucza `agents`)      | TAK                                |
| `npm run lint`      | **NIE** (`eslint.config.js:130` ignoruje `agents`) | TAK                                |
| `npm test`          | NIE                                                | NIE                                |
| `npm run eval`      | —                                                  | TAK, ale `globalSetup` żąda klucza |

Z tego wychodzi rozwidlenie, którego wymagania nie rozstrzygają, a plan musi:

- **(a) zestaw wewnątrz `agents/review/`** — jedna instalacja SDK, jeden lock, ta sama ścieżka
  co CI; cena: kod niewidziany przez `tsc` ani ESLint.
- **(b) zestaw pod `evals/` + SDK w rootowych zależnościach** — typecheck i lint działają;
  cena: **dwie niezależne instalacje ~335 MB tego samego SDK, swobodne do rozjazdu wersji**,
  bo `action.yml:117` cachuje po locku agenta, a eval rozwiązywałby z rootowego.

**Pułapka klucza (druga ścieżka tworzona konfiguracją).** `vitest.eval.config.ts:45` →
`evals/setup/eval-preflight.ts:39-52` twardo żąda `OPENROUTER_API_KEY` na dwóch szwach.
Review ma jechać na `ANTHROPIC_AUTH_TOKEN`, a `review.ts:176-182` i `pr-review.yml:351`
wprost zabraniają kierowania go na `OPENROUTER_EVAL_KEY`. Eval review umieszczony w `evals/`
byłby więc silnie ciągnięty na ZŁY klucz o ZŁYM capie. To jest dokładnie klasa z lekcji
„Preflight musi domknąć KAŻDY nielokalny szew".

### 3. promptfoo — weryfikacja czterech tez (wersja 0.122.0, Node ≥ 22.22.0)

| Teza z `requirements.md`                                                                                         | Werdykt          |
| ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| Custom provider JS **nie jest** cachowany własnym cache'em promptfoo                                             | **POTWIERDZONA** |
| `cost`/`tokenUsage` musi zwrócić sam provider                                                                    | **POTWIERDZONA** |
| Sędzia `llm-rubric` to osobne wywołanie; model przez `defaultTest.options.provider` lub `provider:` przy asercji | **POTWIERDZONA** |
| Asercje `javascript` nad structured output są deterministyczne i darmowe                                         | **POTWIERDZONA** |

Rejestr providerów tylko instancjonuje i woła moduł — brak opakowania cache'em; ewaluator
wyłącznie CZYTA `response.cached`, nigdy go nie ustawia. Cache dostają wywołania przez
`promptfoo.cache.fetchWithCache` albo provider deklarujący `cached: true` sam.
**Dla naszego przypadku `fetchWithCache` jest bezużyteczny** — Agent SDK nie idzie przez nasz
`fetch`; trzeba `getCache()` z własnym kluczem, wzorem `scriptCompletion.ts`.

Analogicznie koszt: ewaluator ma fallback dla `latencyMs`, ale **dla `cost` nie ma żadnego** —
provider, który go nie zwróci, daje ciche `0` w UI, w JSON-ie i w sumie przebiegu.

**Korekta ostrzejsza niż zapis w wymaganiach**: `GradingResult` niesie `tokensUsed`, ale
**nie ma pola `cost`**. Zużycie sędziego ląduje osobno, w tokenach, pod
`tokenUsage.assertions`; raportowana kwota (`metrics.cost`, `totalCost`) jest
**wyłącznie kosztem providera docelowego**. Kwoty sędziego nie ma nigdzie w wyniku promptfoo —
wymaganie 5 („ma być POLICZONY w budżecie") wymaga więc własnego przelicznika, nie odczytu.

Drobiazg, który przeciwdziała naturalnemu odruchowi: **`is-json` na wyjściu obiektowym jest
tautologią** (obiekt jest wcześniej serializowany do JSON-a). Kontrakt dziewięciopolowy sprawdza
się asercją `javascript`, która dostaje pełny `context.providerResponse` — i kosztuje zero.

**Ustalenie, którego wymagania nie znają: promptfoo ma wbudowany provider
`anthropic:claude-agent-sdk`** (alias `claude-code`), z konfiguracją `model`, `max_turns`,
`max_budget_usd`, `output_format`, i z gotowym cache'owaniem oraz raportowaniem
`total_cost_usd`. Wygląda jak darmowe domknięcie wymagań 6 i 9 — **ale jechałby własnym
wywołaniem SDK, nie naszym `runReview`**: bez `wrapDiff` z noncem, bez naszej walidacji zodem,
bez klasyfikacji awarii. To jest wariant odrzucony z sekcji „Wariant ODRZUCONY", tylko wchodzący
innymi drzwiami. Plan powinien go nazwać i odrzucić jawnie.

Reszta mechaniki potwierdzona: macierz to iloczyn `providers` × `tests`; ten sam plik JS można
wpiąć N razy z różnym `label` i `config` (to jest kształt na przemiatanie modeli); `.ts` ładuje
się natywnie przez loader `tsx`; `config` dociera **konstruktorem** (`options.config`), nie przez
`context` — więc provider musi być klasą, nie funkcją; trzeci argument `callApi` niesie
`abortSignal`, jest też hook `cleanup()`.

**Ryzyko wersji Node**: promptfoo deklaruje `engines: >=22.22.0`, a `.nvmrc` w repo to
**22.14.0**. Bez `.npmrc` i przy `engine-strict=false` to ostrzeżenie `EBADENGINE`, nie błąd;
CI pinuje `node-version: 22`, co `setup-node` rozwija do najnowszej 22.x, więc rozjazd dotyczy
wyłącznie lokalnego checkoutu — czyli dokładnie tego środowiska, w którym wymaganie 8 każe
iterować.

### 4. Reżim kosztowy — co naprawdę pokazują pomiary

**Liczba „~55 tys. tokenów na przebieg" nie występuje w archiwum ani razu** (grep: zero trafień).
Sama notatka wymagań uczciwie oznacza ją jako szacunek wejściowy i sama ją podważa. Zmierzone
kotwice, wszystkie dla `anthropic/claude-sonnet-4.6`:

| Przebieg                            | Wejście | `cache_creation` / `read` | Wyjście | `total_cost_usd` |
| ----------------------------------- | ------- | ------------------------- | ------- | ---------------- |
| A lokalnie (`sample.diff`, 1 486 B) | 34 728  | 34 135 / 0                | 3 492   | **0,1847**       |
| B1 lokalnie (ciepły cache)          | —       | 5 194 / 28 832            | 2 648   | 0,0718           |
| B2 lokalnie (zimny)                 | —       | 34 719 / 0                | 1 959   | 0,1636           |
| A na runnerze (ta sama fikstura)    | 10 946  | 10 937 / 0                | 3 201   | **0,0934**       |
| B na runnerze (diff 2 711 linii)    | —       | 47 206 / 8 298            | 8 342   | 0,4426           |

**Najważniejsza konsekwencja, której wymagania nie wyciągają: ta sama fikstura kosztuje
lokalnie 2× tyle co na runnerze** (0,1847 wobec 0,0934), przy 3,2× większym wejściu.
Skoro wymaganie 8 każe iterować lokalnie, właściwą kotwicą budżetu jest **0,1847 USD za komórkę
sonnetową** — a nie 0,0934. Szacunek ~$0,21 z tabeli wymagań jest więc **trafny**, tylko jego
uzasadnienie („55 tys. tokenów") jest zmyślone; realnym uzasadnieniem jest pomiar lokalny.

Drobna nieścisłość do poprawienia przy okazji: „na runnerze 10 946" to CAŁE wejście
(9 + 10 937), a nie zapis cache'u; zapis to 10 937. Rozrzut 3,2× jest policzony poprawnie,
bo dotyczy wejścia.

Ta sama korekta dotyczy argumentu za odrzuceniem wariantu taniego: „cztery piąte tego, za co
płacimy" to udział narzutu SDK **lokalnie (~79%)**; archiwum samo koryguje go dla CI do
**~33%**, i zapisuje jako otwarte, skąd bierze się lokalna nadwyżka ~24 tys. tokenów.
Argument zostaje w mocy dla przebiegów lokalnych — a to i tak jest środowisko zestawu.

Trzy rzeczy do zapisania w planie, żeby liczba nie kłamała (wymaganie 9 trafia w sedno):
`total_cost_usd` to przelicznik z cennika **Anthropica**, nie rachunek OpenRoutera; dla
gemini nie jest to nawet przybliżenie; a kwoty sędziego promptfoo nie policzy w ogóle.

### 5. Fikstury — trzy korekty i jedno gotowe źródło

1. **Materiał kontroli negatywnej NIE ISTNIEJE jako plik.** Wymagania mówią „materiał jest
   gotowy"; zweryfikowane: w repo są dokładnie dwa pliki `.diff` (`sample.diff`,
   `sample-injection.diff`), a `EmptyDeckState.astro` występuje wyłącznie w tekście
   `verification.md`. Przenosi się KONTRAKT, nie materiał: dwie zmiany czysto tekstowe,
   werdykt `pass`, kryteria 7 i 8 równe `null`. Ten `null` jest przy tym zaprojektowany —
   definicja „nie dotyczy" dla kryterium 7 wymienia zmianę wyłącznie w treści UI lub
   dokumentacji — więc fikstura MUSI być tekstowa, żeby `null` był legalny, a nie ratunkiem.
2. **Defekt „dopasowanie po podciągu" agent ocenił pod kryterium 3 (Złożoność), nie 8.**
   Zweryfikowane w `impl-review.md:138` i w `criteria.json` (poz. 3 = `complexity`,
   poz. 8 = `gateIntegrity`). Asercja „kryterium 8 poniżej progu" byłaby sprzeczna z jedynym
   zapisanym dowodem.
3. **Przebieg 32596615686 to zapisany FAŁSZYWY ALARM.** Agent zgłosił, że `wrapDiff` jest
   no-opem; stałe były różne i `wrapDiff` działał. Wartość leżała w tym, że zgłoszenie ujawniło
   groźniejszą klasę (obrona po cichu przepisywała recenzowany kod). Fikstura musi więc celować
   w wykrywanie klasy „obrona przepisuje materiał", nie odtwarzać tamtą treść zgłoszenia.

**Gotowe źródło fikstur, mocniejsze niż `appendFileSync`:** pięć folderów kończących się na
`-swallowed` w `context/archive/` — defekty klasy „połknięty błąd" (kryterium 7), które
faktycznie wjechały na `main`. Dla kryterium 8 analogicznie: `2026-08-02-typecheck-gate`,
`2026-07-27-schema-drift-test`, `2026-07-15-verification-harness`.

`sample-injection.diff` istnieje i jest zapisany jako otwarty przypadek czekający na ten zestaw
(„review agent nie ma zestawu evali"). Uwaga techniczna, której archiwum nie łączy: jego
„podrobiony znacznik" to STARY, stały ogranicznik — po poprawce nonce'owej nie podrabia już
aktualnego znacznika, więc jest dziś zwykłym wrogim tekstem. Nadal ważny jako próba injekcji.

**Szew pod wymaganie 6 jest gotowy w kodzie produkcyjnym:**
`prompt.ts:272` ma sygnaturę `wrapDiff(diff, nonce = makeFenceNonce())`, z komentarzem, że
`nonce` jest wstrzykiwalny WYŁĄCZNIE po to, by test był deterministyczny. Nonce nigdy nie trafia
do `SYSTEM_PROMPT`, więc deterministyczny klucz cache'u jest osiągalny bez dotykania produkcji.

### 6. Wzorzec workflow — do skopiowania z uzasadnieniami

`.github/workflows/eval.yml` (256 linii, ~150 to komentarz) niesie komplet decyzji, każdą
z powodem: `workflow_dispatch` jako jedyny wyzwalacz (bez kanału powiadomień i właściciela
nocny czerwony to alarm bez słuchacza); nigdy bramka (`grep` na `needs:`, `schedule:`,
`workflow_run:` daje 0); sekret **na krok**, bo w tym jobie biega `npm ci`, a Astro serializuje
całe `process.env` kroku do modułu `astro:env/server`; `concurrency` na samym `github.workflow`
z `cancel-in-progress: false` — to **serializacja, nie deduplikacja**, i przestaje działać przy
trzecim dispatchu; artefakt `if: always()`, bo zielona tabela JEST produktem; **przekierowanie,
nigdy potok** (`| tee` zmierzono jako kończące się kodem 0 na czerwonym przebiegu);
`sed` wycinający klucz, bo maskowanie GitHuba działa na LOGI, nie na artefakty.

Dwa martwe punkty zapisane wprost: `defaults: run: shell: bash` **nie jest** w tym pliku (plik
polega na domyślnym `bash -e` i jawnie o tym rozumuje) — a lekcja „Gwarancja w workflow należy
do konfiguracji PLIKU" każe nowemu plikowi go dodać; oraz `concurrency` shipowało
nieprzećwiczone („never contended").

### 7. Istniejący harness vs promptfoo

`evals/` to własny harness na vitest (`npm run eval` = `vitest run -c vitest.eval.config.ts`).
Ma już: matrycę przypadków z fikstur, sędziego LLM ze structured output i walidacją zodem,
sędziego z innej rodziny modeli (przeciw samoocenie), progi z nazwanymi metrykami
**dodatkowo pokryte testami jednostkowymi w `npm test`**, renderowaną tabelę i zapis per-karta,
niezerowy kod wyjścia, dwie klasy retry, timeouty na trzech poziomach oraz komplet wzorca CI.

Czego mu brakuje, a co promptfoo daje z pudełka: **koszt i tokeny per komórka** (dziś zero kodu
czyta `usage`; kwoty czytano ręcznie z API klucza), powtórzenia i moc statystyczna,
porównanie wielu modeli obok siebie w jednym przebiegu, historia i porównanie przebiegów,
web viewer, bogatsze typy asercji, cache między przebiegami.

**Rekomendacja.** Iść promptfoo — ale z jawną świadomością, że dla NASZEGO przypadku znosi on
mniej, niż się wydaje. Trzy z czterech rzeczy, które by kupował, i tak trzeba dopisać ręcznie
w providerze (cache, koszt, tokeny), bo custom provider JS niczego z tego nie dostaje za darmo;
kwoty sędziego nie policzy nawet wtedy. Realnym zyskiem zostaje **macierz `providers` × `tests`
w jednym przebiegu z tabelą per komórka** — czyli dokładnie to, o co pyta pytanie 2 z wymagań
i czego harness vitestowy nie umie bez dwóch dispatchy i ręcznego diffowania dwóch logów.
To wystarcza, żeby decyzję obronić; nie wystarcza, żeby traktować promptfoo jako oszczędność
pracy. Gdyby jednak macierz modeli okazała się niewykonalna (patrz Open Questions), przewaga
promptfoo znika i tańszą drogą jest trzeci plik `.eval.ts` w istniejącym harnessie — z tym
zastrzeżeniem, że wtedy trzeba rozwiązać pułapkę klucza z §2.

## Code References

- `agents/review/review.ts:19,78-91,110-135,137-159,173-194,197-209,211-281,283-288` — efekty uboczne i funkcja do wydzielenia
- `agents/review/prompt.ts:230-232,270-272,294` — `makeFenceNonce`, wstrzykiwalny nonce, `SYSTEM_PROMPT`
- `agents/review/prompt.test.ts` — 6 przypadków pod `node:test`, jedyne pokrycie w `agents/`
- `agents/review/review-schema.ts:43-190,238-262` — dziewięć kryteriów, dwa warunkowe, JSON Schema
- `agents/review/package.json:7-20` — osobny projekt npm, `tsx`, własne zależności
- `.github/actions/review-agent/action.yml:113-117,138-146,161-167,188-189,209-224` — cache po locku agenta, bramka driftu `criteria.json`, wywołanie przez przekierowania, scrub
- `.github/workflows/pr-review.yml:269,280-286,315,351,364-374` — fikstura, filtr diffa, cap 250 000 B, zakaz klucza evala
- `.github/workflows/eval.yml:28-34,51-69,74-85,99-111,144-162,176-186,247-256` — wzorzec dispatchu do skopiowania
- `scripts/review-verdict.ts:32-35` — `SCORE_THRESHOLD = 5`, celowo poza promptem
- `evals/setup/eval-preflight.ts:39-52` — żądanie `OPENROUTER_API_KEY` na dwóch szwach
- `evals/lib/judge.ts:31,44,124-178,205-208` — sędzia, retry, structured output; brak odczytu `usage`
- `evals/lib/scoring.ts:46-49,97-132` — progi i werdykt przebiegu
- `vitest.eval.config.ts:39-48` — `include`, `globalSetup`, timeouty
- `tsconfig.json:3-4`, `eslint.config.js:130` — wykluczenie katalogu `agents`

## Architecture Insights

- **Granica katalogu `agents` jest realna i kosztowna w obie strony.** Chroni agenta przed
  tsconfigiem aplikacji i pozwala mu mieć własny lock, ale zostawia go bez typechecku i lintu.
  Każdy pomysł „eval zaimportuje agenta" rozbija się o tę granicę albo o `npm ci`.
- **Kontrakty tego agenta są STRINGOWE, nie strukturalne.** Rodzaj awarii jedzie w treści rzutu,
  a workflow grepuje stderr; metryki istnieją wyłącznie jako linia tekstu na stderr. Eval, który
  zacznie asertować na strukturze, przestanie pilnować tego, co czyta CI.
- **Stdout jest kontraktem** (`--silent` plus jeden `console.log`). Dodanie logowania „dla wygody
  evala" psuje wyłącznie CI — bo eval czyta wartość zwracaną, nie strumień.
- **Randomizacja i cache współistnieją celowo**: nonce siedzi tylko w wiadomości użytkownika,
  więc prefiks cache'u zostaje bajt w bajt. Ten sam projekt daje evalowi deterministyczny klucz
  bez dotykania produkcji.
- **Powtarzający się wzorzec repo: para dowodowa z jedną zmienną różnicy, która nie może po cichu
  zniknąć.** Odmowa zamiast fallbacku w `resolveMaxBudgetUsd`, druk zmiennej różnicy na stderr
  PRZED wywołaniem (bo metryki drukują się tylko na ścieżce sukcesu). Zestaw evali powinien
  odziedziczyć ten wzorzec, nie wynaleźć własny.

## Historical Context (from prior changes)

- `context/archive/2026-08-21-ci-cd-code-review/verification.md:459` — „review agent nie ma
  zestawu evali (`evals/` obsługuje generację fiszek, nie review)" — potwierdzone dosłownie
- `context/archive/2026-08-21-ci-cd-code-review/verification.md:23-39,144-162` — obie tabele pomiarowe (lokalna i runnerowa)
- `context/archive/2026-08-21-ci-cd-code-review/verification.md:236-245` — korekta udziału narzutu SDK: ~79% lokalnie, ~33% w CI
- `context/archive/2026-08-21-ci-cd-code-review/verification.md:673-740` — para dowodowa bramki budżetowej
- `context/archive/2026-08-21-ci-cd-code-review/verification.md:742-804` — pełny zapis defektu `wrapDiff` i poprawki nonce'owej
- `context/archive/2026-08-21-ci-cd-code-review/verification.md:120-123,247-252` — próg 5 jako wartość startowa, dwukrotnie
- `context/archive/2026-08-21-ci-cd-code-review/reviews/impl-review.md:37-38,138,163` — trzy defekty znalezione przez agenta review
- `context/archive/2026-08-21-ci-cd-code-review/plan.md:101-109` — incydent 402 (przebieg 32534464639) i rozdział kluczy
- `context/archive/2026-08-21-ci-cd-code-review/plan-brief.md:126-127` — najbliższe wprost zamówienie na ten zestaw
- `context/archive/2026-08-02-eval-ci-dispatch/` — wzorzec dispatchu, incydent BOM-u (koszt $0),
  falsyfikacja uzasadnienia `run_attempt` przez `gh run rerun`

## Related Research

- `context/archive/2026-08-21-ci-cd-code-review/research.md` — badanie pod samego agenta review
- `context/archive/2026-08-02-eval-ci-dispatch/research.md` — badanie pod workflow evala
- `context/foundation/test-plan.md` §6.6 — zapis fazy 5 (AI-native) wraz z listą „czego to nie dowodzi"

## Open Questions

1. **Czy tanie modele w ogóle jadą przez ten harness?** To jest pytanie blokujące dla macierzy
   2×2. Agent SDK mówi protokołem Anthropica; my kierujemy go na OpenRoutera. Czy
   `google/gemini-2.5-flash` i `anthropic/claude-haiku-4.5` obsłużą tą drogą
   `outputFormat: { type: "json_schema" }` oraz cache'owanie prefiksu? **W archiwum nie ma ani
   jednego przebiegu na modelu innym niż sonnet-4.6**, a jedyny przebieg z innym modelem użył
   celowo NIEISTNIEJĄCEGO id (`…-nie-istnieje`) i skończył się `api_error` od providera — więc
   nie mówi o tym nic. Najtańszy możliwy pierwszy krok: jeden przebieg z
   `REVIEW_MODEL=anthropic/claude-haiku-4.5` na `sample.diff`, lokalnie. Póki to nie jest
   zmierzone, cała tabela kosztów z wymagań opisuje modele, o których nie wiadomo, czy zwrócą
   kontrakt.
2. **Gdzie fizycznie mieszka zestaw** — wariant (a) wewnątrz `agents/review/` czy (b) pod
   `evals/` z SDK w roocie. Rozstrzygnięcie należy do planu; badanie daje cenę obu.
3. **Czy `runReview` zwraca metryki jako dane, a jeśli tak — czy wrapper nadal drukuje
   IDENTYCZNE linie na stderr?** Composite action i workflow je czytają; przeredagowanie ich
   przy okazji „czystego refaktoru" jest zmianą zachowania.
4. **Jak liczyć koszt komórki dla modeli nie-Anthropic**, skoro `total_cost_usd` jest wtedy ceną
   innego modelu, a promptfoo nie policzy niczego za custom provider. Wymaganie 9 stawia warunek;
   źródło cennika (statyczna tabela w repo czy endpoint generacji OpenRoutera) pozostaje
   nierozstrzygnięte.
5. **Czy fikstury odtwarzać jako syntetyczne diffy, czy wycinać realne z pięciu zmian
   kończących się na `-swallowed`?** Te drugie są mocniejsze (defekty faktycznie wjechały na
   `main`), ale są większe, a wymaganie 4 każe trzymać fikstury małe.
