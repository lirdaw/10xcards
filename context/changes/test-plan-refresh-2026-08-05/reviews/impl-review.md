<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: test-plan.md refresh for the arrival of e2e

- **Plan**: `context/changes/test-plan-refresh-2026-08-05/plan.md`
- **Scope**: Full plan — Phases 1-7 of 7 (all Progress boxes `[x]`)
- **Date**: 2026-08-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## What was verified green

Re-run against the current tree, not taken from the Progress notes:

- `npm run typecheck` → `Result (135 files): 0 errors`, decomposed as 117 `tsc` roots + 18 `.astro`.
- `npm run lint` → exit 0, the 3 pre-existing `no-console` warnings in `evals/`, unchanged.
- `npx prettier --check` green on all four documents; `--file-info` shows all four
  `"ignored": false` (non-vacuous, the C10X-43 trap); a write-twice test on copies in a scratch
  directory shows prettier is a **no-op** on the committed text and idempotent.
- Scope: `git diff --name-only cc40f8f..HEAD` = `README.md`, `test-plan.md`, `lessons.md` and the
  change folder. `git status --porcelain -uall` empty. `.gitignore`, `AGENTS.md`, `roadmap.md`,
  `jira-map.md` all 0-line diffs. §1 and §2 byte-identical.
- Correction conventions held: `git diff -U0` on §6.6's C10X-43 claims row and on §8's C10X-30
  twin shows **zero `-` lines** — both dated records took pure appends, while the live claims in
  §4, §5 and §7 were edited in place.
- Every absence claim in the added text verified by command and TRUE: no npm script, no
  `postinstall`, no CI job, no `playwright install` in any executable surface, no `webServer` /
  `globalSetup` / `retries` / `testMatch` in the 11-line config, `storageState` consumed but never
  produced, zero visual-diff dependencies, zero `getComputedStyle` hits, `.gitignore` carrying
  exactly the three Playwright entries, four artifact classes still unignored.
- Every added pointer resolves: `tsconfig.json:3`, `roadmap.md:234` (a 914-char line that does
  carry the e2e/visual-diff clause), `roadmap.md:401`, `README.md:49`, `jira-map.md:3-4`,
  `.gitignore:125`, the focus-ring archive `verification.md`. **No `test-plan.md:NNNN`
  self-reference was added at all** — the highest-risk rot class is simply absent.
- Both edited tables are structurally intact (§3: 7 columns × 6 phase rows; §5: 4 columns ×
  11 rows).

## Findings

### F1 — Header says §7's three triggers all carried the clause; two did, and §8 says so

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: context/foundation/test-plan.md:32-33
- **Detail**: The rolled header asserts "**§7's three re-evaluation triggers were MIS-KEYED, not
  fired** … All three read 're-evaluate the moment any §3 phase wires e2e'". Measured against the
  pre-change file, the clause sat at **two** §7 sites (`:3239` focus-ring, wrapped; `:3292`
  islands) and one **§8** site (`:3524`); §7's third dated re-decision, the nested
  `scroll-padding-top` deferral, never carried the sentence — its blocker read "needs its own
  browser verification". The same change refutes the header twice, correctly: §8's C10X-30
  correction block (`:3783`) says "This is the **third and last** site carrying that clause and
  **the only one outside §7**", and the new §8 entry (`:4544-4551`) says "four sites took a dated
  2026-08-05 re-decision, but the trigger sentence itself sat at only three of them". The header
  conflates §7's three re-decisions with the three clause sites — the total-versus-breakdown
  collision this ledger names as its own recurring defect, committed in the block a reader meets
  first.
- **Fix A ⭐ Recommended**: Re-word `:32-33` to state the two figures as the different claims they
  are — three §7 exclusions took a dated re-decision; the mis-keyed trigger sentence itself sat at
  three sites, two in §7 and one in §8.
  - Strength: Makes the header agree with the two measured statements already in §8, and models
    the very discipline the sentence's own trailing clause invokes ("enumerated rather than
    counted, because a total and its breakdown are two claims").
  - Tradeoff: One more clause in an already dense header block.
  - Confidence: HIGH — the pre-change locations were reproduced directly from `cc40f8f`.
  - Blind spot: None significant.
- **Fix B**: Drop the count from the header entirely ("§7's exclusions were re-decided; the
  trigger was mis-keyed, not fired") and let §8 own the figures.
  - Strength: Immune to re-rot, and matches the treatment this same change chose for README's file
    total — remove the number rather than correct it.
  - Tradeoff: A reader who stops at the header loses the shape of what moved.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: Fixed via Fix A

### F2 — §3's journey-A oracle guidance cites §6.6's S-05 entry for the wrong page

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: context/foundation/test-plan.md:799-801
- **Detail**: The note says "The **deck page** reaches an `.astro` loader that §6.4 records as
  deliberately never rendered and **§6.6's S-05 entry** records as resting on manual verification
  alone". The §6.4 half is correct. The S-05 half is not: that bullet (`:1829-1832`) is scoped to
  `review.astro` — "no test renders `review.astro`, so **the review screen's own loader**, its
  empty states and the acceptance-metric line are covered by manual verification alone". It says
  nothing about the deck page. The claim about the deck page loader lives in §6.6's Phase 1 /
  C10X-27 correction ("What genuinely remains untested is narrower: the middleware guard and the
  two `.astro` page loaders"). This is forward guidance the §3 Phase 6 change will act on, and a
  reader following the pointer to justify "the coverage hole this journey extends into" lands on a
  claim about the very screen the same paragraph has just rejected as the oracle.
- **Fix**: Repoint the second half to §6.6's Phase 1 / C10X-27 correction (the two `.astro` page
  loaders), leaving the §6.4 half unchanged.
- **Decision**: FIXED

### F3 — A Contract-protected sentence was reworded and the Progress note reports it as surviving

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:3427 (and plan.md:943-944)
- **Detail**: Phase 5's Contract named two rules that must **survive**, quoting them: "Until then
  the guard is the measured acceptance check…" and "reviewed by reading, deliberately and every
  time". The second survives verbatim (`grep -c` → 1). The first returns **0**: `:3427` now reads
  "**Until such an oracle is wired** the guard is the measured acceptance check in the change
  itself (contrast ≥ 3:1, **WCAG 1.4.11 only**), recorded per control before and after in
  `context/archive/2026-07-25-focus-ring-a11y/verification.md`". The rule survives entire — same
  guard, same bar, same 1.4.11-only scope, same evidence path — and the rewording was arguably
  forced, because "Until **then**" referred to the trigger clause the same edit struck. The defect
  is the record, not the text: `plan.md:943-944` states "The two rules the Contract protects
  survive" without disclosing that one was re-based, in a change that elsewhere flags its
  deviations explicitly (Phase 5 declares its `scroll-padding-top` deviation in full at
  `plan.md:914-923`).
- **Fix**: Append one sentence to Phase 5's Progress note recording that the first rule's _wording_
  was re-based because "then" pointed at the struck clause, and that its substance was verified
  unchanged. No edit to `test-plan.md` — the shipped text is better than the quoted phrase.
- **Decision**: FIXED

### F4 — Header lists §8 among sections that "asserted something false"; §8 calls that sentence accurate

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/test-plan.md:13-14
- **Detail**: The header says "**§4, §5, §7 and §8** each asserted something about e2e which is
  **false on this date**". For §4 (`none yet — deliberately deferred`), §5 (`e2e on critical flows
is deliberately absent`) and §7 (the half-false "the e2e / visual-diff layer §4 and §5
  deliberately do not have") that verdict is verified. §8's only e2e sentence is the conditional
  trigger — and this change's own correction block at `:3778-3779` defends it: "That sentence
  **was the accurate statement of the trigger** … The trigger turned out to be **mis-keyed rather
  than fired**". The change draws mis-keyed and false apart deliberately everywhere else; the
  header collapses them for one of its four enumerated members.
- **Fix**: Narrow to "§4, §5 and §7 each asserted something false, and §8 carried the same
  mis-keyed trigger" — preserving the enumeration while matching the taxonomy the rest of the
  change uses.
- **Decision**: FIXED

### F5 — Phase 4's `planned`-count criterion is false at HEAD; a later phase moved it

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md:348 (criterion 4.3) / context/foundation/test-plan.md:4563
- **Detail**: Criterion 4.3 requires `grep -c "planned" context/foundation/test-plan.md` to be
  "unchanged from `HEAD`". It is **6** at HEAD against **5** at `cc40f8f`. Phase 4's note records
  "5 at HEAD and 5 after", which was true at `5d91df2`; the sixth hit was introduced three commits
  later by **Phase 7** at `:4563`, in the §8 "Still open" bullet that _quotes_ the vocabulary in
  order to disclaim it ("the §5 intro's unqualified 'before that, the gate is `planned`'
  convention, which the e2e row is deliberately kept out of"). The Contract's actual intent — the
  new row must not borrow that vocabulary — is honoured: §5's e2e `Required?` cell reads
  `never a gate`. This is the same shape §8 records against C10X-40: a figure taken at phase
  completion that a later edit invalidated, with nobody re-running it at HEAD.
- **Fix**: Add one line to Phase 7's Progress note recording that it took the count 5 → 6 at
  `:4563` and why that does not violate 4.3's intent.
- **Decision**: FIXED

### F6 — §8's `git status` self-report has no surviving oracle and can be misread as scope

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: context/foundation/test-plan.md:4482-4483
- **Detail**: "At the close of the change `git status --porcelain -uall` lists two markdown paths
  and **nothing under `src/`, `tests/`, `evals/` or `scripts/`** — tracked or untracked." At the
  actual close the working tree is clean and the command returns **nothing**, so the stated
  observation is neither reproducible nor falsifiable by a later reader; "two" was true only at
  the instant Phase 7 measured it, with `test-plan.md` and `plan.md` dirty. A reader may also
  collide "two markdown paths" with the change's real document scope, which is **three** plus the
  change folder — stated correctly two lines above. The substantive half is independently
  corroborated: `git diff --stat cc40f8f..HEAD` touches nothing under those four directories.
- **Fix**: Re-word to "measured while Phase 7 was in flight, `git status --porcelain -uall`
  listed only markdown paths and nothing under …", so the claim carries the moment it belongs to.
- **Decision**: FIXED

### F7 — Two arithmetic claims in the Progress evidence do not reconcile

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md:1214 and plan.md:731
- **Detail**: Two self-audit figures in the Progress notes are off, both in the class this change
  otherwise polices hardest. (a) `:1214` — "The whole-change removal set is **50** lines and every
  one is accounted for", followed by an enumeration that is entirely `test-plan.md` content.
  Measured, `git diff --numstat cc40f8f..HEAD` gives **49** deletions for `test-plan.md`, **1** for
  `README.md` and **3** for `lessons.md` — so the enumerated set is 49 and the whole-change set is
  53; 50 matches neither. (b) `:731` — "`DeckActions` also carries a confirm `Usuń` at `:146`,
  inside a closed `<dialog>` … the reason the over-count is one and not two". The deck page carries
  a **third** gated `Usuń`, `ConfirmDeleteModal.tsx:34`, rendered by `FlashcardWorkspace.tsx:268`
  and gated by `{card && …}`. The operative conclusion is unaffected and correct — the over-count
  is **+1**, and `test-plan.md`'s own wording ("the deck-delete button in the sticky header") makes
  no incomplete enumeration, so the durable document is clean.
- **Fix**: Correct both figures in the Progress notes: 49 enumerated / 53 whole-change, and "one
  and not three".
- **Decision**: FIXED
