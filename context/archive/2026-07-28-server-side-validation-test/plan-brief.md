# Server-side validation parity for card content rules (Risk #6) — Plan Brief

> Full plan: `context/changes/server-side-validation-test/plan.md`
> Research: `context/changes/server-side-validation-test/research.md`

## What & Why

Card content rules (`FRONT_MAX` = 200, `BACK_MAX` = 1000) are enforced by the browser form and by
four lines in two endpoints — and by nothing else. Nobody has ever tested that the server refuses
on its own rather than assuming the form already filtered the input. This change proves it, and
adds a database backstop so the endpoint stops being the only enforcer. It is the last item
between `test-plan.md` §3 Phase 2 and status `complete`.

## Starting Point

The production validation logic is **already correct** — this is not a bug fix. What is missing is
evidence: `FRONT_MAX` appears in exactly one test file (and there it tests the LLM response
schema, not these endpoints), `BACK_MAX` in none. The database enforces only `char_length > 0`, a
decision recorded in `manual_card_source.sql:10` on 2026-07-10, whose residual risk S-02 named the
day before: *"an out-of-band writer could exceed them."* Research also found three unrelated
"server trusts the client" defects on the same four form endpoints.

## Desired End State

A crafted request breaching either bound — on create or on edit — is refused with a project-owned
redirect and provably writes nothing, with a boundary control at exactly the limit so the refusals
cannot be an endpoint refusing everything. The database refuses the same content independently.
Both facts are demonstrated by a **pair** of breakage runs rather than asserted. Malformed bodies
and `File` parts get controlled responses instead of framework `500`s.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Auth routes in scope? | **Out** — raised as C10X-36 | Our auth routes hold zero validation lines, so a test there could not be turned red by any `src/` edit; it would pin `supabase/config.toml` | Research |
| Where the tests live | New `tests/validation/cards.test.ts` | Keeps one claim per file — `tests/isolation/flashcards.test.ts` is the ownership file and stays that | Plan |
| DB CHECK on `front`/`back`? | **Yes** — `between 1 and N` | Same promotion `deck_session_size_check` got, for the same reason: the maximum lived only in app code | Plan |
| "Writes nothing" oracle | Raw row count by `deck_id` + column-for-column re-read | Status-agnostic **and** state-agnostic; `listFlashcards` filters `state_id = 2` and would hide a card written in another state | Plan |
| Breakage technique | Two runs: decouple the endpoint comparison, then drop the CHECK | One run alone cannot separate "the endpoint caught it" from "the database caught it" — the reason the second layer was added | Plan |
| Extra defects pulled in | `formData()` guard, `File` part, `IDS_MAX` case | All three are genuine crafted-request instances on the same endpoints | Plan |
| "4xx" wording | Corrected in all six places; archive gets a **dated correction**, not a rewrite | The card endpoints answer `302`; the archive records what was known then | Plan |

## Scope

**In scope:** a bounded DB CHECK on `flashcard.front`/`back`; `try/catch` around `formData()` and
string-only form reads on the four form endpoints; `tests/validation/cards.test.ts` (11 cases);
one `IDS_MAX` case in `candidates.test.ts`; two malformed-body cases in `auth/errors.test.ts`, so
no production file Phase 2 touches ships on manual verification alone; two breakage runs; doc-sync
closing §3 Phase 2.

**Out of scope:** auth input rules (C10X-36); re-testing `/cards/batch`'s already-covered bounds;
island (client-side) enforcement, unreachable by any layer in this suite; the generation write
path's own bounds; rewriting archived artifacts.

## Architecture / Approach

Bottom-up so every assertion has something to observe. The DB CHECK lands first (the independence
case asserts a `23514`, and breakage run 2 drops it); the endpoint hardening second (two cases
assert the controlled response it introduces); the tests third; the breakage pair fourth;
doc-sync last. Tests follow §6.4 unchanged — real endpoint via the Container API, real session
cookie, real local Postgres, assertions on rows read back as their owner.

The one design point that shapes every case: **a `302` refusal and a `302` success are the same
status**. The `error` message must be asserted by *equality*, because breakage run 1 makes the
endpoint fall into a different error branch that still returns `302` with an `error=` param — a
`toContain("error=")` assertion would stay green through it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. DB backstop | Migration promoting both checks to `between 1 and N` | Cloud rows must be verified before `db push`; `db push` must precede merge or the `drift` gate blocks deploy |
| 2. Endpoint hardening | Controlled response for malformed bodies and `File` parts | `[cardPublicId].ts` reads `formData()` before `errorUrl` exists, so the catch cannot use it |
| 3. Validation test | `tests/validation/cards.test.ts` + the `IDS_MAX` case | Boundary-control cases do write, so counts must be per-case deltas |
| 4. Breakage pair | Two runs proving each layer is independently observed | Re-adding a dropped CHECK fails on the row the run wrote — delete it first |
| 5. Doc sync | §3 Phase 2 → `complete`; new §6.10; "4xx"/"PATCH" corrected in six places | §2's row and §6.6's entry must be written to agree |

**Prerequisites:** local Supabase stack up (`npm run db:start`), `OPENROUTER_API_KEY` unset, cloud
credentials available for the Phase 1 row check, Docker for the `psql` breakage runs.

**Estimated effort:** ~2 sessions across 5 phases; Phases 1–2 are small, Phase 3 is the bulk,
Phase 4 is careful rather than long.

## Open Risks & Assumptions

- The cloud database is assumed to hold no over-length rows; measured locally (max 33 / 61 chars
  across 7121 cards) but **not yet on the cloud**. If it does, Phase 1 needs a repair step before
  the constraint can be added.
- The numeric bounds now live in two places — `src/lib/flashcards.ts` and the migration SQL. This
  is the same duplication `deck_session_size_check` carries and it cannot be single-sourced across
  the code/SQL boundary; it is mitigated by comments on both sides, not removed.
- The `File`-part and malformed-body fixes touch `signin.ts`/`signup.ts`, which we otherwise
  pushed to C10X-36. The boundary held: this adds malformed-body *handling*, never an input rule.
- `char_length` (code points) and JS `.length` (UTF-16 units) disagree on astral text. The CHECK is
  strictly looser so it adds no false refusals, but boundary strings must be built from ASCII.

## Success Criteria (Summary)

- A request that bypasses the form and breaches a bound is refused and leaves the database
  unchanged — with a boundary control proving the endpoint is not simply refusing everything.
- Each of the two enforcement layers is shown, by its own breakage run, to be doing work the other
  is not.
- `test-plan.md` §3 Phase 2 reads `complete` with a date, and its Risk #6 row states what is
  covered and what is not.
