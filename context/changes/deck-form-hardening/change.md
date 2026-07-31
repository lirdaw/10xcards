---
change_id: deck-form-hardening
title: Harden formData() on the two deck endpoints C10X-30 missed
status: plan_reviewed
created: 2026-07-31
updated: 2026-07-31
archived_at: null
---

## Notes

Harden formData() reading on the two deck endpoints C10X-30's sweep missed — src/pages/api/decks/index.ts:22-23 (create) and src/pages/api/decks/[publicId].ts:31-32 (rename) — which still answer an uncontrolled 500 on a non-form body and crash on a File part hitting .trim(); import the existing formString helper from src/lib/forms.ts rather than adding a 5th/6th copy, decide whether these routes need signin/signup's two-reason split (they likely do not — their copy is "operation failed", true for both causes, so the branch would be dead code), and add row-based tests per test-plan.md §6.10 since a refusal and a success share the same 302 so the row oracle plus error-param equality is the only assertion; done when both endpoints answer their own redirect on a non-form body and on a File part (never 500), tests carry a boundary control, and a breakage PAIR separates the endpoint's 1-100 name rule from the DB CHECK in init_core_schema.sql:45; also verify whether errorUrl is built from fields read by the same formData() call (ordering constraint, unverified at review). (source: C10X-37)

## Scope extension, recorded at planning (2026-07-31)

This change ships a SECOND half under C10X-37's key, by an explicit scope decision taken at
scoping (build scope: maximum) and confirmed during planning — written down here so nobody
later finds a follow-up whose fix landed under a foreign key, which is the precise confusion
C10X-34 was written to untangle.

The second half is **C10X-34 impl-review F1**, unticketed by design
(`context/archive/2026-07-30-auth-error-copy/follow-ups/review-fixes.md:8` — "to be ticketed via
/jira-backlog-sync. No key yet."): the three deck pages read `?error=` raw into a trust-carrying
red banner, the same content-injection class the auth pages closed with `ownedAuthMessage`. It
gets no separate key — one change folder maps to one key in `jira-map.md`, and splitting would
leave one ticket's artifact fields empty. C10X-37's Jira description is broader than its title as
a result; the plan's Phase 6 carries a Jira comment saying so.

Two questions research left open are answered by measurement rather than inference, and both are
in the plan's Key Discoveries: the `errorUrl` ordering constraint **does not exist** on either
deck endpoint, and the DB CHECK is named **`deck_name_check`** (read off the live local stack, not
inferred from the `flashcard_front_check` precedent).
