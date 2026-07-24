-- Migration: srs_study_schedule_review_fixes
-- Change: srs-study-session (S-03, Jira C10X-6) — poprawki z impl-review (F5, F6, F7)
--
-- Trzy drobne korekty do 20260724195248_srs_study_schedule.sql. Osobna migracja, a nie
-- edycja tamtej: tamta jest juz zaaplikowana, a historia migracji jest append-only —
-- edycja w miejscu rozjechalaby schemat z historia.

-- ============================================================================
-- F5: gorny limit dla deck.session_size
-- ============================================================================
-- CHECK mial tylko `> 0`; sufit (100) zyl wylacznie w Zod (SIZE_MAX w src/pages/api/study.ts)
-- i w wyspie. Komentarz przy setSessionSize deklarowal CHECK jako backstop dla limitu z
-- endpointu — teraz nim faktycznie jest. Wartosc idzie prosto w p_limit study_due_cards
-- i w liczbe wierszy zasiewanych przez ensureSchedule, wiec sufit ma znaczenie.

alter table deck
  drop constraint deck_session_size_check;

alter table deck
  add constraint deck_session_size_check check (session_size between 1 and 100);

-- ============================================================================
-- F7: usuniecie zdublowanego indeksu na flashcard_schedule.flashcard_id
-- ============================================================================
-- Kolumna jest `not null unique`, wiec Postgres i tak trzyma pod nia unikalny btree —
-- jawny indeks byl duplikatem (narzut na kazdym zapisie i na miejscu), bez zadnego planu
-- zapytania, ktory by z niego skorzystal.
--
-- flashcard_schedule_due_idx ZOSTAJE swiadomie, mimo ze dzisiejsze zapytania go nie uzyja:
-- oba RPC filtruja `coalesce(s.due, p_now) <= p_now` (nie sargable wzgledem indeksu na
-- golej kolumnie) i jada od flashcard do flashcard_schedule po flashcard_id. Trzymamy go
-- pod FR-016 (filtrowanie kart po terminie powtorki: "za 1 / 5 / 10 dni"), ktore odpytuje
-- `due` bezposrednio. Jesli FR-016 wypadnie z zakresu, ten indeks ma wypasc razem z nim.

drop index flashcard_schedule_flashcard_id_idx;

-- ============================================================================
-- F6: stabilny tiebreaker w kolejnosci kart naleznych
-- ============================================================================
-- Bez niego, dla talii ktorej karty nigdy nie byly zasiane, KAZDY klucz sortowania zapada
-- sie do tej samej wartosci (p_now), wiec to ktore `p_limit` kart zwroci LIMIT zalezy od
-- plannera — dwa wejscia do tej samej talii moglyby dac rozne podzbiory ("wznow sesje"
-- nieodtwarzalne, przyszly test skladu batcha migotliwy). f.id jest monotoniczne i unikalne,
-- wiec domyka porzadek calkowicie. Reszta definicji bez zmian.

create or replace function public.study_due_cards(
  p_deck_id bigint,
  p_now timestamptz default now(),
  p_limit integer default 20
)
returns table (
  public_id uuid, front text, back text,
  due timestamptz, stability double precision, difficulty double precision,
  srs_state smallint, reps integer, lapses integer, last_review timestamptz
)
language sql stable security invoker
set search_path = ''
as $$
  select f.public_id, f.front, f.back,
         s.due, s.stability, s.difficulty, s.srs_state, s.reps, s.lapses, s.last_review
  from public.flashcard f
  left join public.flashcard_schedule s on s.flashcard_id = f.id
  where f.deck_id = p_deck_id
    and f.state_id = 2
    and coalesce(s.due, p_now) <= p_now
  order by coalesce(s.due, p_now) asc, f.id asc
  limit p_limit
$$;

-- CREATE OR REPLACE zachowuje uprawnienia istniejacej funkcji, ale powtarzamy je jawnie,
-- zeby ta migracja byla kompletna sama w sobie przy czystym replayu (`npm run db:reset`).
revoke all on function public.study_due_cards(bigint, timestamptz, integer) from anon;
grant execute on function public.study_due_cards(bigint, timestamptz, integer) to authenticated;
