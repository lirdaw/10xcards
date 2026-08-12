<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Remove the public /api/shipprobe error probe

- **Plan**: `context/changes/remove-sentry-probe/plan.md`
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-08-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension           | Verdict               |
| ------------------- | --------------------- |
| Plan Adherence      | PASS                  |
| Scope Discipline    | PASS                  |
| Safety & Quality    | PASS (1 observation)  |
| Architecture        | PASS                  |
| Pattern Consistency | WARNING (1 finding)   |
| Success Criteria    | PASS (2 observations) |

## What held up

Re-executed rather than read, so a later reader can tell a measurement from an assertion. Every
automated criterion in all four phases was re-run against the tree at `b225fee`:

| Check                                               | Result                                                      |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `npm run typecheck`                                 | OK — **149 files**, 0 errors, 0 warnings (floor 50)         |
| `npm run lint`                                      | exit 0 — 0 errors, the same **3** pre-existing `no-console` |
| `npm run build`                                     | exit 0 — standing `@astrojs/sitemap` warning unchanged      |
| `npm test`                                          | **423 passed / 423, 35 files**, seed `1786564742928`        |
| `npx vitest run` on the four Sentry/guard files     | **24 passed**                                               |
| `git ls-files src/pages/api/shipprobe.ts`           | no output — the route is gone                               |
| `prettier --check` on `roadmap.md` + `test-plan.md` | clean                                                       |
| archive-ignore pair over `context/archive/**/*.md`  | silent / **116 files** with the ignore disabled             |
| `gh run view 31633355909`                           | `ci` + `drift` + `deploy` all `completed/success`           |

Independently corroborated beyond the criteria:

- **The extraction is semantics-preserving, line for line.** Diffing the pre-change inline
  `beforeSend` against `sampleSentryEvent` shows identical branches, identical order, identical
  strict `<`. The only behavioural difference is that `Math.random()` is now drawn eagerly per
  event instead of lazily on the sampled branch — no observable effect.
- **The `@/*` alias really does resolve in the Worker entry** — the one step the plan flagged as
  unproven. `dist/server/chunks/worker-entry_*.mjs` contains the inlined `sampleSentryEvent`,
  `DEPENDENCY_NOISE` and the rate. The reserved `./lib/...` fallback was not used.
- **`shipprobe` survives in the built Worker only as the comment saying it is gone** — a single
  hit, no route, no manifest entry.
- **The plan's nine minimum test cases are all present**, plus two beyond them (non-string
  message, just-below-rate). 14 cases in the truth table, 4 in the wiring guard.
- **All five plan-review findings (F1–F6) were genuinely applied**, including the two that added
  scope: the wiring guard (`tests/lib/sentry-wiring.test.ts`) and the local 404 pre-check.
- **Roadmap `Status` and `## Done` are untouched** — H-15 reads `not started` in both the
  At-a-glance row and the detail block; `## Done` contains zero occurrences of this change-id.
- **The diff touches exactly the plan's targets** — no unplanned file, no scope creep.

## Findings

### F1 — Roadmap H-15's Risk bullet still points at `DEPENDENCY_NOISE` in `src/worker.ts`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/roadmap.md:416
- **Detail**: The Risk bullet reads "…klasa pierwszoplanowa przechodzi w 100%, patrz
  `DEPENDENCY_NOISE` w `src/worker.ts`". This change is what made that navigation false:
  `DEPENDENCY_NOISE` moved to `src/lib/sentry-sampling.ts` in Phase 2, and `src/worker.ts` no
  longer contains the symbol at all (verified by grep — the only live-tree hits are the new module,
  the two new tests and `test-plan.md`'s correction). `verification.md` §"Why the roadmap Risk
  bullet was deliberately NOT edited" records the non-edit as a decision, and both of its reasons
  are sound — but both are about **tense** ("Sonda jest publiczna…"), and neither addresses a code
  pointer. A `Risk` bullet may legitimately stay present-tense about why the item exists; a symbol
  reference that no longer resolves is the pointer-rot class this project's own ledger records
  three times (`test-plan.md` §8: "all of them pointers rather than claims — and pointers rot
  silently"). Phase 3's criterion 3.4 could not catch it: it searched for `shipprobe`, not for the
  symbols the change relocated.
- **Fix**: Repoint the symbol only — the bullet's "patrz `DEPENDENCY_NOISE` w …" now names
  `src/lib/sentry-sampling.ts` — leaving the bullet's tense and every other word untouched, so the
  recorded decision not to re-tense it still holds.
- **Decision**: FIXED — symbol repointed to `src/lib/sentry-sampling.ts`; tense and every other word of the bullet untouched.

### F2 — "Both halves are required" overstates the protection for the dominant first-party class

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/sentry-sampling.ts:58-60 (and the case at tests/lib/sentry-sampling.test.ts:121)
- **Detail**: The docblock says both halves of the discriminator are required, because "the
  signature alone would catch a first-party error that merely mentions a Supabase package by name".
  That protection is real only for the **non-console** subclass — and the same file, twenty lines
  above, records the measurement that makes that subclass nearly empty for route errors: Astro
  re-emits first-party exceptions through its own logger, so they arrive stamped
  `logger: "console"` like any dependency warning. Measured against the shipped function rather
  than reasoned: `{ logger: "console", message: "Failed to create deck via @supabase/ssr client" }`
  at a roll of `0.99` returns **`null`** — i.e. a genuine first-party error is dropped 90 % of the
  time because its text mentions a package name. Only `exception.values[].type`/`.value` and
  `message` enter the haystack (stack frames do not), which keeps the exposure narrow, but it is
  not zero and it is the exact direction — silent loss of first-party errors — that `d381c07`
  exists to have fixed. The test file enshrines the weaker reading: its only case for this claim
  drives a **non-console** event, so the subclass that actually matters is unasserted. **This is
  pre-existing behaviour from C10X-53 and the plan explicitly scoped out behaviour changes**, so
  the finding is about a stated boundary being more reassuring than the code, not about a
  regression introduced here.
- **Fix**: Record the residual where it is met — one sentence in the docblock ("a console-stamped
  first-party error whose own text names a noise package IS sampled; stack frames are not in the
  haystack, which is what keeps this narrow") plus one test case pinning it, so the behaviour is
  documented rather than discovered. No behaviour change; re-tuning the discriminator stays future
  work, as the module already says.
- **Decision**: FIXED — docblock gained a dated residual paragraph; `sentry-sampling.test.ts` gained **two** cases (the residual itself, and the stack-frames-are-not-in-the-haystack boundary that keeps it narrow). No behaviour change; 14 → 16 cases, all green.

### F3 — The wiring guard's 20-line floor counts blank lines

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/lib/sentry-wiring.test.ts:71-73
- **Detail**: The comment claims the floor sits "AT the measured value (20 non-comment lines), not
  a round number below it — slack here gives away the shrink direction". Measured: `codeLines`
  returns 20 entries, of which **3 are blank** and 17 are real code. Blank lines are not filtered,
  so three code lines could be deleted and replaced by whitespace with the floor still green. The
  control still does its stated job — an emptied file or a stub would not carry 20 lines plus
  `Sentry.withSentry` — so this is a precision gap in a secondary assertion, not a hole.
- **Fix**: Filter blank lines in `codeLines` alongside comment lines and drop the floor to the new
  measured value (17), so the comment's claim is literally true.
- **Decision**: FIXED — `codeLines` now drops blanks as well as comments, floor lowered to the measured **17**, both comments corrected. `index` is still assigned before the filter, so reported line numbers stay the file's own; guard re-run **4 passed**.

### F4 — `10XCARDS-6` is still unresolved in Sentry and now names a route that does not exist

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: N/A (Sentry issue `10XCARDS-6`; context/changes/remove-sentry-probe/verification.md:680-684)
- **Detail**: The change's own verification flags it and correctly scopes it out: the issue holding
  the probe's five deliberate events is still `New`, as are four other C10X-53 test artifacts, and
  the archived runbook's §6 close-out asks for those to be resolved. This change did not create the
  loose end — but it did make it harder to read, because the culprit URL
  (`/api/shipprobe`) and the stack frame (`chunks/shipprobe_*.mjs`) now point at a route and a
  chunk that no longer exist, and nothing on production can reproduce them. An open deliberate-error
  issue that cannot be reproduced is precisely the standing false alarm runbook §6 exists to
  prevent, and this project has no notification channel to correct the impression.
- **Fix**: Resolve `10XCARDS-6` and the four other C10X-53 artifacts in the Sentry UI (a one-click
  action, no code), or file it against C10X-53's ship so it has an owner rather than a paragraph.
- **Decision**: SKIPPED — the developer takes it manually in the Sentry UI. Out of this change's scope by the same reasoning `verification.md` already records, and not actionable from the repo.
