import { beforeAll, describe, expect, it } from "vitest";
import * as CreateDeck from "@/pages/api/decks/index";
import * as CreateCard from "@/pages/api/decks/[publicId]/cards/index";
import * as EditCard from "@/pages/api/decks/[publicId]/cards/[cardPublicId]";
import * as DeleteCard from "@/pages/api/decks/[publicId]/cards/[cardPublicId]/delete";
import * as BatchCards from "@/pages/api/decks/[publicId]/cards/batch";
import { listDecks } from "@/lib/decks";
import { deckIdByPublicId, listFlashcards, STATE_ACCEPTED } from "@/lib/flashcards";
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
  // The endpoint redirects on failure too (/decks?error=…&open=create), so the status alone
  // proves nothing — only the Location separates a real create from a rejected one.
  expect(response.headers.get("Location")).toBe("/decks");

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

/**
 * Creates an accepted card through the real endpoint and returns its public_id.
 *
 * Exists for the positive controls, which each own the deck and card they mutate rather
 * than reaching for the shared `beforeAll` fixture the denials assert against (C10X-32).
 */
async function createCard(as: typeof a, deckPublicId: string, front: string, back: string): Promise<string> {
  const response = await callEndpoint(CreateCard, {
    url: `/api/decks/${deckPublicId}/cards`,
    params: { publicId: deckPublicId },
    body: cardForm(front, back),
    as,
  });
  // The status alone proves nothing — this endpoint redirects on success AND on every
  // refusal (§6.10), so only the Location separates the two. Without this line a rejected
  // create is diagnosed by the row check below, which reports the confusing "was never
  // written" instead of the `?error=` it actually answered. `createDeck` above checks its
  // own Location for the same reason.
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(`/decks/${deckPublicId}`);

  const created = (await cardsOf(as, deckPublicId)).find((card) => card.front === front);
  if (!created) throw new Error(`Setup failed: card "${front}" was never written to deck ${deckPublicId}.`);
  return created.public_id;
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
    //
    // Its OWN deck and card, deliberately (C10X-32). Editing the shared beforeAll card
    // rewrites the very content the three denials above compare to the file-scope A_FRONT
    // constant, so this pair was green only in declaration order and red under
    // --sequence.shuffle. And the card must not land in aDeckId either: those denials also
    // assert that deck holds exactly ONE card, so an extra row there is the same order
    // dependence wearing a different hat — the reason generate.test.ts's "Control deck"
    // comment gives verbatim.
    const controlDeckId = await createDeck(a, `A's edit control deck ${suffix}`);
    const controlCardId = await createCard(a, controlDeckId, `A's control front ${suffix}`, A_BACK);

    const front = `A's edited front ${suffix}`;
    const response = await callEndpoint(EditCard, {
      url: `/api/decks/${controlDeckId}/cards/${controlCardId}`,
      params: { publicId: controlDeckId, cardPublicId: controlCardId },
      body: cardForm(front, A_BACK),
      as: a,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/decks/${controlDeckId}?saved=${controlCardId}`);

    const cards = await cardsOf(a, controlDeckId);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe(front);
  });
});

/** Every column a state transition could move, read back as the owner. */
async function rowOf(as: typeof a, cardPublicId: string) {
  const { data, error } = await clientFor(as.cookieHeader)
    .from("flashcard")
    .select("public_id, front, back, state_id, created_at, updated_at")
    .eq("public_id", cardPublicId)
    .maybeSingle();
  expect(error).toBeNull();
  if (!data) throw new Error(`Card ${cardPublicId} is not readable by its owner.`);
  return data;
}

describe("account B is denied a state transition on account A's flashcards", () => {
  // S-05 adds the project's first lifecycle transition and its first MULTI-ROW mutation,
  // which is a new write surface for Risk #1: every denial above covers a single-row write
  // addressed by one public_id, and none of them touches /cards/batch. A bulk UPDATE that
  // forgot its deck scoping would leak across accounts while every test above stayed green.
  //
  // `updated_at` is a meaningful witness here for the first time: Phase 1 narrowed the
  // moddatetime trigger to `update of front, back`, so a state-only write no longer bumps
  // it. A cross-account write that landed would therefore be visible in state_id, and a
  // cross-account CONTENT write in updated_at — so the rows are compared column-for-column
  // rather than on the one field the attack was aimed at.
  let aDeckId: string;
  let bDeckId: string;
  let aCardId: string;

  beforeAll(async () => {
    aDeckId = await createDeck(a, `A's batch deck ${suffix}`);
    bDeckId = await createDeck(b, `B's batch deck ${suffix}`);

    const front = `A's batch front ${suffix}`;
    const response = await callEndpoint(CreateCard, {
      url: `/api/decks/${aDeckId}/cards`,
      params: { publicId: aDeckId },
      body: cardForm(front, `A's batch back ${suffix}`),
      as: a,
    });
    expect(response.status).toBe(302);

    const created = (await cardsOf(a, aDeckId)).find((card) => card.front === front);
    if (!created) throw new Error(`Setup failed: A's batch card was never written to deck ${aDeckId}.`);
    aCardId = created.public_id;
  });

  /** Posts the batch endpoint the review screen and the deck view both drive. */
  function setState(as: typeof a, deckPublicId: string, cardPublicIds: string[], state: "accepted" | "rejected") {
    return callEndpoint(BatchCards, {
      url: `/api/decks/${deckPublicId}/cards/batch`,
      params: { publicId: deckPublicId },
      body: JSON.stringify({ action: "setState", cardPublicIds, state }),
      as,
    });
  }

  it("refuses B's transition on A's card and leaves A's row byte-identical", async () => {
    const before = await rowOf(a, aCardId);
    // The transition B attempts is a LEGAL one (accepted -> rejected), so nothing but the
    // ownership boundary can stop it — a denial here cannot be the state gate in disguise.
    expect(before.state_id).toBe(STATE_ACCEPTED);

    const response = await setState(b, aDeckId, [aCardId], "rejected");

    // B cannot resolve A's deck public_id at all, so the request dies before the UPDATE.
    // 404 and not 403: an absent deck and an RLS-hidden one stay indistinguishable (§6.2).
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await rowOf(a, aCardId)).toEqual(before);
  });

  it("refuses B's own deck paired with A's card id, changing nothing", async () => {
    const before = await rowOf(a, aCardId);

    // The containment case, and the one the multi-row write actually needs: B owns this
    // deck, so the 404 that stops the test above never fires and the UPDATE really runs.
    // What blocks the reach is `.eq("deck_id", deckId)` inside setFlashcardState, backed
    // by RLS. The endpoint answers 200 — a zero-row write is not an error, it is a card
    // that did not move — so `changed` being empty is the ONLY thing that separates a
    // refused reach from a successful one. A status assertion alone would prove nothing.
    const response = await setState(b, bDeckId, [aCardId], "rejected");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, changed: [], skipped: [aCardId] });

    expect(await rowOf(a, aCardId)).toEqual(before);
    // Nor did the card get dragged into B's deck by being named in its path.
    expect(await cardsOf(b, bDeckId)).toHaveLength(0);
  });

  it("still lets A transition A's own card", async () => {
    // Positive control. Without it, a wholesale-broken chain — a policy that denies
    // everything, a batch endpoint that 404s unconditionally — passes both denials above.
    //
    // Its OWN deck and card, for the same reason as the edit control one describe up
    // (C10X-32): moving the SHARED card to `rejected` breaks the first denial's
    // precondition that the transition B attempts is a legal accepted -> rejected one, so
    // the pair was green only in declaration order. The own DECK is chosen for uniformity
    // rather than necessity — this describe happens to carry no length assertion on A's
    // deck today, and a fix should not lean on what a describe accidentally omits.
    const controlDeckId = await createDeck(a, `A's transition control deck ${suffix}`);
    const controlFront = `A's transition control front ${suffix}`;
    const controlCardId = await createCard(a, controlDeckId, controlFront, `A's transition control back ${suffix}`);

    const response = await setState(a, controlDeckId, [controlCardId], "rejected");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, changed: [controlCardId], skipped: [] });

    const after = await rowOf(a, controlCardId);
    expect(after.state_id).toBe(3);
    // Reject is not delete (S-02's rule): the content survives the move intact.
    expect(after.front).toBe(controlFront);
  });
});
