---
date: 2026-08-21T20:55:00+02:00
researcher: lirdaw
git_commit: fe82f62c8bbf9d619e5c49d4eeeb32db270930c9
branch: main
repository: lirdaw/10xcards
topic: "Workflow CI/CD uruchamiający agenta code review na PR-ach"
tags: [research, codebase, github-actions, ci-cd, code-review-agent, claude-agent-sdk]
status: complete
last_updated: 2026-08-21
last_updated_by: lirdaw
---

# Research: Workflow CI/CD uruchamiający agenta code review na PR-ach

**Date**: 2026-08-21T20:55:00+02:00
**Researcher**: lirdaw
**Git Commit**: `fe82f62c8bbf9d619e5c49d4eeeb32db270930c9`
**Branch**: `main`
**Repository**: `lirdaw/10xcards`

## Research Question

Co w tym repozytorium jest już gotowe, a co trzeba dobudować, żeby zrealizować
`context/changes/ci-cd-code-review/requirements.md` — workflow uruchamiający agenta
z `agents/review/` przy każdym PR-ze do `main`, z dziewięcioma kryteriami oceny,
progiem werdyktu w konfiguracji, komentarzem sticky i trzema etykietami?

## Summary

Materiał wyjściowy jest w lepszym stanie, niż wygląda: agent ma czysty kontrakt
runtime (JSON na stdout, metryki na stderr, kod 1 na awarię, kod 0 na `verdict: "fail"`),
a jego lockfile zawiera komplet pakietów platformowych, więc `npm ci` na `ubuntu-latest`
da działającą binarkę. Repo ma też mocną, spisaną kulturę pisania workflow, z której
większość decyzji tego zadania da się wyprowadzić bez wymyślania.

Dziewięć rzeczy, które zmieniają kształt planu:

1. **Przesłanka z sekcji „Werdykt" jest nieprawdziwa.** `main` **nie ma żadnej ochrony
   ani rulesetów** (`gh api …/branches/main/protection` → 404, `…/rulesets` → `[]`).
   `ci.yml` też niczego nie blokuje — nie ma wymaganych sprawdzeń. Zdanie „o merge'u
   rozstrzygają istniejące bramki z `ci.yml`" trzeba przepisać; sama decyzja
   („review nie blokuje") zostaje, ale jej uzasadnienie jest dziś społeczne, nie techniczne.

2. **Domyślne uprawnienia `GITHUB_TOKEN` w tym repo to `read`**
   (`actions/permissions/workflow` → `default_workflow_permissions: "read"`), a w całym
   repozytorium **nie ma ani jednego bloku `permissions:`**. Bez jawnego bloku kroki
   komentarza i etykiet dostaną 403. Dobra wiadomość: to awaria głośna, nie cicha.

3. **Realny diff PR-a w tym repo to 79–423 KB przy 2,3–5,8 tys. linii, z czego
   69–89% to `context/**`i lockfile.** PR #37: 423 KB, w tym 291 KB planów.
PR #44: 79 KB, w tym 70 KB`agents/review/package-lock.json`. „Cały `git diff`"
   wzięte dosłownie karmi agenta głównie dokumentacją planistyczną — patrz sekcja 4.

4. **`gh pr diff` mieści się w limicie API, ale z zapasem ~3,5×.** Limit to 20 000 linii
   / 300 plików (HTTP 406); największy zmierzony PR ma 5 771 linii. Lokalny
   `git diff --merge-base` po `fetch-depth: 0` limitu nie ma w ogóle.

5. **Żaden z trzech workflow nie ustawia `fetch-depth`** — wszystkie biorą domyślny
   shallow `1`. Przy zdarzeniu `pull_request` checkout bierze `refs/pull/<N>/merge`
   w detached HEAD bez historii, więc `git diff origin/main...HEAD` na gołym checkoucie
   **nie zadziała**. To będzie pierwsze `fetch-depth: 0` w repo.

6. **Nie istnieje żaden composite action ani reusable workflow.** `.github/actions/`
   jest pustym katalogiem. Wymaganie „wydziel review do nazwanej czynności" oznacza
   napisanie pierwszego takiego bytu tutaj, bez wzorca do skopiowania.
   **Sekrety nie są dostępne w composite action** — muszą wejść jako `inputs`.

7. **Sekret `ANTHROPIC_API_KEY` nie istnieje**, a trzy etykiety `ai-cr:*` też nie
   (`gh secret list`, `gh label list`). Repo ma sześć sekretów, żaden nie jest Anthropicowy.
   Precedens z `eval-ci-dispatch` mówi, że **kontrola po nazwie sekretu niczego nie
   dowodzi**: `OPENROUTER_EVAL_KEY` miał w sobie BOM i pierwszy realny dispatch padł,
   mimo że kryterium „sekret istnieje" było zielone przez cały czas.

8. **Kryteria 4, 2 i 9 wymagają kontekstu, którego agent z definicji nie ma.**
   Agent działa bez narzędzi i bez dostępu do repo. Mapa ryzyk z `test-plan.md` §2,
   twarde reguły z `AGENTS.md` i deklaracja PR-a muszą więc **wjechać do promptu jako
   tekst**. Prompt rośnie z pięciu linii do dokumentu rzędu 2–4 tys. tokenów.

9. **`model: "sonnet"` to alias, nie pin.** Repo pinuje wszystko inne
   (`wranglerVersion: "4.90.0"`, `actions/checkout@v7`, lockfile agenta). Zmiana modelu
   pod aliasem po cichu zmieni zachowanie review i unieważni porównanie przebiegów —
   czyli dokładnie ten pomiar, na którym stoi „warunek wyjścia" z wymagań.

## Detailed Findings

### 1. Punkt startowy — agent `agents/review/`

Pięć plików w gicie (`git ls-files agents` → dokładnie 5), `node_modules` ignorowane
(`.gitignore:88`). To **osobny projekt npm**, nie workspace: root `package.json` nie ma
pola `workspaces` ani żadnego skryptu odnoszącego się do `agents/`. Rootowe `npm ci`
**nie zainstaluje** zależności agenta.

**Kontrakt runtime — zmierzony, nie odczytany z dokumentacji:**

| Sytuacja                                   | Kod wyjścia                | Dowód                                                                     |
| ------------------------------------------ | -------------------------- | ------------------------------------------------------------------------- |
| Pusty / same białe znaki na stdin          | **1**, komunikat na stderr | `review.ts:64-67`; zmierzone: `printf '' \| npx tsx review.ts` → `EXIT=1` |
| Sukces, `verdict: "pass"` **lub** `"fail"` | **0**                      | `review.ts:68`                                                            |
| `structured_output` niezgodny ze schematem | 1 (rzucony `Error`)        | `review.ts:34-37`                                                         |
| SDK zwrócił `subtype !== "success"`        | 1                          | `review.ts:55-57`                                                         |
| Brak wiadomości `result`                   | 1                          | `review.ts:60`                                                            |

Rozdzielenie strumieni jest czyste i celowe: **stdout to wyłącznie JSON**
(`review.ts:68`), **stderr to metryki** (tury, czas, koszt USD, tokeny, cache —
`review.ts:40-49`) i komunikat o pustym diffie. Komentarz w `review.ts:39` mówi wprost:
„żeby nie brudzić JSON-a na stdout". Workflow może więc zrobić `> review.json` i dostać
plik nadający się do `jq`, bez żadnego parsowania tekstu.

**To jest dokładnie ten podział, którego wymaga sekcja „Werdykt":** krok kończy się
sukcesem także przy `fail` (bo agent zwraca 0), a awaria review jest odróżnialna,
bo tylko ona daje kod ≠ 0. Trzy stany z wymagań mapują się bez naciągania.

**Uwierzytelnienie: `ANTHROPIC_API_KEY`.** Potwierdzone w typings SDK
(`sdk.d.ts:125-127`, typ `ApiKeySource`; `sdk.d.ts:1482-1488` opisuje, że podproces
dziedziczy `process.env`, gdy `options.env` jest pominięte — a `review.ts` go nie ustawia).
README SDK **nie wspomina o kluczu w ogóle**; jedynym źródłem są typings.

**Lockfile jest kompletny dla wszystkich platform.** Mimo że wygenerowano go na Windows,
`agents/review/package-lock.json` zawiera wszystkie osiem pakietów platformowych
z `resolved` + `integrity`, w tym `claude-agent-sdk-linux-x64` (linia 102, `os: linux`,
`cpu: x64`, `libc: glibc`). `npm ci` na `ubuntu-latest` wybierze ten jeden i dostanie
działającą binarkę. **Koszt: 335 MB rozpakowane** (`npm view … dist.unpackedSize` →
`334715773`); główny pakiet to 4,6 MB. To będzie najdroższy krok workflow.

**Czego dziś nic nie pilnuje:** `agents/**` jest wykluczone z tsconfigu
(`tsconfig.json:4`, commit `e1ed7e5`), ignorowane przez ESLint (`eslint.config.js:126-138`),
poza `scripts/run-typecheck.ts` i poza `vitest.config.ts`. Żaden test-strażnik nie skanuje
`agents/` (`grep -rn "agents" tests/` → zero trafień), więc `console.*` w `review.ts`
nie łamie `no-logging.test.ts` (ten skanuje wyłącznie `src/`). Dodatkowo `agents/` **nie
jest** w `.prettierignore`, a oba pliki `.ts` są zacommitowane niesformatowane —
`npm run format` je przeformatuje. Nie jest to dziś bramka (CI nie ma kroku prettiera),
ale jest to mina pod pierwszym `npm run format`.

`agents/review/sample.diff` to **celowo wadliwa fikstura**: zahardkodowany service-role
key, `import.meta.env`, pętla `for (let i = 0; i <= ids.length; i++)` (off-by-one) oraz
`if (!error) { deleted++ }` — czyli połknięty błąd. Trafia w kryteria 1, 2, 6 i 7
naraz. To gotowy materiał na dowód, że nowa bramka potrafi zaświecić na czerwono
(patrz sekcja 6, kryterium 8).

### 2. Konwencje CI w tym repozytorium

Trzy workflow: `ci.yml`, `eval.yml`, `schema-diff.yml`. Wersje akcji jednolite bez wyjątku:
`actions/checkout@v7`, `actions/setup-node@v6` z `node-version: 22`,
`actions/upload-artifact@v7`. Wszystko pinowane tagiem `@vN`, **nigdy SHA**.

**Reguła zasięgu sekretów jest spisana dwukrotnie i ma jasny dyskryminator**
(`eval.yml:74-85`, `schema-diff.yml:30-40`): _czy ten job uruchamia `npm ci`?_
Jeśli tak → sekrety idą **na poszczególne kroki**, nigdy na job, bo `npm ci` odpala
skrypty instalacyjne całego drzewa zależności **na publicznym repo**. Jeśli nie →
job-level `env:` jest dopuszczalne, i `drift` w `ci.yml:142-144` jest tym jedynym jobem,
który tak robi, właśnie dlatego, że nie instaluje niczego.

**Workflow review będzie po stronie „tak, uruchamia `npm ci`"** — i to w katalogu
z 335-megabajtową binarką z postinstallem. Sekret należy na krok.

**Bramka fail-fast na sekret** — ten sam kształt w obu plikach
(`eval.yml:109-118`, `schema-diff.yml:60-72`): `test -n "$VAR" || { echo "…"; exit 1; }`,
uzasadniona **umiejscowieniem**: „pada w sekundach zamiast po ~60 s `npm ci`".

**Redirect, nigdy pipe** (`eval.yml:156-162`):

```
STATUS=0
npm run eval > eval-console.log 2>&1 || STATUS=$?
...
exit $STATUS
```

Powód jest zmierzony: `npm run eval | tee eval-console.log` **kończył się kodem 0
na czerwonym przebiegu**, bo domyślny shell dla `run:` (gdy `shell:` jest pominięty)
to `bash -e {0}` **bez `pipefail`**. To warto rozumieć precyzyjnie, bo to pułapka
o dwóch twarzach: **jawne `shell: bash` daje `bash --noprofile --norc -eo pipefail {0}`**,
czyli z `pipefail`. Ta sama komenda zachowa się różnie w zależności od tego, czy `shell:`
jest napisany. To jest dokładnie klasa „komenda, która zawsze kończy się kodem 0".

**Czyszczenie sekretu przed uploadem artefaktu** (`eval.yml:186`):
`sed -i "s|${OPENROUTER_API_KEY}|***|g"`, bo — cytat z `eval.yml:176-185` —
„maskowanie sekretów GitHuba działa na LOGI, nie na artefakty; artefakt jest sinkiem
MNIEJ chronionym". Na publicznym repo artefakty pobiera każdy zalogowany użytkownik.

**Czego w repo nie ma w ogóle:** `$GITHUB_STEP_SUMMARY` (zero użyć),
`$GITHUB_OUTPUT` (zero użyć), `permissions:` (zero bloków), `actions/github-script`
(zero), komentarzy PR, etykiet, `gh` w CI, `fetch-depth`, `pull_request_target`.
`$GITHUB_ENV` użyty dwukrotnie (`ci.yml:121-122`). `concurrency` istnieje w jednym
miejscu (`eval.yml:67-69`).

**Oba nie-CI workflow jawnie odmawiają bycia bramką.** `eval.yml:10-15`: „ten workflow
nigdy nie może być podpięty jako bramka blokująca deploy — żadnego `needs:`,
`workflow_run:`, wymaganego sprawdzenia ani wpisu w branch protection".
`schema-diff.yml:12-13`: „czerwony przebieg tutaj nigdy nie może zatrzymać wydania".
Review agenta wpisuje się w tę rodzinę idealnie — i jest to rodzina, nie wyjątek.

**`ci.yml` ma `paths-ignore: ["**/\*.md", "context/**"]`** (`ci.yml:4-9`). Konsekwencja,
o której trzeba zdecydować świadomie: **PR dotykający wyłącznie dokumentacji nie dostaje
dziś żadnego CI**, a jeśli nowy workflow skopiuje ten filtr odruchowo, to etykieta
`ai-cr:review` nałożona na PR z samymi dokumentami **nie uruchomi review** — filtry
`paths` działają na zmienionych plikach niezależnie od typu aktywności.

### 3. Żywy stan GitHuba (odczytane 2026-08-21)

| Fakt                        | Wartość                                                                                                                                        | Skąd                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Widoczność repo             | **PUBLIC**                                                                                                                                     | `gh repo view --json visibility`                                    |
| Gałąź domyślna              | `main`                                                                                                                                         | `defaultBranchRef.name`; `origin/HEAD` → `refs/remotes/origin/main` |
| Ochrona `main`              | **brak**                                                                                                                                       | `gh api …/branches/main/protection` → 404 „Branch not protected"    |
| Rulesety                    | **brak**                                                                                                                                       | `gh api …/rulesets` → `[]`                                          |
| Domyślne uprawnienia tokenu | **`read`**                                                                                                                                     | `actions/permissions/workflow`                                      |
| Dozwolone akcje             | `all`, bez wymogu pinowania SHA                                                                                                                | `actions/permissions`                                               |
| Sekrety                     | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `OPENROUTER_EVAL_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` | `gh secret list`                                                    |
| Etykiety                    | dziewięć domyślnych GitHuba; **żadnej `ai-cr:*`**                                                                                              | `gh label list`                                                     |

**Konsekwencja dla „Werdykt / co werdykt wywołuje".** Wymagania piszą: „o merge'u
rozstrzygają istniejące bramki z `ci.yml` — lint, typecheck, testy, drift — i one się
nie zmieniają". Technicznie **nie rozstrzygają o niczym**: bez branch protection
`ci.yml` może być czerwony i merge i tak przejdzie. Decyzja „review niczego nie blokuje"
pozostaje słuszna (i lepiej uzasadniona niż w tekście — nie ma czego blokować),
ale argument trzeba przeformułować, żeby plan nie budował na fałszywej przesłance.

**Konsekwencja dla forków.** Repo jest publiczne, więc fork-PR jest możliwy.
Przy zwykłym `pull_request` sekrety **nie trafiają** na runner z forka, a `GITHUB_TOKEN`
jest read-only — czyli job padłby na pustym kluczu i dałby czerwony przebieg,
który wg wymagań znaczy „review się nie odbyło". To zachowanie akceptowalne, ale lepiej
je uczynić jawnym pominięciem niż awarią:
`github.event.pull_request.head.repo.full_name == github.repository`.
**`pull_request_target` jest tu złą odpowiedzią** — to wzorzec „pwn request": przy
checkoucie kodu PR-a i `npm ci` z postinstallem fork wykrada sekret i token zapisu.

### 4. Wejście dla agenta — zmierzony rozmiar i skład diffa

| PR                                           | Bajty   | Linie | Największa pozycja                             | Udział `context/**`     |
| -------------------------------------------- | ------- | ----- | ---------------------------------------------- | ----------------------- |
| #44 „add Claude Agent SDK code-review agent" | 79 192  | 2 292 | `agents/review/package-lock.json` — 70 542 B   | 0 (ale 89% to lockfile) |
| #40 „C10X-47 dev-DB test-data debt"          | 363 039 | 5 081 | `context/changes/…/verification.md` — 73 930 B | 282 652 B (**78%**)     |
| #37 „C10X-51 report a failed sign-out"       | 423 071 | 5 771 | `context/changes/…/verification.md` — 58 669 B | 290 961 B (**69%**)     |

Szacunek tokenów (przy ~3,7 znaku/token): 21k / 98k / 114k. Sonnet 5 ma okno 1M,
więc **rozmiar nie jest problemem technicznym** — jest problemem sygnału i kosztu.

Trzy napięcia, które plan musi rozstrzygnąć jawnie:

- **Kryterium 9 (dyscyplina zakresu)** na surowym diffie zobaczy w każdym PR-ze
  kilkanaście plików `context/**`, których nie da się wyprowadzić z tytułu w rodzaju
  „fix(C10X-51): report a failed sign-out". Bez informacji, że w tym repo artefakty
  planistyczne są **oczekiwanym towarzyszem** slice'a, kryterium będzie systematycznie
  zaniżać ocenę.
- **Kryterium 5 (dokumentacja i uzasadnienie)** ciągnie w przeciwną stronę: to właśnie
  `context/changes/…/plan.md` i `verification.md` niosą „dlaczego". Wycięcie ich odbiera
  agentowi materiał dowodowy dla kryterium 5, żeby uratować kryterium 9.
- **Lockfile.** 70 KB `package-lock.json` w PR #44 to 89% wejścia i zero wartości
  recenzenckiej.

Nie ma tu odpowiedzi, którą można wyprowadzić z repozytorium — to decyzja produktowa,
i dlatego siedzi w Open Questions, nie w rekomendacji. Warto tylko zauważyć, że filtr
ścieżek koliduje z regułą „pusty diff to awaria": PR dotykający **wyłącznie** ścieżek
wyfiltrowanych wyprodukuje pusty diff, który nie jest awarią zbierania wejścia.

### 5. Mechanika GitHub Actions dla wymaganych efektów

#### 5.1 Trigger: każdy PR do `main` + etykieta `ai-cr:review`

`types:` **nadpisuje** listę domyślną (`opened`, `synchronize`, `reopened`), więc trzeba
ją wypisać ponownie razem z `labeled`. Zawężenie do jednej etykiety robi się warunkiem
na jobie, nie w `on:` — `labeled` odpala się przy każdej etykiecie:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled]
    branches: [main]
```

`github.event.label.name` istnieje wyłącznie dla `labeled`/`unlabeled`; dla pozostałych
typów `github.event.label` jest `null`, a wyrażenie zwraca pusty string — **nie rzuca
błędem**, więc kolejność `action != 'labeled' || name == '…'` jest bezpieczna.

`concurrency` jest tu potrzebne mocniej niż w `ci.yml`: `labeled` + `synchronize`
łatwo dublują przebieg, a każdy przebieg kosztuje. Grupa per PR z `cancel-in-progress: true`
jest właściwa (inaczej niż w `eval.yml`, gdzie `cancel-in-progress: false` chroni
współdzielone konto OpenRoutera przed równoległością — tu problemem jest nadmiar, nie
kolizja).

#### 5.2 Diff od merge-base

Przy `pull_request` checkout bierze `refs/pull/<N>/merge` — **commit merge**, detached
HEAD, przy `fetch-depth: 1` bez historii i bez lokalnego `origin/main`. Dlatego:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
- run: git diff --merge-base "origin/${{ github.event.pull_request.base.ref }}" HEAD > "$RUNNER_TEMP/pr.diff"
```

`git diff --merge-base A HEAD` wymaga git ≥ 2.30 (lokalnie 2.55, runnery nowsze).
Płytki `git fetch --depth=1` bazy **psuje** wyliczenie merge-base — brak wspólnego przodka.

Alternatywa `gh pr diff <n>` działa i jest krótsza, ale ma limit **20 000 linii / 300
plików** (HTTP 406) oraz znany błąd, w którym CLI przy tym błędzie zwracało exit 0
(`cli/cli#10712`). Przy zmierzonym maksimum 5 771 linii zapas to ~3,5×. Lokalny
`git diff` limitu nie ma i nie zużywa rate-limitu tokenu.

#### 5.3 Etykiety

Tworzenie idempotentne: `gh label create "<nazwa>" --color <hex-bez-#> --force`.
Bez `--force` API zwraca 422 (`already_exists`) i CLI kończy błędem; z `--force` CLI
łapie to 422 i wykonuje PATCH — pełna idempotencja, exit 0. To domyka wymaganie
„jeśli etykieta nie istnieje, workflow ma ją utworzyć".

Wzajemne wykluczanie jednym wywołaniem:
`gh pr edit "$PR" --add-label "ai-cr:passed" --remove-label "ai-cr:failed,ai-cr:review"`.
**Nie używać `PUT /issues/{n}/labels`** — to zastępuje cały zestaw i skasuje etykiety
niezwiązane z review.

Zdjęcie etykiety-triggera: REST `DELETE …/labels/{name}` zwraca **404, gdy etykiety nie
ma** — czyli błąd, nie no-op; trzeba go połknąć. `gh pr edit --remove-label` kończy
błędem, gdy etykieta nie istnieje w repo, i jest no-opem, gdy istnieje, ale nie jest
przypięta.

**Uprawnienia:** etykiety na PR-ze → `pull-requests: write`; **tworzenie etykiet repo
→ dodatkowo `issues: write`** (to endpoint Issues, nie Pulls).

#### 5.4 Sticky comment

Wymaganie „kolejne uruchomienia aktualizują ten sam komentarz" ma dwa warianty bez
zależności zewnętrznej:

- **Ukryty marker HTML + `PATCH` po id.** Komentarz zaczyna się od `<!-- ai-code-review -->`;
  krok szuka po markerze i autorze (`github-actions[bot]`), potem `PATCH` albo `POST`.
  Treść wchodzi przez `-F "body=@plik"`, więc nie trzeba jej wciskać w argument.
- **`gh pr comment --edit-last --create-if-none`.** Oba flagi są dostępne w
  zainstalowanym `gh 2.92.0` (zweryfikowane `gh pr comment --help`). Bez
  `--create-if-none` komenda **kończy się błędem**, gdy aktor nie ma jeszcze żadnego
  komentarza (`cli/cli#10370`). Pułapka: `--edit-last` to „ostatni komentarz tego
  aktora", bez rozróżnienia po treści — jeśli kiedykolwiek inny workflow zacznie
  komentować jako ten sam bot, nadpisze nie ten komentarz.

Wariant z markerem jest odporniejszy i nie wprowadza third-party. Marker daje też
darmowo drugą rzecz: jednoznaczne miejsce na wersję kontraktu komentarza.

#### 5.5 Composite action

`.github/actions/` istnieje i jest pusty — to będzie pierwszy taki byt w repo.
Trzy twarde fakty, które przesądzają o kształcie:

- **`secrets` context jest niedostępny w composite action** (docs, Contexts → secrets):
  „secrets must be passed to composite actions explicitly as inputs". Klucz wchodzi
  jako `inputs.api-key`, a w środku trafia do `env:`, nigdy do interpolacji w `run:`.
- **`shell:` jest wymagany przy każdym kroku `run`** — composite **nie dziedziczy**
  `defaults.run.shell`. Tu wraca pułapka z 5.2/sekcji 2: jawne `shell: bash` włącza
  `pipefail`, a jego brak w zwykłym workflow go nie ma.
- **Output wymaga trzech rzeczy naraz:** `id:` na kroku, `>> "$GITHUB_OUTPUT"` w kroku,
  **oraz** deklaracji `outputs: { <n>: { description, value: ${{ steps.<id>.outputs.<n> }} } }`
  w `action.yml`. Sam zapis do `$GITHUB_OUTPUT` **nie** wystawia outputu na zewnątrz akcji —
  to cicha awaria, która wygląda jak pusta zmienna.

Kryterium sukcesu z wymagań jest czytelnicze („co się dzieje i w jakiej kolejności"),
więc granica podziału wypada naturalnie: w composite lądują `npm ci` w `agents/review`,
przekazanie klucza, uruchomienie agenta, obsługa kodu wyjścia i wystawienie
`verdict` + ścieżki do wyniku; w głównym pliku zostaje pobierz → zbierz diff →
uruchom akcję → opublikuj.

#### 5.6 Trzy stany i kody wyjścia

`continue-on-error` **nie nadaje się** do rozróżnienia trzech stanów: sklei „agent mówi
fail" z „agent się wysypał" w jedno `outcome: failure`. Właściwy kształt to jawny kod
wyjścia zapisany do outputu, krok kończący się `exit 0`, i decyzja o czerwieni podjęta
osobno. Dla przypomnienia semantyki (docs, Contexts → steps): `outcome` to wynik **przed**
`continue-on-error`, `conclusion` — **po**.

Mapowanie na stany z wymagań wychodzi wprost z kontraktu agenta z sekcji 1:

| Stan           | Kod agenta                              | Przebieg     | Etykieta       | Komentarz            |
| -------------- | --------------------------------------- | ------------ | -------------- | -------------------- |
| przeszło       | 0 + `verdict: "pass"`                   | zielony      | `ai-cr:passed` | aktualizowany        |
| nie przeszło   | 0 + `verdict: "fail"`                   | **zielony**  | `ai-cr:failed` | aktualizowany        |
| nie odbyło się | ≠ 0 (pusty diff, brak klucza, błąd SDK) | **czerwony** | **żadna**      | patrz Open Questions |

Uwaga: `verdict` z JSON-a agenta to **nie to samo** co werdykt wymagany w sekcji
„Werdykt" — ten drugi to `fail`, gdy agent powiedział `fail` **LUB** którekolwiek
kryterium spadło poniżej progu. Patrz sekcja 7.

#### 5.7 Uprawnienia — minimalny blok

Wszystko niewymienione jest ustawiane na `none`, więc jawny blok zawsze zawęża:

```yaml
permissions:
  contents: read # checkout
  pull-requests: write # etykiety na PR + komentarz
  issues: write # WYŁĄCZNIE jeśli workflow tworzy etykiety repo
```

To wprost realizuje zdanie z kryterium 6 wymagań: „uprawnienia i zakres tokenów w CI
ograniczone do tego, co dany krok naprawdę robi".

### 6. Dziewięć kryteriów wobec dowodów z repozytorium

Wymagania stawiają tezę, że opisy kryteriów są jedyną realną dźwignią sterowania modelem
(bo `minimum`/`maximum` są odrzucane na typie całkowitym — `review-schema.ts:15-19`).
Badanie potwierdza tę tezę i dokłada do niej materiał.

**Kryteria 1–3, 5–6** mają w repo bogaty materiał, ale nie wymagają nowych ustaleń
poza tym, co wymagania już spisały.

**Kryterium 4 (pokrycie testami względem ryzyka)** wymaga mapy ryzyk, której agent nie
zobaczy. Mapa to `test-plan.md` §2, **linie 939–968**, siedem ryzyk, plus §2.1
„Risk Response Guidance" (linie 957–967) z kolumną **„What would prove protection"** —
i to ta kolumna, nie sama lista ryzyk, jest tym, czego kryterium potrzebuje. Przykłady
tej kolumny: #1 „konto B odbite na odczycie **i** na zapisie, przy dowodzie, że konto A
nadal sięga po swoje"; #2 „dwa identyczne żądania dają dokładnie jeden komplet kart";
#4 „ani treść błędu, ani linia logu nie zawiera tekstu źródłowego ani klucza API".
Tabela ma też kolumnę **„Anti-pattern to avoid"**, która jest gotowym materiałem na opis
oceny 1 (np. #1: „testowanie jako `postgres` omija RLS; brak kontroli pozytywnej, więc
«zero wierszy» czyta się jako izolację, gdy polityka jest po prostu zepsuta").

**Kryterium 7 (połknięty błąd)** ma najmocniejszą podstawę empiryczną w całym repo
i jedno ustalenie, które zmienia jego opis. Pięć defektów C10X-48…52 pochodzi
z **jednego ręcznego przeglądu kodu 2026-08-11** — żaden nie został znaleziony przez test,
produkcję ani monitoring, i badanie `sentry-monitoring` dowodzi, że **żaden kanał
automatyczny nie mógł ich znaleźć**: „None of these emits anything… `captureConsoleIntegration`
therefore captures zero of C10X-48…52". Cały zestaw testów był przez ten czas zielony.

Najcenniejszy dla promptu jest jednak nie sam katalog defektów, tylko **sygnatura
wykrywalna z samego diffa**, zapisana w `2026-08-12-…/research.md:88-90`:

> „Pięć `await`ów w `src/pages/api/generate.ts` porzuca wynik w całości. **Każdy inny
> `await` w tym pliku najpierw rozgałęzia się na `error` — i to jest to, co sprawia,
> że te pięć się wyróżnia, zamiast czytać się jako styl domu.**"

Ta sama sygnatura wraca w `manual-card-crud` F1: „pobranie kart 12 linii niżej robi to
poprawnie… pobranie talii jest jedyną niekonsekwencją". **Niekonsekwencja wewnątrz
jednego pliku jest tanim i rzetelnym sygnałem dla recenzenta czytającego wyłącznie diff** —
i powinna wejść do opisu kryterium 7 wprost.

Granica jest równie ważna i też należy do opisu: **`if (error)` bywa poprawne i bywa
błędne, a diff tego nie rozstrzyga.** W C10X-51 `if (error)` jest właściwe; w C10X-52
byłoby **błędne**, bo `getUser()` zwraca `AuthSessionMissingError` także dla zwykłego
niezalogowanego gościa, **przed jakimkolwiek wywołaniem sieciowym** — ta sama poprawka
zbannerowałaby każdego anonimowego odwiedzającego. Druga granica: bez jawnego `.select()`
PostgREST odpowiada na UPDATE/DELETE pod `Prefer: return=minimal`, więc dopasowanie do
zera wierszy rozwiązuje się jako `{ data: null, error: null }` — nie do odróżnienia od
zapisu, który wylądował. Agent czytający sam diff **nie może** tego rozstrzygnąć, jeśli
helper leży dwa pliki dalej. Opis kryterium powinien więc kazać zgłaszać **podejrzenie
z nazwaniem brakującego dowodu**, a nie wystawiać werdykt, którego nie ma z czego wyprowadzić.

**Kryterium 8 (integralność bramki)** ma trzy udokumentowane przypadki i jeden z nich
jest bezpośrednio o tym zadaniu. Z `typecheck-gate`: `astro check` **kończy się kodem 0,
gdy brakuje jego własnego narzędzia** — udowodnione kontrolą pozytywną (ten sam zepsuty
plik: exit 1 z pakietem, exit 0 bez niego). Z `schema-drift-test` pochodzi zdanie,
które trzeba przeczytać, zanim zaplanuje się próbę czerwieni dla nowego workflow:

> „Ten przebieg byłby niefalsyfikowalny i warto powiedzieć dlaczego, zanim padnie dowód.
> `deploy` ma własny strażnik `github.ref == 'refs/heads/main'`. Na gałęzi funkcyjnej
> jest pomijany **cokolwiek** zrobi `drift` — więc «deploy został pominięty» byłoby
> wyprodukowane przez strażnika gałęzi, a odczytane jako wyprodukowane przez `needs`."

Stąd para przebiegów: kontrolny i zepsuty, różniące się **dokładnie jedną rzeczą**.
Ta sama dyscyplina obowiązuje ten workflow refleksyjnie: **zielony przebieg review nie
dowodzi, że review się odbyło** — dowodzi tego dopiero para (fikstura `sample.diff`
dająca `fail` vs. czysty diff dający `pass`), przy jednej zmiennej różnicy.

I najostrzejszy datum dla tego kryterium: bramka driftu **wypuściła realny fałszywy
zielony**, znaleziony dopiero w impl-review, przez sondowanie wejściem, którego fikstury
nie pokrywały. `Set`, który czyni porównanie poprawnie ślepym na kolejność — właściwość
konieczna, bo repo ma realną parę out-of-order — jest tą samą rzeczą, która czyni je
ślepym na kolizję. **Jedna linia jest naraz właściwością projektową i defektem.**

**Kryterium 9 (dyscyplina zakresu)** — materiał źródłowy potwierdzony w
`manual-card-crud/reviews/impl-review.md`, F2, werdykt WARNING / impact LOW. Dwie
kalibracje, które warto przenieść do opisu:

- Lekarstwem była **dokumentacja, nie cofnięcie** („dopisz «Also changed» do plan.md"),
  a jeden dodatek został jawnie uznany za w zakresie (`ui/Modal.tsx` — bugfix wprost
  wywołany przez nowe pola tekstowe slice'a). Kryterium ma więc odróżniać
  **nieujawniony nowy zakres** od **rozszerzenia wynikającego ze zmiany**.
- Siostrzane F4 („additive drift") dostało OBSERVATION i **SKIPPED (accepted)** jako
  „additive and benign". Skala 1–10 powinna to unieść, zamiast karać każdą linię spoza
  tytułu.

### 7. Werdykt, próg i schemat wyjścia

Reguła z wymagań (`fail`, gdy całościowy werdykt agenta to `fail` **LUB** którekolwiek
kryterium < 5, z wyłączeniem „nie dotyczy") jest **czystą funkcją**: bierze obiekt
wyniku i próg, zwraca `pass`/`fail`. To trafia dokładnie w wzorzec, który to repozytorium
stosuje konsekwentnie i który archiwum nazywa swoim standardowym lekarstwem —
decyzja wyniesiona do czystej, fabrykowalnej funkcji, testowana na fiksturach:
`scripts/typecheck.ts`, `scripts/schema-drift.ts`, `src/lib/auth-outcome.ts`,
`src/lib/signout-outcome.ts`, `src/lib/audit-failure-report.ts`.

Wymaganie „próg ma być jedną, jawnie nazwaną liczbą w konfiguracji, nie w prompcie"
dostaje wtedy naturalną realizację: próg jest **parametrem tej funkcji**, a nie stałą
w tekście promptu. Ma to konsekwencję dla testowalności, której wymagania nie nazywają:
funkcja progowa jest jedynym elementem całego workflow, który da się w tym repo
przetestować **deterministycznie i offline** — bez klucza, bez sieci, bez GitHuba.

**Reprezentacja „nie dotyczy" jest największym technicznym niewiadomym.** Zmierzone:
`z.union([z.number(), z.literal("n/d")])` przechodzi przez `z.toJSONSchema(…, {target: "draft-07"})`
jako `anyOf: [{type:"number"}, {type:"string", const:"n/d"}]`, z `description` zachowanym
na opakowaniu. Czy structured output Anthropica **akceptuje** `anyOf` + `const` —
nie zostało zweryfikowane i **nie da się zweryfikować bez klucza API**
(`ANTHROPIC_API_KEY` nie jest ustawiony lokalnie). Istniejący komentarz w
`review-schema.ts:15-19` dowodzi, że powierzchnia ograniczeń jest realna i wąska
(`minimum`/`maximum` odrzucane na typie całkowitym), więc założenie „union przejdzie"
jest dokładnie tą klasą twierdzenia, którą to repo każe mierzyć, a nie zakładać.
Warianty zapasowe (osobne pole boolowskie `…Applicable`, albo `nullable` + jawna flaga)
istnieją, ale zmieniają kształt kontraktu, więc wybór należy do planu po pomiarze.

### 8. Koszt i model

Agent woła `model: "sonnet"` — **alias, nie pin** (`review.ts:21`). Cennik pierwszej
strony: Sonnet 5 to $3/1M wejścia ($2 promocyjnie do 2026-08-31) i $15/1M wyjścia,
przy oknie 1M tokenów. Przy zmierzonych 114k tokenów wejścia największego PR-a daje to
rząd **$0,23–0,34 za jedno review** — czyli ~20× koszt jednego przebiegu evala
(zmierzone tam ~$0,013).

Prawdziwym czynnikiem kosztu nie jest jednak cena pojedynczego przebiegu, tylko
**`synchronize`**: bez `concurrency` z `cancel-in-progress` każdy push do gałęzi PR-a
uruchamia pełne review. PR z dziesięcioma pushami to kilka dolarów.

Cache promptu pomoże mniej, niż się wydaje: minimalny cachowalny prefiks to ~1024 tokeny
(prompt systemowy z dziewięcioma kryteriami go przekroczy), ale domyślne TTL to 5 minut,
a przebiegi CI dzielą minuty lub godziny. Metryki cache agent już wypisuje na stderr
(`review.ts:44`), więc **realny hit rate da się zmierzyć, zamiast go zakładać**.

Alias `sonnet` jest osobnym ryzykiem, niezależnym od ceny: repo pinuje `wranglerVersion`,
tagi akcji i lockfile agenta, a model — nie. Podmiana modelu pod aliasem po stronie
dostawcy zmieni zachowanie review po cichu i **unieważni porównanie przebiegów sprzed
i po zmianie progu** — czyli dokładnie ten pomiar, na którym wymagania opierają
„warunek wyjścia" z decyzji o niesblokowaniu merge'a.

## Code References

- [`agents/review/review.ts:10-14`](https://github.com/lirdaw/10xcards/blob/fe82f62c8bbf9d619e5c49d4eeeb32db270930c9/agents/review/review.ts#L10-L14) — czytanie diffa ze stdin
- [`agents/review/review.ts:18-27`](https://github.com/lirdaw/10xcards/blob/fe82f62c8bbf9d619e5c49d4eeeb32db270930c9/agents/review/review.ts#L18-L27) — `query()`: `model: "sonnet"` (alias), `tools: []`, `maxTurns: 2`, `outputFormat`
- [`agents/review/review.ts:39-49`](https://github.com/lirdaw/10xcards/blob/fe82f62c8bbf9d619e5c49d4eeeb32db270930c9/agents/review/review.ts#L39-L49) — metryki na stderr (tury, czas, koszt, cache)
- [`agents/review/review.ts:63-68`](https://github.com/lirdaw/10xcards/blob/fe82f62c8bbf9d619e5c49d4eeeb32db270930c9/agents/review/review.ts#L63-L68) — pusty diff → `exit 1`; wynik → JSON na stdout
- [`agents/review/review-schema.ts:15-19`](https://github.com/lirdaw/10xcards/blob/fe82f62c8bbf9d619e5c49d4eeeb32db270930c9/agents/review/review-schema.ts#L15-L19) — dlaczego `.describe()` jest dźwignią, a nie kosmetyką
- [`agents/review/review-schema.ts:40-42`](https://github.com/lirdaw/10xcards/blob/fe82f62c8bbf9d619e5c49d4eeeb32db270930c9/agents/review/review-schema.ts#L40-L42) — `verdict` + `summary` („gotowe jako komentarz do PR-a")
- [`agents/review/sample.diff`](https://github.com/lirdaw/10xcards/blob/fe82f62c8bbf9d619e5c49d4eeeb32db270930c9/agents/review/sample.diff) — celowo wadliwa fikstura (kryteria 1, 2, 6, 7)
- [`.github/workflows/ci.yml:3-10`](https://github.com/lirdaw/10xcards/blob/fe82f62c8bbf9d619e5c49d4eeeb32db270930c9/.github/workflows/ci.yml#L3-L10) — `paths-ignore: ["**/*.md", "context/**"]`
- `.github/workflows/eval.yml:74-85` — reguła zasięgu sekretów (dyskryminator „czy job robi `npm ci`")
- `.github/workflows/eval.yml:109-118` — bramka fail-fast na sekret, uzasadniona umiejscowieniem
- `.github/workflows/eval.yml:156-162` — redirect zamiast pipe; zmierzony exit 0 na czerwonym przebiegu
- `.github/workflows/eval.yml:176-186` — maskowanie działa na logi, nie na artefakty
- `.github/workflows/eval.yml:10-15` — „ten workflow nigdy nie może być bramką"
- `.github/workflows/schema-diff.yml:30-40` — ta sama reguła sekretów, druga połowa argumentu
- `tsconfig.json:2-4` — `exclude: ["dist", "context", "agents"]`
- `eslint.config.js:126-138` — `ignores: [..., "agents/**"]`
- `context/foundation/test-plan.md:939-968` — mapa ryzyk §2 (siedem ryzyk)
- `context/foundation/test-plan.md:957-967` — §2.1, kolumny „What would prove protection" i „Anti-pattern to avoid"
- `context/foundation/lessons.md:5-11` — nazwy gałęzi w CI muszą pasować do `main`
- `context/foundation/lessons.md:194-199` — „komenda, która ZAWSZE kończy się kodem 0, nie jest bramką"
- `context/foundation/lessons.md:243-248` — wynik zapisu kompensującego; „best-effort w komentarzu nie jest decyzją"

## Architecture Insights

- **To repozytorium traktuje workflow jak dokument projektowy.** `eval.yml` to 16,7 KB,
  z czego większość to komentarze uzasadniające decyzje wraz z **pomiarem**, który je
  potwierdził. Nowy workflow napisany bez tej warstwy będzie w tym repo ciałem obcym —
  i, co gorsza, straci powód, dla którego dana linia wygląda tak, a nie inaczej.
- **Powtarzalne lekarstwo tego repo na fałszywy zielony jest zawsze tą samą parą ruchów:**
  wynieś decyzję do czystej, fabrykowalnej funkcji, i udowodnij drogę do czerwieni parą
  przebiegów różniących się dokładnie jedną rzeczą. Oba ruchy są widoczne w diffie,
  nawet gdy defekt, na który odpowiadają, nie jest.
- **Asymetria fail-closed / advisory jest w tym repo nazwana i przestrzegana**
  (`ci.yml:87-97`): `continue-on-error` wolno nosić krokowi, którego uzasadnienie jest
  kosmetyczne; krok produkujący „dowód O PRODUKCJI" musi być fail-closed. Review agenta
  siedzi po stronie advisory — i jest to trzeci taki byt (`eval.yml`, `schema-diff.yml`),
  czyli rodzina, nie wyjątek.
- **Konsekwencją tej rodziny jest wzorzec, którego wymagania dotykają w sekcji o ryzyku:**
  oba istniejące workflow advisory kończą się artefaktem albo tabelą, którą trzeba
  otworzyć. Review jest pierwszym, który dostarcza sygnał **do miejsca, gdzie człowiek
  i tak patrzy** (komentarz + etykieta na liście PR-ów), i to jest jego jedyna przewaga
  nad tamtymi — warto jej nie zmarnować.
- **Granice `agents/` są świadome i spójne**: poza tsconfigiem, poza ESLintem, poza
  vitestem, osobne drzewo npm. Workflow nie powinien tej granicy zacierać (np. dorzucając
  `agents/` do rootowego programu, żeby „mieć typecheck") — to byłoby cofnięcie decyzji
  z `e1ed7e5` przy okazji, czyli dokładnie defekt, który opisuje kryterium 9.

## Historical Context (from prior changes)

- `context/archive/2026-08-02-eval-ci-dispatch/` — **najbliższy precedens**: pierwszy
  workflow w tym repo wołający płatne API modelu. Stamtąd pochodzą: reguła zasięgu
  sekretów, redirect-zamiast-pipe, maskowanie artefaktu, `timeout-minutes` na kroku
  (nie na jobie, żeby `if: always()` pozostało udokumentowane), i kontrakt
  „to nigdy nie jest bramka". Stamtąd też pochodzi ostrzeżenie o BOM w sekrecie:
  kryterium „sekret istnieje pod właściwą nazwą" było zielone przez cały czas i nie
  mogło zobaczyć wadliwej wartości.
- `context/archive/2026-08-02-typecheck-gate/` — `astro check` kończący się kodem 0
  przy braku własnego narzędzia; werdykt oparty na **treści** wyniku, nie na kodzie
  wyjścia; próba czerwieni wypchnięta przez GitHub Contents API, bo `pre-push` blokował
  celowy błąd lokalnie (i `--no-verify` jest zakazane bezwzględnie).
- `context/archive/2026-07-27-schema-drift-test/` — para przebiegów zamiast pojedynczego
  czerwonego; „deploy pominięty" jako wynik niefalsyfikowalny bez kontroli pozytywnej;
  bramka, która przeszła każde kryterium i mimo to wypuściła fałszywy zielony.
- `context/archive/2026-07-15-verification-harness/` — „status nie jest dowodem";
  asercja `expect(302)` nazwana wprost dekoracyjną, bo każda ścieżka błędu też zwraca 302.
- `context/archive/2026-08-12-…-compensation-swallowed/` przez
  `2026-08-14-bug-middleware-getuser-swallowed/` — pięć folderów, jeden ręczny przegląd,
  zero wykryć automatycznych; sygnatura „niekonsekwencja wewnątrz pliku"; granica
  `if (error)` poprawne vs. błędne.
- `context/archive/2026-07-09-manual-card-crud/reviews/impl-review.md` — F2, jedyny
  udokumentowany przypadek naruszenia dyscypliny zakresu, wraz z kalibracją, czego
  **nie** liczyć jako naruszenie.
- `context/archive/README.md` — archiwum jest niezmienne z mocy narzędzi
  (`.prettierignore` obejmuje wyłącznie `context/archive/**`), a nie z mocy uwagi
  recenzenta.

## Related Research

- `context/changes/ci-cd-code-review/requirements.md` — notatka wymagań, wejście tego badania
- `context/archive/2026-08-02-eval-ci-dispatch/research.md` — badanie poprzedniego workflow z LLM
- `context/archive/2026-08-11-sentry-monitoring/research.md:236-242` — tabela pięciu trafień
  audytu połkniętych błędów (jedyny zapis tego audytu w repo)
- `context/foundation/test-plan.md` §2 i §2.1 — mapa ryzyk i kolumna „co dowodzi ochrony"

## Open Questions

1. **[ROZSTRZYGNIĘTE 2026-08-21] Czy structured output Anthropica akceptuje `anyOf`
   dla „nie dotyczy"?** — **TAK, zmierzone. Kontrakt przechodzi w całości.**
   **Decyzja:** pole warunkowe zostaje jako `z.number().nullable()`, jedno pole na
   kryterium, `null` znaczy „nie dotyczy". **Wariant zapasowy z osobnym polem
   boolowskim jest niepotrzebny** — a wraz z nim odpada jego wpływ na kształt
   komentarza i funkcji progowej.
   **Podstawa — pomiar, nie wnioskowanie** (sonda odpalona na `agents/review/`,
   skasowana po odczycie): `z.toJSONSchema(..., { target: "draft-7" })` emituje dla
   takiego pola `anyOf: [{ "type": "number" }, { "type": "null" }]` — nie
   `"type": ["number", "null"]`; model wywołany z
   `outputFormat: { type: "json_schema" }` zwrócił w tym polu `null`
   (`"conditionalScore": null`), a `REVIEW_SCHEMA.safeParse` po stronie agenta dał
   `success: true`. Pisownia targetu jest obojętna: `"draft-7"` i używane dziś
   w `review-schema.ts` `"draft-07"` dają bajt w bajt ten sam schemat (zod 4.4.3).
2. **[ROZSTRZYGNIĘTE 2026-08-21] Co dokładnie jest „diffem"?** — **DECYZJA:
   agent ocenia wyłącznie kod.** Z wejścia wycinamy lockfile'e, pliki generowane
   **oraz `context/**`w całości**. (Dane, na których stoi decyzja: surowy`git diff`daje 69–89% dokumentacji i lockfile'i — §4 wyżej.)
**Świadoma cena, zapisana wprost:** kryterium 5 traci większość swojego materiału.
W tym repozytorium „dlaczego" mieszka w`context/`, a nie w komentarzach do kodu —
więc po odcięciu `context/**` agent ocenia uzasadnienie zmiany prawie w ciemno.
   Przyjmujemy to świadomie: cena kryterium 5 jest niższa niż koszt i szum z wpuszczania
   całej dokumentacji na wejście.
   **Kolizja, którą plan MUSI obsłużyć:** PR dotykający wyłącznie ścieżek
   wyfiltrowanych da pusty diff, który **nie jest awarią** — a wymagania mówią, że pusty
   diff jest awarią (czerwony przebieg, zero etykiet). To są **dwa różne stany\*\*
   („nie ma czego oceniać, i tak miało być" vs. „nie udało się zdobyć wejścia")
   i muszą pozostać rozróżnialne — rozróżnienie na poziomie logiki, nie tylko opisu.
   Powiązane, wciąż otwarte: pytanie 4 niżej (czy taki PR ma w ogóle dostawać review).
3. **Czy przy awarii review komentarz ma być aktualizowany?** Wymagania mówią, że awaria
   nie nakłada etykiety i wywala przebieg, ale milczą o komentarzu. Zostawienie starego
   komentarza sprzed kilku commitów jest mylące (wygląda jak aktualny stan); nadpisanie
   go notatką o awarii kosztuje ostatni znany wynik.
4. **Czy PR dotykający wyłącznie `context/**`ma dostawać review?**`ci.yml`takiego PR-a
dziś ignoruje w całości. Skopiowanie`paths-ignore`odruchowo sprawi, że etykieta`ai-cr:review` na takim PR-ze nic nie zrobi — co jest cichym brakiem reakcji,
   czyli klasą, przed którą broni kryterium 8.
5. **Czy przypiąć konkretny model zamiast aliasu `sonnet`?** Warunek wyjścia z wymagań
   opiera się na porównaniu przebiegów sprzed i po zmianie progu; alias czyni to
   porównanie nieodtwarzalnym. Pin ma koszt (ręczne podbicia), więc to decyzja, nie
   oczywistość.
6. **Jak wygląda próba czerwieni dla tego workflow?** `sample.diff` daje fiksturę,
   ale — zgodnie z lekcją z `schema-drift-test` — pojedynczy czerwony przebieg niczego
   nie przypisuje. Potrzebna jest para: fikstura → `ai-cr:failed`, czysty diff →
   `ai-cr:passed`, przy jednej zmiennej różnicy. Otwarte jest, czy da się to zrobić bez
   otwierania PR-ów-śmieci na publicznym repo.
7. **Czy próg 5 jest dobrą wartością?** Wymagania podają go jako liczbę do konfiguracji,
   nie jako wynik pomiaru — i same nazywają brak danych o poziomie fałszywych alarmów
   jako powód, dla którego review niczego nie blokuje. Pierwsze kilkanaście realnych
   przebiegów jest jedynym źródłem, które to rozstrzygnie.

## Rozstrzygnięcia po researchu

Trzy ustalenia zapadłe **po** zamknięciu badania (2026-08-21). Każde unieważnia część
zaleceń powyżej — przy rozbieżności **wygrywa ta sekcja**.

### A. Uwierzytelnienie — OpenRouter zamiast klucza Anthropica

**NIE kupujemy `ANTHROPIC_API_KEY`.** Claude Agent SDK jedzie przez OpenRoutera,
ustawiane przed wywołaniem `query(...)`:

| Zmienna                | Wartość                       |
| ---------------------- | ----------------------------- |
| `ANTHROPIC_BASE_URL`   | `https://openrouter.ai/api`   |
| `ANTHROPIC_AUTH_TOKEN` | klucz OpenRoutera             |
| `ANTHROPIC_API_KEY`    | `""` — **pusty, obowiązkowo** |

Trzecia linia nie jest kosmetyką: **niepusty `ANTHROPIC_API_KEY` wygrywa
z `ANTHROPIC_AUTH_TOKEN`**, więc pozostawiony w środowisku wysyła wywołanie w złe
miejsce z złym kluczem.

- **Sekret w repo: `OPENROUTER_EVAL_KEY`** — istnieje już na liście sekretów (§3),
  więc workflow nie wymaga zakładania nowego. Lokalnie klucza **nie ma w `.env`**
  i nie ma go tam wkładać pod nazwą `OPENROUTER_API_KEY` — preflight `npm test`
  przerywa run, gdy ta zmienna jest ustawiona.
- **Model podajemy JAWNIE jako `anthropic/claude-sonnet-4.6`, nigdy aliasem `"sonnet"`.**
  Alias nie jest identyfikatorem OpenRoutera; dziś `review.ts:21` używa właśnie aliasu.
  To rozstrzyga też pytanie 5 z Open Questions po stronie „pin", tyle że z innego
  powodu niż odtwarzalność pomiaru — przez OpenRoutera alias po prostu nie zadziała.

**Podstawa — dowód, nie wnioskowanie.** Przebieg właściwy przeszedł: `num_turns: 2`,
`stop_reason: "tool_use"`, `structured_output` jako obiekt. Sam sukces nie dowodziłby
jeszcze routingu, więc odpalona została **kontrolka negatywna** z celowo zepsutym
`ANTHROPIC_BASE_URL` (`https://openrouter.invalid/api`): 10 × `api_retry`, po 181 s
`API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)`,
exit code 1. Czyli SDK **realnie bije pod adres z `ANTHROPIC_BASE_URL`**, nie pod
pierwszostronne API i nie po własnych poświadczeniach Claude Code. Routing udowodniony.

**Sprostowanie do pola `modelUsage` — dwie pułapki przy czytaniu wyników:**

- **`modelUsage[].provider` NIE mówi, kto obsłużył wywołanie.** SDK ustawia je
  z flag Bedrock/Vertex, nie z base URL — w zmierzonym przebiegu przez OpenRoutera
  pole podało `"firstParty"`. Nie używać go jako dowodu routingu ani w diagnostyce.
- **`modelUsage[].costUSD` to przeliczenie z cennika Anthropica, nie rachunek
  OpenRoutera.** Zmierzony przebieg raportował `0.1036 USD` przy trywialnym promptcie
  (26 414 tokenów `cache_creation` to narzut systemowy SDK). Kalkulacja kosztów z §8
  oparta o tę liczbę jest szacunkiem SDK, nie fakturą.

### B. Defekt w istniejącym agencie — do naprawy w tej zmianie

**Przy awarii łączności SDK zwraca `subtype: "success"` RAZEM z `is_error: true`.**
Zmierzony kształt takiego wyniku (kontrolka z A):

```
subtype: "success"        <- to samo, czego szuka review.ts
is_error: true
terminal_reason: "api_error"
modelUsage: {}
structured_output: undefined
result: "API Error: Can't reach the API server ... (ENOTFOUND)"
```

`review.ts:31` sprawdza **wyłącznie `message.subtype`**, więc wpuszcza taki wynik do
walidacji zodem w `review.ts:34` — i agent raportuje
`Niepoprawny structured output: ... expected object, received undefined`. **Komunikat
o schemacie zamiast o braku łączności**: przyczyna zostaje połknięta, a operator
dostaje trop prowadzący w złą stronę (szuka błędu w kontrakcie wyjścia, gdy padła sieć).

**Wymaganie:** rozpoznanie sukcesu musi czytać **`is_error` i `terminal_reason`**,
nie sam `subtype`. Naprawę robimy **w tej zmianie**, a nie osobno — workflow ma
rozróżniać trzy stany z wymagań, a przy obecnym warunku awaria łączności przebiera
się za błąd kontraktu.

**To jest dokładnie ta klasa, którą opisuje kryterium 7 (połknięty błąd)** — znaleziona
we własnym agencie recenzującym, zanim zaczął oceniać cudzy kod. Dopisuje się do
tabeli pięciu trafień audytu z `context/archive/2026-08-11-sentry-monitoring/research.md:236-242`.

### C. Fałszywa przesłanka w wymaganiach — poprawione w `requirements.md`

**`main` nie ma ani branch protection, ani rulesetów; `ci.yml` niczego nie blokuje**
(§3: `404 Branch not protected`, `rulesets → []`). Zdanie z wymagań „o merge'u
rozstrzygają istniejące bramki z `ci.yml`" opisywało stan, który nie istnieje.

**Decyzja o doradczym review zostaje bez zmian** — zmienia się wyłącznie jej
uzasadnienie: nie „nie blokujemy, bo od blokowania są inne bramki", tylko **„dziś
nie blokuje nic, a review świadomie tego nie zmienia"**. Sekcja „Co werdykt wywołuje"
w `requirements.md` została przeredagowana zgodnie z tym ustaleniem; reszta tamtego
rozdziału (trzy stany, warunek wyjścia, lekcja o bramce niezdolnej do czerwieni)
stoi nienaruszona.
