import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createFlashcard, deckIdByPublicId, FRONT_MAX, BACK_MAX } from "@/lib/flashcards";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Create a manual flashcard in the signed-in user's deck. Native form POST →
// redirect, mirroring `api/decks/index.ts`. Errors round-trip back to the deck
// page with `?error=<pl>&open=create-card` so the create modal re-opens with the
// message inside it. Every card is inserted accepted + manual (the helper pins
// the state/source ids).
export const POST: APIRoute = async (context) => {
  const { publicId } = context.params;
  // Validate the route param as a UUID before it ever lands in a redirect
  // `Location` header. A malformed id can't match any deck anyway → 404.
  if (!publicId || !UUID_RE.test(publicId)) {
    return new Response(null, { status: 404 });
  }
  const errorUrl = (msg: string) => `/decks/${publicId}?error=${encodeURIComponent(msg)}&open=create-card`;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(errorUrl("Supabase nie jest skonfigurowany"));
  }

  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const front = ((form.get("front") as string | null) ?? "").trim();
  const back = ((form.get("back") as string | null) ?? "").trim();

  // Resolve public_id → internal deck.id before validating field lengths, so a
  // nonexistent/foreign deck always resolves to a clean 404 rather than bouncing
  // through a validation redirect into the (deck-null) 404 render. Branch on the
  // query error first so a transient DB failure isn't masked as a 404 (lessons:
  // SSR error-vs-empty). Only a genuine null (no row — absent or RLS-hidden) is a
  // real not-found → 404, so we never reveal that a foreign deck exists.
  const { data: deck, error: deckError } = await deckIdByPublicId(supabase, publicId);
  if (deckError) {
    return context.redirect(errorUrl("Nie udało się utworzyć fiszki"));
  }
  if (!deck) {
    return new Response(null, { status: 404 });
  }

  if (front.length < 1 || front.length > FRONT_MAX) {
    return context.redirect(errorUrl(`Przód fiszki musi mieć od 1 do ${FRONT_MAX} znaków`));
  }
  if (back.length < 1 || back.length > BACK_MAX) {
    return context.redirect(errorUrl(`Tył fiszki musi mieć od 1 do ${BACK_MAX} znaków`));
  }

  const { error } = await createFlashcard(supabase, deck.id, front, back);
  if (error) {
    return context.redirect(errorUrl("Nie udało się utworzyć fiszki"));
  }

  return context.redirect(`/decks/${publicId}`);
};
