import { beforeAll, describe, expect, it } from "vitest";
import * as CreateDeck from "@/pages/api/decks/index";
import * as RenameDeck from "@/pages/api/decks/[publicId]";
import { getDeckByPublicId, listDecks } from "@/lib/decks";
import { accountA } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";
import { clientFor } from "../fixtures/session";

// The positive control. Nothing in Phase 3 means anything without it: a wholesale broken
// policy, a null client, or a session that never reached Postgres would all read as
// perfect isolation — B sees none of A's data because *nobody* sees any data. This file
// proves the chain works in the affirmative direction first (lessons.md: "RLS tests need
// role + JWT claims AND a positive control").

const a = accountA();
const suffix = Date.now().toString(36);

function form(name: string): FormData {
  const body = new FormData();
  body.set("name", name);
  return body;
}

describe("account A reaches its own deck through the endpoints", () => {
  const originalName = `Positive control ${suffix}`;
  const renamedName = `Positive control renamed ${suffix}`;
  let publicId: string;

  beforeAll(async () => {
    const response = await callEndpoint(CreateDeck, {
      url: "/api/decks",
      body: form(originalName),
      as: a,
    });

    // Endpoints answer success with a redirect (AGENTS.md convention); the driver does
    // not follow it, so the 302 itself is the assertion.
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/decks");

    const { data, error } = await listDecks(clientFor(a.cookieHeader));
    expect(error).toBeNull();

    // If this is missing, the deck was never written — every later assertion in this file
    // would be vacuous, so stop the phase here rather than let it read as a pass.
    const created = data?.find((deck) => deck.name === originalName);
    if (!created) throw new Error(`A's deck "${originalName}" is not in A's own listDecks — it was never written.`);
    publicId = created.public_id;
  });

  it("writes the deck as A's own row", async () => {
    const { data, error } = await clientFor(a.cookieHeader)
      .from("deck")
      .select("user_id")
      .eq("public_id", publicId)
      .single();

    expect(error).toBeNull();
    // This is the load-bearing assertion of the whole harness. createDeck inserts
    // user_id from the *injected* locals.user, while the insert's WITH CHECK policy
    // demands auth.uid() = user_id — and auth.uid() comes from the *captured cookie*.
    // The row existing at all therefore proves the cookie drove a real session down to
    // Postgres, which is exactly the seam that has never been verified.
    expect(data?.user_id).toBe(a.userId);
  });

  it("renames the deck and reads the new name back", async () => {
    const response = await callEndpoint(RenameDeck, {
      url: `/api/decks/${publicId}`,
      params: { publicId },
      body: form(renamedName),
      as: a,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/decks/${publicId}`);

    const { data, error } = await getDeckByPublicId(clientFor(a.cookieHeader), publicId);
    expect(error).toBeNull();
    // renameDeck already returns the updated row, so a 302 here means one row changed.
    // Re-reading anyway keeps the assertion on row state rather than on the response,
    // which is the rule the denial tests in Phase 3 depend on.
    expect(data?.name).toBe(renamedName);
  });
});
