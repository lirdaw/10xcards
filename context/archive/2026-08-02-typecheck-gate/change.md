---
change_id: typecheck-gate
title: Typecheck gate — `tsc --noEmit` as an npm script and a CI step
status: archived
created: 2026-08-02
updated: 2026-08-03
archived_at: 2026-08-03T14:51:53Z
---

## Notes

Add a typecheck gate to this project: a `typecheck` npm script running `tsc --noEmit` plus a CI step that runs it, so a type error can no longer hide behind a fully green lint + build + test. Measured, not argued: reverting to b015662 makes `npx tsc --noEmit` exit 2 with exactly one error (TS2353 in evals/generation-quality.eval.ts) — the eval is Risk #7's only acceptance instrument, and it sat uncompilable for two full phases while every gate was green, because `npm run lint` is ESLint with type-aware rules rather than tsc diagnostics, `astro build` does not run `astro check`, and `npm test` deliberately never collects `evals/**`. Scope: decide the blast radius BEFORE wiring it — tsconfig.json has include ["**/*"], so the gate covers src/, tests/, evals/ and scripts/ at once, and scripts/ is AGENTS.md's documented exception to the import rules (bare `node --experimental-strip-types`, no `@/*` alias, no `astro:env/server`), so confirm it passes rather than assuming, because a gate that has to be weakened on day one is worse than no gate; sequence the step after `npx astro sync` exactly as lint already requires; and decide deliberately, in scope or out, on `noUncheckedIndexedAccess` (off today — astro/tsconfigs/strict does not enable it). NOT in scope: the eval's isolation from `npm test`, which is correct and load-bearing and must keep collecting zero eval files — staying out of the test run and being type-checked are not in tension. Refs: context/archive/2026-07-31-forced-language-prompt-fix/follow-ups/typecheck-gate.md, that change's verification.md section "A finding, measured rather than noticed", and context/foundation/test-plan.md §5 (the gate set this joins) plus §6.6's C10X-41 entry. (source: C10X-43)
