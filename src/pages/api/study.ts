import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { deckIdByPublicId } from "@/lib/flashcards";
import { rateCard, setSessionSize } from "@/lib/study";

// JSON endpoint for the study session, mirroring src/pages/api/generate.ts: a React
// island fetches it and needs a structured body back plus clean status codes. It carries
// no timeout apparatus — study is DB-only and fast, unlike the LLM generation path. All
// copy stays Polish; validation is Zod. Two actions share the route via a discriminated
// union on `action`: `rate` applies a recall rating, `setSessionSize` sets the per-deck cap.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-deck session cap bounds. The DB CHECK enforces `> 0`; the max keeps a hand-crafted
// body from requesting an absurd batch. Mirror this max in the client-side control.
const SIZE_MAX = 100;

const rateSchema = z.object({
  action: z.literal("rate"),
  deckPublicId: z.string().regex(UUID_RE),
  cardPublicId: z.string().regex(UUID_RE),
  // 1..4 = Again/Hard/Good/Easy. Rating.Manual (0) is forbidden — a rating is always a
  // graded recall. Whitelisted literals so a hand-crafted body can't inject another value.
  grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  // The optimistic-lock version the card was served with (see rateCard). A non-negative
  // integer; a stale value means the rating already landed (benign, handled below).
  expectedReps: z.number().int().min(0),
});

const setSessionSizeSchema = z.object({
  action: z.literal("setSessionSize"),
  deckPublicId: z.string().regex(UUID_RE),
  size: z.number().int().min(1).max(SIZE_MAX),
});

const bodySchema = z.discriminatedUnion("action", [rateSchema, setSessionSizeSchema]);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json(500, { error: "Supabase nie jest skonfigurowany" });
  }

  const user = context.locals.user;
  if (!user) {
    return json(401, { error: "Nie jesteś zalogowany" });
  }

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return json(400, { error: "Nieprawidłowe dane wejściowe" });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return json(400, { error: "Nieprawidłowe dane wejściowe" });
  }

  // Both actions target a deck by public_id; resolve it to the internal id first. Branch
  // on the query error before treating null as not-found, so a transient DB failure isn't
  // masked as a 404 (lessons: SSR error-vs-empty). Only a genuine null (absent or
  // RLS-hidden) is a real 404 — so we never reveal that a foreign deck exists.
  const { data: deck, error: deckError } = await deckIdByPublicId(supabase, parsed.data.deckPublicId);
  if (deckError) {
    return json(500, { error: "Nie udało się odczytać talii" });
  }
  if (!deck) {
    return json(404, { error: "Talia nie istnieje" });
  }

  if (parsed.data.action === "setSessionSize") {
    // RETURNING → maybeSingle: a 0-row result would be an RLS no-op, but the deck already
    // resolved above under the same client, so an error here is a genuine failure.
    const { data: updated, error } = await setSessionSize(supabase, parsed.data.deckPublicId, parsed.data.size);
    if (error) {
      return json(500, { error: "Nie udało się zapisać rozmiaru sesji" });
    }
    if (!updated) {
      return json(404, { error: "Talia nie istnieje" });
    }
    return json(200, { ok: true, size: updated.session_size });
  }

  // action === "rate". Server clock is authoritative — `now` is never client-supplied
  // (a client could otherwise steer its own schedule); rateCard defaults to new Date().
  const result = await rateCard(
    supabase,
    deck.id,
    parsed.data.cardPublicId,
    parsed.data.grade,
    parsed.data.expectedReps,
  );
  if (result.error) {
    return json(500, { error: "Nie udało się zapisać oceny" });
  }
  if (!result.data) {
    // No schedule row for a resolvable card in this deck → the card isn't part of a
    // session (or doesn't exist here). 404, never revealing a foreign card.
    return json(404, { error: "Karta nie istnieje" });
  }
  // alreadyApplied: the compare-and-set found the rating had already landed (double click,
  // retried submit). Return the current progress with no second transition — a benign 200.
  return json(200, { ok: true, alreadyApplied: result.alreadyApplied, progress: result.data });
};
