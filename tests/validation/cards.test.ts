import { beforeAll, describe, expect, it } from "vitest";
import * as CreateDeck from "@/pages/api/decks/index";
import * as CreateCard from "@/pages/api/decks/[publicId]/cards/index";
import * as EditCard from "@/pages/api/decks/[publicId]/cards/[cardPublicId]";
import { listDecks } from "@/lib/decks";
import { deckIdByPublicId, FRONT_MAX } from "@/lib/flashcards";
import { accountA } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";
import { clientFor } from "../fixtures/session";

// Card-content rules on the server (test-plan §2 Risk #6, the half C10X-28 left open): the
// browser form is a convenience, not a guard, so every rule it enforces must hold for a
// request that never went through it. This file is about CONTENT only — ownership lives in
// tests/isolation/flashcards.test.ts, per §6.2's one-file-per-resource rule.
//
// Pattern is §6.4's, unchanged: real endpoint via the Container API, real session cookie,
// real local Postgres, assertions on ROWS read back as their owner.
//
// TWO things about these endpoints make a status assertion worthless on its own, and both
// are why every case here carries a row oracle:
//
// 1. They are native-form targets, so a refusal and a success are BOTH a 302. Only the
//    `Location` — and the row — separate them.
// 2. Deck resolution runs BEFORE length validation (cards/index.ts, from S-02 impl-review
//    F5), so a case aimed at a foreign or absent deck answers 404 and measures the wrong
//    guard. Every case below uses a real, owned deck.
//
// ASSERTION ORDER IS LOAD-BEARING: the row/count oracle goes FIRST, before the message.
// Vitest aborts an `it()` at the first failed expect, and the change's breakage pair makes
// the same case fail on both. With the message first, "the endpoint caught it" and "the
// database CHECK caught it" would print the identical failure string and the pair would
// separate nothing. Do not "tidy" this order.

const a = accountA();
const suffix = Date.now().toString(36);
const ORIGIN = "http://localhost:4321";

function deckForm(name: string): FormData {
  const body = new FormData();
  body.set("name", name);
  return body;
}

/** Creates a deck through the real endpoint and returns its public_id. */
async function createDeck(name: string): Promise<string> {
  const response = await callEndpoint(CreateDeck, { url: "/api/decks", body: deckForm(name), as: a });
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/decks");

  const { data, error } = await listDecks(clientFor(a.cookieHeader));
  expect(error).toBeNull();
  const created = data?.find((deck) => deck.name === name);
  if (!created) throw new Error(`Setup failed: deck "${name}" was never written.`);
  return created.public_id;
}

/** Resolves a deck's internal id as its owner — the only scope the count oracle may use. */
async function deckIdOf(deckPublicId: string): Promise<number> {
  const { data: deck, error } = await deckIdByPublicId(clientFor(a.cookieHeader), deckPublicId);
  expect(error).toBeNull();
  if (!deck) throw new Error(`Deck ${deckPublicId} is not readable by its owner.`);
  return deck.id;
}

/**
 * A raw, state-agnostic count of a deck's cards.
 *
 * NOT `countFlashcards` (src/lib/flashcards.ts) and NOT `listFlashcards` — the two helpers
 * this need points straight at. Both filter `state_id = STATE_ACCEPTED`, so a card written
 * in any other state is invisible to them and "count unchanged" would read green over a
 * real write. The whole claim of this file is "nothing was written"; the oracle for it
 * cannot carry a filter that hides writes.
 */
async function countCards(deckId: number): Promise<number> {
  const { count, error } = await clientFor(a.cookieHeader)
    .from("flashcard")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", deckId);
  expect(error).toBeNull();
  if (count === null) throw new Error(`Count for deck ${deckId} came back null.`);
  return count;
}

/** Every column an edit can touch, read back as the owner. */
async function rowOf(cardPublicId: string) {
  const { data, error } = await clientFor(a.cookieHeader)
    .from("flashcard")
    .select("public_id, front, back, state_id, created_at, updated_at")
    .eq("public_id", cardPublicId)
    .maybeSingle();
  expect(error).toBeNull();
  if (!data) throw new Error(`Card ${cardPublicId} is not readable by its owner.`);
  return data;
}

/** Creates a card through the real endpoint and returns its public_id. */
async function createCard(deckPublicId: string, front: string, back: string): Promise<string> {
  const body = new FormData();
  body.set("front", front);
  body.set("back", back);
  const response = await callEndpoint(CreateCard, {
    url: `/api/decks/${deckPublicId}/cards`,
    params: { publicId: deckPublicId },
    body,
    as: a,
  });
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(`/decks/${deckPublicId}`);

  const { data, error } = await clientFor(a.cookieHeader)
    .from("flashcard")
    .select("public_id")
    .eq("deck_id", await deckIdOf(deckPublicId))
    .eq("front", front)
    .maybeSingle();
  expect(error).toBeNull();
  if (!data) throw new Error(`Setup failed: card "${front}" was never written.`);
  return data.public_id;
}

/** The decoded `error` param — asserted by EQUALITY everywhere, never with `toContain`. */
function errorParam(location: string | null): string | null {
  return new URL(location ?? "", ORIGIN).searchParams.get("error");
}

describe("POST /api/decks/[publicId]/cards — malformed request body", () => {
  let deckPublicId: string;
  let deckId: number;

  beforeAll(async () => {
    deckPublicId = await createDeck(`Validation create ${suffix}`);
    deckId = await deckIdOf(deckPublicId);
  });

  // `await request.formData()` rejects on a body that is not a form, and an unguarded
  // rejection is an uncontrolled framework 500 with no project-owned body — the exact
  // shape the two JSON endpoints (batch.ts, generate.ts) already refuse to produce. The
  // convention was applied on one side only.
  it("answers with an owned redirect when the body is not a form at all", async () => {
    const before = await countCards(deckId);

    const response = await callEndpoint(CreateCard, {
      url: `/api/decks/${deckPublicId}/cards`,
      params: { publicId: deckPublicId },
      // A string body makes callEndpoint set `Content-Type: application/json`, which is
      // what a crafted request outside the form looks like (fixtures/endpoint.ts).
      body: JSON.stringify({ front: `json-body-${suffix}`, back: `json-body-back-${suffix}` }),
      as: a,
    });

    expect(await countCards(deckId)).toBe(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location.startsWith(`/decks/${deckPublicId}?`)).toBe(true);
    expect(location).toContain("open=create-card");
    expect(errorParam(location)).toBe("Nie udało się utworzyć fiszki");
  });

  // A multipart part of type `File` survives the `as string | null` cast, so `.trim()` is
  // called on a File and throws a TypeError → 500. It must read as empty instead and fall
  // into the length guard the endpoint already owns — no new message.
  it("reads a File part as empty rather than crashing on it", async () => {
    const before = await countCards(deckId);

    const body = new FormData();
    body.set("front", new File([`file-part-${suffix}`], "front.txt", { type: "text/plain" }));
    body.set("back", `File part back ${suffix}`);

    const response = await callEndpoint(CreateCard, {
      url: `/api/decks/${deckPublicId}/cards`,
      params: { publicId: deckPublicId },
      body,
      as: a,
    });

    expect(await countCards(deckId)).toBe(before);
    expect(response.status).toBe(302);
    expect(errorParam(response.headers.get("Location"))).toBe(`Przód fiszki musi mieć od 1 do ${FRONT_MAX} znaków`);
  });
});

describe("POST /api/decks/[publicId]/cards/[cardPublicId] — malformed request body", () => {
  let deckPublicId: string;
  let cardPublicId: string;

  beforeAll(async () => {
    deckPublicId = await createDeck(`Validation edit ${suffix}`);
    cardPublicId = await createCard(deckPublicId, `Edit target ${suffix}`, `Edit target back ${suffix}`);
  });

  // Same guard as create, with one difference that is easy to get wrong: `formData()` is
  // read BEFORE `errorUrl` exists here, because `errorUrl` is built from the `from` /
  // `generation` form fields. So the catch cannot use it and falls back to the unscoped
  // deck-view target — which is what this case pins.
  it("answers with an owned redirect when the body is not a form at all", async () => {
    const before = await rowOf(cardPublicId);

    const response = await callEndpoint(EditCard, {
      url: `/api/decks/${deckPublicId}/cards/${cardPublicId}`,
      params: { publicId: deckPublicId, cardPublicId },
      body: JSON.stringify({ front: `json-edit-${suffix}`, back: `json-edit-back-${suffix}` }),
      as: a,
    });

    expect(await rowOf(cardPublicId)).toEqual(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location.startsWith(`/decks/${deckPublicId}?`)).toBe(true);
    expect(location).toContain(`edit=${cardPublicId}`);
    expect(errorParam(location)).toBe("Nie udało się zapisać zmian");
  });
});
