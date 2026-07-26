<!-- PLAN-REVIEW-REPORT -->
# Plan Review: No source-text or API-key leak on the generation failure path

- **Plan**: `context/changes/ai-candidate-generation-test-2/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-26
- **Verdict**: REVISE → SOUND after triage (all 7 findings fixed in plan, 2026-07-26)
- **Findings**: 1 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

14/14 paths ✓, 15/16 symbols ✓, brief↔plan ✓. Progress format: exactly one `## Progress`
heading, 6/6 phase titles matched between body and Progress, no `- [ ]` outside the Progress
section — clean, `/10x-implement` will parse it.

Confirmed by inspection and by execution against the running local stack, so these need no
re-checking: all 14 cited source paths exist and none of the five new files does; the RLS
policy names Phase 2's breakage check needs (`generation_session_select`,
`generation_session_update`) exist as written
(`supabase/migrations/20260712162349_generation_session.sql:63,69`); `src/` contains **zero**
`console.*` occurrences, so Phase 4's guard starts green; `isOpenRouterConfigured`
(`openrouter.ts:57`) is dead code; `missingConfigs` has exactly one consumer
(`Layout.astro:4,23`) and is module-level as the plan says; the four-constant duplication
(`GeneratorForm.tsx:12-14,23-30` vs `generate.ts:22-30`) is real; `OPENROUTER_API_KEY` is read
inside function bodies (`openrouter.ts:149,186`), which is what makes Phase 5's
`astro:env/server` seam viable; deck creation IS deferred past the LLM call
(`generate.ts:266-270`), so Phase 5's "no deck was created" assertion is sound; and
`test-plan.md:963` still carries the stale `--mutate "src/lib/flashcards.ts:181-212"` range
(`ALLOWED_FROM` is now at `:202`, the guard predicate at `:224`).

## Findings

### F1 — Phase 3's "no write" oracle cannot run for the cases it exists for

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2, "The oracle must be widened first, or the assertions are vacuous"
- **Detail**: The plan prescribes "a status-agnostic count scoped by `source_text`" and points
  at `succeededSessions` (`generate.test.ts:123-132`), which does
  `.eq("source_text", sourceText)`. PostgREST puts filters in the query string and Kong caps
  the request line at ~8 KB. Measured against the running local stack:
  `n=10001 → HTTP 414 "URI too long"`, `n=10000 → HTTP 414`, `n=8000 → passes (401)`.
  So the over-length case (`SOURCE_MAX + 1`) **and** the boundary control (exactly
  `SOURCE_MAX`, which must be read back after it succeeds) both fail at the transport layer
  before any assertion runs — the test goes red on `expect(error).toBeNull()` for a reason
  unrelated to the behaviour under test. The existing helper shares the defect; it has simply
  never been handed a long string.
- **Fix**: Scope by a short per-case marker, not the full text. Give each case a
  `<suffix>-<case>` header as the FIRST characters of `sourceText` and query
  `.like("<marker>%")`; the filter stays a few dozen bytes regardless of body length. Apply it
  to the new status-agnostic count and to `succeededSessions` at the same time.
  - Strength: Keeps the per-file `Date.now().toString(36)` namespacing §6.5 mandates, and works
    identically for the 10 KB and the 1 KB cases so one helper covers the whole block.
  - Tradeoff: `like` on a large `text` column is a sequential scan — a non-issue at suite
    volume, but not an index hit.
  - Confidence: HIGH — the 414 is measured, not inferred.
  - Blind spot: Not checked whether any `deck`-name count in the same phase has a comparable
    length problem (names are ≤ 100 chars, so almost certainly not).
- **Decision**: Fixed — short-marker `.like()` scoping written into Phase 3 §2

### F2 — Phase 1's mapper chain relies on an undeclared dependency

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1, "Three corrections from `research.md`", bullet 2
- **Detail**: The prescribed fallback chain is `code` → `name` / "an exported type guard
  (`isAuthApiError`, `isAuthWeakPasswordError`, `isAuthRetryableFetchError`)" → `status`. Those
  guards are exported from `@supabase/auth-js`'s root, but that package is **not** in
  `package.json` `dependencies` (only `@supabase/supabase-js` ^2.99.1 and `@supabase/ssr`), and
  `@supabase/supabase-js` 2.105.3's root type surface re-exports only `AuthSession` and
  `AuthUser` — no `AuthError`, no guards, no `ErrorCode`. Importing them means depending on a
  hoisted transitive package with no declared version range: the same objection the plan raises
  one bullet earlier to rule out deep-importing `ErrorCode`, applied inconsistently.
- **Fix**: Drop the type-guard link. Key on `error.name`, which every class sets explicitly
  (`auth-js/dist/module/lib/errors.js:15,44,69,86`), alongside `code` and `status`, and type the
  mapper's parameter structurally (`{ code?: string; name?: string; status?: number }`) so it
  needs no auth-js type import either.
- **Decision**: Fixed — chain keys on `error.name`; type guards removed, structural parameter type

### F3 — Five unrelated intents under one ticket (the "one change or three?" question)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Lean Execution
- **Location**: Whole plan / `change.md` ("Still open for `/10x-plan-review`")
- **Detail**: C10X-28's acceptance is "assertions are on payload and log CONTENT" for Risk #4.
  The plan delivers, under that one scope key: a production behaviour change on the front door
  (Phase 1), a cross-cutting constant refactor reaching a client island (Phase 3), a
  layout/disclosure change (Phase 4), the repo's first test-harness module double (Phase 5),
  and doc-sync (Phase 6). Only Phases 2, 5 and 6 are Risk #4. At ~4–6 sessions with a
  one-line-commit convention, six commits will carry `(C10X-28)` while four are about something
  else.
- **Fix A ⭐ Recommended**: Split into three. C10X-28 keeps Phases 2 + 5 + 6 (Risk #4). Phases
  1 + 4 become an auth/disclosure ticket; Phase 3 becomes the Risk #6 ticket.
  - Strength: Phase 1 changes what every user sees when login fails — it deserves its own
    review and its own revert. Phase 3 touches the client bundle. Each ticket's commits then
    match their scope key, which is the convention's whole point.
  - Tradeoff: §3 Phase 2 cannot flip to `complete` until the Risk #6 ticket also lands, so
    Phase 6's doc-sync either waits or splits across tickets. Three change folders to set up.
  - Confidence: MEDIUM — the split is clean on file boundaries (verified: Phases 1–5 touch
    disjoint files), but the doc-sync sequencing is awkward either way.
  - Blind spot: Whether the Jira flow tolerates three tickets for what was scoped as one.
- **Fix B**: Keep as one change, one commit per phase.
  - Strength: §3 Phase 2 flips in a single go; the ordering already guarantees every stopping
    point leaves a closed leak behind it, so an early stop is safe.
  - Tradeoff: One Jira key carries five intents; reverting the auth-copy change drags the
    isolation tests with it.
  - Confidence: HIGH — this is what the plan already does, and it works.
  - Blind spot: None significant.
- **Decision**: Fixed via Fix A — scope split into three tickets, recorded in Implementation Approach

### F4 — Phase 6's blocker is stale, and the branch question was never asked

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 6 §2 blockquote; "Sequencing constraint" note (`plan.md:105-111`)
- **Detail**: C10X-27's implementation has landed — `a018717..bfe53dd`, five commits, epilogue
  closed — so "BLOCKED until C10X-27's implementation lands" is satisfied. But it landed on
  branch `C10X-27-srs-study-session-test`, which is **not merged to `main`**
  (`git merge-base --is-ancestor bfe53dd main` → NO). `main`'s `test-plan.md` is 858 lines;
  this branch's is 1338. The sequencing note solved file contention and never named the branch,
  while the working tree sits on C10X-27's branch with
  `context/changes/ai-candidate-generation-test-2/` untracked. Start Phase 1 here and this
  change's commits land on C10X-27's PR branch; branch off `main` instead and Phase 6
  re-derives against a file 480 lines behind the one the plan describes, then conflicts on
  merge.
- **Fix A ⭐ Recommended**: Merge C10X-27's PR to `main` first, then branch this change from the
  merged `main`.
  - Strength: Phase 6 re-derives against exactly the file that will be in `main`, which is what
    its re-derivation instruction assumes. No conflict.
  - Tradeoff: Blocks the start of Phase 1 on someone else's merge.
  - Confidence: HIGH — measured branch state.
  - Blind spot: C10X-27's PR review turnaround is unknown.
- **Fix B**: Branch from `bfe53dd` now and rebase onto `main` after C10X-27 merges.
  - Strength: Phases 1–5 start immediately against the post-C10X-27 file state.
  - Tradeoff: A rebase over a merge commit with a heavily-rewritten `test-plan.md` underneath is
    exactly the conflict Fix A avoids.
  - Confidence: MEDIUM — depends on whether C10X-27 merges by squash or merge-commit, which was
    not checked.
  - Blind spot: None significant.
- **Decision**: Fixed via Fix A (user's direction) — this change runs SECOND, on its own branch/worktree cut from a `main` containing C10X-27

### F5 — The `console.*` guard leaves the request path half-covered

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §2 "Guard against future log writes"
- **Detail**: The guard scans `src/pages/api/`, `src/lib/`, `src/middleware.ts`. Every `.astro`
  page frontmatter also runs server-side on every request and reaches Workers Logs identically
  — including `src/pages/generate.astro` and `src/pages/study/[publicId].astro`, which handle
  the private data Risk #4 is about. A future `console.log(sourceText)` there is squarely inside
  Risk #4 and invisible to the guard, which would read as coverage.
- **Fix**: Scan all of `src/`. Verified there are currently zero `console.*` occurrences
  anywhere under `src/`, so the wider scan is green on arrival and costs nothing.
- **Decision**: Fixed — guard scans the whole `src/` tree

### F6 — Phase 5's 422 assertions inherit a claim that is false for 422

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §1, "Assert, on one request … For 422, additionally pin"
- **Detail**: The assertion list is written for 502 (where `error_message` carries the upstream
  string, `generate.ts:210,220`) and 422 is described as "the same, additionally". But on the
  422 path `error_message` is a fixed literal — `"Model nie zwrócił poprawnych kart"`
  (`generate.ts:257`) — and the upstream sentinel lands only in `response_payload`. An
  implementer applying the list literally writes an `error_message` sentinel check for 422 that
  cannot pass.
- **Fix**: Spell the 422 assertion set out separately: sentinel in `source_text` +
  `request_payload` + `response_payload`, `error_message` equal to the constant,
  `generated_count > 0`, `saved_count = 0`.
- **Decision**: Fixed — 422 has its own assertion set

### F7 — `seedGenerationSession` has four call sites, not three

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1 "Widen the seed helper"
- **Detail**: The plan lists `:402`, `:407`, `:529`. `:490` ("Metric source") is also a call
  site. Harmless because the new argument is optional, but the count is what a reader checks the
  edit against.
- **Fix**: Add `:490` to the list.
- **Decision**: Fixed — `:490` added
