import type { APIRoute } from "astro";
import type { AuthErrorLike } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase";
import { signOutLanding, type SignOutOutcome } from "@/lib/signout-outcome";

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
 * Read structurally and never as `message`: a thrown value is `unknown`, and `message` is the
 * field `@/lib/auth-errors` exists to keep out of a URL (GoTrue interpolates the submitted
 * address into its own copy). Anything unrecognisable degrades to `{}`, which the mapper answers
 * with a project constant rather than by failing.
 */
function thrownAsCause(thrown: unknown): AuthErrorLike {
  if (typeof thrown !== "object" || thrown === null) return {};
  const { code, name, status } = thrown as Record<string, unknown>;
  return {
    code: typeof code === "string" ? code : undefined,
    name: typeof name === "string" ? name : undefined,
    status: typeof status === "number" ? status : undefined,
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

  const { path, message } = signOutLanding(outcome);
  if (message === null) return context.redirect(path);
  // Assembled HERE rather than returned finished by `signOutLanding`, on purpose:
  // `tests/lib/form-endpoint-guards.test.ts`'s `?error=` sweeps are TEXTUAL, so a URL built
  // inside the helper would leave this file carrying no `error=` text for that guard to inspect.
  // Same shape as `signin.ts:36`.
  return context.redirect(`${path}?error=${encodeURIComponent(message)}`);
};
