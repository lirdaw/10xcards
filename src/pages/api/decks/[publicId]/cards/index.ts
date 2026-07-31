import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createFlashcard, deckIdByPublicId, FRONT_MAX, BACK_MAX } from "@/lib/flashcards";
// Only genuine strings are read: a `File` part survives an `as string` cast and makes
// `.trim()` throw. See the helper's own comment for why it is not inlined here.
import { formString } from "@/lib/forms";
// See api/decks/index.ts: the `?error=` strings are the closed set's, not this file's. The two
// length messages are built there from the same FRONT_MAX/BACK_MAX imported above.
import {
  SUPABASE_UNCONFIGURED_MESSAGE,
  CARD_CREATE_FAILED_MESSAGE,
  CARD_FRONT_MESSAGE,
  CARD_BACK_MESSAGE,
} from "@/lib/redirect-errors";

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
    return context.redirect(errorUrl(SUPABASE_UNCONFIGURED_MESSAGE));
  }

  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  // formData() rejects for TWO causes, not one: a body that was never a form (a crafted
  // `application/json` POST) and a form-typed body that arrived broken (client abort
  // mid-upload, truncation, transport reset). Unguarded, either is an uncontrolled framework
  // 500 with no project-owned body; both JSON endpoints (cards/batch.ts, api/generate.ts)
  // already answer their own fixed response here, and this applies the same convention to
  // the form side.
  //
  // Both causes deliberately share ONE message here, unlike signin/signup which split them:
  // this endpoint's owned copy is "Nie udało się utworzyć fiszki", which reads as "the
  // operation failed" and is already truthful for both — so a branch would add code with no
  // observable difference. The auth routes split because their catch answered "Popraw dane w
  // formularzu", which is a claim ABOUT THE USER'S INPUT and is wrong for a dropped upload.
  // The literal is the one the two failure branches below already carry, so the closed set of
  // owned messages does not grow.
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return context.redirect(errorUrl(CARD_CREATE_FAILED_MESSAGE));
  }
  const front = formString(form.get("front")).trim();
  const back = formString(form.get("back")).trim();

  // Resolve public_id → internal deck.id before validating field lengths, so a
  // nonexistent/foreign deck always resolves to a clean 404 rather than bouncing
  // through a validation redirect into the (deck-null) 404 render. Branch on the
  // query error first so a transient DB failure isn't masked as a 404 (lessons:
  // SSR error-vs-empty). Only a genuine null (no row — absent or RLS-hidden) is a
  // real not-found → 404, so we never reveal that a foreign deck exists.
  const { data: deck, error: deckError } = await deckIdByPublicId(supabase, publicId);
  if (deckError) {
    return context.redirect(errorUrl(CARD_CREATE_FAILED_MESSAGE));
  }
  if (!deck) {
    return new Response(null, { status: 404 });
  }

  if (front.length < 1 || front.length > FRONT_MAX) {
    return context.redirect(errorUrl(CARD_FRONT_MESSAGE));
  }
  if (back.length < 1 || back.length > BACK_MAX) {
    return context.redirect(errorUrl(CARD_BACK_MESSAGE));
  }

  const { error } = await createFlashcard(supabase, deck.id, front, back);
  if (error) {
    return context.redirect(errorUrl(CARD_CREATE_FAILED_MESSAGE));
  }

  return context.redirect(`/decks/${publicId}`);
};
