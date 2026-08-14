import type { APIRoute } from "astro";
import * as Sentry from "@sentry/cloudflare";
import { createClient } from "@/lib/supabase";
// The THIRD module in `src/` to import the Sentry SDK, after `src/worker.ts` and
// `src/pages/api/generate.ts`. The reasons `generate.ts` gives for the import being safe are
// properties of the package and of the SDK's global hub rather than of that route, so they
// transfer verbatim: `@sentry/cloudflare` carries no `cloudflare:` runtime import outside its
// `./vite` export, and with no client configured `captureException` returns an event id and does
// nothing else — which is exactly its state under the test runner and under `npm run dev`
// without a DSN.
import { buildSignOutFailureReport, signOutLanding, SIGNOUT_CAPTURE_MESSAGE } from "@/lib/signout-outcome";
import type { SignOutFailureCause, SignOutOutcome } from "@/lib/signout-outcome";

// C10X-51. This route used to be ten lines with two swallow points, and both presented a
// failure as SUCCESS:
//
//   const supabase = createClient(...);
//   if (supabase) { await supabase.auth.signOut(); }   // <- result discarded
//   return context.redirect("/");                      // <- fires even with no client at all
//
// What makes that worse here than at the three sibling sites the same audit found in
// `generate.ts`: those lost an audit RECORD, and this one leaves a LIVE SESSION behind a screen
// that says goodbye. Both `return { error }` statements in `_signOut` sit ABOVE the
// `_removeSession()` that clears the cookie (`GoTrueClient.js:3184`, `:3195`, `:3200`), so on
// every transport failure, 500 and 429 nothing is revoked and nothing is cleared — while
// 401/403/404 and `AuthSessionMissingError` are allow-listed upstream and come back
// `{ error: null }`, which is why a plain `if (error)` raises no spurious banner on the ordinary
// already-signed-out case.
//
// The old symptom was a silent ROUND TRIP rather than a stale page: `src/middleware.ts` bounces
// an authenticated visitor from `/` to `/decks`, so the user clicked "Wyloguj", was thrown back
// into the app with their own e-mail in the header, and nothing on any channel said why.
//
// WHERE THE DECISION LIVES. Not here — `@/lib/signout-outcome`, because two of the three
// outcomes are unreachable from this project's suite (see that module's header). This file owns
// only what a pure function cannot: observing `signOut()`, and assembling the URL.

/**
 * A thrown value, narrowed to the three structural fields the closed-set mapper reads.
 *
 * `signOut()` can THROW as well as return an error — `_notifyAllSubscribers` rethrows the first
 * callback error (`GoTrueClient.js:3960-3965`) and neither `_signOut` nor `signOut` has a
 * `catch`, so a throw from this project's own `cookies.set` propagates out of the `await`. The
 * user's state is identical either way, so both map onto the one `failed` outcome.
 *
 * Read structurally, field by field, never by spreading: a thrown value is `unknown`, so anything
 * unrecognisable degrades to `{}` rather than smuggling whatever else sat on the object into the
 * report. `signOutLanding` answers every `failed` cause with the same project constant, so nothing
 * here can reach the URL whatever it holds — the only consumer of these fields is the Sentry
 * report builder.
 *
 * `message` IS carried through when it is a string, and that is a correction rather than a
 * loosening (C10X-51 impl-review F4). Stripping it made a thrown failure produce
 * `{name:"none", code:"none", status:"none"}` with a null fingerprint — an event with nothing to
 * discriminate on, on a path this file's own comment names as reachable. It is safe because it
 * leaves as a length plus a digest prefix, never verbatim: that is exactly the promise
 * `SignOutFailureCause` widens the type to be able to make, and stripping the field here was what
 * denied the throw path the chance to make it.
 */
function thrownAsCause(thrown: unknown): SignOutFailureCause {
  if (typeof thrown !== "object" || thrown === null) return {};
  const { code, name, status, message } = thrown as Record<string, unknown>;
  return {
    code: typeof code === "string" ? code : undefined,
    name: typeof name === "string" ? name : undefined,
    status: typeof status === "number" ? status : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);

  let outcome: SignOutOutcome;
  if (!supabase) {
    // The `null` branch answered as a user-visible refusal, which is what both sibling auth
    // routes already do with the same condition (`signin.ts:35-37`, `signup.ts:25-28`).
    // Sign-out was the only auth route treating "no client, no request, no sign-out" as success.
    outcome = { kind: "unconfigured" };
  } else {
    try {
      const { error } = await supabase.auth.signOut();
      outcome = error ? { kind: "failed", cause: error } : { kind: "signed-out" };
    } catch (thrown) {
      outcome = { kind: "failed", cause: thrownAsCause(thrown) };
    }
  }

  const { path, message, capture } = signOutLanding(outcome);

  // THE SECOND CHANNEL, and it exists because the first one reaches the wrong person. The banner
  // tells the user their session is live, which is what they need; it tells nobody who could fix
  // a dead GoTrue, and it survives nowhere. Same reasoning as C10X-50's two audit sites one route
  // over, with one difference worth naming: there the response was useless to the user because
  // the lost record was invisible to them, while here BOTH channels carry real information — they
  // just carry it to different people.
  //
  // The narrowing is not redundant with the flag. `capture` is the DECISION (it is what the truth
  // table pins, and it is `false` for `unconfigured`, which is a deployment state rather than an
  // incident); `outcome.kind === "failed"` is what gives the compiler a `cause` to hand over. The
  // two cannot disagree — only the `failed` arm sets `capture` — and a case in
  // `tests/lib/signout-outcome.test.ts` is what keeps that true.
  //
  // The exception is SYNTHETIC and carries a fixed literal, never the auth error itself: the
  // first argument is serialised onto the event as `exception.values[].value`, where no builder
  // can reach it, and an `AuthError`'s `message` is the field GoTrue interpolates the submitted
  // address into. The cause travels as the builder's argument instead, where `code`/`name`/
  // `status` pass verbatim and `message` leaves as a length plus a digest prefix.
  //
  // WHAT THIS PROVES AND WHAT IT DOES NOT. `tests/lib/sentry-capture-wiring.test.ts` holds that
  // the call is present and composed; the truth table holds what it may carry. NEITHER asserts
  // that an event ARRIVES, and no layer in this project does — `/api/shipprobe`, the one
  // instrument that ever showed a first-party error reaching the Sentry UI, was deleted by
  // C10X-54.
  //
  // WRAPPED, and this is a DELIBERATE divergence from the two sibling call sites in
  // `generate.ts` rather than an oversight (C10X-51 impl-review F3). `buildSignOutFailureReport`
  // carries a no-throw contract and honours it — `fingerprint` wraps both the serialisation and
  // the digest, and everything else is a property read — but the SDK call itself sits outside
  // that contract. If it ever threw, the rejection would escape this async `APIRoute` and Astro
  // would answer an uncaught 500, replacing the 302 that carries the banner: the exact regression
  // class this ticket exists to remove, and worse than the defect it fixes, because the user then
  // gets no page at all rather than a wrong one. The siblings can afford the same exposure —
  // there a throw would replace an already-error 502/422 — while here it would eat the ONLY
  // channel the user has. A forensic report must never outrank the response it annotates.
  if (capture && outcome.kind === "failed") {
    try {
      Sentry.captureException(new Error(SIGNOUT_CAPTURE_MESSAGE), await buildSignOutFailureReport(outcome.cause));
    } catch {
      // Swallowed on purpose, and it is the one swallow in this file that is correct: the report
      // is strictly less important than the redirect below. Nothing is logged — `src/` writes no
      // console output (`tests/lib/no-logging.test.ts`) — so a capture that fails is silent, which
      // is the same boundary this route already states about delivery.
    }
  }

  if (message === null) return context.redirect(path);
  // Assembled HERE rather than returned finished by `signOutLanding`, on purpose:
  // `tests/lib/form-endpoint-guards.test.ts`'s `?error=` sweeps are TEXTUAL, so a URL built
  // inside the helper would leave this file carrying no `error=` text for that guard to inspect.
  // Same shape as `signin.ts:36`.
  return context.redirect(`${path}?error=${encodeURIComponent(message)}`);
};
