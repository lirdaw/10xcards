import { defineMiddleware } from "astro:middleware";
import * as Sentry from "@sentry/cloudflare";
import { createClient } from "@/lib/supabase";
import { authGuardLanding, classifyAuthError } from "@/lib/auth-outcome";
// The FOURTH module in `src/` to import the Sentry SDK, after `src/worker.ts`,
// `src/pages/api/generate.ts` and `src/pages/api/auth/signout.ts`. The reasons those give for the
// import being safe are properties of the package and of the SDK's global hub rather than of any
// route, so they transfer verbatim: `@sentry/cloudflare` carries no `cloudflare:` runtime import
// outside its `./vite` export, and with no client configured `captureException` returns an event
// id and does nothing else — which is its state under the test runner and under `npm run dev`
// without a DSN. That last property is what makes the import safe on a file running on EVERY
// request: the cost of the unconfigured case is a function call, not a transport.
import { AUTH_CHECK_CAPTURE_MESSAGE, buildAuthCheckFailureReport, thrownAsAuthCheckCause } from "@/lib/auth-outcome";
import type { AuthCheckOutcome } from "@/lib/auth-outcome";

// Prefix-matched below, so "/api/study" needs its own entry — it does NOT begin with
// "/study". Exported for tests/middleware.test.ts, which drives this array rather than a
// copy of it: a duplicated list would stay green while a new route went unprotected.
export const PROTECTED_ROUTES = [
  "/dashboard",
  "/decks",
  "/api/decks",
  "/generate",
  "/api/generate",
  "/study",
  "/api/study",
];

/**
 * Does the caller want JSON back, or a page?
 *
 * The guard must answer in the format its caller expects. Branching on the PATH would be
 * wrong: six protected `/api/*` routes are native `<form method="POST">` targets — i.e.
 * full-page navigations — and a JSON body would leave those submits on a dead-end page with
 * no way back to sign-in. So the discriminator is the request itself. All three fetch sites
 * send `Content-Type: application/json`; no native form ever does (forms send
 * urlencoded/multipart). `Sec-Fetch-Dest` widens that to a body-less JSON GET, and settles
 * the ambiguous cases first: `document` is a navigation whatever else it carries, `empty` is
 * a fetch/XHR.
 */
/** The request headers `wantsJson` reads — every one of them selects the representation. */
const VARY_ON_CALLER = "Sec-Fetch-Dest, Content-Type, Accept";

function wantsJson(request: Request): boolean {
  const dest = request.headers.get("Sec-Fetch-Dest");
  if (dest === "document") return false;
  if (dest === "empty") return true;

  if (request.headers.get("Content-Type")?.includes("application/json")) return true;

  const accept = request.headers.get("Accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  // C10X-52. This used to destructure `{ data: { user } }` and DISCARD the error, so a dead
  // GoTrue was byte-indistinguishable from an anonymous visitor: a user holding a perfectly
  // valid session was bounced to `/auth/signin`, and a fetching island was told "Twoja sesja
  // wygasła". The read-side twin of the sign-out swallow C10X-51 closed, and the last of the
  // 2026-08-11 audit's five hits.
  //
  // WHY A CLASSIFIER AND NOT `if (error)`. `getUser()` answers with an error for the ORDINARY
  // signed-out visitor too, before any network call at all — so the plain check the sign-out
  // route could afford would banner every anonymous visitor to `/`, `/auth/signin` and
  // `/auth/signup`. The split itself lives in `@/lib/auth-outcome` because BOTH failure states
  // are unreachable from this project's suite (that module's header carries the argument); this
  // file owns only what a pure function cannot — observing `getUser()`, and assembling the two
  // responses below.
  //
  // `locals.user` is assigned EXACTLY as before: the `User` when there is one, `null` otherwise,
  // no new field and no widened union (D-04). That is what keeps the `/` → `/decks` rule below,
  // `Layout.astro`'s `Boolean(Astro.locals.user)` and every other consumer behaving as today —
  // including the one place where getting truthiness wrong would turn a suppression into a
  // disclosure (the config banner an anonymous visitor must not see).
  //
  // The outcome is a local, never on `locals`, and it is computed UNCONDITIONALLY: when a user
  // came back `error` is `null` and the classifier answers `no-session`, which nothing reads —
  // the value is consulted only inside `if (!context.locals.user)` below, which is also why
  // `AuthCheckOutcome` has no `signed-in` variant.
  let outcome: AuthCheckOutcome;
  if (!supabase) {
    context.locals.user = null;
    // Its own variant rather than `unavailable`, because the two land DIFFERENT copy — "this
    // deployment has no auth service configured" versus "we could not reach the one it has" —
    // and it never passes through `classifyAuthError`, which has no input for it. A deliberate
    // widening past the audit's five hits (D-02): the same condition is already a user-visible
    // refusal on all three sibling auth routes.
    outcome = { kind: "unconfigured" };
  } else {
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      context.locals.user = user ?? null;
      outcome = { kind: classifyAuthError(error) };
    } catch (thrown) {
      // `_getUser` rethrows anything that is not an `AuthError` (`GoTrueClient.js:2516`), and
      // this file had no `catch` — so that state was an uncaught 500 on EVERY request, owned by
      // no ticket (D-03). A throw and a returned error leave the caller in the same place, so
      // both collapse onto one outcome, the same way `signout.ts:84-86` does one route over.
      //
      // CONSTRUCTED HERE rather than routed through `classifyAuthError`, and that is the whole
      // division of labour: the classifier's `default` falls to `no-session` on purpose, and a
      // thrown value is the one input for which that direction is wrong. Sending it through
      // would force two opposite defaults into a single arm — which is how this ticket's own
      // defect gets shipped inverted.
      context.locals.user = null;
      outcome = { kind: "unavailable" };

      // THE SECOND CHANNEL, and its scope is the one thing to read carefully here: it is on the
      // THROW only, never on the returned-error path a line above. Those two land the same
      // outcome and the same response on purpose — the user cannot act on the difference — but
      // they are different POPULATIONS, and D-01's argument against a capture in this file is an
      // argument about volume that holds for one of them and not the other. A returned
      // `AuthError` is an infrastructure event arriving once per request for as long as GoTrue is
      // down, so a capture there is unsampled by construction and self-masking on quota: D-01
      // stands, and there is no capture on that branch. A throw is a BUG — auth-js rethrows only
      // non-`AuthError` values — so it is rare by construction and carries none of that hazard.
      // Without this it was the one class here that got strictly HARDER to find than before
      // C10X-52: an uncaught 500 became a plausible-looking "backend briefly unreachable" that
      // reaches nobody, `src/` writing no console output (`tests/lib/no-logging.test.ts`).
      // Added by this change's impl-review (F1); the full argument is at the builder.
      //
      // Wrapped, and the wrap is not defensive habit — it is `signout.ts:126-135`'s rule, which
      // matters more here than anywhere it has been applied before. `buildAuthCheckFailureReport`
      // awaits `crypto.subtle.digest`; if that rejected, the rejection would escape this
      // middleware and Astro would answer an uncaught 500 on EVERY request — reinstating the
      // exact hole D-03 exists to close, from inside the code that closes it. A forensic report
      // must never outrank the response it annotates. The inner swallow is silent for the same
      // reason the outer one cannot be logged, and it is the same boundary this change already
      // states about delivery: nothing here proves an event ARRIVES.
      //
      // The exception is SYNTHETIC and the cause travels as the builder's ARGUMENT: the first
      // argument lands on the event as `exception.values[].value`, where no builder can reach it,
      // so passing `thrown` itself would ship whatever free-form strings it carries past every
      // guard. `tests/lib/sentry-capture-wiring.test.ts` holds that shape per statement.
      try {
        Sentry.captureException(
          new Error(AUTH_CHECK_CAPTURE_MESSAGE),
          await buildAuthCheckFailureReport(thrownAsAuthCheckCause(thrown)),
        );
      } catch {
        // Deliberate, and the one swallow in this file that is correct: the report is strictly
        // less important than serving the request.
      }
    }
  }

  // Authenticated users skip the guest landing and go straight to their decks.
  if (context.url.pathname === "/" && context.locals.user) {
    return context.redirect("/decks");
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      // Inside the guard, never before it: hoisting this would make every /api/ path require
      // a session, including /api/auth/signin — which presents as "the login form does
      // nothing". A JSON caller gets the same 401 shape its endpoint would have returned
      // (src/pages/api/study.ts), so the island's existing error branch just works.
      // `Vary` on BOTH branches: one URL now has two representations chosen by request
      // headers, so a shared cache that stored the 401 could serve it to a document
      // navigation — the dead-end JSON page this discriminator exists to prevent. Neither
      // response is cacheable today (no Cache-Control; 302 is not cacheable by default), so
      // this closes the class rather than fixing a live bug.
      //
      // The outage split sits INSIDE both existing conditions, never above either. Hoisting it
      // past `PROTECTED_ROUTES.some(...)` would make an outage gate `/auth/signin` itself — the
      // circularity the landing choice exists to avoid — and hoisting it past the `!user` test
      // would answer a signed-in caller with it.
      //
      // Destructured, and the SHAPE is load-bearing rather than style:
      // `tests/lib/form-endpoint-guards.test.ts` binds a vouched name only from the literal
      // pattern `const {…} = <fn>(`, and its exemption sits after the identifier test by design —
      // so a value held as an object and read as `landing.message` would be refused on a correct
      // line. `signout.ts:89` is the shape this copies.
      const { message } = authGuardLanding(outcome);

      // `null` means there is nothing to report beyond "sign in", i.e. the ordinary signed-out
      // visitor, whose experience below is byte-identical to before this change. Anything else is
      // the backend failing, and it gets its own representation on each branch.
      if (message !== null) {
        if (wantsJson(context.request)) {
          // 503, NOT 401, and the status is the whole fix on this branch: `src/lib/http.ts:52-53`
          // replaces the body of ANY 401 with "Twoja sesja wygasła", so a 401 carrying outage copy
          // would arrive at the island as the very message this ticket removes. A non-401 falls
          // through to that module's generic arm and renders the `error` below verbatim. No
          // `retriable` and no `Retry-After` (D-09): an absent flag already means retriable
          // (C10X-48 D-08), and a retry delay would be a number invented here and read by nobody.
          return new Response(JSON.stringify({ error: message }), {
            status: 503,
            headers: { "Content-Type": "application/json", Vary: VARY_ON_CALLER },
          });
        }
        // Assembled HERE rather than returned finished by `authGuardLanding`, for the reason
        // `signout.ts:138-142` records: the `?error=` sweeps are TEXTUAL, so a URL built inside
        // the module would leave this file carrying nothing for the guard to inspect. One line and
        // a template literal, both deliberately: a concatenation contributes zero emissions to
        // that sweep, `?error="` matches its inline-literal detector on a correct line, and a call
        // Prettier wraps is never inspected at all.
        //
        // The query string is on the NEW branch only. The signed-out redirect below is asserted by
        // equality in `tests/middleware.test.ts` and by a bare glob in
        // `tests/e2e/route-guard.spec.ts`; appending to it would redden both for no gain.
        const toSignInWithReason = context.redirect(`/auth/signin?error=${encodeURIComponent(message)}`);
        toSignInWithReason.headers.set("Vary", VARY_ON_CALLER);
        return toSignInWithReason;
      }

      if (wantsJson(context.request)) {
        return new Response(JSON.stringify({ error: "Nie jesteś zalogowany" }), {
          status: 401,
          headers: { "Content-Type": "application/json", Vary: VARY_ON_CALLER },
        });
      }
      const toSignIn = context.redirect("/auth/signin");
      toSignIn.headers.set("Vary", VARY_ON_CALLER);
      return toSignIn;
    }
  }

  return next();
});
