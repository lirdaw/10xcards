<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Server-side validation parity for card content rules (Risk #6)

- **Plan**: `context/changes/server-side-validation-test/plan.md`
- **Scope**: Full plan — Phases 1–5 of 5 (all Progress boxes `[x]` except 5.6, correctly deferred to `/jira-finish-work`)
- **Date**: 2026-07-28
- **Verdict**: NEEDS ATTENTION → **RESOLVED after triage** (10 findings: 9 fixed, 1 fixed as docs
  with the code deferred to a follow-up; 0 skipped, 0 dismissed)
- **Findings**: 0 critical, 6 warnings, 4 observations
- **Suite after triage**: 193/193, 16 files → **207/207, 17 files**; lint 0, build 0,
  `git diff -- src/` free of every temporary probe (each restore `md5sum`-verified)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria — re-run against the current tree (`b2e009e`)

| Check | Result |
|---|---|
| `npm test` | **193 passed / 193, 16 files** — matches the claimed total |
| `npx vitest run tests/validation/cards.test.ts` | 12/12 — the denominator every breakage split is read against |
| `npx vitest run tests/auth/errors.test.ts tests/review/candidates.test.ts` | 56/56 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `npm run db:types` | no diff |
| `git diff -- src/ supabase/` | empty |
| `pg_get_constraintdef` | both constraints bounded under original names, neither `NOT VALID` |
| `grep -rn "4xx" context/foundation/` | every surviving hit is a JSON-endpoint use or a correction that must quote the word |

Three factual claims the docs make were checked independently rather than trusted, and all hold: no
`PATCH` handler exists on any deck endpoint; `maxLength` appears in `src/components/` only in
`GeneratorForm.tsx`; `BATCH_MAX = 100` really is a commented copy, not an import.

## Verified clean

- **The auth `catch` cannot mask a GoTrue failure.** The `try` block contains only
  `await context.request.formData()`; `createClient` and `signInWithPassword` sit outside it and the
  `authErrorMessage(error)` path is byte-identical to before.
- **`formString` changed no valid request.** For a genuine string part it is the identity function.
  It only narrows (File → `""`).
- **The migration cannot break the generation path.** `validate()` bounds every card in UTF-16 units
  and `char_length` ≤ `.length` always, so a sanitized card can never trip the new CHECK.
- **The migration is safe as written.** DROP + ADD sit inside one CLI-wrapped transaction under a
  single `ACCESS EXCLUSIVE` window, so no other session sees an unconstrained table; the absence of
  `NOT VALID` is correct here because it guarantees existing rows conform.
- **No ordering coupling in the new test file.** Every `it()` recomputes its own `before`, including
  inside the three-way loop; the three `describe`s use separate, distinctly-named decks.
- **No case measures the wrong guard.** Every case uses a real, owned deck, so deck resolution (which
  runs first) always succeeds and the length guard is what answers.
- **`change.md` carries `status: implemented`, not the plan's `complete`.** This is the
  implementation being right and the plan wrong — `complete` is not in the skill's allowed
  vocabulary and `/10x-archive` reads that field. Recorded at `verification.md:339-342`.

## Findings

### F1 — The same two defects remain live on two sibling form endpoints

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/decks/index.ts:22-23, src/pages/api/decks/[publicId].ts:31-32
- **Detail**: The plan's Current State Analysis says `formData()` is unguarded "in all four form
  endpoints". Enumerated against the tree, **six** endpoints under `src/pages/api/` read
  `formData()`, and the two this change did not touch still carry both defects verbatim:
  ```ts
  const form = await context.request.formData();                    // unguarded → uncontrolled 500
  const name = ((form.get("name") as string | null) ?? "").trim();  // File part → TypeError → 500
  ```
  These are deck create and deck rename — the same native-form class, the same crash `cards/index.ts:7-11`
  now documents, and `test-plan.md` §6.6 itself describes the family as "six protected `/api/*` routes …
  deck rename/delete, card create/edit/delete". Neither has a test. The enumeration was incomplete, not
  a scope decision: nothing in "What We're NOT Doing" excludes them.
- **Fix A ⭐ Recommended**: Raise a follow-up ticket for the two deck endpoints, and correct the
  "four form endpoints" claim in the plan and `verification.md` to "four of six, the deck pair
  deferred"
  - Strength: Keeps this change closed at the boundary it actually verified, and stops the next
    reader inferring from "four form endpoints" that the class is fully swept. The deck endpoints
    already have a 1–100 name rule and a DB CHECK (`init_core_schema.sql:45`), so the same
    pair-breakage design transfers directly and deserves its own slice rather than an untested
    tail-end edit.
  - Tradeoff: Two uncontrolled `500` paths stay in production until that ticket lands.
  - Confidence: HIGH — both defects confirmed by reading the current files, and the fix pattern is
    already written twice in this change.
  - Blind spot: Whether the deck endpoints' `?error=` round-trip has the same `errorUrl`-ordering
    constraint `[cardPublicId].ts` has; not checked.
  - **APPLIED 2026-07-28.** Corrections landed in `test-plan.md` (header + §6.6's C10X-30 entry,
    where the deck pair is now the first item of the "does NOT prove" list), `change.md` (a dated
    `[POPRAWKA]` marker on `### Wynik` item 2) and `verification.md` (a new "Impl-review —
    corrections to this record" section carrying the six-reader enumeration). `plan.md`,
    `plan-brief.md` and `research.md` deliberately keep the original wording — they record what
    was believed when the work was scoped. Follow-up queued in `follow-ups/review-fixes.md`.
- **Fix B**: Apply `formString` + the `try/catch` to both deck endpoints now, with tests
  - Strength: Closes the defect class in one pass while the pattern is fresh; the change's own
    thesis ("the server trusts the client") argues for it.
  - Tradeoff: Widens a change already widened twice by decision, and doing it without the matching
    row-oracle tests would ship exactly the assumed-not-asserted hardening plan-review F4 rejected.
  - Confidence: MED — the edit is mechanical, but the test work is not trivial.
  - Blind spot: Deck-name round-trip behaviour is pinned by S-02 tests not re-read here.
- **Decision**: FIXED via Fix A — doc corrections applied in three places; the code fix for the two
  deck endpoints is raised as **C10X-37** (`Zadanie`, MVP, component `decks`, parent C10X-10) and is
  not done here. Scope, definition of done and the breakage-pair design are in that ticket and in
  `follow-ups/review-fixes.md`.

### F2 — The database-layer assertion pins the SQLSTATE but not which constraint fired

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test Quality
- **Location**: tests/validation/cards.test.ts:430, :434
- **Detail**: Case 11 asserts only `expect(overFront.error?.code).toBe("23514")`. Its own comment
  claims it follows `deck_session_size_check` in `study.test.ts` — but that precedent asserts **both**,
  and says why: *"The constraint name is what pins WHICH guard refused it"* (`study.test.ts:713-717`).
  Without the name, the `back` half cannot distinguish `flashcard_back_check` from a
  `flashcard_front_check` widened to cover both columns. Layer attribution is the entire purpose of
  the breakage pair, so this is the one assertion where the omission costs most.
- **Fix**: Add `expect(overFront.error?.message).toContain("flashcard_front_check")` and the `back`
  equivalent, matching `study.test.ts:717`.
- **Decision**: FIXED — both constraint-name assertions added at `cards.test.ts:428-443`, with a
  comment stating that `23514` alone cannot tell the two constraints apart.

### F3 — `IDS_MAX`'s value is unasserted; only "some bound exists" is proven

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test Quality
- **Location**: tests/review/candidates.test.ts:335-353
- **Detail**: The new case sends 101 ids and asserts `400`. Its comment declines a 100-id control
  because "the block's existing successful cases already establish that a well-formed body is
  accepted" — but those cases send **1 or 2** ids (`:266`, `:295`, `:317`). Measured consequence:
  change `IDS_MAX` from `100` to `2` and this case passes, every earlier case passes, and the review
  island's `BATCH_MAX = 100` chunking — a **commented copy**, not an import, as the case's own comment
  stresses — starts sending bodies the server refuses, silently, in production. This is the one place
  the change drops its own discipline: `cards.test.ts` carries three boundary controls at exactly the
  limit for precisely this reason.
- **Fix**: Add a 100-distinct-id body asserted `200`, as the boundary control the file's own pattern
  calls for.
- **Decision**: FIXED — `"accepts a batch of exactly 100 ids"` added (one real card + 99 well-formed
  strangers, `changed`/`skipped` split asserted, plus a row oracle so a 200 that wrote nothing
  cannot satisfy it). **Falsifiability confirmed by a breakage run**: narrowing `IDS_MAX` to `2`
  turns exactly **1 of 22** red — the new control, on `expected 400 to be 200` — while the 101-id
  case stays green, which is precisely the blindness the control removes. `batch.ts` restored and
  verified by `md5sum` (`23d279f5…` both sides) and an empty `git diff`.

### F4 — Phase 2 hardened eight branches; six are asserted

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test Coverage
- **Location**: tests/validation/cards.test.ts:314, tests/auth/errors.test.ts:224-270
- **Detail**: Phase 2 added two new branches (malformed body, `File` part) to four endpoints. Tests
  reach six of the eight: `signup.ts` has **neither** branch asserted — no test imports that route
  module at all — and the card edit endpoint has the JSON-body case (`:387`) but no `File` case. This
  is the same argument plan-review F4 used to add the auth cases in the first place: *"in a change
  whose thesis is 'the server's refusal must be asserted, not assumed', that is the one place where
  it is assumed."* Risk today is low — each untested branch is a verbatim copy of a tested twin — but
  the copies can diverge.
- **Fix**: Add a `File`-part case on the edit endpoint and mirror the two `signin.ts` cases onto
  `signup.ts`; or extract `formString` (see F5) and unit-test it, which covers the narrowing half for
  all four at once.
- **Decision**: FIXED — all three done, and one of them found something. The edit-endpoint `File`
  case also sends a `File` `from` part, so it pins that a non-string cannot satisfy the
  `=== "review"` switch. The `signup.ts` pair is **not** a copy of signin's: probed directly against
  the local stack, GoTrue answers the same empty address differently on the two routes —
  `signup` → `{"error_code":"anonymous_provider_disabled", 422}` (it reads an empty address as an
  anonymous sign-in attempt), `token?grant_type=password` → `{"error_code":"validation_failed", 400}`.
  The first is not in the mapper's table, so signup lands on `AUTH_GENERIC_MESSAGE` — the catch-all.
  That is asserted by equality rather than smoothed over, so the day someone maps the code the test
  goes red and the improvement is noticed; whether it *should* be mapped is a question about
  `auth-errors.ts`'s table, not about malformed-body handling, and is left open. The no-leak half is
  asserted alongside it (GoTrue's wording never reaches the address bar).

### F5 — `formString` is duplicated verbatim in four files

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/decks/[publicId]/cards/index.ts:11, [cardPublicId].ts:10, src/pages/api/auth/signin.ts:8, signup.ts:6
- **Detail**: The identical one-line security helper is defined four times. This repo has an explicit,
  documented ethos against exactly this shape: `src/lib/generation-limits.ts` exists to end
  one-rule-two-definitions drift, `tests/fixtures/scoping.ts` was extracted for the same reason, and
  C10X-27 extracted `readJsonResponse` into `src/lib/http.ts` *specifically so the decision became
  testable*. This change's own migration header carries a "UWAGA — DUPLIKACJA STALEJ" warning about
  the same smell one layer down.
- **Fix**: Move it to `src/lib/forms.ts` (or beside `readJsonResponse` in `src/lib/http.ts`), import
  via `@/*`, and give it the unit test that closes half of F4.
- **Decision**: FIXED — extracted to `src/lib/forms.ts`, imported via `@/*` by all four endpoints,
  with `tests/lib/forms.test.ts` (5 cases): the identity half for genuine strings (the claim behind
  "no valid request changed behaviour"), the narrowing half with a positive control showing the raw
  `File` really would have thrown a `TypeError`, missing parts, the composed `.trim().length === 0`
  behaviour every caller relies on, and the `=== "review"` switch a non-string must not satisfy.

### F6 — This change made a comment in `auth-errors.ts` false

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/auth-errors.ts:104-106
- **Detail**: The comment reads *"Raised client-side when a field is empty — which is what an empty
  form field produces, since `form.get("email") as string` hands `""` straight to supabase-js."* That
  cast is exactly what Phase 2 deleted, so the comment now cites a construct that no longer exists.
  Worse, its causal claim is contradicted by this change's own measurement: `errors.test.ts:260-266`
  records that an empty email maps to `validation_failed` → `AUTH_VALIDATION_MESSAGE`, not to
  `AuthInvalidCredentialsError` → `AUTH_MISSING_CREDENTIALS_MESSAGE`. In a repo whose §8 tracks
  pointer rot as its own failure class, a comment invalidated by the commit that invalidated it
  should not ship.
- **Fix**: Rewrite the comment to describe when `AuthInvalidCredentialsError` actually arises, citing
  the measurement in `errors.test.ts` rather than the deleted cast.
- **Decision**: FIXED — rewritten to state that it is raised client-side by supabase-js, that an
  empty address does **not** land here, and where it lands instead on each route, with both probed
  responses quoted and dated. The old sentence is named as wrong rather than silently replaced, so
  nobody re-derives the empty-field story from it.

### F7 — The bare `catch` conflates a malformed body with a body-stream failure

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/decks/[publicId]/cards/index.ts:43-47, [cardPublicId].ts:34-39, src/pages/api/auth/signin.ts:16-20, signup.ts:11-15
- **Detail**: `formData()` rejects not only on "not a form" but on client abort mid-upload, a
  truncated body, and transport resets. All of them now return a benign `302` with validation copy.
  With a bare `catch {` (no binding) and the project-wide `console.*` ban enforced by
  `tests/lib/no-logging.test.ts`, this class has **zero observability**: no log, no metric, no
  distinguishing status. On the auth routes the copy actively misleads —
  *"Popraw dane w formularzu i spróbuj ponownie"* tells the user to fix input when the cause may be
  infrastructural. The comments claim the catch handles "a body that is not a form at all", which is
  narrower than what it catches. (Isolate OOM is not masked — that is not a catchable JS error in
  workerd.)
- **Fix A ⭐ Recommended**: Narrow the comments to state what is actually caught
  - Strength: Zero behavioural risk, and it removes the only genuinely inaccurate sentence in an
    otherwise scrupulously-commented change. The conflation is defensible — every one of these causes
    is "the request body did not arrive as a form", and the user's recourse is the same.
  - Tradeoff: Accepts that an infrastructural failure presents as a validation message.
  - Confidence: HIGH — the behaviour is settled; only the description is off.
  - Blind spot: How often stream failures actually occur here is unmeasured, so the cost of the
    conflation is unknown.
- **Fix B**: Bind the error and branch — parse failure vs everything else
  - Strength: Lets a transport failure carry its own copy, and stops a real outage reading as user error.
  - Tradeoff: Needs a new message in the closed set (which this change deliberately avoided growing),
    and the discriminator is not obviously stable across runtimes.
  - Confidence: LOW — no reliable, documented way to tell the two apart in workerd was established here.
  - Blind spot: Whether `TypeError` cleanly separates the cases on this runtime is untested.
- **Decision**: FIXED via Fix B — **and the blind spot fired, which changed the fix.** Probed
  against this runtime first: a non-form body throws `TypeError: Content-Type was not one of
  "multipart/form-data"…` and a form-typed-but-broken body throws `TypeError: Failed to parse body
  as FormData.` — the **same class**, so `e instanceof TypeError` separates nothing and Fix B as
  originally worded was not implementable. The discriminator is the **header** instead
  (`isFormContentType` in `src/lib/forms.ts`), which is where the runtime itself splits and is
  fetch-spec stable rather than dependent on message wording.
  Applied where it changes the answer — `signin.ts` / `signup.ts`, whose catch previously said
  "Popraw dane w formularzu" (a claim about the user's input) for a dropped upload; a form-typed
  failure now answers `AUTH_GENERIC_MESSAGE`, **already a closed-set member, so no new copy was
  introduced**. On the two card endpoints Fix B collapses to a no-op — their owned copy already
  reads "the operation failed", truthful for both causes — so a branch there would be unobservable
  code; those got Fix A's substance instead (comments narrowed to state both causes and why they
  deliberately share one message).
  Covered by 4 new unit cases on the discriminator (including the near-miss where a type merely
  *mentions* a form type, which a naive `includes` would let through) and one endpoint case;
  `tests/fixtures/endpoint.ts` gained an optional `headers` override, the only way to stage a
  body that claims to be a form and is not. **Falsifiability confirmed**: collapsing
  `isFormContentType` to `false` turns **3 of 47** red, the endpoint case on exactly the right
  pair (expected generic, received validation). `src/lib/forms.ts` restored, `md5sum` matching.

### F8 — The edit endpoint catches a malformed body before its auth check

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/pages/api/decks/[publicId]/cards/[cardPublicId].ts:34-39 vs :58-60
- **Detail**: In `cards/index.ts` the auth check is at `:32-34` and the catch at `:43-47`; in
  `[cardPublicId].ts` the order is reversed, so a signed-out caller reaching this handler gets the
  deck error redirect rather than `/auth/signin`. Moot in production — middleware guards `/api/decks`
  first — but the comment block at `:28-32` documents *one* asymmetry (the `errorUrl` fallback) at
  length while leaving this one unmentioned, which invites someone to "fix" the documented half and
  miss this.
- **Fix**: Add a sentence to the existing comment noting the auth-ordering asymmetry and that
  middleware makes it unobservable.
- **Decision**: FIXED — the comment block now names the ordering, says middleware makes it
  unobservable, and states that nobody chose it, so it is not read as deliberate. Code ordering
  left alone.

### F9 — The whole-batch failure consequence is recorded in the plan but not in the code

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/generations.ts:125-141
- **Detail**: The plan's Migration Notes record that `insertCandidates` is a single multi-row insert,
  so one over-length card now fails the **entire** generation rather than being dropped individually —
  "recorded rather than guarded against". That reasoning lives only in `plan.md`, which will be
  archived. The insert site itself says nothing, and `openrouter.ts`'s `candidateSchema` is now
  load-bearing for a failure mode it was not written for.
- **Fix**: One comment at the insert site naming the new CHECK and pointing at `validate()` as what
  keeps the batch safe.
- **Decision**: FIXED — comment added at `generations.ts:123-136`, naming the migration, the
  whole-batch consequence, `validate()` as the thing that keeps it unreachable, and the remedy if
  per-card tolerance is ever needed (insert per row, do not loosen the upstream schema).

### F10 — The two new auth cases spend real rate-limit budget and fail as a false regression

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test Quality
- **Location**: tests/auth/errors.test.ts:232, :249
- **Detail**: Each case performs a real sign-in round trip, taking the suite from 5 to 7 requests
  against `sign_in_sign_ups = 30` per 5 min per IP (`supabase/config.toml`), so iteration headroom
  drops from roughly 6 runs per window to 4. The failure mode is the problem, not the cost: when the
  limit bites, GoTrue returns `over_request_rate_limit` → `AUTH_RATE_LIMIT_MESSAGE`, both cases fail
  their `toBe(AUTH_VALIDATION_MESSAGE)` assertion, and the run **reads as a validation regression**.
  `tests/fixtures/accounts.ts:11-14` warns about exactly this class. Separately, `:266` couples to
  GoTrue's own mapping of an empty email to `validation_failed` — an upstream contract this repo does
  not own, so it can go red on a Supabase bump with no local change.
- **Fix**: Note both couplings in the file's comment, as this file already does elsewhere.
- **Decision**: FIXED — a two-part warning added above the malformed-body blocks: the shared
  budget with its failure mode spelled out ("if this file goes red on messages you did not touch,
  suspect the budget first") and the preference for cases that return before `createClient`, plus
  the upstream-coupling note. Worth recording that this review's own F4 fix **spent** more of that
  budget, which is why the warning is written for the next contributor rather than left implicit.

## Not raised, and why

- **Importing the card error messages into the test instead of rebuilding them** was considered and
  rejected. `errors.test.ts` imports `AUTH_VALIDATION_MESSAGE`, but doing the same in
  `cards.test.ts` would make the endpoint and its oracle move together — precisely the failure
  breakage run 1's own rule warns about ("never raise the shared constant, which the endpoint, three
  islands, `openrouter.ts` *and the test* all import"). The hand-built literal is the stronger oracle
  here; the numeric half is already single-sourced via `FRONT_MAX`.
- **Unbounded body buffering before the length rule** (`formData()` materialises the whole body
  before any bound is checked) is real but pre-existing and out of scope; `test-plan.md` §7 already
  parks the neighbouring concern as "Rate limiting on generation — no rate limit exists, so a test
  would require adding the safeguard first."
