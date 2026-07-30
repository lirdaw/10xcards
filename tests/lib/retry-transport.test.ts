import { describe, expect, it } from "vitest";
// The subject is test infrastructure under tests/setup/, not src/ — the same exception
// tests/lib/schema-drift.test.ts and tests/lib/eval-scoring.test.ts already carry
// (test-plan §6.1): a pure-function file belongs beside the suite's other pure-function
// files, imported relatively.
//
// WHY THIS FILE EXISTS (impl-review F2, C10X-32). `tests/setup/retry-transport.ts` swallows
// a response class on every request in the suite. A guard with veto power over failures has
// to be falsifiable: without these cases, widening the predicate — dropping the body check,
// dropping the locality gate, adding a status — makes the suite QUIETER, and nothing goes
// red to say so. The wrapper's own wiring (that it is installed, that it re-issues the
// request) stays unreachable from here, exactly as C10X-27's readJsonResponse extraction
// left StudySession's wiring unreachable; what is covered is the decision.
import {
  BACKOFF_MS,
  isKongKeepAliveDrop,
  isLocalStack,
  isReplayableRequest,
  KONG_UPSTREAM_FAILURE,
  MAX_ATTEMPTS,
  RETRYABLE_STATUS,
} from "../setup/retry-policy";

/** Kong's real 502 body, as observed in the access log on 2026-07-30. */
const KONG_502_BODY = `{"message":"${KONG_UPSTREAM_FAILURE}"}`;

/** A PostgREST error body — a real signal, and the closest thing to a false positive. */
const POSTGREST_ERROR_BODY = `{"code":"23505","message":"duplicate key value violates unique constraint"}`;

const LOCAL = "http://127.0.0.1:54321/rest/v1/deck?select=id";

describe("retry policy — what is replayed", () => {
  it("accepts the one class it exists for: Kong's 502 from the local stack with a string body", () => {
    // The positive control. Without it, every refusal below is satisfied by a predicate
    // that returns false unconditionally — i.e. by a wrapper that never retries anything.
    expect(isLocalStack(LOCAL)).toBe(true);
    expect(isReplayableRequest(LOCAL, { method: "POST", body: JSON.stringify({ name: "x" }) })).toBe(true);
    expect(isKongKeepAliveDrop(502, KONG_502_BODY)).toBe(true);
  });

  it("refuses every other status, including ones that carry Kong's wording", () => {
    // The wording is not sufficient on its own: a payload could contain it under any status.
    for (const status of [200, 400, 404, 409, 500, 503, 504]) {
      expect(isKongKeepAliveDrop(status, KONG_502_BODY)).toBe(false);
    }
    expect(RETRYABLE_STATUS).toBe(502);
  });

  it("refuses a 502 whose body is a real error rather than Kong's drop", () => {
    // The status is not sufficient on its own either — this is the half that keeps a
    // genuine upstream failure visible.
    expect(isKongKeepAliveDrop(502, POSTGREST_ERROR_BODY)).toBe(false);
    expect(isKongKeepAliveDrop(502, "")).toBe(false);
  });

  it("refuses any host that is not the local stack", () => {
    expect(isLocalStack("https://openrouter.ai/api/v1/chat/completions")).toBe(false);
    expect(isLocalStack("https://project.supabase.co/rest/v1/deck")).toBe(false);
    // Hostname equality, not a substring test — both of these CONTAIN "localhost".
    expect(isLocalStack("http://localhost.evil.example/rest/v1/deck")).toBe(false);
    expect(isLocalStack("http://evil-localhost/rest/v1/deck")).toBe(false);
    // ...and the two spellings that are the stack.
    expect(isLocalStack("http://localhost:54321/rest/v1/deck")).toBe(true);
    expect(isLocalStack("http://127.0.0.1:54321/auth/v1/token")).toBe(true);
  });

  it("treats a relative or malformed URL as not-the-local-stack rather than throwing", () => {
    expect(isLocalStack("/api/decks")).toBe(false);
    expect(isLocalStack("")).toBe(false);
    expect(isLocalStack("http://")).toBe(false);
  });

  it("refuses a body it cannot re-send verbatim", () => {
    // A `Request` carries a one-shot stream: replaying it would consume the caller's copy.
    expect(isReplayableRequest(new Request(LOCAL, { method: "POST", body: "{}" }), undefined)).toBe(false);
    expect(isReplayableRequest(LOCAL, { method: "POST", body: new FormData() })).toBe(false);
    expect(isReplayableRequest(LOCAL, { method: "POST", body: new URLSearchParams({ a: "1" }) })).toBe(false);
    expect(isReplayableRequest(LOCAL, { method: "POST", body: new Blob(["{}"]) })).toBe(false);
  });

  it("accepts a string body, an absent body, and a URL instance as input", () => {
    expect(isReplayableRequest(LOCAL, undefined)).toBe(true);
    expect(isReplayableRequest(LOCAL, { method: "GET" })).toBe(true);
    expect(isReplayableRequest(LOCAL, { method: "DELETE", body: null })).toBe(true);
    expect(isReplayableRequest(new URL(LOCAL), { method: "POST", body: "{}" })).toBe(true);
  });

  it("stays bounded: two replays at most, with a backoff that cannot dominate a run", () => {
    // MAX_ATTEMPTS counts the ORIGINAL attempt, so the loop `attempt = 1; attempt < 3`
    // re-issues twice. If someone raises this, the worst-case added latency per call is
    // the sum below — keep it invisible.
    expect(MAX_ATTEMPTS).toBe(3);
    const replays = MAX_ATTEMPTS - 1;
    const worstCaseMs = Array.from({ length: replays }, (_, i) => BACKOFF_MS * (i + 1)).reduce((a, b) => a + b, 0);
    expect(replays).toBe(2);
    expect(worstCaseMs).toBeLessThanOrEqual(100);
  });
});
