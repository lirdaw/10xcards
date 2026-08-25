---
reviewed: 2026-08-25
reviewer: claude-sonnet-4.6
source_section: "roadmap.md § Parked ideas (post-MVP → Jira 'Pomysł')"
items_reviewed: 15
---

# Backlog Review — Parked ideas

Przegląd 15 pozycji z `context/foundation/roadmap.md § Parked ideas`.
Sprawdzone: `src/`, `tests/`, `.github/workflows/`, migracje Supabase.

| Ticket | Tytuł (skrócony) | Werdykt | Dowód |
|--------|------------------|---------|-------|
| C10X-14 | Soft-delete / trash / recovery for decks and flashcards | NADAL AKTUALNY | Brak `deleted_at`, `is_deleted` ani żadnego ekwiwalentu we wszystkich migracjach i `src/`. Endpointy usuwania to twarde DELETEy: `src/pages/api/decks/[publicId]/delete.ts`, `src/pages/api/decks/[publicId]/cards/[cardPublicId]/delete.ts`. |
| C10X-15 | Shared responsive view template + component library (PARENT) | ZROBIONE MIMOCHODEM | Wspólny layout: `src/layouts/AuthenticatedLayout.astro`, `src/layouts/Layout.astro`. Biblioteka UI: `src/components/ui/button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`, `textarea.tsx`, `Modal.tsx`. Design tokeny: `src/styles/global.css:6–128`. |
| C10X-16 | Keyboard-driven UX + selection model (selection-driven toolbar) | NADAL AKTUALNY | Selekcja wdrożona wyłącznie w widoku review: `src/components/review/useSelection.ts`, `CandidateSelectionBar.tsx`. Widok fiszek ma wprost adnotację: `src/components/flashcards/FlashcardItem.tsx:18` — `"No checkbox, no source badge [...]: the first two are C10X-16's"`. Endpoint batch `src/pages/api/decks/[publicId]/cards/batch.ts:30` też odsyła do C10X-16. |
| C10X-17 | Manual ordering (position/Lp.) + flashcard view sorting | NADAL AKTUALNY | Brak kolumny `position` / `order_index` w jakiejkolwiek migracji. Brak drag-and-drop w `src/components/`. Aktualny porządek: `src/components/flashcards/FlashcardWorkspace.tsx:29` — `"Server-loaded cards in the helper's default order (created_at desc)"`. |
| C10X-18 | Deck list view: parity with flashcard view + per-deck metadata | NADAL AKTUALNY | `src/pages/decks/index.astro` pokazuje tylko nazwę talii + opcjonalny chip z liczbą kandydatów do przeglądu (`countCandidatesByDeck`, linia 18, 61–66). Brak liczby wszystkich fiszek, daty ostatniej nauki ani innych metadanych. |
| C10X-19 | Polish UI: finish copy translation (landing + sign-in/sign-up) | NADAL AKTUALNY | Landing (`src/components/Welcome.astro`) jest w pełni po polsku. Formularze auth nadal zawierają angielskie stringi: `src/components/auth/SignInForm.tsx:38,43,64,78,101` — `"Email is required"`, `"Password is required"`, `label="Email"`, `label="Password"`, `"Sign in"`. Analogicznie `SignUpForm.tsx`. |
| C10X-20 | Auth landing: inline sign-in/sign-up form below hero | NADAL AKTUALNY | `src/components/Welcome.astro` (renderowany przez `src/pages/index.astro`) — hero zawiera wyłącznie dwa linki `<a href="/auth/signin">` i `<a href="/auth/signup">`. Brak inline formularza auth. |
| C10X-21 | Full-height scrollbar + sticky header/footer (shell restructure) | ZROBIONE MIMOCHODEM | `src/layouts/AuthenticatedLayout.astro:20` — `flex h-screen flex-col overflow-hidden`; linia 43 — `custom-scrollbar h-full overflow-y-auto` (scrollowalny main); stały header linia 22, stały footer linia 55. Sticky toolbar wewnątrz widoku fiszek: `src/components/flashcards/FlashcardWorkspace.tsx:157`. |
| C10X-23 | Deck search UX improvements (deck-search-ux) | NADAL AKTUALNY | Infrastruktura DB dla keyword search istnieje (migracja `20260712162359_deck_keyword_search.sql`), ale w `src/pages/decks/index.astro` i `src/components/decks/` brak jakiegokolwiek pola wyszukiwania talii po stronie UI. |
| C10X-24 | AI generator UX improvements (ai-generator-ux) | ZROBIONE MIMOCHODEM | Live character counter: `src/components/generate/GeneratorForm.tsx:94` — `"Live character counter: muted normally, red once over the limit"`. Preview po zapisaniu: linia 391 — `"An immediate read-only preview of what was saved"`. (Model selection pozostaje konfiguracyjny przez `astro:env/server`, poza zakresem UI.) |
| C10X-25 | Generation hardening: write idempotency + rate limit on /api/generate | NADAL AKTUALNY | Idempotency **wdrożone**: `src/pages/api/generate.ts:103,243,246`, migracja `20260725133600_generation_idempotency_key.sql`. Rate limit na `/api/generate` **brak**: ani w `src/middleware.ts`, ani w `generate.ts` nie ma żadnego limitera — 429 w kodzie dotyczy wyłącznie GoTrue (`src/lib/auth-errors.ts`). Ticket otwarty dla drugiej połowy. |
| C10X-35 | Alerts + schedule for schema-diff | NADAL AKTUALNY | `.github/workflows/schema-diff.yml:25` — trigger wyłącznie `workflow_dispatch`. Linie 16–21 zawierają wprost: `"A nightly schedule: would pay a Docker run [...] for a signal with no consumer: this project has no notification channel [...] Adding schedule: is one line; do it the day a notification channel and an owner exist"`. |
| C10X-36 | Auth route input validation: server-side parity with the UI | NADAL AKTUALNY | `src/pages/api/auth/signin.ts:17` — `"No presence, format or length rule is added here; auth input validation is C10X-36's."` `src/pages/api/auth/signup.ts` analogicznie: surowe `email` i `password` przekazywane bez walidacji formatu/długości. |
| C10X-38 | Research: supplying secrets without pasting them into code (OPENROUTER_API_KEY) | ZROBIONE MIMOCHODEM | Wszystkie klucze produkcyjne (`OPENROUTER_API_KEY`, `SENTRY_DSN`, `SUPABASE_URL`, `SUPABASE_KEY`) zarządzane przez `wrangler secret put` + `astro:env/server`. Wzorzec opisany w `src/worker.ts:13–14`, używany w `src/lib/openrouter.ts:2`, `src/lib/config-status.ts:1,40`. |
| C10X-44 | Admin panel: configure generation languages without touching the database | NADAL AKTUALNY | Brak trasy `/admin` ani żadnego komponentu AdminPanel w `src/`. Infrastruktura DB istnieje (migracja `20260731120000_language_dictionary.sql`), ale `src/pages/api/generate.ts:66–68` odsyła do `follow-ups/admin-panel.md`. |

## Podsumowanie

| Werdykt | Liczba pozycji | Tickety |
|---------|---------------|---------|
| ZROBIONE MIMOCHODEM | 4 | C10X-15, C10X-21, C10X-24, C10X-38 |
| NADAL AKTUALNY | 11 | C10X-14, C10X-16, C10X-17, C10X-18, C10X-19, C10X-20, C10X-23, C10X-25, C10X-35, C10X-36, C10X-44 |
| ZDEZAKTUALIZOWANY | 0 | — |
| [nieznany] | 0 | — |

**Uwaga do C10X-25:** połowa zakresu (write idempotency) jest ZROBIONE MIMOCHODEM (wdrożona pod S-05/candidate-review), ale rate limiting na `/api/generate` pozostaje nieistniejący — ticket jest aktualny dla tej drugiej połowy.
