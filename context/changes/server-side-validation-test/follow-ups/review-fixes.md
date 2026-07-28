# Follow-ups from the implementation review (2026-07-28)

Source: `context/changes/server-side-validation-test/reviews/impl-review.md`.
Each item names the finding it came from and what was decided at triage.

## F1 — Harden the two deck-form endpoints (needs its own ticket)

**Status**: deferred by decision at triage. Docs corrected here; the code fix is NOT done.

`src/pages/api/` holds **six** `formData()` readers, not four. C10X-30 guarded four; these two
were missed and still carry both defects verbatim:

- `src/pages/api/decks/index.ts:22-23` — deck create
- `src/pages/api/decks/[publicId].ts:31-32` — deck rename

```ts
const form = await context.request.formData();                    // unguarded -> uncontrolled 500
const name = ((form.get("name") as string | null) ?? "").trim();  // File part -> TypeError -> 500
```

**Scope for the ticket**

1. Apply the same `try/catch` + string-only read C10X-30 applied to the four card/auth endpoints.
   If F5 is taken first, import the shared helper rather than adding a fifth and sixth copy.
2. Add the matching row-oracle tests, following `test-plan.md` §6.10 — these are redirect-style
   native-form targets, so a refusal and a success are both `302` and the row oracle is the only
   assertion. Deck name already has a 1–100 rule and a DB CHECK (`init_core_schema.sql:45`), so
   the **breakage pair** design transfers unchanged: decouple the endpoint comparison, then drop
   the CHECK on top.
3. Check whether the deck endpoints share `[cardPublicId].ts`'s `errorUrl`-ordering constraint
   (whether the error URL is built from form fields read by the same `formData()` call). Not
   verified during the review.

**Why not fixed at review time**: an untested hardening edit is exactly what plan-review F4
refused for the auth half of this change. These endpoints deserve the same row-oracle treatment,
which is slice-sized rather than a tail-end edit.
