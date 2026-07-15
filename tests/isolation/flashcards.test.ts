import { beforeAll, describe, expect, it } from "vitest";
import * as CreateDeck from "@/pages/api/decks/index";
import * as CreateCard from "@/pages/api/decks/[publicId]/cards/index";
import * as EditCard from "@/pages/api/decks/[publicId]/cards/[cardPublicId]";
import * as DeleteCard from "@/pages/api/decks/[publicId]/cards/[cardPublicId]/delete";
import { listDecks } from "@/lib/decks";
import { deckIdByPublicId, listFlashcards } from "@/lib/flashcards";
import { accountA, accountB } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";
import { clientFor } from "../fixtures/session";

// Risk #1 on the flashcard surface. This is NOT covered by the deck tests: flashcard
// policies are a different mechanism — an EXISTS-join onto deck.user_id rather than a
// direct user_id predicate (init_core_schema.sql) — so deck isolation holding says
// nothing about card isolation holding.
//
// As in the deck suite, every denial asserts B's response AND A's rows re-read as A: a
// cross-account write is a silent 0-row no-op, never an error.

const a = accountA();
const b = accountB();
const suffix = Date.now().toString(36);

const A_FRONT = `A's front ${suffix}`;
const A_BACK = `A's back ${suffix}`;
const B_FRONT = `B's front ${suffix}`;
const B_BACK = `B's back ${suffix}`;

function deckForm(name: string): FormData {
  const body = new FormData();
  body.set("name", name);
  return body;
}

function cardForm(front: string, back: string): FormData {
  const body = new FormData();
  body.set("front", front);
  body.set("back", back);
  return body;
}

async function createDeck(as: typeof a, name: string): Promise<string> {
  const response = await callEndpoint(CreateDeck, { url: "/api/decks", body: deckForm(name), as });
  expect(response.status).toBe(302);

  const { data, error } = await listDecks(clientFor(as.cookieHeader));
  expect(error).toBeNull();
  const created = data?.find((deck) => deck.name === name);
  if (!created) throw new Error(`Setup failed: deck "${name}" was never written.`);
  return created.public_id;
}

/** Reads a deck's cards back as its owner — the only trustworthy view of row state. */
async function cardsOf(as: typeof a, deckPublicId: string) {
  const client = clientFor(as.cookieHeader);
  const { data: deck, error: deckError } = await deckIdByPublicId(client, deckPublicId);
  expect(deckError).toBeNull();
  if (!deck) throw new Error(`Deck ${deckPublicId} is not readable by its owner.`);

  const { data, error } = await listFlashcards(client, deck.id);
  expect(error).toBeNull();
  return data ?? [];
}

describe("account B is denied account A's flashcards", () => {
  let aDeckId: string;
  let bDeckId: string;
  let bOwnCardDeckId: string;
  let aCardId: string;

  beforeAll(async () => {
    aDeckId = await createDeck(a, `A's card deck ${suffix}`);
    bDeckId = await createDeck(b, `B's card deck ${suffix}`);

    const response = await callEndpoint(CreateCard, {
      url: `/api/decks/${aDeckId}/cards`,
      params: { publicId: aDeckId },
      body: cardForm(A_FRONT, A_BACK),
      as: a,
    });
    expect(response.status).toBe(302);

    const cards = await cardsOf(a, aDeckId);
    const created = cards.find((card) => card.front === A_FRONT);
    if (!created) throw new Error(`Setup failed: A's card was never written to deck ${aDeckId}.`);
    aCardId = created.public_id;

    // A deck of B's own that holds a card, purely so the read test below has a positive
    // control. It is deliberately NOT bDeckId — the containment test asserts that deck
    // stays empty, and a card in it would break that assertion rather than this one.
    bOwnCardDeckId = await createDeck(b, `B's own card deck ${suffix}`);
    const bCard = await callEndpoint(CreateCard, {
      url: `/api/decks/${bOwnCardDeckId}/cards`,
      params: { publicId: bOwnCardDeckId },
      body: cardForm(B_FRONT, B_BACK),
      as: b,
    });
    expect(bCard.status).toBe(302);
  });

  it("returns none of A's cards to B, while B still reads B's own", async () => {
    const bClient = clientFor(b.cookieHeader);

    // The app-reachable half: B cannot resolve A's deck public_id at all, which is what
    // makes the deck page 404 rather than render A's cards.
    const { data: hidden, error: hiddenError } = await deckIdByPublicId(bClient, aDeckId);
    expect(hiddenError).toBeNull();
    expect(hidden).toBeNull();

    // The load-bearing half: hand B A's real INTERNAL deck id — something B could never
    // obtain through the app — and A's cards still do not come back. Without this, the
    // assertion above would only prove the deck lookup is scoped, leaving open whether
    // the cards themselves are; the flashcard policy is a separate EXISTS-join, so that
    // is a real question and not a pedantic one.
    const { data: aDeck } = await deckIdByPublicId(clientFor(a.cookieHeader), aDeckId);
    if (!aDeck) throw new Error(`Deck ${aDeckId} is not readable by its owner.`);

    const { data: leaked, error } = await listFlashcards(bClient, aDeck.id);
    expect(error).toBeNull();
    expect(leaked ?? []).toHaveLength(0);

    // Positive control: B's session genuinely reads cards, so the two empty results
    // above are isolation rather than a broken session that sees nothing at all.
    expect((await cardsOf(b, bOwnCardDeckId)).map((card) => card.front)).toContain(B_FRONT);
  });

  it("refuses B's card creation in A's deck and adds nothing to A's deck", async () => {
    const response = await callEndpoint(CreateCard, {
      url: `/api/decks/${aDeckId}/cards`,
      params: { publicId: aDeckId },
      body: cardForm(`B's intrusion ${suffix}`, `B's intrusion back ${suffix}`),
      as: b,
    });

    // B cannot even resolve A's deck public_id → internal id (RLS hides the deck), so
    // the request dies before the insert.
    expect(response.status).toBe(404);

    const cards = await cardsOf(a, aDeckId);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe(A_FRONT);
  });

  it("refuses B's edit of A's card and leaves A's card unchanged", async () => {
    const response = await callEndpoint(EditCard, {
      url: `/api/decks/${aDeckId}/cards/${aCardId}`,
      params: { publicId: aDeckId, cardPublicId: aCardId },
      body: cardForm(`Edited by B ${suffix}`, `Edited by B back ${suffix}`),
      as: b,
    });

    expect(response.status).toBe(404);

    const cards = await cardsOf(a, aDeckId);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe(A_FRONT);
    expect(cards[0].back).toBe(A_BACK);
  });

  it("refuses B's delete of A's card and leaves A's card in place", async () => {
    const response = await callEndpoint(DeleteCard, {
      url: `/api/decks/${aDeckId}/cards/${aCardId}/delete`,
      params: { publicId: aDeckId, cardPublicId: aCardId },
      as: b,
    });

    expect(response.status).toBe(404);

    const cards = await cardsOf(a, aDeckId);
    expect(cards.map((card) => card.public_id)).toContain(aCardId);
  });

  it("refuses B's own deck paired with A's card id, and does not move the card", async () => {
    // The containment case: here B's deck DOES resolve — B owns it — so the request
    // gets past the 404 that stops every test above, and the deck_id scoping in
    // updateFlashcard is what blocks the reach. This is the one place the app layer
    // independently denies a cross-resource reach even with RLS out of the picture,
    // so it needs its own test rather than riding on the deck-resolution 404.
    const response = await callEndpoint(EditCard, {
      url: `/api/decks/${bDeckId}/cards/${aCardId}`,
      params: { publicId: bDeckId, cardPublicId: aCardId },
      body: cardForm(`Reached across ${suffix}`, `Reached across back ${suffix}`),
      as: b,
    });

    expect(response.status).toBe(404);

    const cards = await cardsOf(a, aDeckId);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe(A_FRONT);
    // The card did not land in B's deck either — a card cannot be dragged across decks
    // by naming it in another deck's path.
    expect(await cardsOf(b, bDeckId)).toHaveLength(0);
  });

  it("still lets A edit A's own card", async () => {
    // Positive control: without it, an endpoint that 404'd on every edit would pass
    // every denial above.
    const front = `A's edited front ${suffix}`;
    const response = await callEndpoint(EditCard, {
      url: `/api/decks/${aDeckId}/cards/${aCardId}`,
      params: { publicId: aDeckId, cardPublicId: aCardId },
      body: cardForm(front, A_BACK),
      as: a,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/decks/${aDeckId}?saved=${aCardId}`);

    const cards = await cardsOf(a, aDeckId);
    expect(cards[0].front).toBe(front);
  });
});
