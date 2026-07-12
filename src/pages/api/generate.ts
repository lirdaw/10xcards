import type { APIRoute } from "astro";
import { z } from "zod";
import type { Json } from "@/db/database.types";
import { createClient } from "@/lib/supabase";
import { createDeck } from "@/lib/decks";
import { deckIdByPublicId } from "@/lib/flashcards";
import { generateCandidates, resolveModel, OpenRouterError } from "@/lib/openrouter";
import { createGenerationSession, insertCandidates } from "@/lib/generations";

// FIRST JSON endpoint in the project — a deliberate departure from the native
// form-POST + redirect(?error=) convention of every other endpoint. The AI generator
// is a React island that `fetch`es this route and needs a structured body back
// (candidates + counts) plus retriable error codes to drive the "Ponów" button
// (FR-018). All copy stays Polish; validation is Zod (mirrors the LLM layer).

const SOURCE_MAX = 10_000;
const COUNT_MIN = 1;
const COUNT_MAX = 15;

// Server-side OpenRouter timeout. MUST be clearly shorter than the client's fetch
// timeout (~55s) so the server almost always answers first — otherwise the client
// aborts, sees "timeout + Ponów", while the server finishes and saves a succeeded
// session + cards, and the retry doubles them. Candidates land as `generated` (not
// `accepted`), so orphaned duplicates don't pollute study — but the mismatch is known.
const SERVER_TIMEOUT_MS = 40_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Exactly one of deckPublicId / newDeckName — either target an existing deck or
// create one inline. sourceText/count bounds mirror FR-003 and the plan.
const bodySchema = z
  .object({
    deckPublicId: z.string().regex(UUID_RE).optional(),
    newDeckName: z.string().trim().min(1).max(100).optional(),
    sourceText: z.string().min(1).max(SOURCE_MAX),
    language: z.string().min(1).max(40),
    count: z.number().int().min(COUNT_MIN).max(COUNT_MAX),
  })
  .refine((d) => Boolean(d.deckPublicId) !== Boolean(d.newDeckName), {
    message: "Podaj dokładnie jedną z: istniejąca talia albo nowa talia",
  });

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
  const { deckPublicId, newDeckName, language, count } = parsed.data;
  const sourceText = parsed.data.sourceText.trim();
  if (sourceText.length < 1) {
    return json(400, { error: "Tekst źródłowy jest pusty" });
  }

  // --- Resolve the target deck to its internal bigint id (+ public_id for the reply) ---
  let deckId: number;
  let deckPublicIdOut: string;
  if (newDeckName) {
    const { data: deck, error } = await createDeck(supabase, user.id, newDeckName);
    if (error) {
      // 23505 = unique_violation on (user_id, name): the name is taken.
      const taken = error.code === "23505";
      return json(taken ? 409 : 500, {
        error: taken ? "Talia o tej nazwie już istnieje" : "Nie udało się utworzyć talii",
      });
    }
    deckId = deck.id;
    deckPublicIdOut = deck.public_id;
  } else if (deckPublicId) {
    // Branch on the query error first so a transient DB failure isn't masked as a
    // 404 (lessons: SSR error-vs-empty). Only a genuine null (absent or RLS-hidden)
    // is a real not-found — so we never reveal that a foreign deck exists.
    const { data: deck, error } = await deckIdByPublicId(supabase, deckPublicId);
    if (error) {
      return json(500, { error: "Nie udało się odczytać talii" });
    }
    if (!deck) {
      return json(404, { error: "Talia nie istnieje" });
    }
    deckId = deck.id;
    deckPublicIdOut = deckPublicId;
  } else {
    // Unreachable: the schema's refine guarantees exactly one of the two.
    return json(400, { error: "Nieprawidłowe dane wejściowe" });
  }

  // --- Call OpenRouter with a server-side timeout (setTimeout + AbortController;
  // NOT AbortSignal.timeout, which nodejs_compat may not cover) ---
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, SERVER_TIMEOUT_MS);
  let result;
  try {
    result = await generateCandidates({ sourceText, language, count, signal: controller.signal });
  } catch (err) {
    // Transport failure or timeout. Persist a FAILED session (audit + error_message)
    // so a flaky call is recoverable and observable; no cards inserted. Return a
    // retriable code so the island shows "Ponów" (FR-018).
    const rawRequest = err instanceof OpenRouterError ? err.rawRequest : null;
    const rawResponse = err instanceof OpenRouterError ? err.rawResponse : null;
    const message = err instanceof Error ? err.message : "Nieznany błąd generacji";
    await createGenerationSession(supabase, {
      user_id: user.id,
      source_text: sourceText,
      model: resolveModel(),
      language,
      requested_count: count,
      generated_count: 0,
      saved_count: 0,
      status: "failed",
      error_message: message,
      request_payload: rawRequest as Json,
      response_payload: rawResponse as Json,
    });
    return json(502, { error: "Nie udało się wygenerować fiszek. Spróbuj ponownie.", retriable: true });
  } finally {
    clearTimeout(timeout);
  }

  const generated = result.generatedCount;
  const saved = result.cards.length;
  const skipped = generated - saved;

  // --- 0-saved boundary: OpenRouter answered but nothing passed Zod. Treat as a
  // failure (session failed + audit), no cards inserted, retriable error (FR-018).
  if (saved === 0) {
    await createGenerationSession(supabase, {
      user_id: user.id,
      source_text: sourceText,
      model: result.model,
      language,
      requested_count: count,
      generated_count: generated,
      saved_count: 0,
      status: "failed",
      error_message: "Model nie zwrócił poprawnych kart",
      request_payload: result.rawRequest as Json,
      response_payload: result.rawResponse as Json,
    });
    return json(422, { error: "Model nie zwrócił poprawnych fiszek. Spróbuj ponownie.", retriable: true });
  }

  // --- Success: session is the parent → insert it, read its id, then insert cards ---
  const { data: session, error: sessionError } = await createGenerationSession(supabase, {
    user_id: user.id,
    source_text: sourceText,
    model: result.model,
    language,
    requested_count: count,
    generated_count: generated,
    saved_count: saved,
    status: "succeeded",
    error_message: null,
    request_payload: result.rawRequest as Json,
    response_payload: result.rawResponse as Json,
  });
  if (sessionError) {
    return json(500, { error: "Nie udało się zapisać sesji generacji" });
  }

  const { error: cardsError } = await insertCandidates(supabase, deckId, session.id, result.cards);
  if (cardsError) {
    return json(500, { error: "Nie udało się zapisać wygenerowanych fiszek" });
  }

  return json(200, {
    candidates: result.cards,
    counts: { generated, saved, skipped },
    deckPublicId: deckPublicIdOut,
    sessionPublicId: session.public_id,
  });
};
