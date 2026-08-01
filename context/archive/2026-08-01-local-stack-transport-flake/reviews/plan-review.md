<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Local Stack Transport Flake (C10X-39)

- **Plan**: `context/changes/local-stack-transport-flake/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-01
- **Verdict**: REVISE → **SOUND after triage** (all 8 findings fixed in `plan.md`, 2026-08-01)
- **Findings**: 2 critical, 4 warnings, 2 observations — 8 fixed, 0 skipped, 0 accepted, 0 dismissed

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

Two FAILs, but the approach is sound and every fix is a targeted decision rather than a
redesign — hence REVISE, not RETHINK.

## Grounding

19/19 existing paths ✓ (3 new by design: `scripts/kong-keepalive.ts`,
`scripts/disable-kong-keepalive.ts`, `tests/lib/kong-keepalive.test.ts`), 12/12 line
references ✓, brief↔plan ✓, Progress↔Phase mechanical contract 21/21 ✓.

**Two claims REFUTED against the running container** (`supabase_kong_10x-astro-starter`, up
25 h, healthy): the heredoc lives in `Config.Entrypoint`, not `Config.Cmd` (F1); and both of
Phase 6's automated greps return hits by construction (F3).

**Confirmed by measurement**: `.kong_env` reads `upstream_keepalive_pool_size = 60`,
`upstream_keepalive_max_requests = 100`, `upstream_keepalive_idle_timeout = 60`; both labels
(`com.supabase.cli.project`, `com.docker.compose.project` = `10x-astro-starter`); both network
aliases (`kong`, `api.supabase.internal`); `--user kong`; `--restart unless-stopped`; the
healthcheck (`CMD-SHELL kong health`, 10 s / 10 s / 10 retries); the `8000/tcp → 54321`
binding; 10 `KONG_*` vars plus `ASSET` and `KONG_VERSION`. Every seam line reference
(`study.test.ts:136-153`, `candidates.test.ts:89-112`, `generate.test.ts:352-363`,
`cards.test.ts:420-456`) and every Phase 6 doc target (`test-plan.md:655`, `:2928`, `:121`,
`:445`; `jira-map.md:63`) resolves, and no other live site carries either string.

## Findings

### F1 — The heredoc is `Config.Entrypoint`, not `Config.Cmd`

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Key Discoveries #2; Phase 1 §1 (`buildRunArgs` contract)
- **Detail**: Measured on the running container: `.Config.Cmd` is `null`;
  `.Config.Entrypoint` is `["sh","-c","<15 KB heredoc>"]`. The base image
  `public.ecr.aws/supabase/kong:2.8.1` is `Entrypoint=["/docker-entrypoint.sh"]`,
  `Cmd=["kong","docker-start"]` — so the CLI overrode the **entrypoint**, it did not set a
  Cmd. `docker commit` bakes that override into the new image's ENTRYPOINT, so running it
  with the plan's plain `./docker-entrypoint.sh kong docker-start --nginx-conf …` as Cmd
  appends those tokens as `$0 $1 …` to the `sh -c` script, which ignores them; the heredoc
  runs again regardless. The instruction "never the original heredoc `Cmd`, which the commit
  has already materialised" therefore cannot take effect as written, and `buildRunArgs` — a
  contract `tests/lib/kong-keepalive.test.ts` will pin — carries no entrypoint decision at
  all. The container likely still comes up and `.kong_env` still reads `0`, so the script's
  own verification passes: a false green on the design, with the tested vector carrying a
  dead component.
- **Fix A ⭐ Recommended**: Drop the command override — inherit the committed entrypoint.
  - Strength: The committed image's entrypoint *is* the CLI's own startup, byte for byte, so
    the recreation differs from `supabase start` in exactly one thing: the extra `-e`. It
    also makes `docker commit` load-bearing for a correct reason — a 15 KB container-level
    entrypoint cannot be re-attached to a fresh `docker run` of the base image.
  - Tradeoff: The heredoc rewrites `kong.yml`, the nginx template and the TLS pair on every
    start, so the commit captures the *entrypoint*, not the files; Key Discovery #2's stated
    reason has to be rewritten.
  - Confidence: HIGH — verified by `docker inspect` on both the container and the base image.
  - Blind spot: Not exercised end to end; only the config fields were read.
- **Fix B**: Keep the plain command and add `--entrypoint /docker-entrypoint.sh`.
  - Strength: Preserves the plan's stated design and gives `buildRunArgs` an explicit,
    assertable entrypoint element.
  - Tradeoff: Diverges from the CLI's startup, so a future CLI change to the heredoc silently
    stops being reproduced. The path must be **absolute** — `WorkingDir` is empty (`/`), and
    `/docker-entrypoint.sh` is where the file lives.
  - Confidence: MED — the file and permissions are verified; the start path is not.
  - Blind spot: Whether `/home/kong/`'s files survive intact under a commit+run that never
    re-writes them.
- **Decision**: FIXED via Fix A — Key Discovery #2 rewritten with the measured fields and a
  dated correction note; Phase 1 §1's contract now passes no command and no `--entrypoint`;
  Phase 1 §3 gains a case pinning that absence.

### F2 — The census collapses the suite at `beforeAll`, so it under-reports the seams it exists to find

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §1 — the census neuter
- **Detail**: Phase 3 says the neuter "issues the request a second time unconditionally" but
  never says **which response is returned**. The minimal edit to `retryingFetch` returns the
  second one, and that breaks the census: every describe block gets its deck from
  `createDeck`, which asserts `Location === "/decks"` and throws
  `Setup failed: deck "…" was never written` otherwise (`candidates.test.ts:58-70`, same
  shape in five other files). A duplicated `POST /rest/v1/deck` violates
  `deck_user_name_unique` — research already classifies deck as LOUD — so the second response
  is the failure branch, `beforeAll` throws, and every seam behind that deck never executes.
  Measured: 30 `seedCard` call sites and 4 `createNonAcceptedCard` sites all sit downstream of
  such a deck. The census's red set would be dominated by cascading setup failures and its
  silent-seam list would come back *shorter* than research's four — the exact failure mode
  ("a reading missed two") this phase exists to correct, inverted.
- **Fix A ⭐ Recommended**: Return the FIRST response; discard the replay's.
  - Strength: The census question is "does any assertion see the extra row", and only rows
    that land can be seen — deck's `23505` means no extra row, so swallowing it costs no
    signal. The run proceeds and every seam is exercised once.
  - Tradeoff: Slightly less faithful to the real flake's shape (where the caller sees the
    replay); needs one sentence in the contract saying so.
  - Confidence: HIGH — the constraint, the `createDeck` assertion and the call-site counts are
    all verified in the tree.
  - Blind spot: Other tables may carry constraints that make a second insert fail in a way
    that matters; the duplicate scan should surface those.
- **Fix B**: Keep returning the second response, exempt `POST /rest/v1/deck` from the doubling.
  - Strength: Faithful to the flake everywhere except the one table already proven loud; the
    exemption is itself documentation of why deck is loud.
  - Tradeoff: A path-based exemption in a wrapper whose header insists the predicate is
    body-based, not path- or method-based — even temporarily, it is the shape that file argues
    against.
  - Confidence: MED — depends on the deck insert being the only constrained write in the setup
    path.
  - Blind spot: `generation_session`'s partial unique index on `(user_id, idempotency_key)`
    could produce the same cascade in `generate.test.ts`.
- **Either way**, the plan must state which response the census returns — as written it is
  silent on the one decision that determines whether Phase 3 works.
- **Decision**: FIXED via Fix A — Phase 3 §1's contract now returns the first response and
  carries a paragraph naming the cascade, the two seam counts and the trade being made.

### F3 — Both of Phase 6's automated greps can never pass, and one misses the site the plan itself names

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 6 Automated Verification (6.1, 6.2)
- **Detail**: Run now, both fail by construction. 6.1
  `grep -rn "longer than PostgREST" --include=*.ts --include=*.md .` hits `change.md:12`,
  `change.md:29`, `plan.md:26/93/572/709`, `plan-brief.md:18`; the exclusion is worded
  "outside `context/archive/` and this change's own research", which covers none of those —
  and `change.md:12` is kept verbatim by design (Phase 6 §5), so it can never be cleared. It
  also **misses `tests/setup/retry-transport.ts:15`**, exactly as Key Discovery predicts: line
  15 ends `holds them idle longer than`, line 16 begins `PostgREST's`. The plan names the trap
  and then adopts the trapped grep as its acceptance check. 6.2 has the same shape:
  `context/changes/flashcards-test-order` appears in this change's own
  `plan.md:97/542/573/710`. The two genuine live targets are clean and confirmed:
  `test-plan.md:655`, `:2928` and `test-plan.md:121`, `jira-map.md:63` — nothing else outside
  `context/archive/`.
- **Fix**: Scope both greps to the surfaces they are about (`--include=*.ts` plus
  `context/foundation/`, excluding `context/changes/local-stack-transport-flake/`) and add a
  second pattern to 6.1 that catches the wrapped line — `grep -rn "holds them idle longer"`.
- **Decision**: FIXED — both greps scoped to `tests/ src/ context/foundation/`, 6.1 gains the
  wrapped-line pattern, and a note records why the original wording was unsatisfiable. Applied
  in both the Success Criteria block and the Progress section.

### F4 — The CI step is fail-closed on an unsupported docker operation, with no degradation path

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §2 contract + Phase 2 §2
- **Detail**: Phase 1 mandates "**every** failure path exits non-zero", and Phase 2 puts the
  script inside the `ci` job — which both `drift` and `deploy` declare in `needs:`. So a CLI
  bump that renames the container, changes the entrypoint (F1) or drops a label turns the
  **deploy gate** red, for a step the plan's own research proved unnecessary there: 52 runs,
  ~25 pre-wrapper all green, structurally immune (10–13 s suite, cold pool, one invocation).
  The exposure is named in `plan-brief.md` §Open Risks and the step is called "first to drop",
  but no phase gives it a way to degrade. Fail-closed is the right contract for the drift
  gate, which is evidence about production; here it lets a cosmetic parity step block a
  release.
- **Fix A ⭐ Recommended**: `continue-on-error: true` on the CI step only.
  - Strength: One line; local stays fail-closed where the script's whole value is refusing to
    report unverified success. Matches how this repo already reasons about gates —
    `schema-diff.yml` sits deliberately off the deploy path for the same reason.
  - Tradeoff: Needs F5's restore, or a post-`rm` failure leaves the job running against a
    stack with no proxy and later steps fail confusingly instead of at the step that broke.
  - Confidence: HIGH — `ci.yml` structure and the `needs:` chain verified.
  - Blind spot: Whether a soft-failing step reads as "covered" to a future reader; the comment
    must say it is advisory.
- **Fix B**: A `--soft` flag on the script, used only by CI.
  - Strength: Explicit at the call site, and the script can distinguish "could not apply" from
    "applied and unverified" — only the first being tolerable.
  - Tradeoff: Adds a second code path to the one thing whose contract is "never report success
    on what you did not verify".
  - Confidence: MED — clean, but new surface for a step that may be dropped anyway.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — Phase 2 §2 now specifies `continue-on-error: true` with the
  local/CI asymmetry argued at the site; the comment contract goes from three things to four
  (the step is advisory); and criteria 2.3 / Progress 2.3 now require the **step's own
  conclusion**, since a green job no longer implies the step passed.

### F5 — A partial failure leaves the developer's stack with no proxy, and nothing restores it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details; Phase 1 §2; Migration Notes
- **Detail**: The ordering is `commit → rm -f → run → wait health → verify`. Any failure at
  steps 3–5 leaves Kong removed or unhealthy — and Phase 2 chains this into
  `npm run db:start`, so the user-visible failure is "I ran `db:start` and my stack has no API
  on 54321". Migration Notes carry the recovery (`supabase stop && supabase start`), but the
  script's contract never prints it and no phase exercises the path.
- **Fix**: On any failure after `docker rm -f`, attempt one restore run from the committed
  image *without* the lever, and print `npx supabase stop && npx supabase start` as the
  recovery whether or not it worked. Add a Phase 1 criterion that exercises it — a
  deliberately bogus `docker run` argument is enough.
- **Decision**: FIXED — Phase 1 §2 gains an "owns the window it opens" paragraph (one lever-less
  restore attempt, the recovery command printed either way, still exits non-zero), plus new
  criterion 1.7 exercising it; Phase 1's manual criteria renumbered 1.8–1.10 in both the phase
  body and Progress.

### F6 — Phase 5's stock-pool control is the load-bearing evidence and has no size

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §2(c); criterion 5.4
- **Detail**: The plan is right that without control (c) the comparison is inconclusive — but
  it specifies only "a shorter matrix", and the pass condition is "at least one drop returns".
  Against C10X-32's baseline of 22 drops / 40 runs ≈ 0.55 per run, a 5-run control has
  P(zero) ≈ 6% **by chance**, which the plan's own rule then converts into a recorded
  "inconclusive". The control's length is the difference between a usable verdict and a coin
  flip, and it is the one number left unstated in a phase that budgets everything else.
- **Fix**: Size the control from the baseline rate and say so: ≥10 spaced runs gives
  P(zero | unfixed) ≈ 0.4%, so a zero there is real evidence rather than noise. Roughly
  7 minutes of wall clock.
- **Decision**: FIXED — Phase 5 §2(c) now specifies ≥10 spaced runs with the derivation stated
  (0.55/run → P(zero) 6% at n=5 vs 0.4% at n=10) and requires the observed count to be recorded,
  not just "at least one"; criterion 5.4 and Progress 5.4 updated to match.

### F7 — Criteria 1.3 and 5.2 are unrunnable in this repo's shell as written

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 criterion 1.3; Phase 5 criterion 5.2
- **Detail**: Hit while grounding:
  `docker exec supabase_kong_10x-astro-starter cat /usr/local/kong/.kong_env` from Git Bash on
  this machine resolves the path to `C:/Program Files/Git/usr/local/kong/.kong_env` and exits
  1. `MSYS_NO_PATHCONV=1` (or PowerShell) is required. Node's `child_process` is unaffected,
  so only the human-run criteria bite — but these are the criteria that carry the whole
  adoption claim. The `.kong_env` triple itself is confirmed once the path conversion is
  disabled.
- **Fix**: Write the criteria as
  `MSYS_NO_PATHCONV=1 docker exec … cat /usr/local/kong/.kong_env`.
- **Decision**: FIXED — criterion 1.3 carries the prefix and the measured reason, 5.2 points at
  it, and Progress 1.3 matches.

### F8 — `seedGenerationSession` is a fifth write helper, named by research and absent from Phase 4

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 4 §4
- **Detail**: `candidates.test.ts:139-155` `seedGenerationSession` appears in research's
  `.single()` false-oracle trap list but in **neither** its silent nor its loud list — so it
  is unclassified, not cleared. Phase 4 enumerates four seams and defers everything else to
  "any further seam the census found". Given F2, leaning on the census for a seam a reading
  has already flagged is the weaker of the two available oracles.
- **Fix**: Name it in Phase 4 §4 as a known candidate so the census confirms it rather than
  discovers it.
- **Decision**: FIXED — Phase 4 §4 is retitled to name it, scopes its count by
  `(user_id, source_text, status)`, and adds the reverse rule: if the census says the seam is
  already loud, record the subtraction and drop the oracle rather than asserting against a
  measurement.

## What holds up

Recorded so it is not lost in the findings: every seam line reference is accurate
(`study.test.ts:136-153`, `candidates.test.ts:89-112`, `generate.test.ts:352-363`,
`cards.test.ts:420-456`); `allSessions` exists at `generate.test.ts:220` and is
status-agnostic exactly as Phase 4 §2 assumes; all four Phase 6 doc targets are real and no
other live site carries either string; the container's labels, both network aliases,
`--user kong`, `--restart unless-stopped`, the healthcheck triple and the `8000/tcp → 54321`
binding all match the plan's enumeration; the `scripts/` pure-half / I-O-half convention and
the `tests/lib/*.test.ts` → `../../scripts/*.ts` import precedent
(`tests/lib/schema-drift.test.ts:5`) are followed correctly; `tsconfig.json` includes `**/*`,
so `npx tsc --noEmit` really does cover the new scripts; and the Progress block satisfies the
mechanical contract, 21/21.
