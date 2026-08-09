// The one stable, dedicated account the e2e layer signs in as — and the only credential the
// harness carries.
//
// WHY ONE STABLE ACCOUNT AND NOT PER-RUN ONES (change.md D-01, decided 2026-08-08). The harness
// enters on `storageState`, so before this file existed it issued ZERO auth requests per run —
// test-plan.md §3 Phase 6 records that as harness risk 6 "LIVE, and INVERTED on the rate-limit
// axis". Per-run accounts would re-introduce the 30-sign-ins / 5-min / IP exposure
// (`supabase/config.toml:190`) AND add a user row per run on top of the rows, on a dev database
// already holding 487 users. A setup project signing in once keeps the cheap side of that
// inversion: two auth requests per run here, one more in the teardown.
//
// THE ACCEPTED PRICE, stated where a spec author meets it: **the account carries state between
// runs, so no spec may assume an empty starting deck list.** Accumulation is answered by the
// teardown project (`tests/e2e/teardown/cleanup.teardown.ts`), never by throwing the account away.
//
// THE PASSWORD IS NOT A SECRET, for the same reason `tests/fixtures/accounts.ts:34` hardcodes
// `harness-passw0rd`: the config-time preflight (`env.ts`) refuses any non-local `SUPABASE_URL`
// before a server is even started, so this credential can only ever exist on a local stack that
// `npx supabase stop` discards.
//
// WHAT THIS FILE MUST NOT IMPORT. `tests/fixtures/session.ts` and `src/lib/supabase.ts` both
// import `astro:env/server`, which a plain Node loader rejects (`ERR_UNSUPPORTED_ESM_URL_SCHEME`,
// measured) — Playwright resolves `tsconfig` paths but not Astro's virtual modules. So the URL and
// key arrive as PARAMETERS, from the values `resolveE2eEnv()` has already asserted, rather than
// being re-read here from an unasserted source.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAlreadyRegistered } from "../../setup/env-assertions.ts";
import type { Database } from "@/db/database.types";

export const E2E_EMAIL = "e2e-harness@example.com";
export const E2E_PASSWORD = "e2e-harness-passw0rd";

// The path the session is written to is `AUTH_STATE_FILE` and it lives in `env.ts`, NOT here:
// `playwright.config.ts` is its other reader, and env.ts is the only module that config already
// imports — so single-sourcing it there costs no new dependency at config-module evaluation,
// where this file's `@supabase/supabase-js` import has no business being.

/**
 * A throwaway anon client. `persistSession: false` keeps it from caching anything to disk — the
 * only session artifact this harness owns is the one the BROWSER writes, and a second cached copy
 * would be a second thing to keep in step.
 */
function anonClient(url: string, key: string): SupabaseClient<Database> {
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Make the account exist. Idempotent: on every run after the first, signUp answers
 * `user_already_exists` and that is the expected path, not an error.
 *
 * `enable_signup = true` and `enable_confirmations = false` locally (`supabase/config.toml`), so
 * no email round-trip is involved. Same shape as `tests/fixtures/accounts.ts:55-61`.
 */
export async function ensureE2eAccount(url: string, key: string): Promise<void> {
  const { error } = await anonClient(url, key).auth.signUp({ email: E2E_EMAIL, password: E2E_PASSWORD });
  if (error && !isAlreadyRegistered(error)) {
    throw new Error(`Could not create the e2e account ${E2E_EMAIL}: ${error.message}`);
  }
}

/**
 * A client signed in AS the e2e account, for work that needs the database rather than a browser —
 * i.e. the teardown.
 *
 * RLS-scoped by construction: this is the anon key acting as the account that owns the rows. No
 * service/secret key ever enters this repo, and `assertAnonKey` refuses one at config time — RLS
 * is the only lock in this app, so a teardown holding a BYPASSRLS key could delete another
 * account's rows on a typo'd predicate.
 */
export async function signInE2eAccount(url: string, key: string): Promise<SupabaseClient<Database>> {
  const client = anonClient(url, key);
  const { error } = await client.auth.signInWithPassword({ email: E2E_EMAIL, password: E2E_PASSWORD });
  if (error) {
    throw new Error(`Could not sign the e2e account ${E2E_EMAIL} in: ${error.message}`);
  }
  return client;
}
