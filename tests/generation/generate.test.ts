import { beforeAll, describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
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
// Every count is scoped twice — by `source_text` and by this run's own deck. Cross-run
// pollution is already handled elsewhere: provisionAccounts mints fresh accounts per run
// so the suite never inherits a previous run's rows without a db:reset. What is NOT
// handled is this file — all three cases below read as the same account A, so an unscoped
// count(*) would sum them together and the test would pass or fail by accident.

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

/**
 * The same POST, but with NO session cookie and NO `locals.user`.
 *
 * `callEndpoint` always injects `locals.user` (tests/fixtures/endpoint.ts:82), so the
 * signed-out branch is unreachable through it — test-plan §6.6 records that gap. This
 * drives the container directly instead of widening the shared fixture.
 */
async function generateSignedOut(body: Record<string, unknown>): Promise<Response> {
  const container = await AstroContainer.create();
  return container.renderToResponse(Generate as unknown as Parameters<AstroContainer["renderToResponse"]>[0], {
    routeType: "endpoint",
    request: new Request("http://localhost:4321/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    // `App.Locals` also carries `cfContext`, injected by the Cloudflare adapter at runtime
    // (@astrojs/cloudflare/dist/utils/handler.d.ts:1-3). The container has no Workers
    // runtime to supply it and this route never reads it, so only `user` is modelled —
    // the same shortcut tests/fixtures/endpoint.ts:82 takes.
    locals: { user: null } as App.Locals,
  });
}

/** Asserts a JSON error object came back, without pinning its Polish copy. */
async function expectErrorBody(response: Response): Promise<void> {
  const payload = (await response.json()) as { error?: unknown };
  expect(typeof payload.error).toBe("string");
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

    // Response contract, characterized alongside the database rows. The status alone
    // says nothing about what the caller received: a 200 carrying an empty body would
    // satisfy every assertion below while the review screen renders nothing. Kept
    // behavioural — how many cards came back, and what the endpoint claims it did with
    // them — not the payload's shape, wording, or field order.
    const payload = (await first.json()) as {
      candidates: unknown[];
      counts: { generated: number; saved: number; skipped: number };
    };
    expect(payload.candidates).toHaveLength(COUNT);
    // In mock mode the generator returns exactly what was asked for and nothing is
    // dropped, so saved == generated == COUNT and skipped is 0. Pinned as CURRENT
    // behaviour, like the rest of this file: a live provider returning fewer cards, or
    // cards that fail validation, would legitimately move these numbers.
    expect(payload.counts.generated).toBe(COUNT);
    expect(payload.counts.saved).toBe(COUNT);
    expect(payload.counts.skipped).toBe(0);

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
    // Its own deck, deliberately: the card-layer count above is scoped by deck, so
    // generating into the shared one would make that assertion depend on the order
    // vitest happens to run these it() blocks in.
    const controlDeckPublicId = await createDeck(`Control deck ${suffix}`);
    const response = await generate({
      deckPublicId: controlDeckPublicId,
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

// --- Input contract ------------------------------------------------------------------
//
// Behavioural guard tests. Each sends ONE crafted request and asserts the observable
// status plus the fact that a JSON error object came back — deliberately NOT the Polish
// message text. That copy is not a contract, and pinning it would turn this suite into a
// mirror of the implementation; the `StringLiteral -> ""` mutants are left alive on
// purpose (C10X-33).
//
// Nothing here is stubbed and nothing here reaches the generator: every case returns
// before `generateCandidates` is called, so no session and no card is written — which is
// why none of these need the double count-scoping the characterization tests above do.
//
// The 409 on a duplicate newDeckName is NOT repeated here: it hits the same
// `deckNameExists` guard (generate.ts:107-113) already exercised above.

const GUARD_SOURCE_TEXT = `Tekst do walidacji ${suffix}`;
const ABSENT_DECK_PUBLIC_ID = "00000000-0000-4000-8000-000000000000";

describe("/api/generate rejects a request that fails its input contract", () => {
  let deckPublicId: string;

  beforeAll(async () => {
    deckPublicId = await createDeck(`Guard deck ${suffix}`);
  });

  it("401s a request with no session", async () => {
    // Defence in depth, not the first line of it: `/api/generate` is in PROTECTED_ROUTES
    // (src/middleware.ts:4), so in production middleware redirects a signed-out caller
    // before the route runs. The container runs no middleware, which is exactly what makes
    // the endpoint's own guard observable here.
    const response = await generateSignedOut({
      deckPublicId,
      sourceText: GUARD_SOURCE_TEXT,
      language: "auto",
      count: COUNT,
    });

    expect(response.status).toBe(401);
    await expectErrorBody(response);
  });

  it("400s a body that is not JSON", async () => {
    // Hits the request.json() catch, which no schema case can reach.
    const response = await callEndpoint(Generate, { url: "/api/generate", body: "not json", as: a });

    expect(response.status).toBe(400);
    await expectErrorBody(response);
  });

  it("400s a sourceText that is only whitespace", async () => {
    // Whitespace, not "" — an empty string is rejected by the schema's min(1), which is a
    // different guard. Only a non-empty string that trims to nothing reaches the
    // post-trim check.
    const response = await generate({
      deckPublicId,
      sourceText: "   \n\t  ",
      language: "auto",
      count: COUNT,
    });

    expect(response.status).toBe(400);
    await expectErrorBody(response);
  });

  it("400s unless exactly one deck target is given", async () => {
    // Both directions of the same rule: the guard is an XOR, and a request naming both
    // decks and one naming neither must fail identically.
    const both = await generate({
      deckPublicId,
      newDeckName: `Talia obok ${suffix}`,
      sourceText: GUARD_SOURCE_TEXT,
      language: "auto",
      count: COUNT,
    });
    expect(both.status).toBe(400);
    await expectErrorBody(both);

    const neither = await generate({ sourceText: GUARD_SOURCE_TEXT, language: "auto", count: COUNT });
    expect(neither.status).toBe(400);
    await expectErrorBody(neither);
  });

  it("404s a deckPublicId that does not exist", async () => {
    // A well-formed UUID that was never issued — it must pass the schema's regex, or this
    // would land on the 400 above and prove nothing about the lookup.
    const response = await generate({
      deckPublicId: ABSENT_DECK_PUBLIC_ID,
      sourceText: GUARD_SOURCE_TEXT,
      language: "auto",
      count: COUNT,
    });

    expect(response.status).toBe(404);
    await expectErrorBody(response);
  });
});

// --- The inline-deck (newDeckName) path ----------------------------------------------
//
// The characterization suite above already POSTs a newDeckName, but only ever asserts the
// STATUS of those requests. Neither the deck it creates nor the 409 body is looked at, so
// the create branch (generate.ts:179-189) is exercised without being observed. These two
// cases close that: one proves a deck really appeared and that the response names it, the
// other proves a taken name is refused.

const FRESH_DECK_TEXT = `Tekst dla świeżej talii ${suffix}`;
const TAKEN_DECK_TEXT = `Tekst dla zajętej nazwy ${suffix}`;

describe("/api/generate creates the deck inline on the newDeckName path", () => {
  it("200s a unique newDeckName and writes the deck it reports", async () => {
    const newDeckName = `Świeża talia ${suffix}`;

    const response = await generate({
      newDeckName,
      sourceText: FRESH_DECK_TEXT,
      language: "auto",
      count: COUNT,
    });
    expect(response.status).toBe(200);

    // The endpoint reports which deck it wrote into. Asserting the id is non-empty is what
    // separates "created and told the caller" from "created and returned a blank" — the
    // island navigates to this id, so an empty string is a dead end, not a cosmetic bug.
    const payload = (await response.json()) as { deckPublicId?: unknown };
    expect(typeof payload.deckPublicId).toBe("string");
    expect(payload.deckPublicId).not.toBe("");

    // …and the deck is really there, under the requested name, as its owner sees it.
    // The response alone could name a deck that was never committed.
    const { data, error } = await listDecks(clientFor(a.cookieHeader));
    expect(error).toBeNull();
    const created = data?.find((deck) => deck.name === newDeckName);
    expect(created).toBeDefined();
    expect(created?.public_id).toBe(payload.deckPublicId);
  });

  it("409s a newDeckName that is already taken", async () => {
    // A deck created through /api/decks, never generated into — so this exercises the
    // name pre-check against ordinary existing data, not against a deck this endpoint
    // made moments earlier (which is what the characterization case above does).
    const takenName = `Zajęta talia ${suffix}`;
    await createDeck(takenName);

    const response = await generate({
      newDeckName: takenName,
      sourceText: TAKEN_DECK_TEXT,
      language: "auto",
      count: COUNT,
    });
    expect(response.status).toBe(409);
    await expectErrorBody(response);

    // Refused before anything was generated for it. This does NOT distinguish the fast
    // pre-check from the post-generation 23505 fallback — both return before the session
    // is written — but it does pin that a refused request leaves no audit row behind.
    expect(await succeededSessions(TAKEN_DECK_TEXT)).toHaveLength(0);
  });
});
