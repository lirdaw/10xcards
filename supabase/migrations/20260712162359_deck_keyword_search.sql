-- Migration: deck_keyword_search
-- Change: deck-keyword-search (S-06, Jira C10X-9)
--
-- Wyszukiwanie fiszek w obrebie talii po slowie kluczowym (FR-015). Dopasowanie
-- podlancucha (substring) w polach front/back, case-insensitive i accent-insensitive
-- (polskie "zaba" znajduje "zaba" z ogonkiem). Migracja czysto addytywna: nowe
-- rozszerzenie unaccent + dwie funkcje + grant; bez zmian istniejacych tabel.

-- ============================================================================
-- Rozszerzenia
-- ============================================================================

-- unaccent: usuwa diakrytyki na potrzeby accent-insensitive dopasowania
-- (schema extensions, wg konwencji Supabase).
create extension if not exists unaccent schema extensions;

-- ============================================================================
-- IMMUTABLE wrapper na unaccent
-- ============================================================================
-- Jednoargumentowy unaccent(text) jest STABLE (zalezny od biezacego slownika),
-- wiec Postgres odrzucilby go w kontekscie wymagajacym IMMUTABLE (np. indeks
-- wyrazeniowy). Uzywamy dwuargumentowej formy z jawnie wskazanym slownikiem i
-- deklarujemy wlasny wrapper jako IMMUTABLE (slownik unaccent jest staly). Ten
-- wrapper jest tez warunkiem, by w przyszlosci zalozyc indeks wyrazeniowy (FR-019).

create or replace function public.f_unaccent(text)
returns text language sql immutable strict parallel safe
set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

-- ============================================================================
-- Funkcja RPC: wyszukiwanie w obrebie talii
-- ============================================================================
-- SECURITY INVOKER (domyslne) — funkcja odpytuje flashcard, wiec RLS flashcard_select
-- (join po wlascicielu) dalej filtruje do kart uzytkownika. SECURITY DEFINER obszedlby
-- RLS i zlamal guardrail izolacji — nie uzywac.
--
-- Zwraca wlasna projekcje (piec publicznych kolumn), nie setof flashcard, wiec wewnetrzny
-- bigint id nie wychodzi na front (spojnie z listFlashcards). Metaznaki LIKE (\ % _) w
-- p_query sa escapowane, z klauzula escape '\', by fraza byla traktowana doslownie.

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

-- Granty: anon bez dostepu; execute tylko dla authenticated.
revoke all on function public.search_flashcards_in_deck(bigint, text) from anon;
grant execute on function public.search_flashcards_in_deck(bigint, text) to authenticated;
