# Izolacja danych per-konto (RLS) + rdzenne tabele — Implementation Plan

## Overview

Zbudowanie warstwy danych 10xCards od zera: rdzenne tabele **Deck** i **Flashcard** plus
słownik stanów **flashcard_state**, z twardą izolacją per-konto egzekwowaną przez Supabase
Row-Level Security (RLS). To fundament (F-01) — każdy kolejny slice (S-01 talie, S-02 karty,
S-03 nauka, S-04 generacja) dziedziczy granicę „żaden użytkownik nie widzi cudzych danych".
Zakres świadomie minimalny: tylko to, czego potrzebują S-01/S-02; GenerationSession i pola
harmonogramu SRS dochodzą progresywnie w S-04/S-03.

## Current State Analysis

- **Warstwa danych: pusta.** `supabase/migrations/` jeszcze nie istnieje, zero tabel
  aplikacyjnych, README potwierdza „tylko `auth.users`". `supabase/config.toml` gotowy
  (`[db.migrations] enabled = true`, Postgres `major_version = 17`).
- **Auth: w pełni podpięte.** `createClient(headers, cookies)` w `src/lib/supabase.ts`
  (@src/lib/supabase.ts) zwraca per-request klient SSR (`@supabase/ssr`) niosący sesję
  użytkownika przez cookies i klucz **anon**. To jest krytyczne dla RLS: zapytania idą jako
  zalogowany użytkownik, więc `auth.uid()` w politykach zadziała. Middleware
  (@src/middleware.ts) ustawia `locals.user`.
- **Tooling DB.** `supabase` CLI jest devDependency (`supabase@^2.23.4`). Brak generowania
  typów, brak Drizzle — dostęp przez klient Supabase JS + ręcznie pisane migracje SQL.
- **Testy: brak runnera** (baseline). Automatyczny test cross-account należy do F-03
  (`verification-harness`, po S-01) — F-01 weryfikuje izolację ręcznie.

## Desired End State

Po ukończeniu planu lokalna i produkcyjna baza mają trzy tabele (`deck`, `flashcard`,
`flashcard_state`) z włączonym RLS, tak że:

- zalogowany użytkownik może wykonać CRUD wyłącznie na własnych taliach i kartach;
- zapytanie bez sesji (`anon`) nie widzi żadnych danych aplikacyjnych;
- wewnętrzne bigint ID nigdy nie muszą wyciekać na front — istnieje `public_id uuid` jako
  publiczny uchwyt;
- repo zawiera wygenerowany, typowany `src/db/database.types.ts` i skrypt `db:types`;
- w folderze zmiany jest udokumentowany dowód, że użytkownik A nie widzi danych użytkownika B.

Weryfikacja: `npx supabase db reset` stosuje migrację czysto; `npm run db:types` generuje typy;
`npm run lint` + `npm run build` przechodzą; ręczna procedura dwóch kont potwierdza izolację.

### Key Discoveries:

- SSR klient z `@supabase/ssr` (@src/lib/supabase.ts) używa klucza `anon` i niesie JWT
  użytkownika — RLS `auth.uid()` działa out-of-the-box, o ile **nigdy** nie wprowadzimy
  klienta z kluczem service-role po stronie ścieżek użytkownika.
- `auth.users.id` jest typu **uuid** → `deck.user_id` musi być uuid FK, mimo że własne PK
  encji są bigint.
- Brak runnera testów w baseline → weryfikacja izolacji w F-01 jest ręczna i udokumentowana;
  automatyzacja to F-03.

## What We're NOT Doing

- **Brak tabeli GenerationSession** i pól powiązania generacji — dochodzą w S-04.
- **Brak pól harmonogramu SRS** (due/interwał/ease) — dochodzą w S-03 po decyzji F-02.
- **Brak kolumny `source`** (manual/ai) — odroczona do S-04 (w S-01/S-02 wszystkie karty są
  ręczne; dodanie kolumny z domyślną `manual` później jest trywialne).
- **Brak „kosza" / miękkiego usuwania** (`trashed_at`) w tej zmianie — odroczone; zapisane
  jako osobne follow-up story (patrz `## Follow-up Work`). F-01 ma tylko twarde `ON DELETE
  CASCADE`.
- **Brak UI/endpointów** — to schemat + RLS + typy. Pierwsza realna funkcja to S-01.
- **Brak automatycznego testu izolacji w CI** — należy do F-03.
- **Brak per-user ustawień** (np. auto-czyszczenie kosza po X dniach) — pomysł na przyszłość,
  poza MVP.

## Implementation Approach

Jedna migracja SQL (`supabase migration new init_core_schema`) budowana w dwóch krokach
merytorycznych (Faza 1 schemat, Faza 2 RLS zapisywane do tego samego pliku), a następnie
zastosowana i zweryfikowana (Faza 3). Konwencja identyfikatorów: bigint IDENTITY od 100000
dla danych dynamicznych (deck, flashcard), wartości <100000 zarezerwowane na numerację
wewnętrzną (słownik `flashcard_state`: 1/2/3). Publiczny uchwyt to `public_id uuid`. RLS jest
sercem zmiany: `deck` filtrowane po `auth.uid()`, `flashcard` przez przynależność do własnej
talii (join).

## Critical Implementation Details

- **Kontrakt „ukryte ID".** Wewnętrzne bigint `id` (deck, flashcard) oraz `state_id` /
  `flashcard_state.id` są danymi wyłącznie serwerowymi. Każdy przyszły endpoint/UI adresuje
  rekordy przez `public_id` (uuid) i eksponuje stan jako `code` ('accepted'), nigdy jako
  liczbowy `id`. Ten kontrakt ustala F-01; egzekwują go warstwy API od S-01 wzwyż.
- **Klucz anon, nie service-role.** RLS chroni tylko dopóki zapytania idą jako zalogowany
  użytkownik. Nie wolno wprowadzać klienta z service-role dla ścieżek użytkownika — obszedłby
  RLS i złamał guardrail izolacji.
- **`state_id` NOT NULL bez DEFAULT.** Stan jest ustawiany jawnie przy insert (S-02 → 'accepted',
  S-04 → 'generated'). Brak defaultu celowo zapobiega cichemu zapisaniu kandydata jako
  zaakceptowanego (i odwrotnie).
- **Kolejność:** tabele muszą powstać przed politykami RLS i przed generacją typów; typy
  generują się z zastosowanej lokalnej bazy (`--local`).

## Phase 1: Schemat rdzenny (migracja SQL)

### Overview

Utworzenie pliku migracji i zdefiniowanie w nim rozszerzeń, słownika stanów z seedem oraz
tabel `deck` i `flashcard` wraz z kluczami, ograniczeniami, indeksami i triggerami
`updated_at`. Bez RLS (dochodzi w Fazie 2).

### Changes Required:

#### 1. Plik migracji

**File**: `supabase/migrations/<timestamp>_init_core_schema.sql` (utworzony przez
`npx supabase migration new init_core_schema`)

**Intent**: Jeden atomowy plik opisujący cały rdzenny schemat F-01. W tej fazie wypełniamy
sekcję schematu; polityki RLS dopisujemy w Fazie 2 do tego samego pliku.

**Contract**: Włącz rozszerzenie `moddatetime` (schema `extensions`). Zdefiniuj:

- `flashcard_state`: `id smallint PRIMARY KEY`, `code text NOT NULL UNIQUE`
  (`CHECK (code IN ('generated','accepted','rejected'))`). Seed jawnymi ID:
  `(1,'generated'), (2,'accepted'), (3,'rejected')` — zakres <100000 (numeracja wewnętrzna).
- `deck`: `id bigint GENERATED ALWAYS AS IDENTITY (START WITH 100000) PRIMARY KEY`,
  `public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE`,
  `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`,
  `name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100)`,
  `created_at timestamptz NOT NULL DEFAULT now()`,
  `updated_at timestamptz NOT NULL DEFAULT now()`,
  `CONSTRAINT deck_user_name_unique UNIQUE (user_id, name)`.
- `flashcard`: `id bigint GENERATED ALWAYS AS IDENTITY (START WITH 100000) PRIMARY KEY`,
  `public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE`,
  `deck_id bigint NOT NULL REFERENCES deck(id) ON DELETE CASCADE`,
  `state_id smallint NOT NULL REFERENCES flashcard_state(id)`,
  `front text NOT NULL CHECK (char_length(front) > 0)`,
  `back text NOT NULL CHECK (char_length(back) > 0)`,
  `created_at timestamptz NOT NULL DEFAULT now()`,
  `updated_at timestamptz NOT NULL DEFAULT now()`.
- Indeksy: `deck(user_id)`; `flashcard(deck_id)`; `flashcard(state_id)`.
- Triggery `moddatetime(updated_at)` BEFORE UPDATE na `deck` i `flashcard`.

Snippet klucza (identity + zakres — nieoczywisty kontrakt, od którego zależy konwencja ID):

```sql
create table deck (
  id         bigint generated always as identity (start with 100000) primary key,
  public_id  uuid   not null default gen_random_uuid() unique,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  name       text   not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deck_user_name_unique unique (user_id, name)
);
```

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się czysto: `npx supabase db reset`
- Tabele istnieją i identity startuje od 100000 (nowy `deck`/`flashcard` dostaje `id >= 100000`)
- Seed `flashcard_state` obecny: `SELECT id, code FROM flashcard_state ORDER BY id` zwraca 1/2/3
- Lint/typy przechodzą: `npm run lint`

#### Manual Verification:

- Insert dwóch talii o tej samej nazwie dla jednego `user_id` jest odrzucany (unikalność)
- Insert karty z pustym `front`/`back` jest odrzucany (CHECK)
- `UPDATE` talii podbija `updated_at` (trigger)

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się na
ręczne potwierdzenie przez człowieka, zanim przejdziesz do Fazy 2.

---

## Phase 2: Polityki RLS + grants

### Overview

Dopisanie do migracji włączenia RLS (deny-by-default) i polityk egzekwujących izolację:
`deck` po `auth.uid()`, `flashcard` przez przynależność do własnej talii, `flashcard_state`
jako read-only dane referencyjne. Ustawienie grantów: pełny CRUD dla roli `authenticated`,
brak dostępu dla `anon`.

### Changes Required:

#### 1. Sekcja RLS w migracji

**File**: `supabase/migrations/<timestamp>_init_core_schema.sql` (ten sam plik, dopisane niżej)

**Intent**: Uczynić izolację per-konto twardą na poziomie bazy — niezależną od poprawności
kodu aplikacji. Deny-by-default: włączony RLS bez polityki = zero dostępu.

**Contract**:

- `ALTER TABLE deck ENABLE ROW LEVEL SECURITY;` (analogicznie `flashcard`, `flashcard_state`).
- Granty: `REVOKE ALL ... FROM anon;` na trzech tabelach; `GRANT SELECT, INSERT, UPDATE,
  DELETE ON deck, flashcard TO authenticated;` `GRANT SELECT ON flashcard_state TO
  authenticated;` (użycie sekwencji identity nie wymaga osobnego granta).
- `deck` — polityki dla roli `authenticated`:
  - SELECT/UPDATE/DELETE: `USING (user_id = (select auth.uid()))`
  - INSERT: `WITH CHECK (user_id = (select auth.uid()))`; UPDATE dodatkowo `WITH CHECK (user_id =
    (select auth.uid()))`.
- `flashcard` — polityki przez join z własną talią:
  - SELECT/UPDATE/DELETE: `USING (EXISTS (SELECT 1 FROM deck d WHERE d.id =
    flashcard.deck_id AND d.user_id = (select auth.uid())))`
  - INSERT/UPDATE: `WITH CHECK (...)` tym samym predykatem — blokuje wstawienie/przeniesienie
    karty do cudzej talii.
- `flashcard_state` — polityka SELECT dla `authenticated` `USING (true)` (dane referencyjne;
  brak polityk zapisu = brak zapisu).

Snippet polityki flashcard (nieoczywisty predykat join — od niego zależy cała izolacja kart):

```sql
create policy flashcard_select on flashcard for select to authenticated
  using (exists (select 1 from deck d
                 where d.id = flashcard.deck_id and d.user_id = (select auth.uid())));
```

### Success Criteria:

#### Automated Verification:

- Migracja z politykami stosuje się czysto: `npx supabase db reset`
- RLS włączony na wszystkich trzech tabelach: `pg_class.relrowsecurity = true`
- Rola `anon` nie ma dostępu do `deck`/`flashcard` (SELECT jako anon zwraca 0 wierszy /
  permission denied)
- Lint przechodzi: `npm run lint`

#### Manual Verification:

- Jako użytkownik A (ustawiony `request.jwt.claims` / `auth.uid()`), SELECT na `deck` zwraca
  tylko talie A
- Próba wstawienia karty do talii należącej do B jest odrzucona przez `WITH CHECK`
- `flashcard_state` jest czytelny dla zalogowanego, ale niezapisywalny

**Implementation Note**: Po tej fazie i weryfikacji automatycznej zatrzymaj się na ręczne
potwierdzenie przed Fazą 3.

---

## Phase 3: Zastosowanie + typy + weryfikacja izolacji

### Overview

Zastosowanie migracji lokalnie, wygenerowanie typowanego klienta DB, otypowanie
`createClient` oraz wykonanie i udokumentowanie ręcznego testu izolacji dwóch kont — dowód
guardrailu, który F-03 później zautomatyzuje.

### Changes Required:

#### 1. Skrypt generacji typów

**File**: `package.json`

**Intent**: Powtarzalna generacja typów DB po każdej migracji, spójna z bramkami
agent-friendly (AGENTS.md).

**Contract**: Dodaj skrypt `"db:types": "supabase gen types typescript --local >
src/db/database.types.ts"`.

#### 2. Wygenerowane typy

**File**: `src/db/database.types.ts` (nowy, generowany)

**Intent**: Źródło prawdy o kształcie schematu dla warstwy aplikacji.

**Contract**: Wygenerowany przez `npm run db:types`; zawiera typy `deck`, `flashcard`,
`flashcard_state`. Plik commitowany.

#### 2b. Wyłączenie generowanego pliku z lintu

**File**: `eslint.config.js` (@eslint.config.js)

**Intent**: Kryteria „lint przechodzi" (1.4 / 2.4 / 3.2) nie mogą wywracać się na artefakcie
generowanym, którego nie chcemy ręcznie poprawiać. `eslint.config.js` używa `strictTypeChecked`
+ `stylisticTypeChecked` z `projectService: true`, a `tsconfig` ma `include: ["**/*"]` — bez
wpisu ignore generowany `src/db/database.types.ts` jest lintowany (i **nie** jest w `.gitignore`,
więc `includeIgnoreFile` go nie pomija).

**Contract**: Dodaj do tablicy konfiguracji osobny blok `{ ignores: ["src/db/database.types.ts"] }`,
tak by generowany plik był wyłączony z reguł ESLint. (Jeśli po generacji plik lintuje się czysto,
krok jest nieszkodliwy; jeśli nie — zapobiega fałszywej porażce kryterium „lint".)

#### 3. Otypowanie klienta Supabase

**File**: `src/lib/supabase.ts` (@src/lib/supabase.ts)

**Intent**: Dać S-01/S-02 od razu typowany klient, by błędy kształtu danych łapały się przy
kompilacji.

**Contract**: Import `Database` z `@/db/database.types` i sparametryzowanie
`createServerClient<Database>(...)`. Zachowaj istniejący null-check (`SUPABASE_URL`/`KEY`).

#### 4. Procedura i dowód izolacji

**File**: `context/changes/per-user-data-isolation/rls-verification.md` (nowy)

**Intent**: Udokumentować powtarzalną procedurę dwóch kont i zapisać wynik jako dowód, że A
nie widzi danych B (zanim F-03 to zautomatyzuje).

**Contract**: Kroki (utwórz 2 użytkowników w lokalnym Auth, po talii i karcie każdemu,
ustaw `auth.uid()` kontekstu i sprawdź widoczność krzyżową) + zapisany wynik obserwacji.

Impersonacja użytkownika w psql musi ustawić **rolę i claims JWT** — sam `SET ROLE` nie
wystarcza, bo `auth.uid()` czyta `sub` z `request.jwt.claims`. Wymagany **positive control**:
najpierw potwierdź, że A widzi WŁASNE dane (inaczej zero-wynik jest bezwartościowy — patrz
niżej), dopiero potem że nie widzi danych B.

```sql
-- Kontekst użytkownika A (transakcja: SET LOCAL ważne i samoczyszczące)
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<UUID_A>","role":"authenticated"}';

select count(*) from deck;   -- POSITIVE CONTROL: musi być > 0 (talie A widoczne)
select * from deck;          -- oczekiwane: wyłącznie talie A, zero talii B
select * from flashcard;     -- oczekiwane: wyłącznie karty A
rollback;                    -- czyści rolę i claims; powtórz analogicznie dla B
```

**Pułapka fałszywego PASS (do udokumentowania w pliku):** jeśli pominiesz
`set request.jwt.claims`, `auth.uid()` = NULL i każda polityka odrzuca wszystko — A zobaczy 0
wierszy B, ale też 0 własnych. Zero-wynik bez zdanego positive control NIE jest dowodem
izolacji. Dowód jest ważny tylko gdy `count(*) > 0` dla danych własnych A i jednocześnie 0 dla
danych B.

### Success Criteria:

#### Automated Verification:

- `npm run db:types` generuje bez błędu; `src/db/database.types.ts` istnieje i zawiera
  `deck`/`flashcard`/`flashcard_state`
- Typy się kompilują: `npm run lint`
- Build przechodzi: `npm run build`
- `npx astro check` bez błędu — realny typecheck (łapie błędne otypowanie
  `createServerClient<Database>`, którego eslint ani `astro build` nie wymuszają).
  `astro check` wymaga devDependencies `@astrojs/check` + `typescript`; jeśli ich brak,
  krok najpierw je instaluje (`npm i -D @astrojs/check typescript`), by kryterium wywalało się
  na realnych typach, a nie na „command not found".

#### Manual Verification:

- Wykonana procedura z `rls-verification.md`: użytkownik A nie widzi talii ani kart B (SELECT
  zwraca 0), i odwrotnie — dowód zapisany w pliku
- Odczyt danych przez API/klient zwraca `public_id`, nie bigint `id` (kontrakt „ukryte ID"
  potwierdzony na przykładzie)
- `anon` (bez sesji) nie widzi żadnych danych aplikacyjnych

**Implementation Note**: Po tej fazie zatrzymaj się na ręczne potwierdzenie, że dowód
izolacji został zapisany, zanim zamkniesz zmianę.

---

## Testing Strategy

### Unit Tests:

- Brak (brak runnera w baseline; F-03 wprowadza harness). Weryfikacja F-01 opiera się na
  asercjach SQL i ręcznej procedurze izolacji.

### Integration Tests:

- Ręczny test cross-account (dwa konta) udokumentowany w `rls-verification.md`. Automatyczny
  odpowiednik powstaje w F-03 na realnej zdolności z S-01.

### Manual Testing Steps:

1. `npx supabase db reset` — migracja stosuje się czysto.
2. Utwórz 2 użytkowników w lokalnym Auth (Studio `http://localhost:54323`).
3. Każdemu utwórz talię + kartę; ustaw kontekst A w transakcji `begin; set local role
   authenticated; set local request.jwt.claims ...` (patrz Faza 3, snippet). Positive control:
   `count(*) > 0` dla danych własnych A, następnie potwierdź, że SELECT na `deck`/`flashcard`
   zwraca tylko dane A (zero danych B); zamknij `rollback` (czyści rolę i claims) i powtórz dla B.
4. Spróbuj wstawić kartę do cudzej talii — odrzucone przez `WITH CHECK`.
5. Sprawdź, że `anon` nie widzi nic.

## Performance Considerations

- Polityka `flashcard` używa podzapytania `EXISTS` po `deck_id` — indeks `flashcard(deck_id)`
  i PK `deck(id)` czynią to tanim. Dla MVP (małe talie per user) narzut pomijalny.
- Polityki używają `(select auth.uid())` — Postgres wylicza je jako initPlan raz na zapytanie,
  nie per-wiersz (zalecenie Supabase dot. wydajności RLS).

## Migration Notes

- To pierwsza migracja projektu — tworzy `supabase/migrations/`. Produkcyjnie stosowana przez
  `supabase db push` (lub pipeline deployu); sekrety/URL bazy niezależne od tej zmiany.
- Brak istniejących danych do migrowania (warstwa danych była pusta).

## Follow-up Work

- **Kosz / miękkie usuwanie talii i fiszek** (odroczone z tej zmiany): wprowadzić `trashed_at
  timestamptz` na `deck` i `flashcard`, przenoszenie do kosza zamiast natychmiastowego DELETE,
  „usuń na zawsze" z kosza, potwierdzenie w UI, oraz dostosować indeks unikalności nazwy do
  `WHERE trashed_at IS NULL` i wszystkie odczyty do filtrowania kosza. Pomysł rozszerzenia:
  per-user ustawienie „auto-czyszczenie kosza po X dniach". → Zapisać jako osobne story
  (proponowany change-id: `deck-flashcard-trash`).

## References

- Roadmap: `context/foundation/roadmap.md` (F-01)
- PRD: `context/foundation/prd.md` (Access Control, Guardrails, NFR: prywatność)
- Jira: C10X-1
- Wzorzec klienta SSR: `src/lib/supabase.ts`, `src/middleware.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schemat rdzenny (migracja SQL)

#### Automated

- [x] 1.1 Migracja stosuje się czysto: `npx supabase db reset` — 134a4b8
- [x] 1.2 Tabele istnieją, identity startuje od 100000 — 134a4b8
- [x] 1.3 Seed `flashcard_state` zwraca 1/2/3 — 134a4b8
- [x] 1.4 Lint/typy przechodzą: `npm run lint` — 134a4b8

#### Manual

- [x] 1.5 Duplikat nazwy talii dla jednego usera odrzucony (unikalność) — 134a4b8
- [x] 1.6 Pusty `front`/`back` odrzucony (CHECK) — 134a4b8
- [x] 1.7 `UPDATE` talii podbija `updated_at` (trigger) — 134a4b8

### Phase 2: Polityki RLS + grants

#### Automated

- [x] 2.1 Migracja z politykami stosuje się czysto: `npx supabase db reset` — 2b8abc7
- [x] 2.2 RLS włączony na 3 tabelach (`relrowsecurity = true`) — 2b8abc7
- [x] 2.3 `anon` bez dostępu do `deck`/`flashcard` — 2b8abc7
- [x] 2.4 Lint przechodzi: `npm run lint` — 2b8abc7

#### Manual

- [x] 2.5 Użytkownik A widzi tylko talie A (SELECT) — 2b8abc7
- [x] 2.6 Wstawienie karty do cudzej talii odrzucone przez `WITH CHECK` — 2b8abc7
- [x] 2.7 `flashcard_state` czytelny, niezapisywalny — 2b8abc7

### Phase 3: Zastosowanie + typy + weryfikacja izolacji

#### Automated

- [x] 3.1 `npm run db:types` generuje `src/db/database.types.ts` z 3 tabelami — c36b49c
- [x] 3.2 Typy kompilują się: `npm run lint` — c36b49c
- [x] 3.3 Build przechodzi: `npm run build` — c36b49c
- [x] 3.4 `npx astro check` bez błędu (realny typecheck generyka `<Database>`) — c36b49c

#### Manual

- [x] 3.5 Dowód izolacji zapisany w `rls-verification.md` (A nie widzi danych B) — c36b49c
- [x] 3.6 Odczyt zwraca `public_id`, nie bigint `id` (kontrakt „ukryte ID") — c36b49c
- [x] 3.7 `anon` nie widzi żadnych danych aplikacyjnych — c36b49c
