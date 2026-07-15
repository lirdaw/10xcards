import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { deleteDeck } from "@/lib/decks";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Permanently delete the signed-in user's deck (cascade removes any cards).
// HTML forms can't issue DELETE, so this is a POST on a dedicated path. RLS is
// what scopes the delete to the owner: someone else's deck touches 0 rows — a
// silent no-op, not an error — so the 0-row case is read off RETURNING and
// answered with a 404, mirroring the rename endpoint and the card endpoints.
// 404 not 403: an absent deck and an RLS-hidden one must stay indistinguishable.
export const POST: APIRoute = async (context) => {
  const { publicId } = context.params;
  // Validate the route param as a UUID before it ever lands in a redirect
  // `Location` header. A malformed id can't match any deck anyway → 404.
  if (!publicId || !UUID_RE.test(publicId)) {
    return new Response(null, { status: 404 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    const msg = "Supabase nie jest skonfigurowany";
    return context.redirect(`/decks/${publicId}?error=${encodeURIComponent(msg)}`);
  }

  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  const { data: deleted, error } = await deleteDeck(supabase, publicId);
  if (error) {
    const msg = "Nie udało się usunąć talii";
    return context.redirect(`/decks/${publicId}?error=${encodeURIComponent(msg)}`);
  }
  // RLS hid the deck or it does not exist → no row deleted → 404, don't reveal it.
  if (!deleted) {
    return new Response(null, { status: 404 });
  }

  return context.redirect("/decks");
};
