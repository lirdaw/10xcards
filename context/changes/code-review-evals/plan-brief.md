# Zestaw evali (promptfoo) dla agenta code review — Plan Brief

> Pełny plan: `context/changes/code-review-evals/plan.md`
> Wymagania: `context/changes/code-review-evals/requirements.md`
> Badanie: `context/changes/code-review-evals/research.md`
> Pomiar: `context/changes/code-review-evals/measurement-cheap-models.md`

## What & Why

Agent code review jedzie dziś na produkcji bez ŻADNEGO zestawu evali. Każda edycja
`SYSTEM_PROMPT` kasuje cache i zmienia wejście wszystkim przebiegom po niej — bez sprawdzenia,
czy zmieniła też wykrywanie. Model jest przypięty do `anthropic/claude-sonnet-4.6` z uzasadnieniem
„porównywalność przebiegów", które jest dobrym powodem, żeby go nie zmieniać po cichu, i żadnym
powodem, żeby nie zmierzyć alternatywy.

Ten plan buduje zestaw promptfoo jadący PRAWDZIWĄ funkcją agenta (tą samą, którą wywołuje CI),
odpowiadający na dwa pytania i tylko na nie: czy zmiana w agencie nie zepsuła wykrywania klasy
błędu, i czy tańszy model wystarcza.

## Starting Point

`agents/review/review.ts` jest DZIŚ skryptem, nie modułem: jeden eksport (typ `FailureKind`),
osiem efektów ubocznych na module scope, top-level `await`, brak jakiegokolwiek testu.
`agents/` leży poza tsconfigiem i ESLintem aplikacji i **nie ma własnej bramki typów** —
zweryfikowane: nie ma tam ani `tsconfig.json`, ani `typescript` w zależnościach.

Pytanie blokujące zostało już zamknięte pomiarem: tanie modele jadą przez ten harness, structured
output wraca, `safeParse` przechodzi. Zmierzony koszt komórki (zimny cache, lokalnie): gemini
0,0323 / haiku 0,0846 / sonnet 0,1935 USD. Z budżetu 1 USD zostało **~0,50 USD**.

## Desired End State

`npm --prefix agents/review run eval` odpala macierz 2 modele × 2 fikstury przez `runReview`
i drukuje tabelę per komórka: werdykt, kontrakt, tokeny, koszt policzony z cennika OpenRoutera
i wiek tego cennika. Powtórzenie bez zmiany promptu jest darmowe. `pr-review.yml` i composite
action działają bez zmiany choćby jednej linii. Pakiet agenta ma bramkę typów w CI z parą dowodową.

## Key Decisions Made

| Decyzja                          | Wybór                                                              | Dlaczego                                                                                                                     | Źródło    |
| -------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------- |
| Co jest testowane                | Prawdziwy `runReview`, nie sam prompt                              | Wariant „goły prompt" byłby ~14× tańszy i testowałby coś, czego CI nigdy nie uruchamia                                       | Wymagania |
| Lokalizacja zestawu              | `agents/review/evals/`                                             | Jedna instalacja SDK, jeden lock, ta sama ścieżka co CI; `evals/` ciągnąłby review na klucz, którego `review.ts` zakazuje    | Plan      |
| Kształt ekstrakcji               | Minimalny szew + cienki CLI                                        | Wrapper za krótki, by zmieścić drugą ścieżkę — to sam jest dowodem                                                           | Plan      |
| Siatka pod refaktor              | Test charakteryzujący na szwach tekstowych, PRZED ekstrakcją       | Bez niego „ekstrakcja nic nie zmieniła" jest deklaracją; dziś `review.ts` nie ma żadnego pokrycia                            | Plan      |
| Fikstura slotu 1                 | `sample.diff` bez zmian                                            | JEDYNY materiał zmierzony na wszystkich trzech modelach po `0d3eba5` — asercje piszemy na zmierzonym                         | Plan      |
| Fikstura slotu 2                 | Kontrola negatywna; pierwszy przebieg to POMIAR, nie bramka        | To najtrudniejszy przypadek naprawy promptu (dwa razy „nie dotyczy") i jest niezmierzony                                     | Plan      |
| Co bramkuje komórkę              | Kontrakt bramkuje, oceny raportują                                 | Rozrzut zmierzony: `scopeDiscipline` 9/3/8 na tym samym materiale — asercja na ocenie byłaby flaky                           | Pomiar    |
| Źródło kosztu                    | Statyczna tabela cennika z DATĄ i ŹRÓDŁEM; raport drukuje jej wiek | `total_cost_usd` z SDK myli się 14× dla gemini; wiek w raporcie czyni nieaktualność niecichą                                 | Pomiar    |
| Cache                            | Własny w providerze, z hashem promptu w kluczu                     | promptfoo nie cachuje customowego providera JS; przy 0,50 USD darmowa powtórka to różnica między 2 a wieloma iteracjami      | Badanie   |
| `REVIEW_MAX_BUDGET_USD` na evale | **0,60** jako bezpiecznik, nie tani sufit                          | Cap liczony cennikiem Anthropica, nie skaluje się z ceną modelu; „nisko" dawało flaky czerwień                               | Pomiar    |
| `llm-rubric`                     | Nie używamy wcale                                                  | Structured output czyni asercje `javascript` darmowymi, a promptfoo nie raportuje kwoty sędziego w ogóle                     | Badanie   |
| Bramka nad `agents/`             | Nowy workflow wzorem `prompt-ratchet.yml`, z filtrem `paths`       | Krok w akcji review milczałby na PR-ze ruszającym tylko `evals/`; hook lokalny to bramka, o której nie wiadomo, czy istnieje | Plan      |
| Budżet                           | Tylko lokalnie; workflow evali do osobnej zmiany                   | ~0,23 USD na fazy 6-7, rezerwa ~0,27 USD na JEDNĄ niespodziankę                                                              | Plan      |

## Scope

**W zakresie:** ekstrakcja `runReview` pod siatką charakteryzującą; bramka typów i testów pakietu
agenta w CI; provider promptfoo z własnym cache'em i własnym rachunkiem kosztu; statyczny cennik
z datą; fikstura kontroli negatywnej; macierz 2×2 na haiku i gemini; pomiar kontroli negatywnej;
pierwsze przejście z zapisem liczb.

**Poza zakresem:** workflow evali w CI (odłożony, z zapisanym długiem); kolumna sonneta;
`sample-injection.diff`; `llm-rubric`; strojenie progu 5; dodatkowi dostawcy; rozszerzanie
macierzy; wbudowany provider `anthropic:claude-agent-sdk`; `tsx` → `dependencies` +
`npm ci --omit=dev` (ma zapisany PRÓG uruchomienia, nie jest wykonywany bez liczby).

## Architecture / Approach

```
agents/review/                        ← osobny projekt npm, własny lock, poza tsconfigiem aplikacji
├── review.ts          CLI wrapper — env, klucz, stdin, stderr, exit. CI woła TO.
├── run-review.ts      runReview(diff, opts) → { review, metrics }.  ← eval woła TO SAMO
├── tsconfig.json      NOWE: bramka typów nad całym pakietem
└── evals/
    ├── provider.ts    klasa ApiProvider → runReview; zwraca cost + tokenUsage + cached
    ├── pricing.ts     statyczne stawki OpenRoutera + PRICING_AS_OF
    ├── cache.ts       klucz = (fikstura, model, hash promptu+schematu); nonce POZA kluczem
    ├── assertions.ts  twarde (kontrakt, verdict, null/number na 7 i 8) + miękkie (oceny)
    └── fixtures/      kontrola negatywna
```

Macierz to iloczyn `providers` × `tests` — ten sam plik providera wpięty dwa razy z różnym
`config.model`. Jedna rzecz, którą promptfoo daje nam realnie, to tabela per komórka w jednym
przebiegu; cache, koszt i tokeny dopisujemy sami, bo customowy provider JS nie dostaje ich za darmo.

## Phases at a Glance

| Faza                          | Co dostarcza                                       | Główne ryzyko                                                              |
| ----------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| 1. Siatka charakteryzująca    | Test CLI przechodzący na NIEZMIENIONYM kodzie      | Asercja pinuje tekst wymyślony przez test, nie ten czytany przez CI        |
| 2. Ekstrakcja `runReview`     | Szew + cienki wrapper; `.github/**` nietknięte     | Cicha zmiana linii stderr, którą grepuje composite action                  |
| 3. Bramka pakietu agenta      | tsconfig + skrypty + nowy workflow z parą dowodową | Filtr `paths` nie sięga plików, których dotyczy                            |
| 4. Szkielet promptfoo         | Provider, cennik, cache + test dwukierunkowy       | **Nieświeży cache wyglądający jak zielona bramka** — ryzyko I kat.         |
| 5. Fikstury i asercje         | Macierz 2×2, kontrola negatywna, raport kosztu     | Kontrola negatywna nie jest czysto tekstowa → `null` przestaje być legalny |
| 6. Pomiar kontroli negatywnej | Dwa przebiegi, ~0,12 USD, zapis wyniku             | Model wystawia liczbę zamiast `null` → poprawka promptu zjada rezerwę      |
| 7. Pierwsze przejście 2×2     | Cztery komórki, tabela, ~0,12 USD                  | Przekroczenie budżetu → zatrzymanie, nie dopłata                           |

**Prerequisites:** klucz `OPENROUTER_REVIEW_KEY` zmapowany na `ANTHROPIC_AUTH_TOKEN` na JEDNO
wywołanie (nigdy `OPENROUTER_EVAL_KEY`, nigdy eksport na stałe); linia bazowa promptu `0d3eba5`;
lokalny Node ≥ 22.22.0 (jest: v24.18.0).

**Estimated effort:** ~3-4 sesje. Fazy 1-5 to praca bez wydatku; fazy 6-7 to ~0,23 USD z ~0,50 USD.

## Open Risks & Assumptions

- **Nieświeży wynik z cache'u to najgroźniejsza rzecz w całym zestawie** — gorsza niż brak
  cache'u, bo znika razem z informacją, że coś zniknęło. Dlatego test cache'u dowodzi dwóch
  kierunków, a kierunek „zmieniony prompt → PUDŁO" dostaje kontrolę pozytywną przez mutację
  funkcji klucza.
- **Rezerwa 0,15-0,27 USD to budżet na JEDNĄ niespodziankę.** Druga oznacza zatrzymanie
  i rozmowę, nie dopłatę — tak stanowi wymaganie 1.
- **DŁUG, zapisany jawnie: workflow evali nie zostanie ani razu uruchomiony w tej zmianie**, więc
  jest gwarancją nieprzetestowaną — dokładnie tą klasą, którą archiwum zapisało przy `concurrency`
  w `eval.yml` jako „never contended". Warunek zamknięcia: osobna zmiana, która dodaje workflow
  wzorem `eval.yml` i **odpala go RAZ, na dowód**.
- **Slot 1 nie jest testem wykrywania klasy defektu**, tylko bramką regresji na „agent nadal widzi
  ten diff jako zły". Klasy z wymagań wchodzą drugim slotem, po pierwszym zmierzonym przejściu.
- Cennik w tabeli statycznej zestarzeje się — mitygacja jest jawna, nie automatyczna: raport
  drukuje jego wiek obok kwot, więc czytelnik sam ocenia, czy ufa liczbie.
- Dodanie promptfoo do devDeps agenta wydłuża `npm ci` na produkcyjnej ścieżce review. Faza 4 to
  mierzy i ma PRÓG (≥ 15 s mediany lub ≥ 25%), po którego przekroczeniu fallback staje się osobną
  zmianą — a poniżej zostaje jawnie skreślony.

## Success Criteria (Summary)

- Jedno polecenie pokazuje macierz 2 modele × 2 fikstury z werdyktem, kontraktem i **kosztem per
  komórka** — a powtórzenie tego samego przejścia nie kosztuje nic.
- Ekstrakcja jest udowodniona, nie zadeklarowana: ten sam test przechodzi po obu jej stronach,
  a `pr-review.yml` i composite action nie zmieniają się o bajt.
- Pakiet agenta ma bramkę w CI z parą dowodową (czerwień → poprawka → zieleń), a nie tylko
  z zieloną deklaracją.
- Całe zadanie mieści się poniżej 1 USD, a liczby na to są w notatce, nie w pamięci.
