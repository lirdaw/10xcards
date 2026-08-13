import { describe, expect, it } from "vitest";
import { classifyReplay } from "@/lib/generation-replay";

// The replay decision `/api/generate` used to make inline as `if (error || !data)` — two
// facts that mean opposite things, collapsed into one 500 (C10X-48). Extracted for the same
// reason as `readJsonResponse` and `rateOutcome` (test-plan §7): the branch it guards is not
// reachable from the endpoint without a session row that has zero cards behind it, and that
// state is only produced by a compensation that failed. Here every input is FABRICATED — no
// database, no container, no session — which is the whole point of the extraction.
//
// What this file does NOT prove: that the endpoint calls it, or what the endpoint does with
// each arm. Those are the integration cases in tests/generation/generate.test.ts.

/** The payload shape `generationResultByGenerationId` produces, fabricated. */
const result = {
  candidates: [{ front: "Pytanie", back: "Odpowiedź" }],
  deckPublicId: "8f14e45f-ceea-467a-9a5d-3c2ba9d7f6a1",
};

describe("classifyReplay", () => {
  // The positive control, and it is load-bearing rather than ceremony: without it every
  // assertion below is satisfied by a function that classifies EVERYTHING as broken, which
  // is precisely the shape the endpoint had before this module existed.
  it("classifies a session that still has cards as replayable", () => {
    expect(classifyReplay({ data: result, error: null })).toEqual({ kind: "replayable", result });
  });

  it("classifies a query failure as a failure, not as an empty session", () => {
    expect(classifyReplay({ data: null, error: { code: "PGRST301", message: "boom" } })).toEqual({
      kind: "query-failed",
    });
  });

  it("classifies a successful lookup that found no cards as empty", () => {
    expect(classifyReplay({ data: null, error: null })).toEqual({ kind: "empty" });
  });

  // ORDERING, and it is the reason this module exists rather than an inline `!data` check.
  // A failed query ALSO carries `data: null` — `generationResultByGenerationId` returns the
  // pair that way on purpose — so a classifier testing absence first would read every
  // transient outage as "this session is empty" and hand the caller evidence it never had.
  // The caller acts on `empty` by clearing a row's idempotency key and running a paid
  // generation, so absence-first would spend money on the strength of a database hiccup.
  it("puts the error ahead of the absence, since a failed query is also data-less", () => {
    expect(classifyReplay({ data: null, error: new Error("transport") })).toEqual({ kind: "query-failed" });
  });

  // The pathological pair the union's own shape forbids but an untyped caller can still
  // deliver: an error alongside a payload. It is an error — same rule, stated by a case so a
  // future refactor cannot quietly reorder the two checks and stay green.
  it("treats an error as decisive even when a payload came with it", () => {
    expect(classifyReplay({ data: result, error: { message: "boom" } })).toEqual({ kind: "query-failed" });
  });
});
