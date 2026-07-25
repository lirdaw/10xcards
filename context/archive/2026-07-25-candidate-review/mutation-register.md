# Rejestr świadomie zostawionych mutantów

Run: 2026-07-25 13:13 · `npx stryker run --mutate "src/lib/flashcards.ts:181-212"` ·
źródło: `reports/mutation/mutation.json`
Zakres mutacji: **wyłącznie** funkcja przejścia stanu — `ALLOWED_FROM` (`:188-191`)
i `setFlashcardState` (`:204-212`). Stała lista `mutate` w `stryker.config.json`
(`src/pages/api/generate.ts`, `src/lib/generations.ts`) **nie została ruszona** —
zakres zawężony przez CLI, zgodnie z regułą z `CLAUDE.md`.
`OPENROUTER_API_KEY` nieustawiony (generacja w trybie mock).

Score: **100.00% total / 100.00% covered** — 12 Killed, 0 Survived, 0 NoCoverage,
0 errors, 0 timeout.

## Wynik: brak mutantów do zostawienia — ale score jest tu słabym dowodem

Ten rejestr jest z założenia listą **wyjątków**: mutantów zostawionych z decyzji.
Tym razem lista jest pusta — nic nie przeżyło. Ważniejsze jednak jest to, czego
100% tutaj **nie** znaczy, bo przy pierwszym czytaniu raportu wyciągnąłem z niego
za mocny wniosek i zweryfikowanie go ręcznie ten wniosek obaliło.

### Ustalenie: 8 z 12 zabójstw to crash-kille, nie asercje zachowania

Stryker raportuje tylko **pierwszy** test, który padł. Rozwinięcie id z raportu
daje: 11 mutantów zabija test `#16` („writes every edge of the transition table"),
a 1 — test `#17` („matches no row for a move off the graph"). Żaden nie ginie od
testu, który go „tematycznie" dotyczy, więc sprawdziłem dwa najważniejsze ręcznie,
odtwarzając mutację w kodzie i czytając komunikat błędu:

| Mutant                                            | Oczekiwanie             | Co naprawdę się dzieje                                            |
| ------------------------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| `:210` StringLiteral — `.in("state_id", …)` → `""` | asercja bramki          | **`PGRST100`** „unexpected end of input expecting field name" → 6/16 testów pada na błędzie zapytania |
| `:210` ArrayDeclaration — fallback → `["Stryker was here"]` | asercja nielegalnego przejścia | **`22P02`** invalid input syntax for integer → 1/16 pada na błędzie |

Obie mutacje są zabite dlatego, że **psują zapytanie**, a nie dlatego, że suite
zauważa zmianę reguły. Tak samo pozostałe StringLiteral/ObjectLiteral/BlockStatement
(`:204`, `:206`, `:207`, `:208`, `:209`, `:211`): pusta nazwa tabeli, pusty SET,
pusta nazwa kolumny czy pusta projekcja to niepoprawne zapytanie, a nie inna reguła.

**Behawioralne są tylko 4** — te, które zostawiają zapytanie poprawnym i zmieniają
wyłącznie to, *które wiersze pasują*, przez zwinięcie allow-listy do `[]`:
`:188` (`ALLOWED_FROM` → `{}`), `:189`, `:190` (obie tablice → `[]`),
`:210` LogicalOperator (`?? []` → `&& []`).

### Konsekwencja: mutacja nie pokrywa kierunku „bramka za luźna"

Wszystkie cztery behawioralne mutanty psują przejścia **legalne** (allow-lista
pusta → nic się nie rusza). Ani jeden nie sprawia, że przechodzi ruch
**nielegalny** — bo jedyny operator, który mógłby to zrobić, podstawia string,
którego Postgres nie przyjmuje do `smallint`. Innymi słowy: z tego runu **nie
wynika**, że suite złapałby bramkę zbyt permisywną, a to jest ten kierunek błędu,
który realnie szkodzi użytkownikowi (karta wraca do `generated`, odrzucona wraca
sama do talii).

Dowodem na ten kierunek jest **deliberate-breakage wariant 1** z
`context/foundation/test-plan.md` §6.6 — usunięcie całego predykatu
`.in("state_id", ALLOWED_FROM[target])`, po którym zaczerwieniły się dokładnie
asercje nielegalnych przejść i mieszanego batcha, a wszystkie legalne krawędzie
zostały zielone. To jest ręczny check, nie Stryker, i to on niesie tu sygnał.

## Pełna lista 12 mutantów

| Linia  | Mutator          | Podmiana                              | Rodzaj zabójstwa                 |
| ------ | ---------------- | ------------------------------------- | -------------------------------- |
| `:188` | ObjectLiteral    | `ALLOWED_FROM` → `{}`                 | **behawioralne** — allow-lista `[]` |
| `:189` | ArrayDeclaration | `ALLOWED_FROM[accepted]` → `[]`       | **behawioralne**                 |
| `:190` | ArrayDeclaration | `ALLOWED_FROM[rejected]` → `[]`       | **behawioralne**                 |
| `:210` | LogicalOperator  | `?? []` → `&& []`                     | **behawioralne**                 |
| `:204` | BlockStatement   | ciało funkcji → `{}`                  | crash — zwraca `undefined`       |
| `:206` | StringLiteral    | nazwa tabeli → `""`                   | crash — złe zapytanie            |
| `:207` | ObjectLiteral    | `{ state_id: target }` → `{}`         | crash — UPDATE bez SET           |
| `:208` | StringLiteral    | `"public_id"` → `""`                  | crash — `PGRST100`               |
| `:209` | StringLiteral    | `"deck_id"` → `""`                    | crash — `PGRST100`               |
| `:210` | StringLiteral    | `"state_id"` → `""`                   | crash — `PGRST100` (zweryfikowane) |
| `:210` | ArrayDeclaration | fallback → `["Stryker was here"]`     | crash — `22P02` (zweryfikowane)  |
| `:211` | StringLiteral    | projekcja `RETURNING` → `""`          | crash — złe zapytanie            |

## Dlaczego 100% jest tu osiągalne, a gdzie indziej nie było

`setFlashcardState` to mały, czysty builder zapytania bez gałęzi błędu: nie ma w
nim ścieżki wymagającej stuba na seamie HTTP ani wstrzyknięcia awarii DB — a to
było źródłem 43 mutantów kategorii A w poprzednim rejestrze
(`context/archive/2026-07-18-mutation-generate-risk2/mutation-register.md`).
Wynik 100% jest konsekwencją **zakresu i kruchości zapytań**, nie jakości suite'a.
Nie jest powodem, by rozszerzać stałą listę `mutate`, i nie należy z niego
wnioskować o pokryciu czegokolwiek poza tymi 32 liniami.

## Czego ten run NIE pokrywa

- **Kierunku „bramka za luźna"** — patrz wyżej; nosi go deliberate-breakage, nie mutacja.
- **Nic poza zakresem.** Endpoint `/cards/batch`, obie migracje (gate stanu w RPC
  wyszukiwania, zawężenie triggera `updated_at`) i warstwa UI nie były mutowane.
- **Poprawności samego grafu przejść.** To, że nic nie wraca do `generated`, jest
  decyzją produktową; mutacja predykatu nie ma jak jej ocenić.
