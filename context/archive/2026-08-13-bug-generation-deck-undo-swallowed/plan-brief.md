# Checked deck undo after a failed generation-session insert — Plan Brief

> Full plan: `context/changes/bug-generation-deck-undo-swallowed/plan.md`
> Research: `context/changes/bug-generation-deck-undo-swallowed/research.md`

## What & Why

`src/pages/api/generate.ts:596-598` discards the result of `deleteDeck` — the undo of a deck
this request created, run after the `generation_session` insert failed. When that undo fails
the deck survives as an empty orphan and nothing says so, so the next "Ponów" replays the same
payload, meets the orphan at `deckNameExists` and answers `409` with `retriable: false`. The
affordance is withdrawn on the second click and the copy blames the user's choice of name. This
change reads the result and names the failure.

## Starting Point

`deleteDeck` already ends `.select("public_id").maybeSingle()` (`src/lib/decks.ts:40-42`), so
the contract that makes a zero-row DELETE visible is in place — the missing half is the read at
the call site. The sibling branch one level down (`:628-632`) was fixed by C10X-48 and its
in-code comment names C10X-49 as owner of this one. `deleteDeck` has no caller anywhere in
`tests/`, and the branch itself is unreachable from the suite: the failure-path seam never
doubles the database, and no seedable row can collide at `:531`.

## Desired End State

A failed undo answers `500` with a distinct message saying the session could not be saved, that an
empty deck of that name **may** have been left behind (hedged because `deckUndone` is false on two
arms that disagree about whether the deck exists), and that it can be picked from the deck list
**after a page reload** or the name changed — carrying `retriable: false`, so the banner offers no
button and the copy is the
whole route out. A successful undo answers exactly as it does today. The orphan deck still
survives; what changes is that it is now nameable.

## Key Decisions Made

| Decision            | Choice                                                                      | Why (1 sentence)                                                                                                                                                                                                                                           | Source             |
| ------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Ambition            | Detection only                                                              | C10X-48's corrected D-01: hardening gives detection, not deletion — widening adoption re-opens a decision already weighed and declined, and a retry is correlated with its own cause.                                                                      | Plan               |
| Message             | Distinct literal naming the leftover deck, hedged, and instructing a reload | The user's real pain is the NEXT click, and with `retriable: false` the copy is the user's ONLY route out — so it must be true on both failing arms and must not name a deck that is absent from the selector until the page reloads (plan-review F2, F4). | Plan               |
| `retriable`         | Explicit `false`                                                            | "Ponów" replays the payload VERBATIM, and the orphan now makes that replay a deterministic 409 — the flag's documented job is marking what a repeat provably cannot fix, so the copy replaces the button (plan-review F1).                                 | Plan               |
| `:566` early return | Fix the comment, not the code                                               | The combination is ~unreachable, so it is a correctness-of-the-comment defect — and on the 200-replay arm the deck being deleted is the one the response hands back.                                                                                       | Plan               |
| Evidence            | Suite (helper) + one manual DCL run + browser                               | The endpoint branch is unreachable from any test; the helper's zero-row contract is untested and cheap to pin.                                                                                                                                             | Research §8 + Plan |
| Test home           | `tests/isolation/decks.test.ts`                                             | §6.2's one-file-per-resource rule; fixtures already there, and it sits beside the endpoint-level twin it complements.                                                                                                                                      | Plan               |
| `lessons.md`        | No new entry                                                                | `:243-248` already carries the rule and names this exact site; a duplicate weakens the original.                                                                                                                                                           | Plan               |
| Roadmap row         | Opened in Phase 1                                                           | Four changes have archived without a row (H-04, H-07, H-08, H-13); opening it first is free insurance.                                                                                                                                                     | Plan               |

## Scope

**In scope:** the checked undo and its new response at `generate.ts:596-599`; the C10X-49
handoff comment; the false claim about `:566`; one cross-account test on `deleteDeck`; one
recorded DCL run plus its control and a browser check; doc-sync across `test-plan.md`,
`roadmap.md` (H-17) and `change.md`.

**Out of scope:** deleting the orphan deck; widening deck adoption; retrying the delete; any
change to `src/lib/decks.ts`; the `:566` early return's code; the two failure-path
`createGenerationSession` inserts (C10X-50); a new `lessons.md` entry; any migration;
`jira-map.md`.

## Architecture / Approach

Mirror the sibling's shape rather than invent one: `let deckUndone = true` (an undo that never
ran has not failed), set to `!deleteError && deleted !== null` when it runs, gated before the
existing `return json(500, sessionFailure)`. Both arms are read because under RLS a zero-row
DELETE resolves `{data: null, error: null}` — though here the realistic failing arm is `error`,
the inverse of the sibling, since the deck was created by the same client one round-trip
earlier. The failed-undo message replaces `sessionFailure` wholesale, which costs nothing: the
variants carrying extra information are unreachable in combination with a deck this request
created.

## Phases at a Glance

| Phase                  | What it delivers                                   | Key risk                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Checked undo + copy | The fix, two comment corrections, roadmap row H-17 | Loosening the adoption gate by accident — `generate.test.ts:871` is the guard                                                                                                                                 |
| 2. Suite evidence      | Cross-account zero-row test on `deleteDeck`        | Proves the HELPER's contract, never the endpoint's use of it                                                                                                                                                  |
| 3. Reachability        | One DCL run + browser check + control              | One run, nothing repeats it; the browser check must precede any re-grant and the control needs a FRESH deck name, or run 1's orphan 409s it at the name pre-check; the restore must be proved, not remembered |
| 4. Doc-sync            | `test-plan.md`, roadmap detail, `change.md`        | Both C10X-49 mentions sit inside DATED entries — corrections, not rewrites                                                                                                                                    |

**Prerequisites:** local Supabase stack up (`npm run db:start`), `OPENROUTER_API_KEY` unset, and
psql access to the local stack for Phase 3.
**Estimated effort:** ~1-2 sessions; the code is ~6 lines and the cost is in Phases 3 and 4.

## Open Risks & Assumptions

- The `sessionFailure`-is-always-the-default argument is an **inference** from constraint-driven
  serialisation (research §4), not something a test pins. The fix handles all variants anyway,
  so nothing rests on it — but do not cite it as measured.
- The DCL run is a single recorded observation; nothing re-runs it, exactly as with C10X-48's.
- A breakage run that comes back green is a claim about the EDIT before it is a claim about the
  guard — C10X-48 hit that once in five runs.
- `ServerError` renders `items-center` with no `break-words`; the new literal is long, so how it
  wraps is an observation to record rather than an assumption.

## Success Criteria (Summary)

- A user whose deck undo failed is told, **on the first response**, that an empty deck was left
  behind and how to get past it — instead of a bare 500 followed, one click later, by a name-clash
  409 blaming their choice of name. The 409 is not removed; it is made unnecessary, because the
  button that walked into it is no longer offered and the copy names the two routes that work.
- A zero-row `deleteDeck` is provably visible to its caller, asserted on every `npm test`.
- The branch is shown to execute and return the new body once, on the record, with a control
  proving the ordinary message still answers when only the session insert fails.
