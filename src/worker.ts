import handler from "@astrojs/cloudflare/entrypoints/server";
import * as Sentry from "@sentry/cloudflare";
import { sampleSentryEvent } from "@/lib/sentry-sampling";

// The Worker's real entry point (`wrangler.jsonc`'s `main`), and the ONE file in `src/` that
// reads the Cloudflare `env` directly instead of `astro:env/server` — AGENTS.md carries the
// carve-out. The reason is ordering, not preference: this module wraps the adapter, so it runs
// BEFORE Astro exists. `astro:env/server` only works because the imported adapter entrypoint
// performs `setGetEnv(...)` at module scope before `createApp()`; that is also why the handler
// must be IMPORTED here rather than re-implemented. Do not extend this pattern to any other
// file under `src/`.
//
// The DSN never appears in this repo. Production: a Cloudflare secret (`wrangler secret put
// SENTRY_DSN`). Local: optionally `SENTRY_DSN=…` in the gitignored `.env` — never `.dev.vars`
// (the two are mutually exclusive in Cloudflare's local tooling). The SDK reads no
// process-level fallback on Workers, so the typed read below is the only channel.
//
// A falsy DSN is a DELIBERATE no-op, not a misconfiguration: the SDK takes its no-transport
// branch, so the same code ships to environments with and without Sentry. The cost is that a
// missing production secret is SILENT — a green deploy proves nothing about monitoring. Only an
// event arriving in the Sentry UI does; see this change's `deploy-runbook.md`.
interface WorkerEnv {
  SENTRY_DSN?: string;
}

export default Sentry.withSentry(
  (env: WorkerEnv) => ({
    dsn: env.SENTRY_DSN,
    // Errors only — no tracing, no logs product. The integration captures warn/error output
    // emitted by DEPENDENCIES (`@supabase/ssr` cookie parsing, `@supabase/auth-js` fetch
    // failures): the "in scope but unowned" boundary test-plan.md §7 records for Risk #4
    // finally gains a monitored sink. First-party code under `src/` writes no such output at
    // all and is guarded to keep it that way (`tests/lib/no-logging.test.ts`), so this captures
    // NONE of the swallowed-error audit findings (C10X-48…52) — those are dropped results, and
    // each ticket owns checking its own error.
    //
    // Dated note, 2026-08-13 (C10X-50): the sentence above stays true and precise, and it now
    // sits next to a ticket that stopped relying on it. `generate.ts` emits a first-party,
    // ROUTE-LEVEL `Sentry.captureException` on a failed `failed`-audit-row insert — the first
    // capture in this project that arrives some way other than through this console integration.
    // It carries no `logger === "console"` stamp, so `sampleSentryEvent` (below) takes its
    // fail-open branch for `logger !== "console"` and passes it UNSAMPLED, which is intended.
    // `tests/lib/audit-failure-wiring.test.ts` proves the two capture statements are present,
    // composed and leak no content field; nothing proves an event ARRIVES — the same boundary
    // C10X-54's note below already draws for `beforeSend` itself. See
    // `context/changes/bug-generation-failed-audit-swallowed/follow-ups/sentry-delivery.md`.
    integrations: [
      Sentry.captureConsoleIntegration({ levels: ["warn", "error"] }),
      // Naming this one is NOT redundant — it is the trap this line exists to close.
      // `httpServerIntegration` is a DEFAULT integration, and passing `integrations` as an ARRAY
      // merges with the defaults instead of replacing them (`getIntegrationsToSetup` in
      // `@sentry/core`), so it runs whether or not it appears here. Its default
      // `maxRequestBodySize: "medium"` attaches up to 10 000 bytes of every non-GET request body
      // to every event, gated only by method — NOT by `sendDefaultPii`, which gates cookies and
      // IP but never bodies. That body is the whole of `/api/auth/signin`'s form (`password` in
      // clear) and essentially all of `/api/generate`'s pasted `sourceText`: exactly the material
      // test-plan.md §2 Risk #4 exists to keep out of a third party. Listing the integration here
      // displaces the default instance, so `"none"` wins.
      //
      // Two boundaries, so the next reader does not over-read this. Cookies were never at risk —
      // the SDK excludes them upstream — so the Supabase session token is a separate, already
      // closed question. And URLs and query strings are still attached, so a `?q=` search term
      // does reach Sentry; that is a live decision, not an oversight.
      Sentry.httpServerIntegration({ maxRequestBodySize: "none" }),
    ],
    // The decision itself, and the reasoning behind it, live in `@/lib/sentry-sampling` — a pure
    // function over its arguments, so it can be exercised without a Worker, a DSN or a network.
    // This line owns the ONE thing that function refuses to own: the randomness. Keep the
    // delegation on a single line — `tests/lib/sentry-wiring.test.ts` asserts per LINE that the
    // line supplying `beforeSend` is the line that calls the imported function, because a file
    // that imports the helper and re-implements the decision two lines down is the exact defect
    // wearing the costume of a fix.
    //
    // Dated note, 2026-08-12 (C10X-54): the public `/api/shipprobe` route is GONE — deleted from
    // this repo and from production. It was the only way to provoke a FIRST-PARTY error on the
    // deployed Worker, so if you change the sampling, no production instrument will tell you that
    // you broke it. What holds that property now is `tests/lib/sentry-sampling.test.ts` (the truth
    // table) plus `tests/lib/sentry-wiring.test.ts` (this line). The reasoning behind the
    // discriminator itself is in `@/lib/sentry-sampling`, not restated here.
    beforeSend: (event) => sampleSentryEvent(event, Math.random()),
  }),
  handler,
);
