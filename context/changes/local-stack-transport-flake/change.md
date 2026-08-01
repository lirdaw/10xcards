---
change_id: local-stack-transport-flake
title: Make the retried-write seams loud
status: impl_reviewed
created: 2026-08-01
updated: 2026-08-01
archived_at: null
---

## Notes

Remove the CAUSE of the local Supabase stack's Kong 502 "upstream prematurely closed connection" flake, not just the workaround: Kong holds keep-alive connections to PostgREST longer than PostgREST does, so the first request after ~28s of idle can 502 and surfaces as a random red test wherever the assertion happened to be. Scope: (1) confirm — do not assume — the cause in the local stack's configuration (Kong keepalive_timeout / keepalive_requests shorter than PostgREST's, or a newer Supabase CLI image that already patches it); (2) make the two unguarded write seams loud — createNonAcceptedCard and seedCard have no count assertion after them and flashcard carries no uniqueness constraint, so a retried write that had in fact committed would pass SILENTLY (deck is loud via deck_user_name_unique); (3) once the cause is gone, narrow or delete tests/setup/retry-transport.ts plus tests/lib/retry-transport.test.ts and sync test-plan.md §4/§6.2/§6.9. Acceptance: cause established by a configuration change with a before/after measurement on the SAME 40-run matrix as C10X-32, and the ORACLE is Kong's own log going quiet on "prematurely closed" — NOT a green suite, which is already green thanks to the workaround (0/40 red while Kong logged 22 more drops). Out of scope: production (no local Kong there — the Cloudflare Worker talks to cloud Supabase) and anything about test ordering / sequence.shuffle (C10X-32, closed). Evidence: context/archive/2026-07-29-flashcards-test-order/verification.md and its reviews/impl-review.md F3; class recorded in test-plan.md §6.2 and §8. (source: C10X-39)

## Research findings (2026-08-01)

The scope paragraph above is kept verbatim as the ticket's charter; this section records what
measurement changed about it. Full evidence: `research.md` in this folder.

> **Retitled 2026-08-01**, from *"Remove the cause of the local stack's Kong 502 transport flake"*
> to *"Make the retried-write seams loud"* — the cause turned out not to be removable (below), so
> the old title named something this change will not deliver. The old wording still survives in
> the `change_id`, the branch name (`C10X-39-local-stack-transport-flake`) and the Jira summary
> for C10X-39; the id and branch are deliberately not renamed, and the Jira summary is corrected
> at `/jira-finish-work`.

**(1) Cause — CONFIRMED, and sharper than the premise above.** Both sides idle out at the same
value: Kong's `upstream_keepalive_idle_timeout` is **60 s** (2.8.1 default, no override set) and
PostgREST/warp closes an idle keep-alive connection after **60.0 s** (measured directly, Kong
bypassed). So "Kong holds keep-alive connections longer than PostgREST does" — the premise above,
and the wording in `test-plan.md` §6.2 and §8 — is **wrong**: they are **equal**, which is exactly
why this is an occasional race rather than a deterministic failure. The "~28 s of idle" half holds
(median 27 s of quiet before a drop-bearing burst), but the drop is a **cluster in the burst's
first 1–2 s** (43/43), not "the first request after the gap".

**Cause is NOT removable through any supported surface**, verified against the installed CLI
`v2.98.2`: Kong's container env is a hardcoded Go slice with no host pass-through, `kong.yml` is
`//go:embed`-ed, the Kong image is not overridable from `config.toml`, `[api]` exposes only
PostgREST settings, and PostgREST has never exposed a keep-alive knob in any version. Trap: the
official Supabase troubleshooting page's `KONG_NGINX_WORKER_PROCESSES=auto supabase start` **does
not work** on this CLI. Upgrading the CLI does not help — the Envoy-for-Kong migration is
self-hosted only.

> **Consequence: the acceptance criterion above is unsatisfiable as written.** "Cause established
> by a configuration change" has no supported configuration change available to it. The plan must
> either revise the criterion or take on an unsupported post-`supabase start` container
> recreation. No deterministic reproducer was found either (two read-only probes, 0 drops in 10
> attempts), so the before/after oracle stays a multi-run matrix, not a one-shot repro.

**(2) Understated — there are FOUR silent seams, not two.** Beyond `createNonAcceptedCard`
(`study.test.ts:136-153`) and `seedCard` (`candidates.test.ts:89-112`), the exhaustive sweep found
`generate.test.ts:352-363` (a seeded `failed` `generation_session`; its oracle is filtered to
`status = 'succeeded'`, so it cannot see a duplicate) and `cards.test.ts:454-456` (the `inRange`
positive control). `seedCard` is **not uniformly silent** — roughly 8 of its 26 call sites sit
beside an exact-count oracle and are already loud. Trap for the implementer:
`.insert(...).select(...).single()` is a **false oracle** here — it only ever sees one response,
and a retried duplicate arrives in a different response with a different `public_id`.

**The risk is live, not theoretical**: in ~23 h of the current container, 11 non-idempotent writes
were replayed, of which **2 × `POST /rest/v1/flashcard` and 1 × `POST /rest/v1/generation_session`**
landed on seams with no oracle.

**(3) Likely inverts.** Since the cause cannot be removed, the wrapper stays and the deliverable
becomes the doc correction rather than the deletion. Two additions to the sync list: the wrong
mechanism sentence in `test-plan.md` §6.2 (`:654-656`) and §8 (`:2927-2929`), and the **header
ledger (`:100-121`)**, which carries a copy of the §8 entry and was not in the list above.

**The flake does not occur in CI and cannot.** `npm test` is 10–13 s against a stack started ~3–7 s
earlier with a cold Kong pool and exactly one invocation per run, so no socket can reach the 60 s
it needs; empirically 52 runs, 0 unexplained reds, 0 re-runs, and ~25 pre-wrapper runs all green.
**Nothing should be added to `.github/workflows/ci.yml` for this** — it is a local
developer-experience issue only.

## Planning decision (2026-08-01)

Point (3) above predicted the change would invert into a doc correction. It did **not**: planning
took the **unsupported** lever research had ruled out of the supported surface — a post-`supabase
start` recreation of the Kong container at `KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0`, wired into
`npm run db:start` **and** into `.github/workflows/ci.yml`. The CI leg is an explicit parity
decision taken **against** research's own finding that CI is structurally immune to this flake;
the exposure is recorded in `plan-brief.md` §Open Risks. The wrapper still stays (the fix is
per-machine and wiped by `supabase stop`), the seam work is still the deliverable, and it widens
from research's four seams to whatever the plan's Phase 3 census measures. See `plan.md`.

**Also worth carrying**: Kong ships no `proxy_next_upstream` directive, so nginx's default applies
and non-idempotent methods are never retried — Kong already absorbs every idempotent drop itself
(no PostgREST `GET` drop reached a client in 23 h). The wrapper's entire marginal value is
replaying the POST/PATCH category, which is precisely the one carrying the double-write risk.

## Revised acceptance (2026-08-01, Phase 6)

The charter's acceptance criterion — "cause established by a **configuration change** with a
before/after measurement on the SAME 40-run matrix as C10X-32" — was recorded as unsatisfiable as
written the moment research found no supported surface exposes either timeout. This is what was
delivered against it instead, and where each half stops.

**The lever taken, and its standing.** Not a configuration change: an **unsupported**
post-`supabase start` recreation of the Kong container carrying one extra environment variable,
`KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0` — Kong then keeps no idle upstream socket it can lose. It is
written the way this repo writes gates (a pure half, `scripts/kong-keepalive.ts`, asserted by 18
cases in `tests/lib/kong-keepalive.test.ts`; an I/O half, `scripts/disable-kong-keepalive.ts`, that
refuses to report success on anything it did not verify and attempts one lever-less restore if it
fails after `docker rm -f`). Adoption is read back from Kong's own settings dump,
`/usr/local/kong/.kong_env`, so "did Kong take it?" is a one-line check rather than an argument.
Wired into `npm run db:start`, available standalone as `npm run db:kong`.

**Per-machine and wiped by every `npx supabase stop`.** A developer on a bare `npx supabase start`
is back on the flaky configuration. That is why point (3) of the research findings above — "narrow
or delete the wrapper" — is **not** delivered and must not be: `tests/setup/retry-transport.ts`
stays, unchanged in predicate and in its 8 cases, as the belt that survives.

**CI carries the step by an explicit parity decision, against research's own finding.** Research
measured CI as structurally immune (10-13 s suite, cold pool, one invocation per run; 52 runs, 0
unexplained reds) and concluded "nothing should be added to `.github/workflows/ci.yml` for this".
The step was added anyway, for configuration parity, and made **advisory** rather than
release-blocking (`continue-on-error: true`) precisely because the honest reason is cosmetic: the
`ci` job is what `drift` and `deploy` declare in `needs:`, so an unsupported `docker` operation
breaking on a CLI upgrade must not stop a release. Consequence to carry: a green `ci` job no longer
implies this step passed — read the step's own conclusion. It is the first thing to drop if it goes
red.

**The Phase 5 verdict — the flake is removed on this machine.** The oracle is the one the charter
demanded, Kong's own log rather than a green suite: `0` drops across **40** spaced full-suite runs
with pooling disabled, against **20** drops across **23** spaced runs over two independent
stock-pool controls, same day, same machine, same suite, same oracle, same 35 s spacing. The suite
was green through all 20 control drops, which reproduces C10X-32's signature exactly and is why the
colour was never the oracle. Not recorded as inconclusive: that branch was reserved for a control
that failed to reproduce, and both controls reproduced on their first attempt. Three caveats are
recorded rather than smoothed over — the 40-run matrix ran in four chunks (the extra gaps are
*longer* than 35 s, i.e. they move toward the condition the flake needs), Docker Desktop died
mid-control and voided three runs, and the two controls' rates differ by nearly **sevenfold**
(1.38/run vs 0.20/run), so no single number here is *the* rate.

**Point (2) widened from two seams to six, by experiment rather than by reading.** The census
forced every local non-`GET` request to replay once and asked the suite which assertion notices:
six silent seams (research's four confirmed, `seedGenerationSession` confirmed as plan-review F8
predicted, `createCard` in `study.test.ts` a genuine addition), with 23 of 29 files noticing
nothing. All six now carry a case-scoped count of one, each proved falsifiable before it existed,
and the re-run census reports **zero**. The suite count does not move — the oracles sit inside
existing helpers.

**Two criteria were open by decision, not by omission**: 2.3 and 2.5 (a pushed CI run and its log).
`ci.yml` triggers only on push to `main` and on `pull_request` to `main`, so a feature-branch push
runs nothing; they were read off the PR's `ci` job at `/ship`. **Both closed 2026-08-01** — CI run
`30710530839`, PR #22, head `69b82db`: the log shows `pool_size` 60 → 0 on the container the
preceding step started, and `npm test` passed afterwards against it. The step's own **conclusion**
is not the oracle and the earlier wording here was wrong to imply it could be: `continue-on-error:
true` makes GitHub report a failed step's `conclusion` as `success`.

The Jira side turned out to be **already done** when `/jira-finish-work` RUN 1 read it, against
what this file and `verification.md` predicted: the summary carries the retitled wording, not
"usunąć przyczynę", and `Change ID` (`customfield_10041`) is set. `jira-map.md`'s "map side only"
note is stale in the same direction.

Full evidence: `verification.md` in this folder.
