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
    integrations: [Sentry.captureConsoleIntegration({ levels: ["warn", "error"] })],
  }),
  handler,
);
