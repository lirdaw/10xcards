/**
 * The decision half of `retry-transport.ts`, extracted so it can be asserted.
 *
 * WHY IT LIVES IN ITS OWN MODULE. `retry-transport.ts` is a `setupFiles` entry: importing it
 * from a test would mean importing its side effect (it reassigns `globalThis.fetch` on
 * evaluation), so nothing in the suite could reach its predicate. That predicate is the one
 * thing in this change with veto power over a failing response — widen it and the suite goes
 * quiet, not red — so it is exactly the wrong thing to leave untestable by construction. The
 * precedent is C10X-27's `readJsonResponse`, pulled out of `StudySession.tsx` for the same
 * reason (test-plan §7): the decision becomes falsifiable while the wiring around it stays
 * unreachable. Covered by `tests/lib/retry-transport.test.ts`.
 *
 * Everything here is pure — no I/O, no globals, no `Response` — so a case is a table row.
 * Read the header of `retry-transport.ts` for WHY each condition is in the conjunction; this
 * file only states WHAT it is.
 */

/** Kong's wording for "the upstream closed the connection before answering". */
export const KONG_UPSTREAM_FAILURE = "An invalid response was received from the upstream server";

/** One original attempt plus at most two replays. */
export const MAX_ATTEMPTS = 3;

/** Long enough for Kong to open a fresh upstream socket, short enough to be invisible. */
export const BACKOFF_MS = 25;

/** The only status this wrapper will ever replay. Every other one is a signal something asserts on. */
export const RETRYABLE_STATUS = 502;

/**
 * Is this the local Supabase stack?
 *
 * Hostname equality, never a substring test: `localhost.evil.example` contains "localhost"
 * and is not this stack.
 */
export function isLocalStack(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    // A relative or malformed URL is not the local stack as far as this wrapper is concerned.
    return false;
  }
}

/**
 * Can this request be re-sent verbatim?
 *
 * About the BODY, not about idempotency — the wrapper deliberately replays POSTs, which is
 * the shape the measured flake took (`POST /rest/v1/deck`). See `retry-transport.ts`'s header
 * for why that is safe here and where the residual risk is not loud.
 */
export function isReplayableRequest(input: RequestInfo | URL, init: RequestInit | undefined): boolean {
  // A `Request` body is a one-shot stream: reading it to replay it would consume the copy
  // the caller still holds.
  if (input instanceof Request) return false;
  const body = init?.body;
  return body === undefined || body === null || typeof body === "string";
}

/**
 * Is this response Kong's keep-alive drop, as opposed to anything the suite asserts on?
 *
 * Both halves are required. A `502` alone is not enough (an endpoint could answer one), and
 * the wording alone is not enough (it could appear in a payload under some other status).
 */
export function isKongKeepAliveDrop(status: number, bodyText: string): boolean {
  return status === RETRYABLE_STATUS && bodyText.includes(KONG_UPSTREAM_FAILURE);
}
