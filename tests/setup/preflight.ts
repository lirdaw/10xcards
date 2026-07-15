import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

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
 * Reject any key that is not the anon/publishable key.
 *
 * A service-role key in SUPABASE_KEY silently disables every ownership guarantee in the
 * product: it is BYPASSRLS, and the app layer carries no user_id predicates to fall back
 * on (see research.md § "The Supabase layer"). The app would function normally and leak
 * every user's data, and no test could see it from the outside. init_core_schema.sql:86-89
 * forbids this in prose only — this check is what enforces it.
 *
 * Two key formats exist. The current Supabase CLI (2.98.2) issues self-describing keys
 * (`sb_publishable_` / `sb_secret_`); legacy keys are JWTs carrying a `role` claim.
 */
function assertAnonKey(key: string): void {
  if (key.startsWith("sb_")) {
    if (!key.startsWith("sb_publishable_")) {
      fail(
        `SUPABASE_KEY is a "${key.slice(0, key.indexOf("_", 3) + 1)}..." key. ` +
          `Expected the publishable (sb_publishable_) key — a secret key bypasses RLS, ` +
          `which is the only thing isolating accounts in this app.`,
      );
    }
    return;
  }

  const segments = key.split(".");
  if (segments.length !== 3) {
    fail(`SUPABASE_KEY is neither an sb_* API key nor a JWT. Got: "${key.slice(0, 12)}..."`);
  }

  // Decode only — no signature verification. This is a misconfiguration guard, not an auth check.
  let role: unknown;
  try {
    role = (JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")) as { role?: unknown }).role;
  } catch {
    fail("SUPABASE_KEY looks like a JWT but its payload could not be decoded.");
  }

  if (role !== "anon") {
    fail(
      `SUPABASE_KEY carries role "${String(role)}", expected "anon". ` +
        `A service_role key bypasses RLS, which is the only thing isolating accounts in this app.`,
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

  assertAnonKey(SUPABASE_KEY);
  await assertReachable(SUPABASE_URL);
}
