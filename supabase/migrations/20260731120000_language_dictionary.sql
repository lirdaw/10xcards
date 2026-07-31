-- Migration: language_dictionary
-- Change: forced-language-prompt-fix (Jira C10X-41) — slownik jezykow generacji
--
-- Zbior jezykow oferowanych w generatorze przestaje byc stala w kodzie
-- (LANGUAGES w src/lib/generation-limits.ts) i staje sie DANYMI. Powod jest konkretny,
-- nie architektoniczny: jedna wartosc obslugiwala do tej pory trzy role naraz — enum Zod
-- w API, wartosc zapisywana do kolumny audytowej generation_session.language ORAZ token
-- wstrzykiwany do angielskiego promptu systemowego. Poniewaz kontrakt API i kolumna
-- audytowa wymagaly stabilnych wartosci, byly to polskie egzonimy — i model dostawal
-- "Write the flashcards in this language: niemiecki.", na co odpowiadal po POLSKU
-- (0/5 kart w jezyku docelowym, cztery przebiegi z czterech; francuski tak samo).
-- Rozdzielenie rol jest cala tresc tej tabeli: `code` jest kontraktem, `prompt_name`
-- jest tym, co widzi model, `ui_label` tym, co widzi uzytkownik.
--
-- Wzorzec: flashcard_state z 20260705180246_init_core_schema.sql (wiersze 25-34, 148-149) —
-- tabela slownikowa seedowana przez migracje, RLS wlaczony, jedna polityka select dla
-- authenticated, ZERO polityk zapisu, revoke dla anon.
--
-- ============================================================================
-- Klucz glowny: `code`, nie surogat smallint
-- ============================================================================
-- flashcard_state ma surogat wylacznie dlatego, ze flashcard.state_id na niego wskazuje.
-- Tutaj nic nie wskazuje na te tabele FK-iem (patrz nizej), wiec surogat nie kupilby nic
-- poza dodatkowym joinem. `code` jest jednoczesnie wartoscia na drucie w API.
--
-- ============================================================================
-- generation_session.language NIE dostaje klucza obcego
-- ============================================================================
-- Trzy powody, kazdy samodzielnie wystarczajacy: wiersze sprzed tej zmiany niosa polskie
-- egzonimy; do tej kolumny zapisywane jest rowniez `auto`, ktore nie jest wierszem tej
-- tabeli; a przyszla dezaktywacja lub zmiana nazwy w panelu admina nie moze byc blokowana
-- przez historyczne wiersze audytu. Kolumna zostaje wolnym `text`, dokladnie jak dzis.

create table language (
  code        text     primary key check (char_length(code) between 2 and 8),
  ui_label    text     not null check (char_length(ui_label) between 1 and 60),
  prompt_name text     not null check (char_length(prompt_name) between 1 and 60),
  sort_order  smallint not null,
  is_active   boolean  not null default true
);

-- ============================================================================
-- Seed
-- ============================================================================
-- Piec jezykow, ktore aplikacja wysyla dzis. Wartosci `prompt_name` sa TE SAME, ktore
-- Faza 1 tej zmiany wstawila jako PROMPT_LANGUAGE_NAMES w kodzie i ktore zostaly
-- zmierzone realnym przebiegiem `npm run eval` — to nie jest zbieg okolicznosci do
-- posprzatania, tylko to, co pozwala przebiegowi akceptacyjnemu byc PORÓWNANIEM,
-- a nie pierwszym pomiarem. Pin po stronie testow: tests/fixtures/language-names.ts.
--
-- Szosty wiersz, `it`, jest seedowany jako NIEAKTYWNY i nie jest ozdoba ani fixture'em.
-- Jest przygotowanym-lecz-niewydanym jezykiem i jest jedynym powodem, dla ktorego filtr
-- is_active w listActiveLanguages daje sie obalic ZWYKLYM odczytem: tabela nie ma polityk
-- zapisu, tests/fixtures wystawia wylacznie klienta na kluczu anon w zakresie RLS, a
-- tests/setup/preflight.ts twardo odrzuca klucz service_role — wiec zaden klient, jakiego
-- ten harness potrafi zbudowac, nie moze takiego wiersza stworzyc na potrzeby testu.

insert into language (code, ui_label, prompt_name, sort_order, is_active) values
  ('pl', 'Polski',     'Polish',  1, true),
  ('en', 'Angielski',  'English', 2, true),
  ('es', 'Hiszpański', 'Spanish', 3, true),
  ('de', 'Niemiecki',  'German',  4, true),
  ('fr', 'Francuski',  'French',  5, true),
  ('it', 'Włoski',     'Italian', 6, false);

-- ============================================================================
-- RLS + granty
-- ============================================================================
-- Dane referencyjne, czytelne dla zalogowanego. Tryb tylko-do-odczytu trzymaja tu DWIE
-- niezalezne warstwy, i to jest swiadome odejscie od precedensu flashcard_state.
--
-- POWOD, i wynika z pomiaru, nie z ostroznosci. `grant select ... to authenticated` samo
-- w sobie NICZEGO NIE ZAWEZA: Supabase ma w schemacie public domyslne uprawnienia
-- (alter default privileges ... grant all on tables to authenticated, service_role), wiec
-- rola dostaje INSERT/UPDATE/DELETE juz w momencie CREATE TABLE. Zmierzone przez
-- information_schema.role_table_grants — i tak wlasnie wyglada dzis flashcard_state, gdzie
-- ta sama linia czyta sie jak zawezenie, a nim nie jest. Bez `revoke ... from authenticated`
-- ponizej jedynym egzekutorem bylby brak polityki zapisu, czyli JEDNA linia: kto dodalby
-- polityke zapisu, otwieralby tabele natychmiast i na wszystkie trzy operacje.
--
-- flashcard_state celowo zostaje bez zmian — to osobna tabela i osobna decyzja, a nie
-- efekt uboczny tej migracji.
--
-- KONSEKWENCJA DLA TESTU, bo inaczej asercja cicho przestaje cokolwiek obserwowac: przy
-- dwoch warstwach proba zepsucia musi byc PARA (test-plan §6.10). Sama dodana polityka
-- zapisu zostawia suite na ZIELONO, bo odmawia grant — dopiero polityka RAZEM z
-- przywroconym grantem czerwieni tests/db/languages.test.ts. Jeden przebieg nie odroznia
-- "zlapal grant" od "zlapala polityka".
--
-- UWAGA dla przyszlej powierzchni administracyjnej: po tej zmianie stringiem wstrzykiwanym
-- do promptu systemowego jest `prompt_name` z WIERSZA, a nie wartosc z zadania. Straz przed
-- prompt-injection, ktora trzymal enum Zod, PRZENOSI sie tutaj — nie znika. Cokolwiek
-- zacznie zapisywac `prompt_name`, dziedziczy ten obowiazek.

alter table language enable row level security;

revoke all on language from anon;
revoke all on language from authenticated;

grant select on language to authenticated;

create policy language_select on language for select to authenticated
  using (true);
