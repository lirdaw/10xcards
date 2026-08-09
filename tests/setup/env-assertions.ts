// The two credential predicates shared by BOTH test harnesses in this repo: Vitest's
// `tests/setup/preflight.ts` and Playwright's `tests/e2e/setup/env.ts`.
//
// They live here rather than being copied because they decide whether a key bypasses RLS and
// whether a run can reach a cloud project — the two data-safety seams lessons.md states as
// non-negotiable ("Test preflight must assert the target host is local — anon ≠ local").
// A duplicated guard is the class test-plan.md §6.6 records the cost of four times: "the sweep
// was found incomplete twice by reading, not by a red run". This repo single-sources every
// other shared rule the same way (`deck-limits.ts`, `generation-limits.ts`).
//
// Only `preflight.ts`'s `astro:env/server` import blocked reuse; the predicates themselves take
// a string and throw. `assertMockGeneration` deliberately did NOT move — it reads the Astro env,
// so it stays with the caller that has one.
//
// Each caller supplies its own `fail`, because the two harnesses need different remedies in the
// hint: `npm run db:start` for Vitest, `npx playwright install chromium` / `.dev.vars` for
// Playwright. `origin` names WHERE the offending value came from, so a refusal cannot send the
// reader to edit the innocent file (the C10X-43 `pre-push` trap: a correct exit code carrying a
// wrong diagnosis).

/** Aborts the run. Never returns — each harness frames the problem with its own hint. */
export type Fail = (problem: string) => never;

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
export function assertAnonKey(key: string, fail: Fail, origin = "SUPABASE_KEY"): void {
  if (key.startsWith("sb_")) {
    if (!key.startsWith("sb_publishable_")) {
      fail(
        `${origin} is a "${key.slice(0, key.indexOf("_", 3) + 1)}..." key. ` +
          `Expected the publishable (sb_publishable_) key — a secret key bypasses RLS, ` +
          `which is the only thing isolating accounts in this app.`,
      );
    }
    return;
  }

  const segments = key.split(".");
  const payload = segments[1];
  if (segments.length !== 3 || payload === undefined) {
    fail(`${origin} is neither an sb_* API key nor a JWT. Got: "${key.slice(0, 12)}..."`);
  }

  // Decode only — no signature verification. This is a misconfiguration guard, not an auth check.
  let role: unknown;
  try {
    role = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role?: unknown }).role;
  } catch {
    fail(`${origin} looks like a JWT but its payload could not be decoded.`);
  }

  if (role !== "anon") {
    fail(
      `${origin} carries role "${String(role)}", expected "anon". ` +
        `A service_role key bypasses RLS, which is the only thing isolating accounts in this app.`,
    );
  }
}

/**
 * Refuse to run against anything but the local stack.
 *
 * Every other check passes against a cloud project: its anon key is `sb_publishable_`, and it is
 * trivially reachable. But `.env` documents swapping the PROD_ credentials into SUPABASE_URL to
 * run dev against cloud — and in that state these harnesses would sign up real users in
 * production auth with a hardcoded password, then create and delete decks for real.
 *
 * No env opt-out, on purpose: an escape hatch in .env would reproduce exactly this hole.
 */
export function assertLocal(url: string, fail: Fail, origin = "SUPABASE_URL"): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    fail(`${origin} is not a valid URL. Got: "${url}"`);
  }

  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    fail(
      `${origin} points at "${hostname}", not the local stack. This harness signs up accounts ` +
        `and deletes rows — it must never run against a cloud project. Use the local stack ` +
        `(npm run db:start); if you swapped PROD_ credentials in, swap them back.`,
    );
  }
}

/**
 * The `@supabase/ssr` session cookie name, derived from the project URL.
 *
 * `sb-${hostname.split(".")[0]}-auth-token` — so `127.0.0.1` → `sb-127-auth-token` and
 * `localhost` → a DIFFERENT name. lessons.md records why that matters: the read side swallows a
 * cookie it cannot match with a `console.warn` and reports the session as ABSENT, so a
 * mis-pointed server presents as a locator timeout rather than as "signed out".
 */
export function sessionCookieName(url: string): string {
  const hostname = new URL(url).hostname;
  // `?? hostname` only satisfies noUncheckedIndexedAccess — String.split never yields an empty
  // array, so the fallback is unreachable rather than a second behaviour.
  return `sb-${hostname.split(".")[0] ?? hostname}-auth-token`;
}
