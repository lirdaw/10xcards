# Remove the public /api/shipprobe error probe — Implementation Plan

## Overview

Delete `src/pages/api/shipprobe.ts` from the repo and from production, and move the regression class
it was implicitly guarding out of a production endpoint and into a unit test over the Sentry sampling
discriminator.

The probe is a public, unauthenticated route that throws on every request. It was shipped deliberately
during C10X-53 so the prod-sanity step of the Sentry runbook could be repeated on demand, and it was
always owned by roadmap **H-15** as temporary. Its removal is gated by a decision, not by code: whether
prod sanity for Sentry is closed. That decision was taken on 2026-08-12 — it is closed.

## Current State Analysis

**The code is inert and isolated.** `src/pages/api/shipprobe.ts` is 3 lines of body (`export const GET`
throwing) under 23 lines of comment. It has **zero importers**, is referenced by **no test**, appears in
**no build or deploy config**, and is not in `PROTECTED_ROUTES`. Astro routes it by filesystem
convention alone. There is no catch-all route and no `404.astro`, so once the file is gone the path
falls through to Astro's default 404.

**Nothing automated goes red when it is deleted.** Verified rather than assumed:

- `npm run typecheck` asserts a **floor of 50** (`MIN_CHECKED_FILES` in `scripts/typecheck.ts`) against
  a checked-file total far above it. The floor is deliberately not an equality, precisely so a file
  count can move — which is also why no figure for that total is quoted here: `test-plan.md` has
  already recorded the same number going stale at 130, 133, 135 and 145, and a count pinned in prose
  re-rots by construction.
- Six guard tests walk the tree. The tightest is `tests/lib/error-param-guard.test.ts:257`
  (`>= 69` against a measured 71 → 70 after this deletion). All stay green.
- The name pins that WOULD go red (`no-logging.test.ts:76-78`, `no-env-access.test.ts:80-87`,
  `form-endpoint-guards.test.ts:153-160`) name other files. `shipprobe.ts` is in none of them.

**The whole cost is documentary.** 11 present-tense claims across 3 live files (`roadmap.md` ×8,
this change's own `change.md` ×2, the gitignored `jira-map.md` ×1) plus 7 in the archived
`context/archive/2026-08-11-sentry-monitoring/deploy-runbook.md`, where §5's opening instruction —
"do the cheap one first: `GET /api/shipprobe`" — loses its subject.

**And there is a gap the ticket does not name.** Sentry sees two classes of event, separated by
`beforeSend` in `src/worker.ts`: first-party errors pass **unsampled at 100 %**, recognised
dependency noise is thinned to **~10 %**. That discriminator has **zero test coverage** at any layer
(grepped: the only Sentry mentions under `tests/` are the e2e preflight blanking the DSN). This is not
a hypothetical exposure — the first version of that code sampled on the `logger === "console"` stamp and
thereby dropped ~90 % of real application errors **silently**, which was caught only by measurement
during the C10X-53 ship (21 deliberate errors → 3 events) and fixed in `d381c07`. Until now the probe
was the only instrument that would have surfaced a recurrence; the dependency provocation would read
green while first-party errors vanished.

### Key Discoveries:

- `src/pages/api/shipprobe.ts:26-28` — the entire behaviour: `export const GET: APIRoute = () => { throw … }`.
- `src/worker.ts` — `DEPENDENCY_NOISE`, `DEPENDENCY_EVENT_SAMPLE_RATE` (`0.1`) and `beforeSend`: the
  decision to extract, plus the comment block above them. **Named by symbol, not by line** — the same
  `lessons.md:236` rule this plan applies to its doc-sync targets applies to its own code anchors, and
  an earlier draft's numbers were already ~10 lines stale against `440bd14`. The patterns carry no `g`
  flag, so `.test()` is stateless.
- `src/middleware.ts` imports `@/lib/supabase` and is bundled into the same SSR output, which is the
  evidence that the `@/*` alias resolves in the Worker build — `astro.config.mjs` declares no aliases,
  they come from `tsconfig.json` and Vite picks them up.
- `AGENTS.md` — `src/worker.ts` may read the Cloudflare `env`; **no other module under `src/` may**.
  The extracted function must therefore take everything it needs as arguments.
- `lessons.md:117` — prod sanity must prove the thing WORKS, not that it deployed.
- `lessons.md:180` — `/10x-archive` owns the roadmap `Status → done` flip. This plan must not emit it.
- `lessons.md:236` — a dated snapshot takes a dated correction, never a rewrite; name doc-sync targets
  by section and claim, never by line number.
- `deploy-runbook.md` P5 — the prod hostname. **Only the account subdomain is genuinely unrecorded**:
  `wrangler.jsonc` carries `"name": "10xcards"` and `"workers_dev": true`, so the shape is
  `10xcards.<account-subdomain>.workers.dev`. Confirm the full host against the last successful
  `deploy` job's wrangler output or the Cloudflare dashboard — do not derive it and skip the
  confirmation, because Phase 4's pair is void the moment the two readings name different hosts.

## Desired End State

`GET /api/shipprobe` returns **404** on production where it returned **500** before this change, and the
route exists in neither the repo nor the deployed Worker. The sampling discriminator behaves exactly as
it does today, now expressed as a pure function with a test that fails if a first-party error ever
becomes sampled again. Every live document that described the probe in the present tense describes
reality, and the archived runbook tells its next reader that §5's cheap path is gone without falsifying
what was true on its own date.

## What We're NOT Doing

- **No guarded replacement endpoint.** Keeping a permanent secret-header or `PROTECTED_ROUTES`-gated
  probe was considered and declined (see Key Decisions in `plan-brief.md`). It is a separate design
  decision, exactly as roadmap H-15's Unknowns and the ticket both state.
- **No re-proof that Sentry is still alive after the deploy.** Removing a route cannot break the
  wrapper, so a dependency-provocation series here would test something this change does not touch.
- **No change to sampling BEHAVIOUR.** The extraction is semantics-preserving; the rate stays `0.1`
  and `DEPENDENCY_NOISE` keeps both its patterns. Re-tuning on measured volume remains future work.
- **No roadmap `Status → done` flip and no `## Done` entry** — `/10x-archive` owns both.
- **No `jira-map.md` edit.** That file is owned by the jira-\* skills and is gitignored.
- **No full `test-plan.md` §6.6/§8 ledger entry.** Only §7's dependency-log exclusion takes a dated
  correction. No §2 risk row moves and no coverage claim widens.
- **No client-side Sentry, no source maps, no alert-rule work.** Unchanged boundaries from C10X-53.
- **No local `npx wrangler deploy`.** This Worker has exactly one deploy pipeline (`deploy` job on
  push to `main`).

## Implementation Approach

Four phases, each independently verifiable. The deletion goes first because it is the ticket's actual
goal and is self-contained; the extraction follows as the compensating guard; documentation follows the
code; production sanity closes it.

One ordering constraint dominates everything and is the reason Phase 1 opens the way it does.

## Critical Implementation Details

**Timing & lifecycle — the production "before" reading is unrecoverable.** The chosen oracle is a pair:
the same `curl` must return `500` before the change reaches production and `404` after. Once the merge
deploys, the `500` reading can never be taken again, and a lone `404` is indistinguishable from a typo'd
URL, a wrong host, or a stale Worker — three failures this project has hit before. **Take the reading
before the PR merges.** It is the first item of Phase 1 for that reason alone; it does not otherwise
block the local deletion.

**The extracted module must not read the Worker env.** `AGENTS.md` grants `src/worker.ts` the sole
carve-out inside `src/` for reading the Cloudflare `env`, and `tests/lib/no-env-access.test.ts` scans the
whole tree. `src/lib/sentry-sampling.ts` is a pure function over its arguments — no `env`, no
`process.env`, no `import.meta.env`, no `console.*` (`tests/lib/no-logging.test.ts` scans for that too).
`src/worker.ts` keeps its `WorkerEnv` interface, its `dsn: env.SENTRY_DSN` read, and its import of
`@astrojs/cloudflare/entrypoints/server` untouched — the file's shape is the constraint, not its size.

**The randomness must become a parameter.** `Math.random()` inside the decision makes the decision
untestable; the project's established fix is to pass the value in, exactly as `rateCard` takes `now`
(`test-plan.md` §6.7) and `visibleConfigStatuses` takes its entries (§6.1). `src/worker.ts`'s
`beforeSend` becomes the one line that supplies `Math.random()`.

---

## Phase 1: Capture the production baseline, then delete the probe

### Overview

Take the unrepeatable `500` reading from production, then remove the route from the repo.

### Changes Required:

#### 1. Production baseline reading (no file changes)

**Intent**: Record what `GET /api/shipprobe` returns on production **as it stands today**, so the
post-deploy `404` becomes evidence rather than an assertion that passes vacuously.

**Contract**: One request against the prod host, status code recorded verbatim into
`verification.md` together with the host used and the timestamp. Expected `500`. The host is not in this
repo — take it from the last successful `deploy` job's wrangler output or the Cloudflare dashboard
(runbook P5). If the reading is anything other than `500`, stop and reconcile before deleting: it means
the deployed Worker is not the one this repo describes, and the whole oracle is void.

#### 2. The probe route

**File**: `src/pages/api/shipprobe.ts`

**Intent**: Delete the file. It is the entire deliverable of the ticket.

**Contract**: `git rm`. No other file changes — the route has no importers, no test, no config entry
and no `PROTECTED_ROUTES` membership. `dist/` carries a compiled copy but is gitignored and regenerated
by the build, so it needs no edit; note that a **stale `dist/` deploy would still serve the route**,
which is why Phase 4's oracle is against production and not against a local build.

#### 3. Local confirmation of the "after" shape (no file changes)

**Intent**: Observe, once, before the irreversible merge, that this app actually answers `404` for a
deleted `/api/*` route. Phase 4's entire oracle is that status, and nothing in this project has ever
produced it: there is no `404.astro` and no catch-all, and `wrangler.jsonc` declares
`assets.not_found_handling: "404-page"` over `./dist`, so the response comes from a path nobody here
has exercised. The plan reasons its way to `404`; this makes it a measurement for the cost of one
request.

**Contract**: After the `git rm`, start the dev server and request `/api/shipprobe`; expect `404`.
Recorded in `verification.md` as a **pre-check and explicitly NOT half of the production pair** — a
local `404` says nothing about the deployed Worker, which is the whole reason the pair is against
prod. If it is anything other than `404`, stop and reconcile before opening the PR: the plan's
assumption about the fall-through is wrong and Phase 4's oracle needs rewriting, not re-running.
Note the boundary while you are here: `npm run dev` does not execute `src/worker.ts` at all (roadmap
H-14's correction), so this observes ROUTING only and nothing about Sentry — which is all this
criterion needs.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `npm run typecheck` (expect the reported file count to drop by exactly 1, staying far above the floor of 50)
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Full suite passes with no new failures: `npm test`
- The route is gone from the tree: `git ls-files src/pages/api/shipprobe.ts` returns nothing

#### Manual Verification:

- The production baseline reading was taken BEFORE any merge, returned `500`, and is recorded in `verification.md` with the host and timestamp
- The local post-deletion pre-check returned `404` against the dev server, recorded as a pre-check and NOT as half of the production pair

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 2: Extract the sampling discriminator and put it under test

### Overview

Move the first-party-vs-dependency decision out of the `withSentry` config object into a pure,
testable function, and pin the property whose silent loss this project has already paid for once.

### Changes Required:

#### 1. The sampling decision

**File**: `src/lib/sentry-sampling.ts` (new)

**Intent**: Host the decision that `src/worker.ts`'s `beforeSend` currently makes inline, plus the two
constants it reads, so it can be exercised without a Worker, a DSN, or a network. The extensive
comment block above `DEPENDENCY_NOISE` explaining _why_ the discriminator is the noise's signature rather than its
transport stamp move here with the code they explain — they document this decision, and a decision's
rationale belongs beside it.

**Contract**: One exported function plus the two constants it uses. The function is total, pure, and
free of randomness: it takes the event and the already-drawn sample roll, and returns the event to send
or `null` to drop. Semantics must be preserved exactly as they are today — the non-`console` early
return, the haystack built from the message plus every `exception.values` entry's `type` and `value`,
the fail-open when nothing matches, and the strict `<` comparison against the rate. Type the event
parameter against the SDK's own event type (`import type` from `@sentry/cloudflare`) so the contract
cannot silently drift from what Sentry actually passes.

#### 2. The Worker wrapper

**File**: `src/worker.ts`

**Intent**: Delegate `beforeSend` to the extracted function, supplying the randomness that the pure
function refuses to own. Everything that makes this file the Worker entry stays exactly as it is.

**Contract**: `beforeSend` becomes a single delegation passing the event and `Math.random()`. The
`DEPENDENCY_NOISE` / `DEPENDENCY_EVENT_SAMPLE_RATE` declarations leave this file (they move to the new
module). The `WorkerEnv` interface, `dsn: env.SENTRY_DSN`, both `integrations` entries and the
`@astrojs/cloudflare/entrypoints/server` import are untouched. Import the new module through the `@/*`
alias per AGENTS.md's first hard rule.

**Risk and its fallback, stated because it is the one unproven step in this plan**: the `@/*` alias is
known to resolve for `src/middleware.ts` in the same SSR bundle, but `src/worker.ts` is `wrangler.jsonc`'s
`main` and was never observed importing a first-party module. `npm run build` is the check. If it fails
to resolve, fall back to `./lib/sentry-sampling` — a sibling-directory import, which is not the
`../../lib` shape AGENTS.md forbids — and record the fallback and its reason at the import site.

#### 3. The discriminator's test

**File**: `tests/lib/sentry-sampling.test.ts` (new)

**Intent**: Make it impossible for a first-party error to become sampled again without something going
red. This is the whole compensating value of deleting the probe.

**Contract**: Cases over fabricated events driving the **real** imported function, so the real
`DEPENDENCY_NOISE` array is what decides — the `tests/middleware.test.ts` idiom of driving the real
`PROTECTED_ROUTES` rather than a copy. The set must cover, at minimum:

- a first-party error stamped `logger: "console"` at a roll of `0.99` → **sent** (the regression assertion; this is the case `d381c07` fixed)
- the same via `exception.values` rather than `message` → sent
- recognised dependency noise at a roll of `0.5` → **dropped** (the positive control, without which "always return the event" satisfies every assertion above and reads as perfect protection)
- recognised dependency noise at a roll of `0.05` → sent (the survivor)
- dependency noise carried in `exception.values` rather than `message` → dropped
- an event whose `logger` is not `"console"` but whose message DOES match a noise pattern → sent untouched (both halves of the discriminator are required, and `src/worker.ts`'s own comment says so)
- the second `DEPENDENCY_NOISE` member exercised on its own, so deleting either pattern turns a case red
- the rate boundary: a roll exactly equal to the rate → dropped (the comparison is strict `<`)
- an event with no message and no exception → sent (fail-open)

#### 4. The wiring guard

**File**: `tests/lib/sentry-wiring.test.ts` (new)

**Intent**: Make the extraction's own seam falsifiable. §3's test proves the DECISION is right; it
stays fully green if `src/worker.ts` stops calling it, drops `beforeSend`, or re-inlines a copy of the
logic — and **no layer in this project loads `src/worker.ts`** (verified: the only Sentry mentions
under `tests/` are the e2e preflight blanking the DSN). Deleting the probe removes the last
end-to-end instrument for that property, so without this file the Desired End State's promise —
"a test that fails if a first-party error ever becomes sampled again" — is satisfied by a suite that
would stay green through an unwiring. This is the same "helper covered, wiring uncovered" split this
project has already closed twice: `tests/lib/error-param-guard.test.ts` (C10X-34's impl-review F2,
written because "a regression deleting the `ownedAuthMessage(...)` call leaves the suite green") and
`tests/lib/no-client-redirect-errors.test.ts` (C10X-40). The extraction copies those precedents; the
guard is their other half.

**Contract**: A textual guard in the species this folder already carries three times
(`error-param-guard.test.ts`, `no-client-redirect-errors.test.ts`, `no-logging.test.ts`) — read
`src/worker.ts` and assert, per line, that the line supplying `beforeSend` is the same line that calls
the imported function. Co-presence of the import is NOT sufficient, for `error-param-guard.test.ts`'s
recorded reason: a file that imports the helper and then re-implements the decision two lines down is
the exact defect wearing the costume of a fix. Three claims:

- the shipped delegation is accepted (the file is read from disk, so this cannot pass while the file is missing or renamed)
- **the positive control**: the detector fires on the pre-extraction shape — a `beforeSend` body containing `DEPENDENCY_NOISE`/`Math.random()` inline — without which a pattern matching nothing reads as perfect protection
- the import of `@/lib/sentry-sampling` is present, so the delegation cannot resolve to something else

State the boundary at the site, as its siblings do: this proves the call is **present and composed**,
never that Sentry actually invokes `beforeSend`. And record the accepted trade — splitting the
delegation across lines trips this guard even when the wiring is correct; keep it on one line or widen
the pattern deliberately with a recorded reason.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Build passes and the `@/*` import resolves in the Worker entry: `npm run build`
- The new test passes: `npx vitest run tests/lib/sentry-sampling.test.ts`
- The wiring guard passes: `npx vitest run tests/lib/sentry-wiring.test.ts`
- Full suite passes: `npm test`
- The env guard still passes over the new module: `npx vitest run tests/lib/no-env-access.test.ts`
- The logging guard still passes over the new module: `npx vitest run tests/lib/no-logging.test.ts`

#### Manual Verification:

- Deliberate-breakage run, recorded in `verification.md` with its observed failure string and its red/green split: restore the pre-`d381c07` discriminator (sample on the `logger === "console"` stamp alone, dropping the `DEPENDENCY_NOISE` signature test) and confirm the first-party cases go red while the dependency cases stay green — then restore and confirm the restore by hash
- Second deliberate-breakage run, same recording discipline: re-inline the decision in `src/worker.ts`'s `beforeSend` (leaving the import in place, so co-presence cannot satisfy the guard) and confirm `tests/lib/sentry-wiring.test.ts` goes red naming the file, **while `sentry-sampling.test.ts` stays fully green** — that green is the evidence, since it is what proves the two files observe different claims
- `git diff src/worker.ts` shows the `WorkerEnv` interface, the `dsn` read, both integrations and the adapter import unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 3: Doc-sync

### Overview

Bring every present-tense claim about the probe into line with reality, and tell the archived runbook's
next reader that its cheapest path is gone — without rewriting what was true on its own date.

### Changes Required:

#### 1. Roadmap — the live H-15 entry

**File**: `context/foundation/roadmap.md`

**Intent**: Update the H-15 block's **Outcome** to describe what actually shipped, including the
discriminator test that the original Outcome did not anticipate, and record the **Unknowns** decision so
nobody rediscovers and re-implements it.

**Contract**: Outcome and Unknowns only. The Unknowns entry becomes a dated decision — plain deletion
chosen, guarded replacement declined, with the reason (the regression class it would have guarded is now
closed by a test at a cheaper layer). **`Status` stays `not started` and no `## Done` entry is written**
— `lessons.md:180` reserves both for `/10x-archive`, and a plan that instructs the flip is to be treated
as a defect.

#### 2. Roadmap — the H-14 historical tail

**File**: `context/foundation/roadmap.md`

**Intent**: Close the loop where a reader starts it. H-14's retrospective sentence names the public
route as deliberate debt "whose removal H-15 leads".

**Contract**: A dated note appended beneath the H-14 block, not an edit inside it — that block's
`Status` is `done`, making it a historical record. The original sentence stays: it remains true, H-15
did lead the removal.

#### 3. The Worker's own comment

**File**: `src/worker.ts`

**Intent**: Tell the next person who edits the sampling that the production instrument for provoking a
first-party error no longer exists, and that a test now holds the property instead.

**Contract**: A short dated addition to the comment block above the delegation. It must not restate the
measurement narrative that moved to `src/lib/sentry-sampling.ts` — it points there.

#### 4. The archived deploy runbook

**File**: `context/archive/2026-08-11-sentry-monitoring/deploy-runbook.md`

**Intent**: Keep §5 a runnable procedure instead of an instruction that sends its reader to a 404 and
lets them read the silence as broken monitoring — the exact misreading that runbook spends three
paragraphs guarding against.

**Contract**: Two dated correction blocks, appended, never rewriting the surrounding steps. Under **§5**:
the `GET /api/shipprobe` opening was removed by C10X-54 on 2026-08-12; what remains is the dependency
provocation — a series of 20, with the event counter as the oracle — and the one-request first-party
proof no longer exists. Under **§6**: the "decide when `/api/shipprobe` goes away" item is resolved, and
by which change. Formatting is manual: `.prettierignore` carries `context/archive/**`, so `npm run format`
will not touch this file.

#### 5. Test-plan — the dependency-log exclusion

**File**: `context/foundation/test-plan.md`

**Intent**: §7's "Log lines emitted by dependencies" exclusion currently implies the whole dependency-noise
area is untested. After this change the noise itself is still untested, but the DECISION that separates it
from first-party output is.

**Contract**: One dated correction appended to that exclusion, scoped precisely to what changed. No §2
risk row moves, no coverage claim widens, no §6.6 entry and no §8 ledger row — the suite total is
deliberately not restated here, because this change did not measure it as a claim.

#### 6. This change's own identity file

**File**: `context/changes/remove-sentry-probe/change.md`

**Contract**: `updated: 2026-08-12`. Leave `status` alone — it reads `plan_reviewed` as of
2026-08-12 (set by `/10x-plan-review`), and writing `planned` here would walk it backwards; the
implement/ship skills own the forward moves from there.

### Success Criteria:

#### Automated Verification:

- Formatting is clean for the live docs: `npx prettier --check context/foundation/roadmap.md context/foundation/test-plan.md`
- The archive is untouched by the formatter, proved as a **pair** run AFTER the corrections are appended — because prettier reports an ignored file and a clean file identically (`prettier --check` prints `All matched files use Prettier code style!` and exits 0 either way, which is `test-plan.md` §6.6's recorded C10X-43 trap): `npx prettier --list-different context/archive/2026-08-11-sentry-monitoring/deploy-runbook.md` prints nothing, while `npx prettier --ignore-path /dev/null --list-different context/archive/2026-08-11-sentry-monitoring/deploy-runbook.md` prints the file. The second half is what proves the **ignore** silenced the first, rather than the file happening to be clean. (`--check` and `--list-different` cannot be combined.)
- Type gate and lint still pass after the `src/worker.ts` comment edit: `npm run typecheck` and `npm run lint`
- No live document still claims the probe exists: a repo-wide search for `shipprobe` outside `context/archive/` and `dist/` returns only this change's own folder, the resolved roadmap entries, and `context/foundation/jira-map.md` — which is excluded **by decision, not by oversight**: it is owned by the jira-\* skills and gitignored (see What We're NOT Doing), and the ticket's own record is brought up to date by `/jira-finish-work`

#### Manual Verification:

- Each edited roadmap and test-plan target was chosen by reading its SECTION HEADER and preamble, not by line number, and every dated-snapshot target received an appended correction rather than an overwrite (`lessons.md:236`)
- Roadmap H-15 `Status` is still `not started` and no `## Done` entry was added
- The archived runbook renders correctly after the manual formatting

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 4: Ship and prove it on production

### Overview

Close the pair opened in Phase 1. The mechanics of branching, PR, merge and deploy belong to `/ship`;
what this phase owns is the oracle.

### Changes Required:

#### 1. Deploy through the normal pipeline (no file changes)

**Intent**: Reach production the only way this Worker can be reached.

**Contract**: PR to `main`; the `deploy` job ships after `ci` and `drift` pass. **No local
`npx wrangler deploy`.** This change carries no migration, so `drift` has nothing new to compare.
Confirm the `deploy` job's `conclusion` is `success` and not `skipped` before reading the oracle — a
`skipped` deploy means nothing shipped and the `404` would be measuring the wrong Worker.

#### 2. Production sanity (no file changes)

**Intent**: Prove the route is actually gone from the deployed Worker, not merely from the repo.

**Contract**: The **same** `curl` against the **same** host as Phase 1, now expecting `404`. Record
status, host and timestamp beside the Phase 1 reading so the pair reads as one measurement. `500` means
the old Worker is still live (re-check the deploy job); anything else means the host or path differs
from Phase 1 and the pair is void.

**Contingency, stated because a "void pair" is not an action.** The change is a pure deletion carrying
no migration and no data effect, so the rollback is `git revert` of the merge commit plus the deploy
that follows it — no repair step, nothing to un-migrate. Take it if the reading is neither `500` nor
`404` and the cause is not immediately a wrong host: an unexplained third status means the deployed
Worker is not what this repo describes, which is the same condition Phase 1 refuses to proceed past,
and it should not be left standing on production while it is investigated.

### Success Criteria:

#### Automated Verification:

- The `deploy` job's conclusion is `success`: `gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'`

#### Manual Verification:

- `GET /api/shipprobe` on the production host returns `404`, against the `500` recorded in Phase 1, with both readings in `verification.md` naming the same host
- No new Sentry event was produced by that request (a 404 is not an exception, so nothing should arrive) — a spot check, not a gate

---

## Testing Strategy

### Unit Tests:

- `tests/lib/sentry-sampling.test.ts` — the discriminator's full truth table, fabricated events against the real patterns. The load-bearing case is "first-party error at a roll of 0.99 is still sent"; the load-bearing control is "recognised dependency noise at 0.5 is dropped", without which a function that returns its input unconditionally passes everything else.
- `tests/lib/sentry-wiring.test.ts` — the seam the file above cannot see. The two are one claim split in half and neither substitutes for the other: the truth table proves the decision is right, the guard proves `src/worker.ts` still makes it. Read them together, and read neither as evidence that Sentry invokes `beforeSend` at all — nothing in this project can assert that after the probe is gone.

### Integration Tests:

- None. The deletion has no integration surface, and the sampling function never touches the database, the network or a Worker.

### Manual Testing Steps:

1. Before merging: `curl` the prod probe path, confirm `500`, record host + timestamp.
2. After the `git rm`, before the PR: request the same path on the dev server, confirm `404`. A pre-check, not half of the pair.
3. Run the deliberate-breakage check on the discriminator (pre-`d381c07` shape), confirm the split, restore, verify the restore by hash.
4. Run the second breakage check: re-inline the decision in `beforeSend`, confirm the wiring guard goes red while the sampling test stays green, restore, verify by hash.
5. After the deploy job reports `success`: `curl` the same path on the same host, confirm `404`.

## Performance Considerations

None. The extraction adds one function call per captured event on a path that already runs per event,
and removes a route from the manifest.

## Migration Notes

No database migration; `drift` has nothing to compare. The one deployment subtlety is that `dist/` is
gitignored and regenerated — the route disappears from production only after a rebuild and redeploy,
which is why the oracle is against the prod host rather than a local build.

## References

- Ticket: C10X-54 · Roadmap: `context/foundation/roadmap.md` § H-15
- The probe's own rationale and its stated cost: `src/pages/api/shipprobe.ts:3-25`
- The measurement that produced the current discriminator: the comment block above `DEPENDENCY_NOISE` in `src/worker.ts`, and
  `context/archive/2026-08-11-sentry-monitoring/deploy-runbook.md` § "What this buys, and what it does not"
- Prod-sanity procedure and P5 (the unrecorded prod hostname):
  `context/archive/2026-08-11-sentry-monitoring/deploy-runbook.md` §5
- Extraction-for-testability precedent: `test-plan.md` §6.1 (`visibleConfigStatuses`), §7 (`readJsonResponse`, `rateOutcome`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Capture the production baseline, then delete the probe

#### Automated

- [x] 1.1 Type gate passes: `npm run typecheck` — 7b69668
- [x] 1.2 Lint passes: `npm run lint` — 7b69668
- [x] 1.3 Build passes: `npm run build` — 7b69668
- [x] 1.4 Full suite passes with no new failures: `npm test` — 7b69668
- [x] 1.5 The route is gone from the tree: `git ls-files src/pages/api/shipprobe.ts` returns nothing — 7b69668

#### Manual

- [x] 1.6 Production baseline reading taken BEFORE any merge, returned `500`, recorded with host and timestamp — 7b69668
- [x] 1.7 Local post-deletion pre-check returned `404` on the dev server, recorded as a pre-check and NOT as half of the production pair — 7b69668

### Phase 2: Extract the sampling discriminator and put it under test

#### Automated

- [x] 2.1 Type gate passes: `npm run typecheck` — 1852533
- [x] 2.2 Lint passes: `npm run lint` — 1852533
- [x] 2.3 Build passes and the `@/*` import resolves in the Worker entry: `npm run build` — 1852533
- [x] 2.4 The new test passes: `npx vitest run tests/lib/sentry-sampling.test.ts` — 1852533
- [x] 2.5 The wiring guard passes: `npx vitest run tests/lib/sentry-wiring.test.ts` — 1852533
- [x] 2.6 Full suite passes: `npm test` — 1852533
- [x] 2.7 Env guard passes over the new module: `npx vitest run tests/lib/no-env-access.test.ts` — 1852533
- [x] 2.8 Logging guard passes over the new module: `npx vitest run tests/lib/no-logging.test.ts` — 1852533

#### Manual

- [x] 2.9 Deliberate-breakage run recorded with observed failure string and red/green split; restored and hash-verified — 1852533
- [x] 2.10 Second deliberate-breakage run: re-inlining the decision turns `sentry-wiring.test.ts` red while `sentry-sampling.test.ts` stays green; recorded, restored and hash-verified — 1852533
- [x] 2.11 `git diff src/worker.ts` shows `WorkerEnv`, the `dsn` read, both integrations and the adapter import unchanged — 1852533

### Phase 3: Doc-sync

#### Automated

- [x] 3.1 Live docs are formatter-clean: `npx prettier --check` on `roadmap.md` and `test-plan.md`
- [x] 3.2 The archived runbook is proved ignored as a PAIR after the corrections land: `--list-different` silent, `--ignore-path /dev/null --list-different` prints the file
- [x] 3.3 Type gate and lint still pass after the `src/worker.ts` comment edit
- [x] 3.4 No live document still claims the probe exists (repo-wide search outside `context/archive/` and `dist/`; `context/foundation/jira-map.md` excluded by decision)

#### Manual

- [x] 3.5 Every doc-sync target chosen by section header, not line number; dated snapshots appended to rather than overwritten
- [x] 3.6 Roadmap H-15 `Status` still `not started`, no `## Done` entry added
- [x] 3.7 The archived runbook renders correctly after manual formatting

### Phase 4: Ship and prove it on production

#### Automated

- [ ] 4.1 The `deploy` job's conclusion is `success`

#### Manual

- [ ] 4.2 `GET /api/shipprobe` returns `404` on the same prod host that returned `500` in Phase 1, both readings recorded
- [ ] 4.3 Spot check: no new Sentry event produced by that request
