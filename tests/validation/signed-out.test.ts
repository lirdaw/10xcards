import { experimental_AstroContainer as AstroContainer } from "astro/container";
import type { User } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import * as CreateDeck from "@/pages/api/decks/index";
import * as RenameDeck from "@/pages/api/decks/[publicId]";
import * as DeleteDeck from "@/pages/api/decks/[publicId]/delete";
import * as CreateCard from "@/pages/api/decks/[publicId]/cards/index";
import * as EditCard from "@/pages/api/decks/[publicId]/cards/[cardPublicId]";
import * as DeleteCard from "@/pages/api/decks/[publicId]/cards/[cardPublicId]/delete";
import type { EndpointModule } from "../fixtures/endpoint";
import { errorParam } from "../fixtures/redirect-cases";

// The six redirect-style endpoints answer a SIGNED-OUT caller themselves — a gap test-plan §6.6
// has carried openly since C10X-27 ("the six redirect-style deck endpoints have no signed-out
// test of their own"). The middleware covers them as a CLASS (`tests/middleware.test.ts`), which
// is a different claim: it says the guard in front of them fires, not that each handler's own
// `!context.locals.user` branch exists and answers correctly. Defence in depth is only depth if
// the second layer is observed.
//
// WHY ALL SIX rather than the two this ticket names. C10X-37 exists because C10X-30 swept four of
// six `formData()` readers and the enumeration in its plan said "all four". A partial sweep left
// unstated is precisely the shape that created this ticket, so the class is closed here as a
// class. `cards/batch.ts` is deliberately absent: it is a JSON endpoint, answers a 401 rather
// than a redirect, and is already covered by the middleware file.
//
// NAMED AFTER THE CONCERN, NOT THE RESOURCE, which bends §6.2's one-file-per-resource rule on
// purpose: the claim spans decks and flashcards and is about a class of ROUTES, exactly as
// `tests/middleware.test.ts` already is. Splitting it across `isolation/decks.test.ts` and
// `isolation/flashcards.test.ts` would hide the one property worth reading — that the set is
// complete.
//
// NO DATABASE. Every row returns before its first query, so this file starts no fixture, creates
// no deck and provisions no account. (Preflight still runs — it is a `globalSetup` — so the local
// stack must be up, as §6.1 records for the other DB-free files.)
//
// TWO PRECONDITIONS, and a row that ignores either measures a different branch while still
// looking like a signed-out case:
//
//   - `UUID_RE` runs FIRST on five of the six, so `params` must carry well-formed UUIDs or the
//     case measures the 404 instead. The ids below are syntactically valid and match nothing —
//     which is safe precisely because no row ever reaches a query.
//   - `!supabase` is checked BEFORE `!user` on four of the six, so a row measures the branch it
//     names only while `SUPABASE_URL`/`SUPABASE_KEY` are set. Preflight guarantees that
//     (`tests/setup/preflight.ts` aborts the run otherwise), so it is a standing condition rather
//     than something this file must arrange.

/** Syntactically valid, deliberately matching nothing — no row here reaches a query. */
const DECK_PUBLIC_ID = "00000000-0000-4000-8000-000000000001";
const CARD_PUBLIC_ID = "00000000-0000-4000-8000-000000000002";

const SIGN_IN = "/auth/signin";

// Spelled out rather than imported from `@/lib/redirect-errors`, the discipline
// `tests/validation/decks.test.ts` records: importing the constant makes the assertion agree with
// itself, and a "tidied" message is exactly the silent failure the closed set can suffer.
const DECK_CREATE_FAILED = "Nie udało się utworzyć talii";
const DECK_RENAME_FAILED = "Nie udało się zmienić nazwy talii";
const CARD_CREATE_FAILED = "Nie udało się utworzyć fiszki";

interface Row {
  name: string;
  endpoint: EndpointModule;
  url: string;
  params: Record<string, string>;
  /**
   * Only `cards/[cardPublicId].ts` needs one, and it is a PRECONDITION of the case rather than
   * incidental setup — see the note on that row. Do not tidy the six rows into one uniform shape.
   */
  body?: BodyInit;
  /**
   * The owned message this endpoint answers with when the SAME request carries a user — the
   * positive control. Present only where the next branch after the user check is reachable
   * without a query; see the control's own comment for the three where it is not.
   */
  signedInError?: string;
}

function editForm(): FormData {
  const body = new FormData();
  body.set("front", "przód");
  body.set("back", "tył");
  return body;
}

const ROWS: Row[] = [
  {
    name: "POST /api/decks",
    endpoint: CreateDeck,
    url: "/api/decks",
    params: {},
    signedInError: DECK_CREATE_FAILED,
  },
  {
    name: "POST /api/decks/[publicId]",
    endpoint: RenameDeck,
    url: `/api/decks/${DECK_PUBLIC_ID}`,
    params: { publicId: DECK_PUBLIC_ID },
    signedInError: DECK_RENAME_FAILED,
  },
  {
    name: "POST /api/decks/[publicId]/delete",
    endpoint: DeleteDeck,
    url: `/api/decks/${DECK_PUBLIC_ID}/delete`,
    params: { publicId: DECK_PUBLIC_ID },
  },
  {
    name: "POST /api/decks/[publicId]/cards",
    endpoint: CreateCard,
    url: `/api/decks/${DECK_PUBLIC_ID}/cards`,
    params: { publicId: DECK_PUBLIC_ID },
    signedInError: CARD_CREATE_FAILED,
  },
  {
    // THE BODY IS THE PRECONDITION, not setup. This endpoint reads `formData()` at :48, BEFORE
    // its `!context.locals.user` check at :71 — the only one of the six in that order, and its
    // own comment at :36-39 records it as "an ordering nobody chose". With no body (or with the
    // string body `callEndpoint` labels `application/json`) the catch at :49 answers
    // `/decks/<id>?error=…&edit=<id>` and this row goes red for a reason that has nothing to do
    // with authentication.
    name: "POST /api/decks/[publicId]/cards/[cardPublicId]",
    endpoint: EditCard,
    url: `/api/decks/${DECK_PUBLIC_ID}/cards/${CARD_PUBLIC_ID}`,
    params: { publicId: DECK_PUBLIC_ID, cardPublicId: CARD_PUBLIC_ID },
    // Measured rather than argued: drop this body and exactly this row goes red, 1 of 9, on
    // `expected '/decks/…?error=Nie%20uda%C5%82o%20si%C4%99%20zapisa%C4%87%20zmian&edit=…' to be
    // '/auth/signin'` — every other row stays green.
    body: editForm(),
  },
  {
    name: "POST /api/decks/[publicId]/cards/[cardPublicId]/delete",
    endpoint: DeleteCard,
    url: `/api/decks/${DECK_PUBLIC_ID}/cards/${CARD_PUBLIC_ID}/delete`,
    params: { publicId: DECK_PUBLIC_ID, cardPublicId: CARD_PUBLIC_ID },
  },
];

/**
 * Renders one endpoint with NO session cookie and the given `locals.user`.
 *
 * `callEndpoint` always injects a user (`tests/fixtures/endpoint.ts:93`), so the signed-out
 * branch is unreachable through it — test-plan §6.6 records that gap. This drives the container
 * directly instead of widening the shared fixture, mirroring `studySignedOut` in
 * `tests/study/study.test.ts` and `generateSignedOut` in `tests/generation/generate.test.ts`.
 *
 * `App.Locals` also carries `cfContext`, injected by the Cloudflare adapter at runtime. The
 * container runs in Node with no Workers runtime to supply it and none of these routes reads one,
 * so only `user` is modelled — the same shortcut the shared fixture takes.
 */
async function render(row: Row, user: User | null): Promise<Response> {
  const container = await AstroContainer.create();
  return container.renderToResponse(row.endpoint as unknown as Parameters<AstroContainer["renderToResponse"]>[0], {
    routeType: "endpoint",
    request: new Request(new URL(row.url, "http://localhost:4321"), { method: "POST", body: row.body }),
    params: row.params,
    locals: { user } as App.Locals,
  });
}

describe("the six redirect-style endpoints answer a signed-out caller themselves", () => {
  it.each(ROWS)("$name redirects to the sign-in page", async (row) => {
    const response = await render(row, null);

    expect(response.status).toBe(302);
    // EQUALITY on the whole `Location`, not a prefix or a `toContain`: every other branch of
    // these handlers redirects to a `/decks…?error=…` URL, so "it redirected somewhere" is
    // satisfied by the failure modes this case exists to tell apart (§6.10).
    expect(response.headers.get("Location")).toBe(SIGN_IN);
  });

  // POSITIVE CONTROL, and it is what stops every row above from being satisfied by a handler that
  // answers `/auth/signin` unconditionally — or by a container that silently dropped `locals`.
  // The SAME request, the only difference being a user on `locals`, must reach a different branch.
  //
  // Three of the six carry no row here, and the reason is worth stating rather than leaving to be
  // inferred from the count. On both delete endpoints the branch after the user check is a query,
  // so a control for them would need the database this file deliberately does not touch. On
  // `cards/[cardPublicId].ts` the reachable-without-a-query branch (its `formData()` catch) runs
  // BEFORE the user check, so a control routed through it would prove nothing about the gate.
  // Three controls over three endpoints is what can be had for free; the other three rows rest on
  // the equality above plus these three.
  const controls = ROWS.filter((row): row is Row & { signedInError: string } => row.signedInError !== undefined);

  it.each(controls)("$name reaches its own error branch once a user is present", async (row) => {
    // A fabricated user, never an account: these three return at their `formData()` catch, which
    // is the branch immediately after the user check, so nothing here reaches RLS or a query. The
    // control's whole job is to show the response DIFFERS when `locals.user` is set.
    const response = await render(row, { id: "00000000-0000-4000-8000-00000000000a" } as unknown as User);

    expect(response.status).toBe(302);
    const location = response.headers.get("Location");
    expect(location).not.toBe(SIGN_IN);
    // Asserted by equality on the decoded param, not merely "not sign-in": the endpoint must be
    // shown to have got PAST the user gate into its own owned copy, and only one branch produces
    // this string.
    expect(errorParam(location)).toBe(row.signedInError);
  });
});
