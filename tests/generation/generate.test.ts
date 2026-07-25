import { beforeAll, describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import * as CreateDeck from "@/pages/api/decks/index";
import * as Generate from "@/pages/api/generate";
import { listDecks } from "@/lib/decks";
import { deckIdByPublicId } from "@/lib/flashcards";
import { accountA } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";
import { clientFor } from "../fixtures/session";

// Risk #2 (test-plan §2) is now COVERED, not merely characterized.
//
// This file used to assert the BUG: two identical requests to `/api/generate` wrote two
// generation sessions and two full sets of cards, because idempotency was deferred by
// finding F5 (ACCEPTED-AS-RULE) in
// context/archive/2026-07-11-ai-candidate-generation/reviews/impl-review.md:95-108 and
// owned by S-05. S-05 Phase 6 landed the dedup, so the standing instruction in
// test-plan.md §6.6 was carried out: the assertion was INVERTED (2 sessions -> 1), not
// deleted.
//
// The dedup is KEYED, never blanket. Three controls keep that claim honest, because
// "one session" would also be satisfied by an endpoint that silently refuses every
// second request:
//   - two DIFFERENT keys still write two sessions,
//   - no key at all still writes two sessions (the column is nullable on purpose),
//   - a key whose only prior session is `failed` still generates (FR-018's "Ponów" must
//     survive a failure — see the partial index's `status = 'succeeded'` predicate).
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
const DIFFERENT_KEYS_TEXT = `Tekst z dwoma kluczami ${suffix}`;
const NO_KEY_TEXT = `Tekst bez klucza ${suffix}`;
const FAILED_KEY_TEXT = `Tekst po nieudanej sesji ${suffix}`;
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

/** The success body, as the island reads it — asserted on an original AND on a replay. */
interface Success {
  candidates: unknown[];
  counts: { generated: number; saved: number; skipped: number };
  deckPublicId: string;
  sessionPublicId: string;
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

describe("/api/generate deduplicates a retry by its idempotency key", () => {
  let deckPublicId: string;

  beforeAll(async () => {
    deckPublicId = await createDeck(`Generation deck ${suffix}`);
  });

  it("writes ONE generation session for two identical requests carrying the same key", async () => {
    const body = {
      deckPublicId,
      sourceText: SOURCE_TEXT,
      language: "auto",
      count: COUNT,
      idempotencyKey: crypto.randomUUID(),
    };

    const first = await generate(body);
    expect(first.status).toBe(200);
    const second = await generate(body);
    // A replay is a benign 200, not a 409 — the same shape /api/study uses for
    // `alreadyApplied`. The user pressed "Ponów" after a client timeout; from their side
    // nothing went wrong, and an error here would be the FR-018 failure mode inverted.
    expect(second.status).toBe(200);

    // The response contract, asserted on BOTH answers: the replay must be
    // indistinguishable from the original, or the island navigates to a review screen
    // that is not the one holding the cards. A 200 carrying an empty body would satisfy
    // every row-level assertion below while the user lands nowhere.
    const firstPayload = (await first.json()) as Success;
    const secondPayload = (await second.json()) as Success;

    expect(firstPayload.candidates).toHaveLength(COUNT);
    // In mock mode the generator returns exactly what was asked for and nothing is
    // dropped, so saved == generated == COUNT and skipped is 0. Pinned as CURRENT
    // behaviour: a live provider returning fewer cards, or cards that fail validation,
    // would legitimately move these numbers.
    expect(firstPayload.counts.generated).toBe(COUNT);
    expect(firstPayload.counts.saved).toBe(COUNT);
    expect(firstPayload.counts.skipped).toBe(0);

    expect(secondPayload.sessionPublicId).toBe(firstPayload.sessionPublicId);
    expect(secondPayload.deckPublicId).toBe(firstPayload.deckPublicId);
    expect(secondPayload.candidates).toHaveLength(COUNT);
    expect(secondPayload.counts).toEqual(firstPayload.counts);

    // Primary oracle: the audit rows.
    expect(await succeededSessions(SOURCE_TEXT)).toHaveLength(1);

    // Secondary oracle: the cards. The session count alone would miss a second session
    // that was compensated to `failed` AFTER its cards landed — which is the duplication
    // the user actually sees, on the review screen.
    const cards = await cardsOf(deckPublicId);
    expect(new Set(cards.map((card) => card.generation_id)).size).toBe(1);
    expect(cards).toHaveLength(COUNT);
  });

  it("gives two requests with DIFFERENT keys their own sessions", async () => {
    // Proves the dedup is keyed rather than blanket. Without this, an endpoint that
    // simply refused every second request for a source text would pass the case above.
    // Its own deck, deliberately: the card-level count above is deck-scoped, so sharing
    // one would make that assertion depend on the order vitest runs these it()s in.
    const ownDeck = await createDeck(`Different keys deck ${suffix}`);
    const body = { deckPublicId: ownDeck, sourceText: DIFFERENT_KEYS_TEXT, language: "auto", count: COUNT };

    const first = await generate({ ...body, idempotencyKey: crypto.randomUUID() });
    expect(first.status).toBe(200);
    const second = await generate({ ...body, idempotencyKey: crypto.randomUUID() });
    expect(second.status).toBe(200);

    expect(await succeededSessions(DIFFERENT_KEYS_TEXT)).toHaveLength(2);

    const cards = await cardsOf(ownDeck);
    expect(new Set(cards.map((card) => card.generation_id)).size).toBe(2);
  });

  it("still writes two sessions when no key is sent at all", async () => {
    // The column is nullable and the request field optional on purpose: a client that
    // never learned about the key must keep working, and NULLs are not equal to each
    // other, so the partial unique index cannot collapse them into one row.
    const ownDeck = await createDeck(`No key deck ${suffix}`);
    const body = { deckPublicId: ownDeck, sourceText: NO_KEY_TEXT, language: "auto", count: COUNT };

    expect((await generate(body)).status).toBe(200);
    expect((await generate(body)).status).toBe(200);

    expect(await succeededSessions(NO_KEY_TEXT)).toHaveLength(2);
  });

  it("still generates when the only prior session for that key is `failed`", async () => {
    // The FR-018 regression this guards is severe and silent: if a `failed` audit row
    // could hold the key, "Ponów" — which replays the payload VERBATIM, key included —
    // would collide on its own session insert and answer 500. Retry would be permanently
    // dead after any failure, which is the exact flow FR-018 exists for (plan-review F1).
    //
    // Two independent things keep that from happening, and this case exercises the one a
    // future edit is likeliest to break: the partial unique index is scoped to
    // `status = 'succeeded'`. (The other is that both failure-path inserts leave the key
    // NULL — belt and braces, and commented at each site.)
    //
    // No endpoint can produce this row, so it is inserted directly with an RLS-scoped
    // client — the createNonAcceptedCard precedent in tests/study/study.test.ts. That is
    // a shortcut around the UI, not around the lock.
    const key = crypto.randomUUID();
    const ownDeck = await createDeck(`Failed key deck ${suffix}`);
    const { error: seedError } = await clientFor(a.cookieHeader).from("generation_session").insert({
      user_id: a.userId,
      source_text: FAILED_KEY_TEXT,
      model: "harness",
      language: "auto",
      requested_count: COUNT,
      generated_count: 0,
      saved_count: 0,
      status: "failed",
      error_message: "Wymuszona awaria w teście",
      idempotency_key: key,
    });
    expect(seedError).toBeNull();

    const response = await generate({
      deckPublicId: ownDeck,
      sourceText: FAILED_KEY_TEXT,
      language: "auto",
      count: COUNT,
      idempotencyKey: key,
    });
    expect(response.status).toBe(200);

    // A fresh session, not a replay of the failed one.
    expect(await succeededSessions(FAILED_KEY_TEXT)).toHaveLength(1);
    expect(await cardsOf(ownDeck)).toHaveLength(COUNT);
  });

  it("gives a different source text its own session (positive control)", async () => {
    // Guards the COUNTING, not the dedup: every assertion above reads sessions filtered
    // by source_text, so a helper that had stopped scoping — or an endpoint writing
    // sessions unconditionally while generation itself is broken — would go unnoticed.
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
    // Deliberately key-LESS, so the idempotency path cannot mask what this case measures.
    // The warning it carries still holds after Phase 6: `deck_user_name_unique` looks like
    // protection and is not, and a test written only against newDeckName would read green
    // while proving nothing about the dedup asserted above.
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
