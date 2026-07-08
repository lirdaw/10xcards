import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

// Single home for deck queries so pages and endpoints don't duplicate Supabase
// logic. Every function takes an already-created SSR client, so all queries are
// RLS-scoped to the signed-in user. Routes address decks by `public_id`, never
// the internal `bigint id`. Error mapping to Polish copy stays in the endpoints.

type Client = SupabaseClient<Database>;

export function listDecks(supabase: Client) {
  return supabase.from("deck").select("public_id, name, created_at").order("created_at", { ascending: false });
}

export function getDeckByPublicId(supabase: Client, publicId: string) {
  return supabase.from("deck").select("public_id, name").eq("public_id", publicId).maybeSingle();
}

export function deckNameExists(supabase: Client, name: string) {
  return supabase.from("deck").select("public_id").eq("name", name).maybeSingle();
}

export function createDeck(supabase: Client, userId: string, name: string) {
  return supabase.from("deck").insert({ user_id: userId, name });
}

export function renameDeck(supabase: Client, publicId: string, name: string) {
  return supabase.from("deck").update({ name }).eq("public_id", publicId).select("public_id").maybeSingle();
}

export function deleteDeck(supabase: Client, publicId: string) {
  return supabase.from("deck").delete().eq("public_id", publicId);
}
