# test-plan.md refresh for the arrival of e2e — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-08-05/plan.md`
> Research: `context/changes/test-plan-refresh-2026-08-05/research.md`
> Brief + decisions: `context/changes/test-plan-refresh-2026-08-05/change.md`

## What & Why

A Playwright harness landed on `main` (`8a12d07`, `5f3c87e`) and the project's test guide still
says e2e does not exist. This change updates the guide only: it corrects what is **false today**,
adds a §3 Phase 6 row as `not started` so the e2e work runs the full change loop, and re-dates
three §7 exclusions whose re-evaluation trigger turned out to be unreachable. It does **not**
build the e2e layer.

## Starting Point

`test-plan.md` §4 says `e2e | none yet — deliberately deferred`, §5 says e2e is "deliberately
absent", and three §7 exclusions defer their own re-evaluation to "the moment any §3 phase wires
e2e". Meanwhile a runner, a config and one spec are committed. Separately, research measured that
the type gate now checks **135** files rather than the documented 133 — and that the two added
files are exactly `playwright.config.ts` and `tests/e2e/seed.spec.ts`, so **the e2e layer is
already inside the type gate, in CI and on `pre-push`, and no document knows it.**

## Desired End State

A reader of `test-plan.md` on 2026-08-05 finds no false statement about e2e or about the gate's
denominator; finds a Phase 6 row a future `/10x-new` can pick up, with a sequencing note carrying
the full harness audit; and finds the §7 exclusions still excluded, re-dated, with the reason
their trigger never fired written down. `README.md` and `lessons.md` carry no stale pointer or
count. No source file changes.

## Key Decisions Made

| Decision                   | Choice                                                                               | Why (1 sentence)                                                                                        | Source   |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------- |
| e2e's place in the rollout | §3 gains Phase 6, `not started`, full change loop                                    | Closes the C10X-39/40/42/43 orphan pattern instead of repeating it                                      | Brief    |
| §7 triggers                | "Mis-keyed — condition never literally met", exclusions stay, re-dated 2026-08-05    | The harness landed outside the rollout, so "any §3 phase wires e2e" was unreachable by construction     | Research |
| Type-gate fact             | Stated in the refresh, riding on the 133 → 135 correction                            | It is a NUMBER correction, not a coverage claim, so it stays inside the refresh's mandate               | Plan     |
| Denominator sites          | `README.md:49` in place; `test-plan.md:2765` dated correction; `AGENTS.md` untouched | Live claims are edited, dated records are appended to — and AGENTS.md quotes no total                   | Research |
| §5 gate rule               | Table row **plus** prose, with cells that state the missing npm script and CI job    | Puts "never a gate, never in `needs:`" where it is scannable without implying runnability               | Plan     |
| §8 ledger dates            | All three → 2026-08-05, **earned** by a version re-verification pass in Phase 2      | A date is a claim that a review happened; doing the review is cheaper than defending an unverified date | Plan     |
| §3 harness note            | Full — all nine findings with verdicts                                               | `test-plan.md` is the document read before a test is written                                            | Plan     |
| §6                         | Two sentences in §6.1/§6.2; no §6.11 subsection                                      | `tests/e2e/foo.test.ts` would be collected by Vitest and explode — a live trap, not cosmetics           | Plan     |
| Suite totals               | One sentence in §8; figures not edited                                               | `364/364, 31 files` is true, and this file's rule is not to rewrite what is true                        | Plan     |
| Journey A oracle           | Deck-page count, recorded as response guidance                                       | The review screen reloads itself and its metric hides silently on an aggregate error                    | Research |

## Scope

**In scope:** `test-plan.md` §3, §4, §5, §6.1/§6.2, §7, §8 and the rolling header; `README.md:49`;
`lessons.md:184`.

**Out of scope:** the harness and both journeys; `.gitignore`; a §6.11 subsection; `H-12` and
`C10X-45` (reserved for the phase, only named here); §1 and §2; `AGENTS.md` on the denominator
axis; any restated suite figure.

## Architecture / Approach

Seven phases ordered by a **consistency constraint**, not by file. Adding the Phase 6 row is what
turns §4's `No rollout phase claims e2e` from true to false, so §3 is written before §4's and
§5's clauses are finalised; the file must be consistent after all edits, not after each one.
Three correction conventions run in parallel and must not be mixed: live claims edited in place
(false half only), dated records appended to and never rewritten, and mis-keyed conditional
clauses replaced by a dated re-decision.

## Phases at a Glance

| Phase                  | What it delivers                                                           | Key risk                                                                          |
| ---------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1. Denominators        | `README.md:49` corrected; `test-plan.md:2765` gets a dated correction      | Rewriting the §6.6 row instead of appending to it destroys a correct dated record |
| 2. §4 Stack            | Versions re-verified; e2e row replaced with Playwright 1.62.1 + `checked:` | Writing the row so it implies the suite is runnable today                         |
| 3. §3                  | Phase 6 row + full harness sequencing note                                 | The note drifting into a coverage claim about work not done                       |
| 4. §5                  | Gate-table row + corrected closing paragraph                               | Contradicting §3/§4 on "claims" vs "wires"                                        |
| 5. §7 + §8 twin        | Three re-decisions and one appended correction                             | Missing the fourth site — it is in §8, not §7                                     |
| 6. §6.1/§6.2 + lessons | Two trap sentences; one pointer fix                                        | Growing into the §6 subsection the phase owns                                     |
| 7. §8 + header         | Three dates, the Vitest-only sentence, the dated entry, the header block   | Moving the dates without Phase 2's verification behind them                       |

**Prerequisites:** none beyond a clean tree — no database, no stack, no network. `npm run typecheck`
and `npm run lint` must be runnable for the closing verification.
**Estimated effort:** one session; Phase 3 and Phase 7 are the writing-heavy ones.

## Open Risks & Assumptions

- **Prettier is a live hazard here.** §8 records `prettier --write` as destructive and
  non-idempotent on this file, and husky — installed for the first time by C10X-43 — now runs it
  on `*.md` at commit. `.prettierignore` covers `context/archive/**`, not `context/foundation/`.
  Every phase checks, and Phase 7 proves idempotency by writing twice.
- **This refresh has no roadmap row**, by decision: `H-12` is reserved for the phase. It will
  therefore archive with nothing for `/10x-archive` to close and need the same backfill H-04,
  H-07 and H-08 needed. Accepted knowingly; cheap to re-decide.
- The harness audit in §3 is a snapshot — two of the six original risks went stale in four days,
  and the phase's first commit will date the rest.

## Success Criteria (Summary)

- No statement in `test-plan.md`, `README.md` or `lessons.md` about e2e or the gate's denominator
  is false on 2026-08-05, checked by per-phase greps with stated expected counts.
- §3 row 6, §4's e2e row and §5's paragraph agree with each other on what a `not started` phase
  claims versus what it wires.
- `npm run typecheck` still reports 135 files / 0 errors, `npm run lint` exits 0, prettier is
  clean and idempotent, and `git diff --stat` touches no file under `src/`, `tests/`, `evals/` or
  `scripts/`.
