# Wyszukiwanie fiszek w talii po słowie kluczowym (S-06 / C10X-9) — Plan Brief

> Full plan: `context/changes/deck-keyword-search/plan.md`

## What & Why

Użytkownik w widoku talii może wpisać frazę i (Enterem) zawęzić listę do fiszek, których `front`
lub `back` zawiera tę frazę (FR-015). Ręczne przeglądanie rosnącej talii jest żmudne; proste
wyszukiwanie po słowie kluczowym to najtańszy sposób, by szybko znaleźć konkretną kartę.

## Starting Point

Widok talii (`src/pages/decks/[publicId]/index.astro`) ładuje karty SSR przez `listFlashcards` i
renderuje je w wyspie `FlashcardWorkspace` (karty jako propsy, bez client-fetch). Toolbar
`DeckContentToolbar` ma już **zarezerwowane miejsce** na search box. W kodzie nie ma żadnego
wyszukiwania tekstowego ani rozszerzenia `unaccent`.

## Desired End State

W toolbarze jest pole wyszukiwania. Fraza + Enter przeładowuje stronę z `?q=` i pokazuje tylko
pasujące karty tej talii — **ignorując wielkość liter i polskie diakrytyki** („zaba" znajduje
„żaba") — z licznikiem trafień. Zero trafień daje odrębny komunikat i „Wyczyść"; puste pole =
pełna lista. Talia innego użytkownika pozostaje niewidoczna (RLS).

## Key Decisions Made

| Decision | Choice | Why (1 zdanie) | Source |
| --- | --- | --- | --- |
| Gdzie filtrować | Server-side (GET `?q` w loaderze) | Zgodne z modelem redirect-driven bez fetch; poprawne przy dowolnym rozmiarze talii; filtr pod RLS | Plan |
| Wrażliwość na diakrytyki | Accent-insensitive (`unaccent`) | Przyjazne dla polskiego materiału — wpisanie bez ogonków znajduje karty z ogonkami | Plan |
| Mechanizm accent-insensitive | Funkcja RPC + `IMMUTABLE` wrapper `f_unaccent` | `unaccent` (1-arg) jest `STABLE`, nie wejdzie do buildera/indeksu; RPC trzyma logikę w SQL, RLS zachowane | Plan |
| Brak wyników | Osobny komunikat + „Wyczyść" | Odróżnia „pusta talia" od „brak dopasowania", daje łatwe wyjście | Plan |
| Treść zapytania | Trim + escape metaznaków LIKE | Odporne na `%`/`_`/`\` i błędną składnię; dosłowny podłańcuch | Plan |
| `?q` po mutacji karty | Reset do pełnej listy | Trzyma slice w seamie wyszukiwania; nowo dodana karta zawsze widoczna | Plan |
| Licznik trafień | Tak (polska odmiana) | Jasne potwierdzenie, że filtr działa i ile znaleziono | Plan |

## Scope

**In scope:** pole wyszukiwania w toolbarze; `?q` w loaderze; funkcja RPC accent-insensitive
`ILIKE` na `front`/`back` w obrębie talii; licznik trafień; stan „brak wyników" + „Wyczyść";
helper `searchFlashcards`.

**Out of scope:** ranking trafności, live-as-you-type (FR-019); filtry po stanie/dacie (FR-014) i
statusie powtórki (FR-016); nowy endpoint API; indeks wydajnościowy; przenoszenie `?q` przez
endpointy mutacji.

## Architecture / Approach

`<form method="GET">` w toolbarze → loader czyta `?q` → przy pustym używa `listFlashcards` (bez
zmian), przy niepustym woła `searchFlashcards` → RPC `search_flashcards_in_deck(p_deck_id, p_query)`
(accent-insensitive `ILIKE` na `f_unaccent(front/back)`, `SECURITY INVOKER` → RLS, projekcja tych
samych publicznych kolumn) → wiersze mapowane jak dotąd → wyspa renderuje licznik / grid / „brak
wyników". Kolejność wyników `created_at desc` (bez rankingu).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Warstwa danych | Migracja (`unaccent` + `f_unaccent` + RPC), regeneracja typów, helper `searchFlashcards` | `unaccent` musi być owinięty `IMMUTABLE`; RPC musi zostać `SECURITY INVOKER` (RLS) |
| 2. Loader + UI | `?q` w loaderze, pole wyszukiwania (GET form), licznik + stan „brak wyników" + „Wyczyść" | Polska odmiana liczebnika; `q` nie może być strippowane z URL |

**Prerequisites:** S-02 (manual-card-crud) — done; lokalny stack Supabase do migracji + regeneracji typów.
**Estimated effort:** ~1 sesja, 2 fazy (mały slice odczytu + jedna addytywna migracja).

## Open Risks & Assumptions

- Zakładamy dostępność rozszerzenia `unaccent` na Supabase (standardowe — jest).
- Migracja addytywna, ale wymaga osobnego `db push` na chmurę po mergu (lekcja: cloud migration ≠ deploy).
- Brak runnera testów w repo — weryfikacja przez SQL (Studio), lint/build i testy manualne.

## Success Criteria (Summary)

- Fraza zawęża listę do kart z dopasowaniem w `front`/`back`; wariant bez ogonków znajduje karty z ogonkami.
- Zero trafień → czytelny komunikat + „Wyczyść"; puste pole → pełna lista; licznik z poprawną odmianą.
- Izolacja per-user zachowana (RLS): użytkownik nie widzi cudzych kart przez wyszukiwanie.
