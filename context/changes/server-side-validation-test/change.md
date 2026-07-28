---
change_id: server-side-validation-test
title: Server-side validation parity for card content rules (Risk #6)
status: new
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

Ryzyko #6 z test-plan.md §2 (serwer ufa klientowi). Do zrobienia zostala POLOWA "reguly tresci fiszek" (S-02): spreparowane zadanie lamiace FRONT_MAX/BACK_MAX na POST/PATCH /api/decks/[publicId]/cards* oraz /cards/batch ma dostac 4xx I NIC nie zapisac — asercja statusu ORAZ licznika wierszy niezaleznego od statusu, plus kontrola brzegowa na dokladnym limicie, zeby odmowy nie byly po prostu endpointem odrzucajacym wszystko; cialo 4xx nie moze odbijac wejscia. Polowa "limit tekstu zrodlowego" (S-04) jest juz zrobiona pod obcym kluczem: C10X-28, commit b520b90 — artefakty do podniesienia w context/archive/2026-07-26-ai-candidate-generation-test-2/ (plan.md Faza 3 oznaczona MOVED OUT, verification.md Faza 3, reviews/impl-review.md findingi F5-F7). Pulapki oplacone przez tamta faze: nie scope'owac filtra PostgREST dlugim source_text (414 URI too long powyzej ~8 KB — uzyc krotkiego markera na poczatku tekstu i .like, helpery sa juz w tests/fixtures/scoping.ts); licznik filtrowany po statusie to argument, nie asercja. Otwarta decyzja nalezaca do tego ticketu: czy wciagnac walidacje serwerowa tras auth (signin.ts/signup.ts nie sprawdzaja dzis niczego przed wywolaniem supabase-js — to doslownie Ryzyko #6). Wyladowanie tego testu jest jedyna rzecza miedzy test-plan.md §3 Faza 2 a statusem complete. (source: C10X-30)
