# S-01 · Domknięcie a11y + weryfikacja izolacji cross-account

## Przegląd a11y (statyczny, z kodu)

Bazowa dostępność powłoki i mutacji talii — potwierdzone w kodzie tego slice'a:

- **Nawigacja** — `Sidebar.astro` renderuje `<nav aria-label="Główna nawigacja">`; aktywna
  pozycja „Talie" ma `aria-current="page"`, a „Generuj"/„Nauka" mają `aria-disabled="true"`
  bez `href` (nieklikalne, poza tab-orderem).
- **Modale** — `Modal.tsx` na natywnym `<dialog>` + `showModal()`: fokus-trap, `Esc`-to-close
  i backdrop-click za darmo; tytuł powiązany przez `aria-labelledby` (`useId`). Fokus wraca do
  wyzwalacza po zamknięciu (natywne zachowanie `<dialog>`).
- **Pola formularzy** — `Label htmlFor` powiązany z `Input id` (create: `deck-name`, rename:
  `deck-rename`); `aria-invalid` ustawiane przy błędzie walidacji.
- **Przyciski** — dostępne nazwy z tekstu („Nowa talia", „Zmień nazwę", „Usuń", „Anuluj",
  „Zapisz", „Utwórz"); ikony `lucide-react` są dekoracyjne obok tekstu. Przycisk usuwania to
  `variant="destructive"`. Link powrotu ma `aria-label="Wróć do talii"`.
- **Bramka lint** — `eslint-plugin-jsx-a11y` przechodzi (`npm run lint` czysty).

## Test izolacji cross-account (ręczny, dwa konta)

Cel: potwierdzić twardą izolację per-konto na realnej funkcji (RLS + 404 na obcy `public_id`).

### Procedura

1. Konto A: zaloguj się, utwórz talię (np. „Talia A"). Zanotuj jej `public_id` z URL
   `/decks/<public_id_A>`.
2. Konto B: zaloguj się (inne konto), utwórz talię (np. „Talia B"). Zanotuj `public_id_B`.
3. Jako A:
   - **Lista** — `/decks` pokazuje wyłącznie „Talia A"; „Talia B" niewidoczna.
   - **Bezpośredni URL** — wejście na `/decks/<public_id_B>` → **404** (nie 403, nie treść B).
   - **Kontrola pozytywna** — wejście na `/decks/<public_id_A>` → widoczna własna talia.
4. (Opcjonalnie) jako A spróbuj rename/delete obcej przez URL `/api/decks/<public_id_B>` —
   RLS nie dotyka cudzego wiersza (0 wierszy → 404 przy rename; delete no-op).

### Wynik

- [x] Data testu: 2026-07-08  (tester: Dawid)
- [x] Konto B nie widzi talii A na `/decks`
- [x] `/decks/<public_id_A>` jako B → 404
- [x] Kontrola pozytywna: B widzi własne talie na `/decks`

> Uwaga: automatyczny test izolacji to F-03 (harness). Tu izolację weryfikujemy ręcznie zgodnie
> z zakresem S-01 (patrz `plan.md` → What We're NOT Doing).
