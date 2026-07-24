import { beforeAll, describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import * as CreateDeck from "@/pages/api/decks/index";
import * as CreateCard from "@/pages/api/decks/[publicId]/cards/index";
import * as Study from "@/pages/api/study";
import { listDecks } from "@/lib/decks";
import { deckIdByPublicId, listFlashcards } from "@/lib/flashcards";
import { listDueCounts, listDueCards } from "@/lib/study";
import { accountA, accountB } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";
import { clientFor } from "../fixtures/session";

// Phase 3 endpoint-contract suite for /api/study. This pins the endpoint's own wiring
// — JSON parse -> Zod discriminated union -> resolve deck -> rateCard/setSessionSize ->
// structured response with the right status code (200/400/401/404). It is deliberately
// NARROW: the hard Risk #3 correctness cases (exact-due oracle vs a direct
// scheduler.next, survives-restart, idempotent double-rate, ordering-through-endpoint,
// accepted-only gate, cross-account positive control, and the deliberate-breakage
// check) are Phase 5 and extend THIS file — do not duplicate them here.
//
// Harness facts this suite leans on (see tests/fixtures/*, context/foundation/lessons.md):
//   - callEndpoint drives the real route with an account's real cookie and an injected
//     locals.user, so the cookie -> JWT -> RLS -> Postgres chain runs for real.
//   - A manually created card is inserted `accepted` (state_id=2), so study_due_cards
//     returns it; but its flashcard_schedule row does not exist until a session loads
//     it. listDueCards runs ensureSchedule, mirroring the real GET /study/[publicId]
//     loader, so we seed the schedule row exactly the way the app does before any rate.

const a = accountA();
const b = accountB();
const suffix = Date.now().toString(36);

const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 } as const;

// Lifecycle state ids (flashcard.state_id), a different axis from the FSRS srs_state.
const STATE_GENERATED = 1;
const SOURCE_MANUAL = 1;

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

/** Creates a deck through the real endpoint and returns its public_id. */
async function createDeck(as: typeof a, name: string): Promise<string> {
  const response = await callEndpoint(CreateDeck, { url: "/api/decks", body: deckForm(name), as });
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/decks");

  const { data, error } = await listDecks(clientFor(as.cookieHeader));
  expect(error).toBeNull();
  const created = data?.find((deck) => deck.name === name);
  if (!created) throw new Error(`Setup failed: deck "${name}" was never written.`);
  return created.public_id;
}

/** Creates an accepted card in a deck through the real endpoint and returns its public_id. */
async function createCard(as: typeof a, deckPublicId: string, front: string, back: string): Promise<string> {
  const response = await callEndpoint(CreateCard, {
    url: `/api/decks/${deckPublicId}/cards`,
    params: { publicId: deckPublicId },
    body: cardForm(front, back),
    as,
  });
  expect(response.status).toBe(302);

  const client = clientFor(as.cookieHeader);
  const { data: deck } = await deckIdByPublicId(client, deckPublicId);
  if (!deck) throw new Error(`Setup failed: deck ${deckPublicId} is not readable by its owner.`);
  const { data: cards, error } = await listFlashcards(client, deck.id);
  expect(error).toBeNull();
  const created = cards?.find((card) => card.front === front);
  if (!created) throw new Error(`Setup failed: card "${front}" was never written to deck ${deckPublicId}.`);
  return created.public_id;
}

/**
 * Seeds the card's flashcard_schedule row the way the real loader does (listDueCards ->
 * ensureSchedule) and returns its current optimistic-lock version (`reps`) — the
 * expectedReps a rate request must echo. The card is New, so it comes back due-now.
 */
async function loadSession(as: typeof a, deckPublicId: string, cardPublicId: string): Promise<number> {
  const client = clientFor(as.cookieHeader);
  const { data: deck } = await deckIdByPublicId(client, deckPublicId);
  if (!deck) throw new Error(`Deck ${deckPublicId} is not readable by its owner.`);
  const { data, error } = await listDueCards(client, deck.id, new Date(), 20);
  expect(error).toBeNull();
  const view = data?.find((card) => card.publicId === cardPublicId);
  if (!view) throw new Error(`Card ${cardPublicId} did not come back due from listDueCards.`);
  return view.reps;
}

/**
 * Inserts a NON-accepted card straight through the RLS-scoped client. There is no
 * endpoint that creates one (manual create always writes `accepted`, and /api/generate
 * would drag the whole generation path in), so the accepted-only gate needs this seam.
 */
async function createGeneratedCard(as: typeof a, deckPublicId: string, front: string): Promise<void> {
  const client = clientFor(as.cookieHeader);
  const { data: deck } = await deckIdByPublicId(client, deckPublicId);
  if (!deck) throw new Error(`Deck ${deckPublicId} is not readable by its owner.`);
  const { error } = await client
    .from("flashcard")
    .insert({ deck_id: deck.id, front, back: `${front} back`, state_id: STATE_GENERATED, source_id: SOURCE_MANUAL })
    .select("public_id")
    .single();
  expect(error).toBeNull();
}

/** Reads a card's schedule row back as its owner — the only trustworthy view of row state. */
async function scheduleOf(as: typeof a, cardPublicId: string): Promise<{ due: string; reps: number } | null> {
  const client = clientFor(as.cookieHeader);
  const { data: fc, error: fcErr } = await client
    .from("flashcard")
    .select("id")
    .eq("public_id", cardPublicId)
    .maybeSingle();
  expect(fcErr).toBeNull();
  if (!fc) throw new Error(`Card ${cardPublicId} is not readable by its owner.`);
  const { data, error } = await client
    .from("flashcard_schedule")
    .select("due, reps")
    .eq("flashcard_id", fc.id)
    .maybeSingle();
  expect(error).toBeNull();
  return data;
}

/** One POST to the real /api/study endpoint as a given account. */
function study(body: Record<string, unknown>, as: typeof a): Promise<Response> {
  return callEndpoint(Study, { url: "/api/study", body: JSON.stringify(body), as });
}

/**
 * The same POST, but with NO session cookie and NO locals.user. callEndpoint always
 * injects locals.user, so the signed-out branch is unreachable through it (test-plan
 * §6.6). This drives the container directly, mirroring generate.test.ts.
 */
async function studySignedOut(body: Record<string, unknown>): Promise<Response> {
  const container = await AstroContainer.create();
  return container.renderToResponse(Study as unknown as Parameters<AstroContainer["renderToResponse"]>[0], {
    routeType: "endpoint",
    request: new Request("http://localhost:4321/api/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    locals: { user: null } as App.Locals,
  });
}

/** Asserts a JSON error object came back, without pinning its Polish copy. */
async function expectErrorBody(response: Response): Promise<void> {
  const payload = (await response.json()) as { error?: unknown };
  expect(typeof payload.error).toBe("string");
}

describe("/api/study rate applies and persists a recall rating", () => {
  let deckPublicId: string;

  beforeAll(async () => {
    deckPublicId = await createDeck(a, `Study deck ${suffix}`);
  });

  it("advances the schedule for a valid rating and returns 200", async () => {
    const cardPublicId = await createCard(a, deckPublicId, `Rate front ${suffix}`, `Rate back ${suffix}`);
    const expectedReps = await loadSession(a, deckPublicId, cardPublicId);
    expect(expectedReps).toBe(0);

    const before = Date.now();
    const response = await study({ action: "rate", deckPublicId, cardPublicId, grade: RATING.GOOD, expectedReps }, a);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok?: unknown; progress?: { reps?: unknown } };
    expect(payload.ok).toBe(true);
    expect(payload.progress?.reps).toBe(1);

    // Row-based: read the schedule back as its owner. reps advanced exactly once, and a
    // Good grade on a New card moves `due` into the future — the transition persisted.
    const sched = await scheduleOf(a, cardPublicId);
    if (!sched) throw new Error("Schedule row missing after a successful rate.");
    expect(sched.reps).toBe(1);
    expect(new Date(sched.due).getTime()).toBeGreaterThan(before);
  });

  it("returns 404 when B rates a card in A's deck, leaving A's schedule untouched", async () => {
    const cardPublicId = await createCard(a, deckPublicId, `Foreign front ${suffix}`, `Foreign back ${suffix}`);
    const expectedReps = await loadSession(a, deckPublicId, cardPublicId);

    const response = await study({ action: "rate", deckPublicId, cardPublicId, grade: RATING.GOOD, expectedReps }, b);
    // B cannot resolve A's deck public_id (RLS hides it), so it is an absent row, not a
    // forbidden one — 404, never 403, so a foreign deck stays indistinguishable from one
    // that does not exist.
    expect(response.status).toBe(404);

    const sched = await scheduleOf(a, cardPublicId);
    expect(sched?.reps).toBe(0);
  });

  it("returns 400 for a malformed rate body", async () => {
    const notJson = await callEndpoint(Study, { url: "/api/study", body: "not json", as: a });
    expect(notJson.status).toBe(400);
    await expectErrorBody(notJson);

    const badGrade = await study(
      { action: "rate", deckPublicId, cardPublicId: "00000000-0000-4000-8000-000000000000", grade: 9, expectedReps: 0 },
      a,
    );
    expect(badGrade.status).toBe(400);
    await expectErrorBody(badGrade);
  });

  it("returns 401 for a signed-out request", async () => {
    // Defence in depth: /api/study is in PROTECTED_ROUTES, so middleware redirects a
    // signed-out caller in production. The container runs no middleware, which is what
    // makes the endpoint's own guard observable here.
    const response = await studySignedOut({
      action: "rate",
      deckPublicId,
      cardPublicId: "00000000-0000-4000-8000-000000000000",
      grade: RATING.GOOD,
      expectedReps: 0,
    });
    expect(response.status).toBe(401);
    await expectErrorBody(response);
  });
});

// The deck-picker badge. Counting is the one read the picker makes, and it must not
// depend on a prior write (a card with no schedule row counts as New/due-now), must
// honour the accepted-only gate that Risk #3 names, and must stay RLS-scoped.
describe("listDueCounts backs the deck picker", () => {
  it("counts only accepted cards, per deck", async () => {
    const deckPublicId = await createDeck(a, `Counts deck ${suffix}`);
    await createCard(a, deckPublicId, `Counted one ${suffix}`, `back ${suffix}`);
    await createCard(a, deckPublicId, `Counted two ${suffix}`, `back ${suffix}`);
    // Non-accepted: present in the deck, invisible to study.
    await createGeneratedCard(a, deckPublicId, `Not counted ${suffix}`);

    const { data, error } = await listDueCounts(clientFor(a.cookieHeader), new Date());
    expect(error).toBeNull();
    // Neither card has a schedule row yet — the count must not require one to exist.
    expect(data?.[deckPublicId]).toBe(2);
  });

  it("stops counting a card once its schedule is rated into the future", async () => {
    const deckPublicId = await createDeck(a, `Rated deck ${suffix}`);
    const cardPublicId = await createCard(a, deckPublicId, `Rated front ${suffix}`, `back ${suffix}`);

    const before = await listDueCounts(clientFor(a.cookieHeader), new Date());
    expect(before.data?.[deckPublicId]).toBe(1);

    const expectedReps = await loadSession(a, deckPublicId, cardPublicId);
    const response = await study({ action: "rate", deckPublicId, cardPublicId, grade: RATING.GOOD, expectedReps }, a);
    expect(response.status).toBe(200);

    const after = await listDueCounts(clientFor(a.cookieHeader), new Date());
    expect(after.error).toBeNull();
    expect(after.data?.[deckPublicId]).toBe(0);
  });

  it("never exposes another account's deck", async () => {
    const deckPublicId = await createDeck(a, `Private counts deck ${suffix}`);
    await createCard(a, deckPublicId, `Private front ${suffix}`, `back ${suffix}`);

    const foreign = await listDueCounts(clientFor(b.cookieHeader), new Date());
    expect(foreign.error).toBeNull();
    // Absence, not a raised denial — the same shape as a deck that does not exist.
    expect(foreign.data?.[deckPublicId]).toBeUndefined();

    // Positive control: a wholesale-broken policy would also read as "B sees nothing".
    const owner = await listDueCounts(clientFor(a.cookieHeader), new Date());
    expect(owner.data?.[deckPublicId]).toBe(1);
  });
});

describe("/api/study setSessionSize updates the per-deck cap", () => {
  it("persists a new size and returns 200", async () => {
    const deckPublicId = await createDeck(a, `Size deck ${suffix}`);

    const response = await study({ action: "setSessionSize", deckPublicId, size: 7 }, a);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok?: unknown; size?: unknown };
    expect(payload.ok).toBe(true);
    expect(payload.size).toBe(7);

    const { data, error } = await clientFor(a.cookieHeader)
      .from("deck")
      .select("session_size")
      .eq("public_id", deckPublicId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.session_size).toBe(7);
  });
});
