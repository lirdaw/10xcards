import type { AuthErrorLike } from "@/lib/auth-errors";
import { AUTH_UNAVAILABLE_MESSAGE, SIGNOUT_FAILED_MESSAGE } from "@/lib/auth-errors";

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
