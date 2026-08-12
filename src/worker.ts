import handler from "@astrojs/cloudflare/entrypoints/server";
import * as Sentry from "@sentry/cloudflare";

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

// Sampling applied ONLY to dependency-emitted warn/error events, never to real exceptions.
//
// The storm is structural rather than hypothetical: `src/middleware.ts` authenticates on EVERY
// request, so a Supabase outage makes `@supabase/auth-js` emit one error-level line per inbound
// request, site-wide. Unsampled, that is one event per request until the outage ends, and
// exhausting the plan's quota is self-masking — once the cap is hit, UNRELATED errors stop
// arriving and this project has no notification channel to say so.
//
// A blanket `sampleRate` would be the wrong instrument, because it cannot tell the storm from the
// signal: it would also drop 90% of the rare, unique, uncaught exception this monitoring exists to
// surface.
//
// **`logger === "console"` is NOT a usable discriminator here, and that was measured rather than
// reasoned (2026-08-12, during the ship).** The first version of this file sampled on exactly that
// stamp, on the premise that only dependency output arrives through the console integration. It
// does not: **Astro catches route errors and re-emits them through its own logger**, so a genuine
// first-party exception reaches Sentry stamped `logger = "console"` like any dependency warning.
// Measured against the built Worker: 21 deliberate uncaught errors thrown from a temporary route
// produced **3** events (~14 %, i.e. the 0.1 rate), each tagged `console`. Since this app has no
// route that throws PAST Astro, the unsampled branch would essentially never fire in production —
// so the old discriminator silently dropped ~90 % of real application errors, which is the exact
// opposite of what this monitoring exists to do.
//
// The discriminator is therefore the noise's own SIGNATURE, not its transport. It is deliberately
// **fail-open**: an event that cannot be positively identified as known dependency noise passes
// through untouched. The asymmetry is the point — an unrecognised event costs quota, a dropped one
// costs blindness, and only the second failure is invisible. Adding a pattern here is a decision
// to accept losing 90 % of that message, so add one only for output a dependency emits per-request.
const DEPENDENCY_NOISE = [/@supabase\/ssr/, /@supabase\/auth-js/];

// Why sampling this class loses little: the dependency conditions worth acting on PERSIST — a
// corrupt session cookie keeps firing until the cookie is overwritten, an outage lasts minutes —
// so a survivor arrives quickly. What sampling drops is the one-off, which is also the least
// actionable. Re-tune on measured volume after the first weeks in production; this value is
// reasoned, not measured, and the comment says so deliberately.
const DEPENDENCY_EVENT_SAMPLE_RATE = 0.1;

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
    // Everything that is not RECOGNISED dependency noise passes through untouched — including
    // every first-party error, which reaches here through the console integration too (see
    // DEPENDENCY_NOISE for the measurement that forced this shape). Both halves of the test are
    // required: the transport stamp alone would catch first-party errors, and the signature alone
    // would catch a first-party error that merely mentions a Supabase package by name.
    beforeSend(event) {
      if (event.logger !== "console") return event;
      const haystack = [
        typeof event.message === "string" ? event.message : "",
        ...(event.exception?.values ?? []).map((value) => `${value.type ?? ""} ${value.value ?? ""}`),
      ].join("\n");
      if (!DEPENDENCY_NOISE.some((pattern) => pattern.test(haystack))) return event;
      return Math.random() < DEPENDENCY_EVENT_SAMPLE_RATE ? event : null;
    },
  }),
  handler,
);
