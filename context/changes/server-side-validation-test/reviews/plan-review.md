<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Server-side validation parity for card content rules (Risk #6)

- **Plan**: `context/changes/server-side-validation-test/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-28
- **Verdict**: REVISE → **SOUND after triage** (all 7 findings fixed in the plan, 2026-07-28)
- **Findings**: 1 critical, 5 warnings, 1 observation — 7 fixed, 0 skipped, 0 accepted, 0 dismissed

## Verdicts

| Dimension | Verdict | After fixes |
|-----------|---------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

Post-triage re-check: the `## Progress` contract still holds — 32 checkboxes against 32
success-criteria bullets across 5 phases, no stray checkbox outside the Progress section.

## Grounding

11/11 paths ✓ (both card endpoints, both auth endpoints, `batch.ts`, `flashcards.ts`,
`auth-errors.ts`, `endpoint.ts`, `scoping.ts`, `candidates.test.ts`, `init_core_schema.sql`),
6/7 symbols ✓ (`FRONT_MAX`/`BACK_MAX` at `flashcards.ts:61-62`, `IDS_MAX` at `batch.ts:24,31`,
`AUTH_VALIDATION_MESSAGE` at `auth-errors.ts:55,78`, the two `char_length(x) > 0` CHECKs at
`init_core_schema.sql:62-63`, `formData()` unguarded at `cards/index.ts:30` and
`[cardPublicId].ts:23`) — one wrong line citation, see F5. brief↔plan ✓.
`## Progress` contract ✓: one heading, 5 phases matched by name, all 19 success-criteria bullets
mapped, no stray checkboxes in phase blocks. `docs/reference/contract-surfaces.md` absent — check
skipped.

## Findings

### F1 — Criterion 4.2 is unobservable as worded: run 2 aborts on run 1's assertion

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §2 + criterion 4.2; Phase 3 case 1
- **Detail**: Run 2 keeps run 1's edit (`> FRONT_MAX` → `> 100000`) AND drops
  `flashcard_front_check`. Case 1 then fails on BOTH the message equality and the count — but
  Vitest aborts an `it()` at the first failed `expect`. If case 1 asserts the message before the
  count (the natural reading of the plan's case table, which lists Location/error first and "card
  count unchanged" last), run 2 produces the SAME failure string as run 1 and the count assertion
  is never reached. Criterion 4.2 ("Run 2 additionally produces the predicted red on the count
  assertion") cannot then be satisfied, and the whole point of the pair — separating "the endpoint
  caught it" from "the database caught it" — is not demonstrated. Same class as C10X-29's
  criterion 4.4 (§8: "does not go red as worded").
- **Fix A ⭐ Recommended**: Pin assertion order — count delta FIRST in every over-max case
  - Strength: Gives the pair two distinguishable failure strings for free: run 1 → red on the
    message (count already passed, proving the DB caught the write); run 2 → red on the count. No
    extra cases, no extra runs.
  - Tradeoff: The ordering becomes load-bearing and must be stated in the file (a later
    contributor "tidying" it would silently undo the breakage pair).
  - Confidence: HIGH — verified against the endpoint code: with `> 100000` the insert reaches the
    CHECK and the handler falls into its existing `if (error)` branch, so the 302 + `error=` shape
    is unchanged and only the message differs.
  - Blind spot: Case 8 (no-echo) has the same collision and needs the same treatment or an
    explicit "expected red in both runs" note.
- **Fix B**: Split case 1 into two `it()`s — one asserting the refusal, one asserting the count
  - Strength: Order-independent; each claim fails on its own regardless of how the file is later
    edited.
  - Tradeoff: Two requests instead of one per bound (4 extra endpoint calls across cases 1/2/6),
    and the count case must re-derive its own before/after delta.
  - Confidence: HIGH — mechanically guaranteed.
  - Blind spot: Doubles the create-path calls in a file that already seeds two decks in
    `beforeAll`; runtime cost unmeasured.
- **Decision**: FIXED via Fix A — Critical Implementation Details gained an "assertion ORDER is
  load-bearing" paragraph; Phase 3 cases 1, 2 and 6 now assert the row oracle first; Phase 4 §1/§2
  and criterion 4.2 (plus Progress 4.2) reworded so the pair is judged on two *different* failure
  strings rather than on "an additional red".

### F2 — Both breakage runs' predicted red sets are understated

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1 and §2; criteria 4.1, 4.2
- **Detail**: Run 1 predicts one red ("the over-max create case"). Case 8 (no-echo) also sends an
  over-max `front` on create and asserts the decoded error "is one of the two project literals" —
  under run 1 that becomes "Nie udało się utworzyć fiszki", so case 8 goes red too. Predicted red
  is {case 1, case 8}. Run 2 predicts "the count assertion additionally". Case 11 (layer
  independence) asserts a direct insert of a 201-character front fails with `23514` — with
  `flashcard_front_check` dropped that insert SUCCEEDS, so case 11 is red as well, and it is the
  case that most directly observes the dropped constraint. test-plan.md §8 already records one
  instance of "the plan predicted 1 red, it turns 2" as a finding worth carrying.
- **Fix**: State both predictions as explicit SETS in Phase 4 — run 1 → {1, 8}, run 2 → {1 (on the
  count), 8, 11} — and say why the others stay green (run 1 touches only `front` on create, so
  cases 2/6 are untouched; run 2 drops only `flashcard_front_check`). Keep "record what is
  observed, not what was predicted" as the standing instruction.
- **Decision**: FIXED — Phase 4 §1 and §2 now carry explicit predicted red SETS with the reason
  each remaining case stays green; criteria 4.1/4.2 and Progress 4.1/4.2 restate them, and §1 keeps
  "record what was observed, do not round it to the prediction".

### F3 — `flashcard_back_check`'s new upper bound is asserted nowhere

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 1 (migration), Phase 3 case 11, Phase 4 §2, criterion 4.4
- **Detail**: Phase 1 promotes BOTH checks to bounded ranges, but case 11 exercises only `front`
  (201 chars → `23514`) and run 2 drops only `flashcard_front_check`. Criterion 4.4 says the
  `pg_get_constraintdef` diff is empty "for both constraints" — trivially true for `back`, which is
  never touched. Half of the phase's production change therefore ships with no assertion and no
  falsifiability: reverting `between 1 and 1000` to `> 0` in the migration would leave the suite
  fully green.
- **Fix**: Extend case 11 with a `back` sub-case (`BACK_MAX + 1` → `23514`) inside the same `it()`,
  and note in Phase 4 that run 2 deliberately drops only the front constraint because case 11's
  back sub-case is what observes the other one.
- **Decision**: FIXED — case 11 now carries a `back` sub-case (`BACK_MAX + 1` → `23514`) in the
  same `it()`, and Phase 4 §2 states that run 2 drops only the front constraint so the two
  constraints are never both unobserved at once.

### F4 — Phase 2 hardens `signin.ts`/`signup.ts` with manual verification only

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §3; Phase 3 cases 9–10; criteria 2.1–2.6
- **Detail**: Phase 2 changes four production files. Cases 9 and 10 cover the card endpoint's two
  new branches; the identical branches in `signin.ts` and `signup.ts` get browser checks 2.5/2.6
  only, and neither breakage run touches them. In a change whose thesis is "the server's refusal
  must be asserted, not assumed", that is the one place where it is assumed. It is cheap to close:
  `callEndpoint` already sets `Content-Type: application/json` for a string body
  (`endpoint.ts:68-70`), `tests/auth/errors.test.ts` already drives an auth endpoint and asserts
  the `?error=` param against a project constant, and `AUTH_VALIDATION_MESSAGE` is already in the
  closed set (`auth-errors.ts:55,78`).
- **Fix A ⭐ Recommended**: Add two cases to `tests/auth/errors.test.ts` (malformed body, `File`
  part) asserting the redirect target and the closed-set message
  - Strength: Closes the gap where the plan already put the auth assertion, with zero new
    apparatus; keeps Phase 2's four files symmetrically covered.
  - Tradeoff: Grows a file the plan intended to leave alone; the auth boundary vs C10X-36 must be
    restated in that file's comment so a later reader does not think input rules landed here.
  - Confidence: HIGH — every piece the case needs was verified present.
  - Blind spot: The `File`-part case issues a real `signInWithPassword("")`; interaction with the
    run's shared auth rate-limit budget is unmeasured.
- **Fix B**: Move the auth half of Phase 2 to C10X-36
  - Strength: Restores a clean scope line — this change touches only the card endpoints, and the
    auth hardening lands with the ticket that owns auth input handling.
  - Tradeoff: Leaves two known uncontrolled `500` paths in production for a Post-MVP ticket; the
    plan's own argument (this is malformed-body handling, not an input rule) says they do not
    belong there.
  - Confidence: MED — depends on how soon C10X-36 is scheduled.
  - Blind spot: Whether C10X-36's scope note would actually pick these up.
- **Decision**: FIXED via Fix A — Phase 3 gained a third sub-section (two `it()`s in
  `tests/auth/errors.test.ts`: string body and `File` email part, each asserting the `302` to
  `/auth/signin` with `error` equal to `AUTH_VALIDATION_MESSAGE`), plus criteria 3.5 and 3.8 and
  a comment pinning the C10X-36 boundary. Testing Strategy and the brief's Scope updated.

### F5 — The oracle warning names the wrong function; `countFlashcards` is the real trap

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis (last bullet); Phase 3 §1 `countCards`
- **Detail**: The plan warns "`listFlashcards` must not be the oracle — it filters
  `state_id = STATE_ACCEPTED` (`flashcards.ts:170-172`)". The filter is at `flashcards.ts:76-83`,
  and `:170-172` is a DIFFERENT function — `countFlashcards`, which also filters `STATE_ACCEPTED`
  (`:167-173`). An implementer told "I need a count oracle" reaches for `countFlashcards`, not
  `listFlashcards`, so the warning points away from the function that would actually produce the
  false green. §8 records pointer rot as its own failure class.
- **Fix**: Name `countFlashcards` (`src/lib/flashcards.ts:167-173`) as the primary trap, keep
  `listFlashcards` as the secondary one, and correct its citation to `:76-83`.
- **Decision**: FIXED — both the Current State bullet and Phase 3's `countCards` contract now name
  `countFlashcards` as the trap the need points straight at, with `listFlashcards` secondary and
  both citations corrected.

### F6 — Criterion 5.3's grep matches this change's own folder

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5, criterion 5.3 / Progress 5.3
- **Detail**: Measured now: `grep -rn "4xx" context/foundation/ context/changes/` returns 16 hits,
  13 of them inside `context/changes/server-side-validation-test/` (plan.md ×7, research.md ×4,
  plan-brief.md ×1, change.md ×1) — meta-discussion ABOUT the wrong wording, which must survive.
  Two of the three remaining hits are the lines Phase 5 rewrites, and the plan's own rewrite keeps
  the word ("a `4xx` on the JSON endpoints"). The criterion "returns only the JSON-endpoint uses"
  is therefore not satisfiable as written and will be ticked by judgement, not by the command.
- **Fix**: Scope the command — `grep -rn "4xx" context/foundation/
  --exclude-dir=server-side-validation-test` — and reword the criterion to "every remaining hit in
  `context/foundation/` is a JSON-endpoint use", with `change.md:41` handled explicitly by
  Phase 5 §2.
- **Decision**: FIXED — criterion 5.3 and Progress 5.3 now scope the grep to `context/foundation/`
  and state why this change's own folder is deliberately excluded.

### F7 — No repair step if the cloud holds violating rows

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 criterion 1.5; brief "Open Risks"
- **Detail**: The brief says "if it does, Phase 1 needs a repair step before the constraint can be
  added" — but no such step exists in the plan, and the discovery point is `/ship`, after the
  branch is otherwise done and with the `drift` gate blocking the merge until `db push` succeeds.
  Low likelihood (both write paths already enforce the same constants; local max is 33/61 over
  7121 rows), hence an observation — but "stop and decide" is worth writing down, since the
  alternative is deciding it under a blocked deploy.
- **Fix**: Add one line to Phase 1's Implementation Note — if either cloud count is non-zero, STOP
  and pick between truncating the offending rows and loosening the bound; do not let `/ship`
  improvise it.
- **Decision**: FIXED — Phase 1's Implementation Note now carries the stop-and-decide paragraph
  with both options named and the likelihood stated.
