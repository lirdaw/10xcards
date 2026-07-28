-- Migration: flashcard_content_bounds
-- Change: server-side-validation-test (Jira C10X-30) — backstop bazodanowy dla regul tresci fiszki
--
-- Osobna migracja, a nie edycja 20260705180246_init_core_schema.sql: tamta jest juz
-- zaaplikowana (lokalnie i w chmurze), a historia migracji jest append-only — edycja w
-- miejscu rozjechalaby schemat z historia. Ten sam powod, dla ktorego
-- 20260724220524 promowal deck_session_size_check osobnym plikiem.
--
-- ============================================================================
-- Gorne ograniczenie dlugosci front / back
-- ============================================================================
-- Do tej pory baza pilnowala wylacznie NIEpustosci (char_length > 0), a sufit (200 / 1000)
-- zyl wylacznie w kodzie aplikacji: FRONT_MAX / BACK_MAX w src/lib/flashcards.ts, importowane
-- przez oba endpointy formularzowe, trzy wyspy React i schemat Zod w src/lib/openrouter.ts.
-- Cztery linie w dwoch handlerach byly jedynym egzekutorem w calym systemie — dokladnie ta
-- reszta ryzyka, ktora S-02 zapisal jako swiadomie przyjeta
-- (context/archive/2026-07-09-manual-card-crud/plan-brief.md:80-81). Teraz baza jest drugim,
-- niezaleznym egzekutorem.
--
-- UWAGA — DUPLIKACJA STALEJ. Liczby 200 i 1000 ponizej sa kopia FRONT_MAX / BACK_MAX z
-- src/lib/flashcards.ts. Nie da sie ich odczytac z bazy ani z bazy do kodu; zmiana
-- ktorejkolwiek strony WYMAGA zmiany drugiej, a zmiana stalej w kodzie wymaga od teraz
-- nowej migracji (rollback = kolejna migracja przywracajaca `> 0`, nigdy edycja tej).
-- Ta sama duplikacja co w deck_session_size_check (SIZE_MAX w src/pages/api/study.ts).
--
-- UWAGA — DWIE JEDNOSTKI MIARY, i to nie jest problem. char_length() liczy PUNKTY KODOWE,
-- a endpoint mierzy `.length` w JS, czyli jednostki UTF-16: para zastepcza (emoji, znak
-- spoza BMP) to 1 dla Postgresa i 2 dla JS. Wiec char_length <= .length ZAWSZE, a stad
-- CHECK jest scisle luzniejszy od endpointu i nie odrzuci niczego, co endpoint przepuscil —
-- backstop nie wprowadza falszywych odmow. Kierunek odwrotny (101 znakow astralnych = 202
-- jednostki w JS, odmowa przez endpoint mimo 101 punktow kodowych) istnieje, ale jest
-- SUROWSZY, nie obejsciem. Nie buduj lancuchow brzegowych ze znakow spoza ASCII.
--
-- Dolna granica pozostaje bez zmian co do skutku (`between 1 and N` to `>= 1`), wiec zadnego
-- istniejacego wiersza to nie dotyka. Zmierzone przed zaaplikowaniem: 7121 fiszek lokalnie,
-- max(char_length(front)) = 33, max(char_length(back)) = 61.
--
-- Nazwy constraintow (auto-nadane przez init_core_schema) sa celowo zachowane, zeby
-- pg_constraint czytal sie identycznie poza sama definicja.

alter table flashcard
  drop constraint flashcard_front_check;

alter table flashcard
  add constraint flashcard_front_check check (char_length(front) between 1 and 200);

alter table flashcard
  drop constraint flashcard_back_check;

alter table flashcard
  add constraint flashcard_back_check check (char_length(back) between 1 and 1000);
