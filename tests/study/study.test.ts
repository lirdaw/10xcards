import { beforeAll, describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { createEmptyCard, Rating, State } from "ts-fsrs";
import * as CreateDeck from "@/pages/api/decks/index";
import * as CreateCard from "@/pages/api/decks/[publicId]/cards/index";
import * as Study from "@/pages/api/study";
import { listDecks } from "@/lib/decks";
import { deckIdByPublicId, listFlashcards } from "@/lib/flashcards";
import { listDueCounts, listDueCards, rateCard, scheduleRowToCard, scheduler } from "@/lib/study";
import { accountA, accountB } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";
import { clientFor } from "../fixtures/session";

// The /api/study suite, in two layers.
//
// The first describes pin the endpoint's own wiring — JSON parse -> Zod discriminated
// union -> resolve deck -> rateCard/setSessionSize -> structured response with the right
// status code (200/400/401/404). From "Risk #3" onwards come the schedule-correctness
// cases that are this slice's hard acceptance condition (test-plan §2 Risk #3): the
// exact-due oracle against a direct scheduler.next, survives-restart, the idempotent
// retry, ordering by rating, and the accepted-only gate.
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
const STATE_ACCEPTED = 2;
const STATE_REJECTED = 3;
const SOURCE_MANUAL = 1;

// A fixed instant, deliberately far from the wall clock. rateCard takes `now` as a
// parameter (the endpoint never lets a client supply it), and that seam is what makes an
// exact-due assertion possible: an implementation that ignored the injected `now` and
// reached for new Date() would miss every oracle assertion below by months.
const FIXED_NOW = new Date("2026-06-01T12:00:00.000Z");

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
async function createNonAcceptedCard(
  as: typeof a,
  deckPublicId: string,
  front: string,
  stateId: number,
): Promise<string> {
  const client = clientFor(as.cookieHeader);
  const { data: deck } = await deckIdByPublicId(client, deckPublicId);
  if (!deck) throw new Error(`Deck ${deckPublicId} is not readable by its owner.`);
  const { data, error } = await client
    .from("flashcard")
    .insert({ deck_id: deck.id, front, back: `${front} back`, state_id: stateId, source_id: SOURCE_MANUAL })
    .select("public_id")
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error(`Setup failed: non-accepted card "${front}" was never written.`);
  return data.public_id;
}

/** Resolves a deck's internal id as its owner — needed to call the lib layer directly. */
async function deckIdOf(as: typeof a, deckPublicId: string): Promise<number> {
  const { data: deck, error } = await deckIdByPublicId(clientFor(as.cookieHeader), deckPublicId);
  expect(error).toBeNull();
  if (!deck) throw new Error(`Deck ${deckPublicId} is not readable by its owner.`);
  return deck.id;
}

/** Every persisted FSRS column, so a transition can be asserted column-for-column. */
interface ScheduleRow {
  due: string;
  stability: number;
  difficulty: number;
  srs_state: number;
  reps: number;
  lapses: number;
  last_review: string | null;
  scheduled_days: number;
}

/**
 * Reads a card's schedule row back as its owner — the only trustworthy view of row state.
 *
 * Every call builds a FRESH client from the account's cookie, so each read runs its own
 * cookie -> JWT -> RLS -> Postgres chain with nothing carried over. That is what makes
 * this the "survives between sessions" probe as well as the ordinary read.
 */
async function scheduleOf(as: typeof a, cardPublicId: string): Promise<ScheduleRow | null> {
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
    .select("due, stability, difficulty, srs_state, reps, lapses, last_review, scheduled_days")
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
    const before = await scheduleOf(a, cardPublicId);
    if (!before) throw new Error("Session load did not seed a schedule row.");

    const response = await study({ action: "rate", deckPublicId, cardPublicId, grade: RATING.GOOD, expectedReps }, b);
    // B cannot resolve A's deck public_id (RLS hides it), so it is an absent row, not a
    // forbidden one — 404, never 403, so a foreign deck stays indistinguishable from one
    // that does not exist.
    expect(response.status).toBe(404);

    // Row-based, column-for-column: a cross-tenant UPDATE under RLS is a silent 0-row
    // no-op, so the status alone proves nothing about what happened to A's row. The
    // positive control that A can still rate their own card is the first case in this
    // describe — without it, a wholesale-broken policy would read as perfect isolation.
    const after = await scheduleOf(a, cardPublicId);
    expect(after).toEqual(before);
    expect(after?.reps).toBe(0);
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
    await createNonAcceptedCard(a, deckPublicId, `Not counted ${suffix}`, STATE_GENERATED);

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

// ── Risk #3: the schedule must be correct, durable, and admit only accepted cards ──
//
// ts-fsrs is the oracle, not a copied constant: it is pure, immutable and configured
// with enable_fuzz:false, so the transition is a deterministic function of (persisted
// card, now, grade). Each case below recomputes the expectation from the row as it
// stands BEFORE the write, then asserts what actually landed in Postgres.

describe("Risk #3 — the persisted schedule is exactly what ts-fsrs computes", () => {
  it("writes due/stability/difficulty/srs_state matching a direct scheduler.next for a fixed now", async () => {
    const deckPublicId = await createDeck(a, `Oracle deck ${suffix}`);
    const cardPublicId = await createCard(a, deckPublicId, `Oracle front ${suffix}`, `Oracle back ${suffix}`);
    const expectedReps = await loadSession(a, deckPublicId, cardPublicId);

    const before = await scheduleOf(a, cardPublicId);
    if (!before) throw new Error("Session load did not seed a schedule row.");
    const expected = scheduler.next(
      scheduleRowToCard({ public_id: cardPublicId, front: "", back: "", ...before }, FIXED_NOW),
      FIXED_NOW,
      Rating.Good,
    ).card;

    // Driven at the lib layer, not over HTTP: `now` is a function parameter and is
    // deliberately NOT reachable from a request body (a client could otherwise steer its
    // own schedule), so this is the only seam where an exact `due` can be pinned.
    const result = await rateCard(
      clientFor(a.cookieHeader),
      await deckIdOf(a, deckPublicId),
      cardPublicId,
      Rating.Good,
      expectedReps,
      FIXED_NOW,
    );
    expect(result.error).toBeNull();
    expect(result.alreadyApplied).toBe(false);
    expect(result.data).not.toBeNull();

    const persisted = await scheduleOf(a, cardPublicId);
    if (!persisted) throw new Error("Schedule row missing after a successful rate.");
    expect(new Date(persisted.due).getTime()).toBe(expected.due.getTime());
    expect(persisted.stability).toBeCloseTo(expected.stability, 6);
    expect(persisted.difficulty).toBeCloseTo(expected.difficulty, 6);
    expect(persisted.srs_state).toBe(expected.state);
    expect(persisted.reps).toBe(expected.reps);
    expect(persisted.lapses).toBe(expected.lapses);
    expect(persisted.scheduled_days).toBe(expected.scheduled_days);
  });

  it("survives a restart — a brand-new client reads back the same rated schedule", async () => {
    const deckPublicId = await createDeck(a, `Restart deck ${suffix}`);
    const cardPublicId = await createCard(a, deckPublicId, `Restart front ${suffix}`, `Restart back ${suffix}`);
    const expectedReps = await loadSession(a, deckPublicId, cardPublicId);

    const result = await rateCard(
      clientFor(a.cookieHeader),
      await deckIdOf(a, deckPublicId),
      cardPublicId,
      Rating.Good,
      expectedReps,
      FIXED_NOW,
    );
    expect(result.error).toBeNull();

    // Two independent reads, each on its own freshly built client (see scheduleOf) —
    // the stand-in for "the user comes back later". Durability has to live in the row.
    const first = await scheduleOf(a, cardPublicId);
    if (!first) throw new Error("Schedule row missing after a successful rate.");
    const second = await scheduleOf(a, cardPublicId);
    expect(second).toEqual(first);

    // And it is still the RATED schedule — not a row that quietly reset to New, which
    // an equality-only assertion would happily accept.
    expect(first.reps).toBe(1);
    expect(first.srs_state).not.toBe(0);
    expect(new Date(first.due).getTime()).toBeGreaterThan(FIXED_NOW.getTime());
  });

  it("stays faithful across consecutive reviews, against an oracle kept only in memory", async () => {
    const deckPublicId = await createDeck(a, `Chain deck ${suffix}`);
    const cardPublicId = await createCard(a, deckPublicId, `Chain front ${suffix}`, `Chain back ${suffix}`);
    const deckId = await deckIdOf(a, deckPublicId);
    await loadSession(a, deckPublicId, cardPublicId);

    // Why this case exists, and why its oracle is built differently from the one above.
    //
    // The single-transition oracle recomputes its expectation from the row it just read
    // back, i.e. THROUGH scheduleRowToCard — the app's own mapper. Any Card field the
    // schedule table fails to persist is therefore dropped on both sides at once, so the
    // two agree on a wrong value and the assertion passes. That blind spot is real: it let
    // a card rated Good sit in Learning at a +10 min interval forever while the suite
    // stayed green (impl-review F1).
    //
    // Here the oracle is a Card advanced purely in memory from ts-fsrs' own constructor. It
    // never round-trips the database and never passes through the mapper, so a missing
    // column shows up as a divergence from review 2 onward instead of cancelling out. A
    // seeded row's `due` does not feed the New -> first transition, so createEmptyCard is a
    // faithful starting point for a freshly seeded card.
    let oracle = createEmptyCard(FIXED_NOW);
    let now = FIXED_NOW;
    let expectedReps = 0;

    for (let review = 1; review <= 3; review++) {
      oracle = scheduler.next(oracle, now, Rating.Good).card;

      const result = await rateCard(clientFor(a.cookieHeader), deckId, cardPublicId, Rating.Good, expectedReps, now);
      expect(result.error).toBeNull();
      expect(result.alreadyApplied).toBe(false);

      const persisted = await scheduleOf(a, cardPublicId);
      if (!persisted) throw new Error(`Schedule row missing after review ${review}.`);
      expect(new Date(persisted.due).getTime()).toBe(oracle.due.getTime());
      expect(persisted.stability).toBeCloseTo(oracle.stability, 6);
      expect(persisted.difficulty).toBeCloseTo(oracle.difficulty, 6);
      expect(persisted.srs_state).toBe(oracle.state);
      expect(persisted.scheduled_days).toBe(oracle.scheduled_days);
      expect(persisted.reps).toBe(review);

      now = oracle.due; // the next review happens when the card actually comes due
      expectedReps = review; // the optimistic-lock version the next session would serve
    }

    // The property the loop exists to protect, stated independently of the oracle: a
    // schedule that cannot advance stays at a minutes-scale interval indefinitely. Three
    // Good ratings must leave the card in Review, spaced days apart.
    const last = await scheduleOf(a, cardPublicId);
    expect(last?.srs_state).toBe(State.Review);
    expect(last?.scheduled_days).toBeGreaterThan(1);
  });
});

describe("Risk #3 — a retried rating applies the transition exactly once", () => {
  it("answers a repeated rate with a benign 200 alreadyApplied and no second write", async () => {
    const deckPublicId = await createDeck(a, `Retry deck ${suffix}`);
    const cardPublicId = await createCard(a, deckPublicId, `Retry front ${suffix}`, `Retry back ${suffix}`);
    const expectedReps = await loadSession(a, deckPublicId, cardPublicId);
    const body = { action: "rate", deckPublicId, cardPublicId, grade: RATING.GOOD, expectedReps };

    const first = await study(body, a);
    expect(first.status).toBe(200);
    const firstPayload = (await first.json()) as { alreadyApplied?: unknown; progress?: { reps?: unknown } };
    expect(firstPayload.alreadyApplied).toBe(false);
    expect(firstPayload.progress?.reps).toBe(1);
    const afterFirst = await scheduleOf(a, cardPublicId);
    if (!afterFirst) throw new Error("Schedule row missing after a successful rate.");

    // The retry: byte-identical body, so it carries the now-stale expectedReps a double
    // click or a resubmitted request would. `reps` is the optimistic-lock version, so the
    // compare-and-set matches 0 rows and the endpoint reports the rating as already landed.
    const second = await study(body, a);
    expect(second.status).toBe(200);
    const secondPayload = (await second.json()) as { alreadyApplied?: unknown; progress?: { reps?: unknown } };
    expect(secondPayload.alreadyApplied).toBe(true);
    // Advanced by one, not two — the schedule was not pushed a second interval into the
    // future, which is exactly the corruption Risk #3 names.
    expect(secondPayload.progress?.reps).toBe(1);

    const afterSecond = await scheduleOf(a, cardPublicId);
    expect(afterSecond).toEqual(afterFirst);
  });
});

describe("Risk #3 — a better-known card is deferred further", () => {
  it("persists a later due for Easy than for Hard, through the endpoint", async () => {
    const deckPublicId = await createDeck(a, `Ordering deck ${suffix}`);
    const easyCard = await createCard(a, deckPublicId, `Easy front ${suffix}`, `Easy back ${suffix}`);
    const hardCard = await createCard(a, deckPublicId, `Hard front ${suffix}`, `Hard back ${suffix}`);

    const easyReps = await loadSession(a, deckPublicId, easyCard);
    const hardReps = await loadSession(a, deckPublicId, hardCard);

    // Over HTTP, so the server clock governs both. The two requests are milliseconds
    // apart while the intervals they produce differ by days — the ordering is a property
    // of the grade, not of when the request happened to arrive.
    const easyResponse = await study(
      { action: "rate", deckPublicId, cardPublicId: easyCard, grade: RATING.EASY, expectedReps: easyReps },
      a,
    );
    expect(easyResponse.status).toBe(200);
    const hardResponse = await study(
      { action: "rate", deckPublicId, cardPublicId: hardCard, grade: RATING.HARD, expectedReps: hardReps },
      a,
    );
    expect(hardResponse.status).toBe(200);

    const easySchedule = await scheduleOf(a, easyCard);
    const hardSchedule = await scheduleOf(a, hardCard);
    if (!easySchedule || !hardSchedule) throw new Error("Schedule row missing after a successful rate.");
    expect(new Date(easySchedule.due).getTime()).toBeGreaterThan(new Date(hardSchedule.due).getTime());
  });
});

describe("Risk #3 — only accepted cards enter a session", () => {
  it("never returns a generated or rejected card from a session build", async () => {
    const deckPublicId = await createDeck(a, `Gate deck ${suffix}`);
    const acceptedCard = await createCard(a, deckPublicId, `Gate accepted ${suffix}`, `back ${suffix}`);
    const generatedCard = await createNonAcceptedCard(a, deckPublicId, `Gate generated ${suffix}`, STATE_GENERATED);
    const rejectedCard = await createNonAcceptedCard(a, deckPublicId, `Gate rejected ${suffix}`, STATE_REJECTED);

    const { data, error } = await listDueCards(
      clientFor(a.cookieHeader),
      await deckIdOf(a, deckPublicId),
      new Date(),
      20,
    );
    expect(error).toBeNull();
    const returned = data?.map((card) => card.publicId) ?? [];
    // Positive control in the same breath: the accepted sibling DOES come back, so an
    // empty batch (a broken RPC, a broken policy) cannot masquerade as a working gate.
    expect(returned).toContain(acceptedCard);
    expect(returned).not.toContain(generatedCard);
    expect(returned).not.toContain(rejectedCard);
  });

  it("writes no schedule when a non-accepted card is rated", async () => {
    const deckPublicId = await createDeck(a, `Gate rate deck ${suffix}`);
    const generatedCard = await createNonAcceptedCard(a, deckPublicId, `Gate rate front ${suffix}`, STATE_GENERATED);

    // The card is the caller's own and RLS-readable — only the state_id gate keeps it out
    // of study, so it never gets seeded and there is nothing to compare-and-set against.
    const response = await study(
      { action: "rate", deckPublicId, cardPublicId: generatedCard, grade: RATING.GOOD, expectedReps: 0 },
      a,
    );
    expect(response.status).toBe(404);
    expect(await scheduleOf(a, generatedCard)).toBeNull();
  });

  it("stops rating a card that already had a schedule row and then left `accepted`", async () => {
    const deckPublicId = await createDeck(a, `Gate flip deck ${suffix}`);
    const cardPublicId = await createCard(a, deckPublicId, `Gate flip front ${suffix}`, `back ${suffix}`);
    const expectedReps = await loadSession(a, deckPublicId, cardPublicId);

    // The case the two `it()`s above cannot reach. They rely on a non-accepted card having
    // no schedule row, which makes the write-path gate look enforced when it is only a
    // side effect of the read gate. Here the row exists FIRST and the card leaves
    // `accepted` afterwards — the shape S-05's reject transition will create.
    const client = clientFor(a.cookieHeader);
    const { error: flipError } = await client
      .from("flashcard")
      .update({ state_id: STATE_REJECTED })
      .eq("public_id", cardPublicId)
      .select("public_id")
      .single();
    expect(flipError).toBeNull();
    const before = await scheduleOf(a, cardPublicId);
    if (!before) throw new Error("Session load did not seed a schedule row.");

    const response = await study({ action: "rate", deckPublicId, cardPublicId, grade: RATING.GOOD, expectedReps }, a);
    // 404, never 403: a rejected card is absent from study, not forbidden within it.
    expect(response.status).toBe(404);
    // Row-based, not status-only — the schedule must not have advanced a single column.
    expect(await scheduleOf(a, cardPublicId)).toEqual(before);

    // Positive control: flip it back and the very same request now succeeds, so the 404
    // above is the state gate and not a broken deck/card resolution.
    const { error: restoreError } = await client
      .from("flashcard")
      .update({ state_id: STATE_ACCEPTED })
      .eq("public_id", cardPublicId)
      .select("public_id")
      .single();
    expect(restoreError).toBeNull();
    const retry = await study({ action: "rate", deckPublicId, cardPublicId, grade: RATING.GOOD, expectedReps }, a);
    expect(retry.status).toBe(200);
    expect((await scheduleOf(a, cardPublicId))?.reps).toBe(expectedReps + 1);
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
