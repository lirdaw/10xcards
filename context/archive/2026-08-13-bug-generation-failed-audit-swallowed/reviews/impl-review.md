<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Unchecked "failed" audit-row insert on both generation failure paths

- **Plan**: context/changes/bug-generation-failed-audit-swallowed/plan.md
- **Scope**: Full plan (Phases 1-5)
- **Date**: 2026-08-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Automated verification performed during this review

- `npm run typecheck` — `Result (154 files): 0 errors, 0 warnings`
- `npm run lint` — 0 errors, 3 pre-existing `no-console` warnings in `evals/generation-quality.eval.ts` (unrelated, unchanged)
- `npm test` — **467 passed / 467, 38 files**, seed `1786647051130`
- `npm run build` — exit 0 (only the standing `@astrojs/sitemap` `site` warning)
- `npx vitest run tests/lib/no-logging.test.ts tests/lib/no-env-access.test.ts` — 6 passed
- `npx prettier --check --config ./.prettierrc.json` over the changed docs — clean
- `grep -rn "owned by C10X-50" src/ tests/ context/foundation/` — no stale annotations
- `git status --porcelain -uall` — clean (no residue from the temporary Phase 4 spec)

## Findings

### F1 — `error_message`'s verbatim-to-Sentry exception depends on an unenforced invariant in `openrouter.ts`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/audit-failure-report.ts:32-37`, `:199`; `src/pages/api/generate.ts:428`, `:540`
- **Detail**: `error_message` is the one field the builder sends to Sentry verbatim rather than fingerprinted — documented deliberately in the module's header. Verified safe today: at the transport site it can only be one of three bounded `OpenRouterError` message shapes (`src/lib/openrouter.ts:205-221`), none of which can contain the pasted source text; at the zero-saved site it is a fixed Polish literal. But nothing in `audit-failure-report.ts` itself enforces that boundary — the safety is a property of `openrouter.ts`'s current implementation, not of this module. If `OpenRouterError`'s message construction ever changes to echo raw upstream response text, this field would start leaking it to Sentry silently, with no test in this change positioned to catch it.
- **Fix**: Add a one-line cross-reference in the "ONE DELIBERATE EXCEPTION" comment block noting that this field's safety depends on `OpenRouterError`'s message never echoing raw upstream response bodies — so a future change to `openrouter.ts` doesn't quietly invalidate the assumption.
- **Decision**: FIXED — added a cross-reference paragraph immediately after the "ONE DELIBERATE EXCEPTION" block in `src/lib/audit-failure-report.ts`, naming the three bounded `OpenRouterError.message` shapes this exception currently relies on and instructing a re-check of `openrouter.ts` before trusting it again. Verified: `npm run typecheck` (154 files, 0 errors) and `npm run lint` (0 errors, 3 unrelated pre-existing warnings) both still green after the edit.

## Notes

Two independent sub-agent passes were run: one traced every "Changes Required" item in the plan against the actual diff (file-by-file, including the two call sites' exact statements, the deleted `owned by C10X-50` annotations, and the updated file-invariant sentence) and found **zero drift, zero missing items, zero scope creep**. The other traced the safety-critical claims into their actual dependency code rather than trusting the plan's assertions — `fingerprint()`'s try/catch placement around `JSON.stringify` and `crypto.subtle.digest`, `@sentry/core`'s no-client early return (read directly from `node_modules`), the `{tags, extra}` call shape against `prepareEvent.js`, and postgrest-js's `.single()` vs `.maybeSingle()` semantics — and confirmed each one independently rather than by inspection alone.

The plan's own claims about what this change does and does not prove (Sentry delivery is not provable without a production DCL change; the Site A/B manual reachability runs are one-off, not repeatable) are consistent with what the review found — no gap between what the change claims and what it demonstrates.
