import { describe, expect, it } from "vitest";
import type { AstroCookies } from "astro";
import { createClient } from "@/lib/supabase";
import { SUPABASE_URL } from "astro:env/server";

// Proves the runner itself works — @/ alias resolution, astro:env/server availability, and
// that preflight let the run start — before any test depends on it. Phase 1 is verifiable
// on its own because of this file.

/** Minimal AstroCookies stand-in: createClient only ever calls `set` on the write path. */
function cookieStub(): AstroCookies {
  return { set: () => undefined } as unknown as AstroCookies;
}

describe("test harness wiring", () => {
  it("resolves the @/ alias and astro:env/server", () => {
    expect(SUPABASE_URL).toBeTruthy();
    expect(createClient).toBeTypeOf("function");
  });

  it("builds a non-null Supabase client from a request headers/cookies pair", () => {
    const client = createClient(new Headers(), cookieStub());

    // Null here means the env never reached the app's own factory — the exact silent
    // degradation preflight exists to prevent. Assert it explicitly rather than trusting it.
    expect(client).not.toBeNull();
    expect(client?.auth).toBeDefined();
  });
});
