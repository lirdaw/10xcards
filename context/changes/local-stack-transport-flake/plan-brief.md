# Local Stack Transport Flake (C10X-39) — Plan Brief

> Full plan: `context/changes/local-stack-transport-flake/plan.md`
> Research: `context/changes/local-stack-transport-flake/research.md`

## What & Why

The local Supabase stack answers a random `502 upstream prematurely closed connection` on roughly
10–15% of full-suite runs, surfacing as a different red case each time. A `fetch` wrapper absorbs
it, but the wrapper replays **writes**, and four test helpers write rows that no assertion ever
re-counts — so a replayed write that had in fact committed would pass silently. This change
removes the cause where it can be removed, and makes those seams loud so the wrapper's residual
risk stops being invisible.

## Starting Point

Kong and PostgREST both idle out keep-alive connections at exactly **60 s** — measured, and the
opposite of what every document in the repo says ("Kong holds them longer"). Equal timeouts are
the pathological case: neither side reliably closes first. No supported Supabase CLI surface
exposes either timeout — Kong's env is a hardcoded Go slice, `kong.yml` is `//go:embed`-ed, the
image is not settable from `config.toml`, and PostgREST has never had the knob. The risk is
live: in ~23 h, 11 non-idempotent writes were replayed, three of them onto seams with no oracle.

## Desired End State

Local Kong runs with upstream keep-alive pooling disabled, applied automatically by
`npm run db:start` and mirrored in CI, with `/usr/local/kong/.kong_env` reading
`upstream_keepalive_pool_size = 0` as machine-checkable proof Kong adopted it. The wrapper stays
— the fix is wiped by every `supabase stop` — but every write seam it can replay now carries a
case-scoped count oracle. Every document states the measured mechanism.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Acceptance criterion | Take the unsupported lever | The ticket demanded a configuration change; none is supported, so the change takes an unsupported container recreation rather than revising the criterion. | Plan |
| Which lever | `KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0` | Kong discussion #14417 reports lowering the idle timeout as ineffective; pool_size=0 is the one remedy reported to work. | Research |
| How to recreate | `docker commit` then re-run | The CLI overrode the container's **entrypoint** with a 15 KB `sh -c` heredoc (`Config.Cmd` is `null`); committing bakes that entrypoint into the image, so the re-run passes no command and no `--entrypoint` at all. | Plan, corrected by plan-review F1 |
| CI parity | Add the step to `ci.yml`, `continue-on-error` | Explicit decision for identical configuration, taken **against** research's finding that CI is structurally immune — so the step is advisory and cannot block a release. | Plan, F4 |
| Seam loudness | Count oracle per helper | No schema change and no product rule; a DB unique index on `(deck_id, front)` was ruled out by measurement. | Plan |
| Falsifiability | Census **and** targeted reds | The targeted reds attribute precisely; the census discovers seams a reading would miss — which is exactly how F3's scan missed two. | Plan |
| The wrapper | Keep, correct its header | The Kong fix is per-machine and wiped by `supabase stop`, so the wrapper is the belt that survives. | Plan |

## Scope

**In scope:** the unsupported Kong recreation (script + local wiring + CI step); making every
silent write seam loud; the census that enumerates them; the before/after flake measurement;
correcting the mechanism at three live sites, two stale pointers, and two `lessons.md` rules.

**Out of scope:** production (no local Kong there); test ordering / `sequence.shuffle` (C10X-32);
deleting or narrowing the wrapper; a DB uniqueness constraint on `flashcard`; upgrading the
Supabase CLI; a deterministic reproducer; `vitest.eval.config.ts`; any `src/` change.

## Architecture / Approach

Two independent halves under one ticket. The **cause** half is an unsupported operation written
the way this repo writes gates — a pure `scripts/kong-keepalive.ts` (argument-vector construction,
`.kong_env` parsing) with its own test file, plus an I/O `scripts/disable-kong-keepalive.ts` that
inspects → commits → removes → runs → waits for health → verifies adoption, failing non-zero on
anything it did not verify. The **seams** half is four in-helper count oracles, discovered by
experiment rather than by reading. Either half can ship without the other.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Recreate Kong | Idempotent, verified local recreation at `pool_size = 0` | Labels not replicated → `supabase stop` orphans the container and the next `start` collides |
| 2. Wire it | `db:start` chain + CI step + README line | The CI step is unsupported and fatal — a CLI upgrade turns the deploy-blocking gate red |
| 3. Census | The authoritative silent-seam list, by experiment | A green seam is only evidence if the duplicate provably landed — hence the duplicate scan |
| 4. Make them loud | Count oracle per seam + one red per seam + census re-run | Suite count deliberately does **not** move; an unchanged number here is correct |
| 5. Measure | 40-run matrix vs C10X-32's 22 absorbed drops | A quiet log proves nothing without the stock-pool control |
| 6. Docs | Mechanism, seam count, pointers, lessons, §6.6 + §8 entries | Writing "the flake is gone" if Phase 5 came back inconclusive |

**Prerequisites:** Docker running with the local stack up; `OPENROUTER_API_KEY` unset; ability to
push a branch so the CI step can be proven (it cannot be established locally).
**Estimated effort:** ~2–3 sessions across 6 phases. Phase 5 alone is ~30+ minutes of wall clock,
because the matrix must be spaced by ≥30 s of quiet or it cannot reproduce the condition.

## Open Risks & Assumptions

- **The CI step is a known, accepted exposure — now bounded.** Research measured CI as
  structurally immune to this flake (10–13 s suite, cold pool, one invocation, ~25 pre-wrapper
  runs green, 0 re-runs in 52 runs). The step is therefore parity, not necessity. It carries
  `continue-on-error: true` (plan-review F4), so the unsupported `docker` operation sits *beside*
  the gate that blocks `deploy` rather than *inside* it — a red there is a note about the
  local-parity experiment, never evidence about the code. It is still the first thing to drop.
  The consequence for verification: a green `ci` job no longer implies the step passed, so
  criterion 2.3 reads the **step's own conclusion**.
- **Phase 5 may return an unwelcome answer.** Two read-only probes already produced 0 drops from
  an *unfixed* stack, so a quiet log is not self-evidently a fix. If the stock-pool control does
  not reproduce a drop, the verdict is **inconclusive** and every document must say so.
- **The fix is per-machine and wiped by `supabase stop`.** Nothing shared depends on it, and a
  contributor who runs `npx supabase start` directly still gets the flake unless they run the
  script.
- **The committed image bakes this project's local `kong.yml`**, which embeds the stack's
  well-known Supabase demo JWTs. Local-only, never pushed, project-scoped tag.
- **The census proves silence only for seams that existed the day it ran** — a helper added later
  starts silent again, which is why the wrapper's header carries the rule rather than the count.
- **Unverified from research:** that PostgREST leaves warp's `settingsTimeout` at its default; the
  60.0 s measurement is consistent with 2 × 30 s but was not confirmed against source.

## Success Criteria (Summary)

- A developer's `npm run db:start` produces a stack whose Kong provably runs at
  `upstream_keepalive_pool_size = 0`, and `supabase stop` still cleans it up.
- Every write seam the wrapper can replay fails loudly on a duplicate — proved by a red per seam
  and by a census that goes from N silent to zero.
- No document in the repo still describes a mechanism the measurements contradict.
