<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Swallowed compensation error (C10X-48)

- **Plan**: `context/changes/bug-generation-compensation-swallowed/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-13
- **Verdict**: REVISE
- **Findings**: 3 critical, 2 warnings, 3 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | FAIL    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | FAIL    |
| Plan Completeness     | WARNING |

The rubric maps two FAIL dimensions to RETHINK. Recorded as **REVISE** deliberately: the
approach — families (a)+(c), the pure-function extraction, and the retire → confirm →
fall-through ordering — was checked against the code and the partial index and holds. What
fails is three specific decisions inside that approach, each with a point fix.

## Grounding

9/9 paths ✓, 3/3 new files absent ✓, 8/8 symbols ✓, `## Progress` structurally consistent
(5 phases, 22 entries, every Success Criteria bullet matched) ✓, brief↔plan ✗ (see F7).
`docs/reference/contract-surfaces.md` absent — surface check skipped.

## Findings

### F1 — Hardening `:400` gives detection, not deletion — the newDeckName dead end survives

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: `change.md` D-01 · Implementation Approach · Phase 2 §1
- **Detail**: D-01 pulls `generate.ts:400` into this ticket because "a healed retry on the
  `newDeckName` path 409s on an orphan deck". Phase 2's contract for `:400` is only to branch on
  the result and answer with a distinct message plus `retriable: true` — detection, not deletion.
  Research §2's correlated-failure argument cuts both ways: when the compensation fails, the deck
  undo fails too. After the full plan ships the path is still: retry → replay finds the poisoned
  row → retires it → falls through → `deckNameExists` finds the orphan → **409, permanently**.
  Desired End State #3 is met only in the letter. The obvious repair is blocked by the schema:
  `generation_session` has no deck FK (`20260712162349:21-36`) and the deck is read back through
  the cards, of which there are zero — so the orphan deck is unreachable from the poisoned session.
- **Fix A ⭐ Recommended**: Make the healed fall-through survive the name collision — on the
  `newDeckName` path, adopt an owned, empty deck of that name instead of 409ing.
  - Strength: Closes the loop on the path the bug was reported from; `deckNameExists` already
    returns the deck's `public_id`, and an owned empty deck of that name is exactly what the
    failed attempt left behind.
  - Tradeoff: A real behaviour change beyond the swallow; needs its own denial case so a
    non-empty deck still 409s.
  - Confidence: MEDIUM — mechanism verified, interaction with the existing 409 test not traced.
  - Blind spot: Whether a test pins the 409-on-duplicate-name behaviour this would relax.
- **Fix B**: Drop `:400` from scope; state the limitation in "What We're NOT Doing".
  - Strength: Restores a clean ticket boundary and removes a claim the plan cannot back.
  - Tradeoff: Ships a fix that demonstrably does not restore the retry on the `newDeckName` path.
  - Confidence: HIGH — this is deleting an unsupported claim.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — heal-gated adoption. The emptiness-only form proposed in the report was verified against the suite and REJECTED: it turns `generate.test.ts:805` red, because a hand-made empty deck is not an orphan.

### F2 — The self-heal overwrites truthful audit rows with a false failure

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 · Phase 3 §2 · What We're NOT Doing
- **Detail**: `retireGenerationSession` writes `status='failed'`, `saved_count=0`,
  `error_message=<message>`, `idempotency_key=null`. Phase 3 reuses it verbatim to clear a §6 row —
  a session that genuinely succeeded and whose cards the user later deleted. Research §6 is
  explicit that in those paths `saved_count` is **truthful about what once landed**. The plan zeroes
  it and stamps a failure message on a row that never failed: this ticket's own defect class,
  reintroduced one path over by the fix. The plan also never says which message the heal passes, so
  the implementer reaches for the compensation's "Zapis kart nie powiódł się", which is false there.
  The "we cannot tell them apart" decision is sound; what does not follow is that both should be
  rewritten — only replayability needs removing.
- **Fix A ⭐ Recommended**: The heal nulls the key only; retirement stays the compensation's job.
  - Strength: Never destroys a true fact. Nulling the key is sufficient and complete for the heal
    (it is what both the partial index and `findSucceededSessionByIdempotencyKey` key on), and it
    keeps the two call sites honest — Phase 2 retires a row it knows failed, Phase 3 disarms a row
    it cannot judge.
  - Tradeoff: Two lib operations instead of one; a genuinely poisoned row that Phase 2 failed to
    retire keeps its `succeeded` status in the audit.
  - Confidence: HIGH — verified against the index predicate and both readers.
  - Blind spot: None significant.
- **Fix B**: Keep one operation, pass a message that asserts no cause.
  - Strength: One code path, smallest diff from the plan as written.
  - Tradeoff: Still zeroes a truthful `saved_count` and still flips a succeeded row to failed — the
    data loss survives however carefully the message is worded.
  - Confidence: HIGH — but it addresses the wording, not the corruption.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — the heal clears the key only; retirement stays the compensation's job.

### F3 — Phase 4 removes "Ponów" from every transient 500, including this ticket's own

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 4 §1
- **Detail**: Measured across all 20 `return json(...)` sites in `generate.ts`: exactly two carry
  `retriable` — `:302` (502) and `:329` (422). Phase 4 makes `canRetry` follow that flag, so "Ponów"
  disappears from `:122`, `:183`, `:212`, `:239`, `:251`, `:339`'s 500 arm, `:350`, `:389`, and —
  the sharp end — `:402` **when the compensation succeeded**. That last one is the ordinary
  card-insert failure, the branch this ticket exists for, and its retry already works today: the row
  is retired to `failed`, the succeeded-only lookup misses it, the partial index does not contain
  it, and a fresh generation runs cleanly. Desired End State #5 frames this as removing the button
  "where it is guaranteed pointless"; the enumeration says the flag's absence marks mostly-retriable
  failures.
- **Fix A ⭐ Recommended**: Invert the default — absent means retriable; emit `retriable: false`
  explicitly on the genuinely non-retriable returns (400/401/404/409 plus the unconfigured 500).
  - Strength: Fail-safe by construction — a forgotten flag keeps the affordance instead of silently
    removing it, the same reasoning `lessons.md` applies to gates. Preserves today's behaviour
    everywhere it is already correct.
  - Tradeoff: Touches more return sites than the plan budgeted; the flag reads oddly when its
    interesting value is `false`.
  - Confidence: HIGH — derived from an enumeration of all 20 return sites.
  - Blind spot: Whether the island should also distinguish "retry the same key" from "start over"
    is untouched by either option.
- **Fix B**: Keep the plan's polarity and stamp `retriable: true` on the transient 500s.
  - Strength: Keeps the flag intuitive (true = you may retry).
  - Tradeoff: Fails open in the wrong direction — a future 500 added without the flag silently
    loses its retry button, and nothing tests islands (test-plan §7), so it ships unseen.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — absent `retriable` means retriable; the endpoint marks the non-retriable returns explicitly.

### F4 — Rename blast radius under-counted, and criterion 1.5 is self-falsifying

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §3 · Success Criteria 1.5
- **Detail**: `failGenerationSession` occurs at **eight** sites in `src/` + `tests/` —
  `generations.ts:96, :119, :132`; `generate.ts:21, :294, :385, :396`; `generate.test.ts:40`. Phase 1
  §3 names two. `generate.ts:385` is not a rename but a **semantic** correction: it reads
  "Best-effort, like failGenerationSession", which goes false once Phase 2 stops `:396` being
  best-effort while `:387` stays so. Separately, criterion 1.5 ("no remaining references in `src/` or
  `tests/`") collides with Phase 1 §3's instruction to write dated corrections, which in this repo
  keep the superseded wording — the self-falsifying-grep class test-plan §8 records for the
  "npx playwright install" sentence.
- **Fix**: Enumerate all eight sites in Phase 1 §3, split `generate.ts:385` out as a semantic
  correction, and re-word 1.5 to target the import and call sites (`generate.ts:21`, `:396`) rather
  than any textual occurrence.
- **Decision**: FIXED — all eight sites enumerated in a table, `:385` split out as a semantic correction, criterion 1.5 rescoped to the import and call sites.

### F5 — The reachability run is under-specified and proves the wrong arm

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5 §2, fourth bullet
- **Detail**: Two problems in one sentence. (1) Revoking `UPDATE` on `generation_session` does
  nothing to an INSERT on `flashcard`; a second revoke is required to make the card insert fail and
  is nowhere named, so the implementer discovers it mid-run against a live stack. (2) With the grant
  revoked the retirement returns an **error**, so the run exercises the error arm only — the
  **zero-row** arm, which is the entire reason `.select()` is being added, stays unproven by
  anything.
- **Fix**: Name both revokes; and prove the zero-row arm where it is cheap and **committable** —
  call `retireGenerationSession` from a test with an RLS-scoped client against another account's
  session id. Under RLS that matches zero rows with `error: null`, needs no seam, no DDL and no
  fabrication, and earns a regression guard the manual run cannot give.
- **Decision**: FIXED — both revokes named; the zero-row arm moved to a committable cross-account test, and the manual run now states it proves the error arm only.

### F6 — "Ponów" starts costing money; the bound exists but is unstated

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Performance Considerations
- **Detail**: Today a poisoned key returns 500 **before** the LLM call — free. After Phase 3 it
  generates. Performance Considerations discusses only round-trips. The bound is real and worth
  stating: the retirement removes the key, so the heal fires at most once per key.
- **Fix**: Add one line naming the cost change and the once-per-key bound the confirm step provides.
- **Decision**: FIXED — Performance Considerations names the cost change and the once-per-key bound.

### F7 — plan-brief's "Starting Point" contradicts research §1

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: `plan-brief.md` § Starting Point
- **Detail**: The brief says `generate.ts:392-403` "is the only place in the file where an `await`'s
  result is not checked". Research §1 enumerates five such sites, and the plan's own "What We're NOT
  Doing" excludes three of them (`:277`, `:314`, `:387`).
- **Fix**: Reword to "the only one this ticket owns" and name the other three with their tickets.
- **Decision**: FIXED — plan-brief rescoped to the two sites this ticket owns, naming the other three and their tickets.

### F8 — Doc-sync misses two test-plan.md references to the renamed symbol

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §4
- **Detail**: `test-plan.md:1401` and `:1572` both name `failGenerationSession`, and `:1572` states
  it "leaves its key in place" — the claim D-03 inverts. Phase 5 §4 names only §6.6's Phase-2 entry.
- **Fix**: Add both line references to the doc-sync contract; `:1572` needs a dated correction, not
  just a rename.
- **Decision**: FIXED — both `test-plan.md` line references added; `:1572` flagged as a dated correction, not a rename.
