---
date: 2026-08-01T10:39:57+0200
researcher: lirdaw
git_commit: 901130e23086c209c7c27ca81897969fcaae473b
branch: C10X-39-local-stack-transport-flake
repository: lirdaw/10xcards
topic: "Remove the cause of the local stack's Kong 502 transport flake"
tags: [research, local-stack, kong, postgrest, keep-alive, test-harness, C10X-39]
status: complete
last_updated: 2026-08-01
last_updated_by: lirdaw
last_updated_note: "Added follow-up research answering open question 2 — whether the flake occurs in CI"
---

# Research: Remove the cause of the local stack's Kong 502 transport flake

**Date**: 2026-08-01T10:39:57+0200
**Researcher**: lirdaw
**Git Commit**: `901130e23086c209c7c27ca81897969fcaae473b`
**Branch**: `C10X-39-local-stack-transport-flake`
**Repository**: lirdaw/10xcards

## Research Question

From `change.md` (C10X-39): remove the **cause** of the local Supabase stack's Kong 502
"upstream prematurely closed connection" flake rather than the workaround. Three scope items:

1. **Confirm — do not assume — the cause** in the local stack's configuration.
2. Make the **two unguarded write seams loud** (`createNonAcceptedCard`, `seedCard`).
3. Once the cause is gone, **narrow or delete** `tests/setup/retry-transport.ts` +
   `tests/lib/retry-transport.test.ts`, and sync `test-plan.md` §4/§6.2/§6.9.

Acceptance: the cause established by a **configuration change** with a before/after measurement,
the oracle being **Kong's own log going quiet** on "prematurely closed".

## Summary

**The cause is confirmed, and it is sharper than the recorded diagnosis: both sides idle out at
exactly 60 seconds.** Measured on the live stack, Kong's `upstream_keepalive_idle_timeout` is
`60` s (2.8.1 default, no override set) and PostgREST/warp closes an idle keep-alive connection
after **60.0 s** (measured directly, Kong bypassed). The archive says Kong "holds them idle
longer than PostgREST's warp server keeps them open"; they are in fact **equal**, which is why
this is a coin-flip race that fires occasionally rather than a deterministic failure.

**The cause is not removable through any supported Supabase CLI surface.** Verified against the
installed version's source (`v2.98.2`): Kong's container env is a hardcoded Go slice with **no
host pass-through**, `kong.yml` is `//go:embed`-ed into the binary, the Kong image is **not**
overridable from `config.toml`, and `[api]` exposes only PostgREST settings. PostgREST exposes
**no** keep-alive knob in any version, ever. So the acceptance criterion as written — "cause
established by a configuration change" — has **no supported configuration change available to
it**, and that is the single most consequential finding for planning.

**Three further results change what this change should be:**

- **The residual risk from impl-review F3 is live, not theoretical.** In ~23 h of the current
  container, Kong logged 43 upstream drops; 11 reached a client as a 502 on a **non-idempotent**
  request, i.e. 11 writes the test wrapper would have replayed. Of those, **2 × `POST
  /rest/v1/flashcard` and 1 × `POST /rest/v1/generation_session`** land exactly on seams with no
  oracle.
- **Scope item 2 is understated.** The exhaustive sweep found **four** silent seams, not two —
  `generate.test.ts:352-363` and `cards.test.ts:454-456` were missed by F3's admittedly
  "targeted, not exhaustive" scan — and `seedCard` is *not* uniformly silent (≈8 of its 26 call
  sites sit next to an exact-count oracle).
- **Why the flake presents on writes has a mechanism nobody had named**: Kong ships no
  `proxy_next_upstream` directive, so nginx's default applies and **non-idempotent methods are
  never retried**. Kong already absorbs the idempotent drops itself — every PostgREST `GET` drop
  in 23 h was invisible to clients. The test wrapper's *entire* marginal value is retrying the
  POST/PATCH category, which is precisely the risky one.

Consequently the honest shape of this change is likely: **item 1 resolves as "confirmed, not
removable"**, **item 2 becomes the deliverable (widened to four seams)**, and **item 3 inverts** —
the wrapper stays, and the docs get corrected rather than deleted. A correction is owed either
way: `test-plan.md` §6.2 and §8 both state a mechanism ("Kong holds longer") that measurement
contradicts.

## Detailed Findings

### 1. The mechanism, measured on the live stack

Environment: Kong `public.ecr.aws/supabase/kong:2.8.1`, PostgREST
`public.ecr.aws/supabase/postgrest:v14.5`, container up since `2026-07-31T11:36:12Z`,
`RestartCount=0` on both.

| Side | Idle keep-alive timeout | How established |
| --- | --- | --- |
| Kong (proxy) | **60 s** | `upstream_keepalive_idle_timeout = 60` in the container's own `/etc/kong/kong.conf.default`; **no** `KONG_UPSTREAM_KEEPALIVE_*` env var set (`docker inspect` shows 10 hardcoded `KONG_*` vars, none keepalive-related) |
| PostgREST/warp (backend) | **60.0 s** | **measured directly**, Kong bypassed: an OpenResty cosocket opened straight to `supabase_rest_…:3000`, one request, then idle → `upstream closed the idle keep-alive connection after 60.0s` |

The warp number is not the documented 30 s and the discrepancy is explained: warp's
`settingsTimeout` default is 30 s, but `System.TimeManager` is a two-round reaper (it flips
`Active → Inactive` on one pass and fires on the next), so the effective window is up to twice
the setting. 60.0 s measured matches 2 × 30 s exactly.

**Both sides are therefore 60 s.** The canonical rule for this class is that the proxy must drop
connections *more frequently* than the backend, otherwise clients see sporadic 502s. Equal
timeouts are the pathological case: neither side reliably closes first, so whichever wins the
race decides whether the next request finds a live socket.

Kong's other relevant defaults, from the same file: `upstream_keepalive_pool_size = 60`,
`upstream_keepalive_max_requests = 100`.

### 2. Why it surfaces on writes — an unnamed mechanism

The generated `/usr/local/kong/nginx-kong.conf` contains **no `proxy_next_upstream` directive**
(and the `upstream kong_upstream` block is a `balancer_by_lua_block` with the comment
`# injected nginx_upstream_* directives` and nothing injected). So nginx's default applies —
`proxy_next_upstream error timeout`, with non-idempotent methods (POST, LOCK, PATCH) excluded
from retry unless `non_idempotent` is set, which it is not.

Measured over the container's ~23 h, cross-tabulating the error log against the access log:

| Method | Upstream drops logged | Reached a client as 502 |
| --- | --- | --- |
| GET | 29 | 4 — **all `/auth/v1/health`**, i.e. no PostgREST GET drop ever reached a client |
| DELETE | 2 | 0 |
| POST | 7 | **7** |
| PATCH | 4 | **4** |
| HEAD | 1 | 1 (`/functions/v1/_internal/health`) |
| **total** | **43** | **16** |

So Kong silently absorbs the idempotent drops on its own, and every non-idempotent drop
surfaces. This reframes the test wrapper: its unique contribution is replaying exactly the
category nginx refuses to replay, for exactly the reason nginx refuses — the double-write risk.
That is worth stating in the docs regardless of what this change decides.

### 3. The recorded mechanism is corroborated and sharpened — not refuted

An intermediate measurement of mine looked like a refutation and was not; recording the
correction because a planner could otherwise re-derive it. Measuring the aggregate access-log
gap immediately preceding each drop gives **0 s for all 43**, which reads as "never after an idle
pause". That is an artifact: at ~700 req/s with 1-second log resolution, the burst's own earlier
requests occupy the same second.

Walking back to the **edge of the burst** instead:

- **43 of 43 drops occur in the first 1–2 s of a traffic burst** (median 1 s).
- The idle gap preceding those bursts has **median 27 s** (min 1 s, max 600 s); 20 of 43 follow
  ≥ 30 s of quiet.
- Drop-seconds carry 286–785 req/s (median 683) against a median active second of 5 req/s —
  every drop is in a second busier than the median, mean percentile 94.5 %.

So the archive's "the observed 502s follow a ~28 s gap" was a sound observation (median 27 s
here), and "first request after the gap" is right in spirit. Two refinements matter for
planning: the drop is not one request but a **cluster** spread over the burst's first two seconds
(2–4 sockets at a time), consistent with a pool of up to 60 connections being drained of stale
entries one reuse at a time; and the idle gap is often well under 60 s, which is expected once
the pool is understood as LIFO — a cold tail entry can exceed 60 s of individual idleness while
aggregate traffic gaps stay short.

*Verified*: the burst-edge correlation, the rates, the two timeouts. *Inference*: the LIFO
cold-tail explanation for sub-60 s aggregate gaps, and that nginx fails to process the peer's
FIN in time because its event loop is saturated during a burst.

### 4. Reproduction attempts — two negative results worth keeping

Neither synthetic probe reproduced a single drop, and both are read-only (Kong's log as oracle,
so nothing was written):

| Probe | Shape | Result |
| --- | --- | --- |
| v1 | one connection; warm → idle → probe, gaps 10/40/40/45 s | **0 drops, 4/4** |
| v2 | 30 parallel sockets per burst; gaps 5/29/31/31/33/31 s | **0 drops, 6/6** |

This is a useful boundary: the flake needs the real burst profile (hundreds of req/s against a
pool that has gone cold), not merely an idle gap. **A cheap deterministic reproducer does not
appear to exist**, which means the before/after oracle stays what `change.md` already specifies —
Kong's log across a matrix of real suite runs — and a plan should not budget for a one-shot
repro. A probe that *would* have a chance: hold the pool open with ~700 req/s, idle ≥ 60 s, then
resume at the same rate.

### 5. Is the cause removable? No supported lever exists

Every avenue checked, against the **installed** CLI version rather than `main`:

| Lever | Verdict | Evidence |
| --- | --- | --- |
| PostgREST side | **Impossible** | `postgrest --example` on the running image lists every option; there is no keep-alive/idle/server timeout. Upstream docs confirm none exists in v14 or latest, and none was ever added — the only timeout option is `db-pool-acquisition-timeout` |
| `supabase/config.toml` | **Nothing** | `[api]` is `enabled`, `port`, `schemas`, `extra_search_path`, `max_rows` — all PostgREST settings. No Kong/nginx/keepalive key anywhere in the file |
| Host env → Kong | **Does not work** | `internal/start/start.go` at **tag v2.98.2** builds Kong's `Env` as a hardcoded `[]string`; no `os.Getenv`/`os.Environ` merge. `KONG_NGINX_WORKER_PROCESSES=1` is a literal |
| Custom `kong.yml` | **Impossible** | `//go:embed templates/kong.yml` — compiled into the binary |
| Override the Kong image | **Not exposed** | the `KongImage` field carries no `toml` tag, so it is not settable from `config.toml` |
| Newer CLI | **Unlikely to help** | the Envoy-for-Kong migration is **self-hosted/docker-compose only**; the CLI local stack still starts Kong, and no release note mentions this 502 class. Kong 3.5.0 raised pool/max-requests defaults but left `idle_timeout` at 60 |

**A trap worth recording**: Supabase's official troubleshooting page *"Kong stops responding
under heavy load in local development"* instructs users to run
`KONG_NGINX_WORKER_PROCESSES=auto supabase start`. On CLI v2.98.2 that **cannot work** — the
value is hardcoded in the env slice above. Anyone attacking this via the documented route will
lose an afternoon. (That page also describes a different mechanism — worker starvation — from
this one.)

The class itself is known upstream and unfixed: Kong issue **#11160** "Random 502 error due to
upstream keepalive" is **closed as not planned**, with `KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0` as a
community workaround; Kong discussion **#14417** reports lowering the idle timeout as
*ineffective*, resolved only by changing the **upstream's** keep-alive — the one lever PostgREST
does not provide. No supabase/cli issue covers this.

**What remains technically possible, all unsupported**: recreate the Kong container after
`supabase start` with the extra env; or shadow `public.ecr.aws/supabase/kong:2.8.1` with a local
image that bakes `ENV KONG_UPSTREAM_KEEPALIVE_IDLE_TIMEOUT`. Both are wiped or divergent across
machines, and **CI runs `npx supabase start` too** (`.github/workflows/ci.yml:35`), so either
would need a matching CI step — adding fragility to a gate in order to remove a flake the
harness already absorbs. Whether that trade is worth making is a plan decision, not a research
finding; the research finding is that no clean option exists.

### 6. Current exposure, quantified

The 11 non-idempotent 502s of the last ~23 h, by target — i.e. the writes the wrapper replayed:

| Request | Count | Loud or silent if duplicated |
| --- | --- | --- |
| `POST /rest/v1/deck` | 3 | **LOUD** — `deck_user_name_unique` → `23505` |
| `POST /rest/v1/flashcard` | 2 | **SILENT** — no uniqueness constraint on the table |
| `POST /rest/v1/generation_session` | 1 | **SILENT** |
| `PATCH /rest/v1/flashcard_schedule` | 2 | harmless — targeted update, re-applying the same value |
| `PATCH /rest/v1/flashcard` | 1 | harmless — same |
| `PATCH /rest/v1/deck` | 1 | harmless — same |
| `POST /rest/v1/rpc/study_due_cards` | 1 | harmless — POST-shaped read |

**Three at-risk replays in one day**, all on seams with no oracle. This is the strongest argument
in the whole change for scope item 2, and it is measured rather than argued.

### 7. The write seams — four silent, not two

Exhaustive sweep of `tests/` for direct DB writes (`.insert`/`.upsert`/`.update`/`.delete`; no
writing `.rpc(` exists in `tests/`).

**Silent — a duplicated row changes no assertion:**

- `tests/study/study.test.ts:136-153` `createNonAcceptedCard` → `flashcard`. All 4 call sites
  silent (`:330`, `:565-566`, `:585`): assertions are `listDueCounts` (accepted-only, so a
  duplicated *generated* row is excluded by construction), `not.toContain`, or a 404 check.
- `tests/review/candidates.test.ts:89-112` `seedCard` → `flashcard`. **Not uniformly silent** —
  ≈8 of 26 call sites sit beside an exact-count oracle and are LOUD (`:493`, `:495` `toEqual([…])`;
  `:540-541` `countCandidatesByDeck` → `toBe(2)`; `:576-579` `generationStateCounts` →
  `toEqual({…})`; `:783` `toEqual([accepted])`). The remaining ~18 are id-keyed reads → silent.
- **`tests/generation/generate.test.ts:352-363`** → `generation_session` (a seeded `failed` audit
  row). **No `.select()` at all**, and the test's oracle `succeededSessions(...)` is filtered to
  `status = 'succeeded'`, so it structurally cannot see a duplicated `failed` row. **New — not in
  F3's list.**
- **`tests/validation/cards.test.ts:454-456`** → `flashcard`, the `inRange` positive control.
  Only `error` and `public_id` truthiness asserted; no count follows. **New — not in F3's list.**

**Loud already:**

- `tests/validation/decks.test.ts:465-467` — `deck_user_name_unique` makes a duplicate a `23505`;
  the file comments this at `:462-464` and cites `retry-transport.ts:37-44`.
- `tests/db/languages.test.ts:102-104` — the whole table is re-read and compared `toEqual`.
- `tests/review/candidates.test.ts:706-715`, `:729-733`, `:764-768` — cross-tenant denials
  asserting `toEqual([])`, and A's own rewrite asserting exact array equality.

**A trap for whoever implements item 2**: `.insert(...).select(...).single()` — used by
`seedCard`, `createNonAcceptedCard`, `seedGenerationSession` and both `insertDirect` helpers —
looks protective and is not. `.single()` only sees the rows in *that one HTTP response*; a
retried duplicate arrives in a *different* response with a *different* `public_id`, so the two
rows are never in one response together. Making these loud needs either a post-insert count
scoped to the case, or a uniqueness constraint, not a `.single()`.

### 8. Blast radius, if the wrapper is narrowed or removed

- **Wiring**: `vitest.config.ts:37` (`setupFiles`) + its comment `:33-36`;
  `vitest.eval.config.ts:55-58` explains the deliberate *non*-mirroring and ends "Do not 'restore
  parity'" — it describes an absence, so it goes stale if the entry changes name.
- **Coverage lost**: the 8 cases in `tests/lib/retry-transport.test.ts` — the only falsifiability
  proof that the predicate cannot silently widen (two of them were proved red-able by breakage
  runs).
- **Docs to sync**: `test-plan.md` §4 (`:445`), §6.2 (`:644-660`), §6.9 (`:2458-2470`), §8
  (`:2906-2949`) **and the header ledger (`:100-121`)** — the header copy is not in `change.md`'s
  list. `lessons.md:201-206` states the general rule without naming the files, so it likely needs
  no edit.
- **Downstream citations that would be invalidated**: `tests/validation/decks.test.ts:464`, plus
  `context/archive/2026-07-31-deck-form-hardening/research.md:351,439` and `plan.md:501` — all
  three lean on `retry-transport.ts:37-44`'s loud-`23505` argument to justify *not* adding
  safeguards elsewhere.
- **A correction is owed regardless of the outcome**: §6.2 (`:654-656`) and §8 (`:2927-2929`)
  both state "Kong holds a keep-alive socket to PostgREST longer than PostgREST does". Measured,
  the two are **equal at 60 s**. That sentence is the reader's mental model of the bug and it is
  wrong in a way that would send someone looking for a timeout to lower on the wrong side.

## Code References

- `tests/setup/retry-transport.ts:104-122` — the wrapper; `:37-44` the "mostly, not always" loud
  paragraph this change re-opens; `:88`,`:125-128` the install sentinel
- `tests/setup/retry-policy.ts:36-69` — the pure predicate (`isLocalStack`,
  `isReplayableRequest`, `isKongKeepAliveDrop`)
- `tests/lib/retry-transport.test.ts:33-95` — the 8 predicate cases
- `vitest.config.ts:32-37` — `globalSetup` + `setupFiles` wiring
- `vitest.eval.config.ts:49-58` — the deliberate non-mirroring note
- `tests/study/study.test.ts:136-153` — `createNonAcceptedCard` (silent seam)
- `tests/review/candidates.test.ts:89-112` — `seedCard` (mixed); `:139-155` `seedGenerationSession`
- `tests/generation/generate.test.ts:352-363` — third silent seam (new)
- `tests/validation/cards.test.ts:420-427`,`:454-456` — `insertDirect`, fourth silent seam (new)
- `tests/validation/decks.test.ts:462-467` — the loud counter-example and its citation
- `.github/workflows/ci.yml:35` — `npx supabase start`, so any stack-level fix must also land here
- `supabase/config.toml` `[api]` — the whole user-facing surface, all PostgREST settings

## Architecture Insights

- **Equal timeouts on both sides of a keep-alive pool is the worst configuration**, worse than an
  obviously-wrong ordering, because it produces a low-rate intermittent failure instead of a
  reproducible one. The general rule — proxy must drop before backend — is the thing to encode in
  `lessons.md` if anything from this change is generalised.
- **A proxy's own retry policy is part of the failure's shape.** Kong absorbing idempotent drops
  and refusing non-idempotent ones is why this flake looks like "writes are flaky". Any
  client-side absorber inherits exactly the residual the proxy declined to take on — and inherits
  the reason, which is correctness, not effort.
- **`.single()` after an insert is a false oracle for duplicate writes**, project-wide. The only
  real protections in this suite are a DB uniqueness constraint and a case-scoped count.
- **The layer that can fix this cleanly is the one the CLI does not expose.** Both correct
  remedies (raise the backend's idle timeout above the proxy's, or disable upstream keep-alive)
  live in components whose configuration the Supabase CLI compiles into its binary. That is a
  structural constraint on the local stack, not a gap in this repo.

## Historical Context (from prior changes)

- `context/archive/2026-07-29-flashcards-test-order/verification.md:51-126` — where the flake was
  found, the 3/20-with-shuffle-on vs 3/20-with-shuffle-off control that proved it independent of
  ordering, the two refuted candidate causes, and the 22-absorbed-drops-across-40-green-runs
  positive control.
- `.../reviews/impl-review.md:129-173` — **F3**, the finding this change is chartered to close;
  note its own blind-spot admission ("Have not enumerated every insert helper in the suite — the
  two named are from a targeted scan"), which this research confirms was warranted: there are
  four.
- `.../reviews/impl-review.md:89-127` — **F2**, why the predicate was extracted into
  `retry-policy.ts`; the same argument applies in reverse if the wrapper is narrowed.
- `context/foundation/test-plan.md:2926-2949` — §8's C10X-32 entry, carrying the mechanism
  sentence that measurement now contradicts.
- `context/foundation/lessons.md:201-206` — the ordering/positive-control lesson, which already
  says "a red that does not reproduce at its own seed is a different animal".

## Related Research

- `context/archive/2026-07-29-flashcards-test-order/research.md` — the ordering investigation that
  surfaced this flake as a by-product.
- `context/archive/2026-07-31-deck-form-hardening/research.md:351,439` — the most recent change to
  lean on the wrapper's loud-`23505` argument.

## Open Questions

1. **Does this change accept that the cause is unremovable?** The acceptance criterion in
   `change.md` presumes a configuration change exists. Research says none does within the
   supported CLI surface. Either the criterion is revised, or the change takes on an unsupported
   container-recreation step that must also land in CI.
2. ~~**Does the flake occur in CI at all?**~~ **ANSWERED — no, and it cannot.** See the follow-up
   section below. No CI-side fix is needed, so any step added to `.github/workflows/ci.yml` would
   be pure cost.
3. **Would `upstream_keepalive_pool_size=0` be acceptable if a lever were found?** It removes the
   race outright at the cost of a TCP handshake per request. For a local dev stack the cost is
   probably irrelevant, and it is the one remedy the upstream Kong issue reports as effective.
4. **Should the four silent seams be fixed by a constraint or by assertions?** A partial unique
   index on `flashcard` would make *every* seam loud at once, including future ones, but it adds a
   production-schema object for a test-harness reason — which this project has done before
   (`deck_name_check`, `flashcard_front_check`) but always for a user-facing rule.
5. **Unverified**: that PostgREST leaves warp's `settingsTimeout` at its default. The 60.0 s
   measurement is consistent with 2 × 30 s but was not confirmed against PostgREST's source.

## Follow-up Research 2026-08-01 — does the flake occur in CI?

**No, and it is structurally impossible in the current workflow.** Two independent lines of
evidence agree, and the mechanistic one is the stronger of the two.

### Mechanistic: the pool never gets old enough

The flake needs a pooled Kong→PostgREST socket to reach ~60 s of idleness and then be handed to a
request. Measured from the CI job's own step timings and logs:

| Fact | Value | Source |
| --- | --- | --- |
| `npm test` wall clock | **10–13 s** (11 s, 12 s, 13 s across every run sampled; 6 s in the earliest, smaller suite) | step timings via the Actions API, 8 runs |
| Gap between the stack being ready and `npm test` starting | **~3–7 s** (`db:types` 2 s + `Export local stack credentials` 1 s) | same |
| `npm test` invocations per CI run | **exactly one** | `.github/workflows/ci.yml:60` |
| Does anything hit `/rest/v1/` before `npm test`? | **No** — `db:types` is `supabase gen types typescript --local`, which talks to Postgres, not through Kong | `package.json` |

So Kong's PostgREST upstream pool starts **cold** and the entire window in which a pooled socket
could exist is ~10 s — 6× shorter than the 60 s a socket needs to age before warp closes it.

This is also what makes the local case different, and it is worth stating plainly because it is
the real signature of the bug: locally the staleness accumulates **between** `npm test`
invocations (§3: median 27 s of quiet before a drop-bearing burst, max 600 s). CI has no previous
invocation to leave stale sockets behind.

### Empirical: the run history has no unexplained red

| Measure | Result |
| --- | --- |
| Total `ci.yml` runs | **52** |
| Successful | **50** |
| Failed | **2 — both deliberate**: `[scratch] prove CI turns red — do not merge` (29449673825) and `chore(C10X-29): fabricate a never-pushed migration` (30296868813, the drift-gate rehearsal, which failed in the `drift` job, not `ci`) |
| Runs with `attempt > 1` | **0** — nobody has ever re-run a failed job, which is the reflex after a flaky red |
| Runs executing the suite **before** the wrapper landed (2026-07-15 → 2026-07-29) | **~25, all green** |
| Strict signature scan (`upstream prematurely closed`, `invalid response was received from the upstream`, `" 502 `) over 6 pre-wrapper run logs | **0 hits** |

The pre-wrapper window is the load-bearing evidence: the wrapper landed 2026-07-30 and is silent,
so runs after it carry no information either way. Against the locally measured rate of 3 reds per
20 runs (15 %), the probability of seeing **zero** reds in ~25 unprotected CI runs is
`0.85²⁵ ≈ 1.7 %`. CI's exposure is measurably not the local exposure.

*Care with one number*: the earliest runs in that window exercised a much smaller suite (6 s, 8
files) so the window is not perfectly like-for-like; the later ones (2026-07-26 → 07-29, 166–220
tests) are.

### What this settles

- **Nothing should be added to `.github/workflows/ci.yml` for this flake.** The unsupported
  container-recreation options in §5 lose their main justification — they would add fragility to
  a gate in order to fix a problem that gate does not have.
- The flake is a **local developer-experience issue only**, which lowers the value of removing the
  cause and raises the relative value of scope item 2 (making the silent seams loud), since the
  wrapper is what stays.
- **A caveat on the oracle**: `change.md` names Kong's log as the acceptance oracle, and CI does
  not capture it. This conclusion therefore rests on the mechanism plus the outcome history, not
  on Kong's log — a direct CI-side measurement would require adding a `docker logs` step, which is
  not worth it given the above.

**Verified**: every figure in both tables (Actions API step timings, run list, log scans).
**Inference**: that `supabase gen types --local` does not traverse Kong — taken from the command's
nature and its 2 s runtime, not confirmed by a packet-level check; it does not affect the
conclusion, since even a warm socket at that point would be ~5 s old, not 60 s.

---

## Dated correction, 2026-08-15 (C10X-47 `dev-db-test-data-debt`) — appended, nothing above rewritten

**One measured figure in the Empirical table is false, and the inference this section draws from
it does not survive: `Runs with attempt > 1` is not 0.**

CI run **#66** (`ci.yml`, head `5f3c87e`, 2026-08-05) is `run_attempt: 2`. `gh run list` reports it
as **`success`**, because a re-run overwrites the visible conclusion — which is exactly why the
2026-08-01 sweep, reading the run list, saw a clean history. Attempt 1 (run id `31030491078`)
failed on `tests/validation/decks.test.ts`, in a `beforeAll`, on
`createDeck` answering the generic `Nie udało się utworzyć talii`.

**What that falsifies is narrower than it looks, and the boundary is the point of this
correction:**

- **Falsified**: the `attempt > 1` count, and with it the sentence "nobody has ever re-run a failed
  job, which is the reflex after a flaky red". Somebody has, once, and the re-run is what hid it.
  Any future sweep of this kind must read `run_attempt` per run rather than the run list's
  conclusion — a re-run makes a red run indistinguishable from a green one at that level.
- **Falsified**: the empirical half's completeness, and therefore the "zero unexplained red"
  premise that fed the `0.85²⁵ ≈ 1.7 %` calculation. There was an unexplained red; it was simply
  not visible to the query used.
- **NOT falsified**: this flake's **mechanism**, and this section's **mechanistic** argument —
  which was called "the stronger of the two" on 2026-08-01 and still is. Every figure in the first
  table stands.
- **NOT falsified, and stated so nobody over-reads the correction**: run #66's failure is **not
  attributed to the keep-alive flake**. C10X-47's research argues against that attribution on three
  independent grounds — the Kong container was six seconds old with `pool_size = 0`, so no socket
  could have aged; the endpoint's calls do traverse the wrapped `fetch`, so a genuine keep-alive
  `502` would have been replayed; and a replay landing on an already-committed insert would have
  produced `DECK_NAME_TAKEN_MESSAGE`, not the generic one that was observed. It is treated as a
  **separate, unattributed defect**.
- **Consequently NOT falsified**: "Nothing should be added to `.github/workflows/ci.yml` for this
  flake." That conclusion is carried by the mechanism, and no CI step is proposed by the
  correction either.

So what this section over-claimed is **CI immunity as an empirical fact**. What it got right is
that CI's pool never gets old enough for *this* flake. A CI run can still go red on a transport
shape this flake's mechanism does not cover, and one did.

Full analysis, the verbatim attempt-1 log, and the marker experiment that would attribute it:
`context/changes/dev-db-test-data-debt/follow-ups/deck-create-transient.md` (after archiving:
`context/archive/<date>-dev-db-test-data-debt/follow-ups/deck-create-transient.md`), and
C10X-47's `research.md` §4 Defect B.
