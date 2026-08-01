import { beforeAll, describe, expect, it } from "vitest";
import * as CreateDeck from "@/pages/api/decks/index";
import * as CreateCard from "@/pages/api/decks/[publicId]/cards/index";
import * as EditCard from "@/pages/api/decks/[publicId]/cards/[cardPublicId]";
import { listDecks } from "@/lib/decks";
import { BACK_MAX, deckIdByPublicId, FRONT_MAX, SOURCE_MANUAL, STATE_ACCEPTED } from "@/lib/flashcards";
import { accountA } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";
// `sized` and `errorParam` were authored here and moved to a fixture when
// tests/validation/decks.test.ts needed them verbatim — see that file's header.
import { errorParam, sized } from "../fixtures/redirect-cases";
import { clientFor } from "../fixtures/session";

// Card-content rules on the server (test-plan §2 Risk #6, the half C10X-28 left open): the
// browser form is a convenience, not a guard, so every rule it enforces must hold for a
// request that never went through it. This file is about CONTENT only — ownership lives in
// tests/isolation/flashcards.test.ts, per §6.2's one-file-per-resource rule.
//
// Pattern is §6.4's, unchanged: real endpoint via the Container API, real session cookie,
// real local Postgres, assertions on ROWS read back as their owner.
//
// TWO things about these endpoints make a status assertion worthless on its own, and both
// are why every case here carries a row oracle:
//
// 1. They are native-form targets, so a refusal and a success are BOTH a 302. Only the
//    `Location` — and the row — separate them.
// 2. Deck resolution runs BEFORE length validation (cards/index.ts, from S-02 impl-review
//    F5), so a case aimed at a foreign or absent deck answers 404 and measures the wrong
//    guard. Every case below uses a real, owned deck.
//
// ASSERTION ORDER IS LOAD-BEARING: the row/count oracle goes FIRST, before the message.
// Vitest aborts an `it()` at the first failed expect, and the change's breakage pair makes
// the same case fail on both. With the message first, "the endpoint caught it" and "the
// database CHECK caught it" would print the identical failure string and the pair would
// separate nothing. Do not "tidy" this order.
//
// Every refusal asserts the decoded `error` param by EQUALITY, never with
// `toContain("error=")`: under breakage run 1 the endpoint still answers 302 with an
// `error=` param — a different one, from its generic failure branch — so a substring
// assertion would stay green over a guard that had stopped working.

const a = accountA();
const suffix = Date.now().toString(36);

// The two project-owned literals these endpoints refuse with. Built from the shared
// constants, exactly as the endpoints build them.
const FRONT_MESSAGE = `Przód fiszki musi mieć od 1 do ${FRONT_MAX} znaków`;
const BACK_MESSAGE = `Tył fiszki musi mieć od 1 do ${BACK_MAX} znaków`;

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
async function createDeck(name: string): Promise<string> {
  const response = await callEndpoint(CreateDeck, { url: "/api/decks", body: deckForm(name), as: a });
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/decks");

  const { data, error } = await listDecks(clientFor(a.cookieHeader));
  expect(error).toBeNull();
  const created = data?.find((deck) => deck.name === name);
  if (!created) throw new Error(`Setup failed: deck "${name}" was never written.`);
  return created.public_id;
}

/** Resolves a deck's internal id as its owner — the only scope the count oracle may use. */
async function deckIdOf(deckPublicId: string): Promise<number> {
  const { data: deck, error } = await deckIdByPublicId(clientFor(a.cookieHeader), deckPublicId);
  expect(error).toBeNull();
  if (!deck) throw new Error(`Deck ${deckPublicId} is not readable by its owner.`);
  return deck.id;
}

/**
 * A raw, state-agnostic count of a deck's cards.
 *
 * NOT `countFlashcards` (src/lib/flashcards.ts) and NOT `listFlashcards` — the two helpers
 * this need points straight at. Both filter `state_id = STATE_ACCEPTED`, so a card written
 * in any other state is invisible to them and "count unchanged" would read green over a
 * real write. The whole claim of this file is "nothing was written"; the oracle for it
 * cannot carry a filter that hides writes.
 */
async function countCards(deckId: number): Promise<number> {
  const { count, error } = await clientFor(a.cookieHeader)
    .from("flashcard")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", deckId);
  expect(error).toBeNull();
  if (count === null) throw new Error(`Count for deck ${deckId} came back null.`);
  return count;
}

/** Every column an edit can touch, read back as the owner. */
async function rowOf(cardPublicId: string) {
  const { data, error } = await clientFor(a.cookieHeader)
    .from("flashcard")
    .select("public_id, front, back, state_id, created_at, updated_at")
    .eq("public_id", cardPublicId)
    .maybeSingle();
  expect(error).toBeNull();
  if (!data) throw new Error(`Card ${cardPublicId} is not readable by its owner.`);
  return data;
}

/** POSTs any body to the create endpoint, so malformed bodies use the same path as forms. */
function postCard(deckPublicId: string, body: BodyInit): Promise<Response> {
  return callEndpoint(CreateCard, {
    url: `/api/decks/${deckPublicId}/cards`,
    params: { publicId: deckPublicId },
    body,
    as: a,
  });
}

/** POSTs any body to the edit endpoint. */
function postEdit(deckPublicId: string, cardPublicId: string, body: BodyInit): Promise<Response> {
  return callEndpoint(EditCard, {
    url: `/api/decks/${deckPublicId}/cards/${cardPublicId}`,
    params: { publicId: deckPublicId, cardPublicId },
    body,
    as: a,
  });
}

/** Looks a card up by its STORED front — the trimmed value, not what was submitted. */
async function findCardByFront(deckId: number, storedFront: string): Promise<string> {
  const { data, error } = await clientFor(a.cookieHeader)
    .from("flashcard")
    .select("public_id")
    .eq("deck_id", deckId)
    .eq("front", storedFront)
    .maybeSingle();
  expect(error).toBeNull();
  if (!data) throw new Error(`Setup failed: card with front "${storedFront.slice(0, 40)}…" was never written.`);
  return data.public_id;
}

/** Creates a card through the real endpoint and returns its public_id. */
async function createCard(deckPublicId: string, front: string, back: string): Promise<string> {
  const response = await postCard(deckPublicId, cardForm(front, back));
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(`/decks/${deckPublicId}`);
  return findCardByFront(await deckIdOf(deckPublicId), front.trim());
}

describe("POST /api/decks/[publicId]/cards enforces the content rules server-side", () => {
  let deckPublicId: string;
  let deckId: number;

  beforeAll(async () => {
    deckPublicId = await createDeck(`Validation create ${suffix}`);
    deckId = await deckIdOf(deckPublicId);
  });

  it("refuses a front one character over the limit and writes nothing", async () => {
    const before = await countCards(deckId);

    const response = await postCard(
      deckPublicId,
      cardForm(sized(`over-front-${suffix}-`, FRONT_MAX + 1), `Over front back ${suffix}`),
    );

    // Count FIRST — see the file header. Under breakage run 1 this assertion PASSES and the
    // message below fails; under run 2 this one fails. That difference is what separates
    // "the endpoint refused" from "the database CHECK absorbed the write".
    expect(await countCards(deckId)).toBe(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location).toContain("open=create-card");
    expect(errorParam(location)).toBe(FRONT_MESSAGE);
  });

  it("refuses a back one character over the limit and writes nothing", async () => {
    const before = await countCards(deckId);

    const response = await postCard(
      deckPublicId,
      cardForm(`Over back front ${suffix}`, sized(`over-back-${suffix}-`, BACK_MAX + 1)),
    );

    expect(await countCards(deckId)).toBe(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location).toContain("open=create-card");
    expect(errorParam(location)).toBe(BACK_MESSAGE);
  });

  // The control the refusals above are worthless without: an endpoint that refused
  // everything would satisfy every assertion in this file up to here.
  it("accepts content at exactly the limits and stores it whole", async () => {
    const before = await countCards(deckId);
    const front = sized(`edge-front-${suffix}-`, FRONT_MAX);
    const back = sized(`edge-back-${suffix}-`, BACK_MAX);

    const cardPublicId = await createCard(deckPublicId, front, back);

    expect(await countCards(deckId)).toBe(before + 1);
    const row = await rowOf(cardPublicId);
    // Length AND equality: a silent truncation to the bound would satisfy the length check
    // alone while having thrown the tail away.
    expect(row.front.length).toBe(FRONT_MAX);
    expect(row.back.length).toBe(BACK_MAX);
    expect(row.front).toBe(front);
    expect(row.back).toBe(back);
  });

  // The mirror image of /api/generate's raw cap, and the reason C10X-28's "over the cap but
  // trims back under it -> still refused" case does NOT transfer to this side: these
  // endpoints `.trim()` BEFORE measuring, so the same shape is *accepted* here.
  it("measures a front after trimming, so trailing whitespace over the limit is accepted", async () => {
    const before = await countCards(deckId);
    const front = sized(`trim-front-${suffix}-`, FRONT_MAX);
    const submitted = `${front}   `;
    expect(submitted.length).toBeGreaterThan(FRONT_MAX);

    const cardPublicId = await createCard(deckPublicId, submitted, `Trim back ${suffix}`);

    expect(await countCards(deckId)).toBe(before + 1);
    const row = await rowOf(cardPublicId);
    expect(row.front.length).toBe(FRONT_MAX);
    expect(row.front).toBe(front);
  });

  // The lower bound, and the three shapes that reach it are ONE refusal by construction:
  // a missing part, an empty part and a whitespace-only part all measure 0 after the trim,
  // so none of them can be told apart from the outside — which is the intended contract.
  it("refuses a missing, empty or whitespace-only front with one indistinguishable message", async () => {
    const bodies: [string, FormData][] = [
      ["missing", cardForm("", `Missing front back ${suffix}`)],
      ["empty", cardForm("", `Empty front back ${suffix}`)],
      ["whitespace-only", cardForm("   \t \n ", `Whitespace front back ${suffix}`)],
    ];
    // The "missing" case genuinely omits the part rather than sending it empty.
    bodies[0][1].delete("front");

    for (const [label, body] of bodies) {
      const before = await countCards(deckId);
      const response = await postCard(deckPublicId, body);

      expect(await countCards(deckId), label).toBe(before);
      expect(response.status, label).toBe(302);
      expect(errorParam(response.headers.get("Location")), label).toBe(FRONT_MESSAGE);
    }
  });

  // Risk #4's rule applied to this surface: a refusal must not hand the submitted content
  // back into the address bar, where it reaches browser history and the access log.
  it("echoes no part of the submitted content back into the redirect", async () => {
    const marker = `ECHO-${suffix}-MARKER`;
    const before = await countCards(deckId);

    const response = await postCard(deckPublicId, cardForm(sized(marker, FRONT_MAX + 1), "Echo back"));

    expect(await countCards(deckId)).toBe(before);
    const location = response.headers.get("Location") ?? "";
    // The RAW header, not only the decoded param: percent-encoding would hide the marker
    // from a decoded read while it still sat in the URL.
    expect(location).not.toContain(marker);
    expect(location).not.toContain(suffix);
    expect([FRONT_MESSAGE, BACK_MESSAGE]).toContain(errorParam(location));
  });

  // `await request.formData()` rejects on a body that is not a form, and an unguarded
  // rejection is an uncontrolled framework 500 with no project-owned body — the exact
  // shape the two JSON endpoints (batch.ts, generate.ts) already refuse to produce. The
  // convention was applied on one side only.
  it("answers with an owned redirect when the body is not a form at all", async () => {
    const before = await countCards(deckId);

    const response = await postCard(
      deckPublicId,
      // A string body makes callEndpoint set `Content-Type: application/json`, which is
      // what a crafted request outside the form looks like (fixtures/endpoint.ts).
      JSON.stringify({ front: `json-body-${suffix}`, back: `json-body-back-${suffix}` }),
    );

    expect(await countCards(deckId)).toBe(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location.startsWith(`/decks/${deckPublicId}?`)).toBe(true);
    expect(location).toContain("open=create-card");
    expect(errorParam(location)).toBe("Nie udało się utworzyć fiszki");
  });

  // A multipart part of type `File` survives the `as string | null` cast, so `.trim()` is
  // called on a File and throws a TypeError → 500. It must read as empty instead and fall
  // into the length guard the endpoint already owns — no new message.
  it("reads a File part as empty rather than crashing on it", async () => {
    const before = await countCards(deckId);

    const body = new FormData();
    body.set("front", new File([`file-part-${suffix}`], "front.txt", { type: "text/plain" }));
    body.set("back", `File part back ${suffix}`);

    const response = await postCard(deckPublicId, body);

    expect(await countCards(deckId)).toBe(before);
    expect(response.status).toBe(302);
    expect(errorParam(response.headers.get("Location"))).toBe(FRONT_MESSAGE);
  });
});

describe("POST /api/decks/[publicId]/cards/[cardPublicId] enforces the same rules on edit", () => {
  let deckPublicId: string;
  let cardPublicId: string;

  beforeAll(async () => {
    deckPublicId = await createDeck(`Validation edit ${suffix}`);
    cardPublicId = await createCard(deckPublicId, `Edit target ${suffix}`, `Edit target back ${suffix}`);
  });

  // Here the oracle is the ROW rather than a count: the write an over-max edit would make
  // is an UPDATE, which leaves the count untouched however badly it goes.
  it("refuses an over-limit front or back and leaves the row exactly as it was", async () => {
    const before = await rowOf(cardPublicId);

    const overFront = await postEdit(
      deckPublicId,
      cardPublicId,
      cardForm(sized(`edit-over-front-${suffix}-`, FRONT_MAX + 1), `Edit over front back ${suffix}`),
    );
    // Row FIRST, for the reason in the file header.
    expect(await rowOf(cardPublicId)).toEqual(before);
    expect(overFront.status).toBe(302);
    expect(overFront.headers.get("Location") ?? "").toContain(`edit=${cardPublicId}`);
    expect(errorParam(overFront.headers.get("Location"))).toBe(FRONT_MESSAGE);

    const overBack = await postEdit(
      deckPublicId,
      cardPublicId,
      cardForm(`Edit over back front ${suffix}`, sized(`edit-over-back-${suffix}-`, BACK_MAX + 1)),
    );
    expect(await rowOf(cardPublicId)).toEqual(before);
    expect(overBack.status).toBe(302);
    expect(overBack.headers.get("Location") ?? "").toContain(`edit=${cardPublicId}`);
    expect(errorParam(overBack.headers.get("Location"))).toBe(BACK_MESSAGE);
  });

  // The edit side's boundary control: without it every refusal above is satisfied by an
  // endpoint that refuses every edit.
  it("accepts an edit at exactly the limits and stores it whole", async () => {
    const target = await createCard(deckPublicId, `Edit edge target ${suffix}`, `Edit edge back ${suffix}`);
    const front = sized(`edit-edge-front-${suffix}-`, FRONT_MAX);
    const back = sized(`edit-edge-back-${suffix}-`, BACK_MAX);

    const response = await postEdit(deckPublicId, target, cardForm(front, back));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location") ?? "").toContain(`saved=${target}`);
    const row = await rowOf(target);
    expect(row.front.length).toBe(FRONT_MAX);
    expect(row.back.length).toBe(BACK_MAX);
    expect(row.front).toBe(front);
    expect(row.back).toBe(back);
  });

  // Same guard as create, with one difference that is easy to get wrong: `formData()` is
  // read BEFORE `errorUrl` exists here, because `errorUrl` is built from the `from` /
  // `generation` form fields. So the catch cannot use it and falls back to the unscoped
  // deck-view target — which is what this case pins.
  it("answers with an owned redirect when the body is not a form at all", async () => {
    const before = await rowOf(cardPublicId);

    const response = await postEdit(
      deckPublicId,
      cardPublicId,
      JSON.stringify({ front: `json-edit-${suffix}`, back: `json-edit-back-${suffix}` }),
    );

    expect(await rowOf(cardPublicId)).toEqual(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location.startsWith(`/decks/${deckPublicId}?`)).toBe(true);
    expect(location).toContain(`edit=${cardPublicId}`);
    expect(errorParam(location)).toBe("Nie udało się zapisać zmian");
  });

  // The create side's File case has a twin here on purpose (impl-review F4): Phase 2 applied
  // the same string-only read to BOTH endpoints, and an untested branch is a branch that can
  // drift from the copy that is tested. Note this endpoint routes four fields through it —
  // `front`, `back`, `from`, `generation` — so a File reaching `from` must also fail the
  // `=== "review"` switch rather than satisfying it, which is why the redirect is asserted
  // to carry the UNSCOPED deck-view target and not the review one.
  it("reads a File part as empty rather than crashing on it", async () => {
    const before = await rowOf(cardPublicId);

    const body = new FormData();
    body.set("front", new File([`edit-file-part-${suffix}`], "front.txt", { type: "text/plain" }));
    body.set("back", `Edit file part back ${suffix}`);
    body.set("from", new File(["review"], "from.txt", { type: "text/plain" }));

    const response = await postEdit(deckPublicId, cardPublicId, body);

    expect(await rowOf(cardPublicId)).toEqual(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location.startsWith(`/decks/${deckPublicId}?`)).toBe(true);
    expect(location).not.toContain("/review");
    expect(errorParam(location)).toBe(FRONT_MESSAGE);
  });
});

describe("the database enforces the content bounds independently of the endpoints", () => {
  let deckId: number;

  beforeAll(async () => {
    deckId = await deckIdOf(await createDeck(`Validation db bounds ${suffix}`));
  });

  /** An insert straight through the RLS-scoped client — around the endpoint, never around the lock. */
  function insertDirect(front: string, back: string) {
    return clientFor(a.cookieHeader)
      .from("flashcard")
      .insert({ deck_id: deckId, front, back, state_id: STATE_ACCEPTED, source_id: SOURCE_MANUAL })
      .select("public_id")
      .maybeSingle();
  }

  // The claim the migration exists to make: the four endpoint lines are no longer the only
  // enforcer in the system. Asserted by CODE (`23514`, the CHECK-violation SQLSTATE) rather
  // than by message, as deck_session_size_check is in tests/study/study.test.ts.
  //
  // Both halves live in one `it()` on purpose: breakage run 2 drops ONLY
  // flashcard_front_check, so the `back` half stays green throughout and keeps the second
  // constraint observed while the first is gone — the two are never both unobserved.
  it("rejects an over-limit front and an over-limit back with 23514", async () => {
    // The NAME as well as the code, following study.test.ts's deck_session_size_check case
    // exactly: `23514` alone says "some CHECK on this table refused it", which cannot tell
    // the two constraints apart — so a front bound accidentally widened to cover `back`, or
    // a future third CHECK firing first, would leave both halves below green. The name is
    // what pins WHICH guard refused, and layer attribution is this file's whole purpose.
    const overFront = await insertDirect(sized(`db-front-${suffix}-`, FRONT_MAX + 1), `DB front back ${suffix}`);
    expect(overFront.error?.code).toBe("23514");
    expect(overFront.error?.message).toContain("flashcard_front_check");
    expect(overFront.data).toBeNull();

    const overBack = await insertDirect(`DB back front ${suffix}`, sized(`db-back-${suffix}-`, BACK_MAX + 1));
    expect(overBack.error?.code).toBe("23514");
    expect(overBack.error?.message).toContain("flashcard_back_check");
    expect(overBack.data).toBeNull();

    // The positive control: without it a constraint that rejected EVERY insert — or an RLS
    // policy that refused the whole seam — would satisfy both assertions above.
    const inRange = await insertDirect(sized(`db-ok-${suffix}-`, FRONT_MAX), sized(`db-ok-back-${suffix}-`, BACK_MAX));
    expect(inRange.error).toBeNull();
    expect(inRange.data?.public_id).toBeTruthy();
    // The in-range insert is the only one of the three that WRITES, and until C10X-39
    // nothing counted after it — so a replayed insert (tests/setup/retry-transport.ts) left
    // two rows here and this case stayed green, measured in the Phase 3 census.
    // `.maybeSingle()` in insertDirect cannot stand in for this: it reads ONE response,
    // while the duplicate arrives in another. This describe owns its deck and only this
    // line writes to it, so the count is exactly one.
    expect(await countCards(deckId)).toBe(1);
  });
});
