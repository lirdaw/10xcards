# Rejestr świadomie zostawionych mutantów

Run: 2026-07-18 19:54 · `npx stryker run` · źródło: `reports/mutation/mutation.json`
Zakres mutacji: `src/pages/api/generate.ts`, `src/lib/generations.ts`

Score: **50.00% total / 72.73% covered** — 80 Killed, 30 Survived, 50 NoCoverage,
0 errors, 0 timeout.

Zgodnie z regułą z `CLAUDE.md`: mutacje selektywnie, bez gonienia 100% score.
Każdy mutant poniżej jest zostawiony z decyzji, nie z przeoczenia.

| Kat. | Co to                                        | Ile | Status decyzji        |
| ---- | -------------------------------------------- | --- | --------------------- |
| A    | Ścieżki porażki generacji i zapisu            | 43  | odroczone → F5 / S-05 |
| B    | Wyścig TOCTOU na tworzeniu talii              | 8   | poza Ryzykiem #2      |
| D    | Teksty komunikatów, nagłówki, init zmiennych  | 10  | zostawione NA STAŁE   |
| E    | Mutanty równoważne / nieosiągalne             | 14  | nie do zabicia        |
| F    | Realne tanie luki                             | 5   | świadomie odłożone    |

Kategoria C z pierwotnego podziału (guardy 401/400 jako odroczone) **nie istnieje**:
te guardy zostały pokryte w tej zmianie i są Killed — `:63`, `:75`, `:80` (CE),
`:99`, `:111` (CE→true), wraz z ciałami odpowiedzi `:64`, `:71`, `:76`, `:81`,
`:100`, `:112` (ObjectLiteral).

---

## A. Ścieżki porażki generacji i zapisu — 43

**Powód:** `OPENROUTER_API_KEY` jest nieustawiony, więc `generateCandidates`
short-circuituje do `mockCards` (`src/lib/openrouter.ts:149-158`). Mock nigdy nie
pada, nie przekracza timeoutu i zawsze zwraca poprawne karty. Lokalny Postgres nie
zwraca błędów zapisu na żądanie. Dotknięcie którejkolwiek z tych gałęzi wymaga
**stuba na seamie HTTP albo wstrzyknięcia awarii DB** — czego ta zmiana świadomie
nie wprowadza.

**Odroczone do:** finding F5 (ACCEPTED-AS-RULE) w
`context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108`
oraz roadmap **S-05**.

| Linie                  | Gałąź                                                  | Mutanty              |
| ---------------------- | ------------------------------------------------------ | -------------------- |
| `:58` CE, `:58-59`     | Supabase nieskonfigurowany → 500                       | 1 Survived + 3 NoCov |
| `:96-97`               | błąd odczytu talii → 500                               | 1 Survived + 3 NoCov |
| `:108-109`             | błąd `deckNameExists` → 500                            | 1 Survived + 3 NoCov |
| `:122`                 | ciało `setTimeout` (abort)                             | 1 NoCov              |
| `:128-148`             | timeout/transport → sesja `failed` + **502 retriable** | 1 Survived + 7 NoCov |
| `:159-173`             | pusty wynik modelu → sesja `failed` + **422 retriable** | 1 Survived + 7 NoCov |
| `:210-211`             | `sessionError` → 500                                   | 1 Survived + 3 NoCov |
| `:215-219`             | `cardsError` → 500 + kompensacja                       | 1 Survived + 4 NoCov |
| `generations.ts:29-33` | całe `failGenerationSession`                           | 5 NoCov              |

## B. Wyścig TOCTOU na tworzeniu talii — 8

**Powód:** `:181-184` jest osiągalne tylko wtedy, gdy pre-check nazwy przejdzie,
a `createDeck` mimo to dostanie 23505 — czyli przy dwóch **równoległych** żądaniach.
Sekwencyjnie gałąź jest nieosiągalna z definicji. Test przez `Promise.all` zależałby
od przeplotu event loopa: czasem pokrywałby gałąź, czasem nie. Test flaky jest gorszy
niż mutant jawnie zapisany jako odroczony.

Nie wynika ani z Ryzyka #2 (duplikacja przy retry), ani z żadnego wiersza §2
`test-plan.md`. Ewentualne przyszłe ryzyko „deck management".

`:181` BlockStatement · `:182` ×4 (CE ×2, EqualityOperator, StringLiteral) ·
`:183` ObjectLiteral · `:184` StringLiteral ×2

## D. Teksty komunikatów, nagłówki, init zmiennych — 10 — NA STAŁE

**Powód:** asertujemy **status i zachowanie, nie brzmienie**. Przypięcie polskiej
kopii zamieniłoby suite w lustro implementacji: każda korekta literówki w komunikacie
zapalałaby test na czerwono bez żadnej regresji. To decyzja trwała, nie odroczenie.

`StringLiteral → ""`: `:46` (message w `refine`), `:64` (401), `:71` (400),
`:76` (400), `:81` (400), `:100` (404), `:112` (409)
Nagłówek: `:52` ObjectLiteral + StringLiteral (`Content-Type`)
Init: `:90` `deckPublicIdOut = ""`

## E. Mutanty równoważne / nieosiągalne — 14 — nie do zabicia

**Powód:** zachowanie zmutowane jest **nieodróżnialne** od oryginalnego przez żadną
asercję behawioralną. Żaden test tego nie naprawi.

| Linie              | Dlaczego równoważny                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `:45` ObjectLiteral | usunięcie `message` z `refine` — walidacja nadal odrzuca → to samo 400                                |
| `:70` BlockStatement | puste `catch` — `rawBody` zostaje `undefined`, schema odrzuca → to samo 400                           |
| `:90` (patrz D)    | nadpisywane na `:103` albo `:188` przed użyciem                                                        |
| `:104` CE→true, Block | `refine` gwarantuje dokładnie jedno z pól; pominięcie pre-checku kończy się 409 z 23505             |
| `:111` CE→false, Block | jw. — fast-path i fallback dają **ten sam status i to samo ciało**, a sesja nie powstaje w żadnym  |
| `:114-116`         | gałąź `else` oznaczona w kodzie jako nieosiągalna (3 NoCov)                                            |
| `:149` BlockStatement | `clearTimeout` — wyciek timera, nieobserwowalny z zewnątrz                                          |
| `:190-193`         | defensywny `deckId === null`, każda ścieżka sukcesu go ustawia (1 Survived + 3 NoCov)                  |

## F. Realne tanie luki — 5 — świadomie odłożone

**Powód:** te **da się** zabić zwykłym testem behawioralnym. Nie należą do Ryzyka #2,
więc nie wchodzą w ten wycinek — ale są uczciwie realne, nie równoważne.

| Mutant                          | Co przepuszcza                                                                | Koszt zabicia |
| ------------------------------- | ----------------------------------------------------------------------------- | ------------- |
| `:33` Regex ×2 (usunięcie `^` / `$`) | `deckPublicId` z doklejonym śmieciem przechodzi walidację → 404 zamiast 400 | 1 `it()`      |
| `:40` MethodExpression (`.trim()`) | `newDeckName` z białymi znakami tworzy talię z nieprzyciętą nazwą           | 1 `it()`      |
| `:80` EqualityOperator (`<= 1`) | off-by-one: `sourceText` o długości dokładnie 1 zostałby odrzucony             | 1 `it()`      |
| `generations.ts:22` StringLiteral | `sessionPublicId` w odpowiedzi nie jest asertowany                          | 1 asercja     |
