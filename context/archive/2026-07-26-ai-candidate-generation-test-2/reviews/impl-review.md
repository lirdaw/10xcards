<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: No source-text or API-key leak on the generation failure path

- **Plan**: `context/changes/ai-candidate-generation-test-2/plan.md`
- **Scope**: All six phases (full plan review)
- **Date**: 2026-07-26
- **Verdict**: NEEDS ATTENTION → **all 8 findings FIXED and re-verified** (triage 2026-07-26)
- **Findings**: 0 critical, 5 warnings, 3 observations

## What was verified by execution

Every "Automated Verification" checkbox in the plan was re-run against the current tree,
not read off `verification.md`:

| Check | Command | Result |
| --- | --- | --- |
| Lint (after `astro sync`) | `npm run lint` | exit **0**, zero warnings and zero errors |
| Build | `npm run build` | Complete, server built |
| Full suite | `npm test` | **166 passed / 166, 14 files** |
| Phase 1 file | `npx vitest run tests/auth/errors.test.ts` | 33/33 |
| Phase 2 file | `npx vitest run tests/review/candidates.test.ts` | 20/20 |
| Phase 5 file | `npx vitest run tests/generation/failure-path.test.ts` | 4/4 |
| Phase 1 mutation | `npx stryker run --mutate "src/lib/auth-errors.ts"` | **93.33%** — 42 killed / 3 survived / 0 uncovered |

The three Stryker survivors were re-derived rather than accepted: all three are
`x === undefined ? undefined : LOOKUP[x]` → `false ? …`, which is behaviour-equivalent
because `LOOKUP[undefined]` is `undefined` anyway. The recorded "three equivalent mutants"
claim holds.

One deliberate-breakage check was re-run independently rather than trusted: appending
`console.log("probe")` to `src/lib/generation-limits.ts` turned **1 of 3** red in
`tests/lib/no-logging.test.ts`, on the expected case and with the file:line in the failure
message; `git checkout --` restored a clean tree and the file went green again. The
confinement claim was also re-derived by enumeration: `grep -rn "vi\.mock|vi\.spyOn|vi\.fn"`
over `tests/` returns exactly one `vi.mock`, on `astro:env/server`, in
`failure-path.test.ts`. `grep -rn "console\." src/` returns zero hits.

Manual criteria are backed by `verification.md`, which records each check's edit, the
observed failure string, the red/green split with its denominator, and a verified restore
(`pg_policies` before/after `diff`, empty). Spot-checked and consistent; not re-performed.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

**Plan Adherence** is a WARNING for documentation drift only — no planned item is MISSING,
and every code-level deviation from the plan (Phase 2's pairwise policy neuter, Phase 3's
re-derived breakage edit, Phase 5's fourth test case) is a recorded, justified adaptation
that improves on what the plan specified. The two drift items are both foundation/brief
documents this change left saying something now false.

## Findings

### F1 — Prototype-chain lookup breaks the mapper's closed-set invariant

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth-errors.ts:128,131
- **Detail**: `MESSAGE_BY_CODE` and `MESSAGE_BY_NAME` are plain object literals, so
  `MESSAGE_BY_CODE[error.code]` resolves through `Object.prototype`. Verified by execution
  against the real module: `authErrorMessage({ code: "constructor" })` returns
  `function Object() { [native code] }` — `typeof` **function**, and
  `AUTH_MESSAGES.includes(out)` is **false**. Same for `toString`, `valueOf`,
  `hasOwnProperty`, and for `name` via `MESSAGE_BY_NAME`. That value reaches
  `encodeURIComponent(authErrorMessage(error))` at `signin.ts:20` / `signup.ts:19` and
  lands in the address bar. `code` is read off the GoTrue response body
  (`fetch.js:39-50`, as the module's own header documents at :22-24), i.e. it is
  upstream-controlled — which is precisely the input class this module exists to keep out
  of the URL. The module's stated invariant ("Every return value is one of the
  module-level constants below", :16) and the test that pins it
  (`errors.test.ts:183`, `expect(AUTH_MESSAGES).toContain(message)`) are both falsified;
  the test's input set enumerates only real GoTrue codes, so it cannot see this. No
  private data escapes — every `Object.prototype` member is a native function — so this is
  a broken invariant and a garbage user-facing message, not a privacy leak.
- **Fix**: Guard the lookups with `Object.hasOwn` (or build both maps with
  `Object.create(null)`), and add `code: "constructor"` / `name: "toString"` to the
  closed-set case in `tests/auth/errors.test.ts:154`.
  - Strength: Restores the invariant the whole module is built around, and the added test
    case makes it observable — the current Stryker run cannot reach this branch.
  - Tradeoff: Two lines of source, two lines of test.
  - Confidence: HIGH — reproduced by executing the real module through Vitest, not by
    reading. Found independently by both review agents.
  - Blind spot: None significant. Whether a real GoTrue can emit such a code was not
    determined; the invariant is stated unconditionally, so it holds either way.
- **Decision**: FIXED — `Object.hasOwn` guards both lookups (`src/lib/auth-errors.ts`); four prototype-key inputs added to the closed-set case in `tests/auth/errors.test.ts`. Confirmed by breakage: reverting the guard turns **1 of 33** red, on `expect(AUTH_MESSAGES).toContain(message)` exactly.
  > **Correction line, 2026-07-31 (C10X-34) — the run is not rewritten.** The denominator has moved: that file held **33** cases on 2026-07-26 and holds **55** now (C10X-30, then C10X-34). "1 of 33" records what was executed that day; it is not a current figure, and the check has not been re-run since.

### F2 — The pass-through `fetch` guard fails OPEN, on a duplicated URL literal

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/generation/failure-path.test.ts:59,105
- **Detail**: The double delegates by exclusion —
  `if (!url.startsWith(OPENROUTER_URL)) return realFetch(input, init);` — and
  `OPENROUTER_URL` at :59 is a **copy** of the literal at `src/lib/openrouter.ts:10`,
  which is `const`, not `export`ed. So the two can drift silently, and the drift fails in
  the dangerous direction: an OpenRouter URL that no longer matches the copy is not
  answered by the double, it is **delegated to the real network** — a genuine request to
  `openrouter.ai` carrying the test's source text (`:84`, literally
  `"… prywatny tekst źródłowy"`) and an `Authorization` header built by production code.
  This file deliberately lifts the clamp `tests/setup/preflight.ts:110-118` exists to
  enforce, and its own header (:26-29) calls the pass-through the "REPLACEMENT GUARD" for
  it. `lessons.md`'s "Preflight musi domknąć KAŻDY nielokalny szew" is the rule this
  inverts: a guard that fails open is not a guard. Mitigating: the key in flight is a
  sentinel (a real one cannot be set — preflight would abort the run) and the assertions
  would go red. The request still leaves the machine.
- **Fix A ⭐ Recommended**: `export` `OPENROUTER_URL` from `src/lib/openrouter.ts` and
  import it in the test instead of re-declaring it.
  - Strength: Removes the drift mechanism at its source, which is exactly the argument
    Phase 3 makes for `SOURCE_MAX` — applying the change's own reasoning to its own test.
    One symbol, no behaviour change.
  - Tradeoff: Widens `openrouter.ts`'s public surface by one constant purely for a test.
  - Confidence: HIGH — the duplication is verified by grep; the predicate's direction is
    read directly from :105.
  - Blind spot: Does not close the case where the endpoint gains a *second* outbound host.
- **Fix B**: Invert the predicate — delegate only the Supabase origin to `realFetch` and
  `throw` on anything else.
  - Strength: Fails closed by construction, so any new outbound host is a loud test
    failure rather than a silent billed call. Strictly stronger than A.
  - Tradeoff: Needs the Supabase origin threaded into the test, and a future legitimate
    host makes the file red until someone allow-lists it — friction by design.
  - Confidence: MEDIUM — the endpoint's six Supabase calls all go to one origin
    (`SUPABASE_URL`), but nothing was executed to confirm no other host is reached.
  - Blind spot: Have not enumerated every `globalThis.fetch` consumer reachable inside one
    `callEndpoint`.
- **Decision**: FIXED via Fix A **and** Fix B — `OPENROUTER_URL` is now `export`ed from `src/lib/openrouter.ts` and imported by the test, and the predicate is fail-closed: only `SUPABASE_URL` reaches `realFetch`, anything else rejects with a named error. The file stayed 4/4 green, which also closes Fix B's recorded blind spot — Supabase really is the only other host reached inside `callEndpoint`.

### F3 — `roadmap.md` says H-03 is `not started`, but H-03's entire scope shipped here

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: context/foundation/roadmap.md:57,246
- **Detail**: The H-03 row and its detail block both end `Status: not started`. H-03's
  stated outcome is the auth error copy plus the OpenRouter banner gate — i.e. exactly
  Phase 1 (`b0ab625`) and Phase 4 §1 (`34e8837`), both landed on this branch. Worse than a
  stale label: the H-03 block's Risk field instructs a future implementer to lift "Faza 1 i
  Faza 4 §1 w `plan.md` zmiany `ai-candidate-generation-test-2`" verbatim — an instruction
  to re-implement shipped code. And `/10x-archive` will **not** repair it: `roadmap.md:283`
  says archive flips the Status of the item whose `Change ID` matches the archived change,
  and H-03's `Change ID` is `auth-error-copy` while this change is
  `ai-candidate-generation-test-2`. So the row is stranded. `change.md`'s "OPEN AFTER THIS
  CHANGE" list covers closing C10X-34 in Jira but says nothing about the roadmap — the same
  pointer-rot class its own item 4 warns about. Phase 6 re-derived `test-plan.md` line by
  line and did not extend that sweep to `roadmap.md`.
- **Fix A ⭐ Recommended**: Annotate the H-03 block — state that its scope was implemented
  under C10X-28 on `C10X-28-ai-candidate-generation-test-2` (commits `b0ab625`, `34e8837`),
  replace the "lift these phases verbatim" instruction with a pointer to the shipped code
  and to this change's `verification.md`, and add roadmap H-03 to `change.md`'s OPEN list
  beside the C10X-34 Jira item. Leave `Status` for whoever closes C10X-34.
  - Strength: Kills the re-implementation instruction, which is the actually harmful part,
    without touching the field `lessons.md` reserves for `/10x-archive` ("doc-sync updates
    only the Outcome; never set Status → done manually").
  - Tradeoff: The row still reads `not started` in the summary table until someone closes
    it out, so a skim-reader is still misled — the annotation only helps whoever opens the
    block.
  - Confidence: HIGH — the archive-ownership rule is quoted from `roadmap.md:283` and
    `lessons.md`; the Change ID mismatch is verified.
  - Blind spot: Whether the project wants H-03 closed at all, given C10X-34 is still open
    in Jira, is the user's call — the annotation is deliberately status-neutral.
- **Fix B**: Set H-03's `Status` to `done` in both places now.
  - Strength: The table stops lying immediately; no reader is misled at any depth.
  - Tradeoff: Directly violates the recorded rule that `/10x-archive` owns that flip, and
    pre-declares done while C10X-34 is open in Jira and nothing has shipped to prod.
  - Confidence: MEDIUM — mechanically correct, but against a rule this repo wrote down
    after being bitten.
  - Blind spot: Unknown whether `/10x-archive` would later try to flip it again and fail
    noisily or silently.
- **Decision**: FIXED via Fix A — the `### H-03` block now opens with a `⚠️ ZAKRES JUŻ ZAIMPLEMENTOWANY` line naming the branch and both commits, and its "lift Faza 1 i 4 §1 verbatim" instruction is gone. `Status` left for whoever closes C10X-34, with the reason `/10x-archive` cannot do it stated inline. A warning under the summary table covers the skim-reader tradeoff, and the item is now `change.md`'s OPEN item 5.

### F4 — `plan-brief.md` still carries the revoked "do not implement" instruction

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/ai-candidate-generation-test-2/plan-brief.md:31-32
- **Detail**: The brief's scope-split block ends **"Do not implement Phases 1, 3 or Phase 4
  §1 from this folder."** `plan.md`'s Implementation Approach explicitly revoked exactly
  that sentence ("This paragraph used to end 'Do not implement Phases 1, 3 or 4 from this
  plan folder' — that no longer holds. **All six phases are executed here, on this
  branch**"), and all six were. The brief's "Phases at a Glance" table (:117-124) and its
  effort estimate ("~2–3 sessions for C10X-28's four phases; the two sibling tickets carry
  the rest") carry the same superseded framing. Meanwhile `change.md:118` states
  "`plan-brief.md` is back in sync with the plan after the F1–F7 fixes" — which is now
  false. This matters beyond hygiene: the brief is the artifact `/jira-sync-work` pushes
  into the ticket's rich-text fields, so the wrong instruction propagates to Jira, where
  the C10X-34 / C10X-30 attribution already depends entirely on prose (the commit scope key
  no longer encodes it).
- **Fix**: Replace the "Do not implement…" sentence with the plan's own revision ("the
  split is bookkeeping, not an execution boundary — all six phases were executed here"),
  and correct `change.md:118`'s in-sync claim to name what was re-synced and when.
- **Decision**: FIXED — the revoked sentence in `plan-brief.md` is replaced by the plan's own revision, the effort estimate is marked historical, and `change.md`'s in-sync claim is narrowed to say exactly what stopped being true and why it mattered (`/jira-sync-work` pushes the brief to Jira).

### F5 — Nothing pins the 400 bodies against echoing the input

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/generation/generate.test.ts:161-165
- **Detail**: `expectErrorBody` asserts only `expect(typeof payload.error).toBe("string")`,
  and all six new input-contract cases (:512-651) route through it. So Phase 3 proves the
  status **and** the absence of a write, but nothing proves the 400 body does not reflect
  the submitted value back. The invariant this change puts in `test-plan.md` §6.3 is
  broader than what it pinned: "every `error` string an endpoint returns comes from a
  closed set of module-level literals, never from an upstream message, an exception, a Zod
  issue, **or user input**" — and the only place that is asserted is 502/422 in
  `failure-path.test.ts`. The 400 path is where user input is closest to the response, and
  it is the branch where a future `parsed.error.message` or a Zod issue relay would land
  (`generate.ts` currently discards them, which is why this is a coverage gap rather than a
  live defect). The per-case markers already in the file make this nearly free.
- **Fix**: In `expectErrorBody`, read `await response.text()` first, assert
  `not.toContain(<the case's marker>)`, then `JSON.parse` — passing the marker in as a
  second argument from each case.
- **Decision**: FIXED — `expectErrorBody` now reads the RAW body, asserts it carries neither the run `suffix` nor any explicitly-passed submitted value, and only then parses. Confirmed by breakage: making the Zod branch interpolate `JSON.stringify(rawBody)` turns **7 of 20** red, all on the new assertion.

### F6 — The "trims back under" comment is wrong about what the client sends

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/generation/generate.test.ts:532-535 (and plan.md:602-604)
- **Detail**: The comment states the client "agrees with the server here only because
  `maxLength` also counts raw characters — by coincidence of both being pre-trim, not by
  construction". The island does not send the raw string:
  `GeneratorForm.tsx:128` does `const text = sourceText.trim()` and `:135` sends
  `sourceText: text`. So the client's own bound is **post-trim** and the server never
  receives the untrimmed body from the UI at all — the parity conclusion survives, but for
  the opposite reason, and `maxLength` is not what secures it. A related inconsistency sits
  in the island itself: `maxLength={SOURCE_MAX}` (:294) counts raw characters while
  `aria-invalid` (:296) counts `sourceText.trim().length`. The assertion under the comment
  is correct and valuable; only the explanation is wrong. Flagged because this change's
  whole thesis is that a comment stating something false is worse than no comment — it is
  the defect class `change.md` item 4 names.
- **Fix**: Correct the comment to say the island trims before sending, so the raw-string
  cap is a server-only guard against a hand-crafted body (which is exactly what the case
  tests), and align `maxLength` / `aria-invalid` on one string.
- **Decision**: FIXED — the test comment now states the real mechanism (the island trims before submitting, so the raw cap governs only a hand-crafted request). The island's `maxLength` / `aria-invalid` split is **documented rather than changed**: they are two mechanisms on two strings by design — `maxLength` is the browser's input stop and can only count raw, while everything that validates counts trimmed, which is what is actually submitted. Forcing them together would not have been an improvement.

### F7 — `mark`/`scope` duplicated verbatim across two test files

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/generation/failure-path.test.ts:68-76, tests/generation/generate.test.ts:169-174
- **Detail**: The per-case marker helpers — the mechanism that works around the PostgREST
  414 and the file-level namespace rule — exist twice, character for character, while
  `tests/fixtures/` exists as the home for shared test apparatus (`accounts.ts`,
  `session.ts`, `endpoint.ts`). This is the same two-definitions-for-one-rule drift Phase 3
  argues against for `SOURCE_MAX`, one layer over. Secondary: the LIKE pattern is built
  from the case name without escaping `%` / `_`, so a future `mark("bad_count")` silently
  becomes a wildcard that can match another case's rows. Today every case name is
  `[a-z-]`, so both are latent.
- **Fix**: Move `mark`/`scope` into `tests/fixtures/` and import them in both files, adding
  an assertion in `mark()` that the name matches `/^[a-z0-9-]+$/`.
- **Decision**: FIXED — `mark`/`scope` moved to `tests/fixtures/scoping.ts` and imported by both files, carrying the 414 rationale. `mark()` now throws on a case name outside `/^[a-z0-9-]+$/`, closing the unescaped-LIKE-metacharacter half.

### F8 — The `console.*` detector has known blind spots

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/lib/no-logging.test.ts:38,49
- **Detail**: `/console\s*\.\s*[A-Za-z_$][\w$]*\s*\(/` misses `console['log'](x)` (bracket
  access), misses `const c = console; c.log(x)` (aliasing), misses a call split across
  lines because :49 splits on `/\r?\n/` before testing, and fires on `myconsole.log(x)`
  (no word boundary before `console`). The file documents its textual-scanning tradeoff
  honestly but does not name these. It matters more than it looks: the header argues this
  test exists *because* `no-console` is `"warn"` and `npm run lint` is a bare `eslint .`
  with no `--max-warnings` — confirmed, `eslint.config.js:23`, and my own lint run exits 0.
  ESLint does catch the bracket form, so the two together are stronger than either; the
  aliased form is caught by neither.
- **Fix**: Tighten to `/(?<![\w$])console\s*\.\s*(?:[A-Za-z_$][\w$]*|\[)/` and add the
  bracket and `myconsole` forms to the positive-control case at :71-76.

## Notable strengths (not findings)

Recorded because they are unusual and worth preserving as precedent:

- **Phase 5 caught its own breakage check being vacuous.** The plan's check 2 ("make the
  502 body interpolate `err.message`") *passes* against the HTTP-failure case, because
  there `err.message` is `"OpenRouter HTTP <status>"` — nothing private. Rather than
  recording a green check as evidence, a fourth **transport-failure** case was added, after
  which the check goes 1 of 4 red. That is the failure mode this whole plan is about,
  caught on itself.
- **Phase 2 found the plan's breakage split does not reproduce.** Neutering
  `generation_session_update` alone leaves the suite 20/20 green — Postgres applies the
  SELECT policy to an UPDATE whose `WHERE` reads a column — so the checks were re-run
  pairwise and the trap was carried into `test-plan.md` §6.6.
- **Phase 6's manual read found two overstatements in its own §6.6 entry** ("seven bounds
  cases" → six; a claimed `request_payload.messages[1].content` JSON-path assertion that is
  actually a `JSON.stringify(...).toContain(...)` presence check) and corrected them.
- **The `@/lib/openrouter` seam was rejected for the right reason** — doubling it would
  make the `Authorization` header unreachable, so the key-absence assertion would pass
  because nothing was ever sent. That reasoning is now in §6.9 as the load-bearing
  paragraph.
- **Decision**: FIXED — the pattern now requires a non-identifier character before `console`
  and accepts either dotted or bracket access before the call parenthesis (see
  `tests/lib/no-logging.test.ts`), so it catches `console["log"](x)` and no longer fires on
  `myconsole.log(x)`. The positive control gained both bracket spellings, and a new
  negative-control loop covers prose, `myconsole.log(x)` and `const c = console;`. The alias
  blind spot (`const c = console; c.log(x)`) is now written down as accepted — unreachable
  for any textual scan, and missed by ESLint too — rather than left unnoticed.

## Triage outcome (2026-07-26)

All eight findings were triaged and fixed in the same session. Re-verified afterwards against
the whole tree:

| Check | Result |
| --- | --- |
| `npm run lint` (after `astro sync`) | exit **0**, clean |
| `npm run build` | Complete |
| `npm test` | **166 passed / 166, 14 files** — unchanged, as expected: the fixes added inputs and controls to existing `it()`s, not new cases |
| `npx stryker run --mutate "src/lib/auth-errors.ts"` | **93.88%** — 46 killed / 3 survived / 0 uncovered, up from 93.33% / 42 killed |

The three remaining Stryker survivors were re-classified individually and are still
**equivalent**: each strips an `x !== undefined` guard whose removal changes nothing, because
`Object.hasOwn(map, undefined)` is `false` and `undefined >= 500` is `false`. No assertion
added on their account.

Two fixes were confirmed by deliberate breakage rather than assumed, each restored afterwards
with `git diff -- src/` empty:

| Neuter | Result |
| --- | --- |
| Revert F1's `Object.hasOwn` to the bare lookup | **1 of 33 red** in `errors.test.ts`, on `expect(AUTH_MESSAGES).toContain(message)` — the closed-set assertion, not the sentinel one |
| Make `generate.ts`'s Zod branch return `` `…: ${JSON.stringify(rawBody)}` `` | **7 of 20 red** in `generate.test.ts`, every one on F5's new raw-body assertion |

> **Correction line, 2026-07-31 (C10X-34) — the table above is not rewritten.** The first row's
> denominator has moved: `errors.test.ts` held **33** cases on 2026-07-26 and holds **55** now
> (C10X-30, then C10X-34). The row records what was executed that day and stays as it is; do not
> quote "1 of 33" as a current figure, and note the check has not been re-run since.

One finding was fixed **differently from what the report proposed**, and it is worth reading:
**F6**'s recommendation included aligning `maxLength` with `aria-invalid` in `GeneratorForm`.
On inspection that would have been the wrong move — `maxLength` is a native input stop that
can only count raw characters, while `aria-invalid`, `CharCount` and `validate()` all count
the trimmed string, which is the one actually submitted. They are already consistent on the
axis that matters. The split is now documented at the call site instead of forced together.

One follow-up is deliberately left open: `roadmap.md`'s H-03 `Status` is still `not started`
(F3, Fix A). **The owner decided this explicitly at triage** — the row changes when they get
to H-03 — so it is a deferral, not an oversight, and both `roadmap.md` and item 5 of
`change.md`'s "OPEN AFTER THIS CHANGE" now say so in those words. What the fix DID close is
the harmful half: the block no longer instructs a future implementer to rebuild shipped code,
and the summary table carries a warning. Nobody should "tidy" the Status from an unrelated
change.
