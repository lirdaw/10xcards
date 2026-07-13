<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Generacja kandydatów fiszek AI z wklejonego tekstu

- **Plan**: context/changes/ai-candidate-generation/plan.md
- **Scope**: Phase 1–5 of 5 (full plan)
- **Date**: 2026-07-12
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Eager-tworzenie talii przy `newDeckName` psuje „Ponów" (FR-018) i osieroca puste talie

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/api/generate.ts:81-91 (interakcja z :118, :139, :164)
- **Detail**: W gałęzi `newDeckName` talia jest tworzona (`createDeck`) PRZED wywołaniem LLM.
  Gdy generacja się nie powiedzie (transport/timeout → 502, albo `saved===0` → 422), talia
  jest już utrwalona, a endpoint zwraca błąd retriable. Klient pokazuje „Ponów", który
  wysyła TEN SAM payload z `newDeckName`. Drugie `createDeck` trafia na `23505`
  (unique na `user_id, name`) i zwraca 409 „Talia o tej nazwie już istnieje". „Ponów" nigdy
  nie zadziała dla ścieżki nowej talii — użytkownik utyka (nowo utworzona talia nie jest też
  w dropdownie wyrenderowanym przy SSR, więc nie może jej wybrać bez reloadu). Dodatkowo każda
  nieudana generacja z nową talią zostawia pustą, osieroconą talię. Manualny check 4.4
  („Ponów ponawia") jest odhaczony, ale najwyraźniej testowany tylko dla istniejącej talii.
- **Fix**: Odwrócić kolejność — tworzyć talię dopiero po udanej generacji + walidacji Zod,
  tuż przed `insertCandidates` (dla `newDeckName` przenieść `createDeck` za blok LLM). Usuwa
  zarówno zerwany retry (nie ma podwójnego insertu nazwy), jak i osierocone puste talie.
  - Strength: Jednym ruchem naprawia FR-018 dla nowej talii i eliminuje puste talie; zgodne
    z intencją planu (talia to cel zapisu, nie efekt uboczny nieudanego calla).
  - Tradeoff: Reorder endpointu — sesja `failed` przy 502/422 nie ma jeszcze `deckId`, ale
    sesja i tak nie wymaga talii (`generation_session` nie ma FK do `deck`), więc bez problemu.
  - Confidence: HIGH — potwierdzone czytaniem endpointu i klienta (`GeneratorForm.tsx:175-177`).
  - Blind spot: Trzeba sprawdzić, czy przeniesienie `createDeck` nie koliduje z mapą błędu
    23505 (nazwa zajęta) w happy-path — nadal potrzebna, gdy user faktycznie poda istniejącą nazwę.
- **Decision**: FIXED — createDeck przeniesiony na ścieżkę sukcesu; pre-LLM tylko deckNameExists (szybkie 409). Lint+build zielone.

### F2 — Sesja `succeeded` może zostać zapisana bez kart (brak kompensacji na `cardsError`)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Data safety)
- **Location**: src/pages/api/generate.ts:168-188
- **Detail**: Ścieżka sukcesu zapisuje sesję ze `status:"succeeded"` i `saved_count: saved`
  PRZED `insertCandidates`. Jeśli `insertCandidates` zwróci `cardsError`, endpoint zwraca 500,
  ale sesja `succeeded` z `saved_count>0` została już utrwalona mimo że zero kart trafiło do
  bazy. Rozjazd audytu: `saved_count` zawyża liczbę „zapisanych" kart — a to sygnał pod metrykę
  akceptacji 75% z PRD. Kolejność (sesja→karty) jest wymuszona przez FK
  `flashcard.generation_id → generation_session.id`, więc odwrócić się nie da.
- **Fix**: Na `cardsError` skompensować przed zwrotem 500 — zaktualizować sesję do
  `status:"failed"` / `saved_count:0` (lub ją usunąć). Częstotliwość niska (bulk insert jest
  atomowy: albo wszystkie wiersze, albo żaden), naprawa tania.
- **Decision**: FIXED — dodano `failGenerationSession` w generations.ts; endpoint kompensuje sesję na cardsError przed 500. Lint+build zielone.

### F3 — `language` wstrzykiwany do system-promptu bez whitelisty

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Security)
- **Location**: src/lib/openrouter.ts:96-97 (endpoint akceptuje dowolny string ≤40 znaków, src/pages/api/generate.ts:36)
- **Detail**: Przy `language !== "auto"` wartość idzie wprost do promptu
  (`Write the flashcards in this language: ${language}.`). Endpoint przyjmuje dowolny string do
  40 znaków (dropdown jest tylko po stronie klienta). Wektor prompt-injection, ale wyłącznie
  self-injection — użytkownik zaburza własną generację (i tak może wstawić cokolwiek w
  `sourceText`), zero wpływu na innych. Ryzyko niskie.
- **Fix**: Walidować `language` względem whitelisty dozwolonych wartości (te z `LANGUAGES` +
  `auto`) w `bodySchema`, zamiast dowolnego stringa.
- **Decision**: FIXED — `language: z.enum(LANGUAGES)` w bodySchema, whitelist zsynchronizowana z wyspą. Lint+build zielone.

### F4 — `max_tokens: 4096` może obcinać duże generacje (count=15)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/openrouter.ts:166
- **Detail**: Dla `count=15` i `back` do 1000 znaków 4096 tokenów może nie wystarczyć →
  obcięty JSON → `JSON.parse` rzuca → `rawCards=[]` → ścieżka `saved===0` → 422. Obsłużone
  łagodnie (nie crashuje), ale przy większych `count` generacja może systematycznie kończyć się
  błędem. Jakościowa obserwacja pod metrykę akceptacji.
- **Fix**: Skalować `max_tokens` z `count` (np. ~300 tokenów/kartę + narzut) lub podnieść limit.
- **Decision**: FIXED — `max_tokens = 500 + count * 450` w openrouter.ts. Lint+build zielone.

### F5 — Wyścig abort/zapis klient↔serwer (udokumentowany, zaakceptowany)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/api/generate.ts:20-25, src/components/generate/GeneratorForm.tsx:17-20
- **Detail**: Kolejność timeoutów jest poprawna (klient 55s > serwer 40s), więc serwer prawie
  zawsze odpowiada pierwszy. Jedyne okno na podwojenie kart: gdy same inserty Supabase zajmą
  >15s po odpowiedzi modelu — klient przerywa na 55s, pokazuje „Ponów", a serwer i tak commituje.
  Zmitygowane tym, że kandydaci lądują jako `generated` (nie `accepted`), więc nie zanieczyszczają
  nauki. Świadomie opisane w komentarzu endpointu — akceptowalny tradeoff.
- **Fix**: Brak działania — pozostawić jako znany, udokumentowany tradeoff (ewentualnie domknąć
  idempotencją w S-05, gdy dojdzie recenzja kandydatów).
- **Decision**: ACCEPTED-AS-RULE — lekcja „Klient↔serwer timeouty + „Ponów" wymagają idempotencji zapisu" dopisana do lessons.md; fix kodu (idempotencja, Wariant A) świadomie odłożony do S-05.
