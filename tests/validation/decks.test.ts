import { beforeAll, describe, expect, it } from "vitest";
import * as CreateDeck from "@/pages/api/decks/index";
import * as RenameDeck from "@/pages/api/decks/[publicId]";
import { NAME_MAX } from "@/lib/deck-limits";
import { accountA } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";
import { errorParam, sized } from "../fixtures/redirect-cases";
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
// ASSERTION ORDER IS LOAD-BEARING wherever a case HAS a row or count oracle: it goes FIRST,
// before the message. Vitest aborts an `it()` at the first failed expect, and this change's
// breakage pair makes the same case fail on both. With the message first, "the endpoint caught
// it" and "deck_name_check caught it" would print the identical failure string and the pair
// would separate nothing. Do not "tidy" this order.
//
// WHICH oracle a case gets depends on what it submits, and the split is load-bearing rather
// than bookkeeping — `deck` has no containing column to count by, and both helpers the need
// points at are wrong: `deckNameExists` filters one exact name and `.maybeSingle()`s, while
// `listDecks` carries NO WHERE clause at all and decays into a false pass past PostgREST's
// `max_rows`, exactly as the `listDueCounts` denial did (§6.6, Phase 4). So:
//
//   - RENAME, every case: the oracle is the ROW, `toEqual(before)` column for column. It works
//     whatever the request carried — no form at all, a File part, an over-length name — because
//     an UPDATE leaves the row identifiable regardless. That is why the nameless cases below
//     are routed through rename as well as create: rename is where those refusals get a real
//     oracle, at the cost of one extra `it()` rather than new apparatus.
//   - CREATE with a usable name (over-length, the boundary controls, trailing whitespace,
//     duplicate): a raw count scoped by a per-case name MARKER, which works because the name
//     under test *is* the marker.
//   - CREATE carrying a name the endpoint must never LOOK AT (the non-form JSON body, the File
//     part): these DO get a marker-scoped count, and the distinction was got wrong here first
//     (corrected 2026-08-01, C10X-40). The paragraph below used to sweep them in with the
//     nameless cases on the grounds that "there is no name to carry a marker" — but both submit
//     a perfectly usable name, merely somewhere the endpoint has no business reading, so the
//     count is falsifiable exactly as it is for an over-length name: a regression that parsed
//     the JSON body leniently, or read the File's text rather than narrowing it to "", writes a
//     deck named precisely the marker. The over-broad claim was the expensive half — it told a
//     future contributor not to look.
//   - CREATE with NO usable name (missing / empty / whitespace-only, the broken-form body):
//     these have NO row oracle and this file says so rather than faking one. There is no name to
//     carry a marker, so a marker-scoped count reads 0 before and after whatever the endpoint
//     does — an assertion that cannot go red, the `listDueCounts` false-pass class one table
//     over. A delta over account A's own decks is not the escape either: A is shared across
//     FILES, and generate.test.ts (`newDeckName`) and isolation/decks.test.ts both create decks
//     as A in parallel workers, so the delta races. They rest on the 302 plus the decoded
//     `error` EQUALITY — honest for a second reason: deck_name_check refuses a '' name
//     independently (asserted in the last describe), so at the endpoint layer there is nothing a
//     row oracle could distinguish. Consequence to carry forward: under breakage run 1 these
//     particular cases attribute nothing to either enforcement layer.

const a = accountA();
const suffix = Date.now().toString(36);

// The project-owned literals these endpoints refuse with. Spelled out here rather than
// imported from `@/lib/redirect-errors`, and the bound-derived one INTERPOLATED from
// `NAME_MAX` exactly as the endpoints build it — the discipline cards.test.ts follows for
// FRONT_MESSAGE/BACK_MESSAGE. Importing the constants would make every assertion agree with
// itself, and the failure this file has to catch is precisely a "tidied" string: a reworded
// message falls out of the closed set silently, so the banner stops appearing rather than
// anything going red.
const NAME_MESSAGE = `Nazwa talii musi mieć od 1 do ${NAME_MAX} znaków`;
const TAKEN_MESSAGE = "Talia o tej nazwie już istnieje";
const CREATE_FAILED_MESSAGE = "Nie udało się utworzyć talii";
const RENAME_FAILED_MESSAGE = "Nie udało się zmienić nazwy talii";

// A body that CLAIMS to be a form and cannot be parsed as one — the only way to stage the
// second cause of a formData() rejection, since a real client abort cannot be produced through
// the Container API. Shape from tests/auth/errors.test.ts:424-443.
const BROKEN_FORM_HEADERS = { "Content-Type": "multipart/form-data; boundary=NOTTHEBOUNDARY" };
const BROKEN_FORM_BODY = '--REAL\r\nContent-Disposition: form-data; name="name"\r\n\r\nbroken';

/** Case names must stay LIKE-safe — `%` and `_` are wildcards, so an unsafe one widens a count silently. */
const SAFE_CASE_NAME = /^[a-z0-9-]+$/;

/**
 * The prefix one case's deck names open with, and the scope of its count oracle.
 *
 * The run suffix separates RUNS (§6.5); the case name separates the `it()`s of one run, which
 * all read as the same account A and would otherwise be summed by an unscoped count.
 */
function mark(caseName: string): string {
  if (!SAFE_CASE_NAME.test(caseName)) {
    throw new Error(`Setup failed: case name "${caseName}" must match ${String(SAFE_CASE_NAME)} — LIKE wildcards.`);
  }
  return `${caseName}-${suffix}-`;
}

function deckForm(name: string): FormData {
  const body = new FormData();
  body.set("name", name);
  return body;
}

/** POSTs any body to the create endpoint, so malformed bodies use the same path as forms. */
function postDeck(body: BodyInit, headers?: Record<string, string>): Promise<Response> {
  return callEndpoint(CreateDeck, { url: "/api/decks", body, headers, as: a });
}

/** POSTs any body to the rename endpoint. */
function postRename(deckPublicId: string, body: BodyInit, headers?: Record<string, string>): Promise<Response> {
  return callEndpoint(RenameDeck, {
    url: `/api/decks/${deckPublicId}`,
    params: { publicId: deckPublicId },
    body,
    headers,
    as: a,
  });
}

/**
 * A raw count of the owner's decks whose name opens with `marker`.
 *
 * Deliberately neither `deckNameExists` nor `listDecks` — see the file header for why both are
 * wrong here. Scoping by the marker rather than by the whole name also keeps the filter a few
 * dozen bytes whatever the name's length, clear of the ~8 KB request-line cap that answers a
 * bare `414` for a value-scoped filter (`tests/fixtures/scoping.ts`).
 */
async function countDecksNamed(marker: string): Promise<number> {
  const { count, error } = await clientFor(a.cookieHeader)
    .from("deck")
    .select("id", { count: "exact", head: true })
    .like("name", `${marker}%`);
  expect(error).toBeNull();
  if (count === null) throw new Error(`Count for marker "${marker}" came back null.`);
  return count;
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

/** Resolves a deck's public_id from its STORED name — the trimmed value, not what was submitted. */
async function deckIdByName(storedName: string): Promise<string> {
  const { data, error } = await clientFor(a.cookieHeader)
    .from("deck")
    .select("public_id")
    .eq("name", storedName)
    .maybeSingle();
  expect(error).toBeNull();
  // Guard, not an assertion: if setup silently produced nothing, every case below would pass
  // vacuously against a deck that does not exist.
  if (!data) throw new Error(`Setup failed: deck "${storedName.slice(0, 40)}…" was never written.`);
  return data.public_id;
}

/**
 * Creates a deck through the real endpoint and returns its public_id.
 *
 * `stored` defaults to the trimmed submission because these endpoints trim before they measure
 * AND before they write — which is what the trailing-whitespace case turns on.
 */
async function createDeck(submitted: string, stored: string = submitted.trim()): Promise<string> {
  const response = await postDeck(deckForm(submitted));
  expect(response.status).toBe(302);
  // The endpoint redirects on failure too (/decks?error=…&open=create), so the status alone
  // proves nothing — only the Location separates a real create from a rejected one.
  expect(response.headers.get("Location")).toBe("/decks");
  return deckIdByName(stored);
}

// No shared fixture in this block, and that is deliberate rather than incidental: every case
// owns the marker it counts and, where it creates a deck, the deck it reads back. The suite
// runs shuffled with an un-pinned seed (§6.2), so a control mutating a `beforeAll` deck the
// cases beside it measured would be green only in declaration order.
describe("POST /api/decks enforces the name rules server-side", () => {
  it("refuses a name one character over the limit and writes nothing", async () => {
    const marker = mark("over-create");
    const before = await countDecksNamed(marker);

    const response = await postDeck(deckForm(sized(marker, NAME_MAX + 1)));

    // Count FIRST — see the file header. Under breakage run 1 this assertion PASSES and the
    // message below fails, which is what shows deck_name_check absorbed the write; under run 2
    // this one fails instead. That difference is the whole point of the pair.
    expect(await countDecksNamed(marker)).toBe(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location).toContain("open=create");
    expect(errorParam(location)).toBe(NAME_MESSAGE);
  });

  // The control every refusal in this block is worthless without: an endpoint that refused
  // everything would satisfy all of them.
  it("accepts a name at exactly the limit and stores it whole", async () => {
    const marker = mark("edge-create");
    const name = sized(marker, NAME_MAX);
    const before = await countDecksNamed(marker);

    const publicId = await createDeck(name);

    expect(await countDecksNamed(marker)).toBe(before + 1);
    const row = await rowOf(publicId);
    // Length AND equality: a silent truncation to the bound satisfies a length check alone
    // while having thrown the tail away.
    expect(row.name.length).toBe(NAME_MAX);
    expect(row.name).toBe(name);
  });

  // The mirror image of /api/generate's RAW cap, and the reason C10X-28's "over the cap but
  // trims back under it -> still refused" case does NOT transfer to this side: these endpoints
  // `.trim()` BEFORE measuring, so the same shape is *accepted* here.
  it("measures a name after trimming, so trailing whitespace over the limit is accepted", async () => {
    const marker = mark("trim-create");
    const name = sized(marker, NAME_MAX);
    const submitted = `${name}   `;
    expect(submitted.length).toBeGreaterThan(NAME_MAX);
    const before = await countDecksNamed(marker);

    const publicId = await createDeck(submitted, name);

    expect(await countDecksNamed(marker)).toBe(before + 1);
    const row = await rowOf(publicId);
    expect(row.name.length).toBe(NAME_MAX);
    expect(row.name).toBe(name);
  });

  // NO ROW ORACLE HERE, AND IT IS STATED RATHER THAN FAKED — see the file header. The three
  // shapes are ONE refusal by construction: a missing part, an empty part and a whitespace-only
  // part all measure 0 after the trim, so none can be told apart from outside, which is the
  // intended contract. Their rename twins below are where the same refusal gets an oracle.
  it("refuses a missing, empty or whitespace-only name with one indistinguishable message", async () => {
    // The "missing" case genuinely omits the part rather than sending it empty. Built before the
    // table rather than reached for by index afterwards, so there is no indexed access to narrow
    // under `noUncheckedIndexedAccess` (C10X-43) and no `?.` that could no-op the omission.
    const missing = deckForm("");
    missing.delete("name");
    const bodies: [string, FormData][] = [
      ["missing", missing],
      ["empty", deckForm("")],
      ["whitespace-only", deckForm("   \t \n ")],
    ];

    for (const [label, body] of bodies) {
      const response = await postDeck(body);

      expect(response.status, label).toBe(302);
      const location = response.headers.get("Location") ?? "";
      expect(location, label).toContain("open=create");
      expect(errorParam(location), label).toBe(NAME_MESSAGE);
    }
  });

  // `await request.formData()` rejects on a body that was never a form, and an unguarded
  // rejection is an uncontrolled framework 500 with no project-owned body — the exact shape
  // the two JSON endpoints (batch.ts, generate.ts) and the four endpoints C10X-30 swept
  // already refuse to produce. The convention reached four of the six readers.
  it("answers with an owned redirect when the body is not a form at all", async () => {
    // THIS CASE DOES HAVE A ROW ORACLE, unlike its four nameless siblings (C10X-40, 2026-08-01).
    // The body carries a usable name — it is simply somewhere the endpoint must never look — so
    // the count CAN go red: a regression that parsed the JSON body leniently would write a deck
    // named exactly this. Counting is free here and the header used to claim, over-broadly, that
    // it was impossible.
    const marker = mark("json-body");
    const before = await countDecksNamed(marker);

    const response = await postDeck(
      // A string body makes callEndpoint set `Content-Type: application/json`, which is what a
      // crafted request outside the form looks like (fixtures/endpoint.ts).
      JSON.stringify({ name: `${marker}name` }),
    );

    expect(await countDecksNamed(marker)).toBe(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location.startsWith("/decks?")).toBe(true);
    expect(location).toContain("open=create");
    expect(errorParam(location)).toBe(CREATE_FAILED_MESSAGE);
  });

  // The OTHER cause of a formData() rejection: a body announced as a form that arrived broken
  // (a client abort mid-upload, a transport reset). Both causes deliberately share ONE message
  // here, unlike signin/signup which split them — this endpoint's copy reads as "the operation
  // failed" and is truthful for both, and it is already a member of the closed set, so nothing
  // new entered it. The `not.toBe` is what makes the case discriminating rather than
  // decorative: it pins that the CATCH answered, not the length guard reading an unparsed body
  // as an empty name.
  it("answers with an owned redirect when a body announced as a form does not parse", async () => {
    const response = await postDeck(BROKEN_FORM_BODY, BROKEN_FORM_HEADERS);

    expect(response.status).toBe(302);
    const error = errorParam(response.headers.get("Location"));
    expect(error).toBe(CREATE_FAILED_MESSAGE);
    expect(error).not.toBe(NAME_MESSAGE);
  });

  // A multipart part of type `File` survives the `as string | null` cast, so `.trim()` is
  // called on a File and throws a TypeError → 500. It must read as empty instead and fall into
  // the length guard the endpoint already owns — no new message enters the closed set.
  it("reads a File name part as empty rather than crashing on it", async () => {
    // Same as the non-form case above: the File's CONTENT is a usable name, so a regression that
    // read the part's text instead of narrowing it to "" would write a deck named exactly this.
    // A real oracle, not a vacuous one — but a NARROWER one than its JSON-body twin, and the two
    // should not be read as equivalent (C10X-40 impl-review F10). It is red only for a regression
    // that AWAITS the part's text. The two regressions that actually happen here write nothing and
    // so are caught by the status and message assertions alone, not by this count: the bare
    // `as string | null` cast throws a TypeError at `.trim()` (→ 500), and a `String(value)`
    // coercion yields the literal "[object File]". The count covers the third, quieter class —
    // a handler that "helpfully" reads the upload.
    const marker = mark("file-part");
    const before = await countDecksNamed(marker);

    const body = new FormData();
    body.set("name", new File([`${marker}name`], "name.txt", { type: "text/plain" }));

    const response = await postDeck(body);

    expect(await countDecksNamed(marker)).toBe(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location).toContain("open=create");
    expect(errorParam(location)).toBe(NAME_MESSAGE);
  });

  // Risk #4's rule applied to this surface: a refusal must not hand the submitted name back
  // into the address bar, where it reaches browser history and the access log.
  it("echoes no part of the submitted name back into the redirect", async () => {
    const marker = mark("echo-create");
    const before = await countDecksNamed(marker);

    const response = await postDeck(deckForm(sized(marker, NAME_MAX + 1)));

    expect(await countDecksNamed(marker)).toBe(before);
    const location = response.headers.get("Location") ?? "";
    // The RAW header, not only the decoded param: percent-encoding would hide the marker from
    // a decoded read while it still sat in the URL.
    expect(location).not.toContain(marker);
    expect(location).not.toContain(suffix);
    expect(errorParam(location)).toBe(NAME_MESSAGE);
  });

  // Owns the deck it collides with, inside its own `it()` — §6.2's rule, and the reason this
  // block has no shared fixture.
  it("refuses a duplicate name and leaves the existing deck untouched", async () => {
    const marker = mark("dup-create");
    const name = sized(marker, 40);
    const publicId = await createDeck(name);
    const before = await rowOf(publicId);
    expect(await countDecksNamed(marker)).toBe(1);

    const response = await postDeck(deckForm(name));

    expect(await countDecksNamed(marker)).toBe(1);
    expect(await rowOf(publicId)).toEqual(before);
    expect(response.status).toBe(302);
    expect(errorParam(response.headers.get("Location"))).toBe(TAKEN_MESSAGE);
  });
});

describe("POST /api/decks/[publicId] enforces the same rules on rename", () => {
  let deckPublicId: string;

  // Safe to share: every case reading this deck is a REFUSAL asserting `toEqual(before)`
  // against a row it re-reads inside its own `it()`. The one case that genuinely mutates a
  // deck — the boundary control — creates its own (§6.2).
  beforeAll(async () => {
    deckPublicId = await createDeck(`Validation rename ${suffix}`);
  });

  it("refuses a name one character over the limit and leaves the row exactly as it was", async () => {
    const before = await rowOf(deckPublicId);

    const response = await postRename(deckPublicId, deckForm(sized(mark("over-rename"), NAME_MAX + 1)));

    // Row FIRST, for the reason in the file header. Rename is where the nameless refusals get
    // a real oracle too: an UPDATE leaves the row identifiable however the request was malformed.
    expect(await rowOf(deckPublicId)).toEqual(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location).toContain("open=rename");
    expect(errorParam(location)).toBe(NAME_MESSAGE);
  });

  // The rename side's boundary control, on a deck it owns: without it every refusal in this
  // block is satisfied by an endpoint that refuses every rename.
  it("accepts a rename at exactly the limit and stores it whole", async () => {
    const target = await createDeck(`Rename edge target ${suffix}`);
    const name = sized(mark("edge-rename"), NAME_MAX);

    const response = await postRename(target, deckForm(name));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/decks/${target}`);
    const row = await rowOf(target);
    expect(row.name.length).toBe(NAME_MAX);
    expect(row.name).toBe(name);
  });

  it("refuses a missing, empty or whitespace-only name and leaves the row untouched", async () => {
    const missing = deckForm("");
    missing.delete("name");
    const bodies: [string, FormData][] = [
      ["missing", missing],
      ["empty", deckForm("")],
      ["whitespace-only", deckForm("   \t \n ")],
    ];

    for (const [label, body] of bodies) {
      const before = await rowOf(deckPublicId);
      const response = await postRename(deckPublicId, body);

      expect(await rowOf(deckPublicId), label).toEqual(before);
      expect(response.status, label).toBe(302);
      expect(errorParam(response.headers.get("Location")), label).toBe(NAME_MESSAGE);
    }
  });

  it("answers with an owned redirect when the body is not a form at all", async () => {
    const before = await rowOf(deckPublicId);

    const response = await postRename(deckPublicId, JSON.stringify({ name: `json-rename-${suffix}` }));

    expect(await rowOf(deckPublicId)).toEqual(before);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    // `errorUrl` is built from the ROUTE PARAM well above the formData() read, and is
    // already UUID-gated, so unlike cards/[cardPublicId].ts this catch has no ordering
    // constraint to work around and keeps the deck-scoped rename target.
    expect(location.startsWith(`/decks/${deckPublicId}?`)).toBe(true);
    expect(location).toContain("open=rename");
    expect(errorParam(location)).toBe(RENAME_FAILED_MESSAGE);
  });

  it("answers with an owned redirect when a body announced as a form does not parse", async () => {
    const before = await rowOf(deckPublicId);

    const response = await postRename(deckPublicId, BROKEN_FORM_BODY, BROKEN_FORM_HEADERS);

    expect(await rowOf(deckPublicId)).toEqual(before);
    expect(response.status).toBe(302);
    const error = errorParam(response.headers.get("Location"));
    expect(error).toBe(RENAME_FAILED_MESSAGE);
    expect(error).not.toBe(NAME_MESSAGE);
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
    expect(errorParam(location)).toBe(NAME_MESSAGE);
  });
});

describe("the database enforces the deck-name bound independently of the endpoints", () => {
  /** An insert straight through the RLS-scoped client — around the endpoint, never around the lock. */
  function insertDirect(name: string) {
    return clientFor(a.cookieHeader).from("deck").insert({ user_id: a.userId, name }).select("public_id").maybeSingle();
  }

  // The claim that lets breakage run 2 attribute anything: the two endpoint lines are not the
  // only enforcer of 1..100. Asserted by CODE (`23514`, the CHECK-violation SQLSTATE) AND by
  // NAME, following study.test.ts's deck_session_size_check case exactly — `23514` alone says
  // "some CHECK on this table refused it", which cannot tell constraints apart, and layer
  // attribution is this describe's whole purpose. The name was read off the live stack
  // (`pg_get_constraintdef`), not inferred from the flashcard_front_check precedent.
  it("rejects an over-limit and an empty name with 23514 from deck_name_check", async () => {
    const overLimit = await insertDirect(sized(mark("db-over"), NAME_MAX + 1));
    expect(overLimit.error?.code).toBe("23514");
    expect(overLimit.error?.message).toContain("deck_name_check");
    expect(overLimit.data).toBeNull();

    // The lower bound, and the reason the nameless CREATE cases above have no row oracle: the
    // database refuses '' independently of the endpoint, so those refusals could never have
    // been attributed to one layer even with a count to hang them on.
    const empty = await insertDirect("");
    expect(empty.error?.code).toBe("23514");
    expect(empty.error?.message).toContain("deck_name_check");
    expect(empty.data).toBeNull();

    // The positive control: without it a constraint that rejected EVERY insert — or an RLS
    // policy that refused the whole seam — would satisfy both assertions above. Its name
    // carries the run suffix because deck_user_name_unique makes a duplicated insert a loud
    // 23505 rather than a quiet no-op (tests/setup/retry-transport.ts:37-44 relies on that).
    const inRange = await insertDirect(sized(mark("db-ok"), NAME_MAX));
    expect(inRange.error).toBeNull();
    expect(inRange.data?.public_id).toBeTruthy();
  });
});
