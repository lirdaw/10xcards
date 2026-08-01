<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Auth Error Copy — Audit and Close H-03

- **Plan**: `context/changes/auth-error-copy/plan.md`
- **Scope**: Phases 0–6 of 6 (all Progress boxes `[x]`)
- **Date**: 2026-07-31
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success criteria — re-run in this review

Every automated criterion was executed against the working tree, not read off the plan:

| Check | Result |
|---|---|
| `npm test` | 254 passed / 254, 21 files (seed `1785480868670`) |
| `npx vitest run tests/auth/errors.test.ts` | 55 passed / 55 |
| `npm run lint` | exit 0 — 0 errors, the 6 pre-existing `no-console` warnings in `evals/generation-quality.eval.ts` |
| `npm run build` | exit 0 |
| `import.meta.env` / `process.env` under `src/` | 0 occurrences |
| `isOpenRouterConfigured` repo-wide | 0 in `src/`, `tests/`, `evals/`; remaining hits are change-artifact prose only |
| `1 of 33` / `33 cases` | 3 live occurrences, each carrying a dated correction; the two archived ones are correction lines, not rewrites |
| `git diff -- src/` | clean; `git diff 75d02f4^..HEAD -- src/pages/api/` empty (auth-route control flow untouched, as contracted) |
| roadmap H-03 | dated C10X-34 line appended to the ⚠️ bullet; `- **Status:**` provably absent from the diff |

Manual criteria are backed by observed evidence in `verification.md` (browser-measured DOM facts,
a controlled aria-attribute isolation experiment, Mailpit message counts for both GoTrue
confirmation configurations, `history.length` unchanged across Back/Forward). No rubber-stamping
found.

Two independent re-derivations agree with the implementation and against the plan text:
`grep -rn "<ServerError" src/` gives **12 render sites across 11 components** (14 lines, 2 of them
comments inside `ServerError.tsx`) — the plan said eleven sites across nine components, and the
implementation shipped the corrected figure as a dated correction rather than silently. Six
`formData()` readers exist under `src/pages/api/`, confirming the `forms.ts` / `forms.test.ts`
correction.

## Findings

### F1 — `?error=` is still read unconstrained on three deck pages

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/decks/index.astro:22, src/pages/decks/[publicId]/index.astro:86, src/pages/decks/[publicId]/review.astro:115
- **Detail**: All three read `Astro.url.searchParams.get("error")` raw and pass it as `serverError`
  into an island that renders it through the same `ServerError` red banner
  (`decks/index.astro:34` → `CreateDeckModal.tsx:80`). That is the identical content-injection
  class this change closed on the auth pages — a crafted link renders attacker-chosen text with
  the app's own authority. Two things reduce but do not remove the severity: these routes sit
  behind the middleware guard, so the victim must already be signed in; and test-plan §6.6's
  C10X-34 entry names the residual explicitly, correctly noting their messages come from a
  different set (or none), so `ownedAuthMessage` does not apply as written.
  The gap is ownership: unlike the other deferred items in that same does-NOT-prove list
  (C10X-36 for auth input validation, C10X-37 for the two deck endpoints), this one carries no
  ticket. It lives in prose only, and prose without an owner is how a known live vector becomes a
  rediscovery.
- **Fix A ⭐ Recommended**: Ticket it as a follow-up (a `?error=` closed set for the deck surface,
  same equality-and-`null` shape as `ownedAuthMessage`) and add the ticket key beside the existing
  does-NOT-prove bullet in test-plan §6.6.
  - Strength: Matches how this project already handles every other deferred edge — a named key in
    the does-NOT-prove list — and keeps this change's scope discipline intact.
  - Tradeoff: The vector stays live until that ticket is worked.
  - Confidence: HIGH — C10X-36 / C10X-37 are the precedent, set by the two preceding changes.
  - Blind spot: Whether the deck messages actually form a closed set today has not been
    enumerated; that is the first step of the follow-up, not a fact this review establishes.
- **Fix B**: Close it here — build the deck-side constant set and helper now.
  - Strength: Removes the whole class in one pass while the pattern is fresh.
  - Tradeoff: Three pages plus their islands are outside this change's stated scope; the deck
    messages have no closed set yet, so this is design work, not a mechanical repeat. It would
    also be a late scope widening of a change whose whole framing is "audit the edges a foreign
    ticket left open".
  - Confidence: MEDIUM — the shape transfers, the message inventory does not.
  - Blind spot: Deck `?error=` values are produced by six endpoints; whether they are all
    literals has not been verified.
- **Decision**: FIXED via Fix A — queued in `follow-ups/review-fixes.md` and given an owner in
  test-plan §6.6's does-NOT-prove list ("to be ticketed via `/jira-backlog-sync`", the C10X-31
  idiom). No `src/` change; the vector is recorded with its evidence, its severity qualifier and
  the enumeration step this review did not perform.

### F2 — Nothing asserts that the auth pages call `ownedAuthMessage`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/pages/auth/signin.astro:8, src/pages/auth/signup.astro:8; tests/auth/errors.test.ts:288-337
- **Detail**: The helper itself is covered well — equality, containment rejection, a
  one-character truncation, `null` / `""` / `"   "`, and a whole-set positive control at `:330-336`
  that correctly defeats the degenerate `() => null` implementation. But deleting the
  `ownedAuthMessage(...)` call from either `.astro` frontmatter leaves the suite fully green,
  silently re-opening the vulnerability the change exists to close. The change discloses this
  honestly (test-plan §6.6: "A regression deleting the `ownedAuthMessage(...)` call from
  `signin.astro` leaves the suite green"), and §7's island/`.astro` negative space is the standing
  reason. What makes it worth raising anyway is that this change *itself* demonstrates the cheap
  countermeasure one directory over: `tests/lib/no-env-access.test.ts` is a textual guard over
  `src/` with two positive controls, written by this same slice.
- **Fix A ⭐ Recommended**: Add a textual guard modelled on `no-env-access.test.ts` — every
  `.astro` under `src/pages/auth/` whose frontmatter contains `searchParams.get("error")` must
  also contain `ownedAuthMessage`, with the same two positive controls (the walker reaches both
  files; the pattern fires on a fabricated sample).
  - Strength: Kills the realistic regression (deletion) at the layer this project already uses
    for exactly this, without adding a DOM environment or a page-rendering layer §4 deliberately
    does not have.
  - Tradeoff: It proves the call is *present*, not that it is *wired* — a reader must not read it
    as more than that, so the file needs a header saying so.
  - Confidence: HIGH — the pattern, the positive-control shape and the `.astro`-is-textual
    argument are all already established in this repo.
  - Blind spot: A textual guard couples `src/` comment wording to the pattern, the same coupling
    `confirm-email.astro:6-9` had to work around.
- **Fix B**: Accept as documented negative space and leave it.
  - Strength: §7's boundary is honest and consistently applied; the disclosure already exists in
    test-plan §6.6.
  - Tradeoff: The one assertion protecting a security fix is not connected to the code path that
    delivers it.
  - Confidence: MEDIUM — depends how much weight the read-side check is meant to carry.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `tests/lib/auth-error-param-guard.test.ts` (3 cases). Stricter
  than proposed: the assertion is **per line**, so a page that imports the helper and still reads
  the parameter raw two lines down fails — co-presence would have waved that through. Falsifiable,
  and proved so: unwrapping `signin.astro:8` turns **1 of 3** red naming file and line, while both
  positive controls stay green **and `errors.test.ts` stays 55/55 green through the same neuter**,
  which is precisely the gap. Restored, `md5` `0e0221b42845c63a2130bcb7cfd7266a` identical to
  pristine, `git diff -- src/` empty. Suite now **257/257, 22 files**; lint 0 errors.
  test-plan §6.6's "leaves the suite green" sentence and §8's ledger corrected accordingly.
  > **Correction line, 2026-07-31 (C10X-37), appended rather than rewritten — an archived artifact
  > records what was true when it was written.** The file named above is
  > `tests/lib/error-param-guard.test.ts` since C10X-37 `git mv`'d it: the deck surface got the
  > same guard, and the two surfaces vouch against **different** closed sets (`AUTH_MESSAGES` vs
  > `REDIRECT_MESSAGES`), so the pattern is now built per surface from ITS helper's name. A shared
  > "is it wrapped in something?" regex would have accepted a deck page wrapped in
  > `ownedAuthMessage` — lexically a wrap, semantically the wrong vocabulary. The file went 3 → 8
  > cases. Nothing above is otherwise superseded; F1's deferred read-side vector also shipped under
  > C10X-37 (see `context/changes/deck-form-hardening/`).

### F3 — Unplanned permanent guard: `tests/lib/no-env-access.test.ts`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: tests/lib/no-env-access.test.ts (new, 118 lines)
- **Detail**: Phase 5 contracted a one-off *enumerated search* for `import.meta.env` / `process.env`
  under `src/`. The implementation turned that into a permanent textual guard (3 cases, positive
  controls in both directions), modelled faithfully on `no-logging.test.ts`. It is a clear
  improvement and is recorded in test-plan §6.6, but no phase's "Changes Required" describes it,
  and it creates a constraint the plan never weighed: the scan is textual, so any `src/` file that
  merely *mentions* the forbidden token — including in a comment — turns it red.
  `confirm-email.astro:6-9` already had to be worded around it, and does document why.
- **Fix**: None to the code — record it as a deliberate addendum so the next reader does not read
  the file as untracked scope.
- **Decision**: FIXED — dated addendum appended to `plan.md`'s Phase 5 §4 contract, stating that a
  guard shipped where a search was contracted, why (no ESLint rule forbids either spelling, which
  is how the occurrence shipped green in the first place), and the constraint the plan never
  weighed (textual scan → a `src/` comment mentioning the token turns it red).

### F4 — `hint` is never associated with its input

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/auth/FormField.tsx:69, :77-84
- **Detail**: `aria-describedby` is emitted only for `errorId`. Hint and error are mutually
  exclusive (`:82-83` is the `else` branch), which is exactly why there is no dangling reference —
  the shipped behaviour is correct as far as it goes. But it means `SignUpForm.tsx:74-80`'s live
  password hint ("*N* more characters needed") is visible-only: a screen-reader user gets the
  guidance that would have prevented the error only *after* triggering the error. `FormField` is
  this slice's own component, so closing it would not violate the "polish only your own
  components" rule.
- **Fix A ⭐ Recommended**: Leave it and record it in the change's does-NOT-prove list.
  - Strength: The hint arrives as a `ReactNode` from the parent, so attaching an id means either
    cloning the element or changing the prop contract — real design work, not a one-liner, and
    Phase 5's contract was specific about what it covered.
  - Tradeoff: A real, if minor, a11y gap stays open on the sign-up form.
  - Confidence: HIGH — the prop shape is visible at the call site.
  - Blind spot: Whether the hint is announced anyway by some readers on focus has not been tested;
    nothing here can test it.
- **Fix B**: Add `hintId` now — `const hintId = \`${id}-hint\``, applied to the hint wrapper, with
  `aria-describedby={error ? errorId : hint ? hintId : undefined}`.
  - Strength: Completes the field/description association the phase set out to build.
  - Tradeoff: Requires changing `hint`'s prop contract (or cloning), and the manual screen-reader
    check that closed 5.6 would have to be re-run to claim anything about it.
  - Confidence: MEDIUM — mechanically simple, contract change is the cost.
  - Blind spot: Both forms pass `hint`; the change would touch three files, not one.
- **Decision**: FIXED via Fix A — no behaviour change. Recorded twice, where each reader meets it:
  a comment at `FormField.tsx:69` naming the concrete cost (`SignUpForm`'s live hint is
  visible-only), why it is not a one-liner, and the exact shape if it is ever taken; and a bullet
  in test-plan §6.6's does-NOT-prove list. Decided rather than overlooked is the whole point.

### F5 — roadmap H-03's `- **Status:**` line now carries a claim this change falsified

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/roadmap.md (H-03 `- **Status:**` line)
- **Detail**: That line still reads that `/10x-archive` will **not** flip this row "bo dopasowuje
  po `Change ID`, a ta praca wyszła pod `ai-candidate-generation-test-2`, nie pod
  `auth-error-copy`". The plan's own Key Discoveries reverses exactly this: `roadmap.md:248` gives
  H-03's `Change ID` as `auth-error-copy`, this change carries that id (verified), so the archive
  step *will* match. Leaving the line untouched was correct and contracted — `- **Status:**`
  belongs to `/10x-archive`, which rewrites the whole line, so the false prose is transient by
  design. It is still a false statement standing in the document whose stated purpose this phase
  was to de-rot, readable by anyone between now and archiving.
- **Fix**: Nothing in `roadmap.md` — but if `/10x-archive` does not run promptly, extend the ⚠️
  bullet's dated C10X-34 line by one clause noting the `Change ID` now matches, so the two
  adjacent lines stop contradicting each other.
- **Decision**: FIXED — clause appended to the ⚠️ bullet's dated C10X-34 line, stating that H-03's
  `Change ID` is `auth-error-copy`, that this change carries it, and that the `- **Status:**` line
  is left untouched **on purpose** because `/10x-archive` rewrites it together with the stale
  justification. `- **Status:**` verified still absent from the diff, so archive keeps its match
  target.

## Not raised as findings

Recorded so a later reader knows they were examined and cleared, not missed:

- **`replaceState` drops `location.hash` and clobbers `history.state`** (`SignInForm.tsx:31`,
  `SignUpForm.tsx:35`). Both are true and both are inert here — neither auth page has an anchor
  target, and `grep -rn "ViewTransitions\|astro:transitions\|history.state" src/` returns nothing.
  More importantly it is the **established repo pattern**, byte-identical at
  `CreateDeckModal.tsx:30`, `DeckActions.tsx:36`, `FlashcardWorkspace.tsx:102`,
  `CandidateReviewWorkspace.tsx:91`. Fixing it here alone would be precisely the opportunistic
  cross-component polish `lessons.md` forbids. If ever fixed, fix all six together.
- **The five inference-only GoTrue codes are self-referentially tested** — the `it.each` rows use
  the same literal as the map key, so a typo or upstream rename is invisible to the suite *and* to
  Stryker. Fully disclosed in both the module and test-plan, with a named artifact (auth-js
  `2.105.3` `error-codes.d.ts`) as the substitute. Verified the constraint is real: `ErrorCode` is
  not re-exported from auth-js's public entry point and `@supabase/auth-js` is a hoisted
  transitive, not a declared dependency — so a compile-time guard would bind the suite to an
  unpinned `node_modules` path, the tradeoff this repo already rejected elsewhere.
- **Security core.** `ownedAuthMessage` (`auth-errors.ts:117-120`) is membership by strict
  equality over a string-only array — no `startsWith`/`includes` on the input, no coercion path
  (`raw: string | null` matches `searchParams.get()`'s return), whitespace and Unicode-normalised
  variants reject, duplicate `?error=` params are safe in both orders, and rejection degrades to
  no banner rather than to a default. `authErrorMessage` interpolates nothing: all three rungs
  return module constants and `Object.hasOwn` (`:260,264`) still blocks the prototype walk.
- **`role="alert"` double-announcement.** All 12 sites read: the 7 `role="status"` nodes in `src/`
  are siblings, never ancestors, of a `ServerError`; no `aria-live` anywhere in the tree.
- **`visibleConfigStatuses` is genuinely parameterised** — reads only its arguments, never the
  module-level `missingConfigs`, which is what makes the un-configured-Supabase case reachable
  from a runner that can only ever be in the other state.
- **Focus ring untouched.** `FormField.tsx:72` is a context line in the diff; the a11y edit added
  only `aria-*` and `autoComplete`.
- **Pattern compliance clean** — `@/*` imports throughout, `cn()` for the one conditional class,
  one-line Conventional Commits scoped `C10X-34`, both new test files carrying real positive
  controls in both directions.
