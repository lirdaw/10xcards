<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Checked deck undo after a failed generation-session insert

- **Plan**: `context/changes/bug-generation-deck-undo-swallowed/plan.md`
- **Scope**: Full plan — Phases 1–4 of 4 (all Progress boxes `[x]`)
- **Date**: 2026-08-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension           | Verdict             |
| ------------------- | ------------------- |
| Plan Adherence      | WARNING (1 finding) |
| Scope Discipline    | PASS                |
| Safety & Quality    | WARNING (1 finding) |
| Architecture        | PASS                |
| Pattern Consistency | PASS                |
| Success Criteria    | PASS                |

## Success criteria — re-executed, not cited

Every automated criterion was re-run against the tree as it stands (2026-08-13):

| Criterion                                             | Result                                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 `npm run typecheck`                               | exit 0 — `Result (151 files): 0 errors, 0 warnings`                                                                                                 |
| 1.2 `npm run lint`                                    | exit 0 — exactly 3 `no-console` warnings, all in `evals/generation-quality.eval.ts`                                                                 |
| 1.3 `npm run build`                                   | exit 0 (standing `@astrojs/sitemap` `site` warning unchanged)                                                                                       |
| 1.4 `npm test`                                        | **437 passed / 437, 36 files**, seed `1786632195129`; `generate.test.ts` "409s a newDeckName that is already taken" passes in isolation             |
| 1.5 `git diff -- supabase/`                           | empty                                                                                                                                               |
| 1.7 literal absent from `redirect-errors.ts`          | 0 hits; `src/lib/redirect-errors.ts` and `tests/lib/redirect-errors.test.ts` both untouched in the diff                                             |
| 2.1/2.2 suite total re-measured by running            | `tests/isolation/decks.test.ts` → **7 passed (7)**, matching the ledger's `5 → 7`                                                                   |
| 4.1 `npm run format` idempotent                       | `prettier --check` on all edited markdown → "All matched files use Prettier code style!"                                                            |
| 4.2 `context/archive/**` untouched                    | 0 files in the diff                                                                                                                                 |
| 4.3 no live doc claims C10X-49 owns an unchecked site | both stale sentences (`test-plan.md:1771`, `:5344`) sit inside dated C10X-48 entries and each carries a dated correction beneath (`:1778`, `:5350`) |

Guardrails: `src/lib/decks.ts`, `supabase/`, `jira-map.md`, `lessons.md`, `context/archive/**` all untouched; `generate.ts:426` and `:477` still bare `await createGenerationSession(...)` (C10X-50's); `return outcome.response` unchanged as code.

Plan adherence: all ten planned changes verified MATCH against the actual files, including the byte-identical undo block, the exact message wording, both required comment rewrites, roadmap H-17's nine-field detail block, the own-`it()` positive control, and both dated corrections appended rather than rewritten.

One unplanned edit was checked and is **not** scope creep: `test-plan.md` gained a third dated correction (C10X-48's `434` → `435`) that is _entailed_ by criterion 4.5 — 434 + 2 ≠ 437, so a measured total forced reconciling the neighbouring entry, and it is corroborated at the file (`generate.test.ts` measures 27, not 26) rather than by arithmetic.

## Findings

### F1 — Two live documents assert a novelty claim the shipped code explicitly refutes

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/test-plan.md:29`; `context/changes/bug-generation-deck-undo-swallowed/change.md:30`
- **Detail**: Both say this change's `retriable: false` is "this handler's **first** `false` on a 500". Phase 1's own code comment caught that during implementation and says so at `src/pages/api/generate.ts:624-626`: "`retriable: false` is deliberate — and **NOT this handler's first on a 500**, a claim the plan made and the manual read caught". The code is right: `generate.ts:186` already returns `json(500, { error: SUPABASE_UNCONFIGURED_MESSAGE, retriable: false })`, and the convention docblock at `:103` names it. So Phase 1 corrected the plan in code and Phase 4 then propagated the uncorrected version into the test-plan's live header entry and into D-03. Neither site is a protected dated snapshot: `test-plan.md:29` is the current "Last updated" block written by _this_ change, and D-03 is this change's own live decision log. The substantive decision (`false` because "Ponów" would hit a deterministic 409 at `deckNameExists`) is sound and unaffected — only the novelty claim is false. It matters because `test-plan.md` is the document this project treats as its ledger of measured truth, and a false factual claim there is precisely the class its own discipline exists to catch.
- **Fix A ⭐ Recommended**: Edit both sites in place; leave `plan.md:86` as written.
  - Strength: Both are live declarations, and `lessons.md:236-241` reserves dated corrections for _snapshots_ — editing a live claim in place is the rule, not the exception. Leaving `plan.md` alone is coherent rather than lazy: the code comment attributes the claim to the plan ("a claim the plan made"), so the plan keeping it is what makes that sentence readable.
  - Tradeoff: The test-plan header carries a date, so an in-place edit slightly blurs the live/dated line the project polices hard.
  - Confidence: HIGH — the "first `false`" claim is falsifiable in one grep, and `:186` predates this change by many commits.
  - Blind spot: Not re-checked whether any _other_ document (roadmap H-17, verification.md) repeats the claim in different words — greps for "first" found none, but only the exact phrasing was searched.
- **Fix B**: Append a dated correction line beneath each, rewriting neither.
  - Strength: Treats every dated block identically and preserves the record that the claim was believed on the day it shipped.
  - Tradeoff: Adds two correction blocks for a claim that was already corrected in code hours earlier and that nothing has built on — the register grows without buying a distinction.
  - Confidence: MEDIUM — defensible under the same rule, but the rule's own text scopes corrections to sections whose _siblings are uniformly out of date_, which is not this.
  - Blind spot: Whether a future reader finds a correction-under-a-fresh-entry clearer or noisier than a clean edit.
- **Decision**: FIXED via Fix A — both live sites edited in place, each stating what IS new (the kind of 500: this one has paid for a generation, `:186` refuses before any work). `plan.md:86` deliberately left standing, because `generate.ts:624-626` attributes the claim to the plan. `prettier --check` clean afterwards.

### F2 — The new comment's reachability argument has a step that is not an identity

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/generate.ts:557-560`
- **Detail**: Phase 1 item #4 rewrote the block comment to disclose that `return outcome.response` (`:573`) bypasses the undo, and justified leaving it as code with: "the combination is ~unreachable anyway — a 23505 here needs an earlier request with the same key, **hence the same `newDeckName`**, to have committed, and `deck_user_name_unique` stops any such request before it can create a deck of its own." The bolded step is the one that does not hold. A key reused across two _differently shaped_ payloads breaks it: request A carries `deckPublicId` (an existing deck, so no name to collide on), request B carries `newDeckName`. Under concurrency B's top lookup can miss A's not-yet-committed row, B creates its deck, then B's session insert hits `23505` — reaching the block with `createdDeckPublicId` non-null _and_ the `23505` sub-branch. If `replaySession` then answers, `:573` returns early and the deck is orphaned **silently**, which is this ticket's own defect on the one path the fix does not cover. `GeneratorForm` cannot produce it (one key per submit, `lastPayload` replayed verbatim), so this is a crafted-client or concurrent-client path only, and the blast radius is one empty deck owned by the caller — no data loss, no cross-account exposure. The plan's Current State Analysis carries the same reasoning, so this is an inherited argument rather than an implementation slip. Worth correcting because manual criterion 1.6 was explicitly "no comment now claims something the code does not do".
- **Fix**: Qualify the step in the comment — the collision needs an earlier request with the same key, which _for a client that mints one key per submit_ implies the same `newDeckName`; note that a client reusing a key across differently-shaped payloads escapes that implication, and that on such a path the orphan is silent again.
- **Decision**: FIXED — comment at `generate.ts:552-570` now scopes the implication to a one-key-per-submit client, names the escaping shape (request A with `deckPublicId`, concurrent request B with `newDeckName`), states the blast radius, records that the orphan is silent on that path, and routes the structural fix (hoisting the undo above the block) to its own ticket rather than a drive-by. Code untouched, per the plan's "Not touching the `:566` early return's CODE". Re-verified: typecheck 0 (151 files), lint 0 with the same 3 `evals/` warnings, `npm test` 437/437, 36 files.
