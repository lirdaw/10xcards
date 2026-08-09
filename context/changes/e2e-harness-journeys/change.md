---
change_id: e2e-harness-journeys
title: E2E harness journeys
status: plan_reviewed
created: 2026-08-08
updated: 2026-08-08
archived_at: null
---

## Notes

Two decisions taken 2026-08-08, after `/10x-research` and before planning. Both close an
Open Question in `research.md` (Q1 and Q6); they are recorded here rather than left in a
session, because a decision that lives only in a conversation does not survive `/clear`.

### D-01 — The setup project uses ONE stable, dedicated e2e account, plus a real teardown

**Decided: a stable dedicated e2e account. NOT per-run accounts.**

The reasoning is the axis most likely to be re-argued, so it is written down rather than
implied. The harness's current shape issues **zero auth requests per run** — both specs enter
on `storageState` and never sign in — so the 30-sign-ins / 5-min / IP limit
(`supabase/config.toml:190`) is not exposed at all. `test-plan.md` §3 Phase 6 records exactly
this as harness risk 6 "LIVE, and INVERTED on the rate-limit axis". **Per-run accounts would
re-introduce that exposure** and add provisioning complexity to what is a local, human-triggered
instrument — never a gate (§5). One sign-in per run in a setup project keeps the cheap side of
that inversion.

**The accumulation problem is solved by teardown, not by per-run accounts.** It is real and
measured (2026-08-08): 487 users of which 484 are `harness-*`, **5459 decks** against
`max_rows = 1000`, and one orphaned `E2E deck 1785947414992` from 2026-08-05 — i.e.
`seed.spec.ts`'s inline cleanup has already failed once in practice. Per-run accounts would make
that worse, not better: they add a user per run on top of the rows.

Binding constraints on the teardown:

- It runs as `test.afterEach` / `test.afterAll`, or as a dedicated **teardown project** —
  **never inline in the test body**. Inline cleanup is precisely what failed: any failure earlier
  in the spec skips it and orphans the row permanently.
- It is **RLS-aware**: the teardown client signs in as **the same e2e account** that owns the
  rows. Never a service/secret key — RLS is the only lock in this app, and
  `tests/setup/preflight.ts` refuses a non-anon key for that reason.
- Unique `Date.now()` suffixes in test data **stay** — they are what makes re-runs and parallel
  workers non-colliding, and what lets a teardown scope itself to the run that created the rows.

Consequence to carry into the plan: the stable account shares state across runs, so no spec may
assume an empty starting deck list. That is the accepted price of the decision, not an oversight.

### D-02 — The branch is a PREREQUISITE of this change, not a step inside it

**Decided: record it, do not resolve it in code.**

`HEAD` sits on `docs-test-plan-refresh-2026-08-05` — the previous, already-archived change's
branch — and is on no remote. That refresh is code-complete but unpushed.

**Before the first `/10x-implement` of this phase:**

1. Close the refresh — ship to `main`, then `/10x-archive`.
2. Branch this change off a **clean `main`**.

Git is handled by the `/ship` bookend, **outside this plan**. So the plan must not contain
branch, merge, or archive steps for the predecessor; it may only state the prerequisite. Two
things this touches that are genuinely this change's, and are not git work: the predecessor
archives with **no roadmap row** (`H-12` is still free and still uncreated), and `C10X-45` is
spent on the refresh, so this phase's Jira key is **C10X-46**.
