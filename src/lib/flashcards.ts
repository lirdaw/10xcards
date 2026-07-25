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
  // Provenance and lifecycle, for the review screen's badges. OPTIONAL on purpose,
  // and not merely as convenience (plan-review F2 + F8): the deck loader maps the
  // list branch and the search branch through ONE .map(), and the search RPC has a
  // fixed projection — so a REQUIRED field one branch cannot supply would be
  // `undefined` at runtime with nothing catching it (ESLint does not report a missing
  // property, `astro build` does not type-check, and no script runs `astro check`).
  // Only the review loader fills these; listFlashcards and the deck loader do not.
  source?: "ai" | "manual";
  state?: "generated" | "accepted" | "rejected";
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
// This module is the single home for the lifecycle ids: generations.ts imports
// STATE_GENERATED from here rather than declaring a second literal for the same row.
export const STATE_GENERATED = 1;
export const STATE_ACCEPTED = 2;
export const STATE_REJECTED = 3;
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

// Default deck list shows only ACCEPTED cards, so AI candidates (`generated`) and
// rejected cards never leak into the deck view. Signature unchanged — no stateId
// param; browsing candidates by state is S-05 (candidate-review). Manual cards are
// inserted `accepted` (createFlashcard below), so this hides only AI candidates.
export function listFlashcards(supabase: Client, deckId: number) {
  return supabase
    .from("flashcard")
    .select("public_id, front, back, created_at, updated_at")
    .eq("deck_id", deckId)
    .eq("state_id", STATE_ACCEPTED)
    .order("created_at", { ascending: false });
}

// The candidate read path: the same deck, seen by lifecycle state instead of the
// accepted-only view above. This is what makes generated candidates survive a reload —
// until S-05 they existed only in the generator island's React state.
//
// Projects listFlashcards' columns PLUS state_id/source_id/generation_id: the review
// screen renders badges from the first two and scopes to one session with the third.
// `generationId` narrows to a single generation (`?generation=<sessionPublicId>`,
// resolved to its internal id by the loader); omitted, the whole deck's cards in that
// state come back. No pagination, deliberately — a generation caps at 15 cards.
export function listFlashcardsByState(supabase: Client, deckId: number, stateId: number, generationId?: number) {
  const query = supabase
    .from("flashcard")
    .select("public_id, front, back, created_at, updated_at, state_id, source_id, generation_id")
    .eq("deck_id", deckId)
    .eq("state_id", stateId);
  return (generationId === undefined ? query : query.eq("generation_id", generationId)).order("created_at", {
    ascending: false,
  });
}

// Pending-candidate counts for the whole deck list, keyed by deck public_id — the
// "N do przeglądu" chip. ONE query for every deck, never a per-deck count: study's
// structurally identical due-count chip already settled that (src/pages/study/index.astro),
// and a per-deck query is an N+1 that grows with the deck list.
//
// The deck's public_id is read through the FK (`deck!inner`) so the grouping key needs no
// second round-trip. RLS-scoped like everything else: another account's decks contribute
// nothing, and a deck with no candidates is ABSENT from the map rather than 0 — the deck
// list renders no chip for it, which is the same branch. Mirrors listDueCounts' shape.
export async function countCandidatesByDeck(supabase: Client) {
  const { data, error } = await supabase
    .from("flashcard")
    .select("deck!inner(public_id)")
    .eq("state_id", STATE_GENERATED);
  if (error) return { data: null, error };

  const counts: Record<string, number> = {};
  for (const row of data) counts[row.deck.public_id] = (counts[row.deck.public_id] ?? 0) + 1;
  return { data: counts, error: null };
}

// Lookup id -> the badge strings FlashcardView carries, so an island never learns about
// lookup ids. Kept next to formatCardDate because they serve the same purpose: everything
// the row needs to render is resolved server-side.
export function stateLabel(stateId: number): FlashcardView["state"] {
  if (stateId === STATE_ACCEPTED) return "accepted";
  if (stateId === STATE_REJECTED) return "rejected";
  return "generated";
}

export function sourceLabel(sourceId: number): FlashcardView["source"] {
  return sourceId === SOURCE_MANUAL ? "manual" : "ai";
}

// Keyword search within one deck (FR-015): accent- and case-insensitive substring
// match on front/back, via the search_flashcards_in_deck RPC. SECURITY INVOKER, so
// RLS still scopes rows to the signed-in user. Superset of listFlashcards' result shape
// (public_id, front, back, created_at, updated_at, plus source_id), so the deck loader
// maps it through the same .map() — and, since S-05, it applies the SAME accepted-only
// gate, so a search can no longer surface candidates or rejected cards in a view that
// otherwise hides them (migration 20260725112600_search_accepted_only.sql).
// The RPC's internal ORDER BY is not guaranteed once PostgREST wraps it, so the
// created_at desc order is re-asserted here with an explicit .order().
export function searchFlashcards(supabase: Client, deckId: number, query: string) {
  return supabase
    .rpc("search_flashcards_in_deck", { p_deck_id: deckId, p_query: query })
    .order("created_at", { ascending: false });
}

// Count of ALL cards in a deck (unfiltered, head-only — no rows fetched). Used only
// to tell a genuinely empty deck apart from a search that matched nothing, so the
// empty state can show the right copy ("deck is empty" vs "no matches for <q>").
export function countFlashcards(supabase: Client, deckId: number) {
  return supabase.from("flashcard").select("*", { count: "exact", head: true }).eq("deck_id", deckId);
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

// The legal transition graph, keyed by TARGET state: a move is allowed only from one of
// the listed states. `generated` is deliberately absent as a key — a card never returns to
// being a candidate, so a request for it matches an empty allow-list and therefore no rows.
//
// The rule lives here and nowhere else: no CHECK, no trigger. The database constrains
// which state ids exist, not which moves between them are legal — consistent with
// FRONT_MAX/BACK_MAX being business rules rather than DB constraints.
export const ALLOWED_FROM: Record<number, number[]> = {
  [STATE_ACCEPTED]: [STATE_GENERATED, STATE_REJECTED],
  [STATE_REJECTED]: [STATE_GENERATED, STATE_ACCEPTED],
};

// The project's first lifecycle transition, and its first multi-row mutation.
//
// The guard is the `.in("state_id", ALLOWED_FROM[target])` predicate: an illegal move, an
// already-applied one, a card from another deck, or another account's card all match zero
// rows — and under RLS a zero-row UPDATE reports NO error, so the absence of an error
// proves nothing. RETURNING (`.select(...)`) is therefore the contract: the caller diffs
// what came back against what it asked for to derive per-id outcomes. Same shape as
// rateCard's compare-and-set, which makes double-clicks and retries benign by construction.
//
// Scoped by deck_id on top of RLS, as updateFlashcard is: a card that isn't in this deck
// can't be hit even by an owner who mixes up ids.
export function setFlashcardState(supabase: Client, deckId: number, cardPublicIds: string[], targetStateId: number) {
  return supabase
    .from("flashcard")
    .update({ state_id: targetStateId })
    .in("public_id", cardPublicIds)
    .eq("deck_id", deckId)
    .in("state_id", ALLOWED_FROM[targetStateId] ?? [])
    .select("public_id, state_id");
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
