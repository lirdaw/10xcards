import { beforeAll, describe, expect, it } from "vitest";
import * as CreateDeck from "@/pages/api/decks/index";
import * as RenameDeck from "@/pages/api/decks/[publicId]";
import { listDecks } from "@/lib/decks";
import { DECK_NAME_MESSAGE, DECK_CREATE_FAILED_MESSAGE, DECK_RENAME_FAILED_MESSAGE } from "@/lib/redirect-errors";
import { accountA } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";
import { clientFor } from "../fixtures/session";

// Deck-name rules on the server (test-plan §2 Risk #6, the two endpoints C10X-30's sweep
// missed — C10X-37). The browser form is a convenience, not a guard, so every rule it
// enforces must hold for a request that never went through it. CONTENT only: ownership lives
// in tests/isolation/decks.test.ts, per §6.2's one-file-per-resource rule.
//
// Pattern is §6.4's, unchanged: real endpoint via the Container API, real session cookie, real
// local Postgres, assertions on ROWS read back as their owner. And §6.10's, because these are
// native-form targets: a refusal and a success are BOTH a 302, so the status separates nothing
// and the decoded `error` param is asserted by EQUALITY, never with `toContain("error=")`.
//
// ASSERTION ORDER IS LOAD-BEARING wherever a case HAS a row oracle: it goes FIRST, before the
// message. Vitest aborts an `it()` at the first failed expect, and this change's breakage pair
// makes the same case fail on both. With the message first, "the endpoint caught it" and "the
// database CHECK caught it" would print the identical failure string and the pair would
// separate nothing. Do not "tidy" this order.
//
// WHICH oracle a case gets depends on what it submits, and the split is load-bearing rather
// than bookkeeping — `deck` has no containing column to count by:
//
//   - RENAME, every case: the oracle is the ROW, `toEqual(before)` column for column. It works
//     whatever the request carried — no form at all, a File part, an over-length name — because
//     an UPDATE leaves the row identifiable regardless. That is why the nameless cases below
//     are routed through rename as well as create.
//   - CREATE with NO usable name (the non-form body, the File part): these have NO row oracle
//     and this file says so rather than faking one. There is no name to carry a per-case marker,
//     so a marker-scoped count reads 0 before and after whatever the endpoint does — an
//     assertion that cannot go red, the `listDueCounts` false-pass class one table over
//     (§6.6, Phase 4). A delta over account A's own decks is not the escape either: A is shared
//     across FILES and other suites create decks as A in parallel workers, so the delta races.
//     They rest on the 302 plus the decoded `error` EQUALITY, and their rename twin is where
//     the same refusal gets a real oracle.

const a = accountA();
const suffix = Date.now().toString(36);
const ORIGIN = "http://localhost:4321";

function deckForm(name: string): FormData {
  const body = new FormData();
  body.set("name", name);
  return body;
}

/** POSTs any body to the create endpoint, so malformed bodies use the same path as forms. */
function postDeck(body: BodyInit): Promise<Response> {
  return callEndpoint(CreateDeck, { url: "/api/decks", body, as: a });
}

/** POSTs any body to the rename endpoint. */
function postRename(deckPublicId: string, body: BodyInit): Promise<Response> {
  return callEndpoint(RenameDeck, {
    url: `/api/decks/${deckPublicId}`,
    params: { publicId: deckPublicId },
    body,
    as: a,
  });
}

/** Creates a deck through the real endpoint and returns its public_id. */
async function createDeck(name: string): Promise<string> {
  const response = await postDeck(deckForm(name));
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/decks");

  const { data, error } = await listDecks(clientFor(a.cookieHeader));
  expect(error).toBeNull();
  const created = data?.find((deck) => deck.name === name);
  if (!created) throw new Error(`Setup failed: deck "${name}" was never written.`);
  return created.public_id;
}

/** Every column a rename can touch, read back as the owner. */
async function rowOf(deckPublicId: string) {
  const { data, error } = await clientFor(a.cookieHeader)
    .from("deck")
    .select("public_id, name, session_size, created_at, updated_at")
    .eq("public_id", deckPublicId)
    .maybeSingle();
  expect(error).toBeNull();
  if (!data) throw new Error(`Deck ${deckPublicId} is not readable by its owner.`);
  return data;
}

/** The decoded `error` param — asserted by EQUALITY everywhere, never with `toContain`. */
function errorParam(location: string | null): string | null {
  return new URL(location ?? "", ORIGIN).searchParams.get("error");
}

describe("POST /api/decks survives a body that is not a form", () => {
  // `await request.formData()` rejects on a body that was never a form, and an unguarded
  // rejection is an uncontrolled framework 500 with no project-owned body — the exact shape
  // the two JSON endpoints (batch.ts, generate.ts) and the four endpoints C10X-30 swept
  // already refuse to produce. The convention reached four of the six readers.
  it("answers with an owned redirect when the body is not a form at all", async () => {
    const response = await postDeck(
      // A string body makes callEndpoint set `Content-Type: application/json`, which is what a
      // crafted request outside the form looks like (fixtures/endpoint.ts).
      JSON.stringify({ name: `json-body-${suffix}` }),
    );

    // No row oracle here, deliberately — see the file header. Nothing in this request carries a
    // name, so there is nothing to scope a count by that could ever go red.
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location.startsWith("/decks?")).toBe(true);
    expect(location).toContain("open=create");
    expect(errorParam(location)).toBe(DECK_CREATE_FAILED_MESSAGE);
  });

  // A multipart part of type `File` survives the `as string | null` cast, so `.trim()` is
  // called on a File and throws a TypeError → 500. It must read as empty instead and fall into
  // the length guard the endpoint already owns — no new message enters the closed set.
  it("reads a File name part as empty rather than crashing on it", async () => {
    const body = new FormData();
    body.set("name", new File([`file-part-${suffix}`], "name.txt", { type: "text/plain" }));

    const response = await postDeck(body);

    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location).toContain("open=create");
    expect(errorParam(location)).toBe(DECK_NAME_MESSAGE);
  });
});

describe("POST /api/decks/[publicId] survives the same two bodies on rename", () => {
  let deckPublicId: string;

  beforeAll(async () => {
    deckPublicId = await createDeck(`Validation rename ${suffix}`);
  });

  it("answers with an owned redirect when the body is not a form at all", async () => {
    const before = await rowOf(deckPublicId);

    const response = await postRename(deckPublicId, JSON.stringify({ name: `json-rename-${suffix}` }));

    // Row FIRST, for the reason in the file header. Rename is where the nameless refusals get
    // a real oracle: an UPDATE leaves the row identifiable however the request was malformed.
    expect(await rowOf(deckPublicId)).toEqual(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location.startsWith(`/decks/${deckPublicId}?`)).toBe(true);
    expect(location).toContain("open=rename");
    expect(errorParam(location)).toBe(DECK_RENAME_FAILED_MESSAGE);
  });

  it("reads a File name part as empty rather than crashing on it", async () => {
    const before = await rowOf(deckPublicId);

    const body = new FormData();
    body.set("name", new File([`rename-file-part-${suffix}`], "name.txt", { type: "text/plain" }));

    const response = await postRename(deckPublicId, body);

    expect(await rowOf(deckPublicId)).toEqual(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location).toContain("open=rename");
    expect(errorParam(location)).toBe(DECK_NAME_MESSAGE);
  });
});
