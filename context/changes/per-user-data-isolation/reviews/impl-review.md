<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Izolacja danych per-konto (RLS) + rdzenne tabele

- **Plan**: context/changes/per-user-data-isolation/plan.md
- **Scope**: Phase 3 of 3 (full plan — all phases complete)
- **Date**: 2026-07-05
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated success criteria (re-run)

- `npm run lint` — PASS (only non-error `astro-eslint-parser` projectService notices)
- `npx astro check` — PASS (0 errors, 0 warnings, 4 hints) — validates `createServerClient<Database>` generic
- `npm run build` — PASS (server built, Complete)
- `npx supabase db reset` / `npm run db:types` — not re-run (Docker-dependent); evidenced by committed generated `src/db/database.types.ts` (3 tables) and the applied-migration proof in `rls-verification.md`

## Findings

### F1 — Untracked scratch SQL left in working tree (`supabase/snippets/`)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/snippets/Untitled query 901.sql
- **Detail**: A Supabase Studio scratch query (`delete from deck ... 'hacked'`) from the manual RLS isolation testing remains untracked in the working tree. Harmless and not committed, but `supabase/snippets/` is a Studio-generated scratch dir that will keep accumulating noise in `git status`.
- **Fix**: Add `supabase/snippets/` (and `supabase/.temp/`) to `.gitignore`; delete the stray file.
- **Decision**: SKIPPED — user will handle at story close in a separate commit (.gitignore for `supabase/snippets/` + `supabase/.temp/`, and delete the stray file).

### F2 — Irreversible CASCADE chain on account/deck deletion (no soft-delete)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; already a conscious plan decision
- **Dimension**: Safety & Quality (Data safety)
- **Location**: supabase/migrations/20260705180246_init_core_schema.sql:44,60
- **Detail**: `auth.users → deck → flashcard` both use `ON DELETE CASCADE`. Deleting a user silently erases all their decks and cards with no recovery path. This is intended for F-01 (the plan's "What We're NOT Doing" explicitly defers trash/soft-delete to the `deck-flashcard-trash` follow-up story) and is consistent with the single-tenant PRD — flagged only for an explicit product-level sign-off, no code change required now.
- **Fix**: None for F-01 — confirm the deferral is intentional; soft-delete is already queued as a follow-up story.
- **Decision**: ACCEPTED — user signed off: hard CASCADE is intentional for F-01; soft-delete deferred to follow-up story `deck-flashcard-trash`.

## Notes on strengths

- All 6 planned files MATCH intent with zero drift, zero scope creep, zero missing items.
- All 9 RLS policies are scoped `TO authenticated`; `anon` is explicitly `REVOKE`d (correct — Supabase default privileges auto-grant new tables, so relying on default-deny would have been wrong); `auth.uid()` NULL handling denies safely.
- `flashcard` WITH CHECK mirrors the USING join predicate, blocking insert/move of cards into another user's deck.
- `rls-verification.md` is a rigorous proof: carries a passing positive control on both accounts (avoids the false-PASS trap), plus bonus coverage of anon lockdown, WITH CHECK rejection, silent cross-tenant UPDATE/DELETE no-op (with `RETURNING`-based proof), the `public_id` hidden-ID contract, and `flashcard_state` read-only.
