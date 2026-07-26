import { describe, expect, it } from "vitest";
import type { APIContext, MiddlewareNext } from "astro";
import { onRequest, PROTECTED_ROUTES } from "@/middleware";
import { accountA } from "./fixtures/accounts";

// The route guard has never had a test, and this change alters it.
//
// Two things are pinned here. First, the fix: a guard must answer in the format its caller
// expects. A JSON caller gets a 401 JSON body it can display; a page or form navigation
// keeps its redirect to /auth/signin. Before this, every signed-out caller got a 302 — which
// `fetch` follows to a public 200 text/html page, so `res.ok` was true and a lost session
// read as success (C10X-27; lessons.md "Middleware nie może odpowiadać endpointowi JSON
// redirectem").
//
// Second, the prefix-match trap that context/archive/2026-07-15-verification-harness/
// deferred to "when Phase 4's SRS routes land" and nothing revisited: PROTECTED_ROUTES is
// matched with startsWith, so a route nobody adds to the array is simply unprotected. The
// table below drives the REAL, imported array — never a copy — so adding a protected route
// automatically adds a row, and a duplicated list cannot stay green while production drifts.
//
// The Container API is deliberately not used: it mounts NOOP_MIDDLEWARE_FN and would never
// run this code (lessons.md). `onRequest` is an ordinary exported function, so a fabricated
// context is both sufficient and faithful. Signed-out rows need no database — getUser()
// with no session fails locally, without a network call.

const ORIGIN = "http://localhost:4321";
const SIGN_IN = "/auth/signin";

/** What a React island's fetch looks like: a JSON body, no document destination. */
const JSON_CALLER = { "Content-Type": "application/json" };

/** What a native <form method="POST"> looks like: urlencoded, wants a page back. */
const FORM_CALLER = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "text/html,application/xhtml+xml",
};

/** What a plain page navigation looks like. */
const PAGE_CALLER = { Accept: "text/html,application/xhtml+xml", "Sec-Fetch-Dest": "document" };

interface GuardResult {
  response: Response;
  nextCalled: boolean;
}

async function runGuard(
  path: string,
  {
    headers = {},
    method = "GET",
    cookieHeader,
  }: { headers?: Record<string, string>; method?: string; cookieHeader?: string } = {},
): Promise<GuardResult> {
  const url = new URL(path, ORIGIN);
  const requestHeaders = new Headers(headers);
  if (cookieHeader) requestHeaders.set("Cookie", cookieHeader);

  const request = new Request(url, { method, headers: requestHeaders });

  let nextCalled = false;
  const next: MiddlewareNext = () => {
    nextCalled = true;
    return Promise.resolve(new Response("downstream", { status: 200 }));
  };

  const context = {
    url,
    request,
    locals: {},
    // createClient only ever calls `set`, and only on the write path.
    cookies: { set: () => undefined },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;

  const response = await onRequest(context, next);
  return { response: response as Response, nextCalled };
}

async function errorBodyOf(response: Response): Promise<unknown> {
  const payload = (await response.json()) as { error?: unknown };
  return payload.error;
}

describe("the route guard answers in the caller's own format", () => {
  it.each(PROTECTED_ROUTES)("answers a signed-out JSON caller on %s with a 401 JSON body", async (route) => {
    const { response, nextCalled } = await runGuard(route, { method: "POST", headers: JSON_CALLER });

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(typeof (await errorBodyOf(response))).toBe("string");
    expect(nextCalled).toBe(false);
  });

  it.each(PROTECTED_ROUTES)("still redirects a signed-out page navigation on %s", async (route) => {
    const { response, nextCalled } = await runGuard(route, { headers: PAGE_CALLER });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(SIGN_IN);
    expect(nextCalled).toBe(false);
  });

  // These two rows are the whole discriminator. Six protected /api/* routes are native form
  // targets — full-page navigations, not fetches (CreateDeckModal, DeckActions,
  // CreateFlashcardModal, FlashcardItem, CandidateItem, ConfirmDeleteModal). Answering those
  // with JSON would replace a working redirect-to-sign-in with a dead-end JSON page, in
  // exactly the expired-session scenario this change exists to fix. A table that only varied
  // the PATH would enshrine that regression instead of catching it.
  const deckPath = "/api/decks/2f1c6f3e-9a3d-4c6b-8f2e-7d5a1b9c0e44";

  it("redirects a native form POST to a deck endpoint — a form is not a JSON caller", async () => {
    const { response, nextCalled } = await runGuard(deckPath, { method: "POST", headers: FORM_CALLER });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(SIGN_IN);
    expect(nextCalled).toBe(false);
  });

  it("answers the SAME deck path with a 401 when the caller sends JSON", async () => {
    const { response } = await runGuard(deckPath, { method: "POST", headers: JSON_CALLER });

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });
});

describe("the route guard's matching", () => {
  it("protects /api/study through its own entry, not through /study", () => {
    // startsWith matching: "/api/study" does NOT begin with "/study", so that separate array
    // entry is load-bearing. Deleting it in the belief that /study covers it would silently
    // unprotect the endpoint.
    const matching = PROTECTED_ROUTES.filter((route) => "/api/study".startsWith(route));

    expect(matching).toEqual(["/api/study"]);
    expect("/api/study".startsWith("/study")).toBe(false);
  });

  it.each(["/auth/signin", "/api/auth/signin", "/"])("lets a public path through: %s", async (path) => {
    const { response, nextCalled } = await runGuard(path, { headers: PAGE_CALLER });

    expect(nextCalled).toBe(true);
    expect(response.status).toBe(200);
  });

  // The positive control. Without it a wholesale-broken guard — one that denied everything,
  // or one whose session read never worked — would read as perfect protection.
  it("lets a signed-in caller through to the route", async () => {
    const a = accountA();
    const { response, nextCalled } = await runGuard("/api/study", {
      method: "POST",
      headers: JSON_CALLER,
      cookieHeader: a.cookieHeader,
    });

    expect(nextCalled).toBe(true);
    expect(response.status).toBe(200);
  });
});
