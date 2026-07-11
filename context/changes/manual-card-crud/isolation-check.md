# S-02 · Domknięcie a11y + weryfikacja izolacji cross-account (fiszki)

## Przegląd a11y (statyczny, z kodu)

Dostępność workspace'u fiszek oraz mutacji (create/edit/delete) — potwierdzone w kodzie
tego slice'a:

- **Modale** — `CreateFlashcardModal` i `ConfirmDeleteModal` używają wspólnego `Modal.tsx`
  na natywnym `<dialog>` + `showModal()`: fokus-trap, `Esc`-to-close i backdrop-click za
  darmo; tytuł powiązany przez `aria-labelledby` (`useId`). Fokus wraca do wyzwalacza po
  zamknięciu (natywne zachowanie `<dialog>`).
- **Pola formularzy** — `Label htmlFor` powiązany z `Textarea id` (create: `card-front` /
  `card-back`; inline-edit: `card-front-<publicId>` / `card-back-<publicId>` — unikatowe id
  per fiszka); `aria-invalid` ustawiane przy błędzie walidacji. Licznik znaków (`CharCount`)
  robi się czerwony po przekroczeniu limitu.
- **Inline-edit** — po „Edytuj" fokus trafia na pole „Przód" (`autoFocus`); „Anuluj"
  przywraca widok read-only bez zapisu.
- **Przyciski** — dostępne nazwy z tekstu („Dodaj fiszkę", „Edytuj", „Usuń", „Zapisz",
  „Anuluj", „Utwórz"); ikony `lucide-react` są dekoracyjne obok tekstu. Przycisk usuwania to
  `variant="destructive"`.
- **Cała kopia UI po polsku.**
- **Bramka lint** — `eslint-plugin-jsx-a11y` przechodzi (`npm run lint` czysty).

## Test izolacji cross-account (ręczny, dwa konta)

Cel: potwierdzić twardą izolację per-konto na fiszkach (RLS + scoping po `deck_id` + 404 na
obcy/nieistniejący `public_id`). Konto B nie może odczytać, edytować ani usunąć fiszek konta A.

### Procedura

1. Konto A: zaloguj się, wejdź w talię, utwórz fiszkę (np. front „Pytanie A"). Zanotuj
   `public_id` talii z URL `/decks/<deck_A>` oraz `public_id` fiszki (z parametru `edit`
   po kliknięciu „Edytuj", albo z panelu bazy).
2. Konto B: zaloguj się (inne konto), utwórz własną talię i fiszkę.
3. Jako B:
   - **Lista** — wejście na `/decks/<deck_A>` → **404** (nie widać ani talii, ani fiszek A).
   - **Edycja obcej fiszki** — POST na `/api/decks/<deck_A>/cards/<card_A>` (np. z formularza
     w devtoolsach) → **404** (0 wierszy zaktualizowanych; scoping po `deck_id` + RLS).
   - **Usunięcie obcej fiszki** — POST na `/api/decks/<deck_A>/cards/<card_A>/delete` →
     **404** (0 wierszy usuniętych).
   - **Kontrola pozytywna** — B edytuje/usuwa WŁASNĄ fiszkę → sukces (redirect na własną talię).
4. Jako A: odśwież własną talię — fiszka „Pytanie A" nadal istnieje (próby B jej nie tknęły).

> Uwaga (lessons): w Studio dodaj `RETURNING` do UPDATE/DELETE przy weryfikacji izolacji zapisu
> — bez tego „No rows returned" myli 0 z 1 wierszem. Endpointy używają `.select(...).maybeSingle()`,
> więc `!data` = 0 wierszy = 404.

### Wynik

- [x] Data testu: 2026-07-11  (tester: Dawid)
- [x] Konto B nie widzi fiszek A (`/decks/<deck_A>` → 404)
- [x] Edycja obcej fiszki jako B → 404 (0 wierszy)
- [x] Usunięcie obcej fiszki jako B → 404 (0 wierszy)
- [x] Kontrola pozytywna: B edytuje/usuwa własną fiszkę → sukces
- [x] Fiszka A nietknięta po próbach B

> Uwaga: automatyczny test izolacji to F-03 (harness). Tu izolację weryfikujemy ręcznie zgodnie
> z zakresem S-02 (patrz `plan.md` → What We're NOT Doing).
