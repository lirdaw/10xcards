-- Migration: generation_idempotency_key
-- Change: candidate-review (S-05, Jira C10X-8) — faza 6, dlug z impl-review F5
--
-- Domyka test-plan §2 Risk #2: "Ponow" po timeoucie klienta dopisywal DRUGI komplet
-- kandydatow i druga sesje generacji. Sam ordering timeoutow (klient 55s > serwer 40s)
-- tylko zwezal okno wyscigu, nigdy go nie zamykal (lessons.md: "Klient<->serwer timeouty
-- + Ponow wymagaja idempotencji zapisu").
--
-- Klucz jest mintowany PRZEZ KLIENTA raz na probe generacji i odtwarzany doslownie przez
-- "Ponow", wiec to on — a nie (user_id, source_text) — jest wlasciwym kluczem dedupu:
-- ten sam tekst wolno wygenerowac ponownie z innym count/jezykiem, i to nie jest duplikat.
--
-- NULLABLE celowo: istniejace wiersze oraz kazdy klient, ktory klucza nie wysyla, dzialaja
-- dalej bez zmian. NULL-e nie sa sobie rowne, wiec indeks ponizej ich nie sklei w jeden.
--
-- ============================================================================
-- Zakres indeksu: TYLKO sesje `succeeded` — to jest warunek przezycia FR-018
-- ============================================================================
-- Indeks pilnuje jednej rzeczy: zeby dla jednego klucza nie powstaly DWIE udane sesje.
-- Wiersze `failed` to czysty audyt i NIE moga blokowac niczego. Gdyby indeks obejmowal
-- kazdy status, wiersz audytowy z tym samym kluczem kolidowalby z wlasnym insertem
-- ponowienia -> 500 "Nie udalo sie zapisac sesji generacji" -> retry martwy NA ZAWSZE po
-- pierwszej awarii, czyli dokladnie ten przeplyw, dla ktorego FR-018 istnieje
-- (plan-review F1; test: "still generates when the only prior session for that key is
-- `failed`" w tests/generation/generate.test.ts).
--
-- UWAGA (impl-review F3): predykat `status = 'succeeded'` jest NOSNY PRODUKCYJNIE, a nie
-- tylko ustepstwem wobec kryterium testowego — i NIE jest zdublowany przez nic innego.
-- Obie sciezki bledu w src/pages/api/generate.ts faktycznie zostawiaja idempotency_key jako
-- NULL, ale to nie sa jedyne drogi do wiersza `failed`: failGenerationSession (kompensata po
-- nieudanym insercie kart) przestawia JUZ WSTAWIONY wiersz `succeeded` na `failed` i ZOSTAWIA
-- w nim klucz. Taki wiersz powstaje w normalnym dzialaniu aplikacji.
--
-- Czyli: te dwie ochrony NIE sa niezalezne i zadna z nich sama nie wystarcza. Bez predykatu
-- "Ponow" po nieudanym zapisie kart kolidowaloby z wlasnym insertem -> 500 -> retry martwy.
-- Nie usuwac predykatu na podstawie tego, ze sciezki bledu pisza NULL.
--
-- Indeks jest tez lookupem dedupu (user_id + klucz + status), wiec osobny nie jest potrzebny.
--
-- Rollback: drop index generation_session_idempotency_key_uidx;
--           alter table generation_session drop column idempotency_key;

alter table generation_session
  add column idempotency_key uuid;

create unique index generation_session_idempotency_key_uidx
  on generation_session (user_id, idempotency_key)
  where idempotency_key is not null
    and status = 'succeeded';
