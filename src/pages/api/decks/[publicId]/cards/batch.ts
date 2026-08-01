import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { deckIdByPublicId, setFlashcardState, STATE_ACCEPTED, STATE_REJECTED } from "@/lib/flashcards";
// See api/study.ts: a JSON endpoint reusing one string from the closed set, not joining the
// `?error=` channel.
import { SUPABASE_UNCONFIGURED_MESSAGE } from "@/lib/redirect-errors";

// JSON endpoint for every multi-card mutation the review screen makes, modelled on
// src/pages/api/study.ts: a React island fetches it and needs a STRUCTURED body back —
// which id moved and which did not — and a formData redirect cannot carry that. The rest
// of card/deck CRUD stays formData + redirect; this is the deliberate exception, same
// justification as /api/generate and /api/study. All copy stays Polish; validation is Zod.
//
// A single-card action is a one-element array, so there is exactly one code path, one
// error contract, and one set of tests per action.
//
// Route note: this file is a STATIC segment sitting next to the dynamic [cardPublicId].ts,
// and Astro resolves static segments first, so /cards/batch lands here. Even if that ever
// changed, "batch" fails [cardPublicId].ts's UUID guard and yields a 404 rather than a
// wrong write.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bounds the batch so a hand-crafted body can't ask for an unbounded IN (...) list. The
// review screen never approaches it: a generation caps at 15 cards.
const IDS_MAX = 100;

// One member today. `{ action: "delete", cardPublicIds }` is deliberately absent — it ships
// with its UI and deleteFlashcards in C10X-16, because an endpoint action with no caller is
// untested surface. The union shape is kept precisely so adding it there is additive.
const setStateSchema = z.object({
  action: z.literal("setState"),
  cardPublicIds: z.array(z.string().regex(UUID_RE)).min(1).max(IDS_MAX),
  // Whitelisted literals, not the raw lookup ids: `generated` is unreachable by design —
  // a card never returns to being a candidate — and the island never learns about ids.
  state: z.union([z.literal("accepted"), z.literal("rejected")]),
});

const bodySchema = z.discriminatedUnion("action", [setStateSchema]);

const TARGET_STATE = { accepted: STATE_ACCEPTED, rejected: STATE_REJECTED } as const;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  const { publicId } = context.params;
  if (!publicId || !UUID_RE.test(publicId)) {
    return json(404, { error: "Talia nie istnieje" });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json(500, { error: SUPABASE_UNCONFIGURED_MESSAGE });
  }

  if (!context.locals.user) {
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

  // Branch on the query error before treating null as not-found, so a transient DB failure
  // isn't masked as a 404 (lessons: SSR error-vs-empty). Only a genuine null (absent or
  // RLS-hidden) is a real 404 — so we never reveal that a foreign deck exists.
  const { data: deck, error: deckError } = await deckIdByPublicId(supabase, publicId);
  if (deckError) {
    return json(500, { error: "Nie udało się odczytać talii" });
  }
  if (!deck) {
    return json(404, { error: "Talia nie istnieje" });
  }

  // Dedupe before the write. Postgres collapses repeats inside `IN (...)` anyway, so this is
  // about the RESPONSE: `changed`/`skipped` are derived by filtering this list, so a body
  // sending the same id twice would get it back twice and inflate any count taken from the
  // result. It also stops a crafted body spending the whole IDS_MAX budget on one id.
  const cardPublicIds = [...new Set(parsed.data.cardPublicIds)];
  const { data: changedRows, error } = await setFlashcardState(
    supabase,
    deck.id,
    cardPublicIds,
    TARGET_STATE[parsed.data.state],
  );
  if (error) {
    return json(500, { error: "Nie udało się zapisać zmian" });
  }

  // RETURNING is the whole contract: under RLS a refused write is a silent 0-row no-op
  // reporting NO error, so the outcome is derived from what came back, never from the
  // absence of an error. Everything requested but not returned was already in the target
  // state, illegal for it, or not this account's — three cases the caller must not be able
  // to tell apart. An empty `changed` is therefore a 200, rendered as "nic nie zmieniono",
  // mirroring /api/study's benign alreadyApplied.
  const changed = new Set(changedRows.map((row) => row.public_id));
  return json(200, {
    ok: true,
    changed: cardPublicIds.filter((id) => changed.has(id)),
    skipped: cardPublicIds.filter((id) => !changed.has(id)),
  });
};
