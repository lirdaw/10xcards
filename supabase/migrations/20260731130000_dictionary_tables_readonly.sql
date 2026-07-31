-- Migration: dictionary_tables_readonly
-- Change: forced-language-prompt-fix (Jira C10X-41) — drugi egzekutor tylko-do-odczytu
--         dla dwoch zastanych tabel slownikowych. Dodane w impl-review (finding F5).
--
-- ============================================================================
-- POWOD
-- ============================================================================
-- Migracja 20260731120000 (tabela `language`) zmierzyla rzecz, ktora nie byla w tym
-- projekcie zapisana: Supabase ma w schemacie `public` domyslne uprawnienia
--
--   alter default privileges ... grant all on tables to authenticated, service_role
--
-- wiec KAZDA nowa tabela daje roli `authenticated` INSERT/UPDATE/DELETE juz w momencie
-- `create table`. Linia `grant select ... to authenticated`, ktora czyta sie jak
-- zawezenie, nie zaweza NICZEGO — dokłada uprawnienie, ktore rola i tak ma.
--
-- Konsekwencja dla dwoch tabel slownikowych, ktore powstaly przed tym pomiarem:
-- `flashcard_state` (20260705180246_init_core_schema.sql) i `flashcard_source`
-- (20260710195327_manual_card_source.sql) sa tylko-do-odczytu WYLACZNIE dzieki temu, ze
-- nie maja polityki zapisu. Jeden egzekutor, jedna linia. Zmierzone przed ta migracja:
--
--   table_name       | grantee       | privileges
--   -----------------+---------------+---------------------------------------------------
--   flashcard_source | authenticated | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
--   flashcard_state  | authenticated | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
--   language         | authenticated | SELECT
--
-- Dzis nie da sie tego wykorzystac — obie maja polityke wylacznie `for select`, wiec RLS
-- odmawia zapisu. Ale "o jedna polityke od otwarcia" to nie to samo co "zamkniete", a
-- `flashcard_state` trzyma bramke cyklu zycia fiszki (1 generated / 2 accepted /
-- 3 rejected), po ktorej filtruje `study_due_cards` — wiersz dopisany albo przestawiony
-- tam zmienia to, co wchodzi do nauki.
--
-- Ta migracja wyrownuje obie do wzorca `language`: dwa niezalezne egzekutory zamiast
-- jednego. Polityk NIE rusza — one juz sa poprawne.
--
-- ============================================================================
-- ZAKRES: tylko tabele SLOWNIKOWE
-- ============================================================================
-- Pozostale tabele (`deck`, `flashcard`, `flashcard_schedule`, `generation_session`) tez
-- niosa pelny zestaw domyslnych uprawnien i to jest POPRAWNE: aplikacja do nich pisze, a
-- pilnuja ich polityki RLS z predykatem po `user_id`. Odebranie im zapisu zepsuloby
-- produkt. Rozroznienie idzie po tym, czy tabela jest danymi uzytkownika, czy slownikiem.
--
-- Nic w `src/` nie zapisuje zadnej z tych dwoch — sprawdzone przegladem drzewa; obie
-- pojawiaja sie tam wylacznie w komentarzach (src/lib/flashcards.ts, src/lib/generations.ts).
-- Integralnosc kluczy obcych (`flashcard.state_id`, `flashcard.source_id`) nie wymaga
-- uprawnien wolajacego: kontrole RI wykonuja sie z uprawnieniami wlasciciela ograniczenia,
-- nie roli wstawiajacej wiersz.
--
-- UWAGA na przyszlosc: `revoke` dziala na tabelach, ktore JUZ istnieja. Nowa tabela
-- slownikowa dostanie domyslne `grant all` tak samo jak te — wiec `revoke` nalezy do
-- szablonu kazdej nowej tabeli slownikowej, jak w 20260731120000.

revoke all on flashcard_state from authenticated;
grant select on flashcard_state to authenticated;

revoke all on flashcard_source from authenticated;
grant select on flashcard_source to authenticated;
