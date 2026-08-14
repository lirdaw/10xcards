import { describe, expect, it } from "vitest";
import * as SignOut from "@/pages/api/auth/signout";
import { provision } from "../fixtures/accounts";
import { callEndpoint, stagedCookies } from "../fixtures/endpoint";
import { clientFor } from "../fixtures/session";

// The real `POST /api/auth/signout`, on the ONE branch this runner can reach (C10X-51).
//
// Before this file the route had no test of any kind: one grep over all of `tests/` returned a
// single hit for sign-out, and it was `tests/e2e/setup/auth.setup.ts` asserting that the
// "Wyloguj" button EXISTS. Nothing drove the route, which is how both swallow points survived.
//
// WHAT THIS FILE DOES NOT COVER, and neither is an omission:
//
//   - `unconfigured` — needs `createClient()` to return `null`, i.e. `SUPABASE_URL`/`KEY`
//     absent. Under Vitest those are transform-time inlined literals from `astro:env/server`,
//     so provoking it means doubling that module, which test-plan §6.9 confines to one file and
//     admits only for a claim unreachable ANY other way. This one is reachable two other ways:
//     the truth table in `tests/lib/signout-outcome.test.ts` and the recorded manual run.
//   - `failed` — needs GoTrue's `/logout` to fail, and the preflight guarantees a healthy LOCAL
//     stack. Same two covers.
//
// So the split is: the suite owns the decision (fabricated inputs, every branch) and this one
// success path (real route, real GoTrue, real cookie); one recorded manual run owns the failure
// branch reaching a browser. Nothing bridges the two, and no test in this project can.
//
// WHY THIS FILE MINTS ITS OWN ACCOUNT — invisible from the body below, so it is stated here.
// `signOut()`'s default scope is `global` (`GoTrueClient.js:3173`), and measured against this
// stack (2026-08-14) that kills the ACCESS token immediately, not just the refresh token:
// `GET /auth/v1/user` with the captured token went 200 → 403 and the captured Cookie header
// stopped resolving a user, while a control account signed in through the identical code path
// stayed 200 throughout. `accountA`/`accountB` are provisioned ONCE PER RUN and shared by every
// file in parallel (`tests/fixtures/accounts.ts`), so signing either of them out here would
// invalidate that shared `cookieHeader` mid-run — surfacing as unrelated cross-file flakiness in
// whatever happened to be running, never as this test. The account is minted INSIDE the `it()`
// that consumes it, because the session is the fixture being mutated (test-plan §6.2 / C10X-32),
// and because a per-run one would cap this file at a single session-consuming case forever.

const suffix = Date.now().toString(36);

describe("POST /api/auth/signout", () => {
  it("signs the caller out, clears the session cookie, and lands on the guest page", async () => {
    const account = await provision("signout", suffix);

    // POSITIVE CONTROL, and it is load-bearing rather than ceremony: the assertion this case
    // ends on is that the cookie NO LONGER resolves a user, and "never resolved one" satisfies
    // that just as well. A provision that silently handed back an empty header — the failure
    // `session.ts` describes, where a malformed cookie is swallowed and read as "no session" —
    // would make the whole case pass over a sign-out that did nothing at all.
    const before = await clientFor(account.cookieHeader).auth.getUser();
    expect(before.data.user?.id).toBe(account.userId);

    const response = await callEndpoint(SignOut, { url: "/api/auth/signout", as: account });

    // `/` and nothing else. A refusal on this route is also a 302 (test-plan §6.10), so the
    // status alone separates nothing — the whole claim is in the target, and an `?error=` on it
    // would mean the route took a failure branch. Asserted by EQUALITY for that reason.
    //
    // BREAKAGE RUN, 2026-08-14 (`signOut()` replaced by `const error = null`, so the route
    // redirects without ever calling GoTrue): 1 of 1 red on `expected 0 to be greater than 0` at
    // the staged-cookie assertion below — while THESE TWO assertions stayed green. That is the
    // §6.10 shape measured rather than quoted: the redirect is identical whether or not anything
    // was signed out, so the two oracles below are the whole test and this pair is scaffolding.
    // Route restored and the restore verified by md5 (5f6b0700e9053335a3b22c4a9f84e05c).
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");

    // What the route actually controls on the wire. `signOut()` clears the session through the
    // same `setAll` the app writes cookies with, so a successful call stages an EXPIRING cookie —
    // the browser-side half of the sign-out, and the half a `getUser()` check cannot see.
    //
    // Read through `stagedCookies`, never `response.headers.getSetCookie()`: the Container API
    // does not run the app/adapter layer that materialises Astro's carried cookies into real
    // headers, so `getSetCookie()` is [] here on a route that staged one perfectly well
    // (measured 2026-08-14 — that read is why this assertion first went red). Matched on the
    // `sb-` prefix rather than the full name, which `@supabase/ssr` derives from the
    // SUPABASE_URL hostname (lessons.md): pinning it would couple this to a port.
    const cleared = stagedCookies(response).filter((cookie) => cookie.startsWith("sb-"));
    expect(cleared.length).toBeGreaterThan(0);
    for (const cookie of cleared) expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);

    // And the server side of the same fact, which is the one that matters on a shared computer:
    // the session the caller arrived with is gone, so replaying that exact Cookie header through
    // the app's own RLS-scoped client resolves nobody. This is assertable only because the
    // measurement above found the access token dies with the session; under the opposite
    // behaviour (refresh revoked, access token valid until expiry) it would fail here.
    const after = await clientFor(account.cookieHeader).auth.getUser();
    expect(after.data.user).toBeNull();
  });
});
