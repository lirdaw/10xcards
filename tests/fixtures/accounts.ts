import { inject } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";
import { signInAndCaptureCookies } from "./session";

// Two real, signed-in accounts for the whole run: A (the owner) and B (the intruder).
//
// Provisioned once by the tests/setup/accounts.ts globalSetup and handed to every test
// file through Vitest's provide/inject. Vitest isolates the module registry per test
// file, so a module-level memo here would re-sign-in for each file — and the local auth
// rate limit is 30 sign-up+sign-in requests per 5 minutes per IP (supabase/config.toml).
// Provisioning once per run keeps the whole suite at 4 auth requests per run — roughly 7 runs
// per 5 minutes before the limit bites. Ample for CI and normal work; if you are iterating hard
// and globalSetup starts failing to sign in, suspect the rate limit before the harness.
//
// Only the anon key is used. No service_role key enters this repo: it is BYPASSRLS, and
// RLS is the only thing isolating accounts in this app — a suite whose job is to prove
// isolation must not import the one credential that disables it.

export interface TestAccount {
  email: string;
  userId: string;
  /** The account's real session, ready for a Request's `Cookie` header. */
  cookieHeader: string;
}

declare module "vitest" {
  interface ProvidedContext {
    accountA: TestAccount;
    accountB: TestAccount;
  }
}

const PASSWORD = "harness-passw0rd";

/** Supabase reports a re-used email as this; every other signUp error is real. */
function isAlreadyRegistered(error: { code?: string; message: string }): boolean {
  return error.code === "user_already_exists" || /already registered/i.test(error.message);
}

async function provision(label: string, runId: string): Promise<TestAccount> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_KEY are unset — preflight should have stopped this run.");
  }

  const email = `harness-${label}-${runId}@example.com`;

  // enable_signup = true and enable_confirmations = false locally, so signUp needs no
  // email round-trip. persistSession: false keeps this throwaway client from caching a
  // session that would confuse the capture step below.
  const anon = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await anon.auth.signUp({ email, password: PASSWORD });
  // The run id makes collisions impossible in practice; tolerate one anyway so a re-used
  // id can never wedge the suite.
  if (error && !isAlreadyRegistered(error)) {
    throw new Error(`Could not create test account ${email}: ${error.message}`);
  }

  return { email, ...(await signInAndCaptureCookies(email, PASSWORD)) };
}

/**
 * Creates and signs in accounts A and B. Called once per run, from globalSetup.
 *
 * Emails carry a per-run id so a run never inherits rows a previous run left behind —
 * the local stack keeps its data between runs, and `npm test` must not need a db:reset.
 */
export async function provisionAccounts(): Promise<{ a: TestAccount; b: TestAccount }> {
  const runId = Date.now().toString(36);
  return { a: await provision("a", runId), b: await provision("b", runId) };
}

/** The owner. Its data is what every denial test must leave untouched. */
export function accountA(): TestAccount {
  return inject("accountA");
}

/** The intruder. Signed in, but authorized for nothing of A's. */
export function accountB(): TestAccount {
  return inject("accountB");
}
