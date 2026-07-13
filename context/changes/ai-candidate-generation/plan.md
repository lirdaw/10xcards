# Generacja kandydatów fiszek AI z wklejonego tekstu — Implementation Plan

## Overview

Nowy pionowy slice „Generuj fiszki" (C10X-7 / S-04). Użytkownik wkleja tekst
źródłowy (≤ 10 000 znaków), wybiera talię docelową, język i liczbę kart, po czym
wyspa React wysyła `fetch` do pierwszego w projekcie endpointu JSON `/api/generate`.
Serwer woła OpenRouter (structured JSON output, pojedynczy call), waliduje kandydatów (Zod)
i pomija wadliwe (fallback, bez re-calla), zapisuje `generation_session` (z pełnym audytem request/response)
oraz karty ze stanem `generated` i źródłem `ai`, powiązane z sesją. Generator pokazuje
read-only listę wyników. Obsługa błędu/timeoutu + „Ponów" (FR-018) oraz widoczny postęp
(~200 ms ack / spinner > 2 s) są twardym kryterium „done". Osobno lista kart w widoku talii
domyślnie filtruje do stanu `accepted`, żeby kandydaci `generated` nie wyciekali do listy.

## Current State Analysis

- **Schemat** (`supabase/migrations/20260705180246_init_core_schema.sql`,
  `20260710195327_manual_card_source.sql`): tabele słownikowe `flashcard_state`
  (1=generated, 2=accepted, 3=rejected) i `flashcard_source` (1=manual, 2=ai) — kody
  `'generated'` i `'ai'` już czekają na ten slice. `flashcard` (`deck_id`, `state_id`,
  `front`, `back`, `source_id`) **nie ma `user_id`** — własność przez `deck.user_id` + RLS
  `EXISTS`-join. `flashcard.deck_id` jest `NOT NULL` ⇒ kandydaci muszą trafić do talii.
  **Tabela `generation_session` nie istnieje.**
- **Warstwa danych** (`src/lib/decks.ts`, `src/lib/flashcards.ts`): płaskie helpery
  biorące klient SSR i zwracające surowe `{ data, error }`; mapowanie błędów na polski
  zostaje w endpoincie. Stałe pinowane: `STATE_ACCEPTED=2`, `SOURCE_MANUAL=1`,
  `FRONT_MAX=200`, `BACK_MAX=1000` (`src/lib/flashcards.ts:42-49`). `listFlashcards`
  (`:59-65`) **nie filtruje po stanie**.
- **Endpointy** (`src/pages/api/**`): wszystkie to natywny form POST + `redirect(?error=)`.
  **Brak endpointu JSON, brak async/streaming, brak Zod.** Ten slice wprowadza pierwszy
  endpoint JSON — świadome odejście od konwencji.
- **Env** (`astro.config.mjs:17-22`): `SUPABASE_URL`/`SUPABASE_KEY` przez `astro:env/server`,
  null-check w `src/lib/supabase.ts:7-9`; status w `src/lib/config-status.ts`. Brak
  jakiejkolwiek integracji AI/LLM w kodzie.
- **Nav** (`src/components/Sidebar.astro:18-25`): „Generuj fiszki" istnieje jako
  **wyłączony** (`href:null, enabled:false`); `activeItem` już dopuszcza `"generate"`.
- **Brak** helpera fetch/timeout/retry w `src/lib`.
- **Workers** (`context/foundation/infrastructure.md`): 10 ms CPU (free), limit
  50 subrequestów/request, częściowy `nodejs_compat`. **Uwaga na ramowanie**: 10 ms CPU
  NIE obejmuje oczekiwania na `fetch` (I/O) — długi call OpenRouter nie zjada budżetu CPU;
  ryzyko długiej generacji to wall-clock/duration + kliencki timeout (FR-018). Limit CPU
  bije realnie w parsowanie JSON-a i serializację dużych `request/response_payload` (jsonb)
  — to trzymać lekko. Realny call trzeba smoke-testować na deployed preview, nie tylko
  w `astro dev`.

## Desired End State

Zalogowany użytkownik wchodzi w „Generuj fiszki", wybiera talię (lub tworzy nową na
miejscu), język i liczbę kart, wkleja tekst i klika „Generuj". Widzi natychmiastowe
potwierdzenie i postęp; po zakończeniu — read-only listę wygenerowanych kart z
informacją „zapisano N / pominięto M". Karty są w bazie ze stanem `generated`, źródłem
`ai`, powiązane z rekordem `generation_session` zawierającym audyt (model, język, tekst,
surowy request/response, liczniki, status). Przy błędzie/timeoucie widzi jasny komunikat
i przycisk „Ponów". W widoku talii kandydaci nie mieszają się z kartami `accepted` —
domyślnie widać tylko `accepted` (domyślny filtr w warstwie danych, bez UI). Świadome
oglądanie `generated`/`rejected` (przełącznik stanów) jest odłożone do S-05 (candidate-review).

Weryfikacja: manualny przepływ end-to-end lokalnie (z kluczem i z mockiem bez klucza),
smoke-test realnej generacji na deployed preview, `npm run lint` + `npm run build` czyste.

### Key Discoveries:

- `flashcard.state_id`/`source_id` są `NOT NULL` bez DEFAULT — insert MUSI podać `1`
  (generated) i `2` (ai) (`init:21-23`).
- RLS `flashcard_insert` wymaga, by `deck_id` należał do `auth.uid()` — insert idzie
  klientem SSR zalogowanego usera; migracja jawnie zakazuje service-role dla ścieżek
  użytkownika (`init:88-89`).
- OpenRouter REST: `POST https://openrouter.ai/api/v1/chat/completions`, nagłówek
  `Authorization: Bearer <key>`, `response_format: { type:'json_schema', json_schema:{ name, strict:true, schema } }`;
  wynik w `choices[0].message.content` jako string JSON. Structured outputs zależą od
  modelu — domyślny model musi je wspierać.
- `listFlashcards` nie filtruje po stanie — bez zmiany kandydaci `generated` wyciekną do
  widoku talii z manual-card-crud.

## What We're NOT Doing

- **Recenzja kandydatów (accept/edit/reject, bulk)** — to S-05 (candidate-review). Tu tylko
  zapis `generated` + read-only lista.
- **Pełny filtr FR-014** (zakres dat, kombinacje) — tu tylko minimalny przełącznik stanu.
- **Wyszukiwanie** (S-06), **SRS/nauka** (S-03).
- **Streaming tokenów, joby w tle/polling** — architektura sync (jedno żądanie).
- **Streaming/SDK OpenRouter** — używamy czystego `fetch` (omija bundle 3 MB i ryzyko
  `nodejs_compat`).
- **Import plików** (non-goal PRD), edycja kart w tym widoku, service-role client.
- **Rate-limiting / throttling per user na `/api/generate`** — świadomie odłożone na MVP.
  Endpoint woła płatny OpenRouter dla każdego zalogowanego bez limitu żądań; klient blokuje
  przycisk w stanie `pending` (anty-dubel), ale serwer jest nieosłonięty. „Ponów" (FR-018)
  i wyścig timeoutu mogą zwielokrotnić calle. Chroni to jedynie budżet $5 (`infrastructure.md`);
  właściwy dławik dokładamy, gdy pojawi się realny ruch — nie w tym slice.
- **Korygujący re-call (1-shot correction)** — świadomie odłożony. MVP robi pojedynczy bazowy
  call; wadliwe karty pomijamy (fallback). Jeśli obserwowany skip-rate okaże się wysoki,
  1-shot korektę wracamy jako dźwignię jakości (pod metrykę 75% akceptacji) w rewizji.
- **Framework testów automatycznych** — weryfikacja manualna + smoke-test (Moduł 3).
- **Wyrównanie filtra stanu w wyszukiwaniu (styk z S-06)** — RPC `searchFlashcards`
  z S-06 (deck-keyword-search) zwraca karty we WSZYSTKICH stanach, więc po zmerdżowaniu
  obu slice'ów wyszukiwanie mogłoby pokazać kandydatów `generated`, mimo że domyślna
  lista talii ich chowa (Faza 5). Domknięcie tej niespójności (filtr stanu również
  w wyszukiwaniu) jest świadomie odłożone do S-05 (candidate-review). **Nie implementować
  tutaj i nie dotykać plików S-06.**

## Implementation Approach

Budujemy od dołu: migracja + warstwa danych (Faza 1) → klient LLM + env + Zod (Faza 2) →
endpoint JSON (Faza 3) → strona + wyspa + nav (Faza 4) → przełącznik stanów w widoku talii
(Faza 5). Każda faza jest testowalna osobno. Konwencje mirrorujemy z `decks.ts`/`flashcards.ts`
(surowe `{data,error}`, mapowanie błędów w endpoincie) i z `supabase.ts` (null-check env).

## Critical Implementation Details

- **Kolejność liczników sesji vs karty**: `generation_session` zapisujemy zawsze, gdy
  doszło do wywołania OpenRouter (sukces i błąd) — by uchwycić audyt i `error_message`.
  Karty (`generation_id` = id sesji) wstawiamy tylko przy sukcesie. Sesja jest rodzicem;
  wstaw sesję → pobierz jej `id` → wstaw karty. `flashcard.generation_id` jest
  `ON DELETE SET NULL`, żeby kasowanie sesji nie kasowało kart.
- **Limit subrequestów Workers (50/req)**: jedno żądanie robi auth + kilka zapytań Supabase
  + 1 call OpenRouter (pojedynczy bazowy). Wadliwe/za długie karty pomijamy (fallback),
  bez drugiego calla — nie pętlić.
- **Timeout**: `AbortController` + `setTimeout` (NIE `AbortSignal.timeout`, którego
  `nodejs_compat` może nie pokrywać) po stronie serwera dla calla OpenRouter, oraz osobny
  po stronie klienta (~45–60 s) na całe `fetch`. Różnicę edge vs `astro dev` weryfikować na
  preview. **Serwerowy timeout OpenRouter musi być wyraźnie krótszy od klienckiego**
  (np. serwer ~40 s, klient ~55 s), żeby serwer prawie zawsze odpowiedział pierwszy —
  inaczej klient abortuje, a serwer w tle zdąży zapisać sesję `succeeded` + karty:
  użytkownik widzi „timeout + Ponów", a „Ponów" dołoży drugi komplet → duplikaty. Karty
  osieroconej sesji lądują pod stanem `generated` (nie `accepted`), więc nie zanieczyszczają
  nauki — świadomie to akceptujemy, ale mismatch liczników jest znany.
- **`nodejs_compat` gap**: realny call generacji smoke-testować na deployed preview przed
  uznaniem fazy 3 za gotową (ryzyko z `infrastructure.md`).

## Phase 1: Schemat + warstwa danych

### Overview

Migracja tworząca `generation_session` (z audytem + RLS wzorowaną na `deck`) i dokładająca
`flashcard.generation_id`. Regeneracja typów DB. Nowy helper `src/lib/generations.ts`.

### Changes Required:

#### 1. Migracja SQL

**File**: `supabase/migrations/<timestamp>_generation_session.sql` (nowy; nagłówek wg
konwencji: Migration/Change/Jira C10X-7 + polskie komentarze)

**Intent**: Utrwalić sesję generacji jako rodzica kandydatów oraz link `flashcard → sesja`.

**Contract**:
- `generation_session`: `id bigint generated always as identity (start with 100000) primary key`,
  `public_id uuid not null default gen_random_uuid() unique`,
  `user_id uuid not null references auth.users(id) on delete cascade`,
  `source_text text not null check (char_length(source_text) > 0)`,
  `model text not null`, `language text not null`,
  `requested_count smallint not null`, `generated_count smallint not null`,
  `saved_count smallint not null`,
  `status text not null check (status in ('succeeded','failed'))`,
  `error_message text`, `request_payload jsonb`, `response_payload jsonb`,
  `created_at timestamptz not null default now()`.
- Index `generation_session_user_id_idx on (user_id)`.
- `alter table flashcard add column generation_id bigint references generation_session(id) on delete set null;`
  + index `flashcard_generation_id_idx`.
- RLS: `enable row level security`; polityki `select/insert/update/delete` dla `authenticated`
  z `user_id = (select auth.uid())` (dokładnie wzorzec `deck` z `init:109-120`); `revoke` dla
  `anon`, `grant` CRUD dla `authenticated`.
- `updated_at` NIE dodajemy (sesja jest niezmienna po zapisie) — brak triggera moddatetime.

#### 2. Regeneracja typów DB

**File**: `src/db/database.types.ts` (generowany)

**Intent**: Odświeżyć typy po migracji, by `generation_session` i `flashcard.generation_id`
były typowane.

**Contract**: uruchomić lokalny generator typów Supabase (patrz Success Criteria) i
`npx astro sync`. Po regeneracji `TablesInsert<'generation_session'>` istnieje, a
`flashcard` Row/Insert ma `generation_id: number | null`.

#### 3. Helper warstwy danych + stałe

**File**: `src/lib/generations.ts` (nowy; mirror `flashcards.ts`)

**Intent**: Zapis sesji i bulk-insert kandydatów, jako surowe `{data,error}`; mapowanie
błędów zostaje w endpoincie.

**Contract**:
- `export const STATE_GENERATED = 1;` i `export const SOURCE_AI = 2;` (pinowane, komentarz
  wskazuje migracje — wzór `flashcards.ts:39-43`).
- `createGenerationSession(supabase, row: TablesInsert<'generation_session'>)` → `insert(...).select('id, public_id').single()`.
- `insertCandidates(supabase, deckId: number, generationId: number, cards: {front,back}[])` →
  bulk `insert` z `state_id: STATE_GENERATED, source_id: SOURCE_AI, generation_id`.
- Istniejące `createFlashcard`/`listFlashcards` w `flashcards.ts` **nie ruszane w tej fazie**
  (filtr stanu dochodzi w Fazie 5).

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto: `npx supabase migration up` (lub `npx supabase db reset`).
- Typy regenerują się: `npx supabase gen types typescript --local > src/db/database.types.ts`
  a `git diff` pokazuje `generation_session` + `generation_id`.
- `npx astro sync` bez błędów.
- `npm run lint` przechodzi.

#### Manual Verification:

- W Supabase Studio: RLS na `generation_session` widoczne; insert cudzego `user_id`
  odrzucony, własnego przechodzi (kontrola pozytywna wg `lessons.md`: rola + JWT claims + RETURNING).
- `flashcard.generation_id` jest nullable i FK działa (kasowanie sesji zeruje link, nie kasuje kart).

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej — pauza na
potwierdzenie manualnej weryfikacji RLS zanim ruszysz Fazę 2.

---

## Phase 2: Klient LLM + env + Zod

### Overview

Deklaracja sekretów, klient OpenRouter na `fetch` z master promptem, structured output,
timeoutem i trybem mock, oraz walidacja Zod z fallbackiem (pomiń wadliwe, bez re-calla).

### Changes Required:

#### 1. Schemat env

**File**: `astro.config.mjs` (blok `env.schema`, `:17-22`)

**Intent**: Dodać sekret klucza i (opcjonalnie) nazwę modelu, wzorem Supabase.

**Contract**: `OPENROUTER_API_KEY: envField.string({ context:"server", access:"secret", optional:true })`
oraz `OPENROUTER_MODEL: envField.string({ context:"server", access:"secret", optional:true })`.
Dopisać `OPENROUTER_API_KEY`/`OPENROUTER_MODEL` do `.env` (lokalnie); prod przez
`wrangler secret put` (NIE tworzyć `.dev.vars` — `lessons.md`).

#### 2. Klient OpenRouter

**File**: `src/lib/openrouter.ts` (nowy)

**Intent**: Wywołać model przez REST, wymusić JSON kandydatów, obsłużyć brak klucza (mock)
i timeout; zwrócić surowy payload do audytu.

**Contract**:
- Import `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` z `astro:env/server`; jeśli klucz pusty →
  tryb **mock** (deterministyczne przykładowe karty), by dev bez klucza działał; null-check
  wzorem `supabase.ts:7-9`. `const model = OPENROUTER_MODEL ?? DEFAULT_MODEL` (domyślny
  model musi wspierać `structured_outputs`, np. `openai/gpt-4o-mini`; konfigurowalny).
- `generateCandidates({ sourceText, language, count, signal })` → `fetch` na
  `https://openrouter.ai/api/v1/chat/completions`, nagłówki `Authorization: Bearer`,
  `Content-Type: application/json`, `HTTP-Referer`/`X-Title` (nazwa appki; oba opcjonalne — atrybucja).
  Body: `model`, `messages` (system = master prompt, user = tekst), `max_tokens`, `temperature`,
  `response_format: { type:'json_schema', json_schema:{ name:'flashcards', strict:true, schema } }`.
- **Master prompt (system)** koduje twarde reguły: wygeneruj dokładnie `count` fiszek Q/A;
  `front` ≤ `FRONT_MAX` (200), `back` ≤ `BACK_MAX` (1000), oba niepuste; język = `language`
  (a dla `auto` — ten sam co tekst źródłowy); **sprawdź długości przed zwróceniem**; zwróć
  wyłącznie przez podany schemat JSON.
- Zwraca `{ cards, rawRequest, rawResponse }` (surowe do audytu sesji). Timeout: `AbortController`
  + `setTimeout` przekazany jako `signal` do `fetch` (nie `AbortSignal.timeout`).

#### 3. Walidacja Zod + fallback

**File**: `src/lib/openrouter.ts` (ta sama, warstwa walidacji) — dodać `zod` do zależności

**Intent**: Twardo zwalidować kształt/długości kart; wadliwe pominąć (bez re-calla).

**Contract**: dodać `zod` (`npm i zod`). Schemat `candidateSchema = z.object({ front: z.string().min(1).max(FRONT_MAX), back: z.string().min(1).max(BACK_MAX) })`.
Waliduj każdą kartę z pojedynczego bazowego calla; zachowaj poprawne, pomiń wadliwe i zwróć
`generatedCount` (liczba kart zwróconych przez model) oraz listę valid. Bez drugiego calla —
master prompt z self-checkiem długości ogranicza wadliwe u źródła (limit Workers).

**Definicja liczników:**
- `generated` = liczba kart zwróconych przez model w bazowym callu.
- `saved` = liczba kart, które przeszły walidację Zod (i zostaną zapisane).
- `skipped` = `generated − saved`.
Te trzy wartości są jedynym źródłem prawdy dla audytu sesji i komunikatu UI (Faza 3).

#### 4. Status konfiguracji

**File**: `src/lib/config-status.ts` (wzór `:11-19`)

**Intent**: Zgłaszać, czy OpenRouter jest skonfigurowany (spójnie z Supabase).

**Contract**: dodać wpis `openrouter` z `configured: Boolean(OPENROUTER_API_KEY)`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` i `npm run build` przechodzą (Zod dołączony, bundle się buduje).
- Import `astro:env/server` z nowymi zmiennymi typuje się (`npx astro sync`).

#### Manual Verification:

- Z kluczem w `.env`: wywołanie `generateCandidates` na krótkim tekście zwraca poprawne
  karty w wybranym języku, długości w limicie.
- Bez klucza: tryb mock zwraca przykładowe karty (dev działa offline).
- Podanie tekstu wymuszającego za długą/wadliwą kartę: karta pominięta (fallback), reszta
  zapisana; bez re-calla.

**Implementation Note**: Pauza na potwierdzenie manualne (z kluczem i mock) przed Fazą 3.

---

## Phase 3: Endpoint `/api/generate` (pierwszy endpoint JSON)

### Overview

Endpoint POST przyjmujący JSON, orkiestrujący: auth → walidacja wejścia → resolve/utworzenie
talii → LLM → walidacja Zod (pomiń wadliwe) → zapis sesji + kart → JSON.

### Changes Required:

#### 1. Endpoint generacji

**File**: `src/pages/api/generate.ts` (nowy)

**Intent**: Zamienić wklejony tekst na zapisanych kandydatów, zwracając JSON dla wyspy.

**Contract**:
- `export const POST: APIRoute`. Klient: `createClient(context.request.headers, context.cookies)`;
  null → `Response` JSON 500 „Supabase nie jest skonfigurowany". Auth: `context.locals.user`;
  brak → JSON 401.
- Parsuje `await request.json()`: `{ deckPublicId?: string, newDeckName?: string, sourceText: string, language: string, count: number }`.
  Walidacja (ręczna, jak w istniejących endpointach + Zod dla ciała): `sourceText` 1..10000,
  `count` w rozsądnym zakresie (np. 1..15), dokładnie jedno z `deckPublicId`/`newDeckName`.
- Talia: jeśli `newDeckName` → `createDeck` (mapa `23505` na „nazwa zajęta"); inaczej
  `deckIdByPublicId` (rozgałęzienie error vs null → JSON 404/500, wzór `flashcards.ts:51-57`).
  **Gałąź `newDeckName` potrzebuje id + public_id nowej talii** (bigint `id` do
  `insertCandidates`, `public_id` do pola `deckPublicId` w odpowiedzi). `createDeck`
  (`decks.ts:25`) dziś zwraca goły `insert(...)` bez `.select()` — rozszerzyć o
  `.select("id, public_id").single()` (wstecznie zgodne: jedyny caller
  `api/decks/index.ts:36` używa tylko `error`); mapę `23505` czytać z tego wyniku
  (RETURNING). Nie robić drugiego selecta po insercie — public_id jest DB-generowany,
  więc bez RETURNING trzeba by go i tak douzyskać.
- LLM: `generateCandidates(...)` z serwerowym `AbortController`; błąd/timeout OpenRouter →
  zapis sesji `status='failed'` + `error_message` + payloady, zwrot JSON error (kod pozwala
  wyspie pokazać „Ponów").
- Sukces: `createGenerationSession(...)` (source_text, model, language, requested/generated/saved
  counts, status='succeeded', request/response payload) → `insertCandidates(deckId, sessionId, cards)`.
- **Granica „0 zapisanych"**: gdy OpenRouter odpowiedział, ale `saved_count === 0`
  (żadna karta z bazowego calla nie przeszła walidacji Zod), traktuj to jako porażkę: sesja `status='failed'`
  + `error_message` („model nie zwrócił poprawnych kart"), payloady zapisane, zwrot JSON error
  z kodem pozwalającym wyspie pokazać „Ponów" (FR-018). Ścieżkę `succeeded` bierze tylko
  `saved_count > 0` (wtedy „zapisano N / pominięto M"). Nie insertuj kart, gdy lista pusta.
- Zwrot JSON: `{ candidates: {front,back}[], counts: {generated, saved, skipped}, deckPublicId, sessionPublicId }`.
  Liczniki wg definicji z Fazy 2 (`generated`/`saved`/`skipped = generated − saved`); te same
  wartości idą do `generation_session` (`generated_count`, `saved_count`; `skipped` wyliczany).
  Komunikat „zapisano N / pominięto M" mapuje **N = saved, M = skipped**.
  Nagłówek `Content-Type: application/json`. **Świadome odejście od form-redirect — udokumentuj w komentarzu.**

#### 2. Ochrona tras

**File**: `src/middleware.ts` (`PROTECTED_ROUTES`, `:4`)

**Intent**: Wpuszczać tylko zalogowanych na generator i endpoint.

**Contract**: dodać `"/generate"` i `"/api/generate"` do `PROTECTED_ROUTES`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` i `npm run build` przechodzą.
- `npx astro sync` czysty (nowa trasa).

#### Manual Verification:

- `curl`/klient POST z ważną sesją i istniejącą talią zwraca JSON z kandydatami; karty w DB
  mają `state_id=1, source_id=2, generation_id` ustawione; `generation_session` zapisana.
- `newDeckName` tworzy talię i zapisuje do niej kandydatów.
- Wymuszony błąd OpenRouter (zły klucz) → JSON error + sesja `failed` z `error_message`.
- Niezalogowany → 401; obcy `deckPublicId` (RLS) → 404, bez wycieku.
- **Smoke-test na deployed preview** (nie tylko `astro dev`) realnego calla — brak błędów
  `nodejs_compat`/CPU.

**Implementation Note**: Pauza na potwierdzenie manualne (w tym smoke-test na preview) przed Fazą 4.

---

## Phase 4: Strona generatora + wyspa React + nav

### Overview

Widoczny UI: strona ładująca talie, wyspa z formularzem, postępem, obsługą błędu/„Ponów" i
read-only listą wyników; włączenie pozycji nav.

### Changes Required:

#### 1. Strona generatora

**File**: `src/pages/generate.astro` (nowy; wzór `decks/index.astro`)

**Intent**: Załadować listę talii użytkownika (do selektora) i wyrenderować wyspę w
`AuthenticatedLayout` z `activeItem="generate"`.

**Contract**: frontmatter `createClient(Astro.request.headers, Astro.cookies)` + `listDecks`;
rozgałęzienie error vs pusto (`lessons.md`: SSR error-vs-empty); przekazać talie do wyspy
`<GeneratorForm client:load decks={...} />`. Brak top-level `return` we frontmatterze
(`lessons.md`) — guard robi middleware.

#### 2. Wyspa formularza

**File**: `src/components/generate/GeneratorForm.tsx` (nowy)

**Intent**: Zebrać wejście, wywołać `/api/generate` przez `fetch`, pokazać postęp/błąd/wyniki.

**Contract**:
- Pola: selektor talii (istniejące + opcja „Nowa talia" → inline pole nazwy); selektor języka
  (domyślnie „ten sam co tekst" = `auto`, plus jawne np. PL/EN/…); pole liczby kart (1..15);
  `<textarea>` z licznikiem znaków i twardym limitem 10 000; przycisk „Generuj".
- Submit: `e.preventDefault()`, `fetch('/api/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(...), signal })`
  z klienckim `AbortController` (~45–60 s). Stan `pending`: przycisk zablokowany (brak dubli),
  natychmiastowy ack (~200 ms) + spinner/etykieta „Generuję…" dla > 2 s (NFR).
- Błąd/timeout (`AbortError` lub JSON error): komunikat po polsku + przycisk **„Ponów"**
  (ponawia z tym samym wejściem) — FR-018.
- Sukces: **read-only** lista `candidates` (front/back) + podsumowanie „zapisano N / pominięto M";
  bez kontrolek accept/edit/reject (S-05).

#### 3. Włączenie nav

**File**: `src/components/Sidebar.astro` (`:18-25`)

**Intent**: Odblokować pozycję „Generuj fiszki".

**Contract**: zmienić na `href: "/generate", enabled: true`; `activeItem="generate"` już wspierane.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npm run build`, `npx astro sync` przechodzą.

#### Manual Verification:

- Pełny happy-path w UI: wklej tekst → wybór talii/języka/liczby → „Generuj" → widoczny
  postęp → lista wyników; karty w DB.
- Nowa talia z poziomu generatora działa; nazwa zajęta pokazuje błąd w formularzu (nie baner w tle — `lessons.md`).
- Odłączenie sieci / zły klucz → komunikat + „Ponów" ponawia; podwójny klik zablokowany.
- Nav „Generuj fiszki" jest aktywny i podświetlony; strona chroniona (wylogowany → `/auth/signin`).
- A11y: focus/label na polach, licznik znaków czytelny; keyboard-only przejście formularza.

**Implementation Note**: Pauza na potwierdzenie manualne przed Fazą 5.

---

## Phase 5: Domyślny filtr accepted w liście talii (bez UI)

### Overview

Anty-wyciek jednoplikowy: `listFlashcards` domyślnie filtruje `state_id = STATE_ACCEPTED`,
żeby kandydaci `generated`/`rejected` nie pojawiali się w liście kart talii. Bez UI, bez
przełącznika stanów, bez zmiany sygnatury. Świadome oglądanie kandydatów `generated`
(przełącznik / round-trip po `?state=`) należy do S-05 (candidate-review), nie do tego slice'a.

**Izolacja od S-06 (deck-keyword-search)**: ta faza celowo NIE dotyka loadera
`src/pages/decks/[publicId]/index.astro` ani toolbara
`src/components/flashcards/DeckContentToolbar.tsx` — oba pliki modyfikuje równolegle S-06
w osobnym worktree, więc punkty styku zostały usunięte, by uniknąć konfliktu przy merdżu.

### Changes Required:

#### 1. Domyślny filtr stanu w warstwie danych

**File**: `src/lib/flashcards.ts` (`listFlashcards`, `:59-65`)

**Intent**: Domyślnie pokazywać w liście talii tylko karty `accepted`, żeby kandydaci AI
(`generated`) i odrzuceni (`rejected`) nie wyciekali.

**Contract**: WEWNĄTRZ istniejącej `listFlashcards(supabase, deckId)` dołożyć do łańcucha
zapytania `.eq("state_id", STATE_ACCEPTED)` (stała już wyeksportowana, `:42`). **Sygnatura
bez zmian** — żadnego parametru `stateId`; loader wywołuje `listFlashcards` jak dotąd.
Brak regresji manual-card-crud: `createFlashcard` (`:70`) wstawia karty ręczne z
`state_id: STATE_ACCEPTED`, więc istniejące karty pozostają widoczne — filtr chowa wyłącznie
kandydatów AI.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npm run build`, `npx astro sync` przechodzą.

#### Manual Verification:

- Karty ręczne (`accepted`) nadal widoczne na domyślnej liście talii — brak regresji
  manual-card-crud.
- Po generacji: kandydaci `generated` (i `rejected`) NIE pojawiają się na domyślnej liście talii.

**Implementation Note**: Po tej fazie slice jest kompletny; zebrać wyniki do
`jira-finish-work` (RUN 1).

---

## Testing Strategy

### Unit Tests:

- Brak frameworka w projekcie (świadomie — Moduł 3). Logikę walidacji weryfikujemy
  manualnie przez tryb mock i przypadki brzegowe (za długa karta, pusta karta, zła liczba).

### Integration Tests:

- Manualny przepływ end-to-end (UI → endpoint → DB) w happy-path i ścieżce błędu.

### Manual Testing Steps:

1. Zaloguj się; wejdź „Generuj fiszki"; wklej ~2–3 akapity PL; talia istniejąca; „Generuj".
2. Zweryfikuj postęp (ack < ~200 ms, spinner przy > 2 s), listę wyników, karty w DB
   (`state_id=1, source_id=2, generation_id`), rekord `generation_session` (payloady, liczniki).
3. Powtórz z „Nowa talia" i z innym językiem (EN) — karty w wybranym języku.
4. Wymuś błąd (zły `OPENROUTER_API_KEY`) → komunikat + „Ponów"; sesja `failed`.
5. Tekst prowokujący za długie/wadliwe karty → pominięte (fallback), reszta zapisana; bez re-calla.
6. Widok talii: domyślnie `accepted` bez kandydatów; przełącz na `generated`.
7. **Smoke-test na deployed preview** realnego calla (edge/workerd) — brak błędów CPU/`nodejs_compat`.

## Performance Considerations

- Workers 10 ms CPU (free): trzymać parsowanie/walidację lekko; nie logować wielkich payloadów
  synchronicznie w gorącej ścieżce (payload do DB wystarcza). Budżet na plan $5 przed realnym
  ruchem (`infrastructure.md`).
- 50 subrequestów/req: pojedynczy bazowy call + kilka zapytań Supabase — z zapasem.
- Bundle 3 MB (free): `fetch` zamiast SDK; `zod` jest lekki, monitorować rozmiar bundla w CI.

## Migration Notes

- Migracja jest addytywna (nowa tabela + nullable kolumna) — bezpieczna przed mergem.
  Wdrożenie prod = deploy Workera **oraz** `supabase db push` (osobny krok, `lessons.md`).
- Rollback Workera nie cofa schematu — kolumna `generation_id` jest nullable, więc stary kod
  ją ignoruje bez awarii.

## References

- Change: `context/changes/ai-candidate-generation/change.md` (C10X-7)
- PRD: `context/foundation/prd.md` (US-01, FR-003/004/006/018)
- Roadmap S-04: `context/foundation/roadmap.md:161-173`
- Infra/limity Workers + OpenRouter: `context/foundation/infrastructure.md`
- Wzory: `src/lib/flashcards.ts`, `src/lib/decks.ts`, `src/lib/supabase.ts`,
  `src/pages/api/decks/[publicId]/cards/index.ts`, `src/components/Sidebar.astro:18-25`
- Schemat: `supabase/migrations/20260705180246_init_core_schema.sql`,
  `20260710195327_manual_card_source.sql`
- OpenRouter: `https://openrouter.ai/api/v1/chat/completions`, structured outputs (`response_format` json_schema)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schemat + warstwa danych

#### Automated

- [x] 1.1 Migracja aplikuje się czysto (`supabase migration up` / `db reset`) — 5a64b96
- [x] 1.2 Typy DB zregenerowane (`gen types`), diff pokazuje `generation_session` + `generation_id` — 5a64b96
- [x] 1.3 `npx astro sync` bez błędów — 5a64b96
- [x] 1.4 `npm run lint` przechodzi — 5a64b96

#### Manual

- [x] 1.5 RLS `generation_session` zweryfikowane (rola+JWT+RETURNING, kontrola pozytywna) — 5a64b96
- [x] 1.6 `flashcard.generation_id` nullable + FK `ON DELETE SET NULL` działa — 5a64b96

### Phase 2: Klient LLM + env + Zod

#### Automated

- [x] 2.1 `npm run lint` i `npm run build` przechodzą (Zod dołączony) — 836aad2
- [x] 2.2 `npx astro sync` typuje nowe zmienne `astro:env/server` — 836aad2

#### Manual

- [x] 2.3 Z kluczem: `generateCandidates` zwraca poprawne karty w wybranym języku, w limitach — 836aad2
- [x] 2.4 Bez klucza: tryb mock działa offline — 836aad2
- [x] 2.5 Za długa/wadliwa karta → pominięta (fallback), reszta zapisana; bez re-calla — 836aad2

### Phase 3: Endpoint /api/generate

#### Automated

- [x] 3.1 `npm run lint` i `npm run build` przechodzą — 083bd42
- [x] 3.2 `npx astro sync` czysty (nowa trasa) — 083bd42

#### Manual

- [x] 3.3 POST zwraca JSON; karty w DB `state=1/source=2/generation_id`; sesja zapisana — 083bd42
- [x] 3.4 `newDeckName` tworzy talię i zapisuje kandydatów — 083bd42
- [x] 3.5 Błąd OpenRouter → JSON error + sesja `failed` z `error_message` — 083bd42
- [x] 3.6 Niezalogowany → 401; obcy `deckPublicId` → 404 bez wycieku — 083bd42
- [ ] 3.7 Smoke-test realnego calla na deployed preview (edge/workerd) — odłożone do /ship

### Phase 4: Strona generatora + wyspa + nav

#### Automated

- [x] 4.1 `npm run lint`, `npm run build`, `npx astro sync` przechodzą — 6828827

#### Manual

- [x] 4.2 Happy-path w UI: tekst → wybór → postęp → lista wyników; karty w DB — 6828827
- [x] 4.3 Nowa talia z generatora działa; nazwa zajęta → błąd w formularzu (nie baner w tle) — 6828827
- [x] 4.4 Błąd/timeout → komunikat + „Ponów"; podwójny klik zablokowany — 6828827
- [x] 4.5 Nav „Generuj fiszki" aktywny i podświetlony; strona chroniona — 6828827
- [x] 4.6 A11y: label/focus/keyboard, czytelny licznik znaków — 6828827

### Phase 5: Domyślny filtr accepted w liście talii (bez UI)

#### Automated

- [x] 5.1 `npm run lint`, `npm run build`, `npx astro sync` przechodzą — a2bdf29

#### Manual

- [x] 5.2 Karty ręczne (`accepted`) nadal widoczne na domyślnej liście (brak regresji manual-card-crud) — a2bdf29
- [x] 5.3 Kandydaci `generated`/`rejected` niewidoczni na domyślnej liście talii — a2bdf29
