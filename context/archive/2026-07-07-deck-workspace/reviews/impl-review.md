<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-01 · Talie jako prywatna przestrzeń robocza

- **Plan**: context/changes/deck-workspace/plan.md
- **Scope**: Phase 1–3 of 3 (full plan)
- **Date**: 2026-07-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Dowód izolacji A/B oznaczony jako gotowy, ale plik dowodu jest pusty

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: context/changes/deck-workspace/isolation-check.md:38-41 (Progress 3.7, plan.md:467)
- **Detail**: Progress 3.7 jest `[x]` „Udokumentowany dowód izolacji A/B (lista + URL) + pozytywna kontrola — 2174440", ale sekcja **Wynik** w `isolation-check.md` ma wszystkie checkboxy niezaznaczone, bez daty i testera. Statyczny przegląd a11y + kodu jest udokumentowany, lecz właściwy runtime-test dwóch kont (A nie widzi talii B na `/decks` ani pod `/decks/<public_id_B>` → 404; pozytywna kontrola własnej talii) nie ma zapisanego dowodu. To sztandarowa gwarancja slice'a (prywatna przestrzeń per-konto). Poziom kodu potwierdza izolację (RLS-scoped + 404-nie-403 zweryfikowane), więc ryzyko techniczne jest niskie — brakuje samego wykonania i podpisu deklaracji.
- **Fix**: Wykonać procedurę dwóch kont i uzupełnić checkboxy Wyniku (data + tester) w `isolation-check.md`; albo cofnąć 3.7 do `[ ]` do czasu wykonania.
  - Strength: Domyka deklarację, która jest właściwym deliverable fazy 3; kod już potwierdza mechanizm.
  - Tradeoff: Wymaga ręcznego uruchomienia na dwóch kontach.
  - Confidence: HIGH — plik jasno pokazuje pusty Wynik.
  - Blind spot: Nie wiadomo, czy test był wykonany „na żywo" bez zapisania — traktujemy brak zapisu jako brak dowodu.
- **Decision**: FIXED — test dwóch kont wykonany (tester: Dawid, 2026-07-08); sekcja Wynik w isolation-check.md uzupełniona realnym dowodem, Progress 3.7 pozostaje [x].

### F2 — Angielskie CTA na landingu łamią zasadę „UI po polsku"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/Welcome.astro:44,51
- **Detail**: Przyciski „Sign In" / „Sign Up" są po angielsku, podczas gdy AGENTS.md i PRD wymagają polskiego UI (hero na tej samej stronie jest po polsku). Plik był edytowany w tym slice (usunięcie starter-kart), więc mieści się w zakresie przeglądu. Copy było odziedziczone ze startera, ale zostało dotknięte i nie poprawione.
- **Fix**: Zmienić na „Zaloguj się" / „Zarejestruj się".
- **Decision**: FIXED — CTA w Welcome.astro:45,51 zmienione na „Zaloguj się" / „Zarejestruj się".

### F3 — Ładowanie stron połyka błąd zapytania (błąd DB wygląda jak pustka / 404)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/decks/index.astro:8, src/pages/decks/[publicId]/index.astro:16
- **Detail**: Loadery czytają tylko `{ data }` i pomijają `error`. Przejściowy błąd Supabase/DB renderuje się jako stan pusty („Nie masz jeszcze talii") lub 404 zamiast stanu błędu — awaria bazy podszywa się pod brak danych / nieistnienie. Akceptowalne w MVP, ale mylące diagnostycznie.
- **Fix**: Rozgałęzić na `error` i pokazać odrębny stan „coś poszło nie tak".
- **Decision**: ACCEPTED-AS-RULE: „Loadery SSR rozróżniają błąd zapytania od braku danych" (lessons.md) — kod pozostaje bez zmian.

### F4 — plan.md rozjechany z implementacją (3 udokumentowane, benign drifty)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md:168 (index.astro), plan.md:266 (bare 404)
- **Detail**: (a) redirect „/" → `/decks` zrobiony w `middleware.ts:18-21`, nie w `index.astro` (lepiej — redirect przed renderem); (b) `decks/[publicId]/index.astro` używa `Astro.response.status = 404` + wystylizowana polska strona 404 zamiast `return new Response(null,{status:404})` (wymuszone przez eslint `no-misused-promises`, bogatsze niż planowano); (c) błąd create pokazywany w `CreateDeckModal`, nie w banerze strony. Wszystkie funkcjonalnie równe-lub-lepsze; jedyna luka to nieaktualny tekst planu.
- **Fix**: Dopisać addendum do plan.md odzwierciedlające trzy decyzje as-built, by przyszłe przeglądy miały aktualny ground truth.
- **Decision**: FIXED — sekcja „As-built addendum" dodana do plan.md z trzema decyzjami.

### F5 — `publicId` niewalidowany jako UUID przed wstawieniem do redirectu

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Security)
- **Location**: src/pages/api/decks/[publicId].ts:16
- **Detail**: `errorUrl` interpoluje surowy param `publicId` do nagłówka `Location` redirectu przed jakąkolwiek walidacją. Wstrzyknięcie CRLF/nagłówka jest praktycznie zneutralizowane (dopasowanie pojedynczego segmentu ścieżki + kodowanie nagłówków w Workers), więc to informacyjne — belt-and-suspenders.
- **Fix**: Zwalidować `publicId` jako UUID na wejściu endpointu.
- **Decision**: FIXED — dodano `UUID_RE` + walidację na wejściu `[publicId].ts` (niepoprawny → 404). Analogiczny wzorzec w `delete.ts:27` pozostawiony poza zakresem findingu.
