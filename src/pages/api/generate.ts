import type { APIRoute } from "astro";
import { z } from "zod";
import type { Json } from "@/db/database.types";
import { createClient } from "@/lib/supabase";
import { createDeck, deckNameExists, deleteDeck } from "@/lib/decks";
import { countFlashcardsInAnyState, deckIdByPublicId } from "@/lib/flashcards";
import { classifyReplay } from "@/lib/generation-replay";
import { generateCandidates, resolveModel, OpenRouterError } from "@/lib/openrouter";
import { getActiveLanguage } from "@/lib/languages";
import { SOURCE_MAX, COUNT_MIN, COUNT_MAX } from "@/lib/generation-limits";
import { NAME_MIN, NAME_MAX } from "@/lib/deck-limits";
// See api/study.ts: a JSON endpoint reusing strings from the redirect channel's closed set.
// The copy is identical to what `api/decks/index.ts` redirects with and now has one
// definition; this route still answers a JSON body and never redirects.
import {
  DECK_NAME_TAKEN_MESSAGE,
  DECK_CREATE_FAILED_MESSAGE,
  SUPABASE_UNCONFIGURED_MESSAGE,
} from "@/lib/redirect-errors";
import {
  clearSessionIdempotencyKey,
  createGenerationSession,
  findSucceededSessionByIdempotencyKey,
  generationResultByGenerationId,
  insertCandidates,
  retireGenerationSession,
} from "@/lib/generations";

// FIRST JSON endpoint in the project — a deliberate departure from the native
// form-POST + redirect(?error=) convention of every other endpoint. The AI generator
// is a React island that `fetch`es this route and needs a structured body back
// (candidates + counts) plus retriable error codes to drive the "Ponów" button
// (FR-018). All copy stays Polish; validation is Zod (mirrors the LLM layer).

// SOURCE_MAX / COUNT_MIN / COUNT_MAX now come from @/lib/generation-limits, which the
// island imports too — they used to be declared here AND at GeneratorForm.tsx:12-30, i.e.
// one business rule with two definitions, which is the drift test-plan §2 Risk #6 is about.
//
// `language` is no longer one of them. It used to be a Zod enum over the same constant, and
// that enum was doing TWO jobs: naming the offered set, and acting as a prompt-injection
// guard (impl-review F3) — `language` was interpolated verbatim into the LLM system prompt,
// so an arbitrary string was arbitrary instruction text. Both jobs still exist; they are now
// held by two layers instead of one:
//
//   1. LANGUAGE_CODE_RE below — a SHAPE guard that runs before any DB round-trip. It admits
//      no space, no punctuation and at most eight characters, so instruction text cannot
//      pass it whatever the table happens to hold.
//   2. `getActiveLanguage` — MEMBERSHIP, decided by the `language` table rather than by a
//      compile-time list, so shipping or retiring a language is data, not a deploy.
//
// And the string that reaches the prompt is no longer the request's at all: it is
// `prompt_name` from the matched ROW. The injection surface therefore MOVED rather than
// disappearing — it is closed today because the table is write-proof from the app: the
// migration revokes write privileges from `authenticated` AND declares no write policy, two
// independent enforcers (`20260731120000_language_dictionary.sql`). Whatever admin surface
// eventually writes `prompt_name` has to open one of them, and inherits this guard duty when
// it does — see the change's follow-ups/admin-panel.md.

// Server-side OpenRouter timeout. MUST be clearly shorter than the client's fetch
// timeout (~55s) so the server almost always answers first — otherwise the client aborts
// and shows "Ponów" while the server finishes and commits.
//
// That ordering NARROWS the duplication window; it does not close it, and never could
// (lessons.md: "Klient↔serwer timeouty + Ponów wymagają idempotencji zapisu"). What
// closes it is the idempotency key below: the client mints one per attempt, "Ponów"
// replays it verbatim, and a key that already has a succeeded session gets that session
// back instead of a second generation. test-plan §2 Risk #2 is covered by
// tests/generation/generate.test.ts, whose characterization assertion was inverted here.
const SERVER_TIMEOUT_MS = 40_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The SHAPE half of the two-layer language guard described above. Pinned here rather than
// derived from the table, because it must hold even for a code the table has never seen —
// it is what keeps a crafted body from reaching a query, let alone a prompt. `auto` matches
// it and needs no special case in the schema; it is the ONE value with no row behind it, and
// the handler branches on it below.
const LANGUAGE_CODE_RE = /^[a-z]{2,8}$/;
const LANGUAGE_AUTO = "auto";

// Exactly one of deckPublicId / newDeckName — either target an existing deck or
// create one inline. sourceText/count bounds mirror FR-003 and the plan.
const bodySchema = z
  .object({
    deckPublicId: z.string().regex(UUID_RE).optional(),
    newDeckName: z.string().trim().min(NAME_MIN).max(NAME_MAX).optional(),
    sourceText: z.string().min(1).max(SOURCE_MAX),
    language: z.string().regex(LANGUAGE_CODE_RE),
    count: z.number().int().min(COUNT_MIN).max(COUNT_MAX),
    // Optional, and the column behind it is nullable: a client that never learned about
    // the key must keep working. Deduplication is opt-in per attempt, not a precondition.
    idempotencyKey: z.string().regex(UUID_RE).optional(),
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

type Client = NonNullable<ReturnType<typeof createClient>>;

/**
 * What a replay attempt leaves the caller holding.
 *
 * `answered` carries a finished Response — either the replay itself or the query-failure
 * 500 — and both call sites just return it. `empty` carries nothing on purpose: the
 * session exists and has no cards behind it, and what to DO about that is the one thing
 * the two call sites disagree on, so this helper must not decide it (C10X-48). The top
 * lookup heals the row and falls through into an ordinary generation; the 23505 branch,
 * which has already paid for a generation, heals and refuses.
 */
type ReplayOutcome = { kind: "answered"; response: Response } | { kind: "empty" };

/**
 * Answers with an already-persisted generation instead of running a new one.
 *
 * A replay is a benign 200 — the same shape /api/study uses for `alreadyApplied`. From
 * the user's side nothing went wrong: they hit "Ponów" after a client-side timeout and
 * their cards had in fact landed. An error here would invert FR-018.
 *
 * `counts` come from the session's own counters, not from the cards read back, so a
 * replay reports what the MODEL and Zod did — identical to the original answer — even if
 * some of those cards have since been rejected or deleted on the review screen.
 *
 * The three-way split is `classifyReplay` (@/lib/generation-replay), not an `if` here:
 * this function used to read `if (error || !data)` — one branch over two facts that mean
 * opposite things — and mapping "the session is empty" onto the outage copy is what made
 * a poisoned row a PERMANENT 500 for its key. That module's header carries the reasoning
 * and its own tests; this one keeps only the I/O and the two response bodies, both
 * unchanged from before the split.
 */
async function replaySession(
  supabase: Client,
  session: { id: number; public_id: string; generated_count: number; saved_count: number },
): Promise<ReplayOutcome> {
  const classified = classifyReplay(await generationResultByGenerationId(supabase, session.id));
  if (classified.kind === "query-failed") {
    // Unchanged copy, and deliberately so: we know nothing about the user's cards here, so
    // the message must not claim anything about them.
    return { kind: "answered", response: json(500, { error: "Nie udało się odtworzyć wyników generacji" }) };
  }
  if (classified.kind === "empty") {
    return { kind: "empty" };
  }
  return {
    kind: "answered",
    response: json(200, {
      candidates: classified.result.candidates,
      counts: {
        generated: session.generated_count,
        saved: session.saved_count,
        skipped: session.generated_count - session.saved_count,
      },
      deckPublicId: classified.result.deckPublicId,
      sessionPublicId: session.public_id,
    }),
  };
}

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json(500, { error: SUPABASE_UNCONFIGURED_MESSAGE });
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
  const { deckPublicId, newDeckName, language, count, idempotencyKey } = parsed.data;
  const sourceText = parsed.data.sourceText.trim();
  if (sourceText.length < 1) {
    return json(400, { error: "Tekst źródłowy jest pusty" });
  }

  // --- Idempotency (test-plan §2 Risk #2, impl-review F5). "Ponów" replays the payload
  // VERBATIM, key included, so a key that already produced a succeeded session must get
  // that session back rather than a second generation — killing the duplicate BEFORE it
  // costs a paid LLM call.
  //
  // Checked here, ahead of deck resolution rather than next to the deckNameExists guard:
  // on the newDeckName path the first attempt already created the deck, so that guard
  // would 409 the replay before it ever reached this logic.
  //
  // Residual, unchanged from before: two CONCURRENT newDeckName requests still race at
  // createDeck, and the loser 409s because the winner's session may not have committed
  // yet. That is the pre-existing behaviour pinned by the newDeckName case in
  // tests/generation/generate.test.ts — sequential retry, the flow a human actually
  // performs, is fully covered. ---
  //
  // Since 2026-08-13 (C10X-48) this branch also HEALS. A key can resolve to a succeeded
  // session with zero cards behind it — a compensation that failed leaves exactly that row,
  // and so does a user deleting every card of a real generation — and until now both meant a
  // permanent 500 for that key, forever, which is FR-018 inverted about as hard as it can be.
  // `healedKey` records that this request disarmed such a row; the deck branch below reads it.
  let healedKey = false;
  if (idempotencyKey) {
    // Branch on the query error first: mistaking a transient failure for "never seen this
    // key" is how a dedup layer silently starts duplicating again (lessons: error-vs-empty).
    const { data: replayed, error } = await findSucceededSessionByIdempotencyKey(supabase, idempotencyKey);
    if (error) {
      return json(500, { error: "Nie udało się odczytać sesji generacji" });
    }
    if (replayed) {
      const outcome = await replaySession(supabase, replayed);
      if (outcome.kind === "answered") {
        return outcome.response;
      }

      // ORDERING IS THE SAFETY PROPERTY, not defensive nicety: clear the key, CONFIRM a row
      // was matched, and only then fall through. Inverted, the fall-through inserts a session
      // carrying this same key with `status='succeeded'`, collides with the still-poisoned row
      // on generation_session_idempotency_key_uidx, lands in the 23505 handler below, finds
      // the same empty row and returns the same 500 — now AFTER a paid LLM call. The
      // confirmation is what bounds the cost of the failure.
      //
      // `clearSessionIdempotencyKey`, never the retirement (D-07). This code cannot tell a
      // poisoned row from one the user emptied deliberately, and in the second case
      // `saved_count` is TRUTHFUL — retiring it would overwrite a true audit row with a false
      // failure, which is this ticket's own defect class one path over. See the helper's
      // header, which is also where the `.select()` on that write is justified: under RLS a
      // zero-row UPDATE resolves `{ data: null, error: null }`, so `!cleared` is the arm that
      // matters here and `clearError` alone would not see it.
      const { data: cleared, error: clearError } = await clearSessionIdempotencyKey(supabase, replayed.id);
      if (clearError || !cleared) {
        return json(500, {
          error: "Nie udało się odblokować ponowienia generacji. Spróbuj ponownie.",
          retriable: true,
        });
      }
      healedKey = true;
    }
  }

  // --- Resolve the MODEL-facing language name. The shape guard already ran in the schema;
  // this is the membership half, and it is the only thing that turns a wire code into the
  // string the system prompt interpolates. ---
  //
  // ORDERING, and both halves of it are load-bearing.
  //
  // AFTER the replay above: "Ponów" replays the payload VERBATIM, language included. Were
  // the lookup first, an admin deactivating a language between the attempt and the retry
  // would turn a recoverable replay into a 400 — stranding the user with cards that did
  // land and that they can no longer reach, i.e. FR-018 inverted. Pinned by
  // tests/generation/generate.test.ts ("replays a keyed session even when its language has
  // since been deactivated").
  //
  // BEFORE deck resolution: a refused language must never reach a deck query.
  let targetLanguage: string | null = null;
  if (language !== LANGUAGE_AUTO) {
    // Error before absence, as everywhere else in this handler (lessons: error-vs-empty).
    // Reporting an outage as "unknown language" would tell the user to fix a request that
    // was fine — and, worse, would make a dead `language` table look like a validation rule
    // doing its job.
    const { data: row, error } = await getActiveLanguage(supabase, language);
    if (error) {
      return json(500, { error: "Nie udało się odczytać listy języków" });
    }
    if (!row) {
      // Absence covers BOTH an unknown code and a deactivated one, and the two are
      // deliberately indistinguishable from outside — the same refusal the Zod enum used to
      // give, with the same copy.
      return json(400, { error: "Nieprawidłowe dane wejściowe" });
    }
    targetLanguage = row.prompt_name;
  }

  // --- Resolve the target deck. For an EXISTING deck, resolve its bigint id up front
  // so a missing/foreign deck 404s before we pay for a generation. For a NEW deck, only
  // CHECK the name is free here — the deck is created on the success path (below), so a
  // failed generation neither orphans an empty deck nor blocks "Ponów" with a 23505 on
  // retry (impl-review F1). deckId stays null until the deck is known/created. ---
  let deckId: number | null = null;
  let deckPublicIdOut = "";
  // Set ONLY when this request created the deck itself, so the failure branches after the
  // LLM call can undo it. An existing deck the caller passed in is never touched.
  let createdDeckPublicId: string | null = null;
  if (deckPublicId) {
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
  } else if (newDeckName) {
    // Fast 409 for a genuine duplicate (no wasted LLM call). The deck itself is created
    // only after a successful generation — deferring it is what makes retry work (F1).
    const { data: existing, error } = await deckNameExists(supabase, newDeckName);
    if (error) {
      return json(500, { error: "Nie udało się odczytać talii" });
    }
    // ADOPTION, and read the gate before the emptiness test — the order of these two
    // conditions is the decision (D-06, plan-review F1). Clearing the key above is not enough
    // on this path: the attempt that poisoned the session usually left its deck behind too
    // (the same failed round-trip swallowed both undos), and that orphan makes this very
    // lookup answer a permanent 409 — trading a permanent 500 for a permanent 409 and fixing
    // nothing the ticket was reported for. The orphan cannot simply be deleted instead:
    // generation_session carries no deck FK and its deck is read back THROUGH its cards, of
    // which there are none, so from the poisoned session the deck is unreachable by
    // construction.
    //
    // GATED ON THE HEAL, NEVER ON EMPTINESS ALONE. An empty deck the user made by hand is not
    // an orphan, and adopting it would silently generate into somebody's deliberately-empty
    // deck; tests/generation/generate.test.ts pins that ordinary 409 with a deck created
    // through /api/decks and never generated into. Both duplicate-name cases there are
    // deliberately key-LESS, so `healedKey` is exactly what keeps them green.
    if (existing && !healedKey) {
      return json(409, { error: DECK_NAME_TAKEN_MESSAGE });
    }
    if (existing) {
      // Two more round-trips, on the healed path only. `deckNameExists` projects public_id
      // alone, and the emptiness question is about cards rather than about the deck row.
      const { data: adopted, error: adoptError } = await deckIdByPublicId(supabase, existing.public_id);
      if (adoptError) {
        return json(500, { error: "Nie udało się odczytać talii" });
      }
      if (!adopted) {
        // Vanished between the two reads. Refuse in the ordinary way rather than inventing a
        // branch: the name is, as far as this request can tell, still someone's.
        return json(409, { error: DECK_NAME_TAKEN_MESSAGE });
      }
      // State-AGNOSTIC on purpose: countFlashcards filters `state_id = STATE_ACCEPTED`, so a
      // deck full of candidates would read as 0 through it (see countFlashcardsInAnyState's
      // header). A null count is not proof of emptiness either, so it refuses too.
      const { count, error: countError } = await countFlashcardsInAnyState(supabase, adopted.id);
      if (countError) {
        return json(500, { error: "Nie udało się odczytać talii" });
      }
      if (count !== 0) {
        return json(409, { error: DECK_NAME_TAKEN_MESSAGE });
      }
      deckId = adopted.id;
      deckPublicIdOut = existing.public_id;
      // `createdDeckPublicId` stays NULL, and that is load-bearing: this request did not
      // create this deck, so the failure branches below must never delete it. They would
      // otherwise destroy a deck that predates them.
    }
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
    result = await generateCandidates({ sourceText, targetLanguage, count, signal: controller.signal });
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
      // idempotency_key stays NULL on the two failure INSERTS — this looks like an oversight
      // and is not (plan-review F1). "Ponów" replays the same key, so a failed audit row
      // carrying it would be the row the retry collides with.
      //
      // But these two inserts are NOT the only way to reach a `failed` row, so do not
      // "simplify" the partial unique index's `status = 'succeeded'` predicate away on the
      // strength of this NULL. The reason changed on 2026-08-13 (C10X-48) and the conclusion
      // did not — read both halves before touching the index.
      //
      // Until C10X-48 this comment said the two guards were NOT independent (impl-review F3):
      // `failGenerationSession` — the compensating update below — flipped an already-inserted
      // `succeeded` row to `failed` and LEFT ITS KEY IN PLACE, so a keyed `failed` row was
      // reachable in ordinary operation and the `status` predicate was the only thing covering
      // it. That route is now closed: `retireGenerationSession` nulls the key and flips the
      // status in one statement (D-03), so a SUCCESSFUL retirement produces no keyed `failed`
      // row at all.
      //
      // The predicate still earns its place, for a different row: a retirement that FAILS
      // leaves a keyed `succeeded` row standing, and the index is what stops a second
      // succeeded row for that key from ever existing. And the index's FIRST predicate,
      // `idempotency_key is not null`, is load-bearing too once the self-heal C10X-48 adds
      // below lands: it clears a key without touching `status`, so a `succeeded` row with a
      // NULL key becomes a shape production reaches. Both predicates, each for a different row.
      idempotency_key: null,
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
      // NULL for the same reason as the transport-failure path above — see that comment.
      idempotency_key: null,
    });
    return json(422, { error: "Model nie zwrócił poprawnych fiszek. Spróbuj ponownie.", retriable: true });
  }

  // --- Success. Create the NEW deck now (deferred from pre-LLM so a failed generation
  // doesn't orphan an empty deck or block retry with a 23505 — F1). The upfront
  // name-availability check makes a real 23505 here a rare TOCTOU; still mapped. ---
  //
  // `deckId === null` is the second half of the condition, and it is the ADOPTION check: the
  // healed path above may already have resolved this name to an owned empty deck, and creating
  // a second one under it is impossible (deck_user_name_unique) — it would answer 409 for a
  // deck this request was told to use. One fact rather than two that have to agree: every
  // branch that resolves a deck sets deckId, and the defensive guard directly below already
  // depends on exactly that invariant.
  if (newDeckName && deckId === null) {
    const { data: deck, error } = await createDeck(supabase, user.id, newDeckName);
    if (error) {
      const taken = error.code === "23505";
      return json(taken ? 409 : 500, {
        error: taken ? DECK_NAME_TAKEN_MESSAGE : DECK_CREATE_FAILED_MESSAGE,
      });
    }
    deckId = deck.id;
    deckPublicIdOut = deck.public_id;
    createdDeckPublicId = deck.public_id;
  }
  if (deckId === null) {
    // Defensive: every branch above sets deckId on the success path. Narrows the type
    // for insertCandidates and guards against a future branch forgetting to resolve it.
    return json(500, { error: "Nie udało się ustalić talii docelowej" });
  }

  // --- Session is the parent → insert it, read its id, then insert cards ---
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
    idempotency_key: idempotencyKey ?? null,
  });
  if (sessionError) {
    // The lookup at the top of this handler loses the very race it exists for: in the real
    // duplication window request 1 is still committing when the client aborts at 55 s, so
    // request 2 finds nothing, generates, and only collides HERE. A 23505 therefore means
    // request 1 committed — its cards DID land — so this is a replay, not a failure.
    // Without this branch the user sees an error while holding a full set of candidates.
    //
    // What this branch answers when it does NOT return a replay. Built up rather than
    // returned early, so the deck undo below still runs on every one of these paths.
    let sessionFailure: { error: string; retriable?: boolean } = { error: "Nie udało się zapisać sesji generacji" };
    if (idempotencyKey && sessionError.code === "23505") {
      const { data: won, error: wonError } = await findSucceededSessionByIdempotencyKey(supabase, idempotencyKey);
      if (wonError) {
        // Used to be folded into the generic 500 by `if (!error && won)` — a swallow, and the
        // sibling of the one C10X-48 exists for. The two states are not the same thing: the
        // winner's session may well hold the user's cards and we simply could not read it, so
        // say so and let them try again rather than reporting the write we failed at.
        sessionFailure = { error: "Nie udało się odczytać sesji generacji", retriable: true };
      } else if (won) {
        const outcome = await replaySession(supabase, won);
        if (outcome.kind === "answered") {
          return outcome.response;
        }

        // THE ASYMMETRY WITH THE TOP LOOKUP IS DELIBERATE — heal, then REFUSE, where that one
        // heals and falls through. This code has already paid for a generation, so falling
        // through here would buy a SECOND one on a single click. Clearing the winner's key
        // costs one round-trip and is what makes the user's next attempt generate cleanly:
        // it finds no key at all, so nothing to collide with and nothing to replay.
        const { data: cleared, error: clearError } = await clearSessionIdempotencyKey(supabase, won.id);
        sessionFailure =
          clearError || !cleared
            ? { error: "Nie udało się odblokować ponowienia generacji. Spróbuj ponownie.", retriable: true }
            : { error: "Nie udało się zapisać sesji generacji. Spróbuj ponownie.", retriable: true };
      }
    }
    // Undo a deck THIS request created (impl-review F4). Without it the deck survives while
    // its session never landed, and "Ponów" — which replays the same name — dies on
    // deckNameExists with a permanent 409: retry impossible, empty orphan deck left behind.
    // That is the exact failure deferring createDeck past the LLM call was meant to prevent,
    // one step further down. Safe and provably empty here: no cards were inserted on this
    // path and generation_session carries no deck FK.
    //
    // Still best-effort — and as of 2026-08-13 (C10X-48) that is an EXCEPTION rather than
    // house style. This line used to justify itself "Best-effort, like failGenerationSession",
    // an analogy that has since inverted: the compensation is now a checked write
    // (`retireGenerationSession`), so the symbol this deferred to no longer defers to
    // anything. Do not read the inversion backwards and re-swallow the compensation to
    // restore the symmetry — the fix is to check THIS await too, and it belongs to C10X-49,
    // which owns this branch and its tests. The other exceptions left in the file are the two
    // failure-path `createGenerationSession` inserts, owned by C10X-50.
    if (createdDeckPublicId) {
      await deleteDeck(supabase, createdDeckPublicId);
    }
    return json(500, sessionFailure);
  }

  const { error: cardsError } = await insertCandidates(supabase, deckId, session.id, result.cards);
  if (cardsError) {
    // The session was already saved as `succeeded`, but no cards landed. Compensate so the
    // audit doesn't over-report saved cards (impl-review F2) — and, since 2026-08-13
    // (C10X-48), READ the result of that compensation instead of discarding it.
    //
    // "Best-effort" is gone from this branch, and it was never a decision: it entered the
    // file as a comment, and the comment is what let the one caller drop the result. On the
    // likeliest road to `cardsError` the compensation is EXPECTED to fail too — the card
    // insert and this update share one connection, one token and one proxy — so the swallow
    // was silent exactly when it mattered.
    //
    // Both writes are checked on `data`, not on `error` alone. Under RLS a zero-row
    // UPDATE/DELETE resolves `{ data: null, error: null }`, so `if (error)` would still have
    // swallowed the case that matters; the explicit `.select(...).maybeSingle()` on both
    // helpers is what makes a zero-row write visible at all (see their headers, and
    // src/lib/decks.ts:37-42 for the precedent).
    const { data: retired, error: retireError } = await retireGenerationSession(
      supabase,
      session.id,
      "Zapis kart nie powiódł się",
    );
    // Same undo as the session-insert branch above (impl-review F4): no cards landed, so a
    // deck this request created is empty and would otherwise 409 every future "Ponów".
    // `createdDeckPublicId` is null on the existing-deck path, where the undo is correctly
    // not attempted at all — an undo that never ran has not failed, hence the `true` default.
    let deckUndone = true;
    if (createdDeckPublicId) {
      const { data: deleted, error: deleteError } = await deleteDeck(supabase, createdDeckPublicId);
      deckUndone = !deleteError && deleted !== null;
    }

    // WHAT THIS BRANCH GUARANTEES, and — read this second half before concluding the bug is
    // fixed here — what it still does not. It makes a failed compensation NAMEABLE, and the
    // response is the ONLY witness there is: nothing in `src/` writes a log line and nothing
    // in this project reads a log sink (test-plan §7). It REPAIRS NOTHING. On a failed
    // retirement the row stands as `succeeded, saved_count > 0`, keyed, with zero cards
    // behind it — poisoned; on a failed deck undo the orphan deck survives. What clears the
    // poisoned row is the self-heal on the NEXT attempt's replay lookup, which is why this
    // answers `retriable: true` instead of presenting the state as terminal.
    if (!retireError && retired && deckUndone) {
      return json(500, { error: "Nie udało się zapisać wygenerowanych fiszek" });
    }
    // Inline literal, alongside its siblings in this handler — deliberately NOT a member of
    // REDIRECT_MESSAGES, whose members are values the deck pages render out of a URL and
    // whose size is pinned.
    return json(500, {
      error:
        "Nie udało się zapisać wygenerowanych fiszek, a wycofanie nieudanego zapisu nie powiodło się. Spróbuj ponownie.",
      retriable: true,
    });
  }

  return json(200, {
    candidates: result.cards,
    counts: { generated, saved, skipped },
    deckPublicId: deckPublicIdOut,
    sessionPublicId: session.public_id,
  });
};
