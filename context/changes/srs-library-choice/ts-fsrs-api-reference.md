# ts-fsrs — wyciąg z API (referencja dla S-03)

> Źródło: dokumentacja `ts-fsrs` przez Context7 (`/open-spaced-repetition/ts-fsrs`).
> Uzupełnia decyzję z `srs-library-research.md` (wybór FSRS) konkretnym API pod
> implementację gwiazdy **S-03 `srs-study-session`**. To referencja techniczna, nie decyzja.

## Import

```typescript
import { createEmptyCard, fsrs, Rating, State } from 'ts-fsrs'
import type { Card, CardInput, FSRSParameters } from 'ts-fsrs'
```

## Model karty — `Card` (pola harmonogramu)

Stan karty po każdej operacji planowania (daty jako natywne `Date`):

```typescript
interface Card {
  due: Date            // następny termin powtórki
  stability: number    // trwałość pamięci
  difficulty: number   // trudność karty (odpowiednik "ease")
  elapsed_days: number // (deprecated)
  scheduled_days: number // dni do następnej powtórki (interwał)
  learning_steps: number
  reps: number         // liczba powtórek
  lapses: number       // liczba nieudanych powtórek
  state: State         // New / Learning / Review / Relearning
  last_review?: Date
}
```

Stan nowej karty z `createEmptyCard()`:

```typescript
{
  due: now,          // lub Date.now()
  stability: 0,
  difficulty: 0,
  elapsed_days: 0,
  scheduled_days: 0,
  reps: 0,
  lapses: 0,
  learning_steps: 0,
  state: State.New,
  last_review: undefined
}
```

## Skala oceny — enum `Rating`

```typescript
Rating.Manual (0)  // specjalne — nie akcja użytkownika
Rating.Again  (1)  // nie pamiętał / błąd
Rating.Hard   (2)  // trudne, ale poprawne
Rating.Good   (3)  // poprawne, oczekiwany poziom
Rating.Easy   (4)  // bardzo łatwe
```

Cztery przyciski użytkownika w UI sesji nauki: **Again / Hard / Good / Easy**.
Typ `Grade` = `Rating` bez `Manual` (czyli 1–4) — tego oczekuje `repeat()`/`next()`.

## Enum `State` (kolumna w DB)

```typescript
State.New        // 0 — nowa, jeszcze nie powtarzana
State.Learning   // 1 — w trakcie pierwszej nauki
State.Review     // 2 — w normalnym cyklu powtórek
State.Relearning // 3 — po lapsie (Again), ponowna nauka
```

Zapis liczbowy (0–3) trafia do kolumny; przy odczycie z DB normalizuj przez
`TypeConvert.state(value)` (przyjmuje `'New'`/`'new'`/`0` → `State.New`).

## Pełna pętla nauki

```typescript
const scheduler = fsrs()
const card = createEmptyCard()        // nowa karta: due = now, state = New

// Podgląd wszystkich 4 wyników PRZED odpowiedzią (interwały na przyciskach):
const preview = scheduler.repeat(card, new Date())
preview[Rating.Good].card             // jak wyglądałaby karta po ocenie "Good"

// Zastosowanie oceny użytkownika PO odpowiedzi:
const result = scheduler.next(card, new Date(), Rating.Good)
result.card                           // zaktualizowana karta (nowe due/stability/difficulty)
result.log                            // wpis do historii powtórek (ReviewLog)
```

## Wynik powtórki — `RecordLogItem` i `ReviewLog`

`next()` zwraca `RecordLogItem`, `repeat()` zwraca `RecordLog` (mapa po `Grade`):

```typescript
type RecordLogItem = { card: Card; log: ReviewLog }
type RecordLog     = { [key in Grade]: RecordLogItem }   // wynik repeat()

interface ReviewLog {
  rating: Rating          // ocena, którą wystawił użytkownik
  state: State            // stan karty PRZED tą powtórką
  due: Date               // poprzedni termin
  stability: number
  difficulty: number
  elapsed_days: number
  last_elapsed_days: number
  scheduled_days: number
  learning_steps: number
  review: Date            // moment powtórki
}
```

`ReviewLog` to rekord do tabeli historii powtórek — potrzebny do `rollback` (cofnięcie),
do `reschedule` (przeliczenie z historii) oraz jako dowód trwałości harmonogramu
(guardrail „żadna karta nie ginie"). Hydratacja z DB: `TypeConvert.review_log(input)`.

## Metody schedulera

| Metoda | Zwraca | Do czego |
| --- | --- | --- |
| `createEmptyCard(now?, afterHandler?)` | `Card` | inicjalizuje kartę gotową do 1. powtórki (`state: New`) |
| `repeat(card, now)` | `RecordLog` (mapa po `Grade`) | podgląd 4 wariantów — interwały w UI |
| `next(card, now, grade)` | `RecordLogItem` (`{ card, log }`) | **główna**: stosuje ocenę, loguje powtórkę |
| `get_retrievability(card, now, format?)` | `number` / `string` | prawdopodobieństwo przypomnienia (np. `"92.45%"`) |
| `rollback(card, log, afterHandler?)` | `Card` | cofnięcie powtórki do stanu sprzed oceny |
| `forget(card, now, reset_count?)` | `RecordLogItem` | reset karty do stanu `New` |
| `reschedule(card, reviews?, options?)` | `IReschedule` | przeliczenie harmonogramu z pełnej historii |
| `useStrategy()` / `clearStrategy()` | `this` | własne strategie schedulera (chainable) |

### `rollback` — cofnięcie oceny

```typescript
const preview = scheduler.repeat(card, new Date())
const { card: newCard, log } = preview[Rating.Hard]
const prevCard = scheduler.rollback(newCard, log)  // karta jak przed powtórką
```

Rzuca `FSRSValidationError`, gdy log ma ocenę `Manual` lub niepoprawne dane.

### `forget` — reset karty

```typescript
const result = scheduler.forget(card, new Date(), true) // reset_count=true zeruje reps/lapses
result.card.state      // State.New
result.card.stability  // 0
result.card.reps       // 0 (gdy reset_count=true)
```

### `reschedule` — przeliczenie z historii

```typescript
const reviews = [Rating.Good, Rating.Good, Rating.Good].map((rating, i) => ({
  rating,
  review: reviewDates[i],
}))
const result = scheduler.reschedule(createEmptyCard(), reviews, { skipManual: false })
result.collections     // RecordLogItem dla każdej powtórki
result.reschedule_item // stan końcowy
```

## Konfiguracja — `FSRSParameters` i `fsrs()`

```typescript
interface FSRSParameters {
  request_retention: number        // docelowa retencja (0 < x ≤ 1)
  maximum_interval: number         // maks. interwał w dniach
  w: number[] | readonly number[]  // 21 wag FSRS-6
  enable_fuzz: boolean             // losowe rozproszenie interwałów
  enable_short_term: boolean       // model krótkoterminowej stabilności
  learning_steps: Steps            // kroki nauki, np. ['1m', '10m']
  relearning_steps: Steps          // kroki ponownej nauki, np. ['10m']
}
```

Nie buduj tego ręcznie — użyj `generatorParameters()`, który dokleja domyślne FSRS-6
i migruje do v6:

```typescript
import { fsrs, generatorParameters } from 'ts-fsrs'

const params = generatorParameters({ request_retention: 0.9, maximum_interval: 36500 })
const scheduler = fsrs(params)
// lub krócej: const scheduler = fsrs({ request_retention: 0.9 })
```

**Domyślne (FSRS-6):** `request_retention: 0.9`, `maximum_interval: 36500`,
`enable_fuzz: false`, `enable_short_term: true`, `learning_steps: ['1m','10m']`,
`relearning_steps: ['10m']`, `w`: 21 wag.

## Persystencja (Supabase / edge)

- `Card` operuje natywnymi `Date`; do bazy zapisujesz pola jako kolumny (`state` jako 0–3),
  przy odczycie parsujesz z powrotem. `CardInput` przyjmuje daty jako string/ms — wygodne
  przy hydratacji z DB. Opcjonalny `afterHandler` w `createEmptyCard`/`next` mapuje kartę
  przy zapisie (np. `Date` → timestamp, doklejenie `id`).
- Helpery normalizujące dane z DB (rzucają `FSRSValidationError` przy złych danych):
  - `TypeConvert.state(value)` → `State` (z `'New'`/`'new'`/`0`),
  - `TypeConvert.review_log(input)` → `ReviewLog` (daty jako `Date`, oceny jako enum),
  - `TypeConvert.card(input)` → `Card` (do potwierdzenia w docs — dopisane przez analogię
    do pozostałych helperów `TypeConvert`, nie zweryfikowane wprost w snippetach).
- Parametry FSRS serializują się do JSON i wczytują do schedulera:
  ```typescript
  const serializedParams = '{"request_retention":0.9,"maximum_interval":36500}'
  const params = JSON.parse(serializedParams) as FSRSParameters
  const scheduler = fsrs(params)
  ```
- Karty „należne dziś" (sesja nauki) = zapytanie po `due <= now` w danej talii.

## Źródła (Context7)

- TypeDoc API: https://open-spaced-repetition.github.io/ts-fsrs/
- README: https://github.com/open-spaced-repetition/ts-fsrs/blob/main/packages/fsrs/README.md
- Autodocs: `_autodocs/{1-fsrs-scheduler,2-card-operations,4-types,9-quick-start-reference}.md`
