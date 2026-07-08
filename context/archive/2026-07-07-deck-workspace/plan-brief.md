# S-01 · Talie jako prywatna przestrzeń robocza — Plan Brief

> Full plan: `context/changes/deck-workspace/plan.md`

## What & Why

Pierwszy pionowy slice produktowy: zalogowany użytkownik tworzy i nazywa własne talie i widzi
je jako prywatną przestrzeń. Slice stawia bramkowany dostęp w realnym użyciu i ćwiczy izolację
per-konto z F-01; przy okazji powstaje trwała powłoka nawigacji (Talie/Generuj/Nauka) i
kontrakt URL talii, które dziedziczą kolejne slice'y. (US-03, FR-017, FR-001, FR-002)

## Starting Point

Warstwa danych z F-01 jest gotowa: tabele `deck`/`flashcard` + RLS deny-by-default, `public_id`
uuid jako publiczny uchwyt, `name` 1–100 znaków, `UNIQUE(user_id, name)`, kaskada. Auth w pełni
podpięte (`middleware.ts` ustawia `locals.user`, klient SSR niesie sesję → zapytania RLS-scoped).
Brak jakiejkolwiek warstwy UI/API talii; z `ui/` istnieje tylko `button.tsx`; brak lewej nawigacji.

## Desired End State

Zalogowany użytkownik ląduje na `/decks` w powłoce ze stałym lewym sidebarem (Talie aktywne;
Generuj/Nauka wyłączone). Widzi tylko własne talie (lub stan pusty z CTA), tworzy je przez modal,
zmienia nazwę i usuwa z potwierdzeniem, wchodzi do talii pod `/decks/[publicId]` (stan pusty
fiszek). Cudze talie są niewidoczne (RLS + 404); niezalogowany nie wchodzi do `/decks*`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Powłoka nawigacji | Nowy `AuthenticatedLayout` + sidebar | Jedno miejsce na architekturę informacji dziedziczoną przez slice'y | Plan |
| Pozycje nawigacji | Wszystkie trzy, Generuj/Nauka wyłączone | Sygnalizuje pełną architekturę z PRD, odkrywalne | Plan |
| Nazwy tras | Angielskie `/decks`, `/decks/[publicId]` | Zgodne z konwencją identyfikatorów (AGENTS.md), UI copy PL | Plan |
| Widok startowy | Talie (signin i `/` zalogowanego → `/decks`) | PRD: „Talie" to widok startowy | Plan |
| Zakres CRUD | Pełny: create + list + rename + delete | Wybór użytkownika; talie bez kart, więc kaskada bezpieczna | Plan |
| UX tworzenia | Modal na natywnym `<dialog>` | A11y (fokus-trap/Esc) za darmo; natywny form POST w środku | Plan |
| Klik w talię | Strona `/decks/[publicId]` ze stanem pustym | Zamyka kontrakt URL, na którym zbuduje S-02 | Plan |
| Styl API | Form POST + redirect z `?error=` | Spójne z `api/auth/*`, progressive enhancement | Plan |
| Walidacja | Ręczna (trim, 1–100) + ograniczenia DB | Bez nowej zależności; DB jest backstopem | Plan |
| Duplikat nazwy | Pre-check + backstop `UNIQUE` (23505 → komunikat) | Przyjazna ścieżka; DB gwarantuje spójność mimo TOCTOU | Plan |
| Stan pusty + feedback | Stan pusty z CTA + pending (`useFormStatus`) | Prowadzi nowego użytkownika; NFR ~200 ms | Plan |
| Dostępność | Baseline teraz (nav semantyczna, fokus, etykiety) | Bazowe NFR PRD; retrofit droższy | Plan |

## Scope

**In scope:** powłoka nawigacji + sidebar; prymitywy UI (`input`/`label`/`card`/modal);
ochrona tras + redirecty (Talie = start); lista własnych talii + stan pusty; tworzenie
(modal + endpoint); strona talii `/decks/[publicId]` (stan pusty fiszek); rename; delete z
potwierdzeniem; walidacja + obsługa duplikatu; a11y baseline; ręczny dowód izolacji.

**Out of scope:** CRUD fiszek (S-02), generacja AI (S-04), nauka SRS (S-03), kosz/miękkie
usuwanie (C10X-14), wyszukiwanie/filtrowanie talii, `zod`, automatyczny test izolacji (F-03),
zmiany stron auth poza redirectem, `/dashboard`.

## Architecture / Approach

Trzy fazy, od powłoki w dół do mutacji. Wszystkie zapytania przez klienta SSR (RLS-scoped);
endpointy trzymają konwencję form POST → redirect z `?error=`. Dostęp do danych izolowany w
`src/lib/decks.ts`. Trasy operują na `public_id`, nigdy na wewnętrznym `bigint id`; brak wiersza
(nie istnieje LUB RLS ukrył cudzy) → 404. Insert ustawia `user_id = locals.user.id` (wymóg
polityki `deck_insert`).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Prymitywy UI + powłoka + routing | `AuthenticatedLayout` + sidebar, komponenty UI, ochrona tras, redirecty | Warunki chrome publiczny vs aplikacyjny; fokus w modalu |
| 2. Lista + tworzenie + strona talii | `/decks` (lista/pusty stan), modal + endpoint create, `/decks/[publicId]` | Obsługa błędu modal+redirect; 404 na obcy `public_id` |
| 3. Rename + delete + weryfikacja | Endpointy i UI rename/delete, a11y, dowód izolacji | Kolizja nazwy (23505); trwałe usunięcie |

**Prerequisites:** F-01 (done); działający lokalny stack Supabase do ręcznej weryfikacji izolacji.
**Estimated effort:** ~1–2 sesje na 3 fazy (mały slice, ale wiele warstw UI/routingu naraz).

## Open Risks & Assumptions

- RLS chroni tylko przy kliencie SSR z kluczem `anon` + sesją — żadnego service-role na
  ścieżkach użytkownika.
- Pre-check nazwy jest TOCTOU-race; `UNIQUE(user_id,name)` jest ostatecznym backstopem
  (23505 mapowane na przyjazny komunikat).
- Usuwanie jest trwałe (kosz odroczony do C10X-14); w S-01 talie nie mają kart, więc kaskada
  jest bez skutków ubocznych.
- Automatyczna weryfikacja izolacji dochodzi w F-03; w S-01 dowód jest ręczny i udokumentowany.

## Success Criteria (Summary)

- Zalogowany użytkownik tworzy, nazywa, zmienia nazwę i usuwa wyłącznie własne talie; wchodzi
  do talii pod stabilnym URL.
- Cudze talie są niewidoczne i niedostępne (lista + bezpośredni URL → 404); pozytywna kontrola:
  własne widoczne.
- Niezalogowany nie wchodzi do przestrzeni talii; `lint` + `build` + `astro sync` czyste.
