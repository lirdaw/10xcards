---
change_id: ai-candidate-generation-test-2
title: No source-text or API-key leak on the generation failure path
status: archived
created: 2026-07-26
updated: 2026-07-26
archived_at: 2026-07-26T20:47:00Z
---

## OPEN AFTER THIS CHANGE — read this first

> Five items outlive `status: implemented`. They are listed here, at the top, because each
> one is invisible from the code and from `git log`: the work landed under a **different
> ticket's** branch, so the usual traces point at the wrong place. Whoever picks this up
> next — ship, archive, or a fresh session — owns them. (Item 5 was added by
> `/10x-impl-review` on 2026-07-26; items 1–4 are the change's own, and items 1 and 2 gained
> an impl-review note the same day — **the code they describe moved after they were
> written**, so the Jira comments they ask for must carry the review too, not just the
> change-id.)

1. **C10X-34 (`auth-error-copy`) needs closing in Jira.** Its whole scope — Phase 1's
   `src/lib/auth-errors.ts` mapper + the two auth routes, and Phase 4 §1's banner gate — was
   implemented **here**, on branch `C10X-28-ai-candidate-generation-test-2`, in commits
   `b0ab625` and `34e8837`. Both carry the `(C10X-28)` scope key, so nothing in `git log`
   mentions C10X-34. Close it with a comment pointing at this change-id and at both the
   current path (`context/changes/ai-candidate-generation-test-2/`) and the future archive
   path (`context/archive/<date>-ai-candidate-generation-test-2/`).
   > **The comment must ALSO carry the impl-review, added 2026-07-26 — the code moved after
   > this item was written.** `/10x-impl-review` ran on 2026-07-26 and its triage changed
   > C10X-34's own file: finding **F1** replaced the mapper's bare `MESSAGE_BY_CODE[code]`
   > lookup with `Object.hasOwn`, because a plain object literal resolves `code:
   > "constructor"` up the prototype chain and returned a native function into the `?error=`
   > URL — falsifying the closed-set invariant the whole ticket exists to establish. Four
   > prototype-key inputs were added to `tests/auth/errors.test.ts`; Stryker on the mapper
   > went 93.33% → 93.88%. Finding **F3** annotated roadmap H-03 (item 5 below). So the
   > pointer list is now three: this change-id, the archive path, **and
   > `reviews/impl-review.md`** in the same folder, which is the only record of what was
   > revised after implementation. Without that line a later reader diffs `b0ab625` and sees
   > a mapper that no longer matches it.
   >
   > **✅ THE COMMENT IS POSTED — 2026-07-26, comment id `10351`.** It carries all of the
   > above: both commits and what each shipped, why `git log --grep C10X-34` is empty, the
   > three pointers, F1 in full, and the two closing caveats (the roadmap flip, and that the
   > "already-registered address" manual check is reachable **locally only**). **Do not post a
   > second comment.** This item is now only "transition the ticket" — which still needs a
   > human, together with roadmap H-03 (item 5). Ticket status when the comment went in:
   > `Triaż`, deliberately untouched; nothing was transitioned and no field was edited.
2. **C10X-30 (`server-side-validation-test`) may be annotated but NOT closed.** Phase 3
   (`b520b90`) covered only its **source-text** half — the single-sourced
   `src/lib/generation-limits.ts` plus six refusal cases on `/api/generate`. Its
   **card-content** half (a crafted request breaching `FRONT_MAX`/`BACK_MAX` on
   `POST/PATCH /api/decks/[publicId]/cards*`, asserting a 4xx **and** no write) was
   deliberately excluded and is untouched. Closing C10X-30 on Phase 3 alone would record a
   half-covered risk as covered.
   > **Annotate it with a comment, and include the impl-review — its Phase 3 code moved too
   > (2026-07-26).** Same three pointers as item 1: this change-id, the future archive path,
   > and `reviews/impl-review.md`. Three findings landed in Phase 3's own file
   > (`tests/generation/generate.test.ts`): **F5** made `expectErrorBody` assert the raw 400
   > body echoes back neither the run suffix nor the submitted value — until then the bounds
   > cases proved the status and the absence of a write, but nothing about input echo, which
   > is half of what "the server does not trust the client" means; **F6** corrected a comment
   > that described the client's trim behaviour backwards; **F7** moved the `mark`/`scope`
   > marker helpers into `tests/fixtures/scoping.ts` (they were duplicated with
   > `failure-path.test.ts` — the very drift Phase 3 removed from `SOURCE_MAX`) and made an
   > unsafe case name throw. Whoever picks C10X-30 up for its card-content half should read
   > those before copying the source-text half's shape.
   >
   > **✅ THE COMMENT IS POSTED — 2026-07-26, comment id `10352`.** It carries what Phase 3
   > covered, a 🛑 block on what it does **not** (the card-content half, and that closing on
   > this alone records a half-covered risk as covered), the three pointers, the two traps the
   > phase paid for (the 414, the status-filtered oracle), F5/F6/F7, and the open question
   > about the auth routes' server-side validation that belongs to this ticket. **Do not post
   > a second comment.** Status untouched (`Triaż`) — and it must stay open until the
   > card-content test lands.
   >
   > **✅ RESOLVED — 2026-07-28, C10X-30 shipped its card-content half.** Nothing above is
   > rewritten; the archive records what was known then, and two details in it turned out to be
   > wrong in a way that would have sent the next contributor after something that does not
   > exist. **`POST/PATCH`**: neither card endpoint exports a `PATCH` handler — both are `POST`
   > only. **"asserting a 4xx"**: those two endpoints are native-form targets and refuse with a
   > **`302`** to an owned `?error=` URL — the same status a success returns — so the
   > "**and** no write" half of that sentence is not a supplement to a status assertion, it is
   > the only assertion there is. The rule now lives in `test-plan.md` §6.10; what actually
   > landed is in §6.6's C10X-30 entry.
3. **`test-plan.md` §3 Phase 2 stays `implementing`, and item 2 is the only thing between it
   and `complete`.** The row already names that test. Whoever lands it flips the status and
   dates the claim — do not flip it for any other reason.
   > **✅ RESOLVED — 2026-07-28.** Flipped to `complete` by C10X-30
   > (`server-side-validation-test`), for exactly the reason named above and no other: the
   > card-content test landed (`tests/validation/cards.test.ts`, 12 cases), and the claim is
   > dated in §3, §2's Risk #6 row and §6.6.
4. **A defect class this change proved is live, twice: recorded line ranges and counts rot
   within hours.** The S-05 Stryker range had been mutating the wrong part of a file since a
   commit made two hours after the run; twelve `context/changes/…` evidence links were dead;
   two suite figures said "now" about a state two changes old. If you touch `test-plan.md`,
   re-derive its numbers by reading the code — never trust a figure in it, including the ones
   this change wrote.
5. **`roadmap.md`'s H-03 row is stranded, and `/10x-archive` will NOT repair it** (added by
   impl-review F3). H-03's entire scope shipped here, but its `Change ID` is
   `auth-error-copy` while this change is `ai-candidate-generation-test-2` — and archive
   flips a Status by matching `Change ID` (the note under `## Done`). So the row stays
   `not started` until a human moves it. Two things were already done: the `### H-03` block
   is annotated (its old "lift Faza 1 i Faza 4 §1 verbatim" instruction would have had a
   future implementer rebuild shipped code), and a warning sits under the summary table.
   **Whoever closes C10X-34 flips H-03's Status by hand and dates it — and that is an
   explicit deferral, not an oversight** (owner's decision at the impl-review triage,
   2026-07-26: the row changes when they get to H-03). Do not "tidy" it in passing from an
   unrelated change. This is item 4's
   defect class — a pointer that rots — realised in a second document, which is why
   `test-plan.md` being swept line by line did not catch it.

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

2026-07-26 — **all six phases implemented on this branch; `status: implemented`.** Suite at
completion: **166 passed / 166, 14 files**, lint and build clean, `git diff -- src/` empty
after every deliberate-breakage check. Evidence: `verification.md` (one section per check,
with the observed failure strings, the red/green split and its denominator, and a verified
restore for each).

**The delivered scope is wider than the ticket's framing, per the frame's Reframed Problem
Statement — and the reframe is the finding.** C10X-28 asked for a test of the no-leak
property on the `/api/generate` failure path. That property **already held by construction**
(17 of 18 error returns are fixed Polish literals; the 18th picks between two module-local
literals; `err.message` is routed only to the DB column), was **asserted nowhere**, and
**could not be asserted at all** with the harness as it stood — three independent clamps seal
the 502/422 branches. So the change pinned the property behind the project's first module
double (`astro:env/server` only, never `@/lib/openrouter`, which would make the
`Authorization` half unassertable), and closed the two surfaces where private data genuinely
did escape and which the ticket never names: the auth routes' verbatim relay of an upstream
message into a URL, and `generation_session`'s four private audit columns, which had no
cross-account test whatsoever. Risk #6's source-text half came along with it, plus a
whole-`src/` `console.*` guard and the OpenRouter banner gate.

What is deliberately **not** claimed: no test reads a real log sink (the log half is a
first-party source-tree guard); dependency-emitted lines are inside Risk #4 and unowned; the
client-bundle half is closed by construction and recorded rather than re-tested; and Risk
#6's card-content half is untested, which is why `test-plan.md` §3 Phase 2 stays
`implementing` with that one test named as what flips it.

**Two follow-ups for whoever merges this.** C10X-34 and C10X-30 had their work done under
this branch and under `(C10X-28)` commit scopes, so they need closing or annotating in Jira —
with C10X-30 closed only **partly** (its card-content half is untouched). And this plan plus
Jira are the only trace of that attribution, since the scope key no longer carries it.

2026-07-26 — split carried into Jira and `jira-map.md`. Only **one** of the two sibling tickets
was new: **C10X-34** (`auth-error-copy`, Epic C10X-10, component `infra`, MVP, Medium, Triaż) for
Phase 1 + Phase 4 §1. Phase 3 went to **C10X-30** (`server-side-validation-test`), which
**already existed** as the Risk #6 ticket — creating another would have been a duplicate. Note
Phase 3 closes C10X-30 only partly: that ticket spans the source-text limit (S-04) *and* the
card-content rules (S-02), and this plan deliberately excludes the card endpoints. `plan.md`,
`plan-brief.md` and `jira-map.md` now name the keys; `plan-brief.md` is back in sync with the
plan after the F1–F7 fixes.

> **Narrowed 2026-07-26 by impl-review F4.** That in-sync claim was true of the plan-review's
> F1–F7 edits and stopped being true the moment the split was downgraded to bookkeeping: the
> brief still carried **"Do not implement Phases 1, 3 or Phase 4 §1 from this folder"**, the
> exact sentence `plan.md` revoked, plus an effort estimate splitting the work across three
> tickets. It matters beyond hygiene — `/jira-sync-work` pushes this brief into the ticket's
> rich-text fields, so a revoked instruction was on its way to Jira, which is the one place
> C10X-34's and C10X-30's attribution actually lives now that the commit scope key does not
> carry it. Both spots corrected in the brief.
