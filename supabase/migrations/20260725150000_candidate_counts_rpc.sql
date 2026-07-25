-- Migration: candidate_counts_rpc
-- Change: candidate-review (S-05, Jira C10X-8) — impl-review F2
--
-- Licznik "N do przegladu" na liscie talii liczyl sie dotad w JS: jeden pobrany WIERSZ na
-- kazdego oczekujacego kandydata, przy kazdym renderze /decks. Komentarz w kodzie mowil
-- "Mirrors listDueCounts' shape" — i ksztalt zwrotu faktycznie sie zgadzal, ale mechanizm
-- juz nie: study_due_counts agreguje W SQL i zwraca jeden wiersz na talie.
--
-- Rownica nie jest tylko kosmetyczna. PostgREST tnie odpowiedz na `max_rows = 1000`
-- (supabase/config.toml), wiec uzytkownik z >1000 oczekujacymi kandydatami dostawal
-- UCIETY zbior i przez to ZLE liczby na chipach — wartosc wygladajaca wiarygodnie, nie blad.
-- decks/index.astro swiadomie pomija blad tego zapytania, wiec nic by tego nie ujawnilo.
--
-- Ten RPC domyka to u zrodla, dokladnie wzorem study_due_counts z 20260724195248:
-- SECURITY INVOKER (RLS na deck/flashcard scala wynik do wlasciciela; SECURITY DEFINER
-- obszedlby izolacje — nie uzywac), set search_path = '', jeden round-trip dla WSZYSTKICH
-- talii wolajacego.
--
-- JOIN jest WEWNETRZNY, nie left jak w study_due_counts, i to jest swiadoma roznica:
-- kontrakt countCandidatesByDeck mowi "talia bez kandydatow jest NIEOBECNA w mapie, nie 0"
-- (chip renderuje sie tylko dla wpisu obecnego), i tests/review/candidates.test.ts pinuje
-- to wprost. Left join zwracalby takiej talii 0 i cicho zmienialby ten kontrakt przy okazji
-- poprawki wydajnosciowej. Przy okazji: inner join to tez mniejszy payload.
--
-- Literal 1 = `generated` w slowniku flashcard_state, pinowanym od S-01; spojne ze
-- study_due_cards, ktore w ten sam sposob wpisuje 2 = `accepted`.
--
-- Rollback: drop function public.candidate_counts_by_deck();
--           (poprzednio funkcji nie bylo — licznik liczyl sie w src/lib/flashcards.ts)

create or replace function public.candidate_counts_by_deck()
returns table (public_id uuid, candidate_count bigint)
language sql stable security invoker
set search_path = ''
as $$
  select d.public_id, count(f.id) as candidate_count
  from public.deck d
  join public.flashcard f on f.deck_id = d.id and f.state_id = 1
  group by d.public_id
$$;

revoke all on function public.candidate_counts_by_deck() from anon;
grant execute on function public.candidate_counts_by_deck() to authenticated;
