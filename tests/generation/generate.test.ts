import { beforeAll, describe, expect, it } from "vitest";
import * as CreateDeck from "@/pages/api/decks/index";
import * as Generate from "@/pages/api/generate";
import { listDecks } from "@/lib/decks";
import { deckIdByPublicId } from "@/lib/flashcards";
import { accountA } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";
import { clientFor } from "../fixtures/session";

// CHARACTERIZATION TEST — this file asserts the BUG, not the fix.
//
// `/api/generate` is not idempotent: two identical requests write two generation
// sessions and two full sets of candidate cards. That is test-plan §2 Risk #2. This
// suite MEASURES it; it does not prevent it. Idempotency is deliberately deferred —
// see finding F5 (ACCEPTED-AS-RULE) in
// context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108,
// mirrored in a source comment at src/pages/api/generate.ts:26-30, and owned by S-05.
//
// SO: when S-05 lands idempotency, the first `it()` below WILL GO RED. That red is the
// signal to INVERT the assertion (2 sessions -> 1) and only then mark Risk #2 covered.
// It is NOT a signal to delete this test.
//
// Two traps specific to mock mode (OPENROUTER_API_KEY is unset locally and in CI, so
// generateCandidates short-circuits to mockCards — src/lib/openrouter.ts:149-158):
//
// 1. DO NOT assert on card content. Mock output is identical on every call
//    ("Przykładowe pytanie 1..N"), so grouping by `front` cannot tell a duplicated
//    generation apart from the mock simply repeating itself. The oracle is
//    `generation_id`, which is unique per session.
// 2. DO NOT assert on `saved_count`. The compensating update zeroes it
//    (src/lib/generations.ts:29-34), so a duplicated-then-compensated run reads as 0
//    while its row still exists.
//
// Every count is scoped twice — by `source_text` and by this run's own deck. The suite
// shares accounts across the run and deliberately never resets the database, so an
// unscoped count(*) would grow with history and the test would pass or fail by accident.

const a = accountA();
const suffix = Date.now().toString(36);

const SOURCE_TEXT = `Tekst źródłowy do generacji ${suffix}`;
const CONTROL_TEXT = `Inny tekst źródłowy ${suffix}`;
const NEW_DECK_TEXT = `Tekst dla nowej talii ${suffix}`;
const COUNT = 3;

function deckForm(name: string): FormData {
  const body = new FormData();
  body.set("name", name);
  return body;
}

/** Creates a deck through the real endpoint and returns its public_id. */
async function createDeck(name: string): Promise<string> {
  const response = await callEndpoint(CreateDeck, { url: "/api/decks", body: deckForm(name), as: a });
  expect(response.status).toBe(302);
  // The endpoint redirects on failure too (/decks?error=…&open=create), so the status
  // alone proves nothing — only the Location separates a real create from a rejection.
  expect(response.headers.get("Location")).toBe("/decks");

  const { data, error } = await listDecks(clientFor(a.cookieHeader));
  expect(error).toBeNull();
  const created = data?.find((deck) => deck.name === name);
  // Guard, not an assertion: if setup silently produced nothing, every count below
  // would be measured against a deck that does not exist.
  if (!created) throw new Error(`Setup failed: deck "${name}" was never written.`);
  return created.public_id;
}

/** One POST to the real generation endpoint, as account A. */
function generate(body: Record<string, unknown>): Promise<Response> {
  return callEndpoint(Generate, { url: "/api/generate", body: JSON.stringify(body), as: a });
}

/** Succeeded sessions for one source text, read back as their owner. */
async function succeededSessions(sourceText: string) {
  const { data, error } = await clientFor(a.cookieHeader)
    .from("generation_session")
    .select("id")
    .eq("source_text", sourceText)
    .eq("status", "succeeded");
  expect(error).toBeNull();
  return data ?? [];
}

/** Every card in one deck, with the session that produced it. */
async function cardsOf(deckPublicId: string) {
  const client = clientFor(a.cookieHeader);
  const { data: deck, error: deckError } = await deckIdByPublicId(client, deckPublicId);
  expect(deckError).toBeNull();
  if (!deck) throw new Error(`Setup failed: deck ${deckPublicId} is not readable as its owner.`);

  const { data, error } = await client.from("flashcard").select("generation_id").eq("deck_id", deck.id);
  expect(error).toBeNull();
  return data ?? [];
}

describe("/api/generate is not idempotent — a retry writes a second set", () => {
  let deckPublicId: string;

  beforeAll(async () => {
    deckPublicId = await createDeck(`Generation deck ${suffix}`);
  });

  it("writes two generation sessions for two identical requests", async () => {
    const body = { deckPublicId, sourceText: SOURCE_TEXT, language: "auto", count: COUNT };

    const first = await generate(body);
    expect(first.status).toBe(200);
    const second = await generate(body);
    // The second request is accepted exactly like the first — there is no dedup key,
    // no in-flight registry, and no unique constraint standing in its way.
    expect(second.status).toBe(200);

    // Primary oracle: the audit rows.
    expect(await succeededSessions(SOURCE_TEXT)).toHaveLength(2);

    // Secondary oracle: the cards actually landed twice. The session count alone would
    // miss a second session that was compensated to `failed` after its cards landed.
    const cards = await cardsOf(deckPublicId);
    expect(new Set(cards.map((card) => card.generation_id)).size).toBe(2);
    expect(cards).toHaveLength(2 * COUNT);
  });

  it("gives a different source text its own session (positive control)", async () => {
    // Without this, "two sessions" above would also be satisfied by an endpoint that
    // writes sessions unconditionally while generation itself is broken — or by one
    // that stopped scoping by source_text at all.
    const response = await generate({
      deckPublicId,
      sourceText: CONTROL_TEXT,
      language: "auto",
      count: COUNT,
    });
    expect(response.status).toBe(200);

    expect(await succeededSessions(CONTROL_TEXT)).toHaveLength(1);
  });

  it("409s the second newDeckName request without a session — and that is not dedup", async () => {
    const newDeckName = `Nowa talia ${suffix}`;
    const body = { newDeckName, sourceText: NEW_DECK_TEXT, language: "auto", count: COUNT };

    const first = await generate(body);
    expect(first.status).toBe(200);
    const second = await generate(body);
    expect(second.status).toBe(409);

    // Exactly one session — but the protection is `deck_user_name_unique`
    // (supabase/migrations/20260705180246_init_core_schema.sql:48) plus the name
    // pre-check at generate.ts:107-113, NOT any deduplication of the generation itself.
    // Sequentially the loser 409s at that pre-check, before the LLM call; run the two
    // concurrently and both pay for a generation, with the loser failing later on 23505
    // at createDeck (generate.ts:179-189). Either way this says nothing about the
    // duplication asserted in the first test above: drop the unique constraint and the
    // apparent protection disappears with it.
    expect(await succeededSessions(NEW_DECK_TEXT)).toHaveLength(1);
  });
});
