# test-plan.md refresh for the arrival of e2e — Implementation Plan

## Overview

A documentation-only refresh of `context/foundation/test-plan.md` (plus three sites outside it)
triggered by `/10x-test-plan --refresh` on 2026-08-05. It corrects what the guide asserts today
that is **false**, adds a §3 Phase 6 row as `not started`, re-dates three §7 exclusions whose
re-evaluation trigger turned out to be mis-keyed, and records the decisions taken during
research. **It does not build the e2e layer** — that is the job of the phase this refresh adds.

## Current State Analysis

A Playwright harness landed in commits `8a12d07` and `5f3c87e`: `playwright.config.ts` (11
lines), `tests/e2e/seed.spec.ts` (43 lines), `@playwright/test@^1.62.1`, and three `.gitignore`
entries. It landed **outside** the phased rollout, exactly as C10X-39, C10X-40, C10X-42 and
C10X-43 did.

Every relevant fact below was measured during research (`research.md`), not inferred:

- **The e2e layer is already inside the type gate and no document knows it.**
  `npm run typecheck` → `Result (135 files): 0 errors`. Exactly two files were added since
  `ebe1d92`; `npx tsc --showConfig` resolves both as project members.
  `117 roots + 18 .astro = 135` today, against the documented `115 + 18 = 133`.
  The gate stayed green because it asserts
  on a **floor** (`test-plan.md:24-25`), which is correct design and also why nothing announced
  the change.
- **`133` appears in exactly two places**, and they need opposite treatments: `README.md:49`
  (live claim) and `test-plan.md:2765` (a row in §6.6's dated C10X-43 claims table).
  **`AGENTS.md` quotes no total** — the brief was wrong about it.
- **`18 .astro` is still true** (`git ls-files '*.astro' | wc -l` → 18).
- **The §7 triggers never literally fired.** All three read "the moment any §3 phase wires e2e",
  and no §3 phase did.
- **Two of the brief's six harness risks are stale**: #5 is CLOSED by `5f3c87e`; #6 inverts on
  one axis (the harness issues **zero** auth requests per run).
- Three findings not on that list: `trace: "on-first-retry"` can never fire (no `retries`,
  default `0`), there is **no npm script and no browser-install step**, and
  `playwright-report/`, `blob-report/`, a root `.last-run.json` and `*-snapshots/` remain
  unignored (latent — the default reporter produces none of them).

## Desired End State

`test-plan.md`, `README.md` and `lessons.md` contain no statement about e2e or about the type
gate's denominator that is false on 2026-08-05, and the guide carries a §3 Phase 6 row a future
`/10x-new` can pick up. Verifiable by: the greps in each phase's Success Criteria returning the
stated counts; `npm run typecheck` still reporting 135/0; `npx prettier --check` passing and
being idempotent; and `git diff --stat` touching no file under `src/`, `tests/`, `evals/` or
`scripts/`.

### Key Discoveries:

- `tsconfig.json:3` — `include: ["**/*"]` excluding only `dist`/`context` is the mechanism by
  which the two e2e files silently entered the gate.
- `test-plan.md:24-25` — the gate asserts against a **floor**, so a rising count cannot go red.
- `test-plan.md:680` — §4's e2e row: `none yet — deliberately deferred`, version cell `—`, and
  **`No rollout phase claims e2e`**, which is true _until this change adds the Phase 6 row_.
- `test-plan.md:710-712` — §5's closing paragraph. The clause
  `no §3 phase wires it, so listing it as a gate would be aspirational`
  survives on a different footing once Phase 6 exists as `not started`.
- `test-plan.md:3227-3243`, `:3256-3258`, `:3279-3293`, `:3524` — the four sites carrying the
  mis-keyed trigger (the last one is in **§8**, not §7 — easy to miss on a §7-scoped list).
- `test-plan.md:3368-3370` — the three ledger dates, all `2026-07-15`.
- `lessons.md:184` — cites `roadmap.md:234` for the archive-ownership sentence, which lives at
  `roadmap.md:401`.

## What We're NOT Doing

- **Not building the harness or the journeys.** No `playwright.config.ts`, no spec, no npm
  script, no CI job, no `webServer`, no preflight, no `storageState` producer.
- **Not touching `.gitignore`.** The three unignored artifact classes are a written-down
  deferral to the phase (decision 4) — latent under the default reporter.
- **Not adding a §6.11 "adding an e2e test" subsection.** §6 gets two sentences (decision:
  §6.1/§6.2 trap notes) and nothing else; the subsection belongs to the phase.
- **Not creating `H-12` or `C10X-45`.** Both are reserved for the phase and only NAMED here.
  `jira-map.md` is owned by `/jira-backlog-sync` (`jira-map.md:3-4`) and must not be hand-edited.
- **Not touching §1 or §2.** No risk row moves; e2e introduces no new product failure scenario.
- **Not editing `AGENTS.md` on the denominator axis** — it quotes no total.
- **Not restating a suite figure.** No test changes, so no measured total is claimed.

## Implementation Approach

Seven phases, ordered by a consistency constraint rather than by file. §3 is written **before**
§4's and §5's clauses are finalised, because adding the Phase 6 row is what turns
`No rollout phase claims e2e` from true to false. The file must be internally consistent after
**all** edits, not after each one.

Three correction conventions are in play and must not be mixed up. A **live** claim is edited in
place, and only its false half. A **dated record** (a §6.6 entry, a §8 ledger entry, an archived
artifact) takes an appended dated correction and is never rewritten. A **conditional clause whose
trigger was mis-keyed** is replaced by a re-decision dated 2026-08-05 that says the condition was
never literally met.

## Critical Implementation Details

**Prettier is a live hazard on this file, and husky now runs it.** §8 records that
`npx prettier --write` was **destructive and non-idempotent** on `test-plan.md` — a code span
split across two lines inside a blockquote lost its `> ` continuation marker on the first pass,
and a second pass collapsed the whole correction block into one line. C10X-43 fixed that instance
and normalised the file to a fixed point, and installed husky for the first time in this tree. So
`lint-staged` will now run `prettier --write` on `test-plan.md` at commit time. `.prettierignore`
covers `context/archive/**` only — **not** `context/foundation/`. Every phase must therefore leave
the file prettier-clean, and Phase 7 must prove idempotency by writing twice and diffing. Never
break a code span across a line inside a blockquote.

**Measured 2026-08-05, and it is not the file this note was written about**: `README.md` and
`test-plan.md` both pass `prettier --check` at `HEAD`; **`context/foundation/lessons.md` does
not** — it exits 1 on two trailing-whitespace lines (`:204`, `:211`). So the hazard is live on the
one document nobody checked. Phase 6 owns it.

**Ordering:** §3 (Phase 3) before §5 (Phase 4). Writing §5's "no §3 phase" clause against the
pre-change §3 produces a file that contradicts itself.

---

## Phase 1: Denominator corrections

### Overview

Correct the two sites quoting `133`, in opposite ways, and record the fact the number's change
reveals: the e2e layer is already inside the type gate.

### Changes Required:

#### 1. README's script list

**File**: `README.md`

**Intent**: Stop stating a total at all, and in the same sentence state that the gate now covers
the e2e layer — which is the fact the changed number was made of. This is a scope correction, not
a coverage claim.

**Contract**: Line 49, the `npm run typecheck` bullet. **Remove the total** (`over all 133
files` → a clause naming the scope with no count) rather than replacing `133` with `135`. Reason,
and it is the plan's own evidence: the gate asserts on a **floor** (`test-plan.md:24-25`)
precisely so a rising count cannot go red, and the count measured 133, 135, 136 and 135 again
inside four days — a live claim pinned to it re-rots by construction, which is the denominator
class §8 records four times. **`AGENTS.md:22` already states this identical gate with no total**,
which is why research found it needed no correction on this axis; match that wording. The clause
``the 18 `.astro` templates `tsc` cannot see`` is **true and must survive verbatim** — it is a
category, not a moving total. The directory enumeration (`src/`, `tests/`, `evals/`, `scripts/`,
the root configs) is also true and survives — `tests/` now additionally contains `tests/e2e/`,
which is the fact to add. Do not touch the `pre-push` half of the sentence.

**Do not over-apply this to §2 below.** A count inside a **dated correction block** is the right
place for one: it is a measurement carrying its own date, not a standing claim. §2 keeps its
`135` / `117`.

#### 2. §6.6's C10X-43 claims table

**File**: `context/foundation/test-plan.md`

**Intent**: Record that the row's two figures are superseded without rewriting the row, because
it is a dated record of what C10X-43 measured on 2026-08-03 and that measurement was correct.

**Contract**: Line 2765 carries `astro check` (133 files) and `tsc --noEmit` (115 roots). The row
text stays byte-identical. A `> **Corrected 2026-08-05 …**` blockquote is appended after the
claims table giving `135` / `117`, naming the two files that account for the delta, and stating
that the floor assertion is why nothing went red. Follow the shape of the existing correction
blocks in §6.6 (e.g. the C10X-42 and C10X-43 blocks).

### Success Criteria:

#### Automated Verification:

- `grep -c "over all 133 files" README.md` returns `0`
- README states **no** file total: `grep -cE '\b(133\|135\|136)\b' README.md` returns `0` (`133` is its only such hit at `HEAD`), while ``grep -c '18 `.astro` templates' README.md`` still returns `1`
- The §6.6 row at `:2765` is **byte-identical to `HEAD`**: `git diff HEAD -- context/foundation/test-plan.md` shows no hunk touching that line. Assert it this way rather than with `grep -c "(133 files)" … returns 1` — a correction block conventionally quotes the figure it supersedes, so that count legitimately becomes `2` and the criterion would push the writer toward a vaguer correction just to keep a grep green
- `grep -c "Corrected 2026-08-05" context/foundation/test-plan.md` returns at least `1`
- `npx prettier --check README.md context/foundation/test-plan.md` exits 0

#### Manual Verification:

- The README sentence reads as one coherent claim, not a corrected number bolted onto a stale clause
- The §6.6 correction block explains _why_ the gate stayed green (floor, not pinned count), so a reader does not conclude the gate is broken

---

## Phase 2: §4 Stack — earn the date, then replace the e2e row

### Overview

Re-verify the versions §4 asserts, so Phase 7's ledger date is a measurement rather than a claim,
then replace the `e2e` row and correct the tooling line.

### Changes Required:

#### 1. Version re-verification (no edit unless a version moved)

**File**: `context/foundation/test-plan.md` (§4 table + "Stack grounding tools" list)

**Intent**: The decision to move all three §8 ledger dates to 2026-08-05 makes those dates
assertions that a review happened. Do the review.

**Contract**: Check each version §4 states against what is installed — Vitest, Astro (for the
Container API row), the Supabase CLI, `eslint-plugin-jsx-a11y`, `@playwright/test`, and the judge
model constant in `evals/lib/judge.ts`. Record every observed value in `## Progress` notes. Where
a stated version has moved, correct it; where it has not, change nothing. Re-check the
"Stack grounding tools" availability lines the same way.

#### 2. The `e2e` row

**File**: `context/foundation/test-plan.md`

**Intent**: Replace a row that says the layer does not exist with one that says what exists and,
just as importantly, what it cannot yet do.

**Contract**: Line 680. Tool cell → Playwright; Version cell → `1.62.1`; Notes cell must carry a
`checked: 2026-08-05` date (required by §4's own header at `:671-672`) and must **not** claim
runnability the harness lacks: there is no npm script, no CI job, no browser-install step, no
`webServer` and no preflight. `No rollout phase claims e2e` is **false after Phase 3** and must
be replaced by a clause naming §3 Phase 6 as `not started`. Point the reader at §3's sequencing
note rather than duplicating the harness audit here.

#### 3. The `claude-in-chrome` tooling line

**File**: `context/foundation/test-plan.md`

**Intent**: Correct a clause that was already contradicted by §7 when it was written, and a stale
date.

**Contract**: Line 688, which carries **two** false clauses, not one — the second is easy to miss
because it sits after an `and` on the same line. (a) `no §2 risk is DOM-unreachable` is false —
§7's focus-ring bullet says a computed style in a real browser is required. (b)
**`and no phase claims e2e`** is the exact twin of the clause Phase 2 §2 rewrites in §4's e2e row,
and it becomes false for the same reason and at the same moment: when Phase 3 adds the §3 Phase 6
row. So this line inherits the **same ordering dependency** as §4's row and §5's paragraph —
finalise it after Phase 3, and word it to match them on the claims-vs-wires distinction.
`not used` remains true of claude-in-chrome specifically. Update `checked:`.

### Success Criteria:

#### Automated Verification:

- `grep -c "none yet — deliberately deferred" context/foundation/test-plan.md` returns `0`
- `grep -c "Playwright" context/foundation/test-plan.md` returns at least `1`
- The §4 e2e row contains `1.62.1` and `checked: 2026-08-05`
- Every version stated in §4 matches its installed value (commands and outputs recorded in Progress)
- `npx prettier --check context/foundation/test-plan.md` exits 0

#### Manual Verification:

- The e2e row does not read as "we have e2e coverage" — a reader learns a runner exists and that nothing runs it automatically
- The re-verification actually happened for every §4 row, not just the ones that were convenient

---

## Phase 3: §3 — the Phase 6 row and the harness sequencing note

### Overview

Add the rollout row, then the full harness audit as a sequencing note — the decision was
explicitly "full, all nine with verdicts".

### Changes Required:

#### 1. The §3 rollout table

**File**: `context/foundation/test-plan.md`

**Intent**: Give the e2e work a row so it runs the full `/10x-new → research → plan → implement`
chain instead of repeating the C10X-39/40/42/43 orphan pattern.

**Contract**: The §3 table (rows at `:539-545`) gains row **6**, matching the existing column
set: Phase name, Goal (one line), Risks covered = `#1` and `#6`, **extending — no §2 row
changes**, Test types = e2e (Playwright), human-triggered, Status = `not started`, Change folder
= `—` until the phase opens one. The `Status` vocabulary is the file's existing four values.

#### 2. The sequencing note

**File**: `context/foundation/test-plan.md`

**Intent**: Hand the phase everything research measured, so its own research starts from verdicts
rather than from a re-audit — and so a reader of the guide alone learns the harness is not yet
trustworthy.

**Contract**: A new bullet in §3's "Sequencing notes" list, following the shape of the Phase 2
and Phase 3 notes. It must carry: **sub-phase 6.1 (a Playwright preflight) as an entry condition
that blocks the rest of the phase**, not a follow-up; the six brief risks with their measured
verdicts (**4 LIVE, #5 CLOSED by `5f3c87e`, #6 LIVE but inverted on the rate-limit axis — zero
auth requests per run**); and the three findings not on that list (inert `trace`, no npm script
and no browser install, the four latent unignored artifact classes). It must also state the two
scope decisions that would otherwise be rediscovered: **journey C (SRS) is deliberately out**
because Risk #3 is covered on both halves by unit + integration, and **journey B's mandate is
"the guard is mounted and executes on a real request"**, never "`PROTECTED_ROUTES` has a test" —
`tests/middleware.test.ts` already drives `it.each(PROTECTED_ROUTES)` on both branches, and
`lessons.md:135` names the gap a Container-API test cannot reach. Add the deck-page oracle as
response guidance (count `getByRole("button", { name: "Edytuj" })`, one per card; **`Usuń`
over-counts by one**), with the reason the review-screen metric was rejected: that screen calls
`window.location.reload()` itself and the metric line hides silently on an aggregate error.

### Success Criteria:

#### Automated Verification:

- The §3 table has six phase rows and row 6's Status cell reads `not started`
- The sequencing note names all nine harness findings — checked by grepping the note's **own line range** (`sed -n '<start>,<end>p'` piped to grep), never the whole file. Measured at `HEAD`, three of the nine tokens already occur file-wide — `preflight` ×18, `trace` ×5, `.gitignore` ×4 — so a file-wide grep passes those three whatever the note says: the unfalsifiable-assertion class §6.6 records against `listDueCounts`. The other six (`storageState`, `webServer`, `.spec.ts`, auth-request count, npm script, browser install) are `0` at `HEAD` and are falsifiable either way
- The §2 Risk Map section is byte-identical to `HEAD` (extract the section between the `## 2.` and `## 3.` headings and diff)
- `npx prettier --check context/foundation/test-plan.md` exits 0

#### Manual Verification:

- The note reads as a hand-off to the phase's own research, never as a coverage claim about work that has not happened
- A reader who stops after §3 understands that the harness exists **and** that it is not yet trustworthy

---

## Phase 4: §5 — the gate row and the closing paragraph

### Overview

Add the gate-table row the decision calls for, with cells that do not overclaim, and correct the
closing paragraph against the §3 row that now exists.

### Changes Required:

#### 1. The gate table

**File**: `context/foundation/test-plan.md`

**Intent**: Put the "never a gate" rule where it is scannable, alongside the file's four existing
`optional, human-triggered` rows.

**Contract**: The table at `:697-708` gains an e2e row. `Where` must state the truth: local only,
`npx playwright test` against a hand-started dev server — no npm script, no CI job. `Required?`
must carry **never a gate — nothing may declare it in `needs:`**. Do **not** use the file's
`planned` vocabulary: `planned` means "will be enforced once the phase lands", and the decision is
the opposite. `Catches` names the two journeys' claims.

#### 2. The closing paragraph

**File**: `context/foundation/test-plan.md`

**Intent**: Correct the half that is false while keeping the half that is the reason e2e is not a
gate.

**Contract**: Lines 710-712. `e2e on critical flows is deliberately absent` is false and goes.
`Add it only if a risk survives the integration layer` is superseded and goes. The reasoning
`listing it as a gate would be aspirational` survives but must be re-based: after Phase 3 a §3
phase _claims_ e2e while nothing _wires_ it, so the paragraph must distinguish the two and match
the wording chosen in §4's row. This paragraph and `test-plan.md:680` are one claim split across
two sections — write them together.

### Success Criteria:

#### Automated Verification:

- `grep -c "e2e on critical flows is deliberately absent" context/foundation/test-plan.md` returns `0`
- The §5 gate table contains an e2e row whose `Required?` cell contains both `never` and `needs:`
- `grep -c "planned" context/foundation/test-plan.md` is unchanged from `HEAD` — the new row did not borrow that vocabulary
- `npx prettier --check context/foundation/test-plan.md` exits 0

#### Manual Verification:

- §4's row and §5's paragraph agree with each other and with §3's new row on the claims/wires distinction — read all three in sequence
- The gate row cannot be misread as "there is a documented command that runs the e2e suite"

---

## Phase 5: §7 re-decisions and the §8 twin clause

### Overview

Re-date three exclusions and one nested deferral, describing the trigger as mis-keyed rather than
as fired, and handle the fourth site carrying the same clause — which is in §8.

### Changes Required:

#### 1. The two §7 exclusions

**File**: `context/foundation/test-plan.md`

**Intent**: The exclusions stay excluded; what changes is that the condition they were keyed on
turned out to be unreachable, so leaving them unreconsidered would make them dead clauses.

**Contract**: `:3227-3243` (focus-ring rendering) and `:3279-3293` (React islands' fetch
handling). In each, the clause `Re-evaluate the moment any §3 phase wires e2e…` is replaced by a
re-decision dated **2026-08-05** stating that the trigger was **mis-keyed — the harness landed
outside the rollout, so the condition was never literally met** — and that the exclusion stands.
Adjacent clauses that are now false must be corrected in the same pass, and only those:
`the e2e / visual-diff layer §4 and §5 deliberately do not have` (`:3237-3238`) is **half**
false — visual-diff genuinely does not exist; and `untested by _construction_` (`:3279`) plus
`no layer in this plan could see the difference` (`:3287-3288`). The rules
`Until then the guard is the measured acceptance check…` and `reviewed by reading, deliberately
and every time` **survive** — one exemplar spec covers one flow, not the class.

#### 2. The nested `scroll-padding-top` deferral

**File**: `context/foundation/test-plan.md`

**Intent**: Its stated blocker — "needs its own browser verification" — is removed, so it needs a
dated re-decision like the others.

**Contract**: `:3256-3258`, inside the focus-ring bullet's correction block. The statement
`2.4.11 is Focus Not Obscured, and nothing tests it` (`:3245-3246`) remains true and is untouched.

#### 3. The twin clause in §8

**File**: `context/foundation/test-plan.md`

**Intent**: The same sentence appears a fourth time in a **§8 ledger entry** (C10X-30, Risk #6's
island half). A §7-scoped edit list misses it.

**Contract**: `:3524`. This one is a **dated record**, so it takes an appended correction rather
than an in-place replacement — the opposite treatment from sites 1 and 2 above.

### Success Criteria:

#### Automated Verification:

- Each of the **four sites named in the Contract** (`:3227-3243`, `:3256-3258`, `:3279-3293`, `:3524`) sits inside a block that also contains `2026-08-05` — checked per anchor, never by a hit count. **A hit count would be wrong twice over**, measured at `HEAD`: a literal grep for `Re-evaluate the moment any §3 phase wires e2e` returns **2**, not 4, because `:3237-3239` **wraps the phrase across a line break** ("any §3 phase\n wires e2e") and `:3256-3258` never carried the clause at all (its blocker is worded "needs its own browser verification")
- The **pair** of patterns, per §8's C10X-39 rule that one pattern is not enough on this file: `grep -n "Re-evaluate the moment any §3 phase wires e2e"` **and** the wrap-tolerant `grep -n "Re-evaluate the moment any §3 phase"`. Every hit of either must sit in a `2026-08-05` block
- All §7 exclusion bullets present at `HEAD` are still present — the count of `- **` bullets in §7 is unchanged
- `grep -c "2.4.11 is Focus Not Obscured, and nothing tests it" context/foundation/test-plan.md` returns `1`
- `npx prettier --check context/foundation/test-plan.md` exits 0

#### Manual Verification:

- Each re-decision reads "the condition was never literally met", never "the condition fired"
- The §8 site got an appended correction, not an in-place rewrite — verify against `git diff`

---

## Phase 6: §6.1 / §6.2 trap notes and the `lessons.md` pointer

### Overview

Two one-sentence additions and one pointer fix — all "false or trap-creating today", none a new
subsection.

### Changes Required:

#### 1. §6.1 and §6.2

**File**: `context/foundation/test-plan.md`

**Intent**: Close a live trap. §6.2 invites a "sibling folder named after the concern" and §6.1
says only `tests/**/*.test.ts` is collected — so a contributor creating `tests/e2e/foo.test.ts`
gets a file Vitest collects and that explodes on the `@playwright/test` import. The layers are
separated by a filename infix alone, and nothing asserts it.

**Contract**: One sentence at `:783-784` (§6.1 Naming) and one at `:862-863` (§6.2 Location).
Both name `tests/e2e/` as Playwright's directory, `.spec.ts` as its suffix, and the consequence
of getting it wrong. Neither statement currently in those bullets is false, so nothing is
removed. Do **not** add a §6.11 subsection.

#### 2. The `lessons.md` pointer

**File**: `context/foundation/lessons.md`

**Intent**: A stale pointer, false today, in the same class as the number corrections — fixed in
place.

**Contract**: Line 184 cites `roadmap.md:234` for the archive-ownership sentence; that sentence
is at `roadmap.md:401` (`:234` is H-01's Risk paragraph). Change the pointer only; the rule's
text is correct.

**`lessons.md` is prettier-dirty at `HEAD` and this file is the one the plan's prettier hazard
note checked the wrong file for.** Measured 2026-08-05: `npx prettier --check
context/foundation/lessons.md` exits **1**, while `README.md` and `test-plan.md` both exit 0. The
drift is two lines of trailing whitespace (`:204`, `:211`) and nothing else. Because
`.prettierignore` covers `context/archive/**` and **not** `context/foundation/`, staging this file
makes `lint-staged` normalise those two lines whether or not you ask it to. **Normalise them
deliberately in the same commit** and say so in the commit body's absence — i.e. in this Contract
— so the diff's shape is explained rather than discovered: the pointer change plus exactly two
whitespace-only lines. Do not let it look like an unexplained reformat, and do not extend it
beyond those two lines.

### Success Criteria:

#### Automated Verification:

- §6.1 and §6.2 each contain `tests/e2e/` and `.spec.ts`
- `grep -c "roadmap.md:234" context/foundation/lessons.md` returns `0`
- `grep -c "roadmap.md:401" context/foundation/lessons.md` returns `1`
- `grep -cF "### 6.11" context/foundation/test-plan.md` returns `0`. **`-F` and the heading prefix are both load-bearing**: `grep -c "6.11"` returns `1` at `HEAD` and can therefore never pass — `.` is a regex wildcard and matches `6011` inside the migration timestamp `'20260601120000'` at `:1866`
- `npx prettier --check context/foundation/test-plan.md context/foundation/lessons.md` exits 0 — **an after-check, not a before-check**: `lessons.md` exits 1 at `HEAD` (two trailing-whitespace lines), so this criterion is expected to be red until this phase normalises them

#### Manual Verification:

- Each addition is one sentence, in the voice of the surrounding bullets
- The `lessons.md` diff is the pointer change **plus exactly two whitespace-only lines** (`:204`, `:211`, pre-existing prettier drift normalised deliberately) — and nothing else. Verify against `git diff`; three or more content hunks means the reformat ran wider than intended

---

## Phase 7: §8 ledger, the Vitest-only sentence, and the rolling header

### Overview

Close the change: move the three ledger dates onto Phase 2's re-verification, record the
suite-total ambiguity once, write this refresh's own dated entry, and prepend the header block.

### Changes Required:

#### 1. The three ledger dates

**File**: `context/foundation/test-plan.md`

**Intent**: Move all three to 2026-08-05, backed by Phase 2's measurements rather than by
assertion.

**Contract**: Lines 3368-3370. `Strategy (§1–§5) last reviewed` is earned by this change's own
review of §3/§4/§5. `Stack versions last verified` and `AI-native tool references last verified`
are earned by Phase 2. If Phase 2 could not verify something, say so beside the date rather than
moving it silently.

#### 2. The suite-total sentence

**File**: `context/foundation/test-plan.md`

**Intent**: Record once, in §8, that every `N/N, M files` total in this file counts Vitest files
only — without editing figures that are not false.

**Contract**: One sentence in §8. It must not restate or edit `364/364, 31 files` at `:42-43` or
`:4168`.

#### 3. This refresh's §8 entry

**File**: `context/foundation/test-plan.md`

**Intent**: The dated record of what this refresh changed and — this file's discipline — what it
does not claim.

**Contract**: A new §8 bullet dated 2026-08-05. It must state: no risk row moves, no coverage
claim widens, **no test changed and therefore no suite figure is restated**; the measured
`133 → 135` delta with its two files; that `AGENTS.md` was checked and deliberately not edited on
that axis (the absence of an edit recorded as its own note — the C10X-42 precedent); that the §7
triggers were **mis-keyed**; and the four deferrals (`.gitignore`, §6.11, `H-12`, `C10X-45`) with
the known consequence that this refresh has no roadmap row and will need the H-04/H-07/H-08
backfill treatment at archive time.

#### 4. The rolling header

**File**: `context/foundation/test-plan.md`

**Intent**: The header block is the first thing a reader meets; a stale "no e2e" framing there is
how a closed item gets rediscovered.

**Contract**: The `Last updated:` block at the top of the file. The current C10X-43 block becomes
`Previously:` and is **not rewritten**. The new block leads with what changed and states in the
same breath that this is a guide update, not a coverage change.

### Success Criteria:

#### Automated Verification:

- `grep -n "last reviewed\|last verified" context/foundation/test-plan.md | head -3` shows all three dates as `2026-08-05`
- The file's `Last updated:` line reads `2026-08-05` and the immediately following block begins `Previously:`
- `git status --porcelain` lists only `README.md`, `context/foundation/test-plan.md`, `context/foundation/lessons.md` and the change folder — **no file under `src/`, `tests/`, `evals/` or `scripts/`**. `--porcelain`, not `git diff --stat`: an **untracked** file never appears in a diff, so `git diff` cannot see a stray spec under `tests/e2e/` and would report a clean sweep over one. Measured during plan-review (2026-08-05): an untracked `tests/e2e/route-guard.spec.ts` was present in the tree and took `npm run typecheck` to **136**, while `git diff --stat` stayed clean — it was removed before implementation, and the count is 135 again
- `npm run typecheck` reports **0 errors**, and its `Result (N files)` count is recorded in Progress. `N` is expected to be `135`; a different `N` is not a failure of this change but a signal that a file entered or left the tree — cross-check against 7.3 rather than editing a document to match it
- `npm run lint` exits 0
- `npx prettier --check` passes on all three edited docs, **and** is idempotent: run `--write` twice, `git diff` between the two runs is empty
- Both `364/364, 31` sites are unchanged from `HEAD` — `:42-43` **and** `:4168`, checked per anchor. Same trap as 5.1: `grep -c "364/364, 31 files"` returns **1**, because `:42-43` wraps between `31` and `files`; the wrap-tolerant partner is `grep -n "364/364, 31"`

#### Manual Verification:

- The §8 entry's "does not claim" list is at least as prominent as what it does claim
- The header block reads correctly against the two blocks below it — no contradiction with the C10X-43 block it demoted
- A reader who knows nothing of this session can reconstruct which four items were deferred and why

---

## Testing Strategy

There is no code under test. The verification is textual and mechanical:

### Automated:

- Per-phase greps with expected counts, as listed above
- `npm run typecheck` (must still report 135/0 — this is also the regression check that no source file was touched)
- `npm run lint`
- `npx prettier --check` on every edited document, plus a write-twice idempotency check

### Manual:

1. Read §3 row 6, §4's e2e row, **§4's `:688` tooling line** and §5's paragraph in sequence — all four must agree on "claims" vs "wires"
2. Read each §7 re-decision — the condition must read as mis-keyed, never as fired
3. Read the §8 entry cold and confirm the four deferrals and the orphan consequence are recoverable from it alone
4. Confirm `git diff` shows appended corrections (not rewrites) at `test-plan.md:2765` and `:3524`

## Migration Notes

None. No migration, no schema change, nothing pushed to the cloud, so the C10X-29 drift gate is
not involved. `lessons.md`'s two migration rules are conditioned on a change carrying a migration
and do not apply.

## References

- Research (with the six resolved decisions): `context/changes/test-plan-refresh-2026-08-05/research.md`
- Brief, brief-corrections and plan-consumable decisions: `context/changes/test-plan-refresh-2026-08-05/change.md`
- Correction-convention precedent (live vs dated): `context/foundation/test-plan.md` §6.6 C10X-30 "4xx" entry
- Prettier hazard and the husky-install finding: `context/foundation/test-plan.md` §6.6 C10X-43 entry
- Container-API / `PROTECTED_ROUTES` boundary: `context/foundation/lessons.md:131-136`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Denominator corrections

#### Automated

- [x] 1.1 `grep -c "over all 133 files" README.md` returns 0 — d55ce4b
- [x] 1.2 README carries **no** file total and still carries the `18 .astro templates` clause — d55ce4b
- [x] 1.3 §6.6's `(133 files)` row survives byte-identical — checked by `git diff` on `:2765`, not by a substring count — d55ce4b
- [x] 1.4 A `Corrected 2026-08-05` block exists after the C10X-43 claims table — d55ce4b
- [x] 1.5 `npx prettier --check README.md context/foundation/test-plan.md` exits 0 — d55ce4b

#### Manual

- [x] 1.6 The README sentence reads as one coherent claim — d55ce4b
- [x] 1.7 The §6.6 correction explains why the floor assertion stayed green — d55ce4b

### Phase 2: §4 Stack — earn the date, then replace the e2e row

#### Automated

- [x] 2.1 `none yet — deliberately deferred` returns 0 hits — 7ed5c5d
- [x] 2.2 The §4 e2e row names Playwright with `1.62.1` and `checked: 2026-08-05` — 7ed5c5d
- [x] 2.3 Every version stated in §4 matches its installed value (commands + outputs recorded) — 7ed5c5d
- [x] 2.4 `npx prettier --check context/foundation/test-plan.md` exits 0 — 7ed5c5d

> **2.3 measurements, 2026-08-05 — the review that earns Phase 7's two ledger dates.**
> `npm ls vitest astro supabase @playwright/test eslint-plugin-jsx-a11y --depth=0` →
> `vitest@4.1.10`, `astro@6.3.1`, `supabase@2.98.2`, `@playwright/test@1.62.1`,
> `eslint-plugin-jsx-a11y@6.10.2`. **Every version §4 states matches its installed value, so per the
> Contract no version cell was edited** — the non-edit is the result, not an omission. Per row:
> Vitest `4.1.10` ✓; Container API "ships with Astro 6" ✓ (6.3.1); Supabase CLI `2.98.2` ✓ and
> `package.json:67` is still `^2.23.4`, so the "range floor" parenthetical stays true;
> `eslint-plugin-jsx-a11y` `6.10.2` ✓ (pinned exactly, `package.json:57`). AI-native row re-read at
> the source rather than trusted: `evals/lib/judge.ts:31` still pins `google/gemini-2.5-flash`, `:44`
> the `EVAL_JUDGE_MODEL` override, `:194` `temperature: 0`, `:206` `json_schema` structured outputs.
> Stack grounding tools re-checked: Context7, Exa, claude-in-chrome and the Atlassian MCP are all
> still available this session, and Supabase MCP still exposes only an interactive `authenticate`
> tool — so that line's parenthetical holds too.
>
> Harness facts behind the new e2e row, measured rather than inferred: `package.json` carries **no**
> playwright script (`@playwright/test` at `:51` is its only hit) and `.github/workflows/*.yml` no
> playwright step; `playwright.config.ts` has no `webServer`, no `globalSetup` and no setup project;
> `8a12d07` and `5f3c87e` are both dated **2026-08-05**.
>
> **One deliberate non-edit to carry into Phase 7.** The four rows verified today keep their old
> `checked:` dates (`2026-07-15`, `2026-07-26`, `2026-08-02`), because the Contract says to change
> nothing where a version has not moved. That leaves §4's per-row dates reading older than the
> `Stack versions last verified: 2026-08-05` line Phase 7 will write. Recorded here rather than
> resolved: bumping them is a Phase 7 call, and doing it silently in Phase 2 would put an edit
> outside its Contract.

#### Manual

- [x] 2.5 The e2e row claims no runnability the harness lacks — 7ed5c5d
- [x] 2.6 Re-verification covered every §4 row, not a convenient subset — 7ed5c5d

> **2.5 / 2.6 evidence, 2026-08-05 — both done by measurement, not by re-reading the row.**
> 2.5, one probe per clause: **no browser-install step** — `playwright install` / `install-deps`
> return zero hits across `package.json`, `README.md`, `AGENTS.md`, `.github/workflows/*.yml` and the
> config; **no `webServer`, no preflight** — `webServer`, `globalSetup`, `globalTeardown`,
> `dependencies` and a setup project are all absent from the 11-line `playwright.config.ts`;
> **`storageState` has no producer** — `playwright.config.ts:7` consumes
> `playwright/.auth/user.json`, `.gitignore:125` ignores it, and no spec or script writes it, so a
> fresh checkout has no such file; **one spec** — `git ls-files tests/e2e` returns exactly
> `seed.spec.ts` and `git status -uall` on those paths is empty, so there is no untracked spec
> inflating the claim (the trap criterion 7.3 exists for); **inside the type gate** —
> `npx tsc --showConfig` lists `./playwright.config.ts` (`:44`) and `./tests/e2e/seed.spec.ts`
> (`:120`) as project members.
>
> 2.6 deliberately covered the rows `npm ls` **cannot** reach, since a version sweep alone would be
> exactly the convenient subset this criterion is written against. unit+integration:
> `vitest.config.ts:2` still imports `getViteConfig` from `astro/config` and `:14-19`/`:56` still
> strip the Cloudflare plugin. API mocking: **no** mocking library in either dependency block, and
> `vi.mock(` resolves to **exactly one** file — `tests/generation/failure-path.test.ts`, as the row
> claims — with `tests/setup/retry-transport.ts` still present as the second, non-double seam.
> database: `db:start` still chains `db:kong` and `scripts/disable-kong-keepalive.ts` exists.
> accessibility: wired lint-level only, via `eslint.config.js:89`
> (`flat/jsx-a11y-recommended`). endpoint rendering rests on `astro@6.3.1` from the sweep above.

### Phase 3: §3 — the Phase 6 row and the harness sequencing note

#### Automated

- [x] 3.1 §3 has six phase rows; row 6 Status is `not started`
- [x] 3.2 The sequencing note names all nine harness findings — greps scoped to the note's line range (file-wide would pass `preflight`/`trace`/`.gitignore` vacuously)
- [x] 3.3 §2 is byte-identical to `HEAD`
- [x] 3.4 `npx prettier --check context/foundation/test-plan.md` exits 0

> **3.1–3.4 measurements, 2026-08-05.** 3.1: the §3 table has **6** phase rows
> (`awk` over the section, `grep -cE '^\| [0-9]+ +\|'`) and row 6's Status cell is
> `not started`. 3.3: §2 extracted between the `## 2.` and `## 3.` headings and `diff`ed
> against the same extraction from `HEAD` — **identical**, 31 lines, md5
> `b39f7e1f12fd11874bffeb3c0a7d7d8d`. 3.4: red before, green after one `prettier --write`;
> the whole diff is **two hunks** — the §3 table (row 6 plus column re-padding on rows 1-5,
> no cell text changed) and the new note. No other section moved.
>
> **3.2 ran scoped to lines 669-761 (the note's own range)** and all nine tokens are present:
> `preflight` 5, `trace` 1, `.gitignore` 2, `storageState` 2, `webServer` 1, `.spec.ts` 2,
> `zero auth requests` 1, `npm script` 1, `browser install` 1.
>
> **The criterion's own falsifiability claim was rounder than reality, and the scoping is what
> saved it.** The plan states the six non-vacuous tokens are `0` at `HEAD`; measured today,
> **four are 1** — `storageState`, `webServer` and `npm script` at `:680`, all three introduced
> by **this change's own Phase 2** when it rewrote §4's e2e row, and `.spec.ts` at `:2785`,
> introduced by **Phase 1**'s C10X-43 correction block. The plan's figure was taken at the
> pre-change `HEAD` and was correct then. Only `zero auth requests` and `browser install` are
> still `0` file-wide. Recorded as observed rather than rounded — the same discipline §8 applies
> to C10X-29's `missingLocal` neuter — and it makes the case for the scoping stronger, not
> weaker: a file-wide grep would now pass **seven** of the nine vacuously, not three.

#### Manual

- [x] 3.5 The note reads as a hand-off, not a coverage claim
- [x] 3.6 A reader stopping after §3 learns the harness is not yet trustworthy

> **3.5 / 3.6 evidence, 2026-08-05 — done by re-measuring every factual claim in the note, not
> by re-reading it.** Nineteen claims were probed at their source. Confirmed: both commits dated
> **2026-08-05**; the config is **11 lines** and contains **zero** hits for
> `retries`/`globalSetup`/`globalTeardown`/`webServer`/`dependencies`, so `trace: "on-first-retry"`
> is inert by the documented default of `0`; `5f3c87e` added **exactly** `/test-results/` and
> `/.playwright-cli/`; `.env:7` carries the `PROD_`-prefix swap comment while `.env:4` is
> `http://127.0.0.1:54321`, so the production-deletion path is a **seam, not an incident**, as
> worded; `vitest.config.ts:27` is `tests/**/*.test.ts` against a `.spec.ts` file in the same
> tree; `package.json` has no `postinstall` and no e2e script; `tests/middleware.test.ts:85,94`
> are the two `it.each(PROTECTED_ROUTES)` blocks; `CandidateReviewWorkspace.tsx:138` is the
> app's own `window.location.reload()`; `review.astro:107` is the `if (!error)` that hides the
> metric silently; `flashcards.ts:102` is the `STATE_ACCEPTED` filter behind the deck-page oracle.
>
> **The oracle was checked against the components rather than taken from research.** `Edytuj`
> exists at exactly two sites in `src/` — `FlashcardItem.tsx:241` (the deck page, one per card,
> in a `grid-cols-3` footer beside `Odrzuć` and `Usuń`) and `CandidateItem.tsx:287` (the review
> screen, a different page) — so on the deck page it is one per card and nothing else. The
> `Usuń` over-count is **+1** and its source is now pinned: `DeckActions.tsx:76`, rendered at
> `index.astro:150` inside the `sticky top-0 z-20 … h-16` bar at `:129`. (`DeckActions` also
> carries a confirm `Usuń` at `:146`, inside a closed `<dialog>` and therefore outside a role
> query — the reason the over-count is one and not two.)
>
> **One real defect was found by this pass and fixed rather than noted.** The note claimed
> `npx playwright install` "appears nowhere in the repo" — **self-falsifying**, because writing
> the sentence puts the phrase in the repo. Measured: three hits, all prose (`research.md`,
> `plan.md`, and this note). Rewritten to scope the claim to **executable** surfaces
> (`package.json`, `.github/workflows/`, `README.md`/`AGENTS.md`, the config), with the trap
> stated at the site so the looser wording is not restored — a grep written from it would go red
> on the document making the claim, which is this file's own unfalsifiable-assertion class
> pointed at itself. Re-verified after the fix: prettier green, §2 md5 unchanged
> (`b39f7e1f12fd11874bffeb3c0a7d7d8d`), still exactly two hunks, all nine tokens still in range.
>
> **3.5 verdict:** every verdict in the note is about the harness's STATE (`LIVE`, `CLOSED`,
> `latent`, `inert`), never about what e2e proves; four sentences hand work forward explicitly
> ("the assertion belongs to the phase", "closing them belongs to the phase", "open to
> re-decision", "handed over with verdicts so the phase's own research starts from them"). The
> only coverage claim in the note is about **existing** unit + integration coverage of Risk #3,
> and it is there to justify journey C's exclusion. **3.6 verdict:** the note says it outright at
> `:676-677` and then demonstrates it — nothing runs the harness, no preflight, a spec that can
> delete decks in production under a documented credential swap, a `storageState` nobody
> produces, and the one debugging affordance the config declares can never fire.

### Phase 4: §5 — the gate row and the closing paragraph

#### Automated

- [ ] 4.1 `e2e on critical flows is deliberately absent` returns 0 hits
- [ ] 4.2 The gate table's e2e row carries `never` and `needs:` in `Required?`
- [ ] 4.3 The `planned` count is unchanged from `HEAD`
- [ ] 4.4 `npx prettier --check context/foundation/test-plan.md` exits 0

#### Manual

- [ ] 4.5 §3 row 6, §4's e2e row, §4's `:688` tooling line and §5's paragraph agree on claims-vs-wires
- [ ] 4.6 The gate row cannot be read as "a documented command runs the e2e suite"

### Phase 5: §7 re-decisions and the §8 twin clause

#### Automated

- [ ] 5.1 All 4 **Contract-named sites** sit inside a `2026-08-05` block, checked per anchor (a hit count is wrong: a literal grep returns 2 — `:3237-3239` is line-wrapped, `:3256-3258` never carried the clause), using the C10X-39 **pair** of patterns
- [ ] 5.2 The §7 exclusion bullet count is unchanged
- [ ] 5.3 The `2.4.11 is Focus Not Obscured` sentence survives
- [ ] 5.4 `npx prettier --check context/foundation/test-plan.md` exits 0

#### Manual

- [ ] 5.5 Each re-decision says the condition was never literally met
- [ ] 5.6 `:3524` got an appended correction, not a rewrite

### Phase 6: §6.1 / §6.2 trap notes and the `lessons.md` pointer

#### Automated

- [ ] 6.1 §6.1 and §6.2 each name `tests/e2e/` and `.spec.ts`
- [ ] 6.2 `roadmap.md:234` returns 0 hits in `lessons.md`; `roadmap.md:401` returns 1
- [ ] 6.3 No `6.11` subsection was added — `grep -cF "### 6.11"` returns 0 (a bare `grep -c "6.11"` returns 1 at `HEAD` and can never pass)
- [ ] 6.4 `npx prettier --check` passes on both files (after-check: `lessons.md` is red at `HEAD`)

#### Manual

- [ ] 6.5 Each addition is one sentence, in the surrounding voice
- [ ] 6.6 The `lessons.md` diff is the pointer change plus exactly two whitespace-only lines (`:204`, `:211`)

### Phase 7: §8 ledger, the Vitest-only sentence, and the rolling header

#### Automated

- [ ] 7.1 All three ledger dates read `2026-08-05`
- [ ] 7.2 `Last updated:` reads `2026-08-05` and the next block begins `Previously:`
- [ ] 7.3 `git status --porcelain` (not `git diff --stat` — it is blind to untracked files) touches no file under `src/`, `tests/`, `evals/`, `scripts/`
- [ ] 7.4 `npm run typecheck` reports 0 errors; `Result (N files)` recorded (expected `135`)
- [ ] 7.5 `npm run lint` exits 0
- [ ] 7.6 `prettier --check` passes and a double `--write` produces an empty diff
- [ ] 7.7 Both `364/364, 31` sites unchanged — `:42-43` (wrapped, invisible to the full-phrase grep) and `:4168`

#### Manual

- [ ] 7.8 The §8 entry's "does not claim" list is as prominent as its claims
- [ ] 7.9 The header block does not contradict the C10X-43 block it demoted
- [ ] 7.10 The four deferrals and the orphan consequence are recoverable from the §8 entry alone
