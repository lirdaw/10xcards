<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Forced-language prompt fix

- **Plan**: `context/changes/forced-language-prompt-fix/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-31
- **Verdict**: REVISE → **SOUND** after triage (all six findings fixed in the plan, 2026-07-31)
- **Findings**: 2 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | FAIL |

Both FAILs are localized with obvious targeted fixes; the approach, the evidence base and
the measure-first sequencing are sound. This is not a RETHINK.

## Grounding

11/11 paths ✓ (`tests/db/` is new, as planned), 12/12 symbols + line refs ✓, brief↔plan ✓.
Verified by direct read: `openrouter.ts:93-106` (auto `:96` / forced `:97`), `:155` mock
audit payload; `generation-limits.ts:43,45`; `generate.ts:51,143-153,213,250,290`;
`GeneratorForm.tsx:9,26,237`; `generate.astro:11-13`; `flashcard_state` precedent in
`20260705180246_init_core_schema.sql`; `generation_session.language` = `text not null`, no
CHECK; `vitest.eval.config.ts` omits `setupFiles` and touches no Supabase seam;
`tests/fixtures/` exposes no privileged client and `tests/setup/preflight.ts:61` hard-fails
on a `service_role` key. Progress↔Phase mechanical contract: PASS (one `## Progress`, five
matching `### Phase N` blocks, every Success Criteria bullet has an `N.M` entry, no
checkboxes outside Progress).

`docs/reference/contract-surfaces.md` does not exist — contract-surface check skipped.

## Findings

### F1 — Phase 3 deletes exports two later phases still import

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3 "Remove the code-side whitelist"
- **Detail**: Phase 3 deletes `LANGUAGES` and `Language` from `src/lib/generation-limits.ts`.
  Two consumers survive that phase: `src/components/generate/GeneratorForm.tsx:9` (imports
  both; uses `LANGUAGES` as a **value** at `:237`), removed only in Phase 4; and
  `evals/generation-quality.eval.ts:3,52,71` (`import type { Language }`), removed only in
  Phase 5. So Phase 3's own criteria 3.2 (`npm run lint`) and 3.3 (`npm run build`) cannot
  pass: `astro build` bundles the island and Rollup errors on a missing named export, and
  eslint runs `strictTypeChecked` with `projectService: true` over the whole repo
  (`eslint.config.js:14-21`, tsconfig `include: ["**/*"]`), so `evals/` is type-linted too.
  The plan nowhere declares an intentionally-red intermediate phase — criteria 3.2/3.3 say
  the opposite.
- **Fix**: Move the deletion of `LANGUAGES` / `Language` out of Phase 3 into Phase 5, after
  both consumers are rewired. Phase 3 stops **importing** them (the Zod enum goes) but leaves
  the module intact; Phase 4 removes the island's import; Phase 5's eval edit is the last
  reader, so the delete and the comment-block relocation land there. No other phase content
  changes.
- **Decision**: FIXED — deletion deferred to Phase 5 (new item 4); Phase 3 §3 rewritten to
  "stop importing" with the reason recorded inline.

### F2 — Phase 2's `is_active` test cannot be written with this harness

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §5 "Table tests"
- **Detail**: The contract asks for two mutually exclusive things in one sentence:
  "`listActiveLanguages` omits a row whose `is_active` is false (flipped and restored inside
  the test)" **and** "a write attempt by an authenticated client changes nothing
  (deny-by-default)". The migration has no write policies, so no client the harness can build
  may flip that row, and there is no privileged client by design: `tests/fixtures/` exports
  only `clientFor` (anon key, RLS-scoped) and `tests/setup/preflight.ts:61` hard-fails on a
  `service_role` key. Mutating a shared seed row inside an `it()` would also violate C10X-32's
  owned-fixture rule (test-plan §6.2) under the permanently shuffled runner. Criterion 2.3 is
  therefore unachievable as specified, and the one capability the table was chosen for —
  deactivation without a deploy — would rest on manual checks alone (4.5).
- **Fix A ⭐ Recommended**: Seed a sixth, permanently **inactive** row
  - Strength: Makes the `is_active` filter falsifiable by an automated read-only assertion,
    forever, at zero manual cost — the exact "assertion that cannot go red" problem test-plan
    §6.6 has now recorded four times. A prepared-but-unshipped language is meaningful
    dictionary data, not a fake fixture.
  - Tradeoff: One row ships to production that no surface renders; the "five shipped
    languages" wording in Phases 2 and 4 needs restating as "five active of six seeded".
  - Confidence: HIGH — read-only assertion, no harness change.
  - Blind spot: If it is ever activated in prod, no reference text and no `prompt_name`
    coverage exists for it.
- **Fix B**: Drop the automated `is_active` claim; prove it by breakage check
  - Strength: Matches how this project already proves DB-level guarantees — a manual neuter
    with a verified restore (Phase 3's 3.6 already does exactly this for `de`). Nothing fake
    ships.
  - Tradeoff: The filter has no standing regression guard; it is re-proven only when someone
    re-runs the check.
  - Confidence: HIGH — this is the project's existing convention.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — sixth row `it`/`Włoski`/`Italian` seeded `is_active =
  false`; Phase 2 §5 rewritten read-only with a positive control; §4, Desired End State and
  criterion 2.6 restated as "five active of six seeded".

### F3 — Criterion 5.2 ("eval exits 0") fights the eval's own gate

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 5 Success Criteria 5.2 vs 5.5
- **Detail**: The per-case language gate is hard 100%
  (`generation-quality.eval.ts:137-138`, `expect(wrongLanguage).toEqual([])`), so any single
  wrong-language card in any of the now-11 cases makes the run exit non-zero.
  `forced/hiszpański`'s recorded baseline is 4/5 intermittent — so 5.2 ("exits 0") and 5.5
  ("no case regresses below its baseline") can disagree on the same run, and 5.5 would pass
  while 5.2 fails with nothing broken. At one sample per case at temperature 0.4 that is a
  live outcome, not a corner case. The plan carries the project's re-run-once calibration rule
  in Phase 1's notes but does not apply it to the acceptance criterion; Phase 1's own 1.1 is
  worded correctly ("run completes"), 5.2 is the one that overreaches.
- **Fix**: Restate 5.2 as "exits 0 after the project's re-run-once calibration rule, OR the
  residual failure set is recorded in `verification.md` and is a strict subset of the C10X-31
  baseline", and add an explicit line for `forced/es`: 5/5 is the target, 4/5 is recorded as
  still-intermittent and does not block the phase.
  - Strength: Keeps the gate honest without letting a known-flaky case block a change that
    fixed what it set out to fix.
  - Tradeoff: The acceptance signal stops being a single exit code.
  - Confidence: HIGH — the flakiness is measured and recorded.
  - Blind spot: None significant.
- **Decision**: FIXED — 5.2 restated with the calibration rule; an Implementation Note pins
  the `forced/es` case and names exactly which reds block the phase; Progress 5.2 updated.

### F4 — The working fix is measured, then thrown away for three phases

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 1 §1 + Critical Implementation Details
- **Detail**: Phase 1 proves the fix by "the crudest possible means (an inline map inside the
  module)" and then deletes it, uncommitted. The user-visible production defect — a learner
  picking German and silently getting Polish cards, which `change.md` frames as a direct drag
  on the PRD's 75% metric — therefore closes only after Phase 3, a migration, and a prod
  `db push` gated by C10X-29's drift check. This is **not** a challenge to the table decision
  (recorded, and the user's explicit call); it is about what Phase 1 leaves behind. A ~6-line
  `PROMPT_LANGUAGE_NAMES` map keyed by `Language` and consumed by `systemPrompt` is shippable
  on its own — no migration, no API change, no contract move — and would make Phases 2–4 a
  pure refactor whose acceptance run has a green baseline.
- **Fix A ⭐ Recommended**: Make Phase 1's edit shippable and commit it
  - Strength: The defect leaves production on day one; Phases 2–5 become a refactor whose
    acceptance run starts green, so a red there means the refactor broke it — a much sharper
    signal than the plan gets today.
  - Tradeoff: The constant is written twice (once in code, later in the seed) and deleted in
    Phase 3; one extra commit and one extra ship cycle.
  - Confidence: HIGH — the map's shape is already fully specified by the Phase 2 seed table.
  - Blind spot: Whether the user wants two ship cycles for one ticket.
- **Fix B**: Keep Phase 1 throwaway as planned
  - Strength: One ticket, one ship, one migration; no transient constant to delete later.
  - Tradeoff: The defect stays in production for the whole change, and the eval's first green
    run is also the run that first exercises the table, the endpoint rewrite and the new
    signature together — multi-variable if it is red.
  - Confidence: HIGH — this is what the plan already says.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — Phase 1 now writes and COMMITS
  `PROMPT_LANGUAGE_NAMES` in `generation-limits.ts`; criteria renumbered (1.5 gates,
  1.8 commit-on-its-own); Phase 5 item 4 deletes it with `LANGUAGES`; Critical
  Implementation Details, Implementation Approach and plan-brief updated to match.

### F5 — `tests/` gains a dependency on the deliberately-isolated `evals/` tree

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §4 "Shared name fixture"
- **Detail**: `evals/fixtures/language-names.ts` is imported relatively by
  `tests/db/languages.test.ts`. Two consequences the plan does not name. (a) Direction:
  `vitest.eval.config.ts:5-11` and the eval preflight go to real lengths to keep the
  acceptance instrument structurally separate from `npm test`; this makes the ordinary suite
  import from it. (b) Typing: keying by `ReferenceLanguageCode` conflates "languages the app
  ships" with "languages the eval has a reference text for". They coincide at five today; a
  sixth language added by a migration seed would turn the DB assertion red until someone
  authors a reference text — friction pointing the wrong way for a change whose premise is
  that the language set becomes data.
- **Fix**: Key `PROMPT_LANGUAGE_NAMES` by `string` (or its own union) rather than
  `ReferenceLanguageCode`, and have the DB test assert that every seeded active row **has** a
  name in the fixture rather than set equality against exactly five. State in the plan which
  tree owns the file; if the suite is the primary consumer, `tests/fixtures/language-names.ts`
  re-exported into the eval is the dependency direction that matches the isolation.
- **Decision**: FIXED — the fixture moves to `tests/fixtures/language-names.ts` with a
  one-line re-export in `evals/`; keyed by `string`; the DB assertion becomes per-active-row
  ("every active row has an entry") instead of set equality against five.

### F6 — The replacement injection guard is described, not specified

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §2 "Endpoint validation and resolution"
- **Detail**: "a bounded lowercase-code pattern (a regex admitting `auto` and 2–8 character
  codes)" is the only spec given for the field impl-review F3 named a prompt-injection guard,
  and that this change converts from a compile-time enum to a runtime check. Every other regex
  in the endpoint is pinned as a literal (`UUID_RE`, `generate.ts:42`). The wording also
  implies a special case that does not exist: `auto` already matches `[a-z]{2,8}`.
- **Fix**: Pin the literal in the plan — e.g. `const LANGUAGE_CODE_RE = /^[a-z]{2,8}$/` — and
  drop the "admits `auto`" clause. Add one sentence to the relocated comment block: after this
  change the string reaching the prompt is `prompt_name` from the table, so the injection
  surface moves from the request to the row — a constraint the admin-panel follow-up must
  inherit.
- **Decision**: FIXED — `LANGUAGE_CODE_RE = /^[a-z]{2,8}$/` pinned in Phase 3 §2 beside the
  `UUID_RE` precedent, "admits auto" dropped, and the moved-injection-surface note added
  there plus carried into Phase 5's follow-up contract.
