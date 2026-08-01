---
change_id: deck-error-param-guard
title: Audit and close the ?error= injection vector on the deck pages
status: implementing
created: 2026-08-01
updated: 2026-08-01
archived_at: null
---

## Notes

Verify and, if gaps remain, close the ?error= content-injection vector on the three deck pages: a crafted link can render attacker-chosen text inside the app's own red ServerError banner (the class C10X-34 closed on the auth pages via ownedAuthMessage). Scope: the read side on decks/index.astro, decks/[publicId]/index.astro and decks/[publicId]/review.astro, plus the step the C10X-34 review never took — enumerate what the six formData() endpoints under src/pages/api/ actually put into ?error= and confirm it is a closed set of literals. Acceptance: membership by EQUALITY never containment, null (no banner) for anything unvouched, and a positive control over the WHOLE set. PRIOR STATE, verified 2026-08-01 and to be re-checked adversarially rather than trusted: this scope appears already shipped under C10X-37 (deck-form-hardening, archived at context/archive/2026-07-31-deck-form-hardening/) — src/lib/redirect-errors.ts carries 11 members plus ownedRedirectMessage, all three pages wrap their single read (six sinks), and 43 tests pass across redirect-errors, error-param-guard, no-client-redirect-errors, form-endpoint-guards and validation/decks. Treat this change as an audit of that claim first; implement only what the audit shows missing. (source: C10X-40)
