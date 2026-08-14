import { describe, expect, it } from "vitest";
import { AUTH_MESSAGES, AUTH_UNAVAILABLE_MESSAGE, SIGNOUT_FAILED_MESSAGE } from "@/lib/auth-errors";
import {
  buildSignOutFailureReport,
  signOutLanding,
  type SignOutFailureCause,
  type SignOutFailureReport,
  type SignOutOutcome,
} from "@/lib/signout-outcome";

// The truth table for `POST /api/auth/signout`'s decision (C10X-51).
//
// WHY A TRUTH TABLE AND NOT AN ENDPOINT TEST: two of the three outcomes cannot be produced from
// this suite at all. `unconfigured` needs `createClient()` to return `null`, and under Vitest
// `astro:env/server` is a transform-time inlined literal, so provoking it means the module double
// test-plan §6.9 confines to one file. `failed` needs GoTrue's `/logout` to fail, and the runner
// drives a real, healthy local stack. So the decision was extracted (`@/lib/signout-outcome`) and
// every branch is asserted here on a fabricated argument, on every `npm test`. What this file
// therefore does NOT prove is that the ROUTE consults it — that is `tests/auth/signout.test.ts`
// on the one branch it can reach, and one recorded manual run for the rest.
//
// No database, no stack, no fixture: every input below is fabricated.

/** A `failed` cause shaped like the class the dominant failure produces — a dead GoTrue. */
const TRANSPORT_FAILURE: SignOutOutcome = {
  kind: "failed",
  cause: { name: "AuthRetryableFetchError", status: 0 },
};

describe("signOutLanding — one row per outcome", () => {
  it("sends an unconfigured Supabase to the sign-in page with the unavailable copy", () => {
    // The branch `signout.ts` used to answer by redirecting to `/` having done nothing at all —
    // the second of the two swallow points, and the one that presented "no client, no request,
    // no sign-out" as success.
    expect(signOutLanding({ kind: "unconfigured" })).toEqual({
      path: "/auth/signin",
      message: AUTH_UNAVAILABLE_MESSAGE,
      capture: false,
    });
  });

  it("sends a failed sign-out to the sign-in page with the still-signed-in copy, and reports it", () => {
    expect(signOutLanding(TRANSPORT_FAILURE)).toEqual({
      path: "/auth/signin",
      message: SIGNOUT_FAILED_MESSAGE,
      capture: true,
    });
  });

  it("sends a real sign-out to the guest landing with nothing to say", () => {
    // `/` is correct here and ONLY here: a real sign-out leaves no user, so the middleware's
    // `/` → `/decks` rule does not fire and the guest landing renders.
    expect(signOutLanding({ kind: "signed-out" })).toEqual({
      path: "/",
      message: null,
      capture: false,
    });
  });

  // THE FALSE-ALARM CLASS, AND IT IS ACCEPTED RATHER THAN NEUTRALISED (research §2.4).
  // When the stored session is expired and the refresh fails non-retryably,
  // `_callRefreshToken`'s catch clears the session ITSELF before propagating the error
  // (`GoTrueClient.js:3925-3933`) — so this cause arrives on a sign-out that effectively
  // succeeded, and the user reads "your session is still active" when it is not.
  //
  // The plan's earlier `/decks` landing would have neutralised it (the middleware re-checks and
  // bounces a genuinely signed-out user, dropping the parameter). That landing was dropped
  // because the same mechanism ate the message in the DOMINANT failure class instead, which is
  // strictly worse — a wrong message in a narrow class beats a silent lie in the common one.
  // This case exists so the trade is a pinned decision rather than an accident: if someone later
  // adds an `isAuthRetryableFetchError` discrimination, this row is what has to change with it.
  it("treats the already-cleared-cookie class as an ordinary failure", () => {
    const alreadyCleared: SignOutOutcome = {
      kind: "failed",
      cause: { name: "AuthApiError", code: "refresh_token_not_found", status: 400 },
    };

    expect(signOutLanding(alreadyCleared)).toEqual(signOutLanding(TRANSPORT_FAILURE));
  });
});

describe("signOutLanding — the invariants", () => {
  // Membership by EQUALITY, which is what `ownedAuthMessage` on the landing page demands: a
  // message that is not literally a member of the closed set is rejected there and renders as NO
  // BANNER. So a constant that drifts out of `AUTH_MESSAGES` does not degrade to hedged copy —
  // it degrades to the original defect, a failed sign-out with nothing on screen.
  it("emits only messages the sign-in page will vouch for", () => {
    const outcomes: SignOutOutcome[] = [{ kind: "unconfigured" }, TRANSPORT_FAILURE, { kind: "signed-out" }];

    for (const outcome of outcomes) {
      const { message } = signOutLanding(outcome);
      if (message !== null) expect(AUTH_MESSAGES).toContain(message);
    }
  });

  // The two failure branches SHARE a path and must NOT share a message. They mean different
  // things to the reader — "this app cannot reach its auth service" versus "you are still signed
  // in" — and only the second is an instruction to act on. Collapsing them to one message is the
  // cheap tidy-up this case exists to redden.
  it("keeps the two failure branches distinguishable", () => {
    const unconfigured = signOutLanding({ kind: "unconfigured" });
    const failed = signOutLanding(TRANSPORT_FAILURE);

    expect(unconfigured.path).toBe(failed.path);
    expect(unconfigured.message).not.toBe(failed.message);
  });

  // POSITIVE CONTROL, and it is in two halves because one of them is not enough — MEASURED, not
  // argued. Pair-distinctness alone does NOT catch a decision collapsed to a single location:
  // send all three outcomes to `/auth/signin` and the three `(path, message)` pairs stay distinct
  // on their messages, so that assertion goes on passing over a route that has stopped
  // redirecting anywhere. Breakage run (2026-08-14, `SUCCESS_PATH` → `FAILURE_PATH` in the
  // `signed-out` arm): 2 of 7 red — this case on `expected 1 to be 2`, i.e. the SECOND half only,
  // with the first still green — plus the `sends a real sign-out to the guest landing` row that
  // names the path directly. That second half is the one that matters: a successful sign-out
  // landing on the sign-in page would tell every user their sign-out failed.
  it("does not send every outcome to the same place", () => {
    const landings = [{ kind: "unconfigured" } as const, TRANSPORT_FAILURE, { kind: "signed-out" } as const].map(
      signOutLanding,
    );

    expect(new Set(landings.map(({ path, message }) => `${path}|${message}`)).size).toBe(3);
    expect(new Set(landings.map(({ path }) => path)).size).toBe(2);
  });

  // The flag the CAPTURE reads, asserted as its own claim rather than only inside the three
  // `toEqual` rows above. `src/pages/api/auth/signout.ts` fires on `capture && kind === "failed"`,
  // i.e. on two conditions that must never disagree: were `unconfigured` to start capturing, the
  // route would bill Sentry on every request of a misconfigured deployment for a fact its own
  // configuration banner already states. This is the case that reddens if someone "simplifies"
  // the flag to `message !== null`.
  it("captures on the failed branch and on nothing else", () => {
    expect(signOutLanding(TRANSPORT_FAILURE).capture).toBe(true);
    expect(signOutLanding({ kind: "unconfigured" }).capture).toBe(false);
    expect(signOutLanding({ kind: "signed-out" }).capture).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// THE PRIVACY TRUTH TABLE for the second channel (C10X-51 Phase 4).
//
// The builder decides what leaves the process toward a THIRD PARTY on a path that carries an
// `AuthError` — and GoTrue interpolates the submitted address into its own copy (`Email address
// %q is invalid`), while `_getErrorMessage` falls back to `JSON.stringify(err)` on an unexpected
// body. That is the same material `@/lib/auth-errors` exists to keep out of a URL, one channel
// over, which is why `message` is fingerprinted rather than dropped or trusted.
//
// WHAT IT DOES NOT PROVE, stated so nobody reads it as more. It says nothing about whether the
// ROUTE still calls the builder — that is `tests/lib/sentry-capture-wiring.test.ts`, and the two
// are one claim split in half, exactly as `sentry-sampling.test.ts` and `sentry-wiring.test.ts`
// are. It also says nothing about whether a captured event ever ARRIVES in the Sentry UI; no
// layer in this project can assert that since C10X-54 deleted `/api/shipprobe`.
//
// EVERY VALUE BELOW IS FABRICATED. No stack, no network, no fixture.
// ---------------------------------------------------------------------------------------------

/** Distinct per field, so a red names WHICH one leaked rather than only that something did. */
const CAUSE_MESSAGE = 'SENTINEL-cause-message-8f21 Email address "ala@example.com" is invalid';
const USER_ADDRESS = "ala@example.com";

/** The shape the DOMINANT failure class arrives in: a `fetch` that never reached GoTrue. */
function cause(overrides: Partial<SignOutFailureCause> = {}): SignOutFailureCause {
  return {
    name: "AuthRetryableFetchError",
    code: "unexpected_failure",
    status: 0,
    message: CAUSE_MESSAGE,
    ...overrides,
  };
}

/**
 * The leak detector. Deliberately over-broad — the WHOLE serialised report, tags and extra
 * together — because a privacy assertion scoped to the fields you remembered to look at is the
 * "correct on what it looks at, silent about what it never looks at" class this project has now
 * recorded five times.
 *
 * IT MATCHES THE ESCAPED FORM TOO, and that is not defensive padding — it was measured. A
 * needle carrying a double quote survives `JSON.stringify` only as `\"`, so the raw-only check
 * this started as reported the positive control below as NOT leaking over a report that plainly
 * did. And the quote is not incidental to the fixture: GoTrue's copy is `Email address %q is
 * invalid`, i.e. `%q` — the one upstream string on this path that can carry a submitted address
 * quotes it. A raw-only detector would therefore have been blind to the exact leak this file
 * exists to catch, while reading green.
 */
function carries(report: SignOutFailureReport, needle: string): boolean {
  const serialised = JSON.stringify(report);
  // `slice(1, -1)` drops the wrapping quotes `JSON.stringify` adds around a string, leaving the
  // escaped body as it would appear INSIDE the serialised report.
  return serialised.includes(needle) || serialised.includes(JSON.stringify(needle).slice(1, -1));
}

describe("buildSignOutFailureReport", () => {
  // THE LOAD-BEARING HALF. `message` is the one field on an `AuthError` that can echo what the
  // user typed, and the alternative shape — handing the error straight to `captureException` —
  // would put it on the event as `exception.values[].value`, where no builder and no guard can
  // reach it. Both the sentinel and the address inside it are asserted, because a truncation that
  // kept the first N characters would drop the sentinel and still ship the address.
  it("carries neither the cause's message nor anything inside it", async () => {
    const report = await buildSignOutFailureReport(cause());

    expect(carries(report, CAUSE_MESSAGE)).toBe(false);
    expect(carries(report, USER_ADDRESS)).toBe(false);
  });

  // …and the same claim from the other side, so "dropped everything" cannot satisfy it: the
  // fingerprint is PRESENT and describes the value that was dropped.
  it("replaces it with a fingerprint that describes what was dropped", async () => {
    const report = await buildSignOutFailureReport(cause());
    const printed = report.extra.cause_message_fingerprint as { length: number; sha256: string } | null;

    expect(printed?.length).toBe(CAUSE_MESSAGE.length);
    expect(printed?.sha256).toMatch(/^[0-9a-f]{16}$/);
  });

  // THE POSITIVE CONTROL FOR BOTH CASES ABOVE. Without it a builder returning `{}` — or a
  // detector that never matches — satisfies them and reads as perfect protection.
  it("the leak detector fires on a report that DOES carry the message", () => {
    const leaky: SignOutFailureReport = {
      tags: { name: "AuthRetryableFetchError" },
      extra: { cause_message: CAUSE_MESSAGE },
    };

    expect(carries(leaky, CAUSE_MESSAGE)).toBe(true);
    expect(carries(leaky, USER_ADDRESS)).toBe(true);
  });

  // Retention, asserted in the same breath so the privacy cases cannot be satisfied by dropping
  // the cause wholesale. These three are a closed upstream vocabulary — assigned by the SDK's own
  // error classes and by GoTrue's response envelope, never by anything the user typed — and they
  // are what discriminates a dead GoTrue from a 500 from a 429 once the captured error is a fixed
  // literal with no upstream stack behind it.
  it("keeps name, code and status verbatim", async () => {
    const report = await buildSignOutFailureReport(cause({ name: "AuthApiError", code: "over_request_rate_limit" }));

    expect(report.tags).toEqual({ name: "AuthApiError", code: "over_request_rate_limit", status: "0" });
  });

  // `0` is a REAL status here — it is what `AuthRetryableFetchError` carries when the request
  // never left the process, i.e. the dominant class — so it must stay distinguishable from the
  // absent case. A falsiness test rather than an `undefined` test collapses the two, and this is
  // the case that reddens if someone writes one.
  it("tells a status of 0 apart from no status at all", async () => {
    const zero = await buildSignOutFailureReport(cause({ status: 0 }));
    const absent = await buildSignOutFailureReport(cause({ status: undefined }));

    expect(zero.tags.status).toBe("0");
    expect(absent.tags.status).toBe("none");
    expect(zero.tags.status).not.toBe(absent.tags.status);
  });

  // The transport class carries no `code` at all and `thrownAsCause` degrades an unrecognisable
  // throw to `{}`, so an absent tag is the ordinary reading rather than an edge case. An empty
  // value would read in Sentry as "no error" rather than as "the client never got one".
  it.each([
    { label: "an empty string", over: { name: "", code: "" } },
    { label: "undefined", over: {} },
  ])("substitutes a fixed literal for a name and code that are $label", async ({ over }) => {
    const report = await buildSignOutFailureReport({ status: 500, ...over });

    expect(report.tags.name).toBe("none");
    expect(report.tags.code).toBe("none");
  });

  // The digest is `@/lib/audit-failure-report`'s, borrowed rather than re-derived — but "the
  // report is stable and discriminating" is a claim about THIS builder, and a change that stopped
  // fingerprinting the message (or fingerprinted a constant instead) would leave that module's
  // own truth table fully green. So both directions are asserted through the report.
  it("fingerprints stably, and discriminates a one-character change", async () => {
    const [first, second, other] = await Promise.all([
      buildSignOutFailureReport(cause({ message: "abcdef" })),
      buildSignOutFailureReport(cause({ message: "abcdef" })),
      buildSignOutFailureReport(cause({ message: "abcdeg" })),
    ]);

    expect(first.extra.cause_message_fingerprint).toEqual(second.extra.cause_message_fingerprint);
    expect(first.extra.cause_message_fingerprint).not.toEqual(other.extra.cause_message_fingerprint);
  });

  // An absent message stays legibly ABSENT rather than becoming the fingerprint of the four
  // characters `null` — otherwise a reader cannot tell "nothing was captured" from "the string
  // 'null' was captured". Reachable in production: `thrownAsCause` produces exactly `{}` for a
  // thrown non-object.
  it("reports no message as null rather than dropping the key", async () => {
    const report = await buildSignOutFailureReport({});

    expect(report.extra).toHaveProperty("cause_message_fingerprint", null);
  });

  // NO USER IDENTIFIER, and it is the sharpest line in this module rather than a default: the
  // event is about one named person's live session, so an id or an address would make the report
  // identify exactly the party it exists to protect. Asserted over a cause carrying BOTH on
  // fields the builder never reads, because "the builder ignores unknown keys" is precisely the
  // property that stops a future `...cause` spread from shipping them.
  it("carries no user identifier, even when the cause is decorated with one", async () => {
    const decorated = { ...cause(), user_id: "SENTINEL-user-id-3ac0", email: USER_ADDRESS };
    const report = await buildSignOutFailureReport(decorated);

    for (const sentinel of ["SENTINEL-user-id-3ac0", USER_ADDRESS]) expect(carries(report, sentinel)).toBe(false);
  });

  // THE CONTRACT THAT KEEPS THE 302 A 302, asserted as `resolves` and never as a caught throw: a
  // test that CAUGHT the throw would pass over an implementation that still kills the response.
  // The capture sits immediately before the redirect that carries the banner, so a throw here
  // replaces a 302 the user can act on with an uncaught framework 500 — strictly worse than the
  // defect this change fixes.
  it.each([
    { label: "a message that is not a string", over: { message: 1n as unknown as string } },
    { label: "a cause with no fields at all", over: {} },
  ])("resolves over $label", async ({ over }) => {
    const report = await buildSignOutFailureReport({ ...over });

    expect(report.tags).toHaveProperty("name");
    expect(report.extra).toHaveProperty("cause_message_fingerprint");
  });
});
