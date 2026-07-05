<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Izolacja danych per-konto (RLS) + rdzenne tabele

- **Plan**: `context/changes/per-user-data-isolation/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-05
- **Verdict**: REVISE → SOUND (po triage — wszystkie findingi domknięte w planie)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS (1 observation) |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (1 finding) |
| Plan Completeness | WARNING (1 finding) |

## Grounding

6/6 paths ✓, `config.toml` (migrations=on, PG17) ✓, eslint `strictTypeChecked` + `projectService` ✓, `supabase/migrations/` pusty (potwierdza „warstwa pusta") ✓, brief↔plan ✓, Progress↔Phase spójne ✓, brak blast-radius dla generyka `<Database>` (callery używają tylko `supabase.auth.*`) ✓.

## Podsumowanie

Rdzeń planu jest solidny: schemat, konwencja identity 100000, `public_id`, kaskady, `state_id` bez defaultu, dyscyplina klucza `anon` i predykaty RLS (`deck` po `auth.uid()`, `flashcard` przez join) — poprawne i dobrze uzasadnione, bez rozdmuchanego zakresu. Oba warningi dotyczą **wiarygodności weryfikacji**, nie samego projektu — dlatego werdykt to REVISE blisko SOUND. Po triage wszystkie trzy findingi zostały zaadresowane bezpośrednio w `plan.md`, co przesuwa werdykt do SOUND.

## Findings

### F1 — Ręczny dowód izolacji może dać FAŁSZYWY PASS

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff; zatrzymaj się i przemyśl
- **Dimension**: Blind Spots
- **Location**: Phase 3 → „Procedura i dowód izolacji"; Manual Testing Steps 3
- **Detail**: Cała wartość dowodowa Fazy 3 (i twardy guardrail PRD „żaden user nie widzi cudzych danych") wisi na kroku „ustaw kontekst auth.uid() na A", bez konkretnego mechanizmu impersonacji. Pułapka: jeśli ustawić tylko `SET ROLE authenticated` bez `request.jwt.claims`, to `(select auth.uid())` = NULL, więc każda polityka odrzuca wszystko — A widzi 0 wierszy B, ale też 0 własnych. Zero-wynik wygląda jak dowód izolacji, a nic nie testuje. plan-brief sam nazywa to ryzykiem („Fałszywe 'działa' bez realnego testu dwóch kont").
- **Fix**: Wpisać do `rls-verification.md` dokładny snippet impersonacji (`set role authenticated` + `set request.jwt.claims`) oraz **positive control** — najpierw potwierdź, że A widzi WŁASNE dane (`count(*) > 0`), dopiero potem że nie widzi B.
  - Strength: Zamienia „0 wierszy" w wiarygodny dowód; positive control eliminuje jedyny realny sposób na fałszywy PASS.
  - Tradeoff: Kilka linijek więcej w procedurze; brak istotnego kosztu.
  - Confidence: HIGH — znany mechanizm RLS Supabase (`auth.uid()` czyta `sub` z `request.jwt.claims`).
  - Blind spot: Zakłada test w psql; dla wariantu przez klienta JS z realną sesją zasada positive control ta sama.
- **Decision**: FIXED — dopisany snippet impersonacji + positive control w Fazie 3 (Contract pkt 4) oraz wzmocniony krok 3 w „Manual Testing Steps".

### F2 — Generowany `database.types.ts` lintowany (strictTypeChecked), bez wpisu ignore

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff; zatrzymaj się i przemyśl
- **Dimension**: Plan Completeness
- **Location**: Phase 3 → skrypt `db:types` + kryteria „lint przechodzi" (1.4 / 2.4 / 3.2)
- **Detail**: Plan commituje `src/db/database.types.ts` i wielokrotnie zakłada „lint przechodzi". Ale: (a) plik NIE jest w `.gitignore` (sekcja „generated types" obejmuje tylko `.astro/`), (b) eslint `includeIgnoreFile` ignoruje tylko to, co w `.gitignore`, (c) `tsconfig` `include: ["**/*"]` + `projectService: true` → plik trafia do programu TS i jest lintowany regułami `strictTypeChecked` + `stylisticTypeChecked`. Wygenerowany plik Supabase (rekurencyjny typ `Json`, eksport `Constants as const`) może naruszyć regułę i wywrócić kryterium „lint" na artefakcie, którego nie chcemy ręcznie poprawiać.
- **Fix**: Dodać do `eslint.config.js` osobny blok `{ ignores: ["src/db/database.types.ts"] }` jako część Fazy 3, zanim kryterium „lint" jest sprawdzane.
  - Strength: Zdejmuje ryzyko z generowanego, nie-ręcznego artefaktu; zgodne z powszechną praktyką.
  - Tradeoff: Plik nie jest sprawdzany stylistycznie — nieistotne dla artefaktu generowanego.
  - Confidence: MED — pewne, że plik BĘDZIE lintowany; niepewne, czy akurat wywali błąd (zależy od wersji generatora).
  - Blind spot: Nie odpalono realnej generacji, by policzyć naruszenia.
- **Decision**: FIXED — dodany krok „2b. Wyłączenie generowanego pliku z lintu" w Fazie 3.

### F3 — Kryterium `npx astro sync` bez związku ze zmianą DB

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; oczywista i wąska
- **Dimension**: Lean Execution
- **Location**: Phase 3 → Automated 3.4
- **Detail**: `astro sync` regeneruje typy tras/treści/`astro:env` — ta zmiana nie dotyka routingu ani content collections. Kryterium nieszkodliwe, ale to szum: nie weryfikuje niczego z end-state F-01. Realny typecheck generyka `<Database>` łapałby `npx astro check` (ani eslint, ani `astro build` nie wymuszają pełnego typecheck).
- **Fix**: Zastąpić 3.4 realnym typecheckiem `npx astro check`.
- **Decision**: FIXED — kryterium 3.4 (Success Criteria + Progress) zmienione z `astro sync` na `astro check`.
