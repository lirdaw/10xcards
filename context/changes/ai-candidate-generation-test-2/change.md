---
change_id: ai-candidate-generation-test-2
title: No source-text or API-key leak on the generation failure path
status: implementing
created: 2026-07-26
updated: 2026-07-26
archived_at: null
---

## Notes

Prove Risk #4 from test-plan.md §2: neither the error response body nor any log line leaks the pasted source text or the LLM API key. Scope: integration tests on the /api/generate failure path (FR-018), i.e. test-plan §3 Phase 2 "Endpoint contract", alongside risks #2 and #6. Acceptance: assertions are on payload and log CONTENT, never on the status code — the assumption to challenge is "a 500 is harmless"; cover both what is returned to the client and what is written to logs. Prereq: /10x-research pins the oracle and the cheapest layer before any test is written. (source: C10X-28)

2026-07-26 — research landed (`research.md`) and `plan.md` + `plan-brief.md` were revised against
it. The prereq is discharged. Headline: Phase 5's seam changed (double `astro:env/server`, not
`@/lib/openrouter` — the latter makes the `Authorization` claim unassertable), demonstrated by an
executed spike with a deliberate-breakage check; 422 became reachable and is now in scope; Risk
#6's surface is four duplicated constants, not one; and the "no write" oracle needed widening
because it filtered `status = 'succeeded'`. Still open for `/10x-plan-review`: whether this change
is one change or three, and whether the auth routes' total lack of server-side validation is in
scope.

2026-07-26 — **sequencing constraint, user's direction: C10X-27 has priority.** This change does
not touch `context/foundation/test-plan.md`, `context/foundation/roadmap.md` or anything under
`context/changes/srs-study-session-test/` until C10X-27's implementation lands. `test-plan.md`
grew ~300 lines mid-research and C10X-27 independently closed three of the four false statements
this change's research had found. Phases 1–5 touch disjoint files and are unblocked; **Phase 6 is
blocked** and must re-derive its doc-sync list against the post-C10X-27 file. Nothing outside this
change folder has been modified.

2026-07-26 — plan-review done (`reviews/plan-review.md`), verdict REVISE → SOUND; all 7 findings
fixed in `plan.md`. Two answers to questions this file left open. **Scope: three tickets, not
one** (F3) — C10X-28 keeps Phases 2, 5, 6 (Risk #4) plus Phase 4's `console.*` guard; Phase 1 and
Phase 4's banner gate move to an auth-copy/disclosure ticket; Phase 3 to a Risk #6 bounds-parity
ticket. Consequence: §3 Phase 2 stays `implementing` here with #6 named outstanding — whichever
ticket lands second flips it. **The auth routes' lack of server-side validation is NOT in scope
here** — it never entered any phase.
> **Corrected 2026-07-26, later the same day.** This line first said the split made it "the auth
> ticket's question". Wrong owner: no server-side validation on `signin.ts`/`signup.ts` is
> literally "the server trusts the client", i.e. **Risk #6**, so the question belongs to
> **C10X-30**, not C10X-34 — even though C10X-34 rewrites those two files and is therefore the
> cheapest place to *execute* it. Recorded on C10X-30 as a comment.

Substantive fixes: Phase 3's "no write" oracle could not run at all (a
`.eq("source_text", …)` on a 10 000-char body answers `414 URI too long` — measured against the
local stack), and Phase 1's mapper chain depended on `@supabase/auth-js`, which is not a declared
dependency. **Sequencing (F4, user's direction): this change runs SECOND**, after C10X-27 merges,
on its own branch/worktree cut from a `main` that already contains it.

2026-07-26 — split carried into Jira and `jira-map.md`. Only **one** of the two sibling tickets
was new: **C10X-34** (`auth-error-copy`, Epic C10X-10, component `infra`, MVP, Medium, Triaż) for
Phase 1 + Phase 4 §1. Phase 3 went to **C10X-30** (`server-side-validation-test`), which
**already existed** as the Risk #6 ticket — creating another would have been a duplicate. Note
Phase 3 closes C10X-30 only partly: that ticket spans the source-text limit (S-04) *and* the
card-content rules (S-02), and this plan deliberately excludes the card endpoints. `plan.md`,
`plan-brief.md` and `jira-map.md` now name the keys; `plan-brief.md` is back in sync with the
plan after the F1–F7 fixes.
