# Follow-up: prove the audit-failure capture actually reaches Sentry

> **Dated note, 2026-08-14 (C10X-51) — this follow-up is still OPEN and its subject just got
> wider; nothing below is rewritten.** Two pointer corrections and one scope fact. The guard named
> here as `tests/lib/audit-failure-wiring.test.ts` is now **`tests/lib/sentry-capture-wiring.test.ts`**
> — renamed and generalised from one hardcoded handler into registered targets plus a catch-all
> over all of `src/`. And there are now **two** first-party capture sites, not one:
> `src/pages/api/generate.ts` and `src/pages/api/auth/signout.ts`. Everything this document says
> about DELIVERY holds for both and is unchanged by either — no DSN is configured under the test
> runner or under `npm run dev`, `/api/shipprobe` is gone, and no layer in this project asserts
> that an event is emitted, sampled, transported or delivered. C10X-51 added a capture; it added no
> evidence of arrival, and deliberately claimed none.

> Raised by **C10X-50** (`bug-generation-failed-audit-swallowed`), Phase 5. **To be ticketed via
> `/jira-backlog-sync`** — no ticket is created by this change, deliberately, the same idiom
> C10X-31's deferred `workflow_dispatch` leg used.

## What is unproven

That the first-party, route-level `Sentry.captureException` this change adds to
`src/pages/api/generate.ts` (both failure sites of the `failed`-audit-row insert) ever arrives as
an **event in the Sentry UI**.

Everything short of that is proven. `tests/lib/audit-failure-report.test.ts` truth-tables the
privacy property of the report the capture carries; `tests/lib/audit-failure-wiring.test.ts`
proves — per statement, falsifiably — that exactly two lines call `Sentry.captureException`, that
both delegate to the builder on the same line, that the first argument is always a synthetic
`Error` and never the raw `PostgrestError`, and that no capture statement mentions a content
field. Two manual DCL runs (`verification.md` §Phase 4) proved both branches are reached in
production and answer with the new body. None of that is delivery. This project's own standard —
stated in `src/worker.ts` and set by C10X-53 — is that only an event **arriving in the Sentry UI**
proves monitoring; a green suite, a green deploy, or a correctly-composed call proves nothing
about whether the SDK's transport ever fires.

## Why it is not proven here

- **No layer in this project loads a Worker with a real DSN.** `npm test` runs under Node, not
  `workerd`; `npm run dev`'s `astro dev` process never loads `src/worker.ts` at all — confirmed
  during Phase 4's manual runs, where `Sentry.captureException` ran as a no-op with no client
  configured on every provoked request.
- **The capture only fires when a real `generation_session` insert fails**, which needs a
  production DCL change (or the local-stack revoke this change already used, which still has no
  DSN attached) — it is not provokable by editing code or fixtures alone.
- **`/api/shipprobe` is gone.** It was the one instrument in this project that ever showed a
  first-party error reaching the Sentry UI (C10X-53's ship, then C10X-54 deleted it deliberately
  once monitoring was confirmed — see `roadmap.md` H-14/H-15 and
  `context/archive/2026-08-12-remove-sentry-probe/`). There is currently no route anywhere in this
  project whose only job is "throw, so a human can watch the event arrive."

## The two routes that would close it

1. **A temporary DSN pointed at a local sink, during a Phase-4-style manual run.** Point
   `SENTRY_DSN` at a throwaway Sentry project (or a local event catcher) in `.env`, run
   `npm run dev` (not `astro dev` directly — the Worker entry must actually load), repeat one of
   Phase 4's two DCL-revoke runs, and confirm the event lands with the expected tags
   (`site`, `status`, `language`, `code`) and no content fields. Cheapest route; proves the SDK
   fires locally but not that production's real DSN and Cloudflare's `workerd` runtime behave the
   same way.
2. **A deliberate provocation on a deployed Worker**, following the procedure in
   `context/archive/2026-08-11-sentry-monitoring/deploy-runbook.md` (the same runbook H-14's ship
   used to confirm monitoring generally). Revoke `INSERT` on `generation_session` for
   `authenticated` on the **production** database, trigger one real generation failure through the
   deployed app, confirm the event in the Sentry UI, then restore the grant and verify with the
   same oracles Phase 4 used locally (`information_schema` projection, raw `pg_class.relacl`,
   `has_table_privilege`). Strongest evidence — proves delivery on the real DSN and the real
   runtime — and the only one of the two that actually answers this change's own D-05 boundary.
   Costs a genuine production DCL change and a real Sentry event, so it should be scheduled
   deliberately rather than run casually.

## Pointers

- The capture sites: `src/pages/api/generate.ts` (the two `if (auditError)` branches)
- The report builder and its privacy truth table: `src/lib/audit-failure-report.ts`,
  `tests/lib/audit-failure-report.test.ts`
- The wiring guard: `tests/lib/audit-failure-wiring.test.ts`
- The sampling decision this capture rides through unsampled: `src/lib/sentry-sampling.ts`
  (`sampleSentryEvent`'s fail-open branch for `logger !== "console"`)
- The standard this follow-up exists to satisfy: `src/worker.ts`'s own comment, and
  `context/archive/2026-08-11-sentry-monitoring/deploy-runbook.md`
- Evidence that both branches are reached in production, without a DSN: this change's
  `verification.md` §Phase 4
