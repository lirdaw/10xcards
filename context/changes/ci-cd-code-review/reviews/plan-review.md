<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Workflow CI/CD uruchamiający agenta code review na PR-ach

- **Plan**: `context/changes/ci-cd-code-review/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-21
- **Verdict**: REVISE
- **Findings**: 1 critical, 8 warnings, 1 observation
- **Triage**: 10/10 FIXED (2026-08-21) — **werdykt po poprawkach: SOUND**

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | FAIL    |
| Lean Execution        | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

Po triażu wszystkie dziesięć findings zostało naniesione na `plan.md` / `plan-brief.md`;
każdy wpis niżej niesie w polu **Decision**, co konkretnie zmieniono. Największa zmiana
strukturalna: zapadka na dryf destylatu wyszła z faz 2-3 do nowej **fazy 7**.

## Grounding

16/16 ścieżek ✓, 12/12 symboli ✓ (`review.ts:21/:31/:63-68`, `review-schema.ts:15-19`,
`tsconfig.json:4`, `eslint.config.js:126-131`, `eval.yml:74-85/:109-118/:156-162`,
`ci.yml:111-112`, `checkout@v7`/`setup-node@v6`, `lessons.md:194/:201/:243`),
Progress↔Phase 6/6 faz i 43/43 kryteriów ✓, brief↔plan — jeden rozjazd (F10).

Sprawdzone i CZYSTE: `## Progress` jest jedno, na dole, tytuły faz zgodne co do znaku,
zero checkboxów poza sekcją Progress. `MIN_CHECKED_FILES` w `scripts/typecheck.ts` to
PODŁOGA, nie równość — nowe pliki w `scripts/` i `tests/` nie zaczerwienią typechecku.
`vitest.config.ts:50` ma już `sequence: { shuffle: true }`.

## Findings

### F1 — Strażnik forka wycina każdy workflow_dispatch, czyli całą fazę 6

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: End-State Alignment
- **Location**: Faza 5, punkt 2 „Uprawnienia i strażnicy jobu"
- **Detail**: Kontrakt warunku jobu to `github.event.pull_request.head.repo.full_name == github.repository`. Przy `workflow_dispatch` `github.event.pull_request` nie istnieje — dereferencja daje `null`, a `null == 'owner/repo'` jest fałszem, więc job jest pomijany przy KAŻDYM ręcznym uruchomieniu. Faza 6 stoi w całości na trzech `workflow_dispatch` (A, B, C), a wejścia `use_fixture` i `model` działają wyłącznie w tym trybie. Jak napisano, para dowodząca czerwieni nie da się uruchomić ani razu.
- **Fix**: Poprzedzić strażnik warunkiem zdarzenia: `github.event_name == 'workflow_dispatch' || github.event.pull_request.head.repo.full_name == github.repository`, z notatką, że dispatch jest z definicji wewnętrzny.
- **Decision**: FIXED — poprawione w planie (faza 5 punkt 2: człon `github.event_name == 'workflow_dispatch' ||` + notatka, dlaczego nie wolno go uprościć)

### F2 — Czysta funkcja i CLI w jednym pliku łamią czterokrotny wzorzec repo

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff, warto się zatrzymać
- **Dimension**: Architectural Fitness
- **Location**: Faza 3, punkty 1 + 3 + 4
- **Detail**: Punkt 1 kładzie `decideVerdict` w `scripts/review-verdict.ts`, punkt 3 dokłada do tego samego pliku CLI (argv, zapis pliku, stdout), punkt 4 każe testowi importować go przez `../../scripts/…`. Repo ma czterokrotnie powtórzony podział pure/runner: `schema-drift.ts`↔`check-schema-drift.ts`, `typecheck.ts`↔`run-typecheck.ts`, `db-cleanup.ts`↔`run-db-cleanup.ts`, `kong-keepalive.ts`↔`disable-kong-keepalive.ts` — czysta połowa nie ma żadnego efektu na module scope. Plan cytuje ten wzorzec, po czym robi odwrotnie: `import` w vitescie wykona kod CLI na argv vitesta, a przy `shuffle: true` wypłynie to w losowym miejscu suity.
- **Fix A ⭐ Recommended**: Rozbić na `scripts/review-verdict.ts` (czysta funkcja + próg) i `scripts/run-review-verdict.ts` (argv, `--out`, linia `verdict=…`, `process.exitCode`).
  - Strength: Zgodne z jedynym wzorcem, jaki repo ma na ten problem; kasuje klasę „test przechodzi, ale coś odpalił".
  - Tradeoff: Jeden plik więcej, drobna zmiana kontraktu fazy 5.
  - Confidence: HIGH — cztery pary w `scripts/` zmierzone.
  - Blind spot: Czy `renderComment` też ma zostać czysty (zakładam, że tak).
- **Fix B**: Zostawić jeden plik i dodać strażnika `import.meta.main` przed kodem CLI.
  - Strength: Zero nowych plików.
  - Tradeoff: Wprowadza w `scripts/` drugi wzorzec obok istniejącego — proliferacja, którą karze kryterium 2 tego samego agenta.
  - Confidence: MED — działa, ale rozjeżdża się z konwencją.
  - Blind spot: Nie zmierzyłem `import.meta.main` pod `node --experimental-strip-types` w tej wersji Node'a.
- **Decision**: FIXED via Fix A — faza 3 punkt 3 przeniesiona do `scripts/run-review-verdict.ts`; uzasadnienie wzorcem pure/runner + `shuffle: true` dopisane

### F3 — Obiecany komunikat dla PR-ów z forków jest niewykonalny

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff, warto się zatrzymać
- **Dimension**: End-State Alignment
- **Location**: Faza 5 punkt 2; „What We're NOT Doing"; tabela decyzji w briefie
- **Detail**: Plan trzykrotnie deklaruje „jawne pominięcie z komunikatem, nie awaria", ale realizuje to warunkiem na poziomie jobu — pominięty job nie wykonuje żadnego kroku i nie zostawia komunikatu nigdzie. To ten sam „cichy brak reakcji", którym plan uzasadnia odrzucenie `paths-ignore`. Wariant z komentarzem jest zresztą niewykonalny: przy `pull_request` z forka `GITHUB_TOKEN` dostaje uprawnienia READ niezależnie od bloku `permissions:`, więc POST komentarza wróci 403.
- **Fix A ⭐ Recommended**: Przenieść strażnika forka z warunku jobu na pierwszy KROK jobu, który wypisuje powód do `$GITHUB_STEP_SUMMARY` i kończy job zielono; komentarz w PR-ze jawnie odpuścić z uzasadnieniem.
  - Strength: Komunikat realnie gdzieś jest, a przebieg nie czerwieni cudzego PR-a.
  - Tradeoff: Autor forka musi wejść w przebieg.
  - Confidence: HIGH — ograniczenie tokenu forka jest twarde i udokumentowane.
  - Blind spot: Czy pominięty job pokazuje się na liście checków PR-a w tym repo.
- **Fix B**: Zostawić warunek jobu i usunąć z planu obietnicę komunikatu.
  - Strength: Zero nowego kodu; obietnica przestaje być fałszywa.
  - Tradeoff: Zostaje cichy brak reakcji, który plan gdzie indziej nazywa defektem.
  - Confidence: HIGH
  - Blind spot: Brak.
- **Decision**: FIXED via Fix B — obietnica komunikatu usunięta z planu i briefu; warunek rewizji dopisany do Open Risks briefu

### F4 — `renderComment` wymaga `model`, którego żadna faza nie doprowadza

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: Plan Completeness
- **Location**: Faza 3 punkt 2 ↔ faza 4 punkt 1 ↔ faza 5 punkt 6
- **Detail**: Kontrakt renderera to `renderComment({…, sha, model, runUrl})`, a SC fazy 5 wymaga modelu w komentarzu. Composite action wystawia tylko `status`, `result-path`, `stderr-path`. Rozstrzygnięty model istnieje wyłącznie w linii metryk na stderr i nie ma go w schemacie wyniku — workflow nie ma skąd wziąć tej wartości bez parsowania `stderr.log`, czego plan nie zleca.
- **Fix**: Dołożyć czwarty output `model` do `.github/actions/review-agent/action.yml` i przekazać go do CLI werdyktu.
- **Decision**: FIXED — czwarty output `model` w kontrakcie akcji, z uzasadnieniem, że LLM nie raportuje własnej tożsamości; SC 4.3, Progress i diagram w briefie zaktualizowane

### F5 — Zapadka na dryf destylatu powstaje przed pierwszym pomiarem sygnału

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff, warto się zatrzymać
- **Dimension**: Lean Execution
- **Location**: Faza 2 punkt 4 + faza 3 punkt 6
- **Detail**: Zapadka to nowy skrypt, nowy generowany plik, czwarty plik testów i stały rytuał regeneracji — wszystko przed fazą 6, czyli przed dowodem, że dziewięciokryterialne review wytwarza użyteczny sygnał. Plan sam zapisuje w Open Risks, że kryterium 5 może okazać się szumem, a destylat jest kandydatem do rewizji. Usunięcie punktu 4 z fazy 2 i punktu 6 z fazy 3 nie rusza Desired End State ani jednego wiersza.
- **Fix A ⭐ Recommended**: Przesunąć zapadkę (skrypt, rekord, test) za fazę 6 — jako fazę 7 albo osobną zmianę.
  - Strength: Kalibracja destylatu w fazie 2 przestaje wymagać regeneracji rekordu po każdej iteracji opisu.
  - Tradeoff: Między fazą 2 a 7 destylat nie jest pilnowany — czyli tak jak dziś.
  - Confidence: MED — zależy od realnej częstotliwości zmian w `AGENTS.md` §Hard Rules.
  - Blind spot: Jeśli destylat zostanie na lata, odsunięcie to strata jednej sesji.
- **Fix B**: Zostawić w fazie 2, ale zawęzić do jednej sekcji (`AGENTS.md` §Hard Rules).
  - Strength: Ochrona tam, gdzie treść jest najtwardsza, przy 1/3 powierzchni utrzymania.
  - Tradeoff: Mapa ryzyk (materiał kryterium 4) zostaje niepilnowana.
  - Confidence: MED
  - Blind spot: Nie sprawdziłem, jak stabilna jest `test-plan.md` §2.
- **Decision**: FIXED via Fix A — zapadka wyprowadzona z faz 2 i 3 do nowej **fazy 7** (z własnym blokiem Progress i uzasadnieniem „po pomiarze, nie przed"); brief, Scope i Phases at a Glance zsynchronizowane

### F6 — Czwarty stan nie ma renderera ani markera stickiness

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff, warto się zatrzymać
- **Dimension**: Blind Spots
- **Location**: Faza 5 punkt 4 (tabela stanów) ↔ faza 3 punkt 2
- **Detail**: Trzeci wiersz tabeli wymaga komentarza „brak kodu do oceny", ale faza 3 nie definiuje dla niego funkcji: `renderComment` bierze `verdict`, `failing`, `skipped`, `scores`, `summary` — z których w tym stanie nie istnieje ani jedno. Nie jest też powiedziane, że ta treść niesie marker `<!-- ai-code-review v1 -->`; bez markera kolejny przebieg doklei drugi komentarz, a SC 5.4 tego nie wyłapie, bo mierzy PR-a z kodem.
- **Fix**: Dodać do fazy 3 trzecią nazwaną funkcję (np. `renderNoCodeComment({sha, runUrl})`) emitującą ten sam marker; test renderera dostaje przypadek „wszystkie trzy warianty zaczynają się tym samym markerem".
- **Decision**: FIXED — `renderNoCodeComment({sha, runUrl})` dopisany do fazy 3 punkt 2, wskazany w kontrakcie fazy 5 punkt 4, plus asercja „wszystkie trzy warianty zaczynają się tym samym markerem" w teście renderera

### F7 — `concurrency` bez klucza dla dispatchu może anulować przebieg A pary dowodowej

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: Blind Spots
- **Location**: Faza 5 punkt 1 ↔ faza 6 punkt 1
- **Detail**: Kontrakt mówi „grupowane per PR z `cancel-in-progress: true`", ale przy `workflow_dispatch` nie ma kontekstu PR-a — grupa musiałaby lecieć z `inputs.pr_number`, czego plan nie zapisuje. Wspólny klucz → odpalenie B anuluje A i para dowodowa przestaje istnieć; inny klucz → dispatch nie chroni przed równoległością wcale. Dodatkowo anulowany przebieg z krokiem `if: always()` doklei nagłówek awarii przy zwykłym szybkim pushu.
- **Fix**: Zapisać klucz jawnie: `group: pr-review-${{ github.event.pull_request.number || inputs.pr_number }}`; dopisać w fazie 6, że A i B odpalamy sekwencyjnie.
- **Decision**: FIXED — jawny `group: pr-review-${{ github.event.pull_request.number || inputs.pr_number }}` w fazie 5 punkt 1 + zapis w fazie 6, że A i B lecą sekwencyjnie

### F8 — Faza 6 twierdzi, że edycja §Commands rusza hash pilnowanej sekcji

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: Plan Completeness
- **Location**: Faza 6 punkt 4; krok 6.4 w Progress
- **Detail**: Zapadka hashuje `AGENTS.md` §`## Hard Rules`, §`## Conventions` i `test-plan.md` §`## 2. Risk Map`. Faza 6 dopisuje zdanie do §`## Commands` (AGENTS.md:21) i twierdzi, że to zmienia sekcję pilnowaną hashem oraz że będzie to „pierwszy realny test zapadki". §Commands leży między §Hard Rules (:5) a §Conventions (:31) i nie wchodzi do żadnego hashowanego wycinka — regeneracja nie będzie potrzebna, a krok 6.4 zweryfikuje przejście, które nastąpiłoby i tak.
- **Fix**: Zastąpić realną próbą: zepsuć jedną linię §Hard Rules bez commita, potwierdzić czerwień testu, przywrócić — i to zapisać jako 6.4 (uzgadniając treść z krokiem 3.6, żeby faza 6 nie obiecywała drugiego dowodu).
- **Decision**: FIXED — fałszywe twierdzenie usunięte z fazy 6 punkt 4 (zastąpione notatką, czego ta edycja NIE robi); realna para czerwono/zielono na §Hard Rules przeniesiona do fazy 7 punkt 3 i kroku 7.4; krok 6.4 przeformułowany

### F9 — SHA w komentarzu przy `pull_request` będzie SHA commita scalającego

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: Blind Spots
- **Location**: Faza 5 punkt 4 + SC 5.8 / Progress 5.8
- **Detail**: Plan sam zauważa, że checkout bierze `refs/pull/<N>/merge` w detached HEAD — więc `github.sha` to SHA syntetycznego commita scalającego, którego nie ma na liście commitów PR-a. SC 5.8 przeszłoby na złej wartości: SHA jest, tylko nieprzypisywalny — ta sama klasa niefalsyfikowalnej weryfikacji, którą plan tępi w fazie 6.
- **Fix**: Zapisać w kontrakcie `github.event.pull_request.head.sha` (przy `workflow_dispatch` — `head.sha` z API po `pr_number`) i doprecyzować SC 5.8 jako „SHA zgadza się z ostatnim commitem widocznym na liście PR-a".
- **Decision**: FIXED — `github.event.pull_request.head.sha` zapisane jako jedyne źródło SHA (z uzasadnieniem, dlaczego `github.sha` jest nieprzypisywalny); SC 5.8 i krok 5.8 zaostrzone do „zgadza się z ostatnim commitem z listy commitów PR-a"

### F10 — Brief obiecuje odcięcie plików generowanych, filtr ich nie odcina

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: Plan Completeness
- **Location**: `plan-brief.md` (tabela decyzji, „Co jest diffem") ↔ faza 5 punkt 4
- **Detail**: Brief mówi „Tylko kod: bez `context/**`, lockfile'i i plików generowanych". Pathspec w planie wyklucza `context/**`, `**/package-lock.json` i `src/db/database.types.ts` — ale nie dwa pliki generowane, które ta sama zmiana wprowadza: `agents/review/criteria.json` i `agents/review/prompt-sources.json`.
- **Fix**: Dodać `':(exclude)agents/review/criteria.json'` i `':(exclude)agents/review/prompt-sources.json'` do pathspeca.
- **Decision**: FIXED — do pathspeca dołożony `agents/review/criteria.json`, a nad nim zapisana REGUŁA OGÓLNA („z diffa wypada każdy plik generowany, bo agent oceniałby wyjście generatora jako czyjś kod") z zasadą, że każdy kolejny taki plik dopisuje się w fazie, w której powstaje; `prompt-sources.json` dochodzi w fazie 7, nie teraz
