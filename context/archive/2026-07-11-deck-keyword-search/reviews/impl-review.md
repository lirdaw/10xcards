<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Wyszukiwanie fiszek w talii po słowie kluczowym (S-06 / C10X-9)

- **Plan**: context/changes/deck-keyword-search/plan.md
- **Scope**: Phase 1 & 2 of 2 (full plan)
- **Date**: 2026-07-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria

- Phase 1 automated: types contain `search_flashcards_in_deck` (database.types.ts:157) ✅; `npm run lint` passes ✅. (`supabase db reset` not re-run — migration committed & applied per Progress; RPC Returns columns are non-null, so no loader guard needed.)
- Phase 2 automated: `npx astro sync` + `npm run lint` pass ✅; `npm run build` passes ✅.
- Manual criteria (1.4–1.6, 2.3–2.9): all marked `[x]` in Progress by the implementer; consistent with the diff.

## Findings

### F1 — Nieobsłużony błąd zapytania zliczającego w loaderze

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/decks/[publicId]/index.astro:73
- **Detail**: `const { count } = await countFlashcards(supabase, deck.id)` nie destrukturyzuje ani nie sprawdza `error`. Przy przejściowym błędzie tego drugorzędnego zapytania `count` = null → `deckHasCards = false`, więc wyszukiwanie z zerem trafień pokaże „Brak fiszek w tej talii." zamiast „Brak fiszek pasujących do „q"." Wpływ ograniczony wyłącznie do treści stanu pustego — nie dotyka izolacji danych ani nie powoduje 404. Ścieżka główna (listy/wyszukiwania) już poprawnie rozgałęzia na `listError`.
- **Fix**: Potraktować błąd count jako „załóż, że talia ma karty" — `const { count, error: countError } = await countFlashcards(...); deckHasCards = countError ? true : (count ?? 0) > 0;` (bezpieczniejszy default kopii stanu pustego).
- **Decision**: FIXED (Fix now) — index.astro:73

### F2 — f_unaccent wykonywalny dla PUBLIC (brak revoke)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260712162359_deck_keyword_search.sql:26
- **Detail**: `public.f_unaccent(text)` nie ma jawnego `revoke ... from anon/public`; domyślnie funkcje dają EXECUTE PUBLIC. Praktycznie nieistotne: to czysta transformacja tekstu bez dostępu do danych, a pozycyjny argument `(text)` bez nazwy nie jest wygodnie wywoływalny przez PostgREST RPC. Kwestia higieny, nie realnego ryzyka. `search_flashcards_in_deck` (funkcja z dostępem do danych) ma poprawny revoke/grant.
- **Fix**: Dodać `revoke all on function public.f_unaccent(text) from public, anon;` dla spójności z konwencją migracji (opcjonalne).
- **Decision**: FIXED (Fix now) — migration:31. UWAGA: migracja była już zacommitowana; zmiana wejdzie do lokalnej bazy dopiero po `supabase db reset`, a do chmury przez osobny `supabase db push` (lessons: cloud migration jest osobnym krokiem).

## Notes

Przegląd dwóch równoległych sub-agentów potwierdził: wszystkie 8 planowanych zmian = MATCH, brak scope creep, wszystkie guardraile „What We're NOT Doing" utrzymane (bez rankingu, bez live-search, bez `?q` przez mutacje, bez filtrów stanu/dat, bez endpointu API, bez indeksu). Kluczowe punkty bezpieczeństwa zweryfikowane: escapowanie metaznaków LIKE w poprawnej kolejności (backslash pierwszy), `security invoker` (RLS zachowane), `set search_path = ''` + schema-qualified refs, granty tylko dla `authenticated`, brak XSS (React auto-escape). Polska pluralizacja licznika (`wynik`/`wyniki`/`wyników`) poprawnie obsługuje nastki 12–14 i 112–114.

Dodatki poza literą planu (`countFlashcards` helper, prop `deckHasCards`) służą kryterium 2.9 planu (pusta talia vs brak trafień) i są z nim spójne — nie stanowią rozszerzenia zakresu.
