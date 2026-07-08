# S-01 · Talie jako prywatna przestrzeń robocza — Implementation Plan

## Overview

Dostarczamy pierwszy pionowy slice produktowy: zalogowany użytkownik tworzy i nazywa
własne talie, widzi je jako prywatną listę i wchodzi do środka talii. Slice buduje na
gotowej warstwie danych z F-01 (tabele `deck`/`flashcard` + RLS) oraz na istniejącym auth,
i po raz pierwszy stawia bramkowany dostęp w realnym użyciu produktowym. Przy okazji
powstaje trwała powłoka nawigacji (Talie / Generuj / Nauka) — architektura informacji, którą
dziedziczą kolejne slice'y — oraz kontrakt URL talii (`/decks/[publicId]`), na którym zbuduje
S-02 (CRUD fiszek).

## Current State Analysis

- **Warstwa danych — gotowa (F-01).** Migracja `supabase/migrations/20260705180246_init_core_schema.sql`
  tworzy `deck` z: `id bigint` (wewnętrzne), `public_id uuid` (publiczny uchwyt, auto),
  `user_id uuid` FK → `auth.users`, `name text CHECK (char_length between 1 and 100)`,
  `UNIQUE (user_id, name)`, `ON DELETE CASCADE`, triggery `updated_at`. RLS deny-by-default z
  politykami filtrującymi po `(select auth.uid())`. Typy w `src/db/database.types.ts:37-63`
  (`Tables<"deck">`, `TablesInsert<"deck">`).
- **Auth — gotowe.** `src/middleware.ts` tworzy klienta SSR, ustawia `context.locals.user`
  (`src/env.d.ts` deklaruje `App.Locals.user`), chroni `PROTECTED_ROUTES = ["/dashboard"]`,
  przekierowuje niezalogowanego na `/auth/signin`. Klient z `src/lib/supabase.ts` niesie
  sesję (cookies + klucz `anon`), więc zapytania do `deck` są automatycznie RLS-scoped.
- **Wzorzec API — istnieje.** `src/pages/api/auth/{signin,signup,signout}.ts`: `createClient(request.headers, cookies)`,
  null-check, odczyt `formData`, na błąd `context.redirect(\`...?error=${encodeURIComponent(msg)}\`)`,
  na sukces `redirect`. Brak jawnych statusów HTTP (polega na 302 z `redirect`). Tryb `output: "server"`
  (`astro.config.mjs`), więc endpointy są on-demand — bez `export const prerender`.
- **Czego brak.** Żadnej warstwy UI/API dla talii. Brak lewej nawigacji (jest tylko poziomy
  `src/components/Topbar.astro`, użyty na landingu). Z komponentów `ui/` istnieje tylko
  `button.tsx` (cva + `cn`); brak `input`/`label`/`card`/dialog. `zod` nie jest zależnością.

### Key Discoveries:

- RLS chroni **tylko** dopóki ścieżki użytkownika używają klienta SSR z kluczem `anon` +
  sesją (`src/lib/supabase.ts`). Nie wolno wprowadzać klienta service-role dla ścieżek
  użytkownika — obszedłby izolację (lekcja: „RLS tests need role + JWT claims").
- Insert do `deck` musi jawnie ustawić `user_id` — polityka `deck_insert` ma
  `with check (user_id = (select auth.uid()))`; `user_id` bierzemy z `context.locals.user.id`.
- Publiczny uchwyt to `public_id uuid`; wewnętrzne `bigint id` nigdy nie wychodzi na front —
  trasy i formularze operują na `public_id`.
- `name` ma `CHECK (1..100)` i `UNIQUE (user_id, name)` — baza jest ostatecznym backstopem
  walidacji; kod aplikacji daje przyjazne komunikaty PL.
- Formularze auth używają natywnego `<form method="POST">` z walidacją klienta w React
  (`src/components/auth/SignInForm.tsx`), stan pending przez `useFormStatus()`
  (`src/components/auth/SubmitButton.tsx`) — wzorzec do naśladowania.
- `db:types` (`npm run db:types`) regeneruje typy z lokalnej bazy; `npx astro sync` wymagany
  po zmianie tras przed lint/build (AGENTS.md).

## Desired End State

Zalogowany użytkownik po wejściu do aplikacji ląduje na `/decks` w powłoce ze stałą lewą
nawigacją (Talie aktywne; Generuj/Nauka widoczne, wyłączone). Widzi listę wyłącznie własnych
talii (lub stan pusty z CTA), tworzy nową talię przez modal, zmienia jej nazwę i usuwa ją z
potwierdzeniem. Kliknięcie talii otwiera `/decks/[publicId]` ze stanem pustym fiszek. Cudze
talie są niewidoczne i niedostępne (RLS + 404 na obcy `public_id`). Niezalogowany nie wchodzi
do żadnej trasy `/decks*` ani `/api/decks*` — jest przekierowany na `/auth/signin`.

Weryfikacja: dwa konta (A, B) — A nie widzi talii B na liście ani pod bezpośrednim URL
`/decks/<public_id_B>` (404); `lint` + `build` przechodzą; `astro sync` czysty.

## What We're NOT Doing

- **CRUD fiszek** (tworzenie/edycja/lista kart) — to S-02. Strona talii ma tylko stan pusty.
- **Generacja AI** i **sesja nauki SRS** — pozycje nawigacji Generuj/Nauka są wyłączone
  (placeholdery), bez funkcji (S-04/S-03).
- **Kosz / miękkie usuwanie / odzyskiwanie** talii — usuwanie w S-01 jest trwałe (kosz to
  osobny pomysł, C10X-14). Kaskada usuwa karty, ale w S-01 talie nie mają jeszcze kart.
- **Automatyczny test izolacji** — to F-03 (harness). W S-01 izolację weryfikujemy ręcznie.
- **Wyszukiwanie/filtrowanie talii**, sortowanie, paginacja — poza zakresem (brak w PRD dla
  talii; wyszukiwanie fiszek to S-06).
- **Dodawanie `zod`** — walidacja ręczna + ograniczenia DB.
- **Zmiana stron auth** poza redirectem po zalogowaniu; **`/dashboard`** zostaje nietknięty.

## Implementation Approach

Trzy fazy, od powłoki w dół do mutacji. Faza 1 buduje wielokrotnie używalną powłokę
(prymitywy UI + `AuthenticatedLayout` + routing/ochrona/redirect), tak by kolejne slice'y
miały gotowy chrome. Faza 2 dostarcza ścieżkę odczytu i tworzenia (lista, modal, endpoint
create, strona talii). Faza 3 dokłada mutacje (rename, delete) i domyka weryfikację
(a11y + izolacja cross-account). Wszystkie zapytania idą przez klienta SSR (RLS-scoped);
endpointy trzymają się istniejącej konwencji form POST → redirect z `?error=`. Dostęp do
danych talii izolujemy w helperze `src/lib/decks.ts`, żeby strony i endpointy nie duplikowały
zapytań.

## Critical Implementation Details

- **Modal na natywnym `<dialog>`.** Użyj elementu `<dialog>` (HTMLDialogElement,
  `showModal()`), który daje fokus-trap, `Esc`-to-close i backdrop bez własnej logiki pułapki
  fokusu. To najtańsza droga do bazowej a11y modala; ręczny fokus-trap jest zbędny.
- **Modal + form POST + redirect — obsługa błędu.** Ponieważ create/rename to natywny POST z
  przeładowaniem strony, po błędzie walidacji wracamy na `/decks?error=<msg>` (lub
  `/decks?error=<msg>&open=create`), a strona `/decks` po stronie serwera czyta `error`/`open`
  z query i renderuje baner błędu oraz — gdy `open=create` — otwiera modal z powrotem. Bez
  tego błąd zniknąłby wraz z zamknięciem modala po reload. Ten sam wzorzec obejmuje **rename**:
  ponieważ akcje mutacji żyją na stronie pojedynczej talii (Faza 3 §3), błąd rename wraca na
  `/decks/<publicId>?error=<msg>&open=rename`, a ta strona re-otwiera własny modal rename z
  prefillem poprzedniej nazwy — kontekst jest już scoped do jednej talii, więc nie trzeba
  przenosić `publicId` w query ani rozróżniać wierszy. Bez tego błąd i wpisana nazwa przepadają.
- **Pre-check nazwy + backstop UNIQUE.** Przed insertem sprawdzamy istnienie nazwy zapytaniem
  (przyjazna ścieżka). Że to TOCTOU-race: jeśli mimo to insert zwróci Postgres `23505`,
  mapujemy go na ten sam komunikat „Talia o tej nazwie już istnieje" zamiast 500. DB pozostaje
  źródłem prawdy o unikalności.
- **`public_id` w trasach, nigdy `id`.** Strony i endpointy `[publicId]` filtrują po
  `public_id`; brak wiersza (nie istnieje LUB RLS ukrył cudzy) → `404` (nie 403 — nie
  ujawniamy istnienia cudzej talii).

## Phase 1: Prymitywy UI + powłoka nawigacji + routing

### Overview

Powstają brakujące komponenty UI i trwała powłoka aplikacji po zalogowaniu, plus ochrona
tras i przekierowania tak, że „Talie" jest widokiem startowym. Po tej fazie istnieje pusta,
chroniona strona `/decks` w powłoce z nawigacją.

### Changes Required:

#### 1. Prymitywy UI

**File**: `src/components/ui/input.tsx`, `src/components/ui/label.tsx`, `src/components/ui/card.tsx`

**Intent**: Dodać brakujące, wielokrotnie używalne komponenty formularza i listy w stylu
istniejącego `button.tsx`, żeby modal talii i lista miały spójny wygląd bez ręcznego
stylowania inline.

**Contract**: Każdy to `React.ComponentProps<...>` + `className` scalane przez `cn()`
(`@/lib/utils`). `card.tsx` eksportuje `Card` (+ ewentualnie `CardHeader`/`CardTitle`/`CardContent`
wg potrzeb listy). Bez `cva` tam, gdzie nie ma wariantów (input/label); `card` może mieć
minimalny wariant lub żaden. Zgodne z `eslint-plugin-jsx-a11y` (label z `htmlFor`).

#### 2. Modal (dialog) na natywnym `<dialog>`

**File**: `src/components/ui/Modal.tsx`

**Intent**: Dostępny modal wielokrotnego użytku (tworzenie/rename/potwierdzenie usunięcia)
oparty na `HTMLDialogElement`, sterowany z klienta, zawierający natywny `<form>` wewnątrz.

**Contract**: Props `{ open?: boolean; title: string; children; onClose? }`. Wywołuje
`dialog.showModal()`/`.close()` w reakcji na `open`; `Esc` i klik w backdrop zamykają;
tytuł powiązany przez `aria-labelledby`. Zawartość (pola formularza, przyciski) przekazywana
jako children — modal jest tylko prezentacją, submit robi natywny `<form method="POST">`
w środku.

#### 3. Powłoka nawigacji

**File**: `src/layouts/AuthenticatedLayout.astro`, `src/components/Sidebar.astro`

**Intent**: Trwała powłoka dla stron produktowych: opakowuje istniejący `Layout.astro`
i renderuje stały lewy sidebar z pozycjami Talie / Generuj / Nauka. Ustawia architekturę
informacji z PRD dla wszystkich kolejnych slice'ów.

**Contract**: `AuthenticatedLayout` przyjmuje `{ title?: string }` (przekazuje do `Layout`),
zakłada zalogowanego (ochrona tras jest w middleware) i renderuje `<Sidebar activeItem=... />`
obok `<slot />`. `Sidebar` renderuje `<nav aria-label="Główna nawigacja">` z linkiem
„Talie" → `/decks` (stan aktywny przez `aria-current="page"`) oraz „Generuj"/„Nauka" jako
elementy wyłączone (`aria-disabled="true"`, bez `href` lub `tabindex="-1"`). Copy po polsku.

#### 4. Ochrona tras i przekierowania

**File**: `src/middleware.ts`, `src/pages/api/auth/signin.ts`, `src/pages/index.astro`

**Intent**: Uczynić przestrzeń talii chronioną i ustawić „Talie" jako widok startowy.

**Contract**:
- `middleware.ts`: dodać `"/decks"` i `"/api/decks"` do `PROTECTED_ROUTES` (dopasowanie
  `startsWith` już obsługuje podścieżki, w tym `/decks/[publicId]`).
- `signin.ts`: zmienić redirect sukcesu z `/` na `/decks`.
- `index.astro`: gdy `Astro.locals.user` istnieje → `Astro.redirect("/decks")`; w przeciwnym
  razie bez zmian (landing dla gościa).

#### 5. Tymczasowa strona `/decks` (weryfikacja powłoki)

**File**: `src/pages/decks/index.astro`

**Intent**: Minimalna chroniona strona w `AuthenticatedLayout`, żeby zweryfikować powłokę,
ochronę i redirecty przed dobudowaniem listy (rozbudowana w Fazie 2).

**Contract**: Renderuje `AuthenticatedLayout` z nagłówkiem „Talie". Czyta `Astro.locals.user`
(wzór `dashboard.astro`). Na tym etapie treść może być placeholderem.

### Success Criteria:

#### Automated Verification:

- Typy tras zsynchronizowane: `npx astro sync`
- Linting przechodzi: `npm run lint`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Niezalogowany wchodzący na `/decks` jest przekierowany na `/auth/signin`.
- Po zalogowaniu użytkownik ląduje na `/decks` (redirect z signin) i widzi lewy sidebar.
- `/` dla zalogowanego przekierowuje na `/decks`; dla gościa pokazuje landing.
- Pozycje „Generuj"/„Nauka" są widoczne, wyłączone i nieklikalne; „Talie" ma stan aktywny.
- Modal otwiera się i zamyka klawiszem `Esc` oraz kliknięciem w tło; fokus wraca po zamknięciu.

**Implementation Note**: Po ukończeniu fazy i przejściu weryfikacji automatycznej zatrzymaj
się na ręczne potwierdzenie przez człowieka, zanim przejdziesz do Fazy 2.

---

## Phase 2: Lista + tworzenie + strona talii

### Overview

Ścieżka odczytu i tworzenia: `/decks` renderuje własne talie (lub stan pusty), modal tworzy
talię przez endpoint, a `/decks/[publicId]` pokazuje wnętrze talii ze stanem pustym fiszek.

### Changes Required:

#### 1. Helper dostępu do danych talii

**File**: `src/lib/decks.ts`

**Intent**: Jedno miejsce na zapytania o talie, żeby strony i endpointy nie duplikowały logiki
Supabase; wszystkie zapytania RLS-scoped przez przekazany klient SSR.

**Contract**: Funkcje przyjmujące już utworzonego klienta (`SupabaseClient<Database>`), np.
`listDecks(supabase)` → własne talie posortowane (np. po `created_at desc`),
`getDeckByPublicId(supabase, publicId)` → pojedyncza talia lub `null`,
`createDeck(supabase, userId, name)`, `renameDeck(supabase, publicId, name)`,
`deleteDeck(supabase, publicId)`. Zwracają dane/`error` z Supabase; mapowanie błędów na
komunikaty PL zostaje w endpointach. Używają `public_id`, nie `id`.

#### 2. Endpoint tworzenia talii

**File**: `src/pages/api/decks/index.ts`

**Intent**: Przyjąć nazwę z formularza, zwalidować, pre-checkować unikalność, wstawić talię
przypisaną do zalogowanego użytkownika, wrócić na `/decks`.

**Contract**: `export const POST: APIRoute`. Wzór z `api/auth/signin.ts`: `createClient(...)`,
null-check → redirect z `?error=`. `user_id` z `context.locals.user`; jeśli brak usera →
redirect `/auth/signin`. Kroki: odczyt `formData().get("name")`; trim + walidacja długości
1–100 (inaczej redirect `/decks?error=<msg>&open=create`); pre-check istnienia nazwy dla tego
usera; insert `{ user_id, name }`. Na `23505` (race) → ten sam komunikat o duplikacie. Sukces
→ `redirect("/decks")`.

#### 3. Lista talii + modal tworzenia

**File**: `src/pages/decks/index.astro`, `src/components/decks/CreateDeckModal.tsx`, `src/components/decks/DeckList.astro` (lub inline)

**Intent**: Pokazać własne talie jako listę linkujących kart lub stan pusty z CTA; umożliwić
tworzenie przez modal z natywnym formularzem POST.

**Contract**:
- `decks/index.astro`: pobiera talie przez `listDecks(supabase)` (klient z
  `createClient(Astro.request.headers, Astro.cookies)`); czyta `error`/`open` z
  `Astro.url.searchParams` i renderuje baner błędu; renderuje listę lub stan pusty
  („Nie masz jeszcze talii — utwórz pierwszą") z przyciskiem otwierającym modal. Każda talia
  linkuje do `/decks/${public_id}`. W `AuthenticatedLayout`.
- `CreateDeckModal.tsx` (React island, `client:load`): przycisk „Nowa talia" + `Modal` z
  `<form method="POST" action="/api/decks">` zawierającym `Input` name="name" (z `Label`) i
  `SubmitButton` (pending przez `useFormStatus`). Otwiera się automatycznie, gdy prop
  `defaultOpen` (z `open=create` w query) jest ustawiony; walidacja klienta jak w
  `SignInForm.tsx` (długość 1–100).

#### 4. Strona pojedynczej talii (stan pusty)

**File**: `src/pages/decks/[publicId]/index.astro`

**Intent**: Wnętrze talii dostępne pod stabilnym URL (kontrakt dla S-02), na razie ze stanem
pustym fiszek; twardo izolowane.

**Contract**: Pobiera talię przez `getDeckByPublicId(supabase, Astro.params.publicId)`. Gdy
`null` (nie istnieje LUB RLS ukrył cudzą) → zwrócenie `new Response(null, { status: 404 })`.
Świadomie akceptujemy surową, niestylowaną stronę 404 w MVP (brak `src/pages/404.astro` w
repo) — izolacja (404, nie 403) jest tu istotą; dedykowana strona 404 z copy PL to osobne,
odroczone dopięcie UX. Renderuje nazwę talii w `AuthenticatedLayout` + stan pusty („Brak
fiszek w tej talii" — fiszki dojdą w S-02). Przyciski rename/delete dochodzą w Fazie 3.

### Success Criteria:

#### Automated Verification:

- Typy tras zsynchronizowane: `npx astro sync`
- Linting przechodzi: `npm run lint`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Nowy użytkownik bez talii widzi stan pusty z działającym CTA.
- Utworzenie talii przez modal dodaje ją do listy i przekierowuje na `/decks`.
- Pusta nazwa i nazwa >100 znaków są odrzucane z czytelnym komunikatem PL; modal wraca
  otwarty z błędem.
- Utworzenie drugiej talii o tej samej nazwie pokazuje „Talia o tej nazwie już istnieje".
- Kliknięcie talii otwiera `/decks/[publicId]` ze stanem pustym; wejście na obcy/nieistniejący
  `public_id` daje 404.
- Stan pending widoczny na przycisku podczas zapisu.

**Implementation Note**: Po ukończeniu fazy i przejściu weryfikacji automatycznej zatrzymaj
się na ręczne potwierdzenie przez człowieka, zanim przejdziesz do Fazy 3.

---

## Phase 3: Zmiana nazwy + usuwanie + weryfikacja

### Overview

Mutacje talii (rename, delete) oraz domknięcie jakościowe: przegląd a11y i ręczna weryfikacja
izolacji cross-account.

### Changes Required:

#### 1. Endpoint zmiany nazwy

**File**: `src/pages/api/decks/[publicId].ts`

**Intent**: Zmienić nazwę własnej talii, z tą samą walidacją i obsługą duplikatu co przy
tworzeniu.

**Contract**: `export const POST: APIRoute`. `createClient` + null-check + user-check.
Walidacja i pre-check nazwy jak w create; `renameDeck(supabase, publicId, name)` (RLS
gwarantuje, że można zmienić tylko własną — cudza da 0 wierszy). Na `23505` → komunikat o
duplikacie. Sukces → redirect na `/decks/${publicId}` (strona talii). Błąd walidacji/duplikatu
→ redirect na `/decks/${publicId}?error=<msg>&open=rename`, żeby strona talii re-otwarła własny
modal rename z prefillem (patrz Critical Implementation Details) — spójnie z round-tripem create;
bez tego błąd i wpisana nazwa przepadają po przeładowaniu.

#### 2. Endpoint usuwania

**File**: `src/pages/api/decks/[publicId]/delete.ts`

**Intent**: Trwale usunąć własną talię (kaskada usuwa ewentualne karty) po potwierdzeniu.

**Contract**: `export const POST: APIRoute` (formularze HTML nie robią DELETE — używamy POST na
dedykowanej ścieżce). `createClient` + null-check + user-check; `deleteDeck(supabase, publicId)`
(RLS: tylko własna). Sukces → `redirect("/decks")`. Błąd → redirect z `?error=`.

#### 3. Akcje rename/delete w UI

**File**: `src/components/decks/DeckActions.tsx` (użyte **wyłącznie** na `/decks/[publicId]`)

**Intent**: Wystawić zmianę nazwy i usuwanie z potwierdzeniem, spójnie z modalem tworzenia.
Decyzja: akcje mutacji żyją na stronie pojedynczej talii (jeden modal, jeden kontekst błędu);
lista `/decks` pozostaje read-only + tworzenie. Dzięki temu round-trip błędu jest scoped do
jednej talii i nie wymaga rozróżniania wielu wierszy.

**Contract**: React island. „Zmień nazwę" → `Modal` z `<form method="POST" action="/api/decks/${publicId}">`
i polem `name` prefill. „Usuń" → `Modal` potwierdzenia (destrukcyjny `Button variant="destructive"`)
z `<form method="POST" action="/api/decks/${publicId}/delete">`. Walidacja rename po stronie
klienta jak przy tworzeniu; komunikaty błędów serwera przez baner na `/decks/[publicId]` (strona
talii czyta `error`/`open` z query i re-otwiera modal rename — patrz Critical Implementation Details).

#### 4. Domknięcie a11y + weryfikacja izolacji

**File**: (przegląd istniejących plików tego slice'a; `context/changes/deck-workspace/isolation-check.md`)

**Intent**: Potwierdzić bazową dostępność i twardą izolację per-konto na realnej funkcji.

**Contract**: Przegląd: `<nav aria-label>`, `aria-current` na aktywnej pozycji, `aria-disabled`
na wyłączonych, `Label htmlFor` przy polach, fokus-trap/Esc w modalach, dostępne nazwy
przycisków. Ręczny test dwóch kont (A, B) udokumentowany w `isolation-check.md`: A nie widzi
talii B na `/decks` ani pod `/decks/<public_id_B>` (404); pozytywna kontrola: A widzi własne
talie.

### Success Criteria:

#### Automated Verification:

- Typy tras zsynchronizowane: `npx astro sync`
- Linting przechodzi: `npm run lint`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Zmiana nazwy talii działa i pojawia się na liście; kolizja nazwy pokazuje komunikat o
  duplikacie.
- Usunięcie talii po potwierdzeniu znika z listy; anulowanie potwierdzenia nic nie zmienia.
- Nawigacja i modale są obsługiwalne klawiaturą; czytnik ekranu ogłasza etykiety nawigacji,
  pól i przycisków.
- Udokumentowany dowód izolacji: konto A nie widzi danych konta B (lista + bezpośredni URL);
  A widzi własne (pozytywna kontrola).

**Implementation Note**: Po ukończeniu fazy i przejściu weryfikacji automatycznej zatrzymaj
się na ręczne potwierdzenie przez człowieka.

---

## Testing Strategy

Brak runnera testów w baseline (dochodzi w F-03), więc weryfikacja S-01 jest ręczna +
automatyczne bramki `astro sync`/`lint`/`build`.

### Manualne scenariusze:

1. Gość → `/decks` → redirect na `/auth/signin`; po zalogowaniu → `/decks`.
2. Stan pusty → utwórz talię → widoczna na liście.
3. Walidacja: pusta nazwa, nazwa >100 znaków, duplikat nazwy — każde z czytelnym komunikatem PL.
4. Wejście do talii → `/decks/[publicId]` stan pusty; obcy/nieistniejący `public_id` → 404.
5. Rename talii (w tym kolizja nazwy); delete z potwierdzeniem i anulowaniem.
6. Izolacja: dwa konta, brak widoczności cudzych talii (lista + bezpośredni URL), pozytywna
   kontrola własnych.
7. A11y: pełna obsługa klawiaturą nawigacji i modali; fokus wraca po zamknięciu.

## Performance Considerations

Zapytania listy są po `user_id` (indeks `deck_user_id_idx` z F-01) i małej kardynalności
(talie per użytkownik) — bez obaw. NFR: potwierdzenie akcji ~200 ms — pending state na
przyciskach pokrywa percepcję podczas POST + redirect.

## Migration Notes

Brak zmian schematu — warstwa danych z F-01 wystarcza. Nie dotykamy `supabase/migrations/`.

## References

- Change identity: `context/changes/deck-workspace/change.md`
- Roadmapa (S-01): `context/foundation/roadmap.md:124-134`
- PRD: US-03, FR-017, FR-001, FR-002; architektura informacji (nawigacja) — `context/foundation/prd.md`
- Warstwa danych (F-01): `supabase/migrations/20260705180246_init_core_schema.sql`, `src/db/database.types.ts:37-63`
- Wzorzec endpointu: `src/pages/api/auth/signin.ts`
- Wzorzec formularza + pending: `src/components/auth/SignInForm.tsx`, `src/components/auth/SubmitButton.tsx`
- Ochrona tras + locals: `src/middleware.ts`, `src/env.d.ts`
- Lekcje: `context/foundation/lessons.md` (RLS role+JWT, cloud migration, branch = main)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Prymitywy UI + powłoka nawigacji + routing

#### Automated

- [x] 1.1 Typy tras zsynchronizowane: `npx astro sync` — 2fea28e
- [x] 1.2 Linting przechodzi: `npm run lint` — 2fea28e
- [x] 1.3 Build przechodzi: `npm run build` — 2fea28e

#### Manual

- [x] 1.4 Niezalogowany na `/decks` → redirect `/auth/signin` — 2fea28e
- [x] 1.5 Po zalogowaniu ląduje na `/decks` z lewym sidebarem — 2fea28e
- [x] 1.6 `/` dla zalogowanego → `/decks`; gość → landing — 2fea28e
- [x] 1.7 „Generuj"/„Nauka" wyłączone i nieklikalne; „Talie" aktywne — 2fea28e
- [x] 1.8 Modal otwiera/zamyka się `Esc` i kliknięciem w tło; fokus wraca — 2fea28e

### Phase 2: Lista + tworzenie + strona talii

#### Automated

- [x] 2.1 Typy tras zsynchronizowane: `npx astro sync`
- [x] 2.2 Linting przechodzi: `npm run lint`
- [x] 2.3 Build przechodzi: `npm run build`

#### Manual

- [x] 2.4 Nowy użytkownik widzi stan pusty z działającym CTA
- [x] 2.5 Utworzenie talii przez modal dodaje ją do listy
- [x] 2.6 Pusta nazwa / >100 znaków odrzucone z komunikatem PL; modal wraca otwarty
- [x] 2.7 Duplikat nazwy → „Talia o tej nazwie już istnieje"
- [x] 2.8 Klik talii → `/decks/[publicId]` stan pusty; obcy/nieistniejący `public_id` → 404
- [x] 2.9 Stan pending widoczny podczas zapisu

### Phase 3: Zmiana nazwy + usuwanie + weryfikacja

#### Automated

- [ ] 3.1 Typy tras zsynchronizowane: `npx astro sync`
- [ ] 3.2 Linting przechodzi: `npm run lint`
- [ ] 3.3 Build przechodzi: `npm run build`

#### Manual

- [ ] 3.4 Rename działa i widać na liście; kolizja nazwy → komunikat o duplikacie
- [ ] 3.5 Delete po potwierdzeniu znika z listy; anulowanie nic nie zmienia
- [ ] 3.6 Nawigacja i modale obsługiwalne klawiaturą; czytnik ogłasza etykiety
- [ ] 3.7 Udokumentowany dowód izolacji A/B (lista + URL) + pozytywna kontrola własnych
