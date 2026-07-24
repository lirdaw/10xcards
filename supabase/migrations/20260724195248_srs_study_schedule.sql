-- Migration: srs_study_schedule
-- Change: srs-study-session (S-03, Jira C10X-6)
--
-- Persystencja harmonogramu SRS (FSRS via ts-fsrs, decyzja F-02) dla slice'a nauki.
-- Dodaje: tabele flashcard_schedule (1:1 do flashcard, MUTOWALNA — ocena przesuwa termin),
-- kolumne deck.session_size (limit kart na sesje), backfill wierszy harmonogramu dla
-- istniejacych kart 'accepted', oraz dwie funkcje RPC do selekcji/zliczania kart naleznych.
--
-- UWAGA na dwie osie "state": flashcard.state_id (1 generated / 2 accepted / 3 rejected,
-- CYKL ZYCIA) to inna os niz FSRS State (0 New / 1 Learning / 2 Review / 3 Relearning,
-- HARMONOGRAM). Kolumna FSRS nazwana srs_state, by roznica byla glosna. Brama "tylko
-- accepted wchodzi do sesji" to warunek state_id = 2; kolejnosc odraczania to czysty FSRS.
--
-- Konwencja ID jak w F-01: bigint IDENTITY od 100000. Harmonogram NIE ma public_id —
-- wiersz nie jest adresowany z zewnatrz; uchwytem jest public_id karty. Migracje NIE sa
-- idempotentne dla tabel (bare create table) — czysty replay lokalny to `npm run db:reset`.

-- ============================================================================
-- Limit rozmiaru sesji na talie (deck.session_size)
-- ============================================================================
-- Default 20 backfilluje juz zapelniona tabele deck bezpiecznie (bez osobnego backfillu).

alter table deck
  add column session_size integer not null default 20 check (session_size > 0);

-- ============================================================================
-- Harmonogram SRS (flashcard_schedule)
-- ============================================================================
-- Relacja 1:1 do flashcard przez unikalny flashcard_id (ON DELETE CASCADE — kasowanie
-- karty kasuje jej harmonogram). Kolumny FSRS: due/stability/difficulty/srs_state/reps/
-- lapses/last_review + scheduled_days. Tabela mutowalna (ocena aktualizuje wiersz), wiec
-- MA updated_at + trigger moddatetime (inaczej niz niezmienny generation_session).

create table flashcard_schedule (
  id             bigint   generated always as identity (start with 100000) primary key,
  flashcard_id   bigint   not null unique references flashcard (id) on delete cascade,
  due            timestamptz      not null,
  stability      double precision not null,
  difficulty     double precision not null,
  srs_state      smallint not null check (srs_state between 0 and 3),
  reps           integer  not null,
  lapses         integer  not null,
  last_review    timestamptz,
  scheduled_days integer  not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index flashcard_schedule_flashcard_id_idx on flashcard_schedule (flashcard_id);
create index flashcard_schedule_due_idx on flashcard_schedule (due);

create trigger flashcard_schedule_set_updated_at
  before update on flashcard_schedule
  for each row execute function extensions.moddatetime (updated_at);

-- ============================================================================
-- Backfill: wiersz harmonogramu New dla kazdej istniejacej karty 'accepted'
-- ============================================================================
-- Wartosci literalne z createEmptyCard(): due=now, srs_state=0 (New), stability=0,
-- difficulty=0, reps=0, lapses=0, scheduled_days=0 — bez importu ts-fsrs do SQL.

insert into flashcard_schedule (flashcard_id, due, stability, difficulty, srs_state, reps, lapses, scheduled_days)
select f.id, now(), 0, 0, 0, 0, 0, 0
from flashcard f
where f.state_id = 2;

-- ============================================================================
-- Row-Level Security (RLS) + grants
-- ============================================================================
-- Wiersz harmonogramu jest osiagalny tylko przez wlasciciela talii karty: dwuskokowy
-- exists join flashcard -> deck -> (select auth.uid()) (wzor flashcard_* z F-01).
-- (select auth.uid()) w formie initPlan (zalecenie wydajnosciowe Supabase). Deny-by-default.

alter table flashcard_schedule enable row level security;

revoke all on flashcard_schedule from anon;
grant select, insert, update, delete on flashcard_schedule to authenticated;

create policy flashcard_schedule_select on flashcard_schedule for select to authenticated
  using (exists (select 1 from flashcard f join deck d on d.id = f.deck_id
                 where f.id = flashcard_schedule.flashcard_id and d.user_id = (select auth.uid())));

create policy flashcard_schedule_insert on flashcard_schedule for insert to authenticated
  with check (exists (select 1 from flashcard f join deck d on d.id = f.deck_id
                      where f.id = flashcard_schedule.flashcard_id and d.user_id = (select auth.uid())));

create policy flashcard_schedule_update on flashcard_schedule for update to authenticated
  using (exists (select 1 from flashcard f join deck d on d.id = f.deck_id
                 where f.id = flashcard_schedule.flashcard_id and d.user_id = (select auth.uid())))
  with check (exists (select 1 from flashcard f join deck d on d.id = f.deck_id
                      where f.id = flashcard_schedule.flashcard_id and d.user_id = (select auth.uid())));

create policy flashcard_schedule_delete on flashcard_schedule for delete to authenticated
  using (exists (select 1 from flashcard f join deck d on d.id = f.deck_id
                 where f.id = flashcard_schedule.flashcard_id and d.user_id = (select auth.uid())));

-- ============================================================================
-- RPC: karty nalezne w talii (study_due_cards)
-- ============================================================================
-- SECURITY INVOKER (wzor search_flashcards_in_deck) — RLS flashcard_select/schedule_select
-- dalej filtruje do kart uzytkownika; SECURITY DEFINER obszedlby RLS i zlamal izolacje.
-- Brakujacy wiersz harmonogramu traktowany jako New/nalezny-teraz przez LEFT JOIN +
-- coalesce(due, p_now), wiec zliczanie/selekcja nie wymaga wczesniejszego zapisu.

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
  order by coalesce(s.due, p_now) asc
  limit p_limit
$$;

revoke all on function public.study_due_cards(bigint, timestamptz, integer) from anon;
grant execute on function public.study_due_cards(bigint, timestamptz, integer) to authenticated;

-- ============================================================================
-- RPC: liczniki kart naleznych per talia (study_due_counts)
-- ============================================================================
-- Jeden round-trip dla WSZYSTKICH talii wolajacego (bez N+1 per talia). RLS na
-- deck/flashcard/flashcard_schedule scala wynik do wlasciciela. Karta bez wiersza
-- harmonogramu liczona jako nalezna (coalesce(due, p_now)).

create or replace function public.study_due_counts(p_now timestamptz default now())
returns table (public_id uuid, due_count bigint)
language sql stable security invoker
set search_path = ''
as $$
  select d.public_id,
         count(f.id) filter (where coalesce(s.due, p_now) <= p_now) as due_count
  from public.deck d
  left join public.flashcard f on f.deck_id = d.id and f.state_id = 2
  left join public.flashcard_schedule s on s.flashcard_id = f.id
  group by d.public_id
$$;

revoke all on function public.study_due_counts(timestamptz) from anon;
grant execute on function public.study_due_counts(timestamptz) to authenticated;
