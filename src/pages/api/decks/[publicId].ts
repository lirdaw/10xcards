import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { deckNameExists, renameDeck } from "@/lib/decks";

const NAME_TAKEN = "Talia o tej nazwie już istnieje";

// Rename the signed-in user's deck. Same validation and duplicate handling as
// create (`api/decks/index.ts`). On error we round-trip back to the deck page
// with `?error=<msg>&open=rename` so it re-opens its own rename modal with the
// typed name prefilled — the context is already scoped to one deck.
export const POST: APIRoute = async (context) => {
  const { publicId } = context.params;
  if (!publicId) {
    return new Response(null, { status: 404 });
  }
  const errorUrl = (msg: string) => `/decks/${publicId}?error=${encodeURIComponent(msg)}&open=rename`;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(errorUrl("Supabase nie jest skonfigurowany"));
  }

  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const name = ((form.get("name") as string | null) ?? "").trim();

  if (name.length < 1 || name.length > 100) {
    return context.redirect(errorUrl("Nazwa talii musi mieć od 1 do 100 znaków"));
  }

  // Friendly pre-check; the UNIQUE constraint remains the real backstop. Renaming
  // to the same name (same deck) is a no-op, not a collision.
  const { data: existing } = await deckNameExists(supabase, name);
  if (existing && existing.public_id !== publicId) {
    return context.redirect(errorUrl(NAME_TAKEN));
  }

  const { data: updated, error } = await renameDeck(supabase, publicId, name);
  if (error) {
    // 23505 = unique_violation: the pre-check lost a TOCTOU race.
    const msg = error.code === "23505" ? NAME_TAKEN : "Nie udało się zmienić nazwy talii";
    return context.redirect(errorUrl(msg));
  }
  // RLS hid the deck or it does not exist → no row updated → 404, don't reveal it.
  if (!updated) {
    return new Response(null, { status: 404 });
  }

  return context.redirect(`/decks/${publicId}`);
};
