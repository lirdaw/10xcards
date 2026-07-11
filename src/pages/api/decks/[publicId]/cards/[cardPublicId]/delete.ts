import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { deleteFlashcard, deckIdByPublicId } from "@/lib/flashcards";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Permanently delete a single flashcard from the signed-in user's deck. HTML
// forms can't issue DELETE, so this is a POST on a dedicated path, mirroring the
// deck delete endpoint. RLS plus the deck_id scoping guarantee only the owner's
// card in this deck can be removed; anything else touches 0 rows → 404. Errors
// surface as a page-level banner (`?error=<pl>`), no modal re-open.
export const POST: APIRoute = async (context) => {
  const { publicId, cardPublicId } = context.params;
  // Validate both route params as UUIDs before they land in a redirect `Location`
  // header. A malformed id can't match any deck/card anyway → 404.
  if (!publicId || !UUID_RE.test(publicId) || !cardPublicId || !UUID_RE.test(cardPublicId)) {
    return new Response(null, { status: 404 });
  }
  const errorUrl = (msg: string) => `/decks/${publicId}?error=${encodeURIComponent(msg)}`;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(errorUrl("Supabase nie jest skonfigurowany"));
  }

  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  // Resolve public_id → internal deck.id. Branch on the query error first so a
  // transient DB failure isn't masked as a 404 (lessons: SSR error-vs-empty).
  const { data: deck, error: deckError } = await deckIdByPublicId(supabase, publicId);
  if (deckError) {
    return context.redirect(errorUrl("Nie udało się usunąć fiszki"));
  }
  if (!deck) {
    return new Response(null, { status: 404 });
  }

  // Scoped by deck_id so a mismatched-but-owned deck path deletes 0 rows → 404,
  // rather than removing a card that belongs to a different deck.
  const { data: deleted, error } = await deleteFlashcard(supabase, deck.id, cardPublicId);
  if (error) {
    return context.redirect(errorUrl("Nie udało się usunąć fiszki"));
  }
  if (!deleted) {
    return new Response(null, { status: 404 });
  }

  return context.redirect(`/decks/${publicId}`);
};
