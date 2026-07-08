import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { deleteDeck } from "@/lib/decks";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Permanently delete the signed-in user's deck (cascade removes any cards).
// HTML forms can't issue DELETE, so this is a POST on a dedicated path. RLS
// guarantees only the owner's deck can be deleted (someone else's touches 0 rows).
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

  const { error } = await deleteDeck(supabase, publicId);
  if (error) {
    const msg = "Nie udało się usunąć talii";
    return context.redirect(`/decks/${publicId}?error=${encodeURIComponent(msg)}`);
  }

  return context.redirect("/decks");
};
