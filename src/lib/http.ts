// The one place a React island decides "did this request succeed".
//
// Every island used to re-make that decision by hand, and one of them got the ordering
// wrong: StudySession.rate() branched on `!res.ok` alone. A signed-out POST /api/study was
// answered by middleware with a 302 to /auth/signin, `fetch` followed it (POST -> GET, body
// dropped), the public sign-in page rendered 200 text/html — and `res.ok` was true. Ratings
// were silently discarded while the UI reported progress (C10X-27; lessons.md "Middleware
// nie może odpowiadać endpointowi JSON redirectem").
//
// So the rule is encoded here rather than repeated: parse the body BEFORE looking at `ok`,
// and treat a followed redirect and a non-JSON body as failures in their own right. The
// middleware now answers JSON callers with a real 401, which is the primary fix; this is the
// client-side half that keeps a future shell change from re-opening the same hole.

/** Shown whenever the response says the caller is no longer signed in. */
export const SESSION_EXPIRED_MESSAGE = "Twoja sesja wygasła. Zaloguj się ponownie.";

/**
 * `status` is always the response's OWN status, and `parsed` says whether a JSON body came
 * with it. Two fields rather than one because a caller needs both halves: the skip
 * affordance in @/lib/study-session must fire on a genuine 404 and must NOT fire on an HTML
 * error page that merely happens to carry one.
 *
 * This started life as a single `status`, with 0 standing in for "unparseable". That
 * collapsed the two facts into one and lost the real status — so a 404 served behind a
 * proxy's HTML error page (or a 204, which `res.json()` also rejects on) read as "retry in
 * place" and left the user stuck on a card that can never be rated: exactly the state the
 * skip affordance exists to end. Widened by impl-review F7.
 */
export type JsonResult<T> = { ok: true; data: T } | { ok: false; message: string; status: number; parsed: boolean };

function errorMessageOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { error } = body as { error?: unknown };
  return typeof error === "string" && error.length > 0 ? error : null;
}

export async function readJsonResponse<T>(res: Response, fallback: string): Promise<JsonResult<T>> {
  // Parse first — this ordering IS the fix. `res.json()` rejects on an HTML body, which is
  // exactly what a followed sign-in redirect delivers.
  let body: unknown;
  let parsed = false;
  try {
    body = await res.json();
    parsed = true;
  } catch {
    parsed = false;
  }

  // A 401 or a redirect the client followed both mean the same thing to the user: the
  // session is gone. Say so, rather than passing on the endpoint's terser copy.
  if (res.status === 401 || res.redirected) {
    return { ok: false, message: SESSION_EXPIRED_MESSAGE, status: res.status, parsed };
  }

  if (!parsed) {
    return { ok: false, message: fallback, status: res.status, parsed: false };
  }

  if (!res.ok) {
    return { ok: false, message: errorMessageOf(body) ?? fallback, status: res.status, parsed: true };
  }

  return { ok: true, data: body as T };
}
