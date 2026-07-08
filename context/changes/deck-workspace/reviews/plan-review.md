<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-01 · Talie jako prywatna przestrzeń robocza

- **Plan**: `context/changes/deck-workspace/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-07
- **Verdict**: REVISE → SOUND (po triage; wszystkie findingi obsłużone)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

16/16 istniejących ścieżek ✓, 9/9 tworzonych plików faktycznie nieobecnych ✓,
4/4 polityki RLS `deck` (select/insert/update/delete) potwierdzone w migracji ✓,
brief↔plan ✓, Progress↔Phase (kontrakt mechaniczny) ✓, brak `contract-surfaces.md` (pominięto).
Zweryfikowane w kodzie: `signin.ts` redirect na `/` (plan zmienia na `/decks`), `index.astro`
renderuje `<Welcome />` bez odczytu `locals.user` (plan dodaje redirect), typy `deck` wymagają
`user_id`+`name`, `public_id` auto. Brak `src/pages/404.astro`.

## Findings

### F1 — Rename/delete gubi błąd i input; brak round-tripu z Fazy 2

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff; zatrzymaj się i przemyśl
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1 (rename endpoint) + §3 (DeckActions)
- **Detail**: Faza 2 celowo rozwiązuje problem „POST→redirect zamyka modal, więc błąd walidacji znika" (create wraca na `/decks?error=<msg>&open=create`, strona re-otwiera modal). Faza 3 rename nie dostawała odpowiednika — na kolizję nazwy (23505) / pustą nazwę modal był zamknięty, prefill przepadał, a przy akcjach na liście użytkownik nie wiedziałby, której talii dotyczy błąd. Regresja UX, której Faza 2 unikała.
- **Fix**: Rozszerzyć mechanizm re-otwarcia na rename. Po decyzji z F2 (akcje na stronie talii) round-trip jest scoped do jednej talii: błąd rename → redirect na `/decks/<publicId>?error=<msg>&open=rename`, strona talii re-otwiera własny modal z prefillem.
- **Decision**: FIXED — edycje w Critical Implementation Details i Phase 3 §1.

### F2 — „DeckActions użyte na /decks i/lub /decks/[publicId]" — nieprzesądzone

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; wąski zakres
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3 (DeckActions.tsx)
- **Detail**: „i/lub" zostawia implementerowi decyzję, która materialnie zmienia resztę: akcje na liście = modal per-wiersz + stan re-otwarcia per talia (komplikuje F1); akcje tylko na stronie talii = jeden modal, jeden kontekst błędu. To nie kosmetyka — przesądza kształt F1.
- **Fix**: Przesądzić lokalizację — rename/delete żyją wyłącznie na `/decks/[publicId]`; lista `/decks` pozostaje read-only + tworzenie.
- **Decision**: FIXED — wybór „akcje na stronie talii"; Phase 3 §3 zaktualizowane, F1 uspójnione (redirect na stronę talii zamiast na listę).

### F3 — 404 na obcy public_id to niestylowana pusta odpowiedź

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; wąski zakres
- **Dimension**: Blind Spots
- **Location**: Phase 2 §4 (strona talii, obsługa null)
- **Detail**: Plan zwraca `new Response(null, { status: 404 })`; w repo brak `src/pages/404.astro`, więc użytkownik dostaje surową pustą stronę — niespójne z polskimi stanami pustymi reszty slice'a. Izolacja (404 zamiast 403) jest poprawna; chodzi o prezentację.
- **Fix**: Dodać minimalny `src/pages/404.astro` (Layout, copy PL) — Astro renderuje go automatycznie dla 404. Alternatywa: świadomie zaakceptować surowe 404 w MVP.
- **Decision**: ACCEPTED — surowe 404 zaakceptowane w MVP; odnotowane w Phase 2 §4 jako odroczone dopięcie UX.

## Triage Summary

- **Fixed**: F1, F2
- **Accepted**: F3
- **Verdict po fixach**: SOUND — plan gotowy do implementacji (`/10x-implement deck-workspace phase 1`).
