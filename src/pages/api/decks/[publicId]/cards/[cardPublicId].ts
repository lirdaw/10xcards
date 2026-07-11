import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { updateFlashcard, deckIdByPublicId, FRONT_MAX, BACK_MAX } from "@/lib/flashcards";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Edit a manual flashcard's front/back in the signed-in user's deck. Native form
// POST → redirect, mirroring the create endpoint. Errors round-trip back with
// `?error=<pl>&edit=<cardPublicId>` so the matching card re-enters inline-edit
// mode with the message inside it. Only front/back change — deck_id, state_id and
// source_id are never touched.
export const POST: APIRoute = async (context) => {
  const { publicId, cardPublicId } = context.params;
  // Validate both route params as UUIDs before they land in a redirect `Location`
  // header. A malformed id can't match any deck/card anyway → 404.
  if (!publicId || !UUID_RE.test(publicId) || !cardPublicId || !UUID_RE.test(cardPublicId)) {
    return new Response(null, { status: 404 });
  }
  const errorUrl = (msg: string) => `/decks/${publicId}?error=${encodeURIComponent(msg)}&edit=${cardPublicId}`;

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
  // real not-found → 404.
  const { data: deck, error: deckError } = await deckIdByPublicId(supabase, publicId);
  if (deckError) {
    return context.redirect(errorUrl("Nie udało się zapisać zmian"));
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

  // Scoped by deck_id so a card from a different (even owned) deck can't be hit;
  // a 0-row update (missing/foreign card) resolves to a clean 404.
  const { data: updated, error } = await updateFlashcard(supabase, deck.id, cardPublicId, front, back);
  if (error) {
    return context.redirect(errorUrl("Nie udało się zapisać zmian"));
  }
  if (!updated) {
    return new Response(null, { status: 404 });
  }

  // `saved` lets the deck page play a one-shot "settle" animation on just this
  // card as it returns to read-only view; the workspace strips the param on mount.
  return context.redirect(`/decks/${publicId}?saved=${cardPublicId}`);
};
