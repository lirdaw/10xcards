-- Migration: flashcard_state_no_touch_updated_at
-- Change: candidate-review (S-05, Jira C10X-8)
--
-- Do tej pory KAZDY UPDATE na flashcard byl edycja tresci (updateFlashcard ustawia
-- wylacznie front/back), wiec nieukwalifikowany trigger moddatetime byl poprawny.
-- S-05 wprowadza pierwszy UPDATE, ktory tresci NIE zmienia: setFlashcardState ustawia
-- samo state_id. Bez tej zmiany kazdy zaakceptowany kandydat trafialby do talii juz
-- oznaczony jako edytowany, a kazde "Odrzuc"/"Przywroc" stemplowaloby go od nowa —
-- FlashcardView.edited to `updated_at !== created_at`, renderowane jako
-- "Edytowano: <data>" (plan-review F4).
--
-- Zawezamy trigger do kolumn tresci. `update of front, back` odpala sie tylko wtedy, gdy
-- ktoras z wymienionych kolumn wystapi na LISCIE SET — co jest dokladnie tym, czego
-- chcemy: updateFlashcard ustawia front+back, setFlashcardState ustawia state_id.
--
-- UWAGA dla przyszlego pisarza: przyszly UPDATE dotykajacy tresci ORAZ innych kolumn w
-- jednej instrukcji nadal odpali trigger. To jest zamierzone — taki zapis JEST edycja
-- tresci. Warunek jest po liscie SET, nie po realnej zmianie wartosci: `set front = front`
-- rowniez podbije updated_at.
--
-- `create or replace trigger` wymaga PG14+; lokalny i chmurowy stack to PG15+.
-- Rollback: przywrocenie definicji z 20260705180246_init_core_schema.sql, tj.
--   create or replace trigger flashcard_set_updated_at
--     before update on flashcard
--     for each row execute function extensions.moddatetime (updated_at);

create or replace trigger flashcard_set_updated_at
  before update of front, back on flashcard
  for each row execute function extensions.moddatetime (updated_at);
