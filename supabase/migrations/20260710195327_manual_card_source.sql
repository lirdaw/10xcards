-- Migration: manual_card_source
-- Change: manual-card-crud (S-02, Jira C10X-5)
--
-- Zapisuje autorstwo fiszki (recznie vs AI) zgodnie z konwencja slownika + RLS z F-01.
-- Slownik flashcard_source (1=manual, 2=ai) lustrzany wobec flashcard_state; kolumna
-- source_id NOT NULL FK na flashcard. Tabela flashcard jest pusta (S-01 nie tworzyl
-- fiszek), wiec NOT NULL bez DEFAULT nie wymaga backfillu.
--
-- Brak gornych limitow dlugosci front/back: maksymalna dlugosc to regula biznesowa
-- (klient + endpoint), nie CHECK w bazie. Zostaja tylko checki NOT NULL + char_length > 0 z F-01.

-- ============================================================================
-- Slownik zrodel fiszki
-- ============================================================================
-- Seed jawnymi ID (zakres <100000 = numeracja wewnetrzna, jak flashcard_state).

create table flashcard_source (
  id   smallint primary key,
  code text     not null unique check (code in ('manual', 'ai'))
);

insert into flashcard_source (id, code) values
  (1, 'manual'),
  (2, 'ai');

-- ============================================================================
-- Kolumna marker autorstwa na flashcard
-- ============================================================================

alter table flashcard
  add column source_id smallint not null references flashcard_source (id);

create index flashcard_source_id_idx on flashcard (source_id);

-- ============================================================================
-- Grants + RLS dla slownika (deny-by-default, tylko odczyt dla authenticated)
-- ============================================================================

alter table flashcard_source enable row level security;

revoke all on flashcard_source from anon;
grant select on flashcard_source to authenticated;

create policy flashcard_source_select on flashcard_source for select to authenticated
  using (true);
