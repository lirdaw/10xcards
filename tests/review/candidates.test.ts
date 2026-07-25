import { beforeAll, describe, expect, it } from "vitest";
import * as CreateDeck from "@/pages/api/decks/index";
import * as BatchCards from "@/pages/api/decks/[publicId]/cards/batch";
import * as EditCard from "@/pages/api/decks/[publicId]/cards/[cardPublicId]";
import { listDecks } from "@/lib/decks";
import {
  countCandidatesByDeck,
  deckIdByPublicId,
  listFlashcardsByState,
  searchFlashcards,
  setFlashcardState,
  STATE_ACCEPTED,
  STATE_GENERATED,
  STATE_REJECTED,
  updateFlashcard,
} from "@/lib/flashcards";
import { generationStateCounts, getGenerationSessionByPublicId } from "@/lib/generations";
import { accountA, accountB } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";
import { clientFor } from "../fixtures/session";

// Candidate review (S-05): the project's FIRST lifecycle state transition and its first
// multi-row mutation, plus the JSON endpoint that exposes them. Both are what test-plan
// §2 Risk #1 names, and the transition graph is the one piece of logic in this slice with
// a real branch structure.
//
// Two layers in one file, deliberately: the lib functions carry the transition rule, and
// /cards/batch is the only caller that can turn it into a per-id outcome. Splitting them
// would put the guard and its contract in different places. Cross-account denial on the
// same endpoint lives in tests/isolation/flashcards.test.ts, per §6.2's one-file-per-
// resource rule.
//
// Pattern is §6.4's, unchanged: drive the real thing against the real local Postgres with
// a real session cookie, assert on ROWS read back as their owner (a write that RLS or a
// state gate refuses is a silent 0-row no-op, never an error), and never on a status alone.
//
// Two axes are called "state" in this project and they are NOT the same (§6.7):
// `flashcard.state_id` is the lifecycle (1 generated / 2 accepted / 3 rejected) — this
// file's subject — while `flashcard_schedule.srs_state` is FSRS's. Asserting the wrong
// column proves nothing while reading as a passing test.

const a = accountA();
const b = accountB();
const suffix = Date.now().toString(36);

const SOURCE_MANUAL = 1;

function deckForm(name: string): FormData {
  const body = new FormData();
  body.set("name", name);
  return body;
}

/** Creates a deck through the real endpoint and returns its public_id. */
async function createDeck(as: typeof a, name: string): Promise<string> {
  const response = await callEndpoint(CreateDeck, { url: "/api/decks", body: deckForm(name), as });
  expect(response.status).toBe(302);
  // The endpoint redirects on failure too, so only the Location separates a real create
  // from a rejected one.
  expect(response.headers.get("Location")).toBe("/decks");

  const { data, error } = await listDecks(clientFor(as.cookieHeader));
  expect(error).toBeNull();
  const created = data?.find((deck) => deck.name === name);
  if (!created) throw new Error(`Setup failed: deck "${name}" was never written.`);
  return created.public_id;
}

/** Resolves a deck's internal id as its owner — needed to call the lib layer directly. */
async function deckIdOf(as: typeof a, deckPublicId: string): Promise<number> {
  const { data: deck, error } = await deckIdByPublicId(clientFor(as.cookieHeader), deckPublicId);
  expect(error).toBeNull();
  if (!deck) throw new Error(`Deck ${deckPublicId} is not readable by its owner.`);
  return deck.id;
}

/**
 * Inserts a card in an arbitrary lifecycle state straight through the RLS-scoped client.
 *
 * No endpoint creates a non-accepted card — manual create always writes `accepted` and
 * /api/generate would drag the whole generation path in — so the states this file exists
 * to transition need this seam. It is a shortcut around the UI, never around the lock:
 * the insert still runs as the account, under RLS. Same precedent as study.test.ts's
 * createNonAcceptedCard.
 */
async function seedCard(
  as: typeof a,
  deckPublicId: string,
  front: string,
  stateId: number,
  generationId?: number,
): Promise<string> {
  const client = clientFor(as.cookieHeader);
  const { data, error } = await client
    .from("flashcard")
    .insert({
      deck_id: await deckIdOf(as, deckPublicId),
      front,
      back: `${front} back`,
      state_id: stateId,
      source_id: SOURCE_MANUAL,
      ...(generationId === undefined ? {} : { generation_id: generationId }),
    })
    .select("public_id")
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error(`Setup failed: card "${front}" (state ${stateId}) was never written.`);
  return data.public_id;
}

/**
 * Inserts a `succeeded` generation session as the account and returns its ids.
 *
 * The alternative — driving /api/generate — would pull the whole generation path (and its
 * mock-card contract) into a data-layer file for the sake of a parent row. RLS-scoped, so
 * the session is genuinely owned by the account, exactly as the endpoint would write it.
 */
async function seedGenerationSession(
  as: typeof a,
  sourceText: string,
  counts: { requested: number; generated: number; saved: number },
): Promise<{ id: number; publicId: string }> {
  const { data, error } = await clientFor(as.cookieHeader)
    .from("generation_session")
    .insert({
      user_id: as.userId,
      source_text: sourceText,
      model: "test/mock",
      language: "pl",
      requested_count: counts.requested,
      generated_count: counts.generated,
      saved_count: counts.saved,
      status: "succeeded",
    })
    .select("id, public_id")
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error(`Setup failed: generation session for "${sourceText}" was never written.`);
  return { id: data.id, publicId: data.public_id };
}

/** Every column a transition can touch, read back as the owner — the only trustworthy view. */
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

describe("setFlashcardState applies the legal transitions", () => {
  let deckPublicId: string;
  let deckId: number;

  beforeAll(async () => {
    deckPublicId = await createDeck(a, `Transition deck ${suffix}`);
    deckId = await deckIdOf(a, deckPublicId);
  });

  it("writes every edge of the transition table and returns the ids it changed", async () => {
    const client = clientFor(a.cookieHeader);
    const candidate = await seedCard(a, deckPublicId, `Legal candidate ${suffix}`, STATE_GENERATED);
    const doomed = await seedCard(a, deckPublicId, `Legal doomed ${suffix}`, STATE_GENERATED);

    // generated -> accepted (review screen, accept)
    const accepted = await setFlashcardState(client, deckId, [candidate], STATE_ACCEPTED);
    expect(accepted.error).toBeNull();
    expect(accepted.data).toEqual([{ public_id: candidate, state_id: STATE_ACCEPTED }]);
    expect((await rowOf(a, candidate)).state_id).toBe(STATE_ACCEPTED);

    // generated -> rejected (review screen, reject)
    const rejected = await setFlashcardState(client, deckId, [doomed], STATE_REJECTED);
    expect(rejected.error).toBeNull();
    expect(rejected.data).toEqual([{ public_id: doomed, state_id: STATE_REJECTED }]);
    expect((await rowOf(a, doomed)).state_id).toBe(STATE_REJECTED);

    // accepted -> rejected (deck view, per-card "Odrzuć")
    const unaccepted = await setFlashcardState(client, deckId, [candidate], STATE_REJECTED);
    expect(unaccepted.error).toBeNull();
    expect(unaccepted.data).toEqual([{ public_id: candidate, state_id: STATE_REJECTED }]);
    expect((await rowOf(a, candidate)).state_id).toBe(STATE_REJECTED);

    // rejected -> accepted (review screen, rejected view, "Przywróć")
    const restored = await setFlashcardState(client, deckId, [doomed], STATE_ACCEPTED);
    expect(restored.error).toBeNull();
    expect(restored.data).toEqual([{ public_id: doomed, state_id: STATE_ACCEPTED }]);
    expect((await rowOf(a, doomed)).state_id).toBe(STATE_ACCEPTED);

    // The content is untouched by a lifecycle move — reject is not delete (S-02's rule,
    // realised here for the first time).
    const survivor = await rowOf(a, doomed);
    expect(survivor.front).toBe(`Legal doomed ${suffix}`);
    expect(survivor.back).toBe(`Legal doomed ${suffix} back`);
  });

  it("matches no row for a move off the graph, leaving the card exactly as it was", async () => {
    const client = clientFor(a.cookieHeader);
    const rejected = await seedCard(a, deckPublicId, `Illegal target ${suffix}`, STATE_REJECTED);
    const before = await rowOf(a, rejected);

    // Nothing transitions TO `generated`: a card never returns to being a candidate.
    const backwards = await setFlashcardState(client, deckId, [rejected], STATE_GENERATED);
    // Not an error — an off-graph move is indistinguishable from a foreign row under RLS,
    // and both are "nothing changed". The empty RETURNING is the whole signal.
    expect(backwards.error).toBeNull();
    expect(backwards.data).toEqual([]);
    expect(await rowOf(a, rejected)).toEqual(before);

    // A repeat of a move already applied: `rejected` is not in ALLOWED_FROM[rejected], so
    // a double-click or a retried request is benign by construction rather than by luck.
    const repeat = await setFlashcardState(client, deckId, [rejected], STATE_REJECTED);
    expect(repeat.error).toBeNull();
    expect(repeat.data).toEqual([]);
    expect(await rowOf(a, rejected)).toEqual(before);
  });

  it("writes only the legal subset of a mixed batch and reports exactly that subset", async () => {
    const client = clientFor(a.cookieHeader);
    const candidate = await seedCard(a, deckPublicId, `Mixed candidate ${suffix}`, STATE_GENERATED);
    const already = await seedCard(a, deckPublicId, `Mixed already ${suffix}`, STATE_ACCEPTED);
    const alreadyBefore = await rowOf(a, already);

    const result = await setFlashcardState(client, deckId, [candidate, already], STATE_ACCEPTED);
    expect(result.error).toBeNull();
    // Row order out of a multi-row UPDATE is not guaranteed, so compare as a set.
    expect(result.data).toEqual([{ public_id: candidate, state_id: STATE_ACCEPTED }]);
    expect((await rowOf(a, candidate)).state_id).toBe(STATE_ACCEPTED);
    // The already-accepted sibling is untouched, not re-written: this is what lets the
    // endpoint derive `skipped` as "requested minus returned" instead of guessing.
    expect(await rowOf(a, already)).toEqual(alreadyBefore);
  });
});

describe("POST /api/decks/[publicId]/cards/batch applies a transition over a set", () => {
  it("answers JSON with the ids it changed and the ids it skipped", async () => {
    const deckPublicId = await createDeck(a, `Batch deck ${suffix}`);
    const candidate = await seedCard(a, deckPublicId, `Batch candidate ${suffix}`, STATE_GENERATED);
    const already = await seedCard(a, deckPublicId, `Batch already ${suffix}`, STATE_ACCEPTED);
    const alreadyBefore = await rowOf(a, already);

    const response = await callEndpoint(BatchCards, {
      url: `/api/decks/${deckPublicId}/cards/batch`,
      params: { publicId: deckPublicId },
      body: JSON.stringify({ action: "setState", cardPublicIds: [candidate, already], state: "accepted" }),
      as: a,
    });

    // A JSON body, not a 302: every other card/deck endpoint in this project is
    // formData + redirect, so the media type is what says the bulk path has its own
    // contract. `skipped` is the requested set minus what RETURNING produced — an
    // already-accepted card is not an error, it simply did not move.
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: true, changed: [candidate], skipped: [already] });
    expect((await rowOf(a, candidate)).state_id).toBe(STATE_ACCEPTED);
    expect(await rowOf(a, already)).toEqual(alreadyBefore);
  });

  it("refuses a body it cannot trust with 400 and an unknown deck with 404, writing nothing", async () => {
    const deckPublicId = await createDeck(a, `Batch guard deck ${suffix}`);
    const candidate = await seedCard(a, deckPublicId, `Batch guard candidate ${suffix}`, STATE_GENERATED);
    const before = await rowOf(a, candidate);

    const post = (url: string, params: Record<string, string>, body: string) =>
      callEndpoint(BatchCards, { url, params, body, as: a });
    const batchUrl = `/api/decks/${deckPublicId}/cards/batch`;

    const bad: [string, string][] = [
      // `generated` is not a reachable target: a card never returns to being a candidate,
      // so the value is refused at the schema rather than left to match an empty allow-list.
      [
        "a state outside the union",
        JSON.stringify({ action: "setState", cardPublicIds: [candidate], state: "generated" }),
      ],
      ["an unknown action", JSON.stringify({ action: "delete", cardPublicIds: [candidate] })],
      ["an empty id list", JSON.stringify({ action: "setState", cardPublicIds: [], state: "accepted" })],
      [
        "an id that is not a uuid",
        JSON.stringify({ action: "setState", cardPublicIds: ["../../etc"], state: "accepted" }),
      ],
      ["a body that is not JSON at all", "nie-json"],
    ];
    for (const [label, body] of bad) {
      const response = await post(batchUrl, { publicId: deckPublicId }, body);
      expect(response.status, label).toBe(400);
      expect(response.headers.get("Content-Type"), label).toContain("application/json");
    }

    // A well-formed uuid that resolves to no deck: absent and RLS-hidden must stay
    // indistinguishable (§6.2's "404, never 403"), and the answer is still JSON — a
    // redirect here would mean the request reached the edit endpoint instead.
    const absent = await post(
      `/api/decks/00000000-0000-4000-8000-000000000000/cards/batch`,
      { publicId: "00000000-0000-4000-8000-000000000000" },
      JSON.stringify({ action: "setState", cardPublicIds: [candidate], state: "accepted" }),
    );
    expect(absent.status).toBe(404);
    expect(absent.headers.get("Content-Type")).toContain("application/json");

    // The card named in every refused request is still exactly as it was — a 400/404 that
    // wrote anyway would otherwise read as a passing status assertion.
    expect(await rowOf(a, candidate)).toEqual(before);
  });

  it("leaves the edit endpoint unable to answer for the literal segment `batch`", async () => {
    const deckPublicId = await createDeck(a, `Precedence deck ${suffix}`);

    // `cards/batch.ts` is a STATIC segment sitting next to the dynamic `[cardPublicId].ts`,
    // and Astro resolves the static one first. The Container API imports a module directly,
    // so it cannot observe that resolution — what it CAN pin is the fallback the plan leans
    // on: even if precedence ever changed, "batch" fails the UUID guard in the edit endpoint
    // and yields a 404 rather than a wrong write.
    const form = new FormData();
    form.set("front", `Precedence front ${suffix}`);
    form.set("back", `Precedence back ${suffix}`);
    const response = await callEndpoint(EditCard, {
      url: `/api/decks/${deckPublicId}/cards/batch`,
      params: { publicId: deckPublicId, cardPublicId: "batch" },
      body: form,
      as: a,
    });
    expect(response.status).toBe(404);
  });
});

describe("editing a card from the review screen returns to the review screen", () => {
  let deckPublicId: string;
  let cardPublicId: string;

  beforeAll(async () => {
    deckPublicId = await createDeck(a, `Round-trip deck ${suffix}`);
    cardPublicId = await seedCard(a, deckPublicId, `Round-trip candidate ${suffix}`, STATE_GENERATED);
  });

  /** Posts the inline-edit form the review screen renders, with whatever extra fields. */
  async function editFrom(extra: Record<string, string>): Promise<string | null> {
    const form = new FormData();
    form.set("front", `Round-trip front ${suffix}`);
    form.set("back", `Round-trip back ${suffix}`);
    for (const [key, value] of Object.entries(extra)) form.set(key, value);

    const response = await callEndpoint(EditCard, {
      url: `/api/decks/${deckPublicId}/cards/${cardPublicId}`,
      params: { publicId: deckPublicId, cardPublicId },
      body: form,
      as: a,
    });
    expect(response.status).toBe(302);
    return response.headers.get("Location");
  }

  it("lands back on the review screen with the generation scope preserved", async () => {
    const generation = "11111111-1111-4111-8111-111111111111";
    expect(await editFrom({ from: "review", generation })).toBe(
      `/decks/${deckPublicId}/review?generation=${generation}&saved=${cardPublicId}`,
    );

    // Without a generation the review screen is unscoped — the param is dropped, not
    // carried through empty.
    expect(await editFrom({ from: "review" })).toBe(`/decks/${deckPublicId}/review?saved=${cardPublicId}`);

    // No `from` at all is the deck view, unchanged: this is the same endpoint the deck
    // page has always posted to, and its existing round-trip must not move.
    expect(await editFrom({})).toBe(`/decks/${deckPublicId}?saved=${cardPublicId}`);
  });

  it("never echoes a client-supplied path into the Location header", async () => {
    // `from` is a switch with exactly one accepted value, not a redirect target. Anything
    // else falls back to the deck view rather than steering the browser somewhere the
    // client chose — the target is built server-side from the already-validated route params.
    expect(await editFrom({ from: "https://evil.example/phish" })).toBe(`/decks/${deckPublicId}?saved=${cardPublicId}`);
    expect(await editFrom({ from: "Review" })).toBe(`/decks/${deckPublicId}?saved=${cardPublicId}`);

    // Same rule one level down: `generation` rides along only when it is a uuid, so a
    // crafted value cannot append arbitrary query string or path to the review URL.
    expect(await editFrom({ from: "review", generation: "../../../auth/signin" })).toBe(
      `/decks/${deckPublicId}/review?saved=${cardPublicId}`,
    );
  });

  it("round-trips a validation error back to the review screen too", async () => {
    const generation = "22222222-2222-4222-8222-222222222222";
    const location = await editFrom({ from: "review", generation, front: "" });
    // The error path is the one that strands a user on the wrong screen if it is forgotten:
    // the card re-enters inline edit via `edit=<id>` wherever the message is rendered.
    expect(location).toContain(`/decks/${deckPublicId}/review?`);
    expect(location).toContain(`generation=${generation}`);
    expect(location).toContain(`edit=${cardPublicId}`);
    expect(location).toContain("error=");
  });
});

describe("listFlashcardsByState exposes cards the deck view hides", () => {
  it("returns one state's cards with their provenance columns, narrowed to a generation on request", async () => {
    const deckPublicId = await createDeck(a, `By-state deck ${suffix}`);
    const deckId = await deckIdOf(a, deckPublicId);
    const session = await seedGenerationSession(a, `By-state source ${suffix}`, {
      requested: 2,
      generated: 2,
      saved: 2,
    });
    const other = await seedGenerationSession(a, `By-state other source ${suffix}`, {
      requested: 1,
      generated: 1,
      saved: 1,
    });

    const mine = await seedCard(a, deckPublicId, `By-state mine ${suffix}`, STATE_GENERATED, session.id);
    const sibling = await seedCard(a, deckPublicId, `By-state sibling ${suffix}`, STATE_GENERATED, other.id);
    const rejected = await seedCard(a, deckPublicId, `By-state rejected ${suffix}`, STATE_REJECTED, session.id);
    const accepted = await seedCard(a, deckPublicId, `By-state accepted ${suffix}`, STATE_ACCEPTED, session.id);

    const client = clientFor(a.cookieHeader);
    const generated = await listFlashcardsByState(client, deckId, STATE_GENERATED);
    expect(generated.error).toBeNull();
    const generatedIds = generated.data?.map((card) => card.public_id) ?? [];
    // The gate, with its positive control in the same breath: the two candidates come
    // back, the accepted and rejected siblings do not. An empty result — a broken policy,
    // a wrong predicate — would otherwise read as a working state filter.
    expect(generatedIds).toContain(mine);
    expect(generatedIds).toContain(sibling);
    expect(generatedIds).not.toContain(rejected);
    expect(generatedIds).not.toContain(accepted);

    // The columns the review screen needs and listFlashcards does not project. Without
    // source_id/state_id a candidate row cannot render its badges, and without
    // generation_id the per-session scope below has nothing to filter on.
    const row = generated.data?.find((card) => card.public_id === mine);
    expect(row).toMatchObject({
      front: `By-state mine ${suffix}`,
      back: `By-state mine ${suffix} back`,
      state_id: STATE_GENERATED,
      source_id: SOURCE_MANUAL,
      generation_id: session.id,
    });

    // Narrowed to one generation: the sibling candidate from the OTHER session drops out,
    // which is what makes `?generation=` a scope rather than a decoration.
    const scoped = await listFlashcardsByState(client, deckId, STATE_GENERATED, session.id);
    expect(scoped.error).toBeNull();
    expect(scoped.data?.map((card) => card.public_id)).toEqual([mine]);

    // And the rejected view is the same read with a different state — the screen's second
    // tab is not a second query path.
    const rejectedView = await listFlashcardsByState(client, deckId, STATE_REJECTED);
    expect(rejectedView.data?.map((card) => card.public_id)).toEqual([rejected]);
  });
});

describe("countCandidatesByDeck backs the deck-list review chip", () => {
  it("counts pending candidates per deck, in one query, and never across accounts", async () => {
    const withCandidates = await createDeck(a, `Chip deck ${suffix}`);
    const withoutCandidates = await createDeck(a, `Chip empty deck ${suffix}`);

    await seedCard(a, withCandidates, `Chip pending one ${suffix}`, STATE_GENERATED);
    await seedCard(a, withCandidates, `Chip pending two ${suffix}`, STATE_GENERATED);
    // Neither of these is "do przeglądu": one is already curated, the other was rejected.
    await seedCard(a, withCandidates, `Chip accepted ${suffix}`, STATE_ACCEPTED);
    await seedCard(a, withCandidates, `Chip rejected ${suffix}`, STATE_REJECTED);
    await seedCard(a, withoutCandidates, `Chip settled ${suffix}`, STATE_ACCEPTED);

    const { data, error } = await countCandidatesByDeck(clientFor(a.cookieHeader));
    expect(error).toBeNull();
    expect(data?.[withCandidates]).toBe(2);
    // Absent, not zero — the deck list renders no chip for a deck that has nothing
    // pending, and `undefined` is what that branch reads.
    expect(data?.[withoutCandidates]).toBeUndefined();

    const foreign = await countCandidatesByDeck(clientFor(b.cookieHeader));
    expect(foreign.error).toBeNull();
    // Absence, not a raised denial — the same shape as a deck that does not exist.
    expect(foreign.data?.[withCandidates]).toBeUndefined();
    // Positive control: a wholesale-broken policy would also read as "B sees nothing".
    // Asserted right here so the denial above cannot be satisfied by a broken chain.
    const owner = await countCandidatesByDeck(clientFor(a.cookieHeader));
    expect(owner.data?.[withCandidates]).toBe(2);
  });
});

describe("the acceptance metric is an aggregate over the session's surviving rows", () => {
  it("resolves a session by public_id and groups its cards by state, ignoring the stored counters", async () => {
    const deckPublicId = await createDeck(a, `Metric deck ${suffix}`);
    // requested 5, model returned 5, Zod dropped one — so saved_count is 4 and
    // generated_count is 5. This gap is the whole point of the case.
    const session = await seedGenerationSession(a, `Metric source ${suffix}`, {
      requested: 5,
      generated: 5,
      saved: 4,
    });

    await seedCard(a, deckPublicId, `Metric accepted one ${suffix}`, STATE_ACCEPTED, session.id);
    await seedCard(a, deckPublicId, `Metric accepted two ${suffix}`, STATE_ACCEPTED, session.id);
    await seedCard(a, deckPublicId, `Metric rejected ${suffix}`, STATE_REJECTED, session.id);
    await seedCard(a, deckPublicId, `Metric pending ${suffix}`, STATE_GENERATED, session.id);
    // A card from the same deck with no generation link at all (a manual one) must not
    // leak into the session's figure.
    await seedCard(a, deckPublicId, `Metric manual ${suffix}`, STATE_ACCEPTED);

    const client = clientFor(a.cookieHeader);
    const resolved = await getGenerationSessionByPublicId(client, session.publicId);
    expect(resolved.error).toBeNull();
    expect(resolved.data).toMatchObject({
      id: session.id,
      public_id: session.publicId,
      requested_count: 5,
      generated_count: 5,
    });

    const counts = await generationStateCounts(client, session.id);
    expect(counts.error).toBeNull();
    expect(counts.data).toEqual({ accepted: 2, rejected: 1, pending: 1 });

    // The denominator rule (plan-review F6), stated as an assertion rather than a comment:
    // "zaakceptowano k z n" uses n = the session's SURVIVING rows, not generated_count.
    // Neither stored counter works — saved_count is zeroed by the compensating update, and
    // generated_count counts what the model returned BEFORE Zod dropped some, so it would
    // put a ceiling on the metric that the user can never reach.
    const n = (counts.data?.accepted ?? 0) + (counts.data?.rejected ?? 0) + (counts.data?.pending ?? 0);
    expect(n).toBe(4);
    expect(n).not.toBe(resolved.data?.generated_count);
  });

  it("returns no session for another account's public_id", async () => {
    const session = await seedGenerationSession(a, `Metric private source ${suffix}`, {
      requested: 1,
      generated: 1,
      saved: 1,
    });

    const foreign = await getGenerationSessionByPublicId(clientFor(b.cookieHeader), session.publicId);
    // Absence, not a raised denial — a lib function has no status code, and RLS hiding a
    // row is the below-HTTP form of "404, never 403" (§6.4).
    expect(foreign.error).toBeNull();
    expect(foreign.data).toBeNull();

    // Positive control: the owner still resolves it, so the null above is the policy and
    // not a broken lookup.
    const owner = await getGenerationSessionByPublicId(clientFor(a.cookieHeader), session.publicId);
    expect(owner.data?.id).toBe(session.id);
  });
});

describe("keyword search inside a deck stays accepted-only", () => {
  it("matches only the accepted card and carries its source_id", async () => {
    const deckPublicId = await createDeck(a, `Search deck ${suffix}`);
    const deckId = await deckIdOf(a, deckPublicId);
    // One token, three cards, one per lifecycle state — so the only thing that can
    // separate them in the result is the state filter itself.
    const token = `szukajka${suffix}`;
    const accepted = await seedCard(a, deckPublicId, `Search ${token} accepted`, STATE_ACCEPTED);
    const generated = await seedCard(a, deckPublicId, `Search ${token} generated`, STATE_GENERATED);
    const rejected = await seedCard(a, deckPublicId, `Search ${token} rejected`, STATE_REJECTED);

    const { data, error } = await searchFlashcards(clientFor(a.cookieHeader), deckId, token);
    expect(error).toBeNull();
    const ids = data?.map((card) => card.public_id) ?? [];
    // The gap S-06 left dormant: the RPC filtered by deck only. It was invisible while
    // nothing wrote `rejected` and candidates were unreachable — both of which S-05 changes.
    expect(ids).toEqual([accepted]);
    expect(ids).not.toContain(generated);
    expect(ids).not.toContain(rejected);

    // source_id in the projection has no consumer in this slice (the deck-view badge is
    // C10X-16's). It ships anyway so the next caller does not inherit a projection that
    // silently cannot feed FlashcardView — the deck loader maps the list branch and this
    // search branch through ONE .map(), with no type gate to catch the difference.
    expect(data?.[0]?.source_id).toBe(SOURCE_MANUAL);
  });
});

describe("a lifecycle transition is not a content edit", () => {
  it("leaves updated_at untouched on a state change while a real edit still bumps it", async () => {
    const deckPublicId = await createDeck(a, `Stamp deck ${suffix}`);
    const deckId = await deckIdOf(a, deckPublicId);
    const client = clientFor(a.cookieHeader);
    const cardPublicId = await seedCard(a, deckPublicId, `Stamp candidate ${suffix}`, STATE_GENERATED);

    const fresh = await rowOf(a, cardPublicId);
    expect(fresh.updated_at).toBe(fresh.created_at);

    // Accepting a candidate is the first UPDATE in this project that is NOT a content
    // edit. The moddatetime trigger was unqualified, so without narrowing it every
    // accepted candidate would arrive in the deck already stamped "Edytowano: <data>" —
    // and each Odrzuć/Przywróć would restamp it (plan-review F4).
    const accepted = await setFlashcardState(client, deckId, [cardPublicId], STATE_ACCEPTED);
    expect(accepted.data).toHaveLength(1);
    const afterTransition = await rowOf(a, cardPublicId);
    expect(afterTransition.state_id).toBe(STATE_ACCEPTED);
    expect(afterTransition.updated_at).toBe(fresh.created_at);

    // The positive control the migration needs: narrowing the trigger must not disarm it.
    // FlashcardView.edited is `updated_at !== created_at`, so if this stopped bumping, the
    // "Edytowano" line would silently never appear again.
    const edited = await updateFlashcard(
      client,
      deckId,
      cardPublicId,
      `Stamp edited ${suffix}`,
      `Stamp edited ${suffix} back`,
    );
    expect(edited.error).toBeNull();
    const afterEdit = await rowOf(a, cardPublicId);
    expect(new Date(afterEdit.updated_at).getTime()).toBeGreaterThan(new Date(afterEdit.created_at).getTime());
  });
});
