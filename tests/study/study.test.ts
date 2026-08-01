import { beforeAll, describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { createEmptyCard, Rating, State } from "ts-fsrs";
import type { Grade } from "ts-fsrs";
import * as CreateDeck from "@/pages/api/decks/index";
import * as CreateCard from "@/pages/api/decks/[publicId]/cards/index";
import * as Study from "@/pages/api/study";
import { listDecks } from "@/lib/decks";
import { deckIdByPublicId, listFlashcards } from "@/lib/flashcards";
import {
  getStudyDeck,
  listDueCounts,
  listDueCards,
  rateCard,
  scheduleRowToCard,
  scheduler,
  setSessionSize,
} from "@/lib/study";
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

// The four graded recalls, in the order the session island shows them. Rating.Manual (0)
// is not a grade and the endpoint rejects it.
const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

const MINUTE_MS = 60_000;

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

/**
 * A raw count of one deck's cards carrying exactly this front — the retried-write oracle
 * every card-writing helper in this file ends with.
 *
 * The class it exists for: tests/setup/retry-transport.ts replays a POST that Kong dropped
 * AFTER PostgREST had already committed it, so a seam can write its row twice. Measured, not
 * hypothetical — C10X-39's Phase 3 census forced the replay and found both helpers below
 * duplicating while every owning case stayed green.
 *
 * Deliberately NOT `listFlashcards` / `countFlashcards` (src/lib/flashcards.ts), the two
 * helpers this need points straight at: both filter `state_id = STATE_ACCEPTED`, so a
 * generated or rejected duplicate is invisible to them and the count reads green over a real
 * write (test-plan §6.10). Scoped by `front` as well as `deck_id` because every call site's
 * front is distinct within this file and carries the run suffix — so a count of one is also
 * an authorship guard: two sites colliding on a front fail here rather than silently sharing
 * an oracle.
 */
async function countCardsWithFront(
  client: ReturnType<typeof clientFor>,
  deckId: number,
  front: string,
): Promise<number> {
  const { count, error } = await client
    .from("flashcard")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", deckId)
    .eq("front", front);
  expect(error).toBeNull();
  if (count === null) throw new Error(`Count for front "${front}" in deck ${deckId} came back null.`);
  return count;
}

/** Creates an accepted card in a deck through the real endpoint and returns its public_id. */
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
  // written" instead of the `?error=` it actually answered.
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(`/decks/${deckPublicId}`);

  const client = clientFor(as.cookieHeader);
  const { data: deck } = await deckIdByPublicId(client, deckPublicId);
  if (!deck) throw new Error(`Setup failed: deck ${deckPublicId} is not readable by its owner.`);
  const { data: cards, error } = await listFlashcards(client, deck.id);
  expect(error).toBeNull();
  const created = cards?.find((card) => card.front === front);
  if (!created) throw new Error(`Setup failed: card "${front}" was never written to deck ${deckPublicId}.`);

  // `find` returns the FIRST match and cannot count, so the read above is blind to a
  // replayed create by construction — this helper duplicated at 13 call sites in the
  // Phase 3 census with all twelve owning cases green. That the same helper reads as loud
  // in two other files is an accident of what those files re-read afterwards, not a
  // property of the helper.
  expect(await countCardsWithFront(client, deck.id, front)).toBe(1);

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

  // `.single()` above is NOT this assertion. It sees exactly one HTTP response, while a
  // replayed insert arrives in a DIFFERENT response carrying a different public_id — so it
  // is a false oracle for this class, project-wide. Only a re-read can count.
  expect(await countCardsWithFront(client, deck.id, front)).toBe(1);

  return data.public_id;
}

/** Resolves a deck's internal id as its owner — needed to call the lib layer directly. */
async function deckIdOf(as: typeof a, deckPublicId: string): Promise<number> {
  const { data: deck, error } = await deckIdByPublicId(clientFor(as.cookieHeader), deckPublicId);
  expect(error).toBeNull();
  if (!deck) throw new Error(`Deck ${deckPublicId} is not readable by its owner.`);
  return deck.id;
}

/**
 * Resolves a deck the way the real session loader does (src/pages/study/[publicId].astro):
 * one round-trip for the internal id AND the deck's own batch cap.
 *
 * Use this — never a literal — wherever a test needs a `limit` for listDueCards. Copying the
 * `listDueCards(..., 20)` call shape of the cases above is exactly how the session_size wire
 * stayed unobserved through 69 green tests (test-plan §6.7).
 */
async function studyDeckOf(as: typeof a, deckPublicId: string): Promise<{ id: number; sessionSize: number }> {
  const { data, error } = await getStudyDeck(clientFor(as.cookieHeader), deckPublicId);
  expect(error).toBeNull();
  if (!data) throw new Error(`Deck ${deckPublicId} is not readable by its owner.`);
  return { id: data.id, sessionSize: data.session_size };
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
// ts-fsrs is the oracle, not a copied constant: it is pure, immutable and configured with
// `enable_fuzz: false` — passed explicitly in src/lib/study.ts since C10X-27, where before
// it was merely ts-fsrs 5.4.1's default under a `^5.4.1` range. So the transition is a
// deterministic function of (persisted card, now, grade). Each case below recomputes the
// expectation from the row as it stands BEFORE the write, then asserts what actually
// landed in Postgres.

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

// ── C10X-27: the four gaps the 2026-07-26 audit found beyond the record ─────────────────
//
// Everything above this line predates that audit. Each describe below closes one thing the
// suite reported as covered and did not observe: the deck's own cap reaching the batch (and
// being bounded in turn), the batch's composition, a rated card coming BACK when it falls
// due, and the three grades that had never taken the write path.

describe("Risk #3 — the batch is bounded by the deck's own session_size", () => {
  it("caps the batch at the deck's cap and composes it deterministically", async () => {
    const CAP = 3;
    const TOTAL = 5;
    const deckPublicId = await createDeck(a, `Cap deck ${suffix}`);

    // Set through the real endpoint, so the cap under test is one a user could actually set.
    const set = await study({ action: "setSessionSize", deckPublicId, size: CAP }, a);
    expect(set.status).toBe(200);

    const created: string[] = [];
    for (let i = 1; i <= TOTAL; i++) {
      created.push(await createCard(a, deckPublicId, `Cap front ${i} ${suffix}`, `back ${i} ${suffix}`));
    }

    // The wire this case exists for: the limit comes from the deck row, exactly as
    // src/pages/study/[publicId].astro reads it. The setter was proven; the reader was not.
    const deck = await studyDeckOf(a, deckPublicId);
    expect(deck.sessionSize).toBe(CAP);

    const { data: batch, error } = await listDueCards(clientFor(a.cookieHeader), deck.id, new Date(), deck.sessionSize);
    expect(error).toBeNull();
    // Bounded: five cards are due, three come back. A regression to a hardcoded 20, to the
    // RPC's own `default 20`, or to dropping p_limit altogether returns all five — and with
    // fewer due cards than the cap none of those would be visible, which is why TOTAL > CAP.
    expect(batch).toHaveLength(CAP);
    // ...and composed deterministically rather than planner-dependently. Every card here is
    // unseeded, so `coalesce(s.due, p_now)` collapses to p_now for all five and the RPC's
    // `f.id asc` tie-break (added by 20260724220524 for precisely this reason) degenerates to
    // insertion order. toEqual, not toContain: the order IS the claim.
    expect(batch?.map((card) => card.publicId)).toEqual(created.slice(0, CAP));
  });

  it("refuses an out-of-range cap at the endpoint and, one layer down, at the database", async () => {
    const deckPublicId = await createDeck(a, `Bounds deck ${suffix}`);
    const accepted = await study({ action: "setSessionSize", deckPublicId, size: 5 }, a);
    expect(accepted.status).toBe(200);

    // Layer 1 — the endpoint's Zod bound (`int().min(1).max(SIZE_MAX)`). Row-based, not
    // status-only: a 400 returned after the write had already landed would read as a pass.
    for (const size of [0, -1, 101, 2.5]) {
      const response = await study({ action: "setSessionSize", deckPublicId, size }, a);
      expect(response.status).toBe(400);
      await expectErrorBody(response);
      expect((await studyDeckOf(a, deckPublicId)).sessionSize).toBe(5);
    }

    // Layer 2 — the DB CHECK `deck_session_size_check` (`between 1 and 100`, added by
    // 20260724220524). This is the backstop src/lib/study.ts's comment claims and nothing had
    // ever exercised; reaching it means calling the lib function directly, below the Zod bound.
    const client = clientFor(a.cookieHeader);
    for (const size of [0, 101]) {
      const { data, error } = await setSessionSize(client, deckPublicId, size);
      // A refused write, not a silent no-op. The constraint name is what pins WHICH guard
      // refused it — an RLS failure or a missing row would also produce a null `data`.
      const failure = error as { code?: string; message?: string } | null;
      expect(failure?.code).toBe("23514");
      expect(failure?.message).toContain("deck_session_size_check");
      expect(data).toBeNull();
      expect((await studyDeckOf(a, deckPublicId)).sessionSize).toBe(5);
    }

    // Positive control: the same call with an in-range value does land, so the two refusals
    // above are the CHECK and not a wholesale-broken update path.
    const { error: okError } = await setSessionSize(client, deckPublicId, 9);
    expect(okError).toBeNull();
    expect((await studyDeckOf(a, deckPublicId)).sessionSize).toBe(9);

    // The third layer — SessionSizeControl's own SIZE_MIN/SIZE_MAX mirror — stays uncovered:
    // no layer in this project reaches an island's JSX (test-plan §7). Do not read this case
    // as proving the bound end to end.
  });
});

describe("Risk #3 — a rated card comes back exactly when it falls due", () => {
  it("returns the card at its persisted due and withholds it a minute after the rating", async () => {
    const deckPublicId = await createDeck(a, `Re-entry deck ${suffix}`);
    const cardPublicId = await createCard(a, deckPublicId, `Re-entry front ${suffix}`, `back ${suffix}`);
    const deck = await studyDeckOf(a, deckPublicId);
    const expectedReps = await loadSession(a, deckPublicId, cardPublicId);

    const result = await rateCard(
      clientFor(a.cookieHeader),
      deck.id,
      cardPublicId,
      Rating.Good,
      expectedReps,
      FIXED_NOW,
    );
    expect(result.error).toBeNull();
    expect(result.alreadyApplied).toBe(false);

    const persisted = await scheduleOf(a, cardPublicId);
    if (!persisted) throw new Error("Schedule row missing after a successful rate.");
    const due = new Date(persisted.due);

    // The negative half FIRST, because it is the half that separates durability from "the RPC
    // returned something". A `coalesce(s.due, p_now) <= p_now` predicate that was always true,
    // or a rating whose interval never persisted, passes the positive half on its own — which
    // is why every `new Date()` call in this file could only ever prove read-after-write.
    const early = await listDueCards(
      clientFor(a.cookieHeader),
      deck.id,
      new Date(FIXED_NOW.getTime() + MINUTE_MS),
      deck.sessionSize,
    );
    expect(early.error).toBeNull();
    expect(early.data?.map((card) => card.publicId)).not.toContain(cardPublicId);

    // ...and the card is not lost: at the instant it falls due it is back in the batch, read
    // on a brand-new client. `now` is a lib parameter — the only reason this is reachable at
    // all, since the endpoint deliberately never lets a caller supply a clock.
    const atDue = await listDueCards(clientFor(a.cookieHeader), deck.id, due, deck.sessionSize);
    expect(atDue.error).toBeNull();
    const returned = atDue.data?.find((card) => card.publicId === cardPublicId);
    expect(returned).toBeDefined();
    // And it came back as the RATED card, not as a row that quietly reset to New — which
    // would also satisfy "it is in the batch" while losing the schedule entirely.
    expect(returned?.reps).toBe(expectedReps + 1);
  });
});

describe("Risk #3 — every grade takes the write path, not just Good", () => {
  it("persists what ts-fsrs computes for Again/Hard/Good/Easy, against an in-memory oracle", async () => {
    const deckPublicId = await createDeck(a, `Grades deck ${suffix}`);
    const deckId = await deckIdOf(a, deckPublicId);

    for (const grade of GRADES) {
      const cardPublicId = await createCard(a, deckPublicId, `Grade ${grade} front ${suffix}`, `back ${suffix}`);
      const expectedReps = await loadSession(a, deckPublicId, cardPublicId);
      expect(expectedReps).toBe(0);

      // §6.1's independent-oracle rule: built by ts-fsrs' own constructor and advanced purely
      // in memory, never through scheduleRowToCard. Recomputing from the row just read back
      // would drop any unpersisted Card field on both sides at once, so the oracle and the
      // code would agree on a wrong value. A seeded row's `due` does not feed the
      // New -> first transition, which is what makes createEmptyCard a faithful start.
      const oracle = scheduler.next(createEmptyCard(FIXED_NOW), FIXED_NOW, grade).card;

      const result = await rateCard(clientFor(a.cookieHeader), deckId, cardPublicId, grade, expectedReps, FIXED_NOW);
      expect(result.error).toBeNull();
      expect(result.alreadyApplied).toBe(false);

      const persisted = await scheduleOf(a, cardPublicId);
      if (!persisted) throw new Error(`Schedule row missing after rating grade ${grade}.`);
      expect(new Date(persisted.due).getTime()).toBe(oracle.due.getTime());
      expect(persisted.stability).toBeCloseTo(oracle.stability, 6);
      expect(persisted.difficulty).toBeCloseTo(oracle.difficulty, 6);
      expect(persisted.srs_state).toBe(oracle.state);
      expect(persisted.reps).toBe(oracle.reps);
      expect(persisted.lapses).toBe(oracle.lapses);
      expect(persisted.scheduled_days).toBe(oracle.scheduled_days);
    }
  });

  it("increments lapses on Again from Review and resurfaces the card sooner than Good would", async () => {
    const deckPublicId = await createDeck(a, `Lapse deck ${suffix}`);
    const cardPublicId = await createCard(a, deckPublicId, `Lapse front ${suffix}`, `back ${suffix}`);
    const deckId = await deckIdOf(a, deckPublicId);
    await loadSession(a, deckPublicId, cardPublicId);

    // Three Good ratings first, so the lapse happens from a settled Review state rather than
    // from New. Oracle and row advance in step, the oracle only in memory.
    let oracle = createEmptyCard(FIXED_NOW);
    let now = FIXED_NOW;
    for (let review = 1; review <= 3; review++) {
      oracle = scheduler.next(oracle, now, Rating.Good).card;
      const good = await rateCard(clientFor(a.cookieHeader), deckId, cardPublicId, Rating.Good, review - 1, now);
      expect(good.error).toBeNull();
      expect(good.alreadyApplied).toBe(false);
      now = oracle.due; // the next review happens when the card actually comes due
    }
    const settled = await scheduleOf(a, cardPublicId);
    expect(settled?.srs_state).toBe(State.Review);
    expect(settled?.lapses).toBe(0);

    // Both branches computed from the SAME oracle at the SAME `now`, so anything that differs
    // between them is a property of the grade and of nothing else.
    const lapsed = scheduler.next(oracle, now, Rating.Again).card;
    const ifGood = scheduler.next(oracle, now, Rating.Good).card;
    expect(lapsed.lapses).toBe(oracle.lapses + 1);

    const result = await rateCard(clientFor(a.cookieHeader), deckId, cardPublicId, Rating.Again, 3, now);
    expect(result.error).toBeNull();
    expect(result.alreadyApplied).toBe(false);

    const persisted = await scheduleOf(a, cardPublicId);
    if (!persisted) throw new Error("Schedule row missing after a lapse.");
    // Against the oracle, never inside a toEqual self-comparison — that is exactly how
    // `lapses` stayed unobserved while 69 tests reported the schedule as covered.
    expect(persisted.lapses).toBe(lapsed.lapses);
    expect(persisted.lapses).toBe(1);
    expect(new Date(persisted.due).getTime()).toBe(lapsed.due.getTime());
    expect(persisted.stability).toBeCloseTo(lapsed.stability, 6);
    expect(persisted.difficulty).toBeCloseTo(lapsed.difficulty, 6);

    // US-02's user-facing half, stated without reference to the oracle: the card the user
    // struggled with comes back sooner, and less strongly remembered, than the same card
    // would have if they had known it.
    expect(new Date(persisted.due).getTime()).toBeLessThan(ifGood.due.getTime());
    expect(persisted.stability).toBeLessThan(ifGood.stability);

    // NOT Relearning, and this is the one assertion here worth reading twice. With
    // `enable_short_term: false` ts-fsrs runs LongTermScheduler, whose next_state sends every
    // grade — Again included — to State.Review. State.Relearning is assigned at exactly one
    // site, BasicScheduler.reviewState, which this configuration never instantiates. Both
    // test-plan §6.7 and the C10X-27 audit note say "Review -> Relearning"; both are wrong,
    // and asserting it would fail.
    expect(persisted.srs_state).toBe(State.Review);
  });

  it("never writes srs_state 3 — the canary for a flipped enable_short_term", async () => {
    // One schedule row this case OWNS, seeded first (C10X-32). The scan below is
    // account-wide and this case has no fixture of its own, so in declaration order its
    // positive control held only because earlier cases had already written schedule rows:
    // shuffled first it goes red, or — worse — flakes green off a row another file's
    // parallel worker raced in, while the main assertion is vacuous. loadSession is the
    // seam that triggers ensureSchedule, exactly as the real /study/[publicId] loader does.
    const canaryDeckId = await createDeck(a, `Canary deck ${suffix}`);
    const canaryCardId = await createCard(a, canaryDeckId, `Canary front ${suffix}`, `Canary back ${suffix}`);
    await loadSession(a, canaryDeckId, canaryCardId);

    // A single Relearning row means LongTermScheduler is no longer the scheduler in play, and
    // every exact-`due` oracle in this file is suspect. RLS scopes the read to account A, so
    // this observes the rows this run wrote and nothing else. The breadth is deliberate and
    // is the canary's documented point (test-plan §6.6 Phase 4) — it stays account-wide
    // rather than narrowing to the owned row, which only guarantees the control is not vacuous.
    const { data, error } = await clientFor(a.cookieHeader).from("flashcard_schedule").select("srs_state");
    expect(error).toBeNull();
    // Positive control: an empty result would satisfy the claim vacuously.
    expect(data?.length ?? 0).toBeGreaterThan(0);
    expect(data?.map((row) => row.srs_state)).not.toContain(State.Relearning);
  });
});
