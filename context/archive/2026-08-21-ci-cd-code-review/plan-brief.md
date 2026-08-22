# Workflow CI/CD z agentem code review — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Wymagania: `context/changes/ci-cd-code-review/requirements.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Każdy pull request do `main` dostaje automatyczne review od agenta z `agents/review/`
(Claude Agent SDK przez OpenRoutera): dziewięć kryteriów w skali 1-10, jeden werdykt
`pass`/`fail`, komentarz w PR-ze i etykieta widoczna na liście PR-ów. Review jest **doradcze
i świadomie niczego nie blokuje** — dziś w tym repo nie blokuje nic (brak branch protection),
a review tego stanu nie zmienia i nie udaje, że zastaje jakąś bramkę.

Powód, dla którego to jest warte zachodu, jest zmierzony, nie hipotetyczny: pięć defektów
klasy „połknięty błąd" z jednego tygodnia sierpnia 2026 znalazł **ręczny przegląd kodu**.
Żaden test, żaden monitoring i żaden kanał automatyczny nie mógł ich znaleźć — cała suita
była przez ten czas zielona.

## Starting Point

Agent istnieje i ma czysty kontrakt runtime (diff przez stdin, JSON na stdout, metryki
na stderr, pusty diff → kod 1, `verdict: "fail"` → kod 0), ocenia dziś **pięć** kryteriów
i jedzie po aliasie `"sonnet"`. Repo ma trzy workflow'y z mocną, spisaną kulturą (reguła
zasięgu sekretów, redirect zamiast pipe, „to nigdy nie jest bramka"), ale **nie ma** ani
jednego bloku `permissions:`, żadnego composite action, żadnego `fetch-depth`, `gh` w CI,
komentarzy ani etykiet. Domyślne uprawnienia `GITHUB_TOKEN` to `read`.

Agent ma też defekt znaleziony pomiarem podczas researchu: przy awarii łączności SDK zwraca
`subtype: "success"` razem z `is_error: true`, więc agent raportuje „niepoprawny structured
output" zamiast „nie ma sieci" — przyczyna zostaje połknięta.

## Desired End State

Otwarcie PR-a (albo push, albo nałożenie `ai-cr:review`) zostawia na nim jeden komentarz
z tabelą dziewięciu ocen, jawnym „nie dotyczy" tam, gdzie ono padło, werdyktem i SHA commita,
plus jedną etykietę `ai-cr:passed` / `ai-cr:failed`. Kolejne uruchomienia aktualizują ten sam
komentarz. Czerwony przebieg zawsze znaczy „review się nie odbyło", nigdy „review wypadło źle" —
i ta różnica jest udowodniona parą przebiegów, nie zadeklarowana.

## Key Decisions Made

| Decyzja                            | Wybór                                                                                                                | Dlaczego                                                                                                                                                          | Źródło    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Blokowanie merge'a                 | Nie blokuje, zero required checks                                                                                    | Dziś nie blokuje nic; twarda bramka o nieznanym poziomie fałszywych alarmów uczy zespół, jak ją obchodzić                                                         | Wymagania |
| Uwierzytelnienie                   | OpenRouter na istniejącym `OPENROUTER_EVAL_KEY`                                                                      | Nie kupujemy klucza Anthropica; routing udowodniony kontrolką negatywną (`ENOTFOUND` przy zepsutym base URL)                                                      | Research  |
| Model                              | Pin `anthropic/claude-sonnet-4.6`, nadpisanie **tylko** przy ręcznym dispatchu                                       | Automatyczne przebiegi muszą być odtwarzalne — inaczej porównanie sprzed/po zmianie progu jest bezwartościowe                                                     | Plan      |
| „Nie dotyczy" (kryteria 7 i 8)     | `z.number().nullable()`, `null` = nie dotyczy                                                                        | Zmierzone przez structured output; zagnieżdżone obiekty **nie** były mierzone, więc plan ich nie używa                                                            | Research  |
| Co jest „diffem"                   | Tylko kod: bez `context/**` i bez **każdego** pliku generowanego (lockfile, `database.types.ts`, `criteria.json`, …) | Surowy diff to w 69-89% dokumentacja i lockfile; agent nie ma oceniać wyjścia generatora jako czyjegoś kodu; świadoma cena: kryterium 5 traci większość materiału | Research  |
| PR bez kodu po filtrze             | **Czwarty stan**: zielono, komentarz „brak kodu do oceny", zero etykiet                                              | `paths-ignore` sprawiłby, że `ai-cr:review` na takim PR-ze milczy — cichy brak reakcji to klasa z kryterium 8                                                     | Plan      |
| Wyzwalacze                         | `opened`/`synchronize`/`reopened`/`labeled` + `cancel-in-progress`, SHA w komentarzu                                 | Komentarz opisuje aktualny stan; SHA domyka przypadek anulowania w ostatniej sekundzie                                                                            | Plan      |
| Komentarz przy awarii review       | Nagłówek awarii **nad** zachowanym poprzednim werdyktem                                                              | Nie tracisz ostatniego znanego wyniku i nie udajesz, że jest aktualny                                                                                             | Plan      |
| PR-y z forków                      | Pominięcie BEZ sygnału dla autora (`pull_request_target` odrzucony)                                                  | Token forka jest read-only z definicji GitHuba, więc komentarz to 403; czerwień na cudzym PR-ze czyta się jako „twój kod jest zły"                                | Plan      |
| Jedno źródło listy kryteriów       | Agent **generuje** `criteria.json`, `scripts/` czyta dane, bramka `git diff --exit-code`                             | Wzorzec `database.types.ts` z `ci.yml`; druga lista w ogóle nie powstaje, agent zostaje przenośny                                                                 | Plan      |
| Zapadka na dryf destylatu promptu  | sha256 **wyciętych sekcji** `AGENTS.md` i `test-plan.md` §2 + test z kontrolą pozytywną, **w fazie 7 (po pomiarze)** | Hash całości czerwieniałby przy literówce; a zapadka przed fazą 6 zamrażałaby treść, która wciąż jest kandydatem do przepisania                                   | Plan      |
| Dowód, że bramka umie zaczerwienić | Para `workflow_dispatch` różniąca się **wyłącznie** `use_fixture`                                                    | Lekcja z `schema-drift-test`: pojedynczy czerwony przebieg niczego nie przypisuje                                                                                 | Plan      |

## Scope

**In scope:** routing przez OpenRoutera + pin modelu + naprawa połkniętego błędu w agencie;
dziewięć kryteriów z opisami 1/10 i destylatem kontekstu repo; generowana `criteria.json`
z bramką dryfu; czysta funkcja werdyktu z progiem jako nazwaną liczbą + renderer komentarza
w trzech wariantach + testy offline; composite action; workflow z uprawnieniami, czterema
stanami, sticky komentarzem i trzema etykietami; para przebiegów dowodzących czerwieni;
zapadka na dryf destylatu **jako faza 7, po pomiarze** (może pojechać osobną zmianą).

**Out of scope:** dopasowanie biznesowe i architektoniczne (nie da się ocenić z samego diffa);
branch protection i required checks; `pull_request_target` i review dla forków; kalibracja
progu (5 to wartość startowa, nie wynik pomiaru); optymalizacja cache'u promptu; wciąganie
`agents/**` do tsconfigu, ESLinta czy vitesta.

## Architecture / Approach

```
pull_request / labeled / dispatch
        │
        ├─ permissions: contents:read, pull-requests:write, issues:write
        ├─ strażnicy: fork? etykieta ai-cr:review?
        │
   [workflow]  checkout fetch-depth:0 → zdejmij ai-cr:review → zbierz diff (merge-base, bez context/**)
        │                                                        │
        │                                          cztery stany rozstrzygane logiką
        ▼
   [composite action .github/actions/review-agent]
        klucz jako input → npm ci w agents/review → bramka dryfu criteria.json
        → agent (redirect, nie pipe) → outputs: status, result-path, stderr-path, model
        │
        ▼
   [scripts/run-review-verdict.ts → review-verdict.ts + review-comment.ts]
        czysta funkcja: próg 5, null poza agregacją → verdict + comment.md
        │
        ▼
   [workflow]  sticky komentarz (marker HTML) + etykiety (create --force, wzajemnie wykluczające)
```

Granica `agents/` (poza tsconfigiem, ESLintem i vitestem — decyzja z `e1ed7e5`) zostaje
nietknięta: `scripts/` czyta z agenta **dane**, nigdy kodu.

## Phases at a Glance

| Faza                         | Co dostarcza                                                     | Główne ryzyko                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1. Agent runtime             | Routing przez OpenRoutera, pin modelu, naprawa połkniętego błędu | Naprawa niesprawdzona bez kontrolki negatywnej — wtedy defekt tylko zmienia przebranie                                      |
| 2. Kontrakt oceny            | 9 kryteriów, destylat 2-4k tokenów, generowana `criteria.json`   | Prettier vs generator: zły format = bramka dryfu czerwona na zawsze                                                         |
| 3. Werdykt i komentarz       | Czysta funkcja + renderer w `scripts/` + cztery pliki testów     | Test bez kontroli pozytywnej przechodzi także na implementacji „zawsze fail"                                                |
| 4. Composite action          | Pierwszy composite w repo; instalacja, sekret, outputy           | `npm ci` 335 MB na Linuksie — pierwsze takie uruchomienie w tym repo                                                        |
| 5. Workflow                  | Wyzwalacze, uprawnienia, cztery stany, komentarz, etykiety       | Pierwszy blok `permissions:` w repo; 403 na komentarzu przy niedomiarze zakresu                                             |
| 6. Próba czerwieni           | Para przebiegów + dowód ścieżki awarii + pierwszy pomiar         | Kilku strażników naraz — para musi różnić się dokładnie jedną rzeczą, inaczej nic nie dowodzi                               |
| 7. Zapadka na dryf destylatu | sha256 sekcji źródeł + test z kontrolą pozytywną                 | Postawiona PO pomiarze: zamraża treść, w którą już wierzymy — przed nim kosztowałaby regenerację przy każdej iteracji opisu |

**Prerequisites:** sekret `OPENROUTER_EVAL_KEY` (istnieje — ale jego obecność na liście
niczego nie dowodzi, precedens BOM-u z `eval-ci-dispatch`); klucz OpenRoutera dostępny
lokalnie do faz 1-2 (podawany na jedno wywołanie, nigdy eksportowany jako
`OPENROUTER_API_KEY` — to przerywa `npm test`); lokalny stack Supabase do `npm test` w fazie 3.

**Estimated effort:** ~5-7 sesji (faza 7 jest odpinalna). Fazy 1-3 są lokalne i tanie; 4-6 wymagają przebiegów CI
i realnego wydatku rzędu $0,25 za przebieg na dużym PR-ze.

## Open Risks & Assumptions

- **Kryterium 5 ocenia prawie w ciemno** po odcięciu `context/**` — w tym repo „dlaczego"
  mieszka właśnie tam. Cena przyjęta świadomie; jeśli oceny kryterium 5 okażą się szumem,
  to jest pierwszy kandydat do rewizji.
- **Destylat promptu jest kopią.** Zapadka wykryje rozjazd, ale nie naprawi go sama —
  po każdej zmianie `AGENTS.md` ktoś musi przeczytać sekcję i zaktualizować prompt.
- **Próg 5 to wartość startowa.** Warunek powrotu do decyzji „nie blokujemy" wymaga zestawu
  evali z realnych PR-ów, w tym tych, które wwiozły defekty z `context/archive/`.
- **Zielony przebieg z czasem przestaje być czytany** — cały ciężar sygnału spoczywa na
  komentarzu i etykiecie. Warto przy okazji pierwszych kilkunastu przebiegów zmierzyć, czy
  ktokolwiek je czyta.
- **PR z forka nie dostaje żadnego sygnału** — świadomie, bo token forka jest read-only
  z definicji GitHuba (komentarz = 403), a autor widzi wyłącznie `skipped` na liście checków.
  Dziś to przypadek hipotetyczny; **warunek rewizji**: gdy PR-y z forków zaczną realnie wpadać,
  wracamy do decyzji i wtedy dopiero kupujemy pod nią osobny krok z komunikatem.
- **`npm ci` w `agents/review` na Linuksie nie był jeszcze uruchomiony.** Lockfile zawiera
  komplet pakietów platformowych, ale to twierdzenie z pliku, nie z przebiegu.

## Success Criteria (Summary)

- Autor PR-a widzi w wątku jeden aktualny komentarz z werdyktem, dziewięcioma ocenami
  i jawnie zaznaczonym „nie dotyczy" — bez rozwijania czegokolwiek i bez wchodzenia w przebieg.
- Lista PR-ów niesie etykietę wyniku, a jej brak jednoznacznie znaczy „review się nie odbyło".
- Para przebiegów udowadnia, przy jednej zmiennej różnicy, że ten sygnał potrafi zaświecić
  na czerwono — czyli że nie jest bramką, która zdejmuje czujność, nie dając nic w zamian.
