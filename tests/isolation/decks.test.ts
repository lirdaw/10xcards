import { beforeAll, describe, expect, it } from "vitest";
import * as CreateDeck from "@/pages/api/decks/index";
import * as RenameDeck from "@/pages/api/decks/[publicId]";
import * as DeleteDeck from "@/pages/api/decks/[publicId]/delete";
import { getDeckByPublicId, listDecks } from "@/lib/decks";
import { accountA, accountB } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";
import { clientFor } from "../fixtures/session";

// Risk #1 on the deck surface: account B must not read or modify account A's decks.
//
// Every denial here asserts TWO things — B's response AND A's row, re-read as A. The
// second is the load-bearing one: under RLS a cross-account UPDATE/DELETE matches 0
// rows, which is a silent no-op rather than an error. "B got a 404" alone would also
// be true of an endpoint that answered 404 while happily deleting the row.
//
// 404, never 403: an absent deck and an RLS-hidden one stay indistinguishable, so the
// response never reveals that A's deck exists (2026-07-07-deck-workspace).

const a = accountA();
const b = accountB();
const suffix = Date.now().toString(36);

function form(name: string): FormData {
  const body = new FormData();
  body.set("name", name);
  return body;
}

/** Creates a deck through the real endpoint and returns its public_id. */
async function createDeck(as: typeof a, name: string): Promise<string> {
  const response = await callEndpoint(CreateDeck, { url: "/api/decks", body: form(name), as });
  expect(response.status).toBe(302);
  // The endpoint redirects on failure too (/decks?error=…&open=create), so the status alone
  // proves nothing — only the Location separates a real create from a rejected one.
  expect(response.headers.get("Location")).toBe("/decks");

  const { data, error } = await listDecks(clientFor(as.cookieHeader));
  expect(error).toBeNull();
  const created = data?.find((deck) => deck.name === name);
  // Guard, not an assertion: if setup silently produced nothing, every denial below
  // would pass vacuously against a deck that does not exist.
  if (!created) throw new Error(`Setup failed: deck "${name}" was never written.`);
  return created.public_id;
}

describe("account B is denied account A's decks", () => {
  const aDeckName = `A's deck ${suffix}`;
  const bDeckName = `B's deck ${suffix}`;
  let aDeckPublicId: string;
  let bDeckPublicId: string;

  beforeAll(async () => {
    aDeckPublicId = await createDeck(a, aDeckName);
    bDeckPublicId = await createDeck(b, bDeckName);
  });

  it("does not list A's deck for B, but does list B's own", async () => {
    const { data, error } = await listDecks(clientFor(b.cookieHeader));
    expect(error).toBeNull();

    const names = data?.map((deck) => deck.name) ?? [];
    // listDecks has no WHERE clause at all — RLS is the only thing scoping it, which
    // makes this the widest blast radius in the product.
    expect(names).not.toContain(aDeckName);
    // Positive control, inline: B genuinely sees data, so the absence above is
    // isolation rather than a broken session showing B nothing at all.
    expect(names).toContain(bDeckName);
  });

  it("refuses B's rename of A's deck and leaves A's name intact", async () => {
    const response = await callEndpoint(RenameDeck, {
      url: `/api/decks/${aDeckPublicId}`,
      params: { publicId: aDeckPublicId },
      body: form(`Renamed by B ${suffix}`),
      as: b,
    });

    // DELIBERATELY BROKEN — proving CI turns red. Reverted immediately; scratch branch only.
    expect(response.status).toBe(599);

    const { data, error } = await getDeckByPublicId(clientFor(a.cookieHeader), aDeckPublicId);
    expect(error).toBeNull();
    expect(data?.name).toBe(aDeckName);
  });

  it("refuses B's delete of A's deck and leaves A's deck in place", async () => {
    const response = await callEndpoint(DeleteDeck, {
      url: `/api/decks/${aDeckPublicId}/delete`,
      params: { publicId: aDeckPublicId },
      as: b,
    });

    // Before this phase the endpoint redirected to /decks here — a response
    // indistinguishable from a successful delete. The 404 is the fix under test.
    expect(response.status).toBe(404);

    const { data, error } = await getDeckByPublicId(clientFor(a.cookieHeader), aDeckPublicId);
    expect(error).toBeNull();
    expect(data?.name).toBe(aDeckName);
  });

  it("still lets A delete A's own deck", async () => {
    // Positive control for the RETURNING change: proves the new 404 branch answers
    // "0 rows", not "every delete" — a deck-delete that always 404'd would pass every
    // denial test above while being wholly broken.
    const doomedId = await createDeck(a, `A's doomed deck ${suffix}`);

    const response = await callEndpoint(DeleteDeck, {
      url: `/api/decks/${doomedId}/delete`,
      params: { publicId: doomedId },
      as: a,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/decks");

    const { data, error } = await getDeckByPublicId(clientFor(a.cookieHeader), doomedId);
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("keeps B's own deck reachable to B throughout", async () => {
    // Nothing above should have touched B's data either; a fixture that mixed the two
    // accounts' sessions would show up here.
    const { data, error } = await getDeckByPublicId(clientFor(b.cookieHeader), bDeckPublicId);
    expect(error).toBeNull();
    expect(data?.name).toBe(bDeckName);
  });
});
