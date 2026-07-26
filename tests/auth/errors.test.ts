import { describe, expect, it } from "vitest";
import * as SignIn from "@/pages/api/auth/signin";
import {
  authErrorMessage,
  AUTH_EMAIL_EXISTS_MESSAGE,
  AUTH_EMAIL_NOT_CONFIRMED_MESSAGE,
  AUTH_GENERIC_MESSAGE,
  AUTH_INVALID_CREDENTIALS_MESSAGE,
  AUTH_INVALID_EMAIL_MESSAGE,
  AUTH_MESSAGES,
  AUTH_MISSING_CREDENTIALS_MESSAGE,
  AUTH_NETWORK_MESSAGE,
  AUTH_RATE_LIMIT_MESSAGE,
  AUTH_SAME_PASSWORD_MESSAGE,
  AUTH_SESSION_MISSING_MESSAGE,
  AUTH_SIGNUP_DISABLED_MESSAGE,
  AUTH_USER_BANNED_MESSAGE,
  AUTH_VALIDATION_MESSAGE,
  AUTH_WEAK_PASSWORD_MESSAGE,
} from "@/lib/auth-errors";
import { accountA } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";

// Risk #4 (test-plan §2), the half nobody had named: `signin.ts` / `signup.ts` relayed
// `error.message` verbatim into `?error=`, so an upstream string reached the address bar —
// browser history and the Cloudflare access log. Two upstream behaviours make that a leak:
// GoTrue interpolates the submitted address into its own copy (`Email address %q is
// invalid`), and `_getErrorMessage` falls back to `JSON.stringify(err)` on an unrecognised
// body shape (@supabase/auth-js/dist/module/lib/fetch.js:5-18).
//
// The load-bearing case in this file is therefore NOT the per-code table — it is
// "no input substring survives into the output". The table exists so a mapping that
// silently collapses to the generic fallback is visible; the sentinel case is what pins
// the invariant.
//
// The mapper is pure and imports nothing, so most of this needs no database — but the
// suite's preflight/globalSetup still requires the local stack (test-plan §6.1). The one
// endpoint case at the bottom genuinely needs it: it drives the real route against real
// GoTrue and reads the redirect the browser would follow.

const suffix = Date.now().toString(36);
const SENTINEL = `leak-probe-${suffix}`;

/**
 * An error carrying a sentinel where the upstream prose would be. Built as a variable, not
 * inline, so `message` — a field `AuthErrorLike` deliberately does not declare — can be
 * present exactly as it is on a real `AuthError`.
 */
function withSentinelMessage(shape: { code?: string; name?: string; status?: number }) {
  return { ...shape, message: `Email address "${SENTINEL}@example.com" is invalid` };
}

describe("authErrorMessage — code chain", () => {
  const cases: [string, string][] = [
    ["invalid_credentials", AUTH_INVALID_CREDENTIALS_MESSAGE],
    ["email_not_confirmed", AUTH_EMAIL_NOT_CONFIRMED_MESSAGE],
    ["email_exists", AUTH_EMAIL_EXISTS_MESSAGE],
    ["user_already_exists", AUTH_EMAIL_EXISTS_MESSAGE],
    ["weak_password", AUTH_WEAK_PASSWORD_MESSAGE],
    ["same_password", AUTH_SAME_PASSWORD_MESSAGE],
    ["email_address_invalid", AUTH_INVALID_EMAIL_MESSAGE],
    ["validation_failed", AUTH_VALIDATION_MESSAGE],
    ["signup_disabled", AUTH_SIGNUP_DISABLED_MESSAGE],
    ["user_banned", AUTH_USER_BANNED_MESSAGE],
    ["over_request_rate_limit", AUTH_RATE_LIMIT_MESSAGE],
    ["over_email_send_rate_limit", AUTH_RATE_LIMIT_MESSAGE],
  ];

  it.each(cases)("maps %s to its own constant", (code, expected) => {
    // `name`/`status` are set as a real AuthApiError carries them, so this also proves the
    // code wins the chain rather than the generic 400 branch answering by accident.
    expect(authErrorMessage(withSentinelMessage({ code, name: "AuthApiError", status: 400 }))).toBe(expected);
  });

  // A message that is present but empty is a message the user cannot act on — and it is what
  // every `StringLiteral -> ""` mutant on this module produces. Asserting non-emptiness kills
  // that class without pinning a single word of the copy.
  it.each(cases)("answers %s with non-empty copy", (code) => {
    expect(authErrorMessage({ code }).length).toBeGreaterThan(0);
  });

  // The mapped classes must stay distinguishable: a user who mistyped a password and a user
  // whose account is banned must not read the same sentence. This is what a mutant that
  // repoints one key at another constant breaks.
  it("keeps the distinct code classes distinct", () => {
    const distinct = new Set([
      AUTH_INVALID_CREDENTIALS_MESSAGE,
      AUTH_EMAIL_NOT_CONFIRMED_MESSAGE,
      AUTH_EMAIL_EXISTS_MESSAGE,
      AUTH_WEAK_PASSWORD_MESSAGE,
      AUTH_SAME_PASSWORD_MESSAGE,
      AUTH_INVALID_EMAIL_MESSAGE,
      AUTH_VALIDATION_MESSAGE,
      AUTH_SIGNUP_DISABLED_MESSAGE,
      AUTH_USER_BANNED_MESSAGE,
      AUTH_RATE_LIMIT_MESSAGE,
      AUTH_GENERIC_MESSAGE,
    ]);
    expect(distinct.size).toBe(11);
  });
});

describe("authErrorMessage — the chain below `code`", () => {
  // `code` is read off the response body, so five classes never carry one. Without the
  // `name` link a transport failure would read as "popraw dane w formularzu".
  it("separates a transport failure from a rejected credential, on `name` alone", () => {
    const transport = authErrorMessage(withSentinelMessage({ name: "AuthRetryableFetchError", status: 503 }));

    expect(transport).toBe(AUTH_NETWORK_MESSAGE);
    expect(transport).not.toBe(AUTH_GENERIC_MESSAGE);
    expect(transport).not.toBe(AUTH_INVALID_CREDENTIALS_MESSAGE);
  });

  it("tells an empty form field apart from wrong credentials", () => {
    // What supabase-js raises for `{ email: "", password: "" }` — i.e. what an empty form
    // produces, since `form.get("email") as string` hands `""` straight through.
    expect(authErrorMessage({ name: "AuthInvalidCredentialsError", status: 400 })).toBe(
      AUTH_MISSING_CREDENTIALS_MESSAGE,
    );
  });

  it("maps a missing session by name", () => {
    expect(authErrorMessage({ name: "AuthSessionMissingError", status: 400 })).toBe(AUTH_SESSION_MISSING_MESSAGE);
  });

  it("falls to status when neither code nor name is recognised", () => {
    expect(authErrorMessage({ name: "AuthUnknownError", status: 429 })).toBe(AUTH_RATE_LIMIT_MESSAGE);
    expect(authErrorMessage({ name: "AuthUnknownError", status: 500 })).toBe(AUTH_NETWORK_MESSAGE);
  });

  it("falls back rather than throwing on an unknown code, an empty object, or null", () => {
    expect(authErrorMessage({ code: `not_a_real_code_${suffix}`, status: 400 })).toBe(AUTH_GENERIC_MESSAGE);
    expect(authErrorMessage({})).toBe(AUTH_GENERIC_MESSAGE);
    expect(authErrorMessage(null)).toBe(AUTH_GENERIC_MESSAGE);
    expect(authErrorMessage(undefined)).toBe(AUTH_GENERIC_MESSAGE);
  });
});

describe("authErrorMessage — the invariant", () => {
  // Well-formedness, not copy: `ServerError.tsx:8` renders nothing for a falsy message, so an
  // empty constant is a failed sign-in with no visible reason at all. Asserting it over the
  // whole closed set — rather than per case — is also what kills every `StringLiteral -> ""`
  // mutant on this module, including the three constants no single case compares against a
  // literal (both sides of such a comparison mutate together and the mutant survives).
  it("has no empty constant in the closed set", () => {
    expect(AUTH_MESSAGES.length).toBeGreaterThan(0);
    for (const message of AUTH_MESSAGES) {
      expect(message.length).toBeGreaterThan(0);
    }
  });

  // The whole point of the module. Every branch of the chain is exercised with a sentinel in
  // the place upstream prose occupies; none of them may echo it.
  it("never lets an input substring reach the output", () => {
    const inputs = [
      ...Object.keys({
        invalid_credentials: 0,
        email_not_confirmed: 0,
        email_exists: 0,
        user_already_exists: 0,
        weak_password: 0,
        same_password: 0,
        email_address_invalid: 0,
        validation_failed: 0,
        signup_disabled: 0,
        user_banned: 0,
        over_request_rate_limit: 0,
        over_email_send_rate_limit: 0,
      }).map((code) => withSentinelMessage({ code, name: "AuthApiError", status: 400 })),
      withSentinelMessage({ name: "AuthRetryableFetchError", status: 503 }),
      withSentinelMessage({ name: "AuthInvalidCredentialsError", status: 400 }),
      withSentinelMessage({ code: `unknown_${SENTINEL}`, name: `Name_${SENTINEL}`, status: 418 }),
      // Prototype keys, and they are not a curiosity: the maps are plain object literals,
      // so a bare `MESSAGE_BY_CODE[code]` returned `function Object() { [native code] }`
      // for `code: "constructor"` — truthy, so it was returned as copy and reached
      // `encodeURIComponent` in the address bar. `code` comes from the GoTrue response
      // body, so it is upstream-controlled. The closed-set assertion below is what fails
      // on the regression; `not.toContain(SENTINEL)` alone would not (impl-review F1).
      withSentinelMessage({ code: "constructor", status: 400 }),
      withSentinelMessage({ code: "toString", status: 400 }),
      withSentinelMessage({ name: "valueOf", status: 400 }),
      withSentinelMessage({ name: "hasOwnProperty", status: 400 }),
      // The `JSON.stringify(err)` fallback shape — the worst case, an entire GoTrue body.
      { message: JSON.stringify({ email: `${SENTINEL}@example.com`, hint: SENTINEL }), status: 400 },
    ];

    for (const input of inputs) {
      const message = authErrorMessage(input);
      expect(message).not.toContain(SENTINEL);
      expect(message).not.toContain("{");
      // Membership in the closed set is the stronger form of the same claim: the output is
      // not merely sentinel-free, it is one of this project's own constants.
      expect(AUTH_MESSAGES).toContain(message);
    }
  });
});

describe("POST /api/auth/signin", () => {
  // The one case that needs the real stack: what actually lands in the address bar. The
  // route is driven with a session cookie only because `callEndpoint` requires an account —
  // sign-in itself reads nothing from it.
  it("redirects with a project constant, never with the submitted address", async () => {
    const form = new FormData();
    form.set("email", `${SENTINEL}@example.com`);
    form.set("password", `wrong-password-${suffix}`);

    const response = await callEndpoint(SignIn, { url: "/api/auth/signin", body: form, as: accountA() });

    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location.startsWith("/auth/signin?")).toBe(true);

    const error = new URL(location, "http://localhost:4321").searchParams.get("error");
    expect(error).toBe(AUTH_INVALID_CREDENTIALS_MESSAGE);
    // Asserted on the RAW Location too, not only on the decoded param: the leak this phase
    // closes is a substring of the URL, and percent-encoding would hide it from the decoded
    // read alone.
    expect(location).not.toContain(SENTINEL);
    expect(location).not.toContain("%7B");
    expect(error).not.toContain("{");
  });
});
