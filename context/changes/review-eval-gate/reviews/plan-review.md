<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Bramka regresji na zmianach promptu agenta review

- **Plan**: `context/changes/review-eval-gate/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-23
- **Verdict**: REVISE → SOUND po triażu (wszystkie 5 findingów naprawionych w planie)
- **Findings**: 2 critical, 2 warnings, 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | FAIL    |
| Plan Completeness     | WARNING |

Po triażu wszystkie pięć findingów naprawionych w `plan.md` / `plan-brief.md`; spójność
Progress↔Success Criteria przeliczona po edycjach (5 faz, 45 ↔ 45, zero `- [ ]` poza `## Progress`).

## Grounding

20/20 ścieżek ✓, 11/11 symboli ✓, brief↔plan ✓, Progress↔Phase ✓ (41 wierszy ↔ 41 kryteriów, 5 faz
w chwili review; po triażu 45 ↔ 45, sprawdzone ponownie).

Zweryfikowane pomiarem, nie na słowo: `SCORE_THRESHOLD = 5` stoi w `scripts/review-verdict.ts:35`,
a `SCORE_MIN`/`SCORE_MAX` w `:32-33` **nie są** przypięte żadnym `toBe` — oś `verdictConfig` kupuje
realne pokrycie, nie samą duplikację `ci`. `cache.ts:2` faktycznie ma wartościowy
`import … from "promptfoo"`. `wrapDiff` mieszka w `prompt.ts:299`, `FIXED_CALL_OPTIONS`
w `run-review.ts:222` — deklarowany zestaw importów `fingerprint.ts` jest dokładnie wystarczający
i nie ciągnie promptfoo z powrotem. `zod` + SDK to prod-depy, `promptfoo`/`tsx`/`typescript` to
dev-depy, więc `npm ci --omit=dev` starcza. `printWidth: 120`, `.prettierignore` z jednym wzorcem
(`context/archive/**`) — zgodne z założeniem researchu.

## Findings

### F1 — Krok bezzależnościowy przed `setup-node` biegnie na niepinowanym Node

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Architectural Fitness
- **Location**: Faza 4 §3 (Workflow) + sekcja „Critical Implementation Details"
- **Detail**: Plan zapisuje kolejność kroków jako checkout → `check-verdict-config.ts` (bez
  instalacji) → `setup-node` → `npm ci --omit=dev` → `check-eval-record.ts`, i nazywa tę odwrotność
  „jedynym miejscem, gdzie kolejność ma znaczenie funkcjonalne". Skutek jest odwrotny do
  zamierzonego: pierwszy krok woła `node --experimental-strip-types` na Node, którego to repo
  nigdzie nie pinuje — na preinstalowanym w obrazie `ubuntu-latest`. Repo pinuje `22.14.0`
  (`.nvmrc`), a type stripping wymaga ≥ 22.6; obraz runnera tej gwarancji nie daje i może ją zmienić
  bez PR-a w tym repo. Wszystkie TRZY precedensy bezzależnościowych runnerów robią to odwrotnie —
  `setup-node@v6` z `node-version: 22` idzie PRZED, a pomija się wyłącznie `npm ci`:
  `prompt-ratchet.yml:37-39` → `:51`, `ci.yml:148-150` → `:156`, `pr-review.yml:229-231` → `:463`.
  Plan sam ustawia `prompt-ratchet.yml` jako wzorzec, po czym łamie jego kształt w tym jednym
  punkcie. Cel („rozjazd progu czerwieni w sekundach, nie po 38-sekundowej instalacji") przeżywa
  poprawkę bez uszczerbku: `setup-node` bez cache'u to kilka sekund, a droga 38 s to `npm ci`.
- **Fix**: Przestaw na checkout → `setup-node` (`node-version: 22`) → `check-verdict-config.ts` →
  `npm ci --omit=dev` → `check-eval-record.ts`. Popraw też zdanie w „Critical Implementation
  Details", żeby mówiło „PRZED `npm ci`", a nie „przed `setup-node`/`npm ci`".
- **Decision**: FIXED — kolejność kroków przestawiona (`setup-node` pierwszy); dodatkowo, na wniosek autora, wpisane trzy warunki, które `--omit=dev` nakłada na kod (brak `promptfoo`, runner pod bare node zamiast `tsx`, pomiar obu checkerów po instalacji) oraz nota o częściowej spłacie długu z poprzedniej zmiany.

### F2 — Sondy fazy 5 nie mają czego zaczerwienić: nie ma otwartego PR-a

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — szybka decyzja; brakuje jednego kroku wstępnego
- **Dimension**: Blind Spots
- **Location**: Faza 5 §1–§3, Prerequisites w `plan-brief.md`
- **Detail**: Faza 5 opisuje sondy jako „commit, push, obserwacja czerwieni joba `Eval ratchet`,
  rewert". Wyzwalacz nowego workflow to (Faza 4 §3) `push: branches: [main]` +
  `pull_request: branches: [main]`. Push sondy na gałąź `review-eval-gate` nie pasuje do żadnego
  z nich, dopóki nie istnieje PR do `main` — a `gh pr list --head review-eval-gate --state all`
  zwraca dziś pustą listę. Bez PR-a push sondy nie uruchamia NICZEGO: ani czerwieni, ani zieleni.
  To uderza dokładnie w punkt 4 „Desired End State" — dwustronną kontrolę „NA ŚCIEŻCE CI, na której
  zapadka żyje" — czyli w to, po co ta faza istnieje. Precedens sondy `de97385`, na który plan się
  powołuje, mówi tylko o tym, że `pre-push` sondy nie blokuje; o wyzwalaczu nie mówi nic.
- **Fix**: Dopisz do fazy 5 krok 0: „otwórz PR `review-eval-gate` → `main` (draft wystarczy) PRZED
  pierwszą sondą" i dodaj to samo do Prerequisites obok `OPENROUTER_REVIEW_KEY` i husky. Dopisz
  zdanie, dlaczego PR ma być otwarty PRZED pushem sondy: przy `pull_request` GitHub bierze plik
  workflow z merge-refa gałęzi, więc świeżo dodany `eval-ratchet.yml` biegnie — ale dopiero od
  zdarzenia `opened`.
- **Decision**: FIXED — nowy krok 0 fazy 5 (0a `gh workflow disable "PR code review"`, 0b otwarcie PR-a) plus §5 „Przywrócenie bramki review" jako warunek zamknięcia fazy; Progress fazy 5 przenumerowany na 5.1–5.12 z osobnymi wierszami na wyłączenie i włączenie. Dwie korekty do treści zgłoszonej przez autora: workflow nazywa się `PR code review` (nie „AI Code Review"), a `lessons.md` nie ma numeracji wpisów — cytowane jako `lessons.md:250-255`.

### F3 — Fikstury i asercje nie są w odcisku, a dowód milczy o tej dziurze

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff; warto się zatrzymać
- **Dimension**: Blind Spots
- **Location**: Faza 2 §1 (`MANDATORY_NOTES`), D-4
- **Detail**: `productionPromptFingerprint()` liczy odcisk z `wrapDiff("", FINGERPRINT_NONCE)` —
  z PUSTYM diffem (`provider.ts:169-176`). Treść `evals/fixtures/*.diff` nie wchodzi więc do żadnej
  z czterech osi. Tak samo `evals/assertions.ts`: asercje nigdy nie jadą do modelu, a to one
  decydują, co znaczy `ok: true` w każdym wierszu macierzy. Konsekwencja: osłabienie asercji albo
  edycja fikstury NIE rusza `callFingerprint`, więc zapadka zostaje ZIELONA nad rekordem, którego
  wiersze `ok: true` opisują już inny pomiar. To ta sama klasa co dwie dziury, które plan nazywa
  jawnie i wpisuje do `notes` (sonnetowa z D3, warstwa interpretacji z D-4) — tylko ta jedna nie
  została nazwana. `agents-gate.yml` tego nie łata: biega na `agents/**`, ale sprawdza
  `assertions.test.ts`, a nie świeżość dowodu.
- **Fix A ⭐ Recommended**: Dopisz piąte zdanie do `MANDATORY_NOTES` — „ten dowód nie obejmuje
  fikstur ani asercji: obie leżą poza czterema osiami odcisku, więc ich zmiana nie unieważnia tej
  tabeli".
  - Strength: Spójne z rozstrzygnięciem, które plan już podjął dwa razy (D3, D-4): dziurę się
    NAZYWA, nie dogaduje drugą bramką. Koszt: jedno zdanie, zero nowego kodu i zero nowej czerwieni.
  - Tradeoff: Dziura zostaje otwarta — nic mechanicznie nie zatrzyma osłabienia asercji przy
    zielonej zapadce.
  - Confidence: HIGH — zmierzone: `wrapDiff("", …)` w `provider.ts:174`, `assertions.ts` bez ścieżki
    do `query(...)`.
  - Blind spot: Nie sprawdzałem, czy `assertions.test.ts` pilnuje SIŁY asercji, czy tylko ich
    mechaniki.
- **Fix B**: Trzecia oś dowodu — digest `assertions.ts` + plików fikstur w rekordzie.
  - Strength: Zamyka dziurę mechanicznie; edycja fikstury czerwieni od razu.
  - Tradeoff: Łamie D-2 — remedium dla tej osi jest PŁATNE (zmiana fikstury naprawdę unieważnia
    komórki), więc trzeci blok wpada do koszyka „przejedź macierz" i rozmywa rozdział remediów,
    którego czystość jest treścią D-2. Do tego digest pliku to lista ścieżek — kształt, który
    wymaganie 2 odrzuca.
  - Confidence: MEDIUM — tradeoff jasny, ale nie mierzyłem, jak często fikstury faktycznie się
    zmieniają.
  - Blind spot: Nieznane, czy przyszłe poszerzenie macierzy nie uczyniłoby tej osi stale czerwoną.
- **Decision**: FIXED — Fix A dla FIKSTUR (piąte pole `notes.fixtures`, dziura nazwana i przyjęta) plus, na wniosek autora, `assertionsDigest` wciągnięty do `verdictConfig` jako oś INTERPRETACJI. Rozstrzygnięte pomiarem: rekord z D1 NIE wystarcza do przeliczenia `ok` po zmianie asercji (każda asercja czyta pełny `Review` — `assertions.ts:151-154, 187-190, 175, 120`; rekord niesie tylko `verdict`/`ok`/`contract`/`failures[].reason`), więc remedium tej osi zapisane jako CZYNNOŚĆ LUDZKA, pod testem treści.

### F4 — Sfabrykowany dowód idzie pod prawdziwą ścieżkę, a jego usunięcie jest krokiem RĘCZNYM po rytuale commita

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista
- **Dimension**: Plan Completeness
- **Location**: Faza 2, kryteria 2.4/2.5 i 2.7
- **Detail**: Kryterium 2.4 każe zapisać sfabrykowany dowód pod
  `agents/review/evals/eval-record.json` i puścić na nim `prettier --check`; usunięcie tej atrapy
  jest kryterium 2.7 — pod `#### Manual`. `/10x-implement` odpala rytuał commita „after all
  automated checks pass for the phase", stagując zbiór plików dotkniętych w fazie, a weryfikację
  ręczną gasi PO nim. Atrapa ma więc otwartą drogę, żeby wejść do commita fazy 2 — czyli dokładnie
  to, czemu 2.7 przeczy („plik ma powstać z przebiegu, nie z atrapy").
- **Fix**: Zmierz prettiera na ścieżce sondującej w TYM SAMYM katalogu, np.
  `agents/review/evals/eval-record.prettier-probe.json` (ten sam katalog = to samo rozstrzygnięcie
  configu prettiera, więc pomiar zachowuje `printWidth: 120`), i usuń ją w tym samym kroku
  automatycznym. Kryterium 2.7 zmienia się wtedy z „usuń atrapę" na „prawdziwa ścieżka dowodu nie
  istniała ani przez chwilę" — sprawdzalne przez `git log -- <ścieżka>`.
- **Decision**: FIXED — pomiar przeniesiony na `eval-record.prettier-probe.json` w tym samym katalogu, usuwany w tym samym kroku automatycznym; kryterium 2.8 zapisane jako PARA (`git log` pusty na `eval-record.json` ORAZ niepusty na `cache.ts`), bo samo (a) spełnia każda literówka w ścieżce.

### F5 — Kontrakt `--record` nie mówi, że flaga ma zostać wycięta z `rest`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; jedno zdanie w kontrakcie
- **Dimension**: Plan Completeness
- **Location**: Faza 2 §2
- **Detail**: `report.ts:501-507` (`splitArgs`) wycina `--from <plik>` i przekazuje CAŁĄ resztę
  argumentów dalej do `promptfoo eval` — komentarz mówi to wprost: „reszta argumentów leci do
  `promptfoo eval`". Kontrakt `--record` w planie wylicza trzy twarde odmowy, ale nie mówi, że sama
  flaga musi zostać zdjęta z `rest`. Zostawiona tam trafi do `promptfoo eval` jako nieznana opcja.
- **Fix**: Dopisz do kontraktu: „`--record` jest konsumowane przez `splitArgs` tak samo jak `--from`
  i nie trafia do `rest`".
- **Decision**: FIXED — kontrakt Fazy 2 §2 mówi teraz, że `--record` jest konsumowane przez `splitArgs` i nie trafia do `rest`.
