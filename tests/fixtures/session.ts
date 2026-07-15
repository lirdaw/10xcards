import { createServerClient, serializeCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";
import { createClient } from "@/lib/supabase";

// Turns a signed-in session into a `Cookie` header that the app's own createClient()
// accepts — without encoding @supabase/ssr's internal serialization into our tests.
//
// The session cookie format is NOT a public contract: the name is derived from the
// SUPABASE_URL hostname (http://127.0.0.1:54321 -> `sb-127-auth-token`, localhost -> a
// different name) and the value is "base64-" + base64url(JSON). Worse, the read path
// swallows a malformed value with a console.warn and treats the session as ABSENT — so a
// hand-rolled cookie that drifts from the library would surface as a mysteriously
// logged-out test, never as an error. Hence: let the library emit the cookies via setAll
// and only ever replay what it gave us.

export interface CapturedSession {
  userId: string;
  /** Ready to hang on a test Request's `Cookie` header. */
  cookieHeader: string;
}

function requireEnv(): { url: string; key: string } {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_KEY are unset — preflight should have stopped this run.");
  }
  return { url: SUPABASE_URL, key: SUPABASE_KEY };
}

/**
 * Signs in on a throwaway server client whose only job is to hand us its cookies.
 *
 * `getAll` returns [] (no prior session to read) and `setAll` collects whatever the
 * library decides to write — name, value encoding, and chunking all come out correct by
 * construction. Serializing back through the library's own serializeCookieHeader keeps
 * the header symmetric with the parseCookieHeader the app reads it with.
 */
export async function signInAndCaptureCookies(email: string, password: string): Promise<CapturedSession> {
  const { url, key } = requireEnv();
  const captured: { name: string; value: string }[] = [];

  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => [],
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) captured.push({ name, value });
      },
    },
  });

  // On the no-error branch supabase-js narrows data.user to a real User, so there is
  // nothing further to null-check here.
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);

  // setAll fires only when storage actually changed. If sign-in ever short-circuits, we
  // would silently hand back an empty header and every test would run signed-OUT — which
  // reads exactly like perfect isolation. Fail here instead.
  if (captured.length === 0) {
    throw new Error(`Sign-in for ${email} emitted no cookies — setAll never fired, so the session cannot be replayed.`);
  }

  return {
    userId: data.user.id,
    cookieHeader: captured.map(({ name, value }) => serializeCookieHeader(name, value)).join("; "),
  };
}

/** Minimal AstroCookies stand-in: createClient only ever calls `set`, on the write path. */
function cookieStub(): AstroCookies {
  return { set: () => undefined } as unknown as AstroCookies;
}

/**
 * The app's own Supabase client, bound to an account's captured session.
 *
 * Used by tests to read rows back as that account. This is the real factory from
 * src/lib/supabase.ts, so a read through it is RLS-scoped exactly as the app is.
 */
export function clientFor(cookieHeader: string) {
  const client = createClient(new Headers({ Cookie: cookieHeader }), cookieStub());
  if (!client) throw new Error("createClient returned null — the Supabase env is unset.");
  return client;
}
