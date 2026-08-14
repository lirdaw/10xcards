import type { AuthErrorLike } from "@/lib/auth-errors";
import { AUTH_UNAVAILABLE_MESSAGE, SIGNOUT_FAILED_MESSAGE } from "@/lib/auth-errors";
// The digest, borrowed rather than re-derived (C10X-51 D-13). `fingerprint` is a pure, total
// function over `unknown` that CANNOT throw — the property the site below depends on — and it
// already carries its own truth table in `tests/lib/audit-failure-report.test.ts`. A second
// implementation here would be a second thing to keep correct, and the two reports would drift
// on the one shape a reader compares them by. What is NOT borrowed is the report itself: that
// module's builder takes a `generation_session` row and answers about a lost audit record, which
// has nothing to do with a sign-out.
import { fingerprint, type ContentFingerprint } from "@/lib/audit-failure-report";

// Where a sign-out attempt leaves the user, and whether an owner hears about it (C10X-51).
//
// WHY THIS IS A MODULE AND NOT THREE BRANCHES INSIDE THE ROUTE. Two of the three outcomes are
// UNREACHABLE from this project's test suite, and neither is reachable by a rule that could be
// relaxed. `unconfigured` needs `createClient()` to return `null`, i.e. `SUPABASE_URL`/`KEY`
// absent — but `astro:env/server` is inlined at transform time under Vitest, so reaching it
// means doubling that module, which test-plan §6.9 confines to one file and admits only for a
// claim unreachable ANY other way. `failed` needs GoTrue's `/logout` to fail, and the runner
// drives a real, healthy local stack. Extracted here the decision is a total function over a
// fabricated argument, so every branch is asserted on every `npm test`. Same shape, and for the
// same reason, as `readJsonResponse` / `rateOutcome` (C10X-27) and `visibleConfigStatuses`
// (C10X-34): extract the decision, and extract its inputs with it.
//
// WHY BOTH FAILURE BRANCHES LAND ON `/auth/signin`, which is the whole design rather than a
// detail. `/` cannot carry a message at all (`src/pages/index.astro` reads no request state, and
// `tests/lib/error-param-guard.test.ts` forbids teaching it to). `/decks` cannot either, for a
// reason that only looks unrelated: `src/middleware.ts` sets `locals.user` from a real
// `supabase.auth.getUser()` round trip on EVERY request, and the dominant failure class here is
// "GoTrue is unreachable" — so on the very next hop that call fails too, `locals.user` is `null`,
// `/decks` matches `PROTECTED_ROUTES`, and the user is bounced to `/auth/signin` with the
// parameter DROPPED. The banner would never render in exactly the class this fix exists for.
// `/auth/signin` is the one page that cannot be bounced (no `/auth/*` path is protected, and the
// `/` → `/decks` rule needs a user), and it already reads and vouches `?error=` through
// `ownedAuthMessage` into a page-level `ServerError` — so landing there costs no new render site.
//
// ONE CONSEQUENCE OF THAT CHOICE IS ACCEPTED RATHER THAN FIXED. Where `_callRefreshToken` clears
// the cookie AND propagates the error (`GoTrueClient.js:3925-3933`), the sign-out effectively
// succeeded and the user still reads "your session is still active" — on a page they are already
// on. A wrong message in a narrow class, and strictly better than the dominant class lying
// silently. No `isAuthRetryableFetchError` discrimination is added; if it is ever wanted, the
// `failed` branch below is where it goes.
//
// IT RETURNS THE PAIR, NEVER THE FINISHED URL. `?error=` is assembled in the route, in the same
// shape as `signin.ts:36`, because `tests/lib/form-endpoint-guards.test.ts`'s `?error=` sweeps are
// TEXTUAL: a URL built here would leave `signout.ts` carrying no `error=` text at all, so the
// guard would be registered against a file with nothing in it to inspect. The cost is stated
// rather than hidden — the encoding and the concatenation are two lines this module's truth table
// does not cover, and that guard is what covers them instead.

/**
 * What `signOut()` did, as the route observed it.
 *
 * `failed` carries the cause even though the landing below ignores it: the second channel
 * (`Sentry.captureException`) needs it, and threading it through the same value is what keeps
 * "one observation in, one decision out" true for both channels.
 *
 * A THROW AND A RETURNED ERROR ARE THE SAME OUTCOME. `signOut()` can do either —
 * `_notifyAllSubscribers` rethrows the first callback error (`GoTrueClient.js:3960-3965`) and
 * neither `_signOut` nor `signOut` has a `catch` — and the user's state is identical in both
 * cases, so the route maps both onto this one variant rather than inventing a third.
 */
export type SignOutOutcome =
  | { kind: "unconfigured" }
  | { kind: "failed"; cause: AuthErrorLike }
  | { kind: "signed-out" };

/** Where the user lands, what the banner says there, and whether an owner is told. */
export interface SignOutLanding {
  /** The redirect target. Both failure branches share one; success keeps the guest landing. */
  path: string;
  /** A member of `AUTH_MESSAGES`, or `null` when there is nothing to say. */
  message: string | null;
  /** Whether the Sentry channel fires. Consumed by the capture; ignored by the redirect. */
  capture: boolean;
}

/**
 * The page that can always render a message, whatever GoTrue's state — see the header.
 * Not `/decks`, and the difference is measured rather than stylistic.
 */
const FAILURE_PATH = "/auth/signin";

/**
 * The guest landing, unchanged from before this fix. Correct on success and only on success: a
 * real sign-out leaves no user, so the middleware's `/` → `/decks` rule does not fire.
 */
const SUCCESS_PATH = "/";

/**
 * Given what `signOut()` did, where does the user land and does an owner get told?
 *
 * Total over {@link SignOutOutcome} by construction — the switch is exhaustive on the union, so a
 * fourth outcome is a compile error rather than a silent fall-through to success, which is the
 * one direction this function must never fail in.
 *
 * The two failure branches share a path and differ in their message ON PURPOSE. They mean
 * different things to the person reading them — "this app cannot reach its auth service at all"
 * versus "you are still signed in" — and only the second is an instruction to act on. A collapse
 * to one message is caught by a case in `tests/lib/signout-outcome.test.ts`.
 *
 * Only `failed` captures. `unconfigured` is a deployment state, not an incident: it is visible in
 * the app's own configuration banner, it fires identically on every request, and reporting it
 * would bill Sentry for a fact nobody learns anything from.
 */
export function signOutLanding(outcome: SignOutOutcome): SignOutLanding {
  switch (outcome.kind) {
    case "unconfigured":
      // Byte-identical to `signin.ts:36` and `signup.ts:27` — the same condition already has
      // this project's copy, so no new constant enters the closed set.
      return { path: FAILURE_PATH, message: AUTH_UNAVAILABLE_MESSAGE, capture: false };
    case "failed":
      return { path: FAILURE_PATH, message: SIGNOUT_FAILED_MESSAGE, capture: true };
    case "signed-out":
      return { path: SUCCESS_PATH, message: null, capture: false };
  }
}

// ---------------------------------------------------------------------------------------------
// THE SECOND CHANNEL (C10X-51 Phase 4).
//
// The banner is the whole of what the USER gets, and it is the right channel for them: it names
// the live session and the two exits. It is the wrong channel for an OWNER — it reaches exactly
// one person, who cannot fix a dead GoTrue, and it survives nowhere. So the failure branch also
// captures, for the same reason C10X-50's two audit sites do (test-plan §6.6): the person who is
// told and the person who could act are not the same person.
//
// Everything the capture may carry is decided HERE, as a pure function over its argument, so the
// privacy property is a truth table rather than a reviewer's attention — the split
// `@/lib/audit-failure-report` + `tests/lib/audit-failure-report.test.ts` already established,
// and `tests/lib/sentry-capture-wiring.test.ts` is the guard that the route still calls it.
// ---------------------------------------------------------------------------------------------

/**
 * The failure `signOut()` came back with, as the capture sees it.
 *
 * `AuthErrorLike` plus the one field it deliberately omits. That omission is not an oversight to
 * repair — `@/lib/auth-errors` excludes `message` precisely so no mapper can relay it into a URL,
 * because GoTrue interpolates submitted values into its own copy and `_getErrorMessage` falls
 * back to `JSON.stringify(err)` on an unexpected body. But the VALUE the route hands over is a
 * real `AuthError`, which carries `message` at runtime whatever the static type says, so this
 * builder has to see the field in order to promise it never leaves verbatim. Widening the type
 * here and fingerprinting the field is what makes that promise checkable; narrowing it away
 * would make the promise unwritable and the leak invisible.
 */
export interface SignOutFailureCause extends AuthErrorLike {
  message?: string;
}

/** What `Sentry.captureException`'s second argument accepts, narrowed to the two keys this builds. */
export interface SignOutFailureReport {
  tags: Record<string, string>;
  extra: Record<string, unknown>;
}

/**
 * The synthetic error's message, so the capture statement interpolates NOTHING and the wiring
 * guard can assert its first argument is a `new Error(...)` rather than the auth failure itself.
 *
 * Fixed literal, with the cost stated rather than hidden: Sentry groups on it and there is no
 * upstream stack, so the `name` and `status` tags are what discriminate classes — a dead GoTrue
 * (`AuthRetryableFetchError`, status 0) from a 500 from a 429.
 */
export const SIGNOUT_CAPTURE_MESSAGE = "signOut did not complete — the session may still be live";

/**
 * The tag value for a field the failure does not carry.
 *
 * A fixed literal rather than `""`, for the reason `@/lib/audit-failure-report` records one line
 * over: an empty tag value reads in Sentry as "no error" rather than as "the client never got
 * one" — and here that is the DOMINANT class, since a `fetch` that never reached GoTrue has no
 * status and no code at all.
 */
const NONE = "none";

/**
 * Build the capture context for a sign-out that did not complete.
 *
 * The privacy rule, in one sentence: **the three structural fields travel verbatim and every
 * free-form string leaves as a length plus a digest prefix.** `code`, `name` and `status` are a
 * closed upstream vocabulary carrying no submitted value, which is what makes them safe as tags;
 * `message` is the one field on an `AuthError` that can echo what the user typed, so it leaves
 * only as a shape.
 *
 * NO USER IDENTIFIER, and that is the sharpest line here rather than a default. This event is
 * about one named person's session; an id or an address would make the report identify exactly
 * the party it exists to protect. Nothing on this path even reads the user — the route never
 * touches `locals.user` — so the absence is structural as well as intended.
 *
 * **IT MUST NOT THROW, and that is a hard contract rather than a nicety.** The call site sits on
 * the failure path immediately before the redirect that carries the banner, so a throw here does
 * not degrade the report — it replaces a 302 the user can act on with an uncaught framework 500,
 * i.e. strictly worse than the defect this whole change fixes. The risky half is delegated to
 * `fingerprint`, which wraps both the serialisation and the digest; everything else is a property
 * read off a plain object.
 *
 * Async because the digest is (`crypto.subtle.digest` returns a Promise), which is why the call
 * site `await`s it inline on the capture statement — one statement, so the wiring guard can see
 * the delegation.
 *
 * @param cause what `signOut()` returned or threw, already narrowed by the route
 */
export async function buildSignOutFailureReport(cause: SignOutFailureCause): Promise<SignOutFailureReport> {
  const message: ContentFingerprint | null = await fingerprint(cause.message);

  return {
    // Low-cardinality and indexed by Sentry — grouping and filtering, never content. These are
    // the same three fields `authErrorMessage` keys its closed-set lookup on, and for the same
    // reason: on the RETURNED-`AuthError` path they are assigned by the SDK's own classes and by
    // GoTrue's response envelope, not by anything the user typed.
    //
    // SCOPED to that path on purpose (C10X-51 impl-review F5), because the sentence above is not
    // established for the other one. `signout.ts`'s `thrownAsCause` accepts ANY thrown object and
    // copies whatever strings sit on its `.code` and `.name` into these tags, with no bound on
    // origin. What actually bounds it there is WHO can throw — Astro's `cookies.set` and auth-js
    // subscriber callbacks, neither of which puts a submitted value in those two fields — which is
    // a narrower guarantee than "a closed upstream vocabulary", and is written as such rather than
    // left to read like the stronger one. `message` needs no caveat on either path: it is
    // fingerprinted above and never travels verbatim.
    tags: {
      name: cause.name === undefined || cause.name === "" ? NONE : cause.name,
      code: cause.code === undefined || cause.code === "" ? NONE : cause.code,
      // Stringified because a Sentry tag value is a string. `0` is a REAL reading here — it is
      // what `AuthRetryableFetchError` carries when the request never left the process — so it
      // must stay distinguishable from the absent case, which is why the test is on `undefined`
      // and not on falsiness.
      status: cause.status === undefined ? NONE : String(cause.status),
    },
    // The `_fingerprint` suffix is deliberate naming rather than decoration: a reader must not be
    // able to mistake a digest for the value it stands in for.
    extra: {
      cause_message_fingerprint: message,
    },
  };
}
