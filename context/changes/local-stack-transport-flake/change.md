---
change_id: local-stack-transport-flake
title: Make the retried-write seams loud
status: preparing
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

**Also worth carrying**: Kong ships no `proxy_next_upstream` directive, so nginx's default applies
and non-idempotent methods are never retried — Kong already absorbs every idempotent drop itself
(no PostgREST `GET` drop reached a client in 23 h). The wrapper's entire marginal value is
replaying the POST/PATCH category, which is precisely the one carrying the double-write risk.
