---
date: 2026-08-23T15:48:22+02:00
researcher: lirdaw
git_commit: 970af2be96476c0063ae52dadbb5bb409b027534
branch: review-eval-gate
repository: lirdaw/10xcards
topic: "Zapadka regresji na zmianach promptu agenta review — odcisk, cache, dom zapadki, miejsce na dowód"
tags: [research, codebase, code-review-agent, evals, promptfoo, cache-fingerprint, ci-gates, ratchet]
status: complete
last_updated: 2026-08-23
last_updated_by: lirdaw
---

# Research: bramka regresji na zmianach promptu agenta review

**Data**: 2026-08-23T15:48:22+02:00
**Researcher**: lirdaw
**Git Commit**: 970af2be96476c0063ae52dadbb5bb409b027534
**Branch**: review-eval-gate
**Repository**: lirdaw/10xcards

## Research Question

Rozpoznanie stanu repo pod kątem `context/changes/review-eval-gate/requirements.md`. Sześć pytań
do rozstrzygnięcia faktami, nie projektem rozwiązania:

1. **ODCISK** — czy `fingerprintPrompt` (`agents/review/evals/cache.ts`) nadaje się na odcisk tej
   zapadki; co wchodzi w jego cztery osie, a co NIE wchodzi mimo że zmienia werdykt. Znaleźć
   wszystkie takie wartości poza znanym `SCORE_THRESHOLD = 5`.
2. **POMIAR** — czy `z.toJSONSchema` przenosi `.describe()` do schematu. Sprawdzić uruchomieniem.
3. **TRAFIENIE W CACHE** — udowodnić eksperymentem na prawdziwym magazynie, że przebieg po zmianie
   promptu nie może trafić w cache sprzed zmiany.
4. **DOM ZAPADKI** — czy `prompt-ratchet.yml` może ją przyjąć, czy zlałoby to dwie gwarancje.
5. **MIEJSCE NA WYNIK** — gdzie zapisać wynik macierzy, żeby przetrwał `lint-staged` i nie wpadł
   w `paths-ignore` żadnego z sześciu workflow.
6. **PRECEDENSY** — istniejące zapadki „wygeneruj i porównaj"; którą konwencję kontynuować.

## Summary

**Metoda.** Sześć pytań rozstrzygniętych POMIAREM, nie lekturą: `.describe()` w schemacie zmierzone
przez import żywego modułu; unieważnianie odcisku zmierzone na wariantach schematu różniących się
dokładnie jedną linią; trafienia i pudła cache'u zmierzone na PRAWDZIWYM `~/.promptfoo/cache`
z zastubowanym `query` (zero wywołań modelu, zero wydatku); zależności runtime'owe zmierzone przez
uruchomienie modułów w katalogu bez `node_modules`; zachowanie prettiera zmierzone na realistycznym
kandydacie na plik wyniku. Dokumentacja zoda i promptfoo nie była potrzebna — wszystkie cztery
twierdzenia dało się rozstrzygnąć na tym repo.

**Cztery rzeczy, które zmieniają obraz zadania.**

1. **`criteria.json` NIE jest luką w odcisku — jest już w nim w całości, i to zmierzone.**
   `.describe()` trafia do `REVIEW_JSON_SCHEMA` w 20 polach na 20, a `label` wchodzi tam okrężną
   drogą, przez szablon opisu pola `*Note`. Zmiana `describe`, `label`, `key`, `conditional` ORAZ
   samej KOLEJNOŚCI kryteriów — każda z osobna rusza odcisk. Kontrola negatywna trzyma: zmiana
   `SCORE_MAX` w `review-schema.ts` odcisku nie rusza. Obserwacja z `requirements.md` („opisy
   kryteriów prawdopodobnie wchodzą okrężną drogą") jest POTWIERDZONA i przestaje być hipotezą.

2. **Próg jest luką prawdziwą, ale nie tą, o którą warto się bić — bo bramka review jest DZIŚ
   DORADCZA.** `SCORE_THRESHOLD` faktycznie leży poza wszystkimi osiami. Ale werdykt ma PIĘĆ
   wartości, nie dwie, a czerwień joba daje wyłącznie `failed-to-run`: `pass|fail|no-code|too-large`
   kończą kodem 0, bo „a verdict is not an outage" (`pr-review.yml:652`). Nic w tym repo nie blokuje
   merge'a na tej bramce (`pr-review.yml:10-15`). Podniesienie progu z 5 na 8 zmienia więc etykietę
   i treść komentarza na PR-ze, a nie przepustowość. To nie unieważnia pytania pierwszego — zmienia
   jego cenę, a cena jest połową argumentu w `requirements.md`.

3. **Macierz NIE mierzy konfiguracji produkcyjnej i nikt tego dotąd nie zapisał.** Produkcja to
   `anthropic/claude-sonnet-4.6` (`review.ts:38`) przy `maxBudgetUsd 1.0`; macierz jedzie na
   `haiku-4.5` i `gemini-2.5-flash` przy `0.6`. Dowód z macierzy mówi o tym, jak na zmieniony prompt
   reagują dwa TANIE modele — nie o tym, jak zareaguje model, który recenzuje PR-y. To jest fakt
   o ZAKRESIE dowodu, który zapadka będzie egzekwować, i należy do planu, nie do przypisu.

4. **Odcisku NIE DA SIĘ policzyć bez `npm ci`, i to zmierzone.** Trzy z czterech osi ciągną
   zależność runtime: oś 2 wymaga `zod`, oś 4 wymaga `@anthropic-ai/claude-agent-sdk`, a sama
   funkcja `fingerprintPrompt` wymaga `promptfoo`. Bez zależności działa wyłącznie `prompt.ts`
   (osie 1 i 3). To wprost uderza we wzorzec „zero `npm ci`", na którym stoi `prompt-ratchet.yml`,
   i jest mocniejszym argumentem przeciw umieszczeniu tam zapadki niż argument o mylącej
   diagnostyce.

**Cache: dowód wyszedł mocniejszy, niż zakładało pytanie.** W `~/.promptfoo/cache` leżą trzy
PRAWDZIWE komórki z zarchiwizowanego przebiegu, a ich odcisk (`d87ce99a…`) nie zgadza się
z dzisiejszym (`59ee111b…`). Zmierzone rozliczenie tej różnicy: `d87ce99a…` to DOKŁADNIE
dwuosiowy odcisk sprzed `c2991a4` policzony z DZISIEJSZYCH wartości — czyli prompt i schemat są
niezmienione, a rozjazd bierze się wyłącznie z poszerzenia definicji odcisku z dwóch osi na cztery.
Skutek praktyczny: **następne przejście macierzy będzie zimne we wszystkich komórkach i zapłaci**,
mimo że nikt nie ruszył promptu. Eksperyment sterowany (C1–C5) potwierdza kierunek unieważnienia
w obie strony przy zerowym wydatku.

**Miejsce na wynik: znaleziona pułapka, której `requirements.md` nie znało.** `JSON.stringify(x, null, 2)`
NIE jest bezwarunkowo prettier-czysty. Prettier zwija TABLICE WARTOŚCI PROSTYCH do jednej linii,
gdy mieszczą się w 120 kolumnach. Oba istniejące generatory przetrwały tylko dlatego, że ich tablice
zawierają obiekty dostatecznie szerokie, żeby zostać rozwinięte. Realistyczny kandydat na plik
wyniku (z polami `models: [...]`, `counts: [...]`) został przez prettiera przeformatowany — zmierzone.

## Detailed Findings

### 1. ODCISK — co wchodzi w cztery osie, a co nie

#### 1.1 Cztery osie, dosłownie

`fingerprintPrompt` (`agents/review/evals/cache.ts:72-86`) liczy `sha256` z czterech wartości
złączonych separatorem `\u0000`:

| oś                   | wartość                                                  | źródło                                |
| -------------------- | -------------------------------------------------------- | ------------------------------------- |
| 1 `systemPrompt`     | `SYSTEM_PROMPT` (12 119 znaków)                          | `agents/review/prompt.ts`             |
| 2 `jsonSchema`       | `REVIEW_JSON_SCHEMA` (12 880 znaków po `JSON.stringify`) | `agents/review/review-schema.ts:282`  |
| 3 `userMessageShape` | `wrapDiff("", "fingerprint")` (282 znaki)                | `agents/review/prompt.ts`             |
| 4 `callOptions`      | `FIXED_CALL_OPTIONS` = `{"tools":[],"maxTurns":2}`       | `agents/review/run-review.ts:222-232` |

Odcisk produkcyjny liczy `productionPromptFingerprint()` (`agents/review/evals/provider.ts:169-176`)
z modułów kontraktu, nie z kopii — więc z definicji nie jest ręcznie utrzymywaną listą ścieżek
i nie może się zestarzeć przez przeoczenie pliku. **Do celu tej zapadki nadaje się** — z dwoma
zastrzeżeniami, które są treścią sekcji 1.4 i 1.5.

Wartość dzisiejsza (commit `970af2b`):
`59ee111bb431f77a4fc01d7f9bf33992f4ab783458c704d20aafb9e42edec8f1`

#### 1.2 ZMIERZONE — co z `criteria.json` już siedzi w odcisku

Warianty `review-schema.ts` różniące się od bazy DOKŁADNIE jedną linią (zbudowane poza drzewem
gita, żeby nie ruszyć repo), przeliczone przez prawdziwe `fingerprintPrompt`:

| wariant                       | zmiana                                 | odcisk                  |
| ----------------------------- | -------------------------------------- | ----------------------- |
| v0 baza                       | —                                      | `59ee111b…`             |
| v1                            | jeden znak w `describe` kryterium      | `f55a660c…` **RÓŻNY**   |
| v2                            | jeden znak w `label` kryterium         | `e965000a…` **RÓŻNY**   |
| v3                            | `conditional: true → false`            | `ede3daf2…` **RÓŻNY**   |
| v5                            | zmiana `key` kryterium                 | `24ee2a17…` **RÓŻNY**   |
| **v6**                        | **`SCORE_MAX 10 → 99`**                | **`59ee111b…` TEN SAM** |
| przestawienie dwóch kryteriów | wyłącznie KOLEJNOŚĆ, zero zmian treści | `84c7f03d…` **RÓŻNY**   |

v6 jest kontrolą negatywną i trzyma: sonda nie liczy hasha pliku, tylko realny odcisk — więc
„RÓŻNY" w pozostałych wierszach coś znaczy.

**Wniosek dla pytania pierwszego z `requirements.md`.** `criteria.json` niesie dokładnie
`{key, noteKey, label, conditional}` (`agents/review/generate-criteria.ts:24, 37`) i wszystkie cztery
pola oraz ich kolejność są w odcisku — bo wszystkie pochodzą z tablicy `CRITERIA`, z której powstaje
też `REVIEW_JSON_SCHEMA`. Do tego `git diff --exit-code` w composite action
(`.github/actions/review-agent/action.yml:138-146`) uniemożliwia ręczną edycję `criteria.json`
w oderwaniu od `CRITERIA`. **`criteria.json` nie jest niezależnym wejściem i nie jest luką.**

Jedno zastrzeżenie do zapisania, bo idzie w drugą stronę: `describe` jest z `criteria.json`
ŚWIADOMIE wyłączone (`generate-criteria.ts:18-20`), więc bramka dryfu `criteria.json` NIE WIDZI
zmiany opisu kryterium — a to jest główna dźwignia sterowania modelem. Widzi ją dopiero odcisk.
Te dwa mechanizmy pokrywają rozłączne zbiory i żaden nie zastępuje drugiego.

#### 1.3 Pełna lista wartości POZA czterema osiami, które zmieniają werdykt

Podział, który okazał się osią całego pytania: **ODPOWIEDŹ** = zmiana zmienia to, co odpowie model
(macierz ma o czym mówić); **INTERPRETACJA** = ta sama odpowiedź, inny odczyt (macierz nie ma o tym
nic do powiedzenia); **BEZ WYWOŁANIA** = decyduje, czy model w ogóle zostanie zapytany.

Zmieniające ODPOWIEDŹ, poza odciskiem:

| wartość                                            | plik:linia                      | co robi                                                                                                               |
| -------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `REVIEW_MODEL` (pin `anthropic/claude-sonnet-4.6`) | `agents/review/review.ts:38`    | który model odpowiada; jest osobnym wymiarem KLUCZA cache'u, nie odcisku                                              |
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY=""`       | `run-review.ts:249, 254`        | endpoint i precedencja poświadczeń                                                                                    |
| wersja SDK + `agents/review/package-lock.json`     | `agents/review/package.json:18` | jak `systemPrompt`/`outputFormat` jadą na drut; lock jest wyłączony z recenzowanego diffa (`pr-review.yml:283`)       |
| wyłączenia pathspec recenzowanego diffa            | `pr-review.yml:282-286`         | zmieniają MATERIAŁ, który model widzi                                                                                 |
| `use_fixture` (dispatch)                           | `pr-review.yml:42-46, 258`      | podmienia materiał na `sample.diff`                                                                                   |
| długość nonce'u `randomBytes(9)`                   | `prompt.ts:230-232`             | oś 3 odciska KSZTAŁT przy stałym `"fingerprint"`, więc zmiana długości nonce'u jest dla niej niewidoczna (marginalne) |

Zmieniające wyłącznie INTERPRETACJĘ:

| wartość                                                                               | plik:linia                                                 | co robi                                                                                                                         |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **`SCORE_THRESHOLD = 5`**                                                             | `scripts/review-verdict.ts:35`                             | jedyne miejsce; wołane z `run-review-verdict.ts:264, 277`                                                                       |
| **`SCORE_MIN`/`SCORE_MAX` — kopia w `scripts/`**                                      | `scripts/review-verdict.ts:32-33`, egzekwowane `:184-189`  | ocena poza skalą → rzut → kod 1 → `failed-to-run` → **czerwony przebieg**                                                       |
| `SCORE_MIN`/`SCORE_MAX` — kopia w agencie                                             | `agents/review/review-schema.ts:46-47`                     | czyta ją tylko `evals/assertions.ts`; NIE dotyka werdyktu PR-a. Nic nie pilnuje zgodności obu kopii — to Open Risk 1 z archiwum |
| reguła agregacji `agentVerdict === "fail" \|\| failing.length > 0`                    | `scripts/review-verdict.ts:231`                            | alternatywa, nie koniunkcja; brak średniej jest decyzją (`:205-209`)                                                            |
| `null` → `skipped`, wyłączony w OBU kierunkach                                        | `scripts/review-verdict.ts:218-223`                        |                                                                                                                                 |
| surowość `parseReview` (brak klucza, `null` na niewarunkowym, nie-liczba, nie-string) | `scripts/review-verdict.ts:128-195`                        | każdy przypadek → kod 1 → czerwień, nie werdykt `fail`                                                                          |
| `conditional` po stronie `scripts/`                                                   | `criteria.json:42, 48`, konsumpcja `review-verdict.ts:164` | flip `true→false` przy modelu nadal zwracającym `null` = złamany kontrakt → czerwień, a nie `fail`                              |
| literały `verdict=pass\|fail\|no-code\|too-large\|failed-to-run`                      | `run-review-verdict.ts:217, 235, 248, 287`                 | czytane przez dwa `case`; zmiana literału wpada w `*)` → czerwień                                                               |
| `case "$VERDICT" in …`                                                                | `pr-review.yml:658-665`                                    | **jedyna linia zamieniająca werdykt w status joba**                                                                             |
| mapowanie etykiet `ai-cr:passed` / `ai-cr:failed`                                     | `pr-review.yml:630-642`                                    | jedyny sygnał na liście PR-ów                                                                                                   |
| `CRITERIA_PATH`                                                                       | `run-review-verdict.ts:39`                                 | który plik jest czytany jako lista kryteriów                                                                                    |

BEZ WYWOŁANIA (werdykt zmienia się, choć model nie odpowiada wcale):

| wartość                                                       | plik:linia                            | co robi                                                                          |
| ------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| `MAX_DIFF_BYTES = 250000`                                     | `pr-review.yml:315, 320`              | przekroczenie → `too-large`: agent NIE JEDZIE, zielono, bez etykiety             |
| `DEFAULT_MAX_BUDGET_USD = 1.0`                                | `run-review.ts:41`                    | świadomie POZA `FIXED_CALL_OPTIONS` (`:213`), więc poza odciskiem i poza kluczem |
| `timeout 15m`                                                 | `action.yml:188`                      | `STATUS=124` → `failed-to-run`                                                   |
| bramka pustego klucza, `npm ci`, bramka dryfu `criteria.json` | `action.yml:94-108, 126-129, 138-146` | każde → `AGENT_OUTCOME != success` → `failed-to-run`                             |
| `if:` joba (fork, `labeled` tylko dla `ai-cr:review`)         | `pr-review.yml:109-112`               | job POMINIĘTY: brak werdyktu, komentarza i etykiety                              |
| `concurrency.cancel-in-progress: true`                        | `pr-review.yml:70-72`                 | anulowany przebieg nie publikuje werdyktu                                        |

#### 1.4 Zastrzeżenie pierwsze — bramka review jest DORADCZA

`pr-review.yml:10-15`, dosłownie:

> **A red run here means REVIEW DID NOT HAPPEN — never that review went badly.** A `fail`
> verdict is a green run carrying the `ai-cr:failed` label and a comment saying why. That
> asymmetry is the whole point: this check is ADVISORY. It is not in `needs:` of anything, it
> is not a required status check, and nothing in this repository blocks a merge on it.

I `pr-review.yml:659-661`: `pass|fail|no-code|too-large` → `echo "Review happened … Advisory by
design — this check blocks nothing."`, kod 0.

Skutek dla pytania pierwszego z `requirements.md`: zdanie „to jest zmiana, po której agent review
odrzuca PR-y, których wczoraj nie odrzucał" jest dziś NIEŚCISŁE — agent nikogo nie odrzuca, bo nie
ma czym. Podniesienie progu z 5 na 8 przestawia etykietę i treść komentarza. Ryzyko jest realne
(kalibracja ostrości review zmieniona jednym znakiem w pliku, którego nikt nie kojarzy z promptem),
ale jego cena jest o rząd niższa, niż zakładała notatka wejściowa. Fakt drugiej strony też stoi:
próg NIE zmienia odpowiedzi modelu, więc przejście macierzy nie jest o nim żadnym dowodem —
to jest ta połowa argumentu „za szeroko", która się nie zmieniła.

#### 1.5 Zastrzeżenie drugie — macierz nie mierzy konfiguracji produkcyjnej

|                | produkcja (PR review)                          | macierz evali                                                                           |
| -------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| model          | `anthropic/claude-sonnet-4.6` (`review.ts:38`) | `anthropic/claude-haiku-4.5` + `google/gemini-2.5-flash` (`promptfooconfig.yaml:34-48`) |
| `maxBudgetUsd` | `1.0` (`run-review.ts:41`)                     | `0.6`                                                                                   |
| materiał       | diff PR-a                                      | `sample.diff` + `clean-text-change.diff`                                                |

Sonnet jest nieobecny świadomie i z zapisanym powodem („+0,39 USD na przejście przy ~0,50 USD
dostępnych", `promptfooconfig.yaml:29-31`). Konsekwencja dla zapadki: dowód, którego będzie żądać,
jest dowodem o REAKCJI DWÓCH TANICH MODELI na zmieniony prompt. To jest sensowny sygnał regresji
(archiwum pokazuje, że złapał realną regresję na gemini), ale nie jest dowodem o zachowaniu
recenzenta produkcyjnego. Nazwa i komunikat zapadki nie mogą sugerować inaczej.

#### 1.6 ZMIERZONE — odcisku nie da się policzyć bez `npm ci`

Cztery moduły skopiowane do katalogu bez żadnego `node_modules` w drzewie nadrzędnym, uruchomione
przez `node --experimental-strip-types`:

| co                              | wynik                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `prompt.ts` (osie 1 i 3)        | **OK** — `SYSTEM_PROMPT` 12 119 znaków, `wrapDiff` 282; jedyny import to `node:crypto` |
| `review-schema.ts` (oś 2)       | `ERR_MODULE_NOT_FOUND: Cannot find package 'zod'`                                      |
| `run-review.ts` (oś 4)          | `ERR_MODULE_NOT_FOUND: Cannot find package '@anthropic-ai/claude-agent-sdk'`           |
| `evals/cache.ts` (sama funkcja) | `ERR_MODULE_NOT_FOUND: Cannot find package 'promptfoo'`                                |

Importy wartościowe (nie `import type`, więc nieusuwalne przez type stripping):
`review-schema.ts:1` `import { z } from "zod"`; `run-review.ts:2` `import { query as sdkQuery, … }`;
`cache.ts:2` `import { cache as promptfooCache } from "promptfoo"`.

Zmierzona cena tej instalacji: mediana `npm ci` pakietu agenta **38 302 ms**, `node_modules`
**2 099 MB** (`context/archive/2026-08-22-code-review-evals/change.md:38-42`); composite action
podaje ~335 MB rozpakowane dla wariantu bez promptfoo (`action.yml:124-125`).

### 2. POMIAR — `z.toJSONSchema` i `.describe()`

Uruchomione na żywym module (`agents/review/review-schema.ts`, zod 4.4.3, Node 24.18.0),
`z.toJSONSchema(REVIEW_OBJECT, { target: "draft-07" })`:

```
top-level keys : [ '$schema', 'type', 'properties', 'required', 'additionalProperties' ]
$schema        : http://json-schema.org/draft-07/schema#
properties     : 20
z description  : 20 / 20   (bez opisu: [])
JSON.stringify : 12 880 znaków
```

Próbka dosłowna, `implementationCorrectness`:

```json
{
  "type": "number",
  "description": "Poprawność implementacji (skala 1-10): czy kod robi to, co deklaruje — na ścieżce głównej, w przypadkach brzegowych i w obsłudze błędów. 1: logika jest błędna albo po cichu psuje istniejące zachowanie …"
}
```

**Odpowiedź: TAK, przenosi — w 20 polach na 20.** Trzy skutki, każdy zmierzony:

- **Opisy kryteriów są już w odcisku.** Cała treść `describe` (najdłuższa dźwignia sterowania
  modelem, bo `minimum`/`maximum` structured output odrzuca — `review-schema.ts:229-234`) jedzie
  do osi 2 dosłownie.
- **`label` też, okrężną drogą.** Opis pola `*Note` powstaje z szablonu interpolującego etykietę
  (`review-schema.ts:242`): `"Uzasadnienie oceny „Poprawność implementacji” — jedno-dwa zdania. …"`.
  Zmiana samej etykiety zmienia więc WEJŚCIE MODELU, nie tylko tekst komentarza na PR-ze. To
  koryguje naturalne założenie, że `label` jest wyłącznie sprawą renderera.
- **`conditional` widać w kształcie.** Kryterium warunkowe emituje
  `"anyOf": [{"type":"number"},{"type":"null"}]`, niewarunkowe `"type": "number"`.

Kolejność pól w `properties` i w `required` jest identyczna z kolejnością `CRITERIA`, a `JSON.stringify`
ją zachowuje — stąd wynik z 1.2, że przestawienie dwóch kryteriów rusza odcisk.

**Wymaganie 2 z `requirements.md` jest zatem spełnione przez sam odcisk we wszystkim poza progiem**:
prompt systemowy (oś 1), opisy kryteriów i schemat wyjścia (oś 2) — tak; próg — nie.

### 3. TRAFIENIE W CACHE — dowód na prawdziwym magazynie

#### 3.1 Eksperyment naturalny: w magazynie leżą komórki sprzed zmiany

`~/.promptfoo/cache/cache.json` (jeden plik, 13 753 B) zawiera trzy klucze `review-eval`:

```
review-eval:v1:anthropic/claude-haiku-4.5:0e21b403…:d87ce99ab2c179b7885b354993e71b2cc8918f7c8dc91d47e013e03f984b875e
review-eval:v1:anthropic/claude-haiku-4.5:cf05b957…:d87ce99a…
review-eval:v1:google/gemini-2.5-flash:0e21b403…:d87ce99a…
```

Zmierzone rozliczenie tych hashów:

| co                                                                    | wartość             | zgodność                     |
| --------------------------------------------------------------------- | ------------------- | ---------------------------- |
| `sha256(sample.diff)` dziś                                            | `0e21b4034a5f2124…` | **= hash fikstury w kluczu** |
| `sha256(clean-text-change.diff)` dziś                                 | `cf05b9570aebf944…` | **= hash fikstury w kluczu** |
| odcisk w kluczach                                                     | `d87ce99a…`         |                              |
| `productionPromptFingerprint()` dziś                                  | `59ee111b…`         | **≠**                        |
| odcisk DWUOSIOWY (definicja sprzed `c2991a4`) z DZISIEJSZYCH wartości | `d87ce99a…`         | **= odcisk w kluczach**      |

Fikstury są bit w bit te same, a odcisk inny — i różnica rozlicza się co do znaku: `c2991a4`
(„widen the eval cache key to the whole call") zamienił `fingerprintPrompt(systemPrompt, jsonSchema)`
na wariant czteroargumentowy. **Prompt i schemat nie zmieniły się od tamtego przebiegu; zmieniła się
definicja odcisku.**

Trzy fakty do zapisania:

- **Następne przejście macierzy będzie ZIMNE we wszystkich komórkach** — odczyt pod dzisiejszym
  kluczem to PUDŁO. Kotwica budżetowa z `requirements.md` („powtórzenie na ciepłym cache'u
  0,000000 USD") na dziś NIE OBOWIĄZUJE: pierwszy przebieg w tej zmianie zapłaci pełną stawkę
  zimną, rzędu 0,08-0,12 USD, przy budżecie zmiany 0,50 USD.
- **`CACHE_FORMAT_VERSION` został na `"v1"` mimo zmiany definicji odcisku** (`cache.ts:26`).
  Osierocone wpisy nie stają się przez to trafieniami — poszerzenie odcisku daje PUDŁO, czyli
  zachowanie fail-safe. Ale trzy wpisy leżą w magazynie jako nieusuwalny śmieć, a mechanizm
  „podbij wersję = unieważnij całość" nie został użyty tam, gdzie by pasował.
- **To jest jednocześnie odpowiedź na pytanie 3 z materiału naturalnego**, a nie tylko z probówki.

#### 3.2 Eksperyment sterowany — zero wywołań modelu, zero wydatku

Na tym samym prawdziwym magazynie, z `query` zastubowanym (stub zlicza wywołania i zwraca błąd)
i atrapą `ANTHROPIC_AUTH_TOKEN`, przez prawdziwe `runCell` z `provider.ts`:

| przypadek | odcisk                                          | wynik                                                       | wywołań modelu            |
| --------- | ----------------------------------------------- | ----------------------------------------------------------- | ------------------------- |
| C1        | bazowy (sentinel zapisany)                      | `cached=true`                                               | **0** — TRAFIENIE         |
| C2        | po zmianie JEDNEGO ZNAKU w `describe` kryterium | pudło                                                       | **1** — poszedł do modelu |
| C3        | po zmianie JEDNEGO ZNAKU w `SYSTEM_PROMPT`      | pudło                                                       | **1** — poszedł do modelu |
| C4        | `SCORE_THRESHOLD`                               | nie jest argumentem `fingerprintPrompt` — brak drogi wpływu | —                         |
| C5        | powrót do bazowego, po dwóch pudłach            | `cached=true`                                               | **0** — nadal TRAFIENIE   |

C5 jest kontrolą, że pudła C2/C3 nie unieważniły wpisu bazowego. Sentinel i oba wpisy pudłowe
usunięte; magazyn zweryfikowany po sprzątaniu — zostały dokładnie trzy komórki archiwalne, `git status` czysty.

**Odpowiedź: przebieg po zmianie promptu NIE MOŻE trafić w cache sprzed zmiany.** Kierunek
unieważnienia jest zmierzony na hydraulice (klucz → zapis → odczyt → decyzja o wywołaniu), a nie
wywnioskowany z tego, że hashe się różnią.

#### 3.3 Czego ten dowód NIE obejmuje

- **`isCacheEnabled()` deleguje do promptfoo** (`cache.ts:104-107`), więc `--no-cache`
  i `PROMPTFOO_CACHE_ENABLED=false` wyłączają także ten cache. `cache.test.ts:204-206` ma na to
  `assertCacheOn()` — bez niego przypadki cache'owe przechodziłyby PUSTO.
- **Magazyn to jeden plik `cache.json` przez `KeyvFile`** — dwa równoległe przebiegi nadpisują sobie
  wpisy (Open Risk 2, `plan.md:940-957`). Objaw to PUDŁO, czyli WYDATEK, nie awaria.
- **Cache nie jest dowodem świeżości wyniku wobec MODELU.** Trafienie znaczy „to samo wywołanie",
  nie „model odpowiedziałby tak dzisiaj". Dostawca może zmienić zachowanie pinu bez zmiany
  którejkolwiek z czterech osi.

### 4. DOM ZAPADKI — `prompt-ratchet.yml` czy własny plik

#### 4.1 Co ten plik o sobie mówi

`prompt-ratchet.yml:3-18`, dosłownie:

> A SEPARATE workflow file, and that is the whole point of it rather than an organisational
> preference. … `paths-ignore` filters the WORKFLOW, not a job, so no job added to `ci.yml` can
> escape it. … Deliberately NO `paths` filter of its own either. Narrowing this to the guarded
> files would reintroduce the same class one level down: `PROMPT_SOURCES` is a list in `scripts/`,
> and the day someone adds a fourth source the filter would be stale and silent again. **The job
> is seconds long with no install, so there is nothing to buy by filtering.**

I `:43-49`, o kroku:

> No `npm ci` and no npm cache, deliberately — the same shape as the `drift` job in `ci.yml` and
> for the same reason: `scripts/check-prompt-sources.ts` has zero runtime dependencies
> (`node:fs` + `node:crypto`), which is what keeps this at seconds.

Ten sam plik już raz odmówił przyjęcia sąsiada z zależnościami — `agents-gate.yml:20-22`:

> I nie: `prompt.test.ts` NIE przenosi się tu z `prompt-ratchet.yml`. Jego wartością jest brak
> zależności runtime, dzięki któremu biega tam bez `npm ci` i w sekundach; **testy, które
> zależności MAJĄ, dostają dlatego inny job, a nie tamten.**

#### 4.2 Rozstrzygnięcie

Zapadka na odcisku ma zależności runtime — zmierzone w 1.6: `zod`, `@anthropic-ai/claude-agent-sdk`,
`promptfoo`. Wstawienie jej do `prompt-ratchet.yml` skasowałoby własność, którą ten plik deklaruje
o sobie jako powód swojego istnienia w tym kształcie, i zrobiłoby to wbrew regule zapisanej wprost
o dwa pliki dalej. **To jest argument mocniejszy niż argument o diagnostyce z `requirements.md`.**

Argument o diagnostyce też stoi, tylko jest słabszy. Nazwa checka na PR-ze to `<workflow> / <job>`,
czyli dziś `Prompt ratchet / ratchet` dla obu istniejących kroków. Trzeci krok wyświetliłby własną
nazwę w logu, ale na liście checków człowiek widziałby nadal jeden wpis „Prompt ratchet", pokrywający
teraz trzy różne gwarancje: „destylat opisuje aktualne repo", „prompt spełnia własne asercje"
i „zmiana promptu ma zmierzony skutek". Ten plik ma już DWIE gwarancje w jednym jobie, więc trzecia
nie jest jakościowym przełomem — ale precedens `agents-gate.yml` pokazuje, że dokładając gwarancję
z inną charakterystyką kosztową, to repo zakłada NOWY plik i zapisuje w nim, dlaczego decyzja jest
odwrotna niż u sąsiada.

#### 4.3 Materiał do decyzji: co widzi wyzwalacz

Wszystkie cztery osie odcisku leżą pod `agents/**` (`prompt.ts`, `review-schema.ts`, `run-review.ts`,
`evals/cache.ts`). Próg — NIE (`scripts/review-verdict.ts`). Zmierzone: `SCORE_THRESHOLD` nie
występuje nigdzie pod `agents/**` poza `node_modules`.

| workflow              | wyzwalacz                                                   | widzi 4 osie?  | widzi próg? | `npm ci`?                     |
| --------------------- | ----------------------------------------------------------- | -------------- | ----------- | ----------------------------- |
| `agents-gate`         | `paths: ["agents/**", ".github/workflows/agents-gate.yml"]` | **tak**        | **nie**     | tak, ~38 s / 2 099 MB         |
| `prompt-ratchet`      | brak filtra, świadomie                                      | **tak**        | **tak**     | nie, i to jest jego cały sens |
| `ci`                  | `paths-ignore: ["**/*.md", "context/**"]`                   | tak            | tak         | tak                           |
| `pr-review`           | brak filtra, świadomie (`:27-32`)                           | tak            | tak         | wewnątrz composite action     |
| `eval`, `schema-diff` | wyłącznie `workflow_dispatch`                               | nigdy na PR-ze | nigdy       | —                             |

Napięcie do rozstrzygnięcia w planie, nie tutaj: `agents-gate` już płaci za instalację i już widzi
wszystkie cztery osie, ale jego filtr `paths` nie sięga progu; `prompt-ratchet` widzi wszystko, ale
przyjęcie zapadki kosztowałoby go własność bezzależnościową. Trzecia droga (własny plik) powtarza
wzorzec, którym powstał sam `prompt-ratchet.yml`.

### 5. MIEJSCE NA WYNIK

#### 5.1 `lint-staged` — co naprawdę sięga

- `package.json:80-87`, i nigdzie indziej (brak `.lintstagedrc`, brak `lint-staged.config.js`):
  `*.{json,css,md}` → `prettier --write`.
- **Wzorzec dopasowuje się na dowolnej głębokości.** `node_modules/lint-staged/lib/matchFiles.js:12-16`
  ustawia `matchBase: !pattern.includes('/')`, a `*.{json,css,md}` nie zawiera `/` — więc obejmuje
  `agents/review/**` tak samo jak katalog główny.
- `.prettierignore` ma DOKŁADNIE JEDEN wzorzec: `context/archive/**`. `agents/**` nie jest wyłączone.
- `.gitignore` nie zawiera `agents` w żadnej postaci. `.gitattributes` to `* text=auto eol=lf`.
- `eslint.config.js:127-130` ignoruje `agents/**` w całości — więc `.ts` pod `agents/` przechodzi
  przez `eslint --fix` bez skutku, ale `.json` przez prettiera przechodzi ze skutkiem.
- Husky jest zainstalowany w tym checkoucie: `git config --get core.hooksPath` → `.husky/_`;
  `.husky/pre-commit` to jedna linia `npx lint-staged`.

#### 5.2 ZMIERZONA PUŁAPKA — `JSON.stringify(x, null, 2)` nie jest bezwarunkowo prettier-czysty

Oba istniejące generatory emitują `` `${JSON.stringify(payload, null, 2)}\n` ``
(`scripts/prompt-sources.ts:173`, `agents/review/generate-criteria.ts:37`) i oba komentują to jako
warunek przetrwania `lint-staged`. `npx prettier --check` na wszystkich pięciu plikach `.json` pod
`agents/` (poza `node_modules`) daje dziś kod 0 — są czyste.

**Ale czystość tych dwóch plików jest przypadkiem ich kształtu, nie własnością serializatora.**
Zmierzone na realistycznym kandydacie na plik wyniku macierzy, zserializowanym dokładnie tak, jak
robią to oba generatory:

```diff
-  "softObservations": [
-    "conditional-null-contract"
-  ],
-  "models": [
-    "anthropic/claude-haiku-4.5",
-    "google/gemini-2.5-flash"
-  ],
-  "counts": [
-    4,
-    3,
-    1
-  ]
+  "softObservations": ["conditional-null-contract"],
+  "models": ["anthropic/claude-haiku-4.5", "google/gemini-2.5-flash"],
+  "counts": [4, 3, 1]
```

Reguła zmierzona: **prettier zwija TABLICE WARTOŚCI PROSTYCH do jednej linii, gdy mieszczą się
w 120 kolumnach**; obiekty rozpisane wielolinijkowo zachowuje, kolejności kluczy nie zmienia, długich
stringów nie łamie, CRLF zamienia na LF, brakujący `\n` na końcu dokłada. `prompt-sources.json`
i `criteria.json` przetrwały tylko dlatego, że ich tablice zawierają OBIEKTY, a te obiekty są
dostatecznie szerokie (64-znakowy sha256 z kluczem przekracza 120 kolumn), żeby zostać rozwinięte.

**Konsekwencja dla wymagania 5:** plik wyniku niosący tablicę wartości prostych zostałby
przeformatowany przez pierwszy `git add` + commit i zaczerwieniłby porównanie NA ZAWSZE — czerwienią
o formatowaniu, nie o dryfie. To jest dokładnie ten tryb awarii, przed którym ostrzegają oba
komentarze generatorów, tylko z warunkiem ostrzejszym, niż one podają.

#### 5.3 Który wyzwalacz widzi kandydata

Dla PR-a do `main` zmieniającego WYŁĄCZNIE jeden nowy plik:

| ścieżka kandydata                           | agents-gate | ci      | eval | pr-review | prompt-ratchet | schema-diff |
| ------------------------------------------- | ----------- | ------- | ---- | --------- | -------------- | ----------- |
| `agents/review/evals/<x>.json`              | **tak**     | tak     | nie  | tak       | **tak**        | nie         |
| `agents/review/<x>.json`                    | **tak**     | tak     | nie  | tak       | **tak**        | nie         |
| `context/changes/review-eval-gate/<x>.json` | nie         | **nie** | nie  | tak       | **tak**        | nie         |
| `scripts/<x>.json`                          | nie         | tak     | nie  | tak       | **tak**        | nie         |
| `.github/<x>.json`                          | nie         | tak     | nie  | tak       | **tak**        | nie         |
| katalog główny `<x>.json`                   | nie         | tak     | nie  | tak       | **tak**        | nie         |

Uzasadnienia filtrów: `agents-gate.yml:26, 29` (`paths` wymienia jeden konkretny plik workflow,
więc `.github/<x>.json` NIE trafia); `ci.yml:6, 9` (`context/**` to jedyny kandydat, który pomija
`ci`); `eval.yml:40` i `schema-diff.yml:25` (`workflow_dispatch` — żadna ścieżka ich nie wyzwala);
`pr-review.yml:33-36` i `prompt-ratchet.yml:19-23` (brak filtra, w obu przypadkach świadomie).

**Żaden kandydat nie wpada w `paths-ignore` w sposób, który uciszyłby zapadkę** — pod warunkiem, że
zapadka mieszka w `prompt-ratchet.yml` albo we własnym pliku bez filtra. Wariant `context/**` jest
jedynym, który wypada z `ci`, i jednocześnie jedynym, który stoi w sprzeczności z regułą, że dowód
w `context/changes/` ma być dokumentem roboczym, a nie plikiem bramkowanym.

#### 5.4 Konwencja pominięta w `requirements.md`

Każdy generowany artefakt jest wyłączany z diffa recenzowanego przez agenta —
`pr-review.yml:282-286`: `:(exclude)context/**`, `:(exclude)**/package-lock.json`,
`:(exclude)src/db/database.types.ts`, `:(exclude)agents/review/criteria.json`,
`:(exclude)agents/review/prompt-sources.json`. Nowy plik wyniku należy do tej samej rodziny; wymóg,
by dopisywać go w fazie, która plik tworzy, jest zapisany w
`context/archive/2026-08-21-ci-cd-code-review/reviews/plan-review.md:163-165`.

### 6. PRECEDENSY — zapadki „wygeneruj i porównaj"

|     | artefakt                            | komenda                                                                 | detekcja                              | gdzie biega                                                                           | zależności                          | kontrola pozytywna                                            |
| --- | ----------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------- |
| A   | `agents/review/criteria.json`       | `npm --prefix agents/review run criteria`                               | regeneruj + `git diff --exit-code`    | composite action, `action.yml:138-146`                                                | **tak** (`tsx`)                     | brak automatycznej; ręczna próba zapisana (`a1b62da`)         |
| B   | `agents/review/prompt-sources.json` | `node --experimental-strip-types scripts/run-prompt-sources.ts --write` | przelicz sha256 per SEKCJA i porównaj | **dwa czoła**: `prompt-ratchet.yml:50-51` + `tests/lib/review-prompt-sources.test.ts` | **nie** (`node:fs` + `node:crypto`) | **tak, dwustronna** (`review-prompt-sources.test.ts:97, 108`) |
| C   | `src/db/database.types.ts`          | `npm run db:types`                                                      | regeneruj + `git diff --exit-code`    | `ci.yml:109-112`                                                                      | tak + działający Supabase           | brak; para ręczna z zapisanym ograniczeniem                   |
| D   | dryf schematu (bez artefaktu)       | —                                                                       | porównanie z chmurą na żywo           | `ci.yml` job `drift`, tylko push na `main`                                            | nie                                 | **tak** (`tests/lib/schema-drift.test.ts:61`)                 |
| E   | odcisk wywołania evali              | —                                                                       | `fingerprintPrompt` + klucz cache'u   | `agents-gate.yml` (przez `cache.test.ts`)                                             | **tak** (promptfoo, SDK)            | **tak, per oś** (`cache.test.ts:395`)                         |

#### 6.1 Co kontynuować

**Od B — wszystko, co dotyczy kształtu zapadki.** To jest najbliższy krewny i jedyna zapadka
w repo z dwustronną kontrolą pozytywną i z remedium jako produktem pierwszej klasy:

- **Pomiar zamiast `git diff`.** B przelicza i porównuje wartość, zamiast liczyć na to, że
  regeneracja da bajt w bajt to samo. Znaczenie tego wyboru rośnie po pomiarze z 5.2: `git diff --exit-code`
  na pliku, który prettier może przeformatować, daje czerwień o formatowaniu.
- **Ograniczenie `git diff --exit-code` jest udokumentowane i dotyczy A i C**
  (`context/foundation/test-plan.md:3034-3035`): porównanie idzie przeciw INDEKSOWI, nie `HEAD`,
  więc ręczna edycja bez `git add` nie czerwieni. Realna teza tych bramek brzmi „zregenerowane ≠
  zacommitowane".
- **Remedium jako uporządkowane KROKI, nie dwa hashe.** `scripts/prompt-sources.ts:183-194` zwraca
  cztery ponumerowane kroki i kończy zdaniem: „Sam krok 3 zieleni ten test i nie naprawia niczego —
  zapisze zgodę na prompt, którego nikt nie przeczytał". Komenda odświeżająca jest eksportowaną
  stałą `REFRESH_COMMAND` (`:64-65`), żeby dało się ją cytować w każdym remedium. To jest gotowa
  odpowiedź na wymaganie 7 z `requirements.md`.
- **Jedna adnotacja na pozycję, nie jedna zbiorcza** (`check-prompt-sources.ts:90-96`).
- **Rozdział rdzeń/runner**: decyzja w module czystym, druk i kod wyjścia w runnerze. Wzorzec
  nazwany w `scripts/prompt-sources.ts:1-7` i powtórzony w trzech parach; jest nośny, bo
  `vitest.config.ts` ma `sequence: { shuffle: true }`.
- **Awaria samej bramki musi być odróżnialna od zgody** (`check-prompt-sources.ts:101-107`).
- **Treść remedium sama jest pod testem** (`review-prompt-sources.test.ts:82-91`).

**Od E — wzorzec kontroli pozytywnej per oś.** `cache.test.ts:395` mutuje FUNKCJĘ liczącą klucz
(`blindTo`), nie wejście, i asertuje, że wariant ślepy na oś X unieważnia dokładnie zbiór
`wszystkie osie minus X`. Komunikat nazywa OBA kierunki porażki („albo mutacja nie czerwieni swojego
przypadku …, albo czerwieni cudzy"). To jest wzorzec, który `requirements.md` wskazuje w wymaganiu 3,
i jest gotowy do powtórzenia.

**Od A — serializacja i granica.** `JSON.stringify(payload, null, 2)` + `\n`, ale z poprawką z 5.2:
prettier-czystość jest do ZMIERZENIA na konkretnym kształcie, nie do odziedziczenia. Oraz zasada
kierunku: `scripts/` czyta z `agents/` DANE, nigdy kodu (`review-schema.ts:6-12`).

#### 6.2 Gdzie ta zmiana MUSI się różnić

- **Zapadka ma zależności runtime, a B ich nie ma** (zmierzone w 1.6). To jest RÓŻNICA, nie
  szczegół — determinuje dom zapadki (sekcja 4) i wyklucza dosłowne skopiowanie kroku
  z `prompt-ratchet.yml`.
- **B pilnuje relacji dokument → destylat; ta zapadka pilnuje relacji wywołanie → pomiar.** B może
  przeliczyć oba końce w CI. Tutaj drugi koniec (wynik macierzy) POWSTAJE POZA CI, za pieniądze,
  ręcznie — więc zapadka porównuje odcisk zapisany w dowodzie z odciskiem policzonym z drzewa.
  Nowa oś ryzyka, której B nie ma: dowód może być zgodny i przy tym pusty, wewnętrznie sprzeczny
  albo skopiowany. Odcisk tego nie łapie.
- **Żaden precedens nie ma dwustronnej kontroli pozytywnej NA ŚCIEŻCE CI.** B ma ją w vitest i jako
  ręczną parę; A i C mają wyłącznie ręczne. Wymaganie 3 chce obu połówek, a lekcja
  `lessons.md:250-255` żąda próby czerwieni na tej ścieżce, na której bramka będzie żyła.
- **Zakres dowodu jest węższy niż zakres bramki, którą chroni** (sekcja 1.5): macierz mierzy dwa
  tanie modele, produkcja jedzie na sonnecie. Żaden istniejący precedens nie ma tej asymetrii —
  dryf schematu i destylat porównują tę samą rzecz z tą samą rzeczą.

## Code References

- `agents/review/evals/cache.ts:49-58` — `CallFingerprintParts`, cztery osie jako interfejs
- `agents/review/evals/cache.ts:72-86` — `fingerprintPrompt`, separator `\u0000` z uzasadnieniem
- `agents/review/evals/cache.ts:100-102` — `cellCacheKey`, format `review-eval:v1:<model>:<sha(fikstura)>:<odcisk>`
- `agents/review/evals/cache.ts:26` — `CACHE_FORMAT_VERSION = "v1"`, niezmieniony mimo `c2991a4`
- `agents/review/evals/cache.ts:104-107` — `isCacheEnabled()` deleguje do promptfoo
- `agents/review/evals/provider.ts:169-176` — `productionPromptFingerprint()`
- `agents/review/evals/provider.ts:118-140` — `runCell`: cache → bramka klucza → `runReview` → cache
- `agents/review/review-schema.ts:57-208` — tablica `CRITERIA` z `describe`
- `agents/review/review-schema.ts:237-254` — `criteriaShape`, interpolacja `label` do opisu `*Note`
- `agents/review/review-schema.ts:282` — `z.toJSONSchema(REVIEW_OBJECT, { target: "draft-07" })`
- `agents/review/review-schema.ts:37-47` — `SCORE_MIN`/`SCORE_MAX` i nazwany dług drugiej kopii
- `agents/review/run-review.ts:222-232` — `FIXED_CALL_OPTIONS`, wyniesione dla odcisku
- `agents/review/run-review.ts:41` — `DEFAULT_MAX_BUDGET_USD`, świadomie poza odciskiem
- `agents/review/review.ts:38` — `REVIEW_MODEL`, pin produkcyjny `anthropic/claude-sonnet-4.6`
- `agents/review/generate-criteria.ts:18-20` — dlaczego `describe` NIE wchodzi do `criteria.json`
- `agents/review/generate-criteria.ts:26-37` — serializacja i uzasadnienie prettier-czystości
- `agents/review/evals/promptfooconfig.yaml:32-48` — piny macierzy i nieobecność sonneta
- `agents/review/evals/cache.test.ts:92-104` — `blindTo`, narzędzie kontroli pozytywnej
- `agents/review/evals/cache.test.ts:382-411` — przypadki (ix) i (x), per oś
- `scripts/review-verdict.ts:32-35` — `SCORE_MIN`, `SCORE_MAX`, `SCORE_THRESHOLD`
- `scripts/review-verdict.ts:184-189` — egzekwowanie skali, jedyne miejsce
- `scripts/review-verdict.ts:205-231` — `decideVerdict`, reguła alternatywy bez średniej
- `scripts/prompt-sources.ts:64-65` — `REFRESH_COMMAND` jako eksportowana stała
- `scripts/prompt-sources.ts:162-174` — `serializeRecord` i uzasadnienie formatu
- `scripts/prompt-sources.ts:176-194` — `remedyFor`, wzorzec remedium w krokach
- `scripts/check-prompt-sources.ts:88-107` — adnotacje per pozycja + odróżnienie awarii bramki
- `.github/workflows/prompt-ratchet.yml:3-18` — dlaczego osobny plik i dlaczego bez filtra
- `.github/workflows/prompt-ratchet.yml:43-49` — dlaczego bez `npm ci`
- `.github/workflows/agents-gate.yml:10-22` — odwrotna decyzja o filtrze + odmowa przyjęcia testu bezzależnościowego
- `.github/workflows/pr-review.yml:10-15` — bramka review jest DORADCZA
- `.github/workflows/pr-review.yml:653-666` — jedyna linia zamieniająca werdykt w status joba
- `.github/workflows/pr-review.yml:282-286` — wyłączenia artefaktów generowanych z recenzowanego diffa
- `.github/actions/review-agent/action.yml:138-146` — bramka dryfu `criteria.json`
- `.prettierignore:16` — jedyny wzorzec, `context/archive/**`
- `package.json:80-87` — `lint-staged`
- `context/foundation/test-plan.md:3034-3035` — zmierzone ograniczenie `git diff --exit-code`

## Architecture Insights

- **Odcisk z WARTOŚCI bije listę ŚCIEŻEK, i to repo już to wie.** `PROMPT_SOURCES` jest listą
  ścieżek i sekcji — może się zestarzeć przez przeoczenie pliku, co `prompt-ratchet.yml:15-18`
  nazywa wprost. `fingerprintPrompt` liczy z wartości faktycznie wysyłanych do `query(...)`,
  więc tej klasy nie ma. Cena: żeby te wartości ZOBACZYĆ, trzeba je zaimportować, a import ciągnie
  `node_modules`. Bezzależnościowość i niemożność zestarzenia się są tu w konflikcie i trzeba
  wybrać, co jest ważniejsze.
- **Poszerzenie definicji odcisku jest zmianą łamiącą cache, i nie widać jej w diffie danych.**
  `c2991a4` poszerzył odcisk z dwóch osi na cztery; `CACHE_FORMAT_VERSION` został na `"v1"`.
  Zachowanie jest fail-safe (pudło, nie nieświeże trafienie), ale mechanizm przeznaczony do
  unieważniania całości nie został użyty, a trzy komórki zostały osierocone. Dla zapadki opartej
  na tym odcisku znaczy to, że **wersja definicji odcisku jest częścią kontraktu dowodu** —
  dowód wystawiony przy definicji dwuosiowej nie jest odróżnialny od dowodu czteroosiowego
  inaczej niż przez wartość, która się nie zgadza.
- **Werdykt agenta review to nie to samo co status bramki.** Pięć wartości werdyktu, jedna oś
  czerwieni (`failed-to-run`). Ta asymetria jest zaprojektowana i opisana, ale sprawia, że zdanie
  „zmienia werdykt bramki" jest w tym repo dwuznaczne: `SCORE_THRESHOLD` zmienia WERDYKT, a nie
  zmienia STATUSU. Plan powinien używać obu słów rozdzielnie.
- **Cena dowodu rośnie, gdy dowód nie mówi o produkcji.** Macierz na haiku i gemini kosztuje
  0,08-0,12 USD za przejście zimne i mówi o dwóch tanich modelach. Wymaganie dowodu przy każdej
  zmianie promptu jest tym łatwiejsze do obejścia, im słabiej dowód odpowiada na pytanie, które
  człowiek naprawdę ma („czy sonnet nadal recenzuje sensownie").
- **Prettier-czystość generowanego JSON-a jest własnością KSZTAŁTU, nie serializatora.** Dwa
  istniejące pliki są czyste przypadkiem swojej struktury. Reguła do zapisania w projekcie:
  prettier-czystość nowego artefaktu to KRYTERIUM SUKCESU do zmierzenia, dokładnie tak, jak każe
  komentarz `scripts/prompt-sources.ts:165-171` — nigdy założenie odziedziczone po sąsiedzie.

## Historical Context (from prior changes)

- `context/archive/2026-08-22-code-review-evals/verification.md:731, 740-753` — pełne przejście 2×2
  = **0,118529 USD**; 3 komórki zmierzone + 1 brak zmierzony; z tego zapłacone 0,081893 USD.
- `…/verification.md:792-807` — powtórzenie na ciepłym cache'u **0,000000 USD**, odczyt
  `/api/v1/key` przed i po identyczny co do dziewiątego miejsca. Zawężone do slotu 1 świadomie.
- `…/verification.md:822-831` — ten sam model, fikstura i prompt: koszt komórki gemini 0,0323 →
  0,013447 USD (**−58%**). „Koszt komórki ma rozrzut rzędu dziesiątek procent".
- `…/measurement-cheap-models.md:155-197` — przebiegi 3 i 6 różniące się WYŁĄCZNIE ciepłotą
  cache'u rozeszły się na sukces i `error_max_budget_usd`. To jest materiał pod decyzję 1
  („macierz w CI byłaby bramką flaky").
- `…/verification.md:809-820` — gemini oblało w fazie 7 dokładnie tę parę, którą naprawiał
  `0d3eba5`, na fiksturze, na której wcześniej zwracało poprawne `null`. „Kontrakt `null` jest
  u gemini NIESTABILNY, nie tylko odrzucany". Łapie to asercja TWARDA `swallowed-error-pair`;
  `conditional-null-contract` jest obserwacją MIĘKKĄ i niczego nie blokuje
  (`measurement-negative-control.md:219-222`).
- `…/plan.md:921-1023` — Open Risks 1-4: dwie kopie skali; jeden plik `cache.json` i wyścig
  objawiający się rachunkiem; `null` miękkie → twarde jako PYTANIE DO POMIARU; `maxTurns: 2` jako
  nienazwane założenie o kształcie wejścia.
- `…/verification.md:868-873` — poszerzenie odcisku z dwóch osi na cztery powstało właśnie po to,
  żeby zapowiedziane podniesienie `maxTurns` nie dało „kompletu TRAFIEŃ i zielonej tabeli ze
  STARYCH wyników".
- `…/change.md:16-29` — workflow evali nie został ani razu uruchomiony; warunek zamknięcia opisuje
  kształt (`workflow_dispatch` jako jedyny wyzwalacz, sekret na krok, `concurrency` na workflow,
  artefakt, `sed` na klucz, żadnego `schedule:`/`needs:`/required check) i żąda jednego przebiegu
  na dowód. **To jest inna zmiana niż ta** — tamta uruchamia macierz w CI, co decyzja 1 tutaj
  wyklucza. Warto trzymać je rozdzielnie, żeby nie zlały się w jedną.
- `context/foundation/lessons.md:194-199` — „Komenda, która ZAWSZE kończy się kodem 0, nie jest
  bramką"; wymaga pomiaru kodu wyjścia w obu kierunkach i kontroli pozytywnej.
- `lessons.md:201-206` — „A positive control must OWN the fixture it mutates".
- `lessons.md:250-255` — „Gwarancja należy do konfiguracji PLIKU": sprawdź, czy wyzwalacz sięga
  plików, które bramka pilnuje; próbę czerwieni rób NA ŚCIEŻCE, na której bramka będzie żyła;
  para dowodowa jest dowodem tylko wtedy, gdy zmienna różnicy nie może po cichu zniknąć.

## Related Research

- `context/archive/2026-08-22-code-review-evals/research.md` — wykonalność zestawu, szew ekstrakcji
  `runReview`, reżim kosztowy, wzorzec workflow evali z uzasadnieniami.
- `context/archive/2026-08-21-ci-cd-code-review/` — powstanie agenta, bramki dryfu `criteria.json`
  i zapadki `prompt-sources`; `reviews/plan-review.md:163-165` (wyłączanie artefaktów z diffa).

## Open Questions

Rzeczy, których ten research NIE rozstrzygnął, z powodem — żadna nie blokuje planowania:

- **Co dokładnie ma być w zapisanym dowodzie.** Odcisk i pass/fail wystarczą zapadce; pełna tabela
  z kosztem byłaby jedynym miejscem w repo pokazującym trend kosztu, a archiwum dowodzi, że koszt
  komórki jest zmienną losową. Pomiar z 5.2 dokłada twarde ograniczenie kształtu (tablice wartości
  prostych), ale nie rozstrzyga zakresu. Decyzja projektowa.
- **Co robi zapadka, gdy odcisk się zgadza, a dowodu nie ma wcale.** Fakty nie rozstrzygają: to
  wybór między zapadką (zielono — nic nie zmieniono, nie ma czego dowodzić) a wymogiem
  dokumentacyjnym (czerwono — dowód ma istnieć zawsze).
- **Czy dowód ma obejmować model produkcyjny.** Sekcja 1.5 nazywa asymetrię i ją mierzy, ale
  domknięcie kosztuje: sonnet zmierzono na 0,1935 USD/komórka, czyli pełna macierz 3×2 wychodzi
  poza budżet 0,50 USD tej zmiany. To jest kompromis do świadomego przyjęcia albo odrzucenia,
  nie fakt do ustalenia.
- **Czy `CACHE_FORMAT_VERSION` powinien się podbijać przy zmianie definicji odcisku.** Osierocenie
  jest fail-safe, więc to nie jest defekt — ale trzy nieusuwalne wpisy w magazynie są zmierzonym
  skutkiem ubocznym i nikt tej decyzji nie zapisał. Poza zakresem tej zmiany; warte lekcji.
- **Ile realnie kosztuje pierwsze przejście w tej zmianie.** Wiadomo, że będzie ZIMNE we wszystkich
  komórkach (3.1), i znane są kotwice (0,118529 USD za pełne przejście, rozrzut dziesiątek
  procent). Dokładna liczba będzie znana dopiero po przebiegu — i to ona, nie prognoza, wchodzi do
  rozliczenia budżetu 0,50 USD.

## Rozstrzygnięcia po researchu

Decyzje podjęte na faktach z sekcji wyżej, plus dwie rzeczy, które zamknęły się BEZ decyzji. Nic
powyżej tej linii nie zostało zmienione — ta sekcja tylko dokłada rozstrzygnięcia do ustaleń.

### D1 — Zakres dowodu: PEŁNA TABELA plus obowiązkowa adnotacja

**Decyzja.** Zapisany dowód niesie per komórkę: odcisk, pass/fail, ocenę, koszt i czas. Do tego
**obowiązkową adnotację w samym pliku**, mówiącą, czym te liczby NIE są.

**Powód.** Koszt komórki jest zmienną losową, i to zmierzoną: ta sama fikstura, ten sam model, ten
sam prompt — koszt komórki gemini 0,0323 → 0,013447 USD, czyli **−58%**
(`context/archive/2026-08-22-code-review-evals/verification.md:822-831`). Pojedynczy przebieg nie
jest więc trendem, a seria pomiarów ma wartość, której pojedynczy przebieg mieć nie może — i byłoby
to jedyne miejsce w repo, z którego widać trend kosztu.

Ale plik z liczbami bez adnotacji **zaprasza do wniosku, którego nie unosi**. Tę klasę repo już raz
musiało wycofać — C10X-39 (`context/archive/2026-08-01-local-stack-transport-flake/`): oracle'em nie
mógł tam być zielony zestaw, bo zestaw był zielony już dzięki obejściu, więc wniosek wyciągnięty
z dostępnych liczb byłby prawdziwy i pusty naraz. Mechanizm musiał zostać sprostowany osobnym
commitem (`1b12958 docs(C10X-39): correct the flake mechanism and sync the record (p6)`). Tabela
kosztów bez adnotacji odtwarza dokładnie ten układ: liczby są prawdziwe, a zdanie, które czytelnik
z nich złoży („koszt spadł", „model staniał", „prompt się poprawił") — nie.

**Adnotacja jest WYMOGIEM, nie ozdobą: dowód bez niej jest NIEPEŁNY.** Ma nazywać co najmniej to,
że jedna komórka to jeden pomiar, a nie średnia; że rozrzut kosztu sięga dziesiątek procent, więc
różnica między dwoma przebiegami nie jest sama z siebie sygnałem; że koszt liczony jest z tokenów
i cennika OpenRoutera, a nie z licznika SDK; oraz to, co wymusza D3 niżej.

**Konsekwencja cofnięcia** (zejście do samego odcisku i pass/fail): zapadka DZIAŁA dalej — do
rozstrzygnięcia wystarcza jej odcisk, a reszta pól jest dla człowieka, nie dla niej. Traci się
jedyną serię kosztową w repo, i traci nieodwracalnie: liczb z przebiegów, które już się odbyły, nie
da się odtworzyć inaczej niż płacąc za te komórki drugi raz. Cofnięcie jest więc tanie w dniu,
w którym się je robi, i niecofalne później — a to jest najgorszy możliwy rozkład kosztu decyzji.
Cofnięcie samej adnotacji przy zachowanej tabeli jest gorsze niż jedno i drugie: zostawia liczby
bez zabezpieczenia, czyli przywraca klasę C10X-39 w całości.

### D2 — Brak pliku z dowodem: CZERWONO, fail-closed

**Decyzja.** Gdy odcisk się zgadza, a pliku dowodu nie ma wcale — zapadka czerwieni.

**Powód jest mechaniczny, nie rygorystyczny.** W wariancie zielonym **usunięcie pliku wyłącza
bramkę po cichu i bez śladu w konfiguracji**: nikt nie tknął workflow, więc nie ma czego zauważyć
w przeglądzie konfiguracji, a krok od tej chwili zawsze kończy się zerem. To dokładnie klasa
z `context/foundation/lessons.md:194-199` — „Komenda, która ZAWSZE kończy się kodem 0, nie jest
bramką … bramka, która nie potrafi zaświecić na czerwono, jest gorsza niż jej brak, bo zdejmuje
czujność". Wariant zielony sprawia, że jedyny stan, w którym zapadka mogłaby wykryć własne
wyłączenie, jest nieodróżnialny od stanu normalnego.

**Koszt zerowy.** Po wdrożeniu tej zmiany plik dowodu ISTNIEJE, więc fail-closed nie czerwieni
w normalnym biegu nikomu i nigdy. Czerwień pojawia się dokładnie w dwóch sytuacjach, obu pożądanych:
ktoś skasował dowód, albo ktoś wprowadził zapadkę bez dowodu.

**Konsekwencja cofnięcia** (zielono przy braku pliku): zapadka przestaje być zapadką i staje się
wymogiem dokumentacyjnym egzekwowanym wyłącznie wtedy, gdy dowód akurat istnieje — czyli
egzekwowanym wobec każdego poza tym, kto chce ją ominąć. Jej wyłączenie kosztuje wtedy jedno
`git rm`, ukryte w diffie zmiany o zupełnie innym temacie.

### D3 — Model produkcyjny NIE wchodzi do dowodu

**Decyzja.** Dowodem zostaje macierz 2×2 — `anthropic/claude-haiku-4.5` i `google/gemini-2.5-flash`
× dwa sloty. `anthropic/claude-sonnet-4.6`, czyli pin produkcyjny (`agents/review/review.ts:38`),
do dowodu NIE wchodzi.

**Powód — arytmetyka budżetu.** Sonnet zmierzony na **0,1935 USD/komórka**
(`context/archive/2026-08-22-code-review-evals/measurement-cheap-models.md:370-378`), więc macierz
3×2 to **~0,50 USD za JEDEN przebieg** — cały budżet tej zmiany na jedno uruchomienie, bez miejsca
na choćby jedną iterację. Sekcja 3.1 dokłada, że pierwszy przebieg i tak będzie zimny we wszystkich
komórkach, więc nie ma z czego nadrobić.

**Asymetrię z sekcji 1.5 domykamy NAZWĄ I KOMUNIKATEM, nie wydatkiem.**

> ⚑ **To jest wymaganie, nie sugestia.** Nazwa zapadki, treść jej komunikatu błędu ORAZ adnotacja
> z D1 muszą mówić wprost: dowód dotyczy **reakcji dwóch TANICH modeli na zmieniony prompt**, a NIE
> zachowania recenzenta produkcyjnego. Zapadka nazwana tak, że sugeruje „prompt sprawdzony", opisuje
> gwarancję, której nie daje — a to jest ta sama klasa, przed którą broni D1.

**Czego ta zapadka NIE POKRYWA — zapisane jawnie, żeby nie trzeba było tego wyprowadzać:**
**regresji, która uderza w `anthropic/claude-sonnet-4.6`, a omija `anthropic/claude-haiku-4.5`
i `google/gemini-2.5-flash`.** Taka zmiana promptu przejdzie tę bramkę na ZIELONO, z dowodem
kompletnym, aktualnym i zgodnym z odciskiem. Dziura jest nazwana i przyjęta świadomie, nie
przeoczona.

> ⚑ Nie zapisujemy — ani tutaj, ani w komunikacie zapadki — że modele z jednej rodziny regresują
> razem. To jest prawdopodobne i **NIEZMIERZONE**. Zdanie „skoro haiku nie zregresował, sonnet też
> nie" zamieniłoby nazwaną dziurę w milczące założenie, czyli wykonałoby dokładnie ten ruch, którego
> ta pozycja zabrania. Jedyny materiał, jaki w tej sprawie mamy, idzie zresztą w drugą stronę:
> archiwum mierzy, że kontrakt `null` zachowuje się RÓŻNIE u haiku i u gemini, a u gemini bywa
> niestabilny między przebiegami przy tym samym prompcie (`verification.md:809-820`).

**Konsekwencja cofnięcia** (dołożenie sonneta do macierzy): dziura znika, a razem z nią budżet —
każdy dowód kosztuje wtedy ~0,50 USD zimno. Zapadka zaczyna wtedy uczyć obchodzenia samej siebie:
wymóg dowodu, na który nie ma pieniędzy, kończy się dowodem PRZEPISANYM zamiast wytworzonego,
a taki dowód jest zgodny z odciskiem i nic nie znaczy. Cofnięcie ma sens wyłącznie razem
z podniesieniem budżetu — jawnym, z liczbą i zapisanym tak, jak zapisano podniesienie z 1,00 na
1,20 USD w poprzedniej zmianie.

### Z1 — `CACHE_FORMAT_VERSION`: poza zakresem tej zmiany

**Dlaczego to nie była decyzja: nie było czego wybierać.** Poszerzenie definicji odcisku osierociło
wpisy w magazynie, ale osierocony wpis daje **PUDŁO, nie nieświeże trafienie** — zmierzone
w sekcji 3.1. Zachowanie jest więc fail-safe, a fail-safe nie jest defektem. Nie ma usterki, wobec
której trzeba by się opowiedzieć.

Zostaje obserwacja, nie zadanie: mechanizm przeznaczony dokładnie do unieważniania całości
(`CACHE_FORMAT_VERSION`, `agents/review/evals/cache.ts:26`) nie został użyty tam, gdzie by pasował,
i trzy wpisy leżą w `~/.promptfoo/cache` jako nieusuwalny śmieć. Podbicie wersji TUTAJ byłoby
zmianą pliku leżącego na ścieżce evali zrobioną dla porządku, bez pomiaru, który by ją zamawiał.

Materiał na wpis w `context/foundation/lessons.md` — teza brzmi: „poszerzenie definicji odcisku jest
zmianą łamiącą cache, a w diffie danych nie widać jej wcale". Nie na robotę w tej zmianie.

### Z2 — Koszt pierwszego przejścia: rozstrzyga pomiar, nie decyzja

**Dlaczego to nie była decyzja: to jest wielkość do ZMIERZENIA, nie do wybrania.** Żaden wybór nie
zmieni tego, ile realnie kosztuje przejście; można go tylko odczytać po fakcie.

Znane kotwice — 0,118529 USD za pełne przejście zimne i rozrzut kosztu komórki rzędu dziesiątek
procent — pochodzą z INNEGO przebiegu i żadna nie jest prognozą wiążącą. Do rozliczenia budżetu
0,50 USD wchodzi **liczba z faktycznego przebiegu**, odczytana z `/api/v1/key`, nigdy prognoza ani
licznik SDK (zmierzone przeszacowanie SDK: 5,0× dla haiku, 14,0× dla gemini).

Obowiązuje przy tym reguła pomiarowa ustanowiona przez poprzednią zmianę
(`measurement-negative-control.md:154-157`): odczyt wykonany bezpośrednio po przebiegu **nie jest
rachunkiem, tylko dolnym oszacowaniem** — część obciążeń księguje się z opóźnieniem, a rachunek
zamyka dopiero odczyt otwierający następne okno. Zapis „przejście kosztowało X" wymaga odczytu
z opóźnieniem, nie natychmiastowego.
