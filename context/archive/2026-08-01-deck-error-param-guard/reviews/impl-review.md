<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Audit and close the `?error=` injection vector on the deck pages

- **Plan**: none — this change has **no `plan.md`**. Reviewed against `context/changes/deck-error-param-guard/research.md` §"Outcome — what was executed from this research" (the de-facto Changes Required) plus `change.md`'s acceptance criteria, with `## Open Questions` as the de-facto "What We're NOT Doing". See F7.
- **Scope**: whole change (5 commits, `main..HEAD`, 11 files)
- **Date**: 2026-08-01
- **Verdict**: NEEDS ATTENTION → **all 10 findings fixed in-session** (see Triage outcome below)
- **Findings**: 0 critical, 6 warnings, 4 observations

## Triage outcome (2026-08-01, same session)

All ten were fixed; none skipped, none accepted-as-is. Gates after the last fix: **345/345, 30
files** (342 at review time; +1 the `?q=` surrogate case, +2 the new `searchQuery` call-site guard),
`tsc` 0, `lint` 0 errors (the same 6 pre-existing `evals/` warnings), `build` 0, and
`git diff -- src/` limited to the two files F4 intended.

Eight breakage runs backed the fixes, each restored and verified:

| Finding | Breakage | Result |
|---|---|---|
| F1 | relay `error.message` through the shipped ternary at `decks/[publicId].ts:75` | pre-fix guard **10/10 green**, fixed guard **1/10 red** — the pair |
| F2 | loop reverted to `declarations.slice(0, 1)` | **1 of 10 red** |
| F3 | inner call's argument list wrapped across lines | **1 of 10 red** (`expected 28 … ≥ 29`); old floor of 25 passed it |
| F4 | surrogate trim removed | **1 of 6 red** |
| F4 | "always drop the last unit" mutant | **4 of 6 red** |
| F5 | raw `.get("error")` planted in `FlashcardWorkspace.tsx` | pre-fix guard **11/11 green**, widened guard **1/11 red** — the pair |
| F8 | `slice(-QUERY_MAX)` keep-the-tail mutant | **2 of 6 red** (survived all 4 cases before) |
| F10 | `[publicId]/index.astro:42` reverted to the inline `.trim()` | **1 of 13 red** |

Two corrections to this report's own findings, both made by running the breakage rather than by
reasoning, and both recorded at the finding rather than silently amended: **F3's reachability was
overstated** (Prettier wraps the outer call first, which stays matchable — the blind shape needs the
inner argument list to wrap), and **F4's proposed fix was wrong** (code-point slicing is rejected by
`@typescript-eslint/no-misused-spread`, whose objection — that code points still split ZWJ
sequences — is correct; the shipped fix drops the half-cut character instead).

One breakage attempt came back green and the cause was the **edit**, not the guard: the first
receiver-rename probe targeted `const form = await …` while the file declares `let form;` and
assigns on a bare line. Re-run correctly, it goes red. Recorded because it is this change's own
lesson applied to its review.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria — re-run against these files

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 — 6 pre-existing `no-console` warnings in `evals/`, unchanged |
| `npm test` | **342 passed / 342, 30 files**, exit 0, fresh seed `1785613765106` |
| `npm run build` | exit 0 |

Every figure the research doc records is reproduced exactly, including the suite count. The six
breakage runs it claims were **not** re-executed here (they mutate `src/`); four of them were
instead re-derived by replaying the guards' own predicates against adversarial inputs — which is
what produced F1–F3 and F8.

## What holds up

The security property the ticket exists to establish is intact and was re-verified, not taken on
the record. `?q=` has exactly **one** reader in `src/` and it is clamped; the clamped value is what
reaches **both** sinks (the `search_flashcards_in_deck` RPC at `[publicId]/index.astro:56` and the
island at `:177`), and no component re-reads `q` from `location`. The producer walker really does
close `INLINE_ERROR_LITERAL`'s blind spot — it reaches **29 emission sites across 6 files** where
the old detector inspected 9. The read-side widenings (G3/G4/G5/G6/G8) are all genuine construct
fixes, and G5 got its own control, which is more than research asked for. `change.md`'s three
acceptance criteria (equality never containment, `null` → no banner, whole-set positive control)
are satisfied by pre-existing untouched code — correct, since the audit's job there was to verify.

## Findings

### F1 — Producer guard still admits an upstream string through a compound local

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Plan Adherence
- **Location**: tests/lib/form-endpoint-guards.test.ts:288-292
- **Detail**: The identifier check is a construct check; the local-declaration check is not. It
  accepts any local whose declaration (a) has no string literal in *value* position and (b) merely
  **mentions** an owned name anywhere. Confirmed by executing the file's own `rejection()`,
  `valuePositionLiterals()` and `localDeclaration()` verbatim:

  | local declaration | verdict |
  |---|---|
  | `const msg = err.message;` | rejected ✔ (the shape the test asserts) |
  | `const msg = error.code === "23505" ? DECK_NAME_TAKEN_MESSAGE : err.message;` | **ACCEPTED** |
  | `const msg = err.message \|\| CARD_SAVE_FAILED_MESSAGE;` | **ACCEPTED** |
  | `const msg = CARD_SAVE_FAILED_MESSAGE + String(err);` | **ACCEPTED** |

  So `err.message` can reach `?error=` with all 342 tests green. Not a live hole — the only two
  locals today (`decks/index.ts:73`, `[cardPublicId].ts:50`) are clean — but the ternary shape is
  *already how `decks/index.ts:73` is written*, so "add a fallback to the other branch" is the
  natural next edit. Both recorded falsification runs passed the bad value **directly**
  (`errorUrl(String(err))`), so this path was never exercised. This is the same
  "correct on what it looks at, silent about what it never looks at" shape the change exists to
  eliminate, and the docblock at `:248-250` plus `test-plan.md`'s new entry ("demands POSITIVE
  evidence that it is a set member") both read stronger than the code.
- **Fix**: After confirming an owned name is present, require the remainder to be inert — strip the
  owned identifiers out of the declaration and reject if what is left still contains `.` or `(`
  (member access / call). Add the three accepted shapes above to the
  `rejects a literal, an upstream string…` case so the tightening is falsifiable, and soften the
  docblock + `test-plan.md` sentence to what the code actually enforces.
  - Strength: Keeps the "positive evidence" design; closes the leak half (Risk #4) the case claims.
  - Tradeoff: A future legitimate local doing `OWNED.replace(...)` would need an allowance.
  - Confidence: HIGH — reproduced by running the file's own predicates.
  - Blind spot: Have not checked whether any *auth* route local would trip the tightened rule.
- **Decision**: FIXED. `computedResidue` + `COMPARISON`/`INERT_WRAPPER` added; the residue after
  striking out set members must be inert (no `.`, no `(`). Three smuggling shapes added to the
  falsification case; docblock and `test-plan.md:98` corrected as dated corrections rather than
  rewrites. **Falsified as a PAIR on a real endpoint**: relaying `error.message` through the shipped
  ternary at `decks/[publicId].ts:75` leaves the pre-fix guard **10/10 green** and turns the fixed
  one **1 of 10 red** (`[publicId].ts:76: local \`msg\` mixes the closed set with a computed
  value: …`), other 9 green. `src/` restored, md5 `cd4b23f57ed4d9d0090365cbe1f57b18` verified,
  `git diff -- src/` empty. Suite 342/342, tsc 0. The comparison is stripped FIRST — without that
  ordering the check rejects both locals this repo ships, which is why the fix is larger than the
  report proposed.

### F2 — `localDeclaration` resolves the first `const <name>` in the whole file, ignoring scope

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/lib/form-endpoint-guards.test.ts:270-273
- **Detail**: Confirmed by execution — for a source declaring `const msg = CARD_SAVE_FAILED_MESSAGE;`
  at top level and `const msg = err.message;` inside a second exported handler, `rejection("msg", …)`
  returns `null`: the guard inspected the **first** declaration and never saw the leaking one. The
  deck-card endpoints already export more than one handler, so a second same-named local is an
  ordinary edit. The regex also runs over the raw source rather than `codeLines(file)`, so a
  `const msg = "…"` inside a comment is a candidate declaration.
- **Fix**: Collect *all* matches for the name and reject if **any** fails; run the scan over
  `codeLines(file)` rather than the raw source.
- **Decision**: FIXED. `localDeclaration` → `localDeclarations` (all matches, comment lines dropped);
  `rejection` loops over every declaration. A shadowed-redeclaration case added to the fixture.
  Falsified: reverting the loop to `declarations.slice(0, 1)` — the old behaviour — turns **1 of 10
  red**; restored, md5 verified, 10/10 green.

### F3 — Helper call sites are matched line-wise, so a wrapped call is never inspected

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/lib/form-endpoint-guards.test.ts:330, 369
- **Detail**: `` new RegExp(`\\b${name}\\s*\\(([^)]*)\\)`, "g") `` is applied per line. Confirmed:
  a single-line `errorUrl(err.message)` yields 1 match; the same call broken across lines by
  Prettier (printWidth 120) yields **0** — it is not rejected, it is *never inspected*. Every other
  bypass in this file fails loud; this one is silent. Compounding it, the reach control floors at
  `total >= 25` against a measured **29**, so up to four emissions can drop out of the walker with
  the control still green. The comment at `:252-257` justifies a floor for *growth*, which is
  right — but a floor set below the measured value gives away the shrink direction too.
- **Fix**: Raise the floor to the measured 29 (still a floor, so new emissions of already-vouched
  copy stay free) and record the per-line limitation where the same trade is already documented for
  `error-param-guard.test.ts:41-44`.
- **Decision**: FIXED. Floor 25 → 29; the limitation and the reason a floor must sit AT the measured
  value are written at the control.
  **Correction to this finding, found by running the breakage rather than by reasoning**: the
  wrapped form is narrower than stated above. Prettier wraps the OUTER call first, producing
  `context.redirect(\n  errorUrl(msg),\n)` — and `errorUrl(msg)` still sits on one line, so the
  regex matches and the count is unchanged (verified: 10/10 green). The genuinely blind shape needs
  the INNER call's own argument list to wrap, `errorUrl(\n  msg,\n)`. So "a reformat" overstated
  the reachability. With that real shape planted the raised floor goes **1 of 10 red**
  (`expected 28 to be greater than or equal to 29`) where the old floor of 25 would have passed
  silently — which is the whole value of the change. `src/` restored, md5 verified twice.

### F4 — `searchQuery` can cut a surrogate pair, emitting a lone high surrogate

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/deck-limits.ts:75-77
- **Detail**: `.slice(0, QUERY_MAX)` counts UTF-16 code units. Confirmed by execution on
  199 ASCII + `U+1F600`: the result is 200 units ending in `0xd83d`, a **lone high surrogate**
  (`JSON` tail `"aaa\ud83d"`). That value is what supabase-js serialises into the
  `search_flashcards_in_deck` request body, and it is rendered into
  `Brak fiszek pasujących do „…"`. Blast radius is bounded — `[publicId]/index.astro:58` branches on
  the query error and renders the `cardsError` state, so the worst case is a spurious error panel
  plus a U+FFFD in the copy — and it is reachable only from a crafted or hand-edited URL, since a
  browser will not let `maxLength` straddle a character. Note the `char_length`-vs-`.length` hazard
  §6.10 warns about does **not** apply: `?q=` is an RPC argument, not a stored column, so there is
  no second enforcer to disagree with. `maxLength` and `.slice` do agree — same unit.
- **Fix**: Clamp on code points — `[...raw.trim()].slice(0, QUERY_MAX).join("")` — and add a
  non-ASCII case to `deck-limits.test.ts`, which uses only ASCII today.
- **Decision**: FIXED, **by a different mechanism than this Fix proposed**. Code-point slicing was
  implemented first and `npm run lint` rejected it — `@typescript-eslint/no-misused-spread`, 2
  errors — with a correct objection: spreading counts code points, which still splits a ZWJ
  sequence, so it was half a fix plus a suppression. Final shape keeps the cap in UTF-16 units
  (so it agrees exactly with the input's `maxLength`) and DROPS a trailing unpaired high surrogate:
  `/[\uD800-\uDBFF]$/.test(clamped) ? clamped.slice(0, -1) : clamped`. `Intl.Segmenter` was
  considered and rejected as out of proportion to a clamp the module itself calls hygiene.
  Falsified both ways: removing the trim → **1 of 6 red** on the unpaired-surrogate assertion;
  the over-eager "always drop the last unit" mutant → **4 of 6 red**, caught by the ordinary
  positive control too. Docblock, the test case and `DeckContentToolbar`'s mirror comment all
  updated to the unit that actually ships. Suite 343/343 (+1), lint back to 0 errors.

### F5 — The catch-all was re-rooted to `src/` but is still filtered to `.astro` only

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: tests/lib/error-param-guard.test.ts:96, 205-248
- **Detail**: G4 was fixed by re-rooting the walk at `src/` — correct, and its control (naming
  `layouts/Layout.astro`, floor 8) is falsifiable. But `astroPages` still keeps only `.astro`, while
  the two sibling guards the file cites as precedent at `:22-23` and `:184-185`
  (`no-logging.test.ts`, `no-env-access.test.ts`) walk **every** file under `src/` — which is why
  their controls name `middleware.ts` and `lib/openrouter.ts` alongside a page. Concretely,
  `FlashcardWorkspace.tsx:95`, `CreateDeckModal.tsx:37`, `DeckActions.tsx:37` and
  `SignInForm.tsx:29` already touch `searchParams` for `"error"` (via `.has`/`.delete`). An island
  that switched one of those to `.get("error")` and rendered it is the same content-injection
  vector — and *worse*, because `no-client-redirect-errors.test.ts` forbids components importing the
  vouching set, so such an island could only render the value raw. Nothing looks at that surface.
- **Fix**: Drop the extension filter (or add `.ts`/`.tsx`) in the catch-all `describe` only, and
  extend its reach control to name one non-`.astro` file, matching the two siblings.
  - Strength: Closes the one read surface the widened guard still cannot see; aligns with the two
    guards this file explicitly claims as its pattern.
  - Tradeoff: Widens the scan to ~100 more files; may need an allowance for the four islands that
    legitimately `.has()`/`.delete()` the parameter.
  - Confidence: MEDIUM — the four call sites are real, but whether the existing `RAW_READ` regex is
    silent on `.delete("error")` needs checking before this is turned on.
  - Blind spot: Have not measured the false-positive set over `src/components/`.
- **Decision**: FIXED. New `scannableFiles` walker (`.astro` + `.ts` + `.tsx`) for the catch-all
  only — the per-surface walk keeps `astroPages`, which is correct for pages. The blind spot above
  was then measured rather than left: `RAW_READ` does not match `.has`/`.delete`, so the four
  islands that touch the parameter need no allowance — but two DOCBLOCKS (`auth-errors.ts:102`,
  `redirect-errors.ts:115`) quote the raw read to explain the rule, so the scan gained comment-line
  filtering (`codeLinesOf`) or the two files documenting the guard would have been reported as
  violating it. Reach control extended to name `middleware.ts` and
  `components/flashcards/FlashcardWorkspace.tsx`, and its floor set to the **measured** 69
  (12 `.astro` + 57 `.ts`/`.tsx`) rather than a round number below it.
  **Falsified as a PAIR**: a raw `.get("error")` planted in `FlashcardWorkspace.tsx` leaves the
  pre-fix guard **11/11 green** and turns the widened one **1 of 11 red**, naming file and line.
  Island restored, `git diff -- src/components/` clean apart from the intended F4 comment.

### F6 — Two documentation corrections are incomplete, one at the exact site the research named

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:2402, :3254
- **Detail**: Two of the five bookkeeping sub-items are partial.
  (a) The Kong denominator was corrected to `19`/`333` at `:65-66`, `:2323` (with a dated correction
  note) and `:3440-3444` — but `:2402` still reads "the pure half (**18 cases**, no Docker, no
  stack)", the same claim spelled out in words. This is the stale-denominator class this file has
  recorded three times and this change was partly written to close.
  (b) Research item 6 names **one** site for the `JSON.stringify` rescoping —
  `test-plan.md:3190-3191`. Post-change that block (now `:3254`) **still reads** "no `.message`,
  `String(err)` or `JSON.stringify` on any deck-route branch". The rescoping was applied instead to
  the header at `:92-93`, which research did not list; `§6.6`'s C10X-37 entry at `:2181-2182`
  already carried the correct scoping from C10X-37 itself. Net: two of three sites right, and the
  one the intent document pointed at is untouched.
- **Fix**: Correct `:2402` to 19 cases and rescope `:3254` to "the redirect branches", matching
  `:92-93`.
- **Decision**: FIXED. Both corrected in place as dated corrections rather than rewrites, per this
  file's own convention. (a) now reads "**19** cases" and names why it was the site that survived —
  it spells the number out in prose while the three literal figures were the ones corrected.
  (b) now reads "any deck-route **REDIRECT** branch" with the `cards/batch.ts:45` counter-example
  and a note that C10X-40 was scoped to this sentence and rescoped the header instead.

### F7 — No `plan.md`, no `verification.md`, no `reviews/` — and the new evidence pointer will rot on archive

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: context/changes/deck-error-param-guard/ ; context/foundation/test-plan.md:36
- **Detail**: Every recent change here carries `plan.md` + `verification.md` + `reviews/`
  (verified against the last three archives). This one carries `change.md` + `research.md` only.
  Research's Open Question 6 names the missing plan as a conscious deviation, which is the right
  call — but the **missing `verification.md` is the more consequential half and is not named**: the
  Outcome table asserts "six breakage runs, six verified restores" and gives one-line results, while
  the observed failure strings, denominators and md5 restores that this project's own §6.6 discipline
  demands ("a split is a claim about a run") exist nowhere in the change folder. Consequently
  `test-plan.md:36` points its evidence at `context/changes/deck-error-param-guard/research.md` —
  and it is the **only one of the header block's nine evidence pointers without the
  "(after archiving: `context/archive/<date>-…`)" form** that the other eight carry. It resolves
  today and will break the moment `/10x-archive` runs: the exact pointer-rot class this change
  repaired at eight other sites.
- **Fix A ⭐ Recommended**: Add the "(after archiving: …)" parenthetical at `:36`, and record the
  no-plan/no-verification deviation explicitly in `change.md` so it is a dated decision rather than
  something a later reader discovers.
  - Strength: Cheapest thing that stops a known-recurring failure; keeps the deviation honest.
  - Tradeoff: Leaves the breakage evidence compressed into research.md and test-plan.md.
  - Confidence: HIGH — the eight sibling pointers establish the convention unambiguously.
  - Blind spot: None significant.
- **Fix B**: Also write a `verification.md` carrying the six runs' observed failure strings,
  denominators and restore hashes, and repoint `:36` at it.
  - Strength: Matches every other change; the evidence survives archiving in its own folder.
  - Tradeoff: Reconstructing observed output after the fact risks writing down what was *expected*
    rather than what was *seen* — which would be worse than the compressed record.
  - Confidence: MEDIUM — depends whether the raw output is still recoverable.
  - Blind spot: Have not checked whether the runs were captured anywhere retrievable.
- **Decision**: FIXED via Fix A. `test-plan.md`'s header pointer gained the
  "(after archiving: …)" form plus an explicit statement that it points at `research.md` **because
  this change has neither a `plan.md` nor a `verification.md`**, and that the six breakage runs are
  therefore one line each rather than carried with their observed strings. `change.md` gained a
  `## Process deviation` section recording the departure from the
  `/10x-plan → /10x-implement → /10x-impl-review` loop as a dated decision. Fix B was declined for
  the stated reason: reconstructing the original runs after the fact risks recording what was
  expected rather than what was observed.

### F8 — The `?q=` clamp assertions are all homogeneous, so a keep-the-tail mutant survives

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/lib/deck-limits.test.ts:31-39
- **Detail**: Trim-before-clamp *is* properly pinned (the padded case at `:41-46` goes red under a
  clamp-then-trim implementation), and both boundary controls are present. But every clamp
  assertion uses `"a".repeat(...)`, and executing the mutant `(r) => r.trim().slice(-QUERY_MAX)`
  against all four of the file's cases shows it **survives every one** — it would silently return
  the *end* of a long query.
- **Fix**: One heterogeneous assertion, e.g.
  `expect(searchQuery("x" + "a".repeat(QUERY_MAX))).toBe("x" + "a".repeat(QUERY_MAX - 1))`.
- **Decision**: FIXED. The heterogeneous assertion added to the existing boundary case (no new
  `it()`). Falsified: the `slice(-QUERY_MAX)` keep-the-tail mutant, which previously survived all
  four cases, now turns **2 of 6 red** — the new assertion and the F4 surrogate case. Restored.

### F9 — Dead read and reversed `relative()` arguments in the new guard

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/lib/form-endpoint-guards.test.ts:341, 346, 365
- **Detail**: `emissionCount` reads the file into `const source` and discards it with `void source;`
  — dead I/O, and the function is called once per file in a `.map`, again in a `.reduce`, plus twice
  directly. Separately `:365` calls `relative(file, DECKS_API_DIR)` with the arguments reversed
  relative to the file's own `label()` helper (`relative(root, file)`, `:90`). Verified: it produces
  `".."` and `"../../.."` instead of `index.ts` — and identical strings for different files at the
  same depth. Harmless today because only `perFile.length` is read, but it will mislead whoever
  first prints it in a failure.
- **Fix**: Delete the dead `source` read; swap the `relative()` arguments to `(DECKS_API_DIR, file)`.
- **Decision**: FIXED. Both applied; `emissionCount` no longer reads the file it never used.

### F10 — Two comments claim more than their assertions deliver

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/decks/[publicId]/index.astro:42 ; tests/validation/decks.test.ts:305-316
- **Detail**: (a) `searchQuery`'s extraction is justified on §6.1 grounds — an `.astro` frontmatter
  is unreachable by every layer in this suite — but nothing asserts the page still *calls* it, so
  reverting `:42` to the old inline `.trim()` leaves the suite fully green. That is the same
  "helper tested, call site not" shape `error-param-guard.test.ts` exists for; registering
  `q`/`searchQuery` as a third row in its `SURFACES` table would cost ~3 lines. Given the module's
  own correct framing that this is hygiene rather than a security control, this is a note, not a gap.
  (b) The `File`-part count oracle is real but much weaker than its JSON-body twin: it is red only
  under a regression that *awaits the part's text*, whereas the regressions that actually happen
  (`as string` cast → `TypeError` → 500; `String(value)` → `"[object File]"`) write nothing and are
  caught by the status/message assertions alone. The comment at `:305-307` ("A real oracle, not a
  vacuous one") is true but reads as equivalent to its sibling.
- **Fix**: Add the `q` row to `SURFACES`; add one sentence to `decks.test.ts` naming which regression
  class each of the two oracles covers.
- **Decision**: FIXED, both halves. (a) landed as its own small `describe` in
  `error-param-guard.test.ts` rather than a `SURFACES` row — `RAW_READ`/`wrappedRead` are hardcoded
  to the `error` parameter and `?q=` has no vouching helper, so a row would have meant
  parameterising the whole table for a case that is deliberately not the same class. Two cases, both
  halves of the control. **Falsified**: reverting `[publicId]/index.astro:42` to the inline
  `.trim()` turns **1 of 13 red**; page restored, `git diff` clean. (b) the `File`-part comment now
  names what its count does and does not cover — red only for a regression that awaits the part's
  text; the `as string` cast (TypeError → 500) and `String(value)` (`"[object File]"`) write nothing
  and are caught by the status and message assertions instead.

## Not findings — checked and clean

- **`?q=` flow**: single read, clamped, reaching both sinks; no island re-reads it. Research's
  "unbounded at the search RPC" is genuinely closed.
- **Injection**: `search_flashcards_in_deck` is `security invoker` (RLS still filters), takes
  `p_query` as a bound argument and escapes `\ % _`; React escapes the reflection. The module's own
  conclusion — bounded reflection behind an owner-only UUID, hygiene not a control — holds.
- **Authz**: untouched; 404-never-403 deck resolution still precedes everything.
- **Single-sourcing**: `QUERY_MAX` imported, not duplicated; `deck-limits.ts` still imports nothing,
  so the client-bundle rule and `no-client-redirect-errors.test.ts` both hold.
- **G3/G5/G6/G8**: all four re-verified as construct fixes with working controls; the `let form;`
  assignment shape (which broke the first recorded breakage attempt) is correctly handled.
- **Roadmap**: H-07/H-08 backfilled `done` with the H-04 precedent annotated, H-09 opened
  `in progress` — correct for an unarchived change.
- **Commit hygiene**: five one-line Conventional Commits, all scoped `C10X-40`. Two subjects run
  75 and 77 characters against the project's ≤72 rule — noted, not worth a history rewrite.
