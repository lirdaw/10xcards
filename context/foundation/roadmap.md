---
project: 10xcards
version: 1
status: draft
created: 2026-07-04
updated: 2026-07-04
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

| ID    | Change ID                | Outcome (użytkownik może …)                                   | Prerequisites  | PRD refs                                   | Status   |
| ----- | ------------------------ | ------------------------------------------------------------- | -------------- | ------------------------------------------ | -------- |
| F-01  | per-user-data-isolation  | (foundation) twarda izolacja danych per-konto (RLS) + rdzenne tabele | —              | Access Control, Guardrails, NFR: prywatność | ready    |
| F-02  | srs-library-choice       | (foundation) decyzja: gotowa biblioteka SRS + skala oceny przypomnienia | —              | Non-Goals (gotowy SRS), Open Questions #2  | ready    |
| S-01  | deck-workspace           | tworzyć i nazywać własne talie (prywatna przestrzeń)          | F-01           | US-03, FR-017, FR-001, FR-002              | proposed |
| F-03  | verification-harness     | (foundation) harness testowy + test-plan.md dla dwóch ryzyk   | S-01           | Guardrails, NFR: trwałość harmonogramu     | proposed |
| S-02  | manual-card-crud         | ręcznie tworzyć, przeglądać, edytować i usuwać fiszki w talii | S-01           | US-03, FR-007, FR-008, FR-009, FR-010      | proposed |
| S-03  | srs-study-session        | uczyć się talii w sesji SRS z oceną przypomnienia (gwiazda)   | F-01, F-02, S-02 | US-02, FR-011, FR-012                     | proposed |
| S-04  | ai-candidate-generation  | wkleić tekst i wygenerować kandydatów AI z postępem i retry   | F-01, S-01     | US-01, FR-003, FR-004, FR-006, FR-018      | proposed |
| S-05  | candidate-review         | przeglądać kandydatów i akceptować/edytować/odrzucać (bulk)   | S-04           | US-01, FR-005, FR-006                       | proposed |
| S-06  | deck-keyword-search      | wyszukiwać fiszki w talii po słowie kluczowym                 | S-02           | FR-015                                      | proposed |

## Streams

Pomoc nawigacyjna — grupuje elementy dzielące łańcuch prerekwizytów. Kanoniczna kolejność
żyje w grafie zależności poniżej; ta tabela to proponowana kolejność czytania między
równoległymi torami.

| Stream | Theme                              | Chain                                        | Note                                                                      |
| ------ | ---------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| A      | Fundament i przestrzeń danych      | `F-01` → `S-01` → `F-03`                     | Izolacja per-user, pierwsza talia, i test cross-account weryfikujący `S-01`; odblokowuje resztę. |
| B      | Decyzja SRS, karty i nauka (gwiazda) | `F-02` / `S-02` → `S-03`, `S-06` obok `S-02` | Decyzja o bibliotece SRS (`F-02`) i karty ręczne (`S-02`) zbiegają się w gwiazdę `S-03`; odgałęzia od `S-01`. |
| C      | Generacja AI i przegląd            | `S-04` → `S-05`                              | Odgałęzia się od `S-01` (stream A); biegnie równolegle do `S-03`.         |

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
- **Status:** ready

### F-02: Wybór gotowej biblioteki SRS (skala oceny)

- **Outcome:** (foundation) rozstrzygnięta i zaakceptowana decyzja: która gotowa biblioteka spaced-repetition oraz jaka skala oceny przypomnienia — pojedyncza decyzja determinująca pola harmonogramu i skalę oceny dla sesji nauki. Bez kodu produktowego (decyzja typu buy, nie warstwa).
- **Change ID:** srs-library-choice
- **PRD refs:** PRD §Non-Goals (gotowy SRS zamiast własnego algorytmu), PRD Open Questions #2 (skala oceny przypomnienia)
- **Unlocks:** S-03 — odblokowuje gwiazdę przewodnią; wybór biblioteki determinuje pola harmonogramu (due / interwał / ease) oraz skalę oceny, których S-03 potrzebuje, by dało się go zaplanować.
- **Prerequisites:** —
- **Parallel with:** F-01, S-01, S-02, F-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Wydzielona z S-03, by jedyna decyzja blokująca gwiazdę stała się jawną, sekwencjonowaną i „ready" jednostką (brak prerekwizytów — można podjąć od razu). Ryzyko: wybór przesądza skalę oceny i pola harmonogramu, więc zła biblioteka = przeróbka S-03. To rozstrzygnięcie buy-vs-build na „buy" (PRD §Non-Goals), nie budowa algorytmu — dlatego foundation, nie slice.
- **Status:** ready

### F-03: Harness weryfikacyjny + test-plan (test izolacji)

- **Outcome:** (foundation) skonfigurowany runner testów i `context/foundation/test-plan.md` nazywający dwa ryzyka (izolacja per-konto, poprawność harmonogramu SRS), plus jeden realny test cross-account, który ćwiczy guardrail izolacji na zdolności dostarczonej przez S-01.
- **Change ID:** verification-harness
- **PRD refs:** Guardrails (izolacja danych, poprawność SRS), NFR: trwałość harmonogramu
- **Unlocks:** weryfikuje guardrail izolacji per-user ćwiczony przez **S-01** (test cross-account: użytkownik A nie widzi talii użytkownika B). Test poprawności harmonogramu SRS jest jawnie odłożony do **S-03** — powstanie razem z pętlą nauki, gdy będzie co sprawdzać. (Uwaga: to „ścieżka weryfikacji", nie krawędź odblokowująca — F-03 biegnie PO S-01.)
- **Prerequisites:** S-01
- **Parallel with:** F-02, S-02, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sekwencjonowana PO S-01, bo test izolacji nie ma czego sprawdzać, dopóki nie istnieje pierwsza realna zdolność per-user (tworzenie talii). Zakres świadomie minimalny przy `top_blocker=capacity`: harness + `test-plan.md` (wymagany deliverable z shape-notes) + jeden test izolacji; test SRS dochodzi z S-03. Nie kompletuje "warstwy testów" z góry.
- **Status:** proposed

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
- **Status:** proposed

### S-02: Ręczne CRUD fiszek w talii

- **Outcome:** użytkownik ręcznie tworzy fiszkę (front/back), przegląda listę fiszek w talii, edytuje i trwale usuwa dowolną fiszkę.
- **Change ID:** manual-card-crud
- **PRD refs:** US-03, FR-007, FR-008, FR-009, FR-010
- **Prerequisites:** S-01
- **Parallel with:** F-02, F-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Najtańsza ścieżka do istnienia kart nadających się do nauki (karty ręczne wchodzą w standardowy cykl statusów), więc odblokowuje gwiazdę S-03 bez czekania na gałąź AI. Reject ≠ delete — dwie odrębne operacje, pilnować spójności ze statusem.
- **Status:** proposed

### S-03: Sesja nauki SRS (gwiazda przewodnia)

- **Outcome:** użytkownik rozpoczyna sesję nauki, w której gotowy algorytm SRS wybiera karty należne dziś, ocenia przypomnienie na każdej karcie, a harmonogram przeżywa między sesjami (żadna karta nie ginie, harmonogram się nie psuje).
- **Change ID:** srs-study-session
- **PRD refs:** US-02, FR-011, FR-012
- **Prerequisites:** F-01, F-02, S-02
- **Parallel with:** S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Gwiazda przy celu `quality`; plasowana tak wcześnie, jak pozwalają prerekwizyty (po S-02 i po decyzji F-02). Decyzja o bibliotece SRS i skali oceny żyje teraz w F-02 (prereq), więc slice jest w pełni planowalny, gdy F-02 i S-02 są gotowe — nie jest już `blocked`. Test poprawności harmonogramu (na harness z F-03) jest tu twardym warunkiem odbioru.
- **Status:** proposed

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
- **Status:** proposed

### S-05: Przegląd i kuracja kandydatów

- **Outcome:** użytkownik przegląda wygenerowanych kandydatów i akceptuje, edytuje lub odrzuca każdego — pojedynczo albo zbiorczo (bulk); zaakceptowane karty stają się częścią talii nadającą się do nauki.
- **Change ID:** candidate-review
- **PRD refs:** US-01, FR-005, FR-006
- **Prerequisites:** S-04
- **Parallel with:** S-03, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Domyka pętlę generacji do statusu `accepted` (druga połowa US-01) i wprost produkuje metrykę akceptacji. Bulk vs pojedyncza akcepta — pilnować, by tryb zbiorczy nie omijał kontroli per-karta, która daje metrykę.
- **Status:** proposed

### S-06: Wyszukiwanie fiszek w talii po słowie kluczowym

- **Outcome:** użytkownik wpisuje frazę i zatwierdza (Enter); dopasowanie to proste wyszukiwanie podłańcucha w `front` i `back` kart w danej talii.
- **Change ID:** deck-keyword-search
- **PRD refs:** FR-015
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Mały, samodzielny slice odczytu; celowo bez rankingu i bez live-as-you-type (to FR-019, parked). Niskie ryzyko; dobry kandydat na tor równoległy przy ograniczeniu przepustowości.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                | Suggested issue title                                  | Ready for `/10x-plan` | Notes |
| ---------- | ------------------------ | ------------------------------------------------------ | --------------------- | ----- |
| F-01       | per-user-data-isolation  | Izolacja danych per-konto (RLS) + rdzenne tabele       | yes                   | Rekomendowany pierwszy ruch; odblokowuje S-01/S-03/S-04 |
| F-02       | srs-library-choice       | Wybór gotowej biblioteki SRS + skala oceny             | yes                   | Decyzja odblokowująca gwiazdę S-03; można podjąć od razu |
| S-01       | deck-workspace           | Tworzenie i nazywanie prywatnych talii                 | no                    | Czeka na F-01 |
| F-03       | verification-harness     | Harness testowy + test-plan (test izolacji)            | no                    | Czeka na S-01 |
| S-02       | manual-card-crud         | Ręczne CRUD fiszek w talii                             | no                    | Czeka na S-01 |
| S-03       | srs-study-session        | Sesja nauki SRS (gwiazda przewodnia)                   | no                    | Czeka na F-02 (decyzja SRS) + S-02 |
| S-04       | ai-candidate-generation  | Generacja kandydatów AI z wklejonego tekstu            | no                    | Czeka na F-01, S-01 |
| S-05       | candidate-review         | Przegląd i kuracja kandydatów (accept/edit/reject)     | no                    | Czeka na S-04 |
| S-06       | deck-keyword-search      | Wyszukiwanie fiszek po słowie kluczowym                | no                    | Czeka na S-02 |

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
