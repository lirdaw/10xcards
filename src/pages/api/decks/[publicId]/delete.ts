import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { deleteDeck } from "@/lib/decks";

// Permanently delete the signed-in user's deck (cascade removes any cards).
// HTML forms can't issue DELETE, so this is a POST on a dedicated path. RLS
// guarantees only the owner's deck can be deleted (someone else's touches 0 rows).
export const POST: APIRoute = async (context) => {
  const { publicId } = context.params;
  if (!publicId) {
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
