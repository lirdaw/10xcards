---
date: 2026-07-09 (Europe/Warsaw)
researcher: lirdaw
git_commit: 32c4270442def2d5162a701ee3b7a2c76cf67098
branch: main
repository: 10xcards
topic: "Grounding decyzji ts-fsrs / FSRS-6 w obecnym kodzie 10xCards pod slice S-03 srs-study-session"
tags: [research, codebase, srs, fsrs, ts-fsrs, flashcard, deck, supabase, rls]
status: complete
last_updated: 2026-07-09
last_updated_by: lirdaw
---

# Research: Grounding ts-fsrs / FSRS-6 w kodzie 10xCards pod S-03

**Date**: 2026-07-09 (Europe/Warsaw)
**Researcher**: lirdaw
**Git Commit**: 32c4270442def2d5162a701ee3b7a2c76cf67098
**Branch**: main
**Repository**: 10xcards

## Research Question

Ugruntowanie decyzji z `srs-library-research.md` (wybrana: `ts-fsrs` / FSRS-6) w obecnym
kodzie 10xCards pod nadchodzący slice **S-03 `srs-study-session`**. NIE wybieramy biblioteki
— jest wybrana; weryfikujemy tylko, czy wpasuje się w projekt. Cztery obszary:

1. **Model danych i schemat** — gdzie żyją encje Flashcard/Deck, aktualny schemat w `supabase/`,
   gdzie logicznie usiądą pola harmonogramu FSRS (`stability, difficulty, due, state, reps,
   lapses, last_review`) oraz osobna tabela historii pod `ReviewLog`.
2. **Persystencja i RLS** — wzorce zapisu/odczytu, scoping RLS per-user z F-01, zasada
   „no `service_role` in `src/`", 404-not-403 — pod przyszłe kolumny i zapytania „due <= now".
3. **Punkty styku dla S-03** — czy istnieje przepływ pobierania kart po decku, pojęcie „due",
   konwencje tras/SSR loaderów/UI dla sesji nauki z 4 przyciskami Again/Hard/Good/Easy.
4. **Ograniczenia z foundation** — które decyzje z `context/foundation/` już przesądzają kształt
   tego obszaru.

## Summary

**Werdykt: `ts-fsrs` (FSRS-6) wpasowuje się w projekt bez tarć — pod warunkiem świadomego
rozdzielenia dwóch różnych „state".** Kluczowe ustalenia:

- **Zgodność ze stackiem jest realna, nie tylko deklarowana.** Projekt to Astro 6 na runtime
  Cloudflare `workerd`, a `ts-fsrs` jest czystym TS zero-dependency — te same własności, które
  przeszły już przez lekcje wdrożeniowe projektu. `ts-fsrs` **nie jest jeszcze zainstalowany**
  (`package.json`, brak `node_modules/ts-fsrs`) — dojdzie w S-03.
- **Fundament danych istnieje, warstwa SRS jest greenfield.** Tabela `flashcard` (z RLS przez
  join do `deck`) jest gotowa, ale **nie ma żadnej kolumny harmonogramu** (`due`, `stability`,
  `difficulty`, `reps`, `lapses`, `last_review`, FSRS-`state`) ani tabeli `ReviewLog`.
- **Kolizja pojęcia „state" — twarde ryzyko.** Istniejące `flashcard.state_id` → słownik
  `flashcard_state ('generated'|'accepted'|'rejected')` to **cykl akceptacji AI**, a NIE stan
  powtórki. FSRS ma własny `state` (`New/Learning/Review/Relearning`). To dwie ortogonalne osie —
  nie wolno ich łączyć w jedną kolumnę.
- **Zapytanie „due <= now" dziedziczy izolację za darmo.** Kolumny dodane do `flashcard`
  automatycznie podlegają istniejącej polityce `flashcard_select` (własność przez join do `deck`),
  więc `due <= now` w danej talii pozostaje per-user bez nowej polityki.
- **Brak jakiegokolwiek przepływu kart.** `src/lib/decks.ts` to wyłącznie CRUD talii; nie ma
  funkcji pobierającej fiszki, trasy `/study`, ani UI oceny. Menu „Nauka" w Sidebarze jest
  jawnie wyłączone. S-03 buduje tę warstwę od zera na istniejących konwencjach (public_id routing,
  natywny POST→redirect, SSR loader, Modal, Button variants).
- **Prerekwizyt kolejności:** warstwę zapytań o fiszki wnosi **S-02 `manual-card-crud`** (status
  `proposed`), który jest prerekwizytem S-03 w roadmapie. Dziś ta warstwa nie istnieje.

## Detailed Findings

### 1. Model danych i schemat

**Encje żyją w trzech miejscach: migracja → wygenerowane typy → warstwa zapytań.**

- Schemat rdzenny: `supabase/migrations/20260705180246_init_core_schema.sql` (jedyna migracja).
  - Tabela `deck` — `supabase/migrations/20260705180246_init_core_schema.sql:41-49`: `id bigint
    identity(start 100000)`, `public_id uuid unique`, `user_id uuid FK→auth.users`, `name`
    (check 1–100), `created_at/updated_at`, unikat `(user_id, name)`.
  - Tabela `flashcard` — `...init_core_schema.sql:57-66`: `id bigint`, `public_id uuid`,
    `deck_id bigint FK→deck`, `state_id smallint FK→flashcard_state`, `front`/`back` (check >0),
    `created_at/updated_at`. **Zero kolumn harmonogramu SRS.**
  - Słownik `flashcard_state` — `...init_core_schema.sql:25-34`: `(1,'generated') (2,'accepted')
    (3,'rejected')`. `state_id` jest **NOT NULL bez DEFAULT** (`:21-23`) — jawny przy insert
    (S-02→accepted, S-04→generated).
- Typy wygenerowane (skryptem `db:types` z lokalnej bazy): `src/db/database.types.ts`.
  - `deck` Row — `src/db/database.types.ts:38-45`; `flashcard` Row — `src/db/database.types.ts:65-74`;
    `flashcard_state` Row — `src/db/database.types.ts:113-116`.
  - **Brak enumów Postgres** — `public.Enums` pusty (`src/db/database.types.ts:134-136`,
    `Constants` `:260-267`). Stan fiszki to tabela-słownik + FK, nie enum. Nie ma kolumny
    `source` (AI vs manual) — jest tylko `state_id`.
  - **Brak ręcznych DTO** — nie ma `src/types.ts` ani `src/types/`. Jedyny domenowy typ to
    `App.Locals.user` (`src/env.d.ts:1-5`) i lokalny alias `type Client = SupabaseClient<Database>`
    w `src/lib/decks.ts:9`.
- Warstwa zapytań: `src/lib/decks.ts:11-33` — `listDecks/getDeckByPublicId/deckNameExists/
  createDeck/renameDeck/deleteDeck`. **Żadnej funkcji o fiszki.**

**Gdzie logicznie usiądą pola FSRS** (ugruntowanie, nie decyzja — patrz Open Questions):

- Pola `stability, difficulty, due, reps, lapses, last_review` + FSRS-`state` opisują **jedną
  kartę 1:1** i naturalnie należą do wierszа `flashcard` (rozszerzenie tabeli kolumnami), tak jak
  `Card` z ts-fsrs serializuje się 1:1 do kolumn (`ts-fsrs-api-reference.md:14-31`). To pasuje do
  istniejącego wzorca „jedna tabela = jedna encja", w którym `state_id` też jest wprost kolumną.
- **Kolizja nazw do rozstrzygnięcia w planie S-03:** FSRS-`state` (0–3: New/Learning/Review/
  Relearning, `ts-fsrs-api-reference.md:63-73`) to inna oś niż istniejący `state_id`
  (generated/accepted/rejected). Trzymać jako osobne kolumny pod różnymi nazwami (np.
  `srs_state` vs `state_id`), by uniknąć pomyłki — słownik `flashcard_state` zostaje przy cyklu
  akceptacji AI.
- `Card` operuje natywnymi `Date`; do DB → `timestamptz` (`due`, `last_review`), FSRS-`state` →
  `smallint` 0–3, `stability/difficulty` → `numeric/double` (`ts-fsrs-api-reference.md:190-207`).
  `createEmptyCard()` daje `due=now, state=New, stability=0, difficulty=0, reps=0, lapses=0`
  (`ts-fsrs-api-reference.md:33-48`) — dobre wartości startowe dla insertu nowej karty.
- **`ReviewLog` → osobna tabela historii** (jeden wiersz na powtórkę): kształt w
  `ts-fsrs-api-reference.md:99-111`. Potrzebna do `rollback` (cofnięcie oceny), `reschedule`
  (przeliczenie z historii) i jako dowód trwałości harmonogramu (guardrail PRD „żadna karta nie
  ginie"). W DB wymaga FK→`flashcard` i własnej polityki RLS (patrz obszar 2). Nowa migracja.

### 2. Persystencja i RLS

**Wzorzec zapisu/odczytu:** jeden SSR klient RLS-scoped, współdzielony przez strony i endpointy.

- `createClient(headers, cookies)` — `src/lib/supabase.ts:6-25`, `createServerClient<Database>`
  z `@supabase/ssr`, klucze z `astro:env/server`; **zwraca `null` gdy brak env** (stąd guardy
  `if (!supabase)`). Funkcje w `src/lib/decks.ts` przyjmują gotowego klienta.
- **Brak osobnego klienta serwerowego/admina; brak `service_role` w kodzie.** Migracja jawnie
  zakazuje: „Nie wolno wprowadzać klienta service-role dla ścieżek użytkownika"
  (`...init_core_schema.sql:88-89`). Wszystko idzie przez anon `SUPABASE_KEY` + JWT usera.

**RLS per-user (F-01):**

- `deck` — polityki `deck_select/insert/update/delete` z `using (user_id = (select auth.uid()))`
  — `...init_core_schema.sql:109-120`. Deny-by-default (`:86-93`).
- `flashcard` — własność **przez join do talii**: `flashcard_select/insert/update/delete`
  z `exists (select 1 from deck d where d.id = flashcard.deck_id and d.user_id = (select
  auth.uid()))` — `...init_core_schema.sql:126-142`. **To jest kluczowe dla S-03:** kolumny
  harmonogramu dodane do `flashcard` **automatycznie** dziedziczą tę izolację; zapytanie o karty
  „należne dziś" (`due <= now`) w danej talii pozostaje per-user bez nowej polityki.
- **`ReviewLog` będzie potrzebował własnej polityki** (nie dziedziczy jej z `flashcard`) — wzorzec
  do skopiowania: join do `deck` przez `flashcard` (analogicznie do `flashcard_select`).
- `(select auth.uid())` jako initPlan (raz na zapytanie) — zalecenie wydajnościowe Supabase
  (`...init_core_schema.sql:106-108`); trzymać ten sam wzorzec w politykach `ReviewLog`.

**404-not-403** (spójnie stosowany, ważny pod „due"-loader S-03):

- Strona talii: `null` (nie istnieje LUB RLS ukrył cudzą) → `Astro.response.status = 404`,
  render warunkowy, **nie** top-level `return` — `src/pages/decks/[publicId]/index.astro:10-19`.
- Rename: `!updated` → `Response(status:404)` — `src/pages/api/decks/[publicId].ts:51-54`.
  Malformed UUID → 404 przed nagłówkiem `Location` (`:17-19`).
- Delete cudzej talii dotyka 0 wierszy (cichy no-op) — `src/pages/api/decks/[publicId]/delete.ts:8-9`.

### 3. Punkty styku dla S-03

**Czy istnieje przepływ pobierania kart / „due" / sesja nauki? NIE — greenfield.** Przeszukanie
`src/` po `study|session|due|review|srs|fsrs|flashcard|card` nie znalazło logiki powtórek.

- Menu „Nauka" **wyłączone** — `src/components/Sidebar.astro:11` (`href: null, enabled: false`,
  tytuł „Dostępne wkrótce"). Brak trasy `/study`. S-03 włączy tę pozycję.
- Strona talii **nie listuje kart** — statyczny placeholder „Brak fiszek w tej talii"
  (`src/pages/decks/[publicId]/index.astro:67-69`). Brak zapytania o fiszki.
- Tabela `flashcard` istnieje, ale bez pól terminu — `src/db/database.types.ts:65-74`.

**Konwencje, na których oprze się S-03** (istnieją i są spójne):

- **Routing przez `public_id` (UUID), nigdy wewnętrzny `bigint id`** — `src/lib/decks.ts:5-7`,
  migracja `:9`. Walidacja param regexem UUID: `src/pages/api/decks/[publicId].ts:7,17`. Sesja
  nauki powinna adresować talię/kartę przez `public_id`.
- **Ochrona tras** — `PROTECTED_ROUTES = ["/dashboard","/decks","/api/decks"]`
  (`src/middleware.ts:4`); trzeba dopisać prefiks nauki (np. `/study`, `/api/study`).
  `locals.user` ustawiany przez `supabase.auth.getUser()` (`src/middleware.ts:7-16`).
- **Layout + nawigacja** — `AuthenticatedLayout.astro` (prop `activeItem?: "decks"|"generate"|
  "study"` — `src/layouts/AuthenticatedLayout.astro:7`) już przewiduje pozycję „study".
- **SSR loader (data vs error vs empty)** — wzorzec w `src/pages/decks/index.astro:8` oraz
  `[publicId]/index.astro:16-19`. **Uwaga (lekcja):** obecne loadery destrukturyzują tylko
  `{ data }` i **ignorują `{ error }`** — S-03 powinien rozgałęziać na `error` (odrębny stan
  „coś poszło nie tak"), zgodnie z lekcją „Loadery SSR rozróżniają błąd od braku danych".
- **Mutacje: natywny form POST → endpoint `/api/...` → `context.redirect` (PRG)**, nie fetch —
  create `src/components/decks/CreateDeckModal.tsx:61` + `src/pages/api/decks/index.ts:11-45`;
  błąd round-trip przez `?error=...&open=...`. **Uwaga:** dla sesji nauki z szybkim ocenianiem
  4 przyciskami natywny POST→pełne przeładowanie może być zbyt ciężki UX — to punkt do decyzji
  w planie (POST-per-ocena vz. island z fetch); patrz Open Questions.
- **UI prymitywy gotowe do reużycia:** `Button` + `buttonVariants` (warianty default/destructive/
  outline/secondary/ghost/link — `src/components/ui/button.tsx:7-50`) na 4 przyciski Again/Hard/
  Good/Easy; `Modal` = natywny `<dialog>` (`src/components/ui/Modal.tsx:12-55`); `Card`
  (`src/components/ui/card.tsx`, dziś nieużywany) na widok karty. **Brak dedykowanego komponentu
  oceny/rating** — do zbudowania.
- **API ts-fsrs pod pętlę nauki** (referencja): `createEmptyCard()` przy tworzeniu karty,
  `repeat(card, now)` do podglądu interwałów na 4 przyciskach, `next(card, now, rating)` do
  zastosowania oceny (zwraca `{card, log}`) — `ts-fsrs-api-reference.md:75-89,118-128`. Skala
  `Rating.Again(1)/Hard(2)/Good(3)/Easy(4)` (`ts-fsrs-api-reference.md:50-61`).

### 4. Ograniczenia z foundation (co już przesądzone)

- **Buy, nie build** — PRD §Non-Goals: „No custom spaced-repetition algorithm" (gotowa
  biblioteka). Roadmap F-02 potwierdza: decyzja typu „buy", bez kodu algorytmu.
- **Skala oceny = 4-stopniowa Again/Hard/Good/Easy** — domyka PRD Open Question #2; ustalone w
  `srs-library-research.md:47-50,65`. UI sesji nauki ma dokładnie 4 przyciski.
- **Pola harmonogramu do modelu** — `srs-library-research.md:66-67`: `stability, difficulty, due,
  state, reps, lapses, last_review` (+ opcjonalnie `elapsed_days, scheduled_days`).
- **Domyślne parametry** — `request_retention = 0.9`, `maximum_interval = 36500`
  (`srs-library-research.md:68`; `ts-fsrs-api-reference.md:178-188` — użyć `generatorParameters()`,
  nie budować ręcznie).
- **S-03 to gwiazda przewodnia (north star), cel projektu `quality`** — roadmap `roadmap.md:30-40,
  148-158`: pełna pętla nauki dowodzi najtwardszego guardrailu „poprawność i trwałość
  harmonogramu". Prereki: **F-01, F-02, S-02** (`roadmap.md:51,153`).
- **Test poprawności harmonogramu jest twardym warunkiem odbioru S-03** i powstaje na harnessie
  z F-03 (`roadmap.md:114,157`). F-03 (`verification-harness`) ma status `proposed`.
- **Data isolation / prywatność / trwałość harmonogramu** — PRD Guardrails i NFR: harmonogram nie
  gubi kart i się nie psuje; to wprost motywuje wybór FSRS (rozdział `stability`/`difficulty`,
  `rollback`/`reschedule`) w `srs-library-research.md:41-56`.
- **Stack** — `tech-stack.md`: Astro + React + Supabase + Cloudflare Workers; `has_ai: true`,
  `has_realtime/has_background_jobs: false`. Runtime edge `workerd` (README) — zgodne z zero-dep
  `ts-fsrs`.

## Code References

- `supabase/migrations/20260705180246_init_core_schema.sql:41-49` — tabela `deck`.
- `supabase/migrations/20260705180246_init_core_schema.sql:57-66` — tabela `flashcard` (bez pól SRS).
- `supabase/migrations/20260705180246_init_core_schema.sql:25-34` — słownik `flashcard_state` (AI lifecycle).
- `supabase/migrations/20260705180246_init_core_schema.sql:126-142` — RLS `flashcard` przez join do `deck`.
- `supabase/migrations/20260705180246_init_core_schema.sql:88-89` — zakaz `service_role` dla ścieżek usera.
- `src/db/database.types.ts:65-74` — typ Row `flashcard`.
- `src/db/database.types.ts:134-136` — brak enumów Postgres.
- `src/lib/supabase.ts:6-25` — jedyny helper klienta SSR (null gdy brak env).
- `src/lib/decks.ts:11-33` — warstwa zapytań talii (brak funkcji o fiszki).
- `src/middleware.ts:4,7-16` — PROTECTED_ROUTES + `locals.user`.
- `src/pages/decks/[publicId]/index.astro:10-19,67-69` — 404-not-403 + placeholder „Brak fiszek".
- `src/pages/decks/index.astro:8` — SSR loader ignorujący `error` (do poprawy w S-03).
- `src/pages/api/decks/index.ts:11-45` — wzorzec mutacji POST→redirect.
- `src/components/Sidebar.astro:11` — pozycja „Nauka" wyłączona.
- `src/components/ui/Modal.tsx:12-55`, `src/components/ui/button.tsx:7-50` — prymitywy UI pod S-03.
- `context/changes/srs-library-choice/ts-fsrs-api-reference.md:14-128` — API `Card`/`Rating`/
  `State`/`ReviewLog`/scheduler pod implementację.
- `context/changes/srs-library-choice/srs-library-research.md:62-71` — decyzje wynikowe (biblioteka,
  skala, pola, parametry, API).
- `package.json` — `ts-fsrs` NIEobecny; skrypt `db:types` generuje typy z lokalnej bazy.

## Architecture Insights

- **Progresywne odsłanianie schematu jest zaprojektowane.** F-01 celowo dostarczył tylko rdzeń
  Deck/Flashcard; roadmap wprost mówi „pola harmonogramu SRS w S-03" (`roadmap.md:93`). Dodanie
  kolumn FSRS to oczekiwany kolejny krok, nie łamanie fundamentu.
- **RLS przez join to nośnik izolacji dla całej gałęzi kart.** Dowolna nowa kolumna na
  `flashcard` dziedziczy izolację za darmo; każda **nowa tabela** (ReviewLog) musi replikować
  wzorzec join-do-deck jawnie — deny-by-default nie da jej dostępu automatycznie.
- **Dwie ortogonalne osie stanu.** `flashcard_state` (akceptacja AI) i FSRS-`state` (faza
  powtórki) muszą współistnieć jako osobne kolumny; łączenie ich to najczęstszy błąd modelowania
  przy wchodzeniu FSRS na istniejący schemat fiszek.
- **Wzorzec „gotowy klient → funkcja zapytania" skaluje się na fiszki.** S-02/S-03 powinny dodać
  `src/lib/flashcards.ts` (albo `study.ts`) w tym samym kształcie co `src/lib/decks.ts`
  (funkcje przyjmujące `SupabaseClient<Database>`), zamiast wołać Supabase inline.
- **Konwersja Date↔DB jest rozwiązana po stronie ts-fsrs** (`afterHandler`, `TypeConvert.*`,
  `CardInput` przyjmujące string/ms) — persystencja na `timestamptz` nie wymaga własnego mapowania.
- **UX oceniania to jedyny realny punkt tarcia z istniejącą konwencją mutacji.** Cały projekt
  używa natywnego POST→pełny redirect; sesja nauki z szybkim klikaniem 4 przycisków może tego
  wzorca nie znieść bez re-renderu całej strony. To świadoma decyzja architektoniczna dla planu
  S-03, nie fakt z kodu.

## Historical Context (from prior changes)

- `context/archive/2026-07-05-per-user-data-isolation/` (F-01) — ustanowił schemat + RLS, które
  S-03 rozszerza; wzorce RLS-test (rola + JWT claims + positive control, RETURNING) w
  `context/foundation/lessons.md:47-59` obowiązują dla testów `ReviewLog`.
- `context/archive/2026-07-07-deck-workspace/` (S-01) — dostarczył konwencje public_id routing,
  POST→redirect, SSR loader, na których S-03 buduje.
- `context/foundation/lessons.md:68-73` — „Loadery SSR rozróżniają błąd od braku danych":
  bezpośrednio dotyczy loadera kart „due" w S-03.
- `context/foundation/lessons.md:82-94` — „Nie rób top-level return we frontmatterze .astro" oraz
  „Błąd formularza POST wraca do modala": obowiązują dla stron/endpointów sesji nauki.

## Related Research

- `context/changes/srs-library-choice/srs-library-research.md` — rozstrzygnięcie SM-2 vs FSRS
  i wybór `ts-fsrs` (decyzja foundation F-02).
- `context/changes/srs-library-choice/ts-fsrs-api-reference.md` — wyciąg API `ts-fsrs` pod
  implementację S-03.

## Open Questions

Rzeczy, których **nie da się potwierdzić w obecnym kodzie** — do rozstrzygnięcia w planie S-03,
nie zgadywane tutaj:

1. **Osobne kolumny vs jeden JSON `review_state`.** Kod nie przesądza — F-01 użył płaskich
   kolumn dla wszystkiego dotychczas, ale to nie jest reguła zapisana. Decyzja należy do planu
   S-03 (osobne kolumny lepiej indeksują `due <= now`; JSON jest zwięźlejszy).
2. **Kształt i RLS tabeli `ReviewLog`** — nie istnieje; wymaga nowej migracji + własnej polityki
   join-do-deck. Retencja historii (jak długo trzymać logi pod `reschedule`) nieokreślona.
3. **Kolejność względem S-02.** Roadmap czyni S-02 (`manual-card-crud`, status `proposed`)
   prerekwizytem S-03; to S-02 wnosi pierwszą warstwę zapytań o fiszki (`src/lib/flashcards.ts`?).
   Dziś ta warstwa nie istnieje — nie potwierdzono, czy S-02 ją dostarczy w kształcie, na którym
   S-03 się oprze.
4. **UX oceniania: natywny POST→redirect czy React island z fetch?** Istniejąca konwencja to
   wyłącznie natywny POST; jej przydatność do szybkiej pętli 4-przyciskowej to decyzja planu,
   nie fakt z kodu.
5. **Gdzie żyją parametry FSRS** (`request_retention`, `maximum_interval`, 21 wag `w`) — globalne
   w kodzie, per-talia w DB, czy serializowane do JSON? Nie ustalone; `srs-library-research.md`
   podaje tylko wartości domyślne, nie miejsce przechowywania.
6. **`TypeConvert.card(input)`** — użyty w hydratacji z DB, ale w `ts-fsrs-api-reference.md:198-200`
   oznaczony jako niezweryfikowany wprost w docs (dopisany przez analogię). Do potwierdzenia w
   dokumentacji ts-fsrs przed poleganiem na nim w implementacji.
7. **Test poprawności harmonogramu (twardy warunek odbioru S-03)** zależy od harnessu z F-03
   (`verification-harness`, status `proposed`) — harness jeszcze nie istnieje.
