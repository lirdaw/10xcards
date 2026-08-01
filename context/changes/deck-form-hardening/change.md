---
change_id: deck-form-hardening
title: Harden formData() on the two deck endpoints C10X-30 missed
status: implementing
created: 2026-07-31
updated: 2026-08-01
archived_at: null
---

## Notes

Harden formData() reading on the two deck endpoints C10X-30's sweep missed — src/pages/api/decks/index.ts:22-23 (create) and src/pages/api/decks/[publicId].ts:31-32 (rename) — which still answer an uncontrolled 500 on a non-form body and crash on a File part hitting .trim(); import the existing formString helper from src/lib/forms.ts rather than adding a 5th/6th copy, decide whether these routes need signin/signup's two-reason split (they likely do not — their copy is "operation failed", true for both causes, so the branch would be dead code), and add row-based tests per test-plan.md §6.10 since a refusal and a success share the same 302 so the row oracle plus error-param equality is the only assertion; done when both endpoints answer their own redirect on a non-form body and on a File part (never 500), tests carry a boundary control, and a breakage PAIR separates the endpoint's 1-100 name rule from the DB CHECK in init_core_schema.sql:45; also verify whether errorUrl is built from fields read by the same formData() call (ordering constraint, unverified at review). (source: C10X-37)

## Scope extension, recorded at planning (2026-07-31)

This change ships a SECOND half under C10X-37's key, by an explicit scope decision taken at
scoping (build scope: maximum) and confirmed during planning — written down here so nobody
later finds a follow-up whose fix landed under a foreign key, which is the precise confusion
C10X-34 was written to untangle.

The second half is **C10X-34 impl-review F1**: the three deck pages read `?error=` raw into a
trust-carrying red banner, the same content-injection class the auth pages closed with
`ownedAuthMessage`. It ships under C10X-37's key — one change folder maps to one key in
`jira-map.md`, and splitting would leave one ticket's artifact fields empty. C10X-37's Jira
description is broader than its title as a result; the plan's Phase 6 carries a Jira comment
saying so.

### Correction, 2026-07-31 (found during Phase 6): that half is NOT unticketed

This section said the second half was "unticketed by design", citing
`context/archive/2026-07-30-auth-error-copy/follow-ups/review-fixes.md:8` — "to be ticketed via
/jira-backlog-sync. No key yet." **That line was true when the review wrote it and went stale the
same day**: `/jira-backlog-sync` created **C10X-40** ("Bramka `?error=` na stronach talii — strona
ODCZYTU") for exactly that finding, recorded at `context/foundation/jira-map.md:65` and
`:243-262` with its DoR fields set. The plan and this file were both written from the stale line;
neither the planning pass nor the plan review caught it, because both read the follow-up rather
than the map.

So the accurate record is: **the read-side work shipped here, under C10X-37, and C10X-40 is a key
whose work is already done.** Nothing about the scope decision changes — the code is one
mechanism and belongs in one change folder — but the reason for writing it down was to stop
someone finding a follow-up whose fix had landed under a foreign key, and leaving C10X-40 open in
the backlog would have produced precisely that, one level up.

**C10X-40 is to be closed against this change at `/jira-finish-work`** (linked to C10X-37,
pointing at this folder and its future archive path), together with setting C10X-37's own
`Change ID` field. Deliberately deferred rather than done here: `/10x-implement` writes no Jira,
and the skill that owns those writes is the one that carries the artifact fields with them.

Two questions research left open are answered by measurement rather than inference, and both are
in the plan's Key Discoveries: the `errorUrl` ordering constraint **does not exist** on either
deck endpoint, and the DB CHECK is named **`deck_name_check`** (read off the live local stack, not
inferred from the `flashcard_front_check` precedent).
