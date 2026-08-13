---
project: 10xcards
version: 1
status: draft
created: 2026-07-04
updated: 2026-08-13
prd_version: 1
main_goal: quality
top_blocker: capacity
---

# Roadmap: 10xCards

> Wyprowadzona z `context/foundation/prd.md` (v1) + auto-zbadany baseline bazy kodu.
> Edytuj w miejscu; archiwizuj przy pełnej regeneracji.
> Slice'y poniżej są w kolejności zależności. Tabela "W skrócie" jest indeksem.

## Vision recap

Ręczne tworzenie dobrych fiszek jest wolne i żmudne — to bariera wejścia, która zniechęca
uczących się do metody powtórek rozłożonych w czasie (spaced repetition). 10xCards usuwa
najdroższy krok: generuje kandydatów na fiszki wprost z wklejonego tekstu, a użytkownik
akceptuje/edytuje/odrzuca je, po czym uczy się z zaakceptowanej talii według gotowego
algorytmu powtórek. Cechą wyróżniającą produkt (to, co odróżnia go od zwykłego opakowania
na LLM) jest połączenie generacji AI z ludzką kontrolą przed zapisem oraz prywatność danych
per-konto. Zakład: jakość generacji + prostota, nie własny algorytm harmonogramu.

## North star

**S-03: Użytkownik uczy się talii w sesji SRS** — pełna pętla nauki (wybór kart należnych
dziś, ocena przypomnienia, trwały harmonogram) jest walidacyjnym kamieniem milowym, bo przy
celu `quality` udowadnia najtwardszy guardrail produktu — poprawność i trwałość harmonogramu
powtórek — oraz sekundarne kryterium sukcesu, czyli powrót do kolejnej sesji nauki.

> "North star" (gwiazda przewodnia) = najmniejszy przepływ end-to-end, którego udane
> dostarczenie dowodzi rdzennej hipotezy produktu; plasujemy go tak wcześnie, jak pozwalają
> prerekwizyty, bo reszta ma znaczenie tylko wtedy, gdy ten fragment działa. Tu gwiazda z
> natury wymaga wcześniej istnienia zaakceptowanych kart, więc jej prerekwizytem jest
> minimalna ścieżka tworzenia kart (S-02), warstwa danych (F-01) i rozstrzygnięta decyzja o
> bibliotece SRS (F-02) — dlatego pojawia się zaraz po nich, a nie jako slice pierwszy.

## At a glance

| ID   | Change ID                             | Outcome (użytkownik może …)                                                                                                                            | Prerequisites    | PRD refs                                                                        | Status      |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------- | ----------- |
| F-01 | per-user-data-isolation               | (foundation) twarda izolacja danych per-konto (RLS) + rdzenne tabele                                                                                   | —                | Access Control, Guardrails, NFR: prywatność                                     | done        |
| F-02 | srs-library-choice                    | (foundation) decyzja: gotowa biblioteka SRS + skala oceny przypomnienia                                                                                | —                | Non-Goals (gotowy SRS), Open Questions #2                                       | done        |
| S-01 | deck-workspace                        | tworzyć i nazywać własne talie (prywatna przestrzeń)                                                                                                   | F-01             | US-03, FR-017, FR-001, FR-002                                                   | done        |
| F-03 | verification-harness                  | (foundation) harness testowy + test-plan.md + testy cross-account (talie i fiszki, odczyt i zapis) w CI                                                | S-01             | Guardrails, NFR: trwałość harmonogramu                                          | done        |
| S-02 | manual-card-crud                      | ręcznie tworzyć, przeglądać, edytować i usuwać fiszki w talii                                                                                          | S-01             | US-03, FR-007, FR-008, FR-009, FR-010                                           | done        |
| S-03 | srs-study-session                     | uczyć się talii w sesji SRS z oceną przypomnienia (gwiazda)                                                                                            | F-01, F-02, S-02 | US-02, FR-011, FR-012                                                           | done        |
| S-04 | ai-candidate-generation               | wkleić tekst i wygenerować kandydatów AI z postępem i retry                                                                                            | F-01, S-01       | US-01, FR-003, FR-004, FR-006, FR-018                                           | done        |
| S-05 | candidate-review                      | przeglądać kandydatów i akceptować/edytować/odrzucać (bulk)                                                                                            | S-04             | US-01, FR-005, FR-006                                                           | done        |
| S-06 | deck-keyword-search                   | wyszukiwać fiszki w talii po słowie kluczowym                                                                                                          | S-02             | FR-015                                                                          | done        |
| H-01 | focus-ring-a11y                       | widzieć, gdzie jest focus klawiatury na każdym polu i przycisku (kontrast ≥ 3:1, oba motywy)                                                           | MVP (S-01…S-06)  | NFR: baseline a11y (klawiatura / czytnik ekranu)                                | done        |
| H-02 | srs-study-session-test                | ufać, że każda oceniona karta faktycznie trafia do harmonogramu — także gdy sesja wygasła w tle                                                        | MVP (S-01…S-06)  | Guardrails: poprawność harmonogramu SRS, US-02                                  | done        |
| H-03 | auth-error-copy                       | dowiedzieć się po polsku, czemu logowanie nie wyszło, bez odpowiedzi serwera auth w pasku adresu                                                       | MVP (S-01…S-06)  | FR-001, FR-002, NFR: UI po polsku, Guardrails                                   | done        |
| H-04 | ai-candidate-generation-test-2        | mieć pewność, że wklejony tekst i klucz API nie wyciekają do odpowiedzi błędu ani do logu, a serwer odrzuca żądanie omijające limity z UI              | MVP (S-01…S-06)  | Guardrails: prywatność tekstu źródłowego, NFR: prywatność, FR-003               | done        |
| H-05 | schema-drift-test                     | ufać, że wdrożona aplikacja nigdy nie działa przeciw bazie bez swojej migracji — CI zatrzymuje deploy, zanim Worker wyjdzie                            | MVP (S-01…S-06)  | NFR: dane i harmonogram przeżywają między sesjami, Guardrails                   | done        |
| H-06 | ai-candidate-generation-test-3        | mieć zmierzony dowód (lokalny eval LLM-as-judge na realnym modelu), że generacja oddaje fiszki w języku źródła i nadające się do nauki                 | MVP (S-01…S-06)  | §Success Criteria (75% akceptacji — proxy), NFR: język kart                     | done        |
| H-07 | deck-form-hardening                   | ufać, że serwer odrzuca spreparowaną nazwę talii, a cudzy link nie wyświetli dowolnego tekstu w czerwonym pasku błędu na ekranach talii                | MVP (S-01…S-06)  | FR-017, Guardrails, NFR: UI po polsku                                           | done        |
| H-08 | local-stack-transport-flake           | (harness) ufać, że zielony przebieg testów nie ukrywa podwójnego zapisu — lokalny flake transportowy przestaje być cichym duplikatem                   | MVP (S-01…S-06)  | Guardrails: trwałość danych (pośrednio — wiarygodność harnessu)                 | done        |
| H-09 | deck-error-param-guard                | mieć bramki, które nie wygasają po cichu przy zwykłym refaktorze — zbiór `?error=` egzekwowany u producentów, skan odczytu na całym `src/`             | MVP (S-01…S-06)  | Guardrails, FR-015                                                              | done        |
| H-10 | eval-ci-dispatch                      | uruchomić eval jakości generacji z zakładki Actions — na żądanie, na realnym modelu, bez klucza i bez konfiguracji na czyjejkolwiek maszynie           | MVP (S-01…S-06)  | §Success Criteria (75% akceptacji — proxy), NFR: język kart                     | done        |
| H-11 | typecheck-gate                        | ufać, że zielona gałąź naprawdę się kompiluje — bramka typów w CI i przed pushem, obejmująca `src/`, `tests/`, `evals/`, `scripts/` i `.astro`         | MVP (S-01…S-06)  | §Success Criteria (75% akceptacji — pośrednio: instrument Ryzyka #7)            | done        |
| H-12 | e2e-harness-journeys                  | mieć dowód z prawdziwej przeglądarki, że guard tras chronionych jest ZAMONTOWANY, a zaakceptowana fiszka trafia do talii i przeżywa odświeżenie        | MVP (S-01…S-06)  | §Access Control (trasy fiszek i nauki są zamknięte), FR-005, FR-006             | done        |
| H-13 | test-plan-refresh-2026-08-05          | ufać przewodnikowi testów — `test-plan.md` przestaje twierdzić, że warstwy e2e nie ma, i dostaje fazę, która ma ją dostarczyć                          | MVP (S-01…S-06)  | — (zmiana wyłącznie w dokumentacji testowej; kotwica w PRD wtórna)              | done        |
| H-14 | sentry-monitoring                     | dowiedzieć się, że produkcja się wywróciła, zanim powie o tym użytkownik — błędy z Workera trafiają do Sentry, DSN wyłącznie z sekretu                 | MVP (S-01…S-06)  | Guardrails: prywatność (żaden DSN w repo), NFR: dostępność produktu             | done        |
| H-15 | remove-sentry-probe                   | przestać wystawiać publiczny endpoint, który celowo wywraca Workera — sonda `/api/shipprobe` znika, gdy monitoring jest już potwierdzony na prodzie    | H-14             | Guardrails: prywatność/nadużycie (kwota Sentry), NFR: dostępność produktu       | done        |
| H-16 | bug-generation-compensation-swallowed | kliknąć „Ponów" po nieudanym zapisie kart i naprawdę dostać fiszki — klucz, który raz utknął na trwałym 500, sam się odblokowuje przy następnej próbie | MVP (S-01…S-06)  | FR-018 (ponowienie po awarii generacji), US-01, Guardrails: wiarygodność danych | done        |
| H-17 | bug-generation-deck-undo-swallowed    | dowiedzieć się o pustej talii, którą zostawiło nieudane cofnięcie — zamiast trafić przy „Ponów" na trwałe 409 obwiniające wybraną nazwę                | MVP (S-01…S-06)  | FR-018 (jasny błąd po awarii generacji), US-01                                  | in progress |

Prefiks **`H-` (hardening)** oznacza pracę PO zamknięciu zakresu MVP: `F-01…F-03` i
`S-01…S-06` są `done` i ta granica zostaje nienaruszona. Elementy `H-` nie są vertical
slice'ami — nie mają prerekwizytów, nikogo nie odblokowują i nie wchodzą do `## Streams`
ani do grafu zależności. Źródłem jest Jira (bug / dług / polish), nie PRD; kotwica w PRD
jest wtórna. Mają wiersz tutaj i blok w `## Slices` wyłącznie po to, żeby `/10x-archive`
miał co domknąć — bez tego zamknięty task znika z roadmapy bez śladu w `## Done`.

> **Pułapka tej tabeli:** `/10x-archive` przestawia Status, dopasowując archiwizowaną
> zmianę po `Change ID` — więc **praca wykonana pod cudzym change-id zostawia tu wiersz,
> którego nikt automatycznie nie domknie**. Przykład: cały zakres H-03 wyszedł jako praca
> poboczna pod `ai-candidate-generation-test-2` (C10X-28), a wiersz H-03 czekał na osobną
> zmianę pod własnym `Change ID` — domknęła go dopiero `auth-error-copy` (C10X-34,
> 2026-07-31).

## Streams

Pomoc nawigacyjna — grupuje elementy dzielące łańcuch prerekwizytów. Kanoniczna kolejność
żyje w grafie zależności poniżej; ta tabela to proponowana kolejność czytania między
równoległymi torami.

| Stream | Theme                                | Chain                                        | Note                                                                                                          |
| ------ | ------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A      | Fundament i przestrzeń danych        | `F-01` → `S-01` → `F-03`                     | Izolacja per-user, pierwsza talia, i test cross-account weryfikujący `S-01`; odblokowuje resztę.              |
| B      | Decyzja SRS, karty i nauka (gwiazda) | `F-02` / `S-02` → `S-03`, `S-06` obok `S-02` | Decyzja o bibliotece SRS (`F-02`) i karty ręczne (`S-02`) zbiegają się w gwiazdę `S-03`; odgałęzia od `S-01`. |
| C      | Generacja AI i przegląd              | `S-04` → `S-05`                              | Odgałęzia się od `S-01` (stream A); biegnie równolegle do `S-03`.                                             |

## Baseline

Co jest już w bazie kodu na `2026-07-04` (auto-zbadane + potwierdzone przez użytkownika).
Fundamenty poniżej zakładają, że to istnieje, i NIE budują tego ponownie.

- **Frontend:** partial — strony auth + landing; Tailwind 4 + shadcn-style ui (`src/components/ui/button.tsx`, `src/styles/global.css`). Brak UI fiszek/talii/nauki.
- **Backend / API:** partial — tylko trasy auth (`src/pages/api/auth/{signin,signup,signout}.ts`). Brak endpointów aplikacyjnych (generacja, talie, fiszki, nauka).
- **Data:** absent — `supabase/migrations/` puste; README potwierdza "tylko `auth.users`". Brak tabel Deck / Flashcard / GenerationSession.
- **Auth:** present — Supabase SSR w pełni podpięte (`src/lib/supabase.ts`, `src/middleware.ts` z `PROTECTED_ROUTES=["/dashboard"]`, `locals.user`, e2e signup+signin+confirm-email).
- **Deploy / infra:** present — `wrangler.jsonc` (KV `SESSION`), `.github/workflows/ci.yml` auto-deploy on merge (Node 22).
- **Observability:** partial — tylko wbudowane Cloudflare observability (`wrangler.jsonc`); brak logowania/error-trackingu/metryk w kodzie aplikacji.
  > Skorygowano 2026-08-12 (C10X-53). Zdanie powyżej **nie jest przepisywane**, bo cała sekcja `## Baseline` jest datowanym snapshotem stanu na `2026-07-04` i jako zapis historyczny było prawdziwe. Od tej daty error-tracking w kodzie aplikacji ISTNIEJE: `src/worker.ts` opakowuje handler adaptera w `Sentry.withSentry`. Żywy opis stanu niesie **H-14**, nie ten wiersz.
- **Testy:** absent — brak runnera (vitest/playwright), brak testów, brak `context/foundation/test-plan.md`.

## Foundations

### F-01: Izolacja danych per-konto (RLS) + rdzenny kontrakt danych

- **Outcome:** (foundation) ustanowiona polityka izolacji per-user (Supabase RLS) wraz z minimalnymi rdzennymi tabelami Deck i Flashcard, tak że każdy slice poniżej dziedziczy twardą granicę "żaden użytkownik nie widzi cudzych danych".
- **Change ID:** per-user-data-isolation
- **PRD refs:** Access Control, Guardrails (izolacja danych per-user, prywatność), NFR: prywatność
- **Unlocks:** S-01, S-03 i S-04 bezpośrednio (a pośrednio przez nie S-02, S-05, S-06); redukuje ryzyko "cross-account data leak"; ustanawia kontrakt danych, który weryfikuje F-03.
- **Prerequisites:** — (auth `present` w baseline)
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sekwencjonowana pierwsza, bo cel `quality` nie pozwala odłożyć izolacji za funkcje — błąd tu (wyciek cudzych kart) łamie twardy guardrail. Zakres minimalny: tylko wzorzec RLS + tabele Deck/Flashcard, których potrzebuje S-01/S-02; GenerationSession dochodzi w S-04, pola harmonogramu SRS w S-03 (progresywne odsłanianie). S-01 od razu integruje i ćwiczy tę warstwę realną funkcją.
- **Status:** done

### F-02: Wybór gotowej biblioteki SRS (skala oceny)

- **Outcome:** (foundation) rozstrzygnięta i zaakceptowana decyzja: która gotowa biblioteka spaced-repetition oraz jaka skala oceny przypomnienia — pojedyncza decyzja determinująca pola harmonogramu i skalę oceny dla sesji nauki. Bez kodu produktowego (decyzja typu buy, nie warstwa).
- **Decision (resolved):** Biblioteka SRS = `ts-fsrs` (FSRS-6), MIT, zero zależności — wybór „buy". Skala oceny = 4-stopniowa Again/Hard/Good/Easy. Pola harmonogramu do modelu w S-03: `stability, difficulty, due, state, reps, lapses, last_review`. Domyślne parametry: `request_retention = 0.9`, `maximum_interval = 36500`. Constraint: FSRS-`state` (New/Learning/Review/Relearning) to OSOBNA kolumna niż istniejące `flashcard.state_id` (generated/accepted/rejected) — nie łączyć. Źródło: `context/changes/srs-library-choice/srs-library-research.md`.
- **Change ID:** srs-library-choice
- **PRD refs:** PRD §Non-Goals (gotowy SRS zamiast własnego algorytmu), PRD Open Questions #2 (skala oceny przypomnienia)
- **Unlocks:** S-03 — odblokowuje gwiazdę przewodnią; wybór biblioteki determinuje pola harmonogramu (due / interwał / ease) oraz skalę oceny, których S-03 potrzebuje, by dało się go zaplanować.
- **Prerequisites:** —
- **Parallel with:** F-01, S-01, S-02, F-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Wydzielona z S-03, by jedyna decyzja blokująca gwiazdę stała się jawną, sekwencjonowaną i „ready" jednostką (brak prerekwizytów — można podjąć od razu). Ryzyko: wybór przesądza skalę oceny i pola harmonogramu, więc zła biblioteka = przeróbka S-03. To rozstrzygnięcie buy-vs-build na „buy" (PRD §Non-Goals), nie budowa algorytmu — dlatego foundation, nie slice.
- **Status:** done

### F-03: Harness weryfikacyjny + test-plan (test izolacji)

- **Outcome:** (foundation) skonfigurowany runner testów (Vitest przez `getViteConfig()`) i `context/foundation/test-plan.md` nazywający ryzyka, plus realne testy cross-account ćwiczące guardrail izolacji na zdolności dostarczonej przez S-01 — uruchamiane w CI jako bramka przed deployem.
- **Dostarczony zakres (szerszy niż zakładany):** zakładany był JEDEN test cross-account na taliach; dostarczono odmowę dla konta B na **taliach ORAZ fiszkach**, na **odczycie ORAZ zapisie**, plus kontrolę pozytywną (A sięga po swoje) i przypadek zawierania (własna talia B + id karty A). Świadome poszerzenie: polityki fiszek to osobny mechanizm (`EXISTS`-join po `deck.user_id`), więc testy talii ich nie dowodzą. Testy jadą przez REALNE endpointy (Astro Container API + realne cookie sesji) na realnym lokalnym Postgresie, nie przez SQL-owy test RLS. Uboczny fix produkcyjny: `deleteDeck` dostał `RETURNING`, więc cross-account delete zwraca 404 zamiast redirectu nieodróżnialnego od sukcesu. Odłożone: guard middleware (`PROTECTED_ROUTES`) pozostaje niepokryty.
- **Change ID:** verification-harness
- **PRD refs:** Guardrails (izolacja danych, poprawność SRS), NFR: trwałość harmonogramu
- **Unlocks:** weryfikuje guardrail izolacji per-user ćwiczony przez **S-01** (test cross-account: użytkownik A nie widzi talii użytkownika B). Test poprawności harmonogramu SRS jest jawnie odłożony do **S-03** — powstanie razem z pętlą nauki, gdy będzie co sprawdzać. (Uwaga: to „ścieżka weryfikacji", nie krawędź odblokowująca — F-03 biegnie PO S-01.)
- **Prerequisites:** S-01
- **Parallel with:** F-02, S-02, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sekwencjonowana PO S-01, bo test izolacji nie ma czego sprawdzać, dopóki nie istnieje pierwsza realna zdolność per-user (tworzenie talii). Zakres świadomie minimalny przy `top_blocker=capacity`: harness + `test-plan.md` (wymagany deliverable z shape-notes) + jeden test izolacji; test SRS dochodzi z S-03. Nie kompletuje "warstwy testów" z góry.
- **Status:** done

## Slices

### S-01: Talie jako prywatna przestrzeń robocza

- **Outcome:** użytkownik po zalogowaniu tworzy i nazywa własne talie i widzi je jako prywatną przestrzeń.
- **Change ID:** deck-workspace
- **PRD refs:** US-03, FR-017, FR-001, FR-002
- **Prerequisites:** F-01
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Pierwszy pionowy slice, który stawia bramkowane auth (present) w realnym użyciu produktowym i ćwiczy izolację z F-01; mały zakres ogranicza ryzyko. Zła granica per-user tutaj ujawni się natychmiast — i jest łapana testem z F-03, który powstaje zaraz po tym slice.
- **Status:** done

### S-02: Ręczne CRUD fiszek w talii

- **Outcome:** użytkownik ręcznie tworzy fiszkę (front/back), przegląda listę fiszek w talii, edytuje i trwale usuwa dowolną fiszkę.
- **Change ID:** manual-card-crud
- **PRD refs:** US-03, FR-007, FR-008, FR-009, FR-010
- **Prerequisites:** S-01
- **Parallel with:** F-02, F-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Najtańsza ścieżka do istnienia kart nadających się do nauki (karty ręczne wchodzą w standardowy cykl statusów), więc odblokowuje gwiazdę S-03 bez czekania na gałąź AI. Reject ≠ delete — dwie odrębne operacje, pilnować spójności ze statusem.
- **Status:** done

### S-03: Sesja nauki SRS (gwiazda przewodnia)

- **Outcome:** użytkownik rozpoczyna sesję nauki, w której gotowy algorytm SRS wybiera karty należne dziś, ocenia przypomnienie na każdej karcie, a harmonogram przeżywa między sesjami (żadna karta nie ginie, harmonogram się nie psuje).
- **Change ID:** srs-study-session
- **PRD refs:** US-02, FR-011, FR-012
- **Prerequisites:** F-01, F-02, S-02
- **Parallel with:** S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Gwiazda przy celu `quality`; plasowana tak wcześnie, jak pozwalają prerekwizyty (po S-02 i po decyzji F-02). Decyzja o bibliotece SRS i skali oceny żyje teraz w F-02 (prereq), więc slice jest w pełni planowalny, gdy F-02 i S-02 są gotowe — nie jest już `blocked`. Test poprawności harmonogramu (na harness z F-03) jest tu twardym warunkiem odbioru.
- **Status:** done

### S-04: Generacja kandydatów AI z wklejonego tekstu

- **Outcome:** użytkownik wkleja tekst źródłowy (do zdefiniowanego maksimum), uruchamia generację AI z widocznym postępem, a przy błędzie/timeoucie widzi jasny komunikat i może ponowić; kandydaci trafiają do bazy ze statusem `generated`, powiązani z sesją generacji.
- **Change ID:** ai-candidate-generation
- **PRD refs:** US-01, FR-003, FR-004, FR-006, FR-018
- **Prerequisites:** F-01, S-01
- **Parallel with:** F-02, F-03, S-02, S-03, S-06
- **Blockers:** —
- **Unknowns:**
  - Wybór dostawcy/modelu LLM (np. OpenRouter) generującego dobrze w językach użytkowników (PL + inne). Owner: downstream stack step. Block: no.
  - Maksymalna długość tekstu źródłowego (OQ#1) i liczba kart na generację (OQ#3) — tuning, sensowne domyślne wartości możliwe. Owner: downstream stack step. Block: no.
- **Risk:** Rdzeń tezy produktu (metryka 75% akceptacji), ale świadomie za gwiazdą SRS zgodnie z Twoim wyborem north star. Wprowadza tabelę GenerationSession pod tym slice'em (progresywne odsłanianie). Ryzyko: jakość generacji i responsywność (guardrail ~200 ms / >2 s). **Obsługa błędu/timeout + retry (FR-018) jest twardym kryterium odbioru („done") tego slice'a, nie osobnym przyrostem — przy celu `quality` ścieżka błędu jest częścią ukończenia generacji.**
- **Status:** done

### S-05: Przegląd i kuracja kandydatów

- **Outcome:** użytkownik przegląda wygenerowanych kandydatów i akceptuje, edytuje lub odrzuca każdego — pojedynczo albo zbiorczo (bulk); zaakceptowane karty stają się częścią talii nadającą się do nauki. Slice zamknął też dwa długi przypisane mu z nazwy przez wcześniejsze slice'y: filtr stanu w wyszukiwarce S-06 (tylko `accepted`) oraz idempotencję generacji (impl-review F5 z S-04) — „Ponów" po timeoucie klienta odtwarza zapisaną sesję zamiast dopisywać drugi komplet kandydatów, czym domyka Risk #2 z test-plan.md.
- **Change ID:** candidate-review
- **PRD refs:** US-01, FR-005, FR-006
- **Prerequisites:** S-04
- **Parallel with:** S-03, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Domyka pętlę generacji do statusu `accepted` (druga połowa US-01) i wprost produkuje metrykę akceptacji. Bulk vs pojedyncza akcepta — pilnować, by tryb zbiorczy nie omijał kontroli per-karta, która daje metrykę.
- **Status:** done

### S-06: Wyszukiwanie fiszek w talii po słowie kluczowym

- **Outcome:** użytkownik wpisuje frazę i zatwierdza (Enter); dopasowanie to proste wyszukiwanie podłańcucha w `front` i `back` kart w danej talii.
- **Change ID:** deck-keyword-search
- **PRD refs:** FR-015
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Mały, samodzielny slice odczytu; celowo bez rankingu i bez live-as-you-type (to FR-019, parked). Niskie ryzyko; dobry kandydat na tor równoległy przy ograniczeniu przepustowości.
- **Status:** done

### H-01: Globalny focus ring na współdzielonych kontrolkach (post-MVP)

- **Outcome:** (hardening) użytkownik nawigujący klawiaturą widzi wyraźny, kontrastujący focus ring na input/button/select/textarea w obu motywach — ring pokazuje się tylko na `:focus-visible`, nie po kliknięciu myszą.
- **Change ID:** focus-ring-a11y
- **PRD refs:** NFR (baseline dostępność klawiatury i czytnika ekranu)
- **Prerequisites:** — (dotyczy shellu w poprzek wszystkich widoków; nic nie odblokowuje)
- **Parallel with:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Defekt globalny, nie per-widok. Przyczyna ZMIERZONA (nie ta z ticketu): `ring-*` mapuje się na realny `box-shadow` poprawnie — problem jest w wartości tokena `--ring`, który zasila naraz `ring-*` na prymitywach ORAZ `outline-color` na `*`. Aplikacja renderuje się stale ciemno (`bg-cosmic`), a wariant `dark` nigdy się nie aktywuje, więc obowiązują tokeny motywu JASNEGO: 43 z 48 kontrolek mierzyło 2,3–2,7:1 wobec wymaganych 3:1. Druga część defektu to trzy lokalne łatki narosłe wokół zbyt słabej wartości domyślnej. Fix idzie w jedno miejsce — nie łatać per widok. Poza zakresem: model SELEKCJI elementów (widoczny obrys zaznaczonego wiersza), który należy do C10X-16. Brak automatycznej ochrony przed regresją: projekt nie ma narzędzia visual-diff ani żadnego oraklu czytającego styl WYLICZONY — patrz `test-plan.md` §7; dowodem jest pomiar w `context/archive/2026-07-25-focus-ring-a11y/verification.md`. (Zdanie brzmiało „projekt nie ma warstwy e2e ani visual-diff" i połowa o e2e przestała być prawdą 2026-08-09 wraz z H-12; poprawiona jest wyłącznie ta połowa, bo druga trzyma się nadal, a wyłączenie z §7 stoi na niej — przeglądarkowy runner nie jest oraklem na styl wyliczony.)
- **Status:** done

### H-02: Ciche gubienie ocen w sesji nauki + luki w pokryciu harmonogramu (post-MVP)

- **Outcome:** (hardening) użytkownik, którego sesja wygasła lub została unieważniona w tle, NIE przechodzi całej sesji nauki w przekonaniu, że się uczy — zamiast cichego awansu karty widzi błąd, a harmonogram nie gubi ocen. Do tego harmonogram zyskuje pokrycie tych obietnic, których dotąd nikt nie sprawdzał: rozmiar sesji brany z talii, powrót karty gdy nadejdzie `due`, i ocena „Again".
  **Dostarczone (2026-07-26):** defekt naprawiony po obu stronach — middleware odpowiada wołającemu JSON-em (`401`) zamiast redirectu na HTML, a decyzja „czy się udało" wyszła z wyspy do czystej funkcji `readJsonResponse` (`src/lib/http.ts`); dzięki temu własne `401` trzech endpointów są po raz pierwszy osiągalne na produkcji. Rozstrzygnięcie `Unknowns` (zakres F1): **oba** — z tym że guard rozróżnia **wołającego, nie ścieżkę**, bo sześć chronionych `/api/*` to cele natywnych formularzy i muszą zachować redirect. Pokrycie: `session_size` → `p_limit` wraz z granicami capa, powrót karty dokładnie gdy nadejdzie `due` (z połową negatywną), wszystkie cztery oceny łącznie z lapsem po `Again`, oraz pierwszy test guardu middleware (`tests/middleware.test.ts`). Suite 69/69 → **109/109**. Ryzyko #3 w `test-plan.md` domknięte w obu połowach, §3 Faza 4 `reopened` → `complete`.
  Zakres poszerzony w trakcie o trzy pozycje, które audyt zapisał jako „nienaprawiane": licznik `reviewed` liczy teraz realne przejścia zamiast każdej odpowiedzi `200`, `scheduled_days` przestało być kolumną tylko-do-zapisu (higiena — **nie** ta sama klasa co `learning_steps`, bo ts-fsrs tej wartości nigdzie nie czyta), a zablokowana sesja dostała „Pomiń kartę" przy `404`. Świadomie **nieznalezione wcześniej i zostawione otwarte**: brak asercji na sam tie-break `f.id asc` (test pilnuje kolejności batcha, nie obecności klauzuli) oraz to, że czteropolityczny neuter z §6.6 przestał działać na urośniętej bazie deweloperskiej — obie luki opisane w `test-plan.md`, nie zamiecione pod status.
- **Change ID:** srs-study-session-test
- **PRD refs:** §Guardrails (poprawność harmonogramu SRS), §NFR (harmonogram przeżywa między sesjami), US-02
- **Prerequisites:** — (defekt w istniejącej wyspie sesji + shell; nic nie odblokowuje)
- **Parallel with:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Blockers:** —
- **Unknowns:** decyzja zakresu dla F1 — naprawa w middleware (401 JSON dla `/api/*`, dotyka shellu, naprawia trzy endpointy naraz) czy w kliencie (`res.redirected` / parse-before-ok w `rate()`, zostaje w slice'ie), czy oba. Do rozstrzygnięcia w `/10x-plan`, PRZED budową.
- **Risk:** Ticket przepisany po pełnym audycie — pierwotnie prosił o trzy testy Ryzyka #3, które JUŻ istnieją (dostarczył je S-03, suite 69/69 potwierdzony uruchomieniem). Realne znalezisko jest inne i cięższe: `StudySession.tsx:174` sprawdza tylko `!res.ok`, a middleware odpowiada endpointowi JSON redirectem HTML — `fetch` podąża, `/auth/signin` zwraca 200, więc karta się przewija bez zapisu. Trafia wprost w Outcome S-03 („żadna karta nie ginie"), którego druga połowa nigdy nie miała testu: żadne wywołanie `listDueCards` nie przesuwa zegara w przyszłość. Poza tym `session_size` jest podpięte do limitu batcha, ale każdy test przekazuje literał `20` — setter udowodniony, czytelnik nie. Świadomie poza zakresem (zapisane, nienaprawiane): write-only `scheduled_days` (ta sama klasa co bug `learning_steps`, dziś bezczynna tylko dzięki `enable_short_term: false`), maskarada stanu pustego przy braku sekretu, brak obsługi klawiatury w wyspie. Dowód i pełna lista: `context/changes/srs-study-session-test/research.md`.
- **Status:** done

### H-03: Copy błędów logowania + ujawnianie stanu generacji anonimowi (post-MVP)

- **Outcome:** (hardening) użytkownik, któremu nie udało się zalogować lub zarejestrować, dowiaduje się po polsku, co poszło nie tak i co z tym zrobić — a to, co odpowiedział serwer uwierzytelniania, nie trafia do jego paska adresu, historii przeglądarki ani do logu dostępowego. Do tego anonimowy odwiedzający przestaje być informowany, czy generacja AI działa naprawdę, czy w trybie mock.
- **Change ID:** auth-error-copy
- **PRD refs:** FR-001, FR-002, §NFR (interfejs po polsku), §Guardrails (prywatność — rozszerzająco: chodzi o dane uwierzytelniania, nie o wklejony tekst)
- **Prerequisites:** — (dwie trasy auth + layout; nic nie odblokowuje)
- **Parallel with:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Blockers:** —
- **Unknowns:** czy walidacja po stronie serwera tras auth (`signin.ts`/`signup.ts` nie sprawdzają dziś niczego przed wywołaniem supabase-js) wchodzi w zakres. **Właścicielem tej decyzji jest C10X-30** (Ryzyko #6, „serwer ufa klientowi"), nawet jeśli ten element jest najtańszym miejscem wykonania, bo i tak przepisuje oba pliki. Nie wciągać bez uzgodnienia.
- **Risk:** Nie jest to samodzielne odkrycie — wypadło z framingu C10X-28 (Ryzyko #4) jako jedyne miejsce w repo, gdzie prywatne dane naprawdę uciekają: `signin.ts:16` i `signup.ts:16` przekazują `error.message` z GoTrue **dosłownie** do `?error=`. Wartość renderuje się escapowana (`ServerError.tsx:13`), więc to nie XSS — ale ląduje w URL, a copy GoTrue interpoluje podany adres e-mail (`Email address %q is invalid`), zaś auth-js na nierozpoznanym kształcie odpowiedzi robi `JSON.stringify(err)`. Dwie pułapki wykonawcze, obie zapisane: mapper musi kluczować na `error.name`/`code`/`status` i typować parametr **strukturalnie**, bo `@supabase/auth-js` **nie jest zadeklarowaną zależnością** (tranzytywna, a root `@supabase/supabase-js` nie reeksportuje ani `AuthError`, ani type guardów); bramkę bannera trzeba założyć **per wpis, nie per blok**, bo przy nieskonfigurowanym Supabase `locals.user` jest zawsze `null` i ostrzeżenie o zepsutym Supabase ukryłoby samo siebie. Weryfikacja ręczna przypadku „adres już zarejestrowany" jest osiągalna **tylko lokalnie** (`enable_confirmations = false`); na produkcji GoTrue celowo odpowiada 200 bez błędu (anty-enumeracja).
- **⚠️ ZAKRES TEGO ELEMENTU JEST JUŻ ZAIMPLEMENTOWANY — nie buduj go od nowa (impl-review F3, 2026-07-26).** Cały H-03 — mapper `src/lib/auth-errors.ts` + obie trasy auth (`b0ab625`) oraz bramka bannera per wpis (`34e8837`) — wyszedł na gałęzi **`C10X-28-ai-candidate-generation-test-2`**, jako Faza 1 i Faza 4 §1 zmiany `ai-candidate-generation-test-2`. Wszystkie commity noszą scope `(C10X-28)`, więc **`git log` nie wspomina C10X-34 ani `auth-error-copy`** i ten wiersz jest jedynym miejscem, gdzie ta atrybucja jest widoczna z roadmapy. Ta linia zastępuje wcześniejszą instrukcję „podnieś Fazę 1 i 4 §1 dosłownie", która po zamknięciu tamtej zmiany kazałaby zaimplementować kod już istniejący. Dowód i pułapki wykonawcze (opisane wyżej — one nadal są prawdziwe i warto je przeczytać przed dotknięciem tych plików): `context/changes/ai-candidate-generation-test-2/verification.md` § Faza 1 i § Faza 4, po archiwizacji `context/archive/2026-07-26-ai-candidate-generation-test-2/`. **Uzupełnienie z 2026-07-31 (C10X-34, `auth-error-copy`):** atrybucja do C10X-28 nadal obowiązuje dla mappera i bramki bannera, ale „cały H-03" było już wtedy nieprecyzyjne — praca uboczna pod obcym kluczem zostawiła krawędzie, które domyka ta zmiana, pod tym `Change ID`: sześć nowych kodów GoTrue (w tym `anonymous_provider_disabled`, czyli najczęstszy zwykły błąd, który wcześniej wpadał do catch-alla), egzekwowanie zbioru zamkniętego po stronie ODCZYTU `?error=` wraz z czyszczeniem parametru z URL-a, pierwsze automatyczne pokrycie decyzji bramki bannera (`visibleConfigStatuses`), `role="alert"` + `aria-invalid`/`aria-describedby`/`autocomplete` na powierzchni auth oraz usunięcie jedynego w `src/` odczytu `import.meta.env`. Dowód: `context/changes/auth-error-copy/verification.md`, po archiwizacji `context/archive/<data>-auth-error-copy/`. **Konsekwencja dla wiersza statusu poniżej (impl-review C10X-34, F5): jego uzasadnienie jest już nieaktualne.** Twierdzi, że `/10x-archive` tego wiersza nie przestawi, bo praca wyszła pod innym `Change ID` — a `Change ID` tego elementu to `auth-error-copy` i **ta zmiana niesie dokładnie ten id**, więc archiwizacja go dopasuje i przestawi normalnie. Wiersz statusu zostaje nietknięty świadomie: należy do `/10x-archive`, które przepisuje go w całości razem z tym uzasadnieniem. Ta klauzula istnieje po to, żeby czytelnik między dziś a archiwizacją nie wziął tamtego zdania za fakt — i celowo nie powtarza dosłownego tokenu tego wiersza, żeby nie tworzyć drugiego celu dopasowania dla archiwizacji.
- **Status:** done

### H-04: Brak wycieku tekstu źródłowego i klucza API + parytet walidacji serwera (post-MVP)

- **Outcome:** (hardening) użytkownik, któremu generacja padła, dostaje komunikat, w którym nie ma ani jego wklejonego tekstu, ani odpowiedzi dostawcy LLM, ani klucza API — a serwer odrzuca żądanie omijające limity, które wymusza UI, zamiast je zapisać.
  **Dostarczone (2026-07-26):** własność „brak wycieku" na `/api/generate` **już zachodziła z konstrukcji** i nie była nigdzie asertowana — teraz jest, na obu gałęziach błędu, za pierwszym w projekcie doublem modułu (`astro:env/server`, nigdy `@/lib/openrouter`, bo to unieważniłoby połowę roszczenia). Domknięte zostały dwie powierzchnie, gdzie dane naprawdę wyciekały: dosłowne przekazywanie komunikatu serwera auth do URL-a oraz cztery prywatne kolumny audytowe `generation_session` bez testu cross-account. Doszedł też pierwszorzędny strażnik `console.*` nad całym `src/`. Suite 166/166.
- **Change ID:** ai-candidate-generation-test-2
- **PRD refs:** §Guardrails (prywatność tekstu źródłowego), §NFR (prywatność), FR-003
- **Prerequisites:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Ryzyko #4 z `test-plan.md` domknięte z nazwaną granicą: **żaden test nie czyta realnego sinka logów**, a linie logowane przez zależności są w zakresie ryzyka, lecz nieobjęte właścicielstwem. Połowa Ryzyka #6 (treść fiszek, `FRONT_MAX`/`BACK_MAX`) świadomie poza zakresem — to jedyna rzecz między §3 Fazą 2 a `complete`, właścicielem jest C10X-30.
- **Status:** done — **wpis uzupełniony wstecz 2026-07-28, nie zapisany przez `/10x-archive`.** Zmiana została zarchiwizowana 2026-07-26 (`fed0bdf`), gdy tego wiersza jeszcze nie było, więc archiwizacja nie miała czego domknąć i praca zniknęła z roadmapy — dokładnie tak, jak ostrzega nota pod tabelą `## At a glance`. Wiersz odtworzono na podstawie `context/archive/2026-07-26-ai-candidate-generation-test-2/`. Uwaga na zazębienie z **H-03**: copy błędów auth (C10X-34) wyszło wewnątrz tej właśnie zmiany, więc te dwa elementy opisują częściowo tę samą dostawę z dwóch stron.

### H-05: Bramka CI na dryf schematu bazy wobec historii migracji (post-MVP)

- **Outcome:** (hardening) użytkownik nigdy nie trafia na aplikację działającą przeciw bazie, której brakuje migracji z wdrożonego kodu — CI zatrzymuje deploy, zanim Worker wyjdzie, zamiast pozwolić mu wystartować i wywalić się na pierwszym zapisie.
  **Dostarczone (2026-07-28):** job `drift` między `ci` a `deploy`, porównujący **wersje** migracji z repo z `supabase_migrations.schema_migrations` przez Supabase Management API; `deploy` dostał `needs: [ci, drift]`. Świadomie **oracle historii, nie diff DDL**: incydent stojący za tym ryzykiem to desync po `migration repair`, który zostawił schemat bajt w bajt identyczny — diff DDL by go nie zobaczył. Klasy „po stronie treści" pokrywa osobny workflow `schema-diff` na `workflow_dispatch` (bez crona, bo nie ma kanału powiadomień). Przy okazji: usunięte fantomowe sekrety z kroku build i bramka na nieaktualne `src/db/database.types.ts`. Suite 166 → **178/178**.
- **Change ID:** schema-drift-test
- **PRD refs:** §NFR (fiszki i harmonogram przeżywają między sesjami), §Guardrails
- **Prerequisites:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Ryzyko #5 domknięte **per klasa dryfu, nie hurtem** — klasy 1–3 blokują deploy, klasa 8 gated w jobie `ci`, klasy 4–6 wykrywalne wyłącznie poza ścieżką deployu, klasy 7 i 9 niepokryte w ogóle. Impl-review znalazł w samej bramce fałszywy zielony (dwa pliki migracji o tym samym timestampie czytały się jako `clean`) — naprawione i pokryte testem. Bramka DDL działa end-to-end, ale **nikt nie ma jej w harmonogramie**: brakuje kanału powiadomień i właściciela, nie zdolności.
- **Status:** done

### H-06: Ewaluacja jakości generacji AI — LLM-as-judge (post-MVP)

- **Outcome:** (hardening) zespół ma zmierzony, powtarzalny dowód, że wygenerowane fiszki wychodzą w języku tekstu źródłowego i nadają się do nauki: lokalny eval LLM-as-judge (`npm run eval`, osobna ścieżka uruchomienia — nigdy część `npm test`) przepuszcza 10-przypadkową macierz językową przez produkcyjne `generateCandidates()` na realnym modelu i ocenia każdą kartę sędzią z INNEJ rodziny modeli (`google/gemini-2.5-flash` vs `openai/gpt-4o-mini`).
  **Dostarczone (2026-07-29):** pierwszy skalibrowany przebieg był uczciwie czerwony i znalazł REALNY defekt: ścieżka wymuszonego języka odpowiada po polsku dla `niemiecki`/`francuski` (polski egzonim w angielskim zdaniu promptu; 0/5 w czterech z czterech przebiegów), podczas gdy `auto` jest bezbłędne (25/25) — to eval robiący swoją robotę, nie jego awaria. Pierwsze pomiary dwóch uśpionych metryk: count compliance 100%, skip-rate 0%. Suite deterministyczny urósł o testy progów scoringu (`tests/lib/eval-scoring.test.ts`) i o przypadek kolumn audytowych udanej generacji (dług nazwany przez C10X-28) — 220/220, 18 plików. Ryzyko #7 w `test-plan.md` domknięte na tyle, na ile proxy może; §3 Faza 5 `complete`.
- **Change ID:** ai-candidate-generation-test-3
- **PRD refs:** §Success Criteria (≥75% akceptacji — eval jest proxy, NIE mierzy tej metryki), §NFR (fiszki w języku materiału użytkownika: PL/EN/ES…)
- **Prerequisites:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sędzia mierzy wierność językową i użyteczność, nigdy wskaźnika 75% akceptacji — ten produkują wyłącznie realni użytkownicy na ekranie przeglądu. Dwa jawnie nazwane follow-upy do zaticketowania (`/jira-backlog-sync`): (1) naprawa promptu wymuszonego języka — kandydat: nazwać język docelowy po angielsku lub natywnie (`German`/`Deutsch`), z tym evalem jako testem odbioru; (2) odroczona noga `workflow_dispatch` (idiom `schema-diff.yml`, sekrety per-step, OSOBNY klucz OpenRouter z niskim limitem kredytów jako ogranicznik szkód) — eval zostaje świadomie lokalny i uruchamiany ręcznie, bez harmonogramu, bo alarm, którego nikt nie słyszy, to nie pokrycie (ta sama reguła co diff DDL w §5 test-planu). Uwaga operacyjna: `npm run eval` kończy się dziś kodem **1** — to bramka świecąca na czerwono na realnym defekcie, nie awaria evala.
- **Status:** done

### H-07: Utwardzenie formularzy talii + bramka `?error=` na ekranach talii (post-MVP)

- **Outcome:** (hardening) użytkownik nie może spreparowanym żądaniem ominąć reguły nazwy talii, którą wymusza UI, a spreparowany link nie wyświetli mu dowolnego tekstu wewnątrz czerwonego paska błędu tej aplikacji — komunikat, za który aplikacja nie ręczy, degraduje się do braku paska zamiast do paska z cudzą treścią.
  **Dostarczone (2026-07-31):** dwa endpointy talii, które przeoczył sweep C10X-30, czytają teraz `formData()` w `try` i zwężają części przez `formString`; zamknięty zbiór jedenastu komunikatów (`src/lib/redirect-errors.ts`) plus `ownedRedirectMessage` — przynależność przez RÓWNOŚĆ, `null` na czymkolwiek innym; sześć ujść na trzech stronach talii przepiętych na helper, w tym jedno renderujące wartość w surowym znaczniku `.astro`, którego żadna zmiana w `ServerError.tsx` nigdy by nie pokryła. Para przebiegów zepsucia rozdzieliła warstwę endpointu od `deck_name_check` w obie strony. Suite 298/298 → 314/314 po impl-review.
- **Change ID:** deck-form-hardening
- **PRD refs:** FR-017 (talie), §Guardrails (izolacja i zaufanie do komunikatów), §NFR (UI po polsku)
- **Prerequisites:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Zakres C10X-40 (strona ODCZYTU) dostarczono pod tym kluczem świadomą decyzją zakresową — jeden mechanizm, jeden folder zmiany. Połowa wyspowa (guard 1..100 w `CreateDeckModal`/`DeckActions`) pozostaje nieasertowana jak każda wyspa (§7 test-planu), a bezimienne odmowy CREATE nie mają orakla wierszowego i nic nie przypisują żadnej warstwie.
- **Status:** done

### H-08: Cichy podwójny zapis pod lokalnym flakiem transportowym (post-MVP)

- **Outcome:** (hardening) zespół przestaje czytać zielony przebieg testów jako dowód, że nic się nie zdublowało: powtórzone żądanie zapisu, które lokalny wrapper transportowy absorbuje, przestaje przechodzić niezauważone przez asercje.
  **Dostarczone (2026-08-01):** eksperyment wymuszający po jednym replayu na każde lokalne żądanie nie-`GET` wykazał **sześć** cichych szwów (nie dwa, jak zakładał odczyt kodu) przy 23 z 29 plików niczego nie zauważających; każdy dostał licznik zawężony do przypadku, pisany test-first, a powtórzony census raportuje **zero**. Zmierzono też mechanizm samego flake'a: oba timeouty keep-alive to 60 s (RÓWNE — przypadek patologiczny, nie zła kolejność), a spadki klastrują się w pierwszych 1-2 s serii. Lokalnie przyczyna usunięta przez odtworzenie kontenera Kong bez puli — niewspierane, per-maszyna, ścierane każdym `supabase stop`.
- **Change ID:** local-stack-transport-flake
- **PRD refs:** §Guardrails (trwałość danych) — pośrednio: przedmiotem jest wiarygodność harnessu, nie zachowanie produktu
- **Prerequisites:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Cisza jest dowiedziona wyłącznie dla szwów istniejących w dniu censusu — helper dopisany jutro bez licznika to nowy cichy szew i **nic tego nie wykrywa automatycznie**. Krok w CI jest parytetem, nie koniecznością (`continue-on-error`), więc zielony job `ci` nie implikuje, że przeszedł.
- **Status:** done

### H-09: Bramki `?error=`, które nie wygasają po cichu (post-MVP)

- **Outcome:** (hardening) reguły chroniące kanał `?error=` przestają być zaczepione o pisownię, a stają się zaczepione o konstrukcję: zbiór komunikatów jest egzekwowany w miejscu, gdzie wartości do niego wchodzą (a nie tylko tam, gdzie stoi literał obok napisu `error=`), a skan strony odczytu obejmuje każdy plik `.astro` w `src/`, nie tylko `src/pages/`.
- **Change ID:** deck-error-param-guard
- **PRD refs:** §Guardrails (zaufanie do komunikatów aplikacji), FR-015 (limit długości frazy wyszukiwania)
- **Prerequisites:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Audyt otwierający tę pozycję potwierdził, że merytoryczny zakres C10X-40 był już dostarczony pod H-07 — więc jej zawartością jest trwałość bramek i księgowość, nie ponowna naprawa luki. `?q=` zbadano i **świadomie nie objęto** zbiorem wouchującym: odbicie żyje wyłącznie na `/decks/<publicId>`, która zwraca twarde 404 dla cudzej talii, więc atak wymagałby UUID-a talii ofiary; został sam limit długości jako higiena.
- **Status:** done

### H-10: Eval jakości generacji uruchamiany z CI na żądanie (post-MVP)

- **Outcome:** (hardening) instrument, który do tej pory żył wyłącznie na maszynie jednej osoby, staje się zdolnością projektu: każdy z prawem zapisu wchodzi w zakładkę Actions, uruchamia **Generation quality eval**, opcjonalnie podmienia model generatora albo sędziego, i po kilku minutach czyta 11-wierszową tabelę werdyktu w logu zadania — bez klucza OpenRouter, bez `npm ci` i bez lokalnego stacka u siebie. Pełny zapis (każda karta, każdy werdykt i uzasadnienie sędziego, plus surowy strumień konsoli) wisi przy przebiegu jako artefakt nazwany numerem próby, więc reguła kalibracyjna „czerwony przypadek powtarza się raz, zanim się w niego uwierzy" zostawia oba przebiegi obok siebie. Eval zapisuje przy okazji swój raport na dysk także lokalnie — jedna ścieżka kodu, więc CI nie ma gałęzi, której nikt nigdy nie uruchomił.
- **Change ID:** eval-ci-dispatch
- **PRD refs:** §Success Criteria (≥75% akceptacji — eval jest proxy, NIE mierzy tej metryki), §NFR (fiszki w języku materiału użytkownika: PL/EN/ES…)
- **Prerequisites:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Ta pozycja domyka drugi z dwóch follow-upów nazwanych w H-06 i **nie zmienia tego, czym eval jest**: nadal uruchamia go człowiek, nadal nie ma harmonogramu (ta sama reguła co diff DDL — alarm bez słuchacza to nie pokrycie) i nadal nie mierzy 75% akceptacji. Trzy granice warto trzymać jawnie. Po pierwsze, **czerwony przebieg to ustalenie, nie awaria higieny**: `npm run eval` kończy się kodem 1 na realnym defekcie generacji z założenia, więc ten workflow nie może nigdy zostać wpięty jako bramka blokująca release — żadnego `needs:`, `workflow_run:` ani required check. Po drugie, ogranicznikiem szkód jest **osobny** klucz OpenRouter z niskim limitem kredytów, a nie sam workflow — i kupuje on izolację WYDATKU, nie limitów przepustowości (te OpenRouter liczy globalnie na konto). Po trzecie, `evals/` nadal nie jest objęte żadną bramką typów (C10X-43): błąd typu w evalu wychodzi dopiero w trakcie przebiegu, czyli po płatnych wywołaniach.
  **Uzupełnienie 2026-08-03 (C10X-43 / H-11):** trzecia granica jest domknięta — `npm run typecheck` obejmuje `evals/` tak samo jak resztę drzewa, w jobie `ci` i w hooku `pre-push`. Zdanie zostaje, bo opisuje stan z dnia dostawy H-10. Dwie pierwsze granice są nietknięte, a z trzeciej zostaje połowa, której żadna bramka typów nie widzi: **błąd w czasie kolekcji** (rzucający import, efekt uboczny na najwyższym poziomie, zła ścieżka w `vi.mock`) nadal wychodzi dopiero w trakcie przebiegu, po płatnych wywołaniach.
- **Status:** done

### H-11: Bramka typów — zielona gałąź, która naprawdę się kompiluje (post-MVP)

- **Outcome:** (hardening) zespół przestaje czytać zielony `lint` + `build` + `npm test` jako dowód, że kod się kompiluje: `npm run typecheck` (`astro sync` → `tsc --noEmit` → `astro check`) obejmuje `src/`, `tests/`, `evals/`, `scripts/`, konfiguracje w korzeniu i 18 plików `.astro`, których `tsc` nie widzi w ogóle. Działa w jobie `ci` (fail-closed, między `astro sync` a `lint`) i lokalnie w hooku `pre-push`. Przy okazji naprawiony husky, który **nigdy nie był w tym drzewie zainstalowany** (brak skryptu `prepare`), oraz włączone `noUncheckedIndexedAccess` (33 diagnostyki w 13 plikach, jeden commit).
- **Change ID:** typecheck-gate
- **PRD refs:** §Success Criteria (≥75% akceptacji — pośrednio: instrument akceptacyjny Ryzyka #7 potrafił być niekompilowalny za zieloną gałęzią), §NFR (język kart — ta sama ścieżka)
- **Prerequisites:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Bramka nie ufa kodowi wyjścia żadnego z dwóch checkerów i to jest jej cały projekt: `astro check` kończy się **zerem**, gdy brakuje jego własnych narzędzi (drukując po drodze `[ERROR]`), i jest **ślepy na zepsuty `tsconfig.json`** — literówka w nazwie opcji wyłącza tryb strict, a bramka nadal raportuje `0 errors`. Stąd asercja na linii `Result (N files):` z **progiem**, nie z przypiętą liczbą, i `tsc` uruchamiany jako pierwszy. Trzy granice trzymać jawnie. Bramka dowodzi, że projekt **się kompiluje**, nigdy że cokolwiek **zostało uruchomione** — dla evalu to nadal znaczy „kompiluje się", a nie „ktoś go odpalił" — i nie widzi **błędu w czasie kolekcji**. Hook to `pre-push`, nie `pre-commit` (12 s na commit to stała zachęta do `--no-verify`), więc **commit** może nieść błąd typu; blokowany jest dopiero push. I hook jest per-checkout: `core.hooksPath` to konfiguracja per-repozytorium, której `git worktree add` nie kopiuje — w istniejącym worktree trzeba raz odpalić `npm install`.
- **Status:** done

### H-12: Warstwa e2e — guard, który naprawdę jest zamontowany (post-MVP)

- **Outcome:** (hardening) projekt przestaje wierzyć na słowo, że middleware chroniący trasy w ogóle się wykonuje: `npm run e2e` prowadzi prawdziwą przeglądarkę przez pięć tras chronionych bez sesji i sprawdza KOŃCOWY URL (nigdy status `fetch`-a, bo `fetch` idzie za 302 na `/auth/signin` i widzi 200 — dokładnie tak ukrył się bug C10X-27), a drugą podróżą przechodzi generację → przegląd → akceptację i pokazuje, że zaakceptowana fiszka jest w talii także po `reload()`. Warstwa jest samowystarczalna: sama startuje serwer deweloperski, odmawia startu przeciw czemukolwiek innemu niż lokalny stack **zanim** ten serwer wstanie, sama tworzy sesję przez prawdziwy formularz logowania i sama sprząta swoje wiersze — w projekcie `teardown`, który biegnie niezależnie od wyniku, bo sprzątanie w ciele testu już raz zawiodło (`E2E deck 1785947414992`, osierocona 2026-08-05).
- **Change ID:** e2e-harness-journeys
- **PRD refs:** §Access Control (wszystkie trasy fiszek i nauki są zamknięte dla niezalogowanych), FR-005, FR-006 (stan `accepted` decyduje, co użytkownik ma w talii)
- **Prerequisites:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Ta warstwa **nigdy nie jest bramką** i nic tego nie może zmiękczyć: brak joba w CI, brak harmonogramu, nic nie deklaruje jej w `needs:`. Zielony przebieg znaczy „ktoś ją tego dnia uruchomił", nigdy „sygnał jest obserwowany" — ta sama lektura, której `test-plan.md` wymaga od evalu. Cztery granice warto trzymać jawnie. Po pierwsze, bramki CI obejmują ŹRÓDŁO specek (`npm run typecheck` i reguły `eslint-plugin-playwright` w `npm run lint`), więc zielony job `ci` mówi, że warstwa **się kompiluje i przechodzi lint**, a nie że jakakolwiek podróż została wykonana — to rozróżnienie C10X-43 musiało już raz zapisać. Po drugie, dwie podróże ćwiczą najwyżej dwie wyspy React, każdą na jednej ścieżce szczęśliwej, podczas gdy `fetch` niesie ich cztery — wyłączenie wysp z `test-plan.md` §7 przeżywa tę zmianę bez zmian. Po trzecie, konto e2e jest **jedno i stałe** (decyzja D-01), więc niesie stan między przebiegami i żaden spec nie może zakładać pustej listy talii; przyrost wierszy domyka teardown, nie wyrzucanie konta. Po czwarte, `workers: 1` to **zmierzona naprawa**, nie preferencja: przy domyślnej równoległości warstwa dawała cztery czerwienie na dziesięć przebiegów, zawsze przy zimnym cache zależności Vite, który przepisuje `deps_ssr/` pod nowym hashem w trakcie kompilowania tras na żądanie — żądania w locie dostają wtedy 500 i docierają do speca przebrane za awarię aplikacji. Serializacja daje 11/11 zielonych na zimnym cache kosztem ~12 s → ~21 s; `retries` zostaje **0**, bo to usunięcie przyczyny, nie ukrycie objawu. Dług 5459 talii na bazie deweloperskiej jest **zatrzymany, nie spłacony**.
- **Status:** done

### H-13: Przewodnik testów, który wie o warstwie e2e (post-MVP)

- **Outcome:** (hardening) `context/foundation/test-plan.md` przestaje wprowadzać w błąd czytelnika, który sięga po niego przed napisaniem testu: §4 twierdziła „e2e — brak, świadomie odroczone", §5 „żadna faza tego nie okablowuje, więc wpisanie e2e jako bramki byłoby aspiracją", a §7 trzymała trzy wykluczenia z klauzulą „przemyśleć w chwili, gdy jakakolwiek faza §3 okabluje e2e" — podczas gdy runner Playwrighta i jedna specka leżały już w drzewie. Przewodnik dostaje **§3 Fazę 6** z mandatem, dziewięcioma zmierzonymi znaleziskami o harnessie **z werdyktami** i dwiema decyzjami zakresowymi (podróż C — sesja SRS — świadomie POZA zakresem), a trzy wykluczenia §7 przechodzą datowaną re-decyzję zamiast zostać martwą klauzulą. Bez zmiany w kodzie produktu: cały diff to markdown.
- **Change ID:** test-plan-refresh-2026-08-05
- **PRD refs:** — (zmiana wyłącznie w dokumentacji testowej; jak przy każdej pozycji `H-`, kotwica w PRD jest wtórna, a ta akurat nie dotyka zachowania produktu w ogóle)
- **Prerequisites:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Ta zmiana nie niesie ANI JEDNEJ linii kodu produktu, więc **żaden test niczego tu nie broni** — jedynym zabezpieczeniem przed cofnięciem się przewodnika w nieprawdę jest następny `--refresh`. Jedna rzecz, której nikt nie szukał, wyszła przy okazji i jest najtrwalszym wynikiem: `npm run typecheck` raportował **135** plików wobec **133** noszonych w dwóch dokumentach, a delta to dokładnie `playwright.config.ts` i `tests/e2e/seed.spec.ts` — czyli **warstwa e2e siedziała w bramce typów, w CI i na `pre-push`, od dnia, w którym wylądowała, i żaden dokument o tym nie wiedział.** Nic nie poczerwieniało, bo bramka asertuje **próg**, nie przypiętą liczbę — to jest bramka działająca poprawnie, i zarazem powód, dla którego zmiana ogłosiła się nigdzie. Granica, której nie wolno przeczytać na wyrost: bramka mówi, że warstwa **się kompiluje**, nigdy że cokolwiek ją **uruchomiło**. Sama faza dostarczona osobno, jako H-12 (C10X-46).
- **Status:** done — **wpis uzupełniony wstecz 2026-08-09, nie zapisany przez `/10x-archive`.** Zmiana została zarchiwizowana 2026-08-08, gdy tego wiersza nie było, więc archiwizacja nie miała czego domknąć i praca zniknęła z roadmapy — trzeci raz ten sam mechanizm, po H-04 i po H-07/H-08. Tym razem **nie było to przeoczenie**: sam `test-plan.md` §8 tej zmiany zapisał z góry, że powstaje bez wiersza w roadmapie, przyjął ten koszt świadomie (alternatywą było wchłonięcie refreshu przez fazę, którą on właśnie dodawał — czyli powtórzenie wzorca sieroty, który miał przerwać) i nazwał należny backfill. To jest ten backfill. Wiersz odtworzono na podstawie `context/archive/2026-08-05-test-plan-refresh-2026-08-05/`.

### H-14: Monitoring produkcji — błędy, o których dowiadujemy się przed użytkownikiem (post-MVP)

- **Outcome:** (hardening) projekt przestaje mieć produkcję bez żadnego sygnału o błędach: `wrangler.jsonc` wskazuje `main` na własny wpis `src/worker.ts`, który importuje handler adaptera (nigdy go nie przepisuje — inicjalizacja `setGetEnv` przed `createApp()` dzieje się właśnie na tym imporcie) i eksportuje go opakowanego w `Sentry.withSentry`. Do Sentry trafiają nieprzechwycone wyjątki na granicy `fetch` oraz output `warn`/`error` emitowany przez ZALEŻNOŚCI (`@supabase/ssr`, `@supabase/auth-js`) — czyli granica „w zakresie Ryzyka #4, ale nieposiadana", którą `test-plan.md` §7 zapisał, dostaje wreszcie obserwowany odbiornik. Każde zdarzenie jest tagowane id wersji deploya przez binding `CF_VERSION_METADATA`.
- **Change ID:** sentry-monitoring
- **PRD refs:** §Guardrails (prywatność — DSN nigdy nie ląduje w repo, wyłącznie sekret Cloudflare), §NFR (produkt ma pozostać używalny; bez sygnału o błędach awaria prod jest niewidoczna do zgłoszenia użytkownika)
- **Prerequisites:** — (praca po zamknięciu MVP, poza grafem zależności)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Tryb no-op jest ŚWIADOMY i jest zarazem najostrzejszą pułapką tej zmiany: przy pustym DSN SDK wchodzi w gałąź bez transportu, więc ten sam kod jedzie na środowiska z Sentry i bez niego — ale **brakujący sekret na produkcji jest wtedy CICHY**. Zielony deploy nie dowodzi niczego o monitoringu; dowodzi go wyłącznie zdarzenie, które DOTARŁO do Sentry (dokładnie ta sama klasa co `OPENROUTER_API_KEY` i tryb mock w `lessons.md`), stąd obowiązkowy krok prowokacji w `deploy-runbook.md`. Trzy granice trzymać jawnie. Po pierwsze, `captureConsoleIntegration` **nie domyka klasy swallowed-error z audytu** (C10X-48…52): te znaleziska to porzucone wyniki bez żadnego wywołania logującego, a `tests/lib/no-logging.test.ts` gwarantuje, że pierwszoplanowy kod pod `src/` takiego wywołania nie ma — każdy z pięciu ticketów sam odpowiada za sprawdzenie swojego błędu. Po drugie, połowa kliencka NIE istnieje: `@sentry/astro` nie jest zainstalowany, więc błędy z wysp React pozostają dla Sentry niewidoczne, a bez uploadu source map ślady stosu na produkcji są zminifikowane. Po trzecie, ta zmiana **kończy się przed deployem** — sekret ustawia i sanity robi człowiek z runbooka.
- **Status:** done — wiersz założony przez `/10x-implement` (p2), a nie wstecz: `/10x-archive` domknął Status po archiwizacji. Zapisany OD RAZU właśnie dlatego, że mechanizm „zmiana archiwizuje się bez wiersza i znika z roadmapy" wystąpił w tym projekcie już czterokrotnie (H-04, H-07, H-08, H-13) i sam plan tej zmiany go nie przewidywał.

### H-15: Usunięcie sondy błędu z produkcji (post-MVP)

- **Outcome:** (hardening) `src/pages/api/shipprobe.ts` znika z repo i z produkcji, a wraz z nim publiczny, nieuwierzytelniony endpoint, który na każde wejście rzuca wyjątkiem. Dowodem jest **para** odczytów z tego samego hosta produkcyjnego — `500` wzięte przed merdżem (nieodtwarzalne po nim) i `404` po deployu — bo sam `404` jest równie zgodny z literówką w adresie, złym hostem i nieodświeżonym Workerem. Usunięcie idzie w parze z TAŃSZYM zamiennikiem, którego pierwotny Outcome nie przewidywał: sonda była jedynym instrumentem, który wyłapałby nawrót regresji z `d381c07` (dyskryminator oparty na samym stemplu `logger === "console"` gubił po cichu ~90% realnych błędów pierwszoplanowych), więc decyzja o próbkowaniu wyjeżdża z `src/worker.ts` do czystej funkcji `src/lib/sentry-sampling.ts` — bez `env`, bez losowości (`Math.random()` wstrzykuje wywołujący, tak jak `rateCard` przyjmuje `now`) — a trzymają ją DWA testy o różnych roszczeniach: `tests/lib/sentry-sampling.test.ts` (tablica prawdy na sfabrykowanych zdarzeniach przeciw PRAWDZIWEJ tablicy `DEPENDENCY_NOISE`) oraz `tests/lib/sentry-wiring.test.ts` (strażnik per LINIA, że `beforeSend` nadal deleguje do zaimportowanej funkcji — sama tablica prawdy przeszłaby zielono przez odspojenie). Granicę czytać w tym samym oddechu: żadna warstwa w tym projekcie nie ładuje `src/worker.ts`, więc po usunięciu sondy **nic już nie dowodzi, że Sentry w ogóle woła `beforeSend`** — tablica prawdy dowodzi, że decyzja jest dobra, strażnik że ten plik ją nadal podejmuje, żaden z nich że SDK ją wywołuje.
- **Change ID:** remove-sentry-probe
- **PRD refs:** §Guardrails (nadużycie — anonim może generować zdarzenia i wyczerpać kwotę Sentry), §NFR (produkt ma pozostać używalny; wyczerpana kwota jest samomaskująca)
- **Prerequisites:** H-14 (sonda powstała razem z monitoringiem i jest sensowna tylko dopóki monitoring nie jest potwierdzony na produkcji)
- **Parallel with:** —
- **Blockers:** — (blokadą jest wyłącznie decyzja: „czy prod sanity jest już zamknięte")
- **Unknowns:** **rozstrzygnięte 2026-08-12 (C10X-54): czysta deletion; strzeżony zamiennik ODRZUCONY.** Pytanie brzmiało, czy zostawić trwały, STRZEŻONY zamiennik (endpoint za nagłówkiem z sekretem albo za `PROTECTED_ROUTES`), żeby dało się prowokować realny błąd na prodzie także później. Powodem, dla którego w ogóle chce się trwałej sondy, jest wykrywanie regresji — a to robi test jednostkowy taniej, wewnątrz CI i bez trwałej trasy rzucającej wyjątkiem ani kolejnego sekretu do rotacji (`sentry-sampling` + `sentry-wiring` w Outcome powyżej). Zapisane jako decyzja, żeby nikt nie odkrywał jej od nowa. Czego to NIE kupuje, powiedziane wprost: prowokacja realnego błędu PIERWSZOPLANOWEGO na produkcji nie ma już żadnego narzędzia, a gdyby kiedyś była potrzebna, pozostaje osobną decyzją projektową — dokładnie tak, jak mówił pierwotny wpis.
- **Risk:** Ryzyko nie polega na usunięciu, tylko na ZWLEKANIU. Sonda jest **publiczna i nieuwierzytelniona świadomie** — wariant za guardem logowania został zaproponowany i odrzucony 2026-08-12 na rzecz wygody wywołania `curl`-em z produkcji bez sesji. Każde trafienie to jedno **niesamplowane** zdarzenie (klasa pierwszoplanowa przechodzi w 100%, patrz `DEPENDENCY_NOISE` w `src/lib/sentry-sampling.ts`), więc pętla na tym adresie wyczerpuje kwotę Sentry — a to jest dokładnie ta awaria samomaskująca, przed którą ostrzega komentarz przy samplowaniu: po przekroczeniu limitu przestają dochodzić także NIEZWIĄZANE błędy i żaden kanał o tym nie powie, bo ten projekt nie ma kanału powiadomień. Jednoliniowy fix pośredni, gdyby szum się pojawił przed usunięciem: dopisać `/api/shipprobe` do `PROTECTED_ROUTES` w `src/middleware.ts`.
- **Status:** done — wiersz założony 2026-08-12 w trakcie shipu H-14, razem z kodem sondy, a nie wstecz, i domknięty przez `/10x-archive` tego samego dnia. Ten projekt ma udokumentowane cztery przypadki (H-04, H-07, H-08, H-13), w których zmiana zarchiwizowała się bez wiersza i zniknęła z roadmapy; tu ryzyko było gorsze niż zniknięcie z dokumentu, bo zapomniany wiersz zostawiłby na produkcji działający endpoint wywracający Workera. Wiersz zrobił dokładnie to, po co powstał: dług przeżył jeden dzień, nie utrwalił się.

### H-16: Ponowienie generacji przeżywa nieudaną kompensację (post-MVP)

- **Outcome:** (hardening) Użytkownik, któremu zapis kart się nie powiódł, klika „Ponów" i **dostaje fiszki**, zamiast trafiać na to samo 500 przy każdym kolejnym kliknięciu do końca świata. Trzy warstwy, w tej kolejności. (1) Kompensacja przestaje być połykana: `retireGenerationSession` (dawniej `failGenerationSession`) dostaje `.select("id").maybeSingle()`, więc UPDATE pasujący do ZERA wierszy przestaje być nie do odróżnienia od udanego — pod RLS to jest właśnie kształt zniknięcia wiersza — a wywołujący rozgałęzia się na `data`, nie na samo `error`, i w jednym `update` zeruje też `idempotency_key`. (2) Ścieżka replayu przestaje mylić „zapytanie padło" z „ta sesja jest pusta": decyzja wyjeżdża do czystej funkcji `src/lib/generation-replay.ts` (trzecia taka ekstrakcja po `readJsonResponse` i `rateOutcome`), a górny lookup **sam leczy** zatruty wiersz — czyści klucz, POTWIERDZA dopasowanie wiersza i dopiero wtedy schodzi w zwykłą generację; gałąź `23505`, która już zapłaciła za generację, leczy i odmawia. (3) Wyspa wreszcie czyta `retriable`, z ABSENT znaczącym „retriable" (D-08), więc „Ponów" znika tam, gdzie powtórzenie nie ma szans, i zostaje tam, gdzie ma.
- **Change ID:** bug-generation-compensation-swallowed
- **PRD refs:** FR-018 (jasny błąd + możliwość ponowienia generacji), US-01, §Guardrails (wiersz audytu nie może kłamać o zapisanych kartach)
- **Prerequisites:** MVP (S-01…S-06) — konkretnie S-04 (ścieżka generacji) i S-05 Phase 6 (klucz idempotencji, na którym stoi cały dead-end)
- **Parallel with:** C10X-49 i C10X-50 — pozostałe trafienia z tego samego audytu „swallowed errors" (2026-08-11), świadomie NIE zabrane tutaj; wyjątkiem jest `generate.ts:400` (cofnięcie talii w gałęzi `cardsError`), zabrane pod tym kluczem jako **warunek wstępny** własnej poprawki i zapisane jako D-01 w `change.md`, bo „fix wylądował pod cudzym kluczem" to zamieszanie, które ten projekt notował już dwa razy (C10X-37/C10X-40).
- **Blockers:** —
- **Unknowns:** **rozstrzygnięte na etapie planu (D-02, D-05, D-07).** Rodzina (b) z research §7 — trzecia wartość `status` — ODRZUCONA: wymienia tę awarię na nową (karty wylądowały, flip padł → ponowienie dopisuje duplikaty) i w ogóle nie dotyka ślepego zaułka z §6. Backfill już zatrutych wierszy na produkcji ODRZUCONY: są bezwładne, dopóki ktoś nie odtworzy tego klucza, a wtedy leczy je sam endpoint — a czyszczący UPDATE **z konstrukcji** zdjąłby klucz także wierszom z §6, których nikt nie zepsuł. Rozróżnienie „wiersz zatruty" od „użytkownik sam skasował karty" jest NIEMOŻLIWE bez nowej kolumny (research §6 mierzy oba jako bajtowo identyczne) — i dokładnie dlatego leczenie czyści WYŁĄCZNIE klucz, nigdy `status`/`saved_count`.
- **Risk:** Największe ryzyko tej zmiany jest w kolejności, nie w kodzie: wyczyść klucz → POTWIERDŹ dopasowanie wiersza → dopiero potem schodź w generację. Odwrócone, fall-through wstawia sesję z tym samym kluczem, koliduje na `generation_session_idempotency_key_uidx` i wraca dokładnie tym samym 500 — **już po opłaconym wywołaniu LLM**. Potwierdzone pomiarem (verification.md, run 1b/3), łącznie z granicą, której plan nie przewidywał: potwierdzenie mówi, że wiersz został DOPASOWANY, nie że klucz ZNIKNĄŁ. Drugie ryzyko jest dowodowe i zostaje otwarte świadomie: zestaw testów domyka połowę KONSEKWENCJI (mając wiersz, endpoint leczy), a to, że endpoint potrafi ten wiersz WYPRODUKOWAĆ, dowodzi jeden ręczny przebieg z dwoma `revoke` (D-04) i nic go nie powtarza. Trzecie: `deckNameExists` zamieniłby trwałe 500 na trwałe 409 na ścieżce `newDeckName`, więc leczone żądanie **adoptuje** własną, PUSTĄ talię o tej nazwie — bramkowane na leczeniu, nigdy na samej pustości, bo pusta talia zrobiona ręcznie nie jest sierotą.
- **Status:** done — wiersz założony przez `/10x-implement` (p5) razem z doc-syncem, a nie wstecz. Plan tej zmiany wyliczał doc-sync jako `test-plan.md` + `change.md` i roadmapy nie przewidywał; wiersz dopisano mimo to, bo bez niego `/10x-archive` nie ma czego domknąć — mechanizm, który w tym projekcie zadziałał już czterokrotnie (H-04, H-07, H-08, H-13). Domknięty przez `/10x-archive` 2026-08-13, czyli wiersz zadziałał: dług nie przeżył ani jednego dnia i piąte wystąpienie tego mechanizmu zostało uprzedzone, a nie naprawione wstecz.

### H-17: Nieudane cofnięcie talii przestaje być nieme (post-MVP)

- **Outcome:** (hardening) Gdy zapis sesji generacji padnie, a kompensujące cofnięcie świeżo utworzonej talii padnie razem z nim, użytkownik **dowiaduje się o pustej talii, która została** — zamiast zobaczyć zwykłe 500, kliknąć „Ponów" i dostać trwałe `409 "Talia o tej nazwie już istnieje"`, czyli komunikat obwiniający jego wybór nazwy i odbierający przy tym sam przycisk. Ostatni połknięty `await` z audytu „swallowed errors" (2026-08-11) po stronie cofnięcia talii: wynik `deleteDeck` jest odczytywany i rozgałęziany na `data`, nie na samo `error` (pod RLS zero wierszy to `{data: null, error: null}`), a gałąź „cofnięcie nie wyszło" odpowiada osobnym komunikatem nazywającym sierotę i **dwie** drogi wyjścia — odśwież i wybierz ją z listy albo zmień nazwę. Świadomie z `retriable: false`: „Ponów" powtarza payload DOSŁOWNIE, więc na tej gałęzi trafi w sierotę i skończy tym samym 409 — flaga oznacza te przypadki, których powtórzenie **z konstrukcji** nie naprawi, a skoro banera nie ma czym kliknąć, to sam komunikat jest jedyną drogą wyjścia. Granica w tym samym oddechu: to jest **wykrycie, nie sprzątanie** — pusta talia przeżywa nieudane cofnięcie niezależnie od tego, jak głośno zostanie zgłoszona (korekta D-01 z H-16).
- **Change ID:** bug-generation-deck-undo-swallowed
- **PRD refs:** FR-018 (jasny komunikat błędu + możliwość ponowienia generacji), US-01
- **Prerequisites:** MVP (S-01…S-06) — konkretnie S-04 (ścieżka generacji) i S-05 Phase 6 (klucz idempotencji)
- **Parallel with:** C10X-50 — dwa pozostałe połknięte `await`y w `generate.ts` (wstawienia `createGenerationSession` na ścieżkach awaryjnych), świadomie NIE zabrane tutaj. Wiersz H-16 wymienia w tym polu C10X-49 i jest **datowanym wpisem** (`Status: done`), więc zostaje nietknięty — był prawdziwy, kiedy go pisano.
- **Blockers:** —
- **Unknowns:** **rozstrzygnięte na etapie planu (D-02, D-03, D-04).** Projekt komunikatu był realną decyzją tej zmiany, nie ozdobnikiem: odrzucono zarówno powtórzenie kształtu z H-16 (jeden wspólny literał), jak i dopisanie klauzuli do wariantów `23505`, na rzecz komunikatu, który **nazywa zostawioną talię** — bo prawdziwy ból użytkownika jest przy NASTĘPNYM kliknięciu, a wiadomość mówiąca wyłącznie o sesji nie mówi nic o pustej talii, która zaraz go zablokuje. Wczesny `return` w gałęzi replayu, który omija cofnięcie, poprawiono jako **komentarz, nie kod**: na ścieżce 200 kasowana byłaby dokładnie ta talia, którą odpowiedź właśnie oddaje.
- **Risk:** Ryzyko dowodowe, świadomie otwarte i takie samo jak w H-16: gałąź jest **nieosiągalna z zestawu testów** — nie z powodu reguł suite'a, tylko strukturalnie (filtry górnego lookupu są identyczne z predykatem częściowego indeksu, więc żaden zasiany wiersz nie skoliduje przy wstawianiu sesji). Zestaw testów domyka wyłącznie kontrakt HELPERA (`deleteDeck`, dotąd bez ani jednego wywołania w `tests/`), a to, że endpoint tę gałąź wykonuje i oddaje nowy komunikat, dowodzi jeden ręczny przebieg z dwoma `revoke` — i nic go nie powtarza. Drugie ryzyko jest w treści: skoro `retriable: false` zabiera przycisk, skrócenie komunikatu odbiera użytkownikowi ostatnią drogę wyjścia, więc obie rzeczy muszą zmieniać się razem.
- **Status:** in progress — wiersz założony przez `/10x-implement` (p1), na starcie zmiany, a nie wstecz i nie razem z doc-syncem. Ten projekt czterokrotnie zarchiwizował zmianę bez wiersza (H-04, H-07, H-08, H-13) i dwukrotnie ten mechanizm uprzedził (H-15, H-16); tutaj wiersz powstaje w PIERWSZEJ fazie, więc porzucenie zmiany w połowie też nie sprawi, że zniknie ona z roadmapy. Status → done domyka `/10x-archive`, nie ten plan.

## Backlog Handoff

| Roadmap ID | Change ID               | Suggested issue title                              | Ready for `/10x-plan` | Notes                                                    |
| ---------- | ----------------------- | -------------------------------------------------- | --------------------- | -------------------------------------------------------- |
| F-01       | per-user-data-isolation | Izolacja danych per-konto (RLS) + rdzenne tabele   | yes                   | Rekomendowany pierwszy ruch; odblokowuje S-01/S-03/S-04  |
| F-02       | srs-library-choice      | Wybór gotowej biblioteki SRS + skala oceny         | yes                   | Decyzja odblokowująca gwiazdę S-03; można podjąć od razu |
| S-01       | deck-workspace          | Tworzenie i nazywanie prywatnych talii             | no                    | Czeka na F-01                                            |
| F-03       | verification-harness    | Harness testowy + test-plan (test izolacji)        | no                    | Czeka na S-01                                            |
| S-02       | manual-card-crud        | Ręczne CRUD fiszek w talii                         | no                    | Czeka na S-01                                            |
| S-03       | srs-study-session       | Sesja nauki SRS (gwiazda przewodnia)               | no                    | Czeka na F-02 (decyzja SRS) + S-02                       |
| S-04       | ai-candidate-generation | Generacja kandydatów AI z wklejonego tekstu        | no                    | Czeka na F-01, S-01                                      |
| S-05       | candidate-review        | Przegląd i kuracja kandydatów (accept/edit/reject) | no                    | Czeka na S-04                                            |
| S-06       | deck-keyword-search     | Wyszukiwanie fiszek po słowie kluczowym            | no                    | Czeka na S-02                                            |

## Open Roadmap Questions

1. **Maksymalna długość tekstu źródłowego** (OQ#1 z PRD) — Owner: downstream stack step. Block: nie blokuje (możliwe rozsądne domyślne); dotyczy S-04.
2. **Liczba kart na generację** (OQ#3 z PRD) — Owner: downstream stack step. Block: nie blokuje; dotyczy S-04.
3. **Wybór dostawcy/modelu LLM** (jakość generacji w PL + innych językach) — Owner: downstream stack step. Block: nie blokuje planowania S-04, ale wymagany przed realnym uruchomieniem generacji.

(Wcześniejsze pytanie o gotową bibliotekę SRS i skalę oceny zostało wyniesione z tej listy do fundamentu **F-02 `srs-library-choice`** — z luźnego pytania stało się jawną, sekwencjonowaną jednostką pracy z `Unlocks: S-03`.)

## Parked

- **Panel administracyjny (mock/placeholder)** — Why parked: PRD §Non-Goals (brak działającego panelu admina w MVP); FR-013 to nice-to-have, sam widoczny placeholder — poza ścieżką must-have przy ograniczonej przepustowości.
- **Filtrowanie po statusie i zakresie dat** (FR-014) — Why parked: nice-to-have; nadbudowa nad listą (S-02), odłożona za must-have.
- **Filtrowanie po statusie powtórki (due w 1/5/10 dni)** (FR-016) — Why parked: nice-to-have, jawnie późniejsza zdolność związana z harmonogramem SRS.
- **Wyszukiwanie z rankingiem trafności, live-as-you-type** (FR-019) — Why parked: nice-to-have; rozszerzenie S-06/FR-015 na ranking i inkrementalne wyniki.
- **Własny algorytm SRS** — Why parked: PRD §Non-Goals (buy-vs-build rozstrzygnięte na "buy"; gotowa biblioteka).
- **Import wieloformatowy (PDF/DOCX/…)** — Why parked: PRD §Non-Goals; wejście to wyłącznie wklejony tekst.
- **Aplikacja mobilna i integracje zewnętrzne** — Why parked: PRD §Non-Goals; wyłącznie web.
- **Współdzielenie talii między użytkownikami** — Why parked: PRD §Non-Goals; twardy single-tenant, dane prywatne per-właściciel.

## Done

(Pusto przy pierwszej generacji. `/10x-archive` dopisuje tu wpis — i przełącza Status elementu na `done` — gdy zarchiwizowana zostanie zmiana, której `Change ID` pasuje do elementu. NIE wypełniać ręcznie.)

- **F-01: (foundation) ustanowiona polityka izolacji per-user (Supabase RLS) wraz z minimalnymi rdzennymi tabelami Deck i Flashcard, tak że każdy slice poniżej dziedziczy twardą granicę "żaden użytkownik nie widzi cudzych danych".** — Archived 2026-07-05 → `context/archive/2026-07-05-per-user-data-isolation/`. Lesson: —.
- **S-01: użytkownik po zalogowaniu tworzy i nazywa własne talie i widzi je jako prywatną przestrzeń.** — Archived 2026-07-08 → `context/archive/2026-07-07-deck-workspace/`. Lesson: —.
- **F-02: (foundation) rozstrzygnięta i zaakceptowana decyzja: która gotowa biblioteka spaced-repetition oraz jaka skala oceny przypomnienia — pojedyncza decyzja determinująca pola harmonogramu i skalę oceny dla sesji nauki. Bez kodu produktowego (decyzja typu buy, nie warstwa).** — Archived 2026-07-09 → `context/archive/2026-07-09-srs-library-choice/`. Lesson: —.
- **S-02: użytkownik ręcznie tworzy fiszkę (front/back), przegląda listę fiszek w talii, edytuje i trwale usuwa dowolną fiszkę.** — Archived 2026-07-11 → `context/archive/2026-07-09-manual-card-crud/`. Lesson: —.
- **S-06: użytkownik wpisuje frazę i zatwierdza (Enter); dopasowanie to proste wyszukiwanie podłańcucha w `front` i `back` kart w danej talii.** — Archived 2026-07-13 → `context/archive/2026-07-11-deck-keyword-search/`. Lesson: —.
- **S-04: użytkownik wkleja tekst źródłowy (do zdefiniowanego maksimum), uruchamia generację AI z widocznym postępem, a przy błędzie/timeoucie widzi jasny komunikat i może ponowić; kandydaci trafiają do bazy ze statusem `generated`, powiązani z sesją generacji.** — Archived 2026-07-13 → `context/archive/2026-07-11-ai-candidate-generation/`. Lesson: —.
- **F-03: (foundation) skonfigurowany runner testów (Vitest przez `getViteConfig()`) i `context/foundation/test-plan.md` nazywający ryzyka, plus realne testy cross-account ćwiczące guardrail izolacji na zdolności dostarczonej przez S-01 — uruchamiane w CI jako bramka przed deployem.** — Archived 2026-07-15 → `context/archive/2026-07-15-verification-harness/`. Lesson: —.
- **S-03: użytkownik rozpoczyna sesję nauki, w której gotowy algorytm SRS wybiera karty należne dziś, ocenia przypomnienie na każdej karcie, a harmonogram przeżywa między sesjami (żadna karta nie ginie, harmonogram się nie psuje).** — Archived 2026-07-24 → `context/archive/2026-07-24-srs-study-session/`. Lesson: —.
- **S-05: użytkownik przegląda wygenerowanych kandydatów i akceptuje, edytuje lub odrzuca każdego — pojedynczo albo zbiorczo (bulk); zaakceptowane karty stają się częścią talii nadającą się do nauki. Slice zamknął też dwa długi przypisane mu z nazwy przez wcześniejsze slice'y: filtr stanu w wyszukiwarce S-06 (tylko `accepted`) oraz idempotencję generacji (impl-review F5 z S-04) — „Ponów" po timeoucie klienta odtwarza zapisaną sesję zamiast dopisywać drugi komplet kandydatów, czym domyka Risk #2 z test-plan.md.** — Archived 2026-07-25 → `context/archive/2026-07-25-candidate-review/`. Lesson: —.
- **H-01: (hardening) użytkownik nawigujący klawiaturą widzi wyraźny, kontrastujący focus ring na input/button/select/textarea w obu motywach — ring pokazuje się tylko na `:focus-visible`, nie po kliknięciu myszą.** — Archived 2026-07-25 → `context/archive/2026-07-25-focus-ring-a11y/`. Lesson: —.
- **H-02: (hardening) użytkownik, którego sesja wygasła lub została unieważniona w tle, NIE przechodzi całej sesji nauki w przekonaniu, że się uczy — zamiast cichego awansu karty widzi błąd, a harmonogram nie gubi ocen. Do tego harmonogram zyskuje pokrycie tych obietnic, których dotąd nikt nie sprawdzał: rozmiar sesji brany z talii, powrót karty gdy nadejdzie `due`, i ocena „Again".** — Archived 2026-07-26 → `context/archive/2026-07-26-srs-study-session-test/`. Lesson: —.
- **H-04: (hardening) użytkownik, któremu generacja padła, dostaje komunikat bez swojego wklejonego tekstu, bez odpowiedzi dostawcy LLM i bez klucza API — a serwer odrzuca żądanie omijające limity wymuszane przez UI, zamiast je zapisać.** — Archived 2026-07-26 → `context/archive/2026-07-26-ai-candidate-generation-test-2/`. Lesson: —. **Wpis uzupełniony wstecz 2026-07-28** — w chwili archiwizacji ten element nie miał wiersza w roadmapie, więc `/10x-archive` nie miał czego domknąć.
- **H-03: (hardening) użytkownik, któremu nie udało się zalogować lub zarejestrować, dowiaduje się po polsku, co poszło nie tak i co z tym zrobić — a to, co odpowiedział serwer uwierzytelniania, nie trafia do jego paska adresu, historii przeglądarki ani do logu dostępowego. Do tego anonimowy odwiedzający przestaje być informowany, czy generacja AI działa naprawdę, czy w trybie mock.** — Archived 2026-07-31 → `context/archive/2026-07-30-auth-error-copy/`. Lesson: —.
- **H-05: (hardening) użytkownik nigdy nie trafia na aplikację działającą przeciw bazie, której brakuje migracji z wdrożonego kodu — CI zatrzymuje deploy, zanim Worker wyjdzie, zamiast pozwolić mu wystartować i wywalić się na pierwszym zapisie.** — Archived 2026-07-28 → `context/archive/2026-07-27-schema-drift-test/`. Lesson: —.
- **H-07: (hardening) użytkownik nie może spreparowanym żądaniem ominąć reguły nazwy talii wymuszanej przez UI, a spreparowany link nie wyświetli mu dowolnego tekstu wewnątrz czerwonego paska błędu tej aplikacji — komunikat, za który aplikacja nie ręczy, degraduje się do BRAKU paska. Zamknięty zbiór jedenastu komunikatów plus `ownedRedirectMessage` (przynależność przez równość), sześć ujść na trzech stronach talii, oraz dwa endpointy `formData()`, które przeoczył sweep C10X-30.** — Archived 2026-08-01 → `context/archive/2026-07-31-deck-form-hardening/`. Lesson: —. **Wpis uzupełniony wstecz 2026-08-01 (C10X-40)** — w chwili archiwizacji ten element nie miał wiersza w roadmapie, więc `/10x-archive` nie miał czego domknąć; ta sama sytuacja co przy H-04.
- **H-08: (hardening) zespół przestaje czytać zielony przebieg testów jako dowód, że nic się nie zdublowało — sześć cichych szwów zapisu (nie dwa, jak zakładał odczyt kodu) dostało liczniki zawężone do przypadku, a powtórzony census raportuje zero. Przy okazji zmierzono mechanizm samego flake'a: oba timeouty keep-alive to 60 s, czyli przypadek patologiczny, a nie zła kolejność.** — Archived 2026-08-01 → `context/archive/2026-08-01-local-stack-transport-flake/`. Lesson: —. **Wpis uzupełniony wstecz 2026-08-01 (C10X-40)** — jak wyżej: brak wiersza w chwili archiwizacji.
- **H-06: (hardening) zespół ma zmierzony, powtarzalny dowód, że wygenerowane fiszki wychodzą w języku tekstu źródłowego i nadają się do nauki: lokalny eval LLM-as-judge (`npm run eval`, osobna ścieżka uruchomienia — nigdy część `npm test`) przepuszcza 10-przypadkową macierz językową przez produkcyjne `generateCandidates()` na realnym modelu i ocenia każdą kartę sędzią z INNEJ rodziny modeli (`google/gemini-2.5-flash` vs `openai/gpt-4o-mini`).** — Archived 2026-07-29 → `context/archive/2026-07-29-ai-candidate-generation-test-3/`. Lesson: —.
- **H-09: (hardening) reguły chroniące kanał `?error=` przestają być zaczepione o pisownię, a stają się zaczepione o konstrukcję: zbiór komunikatów jest egzekwowany w miejscu, gdzie wartości do niego wchodzą (a nie tylko tam, gdzie stoi literał obok napisu `error=`), a skan strony odczytu obejmuje każdy plik `.astro` w `src/`, nie tylko `src/pages/`.** — Archived 2026-08-01 → `context/archive/2026-08-01-deck-error-param-guard/`. Lesson: —.
- **H-10: (hardening) instrument, który do tej pory żył wyłącznie na maszynie jednej osoby, staje się zdolnością projektu: każdy z prawem zapisu wchodzi w zakładkę Actions, uruchamia **Generation quality eval**, opcjonalnie podmienia model generatora albo sędziego, i po kilku minutach czyta 11-wierszową tabelę werdyktu w logu zadania — bez klucza OpenRouter, bez `npm ci` i bez lokalnego stacka u siebie. Pełny zapis (każda karta, każdy werdykt i uzasadnienie sędziego, plus surowy strumień konsoli) wisi przy przebiegu jako artefakt nazwany numerem próby, więc reguła kalibracyjna „czerwony przypadek powtarza się raz, zanim się w niego uwierzy" zostawia oba przebiegi obok siebie. Eval zapisuje przy okazji swój raport na dysk także lokalnie — jedna ścieżka kodu, więc CI nie ma gałęzi, której nikt nigdy nie uruchomił.** — Archived 2026-08-02 → `context/archive/2026-08-02-eval-ci-dispatch/`. Lesson: —.
- **H-11: (hardening) zespół przestaje czytać zielony `lint` + `build` + `npm test` jako dowód, że kod się kompiluje: `npm run typecheck` (`astro sync` → `tsc --noEmit` → `astro check`) obejmuje `src/`, `tests/`, `evals/`, `scripts/`, konfiguracje w korzeniu i 18 plików `.astro`, których `tsc` nie widzi w ogóle. Działa w jobie `ci` (fail-closed, między `astro sync` a `lint`) i lokalnie w hooku `pre-push`. Przy okazji naprawiony husky, który **nigdy nie był w tym drzewie zainstalowany** (brak skryptu `prepare`), oraz włączone `noUncheckedIndexedAccess` (33 diagnostyki w 13 plikach, jeden commit).** — Archived 2026-08-03 → `context/archive/2026-08-02-typecheck-gate/`. Lesson: —.
- **H-12: (hardening) projekt przestaje wierzyć na słowo, że middleware chroniący trasy w ogóle się wykonuje: `npm run e2e` prowadzi prawdziwą przeglądarkę przez pięć tras chronionych bez sesji i sprawdza KOŃCOWY URL (nigdy status `fetch`-a, bo `fetch` idzie za 302 na `/auth/signin` i widzi 200 — dokładnie tak ukrył się bug C10X-27), a drugą podróżą przechodzi generację → przegląd → akceptację i pokazuje, że zaakceptowana fiszka jest w talii także po `reload()`. Warstwa jest samowystarczalna: sama startuje serwer deweloperski, odmawia startu przeciw czemukolwiek innemu niż lokalny stack **zanim** ten serwer wstanie, sama tworzy sesję przez prawdziwy formularz logowania i sama sprząta swoje wiersze — w projekcie `teardown`, który biegnie niezależnie od wyniku, bo sprzątanie w ciele testu już raz zawiodło (`E2E deck 1785947414992`, osierocona 2026-08-05).** — Archived 2026-08-09 → `context/archive/2026-08-08-e2e-harness-journeys/`. Lesson: —.
- **H-13: (hardening) `context/foundation/test-plan.md` przestaje wprowadzać w błąd czytelnika, który sięga po niego przed napisaniem testu: §4, §5 i §7 twierdziły, że warstwy e2e nie ma i że żadna faza jej nie okablowuje, podczas gdy runner Playwrighta i jedna specka leżały już w drzewie. Przewodnik dostaje §3 Fazę 6 z mandatem, dziewięcioma zmierzonymi znaleziskami o harnessie z werdyktami i dwiema decyzjami zakresowymi, a trzy wykluczenia §7 przechodzą datowaną re-decyzję zamiast zostać martwą klauzulą. Przy okazji wyszło, że warstwa e2e od dnia wylądowania siedziała w bramce typów (135 plików wobec noszonych 133) i żaden dokument o tym nie wiedział.** — Archived 2026-08-08 → `context/archive/2026-08-05-test-plan-refresh-2026-08-05/`. Lesson: —. **Wpis uzupełniony wstecz 2026-08-09** — patrz nota przy Statusie H-13.
- **H-14: (hardening) projekt przestaje mieć produkcję bez żadnego sygnału o błędach: `wrangler.jsonc` wskazuje `main` na własny wpis `src/worker.ts`, który importuje handler adaptera (nigdy go nie przepisuje — inicjalizacja `setGetEnv` przed `createApp()` dzieje się właśnie na tym imporcie) i eksportuje go opakowanego w `Sentry.withSentry`. Do Sentry trafiają nieprzechwycone wyjątki na granicy `fetch` oraz output `warn`/`error` emitowany przez ZALEŻNOŚCI (`@supabase/ssr`, `@supabase/auth-js`) — czyli granica „w zakresie Ryzyka #4, ale nieposiadana", którą `test-plan.md` §7 zapisał, dostaje wreszcie obserwowany odbiornik. Każde zdarzenie jest tagowane id wersji deploya przez binding `CF_VERSION_METADATA`.** — Archived 2026-08-12 → `context/archive/2026-08-11-sentry-monitoring/`. Lesson: —. **Dwa zdania tego Outcome zostały zmierzone jako fałszywe podczas shipu 2026-08-12 i Outcome NIE jest przepisywany** (`/10x-archive` nie tyka tego pola): pierwszoplanowe błędy nie docierają „na granicy `fetch`" — Astro je łapie i re-emituje własnym loggerem, więc wpadały pod próbkowanie klasy console i ~90% z nich ginęło po cichu, co naprawiono w `d381c07` przez oparcie dyskryminatora na sygnaturze szumu; a `npm run dev` w ogóle nie wykonuje `src/worker.ts`. Pomiary i pełny wywód: `verification.md` oraz `deploy-runbook.md` w archiwum tej zmiany. Ship pozostawił świadomy dług — publiczną trasę `/api/shipprobe` — którego usunięcie prowadzi **H-15**. **Nota 2026-08-12 (C10X-54): ten dług jest spłacony.** Trasa została usunięta z repo i z produkcji (para odczytów `500` → `404` z tego samego hosta), nie stała się trwała przez zaniechanie, a jednoliniowy stopgap `PROTECTED_ROUTES` nie był potrzebny. Klasa regresji, której sonda pilnowała niejawnie — dyskryminator próbkowania, ten sam, który naprawił `d381c07` — przeniosła się do CI: `src/lib/sentry-sampling.ts` plus `tests/lib/sentry-sampling.test.ts` i `tests/lib/sentry-wiring.test.ts`. Zdanie powyżej NIE jest przepisywane, bo pozostaje prawdziwe: H-15 rzeczywiście poprowadził to usunięcie. Szczegóły i granice — w bloku **H-15**.
- **H-15: (hardening) `src/pages/api/shipprobe.ts` znika z repo i z produkcji, a wraz z nim publiczny, nieuwierzytelniony endpoint, który na każde wejście rzuca wyjątkiem. Dowodem jest **para** odczytów z tego samego hosta produkcyjnego — `500` wzięte przed merdżem (nieodtwarzalne po nim) i `404` po deployu — bo sam `404` jest równie zgodny z literówką w adresie, złym hostem i nieodświeżonym Workerem. Usunięcie idzie w parze z TAŃSZYM zamiennikiem, którego pierwotny Outcome nie przewidywał: sonda była jedynym instrumentem, który wyłapałby nawrót regresji z `d381c07`, więc decyzja o próbkowaniu wyjechała z `src/worker.ts` do czystej funkcji `src/lib/sentry-sampling.ts` — bez `env`, bez losowości — a trzymają ją DWA testy o różnych roszczeniach: `tests/lib/sentry-sampling.test.ts` (tablica prawdy przeciw PRAWDZIWEJ tablicy `DEPENDENCY_NOISE`) oraz `tests/lib/sentry-wiring.test.ts` (strażnik per LINIA, że `beforeSend` nadal deleguje — sama tablica prawdy przeszłaby zielono przez odspojenie).** — Archived 2026-08-12 → `context/archive/2026-08-12-remove-sentry-probe/`. Lesson: —. **Granicę czytać w tym samym oddechu, bo to jest przyjęty koszt tej zmiany, nie przeoczenie:** żadna warstwa w tym projekcie nie ładuje `src/worker.ts`, więc po usunięciu sondy **nic już nie dowodzi, że Sentry w ogóle woła `beforeSend`** — tablica prawdy dowodzi, że decyzja jest dobra, strażnik że ten plik ją nadal podejmuje, żaden z nich że SDK ją wywołuje. Impl-review dorzucił trzy poprawki (przepięty wskaźnik do `DEPENDENCY_NOISE`, zapisany residual dyskryminatora z dwoma nowymi przypadkami, próg strażnika przestał liczyć puste linie) i zostawił jedno świadomie otwarte: artefakty testowe C10X-53 w Sentry (`10XCARDS-6` i cztery inne) wciąż nierozwiązane — należą do tamtego shipu.
- **H-16: (hardening) Użytkownik, któremu zapis kart się nie powiódł, klika „Ponów" i **dostaje fiszki**, zamiast trafiać na to samo 500 przy każdym kolejnym kliknięciu do końca świata. Trzy warstwy, w tej kolejności. (1) Kompensacja przestaje być połykana: `retireGenerationSession` (dawniej `failGenerationSession`) dostaje `.select("id").maybeSingle()`, więc UPDATE pasujący do ZERA wierszy przestaje być nie do odróżnienia od udanego — pod RLS to jest właśnie kształt zniknięcia wiersza — a wywołujący rozgałęzia się na `data`, nie na samo `error`, i w jednym `update` zeruje też `idempotency_key`. (2) Ścieżka replayu przestaje mylić „zapytanie padło" z „ta sesja jest pusta": decyzja wyjeżdża do czystej funkcji `src/lib/generation-replay.ts` (trzecia taka ekstrakcja po `readJsonResponse` i `rateOutcome`), a górny lookup **sam leczy** zatruty wiersz — czyści klucz, POTWIERDZA dopasowanie wiersza i dopiero wtedy schodzi w zwykłą generację; gałąź `23505`, która już zapłaciła za generację, leczy i odmawia. (3) Wyspa wreszcie czyta `retriable`, z ABSENT znaczącym „retriable" (D-08), więc „Ponów" znika tam, gdzie powtórzenie nie ma szans, i zostaje tam, gdzie ma.** — Archived 2026-08-13 → `context/archive/2026-08-12-bug-generation-compensation-swallowed/`. Lesson: —.

## Parked ideas (post-MVP → Jira "Pomysł")

Known, deferred, tracked in Jira — do NOT re-propose as new, do NOT build into an MVP slice.
If a slice touches one, note it and defer to its ticket. Detail lives in Jira; this is a pointer index only.

- C10X-14 — Soft-delete / trash / recovery for decks and flashcards
- C10X-15 — Shared responsive view template + component library (PARENT)
- C10X-16 — Keyboard-driven UX + selection model (selection-driven toolbar)
- C10X-17 — Manual ordering (position/Lp.) + flashcard view sorting
- C10X-18 — Deck list view: parity with flashcard view + per-deck metadata (relates → C10X-15)
- C10X-19 — Polish UI: finish copy translation (landing + sign-in/sign-up)
- C10X-20 — Auth landing: inline sign-in/sign-up form below hero
- C10X-21 — Full-height scrollbar + sticky header/footer (shell restructure) (relates → C10X-15)
- C10X-23 — Deck search UX improvements (`deck-search-ux`)
- C10X-24 — AI generator UX improvements (`ai-generator-ux`)
- C10X-25 — Generation hardening: write idempotency + rate limit on `/api/generate` (`ai-generation-hardening`)
- C10X-35 — Alerts + schedule for `schema-diff` — nobody watches the DDL diff result today
- C10X-36 — Auth route input validation: server-side parity with the UI (`auth-input-validation`, second surface of test-plan Risk #6)
- C10X-38 — Research: supplying secrets without pasting them into code and sessions (`OPENROUTER_API_KEY`)
- C10X-44 — Admin panel: configure generation languages without touching the database

> **Completed 2026-08-01 (during C10X-40's `/jira-finish-work`), and the gap is the point.** This
> index claims to be the pointer index for every deferred idea in Jira, and it listed only
> C10X-14…21 while **seven** more existed, so a reader consulting this file would have
> re-proposed one of them as new — exactly what the heading forbids. Derived by enumerating every
> `Pomysł`-status issue in project C10X against this list, not by reading the git history.
>
> Two things this note first got wrong, corrected here rather than quietly: all seven were
> **already recorded in `jira-map.md`** — C10X-35/36/38/44 in its follow-up table, and
> C10X-23/24/25 in its orphan line, written in the shorthand `C10X-14…21/23/24/25` that a
> `C10X-2[345]` grep cannot match. So none of them was undocumented project-wide; the gap was
> **this index only**. And the map's blanket "orphans are never written into the docs" does not
> describe this section: it already carried eight idea pointers before this edit, by design.
