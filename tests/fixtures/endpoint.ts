import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { App } from "astro/app";
import type { APIRoute } from "astro";
import type { User } from "@supabase/supabase-js";
import type { TestAccount } from "./accounts";

// Drives a real API route as a given account, so tests read as intent rather than
// Container plumbing.
//
// Two things about this layer are worth knowing before changing it:
//
// 1. The Container API does NOT run project middleware. Source-verified in astro@6.3.1:
//    dist/container/index.js calls createManifest(manifest, renderers) with the third
//    (middleware) argument undefined, so NOOP_MIDDLEWARE_FN runs. That is why locals.user
//    is injected here rather than derived. This is faithful, not a shortcut: middleware
//    only ever answers "is someone signed in?" — it is resource-blind by construction, so
//    injecting locals.user while sending that account's real cookie is a literal encoding
//    of the assumption under test, "authenticated implies authorized".
//
// 2. The session is real all the way down. Every endpoint builds its own client via
//    createClient(context.request.headers, context.cookies), which reads the session out
//    of the Cookie header — so the real cookie -> JWT -> RLS -> Postgres chain runs. Only
//    locals.user is fabricated.
//
// 3. A cookie an endpoint WRITES does not appear as a Set-Cookie header here. Astro carries
//    context.cookies on the response under Symbol.for("astro.cookies") and only the app/adapter
//    layer materialises them into real headers (dist/core/app/prepare-response.js) — and the
//    Container runs neither. Measured, not assumed: for a route whose signOut() stages
//    `sb-127-auth-token=; Max-Age=0; Path=/; SameSite=Lax`, response.headers.getSetCookie()
//    is [] while the carried cookies hold exactly that. Read them with stagedCookies() below.

/** A namespace-imported endpoint module: `import * as Endpoint from "@/pages/api/..."`. */
export type EndpointModule = Partial<Record<"GET" | "POST", APIRoute>>;

type RenderableComponent = Parameters<AstroContainer["renderToResponse"]>[0];

// Any absolute origin works; the container never makes a network call out of it.
const ORIGIN = "http://localhost:4321";

export interface CallOptions {
  /** Path with the dynamic segments already filled in, e.g. `/api/decks/<publicId>`. */
  url: string;
  method?: "GET" | "POST";
  /** Route params, e.g. `{ publicId }` for `src/pages/api/decks/[publicId].ts`. */
  params?: Record<string, string | undefined>;
  /**
   * Most endpoints read formData (AGENTS.md convention). `/api/generate` is the
   * deliberate exception — it is a JSON endpoint because a React island fetches it and
   * needs a structured body back (see `src/pages/api/generate.ts:10-14`), so this accepts
   * any `BodyInit`. Pass a JSON string and `Content-Type: application/json` is set for
   * you; pass anything else and it is not, so each body type keeps the header `Request`
   * derives for it (FormData its multipart boundary, and so on).
   */
  body?: BodyInit;
  /**
   * Header overrides, merged last so they win over the Content-Type derived above.
   *
   * Exists for one narrow job: constructing a body that CLAIMS to be a form and is not
   * parseable as one, which is the only way to reach the "a form arrived broken" branch of
   * the endpoints' formData() guard (a real client abort or transport reset cannot be staged
   * here). Do NOT reach for this to hand-set a Cookie — session cookies are captured through
   * `setAll`, never assembled by hand (lessons.md).
   */
  headers?: Record<string, string>;
  as: TestAccount;
}

/**
 * Calls an endpoint with an account's real session and returns the raw Response.
 *
 * Redirects are NOT followed — these endpoints answer success with a 302, so tests assert
 * on `status` + the `Location` header. Assertions stay in the tests.
 */
export async function callEndpoint(
  endpoint: EndpointModule,
  { url, method = "POST", params = {}, body, headers: headerOverrides, as }: CallOptions,
): Promise<Response> {
  const container = await AstroContainer.create();

  // Content-Type is set only for a string body — the JSON case, and the only one this
  // fixture can label correctly. Every other BodyInit already derives its own header
  // (FormData its multipart boundary, URLSearchParams x-www-form-urlencoded), and
  // overwriting that would surface as a baffling 400/500 from request.formData() rather
  // than as the wiring error it is.
  const headers: Record<string, string> = { Cookie: as.cookieHeader };
  if (typeof body === "string") {
    headers["Content-Type"] = "application/json";
  }

  const request = new Request(new URL(url, ORIGIN), {
    method,
    headers: { ...headers, ...headerOverrides },
    body,
  });

  // `satisfies Pick<App.Locals, "user">` keeps `user` type-checked against the real Locals;
  // the cast below covers only what the container cannot supply. @astrojs/cloudflare augments
  // App.Locals with a REQUIRED `cfContext: ExecutionContext` (Astro 6 removed
  // locals.runtime.ctx in its favour), but the Container API runs in Node, not workerd — there
  // is no ExecutionContext to hand it, and no endpoint under test reads one.
  const locals = { user: { id: as.userId } as unknown as User } satisfies Pick<App.Locals, "user">;

  return container.renderToResponse(endpoint as unknown as RenderableComponent, {
    routeType: "endpoint",
    request,
    params,
    locals: locals as App.Locals,
  });
}

/**
 * The Set-Cookie strings an endpoint staged on its response — see note 3 above for why
 * `response.headers.getSetCookie()` cannot answer this under the Container API.
 *
 * `App.getSetCookieFromResponse` is Astro's own public accessor for exactly this (its JSDoc at
 * `dist/core/app/base.d.ts:162` demonstrates this call), which is why the symbol is not read by
 * hand: the carrier is internal and would drift silently, and a test that read `undefined` off a
 * renamed symbol would report "no cookie staged" — indistinguishable from the defect.
 *
 * DESTRUCTIVE: the underlying `consume()` drains the carried cookies, so a second call returns
 * nothing. Call it once and assert on the result.
 */
export function stagedCookies(response: Response): string[] {
  return [...App.getSetCookieFromResponse(response)];
}
