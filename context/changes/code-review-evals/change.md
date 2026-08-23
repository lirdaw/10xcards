---
change_id: code-review-evals
title: Promptfoo evals for the code review agent
status: impl_reviewed
created: 2026-08-22
updated: 2026-08-23
archived_at: null
---

## Notes

introducing promptfoo evals for the code review agent

## Dług zapisany jawnie

**Workflow evali nie został ani razu uruchomiony w tej zmianie, więc jest gwarancją
NIEPRZETESTOWANĄ** — dokładnie tą klasą, którą archiwum tego repo zapisało przy `concurrency`
w `eval.yml` jako „never contended". Zestaw jechał wyłącznie lokalnie; że pojedzie na runnerze,
jest przewidywaniem, nie pomiarem.

**Warunek zamknięcia:** osobna zmiana, która dodaje workflow evali wzorem
`.github/workflows/eval.yml` — `workflow_dispatch` jako JEDYNY wyzwalacz, sekret na KROK a nie
na job, `concurrency` na samym workflow, artefakt z pełnym zapisem, `sed` wycinający klucz przed
uploadem, żadnego `schedule:`, `needs:` ani required check — **i odpala go RAZ, na dowód**.

⚑ Ten workflow musi przy okazji zamknąć ryzyko otwarte nr 2 z planu: cache promptfoo to jeden
plik `cache.json`, więc dwa równoległe przebiegi kasują sobie wpisy. Albo `concurrency` na
workflow, albo własny `PROMPTFOO_CACHE_PATH` na przebieg — inaczej wyścig objawi się nie awarią,
tylko rachunkiem.

---

**Drugi dług: promptfoo jedzie na PRODUKCYJNEJ ścieżce review, a fallback `--omit=dev` jest
ZDECYDOWANY i NIEOTWARTY.** Faza 4 §1 postawiła próg (≥ 15 s mediany LUB ≥ 25%) i zobowiązała:
przekroczenie → fallback otwarty OSOBNĄ zmianą przed zarchiwizowaniem tej. Próg przekroczony
**dwudziestopięciokrotnie**, i to są liczby, nie ocena:

| miara                                             | przed promptfoo | po promptfoo  | zmiana          |
| ------------------------------------------------- | --------------- | ------------- | --------------- |
| mediana `npm ci` (katalog izolowany, 3 przebiegi) | 5 758 ms        | **38 302 ms** | **+565%**       |
| `node_modules` rozpakowane                        | 392 MB          | **2 099 MB**  | **5,4x**        |
| wpisy `node_modules/` w `package-lock.json`       | 141             | **827**       | **+686 paczek** |

Pełny zapis pomiaru: `verification.md`, faza 4, sekcja „`npm ci` przed i po dodaniu promptfoo".
`.github/actions/review-agent/action.yml:126` robi gołe `npm ci` (bez `--omit=dev`), a `tsx` jest
devDependency — więc KAŻDY przebieg review na KAŻDYM PR-ze w tym repo instaluje dziś promptfoo.
Bez tych liczb „fallback: TAK" za miesiąc przeczyta się jak preferencja, a nie jak decyzja
wymuszona pomiarem.

**Warunek zamknięcia — CZYNNOŚĆ Z DOWODEM, nie zamiar:** osobna zmiana przenosząca `tsx` do
`dependencies` i dokładająca `npm ci --omit=dev` w composite action, **plus PARA DOWODOWA na
PR-ze** potwierdzająca, że review nadal działa (przebieg przed i po, oba numery zapisane).
To jest zmiana na produkcyjnej ścieżce CI, więc **nie wolno jej domknąć samym commitem** —
pierwszy dowód, że nie zepsuła review, nie może przyjść na cudzym PR-ze.

Druga dźwignia do zmierzenia obok pierwszej, nie zamiast: ciężar siedzi w `optionalDependencies`
promptfoo (42 opcjonalne zależności — `@playwright/browser-chromium`, `@huggingface/transformers`,
`sharp`, `@swc/core`), więc `npm ci --omit=optional` należy zmierzyć w tej samej parze.

## Stan na zamknięcie fazy 7

Pełny zapis: `verification.md` (dowody per faza), `plan.md` (sekcja „Open Risks"),
`requirements.md` (rachunki przy wymaganiu 1).

- **Wydano: 1,096735 USD** z progu **1,20 USD** podniesionego jawnie i jednorazowo 2026-08-23
  (pierwotny próg 1,00 USD zostaje w zapisie obok, nie zamiast).
- **Cztery ryzyka otwarte**, każde z warunkiem zamknięcia sformułowanym jako PYTANIE DO POMIARU:
  duplikacja `SCORE_MIN`/`SCORE_MAX`, wyścig cache'u promptfoo, kontrakt `null` odrzucany przez
  model, `maxTurns: 2` jako nienazwane założenie o wielkości wejścia.
- **Pięć pozycji `## Progress` zostaje NIEODHACZONYCH** (6.1, 6.2, 7.1, 7.2, 7.5) — świadomie.
  Każda opisuje warunek, który NIE został spełniony, a odhaczenie z przypisem zrównałoby
  „niezmierzone" ze „zmierzonym i w porządku". Powody per pozycja: `verification.md`, faza 7.

  > **Korekta po triage’u impl-review** (2026-08-23): było sześć, jest pięć. **7.3 różniło się
  > od pozostałych** — `typecheck` i `test` były zielone lokalnie, ale `agents-gate.yml` wymaga
  > przebiegu CI, a gałąź nie była wypchnięta — czyli jako jedyną zamykała ją CZYNNOŚĆ, nie pomiar.
  > Czynność wykonana: gałąź wypchnięta (`b87f897..74346b0`), **`Agents gate` 32637270773 —
  > success**, plan TAP `1..70` w logu (zieleń niepusta). Pozostałe pięć zamyka wyłącznie pomiar
  > i tak ma zostać.
