import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPABASE_URL } from "astro:env/server";
import * as Generate from "@/pages/api/generate";
import { FRONT_MAX } from "@/lib/flashcards";
// The URL is IMPORTED from production, never re-declared: see the fetch double below, whose
// predicate is fail-closed and would otherwise be keyed on a copy that can drift.
import { OPENROUTER_URL } from "@/lib/openrouter";
import { accountA } from "../fixtures/accounts";
import { callEndpoint } from "../fixtures/endpoint";
import { createScoping } from "../fixtures/scoping";
import { clientFor } from "../fixtures/session";

// test-plan §2 Risk #4 — "private source text or the LLM API key escapes into a log line
// or an error response body" — on the two branches nothing else in this suite can reach.
//
// THE CONFINEMENT RULE FOR MODULE DOUBLES IN THIS PROJECT. Read it before copying
// anything here; the cookbook entry is test-plan §6.9.
//
//   - Module doubles live in THIS file. It is the project's first and, so far, only one.
//   - The only module ever doubled is `astro:env/server`, and only to lift the clamp that
//     otherwise seals the failure branches: preflight aborts the run when
//     OPENROUTER_API_KEY is set (tests/setup/preflight.ts), openrouter.ts short-circuits to
//     mockCards when it is unset, and under Vitest an `astro:env` secret is a
//     TRANSFORM-time inlined literal — so `vi.stubEnv`, `process.env` and `setGetEnv` are
//     all dead seams. Replacing the module is the only one there is.
//   - `@/lib/openrouter` is deliberately NOT doubled. Doubling `generateCandidates` would
//     make openrouter.ts's request-building code unreachable, and with it the
//     `Authorization` header this file exists to pin — half the claim would evaporate
//     silently. Every line of that module runs here, so `OpenRouterError` keeps its
//     identity natively and the audit payloads are the ones PRODUCTION builds.
//   - The pass-through `fetch` double is the REPLACEMENT GUARD for the lifted preflight
//     clamp, not a convenience (lessons.md: "Preflight musi domknąć KAŻDY nielokalny
//     szew"). A sentinel key with no fetch double means a real, billed call to
//     openrouter.ai. It is installed FIRST, before any request is made.
//   - The database and RLS are NEVER doubled. Every row below is read back through the
//     app's own RLS-scoped client, over the same `globalThis.fetch` the double delegates.
//
// What the two branches are, and why each is here:
//
//   502 (generate.ts) — OpenRouter answered non-ok, openrouter.ts throws OpenRouterError.
//   422 (generate.ts) — OpenRouter answered 200 but no card survived `candidateSchema`.
//
// Both persist a `failed` generation_session carrying the private material, and both
// answer the client with a fixed Polish literal. That CONTRAST is the assertion: the row
// provably holds the source text and the upstream string, the body provably holds
// neither, on one and the same request.

const { SENTINEL_KEY } = vi.hoisted(() => ({
  // Shared through vi.hoisted because `vi.mock` factories are hoisted above every import:
  // a plain module-scope `const` is still in its TDZ when the factory runs.
  SENTINEL_KEY: "sk-or-harness-SENTINEL-2f7c1d9e",
}));

vi.mock("astro:env/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("astro:env/server")>();
  // `...actual` is load-bearing for a reason that has nothing to do with the key:
  // SUPABASE_URL/SUPABASE_KEY come from this same module (src/lib/supabase.ts). A factory
  // returning only the key makes createClient() return null and /api/generate answers 500
  // before it ever reaches the LLM call — which reads as a mysterious failure rather than
  // as the wiring error it is.
  return { ...actual, OPENROUTER_API_KEY: SENTINEL_KEY };
});

const a = accountA();
const suffix = Date.now().toString(36);
const COUNT = 3;

// Same prefix-scoping rule as tests/generation/generate.test.ts, and now literally the same
// code: shared via tests/fixtures/scoping.ts, which carries the 414 rationale (impl-review F7).
const { mark, scope } = createScoping(suffix);

// Every private value carries a per-run sentinel token rather than being matched whole:
// `not.toContain(<the entire source text>)` would pass on a partial leak, which is the
// leak shape a truncating logger or an interpolated `err.message` actually produces.
const SOURCE_SENTINEL = `zrodlo-sentinel-${suffix}`;
const UPSTREAM_SENTINEL = `upstream-sentinel-${suffix}`;

const HTTP_FAILURE_TEXT = `${mark("http-failure")} ${SOURCE_SENTINEL} — prywatny tekst źródłowy`;
const TRANSPORT_FAILURE_TEXT = `${mark("transport-failure")} ${SOURCE_SENTINEL} — prywatny tekst źródłowy`;
const INVALID_CARDS_TEXT = `${mark("invalid-cards")} ${SOURCE_SENTINEL} — prywatny tekst źródłowy`;
const KEY_PIN_TEXT = `${mark("key-pin")} ${SOURCE_SENTINEL} — prywatny tekst źródłowy`;

// --- The pass-through fetch double ----------------------------------------------------

const realFetch = globalThis.fetch;

/** What the next OpenRouter call answers with. Set by each test, reset after it. */
let upstream: () => Response = () =>
  new Response("SETUP: no upstream response was queued for this call", { status: 500 });

/** The outgoing OpenRouter request, as production code built it. */
let captured: { authorization: string | null; body: string } | null = null;

const fetchDouble: typeof globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);

  // FAIL-CLOSED, and that is the whole point of the shape (impl-review F2). This file
  // deliberately lifts the preflight clamp that keeps the suite off the real provider, so
  // this double IS that clamp for the duration. The predicate used to be "anything that is
  // not OpenRouter goes to the real network", which fails in the dangerous direction: an
  // OpenRouter URL the predicate stopped recognising would have been DELEGATED — a real,
  // billed request to openrouter.ai carrying the pasted source text below and an
  // Authorization header built by production code. Now the only host that reaches the
  // network is Supabase, and anything else is a loud failure rather than a silent call.
  //
  // Supabase must still be delegated for real: inside one callEndpoint the endpoint makes
  // six Supabase calls over globalThis.fetch and the assertions read the audit row back the
  // same way, so a replacement double would break both.
  if (!url.startsWith(OPENROUTER_URL)) {
    if (SUPABASE_URL && url.startsWith(SUPABASE_URL)) {
      return realFetch(input, init);
    }
    return Promise.reject(
      new Error(
        `Blocked an un-allow-listed outbound request to ${url}. This file runs with the ` +
          `preflight clamp lifted, so only Supabase may reach the network. If a new host is ` +
          `legitimate, allow-list it here deliberately — do not widen the predicate.`,
      ),
    );
  }
  const headers = new Headers(init?.headers);
  captured = {
    authorization: headers.get("Authorization"),
    body: typeof init?.body === "string" ? init.body : "",
  };
  return Promise.resolve(upstream());
};

beforeAll(() => {
  globalThis.fetch = fetchDouble;
});

afterAll(() => {
  // Restored for the INTRA-file hazard, not the cross-file one: `isolate: true` and
  // `pool: "forks"` already keep a double out of every other file by configuration, while
  // `restoreMocks`/`unstubGlobals` both default to false — so a stale double would be this
  // file's own problem first.
  //
  // What actually PROVES the double delegates rather than replaces is not this line: it is
  // that every it() below reads its audit row (and its deck count) back over the same
  // globalThis.fetch, after the double is installed. A double that swallowed the Supabase
  // calls would go red on the row read, in each test, long before this teardown.
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  captured = null;
});

afterEach(() => {
  upstream = () => new Response("SETUP: no upstream response was queued for this call", { status: 500 });
});

// --- Helpers --------------------------------------------------------------------------

/** One POST to the real generation endpoint, as account A. */
function generate(body: Record<string, unknown>): Promise<Response> {
  return callEndpoint(Generate, { url: "/api/generate", body: JSON.stringify(body), as: a });
}

/** The single audit row this case wrote, read back as its owner, every column. */
async function sessionFor(sourceText: string) {
  const { data, error } = await clientFor(a.cookieHeader)
    .from("generation_session")
    .select("*")
    .like("source_text", scope(sourceText));
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  const row = data?.[0];
  if (!row) throw new Error(`Setup failed: no generation_session was written for ${scope(sourceText)}.`);
  return row;
}

/** Account A's decks carrying exactly this name — the "no deck was created" oracle. */
async function decksNamed(name: string) {
  const { data, error } = await clientFor(a.cookieHeader).from("deck").select("id").eq("name", name);
  expect(error).toBeNull();
  return data ?? [];
}

/** A model answer whose cards all breach FRONT_MAX, so every one is dropped by Zod. */
function invalidCardsBody(): string {
  return JSON.stringify({
    // The sentinel rides on the response object itself, so it lands in `rawResponse` and
    // therefore in the `response_payload` column — which is where the 422 path carries the
    // upstream material (its `error_message` is a fixed literal, unlike the 502 path's).
    id: UPSTREAM_SENTINEL,
    choices: [
      {
        message: {
          content: JSON.stringify({
            cards: [
              { front: "x".repeat(FRONT_MAX + 1), back: "Odpowiedź" },
              { front: "y".repeat(FRONT_MAX + 1), back: "Odpowiedź" },
            ],
          }),
        },
      },
    ],
  });
}

describe("/api/generate withholds from the body what it records in the audit row", () => {
  it("502s an upstream HTTP failure: the row keeps the source text, the body leaks nothing", async () => {
    const newDeckName = `Talia 502 ${suffix}`;
    upstream = () => new Response(UPSTREAM_SENTINEL, { status: 401 });

    const response = await generate({
      newDeckName,
      sourceText: HTTP_FAILURE_TEXT,
      language: "auto",
      count: COUNT,
    });

    expect(response.status).toBe(502);
    const raw = await response.text();
    const payload = JSON.parse(raw) as { error?: unknown; retriable?: unknown };
    // Retriable, because FR-018's "Ponów" is driven by this flag. A 502 the island cannot
    // retry strands the user with a failure and no way forward.
    expect(payload.retriable).toBe(true);
    expect(typeof payload.error).toBe("string");

    // The no-leak claim, asserted on the RAW body rather than on `payload.error` — a leak
    // added to any other field would be just as visible to the user and to any proxy log.
    expect(raw).not.toContain(SOURCE_SENTINEL);
    expect(raw).not.toContain(UPSTREAM_SENTINEL);
    expect(raw).not.toContain(SENTINEL_KEY);

    // …and the contrast that makes the claim mean something. Without this half, a request
    // that never reached the server at all would satisfy every assertion above.
    const row = await sessionFor(HTTP_FAILURE_TEXT);
    expect(row.status).toBe("failed");
    expect(row.source_text).toContain(SOURCE_SENTINEL);
    expect(JSON.stringify(row.request_payload)).toContain(SOURCE_SENTINEL);
    expect(JSON.stringify(row.response_payload)).toContain(UPSTREAM_SENTINEL);
    // On THIS path error_message is the upstream failure's own description (openrouter.ts
    // builds it from the status), so it is asserted as present and non-empty rather than
    // pinned to a constant — that is the 422 path's contract, not this one's.
    expect(typeof row.error_message).toBe("string");
    expect(row.error_message).not.toBe("");
    expect(row.generated_count).toBe(0);
    expect(row.saved_count).toBe(0);

    // Deck creation is deferred past the LLM call on purpose (impl-review F1), so a failed
    // generation must leave no orphan behind — and "Ponów" must not collide with one.
    expect(await decksNamed(newDeckName)).toHaveLength(0);
  });

  it("502s a transport failure: `error_message` records the upstream string, the body does not", async () => {
    // The sibling of the case above, and the one that makes the no-leak claim bite on the
    // column that carries it. On the HTTP path `err.message` is openrouter.ts's own
    // "OpenRouter HTTP <status>" — a string with nothing private in it — so a body that
    // interpolated `err.message` would leak nothing and no assertion above would notice.
    // On the TRANSPORT path the upstream string IS `err.message`
    // ("OpenRouter fetch failed: <reason>"), so the same interpolation leaks, and the
    // contrast is asserted on `error_message` itself rather than on `response_payload`.
    const newDeckName = `Talia transport ${suffix}`;
    upstream = () => {
      throw new TypeError(UPSTREAM_SENTINEL);
    };

    const response = await generate({
      newDeckName,
      sourceText: TRANSPORT_FAILURE_TEXT,
      language: "auto",
      count: COUNT,
    });

    expect(response.status).toBe(502);
    const raw = await response.text();
    const payload = JSON.parse(raw) as { retriable?: unknown };
    expect(payload.retriable).toBe(true);

    expect(raw).not.toContain(SOURCE_SENTINEL);
    expect(raw).not.toContain(UPSTREAM_SENTINEL);
    expect(raw).not.toContain(SENTINEL_KEY);

    const row = await sessionFor(TRANSPORT_FAILURE_TEXT);
    expect(row.status).toBe("failed");
    expect(row.source_text).toContain(SOURCE_SENTINEL);
    expect(JSON.stringify(row.request_payload)).toContain(SOURCE_SENTINEL);
    // Both halves of the contrast, on one column: the audit keeps the upstream string…
    expect(row.error_message).toContain(UPSTREAM_SENTINEL);
    // …and the response above provably did not. Same request, opposite verdicts.
    expect(JSON.stringify(row.response_payload)).toContain(UPSTREAM_SENTINEL);
    expect(row.generated_count).toBe(0);
    expect(row.saved_count).toBe(0);

    expect(await decksNamed(newDeckName)).toHaveLength(0);
  });

  it("422s a model answer whose cards all fail validation, and still leaks nothing", async () => {
    const newDeckName = `Talia 422 ${suffix}`;
    upstream = () => new Response(invalidCardsBody(), { status: 200, headers: { "Content-Type": "application/json" } });

    const response = await generate({
      newDeckName,
      sourceText: INVALID_CARDS_TEXT,
      language: "auto",
      count: COUNT,
    });

    expect(response.status).toBe(422);
    const raw = await response.text();
    const payload = JSON.parse(raw) as { error?: unknown; retriable?: unknown };
    expect(payload.retriable).toBe(true);
    expect(typeof payload.error).toBe("string");

    expect(raw).not.toContain(SOURCE_SENTINEL);
    expect(raw).not.toContain(UPSTREAM_SENTINEL);
    expect(raw).not.toContain(SENTINEL_KEY);

    const row = await sessionFor(INVALID_CARDS_TEXT);
    expect(row.status).toBe("failed");
    expect(row.source_text).toContain(SOURCE_SENTINEL);
    expect(JSON.stringify(row.request_payload)).toContain(SOURCE_SENTINEL);
    expect(JSON.stringify(row.response_payload)).toContain(UPSTREAM_SENTINEL);
    // The one copy assertion in this file, and it is deliberate. `error_message` here is a
    // module-local literal, NOT the upstream string — that substitution IS the no-leak
    // property on this path, so asserting equality is asserting the property. (The
    // response body's Polish copy is still not asserted anywhere: it is not a contract.)
    expect(row.error_message).toBe("Model nie zwrócił poprawnych kart");
    // The pair that separates 422 from 502: the model DID answer, and nothing survived.
    expect(row.generated_count).toBeGreaterThan(0);
    expect(row.saved_count).toBe(0);

    expect(await decksNamed(newDeckName)).toHaveLength(0);
  });
});

describe("OPENROUTER_API_KEY travels in the Authorization header and lands in no audit column", () => {
  it("sends the key in the header, keeps it out of the request body and out of the row", async () => {
    const newDeckName = `Talia klucz ${suffix}`;
    upstream = () => new Response(UPSTREAM_SENTINEL, { status: 503 });

    const response = await generate({
      newDeckName,
      sourceText: KEY_PIN_TEXT,
      language: "auto",
      count: COUNT,
    });
    expect(response.status).toBe(502);

    // THE POSITIVE CONTROL, and the reason this file doubles `astro:env/server` rather than
    // `@/lib/openrouter`: this header is built by production code (openrouter.ts), so its
    // presence is evidence. Assert absence alone and "the key was correctly withheld" is
    // indistinguishable from "no request was ever issued".
    expect(captured).not.toBeNull();
    expect(captured?.authorization).toBe(`Bearer ${SENTINEL_KEY}`);

    // The request really is the one under test — the private text is in it…
    expect(captured?.body).toContain(SOURCE_SENTINEL);
    // …and the key is not. The body object openrouter.ts aliases as `rawRequest` is a
    // sibling of the headers object, never merged into it; this is what makes "the key
    // reaches no audit column" true by construction rather than by care.
    expect(captured?.body).not.toContain(SENTINEL_KEY);

    // The whole row, not a chosen column: a future column that started carrying the key
    // would be invisible to a per-column check written today.
    const row = await sessionFor(KEY_PIN_TEXT);
    expect(JSON.stringify(row)).not.toContain(SENTINEL_KEY);
    expect(row.source_text).toContain(SOURCE_SENTINEL);

    expect(await decksNamed(newDeckName)).toHaveLength(0);
  });
});
