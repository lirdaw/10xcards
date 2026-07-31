# Follow-ups from `/10x-impl-review` — auth-error-copy (C10X-34), 2026-07-31

Queued here rather than fixed in this change. Each carries what the review established and,
explicitly, what it did **not** — so the ticket starts from evidence, not from this summary.

## F1 — close the `?error=` channel's read side on the deck surface

- **Status**: to be ticketed via `/jira-backlog-sync`. No key yet.
- **Where**: `src/pages/decks/index.astro:22`, `src/pages/decks/[publicId]/index.astro:86`,
  `src/pages/decks/[publicId]/review.astro:115`.
- **What**: all three read `Astro.url.searchParams.get("error")` raw and pass it as `serverError`
  into an island that renders it through the same `ServerError` red banner
  (`decks/index.astro:34` → `CreateDeckModal.tsx:80`). This is the identical content-injection
  class C10X-34 closed on the two auth pages — not XSS (React escapes), but attacker-chosen text
  carrying the app's own authority.
- **Severity qualifier, do not drop it**: these routes are behind `PROTECTED_ROUTES`, so the victim
  must already be signed in. That lowers the severity; it does not remove it.
- **Shape of the fix**: an `ownedAuthMessage`-shaped helper (`src/lib/auth-errors.ts:117-120`)
  living beside the deck-side constant set — membership by **equality**, never containment, `null`
  on anything else so an unvouchable value degrades to *no banner*. Tests: member verbatim, a
  crafted non-member, `null`/`""`, and a positive control over the **whole** set — without that
  control `() => null` satisfies every rejection case and reads as perfect protection.
- **First step, and it is NOT established by the review**: enumerate what the six `formData()`
  endpoints under `src/pages/api/` actually put in `?error=` and confirm it is a closed set of
  module-level literals. If it is not, the fix is that first.
- **Recorded in**: `context/foundation/test-plan.md` §6.6, C10X-34 entry, does-NOT-prove list.
