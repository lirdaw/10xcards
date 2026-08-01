import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { updateFlashcard, deckIdByPublicId, FRONT_MAX, BACK_MAX } from "@/lib/flashcards";
// See cards/index.ts: only genuine strings are read, so a `File` part cannot crash `.trim()`.
import { formString } from "@/lib/forms";
// See api/decks/index.ts: the `?error=` strings are the closed set's, not this file's.
import {
  SUPABASE_UNCONFIGURED_MESSAGE,
  CARD_SAVE_FAILED_MESSAGE,
  CARD_FRONT_MESSAGE,
  CARD_BACK_MESSAGE,
} from "@/lib/redirect-errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Edit a manual flashcard's front/back in the signed-in user's deck. Native form
// POST → redirect, mirroring the create endpoint. Errors round-trip back with
// `?error=<pl>&edit=<cardPublicId>` so the matching card re-enters inline-edit
// mode with the message inside it. Only front/back change — deck_id, state_id and
// source_id are never touched.
//
// The same form is posted from two screens, so the redirect target follows the caller:
// the deck view by default, the review screen when the edit started there (S-05).
export const POST: APIRoute = async (context) => {
  const { publicId, cardPublicId } = context.params;
  // Validate both route params as UUIDs before they land in a redirect `Location`
  // header. A malformed id can't match any deck/card anyway → 404.
  if (!publicId || !UUID_RE.test(publicId) || !cardPublicId || !UUID_RE.test(cardPublicId)) {
    return new Response(null, { status: 404 });
  }

  // Same guard as the create endpoint — including that both rejection causes (never a form
  // vs a form-typed body that arrived broken) share one owned message here, because
  // "Nie udało się zapisać zmian" is truthful for both. See cards/index.ts.
  //
  // Note this catch runs BEFORE the `locals.user` check below, the reverse of the create
  // endpoint's order, so a signed-out caller reaching this handler directly would get the
  // deck error rather than /auth/signin. Unobservable in production — middleware guards
  // /api/decks first — but it is an ordering nobody chose, so do not read it as deliberate.
  //
  // The asymmetry below, by contrast, IS deliberate and must not be "fixed": here
  // `errorUrl` does not exist yet, because it is built from the `from`/`generation` fields
  // this very body would have carried. So the catch falls back to the unscoped deck-view
  // target. Moving formData() below errorUrl is NOT the fix — `from`/`generation` genuinely
  // gate which base path the error round-trips to, and the S-05 round-trip tests pin that.
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    const message = encodeURIComponent(CARD_SAVE_FAILED_MESSAGE);
    return context.redirect(`/decks/${publicId}?error=${message}&edit=${cardPublicId}`);
  }
  const front = formString(form.get("front")).trim();
  const back = formString(form.get("back")).trim();

  // `from` is a SWITCH with exactly one accepted value, never a redirect target, and
  // `generation` rides along only as a uuid: both targets below are built server-side
  // from the already-validated route params, so no client-supplied string can reach the
  // `Location` header. Anything else falls back to the deck view.
  const fromReview = formString(form.get("from")) === "review";
  const generation = formString(form.get("generation"));
  const scope = fromReview && UUID_RE.test(generation) ? `generation=${generation}&` : "";
  const basePath = fromReview ? `/decks/${publicId}/review` : `/decks/${publicId}`;
  const errorUrl = (msg: string) => `${basePath}?${scope}error=${encodeURIComponent(msg)}&edit=${cardPublicId}`;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(errorUrl(SUPABASE_UNCONFIGURED_MESSAGE));
  }

  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  // Resolve public_id → internal deck.id before validating field lengths, so a
  // nonexistent/foreign deck always resolves to a clean 404 rather than bouncing
  // through a validation redirect into the (deck-null) 404 render. Branch on the
  // query error first so a transient DB failure isn't masked as a 404 (lessons:
  // SSR error-vs-empty). Only a genuine null (no row — absent or RLS-hidden) is a
  // real not-found → 404.
  const { data: deck, error: deckError } = await deckIdByPublicId(supabase, publicId);
  if (deckError) {
    return context.redirect(errorUrl(CARD_SAVE_FAILED_MESSAGE));
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

  // Scoped by deck_id so a card from a different (even owned) deck can't be hit;
  // a 0-row update (missing/foreign card) resolves to a clean 404.
  const { data: updated, error } = await updateFlashcard(supabase, deck.id, cardPublicId, front, back);
  if (error) {
    return context.redirect(errorUrl(CARD_SAVE_FAILED_MESSAGE));
  }
  if (!updated) {
    return new Response(null, { status: 404 });
  }

  // `saved` lets the page play a one-shot "settle" animation on just this card as it
  // returns to read-only view; both workspaces strip the param on mount.
  return context.redirect(`${basePath}?${scope}saved=${cardPublicId}`);
};
