-- Migration: generation_session
-- Change: ai-candidate-generation (S-04, Jira C10X-7)
--
-- Utrwala sesje generacji AI jako rodzica kandydatow fiszek oraz link flashcard -> sesja.
-- generation_session trzyma pelny audyt wywolania OpenRouter (model, jezyk, tekst zrodlowy,
-- surowy request/response, liczniki, status) i jest wlasnoscia per-user egzekwowana przez
-- RLS wzorowana na tabeli deck (F-01). Kolumna flashcard.generation_id jest nullable z
-- ON DELETE SET NULL — kasowanie sesji zeruje link, ale nie kasuje wygenerowanych kart.
--
-- Sesja jest niezmienna po zapisie (zapisujemy raz, na koniec generacji), wiec NIE dokladamy
-- kolumny updated_at ani triggera moddatetime. Konwencja ID jak w F-01: bigint IDENTITY od
-- 100000 dla danych dynamicznych, public_id uuid jako uchwyt publiczny.

-- ============================================================================
-- Sesja generacji (generation_session)
-- ============================================================================
-- Liczniki: requested = ile kart poprosil uzytkownik, generated = ile zwrocil model,
-- saved = ile przeszlo walidacje Zod i zostalo zapisane. status='failed' rowniez
-- zapisywany (audyt + error_message), zeby uchwycic nieudane calle OpenRouter.

create table generation_session (
  id              bigint   generated always as identity (start with 100000) primary key,
  public_id       uuid     not null default gen_random_uuid() unique,
  user_id         uuid     not null references auth.users (id) on delete cascade,
  source_text     text     not null check (char_length(source_text) > 0),
  model           text     not null,
  language        text     not null,
  requested_count smallint not null,
  generated_count smallint not null,
  saved_count     smallint not null,
  status          text     not null check (status in ('succeeded', 'failed')),
  error_message   text,
  request_payload  jsonb,
  response_payload jsonb,
  created_at      timestamptz not null default now()
);

create index generation_session_user_id_idx on generation_session (user_id);

-- ============================================================================
-- Link flashcard -> generation_session
-- ============================================================================
-- Nullable + ON DELETE SET NULL: karty przezyja skasowanie swojej sesji generacji.
-- Karty reczne (S-02) maja generation_id = NULL.

alter table flashcard
  add column generation_id bigint references generation_session (id) on delete set null;

create index flashcard_generation_id_idx on flashcard (generation_id);

-- ============================================================================
-- Row-Level Security (RLS) + grants
-- ============================================================================
-- Twarda izolacja per-konto: (select auth.uid()) liczone jako initPlan raz na
-- zapytanie (zalecenie wydajnosciowe Supabase). Wzor 1:1 z polityk deck (F-01).
-- Deny-by-default: anon bez dostepu, authenticated pelny CRUD na wlasnych sesjach.

alter table generation_session enable row level security;

revoke all on generation_session from anon;
grant select, insert, update, delete on generation_session to authenticated;

create policy generation_session_select on generation_session for select to authenticated
  using (user_id = (select auth.uid()));

create policy generation_session_insert on generation_session for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy generation_session_update on generation_session for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy generation_session_delete on generation_session for delete to authenticated
  using (user_id = (select auth.uid()));
