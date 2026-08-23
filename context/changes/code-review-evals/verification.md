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

Anulowane w fazie 4: **32630687986** (`1b311ce`, po 34 s), **32630858713** (`84c3257`, po 27 s),
**32630995454** (`04313e6`). Wszystkie przed instalacją pakietu, więc przed jakimkolwiek
wywołaniem modelu — co potwierdza odczyt klucza na końcu fazy.

---

## Phase 5 — Fikstury, macierz i asercje

**Data**: 2026-08-23
**Wydatek fazy**: **0,00 USD**. Ani jednego wywołania modelu — dowód niżej.

### Zużycie klucza: NADAL NIEZMIENIONE (kryterium 5.6)

| moment     | `usage`         |
| ---------- | --------------- |
| po fazie 4 | **0,856216627** |
| po fazie 5 | **0,856216627** |

Odczyt `/api/v1/key` po zamknięciu fazy, co do dziewiątego miejsca po przecinku. Delta wynosi
dokładnie zero.

Dowód jest przy tym MOCNIEJSZY niż sam odczyt, bo nie stoi na czujności autora.
`ANTHROPIC_AUTH_TOKEN` nie był ustawiony w środowisku ani razu w całej fazie (sprawdzone przed
przebiegiem: zmienna nieustawiona), a bramka klucza w `runCell` stoi PO odczycie cache'u — więc
każde pudło cache'u kończyło się odmową `[config]`, nigdy próbą wywołania. „Zero wywołań" jest tu
własnością konstrukcji, nie deklaracją.

> ⚑ **Rozbieżność budżetowa otwarta w fazie 4 NADAL JEST OTWARTA i blokuje fazę 6.** Licznik
> klucza stoi na 0,8562 USD z 1 USD budżetu zadania, a fazy 6-7 potrzebują ~0,23 USD. Faza 5 nie
> zmieniła tu niczego (bo nic nie wydała) i nie miała jak: to jest decyzja do podjęcia
> z człowiekiem, zgodnie z wymaganiem 1. **Nie zaczynać fazy 6 przed jej rozstrzygnięciem.**

### Bramki lokalne

```
npm --prefix agents/review run typecheck   → zielone (zero błędów)
npm --prefix agents/review run test        → 45/45
```

45 przypadków wobec 25 po fazie 4: +12 z `evals/assertions.test.ts`, +8 z `evals/report.test.ts`.
Discovery wbudowanego runnera sięga podkatalogu `evals/` bez dopisywania czegokolwiek —
potwierdzone już przy kryterium 4.4, tu tylko odnotowane, że nadal obowiązuje.

### Kontrola pozytywna asercji — każda mutacja czerwieni SWOJĄ asercję i tylko ją (kryterium 5.4)

Sześć asercji twardych, osiem mutacji, każda zmieniająca DOKŁADNIE JEDNO pole zamrożonego obiektu
`Review`. Orakl nie brzmi „coś jest czerwone", tylko „czerwona jest dokładnie ta jedna, a wszystkie
pozostałe są zielone" — bo mutacja wywalająca dwie asercje znaczyłaby, że jedna z nich pilnuje
czegoś innego, niż deklaruje.

| mutacja                                            | czerwona asercja          | pozostałe |
| -------------------------------------------------- | ------------------------- | --------- |
| `verdict` odwrócony (`fail` → `pass`)              | `verdict`                 | zielone   |
| `complexity = 42`                                  | `score-range`             | zielone   |
| `complexity = 0`                                   | `score-range`             | zielone   |
| `scopeDiscipline = null`                           | `scope-discipline-scored` | zielone   |
| `implementationCorrectnessNote = "   "`            | `notes-non-empty`         | zielone   |
| `gateIntegrity = 7` (przy `swallowedError` liczbą) | `swallowed-error-pair`    | zielone   |
| `swallowedError = null`                            | `swallowed-error-pair`    | zielone   |
| odpowiedź z `error` zamiast obiektu                | `no-provider-error`       | POMINIĘTE |

**Ostatni wiersz jest ustaleniem, nie wyjątkiem.** Gdy komórka wraca z błędem, pozostałe pięć
asercji NIE MA CZEGO sprawdzić — i dostaje trzeci status `skip`, wypisywany jawnie, zamiast cichej
zieleni. Odwzorowuje to RZECZYWISTE zachowanie promptfoo, odczytane w źródle ewaluatora
(`applyRunEvalResponseOutcome`): przy `response.error` ustawia `success: false` i **wraca przed
`runAssertions`**. Gdyby te pięć zwracało `pass`, test przechodziłby także wtedy, gdyby asercja po
cichu przestała cokolwiek widzieć.

**Zmierzona granica asercji `no-provider-error`, zapisana zamiast przemilczana:** skoro promptfoo
wraca przed `runAssertions`, ta asercja w PRAWDZIWYM przebiegu nigdy się nie wykona — komórka jest
czerwona tak czy inaczej, bramkę trzyma sam ewaluator. Asercja dokłada NAZWĘ w raporcie i jest
jedynym miejscem, gdzie warunek „`safeParse` przeszedł" jest zapisany jako sprawdzenie. Czerwień
potrafi pokazać (wiersz ostatni), więc nie jest niefalsyfikowalna — ale nie udajemy, że jest
bramką, którą nie jest.

### Dwie asercje ŚWIADOMIE POMINIĘTE jako tautologie

„Komplet 20 pól kontraktu" i „kryteria warunkowe typu `number | null`" nie trafiły do zestawu.
`runReview` oddaje wynik WYŁĄCZNIE po udanym `REVIEW_SCHEMA.safeParse`, a schemat wymaga
wszystkich 20 pól (zero `.optional()`, zero `.passthrough()`), więc żadna wartość, jaką provider
jest w stanie zwrócić, nie zaświeciłaby ich na czerwono. To ta sama pułapka co `is-json` na wyjściu
obiektowym. Bramka, która nie potrafi zaświecić na czerwono, jest gorsza niż jej brak.

### Przejście macierzy bez ani jednego wywołania modelu (kryterium 5.2)

Cztery komórki zaseedowane w teście, `promptfoo eval` uruchomione end-to-end przez `report.ts`,
`ANTHROPIC_AUTH_TOKEN` USUNIĘTY na czas przebiegu:

```
Results:
  ✓ 4 passed (100%)
Duration: 1s (concurrency: 4)
```

Cztery komórki, cztery TRAFIENIA, `[config]` nie pada ani razu — a padłoby przy każdym pudle, bo
klucza nie było. To jest dowód „zero wywołań" przez konstrukcję, nie przez odczyt licznika.

### Ta sama tabela na ścieżce AWARII — przebieg bez klucza

Uruchomienie `npm --prefix agents/review run eval` bez poświadczeń, zimny cache:

```
| model                      | fikstura               | werdykt | kontrakt | tury | ... | koszt USD | cache | asercje |
| anthropic/claude-haiku-4.5 | sample.diff            | —       | [config] | —    | ... | —         | zimna | —       |
| google/gemini-2.5-flash    | sample.diff            | —       | [config] | —    | ... | —         | zimna | —       |
| anthropic/claude-haiku-4.5 | clean-text-change.diff | —       | [config] | —    | ... | —         | zimna | —       |
| google/gemini-2.5-flash    | clean-text-change.diff | —       | [config] | —    | ... | —         | zimna | —       |

Suma przejścia: 0.000000 USD z 0/4 komórek; trafienia cache'u: 0/4.
Cennik: 2026-08-23 (0 dni temu), źródło https://openrouter.ai/api/v1/models. Kwoty liczone z tokenów, NIE z total_cost_usd SDK.
Bez kwoty (4): … — brak metryk
Czerwone komórki (4/4): … kontrakt [config]
    ✗ [config] Brak ANTHROPIC_AUTH_TOKEN — zestaw evali NIE wykonał wywołania.
```

Trzy rzeczy, dla których ten przebieg został zapisany:

1. **Raport renderuje się przy KODZIE WYJŚCIA ≠ 0.** Dlatego przejście uruchamia `report.ts`, a nie
   skrypt npm sklejony operatorem powłoki: `&&` dałby raport tylko przy zieleni, a `;` nie jest
   separatorem w `cmd.exe`. Przebieg z czerwoną komórką potrzebuje raportu NAJBARDZIEJ.
2. **Suma nie udaje kompletnej.** „0.000000 USD z **0/4** komórek" plus wiersz „Bez kwoty (4)" —
   zero wpisane bez tego kontekstu czytałoby się jak „przejście było darmowe".
3. **Kryterium 4.3 nadal obowiązuje** po przejściu z jednej komórki na cztery.

### ⚑ Wyścig cache'u — ZMIERZONY, nie założony

Przypadek (B) był **zielony uruchomiony sam** i **czerwony w komplecie `npm run test`** — cztery
PUDŁA cache'u. Przyczyna odczytana w źródle promptfoo (`getCacheInstance`): cały cache to JEDEN
plik `cache.json` obsługiwany przez `KeyvFile`, który wczytuje mapę do pamięci i zapisuje ją
w CAŁOŚCI. `node --test` biegnie po plikach równolegle, więc `cache.test.ts` (piszący do
PRAWDZIWEGO magazynu, i słusznie — to on dowodzi klucza produkcyjnego) kasował wpisy zaseedowane
przez `report.test.ts`.

Naprawa: przypadek (B) dostaje własny `PROMPTFOO_CACHE_PATH` w katalogu tymczasowym, sprzątany
przez usunięcie katalogu — a nie przez `forgetCell`, który po przywróceniu zmiennej celowałby już
w magazyn produkcyjny i kasował cudze wpisy.

**Konsekwencja wykracza poza test i jest zapisana jako ryzyko otwarte nr 2 w planie:** dwa
przebiegi evali odpalone naraz mogą sobie unieważnić cache, a objawi się to nie awarią, tylko
RACHUNKIEM. Przebiegi faz 6-7 idą sekwencyjnie, więc ich to nie dotyczy.

### Kontrola negatywna przeczytana jako diff (kryterium 5.5)

`agents/review/evals/fixtures/clean-text-change.diff`, 26 linii, dwa pliki, **wyłącznie tekst**:

- `src/components/Welcome.astro` — jedna linia copy w hero (`-`/`+`), nic poza treścią akapitu;
- `README.md` — trzy linie nowego akapitu w sekcji „Jak to działa".

Czego w tym diffie NIE MA, wyliczone wprost, bo to jest warunek poprawności fikstury, nie jej
higiena: żadnego warunku, żadnej obsługi błędu, żadnego sprawdzenia, żadnego testu, żadnego kroku
CI, żadnej zmiany w kodzie wykonywalnym. Tekstowość jest tym, co czyni `null` na kryteriach 7 i 8
LEGALNYM, a nie ratunkiem — definicja „nie dotyczy" dla kryterium 7 wymienia wprost zmianę
wyłącznie w treści UI lub dokumentacji.

**Materiał z `verification.md` nie istniał jako plik** — przeniesiony został KONTRAKT (dwie zmiany
tekstowe, oczekiwany `verdict: pass`, kryteria 7 i 8 równe `null`), nie treść.

Odczyt nie skończył się na przeczytaniu. Skan MASZYNOWY po liniach ZMIENIANYCH (5 dodanych,
1 usunięta; linie kontekstu z znacznikami HTML są kontekstem, nie zmianą) pod kątem pięciu klas
konstrukcji — warunek, obsługa błędu, sprawdzenie, kod wykonywalny, krok CI — dał **0 trafień**:

```
PLIKI ZMIENIANE: 2
   src/components/Welcome.astro
   README.md
LINII DODANYCH: 5 | USUNIĘTYCH: 1
TRAFIENIA ZAKAZANYCH KONSTRUKCJI W LINIACH ZMIENIANYCH: 0
```

Kodowanie potwierdzone osobno (`cat -A`): plik jest UTF-8, polskie znaki jako sekwencje
dwubajtowe, bez CRLF. To ma znaczenie, bo fikstura jedzie do modelu jako materiał — uszkodzone
kodowanie zmieniłoby wejście przebiegu, nie tylko wygląd pliku.

⚑ Asercji `swallowedError === null` i `gateIntegrity === null` w tej fazie **JESZCZE NIE MA**.
Wchodzą po fazie 6, czyli po zmierzeniu, co modele na tej fiksturze naprawdę zwracają. Czerwień
znacząca „zapisz to" i czerwień znacząca „regresja" nie mogą wyglądać tak samo.

### Odstępstwo od planu, zapisane jako decyzja

**Plan mówił: „wartości progowe brać z `SCORE_MIN`/`SCORE_MAX` (`scripts/review-verdict.ts:32-33`)".**
Tego nie da się zrobić: granica `agents/**` zakazuje importu w obie strony (`scripts/` czyta
z agenta DANE, nigdy kodu). Intencja — nazwana stała zamiast literału — została utrzymana przez
umieszczenie skali po stronie KONTRAKTU (`agents/review/review-schema.ts`), bo tam jest jej
miejsce: schemat nie potrafi jej wymusić (structured output Anthropica odrzuca `minimum`/`maximum`),
więc zakres jest własnością kontraktu, którą trzyma opis pola i ta jedna asercja.

Duplikacja wobec `scripts/` **nie została zostawiona jako komentarz** — jest zapisana jako ryzyko
otwarte nr 1 w planie, z warunkiem zamknięcia (przeniesienie skali do `criteria.json`, osobną
zmianą) i z powodem, dla którego nie robimy tego tutaj (kształt `criteria.json` jest bramkowany
przez `git diff --exit-code` w composite action, czyli leży na produkcyjnej ścieżce CI).

---

## Phase 6 — Pomiar kontroli negatywnej (ZATRZYMANA NA PROGU BUDŻETU)

**Data**: 2026-08-23
**Wydatek fazy**: **0,090682 USD** (jedyny przebieg obciążony: haiku)
**Pełny zapis pomiaru**: `measurement-negative-control.md`

### Stan fazy: 6.3-6.5 spełnione, 6.1-6.2 NIE — i tak zostają w Progresie

| kryterium                                          | stan    | dlaczego                                      |
| -------------------------------------------------- | ------- | --------------------------------------------- |
| 6.1 oba przebiegi `terminal_reason: completed`     | **NIE** | gemini: dwie próby, `api_error` i `max_turns` |
| 6.2 `safeParse` przeszedł w obu                    | **NIE** | haiku tak; gemini nie dojechało do walidacji  |
| 6.3 realny rachunek z `/api/v1/key`                | tak     | 0,856216627 → 0,946898827                     |
| 6.4 decyzja o asercji `=== null`                   | tak     | wariant C, uzasadniony w notatce pomiarowej   |
| 6.5 wydatek zsumowany, przekroczenie = zatrzymanie | tak     | patrz „Stan budżetu" niżej                    |

**6.1 i 6.2 zostają NIEODHACZONE świadomie.** „Niezmierzone" i „zmierzone jako w porządku" nie mogą
wyglądać w Progresie tak samo — a odhaczenie ich z przypisem byłoby dokładnie tym zrównaniem.

### Ustalenie główne: haiku ODRZUCA kontrakt `null`, nie myli się co do materiału

Na kontroli negatywnej haiku wystawiło `swallowedError: 10` i `gateIntegrity: 10` zamiast `null`.
Noty mówią to wprost:

> „Kryterium nie dotyczy, **ale ocena 10 oddaje fakt braku ryzyka** na tej ścieżce."
> „Kryterium nie ma zastosowania, **ale ocena 10 oddaje fakt**, że żadna bramka nie została osłabiona."

Model rozpoznał materiał POPRAWNIE i odrzucił samą regułę — mimo 27 linii promptu z `0d3eba5`,
które nazywają ten ruch błędem oceny. Ten sam wzorzec w `testRiskCoverage: 10` („nie ma
zastosowania, więc 10") pokazuje, że nie jest ograniczony do kryteriów warunkowych.

Skutek arytmetyczny: średnia dziewięciu ocen **9,56** na czystej zmianie tekstowej — zmiana, która
nie ruszyła żadnej ścieżki zapisu, wypada lepiej niż zmiana, która ruszyła ją i obsłużyła porządnie.

**Asercje twarde wyszły 5/5 zielone — i to jest dowód, że projekt fazy 5 zadziałał, a nie że wynik
jest dobry.** Asercji `=== null` celowo tam nie było. Gdyby weszła przed pomiarem, ta komórka
byłaby czerwona i nie dałoby się odróżnić czerwieni znaczącej „zapisz to" od „regresja".

### Gemini: dwie próby, dwie różne awarie, ZERO wyniku i ZERO kosztu

| próba | `subtype`         | `terminal_reason` | komunikat                           | klasa        |
| ----- | ----------------- | ----------------- | ----------------------------------- | ------------ |
| 1     | `success`         | `api_error`       | stream closed before completion     | `[provider]` |
| 2     | `error_max_turns` | `max_turns`       | Reached maximum number of turns (2) | `[unknown]`  |

Obie komórki CZERWONE i NAZWANE — dokładnie ta własność, dla której faza 4 kazała `callApi` łapać
rzut i zwracać `{ error }`. Gdyby rzut wyszedł na zewnątrz, „padnięta sieć" i „regresja kontraktu
wyjścia" wyglądałyby identycznie.

**Sprawdzone, że to NIE jest regresja ekstrakcji z fazy 2**: `git show 0d3eba5:agents/review/review.ts`
ma `maxTurns: 2` z tym samym komentarzem; `run-review.ts` na HEAD ma tę samą wartość. Nowa jest
FIKSTURA — na `sample.diff` gemini kończyło `completed`, na kontroli negatywnej nie kończy. Zapisane
jako ryzyko otwarte nr 4, z obserwacją ważniejszą niż sam limit: `maxTurns: 2` nie jest własnością
agenta, tylko nienazwanym założeniem o wielkości wejścia.

### Decyzja: wariant C — asercja MIĘKKA

Reguła `null` weszła jako obserwacja raportowana, nie bramkująca (`conditional-null-contract`).
Pełne uzasadnienie i odrzucenie wariantów A/B: `measurement-negative-control.md`.

Dowód, że obserwacja nie jest ozdobą — cztery przypadki w `evals/assertions.test.ts`: zmierzony
wynik haiku jest WIDZIANY (`fail`), ten sam wynik NIE rusza ani jednej asercji twardej, materiał
z poprawnym `null` obserwację dotrzymuje, a rejestry twardy i miękki są rozłączne.

Wyrenderowane na żywym przebiegu (trafienie cache'u, 0,00 USD):

```
Wszystkie komórki zielone na asercjach twardych.

Obserwacje MIĘKKIE (raportowane, NIE bramkują zieleni) — 1 niedotrzymanych z 1:
  ✗ anthropic/claude-haiku-4.5 / clean-text-change.diff [conditional-null-contract] ocena zamiast
    `null` tam, gdzie kryterium nie ma zastosowania: swallowedError = 10, gateIntegrity = 10
```

### Defekt raportu ZŁAPANY na żywym przebiegu i naprawiony

Przy komplecie trafień raport pokazywał „Suma przejścia: 0.088646 USD" nad wierszem `TRAFIENIE` —
czyli kwotę czytającą się jak WYDATEK za przebieg, który nie kosztował nic. W bramce kosztowej to
nie jest kosmetyka: wymaganie 6 („powtórzenie jest darmowe") sprawdza się dokładnie tą liczbą.

Raport rozdziela teraz dwie kwoty:

```
Koszt komórek: 0.088646 USD z 1/1 komórek; trafienia cache'u: 1/1.
ZAPŁACONE w tym przejściu: 0.000000 USD (trafienia cache'u nie kosztują).
```

Przypadek `(A8)` w `report.test.ts` pilnuje tego rozdzielenia — offline, na obiekcie.

⚑ Ten defekt był NIEWIDOCZNY dla wszystkich testów fazy 5, bo tamten przebieg end-to-end miał
komplet trafień i nikt nie czytał sumy jako kwoty. Znalazł go dopiero przebieg MIESZANY (jedna
komórka zimna, jedna z cache'u) na prawdziwych danych.

### Rachunek

| moment                           | `usage`           |
| -------------------------------- | ----------------- |
| przed fazą 6                     | **0,856216627**   |
| po przebiegu haiku               | **0,946898827**   |
| po obu nieudanych próbach gemini | **0,946898827**   |
| odczyt otwierający fazę 7        | **0,978206026** ⚑ |

> **⚑ SPROSTOWANIE z fazy 7.** Ostatni wiersz obala zapisane wyżej „obie próby gemini nic nie
> kosztowały". Między zamknięciem fazy 6 a otwarciem fazy 7 nie uruchomiono niczego, a licznik
> urósł o **0,031307 USD** — to opóźnione księgowanie tych dwóch prób. **Nieudany przebieg JEST
> obciążany**, a natychmiastowy odczyt `/api/v1/key` jest dolnym oszacowaniem, nie rachunkiem.
> Rzeczywisty koszt fazy 6: **0,121989 USD**.

Nasz rachunek dla haiku (0,088646 USD) wobec realnej delty (0,090682 USD) — **iloraz 0,98**, mimo
że przebieg był TRZYTUROWY. Zastrzeżenie z `pricing.ts` („przy `> 2` kwota jest dolnym
oszacowaniem") zawęża się więc: rozbieżność nie jest funkcją samej liczby tur.

### Stan budżetu — zadanie zatrzymuje się na PROGU, nie na awarii

| pozycja                      | kwota            |
| ---------------------------- | ---------------- |
| licznik klucza po fazie 6    | **0,946899 USD** |
| budżet zadania (wymaganie 1) | **1,00 USD**     |
| **zostaje**                  | **0,0531 USD**   |
| faza 7 potrzebuje            | **~0,117 USD**   |

Faza 7 nie mieści się. Jej uruchomienie jest **decyzją o podniesieniu budżetu**, nie krokiem
implementacji — i tak zostało zapisane w planie (sekcja „Open Risks", „Stan budżetu w chwili
zatrzymania"). Rozróżnienie musi być zapisane, bo za miesiąc „plan zatrzymany na fazie 7"
i „plan, któremu coś padło" wyglądają tak samo.

### Bramki lokalne po fazie 6

```
npm --prefix agents/review run typecheck   → zielone
npm --prefix agents/review run test        → 53/53 (było 45 po fazie 5: +6 miękkich, +2 raportu)
```

---

## Phase 7 — Pierwsze pełne przejście macierzy 2×2

**Data**: 2026-08-23
**Koszt fazy**: **0,118529 USD** (rachunek z `/api/v1/key`, nie z licznika SDK)
**Wynik**: **3 komórki ZMIERZONE + 1 BRAK ZMIERZONY**, nie cztery wyniki

### Decyzja budżetowa zapisana PRZED wydatkiem

Commit `fb85f02` — podniesienie progu z 1,00 do 1,20 USD wylądowało w `requirements.md` obok
oryginału, zanim padło pierwsze wywołanie tej fazy. Kolejność jest tu treścią, nie porządkiem:
notatka napisana po przekroczeniu progu byłaby usprawiedliwieniem, nie decyzją.

### Tabela przejścia

```
| model                      | fikstura               | werdykt | kontrakt  | tury | in   | out  | cache zapis | cache odczyt | koszt USD | cache     | asercje |
| google/gemini-2.5-flash    | sample.diff            | fail    | ok        | 2    | 0    | 4299 | 23816       | 23816        | 0.013447  | zimna     | 5/6     |
| anthropic/claude-haiku-4.5 | sample.diff            | fail    | ok        | 2    | 10   | 4094 | 38373       | 0            | 0.068446  | zimna     | 6/6     |
| google/gemini-2.5-flash    | clean-text-change.diff | BRAK    | [unknown] | BRAK | BRAK | BRAK | BRAK        | BRAK         | BRAK      | BRAK      | BRAK    |
| anthropic/claude-haiku-4.5 | clean-text-change.diff | pass    | ok        | 3    | 18   | 5376 | 46776       | 32778        | 0.088646  | TRAFIENIE | 5/5     |

Koszt komórek: 0.170539 USD z 3/3 komórek ZMIERZONYCH; trafienia cache'u: 1/3.
ZAPŁACONE w tym przejściu: 0.081893 USD (trafienia cache'u nie kosztują).
Cennik: 2026-08-23 (0 dni temu), źródło https://openrouter.ai/api/v1/models.
Komórek uruchomionych: 4; z tego ZMIERZONYCH 3, BRAKÓW ZMIERZONYCH 1.
```

### BRAK ZMIERZONY — nowa kategoria w raporcie, i dlaczego musiała powstać

Plan przewidywał cztery wyniki. Open Risk 4 (`maxTurns: 2`) przewidywał, że gemini nie dojedzie
na slocie 2 — i nie dojechało, po raz drugi, tym samym błędem (`error_max_turns`). Pusta kratka
w tabeli byłaby najgorszą możliwą reprezentacją tego faktu: czytelnik nie odróżniłby jej od
komórki, której nikt nie uruchomił.

Raport rozróżnia teraz **trzy rodzaje pustki**, każdy innym znakiem i innym zdaniem:

| rodzaj                 | znak w tabeli | gdzie opisany            | co znaczy                                                                     |
| ---------------------- | ------------- | ------------------------ | ----------------------------------------------------------------------------- |
| **BRAK ZMIERZONY**     | `BRAK`        | sekcja „BRAKI ZMIERZONE" | komórka pojechała i NIE dojechała; klasa awarii nazwana, komunikat zacytowany |
| brak licznika          | `—`           | wiersz „Bez kwoty"       | komórka DOJECHAŁA, recenzja jest, SDK nie oddało licznika tokenów             |
| komórka nieuruchomiona | brak wiersza  | nigdzie                  | nie odpalono jej wcale; raport nie mówi o niej NIC                            |

⚑ **Brak zmierzony NIE jest darmowy, i raport to teraz mówi.** Przejście policzyło 0,081893 USD,
a klucz obciążono o 0,118529 — brakujące **~0,0366 USD** to właśnie ta komórka: model przepalił
tury, zanim uderzył w limit, i nie oddał liczników, więc kwoty nie da się policzyć. Bez tego
zdania „nie wchodzą do żadnej kwoty" czytałoby się jak „nic nie kosztowały".

### ⚑ Błąd we WŁASNEJ klasyfikacji, złapany na pierwszym przejściu

Pierwsze uruchomienie pokazało **dwa** braki zmierzone. Drugi z nich —
`gemini/sample.diff` — był **fałszywy**: komórka dojechała, `safeParse` przeszedł, recenzja
wróciła, a pękła jej ASERCJA (`gateIntegrity = 1`). Przyczyna: `contractOf` czytał
`result.error`, które w promptfoo niesie powód, dla którego TEST nie przeszedł — więc przy
pękniętej asercji zawiera jej treść. Wzięte jako sygnał awarii providera klasyfikowało poprawnie
ocenioną komórkę jako brak wyniku.

**To jest dokładnie to zlanie dwóch dziur, przed którym ta sekcja miała bronić — popełnione
w kodzie, który miał przed nim bronić.** Naprawa: kontrakt liczy się WYŁĄCZNIE z
`response.error`, ustawianego tylko przez nasz provider, gdy `runReview` rzuciło.

Poprawka **nie kosztowała ani centa**: `report.ts` dostał tryb `--from <plik>`, a wynik przebiegu
odzyskano przez `promptfoo export eval eval-JIC-2026-08-23T10:32:09`. Poprawka w samym RAPORCIE
nie ma prawa kosztować kolejnego przejścia macierzy — a bez tego trybu kosztowałaby.

### Powtórzenie przejścia jest DARMOWE (dowód, nie deklaracja)

```
| google/gemini-2.5-flash    | sample.diff | fail | ok | 2 | 0  | 4299 | 23816 | 23816 | 0.013447 | TRAFIENIE | 5/6 |
| anthropic/claude-haiku-4.5 | sample.diff | fail | ok | 2 | 10 | 4094 | 38373 | 0     | 0.068446 | TRAFIENIE | 6/6 |

ZAPŁACONE w tym przejściu: 0.000000 USD (trafienia cache'u nie kosztują).
```

Odczyt `/api/v1/key` przed i po: **1,096735348 → 1,096735348**, delta **dokładnie 0**. Trzecia
zmierzona komórka (haiku / kontrola negatywna) weszła jako `TRAFIENIE` już w samym przejściu, więc
**wszystkie trzy komórki zmierzone są dowiedzione jako cacheowalne**. Czwarta nie ma czego
cacheować — i to jest odpowiedź, nie luka.

Powtórzenie zawężono do slotu 1 świadomie: pełne powtórzenie kosztowałoby ~0,031 USD za ponowną
awarię gemini, czyli zapłatę za informację, którą już mamy dwukrotnie.

### Odpowiedź na pytanie 2 z `requirements.md` — pierwsza oparta na macierzy

| model                        | slot 1                                       | slot 2             | werdykt kwalifikacyjny                                              |
| ---------------------------- | -------------------------------------------- | ------------------ | ------------------------------------------------------------------- |
| `anthropic/claude-haiku-4.5` | **6/6**                                      | **5/5**            | przechodzi bramki twarde; łamie kontrakt `null` (obserwacja miękka) |
| `google/gemini-2.5-flash`    | **5/6** — `gateIntegrity = 1` zamiast `null` | **BRAK ZMIERZONY** | **nie kwalifikuje się dziś**                                        |

**Gemini oblało dokładnie tę parę, którą naprawiał `0d3eba5`** — i oblało ją na fiksturze, na
której w Pomiarze II zwróciło poprawne `null`. Ten sam model, ten sam materiał, ten sam prompt,
inny wynik: kontrakt `null` jest u gemini **niestabilny**, nie tylko odrzucany. To jest pierwszy
przypadek, w którym ten zestaw złapał regresję, po którą powstał — i materiał do Open Risk 3
(pytanie: własność promptu czy własność modelu).

### Koszt komórki NIE JEST stały

| model                        | Pomiar II | faza 7       | różnica | co się zmieniło                 |
| ---------------------------- | --------- | ------------ | ------- | ------------------------------- |
| `google/gemini-2.5-flash`    | 0,0323    | **0,013447** | −58%    | 3 tury → 2, `out` 4 721 → 4 299 |
| `anthropic/claude-haiku-4.5` | 0,0846    | **0,068446** | −19%    | `out` 6 995 → 4 094             |

Ta sama fikstura, ten sam prompt, ten sam pin modelu. Zmienił się wyłącznie przebieg. Wniosek dla
budżetowania: koszt komórki ma rozrzut rzędu dziesiątek procent i budżetować należy dalej po
liczbie WYŻSZEJ.

### Pozycje `## Progress` zostawione NIEODHACZONE — i dlaczego

| pozycja | treść                                              | dlaczego nie                                                                         |
| ------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **7.1** | „Cztery komórki, wszystkie asercje twarde zielone" | trzy komórki zmierzone, jedna to brak zmierzony; do tego `gemini/sample.diff` ma 5/6 |
| **7.2** | „Powtórzenie darmowe (cztery trafienia…)"          | trafienia są trzy z trzech ZMIERZONYCH; czwartej nie da się trafić, bo nie ma czego  |
| **7.5** | „Suma wydatków… poniżej 1 USD"                     | suma POLICZONA (1,096735), ale klauzula „poniżej 1 USD" jest FAŁSZYWA                |

**7.5 zostaje nieodhaczone celowo i jest to najważniejszy z tych trzech wpisów.** Próg podniesiono
jawnie do 1,20 USD, więc wydatek mieści się w decyzji — ale wiersz mówi „poniżej 1 USD" i taki
ma zostać. Odhaczenie go po podniesieniu progu byłoby wyprodukowaniem zieleni przez zmianę
definicji zielonego. Nieodhaczony wiersz jest jedynym miejscem w `## Progress`, z którego widać,
że PIERWOTNY próg został przekroczony, a nie przepisany — i to jest dokładnie to, przed czym broni
zdanie z notatki budżetowej: _budżet podniesiony w momencie, w którym zaczyna wiązać, przestaje
być budżetem_.

### Bramki i nietykalność ścieżki produkcyjnej

```
npm --prefix agents/review run typecheck   → zielone
npm --prefix agents/review run test        → 57/57 (53 po fazie 6: +4 na BRAKI ZMIERZONE)
git diff <baza>..HEAD -- .github/actions/ .github/workflows/pr-review.yml   → PUSTO
git diff <baza>..HEAD -- .github/                                          → tylko agents-gate.yml (+95)
```

Kryterium 7.7 spełnione i zmierzone, nie zadeklarowane: przez cały plan composite action
i `pr-review.yml` nie zmieniły ani jednej linii. W `.github/` przybył wyłącznie nowy workflow
bramki pakietu agenta.

---

## Triage impl-review — F1: odcisk cache'u rozszerzony z dwóch osi na cztery

**Data**: 2026-08-23
**Koszt**: **0,00 USD** — wszystkie przypadki offline, stub `query`, zero wywołań modelu.

Przegląd implementacji (`reviews/impl-review.md`, F1) zmierzył, że `fingerprintPrompt` niósł
WYŁĄCZNIE `SYSTEM_PROMPT` i `REVIEW_JSON_SCHEMA`, a poza kluczem zostawało wszystko pozostałe,
co `runReview` realnie wysyła: dwa zdania instrukcji i etykieta ogranicznika z `wrapDiff`,
`tools: []` i `maxTurns: 2`. Ryzyko nie jest teoretyczne — Open Risk 4 ZAPOWIADA podniesienie
`maxTurns`, a wtedy `npm run eval` oddałby komplet TRAFIEŃ i zieloną tabelę ze STARYCH wyników.
To jest dokładnie „nieświeży wynik podany jako zielona bramka", czyli klasa nazwana w planie jako
ryzyko pierwszej kategorii — tylko na osi, której nikt nie pilnował.

### Co się zmieniło

| plik            | zmiana                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------ |
| `run-review.ts` | `tools`/`maxTurns` wyniesione do eksportowanego `FIXED_CALL_OPTIONS` — jeden egzemplarz    |
| `cache.ts`      | `fingerprintPrompt(parts: CallFingerprintParts)` — cztery osie; `FINGERPRINT_NONCE`        |
| `provider.ts`   | `productionPromptFingerprint()` składa cztery osie ze ŹRÓDEŁ, którymi jedzie `runReview`   |
| `cache.test.ts` | +7 przypadków: `(ix/<oś>)` ×4, `(x)` kontrola pozytywna, `(xi/<oś>)` ×2 na żywym magazynie |

Wyniesienie `FIXED_CALL_OPTIONS` jest tą samą decyzją, co jeden egzemplarz trzech zmiennych
`ANTHROPIC_*`: literał w środku `query(...)` i odcisk liczony z kopii rozjeżdżają się CICHO.

### Para dowodowa — mutacja funkcji odcisku, nie mutacja wejścia

Warunek postawiony w triage'u: nowe przypadki mają dowodzić **PUDŁA**, nie trafienia, a każda nowa
oś potrzebuje **własnej** mutacji czerwieniącej dokładnie swój przypadek i tylko jego. Inaczej
rozszerzamy odcisk o pola, o których nie wiadomo, czy naprawdę weszły do klucza — ta sama dziura,
tylko szersza.

| mutacja `fingerprintPrompt`     | czerwone                                                 | kolateralne       |
| ------------------------------- | -------------------------------------------------------- | ----------------- |
| ślepy na `callOptions`          | `ix/callOptions`, `x`, `xi/callOptions` — **3 z 64**     | **0**             |
| ślepy na `userMessageShape`     | `ix/userMessageShape`, `x`, `xi/userMessageShape` — 3/64 | **0**             |
| brak mutacji (stan przywrócony) | —                                                        | **64/64 zielone** |

Przypadek `(x)` czerwieni się w obu probe'ach z założenia: to on porównuje, KTÓRE osie ślepy
odcisk nadal unieważnia, więc jest agregatem obu kierunków naraz. `typecheck` zielony.

### Koszt zapisany, nie ukryty

Zmiana odcisku **unieważnia trzy istniejące wpisy cache'u** (dwie komórki `sample.diff` plus
haiku/kontrola negatywna), więc następne przejście macierzy będzie ZIMNE i zapłaci ~0,08 USD.
To jest cena za to, że klucz przestaje być węższy niż wywołanie — i jest to cena jednorazowa,
w odróżnieniu od kosztu przebiegu, który po cichu mierzył stary prompt.

---

## Triage impl-review — F7: kryterium 7.3 domknięte POMIAREM, nie czynnością

**Data**: 2026-08-23
**Koszt**: **0,00 USD** (`PR code review` na tym PR-ze jest anulowany przy każdym pushu).

Do tej chwili 7.3 było jedyną z sześciu otwartych pozycji, którą zamykała CZYNNOŚĆ, a nie pomiar:
gałąź stała 9 commitów przed `origin`, ze zdalnym czubkiem na `b87f897` (koniec fazy 4), więc
`agents-gate.yml` nie widział ani fazy 5, ani 6, ani 7 — ani żadnej z poprawek z tego triage'u.
`lessons.md` („Gwarancja w workflow należy do konfiguracji PLIKU") mówi wprost: próbę robi się
NA TEJ ŚCIEŻCE, na której bramka żyje, nie lokalnie.

Gałąź wypchnięta ZWYKŁYM gitem (`b87f897..74346b0`), z przechodzącym hookiem `pre-push`
(rootowy `typecheck`: 176 plików, 0 błędów). Bez `--no-verify`.

| przebieg                    | id          | wynik                               |
| --------------------------- | ----------- | ----------------------------------- |
| **Agents gate** (`74346b0`) | 32637270773 | **success**                         |
| Prompt ratchet              | 32637270771 | success                             |
| PR code review              | 32637270763 | anulowany (jak zawsze na tym PR-ze) |

**Zieleń NIE jest pusta — i to jest osobno sprawdzone.** Floor na wykrywanie, dołożony w fazie 3
właśnie na tę okoliczność, wypisał w logu kroku „Test the agent package" plan TAP **`1..70`**
oraz `# tests 70 / # pass 70 / # fail 0`. Czyli bramka uruchomiła komplet — łącznie z siedmioma
przypadkami osi odcisku (F1), dwoma zapadkami rejestru asercji (F4) i czterema na diagnozę
spawnu (F6). Bramka, która niczego nie uruchomiła, wyglądałaby dokładnie tak samo bez tej linii.

Pozostałych pięć pozycji (6.1, 6.2, 7.1, 7.2, 7.5) zostaje otwartych — każda opisuje warunek,
który NIE został spełniony, i żadnej z nich nie zamyka czynność.

⛑ **Drugi przebieg, już na czubku domykającym cały triage** (`b22a5cd`, po naprawach F6 i F8):
**Agents gate 32637631099 — success**, plan TAP `1..70`. To ten przebieg, a nie poprzedni, jest
dowodem dla stanu końcowego. Commity dopisane PO nim dotykają wyłącznie `context/`, czego filtr
`paths` tego workflow świadomie nie łapie — więc brak dla nich przebiegu nie jest luką.
