-- Migration: search_accepted_only
-- Change: candidate-review (S-05, Jira C10X-8)
--
-- Wyszukiwanie w talii (FR-015) filtrowalo dotad WYLACZNIE po deck_id, wiec RPC zwracal
-- karty w KAZDYM stanie. Bylo to nieszkodliwe tylko dlatego, ze nic nie zapisywalo stanu
-- `rejected`, a kandydaci `generated` byli nieosiagalni po przeladowaniu — oba zalozenia
-- S-05 wlasnie unieważnia. Bez tej zmiany widok talii (ktory pokazuje same `accepted`)
-- zaczalby po wpisaniu frazy pokazywac kandydatow i odrzucone karty.
--
-- Do projekcji dochodzi source_id. W tym slice nie ma jeszcze konsumenta (odznaka
-- pochodzenia w widoku talii nalezy do C10X-16), ale loader talii mapuje galaz listy i
-- galaz wyszukiwania przez JEDEN .map(), a nic w CI nie sprawdza typow szablonow Astro —
-- wiec brak kolumny w RPC byłby pulapka, ktora nastepny wolajacy odziedziczy po cichu.

-- ============================================================================
-- DROP + CREATE, nie CREATE OR REPLACE
-- ============================================================================
-- Dodanie kolumny do `returns table (...)` to zmiana typu zwracanego, ktora Postgres
-- odrzuca przy replace ("cannot change return type of existing function"). Nic w bazie
-- nie zalezy od tej funkcji (wrapper TS nie jest zaleznoscia), wiec drop jest bezpieczny
-- BEZ `cascade` — nie uzywac cascade.
--
-- UWAGA: drop kasuje rowniez ACL funkcji, wiec ponowne nadanie grantow na koncu tego
-- pliku jest OBOWIAZKOWE, nie kosmetyczne.
--
-- Rollback: to JEDYNA destrukcyjna migracja w tym slice, wiec jej wycofanie musi byc
-- zapisane, a nie odtwarzane z pamieci (test-plan.md §6.6: restore sie weryfikuje, nie
-- zaklada). Kroki:
--   1. drop function public.search_flashcards_in_deck(bigint, text);
--   2. odtworz definicje 1:1 z supabase/migrations/20260712162359_deck_keyword_search.sql
--      — czyli BEZ `and f.state_id = 2` i BEZ `source_id` w `returns table` i w selekcie;
--   3. powtorz oba granty z konca tego pliku (drop znowu skasuje ACL).
-- Punkt 2 bierz z tamtego pliku, nie stad: rozne sa dokladnie dwie rzeczy wymienione wyzej,
-- ale przepisywanie ich z glowy jest tym, przed czym §6.6 ostrzega.

drop function public.search_flashcards_in_deck(bigint, text);

-- Reszta definicji bez zmian wzgledem 20260712162359_deck_keyword_search.sql:
-- SECURITY INVOKER (RLS flashcard_select dalej filtruje do kart uzytkownika; SECURITY
-- DEFINER obszedlby izolacje — nie uzywac), set search_path = '', escapowanie metaznakow
-- LIKE (\ % _) z klauzula escape '\', order by f.created_at desc.
--
-- Nowe: `and f.state_id = 2` (accepted). Literal 2 jest tu spojny ze study_due_cards,
-- ktore gatuje tak samo — slownik flashcard_state jest pinowany od S-01.

create function public.search_flashcards_in_deck(p_deck_id bigint, p_query text)
returns table (
  public_id uuid,
  front text,
  back text,
  created_at timestamptz,
  updated_at timestamptz,
  source_id smallint
)
language sql stable security invoker
set search_path = ''
as $$
  select f.public_id, f.front, f.back, f.created_at, f.updated_at, f.source_id
  from public.flashcard f
  where f.deck_id = p_deck_id
    and f.state_id = 2
    and (
      public.f_unaccent(f.front) ilike '%' ||
        public.f_unaccent(replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_')) || '%' escape '\'
      or public.f_unaccent(f.back) ilike '%' ||
        public.f_unaccent(replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_')) || '%' escape '\'
    )
  order by f.created_at desc
$$;

-- Granty odtworzone 1:1 po dropie: anon bez dostepu; execute tylko dla authenticated.
revoke all on function public.search_flashcards_in_deck(bigint, text) from anon;
grant execute on function public.search_flashcards_in_deck(bigint, text) to authenticated;
