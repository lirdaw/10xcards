import { z } from "zod";
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from "astro:env/server";
import { FRONT_MAX, BACK_MAX } from "@/lib/flashcards";

// OpenRouter client on plain `fetch` (no SDK — avoids the ~3 MB bundle and the
// nodejs_compat risk on Workers; see context/foundation/infrastructure.md). Mirrors
// the null-check convention of src/lib/supabase.ts: no API key => mock mode so dev
// works offline. Error mapping to Polish copy stays in the endpoint (Phase 3).

// Exported for tests/generation/failure-path.test.ts, whose pass-through `fetch` double
// must recognise this exact URL to intercept it. That file used to carry its own copy of
// the literal — and its predicate delegates anything it does not recognise to the REAL
// network, so a drift between the two would have turned a sealed test into a live request
// to openrouter.ai carrying the test's source text (impl-review F2).
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Default model MUST support structured outputs (response_format json_schema).
// Overridable via OPENROUTER_MODEL for tuning without a code change.
const DEFAULT_MODEL = "openai/gpt-4o-mini";

// Optional attribution headers (OpenRouter ranking) — harmless if the app isn't public.
const APP_TITLE = "10xCards";
const APP_REFERER = "https://10xcards.app";

// A single validated candidate. Lengths mirror the business rule enforced elsewhere
// (client form + endpoint); the model is also told these limits in the master prompt.
export interface CardCandidate {
  front: string;
  back: string;
}

const candidateSchema = z.object({
  front: z.string().min(1).max(FRONT_MAX),
  back: z.string().min(1).max(BACK_MAX),
});

// Result of one base call. `generatedCount` = cards the model returned; `cards` =
// the subset that passed Zod. The endpoint derives saved = cards.length and
// skipped = generatedCount - saved (single source of truth for the audit + UI).
export interface GenerateResult {
  cards: CardCandidate[];
  generatedCount: number;
  model: string;
  rawRequest: unknown;
  rawResponse: unknown;
}

// Thrown on a failed/timed-out OpenRouter call. Carries the audit payloads so the
// endpoint can still persist them on the `failed` session (Phase 3 contract).
export class OpenRouterError extends Error {
  rawRequest: unknown;
  rawResponse: unknown;
  constructor(message: string, rawRequest: unknown, rawResponse: unknown) {
    super(message);
    this.name = "OpenRouterError";
    this.rawRequest = rawRequest;
    this.rawResponse = rawResponse;
  }
}

// The model that generateCandidates would use. The endpoint needs it to stamp the
// `model` (NOT NULL) column on a FAILED session, where no GenerateResult exists.
export function resolveModel() {
  return OPENROUTER_MODEL ?? DEFAULT_MODEL;
}

// JSON schema forcing the model to return exactly { cards: [{ front, back }] }.
// strict:true requires additionalProperties:false and every property required.
function responseSchema() {
  return {
    type: "object",
    properties: {
      cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            front: { type: "string" },
            back: { type: "string" },
          },
          required: ["front", "back"],
          additionalProperties: false,
        },
      },
    },
    required: ["cards"],
    additionalProperties: false,
  };
}

// System prompt: hard rules encoded so bad cards are minimised at the source (Workers
// limits => no corrective re-call in MVP). Length self-check keeps skips low.
function systemPrompt(targetLanguage: string | null, count: number) {
  // `targetLanguage` arrives ALREADY RENDERED for the model — "German", never `niemiecki`
  // and never a wire code. A Polish exonym inside this English sentence is what made
  // `niemiecki` and `francuski` come back Polish (0/5 graded cards, four runs of four),
  // while the null branch, which interpolates no name at all, was already at 25/25.
  //
  // This module therefore carries NO language vocabulary: no whitelist, no map, and no
  // `"auto"` sentinel — the mode is `null`, so a value that doubles as an API enum and an
  // audit-column value can no longer leak into a prompt. Resolving a code to this name is
  // the endpoint's job (src/pages/api/generate.ts, via the `language` table), which is also
  // what keeps `npm run eval` free of a database dependency it is designed not to have.
  const languageRule =
    targetLanguage === null
      ? "Write the flashcards in the SAME language as the source text."
      : `Write the flashcards in this language: ${targetLanguage}.`;
  return [
    `You generate study flashcards from the user's source text.`,
    `Produce exactly ${count} question/answer flashcards.`,
    `Each card has a "front" (question/prompt) and a "back" (answer).`,
    `"front" must be at most ${FRONT_MAX} characters; "back" at most ${BACK_MAX} characters. Both must be non-empty.`,
    languageRule,
    `Check every length BEFORE returning. Return ONLY through the provided JSON schema — no extra prose.`,
  ].join(" ");
}

// Deterministic sample cards so dev without a key still exercises the full flow.
function mockCards(count: number): CardCandidate[] {
  return Array.from({ length: count }, (_, i) => ({
    front: `Przykładowe pytanie ${i + 1}`,
    back: `Przykładowa odpowiedź ${i + 1} (tryb mock — brak klucza OpenRouter).`,
  }));
}

// Keeps valid cards, silently drops malformed ones (fallback, no re-call). Trims
// first so trailing whitespace from the model doesn't trip the length checks.
function validate(rawCards: unknown[]): CardCandidate[] {
  const valid: CardCandidate[] = [];
  for (const raw of rawCards) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const front = typeof rec.front === "string" ? rec.front.trim() : "";
    const back = typeof rec.back === "string" ? rec.back.trim() : "";
    const parsed = candidateSchema.safeParse({ front, back });
    if (parsed.success) valid.push(parsed.data);
  }
  return valid;
}

interface GenerateArgs {
  sourceText: string;
  /** The model-facing language name, already resolved — or `null` for "same as the source text". */
  targetLanguage: string | null;
  count: number;
  signal?: AbortSignal;
}

// Single base call. Mock mode returns deterministic cards; live mode hits OpenRouter,
// parses choices[0].message.content (a JSON string), and validates each card. Throws
// OpenRouterError (with audit payloads) on transport/HTTP/parse failure.
export async function generateCandidates({
  sourceText,
  targetLanguage,
  count,
  signal,
}: GenerateArgs): Promise<GenerateResult> {
  const model = OPENROUTER_MODEL ?? DEFAULT_MODEL;

  if (!OPENROUTER_API_KEY) {
    const cards = mockCards(count);
    return {
      cards,
      generatedCount: cards.length,
      model: `${model} (mock)`,
      rawRequest: { mock: true, model, targetLanguage, count },
      rawResponse: { mock: true, cards },
    };
  }

  // Scale the token budget with `count` so a large request (up to 15 cards, each back up
  // to BACK_MAX chars) isn't truncated mid-JSON — a cut-off body fails JSON.parse and the
  // whole call dead-ends on the 0-saved path (impl-review F4). ~450 tok/card + overhead.
  const maxTokens = 500 + count * 450;

  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt(targetLanguage, count) },
      { role: "user", content: sourceText },
    ],
    max_tokens: maxTokens,
    temperature: 0.4,
    response_format: {
      type: "json_schema",
      json_schema: { name: "flashcards", strict: true, schema: responseSchema() },
    },
  };
  // Full request body kept as the audit payload for a faithful trail.
  const rawRequest = body;

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": APP_REFERER,
        "X-Title": APP_TITLE,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // Network failure or abort (server-side timeout). Preserve the request for audit.
    const reason = err instanceof Error ? err.message : "fetch failed";
    throw new OpenRouterError(`OpenRouter fetch failed: ${reason}`, rawRequest, { error: reason });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OpenRouterError(`OpenRouter HTTP ${response.status}`, rawRequest, {
      status: response.status,
      body: text,
    });
  }

  const rawResponse: unknown = await response.json().catch(() => null);
  if (!rawResponse) {
    throw new OpenRouterError("OpenRouter returned non-JSON body", rawRequest, null);
  }

  const content = (rawResponse as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
  let rawCards: unknown[] = [];
  try {
    const parsed: unknown = content ? JSON.parse(content) : null;
    if (parsed && Array.isArray((parsed as { cards?: unknown }).cards)) {
      rawCards = (parsed as { cards: unknown[] }).cards;
    }
  } catch {
    // Malformed JSON in content => treat as zero generated; endpoint marks the session failed.
    rawCards = [];
  }

  const cards = validate(rawCards);
  return { cards, generatedCount: rawCards.length, model, rawRequest, rawResponse };
}
