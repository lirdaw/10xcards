import type { AuthErrorLike } from "@/lib/auth-errors";
import { AUTH_NETWORK_MESSAGE, AUTH_UNAVAILABLE_MESSAGE } from "@/lib/auth-errors";
import { fingerprint, type ContentFingerprint } from "@/lib/audit-failure-report";

// What a failed session check in `src/middleware.ts` MEANS, and what the guard says about it
// (C10X-52). The read-side twin of `@/lib/signout-outcome`, and deliberately its sibling in
// shape — read the two together.
//
// WHY THIS IS A MODULE AND NOT TWO BRANCHES INSIDE THE MIDDLEWARE. Both failure states are
// UNREACHABLE from this project's test suite, and neither by a rule that could be relaxed.
// `unavailable` needs GoTrue to fail, and the runner drives a real, healthy local stack —
// `tests/middleware.test.ts` calls the REAL `createClient` and the REAL `getUser`, so it has no
// seam to fail through. `unconfigured` needs `createClient()` to return `null`, i.e.
// `SUPABASE_URL`/`KEY` absent — but `astro:env/server` is inlined at transform time under Vitest,
// so reaching it means doubling that module, which test-plan §6.9 confines to one file and admits
// only for a claim unreachable ANY other way. Extracted here the decision is a total function over
// a FABRICATED argument, so every branch is asserted on every `npm test`. Same shape, and for the
// same reason, as `readJsonResponse` / `rateOutcome` (C10X-27), `visibleConfigStatuses` (C10X-34)
// and `signOutLanding` (C10X-51): extract the decision, and extract its inputs with it.
//
// WHY THIS IS NOT `authErrorMessage`, which a reviewer will reasonably ask, since both take an
// `AuthErrorLike` and both answer with a member of `AUTH_MESSAGES`. `authErrorMessage` is a
// message mapper for a caller that ALREADY KNOWS a failure happened: it maps
// `AuthSessionMissingError` to `AUTH_SESSION_MISSING_MESSAGE` ("Twoja sesja wygasła"), i.e. it
// PRESUMES the very answer this module has to compute. On this path that presumption is the bug —
// `getUser()` returns an error for the ordinary signed-out visitor as well as for a dead backend,
// so a mapper that reads every error as a lapsed session is what tells a user with a live session
// that it expired. The vocabulary is shared and reused; the classification is this module's alone.
//
// WHY THE SPLIT KEYS ON `name` AND `code`, AND NOT ON `status`. Three upstream facts, each of
// which would have cost a wrong branch. The first two are READ OUT of the installed
// `@supabase/auth-js` 2.105.3 and are re-derivable from the anchors given; the third is a claim
// about the GoTrue SERVER, and its provenance is stated separately because it is a different
// kind of claim:
//
//   - `AuthSessionMissingError` FABRICATES its status. `_handleRequest` converts ANY response
//     carrying `code: "session_not_found"` into `new AuthSessionMissingError()`
//     (`lib/fetch.js:66-70`), and that constructor takes no arguments at all — it hardcodes 400
//     (`lib/errors.js:100-104`). So whatever status GoTrue actually answered with is DISCARDED
//     on this class, and `status` is not a usable discriminator on it. Stated as the mechanism
//     rather than as a particular number on purpose: the conversion is what is verified, and it
//     holds whichever status the server sent.
//   - A plain **500 is NOT retryable**. `NETWORK_ERROR_CODES` (`lib/fetch.js:22`) is
//     `[502,503,504,520,521,522,523,524,530]` — no 500 — so a 500 becomes an ordinary
//     `AuthApiError`. "5xx implies `AuthRetryableFetchError`" is false, and a discriminator
//     written from the class name alone misses the single most likely server-side failure. That
//     is why the `>= 500` rule below exists ON TOP of the name rule rather than instead of it.
//   - An ordinarily EXPIRED session is reported NOT as `AuthSessionMissingError` but as
//     `AuthApiError(400, validation_failed)` — so keying on the missing-session class alone
//     would banner a user whose session merely lapsed: the same defect, one class over. This one
//     is a GoTrue RESPONSE behaviour, not a line of client source, so it cannot be re-derived
//     from `node_modules`; it comes from this change's `research.md` §1 row b3. Nothing here
//     DEPENDS on that code being exactly `validation_failed`, and that is the point of the
//     `default` arm: an expired session reporting some other unrecognised code falls through to
//     `no-session` anyway, i.e. to the same answer. The allow-list buys precision, never safety.

/**
 * What the guard learned when it tried to resolve the caller.
 *
 * Three variants, and none of them is `signed-in`. `src/middleware.ts` computes an outcome only
 * where `context.locals.user` came back null, and reads the landing only inside
 * `if (!context.locals.user)` — so a `signed-in` variant would be constructed by nobody and its
 * truth-table row would assert a state production cannot produce.
 *
 * `unconfigured` is separate from `unavailable` because the two carry DIFFERENT copy (see
 * {@link authGuardLanding}), and one variant cannot hold two messages. It is produced directly by
 * the `!supabase` arm in the middleware and never passes through {@link classifyAuthError}.
 */
export type AuthCheckOutcome = { kind: "no-session" } | { kind: "unavailable" } | { kind: "unconfigured" };

/** The two outcomes {@link classifyAuthError} can reach. `unconfigured` is not one of them. */
export type ClassifiedAuthError = "no-session" | "unavailable";

/**
 * `AuthApiError` codes that mean the CALLER has no usable session — not that the backend is down.
 *
 * These arrive on an `AuthApiError`, which carries a real HTTP status from GoTrue's response
 * envelope — so they are precisely the failures that cannot be told apart from a server fault by
 * `status` alone, which is why the split reads `code` at all.
 *
 * `session_not_found` is DEAD BY CONSTRUCTION here and is kept deliberately, the same way
 * `@/lib/auth-errors` keeps its own unreachable entries. `_handleRequest` intercepts that code
 * BEFORE any `AuthApiError` is built and converts it into `AuthSessionMissingError`
 * (`lib/fetch.js:66-70`), which the `name` rule above already matches — so no value carrying it
 * can reach this list while that conversion stands. It stays as the backstop for an auth-js that
 * stops converting, and it costs nothing: both routes answer `no-session`. Do not read its
 * presence as evidence that the code path is exercised.
 *
 * Read as plain strings because `ErrorCode` is a type-only export
 * (`lib/error-codes.js` is `export {}`), so a typo here is not a compile error. All six were
 * checked character for character against the `ErrorCode` union in
 * `node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts` at 2.105.3 — the same artifact
 * `@/lib/auth-errors`'s reachability record names, and for the same reason: re-derive from that
 * file rather than from this sentence.
 *
 * An array rather than an object map, which also sidesteps the prototype-chain trap
 * `authErrorMessage` had to close with `Object.hasOwn`: `includes` cannot answer `"constructor"`.
 */
const NO_SESSION_CODES: readonly string[] = [
  // The token is structurally unusable — tampered, garbage, or signed by another key.
  "bad_jwt",
  // What an ordinarily expired session's rejected refresh answers with. NOT a missing session.
  "validation_failed",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_expired",
  "session_not_found",
];

/** GoTrue's rate limit. A 429 is the backend refusing to serve, never a statement about the session. */
const RATE_LIMITED = 429;

/** Everything at or above this is the backend failing, whatever the class says. See the header on 500. */
const SERVER_ERROR_FLOOR = 500;

/**
 * Does this `getUser()` failure mean the caller has no session, or that we could not find out?
 *
 * The whole point of the module. `getUser()` answers with an error in BOTH cases — including for
 * an anonymous visitor, before any network call at all (`GoTrueClient.js:2493-2494`) — so a plain
 * `if (error)` in the guard would banner every visitor to `/`, `/auth/signin` and `/auth/signup`.
 * The C10X-51 sibling could ship exactly that check because `_signOut` allow-lists the
 * missing-session class into `{ error: null }`; `_getUser` has no such allow-list.
 *
 * Order is load-bearing, not stylistic. `name` is tested first because it is the only reliable
 * reading on the two classes that carry one (see the header: one fabricates its status, the other
 * is the sole transport class). The `code` allow-list is tested BEFORE the status rule so that a
 * contradictory upstream answer — a session-scoped code arriving with a 5xx — falls to the safe
 * side rather than to the loud one.
 *
 * NEITHER of those two rules is gated on `name === "AuthApiError"`, and that is a decision rather
 * than an omission (impl-review F3). From `getUser()` the only class left after the two `name`
 * tests above IS `AuthApiError`, so the gated and ungated readings coincide for every value this
 * function can actually be handed — nothing is lost by omitting the gate, and no case below can
 * tell the two apart, since every fabricated row carries a real class name. What the ungated form
 * buys is the value it is NOT handed today: should auth-js ever answer with a class neither named
 * above nor `AuthApiError`, a `429` or a `>= 500` on it still means the backend refused to serve,
 * which is the same answer that class would want. Adding the gate would send exactly those values
 * to `no-session` instead — a silent narrowing on the one population nobody has enumerated.
 *
 * THE `default` ARM FALLS TO `no-session`, AND IT IS UNCONDITIONAL. `error-codes.d.ts` opens with
 * its own warning that the server may return codes absent from the union, so an unrecognised
 * `code` is an ordinary event rather than a corrupt one. A wrong `unavailable` tells a visitor who
 * is simply signed out that the auth backend is down — this ticket's own defect, inverted — while
 * a wrong `no-session` degrades to the misleading message that shipped before this change. Of the
 * two, only one is a regression.
 *
 * It is not softened for a value that matches nothing at all (`{}`, an arbitrary object, `null`),
 * and that is what keeps this ONE arm rather than two pointing in opposite directions. The only
 * producer of a shapeless value is a THROWN non-`AuthError`, and that never reaches this
 * function: `src/middleware.ts`'s `catch` builds `{ kind: "unavailable" }` itself, the same
 * division of labour `signout.ts:62` draws one route over.
 */
export function classifyAuthError(error: AuthErrorLike | null | undefined): ClassifiedAuthError {
  if (!error) return "no-session";

  if (error.name === "AuthSessionMissingError") return "no-session";
  if (error.name === "AuthRetryableFetchError") return "unavailable";

  if (error.code !== undefined && NO_SESSION_CODES.includes(error.code)) return "no-session";

  if (error.status === RATE_LIMITED) return "unavailable";
  if (error.status !== undefined && error.status >= SERVER_ERROR_FLOOR) return "unavailable";

  return "no-session";
}

/** What the guard tells the caller. One field, because the status and shape belong to the route. */
export interface AuthGuardLanding {
  /** A member of `AUTH_MESSAGES`, or `null` when there is nothing to say beyond "sign in". */
  message: string | null;
}

/**
 * Given what the guard learned, what does it say?
 *
 * Total over {@link AuthCheckOutcome} by construction — the switch is exhaustive on the union, so
 * a fourth variant is a compile error rather than a silent fall-through to `null`, which is the
 * one direction this function must never fail in: a `null` message is what restores the original
 * defect, a bounced user with nothing on screen explaining why.
 *
 * The two non-`no-session` branches share both response shapes in the middleware and differ ONLY
 * in their message, on purpose. They mean different things to the person reading them — "this
 * deployment has no auth service configured at all" versus "we could not reach the one it has" —
 * and a collapse to one message is caught by a case in `tests/lib/auth-outcome.test.ts`.
 *
 * `no-session` answers `null` rather than `AUTH_SESSION_MISSING_MESSAGE`, and the absence is the
 * decision. An anonymous visitor's experience must come out byte-identical to before this change:
 * they are redirected to a bare `/auth/signin` with no banner, because being asked to sign in is
 * not an error to report. `ownedAuthMessage` on that page renders nothing for a falsy value, so
 * `null` is exactly what "say nothing" is spelled as at the far end.
 *
 * Both constants are already `AUTH_MESSAGES` members and already mean this — `AUTH_NETWORK_MESSAGE`
 * is what `/api/auth/signin` answers with in the SAME outage — so nothing new enters the closed
 * set and the sign-in page vouches for both with no size or distinctness work.
 */
export function authGuardLanding(outcome: AuthCheckOutcome): AuthGuardLanding {
  switch (outcome.kind) {
    case "unavailable":
      return { message: AUTH_NETWORK_MESSAGE };
    case "unconfigured":
      return { message: AUTH_UNAVAILABLE_MESSAGE };
    case "no-session":
      return { message: null };
  }
}

// ─── The forensic channel, and it covers ONE of the two populations that reach `unavailable` ───
//
// Added by this change's impl-review (F1). D-01 rules out a Sentry capture here and the reasoning
// is sound — the middleware authenticates on EVERY request, so a capture on the outage path is
// unsampled by construction and self-masking once quota runs out. What D-01 does not cover, and
// what the plan inherited rather than argued, is that TWO different populations land on the same
// `unavailable` outcome:
//
//   - a RETURNED `AuthError` — an infrastructure event, one per request for as long as GoTrue is
//     down, i.e. exactly the volume D-01 describes. It still gets NO capture, and that is D-01
//     working as written.
//   - a THROWN non-`AuthError` — a programming error. `_getUser` rethrows only values that are not
//     `AuthError`s (`GoTrueClient.js:2516`), so this is a bug in the cookie layer, the adapter or
//     an upgrade, and it is rare by construction rather than per-request. Before C10X-52 it was an
//     uncaught 500: loud, and at minimum visible to the user as a broken page. The `catch` that
//     correctly stops the 500 also converts it into "the auth backend is briefly unreachable" —
//     true-looking, wrong, and reaching NOBODY, since `src/` writes no console output
//     (`tests/lib/no-logging.test.ts`) and there was no second channel.
//
// So the split is by CAUSE, never by outcome: the response stays identical for both (the user
// cannot act on the difference and must not be shown it), and only the throw is reported. That is
// why the capture lives at the `catch` in `src/middleware.ts` and nowhere else in that file.

/**
 * The synthetic error's message, so the capture statement interpolates NOTHING.
 *
 * Same contract as `SIGNOUT_CAPTURE_MESSAGE` one module over, and for the same reason: the first
 * argument to `captureException` is serialised onto the event as `exception.values[].value`, where
 * no builder can reach it — so it must never be the thrown value itself. Sentry groups on this
 * literal, and the `name`/`code`/`status` tags are what discriminate one throw from another.
 */
export const AUTH_CHECK_CAPTURE_MESSAGE = "getUser() threw — the session check could not complete";

/**
 * What was thrown, narrowed to the fields the report may carry.
 *
 * `message` is widened in exactly the way `SignOutFailureCause` is, and for exactly its reason: the
 * builder has to SEE the field in order to promise it never leaves verbatim. A type that hid it
 * would make the promise unwritable and a leak invisible.
 */
export interface AuthCheckFailureCause extends AuthErrorLike {
  message?: string;
}

/** What `Sentry.captureException`'s second argument accepts, narrowed to the two keys this builds. */
export interface AuthCheckFailureReport {
  tags: Record<string, string>;
  extra: Record<string, unknown>;
}

/** The tag value for a field the throw does not carry. Matches the two sibling builders. */
const NONE = "none";

/**
 * Narrow an arbitrary thrown value into a cause.
 *
 * Total over `unknown` and deliberately so — this runs in a `catch`, where the value is whatever
 * the throw site produced, including a string, `null`, or an object with none of these fields.
 * Structurally identical to `signout.ts`'s `thrownAsCause`, which is NOT refactored into a shared
 * helper here: that would be a second edit to a route this change does not otherwise touch, and
 * the two sites' content-field decisions are independent claims that should stay separately
 * reviewable.
 */
export function thrownAsAuthCheckCause(thrown: unknown): AuthCheckFailureCause {
  if (typeof thrown !== "object" || thrown === null) return {};
  const { code, name, status, message } = thrown as Record<string, unknown>;
  return {
    code: typeof code === "string" ? code : undefined,
    name: typeof name === "string" ? name : undefined,
    status: typeof status === "number" ? status : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

/**
 * The Sentry context for a thrown session check: structured fields verbatim, free-form text never.
 *
 * The bound on `name` and `code` here is WHO can throw, not a closed upstream vocabulary — the
 * same narrower guarantee `buildSignOutFailureReport` states for its own throw path, and stated
 * rather than left reading like the stronger one. The values reaching a `catch` around
 * `getUser()` come from Astro's `cookies` implementation and from `@supabase/ssr`'s cookie
 * parsing; neither puts a submitted value in those two fields. `message` needs no such caveat: it
 * is fingerprinted below and never travels verbatim.
 *
 * Async because the digest is, which is why the call site `await`s it inline on the capture
 * statement — one statement, so `tests/lib/sentry-capture-wiring.test.ts` can see the delegation.
 */
export async function buildAuthCheckFailureReport(cause: AuthCheckFailureCause): Promise<AuthCheckFailureReport> {
  const message: ContentFingerprint | null = await fingerprint(cause.message);

  return {
    tags: {
      name: cause.name === undefined || cause.name === "" ? NONE : cause.name,
      code: cause.code === undefined || cause.code === "" ? NONE : cause.code,
      // Stringified because a Sentry tag value is a string, and tested on `undefined` rather than
      // on falsiness because `0` is a real reading on this family (see the sibling builder).
      status: cause.status === undefined ? NONE : String(cause.status),
    },
    // The `_fingerprint` suffix is naming rather than decoration: a reader must not be able to
    // mistake a digest for the value it stands in for.
    extra: {
      cause_message_fingerprint: message,
    },
  };
}
