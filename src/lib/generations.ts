import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/db/database.types";

// Single home for generation-session + candidate-card writes, mirroring
// src/lib/flashcards.ts. Every function takes an already-created SSR client, so all
// queries are RLS-scoped to the signed-in user. Returns the raw { data, error } like
// the other helpers — error mapping to Polish copy stays in the endpoint.

type Client = SupabaseClient<Database>;

// Pinned lookup IDs — see supabase/migrations/20260705180246_init_core_schema.sql
// (flashcard_state) and 20260710195327_manual_card_source.sql (flashcard_source).
// AI candidates land as `generated` (state 1) + `ai` (source 2); referenced as
// constants rather than re-querying the lookup on every insert.
export const STATE_GENERATED = 1;
export const SOURCE_AI = 2;

// Writes the audit row for one OpenRouter call (succeeded OR failed). The session is
// the parent of its candidate cards: insert the session first, read back its bigint
// `id` (server-side only) + `public_id` (returned to the island), then insert cards.
export function createGenerationSession(supabase: Client, row: TablesInsert<"generation_session">) {
  return supabase.from("generation_session").insert(row).select("id, public_id").single();
}

// Bulk-inserts validated candidates into a deck, stamping state/source/generation link.
// Only called on success with a non-empty list (the endpoint guards saved_count > 0).
export function insertCandidates(
  supabase: Client,
  deckId: number,
  generationId: number,
  cards: { front: string; back: string }[],
) {
  return supabase.from("flashcard").insert(
    cards.map((card) => ({
      deck_id: deckId,
      front: card.front,
      back: card.back,
      state_id: STATE_GENERATED,
      source_id: SOURCE_AI,
      generation_id: generationId,
    })),
  );
}
