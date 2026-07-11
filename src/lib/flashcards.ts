import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

// Single home for flashcard queries, mirroring src/lib/decks.ts. Every function
// takes an already-created SSR client, so all queries are RLS-scoped to the
// signed-in user. Cards are addressed by `public_id`; the internal `bigint id`
// (deck.id) is resolved server-side and never leaves the server. Error mapping to
// Polish copy stays in the endpoints.

type Client = SupabaseClient<Database>;

// The card shape passed from the loader to the React island. Only public-facing
// fields — the internal bigint `deck.id` never leaves the server. Dates are
// preformatted server-side (see formatCardDate) so the island stays presentational
// and there is no server/client timezone hydration mismatch.
export interface FlashcardView {
  publicId: string;
  front: string;
  back: string;
  createdAtLabel: string;
  updatedAtLabel: string;
  // True when the card was edited after creation (updated_at differs from
  // created_at) — lets the UI show the modification date only when meaningful.
  edited: boolean;
}

// Polish date+time with a fixed Warsaw timezone so the string is identical whether
// it renders on the server (Cloudflare, UTC) or the client — no hydration drift.
const cardDateFmt = new Intl.DateTimeFormat("pl-PL", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Warsaw",
});

export function formatCardDate(iso: string) {
  return cardDateFmt.format(new Date(iso));
}

// Pinned lookup IDs — see supabase/migrations/20260705180246_init_core_schema.sql
// (flashcard_state) and 20260710195327_manual_card_source.sql (flashcard_source).
// Referenced as constants rather than re-querying the lookup on every insert.
export const STATE_ACCEPTED = 2;
export const SOURCE_MANUAL = 1;

// Max front/back length is a BUSINESS RULE, not a DB CHECK — the database enforces
// only non-emptiness (char_length > 0). These can change without a migration.
// Enforced in two places only: the client form and the endpoint (after trim).
export const FRONT_MAX = 200;
export const BACK_MAX = 1000;

// Resolves a deck's public_id to its internal bigint id (stays server-side).
// Returns the raw { data, error } like the other helpers — callers MUST branch on
// `error` before treating `data == null` as "not found", so a transient DB error is
// never mistaken for a 404 (context/foundation/lessons.md: SSR error-vs-empty).
export function deckIdByPublicId(supabase: Client, deckPublicId: string) {
  return supabase.from("deck").select("id").eq("public_id", deckPublicId).maybeSingle();
}

export function listFlashcards(supabase: Client, deckId: number) {
  return supabase
    .from("flashcard")
    .select("public_id, front, back, created_at, updated_at")
    .eq("deck_id", deckId)
    .order("created_at", { ascending: false });
}

export function createFlashcard(supabase: Client, deckId: number, front: string, back: string) {
  return supabase
    .from("flashcard")
    .insert({ deck_id: deckId, front, back, state_id: STATE_ACCEPTED, source_id: SOURCE_MANUAL });
}

// Updates front/back only. Scoped by both public_id and deck_id (on top of RLS's
// cross-account guard) so a card that isn't in this deck can't be hit — a
// mismatched-but-owned deck path resolves to a clean 404 rather than mutating a
// card that belongs to a different deck. maybeSingle() surfaces the 0-row/404 case.
export function updateFlashcard(supabase: Client, deckId: number, cardPublicId: string, front: string, back: string) {
  return supabase
    .from("flashcard")
    .update({ front, back })
    .eq("public_id", cardPublicId)
    .eq("deck_id", deckId)
    .select("public_id")
    .maybeSingle();
}

export function deleteFlashcard(supabase: Client, deckId: number, cardPublicId: string) {
  return supabase
    .from("flashcard")
    .delete()
    .eq("public_id", cardPublicId)
    .eq("deck_id", deckId)
    .select("public_id")
    .maybeSingle();
}
