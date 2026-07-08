import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createDeck, deckNameExists } from "@/lib/decks";

const NAME_TAKEN = "Talia o tej nazwie już istnieje";

// Create a deck for the signed-in user. Native form POST → redirect, following
// the `api/auth/signin.ts` convention (no JSON, errors via `?error=`). The DB is
// the source of truth for the 1..100 length CHECK and the UNIQUE (user_id, name)
// constraint; app-side checks just produce friendly Polish copy.
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/decks?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}&open=create`);
  }

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const name = ((form.get("name") as string | null) ?? "").trim();

  if (name.length < 1 || name.length > 100) {
    const msg = "Nazwa talii musi mieć od 1 do 100 znaków";
    return context.redirect(`/decks?error=${encodeURIComponent(msg)}&open=create`);
  }

  // Friendly pre-check; the UNIQUE constraint remains the real backstop.
  const { data: existing } = await deckNameExists(supabase, name);
  if (existing) {
    return context.redirect(`/decks?error=${encodeURIComponent(NAME_TAKEN)}&open=create`);
  }

  const { error } = await createDeck(supabase, user.id, name);
  if (error) {
    // 23505 = unique_violation: the pre-check lost a TOCTOU race. Map to the
    // same duplicate copy instead of surfacing a 500.
    const msg = error.code === "23505" ? NAME_TAKEN : "Nie udało się utworzyć talii";
    return context.redirect(`/decks?error=${encodeURIComponent(msg)}&open=create`);
  }

  return context.redirect("/decks");
};
