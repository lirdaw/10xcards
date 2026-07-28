---
change_id: server-side-validation-test
title: Server-side validation parity for card content rules (Risk #6)
status: implemented
created: 2026-07-28
updated: 2026-07-28
archived_at: null
---

## Notes

### Po co to robimy — uzasadnienie biznesowe

Reguly tresci fiszki (maksymalna dlugosc przodu i tylu) sa dzis egzekwowane w
formularzu w przegladarce. Formularz to wygoda dla uzytkownika, nie straznik —
kto chce, wysyla dane wlasnym skryptem i te reguly go nie dotycza. Pytanie, na
ktore ta zmiana ma odpowiedziec dowodem, brzmi: czy serwer odmawia sam z siebie,
czy tylko zaklada, ze formularz juz odsial zle dane.

Trzy rzeczy, ktorych to zadanie NIE dotyczy — zapisane, bo kazda z nich pojawila
sie jako naturalne (i mylne) odczytanie zakresu:

- **To nie jest ochrona przed obcym / niezalogowanym.** Dostep i izolacja kont
  sa juz egzekwowane po stronie serwera i pokryte testami jako Ryzyko #1.
  Scenariusz tutaj to uzytkownik zalogowany **normalnie, na swoim koncie**,
  ktory omija wlasny formularz.
- **Nie blokujemy "skryptow z boku" jako takich.** Nie rozpoznajemy i nie
  zamierzamy rozpoznawac, czy zadanie przyszlo z przegladarki — to trywialnie
  podrabialne, wiec byla by to obrona pozorna. Reguly maja obowiazywac tak samo
  niezaleznie od kanalu.
- **Skutkiem naruszenia nie jest wyciek, tylko smieci w bazie.** Zawartosc,
  ktorej produkt nigdy nie mial przyjac, trafia do talii i psuje widoki, ktore
  nigdzie dalej nie zakladaja, ze cos takiego moze istniec.

Wartosc dla projektu: to ostatnia rzecz miedzy §3 Faza 2 w test-plan.md a
statusem `complete` — dopoki jej nie ma, polowicznie pokryte ryzyko nie moze byc
zapisane jako pokryte.

### Zakres techniczny (z ticketu C10X-30)

Ryzyko #6 z test-plan.md §2 (serwer ufa klientowi). Do zrobienia zostala POLOWA "reguly tresci fiszek" (S-02): spreparowane zadanie lamiace FRONT_MAX/BACK_MAX na POST/PATCH [POPRAWKA 2026-07-28: samo POST — zaden z tych dwoch endpointow nie eksportuje handlera PATCH] /api/decks/[publicId]/cards* oraz /cards/batch ma dostac 4xx [POPRAWKA 2026-07-28: 4xx to konwencja /cards/batch (JSON). Endpointy create/edit sa celem natywnego formularza i odmawiaja **302** na wlasny URL z ?error= — czyli tym samym statusem, co sukces. Dlatego asercja statusu sama w sobie nic tu nie dowodzi i orakl wierszowy nie jest dodatkiem, tylko jedyna asercja; patrz test-plan.md §6.10] — asercja statusu ORAZ licznika wierszy niezaleznego od statusu, plus kontrola brzegowa na dokladnym limicie, zeby odmowy nie byly po prostu endpointem odrzucajacym wszystko; cialo 4xx nie moze odbijac wejscia. Polowa "limit tekstu zrodlowego" (S-04) jest juz zrobiona pod obcym kluczem: C10X-28, commit b520b90 — artefakty do podniesienia w context/archive/2026-07-26-ai-candidate-generation-test-2/ (plan.md Faza 3 oznaczona MOVED OUT, verification.md Faza 3, reviews/impl-review.md findingi F5-F7). Pulapki oplacone przez tamta faze: nie scope'owac filtra PostgREST dlugim source_text (414 URI too long powyzej ~8 KB — uzyc krotkiego markera na poczatku tekstu i .like, helpery sa juz w tests/fixtures/scoping.ts); licznik filtrowany po statusie to argument, nie asercja. Otwarta decyzja nalezaca do tego ticketu: czy wciagnac walidacje serwerowa tras auth (signin.ts/signup.ts nie sprawdzaja dzis niczego przed wywolaniem supabase-js — to doslownie Ryzyko #6). Wyladowanie tego testu jest jedyna rzecza miedzy test-plan.md §3 Faza 2 a statusem complete. (source: C10X-30)

### Wynik — co realnie wjechalo i dlaczego szerzej niz ticket (2026-07-28)

Zakres zostal rozszerzony **decyzja podjeta na etapie planowania**, nie po fakcie. Trzy
rzeczy poza literalnym ticketem:

1. **Backstop w bazie.** `FRONT_MAX`/`BACK_MAX` nie mialy zadnego egzekutora ponizej kodu
   aplikacji — to reszkowe ryzyko zapisane 2026-07-09 w S-02
   (`context/archive/2026-07-09-manual-card-crud/plan-brief.md:80-81`). Migracja
   `20260728104500_flashcard_content_bounds.sql` promuje dwa CHECK-i `char_length > 0` do
   `between 1 and N`, tak samo jak `20260724220524` zrobilo to z `deck_session_size_check`.
   Konsekwencja dla testu: pojedynczy przebieg zepsucia nie odroznia „zlapal endpoint" od
   „zlapala baza", wiec dowod to **para** przebiegow.
2. **Trzy defekty klasy „serwer ufa klientowi" na tych samych czterech endpointach
   formularzowych** — niezabezpieczony `formData()` (cialo nie-formularzowe → niekontrolowane
   `500` bez wlasnej tresci), czesc typu `File` wykladajaca handler na `.trim()`, oraz
   nieprzetestowany limit `IDS_MAX` na `/cards/batch`. Naprawione tutaj zamiast odlozone po
   raz drugi.
3. **Walidacja wejscia tras auth NIE wchodzi** — otwarta decyzja z ticketu rozstrzygnieta na
   „nie": nasze trasy auth nie maja dzis ani jednej linii walidacji, wiec test tam nie dalby
   sie zaswiecic na czerwono zadna edycja w `src/` (pinowalby `supabase/config.toml`). Poszlo
   jako **C10X-36** (`auth-input-validation`, Post-MVP). To, co wjechalo na `signin.ts` /
   `signup.ts`, to wylacznie obsluga zepsutego ciala zadania — nie regula wejsciowa; testy w
   `tests/auth/errors.test.ts` maja komentarz stawiajacy te granice.

Efekt dla planu testow: `test-plan.md` §3 Faza 2 → **`complete`** (2026-07-28), Ryzyko #6
pokryte **po stronie serwera**; polowa wyspowa (klient) pozostaje niepokryta i jest nazwana
w §7. Suite: **193/193, 16 plikow**. Dowody:
`context/changes/server-side-validation-test/verification.md`.
