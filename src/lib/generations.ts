import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/db/database.types";
import { STATE_ACCEPTED, STATE_GENERATED, STATE_REJECTED } from "@/lib/flashcards";

// Single home for generation-session + candidate-card writes, mirroring
// src/lib/flashcards.ts. Every function takes an already-created SSR client, so all
// queries are RLS-scoped to the signed-in user. Returns the raw { data, error } like
// the other helpers — error mapping to Polish copy stays in the endpoint.

type Client = SupabaseClient<Database>;

// Pinned lookup IDs — see supabase/migrations/20260710195327_manual_card_source.sql
// (flashcard_source). AI candidates land as `generated` (state 1) + `ai` (source 2);
// referenced as constants rather than re-querying the lookup on every insert. The
// lifecycle ids live in src/lib/flashcards.ts (their single home, alongside the
// transition graph) and are imported from there — S-05 added two more of them, and a
// second literal for the same lookup row is how the two drift apart.
export const SOURCE_AI = 2;

// Writes the audit row for one OpenRouter call (succeeded OR failed). The session is
// the parent of its candidate cards: insert the session first, read back its bigint
// `id` (server-side only) + `public_id` (returned to the island), then insert cards.
export function createGenerationSession(supabase: Client, row: TablesInsert<"generation_session">) {
  return supabase.from("generation_session").insert(row).select("id, public_id").single();
}

// Resolves a session's public_id (the `?generation=` URL scope) to its internal bigint
// id, which is what flashcard.generation_id holds. Returns the raw { data, error } like
// the other helpers — callers MUST branch on `error` before treating `data == null` as
// "not found", so a transient DB error is never mistaken for a 404 (lessons: SSR
// error-vs-empty). RLS-scoped, so another account's session simply reads as absent.
export function getGenerationSessionByPublicId(supabase: Client, publicId: string) {
  return supabase
    .from("generation_session")
    .select("id, public_id, requested_count, generated_count")
    .eq("public_id", publicId)
    .maybeSingle();
}

// Dedup lookup for the idempotency key a client mints once per generation attempt and
// "Ponów" replays verbatim (FR-018). Matches only a SUCCEEDED session, on purpose: a
// `failed` row is audit, and replaying it would hand the caller an error as if it were a
// result. RLS scopes the read to the caller, so `(user_id, key)` needs no explicit
// predicate — the partial unique index guarantees at most one such row, which is what
// makes maybeSingle() safe here.
//
// Callers MUST branch on `error` before treating `data == null` as "no prior attempt"
// (lessons: SSR error-vs-empty) — mistaking a transient failure for "never seen this key"
// is exactly how a dedup layer starts duplicating again, silently.
export function findSucceededSessionByIdempotencyKey(supabase: Client, idempotencyKey: string) {
  return supabase
    .from("generation_session")
    .select("id, public_id, generated_count, saved_count")
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "succeeded")
    .maybeSingle();
}

// Rebuilds the response body of an already-persisted generation, so a replay is
// indistinguishable from the original answer.
//
// `generation_session` stores NEITHER the cards nor the deck — there is no deck_id column
// on it (see the S-04 migration) — so both are read back through the cards, whose FK to
// deck is the only link that exists. Ordered by `id`: every candidate of one session is
// inserted in a single statement, so their `created_at` values are identical and would
// not order anything.
export async function generationResultByGenerationId(supabase: Client, generationId: number) {
  const { data, error } = await supabase
    .from("flashcard")
    .select("front, back, deck!inner(public_id)")
    .eq("generation_id", generationId)
    .order("id", { ascending: true });
  if (error) return { data: null, error };
  // No cards left (all deleted since) means there is nothing to replay — a `null` the
  // caller must treat as a failure, not as an empty success, or the island navigates to
  // a review screen it cannot name. Tested on the first row rather than on `data.length`
  // since C10X-43: same predicate, and it is the row the deck name is read off, so the
  // guard and the access are now the same fact instead of two that have to agree.
  const first = data[0];
  if (!first) return { data: null, error: null };

  return {
    data: {
      candidates: data.map((card) => ({ front: card.front, back: card.back })),
      deckPublicId: first.deck.public_id,
    },
    error: null,
  };
}

// The acceptance metric (PRD's primary success criterion), as a plain aggregate over the
// session's cards — no stored counter and no new column. A session caps at 15 cards, so
// the grouping happens here rather than in SQL.
//
// TWO STORED COUNTERS LOOK RIGHT FOR THE DENOMINATOR AND BOTH ARE WRONG (plan-review F6):
//   - `saved_count` is zeroed by retireGenerationSession's compensating update below, so a
//     duplicated-then-compensated run reads as 0 while its rows still exist.
//   - `generated_count` counts what the MODEL returned, before Zod dropped invalid cards
//     (api/generate.ts reports the difference as `skipped`), so "k z generated_count"
//     would carry a ceiling the user can never reach while these three sum to less.
// The denominator is therefore `accepted + rejected + pending` — the surviving rows.
export async function generationStateCounts(supabase: Client, generationId: number) {
  const { data, error } = await supabase.from("flashcard").select("state_id").eq("generation_id", generationId);
  if (error) return { data: null, error };

  const counts = { accepted: 0, rejected: 0, pending: 0 };
  for (const row of data) {
    if (row.state_id === STATE_ACCEPTED) counts.accepted += 1;
    else if (row.state_id === STATE_REJECTED) counts.rejected += 1;
    else counts.pending += 1;
  }
  return { data: counts, error: null };
}

// RETIREMENT — the compensating update after a failed card insert. Flips an
// already-persisted `succeeded` session to `failed` so `saved_count` never over-reports
// cards that didn't land (impl-review F2), AND clears its `idempotency_key`, so the row
// leaves `generation_session_idempotency_key_uidx` for two independent reasons instead of
// one. The writes aren't a single transaction (the card insert needs the session's FK id
// first), so this is the only thing standing between a failed insert and a row that claims
// cards nobody has.
//
// It was called `failGenerationSession` and was documented as "best-effort" until C10X-48.
// Both were wrong in the same direction. The name described half of what it does; and
// "best-effort" entered this file as a comment rather than as a decision, which is what let
// its ONE caller discard the result — so when the compensation failed (research §2 measures
// that as the EXPECTED outcome on the likeliest road here: the card insert and this update
// share one connection, one token and one proxy) the session survived as
// `status='succeeded', saved_count>0`, keyed, with zero cards behind it. Every later "Ponów"
// on that key then replayed into a permanent 500.
//
// `.select("id").maybeSingle()` IS the contract, not decoration — same rule and same reason
// as `deleteDeck` (src/lib/decks.ts:37-42). Without an explicit `.select()` PostgREST
// answers an UPDATE under `Prefer: return=minimal`, so a ZERO-ROW update resolves
// `{ data: null, error: null }` — indistinguishable from success. Under RLS that is exactly
// what a vanished row or an unreadable `auth.uid()` produces, so `if (error)` alone would
// still have swallowed it. Callers must treat `data == null` with no error as a FAILED
// compensation, never as a landed one.
export function retireGenerationSession(supabase: Client, id: number, message: string) {
  return supabase
    .from("generation_session")
    .update({ status: "failed", saved_count: 0, error_message: message, idempotency_key: null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
}

// THE HEAL — deliberately NARROWER than the retirement above, and the difference is a
// decision rather than an economy (C10X-48 D-07). Used by /api/generate when a replay lookup
// resolves a succeeded session with zero cards behind it: it disarms that row's key so the
// request can fall through into an ordinary generation instead of dying at the same 500
// forever.
//
// It clears the key and NOTHING else — never `status`, never `saved_count`, never
// `error_message`. The reason is that this caller cannot tell the two rows apart that reach
// it. One is poisoned (a failed compensation; nothing ever landed). The other is a session
// that generated perfectly and whose cards the user has since deleted — and there
// `saved_count` is TRUTHFUL about what once landed. The row shapes are identical, so
// separating them needs a column that does not exist. Retiring both would overwrite a true
// audit row with a false failure: this ticket's own defect class, one path over.
//
// Removing the key is necessary and sufficient here anyway — it is what
// `findSucceededSessionByIdempotencyKey` matches on and what the partial unique index's
// first predicate excludes. Note the row shape this makes reachable in normal operation: a
// `succeeded` session with a NULL key, which is precisely why BOTH predicates of that index
// are load-bearing (see the migration note in the change folder).
//
// `.select("id").maybeSingle()` for the same reason as the retirement, and here it is
// load-bearing for SAFETY rather than for reporting: the caller must confirm a row was
// matched BEFORE falling through to a paid generation. A fall-through over an unhealed row
// re-collides on the same key and buys the same 500 after paying for it.
export function clearSessionIdempotencyKey(supabase: Client, id: number) {
  return supabase.from("generation_session").update({ idempotency_key: null }).eq("id", id).select("id").maybeSingle();
}

// Bulk-inserts validated candidates into a deck, stamping state/source/generation link.
// Only called on success with a non-empty list (the endpoint guards saved_count > 0).
//
// "Validated" is load-bearing and no longer only about shape. Since
// 20260728104500_flashcard_content_bounds.sql the database enforces
// `char_length(front|back) between 1 and 200|1000`, and this is ONE multi-row insert — so a
// single over-length card would fail the WHOLE batch (23514 -> retireGenerationSession -> the
// user loses every candidate), not just itself. Nothing re-validates content here.
//
// What keeps that unreachable is `validate()` in src/lib/openrouter.ts, which drops
// over-length cards INDIVIDUALLY against the same FRONT_MAX/BACK_MAX before they arrive. That
// makes its per-card filtering load-bearing for a failure mode it was not written for: relax
// it and a partial success silently becomes a failed generation. If you ever need per-card
// tolerance here, insert per row (or pre-filter) rather than loosening the schema upstream.
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
