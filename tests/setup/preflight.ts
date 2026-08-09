import { SUPABASE_URL, SUPABASE_KEY, OPENROUTER_API_KEY } from "astro:env/server";
// Shared with the Playwright harness's config-time preflight (`tests/e2e/setup/env.ts`), which
// asserts the same two data-safety seams and could not import THIS file: the `astro:env/server`
// line above is the only thing that blocked reuse, and a plain Node loader rejects it. Copying
// the predicates instead would put the guard that decides whether a key bypasses RLS in two
// places with nothing keeping them in step — test-plan.md §6.6's "the sweep was found incomplete
// twice by reading, not by a red run". `assertMockGeneration` below deliberately did NOT move:
// it reads the Astro env, so it stays with the caller that has one.
import { assertAnonKey, assertLocal } from "./env-assertions.ts";

// Every env var in astro.config.mjs is `optional: true`, so an unset SUPABASE_URL makes
// createClient() return null rather than throw. A suite that ran anyway would report a
// green "isolation holds" against a client that never reached Postgres. This guard is
// what turns that silent degradation into a loud, actionable stop.
//
// Runs as a Vitest globalSetup: once, before any test, aborting the whole run.

const HINT = `
Fix:
  1. npm run db:start          (starts the local Supabase stack)
  2. npx supabase status       (prints Project URL + Publishable key)
  3. copy them into .env as SUPABASE_URL / SUPABASE_KEY (see .env.example)
`;

function fail(problem: string): never {
  throw new Error(`Test preflight failed: ${problem}\n${HINT}`);
}

/**
 * Reject a set OPENROUTER_API_KEY — the suite's second, easily-missed external seam.
 *
 * assertLocal closes the database seam; this closes the LLM one. `tests/generation/
 * generate.test.ts` and test-plan.md §6.5 both state "mock mode is the default because
 * OPENROUTER_API_KEY is unset" as a fact, and nothing enforced it. With the key set,
 * generateCandidates() stops short-circuiting to mockCards() (src/lib/openrouter.ts:149)
 * and the suite makes real, billed calls to openrouter.ai carrying the test source text —
 * the one non-local backend it can still reach. The counts would also stop holding
 * (they assume exactly `count` cards, which only the mock guarantees) and a live call can
 * outlive testTimeout (30 s) before SERVER_TIMEOUT_MS (40 s) even fires.
 *
 * No env opt-out, same reasoning as assertLocal: a deliberate live-generation run must
 * cost a code edit, not an env flag someone leaves set.
 */
function assertMockGeneration(): void {
  if (OPENROUTER_API_KEY) {
    fail(
      `OPENROUTER_API_KEY is set. This suite asserts card counts that only mock mode ` +
        `guarantees, and a real key makes it place billed calls to openrouter.ai. Unset it ` +
        `in .env for the test run (see .env.example).`,
    );
  }
}

async function assertReachable(url: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(new URL("/auth/v1/health", url), { signal: AbortSignal.timeout(5_000) });
  } catch (cause) {
    fail(`the Supabase stack at ${url} is unreachable (${String(cause)}).`);
  }
  if (!response.ok) {
    fail(`the Supabase stack at ${url} answered ${response.status} on /auth/v1/health.`);
  }
}

export default async function preflight(): Promise<void> {
  if (!SUPABASE_URL) fail("SUPABASE_URL is not set.");
  if (!SUPABASE_KEY) fail("SUPABASE_KEY is not set.");

  assertAnonKey(SUPABASE_KEY, fail);
  // Before reachability: never even send a request to a non-local host.
  assertLocal(SUPABASE_URL, fail);
  assertMockGeneration();
  await assertReachable(SUPABASE_URL);
}
