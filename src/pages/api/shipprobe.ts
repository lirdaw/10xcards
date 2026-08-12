import type { APIRoute } from "astro";

/**
 * Deliberate error probe — the ONE route in this app that throws on purpose.
 *
 * Why it exists. This is a learning project, and production monitoring has a property that makes
 * it uniquely hard to trust: a missing or corrupted `SENTRY_DSN` is SILENT (see `src/worker.ts`),
 * so a green deploy proves nothing. Every other route answers its failures with owned copy — the
 * app deliberately has no route that throws — which means that WITHOUT this file there is no way
 * to provoke a first-party error on production at all. The only provocation available otherwise
 * is a dependency warning, and that class is sampled to ~10 %, so a single request is a coin flip.
 * `GET /api/shipprobe` throws, lands in the UNSAMPLED class, and therefore gives a 1-request,
 * 1-event proof that monitoring is alive on the deployed Worker.
 *
 * It is PUBLIC and UNGUARDED, and that is a decision taken with the cost stated rather than an
 * oversight (2026-08-12, during the C10X-53 ship). The cost: anyone can call it, each call is one
 * unsampled event, and a loop against it would exhaust the Sentry quota — which is self-masking,
 * because past the cap UNRELATED errors stop arriving and nothing announces it. Guarding it behind
 * `PROTECTED_ROUTES` was offered and declined in favour of being able to `curl` production without
 * a session. If quota noise ever appears, that guard is the one-line fix.
 *
 * THIS FILE IS TEMPORARY AND OWNED BY ROADMAP H-15. It ships to production on purpose so the prod
 * sanity step of `deploy-runbook.md` can be repeated on demand; it is meant to be removed once
 * monitoring has been verified there and nobody needs to re-verify it.
 */
export const GET: APIRoute = () => {
  throw new Error("C10X-53 deliberate probe: this error is expected and proves Sentry is alive");
};
