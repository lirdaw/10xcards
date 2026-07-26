import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

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

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
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
      if (wantsJson(context.request)) {
        return new Response(JSON.stringify({ error: "Nie jesteś zalogowany" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
