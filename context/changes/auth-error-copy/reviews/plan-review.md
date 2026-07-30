<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Auth Error Copy — Audit and Close H-03

- **Plan**: `context/changes/auth-error-copy/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-30
- **Verdict**: REVISE → **SOUND after triage** (all 7 findings fixed in the plan, 2026-07-30)
- **Findings**: 1 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

14/14 paths ✓ (the 15th, `tests/lib/config-status.test.ts`, is correctly new), 16/17 symbols ✓
(the miss is F3), brief↔plan ✓.

Symbols verified by reading, not by trusting the plan: `auth-errors.ts` `:49` / `:66-82` /
`:85-99` / `:105-121` / `:130` / `:148-153` / `:150`; `config-status.ts:13-15,28,37,47`;
`Layout.astro:17`; `signup.ts:19`; `forms.ts:14-15`; `FormField.tsx:57`; `ServerError.tsx:8`;
`confirm-email.astro:4`; `errors.test.ts` `:38-40` / `:55-68` / `:76-78` / `:83-85` / `:86-101`
(`toBe(11)`) / `:104-106` / `:107-113` / `:115-121` / `:352-359` / `:363-382`; `roadmap.md:248`
(`Change ID: auth-error-copy`); `lessons.md:93`; `tests/lib/forms.test.ts:4-9`.

Additional grounding beyond the plan's own citations:

- `errors.test.ts` case count is **38** as Phase 0 predicts (12+12+1 / 5 / 2 / 1 / 3 / 2).
- `isOpenRouterConfigured` — **zero** references repo-wide outside `openrouter.ts:62`. Phase 4 §3
  is correct.
- `missingConfigs` — one consumer (`Layout.astro`). Phase 4 §1's blast radius is one file.
- All six new GoTrue codes exist upstream in
  `node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts`.
- `AuthRetryableFetchError(msg, 0)` confirmed at `fetch.js:26,112` — Phase 2 §1's `status: 0` is
  faithful, and its breakage check C is genuinely impossible under today's `status: 503`.
- `/10x-archive` matches on exact `Change ID` and rewrites the whole `- **Status:**` line
  (`SKILL.md:166-174`), so the Key Discovery about the roadmap flip holds.
- `?error=` on the two auth pages has exactly two producers (`signin.ts:29,36,43`,
  `signup.ts:20,27,33`), all inside `AUTH_MESSAGES` — Phase 3's read-side filter breaks nothing.
- **`ServerError` has 11 call sites across 8 non-auth components** — see F2.

Off-by-one, not raised as a finding: the plan cites `errors.test.ts:270` for the impl-review F7
citation; it is at `:269`.

## Findings

### F1 — Breakage check B cannot go red

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Success Criteria (contradicts Phase 6 §1, row 4)
- **Detail**: Phase 1's check B says "point one new code at an existing constant instead of its
  own → the distinct-classes case goes red". It cannot: `errors.test.ts:86-101` builds a `Set`
  from imported constants and never calls `authErrorMessage`, so repointing a `MESSAGE_BY_CODE`
  value changes nothing it observes. The plan already knows this — Phase 6 §1 lists that exact
  comment among the five false ones and corrects it with "the `Set` is built from imported
  constants and never calls the mapper". Check B was designed from the claim the same plan
  deletes. Recorded green, it becomes evidence for something it never tested — the false-green
  class test-plan §6.6 has logged three times.
- **Fix**: Retarget check B at `it.each(cases)` "maps %s to its own constant" (`:70-74`).
  Repointing a new code's map value turns exactly that row red, and the row exists only because
  Phase 1 adds it.
- **Decision**: FIXED — Phase 1 Success Criteria and Progress 1.4 retargeted at the `it.each`
  mapping row, with an explicit note that the distinct-classes `Set` cannot observe it.

### F2 — `role="alert"` lands on 11 sites, verified on 1

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 5 §1 — Announce the server error
- **Detail**: Phase 5 §1 reasons about `ServerError` as an auth surface ("the only feedback a
  failed sign-in gives") and verifies it with one manual check on a failed sign-in. Enumerated,
  `ServerError` is imported by 8 non-auth components at 11 call sites — `CreateDeckModal:80`,
  `DeckActions:101`, `CreateFlashcardModal:121`, `FlashcardItem:159`, `FlashcardWorkspace:184`,
  `GeneratorForm:312`, `CandidateItem:175`, `CandidateReviewWorkspace:209`, `StudySession:142,311`.
  Every one is a *dynamically inserted* error (`{status === "error" && <ServerError/>}`), where
  `role="alert"` will genuinely fire — a larger behaviour change than on auth, where the node is
  present at mount. Phase 5 §2 does this blast-radius reasoning for `FormField` and omits it here.
  lessons.md's accepted rule ("Poleruj tylko własne komponenty slice'a — zakres sąsiednich
  rozstrzygaj PRZED budową") names this exact class, with S-02's Sidebar creep as its example.
- **Fix A ⭐ Recommended**: Keep the shared edit; widen the scope statement and the verification.
  - Strength: The 10 non-auth sites are where `role="alert"` is most correct (dynamic insertion),
    so this improves them rather than risking them; one edit, no new prop.
  - Tradeoff: The blast radius grows beyond auth, so "What We're NOT Doing" and the test-plan entry
    must say so, and Phase 5 needs one manual check on a dynamic site (e.g. `GeneratorForm`'s
    error) alongside the auth one.
  - Confidence: HIGH — call sites enumerated; test-plan §7 records island markup as untested by
    construction, so a manual check is the only oracle either way.
  - Blind spot: Whether any of the 10 renders `ServerError` inside a container that already carries
    a live-region role (double announcement) — not checked.
- **Fix B**: Opt-in prop — `<ServerError announce />`, set on the two auth forms only.
  - Strength: Literal compliance with the lessons.md rule; blast radius stays inside the slice.
  - Tradeoff: Leaves 10 sites with worse a11y than a one-line shared edit would give them, and adds
    a prop whose default is the wrong value almost everywhere.
  - Confidence: MED — mechanically safe, but optimises slice hygiene over the user-facing outcome
    the PRD's a11y NFR asks for.
  - Blind spot: A future contributor adding a ninth consumer must know to pass the prop; nothing
    enforces it.
- **Decision**: FIXED via Fix A — Phase 5 §1 gained the eleven-site blast-radius paragraph with the
  scope decision stated before the build; Phase 5 Manual Verification gained the dynamic-site check
  (new Progress 5.5, later items renumbered to 5.9); Phase 6 §4's test-plan contract now requires
  recording the eleven sites; plan-brief.md Open Risks records the decision.

### F3 — Phase 6 §2 points at files that do not contain the string

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 6 §2 — Cross-ticket pointer rot
- **Detail**: The contract's File header names `tests/auth/errors.test.ts` and
  `tests/lib/forms.test.ts`, then says "Also correct the recorded breakage denominator
  '1 of 33 red'". Repo-wide grep: that string is in neither test file. It lives in
  `context/archive/2026-07-26-ai-candidate-generation-test-2/verification.md:48` and
  `reviews/impl-review.md:93,334`, and as "(33 cases)" in `context/foundation/test-plan.md:1352`.
  So the implementer edits two files that do not carry the defect while the real one survives — in
  the phase whose purpose is ending pointer rot. The archived copies must NOT be rewritten: this
  project's precedent (test-plan §8; C10X-30's correction of the "4xx" wording) is a *dated
  correction line* in an archived artifact, never an in-place edit.
- **Fix**: Move the denominator correction out of §2's file list — correct `test-plan.md:1352`
  inside Phase 6 §4's edit, and add a dated correction line to the two archived files. The
  F-number qualification (`errors.test.ts:225,269,322`; `forms.test.ts:9`) stays in §2 and is
  correct; note `:270` is `:269`.
- **Decision**: FIXED — Phase 6 §2 now carries a three-row table locating each occurrence and the
  archived-file rule (dated correction line, never a rewrite); the `:270`→`:269` citation is
  corrected; a new automated criterion (Progress 6.5) makes the sweep verifiable, later Phase 6
  items renumbered to 6.7.

### F4 — Phase 4 makes `config-status.ts`'s own doc comment false

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1 — Extract the filter
- **Detail**: `config-status.ts:13-15` documents the per-entry rule with "So it is decided PER
  ENTRY, and **`Layout.astro` (not this module) applies it**". Phase 4 §1 moves the filter into
  `config-status.ts`, which makes that sentence false the moment the phase lands. Phase 4 §1
  accounts for the *other* comment (Layout's `:12-16` block moves to the function) but not this
  one, and Phase 6 §1's five-comment table is scoped to `errors.test.ts` — so a change whose
  Phase 6 exists to end comment rot would ship a new instance of it.
- **Fix**: Add `config-status.ts:13-15` to Phase 4 §1's contract — the sentence becomes "this
  module decides it; `Layout.astro` supplies the per-request session flag", keeping the reason for
  the split (`configured` is import-time, the session is per-request).
- **Decision**: FIXED — Phase 4 §1's contract now names `config-status.ts:13-15`, states the
  rewrite, and pins that the self-hiding-Supabase paragraph (`:17-21`) stays untouched.

### F5 — Five inferred code strings are untraceable and self-confirming

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 and §2
- **Detail**: Five of the six new codes cannot be produced locally, and their tests are `it.each`
  rows using the same literal as the map key — the assertion is that the table agrees with itself.
  A typo'd or renamed code is invisible to the suite and to Stryker, and `auth-errors.ts`'s header
  names this hazard ("a typo in a key is not a compile error"). All six verified correct today
  against `node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts`; a runtime guard is
  unavailable because `error-codes.js` is `export {}`.
- **Fix**: In Phase 1 §2's reachability record, cite that file (with the resolved auth-js version)
  as the source for each inferred code, so a future reader can re-derive instead of trusting prose.
- **Decision**: FIXED — Phase 1 §2 now requires citing
  `@supabase/auth-js/dist/module/lib/error-codes.d.ts` at the resolved version (**2.105.3**,
  looked up during this review) and states why no runtime guard exists.

### F6 — Phase 3 has 4 manual criteria and 3 Progress items

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 Manual Verification ↔ Progress
- **Detail**: Four bullets (crafted link / real failure / F5 / Back-Forward) map to 3.4–3.6, with
  3.6 merging the last two. Every other phase is 1:1. Not escalated to CRITICAL: the Progress
  block's shape is valid, all seven phase headings match, and no `- [ ]` appears outside Progress,
  so `/10x-implement` will parse it.
- **Fix**: Split 3.6 into 3.6 (F5 replays nothing) and 3.7 (Back/Forward still work).
- **Decision**: FIXED — split. Re-verified after all seven triage edits: 7/7 phase headings match,
  one `## Progress`, no `- [ ]` outside it, and every phase is now 1:1 between Success Criteria and
  Progress (0.1–0.4 / 1.1–1.7 / 2.1–2.4 / 3.1–3.7 / 4.1–4.7 / 5.1–5.9 / 6.1–6.8).

### F7 — The roadmap's ⚠️ block survives the archive flip

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries ("Roadmap H-03 is no longer stranded"), Phase 6 §4
- **Detail**: The discovery checks out — `roadmap.md:248` gives Change ID `auth-error-copy`, and
  `/10x-archive` matches on exact Change ID and rewrites the whole `- **Status:**` line, taking the
  deferral paragraph with it. What it does not touch (the skill is explicit: "leave `Outcome`,
  `Prerequisites`, `Risk`, etc. alone") is the `⚠️ ZAKRES TEGO ELEMENTU JEST JUŻ ZAIMPLEMENTOWANY`
  bullet, which says the whole of H-03 shipped under C10X-28. After this change that is
  incomplete — nine edges ship here, under this id. Phase 6 updates test-plan.md and says nothing
  about roadmap.md.
- **Fix**: Add roadmap.md to Phase 6 §4 — one dated line on the ⚠️ bullet recording that
  C10X-34 / `auth-error-copy` closed the remaining edges, so the status flip and the prose agree.
- **Decision**: FIXED — Phase 6 gained a new §6 for `roadmap.md`, contracting a dated line on the
  ⚠️ bullet and forbidding any edit to `- **Status:**` (that line is `/10x-archive`'s match target).
  New criterion + Progress 6.8.

---

## Triage Summary (2026-07-30)

| Finding | Severity | Decision |
| --- | --- | --- |
| F1 — breakage check B cannot go red | ❌ CRITICAL | FIXED |
| F2 — `role="alert"` blast radius | ⚠️ WARNING | FIXED via Fix A |
| F3 — denominator correction aimed at the wrong files | ⚠️ WARNING | FIXED |
| F4 — Phase 4 falsifies `config-status.ts`'s doc comment | ⚠️ WARNING | FIXED |
| F5 — inferred code strings untraceable | 💡 OBSERVATION | FIXED |
| F6 — Phase 3 Progress mismatch | 💡 OBSERVATION | FIXED |
| F7 — roadmap ⚠️ block survives the flip | 💡 OBSERVATION | FIXED |

**Verdict after fixes: REVISE → SOUND.** All seven applied to `plan.md` (plus one Open-Risks line
in `plan-brief.md` for F2). The Progress contract was re-verified by execution after the edits.
