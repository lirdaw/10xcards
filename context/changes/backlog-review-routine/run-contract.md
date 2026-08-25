# Kontrakt przebiegu — backlog review

Kontrakt trybu 3 (pętle i rutyny) wg M5L5. Wszystkie decyzje podjęte PRZED startem;
w trakcie przebiegu nikt nie patrzy. Kontrola wraca dopiero przy review PR-a.

## Cel

Dla każdej z 15 pozycji sekcji `## Parked ideas` w `context/foundation/roadmap.md`
(C10X-14…21, 23, 24, 25, 35, 36, 38, 44) ustal jeden werdykt:

| Werdykt               | Znaczenie                                                 | Wymagany dowód                         |
| --------------------- | --------------------------------------------------------- | -------------------------------------- |
| `ZROBIONE MIMOCHODEM` | funkcja istnieje w kodzie, pomysł jest martwy             | ścieżka pliku + linia                  |
| `NADAL AKTUALNY`      | brak w kodzie, założenie z opisu się trzyma               | —                                      |
| `ZDEZAKTUALIZOWANY`   | kod poszedł w stronę, która czyni pomysł bezprzedmiotowym | ścieżka pliku + linia, co się zmieniło |
| `[nieznany]`          | nie da się rozstrzygnąć z repozytorium                    | powód                                  |

Wynik: `context/foundation/backlog-review.md`, nadpisywany co przebieg. Plik jest
wersjonowany, więc `git diff` względem `main` pokazuje **zmianę od ostatniego przeglądu** —
to jest właściwy produkt przebiegu, nie sam raport.

## Zakres

**Edytuj:** wyłącznie `context/foundation/backlog-review.md` (utwórz, jeśli nie istnieje).
**Czytaj:** `context/foundation/**`, `src/**`, `tests/**`, `.github/workflows/**`.
**Nie ruszaj:** `roadmap.md`, kodu produkcyjnego, testów, konfiguracji, migracji.

Agent nie dostaje gita do ręki. Workflow tworzy branch przed jego startem i commituje po —
zakres wymusza środowisko, nie obietnica w promptcie.

## Setup

`npm ci` w fazie przygotowania. Bez `astro build`, bez `supabase start`, bez uruchamiania
aplikacji. Zadanie jest czytające.

## Sieć

**Wymagana:** tylko rejestr npm w fazie setupu.
**W fazie pracy:** nic. Wszystko potrzebne jest w checkoucie.

⚠️ **Znana luka.** GitHub Actions nie daje przełącznika „odetnij sieć po setupie", więc
to ograniczenie jest deklaracją, nie wymuszeniem — inaczej niż w zarządzanym sandboxie
(tryb 2), gdzie granica jest realna. Zapisane jawnie, bo lekcja wymaga wiedzieć, które
granice środowisko faktycznie egzekwuje. Konsekwencja: **nie odpytuj Jiry na żywo** —
opis pozycji bierz z `roadmap.md`, werdykt z kodu. To jedyne miejsce, gdzie sieć mogłaby
cicho wejść do wyniku.

## MCP

Tylko konfiguracja widoczna w repozytorium. Serwery z lokalnego profilu nie istnieją dla
tego przebiegu — i nie są potrzebne, bo zadanie czyta pliki.

## Sekrety

**Jedyny:** `OPENROUTER_BACKLOG_KEY` — osobny klucz OpenRoutera, wyłącznie dla tego
przebiegu, revoke po ćwiczeniu.

Trzeci wpis w istniejącej konwencji „klucz per zastosowanie" (`OPENROUTER_REVIEW_KEY`,
`OPENROUTER_EVAL_KEY`). NIE celuj tym w żaden z tamtych.

**Czego agent NIE dostaje:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, hasła bazy produkcyjnej, tokenu Jiry.
Żadnego z nich zadanie nie potrzebuje — a przebieg bez nadzoru to najgorszy moment na
sekret „na wszelki wypadek".

Uprawnienia workflow: `contents: write` (branch + commit), `pull-requests: write` (PR).
Nic ponadto.

## Warunek stopu

Zatrzymaj się po zapisaniu raportu i podsumowaniu zmian względem `main`.
Limit ~15 tur. Pozycja wymagająca decyzji produktowej → `[nieznany]`, jedź dalej.
**Nie zgaduj i nie pytaj** — nikt nie odpowie.

## Limit kosztu

Jeden przebieg, jeden model, ~15 tur. Klucz o krótkim czasie życia jest tu drugim
hamulcem: nawet zapętlony przebieg ma sufit w postaci salda tego jednego klucza.

## Kryteria sukcesu

- [ ] 15/15 pozycji ma werdykt
- [ ] każde `ZROBIONE MIMOCHODEM` i `ZDEZAKTUALIZOWANY` ma ścieżkę pliku + linię
- [ ] sekcja „Zmiany od ostatniego przeglądu" wymienia różnice albo mówi wprost „brak"
- [ ] `git diff main` dotyczy wyłącznie `backlog-review.md`
- [ ] `[nieznany]` przy najwyżej 3 pozycjach

## Kryteria porażki — zielony przebieg to NIE sukces

Przebieg może zakończyć się bez błędu i nadal być porażką zadania:

1. **Wszystkie 15 = `NADAL AKTUALNY`** → agent nie zajrzał do kodu, przepisał `roadmap.md`.
   Najbardziej prawdopodobna cicha porażka.
2. **Werdykt bez ścieżki pliku** → twierdzenie bez dowodu. Nie do odróżnienia od zmyślenia.
3. **`[nieznany]` przy >3 pozycjach** → zadanie jest źle postawione. To nie agent zawiódł;
   to znaczy, że backlogu nie da się oceniać samym kodem i kontrakt wymaga przerobienia.
4. **Raport identyczny z poprzednim mimo commitów w `src/`** → przebieg nic nie zmierzył.
5. **Diff wychodzi poza `backlog-review.md`** → agent przekroczył zakres; unieważnia całość
   niezależnie od jakości raportu.

Próg z punktu 3 jest świadomym odejściem od reguły M5L3 („`[unknown]` = fail-closed",
`eval-ratchet`). Tam `[unknown]` oznaczał brak dowodu tam, gdzie dowód był możliwy.
Tutaj część pozycji dowodu z kodu mieć nie może — C10X-38 to research o sekretach,
C10X-44 to decyzja produktowa. Fail-closed karałby agenta za uczciwość.

## Checklista review (człowiek, po przebiegu)

1. Otwórz PR, przeczytaj diff — czy dotyczy jednego pliku?
2. Wybierz **dwa** werdykty `ZROBIONE MIMOCHODEM` i sprawdź podane linie. Istnieją?
   Mówią to, co agent twierdzi?
3. Policz `[nieznany]`. Powyżej 3 → przerabiamy kontrakt, nie prompt.
4. Sprawdź rozkład werdyktów. Jednorodny → punkt 1 kryteriów porażki.
5. Przeczytaj log przebiegu: ile tur, jaki model, czy agent próbował wyjść poza zakres.
6. **Zapisz jedną decyzję:** co musiałoby się zmienić, żeby ten tryb był bezpieczny dla
   ośmioosobowego zespołu?

## Trigger

`workflow_dispatch` jako jedyny aktywny. `schedule:` obecny w pliku, ale zakomentowany,
z warunkami odkomentowania.

Precedens w tym repozytorium: `schema-diff.yml` — „an alarm nobody hears is not coverage.
Adding `schedule:` is one line; do it the day a notification channel and an owner exist,
and not before." Ta sama reguła, ten sam powód.
