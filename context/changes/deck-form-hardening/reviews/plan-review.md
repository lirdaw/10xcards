<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Deck Form Hardening

- **Plan**: `context/changes/deck-form-hardening/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-31
- **Verdict**: REVISE → **SOUND** after triage (all 6 findings fixed in plan, 2026-07-31)
- **Findings**: 1 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

20/20 paths ✓ (ServerError resolves to `src/components/auth/ServerError.tsx`; the plan cites it by
bare filename), 8/8 symbols ✓, 11/11 `?error=` producers enumerated ✓ (4+1+1+3+1+1 across the six
endpoints — the closed set is complete and no producer outside those six targets a deck page),
brief↔plan ✓, Progress↔Phase contract ✓ (one `## Progress` heading, six phases, 24 steps, titles
match the body, no stray checkboxes outside Progress).

Three Key Discoveries re-verified by measurement and all hold: no `errorUrl` ordering constraint on
either deck endpoint; the DB CHECK is the inline unnamed `check (char_length(name) between 1 and
100)` on `deck`, i.e. auto-named `deck_name_check`; `callEndpoint` labels a string body
`application/json` (`tests/fixtures/endpoint.ts:76-79`).

## Findings

### F1 — The two deck endpoints never take NAME_MIN/NAME_MAX

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 1 §4 (vs Desired End State, Key Discoveries, Phase 6 §1)
- **Detail**: Desired End State says "The 1–100 name rule has one definition"; Key Discoveries says
  "The name rule lives in six places". Phase 1 §4 ("The islands and the generation surface take the
  bound") lists four files — `CreateDeckModal`, `DeckActions`, `GeneratorForm`, `api/generate.ts` —
  and omits the other two of the six: `src/pages/api/decks/index.ts:25` and
  `src/pages/api/decks/[publicId].ts:34`, both verified to carry `name.length < 1 || name.length >
  100` verbatim. These are the endpoints the ticket is about. Phase 1 §3 does name all six endpoints
  but its contract is expressly about `?error=` literals ("No message text changes"). Three
  knock-ons: the stated end state is unmet; criterion 1.5's grep matches message strings only, so
  every success criterion passes while the goal is missed; and Phase 6 run 1 ("replace `> NAME_MAX`
  with a literal. **Never raise `NAME_MAX`**: after Phase 1 six sites and the test all import it")
  is inapplicable as written — the endpoint would still hold a literal, and raising the constant
  would move the islands and the test but not the endpoint.
- **Fix**: Add both deck endpoints to Phase 1 §4's Files and Contract (`name.length < NAME_MIN ||
  name.length > NAME_MAX`), and widen criterion 1.5's grep to the number as well as the message
  (e.g. `grep -rn "1 do 100\|length > 100" src/pages/api/decks/ src/components/decks/
  src/components/generate/`).
- **Decision**: FIXED — Phase 1 §4 retitled "All six sites take the bound" and both deck endpoints added to its Files/Contract; criterion 1.5 split into a message grep and a new number grep (Progress step 1.8).

### F2 — The `<ServerError>` swap silently drops the banner's `mb-4`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Current State Analysis + Phase 3 §2
- **Detail**: The plan states twice that the classes are "byte-identical to `ServerError.tsx:35`"
  and that "the visible delta is the added `CircleAlert` icon". Measured, they are not:
  `[publicId]/index.astro:150` carries `mb-4 flex items-center gap-2 rounded-lg border
  border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300`; `ServerError.tsx:35` carries the
  same list **without** `mb-4`, and the component accepts only `message` — no `className`. So the
  swap also removes the only spacing between the banner and `FlashcardWorkspace` below it. Manual
  criterion 3.8 asks for "banner, now with its icon", so it passes over the regression.
- **Fix**: Wrap the call — `<div class="mb-4"><ServerError message={bannerError} /></div>` — rather
  than adding a `className` prop to a component with twelve call sites, and correct both
  "byte-identical" sentences.
- **Decision**: FIXED — Phase 3 §2 now contracts `<div class="mb-4"><ServerError …/></div>` with the `{bannerError && …}` conditional kept (an unconditional wrapper would add the margin on error-free loads); both "byte-identical" sentences corrected; criterion 3.8 now checks the spacing against a before-screenshot.

### F3 — The signed-out row for `cards/[cardPublicId].ts` needs a real form body

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 5 §3 (+ Critical Implementation Details)
- **Detail**: Phase 5 §3 says "Each of the six asserts `302` with `Location` equal to
  `/auth/signin`. **No database.** Four of the six gate on `UUID_RE` first." That names one
  constraint and misses the one that bites. Five endpoints check `!locals.user` before touching the
  body; `cards/[cardPublicId].ts` does not — it reads `formData()` at `:41` and checks the user at
  `:64`, and its own comment at `:29-32` flags the ordering as "an ordering nobody chose". A
  signed-out call with no body, or with the string body `callEndpoint` labels `application/json`,
  lands in the catch at `:42` and answers `/decks/<id>?error=…&edit=<id>` — so that row fails for a
  reason unrelated to the claim it makes.
- **Fix**: Name the constraint in Phase 5 §3 — that one row must carry a real `FormData` body — and
  record the reason at the site (the endpoint's documented catch-before-user ordering), so the row
  is not "simplified" to match its five siblings later.
- **Decision**: FIXED — Phase 5 §3 now lists two preconditions, naming `cards/[cardPublicId].ts`'s catch-before-user ordering and the real `FormData` body its row requires; Critical Implementation Details carries the same fact.

### F4 — The row oracle does not exist for most of Phase 4's refusals

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1, "The count oracle"
- **Detail**: The oracle is "a raw count filtered by a per-case **name marker** with `.like()` —
  which works because the over-length name under test *is* the marker." That covers exactly two of
  the listed cases (over-max create, over-max rename). For missing / empty / whitespace-only `name`,
  the non-form body, the broken-form body and the `File` part there is **no name to carry a
  marker**, so a marker-scoped count reads 0 before and after whatever the endpoint does — an oracle
  that cannot go red, on precisely the cases where §6.10 and `lessons.md` ("Odmowa wyrażona
  redirectem potrzebuje orakla wierszowego") make the oracle *the* assertion. Same class as the
  `listDueCounts` false pass (§6.6 Phase 4) and C10X-28's status-filtered count, both of which this
  plan cites. The asymmetry that makes the fix cheap: **rename always has a real oracle**
  (`toEqual(before)` on the row, independent of what was submitted); only create is stranded, and
  there `deck_name_check` refuses an empty name regardless, so no endpoint-layer row oracle is even
  available.
- **Fix A ⭐ Recommended**: State the oracle per case-class in Phase 4 §1 — every nameless case gets
  its row oracle on the RENAME endpoint; the CREATE twins are declared as resting on status +
  decoded-message equality, with the reason written at the site.
  - Strength: Honest and matches the code; costs no new apparatus.
  - Tradeoff: Phase 6's pair attributes nothing on those two create cases, which must then be said
    in the does-NOT-prove list.
  - Confidence: HIGH — measured against the DDL (`check (char_length(name) between 1 and 100)`) and
    against `cards.test.ts`, which only had a count oracle because `deck_id` exists.
  - Blind spot: None significant.
- **Fix B**: Give create a delta oracle — count the account's own decks before and after inside each
  `it()`.
  - Strength: Uniform oracle across every case; no per-class prose.
  - Tradeoff: Account A is shared across FILES, and `generate.test.ts` (`newDeckName`) and
    `isolation/decks.test.ts` both create decks as A in parallel workers — so the delta is raceable,
    which is the flake class §6.2's shuffle work just finished paying off.
  - Confidence: MEDIUM — the race is structural, not measured here.
  - Blind spot: Whether Vitest's file-level parallelism actually overlaps those two files on this
    machine.
- **Decision**: FIXED via Fix A — Phase 4 §1's oracle section split into three case-classes (rename: row `toEqual(before)`, always available, so every nameless case is routed through rename too; create-with-a-name: marker-scoped count; create-with-no-name: no row oracle, resting on status + message equality, with the reason and the delta-count race written down). Carried into Phase 6's does-NOT-prove list.

### F5 — Renaming the page guard leaves three live pointers stale

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §2 + Phase 6 §3
- **Detail**: Phase 5 renames `tests/lib/auth-error-param-guard.test.ts` →
  `tests/lib/error-param-guard.test.ts`. Phase 6's doc-sync enumerates the test-plan edits (§6.6
  entry, §2, §6.10, §7, §8) but not the three live references to the old filename:
  `context/foundation/test-plan.md:1865`, `:2753`, `:2785`. Pointer rot is the failure this ledger
  has recorded twice (C10X-28's evidence paths, C10X-34's denominators).
- **Fix**: Add those three `test-plan.md` lines to Phase 6 §3's contract. The archived impl-review
  reference (`2026-07-30-auth-error-copy`) stays untouched, per this project's dated-correction
  precedent.
- **Decision**: FIXED — Phase 6 §3 now names test-plan.md:1865, :2753, :2785 as part of the rename, and states that the archived impl-review reference takes a dated correction line rather than a rewrite.

### F6 — The `role="alert"` gain is the weaker one on this surface

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §2 + manual criterion 3.9
- **Detail**: Phase 3 §2 says "the behavioural delta is `role="alert"`" and 3.9 asks for "announced
  by a screen reader / is exposed as an alert". `ServerError`'s own comment records that a live
  region present at MOUNT is not reliably announced, and that its real value is the ten DYNAMIC call
  sites. The page-level banner arrives via a full-page redirect — present at mount, exactly the weak
  case. 3.9's two halves are different claims and only the second is checkable here.
- **Fix**: Narrow 3.9 to "exposed as an alert in the accessibility tree" and say in Phase 3 §2 that
  announcement is not claimed on this surface, so `verification.md` cannot overclaim it.
- **Decision**: FIXED — Phase 3 §2 states that announcement is not claimed on this surface (node present at mount, per ServerError.tsx:12-19) and criterion 3.9 narrowed to the accessibility-tree claim.
