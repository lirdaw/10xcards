# SRS Library Research — shortlista i rozstrzygnięcie SM-2 vs FSRS

> Faza research dla `srs-library-choice` (C10X-2). Cel: wybrać gotową bibliotekę SRS
> (buy-vs-build → buy, PRD §Non-Goals) i skalę oceny przypomnienia (PRD Open Questions #2).
> Zakres: rozstrzygnięcie decyzji foundation, nie budowa algorytmu.

## Metoda zapytań

Zamiast ogólnego „best SRS library 2026" (SEO-spam) użyto trzech zapytań pod dokumentację
techniczną, każde celujące w inny trade-off:

1. **ts-fsrs API** — model `Card`/`ReviewLog`, enum `Rating`/`State`, `repeat`/`next`
   (kształt ReviewState, skala ocen).
2. **SM-2 vs FSRS technicznie** — pola harmonogramu, skala binarna vs 4-stopniowa,
   parametry retencji (rozstrzygnięcie).
3. **TS SM-2 npm** — `interval`/`efactor`/`repetition`, skala 0–5 (najlżejszy konkurent).

## Shortlista

| | **ts-fsrs** (FSRS-6) | **supermemo** (SM-2) | **@dtjv/sm-2** (SM-2) |
|---|---|---|---|
| Algorytm | FSRS v6 (model DSR) | SM-2 | SM-2 |
| npm | v5.4.1 (maj 2026), ~97,6K/tydz. | dojrzały, mikro | niszowy (2021) |
| Zależności | **0**, MIT, ES/CJS/UMD | 0 | 0 |
| ReviewState | `{stability, difficulty, due, state, reps, lapses, elapsed_days, scheduled_days, last_review}` | `{interval, repetition, efactor}` | `{rep, repInterval, easyFactor}` |
| Skala ocen | 4: Again/Hard/Good/Easy | 0–5 (6 stopni) | enum 0–5 |
| Polityka edycji | pure, `rollback` / `forget` / `reschedule`, `repeat()` = podgląd 4 wyników | pure (zwraca nowy item) | pure, generyczny |

### Zgodność ze stackiem (Astro 6 / React 19 / Cloudflare Workers / Supabase)

`ts-fsrs` to czysty TypeScript, **zero zależności**, buildy ES/CJS/UMD → działa na
edge/workerd bez shimów. `Card` serializuje się 1:1 do kolumn Supabase, a wbudowany
`afterHandler` mapuje `Date` na timestampy przy zapisie. Deklarowane `Node >=20` dotyczy
tylko toolchainu, nie runtime'u — kod jest bez API Node i bez dostępu do plików.

## Rozstrzygnięcie: **FSRS (przez ts-fsrs)**

Trzy trade-offy będące istotą decyzji foundation:

**1. Kształt ReviewState.** SM-2 ma 3 skalary i myli w `efactor` bieżącą stabilność
pamięci z wewnętrzną trudnością karty. Skutek to udokumentowane „ease hell" — karta raz
oceniona nisko na stałe grzęźnie na krótkich interwałach (leech). FSRS rozdziela to na
`stability` i `difficulty`, więc karta trudna, ale aktualnie dobrze pamiętana, dostaje
długi interwał. Wspiera guardrail PRD „harmonogram się nie psuje" oraz AC z US-02
(„dobrze znana karta odkładana dalej niż trudna").

**2. Skala oceny — domyka PRD Open Question #2.** SM-2 to 6 stopni (0–5), za dużo jak na
„ocenę przypomnienia" (FR-012). FSRS ma 4 przyciski **Again / Hard / Good / Easy**
mapujące się wprost na UX sesji nauki i regułę „known ↦ dalej, hard ↦ wcześniej".
→ **Skala do zapisania w PRD: 4-stopniowa Again/Hard/Good/Easy.**

**3. Polityka edycji.** Guardrail PRD wymaga, by edycja karty nie korumpowała
harmonogramu. FSRS jest immutable (zwraca nową kartę) i ma jawne `rollback` (cofnięcie
oceny), `forget` (reset), `reschedule` (przeliczenie z historii) oraz zbieżną obsługę
zaległych powtórek (interwał dąży do granicy). SM-2 tego nie ma — przy opóźnieniu
interwał rośnie liniowo bez ograniczenia.

Dodatkowo FSRS-6 bije Anki SM-2 na benchmarku open-spaced-repetition dla ~99,6% kolekcji
(log loss). SM-2 pozostaje sensowny jedynie jako awaryjny mikro-fallback — bez powodu, by
go wybierać, skoro ts-fsrs jest równie lekki i zero-dependency.

## Decyzje wynikowe

- **Biblioteka:** `ts-fsrs` (FSRS-6), MIT, zero zależności.
- **Skala oceny (Open Question #2):** 4-stopniowa — Again / Hard / Good / Easy.
- **Pola harmonogramu do modelu Supabase:** `stability, difficulty, due, state, reps,
  lapses, last_review` (+ opcjonalnie `elapsed_days`, `scheduled_days`).
- **Domyślne parametry:** `request_retention = 0.9`, `maximum_interval = 36500`.
- **API do przepływu nauki:** `createEmptyCard()` przy tworzeniu, `repeat()` do podglądu
  4 wyników, `next(card, now, rating)` do zastosowania oceny; `forget`/`rollback`/
  `reschedule` dla edycji i korekt.

## Źródła

- ts-fsrs — TypeDoc API: https://open-spaced-repetition.github.io/ts-fsrs/
- ts-fsrs — README: https://github.com/open-spaced-repetition/ts-fsrs/blob/main/packages/fsrs/README.md
- ts-fsrs — npm: https://www.npmjs.com/package/ts-fsrs
- FSRS algorytm (wiki): https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
- FSRS vs SM-2 (ease hell, model DSR): https://learn.neurako.com/docs/learning-science/fsrs-vs-sm2
- Benchmark FSRS vs SM-2/SM-17: https://github.com/open-spaced-repetition/fsrs-vs-sm17
- supermemo (SM-2, npm): https://www.npmjs.com/package/supermemo
- @dtjv/sm-2: https://github.com/dtjv/sm-2
- SuperMemo 2 (oryginał, skala 0–5): https://www.super-memory.org/archive/english/ol/sm2.htm
