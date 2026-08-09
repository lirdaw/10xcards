import { expect, test as setup } from "@playwright/test";
import { resolveE2eEnv } from "./env.ts";

// The half of the e2e preflight that needs a running server, and therefore cannot live at
// config-module evaluation with the rest (see `env.ts`'s header for the ordering).
//
// PHASE 1 SCOPE — this file is deliberately incomplete. It asserts reachability and nothing
// else; the session producer that mints `playwright/.auth/user.json` through the real UI is
// Phase 3's deliverable. Until then the `chromium` project consumes a HAND-MADE artifact, which
// is the reproducibility problem this change exists to close — not a working state to build on.
//
// It exists at Phase 1 nonetheless because an empty setup project is worse than none:
// `dependencies: ["setup"]` on a project collecting ZERO tests passes trivially, so a green run
// would prove nothing about a session it never produced. Playwright's default `testMatch`
// requires `.test.` or `.spec.` in the filename, which `auth.setup.ts` does not carry — hence the
// explicit `testMatch` in `playwright.config.ts`.

setup("the local Supabase stack is reachable", async () => {
  // Re-running the config's assertions costs nothing and is idempotent; what this call is FOR is
  // the verified SUPABASE_URL, which must not be re-read from an unasserted source.
  const env = resolveE2eEnv();

  const response = await fetch(new URL("/auth/v1/health", env.SUPABASE_URL), {
    signal: AbortSignal.timeout(5_000),
  });

  // Ordered after the config's local-host assertion, never before it: preflight.ts:138's rule is
  // that no request may reach a host the harness has not already established as local.
  expect(
    response.ok,
    `the Supabase stack at ${env.SUPABASE_URL} answered ${response.status}. Run: npm run db:start`,
  ).toBe(true);
});
