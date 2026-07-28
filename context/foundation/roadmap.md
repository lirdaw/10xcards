---
project: 10xcards
version: 1
status: draft
created: 2026-07-04
updated: 2026-07-28
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

| ID   | Change ID                      | Outcome (użytkownik może …)                                                                                                               | Prerequisites    | PRD refs                                                          | Status      |
| ---- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------- | ----------- |
| F-01 | per-user-data-isolation        | (foundation) twarda izolacja danych per-konto (RLS) + rdzenne tabele                                                                      | —                | Access Control, Guardrails, NFR: prywatność                       | done        |
| F-02 | srs-library-choice             | (foundation) decyzja: gotowa biblioteka SRS + skala oceny przypomnienia                                                                   | —                | Non-Goals (gotowy SRS), Open Questions #2                         | done        |
| S-01 | deck-workspace                 | tworzyć i nazywać własne talie (prywatna przestrzeń)                                                                                      | F-01             | US-03, FR-017, FR-001, FR-002                                     | done        |
| F-03 | verification-harness           | (foundation) harness testowy + test-plan.md + testy cross-account (talie i fiszki, odczyt i zapis) w CI                                   | S-01             | Guardrails, NFR: trwałość harmonogramu                            | done        |
| S-02 | manual-card-crud               | ręcznie tworzyć, przeglądać, edytować i usuwać fiszki w talii                                                                             | S-01             | US-03, FR-007, FR-008, FR-009, FR-010                             | done        |
| S-03 | srs-study-session              | uczyć się talii w sesji SRS z oceną przypomnienia (gwiazda)                                                                               | F-01, F-02, S-02 | US-02, FR-011, FR-012                                             | done        |
| S-04 | ai-candidate-generation        | wkleić tekst i wygenerować kandydatów AI z postępem i retry                                                                               | F-01, S-01       | US-01, FR-003, FR-004, FR-006, FR-018                             | done        |
| S-05 | candidate-review               | przeglądać kandydatów i akceptować/edytować/odrzucać (bulk)                                                                               | S-04             | US-01, FR-005, FR-006                                             | done        |
| S-06 | deck-keyword-search            | wyszukiwać fiszki w talii po słowie kluczowym                                                                                             | S-02             | FR-015                                                            | done        |
| H-01 | focus-ring-a11y                | widzieć, gdzie jest focus klawiatury na każdym polu i przycisku (kontrast ≥ 3:1, oba motywy)                                              | MVP (S-01…S-06)  | NFR: baseline a11y (klawiatura / czytnik ekranu)                  | done        |
| H-02 | srs-study-session-test         | ufać, że każda oceniona karta faktycznie trafia do harmonogramu — także gdy sesja wygasła w tle                                           | MVP (S-01…S-06)  | Guardrails: poprawność harmonogramu SRS, US-02                    | done        |
| H-03 | auth-error-copy                | dowiedzieć się po polsku, czemu logowanie nie wyszło, bez odpowiedzi serwera auth w pasku adresu                                          | MVP (S-01…S-06)  | FR-001, FR-002, NFR: UI po polsku, Guardrails                     | not started |
| H-04 | ai-candidate-generation-test-2 | mieć pewność, że wklejony tekst i klucz API nie wyciekają do odpowiedzi błędu ani do logu, a serwer odrzuca żądanie omijające limity z UI | MVP (S-01…S-06)  | Guardrails: prywatność tekstu źródłowego, NFR: prywatność, FR-003 | done        |
| H-05 | schema-drift-test              | ufać, że wdrożona aplikacja nigdy nie działa przeciw bazie bez swojej migracji — CI zatrzymuje deploy, zanim Worker wyjdzie               | MVP (S-01…S-06)  | NFR: dane i harmonogram przeżywają między sesjami, Guardrails     | done        |

Prefiks **`H-` (hardening)** oznacza pracę PO zamknięciu zakresu MVP: `F-01…F-03` i
`S-01…S-06` są `done` i ta granica zostaje nienaruszona. Elementy `H-` nie są vertical
slice'ami — nie mają prerekwizytów, nikogo nie odblokowują i nie wchodzą do `## Streams`
ani do grafu zależności. Źródłem jest Jira (bug / dług / polish), nie PRD; kotwica w PRD
jest wtórna. Mają wiersz tutaj i blok w `## Slices` wyłącznie po to, żeby `/10x-archive`
miał co domknąć — bez tego zamknięty task znika z roadmapy bez śladu w `## Done`.

> **Uwaga do wiersza H-03: jego `not started` jest nieaktualne — kod już wyszedł, pod obcym
> `Change ID`.** Przeczytaj blok `### H-03` w `## Slices`, zanim cokolwiek z niego weźmiesz do
> roboty. To jest zarazem ogólniejsza pułapka tej tabeli: `/10x-archive` przestawia Status,
> dopasowując archiwizowaną zmianę po `Change ID`, więc **praca wykonana pod cudzym change-id
> zostawia tu wiersz, którego nikt automatycznie nie domknie**.

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
- **Risk:** Defekt globalny, nie per-widok. Przyczyna ZMIERZONA (nie ta z ticketu): `ring-*` mapuje się na realny `box-shadow` poprawnie — problem jest w wartości tokena `--ring`, który zasila naraz `ring-*` na prymitywach ORAZ `outline-color` na `*`. Aplikacja renderuje się stale ciemno (`bg-cosmic`), a wariant `dark` nigdy się nie aktywuje, więc obowiązują tokeny motywu JASNEGO: 43 z 48 kontrolek mierzyło 2,3–2,7:1 wobec wymaganych 3:1. Druga część defektu to trzy lokalne łatki narosłe wokół zbyt słabej wartości domyślnej. Fix idzie w jedno miejsce — nie łatać per widok. Poza zakresem: model SELEKCJI elementów (widoczny obrys zaznaczonego wiersza), który należy do C10X-16. Brak automatycznej ochrony przed regresją: projekt nie ma warstwy e2e ani visual-diff — patrz `test-plan.md` §7; dowodem jest pomiar w `context/archive/2026-07-25-focus-ring-a11y/verification.md`.
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
- **⚠️ ZAKRES TEGO ELEMENTU JEST JUŻ ZAIMPLEMENTOWANY — nie buduj go od nowa (impl-review F3, 2026-07-26).** Cały H-03 — mapper `src/lib/auth-errors.ts` + obie trasy auth (`b0ab625`) oraz bramka bannera per wpis (`34e8837`) — wyszedł na gałęzi **`C10X-28-ai-candidate-generation-test-2`**, jako Faza 1 i Faza 4 §1 zmiany `ai-candidate-generation-test-2`. Wszystkie commity noszą scope `(C10X-28)`, więc **`git log` nie wspomina C10X-34 ani `auth-error-copy`** i ten wiersz jest jedynym miejscem, gdzie ta atrybucja jest widoczna z roadmapy. Ta linia zastępuje wcześniejszą instrukcję „podnieś Fazę 1 i 4 §1 dosłownie", która po zamknięciu tamtej zmiany kazałaby zaimplementować kod już istniejący. Dowód i pułapki wykonawcze (opisane wyżej — one nadal są prawdziwe i warto je przeczytać przed dotknięciem tych plików): `context/changes/ai-candidate-generation-test-2/verification.md` § Faza 1 i § Faza 4, po archiwizacji `context/archive/<data>-ai-candidate-generation-test-2/`.
- **Status:** not started — **etykieta, nie stan faktyczny.** Kod jest na miejscu; otwarte pozostaje wyłącznie domknięcie **C10X-34** w Jirze. Status zostaje nietknięty, bo flip należy do `/10x-archive` (patrz nota pod `## Done`) — a ten go tu **nie zrobi**, bo dopasowuje po `Change ID`, a ta praca wyszła pod `ai-candidate-generation-test-2`, nie pod `auth-error-copy`. **Zostawione świadomie, decyzja właściciela z 2026-07-26 przy triage'u impl-review (F3): ten wiersz zmieni się wtedy, gdy autor dojdzie do H-03.** To jest odroczenie, nie przeoczenie — nie „naprawiaj" go mimochodem przy innej zmianie.

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
- **H-05: (hardening) użytkownik nigdy nie trafia na aplikację działającą przeciw bazie, której brakuje migracji z wdrożonego kodu — CI zatrzymuje deploy, zanim Worker wyjdzie, zamiast pozwolić mu wystartować i wywalić się na pierwszym zapisie.** — Archived 2026-07-28 → `context/archive/2026-07-27-schema-drift-test/`. Lesson: —.

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
