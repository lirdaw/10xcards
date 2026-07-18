import { experimental_AstroContainer as AstroContainer } from "astro/container";
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
   * you; pass `FormData` and it is not, so the multipart boundary stays derived.
   */
  body?: BodyInit;
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
  { url, method = "POST", params = {}, body, as }: CallOptions,
): Promise<Response> {
  const container = await AstroContainer.create();

  // Content-Type is set only for non-FormData bodies: `Request` must be left to derive
  // the multipart boundary itself, so setting it unconditionally would break every
  // form-POST test.
  const headers: Record<string, string> = { Cookie: as.cookieHeader };
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const request = new Request(new URL(url, ORIGIN), {
    method,
    headers,
    body,
  });

  return container.renderToResponse(endpoint as unknown as RenderableComponent, {
    routeType: "endpoint",
    request,
    params,
    locals: { user: { id: as.userId } as unknown as User },
  });
}
