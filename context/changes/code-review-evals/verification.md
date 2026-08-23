# Verification — Promptfoo evals for the code review agent

> Dziennik dowodowy do `context/changes/code-review-evals/plan.md`. Każda faza dopisuje własną
> sekcję. Numery przebiegów są tu, a nie w `plan.md`, bo `## Progress` niesie stan, nie dowody.
>
> Repo: `lirdaw/10xcards`. Adres przebiegu: `https://github.com/lirdaw/10xcards/actions/runs/<id>`.

## Phase 3 — Bramka pakietu agenta (typecheck + testy zależne) w CI

**Data**: 2026-08-23
**PR**: [#48](https://github.com/lirdaw/10xcards/pull/48) (`code-review-evals` → `main`)

### Para dowodowa NA ŚCIEŻCE CI (kryterium 3.4)

Trzy przebiegi `Agents gate`, różniące się **jedną** rzeczą — obecnością pliku
`agents/review/probe.ts` z jednym błędem typu. Sonda celuje w krok TYPECHECK, a nie w testy:
jej nazwa nie pasuje do `*.test.ts`, więc runner testów jej nie widzi i czerwień nie może
przyjść z dwóch miejsc naraz.

| Przebieg                                                                   | Commit    | Sonda | Wynik              | Gdzie padło                              |
| -------------------------------------------------------------------------- | --------- | ----- | ------------------ | ---------------------------------------- |
| [32627834182](https://github.com/lirdaw/10xcards/actions/runs/32627834182) | `1bbbbe1` | brak  | **success** (20 s) | —                                        |
| [32627895583](https://github.com/lirdaw/10xcards/actions/runs/32627895583) | `de97385` | jest  | **failure**        | `Typecheck the agent package`, kod **2** |
| [32627937663](https://github.com/lirdaw/10xcards/actions/runs/32627937663) | `c4b2901` | brak  | **success**        | —                                        |

Treść czerwieni, dosłownie z loga przebiegu 32627895583:

```
##[error]probe.ts(9,14): error TS2322: Type 'string' is not assignable to type 'number'.
##[error]Process completed with exit code 2.
```

Czerwień przyszła z kroku nazwanego typecheckiem, z kodem 2 (czyli od `tsc`, nie od shella),
i wskazała plik sondy — więc to bramka ją wywołała, a nie cokolwiek innego w przebiegu.

### Sonda przeszła ZWYKŁYM gitem (kryterium 3.5)

Potwierdzone wykonaniem, nie rozumowaniem: `git commit` + `git push` bez `--no-verify` na
`de97385`. Oba hooki przepuściły ją tak, jak przewidywał plan — `pre-commit` (`lint-staged`)
odpala `eslint --fix` na `*.ts`, ale `eslint.config.js` ignoruje `agents/**`; `pre-push`
odpala rootowy `npm run typecheck`, a rootowy `tsconfig.json` ma `exclude: […, "agents"]`
(w logu pushu: `typecheck: OK — 176 files checked (floor 50)`). Ścieżka przez GitHub Contents
API, przewidziana w planie jako awaryjna, nie była potrzebna.

### Filtr `paths` — zmierzony, i pomiar poprawił założenie (kryterium 3.6)

**Strona pozytywna**: wszystkie przebiegi `Agents gate` wyżej wystartowały na commitach
ruszających `agents/**`, a czerwień przyszła z kroku bramki i wskazała plik sondy — więc filtr
przepuszcza to, co ma przepuszczać, i bramka za nim realnie działa.

**Kontrola negatywna wyszła INACZEJ, niż ją zaprojektowałem, i to jest tu najważniejsza
liczba.** Commit `070559a` rusza wyłącznie `context/**` — ani `agents/**`, ani samego pliku
workflow. Mimo to `Agents gate` **wystartował** ([32628026797](https://github.com/lirdaw/10xcards/actions/runs/32628026797),
success). Nie jest to defekt filtra: przy zdarzeniu `pull_request` GitHub liczy `paths`
względem CAŁEGO diffa PR-a, a nie pojedynczego pushu — a diff PR-a #48 zawiera `agents/**` od
commita `1bbbbe1`. To ta sama semantyka, którą repo ma już zapisaną w nagłówku `pr-review.yml`
i w `lessons.md`; ja zaprojektowałem kontrolę tak, jakby liczyła się względem pushu.

Korroboracja tego wyjaśnienia jest w tym samym przebiegu i nie wymaga wiary: na `070559a`
wystartował też **`CI`** ([32628026758](https://github.com/lirdaw/10xcards/actions/runs/32628026758)),
mimo `paths-ignore: ["**/*.md", "context/**"]` — czyli dwa workflowy o PRZECIWNYCH filtrach
zachowały się tak samo, co jest do pogodzenia wyłącznie z „filtr patrzy na diff PR-a".

**Czego więc ten PR NIE dowodzi i gdzie to domknąć.** Tłumiąca połowa filtra — „push nieruszający
`agents/**` NIE odpala bramki" — jest z gałęzi funkcyjnej niedowodliwa **przez konstrukcję**:
każdy PR z tej gałęzi niesie `agents/**` w diffie, a gałąź odbita od `main` nie miałaby jeszcze
pliku `agents-gate.yml` (albo miałaby go w diffie, co znów trafia w filtr). Pierwszą okazją jest
zdarzenie `push` na `main` po merdżu. **Do sprawdzenia przy `/ship`**: pierwszy commit na `main`
po merdżu tego PR-a, który nie rusza `agents/**`, nie powinien odpalić `Agents gate` — a commit
`/10x-archive` (same `context/**`) jest dokładnie takim commitem i przychodzi sam z siebie.

### Dwie rzeczy zmierzone, nie założone

**`node --test` bez ANI JEDNEGO wykrytego pliku kończy się kodem 0.** Zmierzone lokalnie
w pustym katalogu i z wzorcem pasującym do niczego: `ℹ tests 0`, `EXIT=0`. Sam skrypt testowy
nie odróżnia więc „wszystko przeszło" od „nie było czego uruchomić" — a to druga z tych rzeczy
była tu realnym ryzykiem, bo wykrywanie plików `.ts` przez wbudowany runner zależy od tego, czy
w danej wersji Node'a type-stripping jest włączony (lokalnie v24.18.0, w CI v22). To dokładnie
klasa z `lessons.md` („Komenda, która ZAWSZE kończy się kodem 0, nie jest bramką"), więc krok
testowy w `agents-gate.yml` stoi na DWÓCH nogach: kodzie wyjścia runnera ORAZ asercji na
pozytywny string w planie TAP (`1..N` dla N ≥ 1), bez rury.

**Node w CI to v22.23.2 i wykrywa `.ts` domyślnym discovery.** Z loga przebiegu 32627834182:
`node: v22.23.2`, a krok testowy wypisał `1..17`, `# tests 17`, `# pass 17`, `# fail 0` — czyli
tyle, ile jest lokalnie (prompt 6 + review-cli 4 + run-review 7). Floor się nie odezwał, bo nie
miał po co; jego wartość jest w tym, że odezwie się w dniu, w którym discovery przestanie
działać.

### Kontrole pozytywne wykonane lokalnie przed pushem

- `agents/review/tsconfig.json` z `include: ["**/*.ts"]` czerwieni się na **nowym** pliku
  (`probe-local.ts`, `TS2322`, exit 2) — czyli bramka sięga plików, których dziś nie ma,
  a więc obejmie `agents/review/evals/` z fazy 4 bez dopisywania czegokolwiek.
- Test położony w **podkatalogu** (`probe-dir/probe.test.ts`) został wykryty (`tests 18`)
  i zaczerwienił runner (`EXIT=1`) — ta sama gwarancja po stronie testów.

### Koszt: `PR code review` anulowany na tym PR-ze, przy KAŻDYM pushu

`pr-review.yml` nie ma filtra ścieżek i odpala się na `opened` i każdym `synchronize`, a jest
przypięty do `anthropic/claude-sonnet-4.6`. Przefiltrowany diff tej gałęzi to 1391 linii /
68 250 bajtów, czyli mieści się w capie 250 000 i pojechałby — wg pomiarów z
`measurement-cheap-models.md` rzędu 0,20–0,30 USD za przebieg, przy ~0,50 USD rezerwy, z której
fazy 6–7 potrzebują ~0,23 USD.

Decyzja: przebiegi recenzji anulowane ręcznie zaraz po starcie, ZANIM dojdzie do wywołania
modelu (instalacja pakietu agenta to ~335 MB i 1–2 minuty, więc okno jest szerokie).
Anulowane w fazie 3: **32627834180** (`1bbbbe1`), **32627895581** (`de97385`),
**32627937670** (`c4b2901`), **32628026747** (`070559a`), **32628170660** (`07fd32e`) — po jednym
na każdy push. Reguła obowiązuje do końca zmiany: każdy kolejny push na tę gałąź odpala
`synchronize`, więc każdy dostaje to samo anulowanie, a lista rośnie razem z fazami.
`pr-review.yml` i composite action pozostają NIETKNIĘTE — kryterium 7.7 nie jest tym naruszone.
Recenzja tego PR-a jest doradcza (nagłówek `pr-review.yml`: nie jest w `needs:`, nie jest
required check), więc anulowanie nie zdejmuje żadnej bramki.

## Phase 4 — Szkielet promptfoo: provider, cennik, cache. Zero wywołań modelu

**Data**: 2026-08-23
**PR**: [#48](https://github.com/lirdaw/10xcards/pull/48) (ta sama gałąź co faza 3)

### Zużycie klucza: NIEZMIENIONE (kryterium 4.7)

Odczyt `/api/v1/key` przed fazą i po niej, co do dziewiątego miejsca po przecinku:

| moment     | `usage`         |
| ---------- | --------------- |
| przed fazą | **0,856216627** |
| po fazie   | **0,856216627** |

Cały szkielet — provider, cennik, cache, testy, dwa przebiegi `promptfoo eval` — powstał i został
sprawdzony **bez ani jednego wywołania modelu**. Delta wynosi dokładnie zero, nie „w granicach
szumu".

> ⚑ **Ta liczba nie zgadza się z zapisem w `requirements.md`** i jest to ustalenie tej fazy, nie
> literówka. Po Pomiarze II zapisano zużycie **0,5452 USD**; dziś, przed dotknięciem czegokolwiek
> w fazie 4, klucz stoi na **0,8562 USD** — czyli **+0,3110 USD** przybyło POMIĘDZY tamtym odczytem
> a startem tej fazy. Wszystkie pięć przebiegów `PR code review` z fazy 3 zostało anulowanych po
> 10–63 s (potwierdzone w `gh run list`: pięć razy `cancelled`), czyli przed instalacją pakietu —
> więc nie one. Najprawdopodobniejsze wyjaśnienie to opóźnienie księgowania po stronie OpenRoutera,
> zapisane jako zastrzeżenie już w samym Pomiarze II („okno gemini zamknęło się na niezmienionej
> wartości"); kwota 0,3110 jest przy tym uderzająco bliska sumie trzech przebiegów Pomiaru II
> (0,3104). Rozstrzygnąć się tego nie da: `/api/v1/activity` wymaga klucza zarządzającego
> (`403: Only management keys can fetch activity`), a innego rozbicia OpenRouter nie udostępnia.
>
> **Konsekwencja dla budżetu jest realna i nie znika przez to, że przyczyna jest niepewna.** Jeżeli
> licznik klucza jest miarą wydatku tego zadania, to wydano ~0,86 USD z 1 USD, a nie ~0,50 — czyli
> na fazy 6–7 (~0,23 USD) zostaje ~0,14 USD, mniej niż potrzeba. Wymaganie 1 mówi w tej sytuacji
> „zatrzymać się i wrócić z liczbami", a nie „dopłacić" — więc **przed fazą 6 ta rozbieżność musi
> zostać rozstrzygnięta z człowiekiem**, a nie obejść.

### `npm ci` przed i po dodaniu promptfoo (kryterium 4.6)

Trzy przebiegi na komplet, ciepły cache npm, ten sam katalog (`agents/review`), Windows, Node
v24.18.0. Mediana z trzech:

| stan            | przebiegi (ms)           | **mediana**   | `node_modules` |
| --------------- | ------------------------ | ------------- | -------------- |
| przed promptfoo | 9 795 / 3 501 / 14 386   | **9 795 ms**  | 390 MB         |
| po promptfoo    | 71 035 / 72 861 / 73 092 | **72 861 ms** | **2,1 GB**     |

**Wzrost mediany: +63 066 ms (+644%).** Próg z planu to „≥ 15 s LUB ≥ 25%" — przekroczony
czterokrotnie na osi sekundowej i dwudziestopięciokrotnie na procentowej. Nie jest to przypadek
graniczny wymagający interpretacji.

Rozrzut bazowy w tym pomiarze jest duży (3,5–14,4 s, czyli 4×), więc powtórzyłem go **czysto**:
kopia ZACOMMITOWANEGO `package.json` + locka (`git show HEAD:…`) i kopia stanu obecnego, każda
w osobnym katalogu tymczasowym poza repo — ten sam warunek startowy, bez zastanego `node_modules`
i bez narzutu katalogu synchronizowanego w chmurze:

| stan (katalog izolowany) | przebiegi (ms)           | **mediana**   | `node_modules` |
| ------------------------ | ------------------------ | ------------- | -------------- |
| przed promptfoo          | 4 147 / 5 758 / 6 102    | **5 758 ms**  | 392 MB         |
| po promptfoo             | 19 205 / 44 382 / 38 302 | **38 302 ms** | **2 099 MB**   |

**Wzrost mediany: +32 544 ms (+565%).** Oba pomiary — w repo i izolowany — dają tę samą odpowiedź,
różniąc się wyłącznie skalą (+644% wobec +565%). Rozstrzygające jest to, że przedziały się NIE
STYKAJĄ: **najszybszy przebieg „po" (19,2 s) jest o 13,1 s wolniejszy od najwolniejszego „przed"
(6,1 s)**, więc wniosek nie zależy od tego, którą miarę położenia się wybierze ani jak szeroki
jest rozrzut. Katalog rozrasta się 5,4× i to jest liczba niezależna od zegara.

**DECYZJA: fallback TAK.** `tsx` → `dependencies` + `npm ci --omit=dev` w
`.github/actions/review-agent/action.yml` zostaje otwarty jako **OSOBNA zmiana z własną parą
dowodową, przed zarchiwizowaniem tej** — zgodnie z warunkiem z planu (faza 4 §1). Nie robimy tego
tutaj: to produkcyjna ścieżka CI, a pierwszy dowód, że nie zepsuła review, przyszedłby na cudzym
PR-ze.

Ustalenie, które tamtej zmianie oszczędzi połowy pracy: **ciężar siedzi w `optionalDependencies`
promptfoo, nie w jego własnym kodzie.** Najwięksi pasażerowie: `@openai` 407 MB, `@anthropic-ai`
330 MB, sam `promptfoo` 296 MB, `onnxruntime-node` 211 MB, `onnxruntime-web` 133 MB. promptfoo
deklaruje 80 zależności zwykłych i **42 opcjonalne**, a wśród tych ostatnich
`@playwright/browser-chromium`, `@huggingface/transformers`, `sharp` i `@swc/core`.
`npm ci --omit=optional` jest więc drugą dźwignią obok `--omit=dev` i warto ją zmierzyć obok niej.

### Probe mutacyjny cache'u — WYKONANY, czerwień dokładnie tam, gdzie miała być (kryterium 4.5)

Mutacja: `cellCacheKey` w `agents/review/evals/cache.ts` przestaje uwzględniać odcisk promptu.

```diff
-  return `review-eval:${CACHE_FORMAT_VERSION}:${model}:${sha256(fixture)}:${promptFingerprint}`;
+  void promptFingerprint; // PROBE MUTACYJNY
+  return `review-eval:${CACHE_FORMAT_VERSION}:${model}:${sha256(fixture)}`;
```

Wynik `npm --prefix agents/review run test` pod mutacją: **exit 1, 24 pass / 1 fail** — i tym
jednym failem jest przypadek (ii), czyli dokładnie ten, którego probe dotyczy. Treść czerwieni,
dosłownie:

```
AssertionError [ERR_ASSERTION]: zmieniony prompt TRAFIŁ w cache — nieświeży wynik zostałby podany jako zielona bramka

true !== false

    at .../agents/review/evals/cache.test.ts:190:14
```

Warunek, który czyni to KONTROLĄ, a nie zbiorem czerwieni, jest spełniony: mutacja zaczerwieniła
**swoją** asercję i **tylko** ją — przypadki (i) oraz (iii)–(viii), a także wszystkie 17 testów
pozostałych plików, przeszły. Po cofnięciu mutacji: **exit 0, 25/25**.

### Trzy rzeczy, które ta faza ZMIERZYŁA zamiast założyć

**1. promptfoo NIE rozwija `file://` w `vars` dla rozszerzenia `.diff` — i robi to po cichu.**
Pierwsza wersja konfiguracji miała `vars: { diff: file://../sample.diff }`, zgodnie z dokumentacją
o referencjach plikowych. Odczyt wyniku przebiegu (`--output out.json`) pokazał, że do providera
trafia **string o długości 21 znaków**: `"file://..\sample.diff"`. Źródło rozstrzyga sprawę:
`loadFileReference` w `promptfoo/dist/src/providers-BPravRNA.js` obsługuje `.json`, `.yaml`/`.yml`,
pliki JS/TS, `.py`, `.txt`, `.md` oraz brak rozszerzenia, a dla każdego innego rzuca
`Unsupported file extension` — ścieżka ładowania zmiennych ten rzut połyka i zostawia tekst.

Gdyby to weszło na przebieg za pieniądze, **model recenzowałby ŚCIEŻKĘ**: zwróciłby poprawny
dwudziestopolowy kontrakt, sensownie wyglądający werdykt i zielone asercje — nad materiałem,
którego nikt nie przeczytał. Defekt jest cichy po obu stronach: promptfoo nie zgłasza błędu,
a agent nie ma jak zauważyć, że dostał ścieżkę zamiast diffa. Naprawione zmianą kontraktu zmiennej
(`diffPath` = zwykła ścieżka względem `agents/review/`, rozwijana przez provider) plus **twardą
odmową na wartość zaczynającą się od `file://`**, z komunikatem nazywającym przyczynę. Pokryte
przypadkami (vi)–(viii) — w tym oraklem na DŁUGOŚĆ wczytanej treści, bo asercja „zaczyna się od
`diff --git`" przeszłaby także dla nierozwiniętej referencji, gdyby ktoś ją tak nazwał.

**2. Rekonstrukcja kosztu z cennika zgadza się z rachunkiem — ale tylko przy DWÓCH turach.**
Plan zapisał ją jako potwierdzoną („gemini 0,026 wobec 0,032; haiku 0,083 wobec 0,085"). Przeliczenie
na stawkach odczytanych dziś z `https://openrouter.ai/api/v1/models` daje obraz ostrzejszy:

| przebieg (z `measurement-cheap-models.md`) | tury | policzone | rachunek OpenRoutera | iloraz   |
| ------------------------------------------ | ---- | --------- | -------------------- | -------- |
| haiku-4.5 (Pomiar II)                      | 2    | 0,082941  | 0,084648             | 0,98     |
| sonnet-4.6 (Pomiar II)                     | 2    | 0,188797  | 0,193523             | 0,98     |
| gemini-2.5-flash (Pomiar I, przebieg 5)    | 2    | 0,013508  | 0,012074             | 1,12     |
| gemini-2.5-flash (Pomiar II)               | 3    | 0,017300  | 0,032321             | **0,54** |

Trzy pierwsze mieszczą się w ±12%, czwarty myli się prawie dwukrotnie — i różni się od nich
**wyłącznie liczbą tur**. Wyjaśnienie jest w samym Pomiarze I: `usage` pochodzi z OSTATNIEJ
wiadomości SDK, nie z sumy po turach, więc przy `numTurns > 2` liczniki nie obejmują całego
przebiegu. Konsekwencja zapisana w kodzie (`pricing.ts`) i przenoszona do raportu z fazy 5:
**kwota jest DOLNYM oszacowaniem, gdy `numTurns > 2`**, a `numTurns` ma stać w tabeli obok kwoty.
Świadomie NIE korygujemy tego współczynnikiem — dopasowanie do jednego punktu byłoby zgadywaniem
udającym pomiar.

**3. Literalny bajt NUL w źródle czyni plik binarnym dla gita.**
`fingerprintPrompt` łączy prompt i schemat separatorem, którego nie może zawierać żaden z nich —
i separator ten wylądował w pliku jako **literalny bajt NUL**. `grep` zaczął odpowiadać
`Binary file evals/cache.ts matches`, a git przestałby pokazywać diff tego pliku. Wykryte
skanowaniem bajtów wszystkich nowych plików, nie przypadkiem. Naprawione zapisem escape'owym
(`"\u0000"`) — wartość odcisku bez zmiany, źródło znów tekstowe. Skan powtórzony na komplecie
plików fazy: zero znaków sterujących, a `git diff --numstat` liczy linie (a nie `-`) dla każdego
z nich.

### Bramki lokalne

| komenda                                    | wynik                                       |
| ------------------------------------------ | ------------------------------------------- |
| `npm --prefix agents/review run typecheck` | **exit 0** (nowe pliki `evals/` w zakresie) |
| `npm --prefix agents/review run test`      | **exit 0**, `tests 25 / pass 25 / fail 0`   |
| `npm run eval` bez `ANTHROPIC_AUTH_TOKEN`  | **exit 100**, `1 error (100%)`              |

Odmowa bez klucza, dosłownie z tabeli przebiegu:

```
[ERROR] [config] Brak ANTHROPIC_AUTH_TOKEN — zestaw evali NIE wykonał wywołania.
Zmapuj klucz na jedno uruchomienie, np. `ANTHROPIC_AUTH_TOKEN=$OPENROUTER_REVIEW_KEY npm run eval`.
```

To jest odmowa **z właściwego powodu**: komunikat mówi o kluczu, a nie o fiksturze — czyli
`diffPath` rozwinął się poprawnie i zatrzymała dopiero bramka poświadczeń. Gdyby fikstura nie
dojechała, w tym samym miejscu stałby komunikat `[config]` o `diffPath`, a kryterium 4.3
zaliczyłoby się z niewłaściwego powodu.

Liczba testów pakietu rośnie 17 → 25: osiem nowych przypadków w `evals/cache.test.ts`.

### Dwa odstępstwa od planu, oba zapisane jako decyzje

**(a) `promptfooconfig.yaml` powstaje w fazie 4, nie w fazie 5.** Plan wymienia go jako nowy plik
fazy 5, ale kryterium 4.3 mówi o „uruchomieniu ZESTAWU" bez klucza — a bez konfiguracji nie ma
czego uruchomić i kryterium spełniałoby się na atrapie, nie na zestawie. Powstała wersja MINIMALNA
(jeden provider, jedna fikstura, zero asercji), którą faza 5 rozwija do macierzy 2×2; nagłówek
pliku mówi to wprost. Zakres fazy 5 się przez to nie zmniejsza — zmienia się „utwórz" na „rozszerz".

**(b) `run-review.ts` (plik fazy 2) dostaje pole `kind` na rzucie.** Plan wymaga, żeby provider
wyciągał `FailureKind` „nie parsowaną z tekstu ponownie" — a bez nośnika strukturalnego jedyną
drogą byłoby wyłuskanie `[kind]` z `err.message`, czyli bramka na TREŚCI między dwoma plikami tego
samego pakietu. Dodane: `ReviewFailure`, `isReviewFailure`, prywatna fabryka `reviewFailure`.
**Kształt rzutu nie zmienia się o bajt**: prototypem zostaje `Error` (żadnej podklasy — `ReviewError:`
zmieniłoby linię czytaną przez `pr-review.yml:529`), a prefiks `[kind]` w komunikacie zostaje.
Nowy kontrakt jest pod siatką: `assertFailure` w `run-review.test.ts` asertuje teraz TRZY rzeczy
naraz — prefiks, `failure-kind=` w `$GITHUB_OUTPUT` i pole `kind` — dla każdej z czterech klas
awarii, a przypadek „brak wiadomości `result`" asertuje, że pola NIE MA (bo tam klasy nie znamy
i nie wolno jej zgadnąć).

### Bramka na PR-ze: pierwsze podejście CZERWONE, i czerwień była prawdziwa (kryterium 4.4)

| Przebieg                                                                   | Commit    | Wynik       | Gdzie padło                           |
| -------------------------------------------------------------------------- | --------- | ----------- | ------------------------------------- |
| [32630687994](https://github.com/lirdaw/10xcards/actions/runs/32630687994) | `1b311ce` | **failure** | `Install the agent package`, `npm ci` |

Treść, dosłownie z loga:

```
npm error code EUSAGE
npm error `npm ci` can only install packages when your package.json and package-lock.json
npm error or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
npm error
npm error Missing: gcp-metadata@7.0.1 from lock file
```

**To jest defekt, którego żaden przebieg lokalny nie mógł zobaczyć — i dlatego warto go zapisać.**
Lokalnie `npm ci` w `agents/review` przeszedł SZEŚĆ razy pod rząd (pomiar 4.6) i jeszcze raz przy
weryfikacji. Różnicą nie jest system operacyjny, tylko **wersja npm**:

| gdzie    | Node     | npm         | werdykt o tym samym locku |
| -------- | -------- | ----------- | ------------------------- |
| lokalnie | v24.18.0 | **11.16.0** | `npm ci` OK               |
| CI       | v22.23.2 | **10.9.8**  | `npm ci` EUSAGE           |

Mechanizm: `mongoose/node_modules/mongodb` deklaruje `gcp-metadata: ^7.0.1` jako zależność
opcjonalną. **npm 11 przycina ten wpis z locka**, uznając go za niespełniony opcjonalny peer;
**npm 10 uważa jego brak za rozjazd** między `package.json` a lockiem i odmawia instalacji. Lock
wygenerowany nowszym npm jest więc dla starszego NIEKOMPLETNY — a ponieważ `npm install` biegnie
tylko na maszynie autora, a `npm ci` tylko w CI, rozjazd nie ma jak ujawnić się przed pushem.

Naprawa: lock zregenerowany **wersją npm z CI** (`npx npm@10.9.8 install`), co dokłada
`node_modules/mongoose/node_modules/gcp-metadata@7.0.1`. Wybór kierunku nie jest dowolny — starszy
npm czyta lock lockfileVersion 3 obu generacji, nowszy nie akceptuje braków, więc **lock generuje
się wersją CI, nie lokalną**.

Kontrola wykonana PRZED pushem poprawki, żeby drugie podejście nie było kolejnym zgadywaniem:

| sprawdzenie                                               | wynik             |
| --------------------------------------------------------- | ----------------- |
| `npx npm@10.9.8 ci` na kopii locka poza repo (parytet CI) | **exit 0**        |
| `npm ci` lokalnym npm 11.16.0                             | **exit 0**        |
| `npm --prefix agents/review run typecheck`                | **exit 0**        |
| `npm --prefix agents/review run test`                     | **exit 0**, 25/25 |

Para dowodowa dla kryterium 4.4 jest więc mimowolna, ale pełna: **czerwień** (`1b311ce`, lock
niespójny dla npm 10) → **poprawka** (regeneracja locka) → **zieleń**, przy zmianie dokładnie
jednej rzeczy.

Drugie podejście, po regeneracji locka:

| Przebieg                                                                   | Commit    | Wynik       | Czas     |
| -------------------------------------------------------------------------- | --------- | ----------- | -------- |
| [32630858709](https://github.com/lirdaw/10xcards/actions/runs/32630858709) | `84c3257` | **success** | **69 s** |

Krok testowy, dosłownie z loga — i to jest właściwy dowód na kryterium 4.4, mocniejszy niż sam
zielony przebieg:

```
node: v22.23.2
added 717 packages, and audited 718 packages in 46s
1..25
# tests 25
# pass 25
# fail 0
```

`1..25` na runnerze wobec 17 przed tą fazą oznacza, że **discovery wbudowanego runnera wykryło
osiem nowych przypadków leżących w PODKATALOGU `evals/`** — czyli bramka założona w fazie 3 realnie
sięga katalogu, którego wtedy jeszcze nie było. To domyka obietnicę zapisaną przy kryterium 3.4
(„To, że bramka sięga także `evals/`, potwierdza kryterium 4.4 na PR-ze fazy 4"), i domyka ją
liczbą z runnera, a nie rozumowaniem o `include` w tsconfigu.

### Trzeci pomiar instalacji — ten z prawdziwej ścieżki CI

Bramka daje liczbę, której żaden pomiar lokalny nie zastąpi, bo pochodzi z tego samego runnera,
tej samej wersji npm i tego samego cache'u co CI:

| przebieg `Agents gate`                                                     | commit    | promptfoo | `npm ci` | CAŁY przebieg |
| -------------------------------------------------------------------------- | --------- | --------- | -------- | ------------- |
| [32627834182](https://github.com/lirdaw/10xcards/actions/runs/32627834182) | `1bbbbe1` | nie       | —        | **20 s**      |
| [32630858709](https://github.com/lirdaw/10xcards/actions/runs/32630858709) | `84c3257` | tak       | **46 s** | **69 s**      |

Przebieg bramki rośnie 20 s → 69 s, czyli **3,4×**, a sama instalacja to 46 s z tych 69. Kierunek
i rząd wielkości zgadzają się z pomiarami lokalnymi (+565% izolowanie, +644% w repo), więc decyzja
o fallbacku stoi teraz na trzech niezależnych pomiarach, w tym jednym z produkcyjnego runnera.

⚑ Ta liczba dotyczy `agents-gate.yml`, nie `action.yml`. **Composite action płaci to samo przy
KAŻDYM przebiegu review na KAŻDYM PR-ze w repo** — i to jest ta ścieżka, którą otwarta wyżej
osobna zmiana ma odciążyć przez `--omit=dev`.

### Koszt: `PR code review` anulowany dalej, przy każdym pushu

Anulowane w fazie 4: **32630687986** (`1b311ce`, po 34 s), **32630858713** (`84c3257`, po 27 s).
Oba przed instalacją pakietu, więc przed jakimkolwiek wywołaniem modelu.
