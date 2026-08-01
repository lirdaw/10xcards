<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Local Stack Transport Flake (C10X-39)

- **Plan**: `context/changes/local-stack-transport-flake/plan.md`
- **Scope**: Phases 1–6 (all; 2.3 / 2.5 open by explicit decision, deferred to `/ship`)
- **Date**: 2026-08-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations — **all 5 fixed during triage (2026-08-01)**

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success criteria re-run against the current files

Every automated criterion I could execute was re-run for this review, not read off the Progress boxes.

> **These are the AS-FOUND figures, measured before triage.** F1's fix later added one case, so the file is **19** and the suite **333** afterwards — both re-verified. The numbers below are left at what the review found, because a split is a claim about a run and this project's ledger has been burned by silently-updated denominators more than once.

| Criterion | Result |
|---|---|
| 1.1 `npx vitest run tests/lib/kong-keepalive.test.ts` | **18 passed (18)** |
| 1.3 `.kong_env` pool size | `upstream_keepalive_pool_size = 0` |
| 1.4 re-run is idempotent | `already applied — nothing to do.`, exit 0, `StartedAt` byte-identical before/after |
| 1.5 / 6.3 `npm test` | **332 passed (332), 29 files**, seed `1785602031175` |
| 1.6 / 2.4 / 4.5 / 6.4 `npm run lint` | exit 0 (6 pre-existing `no-console` warnings in `evals/`, unchanged) |
| 6.4 `npm run build` | exit 0 |
| 6.5 `npx tsc --noEmit` | exit 0 |
| 6.1 both mechanism greps | both return nothing |
| 6.2 stale-pointer grep | returns nothing |
| Guardrail: wrapper predicate unchanged | `git diff main...HEAD -- tests/setup/retry-transport.ts` filtered of comment lines returns **zero** lines — the change is provably comment-only |
| Guardrail: census residue | no `method` inspection in code anywhere in `tests/setup/`; working tree clean |
| Guardrail: no new `it()` | suite delta is **+18**, entirely `tests/lib/kong-keepalive.test.ts`; the four seam files are 22/22/22/13 before and after |

2.3 and 2.5 remain open. The stated reason was verified rather than accepted: `.github/workflows/ci.yml` triggers only on `push: branches: [main]` and `pull_request: branches: [main]`, so a feature-branch push genuinely runs nothing.

## Findings

### F1 — The positive control does not discriminate, and `buildRunArgs`'s first contract ("from the inspected spec, not from literals") is unasserted

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `tests/lib/kong-keepalive.test.ts:245-257`
- **Detail**:
  The case commented "THE POSITIVE CONTROL, and it is load-bearing rather than decorative: without it a `buildRunArgs` returning one fixed vector satisfies every assertion above" asserts
  `expect(buildRunArgs(alreadyApplied)).toEqual(buildRunArgs(REAL_SPEC))`.
  For any constant function `f`, `f(a) === f(b)` is trivially true — so this case cannot catch what its comment says it catches. The case that *does* defeat a fixed vector is the **unplanned** one beside it (`:274-290`, the stock-override), which demands `…POOL_SIZE=60`. The plan's literal requirement is therefore met, but by a different case than the one carrying the label.

  The deeper half was **measured, not argued**. Plan Phase 1 §1 opens with: `buildRunArgs` "must reproduce, from the inspected spec rather than from literals" — both labels, both aliases, the network, the port binding, user, restart policy, healthcheck. Every one of those assertions runs against the single `REAL_SPEC` (`:138-172`), whose values *are* the literals a hardcoding implementation would use. Breakage run for this review: line 270's `for (const [key, value] of Object.entries(spec.labels))` replaced with three hardcoded `args.push("--label", "com.supabase.cli.project=10x-astro-starter")`-style literals →

  **0 of 18 red.** Restored with `git checkout --`; `git status --porcelain` empty; re-run 18/18 green.

  No case anywhere varies the spec and asserts the output tracks it, so a `buildRunArgs` that ignored its `spec` argument entirely (while honouring `lever`) passes the whole file.
- **Failure scenario**: a refactor hardcodes the project label. Suite stays green. On any clone whose `supabase/config.toml` carries a different `project_id`, the recreated container is missing `com.supabase.cli.project=<their-id>` — so `supabase stop` orphans it, it keeps port 54321, and the next `supabase start` collides on the name. That is verbatim the failure the case's own comment (`:175-178`) says it exists to prevent, surfacing days later as "my stack will not start" with nothing pointing back here.
- **Fix**: Add a second fabricated spec — a different `project_id`, different labels, a different network/alias set and a different host port — and assert the vector tracks *it*, not `REAL_SPEC`'s values. Then correct the `:245-249` comment so the positive-control claim sits on the case that earns it (`:274-290` for the fixed-vector property; the new case for the spec-derived property), leaving `:250-257` labelled as what it genuinely is: the idempotency pin.
  - Strength: turns the plan's own first contract from reasoning into an assertion, using the fabricated-input pattern `tests/lib/config-status.test.ts` already established here ("the real constant appears in no assertion").
  - Tradeoff: one new `it()` in a `tests/lib/` pure file — no stack, no Docker, no suite-count concern for the seam work (the plan's "no new `it()`" rule scopes to the seam fix, not to this file, which already added 18).
  - Confidence: HIGH — the gap is measured (0/18 red), not inferred.
  - Blind spot: I did not check whether any other consumer depends on `buildRunArgs` accepting a spec shape other than the real one.
- **Decision**: **FIXED** (2026-08-01). `tests/lib/kong-keepalive.test.ts` gained `OTHER_SPEC` — a wholly fabricated container spec sharing no value with this machine's stack — and one case, `"builds from the inspected spec, not from this machine's literals"`, which asserts the joined vector does **not** contain `10x-astro-starter` and that every spec-derived field tracks `OTHER_SPEC` (both labels, network, the second alias, `-p 64321:8000`, `--user nobody`, `--restart always`, and the nanosecond→duration conversion at `5s`/`2s`/`3`). The `:245-249` comment was corrected: the positive-control claim now sits on the new case, and the idempotency case is relabelled as what it is, with the reason its old label was false stated in place.

  Proved falsifiable rather than argued: the same hardcoded-labels mutation that had left the file **0 of 18 red** now turns **1 of 19 red — exactly the new case** (`AssertionError: expected 'run -d --name supabase_kong_other-pro…' not to contain '10x-astro-starter'`), with the other 18 green beside it, which is what attributes the red to spec-derivation and nothing else. Mutation restored by `git checkout --`; `git diff --stat -- scripts/` empty; file re-run **19 passed (19)**.

### F2 — The adoption read sits outside the restore window, so a failure there prints guidance that is false

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/disable-kong-keepalive.ts:251`
- **Detail**: `docker(...)` + `waitForHealthy(...)` are wrapped (`:242-249`), but `const after = readKeepAlive(container)` at `:251` is not. If `docker exec … cat /usr/local/kong/.kong_env` throws (daemon hiccup, an exec race just after `healthy`), control reaches the top-level catch at `:270-278`, which prints "The local stack must be running before this step — `npx supabase start`" and "Nothing was changed unless a message above says otherwise". At that point Kong *has* just been recreated and *is* healthy, so both lines are wrong, and the script sends a developer — who reached this through `npm run db:start` — to restart a stack that is already up. It still exits 1, so this is a red with a wrong explanation rather than a false green.
- **Failure scenario**: `npm run db:start`; the recreation succeeds and Kong comes up healthy; the verification `docker exec` fails transiently; the developer is told their stack is not running and that nothing changed, while a recreated container of unverified pool size is serving 54321.
- **Fix**: Move `:251-252` inside the existing `try`, or give the read its own `catch { attemptRestore(spec); return 1; }` — matching the `:256-264` branch, which already treats "came back but unverified" as a failure worth restoring from.
- **Decision**: **FIXED** (2026-08-01). `after` is now declared with `let` and assigned inside the existing `try`, so a throwing `readKeepAlive` takes the `attemptRestore` + `return 1` branch instead of escaping to the top-level catch. The reason is recorded at the site, including the two false messages the old placement produced. Verified live on the full destructive path: `before — pool_size = 60` → `after — pool_size = 0` → `OK`, exit 0.

### F3 — `waitForHealthy` is stricter than `buildRunArgs`, so a healthcheck-less container would destroy a working Kong

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/disable-kong-keepalive.ts:141-167` vs `scripts/kong-keepalive.ts:272`
- **Detail**: The two halves disagree about whether a healthcheck is optional. `buildRunArgs` tolerates its absence — `if (spec.healthcheck && spec.healthcheck.Test[0] !== "NONE")` — while `waitForHealthy` returns only on `state.Health?.Status === "healthy"`. A container created without one can never satisfy that: the poll burns its full `HEALTH_TIMEOUT_MS` (60 s), throws, fires `attemptRestore`, which recreates the container the same way and burns another 60 s in its own `waitForHealthy`. Net effect: a working Kong is destroyed, recreated, and the script exits 1 after ~2 minutes. Unreachable today — the live container reports `["CMD-SHELL","kong health"]`, verified — but this is precisely the "restore path fires over a Kong that was working all along" class the `nanosToDuration` comment warns about. It also raises the chance of entering the double-failure path the CI step's comment discloses (`continue-on-error` lets the job continue against a proxy-less stack only if both the run *and* the restore fail).
- **Failure scenario**: a future Supabase CLI drops the Kong healthcheck; the next `npm run db:start` tears down a healthy proxy, spends two minutes, and leaves the developer with an exit-1 and a stack it just rebuilt for no reason.
- **Fix**: In `waitForHealthy`, treat `state.Health === undefined && state.Running` as success, mirroring the tolerance `buildRunArgs` already has.
- **Decision**: **FIXED** (2026-08-01). `waitForHealthy` gained `if (state.Health === undefined && state.Running) return;`, mirroring `buildRunArgs`'s existing tolerance, with the destroy-a-working-Kong scenario recorded at the site. Unreachable on today's container (`Health` is present and reaches `healthy`), which the live run confirms — it returned on the `healthy` branch as before.

### F4 — `inspectSpec` is an allowlist, so a future CLI's bind mount would be dropped silently

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/disable-kong-keepalive.ts:110-139`
- **Detail**: The spec is built by selecting named fields, so `HostConfig.Binds`, `Mounts`, `ExtraHosts`, `Ulimits`, `LogConfig`, `Sysctls` and `CapAdd` are not carried over. Checked against the live container and all are empty or default today (`Binds: null`, `Mounts: []`, `ExtraHosts: null`), so there is **no current defect**. But the module's stated contract is a faithful replacement built from the inspected spec, and neither of the script's two oracles can see the gap: `kong health` is process-local and `.kong_env` reports settings, not mounts. A dropped mount would present as a Kong that is up, healthy, verified — and subtly wrong.
- **Failure scenario**: a CLI upgrade adds a bind mount to the Kong container; the recreation silently omits it; the script reports OK; the stack misbehaves in a way nothing points back here.
- **Fix**: Throw a named error when `.HostConfig.Binds` or `.Mounts` is non-empty, **before** the destructive `docker rm -f` — a fail-closed guard consistent with the rest of the script, and cheap.
- **Decision**: **FIXED** (2026-08-01). `inspectSpec` now reads `.HostConfig.Binds` and `.Mounts` and throws a named error naming both counts and pointing at itself when either is non-empty. Placed at the top of `inspectSpec`, i.e. before `docker commit`/`docker rm -f`, so the refusal costs nothing and the stack is untouched. Inputs verified against the live container (`Binds: null`, `Mounts: []` → guard passes), and the full recreation ran through it successfully.

### F5 — Phases 1–2 have no recorded evidence, including the one deliberate-breakage run in the change

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/local-stack-transport-flake/verification.md:3-5`
- **Detail**: `verification.md` states the decision plainly — "Evidence for Phases 1–2 is carried by their Progress SHAs (`0823bb8`, `b6ce30c`)" — and the commits are one-line by this repo's convention, so they carry no evidence body. Criteria 1.1–1.6 and 1.8 I re-ran for this review and they hold. The three that cannot be re-derived are **1.7** (the restore path exercised by injecting a bogus `docker run` argument — the falsifiability run for the single most destructive thing in the change), **1.9** (`supabase stop` leaves no orphan, which is what proves the labels replicated) and **1.10**. This project records every breakage run with its observed failure string, and Phases 3–6 do so meticulously; 1.7 is the one that got none. Partial evidence does survive incidentally, in `scripts/kong-keepalive.ts:41-61`, which records a live observation from that session ("the 'lever-less' restore came back up reading `upstream_keepalive_pool_size = 0`") — so the run happened; its result is simply not written down where a reader looks.
- **Failure scenario**: a future contributor changing `attemptRestore` or the label replication has no recorded baseline to re-run against, and re-derives the experiment — or, likelier, skips it, exactly as this file's §8 ledger keeps recording for stale denominators.
- **Fix**: Add a short "Phase 1–2" section to `verification.md` with the 1.7 injection used, its observed output, and the `docker ps -a` result behind 1.9 — from the session record if it survives, otherwise by re-running 1.7 (it is non-destructive by design: it exercises the restore).
- **Decision**: **FIXED** (2026-08-01), by re-running rather than by recollection. `verification.md` gained a `## Phase 1–2 — re-derived during the impl-review` section: a table of criteria 1.1–1.6 and 2.1 re-executed against the post-review files, and a `### 1.7` subsection carrying the injection used (`--impl-review-bogus-flag` pushed into `buildRunArgs` before the image reference) with its **verbatim** observed output.

  The re-run also produced a finding the original run had not recorded: because the injection lives in `buildRunArgs`, which the restore path *also* calls, this fault can never yield a succeeding restore — so it exercises the worst branch (run fails **and** restore fails), which is precisely the double failure the CI step's `continue-on-error` comment says it tolerates. Written into the section, along with how a future re-run would have to inject the fault to see a *succeeding* restore.

  One boundary is stated rather than folded in: **1.9 (`supabase stop` leaves no orphan) was NOT re-run** — it would have cost the running database, and the rebuilt container's labels were verified present instead. The section says so explicitly.

## What was verified clean and is worth not re-litigating

- **No injection surface**: every Docker call is `execFileSync("docker", argv)` — no `shell: true`, no concatenation. `projectId` reaches only container/network/image names.
- **Destructive ordering correct**: `docker commit` (`:236`) strictly precedes `docker rm -f` (`:239`), commented as load-bearing; a failed commit aborts before removal.
- **Restore cannot mask failure**: `attemptRestore` swallows only its own errors for reporting; the caller returns 1 regardless.
- **Bounded poll**: `HEALTH_TIMEOUT_MS = 60_000`, no unbounded loop.
- **Secrets**: image tag is project-scoped (`supabase-kong-keepalive-${projectId}:latest`), the baked-JWT risk is documented at the tag site, nothing pushes the image.
- **All six seam oracles are real counts** (`count: "exact", head: true`), never `.single()`/`.maybeSingle()`/`find`, each scoped so it can actually go red, each commented with why `.single()` is not the assertion. Call sites were enumerated: fronts are pairwise distinct within each file, so the `toBe(1)` is falsifiable and shuffle-safe.
- **A documented deviation that is a correction, not drift**: the plan specified a *lever-less* restore; the code restores at `KONG_KEEPALIVE_STOCK` (`=60`) because `docker commit` bakes `Config.Env`, so omitting the `-e` inherits `0`. Observed live and recorded at `kong-keepalive.ts:41-61`. Had the plan been followed literally, Phase 5's stock-pool control would have produced no drops and been written down as *inconclusive* — discarding a real result. This is the implementation catching a plan defect by measurement.
- **`scripts/` boundary respected**: pure/IO split mirroring `schema-drift.ts` / `check-schema-drift.ts`, relative sibling import with the `.ts` extension, no `src/` crossing, file-level `eslint-disable no-console` only in the I/O half.
- **CI step placement and comment**: immediately after `Start local Supabase stack`, before the types check, `continue-on-error: true` present, and the comment carries all four mandated points including the consequence that a green job no longer implies the step passed.
