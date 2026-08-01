---
change_id: deck-error-param-guard
title: Audit and close the ?error= injection vector on the deck pages
status: archived
created: 2026-08-01
updated: 2026-08-01
archived_at: 2026-08-01T20:51:23Z
---

## Process deviation (recorded 2026-08-01, impl-review F7)

This change has **no `plan.md` and no `verification.md`**. It ran straight from `research.md` on an
explicit instruction, which is a deliberate departure from the `/10x-plan → /10x-implement →
/10x-impl-review` loop every other change in this repo followed — written down here so it is a dated
decision rather than something a later reader discovers from an empty folder. `research.md`'s
`## Outcome` table is the de-facto Changes Required and its `## Open Questions` the de-facto "What
We're NOT Doing"; `/10x-impl-review` was run against those.

The cost is specific and is not the missing plan: the Outcome table asserts "six breakage runs, six
verified restores" and gives one line each, so the observed failure strings, denominators and
restore hashes that this project's own test-plan §6.6 discipline calls for ("a split is a claim
about a run") exist nowhere in this folder. `reviews/impl-review.md` carries that level of evidence
for the review's own eight runs, and `test-plan.md`'s header entry now says so.

## Notes

Verify and, if gaps remain, close the ?error= content-injection vector on the three deck pages: a crafted link can render attacker-chosen text inside the app's own red ServerError banner (the class C10X-34 closed on the auth pages via ownedAuthMessage). Scope: the read side on decks/index.astro, decks/[publicId]/index.astro and decks/[publicId]/review.astro, plus the step the C10X-34 review never took — enumerate what the six formData() endpoints under src/pages/api/ actually put into ?error= and confirm it is a closed set of literals. Acceptance: membership by EQUALITY never containment, null (no banner) for anything unvouched, and a positive control over the WHOLE set. PRIOR STATE, verified 2026-08-01 and to be re-checked adversarially rather than trusted: this scope appears already shipped under C10X-37 (deck-form-hardening, archived at context/archive/2026-07-31-deck-form-hardening/) — src/lib/redirect-errors.ts carries 11 members plus ownedRedirectMessage, all three pages wrap their single read (six sinks), and 43 tests pass across redirect-errors, error-param-guard, no-client-redirect-errors, form-endpoint-guards and validation/decks. Treat this change as an audit of that claim first; implement only what the audit shows missing. (source: C10X-40)
