import type { TestProject } from "vitest/node";
import { provisionAccounts } from "../fixtures/accounts";

// Provisions the run's two accounts once, before any test file, and publishes them via
// provide() so every file injects the same pair instead of signing in again. Runs after
// tests/setup/preflight.ts (globalSetup files run in order), so the stack is already
// known reachable and SUPABASE_KEY already known to be the anon key.

export default async function setup(project: TestProject): Promise<void> {
  const { a, b } = await provisionAccounts();
  project.provide("accountA", a);
  project.provide("accountB", b);
}
