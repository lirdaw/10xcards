-- Migration: init_core_schema
-- Change: per-user-data-isolation (F-01, Jira C10X-1)
--
-- Rdzenny schemat 10xCards: slownik stanow flashcard_state oraz tabele deck i flashcard
-- z twarda izolacja per-konto egzekwowana przez RLS (sekcja RLS dopisana w Fazie 2 nizej).
--
-- Konwencja ID: bigint IDENTITY od 100000 dla danych dynamicznych (deck, flashcard);
-- wartosci <100000 zarezerwowane na numeracje wewnetrzna (slownik flashcard_state: 1/2/3).
-- Publiczny uchwyt to public_id uuid. Wewnetrzne bigint id nigdy nie wychodza na front.

-- ============================================================================
-- Rozszerzenia
-- ============================================================================

-- moddatetime: trigger utrzymujacy updated_at (schema extensions, wg konwencji Supabase)
create extension if not exists moddatetime schema extensions;

-- ============================================================================
-- Slownik stanow fiszki
-- ============================================================================
-- state_id na flashcard jest NOT NULL bez DEFAULT (ustawiany jawnie przy insert:
-- S-02 -> 'accepted', S-04 -> 'generated'). Brak defaultu celowo zapobiega cichemu
-- zapisaniu kandydata jako zaakceptowanego i odwrotnie.

create table flashcard_state (
  id   smallint primary key,
  code text     not null unique check (code in ('generated', 'accepted', 'rejected'))
);

-- Seed jawnymi ID (zakres <100000 = numeracja wewnetrzna)
insert into flashcard_state (id, code) values
  (1, 'generated'),
  (2, 'accepted'),
  (3, 'rejected');

-- ============================================================================
-- Talie (deck)
-- ============================================================================
-- auth.users.id jest uuid -> user_id musi byc uuid FK, mimo ze wlasne PK sa bigint.

create table deck (
  id         bigint generated always as identity (start with 100000) primary key,
  public_id  uuid   not null default gen_random_uuid() unique,
  user_id    uuid   not null references auth.users (id) on delete cascade,
  name       text   not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deck_user_name_unique unique (user_id, name)
);

create index deck_user_id_idx on deck (user_id);

-- ============================================================================
-- Fiszki (flashcard)
-- ============================================================================

create table flashcard (
  id         bigint   generated always as identity (start with 100000) primary key,
  public_id  uuid     not null default gen_random_uuid() unique,
  deck_id    bigint   not null references deck (id) on delete cascade,
  state_id   smallint not null references flashcard_state (id),
  front      text     not null check (char_length(front) > 0),
  back       text     not null check (char_length(back) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index flashcard_deck_id_idx on flashcard (deck_id);
create index flashcard_state_id_idx on flashcard (state_id);

-- ============================================================================
-- Triggery updated_at (moddatetime BEFORE UPDATE)
-- ============================================================================

create trigger deck_set_updated_at
  before update on deck
  for each row execute function extensions.moddatetime (updated_at);

create trigger flashcard_set_updated_at
  before update on flashcard
  for each row execute function extensions.moddatetime (updated_at);
