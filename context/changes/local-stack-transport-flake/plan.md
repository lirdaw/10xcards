# Local Stack Transport Flake (C10X-39) Implementation Plan

## Overview

Two independent deliverables under one ticket, and they are independent on purpose — either
one landing without the other still leaves the project better off.

1. **Remove the cause where it can be removed.** Kong and PostgREST both idle out their
   keep-alive connections at exactly 60 s, which is the pathological configuration: neither
   side reliably closes first, so whichever wins the race decides whether the next request
   finds a live socket. No supported Supabase CLI surface exposes either timeout, so the
   change takes on an **unsupported post-`supabase start` recreation** of the Kong container
   with upstream keep-alive pooling disabled (`KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0`), wired
   into `npm run db:start` and into CI.
2. **Make the silent retried-write seams loud.** The `fetch` wrapper that absorbs the flake
   replays non-idempotent requests, and four test helpers write rows that no assertion would
   ever re-count — so a replayed write that had in fact committed would pass silently. This
   half is worth doing regardless of (1), because the fix in (1) is wiped by every
   `supabase stop` and the wrapper therefore stays.

## Current State Analysis

**The cause is confirmed and sharper than the ticket's premise.** Measured on the live stack:
Kong's `upstream_keepalive_idle_timeout` is 60 s (2.8.1 default, no override) and
PostgREST/warp closes an idle keep-alive connection after 60.0 s. The recorded diagnosis —
"Kong holds them longer than PostgREST does" — is **wrong**; they are equal, which is exactly
why this is an occasional race rather than a deterministic failure. Drops cluster in the first
1–2 s of a traffic burst (43/43), after a median 27 s of quiet.

**No supported lever exists.** Verified against the installed CLI `v2.98.2`: Kong's container
env is a hardcoded Go slice with no host pass-through, `kong.yml` is `//go:embed`-ed, the Kong
image carries no `toml` tag so it is not settable from `config.toml`, `[api]` exposes only
PostgREST settings, and PostgREST has never had a keep-alive knob in any version. The official
Supabase troubleshooting page's `KONG_NGINX_WORKER_PROCESSES=auto supabase start` **cannot
work** on this CLI — the value is a literal in that slice.

**The residual risk is live, not theoretical.** In ~23 h of the current container, 11
non-idempotent writes were replayed by the wrapper; 2 × `POST /rest/v1/flashcard` and
1 × `POST /rest/v1/generation_session` landed on seams with no oracle.

**The flake does not occur in CI and structurally cannot** — `npm test` is 10–13 s against a
stack started ~3–7 s earlier with a cold Kong pool and exactly one invocation per run, so no
socket can reach the 60 s it needs. Empirically: 52 runs, 0 unexplained reds, 0 re-runs, ~25
pre-wrapper runs all green.

## Desired End State

A developer's local Kong runs with upstream keep-alive pooling disabled, applied automatically
by `npm run db:start` and mirrored in CI, with `/usr/local/kong/.kong_env` reading
`upstream_keepalive_pool_size = 0` as the machine-checkable proof that Kong adopted it. The
`fetch` wrapper stays, but every write seam it can replay is now followed by a case-scoped
count oracle, so a duplicated write fails loudly instead of passing. Every document that
states the mechanism states the measured one.

### Key Discoveries:

- **`/usr/local/kong/.kong_env` is the adoption oracle** — Kong's own dump of every resolved
  setting. It currently reads `upstream_keepalive_pool_size = 60`,
  `upstream_keepalive_max_requests = 100`, `upstream_keepalive_idle_timeout = 60`. This turns
  "did Kong take the setting?" from an argument into a one-line check.
- **`docker commit` captures the ENTRYPOINT, and that is the reason it is needed.** Measured
  on the running container rather than assumed: `.Config.Cmd` is **`null`**, and
  `.Config.Entrypoint` is a single `sh -c` heredoc that writes `kong.yml`, the custom nginx
  template, and a TLS cert + key before execing
  `./docker-entrypoint.sh kong docker-start --nginx-conf /home/kong/custom_nginx.template`.
  The base image is `Entrypoint=["/docker-entrypoint.sh"]`, `Cmd=["kong","docker-start"]` — so
  the CLI **overrode the entrypoint** at container-create time, and that override lives on the
  container, in no image. Re-supplying a 15 KB heredoc through `docker run` would be hopeless;
  committing bakes it into the new image's entrypoint, so the re-run needs **no command and no
  `--entrypoint` at all**.
  > Corrected by plan-review F1. This bullet read `Config.Cmd` and had the re-run pass a plain
  > command "never the original heredoc". Docker would have appended that command to the `sh -c`
  > script as ignored `$0 $1 …` args, the heredoc would have run anyway, and the container would
  > have come up with `.kong_env` at `0` — so the script's own verification would have passed
  > while `buildRunArgs` pinned a dead component. A false green on the design, not on the setting.
- **The container labels are load-bearing.** `com.supabase.cli.project` and
  `com.docker.compose.project` are both `10x-astro-starter` (from `supabase/config.toml`'s
  `project_id`). A recreated container missing them is orphaned by `supabase stop` and
  collides on the name at the next `supabase start`.
- **`upstream_keepalive_pool_size = 0` is the lever, not the idle timeout.** Kong discussion
  #14417 reports lowering the idle timeout as *ineffective*, resolved only by changing the
  upstream's keep-alive — the one lever PostgREST does not provide. Kong issue #11160 (closed
  as not planned) names `KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0` as the community workaround.
- **A `unique (deck_id, front)` index on `flashcard` is impossible** — verified, not assumed.
  `tests/generation/generate.test.ts:326-333` POSTs twice with no idempotency key into the
  **same** deck, and `mockCards` (`src/lib/openrouter.ts:119-124`) returns identical fronts on
  every call, so that deck legitimately holds duplicate `(deck_id, front)` rows. This closes
  research's Open Question 4 by measurement.
- **Every seam's `front` is distinct per call site** (31 `seedCard` sites, 4
  `createNonAcceptedCard` sites, each carrying the run suffix), so a `(deck_id, front)`
  count-of-one is both a duplicate detector and an authorship guard.
- **`.insert(...).select(...).single()` is a false oracle** for this class, project-wide: it
  only ever sees one HTTP response, and a retried duplicate arrives in a different response
  with a different `public_id`.
- **Kong ships no `proxy_next_upstream` directive**, so nginx's default applies and
  non-idempotent methods are never retried. Kong already absorbs every idempotent drop itself
  (no PostgREST `GET` drop reached a client in 23 h). The wrapper's *entire* marginal value is
  replaying the POST/PATCH category — precisely the one carrying the double-write risk.
- **The wrong-mechanism sentence lives in three live places, not two.** Research listed
  `test-plan.md` §6.2:655 and §8:2928; it is also in `tests/setup/retry-transport.ts:15-16`,
  the header a contributor reads before widening the predicate. A grep for
  `"longer than PostgREST"` misses it because the line breaks mid-phrase.
- **The header ledger does NOT carry the wrong mechanism.** Research says it "carries a copy
  of the §8 entry"; `test-plan.md:114-118` says only "(Kong keep-alive → PostgREST `502`)",
  which is accurate. What it does carry is a **stale pointer** at `:121` —
  `context/changes/flashcards-test-order/verification.md`, archived since at
  `context/archive/2026-07-29-flashcards-test-order/`. `jira-map.md:63` has the same.
- `scripts/` is the one place in this repo exempt from the `@/*` and `astro:env/server` rules
  (AGENTS.md): bare `node --experimental-strip-types`, `process.env`, relative sibling imports
  **with extension**, `console.*` allowed behind a file-level `eslint-disable`. The established
  shape is a pure half plus an I/O half (`schema-drift.ts` / `check-schema-drift.ts`).

## What We're NOT Doing

- **Production.** There is no local Kong there — the Cloudflare Worker talks to cloud Supabase
  over the public edge. Nothing in this change touches `src/`.
- **Test ordering / `sequence.shuffle`.** Closed by C10X-32; the flake was measured at the same
  rate with shuffle off, so it is a separate axis.
- **Deleting or narrowing the wrapper.** The Kong fix is wiped by every `supabase stop`, so the
  wrapper is the belt that survives. Its predicate and its 8 cases are unchanged.
- **Narrowing the wrapper to GET.** Kong already absorbs every idempotent drop; a GET-only gate
  would return the flake to full strength.
- **A DB uniqueness constraint on `flashcard`.** Ruled out by measurement (see Key Discoveries)
  for the unscoped form, and rejected for the `source_id = manual`-scoped form because it would
  impose a user-facing product rule for a harness reason.
- **Upgrading the Supabase CLI.** The Envoy-for-Kong migration is self-hosted only; the CLI
  local stack still starts Kong 2.8.1.
- **A deterministic reproducer.** Two read-only probes produced 0 drops in 10 attempts; the
  flake needs the real burst profile. The oracle stays a multi-run matrix.
- **`vitest.eval.config.ts`.** Its deliberate non-mirroring note (`:55-58`) stands; the eval
  path is untouched.
- **Adding new `it()` cases for the seam fix.** The oracles go inside existing helpers, so the
  suite count does not move — a fact worth stating up front, because this project's ledger
  tracks counts and an unchanged number here is correct rather than suspicious.

## Implementation Approach

Phases 1–2 own the cause; Phases 3–4 own the seams; Phase 5 measures whether Phase 1 worked;
Phase 6 syncs the documents. The two halves are deliberately separable: if Phase 5's control
run shows the recreation did not help, Phases 3–4 and 6 still ship and the ticket still closes
something real.

The unsupported step is written the way this repo writes gates — a **pure half** that builds
the `docker run` argument vector and parses `.kong_env`, with its own test file, plus an
**I/O half** that inspects, commits, removes, runs and verifies. That is what keeps an
unsupported operation falsifiable rather than a shell incantation nobody can check.

## Critical Implementation Details

**Ordering inside the recreation is not free.** `docker commit` must run **before**
`docker rm -f` (the writable layer holding `kong.yml` and the TLS keypair dies with the
container), and the health wait must complete **before** reading `.kong_env` (Kong writes it
during startup). A script that removes first and commits second destroys the stack and cannot
put it back.

**Idempotency is about detection, not about repetition.** A second `-e` of the same key wins in
`docker run`, so re-applying would "work" — but it would also pointlessly bounce Kong and reset
the log that Phase 5 uses as its oracle. The script must detect the applied state from
`.kong_env` and exit 0 without touching anything.

**The committed image bakes this project's local `kong.yml`**, which embeds the stack's
anon/service_role JWTs. They are Supabase's well-known local demo keys and the image is
local-only and never pushed — but the image name must be project-scoped and this must be said
out loud at the site, not discovered later.

## Phase 1: Recreate Kong without upstream keep-alive pooling

### Overview

An unsupported, idempotent, verifiable local operation: capture the running Kong container's
full runtime spec, commit it, replace it with an identical container carrying one extra
environment variable, and prove Kong adopted the setting.

### Changes Required:

#### 1. The decidable half

**File**: `scripts/kong-keepalive.ts`

**Intent**: Everything about the recreation that can be decided without touching Docker, so it
can be asserted instead of only reasoned about — the same split `schema-drift.ts` /
`check-schema-drift.ts` already uses, and for the same reason: this file has veto power over
whether the stack comes back up.

**Contract**: Exports the lever as a named constant (`KONG_KEEPALIVE_ENV`, i.e.
`KONG_UPSTREAM_KEEPALIVE_POOL_SIZE` → `"0"`); `containerNames(projectId)` deriving
`supabase_kong_<id>` and `supabase_network_<id>`; `buildRunArgs(spec)` turning an inspected
container spec into the `docker run` argument vector; and `parseKongEnv(dump)` →
`{ poolSize, maxRequests, idleTimeout }` over the `key = value` lines of `.kong_env`, plus a
predicate for "already applied".

`buildRunArgs` must reproduce, from the inspected spec rather than from literals: both labels
(`com.supabase.cli.project`, `com.docker.compose.project`), both network aliases (`kong`,
`api.supabase.internal`), the network, the `8000/tcp → 54321` port binding, `--user kong`,
`--restart unless-stopped`, the healthcheck (`kong health`, 10 s interval, 10 s timeout, 10
retries), every original `KONG_*`/`ASSET`/`KONG_VERSION` variable, and the lever appended last.
It passes **no command and no `--entrypoint`**: the committed image already carries the CLI's own
`sh -c` heredoc as its entrypoint (Key Discoveries), so inheriting it reproduces
`supabase start`'s startup byte for byte and the recreated container differs from the original in
exactly one thing — the extra `-e`.

#### 2. The I/O half

**File**: `scripts/disable-kong-keepalive.ts`

**Intent**: Perform the recreation and refuse to report success on anything it did not verify.

**Contract**: Reads `project_id` from `supabase/config.toml` by regex (the zero-runtime-dependency
property of `scripts/` is preserved deliberately — no TOML parser). Then: inspect → if already
applied, print and exit 0 → `docker commit` to a project-scoped local tag → `docker rm -f` →
`docker run` with `buildRunArgs` → poll `.State.Health.Status` until `healthy` with a bounded
timeout → `docker exec cat /usr/local/kong/.kong_env` and assert `upstream_keepalive_pool_size`
is `0`. Prints the before/after triple. **Every failure path exits non-zero**, including "the
container came back but `.kong_env` still reads 60" — a stack that is up but unmodified is the
false green this script exists to prevent. File-level `eslint-disable no-console`, matching
`check-schema-drift.ts`.

**And it owns the window it opens.** Everything after `docker rm -f` runs with the stack's proxy
gone, so a failure at `docker run`, at the health wait or at the verification leaves the
developer with no API on 54321 — reached through `npm run db:start`, whose failure then reads as
"my stack is broken", not "one optional step did not apply". On any failure past the removal the
script therefore attempts **one** restore run from the committed image **without** the lever, and
prints `npx supabase stop && npx supabase start` as the recovery whether or not that restore
succeeded. It still exits non-zero either way — the restore narrows the blast radius, it is not a
success path. Added by plan-review F5; it is also what makes Phase 2's `continue-on-error` safe,
since a tolerated failure must not let the job carry on against a decapitated stack.

#### 3. Coverage for the decidable half

**File**: `tests/lib/kong-keepalive.test.ts`

**Intent**: Make the argument-vector construction and the `.kong_env` parse falsifiable, the way
`tests/lib/retry-transport.test.ts` does for the wrapper's predicate.

**Contract**: Table-driven over fabricated specs — no Docker, no stack. Cases: both labels
present in the output; both aliases present; the lever present and last; the original env
preserved in full; **the vector ends at the image reference — no trailing command and no
`--entrypoint` element** (an absence, so it needs its own case: an assertion that only checks
what IS in the vector cannot see a command that crept back in); a `.kong_env` dump at 60 parsed
as not-applied and at 0 as applied; a dump
missing the key treated as not-applied rather than as applied. Per §6.2's rule the file needs a
**positive control**: a spec that round-trips unchanged when the lever is already set, without
which a `buildRunArgs` returning a fixed vector would satisfy every assertion above.

### Success Criteria:

#### Automated Verification:

- `npx vitest run tests/lib/kong-keepalive.test.ts` passes
- `node --experimental-strip-types scripts/disable-kong-keepalive.ts` exits 0 and prints the before/after keepalive triple
- `MSYS_NO_PATHCONV=1 docker exec supabase_kong_10x-astro-starter cat /usr/local/kong/.kong_env` shows `upstream_keepalive_pool_size = 0` — the prefix is **required**, not decoration: without it Git Bash rewrites the container path to `C:/Program Files/Git/usr/local/kong/.kong_env` and the command exits 1 (measured, plan-review F7). Node's `child_process` is unaffected, so this bites the hand-run criteria only, which are exactly the ones carrying the adoption claim
- Re-running the script exits 0, reports "already applied", and the container's `StartedAt` is unchanged
- `npm test` passes in full against the recreated Kong
- `npm run lint` exits 0
- The restore path is exercised, not just written: a deliberately bogus `docker run` argument makes the recreation fail **after** `docker rm -f`, and the script attempts the lever-less restore, prints the `supabase stop && supabase start` recovery, and still exits non-zero. Revert the injected argument and confirm a normal run is unaffected

#### Manual Verification:

- `npx supabase status` reports the stack healthy and the API reachable on 54321
- `npx supabase stop` removes the recreated container — `docker ps -a` shows no orphaned `supabase_kong_*` afterwards
- `npx supabase start` followed by the script returns the stack to `pool_size = 0`

**Implementation Note**: The `supabase stop` check is the one that proves the labels were
replicated correctly, and it is the failure mode that would otherwise surface days later as a
name collision. Pause here for manual confirmation before Phase 2.

---

## Phase 2: Wire it into `db:start` and CI

### Overview

Make the step automatic locally and mirror it in CI, with the CI comment stating plainly why it
is there — because the honest reason is parity, not necessity.

### Changes Required:

#### 1. Local wiring

**File**: `package.json`

**Intent**: A developer who runs `npm run db:start` gets the fixed stack without having to know
this ticket exists.

**Contract**: `db:start` chains the script after `supabase start`. A standalone entry (e.g.
`db:kong`) stays available so the step can be re-applied after a bare `npx supabase start`,
which the README documents for first-time setup.

#### 2. CI wiring

**File**: `.github/workflows/ci.yml`

**Intent**: Apply the same lever in CI so local and CI stacks are configured identically.

**Contract**: A new step immediately after `Start local Supabase stack` and before
`Check generated types against the schema` (`db:types` talks to Postgres, not through Kong, so
the position is about clarity rather than correctness), carrying **`continue-on-error: true`**.

**That flag is the whole difference between a parity nicety and a release blocker**, and it is
the one asymmetry in this plan worth stating twice. The script is fail-closed by contract
(Phase 1 §2) because locally its value is refusing to report success on what it did not verify.
In CI the same contract points the other way: the `ci` job is what `drift` and `deploy` both
declare in `needs:`, so an unsupported `docker` operation going wrong on a CLI upgrade would
stop a release — over a flake research measured CI as structurally immune to. Fail-closed is
right for the drift gate, which is evidence *about production*; it is wrong for a step whose own
justification is cosmetic. Same reasoning that keeps `schema-diff.yml` off the deploy path.
Note the flag composes with the restore in Phase 1 §2: without it, a failure after `docker rm -f`
would let the job continue against a stack with no proxy and surface three steps later. Added by
plan-review F4.

The comment must record four things,
in the style of the surrounding steps: what it does; that **research measured CI as
structurally immune** to this flake (10–13 s suite, cold pool, one invocation, ~25 pre-wrapper
runs green, 0 re-runs in 52 runs); that it is nevertheless here by an explicit decision for
configuration parity — so a future reader does not mistake it for a fix CI needs, and knows the
step is the first thing to drop if it ever goes red on a CLI upgrade; and that it is
**advisory**, so a red here is a note about the local-parity experiment and never evidence about
the code.

#### 3. Setup documentation

**File**: `README.md`

**Intent**: The Supabase Configuration section walks a new contributor through
`npx supabase start` directly; that path now leaves the flake in place.

**Contract**: One line in the first-time-setup steps pointing at `npm run db:start` (or the
standalone script) with a one-sentence why.

### Success Criteria:

#### Automated Verification:

- `npm run db:stop && npm run db:start` leaves `.kong_env` at `upstream_keepalive_pool_size = 0`
- `npm test` passes after that cycle
- A pushed CI run is green, **and the new step's own conclusion is `success`** — `continue-on-error` means a green job no longer implies the step passed, so read the step, not the job — with its log showing the pool size moving from 60 to 0
- `npm run lint` exits 0

#### Manual Verification:

- The CI job log is read end to end and the step is confirmed to have run against the real stack, not skipped
- The CI comment is re-read against research's CI findings and states the parity decision, not a necessity claim

**Implementation Note**: CI proves out only on a real push — there is no way to establish it
from a developer machine. Pause here for confirmation that the pushed run was green before
Phase 3.

---

## Phase 3: Census — enumerate the silent write seams by experiment

### Overview

Research found four silent seams by an exhaustive read; F3 found two by a targeted one and
missed two. This phase replaces reading with measurement: force the wrapper to replay every
local write once, then let the suite tell us which seams cannot see a duplicate.

### Changes Required:

#### 1. The census neuter (temporary, never committed)

**File**: `tests/setup/retry-transport.ts`

**Intent**: Turn the flake's rare double-write into a certainty for one run, so every silent
seam reveals itself at once.

**Contract**: A temporary edit that, for a local replayable request whose method is not `GET`,
issues the request a second time unconditionally — independent of status, i.e. bypassing
`isKongKeepAliveDrop` — and **returns the FIRST response, discarding the replay's**. Method
inspection is added **only for the census**; the shipped predicate stays body-based, as its
header explains.

**Which response is returned is the decision this phase turns on, so it is stated rather than
left to the edit.** Returning the second collapses the run: every describe block gets its deck
from a `createDeck` that asserts `Location === "/decks"` and throws `Setup failed: deck "…" was
never written` otherwise (`candidates.test.ts:58-70`, same shape in five other files), and a
duplicated `POST /rest/v1/deck` violates `deck_user_name_unique` — the one table research
already classifies as LOUD. The `beforeAll` dies and every seam behind that deck never executes:
**30 `seedCard` sites and 4 `createNonAcceptedCard` sites**, i.e. the census would report a
SHORTER silent list than the reading it exists to replace. Returning the first costs no signal,
because the census question is "does any assertion see the extra row" and only a row that
actually landed can be seen — deck's `23505` means there is no extra row to see. It is one step
less faithful than the live flake (where the caller does see the replay), and that is the trade:
faithfulness on a table already known loud, in exchange for reaching every table that is not.
Found by plan-review F2.

#### 2. The duplicate scan

**File**: none — a query run against the local stack after the census run

**Intent**: A seam that stays green is only evidence of silence if the duplicate actually
landed. Without this, "green" is equally consistent with "the replay never happened".

**Contract**: After the census run, group `flashcard` by `(deck_id, front)` and
`generation_session` by `(source_text, status)` and list every group with a count above one.
Each such group must be attributed to a call site. A green case sitting on a duplicated group is
a confirmed silent seam; a red case is a confirmed loud one.

### Success Criteria:

#### Automated Verification:

- The census run completes and its full red set is recorded verbatim with its denominator
- The duplicate scan output is recorded, with every group attributed to a call site
- After reverting, `git diff -- tests/` is empty and the file's `md5` matches a pristine copy taken before the edit
- `npm test` passes in full after the revert

#### Manual Verification:

- The measured silent-seam list is compared against research's four; any addition or subtraction is named explicitly rather than folded into a count
- The database is reset (`npm run db:reset`) or the duplicated rows are deleted, so Phase 4 does not inherit them

**Implementation Note**: The census is the discovery step Phase 4 depends on — do not start
Phase 4 from research's list of four if the census found more. Pause for confirmation of the
final list.

---

## Phase 4: Make every silent seam loud, and prove each one red

### Overview

A case-scoped count oracle inside each helper the census named. No schema change, no product
rule, no new `it()` — so the suite count does not move.

### Changes Required:

#### 1. The card seams

**Files**: `tests/study/study.test.ts` (`createNonAcceptedCard`, `:136-153`),
`tests/review/candidates.test.ts` (`seedCard`, `:89-112`)

**Intent**: Fail loudly when the row this helper wrote exists more than once.

**Contract**: After the insert, re-read a count of `flashcard` scoped by `deck_id` **and**
`front`, and assert exactly one. Every call site's `front` is already distinct within its file
and carries the run suffix, so this doubles as an authorship guard: two sites colliding on a
front now fail at setup rather than silently sharing an oracle. The comment must say why
`.single()` is not this assertion — it sees one response, and the duplicate arrives in another.

#### 2. The generation-session seam

**File**: `tests/generation/generate.test.ts` (`:352-363`)

**Intent**: The seeded `failed` audit row has no oracle at all — the case's own
`succeededSessions(...)` filters `status = 'succeeded'` and structurally cannot see it.

**Contract**: After the seed insert, assert exactly one row for that source text with
`status = 'failed'`. The file already has `allSessions(...)`, which is status-agnostic and
scoped by the same marker — reuse it rather than adding a fifth helper.

#### 3. The validation positive control

**File**: `tests/validation/cards.test.ts` (`insertDirect` / the `inRange` control, `:420-456`)

**Intent**: The `inRange` insert is the only one of the three that writes, and nothing counts
after it.

**Contract**: After the `inRange` insert, assert the bounds deck holds exactly one card — a raw,
state- and status-agnostic count scoped by `deck_id`, per §6.10's rule that `countFlashcards` /
`listFlashcards` are the wrong helpers (both filter `state_id = STATE_ACCEPTED`).

#### 4. `seedGenerationSession`, and any further seam the census found

**File**: `tests/review/candidates.test.ts` (`seedGenerationSession`, `:139-155`), plus whatever
Phase 3 located

**Intent**: Close the list the experiment produced, not the list the reading produced — while not
leaning on the experiment for a seam a reading has **already** flagged.

**Contract**: Same shape — a case-scoped count of one, immediately after the insert, with a
comment naming the retried-write class.

`seedGenerationSession` is named here rather than left to the census (plan-review F8) because
research's sweep put it in the `.single()`-false-oracle trap list and in **neither** its silent
list nor its loud list: it is unclassified, not cleared. Scope its count by `(user_id,
source_text, status)` — `source_text` carries the file suffix at every call site — and expect the
census to **confirm** it rather than discover it. If the census comes back saying this seam is
already loud, record that as a subtraction from the reading (Phase 3's manual criterion) and drop
the oracle; do not add an assertion the measurement contradicts.

### Success Criteria:

#### Automated Verification:

- `npm test` passes in full, with the suite count unchanged from the Phase 3 baseline
- Four (or more) targeted breakage runs — one per seam, inserting twice in a scratch case — each turn exactly that seam's new assertion red, with the observed failure string recorded
- Each targeted edit is reverted and the revert verified by `md5` against a pristine copy; `git diff -- tests/` empty
- The census from Phase 3 is re-run and now reports **zero** silent seams
- `npm run lint` exits 0

#### Manual Verification:

- The re-run census's red set is compared case by case against Phase 3's silent list — every previously-silent seam is now red, and nothing that was loud went quiet
- Duplicated rows created by the re-run census are cleaned up

**Implementation Note**: The before/after census pair is the strongest evidence in this phase —
N silent before, 0 after, measured the same way both times. Pause for confirmation.

---

## Phase 5: Before/after flake measurement

### Overview

Did Phase 1 actually remove the flake? The oracle is Kong's own log, and the phase is designed
around the fact that **a quiet log is not evidence on its own** — research already recorded two
probes that provoked zero drops from an unfixed stack.

### Changes Required:

#### 1. The matrix

**File**: none — a measurement, recorded in `verification.md`

**Intent**: Reproduce C10X-32's conditions closely enough that the comparison means something.

**Contract**: 40 full-suite runs at fresh un-pinned seeds against the recreated stack, **spaced
by at least 30 s of quiet** — the flake needs a pool that has gone cold (median 27 s of quiet
precedes a drop-bearing burst), so a back-to-back matrix cannot reproduce the baseline condition
and would produce a meaningless zero. Budget the wall clock accordingly (~30+ minutes).
Oracle: the delta in `docker logs supabase_kong_10x-astro-starter 2>&1 | grep -c "prematurely
closed"` across the matrix. Baseline for comparison: C10X-32's recorded **22 absorbed drops
across 40 runs** (`test-plan.md` §8).

#### 2. The controls, which are the load-bearing part

**File**: none — measurements, recorded in `verification.md`

**Intent**: Separate "the fix worked" from "the matrix did not provoke the flake" and from
"Kong was broken the whole time".

**Contract**: Three controls, all required. (a) The matrix is **green** — 0 red across 40 runs —
so a quiet log is not the log of a dead proxy. (b) `.kong_env` still reads
`upstream_keepalive_pool_size = 0` at the end, so the setting did not revert mid-matrix.
(c) **The stock-pool control**: recreate Kong at the stock `pool_size = 60`, run **at least 10**
runs under the same ≥30 s spacing, and confirm at least one drop returns. Without (c) the whole
comparison is inconclusive, and if (c) produces no drop that must be **recorded as
inconclusive** rather than reported as success.

**Ten is derived, not picked** (plan-review F6). C10X-32's baseline is 22 drops across 40 runs,
i.e. ≈0.55 per run, so a control of 5 runs returns zero **by chance** with probability ≈6% —
and the rule above would then convert that coin flip into a recorded "inconclusive", discarding
a real result. At 10 runs the same probability is ≈0.4%, which is what makes a zero here
evidence that the control itself did not reproduce rather than noise. Roughly 7 minutes of wall
clock. Record the observed drop count, never just "at least one": the rate is what a future
reader compares against.

### Success Criteria:

#### Automated Verification:

- 40-run matrix completes with 0 red
- `.kong_env` reads `upstream_keepalive_pool_size = 0` before and after the matrix (`MSYS_NO_PATHCONV=1 docker exec …`, see criterion 1.3)
- The Kong "prematurely closed" delta across the matrix is recorded (target 0, against C10X-32's 22)

#### Manual Verification:

- The stock-pool control matrix (**≥10 spaced runs**) reproduces at least one drop, and its observed count is recorded against the ≈0.55/run baseline; if it does not, the verdict is recorded as **inconclusive** and the change says so in every document rather than claiming a fix
- The final state of the stack is the fixed one (`pool_size = 0`), not the control's

**Implementation Note**: This is the phase most likely to return an unwelcome answer, and the
plan's shape depends on it: an inconclusive or negative result does not block Phases 4 and 6,
but it must change what Phase 6 writes. Pause for confirmation of the verdict before Phase 6.

---

## Phase 6: Documentation sync

### Overview

Correct the mechanism everywhere it is stated, widen the seam disclosure from two to four, fix
two stale pointers, and record this change in the two places this project records changes.

### Changes Required:

#### 1. The wrapper's own header

**File**: `tests/setup/retry-transport.ts`

**Intent**: This is the file a contributor reads before widening the predicate, and it is
currently wrong in the direction that reads as reassurance.

**Contract**: Correct the mechanism at `:15-18` — both sides idle out at 60 s, measured; equal
timeouts are the pathological case, not an ordering error. Widen `:37-44`'s "MOSTLY, NOT ALWAYS"
paragraph from two named seams to the census's full list, and record that those seams now carry
count oracles, so the paragraph changes from a disclosure of unguarded risk to a statement of
where the guard is. Add the mechanism nobody had named: Kong ships no `proxy_next_upstream`, so
non-idempotent methods are never retried and Kong absorbs every idempotent drop itself — the
wrapper's entire marginal value is the POST/PATCH category. Note that the cause is now removed
locally but the fix is wiped by `supabase stop`, which is why the wrapper stays.

#### 2. The test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Bring every claim about this flake in line with what was measured.

**Contract**: Mechanism correction at §6.2 `:654-657` and §8 `:2928`. Stale pointer at `:121`
(and its §6.2/§8 siblings if any) repointed to `context/archive/2026-07-29-flashcards-test-order/`.
§4's wrapper row (`:445`) and §6.9's second-fetch-seam note (`:2458-2470`) checked for anything
the seam fix invalidates. A new §6.6 entry for C10X-39 in this file's own convention — a claims
table plus an explicit **does-NOT-prove** list, which must include: the fix is unsupported and
wiped by `supabase stop`; CI's step is parity, not necessity; the wrapper still replays writes;
and the census proves silence only for seams that existed on the day it ran. A new §8 ledger
entry with the suite count (unchanged), the breakage splits, and the Phase 5 verdict stated
honestly. A new header-ledger entry at the top.

#### 3. The Jira map

**File**: `context/foundation/jira-map.md`

**Intent**: Same stale pointer, same class.

**Contract**: `:63`'s `context/changes/flashcards-test-order/…` repointed to the archive path.

#### 4. The lessons

**File**: `context/foundation/lessons.md`

**Intent**: Two rules that generalise past this ticket.

**Contract**: (a) Equal keep-alive timeouts on both sides of a pool is the pathological case —
the proxy must drop *before* the backend — and when neither component's configuration is yours
to change, the remedy is at the harness, not the stack. (b) `.insert(...).select(...).single()`
is a **false oracle** for a duplicated write: it sees one response, and a retried duplicate
arrives in another. The only real protections are a uniqueness constraint or a case-scoped
count.

#### 5. The change identity

**File**: `context/changes/local-stack-transport-flake/change.md`

**Intent**: The ticket's stated acceptance criterion presumed a supported configuration change;
the change took an unsupported one instead.

**Contract**: Record the revised acceptance under the existing Research-findings section — the
lever taken, that it is unsupported and per-machine, that CI carries it by an explicit parity
decision against research's own finding, and the Phase 5 verdict. Set `status` and `updated`.

### Success Criteria:

#### Automated Verification:

- Both mechanism greps return nothing over the live surfaces — `grep -rn "longer than PostgREST" tests/ src/ context/foundation/` **and** `grep -rn "holds them idle longer" tests/ src/ context/foundation/`
- `grep -rn "context/changes/flashcards-test-order" tests/ src/ context/foundation/` returns nothing
- `npm test` passes in full
- `npm run lint` and `npm run build` exit 0
- `npx tsc --noEmit` exits 0

> **The two greps were rewritten by plan-review F3, and the reason is the point.** They read
> `grep -rn … .` excluding `context/archive/`, which can never return empty: the phrase is in
> `change.md:12` (kept **verbatim** by design, §5 below), `change.md:29`, `plan.md`,
> `plan-brief.md` and `research.md`, and `context/changes/flashcards-test-order` is in this very
> plan four times. Scoping to `tests/ src/ context/foundation/` is what makes them satisfiable.
> The second pattern is not belt-and-braces either: `retry-transport.ts:15` ends
> `holds them idle longer than` and `:16` begins `PostgREST's`, so the first grep **misses the one
> live `.ts` site** — the trap Key Discoveries names, which the original criterion then walked
> straight into.

#### Manual Verification:

- The new §6.6 entry's does-NOT-prove list is read against Phase 5's actual verdict — if the verdict was inconclusive, no document claims the flake is gone
- The wrapper header is re-read cold by someone deciding whether to widen the predicate, and the mechanism it describes matches the measurements

---

## Testing Strategy

### Unit Tests:

- `tests/lib/kong-keepalive.test.ts` — the argument-vector construction and `.kong_env` parse, table-driven with a positive control (a fixed-vector implementation must not satisfy the suite)
- `tests/lib/retry-transport.test.ts` — unchanged; the shipped predicate does not move

### Integration Tests:

- The whole existing suite is the integration test for Phase 1: it runs against the recreated Kong, so a broken recreation surfaces as a red suite rather than as a subtle misconfiguration
- The census (Phase 3) and its re-run (Phase 4) are the integration evidence for the seam fix

### Manual Testing Steps:

1. `npx supabase stop`, then `npm run db:start` — confirm `.kong_env` reads `pool_size = 0`
2. `npx supabase status` — stack healthy, API on 54321
3. `npx supabase stop` — confirm no orphaned `supabase_kong_*` container remains
4. Push the branch and read the CI job log for the step's before/after line
5. Run the Phase 5 stock-pool control and confirm drops return without the fix

## Performance Considerations

Disabling upstream keep-alive pooling costs a TCP handshake per Kong→PostgREST request. Against
a loopback Docker network this is microseconds and the suite is 10–13 s; if the suite's wall
clock moves measurably, record it — a regression there is a real cost of the fix and belongs in
the verification record rather than being absorbed silently.

## Migration Notes

No database migration and no schema object. The Kong recreation is per-machine, unsupported, and
wiped by `supabase stop` — it is not state anything else depends on. Rollback is
`npx supabase stop && npx supabase start` plus reverting the `package.json` and `ci.yml` wiring.

## References

- Research: `context/changes/local-stack-transport-flake/research.md`
- Charter and findings: `context/changes/local-stack-transport-flake/change.md`
- Where the flake was found: `context/archive/2026-07-29-flashcards-test-order/verification.md`
- The finding this change closes: `.../reviews/impl-review.md` F3
- Pure-half / I/O-half precedent: `scripts/schema-drift.ts`, `scripts/check-schema-drift.ts`
- Predicate-extraction precedent: `tests/setup/retry-policy.ts`, `tests/lib/retry-transport.test.ts`
- Redirect-style count-oracle rules: `context/foundation/test-plan.md` §6.10

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Recreate Kong without upstream keep-alive pooling

#### Automated

- [x] 1.1 `npx vitest run tests/lib/kong-keepalive.test.ts` passes — 0823bb8
- [x] 1.2 `disable-kong-keepalive.ts` exits 0 and prints the before/after keepalive triple — 0823bb8
- [x] 1.3 `.kong_env` shows `upstream_keepalive_pool_size = 0` (read with `MSYS_NO_PATHCONV=1 docker exec …`) — 0823bb8
- [x] 1.4 Re-running the script exits 0, reports "already applied", `StartedAt` unchanged — 0823bb8
- [x] 1.5 `npm test` passes in full against the recreated Kong — 0823bb8
- [x] 1.6 `npm run lint` exits 0 — 0823bb8
- [x] 1.7 The restore path is exercised: a bogus `docker run` argument fails the recreation after `docker rm -f`, the script restores lever-less, prints the recovery, and still exits non-zero — 0823bb8

#### Manual

- [x] 1.8 `npx supabase status` reports the stack healthy and the API reachable on 54321 — 0823bb8
- [x] 1.9 `npx supabase stop` leaves no orphaned `supabase_kong_*` container — 0823bb8
- [x] 1.10 `npx supabase start` plus the script returns the stack to `pool_size = 0` — 0823bb8

### Phase 2: Wire it into `db:start` and CI

#### Automated

- [x] 2.1 `npm run db:stop && npm run db:start` leaves `.kong_env` at `pool_size = 0` — b6ce30c
- [x] 2.2 `npm test` passes after that cycle — b6ce30c
- [ ] 2.3 A pushed CI run is green, the step's own conclusion is `success` (not merely tolerated by `continue-on-error`), and its log shows 60 → 0
      <!-- DEFERRED to /ship, by decision 2026-08-01: ci.yml triggers only on push to `main`
           and on `pull_request` to `main`, so a feature-branch push runs nothing. The branch is
           pushed; 2.3 and 2.5 are read off the PR's `ci` job when /ship opens it. -->
- [x] 2.4 `npm run lint` exits 0 — b6ce30c

#### Manual

- [ ] 2.5 The CI job log confirms the step ran against the real stack
- [x] 2.6 The CI comment states the parity decision, not a necessity claim

### Phase 3: Census — enumerate the silent write seams by experiment

#### Automated

- [x] 3.1 The census run's full red set is recorded verbatim with its denominator — 4bb1fe3
- [x] 3.2 The duplicate scan output is recorded, every group attributed to a call site — 4bb1fe3
- [x] 3.3 After reverting, `git diff -- tests/` is empty and the `md5` matches the pristine copy — 4bb1fe3
- [x] 3.4 `npm test` passes in full after the revert — 4bb1fe3

#### Manual

- [x] 3.5 The measured silent-seam list is compared against research's four, additions named explicitly — 4bb1fe3
- [x] 3.6 Duplicated rows are cleaned up before Phase 4 — 4bb1fe3

### Phase 4: Make every silent seam loud, and prove each one red

#### Automated

- [x] 4.1 `npm test` passes in full, suite count unchanged from the Phase 3 baseline
- [x] 4.2 One targeted breakage run per seam turns exactly that seam's assertion red, failure strings recorded
- [x] 4.3 Each targeted edit reverted, verified by `md5`; `git diff -- tests/` empty
      <!-- md5 matches literally for retry-transport.ts (57ee187e…). For the four test files the
           breakage was interleaved with authoring (test-first), so no byte-identical earlier
           state exists to hash; verified instead by reading every deletion in the diff and by a
           residue grep. Deviation stated in verification.md §4.3. -->
- [x] 4.4 The census re-run reports zero silent seams
- [x] 4.5 `npm run lint` exits 0

#### Manual

- [x] 4.6 The re-run census's red set is compared case by case against Phase 3's silent list
- [x] 4.7 Duplicated rows from the re-run census are cleaned up

### Phase 5: Before/after flake measurement

#### Automated

- [ ] 5.1 40-run matrix completes with 0 red
- [ ] 5.2 `.kong_env` reads `pool_size = 0` before and after the matrix
- [ ] 5.3 The Kong "prematurely closed" delta is recorded against C10X-32's 22

#### Manual

- [ ] 5.4 The stock-pool control (≥10 spaced runs) reproduces at least one drop and its count is recorded, or the verdict is recorded as inconclusive
- [ ] 5.5 The stack is left in the fixed state, not the control's

### Phase 6: Documentation sync

#### Automated

- [ ] 6.1 `grep -rn "longer than PostgREST" tests/ src/ context/foundation/` AND `grep -rn "holds them idle longer" tests/ src/ context/foundation/` both return nothing
- [ ] 6.2 `grep -rn "context/changes/flashcards-test-order" tests/ src/ context/foundation/` returns nothing
- [ ] 6.3 `npm test` passes in full
- [ ] 6.4 `npm run lint` and `npm run build` exit 0
- [ ] 6.5 `npx tsc --noEmit` exits 0

#### Manual

- [ ] 6.6 The §6.6 does-NOT-prove list matches Phase 5's actual verdict
- [ ] 6.7 The wrapper header is re-read cold and its mechanism matches the measurements
