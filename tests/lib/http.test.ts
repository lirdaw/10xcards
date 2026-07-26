import { describe, expect, it } from "vitest";
import { readJsonResponse, SESSION_EXPIRED_MESSAGE } from "@/lib/http";

// The response-handling decision every React island re-made by hand, extracted so it can
// be tested at all (vitest.config.ts runs `environment: "node"` — there is no DOM layer in
// this suite, so the JSX around it stays unreachable; test-plan §7).
//
// The defect this pins (C10X-27): middleware answered a signed-out POST /api/study with a
// 302 to /auth/signin, `fetch` followed it, the public sign-in page rendered 200 text/html,
// and `res.ok` was TRUE. StudySession.rate() branched on `!res.ok` alone, so a lost session
// read as a successful rating — the card advanced, the counter climbed, nothing was written.
// Hence: parse BEFORE checking ok, and treat a followed redirect and an unparseable body as
// failures in their own right.

const FALLBACK = "Nie udało się zapisać oceny. Spróbuj ponownie.";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** What a followed 302 -> /auth/signin actually delivers to fetch: 200, text/html, ok. */
function signInPageResponse(): Response {
  return new Response('<!doctype html><html lang="pl"><body>Zaloguj się</body></html>', {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

/** `redirected` is a read-only getter; a hand-built Response can only carry it this way. */
function asRedirected(response: Response): Response {
  Object.defineProperty(response, "redirected", { value: true });
  return response;
}

describe("readJsonResponse", () => {
  it("returns the parsed body on a JSON success", async () => {
    const result = await readJsonResponse<{ ok: boolean; alreadyApplied: boolean }>(
      jsonResponse(200, { ok: true, alreadyApplied: false }),
      FALLBACK,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual({ ok: true, alreadyApplied: false });
  });

  it("surfaces the server's own error copy on a 4xx/5xx JSON body, with its status", async () => {
    const result = await readJsonResponse(jsonResponse(500, { error: "Nie udało się odczytać talii" }), FALLBACK);

    expect(result).toEqual({ ok: false, message: "Nie udało się odczytać talii", status: 500, parsed: true });
  });

  it("keeps a 404 distinguishable by status, so a caller can offer a skip", async () => {
    const result = await readJsonResponse(jsonResponse(404, { error: "Karta nie istnieje" }), FALLBACK);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe(404);
  });

  it("maps a 401 to the session-lost message, not to the generic one", async () => {
    const result = await readJsonResponse(jsonResponse(401, { error: "Nie jesteś zalogowany" }), FALLBACK);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toBe(SESSION_EXPIRED_MESSAGE);
    expect(result.message).not.toBe(FALLBACK);
    expect(result.status).toBe(401);
  });

  // The defect's exact shape. `ok` is true and the status is 200 — everything an
  // `!res.ok` check looks at says success. Only the body gives it away.
  it("fails on a 200 text/html body — the shape a followed sign-in redirect produces", async () => {
    const result = await readJsonResponse(signInPageResponse(), FALLBACK);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toBe(FALLBACK);
    // The status is reported truthfully — it really was a 200. `parsed: false` is what keeps
    // it apart from an API answer (see the skip affordance in @/lib/study-session).
    expect(result.status).toBe(200);
    expect(result.parsed).toBe(false);
  });

  it("fails on a followed redirect even when the body parses as JSON", async () => {
    const result = await readJsonResponse(asRedirected(jsonResponse(200, { ok: true })), FALLBACK);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("falls back instead of throwing when the body is not JSON at all", async () => {
    const result = await readJsonResponse(new Response("not json", { status: 502 }), FALLBACK);

    expect(result).toEqual({ ok: false, message: FALLBACK, status: 502, parsed: false });
  });

  // The two facts are independent, so a caller can act on either. Losing the real status was
  // what made a 404 behind an HTML error page indistinguishable from "not an HTTP failure"
  // (impl-review F7).
  it("keeps the real status on an unparseable 404, and marks it unparsed", async () => {
    const result = await readJsonResponse(new Response("<html>Not Found</html>", { status: 404 }), FALLBACK);

    expect(result).toEqual({ ok: false, message: FALLBACK, status: 404, parsed: false });
  });
});
