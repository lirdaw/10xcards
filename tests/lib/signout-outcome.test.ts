import { describe, expect, it } from "vitest";
import { AUTH_MESSAGES, AUTH_UNAVAILABLE_MESSAGE, SIGNOUT_FAILED_MESSAGE } from "@/lib/auth-errors";
import { signOutLanding, type SignOutOutcome } from "@/lib/signout-outcome";

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
});
