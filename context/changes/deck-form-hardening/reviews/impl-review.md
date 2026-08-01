<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Deck Form Hardening (C10X-37)

- **Plan**: `context/changes/deck-form-hardening/plan.md`
- **Scope**: Full plan — Phases 1–6 of 6 (all Progress boxes `[x]`)
- **Date**: 2026-08-01
- **Verdict**: NEEDS ATTENTION at review → **APPROVED after triage** (2026-08-01, same day)
- **Findings**: 0 critical, 4 warnings, 5 observations — **8 fixed, 1 accepted, 0 skipped**

## Post-triage state (2026-08-01)

Every warning and every actionable observation was fixed in this session. The verdict below is
kept as it stood at review rather than rewritten, per this project's dated-correction rule.

| Check | At review | After triage |
|---|---|---|
| `npm test` | 298 / 26 files | **314 / 28 files** |
| Three fresh un-pinned shuffle seeds | 298/298 ×3 | **314/314 ×3** (1357 / 2468 / 8642) |
| `npx tsc --noEmit` · `npm run lint` · `npm run build` | 0 · 0 · 0 | **0 · 0 · 0** (same 6 pre-existing `evals/` warnings) |

Two new guard files, both falsified before being trusted, both restored by MD5:

| Guard | Cases | Falsification |
|---|---|---|
| `tests/lib/no-client-redirect-errors.test.ts` | 3 | importing `REDIRECT_MESSAGES` into `DeckActions.tsx` → **1 of 3** red, file and line named |
| `tests/lib/form-endpoint-guards.test.ts` | 7 | three separate neuters on `decks/index.ts` (`formString` → cast; `try` removed; inline `?error=` literal) → **1 of 7** red each |
| `tests/lib/error-param-guard.test.ts` (extended) | 8 → 10 | a raw read added to `generate.astro` — a page the old guard never looked at — → **1 of 10** red |

Net effect on the residual classes this review named: the `formData()` sweep, the closed set's
membership, the module boundary, and the page-guard's coverage are now all enforced by a test
that can go red, rather than by a comment. The one class left resting on reading is
`cards/[cardPublicId].ts`'s signed-out row, which cannot be controlled without contradicting its
own ordering — stated at the site.

Every finding below is about a **comment, a boundary nothing enforces, or a control gap** — not
one is a functional defect. The shipped behaviour is correct and unusually well evidenced. The
verdict is NEEDS ATTENTION rather than APPROVED because this project's own standard, stated in
the very files this change rewrote, is that a comment which contradicts its code *is* the defect
class — `forms.ts` has now said three different things, and `ServerError.tsx` carries a
"counts corrected by enumeration" note about exactly this failure and is stale again.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria — re-run against the current tree

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 — 6 pre-existing `no-console` warnings in `evals/generation-quality.eval.ts`, unchanged |
| `npm run build` | exit 0 |
| `npm test` | **298 passed / 298, 26 files**, seed `1785565586293` — matches the documented count exactly |
| Three fresh un-pinned shuffle seeds (4242 / 7317 / 9091) | 298/298 each |
| `git status --porcelain` | empty |
| Criterion 1.5 (message grep) | only `src/lib/` hits |
| Criterion 1.8 (number grep over the six bound sites) | no hits |
| Criterion 3.5 (raw `?error=` reads) | 5 hits, every one wrapped (2× `ownedAuthMessage`, 3× `ownedRedirectMessage`) |
| `git diff --stat 465832e..HEAD -- supabase/` | empty — no migration, as planned |
| New/renamed test files | 16 + 8 + 6 + 9 = **39**, matching every documented count |
| `<ServerError` enumeration | 13 JSX usages across 12 files — matches test-plan's C10X-37 entry |

Manual criteria are evidenced in `verification.md` with observed values (spacing measured to
0.1px before/after, the delete-failure red/green pair, the crafted-vs-member banner matrix).
No rubber-stamping found. Phase 1–2's manual items (1.6, 1.7, 2.4) carry their evidence inside
the Phase 3 section's "Real flows" table rather than under their own headings — traceable, but
worth knowing when reading the log top-down.

**Independently verified beyond the criteria.** The content-injection hole is genuinely closed:
the set is closed by construction (every `?error=` producer under `src/pages/api/decks/` passes a
set constant — 12 direct redirects plus 19 `errorUrl()` call sites, all enumerated, no `.message`
/ `String(err)` / user input on any branch); all four sinks on `decks/[publicId]/index.astro`
derive from the single wrapped read at `:94`; no other parameter reaches a trust-carrying surface
(`open`/`edit`/`saved` are compared to literals or used as ids, `generation` is UUID-gated, `q`
goes to a search input); no island reads a URL param back into rendered state. The `try` wraps
exactly one `await` and binds no exception. `deck-limits.ts` imports nothing. No `console.*`, no
`import.meta.env`/`process.env`, no deep relative imports in `src/`. The rename block's one
mutating control creates its own deck (§6.2); every `error` param is asserted by equality; the DB
case asserts `23514` **and** `deck_name_check`. All six plan-review findings (F1–F6) landed.

## Findings

### F1 — The module-boundary rationale is factually wrong, repeated in four places, and enforced by nothing

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `src/lib/redirect-errors.ts:33-36`, `src/lib/deck-limits.ts:15-17`, `src/components/decks/CreateDeckModal.tsx:11-12`, `src/components/decks/DeckActions.tsx:9-10`
- **Detail**: All four sites state some form of *"`redirect-errors.ts` is server-side only because it
  imports `flashcards.ts` for the two card-content bounds, which drags a query layer with it, so no
  island may import this module."* Two measurements contradict it:
  1. `src/lib/flashcards.ts:1-2` has **only `import type`** — zero runtime imports. The Supabase
     client arrives as a function parameter. There is no query layer below `redirect-errors.ts` to
     drag: its whole graph is `deck-limits.ts` (imports nothing) plus function declarations.
  2. `flashcards.ts` is **already in the client bundle**: `CreateFlashcardModal.tsx:9`,
     `FlashcardItem.tsx:4` and `CandidateItem.tsx:4` import `FRONT_MAX`/`BACK_MAX` from it as
     **values**, not types.

  The **split is still the right call** — the read-side guard and an eleven-string vouching set have
  no business in a browser bundle — so no code needs to move. What is wrong is the reason a future
  contributor inherits, and it is wrong in the direction that reads as reassurance: someone who
  checks the claim finds it false and may conclude the rule is cargo-cult and import the module into
  an island. And the rule is enforced by **nothing** — no test asserts `src/components/**` never
  imports `@/lib/redirect-errors`, so the only thing holding it is four comments that do not survive
  a check. This is precisely the class `forms.ts`'s own rewritten header is about.
- **Fix A ⭐ Recommended**: Correct the four comments to the real reason (keep the vouching guard and
  the message set off the client surface; the bundle cost is not the argument), **and** add the
  one-`it()` textual guard that makes the rule real — same shape as `no-logging.test.ts`, asserting
  no file under `src/components/` imports `@/lib/redirect-errors`, with the two positive controls its
  siblings carry.
  - Strength: Closes both halves — the claim becomes true and the constraint becomes falsifiable
    rather than resting on prose the next reader may disbelieve.
  - Tradeoff: One more test file (or one case in an existing guard); the comment edit touches four
    files including two islands.
  - Confidence: HIGH — the guard pattern exists three times in this repo already, and the import
    surface is a single grep.
  - Blind spot: Have not checked whether a bundle-size assertion would be a better long-term guard
    than an import scan.
- **Fix B**: Correct the four comments only, and leave the rule as a convention.
  - Strength: Minimal edit; the rule has never been broken.
  - Tradeoff: Leaves the constraint enforced by reading — the same posture that let the `formData()`
    sweep be found incomplete twice.
  - Confidence: MEDIUM — safe today, and the failure mode is a silently fattened island bundle.
  - Blind spot: Nothing would report the first violation.
- **Decision**: FIXED via Fix A — corrected the rationale at `redirect-errors.ts:33`, `deck-limits.ts` and `CreateDeckModal.tsx` (`DeckActions.tsx` carried no false reason, so it was left), and added `tests/lib/no-client-redirect-errors.test.ts` (3 cases, two positive controls). Falsified: importing `REDIRECT_MESSAGES` into `DeckActions.tsx` turns **1 of 3** red naming file and line; restored, MD5 `d36a4c4a…` identical.

### F2 — `ServerError.tsx`'s call-site counts are stale again, and its "every one DYNAMICALLY" claim is now false

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/auth/ServerError.tsx:20-32`
- **Detail**: The comment reads "NINE other components render this at TEN call sites, **every one of
  them DYNAMICALLY**", and its own correction parenthetical says "twelve sites across eleven
  components … ten of them off auth". Measured now (`grep -rn "<ServerError" src/`, minus the two
  comment lines inside the component itself): **13 JSX usages across 12 files**. The thirteenth is
  `src/pages/decks/[publicId]/index.astro:170` — added by *this* change — and it is **not** a dynamic
  insertion: it arrives at mount via a full-page redirect, which is exactly the weak case the plan
  (Phase 3 §2) insists must not be overclaimed.

  So the comment both undercounts and **misclassifies the site this change introduced**, and that is
  the part that bites: "every one of them DYNAMICALLY" is the load-bearing argument the comment uses
  to justify putting `role="alert"` on the shared component, so a reader reasoning from it concludes
  the new site is a strong-announcement case — which the plan explicitly denies. `test-plan.md`'s
  C10X-37 entry carries both the 13/12 count and the weaker claim correctly; the component's own
  comment, the one a contributor actually reads at the site, was not brought along. Second time this
  comment's counts have gone stale.
- **Fix**: Update to "13 call sites across 12 files, ten of them off auth", and carve the `.astro`
  site out of the "every one of them DYNAMICALLY" group as a second at-mount case alongside auth —
  as a dated correction line, matching how the file already handles its first miscount.
- **Decision**: FIXED — counts corrected to 13 sites / 12 files / eleven dynamic, and the `.astro` site carved out as the SECOND at-mount case with announcement explicitly not claimed. Recorded as a dated third correction rather than a silent edit.

### F3 — The page-wiring guard is scoped to a hardcoded two-directory allowlist

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `tests/lib/error-param-guard.test.ts:65-73`
- **Detail**: `SURFACES` names `src/pages/auth` and `src/pages/decks` only. A future `.astro` page
  anywhere else under `src/pages/` — `study/[publicId].astro`, `generate.astro`, a new surface — that
  reads `?error=` raw into a banner is **invisible** to this guard: it is not scanned, nothing fails,
  nothing is reported. That is a narrower shape than its two siblings in the same folder,
  `no-logging.test.ts` and `no-env-access.test.ts`, both of which walk the whole of `src/`.

  No live defect (verified: no other page reads the parameter). The risk is the shape this repo has
  paid for repeatedly and which is literally why C10X-37 exists — an incomplete sweep left unstated.
  The guard's per-surface table is genuinely valuable and should stay; what is missing is the
  catch-all beneath it.
- **Fix**: Keep the table and the foreign-helper case, and add one repo-wide `it()`: walk
  `src/pages/**/*.astro`, subtract the registered surface directories, and assert the remainder
  carries no `RAW_READ` at all. A new page then either registers a surface or goes red.
- **Decision**: FIXED — added a repo-wide `describe` to `error-param-guard.test.ts`: every `.astro` page outside the registered surfaces must carry no `?error=` read at all, with its own positive control (walker reach AND that registered dirs are genuinely excluded). File 8 → 10 cases. Falsified: a raw read added to `generate.astro` — a page the old guard never looked at — turns **1 of 10** red naming file and line; restored, MD5 `68343f0e…` identical.

### F4 — Three comments state facts that do not hold

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/redirect-errors.ts:73`; `src/pages/api/decks/[publicId].ts:41` (copied at `tests/validation/decks.test.ts:399`); `tests/validation/signed-out.test.ts:42`
- **Detail**: Three separate wrong numbers, all in comments this change wrote:
  1. `redirect-errors.ts:73` — "**Two** of these constants are also reused, verbatim, by the three
     JSON endpoints". It is **three**: `api/generate.ts` imports `SUPABASE_UNCONFIGURED_MESSAGE`,
     `DECK_NAME_TAKEN_MESSAGE` **and** `DECK_CREATE_FAILED_MESSAGE`; `api/study.ts` and
     `cards/batch.ts` each import the first.
  2. `[publicId].ts:41` — `errorUrl` is "built from the route param at `:26`, **eleven lines above**".
     It is defined at `:28` (`:26` is the 404 return) and sits **17** lines above the `formData()`
     read at `:45`.
  3. `signed-out.test.ts:42` — "`!supabase` is checked BEFORE `!user` on **four** of the six". It is
     **six of six** (`decks/index.ts:25/30`, `[publicId].ts:31/35`, `delete.ts:24/28`,
     `cards/index.ts:33/37`, `cards/[cardPublicId].ts:67/71`, `cards/[cardPublicId]/delete.ts:24/28`).

  Every substantive claim around them holds — `errorUrl` really is in scope and UUID-gated before the
  catch; preflight really does guarantee the env vars; the JSON reuse really is copy-only. No
  assertion is affected. Grouped as one finding because they are one class and one pass fixes them.
- **Fix**: Correct all three (and the copy at `decks.test.ts:399`).
- **Decision**: FIXED — `redirect-errors.ts:73` "two" → "THREE" with the three constants named; `[publicId].ts:41` and its copy at `decks.test.ts:399` no longer claim ":26, eleven lines above"; `signed-out.test.ts:42` "four of the six" → "ALL SIX".

### F5 — Three JSON endpoints import the closed set — unplanned, and it widens what `REDIRECT_MESSAGES` means

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `src/pages/api/study.ts:7-10`, `src/pages/api/decks/[publicId]/cards/batch.ts:5-7`, `src/pages/api/generate.ts:11-19`
- **Detail**: Phase 1 §3 scoped the import sweep to "all six endpoints under `src/pages/api/decks/`"
  — the six redirect-style ones; `test-plan.md` explicitly excludes `batch.ts` from that six. Phase 1
  §4 scoped `generate.ts` to the **bound** only (`newDeckName` Zod). `study.ts` appears only under
  "What We're NOT Doing". All three now import message constants from `redirect-errors.ts`.

  Their JSON convention is genuinely unchanged and all three carry a comment saying so, so this is a
  deliberate, well-annotated extension rather than drift — and single-sourcing identical copy is the
  change's own thesis. What it costs is definitional: `REDIRECT_MESSAGES` is documented as "every
  value the six redirect-style endpoints can ever put in `?error=`", and the module is now also the
  home for JSON-endpoint copy. The residual risk is small and one-directional: a contributor adding a
  JSON-only message as a constant **and** to the array would make it vouchable on the `?error=`
  channel where no producer emits it. Nothing today does this — the array holds exactly the eleven
  redirect literals.
- **Fix**: Keep the reuse; add one line to the `REDIRECT_MESSAGES` docblock stating that the **array**
  is the redirect channel's set — constants may be shared with JSON endpoints, array membership must
  not follow them.
- **Decision**: FIXED — the `REDIRECT_MESSAGES` docblock now states that the ARRAY is the redirect channel's set ("share the constant, not the membership"), and `redirect-errors.test.ts` gained a size pin: exactly 11 members, all distinct. A JSON-only message added to the array now goes red with an explanation of the question to answer.

### F6 — Both sweeps this change relies on are enforced by reading, not by a guard

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/forms.ts:28-31`; `src/lib/redirect-errors.ts:66-90`
- **Detail**: Not a defect — both sweeps are complete today and I re-verified both by enumeration.
  The observation is the residual class, which `forms.ts` now names in its own words: "no test
  enumerates the readers — the sweep was found incomplete twice by reading, not by a red run."
  Two claims rest on that posture:
  - **The `formData()` guard.** A seventh form endpoint written tomorrow with a bare `formData()` and
    an `as string | null` cast re-opens the class **silently**. C10X-30 swept four of six and its
    review caught the gap; C10X-34 re-recorded it; C10X-37 closed it — three reviews for one class.
  - **Set membership.** Nothing fails if a future endpoint inlines a new `?error=` literal; the
    failure mode is a silently disappearing banner (fail-safe, but quiet, and the module says so).

  Both are cheap to close with the pattern this repo already uses three times: a textual scan over
  `src/pages/api/**` asserting every `formData()` read is inside a `try` and every `form.get(...)`
  goes through `formString`, and a second asserting every `error=${encodeURIComponent(X)}` has `X` as
  an identifier imported from `@/lib/redirect-errors`. Both want the two positive controls the
  sibling guards carry.
- **Fix**: Raise as a follow-up rather than an in-place edit — these are new claims, not corrections,
  and they share an owner with F1's and F3's guards (one guard file could carry all four cases).
- **Decision**: FIXED — built now rather than deferred. `tests/lib/form-endpoint-guards.test.ts` (7 cases, two positive controls) pins BOTH sweeps: exactly six `formData()` readers, each directly under a `try {`; every `form.get()` narrowed through `formString`; and no deck route interpolating a quoted literal into `?error=`, with every producer importing the closed set. Falsified three ways on `decks/index.ts` — `formString` → cast, `try` removed, and an inline literal — each turning **1 of 7** red naming file and line; restored, MD5 `5e6e2621…` identical.

### F7 — `signed-out.test.ts` controls only 3 of its 6 rows, and two of the three gaps are cheaply closable

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `tests/validation/signed-out.test.ts:174-196`
- **Detail**: Three rows (`decks/[publicId]/delete`, `cards/[cardPublicId]/delete`,
  `cards/[cardPublicId]`) have no signed-in control, so each would still pass if its handler returned
  `/auth/signin` unconditionally. The file states this and attributes it to its "NO DATABASE"
  constraint at `:32-34`.

  For the **card-edit** row the constraint is real — its reachable-without-a-query branch runs before
  the user check. For the **two delete endpoints** it is a choice rather than a constraint: with a
  fabricated user and the already-nonexistent `DECK_PUBLIC_ID`, the handler runs one RLS-scoped
  query, finds nothing, and answers `404` — so a `not.toBe("/auth/signin")` control needs no fixture,
  no account and no seeded row, only one round-trip against the stack preflight already requires.
  Worth taking, since the file's stated purpose is closing this branch **as a class**.
- **Fix**: Add a `not.toBe("/auth/signin")` control for the two delete endpoints; leave the card-edit
  row uncontrolled with its existing reason, and say in the header that 5 of 6 are controlled.
- **Decision**: FIXED — the two delete endpoints got controls in their own `describe`, kept separate so the main block's "no database" promise stays literally true. Which branch they reach was MEASURED, not predicted, and the first guess was wrong: `init_core_schema` revokes table privileges from `anon`, so the delete errors rather than returning zero rows, and the endpoint answers its own delete-failure copy — asserted by equality, the same rigour as the other three controls. The header's "NO DATABASE" claim was corrected rather than left overstated. 5 of 6 endpoints now controlled; `cards/[cardPublicId].ts` stays uncontrolled with its real reason.

### F8 — `deckNameExists` discards its query error, on lines this change rewrote

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/decks/index.ts:56`, `src/pages/api/decks/[publicId].ts:57`
- **Detail**: `const { data: existing } = await deckNameExists(...)` drops `error`, against this
  project's own recorded lesson ("Loadery SSR rozróżniają błąd zapytania od braku danych") that
  `cards/index.ts:71-73` and `review.astro:61` follow explicitly. The consequence is benign — a
  transient failure leaves `existing` null, execution falls through to `createDeck`/`renameDeck`,
  which errors into `DECK_CREATE_FAILED_MESSAGE`/`DECK_RENAME_FAILED_MESSAGE`, so the user still gets
  an owned refusal rather than a wrong success. Pre-existing (confirmed by diff) and not introduced
  here, but this change rewrote the adjacent lines and left it.
- **Fix**: Branch on the error and redirect with the endpoint's existing failure literal — no new set
  member needed. Or leave it and note the deliberate exception at the site.
- **Decision**: FIXED — both endpoints now branch on `lookupError` and redirect with their existing failure literal, so no new set member was needed. Recorded at both sites that this was never a wrong SUCCESS (a dropped error fell through to createDeck/renameDeck and surfaced the same copy from there), so the gain is naming the failure where it happens.

### F9 — `jira-map.md`'s Change ID is filled on the map side only

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/jira-map.md:61`
- **Detail**: Phase 6 §3 contracted "C10X-37's `Change ID` is empty on both sides; this is the moment
  it is filled with `deck-form-hardening`." The map cell now reads `deck-form-hardening ⚠ tylko po
  stronie mapy`, and `:187-194` records why: Jira's `customfield_10041` is still unset because
  `/10x-implement` writes nothing to Jira, so both ends close at `/jira-finish-work`. A reasoned,
  written-down deferral rather than an omission — flagged only so it is not lost, since the same file
  also carries C10X-40 (the read-side ticket whose work shipped here) as still-to-be-closed.
- **Fix**: None now. At `/jira-finish-work`, set C10X-37's `Change ID` in Jira and close C10X-40
  against this change (linked to C10X-37, pointing at both the current folder and its future archive
  path), then drop the ⚠ marker.
- **Decision**: ACCEPTED — a deliberate, documented deferral, not an omission. The Jira write belongs to `/jira-finish-work`, which carries the artifact fields with it. Standing action there: set C10X-37's `Change ID`, close C10X-40 against this change, drop the ⚠ marker.
