import { describe, expect, it } from "vitest";
import { AUTH_MESSAGES, AUTH_NETWORK_MESSAGE, AUTH_UNAVAILABLE_MESSAGE, type AuthErrorLike } from "@/lib/auth-errors";
import { authGuardLanding, classifyAuthError, type AuthCheckOutcome } from "@/lib/auth-outcome";

// The truth table for `src/middleware.ts`'s session check (C10X-52).
//
// WHY A TRUTH TABLE AND NOT A MIDDLEWARE TEST: both failure states are unreachable from this
// suite. `tests/middleware.test.ts` drives the REAL `createClient` and the REAL `getUser` against
// a real, healthy local stack, so there is no seam to fail GoTrue through; and `unconfigured`
// needs `createClient()` to return `null`, which under Vitest means doubling `astro:env/server`
// (inlined at transform time), the one thing test-plan §6.9 confines to a single file. So the
// decision was extracted (`@/lib/auth-outcome`) and every branch is asserted here on a fabricated
// argument, on every `npm test`.
//
// WHAT THIS FILE THEREFORE DOES NOT PROVE: that the middleware CONSULTS the classifier, or that
// either failure branch is reachable in production. `tests/middleware.test.ts`'s 23 cases are the
// regression proof that the signed-out path is unchanged — they say nothing about the new one —
// and one recorded manual run against a dead Supabase port owns the wiring. Nothing bridges the
// two, and no test in this project can.
//
// EVERY INPUT BELOW IS FABRICATED. Nothing here imports auth-js, constructs a real error, or
// touches a stack. The `name` / `code` / `status` triples come from reading the installed
// @supabase/auth-js 2.105.3 — see the module header for the three that are counter-intuitive.

/** One taxonomy row: the failure as it arrives, and what the guard must conclude from it. */
interface Row {
  label: string;
  error: AuthErrorLike | null | undefined;
  kind: "no-session" | "unavailable";
  message: string | null;
}

// The four shapes below are BYTE-IDENTICAL as they reach the classifier, and listing them
// separately is the point rather than duplication: four distinct real-world conditions collapse
// onto one class, so a future reader can see that the module is not failing to tell them apart —
// there is nothing in the value left to tell apart. `AuthSessionMissingError` takes no arguments
// at all (`lib/errors.js:100-104`), which is also why its 400 is fabricated rather than observed.
const SESSION_MISSING: AuthErrorLike = { name: "AuthSessionMissingError", status: 400 };

const ROWS: readonly Row[] = [
  // (a) The ordinary anonymous visitor — and the row that decides the whole design. This error is
  // returned BEFORE any network call (`GoTrueClient.js:2493-2494`), so a plain `if (error)` in the
  // guard would banner every visitor to `/`, `/auth/signin` and `/auth/signup`.
  { label: "a — no cookie at all", error: SESSION_MISSING, kind: "no-session", message: null },
  { label: "b1 — a corrupt, undecodable cookie", error: SESSION_MISSING, kind: "no-session", message: null },
  {
    label: "b2 — a cookie that parses but is not a session",
    error: SESSION_MISSING,
    kind: "no-session",
    message: null,
  },
  // (b3) An ORDINARILY EXPIRED session whose refresh was rejected. Not the missing-session class —
  // keying on that class alone would banner a user whose session merely lapsed, i.e. this ticket's
  // own defect one class over.
  {
    label: "b3 — an expired session whose refresh was rejected",
    error: { name: "AuthApiError", code: "validation_failed", status: 400 },
    kind: "no-session",
    message: null,
  },
  // (c) The DOMINANT outage class: a `fetch` that never reached GoTrue. Status 0 is a real
  // reading, not an absent one.
  {
    label: "c — GoTrue unreachable, no response at all",
    error: { name: "AuthRetryableFetchError", status: 0 },
    kind: "unavailable",
    message: AUTH_NETWORK_MESSAGE,
  },
  // (d) A plain 500 is NOT retryable upstream — `NETWORK_ERROR_CODES` (`lib/fetch.js:22`) omits it
  // — so it arrives as an ordinary `AuthApiError` and only the status rule catches it. This is the
  // single most likely server-side failure, and the row a name-only discriminator would miss.
  {
    label: "d — GoTrue answers 500",
    error: { name: "AuthApiError", code: "unexpected_failure", status: 500 },
    kind: "unavailable",
    message: AUTH_NETWORK_MESSAGE,
  },
  {
    label: "d' — GoTrue answers 503, which auth-js does class as retryable",
    error: { name: "AuthRetryableFetchError", status: 503 },
    kind: "unavailable",
    message: AUTH_NETWORK_MESSAGE,
  },
  {
    label: "e — GoTrue rate-limits the request",
    error: { name: "AuthApiError", code: "over_request_rate_limit", status: 429 },
    kind: "unavailable",
    message: AUTH_NETWORK_MESSAGE,
  },
  // (f1) A REVOKED session whose token still verifies. GoTrue answers this with
  // `code: "session_not_found"`, and `_handleRequest` converts THAT code into
  // `new AuthSessionMissingError()` before any `AuthApiError` is built (`lib/fetch.js:66-70`) —
  // a constructor taking no arguments, so the server's status is discarded and the value arrives
  // reading 400 whatever was sent. That is why `status` is not a usable discriminator on this
  // class, and why the fixture below carries 400 rather than the status GoTrue answered with.
  { label: "f1 — a revoked session with a valid signature", error: SESSION_MISSING, kind: "no-session", message: null },
  // (f2) A tampered or garbage token: a 403 that must NOT read as an outage.
  {
    label: "f2 — a tampered token",
    error: { name: "AuthApiError", code: "bad_jwt", status: 403 },
    kind: "no-session",
    message: null,
  },
];

describe("classifyAuthError — one row per failure the guard can meet", () => {
  it.each(ROWS)("classifies $label as $kind", ({ error, kind, message }) => {
    expect(classifyAuthError(error)).toBe(kind);
    // The message is asserted in the same case rather than in a separate describe, so a row that
    // classifies correctly and lands the wrong copy cannot pass half of this file.
    expect(authGuardLanding({ kind: classifyAuthError(error) }).message).toBe(message);
  });
});

describe("classifyAuthError — the safe default", () => {
  // Nothing in the taxonomy returns `error: null`, so neither of these is an observed state. They
  // are here because the function is TOTAL and the direction it is total in is a decision: no
  // user and no error is, as far as anything can tell, no session.
  it.each([
    { label: "null", error: null },
    { label: "undefined", error: undefined },
  ])("reads $label as no-session", ({ error }) => {
    expect(classifyAuthError(error)).toBe("no-session");
  });

  // `error-codes.d.ts` opens with its own warning that the server may return codes absent from the
  // union — so an unrecognised code is an ordinary event, not a corrupt one. It falls to
  // `no-session` because a wrong `unavailable` tells a visitor who is simply signed out that the
  // backend is down, which is this ticket's defect inverted; a wrong `no-session` only degrades to
  // the message that shipped before the fix. Of the two, one is a regression.
  it("reads an unrecognised AuthApiError code as no-session", () => {
    expect(classifyAuthError({ name: "AuthApiError", code: "some_code_shipped_after_this_line", status: 400 })).toBe(
      "no-session",
    );
  });

  // THE DIVISION OF LABOUR, and the reason this row asserts `no-session` rather than the outage.
  // A shapeless value has exactly one producer in production — a THROWN non-`AuthError`, which
  // `_getUser` rethrows (`GoTrueClient.js:2513`) — and that value never reaches this function:
  // `src/middleware.ts`'s `catch` constructs `{ kind: "unavailable" }` itself, the same split
  // `signout.ts:62` draws one route over. Routing the throw through here instead would force one
  // `default` arm to answer in two opposite directions, and the direction it got wrong would ship
  // this ticket's own defect inverted. Do not read this row as the bug.
  it.each([
    { label: "an empty object", error: {} },
    { label: "an object carrying nothing the classifier reads", error: { foo: "bar" } as AuthErrorLike },
  ])("reads $label as no-session, because a throw does not come through here", ({ error }) => {
    expect(classifyAuthError(error)).toBe("no-session");
  });

  // A status BELOW the server-error floor and outside the rate limit must not be read as an
  // outage, or every 4xx GoTrue can invent becomes a banner. This is the boundary the `>= 500`
  // rule is stated against.
  it("does not read an unrecognised 4xx as an outage", () => {
    expect(classifyAuthError({ name: "AuthApiError", status: 418 })).toBe("no-session");
  });
});

describe("authGuardLanding — the invariants", () => {
  const OUTCOMES: readonly AuthCheckOutcome[] = [
    { kind: "no-session" },
    { kind: "unavailable" },
    { kind: "unconfigured" },
  ];

  // POSITIVE CONTROL over the whole set. Without it, a classifier that returned one constant — or
  // a landing that answered `null` for everything — satisfies most of this file and reads as
  // perfect protection. Both halves are needed: the first proves the classification is a decision
  // rather than a constant, the second that the copy is a decision rather than silence.
  it("makes more than one decision, and says something on more than one of them", () => {
    const classifications = new Set(ROWS.map(({ error }) => classifyAuthError(error)));
    const messages = new Set(OUTCOMES.map((outcome) => authGuardLanding(outcome).message));

    expect(classifications.size).toBe(2);
    expect(messages.size).toBe(3);
  });

  // Membership by EQUALITY, which is what `ownedAuthMessage` on `/auth/signin` demands: a message
  // that is not literally a member of the closed set is rejected there and renders as NO BANNER.
  // So a constant that drifts out of `AUTH_MESSAGES` does not degrade to hedged copy — it degrades
  // to the original defect, a bounced user with nothing on screen.
  it("emits only messages the sign-in page will vouch for", () => {
    for (const outcome of OUTCOMES) {
      const { message } = authGuardLanding(outcome);
      if (message !== null) expect(AUTH_MESSAGES).toContain(message);
    }
  });

  // The two failure branches answer through the SAME two representations in the middleware and
  // must NOT share a message. They mean different things to the reader — "this deployment has no
  // auth service configured" versus "we could not reach the one it has" — and collapsing them is
  // the cheap tidy-up this case exists to redden.
  it("keeps the two failure branches distinguishable", () => {
    expect(authGuardLanding({ kind: "unavailable" }).message).toBe(AUTH_NETWORK_MESSAGE);
    expect(authGuardLanding({ kind: "unconfigured" }).message).toBe(AUTH_UNAVAILABLE_MESSAGE);
    expect(authGuardLanding({ kind: "unavailable" }).message).not.toBe(
      authGuardLanding({ kind: "unconfigured" }).message,
    );
  });

  // The anonymous visitor's whole experience, asserted as its own claim. `null` is what "say
  // nothing" is spelled as at the far end (`ownedAuthMessage` renders nothing for a falsy value),
  // and it is what keeps a signed-out visitor's redirect byte-identical to before this change.
  // This is the case that reddens if someone "helpfully" gives the ordinary branch a message.
  it("says nothing at all when there is simply no session", () => {
    expect(authGuardLanding({ kind: "no-session" }).message).toBeNull();
  });
});
