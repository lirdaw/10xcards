# Wyszukiwanie fiszek w talii po słowie kluczowym (S-06 / C10X-9) Implementation Plan

## Overview

Dodajemy wyszukiwanie fiszek w obrębie jednej talii po słowie kluczowym (FR-015). Użytkownik
wpisuje frazę w toolbarze widoku talii i zatwierdza Enterem; strona przeładowuje się z
parametrem `?q=`, a loader SSR filtruje karty przez dopasowanie podłańcucha (substring) w polach
`front` i `back`. Dopasowanie jest **case-insensitive i accent-insensitive** (polskie „zaba"
znajduje „żaba"), realizowane funkcją RPC w Postgresie. Bez rankingu trafności i bez
live-as-you-type (to FR-019, parked).

## Current State Analysis

Widok pojedynczej talii to `src/pages/decks/[publicId]/index.astro` (route `/decks/:publicId`,
keyed by `public_id` uuid). Loader we frontmatterze:

- tworzy klienta SSR (`createClient`), rozwiązuje talię (`getDeckByPublicId`) i ładuje karty przez
  `listFlashcards(supabase, deck.id)` (`src/lib/flashcards.ts:59`), mapując wiersze na
  `FlashcardView[]` (`index.astro:36-49`);
- już czyta parametry URL (`error`, `open`, `edit`, `saved`) i kształtuje render (`index.astro:56-64`);
- pilnuje dyscypliny **błąd-vs-pusto**: osobny stan błędu, nigdy 404/pusto na przejściowy błąd DB
  (lessons: „Loadery SSR rozróżniają błąd zapytania od braku danych").

Lista renderuje się w jednej wyspie `FlashcardWorkspace` (`client:load`), która dostaje karty jako
**propsy** (bez client-fetch) i trzyma tylko stan UI. Trójdrożny branch stanu:
error / `cards.length === 0` / grid (`FlashcardWorkspace.tsx:94-127`).

Toolbar `DeckContentToolbar.tsx` ma **zarezerwowane miejsce** na search box (komentarz w linii 17:
„S-06 (C10X-9): keyword search input mounts in this row").

Zapytania fiszek żyją w `src/lib/flashcards.ts` (helpery przyjmujące gotowego klienta RLS-scoped;
karty adresowane po `public_id`, wewnętrzny `bigint id` nigdy nie wychodzi na front). Izolacja
per-user jest egzekwowana **wyłącznie przez RLS** (`flashcard_select` join po `deck.user_id =
auth.uid()`, migracja `20260705180246_init_core_schema.sql:126`), nie przez `user_id` w zapytaniu.

W całym kodzie **nie ma** użycia `.ilike/.or/.textSearch` ani rozszerzenia `unaccent` — jesteśmy
pierwsi.

## Desired End State

Na widoku talii jest pole wyszukiwania. Po wpisaniu frazy i Enterze strona pokazuje tylko karty tej
talii, których `front` lub `back` zawiera frazę (ignorując wielkość liter i polskie diakrytyki), z
licznikiem trafień; przy zerze trafień jest odrębny komunikat i „Wyczyść"; puste pole pokazuje pełną
listę. Weryfikacja: wpisanie frazy pasującej do części karty zawęża listę; wariant bez ogonków
znajduje kartę z ogonkami; zapytanie ze znakami `%`/`(`/`,` nie wywala zapytania i traktowane jest
dosłownie; talia innego użytkownika pozostaje niewidoczna (RLS).

### Key Discoveries:

- Helper listy do rozszerzenia: `src/lib/flashcards.ts:59-65` (`listFlashcards`).
- Loader już czyta `Astro.url.searchParams` — dokładamy `q` obok istniejących (`index.astro:56-64`).
- Wyspa dostaje karty propsami; `useEffect` strippuje `open/edit/error/saved` z URL, ale **nie**
  `q` — to dobrze, `q` musi zostać w URL, by filtr i wpisana fraza przetrwały (`FlashcardWorkspace.tsx:53-67`).
- `unaccent` (jednoargumentowy) jest `STABLE`, więc **nie** wejdzie do buildera `.or().ilike()` ani
  do indeksu — potrzebny `IMMUTABLE` wrapper na dwuargumentową formę `unaccent(regdictionary, text)`.
- Styl migracji: rozszerzenia w schemacie `extensions`, RLS deny-by-default, granty tylko dla
  `authenticated` (`20260705180246_init_core_schema.sql`).

## What We're NOT Doing

- **Bez rankingu trafności i bez live-as-you-type** (FR-019, parked) — dopasowanie na zatwierdzenie.
- **Bez przenoszenia `?q` przez endpointy mutacji** (create/edit/delete): po dodaniu/edycji/usunięciu
  karty wracamy do pełnej, niefiltrowanej listy. Trzyma slice w seamie wyszukiwania (lessons:
  „Poleruj tylko własne komponenty slice'a") i gwarantuje, że nowo dodana karta jest zawsze widoczna.
- **Bez filtrów po stanie / zakresie dat** (FR-014, parked) i bez filtra po statusie powtórki (FR-016).
- **Bez nowego endpointu API** — wyszukiwanie to odczyt na istniejącym seamie loadera (GET `?q`).
- **Bez indeksu wydajnościowego** — talie MVP są małe; sekwencyjny skan z `f_unaccent` wystarcza.
  Indeks wyrażeniowy to świadomie odłożona optymalizacja (patrz Performance Considerations).

## Implementation Approach

Server-side, zgodnie z modelem redirect-driven bez fetch. Loader czyta `?q`; przy pustym `q` używa
istniejącego `listFlashcards` (ścieżka bez zmian), przy niepustym woła nowy helper `searchFlashcards`,
który wywołuje funkcję RPC `search_flashcards_in_deck(p_deck_id, p_query)`. Funkcja robi
accent-insensitive `ILIKE` na `f_unaccent(front)`/`f_unaccent(back)`, zwraca dokładnie te same
publiczne kolumny co `listFlashcards` (bez wewnętrznego `id`) w tej samej kolejności `created_at desc`,
i jako `SECURITY INVOKER` respektuje RLS. Escapowanie metaznaków LIKE (`\ % _`) dzieje się w funkcji.
UI: `<form method="GET">` w toolbarze (Enter zatwierdza), licznik trafień i odrębny stan „brak
wyników" z „Wyczyść" w wyspie.

## Critical Implementation Details

- **`unaccent` musi być owinięty we własną, jawnie `IMMUTABLE` funkcję.** Jednoargumentowy
  `unaccent(text)` jest `STABLE` (zależny od bieżącego słownika), więc Postgres odrzuci go w
  kontekście wymagającym `IMMUTABLE`. Dwuargumentowa forma `unaccent('unaccent', text)` z jawnie
  wskazanym słownikiem eliminuje zależność od domyślnego słownika — ale to nie ona „jest IMMUTABLE"
  automatycznie: to **nasz wrapper `f_unaccent` jest jawnie zadeklarowany `immutable`** (przyjęta,
  poprawna praktyka, bo słownik unaccent jest stały). Kluczowe przy implementacji: zachować jawny
  `immutable` na wrapperze — nie polegać na „dziedziczeniu" immutability z formy dwuargumentowej.
  Ten jawny `IMMUTABLE` wrapper jest też warunkiem, by w przyszłości dało się założyć indeks
  wyrażeniowy (FR-019).
- **RPC zwraca własną projekcję, nie `setof flashcard`.** Deklaracja `returns table(public_id …)` z
  pięcioma publicznymi kolumnami trzyma wewnętrzny `bigint id` po stronie serwera (spójnie z
  `listFlashcards`, który selektuje dokładnie te kolumny).
- **`SECURITY INVOKER` (domyślne) jest wymagane — nie `SECURITY DEFINER`.** Funkcja odpytuje
  `flashcard`, więc RLS `flashcard_select` (join po właścicielu) dalej filtruje do kart użytkownika.
  `SECURITY DEFINER` obszedłby RLS i złamał guardrail izolacji — nie używać.

## Phase 1: Warstwa danych (migracja + typy + helper)

### Overview

Rozszerzenie `unaccent`, `IMMUTABLE` wrapper, funkcja RPC wyszukująca, regeneracja typów i helper
TS wołający RPC. Po tej fazie da się wyszukiwać z konsoli/RPC, zanim powstanie UI.

### Changes Required:

#### 1. Migracja bazy

**File**: `supabase/migrations/<timestamp>_deck_keyword_search.sql` (nowy plik; wygeneruj znacznik
przez `supabase migration new deck_keyword_search`)

**Intent**: Włączyć `unaccent`, dodać `IMMUTABLE` wrapper i funkcję RPC do accent-insensitive
wyszukiwania podłańcucha w obrębie talii, zachowując RLS i publiczną projekcję kolumn. Nagłówek
komentarza w stylu istniejącej migracji (Change: deck-keyword-search, S-06, C10X-9).

**Contract**: Nowe obiekty DB: rozszerzenie `extensions.unaccent`; `public.f_unaccent(text) returns
text` (`immutable`, `strict`, `parallel safe`); `public.search_flashcards_in_deck(p_deck_id bigint,
p_query text) returns table(public_id uuid, front text, back text, created_at timestamptz,
updated_at timestamptz)` (`stable`, `security invoker`, `set search_path = ''`). Grant `execute` na
funkcję dla `authenticated`; brak grantu dla `anon`. Escape LIKE-metaznaków (`\ % _`) w `p_query`
z klauzulą `escape '\'`. Kolejność wyników `created_at desc`.

```sql
create extension if not exists unaccent schema extensions;

-- Dwuargumentowy unaccent(regdictionary, text) jest IMMUTABLE (jednoargumentowy jest STABLE).
create or replace function public.f_unaccent(text)
returns text language sql immutable strict parallel safe
set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

create or replace function public.search_flashcards_in_deck(p_deck_id bigint, p_query text)
returns table (public_id uuid, front text, back text, created_at timestamptz, updated_at timestamptz)
language sql stable security invoker
set search_path = ''
as $$
  select f.public_id, f.front, f.back, f.created_at, f.updated_at
  from public.flashcard f
  where f.deck_id = p_deck_id
    and (
      public.f_unaccent(f.front) ilike '%' ||
        public.f_unaccent(replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_')) || '%' escape '\'
      or public.f_unaccent(f.back) ilike '%' ||
        public.f_unaccent(replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_')) || '%' escape '\'
    )
  order by f.created_at desc
$$;

revoke all on function public.search_flashcards_in_deck(bigint, text) from anon;
grant execute on function public.search_flashcards_in_deck(bigint, text) to authenticated;
```

#### 2. Regeneracja typów bazy

**File**: `src/db/database.types.ts`

**Intent**: Odzwierciedlić nową funkcję RPC w wygenerowanych typach, by `supabase.rpc(...)` był
typowany (wejście `p_deck_id/p_query`, wyjście wierszy projekcji).

**Contract**: Wygeneruj z lokalnej bazy po zastosowaniu migracji: `supabase gen types typescript
--local > src/db/database.types.ts`. Sekcja `Functions` zyskuje `search_flashcards_in_deck`. Nie
edytować ręcznie.

#### 3. Helper wyszukiwania

**File**: `src/lib/flashcards.ts`

**Intent**: Dodać `searchFlashcards(supabase, deckId, query)` obok `listFlashcards`, wołający RPC —
jedno miejsce na zapytanie, spójne z konwencją „helpery own queries".

**Contract**: `export function searchFlashcards(supabase: Client, deckId: number, query: string)`
zwraca `supabase.rpc("search_flashcards_in_deck", { p_deck_id: deckId, p_query: query })` z jawnym
`.order("created_at", { ascending: false })` na wywołaniu RPC. ORDER BY zaszyty wewnątrz funkcji
set-returning NIE jest gwarantowany po opakowaniu przez PostgREST (`select * from fn(...)` bez
zewnętrznego order) — jawny `.order()` na RPC (PostgREST wspiera ordering na funkcji zwracającej
`table`) domyka kontrakt kolejności `created_at desc`, spójnie z `listFlashcards`. Kształt wyniku
(`{ data, error }`, kolumny `public_id, front, back, created_at, updated_at`) identyczny jak
`listFlashcards`, więc loader mapuje go tym samym kodem.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto: `supabase db reset` (lokalnie) bez błędów
- Typy zregenerowane i zawierają funkcję: `search_flashcards_in_deck` obecne w `src/db/database.types.ts`
- Typecheck przechodzi: `npm run lint` (ESLint type-checked; po `npx astro sync`)

#### Manual Verification:

- W Supabase Studio (SQL): `select * from search_flashcards_in_deck(<deck_id>, 'zaba')` zwraca kartę
  z „żaba" (accent-insensitive) i tylko z tej talii
- Zapytanie z metaznakami (`'50%'`, `'a_b'`, `'x(y'`) nie rzuca błędu i dopasowuje dosłownie
- Jako inny użytkownik (JWT innego usera) ta sama funkcja nie zwraca cudzych kart (RLS)

**Implementation Note**: Po zaliczeniu automated verification zatrzymaj się na manualne potwierdzenie
zapytań SQL (Studio), zanim ruszysz do Fazy 2.

---

## Phase 2: Loader + UI (parametr q, toolbar, licznik/brak wyników)

### Overview

Wpięcie wyszukiwania w loader i UI: rozgałęzienie na `?q`, pole wyszukiwania w toolbarze, licznik
trafień i odrębny stan „brak wyników" z „Wyczyść".

### Changes Required:

#### 1. Loader: odczyt `?q` i rozgałęzienie zapytania

**File**: `src/pages/decks/[publicId]/index.astro`

**Intent**: Czytać `q` z URL (obok istniejących parametrów), po `trim` rozgałęzić: pusto →
`listFlashcards` (bez zmian), niepusto → `searchFlashcards`; zachować dyscyplinę błąd-vs-pusto i
przekazać `query` do wyspy. `q` NIE trafia do `bannerError` ani nie jest strippowane.

**Contract**: `const query = (Astro.url.searchParams.get("q") ?? "").trim();` Gałąź ładowania kart
wybiera helper wg `query`; mapowanie wierszy na `FlashcardView[]` bez zmian (te same kolumny). Do
`<FlashcardWorkspace>` dochodzi prop `query={query}`. Import `searchFlashcards` z `@/lib/flashcards`.

> **Weryfikacja typów RPC (zrób PRZED założeniem „mapowanie bez zmian"):** kolumny z tabeli
> (`listFlashcards`) są NON-NULL (`front`/`back` mają `not null`), ale kolumny z funkcji
> `returns table(...)` bywają generowane przez `supabase gen types` jako `string | null`. Po
> regeneracji (Phase 1, krok 2) sprawdź kształt `Functions.search_flashcards_in_deck.Returns`.
> Jeśli którakolwiek kolumna jest `| null`, wspólny blok `.map` NIE przejdzie type-checku
> (`FlashcardView.front: string`) — wtedy dodaj wąską normalizację/guard w gałęzi search
> (albo osobne jawne mapowanie tej gałęzi), zamiast liczyć na w pełni współdzielony kod. Jeśli
> kolumny są non-null, mapowanie zostaje bez zmian.

#### 2. Toolbar: pole wyszukiwania (GET form)

**File**: `src/components/flashcards/DeckContentToolbar.tsx`

**Intent**: Zamontować w zarezerwowanym miejscu `<form method="GET">` z inputem `q` (Enter
zatwierdza, przeładowując stronę na `/decks/<publicId>?q=…`) oraz — gdy wyszukiwanie aktywne — link
„Wyczyść" do adresu talii bez `q`. Dostępność: `<label>` dla inputu (może być `sr-only`), ikona lupy
`aria-hidden`.

**Contract**: `Props` zyskuje `deckPublicId: string` i `query: string`. Form: `action={`/decks/
${deckPublicId}`}` `method="GET"`, input `name="q"` z `defaultValue={query}` (uncontrolled),
`placeholder` w stylu PL (np. „Szukaj w fiszkach…"), `aria-label`. Przycisk submit z ikoną `Search`
(lucide-react). „Wyczyść" renderowane tylko gdy `query` niepuste, jako `<a href={`/decks/
${deckPublicId}`}>`. Styl inputu przez `@/components/ui/input` + `cn()`; przyciski jak istniejący
add-card (spójny wygląd). Bez client-side JS poza natywnym submitem.

#### 3. Wyspa: licznik trafień + stan „brak wyników"

**File**: `src/components/flashcards/FlashcardWorkspace.tsx`

**Intent**: Rozszerzyć branch listy o kontekst wyszukiwania: przy aktywnym `query` i zerze kart
pokazać odrębny komunikat „Brak fiszek pasujących do „<query>"." z „Wyczyść"; przy trafieniach
pokazać nad gridem licznik z polską odmianą (wynik/wyniki/wyników). Pełny (niefiltrowany) pusty stan
„Brak fiszek w tej talii." bez zmian. Przekazać `deckPublicId` i `query` do `DeckContentToolbar`.

**Contract**: `Props` zyskuje `query: string`. Wyprowadzić `const isSearching = query.length > 0;`.
Branch: `cardsError` → bez zmian; `cards.length === 0` → gdy `isSearching` komunikat braku wyników +
`<a href={`/decks/${deckPublicId}`}>Wyczyść</a>`, inaczej istniejący pusty stan; else → gdy
`isSearching` linia licznika (`{n} {pluralizeWyniki(n)}`) nad `<ul>`. Mały helper odmiany (1 →
„wynik"; 2-4 poza 12-14 → „wyniki"; reszta → „wyników") lokalnie w pliku lub w `@/lib/utils`.
`q` pozostaje poza listą parametrów strippowanych w `useEffect` (bez zmian tej listy).

### Success Criteria:

#### Automated Verification:

- `npx astro sync` + `npm run lint` przechodzą (typy propsów zgodne)
- `npm run build` przechodzi

#### Manual Verification:

- Wpisanie frazy + Enter zawęża listę do kart z frazą w `front`/`back`; URL ma `?q=`
- Fraza bez ogonków znajduje kartę z ogonkami (np. „zaba" → „żaba")
- Zero trafień pokazuje „Brak fiszek pasujących do „<q>"." + „Wyczyść"; „Wyczyść" wraca do pełnej listy
- Licznik pokazuje poprawną polską odmianę dla 1 / 2 / 5 trafień
- Pusta/spacjowa fraza pokazuje pełną listę (brak filtra)
- Po dodaniu/edycji/usunięciu karty przy aktywnym wyszukiwaniu wracamy do pełnej, niefiltrowanej listy
- Wyszukiwanie na pustej talii pokazuje „Brak fiszek w tej talii." (nie komunikat wyszukiwania)

**Implementation Note**: Po zaliczeniu automated verification zatrzymaj się na manualne potwierdzenie
przepływu w UI przed zamknięciem slice'a.

---

## Testing Strategy

### Unit Tests:

- Brak skonfigurowanego runnera testów w repo (baseline: testy absent). Ten slice nie wprowadza
  runnera — weryfikacja przez SQL (Studio), lint/build i testy manualne. Helper odmiany liczebnika
  jest kandydatem na pierwszy unit test, gdy runner powstanie (F-03).

### Integration Tests:

- Manualny scenariusz cross-account w Studio (RLS): user B nie widzi kart usera A przez RPC.

### Manual Testing Steps:

1. Zaloguj się, wejdź w talię z kilkoma fiszkami (część z polskimi znakami).
2. Wpisz frazę pasującą do części karty + Enter → lista zawężona, `?q=` w URL, licznik zgadza się.
3. Wpisz wariant bez ogonków (np. „zaba") → karta „żaba" nadal znajdowana.
4. Wpisz frazę bez trafień → komunikat „Brak fiszek pasujących…" + „Wyczyść”; kliknij „Wyczyść" → pełna lista.
5. Wpisz frazę z `%`, `_`, `,`, `(` → brak błędu, dopasowanie dosłowne.
6. Przy aktywnym wyszukiwaniu dodaj/edytuj/usuń kartę → powrót do pełnej listy.
7. Wejdź w pustą talię i wyszukaj → „Brak fiszek w tej talii." (nie komunikat wyszukiwania).

## Performance Considerations

Zapytanie robi sekwencyjny skan z `f_unaccent` na `front`/`back` w obrębie jednej talii — przy
rozmiarach MVP (dziesiątki–setki kart/talię) nieistotne. Indeks wyrażeniowy accent-insensitive
(`create index … on flashcard (f_unaccent(front) …)`, np. GIN `pg_trgm`) to świadomie odłożona
optymalizacja związana z FR-019 (ranking/live search); `IMMUTABLE` wrapper już teraz taki indeks
umożliwia bez dalszych zmian.

## Migration Notes

Migracja jest **czysto addytywna** (nowe rozszerzenie + dwie funkcje + grant) — bez zmian istniejących
tabel/kolumn, więc bezpieczna przed mergem (additive-before-merge). Po mergu wymaga osobnego `db push`
na chmurę (lessons: „Cloud migration is a separate step from app deploy"): `supabase link` →
`supabase db push`. `unaccent` jest dostępny na Supabade (rozszerzenie w schemacie `extensions`).

## References

- Change: `context/changes/deck-keyword-search/change.md`
- PRD: FR-015 (`context/foundation/prd.md`); FR-019 parked (ranking/live search)
- Roadmap: S-06 (`context/foundation/roadmap.md`)
- Helper listy: `src/lib/flashcards.ts:59-65`
- Loader: `src/pages/decks/[publicId]/index.astro:36-64`
- Toolbar (zarezerwowane miejsce): `src/components/flashcards/DeckContentToolbar.tsx:17`
- Wyspa (stany listy): `src/components/flashcards/FlashcardWorkspace.tsx:94-127`
- Styl migracji + RLS: `supabase/migrations/20260705180246_init_core_schema.sql`
- Lessons: SSR błąd-vs-pusto; zakres slice'a tylko własne komponenty; cloud migration osobno

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Warstwa danych (migracja + typy + helper)

#### Automated

- [x] 1.1 Migracja aplikuje się czysto: `supabase db reset` bez błędów
- [x] 1.2 Typy zregenerowane zawierają `search_flashcards_in_deck` w `src/db/database.types.ts`
- [x] 1.3 Typecheck przechodzi: `npm run lint` (po `npx astro sync`)

#### Manual

- [x] 1.4 SQL: `search_flashcards_in_deck(<deck_id>, 'zaba')` zwraca „żaba" tylko z tej talii
- [x] 1.5 Zapytanie z metaznakami (`50%`, `a_b`, `x(y`) nie rzuca błędu i dopasowuje dosłownie
- [x] 1.6 Inny użytkownik (JWT) nie widzi cudzych kart przez RPC (RLS)

### Phase 2: Loader + UI (parametr q, toolbar, licznik/brak wyników)

#### Automated

- [ ] 2.1 `npx astro sync` + `npm run lint` przechodzą
- [ ] 2.2 `npm run build` przechodzi

#### Manual

- [ ] 2.3 Fraza + Enter zawęża listę; URL ma `?q=`
- [ ] 2.4 Fraza bez ogonków znajduje kartę z ogonkami („zaba" → „żaba")
- [ ] 2.5 Zero trafień: komunikat „Brak fiszek pasujących…" + „Wyczyść" wraca do pełnej listy
- [ ] 2.6 Licznik ma poprawną polską odmianę dla 1 / 2 / 5 trafień
- [ ] 2.7 Pusta/spacjowa fraza pokazuje pełną listę
- [ ] 2.8 Mutacja karty przy aktywnym wyszukiwaniu wraca do pełnej, niefiltrowanej listy
- [ ] 2.9 Wyszukiwanie na pustej talii pokazuje „Brak fiszek w tej talii."
