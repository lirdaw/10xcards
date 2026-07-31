import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createDeck, deckNameExists } from "@/lib/decks";
import { NAME_MIN, NAME_MAX } from "@/lib/deck-limits";
// Only genuine strings are read: a `File` part survives an `as string` cast and makes
// `.trim()` throw. See the helper's own comment for why it is not inlined here.
import { formString } from "@/lib/forms";
// Every `?error=` string this file emits comes from the closed set the deck pages vouch for by
// equality. Declaring one here instead would not fail loudly — it would fall out of the set and
// the banner would silently stop appearing.
import {
  SUPABASE_UNCONFIGURED_MESSAGE,
  DECK_NAME_MESSAGE,
  DECK_NAME_TAKEN_MESSAGE,
  DECK_CREATE_FAILED_MESSAGE,
} from "@/lib/redirect-errors";

// Create a deck for the signed-in user. Native form POST → redirect, following
// the `api/auth/signin.ts` convention (no JSON, errors via `?error=`). The DB is
// the second enforcer of the 1..100 length CHECK (`deck_name_check`) and the sole
// enforcer of UNIQUE (user_id, name); the app-side check shares its bound with the
// island via `deck-limits.ts` and produces the friendly Polish copy.
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/decks?error=${encodeURIComponent(SUPABASE_UNCONFIGURED_MESSAGE)}&open=create`);
  }

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  // formData() rejects for TWO causes: a body that was never a form (a crafted
  // `application/json` POST) and a form-typed body that arrived broken (client abort
  // mid-upload, truncation, transport reset). Unguarded, either is an uncontrolled framework
  // 500 with no project-owned body. Both causes deliberately share ONE message, unlike
  // signin/signup which split them: this endpoint's owned copy reads as "the operation failed"
  // and is truthful for both, and it is the literal the failure branch below already carries,
  // so the closed set does not grow. The full rationale is at cards/index.ts:41-54, the
  // endpoint this guard is copied from. A `File` part needs no message of its own either —
  // `formString` narrows it to "" and it falls into the length guard below.
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return context.redirect(`/decks?error=${encodeURIComponent(DECK_CREATE_FAILED_MESSAGE)}&open=create`);
  }
  const name = formString(form.get("name")).trim();

  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return context.redirect(`/decks?error=${encodeURIComponent(DECK_NAME_MESSAGE)}&open=create`);
  }

  // Friendly pre-check; the UNIQUE constraint remains the real backstop.
  const { data: existing } = await deckNameExists(supabase, name);
  if (existing) {
    return context.redirect(`/decks?error=${encodeURIComponent(DECK_NAME_TAKEN_MESSAGE)}&open=create`);
  }

  const { error } = await createDeck(supabase, user.id, name);
  if (error) {
    // 23505 = unique_violation: the pre-check lost a TOCTOU race. Map to the
    // same duplicate copy instead of surfacing a 500.
    const msg = error.code === "23505" ? DECK_NAME_TAKEN_MESSAGE : DECK_CREATE_FAILED_MESSAGE;
    return context.redirect(`/decks?error=${encodeURIComponent(msg)}&open=create`);
  }

  return context.redirect("/decks");
};
