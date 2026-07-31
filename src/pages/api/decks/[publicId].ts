import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { deckNameExists, renameDeck } from "@/lib/decks";
import { NAME_MIN, NAME_MAX } from "@/lib/deck-limits";
// See api/decks/index.ts: a `File` part survives an `as string` cast and makes `.trim()` throw.
import { formString } from "@/lib/forms";
// See api/decks/index.ts: the `?error=` strings are the closed set's, not this file's.
import {
  SUPABASE_UNCONFIGURED_MESSAGE,
  DECK_NAME_MESSAGE,
  DECK_NAME_TAKEN_MESSAGE,
  DECK_RENAME_FAILED_MESSAGE,
} from "@/lib/redirect-errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rename the signed-in user's deck. Same validation and duplicate handling as
// create (`api/decks/index.ts`). On error we round-trip back to the deck page
// with `?error=<msg>&open=rename` so it re-opens its own rename modal with the
// typed name prefilled — the context is already scoped to one deck.
export const POST: APIRoute = async (context) => {
  const { publicId } = context.params;
  // Validate the route param as a UUID before it ever lands in a redirect
  // `Location` header. A malformed id can't match any deck anyway → 404.
  if (!publicId || !UUID_RE.test(publicId)) {
    return new Response(null, { status: 404 });
  }
  const errorUrl = (msg: string) => `/decks/${publicId}?error=${encodeURIComponent(msg)}&open=rename`;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(errorUrl(SUPABASE_UNCONFIGURED_MESSAGE));
  }

  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  // Same guard as create, same one-message decision, for the reasons recorded at
  // api/decks/index.ts and in full at cards/index.ts:41-54. `errorUrl` is already in scope
  // here — it is built from the route param at :26, eleven lines above and already UUID-gated —
  // so unlike cards/[cardPublicId].ts the catch has no ordering constraint to work around.
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return context.redirect(errorUrl(DECK_RENAME_FAILED_MESSAGE));
  }
  const name = formString(form.get("name")).trim();

  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return context.redirect(errorUrl(DECK_NAME_MESSAGE));
  }

  // Friendly pre-check; the UNIQUE constraint remains the real backstop. Renaming
  // to the same name (same deck) is a no-op, not a collision.
  const { data: existing } = await deckNameExists(supabase, name);
  if (existing && existing.public_id !== publicId) {
    return context.redirect(errorUrl(DECK_NAME_TAKEN_MESSAGE));
  }

  const { data: updated, error } = await renameDeck(supabase, publicId, name);
  if (error) {
    // 23505 = unique_violation: the pre-check lost a TOCTOU race.
    const msg = error.code === "23505" ? DECK_NAME_TAKEN_MESSAGE : DECK_RENAME_FAILED_MESSAGE;
    return context.redirect(errorUrl(msg));
  }
  // RLS hid the deck or it does not exist → no row updated → 404, don't reveal it.
  if (!updated) {
    return new Response(null, { status: 404 });
  }

  return context.redirect(`/decks/${publicId}`);
};
