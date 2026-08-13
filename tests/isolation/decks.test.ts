import { beforeAll, describe, expect, it } from "vitest";
import * as CreateDeck from "@/pages/api/decks/index";
import * as RenameDeck from "@/pages/api/decks/[publicId]";
import * as DeleteDeck from "@/pages/api/decks/[publicId]/delete";
import { deleteDeck, getDeckByPublicId, listDecks } from "@/lib/decks";
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

    expect(response.status).toBe(404);

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

  it("makes a ZERO-ROW delete visible to its caller, on the helper itself", async () => {
    // The distinction `deleteDeck`'s `.select("public_id").maybeSingle()` exists for, asserted
    // at the HELPER rather than through an endpoint: under RLS a delete that matches nothing
    // resolves `{ data: null, error: null }` — byte-identical to a landed delete under
    // PostgREST's default `Prefer: return=minimal`. Every caller that must tell "the row is
    // gone" from "I was never allowed near it" branches on that null, and until this case
    // `deleteDeck` had no caller anywhere in `tests/` at all.
    //
    // The reader here is `/api/generate`'s compensating undo of a deck THIS request created,
    // run after the `generation_session` insert failed (C10X-49): a swallowed zero-row result
    // leaves an empty orphan deck that turns the next "Ponów" into a permanent 409. That
    // endpoint branch is unreachable from this suite; this case owns the helper's half of it.
    //
    // Account B's client against A's deck is a zero-row delete needing no transport seam, no
    // DDL and no fabrication. The deck is created inside this `it()` and owned by it (§6.2),
    // so the denial cannot disturb the shared fixtures the siblings assert against.
    const deckName = `A's undo-probe deck ${suffix}`;
    const probeId = await createDeck(a, deckName);

    const denied = await deleteDeck(clientFor(b.cookieHeader), probeId);
    expect(denied.error).toBeNull();
    expect(denied.data).toBeNull();
    // Row-based, never return-value-based (§6.2): a null `data` with A's deck actually gone
    // would be a pass on the return and a leak in the database.
    const survived = await getDeckByPublicId(clientFor(a.cookieHeader), probeId);
    expect(survived.error).toBeNull();
    expect(survived.data?.name).toBe(deckName);
  });

  it("reports a LANDED delete to its caller as a row, on the same helper", async () => {
    // The positive control for the case above, and it is load-bearing: without it a helper
    // that returned `null` for EVERY caller would satisfy that denial and read as perfect
    // reporting. It is a separate `it()` rather than three more lines inside that one, because
    // Vitest aborts a case at its first failed `expect` — a control sitting after the denial
    // never RUNS under the very neuter it exists to be attributed against, so it would be
    // green by silence rather than by observation.
    //
    // It owns the deck it deletes (§6.2), created here rather than shared: this is the one
    // case in the file that deliberately destroys its own subject.
    const doomedName = `A's helper-doomed deck ${suffix}`;
    const doomedId = await createDeck(a, doomedName);

    const landed = await deleteDeck(clientFor(a.cookieHeader), doomedId);
    expect(landed.error).toBeNull();
    expect(landed.data).not.toBeNull();
    const gone = await getDeckByPublicId(clientFor(a.cookieHeader), doomedId);
    expect(gone.error).toBeNull();
    expect(gone.data).toBeNull();
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
